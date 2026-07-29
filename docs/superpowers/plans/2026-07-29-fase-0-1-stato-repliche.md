# Fase 0+1 — Consolidamento e stato osservabile del programma di replica

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mettere al sicuro il lavoro v2 non committato, ripristinare il retry perso, e rendere osservabile dall'esterno il programma `wazuh-immutable-store` tramite un file di stato JSON e un endpoint HTTPS di sola lettura — così che DA-IPAM possa monitorare le repliche verso lo storage immutabile.

**Architecture:** Un modulo `state.py` scrive `/var/lib/wazuh-immutable-store/state.json` in modo atomico; i comandi esistenti (`archive`, `retention`, `verify`) vi registrano il proprio esito, e un comando `status --write-state` aggiorna periodicamente le parti vive. Un comando `serve` espone quel file via HTTPS con token, senza calcolare nulla e senza accedere a mount o log, così da poter girare come utente non privilegiato.

**Tech Stack:** Python 3.8+, solo libreria standard (`http.server`, `ssl`, `hmac`, `json`, `unittest`) più `PyYAML` già presente. Nessuna dipendenza nuova.

## Global Constraints

- **Repository di lavoro**: `/Users/riccardo/Progetti/WazuhIStore_imm/wazuh-immutable-store-v2/` — è la copia con `src/storage_backends/`, che diventa l'unica base di codice. Path dei file sempre relativi a quella directory.
- **`src/storage_backends/` non è tracciata da git**: il primo commit del Task 1 deve includerla, altrimenti un `git clean` la distrugge.
- **Nessuna dipendenza nuova**: `requirements.txt` deve restare `PyYAML>=6.0`. I test usano `unittest` della libreria standard, non pytest.
- **Retro-compatibilità della configurazione**: una `/etc/wazuh-immutable-store/config.yaml` scritta dal wizard v1 (senza sezione `storage:`) deve continuare a funzionare. Non introdurre chiavi obbligatorie.
- **Il server non calcola nulla**: legge solo `state.json`. Nessun accesso a `/mnt`, `/var/ossec`, nessuna esecuzione di comandi.
- **Nessun segreto nei log**: mai loggare il token, le chiavi S3, il contenuto di `config.yaml`.
- **Italiano** nei messaggi rivolti all'operatore; i commenti nel codice seguono lo stile esistente del file che si tocca.
- Python minimo **3.8**: niente `match`, niente `str | None` nelle annotazioni (usare `Optional[str]`).
- Test: `python3 -m unittest discover -s tests -v` dalla radice del repository.

## File Structure

| File | Ruolo |
|---|---|
| `src/state.py` (nuovo) | Schema, scrittura atomica, classificazione dell'esito. Nessun I/O di rete. |
| `src/status_server.py` (nuovo) | Server HTTPS di sola lettura. Nessuna logica applicativa. |
| `src/main.py` (mod) | Registra gli esiti nello stato, corregge l'exit code, aggiunge i comandi `serve` e `status --write-state` |
| `src/storage_backends/__init__.py` (mod) | Guardia sui backend non pronti |
| `tests/test_state.py` (nuovo) | Test di `state.py` |
| `tests/test_status_server.py` (nuovo) | Test del server |
| `systemd/wazuh-immutable-store-status.service` (nuovo) | Unit del server |
| `systemd/wazuh-immutable-store-refresh.{service,timer}` (nuovi) | Rinfresco dello stato ogni 5 minuti |
| `scripts/install-status-endpoint.sh` (nuovo) | Utente, certificato, token, unit, firewall |

---

### Task 1: Mettere al sicuro la v2, ripristinare il retry, bloccare i backend non pronti

**Files:**
- Modify: `src/main.py` (metodo `run_archive`)
- Modify: `src/storage_backends/__init__.py`
- Test: `tests/test_backend_guard.py`

**Interfaces:**
- Produces: `get_backend(storage_config, remote_retention)` solleva `StorageBackendError` per i backend non pronti; `run_archive` ritenta gli upload falliti.

- [ ] **Step 1: Committare il lavoro esistente prima di toccarlo**

```bash
cd /Users/riccardo/Progetti/WazuhIStore_imm/wazuh-immutable-store-v2
git status --short          # atteso: M main.py, M models.py, M wizard.py, ?? src/storage_backends/
git add src/storage_backends/ src/main.py src/models.py src/wizard.py
git commit -m "feat(storage): astrazione backend (qnap-nfs, generic-nfs, s3-compatible)

Lavoro finora non committato: src/storage_backends/ era untracked.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git log --oneline -1
```

- [ ] **Step 2: Scrivere il test della guardia sui backend**

Crea `tests/test_backend_guard.py`:

```python
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))

from models import StorageConfig, QNAPConfig, GenericNFSConfig
from storage_backends import get_backend, StorageBackendError


class TestBackendGuard(unittest.TestCase):
    def test_qnap_e_consentito(self):
        cfg = StorageConfig(type='qnap-nfs', qnap_nfs=QNAPConfig())
        backend = get_backend(cfg, None)
        self.assertEqual(backend.type_name, 'qnap-nfs')

    def test_generic_nfs_e_bloccato(self):
        cfg = StorageConfig(type='generic-nfs', generic_nfs=GenericNFSConfig())
        with self.assertRaises(StorageBackendError) as ctx:
            get_backend(cfg, None)
        self.assertIn('non è pronto', str(ctx.exception))

    def test_s3_e_bloccato(self):
        cfg = StorageConfig(type='s3-compatible')
        with self.assertRaises(StorageBackendError) as ctx:
            get_backend(cfg, None)
        self.assertIn('non è pronto', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
```

Se le firme di `QNAPConfig()`/`GenericNFSConfig()` richiedono argomenti obbligatori, leggi `src/models.py` e passa i minimi necessari.

- [ ] **Step 3: Eseguire il test e vederlo fallire**

Run: `python3 -m unittest tests.test_backend_guard -v`
Expected: FAIL — `get_backend` costruisce i backend senza sollevare nulla.

- [ ] **Step 4: Aggiungere la guardia in `src/storage_backends/__init__.py`**

In cima al file, dopo gli import:

```python
# Backend non ancora pronti per la produzione: retention va in errore con mount
# point nullo, il cleanup dei log locali non avviene mai (disco che si riempie),
# i comandi di lettura ignorano il backend e boto3 non è tra le dipendenze.
# Meglio rifiutare all'avvio con un messaggio chiaro che rompersi a metà run.
_BACKEND_NON_PRONTI = {
    'generic-nfs': 'retention e cleanup locale non implementati per questo backend',
    's3-compatible': 'retention, cleanup locale e comandi di lettura non implementati; boto3 non dichiarato',
    'minio-s3': 'retention, cleanup locale e comandi di lettura non implementati; boto3 non dichiarato',
}
```

Poi, come prima istruzione dentro `get_backend`:

```python
    motivo = _BACKEND_NON_PRONTI.get(storage_config.type)
    if motivo:
        raise StorageBackendError(
            f"Il backend '{storage_config.type}' non è pronto per l'uso: {motivo}. "
            "Usa 'qnap-nfs' finché non viene completato."
        )
```

- [ ] **Step 5: Eseguire il test e vederlo passare**

Run: `python3 -m unittest tests.test_backend_guard -v`
Expected: PASS (3 test)

- [ ] **Step 6: Ripristinare il retry sugli upload in `run_archive`**

In `src/main.py`, sostituisci il blocco di upload (oggi un solo tentativo per record):

```python
            for record in records:
                try:
                    locator = backend.upload_archive(record)
                    logger.info(f"Uploaded ({backend.type_name}): {locator}")
                    successful += 1
                except StorageBackendError as e:
                    logger.error(f"Upload failed for {record.id}: {e}")
                    failed += 1
```

con la versione che ritenta, ripristinando il comportamento della v1 (3 tentativi con attesa crescente):

```python
            # Retry con backoff: ripristina il comportamento pre-astrazione backend.
            # Un intoppo NFS transitorio non deve trasformarsi in un ciclo fallito.
            max_retries = 3
            for record in records:
                for tentativo in range(1, max_retries + 1):
                    try:
                        locator = backend.upload_archive(record)
                        logger.info(f"Uploaded ({backend.type_name}): {locator}")
                        successful += 1
                        break
                    except StorageBackendError as e:
                        if tentativo < max_retries:
                            logger.warning(
                                f"Upload fallito per {record.id}, ritento "
                                f"({tentativo}/{max_retries}): {e}"
                            )
                            time.sleep(5 * tentativo)
                        else:
                            logger.error(f"Upload fallito definitivamente per {record.id}: {e}")
                            failed += 1
```

Aggiungi `import time` fra gli import di `main.py` se non c'è già (verifica con `grep -n "^import time" src/main.py`).

- [ ] **Step 7: Verificare che nulla si sia rotto**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS. Poi `python3 -c "import sys; sys.path.insert(0,'src'); import main"` per verificare che il modulo si importi senza errori di sintassi.

- [ ] **Step 8: Commit**

```bash
git add src/storage_backends/__init__.py src/main.py tests/test_backend_guard.py
git commit -m "fix(storage): retry con backoff sugli upload e guardia sui backend non pronti

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Il modulo di stato

**Files:**
- Create: `src/state.py`
- Test: `tests/test_state.py`

**Interfaces:**
- Produces:
  - `STATE_SCHEMA_VERSION = 1`
  - `DEFAULT_STATE_PATH = Path('/var/lib/wazuh-immutable-store/state.json')`
  - `classify_archive_outcome(connected: bool, created: int, uploaded: int, failed: int) -> str` → `'success' | 'partial' | 'failed'`
  - `class StateStore` con `__init__(self, path: Path = DEFAULT_STATE_PATH)`, `read() -> dict`, `update_section(self, section: str, payload: dict) -> None`, `update_live(self, backend: dict, local_disk: dict, archives: dict, schedule: dict) -> None`
  - `empty_state(host: str) -> dict`

- [ ] **Step 1: Scrivere i test**

Crea `tests/test_state.py`:

```python
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))

from state import (
    STATE_SCHEMA_VERSION, StateStore, classify_archive_outcome, empty_state,
)


class TestClassifyOutcome(unittest.TestCase):
    def test_backend_irraggiungibile(self):
        self.assertEqual(classify_archive_outcome(False, 3, 0, 0), 'failed')

    def test_nulla_da_archiviare(self):
        self.assertEqual(classify_archive_outcome(True, 0, 0, 0), 'success')

    def test_tutto_riuscito(self):
        self.assertEqual(classify_archive_outcome(True, 3, 3, 0), 'success')

    def test_parziale(self):
        self.assertEqual(classify_archive_outcome(True, 3, 2, 1), 'partial')

    def test_tutti_falliti(self):
        self.assertEqual(classify_archive_outcome(True, 3, 0, 3), 'failed')


class TestStateStore(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'state.json'
        self.store = StateStore(self.path)

    def tearDown(self):
        self.tmp.cleanup()

    def test_read_su_file_assente_ritorna_scheletro(self):
        stato = self.store.read()
        self.assertEqual(stato['schema_version'], STATE_SCHEMA_VERSION)
        self.assertEqual(stato['runs']['archive']['outcome'], 'never')

    def test_read_su_file_corrotto_non_solleva(self):
        self.path.write_text('{ questo non è json')
        stato = self.store.read()
        self.assertEqual(stato['runs']['archive']['outcome'], 'never')

    def test_update_section_persiste_e_non_perde_il_resto(self):
        self.store.update_section('archive', {'outcome': 'success', 'uploaded': 2})
        self.store.update_section('verify', {'outcome': 'success'})
        stato = json.loads(self.path.read_text())
        self.assertEqual(stato['runs']['archive']['uploaded'], 2)
        self.assertEqual(stato['runs']['verify']['outcome'], 'success')

    def test_scrittura_atomica_niente_file_temporanei_residui(self):
        self.store.update_section('archive', {'outcome': 'success'})
        residui = [p.name for p in self.path.parent.iterdir() if p.name != 'state.json']
        self.assertEqual(residui, [])

    def test_update_live_scrive_le_sezioni_vive(self):
        self.store.update_live(
            backend={'type': 'qnap-nfs', 'reachable': True},
            local_disk={'use_percent': 57},
            archives={'total': 512},
            schedule={'archive_interval': 'hourly'},
        )
        stato = self.store.read()
        self.assertTrue(stato['backend']['reachable'])
        self.assertEqual(stato['local_disk']['use_percent'], 57)
        self.assertEqual(stato['archives']['total'], 512)

    def test_generated_at_viene_aggiornato(self):
        self.store.update_section('archive', {'outcome': 'success'})
        stato = self.store.read()
        self.assertTrue(stato['generated_at'].endswith('Z'))

    def test_empty_state_contiene_le_tre_sezioni_run(self):
        stato = empty_state('srv-test')
        self.assertEqual(set(stato['runs'].keys()), {'archive', 'retention', 'verify'})
        self.assertEqual(stato['host'], 'srv-test')


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `python3 -m unittest tests.test_state -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'state'`

- [ ] **Step 3: Implementare `src/state.py`**

```python
"""
Stato osservabile del programma.

Scrive un unico file JSON che descrive l'ultimo esito di ogni ciclo e lo stato
vivo della destinazione. È l'unica cosa che il server di stato espone: per questo
la scrittura è atomica (nessun lettore deve mai vedere un file a metà) e nessuna
funzione qui dentro fa I/O di rete.
"""
import json
import logging
import os
import socket
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger('wazuh-immutable-store.state')

STATE_SCHEMA_VERSION = 1
DEFAULT_STATE_PATH = Path('/var/lib/wazuh-immutable-store/state.json')

_SEZIONI_RUN = ('archive', 'retention', 'verify')


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def empty_state(host: Optional[str] = None) -> dict:
    """Scheletro dello stato: tutte le sezioni presenti, nessun dato."""
    return {
        'schema_version': STATE_SCHEMA_VERSION,
        'generated_at': _now_iso(),
        'host': host or socket.gethostname(),
        'backend': {},
        'local_disk': {},
        'runs': {nome: {'outcome': 'never'} for nome in _SEZIONI_RUN},
        'archives': {},
        'retention_policy': {},
        'schedule': {},
    }


def classify_archive_outcome(connected: bool, created: int, uploaded: int, failed: int) -> str:
    """
    Esito reale di un ciclo di archiviazione.

    Nota: prima di questa funzione il comando usciva sempre con codice 0, anche
    con il backend irraggiungibile o con tutti gli upload falliti.
    """
    if not connected:
        return 'failed'
    if created == 0:
        return 'success'          # niente da archiviare non è un errore
    if failed > 0:
        return 'partial' if uploaded > 0 else 'failed'
    return 'success'


class StateStore:
    """Legge e aggiorna il file di stato. Ogni scrittura è atomica."""

    def __init__(self, path: Path = DEFAULT_STATE_PATH):
        self.path = Path(path)

    def read(self) -> dict:
        """Stato corrente; scheletro se il file manca o è illeggibile."""
        try:
            with open(self.path, 'r', encoding='utf-8') as fh:
                stato = json.load(fh)
            if not isinstance(stato, dict) or 'runs' not in stato:
                raise ValueError('struttura inattesa')
            for nome in _SEZIONI_RUN:
                stato['runs'].setdefault(nome, {'outcome': 'never'})
            return stato
        except FileNotFoundError:
            return empty_state()
        except Exception as e:
            logger.warning(f"Stato illeggibile ({e}); riparto da uno stato vuoto")
            return empty_state()

    def update_section(self, section: str, payload: dict) -> None:
        """Aggiorna una sezione di `runs` lasciando intatte le altre."""
        stato = self.read()
        stato['runs'][section] = payload
        self._write(stato)

    def update_live(self, backend: dict, local_disk: dict,
                    archives: dict, schedule: dict) -> None:
        """Aggiorna le parti che cambiano fra un ciclo e l'altro."""
        stato = self.read()
        stato['backend'] = backend
        stato['local_disk'] = local_disk
        stato['archives'] = archives
        stato['schedule'] = schedule
        self._write(stato)

    def update_retention_policy(self, policy: dict) -> None:
        stato = self.read()
        stato['retention_policy'] = policy
        self._write(stato)

    def _write(self, stato: dict) -> None:
        stato['schema_version'] = STATE_SCHEMA_VERSION
        stato['generated_at'] = _now_iso()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Scrittura atomica: file temporaneo nella STESSA directory (rename è
        # atomico solo sullo stesso filesystem), fsync, poi rename.
        fd, tmp_name = tempfile.mkstemp(dir=str(self.path.parent), prefix='.state-', suffix='.tmp')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as fh:
                json.dump(stato, fh, indent=2, ensure_ascii=False)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_name, self.path)
            os.chmod(self.path, 0o640)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `python3 -m unittest tests.test_state -v`
Expected: PASS (12 test)

- [ ] **Step 5: Commit**

```bash
git add src/state.py tests/test_state.py
git commit -m "feat(state): file di stato JSON con scrittura atomica

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Registrare gli esiti e correggere l'uscita silenziosa

**Files:**
- Modify: `src/main.py` (`run_archive`, `run_retention`, `verify_integrity`, `main()`)
- Test: `tests/test_outcome_exit.py`

**Interfaces:**
- Consumes: `StateStore`, `classify_archive_outcome` dal Task 2.
- Produces: `WazuhImmutableStore.run_archive(...) -> str` (ritorna l'esito); `main()` esce con codice 1 se l'esito non è `success`.

- [ ] **Step 1: Scrivere il test della regola di uscita**

Crea `tests/test_outcome_exit.py`:

```python
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))

from state import classify_archive_outcome


def exit_code_per_esito(esito: str) -> int:
    """Regola usata da main(): solo 'success' esce con 0."""
    return 0 if esito == 'success' else 1


class TestExitCode(unittest.TestCase):
    def test_backend_giu_esce_con_errore(self):
        esito = classify_archive_outcome(connected=False, created=2, uploaded=0, failed=0)
        self.assertEqual(exit_code_per_esito(esito), 1)

    def test_upload_parzialmente_falliti_escono_con_errore(self):
        esito = classify_archive_outcome(connected=True, created=3, uploaded=2, failed=1)
        self.assertEqual(exit_code_per_esito(esito), 1)

    def test_ciclo_pulito_esce_con_zero(self):
        esito = classify_archive_outcome(connected=True, created=3, uploaded=3, failed=0)
        self.assertEqual(exit_code_per_esito(esito), 0)

    def test_niente_da_fare_esce_con_zero(self):
        esito = classify_archive_outcome(connected=True, created=0, uploaded=0, failed=0)
        self.assertEqual(exit_code_per_esito(esito), 0)


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Eseguire il test e vederlo passare già**

Run: `python3 -m unittest tests.test_outcome_exit -v`
Expected: PASS. Questo test fissa la regola prima di applicarla in `main.py`; il valore sta nel fatto che d'ora in poi un cambio di regola rompe il test.

- [ ] **Step 3: Far ritornare l'esito da `run_archive` e registrarlo**

In `src/main.py`, aggiungi l'import in cima:

```python
from state import StateStore, classify_archive_outcome
```

Nel costruttore della classe applicativa (`__init__`), aggiungi:

```python
        self.state = StateStore()
```

In `run_archive`, all'inizio del metodo:

```python
        avviato_il = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        connesso = False
        bytes_caricati = 0
```

(aggiungi `timezone` all'import esistente di `datetime` se manca: `from datetime import datetime, timedelta, timezone`)

Sostituisci il ramo di uscita anticipata quando non c'è nulla da archiviare:

```python
        if not records:
            logger.info("No archives created")
            if auto_cleanup and not dry_run:
                self._auto_cleanup_local(backend)
            return
```

con:

```python
        if not records:
            logger.info("Nessun archivio da creare")
            if auto_cleanup and not dry_run:
                self._auto_cleanup_local(backend)
            self._registra_esito_archive(avviato_il, 'success', 0, 0, 0, 0, None)
            return 'success'
```

Sostituisci il ramo di connessione fallita:

```python
            if not backend.connect():
                logger.error(f"Backend {backend.type_name} connect failed; abort transfer")
                return
```

con:

```python
            if not backend.connect():
                messaggio = f"Backend {backend.type_name} non raggiungibile: trasferimento annullato"
                logger.error(messaggio)
                self._registra_esito_archive(
                    avviato_il, 'failed', len(records), 0, len(records), 0, messaggio
                )
                return 'failed'
            connesso = True
```

Dopo il ciclo di upload, sostituisci la coda del metodo:

```python
            logger.info(f"Transfer complete: {successful} successful, {failed} failed")

            if auto_cleanup and successful > 0:
                self._auto_cleanup_local(backend)

        logger.info("Archive cycle complete")
```

con:

```python
            logger.info(f"Trasferimento completato: {successful} riusciti, {failed} falliti")

            if auto_cleanup and successful > 0:
                self._auto_cleanup_local(backend)

        esito = classify_archive_outcome(connesso or dry_run, len(records), successful, failed)
        self._registra_esito_archive(
            avviato_il, esito, len(records), successful, failed, bytes_caricati, None
        )
        logger.info(f"Ciclo di archiviazione concluso: esito {esito}")
        return esito
```

Aggiungi il metodo di registrazione subito dopo `run_archive`:

```python
    def _registra_esito_archive(self, avviato_il, esito, creati, caricati,
                                falliti, byte_caricati, errore):
        """Scrive nel file di stato l'esito del ciclo di archiviazione."""
        try:
            self.state.update_section('archive', {
                'last_started_at': avviato_il,
                'last_finished_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'outcome': esito,
                'archives_created': creati,
                'uploaded': caricati,
                'failed': falliti,
                'bytes_uploaded': byte_caricati,
                'error': errore,
            })
        except Exception as e:
            # Lo stato è osservabilità: un suo problema non deve far fallire l'archiviazione.
            logger.warning(f"Impossibile aggiornare il file di stato: {e}")
```

- [ ] **Step 4: Registrare anche retention e verify**

In `run_retention`, dopo il calcolo del report, aggiungi:

```python
        try:
            self.state.update_section('retention', {
                'last_finished_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'outcome': 'success' if report.errors_count == 0 else 'failed',
                'local_files_deleted': report.local_files_deleted,
                'space_freed_mb': round(report.local_space_freed / (1024 * 1024), 2),
                'errors_count': report.errors_count,
                'error': None,
            })
        except Exception as e:
            logger.warning(f"Impossibile aggiornare il file di stato: {e}")
```

Adatta i nomi degli attributi a quelli reali del report (leggi `src/retention.py`, il dict `to_dict` usa `local_files_deleted`, `local_space_freed`, `errors_count`).

In `verify_integrity`, dopo aver ottenuto `(valid, results)`:

```python
        try:
            self.state.update_section('verify', {
                'last_finished_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                'outcome': 'success' if valid else 'failed',
                'manifest_chain_valid': results.get('manifest_chain_valid', False),
                'archives_checked': results.get('archives_checked', 0),
                'archives_valid': results.get('archives_valid', 0),
                'errors': results.get('chain_errors', []),
            })
        except Exception as e:
            logger.warning(f"Impossibile aggiornare il file di stato: {e}")
```

- [ ] **Step 5: Far uscire `main()` con codice diverso da zero**

In `main()`, sostituisci:

```python
        if args.command == 'archive':
            app.run_archive(dry_run=args.dry_run, auto_cleanup=not args.no_cleanup)
```

con:

```python
        if args.command == 'archive':
            esito = app.run_archive(dry_run=args.dry_run, auto_cleanup=not args.no_cleanup)
            # Prima di questa modifica il comando usciva sempre con 0, anche con il
            # NAS irraggiungibile: systemctl riportava "success" senza aver replicato nulla.
            sys.exit(0 if esito == 'success' else 1)
```

- [ ] **Step 6: Verifica**

Run: `python3 -m unittest discover -s tests -v` → PASS.
Run: `python3 -c "import sys; sys.path.insert(0,'src'); import main"` → nessun errore.

- [ ] **Step 7: Commit**

```bash
git add src/main.py tests/test_outcome_exit.py
git commit -m "fix(archive): esito reale registrato nello stato e propagato all'exit code

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Il comando che rinfresca lo stato vivo

**Files:**
- Modify: `src/main.py` (nuovo flag `--write-state` su `status`)

**Interfaces:**
- Consumes: `StateStore.update_live`, `StateStore.update_retention_policy`.
- Produces: `wazuh-immutable-store status --write-state` aggiorna `backend`, `local_disk`, `archives`, `schedule`, `retention_policy` senza stampare nulla.

- [ ] **Step 1: Aggiungere il flag all'argparse**

Nel parser del comando `status` in `main()`:

```python
    status_parser.add_argument(
        '--write-state', action='store_true',
        help='Aggiorna il file di stato senza stampare a schermo (uso: timer di rinfresco)'
    )
```

- [ ] **Step 2: Implementare la raccolta**

Aggiungi alla classe applicativa:

```python
    def write_live_state(self) -> None:
        """
        Aggiorna le parti vive del file di stato.

        Tutti i dati provengono da dizionari già calcolati altrove: qui si
        raccolgono e si serializzano, senza logica nuova.
        """
        backend_info = {}
        disco_locale = {}
        archivi = {}

        try:
            backend = get_backend(self.models['storage'], self.models['retention'].remote)
            raggiungibile, messaggio = backend.health_check()
            uso = backend.get_disk_usage() or {}
            backend_info = {
                'type': backend.type_name,
                'reachable': bool(raggiungibile),
                'message': messaggio,
                'destination': str(backend.local_mount_point) if backend.local_mount_point else None,
                'disk': uso,
            }
        except Exception as e:
            backend_info = {'reachable': False, 'message': f"Backend non interrogabile: {e}"}

        try:
            import shutil
            uso_locale = shutil.disk_usage('/')
            disco_locale = {
                'size_gb': round(uso_locale.total / (1024 ** 3), 1),
                'used_gb': round(uso_locale.used / (1024 ** 3), 1),
                'available_gb': round(uso_locale.free / (1024 ** 3), 1),
                'use_percent': round(uso_locale.used * 100 / uso_locale.total),
            }
        except Exception as e:
            logger.warning(f"Spazio disco locale non leggibile: {e}")

        try:
            recovery = RecoveryManager(
                self.models['archive'].temp_dir,
                self._mount_point(),
                self.models['gpg'],
            )
            stat = recovery.get_recovery_statistics()
            archivi = {
                'total': stat['total_archives'],
                'total_size_gb': stat['total_size_gb'],
                'with_signature': stat['with_signature'],
                'with_checksum': stat['with_checksum'],
                'oldest': stat['date_range']['oldest'],
                'newest': stat['date_range']['newest'],
            }
        except Exception as e:
            logger.warning(f"Statistiche archivi non disponibili: {e}")

        pianificazione = {'archive_interval': str(self.models['archive'].interval)}

        self.state.update_live(backend_info, disco_locale, archivi, pianificazione)
        self.state.update_retention_policy({
            'remote_days': self.models['retention'].remote.days,
            'mode': backend_info.get('type'),
        })
```

Adatta la costruzione di `RecoveryManager` alla firma reale (leggi come lo costruisce `list_archives` in `main.py`) e `self.models['archive'].interval` al nome reale del campo in `models.py`.

- [ ] **Step 3: Collegare il flag**

Nel dispatch di `main()`, nel ramo `status`:

```python
        elif args.command == 'status':
            if getattr(args, 'write_state', False):
                app.write_live_state()
            else:
                app.run_status()
```

- [ ] **Step 4: Verifica manuale**

Run (in locale, con una config di prova o accettando che il backend non risponda):
```bash
python3 src/main.py --config config/config.yaml.example status --write-state ; echo "exit=$?"
```
Expected: exit 0, nessuna eccezione. Il file di stato non sarà scrivibile in `/var/lib/...` senza privilegi: verifica invece con `STATE_PATH` puntato altrove modificando temporaneamente `DEFAULT_STATE_PATH`, oppure esegui il test con `sudo` su una macchina di prova. Annota nel report quale delle due strade hai usato.

- [ ] **Step 5: Commit**

```bash
git add src/main.py
git commit -m "feat(state): comando status --write-state per il rinfresco periodico

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Il server di stato

**Files:**
- Create: `src/status_server.py`
- Modify: `src/main.py` (comando `serve`)
- Test: `tests/test_status_server.py`

**Interfaces:**
- Consumes: `StateStore.read()` dal Task 2.
- Produces: `run_status_server(state_path: Path, token: str, certfile: str, keyfile: str, host: str = '0.0.0.0', port: int = 9443) -> None`; `build_handler(state_path: Path, token: str)` (fabbrica testabile senza TLS).

- [ ] **Step 1: Scrivere i test**

Crea `tests/test_status_server.py`:

```python
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'src'))

from status_server import build_handler

TOKEN = 'token-di-prova'


class TestStatusServer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.state_path = Path(cls.tmp.name) / 'state.json'
        cls.state_path.write_text(json.dumps({'schema_version': 1, 'host': 'srv-test'}))
        handler = build_handler(cls.state_path, TOKEN)
        cls.server = HTTPServer(('127.0.0.1', 0), handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.tmp.cleanup()

    def _get(self, path, token=None):
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}')
        if token:
            req.add_header('Authorization', f'Bearer {token}')
        return urllib.request.urlopen(req, timeout=5)

    def test_health_non_richiede_token(self):
        r = self._get('/health')
        self.assertEqual(r.status, 200)
        self.assertEqual(json.loads(r.read())['status'], 'ok')

    def test_status_senza_token_e_negato(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._get('/status')
        self.assertEqual(ctx.exception.code, 401)

    def test_status_con_token_sbagliato_e_negato(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._get('/status', token='sbagliato')
        self.assertEqual(ctx.exception.code, 401)

    def test_status_con_token_giusto_ritorna_lo_stato(self):
        r = self._get('/status', token=TOKEN)
        self.assertEqual(r.status, 200)
        self.assertEqual(json.loads(r.read())['host'], 'srv-test')

    def test_percorso_sconosciuto_e_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._get('/../etc/passwd', token=TOKEN)
        self.assertIn(ctx.exception.code, (400, 404))

    def test_post_non_e_ammesso(self):
        req = urllib.request.Request(
            f'http://127.0.0.1:{self.port}/status', data=b'{}', method='POST')
        req.add_header('Authorization', f'Bearer {TOKEN}')
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        self.assertIn(ctx.exception.code, (404, 405))


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2: Eseguire i test e vederli fallire**

Run: `python3 -m unittest tests.test_status_server -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'status_server'`

- [ ] **Step 3: Implementare `src/status_server.py`**

```python
"""
Server di sola lettura per il file di stato.

Deliberatamente stupido: non calcola nulla, non esegue comandi, non accede a
mount o log. Legge un file JSON e lo restituisce. Questo permette di eseguirlo
come utente non privilegiato su una macchina indurita.
"""
import hmac
import json
import logging
import ssl
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

logger = logging.getLogger('wazuh-immutable-store.status-server')

MAX_BODY = 0  # nessun corpo accettato


def build_handler(state_path: Path, token: str):
    """Fabbrica il gestore delle richieste legato a un file di stato e a un token."""

    class StatusHandler(BaseHTTPRequestHandler):
        server_version = 'wazuh-immutable-store-status'
        sys_version = ''

        def _json(self, code: int, payload: dict) -> None:
            corpo = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(corpo)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(corpo)

        def _autorizzato(self) -> bool:
            intestazione = self.headers.get('Authorization', '')
            if not intestazione.startswith('Bearer '):
                return False
            fornito = intestazione[len('Bearer '):].strip()
            # Confronto a tempo costante: evita di distinguere i token per tempistica.
            return hmac.compare_digest(fornito, token)

        def do_GET(self):  # noqa: N802 (nome imposto da BaseHTTPRequestHandler)
            if self.path == '/health':
                self._json(200, {'status': 'ok', 'schema_version': 1})
                return
            if self.path == '/status':
                if not self._autorizzato():
                    self._json(401, {'error': 'token mancante o non valido'})
                    return
                try:
                    with open(state_path, 'r', encoding='utf-8') as fh:
                        self._json(200, json.load(fh))
                except FileNotFoundError:
                    self._json(503, {'error': 'stato non ancora disponibile'})
                except Exception:
                    # Nessun dettaglio verso l'esterno: potrebbe rivelare percorsi.
                    logger.exception('Lettura dello stato fallita')
                    self._json(500, {'error': 'stato illeggibile'})
                return
            self._json(404, {'error': 'non trovato'})

        def log_message(self, format, *args):
            # Log essenziale su stdout (journald), senza intestazioni: il token
            # non deve mai finire nei log.
            logger.info('%s %s', self.command, self.path)

    return StatusHandler


def run_status_server(state_path: Path, token: str, certfile: str, keyfile: str,
                      host: str = '0.0.0.0', port: int = 9443) -> None:
    """Avvia il server HTTPS. Non ritorna."""
    if not token:
        raise ValueError('Token del server di stato non configurato')
    handler = build_handler(Path(state_path), token)
    httpd = HTTPServer((host, port), handler)
    contesto = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    contesto.load_cert_chain(certfile=certfile, keyfile=keyfile)
    contesto.minimum_version = ssl.TLSVersion.TLSv1_2
    httpd.socket = contesto.wrap_socket(httpd.socket, server_side=True)
    logger.info(f"Server di stato in ascolto su https://{host}:{port}")
    httpd.serve_forever()
```

- [ ] **Step 4: Eseguire i test e vederli passare**

Run: `python3 -m unittest tests.test_status_server -v`
Expected: PASS (6 test)

- [ ] **Step 5: Aggiungere il comando `serve` in `main.py`**

Nell'argparse:

```python
    serve_parser = subparsers.add_parser('serve', help='Espone lo stato via HTTPS (sola lettura)')
    serve_parser.add_argument('--host', default='0.0.0.0')
    serve_parser.add_argument('--port', type=int, default=9443)
    serve_parser.add_argument('--cert', default='/etc/wazuh-immutable-store/status-cert.pem')
    serve_parser.add_argument('--key', default='/etc/wazuh-immutable-store/status-key.pem')
    serve_parser.add_argument('--token-file', default='/etc/wazuh-immutable-store/status-token')
    serve_parser.add_argument('--state', default='/var/lib/wazuh-immutable-store/state.json')
```

Nel dispatch, **prima** del caricamento della configurazione (il server non ne ha bisogno, e questo gli permette di girare senza accesso a `config.yaml`):

```python
    if args.command == 'serve':
        from status_server import run_status_server
        try:
            token = Path(args.token_file).read_text(encoding='utf-8').strip()
        except Exception as e:
            print(f"Errore: token non leggibile da {args.token_file}: {e}")
            sys.exit(1)
        run_status_server(Path(args.state), token, args.cert, args.key, args.host, args.port)
        sys.exit(0)
```

Posiziona questo blocco accanto a quelli di `setup` e `menu`, che già precedono `app.load_config()`.

- [ ] **Step 6: Verifica**

Run: `python3 -m unittest discover -s tests -v` → PASS (tutti i test).

- [ ] **Step 7: Commit**

```bash
git add src/status_server.py src/main.py tests/test_status_server.py
git commit -m "feat(state): endpoint HTTPS di sola lettura per lo stato

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Unit systemd e script di installazione

**Files:**
- Create: `systemd/wazuh-immutable-store-status.service`
- Create: `systemd/wazuh-immutable-store-refresh.service`, `systemd/wazuh-immutable-store-refresh.timer`
- Create: `scripts/install-status-endpoint.sh`

**Interfaces:**
- Consumes: comandi `serve` e `status --write-state` dai Task 4 e 5.
- Produces: servizio `wazuh-immutable-store-status.service` attivo come utente `wis-status`; timer di rinfresco ogni 5 minuti.

- [ ] **Step 1: Unit del server**

`systemd/wazuh-immutable-store-status.service`:

```ini
[Unit]
Description=Wazuh Immutable Store - endpoint di stato (sola lettura)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wis-status
Group=wis-status
ExecStart=/usr/local/bin/wazuh-immutable-store serve
Restart=on-failure
RestartSec=10
SyslogIdentifier=wazuh-immutable-store-status

# Il server legge un solo file e non esegue nulla: si può stringere parecchio.
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6
MemoryDenyWriteExecute=yes
ReadOnlyPaths=/var/lib/wazuh-immutable-store /etc/wazuh-immutable-store /opt/wazuh-immutable-store

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Unit e timer di rinfresco**

`systemd/wazuh-immutable-store-refresh.service`:

```ini
[Unit]
Description=Wazuh Immutable Store - rinfresco dello stato

[Service]
Type=oneshot
User=root
ExecStart=/usr/local/bin/wazuh-immutable-store status --write-state
SyslogIdentifier=wazuh-immutable-store-refresh
```

`systemd/wazuh-immutable-store-refresh.timer`:

```ini
[Unit]
Description=Rinfresca lo stato del Wazuh Immutable Store ogni 5 minuti

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 3: Script di installazione**

`scripts/install-status-endpoint.sh`:

```bash
#!/usr/bin/env bash
# Installa l'endpoint di stato: utente dedicato, certificato, token, unit systemd.
# Idempotente: rieseguirlo non rigenera token né certificato se già presenti.
set -euo pipefail

STATE_DIR="/var/lib/wazuh-immutable-store"
CONF_DIR="/etc/wazuh-immutable-store"
CERT="$CONF_DIR/status-cert.pem"
KEY="$CONF_DIR/status-key.pem"
TOKEN_FILE="$CONF_DIR/status-token"
UTENTE="wis-status"

[[ $EUID -eq 0 ]] || { echo "Serve root"; exit 1; }

id -u "$UTENTE" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$UTENTE"

mkdir -p "$STATE_DIR" "$CONF_DIR"
chown root:"$UTENTE" "$STATE_DIR"
chmod 750 "$STATE_DIR"

if [[ ! -f "$TOKEN_FILE" ]]; then
  head -c 32 /dev/urandom | base64 | tr -d '\n=' | tr '+/' '-_' > "$TOKEN_FILE"
  echo "Token generato in $TOKEN_FILE"
fi
chown root:"$UTENTE" "$TOKEN_FILE"
chmod 640 "$TOKEN_FILE"

if [[ ! -f "$CERT" ]]; then
  openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
    -keyout "$KEY" -out "$CERT" \
    -subj "/CN=$(hostname)/O=wazuh-immutable-store" \
    -addext "subjectAltName=IP:$(hostname -I | awk '{print $1}')"
  echo "Certificato generato in $CERT"
fi
chown root:"$UTENTE" "$CERT" "$KEY"
chmod 640 "$CERT" "$KEY"

install -m 644 systemd/wazuh-immutable-store-status.service /etc/systemd/system/
install -m 644 systemd/wazuh-immutable-store-refresh.service /etc/systemd/system/
install -m 644 systemd/wazuh-immutable-store-refresh.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wazuh-immutable-store-refresh.timer
systemctl enable --now wazuh-immutable-store-status.service

echo
echo "Fatto. Impronta del certificato da configurare in DA-IPAM:"
openssl x509 -in "$CERT" -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 -binary | base64
echo "Token: $(cat "$TOKEN_FILE")"
echo
echo "Ricorda di aprire la porta 9443 SOLO verso l'IP del DA-IPAM, ad esempio:"
echo "  ufw allow from <IP-DA-IPAM> to any port 9443 proto tcp"
```

Rendilo eseguibile: `chmod +x scripts/install-status-endpoint.sh`

- [ ] **Step 4: Verifica sintattica**

Run: `bash -n scripts/install-status-endpoint.sh` → nessun output.
Run: `systemd-analyze verify systemd/wazuh-immutable-store-status.service` se disponibile in locale; altrimenti la verifica avviene sul target al Task 7.

- [ ] **Step 5: Commit**

```bash
git add systemd/ scripts/install-status-endpoint.sh
git commit -m "feat(state): unit systemd e script di installazione dell'endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Installazione sulle due macchine e verifica reale

**Files:** nessuna modifica al codice. Deploy e verifica.

**Interfaces:**
- Consumes: tutto il lavoro dei Task 1-6.
- Produces: endpoint attivo su entrambe le installazioni; impronta del certificato e token annotati per la Fase 2.

- [ ] **Step 1: Domarc — copiare e installare**

```bash
# Dal repository locale, sincronizza i sorgenti (ATTENZIONE: -r, altrimenti storage_backends/ resta fuori)
rsync -av --delete src/ root@192.168.4.19:/opt/wazuh-immutable-store/ \
  -e "ssh -J root@192.168.40.4"
rsync -av systemd/ scripts/install-status-endpoint.sh root@192.168.4.19:/tmp/wis-install/ \
  -e "ssh -J root@192.168.40.4"
ssh -J root@192.168.40.4 root@192.168.4.19 \
  'cd /tmp/wis-install && bash install-status-endpoint.sh'
```

Annota impronta e token stampati: servono alla Fase 2.

- [ ] **Step 2: Domarc — verificare**

```bash
ssh -J root@192.168.40.4 root@192.168.4.19 '
  systemctl is-active wazuh-immutable-store-status.service
  systemctl list-timers --no-pager | grep refresh
  curl -sk https://127.0.0.1:9443/health
  echo
  curl -sk -H "Authorization: Bearer $(cat /etc/wazuh-immutable-store/status-token)" \
    https://127.0.0.1:9443/status | head -c 400
'
```
Expected: servizio `active`, `/health` risponde `{"status":"ok",...}`, `/status` restituisce il JSON dello stato.

- [ ] **Step 3: Duerre — finestra sudo**

L'utente `dts` non ha sudo passwordless. Con l'operatore presente:

```bash
# Sull'host Duerre, con privilegi amministrativi (una tantum):
usermod -aG sudo dts        # oppure una regola mirata in /etc/sudoers.d/
```

Poi ripeti gli Step 1 e 2 con `ssh dts@172.16.1.10` e `sudo` davanti ai comandi che lo richiedono.

- [ ] **Step 4: Duerre — rimuovere il privilegio (obbligatorio)**

```bash
ssh dts@172.16.1.10 'sudo deluser dts sudo && id dts'
```
Expected: nell'output di `id` **non** deve più comparire il gruppo `sudo`. Questo passo non è opzionale: annota l'esito nel report.

- [ ] **Step 5: Prova negativa — il caso che oggi passa silenzioso**

Su **una sola** delle due installazioni, con l'operatore d'accordo:

```bash
# Smonta temporaneamente la destinazione
umount /mnt/qnap-wazuh
# Forza un ciclo di archiviazione
/usr/local/bin/wazuh-immutable-store archive ; echo "exit=$?"
# Rileggi lo stato
curl -sk -H "Authorization: Bearer $(cat /etc/wazuh-immutable-store/status-token)" \
  https://127.0.0.1:9443/status | python3 -m json.tool | head -30
# Rimonta
mount /mnt/qnap-wazuh
```
Expected: `exit=1` (prima era sempre 0), `runs.archive.outcome` uguale a `failed`, `backend.reachable` falso. È la verifica che dimostra che il difetto è chiuso.

- [ ] **Step 6: Aprire il firewall verso il DA-IPAM corrispondente**

Domarc: consentire `192.168.4.8` verso la porta 9443. Duerre: consentire `172.16.0.2`. Verifica dalla macchina DA-IPAM:

```bash
curl -sk https://<ip-wazuh>:9443/health
```

- [ ] **Step 7: Riepilogo per la Fase 2**

Annota in un file locale (non nel repository): per ciascuna installazione l'URL dell'endpoint, il token e l'impronta SPKI del certificato. Serviranno per configurare DA-IPAM.

---

## Fuori scope

Completamento dei backend `generic-nfs` e `s3-compatible` (retention, cleanup locale, comandi di lettura, `boto3`, credenziali systemd): lavoro separato, oggi bloccato dalla guardia del Task 1.

# Monitoraggio Wazuh e repliche immutabili da DA-IPAM

> Design approvato 2026-07-29. Copre due repository (`WazuhIStore_imm` e `DA-IPAM`) e due installazioni.
> Stato: spec → piani di implementazione.

## 1. Problema

Oggi DA-IPAM mostra gli **alert** di Wazuh ma non sa nulla della **salute** dell'infrastruttura che li produce: se un demone del manager è fermo, se l'indexer sta esaurendo lo spazio, se l'ingestione è in ritardo. Soprattutto, non sa nulla della **replica verso lo storage immutabile**, che è il dato con valore di compliance.

Il programma di replica (`wazuh-immutable-store`) non è osservabile dall'esterno: nessun endpoint, nessuna metrica, nessun file di stato del ciclo di archiviazione, log non strutturati su journald.

**Difetto che rende il problema urgente**: `archive` esce **sempre con codice 0**. In `main.py:294-296` un backend irraggiungibile provoca un `return`, non un errore; in `main.py:303-307` gli upload falliti vengono contati e loggati ma non alterano l'esito. Quindi `systemctl status` riporta `success` anche quando non è stato replicato nulla — condizione osservata su Duerre il 2026-07-29 (ultimo run "success", esito reale ignoto).

## 2. Ambito: due installazioni

| Installazione | Wazuh | DA-IPAM | Accesso all'host Wazuh |
|---|---|---|---|
| **Duerre** | `172.16.1.10` (`srv-wazuh`) | `172.16.0.2` | utente `dts`, **non root**, sudo non passwordless |
| **Domarc** | `192.168.4.19` (`da-wazuh`) | `192.168.4.8` (VM 533) | root via jump `192.168.40.4` |

Entrambe eseguono la **v1** del programma (nessuna `storage_backends/`), con timer attivi: archiviazione oraria, retention giornaliera, verifica settimanale.

### 2.1 Consolidamento su un'unica base di codice (prerequisito)

Il repository contiene due copie: `wazuh-immutable-store/` (v1) e `wazuh-immutable-store-v2/`. Analisi del 2026-07-29:

- Sono **cloni dello stesso repo fermi sullo stesso commit** `17152bb`. La v2 **non è un branch né un commit**: è lavoro nel working tree, con `src/storage_backends/` **non tracciata da git**. Un `git clean` la cancellerebbe. Metterla al sicuro è il primo passo, prima di ogni altra cosa.
- La v2 aggiunge un'astrazione dei backend (QNAP NFS, NFS generico, S3-compatibile con Object Lock); la v1 aveva la destinazione cablata su QNAP.
- **Retro-compatibile**: senza sezione `storage:` in `config.yaml` la v2 ricade sul QNAP legacy; CLI, unit systemd, layout remoto, firma e hash chain sono invariati e gli archivi prodotti dalla v1 restano verificabili.
- **Due regressioni reali sul percorso NFS**, cioè quello in uso: persa la logica di **retry con backoff** (v1: 3 tentativi; v2: tentativo singolo, poi `failed`) e perso il concetto di coda (`TransferManager` non è più usato da `main.py`).
- I backend non-QNAP sono **incompleti**: con S3 la retention va in `AttributeError` (`retention.py:211` su `mount_point` nullo), la pulizia dei log locali non avviene mai (disco che si riempie), i comandi di lettura ignorano il backend, `boto3` non è dichiarato in `requirements.txt` e le credenziali non arrivano al servizio systemd. Il wizard va in `KeyError` se il test di connessione fallisce e l'operatore risponde "no".
- Nessuna delle due versioni ha test; la documentazione non menziona i backend nuovi.

**Decisione**: si consolida **sulla v2 come unica base di codice**, con tre condizioni preliminari:

1. committare il lavoro v2 (oggi a rischio di perdita);
2. **ripristinare il retry con backoff** sul percorso di upload — è una regressione su ciò che gira ogni ora su entrambe le installazioni;
3. **dichiarare non pronti** i backend `generic-nfs` e `s3-compatible` con un controllo all'avvio che rifiuta di partire con un messaggio esplicito, invece di fallire a metà run. Completarli è un lavoro separato che non deve bloccare il monitoraggio.

L'aggiornamento delle due installazioni avviene a configurazione invariata. Unica accortezza operativa: copiare ricorsivamente `src/` (un `cp` senza `-r` lascerebbe `storage_backends/` fuori e ogni comando fallirebbe con `ImportError`).

Ogni DA-IPAM punta al proprio Wazuh e al proprio endpoint di stato: la configurazione è per installazione, come già avviene per l'integrazione Wazuh (settings a livello hub).

## 3. Il contratto: `state.json`

Il programma scrive `/var/lib/wazuh-immutable-store/state.json` in modo **atomico** (scrittura su file temporaneo nella stessa directory + `rename`), con permessi `0640` e proprietario `root:wis-status`.

Viene riscritto:
- alla fine di **ogni run** (`archive`, `retention`, `verify`), aggiornando la sezione corrispondente;
- ogni **5 minuti** da un timer leggero (`status --write-state`) che aggiorna solo le parti vive: raggiungibilità del backend, spazio della destinazione, spazio del disco locale, statistiche archivi.

```json
{
  "schema_version": 1,
  "generated_at": "2026-07-29T10:22:57Z",
  "host": "srv-wazuh",
  "backend": {
    "type": "qnap-nfs",
    "reachable": true,
    "message": "NFS mount attivo su /mnt/qnap-wazuh",
    "destination": "/mnt/qnap-wazuh",
    "disk": { "size_gb": 3720.0, "used_gb": 1210.4, "available_gb": 2509.6, "use_percent": 33 }
  },
  "local_disk": { "size_gb": 292.0, "used_gb": 160.0, "available_gb": 121.0, "use_percent": 57 },
  "runs": {
    "archive":   { "last_started_at": "…", "last_finished_at": "…", "outcome": "success|partial|failed|never",
                   "archives_created": 3, "uploaded": 3, "failed": 0, "bytes_uploaded": 184320000,
                   "duration_seconds": 42, "error": null },
    "retention": { "last_finished_at": "…", "outcome": "success", "local_files_deleted": 12,
                   "space_freed_mb": 850.2, "errors_count": 0, "error": null },
    "verify":    { "last_finished_at": "…", "outcome": "success", "manifest_chain_valid": true,
                   "archives_checked": 512, "archives_valid": 512, "errors": [] }
  },
  "archives": {
    "total": 512, "total_size_gb": 41.7, "with_signature": 512, "with_checksum": 512,
    "oldest": "2026-01-02T02:00:00Z", "newest": "2026-07-29T09:11:43Z"
  },
  "retention_policy": { "remote_days": 2555, "mode": "worm-firmware", "lock_until": null },
  "schedule": { "archive_interval": "hourly", "next_archive_at": "2026-07-29T10:22:57Z" }
}
```

Note sui campi:
- `outcome` di `archive`: `success` se tutti gli upload sono riusciti, `partial` se almeno uno è fallito, `failed` se il backend non era raggiungibile o non è stato prodotto nulla per errore, `never` se non è mai girato.
- `archives.newest` è l'indicatore primario del ritardo: è l'unico dato che dimostra che qualcosa è **davvero** arrivato a destinazione.
- Tutte le informazioni provengono da dizionari già calcolati oggi: `TransferManager.check_connectivity()` (`transfer.py:481-507`), `RecoveryManager.get_recovery_statistics()` (`recovery.py:527-546`), `SigningManager.verify_all_integrity()` (`signer.py:495-518`), report retention (`retention.py:55-67`).

### 3.1 Correzione dell'esito silenzioso

`archive` deve terminare con **codice diverso da zero** quando il backend non è raggiungibile o quando `failed > 0`, e registrare l'esito reale in `state.json`. Stessa regola per `retention` in caso di errori. È un intervento di correttezza, non cosmetico: senza, ogni monitoraggio a valle eredita la bugia.

## 4. L'endpoint di stato

Nuovo comando `serve`: server HTTPS **di sola lettura** che espone esclusivamente il file di stato.

- `GET /health` → `200 {"status":"ok","schema_version":1}` senza autenticazione (per il probe di raggiungibilità).
- `GET /status` → contenuto di `state.json`, richiede `Authorization: Bearer <token>`.
- Nessun altro percorso; qualsiasi altra richiesta → `404`. Nessun metodo oltre `GET`.

Vincoli di sicurezza, dato che gira su una macchina indurita:
- **Non calcola nulla**: legge solo `state.json`. Nessun accesso a mount, log, `/var/ossec`.
- Gira come utente dedicato **non privilegiato** (`wis-status`), unit systemd con `ProtectSystem=strict`, `PrivateTmp=yes`, `NoNewPrivileges=yes`, `ReadOnlyPaths=/var/lib/wazuh-immutable-store`.
- TLS con certificato auto-firmato generato all'installazione; DA-IPAM lo blocca al primo contatto con **pinning SPKI**, come già fa con Scanner-Edge (`scanner-edge-client.ts:42 probePinTls`).
- Token casuale generato all'installazione, salvato in `/etc/wazuh-immutable-store/status-token` (`0640`, `root:wis-status`).
- Porta predefinita `9443`, indirizzo di ascolto configurabile; regola di firewall che ammette **solo l'IP del DA-IPAM** corrispondente.

## 5. Cosa raccoglie DA-IPAM

Nuovo modulo `src/lib/integrations/wazuh-health.ts`, con cache in memoria di 60 secondi per tenant (stesso schema di `src/lib/modules/health.ts`) e timeout per probe di 8 secondi. Quattro blocchi, ciascuno con verdetto `ok | degraded | fail` e messaggio in italiano:

| Blocco | Sorgente | Contenuto |
|---|---|---|
| **Manager** | `GET /manager/status` (client esistente `wazuh-api.ts`) | stato di ciascun demone; elenco di quelli non in esecuzione |
| **Indexer** | `GET _cluster/health` + `GET _cat/allocation?format=json` (client `wazuh-indexer-api.ts`) | colore del cluster, nodi, spazio usato/disponibile per nodo |
| **Ingestione** | `GET /manager/stats/analysisd` + timestamp dell'alert più recente | eventi processati e scartati, riempimento code, ritardo rispetto a ora |
| **Repliche** | `GET /status` dell'endpoint nuovo | tutto il contenuto di `state.json` |

Un probe che fallisce produce il verdetto `fail` di quel blocco senza abbattere gli altri (`Promise.allSettled`, come `health.ts:403`).

**Il disco della macchina Wazuh non è esposto dall'API del manager**: arriva dal campo `local_disk` dell'endpoint di stato, che gira su quello stesso host. Un solo meccanismo invece di due.

### 5.1 Configurazione

Tre chiavi nuove nelle impostazioni hub, accanto a quelle Wazuh esistenti (`wazuh-config.ts:33-41`): `integration_immutable_store_url`, `integration_immutable_store_token_encrypted` (cifrato con `encrypt()`, letto con `safeDecrypt()`), `integration_immutable_store_cert_pin`. L'assenza dell'URL disattiva il solo blocco Repliche, senza toccare il resto.

### 5.2 API

- `GET /api/integrations/wazuh/health` — `requireAuth`, risponde dalla cache.
- `POST /api/integrations/wazuh/health` — `requireAdmin`, forza un nuovo probe.

## 6. Come si vede

Una **fascia di stato in testa alla pagina Alert sicurezza** (`src/app/(dashboard)/security-alerts/security-alerts-client.tsx`), sopra i grafici esistenti: quattro riquadri a semaforo, uno per blocco, ciascuno con il dato che conta più della metrica generica —

- Manager: *"tutti i demoni attivi"* oppure *"analysisd fermo"*;
- Indexer: *"cluster verde · 62% di 1,8 TB"*;
- Ingestione: *"allineata"* oppure *"in ritardo di 40 minuti"*;
- Repliche: *"ultima replica riuscita 1 ora fa"* oppure *"nessuna replica riuscita da 9 ore"*.

Ogni riquadro si espande mostrando il dettaglio (elenco demoni, spazio per nodo, esito dell'ultima verifica di integrità, scadenza del lock). L'aggiornamento riusa il ciclo di 60 secondi già presente in quella pagina: nessun meccanismo nuovo, nessun `setInterval` aggiuntivo.

Quando il blocco Repliche non è configurato, il riquadro invita a configurarlo con un collegamento alle impostazioni, invece di mostrare un errore.

## 7. Quando avvisa

Le soglie sono esplicite e poche:

| Condizione | Verdetto |
|---|---|
| Nessuna replica riuscita da oltre **2× l'intervallo pianificato** (minimo 3 ore) | errore |
| Ultimo run di archiviazione con `failed > 0` o `outcome != success` | errore |
| Verifica di integrità fallita (`manifest_chain_valid: false`) | errore |
| Disco (destinazione, host Wazuh, nodo indexer) oltre **85%** | degradato · oltre **95%** errore |
| Un demone del manager non in esecuzione | errore |
| Cluster indexer **rosso** | errore · **giallo** degradato |
| Alert più recente più vecchio di **30 minuti** | degradato |

La notifica passa dal sistema già usato per gli alert di sicurezza. Regola anti-rumore: si notifica **al cambio di verdetto** di un blocco, non a ogni ciclo; se la condizione persiste si ripete al massimo ogni **6 ore**; il rientro alla normalità produce una notifica di chiusura.

Lo stato precedente sta in una tabella tenant `wazuh_health_state` (singleton, come `wazuh_alert_sync_state`): verdetto per blocco, messaggio, orario dell'ultima notifica. La valutazione gira dentro il job `wazuh_alerts_sync` già schedulato, senza introdurre un nuovo tipo di job.

## 8. Verifica

- **Unit** sul modulo di salute: tabellari sulle soglie (ogni riga della tabella §7), con dati sintetici; probe fallito → `fail` isolato al suo blocco; endpoint repliche assente → blocco non configurato, non errore.
- **Unit** sulla logica anti-rumore: cambio di verdetto → notifica; stessa condizione entro 6 ore → nessuna; dopo 6 ore → ripetizione; rientro → notifica di chiusura.
- **Unit** sul programma di replica: serializzazione di `state.json` da dizionari sintetici; `outcome` corretto nei tre casi (tutto riuscito, parziale, backend irraggiungibile); scrittura atomica (il file non esiste mai in stato parziale).
- **Verifica reale** su entrambe le installazioni: confronto fra ciò che mostra la fascia di stato e ciò che si osserva a mano sull'host (`systemctl list-timers`, listing della destinazione, `df`). Le repliche di Duerre e Domarc sono attive: il primo confronto va fatto lì.
- **Prova negativa**, la più importante: smontare temporaneamente la destinazione su una delle due installazioni e verificare che il run successivo produca `outcome: failed`, che la fascia diventi rossa e che arrivi la notifica. È il caso che oggi passa silenzioso.

## 9. Fasi

| Fase | Contenuto | Repository |
|---|---|---|
| **0** | Consolidamento (§2.1): commit della v2, ripristino del retry, guardia sui backend non pronti | `WazuhIStore_imm` |
| **1** | `state.json`, correzione dell'esito silenzioso, comando `serve`, unit systemd, installazione su Duerre e Domarc | `WazuhIStore_imm` |
| **2** | Client, modulo di salute, API, fascia di stato, notifiche | `DA-IPAM` |

La fase 0 mette al sicuro codice oggi a rischio di perdita e va fatta per prima; la fase 1 definisce il contratto. Fase 0 e 1 possono stare in un unico piano; la fase 2 avrà il suo.

### 9.1 Accesso per l'installazione

Su **Domarc** l'accesso è root via jump host, nessun ostacolo. Su **Duerre** l'utente `dts` non ha sudo passwordless: per la finestra di installazione l'utente viene aggiunto temporaneamente ai sudoers e **rimosso al termine**. La rimozione fa parte della procedura, non è un passo opzionale: va verificata esplicitamente a fine deploy.

## 10. Fuori scope

- **Storico dei valori**: si mostra lo stato corrente. Niente serie temporali né grafici di andamento finché non emerge il bisogno dall'uso.
- **Stato degli agent** (attivi/disconnessi): il dato è già disponibile altrove nell'interfaccia.
- **Aggiornamento delle installazioni da v1 a v2**: decisione indipendente, non richiesta da questo lavoro.
- **Azioni correttive dall'interfaccia** (rilanciare una replica, liberare spazio): il cruscotto osserva, non interviene.

## 11. Rischi

- **Deployment su host indurita**: le due macchine hanno firewall e hardening; l'apertura della porta va fatta con regola per singolo IP. Su Duerre l'accesso è con utente non privilegiato senza sudo passwordless: l'installazione richiede una finestra concordata.
- **Divergenza v1/v2**: il repository contiene due copie che installano nello stesso percorso. Il modulo di stato va applicato a entrambe nello stesso momento, altrimenti la prossima installazione parte senza.
- **Falsi allarmi da soglie troppo strette**: le soglie di §7 sono un punto di partenza; vanno riviste dopo la prima settimana di esercizio con dati reali.

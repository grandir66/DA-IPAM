# Collector modulari (C1) — schema fisico proposto

**Data:** 22/10/2026 · **Stato:** proposta, nessuna tabella creata · **Accompagna:**
`docs/proposte/2026-10-22-collector-interfaccia.html` (oggetti 1-15).

Due tabelle additive nel **DB del tenant** (`db-tenant-schema.ts`, `CREATE TABLE IF NOT EXISTS`, come da
regola 10) e una chiave in `tenant_settings`. Nessuna colonna aggiunta a `network_devices`: quella tabella si
ricostruisce da `sqlite_master` (`devices/migra-apple-macos.ts`) e ogni colonna in più è un rischio.

## `acquisition_sources` — la fonte di raccolta di un apparato (C1.1)

```sql
CREATE TABLE IF NOT EXISTS acquisition_sources (
  device_id INTEGER PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  collector TEXT NOT NULL,                 -- id del catalogo (acquisition/catalogo.ts); niente CHECK: un collector nuovo non chiede di ricostruire la tabella
  ssh_credential_id   INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  snmp_credential_id  INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  api_credential_id   INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  winrm_credential_id INTEGER REFERENCES credentials(id) ON DELETE SET NULL,
  created_by INTEGER,                      -- hub.users.id, senza FK (DB diverso)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Una riga per apparato. Una colonna per protocollo (i protocolli sono quattro e fissi: `snmp`, `ssh`, `api`,
`winrm`). Le credenziali sono **riferimenti** all'archivio (ADR 0017): i segreti si risolvono nel backend con
`credentials/resolve.ts` al momento dell'acquisizione. Il codice controlla che il collector ammetta i protocolli
valorizzati (`descrittore(id).credenziali`) e che le credenziali siano fra quelle già assegnate all'apparato.
`ON DELETE SET NULL`: se una credenziale viene cancellata la fonte resta e l'acquisizione dice «credenziale
mancante» (stato 13 della proposta).

## `acquisition_snapshots` — gli snapshot salvati (C1.3)

```sql
CREATE TABLE IF NOT EXISTS acquisition_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  collector TEXT NOT NULL,
  collector_version TEXT NOT NULL,         -- semver del catalogo al momento della lettura
  schema_version TEXT NOT NULL,            -- '1.0'
  started_at TEXT NOT NULL,                -- ISO 8601 UTC, come collected_at dello snapshot
  finished_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,                    -- 'ok' | 'partial' | 'error' (validato dal codice con Zod)
  section_status TEXT NOT NULL,            -- JSON {"identity":"ok","vlans":"partial",...}, letto con JSON.parse in try-catch
  warning_count INTEGER NOT NULL DEFAULT 0,
  requested_by INTEGER,                    -- hub.users.id; NULL per un'avvio non umano (futuro)
  trigger TEXT NOT NULL DEFAULT 'manual',  -- niente CHECK: 'scheduled' arriverà senza ricostruire la tabella
  payload BLOB NOT NULL,                   -- JSON dello snapshot, gzip
  payload_bytes INTEGER NOT NULL,          -- dimensione prima della compressione
  payload_gzip_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,                    -- impronta del JSON non compresso (identifica, non protegge)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_acq_snap_device_time ON acquisition_snapshots(device_id, finished_at DESC);
```

Scelte e perché:

- **Immutabile.** Nessun `UPDATE` sul payload; solo `INSERT` e la cancellazione della retention.
- **Senza segreti.** Il payload è l'uscita già passata da `redactSnapshot` e da `snapshotSchema.parse`. Il
  codice di salvataggio rifiuta di scrivere ciò che non passa lo schema. Nessuna password, community o chiave
  in colonna: la credenziale usata sta in `acquisition_sources`, per riferimento.
- **JSON compresso** (D5), `zlib.gzipSync` (già usato in `backup/engine.ts`). La lista UI legge solo le
  colonne piccole (`status`, `section_status`, `duration_ms`, `payload_gzip_bytes`, `sha256`): il payload si
  decomprime solo quando si apre uno snapshot. Paginazione obbligatoria (regola 9): `getSnapshotsPaginated`.
- **Retention (D5)**, in `db.transaction()` subito dopo l'inserimento, per apparato: si tengono gli ultimi 20
  per `finished_at`, più il primo e l'ultimo con `status = 'ok'`; il resto si cancella. Un errore non spinge
  mai fuori l'ultimo snapshot riuscito.
- **Una sola acquisizione per apparato alla volta**: lucchetto in memoria (come le scansioni, ADR 0006);
  una seconda richiesta riceve 409. Se il processo cade a metà non resta nulla da pulire: lo snapshot si
  scrive solo a lettura finita.
- **Stato errore salvato?** Sì: un tentativo fallito (credenziale rifiutata, timeout) è un fatto da mostrare
  (riga «Errore» della tavola 1). L'exit 2 (parziale) si salva come `partial` e **non** innesca altre
  credenziali.
- **Niente tabelle per sezione** (`interfaces`, `vlans`…): in C1 lo snapshot si legge intero. Le proiezioni
  verso `switch_ports`, `device_neighbors` e `topology_port_facts` sono C2.

## Interruttore

`tenant_settings` chiave `acquisizione_modulare.attiva`: `"1"` = acceso, **assente o altro = spento**
(l'opposto di `patch.choco_automatico`, che è acceso di default). Stesso schema di
`chocoAutomaticoAccesoDb` / `impostaChocoAutomaticoDb`; scrittura solo admin.

## Rotte previste (non scritte)

| Rotta | Metodo | Guardia | Note |
| --- | --- | --- | --- |
| `/api/devices/[id]/acquisizione/fonte` | GET / PUT | auth / admin | `withTenantFromSession`; PUT valida collector e credenziali |
| `/api/devices/[id]/acquisizione` | POST | admin | lancia l'acquisizione; 409 se già in corso; 403 se interruttore spento |
| `/api/devices/[id]/acquisizione/snapshot` | GET | auth | elenco paginato (solo colonne piccole) |
| `/api/devices/[id]/acquisizione/snapshot/[sid]` | GET | auth; `?scarica=1` admin | payload decompresso |

Le rotte si aggiungono a `permessi/rotte.ts` e a `scripts/verifica-permessi.sh` nello stesso commit.

## Prove previste

Contesto tenant (nessuna scrittura fuori dalle due tabelle), guardie, credenziale assente o rifiutata,
parziale/timeout/403 del collector, crash a metà (nessuna riga, sessioni chiuse), retention (21° snapshot,
primo e ultimo `ok` conservati), nessun segreto nel payload salvato, apertura con interruttore spento.

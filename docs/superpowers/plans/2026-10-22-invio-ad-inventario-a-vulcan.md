# Invio di AD Health e inventario a DA-Vul-can (A-IPAM) — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** un'istanza DA-IPAM con `VULCAN_URL`/`VULCAN_TOKEN` in `/etc/dalink/oggetto.env`
invia all'hub DA-Vul-can l'export di ogni esecuzione AD Health riuscita e una fotografia
dell'inventario al giorno, con una coda che ritenta e un battito ogni 15 minuti; senza gettone non
parte niente, e la pagina «Cosa esce» dice sempre in che stato è il flusso.

**Architettura:** modulo nuovo `src/lib/vulcan/` accanto a `src/lib/dalink/`: lettura delle chiavi
dallo stesso `oggetto.env` (stesse regole di `config.ts`), costruttori del corpo come funzioni pure a
lista bianca, coda `vulcan_coda` nel DB del cliente (migrazione additiva col segno, modello
`upload_queue.py` della sonda), trasporto HTTPS con verifica TLS normale e corpo gzip, un timer di
processo (`server.ts`) per svuotare la coda, battere e accodare l'inventario. L'hub non chiama mai
DA-IPAM: tutto è push, e nessuna risposta cambia la configurazione.

**Spec:** DA-Vul-can `docs/superpowers/specs/2026-10-21-ad-sicurezza-e-documento-direzione-design.md`
§5 (5.2-5.7), §13, §15 riga A-IPAM; decisioni 3, 4, 6a. Contratto dell'hub: DA-Vul-can
`docs/operativo/contratto-ipam-hub.md` e piano `docs/superpowers/plans/2026-10-21-tappa-a2-istanze-ipam.md`
(il codice dell'hub vince sul testo).
**Livello di controllo:** completo (gettoni, dati del cliente che escono, chiamate verso l'esterno;
prompt di Riccardo del 22/10).
**Stato:** bozza · **Ultimo aggiornamento:** 2026-10-22

## Come viaggia l'AD oggi (verificato il 22/10 su `origin/dev` di DA-IPAM e `origin/HEAD` di DA-Vul-can)

«I dati AD vanno già» (Riccardo, 22/10): sì, **a mano**, e il piano non lo rifà.

1. DA-IPAM costruisce l'export: `toHubExport()` in `src/lib/ad/health/export.ts:50-87` (forma
   `HubHealthExport`, `:3-20`; `diagnostic` esplicito dalla v0.9.821, `:82`), servito come **download**
   da `GET /api/ad/healthcheck/export?runId=` (`src/app/api/ad/healthcheck/export/route.ts:33-80`), pulsante
   in `src/app/(dashboard)/active-directory/page.tsx:692`.
2. Una persona carica il `.json` sull'hub (pagina Carica): DA-Vul-can `src/app/api/reports/upload/route.ts:72`
   (ramo `.json`) → `ingestAdHealth()` (`:83`, fonte `upload/domarc-ad-health`, `:87`) → report `kind=AD`;
   dalla 0.8.148 il documento (IA, Word, PDF) si prepara da solo. Così è arrivata l'esecuzione 8 di 70791
   (report 272 sul live, DA-Vul-can `TASKS.md:131-135`).
3. La strada **automatica** lato hub c'è già ed è spenta: `/api/ipam/{ping,heartbeat,ad-health}`
   (DA-Vul-can `src/app/api/ipam/*/route.ts`, gettone `src/lib/ipam/auth.ts`, corpo gzip
   `src/lib/ipam/corpo.ts`), che chiama la **stessa** `ingestAdHealth` con fonte `ipam/ad-health` e il
   doppione per sha256 (`ad-health/route.ts:45-51`); sul live 0.8.146 risponde 503 (`ipam.ingest` assente),
   provata dal di fuori su una build locale (DA-Vul-can `TASKS.md:170-181`).
4. **In DA-IPAM non esiste alcun mittente verso l'hub**: nessun codice chiama `da-vulcan` o `/api/ipam/*`
   (grep del 22/10 su `src/`, `scripts/`, `server.ts`). L'unico trasporto verso l'esterno è quello del
   segnale verso DA-Link (`src/lib/dalink/trasporto.ts`), legato all'impronta del certificato di DA-Link;
   il trasporto della sonda verso l'hub è Python dentro Scanner-Edge (`upload_queue.py`), non riusabile qui.

Di conseguenza: **si riusa** `toHubExport()` così com'è (Task 3 diventa solo l'invio automatico a fine
esecuzione: il download resta il ripiego, decisione 13), il contratto e il codice di ricezione dell'hub
(niente da cambiare lato hub per AD e battito), le regole di lettura di `oggetto.env` di `config.ts` e lo
schema del timer di `segnale-job.ts`. **Si scrive nuovo** ciò che manca davvero: coda, trasporto HTTPS
verso l'hub (verifica TLS normale, non il pin di DA-Link), battito e inventario. Il trasporto, la coda e
il gettone sono **uno solo** per AD, inventario e battito.

## Vincoli globali

- **Spento per difetto.** Senza `/etc/dalink/oggetto.env`, o senza `VULCAN_TOKEN` dentro, nessun
  timer chiama la rete, nessuna riga si scrive in `vulcan_coda`, nessun audit. Il file si rilegge a
  ogni uso (come `leggiConfigDalink`): chi aggiunge le chiavi non riavvia DA-IPAM.
- Chiavi in `oggetto.env` (decisione 4): `VULCAN_URL` (https, solo origine: es.
  `https://da-vulcan.domarc.it`) e `VULCAN_TOKEN` (gettone dell'hub: 48 byte base64url, forma accettata
  `^[A-Za-z0-9_-]{40,200}$`, **senza** il prefisso `dlk_`). Permessi del file ≠ 600 = rifiutata (stessa
  regola di `config.ts`). Cliente e nodo da `DALINK_CODCLI`/`DALINK_NODO` (stesse forme di `config.ts`).
- Rotte dell'hub (A2, già in produzione **spente**: `ipam.ingest` ≠ `on` → 503):
  `GET /api/ipam/ping` → 200 `{fonte_id, codcli, nodo}`;
  `POST /api/ipam/heartbeat` `{versione, generato_il, ad: {ultima_esecuzione, esito}, inventario: {ultimo_invio, oggetti}, coda: {in_attesa, falliti}}` (date ISO o null) → 200 `{ricevuto_il}`;
  `POST /api/ipam/ad-health` `toHubExport()` + `run_id` + `integrazione` (+ `codcli` di controllo) → 201 `{report_id}` · 200 `{report_id, doppione: true}`;
  `POST /api/ipam/inventario` (A3, **non esiste ancora**) §5.4 → 201 `{inventario_id, oggetti}` · 200 doppione.
- Intestazioni: `Authorization: Bearer <VULCAN_TOKEN>`, `Content-Type: application/json`,
  `Content-Encoding: gzip` (sempre, sui POST), `X-DA-IPAM-Version: <package.json version>`.
- Esiti (contratto §2 e §3): 200/201 → inviato · 400, 413, 422, 404 → **scartato** (ritentare non
  serve) · 401, 403, 409 → **sospeso** tutto il flusso finché il gettone non cambia (403 = fonte
  revocata: smettere) · 503, altri 5xx, rete, tempo → **ritenta** col backoff.
- Backoff come `upload_queue.py`: `BACKOFF_S = [1, 5, 30, 120, 600, 1800, 3600, 7200, 14400, 28800, 57600, 86400]`,
  `MAX_TENTATIVI = 12`, poi `fallito`; presa in carico (lease) di 10 minuti contro i doppi invii.
- Doppione: sha256 esadecimale del **JSON non compresso** (l'hub lo calcola sul decompresso); lo stesso
  run AD produce byte identici (`generated_at` = fine del run, mai «adesso»).
- Corpo a fotografia completa (spec §5.3), `schema_versione: 1` nell'inventario. Limiti dell'hub:
  50 MB decompresso, 50.000 oggetti, 5.000 regole AD: oltre, l'istanza **non invia** e lo dice.
- **Mai nell'inventario** (spec §5.4): credenziali, community SNMP, `snmp_data`, `detection_json`, utenti,
  `notes`, assegnatari (`asset_assignees`), licenze. Lista bianca: si scelgono le colonne, mai `SELECT *`.
- Il cliente lo decide il gettone dell'hub; il `codcli` nel corpo è solo un controllo. In più l'istanza
  confronta il `codcli` del `ping` con `DALINK_CODCLI`: diversi = sospeso, niente invii.
- Un'istanza con più tenant (l'hub DA-IPAM) invia **solo** i dati del tenant risolto come in
  `fatti.ts`: `DALINK_CODCLI` se esiste come tenant, altrimenti `DEFAULT` se è l'unico cliente
  dell'appliance, altrimenti niente («cliente non presente su questa istanza»).
- Il battito non porta istruzioni e l'istanza non legge nulla della risposta oltre allo stato HTTP.
- TLS: verifica normale (certificato jolly valido di `da-vulcan.domarc.it`), **mai**
  `rejectUnauthorized: false`; il gettone non parte senza handshake verificato; niente redirect seguiti;
  risposta letta al massimo 64 KB.
- Log: diagnostica `console.warn/error` con prefisso `[vulcan]`, una riga al **cambio** di esito (come
  `registraSeCambia`); audit JSONL `<DATA_DIR>/audit/invii-vulcan-YYYY-MM-DD.jsonl`, 400 giorni (modello
  `accesso/registro-accessi.ts`). Mai gettone, URL completo, IP, hostname, nomi di dominio o corpo nei
  log: tipo, esito, stato HTTP, byte, oggetti, primi 12 caratteri dello sha256, id della risposta.
- `db-tenant` solo con import statico (regola 14, ADR 0002). Zod v4 (`.issues`). Testo UI in italiano,
  ≥13 px, stati con fondo **e** bordo e simbolo (componente `Stato` di `cosa-esce.tsx`).
- Ogni task: prova vista fallire prima del codice, poi `npm run lint`, `npx tsc --noEmit`, le prove del
  task; esito letto dal codice di uscita, log nello scratchpad (`cmd > "$LOG" 2>&1; ESITO=$?`). Una
  revisione (un revisore, agente `reviewer`) per task; si correggono i suoi rilievi.
- Commit su `dev` per task; un solo `npm run version:release` + `git push origin dev` alla fine
  (Task 9): **un push su `dev` è un rilascio sull'appliance del cliente A**, e lì il flusso resta spento
  finché DA-Link non scrive le chiavi.

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | [ ] | Chiavi VULCAN e cliente dell'invio | implementer | — | `leggiConfigVulcan` e `tenantPerVulcan` provati | `node --import tsx --test src/lib/vulcan/__tests__/config.test.ts` |
| S2 | [ ] | Coda nel DB del cliente, migrazione col segno | implementer | S1 | tabelle, segno, funzioni di coda provate; misura sulla copia 70791 | prova `coda.test.ts` + misura |
| S3 | [ ] | Invio automatico AD Health a fine run (riusa `toHubExport`) | implementer | S2 | corpo deterministico, accodamento solo se acceso | prova `corpo-ad.test.ts` |
| S4 | [ ] | Corpo inventario a lista bianca + misura | implementer | S2 | prova dei campi «Mai» verde; byte misurati su 70791 | prova `corpo-inventario.test.ts` + script |
| S5 | [ ] | Trasporto HTTPS gzip | implementer | S1 | hub finto TLS: intestazioni, gzip, cert rifiutato | prova `trasporto.test.ts` |
| S6 | [ ] | Giro: svuota coda, battito, ping, audit | implementer | S2-S5 | matrice degli esiti verde | prova `giro.test.ts` |
| S7 | [ ] | Timer in `server.ts` | implementer | S6 | nessuna chiamata senza gettone | prova `job.test.ts` |
| S8 | [ ] | Riquadro in «Cosa esce», «Invia ora», riga in AD | implementer | S6, S7 | pagina resa a 1280/1920 | Playwright + `verifica-permessi.sh` |
| S9 | [ ] | Collaudo contro DA-Vul-can di sviluppo, documenti, rilascio spento | sessione | S1-S8 | push su `dev`, hub e cliente A «Spento» | cancello + journal |

## Casi da non dimenticare

1. `oggetto.env` presente con le chiavi DA-Link ma **senza** `VULCAN_TOKEN` (oggi su tutte le istanze
   con NetBird): stato «spento», zero righe, zero rete → Task 1 e Task 7.
2. Un'esecuzione AD Health riuscita su un tenant **diverso** da quello dell'invio (hub DA-IPAM
   multi-tenant): non si accoda → Task 3.
3. Hub con `ipam.ingest` spento (503) per giorni: l'invio AD resta in coda col backoff, dopo 12 tentativi
   `fallito`, e «Invia ora» lo rimette in attesa → Task 6 e Task 8.
4. Hub senza la rotta inventario (A3 non ancora sul live, 404): la fotografia è scartata con un motivo
   leggibile e non intasa la coda; la successiva sostituisce quella in attesa → Task 2 e Task 6.
5. Gettone revocato (403) o di un altro cliente (409, o `ping` con `codcli` diverso): tutto sospeso,
   niente ritentativi a vuoto, si riparte da solo quando il gettone in `oggetto.env` cambia → Task 6.

---

### [ ] Task 1 — Chiavi VULCAN e cliente dell'invio

**File:** modifica `src/lib/dalink/config.ts` (esporta `leggiRighe`, `CODCLI`, `NODO_IPAM`, e la
funzione nuova `controllaFileOggetto(percorso)` estratta dalle righe 82-99: stat + permessi + lettura,
stesso comportamento); crea `src/lib/vulcan/config.ts`; prova `src/lib/vulcan/__tests__/config.test.ts`;
`src/lib/dalink/__tests__/config.test.ts` deve restare verde senza modifiche.

**Interfacce prodotte:**

```ts
export type ConfigVulcan =
  | { stato: "spento" }                                  // file assente o VULCAN_TOKEN assente/vuoto
  | { stato: "non_valida"; motivo: string }              // mai valori del file nel motivo
  | { stato: "pronta"; url: URL; token: string; codcli: string; nodo: string; improntaGettone: string };
export function leggiConfigVulcan(percorso?: string): ConfigVulcan;
/** Tenant da cui si legge: DALINK_CODCLI se esiste, altrimenti "DEFAULT" se è l'unico cliente; altrimenti null. */
export function tenantPerVulcan(codcli: string, dip?: Pick<DipendenzeFatti, "clienteEsiste" | "unicoClienteAppliance">): string | null;
```

- `improntaGettone` = primi 16 caratteri esadecimali dello sha256 del gettone: serve a ricordare «sospeso
  per questo gettone» senza salvarlo; non compare mai nell'interfaccia né nei log.
- `VULCAN_URL`: `new URL`, `https:` obbligatorio, `pathname` `/` o vuoto (solo origine), niente
  credenziali nell'URL (`username`/`password` vuoti). `VULCAN_TOKEN` assente → `spento` (anche se
  `VULCAN_URL` c'è); presente ma storto → `non_valida`.
- `DALINK_URL`/`DALINK_TOKEN` **non** servono: un `oggetto.env` con solo codcli, nodo e chiavi VULCAN è
  valido per questo flusso.
- `tenantPerVulcan` riusa `dipendenzeFattiReali.clienteEsiste` e `.unicoClienteAppliance` di `fatti.ts`.

**Prova (vista fallire prima):** file assente → `spento`; file senza `VULCAN_TOKEN` → `spento`;
permessi 644 → `non_valida` senza il gettone nel motivo; `http://` → `non_valida`; URL con percorso o
con `user:pass@` → `non_valida`; gettone con `dlk_` o con caratteri fuori alfabeto → `non_valida`; nodo
di un altro cliente → `non_valida`; file valido → `pronta` con `improntaGettone` di 16 caratteri e
nessun campo che contenga il gettone tranne `token`; per ogni motivo, `assert(!motivo.includes(token))`.
`tenantPerVulcan`: codcli esistente → codcli; non esistente con DEFAULT unico → `DEFAULT`; due tenant e
codcli assente → null.
**Verifica:** `node --import tsx --test src/lib/vulcan/__tests__/config.test.ts src/lib/dalink/__tests__/config.test.ts` → tutte verdi.
**Commit:** `vulcan: chiavi VULCAN_URL/VULCAN_TOKEN da oggetto.env e cliente dell'invio`.

### [ ] Task 2 — Coda nel DB del cliente, migrazione col segno

**File:** modifica `src/lib/db-tenant-schema.ts` (`DDL_VULCAN`, `SEGNO_VULCAN = "vulcan_coda_v21"`,
`VERSIONE_VULCAN = 1`); modifica `src/lib/db-tenant.ts` (`migrateVulcanCoda(db)` chiamata all'apertura
accanto a `migrateSchedaMikrotik`, riga ~2365, con lo stesso `try/catch` e il segno d'errore); crea
`src/lib/vulcan/coda.ts`; prove `src/lib/vulcan/__tests__/coda.test.ts` e
`src/lib/vulcan/__tests__/migrazione.test.ts`.

```sql
CREATE TABLE IF NOT EXISTS vulcan_coda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('ad-health', 'inventario')),
  rif TEXT,                                   -- run_id per AD, NULL per l'inventario
  corpo_gz BLOB NOT NULL,                     -- JSON gzip; svuotato (zeroblob(0)) dopo l'invio
  byte_json INTEGER NOT NULL,
  oggetti INTEGER,                            -- oggetti dell'inventario o regole AD
  sha256 TEXT NOT NULL,                       -- del JSON non compresso
  stato TEXT NOT NULL DEFAULT 'in_attesa'
    CHECK (stato IN ('in_attesa', 'inviato', 'scartato', 'fallito', 'superato')),
  tentativi INTEGER NOT NULL DEFAULT 0,
  prossimo_tentativo TEXT NOT NULL DEFAULT (datetime('now')),
  preso_fino TEXT,
  ultimo_esito TEXT,                          -- es. 'http 503', 'rete', 'tempo', 'cert'
  ultimo_errore TEXT,                         -- frase nostra, mai testo dell'hub
  risposta_id TEXT,                           -- report_id o inventario_id
  creato_il TEXT NOT NULL DEFAULT (datetime('now')),
  inviato_il TEXT,
  UNIQUE (tipo, sha256)
);
CREATE INDEX IF NOT EXISTS idx_vulcan_coda_attesa ON vulcan_coda(stato, prossimo_tentativo);
CREATE TABLE IF NOT EXISTS vulcan_stato (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  battito_il TEXT, battito_esito TEXT, battito_dettaglio TEXT,
  ping_il TEXT, ping_esito TEXT, ping_dettaglio TEXT,
  sospeso_gettone TEXT,                       -- improntaGettone per cui il flusso è sospeso, o NULL
  sospeso_motivo TEXT,
  aggiornato_il TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Date nella forma di SQLite (`dataSqlite()` di `dalink/stato.ts`): il confronto con `datetime('now')` è
fra stringhe (trappola nota in `upload_queue.py`).

**Interfacce prodotte (`coda.ts`, tutte con `db: Database` esplicito):**

```ts
export const BACKOFF_S: readonly number[]; export const MAX_TENTATIVI = 12; export const PRESA_MIN = 10;
export type TipoInvio = "ad-health" | "inventario";
export function accoda(db, v: { tipo: TipoInvio; rif: string | null; json: string; oggetti: number | null }): { id: number; nuovo: boolean };
export function prendiProssimi(db, max: number, adesso: Date): RigaCoda[];   // in_attesa e scaduti, presa per 10 min
export function segnaInviato(db, id: number, rispostaId: string | null, adesso: Date): void;
export function segnaRitento(db, id: number, esito: string, errore: string, adesso: Date): "in_attesa" | "fallito";
export function segnaScartato(db, id: number, esito: string, errore: string, adesso: Date): void;
export function rilascia(db, id: number): void;                              // sospensione: torna in attesa senza contare
export function rimettiFalliti(db): number;                                  // fallito → in_attesa, tentativi 0
export function conteggiCoda(db): { in_attesa: number; falliti: number; scartati_7g: number };
export function ultimoInviato(db, tipo: TipoInvio): { inviato_il: string; oggetti: number | null; risposta_id: string | null } | null;
export function ultimoErrore(db): { quando: string; tipo: TipoInvio; esito: string; errore: string } | null;
export function puliziaCoda(db, adesso: Date): number;                       // inviati/scartati/superati > 90 giorni
export function leggiStatoVulcan(db): StatoVulcanRiga; export function scriviStatoVulcan(db, parz: Partial<StatoVulcanRiga>): void;
```

- `accoda` comprime con `zlib.gzipSync`, calcola lo sha256 sul JSON; stesso `(tipo, sha256)` già presente
  → `nuovo: false`, nessuna riga (doppione locale). Per `inventario`, nella stessa transazione, le righe
  `in_attesa` precedenti dello stesso tipo diventano `superato` (si invia solo la fotografia più nuova).
- `segnaRitento`: `tentativi + 1`; se arriva a 12 → `fallito`, altrimenti `prossimo_tentativo` =
  adesso + `BACKOFF_S[tentativi - 1]`.
- `segnaInviato` svuota `corpo_gz`, scrive `inviato_il`, `risposta_id`.

**Prova (vista fallire prima):** migrazione su DB vuoto e su DB già migrato (seconda apertura: niente
cambia, segno `done:<data>:v1` invariato); `accoda` due volte lo stesso JSON → una riga; due inventari →
il primo `superato`; backoff: dopo 1, 2, 12 ritenti i secondi sono 1, 5 e poi `fallito`; `prendiProssimi`
due volte di fila → la seconda vuota (presa); dopo 10 minuti simulati la riga torna; `rilascia` non
aumenta `tentativi`; `rimettiFalliti` azzera; `puliziaCoda` tiene `in_attesa` vecchie.
**Misura (livello completo):** sulla **copia** del DB del tenant 70791 dell'hub DA-IPAM (VM 533):
`ssh root@192.168.4.8 "sqlite3 /opt/da-invent/data/tenants/70791.db \".backup /root/copia-70791-vulcan.db\""`,
`scp` nello scratchpad, poi un `tsx` che apre la copia con `getTenantDb` puntato su
`DA_INVENT_DATA_DIR` dello scratchpad: tempo della migrazione, `PRAGMA integrity_check` = `ok`, segno
scritto. A fine piano la copia si cancella (scratchpad e `/root` della VM): sono dati del cliente.
**Verifica:** `node --import tsx --test src/lib/vulcan/__tests__/coda.test.ts src/lib/vulcan/__tests__/migrazione.test.ts` → verdi; misura scritta in `TASKS.md`.
**Commit:** `vulcan: coda degli invii nel DB del cliente (vulcan_coda_v21)`.

### [ ] Task 3 — Invio automatico di AD Health a fine esecuzione (oggi solo a mano)

L'export esiste e l'hub lo riceve già a mano (sezione «Come viaggia l'AD oggi»): qui si aggiunge
solo il passo che oggi fa una persona. `toHubExport()` non si tocca; il download resta come ripiego.

**File:** crea `src/lib/vulcan/corpo-ad.ts`, `src/lib/vulcan/accoda-ad.ts`; modifica
`src/lib/ad/health/engine.ts` (dopo `finishRun(db, runId, { status: "ok", … })`, riga ~301); prove
`src/lib/vulcan/__tests__/corpo-ad.test.ts`, `src/lib/vulcan/__tests__/accoda-ad.test.ts`.

**Interfacce:**

```ts
// corpo-ad.ts — pura
export const MAX_REGOLE_AD = 5000;
export function corpoAdHealth(a: {
  run: AdHealthRunRow; findings: HealthFinding[]; integrazioneId: number; domainFqdn: string; codcli: string;
}): { json: string; regole: number } | { errore: string };
// accoda-ad.ts — mai un'eccezione verso il chiamante
export function accodaAdHealthSeAcceso(db: Database, runId: number, dip?: { config?: () => ConfigVulcan; tenantCorrente?: () => string | null }): "accodato" | "doppione" | "spento" | "altro_cliente" | "errore";
```

- `corpoAdHealth` è un involucro sottile, non un secondo export: `toHubExport({ domainFqdn, score: da run, findings, generatedAt: parseDbDate(run.finishedAt) })`
  più `run_id: run.id`, `integrazione: "ad-" + integrazioneId` (alias, mai `ad_integrations.name` né
  `dc_host`), `codcli`. Run senza `finishedAt` o senza punteggio → `{ errore }`. Oltre 5.000 regole →
  `{ errore: "oltre 5.000 regole: l'hub non lo accetta" }`.
- `accodaAdHealthSeAcceso`: config ≠ `pronta` → `spento` (nessuna scrittura); `tenantPerVulcan(codcli)`
  ≠ `getCurrentTenantCode()` → `altro_cliente`; poi `getRunById`, `getFindings`, `getAdIntegrationById`,
  `corpoAdHealth`, `accoda`. Errori catturati: una riga `[vulcan] AD Health run=<id> non accodato: <motivo>`
  e `errore`; l'esecuzione AD resta `ok` comunque.
- Il caricamento a mano (`/api/ad/healthcheck/export`) non cambia.

**Prova (vista fallire prima):** stesso run due volte → stringhe identiche (sha256 uguale);
`generated_at` = fine del run e non l'ora della prova; nel JSON nessuna chiave `name`, `dc_host`,
`base_dn`, `encrypted_*`; `integrazione` = `ad-7`; 5.001 regole → errore; accodamento: config spenta →
nessuna riga; tenant corrente ≠ tenant dell'invio → nessuna riga; config pronta → una riga `ad-health`
con `rif` = run id; una seconda chiamata → `doppione`; un errore finto di `getFindings` non lancia.
**Verifica:** le due prove + `node --import tsx --test src/lib/ad/health/__tests__/*.test.ts` verdi.
**Commit:** `vulcan: export AD Health in coda a fine esecuzione riuscita (il download resta)`.

### [ ] Task 4 — Corpo dell'inventario a lista bianca e misura sui dati veri

**File:** crea `src/lib/vulcan/dati-inventario.ts` (lettura dal DB), `src/lib/vulcan/corpo-inventario.ts`
(pura); modifica `src/lib/ad/health/obsolete-os.ts` (funzione nuova, `isObsoleteOs` invariata); crea
`scripts/misura-inventario-vulcan.ts`; prove `src/lib/vulcan/__tests__/corpo-inventario.test.ts`,
`src/lib/vulcan/__tests__/dati-inventario.test.ts`, `src/lib/ad/health/__tests__/obsolete-os.test.ts`
(esistente: si aggiungono i casi).

**Interfacce:**

```ts
// obsolete-os.ts
/** true = fuori supporto, false = riconosciuto e supportato, null = non riconosciuto (mai inventare). */
export function statoSupportoOs(os: string | null, now?: Date): boolean | null;
// dati-inventario.ts
export interface RigaHostInventario { /* SOLO le colonne sotto */ }
export interface DatiInventario { reti: RigaRete[]; host: RigaHostInventario[]; inAd: Set<number>; wazuh: Map<number, { os: string | null }>; osAd: Map<number, string> }
export function leggiDatiInventario(db: Database): DatiInventario;
// corpo-inventario.ts — pura
export const SCHEMA_VERSIONE_INVENTARIO = 1; export const MAX_OGGETTI = 50_000;
export const CAMPI_OGGETTO: readonly string[];   // la lista bianca, usata anche dalla prova
export function famigliaOs(os: string | null): string;   // stessa regola della colonna generata hosts.os_family
export function corpoInventario(d: DatiInventario, testa: { codcli: string; nodo: string; versione: string; adesso: Date }):
  { json: string; oggetti: number; porteIllegibili: number } | { errore: string };
```

- Colonne lette (e solo queste): `networks.id, cidr, name, vlan_id, location_id` + `locations.name`;
  `hosts.id, network_id, ip, mac, vendor, hostname, dns_reverse, custom_name, classification, status,
  open_ports, os_info, os_family, model, serial_number, firmware, device_manufacturer, host_source,
  first_seen, last_seen`; `network_devices.host, device_type, model, firmware, serial_number`
  (`LEFT JOIN network_devices nd ON nd.host = h.ip`, come `db.ts:2624`); `ad_computers.host_id,
  operating_system, operating_system_version` (solo `enabled = 1`); `wazuh_agent.host_id, os_name,
  os_version`. Una query per tabella, niente N+1.
- Oggetto (campi di §5.4, nomi italiani del contratto): `ip`, `rete_cidr`, `stato`, `visto_prima`,
  `visto_ultima`, `classificazione`, `os_famiglia`, `os`, `fuori_supporto`, `mac`, `produttore`
  (`vendor` › `device_manufacturer`), `hostname` (`custom_name` › `hostname` › `dns_reverse`),
  `tipo_apparato`, `modello`, `firmware`, `seriale`, `porte[]` `{porta, protocollo, servizio, versione}`,
  `fonti[]` (`host_source` + `"ad"` + `"wazuh"`), `in_ad`, `agente_wazuh`. Testa: `schema_versione`,
  `codcli`, `nodo`, `generato_il`, `versione_ipam`, `reti[]` `{cidr, nome, vlan, sede}` (sede = nome
  della `locations`, mai `address`).
- `os`: Wazuh (`os_name os_version`) › AD (`operating_system operating_system_version`) › `os_info`.
  `os_famiglia`: `hosts.os_family` se ≠ `Unknown`, altrimenti `famigliaOs(os)`.
- `open_ports` illeggibile (JSON storto) → `porte: []` e `porteIllegibili + 1` (si dice nella misura,
  non si ferma l'invio). Oltre 50.000 oggetti → `{ errore }`, niente invio.
- Oggetti ordinati per `rete_cidr, ip` e chiavi in ordine fisso: due fotografie dello stesso DB fermo
  differiscono solo per `generato_il`.

**Prova dei campi «Mai» (vista fallire prima, con un costruttore che copia la riga intera):** DB
temporaneo con lo schema vero; un host con `notes`, `snmp_data`, `detection_json`, `classification_json`,
`inventory_code`, `conflict_flags` riempiti con `SENTINELLA-<campo>`; una rete con
`snmp_community = 'SENTINELLA-community'`; righe in `credentials`, `host_credentials`, `asset_assignees`,
`licenses`, `ad_users` con sentinelle; un `network_devices` con `community_string`, `encrypted_password`,
`api_token`, `username` sentinella. Asserzioni: il JSON non contiene la stringa `SENTINELLA`; ogni chiave di
ogni oggetto sta in `CAMPI_OGGETTO`; nessuna chiave fra `notes, snmp_data, detection_json, community,
password, username, utenti, licenze, assegnatari`. In più una prova statica: il testo SQL di
`dati-inventario.ts` non contiene `SELECT *` né i nomi delle colonne vietate.
**Altre prove:** `statoSupportoOs("Windows Server 2012 R2")` → true, `"Windows 11 Pro"` → false,
`"Ubuntu 22.04"` → null, `null` → null; `famigliaOs` contro la colonna generata su 15 stringhe vere
(stesso esito di `SELECT os_family` in SQLite); `os` preferito da Wazuh; 50.001 oggetti → errore.
**Misura (livello completo):** `scripts/misura-inventario-vulcan.ts <cartella-dati> <tenant>` sulla copia di
70791 del Task 2: stampa oggetti, reti, byte del JSON, byte gzip, millisecondi, porte illeggibili,
conteggi per `fuori_supporto` true/false/null, host con `in_ad`, con `agente_wazuh`, e apparati
(`network_devices`) **senza** riga in `hosts` (non inviati nella versione 1). Esito in `TASKS.md`. Soglia
d'attenzione: gzip oltre 5 MB o costruzione oltre 5 s → si scrive in `TASKS.md` e si chiede prima del
Task 6.
**Verifica:** le prove verdi; script eseguito sulla copia, numeri in `TASKS.md`.
**Commit:** `vulcan: fotografia dell'inventario a lista bianca (schema_versione 1)`.

### [ ] Task 5 — Trasporto HTTPS verso l'hub

**File:** crea `src/lib/vulcan/trasporto.ts`; prova `src/lib/vulcan/__tests__/trasporto.test.ts` (hub
finto HTTPS su 127.0.0.1 con `certificatoDiProva()` di `src/lib/dalink/__tests__/support/certificato.ts`).

```ts
export type TipoErroreHub = "rete" | "cert" | "tempo" | "risposta";
export class ErroreHub extends Error { constructor(public readonly tipo: TipoErroreHub, message: string) }
export interface RichiestaHub {
  url: URL; token: string; versione: string;
  metodo: "GET" | "POST"; percorso: "/api/ipam/ping" | "/api/ipam/heartbeat" | "/api/ipam/ad-health" | "/api/ipam/inventario";
  corpoGz?: Buffer;                      // già compresso (dalla coda o da gzipSync per il battito)
  timeoutMs?: number;                    // predefinito 30 s (60 s per l'inventario)
  ca?: string | Buffer;                  // SOLO per le prove: l'hub vero usa le CA di sistema
}
export function chiamaHub(r: RichiestaHub): Promise<{ status: number; body: string }>;
```

- `node:https` `request` con `rejectUnauthorized: true`, `servername` = host, `ca` solo se passato;
  nessun agente condiviso (`agent: false`); `Content-Length` dichiarato; 3xx restituito com'è (il giro lo
  scarta come errore, nessun redirect seguito); risposta oltre 64 KB → `ErroreHub("risposta")`.
- Messaggi in italiano senza token né URL: «hub DA-Vul-can non raggiungibile: nome non risolto»
  (`ENOTFOUND`/`EAI_AGAIN`: è il caso PX-NAS di `da-vulcan.domarc.it` non fissato), «certificato dell'hub
  non valido: niente inviato», «l'hub non ha risposto in tempo».

**Prova (vista fallire prima):** l'hub finto riceve `Authorization: Bearer <gettone>`,
`Content-Encoding: gzip`, `X-DA-IPAM-Version`, e il corpo decompresso è uguale al JSON di partenza (sha256
uguale); certificato auto-firmato **senza** `ca` → `ErroreHub("cert")` e il gestore dell'hub finto non è
mai stato chiamato; porta chiusa → `rete`; hub che non risponde → `tempo` entro `timeoutMs`; 302 →
`{status: 302}`; nessun messaggio d'errore contiene il gettone o la porta.
**Verifica:** `node --import tsx --test src/lib/vulcan/__tests__/trasporto.test.ts` → verde.
**Commit:** `vulcan: trasporto HTTPS gzip verso l'hub con verifica TLS normale`.

### [ ] Task 6 — Il giro: coda, ping, battito, audit

**File:** crea `src/lib/vulcan/giro.ts`, `src/lib/vulcan/registro.ts`; prove
`src/lib/vulcan/__tests__/giro.test.ts`, `src/lib/vulcan/__tests__/registro.test.ts`.

```ts
export type Decisione = "inviato" | "ritenta" | "scarta" | "sospendi";
export function decidi(status: number): Decisione;          // tabella dei Vincoli globali; 3xx → scarta
export interface DipendenzeGiro { config: () => ConfigVulcan; tenant: (codcli: string) => string | null; db: (tenant: string) => Database;
  chiama: (r: RichiestaHub) => Promise<{ status: number; body: string }>; ora: () => Date; versione: () => string; audit: (r: RigaAuditVulcan) => void }
export async function giroCoda(dip?: Partial<DipendenzeGiro>): Promise<EsitoGiroVulcan>;     // ping se serve + fino a 20 invii scaduti
export async function battito(dip?: Partial<DipendenzeGiro>): Promise<EsitoGiroVulcan>;
export async function accodaInventario(dip?: Partial<DipendenzeGiro>): Promise<"accodato" | "doppione" | "spento" | "errore">;
export type EsitoGiroVulcan = { esito: "spento" | "non_valida" | "sospeso" | "ok" | "errore"; dettaglio: string; inviati?: number };
// registro.ts — modello accesso/registro-accessi.ts, 400 giorni
export interface RigaAuditVulcan { azione: "invio" | "scarto" | "fallito" | "sospeso" | "invia_ora"; tipo?: TipoInvio; http?: number; byte?: number; oggetti?: number | null; sha?: string; risposta_id?: string | null; da?: string }
export function scriviRegistroVulcan(r: RigaAuditVulcan, adesso?: Date): void;
```

- Ordine di `giroCoda`: config (`spento` → ritorna **prima** di aprire il DB); tenant null → `non_valida`
  «cliente non presente su questa istanza»; `sospeso_gettone` = `improntaGettone` attuale → `sospeso`
  senza rete; gettone diverso da quello sospeso → si toglie la sospensione e si riparte.
- `ping` al primo giro con un gettone nuovo e poi ogni 24 ore: 200 con `codcli` ≠ `DALINK_CODCLI` →
  sospeso «il gettone è di un altro cliente»; 401/403 → sospeso; 503 → `ping_esito = 'spento_hub'`
  e il giro prosegue (le righe prenderanno 503 e il backoff).
- Per ogni riga presa: `chiama` → `decidi`: `inviato` (`report_id`/`inventario_id` letti dal JSON della
  risposta in `try/catch`, solo se numeri) · `ritenta` → `segnaRitento` · `scarta` → `segnaScartato`
  (404 sull'inventario: «l'hub non riceve ancora l'inventario») · `sospendi` → `rilascia` di questa e stop
  del giro, `sospeso_gettone` scritto. Errori di trasporto → `ritenta` con l'esito `rete|tempo|cert|risposta`.
- `battito`: corpo esatto del contratto: `versione`, `generato_il`, `ad.ultima_esecuzione` (=`finished_at`
  dell'ultimo run `ok` del tenant in ISO, o null) e `ad.esito` (`ok|error|null` dell'ultimo run),
  `inventario.ultimo_invio` e `.oggetti` (da `ultimoInviato`), `coda.in_attesa`, `coda.falliti`. Nessun
  campo letto dalla risposta. Esito in `vulcan_stato`.
- `accodaInventario`: `leggiDatiInventario` + `corpoInventario` + `accoda`; errore del costruttore →
  una riga `[vulcan]` nel registro diagnostico e una riga
  `scartato` creata apposta (tipo `inventario`, corpo vuoto, `ultimo_errore` = motivo), così la pagina la
  mostra come «ultimo errore».
- Una riga di diagnostica solo al cambio di esito (`[vulcan] invio: ok — …`); audit per ogni invio
  riuscito, scarto, fallimento definitivo e sospensione.

**Prova (vista fallire prima) contro un `chiama` finto e contro l'hub finto del Task 5:** senza gettone:
`chiama` mai invocato, `vulcan_coda` e `vulcan_stato` vuote, nessun file in `audit/`; 201 → `inviato` con
`report_id`; 200 doppione → `inviato`; 503 tre volte → `tentativi = 3`, ancora in attesa; dodici 503 →
`fallito`; 422 e 413 → `scartato` al primo colpo; 404 su inventario → `scartato` col motivo; 401 → sospeso,
la riga torna in attesa con `tentativi` invariato, il giro dopo non chiama; gettone cambiato nel file →
riparte; `ping` con `codcli` diverso → sospeso; battito con la forma esatta (validata con lo **stesso**
schema Zod della rotta dell'hub, ricopiato nella prova con il riferimento al file dell'hub); due `giroCoda`
in parallelo → ogni riga inviata una volta; nessuna riga di audit contiene il gettone, l'URL o un IP.
**Verifica:** `node --import tsx --test src/lib/vulcan/__tests__/*.test.ts` → verdi.
**Commit:** `vulcan: giro della coda, ping e battito verso l'hub`.

### [ ] Task 7 — Timer in `server.ts`

**File:** crea `src/lib/vulcan/job.ts`; modifica `server.ts` (blocco accanto a `avviaSegnaleDalink`,
riga ~152); prova `src/lib/vulcan/__tests__/job.test.ts`.

```ts
export const CODA_OGNI_MS = 60_000; export const BATTITO_OGNI_MS = 15 * 60_000; export const PRIMO_MS = 120_000;
export const CRON_INVENTARIO = "0 3 * * *";             // ora italiana: { timezone: "Europe/Rome" }
export const RECUPERO_ORE = 26;                          // all'avvio: inventario più vecchio di 26 h → si accoda
export function inviaOraVulcan(chi: string): Promise<EsitoGiroVulcan>;   // accoda inventario + rimettiFalliti + giroCoda + battito
export function avviaInvioVulcan(opz?: { cron?: typeof import("node-cron"); giro?: …; battito?: …; inventario?: … }): () => void;
```

- Stato su `globalThis` (`Symbol.for("da-ipam.vulcan.job")`) come `segnale-job.ts`: un giro alla volta,
  il secondo aspetta il primo; `unref()` sui timer.
- I timer girano sempre, ma ogni tic passa da `leggiConfigVulcan()`: `spento` → ritorno immediato, niente
  DB, niente rete (decisione: un timer «muto» invece di registrare/deregistrare a caldo, così le chiavi
  scritte dopo funzionano senza riavvio).
- `inviaOraVulcan` scrive l'audit `invia_ora` con l'utente.
- In `server.ts`: `import("./src/lib/vulcan/job").then(({ avviaInvioVulcan }) => avviaInvioVulcan())`
  con `catch` → `console.error("WARNING: invio a DA-Vul-can non avviato:", …)`.

**Prova (vista fallire prima):** con orologio e timer finti: config `spento` per un'ora simulata → zero
chiamate a giro/battito interni oltre alla lettura della config; config `pronta` → giro ogni 60 s, battito
ogni 15 min, primo a 2 min; recupero all'avvio con ultimo inventario a 30 h → un accodamento, a 10 h →
nessuno; due `inviaOraVulcan` insieme → un giro solo.
**Verifica:** prova verde; `npm run dev:server` in locale senza `oggetto.env` → nel journal la riga
d'avvio e **nessuna** riga `[vulcan]` per 20 minuti.
**Commit:** `vulcan: timer della coda, del battito e dell'inventario giornaliero`.

### [ ] Task 8 — Riquadro in «Cosa esce», «Invia ora», riga nella pagina AD

**File:** modifica `src/lib/dalink/quadro.ts` (campo nuovo `vulcan: QuadroVulcan`), `src/components/settings/cosa-esce.tsx`
(scheda nuova prima di «Altri flussi verso Domarc»); crea `src/lib/vulcan/quadro.ts`,
`src/app/api/dalink/vulcan/invia/route.ts`; modifica `src/app/(dashboard)/active-directory/page.tsx`
(una riga accanto al pulsante d'export, riga ~692) e la sua rotta di lettura del run, se serve, per
portare `vulcan: "spento" | "in_coda" | "inviato" | "scartato" | "fallito" | null`; prove
`src/lib/vulcan/__tests__/quadro.test.ts`, `src/lib/dalink/__tests__/quadro.test.ts` (si aggiorna
l'atteso con il campo nuovo, motivo nel commit).

```ts
export interface QuadroVulcan {
  stato: "spento" | "non_valida" | "sospeso" | "attivo";
  motivo: string | null;                 // non_valida/sospeso, parole nostre
  destinazione: string | null;           // solo url.host
  battito: { il: string | null; esito: string | null };
  coda: { in_attesa: number; falliti: number };
  ultimo_ad: { il: string; report_id: string | null } | null;
  ultimo_inventario: { il: string; oggetti: number | null } | null;
  ultimo_errore: { il: string; tipo: string; errore: string } | null;
}
```

- Scheda «Dati verso DA-Vul-can (AD Health e inventario)», righe con `Riga`/`Stato` già presenti:
  Stato (`spento` → tono `spento` «Spento: nessun gettone dell'hub su questa istanza»; `non_valida` → errore
  col motivo; `sospeso` → errore col motivo; `attivo` → ok), Destinazione, Ultimo battito, Coda («N in
  attesa · M falliti», ambra se M > 0), Ultimo AD Health, Ultimo inventario (con oggetti), Ultimo errore.
  Una riga di testo fisso sotto il titolo: «Cosa parte: risultati AD Health dopo ogni esecuzione e un
  inventario al giorno (IP, rete, sistema, porte). Mai credenziali, note, utenti, licenze.»
- Pulsante «Invia ora» (icona `Send`, solo admin: la pagina è già admin) → `POST /api/dalink/vulcan/invia`:
  `requireAdmin()`; config `spento` → 409 «DA-Vul-can non è configurato su questa istanza: non parte
  niente»; altrimenti `inviaOraVulcan(utente)` e il risultato in un toast; la pagina si ricarica.
- Pagina AD: sotto l'ultimo run, «Invio a DA-Vul-can: in coda | inviato il … | scartato: motivo |
  spento», solo testo, letto da `vulcan_coda` per `rif = run.id`.
- Censimento permessi: la rotta POST con `requireAdmin` è il predefinito; `bash scripts/verifica-permessi.sh` verde.

**Prova (vista fallire prima):** `quadroVulcan` con config spenta → `stato: "spento"` e coda a zero senza
aprire il DB; con righe finte → conteggi e ultimi giusti; nessun campo contiene il gettone.
**Verifica a schermo (una volta, livello completo):** `npm run dev` con un `oggetto.env` di prova
(`DALINK_OGGETTO_ENV` nello scratchpad, gettone finto) e righe finte in coda: «Cosa esce» resa a 1280 e
1920 (Playwright), stati «Spento» e «Attivo con 1 fallito» guardati; «Invia ora» contro l'hub finto del
Task 5 avviato a mano → toast e righe aggiornate; un utente non admin → 403.
**Commit:** `vulcan: stato dell'invio in Cosa esce e pulsante Invia ora`.

### [ ] Task 9 — Collaudo contro DA-Vul-can di sviluppo, documenti, rilascio spento

1. **Dal di fuori (lezione 13), oggi possibile per tre rotte su quattro:** DA-Vul-can in locale
   (`npm run dev` nel suo worktree, `ipam.ingest = 'on'` **nel DB di sviluppo**, fonte creata con
   `POST /api/edge-bridges/kit` `{"tipo":"ipam","codcli":"70791","nodo":"70791-ipam"}` con la chiave del kit
   di sviluppo). In DA-IPAM `DALINK_OGGETTO_ENV` su un file 600 nello scratchpad con `VULCAN_URL` del dev e
   il gettone ricevuto, `NODE_EXTRA_CA_CERTS` se il dev usa un certificato locale. Si eseguono con uno
   script `tsx` (non si lascia girare il timer): `ping` → 200 col codcli; `battito` → 200; un run AD della
   copia 70791 accodato e inviato → 201 con `report_id`, il report visibile nella linguetta Scansioni del
   cliente nell'hub di sviluppo; secondo invio → 200 doppione; gettone revocato col kit → 403 e «sospeso»
   nella pagina. **Inventario: solo contro l'hub finto** (la rotta non esiste finché non c'è A3; nel
   dev: 404 → «scartato: l'hub non riceve ancora l'inventario», che è il comportamento voluto).
2. Cancello completo: `npm run lint`, `npx tsc --noEmit`, `npm test` con `DA_INVENT_DATA_DIR` temporaneo,
   `npm run build`; esito dal codice di uscita, log nello scratchpad. Le cadute a caso note (CONTEXT §5)
   si rilanciano da sole una volta.
3. Revisione finale del diff intero (un revisore), rilievi corretti.
4. Documenti: `CHANGELOG.md` («[Non rilasciato]», il perché), ADR `docs/adr/0028-invio-a-vulcan-coda-nel-db-del-cliente.md`
   (coda nel DB del cliente, TLS normale invece del pin, timer muto senza gettone; «cosa diventa difficile»:
   un secondo hub o una seconda destinazione raddoppia coda e stato), `CONTEXT.md` §6 (voce «Invio a
   DA-Vul-can», trappole: chiavi in `oggetto.env`, sospensione per gettone, 404 inventario finché manca A3),
   `docs/scheda-mappa.md` (`prossimo:`), `TASKS.md`.
5. `npm run version:release`, `git push origin dev`. **È un rilascio sull'appliance del cliente A** (timer
   d'aggiornamento di 15 minuti); lì, senza `VULCAN_TOKEN`, il flusso resta spento.
6. Verifica dopo il rilascio: hub DA-IPAM (VM 533) — versione nuova in `/api/version` **e** riavvio vero
   (`ActiveEnterTimestamp`), segno `vulcan_coda_v21` = `done:…:v1` nei tenant, `journalctl -u da-invent`
   senza righe `[vulcan]` dopo 20 minuti, «Cosa esce» mostra «Spento». Cliente A: stessa lettura della
   versione e del segno, pagina «Spento».
7. Copie del DB 70791 cancellate (scratchpad e `/root/copia-70791-vulcan.db` sulla VM).

**Verifica:** cancello `exit=0`; righe del collaudo e della verifica sul live in `TASKS.md` con data e fonte.
**Commit:** `release: v0.9.x` (dallo script) più `docs: invio a DA-Vul-can (ADR 0028, CONTEXT, CHANGELOG)`.

---

## Cosa si prova oggi e cosa no

| Pezzo | Contro cosa | Quando |
| --- | --- | --- |
| `ping`, `heartbeat`, `ad-health` | DA-Vul-can di sviluppo in locale con `ipam.ingest` acceso e una fonte del kit | ora (Task 9) |
| Gli stessi verso l'hub vero | live DA-Vul-can (rotte presenti, oggi **503**) | dopo A-Link e accensione di `ipam.ingest`, con conferma |
| `inventario` | solo hub finto (prove) e 404 del dev | dopo A3 sull'hub (nessun piano A3 su `origin` al 22/10) |
| Rete dall'appliance | `70791-ipam` via NetBird | dopo P9 e `da-vulcan.domarc.it` fissato sull'appliance |

## Fuori da questo piano

- **A-Link (sessione DA-Link):** `tipo:"ipam"` nel comando del kit, scrittura di `VULCAN_URL`/`VULCAN_TOKEN`
  in `oggetto.env` (600) e pretesa di `fonte_id` nella risposta 201; policy **`dalink-P9`
  `remoto-ipam → centro-vulcan :443`** in `politiche.py`, scrittura su NetBird di produzione **con conferma
  di Riccardo**. Intanto DA-IPAM non accende niente: senza chiavi il flusso è «Spento».
- **Nome dell'hub sull'appliance:** `da-vulcan.domarc.it` fissato all'IP NetBird dell'hub (`/etc/hosts`),
  come per le sonde (caso PX-NAS del 19/10): Deploy-Appliance o il comando di DA-Link. Intanto l'errore
  «nome non risolto» è visibile in «Cosa esce».
- **A3 (sessione DA-Vul-can):** rotta `POST /api/ipam/inventario`, tabelle `ipam_inventari`,
  `ipam_inventario_oggetti`, conservazione 12 fotografie (decisione 6a). Intanto: prove contro l'hub finto,
  404 → scartato. Se A3 cambia i nomi dei campi di §5.4, si allinea `corpo-inventario.ts` e si alza
  `schema_versione` solo se il cambio non è additivo.
- **Accensione** di `ipam.ingest` sul live DA-Vul-can e primo invio vero da `70791-ipam`: Riccardo, con
  conferma, quando A-Link e A3 ci sono.

## Registro

## Consuntivo

### Fatto

### Mancante

### Scostamenti dal piano

### Consigli di sviluppo

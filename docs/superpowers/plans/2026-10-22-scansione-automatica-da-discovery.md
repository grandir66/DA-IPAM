# Scansione automatica dei device scelti in Discovery — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** da Discovery l'admin sceglie più apparati e crea un job che li rilegge da solo (informazioni, porte e MAC, VLAN) con le credenziali memorizzate e provate, a un'ora o a un intervallo scelti; l'esito si vede per apparato nella pagina dei job e nella testata della scheda.

**Architettura:** un tipo di job nuovo `apparati_scelti` nello scheduler che esiste (`scheduled_jobs`, `server.ts` → `src/lib/cron/scheduler.ts`), con la lista degli apparati e le letture scelte in `config`. Il giro non ha letture sue: chiama le stesse funzioni di «Aggiorna» (informazioni) e del giro ARP (porte e MAC, VLAN), estratte dai file dove stanno oggi senza cambiarne il comportamento. Un lucchetto per apparato, condiviso con il giro ARP e con «Interroga», impedisce due letture insieme sullo stesso apparato. L'ultimo esito di ogni apparato sta in una tabella nuova del DB del cliente; la pagina dei job e la scheda lo leggono.

**Spec:** la richiesta di Riccardo (22/10, sotto) e la tavola approvata («si va benissimo», 22/10): artboard **`ScansioneAutomatica.dc.html`**, segni **J1-J4**, del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv — **si rilegge prima di scrivere l'interfaccia** (`Artifact`, `action: "read"`, `path: "project/ScansioneAutomatica.dc.html"`). Modelli di struttura: `docs/superpowers/plans/2026-10-22-accorpamento-ip-e-vlan-switch.md` (letture spente, `conCadenza`, migrazione col segno), `src/lib/cron/__tests__/hypervisor-sync-job.test.ts` (job con esito per apparato).

**Livello di controllo** (proposto il 22/10, da confermare con l'approvazione): **COMPLETO per il giro** (Task 1-6: migrazione sui DB dei clienti, letture automatiche sugli apparati dei clienti con le loro credenziali): prova vista fallire prima del codice, misura sulla copia del DB dell'hub, revisione per task, prova a vuoto prima del push. **LEGGERO per l'interfaccia** (Task 7-9): nessuna prova a ogni file, resa a fine tappa a 1440 e 1920 sulla copia del DB dell'hub. Task 10 (accensione sull'hub) completo.

**Stato:** bozza · **Ultimo aggiornamento:** 2026-10-22

## La richiesta (Riccardo, 22/10) — non riaprire

«Dobbiamo prevedere la scansione automatica dei device indicati, creando un job con selezione multipla da Discovery; le credenziali devono essere memorizzate.» Tavola approvata:

- **J1** — Discovery, barra della selezione: pulsante **«↻ Scansione automatica…»** accanto alle azioni di gruppo.
- **J2** — finestra «Scansione automatica di N apparati»: elenco dei selezionati con lo stato della credenziale e **✓ incluso / ✕ escluso** col motivo e il link che lo risolve («Rendi apparato ›», «Assegna credenziale ›»); **Frequenza** (ogni ora · ogni 4 ore · ogni giorno alle HH:MM, con «prossima»); **Cosa legge** (Informazioni apparato · Porte e MAC · VLAN), ognuna con gli apparati a cui si applica, solo le letture valide per i tipi scelti; **Nome del job** (predefinito «Apparati scelti»); «Crea job (N apparati)», spento con 0 inclusi e «▲ nessun apparato con credenziale provata».
- **J3** — la pagina dei job che c'è già, con la riga nuova: nome, «Lettura apparati · N apparati», frequenza, prossima, **ultimo esito «✓ 3/3»**, Modifica · Sospendi · Elimina.
- **J4** — testata della scheda apparato: pastiglia **«↻ in scansione automatica · ogni 4 ore»** che apre il job, «ultima lettura 06:00 · prossima 10:00»; «Aggiorna» resta per la lettura a mano.

## Decisioni prese nel piano (una riga col perché)

1. **Nome del tipo: `apparati_scelti`.** Dice cosa legge, non come; sta in coda a `SCHEDULED_JOB_TYPES` come chiede il commento del file.
2. **Forma di `config`:** `{ nome: string, device_ids: number[], cosa: { info: boolean, porte_mac: boolean, vlan: boolean }, ora?: "HH:MM" }`, validata da uno schema Zod unico (`ConfigApparatiScelti`). `nome` perché J2 lo chiede; `ora` solo per il giornaliero.
3. **Al più 50 apparati per job.** Stesso tetto della finestra «Rendi apparato»; un giro seriale da 50 sta nell'ora anche coi tempi peggiori misurati (≈1 min per apparato).
4. **Lo crea, modifica, sospende ed elimina solo un admin** (`requireAdmin` su ogni POST/PUT/DELETE; pulsante J1 solo con `useEAdmin()`). La testata J4 si legge con `requireAuth` (un viewer vede che l'apparato è in scansione).
5. **Idoneità = apparato gestito + credenziale memorizzata + provata**, con la definizione unica che c'è (`senzaCredenzialeProvata` in `src/lib/devices/credenziali-assegnate.ts`: `host_credentials.validated = 1`, ripiego sui binding per un apparato senza host). Esclusi col motivo, come J2: `NON_APPARATO` («non è un apparato», link «Rendi apparato ›»), `SENZA_CREDENZIALE` («nessuna credenziale memorizzata», «Assegna credenziale ›»), `CREDENZIALE_NON_PROVATA` («credenziale non provata», «Prova credenziali ›» alla scheda), `DISATTIVATO` («apparato disattivato»), `NON_LEGGIBILE` (la lettura per quel tipo non esiste: il testo di `resolveDeviceAcquisition().notImplementedHint`). Il server ricontrolla alla creazione, non si fida della finestra.
6. **Regola del cluster: si agisce solo sugli id selezionati.** Ogni host selezionato porta il suo `device_id`; i membri del cluster non selezionati non entrano; due host selezionati dello stesso apparato danno un id solo.
7. **Frequenze sullo scheduler che c'è:** ogni ora = `interval_minutes 60` (`0 */1 * * *`), ogni 4 ore = `240` (`0 */4 * * *`), ogni giorno alle HH:MM = `1440` + `config.ora` (`M H * * *`). `intervalToCron` riceve l'ora facoltativa; senza, le 03:00 di oggi restano per gli altri tipi. Nessuna frequenza libera: tre scelte come J2.
8. **Cosa fa ogni lettura (riuso, niente letture nuove):**
   - **Informazioni apparato** = quello che fa «Aggiorna»/«Interroga» per la parte informazioni: `getDeviceInfo` + scrittura (`saveDeviceInfo`/`runInfoQuery` di `src/app/api/devices/[id]/query/route.ts`), STP per gli switch, scansione Proxmox (`runProxmoxDeviceScan`) per gli hypervisor Proxmox. Estratte in `src/lib/devices/lettura-info.ts`; la rotta le chiama da lì.
   - **Porte e MAC** = il corpo per apparato del giro ARP (`runArpPoll` in `src/lib/cron/jobs.ts`): ramo router (ARP, lease DHCP, schema porte, MAC per porta dalla bridge host, vicini, routing, letture MikroTik in più sotto i loro interruttori) e ramo switch (tabella MAC, `mac_ip_mapping`, schema porte). Estratto in `leggiApparatoArp(device, contesto, opzioni)`; `runArpPoll` lo chiama in un ciclo e fa esattamente quello di prima.
   - **VLAN** = `letturaVlanSwitch` per gli switch (`vlanSwitchDaLeggere`), `letturaSchedaMikrotik` per i router MikroTik via SSH, **senza la cadenza oraria** (`ignoraCadenza: true`, come «Interroga»: un job creato da un admin è una scelta esplicita) **ma dietro l'interruttore** (`switch_vlan`, `mikrotik_scheda`): l'interruttore è il freno generale di ADR 0018 e nemmeno «Interroga» lo scavalca. Interruttore spento → la casella VLAN di J2 è spenta con «lettura VLAN spenta in Impostazioni», e al giro l'esito è «— spenta», non un errore.
   - Quando il job legge porte e MAC chiama il corpo con `vlan: "no"`, e la VLAN la fa (o no) lui: una lettura non scelta non parte. Il giro ARP usa `vlan: "come_il_giro"` (comportamento di oggi).
9. **Letture valide per tipo** (J2 «solo le letture che valgono»): una funzione pura `lettureValide(device)`: informazioni = ogni apparato leggibile; porte e MAC = router con ARP (`networkDeviceUsesArpPoll`) e apparati del ramo switch (`device_type` switch); VLAN = `vlanSwitchDaLeggere` o MikroTik router via SSH. Il giro fa l'intersezione fra `cosa` e `lettureValide`.
10. **Concorrenza:** (a) lo stesso job non si sovrappone a sé (`runningJobs` dello scheduler, c'è già); (b) **lucchetto per apparato** in memoria, chiave `tenant|deviceId`, nuovo in `src/lib/devices/lucchetto-apparato.ts`, preso dal giro ARP per ogni apparato, dal job per ogni apparato e da «Interroga»: occupato → il giro ARP e il job passano oltre con esito «saltato: lettura già in corso», «Interroga» risponde 409 «Lettura già in corso su questo apparato»; (c) i lucchetti per lettura di `conCadenza` restano; (d) gli apparati si leggono **uno alla volta** (come il giro ARP e «Aggiorna selezionati»), al più **5 minuti** per apparato (`entro` di `jobs.ts`): oltre, esito `TEMPO_SCADUTO` e si passa al prossimo; il lucchetto si libera quando la lettura finisce davvero (come ADR 0006).
11. **Esito per apparato salvato e mostrato:** tabella nuova `job_apparati_esiti` (una riga per job e apparato, l'**ultimo** esito, niente storico): `job_id, device_id, giro_il, stato ('ok'|'parziale'|'errore'|'escluso'|'saltato'), letture (JSON: per ogni lettura scelta { stato: 'letto'|'errore'|'spenta'|'non_valida', codice? }), motivo`. Il riassunto di J3 («✓ 3/3», «▲ 2/3 · 1 escluso», «✕ 0/3») si calcola dalle righe dell'ultimo `giro_il`. Niente FK verso `scheduled_jobs` (la v11 la ricostruisce): si cancellano le righe del job nella stessa transazione di `deleteScheduledJob` e gli orfani all'inizio di ogni giro.
12. **Esito del job per lo scheduler:** almeno un apparato letto → «eseguito» con il motivo in numeri («2 letti su 3; 1 escluso»); nessuno letto (tutti in errore o esclusi) → **si lancia** «Nessun apparato letto: 0 su N», così lo scheduler lo conta fra i falliti e l'allarme delle sincronizzazioni ferme lo vede (niente ripieghi muti).
13. **Apparato tolto o credenziale persa:** si scopre al giro, non si toglie dal job da solo: esito «escluso» col motivo (`TOLTO`: «apparato #id tolto»; `CREDENZIALE_NON_PROVATA` / `SENZA_CREDENZIALE` con il link). J3 lo conta fra gli esclusi; l'admin decide con «Modifica».
14. **Log senza nomi né IP:** le righe del job hanno solo id e codici (`[Scheduler] apparati_scelti #12: 3 letti su 3, 0 esclusi; info 3/3, porte 2/2, vlan 2/2`). Il corpo estratto dal giro ARP oggi scrive `device.name` in cinque `console.*` (`[ARP Poll] Errore su`, `getPortSchema fallito per`, `[DHCP Leases]`, `[Neighbors]`, `[Routing]`): diventano `apparato #id` + codice, e il messaggio dell'errore passa per la stessa maschera degli IP di «Interroga» (`/\b\d{1,3}(?:\.\d{1,3}){3}\b/g → "<ip>"`). Vale anche per il giro ARP: migliora, non cambia cosa si legge.
15. **Modifica (J3):** la stessa finestra di J2 in modo «modifica»: si tolgono apparati, si cambiano frequenza, letture e nome. **Aggiungere apparati si fa da Discovery** creando un job nuovo (fuori da questo giro: vedi «Proposte»). «Sospendi» = l'interruttore «Attivo» della riga, che c'è già.
16. **Dove si gestisce:** la PUT generica di `/api/jobs` su un `apparati_scelti` accetta solo `enabled`; un `interval_minutes` risponde 409 «Si modifica da «Modifica»» (l'ora del giornaliero starebbe altrimenti in due posti). DELETE ed «Esegui ora» restano quelle generiche.

## Vincoli globali

- Ogni rotta nuova: `requireAuth()` (GET) o `requireAdmin()` (POST/PUT/DELETE) come prima istruzione, poi `withTenantFromSession`; import **statico** di `@/lib/db-tenant` (ADR 0002); voce in `CONTRACT` di `src/lib/__tests__/api-auth-guards.test.ts`; `npx tsx --test src/lib/permessi/__tests__/rotte-censite.test.ts` verde; permessi in `src/lib/permessi/rotte.ts`.
- Funzioni DB nuove **solo in `src/lib/db-tenant.ts`**, mai in `db.ts` (`db-facade-ratchet` già al limite); niente N+1: lo stato degli apparati di un job si legge in **una** query con JOIN.
- Schema: tabella nuova additiva e idempotente in transazione all'apertura del tenant, segno `apparati_scelti_v21` = `done:<AAAA-MM-GG>:v1` in `tenant_settings`, riga nel journal; il CHECK di `scheduled_jobs` si allarga con la **v11** (`migrateScheduledJobsV11`, stessa forma della v10, guardia su `'apparati_scelti'`), dopo la v10. Mai DROP d'altro.
- Letture: sola lettura (nessun SET, nessuna scrittura sugli apparati); 10 s per walk SNMP come oggi; «non so» non scrive mai una lista vuota (regola di `conCadenza`/`letturaVlanSwitch`, invariata).
- Log, esiti e `motivo` del job: numeri, id e codici; **mai** nomi, IP, MAC, community o utenti.
- Testi dell'interfaccia in italiano, stato sempre segno + parola (✓ ▲ ✕ ●), testo ≥ 13 px, badge a tinta piena con bordo (`STILE_STATO`, token `--host-*`), distinguibili per luminanza (Riccardo è daltonico).
- Prove: `DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ipam-prove.XXXXXX") node --import tsx --test <file>`; log nello scratchpad della sessione, esito dal codice d'uscita (`cmd; ESITO=$?`), mai da `| tail`.
- Copia del DB dell'hub: `sqlite3 .backup` sull'hub (VM 533, skill `deploy-prod`), nello scratchpad, mai nel repo; sul Mac `npm run dev` con `DA_INVENT_DATA_DIR` sulla copia e utente locale; resa a **1920×1080** e **1440×900**.
- Ogni task con codice: `npm run lint && npx tsc --noEmit && npm run build`, poi `npm run version:release` + `git push origin dev` (arriva anche all'appliance del cliente A, `CONTEXT.md` §3). Albero condiviso: mai `git add -A`; `git diff <file>` e stage per file; in `TASKS.md` solo le righe di questo piano.

## Casi da non dimenticare

1. Apparato tolto fra la creazione e il giro → «escluso: TOLTO», il giro continua (Task 5).
2. Credenziale rifiutata dopo la creazione (la prova la segna non valida) → «escluso: CREDENZIALE_NON_PROVATA» al giro, non un errore di lettura (Task 5).
3. Il giro ARP (cliente A) e il job sullo stesso switch nella stessa ora → uno solo legge, l'altro «saltato: lettura già in corso» (Task 4, Task 5).
4. Lettura VLAN scelta ma interruttore spento → «— spenta», non «errore», e il job non fallisce per questo (Task 5).
5. Job con tutti gli apparati esclusi o in errore → il job **fallisce** (si vede nell'allarme), J3 «✕ 0/3» (Task 5, Task 8).

## Tabella dei passi

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | [ ] | Tipo `apparati_scelti`, CHECK v11, tabella degli esiti | implementer | — | migrazione idempotente sulla copia dell'hub, prove verdi | prova vista rossa poi verde; due aperture della copia |
| S2 | [ ] | Regole pure: config, frequenze, idoneità, letture valide | implementer | — | prove verdi | prova vista rossa poi verde |
| S3 | [ ] | Funzioni DB: stato apparati in una query, esiti | implementer | S1 | prove verdi, ratchet invariato | prova vista rossa poi verde |
| S4 | [ ] | Letture estratte + lucchetto per apparato + log senza nomi | implementer | — | prove ARP di oggi verdi senza toccarle + prove nuove | suite `cron/__tests__` |
| S5 | [ ] | Giro `apparati_scelti` nello scheduler | implementer | S1-S4 | prove verdi; prova a vuoto sulla copia | prova vista rossa poi verde |
| S6 | [ ] | Rotte API | implementer | S2, S3, S5 | guardie e censimento verdi | `api-auth-guards`, `rotte-censite` |
| S7 | [ ] | J1 + J2 in Discovery | implementer | S6 | resa 1440 e 1920 | screenshot nello scratchpad |
| S8 | [ ] | J3 nella pagina dei job | implementer | S6, S7 | resa 1440 e 1920 | screenshot |
| S9 | [ ] | J4 nella testata | implementer | S6 | resa 1440 e 1920 | screenshot |
| S10 | [ ] | Accensione sull'hub, documenti | sessione principale | S1-S9 | job vero letto 3/3 sull'hub | esiti in tabella, journal anonimo |

S2 e S4 non hanno file in comune con S1: si possono fare in parallelo se Riccardo approva i subagent (REGOLA #2); altrimenti in ordine.

---

### [ ] Task 1 — Tipo `apparati_scelti`, CHECK v11, tabella degli esiti (completo)

**File**
- Modifica: `src/lib/scheduled-job-types.ts` (in coda a `SCHEDULED_JOB_TYPES`, con commento «v11 (scansione automatica, piano 2026-10-22): job creato da un admin da Discovery; nessuno si crea da solo»).
- Modifica: `src/lib/db-tenant.ts`: `migrateScheduledJobsV11(db)` (copia della v10 con guardia `row.sql.includes("'apparati_scelti'")` e tabella di passaggio `scheduled_jobs_v11`), chiamata in `getTenantDb` subito dopo la v10 con la sua riga nel journal; `migraApparatiScelti(db)` che crea la tabella sotto e scrive il segno.
- Modifica: `src/lib/db-tenant-schema.ts` (la stessa `CREATE TABLE IF NOT EXISTS`, per i DB nuovi).
- Prova: `src/lib/__tests__/scheduled-jobs-v11.test.ts` (sul modello di `scheduled-jobs-v9.test.ts`).

**Schema**
```sql
CREATE TABLE IF NOT EXISTS job_apparati_esiti (
  job_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  giro_il TEXT NOT NULL,            -- UTC, `oraUtc`
  stato TEXT NOT NULL,              -- ok | parziale | errore | escluso | saltato (validato nel codice, NESSUN CHECK)
  letture TEXT NOT NULL DEFAULT '{}',
  motivo TEXT,                      -- codice: TOLTO, SENZA_CREDENZIALE, CREDENZIALE_NON_PROVATA, DISATTIVATO, NON_LEGGIBILE, OCCUPATO, TEMPO_SCADUTO, …
  PRIMARY KEY (job_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_job_apparati_esiti_device ON job_apparati_esiti(device_id);
```

**Prove (vista rossa prima del codice)**
- un DB con il CHECK della v10 rifiuta `INSERT … job_type='apparati_scelti'`; dopo `migrateScheduledJobsV11` lo accetta, le righe di prima sono identiche (id, config, last_run), `sqlite_sequence` non scende, l'indice c'è;
- seconda chiamata → `false`, niente cambia;
- un DB nuovo (`getTenantDb` da zero) ha già il CHECK nuovo e la tabella; il segno `apparati_scelti_v21` c'è.

**Verifica** prova verde; sulla copia del DB dell'hub: due aperture (`getTenantDb` da script nello scratchpad), `PRAGMA integrity_check` = ok, `SELECT sql FROM sqlite_master WHERE name='scheduled_jobs'` contiene `'apparati_scelti'`, numero di righe di `scheduled_jobs` invariato, tempo della migrazione nel Registro. Revisione del task. Lint, tsc, build. **Commit** `apparati_scelti: tipo di job, CHECK v11 e tabella degli esiti` + rilascio.

### [ ] Task 2 — Regole pure: config, frequenze, idoneità, letture valide (completo)

**File**
- Crea: `src/lib/apparati-scelti/regole.ts` (modulo puro: niente DB, niente Node).
- Modifica: `src/lib/cron/scheduler.ts`: `intervalToCron(minutes, jobType?, ora?: { h: number; m: number })`.
- Prova: `src/lib/apparati-scelti/__tests__/regole.test.ts`; aggiunte in `src/lib/cron/__tests__/` alla prova esistente di `intervalToCron` (se manca, nella nuova).

**Interfacce (prodotte)**
```ts
export const MAX_APPARATI = 50;
export const LETTURE = ["info", "porte_mac", "vlan"] as const;
export type Lettura = (typeof LETTURE)[number];
export const ConfigApparatiScelti: z.ZodType<{ nome: string; device_ids: number[]; cosa: Record<Lettura, boolean>; ora?: string }>;
// nome 1-80 caratteri; device_ids 1..MAX_APPARATI interi positivi, senza doppi; almeno una lettura true; ora /^([01]\d|2[0-3]):[0-5]\d$/
export type Frequenza = { tipo: "ora" } | { tipo: "4ore" } | { tipo: "giorno"; ora: string };
export function intervalloDaFrequenza(f: Frequenza): 60 | 240 | 1440;
export function frequenzaDaJob(intervalMinutes: number, config: { ora?: string }): Frequenza | null; // null = forma non prevista
export function etichettaFrequenza(f: Frequenza): string; // «ogni ora», «ogni 4 ore», «ogni giorno alle 02:00»
export function prossimaEsecuzione(f: Frequenza, adesso: Date): Date; // ora del server, come node-cron
export function leggiConfig(configStr: string | null): z.infer<typeof ConfigApparatiScelti> | null; // JSON.parse in try-catch
export type MotivoEsclusione = "NON_APPARATO" | "TOLTO" | "SENZA_CREDENZIALE" | "CREDENZIALE_NON_PROVATA" | "DISATTIVATO" | "NON_LEGGIBILE";
export interface StatoApparato { host_id: number | null; device_id: number | null; enabled: boolean; credenziali_memorizzate: number; validate_sul_host: number | null; binding_riusciti: number; leggibile: boolean; tipo: { device_type: string; vendor: string | null; protocol: string | null; usa_arp: boolean; vlan_switch: boolean } }
export function valutaApparato(s: StatoApparato): { incluso: true } | { incluso: false; motivo: MotivoEsclusione };
export function lettureValide(t: StatoApparato["tipo"]): Lettura[];
export const TESTO_MOTIVO: Record<MotivoEsclusione, string>; // «non è un apparato», «nessuna credenziale memorizzata», …
```
`valutaApparato` usa `senzaCredenzialeProvata` (non la riscrive). Ordine dei motivi: NON_APPARATO, TOLTO, DISATTIVATO, NON_LEGGIBILE, SENZA_CREDENZIALE, CREDENZIALE_NON_PROVATA.

**Prove (vista rossa prima del codice)** una per motivo, più: host senza `device_id` → NON_APPARATO; credenziale memorizzata ma `validated = 0` → CREDENZIALE_NON_PROVATA; apparato senza host con un binding `success` → incluso; config con 51 id, id doppi, nessuna lettura, ora «24:00» → rifiutata; `intervalToCron(1440, "apparati_scelti", { h: 2, m: 0 })` = `0 2 * * *`; `intervalToCron(1440, "hypervisor_sync")` = `0 3 * * *` invariato; `intervalToCron(240, …)` = `0 */4 * * *`; `prossimaEsecuzione({tipo:"4ore"}, 09:40)` = 12:00 (le ore divisibili per 4, come node-cron), `giorno 02:00` alle 09:40 → domani 02:00; hypervisor → `lettureValide` = `["info"]`; switch SNMP → tutte e tre.

**Verifica** prova verde. Revisione del task. Lint, tsc, build. **Commit** `apparati_scelti: regole di config, frequenza e idoneità`.

### [ ] Task 3 — Funzioni DB: stato degli apparati in una query, esiti (completo)

**File**
- Modifica: `src/lib/db-tenant.ts` (in fondo, sezione «Scansione automatica dei device scelti»).
- Prova: `src/lib/apparati-scelti/__tests__/db.test.ts`.

**Interfacce (prodotte)**
```ts
export function statoApparatiPerHost(hostIds: number[]): Array<StatoApparato & { host_id: number; nome: string; ip: string; tipo_scheda: string }>; // per J2
export function statoApparatiPerDevice(deviceIds: number[]): Map<number, StatoApparato & { nome: string }>; // per il giro; id assente = TOLTO
export function scriviEsitiGiro(jobId: number, giroIl: string, righe: Array<{ device_id: number; stato: StatoEsito; letture: Record<string, { stato: string; codice?: string }>; motivo?: string | null }>): void; // DELETE del job + INSERT in db.transaction
export function leggiEsitiJob(jobId: number): { giro_il: string | null; righe: Array<EsitoRiga & { nome: string | null }> };
export function riassuntiEsitiJobs(jobIds: number[]): Map<number, { letti: number; totale: number; esclusi: number; giro_il: string }>; // per J3, una query
export function jobsDelApparato(deviceId: number): Array<{ id: number; nome: string; enabled: boolean; interval_minutes: number; config: string; last_run: string | null }>; // json_each(config, '$.device_ids')
export function cancellaEsitiJob(jobId: number): void;
```
Le due `statoApparati*` sono **una** query ciascuna (JOIN `hosts` ↔ `network_devices` ↔ subquery aggregate su `host_credentials` e `device_credential_bindings`), con `IN (…)` a segnaposto; `leggibile` lo calcola il chiamante con `resolveDeviceAcquisition` (pura). `deleteScheduledJob` cancella anche gli esiti nella stessa transazione.

**Prove (vista rossa prima del codice)** 3 apparati + 1 host senza apparato + 1 apparato con credenziale non provata: gli stati escono giusti; un id inesistente non compare nella mappa; `scriviEsitiGiro` due volte → restano solo le righe del secondo giro; `deleteScheduledJob` toglie gli esiti; `jobsDelApparato` trova il job che contiene l'id e non quello che contiene 12 cercando 1; una spia sul numero di `prepare` (o `EXPLAIN`) mostra **una** query per 50 id.

**Verifica** prova verde; `db-facade-ratchet` verde e soglia invariata. Revisione del task. Lint, tsc, build. **Commit** `apparati_scelti: funzioni DB dello stato e degli esiti`.

### [ ] Task 4 — Letture estratte, lucchetto per apparato, log senza nomi (completo)

**File**
- Modifica: `src/lib/cron/jobs.ts`: il corpo del `for (const device of devices)` di `runArpPoll` (oggi righe ~853-1250 di `jobs.ts`, rami router e switch) diventa `export async function leggiApparatoArp(device, contesto, opzioni)`; `runArpPoll` lo chiama nel ciclo dentro `conLucchettoApparato`.
- Crea: `src/lib/devices/lucchetto-apparato.ts`.
- Crea: `src/lib/devices/lettura-info.ts` (da `saveDeviceInfo`, `runInfoQuery`, ramo Proxmox, STP della rotta).
- Modifica: `src/app/api/devices/[id]/query/route.ts` (chiama `lettura-info.ts`; prende il lucchetto; occupato → 409).
- Modifica: `letturaSchedaMikrotik` accetta `opzioni: { ignoraCadenza?: boolean }` come `letturaVlanSwitch`.
- Prova: `src/lib/cron/__tests__/lettura-apparato.test.ts`, `src/lib/devices/__tests__/lucchetto-apparato.test.ts`.

**Interfacce (prodotte)**
```ts
// lucchetto-apparato.ts — in memoria, per processo (come i lucchetti di ADR 0006)
export async function conLucchettoApparato<T>(deviceId: number, fn: () => Promise<T>): Promise<{ stato: "fatto"; valore: T } | { stato: "occupato" }>;
export function apparatoOccupato(deviceId: number): boolean;

// jobs.ts
export interface ContestoArp { networks: Network[]; enrichSet: Set<string> | null; porteNonLette: string[]; esitiLetture: Array<EsitoGiro<unknown>> }
export async function leggiApparatoArp(device: NetworkDevice, ctx: ContestoArp,
  opzioni?: RunArpPollOptions & { vlan?: "come_il_giro" | "no" }): Promise<void>; // lancia come oggi il corpo del try

// lettura-info.ts
export type EsitoInfo = { stato: "letto"; campi: number } | { stato: "vuoto" } | { stato: "errore"; codice: string };
export async function leggiInfoApparato(device: NetworkDevice, log?: (riga: string) => void): Promise<EsitoInfo>;
```
`leggiInfoApparato` sceglie il ramo con la **stessa** logica di oggi del POST (Windows/SSH/NAS → `runInfoQuery`; router ARP e switch → `saveDeviceInfo` + STP per gli switch; SNMP-info; Proxmox → `runProxmoxDeviceScan`): quella logica si sposta in `tipoLetturaApparato(device)` dentro `lettura-info.ts` e la rotta la usa per scegliere anche la parte ARP/MAC, così la scelta resta una sola. `log` riceve le righe del progresso di «Interroga» (la rotta passa `plog`).

Log: le cinque righe con `device.name` diventano `apparato #${device.id}` + codice (`codiceTrasporto(err)` o `err.code`), i messaggi con IP passano per la maschera `<ip>`.

**Prove (vista rossa prima del codice)**
- **tutte le prove di oggi** `arp-router-porte`, `arp-letture-mikrotik`, `arp-letture-snmp`, `arp-letture-switch-vlan`, `mac-porta-sicura` restano verdi **senza toccarle** (sono la prova che `runArpPoll` fa quello di prima);
- `leggiApparatoArp(switch, ctx, { vlan: "no" })` con l'interruttore `switch_vlan` acceso: nessuna walk Q-BRIDGE (spia `creaWalkSnmp`), tabella MAC scritta;
- `runArpPoll` con lo stesso apparato già nel lucchetto: quell'apparato non si legge (spia del client a zero chiamate), gli altri sì;
- `conLucchettoApparato`: due chiamate insieme → la seconda `occupato`; dopo un `fn` che lancia, il lucchetto è libero;
- log: un client finto che lancia `Error("timeout 192.0.2.5")` → in `console.error`/`warn` catturati non compare né `192.0.2.5` né il nome dell'apparato.

**Verifica** suite `src/lib/cron/__tests__` e `src/lib/devices/__tests__` verdi; sulla copia dell'hub in locale «Interroga» su SW-CED-48POE-242 e MK-RTR-CORE dà lo stesso progresso di prima (righe a confronto nel Registro). Revisione del task. Lint, tsc, build. **Commit** `letture per apparato riusabili, lucchetto condiviso, log senza nomi` + rilascio.

### [ ] Task 5 — Il giro `apparati_scelti` (completo)

**File**
- Crea: `src/lib/apparati-scelti/giro.ts`.
- Modifica: `src/lib/cron/jobs.ts` (`case "apparati_scelti"` in `runJob`).
- Modifica: `src/lib/cron/scheduler.ts` (`initializeScheduler`, `reloadTenantScheduler` e `scheduleJob` passano l'ora di `config` per `apparati_scelti`: `scheduleJob(key, jobId, interval, tenant, jobType, ora?)`).
- Prova: `src/lib/apparati-scelti/__tests__/giro.test.ts`.

**Interfacce**
```ts
export const TEMPO_APPARATO_MS = 5 * 60_000;
export interface OpzioniGiro extends Pick<RunArpPollOptions, "creaClientRouter" | "creaClientSwitch" | "creaWalkSnmp" | "apriEsecutore" | "adesso"> {
  leggiInfo?: typeof leggiInfoApparato; // solo per le prove
  tempoApparatoMs?: number;             // solo per le prove
}
export interface EsitoGiroApparati { letti: number; totale: number; esclusi: number; perLettura: Record<Lettura, { letti: number; su: number }> }
export async function runApparatiScelti(jobId: number, opzioni?: OpzioniGiro): Promise<EsitoGiroApparati>;
```
Passi: `leggiConfig` (null → lancia «Config del job non valida»); cancella gli esiti orfani; `statoApparatiPerDevice(device_ids)`; per ogni id in ordine: assente → escluso TOLTO; `valutaApparato` → escluso col motivo; altrimenti `conLucchettoApparato` (occupato → `saltato`, `OCCUPATO`) con dentro, entro `TEMPO_APPARATO_MS`: `info` (se scelta e valida) → `leggiInfoApparato`; `porte_mac` → `leggiApparatoArp(device, ctx, { vlan: "no" })`; `vlan` → `letturaVlanSwitch(device, opzioni, { ignoraCadenza: true })` o `letturaSchedaMikrotik(device, opzioni, { ignoraCadenza: true })`, con `saltato/spenta` → `spenta`. Stato della riga: tutte le scelte valide lette → `ok`; alcune → `parziale`; nessuna → `errore`. Alla fine `scriviEsitiGiro` e una riga di log di soli numeri; `runJob` restituisce `{ esito: "eseguito", motivo: "2 letti su 3; 1 escluso" }` o lancia «Nessun apparato letto: 0 su N».

**Prove (vista rossa prima del codice)**, con client finti e tenant di prova:
1. 3 inclusi (switch, router MikroTik, hypervisor) + 1 escluso → 3 righe `ok`, 1 `escluso`, l'hypervisor ha solo `info`, motivo «3 letti su 3; 1 escluso»;
2. apparato tolto dopo la creazione → `escluso` `TOLTO`, gli altri letti;
3. credenziale messa a `validated = 0` dopo la creazione → `escluso` `CREDENZIALE_NON_PROVATA`, nessuna chiamata al client per quell'apparato;
4. apparato nel lucchetto (preso dalla prova) → `saltato` `OCCUPATO`, nessuna chiamata;
5. client che non risponde con `tempoApparatoMs` 50 → `errore` `TEMPO_SCADUTO`, si passa al prossimo;
6. VLAN scelta con `switch_vlan` spento → lettura `spenta`, riga `ok` se il resto è letto, nessuna walk;
7. VLAN scelta con `switch_vlan` acceso e lettura di 10 minuti fa → si legge lo stesso (cadenza ignorata);
8. tutti in errore → `runJob` lancia, gli esiti sono comunque scritti;
9. `cosa.porte_mac = false` → il client dello switch non si crea;
10. log catturati: niente nomi né IP; `scheduleJob` di un giornaliero alle 02:00 registra `0 2 * * *` (spia su `cron.schedule`).

**Verifica** prove verdi; **prova a vuoto sulla copia dell'hub** in locale: job creato da script con i 3 apparati della tavola (SW-CED-48POE-242, MK-RTR-CORE, DA-PX-01) e `runApparatiScelti` con i client finti che registrano le chiamate (nessun traffico verso gli apparati): esiti scritti, nessuna altra tabella cambiata (conteggi prima/dopo nel Registro). Revisione del task. Lint, tsc, build. **Commit** `apparati_scelti: il giro, con esito per apparato` + rilascio (il tipo esiste, nessun job si crea da solo: nulla gira finché un admin non lo crea).

### [ ] Task 6 — Rotte API (completo)

**File**
- Crea: `src/app/api/jobs/apparati-scelti/anteprima/route.ts` — `POST { host_ids: number[] }` (admin): per ogni host `{ host_id, device_id, nome, ip, tipo_scheda, credenziale: "provata"|"non_provata"|"nessuna", incluso, motivo?, testo_motivo?, link? , letture_valide }` + `interruttori: { switch_vlan, mikrotik_scheda }`; più di 50 host → 400 «Al più 50 apparati per job».
- Crea: `src/app/api/jobs/apparati-scelti/route.ts` — `POST { nome, host_ids, frequenza, cosa }` (admin): ricalcola l'idoneità, tiene solo gli inclusi, 0 inclusi → 400 «Nessun apparato con credenziale provata»; crea con `createScheduledJob({ job_type: "apparati_scelti", interval_minutes, config })`; `reloadTenantScheduler`; 201 `{ id, inclusi, esclusi: [{ host_id, motivo }] }`.
- Crea: `src/app/api/jobs/apparati-scelti/[id]/route.ts` — `GET` (admin: config, frequenza, stato degli apparati, per la finestra in modifica); `PUT { nome?, device_ids?, frequenza?, cosa? }` (admin): `device_ids` solo sottoinsieme di quelli che ci sono (aggiungere da qui → 400 «Gli apparati si aggiungono da Discovery»); aggiorna config e intervallo, `reloadTenantScheduler`.
- Crea: `src/app/api/jobs/apparati-scelti/[id]/esiti/route.ts` — `GET` (admin): `leggiEsitiJob`.
- Crea: `src/app/api/devices/[id]/scansione-automatica/route.ts` — `GET` (`requireAuth`): `{ jobs: [{ id, nome, frequenza: string, attivo, ultima: string|null, prossima: string|null, esito: { stato, giro_il } | null }] }`.
- Modifica: `src/app/api/jobs/route.ts` (`GET` aggiunge `riassunto` e `frequenza` per le righe `apparati_scelti` con `riassuntiEsitiJobs`, una query; `PUT` con `interval_minutes` su un `apparati_scelti` → 409; `DELETE` passa da `deleteScheduledJob`, che cancella anche gli esiti).
- Modifica: `src/lib/permessi/rotte.ts`, `src/lib/__tests__/api-auth-guards.test.ts` (`CONTRACT`), `src/lib/validators.ts` solo se serve un tipo condiviso (lo schema sta in `regole.ts`).
- Prova: `src/app/api/jobs/apparati-scelti/__tests__/route.test.ts`.

**Prove (vista rossa prima del codice)** viewer → 403 su POST/PUT/anteprima/esiti, 200 sulla GET della testata; POST con un host non apparato e uno senza credenziale → creato con 2 inclusi su 4, esclusi coi motivi; 0 inclusi → 400; 51 host → 400; PUT che aggiunge un id → 400; PUT generico con `interval_minutes` su `apparati_scelti` → 409, su `fast_scan` → 200 come prima; DELETE → esiti spariti; nella risposta della GET della testata nessun campo con IP di altri apparati.

**Verifica** prove verdi, `rotte-censite` e `api-auth-guards` verdi, `scripts/verifica-permessi.sh` verde. Revisione del task. Lint, tsc, build. **Commit** `apparati_scelti: rotte di anteprima, creazione, modifica, esiti` + rilascio.

### [ ] Task 7 — J1 e J2 in Discovery (leggero)

**File**
- Crea: `src/components/jobs/finestra-scansione-automatica.tsx` (modo `crea` con `hostIds`, modo `modifica` con `jobId`).
- Modifica: `src/app/(dashboard)/discovery/page.tsx`: nella barra della selezione (oggi ~riga 2069) un pulsante **«↻ Scansione automatica…»** solo con `admin`, dopo «Aggiorna selezionati» e prima di «Crea asset NIS2»; con più di 50 selezionati il pulsante dice «(50 su N)» e la finestra lo spiega, come «Rendi apparato».

**Cosa fare** (rileggere J2 prima): la finestra chiama l'anteprima; righe con nome · tipo, pastiglia della credenziale (✓ credenziale provata / ▲ credenziale non provata / ▲ nessuna credenziale memorizzata / ● non è un apparato) e ✓ incluso / ✕ escluso; esclusi su fondo grigio col link («Rendi apparato ›» apre la finestra che c'è, «Assegna credenziale ›» e «Prova credenziali ›» aprono la scheda `/objects/<host_id>`). **Frequenza**: tre radio, ogni 4 ore predefinita, ora predefinita 02:00, «· prossima HH:MM» calcolata con `prossimaEsecuzione`. **Cosa legge**: tre caselle, ognuna con i nomi degli apparati a cui vale (troncati con «+N»), nascosta se non vale per nessuno; VLAN spenta con «lettura VLAN spenta in Impostazioni» se l'interruttore è spento. **Nome del job**. Piede: «N inclusi · M esclusi», Annulla, **«Crea job (N apparati)»** (spento con 0 e «▲ nessun apparato con credenziale provata»). Dopo la creazione: toast «Job creato: N apparati, ogni 4 ore» con link alla pagina dei job; la selezione resta.

**Verifica** sulla copia dell'hub in locale, selezionati i 4 host della tavola (SW-CED-48POE-242, MK-RTR-CORE, DA-PX-01 e un host non apparato): finestra resa a **1440×900** e **1920×1080**, confronto con J2 (screenshot nello scratchpad); un job creato davvero sulla copia (riga in `scheduled_jobs`). Lint, tsc, build. **Commit** `Discovery: scansione automatica dei device scelti (J1, J2)` + rilascio.

### [ ] Task 8 — J3 nella pagina dei job (leggero)

**File**
- Modifica: `src/app/(dashboard)/settings/page.tsx` (tab «Job pianificati», tabella di ~riga 1042; `JOB_TYPE_LABELS` con `apparati_scelti: "Lettura apparati"`).
- Modifica: `src/lib/scheduled-job-types.ts` (`scheduledJobLabel`: per `apparati_scelti` il `nome` di config).
- Crea: `src/components/jobs/esiti-apparati-scelti.tsx` (dettaglio per apparato).

**Cosa fare** nessuna colonna nuova (le altre righe restano come sono): per una riga `apparati_scelti` — cella Tipo: **nome del job** + «Lettura apparati · N apparati»; Rete: «—»; Intervallo: `etichettaFrequenza`; Ultima esecuzione: ora + pastiglia **«✓ 3/3»** (tutti letti), **«▲ 2/3 · 1 escluso»** (parziale), **«✕ 0/3»** (nessuno), «Mai» se non è girato; Prossima: `prossimaEsecuzione` (non il `next_run` del DB, che per questi job non segue il cron); azioni: «Esegui ora», **«Modifica»** (apre la finestra del Task 7 in modo modifica), «Elimina» con conferma che dice il nome; «Sospendi» = l'interruttore Attivo. Clic sulla pastiglia dell'esito → riga che si apre con una riga per apparato: nome (link alla scheda), stato (✓ letto / ▲ parziale / ✕ errore / ● escluso / ● saltato), per lettura ✓/✕/— col codice, ora in **ora italiana**. Il select «Nuovo job» **non** offre `apparati_scelti` (si crea da Discovery).

**Verifica** sulla copia, col job del Task 7 e un giro fatto con la prova a vuoto del Task 5 (esiti scritti): resa a 1440 e 1920, confronto con J3, dettaglio aperto, modifica di frequenza salvata (riga in `scheduled_jobs` cambiata, cron ricaricato nel log). Lint, tsc, build. **Commit** `Job pianificati: riga e esiti della scansione automatica (J3)` + rilascio.

### [ ] Task 9 — J4 nella testata della scheda (leggero)

**File**
- Modifica: `src/components/scheda/intestazione-scheda.tsx` (prop `scansioneAutomatica?: { jobId: number; frequenza: string; ultima: string | null; prossima: string | null; altri: number } | null`).
- Modifica: `src/app/(dashboard)/objects/[id]/page.tsx` (fetch di `/api/devices/<device.id>/scansione-automatica` con `fetchJson`, solo se c'è un apparato).

**Cosa fare** dopo la pastiglia della credenziale: pastiglia **«↻ in scansione automatica · ogni 4 ore»** (stile neutro con bordo, come «● offline» della tavola: fondo bianco, bordo grigio scuro, testo scuro), link a `/settings?tab=jobs#job-<id>` (la pagina legge già `?tab=`; si aggiunge l'`id` di riga per l'ancora); con più job «+1»; job sospeso → «↻ scansione automatica sospesa». Testo «ultima lettura HH:MM · prossima HH:MM» prima delle azioni, in ora italiana, nascosto sotto `lg` se non c'è posto (il nome dell'apparato resta leggibile, come fa già la riga). «Aggiorna» invariato.

**Verifica** sulla copia: scheda di SW-CED-48POE-242 (nel job) e di un apparato fuori dal job (nessuna pastiglia), a 1440 e 1920, confronto con J4; il nome non si tronca a 1440. Lint, tsc, build. **Commit** `Scheda: pastiglia della scansione automatica (J4)` + rilascio.

### [ ] Task 10 — Accensione sull'hub e documenti (completo, sessione principale)

**Cosa fare**
1. Hub aggiornato alla versione del Task 9 (`DA_COMMIT`, riga d'avvio nel journal); righe delle migrazioni v11 e `apparati_scelti_v21` nel journal.
2. **Chiedere a Riccardo l'ok** a creare il job sull'hub (scrittura sul DB dell'hub, `CLAUDE.md` del repo): job «Apparati scelti» con SW-CED-48POE-242, MK-RTR-CORE, DA-PX-01, ogni 4 ore, tutte le letture valide; crearlo dalla finestra J2 con `prova-claude` non basta (è in sola lettura): lo crea Riccardo o un admin con le istruzioni passo passo.
3. «Esegui ora» dalla pagina dei job → esito «✓ 3/3» (o i codici veri, nel Registro); `SELECT stato, motivo FROM job_apparati_esiti` sull'hub; journal: le righe `apparati_scelti` hanno solo numeri (`journalctl -u da-invent --since … | grep apparati_scelti`); l'ora del primo giro automatico e la sua riga.
4. Documenti: ADR **0030** «job sugli apparati scelti: letture riusate, lucchetto per apparato, interruttori rispettati» (con «cosa diventa difficile»); `CHANGELOG.md` (il perché); `CONTEXT.md` §6 (una voce: dove sta, trappole: lucchetto in memoria come ADR 0006, `next_run` non vale per questi job, VLAN dietro l'interruttore); `docs/scheda-mappa.md` e `python3 ~/Progetti/genera_mappa.py`; in `TASKS.md` il punto (a) del 22/10 («job `arp_poll` sull'hub?») si chiude rimandando a questo job, se Riccardo è d'accordo.

**Verifica** esiti sul dato vero scritti nel Registro con data e fonte (hub). **Commit** `apparati_scelti: acceso sull'hub, ADR 0030, documenti`.

---

## Proposte (fuori da questo giro, da approvare)

- «Aggiungi al job…» da Discovery su un job che esiste (oggi si crea un job nuovo o si toglie da «Modifica»).
- Avviso quando un apparato resta escluso per due giri di fila (oggi si vede solo in J3).
- Storico degli esiti (oggi solo l'ultimo per apparato).

## Dubbi aperti (con la scelta del piano)

1. **VLAN dietro l'interruttore** anche nel job (scelta: sì, come «Interroga»). Sull'hub `switch_vlan` è acceso; se `mikrotik_scheda` è spento, MK-RTR-CORE avrà VLAN «— spenta»: da guardare al Task 10.
2. **Copia del DB del cliente A** non disponibile (punto (f) del 22/10): la v11 ricostruisce `scheduled_jobs` anche là al primo push del Task 1. Scelta: misura sulla copia dell'hub e stessa forma della v10, già passata sul cliente A.
3. «Informazioni» per un hypervisor Proxmox = la scansione Proxmox intera (come «Aggiorna»), più pesante delle informazioni di uno switch.

## Registro

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo

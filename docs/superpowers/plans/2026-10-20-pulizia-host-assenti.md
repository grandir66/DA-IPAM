# Pulizia degli host assenti e dei cambi di IP — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` (scelta di Riccardo il 20/10): un
> subagent per task, revisione per task (livello completo). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** archiviare (e dopo 90 giorni cancellare) gli host assenti da oltre 60 giorni e i
vecchi IP di un MAC che ha cambiato indirizzo, con anteprima a mano, recupero con un clic e job
notturno spento di default.

**Architettura:** scelta **A** (Riccardo, 20/10): una tabella `hosts_archivio` nel DB del tenant
tiene l'istantanea JSON dell'host, poi l'host si cancella con un `DELETE` diretto (le figlie
seguono le loro regole ON DELETE). La selezione dei candidati è un modulo puro
(`src/lib/hosts/pulizia.ts`) alimentato da un caricatore SQL; anteprima, «Applica», recupero e
job passano tutti da `src/lib/hosts/pulizia-archivio.ts`. Nessuna delle 252 query su `hosts` si tocca.

**Spec:** `docs/superpowers/specs/2026-10-20-pulizia-host-assenti-design.md`.
**Livello di controllo:** completo (zona rossa: dati del cliente, cancellazioni), deciso da Riccardo il 20/10.

## Vincoli globali

- Soglie: `GIORNI_ASSENZA_ARCHIVIO = 60`, `GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE = 90` (decisione 1).
- Esclusi da OGNI archiviazione (decisione 2): `network_devices.host_id = h.id`; `h.known_host = 1`;
  `h.custom_name` non vuoto (`TRIM(...) <> ''`); `inventory_assets.host_id = h.id`; una riga in
  `host_credentials`; una riga attiva in `topology_unioni` con `membro = 'host:' || h.id` e
  `tolto_il IS NULL`; una riga in `multihomed_links`. `notes` **non** esclude.
- Cambio IP (decisione 3): gruppo per MAC normalizzato con `macToHex` (`src/lib/utils.ts`), MAC
  validi soltanto (12 cifre esadecimali, non `000000000000`); si archiviano **subito** gli host
  `offline` del gruppo solo se nel gruppo c'è **esattamente un** host `online` e l'host offline ha
  `last_seen` < `last_seen` dell'online. Gruppo con ≥2 online: non si tocca niente.
- Solo `status = 'offline'` è candidato; `online` e `unknown` mai.
- Esecuzione (decisione 4): tutto nasce spento. Anteprima = prova a vuoto, non scrive niente.
  «Applica» vuole il numero scritto dall'utente. Il job notturno si accende solo dall'interruttore.
- Archiviare **non** scrive `excluded_ips` (a differenza di `deleteHost`): se l'oggetto torna, la
  scansione lo ritrova.
- Date: `last_seen` è formato SQLite; confronti in SQL con `datetime('now', …)`, in TS con
  `parseDbDate`. Mai `new Date(x)` su una data del DB (CONTEXT §8).
- Import di `db-tenant` **solo statico** (CONTEXT §7, prova `no-dynamic-db-tenant-import`).
- Un push di codice su `dev` arriva al cliente A entro 15 minuti: si lavora in un worktree
  (`~/Progetti/Domarc/.worktrees/da-ipam-pulizia`, ramo `pulizia-host-assenti` da `origin/dev`) e
  si pubblica su `dev` **una volta**, al task 7, a cancello verde.
- Cancello (CONTEXT §5), con log nello scratchpad e codice d'uscita letto:
  `DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ipam-t.XXXXXX") npm test > "$LOG" 2>&1; ESITO=$?`,
  poi `npx tsc --noEmit` e `npm run lint`. Cadono a caso (e da sole passano): `credential-chains`,
  `parita-gruppo0`, `ssh-connessione-caduta`, `ssh-chiave`, `chiave-ssh-percorsi`.
- Ogni prova nuova si **vede fallire** prima del codice; l'output rosso va nel resoconto del task.

## Due punti fuori dalla specifica — P1 e P2 approvati da Riccardo il 20/10 come proposti

- **P1. Il vecchio job `cleanup`** («Pulizia Host» nella pagina dei job) chiama
  `cleanupStaleHosts(30, 90)` in `db-tenant.ts:6079`: dopo 30 giorni di offline sovrascrive
  la classificazione con `stale`, dopo 90 **cancella** senza nessuna delle esclusioni della
  decisione 2 (apparati, credenziali, asset, unioni). Sull'hub (70791, 70791a, DEFAULT) non c'è
  nessun job `cleanup` e nessun host `stale` (letto il 20/10); il cliente A non l'ho controllato.
  Proposta: il job `cleanup` smette di toccare gli host (resta la pulizia di `mac_port_entries`);
  la pulizia degli host la fa solo il codice nuovo. → Task 3.
- **P2. Un host archiviato che torna in rete** viene ritrovato dalla scansione come host nuovo
  (id nuovo, senza nome né note dell'archivio). Proposta: niente recupero automatico; la riga
  d'archivio resta fino ai suoi 90 giorni e nell'elenco dell'archivio mostra «Di nuovo in rete:
  <IP>» se un host online ha lo stesso MAC; «Recupera» su un IP occupato si rifiuta e dice da chi.

## Casi da non dimenticare

1. Host **mai visto** (`last_seen IS NULL`): la data di riferimento è `first_seen`, poi
   `created_at`; un host appena creato con `last_seen` nullo non si archivia. → Task 2.
2. **Recupero su un IP già occupato** (`UNIQUE(network_id, ip)`) o con la **rete cancellata**:
   rifiuto con il motivo a schermo, nessuna scrittura. → Task 1.
3. **«Applica» con un elenco vecchio**: fra anteprima e «Applica» lo stato cambia; si archivia solo
   l'intersezione fra gli id mandati e i candidati di adesso, e gli altri si elencano per nome come
   «non più candidati». Numero confermato ≠ numero di id mandati → 400. → Task 4.
4. **Colonne di `hosts` che cambieranno**: l'istantanea è `SELECT *` (meno la colonna generata
   `os_family`); il recupero reinserisce solo le colonne che esistono adesso
   (`PRAGMA table_info(hosts)`). → Task 1.
5. **Archivio mai ripulito a job spento**: la cancellazione dei 90 giorni gira anche a ogni
   «Applica», non solo nel job. → Task 4.

---

## Task 1 — Tabella d'archivio, archiviazione, recupero, audit

- [ ] fatto

**File**
- modifica `src/lib/db-tenant-schema.ts`: tabella `hosts_archivio` + indici, sul modello di
  `TABELLE_TOPOLOGY_UNIONI` / `INDICI_TOPOLOGY_UNIONI` (righe 111-122), creata in `getTenantDb`
  come quelle.
- modifica `src/lib/transfer/table-registry.ts`: `{ table: "hosts_archivio", scope: "tenant", tier: … }`
  con lo stesso `tier` degli host (la prova `transfer/__tests__/registry.test.ts` lo pretende).
- crea `src/lib/hosts/pulizia-archivio.ts`, `src/lib/hosts/registro-pulizia.ts`.
- prova `src/lib/hosts/__tests__/pulizia-archivio.test.ts`.

**Schema**
```sql
CREATE TABLE IF NOT EXISTS hosts_archivio (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id_originale INTEGER NOT NULL,
  network_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  mac_hex TEXT,                         -- macToHex, NULL se MAC assente o non valido
  nome TEXT NOT NULL,                   -- custom_name || hostname || dns_reverse || ip
  motivo TEXT NOT NULL CHECK(motivo IN ('assente', 'cambio_ip')),
  dettaglio TEXT,                       -- «assente da 74 giorni» / «ora 192.168.1.20»
  ultima_vista TEXT,                    -- last_seen dell'host
  istantanea TEXT NOT NULL,             -- JSON: { host: <riga hosts>, ip_precedenti: [{ip, fino_al}] }
  archiviato_il TEXT NOT NULL DEFAULT (datetime('now')),
  archiviato_da TEXT NOT NULL,          -- username, oppure 'job'
  recuperato_il TEXT, recuperato_da TEXT, nuovo_host_id INTEGER
);
CREATE INDEX idx_hosts_archivio_mac ON hosts_archivio(mac_hex);
CREATE INDEX idx_hosts_archivio_il ON hosts_archivio(archiviato_il);
```

**Interfacce prodotte** (`pulizia-archivio.ts`, importa `db`/`runInTenantTransaction` da `db-tenant` staticamente)
```ts
export const GIORNI_ARCHIVIO_PRIMA_DI_CANCELLARE = 90;
export type MotivoPulizia = "assente" | "cambio_ip";
export interface RigaArchivio { id: number; hostIdOriginale: number; networkId: number; ip: string;
  macHex: string | null; nome: string; motivo: MotivoPulizia; dettaglio: string | null;
  ultimaVista: string | null; archiviatoIl: string; archiviatoDa: string;
  recuperatoIl: string | null; nuovoHostId: number | null;
  /** Calcolato in lettura: IP di un host online con lo stesso MAC adesso (P2). */
  diNuovoInRete: string | null; }
export function archiviaHost(hostId: number, motivo: MotivoPulizia, dettaglio: string, da: string): RigaArchivio;
export type EsitoRecupero = { ok: true; nuovoHostId: number } | { ok: false; motivo: string };
export function recuperaHost(archivioId: number, da: string): EsitoRecupero;
export function cancellaArchivioScaduto(): Array<{ id: number; ip: string; nome: string }>;
export function listaArchivio(limite = 500): { righe: RigaArchivio[]; totale: number }; // non recuperati, più recenti prima (regola 9 del CLAUDE.md)
export function contaArchiviati(): number;                // non recuperati
export function ipPrecedentiDi(hostId: number): Array<{ ip: string; fino_al: string; fonte: "storico" | "archivio" }>;
```
- `archiviaHost`: in `runInTenantTransaction`: `SELECT * FROM hosts WHERE id = ?` (assente →
  errore «host #N non trovato»), toglie `os_family`, legge `ip_precedenti` da `mac_ip_history`
  (`WHERE mac_normalized = ? AND ip <> ?`, `GROUP BY ip`, `MAX(changed_at) AS fino_al`), `INSERT`
  in `hosts_archivio`, poi `DELETE FROM hosts WHERE id = ?` **diretto** (non `deleteHost`: niente
  `excluded_ips`). Poi una riga di audit.
- `recuperaHost`: riga già recuperata → `{ok:false, motivo:"già recuperato il …"}`; rete assente →
  «la rete non esiste più»; `(network_id, ip)` occupato → «l'IP <ip> è di nuovo in uso da <nome>
  (#id)». Altrimenti `INSERT INTO hosts` delle sole colonne dell'istantanea presenti in
  `PRAGMA table_info(hosts)` meno `id` e le generate (`hidden <> 0` in `PRAGMA table_xinfo`), con
  `status = 'offline'`; aggiorna `recuperato_il/da`, `nuovo_host_id`; audit.
- `cancellaArchivioScaduto`: `DELETE … WHERE archiviato_il < datetime('now', '-90 days')`
  (recuperate comprese), restituisce i nomi cancellati; audit per riga.
- `ipPrecedentiDi`: dallo storico (`mac_ip_history` del MAC dell'host, IP diversi dall'attuale) e
  dall'archivio (`mac_hex` uguale, non recuperate), un IP una volta sola, `fino_al` più recente prima.

**Audit** (`registro-pulizia.ts`, sul modello di `src/lib/db-maintenance/ripieghi.ts:166-182`):
`scriviRegistroPulizia(riga: { azione: "archivia" | "recupera" | "cancella"; tenant: string | null;
archivioId: number; hostId: number | null; ip: string; mac: string | null; nome: string;
motivo: string; da: string }, adesso = new Date()): void` → `${resolveDataDir()}/audit/pulizia-host-YYYY-MM-DD.jsonl`
con `il` ISO; conserva 400 giorni (la pulizia dei file la fa il modulo, una volta al giorno).
Tenant da `getCurrentTenantCode()`. Un errore di scrittura del registro **fa fallire**
l'operazione (si scrive prima del `COMMIT`; niente `catch` muto).

**Prove** (tenant di prova come `src/lib/__tests__/assenti-salute.test.ts`, con
`support/data-dir-isolata`):
1. archivia → recupera un host con tutti i campi d'identità pieni (ip, mac, hostname, dns_*,
   classification, classification_manual, notes, vendor, os_info, first_seen, last_seen):
   ogni campo uguale all'originale, `status` = offline, `id` diverso.
2. dopo l'archiviazione le figlie CASCADE (`status_history`) sono sparite, le SET NULL
   (`dhcp_leases`) restano con `host_id` NULL, `excluded_ips` vuota.
3. recupero rifiutato: IP occupato (messaggio col nome), rete cancellata, già recuperato; nessuna
   riga nuova in `hosts`.
4. `cancellaArchivioScaduto` toglie la riga a 91 giorni e lascia quella a 89.
5. una riga JSONL per operazione, con `azione` e `nome`; registro non scrivibile (cartella resa
   file) → l'archiviazione fallisce e l'host è ancora in `hosts`.
6. `ipPrecedentiDi` con uno storico di tre IP e una riga d'archivio dello stesso MAC.

**Verifica:** `node --import tsx --test src/lib/hosts/__tests__/pulizia-archivio.test.ts src/lib/transfer/__tests__/registry.test.ts` verde; `npx tsc --noEmit`.
**Commit:** `feat(hosts): archivio degli host con istantanea, recupero e registro`

## Task 2 — Selezione dei candidati (regole 1-3)

- [ ] fatto

**File:** crea `src/lib/hosts/pulizia.ts` (puro: niente DB, niente Node) e
`src/lib/hosts/pulizia-candidati.ts` (caricatore SQL); prove
`src/lib/hosts/__tests__/pulizia.test.ts` (regole sul modulo puro) e
`src/lib/hosts/__tests__/pulizia-candidati.test.ts` (esclusioni sul DB vero di prova).

**Interfacce**
```ts
// pulizia.ts
export const GIORNI_ASSENZA_ARCHIVIO = 60;
export interface HostPerPulizia { id: number; ip: string; mac: string | null; nome: string;
  status: "online" | "offline" | "unknown"; lastSeen: string | null; firstSeen: string | null;
  createdAt: string | null; escluso: string | null; } // escluso = motivo leggibile, es. «apparato», «credenziali»
export interface Candidato { id: number; ip: string; mac: string | null; nome: string;
  ultimaVista: string | null; motivo: "assente" | "cambio_ip"; dettaglio: string; }
export interface EsitoSelezione { candidati: Candidato[]; esclusi: Array<{ id: number; ip: string; nome: string; perche: string }>; }
export function selezionaCandidati(host: HostPerPulizia[], adesso: Date): EsitoSelezione;
// pulizia-candidati.ts
export function caricaHostPerPulizia(): HostPerPulizia[];
export function candidatiPulizia(adesso?: Date): EsitoSelezione; // = selezionaCandidati(caricaHostPerPulizia(), adesso)
```
- Il caricatore calcola `escluso` in SQL con un `CASE` nell'ordine della decisione 2 (apparato,
  monitorato, nome scritto a mano, asset, credenziali, unione a mano, multihomed), con
  `EXISTS` sulle tabelle; una tabella che manca (DB vecchio) **non** fa ripiegare in silenzio:
  `caricaHostPerPulizia` controlla `sqlite_master` e, se ne manca una, lancia un errore che la nomina.
- `selezionaCandidati`: prima la regola 3 (cambio IP, dettaglio «ora <ip dell'online>»), poi la
  regola 1 sugli altri offline (riferimento `lastSeen ?? firstSeen ?? createdAt`, oltre 60 giorni,
  dettaglio «assente da N giorni»; tutte e tre nulle → non candidato). Un host candidato per le due
  regole compare una volta, col motivo `cambio_ip`. `esclusi` elenca solo gli offline che una regola
  avrebbe preso. Date lette con `parseDbDate`. Ordine: motivo, poi IP numerico.

**Prove** (ognuna vista fallire): offline a 61 g → candidato, a 59 g → no; online/unknown a 200 g
→ no; mai visto con `first_seen` a 70 g → sì, a 10 g → no; cambio IP (1 online, 1 offline più
vecchio) → candidato anche a 2 giorni; offline **più recente** dell'online → no; gruppo con 2
online → nessuno; tutti offline → solo la regola 1; MAC `00:00:00:00:00:00` e MAC vuoto non fanno
gruppo; MAC scritti `aa-bb-…` e `AA:BB:…` sono lo stesso gruppo. Sul DB: una prova per ognuna
delle sette esclusioni (host offline a 100 g con quel legame → in `esclusi` col perché giusto, non
in `candidati`), e `notes` piena non esclude; una tabella di legame tolta → errore che la nomina.

**Verifica:** le due prove verdi; `npx tsc --noEmit`.
**Commit:** `feat(hosts): selezione degli host da archiviare con le esclusioni`

## Task 3 — Il vecchio `cleanup` non tocca più gli host (P1, solo se Riccardo approva)

- [ ] fatto

**File:** modifica `src/lib/cron/jobs.ts:1365` (`runCleanup`): via la chiamata a
`cleanupStaleHosts` e il suo log; resta `cleanupOldMacPortEntries`. In `db-tenant.ts:6079` e
`db.ts` la funzione `cleanupStaleHosts` si toglie se non ha altri chiamanti (`rg --no-ignore
cleanupStaleHosts src`). Etichetta del tipo nella pagina dei job (`settings/page.tsx:957`):
«Pulizia tabelle MAC» invece di «Pulizia Host». Prova `src/lib/cron/__tests__/cleanup-non-tocca-host.test.ts`:
host offline a 200 g + job `cleanup` eseguito con `runJob` → host ancora presente, classificazione
invariata (docstring: P1 del piano, 20/10).
**Verifica:** la prova vista rossa prima della modifica, poi verde.
**Commit:** `fix(cron): il job cleanup non cancella più host senza le esclusioni`

## Task 4 — Anteprima, «Applica», archivio: funzioni e rotte

- [ ] fatto

**File:** aggiunge a `src/lib/hosts/pulizia-archivio.ts`
```ts
export interface EsitoApplica { archiviati: Array<{ id: number; ip: string; nome: string }>;
  nonPiuCandidati: Array<{ id: number; ip: string; nome: string }>;
  cancellatiDallArchivio: Array<{ id: number; ip: string; nome: string }>; }
export function applicaPulizia(ids: number[], conferma: number, da: string): EsitoApplica;
```
(`conferma !== ids.length` o `ids` vuoto → errore `ErroreConferma`; ricalcola `candidatiPulizia()`,
archivia l'intersezione, poi `cancellaArchivioScaduto()`). Rotte, sul modello di
`src/app/api/topology/settings/hypervisor/route.ts` (`withTenantFromSession`, `requireAdmin`, zod
`.strict()`, `NO_STORE`):
- `GET  /api/hosts/pulizia` → `{ candidati, esclusi, giorni: 60, giorniArchivio: 90 }` (admin);
- `POST /api/hosts/pulizia` `{ ids: number[], conferma: number }` → `EsitoApplica` (admin; 400 col messaggio su `ErroreConferma`);
- `GET  /api/hosts/archivio` → `{ righe: RigaArchivio[] }` (admin);
- `POST /api/hosts/archivio/[id]/recupera` → `EsitoRecupero` (admin; 409 con `motivo` se rifiutato);
- `GET  /api/hosts/[id]/ip-precedenti` → `{ righe }` (auth).
Utente da `requireAdmin()` (`s.user.username`, come le altre rotte). Le rotte nuove rispettano i
livelli predefiniti di `src/lib/permessi/rotte.ts` (la prova `rotte-censite` deve restare verde
senza voci nuove; i GET di anteprima e archivio sono admin per scelta → voce in `ATTESI`).

**Prove** `src/lib/hosts/__tests__/pulizia-applica.test.ts`: conferma sbagliata → niente
archiviato; un id non più candidato (tornato online fra anteprima e Applica) → in
`nonPiuCandidati`, ancora in `hosts`; la riga d'archivio a 91 g cancellata da un «Applica».
**Verifica:** prove verdi + `node --import tsx --test src/lib/permessi/__tests__/rotte-censite.test.ts`.
**Commit:** `feat(hosts): anteprima e applica della pulizia, archivio e recupero via API`

## Task 5 — Job notturno `pulizia_host`, spento

- [ ] fatto

**File:** `src/lib/scheduled-job-types.ts`: `"pulizia_host"` in coda con commento (v10);
`src/lib/db-tenant.ts`: `migrateScheduledJobsV10` copia esatta della v9 (righe 233-290) con la
guardia su `'pulizia_host'`, chiamata in `getTenantDb` dopo la v9 (righe 1040-1048), più
`getPuliziaHostSchedule()` / `setPuliziaHostSchedule(on: boolean)` copiati da
`getHypervisorSyncSchedule` / `setHypervisorSyncSchedule` (righe 9385-9420): job presente =
acceso, `interval_minutes = 1440`, config `{}`, spento = riga cancellata. Ora del giro: le 04:00,
con lo stesso meccanismo che mette `hypervisor_sync` alle 03:00 (cercalo con
`rg --no-ignore -n "HYPERVISOR_SYNC_MINUTES|03:00" src/lib/cron`). `src/lib/cron/jobs.ts`
`runJob`: `case "pulizia_host"` → `runPuliziaHost()` in `pulizia-archivio.ts`
(`candidatiPulizia()` → `archiviaHost(…, "job")` per ognuno → `cancellaArchivioScaduto()` →
`console.info("[Scheduler] pulizia_host: N archiviati, M cancellati dall'archivio")`).
Etichetta nei job: «Pulizia host assenti (notte)». Rotta `GET/PUT /api/hosts/pulizia/notturna`
`{ enabled }` (copia della rotta hypervisor, `reloadSchedulerForCurrentTenant()` dopo il PUT).

**Prove** `src/lib/hosts/__tests__/pulizia-job.test.ts`: un DB con la tabella `scheduled_jobs`
della v9 accetta dopo la migrazione un job `pulizia_host` (e la v10 rigirata non fa niente);
nessun job `pulizia_host` su un tenant nuovo; `runJob` del job archivia il candidato e lascia
l'escluso; `setPuliziaHostSchedule(false)` toglie la riga.
**Verifica:** prove verdi; `src/lib/__tests__/scheduled-job-types*.test.ts` verdi.
**Commit:** `feat(cron): job notturno pulizia_host, spento di default`

## Task 6 — Interfaccia: Impostazioni, dashboard, scheda

- [ ] fatto

Oggetti (proposti qui; approvati col piano). Niente colori nuovi: testo, badge `outline`, token esistenti.

**Impostazioni → Sistema**, card «Pulizia degli host assenti» (solo admin, `id="pulizia-host"`),
componente nuovo `src/components/settings/pulizia-host-card.tsx`, montato in
`src/app/(dashboard)/settings/page.tsx` dentro `activeTab === "sistema"` (riga 1171):
```
Pulizia degli host assenti
Host offline da oltre 60 giorni e vecchi IP di un MAC che ha cambiato indirizzo. Gli archiviati
spariscono da liste, conteggi e mappa; si recuperano per 90 giorni, poi si cancellano.
[Interruttore] Pulizia ogni notte alle 04:00 — spenta
[Mostra anteprima]
── Anteprima: 23 host da archiviare ─────────────────────────────────────
 IP            Nome            MAC                 Ultima vista       Motivo
 10.0.1.34     PC-RECEPTION    AA:BB:CC:00:11:22   12/07/2026 09:14   Assente da 100 giorni
 10.0.1.80     10.0.1.80       AA:BB:CC:00:11:99   18/10/2026 17:02   IP cambiato: ora 10.0.1.81
 (e sotto, chiusi in un <details>: «7 esclusi» con IP, nome, perché)
[Archivia questi 23 host…] → finestra: «Scrivi 23 per confermare» [____] [Archivia]
── Archivio (5) ─────────────────────────────────────────────────────────
 IP  Nome  MAC  Motivo  Archiviato il  Cancellato il  Di nuovo in rete  [Recupera]
```
«Recupera» apre una conferma con la frase: «Torna con nome, note e classificazione. Lo storico di
scansioni e stati non torna.» Un rifiuto mostra il `motivo` restituito. Date con `parseDbDate` e
`timeZone: FUSO_UTENTI`; caricamenti con `fetchJson` + `LoadError`; tabelle con `<Table fissa>`.
Dopo «Archivia» la card mostra l'esito per nome (archiviati, non più candidati), non un totale.

**Dashboard** (`src/app/(dashboard)/page.tsx:153`): accanto ad «Assenti» un `Indicatore`
`titolo="Archiviati"`, `valore={contaArchiviati()}`, `href="/settings?tab=sistema#pulizia-host"`,
`nota="Archiviati dalla pulizia: si recuperano per 90 giorni"`, colore `text-muted-foreground`.

**Scheda oggetto** (`src/app/(dashboard)/objects/[id]/page.tsx`, dopo la `Section` «Rete» a
riga 1193): `Section` «IP precedenti» con tabella IP | Fino al | Da dove («storico» /
«archivio»), da `/api/hosts/[id]/ip-precedenti`; la sezione non compare se l'elenco è vuoto.

**Verifica:** laboratorio locale (CONTEXT §9) coi dati finti di forma vera (3 candidati di cui 1
cambio IP, 2 esclusi, 2 archiviati di cui 1 «di nuovo in rete»); Playwright a 1920 px: card con
anteprima aperta, finestra di conferma, archivio, dashboard, scheda con IP precedenti. Una volta.
Schermate nello scratchpad, mostrate a Riccardo nel resoconto.
**Commit:** `feat(ui): pulizia degli host in Impostazioni, archiviati in dashboard, IP precedenti`

## Task 7 — Documenti, cancello completo, rilascio su `dev`, hub aggiornato

- [ ] fatto

- `docs/adr/0022-archivio-host-tabella-a-parte.md` (scelta A, cosa si perde al recupero, «cosa
  diventa difficile»: storico non recuperabile, id nuovo, righe SET NULL non ricollegate).
- `CHANGELOG.md` sotto «[Non rilasciato]» col perché; `CONTEXT.md` §9 (fatto, trappole: niente
  `excluded_ips`, P1/P2 come decisi); `docs/scheda-mappa.md`.
- Cancello completo (vincoli globali); solo a verde: `npm run version:release`, rebase su
  `origin/dev` riletto, `git push origin HEAD:dev`.
- Hub aggiornato con la procedura di CONTEXT §3; verifica che il codice c'è (`DA_COMMIT` della
  build attiva = commit pubblicato, riga d'avvio nel journal dopo il push) e che il job
  `pulizia_host` non esiste in nessun tenant (`sqlite3 -readonly`).
- Sul cliente A non si fa niente: arriva il codice, tutto spento.

## Task 8 — Prova a vuoto e primo «Applica» sull'hub (sessione principale, non un subagent)

- [ ] fatto

1. Anteprima sull'hub (tenant 70791 e 70791a) dalla card o con `GET /api/hosts/pulizia`: elenco
   dei **nomi** con motivo, e gli esclusi, riportati a Riccardo in chat. Confronto con le misure
   della specifica (oltre 60 g attesi fra i 29 «oltre 90» e parte dei 19 «30-90»; 4 gruppi di cambio IP).
2. `df -h` e `du -h` del DB, poi backup `sqlite3 <db> ".backup <db>.bak-YYYYMMDD-HHMMSS"` con
   `PRAGMA quick_check` «ok» sulla copia.
3. **Conferma scritta di Riccardo** sull'elenco. Senza, ci si ferma qui.
4. «Applica»; verifica: archiviati = elenco confermato (per nome), `contaArchiviati()` in dashboard,
   una riga JSONL per host. Recupero di **un** host scelto da Riccardo, campi confrontati.
5. Il job notturno resta spento: lo accende Riccardo quando vuole.

---

## Rilettura del piano (20/10)

Requisiti della spec → task: selezione con motivo 1-3 → T2; anteprima e Applica con conferma → T4,
T6; archiviazione e recupero + audit → T1, T4; job spento con interruttore → T5, T6; IP precedenti
→ T1 (`ipPrecedentiDi`), T4, T6; contatore in dashboard → T6; prove di zona rossa (viste fallire,
prova a vuoto coi nomi, backup, recupero provato) → T1-T5, T8. Firme ricontrollate fra i task.

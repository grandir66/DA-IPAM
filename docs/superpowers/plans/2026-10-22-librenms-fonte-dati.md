# LibreNMS come fonte di dati degli apparati SNMP — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** DA-IPAM legge da LibreNMS locale porte, vicini, VLAN, MAC per porta, ARP, inventario e sensori degli
apparati SNMP, li mostra nella scheda dell'oggetto, e aggiunge a LibreNMS solo gli apparati il cui SNMP risponde.
**Architettura:** client REST esteso con letture; lettori puri che rifiutano una forma non capita; tabelle `librenms_*`
fotografate per parte (ADR 0027/0029); giro dentro il job `librenms_sync` esistente, dietro l'interruttore `librenms`
spento; scheda con fonte dichiarata. La mappa (T1) riceve i vicini solo nel task 9, dietro un secondo interruttore.
**Spec:** [`docs/superpowers/specs/2026-10-22-librenms-fonte-dati-design.md`](../specs/2026-10-22-librenms-fonte-dati-design.md)
**Livello di controllo:** completo per i task 1, 2, 4, 9 (scrivono in LibreNMS dei clienti, migrano il DB, toccano la
mappa accesa sul cliente A); leggero per 3, 5, 6, 7, 8 (proposto il 22/10, da confermare con l'approvazione).
**Stato:** approvato (22/10, risposte sotto in «Registro»), in coda dietro il lavoro dei collector modulari · **Ultimo aggiornamento:** 2026-10-22

## Vincoli globali

- Lavorare in un worktree di `origin/dev` (il `dev` locale del MacBook è indietro e altre sessioni lavorano sul repo).
- Ogni push di codice su `dev` è un rilascio: arriva all'hub (VM 533) e all'appliance del cliente A in ≤15 min. Push
  solo a cancello verde: `npm test` con `DA_INVENT_DATA_DIR` in una cartella temporanea, `npx tsc --noEmit`, `npm run lint`
  (0 errori), `npm run build`; esito letto dal codice di uscita, log nello scratchpad. Poi `npm run version:release`.
- Nessun traffico nuovo verso gli apparati: solo l'API di LibreNMS locale (spec §4.1). Mai `force_add: true`.
- «Non so» non cancella: la funzione che scrive lancia su esito ≠ `letto` (spec §4.2).
- Log ed esiti senza IP, nomi, MAC, community: numeri e codici. Il token non esce dal server.
- Migrazione additiva `librenms_fonte_v21`, CREATE solo nella migrazione, senza `IF NOT EXISTS` (ADR 0029 §4).
- Interruttori spenti di default: `topologia.lettura.librenms` (task 4), `topologia.lettura.librenms_mappa` (task 9).
- Interfaccia da scrivania: resa a 1440 e 1920; colori di stato da `--host-*` (Riccardo è daltonico: luminanza + segno).
- `db-tenant` solo con import statico (ADR 0002).
- API LibreNMS sull'hub: `http://127.0.0.1:8090/api/v0`, header `X-Auth-Token`; il token si ottiene sull'hub con
  `getIntegrationConfig("librenms").apiToken` (env da `/opt/da-invent/.env.local`), mai stampato.
  La prova del 22/10 (spec §2) girava sull'hub con `ssh root@192.168.4.8 'bash -s' < sonda.sh`: token in una variabile,
  header in un file `mktemp` 600 passato a `curl -K`, uscite riassunte in conteggi da `python3`, file tolti alla fine.

## Passi

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | [ ] | Aggiunta corretta (v1/v2c/v3, niente force_add, rifiuto scritto) | implementer | — | prove verdi, una aggiunta rifiutata vista sull'hub | `npm test` mirato + prova a mano su un IP muto |
| S2 | [ ] | Migrazione `librenms_fonte_v21` | implementer | — | migrazione su DB nuovo e sulla copia dell'hub, journal ok | prova migrazione + `integrity_check` |
| S3 | [ ] | Client e lettori puri, con uscite vere anonimizzate | implementer | — | lettori verdi su uscite vere, forma sbagliata = null | `npm test` mirato |
| S4 | [ ] | Scrittura e giro nel job `librenms_sync` | implementer | S2, S3 | prova a vuoto sulla copia dell'hub con l'API vera | numeri contro la tabella della spec §2 |
| S5 | [ ] | Rotte API (dati per oggetto, candidati, aggiunta) | implementer | S4 | rotte in `rotte.ts`, `verifica-permessi.sh` verde | prove rotte |
| S6 | [ ] | Tavola grafica, approvazione di Riccardo | orchestratore | S5 | Riccardo dice ok | — |
| S7 | [ ] | Scheda: Sensori, Porte e Vicini con fonte, «Dati da:» | implementer | S6 | resa 1440/1920 vista | Playwright |
| S8 | [ ] | Pagina del modulo: non interrogati, rifiutati, candidati | implementer | S6 | resa 1440/1920 vista | Playwright |
| S9 | [ ] | Vicini di LibreNMS nella mappa (zona rossa) | orchestratore | S4 | misura prima/dopo, spento = bit per bit | `scripts/misura-cavi.ts` |
| S10 | [ ] | Accensione sull'hub, ADR, documenti | orchestratore | S1-S8 (S9 a parte) | numeri sull'hub come la prova a vuoto | `/api/hosts/...` + scheda resa |

## Casi da non dimenticare

1. LibreNMS che risponde 200 con forma nuova (aggiornamento di `latest`): lettore → null, niente scrittura (task 3, 4).
2. Token scaduto o LibreNMS giù: esito `non_raggiungibile`/`auth`, tabelle intatte, avviso nel modulo (task 4, 8).
3. Apparato tolto da LibreNMS: sparisce dalla fotografia al giro dopo; la scheda dice «non più in LibreNMS» (task 4, 7).
4. Due oggetti DA-IPAM con lo stesso IP (cluster, ADR del 22/10 su `primary_host_id`): l'aggancio usa l'IP del principale
   (task 5).
5. Voce v3 con un algoritmo che LibreNMS non accetta: nessun invio, motivo scritto (task 1).

---

### [ ] Task 1 — Aggiunta corretta degli apparati (completo)

**File:** modifica `src/lib/integrations/librenms-sync.ts` (`resolveSnmpParams`, `syncNetworkToLibreNMS` riga ~177,
`addSingleHostToLibreNMS` riga ~277, `campiSnmpPerLibreNms` e `addSingleNetworkDeviceToLibreNMS` riga ~81),
`src/lib/integrations/librenms-api.ts` (`addDevice`: tipo del payload; errore leggibile). Prova nuova
`src/lib/integrations/__tests__/librenms-aggiunta.test.ts`.

**Interfacce prodotte:**

```ts
export type CampiSnmpLibreNms =
  | { snmpver: "v1" | "v2c"; community: string; port: number; snmp_disable: false }
  | { snmpver: "v3"; authlevel: "noAuthNoPriv" | "authNoPriv" | "authPriv"; authname: string;
      authpass?: string; authalgo?: string; cryptopass?: string; cryptoalgo?: string; port: number; snmp_disable: false }
  | { snmp_disable: true; motivo: string };
export function campiSnmpPerLibreNms(device: NetworkDevice): CampiSnmpLibreNms;
export type EsitoAggiunta = { ok: true; librenms_device_id: number; aggiunto: boolean } | { ok: false; codice: "snmp_non_risponde" | "gia_presente" | "rifiutato" | "rete"; messaggio: string };
```

**Cosa fare:**
1. Versione: `network_devices.snmp_version === '1'` → `v1`; credenziale forma `community` → `v2c` (o `v1` come sopra);
   forma `v3` (`credenzialeSnmpApparatoDb` → `cred.record`) → `v3`: `authlevel` da `securityLevel`, `authname` =
   `username`, `authpass`/`authalgo` se il livello ha auth, `cryptopass`/`cryptoalgo` se ha priv. Gli algoritmi si
   traducono con una tabella esplicita dai valori di DA-IPAM (leggerli dal tipo di `authProtocol`/`privProtocol` in
   `src/lib/credentials`) ai valori di LibreNMS (`MD5`, `SHA`, `SHA-224`, `SHA-256`, `SHA-384`, `SHA-512`; `DES`, `AES`,
   `AES-192`, `AES-256`); un valore fuori tabella → `{ snmp_disable: true, motivo: "algoritmo … non accettato da LibreNMS" }`.
   Per gli host senza apparato (`resolveSnmpParams`) resta la community della rete, versione v2c (non c'è altra informazione).
2. `force_add: false` nei tre punti. LibreNMS rifiuta con HTTP 500 e un messaggio («Could not connect … snmp …»): si
   traduce in `EsitoAggiunta` con `codice: "snmp_non_risponde"`, e il messaggio si scrive in
   `librenms_host_map.last_status` (prefisso `rifiutato:`) per gli host; per gli apparati di rete nella stessa colonna
   della riga con `network_id = 0`. Nessuna riga di mappa nuova per un rifiuto (resta la vecchia se c'era).
3. Un host senza SNMP oggi va in LibreNMS in ping-only (`snmp_disable: true`) da `addSingleHostToLibreNMS`: resta
   così, ma non più con `force_add`; un rifiuto ICMP si scrive come sopra.
4. Gli apparati già presenti e mai interrogati non si toccano (spec §3.A).

**Prove (prima del codice):** traduzione v1/v2c/v3 con tutti i livelli; algoritmo sconosciuto; `force_add` assente o
`false` nel payload (spia su `fetch`); risposta 500 di LibreNMS → `snmp_non_risponde` e `last_status` scritto; risposta
200 → mappa scritta. Vederle fallire prima.

**Verifica:** `npm test -- src/lib/integrations/__tests__/librenms-aggiunta.test.ts` verde; sull'hub, dopo il rilascio,
«Aggiungi a LibreNMS» su un IP senza SNMP (scelto da Riccardo) → rifiuto visibile, nessun apparato nuovo in LibreNMS
(`/api/v0/devices` stesso numero).

**Commit:** `librenms: aggiunta senza force_add, v1/v2c/v3 dalla credenziale` + `npm run version:release`.

### [ ] Task 2 — Migrazione `librenms_fonte_v21` (completo)

**File:** `src/lib/db-tenant-schema.ts` (`SEGNO_LIBRENMS_FONTE = "librenms_fonte_v21"`), `src/lib/db-tenant.ts`
(`migrateLibrenmsFonte(db): string[]` accanto a `migrateSwitchVlan` riga ~970, chiamata accanto a riga ~2671, livello
letto da `livelloSchemaLibrenms(): number`), `src/lib/transfer/table-registry.ts` (le nove tabelle `tier: "history"`).
Prova `src/lib/__tests__/migrazione-librenms-fonte.test.ts`.

**DDL (livello 1, segno `done:<data>:v1`, una transazione):**

```sql
CREATE TABLE librenms_apparato (librenms_device_id INTEGER PRIMARY KEY, ip TEXT, hostname TEXT, sysname TEXT, os TEXT,
  hardware TEXT, version TEXT, serial TEXT, status INTEGER, last_polled TEXT, last_discovered TEXT, letto_il TEXT NOT NULL);
CREATE TABLE librenms_porta (librenms_device_id INTEGER NOT NULL, port_id INTEGER NOT NULL, if_index INTEGER,
  if_name TEXT, if_alias TEXT, if_type TEXT, oper_status TEXT, admin_status TEXT, speed INTEGER, mac TEXT, vlan INTEGER,
  letto_il TEXT NOT NULL, PRIMARY KEY (librenms_device_id, port_id));
CREATE TABLE librenms_vicino (librenms_device_id INTEGER NOT NULL, link_id INTEGER NOT NULL, local_port_id INTEGER,
  protocol TEXT, remote_hostname TEXT, remote_port TEXT, remote_platform TEXT, remote_device_id INTEGER,
  remote_port_id INTEGER, letto_il TEXT NOT NULL, PRIMARY KEY (librenms_device_id, link_id));
CREATE TABLE librenms_vlan (librenms_device_id INTEGER NOT NULL, vlan_id INTEGER NOT NULL, nome TEXT,
  letto_il TEXT NOT NULL, PRIMARY KEY (librenms_device_id, vlan_id));
CREATE TABLE librenms_mac_porta (librenms_device_id INTEGER NOT NULL, port_id INTEGER NOT NULL, mac TEXT NOT NULL,
  vlan_id INTEGER, visto_il TEXT, letto_il TEXT NOT NULL, PRIMARY KEY (librenms_device_id, port_id, mac));
CREATE TABLE librenms_arp (librenms_device_id INTEGER NOT NULL, port_id INTEGER, mac TEXT NOT NULL, ip TEXT NOT NULL,
  letto_il TEXT NOT NULL, PRIMARY KEY (librenms_device_id, mac, ip));
CREATE TABLE librenms_sensore (sensor_id INTEGER PRIMARY KEY, librenms_device_id INTEGER NOT NULL, classe TEXT NOT NULL,
  descrizione TEXT, valore REAL, limite_basso REAL, limite_alto REAL, aggiornato_il TEXT, letto_il TEXT NOT NULL);
CREATE TABLE librenms_inventario (librenms_device_id INTEGER NOT NULL, ent_index INTEGER NOT NULL, classe TEXT,
  nome TEXT, descrizione TEXT, modello TEXT, seriale TEXT, firmware TEXT, contenuto_in INTEGER,
  letto_il TEXT NOT NULL, PRIMARY KEY (librenms_device_id, ent_index));
CREATE TABLE librenms_lettura (parte TEXT PRIMARY KEY, esito TEXT NOT NULL, righe INTEGER, letto_il TEXT,
  tentato_il TEXT NOT NULL, codice TEXT);
CREATE INDEX idx_librenms_apparato_ip ON librenms_apparato(ip);
CREATE INDEX idx_librenms_sensore_device ON librenms_sensore(librenms_device_id);
```

Le date in formato `YYYY-MM-DD HH:MM:SS` UTC (confrontabili con `datetime('now')`, regola 9 di Domarc). Nessuna FK.

**Prove:** DB nuovo → tabelle e segno; secondo avvio → niente; oggetto con lo stesso nome già presente → migrazione
fallita, tenant aperto, `livelloSchemaLibrenms() === 0`; esportazione/importazione le porta.

**Verifica:** prove verdi; sulla copia dell'hub (`sqlite3 .backup` di `70791.db` nello scratchpad) l'apertura del tenant
migra in < 50 ms, `PRAGMA integrity_check` = ok, riga nel journal.

**Commit:** `librenms: tabelle della fonte (migrazione librenms_fonte_v21)` + release.

### [ ] Task 3 — Client e lettori puri (leggero)

**File:** `src/lib/integrations/librenms-api.ts` (metodi nuovi), nuovo `src/lib/integrations/librenms-lettori.ts`,
prove `src/lib/integrations/__tests__/librenms-lettori.test.ts` con uscite in
`src/lib/integrations/__tests__/fixtures/librenms/*.json`.

**Interfacce:**

```ts
// librenms-api.ts — ogni metodo restituisce il JSON grezzo o lancia con lo status
getRisorsa(percorso: "/devices" | "/ports?columns=…" | "/resources/links" | "/resources/vlans" | "/resources/fdb"
  | "/resources/sensors" | string): Promise<{ status: number; corpo: unknown }>;
// librenms-lettori.ts
export type Esito<T> = { esito: "letto"; righe: T[] } | { esito: "non_so"; codice: string };
export function leggiApparati(corpo: unknown): Esito<RigaApparato>;
export function leggiPorte(corpo: unknown): Esito<RigaPorta>;
export function leggiVicini(corpo: unknown): Esito<RigaVicino>;
export function leggiVlan(corpo: unknown): Esito<RigaVlan>;
export function leggiMacPorta(corpo: unknown): Esito<RigaMacPorta>;
export function leggiArp(corpo: unknown): Esito<RigaArp>;
export function leggiSensori(corpo: unknown): Esito<RigaSensore>;
export function leggiInventario(librenmsDeviceId: number, corpo: unknown): Esito<RigaInventario>;
```

`Riga*` hanno i campi delle colonne del task 2 (senza `letto_il`). Colonne delle porte richieste:
`port_id,device_id,ifIndex,ifName,ifAlias,ifType,ifOperStatus,ifAdminStatus,ifSpeed,ifPhysAddress,ifVlan`.

**Cosa fare:**
1. Sull'hub, in sola lettura, trovare la forma dell'ARP che risponde con righe (`/resources/ip/arp/all`, poi
   `/resources/ip/arp/0.0.0.0/0`); e se esiste una rotta per la VLAN per porta (`ports_vlans`): se non c'è, la parte
   non si fa e si scrive nel registro (spec §4.7). Inventario: `/inventory/{id}/all` per apparato.
2. Salvare le uscite vere come fixture **anonimizzate** (script locale nello scratchpad, non nel repo: IP → 192.0.2.x,
   nomi → `app-N`, MAC → `02:00:00:…`, seriali → `SN-N`), una per parte, più una «forma sconosciuta» per parte.
3. Ogni lettore controlla la forma (`status === "ok"`, chiave attesa, array, tipi dei campi chiave); qualunque deviazione
   → `non_so` con codice (`forma`, `chiave_assente`, `campo_<nome>`). MAC normalizzati minuscoli con `:`.

**Prove:** una per lettore sulla fixture vera (numero di righe e due campi), una sulla forma sconosciuta → `non_so`.

**Verifica:** prove verdi. **Commit:** `librenms: client di lettura e lettori` + release.

### [ ] Task 4 — Scrittura e giro (completo)

**File:** nuovo `src/lib/integrations/librenms-fonte.ts`, modifica `src/lib/topology/letture/interruttori.ts`
(`LETTURE` e `LETTURE_DISPONIBILI` + `"librenms"`, commento con il rimando alla spec), `src/lib/cron/jobs.ts` (caso
`librenms_sync`, riga ~301). Prove `src/lib/integrations/__tests__/librenms-fonte.test.ts`.

**Interfacce:**

```ts
export type Parte = "apparati" | "porte" | "vicini" | "vlan" | "mac_porta" | "arp" | "sensori" | "inventario";
export function scriviParteLibrenms<T>(parte: Parte, esito: Esito<T>, adesso: string): number; // lancia se esito ≠ letto o livello < 1
export async function giroLibrenms(opts?: { ignoraCadenza?: boolean; dip?: DipendenzeGiro }): Promise<EsitoGiro>;
export type EsitoGiro = { saltato: "spento" | "cadenza" | "non_configurato" } | { parti: Record<Parte, { esito: string; righe?: number; codice?: string }>; ms: number };
```

**Cosa fare:**
1. `scriviParteLibrenms`: in una transazione `DELETE FROM librenms_<parte>` + insert delle righe con `letto_il = adesso`,
   e riga in `librenms_lettura`. Esito `non_so` → aggiorna solo `librenms_lettura` (`tentato_il`, `codice`) e lancia.
2. `giroLibrenms`: spento (`letturaAccesa("librenms")` falso) → nemmeno il client si crea. Cadenza 15 min su
   `librenms_lettura` (parte `apparati`, `tentato_il`). Le parti in serie, una che fallisce non ferma le altre.
   Inventario: un apparato alla volta solo per gli apparati con `os` di rete (non `windows`, `linux` generico),
   al più 20 per giro, gli altri al giro dopo (si tiene il punto in `librenms_lettura.codice` della parte `inventario`).
   Esito in `topologia.lettura.librenms.esito` (`chiaveEsito`) con soli numeri e codici.
3. Nel job `librenms_sync`: dopo il push, `await giroLibrenms()` solo nel giro globale (`job.network_id` nullo); un
   errore del giro non fa fallire il push (si scrive nell'esito).
4. Verificare in «Dati della mappa» → «Letture in più» che la card mostri la lettura nuova con l'etichetta
   «LibreNMS (dati degli apparati)»; se la card prende le etichette da una mappa, aggiungerla lì.

**Prove (prima del codice):** spento → zero chiamate (spia); `non_so` non cancella le righe di prima; 200 vuoto →
fotografia vuota; una parte in errore e le altre scritte; cadenza rispettata e `ignoraCadenza`; nessun IP/nome nell'esito.

**Verifica (prova a vuoto):** script `scripts/prova-librenms-fonte.ts` (nel repo, senza segreti): apre la copia locale
dell'hub, interruttore acceso solo nella copia, chiama l'API dell'hub (token passato da stdin, mai in argomento), scrive
nella copia. Atteso, a meno di variazioni del giorno: ~51 apparati, ~1088 porte, ~109 vicini, ~76 VLAN, ~3483 MAC,
~3069 ARP, ~1160 sensori, inventario su ~15 apparati; tempo totale < 10 s. Il DB dell'hub non si tocca.

**Commit:** `librenms: lettura dei dati in tabelle proprie, spenta di default` + release.

### [ ] Task 5 — Rotte API (leggero)

**File:** nuovo `src/app/api/hosts/[id]/librenms/dati/route.ts` (GET, `requireAuth`, `withTenantFromSession`), nuovo
`src/app/api/integrations/librenms/candidati/route.ts` (GET `requireAuth`; POST `requireAdmin` con `{ host_id }` → usa
le funzioni del task 1), `src/lib/permessi/rotte.ts`, funzioni di lettura in `src/lib/integrations/librenms-fonte.ts`.

**Interfacce:**

```ts
// GET /api/hosts/[id]/librenms/dati
{ abbinato: false } | { abbinato: true; librenms_device_id: number; apparato: RigaApparato & { letto_il: string };
  porte: RigaPorta[]; vicini: RigaVicino[]; sensori: RigaSensore[]; inventario: RigaInventario[];
  letture: Record<Parte, { esito: string; letto_il: string | null }> }
// GET /api/integrations/librenms/candidati
{ non_interrogati: { host_id: number | null; nome: string; ip: string; dal: string | null }[];
  rifiutati: { host_id: number; nome: string; ip: string; motivo: string; il: string }[];
  dai_vicini: { host_id: number; nome: string; ip: string; visto_da: string; porta: string }[] }
```

Aggancio: IP dell'host (per un cluster, quello del principale) → `librenms_apparato.ip`, poi `librenms_host_map`.
Vicini «dai_vicini»: `remote_device_id = 0`, `remote_hostname` risolto a un host per nome o MAC (funzione esistente
della topologia, non una nuova); quelli non risolti non compaiono. Liste con LIMIT 500.

**Verifica:** prove delle rotte (auth, non abbinato, abbinato, non admin su POST = 403); `bash scripts/verifica-permessi.sh`.
**Commit:** `librenms: rotte dei dati per oggetto e dei candidati` + release.

### [ ] Task 6 — Tavola grafica (orchestratore, si ferma qui)

Artboard `LibreNMS` nel canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv (stesso URL), con oggetti numerati:
L1 tab «Sensori» (gruppi per classe: temperatura, ventole, alimentazione, ottiche, UPS; valore, limiti, stato con
segno), L2 tab Porte con la colonna fonte e l'ora, L3 tab Vicini con le due fonti e il disaccordo, L4 riga «Dati da:»,
L5 pagina del modulo LibreNMS con le tre liste del task 5 e lo stato della lettura per parte. Dati finti con la forma
vera della prova a vuoto. Larghezza 1920. **Riccardo approva prima dei task 7 e 8.**

### [ ] Task 7 — Scheda dell'oggetto (leggero)

**File:** nuovo `src/components/scheda/tab-sensori.tsx`, registro in `src/components/scheda/tab-scheda.tsx`
(`TAB_DEL_TIPO`) e `src/lib/scheda/tipo-scheda.ts` (`tabDelTipo`: Sensori per ogni tipo, visibile solo con sensori),
`src/components/scheda/tipi/switch/dati-porte.ts` e `vicini.tsx`/`porte.tsx` per le righe con fonte (precedenza della
spec §5), `riga-fonti.tsx` (LibreNMS con l'ora), `src/lib/scheda/conteggi-tab.ts`. Come approvato nel task 6.

**Prove:** la precedenza della spec §5 come funzione pura (`unisciPorte`, `unisciVicini`) con prove: nostro dato
recente vince, vecchio di oltre 1 h cede; vicini uguali una riga con due fonti.

**Verifica:** resa a 1440 e 1920 in locale sulla copia dell'hub dopo la prova a vuoto (uno switch Ubiquiti, un
MikroTik, l'UPS, un NAS); `curl` 200 delle pagine. **Commit:** `scheda: sensori e dati di LibreNMS` + release.

### [ ] Task 8 — Pagina del modulo (leggero)

**File:** `src/components/settings/integration-card.tsx` o la sezione `#module-librenms` di `modules-tab.tsx` (dove lo
dice la tavola), un componente nuovo `src/components/integrations/librenms-apparati.tsx`. Le tre liste del task 5,
pulsante «Aggiungi a LibreNMS» (admin) sui candidati con l'esito in riga (anche il rifiuto col motivo), stato della
lettura per parte con l'ora. Gli apparati «non interrogati» non hanno un pulsante per toglierli (fuori, spec §3.A).

**Verifica:** resa 1440 e 1920; un'aggiunta su IP muto in locale con LibreNMS finto (stub `fetch`) mostra il rifiuto.
**Commit:** `librenms: apparati non interrogati, rifiutati e candidati nel modulo` + release.

### [ ] Task 9 — Vicini di LibreNMS nella mappa (completo, zona rossa)

**File:** `src/lib/integrations/librenms-fonte.ts` (`scriviViciniInMappa`), `src/lib/topology/letture/interruttori.ts`
(`"librenms_mappa"`), punto in cui T1 legge `source IN ('device','unifi')` (cercarlo con `rg -n "source IN" src/lib/topology`)
e `src/lib/topology/cavi/mappa.ts` / `TIPI_SOSPETTI` se serve un campo (trappola del CONTEXT §6).

**Cosa fare:** con `librenms_mappa` acceso, i vicini di `librenms_vicino` degli apparati agganciati a un
`network_devices` diventano righe di `device_neighbors` con `source = 'librenms'`, `protocol` di LibreNMS, solo per le
porte locali dove non c'è già una riga `device` o `unifi` dello stesso giorno; T1 legge anche `librenms` solo con
l'interruttore acceso. Un vicino sparito da LibreNMS non cancella righe (`first_seen`/`timestamp` come le altre fonti).

**Prove:** spento → T1 identico (stessa uscita di `misura-cavi` prima e dopo, bit per bit); acceso → i collegamenti
dei MikroTik compaiono; riga `device` presente → la `librenms` non si scrive.

**Verifica:** `scripts/misura-cavi.ts` sulla copia dell'hub prima/dopo (spento e acceso), elenco per NOME dei
collegamenti nuovi e di quelli cambiati portato a Riccardo; accensione sull'hub solo col suo ok.
**Commit:** `topologia: vicini di LibreNMS nella mappa, dietro interruttore spento` + release.

### [ ] Task 10 — Accensione sull'hub e documenti (orchestratore)

1. Con l'ok di Riccardo: interruttore `librenms` acceso sull'hub da «Dati della mappa» (non da SQL). Dopo un giro:
   numeri per parte contro la prova a vuoto (§ task 4), scheda di uno switch, del CCR e dell'UPS vista a 1440.
2. Cliente A: verificare se ha LibreNMS (`integration_librenms_mode`); se sì, l'interruttore resta spento e si propone.
3. ADR (prossimo numero libero, 0031 al 22/10): «LibreNMS come fonte di dati: tabelle proprie, lettura spenta,
   niente force_add», con «cosa diventa difficile» dalla spec §7. Aggiornare `docs/modules/esterni/librenms.md`,
   `CHANGELOG.md` (il perché), `CONTEXT.md` §6 (trappole: token solo cifrato in DA-IPAM, forma dell'ARP, `port_id` che
   cambia), `docs/scheda-mappa.md`, `TASKS.md`; consuntivo qui sotto.

## Registro

- **22/10, esecuzione:** in parallelo ai collector, nel cloud sul ramo `librenms-fonte` (prompt
  `docs/handoff/2026-10-22-prompt-cloud-librenms.md`). Le uscite vere per S3 sono raccolte sull'hub in sola lettura e
  anonimizzate a chiusura (`src/lib/integrations/__tests__/fixtures/librenms/LEGGIMI.md`): `ports_vlans` dà 404.
- **22/10, risposte di Riccardo alle tre scelte e al container:**
  1. **Livello: leggero** («vai di leggero»). Restano, perché sono le regole delle zone rosse e non un livello: prova
     vista fallire e prova a vuoto prima di ogni scrittura in LibreNMS (task 4), backup e misura sul DB copia per la
     migrazione (task 2), mappa dietro il suo interruttore con T1 bit per bit (task 9). Niente revisore per passo.
  2. **Vicini non interrogati: si aggiungono a LibreNMS in automatico, se il loro SNMP risponde** (non con un clic).
     Chi non risponde resta candidato, col motivo visibile; niente `force_add`.
  3. **I 5 server mai interrogati** (`.4.10 .4.19 .4.40 .4.41 .4.42`): Riccardo chiede se manca l'SNMP. Quasi
     certamente sì: sono entrati con `force_add` e `last_polled` è nullo (spec §2). Da verificare col task 4 (prova
     SNMP con la credenziale dell'apparato); poi si mostrano come «SNMP non risponde» e si propone di toglierli,
     senza toglierli da soli.
  4. **Container LibreNMS dell'hub: già aggiornato** (vulnerabilità chiusa dalla sessione DA-Link/Deploy-Appliance);
     prima del task 4 si rilegge la versione dall'API.

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo

# Scheda MikroTik copiata dal Manager — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** la scheda `/objects/[id]` di un router MikroTik letto via SSH mostra quello che mostra la pagina MikroTik del Manager (risorse, hardware, interfacce per tipo, VLAN, bridge, dispositivi visti dal router, configurazione ripulita), con i dati che DA-IPAM legge da sé.

**Architettura:** DA-IPAM legge il router via SSH (modello «tira», nessun file del Manager, nessuno script sul router). P1 legge campi in più dalle uscite dei comandi che girano già; P2 rende i dati che ci sono; P3 tiene in tabelle proprie gli attributi di bridge, porte e bond che la lettura della topologia riceve già; P4 aggiunge quattro comandi in sola lettura, in una lettura nuova che nasce spenta (ADR 0018). Le tab nuove si innestano nel registro di `src/components/scheda/tab-scheda.tsx`; il tipo resta `router`/`firewall` di `tipoScheda`, e `tabDelTipo` riceve in più se l'apparato è un MikroTik in SSH e se ha un bridge.

**Spec:** censimento della pagina del Manager e divari, `/private/tmp/claude-501/-Users-riccardo-Progetti/8443f5e8-8d3f-4b6c-abd4-81b31605c6b5/scratchpad/manager-mikrotik/censimento.md` (§1 voce per voce, §2 comandi e file, §4 divari, §5 proposta P1-P5); tavole approvate da Riccardo il 21/10 (presentazione dei dati), artboard `MkPanoramica`, `MkInterfacce`, `MkVlan`, `MkBridge`, `MkDispositivi`, `MkConfigurazione` del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv (segni M1-M25; copie locali `…/scratchpad/tavola/project/Mk*.dc.html`). Modello di struttura: `docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md` (già eseguito, v0.9.822-829).

**Livello di controllo** (deciso da Riccardo il 21/10/2026): **P1 e P2 leggero** (Task 1-7), **P3 e P4 completo** (Task 8-11: prova vista fallire, misura sulla forma vera del dato, revisione per task, migrazione idempotente con segno). Task 12 leggero.

## Vincoli globali

- Decisioni di Riccardo (21/10), da non riaprire: DA-IPAM legge il router da sé via SSH (pull); **niente script SFTP, niente file del Manager**; **niente tab IP Scan**, **niente backup binari** (`/system backup save` scrive sul router), **niente generatore di script**. P5 (archivio delle configurazioni B5, elenco delle regole del firewall) è fuori da questo piano.
- Tab di un router MikroTik: `Panoramica · Interfacce · VLAN · Bridge · Routing e ARP · DHCP · Dispositivi · Configurazione | Sicurezza · Gestione · Storico`. VLAN e Bridge solo se il router ha almeno un bridge. Stormshield e gli altri firewall/router tengono le tab di oggi.
- I contatori contano **solo l'ultima lettura** (mai righe di giri vecchi).
- I dati di `/user print` si vedono **solo da admin** (rotta `requireAdmin`, riquadro solo con `ctx.isAdmin`).
- Ogni GET nuova: `requireAuth()` (o `requireAdmin()` per gli utenti) come prima istruzione, poi `withTenantFromSession`; import **statico** di `@/lib/db-tenant` (ADR 0002, prova `no-dynamic-db-tenant-import.test.ts`); voce in `CONTRACT` di `src/lib/__tests__/api-auth-guards.test.ts`; la rotta degli utenti anche in `ATTESI` di `src/lib/permessi/rotte.ts` con `livello: "admin"`; `npx tsx --test src/lib/permessi/__tests__/rotte-censite.test.ts` verde e `bash scripts/verifica-permessi.sh` verde con l'app accesa in locale.
- Comandi nuovi sul router (P4) solo dietro la lettura `mikrotik_scheda`, **spenta di default** (chiave `topologia.lettura.mikrotik_scheda` assente = spenta), al più una volta l'ora per apparato (`conCadenza`), tre esiti per comando (letto / non riuscito / non so: un «non so» non scrive mai una lista vuota).
- Schema solo additivo, idempotente, in una transazione, all'apertura del tenant (`getTenantDb`), con riga nel journal `scheda mikrotik, aggiunto …` e segno `scheda_mikrotik_v21` = `done:<AAAA-MM-GG>:v<N>` in `tenant_settings` (N = versione dello schema raggiunta: 1 dopo Task 3, 2 dopo Task 8, 3 dopo Task 10). Mai DROP, mai ricostruzioni, nessun CHECK nuovo.
- Ogni task finisce con `npm run lint && npx tsc --noEmit && npm run build`, poi `npm run version:release` + `git push origin dev` (arriva anche all'appliance del cliente A: un push di codice è un rilascio, `CONTEXT.md` §3). Albero condiviso: mai `git add -A`, stage per file dopo `git diff <file>`; `TASKS.md` solo le proprie righe.
- Prove: `DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ipam-prove.XXXXXX") node --import tsx --test <file>`; log nello scratchpad della sessione, esito dal codice d'uscita (`cmd; ESITO=$?`), mai da `| tail`.
- Resa: una volta per task, 1440×900, in locale (`npm run dev`) su una copia del DB dell'hub (`sqlite3 .backup` sull'hub, utente locale con riga in `user_tenant_access`; skill `deploy-prod`). Router dell'hub: host 227 «DA-RT-CORE», apparato id 1 `MK-RTR-CORE`, pagina `/objects/227`. Le pagine MikroTik devono entrare in 1440×900 senza scorrere la pagina (Panoramica), liste lunghe con scorrimento dentro la tabella.
- Stile: `Riquadro`, `StrisciaNumeri` (max 6 caselle), `BarraUso` (soglia 85, sopra: rosso scuro + ▲), `RigaFonti` di `src/components/scheda/`; stato sempre segno + parola (✓ attiva, ● inattiva, ✕ disabilitata); testo ≥ 13 px; U/T della matrice distinti dalla lettera e dalla luminanza (U pieno scuro, T bordo spesso su bianco), mai solo dal colore (Riccardo è daltonico). Riquadro senza dati = non si rende; la fonte che manca si dice una volta in `RigaFonti`.
- Niente conteggi nelle etichette delle tab (la tavola li mostra; come per lo switch nel piano precedente restano da fare a parte, riga in `TASKS.md`).

## Casi da non dimenticare

1. **Pool DHCP non letti su DA-RT-CORE** (aperto in `TASKS.md`): la causa non si trova dal codice. Due sospetti in `src/lib/devices/router-client.ts`: (a) `parseMikrotikDhcpServers`/`parseMikrotikDhcpPools` (righe 1013-1050) leggono `name=(\S+)`, `address-pool=(\S+)`, `ranges=(\S+)` con regex nude, e in `terse` i valori con spazi non hanno virgolette (vedi testa di `mikrotik-stp.ts`): un nome di pool con spazio si tronca e non combacia; (b) il server usa `address-pool=static-only` (solo lease statici: `dimensioneRanges` dà 0 e `poolDhcp` lo salta, `src/lib/scheda/router.ts:90-101`). Task 1 salva le due uscite vere; Task 3 corregge se l'uscita mostra (a) o (b) (prova con la fixture vista rossa: con `campiTerse` al posto delle regex per (a); per (b) il riquadro dice «solo lease statici» invece di «nessun pool leggibile»). Se non è nessuno dei due, la riga resta aperta in `TASKS.md` con l'uscita anonima allegata.
2. Router MikroTik con `protocol` diverso da `ssh` (letto via SNMP): niente P1-P4, tab di oggi (`eMikrotikSsh` falso → `tabDelTipo` riceve `mikrotik: null`) — Task 6.
3. Apparato senza `physical_device_id`: le interfacce non si scrivono dal giro ARP (Task 3) e la scheda dice «non abbinato» come oggi — Task 3 e Task 5.
4. `vlan-ids` con un intervallo largo (`100-200`) o un elenco (`10,20`) in `/interface bridge vlan print`: si espande fino a 64 numeri, oltre resta una colonna sola con l'etichetta dell'intervallo — Task 9 (funzione) e Task 10 (dato vero).
5. Lettura della topologia (`topologia.lettura.mikrotik`) spenta su un cliente: niente bridge/porte/bond nelle tabelle nuove, le tab VLAN e Bridge non compaiono (`contaBridgeMikrotik` = 0) e la Panoramica lo dice in `RigaFonti` — Task 8 e Task 9.

## Task 1 — Uscite vere del router dell'hub (P1, leggero)

**File**
- crea `scripts/leggi-uscite-mikrotik.ts`
- crea in `src/lib/devices/__tests__/fixtures/`: `mikrotik-resource.txt`, `mikrotik-routerboard.txt`, `mikrotik-arp-terse.txt`, `mikrotik-dhcp-server-terse.txt`, `mikrotik-ip-pool-terse.txt`, `mikrotik-bridge-vlan-terse.txt`, `mikrotik-vlan-terse.txt`, `mikrotik-dns.txt`, `mikrotik-user-terse.txt` (anonimizzate)

**Interfacce prodotte** le nove fixture, usate dai Task 2, 3, 10.

**Cosa fare**
- Lo script gira **sull'hub** (`/opt/da-invent`), con import statici (`withTenant` e `getNetworkDeviceById` da `../src/lib/db-tenant` e `../src/lib/db`, `apriEsecutoreSsh` da `../src/lib/devices/mikrotik-letture`), lanciato con `node --env-file=.env.local --import tsx scripts/leggi-uscite-mikrotik.ts --tenant 70791 --device 1 --uscita /root/uscite-mk-<data>.txt`. Rifiuta (uscita 2) se l'apparato non è `vendor = 'mikrotik'` con `protocol = 'ssh'`. Su **una** connessione manda, in sola lettura e in quest'ordine: `/system resource print`, `/system routerboard print`, `/ip arp print terse`, `/ip dhcp-server print terse`, `/ip pool print terse`, `/interface bridge print terse without-paging`, `/interface bridge vlan print terse without-paging`, `/interface vlan print terse without-paging`, `/ip dns print`, `/user print terse without-paging`. Scrive le uscite nel file (permessi 600) separate da `### <comando>`; a schermo **solo** comando, numero di righe e byte (mai il contenuto: IP, nomi e utenti del router dell'hub).
- Il router è di Domarc (hub), non di un cliente: la lettura una tantum dei quattro comandi di P4 per avere la forma vera non è l'automatismo di P4 (quello nasce spento nel Task 10).
- Sul Mac: `scp` del file nello scratchpad, poi anonimizzazione (IP → 192.0.2.0/24, 198.51.100.0/24, 10.20.0.0/16; MAC → `02:00:A0:10:xx:yy` come le fixture `mk*`; identity, nomi di VLAN, commenti, nomi utente → parole neutre), una fixture per comando. Il file sull'hub si cancella subito dopo la copia.
- Annotare in `TASKS.md` (sezione di questo piano): quanti bridge ha DA-RT-CORE, se `topologia.lettura.mikrotik` è accesa sull'hub (`sqlite3 -readonly` sul DB del tenant: `SELECT value FROM tenant_settings WHERE key='topologia.lettura.mikrotik'`), se l'apparato 1 ha `physical_device_id`, e quale dei due sospetti del caso 1 si vede.

**Verifica** `grep -E '([0-9]{1,3}\.){3}[0-9]{1,3}' src/lib/devices/__tests__/fixtures/mikrotik-{resource,arp-terse,dns,user-terse}.txt` mostra solo indirizzi dei tre blocchi di documentazione; lettura a occhio di ogni fixture (nessun nome vero). Lo script stesso si prova a vuoto sul Mac con `--device` di un apparato non MikroTik della copia locale: uscita 2.

**Commit** `test(mikrotik): uscite vere del router dell'hub, anonime, per la scheda MikroTik`, poi `npm run version:release` + push come ogni task (lo script è codice del repo, anche se l'app non cambia).

## Task 2 — Risorse e hardware dal comando che gira già (P1, leggero)

**File**
- crea `src/lib/devices/mikrotik-scheda.ts`, `src/lib/devices/__tests__/mikrotik-scheda.test.ts`
- modifica `src/lib/devices/device-info.ts`: tipo `DeviceInfo` (righe 14-125, campi nuovi in fondo), ramo `mikrotik` di `getDeviceInfoFromSsh` (righe 422-444), uscita anticipata SNMP di `getDeviceInfo` (righe 1502-1505)
- modifica `src/components/scheda/dati.ts` (`DeviceInfoJson`, riga 77 e seguenti: gli stessi due campi)

**Interfacce prodotte**
```ts
// src/lib/devices/mikrotik-scheda.ts (puro: niente rete, niente DB)
export interface RisorseMikrotik {
  uptime: string | null;          // come lo scrive RouterOS, «4w1d2h29m45s»
  uptime_s: number | null;        // parseRouterOsDurationSeconds (router-client.ts:928)
  versione: string | null;        // «7.19.4 (stable)»
  build: string | null;
  cpu: string | null;             // «ARM64»
  cpu_core: number | null;
  cpu_mhz: number | null;
  cpu_carico: number | null;      // 0-100
  memoria_totale_b: number | null;
  memoria_libera_b: number | null;
  disco_totale_b: number | null;
  disco_libero_b: number | null;
  architettura: string | null;
  board: string | null;
  piattaforma: string | null;
}
export interface HardwareMikrotik {
  routerboard: boolean | null; modello: string | null; seriale: string | null; revisione: string | null;
  firmware_tipo: string | null; firmware_factory: string | null;
  firmware_corrente: string | null; firmware_aggiornabile: string | null;
}
export function byteRouterOs(s: string | null | undefined): number | null; // «1024.0MiB», «1.0GiB», «47.0KiB», «4096» → byte; illeggibile → null
export function parseRisorse(out: string): RisorseMikrotik;     // `chiave: valore`, una per riga
export function parseRouterboard(out: string): HardwareMikrotik; // idem; su CHR (`routerboard: no`) i campi assenti sono null
// DeviceInfo (device-info.ts) e DeviceInfoJson (dati.ts), in più:
mikrotik_risorse?: RisorseMikrotik;
mikrotik_hardware?: HardwareMikrotik;
```

**Cosa fare**
- `byteRouterOs`: converte davvero KiB/MiB/GiB (×1024, ×1024², ×1024³); il Manager tratta MiB e GiB come lo stesso numero (censimento §1.4): difetto da non copiare.
- Ramo `mikrotik` di `getDeviceInfoFromSsh`: le due uscite che arrivano già (`/system resource print`, `/system routerboard print`) passano a `parseRisorse`/`parseRouterboard`; oltre ai campi di oggi restituisce `mikrotik_risorse`, `mikrotik_hardware`, e i campi generici `uptime` (testo RouterOS), `cpu_cores`, `cpu_speed_mhz`, `ram_total_mb`, `ram_free_mb`, `architecture`, `cpu_model`. **Correzione**: `serial_number` viene da `routerboard` (`serial-number`), non da `resource` (dove non c'è: oggi resta sempre vuoto). `part_number` resta il `model` di routerboard. Nessun comando nuovo.
- `getDeviceInfo` (riga 1503): l'uscita anticipata «SNMP completo, salto SSH» non vale per `device.vendor === "mikrotik"` (le risorse si leggono solo in SSH).
- La riga «Acceso da» della Panoramica si calcola da `uptime_s` e `scanned_at` (Task 4): qui solo il dato.

**Verifica**
- Prove (viste rosse prima): `parseRisorse` sulla fixture `mikrotik-resource.txt` (ogni campo, MiB→byte giusto, carico 0-100); `parseRouterboard` su `mikrotik-routerboard.txt` (seriale, firmware corrente e aggiornabile) e su un'uscita CHR scritta nella prova (`routerboard: no`) → campi null; `byteRouterOs("1.0GiB") === 1073741824`, `byteRouterOs("x") === null`.
- `npx tsc --noEmit`, lint, build.
- Dopo il rilascio, sull'hub: Riccardo preme «Aggiorna» su MK-RTR-CORE (la sessione non ha un admin sull'hub); poi `SELECT json_extract(last_device_info_json,'$.mikrotik_risorse.cpu_carico'), serial_number FROM network_devices WHERE id=1` non nulli.

**Commit** `feat(mikrotik): risorse, firmware aggiornabile e seriale dalla scansione SSH che gira già`

## Task 3 — Interfacce con stato, MTU e commento; stato ARP; versione dei vicini (P1, leggero)

**File**
- modifica `src/lib/db-tenant-schema.ts` (in fondo, accanto a `DDL_TOPOLOGY_CAVI` righe 52-104): `COLONNE_SCHEDA_MK_V1`, `SEGNO_SCHEDA_MK`, `VERSIONE_SCHEDA_MK`
- modifica `src/lib/db-tenant.ts`: `migrateSchedaMikrotik` accanto a `migrateHostsArchivio` (riga 653), chiamata in `getTenantDb` dopo quella di `migrateHostsArchivio` (righe 2236-2244); `livelloSchemaSchedaMk`; `upsertArpEntries` (riga 4843); `upsertNeighbors` (righe 5245-5313, aggiornamento a parte come le colonne dei cavi); `DbNeighborEntry` (riga 5181)
- modifica `src/lib/db.ts:4319` (`upsertArpEntries`, stessa colonna: regola 12 del CLAUDE.md)
- modifica `src/lib/devices/mikrotik-stp.ts:48-60` (`InterfacciaMk`, `parseInterfacce`), `src/lib/devices/router-client.ts` (`ArpTableEntry` righe 11-15, `NeighborEntry` righe 48-64, `parseMikrotikArp` righe 1052-1069), `src/lib/devices/mikrotik-vicini.ts:90-113` (`version`)
- modifica `src/lib/devices/vendor-interface-probes.ts:57-71,132-180` (via `parseMikrotikInterfacePrint`, usa `parseInterfacce`), `src/lib/devices/interface-probe.ts:47-55` (`InterfaceProbeResult`), `src/lib/devices/identity-resolver.ts:238-245`, `src/lib/devices/physical-device-db.ts:142-180` (`UpsertInterfaceInput`, `upsertDeviceInterface`, nuova `aggiornaInterfacceRouterOs`)
- modifica `src/lib/cron/jobs.ts:961-970` (dopo `leggiMacPorteRouter`, ramo dei router)
- modifica `src/types/index.ts:336-344` (`ArpEntry`)
- prove: crea `src/lib/__tests__/scheda-mikrotik-migration.test.ts`; estende `src/lib/devices/__tests__/mikrotik-stp.test.ts` (aggiornare le attese di `parseInterfacce` con i campi nuovi: il motivo nel commit), `src/lib/devices/__tests__/mikrotik-vicini.test.ts`, `src/lib/devices/__tests__/mikrotik-scheda.test.ts`

**Interfacce prodotte**
```ts
// db-tenant-schema.ts
export const SEGNO_SCHEDA_MK = "scheda_mikrotik_v21";
export const VERSIONE_SCHEDA_MK = 1; // 2 nel Task 8, 3 nel Task 10
export const COLONNE_SCHEDA_MK_V1: ReadonlyArray<readonly [tabella: string, colonna: string, ddl: string]> = [
  ["device_interfaces", "mtu", "INTEGER"],
  ["device_interfaces", "disabled", "INTEGER"],
  ["arp_entries", "status", "TEXT"],
  ["arp_entries", "dynamic", "INTEGER"],
  ["device_neighbors", "remote_version", "TEXT"],
];
// db-tenant.ts
export function migrateSchedaMikrotik(db: Database.Database): string[]; // additiva, idempotente, una transazione; poi scriviSegno(SEGNO_SCHEDA_MK, `done:<data>:v${VERSIONE_SCHEDA_MK}`)
export function livelloSchemaSchedaMk(d: Database.Database): number;  // versione completa presente (0 = niente), annotata in una WeakMap come SCHEMA_CAVI
// mikrotik-stp.ts
export interface InterfacciaMk { nome: string; tipo: string | null; mac: string | null; accesa: boolean; spenta: boolean;
  mtu: number | null; commento: string | null; predefinito: string | null }
// router-client.ts
export interface ArpTableEntry { mac: string; ip: string | null; interface_name: string | null; status?: string | null; dynamic?: boolean | null }
// NeighborEntry, in più:
remoteVersion?: string;
// interface-probe.ts, InterfaceProbeResult in più:
type?: string | null; mtu?: number | null; disabled?: boolean | null;
// physical-device-db.ts
export interface UpsertInterfaceInput { /* campi di oggi */ mtu?: number | null; disabled?: boolean | null }
export function aggiornaInterfacceRouterOs(physicalDeviceId: number, righe: InterfacciaMk[]): number; // righe scritte
// db-tenant.ts DbNeighborEntry in più: remote_version: string | null; types ArpEntry in più: status: string | null; dynamic: number | null
```

**Cosa fare**
- Migrazione: per ogni voce di `COLONNE_SCHEDA_MK_V1`, `ALTER TABLE … ADD COLUMN` solo se `PRAGMA table_info` non la ha; nel journal `[db-tenant] <tenant>: scheda mikrotik, aggiunto <elenco>`; errore → `console.error`, segno `segnoErrore(e)`, il tenant si apre lo stesso. Il segno non salta la migrazione (le verifiche sono `PRAGMA`, costano niente): dice a chi verifica fin dove è arrivato lo schema.
- `parseInterfacce`: in più `mtu` (`mtu=` intero; `auto` → null), `commento` (`comment=`, letto con `campiTerse`, quindi intero anche con spazi), `predefinito` (`default-name=`). Stato per la scheda: `accesa` (segno `R`) → `status = 'up'`, altrimenti `'down'`; `spenta` (segno `X`) → `disabled = 1`.
- `aggiornaInterfacceRouterOs`: per ogni riga `upsertDeviceInterface` con `type = tipo`, `alias = commento` (come fa SNMP con `ifAlias`, che su RouterOS è il commento), `mtu`, `disabled`, `mac`, `status`. `upsertDeviceInterface` scrive `mtu`/`disabled` solo se `livelloSchemaSchedaMk(getDb()) >= 1` (altrimenti l'INSERT di oggi).
- Giro ARP, ramo dei router (`jobs.ts` dopo riga 963): se `device.vendor === "mikrotik" && device.protocol === "ssh" && device.physical_device_id != null` e `client.ultimaUscitaInterfacce?.()` non è null, `interpretaUscita(uscita, parseInterfacce)` (`mikrotik-letture.ts:107`) e, se letto, `aggiornaInterfacceRouterOs`. Un errore va in `console.warn` col solo codice, come `porteNonLette`. Nessun comando nuovo: `/interface print terse` gira già a ogni giro (`getInterfaceTypes`).
- Probe CLI (`probeMikrotikInterfaces`, usato quando SNMP manca): `parseInterfacce` al posto di `parseMikrotikInterfacePrint`; `alias = commento`, `type`, `mtu`, `disabled`, `status` dal segno `R` (oggi `unknown`), MAC da `mac-address=` della stessa riga (prima solo dalle ethernet, così le VLAN senza IP sparivano dal filtro di riga 179). `identity-resolver` passa `type`, `mtu`, `disabled` a `upsertDeviceInterface`.
- ARP: `parseMikrotikArp` con `campiTerse`: `status=` (reachable, stale, delay, failed, incomplete, permanent) e `dynamic` dal segno `D`. `upsertArpEntries` (in **entrambi** i file) scrive `status` e `dynamic` se `livelloSchemaSchedaMk(<handle>) >= 1`. SNMP non li ha: null.
- Vicini: `parseMikrotikNeighbors` legge `version=` (valore intero, es. «7.21.3 (stable) 2026-03-02 09:15:00»; vuoto → assente). `upsertNeighbors` lo scrive con un `UPDATE device_neighbors SET remote_version = ? WHERE …` a parte, solo se il livello è ≥ 1, come le colonne dei cavi; `senzaCampiCavi` non lo toglie (non è un dato della topologia).
- Caso 1 (pool DHCP): se Task 1 ha mostrato il sospetto (a) o (b), correggerlo qui con la sua prova vista rossa sulla fixture.

**Verifica**
- Prove viste rosse: migrazione su un DB vuoto creato da `TENANT_SCHEMA_SQL` senza le cinque colonne → aggiunte; seconda chiamata → `[]`; segno `done:…:v1`; `integrity_check` = `ok` (sul modello di `topology-cavi-migration.test.ts`). `parseInterfacce(mikrotik-mk2-testa.txt)`: `bond1` ha `commento: "cavo-a"`, `mtu: 1500`; riga con `X` → `spenta`. ARP su `mikrotik-arp-terse.txt`: stati e `dynamic` giusti. Vicini su `mikrotik-ip-neighbor-terse.txt`: `remoteVersion` «7.21.3 (stable) 2026-03-02 09:15:00» per RTR-1, assente per SW-ACC-A. `aggiornaInterfacceRouterOs` su un DB di prova: riga con `type`, `mtu`, `disabled`, `alias` = commento.
- `npm test` mirato sui file toccati; `src/lib/cron/__tests__/arp-letture-mikrotik.test.ts` verde (il giro non cambia comandi).
- Dopo il rilascio, sull'hub: riga del journal `scheda mikrotik, aggiunto …`; segno `done:…:v1`; dopo il giro ARP successivo `SELECT count(*) FROM arp_entries WHERE device_id=1 AND status IS NOT NULL` > 0 e `SELECT count(*) FROM device_interfaces WHERE physical_device_id=(SELECT physical_device_id FROM network_devices WHERE id=1) AND type IS NOT NULL` > 0.

**Commit** `feat(mikrotik): interfacce con stato, MTU e commento, stato ARP e versione dei vicini dalle letture che girano già`

## Task 4 — Panoramica MikroTik (P2, leggero)

**File**
- crea `src/lib/scheda/mikrotik.ts`, `src/lib/scheda/__tests__/mikrotik.test.ts`
- crea `src/components/scheda/tipi/router/mikrotik/panoramica.tsx`, `src/components/scheda/tipi/router/mikrotik/dati-mikrotik.ts`
- modifica `src/components/scheda/tab-scheda.tsx:58-64` (`TAB_ROUTER.panoramica`), `src/lib/devices/interfacce-scheda.ts` (opzione `soloUltimaLettura`, campi nuovi), `src/app/api/devices/[id]/interfacce/route.ts` (`?ultima=1`), `src/lib/scheda/router.ts:9-17` (`InterfacciaScheda`)

**Interfacce prodotte**
```ts
// src/lib/scheda/router.ts — InterfacciaScheda in più:
mtu: number | null; disabilitata: boolean | null; aggiornato: string | null;
// src/lib/devices/interfacce-scheda.ts
export function interfacceDellApparato(deviceId: number, opz?: { soloUltimaLettura?: boolean }): RispostaInterfacce | null;
//   soloUltimaLettura: interfacce con updated_at >= MAX(updated_at) - 5 minuti dello stesso apparato fisico; indirizzi idem,
//   con la loro MAX (gli indirizzi si aggiornano con «Aggiorna», le interfacce a ogni giro ARP: due finestre separate)
// src/lib/scheda/mikrotik.ts (puro)
export type GruppoInterfaccia = "ethernet" | "vlan" | "bond" | "bridge" | "vpn_tunnel" | "altro";
export function gruppoInterfaccia(tipo: string | null): GruppoInterfaccia;
export function statoInterfaccia(i: { stato: "up" | "down" | "unknown"; disabilitata: boolean | null }): "attiva" | "inattiva" | "disabilitata";
export function usoPercento(totale: number | null, libero: number | null): number | null; // 0-100, null se un dato manca o totale 0
export interface ContatoriMikrotik { indirizzi: number | null; vlan: number | null; porteBridge: number | null; bond: number | null; rotte: number | null; utenti: number | null }
export function contatoriMikrotik(i: { interfacce: InterfacciaScheda[] | null; rotte: number; porteBridge: number | null; bond: number | null; vlan: number | null; utenti: number | null }): ContatoriMikrotik;
export function caselleMikrotik(i: { risorse: RisorseMikrotik | null; hardware: HardwareMikrotik | null; scansione: string | null;
  interfacce: InterfacciaScheda[] | null; vlan: { numero: number; bridge: number | null } | null }): Casella[];
export function perTipo(interfacce: InterfacciaScheda[]): { tipo: string; numero: number }[]; // dal più numeroso
```

**Cosa fare** (artboard `MkPanoramica`, M1-M7)
- `gruppoInterfaccia` (regola della tavola `MkInterfacce`): `ether`, `ethernet` → ethernet; `vlan` → vlan; `bond`, `bonding` → bond; `bridge` → bridge; `wg`, `wireguard`, `ovpn-in`, `ovpn-out`, `ovpn-client`, `ovpn-server`, `l2tp-in`, `l2tp-out`, `l2tp-client`, `sstp-in`, `sstp-out`, `sstp-client`, `pptp-in`, `pptp-out`, `pptp-client`, `eoip`, `eoipv6`, `eoip-tunnel`, `gre`, `gre6`, `gre-tunnel`, `ipip`, `ipipv6`, `ipip-tunnel`, `vxlan` → vpn_tunnel (il Manager metteva `wg` in «Altro»: difetto da non copiare); il resto (loopback, vrrp, pppoe-*, wlan, wifi, cap, lte…) → altro.
- `statoInterfaccia`: `disabilitata` vince; poi `up` → attiva; altrimenti inattiva.
- Striscia (6 caselle, solo quelle col dato): CPU `cpu_carico%` (sotto «n core · MHz»; attenzione ≥ 85); Memoria usata `usoPercento` (sotto «X MiB liberi su Y»); Acceso da (giorni da `uptime_s`, sotto «riavvio gg/mm» = `scanned_at − uptime_s`, ora italiana); Interfacce su `su / totale` (sotto «n disabilitata/e» se > 0, tab interfacce); VLAN (numero di interfacce di tipo vlan, sotto «su n bridge» quando il Task 9 dà il numero; tab vlan se c'è, altrimenti interfacce); «Firmware aggiornabile» solo se `firmware_aggiornabile` ≠ `firmware_corrente` (attenzione, sotto «installato <corrente>»), altrimenti «Firmware <corrente>».
- Riquadri in griglia a 3 colonne su due righe (deve stare in 1440×900): **Risorse** (M1: barre CPU, Memoria, Storage con `BarraUso`; Processore «n core · MHz»; Architettura «architettura · cpu»), **Hardware** (M2: Modello, Seriale mono, Firmware, Aggiornabile con ▲ se diverso, Factory), **Contatori** (M3: Indirizzi IP, VLAN, Porte bridge, Bond, Rotte, Utenti — solo quelli non null, ognuno è un bottone che apre la sua tab; «Contati sull'ultima lettura» in nota), **Interfacce per tipo** (M6: `perTipo`, «tutte (N) ›»). I riquadri DNS (M4) e Utenti (M5) arrivano nel Task 11.
- `RigaFonti`: «SSH» con l'ora di `scanned_at`; «Interfacce» con `aggiornato`; «topologia» e «DNS e utenti» dal Task 9 e 11 (qui non ancora).
- Innesto: `TAB_ROUTER.panoramica.render = (c) => eMikrotikSsh(c) ? <PanoramicaMikrotik ctx={c} /> : <PanoramicaRouter ctx={c} />`. Il router non MikroTik e il firewall Stormshield restano come oggi.
- Le liste MikroTik chiamano `/api/devices/[id]/interfacce?ultima=1`; senza il parametro la rotta risponde come oggi.

**Verifica** prove vista rosse di `gruppoInterfaccia` (tutti i tipi della tavola, `wg` in vpn_tunnel, tipo null → altro), `statoInterfaccia`, `usoPercento` (totale 0, libero > totale), `caselleMikrotik` (firmware uguale → nessuna attenzione; max 6), `interfacceDellApparato(…, { soloUltimaLettura: true })` su un DB di prova con una riga vecchia di un'ora (esclusa); resa a 1440×900 di `/objects/227` sulla copia del DB dell'hub presa **dopo** il «Aggiorna» del Task 2: niente scorrimento, ogni casella apre la sua tab; `/objects/<id SNS EVA2>` invariata.

**Commit** `feat(scheda): Panoramica dei router MikroTik con risorse, hardware, contatori e interfacce per tipo`

## Task 5 — Interfacce raggruppate per tipo (P2, leggero)

**File**
- crea `src/components/scheda/tipi/router/mikrotik/interfacce.tsx`
- modifica `src/components/scheda/tab-scheda.tsx` (`TAB_ROUTER.interfacce` sceglie come la Panoramica), `src/lib/scheda/mikrotik.ts` (`raggruppaInterfacce`), `src/components/scheda/contesto.ts`/`dati.ts` (`neighbors` con `remote_version`)

**Interfacce prodotte**
```ts
export function raggruppaInterfacce(l: InterfacciaScheda[]): { gruppo: GruppoInterfaccia; titolo: string; tipi: string; righe: InterfacciaScheda[] }[];
// ordine: ethernet, vlan, bond, bridge, vpn_tunnel, altro; gruppi vuoti tolti; titoli «Ethernet», «VLAN», «Bond», «Bridge», «VPN e tunnel», «Altro»
// DeviceExtras.neighbors[] in più: remote_version?: string | null
```

**Cosa fare** (artboard `MkInterfacce`, M8-M14)
- Chip in alto «Tutte N · Su N · Non attive N» (filtro lato client) e legenda «✓ attiva ● inattiva ✕ disabilitata».
- Un `Riquadro` per gruppo, titolo con numero e, a destra, i tipi RouterOS del gruppo in piccolo (M8 «ether, ethernet»). Colonne: Nome, Tipo, Stato, MTU, MAC, Indirizzi IP (`IndirizziCella`), Dettagli, Commento (= `alias`). Colonne vuote per tutto il gruppo non si rendono. Dettagli: per ora il nome predefinito dove diverso (la tavola mostra `ether1`); bond e bridge si riempiono nel Task 9, VLAN nel Task 11.
- «Vicini LLDP / CDP / MNDP» (M14): le colonne di oggi più **Versione** (primo pezzo di `remote_version`, valore intero nel `title`).
- Sotto, come oggi: `SezioneLibreNms`, `SullaMappa`, `IpCollegati` (dove li ha messi il piano precedente).
- Interfacce dell'ultima lettura (`?ultima=1`).

**Verifica** prova di `raggruppaInterfacce` (ordine, gruppi vuoti tolti, interfaccia senza tipo in «Altro»); resa a 1440 di `/objects/227`: gruppi, stati con segno e parola, colonna Versione; un router non MikroTik ha la tab di oggi.

**Commit** `feat(scheda): interfacce MikroTik raggruppate per tipo con MTU, stato, commento e versione dei vicini`

## Task 6 — Dispositivi visti dal router (P2, leggero)

**File**
- crea `src/lib/scheda/dispositivi-router.ts`, `src/lib/scheda/__tests__/dispositivi-router.test.ts`
- crea `src/app/api/devices/[id]/dispositivi/route.ts` (GET), `src/components/scheda/tipi/router/mikrotik/dispositivi.tsx`
- modifica `src/lib/db-tenant.ts` (nuova `ingressoDispositivi`, accanto a `getArpEntriesByDevice` riga 5030), `src/lib/scheda/tipo-scheda.ts:12-16,88-92`, `src/lib/scheda/panoramica.ts:85-89` (`TUTTI`), `src/components/scheda/tab-scheda.tsx` (`ETICHETTE_TAB`, `TAB_ROUTER.dispositivi`), `src/app/(dashboard)/objects/[id]/page.tsx:410-422`, `src/components/scheda/dati.ts` (`DeviceExtras.mikrotik`), `src/lib/scheda/__tests__/tipo-scheda.test.ts`, `src/lib/__tests__/api-auth-guards.test.ts:45-49`

**Interfacce prodotte**
```ts
// tipo-scheda.ts
export type TabId = /* quelli di oggi */ | "bridge" | "dispositivi";
export interface OpzioniTab {
  ruoli: string[];
  haAd: boolean;
  haDipendenze: boolean;
  /** Router o firewall MikroTik letto via SSH; null per ogni altro apparato. `haBridge` = almeno un bridge nell'ultima lettura. */
  mikrotik: { haBridge: boolean } | null;
}
export function tabDelTipo(t: TipoScheda, o: OpzioniTab): TabId[];
//   router|firewall con mikrotik !== null → ["panoramica","interfacce", ...(haBridge ? ["vlan","bridge"] : []),
//     "routing","dhcp","dispositivi","configurazione", ...TAB_COMUNI]; con mikrotik === null come oggi.
// dati.ts, DeviceExtras in più (lo riempie GET /api/devices/[id] dal Task 9; prima è assente):
mikrotik?: { bridge: number; letto_il: string | null } | null;
// dispositivi-router.ts (puro)
export type FonteNome = "dhcp" | "lldp" | "dns";
export interface IngressoDispositivi {
  arp: { ip: string | null; mac: string; interface_name: string | null; status: string | null; timestamp: string | null }[];
  lease: { ip_address: string; mac_address: string; hostname: string | null; dynamic_lease: number | null; description: string | null; last_seen: string | null }[];
  vicini: { remote_ip: string | null; remote_mac: string | null; remote_device_name: string | null; local_port: string | null; timestamp: string | null }[];
  host: { id: number; ip: string; nome_dns: string | null; status: string | null }[];
}
export interface RigaDispositivo {
  ip: string; mac: string | null; macArpDiverso: string | null; produttore: string | null;
  nome: string | null; fonteNome: FonteNome | null; interfaccia: string | null;
  lease: "dinamico" | "statico" | null; commentoDhcp: string | null; lldp: boolean; hostId: number | null; visto: string | null;
}
export type FiltroDispositivi = "tutti" | "dhcp" | "statici" | "lldp" | "discordanti";
export function unisciDispositivi(i: IngressoDispositivi, produttore: (mac: string) => string | null): RigaDispositivo[];
export function filtraDispositivi(r: RigaDispositivo[], f: FiltroDispositivi, q: string): RigaDispositivo[];
export function contaDispositivi(r: RigaDispositivo[]): Record<FiltroDispositivi, number>;
export const PER_PAGINA = 14;
// GET /api/devices/[id]/dispositivi?pagina=1&filtro=tutti&q= → 200
{ righe: RigaDispositivo[]; totale: number; conteggi: Record<FiltroDispositivi, number>; pagina: number; pagine: number }
// db-tenant.ts
export function ingressoDispositivi(deviceId: number): IngressoDispositivi;
```

**Cosa fare** (artboard `MkDispositivi`, M19-M21; regole del Manager, censimento §1.11)
- `unisciDispositivi`, regole di dominio (ognuna con la sua prova): chiave = IPv4 ben formato (altri scartati); MAC normalizzato `AA:BB:CC:DD:EE:FF`, scartato se non ha 12 cifre esadecimali; **precedenza del MAC: DHCP > ARP > LLDP**; `macArpDiverso` = MAC dell'ARP se c'è un lease con MAC diverso; **precedenza del nome: DHCP (`hostname`) > LLDP (`remote_device_name`) > DNS** (`nome_dns` dell'host IPAM con quell'IP) con `fonteNome`; riga ARP con `status = 'failed'` scartata se l'IP non ha un lease, un vicino o un host IPAM `online`; `produttore` = OUI (`lookupVendorSync`, `src/lib/scanner/mac-vendor.ts:55`) oppure «MAC privato» se il MAC è amministrato localmente (seconda cifra 2, 6, A, E); `interfaccia` = ARP, altrimenti porta locale del vicino; `lease` da `dynamic_lease`; `commentoDhcp` = `description` del lease; `visto` = il più recente fra le fonti; ordine per IP numerico.
- `ingressoDispositivi`: quattro letture, niente N+1: `arp_entries` dell'apparato; `dhcp_leases` con `source_device_id`; `device_neighbors` dell'apparato con `NEIGHBORS_LATEST_ROUND_SQL`; `hosts` con `ip IN (unione degli IP delle tre)` (nome DNS = `COALESCE(custom_name, hostname, dns_reverse)`).
- Rotta: `requireAuth()` prima di tutto, `withTenantFromSession`, 404 se l'apparato non c'è, 400 se non è MikroTik; filtro e pagina lato server (regola 9 del CLAUDE.md); `q` cerca in IP, MAC, nome, produttore, commento.
- Tab (M19-M21): ricerca + «Pulisci», chip con i conteggi (Tutti, DHCP, Lease statici, LLDP, ▲ MAC discordante), tabella IP (link a `/objects/<hostId>` se c'è), MAC (riga sotto «▲ ARP <mac>» se discordante), Produttore, Nome (con la fonte in parola: DHCP / LLDP / DNS), Interfaccia, Tipo (DYN / STAT), Commento DHCP, Visto (ora italiana); legenda e regola delle precedenze sotto in una riga; «n di N · pagina p di P ›».
- `tabDelTipo` con `OpzioniTab`; la pagina (righe 410-422) passa `mikrotik: device?.vendor === "mikrotik" && device?.protocol === "ssh" ? { haBridge: (device?.mikrotik?.bridge ?? 0) > 0 } : null` (la stessa condizione di `eMikrotikSsh`, calcolata prima di costruire `ctx`). Fino al Task 9 il campo manca, `haBridge` è falso e VLAN/Bridge non compaiono.

**Verifica** prove viste rosse delle sei regole (MAC DHCP vince su ARP; nome LLDP vince su DNS; ARP failed solo → scartato, con lease → tenuto; MAC di 11 cifre scartato; MAC privato; ordine 10.0.0.9 prima di 10.0.0.10) e di `tabDelTipo` (MikroTik con e senza bridge, Stormshield, router non MikroTik); prova della rotta (401 senza sessione, 404, 400 non MikroTik, paginazione); `api-auth-guards.test.ts` con la voce `devices/[id]/dispositivi` GET `requireAuth`; `verifica-permessi.sh`; resa a 1440 di `/objects/227` tab Dispositivi.

**Commit** `feat(scheda): tab Dispositivi dei router MikroTik (ARP, DHCP, vicini e host IPAM uniti con le precedenze del Manager)`

## Task 7 — Routing e ARP con lo stato, Configurazione con l'export ripulito (P2, leggero)

**File**
- modifica `src/components/scheda/tipi/router/routing.tsx` (tabella ARP: colonna Stato), `src/components/scheda/tipi/router/configurazione.tsx` (export ripulito), `src/lib/scheda/mikrotik.ts` (`ripulisciExport`), prova in `src/lib/scheda/__tests__/mikrotik.test.ts`

**Interfacce prodotte**
```ts
export function ripulisciExport(testo: string): { testo: string; tolte: string[]; righe: number };
// toglie le sezioni «/system script» e «/system scheduler» (fino alla sezione «/…» successiva) e unisce le continuazioni di riga «\»;
// `tolte` = le sezioni tolte, per la nota «# [tolte: /system script, /system scheduler]»
```

**Cosa fare** (artboard `MkConfigurazione`, M22-M24; Routing e ARP del censimento §1.14)
- ARP: colonna **Stato** (reachable ✓, stale ●, delay ●, failed ✕, incomplete ●, permanent ✓ — sempre segno + parola) e **Tipo** (dinamica / statica da `dynamic`); colonne nascoste se tutte vuote (router SNMP).
- Configurazione, solo admin come oggi: l'export letto dal router passa da `ripulisciExport` prima di mostrarlo e di scaricarlo; intestazione «<identity>_<AAAA-MM-GG>_<HHMM>.rsc · KB · righe»; sotto il testo la nota delle sezioni tolte. Niente «Confronta» e niente «copia precedente» (archivio B5, fuori). Niente riquadro «Backup binari» (M25: deciso di no, e un riquadro senza dato non si rende).

**Verifica** prova vista rossa di `ripulisciExport` (export con `/system script` e `/system scheduler` in mezzo e una riga continuata con `\`: sezioni tolte, le altre intatte, `tolte` giusto); resa a 1440 da admin locale della tab Configurazione (sulla copia il router non risponde: si verifica con l'export mostrato sull'hub da Riccardo, annotato in `TASKS.md`) e della tab Routing e ARP.

**Commit** `feat(scheda): stato ARP e export MikroTik ripulito come nel Manager`

## Task 8 — Bridge, porte e bond in tabelle proprie (P3, completo)

**File**
- modifica `src/lib/db-tenant-schema.ts` (`DDL_SCHEDA_MK_V2`, `VERSIONE_SCHEDA_MK = 2`), `src/lib/db-tenant.ts` (`migrateSchedaMikrotik` crea le tabelle; `livelloSchemaSchedaMk`; nuova `scriviSchedaMikrotikTopologia`)
- modifica `src/lib/devices/mikrotik-scheda.ts` (tre lettori), `src/lib/devices/mikrotik-letture.ts:120-170` (`RisultatoMk.uscite`), `src/lib/cron/jobs.ts:709-716` (`letturaMikrotik`)
- crea `docs/adr/0024-scheda-mikrotik-tabelle-proprie.md`
- prove: estende `src/lib/__tests__/scheda-mikrotik-migration.test.ts`, `src/lib/devices/__tests__/mikrotik-scheda.test.ts`, `src/lib/cron/__tests__/arp-letture-mikrotik.test.ts`

**Interfacce prodotte**
```sql
CREATE TABLE IF NOT EXISTS mikrotik_bridge (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mac_address TEXT, mtu TEXT, actual_mtu INTEGER, l2mtu INTEGER, arp TEXT, arp_timeout TEXT,
  protocol_mode TEXT, priority TEXT, fast_forward INTEGER, igmp_snooping INTEGER, dhcp_snooping INTEGER,
  vlan_filtering INTEGER, pvid INTEGER, frame_types TEXT, ingress_filtering INTEGER, ether_type TEXT,
  ageing_time TEXT, forward_delay TEXT, max_message_age TEXT, comment TEXT, running INTEGER, disabled INTEGER,
  seen_at TEXT NOT NULL, PRIMARY KEY (device_id, name));
CREATE TABLE IF NOT EXISTS mikrotik_bridge_port (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  interface TEXT NOT NULL, bridge TEXT NOT NULL, pvid INTEGER, priority TEXT, path_cost INTEGER, internal_path_cost INTEGER,
  edge TEXT, point_to_point TEXT, horizon TEXT, hw INTEGER, hw_offload INTEGER, frame_types TEXT, ingress_filtering INTEGER,
  bpdu_guard INTEGER, trusted INTEGER, inactive INTEGER, disabled INTEGER, dynamic INTEGER, comment TEXT,
  seen_at TEXT NOT NULL, PRIMARY KEY (device_id, interface));
CREATE TABLE IF NOT EXISTS mikrotik_bond (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mode TEXT, slaves TEXT, transmit_hash_policy TEXT, mlag_id TEXT, link_monitoring TEXT,
  mii_interval TEXT, lacp_rate TEXT, mtu INTEGER, comment TEXT, running INTEGER, disabled INTEGER,
  seen_at TEXT NOT NULL, PRIMARY KEY (device_id, name));
```
```ts
// mikrotik-scheda.ts: una riga = i campi della tabella con lo stesso nome (snake_case), senza device_id e seen_at;
// le colonne INTEGER 0/1 diventano boolean | null; yes/no/true/false → boolean, altro → null.
export type RigaBridgeMk = { name: string; mac_address: string | null; mtu: string | null; actual_mtu: number | null; l2mtu: number | null;
  arp: string | null; arp_timeout: string | null; protocol_mode: string | null; priority: string | null; fast_forward: boolean | null;
  igmp_snooping: boolean | null; dhcp_snooping: boolean | null; vlan_filtering: boolean | null; pvid: number | null; frame_types: string | null;
  ingress_filtering: boolean | null; ether_type: string | null; ageing_time: string | null; forward_delay: string | null;
  max_message_age: string | null; comment: string | null; running: boolean; disabled: boolean };
export type RigaPortaBridgeMk = { interface: string; bridge: string; pvid: number | null; priority: string | null; path_cost: number | null;
  internal_path_cost: number | null; edge: string | null; point_to_point: string | null; horizon: string | null; hw: boolean | null;
  hw_offload: boolean; frame_types: string | null; ingress_filtering: boolean | null; bpdu_guard: boolean | null; trusted: boolean | null;
  inactive: boolean; disabled: boolean; dynamic: boolean; comment: string | null };
export type RigaBondMk = { name: string; mode: string | null; slaves: string[]; transmit_hash_policy: string | null; mlag_id: string | null;
  link_monitoring: string | null; mii_interval: string | null; lacp_rate: string | null; mtu: number | null; comment: string | null;
  running: boolean; disabled: boolean };
export function parseBridgeScheda(out: string): RigaBridgeMk[];          // segni R, X
export function parsePorteBridgeScheda(out: string): RigaPortaBridgeMk[]; // segni I, X, D, H
export function parseBondScheda(out: string): RigaBondMk[];               // segni R, X; slaves separati da virgola
// mikrotik-letture.ts, RisultatoMk in più:
uscite: Partial<Record<"bridge" | "porteBridge" | "fasci", string>>; // solo le uscite lette (non «non so», non errore)
// db-tenant.ts
export interface SchedaMkTopologia { bridge: RigaBridgeMk[] | null; porte: RigaPortaBridgeMk[] | null; bond: RigaBondMk[] | null } // null = non letto
export function scriviSchedaMikrotikTopologia(deviceId: number, s: SchedaMkTopologia, adesso?: Date): { bridge: number; porte: number; bond: number } | null; // null = schema < 2
```

**Cosa fare**
- Schema: `migrateSchedaMikrotik` crea le tre tabelle (`CREATE TABLE IF NOT EXISTS`, nessun CHECK, nessun indice in più: la chiave primaria basta per `WHERE device_id = ?`) e scrive il segno `…:v2`. Le stesse CREATE stanno anche nello schema del tenant (`TENANT_SCHEMA_SQL`, come `DDL_TOPOLOGY_CAVI`). Segno e journal come nel Task 3.
- Fotografia, non storia: per ogni parte letta (non null), `DELETE FROM <tabella> WHERE device_id = ?` + INSERT di tutte le righe con lo stesso `seen_at`, in **una** transazione per le tre tabelle (regola 7 del CLAUDE.md). Una parte `null` (comando non riuscito o «non so») non tocca la sua tabella: si tengono le righe dell'ultima lettura buona, col loro `seen_at`. Così i contatori contano solo l'ultima lettura.
- `leggiMikrotikTopologia`: `prova` tiene l'uscita grezza quando l'esito è «letto» (in `uscite`), senza comandi nuovi. `letturaMikrotik` (jobs.ts), dopo `scriviFattiTopologia`, chiama `scriviSchedaMikrotikTopologia(device.id, { bridge: uscite.bridge ? parseBridgeScheda(...) : null, … })`; un'eccezione va nel log col solo codice e non cambia l'esito della lettura della topologia.
- Solo i router (ramo dei router del giro ARP, `jobs.ts:999-1002`): il ramo degli switch MikroTik (`jobs.ts:1005-1007`) non scrive queste tabelle.
- ADR 0024: le tabelle della scheda sono separate da quelle della topologia (la mappa legge solo `topology_*`, la scheda solo `mikrotik_*`); fotografia per apparato; cosa diventa difficile (due copie di parte degli stessi fatti, con età diverse se una scrittura fallisce).

**Verifica**
- Prove viste rosse: migrazione su un DB al livello 1 → tre tabelle, segno `v2`, seconda apertura `[]`, `integrity_check` ok; lettori sulle fixture vere (`mikrotik-mk3-testa.txt` e `-frontiera.txt`: `vlan_filtering` sì/no, `priority` «0x8000»; `mikrotik-mk4-testa.txt` e `-frontiera.txt`: `pvid` 214, `inactive` sulle righe `I`, `hw` sì; `mikrotik-mk8a-testa.txt`: `slaves` di bond1, `transmit_hash_policy` «layer-3-and-4», `mlag_id` null); scrittura: fotografia sostituita, parte `null` lasciata com'era.
- `arp-letture-mikrotik.test.ts`: con la lettura accesa e l'esecutore finto (`apriEsecutore`) le tre tabelle hanno le righe delle fixture; con la lettura spenta nessuna riga e nessun comando in più.
- **Misura sul dato vero**: copia del DB del cliente A e dell'hub (sola lettura, nello scratchpad), migrazione applicata alla copia con `npx tsx` su `getTenantDb`: tempo di apertura prima/dopo (atteso nell'ordine dei 7-22 ms di ADR 0018), `integrity_check` invariato, seconda apertura senza modifiche. Numeri in `TASKS.md`.
- Revisione del task (un revisore, livello completo) prima del commit.
- Dopo il rilascio, sull'hub: journal `scheda mikrotik, aggiunto mikrotik_bridge, …`, segno `done:…:v2`; dopo il primo giro con la lettura della topologia accesa `SELECT count(*) FROM mikrotik_bridge_port WHERE device_id=1`.

**Commit** `feat(mikrotik): attributi di bridge, porte e bond tenuti in tabelle della scheda (dalle letture della topologia)`

## Task 9 — Tab Bridge e VLAN (matrice parziale dai PVID), dettagli di bond e bridge (P3, completo)

**File**
- crea `src/app/api/devices/[id]/mikrotik-scheda/route.ts` (GET), `src/components/scheda/tipi/router/mikrotik/{bridge,vlan}.tsx`, `scripts/prova-scheda-mikrotik.ts`
- modifica `src/lib/db-tenant.ts` (`leggiSchedaMikrotik`, `contaBridgeMikrotik`), `src/app/api/devices/[id]/route.ts:59-130` (campo `mikrotik`), `src/lib/scheda/mikrotik.ts` (`matriceVlan`, `espandiVlanIds`), `src/components/scheda/tab-scheda.tsx` (`ETICHETTE_TAB.bridge = "Bridge"`, `TAB_ROUTER.bridge`, `TAB_ROUTER.vlan` → `VlanMikrotik`: `vlan` per i router compare solo con `mikrotik` non null, quindi nessun altro router lo vede), `src/components/scheda/tipi/router/mikrotik/{interfacce,panoramica,dati-mikrotik}.tsx`, `src/lib/__tests__/api-auth-guards.test.ts`
- prove: `src/lib/scheda/__tests__/mikrotik.test.ts`, prova della rotta accanto a `src/lib/devices/__tests__/interfacce-scheda.test.ts`

**Interfacce prodotte**
```ts
// src/lib/scheda/mikrotik.ts
export interface RispostaSchedaMikrotik {
  bridge: RigaBridgeMk[]; porte: RigaPortaBridgeMk[]; bond: RigaBondMk[];
  letto_il: string | null;                         // seen_at della fotografia
  vlanBridge: RigaVlanBridgeMk[] | null;           // null fino al Task 10 (e con la lettura «mikrotik_scheda» mai riuscita)
  vlan: RigaVlanMk[] | null;                       // idem
  dns: RigaDnsMk | null;                           // idem
  letture: { topologia: { acceso: boolean; il: string | null }; scheda: { acceso: boolean; il: string | null } };
}
// GET /api/devices/[id]/mikrotik-scheda → 200 RispostaSchedaMikrotik; 404 apparato; 400 non MikroTik
// db-tenant.ts
export function leggiSchedaMikrotik(deviceId: number): Omit<RispostaSchedaMikrotik, "letture">; // livello < 2 → tutto vuoto, letto_il null
export function contaBridgeMikrotik(deviceId: number): { bridge: number; letto_il: string | null } | null; // null = schema < 2
// GET /api/devices/[id] in più: mikrotik: { bridge: number; letto_il: string | null } | null  (solo se vendor mikrotik e protocol ssh)
// scripts/prova-scheda-mikrotik.ts <copia.db> --cartella <scratchpad> --device <id> [--livello 2|3]
//   scrive nella COPIA (mai altrove: controllaPercorsi come estrai-fixture-topologia.ts) le righe ricavate dalle fixture
//   mk3/mk4/mk8a (livello 2) e, col livello 3, da quelle del Task 1: serve solo alla resa in locale
```
```ts
export type CellaVlan = "U" | "T" | null;
export interface ColonnaVlan { id: number | null; etichetta: string; nome: string | null } // id null = intervallo non espanso («100-200»)
export interface MatriceVlan {
  bridge: string;
  colonne: ColonnaVlan[];                       // ordinate per id
  righe: { porta: string; stato: "attiva" | "inattiva" | "disabilitata"; pvid: number | null; bond: RigaBondMk | null; celle: CellaVlan[] }[];
  completa: boolean;                            // false = senza /interface bridge vlan (solo PVID)
}
export function espandiVlanIds(s: string, max = 64): { id: number | null; etichetta: string }[];
export function matriceVlan(i: { bridge: RigaBridgeMk; porte: RigaPortaBridgeMk[]; bond: RigaBondMk[];
  vlanBridge: RigaVlanBridgeMk[] | null; vlan: RigaVlanMk[] | null; statoPorta: (nome: string) => "attiva" | "inattiva" | "disabilitata" }): MatriceVlan;
```
`RigaVlanBridgeMk`, `RigaVlanMk`, `RigaDnsMk` si dichiarano qui con la forma scritta nel Task 10 e la rotta dà `null` finché il Task 10 non li legge.

**Cosa fare** (artboard `MkBridge` M17-M18, `MkVlan` M15-M16, `MkInterfacce` M10-M11; regola U/T del censimento §1.8)
- Rotta: `requireAuth()`, `withTenantFromSession`, `leggiSchedaMikrotik` + `leggiInterruttore("mikrotik")`/`leggiEsiti("mikrotik")[id]` (e `"mikrotik_scheda"` dal Task 10; qui `{ acceso: false, il: null }`).
- Tab Bridge: striscia di tre caselle (Porte «n su m bridge», Bond «nome · modo», HW offload «n porte con hw=yes»); tabella «Porte del bridge e spanning tree» con Interfaccia (bond: riga sotto «modo · slave · hash»; commento sotto), Bridge, Stato (✓ attiva / ● inattiva / ✕ disabilitata + «HW» se `hw_offload`), PVID, Priorità, Path cost, Edge, P2P, HW, Frame types, Ingress, BPDU guard (● sì / ○ no) e **Ruolo STP** (da `topology_port_facts` dell'ultima lettura, `source = 'device'`, stessa porta: «root · forwarding»; la rotta lo unisce, una query sola). Legenda sotto.
- Interfacce (Task 5): Dettagli dei bond (M10: «modo · slave · hash · MLAG · controllo link mii n») e dei bridge (M11: «VLAN filter ✓ sì / ✕ no»).
- Panoramica: Contatori Porte bridge e Bond dall'ultima fotografia; casella VLAN «su n bridge»; `RigaFonti` «topologia <ora>» oppure «bridge e porte: lettura "Spanning tree, bridge e fasci" spenta» (caso 5).
- `GET /api/devices/[id]` aggiunge `mikrotik` (`contaBridgeMikrotik`, una COUNT, solo per MikroTik in SSH): da qui la pagina passa `haBridge = bridge > 0` (Task 6) e le tab VLAN e Bridge compaiono, tutte e due già registrate in questo task.
- Regola per cella (porta, VLAN): 1) la porta è negli untagged della riga `bridge vlan` (unione di `untagged` e `current_untagged`) → U; 2) è nei tagged (unione di `tagged` e `current_tagged`) → T; 3) il suo PVID è quella VLAN → U implicito; 4) altrimenti vuota. Una porta che non risulta fra le interfacce lette conta come attiva (come il Manager).
- Senza righe `bridge vlan` (`vlanBridge` null, prima del Task 10 o con la lettura spenta): colonne = PVID distinti delle porte del bridge e PVID del bridge; solo la regola 3; `completa: false` e sotto la matrice una riga: «Tagged: serve la lettura "VLAN, DNS e utenti dei MikroTik", spenta» (o «mai letta»).
- Colonne: nome dall'interfaccia VLAN con quell'id sul bridge (Task 10; la prima se più d'una), id in badge sotto; `espandiVlanIds` («10,20», «100-110»; oltre `max` una colonna sola con l'etichetta dell'intervallo, caso 4).
- Un `Riquadro` per bridge: testata con nome, MAC e i 19 attributi in griglia (VLAN filtering, Protocol mode, PVID, Porte, VLAN, MTU, Actual MTU, L2 MTU, ARP, ARP timeout, Fast forward, IGMP snooping, DHCP snooping, Priorità, Ageing time, Forward delay, Frame types, Ingress filtering, Ether type); matrice con righe = porte (stato con segno, «P:<pvid>», per i bond «modo · slave · hash»); celle U pieno scuro con la lettera, T bordo spesso con la lettera; legenda e regola in una riga sotto. La matrice scorre dentro il riquadro se le colonne sono tante.
- `scripts/prova-scheda-mikrotik.ts`: per la resa in locale se DA-RT-CORE non ha bridge (Task 1) o la lettura della topologia è spenta sull'hub.

**Verifica** prova della rotta (401, 404, 400, risposta con le righe del DB di prova, `letture.topologia` dall'interruttore); prova di `contaBridgeMikrotik` (livello < 2 → null; zero bridge → 0); prove viste rosse di `matriceVlan` (porta in untagged → U; in tagged → T; solo PVID → U; niente → vuoto; intervallo 100-110 espanso; 2-4094 → una colonna; `completa: false` senza righe bridge vlan) e di `espandiVlanIds`; `api-auth-guards.test.ts` con `devices/[id]/mikrotik-scheda` GET `requireAuth`; `verifica-permessi.sh`; resa a 1440 di `/objects/227` (o della copia seminata dallo script a livello 2) tab Bridge, VLAN (matrice parziale) e Interfacce; un router MikroTik con zero bridge non ha le tab VLAN e Bridge; SNS EVA2 invariato. Revisione del task.

**Commit** `feat(scheda): tab Bridge e VLAN dei MikroTik (matrice dai PVID), dettagli di bond e bridge, solo con un bridge`

## Task 10 — Lettura «VLAN, DNS e utenti dei MikroTik», spenta di default (P4, completo)

**File**
- modifica `src/lib/topology/letture/interruttori.ts:9-13` (`LETTURE`, `LETTURE_DISPONIBILI`), `src/lib/topology/letture/testi.ts:12-37` (`DESCRIZIONE_LETTURE`), `src/lib/devices/mikrotik-letture.ts` (`COMANDI_MK_SCHEDA`, `leggiMikrotikScheda`), `src/lib/devices/mikrotik-scheda.ts` (quattro lettori), `src/lib/db-tenant-schema.ts` (`DDL_SCHEDA_MK_V3`, `VERSIONE_SCHEDA_MK = 3`), `src/lib/db-tenant.ts` (migrazione, `scriviSchedaMikrotikLettura`, `leggiSchedaMikrotik` riempie `vlanBridge`/`vlan`/`dns`), `src/lib/cron/jobs.ts:999-1002` (`letturaSchedaMikrotik`), `src/app/api/devices/[id]/mikrotik-scheda/route.ts` (`letture.scheda`)
- crea `src/app/api/devices/[id]/mikrotik-utenti/route.ts` (GET, admin)
- modifica `src/lib/permessi/rotte.ts` (`ATTESI`: `/api/devices/[id]/mikrotik-utenti` GET `admin`), `src/lib/__tests__/api-auth-guards.test.ts`
- prove: `src/lib/devices/__tests__/mikrotik-scheda.test.ts`, `src/lib/__tests__/scheda-mikrotik-migration.test.ts`, `src/lib/cron/__tests__/arp-letture-mikrotik.test.ts`, `src/lib/topology/letture/__tests__/{interruttori,testi}.test.ts` (le prove che contano «tutte e quattro» passano a cinque: il motivo nel commit)

**Interfacce prodotte**
```ts
// interruttori.ts
export const LETTURE = ["mikrotik", "controller", "snmp", "host", "mikrotik_scheda"] as const; // chiave topologia.lettura.mikrotik_scheda
// mikrotik-letture.ts
export const COMANDI_MK_SCHEDA = {
  vlanBridge: "/interface bridge vlan print terse without-paging",
  vlan: "/interface vlan print terse without-paging",
  dns: "/ip dns print",
  utenti: "/user print terse without-paging",
} as const;
export interface RisultatoMkScheda { vlanBridge: RigaVlanBridgeMk[] | null; vlan: RigaVlanMk[] | null; dns: RigaDnsMk | null; utenti: RigaUtenteMk[] | null;
  comandi: number; riusciti: number; codice: string | null }
export function leggiMikrotikScheda(esegui: Esegui): Promise<RisultatoMkScheda>; // una connessione, TEMPO_COMANDO_MS, interpretaUscita per ognuno
// mikrotik-scheda.ts (i quattro tipi sono già dichiarati dal Task 9 con questa forma; qui arrivano i lettori)
export type RigaVlanBridgeMk = { bridge: string; vlan_ids: string; tagged: string[]; untagged: string[]; current_tagged: string[];
  current_untagged: string[]; dynamic: boolean; disabled: boolean; comment: string | null };
export type RigaVlanMk = { name: string; vlan_id: number | null; interface: string | null; mtu: number | null; mac_address: string | null;
  running: boolean; disabled: boolean; comment: string | null };
export type RigaDnsMk = { servers: string[]; dynamic_servers: string[]; allow_remote_requests: boolean | null; cache_size: string | null;
  cache_used: string | null; max_concurrent_queries: number | null; use_doh_server: string | null };
export type RigaUtenteMk = { name: string; group: string | null; address: string | null; last_logged_in: string | null; disabled: boolean; comment: string | null };
export function parseVlanBridge(out: string): RigaVlanBridgeMk[];
export function parseVlanInterfacce(out: string): RigaVlanMk[];
export function parseDns(out: string): RigaDnsMk | null;   // `chiave: valore`; nessuna chiave nota → null
export function parseUtenti(out: string): RigaUtenteMk[];  // nessuna password: l'uscita non la contiene
// db-tenant.ts
export function scriviSchedaMikrotikLettura(deviceId: number, r: RisultatoMkScheda, adesso?: Date): boolean; // false = schema < 3
export function leggiUtentiMikrotik(deviceId: number): { utenti: RigaUtenteMk[]; letto_il: string | null } | null;
// GET /api/devices/[id]/mikrotik-utenti → requireAdmin; 200 { utenti, letto_il }
```
```sql
CREATE TABLE IF NOT EXISTS mikrotik_bridge_vlan (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  pos INTEGER NOT NULL, bridge TEXT NOT NULL, vlan_ids TEXT NOT NULL, tagged TEXT, untagged TEXT, current_tagged TEXT,
  current_untagged TEXT, dynamic INTEGER, disabled INTEGER, comment TEXT, seen_at TEXT NOT NULL, PRIMARY KEY (device_id, pos));
CREATE TABLE IF NOT EXISTS mikrotik_vlan (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL, vlan_id INTEGER, interface TEXT, mtu INTEGER, mac_address TEXT, running INTEGER, disabled INTEGER,
  comment TEXT, seen_at TEXT NOT NULL, PRIMARY KEY (device_id, name));
CREATE TABLE IF NOT EXISTS mikrotik_dns (
  device_id INTEGER PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  servers TEXT, dynamic_servers TEXT, allow_remote_requests INTEGER, cache_size TEXT, cache_used TEXT,
  max_concurrent_queries INTEGER, use_doh_server TEXT, seen_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mikrotik_user (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  name TEXT NOT NULL, grp TEXT, address TEXT, last_logged_in TEXT, disabled INTEGER, comment TEXT,
  seen_at TEXT NOT NULL, PRIMARY KEY (device_id, name));
```
Liste (`tagged`, `servers`…) salvate come testo separato da virgole, rilette in array.

**Cosa fare**
- Testi: `DESCRIZIONE_LETTURE.mikrotik_scheda` = titolo «VLAN, DNS e utenti dei MikroTik», legge «Le VLAN dei bridge (tagged e untagged per porta), le interfacce VLAN col loro id e la loro interfaccia madre, la configurazione DNS, gli utenti del router (nome, gruppo, ultimo accesso; nessuna password).», apparati «router MikroTik letti via SSH», comandi «/interface bridge vlan print · /interface vlan print · /ip dns print · /user print (sola lettura, una connessione per apparato, al più una volta l'ora)». Si accende e spegne dalla card «Letture in più» di «Dati della mappa» (`PUT /api/topology/settings/letture`, già admin), che la mostra da sola.
- `jobs.ts`, ramo dei router, subito dopo `letturaMikrotik` (riga 1001): `esitiLetture.push(await letturaSchedaMikrotik(device, options))` con `conCadenza("mikrotik_scheda", device.id, …)`; dentro, se `livelloSchemaSchedaMk < 3` → errore con codice `SCHEMA_SCHEDA` (esito per apparato, nessun comando). `apriEsecutore` di `options` vale anche qui (prove).
- `/user print terse` al posto della tabella di `/user print` (decisione: stesso comando in sola lettura, forma `terse` che legge `campiTerse`; la tabella si rompe sui valori con spazi).
- Scrittura: fotografia per tabella come nel Task 8 (null = non letto, la tabella resta com'era); `pos` = ordine di lettura per `mikrotik_bridge_vlan` (le righe non hanno un nome).
- `leggiSchedaMikrotik` riempie `vlanBridge`, `vlan`, `dns` (null se mai letti); **non** gli utenti. `mikrotik-utenti`: `requireAdmin()` prima istruzione.

**Verifica**
- Prove viste rosse sui lettori con le fixture vere del Task 1 (`vlan_ids` con elenco e intervallo se ci sono; righe `D` dinamiche; VLAN con `interface` = bridge; DNS con `servers` multipli; utenti senza alcun campo `password`); `leggiMikrotikScheda` con un esecutore finto: un comando in errore RouterOS (`bad command name`) → quella parte null e `codice`, le altre lette; uscita non capita → null, mai `[]`.
- Migrazione: livello 2 → 3, segno `v3`, seconda apertura `[]`, `integrity_check` ok; **misura** di nuovo sulle copie del cliente A e dell'hub (tempo di apertura, integrità), numeri in `TASKS.md`.
- `arp-letture-mikrotik.test.ts`: con `mikrotik_scheda` spenta **nessuno** dei quattro comandi parte (spia sull'esecutore); accesa: quattro comandi, righe scritte, esito per apparato; cadenza: secondo giro nell'ora → `saltato`.
- Rotte: `mikrotik-utenti` 401 senza sessione, 403 da viewer, 200 da admin; `rotte-censite.test.ts` verde con la voce in `ATTESI`; `api-auth-guards.test.ts`; `verifica-permessi.sh`.
- Revisione del task.
- Dopo il rilascio, sull'hub: journal e segno `v3`; la lettura risulta **spenta** in «Dati della mappa»; nessuna riga nelle quattro tabelle.

**Commit** `feat(mikrotik): lettura spenta di VLAN dei bridge, interfacce VLAN, DNS e utenti (quattro comandi in sola lettura)`

## Task 11 — Matrice VLAN completa, VLAN nelle interfacce, DNS e utenti in Panoramica (P4, completo)

**File** modifica `src/components/scheda/tipi/router/mikrotik/{vlan,interfacce,panoramica,dati-mikrotik}.tsx`, `src/lib/scheda/mikrotik.ts` (`contatoriMikrotik` e `caselleMikrotik` con VLAN e utenti dalle letture), prove in `src/lib/scheda/__tests__/mikrotik.test.ts`

**Cosa fare** (artboard `MkVlan` M16, `MkInterfacce` M9, `MkPanoramica` M3-M5, M7)
- VLAN: `matriceVlan` con `vlanBridge` e `vlan` dalla rotta → `completa: true`, colonne col nome della VLAN.
- Interfacce, gruppo VLAN: Dettagli «VLAN <id> ↳ <madre> (<tipo della madre>)» da `mikrotik_vlan`; senza lettura resta vuoto e `RigaFonti` lo dice.
- Panoramica: riquadro **DNS** (M4: Server come badge, Richieste remote «● accese / ○ spente», Cache «usata / totale», Max query); riquadro **Utenti del router** (M5) **solo se `ctx.isAdmin`**, dati da `/api/devices/[id]/mikrotik-utenti` (Nome, Gruppo, Ultimo accesso in ora italiana o «mai»); Contatori VLAN (da `mikrotik_vlan` se letto, altrimenti dalle interfacce) e Utenti (solo admin); `RigaFonti` «DNS e utenti: lettura spenta» / «mai letta» / ora dell'ultima.
- La Panoramica resta in 1440×900: i due riquadri nuovi prendono il posto nella griglia 3×2 (Risorse, Hardware, Contatori / DNS, Utenti, Interfacce per tipo); da viewer il posto degli Utenti resta a Interfacce per tipo.

**Verifica** prove viste rosse di `contatoriMikrotik` (utenti null per non admin; VLAN dalla lettura vince sulle interfacce) e della matrice completa sulle fixture del Task 1; resa a 1440 sulla copia seminata a livello 3 (`scripts/prova-scheda-mikrotik.ts --livello 3`) da admin (Utenti visibili) e da viewer (Utenti assenti, nessuna chiamata a `mikrotik-utenti` nella rete del browser). Revisione del task.

**Commit** `feat(scheda): matrice VLAN completa, VLAN con la madre, DNS e utenti del router (solo admin) nella scheda MikroTik`

## Task 12 — Documenti e verifica sull'hub (leggero)

- `CHANGELOG.md` (il perché: la pagina MikroTik del Manager portata in DA-IPAM con i dati letti da sé; cosa non si porta e perché: IP Scan, backup binari, script, archivio B5).
- `CONTEXT.md` §6, voce «Scheda apparato per tipo»: una riga sulla scheda MikroTik (tab, `OpzioniTab.mikrotik`, tabelle `mikrotik_*` fotografia per apparato, ADR 0024, lettura `mikrotik_scheda` spenta di default, utenti solo admin); trappola: la scheda legge `mikrotik_*`, la mappa `topology_*`. Tetto ~10k caratteri (`wc -c`).
- `docs/scheda-mappa.md` (`prossimo:`), `TASKS.md` spuntato, con aperti: conteggi nelle etichette delle tab; esito del caso 1; accensione della lettura `mikrotik_scheda` sull'hub (decide Riccardo).
- Verifica sull'hub: versione arrivata (`/api/version` + riga d'avvio nel journal), segno `scheda_mikrotik_v21` = `done:…:v3`, pagina `/objects/227` aperta con `prova-claude` (viewer) a 1440×900: tab nell'ordine dei vincoli, VLAN/Bridge presenti solo se DA-RT-CORE ha un bridge e la lettura della topologia è accesa, Panoramica senza scorrimento, Utenti assenti (viewer).

**Commit** `docs(mikrotik): chiusura della scheda MikroTik copiata dal Manager` + release + push.

## Fuori da questo piano

P5: archivio delle configurazioni (piano B5 di `2026-10-21-recupero-dadude3-mknet.md`, con «Confronta» e «copia precedente»), elenco delle regole del firewall. Per scelta di Riccardo: IP Scan del router, backup binari, generatore di script, importazione SFTP. Conteggi nelle etichette delle tab e link «non in IPAM» dei vicini (M14): riga in `TASKS.md`.

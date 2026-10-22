# Accorpamento degli IP, blocco di «Rendi apparato», matrice VLAN degli switch — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** un apparato fisico ha una riga sola in Discovery e non può diventare due apparati; gli switch mostrano la matrice porte × VLAN letta via SNMP, come i MikroTik.

**Architettura:** A — un controllo unico lato server (`apparatoGiaPresente` in `src/lib/devices/apparato-del-cluster.ts`) che `creaApparato` e `POST /api/devices/bulk` chiamano prima di scrivere; la finestra lo anticipa. B — l'API di Discovery allega a ogni host le informazioni del suo cluster fisico (`hosts.physical_device_id`), calcolate in una query da `src/lib/devices/cluster-discovery.ts`; la pagina nasconde gli IP secondari e mette «+N IP» sulla riga principale; il principale scelto a mano sta in una colonna nuova `physical_devices.primary_host_id`. C — una lettura SNMP nuova (Q-BRIDGE-MIB) scrive quattro tabelle `switch_vlan*` nel DB del cliente, dietro l'interruttore `topologia.lettura.switch_vlan` (spento, ADR 0018); la matrice di oggi dei MikroTik diventa un componente condiviso che la tab VLAN dello switch riusa.

**Spec:** le decisioni di Riccardo del 22/10 qui sotto (non c'è una spec separata). Grafica: artboard **`Discovery`** (parti A e B) e **`SwitchVlan`** (parte C) del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv — **si leggono prima di scrivere l'interfaccia** (`Artifact` con `action: "read"`); se mancano ancora, ci si ferma e si chiede (non si disegna da sé). Modelli di struttura: `docs/superpowers/plans/2026-10-21-scheda-mikrotik-dal-manager.md` (lettura spenta, tabelle proprie, segno di migrazione), `docs/superpowers/plans/2026-10-21-tappe-3-5-rendi-apparato.md` (finestra «Rendi apparato»).

**Livello di controllo** (deciso da Riccardo il 22/10/2026): **A leggero** (Task 1-2). **B leggero per l'interfaccia** (Task 4-6), ma la query della lista di Discovery è condivisa e calda: **misura sulla copia del DB dell'hub** (Task 3 e Task 4). La colonna nuova di B (`physical_devices.primary_host_id`) è una migrazione sui DB dei clienti: per quel solo pezzo valgono le regole del completo (prova vista fallire, due aperture sulla copia). **C completo** (Task 7-12): migrazione sui DB dei clienti e letture SNMP sugli switch dei clienti; prova vista fallire, misura sul dato vero, revisione per task, prova a vuoto sulla copia prima del push.

**Stato:** bozza · **Ultimo aggiornamento:** 2026-10-22

## Decisioni di Riccardo (22/10) — non riaprire

- **A.** «Rendi apparato» su un IP che appartiene già (stesso cluster di device fisico) a un apparato gestito è **BLOCCATO** con «Questo IP è già dell'apparato X» e un link; vale per il flusso singolo e per quello in blocco (fino a 50) (`components/devices/rendi-apparato-*.tsx`, la rotta server dietro — **il blocco sta sul server**, non solo nell'interfaccia). Contesto: il 21/10 sull'hub è nato così un apparato doppio DA-RT-CORE (nd 318) per il router MK-RTR-CORE (nd 1); tolto il 22/10.
- **B.** Accorpamento a mano degli IP dello stesso device: la logica dei cluster esiste (`physical_device_id`; interfaccia «IP collegati allo stesso device fisico» con «Collega altro IP / Esci dal cluster»; `src/lib/devices/apparato-del-cluster.ts` del 22/10 con esiti proprio/cluster/ambiguo/nessuno; la pagina del device rende già la scheda dell'apparato da qualunque IP di un cluster con un solo apparato). Nuovo: nella lista Discovery gli IP secondari sono **NASCOSTI** e la riga principale porta un badge **«+N IP»** che apre l'elenco degli altri; cercando un IP secondario compare la riga principale («trovato come IP secondario»); nelle viste per subnet/rete ogni IP resta nella sua subnet (la molteplicità resta). Principale = l'IP dell'apparato gestito se il cluster ne ha uno, altrimenti quello scelto da chi accorpa, cambiabile dopo («Scegli come principale»). Contatori: si dice esplicitamente che cosa conta ogni contatore di Discovery dopo il cambio. La paginazione non si sposta sul client (vedi «Scostamenti rilevati» sotto).
- **C.** Matrice VLAN per gli switch (qualunque marca via SNMP, Ubiquiti completato dal controller UniFi): Q-BRIDGE-MIB `dot1qVlanStaticName` (1.3.6.1.2.1.17.7.1.4.3.1.1), `dot1qVlanStaticEgressPorts` (.4.3.1.2), `dot1qVlanStaticUntaggedPorts` (.4.3.1.4), `dot1qVlanCurrentEgressPorts`/`UntaggedPorts` (.4.2.1.4/.5), `dot1qPvid`; bitmap tradotte con `dot1dBasePortIfIndex` (ripiego: indice del bit = ifIndex quando la mappa è vuota, come corretto il 21/10 in `snmp-port-schema.ts`). Misurato sull'hub il 21/10: SW-CED-48POE-242 e SW-CED-16XG-241 rispondono alle tabelle Static* (13 VLAN ciascuno); SW-ING-ProMax-239 non ha `dot1dBasePortIfIndex` e ha solo CurrentEgress. Dati per apparato in tabelle nuove (migrazione additiva e idempotente col segno), letti durante la lettura SNMP degli switch che esiste (nessun automatismo nuovo se non serve; se serve una lettura periodica nuova nasce **SPENTA**, ADR 0018). Completamento dal controller UniFi (`port_table` `native_networkconf_id`/reti tagged + elenco `networkconf`) **solo se** il client UniFi di oggi ammette quell'endpoint (lista bianca di `unifi-api`), altrimenti task successivo. Si riusa la matrice MikroTik (`matriceVlan`/`espandiVlanIds` in `src/lib/scheda/mikrotik.ts`, componente `src/components/scheda/tipi/router/mikrotik/vlan.tsx`, nomi in verticale, regole U/T) **estraendo un componente condiviso**, non copiando. La tab VLAN dello switch c'è (`src/components/scheda/tipi/switch/`): il contenuto diventa la matrice + una striscia (VLAN, trunk, access, senza VLAN).
- Ogni rilascio: `npm run version:release` + push su `dev` (arriva all'appliance del cliente A).

## Scostamenti rilevati leggendo il codice (decisioni prese nel piano)

1. **Discovery oggi non pagina sul server.** `GET /api/hosts/discovery?lite=1` (`src/app/api/hosts/discovery/route.ts`) restituisce fino a 10.000 host da `getAllHostsEnriched(10000)` (`src/lib/db-tenant.ts:2739`); filtri, ordinamento, conteggi e pagine si fanno nel client (`src/app/(dashboard)/discovery/page.tsx:893-970`). Il piano **non** introduce la paginazione sul server (cambio di scope): calcola l'accorpamento **sul server** (l'API marca ogni riga) e lascia al client solo il «nascondi i secondari», così una futura paginazione sul server non cambia regola.
2. **Due nozioni di «stesso device».** Il cluster fisico (`hosts.physical_device_id`, manuale o dall'identity-resolver) e i gruppi multihomed (`multihomed_links`, ricalcolati anche da hostname/sysname/AD, colonna «MH» di Discovery e dedup delle scansioni). B usa **solo il cluster fisico**, come chiesto; la colonna «MH» e `recomputeMultihomedLinks` non si toccano (proposta a parte in fondo).
3. **Lista bianca UniFi:** `isUnifiRequestAllowed` (`src/lib/integrations/unifi-api.ts:169`) ammette solo `stat/device`, `stat/sta`, `self/sites`. `rest/networkconf` (nomi e numeri delle reti) **non è ammesso**: il completamento dal controller è il Task 13, **fuori da questo giro**, e chiede l'ok di Riccardo per allargare la lista.
4. **Due rotte creano apparati da host:** `POST /api/devices` (`creaApparato`, usata dalla finestra «Rendi apparato», anche in blocco: un POST per host) e `POST /api/devices/bulk` (modifica in blocco della lista per classificazione). Il blocco va in **tutte e due**.

## Vincoli globali

- Discovery: l'**ordine delle 19 colonne è di Riccardo** (`CONTEXT.md` §6): niente colonne nuove né spostate. Il badge «+N IP» sta **dentro la cella IP**; le viste filtrano, non riordinano.
- Messaggio del blocco, parola per parola: `Questo IP è già dell'apparato <nome>`; link a `/objects/<host_id dell'apparato>` (non `/devices/[id]`, che rimanda comunque lì). Codice HTTP **409**, corpo `{ error, codice: "IP_DI_APPARATO", apparato: { network_device_id, nome, host_id, ip } }`.
- Ogni GET nuova: `requireAuth()` come prima istruzione; ogni PUT/POST `requireAdmin()`; poi `withTenantFromSession`; import **statico** di `@/lib/db-tenant` (ADR 0002); voce in `CONTRACT` di `src/lib/__tests__/api-auth-guards.test.ts`; `npx tsx --test src/lib/permessi/__tests__/rotte-censite.test.ts` verde.
- Schema solo additivo, idempotente, in una transazione, all'apertura del tenant (`getTenantDb`); niente DROP, niente ricostruzioni, **nessun CHECK nuovo**; riga nel journal con ciò che aggiunge; segno in `tenant_settings` `done:<AAAA-MM-GG>:v<N>`.
- Letture sugli switch dei clienti (C): solo dietro `topologia.lettura.switch_vlan` (chiave assente = **spenta**), al più una volta l'ora per apparato (`conCadenza`), 10 s per lettura SNMP (ADR 0018), tre esiti (letto / non riuscito / **non so**: un «non so» non scrive mai una lista vuota). Sola lettura: nessun SET.
- Ogni task: `npm run lint && npx tsc --noEmit && npm run build`, poi `npm run version:release` + `git push origin dev` (un push di codice è un rilascio anche per il cliente A, `CONTEXT.md` §3). Albero condiviso: mai `git add -A`; `git diff <file>` e stage per file; in `TASKS.md` solo le righe di questo piano.
- Prove: `DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ipam-prove.XXXXXX") node --import tsx --test <file>`; log nello scratchpad della sessione, esito dal codice d'uscita (`cmd; ESITO=$?`), mai da `| tail`.
- Copia del DB dell'hub: `sqlite3 .backup` sull'hub (VM 533, skill `deploy-prod`), copiata nello scratchpad, mai nel repo; sul Mac `npm run dev` con `DA_INVENT_DATA_DIR` sulla copia, utente locale con riga in `user_tenant_access`. Resa una volta per task, a **1920×1080** (schermo di riferimento) e controllo a 1440×900.
- Stile: stato sempre segno + parola; testo ≥ 13 px; U/T distinti da lettera e luminanza (U pieno scuro, T bordo spesso su bianco), mai solo dal colore; token `--host-*` per gli stati; `Riquadro`, `StrisciaNumeri`, `RigaFonti` di `src/components/scheda/`.
- Repo pubblico: nelle fixture niente nomi di clienti, IP o MAC veri (IP → 192.0.2.0/24, 198.51.100.0/24; MAC → `02:00:A0:10:xx:yy`; nomi VLAN → parole neutre).

## Casi da non dimenticare

1. **Cluster con due apparati** (ambiguo, com'era l'hub fra il 21 e il 22/10): «Rendi apparato» è bloccato col primo apparato per `network_devices.id` (Task 1); Discovery **non** accorpa quel cluster, tutte le righe restano visibili perché qualcuno lo sistemi (Task 3).
2. **Stesso IP in due reti** (due righe `hosts` con lo stesso `ip`): il blocco controlla **tutte** le righe con quell'IP, non la prima che `getHostByIp` trova (Task 1).
3. **IP che è già lui stesso un apparato** (esito «proprio»): bloccato col nome di quell'apparato, come la rotta bulk fa già con «Già presente come dispositivo» (Task 1).
4. **Principale che esce dal cluster** (`Esci dal cluster` o host cancellato): `primary_host_id` torna NULL (scollegamento esplicito; cancellazione con `ON DELETE SET NULL`) e vale il ripiego (Task 3 e Task 6).
5. **Switch che risponde solo a CurrentEgress e senza `dot1dBasePortIfIndex`** (SW-ING-ProMax-239): bit = ifIndex, U dedotta dal PVID, matrice marcata «dedotta» con una riga che lo dice (Task 7 e Task 11).

## Tabella dei passi

| ID | Stato | Passo | Agente | Dipende da | Fatto quando | Verifica |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | [ ] | Blocco sul server | implementer | — | 409 su IP del cluster, 3 rotte di creazione coperte | prova `apparato-gia-presente` vista rossa poi verde |
| S2 | [ ] | Blocco nella finestra | implementer | S1 | riga bloccata col link, singolo e in blocco | resa su copia hub |
| S3 | [ ] | Principale del cluster e misura | implementer | — | colonna + funzione pura + nomi delle righe nascoste | prova + misura sulla copia |
| S4 | [ ] | API Discovery con il cluster | implementer | S3 | ogni riga marcata, tempo entro la soglia | misura sulla copia |
| S5 | [ ] | Discovery: nascondi, «+N IP», ricerca, contatori | implementer | S4 | come l'artboard `Discovery` | resa su copia hub |
| S6 | [ ] | «Scegli come principale» | implementer | S3 | PUT + bottoni + scelta nel collega | prova + resa |
| S7 | [ ] | Lettore Q-BRIDGE | implementer | — | tre fixture vere lette giuste | prova vista rossa |
| S8 | [ ] | Tabelle `switch_vlan*` | implementer | S7 | due aperture, stesso schema, segno v1 | prova + copia hub + copia cliente A |
| S9 | [ ] | Lettura `switch_vlan` spenta | implementer | S8 | spenta = nessuna walk; accesa = scrive; non so = non scrive | prova vista rossa |
| S10 | [ ] | Matrice condivisa | implementer | — | MikroTik identico prima/dopo | prova + resa `/objects/227` |
| S11 | [ ] | Tab VLAN dello switch | implementer | S9, S10 | striscia + matrice sui tre switch dell'hub | resa su copia hub |
| S12 | [ ] | Accensione sull'hub e verifica | sessione principale | S11 | dati dei tre switch nel DB dell'hub | `sqlite3 -readonly` + pagina |
| S13 | [-] | Completamento UniFi | — | ok di Riccardo | fuori da questo giro | — |

---

## Parte A — blocco di «Rendi apparato» (leggero)

### [ ] Task 1 — Blocco sul server

**File**
- modifica `src/lib/devices/apparato-del-cluster.ts` (funzione nuova in fondo)
- modifica `src/lib/devices/crea-apparato.ts` (tipo `EsitoCreaApparato` riga 38-40; controllo prima della transazione di riga 84)
- modifica `src/app/api/devices/route.ts` (POST, righe 126-148: passa `apparato` e `codice` nel corpo 409)
- modifica `src/app/api/devices/bulk/route.ts` (ciclo di riga 144: al posto del solo `getNetworkDeviceByHost`)
- crea `src/lib/devices/__tests__/apparato-gia-presente.test.ts`
- modifica `src/lib/devices/__tests__/crea-apparato.test.ts` (un caso nuovo)

**Interfacce prodotte**

```ts
// apparato-del-cluster.ts
export interface ApparatoGiaPresente { network_device_id: number; nome: string; host_id: number; ip: string }
/** L'apparato che possiede già questo IP: lo stesso host («proprio») o un altro host del suo cluster fisico.
 *  Controlla TUTTE le righe `hosts` con quell'IP. Con più apparati nel cluster: il primo per network_devices.id. */
export function apparatoGiaPresente(db: Database.Database, ip: string): ApparatoGiaPresente | null;
export const messaggioIpDiApparato = (nome: string): string => `Questo IP è già dell'apparato ${nome}`;
```

```ts
// crea-apparato.ts
export type EsitoCreaApparato =
  | { ok: true; device: NetworkDevice }
  | { ok: false; status: 400; error: string }
  | { ok: false; status: 409; error: string; codice: "IP_DI_APPARATO"; apparato: ApparatoGiaPresente };
```

**Cosa fare**
- `apparatoGiaPresente`: (1) `SELECT id, physical_device_id FROM hosts WHERE ip = ?` (tutte); (2) per ciascuna, «proprio» = `SELECT id, name, host_id, host FROM network_devices WHERE host_id = ? OR host = ? ORDER BY id LIMIT 1` → `{ network_device_id, nome, host_id: host_id ?? hostId, ip }`; (3) altrimenti, se `physical_device_id`, la stessa query di `apparatoDelCluster` (`hosts hh JOIN network_devices nd ON nd.host_id = hh.id WHERE hh.physical_device_id = ? ORDER BY nd.id LIMIT 1`). Senza righe `hosts` per quell'IP: `null` (un apparato su un IP mai scansionato resta ammesso, come oggi).
- `creaApparato`: dopo `safeParse`, prima di tutto il resto: `const gia = apparatoGiaPresente(getDb(), data.host); if (gia) return { ok: false, status: 409, error: messaggioIpDiApparato(gia.nome), codice: "IP_DI_APPARATO", apparato: gia };`
- `POST /api/devices`: sul 409 risponde `{ error, codice, apparato }` con status 409 (gli altri errori come oggi).
- `POST /api/devices/bulk`: nel ciclo, `const gia = apparatoGiaPresente(getDb(), host.ip); if (gia) { skipped.push({ host: host.ip, reason: messaggioIpDiApparato(gia.nome) }); continue; }` al posto di `if (getNetworkDeviceByHost(host.ip))` (che il caso «proprio» copre già).
- Docstring della prova con l'incidente: «21/10, hub: DA-RT-CORE (nd 318) creato su un IP secondario del router MK-RTR-CORE (nd 1)».

**Prova (vista rossa prima del codice)** `apparato-gia-presente.test.ts`, DB del tenant di prova come `crea-apparato.test.ts`: rete 1; host 1 `10.40.0.1` e host 2 `10.40.1.1` nello stesso `physical_devices` (id 5); `network_devices` id 1 `MK-RTR-CORE` con `host_id = 1`. Casi: IP `10.40.1.1` → `{ network_device_id: 1, nome: "MK-RTR-CORE", host_id: 1 }`; IP `10.40.0.1` → «proprio», stesso apparato; IP di un host senza cluster → `null`; due host con IP `10.40.2.2` in due reti, uno nel cluster → bloccato; cluster con due apparati (id 1 e 7) → id 1. In `crea-apparato.test.ts`: `creaApparato({ name: "DA-RT-CORE", host: "10.40.1.1", … })` → `status 409`, `codice "IP_DI_APPARATO"`, e **nessuna** riga nuova in `network_devices` (`SELECT COUNT(*)` uguale prima e dopo).

**Verifica** le due prove verdi (log nello scratchpad, `exit=0`); prima del codice la nuova di `crea-apparato` rossa (oggi crea l'apparato). Lint, tsc, build.

**Commit** `fix(apparati): «Rendi apparato» rifiutato su un IP che è già di un apparato (anche dal cluster fisico)` + rilascio.

### [ ] Task 2 — Blocco nella finestra «Rendi apparato»

**File**
- modifica `src/lib/fetch-json.ts` (variante d'errore: campo facoltativo `body?: unknown`, riempito alla riga 38)
- modifica `src/components/devices/rendi-apparato-tipi.ts` (stato di riga `bloccata`)
- modifica `src/components/devices/rendi-apparato-dialog.tsx` (caricamento righe 104-129, `rendiApparato` righe 466-498, corpo singolo)
- modifica `src/components/devices/rendi-apparato-tabella.tsx` (riga bloccata)

**Interfacce usate** dal Task 1 il corpo 409 `{ error, codice: "IP_DI_APPARATO", apparato }`; da `HostDetail` il campo che c'è già `apparato_cluster` (`src/types/index.ts:799`) e `network_device`.

**Cosa fare**
- All'apertura la finestra legge già `/api/hosts/<id>` per gli host incompleti (Discovery, rete): una riga il cui host ha `network_device` o `apparato_cluster` nasce **bloccata** con `{ nome, host_id }`.
- **Un host**: al posto dei tre blocchi, un riquadro con `Questo IP è già dell'apparato <nome>` e il link «Apri la scheda di <nome>» (`/objects/<host_id>`); nel piede solo «Chiudi». Nessuna ricerca di credenziale parte (oggi «Trova in automatico» potrebbe partire da sola: verificare e saltarla per le righe bloccate).
- **Più host**: la riga bloccata mostra il messaggio col link al posto dell'esito credenziale, è esclusa da `daCreare` e dalle ricerche; il piede dice «N bloccati: già di un apparato» accanto al resto.
- Il server resta l'arbitro: un 409 arrivato al momento della creazione (caso ambiguo, o apparato creato nel frattempo da un altro) mette la riga in `bloccata` leggendo `r.body.apparato`.
- Aspetto come l'artboard `Discovery` (parte A); se l'artboard non ha la finestra, si usa il `BadgeAvviso` di `rendi-apparato-esito.tsx` per il messaggio.

**Verifica** resa una volta sulla copia del DB dell'hub: router `/objects/227` (DA-RT-CORE) → un IP secondario del suo cluster da Discovery → «Rendi apparato» mostra il blocco con link; selezione di 3 host di cui uno secondario → una riga bloccata, due creabili. Screenshot 1920 nello scratchpad. Lint, tsc, build.

**Commit** `feat(apparati): la finestra «Rendi apparato» dice di chi è già l'IP, con il link` + rilascio.

---

## Parte B — un apparato, una riga in Discovery (leggero per l'interfaccia, misura sulla copia)

### [ ] Task 3 — Principale del cluster: colonna, regola pura, misura

**File**
- modifica `src/lib/db-tenant-schema.ts` (tabella `physical_devices`, riga 490: colonna nuova nello schema) e l'`ALTER TABLE` inline idempotente dove lo schema del tenant aggiunge le colonne mancanti (stesso file, regola 10 di `CLAUDE.md`), con segno `cluster_principale_v21` = `done:<data>:v1`
- crea `src/lib/devices/cluster-discovery.ts`, `src/lib/devices/__tests__/cluster-discovery.test.ts`
- modifica `src/lib/devices/physical-device-db.ts` (`unlinkHostFromPhysicalDevice`, riga 475: azzera `primary_host_id` se esce il principale)

**Interfacce prodotte**

```ts
// cluster-discovery.ts
export interface MembroCluster { host_id: number; ip: string; network_id: number; network_name: string; status: string; ha_apparato: boolean }
export interface InfoClusterDiscovery {
  physical_device_id: number;
  principale: boolean;
  principale_host_id: number;
  /** Solo sulla riga principale: gli altri IP, in ordine di IP. */
  altri: Array<Omit<MembroCluster, "ha_apparato">>;
}
/** Regola pura. null = il cluster non si accorpa (meno di 2 membri, o 2+ apparati: ambiguo). */
export function principaleDelCluster(membri: MembroCluster[], sceltoAMano: number | null): number | null;
/** Una query sola su tutti i cluster con 2+ host; mappa host_id → info. */
export function leggiClusterDiscovery(db: Database.Database): Map<number, InfoClusterDiscovery>;
```

**Cosa fare**
- Colonna: `physical_devices.primary_host_id INTEGER REFERENCES hosts(id) ON DELETE SET NULL` (nessun CHECK).
- `principaleDelCluster`: meno di 2 membri → `null`; membri con `ha_apparato` = 1 → quello; ≥2 → `null` (ambiguo: non si accorpa); 0 → `sceltoAMano` se è fra i membri, altrimenti l'IP numericamente più basso (stesso ripiego deterministico di `recomputeMultihomedLinks`, `db-tenant.ts` ~7740).
- `leggiClusterDiscovery`: `SELECT h.id, h.ip, h.network_id, n.name, h.status, h.physical_device_id, pd.primary_host_id, (SELECT 1 FROM network_devices nd WHERE nd.host_id = h.id LIMIT 1) AS ha_apparato FROM hosts h JOIN networks n ON n.id = h.network_id JOIN physical_devices pd ON pd.id = h.physical_device_id WHERE h.physical_device_id IN (SELECT physical_device_id FROM hosts WHERE physical_device_id IS NOT NULL GROUP BY physical_device_id HAVING COUNT(*) > 1)`; raggruppa in memoria, applica la regola, riempie la mappa (gli `altri` solo sulla principale). «Ha apparato» con lo stesso criterio di `apparatoDelCluster` (`nd.host_id`).
- **Misura sulla copia del DB dell'hub (prima di andare avanti)**, con uno script nello scratchpad (non nel repo) che apre la copia con import statico di `db-tenant`: (1) numero di cluster con 2+ host e quanti ambigui; (2) **l'elenco per nome** delle righe che Discovery nasconderebbe (IP, rete, nome, principale che le assorbe) — si legge, non solo il totale; (3) tempo di `leggiClusterDiscovery` (mediana di 5) e di `getAllHostsEnriched(10000)` sulla stessa copia; (4) `EXPLAIN QUERY PLAN` della query (deve usare `idx_hosts_physical_device_id`). Risultati nel Registro di questo piano. Se l'elenco contiene righe che non sono lo stesso apparato (cluster fatti male dall'identity-resolver) **ci si ferma e si porta l'elenco a Riccardo**.

**Prova (vista rossa)** `cluster-discovery.test.ts`: regola pura sui cinque casi (1 membro; apparato; due apparati; scelto a mano valido; scelto a mano fuori cluster → IP più basso, con `10.0.0.9` < `10.0.0.10` numericamente); `leggiClusterDiscovery` su DB di prova con un cluster di tre IP in due reti (righe `altri` giuste, solo sulla principale); scollegando il principale `primary_host_id` torna NULL. Migrazione: due aperture dello stesso DB → stessa colonna, segno scritto una volta.

**Verifica** prova verde; migrazione aperta due volte sulla copia dell'hub (colonna presente, `PRAGMA table_info(physical_devices)`, segno invariato alla seconda); misura nel Registro. Lint, tsc, build.

**Commit** `feat(cluster): principale del cluster fisico, regola e colonna per la scelta a mano` + rilascio.

### [ ] Task 4 — API di Discovery con il cluster

**File**
- modifica `src/app/api/hosts/discovery/route.ts` (righe 24-48)
- modifica il tipo `EnrichedHost` in `src/app/(dashboard)/discovery/page.tsx` (riga ~110: campo `cluster?: InfoClusterDiscovery | null`)

- modifica `src/lib/db-tenant.ts` (involucro `getClusterDiscovery()` accanto a `getAllMultihomedLinks`, riga ~4706)

**Interfacce usate** `leggiClusterDiscovery` (Task 3). Prodotta: `export function getClusterDiscovery(): Map<number, InfoClusterDiscovery> { return leggiClusterDiscovery(db()); }` in `db-tenant.ts` (stesso schema di `getHostById` con `apparatoDelCluster(db(), …)`), importata **staticamente** dalla rotta.

**Cosa fare** una chiamata a `getClusterDiscovery()` accanto a `getAllMultihomedLinks()`; ogni riga riceve `cluster: mappa.get(h.id) ?? null`, in `lite` e non. Niente altro cambia nella risposta (le altre pagine che la leggono ignorano il campo).

**Verifica (misura)** sulla copia dell'hub, con l'app in locale: tempo della GET `/api/hosts/discovery?lite=1` prima e dopo (mediana di 5, `curl -w '%{time_total}'` con la sessione), e byte della risposta. **Soglia:** +10 % o +50 ms al massimo, il più largo dei due; oltre, ci si ferma e si guarda il piano della query prima di cambiare altro. Numeri nel Registro. Lint, tsc, build.

**Commit** `feat(discovery): l'API dice a quale cluster fisico appartiene ogni IP e chi è il principale` + rilascio.

### [ ] Task 5 — Discovery: secondari nascosti, «+N IP», ricerca, contatori

**File**
- modifica `src/app/(dashboard)/discovery/page.tsx` (filtro righe 893-916, conteggi righe 1830-1849, cella IP — `case "ip"` del render delle celle, e le chip delle classificazioni che usano la stessa regola del filtro)
- crea `src/app/(dashboard)/discovery/cluster-ip.tsx` (badge + elenco)
- crea `src/app/(dashboard)/discovery/__tests__/filtro-cluster.test.ts` e il modulo puro `src/app/(dashboard)/discovery/filtro-cluster.ts`

**Interfacce prodotte**

```ts
// filtro-cluster.ts (puro)
export type VistaRiga = { visibile: false } | { visibile: true; trovataComeSecondario: string | null };
/** Regola unica per tabella, chip e contatori. */
export function vistaRiga(h: { id: number; network_id: number; cluster?: InfoClusterDiscovery | null }, filtro: { testo: string; reteId: string | null }, corrisponde: (testo: string) => boolean): VistaRiga;
```

**Cosa fare** (aspetto: artboard `Discovery`)
- **Nascosti:** una riga con `cluster.principale === false` non compare. **Eccezione decisa nel piano** (da confermare, vedi Dubbi): con il filtro «Rete» impostato, una riga secondaria di quella rete compare, con una nota «IP secondario di <ip principale>» nella cella IP — è la vista per rete, dove ogni IP resta nella sua subnet.
- **Badge «+N IP»** nella cella IP della principale (N = `altri.length`); clic → elenco a comparsa con IP, rete, stato (segno + parola) e link a `/objects/<host_id>` di ciascuno. Niente colonna nuova.
- **Ricerca:** il testo cercato si confronta anche con gli IP di `altri`; se la principale corrisponde solo per un secondario, la riga compare con la scritta «trovato come IP secondario <ip>» sotto l'IP.
- **Contatori** (testata, riga 1845), con questo significato, scritto anche nel `title` del contatore:
  - «**N apparati e host**» = righe mostrate dopo i filtri, **un cluster conta 1** (prima: un IP contava 1);
  - «di M» = tutte le righe dopo l'accorpamento, senza filtri;
  - «**· K IP accorpati**» (solo se K > 0) = IP secondari nascosti dentro le righe mostrate;
  - online / offline / sconosciuti = stato della **riga principale** (il secondario offline si vede nell'elenco «+N IP»);
  - le chip delle classificazioni contano con la stessa regola della tabella (già unica dal 19/10).
- Selezione e azioni in blocco agiscono sulle righe mostrate (quindi sul principale); la riga secondaria visibile con il filtro rete si seleziona come le altre.
- Ordinamento e paginazione: come oggi, sul risultato accorpato.

**Prova** `filtro-cluster.test.ts`: secondaria nascosta; secondaria visibile col filtro della sua rete; ricerca dell'IP secondario → principale con `trovataComeSecondario`; cluster ambiguo (`cluster` null) → tutte visibili; host senza cluster invariato.

**Verifica** prova verde; resa una volta sulla copia dell'hub a 1920 e 1440: riga di MK-RTR-CORE con «+N IP», ricerca di un suo IP secondario, filtro su una rete secondaria, contatori; confronto con l'artboard. Lint, tsc, build.

**Commit** `feat(discovery): una riga per apparato fisico, «+N IP» e ricerca anche sugli IP secondari` + rilascio.

### [ ] Task 6 — «Scegli come principale»

**File**
- crea `src/app/api/physical-devices/[id]/principale/route.ts` (PUT, `requireAdmin`)
- modifica `src/lib/devices/physical-device-db.ts` (funzione `scegliPrincipale`; `manualLinkHostsToPhysicalDevice` riga 362: parametro facoltativo `principale_host_id`)
- modifica `src/app/api/physical-devices/link/route.ts` (schema Zod: `principale_host_id` facoltativo)
- modifica `src/components/scheda/dettagli/rete.tsx` (righe 100-170: bottone per membro) e `src/components/devices/link-ips-dialog.tsx` (scelta del principale quando il cluster non ha apparati)
- modifica `src/lib/__tests__/api-auth-guards.test.ts` (`CONTRACT`) e, se la prova delle rotte lo chiede, `src/lib/permessi/rotte.ts`
- crea `src/lib/devices/__tests__/scegli-principale.test.ts`

**Interfacce prodotte**

```ts
export type EsitoScegliPrincipale = { ok: true } | { ok: false; status: 400 | 404 | 409; error: string };
/** 409 se il cluster ha un apparato: il principale è il suo IP e non si sceglie. 400 se l'host non è del cluster. */
export function scegliPrincipale(physicalDeviceId: number, hostId: number): EsitoScegliPrincipale;
```
`PUT /api/physical-devices/[id]/principale` corpo `{ host_id: number }` → 200 `{ ok: true }` o l'errore.

**Cosa fare** in «IP collegati allo stesso device fisico», per ogni membro che non è il principale: «Scegli come principale» (solo admin). Con un apparato nel cluster il bottone non c'è e la riga del principale dice «principale: IP dell'apparato». In «Collega altro IP», se il cluster risultante non ha apparati, una scelta a radio «principale» (predefinito: quello di oggi o l'IP più basso). Dopo la scelta `router.refresh()`.

**Prova** `scegli-principale.test.ts`: scelta valida scrive la colonna; host fuori cluster → 400; cluster con apparato → 409 e colonna invariata; collegamento con `principale_host_id` lo scrive.

**Verifica** prova verde; `rotte-censite` verde; resa una volta (cluster senza apparato della copia, scelta, Discovery mostra la nuova principale). Lint, tsc, build.

**Commit** `feat(cluster): «Scegli come principale» e scelta del principale quando si collegano gli IP` + rilascio.

---

## Parte C — matrice VLAN degli switch (completo)

### [ ] Task 7 — Lettore Q-BRIDGE con le uscite vere dell'hub

**File**
- crea `src/lib/devices/snmp-vlan.ts`, `src/lib/devices/__tests__/snmp-vlan.test.ts`
- crea `src/lib/devices/__tests__/fixtures/qbridge-static-48.json`, `qbridge-static-16xg.json`, `qbridge-current-promax.json` (anonime)
- crea `scripts/leggi-qbridge.ts` (lettura una tantum per le fixture)

**Interfacce prodotte**

```ts
export const OID_QBRIDGE = {
  staticName: "1.3.6.1.2.1.17.7.1.4.3.1.1", staticEgress: "1.3.6.1.2.1.17.7.1.4.3.1.2", staticUntagged: "1.3.6.1.2.1.17.7.1.4.3.1.4",
  currentEgress: "1.3.6.1.2.1.17.7.1.4.2.1.4", currentUntagged: "1.3.6.1.2.1.17.7.1.4.2.1.5",
  pvid: "1.3.6.1.2.1.17.7.1.4.5.1.1", basePortIfIndex: "1.3.6.1.2.1.17.1.4.1.2",
} as const;
/** PortList (bit più alto del primo ottetto = porta 1) → numeri di porta del bridge. */
export function portePortList(v: Buffer): number[];
export interface LetturaVlanSwitch {
  vlan: Array<{ vlan_id: number; nome: string | null }>;
  porte: Array<{ vlan_id: number; if_index: number; egress: boolean; untagged: boolean | null }>; // null = lo switch non dichiara gli untagged
  pvid: Array<{ if_index: number; pvid: number }>;
  tabella: "static" | "current" | "nessuna";
  mappa_porte: "base_port" | "ifindex";
  letture: number; riuscite: number; codice: string | null;
  esito: "letto" | "non_riuscito" | "non_so";
}
export async function leggiVlanSwitch(walk: LettoreSnmp): Promise<LetturaVlanSwitch>;
```

**Cosa fare**
- Sette walk in sola lettura (`OID_QBRIDGE`), ognuna nel suo `try`; contano `letture`/`riuscite`. Indice: Static* = `<oid>.<vid>`; Current* = `<oid>.<timeMark>.<vid>` (si prende **l'ultimo** componente come vid). Unione di static e current per egress e untagged; `tabella` = `static` se Static* ha righe, altrimenti `current`, altrimenti `nessuna`.
- Porte: bit → numero di porta del bridge → ifIndex con `dot1dBasePortIfIndex`; mappa vuota → `mappa_porte = "ifindex"` e il numero è già l'ifIndex (stessa regola di `snmp-port-schema.ts:177-178`). PVID: indice = porta del bridge, tradotto allo stesso modo.
- `untagged: null` quando nessuna delle due tabelle Untagged ha risposto con righe (ProMax).
- VLAN fuori 1-4094 scartate. Esiti: tempo scaduto o sessione caduta su una walk qualsiasi → `non_so` (codice di trasporto); tutte le walk in errore SNMP → `non_riuscito`; altrimenti `letto` (anche vuoto).
- **Fixture vere:** `scripts/leggi-qbridge.ts --tenant 70791 --device <id>` gira **sull'hub** (import statici come `scripts/leggi-uscite-mikrotik.ts`), usa `creaWalkSnmp` dell'apparato, fa le sette walk e scrive il JSON grezzo (oid → valore esadecimale) in `/root/qbridge-<id>.json` (permessi 600); a schermo solo conteggi. Si legge SW-CED-48POE-242, SW-CED-16XG-241, SW-ING-ProMax-239 (sono apparati di Domarc, non di un cliente; lettura una tantum, non l'automatismo). Copia nello scratchpad, anonimizzazione dei nomi VLAN, file sull'hub cancellato.

**Prova (vista rossa)** `snmp-vlan.test.ts`: `portePortList(Buffer.from([0x80, 0x01]))` → `[1, 16]`; fixture 48POE → 13 VLAN, `tabella "static"`, untagged dichiarati; 16XG → 13 VLAN; ProMax → `tabella "current"`, `mappa_porte "ifindex"`, `untagged null`; walk che scade → `non_so`.

**Verifica** prova verde (vista rossa prima del codice); fixture controllate a occhio (niente nomi veri). Lint, tsc, build.

**Commit** `feat(switch): lettore SNMP delle VLAN degli switch (Q-BRIDGE), con le uscite vere dell'hub` + rilascio.

### [ ] Task 8 — Tabelle `switch_vlan*` (migrazione additiva)

**File**
- modifica `src/lib/db-tenant-schema.ts` (costanti `DDL_SWITCH_VLAN_V1`, `SEGNO_SWITCH_VLAN = "switch_vlan_v21"`, `VERSIONE_SWITCH_VLAN = 1`)
- modifica `src/lib/db-tenant.ts` (`migrateSwitchVlan(db)` sul modello di `migrateSchedaMikrotik`, chiamata all'apertura in `getTenantDb`; `scriviVlanSwitch`, `leggiVlanSwitchDb`)
- crea `src/lib/__tests__/switch-vlan-migration.test.ts`, `src/lib/devices/__tests__/switch-vlan-db.test.ts`
- crea `docs/adr/0029-vlan-degli-switch-tabelle-e-lettura-spenta.md` (lo 0028 è prenotato dal piano dell'invio a DA-Vul-can)

**Interfacce prodotte**

```sql
CREATE TABLE switch_vlan (device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  vlan_id INTEGER NOT NULL, nome TEXT, PRIMARY KEY (device_id, vlan_id));
CREATE TABLE switch_vlan_porte (device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  vlan_id INTEGER NOT NULL, if_index INTEGER NOT NULL, egress INTEGER NOT NULL, untagged INTEGER,
  PRIMARY KEY (device_id, vlan_id, if_index));
CREATE TABLE switch_porta_pvid (device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  if_index INTEGER NOT NULL, pvid INTEGER NOT NULL, PRIMARY KEY (device_id, if_index));
CREATE TABLE switch_vlan_lettura (device_id INTEGER PRIMARY KEY REFERENCES network_devices(id) ON DELETE CASCADE,
  letto_il TEXT NOT NULL, tabella TEXT NOT NULL, mappa_porte TEXT NOT NULL, n_vlan INTEGER NOT NULL);
```

```ts
export function migrateSwitchVlan(db: Database.Database): string[];
/** Fotografia: DELETE + INSERT delle tre tabelle dell'apparato in UNA transazione. Solo con esito "letto". */
export function scriviVlanSwitch(deviceId: number, l: LetturaVlanSwitch, adesso: Date): void;
export interface VlanSwitchDb {
  vlan: Array<{ vlan_id: number; nome: string | null }>;
  porte: Array<{ vlan_id: number; if_index: number; egress: boolean; untagged: boolean | null }>;
  pvid: Array<{ if_index: number; pvid: number }>;
  lettura: { letto_il: string; tabella: "static" | "current" | "nessuna"; mappa_porte: "base_port" | "ifindex"; n_vlan: number } | null;
}
export function leggiVlanSwitchDb(deviceId: number): VlanSwitchDb;
```

**Cosa fare** tabelle create solo se mancano, in una transazione, riga nel journal `switch vlan, aggiunto <nomi>`, segno `done:<data>:v1` scritto una volta. `scriviVlanSwitch` rifiuta (lancia) un esito diverso da `letto`: la regola «non so non scrive» sta qui, non solo in chi chiama. L'ADR dice: perché tabelle proprie (la scheda le legge, la mappa no; `switch_ports.vlan` resta com'è), perché spenta, cosa diventa difficile (due fonti di VLAN per porta: `switch_ports.vlan` del giro ARP e `switch_porta_pvid`).

**Prova (vista rossa)** migrazione: DB vuoto → quattro tabelle e segno; seconda apertura → nessuna riga nuova nel journal, segno invariato; DB con una tabella già presente → aggiunge solo le altre. DB: scrittura due volte dello stesso apparato → seconda fotografia sostituisce la prima; `non_so` → eccezione e righe di prima intatte; cancellazione dell'apparato → righe via (CASCADE con `foreign_keys` acceso come nel resto dell'app).

**Verifica (completo)** prove verdi; **prova a vuoto** su una copia del DB dell'hub e su una copia del DB del cliente A (dal vault `~/Documents/da-appliance-credentials/`, copia nello scratchpad, mai nel repo): apertura due volte con l'app in locale, `sqlite3 -readonly` → quattro tabelle, segno, `PRAGMA integrity_check` = `ok`, nessuna altra tabella cambiata (`sqlite3 .schema` prima/dopo, `diff` solo con le quattro). Revisione del task (un revisore). Lint, tsc, build.

**Commit** `feat(switch): tabelle delle VLAN degli switch, migrazione additiva con segno switch_vlan_v21` + rilascio.

### [ ] Task 9 — Lettura `switch_vlan`, spenta di default

**File**
- modifica `src/lib/topology/letture/interruttori.ts` (`LETTURE` e `LETTURE_DISPONIBILI`: `"switch_vlan"`)
- modifica `src/lib/topology/letture/testi.ts` (`DESCRIZIONE_LETTURE.switch_vlan` e il `case` di riga ~91)
- modifica `src/lib/cron/jobs.ts` (funzione `letturaVlanSwitch` accanto a `letturaSnmp` riga 773; chiamata nel ramo switch di `runArpPoll`, accanto alla chiamata di `letturaSnmp`)
- modifica `src/app/api/devices/[id]/query/route.ts` (`runSwitchQuery`, dopo lo STP riga ~428)
- crea `src/lib/cron/__tests__/arp-letture-switch-vlan.test.ts` (modello: `arp-letture-mikrotik.test.ts`)
- modifica `src/lib/topology/letture/__tests__/interruttori.test.ts` e `testi.test.ts` se elencano le letture

**Interfacce usate** `leggiVlanSwitch` (Task 7), `scriviVlanSwitch` (Task 8), `conCadenza`, `scriviEsito`, `letturaAccesa`, `creaWalkSnmp(device, TEMPO_WALK_MS)`.

**Cosa fare**
- `letturaVlanSwitch(device, options)`: `conCadenza("switch_vlan", device.id, …)` (al più una volta l'ora); `leggiVlanSwitch(walk)`; `letto` → `scriviVlanSwitch`; `non_riuscito`/`non_so` → solo esito, nessuna scrittura; `conteggio: { comandi: letture, riusciti: riuscite, codice }`.
- In `runArpPoll`: per **ogni** apparato `device_type === "switch"` con credenziale SNMP (anche quelli del controller UniFi: la ProMax risponde via SNMP), escluso solo MikroTik via SSH (ha le sue letture), e **solo con `letturaAccesa("switch_vlan")`**. Interruttore guardato per primo: spenta, il giro fa esattamente quello di prima (nemmeno la ricerca della credenziale).
- In `runSwitchQuery` («Interroga»): stessa lettura **senza** cadenza, solo se accesa; riga nel progresso `✓ VLAN: N` o `VLAN non lette: <codice>`.
- Testi: titolo «VLAN degli switch via SNMP»; legge «Per ogni switch: le VLAN con il nome, le porte tagged e untagged di ognuna, il PVID di ogni porta.»; apparati «gli switch con credenziale SNMP, anche quelli del controller; non i MikroTik letti via SSH»; comandi «7 letture in sola lettura: Q-BRIDGE-MIB (dot1qVlanStatic, dot1qVlanCurrent, dot1qPvid) e BRIDGE-MIB (dot1dBasePortIfIndex)». Riga in «Dati della mappa → Letture in più», con `NASCE_SPENTA`.

**Prova (vista rossa)** spenta → nessuna walk (`creaWalkSnmp` finto mai chiamato); accesa → scrive le righe della fixture 48POE; seconda chiamata entro l'ora → saltata dalla cadenza; walk che scade → esito `non so`, righe di prima intatte; switch MikroTik via SSH → non letto.

**Verifica** prove verdi; sulla copia dell'hub in locale con la lettura **spenta**: un giro ARP manuale non cambia niente (`SELECT COUNT(*) FROM switch_vlan` = 0, journal senza walk Q-BRIDGE). Revisione del task. Lint, tsc, build.

**Commit** `feat(switch): lettura delle VLAN degli switch, spenta di default (ADR 0018)` + rilascio.

### [ ] Task 10 — Matrice VLAN condivisa (estratta dalla scheda MikroTik)

**File**
- crea `src/lib/scheda/matrice-vlan.ts` (tipi `CellaVlan`, `ColonnaVlan`, `StatoPortaMatrice`, `RigaMatrice`, `MatriceVlanBase`; `espandiVlanIds` spostata qui)
- modifica `src/lib/scheda/mikrotik.ts` (riesporta da `matrice-vlan.ts` ciò che ha spostato: nessun import esterno si rompe)
- crea `src/components/scheda/matrice-vlan.tsx` (`Cella`, `TabellaMatriceVlan`, `StatoPorta` spostato da `tipi/router/mikrotik/bridge.tsx` e lì riesportato)
- modifica `src/components/scheda/tipi/router/mikrotik/vlan.tsx` (usa `TabellaMatriceVlan`)

**Interfacce prodotte**

```ts
export type CellaVlan = "U" | "T" | null;
export interface ColonnaVlan { id: number | null; etichetta: string; nome: string | null }
export type StatoPortaMatrice = "attiva" | "inattiva" | "disabilitata";
export interface RigaMatrice { porta: string; stato: StatoPortaMatrice; pvid: number | null; nota: string | null; celle: CellaVlan[] }
export interface MatriceVlanBase { colonne: ColonnaVlan[]; righe: RigaMatrice[] }
```
```tsx
export function TabellaMatriceVlan(p: { m: MatriceVlanBase; prima?: string /* intestazione colonna porta, default «Interfaccia» */; avviso?: ReactNode }): JSX.Element;
```
`MatriceVlan` dei MikroTik diventa `MatriceVlanBase & { bridge: string; completa: boolean }` e la `nota` di riga porta `descriviBond(bond)`.

**Cosa fare** spostamento senza cambi di aspetto: stesse classi, nomi in verticale, U/T, legenda. Le prove esistenti di `matriceVlan`/`espandiVlanIds` restano dove sono e devono passare senza modifiche.

**Verifica** prove esistenti della scheda MikroTik verdi senza toccarle; resa di `/objects/227` tab VLAN sulla copia dell'hub **prima e dopo** (due screenshot 1920 nello scratchpad, identici a occhio). Revisione del task. Lint, tsc, build.

**Commit** `refactor(scheda): matrice VLAN condivisa, estratta dalla scheda MikroTik senza cambiarne l'aspetto` + rilascio.

### [ ] Task 11 — Tab VLAN dello switch: striscia e matrice

**File**
- crea `src/lib/scheda/vlan-switch.ts`, `src/lib/scheda/__tests__/vlan-switch.test.ts`
- crea `src/app/api/devices/[id]/vlan-switch/route.ts` (GET, `requireAuth`)
- riscrive `src/components/scheda/tipi/switch/vlan.tsx`
- modifica `src/lib/scheda/conteggi-tab.ts` (riga 42) e la GET di `/api/devices/[id]` (campo `switch_vlan_n`, una `COUNT(*)`)
- modifica `src/lib/__tests__/api-auth-guards.test.ts` (`CONTRACT`)

**Interfacce prodotte**

```ts
export interface MatriceVlanSwitch extends MatriceVlanBase {
  /** "completa": untagged dichiarati; "dedotta": solo egress, U dal PVID; "solo_pvid": lettura spenta o mai fatta, colonne dai PVID di switch_ports. */
  qualita: "completa" | "dedotta" | "solo_pvid";
  striscia: { vlan: number; trunk: number; access: number; senza_vlan: number };
}
export function matriceVlanSwitch(i: {
  porte: Array<{ port_index: number; port_name: string; status: string | null; vlan: number | null }>; // switch_ports
  db: VlanSwitchDb | null;
}): MatriceVlanSwitch;
```
`GET /api/devices/[id]/vlan-switch` → `{ matrice: MatriceVlanSwitch, lettura: { acceso: boolean; letto_il: string | null; tabella: string | null; esito: EsitoApparato | null } }`.

**Cosa fare**
- Righe = le porte di `switch_ports` (quelle della tab Porte, stesso ordine `port_index`), stato `up` → attiva, `down` → inattiva, `disabled` → disabilitata. Colonne = VLAN lette + PVID, ordinate per id, nome da `switch_vlan.nome` (assente → «·»).
- Cella: in untagged → U; in egress → T; PVID = quella VLAN → U implicita; vuota. Con `untagged` null (ProMax): egress e PVID = VLAN → U, egress e PVID ≠ VLAN → T, `qualita "dedotta"`.
- Senza dati (lettura spenta o mai fatta): colonne dai `switch_ports.vlan`, solo U implicite, `qualita "solo_pvid"` (il contenuto di oggi diventa la matrice parziale).
- Striscia (`StrisciaNumeri`, 4 caselle): **VLAN** = colonne; **trunk** = porte con almeno una T; **access** = porte con almeno una U e nessuna T; **senza VLAN** = porte senza celle.
- Sotto la matrice: la legenda condivisa; con `dedotta` la riga «Lo switch non dichiara le porte untagged: U dedotta dal PVID»; con `solo_pvid` «Tagged e nomi: serve la lettura «VLAN degli switch via SNMP», spenta|mai fatta. Qui solo le VLAN dei PVID.»; `RigaFonti` con l'ora dei dati (ora italiana) o il codice dell'esito.
- Aspetto: artboard `SwitchVlan`.
- Conteggio della tab: `switch_vlan_n` se > 0, altrimenti il conteggio di oggi.

**Prova (vista rossa)** `vlan-switch.test.ts` con le tre fixture passate da `leggiVlanSwitch` → `scriviVlanSwitch` → `leggiVlanSwitchDb` (DB di prova): 48POE `completa` con 13 colonne e i numeri della striscia calcolati a mano dalla fixture (scritti nella prova); ProMax `dedotta`; nessun dato → `solo_pvid` uguale alle VLAN distinte di oggi (`vlanDistinte`).

**Verifica** prova verde; `rotte-censite` verde; resa sulla copia dell'hub (dove nel Task 12 i dati ci saranno; qui con le righe scritte dalla prova a mano sulla copia, `scriviVlanSwitch` da script nello scratchpad) dei tre switch a 1920 e 1440; confronto con l'artboard. Revisione del task. Lint, tsc, build.

**Commit** `feat(switch): tab VLAN con la matrice porte × VLAN e la striscia trunk/access` + rilascio.

### [ ] Task 12 — Accensione sull'hub e verifica sul dato vero

**Chi:** la sessione principale (scrive un'impostazione nel DB dell'hub: **conferma di Riccardo prima**, come ogni modifica al DB dell'hub in `CLAUDE.md`).

**Cosa fare**
- Verificare che il codice sia arrivato (`/api/version` e `ActiveEnterTimestamp` del servizio, `CONTEXT.md` §3).
- Con l'ok: accendere «VLAN degli switch via SNMP» da «Dati della mappa → Letture in più» con l'utente admin (non da `sqlite3`), poi «Interroga» sui tre switch.
- `sqlite3 -readonly` sul DB del tenant dell'hub: `SELECT device_id, tabella, mappa_porte, n_vlan, letto_il FROM switch_vlan_lettura` → 242 e 241 `static` 13, 239 `current`/`ifindex`; esito in `topologia.lettura.switch_vlan.esito`.
- Pagina `/objects/<host>` dei tre switch, tab VLAN: confronto a campione di 3 porte per switch con l'interfaccia dello switch (o il controller UniFi per la ProMax).
- Dopo un'ora: il giro ARP ha riletto (nuovo `letto_il`), il tempo del giro switch nel journal (`durate.switch`) non è cresciuto oltre 10 s per switch.
- Cliente A: **resta spenta**; si accende solo se lo decide Riccardo.
- Chiusura: `CONTEXT.md` §6 (voce «Matrice VLAN degli switch» con le trappole: tabelle, interruttore, ProMax dedotta; voce B «Discovery accorpa per cluster fisico, principale in `physical_devices.primary_host_id`»; voce A «blocco in `apparatoGiaPresente`»), `CHANGELOG.md`, `docs/scheda-mappa.md`, `python3 ~/Progetti/genera_mappa.py`, sezione di `TASKS.md`.

**Verifica** le righe in `switch_vlan_lettura` e le tre pagine viste; Registro con data e fonte (hub, dal vivo).

**Commit** `docs: VLAN degli switch accese sull'hub, contesto e changelog` (solo `.md`, niente rilascio).

### [-] Task 13 — Completamento dal controller UniFi (fuori da questo giro)

Annullato in questo giro: la lista bianca di `unifi-api` (`isUnifiRequestAllowed`, `src/lib/integrations/unifi-api.ts:169`) non ammette `rest/networkconf`, e senza l'elenco delle reti gli id `native_networkconf_id` / reti tagged del `port_table` non diventano numeri di VLAN. Per farlo serve l'**ok di Riccardo** ad allargare la lista a `GET /api/s/<site>/rest/networkconf` (sola lettura, ma è il primo percorso `rest/` ammesso); poi: (1) prova che la lista ammetta solo quella GET (`unifi-api.test.ts`); (2) `port_table` di `stat/device` legge `native_networkconf_id`, `tagged_networkconf_ids`/`excluded_networkconf_ids` (verificare i nomi sul controller vero del cliente A, risposta salvata anonima); (3) completa `switch_vlan_porte` per gli switch del controller dove SNMP non dichiara gli untagged (la ProMax passa da `dedotta` a `completa`); (4) `unifi_sync` resta spento (`CONTEXT.md` §6). Riga aperta in `TASKS.md`.

---

## Dubbi da sciogliere con Riccardo (non bloccano l'avvio)

1. **Filtro «Rete» in Discovery:** il piano mostra la riga secondaria quando la rete filtrata è la sua (la vista per rete conserva ogni IP). Alternativa: resta nascosta e compare la principale con «trovato come IP secondario».
2. **Cluster dell'identity-resolver:** il resolver accorpa da solo gli IP delle interfacce degli apparati; dopo B quelle righe spariscono da Discovery. Il Task 3 porta l'elenco per nome prima di andare avanti.
3. **Colonna «MH» e dedup delle scansioni:** restano sui gruppi multihomed, il cui principale può differire da quello del cluster fisico. Proposta (non nel piano): far preferire a `recomputeMultihomedLinks` il `primary_host_id` per i gruppi fisici.
4. **Lettura VLAN anche sugli switch del controller UniFi** via SNMP (la ProMax risponde): il piano la fa, perché le tabelle sono della scheda e non toccano i vicini della mappa.

## Registro

- 2026-10-22 · Task 3 · misura sulla copia del DB dell'hub (tenant 70791, 350 host): 7 cluster con 2+ IP, 0 ambigui, 17 righe nascoste, tutti e 7 i principali portano un apparato. `leggiClusterDiscovery` 0,1 ms, `getAllHostsEnriched(10000)` 15,1 ms (mediana di 5); piano della query su `idx_hosts_physical_device_id`. Migrazione `cluster_principale_v21` su una copia: 1,7 ms, seconda 0,1 ms senza cambi, segno `done:2026-10-22:v1` invariato a due aperture di `getTenantDb`, `integrity_check` ok (28,9 s), riga del journal vista. Due cluster (10, 11, ancora serial_number, conf. 100) mescolano un MAC HPE e due di un altro OUI: probabilmente iLO + schede del server stesso, da confermare. Elenco per nome in `.superpowers/sdd/2026-10-22-accorpamento-ip-e-vlan-switch/righe-nascoste.md` (fuori dal repo pubblico: non si committa).

## Consuntivo
### Fatto
### Mancante
### Scostamenti dal piano
### Consigli di sviluppo

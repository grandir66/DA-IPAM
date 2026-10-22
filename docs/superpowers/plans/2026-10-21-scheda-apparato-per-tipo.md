# Scheda apparato per tipo — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea
> (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** la scheda `/objects/[id]` mostra tab e riquadri diversi per tipo di apparato, si legge senza scorrere e non ripete lo stesso dato in più punti.

**Architettura:** una funzione pura decide il tipo di scheda e le sue tab; la pagina diventa un regista che carica i dati come oggi e monta i componenti del tipo da `src/components/scheda/`. Mattoni comuni (intestazione, striscia dei numeri, riquadro, riga delle fonti) usati da tutti i tipi. Si lavora tipo per tipo: finché un tipo non è fatto, il suo contenuto di oggi resta in una tab «Dettagli» provvisoria, così niente sparisce fra un rilascio e l'altro.

**Spec:** la tavola grafica approvata https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv (artboard `Main`, `Gestione`, `Switch`, `Firewall`, `Nas`, `Hypervisor`, `Windows`, `Linux`, `AppServer`; `Oggi` è il censimento dei difetti). Le voci si rifiniscono con Riccardo dopo: dove la tavola e questo piano non bastano, si fa come la tavola e si annota in `TASKS.md`.

**Livello di controllo:** leggero per tutto (deciso da Riccardo il 21/10/2026).

## Vincoli globali

- Solo ramo `dev`; ogni task finisce con `npm run version:release` + `git push origin dev` (arriva anche all'appliance del cliente A: un push di codice è un rilascio, `CONTEXT.md` §3).
- Albero condiviso: mai `git add -A`; si mette in stage per file, dopo `git diff <file>`. `TASKS.md` può avere righe di altri lavori (es. collector QNAP): si mettono in stage solo le proprie.
- Colori e badge dello stile nuovo, non i pastello: `STILE_STATO` (`src/components/shared/stile-stato-modulo.ts`), `BadgeEsito`/`BadgeAvviso`/`BadgeNeutro` (`src/components/devices/rendi-apparato-esito.tsx`), `BadgeAMano` (`credenziali-assegnate.tsx`). Stato sempre con segno + parola (✓ ▲ ✕ ●); testo minimo 13 px; nessuna etichetta a 10 px nei componenti nuovi.
- Riquadro senza dati = non si rende. Una fonte assente si dice una volta nella riga delle fonti, mai con card di «—».
- Panoramica: entra in 1440×900 senza scorrere la pagina. Liste in Panoramica al massimo 8 righe con «tutte (N) ›» che porta alla tab.
- Le tab: prima quelle del tipo, poi un separatore, poi `Sicurezza · Gestione · Storico` (comuni a tutti).
- Niente raccolta di dati nuovi in questo piano: i riquadri tratteggiati «dato da raccogliere» della tavola (VPN, regole firewall in elenco, database SQL, siti web, inode/LVM, NTP/AppArmor) **non si costruiscono**; arrivano con i blocchi B2/B4/B5 del piano `2026-10-21-recupero-dadude3-mknet.md` o con un piano a parte.
- API nuove: solo GET di lettura, con `requireAuth`, censite in `src/lib/permessi/rotte.ts` (verifica `scripts/verifica-permessi.sh`); import statico di `db-tenant` (ADR 0002).
- `useUrlPerBrowser()` per ogni link verso servizi dell'appliance (LibreNMS, Wazuh, MeshCentral).
- Si guarda resa una volta per task, a 1440, in locale su una copia del DB dell'hub (`sqlite3 .backup`, utente con riga in `user_tenant_access`; `CONTEXT.md` §6 «Interfaccia»). Esempi veri sull'hub (tenant 70791): switch id 7 `SW-CED-48POE-242`, router id 1 `MK-RTR-CORE`, hypervisor id 2 `DA-PX-01`, DC id 14 `DA-DC01`, SQL id 17 `DA-SQL12`, Linux id 20 `da-wazuh`. Storage: sull'hub non c'è; si usa l'appliance DTS se ha un NAS, altrimenti un fixture.

## Casi da non dimenticare

1. Host senza apparato (solo Discovery): tipo `host`, tab `Panoramica · Sicurezza · Storico`, «Rendi apparato» in intestazione — T2.
2. Apparato con `device_type = 'switch'` ma classificazione `server` o vendor windows/linux/qnap/stormshield (righe vecchie, prima che lo schema ammettesse `server`): il tipo di scheda viene dalla classificazione, non da `device_type` — T1 (funzione e conversione).
3. Classificazione personalizzata del tenant o non mappata: tipo `generico`, mai errore — T1.
4. Server con ruolo DC ma senza integrazione AD: la tab «Active Directory» non compare — T7.
5. `/devices/[id]` di un apparato senza host (creato a mano) resta la vecchia scheda: non si tocca, ma nessun contenuto deve vivere solo lì — T8 lo verifica.

## Task 1 — Tipo di scheda e conversione di `device_type`

**File**
- crea `src/lib/scheda/tipo-scheda.ts`, `src/lib/scheda/__tests__/tipo-scheda.test.ts`
- crea `src/lib/devices/migra-device-type-v21.ts` (sullo stampo di `src/lib/classification/migrazione-v21.ts`: stesso meccanismo del segno, stesso punto d'avvio) + prova
- modifica `src/app/api/devices/[id]/route.ts:67-73` perché le scelte (MAC solo per switch, Proxmox per hypervisor) usino `tipoScheda`, non `device_type`

**Interfacce prodotte**
```ts
export type TipoScheda =
  | "switch" | "router" | "firewall" | "storage" | "hypervisor"
  | "server_windows" | "server_linux" | "generico" | "host";
export type TabId =
  | "panoramica" | "porte" | "vlan" | "vicini" | "interfacce" | "routing" | "dhcp"
  | "configurazione" | "dischi" | "volumi" | "servizi_nas" | "vm" | "nodi" | "storage_px"
  | "rete_px" | "sistema" | "servizi" | "aggiornamenti" | "software" | "utenti" | "ad"
  | "dipendenze" | "dettagli" | "sicurezza" | "gestione" | "storico";
export function tipoScheda(i: {
  gestito: boolean; classification: string | null; device_type: string | null;
  vendor: string | null; scan_target: string | null;
}): TipoScheda;
export function tabDelTipo(t: TipoScheda, o: { ruoli: string[]; haAd: boolean; haDipendenze: boolean }): TabId[];
export const TAB_COMUNI: TabId[]; // ["sicurezza", "gestione", "storico"]
```

**Cosa fare**
- `tipoScheda`: `gestito=false` → `host`. Poi classificazione canonica (passare da `canonico.ts`): switch → `switch`; router, load_balancer, vpn_gateway → `router`; firewall → `firewall`; nas → `storage`; hypervisor, oppure server con `scan_target` proxmox/vmware → `hypervisor`; server/vm → `server_windows` se vendor o `scan_target` è windows, `server_linux` se linux; altrimenti `generico`. Solo se la classificazione manca si guarda `device_type` con le stesse regole di ripiego di `db-tenant.ts:6338-6352` (switch + vendor windows/linux = server, qnap/synology = storage, stormshield = firewall).
- `tabDelTipo`: le liste della tabella «Quali tab per quale tipo» dell'artboard `Main`; finché il task del tipo non è fatto, il tipo ha `["panoramica", "dettagli"]` + comuni. Ogni task di tipo (T3-T7) cambia la sua riga e la sua prova.
- Conversione una tantum: per le righe di `network_devices` con `device_type = 'switch'` e classificazione diversa da switch, ricalcolare con `resolveDeviceTypeForCreate` (`device-product-profiles.ts:232`). Prima scrive nel log l'elenco **per nome** (id, nome, da → a), poi aggiorna; segno `device_type_v21` come per `classificazioni_v21`. Non tocca `classification`.

**Verifica**
- prove (viste rosse prima): DA-DC01 (`device_type switch`, classificazione server, vendor windows) → `server_windows`; da-wazuh → `server_linux`; SNS EVA2 (stormshield) → `firewall`; switch ubiquiti → `switch`; classificazione `pippo_custom` → `generico`; host non gestito → `host`; conversione: riga server/switch diventa `server`, riga switch/switch resta.
- `npm test` mirato sui due file, `npx tsc --noEmit`, lint.
- Sull'hub dopo il rilascio: `SELECT id,name,device_type,classification FROM network_devices` nel DB del tenant 70791, nessun server rimasto `switch`; riga del segno presente.

**Commit** `feat(scheda): tipo di scheda dalla classificazione e device_type corretto sulle righe vecchie`

## Task 2 — Mattoni comuni, scheletro e tab comuni

**File**
- crea in `src/components/scheda/`: `intestazione-scheda.tsx`, `striscia-numeri.tsx`, `riquadro.tsx`, `riga-fonti.tsx`, `barra-uso.tsx`, `tab-scheda.tsx`, `tab-gestione.tsx`, `tab-sicurezza.tsx`, `tab-storico.tsx`, `panoramica-generica.tsx`, `tab-dettagli.tsx`
- modifica `src/app/(dashboard)/objects/[id]/page.tsx` (oggi ~2900 righe): resta caricamento dati + regia; i blocchi di oggi si spostano nei componenti, non si riscrivono

**Interfacce prodotte**
```ts
// striscia-numeri.tsx
export type Casella = { etichetta: string; valore: string; sotto?: string; attenzione?: boolean; tab?: TabId };
export function StrisciaNumeri(p: { caselle: Casella[]; onApriTab: (t: TabId) => void }): JSX.Element; // max 6
// riquadro.tsx
export function Riquadro(p: { titolo: string; azione?: ReactNode; children: ReactNode; vuoto?: boolean }): JSX.Element | null; // vuoto → null
// riga-fonti.tsx
export type Fonte = { nome: string; esito: "ok" | "assente" | "non_abbinato"; quando?: string };
export function RigaFonti(p: { fonti: Fonte[] }): JSX.Element;
// barra-uso.tsx
export function BarraUso(p: { percento: number; etichetta?: string; soglia?: number /* default 85 */ }): JSX.Element; // ≥ soglia: rosso scuro + ▲ nel testo
// intestazione-scheda.tsx
export function IntestazioneScheda(p: { host: …; device: … | null; tipo: TipoScheda; ruoli: string[]; azioni: ReactNode }): JSX.Element;
```

**Cosa fare** (artboard `Main` e `Gestione`)
- Intestazione in una riga: ‹, nome, IP mono, badge tipo pieno navy, badge ruoli (bordo navy, fondo bianco), stato online con ms, «marca · modello · firmware» (o «VM n su <nodo>» se c'è l'abbinamento Proxmox), **un** badge credenziale (✓ provata / ▲ senza credenziale provata), a destra Aggiorna, Prova credenziali, menu ⋯ (Modifica, Crea asset NIS2, togli). Host non gestito: «Rendi apparato» al posto di Aggiorna/Prova.
- Tab Gestione, tre colonne: «Cos'è» (`ClassificazioneApparato`, **unico editor**: si toglie la Select classificazione di Generale che scriveva solo su `hosts`; «Perché?» apre `ClassificationEvidencePanel`), «Identità e inventario» (MAC, hostname/DNS, modello, seriale, firmware, n. inventario, note: unico posto di questi campi), «Come ci arrivo» + `CredenzialiAssegnate` (i badge `host_credentials` e `DeviceCredentialsTable` confluiscono qui), «Asset NIS2», «Collegamenti esterni» (LibreNMS, Zabbix con `zabbix_abbinamenti`, MeshCentral).
- Tab Sicurezza: `HostVulnerabilitiesCard` + `HostWazuhCard` (oggi usata solo in Discovery).
- Tab Storico: il contenuto di oggi (disponibilità, Discovery, scansioni) + `IpPrecedenti`.
- `PanoramicaGenerica` per `host` e `generico`: stato, porte aperte (una volta sola), rete (subnet, VLAN, porta switch), hardware se c'è.
- `TabDettagli`: le tab di oggi Generale/Sistema/Network/Software così come sono, per i tipi non ancora fatti. Si toglie da un tipo quando il suo task è chiuso.
- Uptime, porte aperte e credenziali compaiono una volta sola (righe «Lo stesso dato in più punti» dell'artboard `Oggi`).

**Verifica** lint, tsc, `npm test` sui file toccati; pagina resa a 1440 per DA-DC01 (con «Dettagli»), un host non gestito, un `generico`. Clic su ogni tab senza errori in console.

**Commit** `feat(scheda): scheletro comune, tab Gestione/Sicurezza/Storico, un dato in un posto`

## Task 3 — Switch

**File** crea `src/components/scheda/tipi/switch/{panoramica,porte,pannello-frontale,vlan,vicini}.tsx`; modifica `tipo-scheda.ts` (riga switch) e prova.

**Cosa fare** (artboard `Switch`)
- Tab: `panoramica · porte · vlan · vicini`.
- Striscia: porte su/totale (+ uplink), PoE erogato (somma `poe_power_mw`), porte con errori (attenzione se > 0), VLAN (elenco distinte), vicini, acceso da.
- Pannello frontale: porte numerate a due file (dispari sopra), SFP a parte; su = scuro pieno, giù = bianco bordo grigio, trunk = scuro con bordo spesso ciano, errori = rosso scuro con ✕, PoE = pallino giallo bordato; legenda sotto. Clic → riquadro dettaglio porta.
- «Porte da guardare» con filtri a chip (Da guardare / Trunk / PoE / Tutte): colonne Porta, Stato, Velocità+duplex, VLAN, PoE, STP, Cosa c'è attaccato (host linkato a `/objects/<id>`), Perché. Il «da guardare» = errori, half duplex, velocità sotto 1G su porta che ha visto 1G, > 5 MAC su porta non trunk.
- Tab Porte: la tabella completa portata da `devices/[id]/page.tsx:2222` (9 colonne), link corretti a `/objects/` (non `/hosts/`, non `/devices/`).
- Tab VLAN: VLAN distinte da `switch_ports.vlan` con numero di porte. Tab Vicini e MAC: vicini LLDP/CDP + MAC table + «Neighbor per trunk» (`devices/[id]/page.tsx:2578`) + STP.
- Campi assenti (es. ProCurve senza duplex/PoE): colonna nascosta se vuota per tutte le porte.

**Verifica** prova unitaria del calcolo «da guardare» (errori, half, 14 MAC, trunk escluso); resa a 1440 di SW-CED-48POE-242.

**Commit** `feat(scheda): switch con pannello frontale, porte da guardare, VLAN e vicini`

## Task 4 — Router e firewall

**File** crea `src/app/api/devices/[id]/interfacce/route.ts` (GET), `src/components/scheda/tipi/router/{panoramica,interfacce,routing,dhcp,configurazione}.tsx`; modifica `rotte.ts`, `tipo-scheda.ts`.

**Interfacce prodotte**
```ts
// GET /api/devices/[id]/interfacce → 200
type Interfaccia = { ifname: string; alias: string | null; stato: "up" | "down" | "unknown";
  velocita_mbps: number | null; tipo: string | null; mac: string | null;
  indirizzi: { ip: string; prefisso: number | null; famiglia: 4 | 6 }[] };
{ interfacce: Interfaccia[]; fonte: "device_interfaces"; aggiornato: string | null }
```
Lettura: `network_devices.physical_device_id` → `device_interfaces` + `device_interface_addresses` (funzioni in `lib/devices/physical-device-db.ts`). Apparato senza `physical_device_id` → `{ interfacce: [] , aggiornato: null }` e la scheda lo dice nella riga delle fonti (non è «nessuna interfaccia»).

**Cosa fare** (artboard `Firewall`)
- Tab: `panoramica · interfacce · routing · dhcp · configurazione` (router e firewall uguali).
- Striscia: uscite internet (rotte default attive/totali), interfacce su/totali, regole filter·NAT·mangle (dai conteggi MikroTik in `device_info`, oggi solo in `/devices`), pool DHCP più pieno (attenzione ≥ 85%), rotte, CPU · acceso da.
- Panoramica: interfacce (max 8, prima WAN e su), DHCP con `BarraUso` per pool (pool da `/api/devices/[id]/mikrotik`), instradamento (rotte default + statiche, max 5).
- Configurazione: conteggi regole, «Scarica export» solo per admin. **Guardia**: la GET `/api/devices/[id]/mikrotik?action=config` oggi non chiama `requireAdmin` (`TASKS.md`, piano DADude3 B1): se B1 non l'ha già fatta, la si aggiunge qui con la sua prova (utente non admin → 403).
- Tab Routing e ARP, DHCP: tabelle di oggi spostate, con lease importabili (`import-dhcp`, già admin).

**Verifica** prova della rotta (apparato con interfacce, senza `physical_device_id`, utente non autenticato 401); prova della guardia export; `verifica-permessi.sh`; resa a 1440 di MK-RTR-CORE.

**Commit** `feat(scheda): router e firewall con interfacce, DHCP e configurazione`

## Task 5 — Storage e NAS

**File** crea `src/components/scheda/tipi/storage/{panoramica,dischi,volumi,servizi}.tsx`; modifica `tipo-scheda.ts`.

**Cosa fare** (artboard `Nas`)
- Tab: `panoramica · dischi · volumi · servizi_nas`.
- Striscia: spazio usato (totale pool), dischi ✓/▲ (SMART), RAID (livello + stato), volumi, temperatura, acceso da.
- Alloggiamenti: un riquadro per disco nell'ordine dello slot; buono scuro pieno, attenzione giallo bordo spesso con ▲ e motivo, vuoto tratteggiato. Clic → dettaglio disco (modello, seriale, SMART, riallocati, ore).
- Volumi e pool con `BarraUso`; tab Volumi aggiunge `volume_io` e `qts5_pool_rows` (oggi solo in `/devices`). Tab Servizi: servizi di `nas_inventory`, anteprime SSH.
- Fonte dati: `device_info.nas_inventory` come oggi (`objects/[id]/page.tsx:1483`, `devices/[id]/page.tsx`).

**Verifica** resa a 1440 di un NAS vero (DTS o altra appliance in sola lettura) oppure, se non c'è, di un fixture con la forma vera di `nas_inventory` (preso da un `device_info` reale, anonimizzato); annotare quale in `TASKS.md`.

**Commit** `feat(scheda): storage con alloggiamenti, volumi e servizi`

## Task 6 — Hypervisor

**File** crea `src/components/scheda/tipi/hypervisor/{panoramica,vm,nodi,storage,rete}.tsx`; modifica `tipo-scheda.ts`.

**Cosa fare** (artboard `Hypervisor`)
- Tab: `panoramica · vm · nodi · storage_px · rete_px`.
- Striscia: nodi online/totali (+ quorum se c'è), VM+CT accese/totali, CPU e RAM del cluster, storage peggiore (attenzione ≥ 85%, nome + nodo), abbonamento.
- Nodi: una riga per nodo (stato, CPU e RAM con `BarraUso` stretta, n. VM, versione PVE); il nodo della scheda segnato «questo», gli altri linkati alla loro scheda. Tab Nodi: le card di oggi (`px-host`, `objects/[id]/page.tsx:2146`) ma in griglia a due colonne.
- VM e container: chip Accese/Spente/Senza agente/Tutte, ricerca per nome/IP/VLAN; colonne VMID, Nome, Nodo, Stato, CPU·RAM, Disco, IP·VLAN, In IPAM. «In IPAM» usa `/api/devices/[id]/proxmox-match` (oggi non usata dalla scheda): link alla scheda dell'host, oppure «non trovata». Lo scorrimento sta solo dentro la tabella della tab VM, la pagina no.
- Nelle schede di server che sono VM: in intestazione «VM n su <nodo>» con link (stesso abbinamento, verso il nodo).

**Verifica** resa a 1440 di DA-PX-01 e di DA-DC01 (riga «VM su»).

**Commit** `feat(scheda): hypervisor con nodi, VM abbinate agli host e storage`

## Task 7 — Server Windows, Linux e ruoli

**File** crea `src/components/scheda/tipi/server/{panoramica-windows,panoramica-linux,sistema,servizi,aggiornamenti,utenti,active-directory,dipendenze}.tsx`; crea `src/app/api/hosts/[id]/dipendenze/route.ts` e `src/app/api/hosts/[id]/ad/route.ts` (GET); modifica `rotte.ts`, `tipo-scheda.ts`.

**Interfacce prodotte**
```ts
// GET /api/hosts/[id]/dipendenze → { servizi: { id: number; nome: string; criticita: string | null; tipo: "primario"|"secondario"|"supporto" }[] }
//   host → inventory_assets (asset dell'host) → service_asset_dependencies → services
// GET /api/hosts/[id]/ad → { computer: { ou: string; os: string|null; ultimo_logon: string|null; abilitato: boolean } | null;
//                            rilievi: { gravita: string; titolo: string }[] | null }  // rilievi solo se il server è DC
```

**Cosa fare** (artboard `Windows`, `Linux`, `AppServer`)
- Windows — tab: `panoramica · sistema · servizi · aggiornamenti · software · utenti` + `ad` se ruolo DC **e** l'integrazione AD ha dati + `dipendenze` se ce ne sono. Striscia: aggiornamenti mancanti (attenzione > 0), disco peggiore, CPU·RAM, protezione (antivirus + profili firewall), AD (rilievi, solo DC), acceso da.
- Linux — tab: `panoramica · sistema · servizi · aggiornamenti (pacchetti) · utenti` (+ `dipendenze`). Striscia: carico·CPU, RAM, filesystem peggiore, pacchetti da aggiornare (se il dato c'è), servizi falliti, acceso da.
- Servizi: in cima i servizi del ruolo (DC: NTDS, DNS, DHCPServer, Netlogon, KDC; SQL: MSSQL*, SQLSERVERAGENT; Linux: quelli in ascolto su una porta), poi solo gli automatici fermi/falliti; tab con tutti. Linux: porta + processo insieme («In ascolto»).
- Aggiornamenti: Windows hotfix + link a `/patch-management/device/[hostId]`; Linux pacchetti se presenti.
- Utenti: collegati, ultimo accesso, profili (`user_profiles`, `last_logged_on_user`, `key_software`: oggi solo in `/devices`).
- Ruoli dal campo `server_roles`: badge in intestazione. Le tab di ruolo «Database/Siti/Posta/Backup» della tavola `AppServer` **non** si fanno (dato da raccogliere); resta la tab `dipendenze`.
- Il contenuto di oggi «Sicurezza e licenza», «Storage, servizi e utenti», «Processi e schedulazioni» si distribuisce in queste tab; niente si perde.

**Verifica** prove delle due rotte (con dati, senza asset, host non DC → `rilievi: null`, 401); resa a 1440 di DA-DC01, DA-SQL12, da-wazuh.

**Commit** `feat(scheda): server Windows e Linux con servizi, aggiornamenti, utenti, AD e dipendenze`

## Task 8 — Chiusura

- Togliere `TabDettagli` e la tab `dettagli` se nessun tipo la usa più; i tipi `generico` e `host` restano con `PanoramicaGenerica`.
- Verificare che nulla viva solo in `/devices/[id]`: per ogni blocco elencato nell'artboard `Oggi` («perso») una riga in `TASKS.md` con dove si trova ora.
- Testi superati: «Aggiungi a dispositivi da Discovery» (`objects/[id]/page.tsx:2673`, `:2773`) via; bug di precedenza `px._total_vm_rows ?? … > 0` (`:2142`) sistemato se il codice è ancora lì.
- `CHANGELOG.md` (il perché), `CONTEXT.md` §6 «Interfaccia» (dove sta la scheda per tipo, `tipoScheda` unico punto), `docs/scheda-mappa.md`, `TASKS.md` spuntato.
- Verifica sull'hub che la versione sia arrivata (`/api/version` + riga d'avvio nel journal) e una pagina per tipo aperta sull'hub.

**Commit** `docs(scheda): chiusura della scheda per tipo` + release + push.

## Fuori da questo piano

Raccolta di VPN, regole firewall in elenco, database SQL, siti web, posta, backup, inode/LVM, NTP/AppArmor, archivio delle configurazioni: blocchi B2/B4/B5 del piano `2026-10-21-recupero-dadude3-mknet.md` o piani nuovi. Quando arrivano, si aggiunge il riquadro nella tab del tipo già pronta.

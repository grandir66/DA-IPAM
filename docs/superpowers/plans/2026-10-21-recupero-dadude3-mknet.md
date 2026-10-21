# Recupero da DADude3 e DA-MKNET — piano

**Data:** 2026-10-21 · **Stato:** proposta, da approvare (niente codice prima dell'ok)
**Fonti:** canvas Cursor `progetti-fermi-DADude3-DA-MKNET-MKHA.canvas.tsx` (analisi del 20/10, 50 schede:
M1-M5, D1-D4, E01-E41) · donatori `~/Progetti/DADude3` (`569b416`) e `~/Progetti/DA-MKNET` (`812b1ad`),
invariati dal 20/10 · DA-IPAM `dev` a `e718248f` · ADR 0016, 0017, 0018, 0021 · spec
`2026-10-14-topologia-collegamenti-reali-design.md`, `2026-10-15-credenziali-promozione-wizard-design.md`.
**Checklist:** `TASKS.md`, sezione «2026-10-21 — recupero da DADude3 e DA-MKNET».

Le prove del 20/10 sono metodi isolati su fixture sintetiche: non sono collaudi sugli apparati. Una
proprietà in un tipo, una dipendenza installata o una voce nel README non contano come funzione.

## 0. Confini (validi per ogni task)

- DA-IPAM conserva identità degli apparati, credenziali, trasporti (`ssh-helper`, `ssh-transport`,
  `winrm-run`, `apriSessioneSnmp`), scheduler, discovery e persistenza. Dai donatori si prendono **parser
  e conoscenza dei dispositivi**; niente runtime Python nuovo, niente agent, niente moduli condivisi.
- Parser **puri** (testo → tipo), separati da trasporto e persistenza; ogni risultato porta fonte, ora di
  raccolta, unità e stato (`ok` | `parziale` | `assente` | `negato` | `errore`).
- Errore o raccolta parziale **non cancellano** il dato precedente; un campo non letto è `undefined`
  (resta com'era), un campo letto e vuoto è `null` (contratto già usato da `FattoPortaIn`).
- Comandi nuovi sugli apparati = automatismo nuovo → dietro interruttore **spento** (ADR 0018). Parsare
  meglio un'uscita che si legge già non è un comando nuovo.
- Nessuna scrittura sugli apparati, nessun lookup esterno con dati dei clienti, nessuna regola di
  dominio cambiata senza prova e decisione.
- Il repo è **pubblico**: le fixture sono uscite vere anonimizzate (MAC, IP, nomi, seriali sostituiti;
  riuso di `topology/anonimizza.ts` dove si applica), mai uscite grezze dei clienti.
- Schermate: tavola grafica degli oggetti prima di scriverle (una per tutto il lavoro, vedi B0).

## 1. Cosa è cambiato rispetto all'analisi del 20/10

Verifica fatta oggi sul codice di `dev`. Sei fatti cambiano priorità o forma dei task:

1. **MAC virtuali: due elenchi diversi.** `devices/physical-device-db.ts:21-25` riconosce VRRP v4/v6,
   HSRP v1, HSRPv2 (`00:00:0c:9f:f`) e HSRP IPv6 (`00:05:73:a0`); `topology/identity.ts:9`, che governa
   l'indice dei nodi della mappa, solo VRRP e HSRP v1, e normalizza i trattini ma non la forma a punti
   Cisco. Il delta di E06 è «un elenco solo», più GLBP.
2. **Firmware QNAP: l'SSH sovrascrive l'SNMP.** Il profilo SNMP QNAP legge il firmware
   (`scanner/snmp-vendor-profiles.ts:458`, OID `…24681.1.2.2.0`), poi `getDeviceInfo`
   (`devices/device-info.ts`, ramo `hasSsh`) fa `{ ...result, ...sshInfo }` e `sshInfo.firmware` è
   `uname -rsm` (`nas-acquisition.ts:610`), o `null`. D1 è quindi una correzione di dato, non solo un
   arricchimento.
3. **Gli HP letti via SSH non scrivono vicini.** `getHp*LldpNeighbors` è chiamato solo da
   `switch-client.ts:493,524` → `mergeLldpIntoPorts` → `switch_ports.trunk_neighbor_*`. Nessun
   `upsertNeighbors`: la topologia degli HP arriva oggi solo dalla lettura SNMP (`cron/jobs.ts:722`).
   M1 si divide: parser subito (B1), scrittura dei vicini come lettura nuova dietro interruttore (B3).
4. **ProCurve: `speed` contiene il tipo fisico.** `hp-vendor.ts:169` scrive `type` («100/1000T») in
   `speed`; la velocità negoziata sta nella colonna Mode. Nessuna prova esiste sui lettori HP.
5. **`upsertSwitchPorts` riscrive la riga intera** (`db-tenant.ts:5082`, DELETE + INSERT; la guardia
   `portInfos.length > 0` in `cron/jobs.ts` protegge solo dall'elenco vuoto). Quando VLAN o PoE
   arriveranno da comandi separati, una sotto-lettura fallita scriverebbe `null` sopra il valore buono.
6. **L'export MikroTik è leggibile da ogni utente con sessione.** La GET di
   `app/api/devices/[id]/mikrotik/route.ts` (azioni `config` e `all`, usata da
   `devices/[id]/page.tsx:684`) non chiama `requireAuth` né `requireAdmin`: la protegge solo il proxy.
   L'export completo di un router (su RouterOS 6 anche segreti PPP e chiavi Wi-Fi) va riservato
   all'admin. Zona rossa (autenticazione): decisione D2.

Altri fatti utili: `DA-MKNET/backend/database.sqlite` è vuoto (0 byte), quindi nei cloni non c'è storico
da importare (E31); in `DA-MKNET/OLDSCRIPT/info_complete_6100.py` ci sono anche `parse_aruba_poe_brief`
(:153) e `parse_aruba_vlan_tagged` (:229), oltre ai due parser citati da E01; DA-IPAM non ha un sottotipo
Aruba CX (`switch-client.ts:558`: tutto ciò che non è `comware` passa dal parser ProCurve).

## 2. Classificazione delle 50 schede

Tipo di lavoro: **A** = codice TypeScript del donatore direttamente adattabile · **R** = logica da
riscrivere (Python, o donatore difettoso) · **N** = sviluppo nuovo nel modello di DA-IPAM · **—** =
nessun porting (solo fixture o casi di prova).

| ID | Tema | 20/10 | 21/10 | Tipo | Blocco | Verifica di oggi |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | LLDP HP/Comware | Adattare | Adattare, diviso | A | B1 parser, B3 scrittura | Confermato; in più: oggi nessun vicino HP via SSH arriva al DB (fatto 3) |
| M2 | Porte HP: VLAN, duplex, PoE, route | Adattare | Adattare | A | B2 | Confermato: `vlan/duplex/poe_*` null; ProCurve `speed` = tipo fisico (fatto 4) |
| M3 | STP per porta e LAG HP → T3 | Adattare | Adattare | A + N | B3 | Confermato: `stp_state` null; `FattoPortaIn` pronto; serve una lettura nuova in `LETTURE` |
| M4 | Storico configurazioni | Adattare | Sviluppo nuovo | N (+A per HP) | B5 | Nessun archivio esiste; export MikroTik solo a richiesta e senza guardia admin (fatto 6) |
| D1 | Firmware QNAP | Adattare | Correggere + adattare | R | B1 | Peggio del previsto: l'`uname` cancella il firmware SNMP (fatto 2) |
| D2 | ZFS QuTS hero | Adattare | Condizionato | R | B6 | Confermato; solo se ci sono QuTS hero in esercizio (D8) |
| D3 | Share e pacchetti NAS | Adattare | Adattare | R | B6 | Confermato: anteprime troncate con `head -35` / `head -25` |
| D4 | Configurazioni host Proxmox | Condizionato | Condizionato | N | dopo B5 | Invariato; solo dopo l'archivio di M4 |
| M5 | Vicini da completare | Adattare | Adattare, dopo il wizard | N | B3 | `da-sistemare.ts` esiste; va dopo le tappe 3-5 (TASKS 5c) |
| E01 | Aruba 6100 interface brief | Adattare | Condizionato | R | B2 | Manca il sottotipo Aruba CX; servono un 6100 vero e la fixture (D3) |
| E02 | VLAN chassis modulari HP | Adattare | Adattare | R | B2 | Confermato; una versione canonica dei quattro OLDSCRIPT |
| E03 | MikroTik velocità/duplex | Adattare | Adattare | A | B2 | Confermato: `getPortSchema() { return []; }`; si usa `tabellaMonitor` di DA-IPAM, non lo split del donatore |
| E04 | MikroTik PoE | Adattare | Riscrivere il mapping | R | B2 | Confermato; il donatore mette 48V in `poePower` |
| E05 | MikroTik VLAN bridge | Adattare | Riscrivere il parser | R | B2 | Confermato; il donatore ignora `vlan-ids` |
| E06 | MAC virtuali | Adattare | Unificare | — + N | B1 | Due elenchi diversi (fatto 1) |
| E07 | Hyper-V | Adattare | Adattare | R | B4 | Confermato: nessuna lettura `root/virtualization/v2` |
| E08 | Defender e profili firewall | Adattare | Adattare | R | B4 | Confermato: solo `SecurityCenter2`, che sui Server manca |
| E09 | Ruoli server nel ripiego DCOM | Adattare | Adattare | R | B4 | Confermato: `wmi-run.ts:40` li dichiara mancanti |
| E10 | Batteria / aggiornamenti SCCM | Condizionato | Condizionato | R | — | Batterie già da GLPI; SCCM solo se c'è un uso (D8) |
| E11 | Software Windows | Già coperto | Già coperto | — | — | `probes/software-windows.ts` usa il registro e vieta `Win32_Product` |
| E12 | Storage Linux (LVM, inode, mount) | Adattare | Adattare | R | B4 | Confermato: solo `df` e `lsblk -d` |
| E13 | Docker | Condizionato | Condizionato | R | — | Nessun consumatore del dato oggi (D8) |
| E14 | Dettagli Linux (NTP, fuso, SELinux) | Adattare | Adattare, ridotto | R | B4 | Firewall e cron già presenti; restano fuso/NTP e SELinux/AppArmor |
| E15 | Libreria OID per prodotto | Adattare | Solo confronto | — | a richiesta | OID nuovi solo con decoder e fixture, quando un'area li chiede |
| E16 | LLDP/CDP via SNMP | Già coperto | Già coperto | — | — | `snmp-topologia.ts` e fatti T3 |
| E17 | Sonde Cisco/HP/Ubiquiti/Linux | Già coperto | Già coperto | — | — | Solo fixture di formati mancanti |
| E18 | Inventario Proxmox | Già coperto | Già coperto | — | — | `proxmox/run-proxmox-device-scan.ts` |
| E19 | Normalizzazione OS | Adattare | Solo casi di prova | — | — | Nessun task la tocca; se un task normalizza versioni, entrano i casi RouterOS 7.20.3 ed EdgeOS |
| E20 | Tassonomie e prefissi modello | Adattare | Solo regole puntuali | — | a richiesta | Il motore a evidenze resta; regole nuove una per una con controesempio |
| E21 | DNS | Già coperto | Già coperto | — | — | `scanner/dns.ts` |
| E22 | Porte e protocolli | Già coperto | Già coperto | — | — | nmap/naabu/profili |
| E23 | Credenziali e cifratura | Già coperto | Già coperto | — | — | archivio unico (ADR 0017) |
| E24 | Pianificazione | Già coperto | Già coperto | — | — | `cron/scheduler.ts`, `last_run` a fine giro |
| E25 | Coda persistente | Condizionato | Condizionato | N | — | Nessun requisito oggi; il difetto «inviato ma solo in RAM» resta requisito di regressione |
| E26 | WebSocket hub | Escludere | Escludere | — | — | |
| E27 | PKI agent | Escludere | Escludere | — | — | |
| E28 | Ciclo degli eventi | Già coperto | Già coperto | — | — | `analytics/anomaly-db.ts`; B5 vi scriverà «configurazione cambiata» se D6 lo chiede |
| E29 | Webhook multi-destinazione | Condizionato | Condizionato | N | — | |
| E30 | Pulizia e fusioni automatiche | Escludere | Escludere | — | — | |
| E31 | Import dello storico | Condizionato | Condizionato | N | — | Nei cloni nulla da importare; dipende da un DADude3 in esercizio (D8) |
| E32 | Procedura prima di una modifica | Condizionato | Fuori iniziativa | — | — | Scrive sugli apparati: fuori dalla raccolta |
| E33 | Interazioni di dettaglio MKNET | Adattare | Solo criteri | — | B0 tavola | Criteri per M5, niente JSX |
| E34 | Contratti, completezza, provenienza | Adattare | Trasversale | N | tutti | Si applica come contratto (§0), riusando `EsitoGiro` |
| E35 | Updater e installer | Escludere | Escludere | — | — | |
| E36 | The Dude | Condizionato | Condizionato | N | — | Solo se un The Dude in esercizio ha dati non acquisiti (D8) |
| E37 | Sottosezioni d'inventario | Adattare | Trasversale | — | tutti | Regola: prima nel JSON, colonna solo con un consumatore |
| E38 | Questionario DATIA | Condizionato | Condizionato | — | — | Fuori, salvo decisione (D8) |
| E39 | Comandi via AI | Escludere | Escludere | — | — | |
| E40 | SFP ottici, «real-time» | Escludere | Escludere | — | — | Nessun campo SFP senza lettore vero |
| E41 | Lookup MAC esterno | Escludere | Escludere | — | — | |

Conteggio (50): **17 da lavorare** (M1-M5, D1, D3, E02-E09, E12, E14), **3 condizionati con task
pronto** (D2, D4, E01), **7 condizionati senza task** (E10, E13, E25, E29, E31, E36, E38), **1 fuori
dall'iniziativa** (E32), **6 solo come fixture o regole puntuali** (E15, E19, E20, E33, E34, E37), **9 già
coperti**, **7 esclusi**.

## 3. Ordine e priorità

L'ordine proposto nel prompt regge, con due spostamenti motivati dal codice:

- la **scrittura** dei vicini HP passa da B1 a B3: non è un delta piccolo (fatto 3), serve una lettura
  nuova dietro interruttore, e cambia ciò che vede il modello per cavo;
- la **guardia admin sull'export MikroTik** sale in B1 (fatto 6): è piccola, riduce un'esposizione
  presente oggi, e B5 la presuppone.

| Blocco | Contenuto | Valore | Rischio | Dipende da | Controllo |
| --- | --- | --- | --- | --- | --- |
| B0 | Fixture anonimizzate e tavola grafica | Rende provabili gli altri | Basso | apparati disponibili (D3) | Leggero |
| B1 | E06, D1, M1 parser, guardia export | Alto: dati sbagliati oggi | Basso-medio (E06 tocca l'identità) | B0 per D1 e M1 | **Completo** per E06 e guardia export; leggero per D1 e M1 |
| B2 | Porte HP e MikroTik (M2, E02, E03-E05, E01) | Alto: campi oggi vuoti | Medio: scrittore condiviso `upsertSwitchPorts` | B1 (nomi HP), B0 | **Completo** per T2.2 (scrittore); leggero per i parser |
| B3 | Topologia HP (M1 scrittura, M3) e vicini da completare (M5) | Medio-alto | Medio-alto: attribuzione topologica | B1, B2, tappe 3-5 per M5 | **Completo** |
| B4 | Hyper-V, Windows, Linux (E07-E09, E12, E14) | Medio | Basso: blocchi additivi nel JSON | tavola grafica | Leggero |
| B5 | Storico configurazioni (M4), poi D4 | Alto | Alto: archivio nuovo, segreti, cifratura, retention | guardia export (B1) | **Completo** |
| B6 | NAS avanzato (D3, D2) | Medio-basso | Basso | D1, NAS veri | Leggero |

Stima complessiva, revisioni e correzioni comprese: **circa 30-40 ore di lavoro agente** (B1 ~5, B2 ~9,
B3 ~8, B4 ~6, B5 ~9, B6 ~3), più la raccolta delle fixture, che dipende dagli apparati disponibili.
Si ricalcola se cresce lo scope.

## 4. Task

Ogni task: prova vista fallire → codice → prove mirate → lint e tsc → commit su `dev` (con
`version:release` quando cambia codice). Percorsi di DA-IPAM relativi a `src/lib/` salvo indicazione.

### B0 — Preparazione

**T0.1 Fixture.** Raccolta in sola lettura dei comandi elencati in §5 sugli apparati scelti (D3),
anonimizzazione, deposito in `devices/__tests__/fixtures/<prodotto>/<comando>.txt` con un `LEGGIMI.md`
(modello, firmware, data, cosa è stato sostituito). Prova: una verifica automatica che nessuna fixture
contenga MAC/IP non di documentazione (192.0.2.0/24, 198.51.100.0/24, MAC `02:00:00:…`).
Fatto quando: ogni task di B1-B2 ha la sua fixture, o il task è marcato «senza fixture vera».

**T0.2 Tavola grafica.** Una tavola sola, oggetti numerati, per: riga dell'interruttore «Letture in più
delle porte» e «HP» in «Dati della mappa»; colonne/valori nuovi della vista porte (VLAN, duplex, PoE con
unità e fonte); riquadri Hyper-V, Defender/firewall, storage Linux nella scheda dell'apparato; storico
configurazioni (elenco versioni, confronto, «Salva ora»); vista «Vicini da completare». Si approva prima
di B2-T2.3.

### B1 — Delta piccoli

**T1.1 MAC virtuali: un elenco solo (E06).** Controllo completo.
- Donatore: `DA-MKNET/backend/src/vendors/mac-vendor.service.ts:113` (`virtualMacPrefixes`), solo i
  prefissi unicast di protocollo: VRRP v4/v6, HSRP v1, HSRPv2, GLBP `00:07:b4:00`; da DA-IPAM HSRP IPv6.
  I multicast (`01:00:5e`, `33:33`, `01:80:c2`, `01:00:0c`) sono un'altra categoria: funzione a parte
  (bit di gruppo), non mescolata.
- Destinatari: nuovo `devices/mac-virtuali.ts` (puro: `normalizzaMac` colon/trattini/punti/nudo,
  `eMacVirtuale`, `eMacMulticast`); `topology/identity.ts:9` e `devices/physical-device-db.ts:21` lo
  importano invece degli elenchi propri.
- Prove (vista rossa prima): `00:00:0c:9f:f0:01`, `0000.0c9f.f001`, `00-07-B4-00-01-02` virtuali; un MAC
  fisico no; tutti i candidati virtuali → nessuna identità (niente «primo MAC» alla `findBestMac`); le
  separazioni manuali vincono (`identity.test.ts`, prove di `node-index`).
- Misura: su copia del DB dell'hub e del cliente A, quanti MAC in `hosts`, `device_neighbors.remote_mac`,
  `topology_device_macs` cadono nei prefissi nuovi, e `misura-unioni` prima/dopo. Ogni differenza
  spiegata per nome prima del commit.
- Fatto quando: un elenco solo nel codice, misura scritta nel commit.

**T1.2 Firmware QNAP (D1).** Controllo leggero.
- Donatore: `DADude3/dadude-agent/app/probes/ssh_vendors/qnap.py:193` `_get_qts_version` (`getsysinfo
  firmver`, `/etc/version`, `/etc/default_config/WEBAPP.build`, `getsysinfo build`), `:176` piattaforma.
  Riscrittura in TS.
- Destinatari: nuovo `devices/nas/qnap-versione.ts` (`parseQnapVersion({firmver, version, build})`);
  letture aggiunte nel blocco `exec` di `nas-acquisition.ts:568`; `firmware` = versione QTS/QuTS o
  `null`, mai l'`uname`; `kernel_version` resta l'`uname`; `nas_inventory.ssh.qnap_build` e
  `qnap_product_version` in `device-info.ts:128`.
- Correzione di precedenza in `getDeviceInfo`: un `firmware` nullo dall'SSH non sostituisce quello
  SNMP. Ristretta al firmware (non si cambia lo spread generale senza misura).
- Prove: fixture QTS 5.x, QuTS h5.x, build assente, comandi assenti, solo `uname`; prova che un firmware
  SNMP sopravvive a un SSH senza firmware (vista rossa sul codice di oggi).
- Collaudo: un QNAP vero via «Acquisisci», firmware uguale a quello dell'interfaccia del NAS.

**T1.3 Parser LLDP HP e nomi delle porte (M1, prima metà).** Controllo leggero.
- Donatori: `DA-MKNET/backend/src/vendors/vendors.service.ts:792` `getHPComwareLLDPNeighbors`
  (normalizzazione, Port description, capabilities, PVID, LAG, MTU), `:470` `getHPProCurveLLDPNeighbors`
  (formato tabellare e dettagliato). Estratti senza `@Injectable`, Repository, Logger, lookup ARP.
- Destinatari: `devices/hp/nomi-porta.ts` (`normalizeHpInterfaceName`: GE, XGE, FGE, M-GE, BAGG; il nome
  grezzo si conserva); `devices/hp/lldp.ts` con `parseHpComwareLldp` e `parseHpProcurveLldp` puri,
  spostati da `hp-vendor.ts:87,271`, che resta facciata. `LldpNeighbor` (`hp-vendor.ts:22`) cresce in modo
  additivo: `portDescription`, `capabilities`, `pvid`, `lagId`.
- Nessuna persistenza nuova: `mergeLldpIntoPorts` (`switch-client.ts:542`) invariato.
- Da non cambiare senza decisione: `hp-vendor.ts:294` riempie `chassisId` col MAC del Port ID quando il
  chassis manca. Resta, ma il parser dice da dove viene (`chassisDaPortId: true`).
- Prove (prime prove HP del repo): FortyGigE1/0/41 → FGE1/0/41; due vicini sulla stessa porta; annuncio
  senza IP; MAC non di telaio; tabellare con `|`.

**T1.4 Export MikroTik solo admin.** Controllo completo (autenticazione). Solo con D2 = sì.
- Destinatario: `app/api/devices/[id]/mikrotik/route.ts`, GET: `requireAdmin()` per `config` e `all`,
  `requireAuth()` per le altre azioni; voce in `permessi/rotte.ts` se serve.
- Prove: utente non admin → 403 su `config`; admin → 200; `scripts/verifica-permessi.sh` verde;
  `rotte-censite.test.ts` verde. La scheda apparato (`devices/[id]/page.tsx:684`) chiede `all`: verifica
  resa con utente non admin (la sezione MikroTik deve dire perché è vuota).

### B2 — Porte

**T2.1 HP: duplex, VLAN, modo dalle uscite già lette (M2).** Controllo leggero, nessun comando nuovo.
- Donatori: `vendors.service.ts:2046` `getHPComwarePortDetails` (righe bridge e route-mode), `:1568`
  `getHPProCurvePortDetails` (parte `show interface brief`).
- Destinatari: `devices/hp/interface-brief.ts` (puro), facciata `hp-vendor.ts:147,313`. Comware:
  `XGE1/0/1 UP 10G(a) F(a) T 20` → duplex `full`, PVID 20, modo trunk. Le righe route-mode si leggono con
  `modo: "route"` e **non** entrano in `switch_ports` (non sono porte di commutazione). ProCurve: velocità
  e duplex dalla colonna Mode (`1000FDx` → `1000`, `full`), il tipo fisico non è più la velocità.
  `port_index` resta la posizione (non è un ifIndex), identità per nome.
- Misura: su copia del DB, quali etichette di velocità cambiano nella mappa (`topology/known-ports.ts`).
- Prove: modulare A1, uscita con `|`, porte ADM, VLAN 1-4094, uscita troncata, potenza 0.

**T2.2 Scrittura delle porte per campo.** Controllo completo (scrittore condiviso con UniFi e SNMP).
- Destinatario: `upsertSwitchPorts` in `db-tenant.ts:5047` e facciata `db.ts:5110`. Un campo
  `undefined` in tutte le righe del giro = «non letto»: si conserva il valore della riga precedente con lo
  stesso `port_name`; `null` = letto e vuoto. Una porta assente da una lettura **completa** sparisce.
- Prove: VLAN non letta → resta la vecchia; porta sparita → tolta; percorsi UniFi e SNMP invariati
  (prove esistenti più una per ciascuno).
- Prerequisito di T2.3, T2.5-T2.7.

**T2.3 HP: PoE e VLAN da comandi in più, dietro interruttore spento.** Controllo leggero.
- Interruttore nuovo «Letture in più delle porte» (`tenant_settings`, forma di
  `topology/letture/interruttori.ts`), spento; riga in «Dati della mappa» secondo la tavola.
- ProCurve: `show power-over-ethernet brief`, `show vlans ports <porte> detail` o
  `show vlans ports all detail`; Comware: `display poe interface`, `display port vlan` (da confermare sulle
  fixture). Donatori: `vendors.service.ts:1568` (PoE, `show name`, running-config) ed E02
  `DA-MKNET/OLDSCRIPT/info_complete_FULL.py:291` `parse_vlan_ports_all_detail_modular` (versione
  canonica, varianti `info_complete_WEB.py:291`, `info_complete.py:289` solo per le prove). Riscrittura
  di `expandPortRange` (`vendors.service.ts:2487`): i Trk restano aggregati, `A1-B3` ambiguo si rifiuta.
- Dati: VLAN non etichettata → `switch_ports.vlan`; potenza in W → `poe_power_mw` con conversione
  esplicita; VLAN etichettate secondo D4.
- Prove: potenza 0 valida, misura assente ≠ 0, Trk3-Trk4, A1/B3, nomi VLAN con spazi, comando assente
  (non cancella il noto, via T2.2).

**T2.4 Aruba CX / 6100 (E01).** Solo con D3 = c'è un 6100. Controllo leggero.
- Donatori: `OLDSCRIPT/info_complete_6100.py:95` `parse_aruba_interface_brief`, `:187`
  `parse_aruba_lldp_detail`, `:153` `parse_aruba_poe_brief`, `:229` `parse_aruba_vlan_tagged`.
- Destinatari: sottotipo `arubacx` riconosciuto da `device-product-profiles.ts` e smistato in
  `switch-client.ts:558`; parser in `devices/hp/arubacx.ts`. Stato `parziale` esplicito per righe saltate.

**T2.5 MikroTik: velocità e duplex (E03).** Dietro lo stesso interruttore di T2.3. Controllo leggero.
- Comandi: `/interface ethernet print terse without-paging`, `/interface ethernet monitor [find] once`.
- Donatori: `DA-MKNET/backend/src/mikrotik/mikrotik.service.ts:1946` `enrichInterfacesWithEthernet`
  (selezione e join), `:2135` `parseMonitorOutput` solo come riferimento: si usa `tabellaMonitor`
  (`devices/mikrotik-stp.ts:131`), che conserva le colonne vuote.
- Destinatario: `createMikrotikSwitchClient` (`switch-client.ts:434`, oggi `getPortSchema` → `[]`), più un
  modulo puro `devices/mikrotik-ethernet.ts`. `rate` → velocità corrente, `advertise` resta capacità.
  Contatori fuori dalla prima tappa (nessun consumatore).
- Prove: colonne vuote, porta down, porta rinominata, 1G e 40G sulla stessa tabella.
- Misura: righe nuove in `switch_ports` per i MikroTik e loro effetto sulla mappa (copia del DB).

**T2.6 MikroTik PoE (E04).** Dietro lo stesso interruttore. Mapping riscritto.
- Comandi: `/interface ethernet poe print terse`, `/interface ethernet poe monitor [find] once`.
- Donatore: `mikrotik.service.ts:1862` `enrichInterfacesWithPoe` (selezione e associazione), mapping
  delle unità riscritto: `poe-out-power` (W) → `poe_power_mw`; tensione e corrente separate nel JSON della
  porta; nessuna potenza calcolata senza dirlo.
- Prova di regressione: «48V» non diventa mai potenza; `auto-on` senza carico ≠ spento.

**T2.7 MikroTik VLAN del bridge (E05).** Dietro lo stesso interruttore. Parser riscritto.
- Comando: `/interface bridge vlan print terse without-paging`; PVID dalle porte del bridge già lette
  (`parsePorteBridge`, `mikrotik-stp.ts:108`).
- Donatori: `mikrotik.service.ts:1738` `enrichInterfacesWithVlan` (solo l'idea dell'insieme VLAN per
  porta), `:1609` `getBridgePortsViaSSH` come riferimento.
- Prova di regressione: `bridge=br vlan-ids=20 tagged=ether1` arricchisce `ether1`; elenchi e intervalli
  (`10,20-25`); porta CPU del bridge; `tagged` configurato ≠ `current-tagged`.

### B3 — Topologia

**T3.1 Lettura «HP» dei vicini (M1, seconda metà).** Controllo completo.
- `LETTURE` in `topology/letture/interruttori.ts` cresce con `"hp"` (spenta), con testi, rotta PUT, riga
  in «Dati della mappa», cadenza oraria (`cadenza.ts`, `conCadenza`).
- La lettura usa i parser di T1.3 e scrive `upsertNeighbors(id, vicini, "ssh")`, come il ramo switch dei
  MikroTik (`cron/jobs.ts:713`): la fonte `ssh` la legge solo il modello per cavo, T1 resta bit per bit
  (`NEIGHBORS_MODEL_SOURCES_SQL`). Capacità annunciate nella codifica di `topology/lettori/fonti.ts`.
- Prove: lettura spenta = parità di T1 (`misura-cavi`); lettura fallita = nessuna scrittura né potatura;
  nessuna unione per `systemName` uguale.

**T3.2 STP per porta e LAG degli HP (M3).** Dentro la lettura «hp». Controllo completo.
- Comandi: Comware `display stp brief`, `display link-aggregation summary`; ProCurve `show spanning-tree`
  (sezione porte), `show trunks`.
- Donatori: `vendors.service.ts:2190` (`display stp brief`), `:1895` (STP ProCurve e trunk). Simboli
  nuovi: `parseHpComwareStpBrief`, `parseHpProcurveStpPorts`, `hpTopologyFacts`.
- Destinatario: `scriviFattiTopologia(id, "device", …)` (`db-tenant.ts:5364`), solo istanza 0/CIST
  (`topology_port_facts` non ha l'istanza nella chiave). `ALTN DISCARDING` → `alternate`/`discarding`;
  BAGG/Trk → `if_kind = "lag"`, membri con `lag_group`.
- Prove: porta up e discarding; LAG con due membri; lettura interrotta; due istanze MST non si
  sovrascrivono (si scrive solo la 0).

**T3.3 Vicini da completare (M5).** Dopo le tappe 3-5 (TASKS 5c) e la tavola. Controllo completo.
- Donatori: `DA-MKNET/backend/src/topology/topology.service.ts:341` `getUnmanagedNeighbors` (forma:
  problema, azioni, `seenFromCount`), `:563` `convertNeighborToDevice` (solo la sequenza dei controlli).
  Non si portano `deepLookup`, `autoDiscoverNetwork`, il MAC → un IP di `arp-resolution.service.ts:56`.
- Destinatari: `discovery/vicini-da-completare.ts` (`classifyNeighborIssue`, `buildNeighborCandidates`,
  query in blocco senza N+1); azione verso `devices/proposta-apparato.ts:262`; credenziali da
  `credentials/resolve.ts` con backoff. Motivi: senza IP, IP ambiguo, nessuna credenziale compatibile,
  accesso fallito, acquisizione fallita, già acquisito.
- Prove: stesso MAC su più IP, proxy ARP, omonimi in sedi diverse, annuncio vecchio, credenziale in
  backoff, scelte manuali che vincono; le 19 colonne di Discovery restano nell'ordine di Riccardo.

### B4 — Sistemi

**T4.1 Hyper-V via WinRM (E07).** Controllo leggero.
- Donatori: `DADude3/dadude-agent/app/probes/wmi_vendors/hyperv.py:58` `_get_vms`, `:94`
  `_get_virtual_switches`, `:112` `_get_hyperv_storage` (query e mappa degli stati), riscritti.
- Destinatari: script WinRM in `devices/device-info.ts` (blocco ~1310-1320): CIM
  `root/virtualization/v2` (`Msvm_ComputerSystem` delle VM con `Name` = GUID, `ElementName`,
  `EnabledState`; `Msvm_VirtualEthernetSwitch`); mapping in `mapWindowsRawToDeviceInfo` verso un blocco
  `hyperv_inventory` con stato `assente` | `negato` | `ok`, ora di raccolta. Niente ripiego DCOM in prima
  tappa, niente passaggio dal collector Proxmox.
- Prove: host senza ruolo, namespace negato, VM spente e in transizione, due VM con lo stesso nome (GUID
  diversi), nessun `Win32_Product` nello script. Collaudo su un host di laboratorio (D3).

**T4.2 Defender e profili firewall (E08).** Controllo leggero.
- Donatore: `DADude3/.../wmi_vendors/windows_server.py:453` `_get_security_info`, senza i suoi riassunti
  (`enabled` dalla sola presenza, `any(Enabled)`).
- Destinatari: stesso script: `MSFT_MpComputerStatus` (`root/Microsoft/Windows/Defender`) →
  `AntivirusEnabled`, `RealTimeProtectionEnabled`, età delle firme; `MSFT_NetFirewallProfile`
  (`root/StandardCimv2`) → stato per Domain/Private/Public. Stato per namespace.
- Prove: SecurityCenter assente, Defender installato e spento, profilo Domain attivo e Public spento,
  accesso negato; nessun «protetto» dalla sola connessione.

**T4.3 Ruoli server nel ripiego DCOM (E09).** Controllo leggero.
- Donatore: `windows_server.py:372` `_get_server_roles`.
- Destinatari: `devices/wmi-bridge.py` (query `Win32_ServerFeature WHERE ParentID=0`), `wmi-run.ts:40`
  (togliere `server_roles` dalle mancanze), mapping già esistente (`device-info.ts:1125`).
- Prove: client Windows, server con ruoli, permesso negato; con WinRM attivo nessun doppione.

**T4.4 Storage Linux (E12).** Controllo leggero.
- Donatori: `DADude3/.../ssh_vendors/linux.py:432` `_get_detailed_storage` e
  `ssh_advanced_scanner.py:419` come repertorio dei comandi; parser riscritti su uscite macchina.
- Comandi: `lsblk -J -b -o NAME,TYPE,SIZE,FSTYPE,MOUNTPOINT,PKNAME`, `df -P -i`, `lvs`/`vgs` con
  `--reportformat json --units b --nosuffix` senza sudo (permesso negato = stato `negato`).
- Destinatario: `getDeviceInfoFromLinux` (`device-info.ts:595`), blocco `linux_storage` (PV → VG → LV
  dove letto, inode per mount). Nessuna somma fra disco, LV e filesystem.
- Prove: LVM assente, thin, inode al 100%, mount multipli, nessun `du`.

**T4.5 Fuso, NTP, SELinux/AppArmor (E14).** Controllo leggero.
- Donatore: `linux.py:794` `_get_system_details` (repertorio).
- Comandi: `timedatectl show -p Timezone -p NTPSynchronized`, `getenforce`,
  `cat /sys/module/apparmor/parameters/enabled`. Stato `disabled` ≠ comando negato ≠ assente.

### B5 — Storico configurazioni

**T5.1 Schema e archivio.** Controllo completo.
- `db-tenant-schema.ts`: `device_config_attempts(id, device_id, started_at, finished_at, status,
  error_code, snapshot_id)`, `device_config_snapshots(id, device_id, captured_at, format,
  product_profile, firmware, raw_sha256, comparable_sha256, encrypted_path, size_bytes)`, additive e
  idempotenti. File cifrati con la chiave dell'app (`crypto.ts`, da leggere con ADR 0013-0014 prima di
  scegliere), percorsi da ID e hash sotto la cartella dati, mai dal nome remoto. Retention secondo D6;
  l'ultima versione valida non si tocca mai.
- Prove: stesso contenuto = stesso file, due tentativi; export vuoto, comando negato, uscita troncata →
  tentativo fallito, ultima valida intatta; file corrotto → errore visibile.

**T5.2 Lettori e confronto.** Controllo completo.
- Donatori: `DADude3/dadude-server/app/services/device_backup_service.py:66` e `:332` (flusso e storico),
  `mikrotik_backup_collector.py:385` solo come riferimento (senza il filtro delle righe che iniziano con
  `[`), `vendors.service.ts:2550,2578` (`show running-config`, `display current-configuration`).
- Destinatari: `lib/device-config/{readers,collect,normalize,store,diff}.ts`. Il lettore MikroTik riusa
  `getConfig` di `router-client.ts:643`; mai `show-sensitive`. `normalize` toglie solo la riga d'intestazione
  con data; il confronto non ordina mai le righe. Nessun `_binary_backup` (scrive sul router).
- Prove: commento con data diverso = nessun cambio; ordine delle regole firewall diverso = cambio.

**T5.3 Rotte e schermata.** Controllo completo. Elenco versioni, scarica (admin), confronto, «Salva ora»
(admin, manuale) secondo la tavola. Guardie in `permessi/rotte.ts`.

**T5.4 Job pianificato.** Tipo nuovo in `scheduled-job-types.ts`, spento; `last_run` a fine giro.

**T5.5 (D4, dopo) Configurazioni host Proxmox.** Lettore nello stesso archivio, file in elenco chiuso,
manifest per file; etichetta «configurazioni host», mai «backup». Solo con decisione.

### B6 — NAS avanzato

**T6.1 Share e pacchetti strutturati (D3).** Donatori `qnap.py:779`, `synology.py:810`, `:798`;
destinatari `devices/nas/share.ts` (`parseSambaShares`, `parseNfsExports`, `parseSynologyShareList`),
`nas-acquisition.ts:573-586` senza `head`, `complete` esplicito. Prove: `global`/`homes` esclusi, nomi con
spazi e non ASCII, SMB e NFS della stessa cartella senza doppioni; `-enum`/`--enum` verificato sulla DSM
vera. Percorsi e utenti mai nei log.

**T6.2 ZFS QuTS hero (D2).** Solo con D8. `zpool list -H -p -o name,size,alloc,free,cap,health`,
`zfs list -H -p -o name,used,avail,mountpoint`; parser per colonne dichiarate in `devices/nas/qnap-zfs.ts`.
Prova di regressione: intestazione con CKPOINT/FRAG → `health = ONLINE`, `capacity = 20`.

## 5. Prove, fixture, collaudi

| Area | Fixture da raccogliere (sola lettura) | Collaudo sull'apparato |
| --- | --- | --- |
| HP Comware | `display lldp neighbor-information verbose`, `display interface brief`, `display stp brief`, `display link-aggregation summary`, `display poe interface`, `display port vlan` | Lettura «hp» accesa su uno switch, confronto con l'interfaccia web |
| HP ProCurve / Aruba OS | `show lldp info remote-device` (e dettaglio), `show interface brief`, `show spanning-tree`, `show trunks`, `show power-over-ethernet brief`, `show vlans ports all detail` | Come sopra |
| Aruba CX 6100 | `show interface brief`, `show lldp neighbor-info detail`, `show power-over-ethernet`, `show vlan` | Solo se esiste |
| MikroTik | `/interface ethernet print terse`, `… monitor [find] once`, `… poe print terse`, `… poe monitor [find] once`, `/interface bridge vlan print terse` (un CRS con PoE, un CCR con SFP) | Interruttore acceso su un apparato, `switch_ports` confrontate con WinBox |
| QNAP | `getsysinfo firmver`, `cat /etc/version`, `getsysinfo build`, `uname -rsm`; QuTS hero: `zpool`/`zfs` | «Acquisisci» e firmware a schermo |
| Synology | `synoshare --enum ALL` (o `-enum`), elenco pacchetti | Share e pacchetti a schermo |
| Windows | host Hyper-V; Server senza WinRM (DCOM); Server con Defender | Scheda apparato |
| Linux | host con LVM, uno senza | Scheda apparato |

Requisiti di regressione dai difetti noti (ognuno diventa una prova quando si tocca l'area): tensione
PoE nel campo potenza (T2.6); `vlan-ids` ignorato (T2.7); MAC con trattini e punti (T1.1); versione
RouterOS troncata ed EdgeOS chiamato UniFi OS (qualsiasi task che normalizzi versioni; T1.2 non tronca la
versione QTS); colonne ZFS per posizione (T6.2); «inviato» con il dato solo in RAM (E25, se mai si apre);
niente `Win32_Product` (T4.1-T4.3); nessun campo SFP senza lettore (E40).

Cancello di ogni task: `npm run lint && npx tsc --noEmit` più le prove mirate; il cancello completo
(`npm test` con `DA_INVENT_DATA_DIR` temporanea, `npm run build`) una volta per blocco, esito letto dal
codice di uscita con log nello scratchpad.

## 6. Risposte di Riccardo (21/10) e cosa cambiano

- **D8 — «non c'è nulla in uso».** Nessun DADude3, The Dude o storico da importare: E31 ed E36
  passano a **Escludere**. Senza QuTS hero, Docker, SCCM o questionario in uso: D2 (T6.2), E13, E10 ed
  E38 escono dal piano finché non nasce un bisogno.
- **D3 — collaudi HP.** Si fanno su una rete con **HP Comware, ProCurve e ArubaOS**, quando IPAM sarà
  installato in quella sede (nei prossimi giorni). Le fixture di T0.1 si raccolgono dall'appliance di
  quella sede, coi comandi in sola lettura di §5. Conseguenze sull'ordine:
  - **subito, senza apparati:** T1.4 (export solo admin, se D2 = sì), T2.2 (scrittura delle porte per
    campo, provata con dati finti nella forma di `switch_ports`), T1.1 (MAC virtuali) **dopo** il commit
    della sessione delle tappe 3-5, che sta modificando `topology/identity.ts`;
  - **all'arrivo della sede:** T0.1 per gli HP, poi T1.3 → T2.1 → T2.3 → T3.1 → T3.2;
  - T2.4 (Aruba CX) dipende da cosa sia «ArubaOS» in quella sede: ArubaOS-Switch (2530/2930) usa la
    stessa riga di comando dei ProCurve e i loro parser; AOS-CX (6100/6300) richiede il sottotipo nuovo.
- **Restano senza apparato di collaudo dichiarato:** MikroTik con PoE (T2.5-T2.7), QNAP (T1.2),
  Synology (T6.1), Hyper-V/Windows/Linux (B4). Si possono scrivere su uscite di documentazione, ma non
  si dichiarano finiti senza una prova sull'apparato.

## 7. Decisioni da prendere (D1-D9)

1. **D1.** Piano, ordine B0→B6 e livelli di controllo come in §3: approvati?
2. **D2.** Export MikroTik (`?action=config|all`) riservato all'admin subito (T1.4)?
3. **D3.** Quali apparati per fixture e collaudi (§5): HP Comware, ProCurve/Aruba, Aruba 6100, MikroTik
   con PoE, QNAP QTS e QuTS hero, Synology, host Hyper-V, Windows Server senza WinRM, Linux con LVM.
   Sono apparati dei clienti: va bene lanciarvi i comandi di sola lettura elencati?
4. **D4.** VLAN etichettate: si salvano subito in una tabella nuova (`switch_port_vlans`, una riga per
   porta e VLAN) o si tiene solo la non etichettata finché una schermata non le usa?
5. **D5.** Due interruttori nuovi, entrambi spenti: «Letture in più delle porte» (HP + MikroTik) e «HP»
   per la topologia. Oppure uno solo?
6. **D6.** Storico configurazioni: retention (proposta: ultime 30 versioni diverse per apparato, l'ultima
   valida sempre), HP già nella prima tappa insieme al MikroTik, evento «configurazione cambiata» negli
   eventi esistenti sì/no.
7. **D7.** Unificare i MAC virtuali e aggiungere GLBP (cambia l'indice dei nodi, misura prima): sì?
8. **D8.** Condizionati: c'è un DADude3 o un The Dude in esercizio con dati utili (E31, E36)? NAS QuTS
   hero in esercizio (D2)? Serve Docker (E13), SCCM (E10) o il questionario DATIA (E38)?
9. **D9.** Esecuzione: in questa sessione o in una nuova col prompt pronto; con subagent (una revisione
   alla fine per blocco leggero, una per task nei blocchi completi) o direttamente?

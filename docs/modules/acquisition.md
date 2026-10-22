# Collector modulari di acquisizione

Prima versione locale, approvata il 21/10/2026. Codice in `src/lib/acquisition/`.
Nessuna integrazione automatica con scheduler, database o interfaccia; nessun rilascio.

## Eseguire la CLI

Richiede Node 22 e le dipendenze già installate di DA-IPAM, non il server Next.js.
Il file di input JSON vive **fuori dal repository**, appartiene all'utente corrente e
ha permessi `0600`. Contiene `host`, `collector` (uno dell'elenco in `--list`; `"qnap-switch"` di default), e le credenziali che quel collector accetta (`catalogo.ts`):

- `ssh`: `username`, `password` oppure `privateKey` PEM, eventuale `passphrase`, `port` (default 22).
- `snmp`: `community`, `version` (`"2c"` di default oppure `"1"`), `port` (default 161); oppure SNMPv3: `version: "3"`, `username`, `level`, `authProtocol`/`authKey`, `privProtocol`/`privKey`.
- `api` (ESXi, ONTAP) e `winrm` (famiglie Windows, quando ci saranno): `username`, `password`, `port`.

I segreti non sono accettati come argomenti della riga di comando. I limiti opzionali
stanno in `limits`: `timeout_ms` (4000, inattività console / singola lettura SNMP),
`total_timeout_ms` (90000), `max_rows` (4096 per tabella), `max_output_bytes` (1 MiB per
lettura SNMP o sessione console). Il termine totale limita anche una console che
continua a produrre dati. Non esiste sweep di indirizzi o ricerca di password.

Dalla radice del clone:

```bash
node --import tsx scripts/acquire-device.ts --list
node --import tsx scripts/acquire-device.ts --schema
node --import tsx scripts/acquire-device.ts --credentials-file /percorso/privato/device.json --output /percorso/privato/snapshot.json
```

`--output` crea un file nuovo 0600 esterno al repository: non sovrascrive file già
presenti. Senza `--output`, stdout contiene soltanto il JSON: proteggere il file
con `umask 077` se si usa una redirezione. Non committare snapshot reali: contengono
identificativi, MAC e topologia. Errori di input su stderr, senza valori sensibili.

Codici di uscita: **0** sezioni richieste completate; **2** raccolta parziale,
JSON utilizzabile sezione per sezione; **1** identificazione fallita o errore interno;
**64** input/percorso/permessi non validi. Non trattare exit 2 come elenco vuoto.
Uno snapshot con `poe.status=skipped` non dichiara che il dispositivo non supporta PoE.

## Contratto JSON 1.0

Schema Zod in `schema.ts`; `--schema` esporta il JSON Schema dello snapshot.
Metadati: collector e versione, target, istante iniziale ISO, durata e stato globale.
Ogni sezione ha `status`, `collected_at`, `sources`, `warnings` e `data`.
L'istante della sezione indica la sua composizione; le letture non sono atomiche:
contatori, MAC e vicini possono cambiare durante il giro.

Sezioni: `identity`, `interfaces`, `vlans`, `forwarding`, `neighbors`, `spanning_tree`,
`aggregation`, `sensors`, `network`, `poe`. Estensioni additive opzionali: `resources`
(CPU e memoria), `environment` (stato ventole e budget PoE), `identity.part_number`
e `identity.boot_rom`. Gli snapshot QNAP 1.0 precedenti restano validi.

- `null` = sconosciuto. Non convertire in 0, false o assenza autorevole.
- `ok` = formato riconosciuto e lettura conclusa per quella sezione, non garanzia
  che ogni campo opzionale del modello universale sia disponibile.
- `partial` = limite, dati non osservati o lettura incompleta; nessuna cancellazione.
- `unsupported` = rifiuto esplicito del comando/OID; un walk vuoto non lo dimostra.
- `error` = guasto della raccolta; `skipped` = capacità non implementata o trasporto
  non fornito. `warnings` contiene codici stabili e spiega le limitazioni.
- Byte/packet counters sono stringhe decimali, inclusi Counter64 oltre 2^53.
- Velocità in bit/s: `speed_bps` è null a link down; `reported_speed_bps` conserva
  quanto dichiarato dal dispositivo. ifSpeed saturo senza ifHighSpeed resta ignoto.
- `if_index`, bridge port e nome console sono identificatori diversi. L'associazione
  console/SNMP richiede MAC univoco; i bitmap VLAN usano bridgePort→ifIndex.
  I LAG con MAC ambiguo mantengono ifIndex null. FDB ID non equivale a VLAN ID.
- `pvid` richiede lettura esplicita: non deriva dalla sola membership untagged.
- STP conserva `enabled`, protocollo e tabella porte: con enabled=false non
  classificare un collegamento bloccato dalla sola parola Discarding.
- Temperature in Celsius, ventole rpm, ottiche mW (non dBm), bias in ampere.
  DDM tutto zero non dimostra la presenza di un transceiver e non genera sensori.

## Integrazione esplicita in DA-IPAM

```typescript
import { acquireForIpam } from "@/lib/acquisition/adapter";

// request ha già il target e le credenziali risolte dal chiamante.
const { snapshot, deviceInfo } = await acquireForIpam(request);
```

Il core non importa DB, NextAuth, cron o route. L'adapter mappa i soli campi identità
compatibili con `DeviceInfo` e consegna anche lo snapshot completo. **Non salva nulla**:
il futuro chiamante applicherà autorizzazioni, risoluzione credenziali, anti-lockout,
contesto tenant e persistenza correnti. Non usare automaticamente i dati per
riclassificare dispositivi o eliminare porte, MAC e vicini. Non viene modificato il
percorso NAS QNAP preesistente, né il traffico di scansione attuale.

## Aggancio all'app: acquisizione modulare (C1-C2, 22/10, anteprima)

È **l'acquisizione normale dell'apparato con un altro formato** (tavola C1, piano
`2026-10-21-recupero-dadude3-mknet.md` §7). Spenta di default: Impostazioni → Sistema →
«Acquisizione modulare (anteprima)», chiave del tenant `acquisizione_modulare.attiva` («1» = acceso).

- **Dove parte:** `POST /api/devices/[id]/query` (il pulsante «Aggiorna» della scheda, la Discovery).
  `acquisizione-modulare/fonte.ts` decide: interruttore spento, nessun collector per il prodotto o
  «classica» scelta → il percorso di sempre, invariato (il blocco nella rotta è solo un'aggiunta).
- **Fonte ricavata:** collector da profilo/sottotipo/sysDescr (`acquisition/riconosci.ts`, puro),
  credenziali fra i binding non falliti dell'apparato (mai host, rete, hub, «public»), una per
  protocollo. Caso dubbio (due collector, o nessuna credenziale compatibile) → 409 e finestra
  «Scegli la fonte»; la scelta sta in `acquisition_source_choices`.
- **Un tentativo:** segreti letti nel backend solo per quelle voci (`richiesta.ts`); una voce
  illeggibile, un errore o un parziale non fanno provare altre credenziali. Lucchetto per apparato.
- **Archivio:** `acquisition_snapshots` (gzip, validato, senza segreti; errori salvati col solo codice),
  retention D5 (ultimi 20 + primo e ultimo ok).
- **Popola l'apparato** (`acquisition/proiezioni`, puro; `acquisizione-modulare/applica.ts`, una
  transazione): identità → `network_devices` (e modello/firmware/seriale sull'host solo se l'host
  aveva il valore copiato dall'apparato: un valore a mano resta, registrato come «manuale»);
  interfacce/PVID/PoE/STP CIST/vicini → `switch_ports` per campo (abbinate per nome, poi per indice;
  tolte solo da `interfaces` ok); vicini → `device_neighbors` fonte `collector`; STP CIST e
  aggregazioni → `topology_port_facts` fonte `collector`. Le fonti `collector` le legge il modello
  per cavo, non la mappa di oggi (T1) né l'attribuzione. Ogni modifica in `acquisition_changes`.
- **Scheda:** tab Gestione, riquadro sotto «Credenziali»; `GET /api/devices/[id]/acquisizione`
  (sessione), JSON completo solo admin (`.../snapshot/[sid]/scarica`).

## Collector qnap-switch

Collaudato in lettura su **QSW-M3216R-8S8T, QSS 4.5.0.847494 (20260908)**. Si identifica
tramite modello QSW letto in console oppure sysObjectID esatto osservato sul banco;
non si attribuisce ogni prodotto dell'enterprise SNMP a questa famiglia.

Trasporti riusati: `protocols/snmp-sessione.ts` e `devices/ssh-transport.ts`.
La console QSS rifiuta exec: il collector apre una shell, attende il prompt e
attraversa `--More--` con limiti. Nessun timeout o canale interrotto produce successo.
Comandi ammessi, fissi in `QSS_COMMANDS`: system-information, interfaces status,
interfaces, vlan, lldp neighbors, spanning-tree ports-summary, etherchannel summary,
system temperature, interfaces ddm, mac-address-table, tutti preceduti da `show`.
Nessun comando di configurazione, reset, export, lettura password o SNMP SET.

Sul banco: 16 porte fisiche e 16 gruppi LAG configurati, più un'interfaccia SNMP di
altro tipo; firmware/seriale, MTU/MAC/counter, tre VLAN, due vicini, FDB, STP e sensori
letti. Tabelle IP/ARP non acquisite (errori SNMP espliciti); PVID non osservati.
Lo stato complessivo con entrambi i trasporti è perciò parziale, non errore totale.
I totali dinamici della FDB non sono un criterio di regressione.

Limiti dichiarati: altri firmware/modelli non collaudati; LLDP solo riassunto (senza
nome/descrizione/IP remoto); PoE non implementato; SNMPv3 non esposto da questo input;
nessun endpoint API investigato o usato; nessuna scoperta automatica delle capability
non misurate. SSH eredita la policy di connessione del trasporto esistente, senza
aggiungere un archivio di pin host-key. Non vengono riutilizzati comandi NAS QTS.

## Collector hp-procurve

Collaudato con utente operator su **Aruba JL357A 2540-48G-PoE+-4SFP+**, firmware
**YC.16.11.0020**, ROM YC.16.01.0003. È ProCurve / ArubaOS-Switch: non ArubaOS-CX
né Comware. La famiglia si verifica sul sysDescr e sulla firma delle revisioni;
senza SNMP, una firma classica della revisione SSH consente una identità parziale,
con modello ignoto. Non si inventa il modello dal nome scelto per lo switch.

La CLI usa `collector: "hp-procurve"` nel file privato e gli stessi argomenti del QNAP.
Raccolta manuale read-only, senza nuove route, DB o job automatici. I trasporti e i
parser QNAP mantengono il loro comportamento; l'allowlist dei comandi è per profilo.

L'allowlist HP comprende: `show system`, `show version`, `show interfaces brief`,
`show vlans`, `show vlans ports all detail`, `show mac-address`, `show trunks`,
`show lldp info remote-device detail`, `show power-over-ethernet brief`,
`show spanning-tree`, `show system fans`. Nessuna promozione a manager, comando
`enable`, configurazione o esportazione di running-config.

Sul banco sono stati letti:

- 52 porte fisiche (48 rame PoE + 4 SFP+), più interfacce logiche SNMP. `49-Trk3`
  identifica la porta fisica 49, non un nuovo nome di porta. `ifName` univoco lega
  i record SSH e SNMP, senza dedurre ifIndex dal numero stampato. Contatori HC,
  MAC, MTU, alias e PVID arrivano dalle tabelle SNMP quando disponibili.
- VLAN con membership esplicita Tagged/Untagged, tramite dettaglio per porta o
  Q-BRIDGE-MIB; due trunk con membri e protocollo, senza indovinare lo stato
  operativo dai soli membri configurati.
- LLDP dettagliato: chassis ID anche non MAC, port ID testuale, nome, descrizione,
  capability e indirizzi di gestione. TTL non esposto resta null.
- Tabella MAC con VLAN esplicita e porta; STP globale e stati/ruolo root del CIST.
  **Le singole istanze MST non sono acquisite**: non estendere questi stati a ogni
  VLAN. L'avviso `CIST_ONLY_MST_INSTANCES_NOT_COLLECTED` resta nel JSON.
- 48 porte PoE: `power_watts` è **PD Pwr Draw**, non PSE Reserved. Budget globale
  disponibile/usato/rimanente separato in environment.
- CPU percentuale, memoria totale/libera in byte; tre ventole con stato e conteggio
  guasti, non RPM inventati. Sensori numerici di temperatura/RPM non implementati
  (`sensors.status=skipped`); il comando temperatura provato sul banco è rifiutato.
- Indirizzi IPv4 e tabella ARP, tramite SNMP standard.

Il banco è raggiunto con timeout di lettura 10 s e termine totale 180 s, impostati
nel file privato: le letture SNMP a 4 s erano parziali. Limiti di righe e byte restano
attivi; il collector conserva eventuali parziali anche con credenziali corrette.

Il pager HP scrive Enter oppure Return e può incollare il footer alla prima riga
successiva. Entrambi i casi sono normalizzati e coperti da regressioni; una perdita
avveniva anche nella prima riga PoE della pagina. I conteggi di porte, PoE, FDB, VLAN
e LLDP sono confrontati con le righe candidate: formato nuovo → risultato parziale,
non successo con righe perse. Il prompt operator `>` ridisegnato con ANSI e il
banner «Press any key» sono gestiti con gli stessi limiti temporali della console.
Altri modelli/revisioni e trunk dinamici non sono dichiarati collaudati.

## ProCurve modulare: 5406R zl2

Collaudato anche **HP J9850A 5406R zl2**, KB.16.09.0003. La raccolta aggiunge
`show modules` e ENTITY-MIB: 6 moduli osservati (management più cinque schede),
132 entità fisiche. `hardware` mantiene parent, classe MIB, posizione relativa al
parent, revisioni e identificativi. La posizione non è un numero di slot assoluto.

`modules` conserva slot, modello, descrizione, seriale e stato. Le porte A/B/…
sono associate soltanto agli slot osservati. Il banco espone anche interfacce E
ed elementi PoE per cui `show modules` non mostra una scheda: restano nel JSON con
`module_observed=false`. Questo significa **non osservato nella lettura**, non
prova di assenza fisica e non autorizzazione alla cancellazione. Se l'elenco dei
moduli è incompleto, il flag non viene assegnato. Una descrizione troncata che
arriva fino al seriale con uno spazio solo è coperta da regressione.

## Collector hp-comware

Collaudato su **HPE FlexFabric 5700**, Comware **7.1.045 Release 2432P06**, in
**IRF a quattro membri**, con due varianti di schede/apparati. Usa
`collector: "hp-comware"` nel file privato e lo stesso contratto JSON/CLI/adapter.
Non richiede installazione di un agente sullo switch.

Letture permesse: `display version`, `display interface brief`, `display vlan all`,
`display lldp neighbor-information verbose`, `display mac-address`,
`display link-aggregation verbose`, `display stp brief`, `display stp`,
`display cpu-usage`, `display memory`, `display environment`, `display fan`,
`display power`, `display device`, `display poe interface`. Nessun cambio di
configurazione, privilege escalation o lettura della configurazione completa.

Comware usa SSH exec, una connessione per comando: canale chiuso su timeout,
limiti di byte/pagine/tempo totale e stop del batch su guasti del trasporto.
Un canale senza exit status esplicito è parziale. Comandi rifiutati sono distinti
da guasti di connessione. Sul banco: limite di lettura 15 s e totale 300 s;
SNMP v2c usa blocchi da 50 varbind richiesti, conservando i limiti di righe/byte.
Un timeout di tabella lascia i dati ricevuti e rende visibile il risultato parziale.
Il collaudo finale resta **parziale** su ifTable/ifXTable/ENTITY (307 entità
parziali entro 15 s): i blocchi da 50 non hanno risolto il limite misurato.
Non presentare questi dati come inventario hardware o contatori completi.

Dati normalizzati:

- Nomi locali GE/XGE/FGE/HGE/BAGG/RAGG, porte fisiche/logiche distinte, 40G,
  down diverso da shutdown, PVID esplicito, join con ifName SNMP univoco.
- VLAN tagged/untagged con nome e descrizione; MAC con VLAN realmente stampata;
  LLDP multiplo sulla stessa porta, chassis anche non MAC, PortID remoto conservato,
  TTL e indirizzi di gestione. Range VLAN con sintassi `to` sono dichiarati parziali.
- LAG con membri Local, selezione S/U/I e flag; nessuna confusione con il tavolo
  Remote. STP con ID istanza effettivo: non si inventa una mappatura MST-VLAN.
- Moduli/membri IRF e inventario ENTITY con relazioni fisiche; la seriale di un
  membro non viene attribuita come seriale dell'intero IRF logico.
- CPU (finestra di 5 secondi) e memoria in byte **per membro**. I campi scalari
  restano null in presenza di più membri: nessuna media/somma implicita.
- Temperature per slot con soglie, inclusi zero e NA; salute/direzione delle
  ventole; stato degli alimentatori e consumo in ingresso per membro. Non sono
  RPM o budget PoE. Il banco risponde «PoE is disabled»: `poe.enabled=false`,
  sezione vuota valida, senza dedurre che ogni apparato Comware sia privo di PoE.

Limiti: altre release, Comware 5 e altre famiglie non collaudate; formato PoE
abilitato non implementato (restituisce parziale), niente ottiche DOM, IPv6/ND,
route, ACL o configurazione. Le tabelle sono fotografie successive, non una
transazione atomica sullo stack. Dati ed errori sono restituiti senza scrivere nel DB.

## Collector vmware-esxi: API diretta dell’host

Decisione: ADR 0025. Il profilo `vmware-esxi` usa vSphere Web Services SOAP su HTTPS `/sdk`, senza SSH
né accesso al vCenter. Il banco è **HPE ProLiant DL380 Gen11**, **ESXi 8.0.3 build
24677879**, API 8.0.3.0, gestito da vCenter. Riconosce `HostAgent` prima del login:
un endpoint `VirtualCenter` viene rifiutato, non attraversato per scoprire altri host.

Nel file privato indicare `collector`, `host` (IP di gestione diretto) e `api` con
`username`, `password`, `port` (default 443). Senza `api.tls_sha256` viene verificata
la catena CA. Per un certificato autofirmato serve l’impronta SHA256 esplicita
(32 coppie esadecimali separate da `:`): viene confrontata **prima di inviare il
payload o le credenziali**. Sul banco l’impronta è stata rilevata con preflight
senza autenticazione e salvata nel vault; non equivale a una certificazione CA.
Non esiste un flag generale per ignorare TLS. Password/cookie non sono restituiti.

CLI identica agli switch, per esempio dalla radice del progetto:

```bash
node --import tsx scripts/acquire-device.ts --credentials-file /percorso/privato/esxi.json --output /percorso/privato/esxi-snapshot.json
```

Allowlist API: RetrieveServiceContent, Login, FindByIp, RetrievePropertiesEx,
ContinueRetrievePropertiesEx, CancelRetrievePropertiesEx, Logout. Una sessione,
un tentativo di login, paginazione e richieste a gruppi di 100 oggetti. Timeout
assoluto per richiesta, limite totale/oggetti/byte/pagine; logout anche su errore
(con breve budget di chiusura). Nessun metodo di configurazione o power operation.
Le proprietà sono selezionate esplicitamente: niente `all=true`, configurazione
completa, extraConfig VM o parametri di autenticazione iSCSI.

La sezione opzionale **`virtualization`** conserva:

- Scope host, versione API, riferimento VMware dell’host e indirizzo del vCenter
  che lo gestisce; hardware fisico con UUID/seriale/BIOS, CPU, RAM e dispositivi PCI.
- Stato di connessione, manutenzione, accensione, boot/uptime e quick stats.
- vSwitch standard, pNIC risolte tramite la chiave VMware (anche i riferimenti
  originali restano), port group, ordine NIC active/standby quando esposto.
  VLAN 0 = senza tag; 1–4094 = access; 4095 = trunk, mai VLAN access 4095.
- VMkernel con MAC, MTU, IPv4/netmask, IPv6, DHCP e backing distributed se presente;
  DNS, gateway configurato e tabelle di routing IPv4/IPv6. Le righe di configurazione
  e quelle di tabella non rappresentano una nuova rete scoperta per ciascuna riga.
- Proxy switch distributed limitati alla configurazione visibile sull’host,
  senza dichiarare le policy complete dei distributed port group del vCenter.
- LUN/dischi e multipath con capacità/stato/adapter; datastore con riferimenti,
  spazio disponibile/capacità/uncommitted, accessibilità, condivisione, extents VMFS
  o sorgente NFS. Non sommare lo stesso datastore condiviso una volta per host.
- VM con riferimenti, UUID e instance UUID distinti, stato/runtime, CPU/RAM/template,
  guest OS e VMware Tools; vNIC con MAC/backing standard o distributed, connessione
  e indirizzi guest; dischi con capacità, controller/unità, datastore, backing e thin
  provisioning; snapshot con relazione padre/figlio. Il nome rete guest è un nome,
  non un ManagedObjectReference. Capacità intere in byte come stringhe decimali.
- Tutti i sensori numerici di salute con lettura, unità e modificatore originali;
  temperature e RPM riconosciuti sono anche normalizzati nella sezione comune.

**Collaudo del 21/10:** 4 pNIC, 2 vSwitch, 12 port group, 2 VMkernel, 18 VM,
8 datastore, 30 vNIC, 32 dischi virtuali, 4 snapshot e 59 sensori di salute
(25 temperature/RPM normalizzati). Conteggi delle VM/datastore confrontati con i
riferimenti dell’host; nessuna proprietà negata o mancante segnalata dal server.
Il JSON di virtualizzazione è `ok`; lo snapshot complessivo è **parziale**:
ARP non raccolto, membership VLAN fisica non deducibile dai port group.
I MoRef sono locali all’endpoint (usare target+tipo+MoRef per una futura importazione),
non chiavi globali da confrontare fra host.
FDB, LLDP/CDP, STP e LACP non raccolti; PoE non applicabile. I dati non osservati
non costituiscono elenchi autorevoli da usare per cancellazioni.

Gli IP guest provengono dai **VMware Tools**, non da scansioni di rete: quando i
Tools non girano possono essere assenti o vecchi. Il JSON lo segnala per VM.
Non si interroga il filesystem delle VM. Nessuna scrittura su DB/configurazione,
nessuna enumerazione degli altri host del cluster, nessuna somma implicita di RAM
assegnata/usata o spazio virtuale/fisico.

Regressioni specifiche: attributi `type` e `xsi:type` distinti (altrimenti si perdono
VM/datastore); LogoutResponse vuoto valido; liste singleton/array; route come array
diretto; pNIC unite per chiave; capacità oltre Number.MAX_SAFE_INTEGER; zero/false
preservati; fault XML/proprietà negata non diventano liste vuote; limiti, TLS pin,
paginazione/logout e segreti riecheggiati. XML con DTD/ENTITY viene rifiutato.

Limiti: solo ESXi 8.0.3 collaudato; altre versioni e configurazioni vDS/NSX da
verificare; discovery LLDP/CDP, ruoli VMkernel, HBA dettagliati, allarmi/eventi,
performance storiche e policy cluster/vCenter non implementati. Il collector è
invocato esplicitamente da CLI o adapter: il modulo storico `vmware_vsphere`
nell’interfaccia non viene attivato o sostituito da questo lavoro.

Riferimenti: [PropertyCollector](https://developer.broadcom.com/xapis/vsphere-web-services-api/latest/vmodl.query.PropertyCollector.html),
[HostSystem](https://developer.broadcom.com/xapis/vsphere-web-services-api/latest/vim.HostSystem.html),
[VirtualMachine](https://developer.broadcom.com/xapis/vsphere-web-services-api/latest/vim.VirtualMachine.html).

## Collector netapp-ontap: cluster e MetroCluster

Profilo REST GET su HTTPS, CA oppure pin SHA256 esplicito prima di Basic auth;
input `api` e CLI come ESXi. Credenziali fuori repo, nessun fallback SSH.
Decisione ADR 0026. Collaudato su **ONTAP 9.16.1P11**, **AFF A70**, MetroCluster IP.

Endpoint permessi: cluster/nodes, cluster/metrocluster e nodes/interconnects;
storage/aggregates, volumes, luns, disks, shelves; svm/svms;
network/ethernet/ports, network/ip/interfaces, network/fc/ports;
snapmirror/relationships e protocols/san/lun-maps. Solo GET, nessuna API di sicurezza,
configurazione completa, passthrough CLI, check/repair/switchover o failover.

Ogni endpoint ha stato/fonti/avvisi/tempo nel ramo **storage**. Controllo conteggio
records per pagina, next link solo stesso endpoint/origine, niente redirect,
cicli/righe/byte/tempo limitati. 401 ferma il batch; 403 e 404 restano distinti
(error/unsupported) dalle liste vuote ok. Capacità >2^53 conservate come stringhe
prima della conversione numerica grazie al source token del reviver Node 22.

Dati: identità/versione del cluster; nodi con modello/seriale/HA; configurazione
MetroCluster locale/remota, partner HA/DR/ausiliario, stato mirroring/operazione e
interconnessioni; aggregati e spazio fisico/logico; SVM, volumi e junction/export
policy; LUN e mapping/igroup; dischi/shelf/FRU; Ethernet fisiche/VLAN/LAG, LIF con
SVM/IPspace e home/current node/port; porte FC e relazioni SnapMirror.

Il banco restituisce 2 nodi locali, 4 nodi MetroCluster noti, 12 interconnessioni,
2 aggregati, 52 volumi, 10 LUN/10 mapping, 9 SVM, 72 dischi (**36 locali, 36 remoti**),
2 shelf, 34 porte Ethernet (18 fisiche, 12 VLAN, 4 LAG) e 28 LIF. FC e SnapMirror:
zero record validi; questo non dimostra assenza di capacità hardware FC e non
nega il mirroring MetroCluster, che è un’altra relazione. Stato riportato da
MetroCluster: ip_fabric, local/remote normal/configured; non è un test di failover.

Il cluster non ha una seriale/modello chassis inventati: sono attributi dei nodi.
Il partner remoto non è stato interrogato direttamente. Root aggregati e risorse
non visibili al REST non sono dichiarati assenti. Nessun totale globale ottenuto
sommando capacità specchiate, logical/physical o datastore montati su più host.

Storage acquisito ok; globale partial perché ARP e membership fisica VLAN non
sono raccolti. Sensori numerici non implementati; FRU mantengono stato, part number,
firmware e installazione, senza trasformarli in temperature/RPM inventati.
Altre release e privilegi diversi restano da collaudare.

### Analisi vCenter e consegna allo sviluppo

Il vCenter è stato acquisito con **prova locale separata**, non con un nuovo profilo
di prodotto: 1 datacenter, 5 cluster, 13 host, 431 VM, 38 datastore, 2 DVS/21 DV port
group. Correlazione NFS: 8 join univoci su 25 datastore NFS/NFS4.1 tramite IP della
LIF + SVM + junction path; 17 non correlati nello scope. 13 datastore VMFS non
associati a LUN senza prova NAA/WWID. I dati del caso rimangono nel dossier privato.

Logica, file e istruzioni per l’agente: `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`.
Questo documento distingue i collector pronti, la prova vCenter e ciò che deve
ancora essere installato/integrato in sviluppo. Nessun modello DB/UI/scheduler
attivato. SOAP aggiornato per risposte grandi: DTD/ENTITY rifiutati, entità standard
/numeriche decodificate una volta senza espansione automatica. NFS4.1 conserva
anche la lista dei remote_hosts.

Riferimenti: [MetroCluster nodes](https://docs.netapp.com/us-en/ontap-restapi/get-cluster-metrocluster-nodes.html),
[ONTAP API reference](https://github.com/NetAppDocs/ontap-automation/blob/main/reference/api_reference.adoc).

## Collector qnap-nas (non collaudato)

QNAP NAS con QTS o QuTS hero, letto via **SSH exec** (`ssh_modo: "exec"`: un login, un canale per comando, nessun
`sudo`), allowlist `QNAP_NAS_COMMANDS`. Distinto da `qnap-switch`.

- **identity**: modello da `getsysinfo model` (poi `DISPLAY_NAME` di `/etc/platform.conf`), seriale da
  `getsysinfo serial`, firmware come nel percorso storico corretto (S2, `devices/nas/qnap-versione.ts`):
  `getsysinfo firmver` o `/etc/version` più la build. **Mai** l'`uname`: il kernel va in `system.kernel`.
- **system**, **resources** (memoria da `/proc/meminfo`), **interfaces** e **network** (`ip -o link`,
  `ip -o -4 addr`), **host_storage** (solo filesystem da `df -P -k` e `df -P -i`, colonne per nome; dischi e RAID
  non letti: sezione `partial`), **shares** (nuova sezione opzionale: `smb.conf` più `/etc/exports`, unite per
  percorso), **software** (pacchetti da `/etc/config/qpkg.conf`). Le sezioni da switch sono `unsupported`.
- Un apparato che non risponde come QNAP (`getsysinfo` assente) dà `error` e nessuna sezione letta.
- **Non collaudato**: fixture inventate con la forma documentata (DADude3 `qnap.py:176,193,779`). Non è nel
  riconoscimento del prodotto (`riconosci.ts`): si usa dalla CLI finché un QNAP vero non l'ha letto. Da verificare
  al collaudo: percorso di `smb.conf` e `qpkg.conf` sul firmware vero, `ip` e `df -i` di BusyBox.

## Collector mikrotik-routeros (non collaudato)

MikroTik RouterOS 7 (router e switch CRS) via **SSH exec su una connessione sola** (`ssh_modo: "exec"`, come la
scheda MikroTik dell'app), allowlist `MIKROTIK_ROUTEROS_COMMANDS`: solo `print` e `monitor … once`, mai `/export`.

- Coordinato con la scheda MikroTik: interfacce, bridge, porte, monitor delle porte, bonding, vicini, risorse,
  routerboard, VLAN del bridge e tabella MAC si leggono coi parser di `devices/mikrotik-*` (uscite vere anonime nel
  repo). `parseRouterOsDurationSeconds` è passata in `devices/routeros-durata.ts` (foglia senza DB; `router-client`
  la riesporta) perché il core dei collector non importi il DB: lo controlla una prova.
- Nuovi (`mikrotik-routeros-parsers.ts`): velocità e duplex da `/interface ethernet monitor` letto **per colonne**
  (`tabellaMonitor`), PoE da `/interface ethernet poe monitor` con la potenza **solo** da `poe-out-power` (la
  tensione non è mai potenza: difetto di DA-MKNET `mikrotik.service.ts:1862`), `vlan-ids` con intervalli ed elenchi
  (`:1738`), indirizzi e ARP.
- Un errore di RouterOS scritto su stdout con exit 0 (`bad command name`, `not enough permissions`) non è un'uscita
  buona: comando sconosciuto = `unsupported`, permessi = `error`.
- Spanning tree solo CIST (le MSTI non si leggono, avviso `MSTI_NOT_COLLECTED`); sensori (`/system health`) non letti.
- **Non collaudato** e non nel riconoscimento del prodotto: i giri di oggi continuano a leggere i MikroTik col
  percorso storico. Da verificare al collaudo: monitor ethernet e PoE su un modello con PoE, `bridge host` con molte
  voci, tempi su un CCR con molte interfacce.

## Aggiungere una famiglia

Una famiglia è un collector con lo stesso contratto JSON 1.0. Il catalogo è l'**unico elenco**: l'enum
dell'input, l'enum dello snapshot, il registry statico e le allowlist dei trasporti ne derivano. Non si
carica codice a runtime e nessun comando arriva dall'input.

File da creare o toccare, in quest'ordine:

1. **`catalogo.ts`**: una voce nuova con `id`, `versione` (semver, parte da `0.1.0` finché non è collaudato),
   `famiglia`, `prodotti`, `credenziali` (`ammesse` e `una_di`), `sezioni` che popola davvero, `comandi`
   (allowlist; `null` se non usa console) o `script_winrm` (script PowerShell fissi, per id), `collaudo`
   (`non_collaudato` finché nessun apparato vero l'ha letto) e `collaudati` (modelli e firmware realmente
   visti: vuoto finché non collaudato). `verificaCatalogo` rifiuta le voci incoerenti.
2. **`comandi.ts`** se serve una nuova allowlist di console (solo comandi di lettura, nessuna
   configurazione, nessun `sudo` libero).
3. **Parser puri** (`<famiglia>-parsers.ts`): testo o JSON in, dati tipizzati fuori, nessuna rete. Colonne
   lette per nome, mai per posizione; capacità e conteggi oltre 2^53 come stringhe decimali; `null` = ignoto,
   zero e `false` sono dati.
4. **Il collector** (`<famiglia>.ts`): una funzione `collect…(request, trasporti?)` che costruisce lo
   snapshot con una `section` per ogni parte (`status`, fonti, avvisi, ora), passa da `redactSnapshot` e
   `snapshotSchema.parse`, usa `versioneCollector('<id>')` per `collector_version`. Una lettura mancata è
   `error`/`unsupported`/`skipped` con un codice, mai una lista vuota dichiarata `ok`. Una sezione che la
   famiglia non può avere è `unsupported` o `skipped`, non assente.
5. **`index.ts`**: la funzione in `IMPLEMENTAZIONI` (il tipo `Record<CollectorId, …>` fa fallire `tsc` se
   manca).
6. **Sezioni nuove** solo se servono: opzionali nello snapshot (`system`, `host_storage`, `software`,
   `services`, `security` esistono già in `sistema-schema.ts`), così gli snapshot già prodotti restano validi;
   `schema_version` resta `1.0` finché le aggiunte sono opzionali.
7. **Fixture** in `__tests__/contratto-fixture.ts`: una voce `FIXTURE[<id>]` con uscite della forma vera e dati
   inventati (IP di documentazione `192.0.2.0/24`, `198.51.100.0/24`; MAC `02:00:00:…`; nessun nome di
   cliente, seriale o hostname veri). Il repository è pubblico. Metti il segreto di prova dentro un campo di
   testo libero (nome host) perché la prova veda la redazione.
8. **Prove minime**: la suite `contratto.test.ts` le dà gratis (fixture → snapshot valido, versione dal
   catalogo, formato ignoto → mai `ok`, trasporto assente → `skipped`, trasporto guasto → `error` senza
   segreti e senza secondo tentativo); servono in più i test dei parser con uscite vere anonimizzate.
9. **Manuale**: una sezione in questo file con modelli e firmware collaudati, limiti dichiarati e prove
   eseguite. Non inferire capacità dai soli nomi del produttore. Una famiglia resta «non collaudata» finché
   non l'ha letta un apparato vero.

Trasporti disponibili: SSH (console o `exec`), SNMP v1/v2c a community **e v3** (`snmp.version: "3"`, aperta
solo da `protocols/snmp-sessione.ts`; opzioni incoerenti = errore prima della rete), HTTPS per vSphere e
ONTAP, **WinRM** (`winrm` nell'input, `createWinrmReader` sopra `devices/winrm-run.ts`: solo script a id
fisso del descrittore, solo codici d'errore). Nell'app le credenziali non si scrivono nell'input: la
richiesta si costruisce nel backend da `credentials/resolve.ts`, col budget anti-lockout; un'uscita parziale
(exit 2) non autorizza a provare altre credenziali.

## Prove

```bash
node --import tsx --test src/lib/acquisition/__tests__/*.test.ts src/lib/protocols/__tests__/snmp-sessione.test.ts
npx eslint src/lib/acquisition scripts/acquire-device.ts
npx tsc --noEmit
```

I test includono parser QSS, console con paginazione e timeout, troncamenti, STP
spento, contatori a 64 bit, bridge/PVID, mW/mA, redazione segreti, adapter senza DB,
CLI reale su agente UDP locale, permessi file e invariante sessioni SNMP centralizzate.

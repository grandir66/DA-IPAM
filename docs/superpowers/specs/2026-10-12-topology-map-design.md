# Design — Mappa della topologia: sedi, albero, porte

> Spec di progettazione. **Versione 2, 2026-10-13** — riscrive da capo la versione
> del 12/10 (in git: il motore v1, React Flow + dagre, è sul `dev` dalla v0.3.260 e
> sul dato vero di DTS è risultato «orribile, linee a caso, caotico»). Stato:
> **approvata da Riccardo il 13/10** (piano della fase 1:
> `docs/superpowers/plans/2026-10-13-topologia-fase1-dati.md`). Decisioni prese con Riccardo il 13/10 in una sessione di
> progettazione con bozze sul dato vero della rete Domarc. È la **tappa 5** del piano
> `2026-10-12-piano-miglioramento-design.md`. ADR di riferimento: 0003 (resta valida
> la scelta di React Flow; la disposizione con dagre è superata da questa spec).
>
> **Aggiornata il 13/10 sera con la fase 2 progettata (§10)**, in una seconda sessione
> con Riccardo e un prototipo interattivo sulla copia del DB di un cliente: «tutto
> automatico» + mappe «passo passo» con un nome, un oggetto fisico = un nodo, tabella dei
> MAC per porta. Le decisioni del §10 prevalgono sulle righe del §4 che le contraddicono.

## 1. Obiettivo e principio

Una mappa che serva a **quattro cose insieme** (scelta di Riccardo):

1. **panoramica come i drawio** fatti a mano: sedi, collegamenti fra sedi, dentro
   ogni sede la struttura dal router principale agli AP; consegnabile al cliente;
2. **trovare dove è attaccato** un apparato, un AP, un server, un client;
3. **vedere cosa non va**: apparato giù, uplink giù, collegamento sparito;
4. **documentare e correggere**: la mappa è il documento della rete del cliente.

**Principio**: prima si ricava tutto quello che si può dal DB di DA-IPAM e dai
controller (UniFi, poi Omada); a mano si configura solo ciò che nessuna fonte sa
(testa della sede, collegamenti invisibili, sede di un apparato ambiguo). **La scelta
manuale vince sempre sul dato automatico**, e mostra chi l'ha fatta e quando.

**Metro di giudizio**: gli schemi drawio di DTS fatti a mano
(`~/Progetti-Clienti/DTS/docs/diagrammi/`) — schemi **per sede**, collegamenti fra sedi
in primo piano con mezzo/porta/subnet sulla linea, pile corte gateway → core → bordo,
AP in fila, linee dritte, tratteggio per VPN e backup.

## 2. Cosa ha insegnato la bozza sul dato vero (13/10, rete Domarc)

Prototipo da buttare, albero dalla testa seguendo LLDP/MNDP già nel DB dell'hub:

- con la radice giusta (scelta a mano, vedi §3) l'albero si legge come la rete vera;
- solo **16 collegamenti fra apparati** su 88 vicini: **34 vicini sono host** che
  annunciano LLDP (hypervisor, server) e devono comparire come «attaccati»; **55 non
  si abbinano** a niente di noto (manca abbinamento per MAC e l'uplink UniFi);
- **26 apparati isolati**: 19 classificati «switch» che sono PC o server (dato
  sporco), i 5 Proxmox presenti sia come apparato sia come host (doppi), 3 switch
  UniFi che l'uplink ricollegherebbe;
- molti «attaccati» sono **switch che esistono solo come host** (punto «host che sono
  apparati» del piano);
- disegno: gli attaccati sotto lo switch coprivano le linee verso i figli → fascia
  propria; le scritte sforavano dai nodi → larghezza calcolata sul testo.

## 3. Il modello (cosa sa il motore)

**Sede** = Ubicazione di primo livello (Inventario → Ubicazioni, tabella `locations`,
gerarchica con `parent_id`). Una sede ha:

- **apparato di testa**, scelto a mano; il sistema propone il router che fa da gateway
  del maggior numero di subnet della sede (a Domarc: MK-RTR-CORE, non la UDM);
- **subnet legate** (una subnet appartiene a una sede), usate per proporre la sede
  degli apparati.

**Armadio** = Ubicazione figlia della sede (Sede › Piano › Armadio). Facoltativo:
raggruppa gli switch nell'albero.

**Apparato nella mappa** = uno per oggetto fisico:

- si fondono apparato di rete e il suo host (`network_devices.host_id`,
  `physical_device_id`): niente doppi;
- gli **host che sono apparati di rete** (classificazione switch/router/AP con
  collegamenti LLDP) diventano una **proposta** «promuovi ad apparato», da confermare;
- ha sede e armadio (proposti: dalla subnet dell'IP di gestione, poi dall'albero — uno
  switch sta nella sede del suo uplink; confermati o corretti a mano);
- ha un **ruolo** nell'albero: testa · aggregazione · accesso · AP · attaccato,
  dedotto dal tipo e dalla posizione, correggibile.

**Collegamento**, fonti in ordine di fiducia:

1. correzione manuale (aggiungi / ignora);
2. **uplink UniFi** (`uplink.uplink_mac`, `uplink_remote_port`, porte `is_uplink`) —
   oggi letto e buttato dal mapper: si salva;
3. LLDP / CDP / MNDP, abbinati per IP, poi **per MAC del vicino**
   (`device_neighbors.remote_mac`, oggi ignorato), poi per nome;
4. tabella MAC delle porte (`mac_port_entries`, `switch_ports.single_mac_*`): solo per
   gli attaccati e i conteggi dei client.

Ogni collegamento sa **la fonte** e **quando è stato visto l'ultima volta**. Un
collegamento che sparisce non si cancella: diventa «non visto da N giorni».

**Albero di una sede**: si **calcola, non si salva**. Dalla testa, visita dei
collegamenti preferendo le fonti più affidabili; i collegamenti fuori dall'albero
(ridondanze, aggregazioni, VPN) diventano linee secondarie.

**Correzioni** (dati, non pixel): testa della sede · sede/armadio di un apparato ·
collegamento da aggiungere o ignorare · ruolo · nodo nascosto · subnet → sede. Ognuna
con autore e data.

**Da sistemare**, sempre in vista: apparati senza sede, senza collegamenti, tipi
sospetti, proposte «promuovi ad apparato».

## 4. Cosa si vede e cosa si fa

### Livello 1 · La rete

Sedi come riquadri (apparati, AP, client, stato), Internet sopra, **collegamenti fra
sedi** come linee spesse con mezzo e velocità (VPN tratteggiata). Prima disposizione
automatica (sedi principali ai lati, le altre sotto, come i drawio), poi le sedi **si
trascinano e restano**.

### Livello 2 · Dentro la sede (clic sulla sede)

Albero dalla testa, livelli fissi: Internet → testa → aggregazione → accesso.

- **AP in fila** sotto il loro switch;
- **attaccati** (server, hypervisor, NAS, stampanti, telefoni) in una **fascia
  propria** sotto lo switch, senza coprire le linee; oltre una soglia, «+ altri N»;
- client come conteggio sotto la porta o l'AP, apribile (i client veri arrivano con
  la tappa 4);
- switch dello stesso armadio in un riquadro leggero, se gli armadi sono definiti;
- linee ad angolo retto con le porte; linee secondarie tratteggiate;
- **ritocchi a mano**: un nodo trascinato si porta dietro il suo ramo; il ritocco
  resta finché la struttura attorno (genitore e fratelli) non cambia, poi torna
  automatico; «Riordina» li toglie tutti.

### Livello 3 · Lo switch (clic sullo switch)

Le porte in fila (piena = attiva, vuota = libera, uplink evidenziato), per porta cosa
c'è attaccato, velocità, VLAN.

### Comune ai livelli

- **Cerca** nome / IP / MAC → porta al punto (sede → switch → porta), nodo evidenziato.
- **Stato**: apparato giù = rosso pieno con ▲; uplink giù = linea rossa spessa;
  collegamento non visto da più di un giorno = linea grigia tratteggiata con «non
  visto da N g»; lo stato **risale** (porta → switch → sede). Mai solo colore: forma +
  simbolo + testo (Riccardo è daltonico). Aggiornamento automatico (30 s).
- **Correggere** (solo admin): clic destro su nodo o linea — sede/armadio, testa della
  sede, aggiungi collegamento (porta → porta), ignora collegamento, ruolo, nascondi.
  «Da sistemare» con assegnazione a gruppi («questi 7 → Sede 2»).
- **Filtri**: infrastruttura · Wi-Fi · attaccati · solo problemi.
- **Export drawio** per livello (rete, o una sede), con le forme Cisco di drawio
  (`mxgraph.cisco.*`) e le stesse coordinate dello schermo.

### Icone

Set **nostro in stile Cisco** (stesse forme e significato, colori Domarc; il set
ufficiale Cisco non si incorpora nel software senza verificarne la licenza): router,
switch, switch L3/aggregazione, firewall, AP, server, hypervisor, NAS, telefono IP,
stampante, telecamera, Internet, client. Approvate il 13/10 (bozza
`.superpowers/brainstorm/…/icone-cisco.html`) con due requisiti:

- **switch e switch L3 distinguibili a 20 px** (a 20 px la freccia ciano sparisce:
  badge «L3» o due switch impilati);
- **nessuna scritta esce dal nodo**: larghezza calcolata sul testo, nome troppo lungo
  accorciato con «…» e intero al passaggio del mouse.

## 5. Architettura

Quattro pezzi, ognuno provabile da solo:

1. **Costruttore del grafo** (`src/lib/topology/`, logica pura): apparati, host,
   vicini, uplink, porte, sedi, correzioni → nodi fusi, collegamenti (fonte, età),
   albero per sede, «Da sistemare». Funzioni DB solo da `db-tenant` (import statico,
   ADR 0002).
2. **Disposizione** (logica pura): albero → coordinate. Algoritmo d'albero ordinato
   (larghezza dei sottoalberi, livelli fissi, fratelli in ordine: aggregazione,
   accesso, AP, poi alfabetico). Nessuna libreria nuova (dagre si toglie). ELK
   scartato: esito meno prevedibile, contro «stessa rete = stesso disegno».
3. **Disegno** (React Flow, resta): nodi con icone e testo misurato, linee ortogonali,
   i tre livelli, pannello «Da sistemare», menu delle correzioni.
4. **Export drawio**: stesse coordinate del pezzo 2, forme Cisco di drawio.

**Dati nuovi** (migrazioni additive, idempotenti):

- uplink UniFi salvato (sull'apparato: MAC e porta dell'uplink; sulla porta:
  `is_uplink`), scritto dalla sync della tappa 2;
- `network_devices`: ubicazione (sede/armadio), ruolo manuale, nascosto;
- sede: apparato di testa, subnet legate (`networks` → ubicazione);
- tabella delle correzioni ai collegamenti (aggiungi/ignora, autore, data);
- età dei collegamenti (`device_neighbors.timestamp` esiste: si usa invece di
  cancellare);
- ritocchi di posizione: `topology_position` resta, con la «firma» della struttura
  attorno al nodo (genitore + fratelli) per capire quando un ritocco è scaduto.

## 6. Fasi

Ognuna rilasciabile e guardata a schermo sul dato vero.

| Fase | Contenuto | Livello di controllo |
| --- | --- | --- |
| 1 · I dati giusti (**fatta, v0.3.277, 13/10**) | uplink UniFi salvato; abbinamento per MAC; fusione apparato↔host; proposta «promuovi ad apparato»; sede = Ubicazione con subnet e testa; correzioni; età dei collegamenti | **completo** (schema DB, dati del cliente) |
| 2 · La mappa (**fatta, v0.3.278, 13/10**; progettata il 13/10, §10) | **A** raccolta dei MAC per porta + tabella delle mappe · **B** motore (identità, attaccati, albero, disposizione) · **C** pagina: «tutto automatico» e mappe «passo passo», icone, fascia degli attaccati, AP in fila, ritocchi, «Da sistemare». **Sostituisce la mappa di oggi** | A **completo** (schema, scritture a ogni lettura); B e C leggero |
| 3 · Le sedi | livello 1, collegamenti fra sedi, stato che risale, ricerca | leggero |
| 4 · Il dettaglio | livello 3 (porte), filtri, correzioni col clic destro, export drawio | leggero |

## 7. Verifica

- **Prove** sul costruttore e sulla disposizione con dati della forma vera: fixture
  DTS anonimizzata (esiste per UniFi) e fixture Domarc. Garanzie scritte come prove:
  stessi dati → stesse coordinate; un AP in più non sposta gli altri rami; nessuna
  scritta esce dal nodo; un collegamento manuale vince su LLDP; un collegamento
  sparito diventa «non visto», non scompare.
- **A schermo a ogni fase**, a 1920 px: rete Domarc (hub) e **copia del DB di DTS**
  messa accanto ai drawio di DTS.
- Ogni scrittura sui dati di un cliente: copia del DB, numeri mostrati, conferma.

## 8. Aperto (si decide nella fase indicata)

- **Collegamenti fra sedi** (fase 3): se i router delle sedi si vedono via
  LLDP/MNDP escono da soli; altrimenti si dichiarano a mano con mezzo e velocità.
  Da verificare sulla copia di DTS.
- **Soglia del «non visto»**: **decisa il 13/10, 2 giorni**, modificabile (impostazione
  `topology_link_stale_days`, 1–30). Con una lettura UniFi al giorno, un giorno esatto farebbe
  diventare grigio tutto a ogni lettura in ritardo.
- **Client veri** sotto porte e AP: con la tappa 4 (lettura dei client dal controller).
- **Dato sporco** (19 «switch» che sono PC/server sull'hub): la mappa li mette in «Da
  sistemare»; correggere la classificazione è un lavoro a parte.

## 9. Fuori da questa spec

Rilievo fisico di rack e cablaggio; topologia logica per VLAN (si valuta dopo);
Omada (tappa 4); scrittura sui controller (mai).

## 10. Fase 2 progettata (13/10 sera, decisioni con Riccardo)

Nasce dai due input di Riccardo del 13/10 sera (mappa costruita un oggetto alla volta;
partire da qualunque apparato, anche senza controller) e da un prototipo interattivo
sulla copia del DB del cliente A (quello della fixture `topologia-cliente-a`) e sulla
rete Domarc. Le decisioni qui sotto **non si riaprono senza chiedere**.

### 10.1 Cosa ha mostrato il dato vero (13/10 sera)

- **Nessuna sede definita** né sul cliente A né sull'hub: l'albero «della sede» oggi
  non ha una testa da cui partire. Le mappe della fase 2 non dipendono dalle sedi.
- Sul cliente A il grafo è **un solo blocco di 115 nodi** (3 router, 48 switch, 24 AP);
  gli isolati sono server classificati «switch» (dato sporco già noto).
- **`mac_port_entries` è vuota** su entrambi: le porte sanno quanti MAC vedono
  (`switch_ports.mac_count`), non quali. La lettura SNMP/SSH calcola l'elenco per porta
  e ne salva solo conteggio e MAC unico; UniFi `stat/device` dà solo il conteggio.
- **Lo stesso oggetto compare più volte**: il router principale con tre IP (due
  virtuali VRRP), il secondo router della coppia VRRP con quattro IP e lo stesso MAC,
  e un router censito con un nome in DA-IPAM e annunciato con un altro via MNDP.
- **Il seriale degli host non è affidabile**: 40 seriali su 81 sono condivisi da host
  diversi (lo stesso seriale su cinque PC, o su un PC e un telefono: resta attaccato
  all'IP riassegnato dal DHCP), e i router MikroTik riportano tutti lo stesso
  «seriale» (l'identificativo di un controller USB).
- Fra i collegati del router principale ci sono i **ponti radio fra le sedi**, censiti
  solo come host: «promuovi ad apparato» serve dove si guarda la mappa.
- Sul bridge di un router si vedono centinaia di MAC (tutta la rete): il numero di
  client ha senso solo su switch e AP.

### 10.2 Due modi di costruire la mappa

- **Tutto automatico** — la mappa di **tutta la rete**, una per cliente, senza scegliere
  niente: pensata per le reti piccole. Si ricalcola a ogni apertura: un apparato nuovo
  compare da solo. L'albero parte dalla **testa**: quella della sede se c'è, altrimenti
  il router (apparato censito) che raggiunge più nodi coi soli collegamenti non
  «vecchi»; un admin la cambia con «Usa come testa». Gli apparati senza collegamenti
  stanno in «Da sistemare», non nell'albero. Le interfacce dei router censite come host
  (stesso nome o MAC del router, IP virtuali) non sono nodi: vedi 10.4.
- **Passo passo** — **mappe con un nome, più di una per cliente, condivise** da chi
  lavora su quel cliente (es. «Panoramica: i tre router e i collegamenti fra sedi»,
  «Sede 2 – capannone»). Ognuna ricorda i suoi **oggetti di partenza**, gli oggetti
  aggiunti e i ritocchi. Si costruisce così:
  1. elenco degli oggetti (cerca per nome/IP, gruppi: router e firewall, switch, AP,
     server e attaccati, client chiusi, «Da sistemare») → **Inserisci**;
  2. sull'oggetto un segno **+N** (fondo giallo, testo scuro, e il numero: mai solo
     colore) = apparati collegati non ancora nella mappa;
  3. clic sull'oggetto → pannello a destra con **i collegati**: oggetto, porte (mia →
     sua), fonte (uplink UniFi / LLDP / CDP / MNDP / a mano), «✓ visto oggi» o «▲ non
     visto da N g», e **Aggiungi**; in fondo «Aggiungi tutti gli apparati collegati»
     (non gli host) e l'elenco delle porte con i MAC attaccati;
  4. sull'oggetto: «Togli dalla mappa», «Usa come partenza», «Promuovi ad apparato»
     (per un host che è infrastruttura).
  Un apparato nuovo collegato a uno già nella mappa **non entra da solo**: alza il +N.
  Una mappa consegnata al cliente non cambia da sola.
- **«Crea una mappa passo passo da qui»** sulla mappa automatica copia ciò che si vede
  in una mappa con un nome, con la testa come oggetto di partenza.

Il prototipo (da buttare) ha confermato il percorso: «il sistema mi sembra molto
efficace» (Riccardo, 13/10).

### 10.3 Cosa è un nodo

- **Nodi**: router, firewall, switch, AP, server, hypervisor, NAS. Server, hypervisor e
  NAS nella **fascia degli attaccati** accanto al loro switch, con la porta.
- **Client** (PC, telefoni, stampanti, telecamere, sconosciuti): **non sono nodi**, sono
  il numero di MAC sulla porta o sull'AP — **solo su switch e AP** — con l'elenco al
  clic. Nel passo passo un client si può aggiungere come nodo (es. una stampante
  critica).

### 10.4 Un oggetto fisico, un nodo

Un nodo raccoglie tutti gli indirizzi dello stesso oggetto, e il pannello li elenca
tutti con le informazioni dell'oggetto. Si fondono, in quest'ordine:

1. host con lo **stesso MAC vero** (con l'apparato che ha quel MAC, o fra loro): i **MAC
   virtuali non identificano nessuno** — VRRP `00:00:5E:00:01:xx` e `00:00:5E:00:02:xx`,
   HSRP `00:00:0C:07:AC:xx` — perché passano da un router all'altro;
2. host con lo **stesso nome annunciato** (nome dell'host, identità MNDP/LLDP; senza il
   dominio: «pc1» = «pc1.dominio.local»), **solo per infrastruttura e server** e solo se
   nessun MAC vero lo contraddice; sui client no (due «iPhone» non sono un telefono);
3. il nome annunciato da un host già fuso con un apparato diventa un **alias**
   dell'apparato: «<nome in DA-IPAM> (si annuncia come <identità>)»; gli altri host con
   quell'alias entrano nell'apparato;
4. gli **IP virtuali** (VRRP) stanno sul router che li annuncia, con la scritta
   «virtuale VRRP»;
5. il **seriale non si usa** per fondere finché non viene dall'apparato stesso (SNMP), e
   mai se è un valore spazzatura («Default string», «To be filled…», «…0123456789»,
   «….usb3») o se porta nomi diversi.

Misura sulla copia del cliente A: 6 nodi doppi in meno (il router principale assorbe
tre suoi IP; quattro IP con lo stesso MAC diventano un oggetto solo, da promuovere).
Logica pura del costruttore: nessuno schema, nessuna scrittura. Unire o separare a
mano due oggetti resta fuori dalla fase 2 (servirebbe una tabella; si valuta se le
regole sbagliano sul dato vero).

### 10.5 La tabella dei MAC per porta

- **Fonti**: SNMP/SSH salvano a ogni giro di lettura dello switch l'elenco per porta che
  già calcolano (nessuna chiamata in più); il controller UniFi con una lettura in sola
  lettura dei **client** (`stat/sta`: switch e porta per i cablati, AP per i wireless).
- **Lettura dei client UniFi**: **ogni ora dalle 7 alle 20**, job a parte **spento di
  default**, acceso per controller dalla pagina Controller di rete. La lettura degli
  apparati resta quella di oggi (03:00). Alle 3 di notte i client sono spenti.
- **Conservazione**: **ultima lettura + «visto l'ultima volta» per 30 giorni**: una riga
  per (apparato, MAC, porta) che si aggiorna (`timestamp` = ultima volta, `first_seen`
  = prima volta, `source`), poi pulizia a 30 giorni. Stesso principio dei vicini (ADR
  0008): invecchia, non si cancella a ogni lettura. Niente storico degli spostamenti.
- **Dove è attaccato un MAC**: sulla **porta di bordo** — non uplink, non porta di un
  collegamento fra apparati — dello switch più in basso nell'albero che lo vede. Le
  porte di passaggio non contano.
- Livello **completo**: schema additivo e scritture a ogni lettura in ogni DB cliente.

### 10.6 Dove si salvano le mappe

- Tabella nuova **`topology_maps`** (nome, tipo `auto` | `passo`, oggetti di partenza,
  testa scelta per l'automatica, autore, date): una riga `auto` per cliente (nasce alla
  prima scelta di testa o al primo ritocco), una per ogni mappa passo passo.
- **`topology_position`** (esiste, con `view`): `view = 'mappa:<id>'`; una riga per
  oggetto della mappa passo passo (`pinned = 0` = nella mappa, posizione automatica;
  `pinned = 1` = ritoccato a mano, con `structure_sig`). Per l'automatica solo i ritocchi.
  Cancellare una mappa = una transazione sulle due tabelle.
- **Cosa vale per una mappa e cosa per tutta la rete**: «togli dalla mappa», oggetti di
  partenza e ritocchi valgono **per quella mappa**; nascondi (`topology_hidden`),
  collegamento aggiunto/ignorato (`topology_link_overrides`), testa e sede valgono **per
  tutta la rete**, cioè in tutte le mappe.
- La migrazione sta nella tappa A, con quella dei MAC per porta: un solo giro di
  `quick_check` su tutti i tenant e di copie.

### 10.7 Prove della fase 2

Oltre alle garanzie del §7: un host col MAC virtuale non si fonde; due «iPhone» non si
fondono; un seriale spazzatura non fonde; un MAC visto su un uplink e su una porta di
bordo sta sulla porta di bordo; un apparato nuovo non entra in una mappa passo passo;
una riga MAC non vista oggi resta con «visto l'ultima volta» e sparisce dopo 30 giorni.
Fixture riestratte (anonimizzate) dopo la tappa A dalle copie del cliente A e dell'hub,
con uplink, MAC per porta e oggetti con più IP veri (le fixture della fase 1 hanno sedi
e uplink a zero).

## 11. Fase 2b — interazione, collegamenti a mano, hypervisor e VM (14/10, decisioni con Riccardo)

Nasce dall'uso della v0.3.278 sul dato vero (14/10 mattina) e da una bozza statica
approvata («fantastico»). Le decisioni qui sotto **non si riaprono senza chiedere** e
prevalgono sul §10 dove lo contraddicono.

### 11.1 Cosa ha mostrato il dato vero (cliente A, copia del 14/10)

- **Difetto della v0.3.278**: un MAC visto **solo dal router** (sul bridge o su una VLAN)
  creava un collegamento router → oggetto. Prima della prima lettura dei client tre host
  Proxmox risultavano attaccati al router; con la lettura delle 07:00 stanno sugli switch
  giusti. Regola (era già nella spec §10.5, il codice la violava): **ciò che un router vede
  sul bridge non prova nessun cavo e non crea collegamenti**.
- **Regola generale di Riccardo (14/10): un router (es. MikroTik) aggiunge solo gli apparati
  direttamente collegati**, anche quando li vede via LLDP, CDP o MNDP: il router sente tutti
  gli annunci del suo segmento, anche quelli dietro uno switch. Un vicino di un router è
  **diretto** solo se: (a) è visto su una porta fisica (non `bridge`, VLAN, VRRP, bond
  logico) **e** (b) è l'unico vicino su quella porta, oppure è l'apparato che dall'altro
  lato vede il router sulla sua porta (conferma dai due lati: LLDP/CDP dell'altro apparato
  o uplink UniFi). **MNDP non conferma**: è un annuncio di segmento che attraversa gli
  switch, quindi due router che si sentono via MNDP non provano un cavo fra loro (sul cliente
  A creava un falso collegamento fra due router; revisione finale, M-5, 14/10). MNDP vale
  solo come «unico vicino su una porta fisica». Gli altri vicini del router non creano collegamenti (restano nei dati,
  servono all'abbinamento e alla «non vista»).
- I tre host Proxmox sono censiti come apparati di tipo **«server»**: per la mappa sono
  hypervisor (fornitore o scansione Proxmox).
- La scansione Proxmox esistente legge la **configurazione** delle schede: nessun MAC sulle
  schede fisiche, stato sempre «down»; ultima scansione di maggio, nessun job la ripete.
  Ha però **25 VM** con l'host su cui girano: **28 schede di VM su 33** compaiono nella
  tabella dei MAC per porta (oggi contate come client della porta dello switch), e
  **6 dei 10 «apparati isolati» sono VM** di quel cluster.
- Sulle porte: velocità nota su 326 porte su 828 (10M-10G), PoE su 461 (consumo su 81).
  Il tipo di uplink degli AP (cavo o wireless/mesh) la lettura UniFi di oggi non lo salva.

### 11.1 bis Le porte fisiche del router (14/10, dopo l'indagine sulla v0.3.279)

Riccardo: «i link proposti dal router dovrebbero prevedere tutto quello che è collegato alle
porte». L'indagine ha trovato che le righe MAC del router non venivano dalla tabella bridge host
ma dall'**ARP**, che riporta l'interfaccia di livello 3 (bridge, VLAN, VRRP): porte fisiche
quasi zero. Regola:

- il router legge `/interface bridge host` (porta del bridge e VLAN, righe locali scartate) e
  `/interface print` (il tipo); si salvano in `mac_port_entries` solo le righe su porte di tipo
  `ether` (sfp compresi) o `bond`. Bridge, VLAN, VRRP, tunnel e wlan non sono cavi. L'ARP non
  scrive più le porte; resta per gli indirizzi;
- **ripiego «porta di bordo»**: una porta fisica con un solo apparato dietro, non spiegato da
  collegamenti più forti (correzioni, uplink, LLDP/CDP, tabella MAC degli switch), è un
  collegamento del router. Una porta di passaggio (un ramo intero dietro) non genera nulla; con
  due apparati di rete sulla stessa porta, nessun collegamento;
- le porte instradate fuori dal bridge (WAN, ponti radio) si vedono con ARP e con MNDP/LLDP, non
  con la bridge host. Il nome non basta a dire se una porta è fisica (`ether1-2.5` lo è);
- la lettura dei router parte da un job `arp_poll` senza rete, perché la regola d'avvio dello
  scheduler spegne la scansione veloce sulle reti da /22 in su (incidente del 25/05).

### 11.2 Interazione

- **Trascinare** un oggetto dall'elenco di sinistra sulla mappa lo aggiunge alla mappa passo
  passo; «Inserisci» sparisce. Senza una mappa scelta, il primo trascinamento chiede il nome
  e crea la mappa (così non c'è più un pulsante che manca senza spiegazione).
- **Tasto destro** su un oggetto: Dettagli · Mostra VM / Nascondi VM (hypervisor) · Aggiorna
  VM · Collega a… · Aggiungi collegati ▸ (sottomenu con i collegati spuntabili) · Usa come
  partenza / Usa come testa · Togli dalla mappa · Nascondi da tutte le mappe · Promuovi ad
  apparato (host). **Tasto destro su una linea**: Modifica porte (solo a mano) · ★ Rendi
  principale · Rimuovi (a mano) / Ignora (automatico).
- **La barra di destra resta** con i dettagli di oggi, con un pulsante per chiuderla e
  riaprirla (la mappa prende tutto lo spazio quando è chiusa).
- Gli oggetti **si spostano trascinandoli** sulla mappa (ritocchi con la firma, come oggi).

### 11.3 Collegamenti a mano e collegamento principale

- **«Collega a…»** col tasto destro, oppure trascinando dal pallino sul bordo di un oggetto
  fino a un altro: scheda con **porta di partenza** e **porta di arrivo** (scelte fra le porte
  note — porte dello switch, schede dell'hypervisor — o scritte a mano), **tipo** (cavo,
  fibra, wireless) e nota. Si salva in `topology_link_overrides` (`add`, con le porte) più
  il tipo.
- **Verifica**: un collegamento a mano è **confermato** se i dati lo vedono (un collegamento
  automatico fra gli stessi oggetti, o un MAC dell'oggetto di arrivo — anche di una sua
  scheda — sulla porta dichiarata, entro la soglia «non visto»); altrimenti è **«solo a
  mano»**. Si dice in parole sulla linea e nei dettagli.
- **Principale**: quando un oggetto ha più collegamenti verso l'albero, **decide il sistema**
  (confermati e recenti prima, poi la fonte più affidabile: uplink UniFi, LLDP/CDP/MNDP,
  tabella MAC, a mano confermato, a mano non confermato, vecchi); **Riccardo può
  cambiarlo** con «★ Rendi principale», che vince sempre. Gli altri sono **ridondanza**.

### 11.4 Come si disegna un collegamento (stile A della bozza)

Mai il solo colore. **Spessore = velocità** con etichetta («10G» e oltre, «2,5G», «1G»,
«100M»; nessuna etichetta se non nota). **Forma = tipo e stato**: ondulata + «≋ Wi-Fi»
per wireless; doppia linea sottile + «ridondanza»; grigia tratteggiata + «▲ non visto da
N g»; «✎ ✓» a mano confermato; puntinata + «✎ ?» a mano non confermato. **«⚡ N W»**
vicino alla porta per il PoE; **★** sul principale scelto a mano. Velocità e PoE vengono
dalla porta dello switch (`switch_ports`); il wireless dal tipo di uplink UniFi (da salvare),
dai client wireless e dal tipo dato a mano.

### 11.5 Hypervisor e VM

- Hypervisor = apparato `hypervisor`, oppure `server` con fornitore o scansione Proxmox
  (VMware dopo, stesso schema). Nell'albero sta come uno switch: può avere collegamenti
  ridondanti verso più switch.
- **VM a richiesta**: il riquadro dice «N VM, M accese ▸»; «Mostra VM» lo espande con le VM
  (nome, ▶ accesa / ■ spenta, IP se noto); ogni VM col tasto destro si aggiunge alla mappa
  come oggetto. Le VM escono dal conteggio dei client della porta dello switch e da «Da
  sistemare»; un host o apparato che è una VM (stesso MAC o stesso nome) sta dentro il suo
  hypervisor.
- **Job «lettura hypervisor»** ogni giorno, spento di default, più «Aggiorna VM» col tasto
  destro: la scansione Proxmox esistente più le **schede vive** via SSH (`ip -j link`,
  velocità da `/sys/class/net`): MAC, stato, velocità, membri del bond. Con i MAC veri il
  sistema trova da solo le schede sugli switch (tabella MAC per porta) e propone i
  collegamenti, ridondanza compresa.

### 11.6 Tappe e livelli

| Tappa | Contenuto | Livello |
| --- | --- | --- |
| 0 · Correzione | un router non crea collegamenti da ciò che vede sul bridge (11.1) | leggero, rilascio subito |
| D · Raccolta | tipo e principale dei collegamenti nel DB; tipo di uplink UniFi; job «lettura hypervisor» con le schede vive | **completo** (schema, scritture a ogni lettura, nuovo tipo di job) |
| E · Motore | verifica dei collegamenti a mano, scelta del principale, attributi del collegamento, hypervisor e VM | leggero |
| F · Pagina | trascinamento, tasto destro, barra chiudibile, «Collega a…», VM espandibili, stile dei collegamenti | leggero |

**Rilasciato (14/10).** v0.3.279: tappa 0. v0.3.280: tappe D, E, F più la lettura delle porte
fisiche del router (§11.1 bis, Task 1b) e le correzioni della revisione finale. Cosa è stato
deciso strada facendo, e cosa resta aperto: `docs/adr/0010-topologia-fase2b-collegamenti-e-vm.md`.

## 12. Mappa verticale e stampa (14/10, decisioni con Riccardo)

Nasce da una domanda di Riccardo dopo il rilascio della 2b: «non avrebbe più senso una
rappresentazione verticale, se poi si deve andare in stampa? Le caselle sono più larghe che
alte». Le decisioni qui sotto **non si riaprono senza chiedere** e prevalgono sul §4-§5 e sul
§10 dove li contraddicono.

### 12.1 Cosa ha mostrato il dato vero (copie del 14/10, `scripts/misura-orientamento.ts`)

Oggi l'albero parte dall'alto e mette i figli **affiancati**: ogni fratello costa una larghezza
di riquadro (170-230 px), ogni livello solo un'altezza (44 px). La mappa automatica viene una
striscia:

| Mappa automatica | Oggi (dall'alto) | Da sinistra a destra (stima) |
| --- | --- | --- |
| cliente A (59 apparati, 24 AP, 7 livelli, 3 partenze) | 13.581 × 870 px | 2.617 × 2.462 px |
| hub (39 apparati, 5 livelli, 5 partenze) | 9.180 × 620 px | 1.582 × 2.386 px |
| cliente A, fogli A3 al 70 % | 7 (strisce) | 4 |
| cliente A, fogli A4 al 70 % | 10 | 6 |
| cliente A, «Adatta» su 1920 px | scala 0,14 (illeggibile) | larghezza piena a scala 0,73, poi si scorre |

### 12.2 L'orientamento

- **Due orientamenti**: **«Verticale»** (albero da sinistra a destra: un livello per colonna,
  i fratelli **impilati**; si legge dall'alto in basso come un elenco) e **«Orizzontale»** (quello
  di oggi). Nei dati: `lr` e `tb`.
- **Verticale è il predefinito** per tutte le mappe, anche quelle già salvate. Ogni mappa ricorda
  il suo orientamento (colonna `topology_maps.orientation`, per tutti quelli che la guardano: è
  una scelta di come si consegna la mappa, non una preferenza personale). L'automatica lo ricorda
  nella sua riga `auto`, che nasce alla prima scelta come per la testa.
- **Interruttore** nella barra della mappa: «Verticale | Orizzontale», a due voci con il testo
  (mai la sola icona); lo cambia un admin, gli altri vedono quello salvato.
- **Disposizione verticale** (stesse regole di oggi, ruotate):
  - colonna di un livello larga quanto il suo elemento più largo; fra due colonne 90 px (le
    linee e le etichette di porta e velocità);
  - un genitore a metà, in altezza, fra il primo e l'ultimo figlio;
  - gli **attaccati** in elenco **sotto** il riquadro (rientro 12 px), al massimo 4 più «+ altri N»;
  - gli **AP** senza figli in un blocco di **2 colonne** nella colonna dei figli;
  - un hypervisor espanso si allunga verso il basso con le VM in **2 colonne**;
  - più partenze una sotto l'altra, 60 px fra l'una e l'altra.
- **Linee**: in verticale escono dal **lato destro** del genitore ed entrano dal **lato sinistro**
  del figlio (a gradini, raggio 0); verso gli attaccati un tratto corto dal fondo del riquadro.
  Lo stile delle linee (§11.4) non cambia.
- **A schermo**: in verticale «Adatta» adatta **la larghezza** e porta in cima; la rotellina
  **scorre** in verticale (Ctrl/pizzico per lo zoom; i pulsanti di zoom restano). In
  orizzontale tutto come oggi.
- **Ritocchi a mano**: un ritocco vale **nell'orientamento in cui è fatto** (colonna
  `topology_position.orientation`; le righe di oggi valgono per `tb`). Cambiando orientamento la
  mappa si ridispone da sola e i ritocchi dell'altro restano da parte; un ritocco nuovo sullo stesso
  oggetto sostituisce il vecchio (una riga per mappa e oggetto). L'appartenenza alla mappa passo
  passo (`pinned = 0`) non dipende dall'orientamento.

### 12.3 La stampa

- Pulsante **«Stampa»** nella barra della mappa: apre `/topology/stampa?mappa=<id|auto>` in una
  scheda nuova, una pagina fatta per la carta (nessuna barra laterale), con **foglio** A4 o A3
  (predefinito **A3**) e **scala** 100 % o 80 % (predefinita **100 %**: a 80 % le scritte da 13 px
  restano sopra i 10 px). Orientamento del foglio scelto da solo (verticale od orizzontale, quello
  con meno fogli). Si stampa o si salva in PDF dal browser.
- **Disegno statico** (SVG, non React Flow) con le **stesse coordinate** della mappa a schermo
  (stessa disposizione, stesso orientamento, ritocchi compresi; VM chiuse, a meno di «con le VM»)
  e lo **stesso stile delle linee** (`edgeLook`), in bianco e nero leggibile: mai il solo colore.
- **Fogli**: il primo foglio ha nome della mappa, data e ora (ora italiana), legenda delle linee
  e la **panoramica** della mappa intera rimpicciolita, con la griglia dei fogli numerati
  («riga-colonna»). Gli altri sono **tasselli** della mappa alla scala scelta, con **15 mm di
  sovrapposizione** e in testa «Foglio 2-3 di 3×4», con le frecce ai fogli vicini. Un riquadro
  tagliato dal bordo di un foglio compare intero in un foglio vicino (la sovrapposizione è più
  larga del riquadro più alto).
- L'export drawio della tappa 5 userà le stesse coordinate; qui non si fa.

### 12.5 Linee più pulite e hypervisor sui core (14/10 pomeriggio, decisioni con Riccardo)

**Cosa ha mostrato il dato vero (copia del cliente A del 14/10).** Due switch centrali, quasi ogni
apparato collegato a entrambi: l'albero dà un solo padre, ogni secondo cavo diventa una linea
«ridondanza» che attraversa la mappa, ed è il groviglio. Gli hypervisor del cluster stavano sotto uno
switch di accesso, sulla porta 1G di gestione: sui centrali, dove arrivano i loro cavi 10G, passano
solo i MAC delle schede (sconosciuti finché `hypervisor_sync` non legge le schede vive) e delle VM; il
MAC di gestione mai. Ma le VM parlano chiaro: su una porta passavano 15 VM accese, **tutte** dello
stesso server; su un'altra 11, tutte di un altro. I cavi di riserva dei bond non portano VM e il LLDP
della scheda manda solo un MAC senza nome. Il nome DNS di due hypervisor non era quello del nodo
Proxmox (un nome vecchio rimasto nel DNS).

**Decisioni.**

- **Ridondanze a richiesta.** Si disegna solo il collegamento principale. Le ridondanze (tutti i
  collegamenti non principali: automatici, a mano, ripieghi) non si disegnano; il riquadro porta
  «⇄ N» (N = sue ridondanze, testo e simbolo, mai solo colore). Un clic sul riquadro mostra le sue
  ridondanze (stile di §11.4: doppia linea sottile + «ridondanza»); un interruttore «Mostra
  ridondanze» nella barra le mostra tutte (ricordato per chi guarda, `localStorage` in try/catch).
  Il dettaglio dell'oggetto le elenca sempre. In stampa non si disegnano: sul primo foglio un
  elenco «Cavi di ridondanza» (oggetto · porta → oggetto · porta, velocità). La disposizione non
  cambia: usa già solo i principali.
- **Hypervisor dalle VM sulla porta.** Una porta di bordo di uno switch o AP (non uplink, non
  porta di un collegamento fra apparati) su cui, entro la soglia «non visto», passano MAC di VM
  **accese** e **tutte** dello stesso hypervisor H (almeno 1) propone il collegamento porta ↔ H, fonte
  nuova `vm_mac` («dalle VM», in parole nei dettagli: «N VM di H passano da questa porta»). VM di due
  hypervisor sulla stessa porta = porta di passaggio: niente. Ogni MAC di VM sta su **una** porta,
  come i client (§10.5): fra le letture del suo ultimo giro (6 ore dalla più recente: la porta di
  prima di una migrazione non conta), la porta di un cavo già noto del suo hypervisor, poi quella
  con meno MAC distinti freschi, poi la lettura più recente (revisione finale del ramo, 14/10).
  «Ignora il collegamento…» vale anche per questa fonte. Resta valida l'esclusione delle VM dai
  client della porta. Si somma alle schede vive (§11.5), non le sostituisce: quando
  `hypervisor_sync` porterà i MAC delle schede, ogni cavo, anche di riserva, si troverà da solo.
- **Principale di un hypervisor.** Fra i collegamenti dai dati di un hypervisor vince il più
  veloce (velocità della porta dello switch); a parità, quello con più VM; poi le regole di §11.3.
  «★ Rendi principale» vince sempre. Così il cavo 10G verso il centrale è il principale e il 1G
  di gestione una ridondanza.
- **Nome dal Proxmox.** Se l'IP di un apparato hypervisor sta nelle schede di un host della
  scansione Proxmox e il nome di quell'host è diverso, sulla mappa il riquadro si chiama col nome
  del Proxmox e sotto, in piccolo, «DNS: <nome di prima>». Solo la mappa (e la stampa): l'inventario
  non si rinomina.

Tappa nuova **H2 · Dati della mappa** (leggero, logica pura): `vm_mac`, principale dell'hypervisor,
nome dal Proxmox. Le ridondanze a richiesta stanno nelle tappe I (schermo) e L (stampa).

### 12.4 Tappe e livelli

| Tappa | Contenuto | Livello |
| --- | --- | --- |
| G · Dati | `orientation` su `topology_maps` e `topology_position`, rotte | **completo** (schema dei DB clienti) |
| H · Disposizione | `layoutTree` verticale, logica pura | leggero |
| I · Pagina | interruttore, maniglie e linee ruotate, «Adatta» in larghezza, rotellina, ridondanze a richiesta (§12.5) | leggero |
| H2 · Dati della mappa | `vm_mac`, principale dell'hypervisor, nome dal Proxmox (§12.5) | leggero |
| L · Stampa | pagina di stampa, tasselli, panoramica, legenda, elenco delle ridondanze | leggero |

Rilascio unico con la misura sulle copie e la conferma di Riccardo (la migrazione tocca i DB dei
clienti).

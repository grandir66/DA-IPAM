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
| 2 · La mappa (**fatta (13/10), in attesa del rilascio; versione: vedi CHANGELOG**; progettata il 13/10, §10) | **A** raccolta dei MAC per porta + tabella delle mappe · **B** motore (identità, attaccati, albero, disposizione) · **C** pagina: «tutto automatico» e mappe «passo passo», icone, fascia degli attaccati, AP in fila, ritocchi, «Da sistemare». **Sostituisce la mappa di oggi** | A **completo** (schema, scritture a ogni lettura); B e C leggero |
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

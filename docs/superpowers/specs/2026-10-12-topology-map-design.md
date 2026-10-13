# Design — Mappa della topologia: sedi, albero, porte

> Spec di progettazione. **Versione 2, 2026-10-13** — riscrive da capo la versione
> del 12/10 (in git: il motore v1, React Flow + dagre, è sul `dev` dalla v0.3.260 e
> sul dato vero di DTS è risultato «orribile, linee a caso, caotico»). Stato:
> **approvata da Riccardo il 13/10** (piano della fase 1:
> `docs/superpowers/plans/2026-10-13-topologia-fase1-dati.md`). Decisioni prese con Riccardo il 13/10 in una sessione di
> progettazione con bozze sul dato vero della rete Domarc. È la **tappa 5** del piano
> `2026-10-12-piano-miglioramento-design.md`. ADR di riferimento: 0003 (resta valida
> la scelta di React Flow; la disposizione con dagre è superata da questa spec).

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
| 2 · L'albero della sede | livello 2 completo: icone, fascia degli attaccati, AP in fila, ritocchi, «Da sistemare». **Sostituisce la mappa di oggi** | leggero |
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

## 10. Input di Riccardo per la fase 2 (13/10 sera, da discutere prima del codice)

- **Mappa costruita un oggetto alla volta**: elenco degli oggetti → si inserisce l'oggetto scelto → si vede cosa gli è collegato → clic su un collegato per aggiungerlo; interruttore fra «tutto automatico» e «un oggetto alla volta». Caso d'uso: a DTS scegliere l'apparato principale e quello dell'altra sede, vedere i collegamenti fra i due e decidere cosa mostrare. Le scelte si possono salvare come correzioni (tabella `topology_link_overrides` / nodo nascosto).
- **Partire da un apparato qualunque, senza controller**: router o switch MikroTik, Cisco, HP (porte, tabella dei MAC per porta, vicini LLDP), o anche un server. LLDP/CDP/MNDP via SNMP/SSH sono già nel modello; manca la tabella dei MAC per porta (`mac_port_entries`) per gli attaccati, già prevista dalla fase 2.

---
percorso: /topology
titolo: Topologia — la mappa di come sono collegati gli apparati
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Disegna **come sono collegati fra loro** router, firewall, switch, access point e server: chi sta sopra a chi, su
quale porta, a che velocità. DA-IPAM la ricava da solo dalle informazioni che gli apparati si scambiano (LLDP, CDP,
uplink del controller UniFi, tabelle MAC), e la si può correggere e salvare a mano. Serve per capire dove si trova un
apparato, cosa si ferma se cade uno switch, dove manca un cavo di riserva.

Si arriva da **Network › Topologia**. In cima ci sono cinque schede: **Mappa** (questa pagina),
[Tavola di cablaggio](pagine/topology-tavola.md), [Porte](pagine/port-map.md), [Tabella ARP](pagine/arp-table.md) e
[Dati della mappa](pagine/topology-dati.md).

![La mappa della topologia](/manuale/topology/pagina.png)

## Le voci della pagina

1. **Elenco**: apre e chiude la colonna a sinistra con tutti gli oggetti divisi per tipo (Router e firewall, Switch,
   Access point, Server e attaccati…). Accanto a ognuno, **✓ nella mappa** dice che è già disegnato; per gli altri
   c'è **Aggiungi alla mappa**.
2. **Tutto automatico** / **Passo passo**: la mappa calcolata da DA-IPAM, oppure una mappa salvata e costruita a mano.
   In **Passo passo** compaiono il menu per scegliere la mappa salvata e i pulsanti **Nuova mappa…**, **Rinomina** ed
   **Elimina** (elimina la mappa e i suoi spostamenti, non gli apparati). Da quella automatica, **Crea una mappa passo
   passo da qui** ne fa una copia da ritoccare.
3. **Testa**: l'apparato da cui parte il disegno, di solito il router principale. «proposta dal sistema» vuol dire che
   l'ha scelta DA-IPAM; si cambia col tasto destro su un apparato, **Usa come testa**.
4. **Verticale** / **Orizzontale**: la direzione del disegno.
5. **Mostra ridondanze**: disegna anche i secondi cavi fra due apparati. Spenta, si vedono solo quelli del riquadro su
   cui fai clic. **Mostra tutti gli attaccati**: sotto ogni apparato mostra l'elenco intero degli oggetti collegati
   invece dei primi quattro e «+ altri N».
6. **Hypervisor come riquadri**: ogni hypervisor diventa un riquadro della mappa, anche se le sue macchine virtuali non
   sono state lette.
7. I pulsanti di vista: **−** e **+** rimpiccioliscono e ingrandiscono, **Adatta** fa stare la mappa nel riquadro,
   **Riordina** toglie gli spostamenti fatti a mano. **Stampa** apre la mappa pronta per la carta (A4 o A3, su più
   fogli; serve una mappa salvata). **draw.io** scarica la mappa come documento modificabile in diagrams.net.
8. **Cerca nome, IP o alias…**: trova un oggetto nell'elenco.

## Come leggere la mappa

- Ogni riquadro è un apparato: nome, indirizzo e, se c'è, quanti client ha. Il numero con le due frecce dice quanti
  apparati sono collegati sotto.
- Le linee sono i cavi: sopra c'è la velocità (**1G**, **10G**, **50G · 2 cavi**) e le porte ai due capi (per esempio
  «Port 28 → SFP+ 1»). Una linea spessa è un collegamento aggregato.
- Sotto uno switch, l'elenco grigio sono gli host attaccati (server, NAS…).
- **cavo giù** con la linea tratteggiata e il riquadro col bordo rosso e il triangolo: il collegamento c'era ma ora la
  porta è giù, o l'apparato non risponde.
- Il riquadro grigio **N AP** raccoglie gli access point.

Un clic su un riquadro apre a destra i **dettagli**: porte, collegamenti e da quale fonte sono stati visti. Il **tasto
destro** su un apparato apre: **Dettagli**, **Collega a…** (un cavo a mano), **Usa come testa**, **Usa come partenza**,
**Ruolo nella mappa**, **Unisci con…** e **Separa…** (quando lo stesso apparato compare due volte o due apparati sono
stati confusi), **Promuovi ad apparato**, **Modifica porte…**, **Togli dalla mappa**. Il tasto destro su una linea
permette di togliere un collegamento messo a mano. Trascinando un riquadro lo si sposta con i suoi attaccati; con il
tasto Maiusc premuto si porta dietro tutto il ramo.

Le modifiche (collegamenti, ruoli, mappe salvate) le fa chi ha il ruolo di amministratore; gli altri vedono la mappa.

## Come si usa

1. Per trovare un apparato scrivilo in **Cerca** o scorri l'**Elenco** e cliccalo.
2. Per vedere il percorso di un cavo segui la linea: le porte sono scritte ai due capi.
3. Se un collegamento manca o è sbagliato, passa a **Passo passo**, crea una mappa e correggila col tasto destro.
4. Per una copia su carta salva la mappa e premi **Stampa**.

## Cosa vogliono dire i segni

- **✓ nella mappa**: l'oggetto è disegnato.
- Linea **continua**: cavo attivo. Linea **tratteggiata** con **cavo giù**: cavo visto ma oggi spento.
- Triangolo **▲** sul riquadro: apparato con un problema (non risponde o non letto).
- «⚠ mappa di prima»: la mappa nuova non si è potuta calcolare e si vede l'ultima riuscita; **Riprova** la ricalcola.

## Da dove arrivano i dati

Dalle letture degli apparati gestiti: vicini LLDP e CDP, uplink del controller UniFi, tabelle MAC degli switch,
macchine virtuali degli hypervisor, collegamenti messi a mano. I conteggi per fonte stanno in
[Dati della mappa](pagine/topology-dati.md).

## Se la pagina è vuota

Servono apparati gestiti con le credenziali giuste (SNMP o API) che dicano chi hanno vicino: si promuovono con **Rendi
apparato** e si collega il controller in [Controller di rete](pagine/controllers.md). Senza vicini noti gli apparati
restano nell'elenco ma non hanno linee.

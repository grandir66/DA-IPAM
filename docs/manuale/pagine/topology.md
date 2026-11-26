---
percorso: /topology
titolo: Topologia — la mappa di come sono collegati gli apparati
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Disegna **come sono collegati fra loro** router, firewall, switch, access point e server: chi sta sopra a chi, su
quale porta, a che velocità. DA-IPAM la ricava da solo dalle informazioni che gli apparati si scambiano (LLDP, CDP,
uplink del controller UniFi, tabelle MAC), e la si può correggere e salvare a mano. Serve per capire dove si trova un
apparato, cosa si ferma se cade uno switch, dove manca un cavo di riserva.

Si arriva da **Network › Topologia**. In cima ci sono cinque schede: **Mappa** (questa pagina),
[Tavola di cablaggio](pagine/topology-tavola.md), [Porte](pagine/port-map.md), [Tabella ARP](pagine/arp-table.md) e
[Dati della mappa](pagine/topology-dati.md). Menu e schede funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md).

## La barra della mappa

![La barra della mappa](/manuale/topology/barra.png)

1. **Elenco ▸** / **◂ Elenco**: apre e chiude la colonna a sinistra con tutti gli oggetti (vedi [L'elenco](#elenco)).
2. **Tutto automatico** / **Passo passo**: la mappa calcolata da DA-IPAM, oppure una mappa salvata e costruita a mano.
   Il pallino ● indica quella scelta.
   - In **Tutto automatico** un amministratore vede **Crea una mappa passo passo da qui**, che ne fa una copia da
     ritoccare.
   - In **Passo passo** compaiono il menu **Mappa** per scegliere la mappa salvata («Nessuna mappa salvata» se non ce
     ne sono) e, per l'amministratore, **Nuova mappa…**, **Rinomina** ed **Elimina** (toglie la mappa e i suoi
     spostamenti, non gli apparati).
3. **Testa**: l'apparato da cui parte il disegno, di solito il router principale. «proposta dal sistema» vuol dire che
   l'ha scelta DA-IPAM; l'amministratore la cambia col tasto destro su un apparato, **Usa come testa**.
4. **Verticale** / **Orizzontale**: la direzione del disegno.
5. **Mostra ridondanze**: disegna anche i secondi cavi fra due apparati; spenta, si vedono solo quelli del riquadro su
   cui fai clic. Accanto, **Mostra tutti gli attaccati**: sotto ogni apparato l'elenco intero degli oggetti collegati
   invece dei primi quattro e «+ altri N».
6. **Hypervisor come riquadri**: ogni hypervisor diventa un riquadro della mappa, anche se le sue macchine virtuali non
   sono state lette.
7. I pulsanti di vista: **−** e **+** rimpiccioliscono e ingrandiscono, **Adatta** fa stare la mappa nel riquadro
   (in verticale: tutta la larghezza, poi si scorre con la rotellina). L'amministratore vede anche **Riordina**, che
   toglie gli spostamenti fatti a mano.
8. **Stampa** apre in una scheda nuova la mappa pronta per la carta (A4 o A3, su più fogli; serve una mappa salvata:
   altrimenti è spento). **draw.io** scarica la mappa come documento modificabile in diagrams.net.

In fondo alla barra, **◂ Dettagli** / **Dettagli ▸** apre e chiude la colonna dei [dettagli](#dettagli) a destra.

## Come leggere la mappa

![Un pezzo della mappa](/manuale/topology/mappa.png)

- Ogni riquadro è un apparato: icona del tipo, nome, indirizzo. Il numero con `icona:arrow-left-right` dice quanti
  apparati sono collegati sotto.
- Le linee sono i cavi: sopra c'è la velocità (**1G**, **10G**, **50G · 2 cavi**) e le porte ai due capi (per esempio
  «sfp28-1 → SFP28 32»). Una linea spessa è un collegamento aggregato.
- Sotto uno switch, l'elenco grigio sono gli host attaccati (server, NAS…).
- **cavo giù** con la linea tratteggiata e il riquadro col bordo rosso e il triangolo: il collegamento c'era ma ora la
  porta è giù, o l'apparato non risponde.
- Il riquadro grigio **N AP** raccoglie gli access point.

Trascinando un riquadro lo si sposta con i suoi attaccati; con il tasto **Maiusc** premuto si porta dietro tutto il
ramo. Gli spostamenti restano solo nelle mappe salvate.

## L'elenco degli oggetti {#elenco}

![L'elenco degli oggetti](/manuale/topology/elenco.png)

`icona:search` **Cerca nome, IP o alias…** trova un oggetto. Sotto, gli oggetti divisi per tipo (Router e firewall,
Switch, Access point, Server e attaccati…), ogni gruppo col numero e `icona:chevron-down` per chiuderlo. **✓ nella
mappa** dice che l'oggetto è già disegnato; un clic lo trova sulla mappa. In **Passo passo**, su una mappa salvata,
l'amministratore trascina gli oggetti sulla mappa o li aggiunge col tasto destro › **Aggiungi alla mappa**.

## Il tasto destro su un apparato

![Il tasto destro su un apparato](/manuale/topology/tasto-destro.png)

In cima c'è il nome dell'apparato. Chi è in **sola lettura** vede **Dettagli** e, sugli hypervisor, **Mostra VM (N)**
/ **Nascondi VM**.

Un **amministratore** vede in più:

- in **Passo passo**, su una mappa salvata: **Aggiungi collegati (N)** › (spunta quali), **Usa come partenza** e
  **Togli dalla mappa**, che cambiano solo il disegno di quella mappa;
- **Aggiorna VM** (sugli hypervisor): rilegge le macchine virtuali;
- **Collega a…**: disegna un cavo a mano verso un altro apparato;
- **Usa come testa** (nella mappa automatica);
- **Ruolo nella mappa** ›: Apparato di rete, Core, Accesso, Attaccato (server, PC), Decide il sistema;
- **Nascondi da tutte le mappe** / **Rimostra in tutte le mappe**;
- **Unisci con…** e **Separa…**: quando lo stesso apparato compare due volte o due apparati sono stati confusi;
- **Promuovi ad apparato**: per un host che è infrastruttura di rete.

### Il tasto destro su una linea

Solo per l'amministratore: **Modifica porte…** e **Rimuovi il collegamento a mano** (sui cavi messi a mano),
**★ Rendi principale** / **★ Fissa come principale** / **Togli la scelta del principale** (quale cavo disegnare quando
ce n'è più d'uno), **Ignora questo cavo…** (la linea sparisce da tutte le mappe; si ripristina da
[Dati della mappa](pagine/topology-dati.md)).

## I dettagli di un oggetto {#dettagli}

![I dettagli di un apparato](/manuale/topology/dettagli.png)

Un clic su un riquadro apre a destra i dettagli: tipo, stato (✓ raggiungibile), come si annuncia, l'indirizzo, e
**Collegato a (N)**: per ogni collegamento l'**oggetto**, le **porte** ai due capi, la **fonte** (LLDP, uplink del
controller, tabella MAC…), da quando è visto, la velocità e se è il cavo principale. **Perché questo cavo** spiega la
scelta; **Altri cavi visti fra questi due oggetti** e **Candidati per porta** mostrano le alternative. `icona:x`
chiude i dettagli.

## Come si fa

- **Trovare un apparato sulla mappa**: scrivilo in **Cerca** nell'elenco e cliccalo.
- **Seguire il percorso di un cavo**: segui la linea, le porte sono scritte ai due capi; per le prove apri i dettagli.
- **Correggere un collegamento sbagliato**: l'amministratore passa a **Passo passo**, **Crea una mappa passo passo da
  qui**, poi col tasto destro **Collega a…** o, sulla linea sbagliata, **Ignora questo cavo…**.
- **Mettere il router giusto in cima**: tasto destro sul router › **Usa come testa**.
- **Portare la mappa in riunione**: salva una mappa passo passo, poi **Stampa** (A4 o A3) oppure **draw.io** per
  ritoccarla.
- **Vedere cosa si ferma se cade uno switch**: guarda il numero con `icona:arrow-left-right` sul suo riquadro e gli
  attaccati sotto.

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
apparato** fra gli [Apparati](pagine/discovery.md) e si collega il controller in
[Controller di rete](pagine/controllers.md). Senza vicini noti gli apparati restano nell'elenco ma non hanno linee.

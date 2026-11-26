---
percorso: /topology/dati
titolo: Dati della mappa — da cosa è fatta la topologia
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È la pagina **tecnica** della [Topologia](pagine/topology.md): non disegna niente, ma dice con quali numeri e da quali
fonti è costruita la mappa, cosa le manca e cosa è stato scartato. Serve quando la mappa sembra sbagliata o
incompleta, per capire se mancano letture, se un apparato non ha la sede, se due host sono stati fusi per errore.

Si arriva da **Network › Topologia**, scheda **Dati della mappa** in cima (le altre schede:
[Mappa](pagine/topology.md), [Tavola di cablaggio](pagine/topology-tavola.md), [Porte](pagine/port-map.md),
[Tabella ARP](pagine/arp-table.md)). Menu e schede funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md). La pagina è fatta di riquadri, uno sotto l'altro.

## Numeri

![Il riquadro Numeri](/manuale/topology-dati/numeri.png)

- **Apparati**, **Nodi** (tutti gli oggetti disegnabili, host compresi), **Collegamenti**, divisi in **fra apparati**
  e **verso host attaccati**.
- I collegamenti per fonte: **fonte a mano**, **fonte uplink UniFi** (dal controller), **fonte LLDP** e **fonte CDP**
  (i protocolli con cui gli apparati dicono chi hanno vicino), **fonte annuncio di rete (MNDP o CDP)** (sentiti dalla
  sonda), **fonte tabella MAC** (dedotti dai MAC sulle porte), **fonte dalle VM** (macchine virtuali sugli
  hypervisor). Una fonte a zero vuol dire che quella lettura non porta niente: per esempio LLDP spento sugli switch.
- **Non visti da più di N giorni**: collegamenti che non si vedono da più giorni della soglia.
- **Vicini non abbinati**: apparati annunciati da un vicino ma che DA-IPAM non riesce ad abbinare a un oggetto noto.
- **Apparati isolati**: apparati senza nessun collegamento.
- **Host fusi negli apparati**, **Host fusi fra loro**: quante volte DA-IPAM ha riconosciuto lo stesso oggetto su più
  righe e le ha unite.
- **Apparati senza sede**, **Sedi con testa** (sedi per cui c'è l'apparato da cui parte il disegno).
- **Proposte «promuovi ad apparato»**: host che sembrano apparati di rete ma non sono ancora gestiti.
- **Tipi sospetti** e **«Da sistemare»: senza prove di ruolo**: apparati il cui tipo non torna con quello che si vede.

## Sedi

![Il riquadro Sedi](/manuale/topology-dati/sedi.png)

Per ogni **Sede** la **Testa** (l'apparato da cui parte il disegno, «proposta» dal programma o «scelta» a mano, oppure
«nessuna») e quanti **Nodi** ha. Sotto:

1. **Soglia «non visto» (giorni)**: dopo quanti giorni (da 1 a 30, di serie 2) un collegamento non più visto si
   considera da verificare.
2. **Salva**: salva la soglia; accanto compare l'esito. Cambia un'impostazione dell'istanza: lo fa un
   **amministratore**.

## Gli altri riquadri

Scorrendo, nell'ordine:

- **Lettura degli hypervisor**: lo stato della lettura delle macchine virtuali dagli hypervisor.
- **Letture in più per la mappa**: le letture del nuovo modo di calcolare la mappa, per apparato. Sono accese di
  serie, in sola lettura: la mappa non cambia finché non si accende la mappa nuova.
- **Mappa nuova (una linea per cavo)**: che cosa cambia con la mappa nuova; si accende e si spegne da
  [Opzioni](pagine/settings-opzioni.md), qui c'è il rimando.
- **Anomalie della rete**, con la mappa nuova accesa: collegamenti che non hanno senso (per esempio un core che esce
  da uno switch di accesso). «Nessuna anomalia» se va tutto bene.
- **Differenze fra la mappa nuova e quella di prima** (solo amministratori): **Calcola** / **Ricalcola** fa un calcolo
  in memoria, senza cambiare la mappa, e dice quali oggetti cambierebbero padre e quali anomalie vanno guardate a mano.
  Serve a decidere quando accendere la mappa nuova.
- **Proposte «promuovi ad apparato»**, **Apparati senza sede**, **Tipi sospetti**, **Collegamenti ignorati**,
  **Collegamenti non visti**: gli elenchi, spiegati sotto.

Ogni elenco mostra le prime righe; «+ altri N» dice quante ne restano.

### Proposte «promuovi ad apparato»

![Le proposte di promozione](/manuale/topology-dati/proposte.png)

Host che dalle letture sembrano apparati di rete: **Nome**, **IP**, **Classificazione**, quanti **Collegamenti** ha
e 1. **Promuovi**, che apre la sua [scheda](pagine/objects-id.md) con la finestra di promozione già aperta.

### Apparati senza sede e Tipi sospetti

**Nome**, **Tipo**, **IP** e **Apri**, che porta alla scheda del dispositivo, dove si sceglie la sede o si corregge il
tipo.

### Collegamenti ignorati

Le linee viste dalle letture ma tolte a mano dalla mappa: **Da** e **Porta**, **A** e **Porta**, **Stato**,
**Ignorato da**, **Quando**. Un amministratore vede in fondo alla riga **Ripristina** (la linea torna sulla mappa);
se la correzione non corrisponde più a un cavo visto, **Togli la correzione** e **Scegli il cavo da ignorare…**, che
apre una finestra coi cavi visti fra i due oggetti: quello scelto sparisce dalle mappe. Chi è in sola lettura vede
l'elenco con la scritta che solo un amministratore può ripristinare.

### Collegamenti non visti

**Da**, **A** (con la porta fra parentesi), **Fonte** e **Stato** («non visto da N g»): i collegamenti che le letture
non trovano più da più giorni della soglia.

## Come si fa

- **La mappa ha pochi collegamenti**: guarda le righe **fonte …** in Numeri: quella a zero dice quale lettura manca
  (per esempio LLDP spento sugli switch, o controller non collegato in [Controller di rete](pagine/controllers.md)).
- **Un apparato non compare dove dovrebbe**: cercalo in **Apparati isolati** o **Apparati senza sede**; da **Apri**
  gli dai la sede.
- **Un apparato di rete è disegnato come semplice host**: **Promuovi** dalla sua riga nelle proposte.
- **Un cavo tolto per errore dalla mappa**: in **Collegamenti ignorati** l'amministratore preme **Ripristina**.
- **Troppi collegamenti «da verificare»**: alza la **Soglia «non visto»** (per esempio a 7 giorni se alcuni apparati
  si spengono nel fine settimana) e **Salva**.

## Da dove arrivano i dati

Dagli stessi collegamenti della [Topologia](pagine/topology.md): letture LLDP e CDP, controller UniFi, tabelle MAC,
sonda trunk, hypervisor, collegamenti a mano.

## Se la pagina è vuota

Con tutti i numeri a zero non ci sono ancora apparati gestiti: si promuovono dalla
[pagina di una subnet](pagine/networks-id.md) o dalla [scheda dell'oggetto](pagine/objects-id.md).

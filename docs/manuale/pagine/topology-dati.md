---
percorso: /topology/dati
titolo: Dati della mappa — da cosa è fatta la topologia
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la pagina **tecnica** della [Topologia](pagine/topology.md): non disegna niente, ma dice con quali numeri e da quali
fonti è costruita la mappa, cosa le manca e cosa è stato scartato. Serve quando la mappa sembra sbagliata o
incompleta, per capire se mancano letture, se un apparato non ha la sede, se due host sono stati fusi per errore. Si
arriva da **Network › Topologia**, scheda **Dati della mappa** in cima.

![La pagina Dati della mappa](/manuale/topology-dati/pagina.png)

## Le voci della pagina

**Numeri**, a sinistra:

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
- **Apparati senza sede**, **Sedi con testa** (sedi per cui è stato scelto l'apparato da cui parte il disegno).
- **Proposte «promuovi ad apparato»**: host che sembrano apparati di rete ma non sono ancora gestiti.
- **Tipi sospetti** e **«Da sistemare»: senza prove di ruolo**: apparati il cui tipo non torna con quello che si vede.

**Sedi**, a destra: per ogni sede la **Testa** scelta e quanti **Nodi** ha. Sotto, **Soglia «non visto» (giorni)**
con **Salva**: dopo quanti giorni un collegamento non più visto si considera da verificare (di serie 2).

Più in basso, scorrendo:

- **Lettura degli hypervisor**: lo stato della lettura delle macchine virtuali dagli hypervisor.
- **Letture in più per la mappa** e **Mappa nuova (una linea per cavo)**: il nuovo modo di calcolare la mappa, che
  legge di più e disegna un cavo per linea. Le letture sono accese in sola lettura; la mappa non cambia finché non si
  accende la mappa nuova.
- **Anomalie della rete**: collegamenti che non hanno senso (per esempio un core che esce da uno switch di accesso).
- **Differenze fra la mappa nuova e quella di prima** (solo amministratori): un calcolo in memoria che dice quali cavi
  cambierebbero, per decidere quando accendere la mappa nuova.
- **Proposte «promuovi ad apparato»**: l'elenco con **Nome**, **Classificazione**, **Collegamenti** e il pulsante
  **Promuovi**.
- **Apparati senza sede** e **Tipi sospetti**: gli elenchi, con **Apri** per andare alla scheda.
- **Collegamenti ignorati**: le linee viste dalle letture ma tolte a mano dalla mappa, con chi le ha ignorate.
- **Collegamenti non visti**: **Da**, **A**, **Fonte**, **Stato**.

Promuovere, salvare la soglia e ignorare collegamenti spetta a chi ha il ruolo di amministratore.

## Come si usa

1. Se la mappa ha pochi collegamenti, guarda le righe **fonte …**: quella a zero dice quale lettura manca.
2. Se un apparato non compare dove dovrebbe, cercalo in **Apparati isolati** o **Apparati senza sede**.
3. Se un apparato di rete è disegnato come semplice host, promuovilo da **Proposte «promuovi ad apparato»**.

## Da dove arrivano i dati

Dagli stessi collegamenti della [Topologia](pagine/topology.md): letture LLDP e CDP, controller UniFi, tabelle MAC,
sonda trunk, hypervisor, collegamenti a mano.

## Se la pagina è vuota

Con tutti i numeri a zero non ci sono ancora apparati gestiti: si promuovono dalla
[pagina di una subnet](pagine/networks-id.md) o dalla [scheda dell'oggetto](pagine/objects-id.md).

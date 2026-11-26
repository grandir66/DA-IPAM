---
percorso: /port-map
titolo: Mappa porte — cosa c'è in rete e su quale porta sta
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Risponde alla domanda **«dove è attaccato?»**: per ogni oggetto visto in rete dice su quale switch e su quale porta
sta, con quanta certezza, e da quali prove lo si sa. Mostra anche ogni porta degli apparati con cosa c'è sopra, e le
rotte dei router. Serve per trovare un PC sul patch panel, per capire cosa c'è dietro una porta, per accorgersi di uno
switch non gestito nascosto sotto una scrivania.

Si arriva da **Network › Topologia**, scheda **Porte** in cima. Le altre schede della sezione sono
[Mappa](pagine/topology.md), [Tavola di cablaggio](pagine/topology-tavola.md), [Tabella ARP](pagine/arp-table.md) e
[Dati della mappa](pagine/topology-dati.md). Menu, schede e tabelle funzionano come in tutte le pagine: vedi le
[parti comuni dell'interfaccia](../INTERFACCIA.md). La pagina è tutta in lettura.

## Il calcolo e i numeri

![Il calcolo e le tessere](/manuale/port-map/calcolo.png)

1. **Calcolo**: se il calcolo delle posizioni è **acceso** e quando è stato fatto l'ultimo. Accanto: quanti apparati
   hanno una tabella MAC letta, quanti oggetti si conoscono **solo dal controller** e quanti MAC sono **senza host
   noto**.
2. **Le quattro tessere** contano le posizioni per certezza:
   - **Certe**: lo dice il controller, o è l'unico MAC sulla porta;
   - **Spiegate**: porta condivisa con un motivo (un hypervisor, un telefono con il PC dietro);
   - **Da capire**: più MAC sulla stessa porta senza motivo (forse uno switch non gestito, o due porte insieme);
   - **Non so**: visto solo sulle porte di passaggio fra switch: si sa il ramo, non la porta.

## Le viste e i filtri

![Le viste e i filtri](/manuale/port-map/filtri.png)

1. **Le viste**: **Oggetti** (ogni cosa vista in rete e dove sta), **Porte** (ogni porta, aggregato e cosa ha
   sopra), **Rotte** (le rotte di tutti i router, comprese quelle non più viste). Sotto, una riga dice cosa mostra la
   vista scelta; accanto al titolo del riquadro, quante righe ci sono.
2. `icona:search` **Cerca**: negli Oggetti nome, IP, MAC o porta; nelle Porte porta, apparato, vicino; nelle Rotte
   destinazione, gateway, interfaccia.
3. **Le tendine**: **Tutti gli apparati** (un apparato solo), **Tutte le VLAN** e **Ogni confidenza** (solo Oggetti),
   **Ogni tipo di porta** (Di passaggio, Hypervisor, Terminale, Telefono + PC, Condivisa, Wifi, Vuota; non nelle
   Rotte), **Ogni modo** (Accesso, Trunk, Non letto; solo Porte).
4. **Le spunte**: negli Oggetti **Senza host** (MAC che non corrispondono a nessun host), **Spostati** (cambiati di
   porta di recente) e **Solo visti di recente**; nelle Porte **Libere**.

## La vista Oggetti

![La vista Oggetti](/manuale/port-map/oggetti.png)

1. **Dove**: apparato e porta; oppure «Visto da» (lo conosce solo un router, dalla tabella ARP) o «Solo su porte di
   passaggio (N)».
2. **Confidenza**: il segno della certezza di quella posizione (vedi [i segni](#segni)).

| Colonna | Che cosa dice |
|---|---|
| **Oggetto** | Il nome, con il tipo sotto; «non più visto» se da un po' non compare nelle tabelle. «Sconosciuto» se non ha nome. |
| **MAC** | L'indirizzo della scheda di rete. |
| **IP** | L'indirizzo; **+3** vuol dire altri tre indirizzi. |
| **Dove** | Apparato e porta. |
| **VLAN** | La VLAN in cui è stato visto. |
| **Confidenza** | Certa, Spiegata, Da capire, Non so. |
| **Visto** | Quando (solo su schermi larghi). |

Ogni intestazione con `icona:arrow-up-down` ordina con un clic. In fondo **Precedenti** e **Successivi** sfogliano a
cento righe per volta; sotto c'è la legenda dei segni. Se su una porta passano troppi oggetti, una riga sopra la
tabella dice che si vedono solo i più recenti.

### Il dettaglio della posizione

![Il dettaglio della posizione](/manuale/port-map/dettaglio.png)

Un clic su una riga apre a destra il dettaglio: **Perché** (la spiegazione in parole), **Confidenza**, **Dove**,
**MAC**, **IP**, **Fonti** (SNMP, controller, ARP, LibreNMS…). I pulsanti portano alla **Scheda host**, alla **Scheda
apparato**, allo switch dove sta e alla [Topologia](pagine/topology.md). Sotto:

- **Prove**: ogni porta dove è stato visto, con **Tipo** di porta, quanti **MAC** passano su quella porta e la
  **Fonte**; passa il mouse su una riga per sapere quando;
- **Spostamenti**: i cambi di porta degli ultimi 90 giorni.

Si chiude con `icona:x`, con **Esc** o con un clic fuori.

## La vista Porte

![La vista Porte](/manuale/port-map/porte.png)

Ogni riga è una porta di un apparato: **Apparato** (un clic apre la sua scheda), **Porta** (con le porte membre se è
un aggregato, e ✕ **STP bloccata** se lo spanning tree la tiene chiusa), **Stato**, **Tipo** (passa il mouse per il
motivo), **Modo** (Accesso, Trunk, Non letto), **PVID** (la VLAN non taggata), **Tagged** (le VLAN taggate),
**Velocità**, **PoE**, **Vicino** (l'apparato dall'altra parte, letto con LLDP o CDP) e **MAC** (quanti indirizzi ci
passano). «≈» davanti a un dato vuol dire dedotto: lo switch non dichiara le VLAN in modo completo. «Non letto»:
l'apparato non dà quel dato.

## La vista Rotte

Le rotte di tutti i router: **Apparato**, **Destinazione**, **Gateway**, **Interfaccia**, **Protocollo**, **Metrica**
e **Stato**: ● **attiva**, ○ **inattiva**, ◌ **non più vista** (passa il mouse per l'ultima lettura).

## Come si fa

- **Trovare dove è attaccato un PC**: scrivi nome o MAC in `icona:search` **Cerca** e leggi **Dove**.
- **Una porta Da capire**: apri la riga e guarda le **Prove**: più oggetti sulla stessa porta di solito vogliono dire
  un piccolo switch sotto la scrivania o un telefono con il PC dietro.
- **Trovare una porta libera su uno switch**: vista **Porte**, **Tutti gli apparati** › quello switch, spunta
  **Libere**.
- **Vedere cosa si è spostato di recente**: vista **Oggetti**, spunta **Spostati**, poi apri le righe per la storia.
- **MAC che nessuno conosce**: spunta **Senza host**: sono apparati che passano sugli switch ma non rispondono alle
  scansioni.
- **Controllare i trunk e le VLAN di uno switch**: vista **Porte**, l'apparato, **Ogni modo** › Trunk.

## Cosa vogliono dire i segni {#segni}

- **● Certa**: lo dice il controller, oppure è l'unico MAC sulla porta.
- **◐ Spiegata**: porta condivisa per un motivo noto.
- **○ Da capire**: più MAC senza motivo.
- **✕ Non so**: visto solo su porte di passaggio.
- **non più visto** sotto il nome dell'oggetto: non compare più nelle tabelle da un po'.

## Da dove arrivano i dati

Dalle tabelle MAC degli switch gestiti, dal controller UniFi o Omada, dalla tabella ARP dei router per abbinare MAC e
indirizzi, dagli hypervisor per le macchine virtuali, dai vicini LLDP e CDP per riconoscere le porte di passaggio.

## Se la pagina è vuota

«Nessuna riga»: con dei filtri attivi, toglili. Dopo un'installazione nuova serve un giro sugli switch: gli switch
vanno resi apparati con credenziali SNMP o API, e il controller collegato in [Controller di rete](pagine/controllers.md).

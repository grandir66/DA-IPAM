---
percorso: /network-changes, /networks/[id]/changes
titolo: Cambiamenti — cosa è cambiato in rete
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È il registro di **tutto ciò che cambia nel tempo** nelle reti dell'istanza: oggetti mai visti prima, apparati nuovi,
indirizzi che cambiano, MAC sostituiti, apparati spostati da una porta dello switch a un'altra, porte nuove aperte,
annunci sentiti dalla sonda trunk. Ogni riga è un cambiamento, con il prima e il dopo. Si guarda per accorgersi di un
apparato sconosciuto entrato in rete o di qualcosa spostato senza dirlo, e lo si segna **Visto** una volta controllato.

Si arriva da **Network › Apparati**, scheda **Cambiamenti** in cima. Il numero rosso accanto ad «Apparati» nel menu
conta i cambiamenti ancora da vedere. Il vecchio indirizzo dei cambiamenti di una singola subnet
(`/networks/<id>/changes`) porta qui.

![La pagina Cambiamenti](/manuale/network-changes/pagina.png)

## Le voci della pagina

1. **I tipi di cambiamento**: **Tutti** e poi un pulsante per tipo, col numero:
   - **Oggetti nuovi**: un indirizzo o un MAC mai visto prima.
   - **Apparati nuovi**: un oggetto diventato apparato gestito (router, switch, server…).
   - **Cambi di IP**: lo stesso apparato ha cambiato indirizzo.
   - **MAC cambiato**: sullo stesso indirizzo ora risponde una scheda di rete diversa.
   - **Spostamenti di porta**: un apparato ora è attaccato a un'altra porta dello switch.
   - **Porte nuove**: un servizio nuovo aperto su un apparato (per esempio una porta web che prima non c'era).
   - **Dalla sonda trunk**: cambiamenti sentiti dalla sonda in ascolto sulla linea fra gli switch.
   Il tipo si riconosce dall'icona e dal nome. Un clic mostra solo quel tipo.
2. **Periodo**: **Ultime 24 ore**, **Ultimi 7 giorni** (di serie), **Ultimi 30 giorni**, **Ultimi 90 giorni**.
3. **Stato**: **Da vedere** (di serie, solo quelli che nessuno ha ancora segnato), **Visti**, **Tutti**.
4. **Mostra anche il rumore**: di serie la pagina nasconde i cambiamenti che non dicono niente (per esempio i MAC che
   si spostano sulle porte di collegamento fra due apparati). Il numero fra parentesi dice quanti sono nascosti.
   Spunta la casella per vederli: sotto la riga c'è scritto il motivo per cui è rumore.
5. **Disponibilità e latenza anomale**: apre la pagina delle [Anomalie](pagine/analytics.md), con gli host che
   rispondono meno o più lentamente del solito.

Il menu **Tutte le subnet** sceglie una rete sola. Dopo aver cambiato periodo, subnet, stato o rumore premi **Filtra**
per applicare la scelta.

Le colonne:

- **Quando**: data e ora del cambiamento.
- **Tipo**: icona e nome del tipo.
- **Oggetto**: il nome o l'indirizzo; un clic apre la [scheda dell'oggetto](pagine/objects-id.md).
- **IP**, **Subnet**: dove è successo. Un clic sulla subnet apre la sua [pagina](pagine/networks-id.md).
- **Prima**, **Dopo**: il valore vecchio e quello nuovo (per esempio il MAC di prima e quello di adesso, con il
  produttore).
- **Stato**: **Da vedere**, oppure «Visto», chi l'ha segnato e quando. Chi ha il ruolo di amministratore vede qui il
  pulsante **Visto** per segnarlo.

In fondo **Precedente** e **Successiva** sfogliano le pagine, cinquanta righe per volta.

Nella scheda **Porte nuove** l'amministratore vede anche l'interruttore del **giro notturno delle porte** (**Accendi**
/ **Spegni**): è l'unica fonte di quelle righe, e nasce spento. Accanto c'è l'ora dell'ultimo giro e la rete che verrà
provata la notte successiva.

## Come si usa

1. Apri la pagina con lo stato **Da vedere**: sono i cambiamenti che nessuno ha ancora controllato.
2. Scegli un tipo, per esempio **Oggetti nuovi**, per guardare una cosa alla volta.
3. Per ogni riga apri l'oggetto e capisci se è normale (un telefono nuovo, un PC riacceso) o no.
4. Quando l'hai controllato premi **Visto**: la riga esce da «Da vedere» e il numero nel menu scende.

## Cosa vogliono dire i segni

- **+** oggetto nuovo, **server** apparato nuovo, **due frecce** cambio di IP, **impronta** MAC cambiato, **spina**
  spostamento di porta, **porta** porta nuova, **onde** sonda trunk.
- «Rumore: …» sotto una riga: il cambiamento è stato giudicato non significativo, e c'è scritto perché.

## Da dove arrivano i dati

Dalle scansioni delle reti, dalle tabelle ARP e MAC di router e switch, dal giro notturno delle porte e dalla sonda
trunk. Ogni giro confronta quello che vede con quello che sapeva e scrive qui le differenze.

## Se la pagina è vuota

«Niente da vedere» vuol dire che tutti i cambiamenti del periodo sono già stati segnati: scegli **Tutti** nello stato
o allarga il periodo. «Nessun cambiamento» vuol dire che nel periodo non è cambiato niente. La scheda **Porte nuove**
resta vuota finché il giro notturno delle porte è spento.

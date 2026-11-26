---
percorso: /network-changes, /networks/[id]/changes
titolo: Cambiamenti — cosa è cambiato in rete
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È il registro di **tutto ciò che cambia nel tempo** nelle reti dell'istanza: oggetti mai visti prima, apparati nuovi,
indirizzi che cambiano, MAC sostituiti, apparati spostati da una porta dello switch a un'altra, porte nuove aperte,
annunci sentiti dalla sonda trunk. Ogni riga è un cambiamento, con il prima e il dopo. Si guarda per accorgersi di un
apparato sconosciuto entrato in rete o di qualcosa spostato senza dirlo, e lo si segna **Visto** una volta controllato.

Si arriva da **Network › Apparati**, scheda **Cambiamenti** in cima (le altre schede sono spiegate in
[Apparati](pagine/discovery.md)). Il numero rosso accanto ad «Apparati» nel menu conta i cambiamenti ancora da
vedere. Il vecchio indirizzo dei cambiamenti di una singola subnet (`/networks/<id>/changes`) porta qui. Menu, schede e
tabelle funzionano come in tutte le pagine: vedi le [parti comuni dell'interfaccia](../INTERFACCIA.md).

## I tipi di cambiamento

![I tipi di cambiamento](/manuale/network-changes/tipi.png)

**Tutti** e poi una scheda per tipo, col numero (contando stato, periodo e rumore scelti). Il tipo si riconosce
dall'icona e dal nome, mai dal solo colore. Un clic mostra solo quel tipo.

| Scheda | Che cosa raccoglie |
|---|---|
| `icona:plus` **Oggetti nuovi** | Un indirizzo o un MAC mai visto prima. |
| `icona:server` **Apparati nuovi** | Un oggetto diventato apparato gestito (router, switch, server…). |
| `icona:arrow-left-right` **Cambi di IP** | Lo stesso apparato ha cambiato indirizzo. |
| `icona:fingerprint` **MAC cambiato** | Sullo stesso indirizzo ora risponde una scheda di rete diversa. |
| `icona:plug` **Spostamenti di porta** | Un apparato ora è attaccato a un'altra porta dello switch. |
| `icona:door-open` **Porte nuove** | Un servizio nuovo aperto su un apparato (per esempio una porta web che prima non c'era). |
| `icona:radio` **Dalla sonda trunk** | Cambiamenti sentiti dalla sonda in ascolto sulla linea fra gli switch. |

### Il giro notturno delle porte

Nella scheda **Porte nuove** un amministratore vede in cima il riquadro `icona:moon` **Giro notturno delle porte**,
ACCESO o spento, con **Accendi** / **Spegni**. È l'unica fonte delle porte nuove, e nasce spento: acceso, prova una
subnet per notte alle 03:00, piano (due host alla volta, al massimo 100 pacchetti al secondo), e dice quale rete
proverà stanotte e quando ha fatto l'ultimo giro. Sugli impianti resta il solo ping.

## La barra dei filtri

![La barra dei filtri](/manuale/network-changes/barra.png)

1. **Periodo**: **Ultime 24 ore**, **Ultimi 7 giorni** (all'apertura), **Ultimi 30 giorni**, **Ultimi 90 giorni**.
2. **Subnet**: **Tutte le subnet** oppure una sola.
3. **Stato**: **Da vedere** (all'apertura: quelli che nessuno ha ancora segnato), **Visti**, **Tutti**.
4. **Mostra anche il rumore**: di serie la pagina nasconde i cambiamenti che non dicono niente (per esempio i MAC che
   si spostano sulle porte di collegamento fra due apparati). Il numero fra parentesi dice quanti sono nascosti.
5. **Filtra**: applica le scelte 1-4. Senza Filtra le tendine non cambiano l'elenco.
6. **Disponibilità e latenza anomale**: apre le [Anomalie](pagine/analytics.md), con gli host che rispondono meno o
   più lentamente del solito.

Un amministratore vede in più `tasto:check` **Segna visti tutti (N)**, che segna in un colpo tutti i cambiamenti
ancora da vedere del tipo e dei filtri scelti.

## La tabella

![La tabella dei cambiamenti](/manuale/network-changes/tabella.png)

Nella schermata la colonna Oggetto è sfocata: i nomi dei PC e dei telefoni possono contenere nomi di persone.

1. **Tipo**: icona e nome del tipo. Sotto una riga di rumore c'è scritto «Rumore: …» col motivo.
2. **Oggetto**: il nome o l'indirizzo; un clic apre la [scheda dell'oggetto](pagine/objects-id.md).
3. **Prima** e **Dopo**: il valore vecchio e quello nuovo (per esempio il MAC di prima e quello di adesso, con il
   produttore).
4. **Stato**: **Da vedere**, oppure «Visto», chi l'ha segnato e quando. Un amministratore vede qui `tasto:check`
   **Visto** per segnarlo.

| Colonna | Che cosa dice |
|---|---|
| **Quando** | Data e ora del cambiamento. |
| **Tipo** | Icona e nome del tipo. |
| **Oggetto** | Il nome o l'indirizzo, collegato alla scheda. |
| **IP** | L'indirizzo coinvolto. |
| **Subnet** | La rete; un clic apre la sua [pagina](pagine/networks-id.md). |
| **Prima**, **Dopo** | Il valore vecchio e quello nuovo. |
| **Stato** | Da vedere, oppure Visto con chi e quando. |

In fondo **Precedente** e **Successiva** sfogliano le pagine, cinquanta righe per volta.

## Come si fa

- **Il giro del mattino**: apri la pagina (stato **Da vedere**), scheda `icona:plus` **Oggetti nuovi**; per ogni riga
  apri l'oggetto e capisci se è normale (un telefono nuovo, un PC riacceso), poi `tasto:check` **Visto**.
- **Chiudere in un colpo quelli già noti**: scegli il tipo, poi `tasto:check` **Segna visti tutti (N)**.
- **Vedere cosa è cambiato in una rete nell'ultimo mese**: **Subnet** quella rete, **Periodo** Ultimi 30 giorni,
  **Stato** Tutti, **Filtra**.
- **Scoprire perché un telefono cambia sempre indirizzo**: scheda `icona:arrow-left-right` **Cambi di IP**, guarda
  **Prima** e **Dopo**.
- **Accorgersi di servizi aperti di nascosto**: un amministratore accende il giro notturno nella scheda
  `icona:door-open` **Porte nuove**; dal giorno dopo le righe compaiono lì.

## Cosa vogliono dire i segni

- Le icone dei tipi, come nella tabella dei tipi qui sopra.
- «Rumore: …» sotto una riga: il cambiamento è stato giudicato non significativo, e c'è scritto perché.

## Da dove arrivano i dati

Dalle scansioni delle reti, dalle tabelle ARP e MAC di router e switch, dal giro notturno delle porte e dalla sonda
trunk. Ogni giro confronta quello che vede con quello che sapeva e scrive qui le differenze.

## Se la pagina è vuota

«Niente da vedere» vuol dire che tutti i cambiamenti del periodo sono già stati segnati: scegli **Tutti** nello stato
o allarga il periodo. «Nessun cambiamento» vuol dire che nel periodo non è cambiato niente. Se il riquadro dice che ci
sono righe di rumore nascoste, spunta **Mostra anche il rumore**. La scheda **Porte nuove** resta vuota finché il giro
notturno delle porte è spento.

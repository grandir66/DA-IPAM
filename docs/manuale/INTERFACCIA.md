# Le parti comuni dell'interfaccia

*Quello che vale per tutte le pagine di DA-IPAM: il menu a sinistra, il menu dell'utente, le schede in cima, la
ricerca e i filtri, le tabelle con il menu del tasto destro, la selezione di più righe, i segni e i colori. Le guide
delle singole pagine danno per sapute queste cose e spiegano solo quello che la pagina ha di suo.*

## La finestra, in grande

Ogni pagina ha tre zone:

- a sinistra il **menu**, blu scuro, con le voci del programma;
- in cima alla pagina la **fila di schede** della sezione, quando la pagina ne ha;
- al centro il **contenuto**: il titolo con i numeri riassuntivi, la barra della ricerca e dei filtri, e quasi
  sempre una tabella.

In alto a destra c'è sempre il pulsante tondo **?**: apre la guida di quella pagina (vedi più sotto).

## Il menu a sinistra {#menu}

![Il menu a sinistra](/manuale/interfaccia/menu.png)

1. **Comprimi menu**: stringe il menu alle sole icone e lascia più spazio alla pagina. Lo stesso pulsante lo riapre
   («Espandi menu»). Il programma ricorda la scelta per questo browser.
2. **Utente**: il tuo nome e il tuo ruolo. Un clic apre il [menu dell'utente](#utente). Sotto c'è l'**istanza** su cui
   stai lavorando, cioè il cliente (nome e codice). Chi ha più istanze la cambia da Impostazioni › Istanza.
3. **Dashboard**: la prima pagina, con il riassunto dello stato della rete.
4. **I gruppi** (Network, Sicurezza, DatIA Mon, Inventario, Applicativi e, dove il modulo è acceso, Network Services):
   un clic sul nome apre o chiude il gruppo. Il gruppo della pagina in cui sei resta aperto, e la voce accesa è in
   azzurro.
5. **Manuale**: il manuale completo, con la pagina sul prodotto, questa guida e le guide di tutte le pagine.
6. **Sistema**: **In esecuzione** mostra i lavori in corso (il numero rosso dice quanti) e **Impostazioni** la
   configurazione. Gli amministratori vedono anche la configurazione tecnica.

Altre cose da sapere sul menu:

- **Il numero accanto a una voce** dice quante cose aspettano te: accanto ad **Apparati** i cambiamenti da vedere,
  accanto a **Rete** gli allarmi gravi sentiti sul trunk. «99+» vuol dire cento o più. Passa il mouse sul numero per
  leggere che cosa conta.
- **Una voce grigia** è una funzione che dipende da un modulo spento o non ancora configurato. Passa il mouse sopra la
  voce per leggere il motivo; il modulo si accende da Impostazioni › Moduli.
- **Una voce con la freccia in uscita** (le console di LibreNMS, Graylog, Wazuh…) apre il programma collegato in una
  scheda nuova del browser.
- **Menu compresso**: restano le icone. Passa il mouse su un'icona per leggerne il nome; i gruppi si aprono con un
  clic come nel menu largo.

![Il menu compresso](/manuale/interfaccia/menu-compresso.png)

Sul telefono il menu è nascosto: si apre con il pulsante ☰ in alto a sinistra e si chiude toccando la pagina.

## Il menu dell'utente {#utente}

![Il menu dell'utente](/manuale/interfaccia/menu-utente.png)

- **Cambia password**: chiede la password attuale e due volte quella nuova, di almeno 8 caratteri. Dopo il cambio si
  rientra con la nuova.
- **Tema scuro / Tema chiaro**: passa dall'uno all'altro. Il browser ricorda la scelta.
- **Esci**: chiude la sessione.

I ruoli che compaiono sotto il nome:

| Ruolo | Che cosa può fare |
|---|---|
| **Solo lettura** | Vede tutto, non cambia niente. |
| **Amministratore** | Vede e cambia: scansioni, correzioni, credenziali, impostazioni dell'istanza. |
| **Super Admin** | Come l'amministratore, in più gestisce le istanze e gli utenti di tutta l'installazione. |
| **Cliente** | Vede la versione semplice per il cliente, con poche pagine. |

## Le schede in cima alla pagina {#schede}

Molte pagine fanno parte di una **sezione** con più pagine sorelle, e in cima mostrano una fila di schede (①
nell'immagine sotto). La scheda azzurra è quella aperta, un clic su un'altra cambia pagina. Il menu a sinistra resta
sulla voce della sezione.

In **Impostazioni** le schede sono divise in gruppi da una riga verticale, e alcune le vede solo un amministratore:

![Le schede di Impostazioni](/manuale/interfaccia/schede-impostazioni.png)

Ogni scheda ha la sua parte nella guida della pagina: se apri il **?** stando su una scheda, la guida si apre già
alla parte giusta.

## La barra in cima all'elenco {#barra}

![La barra della ricerca e dei filtri](/manuale/interfaccia/testata.png)

1. **Le schede** della sezione (vedi sopra).
2. **Cerca**: filtra l'elenco mentre scrivi. Di solito cerca nell'indirizzo, nel MAC, nel nome e nel produttore; la
   guida della pagina dice dove cerca esattamente.
3. **Filtri**: apre il pannello dei filtri (vedi sotto). Se ci sono filtri attivi, il pulsante dice quanti
   («Filtri · 2»).
4. **Colonne**: sceglie quali colonne vedere e in che ordine. Accanto, la tendina **Colonne: le tue** passa al volo
   a una vista pronta (Inventario, Sicurezza, Rete) e torna alle tue colonne.
5. **Esporta CSV**: scarica in un file CSV, che si apre con Excel, **quello che vedi**: con i filtri attivi e le
   colonne scelte.
6. **Aggiorna**: ricarica i dati senza ricaricare la pagina.

Sopra o sotto la barra il titolo della pagina porta i **numeri riassuntivi** (per esempio «322 apparati · 189
online · 128 offline»). Le **pastiglie** sopra la tabella (Tutti, Postazioni, Server…) sono filtri rapidi: un clic
mostra solo quel gruppo, il numero dice quante righe ha.

### Il pannello dei filtri

![Il pannello dei filtri](/manuale/interfaccia/filtri.png)

Si apre da destra. Ogni tendina restringe l'elenco a un valore. Il pulsante in fondo, **Mostra N righe**, chiude il
pannello e dice quante righe restano. **Togli tutti** azzera i filtri.

Ogni filtro attivo compare come pastiglia accanto al pulsante Filtri, con la **✕** per toglierlo da solo.

### Le colonne

![Gestisci colonne](/manuale/interfaccia/colonne.png)

- Le frecce **↑ ↓** spostano una colonna prima o dopo.
- La **✕** la nasconde. Le colonne nascoste restano in fondo all'elenco e si rimettono con un clic.
- **Mostra tutte** le accende tutte, **Predefinite** torna alla scelta di partenza.

Il programma ricorda le colonne per questo browser.

## Le tabelle {#tabelle}

- **Ordinare**: un clic sull'intestazione di una colonna ordina l'elenco per quella colonna; un altro clic inverte
  l'ordine. La freccia ↑ o ↓ accanto al nome dice su quale colonna e in che verso è ordinato; le due frecce grigie
  ⇅ dicono che la colonna si può ordinare.
- **Correggere un valore**: dove accanto al valore c'è una **matita**, un clic apre la casella. **Invio** salva,
  **Esc** annulla. Lo può fare solo chi non è in sola lettura.
- **Aprire un oggetto**: un indirizzo IP o un nome in azzurro è un collegamento. La piccola freccia accanto
  all'indirizzo apre l'interfaccia web dell'apparato in una scheda nuova.
- **Le pagine**: gli elenchi lunghi sono divisi in pagine. In fondo alla tabella:

![Le pagine dell'elenco](/manuale/interfaccia/paginazione.png)

**Righe per pagina** sceglie quante righe vedere (15, 50, 100 o 500); le frecce vanno alla prima pagina, alla
precedente, alla successiva e all'ultima.

### Il menu della riga e il tasto destro {#tasto-destro}

Ogni riga ha all'inizio il pulsante **⋮** con le azioni su quell'oggetto. Le stesse azioni si aprono col **tasto
destro** su qualsiasi punto della riga (sul telefono: tenendo premuto).

Il tasto destro fa qualcosa in più: si riferisce alla **cella** su cui hai cliccato.

![Il menu del tasto destro](/manuale/interfaccia/tasto-destro.png)

- In cima c'è l'oggetto (nome e indirizzo), sotto la colonna e il valore della cella («Stato: online»).
- **Mostra solo questo valore**: tiene solo le righe che hanno quel valore in quella colonna.
- **Nascondi questo valore**: toglie le righe con quel valore.
- **Copia il valore**: copia il testo della cella.
- Sotto la riga di separazione ci sono le azioni della riga, le stesse del pulsante ⋮.

I filtri fatti col tasto destro compaiono in cima all'elenco, dopo la scritta «Filtri dal tasto destro:», ognuno con
la sua ✕. Dentro una casella di testo il tasto destro resta quello del browser (copia, incolla).

Le azioni che cambiano qualcosa (eliminare, riscansionare, assegnare una credenziale) le esegue solo un
amministratore.

### Più righe insieme {#selezione}

La casella a sinistra di ogni riga seleziona la riga; quella nell'intestazione seleziona tutte le righe visibili.
Appena c'è una riga selezionata, sopra la tabella compare la **barra della selezione**:

![La barra della selezione](/manuale/interfaccia/selezione.png)

La barra dice quante righe hai selezionato e propone le azioni su tutte insieme (in Apparati: modifica multipla,
rendi apparato, stesso device fisico, aggiorna, crea asset NIS2). **Deseleziona** toglie la selezione.

## Segni e colori {#segni}

Il programma non usa mai il solo colore: ogni stato ha anche una **forma** o una **parola**, così si legge anche
stampato in bianco e nero.

| Segno | Vuol dire |
|---|---|
| ● **Online** su verde | L'apparato ha risposto all'ultimo controllo. |
| ● **Offline** su rosso | Non risponde più. Accanto, da quanto («7h fa»). |
| **Sconosciuto** su grigio | Non è mai stato provato. |
| ✓ su verde | Va bene, è acceso, è fatto. |
| ▲ su giallo | Attenzione: da guardare. |
| ✕ su rosso scuro | Errore o blocco. |
| Icona colorata | Quella cosa c'è (per esempio: è monitorato). Grigia: non ancora. |
| Testo *in corsivo* | Dato ricavato dal programma, nessuno l'ha ancora confermato. |

La **gravità** dei problemi di sicurezza ha quattro gradini, con le tacche e la parola: **Critica** (4 tacche, rosso
scuro), **Alta** (3, arancio), **Media** (2, giallo), **Bassa** (1, azzurro chiaro).

I **tempi** contano da adesso: «adesso», «5 min fa», «3 ore fa», «2 giorni fa»; oltre la settimana compare la data.
Nelle tabelle strette lo stesso tempo è scritto più corto («2h fa»). Dove c'è, passando il mouse sopra si leggono la
data e l'ora esatte. Gli orari sono in ora italiana.

## Messaggi, attese, errori {#messaggi}

- **I messaggi brevi** (salvato, copiato, errore) compaiono per qualche secondo in basso a destra.
- **Un'operazione lunga** (una scansione, una lettura) mostra la barra di avanzamento nella pagina e compare in
  **In esecuzione**: puoi cambiare pagina, il lavoro continua.
- **Pagina vuota**: un riquadro spiega perché e che cosa fare per riempirla (di solito: aggiungere una rete, accendere
  un modulo, aspettare il primo giro).
- **Impossibile caricare…**: i dati non sono arrivati. Il riquadro dice il motivo e ha il pulsante **Riprova**. Non
  vuol dire che i dati non ci siano.

## La guida della pagina: il pulsante ? {#guida}

![La guida di una pagina](/manuale/interfaccia/finestra-manuale.png)

Il **?** in alto a destra apre la guida della pagina in cui sei, sopra la pagina stessa. In cima la guida dice a quale
versione del programma è aggiornata. In fondo, **Apri nel manuale completo** porta alla stessa guida dentro il
manuale, con l'elenco di tutte le altre a sinistra. La finestra si chiude con la ✕, con **Esc** o con un clic fuori.

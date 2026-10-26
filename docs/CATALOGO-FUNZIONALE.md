# DA-IPAM — catalogo funzionale e valutazione delle evoluzioni

Base testuale per marketing e formazione dei colleghi. Nessuna impaginazione commerciale, nessuna grafica.

> **Rettifica di copertura — 26/10/2026:** il controllo iniziale delle 43 etichette di menu verificava la presenza dei temi, non la completezza di pagine, tab e operazioni. La prima guida grafica era una panoramica. Il censimento completo dei file di pagina è ora in `guida-visuale/copertura.json`; le descrizioni dedicate sono nelle schede selezionabili della guida. La copertura delle catture resta parziale ed è dichiarata voce per voce.


## 0. Fonte, perimetro e lettura degli stati

- **Verifica del 25 ottobre 2026:** sorgente `origin/dev`, commit `76b15198`, versione dichiarata `0.9.913`. Riferimenti aggiornati con `git fetch origin`; lettura da una copia isolata di quel commit. Il working tree locale, indietro di 83 commit e con lavoro aperto, non è stato aggiornato o sovrascritto.
- **Materiali di partenza:** `DA-IPAM-in-breve.pdf`, 11 pagine, e `DA-IPAM-presentazione.pdf`, 5 pagine. Il primo dichiara lo stato del 23 ottobre, versione 0.9.892. Le affermazioni dei PDF sono materiale da confrontare, non istruzioni né prove di disponibilità.
- **Documentazione già esistente:** questo catalogo sviluppa l'elenco funzionale dei PDF e rimanda al [Manuale utente](MANUALE-UTENTE.md) per le procedure. Non sostituisce i manuali tecnici.
- **Metodo:** confronto fra navigazione effettiva, pagine, componenti, registro dei moduli, implementazioni e note di collaudo. Le fonti tecniche principali sono raccolte al §20.
- **Presente nel codice:** esistono implementazione e punti di accesso. Non significa automaticamente installato, acceso o verificato su ogni appliance.
- **Condizionale:** richiede un modulo, credenziali, permessi, dati o un servizio esterno. In assenza di questi requisiti la funzione può essere nascosta, vuota o non utilizzabile.
- **Evoluzione recente:** codice già presente ma attivazione e collaudo di installazione vanno verificati separatamente. Trunk e nuovo vault ricadono qui.
- **Consiglio:** proposta di questa analisi; non è una funzione implementata né un impegno di sviluppo.
- **Limite della verifica:** analisi statica del codice e dei documenti. Nessun accesso alle appliance dei clienti, nessuna prova di rete, nessuna migrazione, nessuna esecuzione di scansioni o patch. Le prove già registrate nel progetto sono evidenze storiche, non prove rieseguite in questa sessione.

## 1. Che cosa fa il prodotto

- **Scopre:** individua gli oggetti visibili nelle reti configurate e acquisisce informazioni dalle sorgenti collegate.
- **Riconosce:** combina indirizzi, nomi, firme dei servizi, SNMP e letture autenticate per classificare gli oggetti.
- **Mette in relazione:** associa host, apparati, porte, VLAN, macchine virtuali, asset e persone.
- **Tiene l'inventario:** affianca alla scoperta tecnica dati patrimoniali, ubicazioni, licenze e servizi aziendali.
- **Rende visibili i problemi:** mostra anomalie di rete, vulnerabilità, alert delle integrazioni e rilievi del sensore trunk.
- **Consente interventi selezionati:** letture autenticate, gestione DNS/DHCP, patch Windows e controllo remoto, secondo moduli e autorizzazioni.
- **Governa l'appliance:** configurazione, schedulazioni, salute, backup, aggiornamenti e controllo delle uscite verso Domarc.
- **Modello operativo:** una installazione cliente è destinata a un cliente; sull'hub esiste la gestione di più istanze. La presenza tecnica dei tenant non va presentata come una garanzia di segregazione fra clienti su una stessa appliance.

## 2. Accesso, navigazione e primo utilizzo

- **Primo avvio:** creazione dell'amministratore e configurazione iniziale di reti e parametri necessari alla scoperta. Serve a rendere utilizzabile l'installazione prima di configurare le integrazioni.
- **Login locale:** ingresso con account dell'applicazione. I permessi distinguono consultazione e amministrazione.
- **Verifica in due passaggi:** protezione aggiuntiva per utente, che può essere richiesta dall'amministratore.
- **Menu utente:** cambio password, tema e uscita. La gestione delle sessioni comprende la revoca all'uscita; non descriverla semplicemente come chiusura della pagina.
- **Istanza:** gli utenti autorizzati a più istanze possono scegliere quella di lavoro e ritrovare l'ultima usata. L'appliance di un singolo cliente non richiede normalmente questo passaggio.
- **Menu laterale:** Dashboard, Network, Sicurezza, Inventario, Network Services, Applicativi, Anomalie, Manuale, Impostazioni, Opzioni, Schedulazioni e Cosa esce. Alcune voci dipendono da ruolo e moduli.
- **Ricerca:** individuazione degli oggetti tramite gli strumenti di ricerca generali e delle singole liste.
- **Filtri e colonne:** restringono il lavoro a reti, tipi, stati o problemi specifici. La configurazione delle viste evita di lavorare ogni volta sull'elenco completo.
- **Manuale integrato:** consultazione delle istruzioni dall'applicazione, senza dover trovare una copia esterna del manuale.

## 3. Dashboard

**Uso:** punto di partenza per capire lo stato dell'istanza e decidere dove intervenire.

- **Sintesi delle reti e degli host:** quantità di subnet, oggetti e stati di raggiungibilità.
- **Stato dei moduli:** visione delle integrazioni configurate e della loro salute; distingue la presenza della configurazione dal funzionamento rilevato.
- **Host conosciuti:** controllo degli oggetti marcati come importanti, con raggiungibilità e informazioni di latenza disponibili.
- **Andamento della disponibilità:** lettura dell'evoluzione degli stati nel periodo mostrato.
- **Anomalie recenti:** accesso ai cambiamenti e ai problemi rilevati, con passaggio alla vista di approfondimento.
- **Passaggio al dettaglio:** dalle sintesi si entra negli elenchi o nella scheda dell'oggetto interessato.

**Limite:** un cruscotto vuoto o senza allarmi può dipendere da fonti non configurate. Non dimostra che tutti gli oggetti siano stati controllati.

## 4. Network → Subnet

**Uso:** dichiarare quali reti gestire e con quali modalità acquisirne i dati.

- **Elenco subnet:** reti con CIDR, nome, VLAN, ubicazione, conteggi host e informazioni sull'ultima scansione.
- **Creazione e modifica:** definizione di rete, descrizione, gateway, VLAN, DNS e sede. Serve a dare un contesto agli indirizzi rilevati.
- **Router associato:** selezione dell'apparato dal quale acquisire ARP e, quando supportato, informazioni DHCP.
- **Credenziali per rete:** catene ordinate per Windows/WinRM, Linux, SSH degli apparati e SNMP.
- **Riutilizzo dell'archivio:** associazione di credenziali esistenti senza ricopiarle su ogni oggetto.
- **Dettaglio subnet:** rappresentazione degli indirizzi e lista degli host della singola rete.
- **Scoperta rete:** avvio di un giro di rilevamento degli host e delle informazioni tecniche di base.
- **Nmap:** scansione degli host scelti con un profilo previsto dall'applicazione.
- **Lettura ARP:** acquisizione delle associazioni MAC/IP dal router configurato.
- **Rilevamento avanzato:** acquisizione autenticata di dati di sistema e inventario dagli host selezionati.
- **Rilettura DNS:** acquisizione o aggiornamento dei nomi secondo configurazione.
- **Pianificazione:** collegamento tra rete e scansioni periodiche; frequenze effettive da leggere nelle schedulazioni.
- **Esportazione:** estrazione degli elenchi per i flussi supportati.
- **Eliminazione:** rimozione della rete con effetti sui dati collegati, da trattare come operazione amministrativa e non come semplice filtro.

**Limite:** configurare una rete non garantisce che sia raggiungibile dall'appliance: routing, VLAN, firewall e protocolli disponibili determinano la copertura.

## 5. Network → Discovery

**Uso:** elenco operativo unificato degli oggetti scoperti; è il punto di lavoro quotidiano del tecnico.

- **Identità:** IP, MAC, nome rilevato o personalizzato, produttore, modello, seriale, sistema e firmware quando disponibili.
- **Classificazione:** tipo dell'oggetto e informazioni di riconoscimento. Permette di separare server, postazioni, switch, router, storage, stampanti e altri dispositivi.
- **Contesto di rete:** subnet, VLAN, ubicazione e collegamento allo switch/porta, se acquisito.
- **Stato:** distinzione fra raggiungibile, non raggiungibile e condizioni temporali derivate. Una osservazione passiva non viene trattata automaticamente come prova di raggiungibilità corrente.
- **Origini e integrazioni:** dati o collegamenti da AD, Wazuh, LibreNMS e altre sorgenti abilitate.
- **Credenziali:** indicazioni sulle credenziali associate e sulle verifiche riuscite.
- **Vulnerabilità:** conteggi e segnalazioni dipendenti dalle fonti di sicurezza configurate.
- **Ricerca e filtri:** selezione per rete, classificazione, stato, CVE e testo libero.
- **Viste rapide:** raggruppamenti per famiglie di oggetti; preset e colonne riducono le informazioni alla necessità del momento.
- **Esportazione CSV:** estrazione della vista o della selezione per controlli e scambi operativi.
- **Aggiornamento selettivo:** rilettura degli oggetti scelti, con esito delle operazioni.
- **Rendi apparato:** passaggio dall'host scoperto all'oggetto gestito, con tipo, protocolli e credenziali. L'applicazione può cercare una credenziale utilizzabile fra quelle ammesse.
- **Modifica multipla:** applicazione di informazioni comuni a una selezione di host.
- **Creazione asset:** trasferimento dell'oggetto tecnico nell'inventario patrimoniale.
- **Programmazione degli apparati scelti:** rilettura periodica di una selezione idonea, invece di affidarsi soltanto alla scansione dell'intera subnet.
- **Oggetti con più indirizzi:** gestione delle relazioni tra indirizzi e apparato per ridurre i duplicati; la classificazione e le unioni vanno controllate nei casi ambigui.

**Limite:** host scoperto, apparato gestito e asset sono tre livelli distinti. Un indirizzo presente nella lista non implica inventario completo, credenziale valida o assegnatario noto.

## 6. Scheda dell'oggetto: funzione per tipo

**Accesso:** da Discovery, Topologia o altri elenchi verso la scheda dell'oggetto. La scheda si adatta al tipo e ai dati presenti.

### 6.1 Parti comuni

- **Panoramica:** identità, stato e dati principali per riconoscere subito l'oggetto.
- **Sicurezza:** informazioni di sicurezza disponibili per quell'host e rimandi alle fonti integrate.
- **Gestione:** classificazione, informazioni operative, note, legame con l'asset e gestione tecnica consentita.
- **Storico:** consultazione delle informazioni storiche esposte dalla scheda.
- **Sensori:** se LibreNMS fornisce sensori e la lettura è abilitata, compare la relativa sezione; non è garantita su ogni apparato.
- **Host non gestito:** vista ridotta, utile a identificarlo e portarlo in inventario senza fingere di possedere una lettura autenticata.

### 6.2 Switch

- **Porte:** stato e dati disponibili delle interfacce fisiche/logiche.
- **VLAN:** appartenenze e dati di tagging/PVID quando esposti dal prodotto e acquisiti dal lettore.
- **Vicini e MAC:** relazioni fra porte, apparati vicini e dispositivi collegati.
- **Dati hardware e ambientali:** popolamento secondo collector o integrazione; stack, moduli, PoE e sensori dipendono dalla copertura specifica.

### 6.3 Router e firewall

- **Interfacce:** indirizzi, collegamenti e informazioni delle interfacce disponibili.
- **Routing:** lettura delle informazioni di instradamento raccolte.
- **DHCP:** dati DHCP esposti dall'apparato supportato.
- **Configurazione:** dati e strumenti previsti dal lettore del prodotto. Questa tab non significa editor universale delle regole firewall.
- **MikroTik:** sezioni specifiche per interfacce, routing, DHCP e dispositivi osservati; VLAN e bridge compaiono con i relativi dati e la lettura topologica attiva.
- **MikroTik, consultazione riservata:** utenti ed export ripulito secondo permessi; i dati sensibili dell'export richiedono il trattamento previsto sul server.

### 6.4 Storage/NAS

- **Dischi:** inventario dei dischi quando letto dal prodotto.
- **Volumi:** capacità, RAID e volumi secondo dati acquisiti.
- **Servizi NAS:** informazioni specifiche disponibili per la famiglia supportata.
- **Limite:** la presenza della tab non certifica che condivisioni, pacchetti e tutti i sensori siano collaudati su qualsiasi firmware.

### 6.5 Hypervisor

- **Macchine virtuali:** elenco e dati delle VM visibili alla credenziale usata.
- **Nodi:** relazione con nodi o cluster rilevati.
- **Storage:** datastore o risorse storage lette dalla piattaforma.
- **Rete:** schede e relazioni di rete disponibili.
- **Limite:** una API dell'host ESXi non equivale alla gestione completa di vCenter; un indirizzo guest dipende anche dai dati forniti dagli strumenti guest.

### 6.6 Server Windows

- **Sistema:** informazioni del sistema operativo e dell'hardware acquisite.
- **Servizi:** servizi letti tramite i meccanismi supportati.
- **Aggiornamenti:** dati disponibili sugli aggiornamenti.
- **Software:** inventario software raccolto per l'host.
- **Utenti:** informazioni sugli utenti previste dalla lettura.
- **Active Directory:** sezione contestuale per un server con ruolo DC e dati AD disponibili.
- **Dipendenze:** servizi aziendali appoggiati all'host, quando censiti.

### 6.7 Server Linux e altri oggetti

- **Linux:** sistema, servizi, aggiornamenti e utenti secondo lettura e permessi; dipendenze se censite.
- **Generico:** panoramica e dettagli disponibili, con le sezioni comuni.
- **Limite generale:** non dedurre la completezza dei dati dal numero di tab. Una tab deve poter mostrare anche assenza, mancato supporto o errore di acquisizione.

## 7. Network → Topologia

**Uso:** capire come gli oggetti sono collegati e costruire una mappa utilizzabile durante un intervento.

- **Acquisizione dei collegamenti:** utilizzo delle informazioni disponibili da apparati, controller, MAC e vicini di rete.
- **Mappa con cavi:** rappresentazione dei collegamenti del modello topologico quando l'opzione è attiva.
- **Intervento manuale:** aggiunta e gestione dei collegamenti disegnati dal tecnico; i cavi manuali hanno precedenza sui dati secondo le regole del modello.
- **Organizzazione degli oggetti:** inserimento, rimozione dalla vista, disposizione e gestione dei ruoli nella mappa.
- **Oggetti collegati:** inserimento nella vista degli elementi collegati, senza ricostruirli a mano.
- **Hypervisor e VM:** rappresentazione delle relazioni fisico/virtuale secondo dati disponibili.
- **Unisci con / Separa:** gestione degli oggetti da rappresentare insieme o separatamente nei casi previsti.
- **Vista e orientamento:** strumenti per rendere leggibile la rete e concentrarsi sulla parte necessaria.
- **Stampa:** preparazione della mappa per l'uso fuori dalla vista interattiva.
- **Dati della mappa:** pagina di controllo delle fonti e delle opzioni topologiche.

**Limite:** la topologia è una ricostruzione fondata sulle osservazioni e sulle correzioni del tecnico. Non promettere la ricostruzione certa di ogni cavo in qualsiasi rete.

## 8. Network → fonti e diagnostica

### 8.1 Active Directory

- **Configurazione del dominio:** connessione al servizio directory tramite le credenziali e i parametri richiesti.
- **Computer:** elenco dei computer importati e collegamento con gli host rilevati.
- **Utenti:** informazioni directory disponibili, comprese quelle utili agli assegnatari.
- **Gruppi:** appartenenze e gruppi del dominio per la lettura amministrativa.
- **Lease DHCP:** informazioni disponibili attraverso la fonte di dominio configurata.
- **Sincronizzazione:** rilettura del dominio con stato ed esito; arricchisce l'inventario senza dover ricreare manualmente i computer.
- **Health:** punto d'ingresso all'analisi del dominio descritta nel menu Sicurezza.

### 8.2 Credenziali

- **Archivio unico:** registrazione dei tipi di credenziale supportati, fra cui accessi SSH, Windows, Linux, SNMP e API.
- **Associazione:** collegamento a rete o apparato; riutilizzo durante le letture.
- **Catene ordinate:** ricerca di una credenziale valida entro le regole e i limiti dei protocolli.
- **Verifica dell'accesso:** distinzione fra credenziale presente e utilizzabile su quello specifico oggetto.
- **Protezione dei segreti:** conservazione cifrata secondo backend attivo; il nuovo vault è un'evoluzione distinta dall'archivio storico.
- **Consultazione dei segreti:** nel nuovo percorso vault, azione riservata e confermata con verifica in due passaggi, registrata. Disponibilità soggetta all'attivazione prevista.

### 8.3 Controller di rete

- **Configurazione controller:** registrazione delle connessioni previste dal prodotto.
- **UniFi:** lettura di apparati, porte, vicini e client secondo le sincronizzazioni abilitate.
- **Inventario per sito:** il collector UniFi distingue i siti, evitando di attribuire tutte le porte al controller.
- **VLAN:** acquisizione dei dati esposti dalle API ammesse e dalle opzioni attive.
- **Console:** apertura del controller quando configurato.
- **Limite:** non assumere che tutti i controller abbiano la stessa copertura di UniFi o che tutti i dati radio siano disponibili.

### 8.4 Tabella ARP

- **Consultazione MAC/IP:** ricerca delle associazioni raccolte dalle fonti supportate.
- **Confronto con rete e host:** uso delle associazioni per identificazione e correlazione.
- **Aggiornamento delle fonti:** le letture di router/switch alimentano l'archivio secondo pianificazione.
- **Limite:** una voce ARP può sopravvivere allo spegnimento dell'host: non è un ping riuscito.

### 8.5 Sorgenti DHCP

- **Registrazione delle sorgenti:** indicazione dei sistemi dai quali leggere i lease.
- **Lettura dei lease:** indirizzi, nomi e associazioni disponibili arricchiscono l'inventario.
- **Uso nella sicurezza trunk:** i server DHCP noti contribuiscono a distinguere un server atteso da uno inatteso.
- **Distinzione:** leggere i lease di un sistema esistente è diverso dal gestire il DHCP con Network Services.

### 8.6 Scansioni e IP esclusi

- **Scansioni:** storico delle esecuzioni, stato ed esiti per capire cosa è stato letto e quando.
- **Esecuzioni manuali:** avvio delle operazioni previste sugli oggetti o sulle reti scelte.
- **IP esclusi:** dichiarazione degli indirizzi da escludere dai percorsi di scansione che applicano la lista.
- **Limite:** l'esclusione dalla scansione non va presentata come invisibilità da tutte le fonti passive o dalle integrazioni.

## 9. Sicurezza → Vulnerabilità

**Uso:** individuare gli host affetti e dare priorità alla verifica tecnica.

- **Vista aggregata per CVE:** identificativo, severità, punteggio, pacchetto e numero di host interessati, secondo la fonte.
- **Origine dei dati:** Scanner-Edge e Wazuh, se configurati e sincronizzati.
- **Riepilogo severità:** distinzione tra criticità per concentrarsi sulle esposizioni rilevanti.
- **Host affetti:** apertura dell'elenco degli oggetti interessati dalla stessa vulnerabilità.
- **Filtri:** testo, severità, sorgente e sistema operativo secondo vista.
- **Exploit intelligence:** arricchimento con CISA KEV, Exploit-DB ed EPSS quando il feed è disponibile.
- **Passaggio alla scheda:** collegamento fra vulnerabilità e inventario reale dell'oggetto.
- **Passaggio alle patch:** uso delle CVE nel percorso di aggiornamento dei programmi Windows compatibili.

**Limiti:** assenza di CVE non equivale a scansione completa o assenza di vulnerabilità. L'arricchimento exploit non sostituisce l'acquisizione delle vulnerabilità. Non attribuire a DA-IPAM i report e tutte le analisi di DA-Vul-can.

## 10. Sicurezza → Alert sicurezza e Health Active Directory

### 10.1 Alert sicurezza

- **Consultazione centralizzata:** eventi acquisiti dalle integrazioni di sicurezza configurate.
- **Wazuh:** relazione degli eventi con gli host e con le informazioni disponibili nell'inventario.
- **Regole per apparati di rete:** configurazione dei controlli previsti per gli apparati.
- **Conservazione e soglie:** parametri amministrativi dedicati alla gestione degli alert.
- **Approfondimento:** lettura del contesto per distinguere un evento operativo da uno da investigare.

**Limite:** il SIEM e la sua correlazione sono forniti da Wazuh; DA-IPAM ne integra dati, contesto e accesso.

### 10.2 Health Active Directory

- **Assessment del dominio:** motore di regole Domarc alimentato dai dati acquisiti da AD e dalle sonde disponibili.
- **Rilievi e rimedi:** elenco dei problemi con gravità e indicazioni operative presenti nel prodotto.
- **Matrice privilegi:** approfondimento dei privilegi e delle appartenenze rilevanti.
- **Permessi ACL:** analisi delle autorizzazioni directory nei limiti dei dati raccolti.
- **Topologia e ADCS:** informazioni e rilievi disponibili su dominio e servizi certificati.
- **Sonde sui controller:** acquisizioni aggiuntive quando configurate e autorizzate.
- **Esportazione:** uscita dell'healthcheck nel formato previsto dall'applicazione, utilizzabile nel flusso verso DA-Vul-can.
- **Controllo dell'ultima esecuzione:** distinzione tra dati dell'ultimo run riuscito ed errore della nuova lettura.

**Limite esplicito della pagina:** AD Health Domarc non esegue né sostituisce PingCastle. Copertura, privilegi e fonti vanno dichiarati prima di presentare il risultato come assessment completo.

## 11. Sicurezza → Reti dal trunk: evoluzione recente

**Uso:** osservare ciò che passa sul trunk reso visibile al sensore, trovare reti e oggetti non ancora censiti e segnalare incoerenze di sicurezza.

**Stato nel codice:** pagina, lettore, persistenza, API, regole e pianificazione presenti. Lettura spenta di serie, attivabile da Opzioni → Sensore trunk. Nessuna attestazione in questa analisi sulla configurazione fisica o sul funzionamento di una specifica appliance.

### 11.1 Raccolta e prerequisiti

- **Sensore dedicato:** DA-IPAM legge un servizio separato, prima dal socket locale e, quando non disponibile, tramite l'API Scanner-Edge configurata.
- **Indipendenza dalla scansione VA:** il servizio sensore può funzionare anche senza il motore di scansione delle vulnerabilità acceso.
- **Collegamento di rete:** occorre rendere visibili alla scheda del sensore le VLAN e i pacchetti necessari. Un trunk non consegna automaticamente tutto il traffico unicast tra le altre porte.
- **Ascolto passivo:** acquisizione delle informazioni osservabili nei protocolli trattati: MAC, IP, nomi, VLAN, protocolli e tempi di osservazione.
- **Importazione incrementale:** lettura delle novità dal cursore; il job dedicato è programmato ogni due minuti, subordinato all'attivazione e alla riuscita della lettura.
- **Salute del sensore:** raggiungibilità, sorgente della lettura, scheda, ascolto, tag VLAN osservati, pacchetti al secondo ed errore disponibile.
- **Stato della lettura:** informazione separata dall'ultima presenza di dati, per non confondere un archivio popolato con un sensore vivo.

### 11.2 VLAN e reti

- **VLAN viste/dichiarate:** confronto fra VLAN osservate e dichiarate al sensore; confronto con le reti IPAM nei controlli dedicati.
- **Reti per VLAN:** elenco delle subnet e degli IP osservati nella VLAN scelta.
- **Maschera con provenienza:** distinzione tra dato DHCP, configurato, dedotto e incerto.
- **Unione dei blocchi:** aggregazione dei blocchi dedotti secondo le regole del modello, evitando di presentare ogni /24 osservata come una rete certa.
- **Correzione manuale della maschera:** il tecnico può correggere la deduzione; l'incertezza resta un dato da risolvere.
- **Gateway:** distinzione fra gateway annunciato dal DHCP e candidato dedotto dalle richieste ARP.
- **Identificazione dell'oggetto:** IP, MAC, produttore, nome, protocolli e ultima osservazione.
- **Filtri:** VLAN, rete, ricerca e metodo di rilevamento: ascolto, giro attivo, entrambi.
- **Reti nel tempo:** indicatori di indirizzi noti, nuovi e attivi nel periodo.
- **Limite temporale:** la serie calcolata usa prima e ultima osservazione; non è un registro di ogni presenza giornaliera né una misura esatta di uptime.
- **Porta in inventario:** percorso per censire la rete osservata. Una maschera incerta richiede prima chiarimento/correzione.

### 11.3 Giri attivi

- **Richiesta di giro ARP:** un amministratore può chiedere un giro sulla rete/VLAN per trovare anche dispositivi silenziosi.
- **Distinzione della fonte:** la vista mantiene separati gli oggetti trovati in ascolto da quelli trovati nel giro, o da entrambi.
- **Limite:** il giro ARP genera traffico. L'intera funzione non va venduta come sempre e soltanto passiva.

### 11.4 Otto rilievi già implementati

- **Server DHCP non previsto:** confronta i server osservati con sorgenti e gateway noti. La compresenza di server distinti aumenta la gravità prevista dalle regole.
- **IP conteso:** rileva MAC differenti sullo stesso IP e VLAN in una finestra recente; tratta i gateway con maggiore gravità ed esclude prefissi virtuali noti per la ridondanza.
- **Indirizzo fuori rete:** segnala un IP che appartiene alla rete di un'altra VLAN, usando le reti note e quelle DHCP. È una incoerenza da verificare, non la prova automatica di un attacco.
- **LLMNR/NetBIOS:** segnala gli apparati osservati usare questi protocolli di risoluzione dei nomi e propone l'azione prevista dal prodotto.
- **Stesso apparato su più VLAN:** esposizione da interpretare secondo ruolo; può essere normale per router e hypervisor.
- **Annunci CDP/LLDP:** rende visibili gli apparati che si annunciano. Il rilievo non dimostra da solo che l'annuncio sia arrivato a una porta utente non autorizzata.
- **Apparato non in inventario:** confronta i MAC osservati con gli oggetti censiti per aiutare a riconoscere i nuovi collegamenti.
- **VLAN non censita:** segnala una VLAN osservata senza la corrispondente rete IPAM prevista dal controllo.

### 11.5 Gestione dei rilievi e confini

- **Classificazione:** allarmi, esposizioni e novità, con gravità e contesto.
- **Ricerca e filtri:** selezione per categoria, tipo, VLAN, testo e stato di presa in carico.
- **Indicazioni operative:** la pagina associa a ogni tipo un suggerimento; l'operatore lo valuta nel contesto reale.
- **Presa in carico:** un amministratore registra chi prende il rilievo; può rimetterlo fra quelli da prendere.
- **Contatore nel menu:** evidenza degli allarmi gravi ancora da prendere in carico.
- **Limite operativo:** prendere in carico non significa avere corretto il problema o averne verificato la scomparsa.
- **Confine tecnico:** il codice dei rilievi lavora su ciò che il trunk vede, in particolare broadcast, multicast e ARP; non è un motore universale di analisi dei contenuti, un IDS completo o una prova di tutte le comunicazioni fra VLAN.

## 12. Inventario

### 12.1 Asset

- **Anagrafica patrimoniale:** codice, descrizione, categoria, marca, modello, seriale e identificativo aziendale.
- **Ciclo di vita:** acquisto, garanzia, fornitore, valore e altri dati previsti dalla scheda.
- **Collegamento tecnico:** legame con un host o apparato per utilizzare i dati realmente rilevati.
- **Assegnatario e ubicazione:** attribuzione a persone e sedi.
- **Creazione da Discovery:** conversione guidata dai dati dell'oggetto già presente.
- **Inventario anche non di rete:** l'asset è un'entità distinta dall'host e può essere censito senza essere rilevato da una scansione.

### 12.2 Software

- **Inventario installato:** prodotti e versioni rilevati, aggregati per identificare diffusione e differenze.
- **Host di installazione:** individuazione delle postazioni con quel programma.
- **Sorgenti:** dati da Wazuh, agenti o acquisizioni disponibili secondo configurazione.
- **CVE e aggiornabilità:** dati di collegamento con vulnerabilità e matching Chocolatey, quando disponibili.
- **Filtri:** ricerca, sistema operativo e fonte.
- **Distinzione:** rilevare software non equivale a verificare il diritto contrattuale a usarlo.

### 12.3 Assegnatari e importazione AD

- **Anagrafica persone:** dati di contatto e organizzativi previsti dal modello.
- **Importa da AD:** selezione proposta degli utenti directory idonei, con conferma del tecnico.
- **Informazioni organizzative:** utilizzo di nome, cognome e attributi disponibili dalla sincronizzazione.
- **Utente prevalente:** raccolta di osservazioni da WinRM, GLPI e Wazuh secondo disponibilità; proposta di chi usa la postazione.
- **Proposta sull'asset:** suggerimento da confermare; le assegnazioni manuali non devono essere confuse con una deduzione tecnica.
- **Limite:** utente che accede, utilizzatore prevalente, responsabile del bene e proprietario del servizio sono ruoli diversi.

### 12.4 Abbinamenti

- **Revisione centralizzata:** pagina per esaminare proposte di relazione tra postazioni, persone e asset.
- **Conferma selettiva:** applicazione delle scelte ammesse, con ricalcolo prima della conferma.
- **Casi da rivedere:** evidenza dei conflitti, per esempio un bene già assegnato a un'altra persona.
- **Protezione dalle proposte vecchie:** le voci cambiate nel frattempo vengono saltate con un motivo, invece di applicare alla cieca una proposta non più valida.

### 12.5 Ubicazioni

- **Struttura gerarchica:** sedi, edifici, locali e rack.
- **Assegnazione:** collocazione di asset e oggetti per supportare interventi e inventari fisici.
- **Consultazione per luogo:** lettura del patrimonio nel contesto organizzativo.

### 12.6 Licenze

- **Registro delle licenze:** prodotto, tipologia, quantità, costi e fornitore.
- **Scadenze:** controllo dei termini contrattuali registrati.
- **Assegnazione agli asset:** relazione fra licenze acquistate e beni ai quali sono attribuite.
- **Disponibilità:** conteggi delle quantità acquisite, assegnate e residue secondo dati inseriti.
- **Limite:** è gestione dell'anagrafica contrattuale, non certificazione automatica della conformità delle licenze di ogni vendor.

### 12.7 Servizi NIS2

- **Censimento dei servizi:** nome, descrizione e criticità.
- **Asset coinvolti:** relazione fra servizio aziendale e infrastruttura.
- **Responsabilità:** responsabile tecnico e referente di business.
- **Dipendenze:** relazione fra servizi per leggere gli impatti potenziali.
- **Uso:** costruire una base documentata per la gestione dei servizi e degli asset; non presentare il solo modulo come certificazione di conformità NIS2.

## 13. Network Services

**Stato:** funzioni condizionali alla presenza della VM/servizio bridge e dei componenti configurati. Qui l'applicazione può modificare servizi di rete: è diverso dalla sola osservazione.

### 13.1 Panoramica

- **Salute dei componenti:** stato di resolver, filtro, DNS autoritativo e DHCP.
- **Accesso alla gestione:** ingresso alle relative funzioni senza cambiare strumento operativo.
- **Rilevazione dei guasti:** distinzione tra componente disponibile e problema della connessione al servizio.

### 13.2 DNS

- **Panorama:** metriche disponibili sulle interrogazioni e sul funzionamento del resolver.
- **Zone:** gestione delle zone e dei record tramite PowerDNS.
- **Zone inverse:** gestione della risoluzione inversa nei percorsi supportati.
- **Filtro:** regole e gestione del filtro AdGuard configurato.
- **Resolver:** parametri di upstream e cache tramite Unbound.

### 13.3 DHCP

- **Subnet/scope:** gestione degli ambiti di assegnazione supportati da Kea DHCP4.
- **Prenotazioni:** associazioni statiche per gli apparati.
- **Lease:** consultazione delle assegnazioni attive e dello storico esposto dal modulo.
- **Inventario:** utilizzo delle informazioni DHCP come fonte per gli host.

**Limite:** la sostituzione del DNS o DHCP esistente richiede un progetto di rete e un passaggio operativo; non avviene soltanto accendendo il modulo.

## 14. Applicativi: funzioni native e console collegate

La composizione del menu deriva dai moduli accesi. Le console esterne restano applicazioni distinte, anche quando aperte da DA-IPAM.

### 14.1 Patch Management → Panoramica

- **Vista dispositivi Windows:** host, software, CVE e prerequisiti di gestione remota.
- **Vista software:** programmi, versioni, vulnerabilità e possibilità di aggiornamento riconosciuta.
- **Matching:** relazione tra software rilevato, CVE e pacchetto Chocolatey.
- **Bootstrap Chocolatey:** preparazione degli host Windows tramite WinRM secondo flusso autorizzato.
- **Operazioni sugli host:** aggiornamento dei programmi supportati e lettura dell'esito.
- **Distribuzione Wazuh:** installazione dell'agente nel percorso previsto, con manager configurato.
- **Dettaglio dispositivo/software:** approfondimento delle installazioni e delle operazioni possibili.

### 14.2 Patch Management → CVE e Storico

- **CVE:** partire dalla vulnerabilità per vedere software e dispositivi interessati.
- **Storico:** consultare esecuzioni, risultati ed errori delle operazioni.
- **Automatismo Chocolatey:** preparazione automatica prevista dall'opzione dedicata, distinta dalla decisione di aggiornare qualsiasi software.
- **Limite:** non è un sistema universale di patch Windows, Linux, firmware e applicazioni. La copertura effettiva dipende da mapping, pacchetti e credenziali.

### 14.3 Controllo remoto → Dispositivi e Console MeshCentral

- **Elenco dispositivi:** oggetti associati al servizio di controllo remoto.
- **Sessione sull'host:** desktop, terminale e trasferimento file nei percorsi supportati.
- **Comandi remoti:** esecuzione delle azioni previste con registro di chi ha operato.
- **Distribuzione agente:** installazione tramite i percorsi previsti per Windows o script.
- **Senza agente:** percorso specifico da attivare, da non confondere con la totale assenza di prerequisiti di accesso remoto.
- **Console esterna:** apertura di MeshCentral per la gestione propria del prodotto.
- **Prerequisiti:** modulo, server configurato, autorizzazioni e raggiungibilità.

### 14.4 Zabbix → Pannello

- **Lettura dei problemi:** consultazione dei problemi di servizio dal sistema Zabbix configurato.
- **Contesto inventario:** correlazione operativa con gli oggetti presenti.
- **Sola lettura:** il pannello non sostituisce la console di amministrazione Zabbix.
- **Prerequisiti commerciali/operativi:** opzione separata; il profilo cliente resta di competenza di DA-Zabbix.

### 14.5 Console Scanner-Edge

- **Console di scansione:** accesso al servizio dedicato per le funzioni VA proprie della sonda.
- **Risultati in DA-IPAM:** vulnerabilità legate agli host nella pagina Sicurezza → Vulnerabilità.
- **Confine:** scanner, feed e motori VA appartengono a Scanner-Edge; non sono il motore di discovery di DA-IPAM.

### 14.6 Console Wazuh e integrazione nativa

- **Console SIEM:** accesso alla piattaforma per analisi e funzioni proprie di Wazuh.
- **Agenti collegati agli host:** utilizzo dell'inventario tecnico raccolto dagli agenti.
- **Vulnerabilità endpoint:** dati CVE utilizzati nelle viste di sicurezza e patch.
- **Eventi di sicurezza:** alimentazione delle viste e dei controlli dedicati.
- **Accessi alle postazioni:** fonte per le proposte sugli assegnatari quando gli eventi necessari sono presenti.
- **Salute del servizio:** controlli su manager, indexer, ingestione e repliche secondo configurazione.
- **Archivio immutabile:** esiste integrazione con lo stato del servizio di archiviazione/replica; l'immutabilità effettiva dipende dal sistema esterno installato e dalle sue politiche, non dal solo menu DA-IPAM.

### 14.7 Console LibreNMS e integrazione nativa

- **Monitoraggio SNMP:** apertura della console per storico, traffico, apparati e sensori.
- **Dati nella scheda:** utilizzo di porte, VLAN, vicini, MAC, ARP, inventario e sensori nei lettori supportati e abilitati.
- **Grafici:** accesso ai grafici associati all'apparato quando disponibili.
- **Riutilizzo dell'acquisizione:** le librerie e i dati LibreNMS ampliano la copertura senza scrivere un lettore autonomo per ogni caso.
- **Limite:** non garantire che ogni device SNMP venga registrato automaticamente o che ogni tabella di ogni vendor sia popolata. Configurazione, supporto e qualità della risposta restano determinanti.

### 14.8 Console Graylog, UniFi e Headwind

- **Graylog:** accesso alla gestione dei log operativi del servizio configurato; ricerca, conservazione e dashboard sono funzioni di Graylog.
- **UniFi:** apertura della console controller; le letture native restano nel percorso Network → Controller di rete e nelle schede.
- **Headwind MDM:** console per i dispositivi Android gestiti e importazione nel modello host secondo configurazione.
- **Limite MDM:** nei PDF è dichiarato alpha; il registro attuale prova la presenza dell'integrazione, non un collaudo generale di tutte le operazioni Android. Mantenerlo separato dall'offerta consolidata fino alla verifica dedicata.

### 14.9 Inventory Agent GLPI

- **Raccolta inventario:** ricezione dei dati dagli agenti GLPI compatibili senza richiedere un server GLPI completo per questo flusso.
- **Dati dell'host:** hardware, sistema e software secondo piattaforma e payload.
- **Utente rilevato:** uso dei dati disponibili nel percorso degli assegnatari.
- **Nessuna console autonoma nel menu:** i risultati alimentano schede e inventario; configurazione dal modulo.
- **Limite:** questa modalità usa un agente; la promessa «zero agenti» va limitata alla scoperta e alle acquisizioni che effettivamente non lo richiedono.

## 15. Anomalie

- **Cambi MAC/IP:** segnalazioni dei cambiamenti che richiedono attenzione, da distinguere fra normale DHCP e casi anomali.
- **Spostamenti di porta:** variazioni del collegamento osservato di un dispositivo.
- **Latenza anomala:** confronto con il comportamento di riferimento disponibile.
- **Host sconosciuti nuovi:** evidenza degli oggetti che devono essere identificati.
- **Variazioni di disponibilità:** problemi di presenza/uptime rilevati dal motore.
- **Filtri:** tipo e stato di gestione.
- **Esegui controllo:** richiesta di valutazione immediata prevista dalla pagina.
- **Dettaglio e presa in carico:** lettura del contesto e riconoscimento dell'evento come gestito.

**Distinzione:** Anomalie, Alert sicurezza e rilievi del trunk sono percorsi diversi. Oggi il tecnico deve saperli distinguere; la loro futura convergenza è un consiglio del §19, non una funzione già attestata.

## 16. Impostazioni, Opzioni, Schedulazioni e Cosa esce

### 16.1 Impostazioni

- **Istanza:** scelta del contesto per utenti abilitati a più istanze.
- **Utenti:** account, ruoli e requisiti di verifica in due passaggi.
- **Scansione:** parametri generali e profili dei motori supportati.
- **Identificazione:** configurazione del riconoscimento e dei profili previsti.
- **Job pianificati:** gestione delle attività schedulate nel percorso amministrativo.
- **HTTPS:** gestione della configurazione TLS prevista dall'applicazione.
- **Moduli:** configurazione, installazione ove prevista, collegamento, abilitazione e salute delle integrazioni.
- **Alert sicurezza:** regole, soglie e conservazione.
- **Notifiche:** destinazioni e parametri email/webhook; invio subordinato alle opzioni attive.
- **Aggiornamenti:** versione e gestione del percorso di aggiornamento.
- **Sistema:** parametri dell'appliance, URL dell'hub, strumenti e operazioni amministrative.
- **Pagine specialistiche:** profili SNMP, classificazioni, trasferimento configurazioni e altre pagine di supporto raggiunte dai relativi percorsi; non tutte sono voci principali di menu.
- **Backup ed export:** estrazione dati e copie di sicurezza secondo gli strumenti previsti.

### 16.2 Opzioni

- **Catalogo centralizzato:** elenco di ciò che può essere acceso o spento.
- **Spiegazione dell'effetto:** ogni opzione descrive cosa legge o fa e cosa si interrompe spegnendola.
- **Letture degli apparati:** controllo delle acquisizioni aggiuntive supportate.
- **Moduli:** abilitazioni disponibili con rimando alla configurazione.
- **Automatismi:** Chocolatey, feed exploit, attribuzione, Naabu, freni sullo stato offline, accessi ai PC, controllo remoto senza agente e mappa con cavi.
- **Uscite:** abilitazioni e livello dei flussi verso DA-Link e DA-Vul-can.
- **Parametri e soglie:** valori modificabili e ritorno ai valori previsti dal catalogo.
- **Voci governate dal server:** mostra anche le condizioni che richiedono configurazione dell'appliance; non tutte sono normali interruttori del browser.

### 16.3 Schedulazioni

- **Quadro delle attività:** elenco di job e timer delle varie sorgenti gestite.
- **Frequenza:** lettura di quando le attività vengono eseguite.
- **Stato e provenienza:** distinzione fra attività dei job, controller, Edge e timer interni.
- **Uso:** controllare la copertura reale e spiegare perché un dato può non essere ancora aggiornato.
- **Limite:** un orario scritto non prova che l'ultima esecuzione sia riuscita; la lettura va incrociata con esiti e dati.

### 16.4 Cosa esce

- **DA-Link:** stato del segnale di vita e livello dei dati previsti.
- **Anteprima del segnale:** informazioni su cosa conterrebbe o contiene il prossimo invio.
- **DA-Vul-can:** stato delle uscite di AD Health e inventario.
- **Invia ora:** richiesta del flusso previsto, quando configurato e consentito.
- **Registro delle scelte:** traccia delle decisioni di configurazione.
- **Coda ed errori:** controllo dell'esito dei flussi invece di assumere che l'invio sia riuscito.
- **Confine dati:** l'export inventario verso DA-Vul-can usa una lista ammessa; non vi vanno automaticamente credenziali, note, licenze o tutti i dati dell'istanza.
- **Limite della formula commerciale:** «non esce mai nulla» sarebbe scorretto. Inventario, AD Health, segnale di vita, feed e integrazioni hanno flussi diversi; la formula deve specificare quale flusso e quale configurazione.

## 17. Vault, OpenBao e KeePass KDBX: evoluzione recente

**Percorso:** pagina dedicata `/settings/vault`, API e strumenti amministrativi. Non aggiungere una voce autonoma nella descrizione della sidebar: il menu principale ha Impostazioni.

### 17.1 Che cosa esiste

- **Archivio storico:** cifratura con la chiave dell'appliance, ancora valida quando il nuovo vault è spento.
- **Vault locale a slot:** archivio cifrato con modalità di apertura previste per cliente, Domarc e TPM, secondo inizializzazione.
- **Stato visibile:** spento, bloccato o sbloccato e modalità di apertura; indicazioni sugli slot disponibili.
- **Sblocco dal browser:** passphrase cliente nel percorso previsto quando manca l'apertura automatica.
- **Pausa delle scansioni:** se il vault necessario non è leggibile, il sistema evita di proseguire come se i segreti fossero disponibili.
- **OpenBao:** backend per i riferimenti alle credenziali nei percorsi configurati, con stato, autenticazione e cache a tempo.
- **Errore esplicito:** OpenBao non disponibile oltre la cache non deve diventare un ripiego silenzioso su un'altra copia del segreto.
- **Mostra password:** consultazione riservata all'amministratore con conferma in due passaggi e finestra di autorizzazione prevista dal codice.
- **Chi ha visto cosa:** registro di visualizzazioni, esportazioni e scaricamenti del key file, con utente e ora.
- **Migrazione e recupero:** strumenti da riga di comando per ricifratura, migrazione, recupero e rotazione; operazioni amministrative, non normali pulsanti commerciali.
- **Backup:** il percorso vault prevede anche gli elementi cifrati necessari a riaprire i dati ripristinati.

### 17.2 Che cosa significa l'integrazione KeePass

- **Formato:** esportazione in un nuovo archivio **KDBX 4**, con derivazione Argon2id.
- **Protezione:** apertura con passphrase del cliente **più** key file; non basta una sola delle due componenti.
- **Key file:** scaricamento separato `.keyx`; il codice lo conserva e lo riutilizza nelle esportazioni dell'archivio.
- **Prerequisiti:** amministratore autorizzato, vault locale acceso e sbloccato, schema disponibile e passphrase valida.
- **Contenuto:** esportazione delle voci dell'archivio credenziali gestite dalla funzione; titolo, utente, password, note tecniche e campi protetti aggiuntivi previsti, comprese informazioni SSH/SNMP supportate.
- **Voci non leggibili:** il codice può saltarle e restituisce conteggi di esportate e saltate. Evitare la promessa incondizionata «tutti i segreti dell'applicazione».
- **Tracciamento:** export KDBX e scaricamento del key file vengono registrati.
- **Finalità:** dare al cliente una copia portabile delle credenziali senza mantenere un secondo archivio operativo sincronizzato.

### 17.3 Che cosa non risulta dimostrato da questo percorso

- Non è attestata una funzione di importazione di un KDBX arbitrario del cliente.
- Non è attestata una sincronizzazione bidirezionale con KeePass/KeePassXC.
- Non è attestato l'uso del file KDBX come archivio vivo consultato a ogni scansione.
- Non è attestato che tutte le installazioni abbiano già attivato e migrato il nuovo vault.
- Il codice recente non è più soltanto un'idea: esistono pagina, API, backend e prove nel repository. **Attivazione e collaudo sull'appliance restano uno stato separato.**

**Descrizione corretta per questa fase:** «Nuovo vault con esportazione delle credenziali in KeePass KDBX 4, protetta da passphrase e key file; disponibilità subordinata all'attivazione e alla verifica dell'installazione».

## 18. Copertura dei prodotti e rettifiche al materiale precedente

### 18.1 Supporto modulare

- **Fonte della compatibilità:** catalogo dei collector con prodotti, protocolli, sezioni popolate, modelli/firmware provati e limiti.
- **Famiglie presenti nel catalogo letto:** QNAP switch, HP ProCurve/ArubaOS-Switch, HP Comware, VMware ESXi diretto, NetApp ONTAP, QNAP NAS, MikroTik RouterOS, Windows, Linux, Synology DSM, Ubiquiti diretto, Proxmox VE e controller UniFi.
- **Diversi livelli di supporto:** riconoscimento generico, lettura SNMP, collector dedicato e lettura tramite controller non sono equivalenti.
- **Collaudo parziale:** la voce «collaudato» può accompagnarsi a sezioni non provate. Esempi nel catalogo: alcune tabelle SNMP Comware, ruolo Hyper-V nel campione Windows, parti dell'inventario Linux, condivisioni/pacchetti NAS, SSH Ubiquiti e dati radio UniFi.
- **Compatibilità commerciale:** nominare prodotto e livello verificato; non estendere il collaudo di un modello a tutta la marca.
- **Evoluzione rispetto ai PDF:** «lettura per prodotto in anteprima» è troppo generale per alcune famiglie ora documentate e collaudate; serve distinguere famiglia, sezione e percorso di acquisizione.

### 18.2 Correzioni necessarie prima di rifare marketing e slide

- **«Trova tutto»:** sostituire con scoperta degli oggetti visibili alle reti e alle fonti configurate. Gli oggetti spenti, isolati o non osservati possono mancare.
- **«Zero agenti»:** vero per i percorsi agentless, non per tutte le funzioni; Wazuh, GLPI e alcune modalità di controllo remoto richiedono agenti.
- **«Tutto incluso da subito»:** distinguere disponibilità nel prodotto, componente installato, configurazione completata e funzione accesa.
- **«Ogni 30 minuti / ogni notte»:** presentare come cadenze configurate o di serie quando verificate, non come comportamento universale; esistono job modificabili e freni sulle reti grandi.
- **«Sa chi usa ogni PC»:** descrivere una proposta fondata su osservazioni disponibili e confermata dall'operatore; non un'identità certa per ogni postazione.
- **«Mappa sempre esatta»:** chiarire fonti, incertezze e possibilità di correzione manuale.
- **«Centinaia di marche lette»:** attribuire la copertura al sistema SNMP/LibreNMS disponibile, senza promettere ogni informazione per ogni marca.
- **«Password mai esportate»:** delimitare la frase alle uscite automatiche considerate: il nuovo export KDBX è proprio una esportazione autorizzata di segreti cifrati.
- **«Log impossibili da cancellare e validi come prova»:** descrivere il servizio di conservazione configurato e le sue verifiche; non attribuire una garanzia assoluta alla semplice integrazione SIEM.
- **«Sostituisce QRadar/BusinessLog»:** usare un confronto di casi d'uso e requisiti, non un'equivalenza tecnica totale non misurata.
- **«NIS2»:** parlare di supporto a inventario, responsabilità e gestione delle evidenze; nessuna promessa di conformità automatica.
- **«Installazione con un comando»:** separare la procedura documentata dall'effettivo collaudo dell'immagine e dell'ambiente di destinazione. In questa analisi non è stato verificato Deploy-Appliance.
- **«Report Word/PDF e analisi IA»:** attribuirli a DA-Vul-can; DA-IPAM acquisisce e trasferisce i dati previsti.
- **Numero dei moduli:** il registro letto contiene 12 descrittori; Zabbix è un pannello separato e il trunk ha una opzione dedicata. Evitare vecchi conteggi fissi o il totale dei servizi come indicatore del valore.
- **Base/opzione commerciale:** `offerta.ts` distingue base e opzioni; Patch, Wazuh, MeshCentral, MDM e pannello Zabbix sono opzioni nel codice. Il diritto attuale è provvisoriamente sempre ammesso: non presentarlo come un sistema di licenze già completo.

## 19. Valutazione ed evoluzioni consigliate

Richiesta aggiunta da Riccardo il 25/10: valutare evoluzioni e consigli rispetto all'esistente. Le voci seguenti sono **proposte**, senza modifiche al software o autorizzazione a eseguirle. Le priorità sono una valutazione di prodotto basata sul codice letto, non il risultato di misure sul campo.

### 19.1 Valutazione complessiva

- **Punto di forza:** la relazione fra scoperta, apparato, porta, asset, persona e vulnerabilità. È più distintiva del semplice elenco delle integrazioni.
- **Secondo punto di forza:** gestione locale del cliente con moduli collegati e controllo delle uscite, utile per il lavoro quotidiano dei tecnici.
- **Terzo punto di forza:** collector e schede per famiglia; consentono di usare i dati dell'apparato senza aprire ogni volta la sua console.
- **Area da consolidare:** l'utente può vedere più percorsi per lo stesso oggetto o problema; qualità e freschezza delle fonti devono essere leggibili quanto i valori raccolti.
- **Rischio di comunicazione:** il prodotto sembra più uniforme di quanto sia quando si accorpano funzioni native, integrazioni, moduli da configurare e sviluppi recenti.
- **Direzione proposta:** prima rendere misurabili copertura e affidabilità, poi ampliare automazioni e nuove famiglie. Non servono altre integrazioni soltanto per aumentare il loro numero.

### 19.2 Priorità alta — distinguere disponibile, attivo, letto e verificato

- **Presente:** registro moduli, controlli di salute, esiti scansioni, Opzioni, Schedulazioni e stati specifici del trunk/vault.
- **Evoluzione:** rendere coerente su schede e liste una sintesi «fonte, ultima riuscita, completezza, problema, prossimo passo».
- **Perché:** un dato vecchio o parziale non deve sembrare attuale soltanto perché è presente.
- **Dipendenze:** riuso delle strutture di stato esistenti e definizione comune dei casi; proposta dell'interfaccia prima di implementare.
- **Accettazione suggerita:** il tecnico distingue senza aprire log un oggetto mai letto, uno aggiornato, uno parziale e uno con ultima lettura fallita.

### 19.3 Priorità alta — chiudere il percorso operativo del trunk

- **Presente:** osservazioni, reti, otto regole, filtri e presa in carico.
- **Evoluzione:** baseline esplicita per VLAN, DHCP e ruoli attesi, con eccezioni motivate e scadenza; evitare di cancellare il rilievo per far sparire il problema.
- **Evoluzione:** distinguere assegnato, verificato come legittimo, corretto e ricomparso. La sola presa in carico non chiude il ciclo.
- **Evoluzione:** indicare copertura fisica della sonda e attendibilità dei dati dedotti; distinguere cosa è visto sul trunk da una eventuale futura acquisizione mirror/SPAN.
- **Perché:** rendere le segnalazioni azionabili e ridurre i falsi positivi strutturali di router, hypervisor e reti ridondate.
- **Dipendenze:** ruoli, baseline, storia degli eventi e collaudo su reti rappresentative. Mirror/SPAN è una valutazione futura, non un prerequisito già dichiarato per tutte le funzioni attuali.
- **Accettazione suggerita:** un DHCP legittimo preso come baseline non genera ripetutamente lo stesso allarme; un secondo DHCP inatteso resta visibile; l'operatore vede quali VLAN non sono osservabili.

### 19.4 Priorità alta — completare la verifica del vault prima della promessa commerciale

- **Presente:** backend locale/OpenBao, slot, esportazione KDBX, registro e strumenti di migrazione/recupero.
- **Evoluzione:** verbale di collaudo per installazione con apertura normale, riavvio, vault bloccato, OpenBao non disponibile, backup/ripristino ed esportazione leggibile da KeePassXC/KeePass.
- **Evoluzione:** rendere evidente nel browser se l'export è completo, con conteggio e motivazione delle voci saltate. Il codice ha il conteggio, ma non basta che sia in una intestazione HTTP.
- **Evoluzione:** procedura consegnabile al cliente per conservare passphrase e key file, recuperare l'accesso e distinguere i diritti cliente/Domarc.
- **Perché:** la portabilità conta solo se il cliente può realmente riaprire quanto esportato e recuperare un backup.
- **Dipendenze:** piano da-vault esistente; nessuna migrazione nuova da questa analisi.
- **Accettazione suggerita:** esportazione aperta con entrambi i fattori, rifiuto se uno manca, conteggio verificato, ripristino provato in ambiente separato.

### 19.5 Priorità alta — matrice reale dei collector

- **Presente:** catalogo con protocolli, sezioni e campioni collaudati.
- **Evoluzione:** vista/documentazione generata dal catalogo per famiglia, modello/firmware, protocollo, sezioni verificate e limiti aperti.
- **Perché:** il collega deve sapere prima di un intervento se vedrà solo identità e porte oppure anche VLAN, storage, PoE e sensori.
- **Dipendenze:** completare le versioni firmware mancanti e ricollaudare le sezioni già dichiarate da ricontrollare.
- **Accettazione suggerita:** nessuna marca presentata come supportata senza un livello e un limite dichiarati; le sezioni parziali restano visibili.

### 19.6 Priorità media — una coda di lavoro per il tecnico

- **Presente:** Anomalie, Alert sicurezza, trunk, CVE, proposte assegnatari e problemi moduli.
- **Evoluzione:** ingresso comune per ciò che richiede un'azione, mantenendo le fonti distinguibili e le pagine specialistiche.
- **Perché:** l'operatore non dovrebbe visitare cinque schermate per scoprire le priorità della giornata.
- **Dipendenze:** identità stabile dell'oggetto, regole di aggregazione e deduplica; non nascondere errori di fonte sotto un generico «nessun problema».
- **Accettazione suggerita:** ciascuna voce ha oggetto, motivo, fonte, responsabile e azione successiva; lo stesso fatto non si conta più volte senza indicarlo.

### 19.7 Priorità media — dall'utente prevalente alla responsabilità dell'asset

- **Presente:** import AD, osservazioni di accesso, proposte e conferma.
- **Evoluzione:** spiegazione leggibile della proposta: sorgenti, finestra temporale, evidenza principale e conflitti; distinguere assegnatario, utilizzatore e account di servizio.
- **Perché:** evita attribuzioni sbagliate su PC condivisi, server e postazioni di assistenza.
- **Dipendenze:** qualità dei nomi AD e riconciliazione degli host; rispetto delle assegnazioni manuali già previsto.
- **Accettazione suggerita:** un collega capisce perché una persona è proposta e può rifiutare con motivazione senza perderne traccia.

### 19.8 Priorità media — onboarding che misura la copertura

- **Presente:** setup, reti, credenziali, Opzioni e salute moduli.
- **Evoluzione:** percorso guidato per rete: raggiungibilità, fonte ARP/DHCP, credenziale, prima lettura, topologia, eventuale trunk e sicurezza.
- **Perché:** «installato» deve trasformarsi in «sta raccogliendo i dati che ci servono».
- **Dipendenze:** riuso di verifiche esistenti; attività attive ben distinguibili da letture e anteprime.
- **Accettazione suggerita:** a fine avvio il tecnico ha un elenco delle fonti funzionanti e dei buchi di copertura, non soltanto una pagina verde.

### 19.9 Priorità media — spiegare il rischio attraverso servizi e dipendenze

- **Presente:** asset, servizi, criticità, dipendenze, CVE ed exploit intelligence.
- **Evoluzione:** priorità che unisca esposizione tecnica, sfruttamento noto e impatto del servizio, mostrando come è stata ottenuta.
- **Perché:** una CVE su un servizio essenziale può richiedere un ordine operativo diverso da una su un bene marginale.
- **Dipendenze:** qualità del censimento servizi e associazioni affidabili; non introdurre un punteggio opaco prima di avere dati sufficienti.
- **Accettazione suggerita:** per ogni priorità il tecnico vede le evidenze che l'hanno alzata e quelle mancanti.

### 19.10 Priorità successiva — interventi verificati, non solo lanciati

- **Presente:** operazioni patch, storico e controllo remoto.
- **Evoluzione:** anteprima degli host coinvolti, prerequisiti, finestra operativa ed esito verificato dopo l'azione; esportazione delle evidenze dell'intervento.
- **Perché:** il successo del comando non dimostra sempre che software o vulnerabilità siano cambiati.
- **Dipendenze:** affidabilità del matching e rilettura successiva; ogni azione sui sistemi cliente richiede il flusso di autorizzazione applicabile.
- **Accettazione suggerita:** distinguere comando riuscito, versione riletta, problema ancora presente e verifica impossibile.

### 19.11 KDBX in ingresso: scelta da non fare automaticamente

- **Esigenza possibile:** riutilizzare un database KeePass già posseduto dal cliente.
- **Prima scelta da chiarire:** importazione una tantum oppure archivio esterno consultato nel tempo. Sono comportamenti diversi.
- **Consiglio:** se emerge una domanda reale, valutare prima un'importazione guidata con anteprima, mapping dei tipi, gestione dei duplicati e nessuna sovrascrittura implicita.
- **Perché:** la sincronizzazione bidirezionale crea conflitti, cancellazioni e due fonti operative; contraddice la scelta attuale di un solo archivio vivo.
- **Priorità proposta:** successiva al collaudo del vault/export, salvo un caso cliente concreto. Non è assenza di valore: è dipendenza dalla stabilità della gestione dei segreti.

### 19.12 Ordine consigliato per marketing e formazione

- **Prima:** consolidare il catalogo con conferma delle attivazioni reali, senza modificare il software.
- **Poi, per i colleghi:** tre percorsi di lavoro: prendere in carico una rete, approfondire un apparato, gestire una segnalazione. Usare un caso con dati dimostrativi e prerequisiti espliciti.
- **Poi, per il marketing:** problema del cliente → funzione → risultato pratico → requisiti. Le integrazioni vanno dopo il valore del nucleo.
- **Separatamente:** pagina delle evoluzioni con trunk, vault e coperture recenti, indicando cosa è già nel codice e cosa è verificato in esercizio.
- **Nessuna esecuzione automatica:** queste indicazioni non avviano piani, sviluppo, migrazioni o sessioni aggiuntive.

## 20. Fonti tecniche e tracciabilità

Tutti i percorsi seguenti sono stati risolti nella copia del commit `76b15198`. Per una lettura riproducibile del codice usare il [commit esaminato](https://github.com/grandir66/DA-IPAM/tree/76b15198); i file del working tree locale possono avere contenuto precedente.

- **Menu:** `src/components/shared/sidebar.tsx`; `src/lib/modules/voci-applicativi.ts`.
- **Pagine:** `src/app/(dashboard)/`, con censimento dei file `page.tsx` per controllare voci principali, dettagli e pagine di configurazione.
- **Moduli e offerta:** `src/lib/modules/registry.ts`, `offerta.ts`, `health.ts`.
- **Uso generale e procedure:** `docs/MANUALE-UTENTE.md`, `docs/MANUALE-ACTIVE-DIRECTORY.md`, `docs/MANUALE-WINRM.md`; confrontati con il menu attuale nei punti cambiati.
- **Schede per tipo:** `src/lib/scheda/tipo-scheda.ts`; `src/components/scheda/`.
- **Topologia:** `src/components/topology/map/`, `src/components/topology/unioni/`, `src/components/topology/print/`.
- **Trunk, pagina:** `src/app/(dashboard)/arp-table/trunk/page.tsx`, `trunk-client.tsx`, `rilievi-pannello.tsx`.
- **Trunk, motore e tempi:** `src/lib/trunk/sensore-trunk.ts`, `job.ts`, `reti.ts`.
- **Trunk, regole e gestione:** `src/lib/trunk/rilievi.ts`, `rilievi-tipi.ts`; `src/app/api/trunk/`.
- **Vault, uso e stati:** `src/components/vault/pagina-vault.tsx`; `src/app/(dashboard)/settings/vault/page.tsx`; `src/lib/vault/appliance.ts`, `mostra.ts`, `stato.ts`.
- **KeePass, prova del perimetro:** `src/lib/vault/keepass.ts`; `src/app/api/vault/keepass/route.ts`. L'esportazione lavora sulle voci `credentials`, non su un import KDBX generico.
- **Vault, disegno della chiave:** `docs/adr/0034-vault-chiave-degli-slot.md`; strumenti `scripts/da-vault*.ts`; prove in `src/lib/vault/__tests__/`.
- **Credenziali:** `src/lib/credentials/segreti.ts`; `src/lib/credentials-vault.ts`.
- **AD:** `src/app/(dashboard)/active-directory/page.tsx`; `src/lib/ad/`; `src/lib/ad/health/`.
- **Assegnatari:** `src/lib/assegnatari/`; pagine `inventory/assignees`, `inventory/assignees/import-ad`, `inventory/abbinamenti`.
- **Compatibilità:** `src/lib/acquisition/catalogo.ts`; `docs/modules/acquisition.md`; il registro storico di acquisizione in `src/lib/devices/acquisition/registry.ts` è distinto dal catalogo dei collector.
- **LibreNMS/Wazuh:** `src/lib/integrations/librenms-lettori.ts`, `librenms-sync.ts`, `wazuh-health.ts`, `wazuh-alerts-sync.ts`, `immutable-store-api.ts`.
- **Opzioni:** `src/lib/opzioni/catalogo.ts`; pagine `settings/opzioni`, `settings/schedulazioni`, `settings/page.tsx`.
- **Uscite:** `src/components/settings/cosa-esce.tsx`; `src/lib/vulcan/`.
- **Evoluzioni già annotate dal progetto:** `CHANGELOG.md`, `CONTEXT.md`, `TASKS.md`. Usate come contesto e registro, senza attribuire a una spunta storica il valore di un nuovo collaudo.

**Verifica di questa consegna:** confronto dell'indice con tutte le voci statiche della sidebar e con le voci dinamiche degli applicativi; controllo dell'esistenza delle fonti elencate nello snapshot. Nessun test applicativo rieseguito perché non è stato modificato codice.


## 21. Approfondimenti aggiunti dopo il riscontro di incompletezza (26/10/2026)

La copertura per menu non era sufficiente: queste parti erano omesse o descritte troppo sommariamente. Non sono funzioni nuove sviluppate in questa sessione.

- **Discovery:** viste e colonne; test credenziali; preparazione agent/moduli; SSH, RDP, VNC e web; riconciliazione degli IP con «Unisci con / Separa»; modifica dei soli campi attivati nella selezione multipla.
- **Credenziali:** «Usata da» mostra le dipendenze da apparati, reti, host, controller, AD e Proxmox; una voce in uso non si elimina né cambia tipo senza prima rimuoverne gli utilizzi.
- **Controller:** letture apparati e client distinte, cronologia con nuovi/aggiornati/saltati ed errori, certificato fissato e cambio di impronta da gestire esplicitamente.
- **Asset:** vista NIS2 ed estesa; identificazione, ubicazione, responsabilità, ciclo vita, tecnico, compliance, servizi, licenze, storico, economico e supporto; sync da Discovery, modalità forzata e audit dei campi cambiati. L’elenco espone gap e export audit secondo i dati disponibili.
- **Servizi:** RTO/RPO, business/technical owner e SLA; asset primari, secondari e di supporto; avviso per servizi in scope senza primari. La lettura dell’impatto dipende dalla qualità dei legami censiti.
- **Licenze:** posti, scadenza e soglia di disponibilità, oltre all’anagrafica. Non sono equivalenti al solo inventario installato.
- **Patch:** dettagli per dispositivo, prodotto e CVE; probe, mapping/pin manuale, patch e disinstallazione nei percorsi previsti. Lo storico distingue probe/bootstrap/upgrade/install/uninstall/rollback e stati di coda, esecuzione, successo, errore, annullamento e riavvio richiesto. Il tipo «rollback» nel registro non garantisce ripristino per ogni pacchetto.
- **Identificazione:** firme e priorità; lookup sysObjectID; mappa prefissi MAC; feedback delle correzioni manuali con proposta di regola; copertura delle credenziali validate per categoria. I profili SNMP e la libreria OID hanno import/export e scelte di sovrascrittura dei non builtin.
- **Moduli:** 13 varianti di pagina di configurazione nel registro `MODULI_CON_PAGINA`, incluse Loki e credenziali di sistema. Non confondere questo conteggio con quello dei descrittori commerciali.
- **Trasferimento:** bundle `.dab` con passphrase, livelli ed eventuale vault di sistema; import con unione o svuotamento preventivo. La modalità wipe-and-load è distruttiva; la sua presenza nel codice non è un collaudo di tutti i casi.
- **Dossier cliente:** pagina legacy con accessi, reti, switch/firewall, linee, Wi-Fi/VPN, storage, AD, server, virtualizzazione/VM, posta, centralino, software, cloud, backup, gestionali e apparati; import JSON ed export Markdown. Il modello contiene campi testuali denominati credenziali: non attribuirgli automaticamente la protezione del nuovo vault; verificarne il trattamento prima di usare dati sensibili o distribuire export. La voce «Config istanza» nel menu è ancora segnata in arrivo.
- **Accesso e amministrazione:** login/setup, menu utente, scelta istanza, utenti/ruoli/2FA, HTTPS, canale aggiornamenti, strumenti di sistema e pagina Istanze riservata all’hub.
- **Compatibilità:** nove pagine inoltrano a percorsi precedenti o attuali; il vecchio dettaglio apparato può inoltrare alla scheda unificata quando esiste l’host. Non sono altrettante schermate autonome.

La guida aggiornata distingue 66 file di pagina dashboard, tab interne, otto famiglie di scheda approfondite, tredici configurazioni modulo e accessi fuori dal gruppo dashboard. La guida del 26/10 comprende 176 catture della demo dedicata sul mini, incluse tab e varianti. Gli stati senza servizi esterni e il ramo legacy restano esplicitamente condizionali; le catture non attestano scansioni, patch o collaudi delle integrazioni. Vault: sblocco e API di export KDBX/key file verificati solo su archivio sintetico.

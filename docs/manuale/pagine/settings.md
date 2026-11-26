---
percorso: /settings, /settings/features, /settings/updates, /appliance, /integrations, /launchpad
titolo: Impostazioni e Config — utenti, aggiornamenti, moduli e configurazione tecnica
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

È la pagina di **tutte le impostazioni dell'installazione**. Nel menu a sinistra, sotto **Sistema**, compare due volte:

- **Impostazioni** raccoglie le cose che servono anche a chi usa DA-IPAM tutti i giorni: **Utenti**,
  **Aggiornamenti**, **Moduli**, **Istanza** (solo per chi lavora su più istanze), poi
  [Opzioni](pagine/settings-opzioni.md), [Schedulazioni](pagine/settings-schedulazioni.md) e **Notifiche**.
- **Config** raccoglie la configurazione tecnica, riservata agli amministratori: **Scansione**,
  **Identificazione**, **Alert sicurezza**, **HTTPS**, **Sistema** e [Cosa esce](pagine/settings-cosa-esce.md).

Le schede in cima funzionano come spiegato nelle [parti comuni dell'interfaccia](../INTERFACCIA.md); quella accesa è
colorata. Ogni scheda ha un suo indirizzo (`/settings?tab=utenti`, `/settings?tab=moduli`…), quindi si può salvare
fra i preferiti o mandare a un collega. Il pulsante **?** apre questa guida direttamente al paragrafo della scheda
aperta.

![Le schede di Impostazioni](/manuale/settings/schede.png)

![Le schede di Config](/manuale/settings/schede-config.png)

Chi è in **sola lettura** vede Aggiornamenti, Moduli, Opzioni, Schedulazioni e Notifiche; Utenti e tutta la fila di
Config compaiono solo agli amministratori. Anche nelle schede che vede, chi è in sola lettura non cambia niente: alcuni
pulsanti restano premibili, ma il programma rifiuta la modifica.

Alcuni indirizzi vecchi portano qui da soli: `/settings/features`, `/appliance`, `/integrations` e `/launchpad`
aprono la scheda **Moduli**, `/settings/updates` apre la scheda **Aggiornamenti**.

Quando c'è una versione nuova del programma, sopra le schede compare un'etichetta del tipo «v0.9.1400 disponibile
(installata v0.9.1367)»: un clic porta alla scheda Aggiornamenti.

## Utenti {#utenti}

Gli account che possono entrare in DA-IPAM. La scheda è solo per gli amministratori: chi è in sola lettura vede
la scritta «La gestione degli utenti è riservata agli amministratori».

![La scheda Utenti](/manuale/settings/utenti.png)

1. `tasto:plus` **Nuovo utente**: apre il modulo per creare un account. Si scrivono **Username** (almeno 3
   caratteri, per esempio nome.cognome), **Email** (serve per reimpostare la password), **Password** (almeno 8
   caratteri) e **Ruolo**, poi **Crea utente**. I ruoli:
   - **Amministratore**: vede e cambia tutto nella sua istanza.
   - **Solo lettura**: vede tutto, non cambia niente.
   - **Cliente (vista semplice)**: una vista ridotta, pensata per il personale del cliente.
   - **Super amministratore**: lo vede solo chi è già super amministratore; vale per tutte le istanze.
   Chi lavora con più istanze sceglie anche il **Cliente** (o i **Clienti assegnati**) a cui l'utente ha accesso.
2. **Due passaggi**: la verifica in due passaggi, cioè il codice dell'app di autenticazione chiesto oltre alla
   password. Lo stato si legge col segno:
   - **–** non richiesta: l'utente entra con la sola password. Il collegamento **Richiedi** la chiede: al prossimo
     accesso l'utente dovrà inquadrare un QR con l'app.
   - **▲ da attivare**: richiesta, ma l'utente non ha ancora inquadrato il QR. **Togli** la annulla.
   - **✓ attiva**: entra con password e codice. **Azzera** serve quando ha perso il telefono (al prossimo accesso
     rifà il QR); **Togli** la toglie del tutto.
   Non si può togliere la verifica a se stessi: va chiesto a un altro amministratore. Chi entra con l'account
   Domarc non ne ha bisogno.
3. **Azioni** di ogni riga:
   - `icona:pencil` **Modifica ruolo e tenant**: cambia ruolo e clienti assegnati (poi **Salva**);
   - `icona:key` **Reimposta password**: una nuova password per quell'utente (almeno 8 caratteri). Sulla propria
     riga è grigia: la propria password si cambia dal menu dell'utente;
   - `icona:trash` **Elimina utente**, dopo una conferma. Sulla propria riga è grigio: non si elimina il proprio
     account.

Le altre colonne: **Username**, **Email**, **Ruolo**, **Cliente** (le istanze a cui ha accesso; «Tutti i clienti»
per il super amministratore), **Creato il**, **Ultimo accesso** («Mai» se non è mai entrato).

### Accesso d'emergenza

![L'accesso d'emergenza](/manuale/settings/emergenza.png)

Una frase da stampare e chiudere in una busta, per entrare se l'amministratore perde password, telefono e codici.
Vale una volta sola, per 60 minuti, e ogni uso resta nel registro degli accessi. Lo stato si legge sotto il titolo
(«Assente. Nessuna frase preparata», oppure la data in cui è stata preparata).

- **Prepara…** la crea; può essere chiesto il **Codice a 6 cifre dell'app** di autenticazione. La frase si mostra
  una volta sola, con `tasto:copy` **Copia** e **Stampa**, e la finestra si chiude con **L'ho messa in busta**.
- Se ce n'è già una, il pulsante diventa **Rigenera…** (la vecchia smette di valere) e compare **Togli**, che la
  annulla dopo una conferma.

## Aggiornamenti {#aggiornamenti}

Che versione di DA-IPAM gira, se ce n'è una più nuova, e da dove arrivano gli aggiornamenti.

![La versione installata](/manuale/settings/aggiornamenti.png)

1. `tasto:refresh` **Ricontrolla**: chiede subito se c'è una versione nuova, senza aspettare il controllo automatico.
2. **Versione installata**: **Installata** è la versione che gira adesso, **Disponibile su…** quella pubblicata sul
   canale scelto (in arancione se è più nuova), **Ultimo controllo** quando si è guardato l'ultima volta. Se è tutto
   a posto si legge «Appliance allineata al canale». Se c'è una versione nuova compaiono l'etichetta **Aggiornamento
   disponibile** e il pulsante `tasto:rocket` **Aggiorna ora a v…**: l'aggiornamento dura 2-5 minuti e il programma
   continua a rispondere finché non si riavvia. Accanto, il riquadro **Changelog** elenca le ultime modifiche
   pubblicate sul canale.

Sotto, il riquadro **Stato dell'aggiornamento** dice come è andato l'ultimo giro. Ogni aggiornamento (dal controllo
automatico o da «Aggiorna ora») si prepara in una cartella separata e passa alla versione nuova solo se il programma
risponde dopo il riavvio; altrimenti torna da solo alla versione di prima. Le righe: **Codice scaricato**, **Avviato
con salute buona**, **Ultimo controllo**, e sotto **Ultimo tentativo** con l'esito (riuscito, fallito, in corso).

### Il canale

![Il canale degli aggiornamenti](/manuale/settings/canale.png)

**Canale aggiornamenti**: da dove si prendono le versioni nuove.

- **Stable (main)**: quello delle installazioni dai clienti. Riceve solo i rilasci approvati.
- **Dev (dev)**: riceve ogni modifica in sviluppo. Solo per le installazioni di prova; prima di passarci si conferma.

Un clic su un riquadro cambia canale; quello in uso porta la scritta **attivo**, e il cambio vale dal prossimo
controllo automatico (entro 15 minuti). Sotto si leggono il ramo installato, il ramo configurato, se il file di
configurazione si può scrivere e l'esito del controllo della **firma dei rilasci** (ogni rilascio è firmato e viene
controllato prima di installarlo). Il riquadro `icona:rocket` **Rilascio su main** dice quante modifiche di sviluppo
aspettano di passare ai clienti: **Mostra commit** le elenca. Il rilascio non parte da questa pagina: lo fa chi
rilascia, con un commit firmato.

Altri avvisi che possono comparire: **Branch fuori dal canale configurato** (l'installazione è rimasta su un ramo
diverso da quello del canale; il pulsante **Riallinea al canale** la rimette a posto), e, per le installazioni in
Docker, la spiegazione che l'aggiornamento da qui non è disponibile.

## Moduli {#moduli}

L'elenco di tutti i moduli e le integrazioni: Scanner-Edge, Patch Management, Network Services, LibreNMS, Graylog,
Wazuh, MeshCentral, Inventory Agent, Inventario NIS2, MDM, Controller UniFi, il pannello Zabbix, Grafana Loki e le
credenziali di sistema. Ogni modulo si configura e si verifica nella sua pagina.

![La scheda Moduli](/manuale/settings/moduli.png)

1. `tasto:upload` **Importa configurazione modulo (JSON)**: carica la configurazione di un modulo da un file JSON
   preparato prima (per esempio da un'altra installazione). Solo per amministratori.
2. **Apri**: porta alla pagina del modulo, dove lo si configura, lo si prova e se ne legge lo stato
   ([pagina di un modulo](pagine/settings-moduli-key.md)). Per l'MDM porta a [MDM (Headwind)](pagine/settings-mdm.md).

Ogni riga dice il nome del modulo, l'etichetta **Opzione** se è un modulo opzionale (potenzialmente a pagamento),
lo stato e una nota con l'ultimo dato utile (per esempio «4 endpoint, 3 connessi», «Non installato»).

Gli stati, con il loro segno:

- **✓ Acceso** (fondo verde pieno): acceso e l'ultima verifica è andata bene.
- **● Da verificare** (fondo grigio): acceso, ma nessun controllo dice se funziona davvero; apri la sua pagina.
- **▲ Attenzione**: acceso, ma qualcosa non va del tutto.
- **✕ Guasto**: acceso e non funziona.
- **– Spento** (bordo tratteggiato): spento, non installato o non configurato.

Grafana Loki e le credenziali di sistema non hanno uno stato: non si accendono e spengono come gli altri.

## Istanza {#istanza}

Si vede solo se il tuo utente lavora su più di un'istanza (più clienti sullo stesso hub). Il riquadro **Istanza su
cui lavori** sceglie quale istanza mostrano le pagine con i dati: reti, apparati, inventario, anomalie. La scelta
vale finché non la cambi. Per l'elenco e l'anagrafica delle istanze c'è la pagina [Istanze](pagine/tenants.md).

## Notifiche {#notifiche}

Come escono gli allarmi di sicurezza: per posta, verso un webhook, o tutti e due. Le categorie gravi partono
subito, il resto in un riepilogo periodico.

![La scheda Notifiche](/manuale/settings/notifiche.png)

In cima a ogni canale una riga dice se è **ACCESA** o **SPENTA**; si accende e si spegne da
[Opzioni](pagine/settings-opzioni.md) con il collegamento **cambia da Opzioni ›**. Da spento, gli allarmi restano
solo nella pagina.

1. **Email (SMTP)**, il canale della posta. I campi:
   **Server SMTP** e **Porta** del server di posta; **TLS implicito (porta 465)**, interruttore da accendere se il
   server lo chiede; **Utente** e **Password** (vuoti se il server non chiede l'accesso; la password, una volta
   salvata, non si rivede: si lascia vuoto il campo per non cambiarla); **Mittente** (l'indirizzo che compare come
   mittente); **Destinatari** (uno o più indirizzi separati da virgola).
2. **Webhook**: un indirizzo a cui mandare gli allarmi, per esempio un canale di Teams o Slack o un'automazione.
   **URL** è l'indirizzo; **Header Authorization (opzionale)** è l'intestazione di accesso se il servizio la chiede
   (anche questa non si rivede dopo il salvataggio).
3. **Quando notificare**: tre regole, che si cambiano da Opzioni: **Livello per invio immediato** (da che gravità
   un allarme parte subito), **Categorie con invio immediato** (quali tipi di allarme partono subito comunque),
   **Riepilogo ogni** (ogni quanti minuti parte il riepilogo con il resto).
4. `tasto:send` **Invia notifica di prova**: manda un messaggio di prova sui canali accesi, per vedere se arriva.

**Salva** registra i campi di posta e webhook. Salva e la prova li esegue solo un amministratore.

## Scansione {#scansione}

Come DA-IPAM prova gli apparati durante le scansioni: quali porte, con che velocità. Solo per amministratori.

![Il profilo Nmap](/manuale/settings/scansione.png)

**Profilo Nmap (Scansione completa)**: il profilo usato per le scansioni Nmap avviate a mano e per i job pianificati.
**Nome** e **Descrizione** sono liberi.

1. **Community SNMP (opzionale)**: la community usata in più durante la scansione per leggere gli apparati via SNMP
   (oltre a quelle delle reti e delle credenziali).
2. **Porte TCP da testare**: l'elenco separato da virgole delle porte TCP; solo quelle vengono provate (per esempio
   22,8006,443: 8006 è l'interfaccia di Proxmox). Accanto, **Porte UDP da testare (opzionale)**: se resta vuoto la
   fase UDP non si fa.
3. **Anteprima (comandi effettivi)**: i comandi che partiranno.

`tasto:save` **Salva Profilo** registra.

Sotto il profilo, altri tre riquadri:

- **Scoperta rete veloce (Quick Scan)**: le porte TCP provate su ogni host che risponde al ping durante la scoperta
  della rete, con i tempi (**Host in parallelo**, **Attesa per host**, **Tempo massimo di Nmap**). I valori si
  cambiano da Opzioni; sotto c'è l'elenco delle porte con il servizio di ciascuna e il **Comando Nmap generato**.
- **Port discovery TCP**: un passaggio facoltativo con lo strumento Naabu prima di Nmap, più rapido sulle reti
  grandi. **Naabu prima di Nmap** si accende da Opzioni; **Naabu sul server** dice se lo strumento è installato. Se
  manca, la scansione continua con il solo Nmap.
- **Variabili ambiente**: si apre con `icona:chevron-right` e mostra le impostazioni di scansione forzate dal file di
  configurazione del server. Se non ce ne sono valgono i valori predefiniti.

## Identificazione {#identificazione}

Come DA-IPAM capisce che tipo di apparato ha davanti (switch, stampante, telecamera…). Solo per amministratori.

![La scheda Identificazione](/manuale/settings/identificazione.png)

In cima una seconda fila di schede:

1. **Pipeline**: le sei fasi con cui un apparato viene classificato durante la scoperta; la prima che lo riconosce
   decide. Nell'ordine: **Profilo vendor SNMP** (dall'identificativo SNMP del produttore), **Hostname prefix** (dal
   nome, per esempio «SW-» vuol dire switch), **sysObjectID Lookup** (dalla tabella degli identificativi SNMP),
   **Fingerprint OID probe** (prove SNMP mirate), **Fingerprint snapshot** (dall'impronta raccolta durante la
   scansione), **Classificatore generico** (regole su descrizione, porte, nome e produttore della scheda di rete).
   Sotto ogni fase c'è il collegamento alla parte che la regola.
2. **Profili SNMP dei vendor ›** apre i [profili SNMP](pagine/settings-snmp-profiles.md).
3. **Classificazioni del cliente ›** apre le [classificazioni personalizzate](pagine/settings-classifications.md).

Le altre schede della fila:

- **sysObjectID**: la tabella che lega l'identificativo SNMP a produttore, prodotto e categoria (fase 3).
- **MAC → prodotto**: i prefissi del MAC che indicano una linea di prodotto, e le correzioni di classificazione
  recenti.
- **Firme**: le firme di riconoscimento (fase 4), con il numero accanto. `tasto:plus` **Nuova firma** ne aggiunge
  una, `tasto:rotate-ccw` **Reset built-in** rimette quelle di serie. Per ogni firma: acceso/spento (**On**),
  **Pri.** (priorità), **Nome**, **Label**, **Classificazione**, **Criteri**, `icona:pencil` per modificare,
  `icona:trash` per eliminare. La finestra della firma chiede **Nome (univoco)**, **Label dispositivo**,
  **Classificazione**, **Priorità**, **Abilitata**, poi i criteri: **Porte TCP chiave** e **Porte TCP opzionali**
  (elenchi JSON, per esempio `[22, 443]`), **Min porte chiave** (quante porte chiave devono essere aperte), **OID
  prefix (sysObjectID)**, i modelli (espressioni regolari) su **sysDescr**, **Hostname**, **MAC vendor** e **Banner
  HTTP/SSH**, **TTL minimo** e **TTL massimo**, **Note**.
- **Regole fingerprint**: dal tipo di apparato riconosciuto dall'impronta alla classificazione (fase 5).
  `tasto:plus` **Nuova regola** ne aggiunge una; le colonne sono **Attiva**, **Priorità** (i numeri più bassi
  vengono prima), **Match** (uguale o contiene), **Pattern**, **Classificazione**, **Note**. Le regole valgono sugli
  host nuovi: per ricalcolare quelli già trovati serve una nuova scansione della rete.
- **Copertura credenziali**: per ogni categoria di apparati, quanti hanno una credenziale che funziona.

## Alert sicurezza {#alert-sicurezza}

Che cosa considerare un attacco e che cosa no. L'invio degli allarmi si regola invece in **Notifiche**.

![La scheda Alert sicurezza](/manuale/settings/alert-sicurezza.png)

1. **Reti e account nostri**: quello che parte da noi non è un attacco. Gli indirizzi dell'appliance e gli
   account delle credenziali configurate sono riconosciuti da soli; qui si aggiunge ciò che il sistema non può
   sapere. **IP e reti nostri**: indirizzi singoli o reti (per esempio 10.0.0.0/28), separati da virgola; le reti
   più grandi di 1024 indirizzi vengono ignorate. **Account di servizio nostri**: i nomi degli account usati dai
   nostri strumenti; «DOMINIO\utente» e «utente@dominio» valgono come «utente». Senza queste righe le nostre sonde
   e le nostre sedi compaiono fra gli attaccanti.
2. **Regole degli apparati di rete**: alcuni apparati (MikroTik, firewall, VPN) mandano a Wazuh i tentativi di
   accesso falliti senza marcarli come tali. In **ID regole da raccogliere** si scrivono i numeri delle loro regole
   in Wazuh, separati da virgola; si trovano nel file delle regole locali di Wazuh. La soluzione più duratura è
   aggiungere a quelle regole il gruppo «authentication_failed»: così vengono riconosciute da sole.
3. **Conservazione**: per quanti giorni si tengono gli eventi già presi in carico; si cambia da Opzioni. Quelli
   ancora aperti non vengono mai cancellati.

**Salva** registra.

## HTTPS {#https}

Il certificato con cui il browser si collega a DA-IPAM in modo cifrato. Solo per amministratori. (Questa scheda non
ha una schermata per scelta: mostrerebbe i dati del certificato.)

In cima un pallino dice lo stato: **HTTPS attivo** (verde), **Certificato presente — riavvia il server per attivare
HTTPS**, oppure **HTTPS non configurato** (giallo). Se c'è un certificato si leggono a chi è intestato e quando
scade.

- **Genera certificato self-signed**: crea un certificato firmato dall'appliance stessa. Si scrivono **Dominio / IP**
  (il nome o l'indirizzo con cui si apre DA-IPAM) e **Validità (giorni)** (365 se resta vuoto), poi **Genera
  certificato**. Funziona subito, ma il browser lo segnala come non riconosciuto finché non lo si accetta.
- **Importa certificato esterno**: per usare un certificato rilasciato da un'autorità o dall'azienda. Si incollano
  **Certificato (PEM)** e **Chiave privata (PEM)**, poi **Importa certificato**.

Dopo aver generato o importato un certificato serve un riavvio del servizio perché valga.

## Sistema {#sistema}

Dati, manutenzione e le azioni che cancellano. La scheda è per gli amministratori.

![Dati e manutenzione](/manuale/settings/sistema.png)

**Dati e manutenzione**:

1. `tasto:download` **Esporta host (CSV)** scarica l'elenco degli host in un file CSV.
2. `tasto:lock` **Backup database…** scarica il database dell'istanza; chiede il **Codice della verifica in due
   passaggi**, che vale 5 minuti.

Accanto, **Trasferimento configurazione ›** apre il [trasferimento dati](pagine/settings-transfer.md) e **Vault ›**
apre il [Vault](pagine/settings-vault.md) delle credenziali.

**Configurazione guidata**: **Apri wizard di configurazione** riapre i passaggi del primo avvio (credenziali, router,
DNS, Active Directory, prima subnet) dal punto in cui erano stati lasciati. I dati già salvati restano.

Sotto, la riga **Acquisizione con i collector** dice se gli apparati che hanno un collector si leggono con quello; si
cambia da Opzioni. Il super amministratore vede anche **URL pubblico dell'hub**: l'indirizzo con cui le macchine dei
clienti raggiungono l'hub (lo usa lo script d'installazione dell'agente d'inventario). Vuoto, vale l'indirizzo da cui
è aperta la pagina; `tasto:save` lo salva.

### Pulizia degli host assenti

![La pulizia degli host assenti](/manuale/settings/pulizia.png)

Archivia gli host spenti da molti giorni e i vecchi indirizzi di un apparato che ha cambiato IP. Gli archiviati
spariscono da elenchi, conteggi e mappa; si recuperano per un certo numero di giorni, poi si cancellano.

- Le righe **Pulizia notturna degli host assenti** (ACCESA o SPENTA, con l'ora dell'ultimo giro), **Assenza prima
  dell'archivio** e **Archivio prima della cancellazione** si cambiano da Opzioni.
- **Mostra anteprima** calcola quali host verrebbero archiviati adesso, con l'ultima volta che sono stati visti e il
  motivo; **Archivia questi N host…** li archivia dopo aver riscritto il numero per conferma.
- **Archivio (N) ›** elenca quelli già archiviati: **Recupera** riporta un host con nome, note e classificazione (lo
  storico di scansioni e stati non torna).

### Azioni che cancellano

![Le azioni che cancellano](/manuale/settings/cancellano.png)

Dentro il bordo rosso:

- `tasto:rotate-ccw` **Reset per nuovo cliente** cancella i dati del cliente (reti, host, apparati, credenziali,
  Active Directory, telefoni, vulnerabilità, topologia, inventario, job). Restano le impostazioni, la configurazione
  dei moduli e gli utenti.
- **Azzera l'appliance**, dove disponibile: per portare l'appliance da un altro cliente. Cancella tutto tranne
  sistema e programmi, poi la spegne. Si conferma scrivendo il nome dell'appliance e premendo **Azzera e spegni**.

Sono azioni senza ritorno: prima conviene un backup.

## Come si fa

- **Dare l'accesso a un collega**: Impostazioni › **Utenti** › `tasto:plus` **Nuovo utente**, ruolo **Solo lettura**
  o **Amministratore**, **Crea utente**; poi **Richiedi** nella colonna Due passaggi, così al primo accesso attiva il
  codice.
- **Un collega ha perso il telefono**: Utenti, sulla sua riga **Azzera** nella colonna Due passaggi; al prossimo
  accesso rifà il QR.
- **Aggiornare il programma**: Impostazioni › **Aggiornamenti**, `tasto:refresh` **Ricontrolla**, poi
  `tasto:rocket` **Aggiorna ora** se compare la versione nuova. Dopo 2-5 minuti ricarica la pagina e controlla
  **Stato dell'aggiornamento**.
- **Ricevere gli allarmi per posta**: Impostazioni › **Notifiche**, compila la parte Email, **Salva**, accendi il
  canale con **cambia da Opzioni ›**, poi `tasto:send` **Invia notifica di prova**.
- **Non vedere le proprie sonde fra gli attaccanti**: Config › **Alert sicurezza**, scrivi in **IP e reti nostri**
  le reti delle sedi e in **Account di servizio nostri** gli account degli strumenti, **Salva**.
- **Fare spazio negli elenchi**: Config › **Sistema** › Pulizia degli host assenti › **Mostra anteprima**, leggi i
  nomi, poi **Archivia questi N host…**.

## Cosa vogliono dire i segni

- **✓** acceso e funzionante · **●** da verificare · **▲** attenzione o da attivare · **✕** guasto · **–** spento o
  non richiesto.
- **ACCESA** su fondo scuro: la funzione è accesa. **SPENTA** su fondo chiaro: spenta. Bordo tratteggiato: ancora
  da configurare.
- **cambia da Opzioni ›**: quel valore non si cambia qui ma nella pagina [Opzioni](pagine/settings-opzioni.md), dove
  ogni cambio viene registrato con chi l'ha fatto.
- Un pulsante grigio sulla propria riga in Utenti: quell'azione non si fa su se stessi.

## Da dove arrivano i dati

Utenti, impostazioni, canale e profili stanno nel database dell'hub; le notifiche, i moduli e i dati di pulizia
nell'istanza. Lo stato dei moduli viene da una verifica fatta al momento in cui si apre la scheda. Le versioni
vengono dal repository del canale scelto, controllato periodicamente.

## Se la pagina è vuota

Se una scheda resta su «Caricamento…» o mostra un errore, ricarica la pagina. Le schede di **Config** e **Utenti**
sono riservate agli amministratori: con un utente in sola lettura si vede solo un avviso. La scheda **Istanza**
compare solo con più istanze.

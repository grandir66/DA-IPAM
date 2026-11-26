---
percorso: /settings, /settings/features, /settings/updates, /appliance, /integrations, /launchpad
titolo: Impostazioni e Config — utenti, aggiornamenti, moduli e configurazione tecnica
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È la pagina di **tutte le impostazioni dell'installazione**. Nel menu a sinistra compare due volte:

- **Impostazioni** raccoglie le cose che servono anche a chi usa DA-IPAM tutti i giorni: **Utenti**,
  **Aggiornamenti**, **Moduli**, **Istanza** (solo per chi lavora su più istanze), poi
  [Opzioni](pagine/settings-opzioni.md), [Schedulazioni](pagine/settings-schedulazioni.md) e **Notifiche**.
- **Config** raccoglie la configurazione tecnica, riservata agli amministratori: **Scansione**,
  **Identificazione**, **Alert sicurezza**, **HTTPS**, **Sistema** e [Cosa esce](pagine/settings-cosa-esce.md).

Le schede stanno in fila in cima alla pagina; quella accesa è colorata. Ogni scheda ha un suo indirizzo
(`/settings?tab=utenti`, `/settings?tab=moduli`…), quindi si può salvare fra i preferiti o mandare a un collega.
Il pulsante **?** apre questa guida direttamente al paragrafo della scheda aperta.

Alcuni indirizzi vecchi portano qui da soli: `/settings/features`, `/appliance`, `/integrations` e `/launchpad`
aprono la scheda **Moduli**, `/settings/updates` apre la scheda **Aggiornamenti**.

Quando c'è una versione nuova del programma, sopra le schede compare un'etichetta del tipo «v0.9.1400 disponibile
(installata v0.9.1363)»: un clic porta alla scheda Aggiornamenti.

## Utenti {#utenti}

Gli account che possono entrare in DA-IPAM. La scheda è solo per gli amministratori: chi è in sola lettura vede
la scritta «La gestione degli utenti è riservata agli amministratori».

![La scheda Utenti](/manuale/settings/utenti.png)

1. **Nuovo utente**: apre il modulo per creare un account. Si scrivono **Username** (almeno 3 caratteri, per
   esempio nome.cognome), **Email** (serve per reimpostare la password), **Password** (almeno 8 caratteri) e
   **Ruolo**, poi **Crea utente**. I ruoli:
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
   - la **matita** cambia ruolo e clienti assegnati (poi **Salva**);
   - la **chiave** imposta una nuova password per quell'utente (almeno 8 caratteri);
   - il **cestino** elimina l'utente, dopo una conferma. Non si può eliminare il proprio account.
4. **Accesso d'emergenza**: una frase da stampare e chiudere in una busta, per entrare se l'amministratore perde
   password, telefono e codici. Vale una volta sola, per 60 minuti, e ogni uso resta nel registro degli accessi.
   **Prepara…** la crea: si mostra una volta sola, con **Stampa** e **Copia**, e si chiude con **L'ho messa in
   busta**. Se ce n'è già una, il pulsante diventa **Rigenera…** (la vecchia smette di valere) e compare
   **Togli**. Per prepararla può essere chiesto il codice a 6 cifre dell'app di autenticazione.

Le altre colonne: **Username**, **Email**, **Ruolo**, **Cliente** (le istanze a cui ha accesso; «Tutti i clienti»
per il super amministratore), **Creato il**, **Ultimo accesso** («Mai» se non è mai entrato).

La propria password non si cambia da qui: si usa il menu utente in alto a sinistra, sotto il proprio nome.

## Aggiornamenti {#aggiornamenti}

Che versione di DA-IPAM gira, se ce n'è una più nuova, e da dove arrivano gli aggiornamenti.

![La scheda Aggiornamenti](/manuale/settings/aggiornamenti.png)

1. **Ricontrolla**: chiede subito se c'è una versione nuova, senza aspettare il controllo automatico.
2. **Versione installata**: **Installata** è la versione che gira adesso, **Disponibile su…** quella pubblicata sul
   canale scelto (in arancione se è più nuova), **Ultimo controllo** quando si è guardato l'ultima volta. Se è tutto
   a posto si legge «Appliance allineata al canale». Se c'è una versione nuova compare **Aggiornamento disponibile**
   con il pulsante **Aggiorna ora a v…**: l'aggiornamento dura 2-5 minuti e il programma continua a rispondere finché
   non si riavvia. Accanto, il riquadro **Changelog** elenca le ultime modifiche pubblicate sul canale.
3. **Stato dell'aggiornamento**: come è andato l'ultimo giro. Ogni aggiornamento (dal controllo automatico o da
   «Aggiorna ora») si prepara in una cartella separata e passa alla versione nuova solo se il programma risponde
   dopo il riavvio; altrimenti torna da solo alla versione di prima. Le righe: **Codice scaricato**, **Avviato con
   salute buona**, **Ultimo controllo**, e sotto **Ultimo tentativo** con l'esito (riuscito, fallito, in corso).
4. **Canale aggiornamenti**: da dove si prendono le versioni nuove.
   - **Stable (main)**: quello delle installazioni dai clienti. Riceve solo i rilasci approvati.
   - **Dev (dev)**: riceve ogni modifica in sviluppo. Solo per le installazioni di prova.
   Un clic su un riquadro cambia canale; quello in uso porta la scritta **attivo**. Sotto si leggono il ramo
   installato, il ramo configurato, se il file di configurazione si può scrivere e l'esito del controllo della
   **firma dei rilasci** (ogni rilascio è firmato e viene controllato prima di installarlo).
   Il riquadro **Rilascio su main** dice quante modifiche di sviluppo aspettano di passare ai clienti:
   **Mostra commit** le elenca. Il rilascio non parte da questa pagina: lo fa chi rilascia, con un commit firmato.

Altri avvisi che possono comparire: **Branch fuori dal canale configurato** (l'installazione è rimasta su un ramo
diverso da quello del canale; il pulsante **Riallinea al canale** la rimette a posto), e, per le installazioni in
Docker, la spiegazione che l'aggiornamento da qui non è disponibile.

## Moduli {#moduli}

L'elenco di tutti i moduli e le integrazioni: Scanner-Edge, Patch Management, Network Services, LibreNMS, Graylog,
Wazuh, MeshCentral, Inventory Agent, Inventario NIS2, MDM, Controller UniFi, il pannello Zabbix, Grafana Loki e le
credenziali di sistema. Ogni modulo si configura e si verifica nella sua pagina.

![La scheda Moduli](/manuale/settings/moduli.png)

1. **Importa configurazione modulo (JSON)**: carica la configurazione di un modulo da un file JSON preparato
   prima (per esempio da un'altra installazione).
2. **Apri**: porta alla pagina del modulo, dove lo si configura, lo si prova e se ne legge lo stato
   ([pagina di un modulo](pagine/settings-moduli-key.md)). Per l'MDM porta a [MDM (Headwind)](pagine/settings-mdm.md).

Ogni riga dice il nome del modulo, l'etichetta **Opzione** se è un modulo opzionale (potenzialmente a pagamento),
lo stato e una nota con l'ultimo dato utile (per esempio «4 endpoint, 3 connessi»).

Gli stati, con il loro segno:

- **✓ Acceso**: acceso e l'ultima verifica è andata bene.
- **● Da verificare**: acceso, ma nessun controllo dice se funziona davvero; apri la sua pagina.
- **▲ Attenzione**: acceso, ma qualcosa non va del tutto.
- **✕ Guasto**: acceso e non funziona.
- **– Spento**: spento, non installato o non configurato.

Grafana Loki e le credenziali di sistema non hanno uno stato: non si accendono e spengono come gli altri.

## Istanza {#istanza}

Si vede solo se il tuo utente lavora su più di un'istanza (più clienti sullo stesso hub). Il riquadro **Istanza su
cui lavori** sceglie quale istanza mostrano le pagine con i dati: reti, apparati, inventario, anomalie. La scelta
vale finché non la cambi. Per l'elenco e l'anagrafica delle istanze c'è la pagina [Istanze](pagine/tenants.md).

## Notifiche {#notifiche}

Come escono gli allarmi di sicurezza: per posta, verso un webhook, o tutti e due. Le categorie gravi partono
subito, il resto in un riepilogo periodico.

![La scheda Notifiche](/manuale/settings/notifiche.png)

In cima, la riga **Notifiche** dice se l'invio è acceso o spento; si accende e si spegne da
[Opzioni](pagine/settings-opzioni.md) con il collegamento **cambia da Opzioni ›**. Da spenta, gli allarmi restano
solo nella pagina.

1. **Email (SMTP)**: il canale della posta, anch'esso acceso o spento da Opzioni. I campi:
   **Server SMTP** e **Porta** del server di posta; **TLS implicito (porta 465)** da accendere se il server lo
   chiede; **Utente** e **Password** (vuoti se il server non chiede l'accesso; la password, una volta salvata, non
   si rivede: si lascia vuoto il campo per non cambiarla); **Mittente** (l'indirizzo che compare come mittente);
   **Destinatari** (uno o più indirizzi separati da virgola).
2. **Webhook**: un indirizzo a cui mandare gli allarmi, per esempio un canale di Teams o Slack o un'automazione.
   **URL** è l'indirizzo; **Header Authorization (opzionale)** è l'intestazione di accesso se il servizio la chiede
   (anche questa non si rivede dopo il salvataggio).
3. **Quando notificare**: tre regole, che si cambiano da Opzioni: **Livello per invio immediato** (da che gravità
   un allarme parte subito), **Categorie con invio immediato** (quali tipi di allarme partono subito comunque),
   **Riepilogo ogni** (ogni quanti minuti parte il riepilogo con il resto).
4. **Invia notifica di prova**: manda un messaggio di prova sui canali accesi, per vedere se arriva.

**Salva** registra i campi di posta e webhook.

## Scansione {#scansione}

Come DA-IPAM prova gli apparati durante le scansioni: quali porte, con che velocità. Solo per amministratori.

![La scheda Scansione](/manuale/settings/scansione.png)

1. **Profilo Nmap (Scansione completa)**: il profilo usato per le scansioni Nmap avviate a mano e per i job
   pianificati. **Nome** e **Descrizione** sono liberi; **Community SNMP (opzionale)** è la community usata in più
   durante la scansione per leggere gli apparati via SNMP (oltre a quelle delle reti e delle credenziali);
   **Porte TCP da testare** è l'elenco separato da virgole delle porte TCP (solo quelle vengono provate);
   **Porte UDP da testare (opzionale)**: se resta vuoto la fase UDP non si fa. **Anteprima (comandi effettivi)**
   mostra i comandi che partiranno. **Salva Profilo** registra.
2. **Scoperta rete veloce (Quick Scan)**: le porte TCP provate su ogni host che risponde al ping durante la
   scoperta della rete, con i tempi (**Host in parallelo**, **Attesa per host**, **Tempo massimo di Nmap**). I valori
   si cambiano da Opzioni; sotto c'è l'elenco delle porte con il servizio di ciascuna e il **Comando Nmap generato**.
3. **Port discovery TCP**: un passaggio facoltativo con lo strumento Naabu prima di Nmap, più rapido sulle reti
   grandi. **Naabu prima di Nmap** si accende da Opzioni; **Naabu sul server** dice se lo strumento è installato.
   Se manca, la scansione continua con il solo Nmap.
4. **Variabili ambiente**: si apre con un clic e mostra le impostazioni di scansione forzate dal file di
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
- **Firme**: le firme di riconoscimento (fase 4), con il numero accanto. **Nuova firma** ne aggiunge una, **Reset
  built-in** rimette quelle di serie; per ogni firma: acceso/spento (**On**), **Pri.** (priorità), **Nome**,
  **Label**, **Classificazione**, **Criteri**, matita per modificare, cestino per eliminare.
- **Regole fingerprint**: dal tipo di apparato riconosciuto dall'impronta alla classificazione (fase 5). **Nuova
  regola** ne aggiunge una; le colonne sono **Attiva**, **Priorità** (i numeri più bassi vengono prima), **Match**
  (uguale o contiene), **Pattern**, **Classificazione**, **Note**. Le regole valgono sugli host nuovi: per
  ricalcolare quelli già trovati serve una nuova scansione della rete.
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

Il certificato con cui il browser si collega a DA-IPAM in modo cifrato. Solo per amministratori.

In cima un pallino dice lo stato: **HTTPS attivo** (verde), **Certificato presente — riavvia il server per attivare
HTTPS**, oppure **HTTPS non configurato** (giallo). Se c'è un certificato si leggono a chi è intestato e quando
scade.

- **Genera certificato self-signed**: crea un certificato firmato dall'appliance stessa. Si scrivono **Dominio / IP**
  (il nome o l'indirizzo con cui si apre DA-IPAM) e **Validità (giorni)**, poi **Genera certificato**. Funziona
  subito, ma il browser lo segnala come non riconosciuto finché non lo si accetta.
- **Importa certificato esterno**: per usare un certificato rilasciato da un'autorità o dall'azienda. Si incollano
  **Certificato (PEM)** e **Chiave privata (PEM)**, poi **Importa certificato**.

Dopo aver generato o importato un certificato serve un riavvio del servizio perché valga.

## Sistema {#sistema}

Dati, manutenzione e le azioni che cancellano. La maggior parte dei pulsanti è solo per gli amministratori.

![La scheda Sistema](/manuale/settings/sistema.png)

1. **Dati e manutenzione**:
   - **Esporta host (CSV)** scarica l'elenco degli host in un file CSV.
   - **Backup database…** scarica il database dell'istanza; chiede il codice della verifica in due passaggi, che
     vale 5 minuti.
   - **Trasferimento configurazione ›** apre il [trasferimento dati](pagine/settings-transfer.md).
   - **Vault ›** apre il [Vault](pagine/settings-vault.md) delle credenziali.
2. **Configurazione guidata**: **Apri wizard di configurazione** riapre i passaggi del primo avvio (credenziali,
   router, DNS, Active Directory, prima subnet) dal punto in cui erano stati lasciati. I dati già salvati restano.

   Sotto, la riga **Acquisizione con i collector** dice se gli apparati che hanno un collector si leggono con
   quello; si cambia da Opzioni. Il super amministratore vede anche **URL pubblico dell'hub**: l'indirizzo con cui
   le macchine dei clienti raggiungono l'hub (lo usa lo script d'installazione dell'agente d'inventario). Vuoto,
   vale l'indirizzo da cui è aperta la pagina.
3. **Pulizia degli host assenti**: archivia gli host spenti da molti giorni e i vecchi indirizzi di un apparato
   che ha cambiato IP. Gli archiviati spariscono da elenchi, conteggi e mappa; si recuperano per un certo numero di
   giorni, poi si cancellano. Le righe **Pulizia notturna degli host assenti**, **Assenza prima dell'archivio** e
   **Archivio prima della cancellazione** si cambiano da Opzioni. **Mostra anteprima** calcola quali host verrebbero
   archiviati adesso, con l'ultima volta che sono stati visti e il motivo; **Archivia questi N host…** li archivia
   dopo aver riscritto il numero per conferma. **Archivio** elenca quelli già archiviati: **Recupera** riporta un
   host con nome, note e classificazione (lo storico di scansioni e stati non torna).
4. **Azioni che cancellano**, dentro il bordo rosso:
   - **Reset per nuovo cliente** cancella i dati del cliente (reti, host, apparati, credenziali, Active Directory,
     telefoni, vulnerabilità, topologia, inventario, job). Restano le impostazioni, la configurazione dei moduli e
     gli utenti.
   - **Azzera l'appliance**, dove disponibile: per portare l'appliance da un altro cliente. Cancella tutto tranne
     sistema e programmi, poi la spegne. Si conferma scrivendo il nome dell'appliance e premendo **Azzera e spegni**.

   Sono azioni senza ritorno: prima conviene un backup.

## Come si usa

1. Per dare l'accesso a un collega: **Impostazioni › Utenti › Nuovo utente**, scegli il ruolo, poi chiedigli di
   attivare la verifica in due passaggi (**Richiedi**).
2. Per aggiornare: **Impostazioni › Aggiornamenti**, **Ricontrolla**, poi **Aggiorna ora** se c'è una versione nuova.
3. Per configurare un'integrazione: **Impostazioni › Moduli**, **Apri** sulla riga del modulo.
4. Per ricevere gli allarmi per posta: **Impostazioni › Notifiche**, compila la parte Email, **Salva**, **Invia
   notifica di prova**, poi accendi il canale da Opzioni.
5. Per non vedere le proprie sonde fra gli attaccanti: **Config › Alert sicurezza**, aggiungi reti e account.

## Cosa vogliono dire i segni

- **✓** acceso e funzionante · **●** da verificare · **▲** attenzione o da attivare · **✕** guasto · **–** spento o
  non richiesto.
- **ACCESA** su fondo scuro: la funzione è accesa. **SPENTA** su fondo chiaro: spenta. Bordo tratteggiato: ancora
  da configurare.
- **cambia da Opzioni ›**: quel valore non si cambia qui ma nella pagina Opzioni, dove ogni cambio viene registrato.

## Da dove arrivano i dati

Utenti, impostazioni, canale e profili stanno nel database dell'hub; le notifiche, i moduli e i dati di pulizia
nell'istanza. Lo stato dei moduli viene da una verifica fatta al momento in cui si apre la scheda. Le versioni
vengono dal repository del canale scelto, controllato periodicamente.

## Se la pagina è vuota

Se una scheda resta su «Caricamento…» o mostra un errore, ricarica la pagina. Le schede di **Config** e **Utenti**
sono riservate agli amministratori: con un utente in sola lettura si vede solo un avviso. La scheda **Istanza**
compare solo con più istanze.

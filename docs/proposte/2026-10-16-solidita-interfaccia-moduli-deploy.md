# Proposta per l’agente di sviluppo — solidità DA-IPAM

Data: 16 ottobre 2026. Base locale: v0.3.311, HEAD c48ff9d1.
Stato: proposta da approvare, non autorizza implementazione, installazioni, push o interventi sul live.
Ambito: interfaccia dei moduli, integrazioni, MDM, topologia e affidabilità del deploy.

## Obiettivo

Un tecnico deve capire quali moduli esistono, dove girano, cosa è configurato, cosa funziona realmente, cosa manca e quale azione può compiere senza perdere dati. Conservare registry, health e adattatori esistenti; completare il ciclo comune deciso in ADR 0004. Non riscrivere le integrazioni funzionanti.

## Evidenze e limiti della verifica

Ispezione statica del codice DA-IPAM e dei percorsi pertinenti di Deploy-Appliance. Nessuna sessione browser autenticata, prova visiva, chiamata alle appliance o verifica delle credenziali. La solidità grafica, il responsive, l’accessibilità effettiva e il funzionamento delle integrazioni reali restano da collaudare.

Prove locali eseguite con Node 22 e directory dati temporanee:
- Topologia: 913 test, 911 pass, 0 fail ordinari, 1 skip e 1 TODO. TODO non soddisfatto: telefono annunciato via CDP; skip: CDP inoltrato da switch di altra marca.
- Catalogo moduli, test Network Services presenti, mdm-config, mdm-sync, hmdm-client: 50 pass, 0 fail. Non è un collaudo completo di ciascuna integrazione.
- Log: /private/tmp/da-ipam-topology-review.log e /private/tmp/da-ipam-modules-review.log.

## Risultati verificati

### R1 — MDM esiste ma è escluso dal catalogo comune [P1]

Esistono settings/mdm/page.tsx e MdmSettingsClient.tsx, API /api/mdm/*, hmdm-client.ts, mdm-runner.ts, mdm-sync.ts, mdm-config.ts, job mdm_sync e MobileProfilePanel montato in objects/[id]/page.tsx. ModuleKey/MODULE_DESCRIPTORS non includono MDM; la sidebar esaminata non collega /settings/mdm. Non sono state trovate occorrenze mdm nei percorsi Bash/compose cercati di Deploy-Appliance: l’installazione automatica del server Headwind resta da accertare, non va dichiarata disponibile.

La pagina promette Android/iOS; la specifica del connettore Headwind indica Android, con iOS previsto separatamente. Correggere la promessa sulla base delle capacità realmente implementate. mdm-config conserva ancora un archivio password proprio: verificare la convergenza con l’archivio credenziali senza migrazioni distruttive implicite.

recordSync aggiorna last_sync_at anche in errore e disattiva dopo cinque errori: distinguere ultimo tentativo e ultimo successo, spiegare la disattivazione e consentire diagnosi/riattivazione. Il dispatcher mdm_sync esiste, ma verificare che il salvataggio config crei o abiliti realmente il job: la presenza del dispatcher da sola non lo prova.

### R2 — Errori ignorati e polling senza uscita utile [P1]

integration-card.tsx load ignora HTTP non riusciti ed eccezioni. Il polling ignora risposte non riuscite ed errori di rete; modules-tab.tsx ha comportamento analogo per installazione Docker. La route install-progress restituisce 404 per job assente. job-store.ts conserva i job solo in una Map globale: al riavvio del processo si perdono; i log crescono senza un limite esplicito in appendLog.

Conseguenza dedotta dal codice: un job perso può lasciare il polling attivo senza spiegazione. Serve uno stato «esito sconosciuto/interrotto», non affermare automaticamente che l’installazione sia fallita o riuscita. Il cleanup al dismontaggio esiste e va conservato.

### R3 — Configurazione e salute non hanno la stessa copertura [P1]

registry.ts normalizza i moduli, health.ts separa raggiungibilità, autenticazione e sincronizzazione, con cache e isolamento degli errori via allSettled: fondazione buona. Tuttavia probePatch usa solo il flag enabled come reachable/authOk/verdict. inventory_agent non compare in PROBED_MODULE_KEYS; MDM manca anche dal registry. Non confondere attivazione locale con funzionamento sugli endpoint, né zero dispositivi con guasto.

### R4 — Aggiornamento Git diverso da rilascio riuscito [P1]

scripts/update.sh esegue pull prima di npm install e build. auto-update.sh esce se HEAD coincide con origin: dopo un fallimento a valle del pull può saltare il ritentativo. Anche checkout a origin durante cambio branch precede il confronto e può saltare build/restart. verify-install fallita diventa avviso, seguito da «Aggiornamento completato». Sono percorsi statici da riprodurre in ambiente isolato, non incidenti verificati sul live.

### R5 — Network Services richiede salute per componente [P1/P2]

L’interfaccia distingue già resolver Unbound, AdGuard, PowerDNS e Kea. probeBridgeWithAuth verifica successo HTTP di /api/v1/status, senza validarne qui il contenuto: non basta a dimostrare che i quattro servizi funzionino. getNetServicesState ammette fallback da variabili ambiente anche dopo disattivazione della feature; la fonte è già modellata e va resa evidente. toggleService nel client non racchiude fetch/parsing in un catch locale: verificare e uniformare gli errori di rete senza perdere lo stato precedente.

### R6 — Topologia già strutturata, da consolidare [P2]

Il motore separa fonti, prove, cavi e albero; gestisce fiducia, dati vecchi, STP/uplink, fasci, segmenti e unioni. mappa-server.ts ripiega esplicitamente sul modello precedente con avviso. Evitare di proporre queste capacità come mancanti. Restano copertura delle fonti, casi CDP aperti, identità/porte stabili e costo della manutenzione di due modelli.

## Contratto comune da completare

Estendere i tipi esistenti senza introdurre un terzo registry. Tenere distinti:
- presenza/installazione, gestione locale o esterna, configurazione e attivazione;
- raggiungibilità, autenticazione, capacità effettive e freschezza dei dati;
- stato di ogni operazione, ultimo tentativo, ultimo successo e diagnosi;
- azioni disponibili per ruolo e impatto di scollegamento/disinstallazione.

Ogni modulo deve offrire un percorso coerente: scopri → installa oppure collega → verifica → prima lettura/operazione controllata → usa → diagnostica → scollega. Le differenze di protocollo restano negli adattatori. Mostrare «non verificato» quando manca una prova; un modulo spento non deve diventare automaticamente un allarme.

## Criteri per ciascuna integrazione

- LibreNMS: decisione esplicita di Riccardo del 16/10: modulo opzionale esclusivamente locale, sempre integrato nell’appliance quando presente; nessuna istanza esterna come modalità di prodotto. Se spento o assente, resta visibile nel catalogo come opzione locale. Eliminare dal percorso utente la scelta esterna e la possibilità di installare una seconda istanza, dopo censimento delle configurazioni esistenti. Riutilizzare risolutori API/browser, autenticazione operatore e grafici già presenti. Non migrare né disinstallare automaticamente installazioni esistenti: eventuali dati legacy esterni richiedono un percorso esplicito. URL locali distinti per API e browser possono restare necessari, ma non costituiscono una modalità esterna.
- Wazuh: riportare separatamente manager API, indexer e dashboard, certificati/autenticazioni e stato di agenti/alert. Una componente sana non deve rendere verdi le altre. Distinguere generazione script da installazione agente confermata.
- Chocolatey/Patch: separare modulo attivo, trasporto remoto disponibile, Chocolatey presente sul singolo endpoint, catalogo pacchetti e risultato dell’operazione. Non eseguire aggiornamenti reali durante la sola verifica connessione. Prevedere indisponibilità host ed esito parziale.
- GLPI Agent: descrivere esplicitamente il ricevitore di inventario GLPI Agent, senza promettere un server GLPI. Verificare configurazione ingresso, modalità auth effettiva, ricezione e parsing di un inventario controllato, associazione host e ultimo inventario. «Script generato» non equivale ad «agente comunicante».
- MeshCentral: conservare probe WebSocket e controllo device group già presenti. Esporre separatamente server, autenticazione, gruppo, ultimo sync e nodi non associati; collaudare abbinamento e riconnessione senza duplicare host.
- Graylog: verificare separatamente API/auth, accesso dashboard e percorso di ingestione previsto. La prova di ingestione usa un evento marcato, solo su ambiente di collaudo autorizzato. Zero messaggi può essere normale.
- Network Services: mostrare versione/capacità bridge, auth e stato per servizio. Unbound: risoluzione/forwarding controllati; AdGuard: raggiungibilità e configurazione filtri; PowerDNS: lettura zona/record; Kea: lettura subnet/lease. Scritture DNS/DHCP solo in collaudo esplicito, con anteprima, validazione e verifica dopo applicazione. Mostrare dipendenze reali della catena DNS ricavate dalla config, senza inventare un ordine fisso.
- MDM: aggiungere descriptor, configurazione raggiungibile, health e diagnostica comuni. Headwind Android: collegamento, prima sync, profilo inventario e ultimo contatto. Enrollment/policy rimangono nella console Headwind secondo specifica; iOS non disponibile finché non esiste un adattatore collaudato. Smartphone/tablet classificato in discovery non equivale a device gestito MDM.

## Vincoli aggiornati: Zabbix e LibreNMS (decisioni dell’utente, 16/10)

Zabbix è un modulo opzionale commerciale, venduto separatamente: non è un requisito per usare DA-IPAM. Quando acquistato e attivato, usa proxy distribuiti e il proxy cliente convive sulla stessa macchina di DA-IPAM. DA-Zabbix esiste già e genera il profilo dei clienti: resta il responsabile di quel profilo e del relativo onboarding; DA-IPAM riutilizza tale profilo, senza duplicarne generazione e configurazione. Il CONTEXT di DA-Zabbix documenta già un pilota dentro l’appliance. Questa evidenza non dimostra che tutte le installazioni abbiano già la stessa architettura. Nei percorsi DA-IPAM cercati non è emerso un connettore Zabbix dedicato.

### Zabbix opzionale come fonte delle osservazioni di monitoraggio [P1 architetturale]

Solo quando il modulo Zabbix è autorizzato commercialmente, configurato e attivo, riutilizzare disponibilità, metriche, timestamp e problemi di Zabbix quando esistono; non dedurre «sano» dall’attivazione di un modulo e non costruire un secondo sistema di allarmi indipendente. Conservare le sonde tecniche che servono a verificare autenticazione, capacità e prima configurazione: un valore CPU disponibile non prova che l’integrazione funzioni. Un host raggiungibile non è necessariamente sano, e un problema aperto non significa necessariamente host offline.

Separare le responsabilità:
- DA-IPAM: identità/inventario, configurazione guidata, topologia fisica e spiegazione delle fonti.
- DA-Zabbix: titolare del profilo cliente già generato, dell’onboarding e della configurazione Zabbix; nessun secondo generatore dentro DA-IPAM. Zabbix opzionale: raccolta distribuita tramite proxy, metriche e problemi secondo quel profilo, template e regole di monitoraggio.
- LibreNMS locale opzionale: funzioni NMS e grafici già integrati; definire esplicitamente per metrica quale fonte mostrare quando sono disponibili entrambi. Proposta iniziale: con opzione Zabbix attiva, Zabbix fonte primaria per disponibilità/problemi e misure già presenti; LibreNMS mantiene i dettagli specifici. Non avviare nuove raccolte duplicate per sola comodità dell’interfaccia. Sovrapposizioni esistenti vanno misurate prima di disattivarle.

Il proxy locale raccoglie/inoltra: non assumere che esponga l’API di consultazione del frontend Zabbix. L’API JSON-RPC documentata appartiene al frontend centrale. Percorso consigliato da valutare: DA-IPAM → API di servizio DA-Zabbix con contratto filtrato per cliente → API Zabbix centrale. Alternativa: accesso diretto al centrale con credenziale realmente limitata al cliente, da motivare. Non introdurre un finto endpoint sul proxy, non leggere il suo DB e non consegnare token amministrativi centrali alle appliance. Fonte tecnica: https://www.zabbix.com/documentation/7.0/en/manual/api ; versione effettiva del centrale e capacità del servizio DA-Zabbix ancora da verificare nel piano tecnico.

Contratto minimo delle osservazioni: oggetto canonico, identificativo Zabbix, eventuale interfaccia, metrica e unità, valore/stato, fonte, timestamp di raccolta, timestamp di ricezione, finestra di validità, qualità (valido, vecchio, non supportato, sconosciuto) e problemi correlati. Distinguere ultimo tentativo e ultimo successo. Niente percentuali o semafori senza osservazione sottostante.

Associazione oggetti: mapping persistente fra identità DA-IPAM e hostid Zabbix; porte abbinate con identificatori disponibili e controllo ambiguità. Non basarsi solo su IP o nome. Unisci/Separa e host ricreati in Zabbix devono invalidare o riconciliare il mapping con evidenza, senza assegnare metriche all’oggetto sbagliato. Nessun import deve creare un secondo inventario indipendente.

Topologia: mantenere prove fisiche LLDP/FDB/STP; sovrapporre stato e metriche Zabbix con fonte e ora. Quando le letture necessarie sono già raccolte da Zabbix, verificarne forma e copertura prima di riutilizzarle ed evitare polling equivalente. Zabbix non è una prova di cablaggio per il solo fatto di monitorare gli host.

Assenza del centrale/rete: cache limitata con timestamp; indicare «ultimo dato noto» o «sconosciuto», non trasformare l’assenza API in guasto dell’host o verde permanente. Eventuale sonda locale è distinta e dichiarata; nessun failover che modifica silenziosamente il significato dei dati. Non replicare tutto lo storico in SQLite: cache di ultimi valori e richieste limitate allo storico solo dove serve, con budget e frequenze coerenti con gli intervalli degli item.

Convivenza: stato del proxy separato da stato del servizio DA-IPAM, da collegamento al centrale e da disponibilità degli host. Installazione/aggiornamento DA-IPAM non deve riavviare il proxy implicitamente. Definire responsabilità del provisioning, limiti risorse, spazio buffer/retention e compatibilità versioni. Un riavvio dell’intera VM è un guasto comune: la sua rilevazione deve arrivare dal centrale, non dipendere dalla stessa appliance.

Cancello dedicato: test con API finte e fixture per cliente errato, mapping ambiguo, host multihomed, dati vecchi, item non supportato, centrale irraggiungibile, proxy fermo e problemi non equivalenti a offline; nessun token globale sull’appliance. Prova di contratto sul servizio reale solo in ambiente autorizzato. In UI, stato host, gravità problemi e salute del proxy restano distinti.

### Opzionalità commerciale e profilo cliente esistente

Decisione esplicita di Riccardo: Zabbix viene venduto come opzione. DA-IPAM deve funzionare senza server centrale, profilo Zabbix, proxy o credenziali Zabbix. L’opzione non acquistata/non attiva non produce errori di salute, tentativi API o installazioni automatiche. Il catalogo può presentarla come disponibile commercialmente, distinguendola da un’integrazione acquistata ma non ancora configurata.

Distinguere diritto commerciale, presenza del componente, configurazione e attivazione tecnica. Non inventare adesso un nuovo sistema di licenze: nel piano individuare quale fonte già esistente attesta il diritto e il contratto necessario. Un flag modificabile nell’interfaccia non basta, da solo, a dimostrare il diritto commerciale; le azioni server devono rispettare lo stesso controllo quando sarà definito.

DA-Zabbix già genera il profilo cliente: verificare il suo modello e i contratti reali prima di aggiungere API. Abbinare il codice cliente DA-IPAM al profilo già esistente, mostrarne lo stato e demandare a DA-Zabbix creazione e modifica dei template, gruppi e proxy. Nessuna rigenerazione silenziosa del profilo e nessun secondo wizard concorrente. Assenza, ambiguità o mancata autorizzazione del profilo devono essere esplicite e bloccare l’abbinamento, senza creazione automatica di un nuovo cliente.

Senza Zabbix, conservare inventario, topologia e osservazioni reali delle fonti locali abilitate, compreso LibreNMS se presente. Non imporre un’alternativa a pagamento per usare il prodotto base e non fabbricare misure per riempire widget: una capacità non disponibile resta non disponibile, con spiegazione. Con più fonti, rendere esplicita la precedenza per metrica.

Disattivare/scollegare il modulo non deve cancellare il profilo cliente nel centrale né disinstallare automaticamente il proxy, che potrebbe avere ancora compiti assegnati da DA-Zabbix. Rimozione e conservazione dei dati richiedono un impatto esplicito e un flusso coordinato con il proprietario del profilo.

Cancelli aggiuntivi: DA-IPAM senza opzione Zabbix non chiama il centrale e resta operativo; attivazione con profilo esistente non crea duplicati; revoca/spegnimento impedisce nuove operazioni del modulo secondo il contratto definito e non distrugge dati remoti; stato «non acquistato», «da configurare», «spento» e «guasto» non vengono confusi. Test solo con profili sintetici.

### Impatto sulla sequenza

Inserire dopo A una fase A2 di contratto Zabbix/DA-IPAM e scelta delle fonti, prima di estendere i probe nella fase C. Prima un pannello in sola lettura con mapping verificato e pochi dati già raccolti; poi stato sugli oggetti e sulla topologia. Catalogare il proxy come componente locale con ciclo di vita esplicito, riusando l’onboarding DA-Zabbix senza crearne uno concorrente. Correggere LibreNMS nella fase C verso la sola modalità locale. Le nuove letture non autorizzano modifiche a policy NetBird, template Zabbix o installazioni reali.

## Sequenza proposta e cancelli

### A — Esiti affidabili prima di aggiungere funzioni

Riprodurre con mock HTTP e processi isolati R2/R4. Correggere errori UI, polling, job persi, aggiornamento fallito e falso successo health. Salvare lo stato minimo delle operazioni in modo persistente, con retention log e riconciliazione al riavvio; non promettere resume di un processo che non esiste più. Distinguere versione scaricata, costruita e avviata con salute verificata. Progettare recupero compatibile con DB/migrazioni, non solo git reset.

Cancello: 401/403/404/500, timeout, perdita rete e riavvio processo producono uno stato comprensibile; un fallimento build viene ritentato al giro seguente; una health negativa non dà successo. Nessun test deve modificare il repo reale o installare servizi.

### B — Rendere MDM visibile e coerente

Catalogare il connettore esistente, correggere Android/iOS, ultimo tentativo/successo, job e disattivazione dopo errori. Verificare ruoli pagina/API e protezione dei dati mobili sensibili. Non scegliere ora un nuovo prodotto MDM Apple.

Cancello: dal catalogo si raggiunge la config; un server non raggiungibile e cinque errori sono spiegati; una sync controllata crea/aggiorna un oggetto senza duplicarlo. Non riattivare job reali durante i test.

### C — Uniformare il percorso delle integrazioni

Estendere registry/health e riusare componenti di caricamento/errore esistenti. Applicare il contratto prima a LibreNMS e MeshCentral, poi agli altri adattatori; non accorpare tutti i moduli in una modifica unica. Stato locale e stato endpoint distinti per Patch/GLPI. Per ogni modulo, verificare salvataggio, credenziale errata, dato assente, sync vecchia e servizio parzialmente disponibile.

Cancello: catalogo, impostazioni e dashboard mostrano stati coerenti; ogni modulo ha «Verifica» con risultato e azione utile; nessuna credenziale in log, URL o export diagnostico. Scollegamento non cancella dati implicitamente.

### D — Network Services e topologia

Salute e capacità per componente; controlli prima e dopo le modifiche; evidenza della fonte env/database. Topologia: test dei casi CDP, conflitti fra letture, collegamenti vecchi e ridondanze per istanza. Preservare regressione a mappa spenta e spiegazioni per collegamento. Analisi d’impatto e storico topologico restano evoluzioni separate da dimensionare dopo questi cancelli.

Cancello: guasto di un solo servizio è visibile senza dichiarare tutto sano; nessuna azione automatica cambia DNS/DHCP di produzione; le fixture topologiche conservano identità e motivazioni attese.

### E — Collaudo dell’interfaccia reale

Sessione browser autorizzata su ambiente di prova con dati sintetici: ruoli admin/lettore, desktop e schermo stretto, navigazione da tastiera, errori e lentezza, refresh/back durante un job, credenziali incomplete, log e messaggi lunghi. Verificare MDM raggiungibile e distinguere campi salvati da modifiche non salvate prima di «Sincronizza». Acquisire evidenza di ogni scenario, senza dichiarare QA visiva sulla sola lettura TSX.

## Istruzioni operative per l’agente

Prima dell’implementazione rileggere AGENTS.md, CONTEXT.md e ADR 0004; controllare lavoro concorrente e versione attuale. Convertire questa proposta in un piano con file/test per singolo passo e ottenere l’approvazione prevista dall’utente. Niente subagent, job autonomi, live, disinstallazioni o push in questa fase. dev raggiunge un cliente: non è un ambiente di test. Non ricominciare il censimento da zero; verificare solo eventuali cambiamenti rispetto a queste evidenze.

Per ciascun passo approvato: test significativi dei guasti, implementazione mirata, verifiche del progetto e rapporto con limiti. Nessuna nuova dipendenza o migrazione va introdotta per sola uniformità grafica. I test unitari esistenti non sostituiscono la prova di contratto contro le versioni reali dei servizi, da pianificare senza operare sulla produzione.

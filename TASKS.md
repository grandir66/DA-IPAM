# TASKS — DA-IPAM

## 2026-11-13 — Uniformità: schede, cambio di vista e azioni della pagina (Riccardo, tavola proposta)

Riccardo, 13/11: «vorrei chiederti uno sforzo di uniformità: i tab per selezionare le schede di diverse parti di software dovrebbero essere organizzati in modo coerente». Esempi suoi: Patch Management (Panoramica), subnet (Lista o Griglia), Apparati (schede in alto), Active Directory (Computer, Utenti, Gruppi, DHCP, e i comandi in alto a destra su due righe).

- [x] Censimento: oggi le schede sono fatte in quattro modi. Pillole piccole di `ui/tabs` in 17 file (AD, Patch Management, DHCP, DNS, Network Services, scheda apparato, scheda asset, schede host, Impostazioni); riquadri grandi `SchedePagina` in 6 (Reti dal trunk, Mappa porte, Segmentazione, Sicurezza del dominio, Health AD, Scansioni VA); schede a sottolineatura `SchedeSezione` (12/11, sei sezioni del menu); pulsanti Lista/Griglia nella subnet.
- [x] Tavola mostrata in chat, quattro oggetti: (1) **una forma sola di scheda**, a sottolineatura con barra spessa e numero accanto, su due livelli: sopra il titolo le pagine di una voce di menu, sotto il titolo le parti di una pagina; (2) **cambio di vista** (Lista/Griglia) come interruttore a due posizioni, sempre a destra della barra dei filtri: stessi dati, altra forma, quindi non è una scheda; (3) **azioni della pagina** su una riga sola in alto a destra accanto al titolo, le secondarie nel menu «⋯»; (4) spariscono pillole piccole e riquadri grandi.
- [ ] **Contraddizione da confermare, non da decidere per simmetria**: i riquadri grandi li aveva chiesti Riccardo il 25/10 («due pulsantini microscopici», irraggiungibili). La forma proposta sta in mezzo: più grande e più visibile delle pillole, più bassa dei riquadri. Se li vuole tenere, la forma unica diventano i riquadri e si perde spazio in altezza.
- [ ] Quinto esempio di Riccardo, 13/11: «findings con intestazione enorme con testo, menù un po' buttati lì». Nella schermata di DTS: tre righe di testo sotto il titolo (stato dei contatori, cosa non compare, data dei dati sugli exploit con «Aggiorna ora»), il riquadro «Dove guardare» sempre aperto, e sotto tre file di pulsanti (raggruppa per, fonte, gravità, undici filtri rapidi). Stessa cura della subnet: una riga sotto il titolo, il resto in un «i» o nel pannello; «Raggruppa per» come cambio di vista (oggetto 2); fonte e filtri rapidi nella barra dei filtri con le etichette.
- [ ] Sesto esempio di Riccardo, 13/11: «scansioni: menù in alto e pulsanti sotto». In «Scansioni di rete» ci sono le schede di sezione in alto (Interne, VA dall'Edge) e sotto quattro riquadri grandi per il tipo di giro (Discovery, Segmentazione, Sonda L2, Solo controlli): due forme diverse per scegliere, una sopra l'altra. Proposta: il tipo di giro diventa una fila di schede di secondo livello sotto il titolo, con la riga di spiegazione del tipo scelto sotto la fila; il riquadro «1. Tipo» sparisce.
- [ ] Settimo esempio di Riccardo, 13/11: «Alert sicurezza con molti livelli di pulsanti sovrapposti». Nella schermata: accanto al titolo quattro segni di stato (Manager, Indexer, Ingestione, Repliche); poi una fila col periodo (4 pulsanti), i sistemi (5) e «Solo aperti»; poi due file con le undici categorie; poi quattro tessere coi numeri. Cinque livelli prima dell'elenco. Proposta: periodo e sistema nel pannello «Filtri» con le etichette, come in Apparati; le categorie restano l'unica fila di pulsanti diretti, col numero, solo quelle che hanno alert; i quattro numeri nella riga del titolo; i segni di stato in un solo segno «Wazuh ✓» che si apre.
- [x] Ottavo esempio di Riccardo, 13/11: «sicurezza del dominio, di nuovo due modi diversi di avere i tab: Eventi dei DC e Health AD». Sono i riquadri grandi del 25/10: indicandoli fra i modi diversi, Riccardo ha risposto alla domanda sulla forma.
- [x] **0.9.1225, forma unica dentro i componenti**: `components/shared/forma-scheda.ts` con le classi; `ui/tabs` (17 file), `SchedePagina` (6) e `SchedeSezione` le leggono. Nessuna pagina toccata: è solo aspetto, non può far cadere una pagina. `SchedePagina` mostra la riga di spiegazione sotto la fila, per la scheda scelta. `docs/STILE-UI.md` aggiornato. **Non visto a schermo** (sessione sull'hub scaduta).
- [x] Riccardo, 13/11: «la pagina delle applicazioni come chocolatey e mesh central: essere voci singole anch'esse con i tab e non voci di menù». **0.9.1226**: Applicativi ha una voce per prodotto («Patch Management», «Controllo remoto», «Zabbix»), senza intestazioni; CVE e Storico sono schede in cima a Patch Management (`sezioni.ts`), dove ho tolto i due pulsanti «Filtra per CVE» e «Storico operazioni» che facevano la stessa cosa; la console di MeshCentral sta con le altre console esterne. Tolto il fondo grigio forzato alle schede in Patch Management e nelle due schede host/apparato (`tab-scheda`, `tab-dettagli`). Prova di `voci-applicativi` adeguata alla regola nuova. Non visto a schermo.
- [ ] Riccardo, 13/11: «mi piacerebbe un sistema di TAB identico nelle pagine e abbastanza visibile; un sistema di kpi comune e di filtri simile»; «graficamente le kpi, con i contenuti coerenti con le pagine». Schede: fatto (0.9.1225).
- [x] Tavola dello **scheletro comune di pagina** mostrata in chat il 13/11, sei oggetti, sull'esempio di Alert sicurezza: (1) schede di sezione; (2) titolo, stato del servizio in un segno solo, azioni a destra con «⋯»; (3) **fila dei numeri**: da tre a cinque tessere basse tutte uguali (etichetta sopra, numero sotto, una qualifica accanto), su una riga; una tessera che corrisponde a un filtro si clicca e resta bordata quando il filtro è acceso; (4) schede della pagina col numero; (5) **barra dei filtri unica**: cerca, «Filtri · N», etichette dei filtri accesi, «N di M» a destra, poi il cambio di vista; (6) elenco. Ordine fisso in tutte le pagine.
- [ ] Contenuto dei numeri per pagina, da confermare con Riccardo: Apparati (apparati, online, offline, senza categoria, da rivedere) · Subnet (host, online, offline, con categoria, indirizzi liberi) · Findings (da rivedere, sfruttate attivamente, critiche, host più esposto) · Alert sicurezza (alert nel periodo, aperti, agent coinvolti, regole) · Active Directory (computer, utenti, gruppi, lease DHCP, ultima sincronizzazione) · Patch Management (device gestiti, da aggiornare, CVE critiche).
- [x] Riccardo, 13/11: «sì, ma vorrei i tab più evidenti perché deve essere chiaro che ci sono opzioni dentro uno stesso menù», «quasi dei pulsanti da selezionare in alto». **0.9.1227**: le schede sono pulsanti in fila sopra una riga, alti 40 px, testo a 15 px; quello scelto è pieno (fondo primario, grassetto), gli altri hanno fondo tenue e bordo. Sempre da `forma-scheda.ts`, quindi vale per tutte le pagine insieme.
- [x] Mattoni comuni scritti: `FilaNumeri` in `components/shared/console.tsx` e `BarraFiltri` / `PannelloFiltri` / `VoceFiltro` in `components/shared/barra-filtri.tsx`.
- [x] Prima pagina sullo scheletro, **Alert sicurezza**: fila dei quattro numeri («Eventi aperti» si clicca e accende «Solo aperti»); periodo, sistema e stato nel pannello «Filtri», con le etichette accese; una sola fila di categorie, solo quelle con eventi aperti, col numero. Da cinque livelli a tre. **Non vista a schermo** (sessione sull'hub scaduta): è la pagina toccata di più, da aprire per prima.
- [x] Riccardo, 13/11: «alert sicurezza non ha dei TAB di selezione, solo KPI». Le categorie erano pulsantini e, filtrate su «solo quelle con eventi aperti», su DTS ne restava uno. 0.9.1228: le categorie sono le schede della pagina nella forma unica, sempre tutte, col numero quando c'è. Non visto a schermo.
- [x] Riccardo, 13/11, sui numeri di Alert sicurezza: «sono anche troppo grandi». 0.9.1229: `FilaNumeri` non si stira più su tutta la pagina; tessere alte 32 px, larghe quanto il contenuto, etichetta e numero sulla stessa riga. Non visto a schermo.
- [x] Riccardo, 13/11: «Va bene, avanti» (Alert sicurezza a posto). **0.9.1230**:
  - **Active Directory**: le tre guide in un menu «Guide»; «Modifica», «Prova la connessione» ed «Elimina l'integrazione» nel menu «⋯»; fuori restano l'interruttore «Abilitata», «Sincronizza» e «Nuova integrazione». Le cinque tessere grandi tolte: i conteggi stanno già sulle schede (Computer, Utenti, Gruppi, DHCP); resta una fila piccola con «Ultima sincronizzazione» e, se manca, «WinRM non configurato».
  - **Scansioni**: il pannello «1. Tipo» coi quattro riquadri è diventato una fila di schede (`SchedePagina`), con la riga che spiega il tipo scelto sotto; i pannelli seguenti rinumerati da 1.
  - Non viste a schermo. Controllo degli usi anticipati fatto su tutte e due: pulito.
- [x] Riccardo, 13/11: «Vanno bene, avanti» (Active Directory e Scansioni confermate). **0.9.1231, Findings**: sotto il titolo una riga sola («Critici, alti e medi degli ultimi 30 giorni», con la nota completa al passaggio del mouse, accanto allo stato dei dati sugli exploit); la fonte (Tutti, IPAM / Nety, Edge, Wazuh) è la fila di schede della pagina col numero; i dieci filtri rapidi (exploit, stato, sistema) stanno nel pannello «Filtri» e, accesi, sono etichette, insieme a rete e host; gravità e «Raggruppa per» a destra sulla riga dei filtri. Da tre file di pulsanti a due righe. Non vista a schermo; controllo degli usi anticipati pulito.
- [ ] Findings, non toccato: il riquadro «Dove guardare» con le quattro tessere e le barre per rete (ha già il suo apri/chiudi).
- [ ] Da portare sullo scheletro: Sicurezza del dominio (il periodo in alto a destra), Patch Management; e riscrivere subnet e Apparati sui due mattoni (oggi hanno la stessa barra, ma copiata a mano). Una pagina alla volta, aprendola.
- [ ] Resta per pagina, da fare aprendo ogni pagina: Active Directory (nove pulsanti su due righe → una riga e «⋯»); Scansioni (i quattro riquadri del tipo di giro → schede); Alert sicurezza (cinque livelli → due); Findings (intestazione e tre file di pulsanti); Sicurezza del dominio (il periodo in alto a destra); Patch Management; le TabsList con `grid` o larghezze fisse passate dalle pagine, che potrebbero uscire storte con la forma nuova.

## 2026-11-12 — Menu troppo ricco: Network e Sicurezza da riordinare (Riccardo, tavola proposta)

Riccardo, 12/11: «anche il menù mi sembra troppo ricco di opzioni; pur mantenendo le funzioni, alcune sono davvero accessorie e non dovrebbero forse essere visualizzate sempre, e alcune dovrebbero stare dentro altre opzioni… mi serve il tuo aiuto per riorganizzare i menù, i tab della UI, sia della parte network che security».

- [x] Tavola mostrata in chat il 12/11 (prima e dopo, dodici oggetti). Criterio: nel menu resta dove si va tutti i giorni; ciò che serve una pagina diventa una scheda di quella pagina; nessuna funzione si perde, gli indirizzi vecchi continuano a rispondere.
  - **Network da 13 a 6 voci**: Subnet · Discovery (schede Elenco, Attribuzione, Cambiamenti, IP esclusi) · Topologia (Mappa, Porte, Tabella ARP) · Software · Active Directory · Credenziali (Credenziali, Controller di rete). «Sorgenti DHCP» diventa una scheda di «DHCP» in Network Services. Spariscono le intestazioni «Credenziali» e «Diagnostica».
  - **Sicurezza da 8 a 5 voci, senza i blocchi per motore**: Findings · Scansioni (Interne, VA dall'Edge) · Rete (Servizi di rete, Segmentazione, Reti dal trunk) · Alert sicurezza · Sicurezza del dominio.
- [x] Riccardo, 12/11: «Sì, come la tavola». **0.9.1220**: `lib/menu/sezioni.ts` (sei sezioni, 4 prove), `components/shared/schede-sezione.tsx` messa nel layout sopra ogni pagina di una sezione, menu ridotto in `sidebar.tsx`. Gli indirizzi non cambiano. Il numero degli allarmi della rete osservata passa dalla voce «Reti dal trunk» alla voce «Rete». «Scansioni VA» non è più una voce grigia del menu: è la scheda «VA dall'Edge» di Scansioni.
- [x] Visto a 1920 sull'hub (0.9.1220): su `/arp-table` menu Network a sei voci con «Topologia» accesa e schede Mappa · Porte · Tabella ARP; su `/arp-table/trunk` menu Sicurezza a cinque voci con «Rete» accesa (e il numero degli allarmi) e schede Servizi di rete · Segmentazione · Reti dal trunk. Le altre quattro sezioni non aperte a schermo.
- [x] Riccardo, 12/11: «la voce discovery dovrebbe essere apparati o devices». 0.9.1221: la voce di menu, la sezione e il titolo della pagina sono «Apparati»; l'indirizzo resta `/discovery`. Nel codice e nei documenti la pagina si chiama ancora Discovery.
- [x] Riccardo, 12/11: «non vedo più la pagina findings», poi «ho capito dove era posizionato quel menù» e «sì» alla domanda se va bene dentro il gruppo Sicurezza: nessun guasto, Findings resta dov'è.
- [ ] Ancora aperto: il nome della voce «Rete» sotto Sicurezza (si confonde con Network?); se «Software» resta in Network o va in Inventario.

## 2026-11-12 — Intestazione della subnet: troppe opzioni e troppi modi di filtrare (Riccardo, tavola proposta)

Riccardo, 12/11: «l'intestazione ha molte opzioni e molte modalità di filtri e credo sarebbero da chiarire, ottimizzare»: «Spunta tutte le righe ha poco senso con i filtri già possibili»; «le voci griglia e lista insieme ai filtri fanno perdere il significato di quelle funzioni»; «i pulsanti in alto un pochino a sinistra ed uno a destra non hanno molto senso»; «i filtri attivabili potrebbero essere di più»; «il filtro per categoria dovrebbe prevedere di poter scegliere anche la madre di una categoria, non solo le foglie».

- [x] Tavola grafica mostrata in chat il 12/11, tredici oggetti: (1-5) una riga sola di azioni sulla rete, tutte a sinistra, con «Avanzata» e «Profilo» dentro il menu di «Scoperta host»; (6) Lista/Griglia a destra, come cambio di vista e non in mezzo ai filtri; (7) casella di ricerca; (8) filtri attivi come etichette che si tolgono con ✕; (9, 12) un solo pulsante «+ Filtro» con dentro tutti i filtri, compresi i nuovi (è un apparato, in DHCP, in AD, con credenziale valida, senza categoria, da rivedere); (10) conteggio «N di M righe»; (11) barra delle azioni sulle righe spuntate, che compare solo con una spunta; via «Spunta le righe di tipo»; (13) scelta della categoria con la madre come riga che si sceglie, col numero di righe.
- [ ] Nota: la madre si può già scegliere («Telefonia: tutte» è la prima voce di ogni gruppo), ma non si vede: è questo che la tavola corregge.
- [x] Riccardo, 12/11, su Discovery: «la gestione dei filtri è fatta con selezione da una lista e anche con pulsanti, è un doppione, anche se i pulsanti diretti sono comodi». Seconda tavola mostrata in chat: **una barra sola per Discovery e subnet**. I pulsanti di categoria restano e sono l'unico filtro per categoria (via la tendina «Classificazione»): uno per categoria madre, col numero; la freccia apre le figlie. Tutti gli altri filtri stanno in «+ Filtro» e, accesi, compaiono come etichette con la ✕. Via le righe «Vista» e «Tutti / Attribuzione / Da rivedere» come pulsanti a parte: «Da rivedere» e «Più IP» diventano filtri.
- [x] Riccardo, 12/11: «ok, cerchiamo di non usare tutto lo schermo per i filtri, eventualmente avendo un'area ad espansione o un pannello che si apre a destra… vedi tu». Scelto il pannello a destra. **Subnet, 0.9.1218**: riga 1 = «Filtri · N» (apre il pannello con Stato, Classificazione a due livelli, Sistema, Produttore, Fisico o virtuale, Funzione, Solo conosciuti), i filtri accesi come etichette con la ✕, «N di M righe», Lista/Griglia e aggiornamento a destra; riga 2 = le categorie madri presenti nella rete, un pulsante l'una col numero, su una riga sola che scorre; la barra delle azioni compare solo con righe spuntate; tolto «Spunta le righe di tipo»; «VA Scan» a sinistra con gli altri pulsanti.
- [x] Riccardo, 12/11: «procedi». 0.9.1222: scelta una categoria madre, le sue classi presenti compaiono accanto come pulsanti tratteggiati («› Switch 43»), nella subnet e in Apparati (`figliePresenti`, con prova); un clic sulla figlia restringe, un secondo torna alla madre. Nella subnet tre filtri nuovi nel pannello: «Solo gli apparati», «Solo quelli in Active Directory», «Solo con indirizzo da DHCP».
- [x] Visto a 1920 sull'hub (0.9.1222) in Apparati: clic su «Rete» → 39 di 316, etichetta «Categoria: Rete ✕», figlie «› Switch 15», «› Router 13». Uscivano in fondo alla riga e si tagliavano a destra: nella 0.9.1223 stanno subito dopo la loro madre. La 0.9.1223 non è stata rivista a schermo.
- [x] **Guasto mio, Riccardo 12/11: «la pagina subnet ora va in errore a dts».** Nella 0.9.1222 i tre `useState` dei filtri nuovi stavano sotto `filteredHosts`, che li legge: «Cannot access before initialization» a ogni resa, pagina subnet caduta su DTS e sull'hub per le 0.9.1222 e 0.9.1223 (circa 20 minuti). Il controllo dei tipi non lo vede e la subnet non l'avevo aperta dopo la modifica (avevo guardato solo Apparati). Corretto nella 0.9.1224 spostando le dichiarazioni. Lezione: dopo una modifica a una pagina la si apre, quella pagina, non la vicina.
  - [x] 0.9.1224 su DTS e hub. Confermato da Riccardo il 12/11: la pagina della subnet su DTS «si apre».
- [ ] Non fatto della tavola: «Avanzata» e «Profilo» dentro il menu di «Scoperta host»; i filtri «con credenziale valida» e «da rivedere» nella subnet (il dato non arriva alla pagina); i tre filtri nuovi in Apparati.
- [x] Vista a 1920 sull'hub (`/networks/3`, 0.9.1218): due righe, «Filtri», conteggio, Lista/Griglia e aggiornamento sulla prima; categorie madri sulla seconda. Pannello dei filtri e barra della selezione non aperti.
- [x] Riccardo, 12/11: «Sì, Discovery». **0.9.1219**: stessa barra. Riga 1: ricerca, «Filtri · N» (pannello a destra con le nove tendine e «Solo le righe da rivedere»), etichette dei filtri accesi, a destra «Colonne: …» (era la riga «Vista»), colonne, CSV, aggiorna. Riga 2: categorie madri col numero, «Senza categoria», «Più IP», collegamento «Attribuzione», e la paginazione a destra. Da tre righe di filtri a due.
- [x] Vista a 1920 sull'hub (0.9.1219): Discovery ha titolo e filtri su una riga, categorie e paginazione sulla seconda; pannello dei filtri aperto e letto (nove tendine, «Solo le righe da rivedere», «Togli tutti», «Mostra N righe»). Nessun filtro applicato dal vivo.
- [ ] Rimasto morto in Discovery dopo il cambio: i preset personali dei pulsanti («Gestisci filtri», `presetsDialogOpen`, `contaPreset`, `ICON_MAP`, «Altre categorie vuote») e il collegamento «Classification». Da togliere, oppure da rimettere se Riccardo usa i preset personali.
- [ ] Riccardo, 12/11: «non capisco come siano stati persi i vendor di tantissimi oggetti». Misurato, **nessuna perdita trovata**: DTS 516 righe col produttore su 783 (466 su 744 il 03/11, 510 stamattina; nessuna riga che l'aveva e l'ha perso); le 267 senza sono 258 MAC casuali (telefoni: il produttore non esiste), 6 con prefisso `00:CE:39` che il registro non conosce, 3 senza MAC. Hub: 13 tolti ieri dalla bonifica del cambio di inquilino (iPhone con «HP Inc.», Mac con «Proxmox»), voluti. Da chiedere a Riccardo dove lo vede (pagina e una riga d'esempio).

## 2026-11-12 — Automatismi: funzioni e apparati che nascono da soli (Riccardo)

Riccardo, 12/11: «manca anche l'assegnazione delle funzioni per le cose conosciute, la generazione automatica degli apparati dentro discovery se snmp li classifica o le credenziali funzionano e il sistema riesce ad accedere; dobbiamo gestire molti automatismi, per evitare di fare troppe cose manualmente».

- [x] Misura su DTS: **0 funzioni scritte**. Funzioni e «Apparati creati da soli» erano agganciati solo ai giri `snmp_scan` e `nmap_scan` pianificati; su DTS girano solo `fast_scan` e `known_host_check`, quindi non partivano mai. 0.9.1216: agganciati anche a `fast_scan` (e le funzioni a `ping_sweep`). Su DTS applicate a mano con `funzioni-cli.ts 71734 --applica`: 93 funzioni su 86 apparati (33 router, 26 DNS, 9 storage, 9 hypervisor, 5 DB, 3 AD, 3 web, 2 DHCP, 2 posta, 1 backup).
- [ ] **«Apparati creati da soli» esiste già** (`devices/apparato-automatico.ts`, interruttore `apparati.automatici`, del 10/11) ma su DTS è spento, e anche acceso farebbe poco: vuole una credenziale validata sull'host, e ce ne sono 21 in tutto (10 SSH, 8 WinRM, 3 SNMP); gli host con credenziale validata e senza apparato sono 6.
- [ ] **L'anello che manca: 86 host hanno risposto a SNMP nella scansione ma non hanno una credenziale SNMP «validata»**. La scansione legge con le community della rete e non segna quale voce dell'archivio ha funzionato (`setHostCredentialValidatedByKey`). Da fare: quando SNMP risponde con la community di una voce in archivio, segnarla validata per quell'host; da lì l'automatismo crea l'apparato e partono le letture. Tocca lo scanner e le credenziali: zona gialla, da fare con prova su copia.
  - [x] Riccardo, 12/11: «Sì, entrambe» (segnare la credenziale e accendere gli apparati automatici su DTS); e «ssh è OK, il test delle credenziali caricate c'è». 0.9.1217: `credentials/snmp-letto.ts` (`segnaSnmpLetto` agganciato in `scanner/discovery.ts` dopo l'upsert dell'host; `validaSnmpGiaLetti` + `scripts/snmp-letti-cli.ts` per le letture già in archivio). Non prova niente di nuovo: annota una lettura riuscita. Prova a vuoto su DTS: 87 host con SNMP letto, 58 da segnare, 1 già valido, 28 letti con «public» senza voce in archivio. Il comando vuole `npx tsx --env-file=.env.local` (serve la chiave per leggere le community).
  - [x] Un apparato per gruppo: c'era già (`creaApparatiAutomatici` salta gli altri IP dello stesso `multihomed_links`).
  - [x] Applicato su DTS alla 0.9.1217 (13:05 circa, ora italiana), copia `/opt/da-ipam/data/backups/71734-pre-apparati-automatici-20261112.db`: 58 credenziali SNMP segnate (validate da 3 a 61). Apparati automatici: 16 host esaminati, **7 creati** (`srv-veeam`, `SRV-WIN2025`, `lic-catia`, `SRV-PDM` via WinRM; `FQ-FILES` e `DTS4ABB` via SNMP; `MK-D1-VRRP` via SSH), 9 saltati perché altri indirizzi di un apparato che c'è già. Apparati da 95 a 102, job «Apparati creati da soli» n. 34 (lettura alle 06:30 ora italiana). **Interruttore `apparati.automatici` acceso su DTS**; servizio riavviato senza giri in corso. Prima lettura non vista.
  - [ ] I 61 host con SNMP valido erano quasi tutti già apparato: per questo ne sono nati solo 7. I 28 letti con «public» non hanno una voce in archivio: per farli nascere serve una voce «public» nella lista della rete, da decidere con Riccardo.
  - [ ] `MK-D1-VRRP` è nato come apparato a sé: da verificare con Riccardo se è un secondo router fisico o l'indirizzo virtuale di `MK-D1-RTR`.
- [ ] Senza apparato su DTS, per classe: 30 router (10 con SNMP letto), 20 server, 19 stampanti (16 con SNMP), 9 NAS, 6 hypervisor, 2 AP, 2 UPS. Molti router sono indirizzi dello stesso MikroTik: l'automatismo deve creare un apparato per gruppo, non per indirizzo.
- [ ] Da decidere con Riccardo: accendere `apparati.automatici` su DTS; SSH e WinRM restano legati alle credenziali già validate (regola del 10/11: il giro non ne prova di nuove).

## 2026-11-12 — Un modo solo per la classificazione: «Attribuzione» e «Controllo classi» insieme (Riccardo, proposto)

Riccardo, 12/11: «ora ha quel pulsante ed ho anche attribuzione che fanno lo stesso lavoro o ci provano; vorrei un unico modo che funzioni al meglio, controlla anche gli algoritmi di assegnazione».

- [x] Letto: «Attribuzione N/M» apre `ip-contesi-dialog.tsx` (righe dove le fonti del motore non sono d'accordo, si sceglie a mano); «Controllo classi» apre le regole fuori dal motore (`classification/controllo.ts`). Due porte per lo stesso lavoro.
- [x] Misura sul motore, DTS 12/11 (783 righe): categoria retta da **una fonte sola su 268 righe**; la fonte più usata è il nome host (256 righe, peso 0,64), il produttore dal MAC decide solo su 74. **258 righe senza categoria**: 179 hanno il produttore, 128 un nome, 98 un sistema operativo, 87 delle porte. Il motore non usa ciò che ha.
- [x] Riccardo, 12/11: «Sì, procedi». Fatto nella 0.9.1215:
  - motore (`attribution/emitters.ts`): `OUI_FAMIGLIA`, produttori che fanno quasi solo una famiglia (automazione, IoT, telefoni VoIP, MikroTik, videosorveglianza, stampanti) a confidenza 0,65, cioè appena sopra la soglia e sotto ogni altra fonte; nome da server (`SRV-…`, `…_srv`) che vince sulla scheda virtuale. Misura su copia di DTS: 34 righe prendono la categoria (20 automazione, 6 router, 3 server, 2 stampanti, 2 «VM» → server, 1 postazione), senza classe da 218 a 192. Con 0,55 erano 8: restava sotto la soglia `MIN_CLAIM_SCORE` 0,56.
  - un pulsante solo: «Attribuzione N/M» nella subnet apre la pagina (`/controllo-classificazione?rete=<id>`, ora intitolata «Attribuzione», stessa voce nel menu e in Discovery); le righe con fonti in disaccordo si aprono da lì («Fonti in disaccordo», la finestra di prima). Tolti dalla subnet il pulsante «Controllo classi» e la finestra.
- [x] Applicato su DTS alla 0.9.1215 (12:25 circa, ora italiana), copia `/opt/da-ipam/data/backups/71734-pre-famiglie-produttore-20261112.db`: **senza classe da 268 (stamattina dopo il primo ricalcolo) a 172**, con categoria 615 su 783; i 18 Espressif sono IoT, i 5 snom VoIP; nessuna scelta a mano toccata. Un telefono è passato a IoT (nome da telefono su scheda Espressif): da guardare. Job 3 della LAN BASE rimesso a 720 minuti e acceso, servizio riavviato senza giri in corso; i tre job risultano accesi.
- [ ] Riccardo, 12/11: «il motore deve usare tutto, da snmp ai rilievi passivi, alle porte aperte, alla presenza in ad, ai macaddress». Oggi usa: produttore dal MAC, nome, porte, SNMP, AD, Wazuh, vicini LLDP/CDP/MNDP, annunci mDNS/SSDP/WSD, NetBIOS, nmap. **Non usa**, pur avendole in archivio: `dhcp_leases`/`ad_dhcp_leases`, `mac_port_entries` (porta dello switch), `rete_rilievi` (passivi), `servizi_rete`, `host_funzioni`, `software_inventory`, e `os_info` per la categoria. Da misurare una per una su DTS e aggiungere come fonti. Non visti: i 17 Espressif e i 5 snom che non hanno preso categoria nella prova.
- [ ] Trovato insieme: sulla LAN BASE di DTS il job 3 è tornato spento. Alle 12:15 circa era a 120 minuti (messo dalla scheda) e il riavvio dell'aggiornamento lo ha rispento: la regola sulle reti da /22 in su vuole almeno 720 minuti, la scheda lascia scegliere meno e non lo dice. Da decidere con Riccardo: rimetterlo a 12 ore, e far rifiutare alla scheda gli intervalli che la regola spegnerebbe.
- [ ] Il pulsante «Controllo classi» nella subnet esce tagliato a destra a 1920 (schermata di Riccardo): sparisce con la proposta (2).

## 2026-11-12 — Controllo della classificazione: quella scritta contro la migliore possibile (Riccardo, in discussione)

Riccardo: «servirebbe un sistema che controllasse la classificazione dei device presente con quella migliore possibile; sul server 172.16.0.2 del cliente DTS ho dei casini totali di assegnazione».

- [x] Misura in sola lettura su DTS (71734, `ssh dts`, 0.9.1208), 12/11: 783 righe, 78 scelte a mano. Cinque famiglie di errore:
  - **classe rimasta senza motore**: 14 telefoni e un orologio (`Galaxy-S25`, `iPhone`, `S24-di-…`, `Watch` in 10.0.80.x) scritti «VoIP» con `attr_category` vuota; in tutto 36 righe hanno una classe che il motore oggi non sostiene;
  - **senza classe ma con segnali**: 390 righe (`unknown` o vuoto), 388 con MAC, 200 con produttore, 257 con un nome; fra i produttori Siemens, Keyence, HMS, ESTIC, ASEM, Tosibox (OT), Espressif (IoT), Intel con nome (PC), Routerboard, Ubiquiti, snom;
  - **forma al posto della funzione**: 18 «VM» fra cui `SRV-PDM`, `SRV-GEST`, `SRV-VEEAM`, `SRV-WIN2025` (sono server; che siano virtuali lo dice già «Fisico o virtuale»);
  - **segnali che si contraddicono**: telefono Yealink con «Windows XP» e nome `prdal-bianchi`; `UNIFI` e altre VM Linux con «Windows 7»;
  - **lo stesso apparato su tante righe**: 25 «Router» per quattro o cinque MikroTik (`MK-D1-RTR` su una dozzina di indirizzi).
- [x] Riccardo, 12/11: «Sì, scrivilo». `src/lib/classification/controllo.ts` (regole indipendenti, 11 prove) e `scripts/controllo-classificazione-cli.ts <copia-del-db>`: rifiuta il DB vivo, ricalcola sulla copia, stampa per famiglia. Girato su una copia di DTS (copia e file tolti dopo): **152 righe cambiano col solo ricalcolo del motore di oggi** (123 senza classe e 12 «VoIP» diventano smartphone), 5 «VM» sono server, 2 sistemi non credibili, 266 senza classe di cui 91 con una proposta dal produttore (29 automazione, 19 postazioni Intel, 17 IoT, 6 MikroTik, 5 snom, 4 GE Security).
- [ ] Da guardare: `172.17.4.1` «SIP-T27G» che il motore porterebbe da VoIP a router (indirizzo di gateway con un nome di telefono); «GE Security» proposto come telecamera è un'ipotesi.
- [x] Riccardo, 12/11: «Sì, applica». Ricalcolo su DTS alle 11:06 (ora italiana), copia prima in `/opt/da-ipam/data/backups/71734-pre-ricalcolo-classi-20261112.db`. Confronto con la copia: 151 righe cambiate (123 senza classe → smartphone, 12 VoIP → smartphone, 9 perdono la classe, 7 altre), senza classe da 387 a 268, **nessuna delle 111 scelte a mano toccata**. Servizio attivo. Non visto a schermo.
- [x] Riccardo, 12/11: «Sì, la pagina». `/controllo-classificazione` (menu Network → «Controllo classi»): elenco dei rilievi con filtro per famiglia, spunte, «Applica» (scrive come scelta a mano) e «Ricalcola col motore di oggi». Rotta `api/hosts/controllo-classificazione` (GET lettura, POST solo admin), `classification/controllo-db.ts`. Fatta senza tavola prima, per fretta: da guardare con Riccardo.
- [x] Riccardo, 12/11: «in discovery ho impostato la categoria su molti telefoni e su dei router mikrotik che cadevano in "da rivedere" e non è cambiato nulla»; «molti dei router mikrotik erano semplicemente degli ip aggiuntivi rispetto al principale… dovevi aver generato un sistema per accorpare i duplicati, almeno nella vista discovery dove contano gli oggetti non gli ip». Misurato su DTS:
  - le categorie **sono state salvate** (scelte a mano da 78 a 111); «da rivedere» riguarda `firmware` e `model` scritti da un profilo (45 righe, 41 già con categoria a mano) e la categoria non lo toglieva. Ora la categoria messa a mano toglie il segno (`classification/scrivi.ts`). Le 41 già fatte restano segnate: da togliere con «Conferma» o con un comando, col sì di Riccardo.
  - i MikroTik: 18 righe di **quattro router diversi** in un gruppo solo, perché tutti hanno il seriale `F2510000.USB3` (la porta USB); altre 8 righe dello stesso router fuori da ogni gruppo perché il MAC non era un'ancora; e Discovery accorpava solo gli apparati fisici censiti, non i gruppi di indirizzi. Corretto: `hosts/ancore-gruppo.ts` (seriale finto fuori, stesso MAC vero dentro, VRRP/HSRP e MAC casuali esclusi, tetto 16 righe) nelle due copie del motore; `devices/cluster-discovery.ts` accorpa anche i gruppi di indirizzi.
  - [x] **Errore mio: DTS segue `dev`, non `main`** (`git rev-parse` sull'appliance). Riccardo aveva detto «Sì, promuovi» sulla mia premessa sbagliata: **`main` non è stato toccato**, la promozione resta da decidere per le altre appliance.
  - [x] La 0.9.1210 e la 0.9.1211 **non compilavano** (la pagina importava `controllo.ts` → `cambio-inquilino.ts` → database nel browser): DTS e hub le hanno rifiutate e sono rimaste sulla versione di prima. Corretto nella 0.9.1212 (`nomePersonale` in `nomi-generici.ts`). La build locale in questo worktree non parte (manca `next` in `node_modules`): la prova vera è stata la build di DTS.
  - [x] Verificato su DTS alla 0.9.1213, gruppi rifatti a mano (alle 11:25 circa): `MK-D1-RTR` 12 righe, `MK-D1-VRRP` 6 (con le righe senza nome dello stesso MAC), `MK-D3-RTR` 2, `MK-D2-RTR` da solo. Spariti i gruppi finti: nove PC uniti dal seriale «Default string», diciotto `SIP-T23G`, sette `TE210` (`ancoraDiModello`, segnaposto dei BIOS in `eSerialeFinto`). Gruppi da 38 a 36, righe unite da 164 a 134.
  - [ ] Restano gruppi dubbi da seriali ereditati (`PS-ELIA`/`PS-ELIA2`/`Watch`, 8 righe con 4 MAC; `FQ-ROMANO`, 7 righe con 4 MAC): Discovery non li accorpa (più di due MAC veri = righe tutte visibili), ma il gruppo è sbagliato. È il rimedio A (cambio di inquilino) sui seriali.
  - [ ] Discovery accorpata non vista a schermo su DTS.
- [x] Riccardo, 12/11: «dove dovrebbe essere?» (cercava la riclassificazione nella barra della subnet). 0.9.1214: pulsante «Controllo classi» a destra nella riga dei filtri della subnet (apre il controllo già ristretto a quella rete, `?rete=<id>`) e accanto a «Da rivedere» in Discovery. Su DTS dalle 12:10 circa; su `main` no. Non visto a schermo.
- [x] **`main` promosso il 12/11 col sì di Riccardo** («Sì, promuovi», dato di nuovo dopo la correzione sulla premessa): fast-forward `0adc1331`..`5eff81e1` = 0.9.1213, verificato con `git ls-remote`. Cancello su quel commit, letto dai codici di uscita: tipi 0, lint 0, 8194 prove, 0 rosse (un `TODO` noto, G10 famiglia 5). Build non eseguibile nel worktree (node_modules è un collegamento): vale quella riuscita su DTS per la 0.9.1213. Appliance su `main` non verificate dopo l'aggiornamento.
- [ ] Prossimo: la pagina «Controllo classificazione» con «Applica» sulle righe spuntate (91 proposte dal produttore e 5 «VM» che sono server restano sulla carta); rilanciare il controllo per il numero vero di «stesso apparato».
- [x] Riccardo, 12/11: «in discovery e in subnet sarebbe utile avere un filtro prepopolato con i valori trovati per il campo produttore o vendor dal macaddress». Filtro «Produttore» nelle due pagine (`classification/produttore.ts`): elenco dei produttori trovati col numero di righe, dal più frequente, più «Non si sa». Non visto a schermo.

## 2026-11-11 — Vista cliente: porte di rete in testa, e l'idea della dashboard unica (Riccardo)

- [x] Riccardo (11/11): «servirebbe un box in alto con un link agli apparati di rete che hanno memorizzato uno schema delle porte usate, per poter vedere rapidamente che porte sono disponibili, un po' come gli ip nelle network» · «ovviamente un modulo che si apre» · «non direttamente visibile» · «indicavo nel pannello veloce» (la striscia di riquadri in testa a `/cliente`). Fatto: riquadro «Porte di rete» (`components/cliente/riquadro-porte.tsx`) che apre un modulo con gli apparati e, per quello scelto, il pannello delle porte; dati da `apparatiConPorte` (`lib/cliente/schede/apparati.ts`, due query in tutto). «Libera» è quella della pagina Apparati: porta non collegata all'ultima lettura (le porte spente in configurazione contano come libere). Apparati: switch e router, come nella pagina Apparati; i firewall restano fuori.
- [x] Riccardo (11/11): le porte senza stato letto «a parte». `PortaCliente.stato` ha un terzo valore `senza_stato` (bordo tratteggiato, numero col «?»), contato a parte nel modulo e nella pagina Apparati; 0.9.1185-1186. Hub 533: 243 libere su 440, 8 senza stato (tutte di `SW-LAB-PROXMOX`). Visto a schermo a 1920. Non guardati: tema scuro, altre larghezze, la pagina Apparati col nuovo segno.
- [ ] **Idea da riprendere (Riccardo, 11/11)**: «questa potrà diventare la dashboard unica per tutti, semplicemente chi non ha diritti avanzati non potrà vedere tutto; quindi i moduli della dashboard attuale possiamo riproporli anche in questa visione». Vuol dire: `/cliente` come casa unica, i riquadri della Dashboard di oggi portati nella libreria della casa (`lib/cliente/casa.ts`, `RIQUADRI_CASA`), ognuno visibile o no secondo il ruolo. Da pianificare: censimento dei moduli della Dashboard, regola dei diritti per riquadro, cosa succede alla Dashboard attuale. Tocca il lavoro della sessione «01 - riclassificazione (fork)» sulla vista cliente: un flusso solo, non due.

## 2026-11-11 — I job in un posto solo: Schedulazioni (Riccardo, base)

Riccardo (11/11): «i job schedulati a questo punto sono sia nel menù schedulazioni che in setting/schedulazioni» → «opzione 2» (tutta la gestione in Schedulazioni) → tavola a sette oggetti, «Sì, scrivila». Su `dev` 0.9.1182 (`c748a65a`), sull'hub 533.

- [x] Schedulazioni: «Nuovo job» (`components/schedulazioni/nuovo-job.tsx`, la finestra che stava in Impostazioni), «Esegui ora», «Modifica» per i job «Lettura apparati» (`FinestraScansioneAutomatica`), «Elimina» con conferma, esito per apparato dall'esito della riga (`EsitiApparatiScelti`). Colonna «Dove» → «Azioni».
- [x] Impostazioni: tolta la scheda «Job pianificati» (stato, funzioni, costanti e import); `/settings?tab=jobs#job-<id>` porta a `/settings/schedulazioni#job.<id>`. Rimandi aggiornati: scheda dell'apparato, finestra di Discovery, notifica dello scheduler (la prova `rimandi-impostazioni` l'ha trovata).
- [x] Visto a schermo a 1920 sull'hub con `prova-claude-admin`: intestazioni, 27 «Esegui ora», 2 «Modifica», 27 «Elimina», esiti aperti del job #29, finestra «Nuovo job», rimando dal vecchio indirizzo, nessuna scheda job in Impostazioni. Prove 44/44, `tsc` 0, lint pulito.
- [ ] **Non provati dal vivo**: creare, modificare ed eliminare un job (clic che scrivono). «Modifica» c'è solo per «Lettura apparati», come prima: l'intervallo degli altri job si cambia ancora da Opzioni. Tema chiaro/scuro e larghezze diverse da 1920 non guardati.

## 2026-11-11 — Categorie e sottocategorie (Riccardo)

Riccardo, 11/11: «le categorie dovrebbero essere raggruppate tipo OT → IoT, PLC, HMI… POSTAZIONI → PC, Notebook, Workstation… prova a ricostruire le categorie con categorie e sottocategorie per avere filtri anche più efficaci; manca anche il gruppo Telefonia, con Telefoni, Smartphone, Centralino, Convertitori VoIP»; poi «ok teniamo separato IoT da OT, anche se fatico io a distinguerle».

- [x] Dieci categorie al posto di sei in `src/lib/device-classifications.ts`: Postazioni (PC, Notebook, Tablet, Thin client) · Telefonia (Telefono VoIP, Smartphone, Centralino, Convertitore VoIP) · Server (Server, VM, Hypervisor) · Archiviazione (NAS) · Rete (11 classi) · Stampa (Stampante, Multifunzione, Scanner) · Video (Telecamera, Videoregistratore, Smart TV, Decoder, Media player, Console) · OT (PLC, HMI, Rete OT) · IoT (IoT, Sensore, Domotica) · Alimentazione (UPS, PDU). Ogni categoria ha una riga che dice cosa contiene (`DEVICE_CATEGORY_GROUP_COSA`), visibile passando sul titolo nel menu: serve per OT e IoT.
- [x] Cinque classi nuove (`centralino`, `gateway_voip`, `nvr`, `pdu`, `thin_client`), con la mappa verso il motore (`attribution/taxonomy.ts`) e la proiezione dal motore (`attribution/legacy-projection.ts`).
- [x] Filtri a due livelli in subnet e Discovery (`passaFiltroCategoria`, valore `gruppo:<categoria>`).
- [x] Le regole delle proposte di scansione (`vuln/proposta/regole.ts`) usavano i gruppi vecchi: adeguate senza cambiarne l'esito, classe per classe.
- [x] Prove: 8130 su 8131 dell'intero progetto. Adeguate 5 asserzioni di `legacy-projection.test.ts` che dicevano «centralino, convertitore, videoregistratore e PDU non hanno una classe».
- [ ] **Prova già rotta, non di questo lavoro**: `src/lib/scanner/__tests__/discovery-accesso-windows.test.ts`, caso «credential_validate: il guasto sui candidati Windows non ferma SSH sullo stesso host» → «The database connection is not open». Fallisce uguale sul commit `2162c296` (v0.9.1157, prima delle modifiche dell'11/11 al riconoscimento). Da guardare a parte.
- [ ] Decisi da me in assenza di risposta, da confermare: «PC» resta una voce sola (la classe `workstation`); il Tablet resta fra le Postazioni; ~~«Video» tiene insieme telecamere e televisori~~ → Riccardo, 11/11: «una categoria Multimedia e una Videosorveglianza sono più corrette»: divise (undici categorie).
- [x] Chiarito l'11/11 (Riccardo: «la casella categoria abilita una selezione del gruppo, non l'applicazione per il gruppo scelto di una categoria comune»): la tendina «Seleziona per tipo» spunta le righe e non assegna; il pulsante che assegna era «Categoria…», grigio. In v0.9.1180 e v0.9.1181 (`f99c71be`): pulsante «Assegna categoria a N…» in evidenza; la scelta dalla cella «Categoria» di una riga spuntata vale per tutte le spuntate, con l'avviso in cima; la tendina si chiama «Spunta le righe di tipo». Visto a 1920 sull'hub con due righe spuntate. **Non provato dal vivo il salvataggio**, né per una riga né per più.
- [ ] Riccardo, 11/11: «è difficile distinguere tra PC e workstation; forse si potrebbe distinguere tra PC Windows, Linux e OSX». **In attesa della sua scelta, niente codice.** Fatto da portargli: il 21/10 (decisioni V3-V6, `classification/canonico.ts`) aveva deciso il contrario per i server: `server_windows` e `server_linux` sono diventati `server` più il sistema a parte, e così i NAS per marca. Il sistema è già una dimensione sua del motore (`attr_os_family`). Misura sul 70791: PC 38 Windows, 3 Linux, 5 ignoti; notebook 3 macOS, 1 Linux, 2 ignoti; server 15 Linux, 12 Windows. Proposta: tenere «PC» classe unica e mostrare il sistema accanto («PC · Windows»), con un secondo filtro «Sistema» che vale per tutte le categorie (anche server e VM), invece di tre classi nuove solo per i PC.
- [ ] Riccardo, 11/11, in aggiunta: «come per i server Windows, Linux…» e «forse anche la logica VM server Windows, VM server Linux». Sono tre cose indipendenti: cosa fa (Server, PC), che sistema ha (Windows, Linux, macOS), se è fisico o virtuale. A classi sarebbero una dozzina di combinazioni; proposta: tre attributi, ognuno un filtro, e a schermo «Server · Windows · virtuale». Misura sul 70791 (virtuale = produttore della scheda VMware, QEMU, Proxmox, Microsoft, Parallels): 26 server su 28 sono virtuali (14 Linux, 12 Windows); 9 PC su 46 sono virtuali; 72 righe sono classe «VM» senza altro ruolo, 40 delle quali senza sistema. «VM» oggi è una classe: con l'attributo «virtuale» diventerebbe «non si sa ancora cosa fa».
- [ ] Riccardo, 11/11: «e classificare le funzioni… DNS, DHCP, AD, DB, web… molte si potrebbero determinare direttamente dalle scansioni e servizi». **Proposta, niente codice.** Il campo c'è già: `hosts.server_roles`, otto ruoli (`RUOLI_SERVER` in `classification/canonico.ts`: dc, dns, dhcp, mail, web, database, backup, nfs), con le caselle nella scheda. Ma sul 70791 **nessun host ha un ruolo scritto**: si riempie solo a mano o dalle classi vecchie. Dalle porte già lette si ricaverebbero: DNS (53) su 13 host, AD (88) su 3, banche dati (1433, 5432) su 5, posta (25) su 3, file NFS (2049) su 17. Da non ricavare dalle porte: «web» (80 e 443 stanno su 113 host, sono le pagine di gestione di ogni apparato) e DHCP (la 67 è UDP e non la leggiamo: va preso dalle sorgenti DHCP viste in rete). Quarto attributo accanto a categoria, sistema e fisico/virtuale; vale per ogni apparato, non solo per i server (il DNS spesso è il router).
- [ ] **Piano breve — quattro attributi dello stesso apparato** (Riccardo, 11/11; livello leggero, un passo alla volta, misura sul 70791 a ogni passo):
  - [x] 1. **Sistema** come filtro in subnet e Discovery (in Discovery non si applicava al cambio di valore: mancava una dipendenza, corretto col passo 2) (`src/lib/classification/sistema.ts`, Windows, Linux, macOS, Sistema di rete, Non si sa). Nessuna classe nuova.
  - [x] 2. **Fisico o virtuale**: attributo nuovo, dalla scheda di rete (VMware, QEMU, Proxmox, Microsoft, Parallels), col suo filtro. Riccardo, 11/11, sulla classe «VM»: «sì, se non definito direttamente sì, anche perché potrebbero essere VM client o VDI» → la classe «VM» resta per le macchine di cui non si sa il ruolo; una VM può essere un server ma anche una postazione (client, VDI). **Fatto** (`src/lib/classification/forma.ts`, filtro in subnet e Discovery). Misura sul 70791: 114 virtuali, 194 fisici, 56 non si sa. La prima versione dava «virtuali» 15 host Proxmox fisici (guardava il nome del prodotto): corretta dopo la misura, ora conta la scheda. Visti grazie all'attributo: «3cxtest» è classe smartphone ma è una VM Proxmox; due «SynologyNAS» sono virtuali.
  - [~] 3. **Funzioni** (DNS, DHCP, AD, banca dati, web, posta…). Riccardo, 11/11: «le funzioni si riempiranno o si inseriranno manualmente da un gruppo definito», e l'elenco è «ancora da definire». Quindi: prima si decide con lui l'elenco delle funzioni, poi si scrive il riempimento dalle scansioni e la scelta a mano. Punto di partenza: gli otto ruoli di `RUOLI_SERVER`. **Fatto l'11/11** (v0.9.1191-1193): catalogo di 32 funzioni in nove gruppi (`src/lib/classification/funzioni.ts`), riconoscimento da servizi in esecuzione, porte, server di dominio, categoria e ruoli; tabella `host_funzioni`; ricalcolo a fine scansione; filtro «Funzione» in subnet e Discovery; funzioni visibili sotto la categoria nella subnet. Sull'hub, cliente 70791: **99 funzioni su 81 apparati** scritte dopo la prova a vuoto coi nomi (DNS 13, DB Server 6, AD 2, DHCP 2, RADIUS 2, Posta 3, Monitoraggio 3, Web 2, Backup 1, Accesso remoto 1, più Hypervisor 24, Storage 17, Router 17, Controller di rete 4, Firewall 1 dalla categoria). La prova a vuoto ha tolto due regole: porta 21 da sola e porta 88 da sola. **Manca**: le funzioni in Discovery come colonna, DHCP dalle sorgenti viste in rete, le regole strette per file server, server di stampa, VPN e proxy.
    - Proposta dell'elenco, 11/11 (aspetta l'ok di Riccardo, niente codice). Quattordici funzioni: Controller di dominio (AD), DNS, DHCP, File server, Server di stampa, Banca dati, Web, Posta, Desktop remoto, VPN, Proxy, Backup, Monitoraggio, Log di sicurezza. Facoltative: Container, Aggiornamenti (WSUS), Certificati. Non sono funzioni perché sono già categorie: centralino (Telefonia), hypervisor (Server), NAS (Archiviazione).
    - Riccardo, 11/11, sull'elenco: la 4 si chiama **«DB Server»**; la 1 **«AD o LDAP»**; **Storage** è anche una funzione («esistono sistemi virtuali»); **anche Firewall e Router**. E una lista lunga (una cinquantina di voci in otto gruppi) «da analizzare, non da tenere per buona: prendiamo solo spunto».
    - Ne segue un principio: la **categoria** dice che cosa è l'apparato, la **funzione** che cosa fa. Un server virtuale può fare da firewall, router, storage o centralino: quelle voci esistono sia come categoria sia come funzione.
    - Seconda proposta (in attesa, niente codice), 28 funzioni in 8 gruppi presi dalla sua lista: **Rete** (DNS, DHCP, NTP, Router, Firewall, VPN, Proxy e bilanciatore) · **Identità e accessi** (AD o LDAP, RADIUS, Certificati, Accesso remoto) · **Dati e applicazioni** (DB Server, Web, Server applicativo) · **File e storage** (File server, Storage, Trasferimento file, Server di stampa) · **Posta e telefonia** (Posta, Centralino VoIP) · **Sicurezza e monitoraggio** (Monitoraggio, Log e SIEM, Protezione endpoint, Scansione vulnerabilità) · **Backup** (Backup) · **Virtualizzazione e gestione** (Hypervisor, Container, Gestione e aggiornamenti). Più «Altro», da definire per cliente.
    - Riccardo, 11/11: «in più "IA locale", NDR…». Aggiunte: **IA locale** in Dati e applicazioni (si può riconoscere dalle porte dei motori locali, es. 11434, e dalle schede NVIDIA), **NDR** in Sicurezza e monitoraggio (solo a mano). Le funzioni sono 30. I puntini dicono che l'elenco può crescere: va tenuto in un punto solo e facile da allungare.
    - Riccardo, 11/11: «controller domotica, network controller, monitoring system…». Aggiunte: **Controller di rete** in Rete (chi è già di quella categoria ha la funzione; riconoscibile anche dalle porte UniFi e Omada), **Controller domotica** in un gruppo nuovo «Impianti e domotica» (riconoscibile da Home Assistant sulla 8123 e simili, altrimenti a mano). «Monitoring system» è la voce **Monitoraggio** che c'era già. Le funzioni sono 32 in nove gruppi.
    - Lasciate fuori dalla sua lista, perché troppo fini per i clienti che abbiamo o non riconoscibili: API, cache, code di messaggi, motore di ricerca, storage a oggetti, SSO, vault, IDS/IPS, bastion, orchestrazione container, collaborazione, IPAM. Unite ad altre: reverse proxy e bilanciatore (in Proxy), relay e filtro posta (in Posta), repository, replica e disaster recovery (in Backup), raccolta log e SIEM, inventario, automazione, distribuzione software e PXE (in Gestione e aggiornamenti).
    - Tre fonti misurate sul 70791: le **porte** (53 su 13 host, 88 su 3, 1433 e 5432 su 5, 25 su 3, 8007 su 1, 10051 su 3); i **servizi in esecuzione letti dagli agenti** (`wazuh_service`, 22.253 righe da 44 computer, 2.748 in esecuzione: la fonte più precisa, dice il nome del servizio); le **altre letture** (`dc_lettura` per i server di dominio, `dhcp_leases` e le sorgenti DHCP).
    - Trappole viste nella misura, da scrivere come regole strette: «dns» prende anche il client DNS di ogni Windows (`dnscache`): 22 computer invece di 2-3; il servizio di condivisione file (`lanmanserver`) e lo spooler di stampa girano su ogni Windows (22 e 21): file server e server di stampa si dicono solo con condivisioni o code vere; «VPN» prende anche i client NetBird (9); le porte 80 e 443 sono su 113 host: «web» solo dal programma (IIS, nginx, Apache), non dalla porta.
  - [~] 4. **Scelta a mano** di sistema, virtuale e funzioni nello stesso menu della categoria. **Funzioni: fatto l'11/11** (v0.9.1194, `8bab607b`): «Funzioni» sulla riga della subnet apre l'elenco a gruppi; spunta = metti o togli, freccia = torna automatica; vale per le righe spuntate. `impostaFunzioneAMano` e `POST /api/hosts/funzioni`. Visto a 1920 sull'hub, **salvataggio non provato dal vivo**. **Manca**: la scelta a mano di sistema e di fisico o virtuale; lo stesso comando in Discovery. Riccardo, 11/11: «aggiungiamo una colonna e togliamo aggiungi a LibreNMS e Wazuh, che saranno solo in Discovery; la colonna dispositivo… basta un badge come per DHCP o AD… con il link» → fatto in v0.9.1196 (`7bac641e`): colonna «Funzioni», colonna «App.» col segno «APP» che apre la scheda, tolte «LibreNMS» e «Wazuh» dalla subnet (e le due letture che le riempivano). Visto a 1920 sull'hub; in quella rete nessuna riga è un apparato, quindi il segno «APP» non l'ho visto reso.
  - [ ] Mostrare gli attributi accanto alla categoria nelle liste («Server · Windows · virtuale · AD, DNS»), dopo i passi 2 e 3.
- [ ] Non fatto: la vista cliente usa una sua tabella di tipi (`src/lib/cliente/schede/apparati.ts`), non queste categorie; la pagina Apparati dell'amministratore non è stata guardata.

## 2026-11-11 — Riconoscimento: il telefono che diventa stampante (Riccardo)

Riccardo, 11/11: «il mio Samsung S25 viene rilevato come stampante nel riepilogo degli oggetti ed è rilevato due volte nella subnet… un cambio di IP, che dovrebbe essere automaticamente corretto; non capisco da dove viene identificata la categoria, se dai dati di discovery o della subnet; e anche un oggetto che non è device deve essere possibile assegnarlo a una categoria in modo efficace». Solo diagnosi, misurata sull'hub (cliente 70791): niente codice scritto.

- [x] **Causa 1 — la riga è l'indirizzo, non l'apparato.** `S25-Ultra-di-riccardo` ha 6 righe in `hosts` (id 31, 93, 248, 370, 413, 421), su tre reti, con 5 MAC diversi tutti «privati» (casuali per rete). La riga 248 (192.168.5.142) era una Kyocera: il telefono ha preso quell'indirizzo, la riga ha cambiato nome e MAC ma ha tenuto `snmp_data`, `os_info`, `vendor`, porte e `detection_json` della stampante; il ricalcolo rilegge quei campi a ogni giro e riemette `snmp_sysobj → peripheral.printer` a 0,95 con la data di oggi. Stessa cosa sulla 370 (era un Fanvil → `voip.phone`) e sulla 93 (era una VM Proxmox → `compute.vm`).
- [x] **Causa 2 — `mac_gemello` (aggiunto il 10/11) peggiora:** 248 e 370 hanno lo stesso MAC, quindi si scambiano «stampante» e «telefono VoIP», tutte e due ereditate dall'inquilino di prima.
- [x] **Causa 3 — le scelte a mano non arrivano al motore:** 106 host con `classification_manual = 1`, **0** con un'evidenza `manual` in `attribution_evidence`. Le pagine dell'amministratore mostrano `hosts.classification` (che la scelta a mano protegge), la vista cliente mostra `attr_category` (che la ignora): sulla riga 93 uno dice «smartphone», l'altro «macchina virtuale». È la risposta a «da dove viene la categoria»: da due campi diversi.
- [x] Misure: 59 host su 367 con MAC privato, di cui 15 con una categoria che non c'entra (router, VoIP, stampante, server) e 6 con `snmp_data` di qualcun altro; 36 nomi ripetuti su 111 righe.
- [x] **Rimedio A — cambio di inquilino** (11/11, v0.9.1163 e v0.9.1164, `f4dd2762`): `src/lib/hosts/cambio-inquilino.ts`, agganciato alle due `upsertHost`; opzione per cliente «Indirizzo passato a un altro apparato», **spenta di serie**; `scripts/cambio-inquilino-cli.ts <cliente> [--applica]`. 1265 prove verdi. Sull'hub (0.9.1164) **solo prova a vuoto**: 30 righe con MAC privato e dati altrui, di cui **16 sicure** (nome di apparato personale: iPhone, iPad, Watch, Mac, S25, Fairphone, con produttore HP, Fanvil, Proxmox, TP-Link…) e **14 da non toccare** (NAS con MAC di servizio e SNMP vero: DA-ADRA, SynologyNAS; macchine virtuali VMware; 7 righe con lo stesso MAC `82:FA:6F:7D:6D:54`). Il primo criterio le avrebbe svuotate tutte e 30: stretto dopo aver letto i nomi.
- [x] Rimedio A applicato sull'hub l'11/11 con l'ok di Riccardo («sì, entrambe»): 16 righe ripulite, interruttore `riconoscimento.cambio_inquilino` = 1 sul 70791 dalle 11:57 (ora italiana). Copia prima: `/opt/da-invent/data/backups/70791-pre-cambio-inquilino-20261111.db` sull'hub. **Errore mio durante la pulizia:** `svuotaInquilino` toglieva anche il nome, che nella bonifica è dell'apparato di adesso; tolto a 16 righe e **rimesso subito dalla copia** (16 su 16). Corretto in v0.9.1167 (`94b35aba`, opzione `tieniNome`) insieme alla firma di nome dei Samsung S. Dopo il ricalcolo: le 6 righe dell'S25 sono tutte `mobile.phone`; iPhone, iPad e Fairphone a posto; 5 «Mac» e 1 «Watch» senza categoria (prima erano VM, VoIP o niente: senza categoria è più vero).
- [ ] Da capire (visto l'11/11 nella prova a vuoto): il MAC `82:FA:6F:7D:6D:54` sta su 8 righe di LAN Base con nomi diversi (DA-SW-CORE-SUPPORT, MLAG-MK504-DOWN, VEEAM-PX-01/02, spark-eb8a, MikroTik, U7-Pro, e l'S25 su 192.168.15.129). È un MAC privato: o un apparato risponde per altri, o un MAC sbagliato viene scritto su più righe.
- [ ] **Rimedio B — MAC privato:** con un MAC privato l'OUI non dice niente e non si usa (né `oui` né `mac_gemello` fra reti diverse); firma di nome per i Samsung (`S25`, `S24-Ultra`…) accanto a quelle già scritte. Attenzione: MAC privato non vuol dire telefono (lo usano anche contenitori e macchine virtuali).
- [x] **Rimedio C — lo stesso apparato su più righe** (Riccardo, 11/11: «sì, tutte e tre»; v0.9.1169, `ef09255a`):
  - Il motore dei gruppi (`multihomed_links`) **riunisce già** le 6 righe dell'S25 in un gruppo solo, per nome. Però: (1) la pulizia notturna **non archivia mai** una riga che sta in un gruppo (`pulizia-candidati.ts`), quindi le righe vecchie di un telefono che gira restano per sempre: sul 70791 sono 15 le righe assenti da più di 30 giorni tenute così; (2) i nomi generici fanno gruppo: **8 iPhone diversi sono un gruppo solo**, e così 4 «MikroTik» (`MH_HOSTNAME_BLACKLIST` in `db-tenant.ts` riga 9042 ha solo router, switch, server, nas…); (3) la vista cliente conta una volta sola per `physical_device_id`, non per gruppo: l'S25 lì vale 6.
  - Proposta C1: un nome generico (iphone, ipad, watch, mac, android-…, mikrotik, meross…) non fa gruppo.
  - Proposta C2: un gruppo conta una volta in ogni conteggio, e lo rappresenta la riga vista più di recente (anche nella vista cliente: correzione da dare a Cursor).
  - Proposta C3: in un gruppo di apparato personale (nome distintivo + MAC privati), le righe assenti oltre la soglia della pulizia (sul 70791: 30 giorni) si archiviano, se un'altra riga del gruppo è stata vista dopo. L'archivio si può recuperare. Per l'S25 oggi: da 6 righe a 2 (resta quella del 9/11 e quella del 29/10). Da decidere: se la classe scelta a mano continua a proteggere anche queste righe (la riga di agosto dell'S25 è scelta a mano).
  - Fatto C1: `src/lib/hosts/nomi-generici.ts`, usato dalle due copie del motore dei gruppi. Sull'hub i gruppi sono passati da 20 a 19 e le righe in gruppo da 93 a 75 (sciolti «iPhone» e «MikroTik»).
  - Fatto C3: `indirizziPassati` in `src/lib/hosts/pulizia-candidati.ts`; 820 prove verdi. Sull'hub, dopo la prova a vuoto coi nomi e la copia (`/opt/da-ipam/data/backups/70791-pre-indirizzi-passati-20261111.db`), **6 righe in archivio**: 4 dell'S25 (id 31, 248, 370, 421), 1 iPhone (121, non più protetto dal gruppo sbagliato), 1 Mac (395). L'S25 ha ora 2 righe (9/11 e 29/10). Archivio da 47 a 53, recuperabile; nessuna riga d'archivio cancellata.
  - C2 (un gruppo conta una volta): nella vista cliente è il **Task 9** del piano `docs/superpowers/plans/2026-11-11-vista-cliente.md`, da dare a Cursor. Nelle pagine dell'amministratore non è stato guardato.
  - Sull'hub `/opt/da-invent` è un collegamento a `/opt/da-ipam`: i file copiati a mano durante un aggiornamento spariscono.
- [x] **Rimedio D — la scelta a mano vale dappertutto** (11/11, v0.9.1158, `d9754d5f`): `src/lib/attribution/scelta-a-mano.ts`, agganciato al ricalcolo e a `scriviClassificazione`; 482 prove verdi. Applicato sull'hub (0.9.1160) col ricalcolo del cliente 70791: **105 scelte a mano su 106** hanno ora l'evidenza `manual` e classe e categoria coincidono (prima 51); nessuna classe a mano toccata. Resta 1 host con classe `windows`, che non ha una categoria nella mappa. Copia prima del ricalcolo: `/opt/da-invent/data/backups/70791-pre-scelta-a-mano-20261111.db` sull'hub. Le due righe dell'S25 scelte «smartphone» sono `mobile.phone`; le due prese a una stampante e a un Fanvil (id 248, 370) restano sbagliate fino ai rimedi A-C.
- [ ] Trappola vista l'11/11: `systemctl start da-ipam-update` mentre il giro del timer è già in corso non fa niente, e quel giro ha già letto `origin` prima del push. Si aspetta la fine e si rilancia; si controlla `ultimo_successo.commit`, non la versione.
- [x] **Rimedio E — assegnare una categoria a qualunque riga, in fretta** (Riccardo, 11/11: «sì, scrivila». Scritto per la pagina della subnet: menu sulla riga, colonna unica «Categoria», stessa scelta per più righe.: Rilasciato in v0.9.1171 (`cd51fa30`), servito dall'hub e **guardato a 1920** sulla subnet «LAN Storage»: colonna «Categoria» con l'origine, «Rilevato» tolta, menu sulla riga con ricerca e sei gruppi. **Il salvataggio non è stato provato dal vivo** (avrebbe scritto una scelta a mano su un host vero); la rotta è quella di prima. Poi, v0.9.1175 (`dbca2372`): la stessa scelta in **Discovery** (cella e «Modifica in blocco», con le categorie del cliente in un gruppo loro) e sul **tasto destro della griglia degli indirizzi**. Guardate a 1920 sull'hub tutte e tre (subnet, Discovery con ricerca «nas», griglia). **Non provato dal vivo il salvataggio** in nessuna delle tre. Non scritta la scorciatoia «tutte le senza categoria»: oggi si fa col filtro «Classificazione».
  - C'è già: caselle per riga, «Categoria…» per più righe (`components/networks/categoria-blocco-dialog.tsx`, dell'08/11), «Seleziona per tipo», «Modifica in blocco» in Discovery. Per una riga sola servono casella + pulsante + finestra, e la scelta è un elenco piatto di 52 classi.
  - Manca, proposto: (1) clic sulla cella della categoria → menu sulla riga, senza finestra; (2) nel menu la proposta del sistema in cima, da confermare con un clic; (3) le categorie a due livelli (macro → tipo) con ricerca, quelle del motore; (4) «Torna automatica» nello stesso menu; (5) lo stesso menu per più righe scelte e dalla griglia degli indirizzi.
  - Visto guardando la pagina, ed è il motivo di «non capisco da dove viene la categoria»: due colonne affiancate, «Attribuzione» (il motore: «Compute 98%») e «Rilevato» (l'impronta vecchia: «TrueNAS 75%» su un QNAP), che dicono cose diverse. Proposto: una colonna sola «Categoria» con da dove viene («dal nome», «da SNMP», «a mano»); «Rilevato» va nel dettaglio. È il lato visibile del punto D (ritiro dei classificatori vecchi).
- [ ] Ordine proposto: D, A, B, C, poi E. Aspetta l'ok di Riccardo.

## 2026-11-11 — Vista per operatori non amministratori (Riccardo, in discussione)

Riccardo: «una sola UI con i dati rilevanti senza mostrare le complessità e i comandi di configurazione, ovviamente in read only… qualcosa che possa essere l'estensione della dashboard attuale, casomai modulare». La vista è nel codice dall'11/11 (piano `docs/superpowers/plans/2026-11-11-vista-cliente.md`). Le voci sotto sono lo storico di quella mattina.

- [x] Riccardo, 11/11: l'operatore è **una persona del cliente**. Ne segue: un cliente solo, parole semplici (niente Wazuh, Scanner-Edge, hub, evidenze, confidenza), un modulo spento non si vede (mai «non configurato → impostazioni»), nessun dato interno di Domarc (credenziali, scansioni, aggiornamenti).
- [ ] Da decidere: se può fare qualcosa oltre a leggere (consiglio: no); quanto dettaglio dare sulle vulnerabilità (consiglio: macchina, gravità, rimedio, niente dettaglio tecnico dell'attacco).
- [ ] Proposta in discussione: la Dashboard diventa la casa dell'operatore, a schede (Panoramica · Reti · Apparati · Da sistemare · Dominio e accessi · Alert), ogni scheda un modulo che compare solo se il modulo è attivo sul cliente; il ruolo «Solo lettura» (`viewer`, esiste già) vede solo quella, senza il menu laterale completo.
- [ ] Misurato l'11/11: i riquadri della Dashboard portano tutti alle pagine complete (`/networks`, `/discovery`, `/vulnerabilities`, `/security-alerts`, `/sicurezza-dominio`, anche `/settings/...`); 287 file di rotte usano `requireAdmin`. Da misurare prima di consegnare: quali rotte di scrittura passano solo da `requireAuth`.
- [ ] Riccardo, 11/11, cosa deve esserci: «ad-health · porte visualizzate · vlan e info sul trunk passivo · info di wazuh se presente». Dove vanno: Health AD (`/sicurezza-dominio?tab=health`) in «Dominio e accessi»; pannello porte degli switch (`lib/scheda/porte-da-guardare.ts`, `/port-map`) in «Apparati»; VLAN e reti viste dal Sensore trunk (`lib/trunk/`, `/arp-table/trunk`) in «Reti»; Wazuh in una scheda «Sicurezza» che c'è solo se il modulo è attivo. Riccardo, 11/11: «porte» = **entrambe**, porte degli switch (in «Apparati») e porte aperte degli host (nella scheda del singolo apparato).
- [x] Riccardo, 11/11: tavole di Panoramica e Reti approvate («sì va bene così»).
- [ ] Riccardo, 11/11: «pensiamola modulare per le eventuali estensioni; wazuh può diventare SIEM o Security Log». Proposta: un registro delle schede della vista (un file per scheda: id, titolo, modulo richiesto da `lib/modules/registry.ts`, contatore, riquadri, voci per «cosa richiede attenzione»), così una scheda nuova è un file e una riga, senza toccare la pagina. La scheda si lega alla **categoria** del modulo (`siem`, `logs`), non a Wazuh: se domani la fonte cambia, la scheda resta. Nome a schermo: **«Log di sicurezza»** (Riccardo, 11/11; «SIEM» resta il nome interno della categoria); le vulnerabilità tornano in una scheda loro («Da sistemare»).
- [ ] Riccardo, 11/11: «puoi anche usare una UI completamente diversa con moduli e un template diverso dedicato a questo scopo». Proposta: stessa applicazione, area a parte (gruppo di rotte suo, es. `/cliente`, con il suo layout e i suoi componenti, senza menu laterale), rotte dati sue e di sola lettura (`/api/cliente/*`, solo GET); il ruolo «Solo lettura» entra lì e non vede altro; l'amministratore la apre con un pulsante «Vista cliente» dalla Dashboard, che resta com'è. Non un'app separata (secondo deploy, secondo accesso). Riccardo, 11/11: **solo scrivania**, niente telefono (si ragiona a 1920).
- [x] Riccardo, 11/11: cornice approvata («sì, questa»): casa a riquadri, uno per modulo attivo (numero principale, riga di contesto, segno di stato), con «cosa richiede attenzione» in cima; il clic apre la pagina del modulo a tutta larghezza. Tavole di Reti e Apparati valide come pagine interne.
- [ ] **Piano approvato l'11/11: `docs/superpowers/plans/2026-11-11-vista-cliente.md`** (8 task: utente Cliente e recinto, template e casa, Reti, Apparati, Dominio e accessi, Log di sicurezza, Da sistemare, stampa e documenti). Riccardo, 11/11: «il piano lo svilupperà un altro agente, sii molto preciso: darò le consegne a Cursor e tu controllerai» → il piano cita tabelle, colonne e funzioni vere, lette nel codice quel giorno. Niente ruolo nuovo: il ruolo ha un `CHECK` nel database hub, quindi si usa `viewer` più la colonna `users.vista_cliente`; gli utenti «Solo lettura» di oggi restano come sono. Le pagine leggono il database da funzioni in `src/lib/cliente/`, senza rotte `/api` nuove. **Approvato da Riccardo l'11/11, livello leggero.** Lo esegue Cursor un task alla volta; ogni task si controlla sul commit prima del successivo.
- [x] Vista cliente, stampa e documenti (Task 8): in stampa spariscono «Stampa», «Esci», «Torna alla Dashboard» e «← La tua rete»; sfondo bianco; i riquadri non si spezzano. Come si crea l'utente è nel manuale. La prova sull'hub con un utente Cliente vero (entra, apre le schede, `/settings` torna a `/cliente`, `GET /api/hosts` risponde 403) non è stata fatta: il servizio non ha ancora questo commit e non ho creato un utente sul database dell'hub.
- [~] Vista cliente, prova sull'hub 11/11 11:38 (servizio 0.9.1160): come amministratore sul 70791 le pagine rispondono e Da sistemare mostra 120 programmi, senza sigle. Resta da fare con l'utente `demo`: `/settings` deve tornare a `/cliente` e `GET /api/hosts` deve rispondere 403. La password di `demo` non è nel vault.
- [ ] Vista cliente, Log di sicurezza: in testa alla pagina compare «fonte: Wazuh SIEM», il nome del modulo. Nella vista non devono comparire parole interne.
- [x] Vista cliente, Task 1 (utente «Cliente» e recinto): fatto da Cursor (`3a0da573`, v0.9.1140), controllato l'11/11: 62 prove verdi, file e firme come da piano. Non provato sul dev (la pagina `/cliente` nasce col Task 2). Aggiunto al piano il Task 1 bis: un utente già dentro, passato a Cliente, resta fuori dal recinto finché non rientra.
- [x] Vista cliente, Task 1 bis (`9d99898e`, v0.9.1142) e Task 2 (`13681f8f`, v0.9.1143): fatti da Cursor, controllati l'11/11 sul codice, 65 prove verdi. La casa `/cliente` l'ha vista Riccardo sull'hub l'11/11, da amministratore («ok ho visto»); il recinto con un utente Cliente vero resta da provare. Correzione messa nel Task 3: un superadmin su «tutti i clienti» oggi vedrebbe i dati di `DEFAULT`.
- [x] Vista cliente, Task 3 (scheda Reti, `3ac1b4d8`, v0.9.1144): fatto da Cursor, controllato l'11/11 sul codice, 7 prove verdi; non guardata a schermo. Due ritocchi messi in testa al Task 4 (VLAN distinte, al più 5 voci di attenzione dal trunk).
- [x] Vista cliente, deciso da Riccardo l'11/11: gli host assenti da più di 7 giorni sono un **quarto stato, più chiaro** (non «liberi»). Misura sul 70791: 186 accesi, 57 spenti da poco, 124 assenti. Scritto nel piano, in testa al Task 4.
- [x] Vista cliente, Task 4 (scheda Apparati e quarto stato «assente», `288cdde7`, v0.9.1145): fatto da Cursor, controllato l'11/11 sul codice e sui dati del 70791, 14 prove verdi; non guardata a schermo. Tre ritocchi messi in testa al Task 5: «spento da 2 giorni fa» (frase sbagliata), pannello porte che si apre anche per i due NAS, 22 host con categoria senza foglia che perdono il «cos'è».
- [x] Vista cliente, recinto dal vivo: Riccardo l'11/11 ha passato `demo` a «Cliente (vista semplice)» dall'interfaccia; sull'hub il segno è acceso e la sessione vecchia è stata chiusa. Cosa vede `demo` a schermo: da confermare da Riccardo.
- [x] Vista cliente, Task 4 (scheda Apparati e quarto stato, `288cdde7`, v0.9.1145): fatto da Cursor, controllato l'11/11 sul codice (14 prove verdi) e **guardato a schermo a 1920** sull'hub dalla sessione di Riccardo (casa, Reti, Apparati; tema scuro).
- [ ] Vista cliente, **Task 4 bis — resa** (nel piano, 12 correzioni viste a schermo): marchio invisibile sul tema scuro, «spento da 7 giorni fa», reti viste sul cavo piene di rumore (25, anche pubbliche), dettaglio di Apparati fuori schermo, «Server 150» che sono 99 macchine virtuali, righe con insegne di porta al posto del sistema. Da fare prima del Task 5.
- [ ] Riconoscimento: `PC-LasagniF` (Windows 11 Pro, 192.168.4.175) risulta «Router» sul 70791. Visto l'11/11 guardando la vista cliente.
- [x] Vista cliente, Riccardo l'11/11: il tema **segue la preferenza** (non forzato in chiaro). Aggiunto al Task 4 bis il comando chiaro/scuro nell'intestazione, perché l'utente Cliente non vede il menu utente.
- [ ] Vista cliente, colori del marchio (Riccardo 11/11: «dovresti anche usare i colori del brandmark di Domarc, non i colori attuali»): tavola approvata sul tema chiaro, scritto nel piano come **Task 4 ter** (dopo il 4 bis, prima del 6): fascia navy `#0D2537` col logo bianco in tutti e due i temi, filo e barre in cian `#00A7E7`, anello giallo `#FFD400` per «scelto», griglia per luminosità. La resa sul tema scuro è una proposta non ancora vista. **Attenzione: due sessioni scrivono lo stesso piano** (questa e quella che ha guardato a schermo e scritto il 4 bis): prima di aggiungere un task si rilegge il piano da `origin/dev`.
- [x] Vista cliente, Task 5 (Dominio e accessi, `d92be786`, v0.9.1147): fatto da Cursor, controllato l'11/11 sul codice e sui dati del 70791, 22 prove verdi; non guardato a schermo da questa sessione. Tre ritocchi in testa al Task 6: «100 su 100» è il rischio massimo e sembra un voto pieno; «vedi i nomi» non mostra mai niente (il dato vero non ha `CN=`); fino a 10 rilievi gravi finirebbero in «Cosa richiede attenzione».
- [x] Vista cliente, Riccardo 11/11: **il piano lo tiene una sessione sola**, quella che l'ha scritto e controlla i task (worktree `.worktrees/da-ipam-classi-vecchie`). Le altre sessioni scrivono qui i difetti che vedono, non aggiungono task nel piano. Scritto anche in testa al piano.
- [x] Vista cliente, Task 4 bis (correzioni di resa, `bf5c3673`, v0.9.1149): fatto da Cursor, controllato l'11/11 sul codice, 28 prove verdi; **non guardato a schermo** in nessuno dei due temi. Due ritocchi in testa al Task 4 ter: il segnaposto «Scegli un apparato…» non compare mai (`hidden` senza `xl:block`), `quantoSpento` è rimasta senza uso.
- [ ] Vista cliente, Task 7 (Da sistemare, `4de0b8a5`, v0.9.1155): fatto da Cursor come da piano, 36 prove verdi, **ma sul dato vero non regge** (misura dell'11/11 sull'hub, 70791, con uno script di sola lettura): per apparato escono conti di CVE («374 gravi · 2211 alte» su `monitor.domarc.it`, contro i 124 e 385 del riquadro), la «cosa più grave» è una sigla, il rimedio c'è per 10 apparati su 92. Errore del piano. **Deciso da Riccardo l'11/11: sì, per programma** (scritto nel piano come Task 7 bis, dopo il 6 bis). La vista per software, che sugli stessi dati dà righe leggibili («Google Chrome su 3 computer», «Kernel Linux su 11», «Windows Server 2019 su 6»; 120 programmi), più le cose da correggere senza aggiornamento (22 rilievi con titolo in italiano: «Login di fabbrica su …», «SNMP accetta la community private in scrittura») e una riga sola per le 106 vulnerabilità senza pacchetto. Da fare comunque: la casa legge i rilievi tre volte (0,8 s l'una), serve una lettura sola per richiesta.
- [x] Vista cliente, Task 4 ter (colori del marchio) e Task 6 (Log di sicurezza), fino alla v0.9.1154: fatti da Cursor di seguito, controllati dopo l'11/11 sul codice, 32 prove verdi; **non guardati a schermo** (né la resa dei colori sul tema scuro, che è una proposta mai vista).
- [x] Vista cliente, deciso da Riccardo l'11/11: «Log di sicurezza» mostra **gli ultimi 7 giorni raggruppati per tipo**, non gli avvisi «aperti» (sul 70791 erano 209, l'ultimo preso in carico il 27/07). Scritto nel piano come Task 6 bis, prima del Task 7.
- [x] Vista cliente, Task 6 bis (log per tipo sugli ultimi 7 giorni, `2162c296`, v0.9.1157): fatto da Cursor, controllato l'11/11 sul codice, 36 prove verdi; non guardato a schermo. Prossimo: Task 7 bis (Da sistemare per programma), poi Task 8.
- [x] Vista cliente, Task 7 bis (`305011a1`, v0.9.1160) e Task 8 (`17626f82`): fatti da Cursor, controllati l'11/11 sul codice, 36 prove verdi. **Piano chiuso sul codice, consuntivo scritto nel piano.** Casa composta sull'hub coi dati veri del 70791 (script di sola lettura): cinque schede attive, 16 voci di attenzione, nessun errore.
- [ ] Vista cliente, **aperto dopo il piano**: (1) nessuno ha guardato a schermo colori, Dominio, Log, Da sistemare e stampa, in nessuno dei due temi; (2) recinto dal vivo con `demo` da confermare; (3) i rilievi del dominio escono in inglese in casa: serve una tabella di frasi per `rule_id`; (4) la casa impiega ~3,5 s sul 70791 per «Da sistemare»; (5) 64 non riconosciuti visibili al cliente; (6) `scripts/controlla.sh` non esiste: prima di `main` lint, typecheck e build; (7) niente su `main`.
- [x] Vista cliente, 11/11 (fatto da questa sessione, Cursor ha finito i crediti): rilievi del dominio in frasi semplici per `rule_id` (80 regole, `frasi-dominio.ts`), nascosti il punteggio e gli avvisi di lettura; «Cosa richiede attenzione» in colonna stretta a destra con scorrimento (Riccardo: «una barra a destra lunga e stretta… eventualmente un box con la barra di scorrimento»). 41 prove verdi, lint e tipi puliti.
- [x] Vista cliente, **guardata a schermo l'11/11** (questa sessione, Chrome di Riccardo su `da-ipam.domarc.it`, v0.9.1162, finestra 1920): casa col nuovo assetto (riquadri a sinistra, «Cosa richiede attenzione» colonna stretta a destra con scorrimento, rilievi del dominio in italiano), Reti, Apparati col pannello porte (`SW-CED-48POE-242`), Da sistemare, Dominio e accessi, Log di sicurezza sul tema scuro; casa e Reti anche sul tema chiaro. I colori del marchio reggono in tutti e due i temi. Non provati: stampa, recinto con l'utente `demo`.
- [ ] Vista cliente, difetti visti a schermo l'11/11, da fare: (1) in Dominio e accessi i nomi del primo rilievo sono aperti senza clic (nomi di persone in vista); (2) gli switch dichiarati ma senza categoria (`SW-CED-MNGM-238`, `SW-CED-237`) finiscono in «Non riconosciuti» e il loro pannello porte non si raggiunge: usare `network_devices.device_type` quando manca la categoria; (3) nei Log ogni «Servizio installato sul DC: <nome> (<percorso>)» è un tipo a sé, col percorso in vista: raggruppare in una frase sola; (4) Da sistemare è un elenco di 120 righe a tutta larghezza; (5) il pannello porte di uno switch da 48 ne mostra 91; (6) in casa resta molto vuoto sotto i riquadri.
- [x] Vista cliente, casa con i grafici (Riccardo 11/11: «qualcosa di più estetico e che fa colpo, preso dalla dashboard iniziale… box più piccoli in testa alla pagina»; tavola approvata): riquadri piccoli in striscia, cinque grafici dal server (`src/lib/cliente/grafici.ts`, `src/components/cliente/grafici-casa.tsx`), attenzione a destra. Scostamento dalla tavola: il grafico grande è sulle ultime 48 ore, non su 7 giorni, perché oltre le 48 ore la fonte dà un punto al giorno e la curva si appiattisce.
- [x] Vista cliente, casa con i grafici **guardata a schermo l'11/11** sull'hub (v0.9.1165, 1920, tema scuro e chiaro): striscia dei cinque riquadri, grafico grande, reti, anello del rischio, accessi falliti, da sistemare per rete, attenzione a destra. Corretto dopo averla vista: il grafico grande contava 186 mentre il riquadro Apparati dice 171 (uno conta gli indirizzi, l'altro gli apparati senza doppi) → il grafico si chiama «Indirizzi in uso», come il riquadro Reti.
- [x] Vista cliente, accessi falliti (Riccardo 11/11: «su 7 giorni dicono poco… finestra temporale inferiore e un dettaglio migliore»): in casa ora sono le ultime 24 ore, una barra per ora, con chi e da dove (`accessi24Ore` in `schede/dominio.ts`). Chiude anche i due numeri diversi sulla stessa pagina (1414 dai log, 643 dal dominio): fonte unica gli eventi dei server di dominio, e il riquadro in testa usa lo stesso totale.
- [x] Vista cliente, casa componibile (Riccardo 11/11: «griglia prestabilita, con la possibilità di spostarli, di nasconderli, di aggiungerne dalla libreria. Possibile senza incasinarci?» → versione semplice approvata): due colonne, due misure, ordine e visibilità **per cliente** (`tenant_settings`, chiave `cliente.casa`), libreria in `src/lib/cliente/casa.ts`, modalità «Componi la casa» per l'amministratore (`/cliente?componi=1`), salvataggio con `PUT /api/vista-cliente/casa`. Fuori apposta: trascinamento, ridimensionamento a mano, disposizioni per utente.
- [x] Vista cliente, **provato a schermo l'11/11** sull'hub (v0.9.1170, 1920, tema scuro): riquadro «Accessi falliti · ultime 24 ore» (1184 falliti, 21 blocchi, chi e da dove coi nomi degli apparati) e «Componi la casa» (nascosto un riquadro, spostato un altro, cambiata una misura, salvato: la casa è cambiata; poi rimessa la disposizione predefinita e salvata). Non provato: «Componi» sul tema chiaro, la stampa, il recinto con `demo` (che su `PUT /api/vista-cliente/casa` deve ricevere 403).
- [x] Vista cliente: «::1» fra le provenienze ora si legge «il server di dominio stesso»; gli accessi non sono più un riquadro solo da stringere a mezza riga.
- [x] Vista cliente, casa a celle (Riccardo 11/11: «una modalità simile alla pagina di entra.domarc.it, dove potevo ridimensionare gli oggetti; alcuni ora hanno dimensione fissa e non occupano tutta la casella… elenco fallimenti per utente e andamento nel tempo dovrebbero essere due moduli diversi»). Letto il modello in `~/Progetti/DA-Auth/servizio/static/home.js` (griglia a celle, misura in celle, trascinamento, cassetto). Fatto: 12 colonne, righe da 84 px, larghezza e altezza per riquadro, riquadri che riempiono la casella, trascina per spostare, cassetto dei nascosti (`src/components/cliente/griglia-casa.tsx`, `src/lib/cliente/casa.ts`); accessi in tre riquadri; «::1» in chiaro. Differenza da Entra, voluta: l'ordine è un elenco e la griglia riempie i buchi da sola, non c'è una posizione x/y per riquadro né il «lì non c'è posto».
- [x] Vista cliente, casa a celle **vista e provata a schermo l'11/11** sull'hub (v0.9.1172, 1920, tema scuro): i riquadri riempiono la casella, i tre riquadri degli accessi ci sono, «::1» si legge «il server di dominio stesso»; in «Componi» stringere e abbassare un riquadro fa ridisporre gli altri senza buchi (provato senza salvare: sull'hub c'era una disposizione di Riccardo, letta e convertita dalla versione di prima). Non provato a schermo: il trascinamento col mouse. Riccardo, 11/11, sul posizionamento libero cella per cella come in Entra: «no, va bene come hai fatto». Ritocco dopo la prova: la barra dei comandi di un riquadro stretto andava su due righe → icone al posto delle parole.
- [ ] Vista cliente, **censimento delle altre fonti di dati** (Riccardo 11/11: «dopo valutiamo che altre fonti di dati utili per l'utente ci sono nel sistema»). Misurato l'11/11 sul cliente 70791 dell'hub, in sola lettura. Con dati buoni e freschi: apparati nuovi in rete (`hosts.first_seen`: 13 in 7 giorni, 57 in 30); apparati tenuti d'occhio spenti (`known_host`: 29 segnati, 7 spenti); chi usa quale computer (`host_accessi_utente`: 35 computer, 29 account, aggiornato in giornata); sistemi operativi (`wazuh_os`: 46 macchine); memoria (`wazuh_hw`: 17 su 46 sotto 8 GB); disponibilità nel tempo (`status_history`: 3,2 milioni di righe); certificati (`servizi_rete.tls_json`: 168 servizi, scadenza da verificare nel campo); sensori (`librenms_sensore`: 1008, di cui 205 temperature, nessuno fuori limite); DHCP (`dhcp_leases`: 323, di cui 33 in conflitto); assistenza remota (`mc_remote_session`: 36 sessioni, 2 operatori, ultima il 06/11); utenti del dominio (`ad_users`: 83, 51 attivi, 22 attivi fermi da 90 giorni). **Non presentabili oggi**: anomalie (39, tutte «MAC cambiato», tutte aperte: rumore), spostamenti di porta (649 in 7 giorni: rumore), patch (181 fallite contro 108 riuscite), inventario dei beni (59 beni senza date di garanzia). Proposta a Riccardo: primo giro con apparati nuovi, apparati importanti spenti, sistemi operativi, disponibilità dei server, certificati in scadenza.
- [x] Vista cliente, primo giro dal censimento (Riccardo 11/11: «sì, quei cinque»): riquadri «Apparati nuovi in rete», «Apparati importanti spenti», «Disponibilità», «Sistemi operativi», «Certificati» (`src/lib/cliente/altri-dati.ts`, `src/components/cliente/riquadri-altri.tsx`, in libreria). Misurato sul 70791: la disponibilità si legge in mezzo secondo; fra i certificati ne escono 7 da rinnovare, veri (`*.domarc.it` scaduto, `smtp.domarc.it` scaduto il 12/10). Restano dal censimento, da decidere: chi usa quale computer, assistenza remota, computer con poca memoria, sensori, DHCP, utenti del dominio.
- [x] Vista cliente, i cinque riquadri del censimento **visti a schermo l'11/11** sull'hub (v0.9.1176, 1920, tema scuro): apparati nuovi (13 in 7 giorni), importanti spenti (7 su 29), disponibilità (86,9% in media), sistemi operativi (2 macchine con Windows 10 su 46), certificati (7 da rinnovare su 88). Non visti sul tema chiaro. Visto e non corretto: la disposizione che ne esce in coda lascia un buco accanto a «Apparati nuovi» (si sistema da «Componi la casa»); un apparato nuovo senza nome esce con un identificativo lungo (`c94301f2…`) al posto del nome.
- [x] Vista cliente, «Porte di rete» (Riccardo 12/11: «elenca gli switch in modo casuale e senza nessuna ricerca che aiuti a trovarli se ce ne sono molti»): l'elenco ha una casella «Cerca per nome o indirizzo» e due ordini, «Per nome» e «Più libere»; l'ordine per nome è naturale (SW-2 prima di SW-10, maiuscole e minuscole insieme). `src/components/cliente/riquadro-porte.tsx`, `apparatiConPorte`. Tipi, lint e prove di `apparati` verdi; **non visto a schermo**.
- [x] Vista cliente, **«Topologia di rete»** (Riccardo 12/11: «una voce con topologia rete in cui viene mostrata in read only la topologia della rete, però in un modale grande»): riquadro nella striscia in testa alla casa (`src/components/cliente/riquadro-topologia.tsx`) che apre in un modale a tutto schermo la mappa di Topologia senza i comandi dell'amministratore (`TopologyMapClient isAdmin={false}`, nuova proprietà `altezza`). **Tocca il recinto (zona rossa, autenticazione)**: l'utente «Cliente» ora può fare GET, e solo GET, su `/api/topology/model`, `/maps`, `/maps/<id>`, `/links`, `/ports`; `recinto()` riceve il metodo e senza metodo resta vietato. Prova scritta prima e vista fallire (`recinto.test.ts`). Da provare da Riccardo con l'utente `demo`: la mappa si apre, nessun comando di modifica.
- [x] Vista cliente, **stile della Dashboard principale** (Riccardo 12/11, con una schermata: «questi grafici della pagina dashboard principale sono molto chiari»): gli piacciono la fila di numeri in testa (Health, Subnet, Host, Offline, Assenti > 7 g, Archiviati, Monitorati), i quattro riquadri di stato col filo colorato a sinistra (Critiche, Alte, Accessi e alert, Health AD) e le barre «Cose da sistemare per rete» a tutta larghezza. Stesso giorno, seconda schermata («anche questo»): **«Stato host nel tempo»**, l'area di accesi/spenti con i tasti 24h · 7d · 30d, la linea tratteggiata dell'uptime sull'asse di destra e i numeri in testa (Online, Offline, Sconosciuti, Uptime 24 h). Lettura mia, da confermare: vuole quegli stessi oggetti nella casa di `/cliente`. Si aggancia all'idea dell'11/11 in cima a questo file (i moduli della Dashboard nella libreria della casa). **Risposta di Riccardo, 12/11**: «si poteva usare la stessa logica per avere i moduli nella dashboard semplificata; come avevo chiesto era avere i widget completi, semplicemente filtrati, perché alcuni dovrebbero essere solo per amministratori, altri anche per gli utenti solo dashboard». Fatto nella voce qui sotto.
- [x] Vista cliente, **i widget della Dashboard nella casa, gli stessi** (12/11). Dati e widget escono dalla pagina della Dashboard senza cambiare: `src/lib/dashboard/dati.ts` (`datiDashboard`, `moduliDashboard`) e `src/components/dashboard/widget.tsx` (`FilaIndicatori`, `RigaSicurezza`, `RigaRilieviPerRete`, `BarreRilieviPerRete`); la Dashboard li importa, la casa pure. `dove="cliente"` porta i collegamenti alle pagine di `/cliente`; dove non c'è una pagina (impostazioni) niente collegamento. Nella libreria della casa: nuovi «Numeri della rete» e «Sicurezza» (fasce alte una riga, senza cornice, entrano in testa anche a una disposizione già salvata: `inTesta`), «Transizioni recenti», «Moduli»; **sostituiti nel contenuto, stesso id**: `indirizzi` → «Stato host nel tempo» (24h/7d/30d, uptime), `reti` → «Subnet», `per-rete` → «Cose da sistemare per rete». **Filtro**: `soloAmministratori` in `RIQUADRI_CASA`; oggi solo «Moduli». Il Cliente non lo vede e non gli viene offerto. Scelta mia, da confermare con Riccardo: quali altri sono solo per amministratori. `ALTEZZA_MIN` scende a 1. Recinto: GET anche su `/api/status/chart-detailed` e `/api/status/changes`. Restano in libreria ma senza più dati i vecchi grafici `GraficoAccesi`, `BarreReti`, `BarrePerRete` (codice da togliere). Non portato: «Accessi falliti» della Dashboard (quello di Wazuh): la casa tiene i suoi tre riquadri dal dominio.
- [x] **Visti a schermo il 12/11** sull'hub (0.9.1207, 1920, tema scuro, utente `riccardo`): la casa di `/cliente` con i widget della Dashboard (fila di numeri, sicurezza, «Stato host nel tempo», «Subnet», «Cose da sistemare per rete»), la Dashboard degli amministratori uguale a prima dopo lo spostamento del codice, «Porte di rete» con ricerca e i due ordini, il modale «Topologia di rete» con la mappa. **Non visti**: tema chiaro, l'utente `demo` (recinto sulle rotte nuove, assenza di «Moduli» e dei comandi di modifica nella mappa), «Transizioni recenti» e «Moduli» nella casa (in coda alla disposizione). Da rifinire: la fila di numeri occupa metà larghezza e lascia vuoto a destra; sotto «Stato host nel tempo» resta spazio nella casella.
- [ ] Vista cliente, **confronto Dashboard ↔ casa** (Riccardo 12/11: «verifica che KPI e che oggetti mostrano la stessa cosa, cerchiamo di ottimizzare la vista; non rimuovere quanto fatto»). Riferito in chat, niente toccato. Doppioni nella casa: Reti 7 = Subnet 7; «Da sistemare» 506 = Critiche 125 + Alte 381; «Dominio e accessi» 100 = anello «Rischio del dominio» = «Health AD»; «Apparati importanti spenti» = Monitorati 23/29 = «Host conosciuti offline». Numeri diversi per la stessa cosa: Apparati 340 (apparati, i multi-indirizzo contati una volta) contro Host 366 (indirizzi); accessi falliti 558 (eventi dei DC) contro 581 (Wazuh); importanti spenti 7 nella casa ieri contro 6 nella Dashboard oggi (stessa query, momenti diversi). I tre vecchi riquadri sostituiti erano meno completi dei nuovi. Proposta in attesa di Riccardo: togliere dalla vista (non dalla libreria) i doppioni, una fonte sola per gli accessi, un'etichetta sola fra «host» e «apparati».
  - [x] 12/11, Riccardo: «anche perché ci sono dati non coerenti tra le KPI». Corretti i due numeri che nella casa si contraddicevano: la tessera «Accessi falliti 24h» ora mostra il conto dei server di dominio, lo stesso del grafico accanto (`accessiDominio` in `RigaSicurezza`); l'indicatore «Host» nella casa si chiama «Indirizzi», con la nota che spiega la differenza da «Apparati». La Dashboard non cambia. **Non visto a schermo.** **Riccardo, 12/11: «lasciali»**: l'anello del rischio e «Apparati importanti spenti» restano visibili nella casa, non si nascondono. Non riproporre. Sui numeri ripetuti nella striscia dei moduli non ha deciso.
- [ ] **Da controllare e ragionare con Riccardo** (Riccardo 11/11: «ci ragioniamo, perché potrebbero esserci altre fonti, o analisi da fare»): il censimento dell'11/11 non è chiuso. Niente si costruisce prima di averne parlato. Sul tavolo: (1) le sei fonti rimaste — chi usa quale computer, assistenza remota, computer con poca memoria, sensori, DHCP, utenti del dominio; (2) **altre fonti non ancora censite**: il censimento ha guardato le tabelle del tenant 70791, non i moduli spenti lì né le fonti esterne (Zabbix, LibreNMS oltre i sensori, Edge/Vulcan, backup, patch quando saranno affidabili); (3) **analisi, non solo elenchi**: incroci fra fonti che dicano qualcosa al cliente (es. disponibilità × apparati importanti, certificati × servizi esposti, utenti fermi × computer usati, andamento nel tempo invece della fotografia). Da riproporre a Riccardo alla prossima ripresa della vista cliente.
- [x] **Cancello dell'11/11 sera su `7a6891b0` (0.9.1203), chiesto da Riccardo prima del deploy di un'appliance nuova**: lint exit 0, `tsc` exit 0, prove 8172 verdi su 8177 e **1 file rosso**, `src/lib/scanner/__tests__/discovery-accesso-windows.test.ts` (accesso Windows, non vista cliente). Rilanciato da solo: 2 rosse su 109, non sempre le stesse («credential_validate: il guasto sui candidati Windows non ferma SSH sullo stesso host», 15 s e poi «The database connection is not open»; «tenant non migrato…»). La prova fa partire un SSH vero verso `127.0.0.1:22`: dipende dalla macchina e dal tempo, quindi probabile difetto della prova e non del prodotto, **non dimostrato**. Build non eseguibile dal worktree (`node_modules` è un collegamento e Turbopack non lo segue): vale la build dell'hub, che serve `7a6891b0` ed è attivo. **Corretto il 12/11**: causa trovata con una traccia su `closeTenantDb`. Il giro dei servizi di rete di una prova finita scrive ancora in sottofondo (`salvaEsitoSondaServizio`) e riapre il suo database; oltre i 20 aperti la cache LRU chiude il più vecchio, che durante i 15 s di SSH vero è quello della prova in corso. Difetto della prova, non del prodotto (un'installazione ha un tenant): `t.d` ora riprende il database a ogni lettura. File rilanciato due volte: 109 su 109.
- [ ] La scheda Apparati è il punto E del 10/11 (riepilogo per macro categoria): si fa una volta sola, qui.
- [ ] Interfaccia: da proporre oggetto per oggetto con una tavola grafica prima di scriverla.

## 2026-11-10 — Confronto tra giri di rete

Riccardo: iniziare lo sviluppo senza sovrapporsi agli altri lavori. Piano in DA-IPAM, commit `510eca57`.
- [x] Comparatore IPv4 e prove locali in `src/lib/scanner/confronto-giri.ts`. Distingue cambi certi e porte appena osservate. Rifiuta giri incompleti e perimetri diversi. Nessuna modifica a Discovery, Subnet o Edge.
- [x] Riccardo: «Network Changes» è una pagina unica per tutte le subnet, sotto Network. Il collegamento nel dettaglio subnet apre la stessa pagina.
- [x] Riccardo, 11/11: procedere con il collegamento a Discovery. Prima tappa su ramo isolato, con dati del singolo giro e pagina unica.
- [x] Collegato il completamento di Discovery al confronto IPv4. La copertura viene da ICMP, le porte TCP e i MAC da Nmap del singolo giro. Gli esiti ambigui e le porte senza stato individuale restano ignoti.
- [x] Salvate baseline ed eventi nella stessa transazione SQLite, separati per tenant, rete e perimetro. Pagina globale con filtro subnet e cronologia di 90 giorni. Verificate 18 prove mirate, TypeScript, lint sui file toccati e resa a 1920 con dati sintetici.
- [x] Riccardo, 11/11: «metti in dev, le appliance in dev sono OK». Build di produzione, test mirati e lint dei file modificati verdi. Snapshot `pre-nc-discovery-20261111` della VM 533 su DA-PX-03.
- [ ] Collaudare due giri Discovery con lo stesso profilo su una subnet di prova. Misurare quanti host hanno un MAC osservato direttamente da Nmap, soprattutto sulle subnet instradate.
- [x] Riccardo, 11/11: verificare la sovrapposizione con Anomalie. MAC, nuovi host e porte sono temi comuni con fonti e criteri diversi. Sulla VM 533 (build `440dab2a`), il profilo misurato aveva 39 eventi, tutti MAC flip, e nessuna baseline Network Changes. Riprodotti due difetti di formato in Anomalie: porte serializzate come stringhe e `first_seen` SQLite confrontato con ISO.
- [x] Riccardo, 11/11: procedere a ottimizzare le analisi. Anomalie legge porte numeriche, stringhe e oggetti. Per il confronto scarta gli elenchi incompleti e distingue i tipi di scansione. Le finestre per nuovi host, MAC, disponibilità e latenza usano UTC. Verificate 13 prove mirate e lint sui file toccati.
- [x] Build di produzione con TypeScript verde. Snapshot `pre-anomalie-20261111` della VM 533 su DA-PX-03 prima della pubblicazione su `dev`.
- [ ] Da decidere dopo il collaudo: usare gli eventi di Network Changes come evidenze per Anomalie quando la copertura lo consente. Conservare ARP, disponibilità, latenza e storico Gestiti.
- [ ] Tappe successive del piano: copertura UDP e passiva, variazioni di sistema operativo, firmware e confidenza.

## 2026-11-10 — Riconoscimento: un motore solo, firme, apparati creati da soli (Riccardo)

Riccardo, 10/11: «valutare un modo unico ed efficace per le assegnazioni; in subnet e discovery accorpare per probabilità; automatizzare assegnazione e trasformazione in device se le credenziali funzionano». Su `dev` dalla 0.9.1113 alla 0.9.1130; niente su `main`. Dettaglio per chi riapre: `CONTEXT.md`, sezioni del 10/11. Misure sull'hub 533 (tenant 70791) e sul 79993 (`192.168.99.2`, tenant `DEFAULT`).

Fatto
- [x] Valutazione: il motore unico c'è già (`lib/attribution/`); i classificatori vecchi non decidono più ma restano nel codice. Hub: con categoria da 250 su 384 a 302 su 367 (gli host sono scesi per conto loro), «unknown» da 100 a 4, 106 scelte manuali intatte.
- [x] A. Classe vecchia non manuale senza categoria → si svuota (Riccardo: «Sì, svuotale»); `classification_manual` NULL vale 0 (101 host saltati dalla proiezione). 0.9.1113-1114. Classi di prima: `/opt/da-invent/data/backups/classi-pre-ricalcolo-20261110.csv` sull'hub.
- [x] B. **Firme** al posto della somma degli indizi deboli (misurata: 3 host su 107): `FIRME_NOME`, `FIRME_PORTE` in `attribution/emitters.ts`; Fanvil/Yealink → voip, Meross → iot dall'OUI. 0.9.1118-1119.
- [-] C. Categoria prevalente fra i vicini di rete: misurata, non scritta (3 host su 75 con regola stretta; con regola larga sbaglia su Ubiquiti e HP). Da rimisurare su una rete cliente prima di riaprirla.
- [x] A2. **Gemello di MAC** (`attribution/gemelli.ts`, fonte `mac_gemello`). Decisivo da solo su 4 host. 0.9.1119.
- [x] G. **Una VM con un ruolo prende il ruolo** (`attribution/fuse.ts`, Riccardo: «99.13 è un proxmox pbs»). 0.9.1130. Ricalcolato sul 79993 (PBS → server) e sull'hub (4 VM: 2 → hypervisor, 2 → server).
- [x] F. **Apparati creati da soli** (`devices/apparato-automatico.ts`, Opzioni → Automatismi, spento di serie). Risposte di Riccardo: classe del motore se confidenza ≥ 80; «snmp, ssh, winrm e se l'apparato risponde a più protocolli devono essere registrati tutti»; nessuna esclusione; per tenant; `192.168.4.42` «va creata»; IP multipli col motore che c'è (`multihomed_links`). 0.9.1123-1126.
  - Hub 533: 19 apparati creati (da 43 a 62), interruttore acceso alle 21:35 del 10/11. Copia del database prima: `/opt/da-invent/data/backups/70791-pre-apparati-automatici-20261110.db`. Sette nati col tipo sbagliato (3 VM come nodi Proxmox, 4 PC come switch): corretti nel codice (0.9.1126) e a mano sulle righe.
  - 79993: interruttore acceso alle 21:42, 2 router creati («MK-RG-DOMOTICA» snmp; «MK-RG-CHR» ssh + snmp). Si entra dal Proxmox `192.168.99.1`, `qm guest exec 963`.

Aperto
- [x] Letture dei 19 apparati dell'hub, accertato l'11/11: dopo 15 ore ne risulta letto 1 su 19 (`DA-RT-OUT`) e i 21 legami sono `untested`. **Non è un difetto della creazione**: un apparato si legge solo a mano dalla sua scheda (`devices/lettura-info.ts`) o se una persona lo mette in un job «Lettura apparati» (`apparati_scelti`, elenco chiuso di `device_ids`). Sull'hub c'è un job solo, «Switch e router del CED», con 6 apparati: dei 43 apparati vecchi, letti nelle ultime 48 ore proprio quei 6, 27 letti almeno una volta.
- [x] Riccardo (11/11): «Sì, tutti» (`192.168.4.42` compresa). Ogni apparato creato da solo entra nel job «Apparati creati da soli» (Lettura apparati, ogni giorno alle 06:30, sole informazioni): `devices/letture-automatiche.ts`, 0.9.1177 (`84f55e81`). Dal server la prima lettura parte subito dopo la creazione. Prove 14/14 + scheduler e job di lettura 66/66, `tsc` 0. **Hub 533**: job #29 con i 19 apparati (id 848-866), scheduler ricaricato (28 job). **79993**: job #14 con 3 apparati (i 2 router più l'apparato 210, creato da altri dal 10/11: il recupero prende per data).
- [ ] **Prima lettura vera non ancora vista.** Le due che ho lanciato io da riga di comando non valgono: lo script non ha l'ambiente del servizio (prima senza `ENCRYPTION_KEY`, poi «DA-Link acceso ma non avviato»), quindi SSH e WinRM non potevano leggere; i 3 SNMP letti sono passati dal ripiego `public`. Gli esiti del job #29 mostrano 16 «errore» **falsi** finché non gira dal server: alle 06:30 del 12/11, o prima con «Esegui ora» dalla pagina dei job. Nessun danno: 0 credenziali con errori o blocchi, 21 ancora validate.
- [ ] Lezione: un job che legge apparati non si prova con `npx tsx` sull'hub — non ha né la chiave né il vault del servizio. Si lancia dal server.
- [ ] Visto di passaggio sull'hub: 8 apparati **vecchi** con tipo `switch` e protocollo `winrm` — lo stesso difetto «un PC nasce switch» corretto il 10/11 solo per la creazione automatica; la finestra «Rendi apparato» lo fa ancora (`resolveDeviceTypeForCreate`).
- [ ] Hub «degradato» l'11/11: `arp_poll` (job 26, ogni 30 minuti) fermo dalle 08:20 UTC, in ritardo di 195 minuti alle 12:05 UTC; causa non accertata.
- [ ] Piattaforma proposta da rivedere su quattro apparati dell'hub: `DA-765` e `192.168.16.26` (NAS, «windows / windows_client» via ssh), `DA-SYN-VM` (NAS, «linux_client»), `DA-RT-VPN` (router, «linux_client»). Viene da `proponiApparato`, la stessa della finestra «Rendi apparato».
- [ ] PBS `192.168.99.13`: classe «server» con confidenza 60, sotto la soglia di 80, quindi non diventa apparato (Riccardo, 10/11: «No, lascialo»).
- [ ] 13 host accesi senza categoria sull'hub: tre switch Ubiquiti (`192.168.40.237/238/239`, solo ssh), APC `192.168.15.130`, QNAP `192.168.15.140`, otto senza indizi. Servono SNMP o credenziali, non regole.
- [ ] **Raccordo con la sessione «02 - da-IPAM review e miglioramenti»** (Riccardo, 10/11: «sto aggiungendo con un altro agente molte informazioni passive sui device, molto affidabili»). Perché quelle informazioni decidano categoria, produttore e sistema operativo devono entrare come **evidenze** del motore, non come colonne lette a parte: una fonte in `attribution/types.ts` + peso in `weights.ts`, emessa da `emitters.ts` (o `recordEvidence` dal punto di raccolta, come `annunci.ts`). Conto da fare prima: una fonte vince da sola solo se `peso × confidenza ≥ 0.56`; se è dichiarativa va in `AUTHORITATIVE_SOURCES` con confidenza ≥ 0.9. Con fonti passive affidabili vanno rimisurati i 65 host senza categoria e la soglia 80 degli apparati automatici.
- [ ] D. Ritirare i classificatori vecchi dal codice (`device-classifier.ts`, regole di fingerprint, `auto-classify.ts`): oggi sono solo fonti di evidenze deboli; una tabella sola produttore/prodotto.
- [ ] E. Subnet e Discovery: riepilogo per macro categoria con conteggi e «da confermare», conferma in blocco. Interfaccia: da proporre oggetto per oggetto prima di scriverla.
- [ ] Mai visti a schermo: la voce «Apparati creati da soli» in Opzioni, le classi cambiate, gli apparati nuovi. Cancello completo mai eseguito sulle versioni del 10/11: va fatto una volta prima di `main`.
- [ ] Trappola: dopo un push il processo vecchio resta in memoria finché l'aggiornamento non riavvia, e un suo giro di scansione ritira le evidenze che solo il codice nuovo emette. Il ricalcolo va lanciato dopo `ultimo_successo` in `data/aggiornamento.json`.

## 2026-11-10 — «Solo controlli» sembrava non fare nulla (Riccardo, base)

Riccardo: «la sonda delle scansioni interne non fa praticamente nulla, ha restituito in pochi secondi il controllo su 1000 porte»; poi «controlla la logica che usa Nety per riprodurla meglio anche nella UI». Misurato sull'hub: rete 4, 90 servizi noti su 37 host di 102, giro di ~25 s; il profilo era ignorato.
- [x] Come Nety (`ScanLauncherPage.tsx`): profilo solo per Discovery; riquadro «Solo controlli» (non cerca porte, timeout, concorrenza). Prove `lancia-giro.test.ts` e `giro.test.ts` verdi, tsc ed eslint puliti. **Non guardata a schermo.**
- [x] Cronologia scritta a giro finito con l'esito (`alTermine` in `servizi-rete/giro.ts`).
- [x] Riccardo (10/11): «riproporre l'interfaccia di scansione equivalente tra Nety e DA-IPAM, senza interazioni che portano informazioni sbagliate». `/scans` riordinata come `ScanLauncherPage.tsx`: parametri sempre visibili (sola lettura fuori da «Su misura»), fasi e prove invasive nel riquadro, via le caselle spente delle tecniche da auditor. tsc ed eslint puliti. **Layout non guardato a schermo.**
- [x] Riccardo (10/11): «tutti i rilievi devono finire nel profilo degli oggetti delle subnet e della discovery». `RilieviHost` (`/api/rilievi?host_id=`) nella tab «Rilievi» della scheda e nel cassetto. **Non guardato a schermo.**
- [ ] Rilievi: manca il conteggio sulla riga di Subnet e Discovery (oggi si vede aprendo il cassetto); le CVE aggregate su più host hanno `host_id` vuoto e nel cassetto non compaiono (restano nella tab Vulnerabilità).
- [ ] Differenze rimaste con Nety: fasi separate riconoscimento / identità / controlli (noi «Sonde e identità» è una sola); tecniche di segmentazione oltre a diretta e ICMP; VLAN attive nella Sonda L2.
- [ ] Riccardo (10/11): «ho il dubbio che i rilievi siano molto minori rispetto a Nety sulle macchine». Misura sull'hub 70791 (10/11): 384 host, 235 con servizi noti, 149 senza (nessun rilievo possibile); 1052 servizi, controlli con esito su 203. Sospetto: SNMP 161 su 58 host ma `snmp_public` solo su 3, e solo 4 controlli UDP con esito su 83 servizi UDP. La prova vera è il confronto a parità con Nety sulla stessa rete (voce «Tappa motore» del 09/11).
- [x] Confronto a parità con Nety sulla rete 192.168.99 (10/11, DB di Nety LXC 106 sul PX-NAS copiato in sola lettura; DA-IPAM VM 963 «79993-ipam-2», 0.9.1095). Totale: DA-IPAM 103 rilievi (69 dei giri + 34 del trunk), Nety 89. Per famiglia Nety / noi: SSH password 22/21 · autofirmato 21/16 · SSH algoritmi deboli 18/7 · Telnet 6/6 · TLS cifrari deboli 6/0 · TLS protocolli vecchi 6/0 · SNMP community 5/5 · firma SMB 2/1 · chiave TLS debole 2/0 · certificato scaduto 1/0. Solo noi: pannelli web 9, RDP in chiaro, RPC 135, WinRM, IPP, trunk 34.
  - [x] TLS: prova attiva scritta a mano (`rilievi/tls-attivo.ts`), perché OpenSSL di Node non ha più 3DES/RC4. Dal vivo su 192.168.99.84:443 e :631: TLS 1.0/1.1 e RC4-MD5, come Nety. Prove `tls-attivo.test.ts` verdi.
  - [x] SSH: aggiunti `umac-64` e `umac-64-etm` ai MAC deboli.
  - [ ] Il dubbio SNMP dell'hub è chiuso: sei apparati provati con `snmpget -c public` dall'hub non rispondono, il controllo non sbaglia.
  - [ ] Restano: RDP 3389 (la prova TLS vuole prima X.224: Nety la fa, noi no); 192.168.99.22:445 e 192.168.102.196:443 da noi sono «silenzio» mentre Nety li legge (timeout della sonda? da misurare); la prova TLS riporta solo il primo cifrario debole scelto, Nety li elenca tutti; chiave/firma del certificato deboli su 192.168.102.x.
  - [ ] Dopo l'aggiornamento della 963 rilanciare «Solo controlli» su 192.168.99.0/24 e ricontare.
- [x] Riccardo (10/11): «se ci sono credenziali registrate in DA-IPAM puoi usarle», poi precisato: «solo se validate (per evitare brute force su apparati diversi), solo con la logica che già fa il discovery della subnet, che testa le credenziali in modo delicato e poi le memorizza come corrette per il device». **Regola**: i controlli del giro possono usare una credenziale solo se è in `host_credentials` con `validated = 1` per QUEL host e quel protocollo; mai una credenziale del registro provata su un apparato dove non è già stata validata; nessun tentativo nuovo dal giro (la validazione resta alla Discovery, con backoff e limite dei logon rifiutati). Sull'hub 70791 oggi: SSH validato su 43 host, SNMP su 28, WinRM su 23.
  - [x] Tappa 1 (SSH e SNMP, sì di Riccardo): `rilievi/autenticati.ts`, passo «credenziali» in `servizi-rete/giro.ts`, casella in `/scans` (accesa di serie, spenta nei giri automatici). Prove `autenticati.test.ts` verdi; il comando provato su una Debian vera (l'hub, via il mio ssh): uscita letta, nessun rilievo. **Non ancora girato dal lanciatore con una credenziale del registro, né guardato a schermo.**
  - [ ] Limiti noti: le voci SSH a chiave non si usano (il ponte prende utente e password); solo apt per gli aggiornamenti (niente dnf/zypper); un rifiuto della credenziale validata si conta ma non aggiorna lo stato della riga in `host_credentials`.
- [x] Riccardo (10/11): «se manca la password il rilievo è critico non solo high, anche se funziona una password easy o di default». 13 rilievi portati a Critical in `rilievi/controlli.ts` (prove aggiornate). Restano Medium, da confermare con lui: LDAP bind anonimo e sessione SMB nulla/Guest (accesso senza password ma spesso senza dati leggibili).
- [x] Riccardo (10/11): «la scansione interna non mi pare utilizzi le selezioni, se imposto 1000 porte TCP usa solo quelle già registrate». Misura sull'hub: la Discovery Standard delle 17:59 sulla rete 3 ha trovato porte fuori dall'elenco veloce (6666, 7443, 2000, 1935, 8008, 3261…), quindi le 1000 porte le usa; ma scandisce solo gli host che rispondono (45 su 254) e con `--host-timeout` 10 s. Da capire con lui quale lancio ha visto («Solo controlli» prima della 0.9.1090 mostrava il profilo e lo ignorava).
  - [x] Riccardo: «Discovery Standard». Rifatto a mano dall'hub lo stesso nmap sui 45 host online della rete 3, 1000 porte: con 10 s di limite 172 porte aperte e nessun host saltato, con 60 s 171. La Discovery ne aveva trovate 175. Il limite per host non taglia niente: le 1000 porte vengono usate.
  - [x] Difetto vero trovato: l'avanzamento diceva «Nmap quick TCP» anche con le 1000 porte del profilo. Ora dice «Nmap TCP, 1.000 porte» (0.9.1100). Non guardato a schermo.
  - [ ] Resta: gli host che non rispondono (209 indirizzi su 254 nella rete 3) non ricevono nessuna prova di porta. Se Riccardo ha un host o una porta precisa che si aspettava e non c'è, partire da lì.
  - [ ] Tappa 2: Windows via WinRM (SMBv1, firma SMB, LLMNR, patch, amministratori locali), passando dalla scelta WinRM/WMI della scansione.
- [x] Riccardo (10/11): `/servizi-rete` «probabilmente dovremmo ridisegnarla con la logica dei findings». Proposta in sei oggetti su tavola, approvata («Sì, tutti e sei»), scritta: testata su una riga con «Stesso apparato» a pulsante; fascia «Dove guardare» con quattro segnali e servizi per rete; «Raggruppa per» Servizio/Porta/Prodotto/Host/Rete; filtri a pulsanti col conteggio e CIDR; tabella dei gruppi che si apre sui servizi; rilievi e triage sotto la porta. `servizi-rete/viste.ts` (puro), `elenco.ts`, `rilievi/del-servizio.ts`. Prove `viste.test.ts` + rilievi 33 verdi, `tsc`, lint. Guardata a 1920 sull'hub con la 0.9.1102 (elenco, per porta, gruppo aperto coi rilievi): nessun errore, nessuno scorrimento orizzontale; corretto dopo che l'UDP contava come «da sondare».
  - [ ] Non fatto: ordinamento per colonna nei gruppi; «Prendi in carico» sul gruppo; collegamento dalla riga alla pagina Findings; gli indirizzi `?vista=` come in Findings. Gruppi e indicatori si calcolano in memoria su tutti i servizi del tenant (tetto 20.000, sull'hub sono 1.085).
- [ ] Da Nety, non fatto: le fasi di «Solo controlli» accendibili una per una (riconoscimento / identità / controlli). Il nostro giro le fa sempre tutte: serve un filtro nel motore.
- [x] (vedi sotto, corretto in `auto-update.sh`) Un giro in corso si perde al riavvio dell'aggiornamento automatico da `dev` (oggi tre riavvii in 40 minuti), senza riga in cronologia.
- [x] Riccardo (10/11): «confronta lo stesso host tra Nety e DA-IPAM … i dati sono diversi … non necessariamente una è giusta, ma i dati dovrebbero essere coerenti». Host 192.168.4.1 (DA-DC01), Nety dell'ufficio (LXC 111 su DA-PX-04, DB copiato in sola lettura) contro l'hub 70791:
  - Nety: 4 porte TCP (53, 139, 443, 5985) senza riconoscimento («port-table») + 3 UDP con dati (53 DNS, 123 NTP, 137 NetBIOS: nome, dominio DOMARC, controller di dominio, MAC). Nessun finding.
  - DA-IPAM: 11 porte TCP (anche 88, 135, 389, 445, 636, 3389, 10050), 443 con certificato e HTTP, versione Windows da NTLM, 4 rilievi (LDAP anonimo e senza firma, AD CS, TLS vecchio e 3DES). Nessuna delle tre UDP.
  - **Perché diversi**: il giro di Nety su 192.168.4.0/24 era «custom» con 27 porte, `retries: 0`, 1400 ms: ha perso 135/389/445/636/3389 che pure erano nel suo elenco. Le UDP vengono da un altro suo giro (rete «LAN Base», Standard, rimasto in pausa). DA-IPAM su quella rete non ha mai fatto una Discovery dal lanciatore con l'UDP. Due fotografie con impostazioni diverse, non due motori in disaccordo.
  - 636 «tace» è giusto: provato con openssl dall'hub, il DC chiude senza certificato.
- [x] Sonde UDP di protocollo (DNS 53, NTP 123, NetBIOS 137, SQL Browser 1434) in `servizi-rete/sonde-udp.ts`, dentro il giro. Provate dal vivo dall'hub: 192.168.4.1 → «DOMARC\\DA-DC01 · controller di dominio · MAC 00:50:56:a5:4b:ab», NTP strato 2, DNS con ricorsione; 192.168.4.4 → «DOMARC\\DA-SEVEN» e SQL Browser «istanza MSSQLSERVER · versione 14.0.1000.169». Stessi dati di Nety. Prove `sonde-udp.test.ts` verdi.
- [x] Secondo host confrontato su schermata di Riccardo, 192.168.4.4 (DA-SEVEN): a noi mancavano 137/udp, 1434/udp, il certificato sulla 3389 e la 47001; a Nety manca la 10050. Aggiunti certificato RDP (`suTls` in `rdp-ntlm.ts`) e 47001 fra le porte di gestione. **Il certificato RDP non è provato dal vivo.**
- [x] Verifica sull'hub dopo l'aggiornamento (10/11 sera, 0.9.1106): righe UDP scritte dal giro (137: 30 host, 53: 13, 123: 6, 1434: 2), TLS vecchio su 16 servizi. Certificato RDP: 0 su 23, quindi difetto. Causa: `protocolloRdpDaConferma` cercava «02 00 08 00» ma i Windows moderni mandano flags 0x1f; il server risultava «RDP in chiaro» (rilievo High falso) e senza TLS. Corretto leggendo il NEG_RSP alla sua posizione; dal vivo dal Mac: 192.168.4.4 e 192.168.4.1 danno TLS 1.2, NLA e CN del certificato. Prova con la risposta vera in `ntlm-spnego.test.ts`.
- [x] Guardato a schermo sull'hub (10/11 sera, Chrome di Riccardo, 0.9.1106): `/scans` col nuovo ordine e il riquadro «Fuori dal giro» (LAN Base 12 impianti, LAN Server 1); tab «Rilievi» di da-wazuh con 5 rilievi (certificato scaduto, CVE, aggiornamenti di sicurezza e root via SSH «con la credenziale già validata», cifrari deboli).
- [x] «Solo controlli» lanciato dal lanciatore su LAN Server con la casella delle credenziali: 56 s, cronologia «290 servizi già noti risondati su 59 host, 186 rispondono · 220 controlli · 7 host letti con credenziali, 1 credenziali rifiutate». Rifiutata sull'host #12; SNMP in chiaro segnato su 3 apparati. **Fra i 7 letti c'è 192.168.4.42 (VM critica)**: un solo comando di sola lettura con la credenziale già validata, niente modificato; da dire a Riccardo.
- [x] Storico di `/scans`: era pieno delle righe per host del controllo ogni 15 minuti (200 su 200), i giri non si vedevano. Ora `solo_giri=1`: una riga per rete, senza `fast`. La rotta `/api/scans/history` non chiedeva l'accesso: aggiunto `requireAuth`.
- [ ] Il primo lancio è stato rifiutato in silenzio perché girava il giro automatico del riavvio: il messaggio «già in corso» passa in un toast e si perde. Da rendere visibile vicino al pulsante.
- [ ] La tab «Rilievi» impiega qualche secondo: `/api/rilievi?host_id=` carica tutte le fonti (85.000 CVE) prima di filtrare per host.
- [ ] RDP: la CHALLENGE NTLM via CredSSP resta vuota su Server 2019 (nome e dominio `null`): da guardare.
- [ ] Il giro UDP interroga solo gli host che hanno già un servizio noto; chi ha solo UDP resta fuori.
- [ ] Confronto pulito ancora da fare: stesso profilo Standard (1000 TCP + 20 UDP) sulla stessa rete da tutti e due, poi contare.
- [x] Riccardo (10/11): «vorrei abilitare per le scansioni interne la stessa cautela che ho per le scansioni dell'edge, poter escludere i device iot ot plc usando un filtro simile». Misura: Discovery e giro usavano già `eImpianto` (stesso filtro dell'Edge) su nmap, SNMP, TCP, sonde, controlli e credenziali; mancavano gli esclusi a mano della proposta (`va_proposte.stato = 'escluso'`) e il dirlo a schermo. Fatto: `leggiEsclusi` rispettato da `discovery.ts` e `servizi-rete/giro.ts`, riquadro «Fuori dal giro» in `/scans` (`/api/scans/cautela`). Prove mirate verdi (128). **Non guardato a schermo; l'esclusione a mano non è provata con un giro vero.**
- [x] Riccardo (10/11), è un «forse»: sui device senza autorizzazione (impianti, esclusi) «possiamo testare le porte ma non fare tentativi di alcun tipo per non bloccare nulla». Oggi su quelli resta solo il ping. Non fatto: tocca il freno nato dall'incidente dei PLC al 72729, lo decide lui (quali porte, a che ritmo). **Deciso da Riccardo il 10/11: «Lascia solo il ping». Non riaprire senza che lo chieda lui.**
- [ ] Riccardo (10/11) ha chiesto se le porte Oracle/MySQL/Postgres vengono verificate. Risposta data: nmap le trova e ne legge la versione; il login di fabbrica si prova solo con «Prove invasive» su MySQL, Postgres e MSSQL (mai Oracle), al massimo 6 tentativi per host. Trappola da valutare: la sonda apre e chiude la 3306 senza completare l'handshake a ogni giro, e MySQL conta quelle connessioni (`max_connect_errors`, 100 di serie) fino a bloccare l'IP dell'appliance.

## 2026-11-10 — URGENTE: i due DC non rispondono più all'hub (dalle 20:15 circa, ora italiana)

- [ ] **Stato**: dalla VM 533 (`192.168.4.8`) i domain controller `192.168.4.1` e `192.168.4.2` non rispondono a niente (ping, 53, 445, 5985), mentre gateway, Internet e gli altri host della LAN sì, e dal MacBook i DC rispondono. I DC sono i DNS dell'hub: senza di loro l'hub non risolve i nomi, quindi `scripts/update.sh` non scarica da GitHub (tappa 2 degli annunci ferma su `dev`, hub alla 0.9.1108), e si fermano lettura degli eventi dei DC, sincronia AD e accessi WinRM con Kerberos. DA-IPAM resta attivo.
- [ ] **Quando**: ultimo evento letto dal DC01 alle 19:14:33 UTC; alle 19:17:13 UTC la risoluzione dei nomi già falliva. Alle 19:14:25 UTC DA-IPAM è stato riavviato da un rilascio (0.9.1108), alle 19:10 UTC era stata aggiornata la sonda alla 0.8.291.
- [ ] **Cosa si vede sui DC**: nel registro di sicurezza, dall'indirizzo dell'hub, 196 accessi non riusciti (4625, account «Guest» e vuoto, categoria `self_probe`) dalle 09:32 UTC: sono le prove SMB anonime del giro «Servizi di rete», che riparte **a ogni avvio di DA-IPAM** oltre che ogni 6 ore. Oggi DA-IPAM è stato riavviato molte volte (una decina di rilasci solo di questa sessione).
- [ ] **Ipotesi, non accertata**: una protezione sui DC (risposta attiva di Wazuh, regola del firewall di Windows, EDR) ha bloccato l'indirizzo dell'hub dopo troppi accessi falliti. Dall'hub non si può verificare: va guardato sui DC o in Wazuh. Non è stato tentato nessun rimedio.
- [x] Il giro «Servizi di rete» non riparte più a ogni riavvio: all'avvio parte solo se l'ultimo giro (segno `servizi_rete.ultimo_giro_automatico`, o l'ultima sonda vista) ha più di 6 ore; il giro ogni 6 ore resta. `src/lib/servizi-rete/job.ts`, prova `giro-all-avvio.test.ts`.
- [x] 20:30 circa: `192.168.4.2` è tornato a rispondere all'hub (Riccardo ha scritto «192.168.4.2»), i nomi si risolvono di nuovo. Nessun DNS di riserva aggiunto. `192.168.4.1` in quel momento non rispondeva ancora.
- [x] **Causa vera trovata** (10/11, 20:45): non era il riavvio. La prova SMB anonima e «Guest» (`src/lib/rilievi/smb-controlli.ts`) la lancia solo il giro «Servizi di rete», e il giro riparte **dopo ogni Discovery** (`avviaSondeDopoDiscovery`), cioè di continuo: alle 19:31 UTC, a giro all'avvio già saltato, sul DC02 sono comparsi altri due accessi rifiutati e il DC02 ha smesso di rispondere, mentre il DC01 tornava. Il blocco è per DC e a tempo. **Freno**: la prova SMB si fa una volta ogni 7 giorni per host (`SMB_ANONIMO_OGNI_GIORNI`, segno `_smb_provato_il` in `controllo_json`); i login di fabbrica chiesti a mano passano. Prova `freno-smb.test.ts`.
- [x] Freno visto in azione sull'hub (10/11, 21:00 circa): 9 host hanno il segno `_smb_provato_il`, i due DC rispondono entrambi all'hub.
- [ ] Riccardo, 10/11: «forse XDR installato» sui DC. Se è l'XDR, le prove senza credenziali di DA-IPAM e della sonda verso i DC vanno o tolte o fatte autorizzare (indirizzo dell'hub fra le eccezioni dell'XDR): da decidere.
- [ ] Resta: capire sui DC cosa ha bloccato l'hub; valutare se la prova SMB anonima va esclusa sui DC; l'hub dipende dai soli DC per i nomi (il gateway `192.168.4.254` risponde e conosce anche i nomi interni).
- [x] Riccardo (10/11): «quando abilito più network nella scansione interna solo una viene eseguita». Misura sull'hub: partono tutte (19:16, reti 1-5 concluse in 2-6 minuti con le righe in cronologia; 19:38, quattro reti insieme). Il difetto è a schermo: `apri()` del pannello tiene un solo giro e mostrava l'ultimo. Con più giri non si apre; «Giri in corso» elenca tutti, anche appena finiti. tsc ed eslint puliti. **Non guardato a schermo.**
  - [x] **Causa vera, trovata dopo**: le quattro Discovery delle 19:38:59 sono morte alle 19:44:55 col riavvio dell'aggiornamento automatico (0.9.1113, push di più sessioni nella stessa ora). Nessuna riga in cronologia. Corretto: `scripts/auto-update.sh` rimanda se `/api/health` dice `giri_in_corso > 0` (tetto 3 ore, «Aggiorna ora» non aspetta). `bash -n` pulito, tsc pulito. **Non provato dal vivo**: va visto un tick con un giro in corso.
  - [ ] Trappola: il freno vale dal primo aggiornamento DOPO che questa versione è installata (lo script che gira è quello vecchio finché non si aggiorna).
- [x] Riccardo (10/11): «non ritengo possibile che la rete Domarc abbia questi numeri di vulnerabilità» (Dashboard, LAN Server 28.760). Misura sull'hub: sono CVE×host di Wazuh, 69.990 righe valide su 40 agenti; su LAN Server 31.731 su 21 host, che sono **196 pacchetti**. Un kernel `linux-image-*` porta ~2.000 CVE, una build di Windows 2.300-3.600, Chrome 3.265 su 4 PC. L'Edge su LAN Server ne dà 500 su 53 host. `getRilieviPerRete` ora conta pacchetto×host (Wazuh) e controllo×host (Edge); le CVE in `cve`. Provato sui dati veri: LAN Server 701 (102 critiche), Lan Management 842, LAN Client 179, LAN DMZ 99.
  - [x] Barre della pagina Findings (`barrePerRete` in `rilievi/gruppi.ts`): Riccardo le ha riviste a 26.808 («ancora completamente fuori senso», «risolvi»). Ora una tacca per software×host (`nomeSoftware`, i kernel si piegano su «Kernel Linux») o per rilievo×host. Provato sull'hub con le righe vere: LAN Server 460 (67 critiche), Lan Management 426, LAN Base 193, LAN Client 115, LAN DMZ 85, LAN Storage 29, LAN INTER DMZ 5.
  - [x] Riccardo (11/11): «aggiusta anche la dashboard, i dati devono essere coerenti tra le schermate». Un conto solo: `barreReteDiSerie()` in `rilievi/barre-di-serie.ts`, usato da Dashboard, `/api/vulnerabilities/per-rete` e (con gli stessi filtri di serie) dalla pagina Findings; `getRilieviPerRete` tolta da `db-tenant.ts`. Tessere «Critiche/Alte da sistemare» = somma delle barre. Sull'hub: 774 ms, 121 critiche e 379 alte, LAN Server 455. **Non guardato a schermo.**
  - [ ] Resta per CVE solo l'elenco sotto le barre in Findings (una riga per CVE). Trappola: chi aggiunge un'altra vista «per rete» passa da `barreReteDiSerie`, non da una query nuova.
  - [ ] Da verificare con lui: 2.372 CVE su una build di Windows 10 ferma a ottobre 2025 sono quelle che Wazuh dichiara aperte; non ho controllato se Wazuh le gonfia.
  - Nota: per provare la query ho aperto il DB del tenant con uno script a parte, e l'apertura ha rifatto il ricalcolo dei gruppi multihomed che il servizio fa a ogni avvio (20 gruppi, 93 collegamenti).
- [x] Riccardo (10/11): «prima dell'aggiornamento le attività dovrebbero essere messe in pausa e riprese al riavvio, non so se è possibile». Oggi (0.9.1116) l'aggiornamento aspetta che i giri finiscano, fino a 3 ore. Pausa e ripresa vere non ci sono: i giri vivono in memoria. Fattibile in due gradi: (1) scrivere su disco i giri lanciati a mano con le loro opzioni e **rilanciarli da capo** al riavvio; (2) ripresa dal punto in cui erano, che per la Discovery vuol dire salvare gli host già fatti (è il «Completo che riprende» di Nety). Da proporre.
  - [x] Grado 1 fatto (sì di Riccardo): `scanner/giri-da-rilanciare.ts` (salva in `tenant_settings`, chiave `scans.giri_da_rilanciare`, toglie a fine giro) e `scanner/rilancia-giri.ts` chiamato da `server.ts` 90 s dopo l'avvio. Freni: una volta sola, entro due ore, senza `prove_fabbrica`; solo Discovery e Solo controlli. Prove `giri-da-rilanciare.test.ts` verdi. **Non provato dal vivo**: serve un riavvio con un giro in corso.
  - [ ] Grado 2 (ripresa dal punto) non fatto.

## 2026-11-10 — Revisione d'uso dell'hub: correzioni piccole e proposte (Riccardo: «Sì, le piccole»)

Giro di 20 pagine dell'hub (0.9.1082) a 1920, in sola lettura. Fatto su `dev`, prove mirate + `tsc`; **non visto a schermo dopo la modifica**.

- [x] Accesso: dall'indirizzo IP il pulsante «account Domarc» non compare e la pagina dice perché (il cookie di DA-Auth vale solo sotto `domarc.it`: da `https://192.168.4.8` Riccardo veniva rimesso sul login senza motivo); ogni rifiuto lascia una riga `[Auth]` nel registro.
- [x] Menu: «Software» una volta sola (resta sotto Network). Nomi in chiaro per `wazuh_alerts_sync`, `meshcentral_sync`, `mdm_sync`.
- [x] Anomalie: quelle aperte da più di 30 giorni si chiudono da sole al giro di `anomaly_check` (restano fra i «Gestiti», autore «automatico»). Sull'hub c'erano 25 MAC flip di giugno.
- [x] Subnet, reti da confermare: quelle con indirizzi pubblici sono marcate e vanno in fondo.
- [x] Zabbix: «Mostra tutti» i problemi (fino a 500) invece di «altri N non mostrati».
- [x] Cosa esce: l'esito accanto all'ultima scansione è detto per quello che è (di quella sola scansione).
- [-] «Una sola definizione di offline»: annullato, la Dashboard è già coerente (47 offline recenti + 142 assenti = 189 delle Subnet); l'unico numero fuorviante era quello di «Cosa esce», corretto sopra.
- [x] Dati vecchi in Patch Management: sotto «Ultimo probe» compare «▲ dato di N giorni fa» oltre i 30 giorni (prove dei moduli verdi, `tsc`; non visto a schermo).
- [x] Moduli «Da verificare» senza spiegazione: ora la riga dice «Acceso, ma nessun controllo dice se funziona: apri la sua pagina». Lo stato resta «Da verificare» (scelta del 19/10: mai «ok» senza prova).
- [-] Scheda host: «Ultimo aggiornamento 182 g fa» non è un dato vecchio, è l'ultimo hotfix installato sull'host: non toccato. La larghezza a 1920 è un ridisegno: si propone prima oggetto per oggetto.
- [-] Inventario NIS2 a più righe: c'è già (selezione e modifica in blocco in `/inventory`): la proposta era sbagliata, il difetto è che i campi sono vuoti, non che manchi lo strumento.
- [ ] Decisioni di Riccardo: accendere le notifiche sull'hub (Opzioni › Notifiche: «Salute dell'appliance» e «Allarme sui job fermi» oggi non avvisano nessuno); due passaggi per i Super Admin (Impostazioni › Utenti › «Richiedi»).
- [x] Findings a gruppi (Riccardo: «Sì, scrivila»): in Findings › Elenco c'è «Raggruppa per: Rilievo · Cosa aggiornare» e il collegamento «Per host». Un gruppo = un software (dal pacchetto di Wazuh, senza versione) con rilievi, gravità, host della CVE più diffusa, sfruttate attivamente/exploit pubblico, rivisti; «Prendi in carico» mette «In corso» sulle sole CVE ancora da rivedere (triage per CVE invariato). Edge senza pacchetto e trunk/giri stanno in due gruppi in fondo. `src/lib/rilievi/gruppi.ts`, prove verdi, `tsc`, lint. Scelte prese senza risposta di Riccardo: la vista che si apre resta «Rilievo»; niente «Ignora tutto il gruppo».
- [x] Findings, intestazione (Riccardo, 10/11: «occupa metà schermo»): testata su una riga, via pannello Revisione e le quattro tessere, filtri e avanzamento su una riga. Vista a 1920 sull'hub: l'elenco parte a ~230 px invece che a metà pagina.
- [x] Findings, pagina unica (Riccardo, 10/11: «le voci Vulnerabilità e Findings dovrebbero dire la stessa cosa con motori diversi e raggruppati in tutti i migliori modi», «anche con qualche KPI come per le reti nella Dashboard», «sì a tutto»). Fatto: via le due schede; fascia «Dove guardare» richiudibile con quattro indicatori cliccabili e le barre per rete della Dashboard (clic = filtro); «Raggruppa per: Rilievo · Cosa aggiornare · Host · Rete» con le stesse colonne; filtri comuni (gravità, exploit, stato, rete, host, ricerca); `?vista=host|software|rete` apre il raggruppamento. Host distinti veri per gruppo (`host_ids` in `getAggregatedVulnerabilities`), kernel Linux in un gruppo, nomi di test di Edge fuori dai software. `src/lib/rilievi/gruppi.ts`, prove verdi, `tsc`, lint.
- [x] Findings, pagina unica, portato dalla tabella di prima (Riccardo, 10/11: «procedi»): colonna EPSS, filtro per sistema operativo, «Anche le scansioni precedenti», ordinamento per colonna (elenco: lato server; gruppi: in memoria), stato e «Aggiorna ora» dell'archivio degli exploit (`stato-feed-exploit.tsx`), «CVE potenziali» sotto l'elenco. Tolti «Tabella completa» e `vulnerabilities-list-client.tsx`. Prove verdi, `tsc`, lint.
- [ ] Findings, lasciato fuori di proposito dalla tabella di prima: i sotto-filtri di fonte Edge-G / Edge-N / Edge-C (resta il motore Edge intero) e «solo con CVE». Le rotte `/api/vulnerabilities` e `/api/vulnerabilities/per-host` non hanno più una pagina che le chiama: da togliere se nessun altro le usa.
- [x] Findings, gravità attribuita male (Riccardo, 10/11: «è realistico che quasi tutti i rilievi della sonda Edge siano critici? C'è un errore di attribuzione», «alcune mi sembrano davvero non critiche»). Misurato sull'hub, tre cause, tutte corrette: (1) l'elenco leggeva solo le prime 2.000 CVE per gravità: di Edge restavano 47 su 290 (42 critiche) e di Wazuh 1.970 su oltre 17.000 — ora le legge tutte; (2) con un motore solo scelto, una CVE prendeva gravità e host dell'altro motore — ora le righe di quel motore si rileggono da sole (`soloMotore`), e nei gruppi per host/rete e nelle barre vale la gravità che il rilievo ha su quell'host; (3) gli avvisi di pacchetto di Greenbone («Ubuntu: Security Advisory») danno a ogni CVE il punteggio più alto dell'avviso — ora vale il punteggio proprio della CVE dall'archivio NVD locale, solo al ribasso (`cvssDi`). Con un filtro per host o rete «Dove» mostra quell'host. Prova `src/lib/vuln/__tests__/gravita-per-motore.test.ts`.
- [x] Findings: bassi, informativi e vecchi mai (Riccardo, 10/11: «i rilievi low, info e vecchi non consideriamoli mai», «esiste un oggetto, ma non è stato scansionato recentemente: anche se ha dei rilievi deve essere escluso»). Nei Findings entrano solo critici, alti e medi di scansioni degli ultimi 30 giorni (`RILIEVO_RECENTE_GIORNI` in `src/lib/rilievi/unione.ts`): per Edge conta la data della scansione, per Wazuh l'ultimo contatto dell'agente, per i giri l'ultimo passaggio, per il trunk l'ultima vista. Tolti il filtro «Bassa» e «Anche le scansioni precedenti». La prova «filtro gravità» di `unione.test.ts` è stata aggiornata: prima si aspettava di trovare dei bassi.
- [ ] Annunci di vicinato sul sensore trunk (Riccardo, 10/11: «LLDP/CDP/MNDP e varianti»; poi «Sì, il piano»): piano scritto, in attesa del sì e di due risposte → `docs/superpowers/plans/2026-11-10-annunci-vicinato-trunk.md`. In breve: dal trunk oggi arriva solo CDP; MNDP e la scoperta Ubiquiti sono in broadcast e il sensore li riceve già, manca chi li interpreta (sonda, DA-Vul-can `infra/scanner-edge/app/scanner_edge/sensore/pacchetti.py`); in DA-IPAM vanno accolti, portati sugli host e in Mappa porte, e MNDP va letto da tutti i MikroTik (oggi da uno).
- [ ] Da confermare con Riccardo: «recentemente» = 30 giorni è una mia scelta (misura sull'hub del 10/11: Edge 180 host entro 30 giorni, 24 fra 31 e 90, 33 oltre; Wazuh 36 agenti entro 30, 2 oltre). E la regola vale solo nei Findings: Dashboard, barre «Rilievi per rete» della Dashboard, scheda host e Patch Management usano ancora la regola dei 90 giorni e contano i bassi.
- [ ] Controlli TLS della sonda (Edge-C) ancora critici/alti (Riccardo, 10/11: «Sì, guardali»). Misurato sull'hub: 29 critici e 61 alti senza CVSS. Causa: la gravità è quella di testssl, tarata per servizi pubblici; l'abbassamento per la LAN deciso il 02/11 copre solo 5 voci (`gravita` in DA-Vul-can `infra/scanner-edge/app/scanner_edge/modules/tls_deep/spiegazioni.json`, specchio `GRAVITA` in `src/lib/vuln/rilievi-controlli.ts`), e lo specchio di DA-IPAM cerca i nomi tecnici mentre la sonda nuova scrive i titoli in italiano. Proposta in attesa del sì di Riccardo (è una regola di dominio): certificato scaduto → Media (oggi Critica dalla sonda, Alta nei giri di DA-IPAM, Media per `cert_expirationStatus`: tre valori per la stessa cosa); cifrari senza autenticazione e chiave corta → Alta; le righe per singolo cifrario → Log (lo dice già la riga riassuntiva); senza SAN, validità troppo lunga, uso della chiave → Bassa; rinegoziazione → Media; le righe coi nomi tecnici di 192.168.15.213 (scansione fallita, «connection failed rather than downgrading») → Log. Si applica in due posti: DA-IPAM (subito, anche sulle righe già salvate) e la sonda (stessa tabella, esce col prossimo rilascio).
- [ ] Findings, da decidere con Riccardo: le fonti non concordano sul punteggio della stessa CVE (CVE-2025-53014: Greenbone e NVD 9,8, Wazuh/Ubuntu 3,7). In «Tutti» la riga prende il più alto. Strade: lasciare il più alto; preferire il punteggio del fornitore (Ubuntu) quando c'è; mostrare i punteggi di tutte le fonti nel dettaglio.
- [ ] La scheda dell'host (`/api/hosts/[id]/vulnerabilities`) non usa ancora la correzione degli avvisi di pacchetto: lì le stesse CVE restano col punteggio dell'avviso.
- [x] Findings, la fascia segue i filtri (Riccardo, 10/11: «il grafico in alto non si aggiorna in base alle opzioni dei filtri»): indicatori e barre per rete si calcolano sugli stessi rilievi dell'elenco (`barrePerRete` in `gruppi.ts`, non più `/api/vulnerabilities/per-rete`). Le barre seguono tutto tranne il filtro per rete, così si può passare a un'altra rete; contano una tacca per host toccato.
- [ ] Findings a gruppi, da rivedere con Riccardo: la colonna «Host» è il massimo per CVE, non gli host distinti del gruppo (servirebbe una query nuova); gli exploit ci sono solo se l'archivio degli exploit è leggibile.
- [ ] Probe di Patch Management pianificato: oggi non esiste un job. Attenzione prima di farlo: ogni probe è un logon WinRM su ogni host Windows (limite dei logon rifiutati, vedi CONTEXT «Accesso Windows»). Nasce spento, serve un piano.
- [ ] Da guardare, non è un difetto dell'app: 987 accessi falliti al dominio in 24 ore e 18 account bloccati (10/11, picco 13-16).

## 2026-11-10 — AD Health, confronto con PingCastle

Riccardo: valutare cosa aggiungere al modulo. Verifica del codice di `origin/dev` `0cf74c06`: 58 regole registrate. Analisi statica.
- [x] Piano di implementazione in `docs/superpowers/plans/2026-11-10-ad-health-evidenze-e-percorsi.md`.
- [x] Riccardo (10/11): confrontati ad-doctor e ADcheck. Esiti, vincoli e prova offline nel piano.
- [x] Riccardo (10/11): scritte nel piano le lacune rispetto ad ad-doctor e ADcheck, nove blocchi (A-I) con l'ordine proposto. Nessun blocco è approvato come tappa: lo decide Riccardo uno per uno.
- [x] Riccardo (10/11): avviato lo sviluppo. Corretto il riscontro Windows LAPS con metadati di scadenza, senza acquisire password. Dato mancante ignoto.
- [x] Riccardo (10/11): proseguita l'implementazione. Evidenze ACL LAPS e AD CS, regola diagnostica ESC4 e SID Enroll osservati. Suite AD Health con 139 test passati, TypeScript ed ESLint verdi.
- [x] Riccardo (10/11, «procedi»): blocchi A e B delle lacune scritti sul ramo `claude/ad-health-lacune-ab`, fuso in `dev` il 10/11 insieme al lavoro di Codex (`codex/ipam-findings-verifica`) (10 regole, 2 diagnostiche, raccolta LDAP di sola presenza), 11 prove verdi. Dettaglio e non fatto nel piano. Da fare: fondere il ramo con `codex/ipam-findings-verifica` e provarlo su un dominio vero quando torna un trasporto cifrato.
- [x] Riccardo (10/11, «procedi a correggere tutto e procedere»): blocchi D, F e G delle lacune (`rules/lacune-dfg.ts`, raccolta `infra-extras.ts`), 12 regole di cui un indizio; prove AD verdi. **Non provato su un dominio vero**: i formati di `dNSProperty`, `dSHeuristics` e `msDFSR-Flags` vengono dalla documentazione Microsoft. Fuori: Global Query Block List e `wpad`/`isatap`, SMBv1, TLS 1.0, età del backup, diritti di replica di `MSOL_`, BadSuccessor dalle ACL delle OU; blocchi C (SYSVOL via SMB), E (AD CS), H, I (WinRM, area di Codex).
- [x] Riccardo (10/11, «puoi procedere con i test di AD»): AD Health lanciato sul dominio Domarc dall'hub IPAM (0.9.1088, esecuzione 13, 1 min 37, sola lettura). Raccolta nuova senza errori (`ldapCollectErrors` vuoto): 13 zone DNS lette tutte con modo degli aggiornamenti e ACL, `dSHeuristics` vuoto, SYSVOL su DFSR, nessun RODC, nessun dMSA. Rilievi veri delle regole nuove: aggiornamenti DNS non sicuri su 2 zone inverse, 2 privilegiati sincronizzati con Entra, Schema ed Enterprise Admins popolati, `userPassword` presente su 1 account. Dalla 0.9.1086 la copertura sta in `stats_json` (`infra`, `ldapCollectErrors`). **Restano senza un caso vero**: RODC, dMSA, FRS, record jolly, delega larga di una zona, `dSHeuristics` valorizzato, chiave Seamless SSO (qui non scattano perché il dominio non li ha): servono in laboratorio. Trasporto ancora LDAP 389 senza cifratura, come la sincronizzazione di ogni giorno.
- [x] Riccardo (10/11, «ricostruire la dashboard del AD health per ospitare tutto in modo leggibile»): Health AD rifatta sui mattoni di STILE-UI (0.9.1093): barra di stato, 4 numeri, sezioni Rilievi / Privilegi / Permessi / Copertura. Guardate sull'hub a 1920 tutte e quattro le sezioni; tema scuro non guardato. Corretti dopo: attore senza nome mostrato col SID intero, sottotitolo e scheda senza «findings». Aperti: «da verificare» è dedotto dai 0 punti perché `diagnostic` non si salva in `ad_health_findings`; i tre assi a 100 non distinguono un dominio dall'altro.
- [ ] Mostrare chi può leggere o decrittare le password LAPS, con ACL verificabili.
- [x] AD CS legge il contesto Configuration e incrocia le pubblicazioni per CN. I candidati ESC1/ESC2 senza prova di Enroll restano diagnostici.
- [ ] Risolvere i diritti Enroll effettivi e aggiungere ESC4 ed ESC8.
- [x] Suite AD Health locale, 136 test passati. Nessun dominio contattato.
- [x] Riccardo (10/11): indicato IPAM Domarc per il dominio reale. Verificata la baseline AD Health in sola lettura. StartTLS dalla VM IPAM ha risposto LDAP 52 e LDAPS 636 ha chiuso la connessione prima dell’handshake. Ripristinare un trasporto cifrato prima del collaudo con credenziali.
- [ ] Valutare percorsi di controllo verso i privilegi di dominio attraverso gruppi, ACL e GPO. Mostrare la catena di evidenze e distinguere il dato non verificato.
- [ ] Confrontare due raccolte con copertura compatibile e mostrare rilievi nuovi, risolti e non verificabili.

## 2026-11-10 — Raggiungibilità ICMP e appliance da rigenerare

Riccardo (10/11): tecniche di raggiungibilità a me (UI/orchestrazione), evasione a Cursor. `icmp_echo` fatto end-to-end: UI (`/scans`, dev 0.9.1081) → `protocollo` fino alla sonda; edge in DA-Vul-can (PR #145, release 0.8.290 in produzione, sonda 40 `79993-ipam-2` aggiornata e verificata). Tecnico sul Mac aggiornato a 0.9.1081.

- [x] Catena `protocollo` (direct|icmp_echo) UI→lancia-giro→giro→sensore-trunk→sonda; edge `prova_icmp`.
- [ ] **Rigenerare l'appliance DA-IPAM completa alla nuova release** (Deploy-Appliance) — Riccardo 10/11.
- [ ] **Doppia NIC nella VM DA-IPAM da generare** (Riccardo 10/11): la raggiungibilità/segmentazione gira **solo su Linux con NIC trunk dedicata** (`raggiungibilita.esegui` rifiuta `modo == "condivisa"` e macOS). Quindi l'appliance che deve fare segmentazione da sé vuole: 1 NIC gestione + 1 NIC trunk dedicata.
- [ ] Collaudo ICMP end-to-end: va fatto su una **sonda Linux** (es. 79993), non sul tecnico macOS (il socket locale rifiuta la raggiungibilità su macOS). Verificare che `chiediRaggiungibilita` ripieghi sull'edge quando il socket locale non la fa.
- [ ] Cursor: non toccare più `lancia-giro.ts`, `giro.ts`, `sensore-trunk.ts` (linea dividente concordata).

## 2026-11-10 — Seconda verifica Findings e giri

Riccardo: approfondire la verifica e correggere i difetti confermati. Base origin/dev 0.9.1069.

- [x] Confrontare il brief con i rilasci e ricostruire i percorsi di scansione e lettura.
- [x] Corretto perimetro delle reti, freno OT, budget per IP, associazione TCP/UDP, parser e contatori per motore.
- [x] Verifica mirata su SQLite isolato, parser e server locali finti. Nessuna prova su apparati o browser.
- [x] Accodate le sonde di Discovery quando un giro è già in corso, con rete e levetta originali. Coda in memoria e una sola esecuzione per richiesta equivalente in attesa.
- [x] VNC e NFS aggiornano il rilievo precedente solo con una risposta completa e interpretabile. Prove mirate su coda e sonde, 35 passate.
- [x] Riccardo (10/11): «vai in dev». Build di produzione verde. Snapshot `pre-findings-dev-20261110` sulla VM 533 di DA-PX-03 prima della pubblicazione.
- [ ] Collaudare in laboratorio su apparati reali. DNS prova la sola zona inversa /24 e UDP dipende dalle porte note. Per le sonde ancora binarie restano da distinguere esito negativo, timeout e controllo saltato. Le soglie delle fonti restano e sono segnalate in Findings.


## 2026-11-09 — Riusare l'interfaccia di Nety in DA-IPAM: cosa si può e come (Riccardo, analisi)

Riccardo (09/11): «puoi verificare come riutilizzare parti della UI di NETY in da-ipam». Letto `web/` di Nety (`77ef0dd`, ~17.000 righe TSX).

**Il codice non si copia.** Nety è GPL-3.0 (anche `web/`, nessuna licenza a parte). DA-IPAM va sulle appliance dei clienti: un componente copiato renderebbe DA-IPAM opera derivata, da distribuire col sorgente sotto GPL. Si riprendono idee, disposizione e flussi (non coperti dal diritto d'autore), riscritti coi mattoni di `console.tsx`, come per «Servizi di rete».

**Non c'è neanche una libreria da prendere in prestito.** Nety usa solo React 18, react-router, react-query, clsx, Tailwind 3; tabelle, grafici, triage e finestre sono scritti a mano. DA-IPAM è Next.js 16 / React 19 / Tailwind 4 / base-ui con componenti server: un componente di Nety andrebbe comunque rifatto (rotte, dati, tema scuro non Domarc).

| Vista di Nety | Dove in DA-IPAM | Mattoni che ci sono già | Lavoro |
|---|---|---|---|
| Services con riga espandibile | `/servizi-rete` | — | fatto |
| Piccoli mattoni: tempo relativo («1 ora fa»), copia accanto a IP e impronte, filtro «IP o CIDR», ricerca con «/» | `console.tsx`, poi Servizi di rete e Discovery | `IntestazionePagina`, `Pannello` | basso |
| **Triage** per riga (da fare · in corso · fatto · saltato) con nota «cosa hai provato, cosa hai trovato», selezione multipla, barra «N di M rivisti» | Servizi di rete e Vulnerabilità | `BarraDivisa`, `Etichetta` | medio (tabella stato+nota per tenant) |
| Findings: riga espandibile con prova, rimedio, stato; filtro per gravità a pulsanti con conteggio; «Espandi tutto» | `/vulnerabilities` (Per vulnerabilità) | `Pannello`, `Legenda` | medio |
| Gravità col segno a tacche (1–4 barre) oltre al colore | badge di gravità di tutto DA-IPAM | `STILE_STATO` | basso, utile per daltonici |
| Overview: «rilievi per rete» a barre impilate, «rilievi più gravi», giri recenti con avanzamento | testata di Vulnerabilità o cruscotto | `TesseraNumero`, `BarraDivisa`, `InCorso` | basso-medio |
| Confronto fra due giri (aggiunti, tolti, cambiati, spostati per host, servizi, rilievi) | «Cosa è cambiato» nella subnet (già proposto sopra) | `scan_history` | medio |
| Lanciatore dei giri: tipo a schede, profilo a schede (Rapido, Standard, Completo, Lento, Su misura), parametri derivati | pagina Scansioni / profili | `VoceSelezionabile` | medio |
| Risultati dal vivo via WebSocket | oggi lettura ogni 3 s (`servizi-rete`) | — | alto, bassa priorità |
| Matrice di segmentazione | `/segmentazione` | `TesseraNumero`, tabella, `BadgeEsito` | fatto il codice; collaudo trunk 102/103 sulla 963 aperto |

- [x] Findings + lanciatore (10/11, livello leggero): elenco unico su `/vulnerabilities` (titolo Findings, visibile anche senza Edge) da CVE + trunk + TLS delle sonde; `/scans` lancia i 4 tipi e i 5 profili sui motori già fatti. Completo chiede conferma e non è nei giri automatici. Scansioni VA restano al loro posto.
- [x] La vista precedente (per CVE / per host, exploit, triage) è di nuovo in pagina, scheda «Vulnerabilità» (`#vulnerabilita`; `?vista=host` apre quella)
- [x] Prima lettura Hosts/Assets di Nety, senza pagine nuove: OS da NTLM/SNMP/SSH su `os_info` vuoto; cassetto sulla riga in Discovery e Subnet (servizi, chiavi, dominio). Inventario «Asset» non si tocca.
- [x] Controlli ondata 1 in Findings (10/11): SMB signing, RDP NLA, SSH vecchio, LDAP anonimo, Redis/Mongo, NFS, SNMP public, VNC, console web; login di fabbrica solo con levetta su `/scans` (max 3/host, mai automatici).
- [x] Controlli ondata 2 (10/11): SMBv1 + null/guest/share sempre; SSH deboli, Telnet, WinRM, WSUS; Memcached/ZK/ES/Docker/etcd/CouchDB/Kubelet/X11/.git/.env/actuator; MS17-010, IPMI, MySQL/MSSQL/Postgres dietro la stessa levetta (tetto 6). Probe SMB a parte, `smb2.ts` non autentica.
- [x] Ritocchi ondata 2 (10/11): IPMI cipher-zero vero, LOGIN7 MSSQL con LOGINACK, PeekNamedPipe MS17 TRANSACTION 0x25, `.git` anche su porte HTTP non standard. Prove su server finti; collaudo dal vivo su SQL Server / Win7 ancora da fare sull'hub.
- [x] Controlli ondata 3 (10/11): RDP Standard, SSH password, LDAP signing, NFS `*`, SNMP write (levetta), TLS cifrario/chiave deboli, DNS AXFR, TFTP, NTP monlist, rsync, Smart Install, r-services, RPC 135, IPP, AD CS, Jenkins script (levetta), SMTP VRFY, VNC tipo 2, IPMI RAKP (levetta).
- [x] CHECK `scan_history` (10/11): il lanciatore `/scans` scriveva `controlli`/`sonda_l2`/`segmentazione` e SQLite li rifiutava. Migrazione v6.
- [ ] Riccardo da scegliere da dove partire. Ordine consigliato: piccoli mattoni → triage → rilievi a riga espandibile con gravità a tacche → panoramica per rete → «Cosa è cambiato» → lanciatore

## 2026-11-09 — Servizi di rete e identità senza credenziali, sul modello di Nety (Riccardo, leggero)

Riccardo (09/11): «capire come implementare l'ottimo motore di rilevazione e alcune visualizzazioni»; «i dati acquisiti in questa pagina sono eccellenti» (Nety, Services); «imparare molto da come ottenere dati passivi senza credenziali all'avvio»; «la costruzione automatica delle network viste, con i dati specifici, gli host ben determinati senza fare scansioni esplicite». Approvato «Sì, procedi». Codice scritto da zero: Nety è GPL-3.0, se ne riprendono le idee.
- [x] Sonde Node senza credenziali sulle porte già aperte (banner, HTTP, TLS, SSH con KEXINIT) → tabella `servizi_rete` con metodo, prova, prima e ultima osservazione. Verifica: 7 prove dei parser verdi; dal vivo su 192.168.99.1-2 stessi dati di Nety (302 /login, CN appliance.local TLSv1.3 autofirmato, OpenSSH 10.0p2 con mlkem768x25519) in 1,6 s; query su copia con 395 host (317 servizi «ssh» trovati, secondo allineamento 0 righe nuove)
- [x] Vista «Servizi di rete» (Network): tabella filtrabile, riga che si apre su banner, HTTP, TLS e SSH. Tipi e lint verdi; **non guardata a schermo**
- [ ] Riccardo (09/11): «appena partito mi aspetto che molte cose si popolino senza scansioni» → è la tappa ascolto all'avvio, sotto
- [x] Riccardo (09/11): reti viste dal trunk «proposte da confermare», non create da sole → riquadro in Subnet con «Porta … in DA-IPAM». Prove `reti-proposte.test.ts` verdi; **non guardato a schermo**
- [x] Sonde dei servizi avviate da sole a fine discovery riuscita, con freno su porte di campo/stampa e produttori di campo (`freno.test.ts`)
- [x] Host confermati dal trunk senza porte → giro leggero di 47 porte comuni senza nmap (Riccardo: «Sì, alla conferma»). Prova `giro.test.ts` su tenant isolato verde
- [x] Riccardo (09/11): «il massimo automatismo» → giro automatico all'avvio (+3 min) e ogni 6 ore per cliente; spegnibile con `servizi_rete.automatico = 0`. Le reti restano proposte da confermare (decisione dello stesso giorno)
- [x] Riccardo (09/11): porte «molto più ampie dello standard» → top 1000 di nmap-services + porte di gestione (`porte.test.ts`; dal vivo stesse porte di Nety su 99.1 e 99.2 in < 0,5 s per host)
- [ ] Da valutare: tutte le 65.535 porte sulle reti confermate (sulla LAN ~20 s per host; i filtrati costano fino a 3 minuti)
- [x] Riccardo (09/11): «Nety ha anche una visualizzazione a matrice molto efficace» → pagina `/segmentazione` (Sicurezza): tessere, matrice rete × rete, clic sulla cella, vista servizio × rete sorgente. Misura da dentro ogni VLAN (sonda trunk). **Non guardata a schermo**
- [ ] Riccardo (09/11): «anche il sistema di scansione è multiplo e porta informazioni molto utili a livello di networking» (Nety su 192.168.15.178, `missions/1/scans/new` e `matrix`). Visto:
  - **quattro tipi di giro**: Discovery (host, porte, servizi, identità, controlli leggeri) · Segmentazione (dalla rete in cui si è collegati, riprova i servizi trovati nelle ALTRE reti e riempie la matrice) · Sonda L2 (ascolto CDP/LLDP/DTP/STP e tag 802.1Q, passiva) · Solo controlli (rifà riconoscimento e controlli su quanto già inventariato, senza scansione);
  - **«dove sei collegato»**: si sceglie la rete sorgente = un'interfaccia per VLAN (eth0 VLAN 1, eth1 VLAN 5, eth2 VLAN 4, eth4 VLAN 40). La matrice si misura mandando da ognuna;
  - **profili**: Rapido (top 100 TCP) · Standard (top 1000 TCP + top 20 UDP, riconoscimento, identità, controlli) · Completo (65.535 TCP + top 100 UDP, si mette in pausa e riprende) · Lento (connect a 300 pps per reti fragili o IPS) · Su misura; fasi accendibili una per una; credenziali di fabbrica solo a richiesta («intrusive»);
  - **matrice all'ufficio**: 1751 prove, 1632 raggiungibili attraverso un confine (93,2%), LAN Storage VLAN 16 mai provata come sorgente; celle «raggiunti / totale · chiusi · filtrati», seconda vista «servizio × rete sorgente».
  Per DA-IPAM: l'appliance ha già la porta trunk; servono sotto-interfacce per VLAN (o il tag nella sonda trunk) per mandare da ogni rete. Da proporre come tappa dopo identità
- [x] Riccardo (09/11): «Matrice di segmentazione» — codice scritto (sessione del 09/11 sera, handoff). Decisioni tenute: IP libero via ARP, uscita dal gateway della VLAN, max 40 per cella (prima i servizi di gestione), settimanale accesa (`23 3 * * 1`), livello completo sulla sonda.
  - [x] Sonda (DA-Vul-can): `POST /raggiungibilita` sul socket e `/api/v1/trunk/raggiungibilita` sull'edge; stesso lock del giro; esiti raggiunto / chiuso / filtrato / senza rotta. Prove `test_sensore_raggiungibilita.py` 4/4
  - [x] DA-IPAM: tabelle `segmentazione_*`, giro, pagina `/segmentazione`. Prove `bersagli.test.ts` verdi (tetto 40, gestione prima, giro finto)
  - [x] Collaudo: nic trunk dedicata `ens19` sulla 963 (snapshot `pre-nic-trunk-20261110`); matrice con esiti da VLAN 102. Riccardo: «ok funziona»
- [x] Interruttore `segmentazione.automatico` in Opzioni (acceso di serie, spegnibile per cliente; stessa levetta in Schedulazioni)

- [x] Interruttore `servizi_rete.automatico` in Opzioni (acceso di serie, spegnibile per cliente; stessa levetta in Schedulazioni)
- [x] Installata da sola (timer `dev`) sull'hub 192.168.4.8 e sulla sonda 963 «79993-ipam-2» (192.168.99.2), v0.9.1043; snapshot `pre-servizi-rete-20261109` su VM 533 (DA-PX-03) e VM 963 (PX-NAS), dischi controllati «thawed». Giro all'avvio partito da solo: hub 70791 1034 servizi / 949 sondati / 263 HTTP / 143 TLS / 97 SSH (giro della 1042); sonda 963 228 servizi / 196 sondati / 71 HTTP / 28 TLS / 24 SSH, 21 host senza porte provati e 11 con porte (1043)
- [ ] Guardare a schermo Servizi di rete e il riquadro in Subnet: la pagina dell'hub chiede l'accesso, da fare con Riccardo
- [x] Tappa identità senza credenziali: tabella `identita_prove` / `identita_proposte`, scheda «Stesso apparato» in Servizi di rete. Due IP con la stessa chiave SSH compaiono come proposta; conferma collega, rifiuto no; il ricalcolo non resuscita il rifiuto; un tenant non vede l'altro. Prove `identita.test.ts` verdi. **Non guardata a schermo**
- [x] NTLM (pezzo opzionale dell'identità): SMB 445, HTTP NTLM o solo Negotiate (SPNEGO), RDP 3389 (X.224+TLS+CredSSP). CHALLENGE senza autenticarsi. Due IP con lo stesso nome Windows diventano una proposta. WORKGROUP saltato. Prove `identita.test.ts`, `sonde.test.ts`, `ntlm-spnego.test.ts` verdi.
- [ ] Tappa ascolto all'avvio: CDP/LLDP/DTP/STP, VLAN etichettate, lease DHCP → reti proposte da sole; partire dalla sonda del trunk che c'è già
- [ ] Tappa motore: confronto a parità dalla 79993 con Nety (VM 192.168.99.83, da cancellare dopo), poi ARP per primo, naabu, `-sV` solo sulle porte aperte

## 2026-11-09 — Tipi stampante/UPS/VoIP/telecamera/IoT, marche firewall, vista UPS (Riccardo, completo)

Riccardo (09/11): tre richieste, zona gialla (ricostruzione di `network_devices`). Scelte: «Un tipo per ciascuno» per VoIP/telecamere/IoT; firewall «Marca + profilo prodotto»; tavola UPS «puoi approvarla, procedi senza mostrarla».
- [x] Tipi `stampante`, `ups`, `voip`, `telecamera`, `iot`: CHECK, unioni TS, validatore Zod, `suggestDeviceTypeFromProductProfile` e `resolveDeviceTypeForCreate`, conversione delle righe vecchie (`migra-device-type-v22.ts`, segno `device_type_v22`)
- [x] Ricostruzione di `network_devices` (`migraCheckNetworkDevices` in `migraCredenzialiWmi`, quindi anche il path legacy di `getDb`), sul modello di `migra-apple-macos.ts`: parte dalla definizione attuale (tiene `host_id`, `campi_da_rivedere`), indici/trigger/viste ricreati, conteggio e foreign_key_check; CREATE dello schema da `ddlNetworkDevices`, CREATE legacy di `db-schema.ts` allineata
- [x] Marche firewall: vendor, profili `*_firewall`, `PIATTAFORME`/`MARCHE_DI_RETE`, auto-classify (+ Palo Alto, Check Point, WatchGuard), inferenza da produttore e da stringa host, client ARP come Stormshield, scheda firewall, tendina e procedura guidata del gateway
- [x] Vista UPS: `ups-acquisition.ts` (UPS-MIB + APC PowerNet), `ups_inventory`, `scheda/ups.ts`, tipo scheda `ups` con tab «UPS»; corretti gli OID UPS sbagliati del profilo SNMP
- [x] Prove nuove viste fallire sul codice di prima (worktree di `origin/dev`): migrazione 5/5 rosse, v22 modulo assente, tipi/firewall 7 rosse, UPS modulo assente; sul codice nuovo 24 verdi
- [x] Quarta richiesta (Riccardo via sessione «VA per device», 09/11): lato tecnico creato alla classificazione. Forma scelta, senza interfaccia nuova: solo classi leggibili in SNMP (switch, router, firewall, access point, stampante/multifunzione/scanner, UPS) e solo con una credenziale SNMP già validata sull'host; passa da `creaApparato` come «Rendi apparato». `src/lib/devices/apparato-da-classificazione.ts`, chiamato da `PUT /api/hosts/[id]`, `hosts/bulk-update`, `devices/bulk` (host). Prova vista rossa sul codice di prima (modulo assente), 6 verdi
- [ ] Da decidere con Riccardo: senza credenziale SNMP validata si potrebbe proporre l'apparato con evidenza (es. un avviso nella scheda dell'host): tocca l'interfaccia, serve la tavola
- [x] Cancello intero (09/11): lint e tsc verdi, `npm test` 7.765 passate 0 fallite, build verde. Aggiornata una prova storica (`proposta-apparato.test.ts`, «marche fuori elenco»): fortinet e sonicwall ora sono marche ammesse
- [x] Collaudo su 79993-ipam-2 (09/11, sera): snapshot `pre-tipi-ups-20261109` della VM 963 sul PX-NAS, poi 0.9.1035 arrivata col timer `da-ipam-update` (segue `dev`). Log: «network_devices CHECK aggiornato (tipi e marche nuovi)» e «device_type_v22, corretti 0 apparati» (nessuna periferica era apparato). Prima/dopo sul DB: 14 apparati, binding 13, porte 70, MAC 151 uguali; foreign_key_check 0; CREATE nuova con `telecamera`, `sonicwall` e `host_id` conservata; 8 indici ricreati. `/api/health` ok, nessun errore dopo l'avvio
- [ ] Non collaudabile su 79993-ipam-2: lettura UPS dal vero (in quella rete non c'è un UPS) e creazione dell'apparato alla classificazione (l'unica stampante, `.84` HP, non ha una credenziale SNMP provata). Serve una rete con un UPS in SNMP, o provare la community sulla `.84`
- [ ] Non verificato: vista UPS guardata a schermo (layout nuovo, una schermata a 1920 dopo il collaudo)
- [ ] Più avanti: lettura SNMP dedicata (modello/seriale/versione) dei firewall nuovi; UPS Eaton con la sua MIB (oggi solo se espone la RFC 1628)

## 2026-11-09 — Estrazione device dal PC del tecnico (analisi)

- [x] Riccardo (09/11): prompt per il Claude Code dei tecnici che produce un JSON digeribile da DA-IPAM, collegandosi a switch e router via SSH, SNMP o API. Analisi di riferimento in `docs/revisione/2026-11-09-estrazione-device-tecnico.md`.
- [x] Riccardo (09/11): «mi basta un prompt da dare al claude code con le modalità con cui scrivere i json, poi verrà inserito nel pacchetto completo di da-ipam». Il prompt autosufficiente è in `docs/revisione/2026-11-09-prompt-tecnico-estrazione.md`: busta + snapshot 1.0, comandi vietati, credenziali solo da variabili d'ambiente, controllo in Python. Le domande D1-D11 dell'analisi non bloccano più.
- [x] Riccardo (09/11): «il sistema dovrà usare internet per capire come accedere ad un apparato, chiedere le credenziali, testare l'accesso e verificare come esportare i dati nel formato comune». Il prompt ora ha cinque fasi: ricerca della documentazione del vendor (nelle ricerche solo vendor, modello e firmware), credenziali chieste da uno script a input nascosto che il tecnico lancia nel suo terminale, una sola prova d'accesso, piano di lettura per sezione, controllo.
- [x] Riccardo (09/11): «il prompt dovrebbe essere visibile nella UI dell'installazione del tecnico». Pagina «Estrazione apparati» (`/estrazione-apparati`), solo con `DA_PROFILO=tecnico`. Il testo sta solo in `src/lib/estrazione/prompt-tecnico.md`, quindi il prompt è già nel pacchetto. Non verificato: la pagina vista a schermo, a 1920.
- [x] Riccardo (09/11): «servirebbe un prompt per inghiottire sia il json che inserire il collector centralizzato delle installazioni dei tecnici». Scelte sue: il prompt è per il Claude Code di sviluppo di DA-IPAM, e il tecnico consegna un pacchetto (script, campione anonimo, `atteso.json`, `LEGGIMI.md`). Prompt di sviluppo in `src/lib/estrazione/prompt-sviluppo.md`. Il prompt del tecnico ha il §4.1 e `controlla_campione.py`, provato su un campione pulito e su uno sporco.
- [x] Riccardo (09/11): «Sì, lanciala qui». Parte A fatta: `POST /api/devices/[id]/acquisizione/importa` (`src/lib/estrazione/busta.ts`, `importa.ts`), più le sezioni `routes` e `origine` nello snapshot. Prove: `busta.test.ts` sull'esempio del prompt; acquisition, mappa-porte e acquisizione-modulare verdi (487); lint e tsc verdi. Non provato: l'import su un DB vero con un apparato vero.
- [x] Riccardo (09/11): «Sì, scrivila». Pulsante «Importa estrazione» nel riquadro Acquisizione, con gli esiti 409 e 422 scritti nel riquadro e l'etichetta «collector del tecnico». Prove: acquisizione-modulare ed estrazione verdi (101); lint e tsc verdi. Non verificato: la schermata a 1920 e un import da interfaccia con un file vero.
- [ ] Parte B al primo pacchetto di consegna di un tecnico.
- [ ] Da sapere: con il prompt da solo, l'output dei comandi (IP, MAC, nomi del cliente) passa da Claude Code, che è un modello esterno. È in contrasto con la regola «dati di clienti solo su modelli interni» (analisi §6): Riccardo l'ha visto?

## 2026-11-08 — Sonda trunk: IP ufficiali e altri, VLAN nativa (Riccardo, leggero)

Riccardo (08/11): «troppi IP fuori da quelli ufficiali», sull'hub e su DTS. Approvato «Sì, come consigli».
- [x] Misura in sola lettura: DTS 73/1.002 ufficiali, hub 225/488; causa principale VID 0 = nativa ma rete dichiarata VLAN 1
- [x] `lib/trunk/appartenenza.ts` + 11 prove (il cancello ha preso un difetto: righe senza protocolli nascoste come «instradate»; ora restano della VLAN); rilievo «fuori rete» con la nativa (+1 prova in `rilievi.test.ts`)
- [x] Pagina: domanda sulla VLAN nativa, «ufficiali · altri» per VLAN, colonna e filtri; `/api/trunk/vlan-nativa`
- [x] Regola sui dati veri esportati: nativa dedotta VLAN 1 su tutti e due; DTS 672 ufficiali, 98 altra VLAN, 80 VLAN non in DA-IPAM, 74 169.254, 49 fuori rete, 20 instradati, 9 pubblici; hub 293/488
- [ ] Guardata a schermo
- [x] DTS: 172.17.16.0/20 «LAN PRODUZIONE» è la VLAN 10 (Riccardo, 09/11: «È la 10»): `networks.vlan_id` 16 → 10 sul DB di DTS, riga di prima in `/root/rete-172.17.16.0-20-prima-20261109.sql`. Ricalcolo sui dati veri: ufficiali 672 → 724, altra VLAN 98 → 31; la VLAN 16 (192.168.16.x) ora risulta «non in DA-IPAM».

## 2026-11-08 — Script che prepara il dominio: account, gruppi, WinRM (Riccardo, completo)

Riccardo (08/11): «aggiungere la parte per abilitare WinRM e creare un utente con i diritti corretti». Approvato «Sì, come consigli»: script separato, OU obbligatorie, IP di DA-IPAM, livello completo.
- [x] `scripts/Configura-Dominio-DA-IPAM.ps1`: due account, gruppi, GPO «DA-IPAM - WinRM» (registro + firewall + Gruppi con restrizioni in `GptTmpl.inf`). Verifica: `pwsh` parse ok; `scripts/prova-configura-dominio.ps1` 8 casi verdi (radice, OU dei DC anche scritta con gli spazi, DC, RODC, OU illeggibile = rifiuto, OU inesistente), rosso visto con la radice accettata per mutazione. Revisione indipendente: corretti controllo DC che falliva aperto e senza RODC, RA4 ripetuto per più IP, gruppo DHCP in italiano, scritture tutte sul PDC, collegamento solo a GPO completa e mai riacceso se disattivato, messaggio «Start-Service WinRM». Non verificabile senza dominio: `Set-GPRegistryValue` coi due IP, formato RA4 multiplo
- [x] Scarico `/api/ad-setup/script-dominio`, testi in `diritti.ts` (`SCRIPT_DOMINIO`, `comandoSblocca`), pannello nella pagina «Cosa serve»; riga `Unblock-File` anche nella guida dell'audit
- [ ] **Mai provato su un dominio vero**: la parte che scrive (New-ADUser, GPO, `GptTmpl.inf`, estensione Security) l'ha vista girare solo con comandi finti. Prossimo passo, da Riccardo su un DC: `-Prova` (non cambia niente), poi l'applicazione vera su un'OU di prova col suo sì; controllo su un PC dell'OU con `gpupdate /force`, `winrm enumerate winrm/config/listener`, `net localgroup Administrators`
- [ ] Guardare a schermo il pannello nuovo della pagina «Cosa serve»

## 2026-11-08 — Pagina della subnet: tasto destro e categoria a più host (Riccardo, leggero)

Riccardo (08/11): «assegnare le categorie agli oggetti in modo multiplo» dalla pagina della subnet, e il tasto destro «come in altre schermate». Proposta a schermo approvata («Sì, costruisci»).
- [x] Finestrella `components/networks/categoria-blocco-dialog.tsx` (riusa `PATCH /api/hosts/bulk-update`, scelta a mano; casella per lasciare stare chi è già a mano)
- [x] Tasto destro sulla lista: filtri sul valore della cella + azioni, `lib/networks/celle-subnet.ts` con 5 prove
- [ ] Guardata resa sull'hub coi dati veri
- Trappola: la colonna premuta si riconosce dalla posizione (`COLONNE_SUBNET`): chi aggiunge o sposta una colonna nella tabella cambia anche quell'elenco.

## 2026-11-08 — DTS (71734): scansioni spente e DC che non si risolvono (Riccardo)

- [ ] **Tre `fast_scan` spente** su 172.16.0.0/17, 172.17.0.0/22, 172.17.4.0/22: le ha spente la migrazione d'avvio (`applyTenantSchedulerDefaults`: rete ≥ /22 e intervallo < 720 min), che non le riaccende mai. La /17 è già a 720 ma resta spenta. Proposto: le due /22 a 720 e riaccendere tutte e tre. Aspetta il sì di Riccardo (sistema del cliente). Le `known_host_check` girano tutte, ogni 15 minuti.
  - [x] Riccardo, 12/11: «Sì, riaccendi». Job 3, 16, 4 su DTS: `enabled = 1`, tutti a 720 minuti, prime partenze sfalsate (12:07, 13:07, 14:07 ora italiana), poi riavvio di `da-ipam` con zero giri in corso. Dopo il riavvio restano accesi e lo scheduler carica 32 job. Prima erano: 3 = 720/spento, 16 e 4 = 60/spenti. La prima scansione non è ancora stata vista partire.
  - [ ] Resta il difetto nel codice: la regola non riaccende mai quando l'intervallo torna in regola.
- [ ] Mostrare a schermo perché un job è spento («spento dalla regola reti grandi»): oggi non si distingue da uno spento a mano.
- [x] **AD: «0/2 DC letti», `SRV-DC01/02.dts.local` non si risolvevano** — 08/11 21:46: su DTS `eth0` usava 1.1.1.1 e 8.8.8.8. DNS portati ai DC 172.16.1.11 e 172.16.1.12 (Riccardo) in `/etc/netplan/50-cloud-init.yaml`, copia `.bak-20261108-214625`, `netplan apply`. Verifica: `resolvectl` mostra i DC, i due nomi si risolvono, internet (github.com) anche.
- [x] Anche su Proxmox (Riccardo, «Sì, su Proxmox»): VM 116 «DTS-Inventory» su DTS-PX-UP (172.16.1.141), `qm set 116 --nameserver "172.16.1.11 172.16.1.12" --searchdomain dts.local` + `qm cloudinit update 116`; prima era `nameserver: 1.1.1.1 8.8.8.8`. Verifica: `qm cloudinit dump 116 network` dà i due DC e `dts.local`. Un riavvio non rimette più i DNS pubblici.

## 2026-11-08 — Menu: voci grigie senza i loro moduli, Sicurezza del dominio unita (Riccardo)

Viste sulla ridotta `79993-ipam-7`. Riccardo, 08/11: Vulnerabilità, Scansioni VA, Inventario e Applicativi grigie senza Edge e senza NIS2; Alert sicurezza grigia senza Wazuh; «Sicurezza del Dominio» e «Health Active Directory» unite su tutte le installazioni, senza perdere informazioni. Livello leggero.
- [x] Resa proposta oggetto per oggetto (testo spento + lucchetto + motivo); Riccardo: NIS2 «si spegne da Opzioni» (resta acceso di serie)
- [x] Prove viste fallire: `src/lib/modules/__tests__/voci-condizionate.test.ts`, `src/lib/menu/__tests__/sicurezza-dominio-unita.test.ts`
- [x] Menu (`shared/sidebar.tsx`), pagina unita a due schede, rimando da `/active-directory?tab=health`
- [x] Riccardo (09/11, «Sì, su main»): scelta per gruppo su `main`. Cancello completo sull'esatto `origin/dev` (lint, tsc, 7732 prove, build: verdi), fast-forward: `main` = `dev` = `484f772f` = 0.9.1033. 72729 alla 0.9.1033 alle 13:12; 70151 ancora 0.9.1032 a quell'ora (prende al suo giro)
- [x] Riccardo (09/11): «promuovi tutto in main», dopo aver chiesto perché 72729 (0.9.1022) non aveva Includi/Escludi e la selezione multipla. Cancello completo sull'esatto `origin/dev` (lint, tsc, 7726 prove, build: verdi), poi fast-forward: `main` = `dev` = `5138b27a` = 0.9.1032. Dentro: tutti inclusi di serie con scelta firmata, consenso agli impianti scelti e finestra «Per device», estensione a «Un profilo solo», piccoli del collaudo, e il lavoro di altre sessioni (subnet col tasto destro, sonda trunk e DA-IPAM sul Mac del tecnico, script del dominio). Effetto su 72729: l'elenco degli host che la sonda può toccare passa ai non esclusi (impianti fuori comunque); la sonda 72729 resta 0.8.263, quindi consenso con durate e finestra dicono «Sonda da aggiornare». Nessuno snapshot delle appliance dei clienti. Arrivato alle 11:13 UTC su 72729 e 70151 (`/api/version` 0.9.1032). Riccardo («mi serve che il sistema sia aggiornato», per una nuova sessione su 72729 senza danni a PLC né fogli stampati): sonda 72729 chiesta a 0.8.272 da DA-Link (oggetto 38, zero scansioni aperte prima), installata alle 11:15 UTC. Su 72729: rete 192.168.0.0/24 con 60 impianti (fuori), 6 «da chiarire» e 44 confermati fra cui 9 stampanti (Periferiche); rete 192.168.1.0/24 con 11 «da chiarire» fra cui la stampante .1.215. Con la regola nuova i «da chiarire» entrano di serie (Veloce): da rivedere prima del lancio
- [x] Riccardo (08/11): «Sì, promuovi». `main` = `dev` = `0349ea2f` = 0.9.1022 (fast-forward da `a7030de8`). **Supera la scelta «Fino alla 0.9.1014»** fatta in un'altra sessione lo stesso giorno: entrano anche le credenziali agganciate da sole alle reti (0.9.1015-1016, Windows compreso), la 0.9.1017-1021 e la 0.9.1022 (Passo 9, impianti in «Per device»). Riccardo, avvisato della contraddizione: «Lascia la 1022»
- [ ] Guardare il menu sulla `79993-ipam-7` dopo l'aggiornamento a 0.9.1022, e 70151 alla 0.9.1022 (`/api/health`)
- [x] Riccardo (08/11): «SI» a NIS2 spento di serie sulla ridotta (`src/lib/modules/nis2.ts`, prova `nis2-di-serie.test.ts` vista fallire). Segnale già presente: `/etc/da-appliance/versione.json` con `"variante": "snella"` (lo scrive Deploy-Appliance e lo rinnova a ogni aggiornamento), quindi Deploy-Appliance non cambia; una scelta in Opzioni vince sempre
- [-] Chiudere anche le pagine: no. Riccardo (08/11): «BASTA GRIGIO» — solo il menu

## 2026-11-08 — Discovery con i numeri veri e credenziali agganciate da sole alle reti (Riccardo)

- [x] Misura sull'hub (sola lettura): scanner già all'ultima scansione; numeri gonfiati da Wazuh e dal conteggio per righe. Da 70.637 righe a 51.925 CVE per host
- [x] Discovery conta CVE distinte per host, kernel superati fuori; prova `src/lib/vuln/__tests__/riepilogo-discovery.test.ts` vista fallire (10 righe contro 5 CVE)
- [x] Credenziali SSH/SNMP/API agganciate da sole a reti nuove e reti esistenti; prova `src/lib/credentials/__tests__/aggancio-reti.test.ts` vista fallire con la regola spenta
- [x] Riccardo (08/11): «Sì, anche Windows». Aggiunta a `TIPI_AUTOMATICI_SU_RETE` in 0.9.1016, col rischio detto (fino a 21 logon rifiutati per giro su 7 reti con una password che LDAP non sa verificare)
- [ ] Le credenziali già registrate e non agganciate restano come sono (sull'hub 8 voci su 13): l'aggancio vale da qui in avanti. Se Riccardo le vuole su tutte le reti, si fa dalla tabella della rete («copia da un'altra rete») o con un giro una tantum da decidere
- [ ] Wazuh dichiara per i Windows migliaia di CVE per sistema operativo (es. 1.703 su un Windows Server 2019 aggiornato): resta nei numeri della Discovery. Da valutare se mostrare Wazuh in una colonna a parte

## 2026-11-08 — Installer pulito su Debian e modalità tecnico multi-profilo (Riccardo, decisioni da piano)

Riccardo, 08/11: «proviamo a sviluppare l'installer pulito su debian e la possibilità di usare il sistema come tecnico memorizzando localmente più profili cliente, pensando alla modalità superadmin e multitenant». Risposte del 08/11:
- **Debian**: Debian 13 già installata, su qualsiasi ipervisore **e anche su mini PC fisico**. L'installer non tocca l'ipervisore.
- **Avvio**: con un comando da DA-Link, come per Proxmox (bozza, comando da incollare da root, file d'avvio, esiti e credenziali a DA-Link).
- **Modalità tecnico: «Sì, solo per il tecnico»**. È un'**eccezione voluta alla decisione del 12/10** («un'installazione = un cliente»), valida solo per un tipo di installazione «tecnico» (superadmin, un tenant per cliente, cambio profilo). Le installazioni dai clienti restano a un cliente. Va scritta in un ADR nuovo, senza riscrivere il 12/10.
- **Dati dei profili**: restano sul PC del tecnico (cifrati) **e** si mandano al centrale del loro `codcli`. L'invio dipende dalle tappe 2-3 del piano `2026-11-07-installazione-snella-e-collegamento.md`.
- [x] Piano da approvare (in chat 08/11): A = installer Debian (Deploy-Appliance + DA-Link), B = modalità tecnico (DA-IPAM, ADR) — Riccardo: «Sì, due sessioni»
- B (modalità tecnico), livello completo:
  - [x] Ricognizione misurata (08/11): il codice a tenant funziona e isola; un tenant nuovo non ha job fino al riavvio; superadmin con più tenant entra su `__ALL__` (409 ovunque); creazione e cambio di tenant **oggi sono già accesi per il superadmin su ogni installazione** (hub 533: 2 tenant). Numeri nel piano, «Misure».
  - [x] ADR 0037 (lo 0036 è delle CVE potenziali): tipo `tecnico` da `DA_PROFILO` (variabile del servizio, la stessa del profilo «centrale» del Task 7 del piano 07/11), disco cifrato LUKS invece di DB cifrato, invio al centrale solo previsto.
  - [x] Piano `docs/superpowers/plans/2026-11-08-installazione-tecnico.md` (7 task, uno bloccato dalle tappe 2-3 del 07/11)
  - [x] Piano approvato da Riccardo (08/11: «Sì, D1 com'è oggi»): creazione e cambio di tenant restano come oggi sulle installazioni non «tecnico»
  - [x] Task 1 — interruttore `DA_PROFILO` con prova di equivalenza (cancello verde)
  - [x] Proposta d'interfaccia (selettore e pagina dei profili) scritta nel piano, Task 5
  - [x] Riccardo approva la proposta d'interfaccia (08/11: «Sì, tutta»)
  - [x] Task 3-5 (profilo pronto senza riavvio, ingresso senza `DEFAULT`, selettore e pagina «Profili»), revisione fatta e difetti corretti, resa a 1280 vista (08/11)
  - [x] Task 2 freno della cifratura: misurato sulla VM 110 del PX-NAS (08/11), «cifrato» sul volume LUKS, «in chiaro» sul disco
  - [x] Task 6 in Deploy-Appliance: `da-appliance tecnico attiva|apri|chiudi|stato`, [Deploy-Appliance#80](https://github.com/grandir66/Deploy-Appliance/pull/80) unita su `main` l'08/11 (`1263c754`), misurato sulla VM 110 e poi VM riportata allo snapshot. Aperti lì: `azzera` col contenitore, scelta «tecnico» in DA-Link
  - [x] Tema scuro guardato: fascia navy invisibile sul fondo scuro, corretta (chiara col testo navy)
  - [x] Superadmin per creare i profili: `da-appliance tecnico attiva` promuove gli `admin` di DA-IPAM (il primo avvio crea un admin di un cliente solo); anche `da-appliance password` ora trova `hub.db` nel volume. [Deploy-Appliance#81](https://github.com/grandir66/Deploy-Appliance/pull/81) unita l'08/11, misurata sulla VM 110 (Riccardo: «Sì, fallo»)
  - [x] **Mac nativo** (Riccardo, 08/11: «Sì, parti dal Mac»): DA-IPAM tecnico in produzione su questo Mac, scoperta di 192.168.15.0/24 confrontata con l'hub (40 IP in comune su 41, 37 MAC uguali; i 3 diversi sono schede diverse degli stessi apparati; porte uguali sull'elenco rapido). Trovati e corretti: `normalizeMac` con la forma di macOS, selettore vuoto per chi entra senza profili. **Trappola macOS**: un processo lanciato da un'app senza il permesso «Rete locale» non apre connessioni TCP verso la LAN (nmap: 1 host con porte su 40; dallo stesso DA-IPAM lanciato dal terminale: 38) — per questo il servizio è di sistema (launchd, root). Aggiunto `DA_ASCOLTO`. Script: Deploy-Appliance `host/installa-tecnico-mac.sh`
  - [x] Installazione vera sul Mac di Riccardo (08/11, `--ramo dev --porta 3011`): servizio di sistema acceso, risponde solo su 127.0.0.1, FileVault riconosciuto, superadmin creato
  - [x] **Sonda trunk sul Mac** (Riccardo 08/11: «il trunk non funziona», «abilitata per default», «resettare e riabilitare ad ogni cambio cliente»; 09/11: «sembra funzionare»): provata sul Mac di Riccardo installata come servizio (`--aggiorna --porta 3011 --scheda en7 --sonda-da` col ramo di DA-Vul-can): sonda in ascolto su `en7` (BPF, da root), DA-IPAM 0.9.1030 l'ha azzerata alle 00:16 («azzerato: si ricomincia da capo») e alle 00:18 ha letto 12 VLAN e 120 osservazioni nel profilo 70791. Difetti dello script trovati e corretti strada facendo: `--aggiorna` tornava su main e sulla porta 3001 e non ricaricava il plist (Deploy-Appliance#84); `bootstrap` subito dopo `bootout` dava «5: Input/output error» (#85)
  - [ ] **Deploy di DA-Vul-can con la cattura su macOS** (grandir66/DA-Vul-can#143): senza, la sonda scaricata dal tarball dell'Edge non cattura sul Mac di un tecnico. Va anche agli Edge dei clienti: decisione di Riccardo
  - [x] Avviso «aggiornamento disponibile» sul Mac del tecnico (Riccardo 09/11: «Avviso aggiornamento»): resta l'avviso, sparisce «Installa», c'è `sudo da-ipam-tecnico --aggiorna` (comando installato dallo script). Applicare dall'interfaccia sul Mac (servizio launchd d'aggiornamento) resta un'idea, non fatta
  - [x] **Procedura in DA-Link** (Riccardo 09/11: «si può aggiungere la procedura a link?», «senza unirla ad un cliente ovviamente», «Sì, procedi»): pagina `/tecnico/mac` (dalla Guida) in produzione con DA-Link `2a3c7cf`; `mac/installa-tecnico-mac.sh` pubblicato e firmato nella 2026.11.92, impronta `2fdffd1e…` letta dalle due origini. Resta: la sonda del Mac cattura solo col deploy di DA-Vul-can#143
  - [x] **«PC del tecnico» in DA-Link, con due strade** (Riccardo 09/11; scelte: voce di menu, script Debian nativo): DA-Link `06bc123` in produzione (voce di menu → `/tecnico/pc`, Mac e Debian); Deploy-Appliance `host/installa-tecnico-debian.sh` (#89) pubblicato e firmato nella 2026.11.92. **Prova vera** su una Debian 13 pulita (VM 111 del PX-NAS, clone ZFS della 110, poi tolta): installazione completa da `--ramo dev`, superadmin creato, HTTPS 200, DA-IPAM «cartella dati su volume cifrato: /dev/mapper/da-ipam-tecnico (crypt → loop)», sonda in ascolto su `ens18`, `--chiudi`/`--apri` funzionano. Su `main` di DA-IPAM (0.9.1022) mancano ancora le correzioni di oggi: la promozione la decide Riccardo
  - [ ] Messaggio della pagina trunk senza sonda: dice «serve una seconda scheda di rete collegata alla porta trunk», che sul Mac (modo condivisa) non è vero
  - [ ] Installazione vera su un Mac con `sudo` (la lancia Riccardo: agli agenti niente password): verificare che il servizio di sistema veda la LAN e che nmap da root trovi le porte
  - [ ] Windows: per ora VM Debian; nativo da valutare (ping, arp e bash diversi)
  - [ ] **PC del tecnico (Riccardo, 08/11: «il tecnico non ha debian», «può avere osx o windows»)**: DA-IPAM gira solo su Linux, quindi sul PC va una VM Debian 13 con la scheda in bridge sulla rete del cliente (cavo consigliato: in Wi-Fi il bridge è limitato e niente VLAN). Windows e Mac Intel: VM x86 (VirtualBox, VMware Workstation/Fusion, Hyper-V), funziona già con Debian installata a mano + comando di DA-Link + `tecnico attiva`; più comodo un OVA della ridotta da importare (da costruire: oggi c'è solo l'OVA piena per VMware). Mac Apple Silicon: una VM x86 non gira; serve Debian arm64 (UTM, gratuito) e l'installatore Debian capace di arm64 (componenti oggi solo amd64). Da decidere con Riccardo quale strada prima
  - [ ] Prova completa: DA-IPAM col profilo `tecnico` su Debian col contenitore (serve il profilo su `main`, o DA-IPAM di `dev` sulla VM di prova)
- [x] **A — installer Debian** (Riccardo: «Sì, due sessioni»), 08/11: Deploy-Appliance PR #78 (`host/installa-debian.sh`: componenti firmati + preparazione della VM modello sulla Debian, IP in ifupdown, primo avvio di sempre) e DA-Link PR #87 («Dove si installa: Debian già installata», solo la ridotta). Cancelli verdi. Prova vera sul PX-NAS, VM 110 Debian 13 netinst: file d'avvio vero di DA-Link (bozza 34 `79993-ipam-6`), `da-appliance verifica` verde anche dopo un riavvio. Trovato e corretto: umask 077 fermava la sonda trunk
- [x] A, rilascio (Riccardo: «Sì, procedi», 08/11): #78 e #87 unite, `debian/installa-debian.sh` nella 2026.11.92 firmata, DA-Link in produzione al `f0d721e`. Prova dal comando per Debian di DA-Link: bozza 35 `79993-ipam-7` sulla VM 110 del PX-NAS, `da-appliance verifica` verde. Aperti: Riconfigura/Aggiorna per Debian; registrazione di prova `79993-ipam-6` tolta da DA-Link (08/11), ma il suo proxy `proxy-riccardo-grandi-6` resta in DA-Zabbix (1 host)

## 2026-11-08 — FDB del collector: misura su 70151 e proposta (Riccardo: «FDB del collector»)

Misura in sola lettura su 70151 (DB `DEFAULT`, via `qm guest exec 104` da PX01), ultimo snapshot non in errore contro `mac_port_entries` (fonte `device`, 24 ore):

- [x] **ProCurve (49) e MikroTik**: la FDB del collector vede gli stessi MAC del giro (MAC solo del collector: 0-2 per apparato; quelli solo del giro sono MAC invecchiati accumulati in 24 ore). Una proiezione FDB **non porta dati nuovi**: servirebbe solo a spegnere letture del giro storico.
- [x] **Comware (11-15): 0 porte con MAC in `switch_ports`**, mentre la tabella MAC ne ha 800-1.100 per apparato su 9-62 porte. Causa: nomi delle porte in due forme, lunga in `switch_ports` («GigabitEthernet1/0/8», «Bridge-Aggregation109») e corta da `display mac-address` («GE1/0/8», «BAGG109»); `normalizePortNameForMatch` (`utils.ts`) toglie solo spazi e maiuscole. In `mac_port_entries` lo stesso MAC sta sotto tutte e due le forme. Anche la FDB del collector ha i nomi corti e non trova l'`if_index` (`hp-comware.ts:77`, confronto per uguaglianza).
- [x] MikroTik CORE1-A/B e CORE2-A (16-18): snapshot con FDB in errore (già noto dal 07/11).
- [ ] **Proposta, aspetta Riccardo**: (1) una chiave di confronto dei nomi porta che conosca le forme Comware (`GigabitEthernet`↔`GE`, `Ten-GigabitEthernet`↔`XGE`, `FortyGigE`↔`FGE`, `HundredGigE`↔`HGE`, `Twenty-FiveGigE`↔`WGE`, `Bridge-Aggregation`↔`BAGG`, `Route-Aggregation`↔`RAGG`), usata da `normalizePortNameForMatch` e da `nomePorta` dei collector; prova con i nomi veri; misura `misura-cavi` prima/dopo perché la Topologia usa la stessa chiave. (2) La proiezione FDB vera e propria, solo se si vuole spegnere il giro storico sugli HP.
- [x] Riccardo (08/11): «Sì, solo la chiave». Correzione a quanto scritto sopra: il collector Comware usa già i nomi corti sia per le porte sia per la FDB (`comwarePort`), quindi lì l'abbinamento funzionava; il buco è solo fra `switch_ports` (nomi lunghi) e la tabella MAC (corti).
- [x] Chiave in `normalizePortNameForMatch` (e `nomePorta` dei collector), ancorata all'inizio e seguita da una cifra («ge-0/0/0» di Juniper e «Gi0/1» di Cisco non cambiano). `port_key` salvato in `topology_port_facts` invariato. Prova `chiave-porta-comware.test.ts`, vista rossa (1 fail su 3), poi verde.
- [x] Misura sulla VM 104 di 70151 (copia del DB e del codice in `/tmp`, poi tolte; script staccato con `nohup` perché l'agente QEMU va in timeout sulle chiamate lunghe): `misura-cavi --cavi --mappa-cavi` prima e dopo con impronta del modello `ad551b26…` e della mappa `93e4aecb…` identiche, 0 padri cambiati.
- [x] Cancello: lint 0 (0 errori), tsc 0, test 0 (7632, 0 rosse), build 0.
- [x] **`main` = `699e2c13` = 0.9.1007** (08/11, 14:11 italiane, avanti veloce verificato con `git ls-remote`), col sì di Riccardo («Sì, tutto dev») dopo avergli elencato i rilasci 1003-1006 delle altre sessioni. **Fuori la 0.9.1008** (`cfd9ff49`, Proxmox FDB solo dinamica, altra sessione): arrivata dopo il sì. Snapshot prima: `pre-main-0-9-1007-20261108` della VM 104 sul nodo PX01, disco «thawed».
- [x] 70151 aggiornata (08/11, 15:50 circa): `/api/health` sull'IP NetBird 100.107.145.24 ok, **0.9.1009** (un'altra sessione ha portato `main` alla 1009 alle 14:35, dentro anche la 1007), db ok, 0 ripieghi, scheduler ok. Il «non risponde» di prima era il ping bloccato e PX01 raggiungibile solo dall'altra VPN di Riccardo; root non accetta la chiave del Mac sull'IP NetBird.
- [x] **Comware con i MAC per porta su 70151** (08/11 sera, 0.9.1022, sola lettura via PX01 e `qm guest exec`): HP5900-Route 18 porte con MAC, HP5700-NET 62, -Core 22, -DR 12, -Storage 9 (stamattina 0 su tutti): gli stessi numeri delle porte viste dalla tabella MAC.
- [x] C5 su 70151: il giro del collector delle 18:00 UTC ha ancora fatto 1.332 cambi di duplex, ma tutti «half → full» su valori scritti dal giro SNMP **prima** dell'aggiornamento (la protezione conserva la riga com'è). Controprova su sw-p1-2530-101 (apparato 72), porte 45-48 spente: alle 20:17 UTC il giro SNMP (che lì legge «half») ha lasciato «full».
- [ ] Da guardare dopo l'01:00 italiana del 09/11: `select substr(created_at,12,2), sum(campo='duplex'), sum(campo='poe_power_mw') from acquisition_changes where destinazione='porte' and created_at>=date('now') group by 1` su 70151 deve dare quasi zero al giro delle 00 UTC.

## 2026-11-08 — recupero-dadude3-mknet: giro 7 su dev e C5 ridotto (leggero)

Riccardo (08/11): «Sì, in quest'ordine». Piano: `docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md` §8. Worktree `.worktrees/giro7`, ramo `claude/giro7-su-dev`.

- [x] Giro 7 riportato dal tag `archivio/collector-modulari-20261103` (5 commit): conflitti in TASKS (tenuto `dev`) e in Opzioni (import e prove: tenute entrambe, quella del vault resta (e), la riga dei collector diventa (f)).
- [x] Condizione di Riccardo del 22/10 (Proxmox sul pulsante solo alla parità) misurata sull'hub l'08/11: la scansione storica ha modello e seriale di 2 nodi su 5 (DA-PX-01, -02); ogni nodo è un apparato e il collector legge il DMI del nodo a cui si collega, quindi non legge meno. IP delle VM: stessa fonte (agent) per tutti e due.
- [x] Cancello del giro 7: lint 0 (0 errori), tsc 0, test 0 (7574, 0 rosse), build 0 (la prima build era rossa per `node_modules` collegato fuori dal worktree: Turbopack non lo segue; clonato con `cp -c`).
- [x] Misura C5 su 70151 (VM 104 di PX01, via `qm guest exec`: in ssh la VM rifiuta la chiave), sola lettura: interruttore assente (spento), `mappa_dati` accesa dal 07/11; 188 snapshot HP e MikroTik in un giorno e mezzo; in `acquisition_changes` 2.658 cambi di duplex e 3.174 di PoE l'08/11, sulla stessa porta sempre `vuoto > full`: il giro SNMP cancellava, il giro dei parser rimetteva.
- [x] C5: `campiDelCollectorApparato` protegge anche con `mappa_dati` accesa. Prova vista rossa (1 fail su 15), poi verde 15/15.
- [x] C5 punto 3, confronto delle colonne: il collector scrive 9 campi per porta (`CAMPI_PORTA`), non i MAC per porta (`mac_count`, `single_mac*`, host), che vengono solo dal giro SNMP. Il giro storico sugli HP **non si può spegnere** finché la tabella FDB del collector (`forwarding`) non ha una proiezione. Nessun interruttore nuovo.
- [ ] Da sapere, visto nella misura: su MK-CORE (apparato 4, porte ether1 e sfp28-2) SNMP dice vicino «MK-CORE-2-ARM-D», il collector «GAMOfas8080a-01» porta `e0k` (NetApp). Ora vince il collector (decisione a). Quale sia giusto si vede sul cablaggio: **da guardare con Riccardo**.
- [x] Rilascio: v0.9.1002 su `dev` (`ef8c760c`), sull'hub con la 0.9.1004 di altre sessioni (08/11, 13:37 italiane): `/api/health` ok, db ok, codice presente (`giri.ts`, riga in `opzioni/catalogo.ts`), `acquisizione_modulare.attiva=1`, `mappa_dati` accesa.
- [ ] **Da guardare da Riccardo sull'hub** (io non entro nelle pagine dell'hub con una password): Opzioni → riga «Acquisizione con i collector» accesa; Impostazioni → Sistema mostra il rimando; «Aggiorna» su DA-PX-03/04/05 con una credenziale SSH → modello e seriale del nodo.
- [ ] Su 70151 dopo il rilascio (arriva con `main`, non con `dev`): i cambi di duplex e PoE in `acquisition_changes` devono scendere a quasi zero.
- [ ] Prossimo: proiezione della tabella FDB del collector (MAC per porta), poi C5 vero per gli HP; oppure C6.

## 2026-11-07 — Mappa porte: tutti gli oggetti e router come switch (Riccardo, in proposta)

Riccardo: «trova un sistema per ottenere tutti i dati», router e firewall come gli switch per porte e VLAN, tutte le rotte, «non perdiamo dati». Misure e tappe in `docs/superpowers/plans/2026-11-07-mappa-porte-tutti-i-dati.md`. Non si parte senza il suo ok.

- [x] Ok al piano («Sì, procedi»); chiuso su `dev` 0.9.1001, consuntivo nel piano.
- [x] Dopo il sync delle 03:00 sull'hub (verifica 08/11 12:25, sola lettura sul DB): strato del controller scritto alle 03:00:03 (11 apparati, 211 porte); rotte UDM Beast 9, MK-RTR-CORE 25, SNS EVA2 32; PoE ancora presente dopo il giro delle 11:15 (SW-CED-48POE-242 48 porte, 10 erogano; SW-ING-ProMax-239 48, 23); UDM 14 porte. Calcolo della domenica: certe 93, spiegate 58, da capire 31, non so 91 (venerdì 115/73/33/106): meno apparati accesi, probabile ma non dimostrato. UDM sulla scheda nuova non vista a schermo.
- [x] **Su `main` col sì di Riccardo** (08/11, «Porta su main lo stesso»): fast-forward `git push origin 737ae0ed:refs/heads/main`, `origin/main` = `origin/dev` = `737ae0ed` = **0.9.1001**, verificato con `git ls-remote`. Dentro anche 0.9.993-0.9.997 (consenso impianti VA, storico MAC-IP).
- [x] 70151-ipam-2 (VM 104 di PX01, si entra con `qm guest exec 104` da `root@172.20.40.191`, che è PX01) riportata su `main` il 08/11: `main...origin/main` a `737ae0ed`, `da-ipam-update.timer` enabled e active, `/api/health` ok alla 0.9.1001. Snapshot `pre-mappa-dati-20261107` da togliere fra qualche giorno.
- [ ] **Buchi nella raccolta, censimento dell'08/11 sull'hub** (Riccardo: «sei stato in grado di ottenere tutti i dati disponibili?»; risposta: no). Sola lettura sul DB, apparato per apparato:
  - [ ] Il giro dei parser (`mappa-porte/giro-parser.ts`) prende solo `switch`, `router`, `firewall`, `access_point` **abilitati**. Restano fuori: i 5 Proxmox (SSH ok, collector `proxmox-ve` esistente, mai girato: niente bridge, FDB e ARP delle VM), SNS EVA2 (registrato `server`), UDM, i 6 switch UniFi solo da controller, i 4 AP e SW-UFLEX-RG-10GB (tutti `enabled=0`; 3 UFLEX e 4 AP hanno l'SNMP provato «success»).
  - [ ] Il collector `unifi-controller` non gira mai: la UDM ha 0 VLAN e 0 ARP, solo 14 porte e 9 rotte dal sync.
  - [ ] Stormshield: nessun collector. Il giro SSH dà 12 porte, 34 ARP, 32 rotte; niente VLAN, niente interfacce logiche.
  - [ ] `ubiquiti-device` via solo SNMP: `vlans`, `forwarding`, `neighbors`, `spanning_tree`, `aggregation`, `poe` saltati (servono SSH), `inventory` in errore su tutti e 6. Il giro SNMP copre MAC, 13 VLAN e vicini; STP e LAG di dettaglio no.
  - [ ] `mikrotik-routeros` su MK-RTR-CORE: `vlans`, `network`, `identity`, `inventory` parziali.
  - [ ] Dati sbagliati: 8 PC Windows registrati come `switch`; SW-UFLEX-RG-10GB con 54 porte vecchie che nessuno legge; da-invent con SSH fallito.
  - [ ] Da fare lo stesso censimento su 70151 (parser HP: 39 ok, 6 parziali, 2 errori; hypervisor probabilmente esclusi allo stesso modo).
  - **Piano approvato l'08/11** (Riccardo: «Sì, procedi», livello leggero). Misura che lo guida, sola lettura sul DB dell'hub: i Proxmox sono `hypervisor`/`proxmox`; il collector `proxmox-ve` (agganciato dal giro 7) non legge né FDB né ARP; UDM e apparati del controller nascono `enabled=0` per scelta del sync (`unifi-sync.ts`), si lasciano così e i loro dati vengono dal controller; MK-RTR-CORE: dei 4 «parziali» l'unico vero è `network` (ARP via SNMP in timeout), gli altri sono avvisi voluti.
  - Riccardo, durante il lavoro (08/11): «verifica anche come ottenere dati dagli switch, ad esempio di 192.168.99.2 [79993-ipam-2], che non rispondono a ssh ed snmp ma sono dentro al controller ubiquiti che ha le informazioni». Misura su 79993-ipam-2 (DB `DEFAULT.db`, ramo `dev`): apparati ogni 2 ore, client ogni ora (53 letti, 53 salvati); dal controller non si usano ancora le VLAN tagged per porta (`tagged_vlan_mgmt`, `excluded_networkconf_ids`) né `downlink_table`. Due apparati con lo stesso nome «USW Flex 2.5G 8 PoE» (43 senza dati, 53 con): da segnalare, non toccato.
  - Riccardo, durante il lavoro (08/11): «gli hypervisor devono essere trattati come switch per le porte e i firewall come tutti; gli stormshield devono essere rilevati come tali e acquisiti con porte, tabella arp, tabelle di routing, vlan».
  - [x] Hypervisor come switch: FDB (`bridge -j fdb show`), VLAN del bridge e ARP (`ip -j neigh show`) nel collector `proxmox-ve` (`acquisition/proxmox-rete.ts`); il giro dei parser prende gli hypervisor; nella regola le porte del nodo entrano ma i suoi MAC non fanno «passaggio» la porta dello switch; tab «Porte» dell'hypervisor dalla Mappa porte. Niente in `switch_ports` (Topologia). Prove: `proxmox-rete.test.ts`, 3 casi in `regola.test.ts` visti rossi sul codice di prima.
  - [x] Stormshield: conversione una tantum `device_type_stormshield` (log per nome prima di scrivere) e `firewall` alla creazione; collector `stormshield-sns` (`ifconfig -a`, `arp -an`; rotte dal giro SNMP come prima); il giro lo prende qualunque sia il tipo. **Non collaudato**: la lettura di prova sull'hub fuori dal servizio non parte, la credenziale «SSH -FWL» sta nel vault di DA-Link e i suoi segreti si caricano solo dentro il servizio (tre tentativi, poi fermo per la REGOLA #0). Il primo giro vero lo fa il giro dei parser.
  - [x] Controller UniFi: matrice VLAN (nativa e tagged da `tagged_vlan_mgmt`/`excluded_networkconf_ids`) per gli apparati senza fotografia SNMP, collector o MikroTik (`tabella = controller`); client col loro IP come ARP visto dal gateway in `mappa_porte_visti`; client cablato senza `sw_mac` collocato con `last_uplink_mac`; motivo di ogni client non abbinato nel resoconto. Nessun login in più alla console. `downlink_table` non usata: dice le stesse cose dell'`uplink` dei figli.
  - Riccardo, durante il lavoro (08/11): «acquisire se possibile dai controller anche i client collegati e dove sono collegati; sono informazioni presenti e le possiamo matchare». La lettura c'era già (ogni ora, sull'hub 203 letti, 171 abbinati); aggiunti IP, nome, gateway, rete e il ripiego `last_uplink_*`.
  - [x] MK-RTR-CORE: ARP via SSH quando quello via SNMP è parziale (`SNMP_TIMEOUT`). Prova in `mikrotik-routeros.test.ts`.
  - [x] Censimento su 70151 (08/11, sola lettura, `DEFAULT.db`, `main` a `737ae0ed`): nessun hypervisor, Stormshield o controller registrato; 55 HP e 7 MikroTik tutti nel giro. Collector: MikroTik con tabella MAC in errore su 3 di 7 per `SSH_EXEC_TIMEOUT` (`/interface bridge host print` sui CRS di core, 4 s di serie), PoE in errore su 2 (`SSH_COMMAND_FAILED`), MK-CORE con `network` parziale (`SNMP_TIMEOUT`); 2 ProCurve in errore, 6 con `aggregation`/`poe` non riconosciuti. Corretto: 15 s per comando su `mikrotik-routeros` e `proxmox-ve`; il resto da guardare. Arriva su 70151 solo con `main`.
  - [x] **Rilascio e verifica sull'hub (08/11).** Snapshot `pre-mappa-buchi-20261108` della VM 533 su DA-PX-03 (da togliere fra qualche giorno). 0.9.1006 poi 0.9.1008 su `dev`, arrivate col timer; cancello verde letto dai codici di uscita a ogni rilascio (7.623 prove). Conversione nel journal: `15 SNS EVA2 server -> firewall`. Giro lanciato a mano dentro uno script (identico a quello delle :25): 12 letti, 0 saltati, 0 falliti. Dopo il fix di `dynamic`/`-c`: i 5 Proxmox con tabella MAC (154-409 voci), 3-8 VLAN, ARP; **43 VM «certe» sulla loro porta `tap`/`fwpr`** (DA-PX-01 7, -02 8, -03 11, -04 12, -05 5); `bond10` di DA-PX-01 trunk 4,5,16,20 con 136 MAC. Una sincronizzazione del controller (13:09, l'unica oltre a quella delle 03:00): 17 apparati, 142 native, nessun errore; matrice VLAN `controller` su UDM (13 VLAN), SW-CED-237, SW-CED-MNGM-238, i tre UFLEX; UDM con 30 IP visti dal gateway. Mappa: certe 127 (93 a inizio giornata), spiegate 28 (58), da capire 31, non so 87 (91). **Topologia 287 nodi e 71 collegamenti**, ripartizione identica (misura delle 13:30 su copia); alle 13:20 era 66 perché la sincronizzazione fuori orario rimette `is_uplink` finché il giro SNMP non lo azzera, e lo stesso codice sulla stessa copia dava 66 con la 0.9.1006 e con la 0.9.1008.
  - [x] Le porte `tap` delle VM accese risultavano «down» (`UNKNOWN` del kernel): ora `LOWER_UP` vale «su». Tab «Porte» dell'hypervisor **non vista a schermo**: in Chrome l'hub chiede l'accesso. Dati della tab controllati sul DB.
  - [ ] **SNS EVA2: SSH rifiutato** (`SSH_AUTH_FAILED` con la voce «SSH -FWL», provata con successo il 23/05). Porte e ARP arrivano da SNMP, le VLAN no finché l'SSH non entra. Il giro ci riprova ogni 6 ore: Riccardo, da controllare la credenziale (o l'utente bloccato) sullo SNS.
  - [ ] **29 client «apparato UniFi non in inventario»** su 193: dalla lettura delle 14:00 il resoconto dice il MAC dell'apparato che manca (Controller di rete → storico).
  - [ ] SW-LAB-PROXMOX e SW-UFLEX-RG-10GB sono **offline per il controller**: per questo non hanno dati. Da guardare sul posto.
  - [ ] 79993-ipam-2 è sul ramo **`dev`** (misurato l'08/11, non `main` come scritto sopra): le VLAN del controller arrivano lì se il suo aggiornamento segue `dev`. Due apparati col nome «USW Flex 2.5G 8 PoE» (43 senza dati, 53 con): non toccato.
  - [x] **Su `main` col sì di Riccardo** (08/11, «Sì, porta su main»): snapshot `pre-mappa-buchi-20261108` della VM 104 su PX01, poi fast-forward `git push origin 0f1ca09a:refs/heads/main`; `origin/main` = `origin/dev` = `0f1ca09a` = 0.9.1009, verificato con `git ls-remote`. Dentro anche lavoro di altre sessioni (giro 7, C5, CVE potenziali spente di serie, scansioni «Per device», chiave Comware).
  - [x] **70151 gira la 0.9.1009** (verificato da `/api/health` alle 15:14 UTC: versione 0.9.1009, acceso da 689 s, scheduler ok, DB ok, credenziali decifrabili). Alle 15:01 il codice era sul disco ma il processo era ancora 0.9.1001: Riccardo ha lanciato l'aggiornamento. Trappola: cosa gira lo dice `/api/health`, non `/api/version` (che legge il file `VERSION`).
  - [x] **Colonne ordinabili su `main`** (08/11, «Sì, su main»): fast-forward a `7431e1f9` = 0.9.1011, `main` = `dev` verificato con `git ls-remote`. Dentro anche la 0.9.1010 di un'altra sessione (installazione «tecnico», spenta di serie). Nessuno snapshot nuovo della VM 104: PX01 irraggiungibile dal MacBook; resta `pre-mappa-buchi-20261108` (14:41, prima della 0.9.1009). Ordinamento non visto a schermo (in Chrome l'hub chiede l'accesso).
  - [ ] 70151 alla 0.9.1011: alle 16:51 UTC girava ancora la 0.9.1009. Se il timer non la porta, `systemctl start da-ipam-update.service` nella VM 104; si verifica con `/api/health`, non `/api/version`.
  - [x] Riccardo (08/11): «mi va bene testare la vm di domarc o di casa 99.2». **Ordinamento visto a schermo su 79993-ipam-2** (0.9.1013, 1280 px, Chrome di Riccardo): Porte per MAC decrescente parte da `ether3` di MK-RG-10G (55), frecce sulle colonne ordinabili. A 1280 la tabella Porte scorre in orizzontale nel riquadro (MAC e Vicino fuori vista): da proporre a Riccardo quali colonne nascondere sotto i 1500 px.
  - [x] 99.2, prima sincronizzazione col codice nuovo (16:00): matrice VLAN `controller` su UCG e 3 switch, ma quasi tutte le porte «non letto» perché col profilo di default il controller non manda nativa né `tagged_vlan_mgmt`. Corretto in 0.9.1013: `forward: "all"` senza nativa né `portconf_id` = LAN nativa e tutte le reti tagged. Da rimisurare dopo la sincronizzazione delle 18:00. Client: 54 letti, 54 visti dal gateway, 0 non abbinati.
  - [ ] 99.2: **PX-NAS (`192.168.99.1`) è solo un host, non un apparato**: il giro non legge il suo bridge e le sue VM restano «spiegate» su `ether4` di MK-RG-10G. Per averle sulla loro porta va registrato come apparato Proxmox con una credenziale SSH: decide Riccardo.
  - [x] Riccardo (08/11): «nella pagina oggetti non vengono visualizzati i link di trunk, tipo in 192.168.4.8 udm beast non ha oggetti … ogni porta attiva deve essere indicata», scelta «B, oggetti visti», «se gli oggetti sono troppi mostra solo i primi». Fatto in 0.9.1014 (+ 0.9.1018, una frase): registro `mappa_porte_avvistamenti`; filtrando per apparato anche gli oggetti visti sulle sue porte, con «Qui su <porta>», al massimo 20 per porta. Misurato sull'hub dopo il ricalcolo delle 18:05: la UDM Beast filtrata passa da 0 a 13 oggetti (SW-CED-AGG-243 su SFP+ 2 e SFP28 2, 11 di passaggio su SFP28 2, 1 su Port 4). Visto a schermo su 99.2 (RG-UCG-FIBER, 19 oggetti). La 0.9.1018 è passata solo da tsc e lint (cambio di una condizione nel testo), non dal cancello intero. Non su `main`.
  - [x] **`main` fino alla 0.9.1014** (08/11, scelta di Riccardo «Fino alla 0.9.1014»): fast-forward a `a7030de8`, verificato con `git ls-remote`. Cancello intero su una copia ferma a quel commit: lint, tsc, 7.663 prove, build, tutti 0. Dentro: colonne ordinabili, porte col profilo di default dal controller, oggetti visti sulle porte di un apparato, e la 0.9.1012 di un'altra sessione (installazione «tecnico», spenta di serie). **Fuori di proposito**: 0.9.1015-1016 (credenziali agganciate da sole alle reti), 0.9.1017 e 0.9.1019 di altre sessioni, la mia 0.9.1018 (una frase). Nessuno snapshot nuovo della VM 104: PX01 irraggiungibile dal MacBook.
  - [x] 70151 verificata alle 20:10 UTC da `/api/health`: gira la **0.9.1022**, non la 0.9.1014. `main` è stato portato a `0349ea2f` (0.9.1022) da un'altra sessione alle 20:20 ora italiana (commit «Passo 9: impianti in Per device»), dopo il mio fast-forward: su 70151 sono arrivate anche le credenziali agganciate da sole (0.9.1015-1016) che qui erano state tenute fuori. Segnalato a Riccardo; non toccato.
  - [ ] 70151, dopo il giro delle :25: i 3 MikroTik di core con la tabella MAC (erano `SSH_EXEC_TIMEOUT`) e MK-CORE con l'ARP via SSH.
  - [ ] Attenzione col giro 7 (riga sopra «Prossimo: proiezione della tabella FDB del collector»): una proiezione di `forwarding` in `mac_port_entries` per tutti i collector porterebbe le FDB dei Proxmox in Topologia. Va limitata alle famiglie con porte da switch.
- [ ] 72729: dopo, quando lo dirà Riccardo («solo dopo testeremo 72729»).
- [ ] 79993-ipam-2: RB5009 via SSH e UCG, dopo `main`.
- [ ] Seguire i vicini per i 5.271 «non so» di 70151.
- [ ] Il `.env.local` di 79993-ipam-2 ha stampato un pezzo di un valore (riga 20) il 07/11: se è un segreto, cambiarlo.

## 2026-11-07 — Device UniFi senza dati su 79993-ipam-2 (Riccardo: «le credenziali dovrebbero essere giuste»)

Misurato sull'appliance (VM 963 su PX-NAS, in sola lettura) e nessuna correzione ancora fatta:
- [ ] SNMP: 161/udp `closed` sugli switch provati, `open` sul MikroTik `.254`. Nessun agente in ascolto: non è la community. Da accendere nel controller (se è lì il freno: da verificare a schermo).
- [ ] SSH: la TCP si apre e si chiude senza banner, anche dal Proxmox (`read ECONNRESET`). La password non viene mai provata. Probabile «Device SSH Authentication» del controller, non accertato.
- [ ] Vicini: ci sono, ma su uno switch `local_port` vale sempre `eth0` (`localPortName` in `unifi-map.ts` prende `local_port_name`), e l'indice giusto sta in `local_port_index`. Vanno scritti col nome della porta.
- [ ] MAC per porta: `mac_count` 0 ovunque, li darebbe solo SNMP o SSH. Tutti gli 11 hanno `enabled=0`: dopo aver aperto l'accesso vanno accesi, il giro li salta (`cron/jobs.ts:1391`).
- [ ] Offline per il controller, e senza ping: `.88`, `.62`, `.92`.

## 2026-11-07 — PoE cancellato dal giro SNMP (Riccardo: «Sì, correggi»)

- [x] Misurato sull'hub: sync delle 03:00 su 17 apparati, compresi SW-CED-48POE-242 e il ProMax; i nomi porta del primo non coincidono mai con quelli SNMP, quindi serve l'indice.
- [x] `conservaPoeNonLetto` nei giri e in «Aggiorna»; 4 prove viste fallire col sorgente vecchio.
- [x] 0.9.999 su `dev`, hub aggiornato; snapshot `pre-poe-giro-20261107` (VM 533, DA-PX-03).
- [ ] Non ancora visto sull'hub: una lettura lanciata a mano da fuori del servizio non parte, perché la voce UniFi sta nel vault di DA-Link (riga 352 fallita nello storico del controller, è quella). Dopo il sync delle 03:00: PoE presente su SW-CED-48POE-242 e SW-ING-ProMax-239 e ancora lì dopo i giri delle 03:30 e seguenti. Se resta vuoto, è il controller a non darlo.
- [!] **`is_uplink` azzerato dal giro: correzione scritta, NON pubblicata, sospesa (Riccardo, 07/11: «Sì, lascia sospeso»).** Il commit sta sul ramo `claude/is-uplink-sospeso` (`conservaNonLetto`). Misura del 07/11 su copia del DB dell'hub, con `is_uplink=1` sulle porte di uplink di SW-CED-48POE-242, SW-CED-16XG-241, SW-ING-ProMax-239, SW-CED-AGG-243, SW-CED-Ent8-245:
  - Mappa porte: 0 oggetti e 0 porte cambiati su 488 e 284. Nessun guadagno.
  - Topologia (mappa per cavo, quella accesa): stessa radice, stessi padri, ma **4 collegamenti falsi in più** dalla `Port1` di SW-ING-ProMax-239 verso SW-CED-16XG-241, SW-CED-Ent8-245, AP02-104-LAB e AP06-236-SYS.
  - Causa: `attach.ts` scarta i MAC visti sulle porte di uplink; tolte quelle degli altri switch, per quei MAC resta solo la `Port1` del ProMax, dove l'agente SNMP mette i MAC del LAG 49-50 (il difetto noto in `CONTEXT.md`).
  - Prima di riprenderla: serve che la Topologia non creda alla `Port1` del ProMax, cioè un cambio in `attach.ts`, che finora non si tocca. Rischio da aggiungere se si riprende: un apparato tolto dal controller tiene il suo uplink per sempre.

## 2026-11-07 — Storico MAC-IP che cresce di 43.000 righe al giorno

- [x] Causa misurata sull'hub in sola lettura: nessuna riga ripete l'IP precedente, 772 coppie per 13.658.565 righe. `mac_ip_mapping` tiene un IP per MAC, e un MAC con più IP (arp→arp 5,6 M, host→host 3,5 M, arp↔host 3,9 M) lo cambia a ogni lettura.
- [x] Correzione: `src/lib/mac-ip-storico.ts`, una coppia al giorno al massimo, con indice `idx_mac_ip_history_coppia`. Prova: `src/lib/__tests__/mac-ip-storico.test.ts`, vista fallire su 3 casi prima della correzione.
- [x] Bonifica sull'hub, 07/11 con il sì di Riccardo: 13.659.094 → 21.007 righe, 772 coppie invariate, ultima data di ogni coppia invariata, `quick_check` ok, DB da 3,0 GB (2,2 prima dell'indice) a 1,07 GB. Fermo circa 1 minuto. In 17 minuti dopo 0.9.996 nessuna riga nuova, con `mac_ip_mapping` che continua ad aggiornarsi.
- [x] Hub sano l'08/11 (0.9.1004, salute 200, nessun errore dal 07/11 13:20, `quick_check` ok, 13 righe nuove in 23 ore, nessuna coppia doppia nello stesso giorno): tolti lo snapshot `pre-bonifica-macip-20261107` e la copia in `/var/tmp`.
- [x] Retention di 365 giorni nel job di pulizia (0.9.997, `cleanupOldMacIpHistory`): prova vista fallire. Sull'hub non toglie ancora nulla, la riga più vecchia è di aprile 2026.
- [-] Misurare `mac_ip_history` sulle appliance dei clienti prima del promote su `main`: saltato, Riccardo (08/11) ha scelto di promuovere lo stesso. Unico dato: 70151 aveva 433.292 righe e l'indice si è costruito senza danni. 72729 e le appliance da immagine lo costruiscono al primo avvio dopo il pull: guardare che il servizio sia tornato su e quante righe hanno; lo storico vecchio resta finché non si bonifica.
- [ ] Da decidere: `mac_ip_mapping.ip` e `previous_ip` continuano a oscillare per i MAC con più IP; la tabella ARP mostra l'ultimo visto. La correzione tocca lo storico, non la mappa.

## 2026-11-07 — VM minimale dai clienti comandata dall'IPAM centrale (idea, in ragionamento)

Riccardo, 07/11: «una vm minimale da installare da un cliente per avere non ipam o edge, ma un sistema controllato dal ipam centrale di domarc che comandi gestione delle subnet, acquisizioni, proxy zabbix, script proxreporter mikrotik e altro comandati dal sistema centrale... il proxy remoto sarà collegato via netbird ed isolato per cliente». Fase di ragionamento: niente codice, niente rilasci, nessun intervento su appliance o VM dei clienti.

- [x] Proposta in chat con strade a confronto, cosa diventa difficile, domande numerate. Letti CONTEXT, ADR 0011, storia dell'agente, codice; misura in sola lettura su 533
- [ ] Risposte di Riccardo alle 10 domande: tocca la decisione del 12/10 (un'installazione = un cliente, il tenant non è un confine di sicurezza) e l'ADR 0011 (cosa esce lo decide l'istanza)

Strada superata dalla decisione qui sotto: la proposta iniziale era un'istanza per cliente. Resta scartata la rotta verso la LAN (ADR 0011, e nessun elenco chiuso possibile). Livello proposto: completo.

**Decisione di Riccardo, 07/11: «un da-ipam ridotto come gestione centralizzata multitenant ed isolamento dei dati per codcli».** Vale per il centrale: un solo DA-IPAM ridotto, un DB per `codcli`. Le appliance restano un'installazione = un cliente (12/10). Il tenant, nel centrale, diventa un confine e va costruito.

Riccardo, 07/11, alternativa: «oppure un sistema di collegamento e trasferimento e comando delle installazioni, pensando a snellire quanto possibile se non è presente edge o altre app».

**Decisione di Riccardo, 07/11: «Installazione snella».** ADR 0035. La frase sul centrale qui sopra vale per un centrale che solo riceve e ordina: l'installazione DA-IPAM resta dal cliente, snella, e fa tutto il lavoro; il centrale ridotto per `codcli` riceve copie, le mostra e manda ordini da un elenco chiuso. Niente esecutore da scrivere, 12/10 e ADR 0011 restano validi. Si può assottigliare dopo: il centrale non cambia.
- [x] Risposta di Riccardo: installazione snella col collegamento (07/11)
- [x] Risposte alle 8 domande (07/11: valgono i consigli) e piano scritto: `docs/superpowers/plans/2026-11-07-installazione-snella-e-collegamento.md`, 16 task, livello completo
- [x] Approvazione del piano da parte di Riccardo (07/11). La misura del Task 1 l'ha lanciata lui in una sessione a parte
- [ ] Misurare in laboratorio un'installazione senza Edge, Greenbone, LibreNMS e, se si riesce, Docker. Stima da verificare: 2 vCPU, 4 GB, 40 GB
  - 07/11: prima misura fatta su VM 106 `79993-ipam-3`, VM vuota: 1,6-1,8 GB di RAM, 66 GB di disco di cui 63 Docker, acceso solo nginx. Tabella nel piano. Manca la lettura delle 24 ore: `/root/misura-79993-ipam-3-24h.txt` sul PX-NAS dalle 18:19 dell'08/11, poi soglie con Riccardo
- [ ] Verificare come si installa `sensore-trunk` senza Edge: oggi il codice sta nel pacchetto `scanner_edge`
- [x] Decisione di Riccardo sulla forma del Task 2 (07/11): «nella versione ridotta non vorrei avere greenbone e i suoi database, volevo una cosa ridotta al minimo, un fork della immagine di base». Quindi un'immagine ridotta, derivata da quella di base, senza Greenbone né i suoi database: è la strada di adesso, vedi la riga «a regime» qui sotto. La VM 106 serve solo a misurare, non è la versione ridotta
- **Riccardo, 07/11, regola: «il codice non deve essere diverso da ipam completo, solo avere il modulo per centralizzare i dati e le funzioni aggiuntive spente».** Scritta fra i vincoli del piano
- Riccardo, 07/11, a regime (è un «forse», non una decisione): «a regime forse vorrei davvero un sistema da installare pulito su debian, senza immagine di base». Proposta: la versione ridotta si scrive come installazione su una Debian 13 pulita, che è già il modo in cui nasce l'immagine; l'immagine diventa la fotografia di quel giro. Così adesso non si fa lavoro da buttare. Per arrivare a regime resta da ridisegnare l'aggiornamento, che oggi dipende dall'istantanea dell'host
- **Riccardo, 07/11, elenco dell'immagine: «l'immagine deve avere solo ipam, proxy zabbix, gli script per proxmox, mikrotik, 3cx....».** L'elenco è aperto. Dove stanno oggi (07/11, lettura dei repo): Proxmox = Proxreporter, già nell'immagine, gira sull'appliance; MikroTik = modulo DA-Link di DA-Manager (`modules/dalink_moduli/mikrotik.py`), script `.rsc` che girano sul router; 3CX = `agente-3cx` di DA-Zabbix, sta sul centralino e parla col proxy. MikroTik e 3CX oggi non stanno nell'appliance e DA-IPAM legge già i MikroTik da sé (`devices/mikrotik-*.ts`)
- [x] `sensore-trunk` nell'immagine ridotta: entra, acceso (Riccardo, 07/11: «no acceso», alla domanda se tenerlo spento di serie)
- [x] Script MikroTik e 3CX (Riccardo, 07/11): «è l'installazione che potrà analizzare gli apparati e trasferire i dati». Niente sugli apparati e niente script `.rsc` nell'immagine: li legge DA-IPAM, nel codice comune. MikroTik e Proxmox nel Task 14, 3CX nel nuovo Task 17
- [x] Task 2 fatto (07/11): variante snella in PR su Deploy-Appliance, immagine da 1,5 GB, provata su VM 107 `79993-ipam-4` con 4 GB. Misure nel piano. Immagine non pubblicata, VM 106 e 107 accese sul PX-NAS. Aperto in `TASKS.md` di Deploy-Appliance, compreso il proxy Zabbix che resta rotto se si riavvia nel primo minuto
- [ ] Riccardo, 07/11, aggiunta: «che porta dietro solo ipam e nessun altro modulo». Da confermare con lui: il piano (Task 2) e l'ADR 0035 tengono anche `sensore-trunk` e il proxy Zabbix, e lo scopo ristretto dello stesso giorno li nomina. Fuori di sicuro: Edge, Greenbone, MeshCentral, LibreNMS, Wazuh, Proxreporter. NetBird non è un modulo: senza non c'è collegamento al centrale. Il costruttore ha già `--greenbone nessuno`, ma toglie solo i dati precaricati: le immagini Docker le scarica comunque `immagine_immagini_docker`, quindi serve la variante del Task 2

Riccardo, 07/11: «prima di eseguire il piano puoi verificare se questa modalità limitata potrebbe essere installata in una debian senza avere una immagine completa del sistema, per renderla indipendente dai virtualizzatori». Il Task 1 è sospeso per questo. Giro fermato durante lo scarico, nessuna VM creata.

**Esito (sola lettura del codice, nessuna prova su una Debian vera): si può.** L'immagine nasce già da `install.sh --immagine` su una Debian 13 pulita (`costruttore/costruisci.sh`, passo 3): tutto arriva da apt, git e venv, e `da-appliance applica <file>` funziona a mano. DA-IPAM sta in systemd, Zabbix è un pacchetto, `sensore-trunk` è un'unità systemd con venv, NetBird usa lo script ufficiale.

Cosa manca, in ordine di peso:
- **Aggiornamento e ritorno indietro**: `primo-avvio/aggiorna.sh` conta sull'istantanea dell'host e l'host lo lancia con l'agente QEMU, come Riconfigura. Senza virtualizzatore non c'è né istantanea né host: va ridisegnato, ed è il punto più costoso.
- **nginx sta in Docker** (`compose/compose.yml`, `modular_ipam_reconcile`): è l'unico pezzo della variante che obbliga a tenere Docker. Serve nginx da apt.
- **Rete**: `fasi/rete.sh` scrive netplan e il servizio parte da `cloud-init.target`. Su una Debian del cliente la rete è già sua: la fase va saltata e il file d'avvio deve arrivare in un altro modo.
- **DA-Link** conosce solo Proxmox e vSphere: serve un terzo comando.
- **`sensore-trunk`**: va staccato dal pacchetto `scanner_edge`, che si porta dietro `gvm-tools` e il resto. La scheda deve stare davvero sul trunk: su un altro virtualizzatore serve la VLAN 4095 o la modalità promiscua, a carico del cliente.
- **Identità**: `product_uuid` manca nei container e si duplica nei cloni.
- **`SISTEMI-SUPPORTATI`** ha solo `ubuntu-24.04`, e la via classica porta tutto Docker: Debian 13 va collaudata.
- **Macchina del cliente**: una Debian non nostra può avere la 443 occupata, un altro firewall e repository diversi. Servono controlli prima di toccarla.

Proposta: invece dell'immagine snella del Task 2, un pacchetto firmato (DA-IPAM già compilato, venv del sensore, script) con un solo comando su Debian 13, e la stessa cosa dentro un'immagine per chi la vuole. I Task 4-16 non cambiano.

Fatti sul collegamento (07/11): `lib/vulcan/coda.ts` è già la coda che serve (gzip, sha256, doppioni, ritentativi, corpo cancellato all'uscita, inventario superato dal più nuovo), con fotografia a lista bianca alle 03:00 verso `POST /api/ipam/inventario`. Dopo 12 tentativi una riga va in `fallito` e riparte solo con «Invia ora»: per cadute lunghe va cambiato. Il segnale a DA-Link parte ogni 5 minuti, il gettone fissa `codcli` e nodo; `dalink/invio.ts` dalla risposta tiene solo due date, di proposito: gli ordini vogliono una chiamata a parte. Livelli `solo_stato` e `stato_inventario`: ne serve un terzo, scelto dall'istanza. `modular-base` di Deploy-Appliance è già DA-IPAM con moduli spenti. Sulla 533: `node_modules` 909 MB, `tenants` 3,6 GB, `backups` 27 GB.

Tappe rivedute: (1) centrale ridotto e muri dell'isolamento; (2) VM con proxy Zabbix e `sensore-trunk`; (3) scansione delle reti, motori di `scanner/profili` e `lib/acquisition`; (4) archivio delle config, prima MikroTik e Proxmox, poi switch per produttore; notebook dopo la 3, se serve.
- [ ] Risposte di Riccardo alle domande rivedute (in chat): clienti nel centrale, config solo in lettura, segreti nelle config, stesso codice con un profilo
- [ ] ADR nuovo che supera il 12/10 per il centrale e la regola dell'ADR 0011 «cosa esce lo decide l'istanza»

Fatti sul tenant (07/11): `tenants.codice_cliente` è già il `codcli`, un file `data/tenants/<codcli>.db`; `POST /api/inventory/ingest` ha già gettone → tenant. Da chiudere: 93 rotte su 401 senza `withTenantFromSession` (alcune sono dell'hub di proposito: vanno classificate), ripiego su DEFAULT in `getDb()` e in `api-tenant.ts`, 8 rotte `system-credentials` condivise, `ENCRYPTION_KEY` e chiave dei dati uniche per installazione.

Fatti sullo scopo (07/11): `sensore-trunk` è un servizio a sé in DA-Vul-can (1.653 righe di Python, gira con Edge spento, lettura a cursore, 30 giorni di conservazione), ma risponde solo su socket Unix. `scanner/profili/motore.ts` non tocca il DB. Config: MikroTik `getConfig()` legge `/export` su richiesta senza archiviare, il modulo del Manager lo manda via SFTP; Proxmox: `backup.py` di ProxReporter via SFTP, `/etc/pve` compreso; switch: niente, AOS-CX lo esclude apposta; archivio delle configurazioni mai fatto.

Riccardo, 07/11, scopo ristretto: «lo scopo è avere il proxy e dati centralizzati; la scansione delle reti del cliente con il trunk già sviluppato e la scansione dei device con i motori studiati; non le altre funzioni; serve per avere inventario distribuito per i clienti e monitoraggio dei sistemi; config di switch e router e config di proxmox, mikrotik ed eventuali altri prodotti».

Riccardo, 07/11, aggiunta: «anche eventualmente un sistema minimale da installare sui notebook osx, linux o windows dei tecnici per ottenere dati dalle reti dei clienti e trasferirli al collector centrale». È un'opzione, non una cosa decisa.

Proposta sul notebook: seconda forma dello stesso sistema, parte comune e due modi di portarla (VM fissa, notebook di passaggio). Conviene per rilievi di passaggio, solo dopo la tappa 3 sulle acquisizioni; non sostituisce la VM.
- [ ] Risposte di Riccardo alle domande 11-14 (se e quando, chi possiede i notebook, primo sistema operativo, clienti senza istanza)
- Sessione aperta prima, firmata: cliente, reti ammesse, tecnico, scadenza. Ogni dato porta la sessione; un dato che non torna va in quarantena, non in un cliente.
- Il cliente non si deduce mai dall'IP: 192.168.1.0/24 sta da molti clienti. Si controlla l'impronta della rete (MAC del gateway, dominio).
- Dati in coda cifrati verso la chiave dell'istanza del cliente: il notebook non rilegge ciò che ha raccolto. Credenziali solo in memoria.
- Il notebook non entra in `cli-<codcli>`. Trappola già viva: un notebook in `admins` dentro la LAN di un cliente raggiunge gli oggetti di tutti (P5, porte 22, 443 e 6443).
- Una sessione non dice mai che un host è spento e non alimenta `pulizia_host`.
- Livello comune senza privilegi: TCP connect, SNMP, SSH, API. `ping.ts` distingue solo macOS e Linux; WinRM passa da Python; su Windows nmap vuole Npcap, licenza da verificare.

Fatti trovati:
- L'agente Python è stato tolto il 20/10 perché nessuno lo usava (una riga sull'hub, mai collegata; decisione 26 del 14/10), non per un difetto. Era in ingresso, una chiamata per operazione: non regge una caduta di rete.
- ADR 0011 già scrive: un comando dal centro deve viaggiare come risposta a una chiamata dell'istanza. Fa eccezione solo Vulcan → Edge, P3: 22 e 6443.
- DA-Link non comanda le appliance: prepara blocchi che il tecnico incolla. Un canale di comando oggi non esiste.
- `lib/acquisition`: nessun file tocca il DB, contratto JSON 1.0, CLI già pronta. `lib/scanner`: 10 file su ~30 lo toccano. `lib/executor` copre solo ping, nmap e DNS e lo usano 2 file; `ssh2` e `net-snmp` sono usati diretti in 20 file. Il lavoro vero è qui, più `cron/jobs.ts` (1.878 righe).
- `NmapPortScanOptions.customArgs` è testo libero: sulla VM solo profili per id, o l'elenco chiuso non vale.
- Il centro non deve leggere «niente dati» come «host spento»: tre esiti, stessa regola di `offline-guard`.
- Misure: nodo di 533, 827 MB di RSS; appliance oggi 16 GB (32 con altri moduli), immagine ~15 GB di cui Greenbone ~11. Dimensioni della VM stimate, da misurare: 2 vCPU, 2 GB, 20 GB; 4 GB e 40 GB col proxy.
- Da verificare: se Proxreporter accoda report ed esiti quando manca la rete.

## 2026-11-07 — Switch port mapper: una tabella che dice cosa c'è e dove sta (idea, in proposta)

Riccardo, 07/11: «avendo acquisito molte informazioni sulla rete, per gestire quanto è emerso da switch, router, access point, controller; usando le acquisizioni degli switch, per porte le loro tabelle host, le conoscenze LLDP e varianti, spanning tree, per costruire un'ulteriore tabella che dice cosa è e dove è presente sulla rete; un nuovo menu nella parte di network». Fase di ragionamento: niente codice prima della sua approvazione.

- [x] Misure sull'hub 533 (sola lettura, 07/11) e proposta in chat: regola della porta di accesso, interfaccia oggetto per oggetto, dove si materializza il dato, livello di controllo
- [x] Approvazione di Riccardo (07/11, «Sì, procedi», livello completo). Piano: `docs/superpowers/plans/2026-11-07-mappa-porte.md`
- [x] Pagina Mappa porte, regola, tabelle, ricalcolo ogni 30 minuti
- [ ] Riccardo: decidere la correzione del PoE sovrascritto dal giro SNMP (cambia un dato letto da altre pagine)
- [ ] Riccardo: sì per `main`, è un rilascio alle appliance
- [ ] Rimandate: correzione a mano, colonna «Dove sta» in Discovery
- [ ] Misura sul 72729 prima del codice, solo col suo sì: l'hub è quasi tutto UniFi, un cliente senza controller non ha un riferimento

Misure (MAC visti negli ultimi 7 giorni, 339, di cui 45 di apparati di rete; ne restano 294): 65 da soli su una porta, 50 in wifi, 141 su porte condivise (8 porte di hypervisor, 3 telefono + PC, 10 senza spiegazione), 35 solo su porte di passaggio, 2 solo sul router, 1 su due porte di bordo. Prova contro il controller, 60 MAC su cavo: «meno MAC» 11 sbagliati, «`is_trunk`=0» 13 sbagliati, regola proposta 1 sbagliato (stesso apparato su due porte) e 10 «non so».

Trappole trovate:
- `is_trunk` vuol dire «più di un MAC», non 802.1Q: nessuna porta con più MAC ha `is_trunk`=0, quindi hypervisor e PC dietro un telefono risultano trunk.
- Un vicino LLDP non vuol dire apparato di rete: 25 porte lo hanno verso hypervisor, NAS, telefoni.
- La stessa porta ha nomi diversi secondo la fonte (77 porte su 150, anche l'alias del controller): si unisce per indice, e il fascio si piega sulla porta logica (`topology_port_facts.lag_group`).
- «SFP+ N» non è la porta di indice N: su uno switch con 48 porte è la 48+N.
- SNMP di SW-ING-ProMax-239: 215 MAC su «Port1», dove il controller ne vede uno solo, e nessuno sul fascio 49-50. Lettura da capire nel passo 1: spiega parte dei «non so».
- Spanning tree: stato assente su 3 dei 5 switch principali, una sola porta bloccata, `edge` solo su MikroTik. Serve come avviso, non come criterio.
- LibreNMS aggiunge 10 MAC su 491: solo ripiego.
- 8 PC Windows stanno in `network_devices` con `device_type`=switch: vanno esclusi dagli apparati di rete.
- `mac_ip_history`: 13,6 milioni di righe per 244 MAC, circa 43.000 al giorno; il DB dell'hub pesa 2,2 GB.

Riccardo, 07/11, aggiunta: «ovviamente gestendo trunk, vlan poe device, device aggregazioni di porte». Un membro di un LAG non deve risultare una porta di accesso a sé: i MAC si contano sull'aggregato.

Da dove viene ogni dato e dove manca (hub, misurato il 07/11; il GS1900 dalla nota del 04/11):
- [ ] **Trunk 802.1Q**: colonna a sé, dalle VLAN tagged di `switch_vlan_porte`, mai da `is_trunk`. Manca su ProMax (295 righe con `untagged` vuoto), UniFi letti solo dal controller e altri fuori dalla lettura VLAN: lì si scrive «non letto».
- [ ] **VLAN**: PVID da `switch_porta_pvid`, nativa da `switch_vlan_nativa`, MikroTik dalle `mikrotik_bridge_*`, VLAN del MAC da `mac_port_entries.vlan` (1.214 righe su 1.918 da `device`, 9 su 193 da `unifi`). ProMax: PVID diverso dalla nativa su 6 porte su 14 (5, 9, 10, 11, 13, 16), sugli altri 4 switch 99 su 99 uguali. Nessuna di quelle 6 sta in un LAG (il suo è 49-50): l'ipotesi «forse LAG» non regge sull'hub, resta da rivedere la lettura Q-BRIDGE; finché non è chiaro la VLAN della ProMax si mostra come «dedotta».
- [ ] **PoE**: `switch_ports.poe_status`/`poe_power_mw`. Via SNMP solo su SW-CED-Ent8-245; dal controller sugli UniFi `api`. SW-CED-48POE-242 e SW-ING-ProMax-239 hanno 0 porte con PoE pur essendo PoE: probabile che il giro SNMP sovrascriva ogni 30 minuti ciò che il controller scrive alle 03:00, da provare. GS1900: PoE assente via SNMP (nota del 04/11).
- [ ] **Device**: nome e tipo da `hosts`, `network_devices`, VM dalla scansione Proxmox, vicino LLDP/CDP per chi non è host. Senza nome: produttore dal MAC.
- [ ] **Aggregazioni**: membri da `topology_port_facts.lag_group` (controller: 4 switch, 7 aggregati; `device`: 3 bond del MikroTik; `host`: bond degli hypervisor). L'SNMP dà già i MAC sull'aggregato; il controller sul membro (11 righe su SW-CED-AGG-243): si piegano sull'aggregato, e nel confronto col controller questo ha portato i disaccordi da 12 a 1. Manca su switch SNMP senza controller: `acquisition_snapshots` sull'hub è vuota, GS1900 e simili sono da leggere al 72729.

## 2026-11-07 — Consenso e registro degli impianti (Riccardo)

Riccardo, 07/11, «Sì, approvata». Lavoro e aperti in `DA-Vul-can/TASKS.md`, sezione «Una VA non deve poter fermare una rete»: qui il lato DA-IPAM.

- [x] Rotta `/api/vulnerabilities/consenso-impianti`, `registro-impianti.ts`, comandi in «Un profilo solo», scheda «Registro impianti». 9 prove nuove, pagina vista resa a 1920 e 1280
- [ ] Prova su una sonda vera, su `sim-impianto` del piano `2026-11-07-banco-impianti.md` di DA-Vul-can
- [ ] `main` di DA-IPAM: resta il sì di Riccardo, è un rilascio alle appliance

## 2026-11-06 — Una VA non deve poter fermare una rete (Riccardo)

Riccardo (06/11): marcatempo bloccato al 72729, «non posso distruggere una rete per una va». Fatti e proposta in `DA-Vul-can/TASKS.md`, stessa data.

- [x] Corretto: avevo scritto che `fast_scan` non guarda gli impianti, misurando una copia locale 24 commit indietro. `discovery.ts` li rispetta già; restava solo `known_host_check`, chiuso
- [x] `ammessi` verso Edge (`proposta/ammessi.ts`), blocco e sblocco nella scheda «Per device». Cancello completo verde su questo albero: tsc, eslint, build, 7474 prove passate, 0 fallite
- [x] `dev` su `main` col sì di Riccardo, 06/11 19:02: `main` = `715c4237` = 0.9.993, fast-forward verificato con `git ls-remote`. 72729 riavviato alle 19:12 e 70151-ipam-2 alle 19:08; sul 72729 `ammessi` arrivato a Edge, vuoto
- [ ] Vedere a schermo la riga «Rete bloccata» con un blocco vero
- [ ] Riccardo (06/11): prove più aggressive, «possiamo simulare i plc? o testiamo su una rete più conosciuta?». Proposta: banco col pezzo vero, in `DA-Vul-can/TASKS.md`

## 2026-11-06 — Scansioni per tipo di device (idea di Riccardo, piano in bozza)

Riccardo (06/11): prima scansione delicata, poi proposta di profilo per device e scansioni separate per tipologia anche nella stessa rete. Piano e domande: `DA-Vul-can/docs/superpowers/plans/2026-11-06-profili-per-device.md`. Non parte senza il suo sì.

- [x] Passo 4 (06/11): `avviaGruppoEdge`, `lanciaGruppiConfermati`, rotta `proposte-va/lancia`. Edge in `DA-Vul-can`, stessa voce del suo `TASKS.md`
- [x] Passo 5: scheda «Per device», resa a 1920 con dati finti, mai provata contro una sonda vera. Serve il deploy di Edge
- [x] Passo 6 (08/11): pianificazione «Per device», decisioni di Riccardo «Sì a tutte», tavola oggetti 27-31 approvata. `lib/vuln/proposta/pianificazione*.ts`, giro ogni minuto da `server.ts`, rotta `pianificazione-device`, pannello «Quando», righe `device.<rete>` in Schedulazioni. 9 prove nuove viste fallire, cancello verde, resa a 1920 con dati finti. Scostamenti dalla tavola: salvare «Un profilo solo» spegne «Per device» e lo dice nell'esito (nessun avviso prima); in Schedulazioni il modo sta nel nome, non in una colonna. Mai provata contro una sonda vera
- [x] Tappe 2 e 3 della logica rovesciata (08/11 sera, tavola oggetti 42-43): «Includi impianti…» sui soli impianti scelti con 4 ore / prossima finestra / definitiva; modo «A finestra» nel pannello «Quando» (gruppi alla sonda, rimandati quando cambiano). DA-IPAM 0.9.1027 su `dev` (`762e80dd`), sonda 0.8.271. Dettaglio, scostamenti e collaudo nel piano `DA-Vul-can/docs/superpowers/plans/2026-11-06-profili-per-device.md` e in `DA-Vul-can/TASKS.md`

## 2026-11-06 — URGENTE 72729: celle frigo bloccate, PLC spariti durante il giro (Riccardo)

Riccardo (06/11, 08:20): il cliente ha telefonato, «le celle frigo della rete si sono bloccate a causa delle scansioni»; non sa se è successo ieri.

- [x] Sonda 72729 alle 08:24: nessuna scansione in corso. Sospesi in DA-IPAM `fast_scan` (3), `known_host_check` (3), `arp_poll`, poi `da-ipam` riavviato perché lo scheduler tiene i job in memoria. Restano `ad_sync`, `dns_resolve`, `hypervisor_sync`, `meshcentral_sync`, `vuln_sync`. Per riaccenderli: `/root/job-sospesi-frigo-20261106.json`, poi riavvio
- [x] Sulla `192.168.0.0/24` c'è un impianto: PLC CREVIS, HMI Weintek, inverter Vacon, gateway HMS, Schneider, `CelleSF-PC` (192.168.0.82)
- [x] PLC CREVIS: **due sparizioni, tutte e due dentro una scansione della 192.168.0.0/24** (storico da `scan_history`, comincia il 04/11 alle 10:43 italiane). Prima: .125 e .128 visti fino al 04/11 alle 15:05, durante la scansione 1 `deep` (13:15-21:53); .77 sparito già dopo le 13:05. Tornati il 05/11 fra le 14:00 e le 15:00: non si sa se da soli o riavviati. Seconda: visti l'ultima volta il 05/11 alle 18:00, durante `completo-interno` partito alle 17:36: nuclei su di loro dalle 17:42 alle 18:25. .128, .129 e .130 finiti in 13 secondi contro i 2-4 minuti dei primi: probabilmente già muti alle 18:17. Coincidenza forte su solo due giorni di storico, non prova. La scansione 5 (12:46-17:36) non li aveva fatti sparire: `completo-interno` è il sospetto, non Greenbone da solo
- [ ] **Causa NON accertata** (Riccardo, 06/11: «se fosse così verremmo uccisi»). La coincidenza con le scansioni c'è, ma i PLC erano già spariti per 23 ore senza chiamate, gli orari sono compatibili con una macchina a turni, `CelleSF-PC` e le HMI erano online. Al cliente non si dice che siamo stati noi né il contrario. Servono da lui: ora del blocco, sintomo, quali apparati sono le celle
- [ ] Se i PLC vanno riavviati lo decide il cliente. Non toccarli da qui: nessun pacchetto mandato
- [ ] Riaccendere `fast_scan`, `known_host_check`, `arp_poll` sul 72729: solo su ordine di Riccardo
- [x] Freno su tutte le sonde («Sì, su tutte»): Edge 0.8.258 (`services/protetti.py`) toglie gli impianti da Greenbone, ricerca siti, nuclei, assessment, controlli mirati, presenza. Prova vista fallire col freno spento (7 rosse), `exclude_hosts` provato su gvmd vero il 06/11 sulla 79993-ipam-2: `/29` con 2 esclusi = 4 host, target tolto. DA-IPAM 0.9.987 manda l'elenco alla sonda e il giro veloce non li prova
- [x] **Buco trovato dopo il rilascio**: il freno di Edge da solo NON copriva i PLC, perché erano spenti quando si è riempito l'inventario della sonda e in `network_hosts` non ci sono. Coperti solo dall'elenco di DA-IPAM, che sul 72729 non arriva finché non è su `main`. Rimedio sul 72729: elenco scritto a mano in `host_protetti` con la regola `eImpianto` (prova a vuoto, nomi letti): 63 impianti, 20 → 63; riletto, PLC `.121` protetto e PC `.80` no. Il rilascio attuale non lo azzera: `ensure` lo tocca solo se riceve `protetti`
- [x] `dev` su `main` di DA-IPAM col sì di Riccardo, 06/11 12:39: `main` = `dev` = `503bfc0a` = 0.9.990, fast-forward verificato con `git ls-remote`. Cancello sullo stesso commit da copia pulita: tipi, lint, build esito 0, 7424 prove passate, 0 fallite, 3 saltate. 72729 riavviato sulla 0.9.990 alle 12:42 e 70151-ipam-2 alle 12:53; sul 72729 dopo il `vuln_sync` delle 13:00 `ensure` risponde 200 e l'elenco resta a 63 (uguale a quello a mano, quindi non distingue chi l'ha scritto); job sospesi ancora spenti, nessuna scansione aperta
- [ ] 71343-ipam e 79993-ipam-9: seguono `main`, ma da qui non si misurano (ssh negato)
- [x] Altri clienti, misurato il 06/11: 70151-ipam-2 8 impianti ma tutti in `172.16.0.0/20`, rete non collegata a Edge; 79993-ipam-2 1 coperto; DOMARC 13 e DTS 18, elenco arrivato dall'hub che segue `dev`; DA-VA-OVH 0 nell'elenco. Nessun giro programmato su Edge su 72729, 70151-ipam-2 e 79993-ipam-2; sulle altre non contato
## 2026-11-06 — Pagina Scansioni VA: si parte dal profilo, poi le reti

Task 11 di `DA-Vul-can/docs/superpowers/plans/2026-11-05-base-scansioni.md`. Tavola approvata da Riccardo il 06/11: https://claude.ai/artifact/Brrs7JFGyLNR29dxtQL5V6

- [x] Lancio immediato: lascia sulla rete profilo assessment e ambito, perché Edge legge il profilo dalla sua riga a fine scansione. Quindi avviso anche per Immediata nella colonna «Cosa cambia» (correzione alla tavola)
- [x] Reti insieme: Edge fa una scansione Greenbone alla volta e accoda le altre (28/10, 79994). Niente gruppi; la pagina mostra «In coda». Una seconda sulla stessa rete Edge la accoderebbe: la pagina la salta
- [x] Le spunte su host e credenziali si vedono solo con Immediata: pianificazione e finestra non le leggono (differenza dalla tavola)
- [x] Gli abbinamenti profilo/moduli stanno in `profili-assessment-testi.ts`: il lucchetto di `edge-profiles.test.ts` vieta gli id altrove, e l'elenco resta quello letto da Edge
- [x] Resa a 1920 vista in locale su dati finti e finto Edge (immediata, pianificata, finestra, esito); lancio su tre reti arrivato al finto Edge
- [x] Riccardo (06/11): freno prima di pubblicare. Rete con `plc`, `hmi`, `iot`, `rete_ot`, `sensore`, porte di campo o costruttori di campo: non si sceglie e il server la salta, in tutti e tre i modi (`src/lib/vuln/impianti-in-rete.ts`). Prova vista fallire
- [ ] Limiti del freno: solo questa pagina (pannello VA Scan e piani salvati no), solo ciò che l'inventario conosce, intera rete e non il singolo host. La regola vera va su Edge, con l'esclusione dei singoli host: voce URGENTE 72729 qui sopra
- [x] 0.9.986 su `dev` (`6447649f`), hub 533 aggiornata il 06/11: pagina 200, Edge 0.8.258 letta, 4 voci attive, 7 reti di cui 2 fermate dal freno, POST da sola lettura 403. Letta via HTTP: il Chrome di prova non raggiunge l'hub, quindi la resa sul dato vero non è vista
- [ ] Lancio vero su due reti da una sonda (verifica del Task 11), dopo l'esclusione dei singoli host su Edge

## 2026-11-06 — Router MikroTik remoto per le analisi nelle reti dei clienti (idea, rinviata)

Riccardo (06/11): piano per una prova su un cliente «non ora»; si riprende quando lo chiede.

Riccardo (06/11): usare un MikroTik remoto per parte delle analisi presso i clienti, tenendo qui l'installazione principale.
Letto il codice, niente scritto. Il router non può fare da esecutore (niente nmap); la strada è IPAM instradato attraverso il router, che resta fonte di ARP/DHCP/bridge (`network_router`, `runArpPoll`).

- [x] Riccardo (06/11): il caso è **più clienti**, non più sedi dello stesso cliente
- Proposta, da confermare: una VM o un LXC per cliente in sede, ciascuno col suo tunnel verso il MikroTik. Tiene valida la decisione del 12/10 (un'installazione = un cliente) e regge reti con gli stessi indirizzi, che un'unica installazione non può distinguere: nel codice non c'è scelta dell'indirizzo sorgente né namespace, e la chiave `ENCRYPTION_KEY` è una per installazione
- [ ] Da provare se si fa: tunnel giù durante un giro (soglia offline ADR 0006), MAC e `-O` di nmap attraverso il tunnel, `getActiveEdgeScanner` prende una sola Edge per cliente

## 2026-11-06 — Decisioni di Riccardo sull'analisi del 04/11

- [x] Riccardo: «7 si»: spuntate le 43 voci fatte, chiuse le 21 superate (`- [-]` col motivo). I 7 doppioni restano.
- [x] Riccardo: «4 inseriamo la scansione»: collector `infoblox-nios` portato su `dev` da `origin/codex/infoblox`, solo codice, prove, manuale e piano. Nessun aggancio ai dati, nessun giro automatico.
- [ ] Da chiedere: «inseriamo la scansione» voleva dire anche un giro pianificato? Oggi il collector si lancia solo da riga di comando.
- [x] Riccardo (06/11): la pagina di riclassifica diventa una **modale coi soli device che hanno dati multipli di classificazione**: dati messi a confronto, scelta umana, applicata come scelta manuale. Forma tabellare: per gli IP contesi una colonna per ogni dato, un clic sulla cella e quella diventa la scelta dell'IP. Oggi c'è `components/networks/attribution-preview-dialog.tsx`, che mostra solo prima e dopo; la scrittura manuale esiste già (`POST /api/hosts/[id]/attribution/override`). Prima si propone l'interfaccia oggetto per oggetto. Riccardo: «Sì, costruisci» (livello Leggero, definizione ampia). Fatto: `lib/attribution/contesi.ts`, rotta `/api/attribution/contesi` (GET auth, POST admin), `components/networks/ip-contesi-dialog.tsx` al posto dell'anteprima. Prove `contesi.test.ts` 12/12, viste fallire con due mutazioni. Resa guardata in locale con dati finti a 1280 e 1920, clic provato: scelta, cambio, toglierla, riga manuale non cliccabile.
- [ ] Modale degli IP contesi: guardarla con dati veri sull'hub e fare la prima scelta vera. Finora la scrittura è coperta solo dalle prove su database in memoria. Misurato coi dati veri dell'hub il 06/11: 76 dati contesi su 70 IP di 381 (categoria 45, OS 11, produttore 20), 119 righe coi manuali, massimo 5 fonti per riga, 16 colonne in tutto.
- [x] Riccardo (06/11): «anzi vai su main»: portata su `main` la 0.9.983 (`6a0dd1b2`, fast-forward), lasciando fuori la 0.9.984 di un'altra sessione, che il suo sì non copriva. Prima di averla vista sull'hub, per sua scelta. Dentro c'è anche il collector Infoblox (0.9.982). Poi `main` è salito alla 0.9.985 con un'altra promozione; 70151 sulla 0.9.985, `/api/health` ok, db ok, 0 ripieghi (07/11 00:56 UTC).
- [ ] Modale degli IP contesi: l'anteprima «prima e dopo» non c'è più; resta `POST /api/attribution/recompute` con `preview: true`, ora senza chiamanti nell'interfaccia. Una riga manuale si cambia solo dalla scheda dell'host.
- [x] Misurato sull'hub il 06/11 (379 host, 105 già manuali): contesi per il motore 12 (`conflicts_json` dell'ultimo giro, quasi tutti `compute.server` contro `compute.vm`); con radici di categoria diverse fra le evidenze vive 48; con OS diversi 11. Il conteggio grezzo dava 222 host su 361, gonfiato da `proxmox`/`proxmox-server-solutions` e `compute`/`compute.server`: non va usato.
- [ ] Da capire: sull'hub `attribution_evidence` ha 174.030 righe con fonte `oui`, ma solo 474 vive: le altre sono sostituite e si accumulano a ogni giro, senza retention.

## 2026-11-06 — Host lenti e avanzamento per IP

- [ ] Piano in DA-Vul-can: `docs/superpowers/plans/2026-11-06-host-lenti-e-avanzamento-per-ip.md`. Qui: avanzamento per IP nel pannello VA, rilievi a scansione in corso in `runVulnSync`, interruttore degli host lenti. Richiesta di Riccardo del 05/11. In attesa del suo via.

## 2026-11-06 — Riconoscere gli apparati da ciò che già sappiamo (livello completo)

Riccardo (06/11): dalla sonda del 72729 192.168.0.53 è un Cisco ma non si capisce cosa sia; «nmap dovrebbe già farlo»; «dovevi già usare anche quello per popolare i dati di ipam... dagli altri device in rete, dai dati del trunk letti con i protocolli noti»; «sì, procedi». Piano: `docs/superpowers/plans/2026-11-06-riconoscere-apparati.md`. Metà sensore in `DA-Vul-can/TASKS.md`.

Misurato sul 72729 il 06/11 00:00-00:04Z: 192.168.0.52 e .53 sono due **Cisco SG200-26 (PID SLM2024T), firmware 1.3.2.02**, SNMP spento, porta 90 chiusa, aperta la 80. 50 host `unknown` su 138; col CDP si annunciano solo questi due, LLDP 0 pacchetti in 125 s sulla sonda (ipotesi non verificata: il bridge di `pve` non lo inoltra).

- [x] `trunk_vicini` con piattaforma, versione, capacità, MAC e host (`migrateRiconoscimento`, `apparati-dal-trunk.ts`): `apparati-dal-trunk.test.ts` 6 verdi
- [x] Attribuzione: `annunci.ts`, capacità non autoritative, `lldpd` su Linux escluso: `annunci.test.ts` 5 verdi
- [x] Descrizione LLDP via SNMP: colonna 10 della tabella già letta, `snmp-topologia.test.ts`. Corretto un mio rilievo del mattino: la riga del GS1900 aveva `remote_mac` e `remote_caps`, il MAC non stava solo nel nome
- [x] Vicini SNMP dietro `automatismo.vicini_snmp`, spento: **il filtro di ADR 0018 non è una svista, non si tocca**. `topologia-t2-freno.test.ts` verde
- [x] `-O`: categoria dal testo, ipotesi sotto il 95% scartate; `da-ipam` è root sul 72729, nmap ha anche `cap_net_raw`
- [x] Trovato strada facendo: `salva.ts` ricalcolava solo con evidenze dagli script, quindi `-O` da solo scriveva `os_info` e la classe restava `unknown`. Corretto, prova in `sconosciuti.test.ts`
- [x] Giro notturno `automatismo.riconoscimento`, spento: `sconosciuti.test.ts` 14 verdi
- [x] Revisione indipendente: 7 rilievi, nessun bloccante, tutti corretti. Stampanti anche da 515, 631 e produttore; `-O` senza privilegi non brucia il tentativo; errori ritentati dopo 3 giorni; un guasto su una rete non ferma le altre; un'ipotesi di `-O` resta scritta con «(ipotesi N%)» e non dà categoria, altrimenti i profili a mano perdevano la famiglia del sistema operativo
- [x] Prova sulla copia del DB del 72729 (copia tolta dopo): ricalcolo di tutti i 138 host 0 differenze; con gli annunci cambiano solo .52 e .53 (`switch`, modello, firmware); seconda passata 0 campi. Il frame CDP vero decodificato dal sensore nuovo dà gli stessi valori
- [x] Vedere sul 72729 vero, 06/11 00:58Z, col sì di Riccardo: `main` = `dev` = `3f0a991e` = 0.9.985 in fast-forward (`git ls-remote`), sonda 0.8.257. .52 e .53 `switch`, `network.switch`, modello e firmware, evidenza `cdp` 0.85; `unknown` da 50 a 48; levette spente, 0 tentativi; `da-ipam` e `sensore-trunk` attivi, 0 errori. Build su copia pulita verde
- [-] `verifica-permessi.sh` non eseguita: su dati vuoti esce 2 (manca il database hub) e i tre commit non toccano `src/app`, `middleware`, `api-auth` né `api-tenant` (0 file). Un rilascio che tocca le rotte la deve fare
- [ ] Decisione di Riccardo: accendere `automatismo.riconoscimento` sul 72729. Prova a vuoto del 06/11, 8 host: 192.168.0.30 (Raspberry), .190, .246 (D-Link), 192.168.1.41, .47, .48, .49, .254, gli ultimi 5 senza produttore. Sono rete di un impianto: da guardare prima, e il 05/11 ha chiesto di tenere fermi i job di scansione fino a sonda provata
- [ ] Decisione di Riccardo: accendere `automatismo.vicini_snmp` per cliente
- [ ] Riccardo (06/11): `192.168.0.53` ha la nota «verificare se eliminare» ed è vivo: a un ping non ha risposto e il primo GET è scaduto. Il controllo «Non risposto» può proporre di togliere un apparato acceso. Non toccato
- [ ] Idea, non fatta: la firma web degli Sx200/300 (`GoAhead` + `/cs<8 hex>/config/log_off_page.htm`) riconosce uno switch anche senza CDP e senza `-O`

## 2026-11-05 — Tolti i job di scansione VA del 72729 (si riaccendono a sonda pronta)

Riccardo (05/11): «rimuovi i job in 72729 di scansione, li faremo partire quando abbiamo una sonda perfetta
testata in altre reti». Snapshot `pre-rimozione-job-20261105` della VM 100 su `pve` prima, tolto dopo la verifica.

- [x] Rimossi dalla **sonda** (`network_schedules`, 3 righe, 0 rimaste) e dalla **copia in DA-IPAM**
  (`edge_scan_schedules`, 2 righe, 0 rimaste). Nessuna scansione in corso al momento della rimozione
- [x] **Per riaccenderli** (dalla pagina VA Scan della rete, o reinserendoli): erano
  - rete 1 (192.168.0.0/24): **vuln** `balanced` mensile `0 9 6 * *`; **web-scan** `standard` `0 2 * * 0`
  - rete 2 (192.168.1.0/24): **vuln** `balanced` mensile `0 10 6 * *`
- [ ] **Non toccati** (sono discovery interna di DA-IPAM, non la VA della sonda): i `scheduled_jobs`
  `fast_scan` (reti 1/2/3, ogni ora), `known_host_check`, `arp_poll`, `vuln_sync`, ecc. Se Riccardo vuole
  fermare **anche** la discovery sul cliente, si disattivano questi; chiesto
- [ ] Si lega al fix SNMP della sonda (ramo `claude/fix-snmp-auth-20261105` di DA-Vul-can, in pausa) e al
  lavoro «sonda perfetta testata in altre reti»

## 2026-11-05 — Perché le scansioni restano in superficie: credenziali non autenticate

Riccardo vuole una scansione completa per il quadro al cliente. Misurato sul 72729: le scansioni girano **non
autenticate**, per due motivi distinti.

- [ ] **Config (dati di Riccardo)**: in DA-IPAM alle reti è legata **solo** la community SNMP `public`
  (`network_credentials`: reti 1,2,3 → cred 1). Le credenziali `ad` e `WinRM` esistono (`credentials` id 2 e 3)
  ma **non sono legate** a nessuna rete, quindi non partono. Per Windows/share e Linux servono SSH e Windows
  legate alle reti — sono le credenziali «ridotte al minimo» che decide Riccardo
- [x] **Bug (sonda, DA-Vul-can)**: la sola SNMP che parte veniva persa da Greenbone a ogni invio. Corretto in Edge 0.8.249, su tutte le sonde tranne DOMARC. La causa non era `auth_algorithm`
- [-] Fix `auth_algorithm` annullato il 05/11: `<snmp_algorithm>` è ignorato, ma SNMP si crea lo stesso su gvmd vero (79993-ipam-2). Il rifiuto era `Credential name exists already`: causa e correzione in `DA-Vul-can/TASKS.md`, «Credenziali registrate usate dalle scansioni»
- [ ] Finché (bug) e (config) non sono risolti, il «quadro completo» resta la fotografia **non autenticata**:
  già utile (11 Critical, 35 High, ESXi EOL su 192.168.0.6, FTP, TLS deboli, default-cred trovate da Greenbone)
  ma senza patch mancanti né share Windows con permessi
- [ ] Si lega a: «Credenziali di serie» (default-login), «share/guest come rischio più alto», e al difetto B1

## 2026-11-05 — Le stampanti del 72729 stampano ancora: template nuclei sulla 9100

Riccardo (05/11, ~18:55): «in questo momento 72729 ha stampato ancora cose». La correzione del probe (voce «Le stampanti del 72729 stampano la richiesta del probe») non basta: c'era una seconda fonte. Non è in DA-IPAM: dettaglio e passi in `DA-Vul-can/TASKS.md`, stesso titolo.

- [x] Fonte quasi certa: il template nuclei `CVE-2022-24706` scrive sulla 9100 a ogni giro. Tolto a mano dalla sonda 72729 il 05/11 alle 18:57, spostato in `nuclei-templates/sospesi-20261105/`
- [x] Causa confermata dalla foto del foglio. Correzione in DA-Vul-can 0.8.244, sonde aggiornate il 05/11
- [x] 72729 alla 0.8.247 il 05/11 alle 23:13, a giro finito (21:02): correzione vista nel contenitore. Il template resta in `nuclei-templates/sospesi-20261105/`, non serve rimetterlo

## 2026-11-05 — Credenziali registrate usate dalle scansioni (Riccardo)

Riccardo (05/11): per i clienti con DA-IPAM e scansione attiva, le credenziali registrate si potranno usare per la scansione. Esempio: il 72729 ha credenziali SNMP e AD, da usare con Greenbone e nuclei. Analisi completa in `DA-Vul-can/TASKS.md`, stesso titolo.

- [x] Misurato sul 72729, 05/11 18:57: qui 1 voce `ad`, 2 `snmp`, 1 `windows` e 3 legami con le reti; su Edge tutti gli slot vuoti. Conferma la voce «le credenziali della subnet non arrivano alla sonda»
- [x] Lo scanner prende l'account AD dall'integrazione (fuori dalla lista della rete: la discovery non lo prova, D7) e le voci SSH a chiave. `main` = `dev` = `dd51bb30` = 0.9.984, con dentro anche Infoblox e IP contesi di altre sessioni (Riccardo: «procedi»). Tutte le prove verdi. Sul 72729 legami pieni il 06/11
- [x] Pannello della rete: l'esito si vede, un legame mancante si rimanda col job di sincronia, una volta al giorno al massimo (`edge-credenziali-esito.ts`, 7 prove). `main` = `dev` = `7af846ef` = 0.9.981, promossa col sì di Riccardo il 06/11 dopo tipi, lint, 7311 prove e build verdi; 72729 e 70151 verificate da `/api/health`. Riquadro del pannello non guardato a schermo
- [x] Primo giro del job sul 72729: SNMP legato alle 00:32, account AD all'01:32, `falliti` vuoto

## 2026-11-05 — OWASP Top 10 (Riccardo)

- [ ] Riccardo (05/11): implementare, per quanto possibile, la logica OWASP Top 10. Task 13 del piano `2026-11-05-base-scansioni.md` in DA-Vul-can

## 2026-11-05 — Falle recenti in primo piano (Riccardo)

- [ ] Riccardo (05/11): quadro chiaro delle vulnerabilità recenti e occhio di riguardo a ogni nuova vulnerabilità; nelle nuove scansioni si cercano prima le nuove falle; per le reti già scansionate le vecchie hanno meno impatto. Task 12 del piano `2026-11-05-base-scansioni.md` in DA-Vul-can

## 2026-11-05 — Motore nuclei e falle MikroTik (Riccardo)

Piano: `docs/superpowers/plans/2026-11-05-base-scansioni.md` in DA-Vul-can, Task 1 e 2 estesi.

- [ ] Riccardo (05/11): prevedere anche l'aggiornamento del motore nuclei sui sistemi. Oggi `NUCLEI_VERSION` è fissato a 3.8.0, l'ultima su GitHub è v3.11.1
- [ ] Riccardo (05/11): grave falla MikroTik in ssh. È «MikroTrick» (CVE-2026-67279 e altre), sfruttata da settembre; in più CVE-2026-84411 su WebFig e CVE-2026-98432 del 03/11. Versioni sicure: 7.25.1, 7.24.6, 6.49.23
- [ ] Da controllare, inventario Domarc sul 533, versioni lette da banner e campo firmware, da confermare: 192.168.4.175 (7.15.3), 192.168.40.165, .167, .168 (7.22), 192.168.4.171 (7.22.2), 192.168.40.254 (7.20.8), 192.168.15.121 (7.21.4), 192.168.4.254 e 192.168.15.254 (7.24.5)

## 2026-11-05 — Base scansioni: decisioni di Riccardo e template fermi

Piano: `docs/superpowers/plans/2026-11-05-base-scansioni.md` in DA-Vul-can, bozza da approvare.

- [x] Riccardo (05/11): PHP2Shell è proprio quella (CVE-2026-109618 e CVE-2026-109619), sfruttata attivamente
- [x] Riccardo (05/11): credenziali salvate si usano; se mancano si provano le deboli
- [x] Riccardo (05/11): `public` e `private` si inseriscono di default
- [x] Riccardo (05/11): dopo la prima scansione di una rete, le credenziali non funzionanti si disabilitano; inutile riprovarle sugli stessi device
- [ ] Trovato il 05/11: i template nuclei di Vulcan, 533 e DTS sono del 27/05/2026. Il pacchetto si costruisce solo a mano e la sincronia dice «a posto». PHP2Shell oggi non si rileva con nuclei
- [ ] Attenzione: il template pubblico CVE-2026-109618 forza l'esaurimento di memoria e fa cadere i processi PHP. Va escluso PRIMA di aggiornare il pacchetto

## 2026-11-05 — Base richiesta per le scansioni (Riccardo)

Riccardo (05/11), dopo il changelog del giorno. Sei parti; vale per DA-IPAM e per Edge in DA-Vul-can, la stessa voce sta nei due `TASKS.md`. Piano: `DA-Vul-can/docs/superpowers/plans/2026-11-05-base-scansioni.md`; la pagina è il Task 11.

1. **Gestione delle scansioni.** Tre modi: immediata, schedulata, a finestra. Immediate e schedulate escono verso IPAM e Vulcan appena finite; quelle a finestra quando è impostato. Ripartenze con lo stato di quanto fatto, per recuperare le scansioni parziali. Pagina dedicata che parte dalla scansione e sceglie le reti, non il contrario.
2. **Motori.** nmap con più profili che producono indicazioni per assegnare i device e riconoscere OS e tutto il possibile. SNMP con le community di default sempre presenti. nuclei con profili efficaci e controlli per altri parametri.
3. **Invii** efficaci verso IPAM e Vulcan.
4. **Identificazione:** la via migliore per identificare i device e le loro vulnerabilità intrecciando i dati.
5. **Credenziali note:** usare l'archivio delle credenziali note degli apparati per verificare la configurazione troppo fragile, via ssh, snmp, http, api.
6. **Motori specifici (NUOVO):** verifica di vulnerabilità gravi, «ad esempio php2shell».

- [ ] Da chiarire con Riccardo: cosa intende con «php2shell» e cosa vuol dire il punto 5
- [x] Scrivere il piano, una tappa per punto: è in DA-Vul-can, `docs/superpowers/plans/2026-11-05-base-scansioni.md`

## 2026-11-05 — Proposta: le scansioni non bloccano la pagina, bacheca dei giri

Riccardo (05/11): a ogni scansione si apre un modale di avanzamento e non si può fare altro; «i job dovrebbero
girare in background ed eventualmente avere una bacheca che mi indica cosa sta girando e poter recuperare il suo
stato di avanzamento». Riccardo (05/11): sì ai passi 1 e 2, livello leggero; 3 e 4 restano da decidere.

- [x] Causa: non è configurazione né necessità. Il giro gira già sul server (`discoverNetwork`, la rotta risponde
  subito); il blocco è solo interfaccia: `components/shared/scan-progress.tsx` è un overlay a tutto schermo con la
  X visibile solo a giro finito. Usato in `networks/[id]/network-detail-client.tsx:1430` e `devices/[id]/page.tsx:2622`
- [x] Passo 1: pannello chiudibile e non bloccante al posto del modale (`scan-progress.tsx`, montato una volta in `giri-context.tsx`). Verificato in locale a 1280 con scansioni vere: nessuna copertura, chiusura a giro in corso, sequenza ICMP → Nmap che non riapre un pannello chiuso, pulsante sbloccato a fine sequenza
- [x] Passo 2: elenco dei giri (`GET /api/scans/progress`), pagina `/in-esecuzione` e voce di menu col contatore, con riaggancio dopo un cambio pagina (riaperto al 39% e avanzato). Cancello verde: lint, tsc, build, 7286 prove
- [x] Scoperto strada facendo: `/api/scans/progress/[jobId]` rispondeva a qualunque cliente; ora un giro di un altro cliente dà 404 come un id sconosciuto. Prova in `scanner/__tests__/giri.test.ts`, vista fallire togliendo il filtro; il 404 fra due clienti veri non è stato provato in locale
- [x] Scoperto strada facendo: `busy` restava acceso finché non si chiudeva il modale; ora si spegne a fine giro o sequenza, e i comandi si fermano anche per un giro avviato altrove o dallo scheduler
- [x] Passo 3: sequenze sul server (Riccardo, 05/11: «Sì, passi 3 e 4»; piano `docs/superpowers/plans/2026-11-05-sequenze-e-stop-dei-giri.md`). «Scoperta host» senza naabu, «Avanzata» con selezione e «Accesso agli host» girano in `scanner/sequenze.ts`. Verificato: pagina abbandonata a metà fase 1, la fase 2 è partita ed è arrivata a «Completata»
- [x] Passo 4: «Ferma» in pannello e bacheca, rotta `POST /api/scans/progress/[jobId]/ferma`. Verificato su `next start` con `ping` e `nmap` veri: zero processi rimasti, `fast` chiuso in 119 ms, sequenza in 1,2 s e fase 2 non partita, secondo stop 409
- [x] Scoperto strada facendo: un `nmap` ucciso dallo stop faceva partire il ripiego col ping su tutta la rete (15 s su una /20). Corretto con prova vista fallire
- [x] Scoperto strada facendo: un ping ucciso dallo stop valeva «nessuna risposta» (`killed`): ora è «sconosciuto»
- [x] Scoperto strada facendo: i giri dei profili non uscivano mai dalla mappa: ora restano 5 minuti come gli altri
- [x] Revisione a freddo: un giro fermato scriveva in `scan_history` e la pagina rete l'avrebbe letto come fase eseguita (anche «credenziali verificate»). Tolta la riga, corretti anche i rilievi minori
- [x] **Promossa su `main` su richiesta di Riccardo** (05/11, «promuovi dev a main»): fast-forward `f103bf34`..`8377db91` = **0.9.980**, verificato con `git ls-remote`; cancello su quel commit: lint, tsc, build, 7304 prove (0 fallite). `9ffaf63c` su `dev` è arrivato durante il cancello: resta fuori. Appliance non ancora verificate (timer ~15 min)
- [x] Deciso (Riccardo, 05/11: «Va bene così»): fermare a mano una rete in un job su tutte le reti ferma quel giro, non il job: si prosegue con la rete dopo e `last_run` si aggiorna
- Trappole: `ScanProgress` non ha il tenant (sull'hub `network_id` non basta a separare i clienti); la mappa è in memoria (persa al riavvio, i giri finiti spariscono dopo 5 min); i job senza `discoverNetwork` stanno solo in `runningJobs`

## 2026-11-05 — Idea: pagina Security per definire le scansioni

- [ ] Riccardo (05/11): sotto Security un menù che fa il contrario del pannello VA Scan: una pagina in cui si definisce la scansione e si scelgono le reti fra le subnet disponibili, impostando la tipologia di scansione e se farla su tutta la subnet o solo sugli IP rilevati. Oggi si parte dalla rete. Si appoggia a orario fisso e finestra (piano `2026-11-05-scansione-a-finestra.md` in DA-Vul-can) e alle rotte `edge-scan`; da fare dopo il collaudo della finestra.

## 2026-11-05 — Punteggio: share enumerabili e utenti guest come rischio più alto

Riccardo (05/11): «dovremmo valutare anche come rischio più elevato l'enumerabilità delle share e la presenza
di utenti guest». Misurato oggi sul 72729: gli host Windows la sonda li vede (`Using NetBIOS to retrieve
information from a SMB host` su ~20 IP della 192.168.0.0/24) ma **tutto a gravità `Log`**, quindi sparisce nel
rumore. È la stessa famiglia del difetto B1 (i `Log` affogano i rilievi veri).

- [ ] Alzare la gravità dei rilievi di **enumerazione SMB senza credenziali** (null-session / NetBIOS che
  elenca share, utenti, politiche): oggi `Log`, vanno portati almeno a Medium — è esposizione, non informazione
- [ ] **Utente guest / accesso anonimo** alle share come rilievo ad alta gravità a sé: è un accesso ai dati
  senza autenticazione, non un dettaglio di inventario
- [ ] Dove si decide: `enum4linux`/SMB sulla sonda (DA-Vul-can) per *produrre* il rilievo, e la mappa di
  gravità/categoria in DA-IPAM per *pesarlo*. Oggi `enum4linux` e `ldap-enum` producono **0 righe** perché
  girano senza credenziali: la lettura piena delle share (quali sono aperte, con che permessi) resta legata al
  blocco di fondo — le credenziali della subnet non arrivano alla sonda
- [ ] Si lega a B1 (separare i `Log` dal conteggio) e alla voce «Credenziali di serie» qui sotto

## 2026-11-05 — Credenziali di serie: la verifica c'è già, è spenta

Riccardo (05/11): «sto sviluppando un sistema di VA per la gestione delle criticità aziendali, e il sistema
dovrebbe usare le credenziali inserite di cui sono titolare, ma volutamente sono ridotte al minimo. Per i test
aggiuntivi andrebbero usati archivi di credenziali pubblici per utenze di default, non ovviamente credenziali
dal dark web o dati di compromissione: deve essere solo una verifica che le credenziali di default non siano
ancora presenti negli apparati».

Il lavoro vero sta in DA-Vul-can (`infra/scanner-edge/app/scanner_edge/modules/nuclei/service.py`): qui resta
la riga che ci rimanda, più la parte di DA-IPAM (categoria del rilievo, anti-lockout).

- [x] **I template ci sono già: 310**, contati sulla sonda del 72729 — `network/default-login`,
  `http/default-logins`, `javascript/default-logins` dentro `nuclei-templates`. È esattamente l'archivio
  pubblico che Riccardo descrive: credenziali di serie pubblicate dai costruttori, nessun dato di
  compromissione
- [x] **Non vengono mai provati**: il profilo `standard` di nuclei gira con
  `-tags cve,exposure,misconfig,vuln` (`modules/nuclei/service.py:40`). `default-login` non c'è
- [x] Quello che già funziona su questo asse: `snmp-enum` prova le community di serie (onesixtyone +
  snmpwalk `public`) ed è dentro `completo-interno`; nuclei ha già trovato `SNMPv1 Public Community String`
  (gravità alta) sulla stampante 192.168.1.215
- [x] `cred-bind` è un'altra cosa e va tenuta distinta: prova **una** coppia utente/password fornita, su LDAP
  e SMB, senza salvarla. Serve per le credenziali di cui Riccardo è titolare, non per uno spazzolamento
- [ ] **Da fare, passo 1 (piccolo)**: aggiungere `default-login` ai tag del profilo. Copre subito i
  ~290 template HTTP sulle interfacce web già scoperte — stampanti, switch, NAS: è lì che le default restano
- [ ] **Da fare, passo 2 (più lungo)**: i template di `network/default-login` (FTP, SSH, telnet) vogliono
  bersagli `host:porta`, non URL. Oggi nuclei riceve un solo URL per giro (`-u http://ip:porta`), quindi quei
  template non scattano. Serve dargli anche una lista di host e porte
- [ ] **Da decidere prima di accendere, è il rischio vero**: un template di default-login **tenta l'accesso**.
  Su apparati e domini con blocco dopo N tentativi si rischia di bloccare utenze del cliente. In DA-IPAM
  esistono già `scanner/credential-anti-lockout.ts` e `scanner/credential-run-budget.ts`: la stessa cautela va
  portata su questo asse, o si limita il passo 1 agli apparati (dove il blocco non c'è) tenendo fuori AD
- [ ] **Da fare, passo 3**: in DA-IPAM il rilievo «credenziale di serie ancora attiva» merita una categoria
  sua. È il tipo di finding su cui un cliente agisce davvero, e oggi finirebbe mescolato al resto
- [ ] Si aggancia a **C9** («asse 3: password di default negli apparati dei clienti») e al blocco più grosso
  già misurato: le credenziali della subnet non arrivano alla sonda (`ssh`, `smb`, `snmp` e AD vuoti su
  tutte e due le reti del 72729)

## 2026-11-05 — I profili assessment vanno spiegati in pagina

Riccardo (05/11): «oltre che spiegarli dovresti descriverli nella UI molto meglio». La tendina del pannello
VA Scan mostrava solo le quattro etichette del catalogo dell'edge.

- [x] Verificato che l'edge non ha niente da dare: `GET /api/v1/profiles` restituisce solo `id`, `label`,
  `image`, `requires_authorization` e i **nomi** dei moduli (`services/profile_runner.py:50`). Nessuna
  descrizione, nessun timeout, nessun «facoltativo». Quindi i testi stanno in DA-IPAM e si correggono con un
  suo rilascio, senza toccare le appliance
- [x] `src/lib/vuln/profili-assessment-testi.ts`: una riga per ogni profilo (a cosa serve + quando) e una per
  ogni modulo, scritte leggendo il codice dei moduli della sonda, non inventate
- [x] Pannello: ogni voce della tendina dice quanti moduli esegue; sotto, la scheda del profilo scelto con
  l'elenco dei moduli e cosa fa ciascuno
- [x] Ripiego non muto: profilo o modulo sconosciuto resta visibile col suo id e si dice che non è descritto
- [x] Ristretto il lucchetto «nessuna lista fissa di profili» (`edge-profiles.test.ts`): vietava gli id scritti
  a mano ovunque, ora ammette i due file delle descrizioni e in cambio controlla che lì non nasca un catalogo.
  Prova nuova vista fallire aggiungendo un finto `profiles: [...]`
- [x] Cancello verde: lint 0, tsc 0, **7.210 prove, 0 fallite**, build 0
- [ ] **Resa a schermo non vista**: in questo repo non c'è un modo stabilito per guardare la pagina in locale
  (niente Playwright, il pannello vuole accesso, tenant, rete ed edge configurato). Da guardare insieme sul
  72729 dopo il rilascio

## 2026-11-05 — Le stampanti del 72729 stampano la richiesta del probe

Riccardo (05/11), con la foto del foglio uscito dalle stampanti: «una qualche funzione eseguita ieri ha fatto
stampare a tutte le stampanti della ditta stampe di questo tipo» — `GET / HTTP/1.1`, `Host: 192.168.0.134`,
`User-Agent: DA-INVENT-probe/1.0`.

- [x] **Causa**: in `src/lib/scanner/probes/http-tls.ts` la **9100** era fra le `CANDIDATE_PORTS` (e in
  `run-probes.ts` fra le `WEB_PORTS`). Il probe apre la connessione in chiaro su ogni porta candidata aperta e
  ci scrive la GET; la 9100 è JetDirect raw, quindi quei byte vengono stampati. I probe partono da
  `discovery.ts:3606` per `scan_naabu`, `scan_nmap_base` e `network_discovery`
- [x] **Misurato sul 72729** (sola lettura, dal Proxmox del cliente): `192.168.0.134` è `HP87CBC7`,
  `inferred_device_type=printer`, con `9100/tcp jetdirect` aperta; sulla 192.168.0.0/24 sono **8 gli host con la
  9100 aperta, tutte stampanti**. In `scan_history` c'è lo scan `nmap` del 04/11 alle 15 UTC e un
  `network_discovery` del 05/11 alle 00 UTC
- [x] **Non si perde niente togliendola**: la 9100 non è fra le `HTTPS_PORTS`, quindi va in chiaro; JetDirect
  non risponde HTTP e senza certificato `probeOnePort` esce con `null`. Su quella porta il probe non ha mai
  potuto produrre un finding
- [x] **Corretto** su `claude/probe-9100-20261105`: 9100 tolta dalle due liste. Prove nuove viste fallire col
  difetto presente — `http-tls.test.ts` misura i byte su un socket vero in ascolto sulla 9100 (**100 byte
  scritti** prima, 0 dopo) e controlla che sulla 7080 la GET parta ancora; una prova in `run-probes.test.ts`
  sulle porte passate al probe. Cancello verde: lint 0, tsc 0, **7.200 prove, 0 fallite**
- [x] **Rilasciata la 0.9.975** col sì di Riccardo (05/11): `origin/main` = `origin/dev` = `7a65ec66`,
  fast-forward verificato con `git ls-remote`. Cancello rifatto sulla versione rilasciata: lint 0, tsc 0,
  7.210 prove e 0 fallite, build 0
- [x] **Verificata dove succede, non nel repo**: sull'hub 533 e poi sull'appliance **72729** (0.9.975 servita,
  commit `7a65ec66` su `main`) ho messo due socket in ascolto sulla macchina stessa e le ho puntato addosso il
  probe installato: **0 byte sulla 9100, 100 sulla 7080**. Prima erano 100 sulla 9100 — il foglio stampato.
  Nessuna appliance è stata forzata: le ha prese `da-ipam-update.timer` da solo
- [ ] **70151 non letta**: `Host key verification failed` dal MacBook. È la chiave cambiata della voce A11, non
  una conseguenza del rilascio
- [ ] **Da decidere, stessa famiglia di problema**: anche `nmap -sV` tocca la 9100 (è in `ports.ts` e in
  `ALWAYS_USEFUL_TCP_PORTS`) e alcune sue sonde possono far stampare. Il foglio in mano a Riccardo è il nostro
  probe, non nmap, ma va guardato
- [x] **Fatto col sì di Riccardo** (05/11): la 192.168.1.0/24 del 72729 è su **`completo-interno`**. Snapshot
  `pre-profilo-20261105` della VM 100 sul nodo `pve` prima di toccare, tolto dopo la verifica. Fatto per la
  strada dell'app (`resolveAssessmentForNetwork` + `/api/v1/networks/ensure` senza host, senza credenziali e
  senza `targeting_mode`, poi `setNetworkAssessmentConfig`), non con una UPDATE a mano. Verificato su tutte e
  due le parti: `networks.assessment_profile_id` = `completo-interno` nel database della sonda **e** in quello
  di DA-IPAM; label, pianificazione e `host_count` invariati
- [x] **Non era un difetto: l'aveva cambiato Riccardo a mano** (05/11), fuori dall'app. Per questo alle 10:40
  DA-IPAM diceva `validation-plus` e la sonda eseguiva `smoke-interno`. Nel codice la copia locale si scrive in
  **un punto solo** — `rememberAssessmentAcceptedByEdge` (`edge-subnet-bridge.ts:251`) — e **solo dopo** che
  `/api/v1/networks/ensure` ha accettato: dalla pagina le due parti non possono separarsi
- [x] **Fatto col sì di Riccardo** (05/11): il pannello dice quando le due copie non combaciano.
  - Sonda (**ramo `claude/lookup-assessment-20261105` di DA-Vul-can, non su `main`**): `GET /api/v1/networks/lookup`
    riporta `assessment_enabled` e `assessment_profile_id`. Prima quel valore usciva solo da un `PATCH`, che
    scrive: non va bene per una lettura a ogni apertura del pannello. Additivo, un DA-IPAM vecchio lo ignora.
    3 prove nuove, 2 viste fallire (`KeyError`); 513 prove della sonda verdi
  - DA-IPAM: `confrontaAssessment` in `edge-profiles.ts` (puro), `assessment_sonda` in `EdgeSubnetStatus`, e
    l'avviso nel pannello. Il confronto si fa su quello **salvato**, non su quello che si sta scegliendo, se no
    lampeggia a ogni clic. Sonda che non lo dice = «non noto», nessun falso allarme. 6 prove, 2 guasti
    introdotti apposta per vederle fallire. Cancello: lint 0, tsc 0, **7.216 prove, 0 fallite**, build 0
  - Tolta dal lucchetto la voce per il file di prova delle descrizioni: era inutile, `sourceFiles` non entra
    nei `__tests__`. Ce l'avevo messa io stamattina
- [ ] **Resta da decidere**: il rilascio della sonda. Finché quel ramo non va su `main` di DA-Vul-can l'avviso
  non può comparire (DA-IPAM non ha il dato). È un rilascio alle appliance e tocca un file che un'altra
  sessione sta riscrivendo (`api_v1_ipam.py`, +169 righe sul ramo `claude/scansione-a-finestra-20261105`):
  va coordinato con quella. **Decide Riccardo**
- [x] Da sapere: alle 09:32 era partita una scansione (`scans.id` 4, profilo `fast`, `pending`): l'assessment
  in coda a quella userà già `completo-interno`. E fra le 09:05 e le 10:40 il `targeting_mode` di **tutte e
  due** le reti è passato da `full_subnet` a `found_ips` e la rete 1 ha cambiato label: non è stato questo
  lavoro (la rete 1 non l'ho toccata), è lavoro fatto dalla pagina
- [ ] **Da decidere**: la rete 192.168.1.0/24 del 72729 ha il profilo di assessment `smoke-interno`, che esegue
  solo `service-fp`. È il motivo per cui mancano tls-deep, snmp-enum, dns-enum e gli altri, non un guasto



## 2026-11-05 — Idea: scansione a finestra con IP casuali e nuovi tentativi

- [ ] Riccardo (05/11): modalità di scansione che distribuisce in ordine casuale gli IP di una rete dentro una fascia oraria e in giorni scelti (esempio: 8-20 di lunedì, martedì, mercoledì). Gli IP che non rispondono si ritentano n volte in fasce diverse. Tutti i dati si archiviano per l'invio e si vedono man mano in DA-IPAM e in Edge. Si appoggia alla somma per host di Vulcan 0.8.235 (`docs/superpowers/plans/2026-11-04-rilievi-del-periodo-per-host.md` in DA-Vul-can).
- [ ] Piano in DA-Vul-can: `docs/superpowers/plans/2026-11-05-scansione-a-finestra.md` (approvato da Riccardo il 05/11, livello completo). Qui il Task 9, pannello VA Scan, e una parte del Task 10.

## 2026-11-04 — Analisi: attività da fare

Controllato il 04/11 su `origin/dev` (0.9.969, 7aa1493c) e `origin/main` (0.9.967, e27a4309), più due letture sull'hub 533 in sola lettura. **I clienti non sono stati toccati né misurati**: i dati del 72729 sono quelli già scritti qui il 04/11. Dimensioni: S = una sessione corta, M = un giorno, L = progetto con piano.

I 157 aperti di prima: **43 fatti e mai spuntati, 21 superati, 7 doppioni, 86 vivi**, raggruppati in 33 voci qui sotto. I numeri fra parentesi sono le righe di `TASKS.md` prima di questa sezione. Le vecchie caselle sono rimaste come stavano: si spuntano con l'ok di Riccardo.

**Correzioni a ciò che si credeva aperto:**
- Detect OT e scheda stampante **non aspettano la promozione**: sono su `main` dalla 0.9.962-963 e il 72729 gira la 0.9.967.
- Invio diretto AD e inventario a DA-Vul-can (8b, 10) **è fatto**: `vulcan_coda` piena sull'hub e sul 72729, nessun errore. Il piano A2 non blocca più nulla.
- Login con `callbackUrl` `0.0.0.0:3001` **è risolto** dal 29/10 (54b3d6c8, su `main`, con prova). Controllato dal di fuori sull'hub: `/` risponde 302 verso `/login`, senza parametri. Non provato su un'appliance.
- Infoblox non è più fermo sull'accesso: il blocco ora è il modello dei dati (voce C1).

### A. Tocca i clienti

- [ ] **A1. Sonda del 72729 ferma alla 0.8.234** (34). Ogni giro fermato dal guardiano sparisce senza traccia. In DA-IPAM non c'è niente da fare: serve il rilascio di DA-Vul-can, chiesto alla sessione «Password non funziona su 72279». Poi si controlla `GET /api/v1/scans?stato=error`. S. Nessuna decisione.
- [x] **A2. Promozione `dev`→`main`** (fast-forward): fatta il 04/11 col sì di Riccardo (domanda 8, «Sì a tutte e 9»). `main` = `dev` = `5de093d5`, 0.9.969, verificato con `git ls-remote`. Su `dev` c'erano solo la 0.9.968, la 0.9.969 e note. Cancello sul commit: lint 0 errori, tsc 0, 7.152 prove passate e 0 fallite, build 0. 70151 (`100.107.145.24`) arrivata alla 0.9.969, `/api/health` ok. Sul 72729 la 0.9.968 rende davvero solo dopo A1. Le altre appliance non sono state controllate.
- [-] **A3. Classi del 72729 da ricalcolare** (1087 riaperta in forma nuova). Il ricalcolo del 04/11 16:10 ha messo in `iot` 30 host, fra cui 11 Weintek e 10 CREVIS. Dopo è arrivata la radice `ot`: il codice ora dà `hmi` e `plc`, ma quei host cambiano solo con un ricalcolo o una scansione con porte (non misurato se sia già successo). Comando già provato: `scripts/attribution-recompute-cli.ts`. S. **Decide Riccardo**: scrive sul cliente, snapshot della VM 100 prima. — **Superata il 06/11** (Riccardo: ok): le 11 Weintek risultano già `hmi` nel documento del 05/11; i CREVIS non controllati.
- [ ] **A4. Collaudo Windows ancora da fare** (162; piano WMI S10). WinRM/WMI automatico è su `main` ma non è mai stato provato su un DC vero, né con un account che i PC accettano: al 72729 12 PC su 13 rifiutano quello attuale. Servono la rete finta di Riccardo e l'account amministratore locale dell'IT del cliente. M. **Serve Riccardo**.
- [ ] **A5. Stampanti del 72729** (1107, 1108): 8 seriali su 10. Restano la WF-6590 (192.168.0.131, nessun seriale in Printer-MIB) e 192.168.1.215 (lettura senza dati). La scheda stampante non è mai stata guardata a schermo. S. Nessuna decisione.
- [ ] **A6. Rete «parma» 192.168.2.0/24 del 72729 muta** (150): 0 host, compresi gateway e switch «pese». Da guardare criteri e rotte sul Fortinet, o se è una sede in VPN. Sul posto, anche le porte 26, 29, 40, 45 a 10 Mbps half (148). S. **Serve Riccardo** (accesso al Fortinet o risposta dell'IT).
- [ ] **A7. 35 ripieghi nella salute del 72729** (52), l'hub ne ha 0. S, diagnosi. Nessuna decisione.
- [ ] **A8. Profili di scansione mai visti su apparati veri** (73, 74, 102, 103, 104, 105): resa della tab «Rilievi» (ora si può, 13 host sul 72729), output degli script OT, privilegi per `-O` e `-sU` sulle appliance, costo di `--version-intensity 7`, `--osscan-limit` che salta gli host filtrati. S. **Si sovrappone alla sessione «Scansione device IoT/OT in da-ipam»**: lo fa lei, non si duplica.
- [ ] **A9. Vault sulle appliance dei clienti** (250, 291). Hub fatto il 29/10; manca il passo 8, da coordinare con DA-Link. `ENCRYPTION_KEY` resta per i segreti TOTP (ADR 0034). M. **Decide Riccardo** quando, appliance per appliance.
- [ ] **A10. Token API di LibreNMS di 70151 da rigenerare** (556): finito nel trascritto il 23/10. S. **Serve Riccardo**.
- [ ] **A11. Accessi da chiarire**: impronta ssh cambiata su 192.168.99.51, che ferma la misura dei server non agganciati (694); feed vulnerabilità del cliente A, manca quale file del vault (505); chiave SSH di 70151 cambiata (CONTEXT, 03/11). S. **Serve Riccardo**.
- [ ] **A12. Blocco `rete` di 70151 in DA-Link** (195), mai verificato. S, da guardare lato DA-Link.

### B. Difetti

- [ ] **B1. `finding_count` e «N CVE»** (62, 63). La colonna conta solo Greenbone e l'etichetta sovrastima: sul giro 124, 2135 rilievi su 2402 sono di livello Log. Proposta: UPDATE a fine `sync-job` e testo «rilievi». Il numero del pannello però viene dalla sonda: serve anche DA-Vul-can. S. **Decide Riccardo**.
- [ ] **B2. Comware, letture SNMP** (531, 534, 931; 542 è un'alternativa da scrivere sullo switch). Le VLAN arrivano già dal collector su 5 su 5: resta `TEMPO_SCADUTO` su 1-3 walk e i nomi persi su *tooBig*. M. Solo `snmp-agent packet max-size` decide Riccardo, non serve ora.
- [ ] **B3. ProMax** (664): PVID diverso dalla nativa su 6 porte su 14, porte 33-52 assenti da SNMP. Forse LAG. M.
- [ ] **B4. Windows lato Assegnatari** (387, 388): WinRM 0 righe su 70791, 3 agenti Wazuh su 11 senza host, 18 postazioni non trovate. S.
- [ ] **B5. Native VLAN senza scadenza** (665): uno switch uscito dal controller lascia righe vecchie (140 sull'hub). S. **Decide Riccardo** se farle scadere.
- [ ] **B6. Piccoli difetti di codice**: MAU-MIB con due indici letta come uno (149, serve un apparato); per un non admin `action=all` legge l'export e lo scarta (806); job creato da script che chiede un riavvio (639); `next build --webpack` che cade in locale (310). S ciascuno.
- [ ] **B7. Interfaccia**: a 1280 px le ultime colonne scorrono (506); panoramica switch 150 px di troppo con «Trunk» e «Tutte» (637); Opzioni dice «Cliente» dove ADR 0033 dice «istanza» (309); rifiniture della scheda per tipo e casella AD di DA-DC01 (730, 744, 750). M in tutto. Solo 637 chiede una scelta: accettarlo o accorciare la tabella.
- [ ] **B8. Documenti fermi**: skill `deploy-prod` e `CLAUDE.md` parlano del servizio `da-invent`, sull'hub è attivo `da-ipam` (248); i limiti WMI nel messaggio di `device-connection-test.ts` (168). S.

### C. Miglioramenti

- [ ] **C1. Infoblox**, due passi distinti. **Riccardo 06/11: «inseriamo la scansione»**: collector portato su `dev` (vedi sotto). Se voleva anche un giro pianificato è un lavoro in più, da chiedergli. Il passo «dati in IPAM» non ha ricevuto risposta: resta aperto.
  - **Portare il collector su `dev`**: `origin/codex/infoblox`, 6 commit, conflitti solo in CHANGELOG, TASKS e versione. Raccolta collaudata (6.853 record in 37 s), resta da CLI, nessun effetto sui dati. Il documento di consegna dice che il ramo non è su origin: ora c'è. S. **Decide Riccardo**.
  - **Far entrare i dati in DA-IPAM**: è questo il blocco vero. Mai progettato. `networks.cidr` è UNIQUE e due viste possono avere lo stesso CIDR; `dhcp_leases` vuole il MAC e il CHECK di `source_type` non ammette `infoblox`; DNS senza una destinazione. L, livello Completo, sequenza in `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`. **Decide Riccardo** se serve e per quale cliente.
- [ ] **C2. Rilievi sommati per host** (17, 18; lato DA-Vul-can 16). Il rilievo di un host si sostituisce solo con quelli nuovi di quell'host; il giorno per giorno copre tutta la subnet. Il primo pezzo c'è (`vuln_findings_attuali`). M qui, più DA-Vul-can. Richiesta di Riccardo già fatta, va messa in ordine con Edge.
- [ ] **C3. Proxmox** (1035, 1043). `proxmox-ve` è fuori dal pulsante e lì resta (`riconosci.ts`). Mancano: modello, seriale e produttore dei nodi (vuoti nel collaudo su 4 nodi; codice scritto, mai riprovato), IP dei guest su 24 di 52, schede di rete non proiettate, `sockets` fisso a 1. La scansione di oggi dà già tutto, quindi agganciarlo non aggiunge dati. Proposta: resta fuori. M per la parità. **Decide Riccardo**. — **Riccardo 06/11: «2 si»**, letto come risposta sul Proxmox: resta fuori dal pulsante, nessun lavoro. Da confermare che il 2 fosse questa domanda.
- [ ] **C4. SSH Ubiquiti** (995). Fermo dal 22/10 su autenticazione rifiutata, nessun tentativo in più. SNMP e controller UniFi danno già i dati e il 23/10 si è deciso che Ubiquiti resta in SNMP; l'SSH aggiungerebbe poco (`mca-status`). Proposta: chiudere. In alternativa serve la credenziale dei device dal controller. S. **Decide Riccardo**. — **Riccardo 06/11: «lasciamo la possibilità»**: la voce non si chiude come rinuncia, l'SSH resta previsto nel collector; si riprova solo quando c'è la credenziale dei device. Nessun lavoro ora.
- [ ] **C5. LibreNMS** (602, 608, 610, 613, 615). I dati sull'hub arrivano (52 apparati, 1094 porte), ma: vicini nella mappa non fatti, `librenms_vicino` non è letta dalla topologia (M, zona rossa); nessun ADR; limiti di avviso non letti; 5 server mai interrogati da provare; prove T1 e T5. Dimensione totale M.
- [ ] **C6. Collaudi dei collector** (805, 808, 812, 830, 831, 845, 852, 996, 1034, 719, 721, 663): prove in locale su apparati veri, tutte «in attesa di Riccardo» dal 21-22/10, molte ormai implicite nell'uso su 70151. M. Da leggere una volta sola, tenendo solo quelle che non sono già state esercitate.
- [ ] **C7. Decisioni rimaste sui collector** (817, 821, 853): ritirare `src/lib/devices/acquisition/`? Togliere «(anteprima)» dall'interruttore? S. **Decide Riccardo**.
- [ ] **C8. Controller UniFi** (516): strumento da CLI, fotografia per apparato, o radio e client. M. **Decide Riccardo**.
- [ ] **C9. Detect, assi 2 e 3** (1088). L'asse 2 è in parte coperto da `http-title` e `http-headers`. Asse 3: password di default negli apparati dei clienti, da far decidere anche rispetto a DA-Vul-can. M. **Decide Riccardo**.
- [ ] **C10. Rinviati per famiglia** (897, 912, 929, 945, 960, 997): QNAP, HP, Comware, VMware, NetApp, estensioni. Restano rinviati, nessuno ha chiesto di farli. VMware e NetApp possono toccare la sessione «Deploy soluzione su vSphere 8».
- [ ] **C11. Occhiate e cose minori di Riccardo** (308, 539, 555, 638, 402, 659, 79): scheda Istanza da superadmin, tab VLAN su 70151, pastiglia «spenta», NB-AGUZZOLI n. 31, cluster iLO, rilievo grezzo. S.
- [ ] **C12. Bacheca dei piani**: `recupero-dadude3-mknet` dice 3 su 9 e aspetta una sessione cloud, ma il ramo è già in `dev`; `daipam-cve-locali` è fermo a 2 su 6 dal 07/09 e i feed exploit fatti il 22/10 ne coprono una parte. S per riallineare. **Decide Riccardo** se il secondo serve ancora.
  - [x] Riccardo (08/11): «riprendi il lavoro daipam-cve-locali». Passi 2-5 fatti l'08/11 (ADR 0036): archivio NVD locale, matcher, pannello «CVE potenziali» spento di serie. Trovato e corretto: `discovery.ts` buttava i CPE prima di salvarli (VM 533: zero CPE). Resta `recupero-dadude3-mknet`.
  - [x] Riccardo (08/11): «prova e dopo valutiamo se mettere un'opzione visibile» per l'intensità `-sV`. Misurato sulla 533 (LAN Storage, a mano, app non toccata): 0 → 33 s e 42 porte con CPE; 5 → 94 s e 37; 9 → 98 s e 1. Oltre lo 0 gli host sforano il timeout di 75 s e si perdono interi. Riccardo (08/11): «sì, resta a 0», niente opzione visibile.
  - [ ] Trovato l'08/11, non mio: `src/lib/vuln/__tests__/finestra.test.ts` (MINUTI_GRUPPO) è rosso dove c'è DA-Vul-can accanto. DA-IPAM dice 20/60/120 minuti, la sonda (`finestra_runner.py`, commit 65f83618 del 06/11) dice 120/180/300. Va deciso quale vale e allineato l'altro.
  - [ ] Trovato l'08/11: nella cartella dati locale c'è un `data/ipam.db` nato alle 13:00 di oggi (non dal lavoro CVE: importare i moduli non lo crea). Fa fallire due prove che vanno lanciate con `DA_INVENT_DATA_DIR` temporanea. Da capire chi l'ha creato prima di toglierlo.
  - 08/11: scheda `recupero-dadude3-mknet` riallineata (S, C0-C3 chiusi; C4-C6 da fare). Verifica sul codice di `dev` (= origin/dev, 0.9.1001):
    - **C5 in parte superato**: dal 07/11 il giro dei parser (`mappa-porte/giro-parser.ts`, ogni 6 ore, levetta `mappa_dati`, accesa su hub e 70151) lancia i collector e applica gli snapshot. Resta un buco: la protezione dei campi del collector nel giro SNMP (`acquisizione-modulare/giri.ts`, `campiDelCollectorApparato`) guarda solo l'interruttore dell'acquisizione modulare, non `mappa_dati`; con quello spento il giro SNMP riscrive velocità, duplex, VLAN e STP scritti dal giro dei parser. Da misurare su 70151 prima di toccare.
    - C6 (storico configurazioni) e C4 (modello infrastrutturale): nessuna traccia nel codice. C7: `src/lib/devices/acquisition/` c'è ancora, «(anteprima)» pure.
    - **Giro 7 fuori da `dev`**: `83c9d4dd` unisce `collector-modulari` solo fino al giro 6 (`943c3dd8`). I 5 commit del giro 7 (riga in Opzioni, Proxmox agganciato al pulsante) stanno solo nel tag `archivio/collector-modulari-20261103`. Da riportare su `dev` o da lasciar cadere: **decide Riccardo**.
    - Stato per blocco e per task scritto nel piano, §8. Ancora aperti anche C2.6 (M5 vicini da completare), C2.7 (misura su copia del DB dell'hub) e C3.7 (`vmware-vcenter`).
- [ ] **C13. Da tenere d'occhio**: `@xmldom/xmldom` forzato a 0.8.15 per `kdbxweb`, da ricontrollare a ogni aggiornamento (290).

### Non di DA-IPAM (coperte dalle sessioni degli altri repo)

Edge e Deploy-Appliance: guardiano che ferma giri vivi e `openvas.log` da 2 GB (14, 15), `gvmd` «Credential could not be created» (19). DA-Vul-can: selezione per host nelle analisi periodiche (16).

### Fatti e mai spuntati (43)

- Profili e tassonomia: radice `ot`, PLC e HMI distinti, tab «Rilievi», `rdp-ntlm-info`, ordine dei profili, asse 2 coperto da `http-title` (93, 106, 107, 110, 111, 126).
- WinRM e WMI automatici e diritti (163, 165). OT e 72729 su `main`, ricalcolo unknown→iot (1086, 1087).
- VLAN Comware e HP, matrice, SSH+SNMP, LibreNMS in blocco e automatico (322-327). MikroTik VLAN, 6 su 6 (550).
- «Esci» che chiude davvero, ADR 0033 (340). Tavola di Opzioni pubblicata (449).
- Assegnatari da AD e omonimi in Abbinamenti, prima conferma di Riccardo (369, 370, 371, 373, 389, 399).
- Collector in `dev`, S3, sessione cloud, AOS-CX, giro 5 (515, 798, 799, 800, 801, 1008). Infoblox collaudato (1057, 1058).
- Promote, job di serie sull'hub, `arp_poll` col job 26, `unifi-sync` con IP conteso, native sull'hub (587, 588, 658, 662, 666). LibreNMS acceso sull'hub (616).
- DA-Vul-can: A-Link e inventario, CIDR vero, 8b, 10 (685, 876, 878, 882).

### Superati (21)

- OpenBao e Keeper come archivio (265, 267, 268, 269, 276, 282-289, 294, 295): OpenBao tolto il 02/11, resta KeePass su DA-Link; `vault.domarc.it` ora risolve.
- `/settings/opzioni` su 70151 e hub dopo l'aggiornamento (343, 586), «Reparto» è dato loro (390), coordinamento col piano DADude3 (772), titolo vuoto (715), `upsertSwitchPorts` non è più nella rotta `bulk-scan-devices` (836).

### Doppioni (7)

35 di 14-15, 108 di 103, 109 di 104, 129 di 1088, 636 di 664, 668 di 637, 720 di 663.

## 2026-11-04 — Pagina «Cosa serve» in Active Directory

- [x] Riccardo: schema dei diritti, script e configurazione degli eventi visibili in pagina. Fatto in `/active-directory/cosa-serve`, guardata resa a 1920 e 1280 con dati finti.

## 2026-11-04 — Edge: analisi del 72729 fermata e risultati persi

Trovato sul 72729 (sola lettura): scansione 1, rete 192.168.0.0/24, profilo deep, partita 13:15, fermata alle 21:53 ora italiana dal guardiano (`scansione ferma al 98% da 3 ore`). Greenbone: 0 rapporti, 0 risultati; `cve_findings` 0. Non era bloccata: alle 21:53 era ancora in prova su 192.168.0.218 (stampante Kyocera) e 192.168.0.246 (D-Link), con test web in corso; 94 host su 96 finiti. Il guardiano guarda solo la percentuale. Il log c'è: `/var/log/openvas/openvas.log`, 2 GB in DEBUG.

- [x] Edge, `scan_runner.py`: prima di `delete_task` si salvano i rilievi degli host finiti; gli host a metà si scartano e si nominano nel motivo. Prove: `tests/test_scan_parziali.py`. Da provare su Greenbone vero: `<end>` vuoto sugli host fermati.
- [x] Edge `GET /api/v1/scans?stato=error` e DA-IPAM: fallite col motivo in Impostazioni e nel pannello della rete; con rilievi diventano `parziale` e valgono per host (`vuln_findings_attuali`). Prova: `src/lib/vuln/__tests__/scansioni-fallite.test.ts`.
- [ ] Deploy-Appliance: `openvas.log` in DEBUG cresce di 2 GB a scansione, senza rotazione visibile; con una scansione al giorno va abbassato o ruotato.
- [ ] Edge: il guardiano ferma una scansione che lavora ancora; andrebbe guardata l'attività, non solo la percentuale.
- [ ] Vulcan `analisi-periodiche/selezione.ts`: oggi usa un solo rapporto per rete, l'ultimo del periodo; va fatto per host. Le parziali oggi non vanno all'hub apposta, altrimenti nasconderebbero gli host della scansione completa.
- [ ] Riccardo (04/11): i rilievi del mese si sommano per host; un rilievo si sostituisce solo con quelli nuovi di quello stesso host, così si invia la copia completa anche se alcuni IP non rispondono sempre. Vale anche in DA-IPAM.
- [ ] Riccardo (04/11): potrebbe pianificare una scansione al giorno; i rilievi degli host si sommano finché un rilievo nuovo non li sostituisce, per avere la copertura completa degli IP della subnet.
- [ ] Da capire: `gvmd` «Credential could not be created by admin» alle 14:13 ora italiana del 04/11, stesso minuto del salvataggio della rete 192.168.1.0/24.

## 2026-11-05 — Il profilo non riconosce i prodotti IT (Proxmox, server Windows): buco di regole

Riccardo, provando su `192.168.99.2`: «nmap non ha riconosciuto né proxmox né un server windows e
non ha fornito molte info in più di quelle delle scansioni normali». Letto nel codice; **il suo caso
non l'ho misurato**: `192.168.99.x` non è su nessuno dei tre tenant dell'hub e non so quale
installazione lo censisce (chiesto a Riccardo).

- [x] **Le porte ci sono**: 8006 e 8007 (Proxmox) sono nell'elenco TCP e in `PORTE_TLS`, quindi `ssl-cert` le interroga; 3389, 445, 139 e la UDP 137 pure. Non è un problema di porte non provate
- [x] **Il buco sta nelle regole, non nella raccolta**: in `attribution/profilo-evidence.ts` l'unica tabella di produttori (`PRODUTTORI_NOTI`) è **solo OT** (Siemens, Rockwell, Schneider, Omron, Beckhoff, WAGO…). Un certificato di Proxmox, VMware, Synology, QNAP, HPE o Microsoft non produce nessuna evidenza di produttore. E **nessuno script del profilo emette una categoria** fuori da quelli di campo (`s7-info`, `enip-info`, `bacnet-info`, `omron-info`, `mqtt-subscribe`): `http-title`, `ssl-cert`, `rdp-ntlm-info`, `ldap-rootdse` non dicono «questo è un server», «questo è un hypervisor»
- [x] Quindi: su un **Proxmox** il profilo raccoglie il certificato della 8006 e il titolo della pagina, li mostra nella tab «Rilievi» e non ne ricava né produttore né categoria — il riconoscimento di Proxmox oggi vive altrove (il collector con le credenziali dell'API). Su un **server Windows** l'OS diventa `windows` (via `rdp-ntlm-info`/`smb-os-discovery`), ma la **categoria** «server» non la propone nessuno script del profilo: arriva da AD, dalle porte o da Wazuh
- [x] Ed è anche la risposta a «non molte info in più»: il profilo aggiunge dove uno script risponde **e** dove una regola sa leggerlo. Oggi la seconda metà esiste solo per il mondo OT
- [x] **Misurato su 79993-ipam-2** (`192.168.99.2`, VM 963 sul Proxmox **PX-NAS** `192.168.99.1`, entrata da lì; 0.9.972, 69 host, 81 rilievi su 16 host). Il risultato cambia la diagnosi di prima, in meglio:
  - **Il Proxmox è `192.168.99.1`**, classe `unknown`, nessuna famiglia OS. Del profilo hanno risposto **3 script, tutti sulla 8008** (`http-title` «ProxMenux Monitor», `http-favicon`, `http-headers` con `Server: Werkzeug/Python`): niente sulla 8006, che risulta aperta ma senza output di script. **Però in `open_ports` c'è già la riga che lo dice**: porta 3128, `service: http`, **`version: "Proxmox Virtual Environment REST API 3.0"`**
  - **Il server Windows è `192.168.99.71` `RGSERVER`**, classe `vm`, nessuna famiglia, `os_info` vuoto, **0 rilievi** — il profilo non ci è mai girato. E anche qui la risposta è già in archivio dalla scansione normale: porta 135 `version: "Microsoft Windows RPC"`, porta 139 `"Microsoft Windows netbios-ssn"`, più 445 e 3389 aperte
- [x] **Causa comune, e non è quella che avevo scritto**: le stringhe di versione dei servizi che `-sV` produce (`open_ports[].version`) **non vengono lette da nessuno** per riconoscere prodotto o sistema operativo. L'emettitore `nmap_os` guarda solo `hosts.os_info`; l'emettitore delle porte guarda solo i **numeri** di porta (`categoryFromLegacyText`), non le versioni. Quindi un host che dice di sé «Microsoft Windows RPC» o «Proxmox Virtual Environment REST API 3.0» resta senza OS e senza categoria
- [x] Quanto vale, misurato: fra gli host **senza** famiglia OS, le versioni delle porte nominano il prodotto su **6 host dell'hub** (Proxmox) e **2 di 79993-ipam-2** (1 Proxmox, 1 Windows). Pochi in numero, ma sono proprio i nodi che contano — e la regola prenderebbe anche tutti i futuri, oltre a «HP ETHERNET MULTI-ENVIRONMENT», «RouterOS», «OpenSSH … Debian»
- [x] **Fatto, col sì di Riccardo** (05/11): `prodottoDaVersione` in `emitters.ts` — tabella dichiarativa di 11 prodotti letti dalla stringa di versione (`open_ports[].version`), che emette `vendor`, `category` e `os` con la sorgente `nmap_service`, prendendo la prima porta che nomina un prodotto noto; peso `nmap_service` 0.5 → **0.85** (0.68, sopra soglia) perché altrimenti la regola nasceva inerte, come era quasi successo con `nmap_os`. 8 prove nuove con le stringhe **vere** di 79993-ipam-2 (PX-NAS `192.168.99.1` porta 3128 e `192.168.99.71` porta 135), 4 viste fallire rompendo la lettura e il peso; 371 prove dell'attribuzione verdi
- [ ] Rimandato, come previsto: la tabella per i **titoli web** e i **certificati** (il «ProxMenux Monitor» sulla 8008 e il CN della 8006 restano non letti)
- [x] **Promossa su `main` col sì di Riccardo** (05/11): `origin/main` = `origin/dev` = `74f4a61b` = **0.9.973**, fast-forward verificato con `git ls-remote`. Watcher in sottofondo su hub (VM 533), 70151, 72729 e 79993-ipam-2 (`/api/health`, versione e uptime)
- [x] **Verificato sul campo la mattina del 05/11, e la previsione è centrata.** Le quattro installazioni (hub VM 533, 70151, 72729, 79993-ipam-2) sono sulla **0.9.973** con uptime fresco. Sull'hub, dove le scansioni pianificate hanno ricalcolato da sole: host con famiglia OS da **91 a 122 (+31, esattamente i 31 previsti)**, host con categoria 229, `unknown` 94. Evidenze `nmap_service` nuove: **36 su 18 host**. I nodi Proxmox (`DA-PX-01`…`05`, `192.168.16.1`, `.16.3`, `192.168.4.188`) sono ora `hypervisor` / `compute.hypervisor`
- [x] Da sapere: su quei nodi `attr_vendor` resta il **produttore dell'hardware** letto dall'OUI (`shenzhen-meigao…`), non «proxmox» — l'OUI pesa 0.9 e batte `nmap_service` 0.85. È difendibile (la scatola è quella, Proxmox è il software) e la **categoria**, che è quello che conta per la classificazione, arriva giusta
- [x] **Riccardo ha applicato «Attribuzione» su 79993-ipam-2 (05/11) e ha funzionato**: **PX-NAS `192.168.99.1` da `unknown` a `hypervisor`** / `compute.hypervisor` con produttore `proxmox` fra le evidenze, e **`192.168.99.71` RGSERVER ha preso `attr_os_family = windows`** (prima vuoto). Evidenze `nmap_service` in tutto 14: 5 router MikroTik (produttore + categoria), 1 hypervisor Proxmox, 1 windows, 1 network-os. Totali di quell'installazione: 69 host, 8 con famiglia OS, 16 con categoria, 52 `unknown`
- [x] **Limite trovato proprio da questa verifica**: PX-NAS ha la categoria ma **non** la famiglia OS, e la colpa è di come ho scritto la regola — si fermo alla **prima** porta che nomina un prodotto noto (`break`), quindi legge la 3128 «Proxmox Virtual Environment» e non torna sulla 22, dove c'è «OpenSSH 10.0p2 Debian» che darebbe `linux`. Il sistema operativo va ricavato da **tutte** le versioni, indipendentemente dal prodotto riconosciuto: poche righe, ma va fatto e provato — **fatto 05/11**: produttore e categoria dalla prima porta con un prodotto, famiglia da tutte (prima l'OS dichiarato da un prodotto, poi il banner a confidenza 0.7). Verifica: `node --import tsx --test src/lib/attribution/__tests__/prodotto-da-versione.test.ts` → 16/16, con la prova di PX-NAS vista fallire prima del fix; `npm test` 7194/7198 (le tre note).
- [x] **Deciso da Riccardo (05/11): `network-os`.** Un MikroTik col banner «Linux telnetd» prendeva `linux` (la voce `mikrotik` della tabella dei prodotti non dichiara un OS, quindi si cade sul banner). È letteralmente ciò che l'apparato dice e vale più di una cella vuota, ma se si preferisce `network-os` basta aggiungere `os: "network-os"` alla voce `mikrotik` in `emitters.ts`. Riguarda `192.168.40.165/167/168` e `192.168.4.171` dell'hub — **fatto**: `os: "network-os"` nella voce `mikrotik` di `emitters.ts`. I quattro router dicono «MikroTik router ftpd 7.22» sulla 21, quindi il ramo del prodotto dichiarato vince sul banner della 23. Verifica: prova vista fallire prima del fix; cancello nel worktree pulito con esito 0 (tsc 0, lint 0 errori, 7215 prove, **0 rosse** — le due che pretendono `data/ipam.db` assente erano ambientali). Un router Linux che non nomina MikroTik resta `linux`, con la sua prova.
- [ ] Da misurare quando Riccardo dice dove gira l'IPAM di `192.168.99.x`: quali script hanno risposto su `.2`, se `-O` ha avuto i privilegi (senza root degrada e lo scrive nel registro) e cosa è finito in `host_profilo_rilievi`

## 2026-11-05 — L'OS trovato da nmap non arriva alle tabelle (difetto, causa misurata)

Riccardo: «il detect dei sistemi operativi del nmap aggiuntivo non riporta alcun dato alle tabelle
delle subnet; esiste un pulsante per riclassificare, ma evidentemente non fa nulla». Misurato sul
72729 (sola lettura), dove nel frattempo il profilo è girato su **19 host**.

- [x] **`-O` funziona e il dato è buono**: `hosts.os_info` è pieno su **17 host su 19** con valori veri — `Linux 2.6.32`, `Linux 3.2 - 3.8` (×3), `Linux 4.15 - 5.19` (×2), `Linux 4.19 - 5.15`, `OpenWrt 19.07 (Linux 4.14)`, `HP iLO 4 or iLO 5 remote management interface`, `EPSON Built-in Print Server`, `Crestron XPanel control system`, `Windows Server 2022 Standard` (×4). Quindi il detect non è rotto
- [x] **La tabella della subnet non mostra `os_info`**: mostra `attr_vendor_name`/`attr_vendor` · **`attr_os_family`** (`networks/[id]/network-detail-client.tsx:1665`), cioè l'OS **dell'attribuzione**. E `attr_os_family` è pieno su **5 host su 19**: solo i Windows. Tutti i 14 Linux/iLO/stampante/Crestron hanno l'OS in archivio e la cella vuota
- [x] **Causa**: in `attribution/profilo-evidence.ts` l'evidenza di dimensione `os` nasce **solo** da `rdp-ntlm-info` (0.9), `smb-os-discovery` (0.85) e `nbstat` (0.45). L'osmatch di `-O` (`NmapResult.os`, che `fattiDaRisultato` usa come ripiego per `os_info`) **non diventa un'evidenza**, e nemmeno `snmp-sysdescr` o il nuovo `vmware-version`. L'attribuzione non sa niente di quello che nmap ha visto
- [x] **Il pulsante «Attribuzione» non è rotto, è a vuoto**: apre l'anteprima di `POST /api/attribution/recompute {preview:true}` e applica le evidenze **esistenti**. Il profilo chiama già `recomputeAttributionSafe` quando salva, quindi a mano non c'è più niente da proporre: senza evidenze nuove di OS il ricalcolo è idempotente e l'utente lo legge come «non fa nulla». Due cose diverse da sistemare: l'evidenza che manca e il fatto che il pulsante non dica «niente da proporre»
- [x] **Causa vera, diversa da quella che avevo detto**: l'evidenza **c'è** (`nmap_os`, dimensione `os`, confidenza 0.7 — sul 72729 9 claim `linux`, 22 `windows`; l'emettitore è in `emitters.ts:294`, legge `hosts.os_info`). Il problema è l'aritmetica del motore: peso `nmap_os` **0.5** × confidenza 0.7 = **0.35**, contro `MIN_CLAIM_SCORE` **0.56**. Da sola quell'evidenza **non poteva mai** vincere, nemmeno con confidenza 1 (0.5 < 0.56): ecco perché i Windows (smb 0.675, rdp_ntlm 0.81, ad 0.95) avevano la famiglia e i Linux no
- [x] **Fatto, col sì di Riccardo** (05/11): peso `nmap_os` 0.5 → **0.85** (punteggio 0.595, sotto smb/rdp/ad: se SMB dice windows e nmap linux, vince windows). **Trappola presa da una prova**: 0.8 non bastava, perché `0.8 * 0.7` in virgola mobile fa 0.5599999999999999, cioè sotto soglia
- [x] ESXi riconosciuto come famiglia (`osFamilyFromText`), OS **grezzo** mostrato nella lista della subnet quando la famiglia non c'è, colonna «OS» visibile di serie in Discovery, e la finestra «Attribuzione» spiega perché non propone niente
- [x] 7 prove nuove in `attribution/__tests__/os-da-nmap.test.ts` (due viste fallire per la virgola mobile, prima del fix); 362 prove dell'attribuzione tutte verdi
- [x] **Difetto mio trovato dal cancello**: la prova del censimento delle rotte voleva `requireAdmin` su `POST /api/hosts/conferma-rivisti`, che nella 0.9.970 era uscita con `requireAuth` — quindi la conferma in blocco era aperta a tutti gli utenti. Alzata ad admin e il bottone in Discovery ora si vede solo agli admin, come gli altri della barra. **La 0.9.970 ha quel difetto**: sistemato in questo rilascio
- [x] **Il fix era inerte, trovato prima di promuovere**: `recordEvidence` quando rivede un'evidenza identica fa un `refresh` che aggiornava solo `observed_at`, `confidence` e `expires_at` — **non il peso**. Il peso vive nella riga come copia di `ATTR_SOURCE_WEIGHTS`, quindi tutte le righe `nmap_os` già in archivio avrebbero tenuto 0.5 per sempre e la 0.9.971 non avrebbe cambiato niente sugli host già scansionati. Ora il refresh riscrive il peso dalla tabella delle sorgenti; prova in `evidence.test.ts`, vista fallire
- [x] **0.9.972 in esercizio** (05/11 ~02:4x): hub (segue dev) e le due appliance 70151 e 72729 sulla 0.9.972, salute ok, verificate dal riavvio
- [ ] **La previsione non è ancora verificabile, e il perché è il meccanismo stesso**: il peso si riscrive quando l'evidenza viene **rivista**, cioè al prossimo ricalcolo (una scansione, oppure il pulsante «Attribuzione» su una subnet). Misurato adesso sull'hub: 378 host, 91 con famiglia, **31 in attesa**, e le 129 righe `nmap_os` hanno ancora `weight 0.5`. Le scansioni pianificate le aggiorneranno da sole host per host; per vederlo subito basta premere «Attribuzione» su una subnet
- [ ] Da misurare col fix: quanti dei 14 host senza `attr_os_family` la prendono, e quanti restano senza perché la stringa non è una famiglia nota

## 2026-11-05 — Aggiornatore delle sonde: bersaglio «almeno questa versione»

Riccardo (05/11) ha chiesto di scrivere il miglioramento proposto a fine sessione.

- [ ] Oggi `aggiorna-sonda.sh` accetta **un numero esatto** (`versione_desiderata`): con `SOLO_SU_COMANDO=1` sulle appliance, se fra il comando e il giro del timer l'hub pubblica una versione nuova, la sonda scrive «si aspetta che l'hub la pubblichi» e **resta ferma**. È successo **due volte** col 72729 il 04/11 (fissata 0.8.235 mentre l'hub era già alla 0.8.236, poi 0.8.236 contro 0.8.237); l'hub serve solo il tarball della versione in esecuzione, quindi una fissata vecchia è morta
- [ ] Proposta: un bersaglio del tipo **«almeno questa versione»** (o un `segue_hub` che valga anche con `SOLO_SU_COMANDO=1`, una volta dato il comando), così l'aggiornamento di una sonda non dipende dalla fretta di chi rilascia. Il codice sta in **DA-Vul-can** (`infra/scanner-edge/scripts/aggiorna-sonda.sh`, condizione a riga 478) e la versione la scrive DA-Link (`PUT /api/edge-bridges/kit/versione`): riga gemella nel TASKS di DA-Vul-can

## 2026-11-05 — Chiusura della sessione «profili di scansione»

Consuntivo nel piano [`plans/2026-11-04-profili-di-scansione.md`](docs/superpowers/plans/2026-11-04-profili-di-scansione.md),
sezione «Consuntivo della tappa 2»; **Stato: completato**. `main` = `dev` = **0.9.970**, appliance
70151 e 72729 verificate dal riavvio. «Ripartenza» in `CONTEXT.md`, `prossimo` nella scheda-mappa.

Resta aperto, in ordine di chi lo deve fare:

- [ ] **Riccardo**: lanciare dall'interfaccia del 72729 il profilo (Approfondito + IoT/OT) su un **campione di 5 host** fra `hmi` e `unknown` con porte aperte. Poi si misura e si decide il giro sui ~64 indecisi
- [ ] **Da guardare a schermo**: tab «Rilievi» e colonna «Da rivedere» (nessuno le ha ancora viste rese; verificate da tsc, build e prove)
- [ ] Banner web (`http-server-header`, `http-headers`, `banner`) come tappa a sé: stringhe da normalizzare
- [ ] Le due prove che pretendono `data/ipam.db` assente senza prepararselo (lezione #8): il cancello pieno ha due rosse che non dipendono dal codice
- [ ] Costo per host del profilo con `--version-intensity 7`: mai misurato
- [ ] Script di campo (`s7-info`, `enip-info`, `bacnet-info`, `omron-info`) provati solo su fixture: nessun PLC raggiungibile, la rete di impianto del 72729 (192.168.2.0/24) ha 0 host
- [ ] Rilievi **grezzi** senza pagina: rimandato
- [ ] Lato DA-Vul-can (non qui): il guardiano ferma scansioni ancora attive; `openvas.log` in DEBUG cresce di 2 GB a scansione; valutare un bersaglio «almeno questa versione» per l'aggiornatore delle sonde

## 2026-11-05 — Valutazione: popolare la tabella degli IP e quella degli apparati

Riccardo: «andrebbe valutato come usare i dati acquisiti per popolare la tabella degli ip e dei
devices». Valutazione scritta, niente codice: [`docs/revisione/2026-11-05-popolare-ip-e-apparati-dai-profili.md`](docs/revisione/2026-11-05-popolare-ip-e-apparati-dai-profili.md).

- [x] Misurato sul 72729: `hosts` 132 righe con `model` 14, `serial_number` 11, `firmware` 6, `hostname` e `os_info` 46; apparati 22 con `model` 11, `serial_number` 10, `firmware` 8. Classi: 45 `unknown`, 18 `iot`, 18 `workstation`, 11 `hmi`, 8 `rete_ot`
- [x] **Causa principale trovata**: fra `unknown`, `iot`, `workstation`, `hmi` e `rete_ot` i rilievi sono **zero** — il profilo è girato solo sui 13 host scelti a mano (10 server, hypervisor, NAS, VoIP), mentre 17 dei 45 `unknown` e **11 HMI su 11** hanno porte aperte e nessuno li ha interrogati. Nessuna lettura migliore riempie le colonne finché il giro non punta lì
- [x] Secondo buco: la lettura lascia fuori `snmp-info`, `vmware-version`, `ldap-rootdse` (e 12 altri tipi) — sono quelli che porterebbero modello e firmware di NAS, ESXi/vCenter e DC
- [x] Terzo buco: in `src/lib/scanner/profili/` **non c'è un riferimento a `network_devices`**: ciò che il profilo legge non arriva mai all'apparato
- [x] **Decisioni di Riccardo (05/11, chieste una alla volta)**: (1) prima un **campione** di 5 host fra HMI e `unknown`, il giro largo dopo con la misura in mano; (2) sugli apparati **si popola quanto è vuoto** senza chiedere, più un modo di vedere i dati **senza passare dalla scheda** («anche solo un campo in tabella che dice che è richiesta una revisione»); (3) il segno «da rivedere» va **in Discovery**, colonna + filtro + conferma in blocco; (4) si leggono **tutti e tre** gli script: `snmp-info`, `vmware-version`, `ldap-rootdse`
- [x] Riccardo: «sì, parti». **Passi 2-5 fatti** (livello leggero):
  - `lettura.ts`: casi `snmp-info`, `vmware-version`, `ldap-rootdse` + `testo()` che decodifica le entità XML (`&#xa;`), che sistema anche `snmp-sysdescr` e `upnp-info`; ordine di affidabilità aggiornato (`ssl-cert` prima di `snmp-info`, `vmware-version` prima del certificato). 13 prove su fixture **vere** del 72729, viste fallire (5 rosse rompendo la decodifica e il freno sul seriale)
  - `propaga-apparato.ts` (nuovo): propagazione all'apparato delle sole colonne vuote, `serialePropagabile`, `segnaDaRivedere`, `togliDaRivedere`, `soloProva` per la prova a vuoto. 10 prove su DB in memoria, viste fallire (2 rosse togliendo i due freni)
  - `db-tenant-schema.ts`: `campi_da_rivedere` su `hosts` e `network_devices`, additiva e ripetibile, chiamata dove gira già la migrazione delle credenziali
  - Discovery: colonna «Da rivedere» (visibile di serie, in fondo alle 19 di prima), chip col conteggio vero, conferma in blocco; rotta `POST /api/hosts/conferma-rivisti`
- [x] **Prova a vuoto sul 72729** (sola lettura, prima di scrivere niente): su 22 apparati con host, si riempirebbero **3 modelli e 1 seriale**, 0 firmware
- [x] Cancello: lint 0, tsc 0, build 0, prove 7148/7153. Le 2 rosse sono **la coppia fragile già nota** (`data/ipam.db` che `npm test` ricrea): spostato il file, le due prove da sole fanno 14/14
- [x] **Promossa su `main` col sì di Riccardo** (05/11): fast-forward `git push origin origin/dev:main`, `origin/main` = `origin/dev` = `a0234549` = **0.9.970**, verificato con `git ls-remote`. Il delta su main era un solo commit di codice (il mio) più i documenti; le appliance 70151 e 72729 erano sulla 0.9.969 e la prendono col loro timer entro ~15 min. Watcher in sottofondo che guarda `/api/health` (versione **e** uptime: `/api/version` cambia col pull, non col riavvio)
- [x] **Appliance aggiornate e verificate dal riavvio** (05/11 01:25): 72729 e 70151 entrambe sulla **0.9.970** con uptime fresco (473 s e 186 s), `db ok`, credenziali leggibili (9 e 15), scheduler senza job in ritardo, 0 ripieghi (il 72729 ne dichiarava 35 prima del riavvio). Durante il riavvio della 70151 una lettura è risultata illeggibile: il servizio era giù, non è un guasto
- [x] **Migrazione verificata sul campo**: sul 72729 le due colonne `campi_da_rivedere` ci sono (`hosts` e `network_devices`), 0 righe segnate — giusto così, nessun profilo è girato dopo l'aggiornamento
- [ ] **Resa non vista a schermo**: la colonna e la chip sono verificate da tsc e dal build, non da un browser — in locale non ho un accesso all'app e sul 72729 sto in sola lettura. Da guardare al primo accesso di Riccardo

- [ ] Il campione **lo deve lanciare Riccardo** dall'interfaccia del 72729: lì sono in sola lettura e non ho un accesso all'app

## 2026-11-05 — I dati dei profili: riconosciuti, memorizzati, mostrati, usati?

Riccardo: «non ho capito se i dati rilevati dalle scansioni di nmap più specifiche vengono
riconosciute memorizzate, visualizzate e utilizzate per determinare le categorie». Misurato sui
dati veri del 72729 (profilo girato il 04/11: approfondito 17:07, IoT/OT 16:51), non sul codice.

- [x] **Memorizzati: sì.** 105 righe in `host_profilo_rilievi` su 13 host, più le colonne vuote degli host riempite: 12 `hostname`, 12 `os_info`, 13 `device_manufacturer`. Zero `model`, `serial_number`, `firmware` — perché nessuno degli script che li porterebbero è letto (vedi sotto)
- [x] **Mostrati: sì, verificato facendo girare la lettura vera sui dati veri** (`campiDaRilievi` su un export delle 105 righe, `scratchpad/prova-tabella.ts`): **13 host su 13** hanno almeno un campo. Esempi: `Windows build 10.0.20348` + FQDN + dominio `sanfrancesco.local` + NetBIOS da `rdp-ntlm-info`; produttore `VMware` e nome `vcenter01…` da `ssl-cert`; `Hewlett Packard Enterprise` + `ILOCZJ2291NHC` (iLO) e due impronte SSH; `TS-231K` (QNAP) da `nbstat`. La resa a schermo resta non vista, ma il contenuto della tabella è questo
- [x] **Riconosciuti: solo in parte, ed è il buco vero.** `fattiDaScript` conosce **15 script**; nel giro del 72729 hanno risposto 18 tipi diversi e **15 tipi non danno nessun campo**: `http-headers` (15 host), `http-server-header` (10), `fingerprint-strings` (7), `banner` (6), `smb2-security-mode` e `smb2-time` (5), `ldap-rootdse` e `ntp-info` (3), `http-favicon` e **`snmp-info`** (2), `rpcinfo`, **`vmware-version`** (1). Il grezzo è salvato, nessuno lo legge: la lettura ha il caso `snmp-sysdescr`, non `snmp-info`
- [x] **Usati per la categoria: sì, dimostrato su due host.** `host_classification_history` dei host 46 e 49 (`192.168.0.106` e `.105`): alle 09:40 niente, alle 11:17 solo vendor `microchip-technology` dall'OUI con **categoria vuota e confidenza 0**, alle **16:51:22 categoria `ot` con confidenza 66** grazie all'evidenza `ot_probe` (porta 502 aperta, nessuno script di campo che risponda). È il caso dell'OUI ambiguo scritto in CONTEXT: il vendor non classifica, le porte sì
- [x] Però **solo `ot_probe` porta una categoria**: delle 19 evidenze della fase `scan_profilo`, `rdp_ntlm` (5) e `netbios` (6) sono di dimensione `os` (windows, confidenza 0.9 e 0.45) e `tls_cert` (6) di dimensione `vendor` (vmware ×5, hpe ×1). Utili, ma non decidono una categoria: i 13 host coi rilievi restano classificati server (10), hypervisor, nas e voip da altre fonti
- [ ] Proposta (non fatta, serve il sì): leggere in `fattiDaScript` anche `snmp-info`, `vmware-version` e `ldap-rootdse`. Sono i tre che oggi buttiamo e che porterebbero modello, firmware e sistema operativo del NAS, dell'ESXi/vCenter e dei domain controller — le tre colonne che sui 13 host sono rimaste vuote

## 2026-11-04 — Perche' l'Edge del 72729 non carica niente in IPAM (causa trovata)

Riccardo: «sì, indaga». Misurato dentro l'appliance (dal Proxmox, `qm guest exec 100`) e dentro il
contenitore `appliance-edge` (0.8.234). **Non è un difetto di DA-IPAM**: la sincronizzazione è sana
(ultimo giro 04/11 21:30, nessun errore). I dati non ci sono a monte, per due motivi indipendenti.

- [x] **La sonda ha un solo giro e è fallito.** `scans` ha 1 riga: rete 1 (192.168.0.0/24), profilo `deep`, partita 04/11 12:15:40, chiusa 20:53:42, `status=error`, motivo «scansione ferma al 98% da 3 ore: fermata». Nel suo DB: `cve_findings` 0, `rilievi_controlli` 0, `assessment_runs` 0, tutti i moduli a 0 — `network_hosts` 110 e `arp_results` 118, quindi la rete l'ha vista, i rilievi no
- [x] **Causa A (sonda): i risultati degli host finiti si buttano.** In `scan_runner.py` della versione installata ci sono tre `delete_task` e **nessun salvataggio parziale** (nessun riferimento a parziale/host finiti). Fermato il giro, il task GVM è cancellato e con lui i rilievi dei 94 host su 96 che erano già passati. Il fix è quello già scritto dall'altra sessione, **non ancora su questa appliance**
- [x] **Causa B (sonda vecchia): IPAM non può nemmeno mostrare il giro fallito.** `GET /api/v1/scans` della 0.8.234 ha `where = ["status = 'done'"]` scritto fisso e **nessun parametro `stato`**. DA-IPAM 0.9.967 le chiede già le fallite (`listScans(scanner, undefined, "error")` in `sync-job.ts`), la sonda ignora il parametro e rimanda solo le riuscite, il filtro `s.status === "error"` svuota la lista e **non si inserisce niente**: ecco perché `vuln_scan_runs` è 0 invece di avere un giro fallito col motivo. Il lato IPAM è pronto e rilasciato; va aggiornata la sonda
- [x] Riccardo (04/11): «sì, aggiorna» la sonda. **Misurato: non si può aggiornare solo quella sonda.** Il tarball della sonda lo costruisce l'hub DA-Vul-can «una volta per versione e commit» (`src/lib/scanner-edge/artefatto.ts`), quindi la sonda prende il codice nuovo solo dopo un **rilascio dell'hub**. Sull'appliance del 72729 non serve toccare niente: il timer `da-aggiorna-sonda.timer` gira ogni ~15 minuti (ultimo 22:02 UTC) verso `https://da-vulcan.domarc.it` e se lo prende da solo
- [x] **Il blocco è a monte**: in `~/Progetti/Domarc/DA-Vul-can` il fix c'è ed è committato (`8fe5a6a9` «una scansione fermata non perde i rilievi fatti», più `a50ba540`, `99b712ad`, `34b5de14`), ma `main` è **21 commit avanti a origin/main**, senza commit `release:` dopo la 0.8.234, e quei 21 commit non sono solo la sonda (analisi periodiche, parziali verso Vulcan, documenti). Pubblicare vuol dire `scripts/deploy.sh --applica` sul live (VM 664 su DA-PX-03) e cambia la sonda di **tutti** i clienti: non l'ho fatto, è lavoro di un'altra sessione e va deciso da Riccardo
- [!] Riccardo (04/11 23:0x): «sì, pubblica». **Rilascio NON fatto**: alle 23:16, mentre preparavo il bump, l'altra sessione ha ripreso a scrivere in DA-Vul-can — 10 file modificati, fra cui **`scan_runner.py` stesso** (una riga in volo) e le prove delle analisi periodiche. `deploy.sh` rifiuta un albero sporco, e pubblicare un file a metà modifica sarebbe peggio del difetto. Fatto solo lo **snapshot** `pre-rilascio-sonda-20261104` della VM **664** sul nodo **DA-PX-03** (ok di Riccardo), che resta pronto per il rilascio vero
- [x] Chiesto il rilascio alla sessione che ci sta lavorando («Password non funziona su 72279», `local_fdc60f71`), col sì di Riccardo: messaggio con i numeri misurati, i quattro commit del fix, lo snapshot già pronto e l'avvertenza di usare `version:release --staged-only` (albero condiviso). Quando esce, qui si controlla che la sonda del 72729 sia salita e che `GET /api/v1/scans?stato=error` risponda
- [x] Rilascio uscito (l'altra sessione): **DA-Vul-can 0.8.235**, commit `68588621`, attiva sul live, `ready=200`, snapshot `pre-rilascio-sonda-20261104` usato. I rilievi della scansione 1 restano persi: quel giro finì prima del fix
- [!] **La sonda del 72729 NON si aggiorna da sola — mio errore dirlo prima.** Il suo `da-aggiorna-sonda.service` ha `Environment=SOLO_SU_COMANDO=1` e il journal lo scrive chiaro (22:31:41 e 22:45:52 UTC): «manifesto: versione 0.8.235 · in esecuzione: 0.8.234 · bersaglio: 0.8.235 (segue l'hub)» e poi «**nessuna versione chiesta da DA-Link: resto alla 0.8.234**». In `aggiorna-sonda.sh:478` la condizione è `[ -z "$DESIDERATA" ] && [ "$SOLO_SU_COMANDO" = 1 ]`, e il commento in testa dice perché: «appliance, Riccardo 29/10: comandata da DA-Link». Vede il manifesto, lo verifica, e sta ferma per scelta
- [x] **Fissata col sì di Riccardo** (05/11, ~00:1x): `PUT /api/edge-bridges/kit/versione` sull'hub, chiamata **da DA-Link** con la sua chiave del kit (`DALINK_HUB_KIT_CHIAVE` letta dall'env sul posto e passata a curl con `-K -`, mai in argomento), bridge **42** `72729-ipam` codcli 72729 → `{"ok":true,"modo":"fissata"}`
  - **Trappola trovata subito**: avevo fissato 0.8.235, ma nel frattempo l'hub era già alla **0.8.236** (l'altra sessione ha rilasciato di nuovo) e l'hub serve solo il tarball della versione in esecuzione: una fissata più vecchia di quella pubblicata fa aspettare la sonda **per sempre** («si aspetta che l'hub la pubblichi»). Corretto subito a **0.8.236**, che contiene gli stessi quattro commit del fix
- [!] **La sonda ha mancato due volte: i rilasci corrono più del suo timer.** Journal: 23:01 «nessuna versione chiesta» (la fissata non era ancora arrivata), 23:15 «bersaglio 0.8.236 (fissata da DA-Link)» ma «l'hub pubblica 0.8.237 … si aspetta che l'hub la pubblichi» → resta alla 0.8.234. L'hub serve solo il tarball della versione in esecuzione, quindi una fissata di dieci minuti prima è già morta: fra 23:00 e 23:16 sono uscite 0.8.236 e 0.8.237, da altre sessioni
- [x] Fissata **0.8.237** (quella pubblicata adesso) e chiesto alla sessione che rilasciava di fermarsi: ha risposto che stanotte non ne fa altri e che la 0.8.237 contiene già il suo lavoro (la 0.8.236 e la 0.8.237 sono di altre sessioni). Watcher in sottofondo che accetta qualunque versione ≥ 0.8.235, perché il fix è in tutte
- [x] **Sonda salita: 0.8.237** (04/11 23:33:18Z, un tentativo, `esito: riuscito`, hub ok). Il fix del salvataggio parziale è ora in esercizio sul 72729
- [x] **Catena chiusa e verificata (05/11, 01:03)**: dopo l'aggiornamento della sonda alla 0.8.237, il `vuln_sync` delle 00:00Z ha portato in IPAM il giro fallito — `vuln_scan_runs` id 1, `edge_scan_id` 1, `status=error`, motivo «scansione ferma al 98% da 3 ore: fermata», finito 04/11 20:53:42, `finding_count` 0. Prima non c'era nessuna riga. I rilievi di quel giro restano persi (fermato prima del fix): quello che si recupera è la visibilità del fallimento
- [ ] Da sapere per la prossima volta: con `SOLO_SU_COMANDO=1` la versione si fissa **quando i rilasci sono fermi**, altrimenti si inseguono. Sull'appliance non si può chiudere la corsa a mano (sola lettura, regola di Riccardo): l'alternativa sarebbe un bersaglio «≥ versione» invece di un numero esatto, oggi non previsto
- [ ] Dopo l'aggiornamento resta da verificare in IPAM: il giro fallito deve comparire in `vuln_scan_runs` col motivo «scansione ferma al 98% da 3 ore: fermata» (job `vuln_sync`, ogni 30 minuti, ultimo 22:00 UTC)
- [ ] Da fare (lato Edge, non qui): portare la sonda del 72729 alla versione col salvataggio parziale e col filtro `stato`. Finché resta alla 0.8.234, ogni giro fermato dal guardiano sparisce senza lasciare traccia in IPAM
- [ ] Resta aperto dall'altra sessione: il guardiano ferma un giro che sta ancora lavorando (alle 20:53 erano in prova 2 host su 96) e `openvas.log` in DEBUG cresce di 2 GB a scansione

## 2026-11-04 — Quattro domande di Riccardo: dove finiscono i dati

Misurato sull'hub (VM 533, tenant `70791`, letture in sola lettura via ssh) e letto nel codice. **Il 72729 non è stato misurato**: la sua appliance (VM `192.168.40.9`, peer NetBird `72729-ipam`) risponde su HTTPS (0.9.967, salute ok, 9 credenziali, **35 ripieghi**) ma non accetta nessuna chiave ssh nostra, e la credenziale sta nel KeePass di DA-Link: chiesta a Riccardo.

- [x] **I rilievi dell'Edge arrivano in IPAM** (hub, 04/11): 13.176 rilievi attuali — Greenbone 11.085 su 276 IP, **controlli dei moduli edge 1.974 su 131 IP**, Nuclei 117 su 49 IP; ultimo 03/11. 98 giri in `vuln_scan_runs`; sul giro 124 `finding_count` 2402 = righe in archivio 2402, quindi il disallineamento del conteggio è rientrato con la 0.9.966
- [x] **I rilievi dei profili nmap**: `host_profilo_rilievi` (grezzo per script: `elems_json` + `output`), le colonne vuote di `hosts` (`hostname`, `os_info`, `model`, `serial_number`, `firmware`, `device_manufacturer`, solo se vuote) e le evidenze dell'attribuzione v2 (`ot_probe`, `rdp_ntlm`), che poi rifondono la classe. Leggibili nella tab «Rilievi». **Sull'hub ci sono 0 righe**: il profilo non è ancora girato lì
- [x] **I dati escono verso DA-Vul-can** (hub): `vulcan_coda` 17 righe, **tutte `inviato`** — 16 inventari (dal 22/10 al 04/11 02:00:14) e 1 ad-health, 0 tentativi falliti, nessun errore. `VULCAN_URL=https://da-vulcan.domarc.it` e `VULCAN_TOKEN` valorizzati in `/etc/dalink/oggetto.env`
- [x] **Diritti da configurare in AD**: scritti una volta sola in `src/lib/credentials/diritti.ts` (`DIRITTI`, `FAMIGLIE_DIRITTI`, `REGOLE_DIRITTI`, `REGOLA_ACCOUNT_SEPARATI`) e mostrati nella pagina Credenziali (`diritti-account.tsx`), nella guida AD, in quella WinRM e in quella dell'audit DC. Il **controllo** di cosa può l'account (`controllo-account.ts`) non salva nulla: è a richiesta. Di persistente ci sono gli esiti dei tentativi (`accesso_windows_esiti`: host, voce, strada, motivo, quando) e `host_credentials.motivo`
- [x] **Misurato sul 72729** (04/11 sera). Si entra **dal Proxmox del cliente**: `ssh root@72729-pve.netbird.selfhosted` accetta la nostra chiave, l'appliance no; VM **100** `72729-ipam`, comandi con `qm guest exec 100` (guest agent attivo). Un'installazione = un cliente, quindi il DB è `DEFAULT.db`
  - **Rilievi dei profili: ci sono.** 105 righe su 13 host, profilo `approfondito`, girato il **04/11 alle 17:07**; 18 script distinti (http-headers e http-title 15, ssl-cert 14, http-server-header 10, fingerprint-strings 7, banner e nbstat 6, rdp-ntlm-info e smb2-* 5, ssh-hostkey 4, ldap-rootdse e ntp-info 3, http-favicon e snmp-info 2, rpcinfo/upnp-info/vmware-version 1). Sui 13 host: 12 col nome, 12 col sistema operativo, 13 col produttore; 0 modello, 0 seriale, 0 firmware (sono host Windows e web, non apparati di campo)
  - **Il profilo IoT/OT ha girato alle 16:51** e ha prodotto 2 evidenze `ot_probe`: `192.168.0.105` e `192.168.0.106`, **porta 502 (Modbus) aperta e nessuno script di campo che risponda**, confidenza 0.70, classe risultante `rete_ot`. Più 5 evidenze `rdp_ntlm` alle 17:07
  - **L'Edge non ha caricato niente in IPAM**: `vuln_scan_runs` 0 e `vuln_findings` 0, pur con la sonda 4 `72729-ipam` (`http://127.0.0.1:8080`) accesa e l'ultima sincronizzazione del 04/11 alle 21:30 **senza errore**. Coerente con la scansione fermata dal guardiano e con gli 0 rapporti Greenbone visti dall'altra sessione
  - **Verso DA-Vul-can esce**: `VULCAN_TOKEN` valorizzato, coda tutta `inviato` — 2 inventari il 04/11 alle 02:00:05 e 1 ad-health alle 11:26:28, nessun errore
  - Inventario: 132 host, 3 reti (192.168.0.0/24 con 122 host, 192.168.1.0/24 con 10, `parma` 192.168.2.0/24 con **0**)
- [x] **La resa della tab «Rilievi» si può guardare qui**: il 72729 è sulla 0.9.967 e ha 13 host con rilievi (es. host 49, `192.168.0.105`)
- [ ] Da capire: 35 ripieghi dichiarati dalla salute del 72729 (l'hub ne ha 0)

## 2026-11-04 — Il conteggio dei rilievi della sonda conta solo Greenbone

Riccardo (04/11) ha chiesto di guardare perché `finding_count` non torna. Misurato sull'hub, tenant 70791.

- [x] È un difetto **della sonda**, non nostro: il numero arriva da lei (`s.finding_count` in `lib/vuln/sync-job.ts`) e conta **solo i rilievi Greenbone**. Sistematico, non casuale: sui 4 giri con fonti miste (121-124) il dichiarato è esattamente il totale Greenbone, sui giri più vecchi con sola Greenbone (117-120) coincide col totale. Giro 124: dichiara 1832, in archivio 2402 (Greenbone 1832, controlli 530, Nuclei 40)
- [x] `controllo:` e `nuclei:` **arrivano dalla sonda**, non li fabbrichiamo noi: `normalizzaRilievoControllo` ripulisce righe che arrivano già con quel prefisso
- [x] Dove si vede (`subnet-edge-scan-panel.tsx:518`, «Ultimo scan: done · N CVE») il numero è chiesto **alla sonda al volo** (`/api/v1/networks/lookup` in `edge-subnet-bridge.ts`), non letto dal nostro archivio: nessuna correzione in DA-IPAM lo cambierebbe. Il fix sta in DA-Vul-can, vedi il suo TASKS
- [x] La nostra colonna `vuln_scan_runs.finding_count` è **scritta e mai letta**: nessun SELECT in tutto `src/`. Gli altri due punti che mostrano totali li calcolano (`COUNT(*)` in `api/integrations/scanner-edge`, `findingsSorted.length` in `api/hosts/[id]/vulnerabilities`), quindi oggi nessuna pagina mostra un totale sbagliato
- [ ] Da decidere: la colonna morta o la si ricalcola dopo lo scarico (una UPDATE idempotente a fine `sync-job`) o la si smette di scrivere. Com'è adesso è una trappola per chi la leggerà domani credendola un totale
- [ ] Da decidere: l'etichetta «N CVE» del pannello è nostra e sovrastima — sul giro 124, 2135 rilievi su 2402 sono di livello Log, cioè informativi, non CVE. «rilievi» sarebbe onesto

## 2026-11-04 — Tab «Rilievi»: i campi significativi in tabella

Riccardo (04/11), dopo «dove vedo i dati aggiuntivi acquisiti dal profilo»: «devono essere riportati
in tabella i rilievi / i campi significativi».

- [x] `src/lib/scanner/profili/campi-scheda.ts` (puro): da `host_profilo_rilievi` alle righe della tabella, riusando `fattiDaScript` — la vista non ha una sua copia della lettura, quindi non può divergere dalla scrittura
- [x] Rotta `GET /api/hosts/[id]/profilo-rilievi`; tab «Rilievi» in `tabDelTipo` (compare solo con dati, come «Sensori»), componente `components/scheda/tab-rilievi.tsx`, conteggio dei campi accanto al nome
- [x] 8 prove in `profili/__tests__/campi-scheda.test.ts`, viste fallire (rotto il dedup: 7/8)
- [ ] **Resa non vista**: in locale `host_profilo_rilievi` è vuota in tutti e tre i tenant (il profilo non è ancora girato qui), e il `next dev` sulla 3001 chiede l'accesso, che un agente non ha. Quindi la tab è verificata da tsc, dal build e dalle prove della lettura, **non a schermo**. Da guardare al primo giro di profilo, o seminando righe finte in un tenant locale
- [ ] Da verificare su apparati veri: con zero PLC raggiungibili la tabella è provata solo su fixture. Al primo giro su un apparato di campo si guarda se i campi letti sono quelli attesi
- [x] Trappola trovata nel cancello: due prove (`cron/scansione-attesa.test.ts`, `scanner/__tests__/esecutore-finto.test.ts`) asseriscono `data/ipam.db` **assente** («niente ripiego sul DB legacy») senza crearlo né rimetterlo com'era. Alle 20:07 del 04/11 il file c'era — vuoto, 0 host e 0 reti, ignorato da git — e le due prove sono diventate rosse senza che il codice avesse colpa. Spostato in `scratchpad/ipam-vuoto-20261104.db` (non cancellato) e le prove tornano verdi. **Chi lo ha creato non è dimostrato**: in quel momento girava il nostro `npm test`/`npm run build` insieme al `next dev` di Riccardo sulla 3001, vivo dal 21/10, che condivide `.next/` col build. Da sistemare nelle prove, non nell'ambiente: chi asserisce quello stato deve prepararlo (lezione #8)
- [x] Promossa su `main` col sì di Riccardo (04/11): `git push origin origin/dev:main` in fast-forward, `origin/main` = `origin/dev` = `e27a4309` = **0.9.967**, verificato con `git ls-remote`. Il promote porta su main anche l'accesso Windows (0.9.965/966) e il conteggio dei rilievi: era già tutto su dev
- [x] 70151 sulla nuova: `/api/version` 0.9.967 alle 22:07 (il pull, ~22 min dal push) e `/api/health` 0.9.967 con `uptime_seconds` 59 alle 22:09 — **il riavvio è quello che conta**, `/api/version` cambia col pull (alle 21:07 diceva già 0.9.967 mentre il servizio girava da 4h sulla 0.9.964). Salute: `status ok`, DB ok, 15 credenziali leggibili, scheduler senza job in ritardo, 0 ripieghi. Letto solo via HTTPS: la chiave SSH di quell'appliance è cambiata e non è stata accettata
- [x] Trappola: l'appliance 70151 sul NetBird è il peer **`70151-ipam-2`** (`100.107.145.24`), non `70151-ipam`; col nome sbagliato il controllo dà «nessuna risposta» e sembra irraggiungibile. Alle 21:4x del 04/11 rispondeva 0.9.964 (la main di prima): l'aggiornamento arriva col suo timer entro 15 minuti
- [ ] Rimandato: il rilievo **grezzo** (`elems_json`, `output`) non ha nessuna pagina. La tab mostra solo i campi significativi, come chiesto; se servirà il grezzo, un dettaglio espandibile per riga

## 2026-11-04 — Profili di scansione: detect approfondito e profilo IoT/OT

Riccardo (04/11): «dovrei arricchire la scansione dei device con un profilo dedicato ad IoT OT […]
per identificare meglio quello che è poco visibile», con l'elenco delle porte OT/IoT in chat; poi
«non si potrebbero utilizzare altri profili nmap per fare un discover più approfondito dei sistemi
in rete». Piano: [`docs/superpowers/plans/2026-11-04-profili-di-scansione.md`](docs/superpowers/plans/2026-11-04-profili-di-scansione.md),
bozza con livello completo proposto, in attesa del via.

- [x] Misurato cosa usa nmap oggi: `-O` **mai passato** (e `parseNmapXml` legge già `osmatch`, campo mai riempito), `--version-intensity` a **0** senza override sull'hub, **due** script NSE in tutto il codice (`smb-os-discovery`, `snmp-info`), output degli altri **buttato**, secondo profilo nmap **vietato** dalla rotta («È supportato un solo profilo Nmap»). L'app gira root sull'hub, quindi `-O` e `-sU` funzionerebbero
- [x] Trovato il motivo per cui le regole OT di stamattina non scatteranno mai: 102, 502, 1883, 8883, 4840 e 44818 non sono in `NMAP_DEFAULT_TCP_PORTS`, 47808/5683/2222 non sono nella lista UDP. Le firme aspettano porte che nessuno prova
- [x] `bacnet-discover` del comando di Riccardo non esiste: lo script è `bacnet-info`, UDP 47808. Un nome inesistente fa abortire tutta la scansione, non salta lo script. Mancano anche `dnp3-info` e qualunque cosa per Profinet, GE SRTP e FINS oltre a `omron-info`
- [x] Decisioni di Riccardo (04/11): probe OT solo di lettura, **niente `modbus-discover`** (intrusive); **`mqtt-subscribe` incluso com'è**, payload compresi (conseguenza a verbale: dati di processo del cliente nel nostro database, il piano mette un tetto in byte); PLC e HMI **foglie distinte** da IoT; interruttore **globale** in Opzioni
- [x] Da confermare al via: la radice nuova di livello 1 `ot` (foglie `plc`, `hmi`, `drive`, `rtu`, `io_remoto`, `gateway`) invece di `iot.plc`/`iot.hmi`. «Distinti da IoT» non diceva dove
- [x] Riccardo (04/11): «vai e procedi con un controllo leggero, vorrei avere la funzione disponibile al più presto» e «vediamo di abilitare tutto il possibile». Livello **leggero**, non completo
- [x] Riccardo (04/11): «si applicherebbe l'approfondito con la selezione dei device dalla lista […] abilitabile solo su determinati device selezionati dentro a subnet». Il meccanismo esisteva già: `hostScope` nella pagina della rete, e le azioni fuori da `noHostSelectionNeeded` pretendono la selezione. Il pulsante «Profilo» segue «Accesso agli host»: spento senza selezione
- [x] Scelta d'architettura: modulo a parte (`src/lib/scanner/profili/`) e rotta `POST /api/scans/profilo`, **non** un `DiscoveryScanType` nuovo. `discovery.ts` è 3381 righe con `scanType` sparso in una trentina di condizioni: infilarci un tipo nuovo era il modo più sicuro di rompere la scansione di tutti i clienti
- [x] Verificate le categorie dei 36 script candidati sulla macchina: tutti `safe`/`discovery`/`version` tranne `iec-identify`, che è `intrusive` ed è stato escluso insieme a `modbus-discover`
- [x] Fatto: profili (`profili.ts`), argomenti puri (`comando.ts`), lettura degli script (`lettura.ts`), motore (`motore.ts`), persistenza (`salva.ts`), evidenze (`attribution/profilo-evidence.ts`), tabella `host_profilo_rilievi`, rotta, pulsante con menu nella pagina della rete
- [x] Tassonomia: radice `ot` con `plc`, `hmi`, `drive`, `rtu`, `io_remoto`, `gateway`, separata da `iot`; `legacy-projection` non collassa `ot.*` (plc → plc, hmi → hmi, resto → rete_ot). Chiude la domanda che era aperta qui sopra
- [x] **Due difetti veri trovati dalle prove, prima del rilascio**: (1) il testo libero degli script NSE non veniva mai letto — sta nell'attributo `output`, cioè `@_output` col prefisso configurato, e `nbstat`/`upnp-info` ci si appoggiano; (2) `parseTagValue` di serie convertiva i valori numerici, e il seriale `0x60c12345` di un PLC Allen-Bradley diventava `1623270213`. Entrambi corretti in `nmap.ts`
- [x] Prove esistenti cambiate d'esito perché è cambiato l'intento, non per farle passare: `oui-ot.test.ts` (Weintek → `hmi`, CREVIS → `plc`, azionamenti → `rete_ot` invece di `iot` per tutti) e le eccezioni del round-trip in `legacy-projection.test.ts` (`plc` e `hmi` non sono più eccezioni)
- [ ] Non ancora provato su apparati veri: nessun PLC, HMI o inverter raggiungibile da qui. I nomi delle chiavi degli script (`Serial Number`, `DNS_Computer_Name`, …) sono letti **normalizzati**, quindi una variante di nmap non fa sparire il dato, ma la forma esatta dell'output di `s7-info`, `enip-info`, `bacnet-info` e `omron-info` va confermata sul campo — la rete «parma» 192.168.2.0/24 del 72729 tace ed è dove stanno gli OT
- [ ] Da verificare sulle appliance dei clienti: se il processo ha i privilegi per `-O` e `-sU`. Sull'hub gira root; sulle appliance no si sa. Senza, il profilo degrada e lo scrive nel registro
- [ ] `--version-intensity` alzata a 7 **solo dentro il profilo Approfondito**, che gira su host scelti a mano: il valore globale resta 0. Il costo per host non è ancora misurato su una rete vera
- [ ] Da ripensare nella tappa 2: `-O` è passato con `--osscan-limit`, che salta il riconoscimento sugli host senza almeno una porta chiusa — su un apparato molto filtrato quindi non parte, e il registro del giro mostra il comando ma non dice che è stato saltato. Tolto il flag si prova sempre, al prezzo di qualche pacchetto in più
- [x] Resta da fare: mostrare i rilievi nella scheda dell'apparato (oggi stanno in `host_profilo_rilievi` e riempiono i campi vuoti, ma non c'è una tab che li faccia vedere)
- [x] Ordine scelto: prima il profilo **Approfondito** (nessun rischio, rende su ogni cliente, collauda il parser), poi **IoT/OT**, che è quello che manda pacchetti ai PLC
- [ ] Da verificare sulle appliance dei clienti, non solo sull'hub: se il processo ha i privilegi per `-O` e `-sU`. Senza, il profilo deve degradare e dirlo, non fallire muto
- [ ] `--version-intensity` si alza solo con la misura del tempo prima e dopo su una rete vera (passo S5). Se costa troppo resta a 0 e si scrive
- [x] Chiude l'«asse 2 (GET della pagina web)» rimasto aperto nella sezione delle stampanti: lo coprono `http-title`/`http-headers` del profilo Approfondito
- [x] `rdp-ntlm-info` dà nome DNS, nome NetBIOS, dominio e build di Windows **senza credenziali**: tocca anche il filo WMI/WinRM aperto oggi, dove 12 PC su 13 rifiutano l'account

## 2026-11-04 — Stampanti: seriale e part number; regole OT mai arrivate alle appliance

Riccardo (04/11): «uno dei più utili sarebbe il seriale ma non viene ottenuto e anche il part number delle stampanti, inoltre il detect dei device che ti avevo chiesto». Il detect è la sezione «Arricchire il detect» più sotto, chiesta nella sessione «Device classification da-ipam 72279».

- [x] Misura sulla 72729, 10 stampanti: `prtGeneralSerialNumber` risponde su 9 (non sulla WF-6590 192.168.0.131). In archivio c'era la stringa IEEE 1284 o «ET-5805 Series»: OID sbagliati nei profili
- [x] Part number: HP sì (`…11.2.4.3.1.10.0`, W1A29A), Epson e Kyocera no: nessun campo nei rami vendor letti. HP espone anche il codice del toner (`…9.4.2.1.4.1.10.1.1.1.1.0`, CF259A): non letto, proposta
- [x] Regole OT: 0 righe nell'hub.db della 72729. Stavano solo in `db.ts`, le appliance seminano da `db-hub.ts`. Portate, con prova che confronta i due seed
- [x] Nessuna bonifica: «Aggiorna» riscrive il seriale, la scansione sostituisce un finto. Restano in `physical_devices` le righe vecchie dove la risoluzione non trova il MAC
- [x] Rilascio 0.9.962 (af2aae7b): cancello verde (6.394 prove passate, 0 fallite), hub 533 alle 14:35 UTC con 5 regole OT e profili corretti da soli su un database esistente, `main` col sì di Riccardo, 72729 ripartita alle 14:54 UTC, health 200. Snapshot `pre-stampanti-20261104` della VM 100 su `pve`, da togliere dopo il controllo. Il primo push su `main` è fallito per un errore mio: in zsh `$C:refs/…` è letto come modificatore `:r` (lezione 15, sempre `${C}`)
- [x] Il `fast_scan` delle 15:00 non riclassifica: è un giro di ping (0 porte), non passa dal fingerprint. Al 15:09 UTC gli OT restano `unknown` e i seriali finti restano: nessuna scansione con porte, nessun «Aggiorna»
- [x] Riccardo (04/11): scansione Nmap completa 15:14-15:29 UTC, 95 host, 273 porte. Stampante 192.168.0.201 letta: modello, seriale, part number W1A29A, firmware. Le altre 9 non risultano lette
- [x] Trovato: le regole OT funzionano (`final_device: "Weintek HMI"`, `rule:mac_vendor`) ma non scrivono la classe. Dal Fix C1 l'unico motore che scrive `hosts.classification` è l'attribuzione v2, e dall'OUI prendeva solo il vendor. Prima avevo indicato la soglia 0,56 del fingerprint: sbagliato, quel percorso non scrive
- [x] Evidenza categoria dall'OUI per i produttori solo OT (`OUI_SOLO_OT` in `attribution/emitters.ts`). Weintek e CREVIS finiscono `iot`, non `hmi`/`plc`: `legacy-projection.ts` collassa le foglie `iot.*` per regola esplicita e le prove esistenti la fissano
- [x] Da decidere con Riccardo: PLC e HMI distinti da IoT nella classificazione (nuove foglie della tassonomia e prove da rivedere)
- [x] 0.9.963 su `main` e sulla 72729 (ripartita alle 16:09 UTC, health 200), 70151 a 0.9.963. `scripts/attribution-recompute-cli.ts DEFAULT 192.168.0.0/24 --no-vendor-refresh` alle 16:10 UTC: 30 host cambiati, tutti `unknown → iot`, 11 Weintek, 10 CREVIS, 6 Control Techniques, 3 Kronotech, nessun altro. Classi di prima in `/root/classi-prima-20261104.txt` sulla VM 100. Unknown da 77 a 47. Le altre appliance si riallineano alla prossima scansione con porte
- [x] Riccardo «Aggiorna selezionati» alle 15:50 UTC: 8 seriali veri su 10, 6 part number HP, modelli precisi. Restano senza seriale la WF-6590 (192.168.0.131, nessuna Printer-MIB per il seriale) e 192.168.1.215 (lettura senza dati, da guardare). Snapshot `pre-stampanti-20261104` tolto. Verifica dal database: la pagina non l'ho vista
- [ ] Asse 2 (GET della pagina web) e asse 3 (password di default) del detect restano da decidere con Riccardo

## 2026-11-04 — Zyxel GS1900 sulla sonda 72729-ipam (rilasciato, 0.9.958)

Riccardo (04/11): lo switch GS1900 risponde in SNMP ma non si vedono porte, VLAN e altre informazioni, «aggiungere un parser». Numero del cliente scritto 72279 in chat: è 72729. Rilievo in sola lettura, walk completo di 11.517 righe, `GS1900-48HP`, sysObjectID `1.3.6.1.4.1.890.1.15`, firmware V2.70(AAHO.5).

- [x] Causa di ciò che non si vede: i dati ci sono. Apparato 18: 58 porte, 73 MAC, 1 VLAN, 58 PVID, 1 vicino LLDP. Ma `classification=server` con `vendor=hp`: `tipoScheda` dà `generico`, che non ha le tab Porte, VLAN, Vicini. La scansione ha poi portato l'host a `switch`, l'apparato no
- [x] Causa del `vendor=hp`/ProCurve: creato in blocco alle 11:28 da «Rendi apparato» insieme ai due HP. Non è dimostrato chi l'abbia scelto; di certo `other` non offre nessun profilo switch, quindi uno switch di altra marca non ha una voce giusta
- [x] Lettori attuali provati sul walk vero: 58 porte (50 + 8 LAG), VLAN `letto`, STP letto. Le MIB sono standard: non serve un parser nuovo per porte e VLAN
- [x] Profilo SNMP `zyxel_gs1900`: modello `…890.1.15.3.1.11.0`, seriale `.12.0`, firmware `.6.0`, nel catalogo e nel seed dell'hub, idempotente per gli hub esistenti. ENTITY-MIB non basta: il telaio ha indice 67108992, non 1
- [x] Profilo prodotto `generic_switch` sotto `other`, nessuna ricostruzione di `network_devices`; proposta di «Rendi apparato» per Zyxel: switch, mai ProCurve
- [x] Duplex da EtherLike (`dot3StatsDuplexStatus`) quando la MAU-MIB manca: oggi è nullo su tutte le porte
- [x] STP: root illeggibile. Il GS1900 dà `dot1dStpDesignatedRoot` come testo «0/00:00:00:00:00:00» e oggi esce un id senza senso (`12335.30:30:3a…`), con porta radice 52 su uno switch a 50 porte: root e porta radice a null
- [x] Prove con fixture anonimizzata dal walk (repo pubblico: niente IP e MAC veri), CHANGELOG, limiti nel manuale `docs/modules/acquisition.md`
- [x] Trovato strada facendo: `tipoLetturaApparato` manda ogni `vendor=other` sul ramo Linux/SSH: uno switch sotto «Altro» non si sarebbe letto come switch. `eSwitchGenerico` lo esclude anche in `getDeviceInfo`
- [x] Rilascio 0.9.958 (73ce44fb): cancello verde (lint 0 errori, tsc, 6.347 prove passate e 0 fallite, build), hub 533 ripartita alle 12:48 UTC con health 200 e profilo nel suo hub.db, `main` in fast-forward col sì di Riccardo, 72729 ripartita alle 12:59 UTC, 70151 a 0.9.958 con health 200. Snapshot `pre-zyxel-20261104` della VM 100 su `pve`, da togliere dopo il controllo. Greenbone ha continuato durante l'update: 65 processi openvas alle 13:00, `appliance-edge` mai riavviato
- [x] Apparato 18: Riccardo l'aveva già portato a `other`, `switch` a mano; restava `generic_ups`, unico profilo che «Altro» offriva. Corretto con UPDATE a `generic_switch` alle 13:00 UTC. Gli OID del profilo letti sullo switch vero danno modello e firmware; la prova con `querySnmpInfoMultiCommunity` dalla VM non è riuscita per un problema di import dello script, non rifatta (REGOLA #0)
- [x] Riccardo ha premuto «Aggiorna» (13:09 UTC): `POST /api/devices/18/query` 200, modello GS1900-48HP, firmware V2.70(AAHO.5), seriale, `last_info_update` valorizzato anche sull'host; 58 porte con duplex (9 full, 4 half), 86 MAC, root STP vuoto. Verifica dal database: la resa delle tab non l'ho vista. Snapshot `pre-zyxel-20261104` tolto
- [x] Riccardo (04/11): «il GS1900 credo sia uno switch zyxel, è possibile aggiungere i vendor rilevati». Scelta: marca accanto ad «Altro», nessuna modifica al database (`lib/devices/marca-rilevata.ts`). Scartato il vendor `zyxel` vero: ricostruzione di `network_devices` su ogni appliance, da ripetere per ogni marca nuova. Scheda resa in locale a 1440: Piattaforma «Altro», Marca «Zyxel», per un HP niente riga Marca. Su `main` con la 0.9.961 (promossa dalla sessione stampanti, contiene la 0.9.960); 72729 ripartita alle 14:10 UTC, health 200. Marche calcolate sui dati veri: Zyxel, Epson, Kyocera, Epson, APC. La pagina vera non l'ho vista (nessun accesso web della sessione). Snapshot `pre-marca-20261104` su `pve` tolto
- [ ] Sul posto: porte 26, 29, 40, 45 a 10 Mbps half duplex, da guardare (apparato vecchio, cavo o negoziazione)
- [ ] Da verificare su un apparato con la MAU-MIB: `snmp-port-schema.ts` prende l'ultimo componente dell'OID come ifIndex, ma quella tabella ha due indici (ifIndex.mauIndex). Non toccato: nessun apparato qui per provarlo
- [ ] Riccardo (04/11): switch «pese» in 192.168.2.24x, «non so esattamente cosa, collegato, ma per qualche ragione non raggiungibile». Misura dalla VM 100 (192.168.0.190, solo letture): non è solo quello switch, tutta la rete 3 «parma» 192.168.2.0/24 tace. 0 host nel database, anche nelle scansioni delle 11:45; sweep ping + TCP 80/443 0 host su 256, gateway dichiarato .254 compreso; traceroute senza risposta già dal primo salto, via 192.168.0.50 (Fortinet). 192.168.1.0/24 invece dà 10 host online. Causa non dimostrata (ICMP filtrato non basta a spiegare lo zero su 80/443): serve guardare criteri e rotte sul Fortinet per la sorgente .190, o se «parma» è una sede remota in VPN. Il nome «pese» non compare in nessun host né vicino LLDP
  - Riccardo (04/11): «parma» è una **sede remota**, Riccardo non ha accesso al Fortinet 192.168.0.50. Quindi la verifica passa da chi gestisce il firewall: testo pronto dato in chat. Da capire se la VLAN 2 dichiarata sulla rete 3 ha senso per una sede remota
  - Riccardo (04/11): lasciare perdere per ora; forse Parma è 192.168.1.0, la 192.168.2.0 è una rete di device IoT. Misure: 192.168.1.x 28 ms e TTL 62 (due salti, primo il Fortinet), 192.168.0.x 0,3 ms. Quindi 192.168.1.0 è remota, il messaggio al gestore del Fortinet non serve e la rete 3 è probabilmente nominata male
  - «Pese» è il nome della VLAN 2 sul J9660A 192.168.0.51 (VLAN 3 «Disossatura»), non uno switch: taggata sulle porte 1 (FGT70, LAN_Principale), 50, 52 e sul LAG 54 (50+52), nessuna porta con PVID 2. Tabella MAC 1 = VLAN 1 (84 host noti su 95); tabella 2 = 7 MAC, VLAN 2 o 3 non distinguibile: Fortinet sulla porta 1 e sei sul LAG 54 (Advantech, Eurotech, quattro HP), nessuno nel database. Ipotesi, non dimostrata: la 192.168.2.0 è la VLAN Pese, il suo router è il Fortinet che non lascia passare la sonda, il LAG 54 porta allo switch che Riccardo chiama «pese»
  - Strada senza Fortinet: porta trunk per la sonda con la VLAN 2 (`da-appliance trunk` è già attiva, oggi 0 tag). Scartata: Riccardo (04/11) «non ho accesso alle porte, non ho gestione della rete, devo solo fare un VA e una analisi». La 192.168.2.0 resta fuori dal perimetro raggiungibile del VA: va scritta come limite nel rapporto, nessun altro lavoro
- Limiti misurati, non risolvibili via SNMP su questo firmware: PoE assente (nessuna POWER-ETHERNET-MIB, 0 righe, pur essendo un 48HP); porta 22 chiusa nella scansione, solo 80 e 443; i valori numerici `…890.1.15.3.2.x` non hanno un significato documentato e non si leggono

## 2026-11-04 — WMI nelle reti senza WinRM (72729, da decidere)

Riccardo (04/11): «ho una rete vecchia e mi aspettavo che in assenza di winrm wmi funzionasse». Su 72729-ipam: 20 macchine con 135/445, 16 senza WinRM; nessun tentativo WMI o WinRM nei log.
- [x] Causa: il ripiego WMI c'è (`src/lib/devices/wmi-bridge.py`, impacket presente nel venv) ma scatta solo in `getDeviceInfo` per un apparato Windows con credenziale. La scansione prova solo WinRM (`discovery.ts`), quindi senza WinRM non lega nessuna credenziale; in più la rete 1 ha in catena solo la voce SNMP `public`
- [x] Prova vera (Riccardo: «puoi provare tu con le credenziali registrate»): `runWmiProbe` su 192.168.0.227, una volta, voce `WinRM`, script temporaneo tolto. Esito `AUTH_REJECTED`, `rpc_s_access_denied` in 0,5 s. Login LDAP della stessa voce riuscito: password giusta. È lo stesso utente della voce `ad`, solo Domain Users (gruppo primario 513, 0 gruppi diretti). Causa: mancano i diritti sul PC
- [ ] Serve un account dedicato amministratore locale dei PC (GPO del loro IT), non Domain Admins. Poi nuova prova su un PC. Il passaggio del firewall oltre la 135 resta da confermare: il rifiuto arriva prima di usare le porte dinamiche
- [x] Riccardo (04/11): «potrebbero esserci tante macchine windows che rispondono wmi con account di dominio». Piano: [`docs/superpowers/plans/2026-11-04-wmi-nella-scansione.md`](docs/superpowers/plans/2026-11-04-wmi-nella-scansione.md), bozza con livello completo proposto; primo passo la misura sui PC del 72729. Va in appliance solo con rilascio su `main`
- [x] Misura sul 72729 (Riccardo: «Sì, prova i PC»): 13 PC con 135 aperta e senza WinRM, 12 rifiutano l'account readonly, 1 (192.168.0.207) non risponde sulla 135, 0 accettano. L'account dedicato dell'IT del cliente serve per il collaudo finale
- [x] Riccardo (04/11): «dobbiamo gestire il sistema per testare sia winrm che wmi in automatico senza bloccarsi, non tanto per questo utente ma in generale». E: deve essere chiara la definizione dei diritti dell'utente necessari per le scansioni; nell'applicativo deve essere chiaro cosa abilitare per l'utente e cosa abilitare per la sicurezza del dominio. Piano riscritto in forma generale, 11 passi, stesso file: motore WinRM+WMI, catalogo unico dei diritti, controllo dell'account. Bozza da approvare, tavola degli oggetti proposta il 04/11
- [x] Sviluppato su `dev` col piano citato sopra: motore, freni, catalogo dei diritti, «Controlla account», pannello per host. Manca il collaudo. Riccardo (04/11): i test IT li fa in una rete finta, 72729 non si può modificare. Il Task 10 non si fa sul 72729, e la promozione su `main` resta ferma: le appliance da immagine seguono `main` entro 15 minuti, 72729 compreso
- [x] Difetto già presente, corretto: con 5985 chiusa la scansione conta un fallimento senza nessun login, e dopo 3 host esclude la voce dall'esecuzione
- [ ] Con WMI mancano software da registro, ultimo utente collegato, PowerShell (limiti scritti in `getDeviceInfoFromWmi`). `device-connection-test.ts:313` dice ancora che si usa solo WinRM: da riallineare

## 2026-11-03 — Lavoro aperto DA-IPAM: #59, #49, promozione dev→main, snapshot 533

Avviato dalla sessione «Contesto progetto Domarc» (Riccardo ha dato il via). Worktree
`.claude/worktrees/lavoro-aperto-20261103`, ramo `lavoro-aperto-20261103` da `origin/dev`.

- [x] PR #59 (Wazuh, verifica TLS indexer separata): rivista; trovato un client indexer rimasto sulla
      verifica della Manager API (`src/lib/modules/health.ts`), corretto in un commit a parte.
- [x] PR #49 (rete dell'appliance nel segnale): **non** superata — DA-Link ha già il modello `Rete`
      (DA-Link #35 unita), DA-IPAM `dev` non lo mandava. Rifatta su dev (cherry-pick pulito); la #49 si chiude.
- [x] `main` non ha codice assente da `dev`: `git merge-tree origin/dev origin/main` cambia solo
      `VERSION`/`package*.json` (Aruba 0.9.955 e i port WinRM/DC sono già in dev). Unito main in dev
      tenendo la versione di dev, così la promozione è un fast-forward.
- [x] Cancello completo verde sul ramo (lint 0 errori, build, tsc, test 6334 pass / 0 fail), `version:release`
      **0.9.957**, push su `dev` (50eecbdc, `git ls-remote`). #59 risulta MERGED, #49 chiusa con commento.
      533 ripartita da sola alle 15:42 UTC su 50eecbdc: health, login, edge 200, journal senza errori.
- [x] VM 533: DA-IPAM sano (`da-ipam` attivo, health 200, 0.9.956), edge `healthy` e `/api/v1/health` 200;
      tolti `pre-edge-20261029` e `pre-aggiorna-0942-20261103` (task Proxmox stopped OK). Restano
      `pre-aruba-cx-20261103` e `pre-sonda-0830-20261103` delle altre sessioni.
- [x] Promozione dev→main col sì di Riccardo (03/11): `main` 0.9.955 → **0.9.957** in fast-forward alle 15:46 UTC
      (89204238, `git ls-remote`: main = dev). 70151 ripartita da sola alle 15:52 UTC: `/api/health` ok, DB ok,
      chiave di cifratura invariata (15 credenziali leggibili), scheduler ok, 0 ripieghi; `/login` 200.
- [x] 70151: chiave SSH nuova di 172.20.40.194 accettata col sì di Riccardo (impronta ED25519 `SHA256:n5EMxpvO…`
      verificata con ssh-keyscan; copia `~/.ssh/known_hosts.bak-*`). `root` via SSH dà «Permission denied (publickey)»:
      si entra da PX01 172.20.40.191 con `qm guest exec 104`. Lì: 70151-ipam-2 su `main` 89204238, 0.9.957,
      `da-ipam` attivo dalle 15:52:03 UTC, 0 riavvii, nessun errore nel journal, nessuna variabile `DA_VAULT_*`.
- [ ] Da guardare in DA-Link: il segnale di 70151 porta il blocco `rete` (non verificato da qui).

## 2026-10-27 — Reti dal sensore trunk: host e MAC insieme alla rete (da approvare)

Riccardo (27/10, mini PC dimostrativo 72729-ipam): «Aggiungi» di una rete vista dal trunk crea solo la
rete (`/api/trunk/rete`), senza gli host trovati; nelle reti con tag (niente ARP del router né L2
dall'appliance) gli host restano senza MAC, nella nativa li hanno. Vuole: (1) all'aggiunta, l'elenco
degli host dalle osservazioni del trunk; (2) MAC compilati dal trunk per le reti con VLAN senza tabella
ARP; (3) prima dell'aggiunta un ARP ping col tag giusto (il giro c'è già: `/api/trunk/giro`, sonda
`arp-scan -Q <vid> --arpspa 0.0.0.0`).
- [x] piano e livello (leggero) approvati da Riccardo (27/10 «hai preso in carico gli altri rilievi»)
- [x] «Aggiungi»: rete, giro ARP sul VID, attesa della sonda (`/stato` giro_in_corso, max 90 s), lettura, host (IP, MAC, nome, produttore) — `src/lib/trunk/aggiungi-rete.ts`
- [x] dopo ogni lettura del trunk: host nuovi e MAC mancanti delle reti con `vlan_id` (mai sovrascrivere un MAC presente) — `src/lib/trunk/host-dal-trunk.ts`
- [x] prove `src/lib/trunk/__tests__/host-dal-trunk.test.ts` (la lettura vista rossa prima dell'aggancio); eslint verde; tsc e npm test rossi solo in `src/lib/vault/` per `age-encryption`/`kdbxweb` assenti dai node_modules locali (non toccati)
- [x] promosso su main (0.9.919, poi 0.9.920 con la rete senza VLAN: VID 0), «tutto su main» di Riccardo 27/10. Collaudo su 72729-ipam (VM 999 del mini PC): VLAN 4 43/43 host col MAC, VLAN 6 12/12, nativa 192.168.40.0/24 da 0 a 42/43 MAC («1 nuovi, 41 MAC compilati» nel log delle 17:58 UTC)

## 2026-11-02 — OpenBao tolto dal codice dell'hub

Riccardo (02/11): «confermo il sì alla pulizia completa di OpenBao». Macchina, dati e DA-Link già puliti; qui il codice.
- [x] tolti `src/lib/vault/openbao.ts`, `copia-verso-dalink.ts` con `scripts/da-vault-copia-verso-dalink.ts`,
  `configurazioneOpenBao`, la riga «Credenziali da OpenBao» del catalogo e le prove solo-OpenBao
- [x] `DA_VAULT_OPENBAO=1` = configurazione rifiutata («OpenBao è stato tolto il 02/11, usa DA_VAULT_DALINK=1»)
- [x] la migrazione resta, solo verso DA-Link: `src/lib/vault/migra-verso-dalink.ts`, `scripts/da-vault-migra-verso-dalink.ts`
- [x] nomi interni: `vaultRemotoAcceso`, `StoreRemotoProcesso`, `statoVaultProcesso().remoto`, `/api/vault/stato` →
  `remoto`, `cancellaDalVaultRemoto`; prove generiche su `DaLinkStore` o sul finto `support/vault-remoto-finto.ts`

## 2026-10-27 — Vault semplice: un file KeePass al posto di OpenBao e degli slot

Riccardo (27/10): via OpenBao, gli slot, la 2FA per «Mostra», la ricifra e il recupero a tre comandi. Le
password stanno in un file `.kdbx` con il suo file chiave: per le appliance dei clienti locale
(`data/vault/credenziali.kdbx`, si apre da solo all'avvio con `systemd-creds`), per hub e DA-Vul-can su
DA-Link. Esportazione su chiavetta (archivio + chiave) per gli admin. Spec e piano nel repo DA-Link
(`docs/superpowers/specs|plans/2026-10-27-vault-semplice-kdbx*`). ADR 0034 superato.
- [x] piano approvato (27/10), semplificato lo stesso giorno: niente chiave Domarc, niente `age`
- [x] DA-IPAM#22 (svuotamento verso OpenBao) chiusa senza fonderla: si rifà sul backend `dalink`
- [x] passo 1, parte TS: `src/lib/vault/kdbx.ts` (formato comune con DA-Link), prove in
  `__tests__/kdbx.test.ts` con gli archivi incrociati di `__tests__/dati/vault_kdbx/`. Non ancora usato
- [x] (29/10) prerequisito del passo 6: DA-Link ha sul live l'API del vault per le app (`ambito`, `voce`
  sulla 8443) e il gettone `da-ipam` è nel `.env.local` dell'hub (`DALINK_VAULT_URL`, `DALINK_VAULT_GETTONE`);
  chiamata dall'hub: 200, 0 voci. Contratto: DA-Link `docs/superpowers/specs/2026-10-27-vault-gettone-app-design.md`
- [x] (29/10) passo 6 in codice: backend `dalink` + copia verso DA-Link, spenti; prove viste rosse, una revisione
  (opus) con correzioni + una mirata, cancello verde (6335 prove). Piano DA-Link `docs/superpowers/plans/2026-10-29-vault-passo6-app.md`
- [x] (29/10, DA-IPAM#47: migrazione col backend acceso, rilettura dal vivo, 24 ore per voce) **prima del passo 7 (accensione) sull'hub**, dalla revisione del 29/10: (a) `src/lib/credentials/aggiornamenti.ts:54-62`
  con DA-Link acceso un segreto cambiato dalla pagina toglie `credential_ref` e torna sulla colonna; (b)
  `scripts/da-vault-migra-openbao.ts` è legato a `OpenBaoStore` (le credenziali nuove non arrivano a DA-Link): far
  scegliere lo store allo script (`migraVersoOpenBao` accetta già un `SecretStore`); (c) la cache vale 24 ore per tutto
  il giro, non per voce: una voce sempre malformata resterebbe senza scadenza (dare a ogni voce la sua data)
- [x] (02/11, superata: prova tolta con OpenBao) `migra-openbao-cli.test.ts` probabilmente non prova gli orfani (il finto OpenBao non regge `LIST`, finisce in
  `orfaniErrore`); `riferimentiDelleCredenziali()` avvisa invece di lanciare (la copia lo aggira intercettando `console.warn`)
- [x] passo 7 sull'hub: 29/10 16:06-16:07 (ora italiana): DA-Vul-can 0.8.213 e hub DA-IPAM 0.9.938 con `DA_VAULT_DALINK=1` e `DA_VAULT_OPENBAO=0`
  (copie `.env.local.bak-20261029-15*-pre-accensione-dalink`); copia 17 voci (hub) + 3 (DA-Vul-can), `--verifica` tutte uguali;
  giri delle app visti nel registro di DA-Link, nessun errore nei registri delle app. Indietro: `DA_VAULT_OPENBAO=1`,
  `DA_VAULT_DALINK=0`, riavvio (OpenBao ha ancora tutto, DA-Vul-can anche le colonne)
- [ ] la skill `.claude/skills/deploy-prod` descrive ancora `da-invent` e un deploy a mano: l'hub gira come `da-ipam`
  da `/opt/da-ipam` con `da-ipam-update.timer` (pull di `dev`, build, riavvio ogni 15 minuti) — da aggiornare
- [ ] passo 8 (appliance dei clienti) del piano; passo 9 fatto il 02/11 (OpenBao tolto ovunque, anche dal codice)

## 2026-10-27 — Next.js 16.4.2: la build non deve leggere `data/`

Documento: `docs/proposte/2026-10-27-next-16-4-build-memoria.md` (misure, meccanismo, esito). Ramo `fix/next164-build-data`.
- [x] meccanismo trovato su un'app minima: `path.join`/`path.resolve` nel modulo e `fs` su valori misti diventano glob sul progetto
- [x] correzione (`src/lib/percorsi.ts`, ESLint, `scripts/controlla-tracciamento.mjs` in postbuild): 441 rotte → 0, picco 3,4 GB con 18 GB finti; cancello e 6150 prove verdi
- [x] prova sull'hub (27/10, ok di Riccardo): copia con `data/` vera in sola lettura, `MemoryMax=8G`: riuscita in 1'41", picco 4,6 GB, nessun OOM, postbuild 0 rotte su `data/`
- [x] merge su `dev` (27/10, ok di Riccardo, v0.9.916): hub ricostruito da solo alle 11:04 UTC, build 59" + tipi 45", postbuild 0 rotte su `data/`, servizio riavviato, `/api/health` 200, Next 16.4.2 in esercizio
- [x] promozione su `main` (27/10, ok di Riccardo): `43e98c15`, albero identico a `dev` v0.9.916. Cancello prima: lint 0 errori, tsc, build (0 rotte su `data/`), 6149 prove verdi e 1 rossa a tempo, ripassata da sola 12/12 (Mac a carico 24). Nota: per il CONTEXT del 22/10 tutte le installazioni seguono già `dev`, quindi la 16.4.2 era già arrivata con il push su `dev`
- [x] (27/10, fatto: messaggio al posto dell'orologio, vista fallire) `src/lib/zabbix-lettura/__tests__/trasporto.test.ts` («connessione che non completa il TLS»): `assert.ok(Date.now() - t0 < 1_500)` fallisce sotto carico (19,9 s il 27/10 con load 24): soglia da legare al limite di apertura, non al tempo della macchina

## 2026-10-23 — da-vault (piano approvato, livello completo)

Riccardo (23/10): sta valutando un vault unico al posto dei file locali di ogni app, a partire dalle credenziali del DA-IPAM di Domarc (hub) e poi firewall e altri device. Piano in valutazione: `~/Downloads/da-vault — Piano di implementazione.md` (OpenBao interno + KDBX/age dai clienti, libreria `@domarc/vault`).
- [-] decidere dove gira OpenBao: Riccardo pensa a DA-Link o a DA-Auth (oggi sulla .42); valutazione Claude 23/10: no alla .42, sì alla VM di DA-Link o a una VM piccola dedicata — chiusa il 06/11 (OpenBao tolto).
- [x] punto d'innesto nel codice (fatto il 23/10, ADR 0034: la chiave degli slot sta dentro `encrypt()` di `crypto.ts`, il riferimento OpenBao dentro il lettore unico): `src/lib/credentials/segreti.ts` (lettore unico dei segreti), più gli altri `encrypt()` fuori da `credentials/` (integrazioni, vuln edge, inventory-agent, network-services)
- [-] rimando a DA-Link/TASKS.md (stessa data) per la parte vault interno — chiusa il 06/11 (OpenBao tolto).
- [-] Riccardo (23/10): valutare Keeper (già in uso, tenant keepersecurity.eu) sia per il vault personale dei file «accessi» sul Mac sia per la soluzione. Analisi Claude 23/10: Keeper (cartelle condivise + Secrets Manager, un'applicazione KSM per app) al posto di OpenBao per Domarc; dai clienti resta l'archivio locale con slot age. Da verificare: licenza (KSM, SSO Entra, KeeperPAM inclusi?), prezzo per chiamate API — chiusa il 06/11 (OpenBao tolto).
- [-] licenza letta nella console il 23/10: **Keeper Business**, 18 licenze, scade 20/06/2027, 100 GB; niente SSO (serve Enterprise, listino 5,50 €/utente/mese), niente ARAM, compliance, BreachWatch. **KSM richiede KeeperPAM, 90 €/utente/mese**: chiedere a Keeper il preventivo per 2-3 utenti PAM prima di decidere KSM vs OpenBao per le app. Persone e vault personale: Business basta — chiusa il 06/11 (OpenBao tolto).
- [x] **Decisione di Riccardo (23/10)**: Keeper Business solo per le persone e il vault personale (Commander per gli agenti); per le app **OpenBao** (open source, self-hosted): KSM troppo costoso e il prodotto è pensato per essere open source. Dai clienti archivio locale con slot age. Il vault personale si fa per primo (piano in ~/.claude)
- [x] piano riscritto (23/10, sessione da-vault): `docs/superpowers/plans/2026-10-23-da-vault.md` — regola della fonte (se una macchina la usa sta in OpenBao, altrimenti Keeper; in Keeper solo puntatori), 12 passi, livello completo, ~5-6 settimane
- [x] Riccardo (23/10): D1 OpenBao in container nella VM di DA-Link, niente VM nuova; D2 nel DA-IPAM dei clienti entrano tecnici e cliente; D3 per ora senza YubiKey (chiave age in Keeper, cartella personale); D4 `fc5171b` in esercizio ora, in OpenBao al passo 9 — piano aggiornato
- [x] Riccardo (23/10): D5 slot Domarc acceso di serie con una riga nel contratto (chi non lo vuole lo spegne firmando); **piano approvato, livello completo**
- [x] clausola sullo slot Domarc approvata da Riccardo il 23/10 (testo nel piano, sezione Decisioni)
- [x] esecuzione, parte di codice (sessione cloud del 23/10, prompt `~/.claude/prompts/da-vault-esecuzione-1.md`): passi 5, 6 e 10 sul ramo `claude/da-vault-codice`, PR verso `dev` (dettaglio sotto)
- [-] analisi Claude 23/10 (da approvare): separare la «chiave» di ogni app (da TPM/OpenBao, mai in `.env.local`) dalle «credenziali condivise» dei device (OpenBao KV, solo riferimenti nelle app); dai clienti archivio locale cifrato con slot age e KDBX solo come esportazione, non come archivio vivo; login tecnici con OIDC nativo di OpenBao (DA-Auth non si tocca) — chiusa il 06/11 (OpenBao tolto).

Esecuzione, parte di codice (23/10, sessione cloud, ramo `claude/da-vault-codice`, livello completo; interruttori spenti):
- [x] passo 5, `src/lib/vault/`: `SecretStore` (tipi.ts), archivio a slot age (archivio.ts: cliente scrypt, Domarc X25519, TPM da `$CREDENTIALS_DIRECTORY/vault-key`), backend `locale` e `openbao` (solo fetch, AppRole, token 20 min, cache a tempo della cartella dell'app, `X-Domarc-Utente`, errore dichiarato oltre la cache), OpenBao finto per le prove — archivio 23, openbao 22, locale 6
- [x] passo 10: chiave degli slot dentro `encrypt()`/`decrypt()`, 2FA sulla chiave d'installazione (ADR 0034), ricifra (a vuoto di serie, `--applica`, tutto o niente, lettore unico, VACUUM, crash con SIGKILL), «Vault bloccato» (banner, job in pausa), «Mostra password» (2FA, 5 min, admin, registro e pagina), «Esporta in KeePass» (kdbxweb + Argon2id di hash-wasm, key file nel suo slot), `scripts/da-vault-recover.ts`, `scripts/da-vault.ts`, archivio nel backup notturno
- [x] passo 6: `credentials.credential_ref`, doppia lettura in `segreti.ts`, OpenBao dall'ambiente all'avvio, `scripts/da-vault-migra-openbao.ts` (a vuoto di serie, `--applica`, `--verifica`)
- [-] **in locale** (non fattibile dal cloud): container OpenBao nella VM di DA-Link (passo 1), app «Domarc Vault» in Entra, chiave Domarc age generata scollegata e messa in Keeper (passo 0), AppRole `da-ipam` dell'hub con `secret_id` in `LoadCredentialEncrypted`, CA in `NODE_EXTRA_CA_CERTS` — chiusa il 06/11 (OpenBao tolto).
- [-] **in locale**: migrazione sui dati veri dell'hub (`--applica`, `--verifica`, poi `DA_VAULT_OPENBAO=1`); campione SNMP/SSH/API provato — chiusa il 06/11 (OpenBao tolto).
- [-] **in locale**: appliance una alla volta, con la conferma di Riccardo per ciascuna: `crea` → `slot-tpm` (VM modello con `tpmstate0`) → unità con `LoadCredentialEncrypted=vault-key:…` → `DA_VAULT_LOCALE=1` e riavvio → `ricifra` a vuoto → `--applica` — chiusa il 06/11 (OpenBao tolto).
- [-] **in locale**: un'esportazione aperta con KeePassXC senza DA-IPAM (la prova usa kdbxweb) — chiusa il 06/11 (OpenBao tolto).
- [-] (scoperto) prima di svuotare le colonne cifrate sull'hub (versione dopo la doppia lettura): portare sul lettore unico le letture dirette (`credentials/trova.ts`, `apparato-archivio.ts`, `integrations/self-identity.ts`, `controllers/credenziale.ts`, `for_edit` di `/api/credentials/[id]`), poi svuota + VACUUM — chiusa il 06/11 (OpenBao tolto).
- [-] (scoperto) l'interfaccia `SecretStore` è ricavata dal piano: il documento originale (`~/Downloads/da-vault — Piano di implementazione.md`) non era nel repo; confrontarla — chiusa il 06/11 (OpenBao tolto).
- [-] (scoperto) «parte un avviso» quando il vault resta bloccato: oggi log CRITICAL + banner + Opzioni; manca un avviso nelle notifiche (email/webhook) — chiusa il 06/11 (OpenBao tolto).
- [-] (scoperto) cambio di generazione della chiave Domarc: oggi `da-vault-recover rotate` a mano; la riscrittura dello slot al primo sblocco (piano, «Più avanti») non è fatta — chiusa il 06/11 (OpenBao tolto).
- [ ] (scoperto) `kdbxweb` porta `@xmldom/xmldom` 0.7 con avvisi alti: forzato a 0.8.15 con `overrides` in package.json; da ricontrollare a ogni aggiornamento di kdbxweb
- [ ] (scoperto) `ENCRYPTION_KEY` resta sull'appliance per i segreti TOTP (ADR 0034): toglierla vuole un'altra soluzione per la 2FA
- [x] (24/10, sessione locale) PR #18 fusa (`17dddc68`) e rilasciata **v0.9.897**; PR #19 (ricarica della cache per un segreto mancante, secret_id illeggibile = errore controllato) **v0.9.898**
- [x] (24/10) passo 6 sull'hub in esercizio: AppRole `app-da-ipam` (IP NetBird dell'hub), `.env.local` con `DA_VAULT_OPENBAO*`, backup in `data/backups/*-pre-da-vault-openbao-20261023-223753.db`, 17 credenziali migrate, `--verifica` 0 diverse, `DA_VAULT_OPENBAO=1`; SNMP, SSH, AD, UniFi ok dopo l'accensione. Dettaglio: DA-Link `TASKS.md` (parte locale)
- [-] (24/10) passo 10 su un'appliance di prova: serve l'accesso alle appliance del laboratorio e la VM modello con `tpmstate0` (Deploy-Appliance); passo 11 dai clienti con la loro passphrase — chiusa il 06/11 (OpenBao tolto).
- [-] (24/10) **`vault.domarc.it` non è nel DNS**: sull'hub è in `/etc/hosts` (backup `/etc/hosts.bak-*`), da togliere quando c'è il record (Riccardo) — chiusa il 06/11 (vault.domarc.it ora risolve).


## 2026-10-23 — Uscita vera, istanza controllata e ricordata (livello completo, ADR 0033)

Riccardo (23/10): ok alla revoca della sessione; la scelta del cliente diventa «istanza», va in Impostazioni,
e si riparte dall'ultima usata; verificare sull'hub (unico multi-istanza) le Opzioni con un'istanza scelta.
- [x] prove `src/lib/accesso/__tests__/sessione.test.ts` viste fallire (5 su 6) prima della correzione, poi verdi
- [x] revoca all'uscita (`sessioni_valide_da`, `accessoAt`), cambio d'istanza controllato, ultima istanza
- [x] Impostazioni → Istanza, riga in sola lettura nella barra, «cliente» → «istanza» (resa locale a 1440, aperta e compressa)
- [x] scenario locale: dopo «Esci» `/` porta a `/login`; rientro sull'ultima istanza; un viewer non forza un'altra istanza né «tutte»
- [x] hub aggiornato a v0.9.891 (`scripts/update.sh --restart`, servizio ripartito 08:52 UTC); verificato con `prova-claude`:
  Opzioni si apre sull'istanza 70791 con gli interruttori, nessun «vista aggregata»; dopo «Esci» `/` porta a `/login`, sessione null
- [ ] sull'hub non provati col superadmin (prova-claude ha una sola istanza): scheda Istanza, scelta e rientro sull'ultima — li prova Riccardo
- [ ] Opzioni dice ancora «Cliente 70791 · …» e «questo cliente»: da portare a «istanza» (pagina di un'altra sessione attiva il 23/10)
- [ ] `next build --webpack` (solo in locale, serve col worktree perché Turbopack rifiuta `node_modules` in link) cade
  sulle rotte che esportano funzioni (`meshcentral/*`, `mac-product-map`): la build normale dell'hub passa. Non urgente

## 2026-10-23 — Idea: DA-IPAM per i portatili dei tecnici (da pensare, nessun codice)

Riccardo (23/10): «poi penseremo a una release di DA-IPAM da eseguire sui notebook dei tecnici, multi tenant con
meno funzioni». Da decidere: quali funzioni restano, da dove prende le istanze (hub? copia locale?), come si aggiorna.

## 2026-10-22 — da controllare (solo nota, niente lavoro fatto)

Riccardo (22/10): da verificare in un secondo momento, nessuna analisi fatta finora.

- [x] VLAN degli switch HP Comware: non sempre vengono rilevate tutte le VLAN.
- [x] VLAN degli switch HP Comware: le porte taggate (trunk) non vengono riconosciute.
- [x] Schermata VLAN: con troppe VLAN la tabella taglia le colonne più a destra (manca lo scorrimento orizzontale o l'adattamento).
- [x] Scansione switch: per default si abilita solo SNMP anche quando SSH risponde. Da decidere se è voluto (un protocollo basta) o se servono entrambi (es. SSH per VLAN/trunk dove SNMP è parziale, vedi Comware).
- [x] LibreNMS: aggiunta in batch di più oggetti, invece di uno alla volta dalla pagina Discovery.
- [x] LibreNMS: se l'integrazione è presente (configurata), gli oggetti che rispondono a SNMP si aggiungono in automatico. Da definire: quando (a fine scansione?), come si escludono, cosa si vede a schermo dell'esito.

## 2026-10-23 — Barra laterale compatta e cambio password

Riccardo (23/10): il blocco in basso della barra è brutto, logo più piccolo, «URL dell'hub» in Impostazioni,
comprimi ben visibile; scelta «tutto in alto». Segnalato: il cambio password non funziona.
- [x] causa del cambio password: `onSelect` (Radix) su un menu Base UI → `onClick` (provato in locale: la finestra si apre)
- [x] cambio password verificato sull'hub v0.9.894 (23/10, utente `prova-claude-admin`, dall'interfaccia): la finestra si apre dal menu,
  conferma diversa e password corrente sbagliata rifiutate, cambio riuscito, dopo «Esci» la vecchia non entra e la nuova sì
- [x] testata compatta con comprimi, utente ed Esci; tema nel menu utente; piede tolto (resa guardata a 1440 aperta e compressa)
- [x] «URL dell'hub» in Impostazioni → Sistema, `/agents` rimanda lì (provato in locale)
- [x] a menu compresso solo il simbolo (Riccardo, 23/10; resa guardata in locale a 1440)
- [x] «Esci» nel menu dell'utente e ritorno a `/login` deciso dal browser (sull'hub il server rispondeva `https://0.0.0.0/login`; provato in locale)
- [x] **«Esci» non chiude davvero la sessione** (trovato il 23/10, c'era già prima): le richieste della dashboard partite prima dell'uscita
  tornano dopo e rimettono il cookie, perché il proxy rinnova il JWT a ogni risposta (traccia: signout `Max-Age=0` a +495 ms,
  `/api/status/*` rimettono `authjs.session-token` a +525 ms, `/` riapre la sessione). Zona rossa (accesso): proposta a Riccardo, in attesa dell'ok.
- [-] guardarla sull'hub dopo l'aggiornamento — chiusa il 06/11 (hub aggiornato).

## 2026-10-23 — Assegnatari NIS2 da AD e utente prevalente dei PC (idea, da decidere)

Riccardo (23/10): «come possiamo determinare almeno dei PC gli utenti collegati? Nella voce NIS2 degli assegnatari
permettere l'importazione degli utenti da AD in modo semi-automatico con i dati registrati, proponendo quelli che
hanno nome e cognome e altre informazioni, e verificare se si possono collegare agli oggetti nel discovery o asset».

Cosa c'è già (origin/dev `646fe741`): `ad_users` sincronizzati (nome visualizzato, mail, reparto, ruolo, telefono,
ultimo accesso); `ad_computers.host_id`; raccolta WinRM in `lib/devices/device-info.ts` con `last_logged_on_user`
(registro LogonUI) e `logged_on_users` (Win32_LoggedOnUser) in `last_device_info_json`; agente GLPI con
`last_logged_user`; `asset_assignees` ha solo nome/mail/telefono/nota, `inventory_assets.asset_assignee_id`.
Decisioni di Riccardo (23/10): **sì, strada da prevedere come disegnata**; niente clienti solo su Entra (basta AD
locale); **Wazuh come fonte** dove è installato. Wazuh (verificato su origin/dev): gli alert dell'indexer hanno già
`data.win.eventdata.targetUserName`/`workstationName`/`ipAddress` + `agent.name` (li aggrega
`wazuh-alerts-stats.ts`); l'accesso riuscito 4624 è la regola 60106 (livello 3), da misurare se arriva all'indice;
i processi di syscollector (`wazuh_process`) non hanno il proprietario, quindi non servono.
Valori predefiniti proposti (Riccardo può correggerli): solo proposta con conferma, niente assegnazione automatica;
livello leggero. Prossimo passo: tavola grafica (pagina «Importa da AD» + riquadro proposta sull'asset), poi piano
breve ed esecuzione in una sessione nuova.
- [x] tavola grafica (23/10): https://claude.ai/artifact/64gZcjsoZQmrcoXJkV6eFf — elenco assegnatari (1-4),
      «Importa da AD» (5-11), scheda asset con proposta, chi si collega e i casi limite (12-18); **da approvare**
- [x] misura su Wazuh dell'hub .8 (23/10, sola lettura): tastiera 11 PC → 10 proposte; rete 38 postazioni → 30
      proposte; dettaglio e trappole nel piano
- [x] tavola e soglia approvate da Riccardo (23/10); **piano: `docs/superpowers/plans/2026-10-23-assegnatari-da-ad.md`**,
      da eseguire in una sessione nuova (i punti sotto sono dettagliati là)
- [x] storico delle osservazioni utente↔host (WinRM, GLPI, Wazuh 60106, eventi 4624/4768 dei DC) e «utente prevalente» per PC
- [x] `ad-client`: leggere anche givenName, sn, mobile, company, manager, employeeID, office; computer: managedBy
- [x] `asset_assignees`: legame con l'utente AD (guid), reparto, ruolo, origine; «Importa da AD» con proposta
      (abilitato, nome e cognome, mail, accesso recente, niente account di servizio) e conferma a spunte
- [x] proposta di assegnatario sull'asset dall'utente prevalente, mai sopra un'assegnazione manuale; utente AD
      disabilitato → asset da riassegnare
- [x] chi scrive `ad_computers.host_id`: `linkAdComputerToHost` nella sync AD e `relinkAdComputersForNetwork` dopo una scansione

Esecuzione (23/10, sessione nuova, livello leggero; passi del piano):
- [x] passo 1, schema: `migrateAssegnatariAd` (colonne, `host_accessi_utente`, indici) — prova `assegnatari-ad-migration.test.ts` 6/6
- [x] passo 2, AD: attributi in più e assegnatari legati riallineati dopo la sync — `raccolta.test.ts` (allineamento) verde
- [x] passo 3, raccolta degli accessi (Wazuh tastiera/rete, WinRM, GLPI) — `raccolta.test.ts` 7/7 con risposta finta della forma vera
- [x] passo 4, calcolo della proposta (funzione pura, provata) — `proposta.test.ts` 8/8
- [x] passo 5, API (anteprima/importazione AD, elenco, proposta sull'asset) + interruttore e soglie in Opzioni — `importa.test.ts` 5/5, prove di Opzioni 25/25
- [x] passo 6, interfaccia (elenco, «Importa da AD», riquadro sull'asset) — resa guardata sull'hub a 1440 coi dati veri
- [x] passo 7, cancello — tsc 0, lint 0 errori, 5882 prove / 0 rosse (worktree pulito), build 0. Nel clone del Mac 2 prove cadono solo perché c'è `data/ipam.db` di marzo (dipendono dalla macchina)
- [x] passo 8, v0.9.892-894 sull'hub .8 (`update.sh --restart`, health ok); giro acceso per 70791: primo giro 09:13 UTC, 992 righe in 31 finestre, tastiera 8 PC, rete 30 postazioni (misura: 11 e 38), 18 postazioni senza host; importati da AD 19 assegnatari (17 da qualcuno dalla pagina alle 09:16 UTC, 2 dal mio giro, copia `70791.db.bak-20261023-assegnatari`); proposte viste su PC-MIARI e PC-APADULA, «nessuna fonte» su PC-Soragni
- [x] passo 9, documenti: CHANGELOG, CONTEXT §6, scheda-mappa
- [ ] (aperto) WinRM ha dato 0 righe su 70791: nessun apparato Windows con l'utente collegato letto di recente; da guardare
- [ ] (aperto) 3 agenti Wazuh su 11 senza host: i loro accessi alla tastiera non entrano; e 18 postazioni di rete non trovate fra gli host
- [x] (aperto) nessun «Accetta» provato col clic sull'hub (prova-claude è in sola lettura): lo prova Riccardo; la scrittura è coperta dalle prove
- [-] (aperto) nell'AD di domarc.it il campo «Reparto» contiene il ruolo: dato loro, non un errore — chiusa il 06/11 (dato loro, non un errore).

Pagina «Abbinamenti» (Riccardo, 23/10, decisioni alle domande; livello leggero, tavola da approvare prima del codice):
- [x] tavola grafica sullo stesso canvas della prima (tavola 4, approvata il 23/10)
- [x] Inventario › **Abbinamenti**, voce nuova accanto ad Assegnatari, con rimando «N PC da abbinare» dalla pagina Assegnatari (v0.9.895, visto sull'hub a 1440)
- [x] **tutti gli host con accessi**, anche quelli non ancora in inventario
- [x] conferma **tutto in un clic**, a spunte: crea l'assegnatario da AD se manca, crea l'asset se manca, assegna (prove; non eseguita sull'hub)
- [x] asset già assegnati a un altro: sezione «Da rivedere», **senza spunta**; si sostituisce solo spuntando a mano
- [x] prima conferma vera sull'hub fatta da Riccardo (23/10, 16:25): 11 abbinamenti, 6 asset creati, diario a posto
- [x] Abbinamenti, asset con lo stesso nome (Riccardo, 23/10: «sì, ma un utente può avere asset multipli»): se esiste già un
  asset col nome del PC, la riga chiede «Collega a n. X» o «Crea nuovo» e non si conferma senza scelta. Il controllo è
  sul NOME del PC, mai sulla persona (più asset per persona è normale). Nato dal doppione NB-AGUZZOLI n. 31/36
- [ ] NB-AGUZZOLI n. 31 (IP .172, oggi un iPhone): rinominare o dismettere lo decide Riccardo; 5 host Discovery con quel nome
- Riccardo (23/10) «non vedo nulla»: il suo utente superadmin entra nella vista «tutte» e la scheda era aperta da prima
  dell'aggiornamento; i dati stanno solo in 70791 (scegliere l'istanza e ricaricare). Da confermare con lui.
- Scostamento (23/10): il giro orario non è un tipo nuovo di `scheduled_jobs` (il CHECK su `job_type` vorrebbe la
  ricostruzione della tabella, zona gialla) ma un timer di `server.ts` con interruttore per cliente in Opzioni, come il
  feed degli exploit. WinRM si legge dal giro (da `network_devices.last_device_info_json`), GLPI all'arrivo dell'inventario.

## 2026-10-22 — Opzioni complete e voce «Schedulazioni» nel menu

Riccardo (22/10): «raccogliere tutti i parametri che sono opzioni e inserirli tutti nel menu, e così una voce per
le schedulazioni che ora sono sparse». Decisioni (22/10, risposte alle domande):
- «Opzioni» (già nel menu, ADR 0032) si allarga dagli interruttori ai **parametri e soglie**, ognuno con descrizione
  e predefinito; chiavi API e password restano nelle loro pagine;
- voce nuova nel menu **«Schedulazioni»**: elenco unico (cosa, rete/controller, quando, prossimo giro, ultimo esito)
  con acceso/spento; «Modifica» apre la pagina che la configura oggi, niente moduli doppi;
- livello leggero; solo admin, modifiche nel diario; **tavola grafica da approvare**, poi piano breve ed esecuzione
  in una sessione nuova.

Censimento (22/10, origin/dev): parametri fuori da Opzioni nelle schede di `/settings` Scansione, Alert sicurezza,
Notifiche, Sistema, Aggiornamenti, e in `/settings/mdm` (intervallo, errori di fila). Schedulazioni in quattro posti:
`/settings?tab=jobs`, righe `gruppo: "job"` del catalogo, `SubnetScheduleCard` in `/networks/[id]` (edge-scan,
oggi in `fuori-catalogo.ts` come dato della rete: nell'elenco ci va col rimando), intervalli propri di MDM e dei
timer di `src/lib/vulcan/`.

- [x] Censimento puntuale dei parametri per scheda (chiave, dove si legge, predefinito) — 22/10 sera, su `6ee683f9`:
  - **Scansione** (`components/settings/scan-config-tab.tsx`, `tenant_settings` via `/api/settings`, letti da
    `/api/scan-config`): `quick_scan_concurrency` (6), `quick_scan_host_timeout_s` (10), `quick_scan_exec_limit_ms`
    (22000), `quick_scan_tcp_ports` (lista di serie dello scanner), `port_discovery` (già in Opzioni: `automatismo.naabu`),
    `naabu_bin_path` (vuoto = PATH); profilo Nmap (`nmap_profiles`: porte TCP/UDP, community) = **dato**, resta lì.
  - **Alert sicurezza** (`/api/integrations/wazuh/alerts/config`): `wazuh_alerts_self_ips`, `wazuh_alerts_self_accounts`,
    `integration_wazuh_device_rule_ids` = dati (elenchi nostri), restano; `notify_retention_days` (30, 1-365) = parametro.
  - **Notifiche** (`lib/notifications/config.ts`): canale SMTP/webhook = dati e segreti, restano;
    `notify_immediate_categories` (ransomware, log_tampering), `notify_immediate_min_level` (12),
    `notify_digest_interval_minutes` (60) = parametri.
  - **Sistema** (in `settings/page.tsx`): configurazione guidata, `PuliziaHostCard` (soglie in costanti: 60 giorni di
    assenza, 90 d'archivio, 400 di registro — oggi non si cambiano), scheda MDM, export/backup. Nessuna chiave nuova.
  - **Aggiornamenti** (`/api/system/update-channel`): canale = `DA_INVENT_BRANCH` in `.env.local` (voce da file); timer
    `da-ipam-update.timer` ogni 15 min (systemd, fuori dall'app).
  - **MDM** (`lib/integrations/mdm-config.ts`): `MDM_SYNC_INTERVALLO_MINUTI` 60 (ritmo del job `mdm_sync` creato
    all'accensione), `MDM_MAX_ERRORI_CONSECUTIVI` 5 (costante); URL, utente, password, campo utente = dati.
  - **Schedulazioni**, sei famiglie: (1) `scheduled_jobs` per cliente (16 tipi + `unifi_sync` per controller, +
    `apparati_scelti` creati da Discovery) — `/settings?tab=jobs` e Opzioni; (2) scansione rapida per rete
    `SubnetScheduleCard` in `/networks/[id]` (è un `scheduled_jobs` con rete); (3) Edge per rete
    (`lib/vuln/edge-schedule-store.ts`, cron sulla sonda) — `/networks/[id]`; (4) timer dell'app in `server.ts`:
    backup 03:00 (`DA_INVENT_BACKUP_CRON`), Chocolatey 02:00, feed exploit 06:00, salute appliance e job fermi ogni 30
    min, segnale DA-Link ogni 5 min, DA-Vul-can coda 1 min/battito 15 min/inventario 24 h; (5) `mdm_sync` (job, ritmo 60);
    (6) aggiornamento automatico (systemd, 15 min).
- [x] Tavola grafica di Opzioni allargata e Schedulazioni, approvata da Riccardo — pubblicata il 22/10 sera
  (https://claude.ai/artifact/MFg8HqVhyS4dEzwiDoo1LX, fogli «parametri e soglie» e «Schedulazioni», oggetti 14-30),
  in attesa dell'approvazione oggetto per oggetto. Lavoro nel worktree `.worktrees/da-ipam-opzioni`.
- [x] Tavola approvata da Riccardo il 23/10 («ok su tutto»): soglie fisse col lucchetto, gruppo dei job in Opzioni che
  resta, timer dell'appliance col lucchetto (senza DA-Vul-can né aggiornamento), niente «Esegui ora», scheda job invariata.
- Scoperto il 23/10: `quick_scan_concurrency`, `quick_scan_host_timeout_s`, `quick_scan_exec_limit_ms` li scrive la scheda
  Scansione ma **lo scanner non li legge** (`scanner/ports.ts` usa solo `DA_INVENT_NMAP_DISCOVERY_*`, di serie 12/10 s/22 s):
  in Opzioni col lucchetto e il valore vero; farli contare = proposta a parte (cambia il ritmo delle scansioni ovunque).
- Piano breve (livello leggero):
  - [x] A1 `opzioni/tipi.ts`: gruppo `parametri`, forme `numero` · `elenco` · `testo` · `fisso`; `parametro` (sezione,
        unità, min, max); `valore` fino a 2000 caratteri; «chi l'ha cambiato» in `opzioni.cambio.<id>` (hub), «Torna a di
        serie» cancella chiave e segno (`deleteSetting` nuovo in `db-hub`)
  - [x] A2 `opzioni/parametri.ts`: porte TCP, percorso Naabu, livello/categorie/riepilogo delle notifiche, conservazione
        eventi (scrivono con `setSetting`/`setNotificationConfig`, stessi limiti delle rotte); fissi: tre numeri della
        scansione (da file), 60/90 giorni della pulizia, 5 errori di MDM
  - [x] A3 prova di completezza: ogni chiave delle schede Scansione/Notifiche/Alert/MDM nel catalogo o in `fuori-catalogo`
        col motivo; prove su limiti (400), ritorno al di serie, segno di chi — `parametri.test.ts` 8 verdi; vista rossa
        togliendo il gruppo dal catalogo e una voce da `fuori-catalogo` (`quick_scan_concurrency: né in Opzioni…`)
  - [x] A4 pagina Opzioni: gruppo «Parametri e soglie» con sottotitoli, campo in riga, finestra per gli elenchi, lucchetto;
        schede vecchie: riga di riepilogo + «cambia da Opzioni ›» (Scansione veloce e Naabu, Quando notificare,
        Conservazione); il salvataggio delle Notifiche non manda più la politica
  - [x] B1 `lib/schedulazioni/elenco.ts`: righe da `scheduled_jobs`, controller senza job, Edge per rete, timer di
        `server.ts`; esito da `last_run`, fallimenti in serie dello scheduler (stato portato su `globalThis`, come
        `stato-scheduler.ts`), ritardo (`findStaleJobs`), MDM, hypervisor
  - [x] B2 `GET /api/schedulazioni`, `PUT /api/schedulazioni/[id]` (admin, registro come Opzioni; righe con opzione →
        `cambiaOpzione`, job semplici → `toggleJob` + ricarica; Edge e timer → 409 col posto dove si cambia)
  - [x] B3 pagina `/settings/schedulazioni` + voce di menu sotto Opzioni; prove di completezza (ogni tipo di job e ogni
        timer di `server.ts` ha la sua riga)
  - [x] C cancello (in DA-IPAM non c'è `scripts/controlla.sh`: lint, tsc, `npm test`, build come da CLAUDE.md) —
        23/10: lint 0 errori, tsc 0, `npm test` 5846 passate / 0 fallite, build ok; resa con playwright-core + Chrome
        (il Playwright MCP era occupato) a 1920 e 1280 sull'app locale con dati finti: niente scorrimento orizzontale,
        17 rifiutato col motivo, 10 salvato «cambiato da prova», «Torna a 12», categorie in finestra, SNMP spento da
        Schedulazioni con dialogo e registro, Edge ferma. Corretti in corsa: campo Naabu troppo largo, colonna Famiglia
        nascosta sotto 1536 (a 1280 esito e «Dove» uscivano di vista), doppio salvataggio Invio+uscita dal campo.
  - Proposte approvate da Riccardo il 23/10 («perfetto anche sulle proposte»), livello leggero:
    - [x] P1 scansione veloce: i tre numeri da Opzioni con chiavi NUOVE `scansione_veloce.*` (le vecchie `quick_scan_*`
          scritte dalla scheda di prima restano ignorate: un valore dimenticato non deve accendersi da solo al rilascio);
          ordine: Opzioni › file `.env.local` › di serie; stessi limiti del file (1-24 host, 5-20 s, 10-90 s)
    - [x] P2 soglie della pulizia per cliente (`pulizia.giorni_assenza` 30-365, di serie 60; `pulizia.giorni_archivio`
          30-365, di serie 90) e limite di MDM (`mdm.max_errori` 1-20, di serie 5), letti dove oggi ci sono le costanti;
          il minimo di 30 giorni è una mia scelta: la pulizia cancella righe
    - [x] P3 «Esegui ora» sulle righe dei job in Schedulazioni, con la rotta che c'è (`POST /api/jobs/[id]/run`)
    - [x] prove (viste rosse), cancello, resa, rilascio su `dev`, CHANGELOG/CONTEXT — 23/10: cancello intero verde
          (5848 passate, 0 fallite, build ok), poi tipi/lint/prove toccate/build dopo le correzioni a schermo; resa a
          1920 e 1280: 10 giorni rifiutato («da 30 a 365»), 45 salvato e letto dalla scheda Sistema, 16 host salvato,
          «Esegui ora» sul DNS → «girato alle 10:16», niente «Esegui ora» sulla pulizia. Corretti in corsa: «Torna a
          16 host» (il di serie leggeva il valore appena salvato; prova aggiunta), la scheda della pulizia diceva «60»
          fisso finché non si chiedeva l'anteprima.

## 2026-10-22 — Vulnerabilità per host ed exploit noti

Riccardo (22/10): in `/vulnerabilities` l'elenco anche per host/IP, e per ogni vulnerabilità se esiste già un exploit. Piano: `docs/superpowers/plans/2026-10-22-vulnerabilita-per-host-ed-exploit.md` (mockup approvato, livello leggero, via di Riccardo il 22/10: eseguito in questa sessione).

- [x] Riccardo: fonti CISA KEV + Exploit-DB + EPSS; selettore «Per vulnerabilità | Per host» nella stessa pagina; scaricamento giornaliero acceso di default
- [x] Passi 1-5 del piano (archivio, job, viste, interfaccia, cancello verde): stati e verifiche nel piano
- [x] Passo 6, hub: v0.9.880 installata e riavviata il 22/10 alle 19:24 (ora italiana), i tre feed scaricati senza errori alle 19:26
- [ ] Passo 6, cliente A: controllare che l'appliance scarichi i feed (Riccardo deve dire quale file del vault)
- [ ] Aperto: a 1280 px le ultime 2-3 colonne delle tabelle scorrono di lato (a 1920 ci stanno)

## 2026-10-22 sera — elenco degli aperti verificato su origin (18:30)

Riccardo ha chiesto di valutare l'elenco «cose da fare» della sessione «VLAN VMware in da-ipam». Confronto con i rami su origin alle 18:30 italiane:

- [x] MAC virtuali: non aspetta più nessuno, è in `dev` dalla v0.9.876 (voce S3 qui sotto chiusa).
- [x] Invio diretto all'hub con l'inventario: le regole ci sono (`DA-Vul-can/docs/operativo/contratto-ipam-hub.md`), A-IPAM è in v0.9.872, A-Link S7-S12a in esercizio; il primo inventario di 70791 è arrivato all'hub alle 16:18. Restano: il primo AD Health automatico (al prossimo controllo AD Health, vedi TASKS di DA-Link S12b) e A3 sull'hub (rotta e report dell'inventario, nessun piano ancora).
- [x] CIDR vero nei documenti: fatto in DA-Vul-can (`nome-rete.ts`, «LAN BASE · 172.16.0.0/17»).
- [x] Collector modulari: il giro 7 (riga in Opzioni per l'acquisizione con i collector, Proxmox agganciato al pulsante) è su `origin/collector-modulari` ma **non in `dev`**: 5 commit da unire, `dev` intanto è andato avanti di 4 (v0.9.877-878). Poi le due prove sull'hub scritte nella sezione «giro 7». — 08/11: mai unito; il ramo è stato tolto il 03/11 e il giro 7 resta solo nel tag `archivio/collector-modulari-20261103` (vedi C12).
- [ ] Controller UniFi: decisione di Riccardo fra (a) lasciarlo strumento da CLI, (b) fotografia per apparato dalla stessa lettura della sincronizzazione, (c) radio e client (sezione «giro 7» su `collector-modulari`).
- Restano aperti come scritti: collaudo HP della sede nuova (e lì si vede se «ArubaOS» è ArubaOS-Switch o AOS-CX), misure sul DB dell'hub, SSH rifiutato sugli Ubiquiti, NAS da ricollaudare, letture SNMP Comware incomplete (forse la stessa causa di VLAN e porte taggate mancanti). Rinviati di proposito: firmware e modelli in più, PoE/ottiche/sensori, LLDP, aggancio all'interfaccia per Comware, ProCurve, QNAP, VMware e NetApp.

## 2026-10-22 — difetti degli switch segnalati sulla sede 70151 (Comware, VLAN, LibreNMS)

Diagnosi in sola lettura sull'appliance 70151 (VM 104 su PX01, `qm guest exec`; v0.9.874) il 22/10 sera. Livello leggero.

- [x] Causa VLAN Comware: le 5 walk Q-BRIDGE (Static/Current) ricevono `SNMP_STATO_1` = *tooBig* (liste di porte IRF lunghe con GETBULK a 20 righe), riescono solo PVID e mappa del bridge (2/7); stessa causa per le porte taggate mancanti
- [x] Causa profilo: i 5 Comware (5900AF, 4× FF 5700) creati il 22/10 alle 14:19 con profilo `hp_switch_procurve` benché il sysDescr dica «HPE Comware Platform Software»: con quel profilo non si usano mai comandi e collector Comware
- [x] Aruba 2530/2540 della stessa sede: VLAN complete (21-24, taggate e non) — il lettore Q-BRIDGE va
- [x] Scoperto: l'appliance 70151 non si aggiorna più: «Aggiorna ora» segue il canale `main` (v0.9.873) ed è installata `dev` v0.9.874 → «retrocessione rifiutata» (15:21 e 15:38 UTC)
- [x] Riccardo (22/10): switch e router con le due acquisizioni sommate, SSH principale quando c'è ed è migliore, più SNMP
- [x] Riccardo (22/10): aggiunta automatica in LibreNMS estesa a tutti gli oggetti con SNMP verificato (non solo i vicini LLDP)
- [x] Walk SNMP: su *tooBig* riprova la stessa walk a blocchi più piccoli (5, poi 1) — 2 prove viste fallire poi verdi (`snmp-walk.test.ts`), suite 5789/0
- [x] Profilo HP dal sysDescr alla lettura delle informazioni (`profiloHpDaSysDescr`, solo profili switch HP; AOS-CX escluso) — 3 prove viste fallire poi verdi
- [ ] Lettura SNMP generale dei Comware: `TEMPO_SCADUTO` su 1-3 walk su 16 (IRF lento, già noto dal collector): da guardare dopo la VLAN
- [x] Canale di aggiornamento di 70151 su `dev` (ok di Riccardo 22/10): `DA_INVENT_BRANCH=dev` in `.env.local`, backup `.env.local.bak-20261022-164828`, aggiornamento avviato
- [x] Verifica VLAN dei Comware sul dato vero dopo l'aggiornamento a v0.9.879 — **non basta**: letture 19:02-19:06 ancora `SNMP_STATO_1` 2/7. Prova vera su HP5700-Core (22/10 19:57): *tooBig* anche con UNA riga (v1 GETNEXT e v2c a 1) sulle liste di porte (Static/Current Egress); i nomi arrivano tutti (29 VLAN) e il walk cade solo alla riga dopo l'ultimo nome (la prima lista di porte); PVID 91 righe ok. La riprova a blocchi piccoli resta valida per altri agenti ma qui la causa è la riga singola più grande del pacchetto massimo dello switch
- [ ] Comware: tenere i nomi delle VLAN quando il walk dei nomi cade per *tooBig* dopo righe lette (un nome non supera mai il pacchetto), matrice dai PVID segnata «dedotta» come per la ProMax
- [x] Codice: proiezione `proiettaVlan` (sezione `ok` → `switch_vlan*`, fonte «collector»), scritta da `applicaSnapshot` solo se cambia; il job SNMP orario non sovrascrive con una lettura senza tabelle VLAN — prove viste fallire (proiezioni 3, applica 2, job 1), suite 5809 (1 rossa a caso: tempi bcrypt, verde da sola)
- [x] 70151 (22/10 sera, ok di Riccardo): v0.9.881; credenziale SSH «HP-SW» legata a 20, 21, 22; «Interroga» ha corretto il profilo dei 5 in Comware (v0.9.879 sul dato vero); acquisizione col collector accesa; prima acquisizione: 5 snapshot `partial`, VLAN in errore per `SSH_EXEC_TIMEOUT` su `display interface brief` (limite di 4 s dell'app contro i 15 s del collaudo) → limiti per collector nel descrittore, prova vista fallire
- [x] 70151 v0.9.882 (22/10, 23:09 italiane): VLAN dal collector scritte su 4 Comware su 5 — HP5900-Route 29 VLAN/256 taggate, HP5700-NET 29/2778, HP5700-Core 29/860, HP5700-DR 29/755 (`switch_vlan_lettura.tabella=collector`, righe «VLAN» nel riquadro)
- [x] HP5700-Storage (id 22): `SSH_CONNECT_FAILED` con «HP-SW» — Riccardo: credenziale giusta, firmware vecchissimo. Proposta del server letta: solo kex SHA-1, `ssh-rsa`, cifrature CBC → AES-CBC in fondo all'elenco del client (prova con server ssh2 che offre solo quelle, vista fallire)
- [ ] Riccardo guarda la tab VLAN di HP5700-Core su 70151 (resa non vista da me: l'accesso admin dell'appliance sta solo nella VM)
- [x] HP5700-Storage su v0.9.883 (22/10, 23:22 italiane): SSH entra, 29 VLAN, 659 porte taggate, 167 non taggate. **5 Comware su 5 con le VLAN dal collector**
- [x] Comware: porte taggate via SSH — **scelta di Riccardo (22/10, strada 2)**. Il collector `hp-comware` legge già `display vlan all` con taggate/non taggate; manca la proiezione delle VLAN del collector in `switch_vlan*` (porta per nome → ifIndex) con precedenza sulla lettura SNMP che non riesce. Su 70151: credenziale SSH «HP-SW» (id 2) già legata e provata su 18 e 19; da legare e provare su 20, 21, 22 (porta 22 aperta su tutti); `acquisizione_modulare.attiva` assente (spenta); profilo Comware dal job delle 02:00 o da «Interroga». Scritture su 70151 con conferma di Riccardo
- [ ] Comware: in alternativa sullo switch `snmp-agent packet max-size` più grande (scrittura sull'apparato del cliente: decide Riccardo)
- Prompt per il resto del giro: [`docs/handoff/2026-10-22-prompt-switch-librenms.md`](docs/handoff/2026-10-22-prompt-switch-librenms.md) (Riccardo: ok a farlo in una sessione nuova)
- [x] Proposta di aggiunta switch/router: SSH principale + SNMP (oggi con SNMP principale non propone mai l'SSH: `proposta-apparato.ts`) — 23/10: solo piattaforme col protocollo predefinito SSH (Ubiquiti resta SNMP); 3 prove viste fallire, poi verdi
- [x] LibreNMS, lato server: candidati = apparati con binding SNMP riuscito o SNMP validata sull'host + host con SNMP validata (misura 70151: binding riusciti 4 su 16, SNMP validata su 76 host); tabella `librenms_esclusione` (`_v21`), rotta `/api/hosts/[id]/librenms/esclusione`; host aggiunto con la sua SNMP validata — prove viste fallire (giro, aggiunta), migrazione e rotta verdi
- [x] LibreNMS, interfaccia: esclusione e stato sulla scheda, liste «SNMP verificati» ed «Esclusi» nella pagina del modulo — tavola da approvare: [`docs/proposte/2026-10-23-librenms-esclusione-e-blocco.html`](docs/proposte/2026-10-23-librenms-esclusione-e-blocco.html) (oggetti 1-7) — **Riccardo 23/10: tavola approvata così com'è** (anche oggetti 8-9)
- [x] LibreNMS: migrazione `_v21` misurata su una copia del DB di 70151 (23/10 09:39 italiane: +1 tabella e il suo indice, hosts 243→243, integrity ok, copia cancellata); poi applicata dall'avvio della v0.9.885 (journal: «librenms esclusioni, aggiunto librenms_esclusione», segno `done:2026-10-23:v1`)
- [x] LibreNMS: aggiunta in blocco dalla Discovery — stessa tavola, oggetti 8-9 — 23/10: resa a 1280 e 1920 con `fetch` finto (scheda nei tre stati, card del modulo, finestra con i quattro esiti), nessun errore in pagina; esito per riga provato (`librenms-blocco.test.ts`, vista fallire)
- [x] Matrice VLAN: colonne e intestazione fisse, altezza limitata (barra orizzontale oggi in fondo a una tabella di ~2500 px) — 23/10: resa con Chrome a 1280 e 1920, 24 VLAN × 50 porte finte, scorrimento verticale e orizzontale
- [x] MikroTik CORE1/CORE2 (6 switch SNMP) senza VLAN: RouterOS non espone Q-BRIDGE via SNMP; servono SSH (`/interface bridge vlan`) o il collector
  - 23/10, letto nel codice: dare l'SSH non basta. Uno switch MikroTik usa la scheda degli switch (tabelle `switch_vlan`); in SSH la lettura SNMP degli switch è saltata (`jobs.ts`, ramo switch), la lettura delle VLAN di bridge (`letturaSchedaMikrotik`) parte solo nel ramo dei router e scrive le tabelle della scheda MikroTik, e la sezione VLAN del collector `mikrotik-routeros` esce sempre `partial` e senza ifIndex, quindi `proiettaVlan` non la scrive. Strada da scegliere con Riccardo
  - **Riccardo 23/10: strada «lettura SSH degli switch»** — il giro degli switch MikroTik in SSH fa anche la lettura delle VLAN di bridge (oggi solo router) e la scrive in `switch_vlan` (porta per nome → ifIndex); la lettura SNMP resta accanto
  - [x] 23/10, codice: `letturaVlanSwitchMikrotik` (giro, «Interroga», apparati scelti) → `switch_vlan` con fonte «mikrotik»; le porte via SNMP accanto all'SSH le dava già il client combinato degli switch. Prove viste fallire (proiezione, regola delle letture), prova del giro aggiornata (SW-7 ora legge via SSH)
  - [x] 70151 (23/10, ok di Riccardo): aggiornata a v0.9.885 con `update.sh --restart` (health 200 sulla 3001); backup `DEFAULT.db.bak-20261023-074025`; credenziale SSH id 1 (quella del router) legata ai CORE 12-17, protocollo SSH porta 22, SNMP accanto; lettura VLAN lanciata subito: **6 su 6 letti**, 20-31 VLAN, 159-204 porte/VLAN, 9-14 PVID, 0 porte senza mappa (`switch_vlan_lettura.tabella=mikrotik`)
  - [ ] Riccardo guarda la tab VLAN di un CORE (es. CORE1-241) su 70151: resa non vista da me
  - [ ] **Token API di LibreNMS di 70151 da rigenerare** (Riccardo): 48 caratteri finiti nel trascritto il 23/10 (`. .env.local` con uno spazio nel valore di `LIBRENMS_API_TOKEN`); lezione in `~/.claude/lezioni/DA-IPAM.md`
  - **Riccardo 23/10: ok alle scritture su 70151** quando PX01 torna raggiungibile: credenziale SSH del router MikroTik legata ai 6 CORE, SSH principale con SNMP accanto, «Aggiorna ora» a v0.9.884+ (prima la migrazione misurata su una copia)

## 2026-10-21 — S3, un elenco solo dei MAC virtuali (ramo `s3-mac-virtuali`)

Piano: `docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md` (ramo `collector-modulari`), blocco S3, controllo completo.

- [x] Prova `devices/__tests__/mac-virtuali.test.ts` vista rossa (la mappa non riconosceva HSRPv2), poi verde.
- [x] `devices/mac-virtuali.ts` puro; `topology/identity.ts` e `devices/physical-device-db.ts` lo usano (riesportato, chiamanti invariati).
- [x] Prove di topologia, apparati e MeshCentral: 1292 verdi; `tsc` e lint verdi.
- [x] Misura in sola lettura sui DB dell'hub: 0 MAC cambiano esito (oltre 13 milioni letti).
- [x] Riccardo: unire in `dev` e rilasciare — unito il 22/10 (e1f15243, ramo `integra-20261022`), uscito con v0.9.876 sull'hub; resta facoltativa la stessa misura sull'appliance del cliente A.
- Nota: le righe di `device_interfaces.is_virtual_mac` scritte prima restano come sono (si ricalcolano alla scrittura successiva); sull'hub non ce n'è nessuna da correggere.

## 2026-10-22 — Letture degli apparati accese di serie (ADR 0031)

Livello leggero, approvato da Riccardo il 22/10 dopo 70151 (VLAN del router mancanti perché la lettura nasceva spenta).

- [x] Chiave assente/rovinata = accesa in `leggiInterruttore`; la mappa nuova resta spenta
- [x] Testi della pagina «Dati della mappa» («accesa di serie»)
- [x] Prove: 49 che davano per scontata la partenza spenta ora la dichiarano; prova nuova sul valore di serie
- [x] ADR 0031, CHANGELOG
- [x] Cancello (lint 0, tsc 0, prove 5366/0 fallite, build 0), release v0.9.873, push su dev
- [x] Appliance di 70151 aggiornata a 0.9.873 (14:20 italiane, health 200)
- [x] Scoperto: su 70151 nessun job legge gli apparati (niente `arp_poll` né scansioni): creato `arp_poll` ogni 30 min (job 4, ok di Riccardo)
- [x] Verifica sul router 172.20.40.102: primo giro 15:00 italiane, letture 6/6 e 4/4 comandi, 19 VLAN, 26 VLAN di bridge, 1 bridge
- [x] Pagina unica delle opzioni + job di serie: censimento (34 interruttori in 13 pagine), tavola approvata, spec e piano scritti
- [x] Promote dev → main v0.9.873 (85662969), chiesto da Riccardo il 22/10
- [x] Esecuzione del piano [`2026-10-22-pagina-opzioni.md`](docs/superpowers/plans/2026-10-22-pagina-opzioni.md) (9 task, leggero; 8 = aggiornamento che non retrocede + installatore, 9 = errore SSH), avviata il 22/10 sera nel worktree `.worktrees/da-ipam-opzioni`; ordine 1-6, 8, 9, poi 7 (Riccardo:)
  - [x] Task 1-9 · v0.9.874 su dev (42c5ba90), Deploy-Appliance e9a1fda su main; 70151 aggiornata e verificata (job 8-11 nati, ARP job 4 invariato); consuntivo nel piano
  - [-] Riccardo apre `/settings/opzioni` su 70151 — chiusa il 06/11 (superata).
  - [x] Promote dev → main (chiedere a Riccardo)
  - [x] Hub: guardare i job di serie nati al suo prossimo aggiornamento (oggi fermo a 0.9.872)
  - Trovato: la spec rimanda al censimento del §1, che nel file non c'era; recuperato dal trascritto della sessione di progettazione, va nella spec col Task 6

## 2026-10-22 — LibreNMS come fonte di dati degli apparati SNMP

Spec [`docs/superpowers/specs/2026-10-22-librenms-fonte-dati-design.md`](docs/superpowers/specs/2026-10-22-librenms-fonte-dati-design.md), piano [`docs/superpowers/plans/2026-10-22-librenms-fonte-dati.md`](docs/superpowers/plans/2026-10-22-librenms-fonte-dati.md) (10 task; livello leggero dal 22/10, zone rosse invariate; stato: approvato, S1-S5 e tavola S6 sul ramo `librenms-fonte`). Prova in sola lettura sull'hub il 22/10: LibreNMS ha 3-4 volte porte, vicini e MAC dei nostri motori, più 1160 sensori.

- [x] Prova in sola lettura sull'API di LibreNMS dell'hub e confronto con il DB 70791 (spec §2)
- [x] Spec e piano scritti
- [x] Riccardo (22/10): leggero; vicini aggiunti in automatico se l'SNMP risponde; i 5 server mai interrogati quasi certamente senza SNMP (si verifica nel task 4, poi si propone di toglierli); container LibreNMS già aggiornato. Registro del piano. In coda dietro i collector modulari.
- [x] Uscite vere per S3 raccolte sull'hub (sola lettura) e anonimizzate a chiusura: fixture in `src/lib/integrations/__tests__/fixtures/librenms/`; `ports_vlans` dà 404.
- [x] Giro cloud LibreNMS 1 sul ramo `librenms-fonte`: S1-S5 e la tavola S6 (prompt `docs/handoff/2026-10-22-prompt-cloud-librenms.md`). Non rilasciato: niente `version:release` sul ramo (lo si fa all'unione in `dev`).
- [x] Piano approvato da Riccardo (livelli compresi) — 22/10, Registro del piano
- [x] T1 aggiunta senza force_add, v1/v2c/v3 — rifiuto in `librenms_rifiuto` (tabella in più rispetto al piano) e nel `last_status` di una riga di mappa che c'era; AES256C non accettato (fuori tabella); `probe()` ora riconosce 401/403
- [ ] T1 sull'hub (locale, dopo l'unione in `dev`): «Aggiungi a LibreNMS» su un IP senza SNMP scelto da Riccardo → rifiuto visibile, `/api/v0/devices` stesso numero
- [x] T2 migrazione librenms_fonte_v21 — 10 tabelle + 2 indici; provata su DB nuovo e su DB con lo schema di oggi (< 50 ms in memoria)
- [x] T2 sulla copia dell'hub (22/10, locale): `70791.db` 2,0 GB, segno `done:2026-10-22:v1`, 11 tabelle, `integrity_check` ok, apertura+lettura ~3 s
- [x] T3 client e lettori con uscite vere anonimizzate — una forma sconosciuta per parte (`fixtures/librenms/forma-sconosciuta/`); il `vlan_id` dell'FDB è l'id di riga delle VLAN (si traduce); VLAN per porta assente (404)
- [x] T4 scrittura e giro nel job librenms_sync — interruttore `librenms` spento; vicini non interrogati aggiunti da soli (5 per giro, rifiutati riprovati dopo 24 h); `scripts/prova-librenms-fonte.ts` provato contro un LibreNMS finto
- [x] T4 prova a vuoto con l'API vera (22/10, locale, LibreNMS 26.10.2, exit 0): 51/1086/109/76/3280/3055/1160, inventario 20 per giro, 5 non interrogati, 10 vicini da aggiungere, ~2 s. Era: prova a vuoto con l'API vera sulla copia dell'hub (locale): `printf '%s' "$TOKEN" | npx tsx scripts/prova-librenms-fonte.ts <copia> --cartella <scratch> --url http://127.0.0.1:8090` (con un tunnel); numeri contro spec §2, versione di LibreNMS; poi decidere se tenere l'aggiunta automatica accesa al primo giro sull'hub
- [ ] T4 i 5 server mai interrogati: prova SNMP con la credenziale dell'apparato (locale, traffico verso gli apparati), poi proporli per la rimozione
- [x] T5 rotte API — `GET /api/hosts/[id]/librenms/dati`, `GET`/`POST /api/integrations/librenms/candidati`; guardie predefinite, `rotte-censite` verde
- [ ] T5 `bash scripts/verifica-permessi.sh` con l'app accesa (locale)
- [x] T6 tavola grafica approvata (22/10: L1 limiti di avviso di LibreNMS o 10%, L2 Alias solo se presente, L3 due righe, L5 nella pagina del modulo) — era: tavola grafica approvata — `docs/proposte/2026-10-22-librenms-interfaccia.html` (L1-L5 e 4 domande in fondo), in attesa di Riccardo
- [x] T7 scheda: Sensori, Porte e Vicini con fonte (cloud 22/10 giro 2; resa vista a 1440 e 1920 con dati finti)
- [ ] T7 resta: provare la scheda con dati veri dopo l'accensione sull'hub (T10); limiti di avviso di LibreNMS non letti (solo il 10%)
- [x] T8 pagina del modulo (cloud 22/10 giro 2; resa vista a 1440 e 1920): non interrogati, rifiutati, candidati — nota: la card «Letture in più» mostra «Nessuna lettura ancora» per LibreNMS (gli esiti sono per parte, non per apparato): l'esito per parte va in L5
- [ ] T9 vicini nella mappa (zona rossa, misura prima/dopo)
- [x] T10 accensione sull'hub, ADR, documenti

## 2026-10-22 — scansione automatica dei device scelti

Piano: [`docs/superpowers/plans/2026-10-22-scansione-automatica-da-discovery.md`](docs/superpowers/plans/2026-10-22-scansione-automatica-da-discovery.md) (10 task; giro e migrazione livello completo, interfaccia leggero; stato: bozza da approvare). Tavola approvata il 22/10: artboard `ScansioneAutomatica` (J1-J4) del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv. Risponde anche al punto (a) qui sotto (job `arp_poll` sull'hub).

- [x] Piano approvato da Riccardo (22/10: tavola «si va benissimo», piano «ok»)
- [x] T1 tipo `apparati_scelti`, CHECK v11 di `scheduled_jobs`, tabella `job_apparati_esiti` (misura sulla copia dell'hub) — v0.9.861; v11 sulla copia 3-4 ms, 23 job identici, integrity ok; revisione completa: approvato (una colonna sconosciuta ora blocca la ricostruzione)
- [x] T2 regole pure: config, frequenze (ogni ora · ogni 4 ore · ogni giorno alle HH:MM), idoneità, letture valide — regole pure; il job segue l ora italiana (fuso esplicito); revisione completa: 1 importante (fuso) corretto
- [x] T3 funzioni DB: stato degli apparati in una query, esiti per apparato — una query per 50 id, db.test 11 casi rosso poi verde
- [x] T4 letture estratte da «Interroga» e dal giro ARP, lucchetto per apparato, log senza nomi né IP — lucchetto in comune fra scheduler e rotte (globalThis), 5 min per apparato, log senza nomi né IP; le 90 prove del giro invariate; revisione completa: 1 grave (lucchetto non condiviso) corretto
- [x] T5 il giro `apparati_scelti` nello scheduler (prova a vuoto sulla copia dell'hub) — giro in serie con esito per apparato; «saltato» se niente da leggere; idoneo anche con binding riuscito (decisione nel registro); prova a vuoto sulla copia; revisione completa: 1 grave corretto. Nota per T10: i 5 switch Ubiquiti hanno il binding SNMP mai provato → prima «Prova credenziali»
- [x] T6 rotte API (anteprima, creazione, modifica, esiti, testata) — rotte con guardie (scrittura solo admin), anteprima con valutaApparato, /api/jobs generico non può creare né cambiare la frequenza di questi job; revisione completa: approvato
- [x] T7 Discovery: pulsante e finestra (J1, J2), resa 1440 e 1920 — J1-J2 in Discovery, viste a 1440 e 1920
- [x] T8 pagina dei job: riga ed esiti per apparato (J3), resa 1440 e 1920 — viste sulla copia; salvataggio della modifica non provato a schermo
- [x] T9 testata della scheda: pastiglia (J4), resa 1440 e 1920 — viste sulla copia
- [x] T10 accensione sull'hub (con l'ok di Riccardo per creare il job), ADR 0030, CHANGELOG, CONTEXT, scheda-mappa — sull hub (22/10 11:24 ora italiana): credenziali SNMP di 5 switch e del router provate, job #25 «Switch e router del CED» ogni 4 ore con 6 apparati, primo giro 6 letti su 6 in 83 s; servizio riavviato perché lo scheduler veda il job; backup /root/70791.db.bak-20261022-092258-prima-job-apparati. Revisione finale: 3 importanti corretti (modifica che restringeva il job, VLAN tolta in silenzio, «Esegui ora» sovrapponibile)
- [x] Consuntivo scritto nel piano; ADR 0030 non scritto (resta aperto, sotto)
- [x] ADR 0030 «job sugli apparati scelti» con «cosa diventa difficile» (lucchetto in memoria, due letture sovrapponibili dopo il timeout dei 5 minuti) → scritto il 22/10
- [x] SW-UFLEX-RG-10GB (apparato 9): IP 192.168.40.240 morto dal 06/10 e assente dal controller UniFi, quindi fuori dal job #25: serve da Riccardo l'IP attuale (sostituisce il punto (c) sotto) → Riccardo 22/10: non è più attivo; apparato 9 disattivato (enabled=0, non cancellato).
- [ ] ProMax: PVID SNMP diverso dalla nativa del controller su 6 porte su 14 (vedi riga più sotto); finché non si rivede la lettura Q-BRIDGE il job la rilegge ma la matrice resta «dedotta» — Riccardo 22/10: forse porte aggregate (LAG); da verificare con la lettura dei LAG.
- [ ] Panoramica switch: con i filtri «Trunk» / «Tutte» la pagina scorre ancora di ~150 px a 1440×900 (vedi riga più sotto)
- [ ] J4: la pastiglia nello stato «spenta» (job sospeso) non è stata vista a schermo, solo con e senza job
- [ ] Un job creato da script ha bisogno di un reload o riavvio dello scheduler; se capita ancora, aggiungere un modo per ricaricarlo

## 2026-10-22 — accorpamento IP e matrice VLAN degli switch

Piano: [`docs/superpowers/plans/2026-10-22-accorpamento-ip-e-vlan-switch.md`](docs/superpowers/plans/2026-10-22-accorpamento-ip-e-vlan-switch.md) (12 task + 1 rimandato; A leggero, B leggero con misura sulla copia dell'hub, C completo; stato: eseguito e acceso sull'hub il 22/10, aperti (a)-(f)). Grafica: artboard `Discovery` e `SwitchVlan` del canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv.

- [x] Piano approvato da Riccardo (22/10: tavole «ok», «eseguilo qui», «non fare altre domande, procedi fino al live»): i dubbi in fondo al piano si risolvono col consiglio del piano
- [x] T1 blocco di «Rendi apparato» sul server (`apparatoGiaPresente`, 409, anche `/api/devices/bulk`)
- [x] T2 blocco nella finestra, singolo e in blocco, con link all'apparato
- [x] T3 principale del cluster (`physical_devices.primary_host_id`, segno `cluster_principale_v21`) + elenco per nome delle righe nascoste sulla copia dell'hub — v0.9.849; sull hub: 7 cluster, 17 righe da nascondere, tutti i principali sono IP di apparati; cluster 10 e 11 (iLO HPE + schede dello stesso server?) da confermare con Riccardo; migrazione 2 ms, integrity ok; revisione: approvato
- [x] T4 API di Discovery con il cluster, tempo misurato sulla copia (soglia +10 % o +50 ms) — v0.9.850; tempo invariato sulla copia (36-43 ms prima, 39-41 dopo), risposta +0,4 %; principale offline resta principale (la riga non balla a ogni scansione)
- [x] T5 Discovery: secondari nascosti, «+N IP», ricerca sugli IP secondari, contatori spiegati — v0.9.851; resa a 1440 vista (+6 IP sul router, ricerca 192.168.16.254, subnet 16 con l IP ancora dentro)
- [x] T6 «Scegli come principale» e scelta nel «Collega altro IP» — v0.9.852; con un apparato nel gruppo il principale è il suo IP e il pulsante non c'è; senza apparato: «Scegli come principale» (solo admin); il pulsante non visto a schermo (sull hub ogni cluster ha un apparato), coperto dalle prove
- [x] T7 lettore Q-BRIDGE con le uscite vere di SW-CED-48POE-242, SW-CED-16XG-241, SW-ING-ProMax-239 — v0.9.853; esposto dai tre switch: 48POE e 16XG tabelle complete (13 VLAN), ProMax senza nomi né mappa del bridge e porte in ordine inverso; porte da Current (il 16XG mente nella Static); U della ProMax dedotta dal PVID; revisione completa: 1 importante (lettura parziale data per buona) + 3 minori corretti
- [x] T8 tabelle `switch_vlan*` (segno `switch_vlan_v21`), ADR 0029, prova a vuoto su copia hub e cliente A — v0.9.854; ADR 0029; migrazione sulla copia dell hub 41 ms, integrity ok; copia del cliente A non disponibile (decisione del controllore nel registro); revisione completa: 1 medio corretto (righe doppie ora con avviso)
- [x] T9 lettura `switch_vlan` spenta di default, nel giro ARP (una volta l'ora) e in «Interroga» — v0.9.855; spenta = nessuna walk nuova; accesa sull hub: 6 switch Ubiquiti, 42 walk/ora; «Interroga» da admin legge subito se accesa; revisione completa: approvato (3 minori passati al T11)
- [x] T10 matrice VLAN condivisa estratta dalla scheda MikroTik (aspetto invariato) — v0.9.856; matrice in `components/scheda/matrice-vlan.tsx` + `lib/scheda/matrice-vlan.ts`; la tab VLAN del MikroTik è identica byte per byte prima e dopo
- [x] T11 tab VLAN dello switch: striscia VLAN/trunk/access/senza VLAN + matrice — v0.9.857; striscia e matrice viste a 1440 e 1920 sulla copia (48POE 13·45·7·0, ProMax 13·31·1·20 «dedotta»); revisione completa: approvato + 4 minori corretti
- [x] T12 accensione sull'hub e verifica sul dato vero — hub v0.9.858 (22/10, 04:05): migrazioni `cluster_principale_v21` e `switch_vlan_v21` fatte (righe nel journal); lettura `switch_vlan` ACCESA («procedi fino al live»); lettura fatta una volta da script: 5 switch letti, 13 VLAN ciascuno, SW-UFLEX-RG-10GB (apparato 9) TEMPO_SCADUTO; tab VLAN di SW-CED-48POE-242 vista con i nomi veri; la Panoramica ora conta 13 come la tab (831c88d5); Discovery: 7 cluster, 17 righe nascoste; correzioni della revisione finale 4cf651d8 (filtri e ricerca anche sui secondari, CSV «Altri IP», blocco anche su PUT host e DHCP AD) e ratchet di `db.ts` (df2e7dc3); CONTEXT, CHANGELOG, scheda-mappa aggiornati
- [x] (a) job `arp_poll` sull'hub: il job `apparati_scelti` #25 (22/10) legge già ogni 4 ore router e switch scelti; da chiudere se Riccardo conferma che basta (decide lui)
- [ ] (b) cluster 10 e 11 (iLO HPE + schede di rete dello stesso server?) da confermare con Riccardo
- [x] (c) SW-UFLEX-RG-10GB (apparato 9) non risponde a SNMP (TEMPO_SCADUTO): community, ACL o SNMP spento sullo switch → Riccardo 22/10: non è più attivo; apparato 9 disattivato (enabled=0, non cancellato).
- [x] (d) T13 completamento dal controller UniFi (ok di Riccardo 22/10): lista bianca + `GET rest/networkconf`, native in `switch_vlan_nativa` dalla sync UniFi (solo con `switch_vlan` accesa); ProMax 14 porte completate, resta «dedotta» (18 porte senza nativa dal controller); prove `unifi-vlan-native`, `vlan-switch`, `unifi-api`; resa a 1440 vista sulla copia
- [x] (e) il blocco «un IP, un apparato» va aggiunto anche in `unifi-sync` prima di accenderlo (oggi spento)
- [ ] (f) le migrazioni sulla copia del cliente A (MikroTik v1-v3, cluster, `switch_vlan`) non sono mai state misurate: la copia non era disponibile
- [ ] ProMax: PVID SNMP diverso dalla nativa del controller su 6 porte su 14 confrontabili, e l'SNMP non dà le porte 33-52 (sugli altri 4 switch 99/99 uguali): la lettura Q-BRIDGE della ProMax (bit «inversi», ifIndex) è da rivedere — Riccardo 22/10: forse porte aggregate (LAG); da verificare con la lettura dei LAG.
- [ ] Native del controller senza scadenza: se uno switch esce dal controller o la lettura `switch_vlan` si spegne e riaccende, le righe di `switch_vlan_nativa` restano (l'età si vede da `nativa_letta_il` nella riga delle fonti); da decidere se farle scadere
- [x] Sull'hub la nativa si scrive al primo giro di `unifi_sync` #22 (03:00) dopo il rilascio: verificare `switch_vlan_nativa` il giorno dopo
- [x] Panoramica dello switch sull hub (SW-CED-48POE-242): scorreva di ~190 px a 1440×900. Il riquadro mostrava già 5 VLAN: a far scorrere era la colonna destra (dettaglio + vicini + VLAN). Ora VLAN a 8 voci (due colonne da 4) sotto «Porte da guardare», «tutte (N) ›» verso la tab: a 1440×900 entra (scrollHeight 900, vista sulla copia).
- [ ] Con un filtro a chip che riempie la tabella (Trunk 7, Tutte) la pagina scorre ancora di ~150 px: la tabella arriva a 230 px e il riquadro VLAN sta sotto. Da decidere se accettarlo (vista di lavoro scelta dall'utente) o accorciare la tabella.

## 2026-10-22 — invio AD e inventario a DA-Vul-can (A-IPAM)

Piano: [`docs/superpowers/plans/2026-10-22-invio-ad-inventario-a-vulcan.md`](docs/superpowers/plans/2026-10-22-invio-ad-inventario-a-vulcan.md) (9 task, livello completo, eseguito il 22/10). Oggi l'AD arriva all'hub solo a mano (download qui, «Carica» là): il piano aggiunge l'invio automatico, inventario e battito; spento senza `VULCAN_TOKEN`.

- [x] Piano approvato da Riccardo — Riccardo 22/10: «andiamo avanti», eseguito qui
- [x] T1 chiavi `VULCAN_URL`/`VULCAN_TOKEN` da `oggetto.env` e cliente dell'invio — gettone mai in log/errori/risposte (18 prove); file rifiutato se non root, link simbolico o permessi ≠ 600
- [x] T2 coda `vulcan_coda` nel DB del cliente (segno `vulcan_coda_v21`), misura sulla copia 70791 — migrazione sulla copia 7 ms, integrity ok; revisione completa: 1 medio corretto (inventario superato non torna in coda)
- [x] T3 invio automatico AD Health a fine esecuzione (riusa `toHubExport`, il download resta) — l export AD va in coda a fine esecuzione solo col gettone; le 8 esecuzioni della copia passano lo schema dell hub
- [x] T4 inventario a lista bianca (prova dei campi «Mai»), misura dei byte sulla copia 70791 — copia 70791: 351 oggetti, 226 KB, 19 KB gzip, 3 ms; sentinella sui campi «Mai» vista fallire su un costruttore sbagliato; revisione completa: approvato
- [x] T5 trasporto HTTPS gzip verso l'hub (TLS normale) — TLS verificato sempre (prove rosse togliendolo), gettone solo nell intestazione, risposta limitata a 64 KB
- [x] T6 giro: coda, ping, battito, audit JSONL — giro entro 8 minuti, sospensione su gettone rifiutato salvata nel DB, audit senza dati personali; revisione completa: 1 importante corretto (invii doppi con hub lento)
- [x] T7 timer in `server.ts` (nessuna chiamata senza gettone) — senza gettone solo la lettura della config, timer una volta per processo, inventario alle 03:00 italiane + recupero oltre 26 h
- [x] T8 riquadro in «Cosa esce», «Invia ora», riga nella pagina AD — riquadro in «Cosa esce» (oggi «Spento: manca VULCAN_TOKEN»), «Invia ora» solo admin, riga nella pagina AD; revisione completa: approvato
- [x] T9 collaudo contro DA-Vul-can di sviluppo, documenti, copie cancellate — 22/10, DA-Vul-can origin/HEAD in locale (DB vuoto, CA di prova solo per il collaudo): spento 503 → in coda; acceso AD 201, battito 200, inventario 201 (351 oggetti), doppione 200 senza seconda riga, 401 e 403 → «sospeso»; worktree, CA e copie rimossi; CHANGELOG, CONTEXT §6, consuntivo nel piano
- [x] Rilascio su `dev` e verifica sul live (hub e cliente A «Spento», nessuna riga `[vulcan]` nel journal) — al controllore → hub v0.9.872 (22/10 13:16 ora italiana): migrazione vulcan_coda_v21 fatta, coda vuota, nessuna riga [vulcan] nel journal. Cliente A: arriva col suo aggiornamento da dev, non verificato da qui.
- [x] Fuori piano, da seguire: A-Link (`tipo:"ipam"`, chiavi in `oggetto.env`, policy P9 con conferma), A3 sull'hub (rotta inventario, nessun piano su origin al 22/10), nome `da-vulcan.domarc.it` fissato sull'appliance

## 2026-10-22 — topologia: spazio in basso, cavi a mano, server non agganciati

Livello leggero. Worktree `.worktrees/da-ipam-topologia` da `origin/dev` (il `dev` locale ha 18 commit dei collector non pubblicati).

- [x] altezza della mappa: 4rem da scrivania, 6,5rem sul telefono (era 9rem, della barra tolta il 20/10)
- [x] partenza finale (hypervisor trascinato prima di collegarlo) che restava sola: radice solo se nessuno la raggiunge — prova vista rossa 2/4, poi verde
- [x] il cavo a mano vince sempre (decisione di Riccardo, 22/10): chiave del Prim e principale forzato degli oggetti finali; aggiornate 2 prove di `cavi-albero` che fissavano la regola vecchia
- [ ] server/hypervisor non agganciati dalla tabella MAC: da misurare sull'appliance 192.168.99.51 (l'impronta ssh è cambiata e il vault non la riporta: serve la conferma di Riccardo prima di fidarsi); la copia locale dei dati è di luglio
- [x] rilascio v0.9.845 su dev, hub aggiornato (01:59 ora italiana, salute ok); resa a 1920×1080 con `prova-claude`: la mappa finisce a 12 px dal fondo
- [x] `db-facade-ratchet` rosso già su origin/dev (265 funzioni in db.ts, soglia 262): non è di questo lavoro, l'ha lasciato la scheda MikroTik → sistemato il 22/10 (df2e7dc3: tre funzioni spostate in db-tenant, soglia 262 rispettata).

## 2026-10-21 — scheda MikroTik copiata dal Manager

Piano: [`docs/superpowers/plans/2026-10-21-scheda-mikrotik-dal-manager.md`](docs/superpowers/plans/2026-10-21-scheda-mikrotik-dal-manager.md) (blocchi P1-P4; P5 fuori). Tavole `Mk*` approvate il 21/10 nel canvas https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv. Livello: P1-P2 leggero, P3-P4 completo.

- [x] T1 uscite vere del router dell'hub, fixture anonime in `src/lib/devices/__tests__/fixtures/mikrotik-*.txt`. DA-RT-CORE: 1 bridge con `vlan-filtering=yes`; `topologia.lettura.mikrotik` accesa sull'hub (15/10); apparato 1 con `physical_device_id`; pool DHCP: né (a) né (b), 8 server e 8 pool coerenti → causa ancora da trovare (T3). Trovato: i server DHCP disabilitati hanno il flag `X` in testa, il parser legge solo `disabled=` e li dà attivi
- [x] T2 risorse, hardware, firmware aggiornabile, seriale da routerboard (P1) — poi Riccardo preme «Aggiorna» su MK-RTR-CORE sull'hub — v0.9.832; i dati compaiono dopo un «Aggiorna» su MK-RTR-CORE
- [x] T3 interfacce con stato/MTU/commento dal giro ARP, stato ARP, versione dei vicini; migrazione `scheda_mikrotik_v21` v1 (P1) — v0.9.833; pool DHCP: i server spenti (flag X) risultavano accesi, ora corretti; la Panoramica mostra le barre solo dopo aver aperto la tab DHCP (scelta di interfaccia); migrazione misurata sulla copia dell hub: 25 ms, integrity ok; revisione completa fatta (1 importante corretto: commento interfaccia)
- [x] T4 Panoramica MikroTik (P2) — v0.9.834; resa a 1440 entra (dati di risorse/hardware dalla copia, dalle fixture vere)
- [x] T5 Interfacce raggruppate per tipo (P2) — v0.9.835; colonna Dettagli rimandata ai T9/T11 (bond, bridge, VLAN)
- [x] T6 Dispositivi visti dal router + `tabDelTipo(t, OpzioniTab)` (P2) — v0.9.836; GET `/api/devices/[id]/dispositivi`; `tabDelTipo(t, OpzioniTab)`
- [x] T7 Routing e ARP con lo stato, export ripulito (P2) — `ripulisciExport`, `nomeFileExport`, `statoArp`; ARP con Stato e Tipo (nascoste se vuote). Da fare con Riccardo sull'hub: tab Configurazione, «Leggi dal router»; sulla copia il router non risponde, la resa dell'export ripulito (intestazione, nota «tolte») non è vista
- [x] T8 tabelle `mikrotik_bridge`, `mikrotik_bridge_port`, `mikrotik_bond` + ADR 0027, migrazione v2, misura sulle copie (P3) — v0.9.838; migrazione v2 misurata sulla copia dell hub (18 ms, integrity ok; dal router dell hub: 1 bridge, 16 porte, 3 bond); copia del cliente A non misurata (non disponibile da qui); revisione completa: approvato, 0 gravi
- [x] T9 tab Bridge e VLAN (matrice dai PVID), dettagli bond/bridge (P3) — v0.9.839; matrice dai PVID (le T arrivano col T10); tab VLAN e Bridge solo con la lettura topologia accesa e ≥1 bridge; revisione completa: 1 importante + 3 minori corretti
- [x] T10 lettura `mikrotik_scheda` spenta: bridge vlan, vlan, dns, utenti; migrazione v3 (P4) — v0.9.840; lettura `mikrotik_scheda` nata spenta (nessun comando nuovo ai router finché non la accende un admin); migrazione v3 sulla copia dell hub 22 ms, integrity ok, segno v3; copia del cliente A non misurata; revisione completa: approvato
- [x] T11 matrice VLAN completa, VLAN con la madre, DNS e utenti (solo admin) (P4) — v0.9.841; utenti del router solo admin (provato via HTTP: admin 200 senza password, viewer 403); data per sezione; revisione completa: approvato, 1 importante + 3 minori corretti
- [x] T12 documenti (CHANGELOG, CONTEXT §6, scheda-mappa) — documenti fatti; verifica sull'hub: vedi sotto
- [x] T12 verifica sull'hub (22/10 01:00 ora italiana, v0.9.842): segno `scheda_mikrotik_v21` = v3, riga nel journal; `mikrotik_scheda` assente = spenta, tabelle VLAN/DNS/utenti vuote; interfacce del router con tipo (33/33). `/objects/227` con `prova-claude` (viewer): Panoramica entra in 1440×900, tab Panoramica · Interfacce · Routing e ARP · DHCP · Dispositivi · Configurazione (VLAN e Bridge ancora assenti: tabelle bridge vuote fino al prossimo giro della topologia, al più 1/ora), Interfacce raggruppate per tipo con commenti e versione dei vicini, niente Utenti per il viewer. SNS EVA2 e switch invariati. Da guardare dopo il giro: le tab VLAN e Bridge
- [-] Aperti dopo il piano: — chiusa il 06/11 (solo un titolo).
  - [x] accendere la lettura `mikrotik_scheda` sull'hub (decide Riccardo; nata spenta, nessun comando nuovo ai router finché non la accende un admin) → Riccardo (22/10): sì; accesa sull hub il 22/10 alle 01:43 ora italiana.
  - [x] sesta casella «pool DHCP più pieno» (v0.9.844): la casella Firmware c'è sempre col valore installato (Riccardo 22/10: «il firmware installato è importante»), in attenzione con «▲ aggiornabile a X» quando c'è un aggiornamento; il pool ≥85% (dalla cache della tab DHCP) prende il posto di «Acceso da», l uptime resta nel riquadro Risorse
  - [x] conteggi nelle etichette delle tab (dove il dato è già in pagina; mancano Interfacce, DHCP, Dispositivi, VLAN MikroTik) e vicini «non in IPAM» / link all host (v0.9.843, rotta `/api/devices/[id]/vicini-ipam`)
  - [ ] «Dettagli» della riga del bridge non visto a schermo (nome del bridge dei dati di prova diverso dal reale)
  - [ ] migrazioni v1-v3 misurate solo sulla copia dell'hub: la copia del cliente A non era accessibile, la prima apertura vera lì è anche la prima misura
  - [ ] «Aggiorna» su MK-RTR-CORE sull'hub, altrimenti risorse e hardware non compaiono

## 2026-10-21 — scheda apparato per tipo (proposta grafica)

Tavola: https://claude.ai/artifact/7ezwy7nkAAzUWSn1wJCNKv (oggi, scheletro comune, tab Gestione, switch, router/firewall, storage, hypervisor, Windows, Linux, application server). Riguarda `objects/[id]/page.tsx` (la scheda unica: `/devices/[id]` e `/hosts/[id]` ci rimandano).

- [x] Censita la scheda di oggi: 7 tab uguali per ogni tipo; credenziali in 5 punti, uptime in 4, classificazione con due editor (host in Generale, apparato in Asset); porte switch a 4 colonne su 9; MikroTik dal vivo, contatori firewall e utenti Windows persi col rimando da `/devices`; Zabbix, Wazuh (oltre alle vulnerabilità), AD, patch, `device_interfaces` e dipendenze nel DB ma non in scheda.
- [x] Scoperto sull'hub (tenant 70791): i server Windows e Linux hanno `network_devices.device_type = switch` con classificazione `server`; l'API decide le query su `device_type` (`api/devices/[id]/route.ts:67-73`). Da sistemare prima della scheda per tipo.
- [x] Tavola grafica: intestazione in una riga, striscia di 6 numeri per tipo, tab del tipo + Sicurezza · Gestione · Storico, Panoramica senza scorrimento, riga delle fonti al posto delle card vuote. Riccardo (21/10): **impostazione approvata**, le singole voci si rifiniscono dopo.
- [ ] Rifinire le voci con Riccardo, tavola per tavola (anche durante l'esecuzione).
- [x] Causa del `device_type = switch` sui server: lo schema vecchio non ammetteva `server` (workaround citato in `db-tenant.ts:6338`); le creazioni nuove passano da `resolveDeviceTypeForCreate` e sono giuste, restano le righe vecchie.
- [x] Riccardo (21/10): livello **leggero per tutto**. Piano: [`docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md`](docs/superpowers/plans/2026-10-21-scheda-apparato-per-tipo.md), 8 task. Le modifiche delle tappe 3-5 alla pagina sono già in `dev` (v0.9.821): niente da aspettare.
- [x] Eseguire il piano (T1-T8): v0.9.822-829 su dev, hub aggiornato a v0.9.829 il 21/10 alle 18:38 (codice servito verificato con grep sui chunk, journal senza errori). Pagine sull hub non aperte a schermo: manca un utente di prova sull hub, si guardano da Riccardo.
  - [x] T1 tipo di scheda e conversione di `device_type`: v0.9.822; SNS EVA2 diventa `device_type=server` (scheda `firewall` dal vendor); righe senza classificazione non toccate
  - [x] T2 mattoni comuni, scheletro, tab Gestione/Sicurezza/Storico: pagina da 2889 a 482 righe, innesto dei tipi in `components/scheda/tab-scheda.tsx`
  - [x] T3 switch: pannello frontale, porte da guardare (`lib/scheda/porte-da-guardare.ts`), VLAN, vicini e MAC. Il dato non ha errori CRC né storico della velocità: quelle due regole aspettano la raccolta (B2); vicini senza host id = testo senza link; conteggi nelle etichette delle tab non fatti
  - [x] T4 router e firewall: GET `/api/devices/[id]/interfacce`, export `mikrotik?action=config` ora solo admin (prima no). In locale il router non risponde (credenziali cifrate con la chiave dell hub): barre DHCP, lease dal vivo ed export da guardare sull hub
  - [x] T5 storage e NAS: verificato su un FIXTURE (forma di `nas-acquisition.ts`, `src/lib/scheda/__tests__/fixture-nas.ts`), nessun NAS sull hub. Da guardare su un NAS vero: codici Synology di stato disco/RAID/SMART scritti dalla MIB e mai visti dal vivo; riallocati e ore non raccolti
  - [x] T6 hypervisor: GET in sola lettura su `proxmox-match` (il POST resta admin) e `/api/hosts/[id]/proxmox-vm` per «VM n su <nodo>». CPU del cluster, quorum e CPU per nodo non raccolti; tab Rete lunga (scorre)
  - [x] T7 server Windows, Linux e ruoli: GET `/api/hosts/[id]/ad` e `/dipendenze`; tab Dipendenze non vista a schermo (la copia dell hub non ha dipendenze), coperta dalle prove. Mancano nel dato: CPU %, KB per nome, pacchetti di sicurezza Linux; i nomi delle sessioni Windows perdono il backslash (difetto del collettore)
  - [x] Utente di prova in sola lettura sull hub: `prova-claude` (viewer, tenant 70791), creato il 21/10 con ok di Riccardo; password in `~/.config/da-ipam/hub-utenza-prova.txt` (fuori da git, da spostare nel vault). Backup `data/hub.db.bak-20261021-164749-prima-utenza-prova`.
  - [x] Pagine viste sull hub il 21/10 sera (switch, router, SNS, hypervisor, DC01, wazuh): tutte entrano in 1440×900.
  - [x] Router DA-RT-CORE, tab DHCP: «il router non ha restituito server DHCP attivi con un pool leggibile», ma i lease (320, server DHCP_DEF) ci sono: capire perché `dhcp-pool` non legge i pool. → risolto (v0.9.833): i server spenti hanno il flag `X` e il parser li dava accesi.
  - [ ] DA-DC01: la casella «Active Directory» sta su una riga a sé sopra la striscia (la striscia va in due righe); «VM 401 s…» troncato in intestazione.
  - [x] VLAN degli switch UniFi cancellate ogni notte: la sincronizzazione del controller (03:00) riscriveva le porte con `vlan` vuota; ora conserva `vlan` e `stp_state` letti via SNMP (v0.9.830, hub aggiornato il 21/10 alle 19:18). Anche il ProMax senza `dot1dBasePortIfIndex` ora lega la VLAN alla porta.
  - [x] Verificare il 22/10: dopo un «Aggiorna» di SW-CED-48POE-242 le porte hanno la VLAN, e dopo il giro UniFi delle 03:00 ce l hanno ancora (`select count(*) from switch_ports where device_id=7 and vlan is not null`). Se i nomi SNMP e quelli del controller non combaciano e gli indici sono sfalsati, la VLAN non si conserva (mai su una porta sbagliata). → 22/10: 52 porte su 52 con la VLAN dopo il giro UniFi delle 03:00.
  - [x] Switch sull hub: un `ERR_TOO_MANY_RETRIES` + eccezione `Event` in console (probabile flusso SSE che si riconnette): da capire. → 22/10: 5 caricamenti di fila delle schede switch (con le tab) senza errori; le tre volte viste erano subito dopo un riavvio dell'hub (pezzi della pagina non scaricati mentre il servizio ripartiva), non un difetto della scheda.
  - [x] Da guardare sull hub, a schermo: router MK-RTR-CORE (barre DHCP: compaiono in Panoramica solo dopo aver aperto la tab DHCP, niente SSH a ogni apertura), export solo admin, una pagina per tipo. → fatto il 22/10 con `prova-claude` (pagine per tipo, Panoramica e Interfacce del router).
  - [x] Conversione `device_type`: i 14 server non sono più «switch» → non hanno più la riga SNMP forzata in «credenziali usate» né l attribuzione della porta switch per MAC (`db.ts:2802`); la lettura SNMP extra del cron (`jobs.ts:1013`, spenta di default) non parte più per loro. Decidere se serve. → Riccardo (22/10): va bene così.
  - [ ] Minori lasciati: SNS EVA2 resta `device_type=server` nel dato; `text-[10px]` nel codice spostato com era; costo di `proxmox-vm`; prove della migrazione su DB vero.
  - [x] T8 chiusura + revisione finale (0 gravi, 3 importanti corretti in v0.9.829: DA-VEEAM con classificazione `windows` ora server Windows; host non gestito con tab Gestione; riquadro «Rete e SNMP» in Gestione)
    - Chiusura, controllo «niente vive solo in `/devices/[id]`» (21/10). Lista dell'artboard «Oggi» (perso / c'è ma non si vede) e blocchi della pagina `/devices/[id]`; la pagina non è toccata:
      - Porte switch a 4 colonne su 9 → switch › Porte (PoE, STP, trunk, vicino, duplex) e Panoramica (porte da guardare)
      - MikroTik dal vivo (sistema, config, server DHCP, pool, lease) → router › Interfacce, DHCP, Configurazione; export `.rsc` in Configurazione (solo admin)
      - Contatori del firewall (filter/NAT/mangle, stato firewall Linux) → router/firewall › Configurazione «Regole del firewall»; firewall dei server → server › Sistema «Sicurezza e licenza»
      - Utenti Windows (ultimo utente, sessioni, profili) → server › Utenti
      - Zabbix → Gestione (collegamenti esterni); Wazuh e vulnerabilità → Sicurezza; Active Directory → server Windows DC › Active Directory; patch → server › Aggiornamenti
      - Interfacce dei router (`device_interfaces`) → router › Interfacce; abbinamento VM ↔ host → hypervisor › VM e container, «VM n su <nodo>» in intestazione
      - Etichette a 10 px e stati col solo colore pastello → riquadri nuovi: testo ≥13 px, stato con segno e parola; qualche 10-11 px resta solo in `components/scheda/dettagli/*` (spostati com'erano, ora solo `generico`)
      - Tabelle con scorrimento in pagina che scorre, nodi Proxmox uno sotto l'altro → tabelle che scorrono da sole nella tab, nodi in griglia a due colonne (hypervisor › Nodi)
      - `/devices` · Informazioni dispositivo (nome, host:porta, protocollo, badge «host #n») → intestazione e Gestione (Come ci arrivo, Identità e inventario)
      - `/devices` · Inventario asset (DeviceInventoryCard) → Gestione › Asset NIS2 (link a `/inventory/[id]`)
      - `/devices` · Dati tecnici acquisiti: sistema operativo, hardware → server › Sistema; NAS/dischi/volumi → storage › Dischi, Volumi, Servizi; rete, licenza, servizi e ruoli, sicurezza, cron, aggiornamenti, utenti, software/pacchetti → server › Sistema, Servizi, Aggiornamenti, Utenti, Software; porte in ascolto → Panoramica e Servizi; campi base di un SNMP generico → `generico` › Dettagli
      - `/devices` · Dati Proxmox (Host, VM e CT, Hardware e licenza) → hypervisor › Nodi (abbonamento), VM e container, Storage, Rete
      - `/devices` · STP e sue porte → switch › Porte (colonna STP) e Panoramica
      - `/devices` · Tab ARP, Schema porte, MAC table, Neighbors, Routing, DHCP leases → router › Routing e ARP, DHCP; switch › Porte, Vicini e MAC; neighbor di router › Interfacce
      - `/devices` · Neighbor LLDP/CDP in fondo e inventario software remoto → switch › Vicini e MAC; server › Software (scansione remota)
      - Non portato: contatore «Neighbor LLDP/CDP (n gruppi)» raggruppato per porta con badge `STP: …` (la tab Vicini li mostra in tabella, non raggruppati) — duplicato del dato, non serve
      - Non portato: un host non gestito (tipo `host`) non ha più «Dettagli» (LibreNMS, IP collegati, Sulla mappa, SNMP): ha Panoramica generica, Sicurezza e Storico — decisione del piano; si riapre solo se Riccardo lo chiede
      - Non portato: raccolta di VPN, regole firewall in elenco, database SQL, siti, posta, backup, inode/LVM, NTP/AppArmor, archivio delle configurazioni — fuori dal piano (B2/B4/B5 del piano `recupero-dadude3-mknet`)
    - T8 verificato: `TabDettagli` resta solo per `generico` (stampanti, AP, UPS, postazioni: inventario base, informazioni SNMP, IP collegati e software non stanno nella Panoramica generica); per gli altri tipi tolto. «Aggiungi a dispositivi da Discovery» tolto da `dettagli/software.tsx`; bug di precedenza `_total_vm_rows` già sparito in T6 (`numeroVm`, 3 prove).
- [-] Coordinare col piano DADude3/MKNET: B2 (porte HP/MikroTik), B4 (Hyper-V, Windows, Linux), B5 (archivio configurazioni) riempiono i riquadri «dato da raccogliere» della tavola. — chiusa il 06/11 (piano superato).

## 2026-10-21 — recupero da DADude3 e DA-MKNET (fase di piano)

Analisi del 20/10: canvas Cursor `progetti-fermi-DADude3-DA-MKNET-MKHA` (50 schede). Piano: [`docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md`](docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md). Niente codice finché Riccardo non approva.

- [x] Letti README dell'ecosistema, CONTEXT/AGENTS/CLAUDE di DA-IPAM, ADR 0018, le 50 schede e le prove comparative.
- [x] Donatori invariati dal 20/10 (DADude3 `569b416`, DA-MKNET `812b1ad`); funzioni donatrici alle righe citate.
- [x] Schede verificate sul codice di `dev`: HP, MikroTik, NAS, Windows, Linux, configurazioni, identità MAC, vicini, file «già coperti».
- [x] Scoperto: due elenchi di MAC virtuali diversi (`devices/physical-device-db.ts` conosce HSRPv2/HSRP IPv6, `topology/identity.ts` no).
- [x] Scoperto: il firmware QNAP via SSH (`uname`) **sovrascrive** quello letto via SNMP (`getDeviceInfo`, `{ ...result, ...sshInfo }`).
- [x] Scoperto: gli HP letti via SSH non scrivono vicini (`device_neighbors`); il loro LLDP finisce solo in `switch_ports.trunk_neighbor_*`.
- [x] Scoperto: ProCurve scrive in `speed` il tipo fisico («100/1000T»), non la velocità negoziata; nessuna prova sui lettori HP.
- [x] Scoperto: `upsertSwitchPorts` riscrive tutta la riga: una sotto-lettura fallita metterebbe null sopra un valore buono.
- [x] Scoperto: la GET `/api/devices/[id]/mikrotik?action=config` (export completo) non chiama `requireAuth`/`requireAdmin`: basta la sessione.
- [x] Scoperto: `DA-MKNET/backend/database.sqlite` è vuoto (0 byte): nei cloni non c'è storico da importare.
- [x] Piano scritto: classificazione delle 50 schede, blocchi B1-B6, task con donatori e destinatari, prove, livelli di controllo, decisioni.
- [x] Riccardo (21/10): niente in uso (DADude3, The Dude, QuTS hero, Docker, SCCM, DATIA: fuori); collaudi HP su una sede con Comware, ProCurve e ArubaOS, all'installazione di IPAM nei prossimi giorni. Piano aggiornato (§6).
- [x] Riccardo (21/10 sera): collector modulari come fonte nuova e principale, famiglie aggiunte nel tempo nello stesso JSON. Lette consegna, pacchetto (identico al codice nel `dev` locale), canvas del modello, ADR 0024-0026, manuale; 79 prove dei collector verdi (exit 0).
- [x] Scoperto: i collector `hp-procurve`/`hp-comware` coprono già M1, M2, M3 ed E02; resta l'aggancio all'app (unico chiamante oggi: la CLI).
- [x] Scoperto: `dev` locale (15 commit: collector e piano) e `origin/dev` (41 commit altrui) sono divergenti; la consegna vieta il push su `dev`.
- [x] Scoperto: tre meccanismi di acquisizione convivono (client storici, `devices/acquisition/registry.ts`, `src/lib/acquisition/`); elenco dei collector ripetuto in tre punti; versione unica `1.0.0`; niente SNMPv3 né WinRM nei trasporti dei collector.
- [x] Piano riscritto in v2 attorno ai collector: blocchi S, C0-C6, decisioni D1-D9 più la domanda su ArubaOS.
- [x] Riccardo (21/10 sera): «accetto le tue proposte» → decisioni D1-D9 scritte nel §7 del piano.
- [x] D1: collector pubblicati sul ramo `collector-modulari` (`6cca5a8a`); `origin/dev` non toccato.
- [x] Riccardo: sviluppo nel cloud finché non serve unire in locale. Prompt nel repo: `docs/handoff/2026-10-21-prompt-cloud-collector-modulari.md` (il cloud non vede `~/.claude`).
- [x] Aperta: «ArubaOS» della sede nuova è ArubaOS-Switch o AOS-CX? Si vede al collaudo (`sysDescr`).
- [x] Sessione cloud su `collector-modulari`: merge di `origin/dev`, poi S1 → S2 → C0 → C1 → C2 → C3 (S3 dopo il commit delle tappe 3-5).
- [x] In locale (Riccardo): misure sul DB dell'hub, collaudo HP nella sede nuova, unione in `dev`.
- [x] S3 (MAC virtuali) aspetta il commit della sessione delle tappe 3-5, che modifica `topology/identity.ts`.
- [x] Cloud (22/10), passo 0: i due donatori (`dadude-native`, `DA-MKNET`) sono leggibili come repository della sessione; nessuna password dei vecchi `OLDSCRIPT` copiata.
- [x] Cloud, merge di `origin/dev` in `collector-modulari` (`d41537e9`): conflitti solo in CHANGELOG, CONTEXT e TASKS, tenute le sezioni di entrambi i rami; 79 prove del modulo e `tsc` verdi (exit 0).
- [x] S1: l'export MikroTik solo admin **era già in `dev`** (sessione della scheda router, `9232b22d`: `mikrotik-guardia.ts`, contratto in `api-auth-guards`). Riletto come revisore: il 403 arrivava dopo la ricerca dell'apparato (un non admin poteva distinguere 404 da 403) e la lista degli admin era duplicata. Corretto (prova vista rossa, poi verde): guardia prima della ricerca, `eAdmin` unico.
- [ ] S1, in locale: GET `?action=config` con un viewer → 403, con un admin → 200 su un router vero; `scripts/verifica-permessi.sh` (serve l'app accesa e il DB hub).
- [ ] S1, nota: per un non admin `action=all` esegue comunque `getConfig` (l'export viene letto sul router e scartato). Non cambiato: serve `systemInfo` alla scheda; da separare in C3 (`mikrotik-routeros`).
- [x] S2: firmware QNAP nel percorso storico. Prova vista rossa (3 casi su codice di oggi: firmware = uname, SSH nullo che cancella l'SNMP), poi `devices/nas/qnap-versione.ts` (`getsysinfo firmver`, `/etc/version`, build), `identitaNasDaShell` ed `unisciInfoSsh` estratti puri. `kernel` resta in `nas_inventory.ssh.kernel`.
- [ ] S2, in locale: su un QNAP QTS vero leggere `getsysinfo firmver`, `/etc/version` e la build, e confrontare col firmware mostrato (formato `X.Y.Z build AAAAMMGG` ipotizzato dal donatore `qnap.py:193`, non visto su apparato).
- [x] C0.1-2: `acquisition/catalogo.ts` è l'elenco unico (id, versione, descrittore con credenziali, sezioni, allowlist, modelli collaudati); enum dell'input, enum dello snapshot, `COLLECTORS` e allowlist dei trasporti ne derivano; `collector_version` ora per collector (semver). `comandi.ts` foglia con le tre allowlist. 85 prove del modulo verdi (79 + 6 nuove, una vista rossa).
- [x] C0.3: sezioni opzionali `system`, `host_storage`, `software`, `services`, `security` (`sistema-schema.ts`); capacità e conteggi come stringhe decimali; snapshot 1.0 già prodotti restano validi; redazione che non tocca i conteggi.
- [x] C0.4: trasporti. SNMPv3 (`input.snmp` con `version: "3"`) aperto solo da `apriSessioneSnmp`; opzioni incoerenti = errore prima della rete (`SNMP_V3_OPTIONS_INVALID`), chiavi v3 redatte. WinRM: `input.winrm` + `createWinrmReader` su `devices/winrm-run.ts`, solo script a id fisso del descrittore (`script_winrm`, vuoto finché non c'è il collector `windows`), solo codici d'errore, lotto fermato dopo errore di rete/auth. Nessun collector li usa ancora.
- [ ] C0.4, in locale: SNMPv3 authPriv contro un apparato vero e WinRM contro un server di prova (nel cloud solo con moduli finti). Nota: `runWinrmCommand` ha un suo timeout di 120 s; lo scadere del totale non ferma il processo Python, ne smette di aspettare l'esito.
- [x] C0.5: prova di contratto comune `__tests__/contratto.test.ts` + `contratto-fixture.ts` (una fixture per collector, `Record<CollectorId,…>`: la voce mancante rompe `tsc` e la suite): snapshot valido con versione del catalogo, formato ignoto mai `ok`, senza SSH nessuna shell e sezioni solo-SSH `skipped`, trasporto guasto = `error` senza segreti e senza secondo tentativo, credenziali di altro tipo respinte per i collector API. Viste rosse: redazione spenta (4 prove cadono), fixture tolta (suite e `tsc` cadono).
- [x] C0.5, osservato (non cambiato): con uscite di formato ignoto `hp-procurve` e `hp-comware` danno `interfaces: error`, mentre `qnap-switch` dà `partial`; entrambi non sono `ok`, ma la regola del piano («partial») non è uniforme. Da decidere se allineare.
- [x] C0.6: guida «Aggiungere una famiglia» in `docs/modules/acquisition.md` (file da creare, descrittore, fixture anonimizzate, prove, modelli/firmware collaudati, trasporti).
- [x] C0.7: censimento di `devices/acquisition/registry.ts` in `docs/proposte/2026-10-22-censimento-registry-acquisizione.md`: nessun chiamante, `mikrotik.ts` mai caricato, codice morto di 282 righe; proposta di ritirarlo. **Nessun cambio**: aspetta la decisione di Riccardo.
- [ ] Decisione di Riccardo: ritirare `src/lib/devices/acquisition/` (C0.7)? Allineare `interfaces` a `partial` sui formati ignoti HP?
- [x] C1, solo proposta: tavola grafica `docs/proposte/2026-10-22-collector-interfaccia.html` (15 oggetti numerati, 5 stati distinti per segno e luminanza, resa verificata con Chromium a 1280 e 390 px, senza scroll orizzontale) e schema fisico `docs/proposte/2026-10-22-collector-snapshot-schema.md` (`acquisition_sources`, `acquisition_snapshots`, chiave `acquisizione_modulare.attiva`, rotte e prove previste). Nessuna rotta, tabella o schermata scritta.
- [x] Riccardo (22/10): tavola C1 approvata con correzioni (piano §7): acquisizione normale con un altro formato, i dati popolano l'apparato (C1+C2 insieme, niente «Applica»), fonte automatica, 5 righe, «anteprima» finché C2 non è chiuso. Tavola pubblicata: https://claude.ai/artifact/RNgNG1UYmXfk1WfXFTSwZE
- [x] Cancello di fine perimetro (22/10, cloud): `npm run lint` exit 0, `npx tsc --noEmit` exit 0, `npm run build` exit 0, prove del modulo 117/117. `npm test` exit 1 con 4956 pass e **1 fallita non nostra**: `db-facade-ratchet.test.ts` («db.ts definisce 265 funzioni, la soglia è 262»); `src/lib/db.ts` è identico a `origin/dev`, quindi la fallita arriva da `dev` (sessione MikroTik/scheda): serve alzare la soglia o spostare le funzioni in `db-tenant.ts`.
- [ ] Da fare in locale (Riccardo): decisioni sulla tavola C1 e sul censimento C0.7; prova S1 con viewer/admin su un router; prova S2 su un QNAP QTS; SNMPv3 e WinRM veri; la fallita del ratchet `db.ts`; unione in `dev` e rilascio (qui non c'è stato `version:release`: lo bumpa chi unisce).
- [x] Giro cloud 2 (22/10): C1 + C2 insieme. Merge di `origin/dev` (`ddaf7710`; conflitti in CONTEXT e `mikrotik-guardia.ts`, tenuti entrambi). `db-facade-ratchet` ancora rosso per funzioni di `dev` (265 contro 262): non nostro, le funzioni nuove stanno in `db-tenant.ts`.
- [x] C1.3 schema (`987a6531`): `acquisition_snapshots`, `acquisition_source_choices` (solo la scelta del caso dubbio), `acquisition_changes`; CREATE idempotenti in `TENANT_SCHEMA_SQL`; retention D5; interruttore spento di default.
- [x] C1.1-2 aggancio (`8c59c6ef`): il pulsante di sempre (`POST /api/devices/[id]/query`) legge col collector se l'interruttore è acceso e il prodotto ne ha uno; fonte ricavata, una credenziale per protocollo dai binding, un tentativo solo, lucchetto; spento = percorso di sempre (prova sul sorgente e sulle dipendenze).
- [x] C2.1-2.5 proiezioni e applicazione (`e1bf0437`): `switch_ports` per campo, vicini e fatti con fonte `collector`, manuale che vince sull'host, una transazione, T1 identica (prova con controprova).
- [x] Revisione indipendente del diff C1/C2: un bloccante (porte abbinate per indice prima del nome → dati sulla porta sbagliata) e due da correggere (snapshot rifiutato senza traccia; password di sole cifre trovata in `speed_bps`), corretti in `95c1e89e` con prove viste rosse.
- [x] C1.4 rotte (`274a70ca`): riquadro (sessione), scelta della fonte (admin), scarico JSON (admin, in ATTESI), interruttore.
- [x] C1.5 schermata (`7868442b`): riquadro in Gestione sotto «Credenziali», finestra del caso dubbio, interruttore in Impostazioni → Sistema; resa con dati finti a 1280 e 1920 (8 varianti, nessuno scroll orizzontale).
- [x] Cancello di fine C2 (22/10, cloud): `npm run lint` exit 0 (0 errori), `npx tsc --noEmit` exit 0, `npm run build` exit 0, `npm test` exit 1 con 5167 pass e **1 fallita non nostra**: `db-facade-ratchet` («265 funzioni, soglia 262»; `src/lib/db.ts` identico a `origin/dev`). Al primo giro cadeva anche «I33 fuori dal giro» (guardia sul sorgente: le chiamate a `upsertNeighbors` devono dichiarare la fonte): aggiunto `collector` all'elenco delle fonti dichiarate della prova.
- [ ] **Da provare in locale (Riccardo):** acceso l'interruttore, «Aggiorna» su un HP della sede nuova (ProCurve, Comware, e l'«ArubaOS»: se il sysDescr dice AOS-CX non c'è collector e resta l'acquisizione di sempre); guardare nel riquadro cosa è cambiato e controllare porte, vicini e firmware nella scheda. Poi spegnerlo e verificare che «Aggiorna» torni come prima.
- [ ] **Da misurare in locale:** su una copia del DB dell'hub, applicare uno snapshot vero a uno switch già letto dal percorso di sempre e spiegare ogni riga di `acquisition_changes` (soprattutto porte «tolte» e «aggiunte»: i nomi SSH e SNMP delle porte possono differire).
- [x] Riccardo (22/10): decisioni (a)-(f) di fine giro 2 come proposte (piano §7, «Fine giro 2»): (a) giri pianificati non riscrivono le colonne del collector, (c) `collector` prova di ruolo, (e) bulk-scan salta i dubbi, (b)(d)(f) nessun cambio.
- [x] Ratchet `db.ts` rosso: già sistemato su `dev` da un'altra sessione (`df2e7dc3`), verde il 22/10.
- [x] Giro cloud 3 (22/10): merge di `origin/dev` (`7b97fc1f`, conflitto solo in CONTEXT §6, tenute le voci di entrambi).
- [x] (a) giri pianificati (`cba44003`): `cron/jobs.ts` passa da `scriviPorteDelGiro` (`acquisizione-modulare/giri.ts`). Acceso + collector + snapshot non in errore che ha scritto le porte: i campi che la proiezione scrive da quello snapshot (per porta) restano del collector, il giro scrive MAC per porta e il resto; le porte che solo il collector conosce restano. Spento, «classica», nessuno snapshot: `upsertSwitchPorts` come oggi. Prova vista rossa (il giro rimetteva «100/1000T» sopra «1000 Mbps»).
- [-] (a), nota: `POST /api/networks/bulk-scan-devices` (ARP dei router dalla pagina Reti) scrive ancora con `upsertSwitchPorts`: non è un giro pianificato, lasciato com'è. Da decidere se allinearlo. — chiusa il 06/11 (la rotta non chiama più upsertSwitchPorts).
- [x] (c) `collector` in `leggeViciniDiRete` (`551c7da9`): prova vista rossa, topologia 916/916, T1 non lo legge.
- [x] (e) scansione in blocco (`acfb6fb8`): i dubbi si saltano prima del test delle credenziali, vanno in `skipped_devices` e nel nuovo elenco `dubbi`, con una frase nel messaggio. Spento = nessun salto.
- [x] C3 `qnap-nas` (`8d9e4c93`), con l'infrastruttura comune: `ssh_modo` nel descrittore (`console`/`exec`/`exec_per_comando`; Comware lo dichiara), uscita 127 = non supportato, `costruzione.ts`, `linux-parsers.ts`, sezione opzionale `shares`.
- [x] C3 `mikrotik-routeros` (`6eb216fe`): riusa i parser della scheda MikroTik; PoE solo da `poe-out-power` (mutante «tensione come potenza» visto rosso), `vlan-ids` con intervalli, monitor per colonne, errori di RouterOS su stdout. `parseRouterOsDurationSeconds` spostata in `devices/routeros-durata.ts` (router-client la riesporta) perché il core dei collector non importi il DB: prova nuova sugli import.
- [x] C3 `windows` (`64552015`): otto script PowerShell nell'allowlist WinRM, busta JSON, mai `Win32_Product`, Hyper-V col GUID (sezione opzionale `guests`), Defender/firewall senza riassunti. Prova di contratto generalizzata alle credenziali non SSH.
- [x] C3 `linux` (`7e3c493e`) e `synology-nas` (`8f91c919`).
- [x] Tutti e cinque **non collaudati** (versione `0.1.0`, `collaudo: non_collaudato`), fixture con la forma documentata e dati inventati, **non agganciati al riconoscimento del prodotto** (`riconosci.ts`): si usano dalla CLI. Motivo: le proiezioni scrivono `switch_ports` da `interfaces` per qualunque apparato; un NAS o un server non deve avere porte da switch. Da decidere prima dell'aggancio: proiezione delle porte solo per le famiglie switch/router.
- [x] Cancello di fine giro 3 (22/10, cloud): `npm run lint` exit 0 (0 errori, 65 avvisi), `npx tsc --noEmit` exit 0, `npm test` exit 0 (5336 prove, 5333 pass, 0 fail, 2 saltate, 1 TODO), `npm run build` exit 0. Prove del modulo dei collector 176/176.
- [ ] **Da provare in locale (Riccardo), collector nuovi dalla CLI** (`scripts/acquire-device.ts`, sola lettura), uno per famiglia:
  - `qnap-nas` su un QNAP QTS (e uno QuTS hero se c'è): firmware e build, `smb.conf`/`qpkg.conf` nei percorsi attesi, `ip`/`df -i` di BusyBox;
  - `mikrotik-routeros` su un CRS con PoE e su un CCR: monitor ethernet e PoE, tempi con molte interfacce, più canali exec sulla stessa connessione;
  - `windows` su un Windows Server 2016/2019/2022 con Hyper-V e su un client: gli otto script su PowerShell 5.1, forma vera degli array, tempi;
  - `linux` su un Debian/Ubuntu e su un RHEL: `systemctl show '*.service'`, LVM senza root;
  - `synology-nas` su una DSM 7: quale forma di `synoshare` risponde, `smb.share.conf`, `/var/packages/*/INFO`.
  Dopo il collaudo: modello e firmware in `collaudati`, `collaudo: "collaudato"`, versione `1.0.0`.
- [ ] **Da provare in locale, (a) ed (e):** interruttore acceso, uno switch HP acquisito col collector, poi un giro ARP pianificato (o «Esegui ora»): velocità, duplex, VLAN e stato STP devono restare quelli del collector, i MAC per porta aggiornati. Spento: il giro torna a scrivere tutto. Scansione in blocco con uno switch HP senza indizi (due collector possibili): saltato ed elencato, gli altri acquisiti.
- [ ] Etichetta «anteprima» nel titolo: si toglie a fine C2, dopo le prove in locale (Riccardo).

## 2026-10-21 — cose aperte dopo la notte del 20→21/10

Prompt: `~/.claude/prompts/da-ipam-sonde-e-aperti-2026-10-21.md`.

- [x] 0b. Riccardo: committarle. agentation 3.1.2 (devDependency, montato solo con `NODE_ENV=development`); tutti i percorsi d'installazione usano `--include=dev`. `agent/` tolto (solo un egg-info dell'agente rimosso). lint + build + tsc verdi.
- [x] 0. Albero: ci sono ancora le righe non committate di `agentation` (`package.json`, `package-lock.json`, `src/app/layout.tsx`) più `agent/` (solo `da_invent_agent.egg-info`, residuo dell'agente tolto). Non si mettono in stage; chiesto a Riccardo di chi sono.
- [x] 1. VM 103 `79993-ipam-2` (PVE di casa), letta: accesa, `onboot: 1`, tag `da-appliance`; **manca la tabella nft `inet dalink`** e **UFW non è installato** → R5 rosso. In ascolto su tutte le interfacce: 53 (solo IP NetBird), 80, 443, 3001, 4443, 5355, 8080, 8443, 10050, 10051, 1514/1515, 514, 6443, 51820.
- [x] 1b. Riccardo: togliere, dischi compresi (21/10). Revocata in DA-Link (oggetto 12: nodo NetBird, bridge 18, chiave Zabbix, token; prova a vuoto poi `--applica`, uscita 0), `qm destroy 103 --purge --destroy-unreferenced-disks` (0 dischi `vm-103-` rimasti su ZFS-LARGE). `dalink verifica` dopo: **verde**. Nota: alle 09:41 una sessione dell'immagine (worktree `deploy-appliance-immagine`) la stava ancora usando; Riccardo ha deciso di procedere.
- [x] 1c. Perché aveva le porte aperte: `dalink-firewall.service` saltato (`ConditionPathExists=/etc/dalink/firewall.env`). Il primo avvio dell'immagine (`primo-avvio/fasi/netbird.sh`, ramo `claude/appliance-immagine` di Deploy-Appliance) fa solo `netbird up` e **non chiama `scripts/dalink/prepara-netbird.sh`**, che scrive `firewall.env` e accende il servizio; l'installatore classico (`Deploy-Appliance/lib/netbird.sh`) invece lo chiama. In più l'immagine non ha UFW. Vale per ogni appliance nata dall'immagine.
- [x] 1d. Corretto dalla sessione dell'immagine in Deploy-Appliance `15bc3bb` (ramo `claude/appliance-immagine`): la fase netbird lancia `prepara-netbird.sh --applica --edge si|no` prima di `netbird up` e anche a macchina già in NetBird; script assente o uscita ≠ 0 = fase ferma; prova `tests/test_fase_netbird_firewall.sh` vista rossa prima. La stessa sessione si occupa di DALINK_TOKEN perso alla riconfigura e del firewall nell'esito. Nessun'altra appliance da immagine in esercizio.
- [x] 2. Stato rifotografato il 21/10: la **150 è di nuovo accesa** (al momento del prompt era spenta), 151 spenta, 152 non esiste più.
- [x] 2b. Riccardo: riaccendere anche la 151. Accesa alle 09:46, agente QEMU risponde su 150 e 151; in DA-Link `70175-ipam` (oggetto 1) è connesso, segnale delle 09:44. DA-Link non le associa una sonda dell'hub: il bridge 7 di DA-Vul-can resta da guardare.
- [x] 3. Annotato: da-invent (192.168.4.8) scarica male da internet (dettaglio in `DA-Vul-can/TASKS.md`).
- [x] 4. Ramo `sonde-integrate-20261020`: **già in `dev`** (merge `8c00134e`, il ramo non ha commit fuori da `origin/dev`); il quadro di «Cosa esce» ha `altri_flussi.edge`. Resta da guardarlo reso a schermo.
- [x] 5. Proposta d'interfaccia delle tappe 3-5 scritta: `docs/proposte/2026-10-21-tappe-3-5-interfaccia.md` (10 oggetti per la finestra, 4 per il wizard, 3 per la classificazione, 3 domande).
- [x] 5a. Riccardo (21/10): tetto 3 tentativi Windows/AD; credenziale già fallita esclusa e detta; creazione ammessa senza credenziale provata, con avviso. Scritto nella proposta.
- [x] 5b. Tavola grafica https://claude.ai/artifact/Bau7xtUrykchk2EsNQLPXZ, impostazione approvata (21/10); voci dei menu controllate sul codice (doppioni V1-V6 nella proposta).
- [x] 5c. Riccardo (21/10): V3 tre unioni, V4 ruoli dei server, V5 stampanti/storage/modem unite; conversioni senza cautele (hub e DTS sono di prova); esecuzione qui, un agente per tappa, livello leggero.
- [x] 5d. Piano `docs/superpowers/plans/2026-10-21-tappe-3-5-rendi-apparato.md`: T1 catalogo+ruoli+migrazione · T2 classificazione unica · T3 ricerca credenziali · T4 finestra · T5 scheda/liste/wizard · T6 chiusura.
- [x] 6. `CONTEXT.md` da 19 617 a ~10,5k caratteri; il testo integrale del 21/10 mattina in `docs/storia/CONTEXT-diario-ottobre-2026.md`. Il vecchio §9 è confluito nel §8 e nel diario (nessun file lo citava).
- [x] 7. Etichetta DTS: sull'appliance DTS (`ssh dts`, tenant 71734) la rete 1 è **già** «LAN BASE 172.16.0.0/17», aggiornata il 20/10 alle 20:13 italiane. Niente da scrivere in DA-IPAM. Il /18 sta nei **report storici di DA-Vul-can** (`reports.edge_scan_label` fissato all'upload, luglio-ottobre; `edge_scan_cidr` è sempre /17).
- [x] 7b. Riccardo (21/10): strada A, i documenti di DA-Vul-can mostrano il CIDR vero (`edge_scan_cidr`), lo storico non si tocca. Passata alla sessione DA-VULCAN 21-10.
- [x] 8. Valutazione scritta: `docs/proposte/2026-10-21-dati-ad-verso-vulcan.md`. L'export `domarc-ad-health` esiste già in DA-IPAM, manca il lettore in DA-Vul-can; il ramo `feat/ad-health-ingest` non esiste in nessuno dei due repo. Consiglio: prima caricamento a mano + lettore, poi consegna via edge.
- [x] 8b. Riccardo (21/10): **invio diretto da DA-IPAM all'hub, come fa la sonda edge**, più un **report dell'inventario degli oggetti rilevati** per un'analisi completa. DA-Vul-can sta già facendo un'integrazione in una sessione separata: chiesto a DA-VULCAN 21-10 il contratto (endpoint, autenticazione, formato). Risposta: lo scrive lei in DA-Vul-can `docs/superpowers/specs/2026-10-21-ad-sicurezza-e-documento-direzione-design.md`, sezione «Contratto per DA-IPAM»; **niente codice in DA-IPAM finché Riccardo non approva la specifica** (DA-VULCAN manda percorso e commit).
- [x] 5e. Eseguito il 21/10 con un agente per task: T1-T5 + correzioni della revisione finale + tendina «SNMP aggiuntivo» (persa in T4, ritrovata da una prova). v0.9.815-820 su dev; hub aggiornato alla v0.9.820 (16:27), conversione `classificazioni_v21` fatta (47 host, 13 apparati). Visto a schermo a 1440 su copia del DB dell'hub.
- [x] 5f. DTS: segno `classificazioni_v21` done (29 host, 2 apparati), alla v0.9.819 alle 16:11, la 820 arriva col timer.
- [x] 9. Export AD (`lib/ad/health/export.ts`), chiesto da DA-VULCAN: (a) `diagnostic: true` esplicito nel raw_json dei diagnostici; (b) DA-A-DomainScore con gravità e CVSS allineati. Collaudo sull'hub DA-Vul-can (21/10, esecuzione 9): (b) verificata, Critical/CVSS 10; (a) non visibile, perché l'esecuzione non ha diagnostici (la copre la prova). File di collaudo cancellato.
- [x] 10. Invio diretto AD + inventario all'hub DA-Vul-can: il contratto delle rotte `/api/ipam/*` arriva dopo l'approvazione del piano A2 di DA-Vul-can (Riccardo). Fino ad allora niente codice qui.

## 2026-10-21 — Collector modulari QNAP

Piano: docs/superpowers/plans/2026-10-21-collector-modulari-qnap.md

- [x] Piano e controllo completo approvati; lettura regole e identificazione iniziale.
- [x] Spec e piano registrati; esecuzione locale senza push/deploy.
- [x] Contratto e parser con prove.
- [x] Trasporti limitati, registry e collector QNAP QSS.
- [x] CLI e adapter senza DB.
- [x] Collaudo reale: identità/porte/VLAN/FDB/LLDP/STP/LAG/sensori; IP/ARP errori espliciti e PVID non osservato.
- [x] 32 prove mirate/SNMP verdi, lint senza errori e typecheck/build verdi; manuale e ADR 0024.
- [x] Difetti scoperti e corretti: timeout durante output lungo, STP ruolo/stato scambiati, errore IP escluso dal risultato globale, fonti SNMP attribuite senza credenziali.
- [x] Commit locali selettivi e verifiche conclusi; nessun push/deploy.
- [ ] Rinviato: aggancio persistente/UI in DA-IPAM, altri firmware, LLDP esteso, PoE, API e SNMPv3; non approvati in questa tappa.
- [x] Trappola rilevata e gestita: SSH solo shell, SNMP per tabella; timeout di inattività + termine totale per output lungo.

## 2026-10-21 — Collector HP ProCurve / ArubaOS-Switch

Estensione richiesta da Riccardo, stesso contratto e perimetro locale della tappa QNAP.
Piano: docs/superpowers/plans/2026-10-21-collector-procurve.md

- [x] Lettura contesto e stato: working tree pulito; SNMP identifica Aruba 2540 JL357A.
- [x] Campioni read-only acquisiti con operator: porte/VLAN/LLDP dettagliati, STP, LAG, PoE e ventole.
- [x] Parser ProCurve e profilo console con regressioni QNAP; 46 prove verdi.
- [x] Collector hp-procurve, registry e adapter comuni; risorse/ambiente opzionali compatibili con QNAP.
- [x] Collaudo reale con 52 porte fisiche, 48 PoE, 24 VLAN e LLDP dettagliato; nessun segreto nell’output.
- [x] 47 test, lint senza errori e typecheck/build verdi; documentazione aggiornata.
- [x] Commit locali del 2540 e verifiche conclusi; nessun push/deploy.
- [ ] Rinviato: singole istanze MST, sensori numerici temperatura/RPM e altri modelli/firmware, non collaudati.

- [x] Difetto scoperto nel pager HP: “next line: Enter” incollato alla riga seguente perdeva una porta PoE e altre righe. Fix e prova vista rossa→verde; controllo dei conteggi per FDB/VLAN/LLDP.

- [x] Secondo apparato identificato HP J9850A 5406R zl2; raccolta modulare riuscita con lo stesso collector.
- [x] Modulare collaudato: 132 entità fisiche, 6 moduli osservati; interfacce/PoE predisposti senza modulo osservato marcati, non cancellati.

## 2026-10-21 — Collector Comware

Seguito richiesto da Riccardo dopo HP modulare: profilo separato, stesso JSON/CLI, sola lettura, niente push/deploy. Credenziali solo nel vault.

- [x] Identificato IRF HPE 5700, Comware 7.1.045 Release 2432P06; campioni display acquisiti.
- [x] Parser/collector hp-comware e profilo SSH exec; risorse per membro, 63 prove verdi (QNAP/HP/Comware/SNMP).
- [x] Collaudo reale completato: 4 membri IRF, 29 VLAN, 94 LLDP, 42 LAG, 12 temperature, 8 ventole/8 PSU; snapshot parziale esplicito per timeout SNMP. Lint/typecheck/build verdi, manuale aggiornato.

- [x] Difetto temperatura: nome «hotspot 1» contiene uno spazio; regressione vista rossa→verde.
- [x] Diagnostica preliminare: timeout 8 s con canali aperti bloccava il batch; una lettura corretta, poi exec separati con chiusura e stop su trasporto guasto.
- [ ] Rinviato: Comware 5/altri firmware, PoE abilitato, ottiche DOM/IPv6 e integrazione persistente; fuori dai casi collaudati.

- [ ] Comware: completare ifTable/ifXTable/ENTITY con strategia SNMP misurata; a 15 s anche blocchi 50 restano parziali (dati preservati, 307 entità osservate). Nessun inventario completo dichiarato.

- [x] Chiusura locale: 63 test, lint (0 errori/69 avvisi preesistenti), typecheck e build verdi; controllo segreti/permessi, compatibilità JSON QNAP/modulare e documentazione. Commit selettivo senza push/deploy.

## 2026-10-21 — Collector VMware ESXi diretto

Piano: `docs/superpowers/plans/2026-10-21-collector-vmware-esxi.md`; estensione richiesta da Riccardo, stesso perimetro locale senza push/deploy.

- [x] Working tree pulito e regole lette; preflight API identifica HostAgent ESXi 8.0.3, impronta TLS e credenziali solo nel vault.
- [x] Trasporto SOAP, contratto e collector con proprietà selezionate, CA/pin TLS, sessione singola e logout.
- [x] 76 prove verdi; CLI reale: 18 VM/8 datastore confrontati con riferimenti host, 30 vNIC/32 dischi/4 snapshot, 4 pNIC/2 vSwitch/12 portgroup/2 VMkernel e 59 sensori.
- [x] Lint (0 errori/69 avvisi preesistenti), typecheck e build verdi; manuale e contesto aggiornati, nessun push/deploy. Commit locali selettivi.

- [x] Regressioni viste rosse→verdi: type/xsi:type confusi cancellavano i riferimenti VM/datastore; logout vuoto; route come array diretto, pNIC per key e nome rete guest distinto da MoRef.
- [ ] Rinviato VMware: LLDP/CDP/ARP, ruoli VMkernel, policy vDS/vCenter/cluster, altri ESXi e aggancio UI/DB; questa tappa legge solo il singolo host.

## 2026-10-21 — Collector NetApp ONTAP / MetroCluster

Piano: `docs/superpowers/plans/2026-10-21-collector-netapp-ontap.md`; stesso perimetro locale dei collector, nessun push/deploy.

- [x] Working tree pulito; preflight e login REST riusciti su ONTAP 9.16.1P11, credenziali e pin nel vault.
- [x] Trasporto GET limitato e collector/schema storage/MetroCluster, stato per sottocollezione, byte esatti.
- [x] 87 prove verdi e CLI reale: storage ok, nodi/DR distinti, 36 dischi locali e 36 remoti, nessun segreto nel JSON.
- [x] Lint senza errori, typecheck/build verdi; manuale/ADR/consegna e contesto aggiornati, commit locali senza push/deploy.

- [x] Richiesta successiva: analisi vCenter per costruire il modello. Prova locale riuscita con 13 host/431 VM/38 datastore/5 cluster/2 DVS/21 DV portgroup, snapshot nel vault/dossier privato.
- [x] Consegna richiesta per l’agente DA-IPAM in `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`; modello e criteri di correlazione, separazione da installazione/persistenza ancora da eseguire.
- [x] Difetti scoperti: XML grande oltre limite entity parser; test rosso→verde con DTD sempre rifiutati. Proprietà derivate vCenter InvalidProperty: prototipo legge configurationEx e defaultPortConfig, selezione nel parser.
- [x] Analisi privata: 8 correlazioni NFS univoche su 25, 17 non correlate; dati identificativi restano nel dossier clienti, vista aggregata separata.
- [ ] Rinviato: profilo vCenter di prodotto, schema/anteprima/UI/importazioni dev, cluster ONTAP remoto diretto, mapping VMFS→LUN e rete fisica. Nessuna attivazione implicita.

- [x] Pacchetto `~/Documents/DA-IPAM-collector-e-modello-20261021.tar.gz`: 35 file, manifest con hash/commit, codice/test/manuale/consegna; nessun inventario o credenziale. Verificati hash e contenuto. Vista aggregata Canvas con typecheck verde.

## 2026-10-22 — giro 4 dei collector

- [x] Trovati nel `dev` locale di Riccardo due commit non pubblicati (`6395bfa9`, `6bf94155`): profili collaudati `unifi-controller`, `synology-dsm`, `qnap-nas`, `mikrotik-routeros`, `ubiquiti-device`, `proxmox-ve`, su base di prima di C0. Pubblicati sul ramo `collector-locali`.
- [x] Giro cloud 4 (leggero, cloud): merge di `dev` e `collector-locali`; un collector per famiglia sul catalogo unico; porte solo per switch/router; aggancio al riconoscimento; `bulk-scan-devices` allineato; manuale con stato di collaudo.
  - `qnap-nas`, `mikrotik-routeros`, `synology-dsm`: base collaudata (motore d'inventario); dal giro 3 solo firmware QNAP vero, condivisioni e pacchetti NAS, velocità/PoE/FDB/STP/stato MikroTik, modello e seriale Synology da SSH. `synology-nas` e i due collector paralleli sono tolti. `ubiquiti-device`, `proxmox-ve`, `unifi-controller` nel catalogo (credenziale `unifi` solo per la CLI).
  - Corretto nel motore collaudato: vicini e bond su un'uscita illeggibile erano `ok` con lista vuota, ora `partial` (la prova di contratto lo ha visto).
  - **Da provare in locale, su apparati veri** (tutto ciò che è «dal giro 3» non è mai stato visto su un apparato): QNAP NAS (firmware da `getsysinfo firmver`/`/etc/version`, condivisioni, QPKG); Synology (condivisioni, `synoshare --enum` o `-enum`, pacchetti INFO, modello da `/proc/sys/kernel`); MikroTik su un router e su un CRS con PoE (monitor ethernet, PoE, `bridge host`, STP per porta, oper/admin dalle bandiere); Ubiquiti: SSH da correggere, finora solo SNMP; Proxmox con credenziale `ssh` dell'archivio (non `local_ssh`) con l'interruttore acceso; poi premere «Aggiorna» su un NAS e verificare che l'apparato non riceva porte da switch.
  - **Decisioni aperte per Riccardo**: (1) `unifi-controller` NON è agganciato al pulsante: nessuna regola chiara (una console non è un apparato; serve una scheda o un'anagrafica «controller»). (2) `linux` e `windows` non sono agganciati perché non collaudati. (3) Proxmox con l'interruttore acceso e credenziale `ssh` sostituisce il Scan Proxmox storico (API :8006 + VM/CT): le VM non si importerebbero finché non si sceglie «classica» nella tavola della fonte; da decidere se il collector deve restare solo-hypervisor in sola lettura accanto allo scan. (4) VLAN MikroTik: il collaudato legge solo la membership corrente (`current-*`), il giro 3 ripiegava sulla configurata.

## 2026-10-21 — Collector dedicati NAS e Proxmox (seguito multivendor)

Livello Base, sola lettura e sviluppo locale; accessi NAS confermati da Riccardo, Proxmox da vault locale. Niente push/deploy o DB.

- [x] Identificati tre NAS raggiungibili e target Proxmox documentato; accessi/campioni solo nel vault. Quarto NAS irraggiungibile al preflight, collaudo rimandato.
- [x] Estratte letture/parser da nas-acquisition e Proxreporter/Proxmox, senza DB, cron o installazioni remote.
- [x] Aggiunti profili Synology DSM, QNAP NAS e Proxmox VE nello stesso contratto/CLI; manuale e consegna aggiornati, copertura parziale dichiarata.
- [x] 22/10: 123 prove verdi, lint 0 errori/69 avvisi storici, typecheck/build verdi; campioni reali e controllo segreti, commit locale selettivo.
- [x] MikroTik RouterOS: profilo dedicato, router 12 e switch 7 interfacce, VLAN/bridge/ARP/rotte/vicini; campioni e credenziali solo nel vault.
- [x] Ubiquiti diretto: profilo SNMP/SSH dedicato, AP con 13 interfacce SNMP; SSH rifiutata (auth_failed), tentativi fermati. Altro switch non acquisito per mancata risposta. Controller già collaudati; offline non equivale a rimosso.

## 2026-10-22 — UniFi controller, prima tappa multivendor

- [x] Collector `unifi-controller` integrato nel contratto/registry/CLI; riuso del client read-only e parser senza DB.
- [x] 90 prove verdi, typecheck verde; CLI su entrambi i controller, 17 e 11 apparati, pin conservati negli input del vault e segreti assenti dai JSON.
- [x] Lint (0 errori/69 avvisi preesistenti), typecheck, build e 24 regressioni del client UniFi verdi; commit selettivo locale, nessun push/deploy.
- [x] Prima copertura parziale degli altri cinque profili completata il 22/10; radio/client ancora da estendere.

## 2026-10-22 — Chiusura prima copertura multivendor

- [x] Allowlist statiche, sessione SSH per batch e OpenSSH locale opt-in Proxmox; errori, dati parziali e comandi unsupported distinti.
- [x] Regressione MikroTik capacità stringa→array corretta e verificata sul router reale; BigInt senza literal per target TS del progetto.
- [ ] Accesso SSH Ubiquiti da correggere/confermare: autenticazione rifiutata, nessun ulteriore tentativo automatico.
- [ ] NAS irraggiungibile da ricollaudare quando raggiungibile; vecchi NAS senza lsblk/ip JSON restano parziali, nessun tool installato.
- [ ] Estensioni future: radio/client avanzati, PoE/FDB/STP operativo completi, API native NAS/Proxmox e dettaglio dischi VM; integrazione UI/DB ancora separata.
- [x] Riccardo (22/10), fine giro 4: (1) controller UniFi = migliorare la sua sincronizzazione con più dati, non il pulsante; (2) collaudi Windows su 192.168.99.71, Linux su un nodo Proxmox o da-sftp; (3) Proxmox: prima il collector legge tutto (VM/CT) senza sostituire la scansione di oggi, intanto **fuori dal pulsante**; (4) VLAN MikroTik configurata e attiva, entrambe. Piano §7 «Fine giro 4».
- [x] Collaudi dalla CLI (22/10, sessione locale, codice `collector-modulari` a `b13894ef`, file d'ingresso del vault `collectors/`; uscite 2 = parziale, come dichiarato):
  - **QNAP .40.26** (SSH): modello TS-h765eU, **firmware 5.2.7 giusto** (non più il kernel), 17 QPKG, 6 condivisioni, memoria, RAID, 9 interfacce; `df` permesso negato con utente non root (dichiarato).
  - **QNAP .40.24** (solo SNMP): 4 dischi, 2 volumi, 19 interfacce come stanotte; **modello e firmware vuoti**: via SNMP non si leggono gli OID QNAP (`1.3.6.1.4.1.24681.1.2.x`, QTS5 `…24681.1.4`) che il profilo storico conosce.
  - **Synology .40.22**: DS723+, DSM 7.4.1, 24 pacchetti, 14 condivisioni (parziale: `synoshare` e NFS non letti senza root), 4 dischi, 4 RAID, 8 interfacce via SNMP; **difetto: il messaggio SSH «Could not chdir to home directory…» finisce nel nome host**; `ip -j` non esiste su DSM.
  - **Synology .40.23**: irraggiungibile (SSH e SNMP in timeout), come al preflight di stanotte; il suo file d'ingresso ha un blocco `api` che lo schema rifiuta.
- [x] Collaudi (22/10, pomeriggio), file d'ingresso nel vault `collectors/` (Windows e MikroTik compilati da Riccardo), Linux con la chiave di Riccardo in un ingresso temporaneo cancellato subito:
  - **Windows** `RGSERVER` 192.168.99.71, WinRM 5985: **esito ok** in 15 s. Windows Server 2022 Standard (20348), 42 programmi, 239 servizi, 1 disco, antivirus, 3 profili firewall separati, memoria, 2 IPv4, 1 scheda. Non letti: CPU, NTP, ARP, duplex (dichiarati). Non è un host Hyper-V: la sezione virtualizzazione resta da collaudare su un host col ruolo.
  - **MikroTik** `DA-RT-CORE` 192.168.15.254 (CCR2004, 7.24.5): parziale. Risorse, 8 IPv4, 1523 ARP, 33 interfacce, 12 VLAN (configurate e correnti distinte), 229 FDB, 39 vicini, RSTP su 9 porte, 3 bond. **Da correggere:** velocità/duplex non interpretati (`TERSE_FLAGS_AND_NEGOTIATED_SPEED_NOT_INTERPRETED`); PoE su un apparato senza PoE dà `FORMAT_UNRECOGNIZED_OR_EMPTY` invece di «non presente».
  - **Linux** `da-ftp` 192.168.20.14 (utente `domarc`, chiave): identità (Ubuntu 24.04.2, VM QEMU), sistema e memoria letti; **poi il lotto si interrompe** (`SSH_BATCH_ABORTED`): dischi, pacchetti, servizi, interfacce vuoti. Un comando fallito (probabilmente `timedatectl`) è trattato come guasto di trasporto.
- [x] Giro 5: Proxmox fuori dal pulsante e collector esteso fino alla parità con la scansione di oggi; VLAN MikroTik configurata+attiva; dai collaudi: stderr/banner SSH mai nei campi (nome host Synology), identità QNAP via SNMP dagli OID enterprise, ripiego senza `ip -j` sui NAS vecchi; Linux: comando fallito ≠ trasporto guasto, il lotto continua; MikroTik: velocità/duplex dalle bandiere e dal monitor, PoE assente = non presente; poi aggancio di Windows e Linux dopo i loro collaudi.
- [x] Giro cloud 5 (leggero, 22/10): correzioni dai collaudi, Proxmox fuori dal pulsante ed esteso verso la parità, Windows e Linux agganciati (prompt, «Giro 5»).
  - **Linux/SSH a lotti** (`leggiLotto`, `transports.ts`): un comando fallito, assente, senza permesso, senza stato di uscita o oltre il limite di byte non ferma il lotto; si ferma per canale caduto, connessione fallita, tempo totale o due scadenze di fila. Prova `lotto-ssh.test.ts` (vista rossa con la lista vecchia).
  - **Synology**: stderr e «Could not chdir to home directory…» mai nei dati (`exec-reader.ts`, rossa vista); `ip -j` che esce 1 su DSM = `unsupported` con `IP_JSON_NOT_AVAILABLE_ON_DSM` + `SNMP_USED_INSTEAD`.
  - **QNAP solo SNMP**: modello, firmware e seriale da `…24681.1.2.1/2/3.0` (valori numerici o con «%» scartati). **Le varianti QTS5 (`…24681.1.4`) NON sono aggiunte**: non conosco gli OID esatti; serve uno `snmpwalk` su `.24` per scriverli.
  - **MikroTik**: tolto l'avviso «bandiere/velocità non interpretate» quando le bandiere e il monitor ethernet sono capiti; PoE senza righe `poe-out` = `unsupported` / `POE_NOT_PRESENT`. **Non so la forma vera** dell'uscita `poe monitor` su un CCR senza PoE: la prova usa una forma plausibile (solo `name:`). Se sul `192.168.15.254` resta `FORMAT_UNRECOGNIZED_OR_EMPTY`, serve l'uscita grezza.
  - **Proxmox** fuori dal riconoscimento del pulsante; il collector legge `guests` (VM e CT: stato, risorse, dischi, reti), `storage_pools`, `cluster_nodes` (nuove sezioni opzionali dello schema; due `grep -H` nell'allowlist). Tabella della differenza nel manuale: mancano dati hardware del nodo, IP delle VM (agent) e scrittura nell'inventario. L'aggancio torna solo con una tua decisione.
  - **Windows e Linux** agganciati al riconoscimento (vendor `windows`; vendor `linux` tranne hypervisor/scan_target proxmox); descrittori `collaudato`. Le porte da switch restano solo per switch e router.
  - **Non fatto**: VLAN MikroTik configurata+attiva distinte (decisione 4 del fine giro 4; il motore legge ancora solo la membership corrente).
  - **Da ricollaudare in locale**: Linux `da-ftp` (dischi, pacchetti, servizi, interfacce dopo la correzione del lotto), MikroTik `192.168.15.254` (velocità/duplex, PoE «non presente»), QNAP `.24` (modello e firmware via SNMP), Synology `.22` (nome host senza il messaggio, interfacce da SNMP senza errori `ip -j`), Proxmox da CLI (guest, storage, nodi; serve un utente che legga `/etc/pve`); poi premere «Aggiorna» su un Windows e su un Linux con interruttore acceso.
  - **Decisioni per Riccardo**: (1) Proxmox: si vuole la parità (IP VM, dati nodo, scrittura inventario) o il collector resta solo-lettura accanto alla scansione? (2) VLAN MikroTik configurata+attiva nel prossimo giro? (3) Servono gli OID QTS5 di QNAP: uno snmpwalk di `.24`.

## 2026-10-22 — ricollaudi del giro 5 (sessione locale, codice `9ef16c64`)

- [x] **Linux `da-ftp`**: lotto corretto, ora completo salvo LVM (permesso negato senza sudo, dichiarato): 3 dischi, 9 filesystem, 811 pacchetti, 64 servizi, 2 interfacce, Ubuntu 24.04.2.
- [x] **MikroTik `DA-RT-CORE` 192.168.15.254**: velocità e duplex su 12 porte su 33 (le collegate); PoE `unsupported` con `POE_NOT_PRESENT`. VLAN configurate e attive distinte (Riccardo, 22/10: «configurate e attive», entrambe).
- [x] **Synology `.22`**: nome host pulito («DA-FILES»).
- [x] **QNAP `.24` (solo SNMP): errore nuovo** — `firmware = "15979.0 MB"` (è la memoria). Gli OID `…24681.1.2.1/.2/.3` presi dal profilo storico qui sono CPU %, memoria totale, memoria libera, non modello/firmware/seriale. Walk limitato del 22/10 (QGD-1602P, valori corti, seriale mascherato):
  - modello: `1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.3.1` («QGD-1602P») e `1.3.6.1.4.1.55062.1.12.3.0`;
  - seriale: `…24681.1.4.1.1.1.1.1.2.1.4.1`; nome: `….2.1.6.1`; temperatura: `….2.1.7.1`;
  - ventole: tabella `1.3.6.1.4.1.55062.1.12.9.1` (indice `.1`, nome `.2`, giri `.3`);
  - firmware: **non trovato via SNMP** su questo modello → resta `null`, mai un valore preso da un altro OID.
- [x] Giro 6: identità QNAP via SNMP dagli OID sopra (con prova che un valore «… MB» o «… %» non diventa mai firmware/modello); stessa verifica sul **profilo storico** `scanner/snmp-vendor-profiles.ts` (`id: "qnap"`), che usa gli stessi OID sbagliati e oggi, su `dev`, può scrivere la memoria come firmware: correzione da portare anche su `dev`.
- [x] Giro 6: Proxmox fino alla parità (dati hardware del nodo, IP delle VM dall'agent, VM nell'inventario come fa la scansione). **Aggancio al pulsante: decisione di Riccardo**, tabella nel manuale (`docs/modules/acquisition.md`).
- [x] Riccardo (22/10): giro 6 sì; il profilo storico QNAP si corregge sul ramo e arriva su `dev` con l'unione.
- [x] Giro cloud 6 (leggero): QNAP via SNMP con gli OID giusti (collector e profilo storico), Proxmox fino alla parità (prompt, «Giro 6»).
- [ ] **Da ricollaudare in locale (giro 6)**: (1) QNAP `.24` solo SNMP: attesi modello `QGD-1602P`, firmware assente (`null`), seriale, temperatura e ventole; nessun «MB» o «%» nei campi. (2) Profilo storico `qnap` su un hub vero: dopo l'avvio la riga builtin ha i nuovi OID (una scansione di un QNAP non scrive più la memoria come firmware). (3) Proxmox da CLI con un utente che legga `/etc/pve` e il rapporto del nodo: nodi con CPU/kernel/disco root/seriale/abbonamento, VM accese con IP dall'agent; con un utente senza permessi attesi i codici `NODE_*_NOT_READ`. (4) Con interruttore acceso, applicare lo snapshot Proxmox a un apparato e confrontare `last_proxmox_scan_result` con quello della scansione di oggi (nodi, VM, IP).
- [ ] Decisione di Riccardo: agganciare `proxmox-ve` al pulsante? Differenze rimaste: schede di rete dei nodi (non proiettate), socket/core delle VM (`sockets` = 1).
- Nota del giro 6: il `v0.9.871` del giro 5 non è stato rialzato; il merge di `origin/dev` ha portato `VERSION` a 0.9.873 (versione di `dev`).
- Cancello del giro 6 (commit 07a4944e): lint=0, tsc=0, npm test=0 (DA_INVENT_DATA_DIR temporanea), build=0.

## 2026-10-22 — collaudi del giro 6 (sessione locale, codice `7e0b83a2`)

- [x] **QNAP `.24`** (solo SNMP): **corretto** — modello QGD-1602P, seriale letto, firmware `null` (non più la memoria), 6 sensori, 19 interfacce.
- [x] **Proxmox DA-PX-04** 192.168.40.4, root con la chiave di Riccardo (ingresso temporaneo cancellato): 76 s, parziale. Cluster visibile intero: 4 nodi (CPU, socket, core, kernel, disco root, abbonamento attivo), 52 guest (stato, risorse, dischi, reti; agent su 44), 28 storage, 34 interfacce.
- [ ] **Proxmox, mancano per la parità**: modello/seriale/produttore hardware dei nodi vuoti su tutti e 4 (la scansione li prende dall'API); IP dei guest su 24 di 52 con agent attivo su 44 (`GUEST_IP_ADDRESSES_PARTIAL`). Da completare prima dell'aggancio al pulsante.

## 2026-11-03 — Pubblicazione collector Aruba AOS-CX su dev

Riccardo: «puoi metterlo anche su dev»; livello Leggero, integrazione della release locale collaudata il 27/10.
- [x] Base origin/dev aggiornata e worktree isolato; codice collector invariato rispetto al collaudo, nessuna modifica ai lavori concorrenti.
- [x] Cancello finale 03/11: lint exit 0 (72 avvisi storici), npm test exit 0 (6.321 passate, zero fallite, 2 saltate e 1 TODO), build e tsc exit 0 con Node 22.
- [x] Snapshot VM 533 `pre-aruba-cx-20261103` su `DA-PX-03` (192.168.40.3), confermato da qm listsnapshot il 03/11 prima del push.
- [x] Release 0.9.949, commit `77aa3800`, push su dev riuscito; git ls-remote origin refs/heads/dev conferma lo stesso hash il 03/11. Nessun aggiornamento firmware.

## 2026-11-03 — Collector Infoblox IPAM, DHCP, DNS

Riccardo: approvato livello Leggero e collector in sola lettura; target e utente indicati in chat, password da fornire separatamente.
- [x] Verificato il contratto dei collector e la documentazione ufficiale Infoblox: WAPI schema per versioni/oggetti, GET e paginazione.
- [x] Acquisire la credenziale autorizzata tramite vault-a-stdin, mai in chat o nel repo; definire versione WAPI, TLS e permessi effettivi sul target.
- [x] Preparare collector/parser per IPAM, DHCP e DNS con dati parziali espliciti, prove offline e collaudo autenticato; nessun DB, configurazione, UI o automatismo modificato.

- [x] Infoblox, aggiornamento 03/11: credenziale autorizzata trovata nella copia locale e letta solo con vault-a-stdin; WAPI 2.12.3 autenticata. Collector in `/Users/riccardo/Progetti/Domarc/.worktrees/da-ipam-infoblox`, ramo codex/infoblox, release locale 0.9.953 (ed181f9d); cancello completo verde (6.335 prove passate).
- [!] Infoblox: collaudo esteso DNS/lease interrotto da timeout TLS; 18 reti, 28 range, 633 prenotazioni e 2.000 lease acquisiti. Attesa risposta di Riccardo sulla raggiungibilità. Piano/consuntivo nel worktree `docs/superpowers/plans/2026-11-03-infoblox.md`; niente push/dev, DB o configurazione modificati.

- [x] Infoblox, ricollaudo 03/11 su richiesta di Riccardo: raccolta completa in 37 s, 23 tabelle/6.853 record; DNS e 3.953 lease completati senza timeout. Superati i blocchi di accesso precedenti. Resta `partial` per firmware NIOS non letto e `options` di ipv6range non esposto. Snapshot privato aggiornato; nessuna modifica a DB/apparato o push. Fonte corrente: CONTEXT/TASKS del worktree da-ipam-infoblox.

- [x] Riccardo (03/11): «scrivi il contesto per l’integrazione dentro DA-IPAM». Aggiornata la consegna esistente `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`, sezione Infoblox: sorgenti locali/commit, contratto DDI, collaudo completo, limiti, vincoli reali reti/lease, mapping e prove da sviluppare. Solo documentazione; nessuna integrazione o pubblicazione eseguita.

## 2026-11-04 — Arricchire il detect (vendor OT non classificati, GET pagina, password di default)

Riccardo (04/11, sonda 72729-ipam): apparati di vendor sconosciuti non classificati — **CREVIS Co LTD**, **Weintek**, **Microchip Technology**, **Kronotech srl** — «per molti device c'è un profilo di porte che rispondono». Tre richieste collegate: (1) arricchire il detect per questi vendor; (2) il detect deve fare un **GET della pagina web** più approfondito (Riccardo non può farlo a mano da qui); (3) verificare se la **password degli switch rilevati è quella di default**.

Stato del codice (letto, non modificato):
- Catena del detect: `scanner/device-fingerprint.ts` (regole da DB `device_fingerprint_rules`, seed builtin in `db.ts:seedBuiltinFingerprintRules` ~1879) → `classification/normalize.ts` → `classification/engine.ts`; regole hardcoded di fallback in `device-classifier.ts`; mappa etichetta→slug in `device-fingerprint-classification.ts`.
- **Perché restano unknown**: `classifyDeviceDetailed` NON mette il `vendor` nel corpus testuale (solo sysDescr/osInfo/hostname/snmpContext); `VENDOR_RULES` non copre i 4 vendor; nessun OID/porta OT (502 Modbus, 44818 EtherNet/IP, 5900 VNC) nelle regole. → classificazione `unknown`.
- GET HTTP attuale (`device-fingerprint-probes.ts`): solo `http://ip` e `https://ip`, body troncato a 2000 byte, estrae `<title>`, header `Server`, e una lista fissa di ~30 keyword (nessun vendor OT). Non legge `WWW-Authenticate` (realm/basic auth), né meta/favicon, né path noti.
- Password di default: esistono `device-connection-test.ts`, binding credenziali, catena SNMP (la rete 1 ha solo community `public`). Nessun controllo "credenziale di default". Candidato naturale: in parte DA-Vul-can (scanner vulnerabilità), in parte qui (community SNMP di default è già osservabile a costo zero).

Firme reali raccolte (web, da verificare sul campo):
- **Weintek** (HMI cMT/MT): web su 80, VNC 5900 (+5800 web-VNC); pagina `/admin` (EasyWeb 2.0); **default pwd 111111** o `m1111111`; VNC default 111111. Vari CVE 2024-2026.
- **CREVIS** (G-series / GN-9xxx remote I/O): Modbus TCP 502, SNMP, MQTT, web server HTTP; alcuni modelli EtherNet/IP (44818) + switch integrato 2xRJ45.
- **Kronotech** (divisione Zucchetti): terminali rilevazione presenze/controllo accessi italiani; nessuna scheda tecnica di rete pubblica trovata → fingerprint da ricavare dal campo (GET pagina + OUI).
- **Microchip Technology**: è un **OUI di chip** (LAN8xxx, ATWINC WiFi) usato da device embedded di terzi → il vendor da solo NON è discriminante; serve pagina/porte per capire cos'è davvero.

Proposta: piano a 3 assi, livello completo (tocca detect + credenziali + sistemi cliente). Vedi proposta in chat del 04/11.

- [x] **Asse 1 fatto** (04/11, Riccardo «parti dall'asse 1»): regole vendor OT (Weintek→hmi, CREVIS→plc, Kronotech→iot) e porte OT (Modbus 502, EtherNet/IP 44818→plc) in `device_fingerprint_rules` (seed idempotente), mappa etichetta→slug, VENDOR_RULES/PORT_RULES nel fallback. Microchip non classificato per vendor (OUI di chip). 7 prove nuove; cancello verde (lint 0, tsc, 6354 test, build). **Rilasciato su dev 0.9.959** (8b3815b1 + f3b4befa, push f3b4befa). Nota albero condiviso: il mio append precedente era già finito nel commit GS1900 0045e531 di un'altra sessione.
- [x] **72729 segue `main`**: per vedere il detect OT lì serve la promozione dev→main (col sì di Riccardo). Hub 533 e appliance A (dev) prendono le regole al prossimo riavvio/seed.
- [x] Gli apparati già `unknown` si riclassificano solo a una nuova scansione/fingerprint (unknown→noto è un upgrade permesso): dopo il rilascio su main, rileggere i device OT della 72729.
- [ ] Asse 2 (GET pagina web più profondo) e Asse 3 (password di default degli switch) non fatti: erano scelte separate.

## 2026-11-04 — Arricchire i dati dei device già classificati: stampanti via Printer-MIB (da decidere)

Riccardo (04/11): «migliorano il detect di quello che c'è. Anche le stampanti che ho classificato come stampanti e che rispondono in SNMP non ottengono info sulle stampanti, ma solo dati generici.»

Causa (codice letto, non modificato):
- **Nessun tipo scheda `stampante`**: `tipoScheda` (`lib/scheda/tipo-scheda.ts`) non ha il caso stampante → cade in `generico` (solo Panoramica + Dettagli). Per questo si vedono solo dati generici.
- **Nessun collector stampante**: `lib/acquisition/` non ha un adapter stampante; l'SNMP generico legge solo sysDescr/modello/seriale/firmware. I profili prodotto `hp_stampante`/`generic_stampante` (`device-product-profiles.ts`) *dichiarano* `specificFields: counters/supplies/alerts` ma è solo metadato d'intento, niente li legge.
- Nel seed SNMP il seriale stampante è mappato a `1.3.6.1.2.1.43.5.1.1.16.1` (è prtGeneralPrinterName = nome/modello; il seriale standard è `.17.1`): da verificare/correggere.

Proposta (livello leggero: SNMP in sola lettura + UI + una tabella):
1. Collector `printer-snmp` (RFC 3805 Printer-MIB + Host Resources): modello (prtGeneralPrinterName 43.5.1.1.16.1), seriale (43.5.1.1.17.1), pagine totali (prtMarkerLifeCount 43.10.2.1.4.1.1), toner/materiali (prtMarkerSuppliesDescription/Level/MaxCapacity 43.11.1.1.6/9/8), vassoi (prtInput 43.8.2.1), stato (hrPrinterStatus 25.3.5.1.1, prtAlertDescription 43.18.1.1.8). Tabella inventario dedicata.
2. Tipo scheda `stampante`: `tipoScheda` caso stampante→"stampante"; componenti in `components/scheda/tipi/stampante/` (Panoramica + tab Materiali/Contatori: barre toner, contatore pagine, vassoi, stato, modello/seriale); registro in `tab-scheda.tsx`, `tabDelTipo`.
3. Aggancio all'acquisizione (giri, apparati-scelti, «Aggiorna») come gli altri collector.

Da fare dopo: estendere lo stesso schema ad altri tipi già classificati ma con soli dati generici (UPS, telecamere, VoIP già hanno profili d'intento ma non collector).

- [x] **Fatto** (04/11, Riccardo «Sì, stampanti leggero», livello leggero): collector `printer-acquisition.ts` (Printer-MIB RFC 3805 + Host Resources), `printer_inventory` in `DeviceInfo`/`DeviceInfoJson`, `resolvePrinterKind`, aggancio in `getDeviceInfo`. Tipo scheda `stampante` (`tipo-scheda.ts`) + tab Materiali/Contatori (`components/scheda/tipi/stampante/`), helper `lib/scheda/stampante.ts`, registro in `tab-scheda.tsx`. 9 prove (parsing con walk sintetici), lint 0/tsc verdi.
- [ ] **Verifica resa non fatta**: niente stampante nel DB locale per renderla; la scheda si vede sulla 72729 dopo deploy su main + scansione SNMP di una stampante (Riccardo ci sta lavorando). JSX comunque type-checked.
- [ ] HP sul solo vendor NON attiva il collector (ambiguo coi PC): una stampante HP si legge quando è classificata `stampante` (OID/porte lo fanno). Gli OID Printer-MIB sono standard; il seriale usa `43.5.1.1.17.1` (corretto vs il `.16.1` del segnalato seed SNMP, che è il nome).

## 2026-11-10 — Promozione su main: fatta alle 00:xx dell'11/11 dopo il cancello verde

- [x] `git push origin origin/dev:main`, avanzamento pulito `e099d45e..70237504` (0.9.1135), su richiesta di Riccardo («promuovi in main»).
- [ ] Dopo la promozione: controllare che 70151 e le appliance da immagine (72729, 71343, 79993) abbiano preso la 0.9.1135 e che il servizio sia attivo. Non verificato la notte del 10/11: su quelle macchine la chiave di Claude è rifiutata.

- [ ] Riccardo (10/11 sera): «promuovi in main». Cancello su `origin/dev` `a249ce99`: lint e tipi verdi, **8 prove rosse su 8013**, promozione NON fatta.
  - 5 rosse dalla release 0.9.1113 (`12a517d4`, «Classi vecchie svuotate», altra sessione): `classification/__tests__/scrittura-canonica.test.ts` (upsertHost con `dns_server` dà classe `null` invece di `server`) e 4 di `__tests__/topologia-t2-freno.test.ts` (10 apparati con `classification: null` invece di server/switch/router/nas). Da decidere: prove vecchie da aggiornare, o la svuotatura cancella anche classi appena scritte.
  - 1 rossa da `01898a25` (altra sessione): `schedulazioni/__tests__/elenco.test.ts`, `scanner/rilancia-giri` avviato da `server.ts` senza riga in Schedulazioni.
  - 2 rosse da prima di oggi: `transfer/__tests__/registry.test.ts` (`triage_rilievi` non classificata) e `scanner/profili/__tests__/sconosciuti.test.ts` (porta 9100/UDP).
  - La build nel worktree fallisce per `node_modules` (artefatto locale): l'hub costruisce lo stesso codice senza errori.
- [x] Sonda 79993-ipam-9 (bridge 44): 0.8.294 scritta alle 23:16, sonda alla 0.8.294 alle 23:31 (letto da `dalink sonde stato`; partiva dalla 0.8.263, ci mette un quarto d'ora). 71343 non ancora toccata; 70151 ferma alla 0.8.263 con voluta 0.8.270, da capire.
- [x] 10/11 notte, Riccardo: «No, prima le prove». Sistemate 3 su 8 (prove mirate verdi, 67/67): `triage_rilievi` nel registro trasferimenti (viaggia col tenant, `asset`); `scanner/rilancia-giri` in Schedulazioni come «fuori» col perché; la prova del profilo sconosciuti guarda l'elenco `-p`, non tutta la riga (dal 10/11 la 9100 è nominata in `--exclude-ports`).
- [x] Riccardo (10/11 notte): «mdm non lo usa nessuno per ora» → la regola resta, aggiornate le 5 prove (in `topologia-t2-freno` il ricalcolo viene prima di leggere l'ingresso; attese `null` dove la classe era scritta senza prove). Cancello completo verde: 8009 passate, 0 fallite, 1 «da confermare» già nota. Quando si accenderà l'MDM: i telefoni nascono senza classe finché l'MDM non porta una prova di categoria. Testo di prima: restavano 5 rosse, tutte dalla regola «classe non manuale senza categoria si svuota» (0.9.1113). Non sono solo prove vecchie: `upsertHost` con una classe passata da chi chiama la scrive e il ricalcolo all'inserimento la svuota subito. In produzione lo fa solo `integrations/mdm-sync.ts` (`classification: "smartphone"`, nessuna prova di categoria): un telefono nuovo da MDM nasce senza classe. Non misurato sull'hub. Le 4 di `topologia-t2-freno` hanno host di prova con la classe scritta in SQL senza prove: col ricalcolo si svuotano. Da decidere con Riccardo chi le sistema e come (prova di categoria dall'MDM + prove aggiornate, oppure la regola non svuota la classe passata da chi chiama).

## 2026-11-11 — URGENTE: allarme MDR sulla 70151 (ticket 1934292), l'appliance fa RDP e WinRM verso i server del cliente

- [ ] Riccardo (11/11): «guarda la sonda 70151 che sta generando questo allarme su un MDR», poi «fermiamo questa parte» e «non deve fare nulla, non è abilitato VA o controlli particolari su quel sistema».
  - Fatti dal ticket (Vectra): sorgente `172.20.40.194` (l'appliance). WinRM su 5985 con client Python verso `172.20.8.2` e `172.20.15.9` dalla mattina del 10/11; poi 103 tentativi RDP verso ~35 server `GAMO*` della `172.20.8.x` fra le 00:58 e le 04:16 ora italiana dell'11/11, col nome client «DA-IPAM».
  - Dal codice (non dalla macchina): l'unico pezzo che parla RDP è nmap coi profili «Approfondito»/«Riconoscimento automatico» (`rdp-ntlm-info`, `ssl-cert` e `-sV` sulla 3389, `src/lib/scanner/profili/profili.ts`); WinRM con client Python è `src/lib/devices/winrm-bridge.py` (acquisizioni con credenziali, salute AD). Quale giro li abbia lanciati non è accertato.
  - Coincidenza da verificare: `main` è stato promosso alla 0.9.1135 alle 23:45 del 10/11 (221 commit, dalla 0.9.1035); la 70151 segue `main`. L'RDP comincia circa un'ora dopo. Il WinRM invece è cominciato la mattina, prima della promozione.
  - Blocco: Claude non entra sulla 70151 (`ssh 70151-ipam-2`: chiave rifiutata per `domarc` e `root`). Niente fermato, niente letto dai log.
  - Serve: fermare i giri sulla macchina, leggere `journalctl -u da-ipam` fra le 00:50 e le 04:20 dell'11/11 e la tabella dei giri per sapere chi li ha lanciati, poi decidere se su quel cliente vanno spenti di serie.
- [x] 11/11 09:35: entrato dal Proxmox del cliente `172.20.40.191` (PX01), VM 104, con `qm guest exec`. **Causa accertata dal log**: alle 22:49 UTC del 10/11 l'appliance riparte con la 0.9.1135 (la promozione su `main`), alle 22:52 `[servizi-rete] giro all'avvio: DEFAULT`. Il giro «Servizi di rete» (nato il 09/11, 0.9.1042) è **acceso di serie** (`servizi_rete.automatico` assente = acceso), all'avvio e ogni 6 ore, e su ogni host fa X.224+TLS+CredSSP sulla 3389, NTLM sulla 5985, SMB anonimo (`src/lib/servizi-rete/sonde.ts`). È lo stesso giro che il 10/11 ha fatto chiudere i DC verso l'hub.
- [x] Spento sulla 70151: `tenant_settings` di `/opt/da-ipam/data/tenants/DEFAULT.db`, `servizi_rete.automatico = 0`, riletto. Al momento non girava nessun nmap né bridge.
- [x] Riccardo (11/11): «spegni su 70151, negli altri lascia» → il giro resta acceso di serie; spento solo sulla 70151 (impostazione sulla macchina, sopravvive agli aggiornamenti). Niente modifica al codice né nuova promozione. Testo di prima: **Lo stesso giro è arrivato stanotte su tutte le appliance che seguono `main`** (72729 con PLC e celle frigo, 71343, 79993): lì non è spento. Da decidere con Riccardo: giro spento di serie nel codice (regola «gli automatismi nuovi nascono spenti») e nuova promozione su `main`; sull'hub 533 andrebbe riacceso a mano.
- [ ] Il WinRM con client Python verso `172.20.8.2` e `172.20.15.9` dalla mattina del 10/11 è un'altra cosa (acquisizioni con credenziali o salute AD, già configurate prima della promozione): non toccato, da capire se è voluto.
- [x] 11/11, Riccardo: «fermalo comunque» (il WinRM). Dal log della 70151 il WinRM con client Python ha due origini, nessuna nata con la promozione: (1) `ad_sync` ogni 6 ore, che con `winrm_credential_id` chiede i lease DHCP al DC (`Get-DhcpServerv4Scope`, sempre in errore: il DC non ha il ruolo DHCP); (2) **«Chocolatey automatico»** (dal 21/10, acceso di serie): ogni notte alle 02:00 UTC prova a installare Chocolatey via WinRM sugli host Windows con accesso riuscito, stanotte 0 riuscite su 31. Spenti tutti e due sulla 70151: `patch.choco_automatico = 0`; `ad_integrations.winrm_credential_id` da 7 a NULL (per rimetterlo: `UPDATE ad_integrations SET winrm_credential_id = 7 WHERE id = 1`). Copia del DB prima: `/opt/da-ipam/data/tenants/DEFAULT.db.bak-20261111-prima-stop-winrm`. La sincronizzazione AD via LDAP continua. Non accertato chi parla con `172.20.15.9` (non è fra gli host né fra gli apparati): con ogni probabilità uno dei 31 di Chocolatey.
- [x] 11/11, Riccardo: «metti anche 70151 su main». DA-IPAM là era già su `main` (0.9.1135). Era la sonda a essere ferma: DA-Link le aveva fissato la 0.8.270, che l'hub non pubblica più («si aspetta che l'hub la pubblichi», per sempre). Fissata la 0.8.294 (`dalink sonde versione 22`), aggiornatore lanciato a mano: sonda alla 0.8.294. Nota: su quella macchina il timer dell'aggiornatore gira una volta al giorno (03:31 UTC), non ogni 15 minuti.
- [x] Riccardo (11/11): «Sì, spento di serie» → `chocoAutomaticoAccesoDb` vale acceso solo con `patch.choco_automatico = 1`; prove mirate verdi (52), tipi verdi; su `dev`. **Non ancora su `main`**: le appliance dei clienti lo prendono solo con una nuova promozione. Sull'hub 533 si spegne anche lì se nessuno l'aveva acceso a mano: da riaccendere se serve. Testo di prima: «Chocolatey automatico» acceso di serie installa software sui PC dei clienti senza che nessuno l'abbia chiesto per quel cliente. Sulle altre appliance è ancora acceso.
- [x] 11/11 ~10:00: `main` promosso a `a7b63813` (0.9.1141, Chocolatey automatico spento di serie) su richiesta di Riccardo. Cancello sul commit esatto: lint e tipi verdi, 8022 prove passate, 1 rossa (`scanner/__tests__/discovery-accesso-windows.test.ts`, «The database connection is not open») che fallisce uguale anche sul codice verde di ieri sera `70237504`: dipende dal Mac (prova un ssh vero su 127.0.0.1), da sistemare a parte. Sulla 70151 alle 10:05 c'era ancora la 0.9.1135 (timer ogni 15 minuti): **arrivo della 0.9.1141 non verificato**.
- [x] 11/11 10:10, chiusura applicata (Riccardo: «da netbird, dall'ip della mia vpn e dalla 172.20.6.0/24 che poi restringeremo»; l'IP della VPN letto dal log di nginx è `172.20.40.240`). Sulla VM: `/usr/local/sbin/da-accessi-lan.sh [metti|togli]` e `da-accessi-lan.service` (abilitato, dopo Docker). Da `eth0` entrano solo 22, 80, 443, 6443 e solo da `172.20.40.240` e `172.20.6.0/24`; 3001, 8080, 5355 chiuse a tutti; `wt0` aperta; uscite invariate. Provato: dal Proxmox `.191` (non ammesso) tutte e sei le porte aperte prima e chiuse dopo; Riccardo continua a navigare dal `.240`; NetBird connesso, hub 200, `git ls-remote` funziona. Non provato: un riavvio della VM; l'accesso dalla `172.20.6.0/24`. Rientro: dal Proxmox `qm guest exec 104 -- /usr/local/sbin/da-accessi-lan.sh togli`. Da fare: restringere la `172.20.6.0/24`; portare lo script in Deploy-Appliance (oggi vive solo su quella macchina).
- [ ] 70151: la 0.9.1141 non è ancora arrivata, l'aggiornamento delle 10:01 si è rimandato da solo perché c'era un giro in corso («1 giri in corso: rimando»). Da ricontrollare.
- [x] Testo della richiesta: «per l'appliance 70151 dovrei blindarne l'accesso, aprendo ssh solo dagli ip definiti e anche l'accesso alla UI via web, chiudendo l'accesso a qualunque porta aperta». Rilevato sulla macchina: nessun firewall (`INPUT ACCEPT`), in ascolto su tutta la LAN 22 (sshd, solo chiave), 80/443/6443 (nginx in Docker), 3001 (DA-IPAM diretto, HTTP), 8080 (sonda, uvicorn), 5355. NetBird `wt0` già accettata. Negli ultimi 7 giorni ssh solo da `100.107.204.108` (hub, via NetBird). Da fare dopo che Riccardo dà gli indirizzi: regole su `eth0` in `INPUT` e in `DOCKER-USER` (le porte pubblicate da Docker saltano `INPUT`), rese stabili al riavvio, con via di rientro dal Proxmox `172.20.40.191` (`qm guest exec 104`). Meglio come funzione di Deploy-Appliance che a mano.
- [x] 11/11, Riccardo: «proxmox deve poter fare ssh verso l'appliance» → nello script `PROXMOX=172.20.40.191`, ammesso alla sola porta 22. Provato dal Proxmox: 22 aperta e `ssh root@172.20.40.194 hostname` risponde; 443 e 3001 restano chiuse.

## 2026-11-11 — LibreNMS installato dalla 70151 ma senza gettone: non si aggiungono device

- [ ] Riccardo (11/11): «da 70151 ho installato LibreNMS ma non riesco ad aggiungere device». Causa accertata sulla macchina: `POST /api/integrations/librenms/host` risponde 422 «LibreNMS non configurato o disabilitato» perché `integration_librenms_api_token` è vuoto (modo `managed`, URL `http://172.20.40.194:8090` a posto). L'immagine è `librenms/librenms:latest` = **LibreNMS 26.10.2**, che non ha più la tabella `api_tokens`: i gettoni stanno in `personal_access_tokens` (Sanctum). `generateLibreNMSToken` (`src/lib/integrations/librenms.ts`) aspetta `api_tokens` e ci scrive: non la trova, non crea né l'utente admin (0 utenti) né il gettone. Migrazioni complete (0 pendenti), contenitori su, rete dal contenitore a posto. Non c'entrano il firewall né l'aggiornamento arrivato a metà installazione.
  - [x] 11/11: corretto in `src/lib/integrations/librenms.ts` (gettone da `lnms api:token-create` quando c'è `personal_access_tokens`; immagine fissata a `librenms/librenms:26.10.2`, tag verificato). Comandi e formato letti dal sorgente di LibreNMS nel contenitore della 70151; l'intestazione `X-Auth-Token` è ancora accettata. Prova nuova in `install-segreti.test.ts`, 10/10, tipi verdi. Su `dev`. **Non provato su un'installazione vera**: serve la promozione su `main` e rifare l'installazione dalla 70151.
  - Testo di prima: adattare il passo del gettone alla tabella nuova (verificando sulla documentazione di LibreNMS 26.10 come si crea e come si presenta il gettone), fissare la versione dell'immagine invece di `latest`, rilasciare, poi rifare l'installazione dalla 70151. Vale per ogni appliance che installa LibreNMS da oggi.
  - Nota: nel leggere la configurazione è finito a schermo l'inizio del valore **cifrato** di `integration_librenms_secret_app_key` (il filtro guardava `token`/`password`, non `secret`). È testo cifrato con la chiave dell'appliance, non la chiave in chiaro.
- [x] 11/11 10:45: `main` promosso a `440dab2a` (0.9.1146) col sì di Riccardo. Cancello sul commit esatto: lint e tipi verdi, 8036 passate, 1 rossa (la solita `discovery-accesso-windows`, dipende dal Mac). Sulla 70151 arrivata alle 10:49: versione 0.9.1146, commit `440dab2a`, servizio attivo, firewall ancora al suo posto.
- [x] 11/11 11:10, Riccardo: «dicevo di farlo tu». Reinstallazione lanciata dalla macchina con la stessa funzione del pulsante (script una tantum, poi tolto): contenitori ricreati sulla 26.10.2, utente admin creato. Il gettone no: l'uscita vera di `lnms api:token-create` ha una frase DOPO il gettone e il codice prendeva l'ultima riga. Corretto (si prende la riga `<id>|<lettere e cifre>`), prova aggiornata sull'uscita vera. Sulla 70151 il gettone l'ho creato e salvato cifrato con un secondo script una tantum (stesso comando, `setIntegrationConfig`): riletto uguale, `GET /api/v0/devices` con quel gettone risponde 200 «devices: []». Revocati i due gettoni di prova. **Non provato**: l'aggiunta di un device dalla pagina (la fa Riccardo). La correzione della riga è su `dev`, non su `main`: una nuova installazione su un'altra appliance oggi finirebbe ancora senza gettone.
- [x] Testo di prima: sulla 70151 resta da rifare l'installazione di LibreNMS dalla scheda dell'integrazione («Installa / Reinstalla», oppure «Elimina tutto e ricrea»): quella attuale è senza utente e senza gettone. Poi provare l'aggiunta di un device. La reinstallazione toglie i contenitori e riparte da un database vuoto (oggi non contiene niente).
- [x] 11/11 ~11:30: `main` promosso a `f645c23b` col sì di Riccardo (seconda correzione del gettone di LibreNMS). Cancello sul commit esatto: lint e tipi verdi, 8050 passate, 1 rossa (la solita `discovery-accesso-windows`, dipende dal Mac). Insieme sono andati su `main` i commit «Vista cliente» di un'altra sessione, tutti dentro `src/app/(cliente)`, `src/components/cliente`, `src/lib/cliente`. Arrivo sulle appliance non verificato.
## 2026-11-11 — Le Kyocera dell'ufficio hanno stampato durante le scansioni

Riccardo: «la multifunzione kyocera ha stampato fogli, non so se rimane qualcosa che stampa».
- [x] Causa: la sonda del giro ha scritto sulla 9103 (`jetdirect`) di due Kyocera della rete 192.168.5.x alle 10:03 dell'11/11; il freno fermava solo 515 e 9100-9102. Letto in `servizi_rete` sull'hub.
- [x] Freno su tutta la fascia 9100-9109 (`PORTE_STAMPA_RAW`, usata anche da `PORTE_DA_NON_TOCCARE`), ultimo freno in `sondaPorta`, e sulle stampanti niente sonde sulle porte alte sconosciute (`portaRischiosaSuStampante`). Prove: `freno.test.ts`.
- [ ] Non provato dal vivo: un giro sulla rete delle stampanti dopo l'aggiornamento (lo lancia Riccardo quando vuole, guardando la Kyocera).
- [ ] Resta possibile: una coda di stampa raw su una porta bassa o fra i «pannelli web» (8000-9443) di una stampante non riconosciuta come tale; FTP (21) e IPP (631) ricevono solo banner/GET, che non stampano.
- [x] 11/11 ~12:00, Riccardo: «LibreNMS ha rifiutato l'aggiunta: Could not connect to 172.20.9.210». Misurato sulla 70151 (senza mostrare le community): ping ok dal contenitore; con la community di `hosts.snmp_data` (6 caratteri) timeout da contenitore e da host; con la credenziale validata sull'host (`host_credentials`, credenziale 1 «snmp-base», 10 caratteri) risponde. Le due sono diverse e DA-IPAM passava la prima (`resolveSnmpParams` prima di `campiSnmpHostValidato`). Corretto l'ordine in `librenms-sync.ts`, singola e in blocco; prova nuova in `librenms-aggiunta.test.ts`, 85/85, tipi verdi. Su `dev`. Il firewall non c'entra (contatori degli scarti fermi).
- [ ] Da capire a parte: perché `hosts.snmp_data.community` resta quella vecchia dopo che una credenziale diversa è stata validata (chi la scrive e quando).
- [x] 11/11 ~12:30: `main` promosso a `f3d2a079` (0.9.1156) col sì di Riccardo. Cancello sul commit esatto: lint e tipi verdi, 8067 passate, 1 rossa (la solita `discovery-accesso-windows`). Insieme sono saliti due commit di un'altra sessione, guardati prima: fascia delle porte di stampa raw allargata a 9100-9109 (due Kyocera avevano stampato) e lettura dello storico in Anomalie. Sulla 70151 arrivata e provata: `addSingleHostToLibreNMS` sull'host 172.20.9.210 → `{"ok":true,"librenms_device_id":1,"aggiunto":true}`; in LibreNMS il device c'è, riconosciuto (`procurve`, JL357A 2540-48G-PoE+-4SFP+, stato 1, v2c).

## 2026-11-11 — Topologia: tutti gli attaccati, e il firewall della 72729

Riccardo: «tutti gli oggetti dopo i primi vengono mostrati con + n altri… un'opzione per mostrare tutti quelli in archivio collegati a quell'apparato»; «nella rete 72729 c'è il firewall 192.168.0.50 e non capisco a che porta è collegato».
- [x] Interruttore «Mostra tutti gli attaccati» nella barra della mappa (`attMax` in `layoutTree`, `tuttiGliAttaccati` in `map-compute`). Non visto a schermo. La stampa resta ai primi quattro.
- [x] Firewall 192.168.0.50 della 72729: letto l'11/11 nel DB della sonda (sola lettura, dal Proxmox `72729-pve` via NetBird con `qm guest exec 100`; la sonda rifiuta la chiave in ssh diretto). Mappa porte: switch J9660A (192.168.0.51), porta 1, confidenza «certa», vicino LLDP il FortiGate. Ultima lettura SNMP degli switch: 09/11 (GS1900: 06/11).
- [x] 72729: gli switch non venivano riletti perché `arp_poll` era spento dal 06/11 (sospensione per le celle frigo). Riacceso l'11/11 alle 13:18 UTC col sì di Riccardo («Sì, riaccendi»): `enabled=1` nel DB della sonda e riavvio di `da-ipam`, senza giri in corso; lo scheduler ha caricato 9 job. Primo giro non ancora visto. `known_host_check` resta spento; `fast_scan` era già acceso, non si sa da chi.
- [x] Riccardo (11/11): «il firewall che è un device importante dovrebbe rientrare come i due cisco anche se non parlano, sappiamo dove sono collegati»; «un hypervisor ha la sua dignità e deve essere un oggetto direttamente visibile… che sia una piccola riga o un oggetto può essere un'opzione». Fatto: prova di ruolo `firewall_censito` (solo apparato censito di tipo firewall, `cavi/ruolo.ts`); interruttore «Hypervisor come riquadri» acceso di serie (`hyperBox` in `layoutTree`). Cambia la regola del §13.8.2 («infra solo con una prova», «hyper solo con VM o scansione») per decisione sua. Prove della Topologia verdi (1497); nessuna prova nuova scritta; non visto a schermo.
- [ ] Limite noto: con l'interruttore acceso anche un hypervisor messo «Attaccato» a mano torna riquadro (il layout non distingue la scelta a mano dalla mancanza di prove).
- [x] 11/11 13:35 UTC: `main` promosso a `776d4a3a` (0.9.1187) col sì di Riccardo. Cancello sul commit esatto: lint e tipi verdi, 8131 passate, 1 rossa (la solita `discovery-accesso-windows`, dipende dal Mac). Sulla 72729 arrivata alle 13:43 UTC: versione 0.9.1187, commit `776d4a3a`, servizio attivo.
- [ ] 72729, `arp_poll`: partito alle 13:30 UTC ma interrotto dal riavvio dell'aggiornamento delle 13:43, prima di arrivare agli switch. Due apparati lo tengono fermo 5 minuti ciascuno per tempo scaduto (#36 access point Omada, #44 server HP); il firewall #127 non risponde a SNMP. Da rivedere al giro delle 14:00 UTC; il giro con i tre fermi dura almeno 10 minuti.
- [x] Riccardo (11/11): «come per gli access point e gli apparati definiti come switch, anche se non rispondono in snmp direttamente, rispondono con altre tecnologie» → scelta sua fra due strade: **«Tipo + visto su porta»**. Prova `censito` in `cavi/ruolo.ts`: firewall censito col solo tipo; switch e access point censiti solo se un altro apparato li vede su una porta; mai se il fornitore è un sistema operativo (`fornitoreDiComputer` in `identity.ts`). Misura sui dati veri di prova: col solo tipo +6 (hub) e +5 (cliente A), tutti «switch/windows»; con l'esclusione i conteggi misurati non cambiano. Cambia I28 della spec §13.8.2 per gli apparati censiti. Prova nuova in `ruolo.test.ts`; Topologia 1498 verdi.
- [ ] Spec `2026-10-14-topologia-collegamenti-reali-design.md`: le righe G10 e I28 dicono ancora «il tipo dichiarato non basta» senza l'eccezione dell'11/11. Da allineare.
- [ ] Non visto a schermo, e non su `main`: la 72729 ha il firewall (0.9.1187) ma non la regola per switch e access point.
- [x] 11/11 ~14:10 UTC: `main` promosso a `04e0f10f` (0.9.1190) col sì di Riccardo. Cancello sul commit esatto: lint e tipi verdi, 8142 passate, 1 rossa (la solita `discovery-accesso-windows`). Sulla 72729 arrivata entro le 14:28 UTC: versione 0.9.1190, servizio attivo. `arp_poll` ha chiuso un giro alle 14:22 UTC e il J9660A è stato riletto alle 14:21 (chiude il punto aperto sopra).
- [ ] 72729: nella Mappa porte il firewall è ancora «visto» il 09/11 sulla porta 1 del J9660A anche dopo la rilettura delle 14:21: da ricontrollare dopo il prossimo ricalcolo della mappa (ogni 30 minuti).

## 2026-11-11 — Topologia della 72729: anomalie viste da Riccardo a schermo

Riccardo: riquadro grigio degli AP troppo grande; «il link principale indicato come down da due giorni»; le VM dovrebbero stare sotto l'ESXi; «mancano forse degli altri AP»; utile un'esportazione per draw.io.
- [x] Riquadro degli AP largo quanto gli AP (`tree-layout.ts`, `tree-layout-lr.ts`); lo spazio riservato non cambia. Non visto a schermo.
- [ ] Link «giù da due giorni»: non riprodotto. Dato letto sulla sonda: gli switch non erano stati riletti dal 09/11 (`arp_poll` spento), la soglia «non visto» è 2 giorni; riletti alle 14:21 UTC dell'11/11. Da riguardare a schermo dopo la rilettura. Nota: il J9660A ha quattro porte con lo stesso nome «Link Aggregate» (indici 54-57), una giù: se la scritta resta, il sospetto è lì.
- [ ] VM sotto l'ESXi: sulla 72729 non c'è nessuna VM letta. La Topologia prende le VM solo da `last_proxmox_scan_result` (scansione Proxmox); il vCenter #43 non ha scansione e non c'è una lettura VMware che la riempia. Serve la lettura delle VM da vCenter/ESXi: lavoro a sé, da decidere con Riccardo.
- [ ] Access point: in archivio sono 4 (192.168.0.208, .221, .226, .246) ma solo .226 è un apparato censito; gli altri tre sono host classificati `access_point` senza prove di ruolo, quindi non entrano nella mappa come AP. Da «Topologia › Dati» si promuovono ad apparato; con la regola «censito» dell'11/11 entrano se uno switch li vede su una porta.
- [ ] Esportazione draw.io della mappa: richiesta, non iniziata.

## 2026-11-11 — Cosa arriva a Vulcan, e cosa no (domanda di Riccardo)

Riccardo: «vorrei sapere se inventario, AD, AD health, scansioni Greenbone, nuclei, motori nuovi di Nety e i dati passivi vanno a da-vulcan, perché è un bel report su cosa succede nella rete; e la mappa di draw.io sarebbe bella da presentare».

Letto l'11/11 in `src/lib/vulcan/` e sulla 72729 (sola lettura): l'invio lì è acceso (gettone presente, battito ok alle 14:47 UTC, 9 inventari e 2 AD Health inviati).

- [x] Partono già: inventario giornaliero (20 campi a lista bianca, `CAMPI_OGGETTO`), export AD Health a fine run, battito. Greenbone e nuclei arrivano a Vulcan dallo Scanner-Edge, non da IPAM.
- [ ] Non partono (in Vulcan esistono solo `/api/ipam/{ping,heartbeat,ad-health,inventario}`): Scansioni interne/controlli ripresi da Nety (`servizi_rete`, rilievi), dati passivi del trunk (`rete_rilievi`, `trunk_vicini`), matrice di segmentazione, Topologia e Mappa porte, modifiche AD nel tempo (parte solo la fotografia Health). Serve un tipo d'invio nuovo per ciascuno e la rotta che lo riceve in DA-Vul-can: lavoro su due repo, da pianificare con Riccardo (lista bianca dei campi: niente credenziali né PII).
- [x] Esportazione draw.io della Topologia: pulsante «draw.io» nella barra (`src/lib/topology/drawio.ts`, prova sulla fixture dell'hub). Non aperto in draw.io né visto a schermo. Non porta icone, sedi e riquadri delle VM espanse oltre alle etichette; allegarlo al documento di Vulcan è un passo a parte.
- [x] **Priorità (Riccardo, 11/11: «questa è la prima cosa da inserire, perché vale come greenbone o nuclei»)**: rilievi delle Scansioni interne a Vulcan. IPAM: tipo d'invio `rilievi` (`src/lib/vulcan/corpo-rilievi.ts`, `accodaRilievi` dopo l'inventario, migrazione v2 della coda, «Cosa esce»). Vulcan: `POST /api/ipam/rilievi` sul ramo `claude/ipam-rilievi`. Prove mirate verdi nei due repo; nessun invio vero ancora fatto.
- [x] Pubblicato l'11/11 col sì di Riccardo: Vulcan live 0.8.296 (`c9c3a15a`, snapshot `pre-rilascio-08295-20261111` della VM 664 su DA-PX-03; la 0.8.295 mandava la rotta al login, 307: mancava in `auth.config.ts`, vista dal di fuori e corretta), ora `POST /api/ipam/rilievi` senza gettone dà 401 come l'inventario. IPAM `main` = `936251c0` (0.9.1197), cancello completo verde su quel commit.
- [ ] Controllo sulla 72729 dopo le 03:00 del 12/11 (la fotografia parte con l'inventario della notte): `SELECT tipo, stato, ultimo_errore FROM vulcan_coda WHERE tipo = 'rilievi'` deve dare `inviato`; in Vulcan una riga in `ipam_rilievi_foto` per il cliente.
- [x] Riccardo, 11/11: «il nome di default non esce, deve solo essere detto che le credenziali di default accedono». Verso Vulcan la prova di `login-fabbrica` è sostituita da «Le credenziali di fabbrica danno accesso.» (`PROVA_SENZA_UTENTE`). In IPAM la pagina Findings mostra ancora l'utente: Riccardo ha parlato di ciò che esce. Su `main` dall'11/11 col sì di Riccardo (0.9.1200, `6029dbed`, cancello completo verde): arriva alle appliance prima dell'invio delle 03:00.
- [x] Riccardo, 11/11: per l'area «Servizi interni» di Vulcan «un critico sì basta e anche un alto», ma «non daremo 100% per un solo critico»: il livello resta «Alto» (terzo su quattro), mai «Critico»; così è scritto in Vulcan.
- [ ] Non viaggia lo stato del triage (falso positivo, accettato); i dati passivi del trunk sono il prossimo tipo d'invio.
- [x] Riccardo (11/11): «se ci sono degli hypervisor, di base le vm dovrebbero essere legate all'hypervisor e non allo switch in cui sono viste; si può usare il macaddress… se ci sono più host l'unico modo è la config letta direttamente dentro l'hypervisor». Fatto in `topology/vms.ts` (`vmDalMac`): un solo hypervisor fisico in archivio → gli oggetti con MAC da VM stanno dentro di lui. Prove in `vm-dal-mac.test.ts`; Topologia 1501 verdi; i conteggi misurati di hub e cliente A non cambiano (hanno più hypervisor). Non visto a schermo. Trappola trovata: `nodeAt` fa nascere un nodo per ogni host che gli si chiede, quindi chi scorre tutti i MAC deve prima decidere senza chiamarlo.
- [x] Sulla 72729 la regola non scattava: gli hypervisor fisici in archivio erano due, `esxi01` (192.168.0.6) e 192.168.0.225. Riccardo (11/11): «è la nostra sonda, classificalo come PC» (è il Proxmox `72729-pve` che ospita la sonda). Fatto nel DB della sonda: host 102 a `workstation`, `classification_manual = 1`. Resta un solo hypervisor in archivio.
- [ ] 72729: le nove VM andranno sotto `esxi01` solo quando la sonda avrà la 0.9.1198 (è su `dev`, non su `main`). Da guardare a schermo dopo la promozione.
- [ ] Limite della regola: non confronta la famiglia del MAC con quella dell'hypervisor. Una VM Proxmox (MAC `BC:24:11`) in una rete con un solo ESXi finirebbe sotto l'ESXi. Alla 72729 oggi non ce ne sono fra gli host.
- [x] Riccardo (11/11): «export in draw.io è quasi illeggibile, le righe non rimangono separate» → linee dell'albero coi punti fissi di `stepPoints`, agganci fissi, scritta sul braccio del figlio, attaccati figli del riquadro e senza linee (`topology/drawio.ts`). Prova estesa. **Non aperto in draw.io**: il primo sguardo è di Riccardo.
- [x] Riccardo (11/11): «la preparazione della stampa è quasi impossibile rispetto al video» → scala «Un foglio» (`scala=foglio`, `PrintScale` 0 in `print-tiles.ts`). Prova nuova. Interpretazione mia della frase: il difetto era la mappa tagliata a tasselli; se intendeva altro (leggibilità delle scritte, legenda), va chiesto. Non visto reso.
- [x] 11/11 ~15:30 UTC: `main` promosso a `77190a37` (0.9.1199) col sì di Riccardo. **Errore mio**: il cancello completo era girato su `c29bf679` (0.9.1198: lint e tipi verdi, 8168 passate, 1 rossa, la solita `discovery-accesso-windows`), ma nel frattempo un'altra sessione nella stessa cartella aveva aggiunto `a66698ac` (draw.io con le linee separate, stampa su «Un foglio») e ho promosso la punta senza ricontrollare l'identificativo. Verificato subito dopo sul commit promosso: tipi verdi, lint dei quattro file toccati verde, Topologia 1503 verdi. Regola per la prossima volta: si promuove l'identificativo scritto nel log del cancello, non `HEAD`; e una cartella condivisa con un'altra sessione non è il posto da cui promuovere.
- [x] Sulla 72729 arrivata alle 15:43 UTC: 0.9.1199, servizio attivo. In archivio un solo hypervisor fisico (`esxi01`, apparato 157); il vCenter (apparato 43) è unito al suo host con MAC `00:0C:29`, quindi conta come VM. Le condizioni della regola ci sono; **la mappa non è stata vista a schermo**.
- [x] 11/11 ~16:00 UTC: cancello completo girato dopo, sul commit esatto già promosso `77190a37` (prima riga del log): lint e tipi verdi, 8169 passate, 0 rosse. Chiude il buco della promozione qui sopra. Stampa «Un foglio» vista resa sull'hub: mappa di Domarc su un A3 verticale al 73 %. Visto nella stessa resa, c'era già: sotto SW-CED-237 la capsula «segmento» è disegnata sopra il riquadro di uno switch figlio.
- [x] Riccardo (11/11): «spostando anche solo un oggetto si spostano troppi altri oggetti e diventa impossibile organizzare la mappa… il riquadro grigio degli AP è inamovibile». Fatto: `dragTweaks(…, soloOggetto)` fissa i figli al punto in cui sono (la disposizione continua a spostare il ramo, quindi le mappe salvate non cambiano); Maiusc + trascina = ramo intero; il riquadro degli AP si trascina e il suo ritocco sta sull'id del primo AP (la rotta accetta solo oggetti veri). Cambia la regola della spec §4/§11.2 («il nodo si porta dietro il suo ramo») per decisione sua. Prove nuove in `tree-layout-lr.test.ts`, Topologia 1504 verdi. **Non provato a schermo**: durante il trascinamento del riquadro grigio gli AP dentro restano fermi e saltano al rilascio.
- [x] Riccardo (11/11, schermata del draw.io dell'hub): «difficilmente gestibile con tutti i link che si sovrappongono; se sono link secondari cambia colore oppure troviamo un sistema» → ridondanze su un livello a parte «Ridondanze» (nascosto di base, visibile se «Mostra ridondanze» è acceso), sottili, grigio chiaro, a puntini, parole nel tooltip; testo dei riquadri su due righe. Prova estesa. Non aperto in draw.io.
- [ ] Visto nella stessa schermata e non toccato: la capsula «segmento» sopra un riquadro figlio (difetto della disposizione, c'è anche in stampa) e gli attaccati che in draw.io si sovrappongono al riquadro sotto quando sono molti.


## 2026-11-11 — A Vulcan anche i dati passivi e le porte esposte, a livello statistico

Riccardo: «i dati passivi del trunk hanno un significato perché mostrano la lettura passiva dei servizi, almeno a livello statistico andrebbero inviati con una valutazione di rischio da definire»; «Mappa porte: anche questa importante a livello statistico per mostrare quanto è visibile nella rete, da definire il rischio in base alle porte esposte e alla loro quantità».

Misura sulla 72729 dell'11/11 (sola lettura): rilievi del trunk aperti 52 (35 `nomi_insicuri` medi, 11 `non_in_inventario`, 4 `vicino_esposto`, 2 `ip_conteso`), 4 vicini CDP/LLDP, 1 VLAN con server DHCP; 99 sistemi con 424 porte aperte (58 con 1-4, 35 con 5-9, 6 con 10-19; 21/tcp su 17, 5900/tcp su 13, 445/tcp su 27).

- [x] Riccardo, 11/11: «Sì, parti» sulle regole proposte. IPAM: `rete_passiva` nella fotografia dei rilievi (`leggiRetePassiva`, niente tipo d'invio nuovo). Vulcan (ramo `claude/ipam-rilievi`): aree «Rete in ascolto» e «Superficie esposta», sezioni nel Word. Pubblicato l'11/11 col sì di Riccardo: Vulcan live 0.8.299 (`258a9c19`, snapshot `pre-rilascio-08299-20261111`, VM 664 su DA-PX-03, cancello verde), poi IPAM `main` = `0adc1331` (0.9.1203). Cancello di IPAM: 8172 verdi, 1 rossa = `discovery-accesso-windows` («database connection is not open», sottoprove diverse a ogni giro, area non toccata dal cancello verde della 0.9.1200): l'instabile nota del Mac, accettata. Da controllare dopo le 03:00 del 12/11 che la fotografia della 72729 arrivi con `rete_passiva`. Proposta di partenza: (a) dati passivi = tipo d'invio nuovo coi soli conteggi, area «Rete in ascolto»; (b) porte esposte = nessun invio nuovo, si calcolano in Vulcan dalle `porte[]` dell'inventario che già arriva, area «Superficie esposta». Regole di rischio proposte nella risposta, da confermare.
- [ ] Da chiarire: per «Mappa porte» Riccardo descrive le porte esposte dei servizi; la pagina Mappa porte di IPAM è quella delle porte degli switch.

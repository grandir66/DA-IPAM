# TASKS — DA-IPAM

## 2026-11-05 — Base scansioni: decisioni di Riccardo e template fermi

Piano: `docs/superpowers/plans/2026-11-05-base-scansioni.md` in DA-Vul-can, bozza da approvare.

- [x] Riccardo (05/11): PHP2Shell è proprio quella (CVE-2026-109618 e CVE-2026-109619), sfruttata attivamente
- [x] Riccardo (05/11): credenziali salvate si usano; se mancano si provano le deboli
- [x] Riccardo (05/11): `public` e `private` si inseriscono di default
- [x] Riccardo (05/11): dopo la prima scansione di una rete, le credenziali non funzionanti si disabilitano; inutile riprovarle sugli stessi device
- [ ] Trovato il 05/11: i template nuclei di Vulcan, 533 e DTS sono del 27/05/2026. Il pacchetto si costruisce solo a mano e la sincronia dice «a posto». PHP2Shell oggi non si rileva con nuclei
- [ ] Attenzione: il template pubblico CVE-2026-109618 forza l'esaurimento di memoria e fa cadere i processi PHP. Va escluso PRIMA di aggiornare il pacchetto

## 2026-11-05 — Base richiesta per le scansioni (Riccardo)

Riccardo (05/11), dopo il changelog del giorno. Sei parti; vale per DA-IPAM e per Edge in DA-Vul-can, la stessa voce sta nei due `TASKS.md`. Piano ancora da scrivere.

1. **Gestione delle scansioni.** Tre modi: immediata, schedulata, a finestra. Immediate e schedulate escono verso IPAM e Vulcan appena finite; quelle a finestra quando è impostato. Ripartenze con lo stato di quanto fatto, per recuperare le scansioni parziali. Pagina dedicata che parte dalla scansione e sceglie le reti, non il contrario.
2. **Motori.** nmap con più profili che producono indicazioni per assegnare i device e riconoscere OS e tutto il possibile. SNMP con le community di default sempre presenti. nuclei con profili efficaci e controlli per altri parametri.
3. **Invii** efficaci verso IPAM e Vulcan.
4. **Identificazione:** la via migliore per identificare i device e le loro vulnerabilità intrecciando i dati.
5. **Credenziali note:** usare l'archivio delle credenziali note degli apparati per verificare la configurazione troppo fragile, via ssh, snmp, http, api.
6. **Motori specifici (NUOVO):** verifica di vulnerabilità gravi, «ad esempio php2shell».

- [ ] Da chiarire con Riccardo: cosa intende con «php2shell» e cosa vuol dire il punto 5
- [ ] Scrivere il piano, una tappa per punto

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
- [ ] **A3. Classi del 72729 da ricalcolare** (1087 riaperta in forma nuova). Il ricalcolo del 04/11 16:10 ha messo in `iot` 30 host, fra cui 11 Weintek e 10 CREVIS. Dopo è arrivata la radice `ot`: il codice ora dà `hmi` e `plc`, ma quei host cambiano solo con un ricalcolo o una scansione con porte (non misurato se sia già successo). Comando già provato: `scripts/attribution-recompute-cli.ts`. S. **Decide Riccardo**: scrive sul cliente, snapshot della VM 100 prima.
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

- [ ] **C1. Infoblox**, due passi distinti.
  - **Portare il collector su `dev`**: `origin/codex/infoblox`, 6 commit, conflitti solo in CHANGELOG, TASKS e versione. Raccolta collaudata (6.853 record in 37 s), resta da CLI, nessun effetto sui dati. Il documento di consegna dice che il ramo non è su origin: ora c'è. S. **Decide Riccardo**.
  - **Far entrare i dati in DA-IPAM**: è questo il blocco vero. Mai progettato. `networks.cidr` è UNIQUE e due viste possono avere lo stesso CIDR; `dhcp_leases` vuole il MAC e il CHECK di `source_type` non ammette `infoblox`; DNS senza una destinazione. L, livello Completo, sequenza in `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`. **Decide Riccardo** se serve e per quale cliente.
- [ ] **C2. Rilievi sommati per host** (17, 18; lato DA-Vul-can 16). Il rilievo di un host si sostituisce solo con quelli nuovi di quell'host; il giorno per giorno copre tutta la subnet. Il primo pezzo c'è (`vuln_findings_attuali`). M qui, più DA-Vul-can. Richiesta di Riccardo già fatta, va messa in ordine con Edge.
- [ ] **C3. Proxmox** (1035, 1043). `proxmox-ve` è fuori dal pulsante e lì resta (`riconosci.ts`). Mancano: modello, seriale e produttore dei nodi (vuoti nel collaudo su 4 nodi; codice scritto, mai riprovato), IP dei guest su 24 di 52, schede di rete non proiettate, `sockets` fisso a 1. La scansione di oggi dà già tutto, quindi agganciarlo non aggiunge dati. Proposta: resta fuori. M per la parità. **Decide Riccardo**.
- [ ] **C4. SSH Ubiquiti** (995). Fermo dal 22/10 su autenticazione rifiutata, nessun tentativo in più. SNMP e controller UniFi danno già i dati e il 23/10 si è deciso che Ubiquiti resta in SNMP; l'SSH aggiungerebbe poco (`mca-status`). Proposta: chiudere. In alternativa serve la credenziale dei device dal controller. S. **Decide Riccardo**.
- [ ] **C5. LibreNMS** (602, 608, 610, 613, 615). I dati sull'hub arrivano (52 apparati, 1094 porte), ma: vicini nella mappa non fatti, `librenms_vicino` non è letta dalla topologia (M, zona rossa); nessun ADR; limiti di avviso non letti; 5 server mai interrogati da provare; prove T1 e T5. Dimensione totale M.
- [ ] **C6. Collaudi dei collector** (805, 808, 812, 830, 831, 845, 852, 996, 1034, 719, 721, 663): prove in locale su apparati veri, tutte «in attesa di Riccardo» dal 21-22/10, molte ormai implicite nell'uso su 70151. M. Da leggere una volta sola, tenendo solo quelle che non sono già state esercitate.
- [ ] **C7. Decisioni rimaste sui collector** (817, 821, 853): ritirare `src/lib/devices/acquisition/`? Togliere «(anteprima)» dall'interruttore? S. **Decide Riccardo**.
- [ ] **C8. Controller UniFi** (516): strumento da CLI, fotografia per apparato, o radio e client. M. **Decide Riccardo**.
- [ ] **C9. Detect, assi 2 e 3** (1088). L'asse 2 è in parte coperto da `http-title` e `http-headers`. Asse 3: password di default negli apparati dei clienti, da far decidere anche rispetto a DA-Vul-can. M. **Decide Riccardo**.
- [ ] **C10. Rinviati per famiglia** (897, 912, 929, 945, 960, 997): QNAP, HP, Comware, VMware, NetApp, estensioni. Restano rinviati, nessuno ha chiesto di farli. VMware e NetApp possono toccare la sessione «Deploy soluzione su vSphere 8».
- [ ] **C11. Occhiate e cose minori di Riccardo** (308, 539, 555, 638, 402, 659, 79): scheda Istanza da superadmin, tab VLAN su 70151, pastiglia «spenta», NB-AGUZZOLI n. 31, cluster iLO, rilievo grezzo. S.
- [ ] **C12. Bacheca dei piani**: `recupero-dadude3-mknet` dice 3 su 9 e aspetta una sessione cloud, ma il ramo è già in `dev`; `daipam-cve-locali` è fermo a 2 su 6 dal 07/09 e i feed exploit fatti il 22/10 ne coprono una parte. S per riallineare. **Decide Riccardo** se il secondo serve ancora.
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
- [ ] Da confermare al via: la radice nuova di livello 1 `ot` (foglie `plc`, `hmi`, `drive`, `rtu`, `io_remoto`, `gateway`) invece di `iot.plc`/`iot.hmi`. «Distinti da IoT» non diceva dove
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
- [ ] Resta da fare: mostrare i rilievi nella scheda dell'apparato (oggi stanno in `host_profilo_rilievi` e riempiono i campi vuoti, ma non c'è una tab che li faccia vedere)
- [ ] Ordine scelto: prima il profilo **Approfondito** (nessun rischio, rende su ogni cliente, collauda il parser), poi **IoT/OT**, che è quello che manda pacchetti ai PLC
- [ ] Da verificare sulle appliance dei clienti, non solo sull'hub: se il processo ha i privilegi per `-O` e `-sU`. Senza, il profilo deve degradare e dirlo, non fallire muto
- [ ] `--version-intensity` si alza solo con la misura del tempo prima e dopo su una rete vera (passo S5). Se costa troppo resta a 0 e si scrive
- [ ] Chiude l'«asse 2 (GET della pagina web)» rimasto aperto nella sezione delle stampanti: lo coprono `http-title`/`http-headers` del profilo Approfondito
- [ ] `rdp-ntlm-info` dà nome DNS, nome NetBIOS, dominio e build di Windows **senza credenziali**: tocca anche il filo WMI/WinRM aperto oggi, dove 12 PC su 13 rifiutano l'account

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
- [ ] Da decidere con Riccardo: PLC e HMI distinti da IoT nella classificazione (nuove foglie della tassonomia e prove da rivedere)
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
- [ ] Riccardo (04/11): «potrebbero esserci tante macchine windows che rispondono wmi con account di dominio». Piano: [`docs/superpowers/plans/2026-11-04-wmi-nella-scansione.md`](docs/superpowers/plans/2026-11-04-wmi-nella-scansione.md), bozza con livello completo proposto; primo passo la misura sui PC del 72729. Va in appliance solo con rilascio su `main`
- [x] Misura sul 72729 (Riccardo: «Sì, prova i PC»): 13 PC con 135 aperta e senza WinRM, 12 rifiutano l'account readonly, 1 (192.168.0.207) non risponde sulla 135, 0 accettano. L'account dedicato dell'IT del cliente serve per il collaudo finale
- [ ] Riccardo (04/11): «dobbiamo gestire il sistema per testare sia winrm che wmi in automatico senza bloccarsi, non tanto per questo utente ma in generale». E: deve essere chiara la definizione dei diritti dell'utente necessari per le scansioni; nell'applicativo deve essere chiaro cosa abilitare per l'utente e cosa abilitare per la sicurezza del dominio. Piano riscritto in forma generale, 11 passi, stesso file: motore WinRM+WMI, catalogo unico dei diritti, controllo dell'account. Bozza da approvare, tavola degli oggetti proposta il 04/11
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
- [ ] decidere dove gira OpenBao: Riccardo pensa a DA-Link o a DA-Auth (oggi sulla .42); valutazione Claude 23/10: no alla .42, sì alla VM di DA-Link o a una VM piccola dedicata
- [x] punto d'innesto nel codice (fatto il 23/10, ADR 0034: la chiave degli slot sta dentro `encrypt()` di `crypto.ts`, il riferimento OpenBao dentro il lettore unico): `src/lib/credentials/segreti.ts` (lettore unico dei segreti), più gli altri `encrypt()` fuori da `credentials/` (integrazioni, vuln edge, inventory-agent, network-services)
- [ ] rimando a DA-Link/TASKS.md (stessa data) per la parte vault interno
- [ ] Riccardo (23/10): valutare Keeper (già in uso, tenant keepersecurity.eu) sia per il vault personale dei file «accessi» sul Mac sia per la soluzione. Analisi Claude 23/10: Keeper (cartelle condivise + Secrets Manager, un'applicazione KSM per app) al posto di OpenBao per Domarc; dai clienti resta l'archivio locale con slot age. Da verificare: licenza (KSM, SSO Entra, KeeperPAM inclusi?), prezzo per chiamate API
- [ ] licenza letta nella console il 23/10: **Keeper Business**, 18 licenze, scade 20/06/2027, 100 GB; niente SSO (serve Enterprise, listino 5,50 €/utente/mese), niente ARAM, compliance, BreachWatch. **KSM richiede KeeperPAM, 90 €/utente/mese**: chiedere a Keeper il preventivo per 2-3 utenti PAM prima di decidere KSM vs OpenBao per le app. Persone e vault personale: Business basta
- [x] **Decisione di Riccardo (23/10)**: Keeper Business solo per le persone e il vault personale (Commander per gli agenti); per le app **OpenBao** (open source, self-hosted): KSM troppo costoso e il prodotto è pensato per essere open source. Dai clienti archivio locale con slot age. Il vault personale si fa per primo (piano in ~/.claude)
- [x] piano riscritto (23/10, sessione da-vault): `docs/superpowers/plans/2026-10-23-da-vault.md` — regola della fonte (se una macchina la usa sta in OpenBao, altrimenti Keeper; in Keeper solo puntatori), 12 passi, livello completo, ~5-6 settimane
- [x] Riccardo (23/10): D1 OpenBao in container nella VM di DA-Link, niente VM nuova; D2 nel DA-IPAM dei clienti entrano tecnici e cliente; D3 per ora senza YubiKey (chiave age in Keeper, cartella personale); D4 `fc5171b` in esercizio ora, in OpenBao al passo 9 — piano aggiornato
- [x] Riccardo (23/10): D5 slot Domarc acceso di serie con una riga nel contratto (chi non lo vuole lo spegne firmando); **piano approvato, livello completo**
- [x] clausola sullo slot Domarc approvata da Riccardo il 23/10 (testo nel piano, sezione Decisioni)
- [x] esecuzione, parte di codice (sessione cloud del 23/10, prompt `~/.claude/prompts/da-vault-esecuzione-1.md`): passi 5, 6 e 10 sul ramo `claude/da-vault-codice`, PR verso `dev` (dettaglio sotto)
- [ ] analisi Claude 23/10 (da approvare): separare la «chiave» di ogni app (da TPM/OpenBao, mai in `.env.local`) dalle «credenziali condivise» dei device (OpenBao KV, solo riferimenti nelle app); dai clienti archivio locale cifrato con slot age e KDBX solo come esportazione, non come archivio vivo; login tecnici con OIDC nativo di OpenBao (DA-Auth non si tocca)

Esecuzione, parte di codice (23/10, sessione cloud, ramo `claude/da-vault-codice`, livello completo; interruttori spenti):
- [x] passo 5, `src/lib/vault/`: `SecretStore` (tipi.ts), archivio a slot age (archivio.ts: cliente scrypt, Domarc X25519, TPM da `$CREDENTIALS_DIRECTORY/vault-key`), backend `locale` e `openbao` (solo fetch, AppRole, token 20 min, cache a tempo della cartella dell'app, `X-Domarc-Utente`, errore dichiarato oltre la cache), OpenBao finto per le prove — archivio 23, openbao 22, locale 6
- [x] passo 10: chiave degli slot dentro `encrypt()`/`decrypt()`, 2FA sulla chiave d'installazione (ADR 0034), ricifra (a vuoto di serie, `--applica`, tutto o niente, lettore unico, VACUUM, crash con SIGKILL), «Vault bloccato» (banner, job in pausa), «Mostra password» (2FA, 5 min, admin, registro e pagina), «Esporta in KeePass» (kdbxweb + Argon2id di hash-wasm, key file nel suo slot), `scripts/da-vault-recover.ts`, `scripts/da-vault.ts`, archivio nel backup notturno
- [x] passo 6: `credentials.credential_ref`, doppia lettura in `segreti.ts`, OpenBao dall'ambiente all'avvio, `scripts/da-vault-migra-openbao.ts` (a vuoto di serie, `--applica`, `--verifica`)
- [ ] **in locale** (non fattibile dal cloud): container OpenBao nella VM di DA-Link (passo 1), app «Domarc Vault» in Entra, chiave Domarc age generata scollegata e messa in Keeper (passo 0), AppRole `da-ipam` dell'hub con `secret_id` in `LoadCredentialEncrypted`, CA in `NODE_EXTRA_CA_CERTS`
- [ ] **in locale**: migrazione sui dati veri dell'hub (`--applica`, `--verifica`, poi `DA_VAULT_OPENBAO=1`); campione SNMP/SSH/API provato
- [ ] **in locale**: appliance una alla volta, con la conferma di Riccardo per ciascuna: `crea` → `slot-tpm` (VM modello con `tpmstate0`) → unità con `LoadCredentialEncrypted=vault-key:…` → `DA_VAULT_LOCALE=1` e riavvio → `ricifra` a vuoto → `--applica`
- [ ] **in locale**: un'esportazione aperta con KeePassXC senza DA-IPAM (la prova usa kdbxweb)
- [ ] (scoperto) prima di svuotare le colonne cifrate sull'hub (versione dopo la doppia lettura): portare sul lettore unico le letture dirette (`credentials/trova.ts`, `apparato-archivio.ts`, `integrations/self-identity.ts`, `controllers/credenziale.ts`, `for_edit` di `/api/credentials/[id]`), poi svuota + VACUUM
- [ ] (scoperto) l'interfaccia `SecretStore` è ricavata dal piano: il documento originale (`~/Downloads/da-vault — Piano di implementazione.md`) non era nel repo; confrontarla
- [ ] (scoperto) «parte un avviso» quando il vault resta bloccato: oggi log CRITICAL + banner + Opzioni; manca un avviso nelle notifiche (email/webhook)
- [ ] (scoperto) cambio di generazione della chiave Domarc: oggi `da-vault-recover rotate` a mano; la riscrittura dello slot al primo sblocco (piano, «Più avanti») non è fatta
- [ ] (scoperto) `kdbxweb` porta `@xmldom/xmldom` 0.7 con avvisi alti: forzato a 0.8.15 con `overrides` in package.json; da ricontrollare a ogni aggiornamento di kdbxweb
- [ ] (scoperto) `ENCRYPTION_KEY` resta sull'appliance per i segreti TOTP (ADR 0034): toglierla vuole un'altra soluzione per la 2FA
- [x] (24/10, sessione locale) PR #18 fusa (`17dddc68`) e rilasciata **v0.9.897**; PR #19 (ricarica della cache per un segreto mancante, secret_id illeggibile = errore controllato) **v0.9.898**
- [x] (24/10) passo 6 sull'hub in esercizio: AppRole `app-da-ipam` (IP NetBird dell'hub), `.env.local` con `DA_VAULT_OPENBAO*`, backup in `data/backups/*-pre-da-vault-openbao-20261023-223753.db`, 17 credenziali migrate, `--verifica` 0 diverse, `DA_VAULT_OPENBAO=1`; SNMP, SSH, AD, UniFi ok dopo l'accensione. Dettaglio: DA-Link `TASKS.md` (parte locale)
- [ ] (24/10) passo 10 su un'appliance di prova: serve l'accesso alle appliance del laboratorio e la VM modello con `tpmstate0` (Deploy-Appliance); passo 11 dai clienti con la loro passphrase
- [ ] (24/10) **`vault.domarc.it` non è nel DNS**: sull'hub è in `/etc/hosts` (backup `/etc/hosts.bak-*`), da togliere quando c'è il record (Riccardo)


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

- [ ] VLAN degli switch HP Comware: non sempre vengono rilevate tutte le VLAN.
- [ ] VLAN degli switch HP Comware: le porte taggate (trunk) non vengono riconosciute.
- [ ] Schermata VLAN: con troppe VLAN la tabella taglia le colonne più a destra (manca lo scorrimento orizzontale o l'adattamento).
- [ ] Scansione switch: per default si abilita solo SNMP anche quando SSH risponde. Da decidere se è voluto (un protocollo basta) o se servono entrambi (es. SSH per VLAN/trunk dove SNMP è parziale, vedi Comware).
- [ ] LibreNMS: aggiunta in batch di più oggetti, invece di uno alla volta dalla pagina Discovery.
- [ ] LibreNMS: se l'integrazione è presente (configurata), gli oggetti che rispondono a SNMP si aggiungono in automatico. Da definire: quando (a fine scansione?), come si escludono, cosa si vede a schermo dell'esito.

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
- [ ] **«Esci» non chiude davvero la sessione** (trovato il 23/10, c'era già prima): le richieste della dashboard partite prima dell'uscita
  tornano dopo e rimettono il cookie, perché il proxy rinnova il JWT a ogni risposta (traccia: signout `Max-Age=0` a +495 ms,
  `/api/status/*` rimettono `authjs.session-token` a +525 ms, `/` riapre la sessione). Zona rossa (accesso): proposta a Riccardo, in attesa dell'ok.
- [ ] guardarla sull'hub dopo l'aggiornamento

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
- [ ] storico delle osservazioni utente↔host (WinRM, GLPI, Wazuh 60106, eventi 4624/4768 dei DC) e «utente prevalente» per PC
- [ ] `ad-client`: leggere anche givenName, sn, mobile, company, manager, employeeID, office; computer: managedBy
- [ ] `asset_assignees`: legame con l'utente AD (guid), reparto, ruolo, origine; «Importa da AD» con proposta
      (abilitato, nome e cognome, mail, accesso recente, niente account di servizio) e conferma a spunte
- [ ] proposta di assegnatario sull'asset dall'utente prevalente, mai sopra un'assegnazione manuale; utente AD
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
- [ ] (aperto) nessun «Accetta» provato col clic sull'hub (prova-claude è in sola lettura): lo prova Riccardo; la scrittura è coperta dalle prove
- [ ] (aperto) nell'AD di domarc.it il campo «Reparto» contiene il ruolo: dato loro, non un errore

Pagina «Abbinamenti» (Riccardo, 23/10, decisioni alle domande; livello leggero, tavola da approvare prima del codice):
- [x] tavola grafica sullo stesso canvas della prima (tavola 4, approvata il 23/10)
- [x] Inventario › **Abbinamenti**, voce nuova accanto ad Assegnatari, con rimando «N PC da abbinare» dalla pagina Assegnatari (v0.9.895, visto sull'hub a 1440)
- [x] **tutti gli host con accessi**, anche quelli non ancora in inventario
- [x] conferma **tutto in un clic**, a spunte: crea l'assegnatario da AD se manca, crea l'asset se manca, assegna (prove; non eseguita sull'hub)
- [x] asset già assegnati a un altro: sezione «Da rivedere», **senza spunta**; si sostituisce solo spuntando a mano
- [x] prima conferma vera sull'hub fatta da Riccardo (23/10, 16:25): 11 abbinamenti, 6 asset creati, diario a posto
- [ ] Abbinamenti, asset con lo stesso nome (Riccardo, 23/10: «sì, ma un utente può avere asset multipli»): se esiste già un
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
- [ ] Tavola grafica di Opzioni allargata e Schedulazioni, approvata da Riccardo — pubblicata il 22/10 sera
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
- [ ] Collector modulari: il giro 7 (riga in Opzioni per l'acquisizione con i collector, Proxmox agganciato al pulsante) è su `origin/collector-modulari` ma **non in `dev`**: 5 commit da unire, `dev` intanto è andato avanti di 4 (v0.9.877-878). Poi le due prove sull'hub scritte nella sezione «giro 7».
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
- [ ] MikroTik CORE1/CORE2 (6 switch SNMP) senza VLAN: RouterOS non espone Q-BRIDGE via SNMP; servono SSH (`/interface bridge vlan`) o il collector
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
  - [ ] Riccardo apre `/settings/opzioni` su 70151
  - [ ] Promote dev → main (chiedere a Riccardo)
  - [ ] Hub: guardare i job di serie nati al suo prossimo aggiornamento (oggi fermo a 0.9.872)
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
- [ ] T10 accensione sull'hub, ADR, documenti

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
- [ ] (a) job `arp_poll` sull'hub: il job `apparati_scelti` #25 (22/10) legge già ogni 4 ore router e switch scelti; da chiudere se Riccardo conferma che basta (decide lui)
- [ ] (b) cluster 10 e 11 (iLO HPE + schede di rete dello stesso server?) da confermare con Riccardo
- [x] (c) SW-UFLEX-RG-10GB (apparato 9) non risponde a SNMP (TEMPO_SCADUTO): community, ACL o SNMP spento sullo switch → Riccardo 22/10: non è più attivo; apparato 9 disattivato (enabled=0, non cancellato).
- [x] (d) T13 completamento dal controller UniFi (ok di Riccardo 22/10): lista bianca + `GET rest/networkconf`, native in `switch_vlan_nativa` dalla sync UniFi (solo con `switch_vlan` accesa); ProMax 14 porte completate, resta «dedotta» (18 porte senza nativa dal controller); prove `unifi-vlan-native`, `vlan-switch`, `unifi-api`; resa a 1440 vista sulla copia
- [ ] (e) il blocco «un IP, un apparato» va aggiunto anche in `unifi-sync` prima di accenderlo (oggi spento)
- [ ] (f) le migrazioni sulla copia del cliente A (MikroTik v1-v3, cluster, `switch_vlan`) non sono mai state misurate: la copia non era disponibile
- [ ] ProMax: PVID SNMP diverso dalla nativa del controller su 6 porte su 14 confrontabili, e l'SNMP non dà le porte 33-52 (sugli altri 4 switch 99/99 uguali): la lettura Q-BRIDGE della ProMax (bit «inversi», ifIndex) è da rivedere — Riccardo 22/10: forse porte aggregate (LAG); da verificare con la lettura dei LAG.
- [ ] Native del controller senza scadenza: se uno switch esce dal controller o la lettura `switch_vlan` si spegne e riaccende, le righe di `switch_vlan_nativa` restano (l'età si vede da `nativa_letta_il` nella riga delle fonti); da decidere se farle scadere
- [ ] Sull'hub la nativa si scrive al primo giro di `unifi_sync` #22 (03:00) dopo il rilascio: verificare `switch_vlan_nativa` il giorno dopo
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
- [ ] Fuori piano, da seguire: A-Link (`tipo:"ipam"`, chiavi in `oggetto.env`, policy P9 con conferma), A3 sull'hub (rotta inventario, nessun piano su origin al 22/10), nome `da-vulcan.domarc.it` fissato sull'appliance

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
- [ ] Aperti dopo il piano:
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
- [ ] Coordinare col piano DADude3/MKNET: B2 (porte HP/MikroTik), B4 (Hyper-V, Windows, Linux), B5 (archivio configurazioni) riempiono i riquadri «dato da raccogliere» della tavola.

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
- [ ] Aperta: «ArubaOS» della sede nuova è ArubaOS-Switch o AOS-CX? Si vede al collaudo (`sysDescr`).
- [ ] Sessione cloud su `collector-modulari`: merge di `origin/dev`, poi S1 → S2 → C0 → C1 → C2 → C3 (S3 dopo il commit delle tappe 3-5).
- [ ] In locale (Riccardo): misure sul DB dell'hub, collaudo HP nella sede nuova, unione in `dev`.
- [ ] S3 (MAC virtuali) aspetta il commit della sessione delle tappe 3-5, che modifica `topology/identity.ts`.
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
- [ ] (a), nota: `POST /api/networks/bulk-scan-devices` (ARP dei router dalla pagina Reti) scrive ancora con `upsertSwitchPorts`: non è un giro pianificato, lasciato com'è. Da decidere se allinearlo.
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
- [ ] 7b. Riccardo (21/10): strada A, i documenti di DA-Vul-can mostrano il CIDR vero (`edge_scan_cidr`), lo storico non si tocca. Passata alla sessione DA-VULCAN 21-10.
- [x] 8. Valutazione scritta: `docs/proposte/2026-10-21-dati-ad-verso-vulcan.md`. L'export `domarc-ad-health` esiste già in DA-IPAM, manca il lettore in DA-Vul-can; il ramo `feat/ad-health-ingest` non esiste in nessuno dei due repo. Consiglio: prima caricamento a mano + lettore, poi consegna via edge.
- [ ] 8b. Riccardo (21/10): **invio diretto da DA-IPAM all'hub, come fa la sonda edge**, più un **report dell'inventario degli oggetti rilevati** per un'analisi completa. DA-Vul-can sta già facendo un'integrazione in una sessione separata: chiesto a DA-VULCAN 21-10 il contratto (endpoint, autenticazione, formato). Risposta: lo scrive lei in DA-Vul-can `docs/superpowers/specs/2026-10-21-ad-sicurezza-e-documento-direzione-design.md`, sezione «Contratto per DA-IPAM»; **niente codice in DA-IPAM finché Riccardo non approva la specifica** (DA-VULCAN manda percorso e commit).
- [x] 5e. Eseguito il 21/10 con un agente per task: T1-T5 + correzioni della revisione finale + tendina «SNMP aggiuntivo» (persa in T4, ritrovata da una prova). v0.9.815-820 su dev; hub aggiornato alla v0.9.820 (16:27), conversione `classificazioni_v21` fatta (47 host, 13 apparati). Visto a schermo a 1440 su copia del DB dell'hub.
- [x] 5f. DTS: segno `classificazioni_v21` done (29 host, 2 apparati), alla v0.9.819 alle 16:11, la 820 arriva col timer.
- [x] 9. Export AD (`lib/ad/health/export.ts`), chiesto da DA-VULCAN: (a) `diagnostic: true` esplicito nel raw_json dei diagnostici; (b) DA-A-DomainScore con gravità e CVSS allineati. Collaudo sull'hub DA-Vul-can (21/10, esecuzione 9): (b) verificata, Critical/CVSS 10; (a) non visibile, perché l'esecuzione non ha diagnostici (la copre la prova). File di collaudo cancellato.
- [ ] 10. Invio diretto AD + inventario all'hub DA-Vul-can: il contratto delle rotte `/api/ipam/*` arriva dopo l'approvazione del piano A2 di DA-Vul-can (Riccardo). Fino ad allora niente codice qui.

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
- [ ] Giro 5: Proxmox fuori dal pulsante e collector esteso fino alla parità con la scansione di oggi; VLAN MikroTik configurata+attiva; dai collaudi: stderr/banner SSH mai nei campi (nome host Synology), identità QNAP via SNMP dagli OID enterprise, ripiego senza `ip -j` sui NAS vecchi; Linux: comando fallito ≠ trasporto guasto, il lotto continua; MikroTik: velocità/duplex dalle bandiere e dal monitor, PoE assente = non presente; poi aggancio di Windows e Linux dopo i loro collaudi.
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
- [ ] Acquisire la credenziale autorizzata tramite vault-a-stdin, mai in chat o nel repo; definire versione WAPI, TLS e permessi effettivi sul target.
- [ ] Preparare collector/parser per IPAM, DHCP e DNS con dati parziali espliciti, prove offline e collaudo autenticato; nessun DB, configurazione, UI o automatismo modificato.

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
- [ ] **72729 segue `main`**: per vedere il detect OT lì serve la promozione dev→main (col sì di Riccardo). Hub 533 e appliance A (dev) prendono le regole al prossimo riavvio/seed.
- [ ] Gli apparati già `unknown` si riclassificano solo a una nuova scansione/fingerprint (unknown→noto è un upgrade permesso): dopo il rilascio su main, rileggere i device OT della 72729.
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

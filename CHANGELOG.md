# Changelog

Tutte le modifiche notevoli al progetto DA-INVENT (alias DA-IPAM) sono documentate qui.
Formato: [Keep a Changelog](https://keepachangelog.com/it/1.1.0/) — versioni hub semver
incrementale, versioni agent indipendenti (`agent-vX.Y.Z`).

## [Non rilasciato] — 2026-10-12

### Aggiunte

- **Banco di prova delle scansioni** (tappa 3, T3-16): il vero giro di scoperta della rete ora si può far girare in una prova con un esecutore finto, mentre una guardia fa fallire la prova se qualcosa prova a uscire davvero sulla rete. *Perché*: le correzioni delle scansioni che si accavallano e degli host vivi segnati spenti (INV-1, INV-2) vanno provate sul codice vero, e fin qui l'unico modo era mandare pacchetti veri. In produzione non cambia niente: la porta per le prove è vuota. Di contorno, i timer che puliscono l'avanzamento di una scansione finita non tengono più vivo il processo per cinque minuti.

- **Controller UniFi come fonte di dati (spento finché non lo si accende).** A
  DTS il controller UniFi gestisce 74 apparati, ma per DA-IPAM erano solo host:
  nessuno fra i dispositivi di rete, nessuna porta, nessun vicino LLDP, e la
  mappa della topologia mostrava quasi solo i tre MikroTik. Ora DA-IPAM legge il
  controller in sola lettura e scrive nel tenant gli switch e gli access point,
  le loro porte e i collegamenti fra apparati. Si configura in Impostazioni →
  Moduli → «Controller UniFi» (indirizzo, site, utente in sola lettura,
  password), si prova con «Prova connessione» e si lancia con «Sincronizza ora».
  Per ora funziona solo il controller installato su un server (self-hosted):
  UDM e cloud rispondono «non ancora supportato». Le scelte sono nell'ADR 0005.
  - **Nasce spento**: modalità «Disattivata» e nessuna sincronizzazione
    automatica. Gli apparati nuovi entrano disabilitati, così il poll ARP non
    li interroga via SNMP.
  - **Il certificato del controller si fissa al primo collegamento riuscito.**
    Se cambia, la sincronizzazione si ferma e la card mostra le due impronte:
    la nuova si accetta solo a mano. La password non parte mai verso un
    certificato che non è quello fissato. Cambiando l'indirizzo del
    controller la password salvata si cancella e va riscritta: altrimenti
    un errore di battitura (o chi non la conosce) la farebbe arrivare al
    primo host che risponde. La prova di connessione è un POST, così un
    link aperto con la sessione attiva non la fa partire.
  - **Una risposta vuota non cancella niente.** Se il controller non riporta
    porte o vicini per un apparato che nel database ne ha, si tengono i dati
    di prima e lo si segnala. Lo stesso per un apparato spento o scollegato:
    il controller ne dà solo le porte senza stato, quindi porte e vicini
    restano quelli dell'ultima sincronizzazione e la card lo elenca a parte.
  - **Nessun doppione e nessuna scelta sovrascritta.** Un apparato già censito
    si ritrova per seriale, MAC o IP, e se ne aggiornano solo i dati di fatto
    (modello, firmware, seriale), non nome, credenziali e abilitazione. Un IP
    occupato da un altro apparato (MAC diverso, altro produttore o altro
    seriale) si salta e lo si dice. Se un AP cambia IP e uno nuovo prende il
    suo, il nuovo non sovrascrive più quello censito, qualunque sia l'ordine
    in cui il controller li elenca. Gli apparati non ancora adottati non
    entrano.
  - **Compare in «Stato moduli»**, con una sonda che non fissa mai il
    certificato da sola e non interroga il controller più di una volta ogni
    cinque minuti. Il controllo del disco dell'appliance, ogni 30 minuti, non
    lo interroga affatto: la verifica di un solo modulo fa partire solo la
    sua sonda.
  - Il job `unifi_sync` esiste nello scheduler (migrazione v8 di
    `scheduled_jobs`) ma nessuno lo crea da solo. I tipi di job ora stanno in
    un solo elenco, condiviso da schema e migrazione; una prova confronta la
    tabella aggiornata con quella di un tenant nuovo, vincoli e indici
    compresi, perché il resto del DDL della v8 è ancora scritto a mano.

### Correzioni

- **Un ping che non può girare non spegne più gli host** (tappa 3, T3-19, INV-2): il ping ora ha tre esiti, «vivo», «nessuna risposta» e «sconosciuto». Quando il comando di ping non può partire o esce con un errore suo (e non per mancanza di risposta), l'indirizzo resta com'era invece di essere segnato spento; se nessun indirizzo ha avuto un esito vero, il giro finisce «fallito» senza toccare gli host. *Perché*: prima ogni errore del ping valeva «host spento», quindi un problema della macchina che scansiona poteva spegnere in un colpo tutta una rete. Il codice di uscita si legge secondo la piattaforma (Linux e macOS lo usano in modo diverso).

- **Ordinamenti giusti nelle liste paginate.** Nelle liste DHCP e Subnet gli IP e
  i CIDR si ordinavano come testo («10.0.0.10» prima di «10.0.0.2»); la colonna
  «Ultimo visto» del DHCP ordinava in realtà per «Ultimo sync»; a valori uguali
  le righe potevano ripetersi o saltare fra una pagina e l'altra. Ora IP e CIDR
  vanno in ordine numerico, ogni colonna cliccabile è ammessa dal server (una
  prova lo controlla) e a parità di valore l'ordine è stabile. Nella pagina
  Dispositivi l'ordinamento per IP non si confonde più con un nome host.
- **I filtri valgono su tutta la lista, non sulla sola pagina.** «Solo recenti»
  del DHCP e, in Patch, la ricerca e la soglia di gravità filtravano soltanto le
  righe già caricate: si cercava un host e «non c'era», ma stava a pagina 2, e i
  totali restavano quelli non filtrati. Ora li applica il server.
- **L'amministratore del cliente gestisce gli utenti del proprio cliente (UI-18).**
  Su un'appliance installata per un solo cliente, l'amministratore creato dal
  setup apriva Impostazioni → Utenti e leggeva «Nessun utente trovato»: le rotte
  degli utenti erano riservate al super amministratore e il loro rifiuto si
  presentava come lista vuota. Ora l'amministratore vede, crea, modifica,
  reimposta la password ed elimina gli utenti dei clienti che amministra, e solo
  quelli: non tocca un super amministratore, non assegna quel ruolo, non elimina
  sé stesso e non si toglie il ruolo di amministratore, così l'installazione non
  resta mai senza. La propria password la cambia da «Cambia password» nel menu
  utente, che chiede quella attuale: da Utenti no, altrimenti una sessione
  rubata diventerebbe una password nuova che dura oltre la sessione. Nella
  pagina il ruolo «Super amministratore» non gli viene proposto e il cliente è
  fisso sul suo; un errore del server si mostra come errore. Il solo-lettura non
  gestisce utenti e non vede più la scheda Utenti (prima l'avrebbe vista come un
  errore da riprovare). Un super amministratore declassato smette subito di
  gestire utenti, senza aspettare che la sessione scada; per il resto resta
  com'era. Lo username dell'utenza di servizio Domarc («domarc») non si può più
  dare a un utente locale, che nei log sembrerebbe il supporto. Le regole stanno
  in un punto solo (`src/lib/users/`), provate su tutte le combinazioni e su
  ogni rotta.
- **Le conferme di disinstallazione e rimozione dicono cosa si perde (MOD-19).**
  Sotto «Elimina anche i dati storici» c'era scritto che la richiesta veniva
  accettata «ma non droppa», mentre la disinstallazione cancellava davvero le
  tabelle del modulo; «Rimuovi» dello Scanner-Edge prometteva che i findings
  restavano in archivio, e invece se ne vanno a cascata con lo storico delle
  scansioni. Ora la conferma di Patch Management, Inventory Agent e MeshCentral
  dice cosa resta senza la casella e cosa si cancella con la casella (con
  l'elenco delle tabelle), e il messaggio finale dice se i dati sono stati
  cancellati davvero; «Rimuovi» dello Scanner-Edge dice quanti findings si
  cancellano; le conferme dei container di LibreNMS, Graylog e Loki e quella di
  Network Services dicono che cosa non torna. Il comportamento sui dati non
  cambia (è la tappa 7): cambiano solo i testi, e due prove eseguono la
  cancellazione vera e la confrontano con ciò che la conferma promette.
  Network Services, sulle appliance dove il bridge viene dalle variabili
  d'ambiente `NET_SERVICES_API_URL` e `NET_SERVICES_API_TOKEN` (le scrive
  `appliance-integrate-fix.sh`), dopo la disinstallazione resta attivo con lo
  stesso bridge: la conferma ora lo dice, e se il bridge viene solo da lì il
  pulsante «Disinstalla» lascia il posto a una nota che spiega come spegnerlo.
  Anche l'import del JSON dello Scanner-Edge (Impostazioni → Moduli →
  «Importa configurazione modulo») sostituisce lo scanner cancellando a
  cascata findings e storico delle scansioni, e lo faceva senza dire niente:
  ora, se c'è uno storico, prima di scrivere chiede conferma dicendo quanti
  findings e quante scansioni si cancellano e che la sincronizzazione
  riscarica solo ciò che l'edge conserva ancora. Il connect di
  Deploy-Appliance, che usa la stessa rotta, non cambia.
- **Le righe «Stato moduli» della dashboard portano al modulo (UI-20).**
  Aprivano sempre la configurazione, anche per un modulo attivo con la sua
  pagina, e un modulo mai installato diceva «Mai eseguita», che si legge come
  «c'è ma non ha ancora girato». Ora un modulo attivo apre la sua pagina in
  DA-IPAM anche quando la sonda è in errore (i findings e i nodi in cache si
  leggono lo stesso), o il Launchpad se ha un'interfaccia esterna e non è in
  errore; uno non installato, da configurare o spento apre la sua scheda in
  Impostazioni → Moduli, e al posto dell'ora dice «Modulo non attivo», «da
  configurare» o «disattivato». Un modulo non installato non conta più fra
  quelli «in errore»: MeshCentral disinstallato tiene i parametri di
  collegamento e la sua sonda poteva accendere il badge rosso.
- **I filtri mostrano l'etichetta della voce scelta, non il suo codice.** Dopo
  una scelta, i menu a tendina dei filtri mostravano il valore tecnico: «all»
  invece di «Tutti gli stati», «unacked» invece di «Non gestiti», il numero della
  rete invece del suo nome. La libreria dei componenti (base-ui) mostra
  l'etichetta solo se riceve l'elenco delle voci, e nessuna pagina glielo
  passava. Ora il componente comune `Select` lo ricava da solo dalle voci che
  contiene: la correzione vale per tutti i menu senza toccarli uno per uno.
- **Gli orari sono quelli di Roma, non indietro di una o due ore.** Il database
  scrive le date in UTC senza indicare il fuso (`2026-10-12 08:00:00`) e le
  pagine le leggevano come ora locale: ogni orario mostrato era indietro di
  un'ora d'inverno e di due d'estate, e su Safari compariva «Invalid Date». Una
  sola funzione, `parseDbDate` (`src/lib/db-date.ts`), legge quelle date come UTC
  ed è usata in tutte le pagine; la dashboard, preparata sul server (che in
  produzione è in UTC), indica in più il fuso di Roma.
- **Dispositivi: lo stato è la raggiungibilità vera.** La colonna «Stato» e il
  filtro Online/Offline guardavano se il dispositivo era *abilitato in
  anagrafica*: un router spento ma abilitato risultava «Online». Ora lo stato
  viene dall'host scansionato con lo stesso IP (con «stale» se l'ultima risposta
  è vecchia), e un dispositivo che nessuna scansione ha mai visto è
  «Sconosciuto», con una voce apposta nel filtro.
- **Un errore non si presenta più come «nessun dato».** Scansioni, IP esclusi,
  Anomalie e Tabella ARP, se il server rispondeva con un errore (sessione
  scaduta, errore interno, server irraggiungibile), mostravano una lista vuota
  («Nessuna scansione eseguita») oppure lasciavano a schermo i dati vecchi senza
  dire niente. Ora compare «Impossibile caricare …» con il motivo e il pulsante
  «Riprova». Due pezzi riusabili per le altre pagine: `fetchJson`
  (`src/lib/fetch-json.ts`) e il riquadro `LoadError`.
- **Grafico «Stato host nel tempo»: niente più denti di sega.** Il grafico
  contava, ora per ora, solo gli host controllati dentro quell'ora e metteva
  tutti gli altri fra gli «Sconosciuti». Dove il controllo degli host gira ogni
  3 ore (DTS) la curva saliva all'ora del controllo e crollava nelle due ore
  dopo, con la salute al 3%, anche se nessun host cambiava stato. Ora ogni host
  conserva il suo ultimo stato per 24 ore (oltre torna «sconosciuto»), la serie
  ha un punto per ogni ora anche senza controlli, e la salute si calcola sugli
  host di stato noto (`src/lib/status-over-time.ts`).
- **L'aggiornamento automatico delle appliance non si blocca più su WinRM e
  riavvia il servizio giusto.** Su DTS da giugno ogni aggiornamento si fermava:
  l'ambiente Python per WinRM era stato creato senza `pip` e lo script, trovando
  `python3`, non lo ricreava; dopo il `git pull` si fermava tutto e la build
  nuova non partiva mai. Ora un ambiente senza `pip` si ricrea, un guasto di
  WinRM (funzione facoltativa) è solo un avviso, e il riavvio cerca il servizio
  attivo (`da-invent` o `da-ipam`) invece del solo `da-invent`.
- **Il controllo finale dell'aggiornamento non segnala più un falso errore.**
  Partiva un secondo dopo il riavvio, quando l'app non ascoltava ancora, e
  falliva sempre con un avviso che rimandava a WinRM. Ora aspetta fino a 60
  secondi che l'app risponda.
- **L'aggiornamento automatico non riavvia per i commit di sola
  documentazione.** Un commit che cambia solo `docs/` o file `.md` aggiorna i
  file senza build né riavvio: prima ogni nota pubblicata riavviava DTS e
  interrompeva il controllo degli host in corso.
- **«Aggiorna» e «Riavvia» dall'interfaccia non lasciano più l'app spenta, e
  «Aggiorna ora» di Impostazioni funziona.** Il riavvio cercava solo il servizio
  `da-invent`; sulle appliance installate con Deploy-Appliance, come DTS, si
  chiama `da-ipam`, e il pulsante ripiegava sul rilancio da sé (un processo
  staccato e un'uscita senza errore), che sotto systemd chiude tutto: l'app
  restava spenta finché qualcuno non la riavviava a mano (successo due volte il
  12/10). Ora, sotto systemd, si riavvia l'unità in cui gira il processo, letta
  da `/proc/self/cgroup` qualunque nome abbia, con `systemctl --no-block
  restart`, e si lascia che sia systemd a fermare il processo e a farlo
  ripartire. Il processo esce con errore, e con `Restart=on-failure` riparte
  comunque, in tre casi: se risulta sotto systemd (variabile `INVOCATION_ID`)
  ma non si capisce quale unità; se systemd rifiuta la richiesta (per esempio
  per i permessi) o non risponde entro 15 secondi, e il motivo va nel log; se
  systemd l'accetta ma dopo 90 secondi il processo è ancora vivo. Sotto systemd
  non esce mai senza errore e non si rilancia mai da sé: il rilancio resta solo
  fuori da systemd, in sviluppo, dopo PM2 se c'è. Non si sceglie più il primo
  servizio attivo fra `da-invent` e `da-ipam`: con `systemctl` lento (macchina
  sotto carico) o un nome diverso risultava «nessun servizio» e si tornava al
  rilancio da sé, e con tutti e due attivi si poteva riavviare quello sbagliato
  (`src/lib/app-service.ts`).
  Dopo un «Aggiorna» riuscito il riavvio lo programma il server, un secondo
  dopo aver risposto, sulla stessa strada di «Riavvia»: prima lo chiedeva il
  browser alla risposta, e con una build più lunga dell'attesa di nginx (300 s)
  o con la scheda chiusa la build nuova restava su disco col processo vecchio.
  L'interfaccia non chiede un secondo riavvio, mostra i passi eseguiti e
  l'esito, e se la risposta si perde spiega che il server finisce da solo.
  «Aggiorna ora» in Impostazioni → Aggiornamenti mandava l'azione nel corpo
  della richiesta, che la rotta non leggeva, e riceveva «Azione non
  supportata»: ora l'azione si legge dall'indirizzo o dal corpo.
  I comandi da copiare dell'aggiornamento manuale riavviano il servizio attivo
  fra `da-invent` e `da-ipam` (prima solo `systemctl restart da-invent`, che su
  DTS falliva) e, se nessuno dei due è attivo, lo scrivono; il messaggio dello
  scheduler che chiede di riavviare il processo nomina tutti e due.
- **Un job non parte più due volte nello stesso processo.** Quando una pagina
  salvava la configurazione dei job (job, AD, Wazuh, MeshCentral, Scanner-Edge,
  import moduli), lo scheduler veniva ricaricato da una seconda copia del suo
  modulo, che non vedeva i cron già attivi: non li fermava e ne aggiungeva
  altri. Su DTS, il 12/10 alle 15:04, il controllo degli host è partito due
  volte insieme. Ora l'elenco dei cron è unico per processo.
- **Tabella ARP: si vede quando la lista è troncata.** Mostra al massimo 500
  righe; arrivata al limite, ora lo dice e invita a restringere con i filtri,
  invece di tagliare in silenzio.
- **VA Scan: i profili assessment sono quelli dell'edge (EDG-1).** Il pannello
  della subnet offriva quattro profili scritti nel codice, ma l'edge conosce solo
  quelli del suo catalogo: due dei quattro non li ha mai avuti. L'id si salvava
  senza errori e l'assessment falliva dopo la scansione, sull'edge, con «Profilo
  sconosciuto», senza che DA-IPAM lo mostrasse. Ora l'elenco si legge dall'edge
  (`GET /api/v1/profiles`) con la sua etichetta; se l'edge non risponde la pagina
  lo dice e non offre una lista inventata. Prima di avviare una scansione o di
  salvare una pianificazione DA-IPAM controlla che l'edge abbia il profilo, e se
  non c'è risponde con l'errore e l'elenco dei profili disponibili. Un profilo
  salvato che l'edge non ha più si vede sul pulsante «VA Scan» e nel pannello.
  Acceso senza profilo non ripiega più su «validation-plus»: chiede di sceglierlo.
  Il profilo nuovo si salva in DA-IPAM solo dopo che l'edge l'ha accettato: prima
  si scriveva subito, e se l'edge rifiutava la richiesta (integrazione IPAM spenta,
  token senza permessi, timeout) l'avviso spariva mentre l'edge teneva il profilo
  vecchio. L'avviso c'è solo a pagina aperta: le reti che nessuno apre non lo
  mostrano ancora.

## [Non rilasciato] — 2026-09-07

### Aggiunte

- **L'utenza si crea su dichiarazione di DA-Auth, non da sola.** Chi arriva da
  `entra.domarc.it` e non ha un'utenza qui entra **solo** se un amministratore
  l'ha dichiarato su DA-INVENT: allora l'utenza si crea, col ruolo e i clienti
  che la tabella di traduzione associa al suo. Senza dichiarazione, rifiuto
  come prima. Non è auto-provisioning: non si inventa niente, si esegue una
  decisione presa e firmata.
  La traduzione (`RUOLO_DOMARC_A_LOCALE` in `src/lib/daauth.ts`) è scritta in
  chiaro e sta **qui**, perché è questa applicazione a sapere cosa significano
  i propri ruoli e cos'è un cliente: `admin` → `superadmin` (vede tutti);
  `standard` → `admin` su Domarc (`70791` e `70791a`, che sono la sede e
  l'infrastruttura a OVH dello stesso cliente) — è il livello del tecnico;
  `readonly` → `viewer` sugli stessi. Non è un accesso regalato a chi lavora in
  Domarc: **senza dichiarazione non entra nessuno**, e la traduzione vale solo
  per chi un amministratore ha messo esplicitamente su questa applicazione. Un
  ruolo che non c'è (o che è stato tolto dal parco) non si traduce.
  ⚠️ I clienti si dichiarano **per codice** e un codice che non esiste viene
  saltato con un avviso: non diventa «tutti». Il ruolo e i clienti di chi ha
  già un'utenza non si toccano.

- ⚠️ **È un'OPZIONE, e nasce spenta.** DA-INVENT è installato anche presso i
  clienti, su appliance che non hanno — e non devono avere — un servizio di
  autenticazione Domarc da contattare. Il freno è la variabile `DAAUTH_URL`:
  **senza, la funzione non esiste**, il bottone non compare e l'installazione
  si comporta esattamente come prima. Non c'è un valore predefinito, di
  proposito. Si accende solo sugli impianti Domarc mettendo l'indirizzo del
  servizio in `.env.local` (o nel compose) e riavviando.
- **Si entra con l'account Domarc.** Un bottone «Accedi con l'account Domarc»
  sulla pagina di accesso: si viene riconosciuti da `entra.domarc.it` — con
  Microsoft e MFA, con le credenziali di dominio o col PIN — e si entra senza
  digitare niente qui. Chi ha già una sessione Domarc aperta da un'altra
  applicazione non rifà nulla. **Non serve una registrazione Entra per
  DA-INVENT**: quella ce l'ha DA-Auth, che in più conosce i nostri utenti, sa
  dire il ruolo per singola applicazione e tiene il registro degli ingressi,
  compresi quelli falliti.
- **Username e password restano**, e non per inerzia: sono la riserva. Se
  `entra.domarc.it` non risponde si entra come prima — la funzione che lo
  interroga restituisce «non lo so» invece di sollevare, ed è provato. Il
  backoff sui tentativi falliti non è stato toccato.
- ⚠️ **Chi arriva da DA-Auth deve avere un'utenza DA-INVENT**: nessun
  auto-provisioning. Una riga creata al volo non avrebbe tenant (inutile) o li
  avrebbe sbagliati (dannoso). E **ruolo e tenant restano quelli della riga
  locale**, non quelli che dice DA-Auth: i due sistemi parlano vocabolari
  diversi (qui c'è `superadmin` e l'accesso per tenant, là no), e tradurli in
  silenzio darebbe a qualcuno più permessi di quelli che ha oggi.

- **I CPE dei servizi arrivano fino al database.** `parseNmapXml` leggeva solo
  gli attributi `product`/`version` di `<service>` e scartava i figli `<cpe>`:
  misurato su 664 porte reali, 194 avevano la versione e **zero** un CPE. Senza
  CPE il match con l'NVD non e' possibile — `cpe:/a:openbsd:openssh:9.6p1` si
  confronta con i cpeMatch, la stringa "OpenSSH 9.6p1 Ubuntu 3ubuntu13.15" no.
  `NmapPort` ora porta anche `product`, `product_version` e `cpes`; la stringa
  unita `version` resta identica, perche' la leggono UI, classificatore e
  fingerprint. Primo passo del match CVE da feed locali (NVD + EPSS + KEV),
  scelti al posto dell'API vulners.com per non far uscire l'inventario software
  dei clienti verso terzi.
- **Intensita' `-sV` configurabile** via `DA_INVENT_NMAP_VERSION_INTENSITY`
  (0-9). **Default invariato a 0**: alzarla costa tempo di scansione su ogni
  host di ogni cliente, e si decide misurando su rete vera, non a sensazione.
- Test-invariante `src/lib/scanner/__tests__/nmap-cpe.test.ts`: la perdita dei
  CPE era silenziosa — nessun test falliva, il campo semplicemente non c'era.

## [Unreleased] — branch `feature/remote-agents`

Aggiunge l'architettura **hub + agenti remoti via Tailscale**: l'hub IPAM
orchestra agenti Python installati presso i clienti, mantenendo invariato
il flusso per i tenant gestiti localmente.

### Added

#### Hub (Next.js)

- **Tabella `tenant_agents`** (`db-hub-schema.ts`): supporta **N agenti per
  tenant** (sedi diverse dello stesso cliente). Colonne: id, tenant_id FK,
  label, hostname, port, token_hash, token_encrypted, version, last_seen_at,
  subnet_match (riservato a routing per-subnet futuro), timestamps.
  Migrazione idempotente in `initializeHubDb()`: per ogni tenant con
  `agent_hostname` non-null, crea una riga in `tenant_agents` etichettata
  "Sede principale".
- **Pagina `/agents`** (`src/app/(dashboard)/agents/page.tsx`): overview
  cross-tenant di tutti gli agenti. Colonne: cliente, label/sede,
  hostname:porta, versione, ultimo heartbeat, stato live (online/error_code),
  azioni (Test, Configura, Elimina). Pulsanti "Ricarica", "Testa tutti".
- **Wizard "Nuovo agente"** (dialog 2-step + token):
  - Step 1: scelta cliente esistente (dropdown) o creazione cliente nuovo
    inline (codice + ragione sociale).
  - Step 2: configurazione agente (label/sede, hostname Tailscale, porta,
    subnet_match opzionale). Imposta automaticamente `agent_mode='remote'`.
  - Step 3: mostra token plaintext (una sola volta) + campo opzionale
    Tailscale auth-key + comando di install one-liner pre-popolato.
- **`Executor` abstraction** (`src/lib/executor/`):
  - `Executor` interface (`index.ts`): primitive ping/nmap/dns/macVendor.
  - `LocalExecutor` (`local.ts`): delega ai moduli `src/lib/scanner/*`.
  - `RemoteExecutor` (`remote.ts`): client HTTP verso agent via Tailscale,
    timeout per metodo, error envelope strutturato (`RemoteExecutorError`).
  - `getExecutor(tenantCode)`: legge `tenants.agent_mode` e pesca il primo
    agente da `tenant_agents` per i tenant remote.
- **`discoverNetwork`/`runDiscovery` instradano via executor** del tenant:
  shadowing trasparente di `pingSweep`/`nmapDiscoverHosts`/`nmapPortScan` —
  zero modifiche ai call site interni. Skip del check `isNmapAvailable` locale
  quando l'executor è remoto (l'hub si fida dell'agent).
- **Bottone "Testa connessione"** in `/tenants/[id]/agent` con badge
  esito (online + latency / error_code).
- **API tenant-agents** (per-agent CRUD):
  - `GET/POST /api/tenant-agents` (lista cross-tenant o filtrata; create).
  - `GET/PUT/DELETE /api/tenant-agents/[id]` (singolo).
  - `POST /api/tenant-agents/[id]/token` (genera, sovrascrive precedente).
  - `POST /api/tenant-agents/[id]/token/import` (importa token plaintext esistente).
  - `POST /api/tenant-agents/[id]/test` (call `/whoami` su agent).
- **API back-compat** `/api/tenants/[id]/agent*`: continuano a funzionare
  puntando al primo agent del tenant; le scritture creano l'agent se assente.
- **API `GET /api/agents`**: lista one-row-per-agent cross-tenant.
- **Endpoint pubblico `/agent-install.sh`**: serve lo script con
  `Content-Type: text/x-shellscript`, esente da auth middleware
  (consumabile via `curl|bash` da macchine senza sessione).
- **`scripts/hub-install.sh`** idempotente: apt-installs (nmap, snmpwalk,
  fping, arping, Kerberos, build-essential), `setcap` su nmap, crea venv
  pywinrm in `/root/.da-invent-venv`. Da usare dopo migrazioni LXC→VM.
- **Sidebar**: voce "Agenti remoti" (solo superadmin) con icona `ServerCog`.
- **Validazione hostname Tailscale** lato API (`PUT /agent`): regex
  MagicDNS short-name o FQDN, niente schemi `http://` o path.
- **Frontend `Tenant` interface** allineata: campi `agent_*` opzionali nel
  tipo della pagina `/tenants`.

#### Agent (Python / FastAPI)

- **v0.2.0** — riscrittura completa Phase 3:
  - Multi-token auth con `DA_INVENT_AGENT_TOKENS` (lista JSON di
    `{label, token_hash, scopes}`). Drop totale di `DA_INVENT_AGENT_TOKEN_HASH`.
  - **Scope enforcement**: `exec:network`, `exec:device`, `admin:update` o
    wildcard `*`. Dependency `require_scope(...)` per endpoint.
  - **Endpoint nuovi**:
    - `GET /whoami` — info token autenticato.
    - `POST /exec/snmp-walk` — wrapper `snmpwalk -Oqn`, v1/v2c/v3.
    - `POST /exec/arp-poll` — OID `1.3.6.1.2.1.4.22.1.2`, parser MAC
      robusto a 3 formati (colon, hex-string, RouterOS CHR quoted) +
      filtro MAC vuoti/zero.
    - `POST /exec/snmp-routes` — ipAddrTable + ipCidrRouteTable in
      parallelo, filtri `/32`, `/0`, link-local, multicast, loopback,
      dedup per CIDR.
    - `POST /exec/ssh-exec` — asyncssh con password o key, trunc stdout
      1 MiB / stderr 256 KiB.
    - `POST /exec/winrm-exec` — subprocess `winrm_bridge.py` (copia
      dell'hub), Kerberos auto-fallback NTLM→CredSSP→Basic.
  - **Error contract uniforme**: `{error: {code, message, retriable, details?}}`
    con codes: `tool_missing`, `auth_invalid`, `scope_denied`, `invalid_input`,
    `target_unreachable`, `timeout`, `parse_error`, `internal`.
  - **`/healthz` esteso**: `tools` (nmap, snmpwalk, ping, ssh), `network`
    (tailscale ok + tailscale_ip), cache 60s.
  - **OpenAPI export**: `agent/scripts/dump_openapi.py` +
    `check_openapi_fresh.sh` + pre-commit hook locale.
- **v0.2.1** — fix bug asyncssh: rimosso kwarg invalido `client_keys_load_path`,
  sostituito con `client_keys=[]` per disabilitare pickup automatico delle
  chiavi locali.
- **v0.2.2** — **UDP port scan** attivo (in v0.2.0/v0.2.1 era stubbato).
  Seconda fase nmap `-sU` con porte default (53,67,68,69,123,137,138,161,
  162,500,514,520,1900,4500,5060,5353) override-abili. Merge TCP+UDP senza
  duplicati su (port, protocol).
- **v0.2.3** — UDP scan funzionante in produzione:
  - `nmap.py` antepone `sudo -n /usr/bin/nmap` per il path UDP
    (nmap 7.94 su Ubuntu 24.04 hard-checka euid==0).
  - Systemd unit aggiornato: omesso `NoNewPrivileges` (per sudo +
    file caps), omesso `CapabilityBoundingSet` (impediva CAP_SETUID a
    sudo), omesso `MemoryDenyWriteExecute` (interferiva con runtime
    Python), aggiunto `AF_PACKET` a `RestrictAddressFamilies` (per
    libpcap).
  - Installer scrive `/etc/sudoers.d/da-invent-agent` con NOPASSWD
    limitato a `/usr/bin/nmap`, validato con `visudo -cf`.
- **v0.2.4** — installer one-liner ora gestisce Tailscale:
  - `install.sh` installa Tailscale (script ufficiale `tailscale.com/install.sh`)
    se mancante.
  - `tailscale up` con `TAILSCALE_AUTH_KEY` se fornito (fully automated)
    o interattivo (stampa URL da aprire nel browser).
  - Variabile `TAILSCALE_HOSTNAME` opzionale.

### Changed

- `getExecutor(tenantCode)` ora pesca il primo agent dal nuovo
  `tenant_agents` invece che dai campi `tenants.agent_*` (rimangono per
  back-compat ma deprecati).
- Endpoint `GET /api/agents` ritorna un row per agente (era un row per
  tenant in modalità remote).
- UI `/agents`: dropdown stati e azioni rifatti per multi-agent.

### Fixed

- **Reset password hash** corrotto da shell interpolation del `$` bcrypt
  attraverso doppio SSH. Procedura ora usa `ssh -J` + script via scp con
  parameter binding (vedi memo `feedback_no_shell_concat_hashes.md`).
- **Build hub su VM 533** mancava `nmap`, `snmpwalk`, `fping`, `arping`,
  Kerberos, venv pywinrm. `scripts/hub-install.sh` chiude il gap.
- **Rate limiter login** in-memory si pulisce al restart del servizio.

### Security

- Token plaintext mai persistiti né loggati: solo bcrypt hash + ciphertext
  AES-GCM (chiave da `ENCRYPTION_KEY`).
- Agent: redact di community SNMP, password SSH/WinRM nei subprocess args
  loggati (`SecretStr` pydantic).
- Origin check CGNAT (100.64.0.0/10) **prima** della verifica token
  sull'agent.
- Sudo NOPASSWD limitato esclusivamente a `/usr/bin/nmap` per l'agent user.

### Deploy notes

- Hub: dopo `git pull`, eseguire `bash scripts/hub-install.sh` su host nuovi
  o migrati per garantire le dipendenze di sistema.
- Agent: il flusso d'installazione completo è ora un singolo `curl|bash`
  generato dalla UI hub (pagina `/agents` → "Nuovo agente" → step 3).
- Migrazione dati: tenant esistenti con `agent_hostname` configurato
  vengono migrati automaticamente in `tenant_agents` al primo restart del
  hub (idempotente, no perdita).

### Note architetturali

- L'**aggiunta di un agente richiede un cliente esistente** (1 agente
  appartiene sempre a un tenant). Il wizard può crearne uno inline.
- Il **routing subnet→agent** è schematizzato (campo `subnet_match`) ma
  non ancora valutato: oggi il primo agente del tenant gestisce tutte le
  scansioni. Phase 7 introdurrà il dispatch per CIDR.

---

## Storico versioni (commit log)

| Tag/Versione | Commit | Note |
|---|---|---|
| `agent-v0.2.4` | `7501732` | installer gestisce Tailscale |
| (hub) | `43d5380` | aggiunto `scripts/hub-install.sh` |
| (hub v0.2.421) | `a9cb244` | skip isNmapAvailable locale per remote |
| `agent-v0.2.3` | `9ec4130` | UDP scan attivo + sudo fallback |
| (hub v0.2.420) | `103a952` | RemoteExecutor + scan flow wiring |
| `agent-v0.2.2` | `4e28670` | UDP scan implementato |
| (hub v0.2.419) | `543970c` | overview /agents + test endpoint |
| `agent-v0.2.1` | `01f7bb3` | fix asyncssh kwarg |
| `agent-v0.2.0` | `638b13b` | Phase 3 endpoints + multi-token |
| (hub v0.2.418) | `a660d6c` | Phase 2 agent skeleton |
| (hub v0.2.417) | `4c07873` | Phase 1 schema + Executor abstraction |

---

# 📘 Handoff — onboarding per la prossima istanza Claude

Sezione operativa per chi raccoglie lo sviluppo da qui in poi. Non sostituisce
[CLAUDE.md](CLAUDE.md) (regole stack/anti-regressione invarianti), ma copre
contesto di sessione, decisioni del branch `feature/remote-agents` e gotchas.

## 1. Contesto progetto in due paragrafi

**DA-INVENT** (alias DA-IPAM) è un IPAM multi-tenant Next.js 16 + better-sqlite3
con architettura **hub + spoke**: un DB SQLite per tenant (`data/tenants/<code>.db`)
e un hub condiviso (`data/hub.db`). Da Phase 1 il sistema supporta anche
**agenti Python remoti** installati presso i clienti, raggiunti via Tailscale,
che eseguono le primitive di rete (ping/nmap/SNMP/SSH/WinRM) dentro la rete
del cliente. L'hub orchestrazione resta uguale; l'`Executor` decide a runtime
se eseguire localmente o tramite agent.

Stato produzione (2026-05-12): hub su **VM 533** (Proxmox PX-04, IP interno
`192.168.4.8`, accessibile da chi sta sulla 192.168.4.0/24 o via jump host
`root@192.168.40.4`). Un agent live su `bridge-domarc-ovh` (Tailscale IP
`100.89.234.89`) servente il tenant `70791a` (DOMARC-OVH).

## 2. Architettura agenti remoti — modello mentale

```
┌────────────────┐                         ┌─────────────────────┐
│   DA-INVENT    │   HTTPS via Tailscale   │  da-invent-agent    │
│  hub (Next.js) │ ──────────────────────▶ │  (Python/FastAPI)   │
│   VM 533       │   Bearer token          │   N istanze per     │
│                │                         │   tenant possibili  │
└───────┬────────┘                         └──────────┬──────────┘
        │                                             │
        ▼                                             ▼
    hub.db                                      rete del cliente
  (orchestrazione)                            (scan, SNMP, SSH...)
```

- **1 tenant** può avere **N agenti** (es. sedi diverse). Tabella
  `tenant_agents` 1:N su `tenants`.
- Selezione agent: oggi `getExecutor()` usa il **primo** agent. Routing
  per-subnet via campo `subnet_match` è schematizzato ma **non** dispatched.
- Token: ogni agent ha 1 token plaintext, salvato hub-side come hash bcrypt
  (verifica) + ciphertext AES-GCM (per re-trasmetterlo all'agent al test).
  Il plaintext non è mai persistito. L'agent ha la sua copia (hash bcrypt
  in `/etc/da-invent-agent/config.yml`).

## 3. File map — dove vivono le cose

### Hub Next.js

```
src/lib/executor/             ← astrazione (introdotta in questo branch)
  ├── types.ts                ← interfacce I/O (PingResult, NmapResult, …)
  ├── index.ts                ← Executor interface + getExecutor(tenantCode)
  ├── local.ts                ← LocalExecutor (wrap src/lib/scanner/*)
  └── remote.ts               ← RemoteExecutor (HTTP → agent via Tailscale)

src/lib/db-hub-schema.ts      ← include `tenants` (con agent_* deprecati)
                                e `tenant_agents` (autorità)
src/lib/db-hub.ts             ← include CRUD su tenant_agents + back-compat
                                tenant.agent_* helpers
src/lib/scanner/discovery.ts  ← runDiscovery() shadowa pingSweep/nmap*
                                con executor del tenant (function-local consts)

src/app/api/tenant-agents/                ← API canoniche (multi-agent)
  ├── route.ts                            ← GET list + POST create
  ├── [id]/route.ts                       ← GET/PUT/DELETE
  ├── [id]/token/route.ts                 ← POST genera nuovo
  ├── [id]/token/import/route.ts          ← POST importa esistente
  └── [id]/test/route.ts                  ← POST test connessione

src/app/api/tenants/[id]/agent/           ← API back-compat (puntano al primo agent)
src/app/api/agents/route.ts               ← lista cross-tenant per UI overview
src/app/agent-install.sh/route.ts         ← serve agent/scripts/install.sh
                                            con Content-Type shellscript
                                            (esente da auth, vedi auth.config.ts)

src/app/(dashboard)/agents/page.tsx       ← UI overview + Wizard 3-step
src/app/(dashboard)/tenants/[id]/agent/page.tsx ← UI per-tenant (back-compat)
src/components/shared/sidebar.tsx         ← link "Agenti remoti" (solo superadmin)

scripts/hub-install.sh                    ← bootstrap deps di sistema hub
```

### Agent Python

```
agent/
├── pyproject.toml              ← Python 3.11+, FastAPI, asyncssh, pywinrm[kerberos]
├── da_invent_agent/
│   ├── __version__.py          ← single source of truth versione agent
│   ├── main.py                 ← FastAPI app + lifespan + error handlers
│   ├── config.py               ← pydantic-settings, sorgenti env + YAML
│   ├── auth.py                 ← bearer token + origin CGNAT + require_scope()
│   ├── scopes.py               ← Scope enum (exec:network|device, admin:update)
│   ├── errors.py               ← AgentException + error envelope uniforme
│   ├── system_probe.py         ← _which() + probe Tailscale, cache 60s
│   ├── models.py               ← pydantic models speculari a executor/types.ts
│   └── exec/
│       ├── ping.py             ← subprocess ping (cross-platform)
│       ├── nmap.py             ← TCP -sT + UDP -sU via sudo, parser XML
│       ├── dns.py              ← socket.getaddrinfo + getnameinfo
│       ├── snmp.py             ← subprocess snmpwalk -Oqn + parsers (walk, routes)
│       ├── arp.py              ← parser MAC 3 formati (colon, hex-string, RouterOS CHR)
│       ├── ssh.py              ← asyncssh wrapper, trunc stdout/stderr
│       ├── winrm.py            ← subprocess winrm_bridge.py, classify_error
│       └── winrm_bridge.py     ← copia di src/lib/devices/winrm-bridge.py (hardenato)
├── scripts/
│   ├── install.sh              ← installer one-liner (apt, Tailscale, venv, systemd)
│   ├── da-invent-agent.service ← systemd unit (no NoNewPrivileges per sudo+caps)
│   ├── dump_openapi.py         ← rigenera openapi.json
│   └── check_openapi_fresh.sh  ← pre-commit drift check
├── tests/                      ← 56 test pytest (parser ARP/routes + auth + endpoints)
└── openapi.json                ← snapshot OpenAPI 3.1 schema (commitato)
```

## 4. Comandi essenziali

```bash
# Dev hub locale
npm run dev:server                # custom server con scheduler cron
npm run lint && npx tsc --noEmit && npm run build  # verifica completa
npm run version:release           # bump patch + commit "release: vX.Y.Z"
git push origin <branch>          # produzione fa git pull

# Dev agent locale
cd agent
.venv/bin/pytest                  # 56/56 attesi (Python 3.11+, testato 3.14)
.venv/bin/python scripts/dump_openapi.py
./scripts/check_openapi_fresh.sh

# Pre-commit hook locale (installato manualmente, vedi sotto)
ls .git/hooks/pre-commit          # check_openapi_fresh.sh chiamato se tocchi agent/

# Deploy hub su VM 533 (jump via Proxmox)
ssh root@192.168.40.4 'cd /tmp/da-invent-deploy && git fetch && git reset --hard origin/feature/remote-agents && \
  rsync -az --delete --exclude=/data/ --exclude=/.env.local --exclude=/.next/ --exclude=/node_modules/ \
    /tmp/da-invent-deploy/ root@192.168.4.8:/opt/da-invent/'
ssh -J root@192.168.40.4 root@192.168.4.8 'cd /opt/da-invent && npm run build && systemctl restart da-invent'

# Deploy agent su un host nuovo (cliente)
# 1. genera token dalla UI hub → wizard /agents
# 2. copia il one-liner dal step 3 del wizard, esegui come root sull'host
```

## 5. Accesso operativo

| Risorsa | Come |
|---|---|
| Web app hub | `https://192.168.4.8` (login: admin / **DaInvent2026** — cambia al primo uso) |
| SSH hub VM 533 | `ssh -J root@192.168.40.4 root@192.168.4.8` (chiave già autorizzata su entrambi) |
| Proxmox host | `ssh root@192.168.40.4` (chiave già autorizzata) |
| Agent OVH | `ssh root@100.89.234.89` (direct via Tailscale, chiave autorizzata) |
| Agent OVH (config) | `/etc/da-invent-agent/config.yml`, service `systemctl status da-invent-agent` |
| Tailscale visibility | hub `100.124.2.70` (da-invent), agent `100.89.234.89` (bridge-domarc-ovh) |

## 6. Lezioni dure imparate (memorie persistenti)

Tutte in `~/.claude/projects/-Users-riccardo-Progetti-DA-IPAM/memory/`:

- **`feedback_no_shell_concat_hashes.md`**: mai passare hash bcrypt via shell
  concatenation attraverso doppio SSH. I `$` di `$2b$10$...` vengono
  interpolati dalla shell remota → hash troncato a 2 char → admin lockout.
  Usare `ssh -J` + script file via scp con parameter binding.
- **`feedback_verify_system_deps_on_deploy.md`**: il check `/api/health`
  ritorna OK anche se mancano `nmap`/`snmpwalk` di sistema. Sempre eseguire
  `scripts/hub-install.sh` dopo migrazione/clone host.
- **`feedback_bundle_tool_calls.md`**: bundle tool call invece di N parallele
  (ognuna genera prompt di permesso).
- **`feedback_prod_debug_no_confirm.md`**: per debug **non distruttivo** su
  Proxmox/PCT/VM (SSH, sqlite read-only, pct exec, restart servizio, push
  file fixato) procedere senza chiedere. Per **distruttivo** (DROP, modifiche
  env, distruzione container, push su `main`, credenziali in chiaro) chiedere.
- **`project_remote_agents.md`**: decisioni architetturali approvate.

## 7. Gotchas tecniche scoperte in questa sessione

### Tailscale + agent
- Agent **DEVE** girare con CGNAT origin check (100.64.0.0/10): il middleware
  rifiuta richieste da fuori la tailnet.
- Tailscale **MagicDNS short name** e FQDN entrambi accettati. La validazione
  hostname hub-side usa regex permissiva: niente schemi `http://`, niente path.
- Tailscale `up` interattivo: stampa URL, lo script aspetta. Con
  `TAILSCALE_AUTH_KEY` (reusable) → fully automated.

### nmap + capabilities (Ubuntu 24.04)
- **nmap 7.94 hard-checka `euid==0`** per `-sU`/`-sS` ANCHE con
  `CAP_NET_RAW` ambient + setcap +eip. La soluzione operativa è
  `sudo -n /usr/bin/nmap` con sudoers fragment NOPASSWD limitato. Vedi
  `agent/da_invent_agent/exec/nmap.py:_nmap_cmd()`.
- `NoNewPrivileges=true` nel systemd unit blocca sudo (non può ottenere
  CAP_SETUID). Lasciato OFF per l'agent. Mitigation: agent gira come utente
  non-root `da-invent-agent`.
- `CapabilityBoundingSet` deve essere **omesso** (non limita): se lo
  restringi a `CAP_NET_RAW` ecc., sudo non può elevare.
- `RestrictAddressFamilies` deve includere `AF_PACKET` (libpcap UDP scan).

### asyncssh
- NON passare `client_keys_load_path` (kwarg inventato — bug pre-v0.2.1).
- Per **disabilitare il pickup automatico** delle chiavi locali, passare
  `client_keys=[]` esplicito. L'autenticazione deve venire solo da `auth.*`
  del payload.

### NextAuth tenant switching
- I tenant nel JWT sono **iniettati al login** in `auth.ts:authorize()`.
  Non si aggiornano per JWT refresh. Se aggiungi un tenant mentre l'utente
  è loggato, **fagli fare logout+login** per vederlo.
- Variabile `NEXTAUTH_URL` su VM 533 può finire a `https://0.0.0.0` —
  comporta redirect post-login strani ma non blocca l'auth. Da fixare via
  `.env.local`.

### Rate limit login
- In-memory `Map` con sliding window 15 min. **Restart del servizio** è
  l'unico modo per ripulirlo. Nessuna UI/CLI di reset.

### Hub deploy (cosa NON ti aspetti)
- VM 533 (migrata da LXC 333) NON aveva di base: `nmap`, `snmpwalk`,
  `fping`, `arping`, Kerberos packages, venv `/root/.da-invent-venv`.
  Eseguire `bash scripts/hub-install.sh` dopo ogni migrazione.
- `/opt/da-invent` su VM **NON è git repo** — deploy via rsync da
  `/tmp/da-invent-deploy` su Proxmox host.

## 8. Phase residue e backlog

| Phase | Cosa | Note |
|---|---|---|
| **6** | Heartbeat + observability persistenti | Tabella `agent_heartbeats` su hub.db, agente fa POST a hub `/api/agents/heartbeat` ogni 60s. Per ora abbiamo solo on-demand test. |
| **7** | Routing **subnet → agent** | Quando un tenant ha N agent con subnet diverse, decidere quale chiamare in base al target IP. Campo `subnet_match` (CSV CIDR) già nello schema. `getExecutor()` accetta optional targetIp param. |
| **7+** | TLS end-to-end | Oggi HTTP plain via Tailscale (WireGuard cifra). Per compliance: Tailscale Serve con cert LetsEncrypt OR self-signed con TOFU pinning hub-side. |
| **8** | Auto-update agent dall'hub | Endpoint agent `/admin/update` (token-protetto, scope `admin:update`) scarica tarball + verifica SHA256 + atomic swap + systemctl restart. Tabella `agent_releases` hub-side. |
| **9** | UI tenant per-tenant agents | Oggi `/tenants/[id]/agent` mostra solo il primo agent (back-compat). Trasformare in `/tenants/[id]/agents` con lista multi-agent. |
| **dep** | Rimuovere campi `tenants.agent_*` | Sono deprecati dalla migrazione. Lasciati per back-compat di route esistenti. Dopo 1-2 release di stabilità si possono droppare. |

## 9. Pull request e merge

- PR aperta: <https://github.com/grandir66/DA-IPAM/pull/2> — `feature/remote-agents` → `main`.
- **Non è ancora mergeata.** Riepilogo PR descrive il breaking change agent
  (drop `DA_INVENT_AGENT_TOKEN_HASH`). Hub NON ha breaking change.
- Quando si merge: verificare che lo script `npm run version:release` non
  rimbalzi su file mai versionati (`.claude/scheduled_tasks.lock` deve restare
  in `.gitignore`).

## 10. Pre-commit hook locale (non versionato)

`.git/hooks/pre-commit` installato manualmente per evitare drift
`openapi.json` quando si toccano endpoint agent. Contenuto:

```sh
#!/bin/sh
if git diff --cached --name-only | grep -qE '^agent/(da_invent_agent/|scripts/dump_openapi\.py)'; then
  agent/scripts/check_openapi_fresh.sh || {
    echo 'OpenAPI drift: rigenera con `python agent/scripts/dump_openapi.py`'
    exit 1
  }
fi
```

Quando si condividerà il branch con altri sviluppatori: creare
`agent/scripts/install-hooks.sh` versionato che fa il symlink (vedi memo
sessione 2026-05-11).

## 11. Pattern di codice da non rompere

In aggiunta a quanto in [CLAUDE.md](CLAUDE.md):

- **`getExecutor(tenantCode)` può throware `ExecutorNotConfiguredError`**
  per tenant remote non configurati. Chi lo chiama dentro un cron job
  deve **catchare** e degradare con grace (es. log + skip iteration),
  vedi pattern in `src/lib/scanner/discovery.ts:_exec`.
- **`safeDecrypt()`** se cerchi di leggere `agent_token_encrypted` (e in
  generale qualunque ciphertext): tornare null/error gracefully se la
  ENCRYPTION_KEY è cambiata.
- **Le route agent token** ritornano il plaintext **solo in response**, mai
  in DB. La response NON deve essere loggata.
- **Pydantic SecretStr** lato agent: usare per password/community/token —
  fa redact su repr() e log automatici.
- **Errori dall'agent**: hanno **error envelope uniforme** `{error: {code,
  message, retriable, details?}}`. `RemoteExecutor` lo traduce in
  `RemoteExecutorError` typed. I call site possono ispezionare `.retriable`.
- **OpenAPI freshness**: ogni modifica a endpoint/model in `agent/da_invent_agent/`
  o `agent/scripts/dump_openapi.py` richiede rigenerazione di `agent/openapi.json`.
  Il pre-commit lo blocca; CI lo bloccherà se aggiunto.

## 12. Variabili d'ambiente critiche

### Hub (.env.local su VM 533)

- `ENCRYPTION_KEY` — **non perdere**: senza, tutti i token encrypted
  diventano inutilizzabili (test connection ritorna `decrypt_failed`).
- `AUTH_SECRET` — NextAuth JWT signing key.
- `DOMARC_USERNAME` / `DOMARC_PASSWORD` — utente di servizio
  (incondizionato, vede tutti i tenant).

### Agent (/etc/da-invent-agent/config.yml su host cliente)

```yaml
tenant_code: "70791a"        # MUST match hub tenants.codice_cliente
hub_url: "https://192.168.4.8"
port: 8443
host: "0.0.0.0"               # bind, l'origin check filtra a CGNAT
dev_mode: false
log_level: "INFO"
tokens:
  - label: "hub-prod"
    token_hash: "$2b$12$..."  # bcrypt — generato in-process, mai shell concat
    scopes:
      - "exec:network"
      - "exec:device"
      - "admin:update"
```

`DA_INVENT_AGENT_*` env vars overridano YAML (per testing). Vedi
`agent/.env.example`.

## 13. Debug rapido — playbook

- **"Le scansioni non trovano porte"** → verificare in ordine:
  1. `tenants.agent_mode` del tenant è `'remote'`?
  2. `tenant_agents` ha una riga per il tenant con token configurato?
  3. Sull'host hub: `which nmap`. Se manca: `bash scripts/hub-install.sh`.
  4. Sull'host agent: `systemctl status da-invent-agent`. Log:
     `journalctl -u da-invent-agent -n 50`.
  5. Test diretto: `curl http://<agent-ip>:8443/whoami -H "Authorization: Bearer <token>"` dalla VM hub.
- **"Login non funziona"** →
  1. `[Auth] Rate limit raggiunto` nei log: `systemctl restart da-invent`.
  2. Hash corrotto: verificare con node `bcrypt.compareSync` (mai shell
     interpolation del `$`).
  3. JWT obsoleto (tenant nuovo non visibile): logout + login.
- **"Test connessione mostra `decrypt_failed`"** → ENCRYPTION_KEY è cambiata.
  Rigenera il token dall'UI (sovrascriverà il nuovo ciphertext).
- **"UDP scan non trova porte"** → controlla `/etc/sudoers.d/da-invent-agent`
  esiste e nmap ha `setcap cap_net_raw,cap_net_admin=eip`.


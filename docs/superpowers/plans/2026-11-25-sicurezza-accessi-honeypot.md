# Protezione delle installazioni di DA-IPAM: accessi chiusi, avvisi, esche — censimento e piano

> Riccardo, 25/11/2026: «vorrei che dall'UI si potesse gestire l'accesso al sistema impostando
> filtri sugli ip che possono collegarsi e le porte presentate. vorrei schede in cui le funzioni di
> sicurezza di IPAM sono chiare e modificabili» (A accessi, B honeypot). Poi, lo stesso giorno:
> «vorrei garantire che gli ipam installati non siano facilmente vulnerabili chiudendo ogni strada di
> accesso a chi non è autorizzato e fornendo anche sistemi di alert delle tentate violazioni» e
> «deve essere un sistema estremamente protetto, contiene troppe informazioni critiche».
> Sulle credenziali: non un gestore in più, ma dire in chiaro **quali punti deboli restano** nella
> loro conservazione, col rimedio.
>
> **Solo piano: niente codice applicativo finché Riccardo non approva** le domande della §9, la
> tavola (`docs/superpowers/tavole/2026-11-25-protezione.html`) e il livello.
> Ramo `feat/sicurezza-accessi-honeypot`, da `origin/dev`. Niente su `dev` prima del suo sì.
> Livello proposto: **Completo** (zona rossa: accesso, autenticazione, cifratura, appliance dei clienti).
> Il repo è pubblico: i punti deboli veri di una macchina vera non stanno in file versionati; si
> vedono a schermo nell'app e nel resoconto a Riccardo. Qui solo ciò che vale per ogni installazione.

## 0. Scopo e criterio

Proteggere **le installazioni** (le appliance dai clienti, non solo l'hub). Criterio di progetto:
**chiuso di serie**. Tutto è negato tranne ciò che è dichiarato ammesso: indirizzi, porte, utenti,
sistemi remoti. Dove oggi una cosa è aperta per comodità, sta nella tabella della §2 con la sua chiusura.
Ogni strada ha anche il suo **avviso** quando qualcuno ci prova.

Questo piano è lo strato «perimetro e avvisi». Lo strato «dati a riposo» è il **piano del 14/11**
(`TASKS.md`, «Piano di sicurezza: appliance autonoma»: P0-3 volume cifrato, P0-4 backup cifrati,
P1-5 servizio non root): non si ricopia, si cita, e la scheda «Stato della protezione» ne mostra l'avanzamento.

## 1. Cosa si protegge, da chi

Da proteggere: credenziali dei sistemi dei clienti · mappa della rete e inventario · vulnerabilità
trovate · gettoni verso Vulcan, DA-Link, Edge · il registro stesso.

| Chi attacca | Cosa c'è già | Cosa manca (questo piano, salvo nota) |
| --- | --- | --- |
| Uno nella rete del cliente | login con freno ai tentativi, seconda verifica possibile, rotte tutte censite con la loro guardia, SSH solo a chiave | filtro per indirizzo sulle porte (oggi le reti locali le vedono tutte), avviso sui tentativi, esche |
| Una macchina del cliente compromessa (ha un indirizzo «buono») | come sopra | elenchi stretti per gruppo di porte, limite di velocità, seconda verifica obbligatoria, «solo da questi indirizzi» per utente, esche e blocco |
| Chi ruba la VM o un suo backup | cifratura AES-256-GCM dei segreti nel database, vault locale a slot (ADR 0034) dove acceso | chiave sullo stesso disco finché non c'è il volume cifrato: **piano 14/11, P0-3 e P0-4**. Qui: dirlo a schermo |
| Un utente dell'app con pochi diritti | due ruoli, proiezioni per ruolo (P0-1), conferma per le azioni gravi | il terminale e le console dei moduli restano strade larghe: elenco per utente, registro che l'app non può riscrivere |
| Chi manomette l'aggiornamento | rilasci firmati, guardia «blocca» di serie (ADR 0039, 0040) | avviso quando una firma è rifiutata |
| Chi arriva da un canale di gestione (NetBird) | `inet dalink`: su `wt0` solo 22, 443 (6443 con l'edge), sorgenti dichiarabili | avviso su ciò che `inet dalink` scarta |

## 2. Tutte le strade d'ingresso di un'installazione

Com'è fatta un'appliance uscita dall'installatore (quello che è aperto su una macchina vera sta nelle
note fuori dal repo).

| Strada | Aperta a chi, di serie | Come si chiude | Avviso su |
| --- | --- | --- | --- |
| Pagina web e API (443, nginx in container) | ogni indirizzo che raggiunge la macchina | gruppo «Pagina web»: solo gli elenchi | login rifiutati e bloccati (già registrati), connessioni scartate |
| Rotte senza sessione: `health`, `version`, `setup`, `lock-state`, `passo-uno`, script d'installazione dell'agente | chiunque arrivi alla 443 | stesso filtro di rete; `setup` risponde solo finché non esiste un utente (da verificare alla fonte) | chiamate ripetute, `setup` chiamata dopo la prima configurazione |
| Rotte a gettone: consegna dell'inventario, collector, edge | chi ha un gettone, da qualunque indirizzo | gruppo «Ricezione dati»: indirizzi dei sistemi riconosciuti | gettone sbagliato, gettone giusto da indirizzo nuovo |
| Terminale SSH nel browser (`/ws/ssh`, fuori dal filtro di sessione delle pagine: guardia sua, da verificare alla fonte) | chi ha una sessione | elenco di chi può usarlo, conferma recente | ogni apertura |
| SSH (22) | ogni indirizzo; solo a chiave | gruppo «SSH»: solo canali di gestione | tentativi falliti (journal di sshd), accesso riuscito da indirizzo nuovo |
| Console dei moduli (una porta per modulo: Edge, LibreNMS, MeshCentral, Wazuh, Graylog, MDM) | ogni indirizzo | gruppo «Console dei moduli»: solo gli elenchi | connessioni scartate |
| Ricezione dati dei moduli (syslog, trap SNMP, NetFlow/sFlow, agenti) | ogni indirizzo | gruppo «Ricezione dati»: solo gli apparati dell'inventario e i sistemi riconosciuti | sorgente non in inventario |
| Porte interne (3001 di DA-IPAM, 8080 dell'Edge) | dipende da `DALINK_FW_PORTE_INTERNE` (nasce «aperte») | diventa «chiuse» di serie | connessioni scartate |
| NetBird / DA-Link (`wt0`) | ciò che ammette `inet dalink` | resta di DA-Link; sorgenti dichiarate | scarti su `wt0` |
| Aggiornamento automatico (timer, git) | esce verso l'origine; entra solo codice firmato | già chiuso (firma) | firma rifiutata |
| Uscite: DA-Link, Vulcan, Zabbix, DNS, feed | — | non si filtrano in questa tappa; elenco in «Sistemi remoti» | destinazione mai vista (tappa successiva) |
| Console della VM | chi ha il Proxmox | fuori dal perimetro: è la via di salvataggio | — |
| File sul disco (`.env.local`, database, chiavi, `.env` dei moduli) | root; l'app è root | piano 14/11 (P0-3, P1-5); qui: controllo dei permessi e riga in «Stato della protezione» | permessi cambiati |
| Credenziali dell'installatore | `ENCRYPTION_KEY` e `AUTH_SECRET` nascono casuali; primo avvio col codice (P0-2) | controllo che non restino password iniziali o di fabbrica dei moduli | — |

## 3. Cosa c'è già nel codice (censimento, `dev` a `6df040e7`)

| Area | Dove | Cosa fa oggi |
| --- | --- | --- |
| Utenti e ruoli | `users` in `db-schema.ts`, `auth.ts` | due ruoli (`admin`, `viewer`), account locali e account Domarc (DA-Auth), utenza di servizio |
| Freni al login | `auth.ts`, `src/lib/accesso/` | blocco dei tentativi con attesa crescente, password deboli rifiutate, seconda verifica (TOTP), codici di recupero, accesso d'emergenza monouso |
| Registro degli accessi | `accesso/registro-accessi.ts` | JSONL giornaliero in `<DATA_DIR>/audit/accessi-*.jsonl`, 400 giorni: riuscito, rifiutato, bloccato, emergenza, cambi alla seconda verifica |
| Firewall di NetBird | `scripts/dalink/firewall-wt0.sh`, `deploy/dalink-firewall.service`, `lib/dalink/porte-wt0.ts` | tabella nftables `inet dalink` sul **prerouting**: su `wt0` passano solo 22, 443 (e 6443 con l'edge); opzione «porte interne chiuse» (3001, 8080 solo dalla macchina e da Docker). Ha prova a vuoto (`--stampa`), `--applica`, `--togli`, prove in netns |
| Cosa esce | `lib/dalink/quadro.ts`, `/settings/cosa-esce` | elenco dei flussi in uscita verso Domarc (DA-Link, Vulcan, Zabbix) |
| Moduli | `lib/modules/registry.ts` | 12 moduli con stato e collegamento; **non** dichiara immagini né porte |
| Sistemi che chiamano | `vuln_scanners`, `tenant_agents`, `inventory_ingest_tokens`, `wazuh_agent` | gettoni di edge, agenti, inventario |
| Notifiche | `lib/notifications/` | email e webhook, immediata o riepilogo, per gravità (`dispatchNotification`) |
| Servizio | `deploy/da-invent.service` | l'app gira **come root** (serve a nmap); nginx in container termina il TLS e passa `X-Real-IP` |
| Interfaccia | `components/shared/console.tsx`, `forma-scheda.ts`, `come-si-usa.tsx`, `lib/menu/sezioni.ts` | mattoni, fila unica di schede, «Come si usa» |

| Credenziali dei sistemi | `credentials`, `host_credentials`, `device_credential_bindings`, `src/lib/credentials/`, `crypto.ts` | AES-256-GCM, chiave derivata da `ENCRYPTION_KEY` di `.env.local` (stesso disco) oppure chiave dei dati aperta dagli slot del vault locale (`DA_VAULT_LOCALE=1`, ADR 0034); maschere in uscita (`maschera.ts`) |
| Vault | `src/lib/vault/` | archivio locale, lettura da DA-Link (`dalink.ts`), esportazione KeePass, ricifra, recupero |
| Scarichi | `accesso/registro-scarichi.ts` | chi ha scaricato database o pacchetto |
| Rotte | `lib/permessi/rotte.ts`, `docs/auth-matrix.md` | ogni rotta censita con la sua guardia; una prova fallisce se una resta scoperta |
| Sessione | `auth.config.ts`, `accesso/sessione.ts` | 8 ore, revoca vera (uscita, ruolo, utente tolto) |
| Aggiornamento | `deploy/da-invent-update.*`, ADR 0039-0040 | timer, rilasci firmati, guardia «blocca» |

Colonne nel database con un segreto: una ventina fra istanza e hub, tutte col suffisso cifrato o
con l'impronta, **tranne tre nomi da verificare alla fonte** (`snmp_community`, `community_string`,
`api_token`: se sono in chiaro è una riga della scheda «Stato della protezione», non di questo file).

Non c'è niente di: filtro per indirizzo sulle reti locali, elenco delle porte presentate, avvisi sui
tentativi, esche, blocco di indirizzi, registro che l'app non possa riscrivere.

### Cosa vale per ogni appliance fatta come l'hub

- Le porte dei moduli sono **pubblicate da Docker** con un DNAT nel prerouting: **non passano da
  INPUT**, passano dal FORWARD. Una regola su INPUT o UFW non le filtra. `DOCKER-USER` c'è ed è vuota.
- NetBird mette un `accept` di `wt0` in cima alle catene di input che trova (pilota, 15/10): per
  questo `inet dalink` sta sul prerouting.
- IPv6 è acceso (solo link-local) e Docker ascolta anche su `[::]`.
- Lo Scanner-Edge è un container in rete `host` con `NET_ADMIN`/`NET_RAW`.

## 4. Architettura proposta

### 4.1 Dove si filtra: una tabella nostra sul prerouting

Una tabella nftables propria, `inet daipam_accessi`, con una catena sul **prerouting a priorità
mangle (−150)**, cioè **prima del DNAT di Docker**. Lì il pacchetto ha ancora la porta e l'indirizzo
veri: la stessa regola vale per le porte della macchina (22, 3001) e per quelle pubblicate dai
container (443, 6443…), in IPv4 e IPv6, senza toccare `DOCKER-USER`, iptables, UFW o NetBird.
È lo stesso schema di `inet dalink`, già provato sul campo. In nftables un `accept` non scavalca le
altre tabelle: la nostra **restringe soltanto**, non apre mai ciò che un'altra chiude.

Da verificare alla fonte nella tappa 2 (prova in netns con Docker vero, vista fallire prima):
che una regola a −150 veda la porta originale per le porte pubblicate; che il traffico fra container
e da container a macchina non passi di lì col verso sbagliato; cosa succede alle connessioni già
aperte quando si carica la tabella.

Forma della catena, sempre in quest'ordine (l'ordine è nel codice, non in configurazione):

1. `iifname "lo"`, bridge di Docker, connessioni già aperte o correlate → passano.
2. `iifname "wt0"` → passa: di NetBird si occupa `inet dalink`, che resta com'è.
3. ICMP, ICMPv6 (scoperta dei vicini compresa), DHCP → passano.
4. Indirizzi in **«sempre ammessi»** → passano (salvagente, vedi 4.3).
5. Indirizzi nel set **bloccati** (a tempo) → rifiuto o scarto, contato.
6. Per ogni **gruppo di porte** (Pagina web · SSH · Console dei moduli · Ricezione dati · Esche):
   sorgente nel set di quel gruppo → passa; altrimenti scarta e conta.
7. Porte che la macchina non presenta: non si toccano (le chiude già l'assenza di un servizio).

Le uscite non si filtrano (scansioni, DNS, aggiornamenti, Vulcan, Zabbix): nessun `notrack`,
conntrack non si tocca, il DNS di riserva e `/etc/hosts` restano fuori dal perimetro.

### 4.2 Chi applica: un esecutore con comandi chiusi

L'app oggi è root. Non le si dà comunque `nft` in mano: il confine si mette adesso così regge anche
il giorno in cui l'app girerà con un'utenza sua.

- `scripts/accessi/da-ipam-accessi` (bash, come `firewall-wt0.sh`), installato in `/usr/local/sbin`,
  di root, non scrivibile dall'app quando non sarà root. Comandi, e solo questi:
  `stato` · `anteprima` · `prova <secondi>` · `conferma` · `annulla` · `blocca <ip> <durata>` ·
  `sblocca <ip>` · `spegni`.
- Legge **un file di politica** scritto dall'app (`/etc/da-ipam/accessi.json`): solo indirizzi, reti,
  gruppi, durate. Ogni valore è validato da capo dall'esecutore (un indirizzo è un indirizzo, una
  porta sta nell'elenco chiuso dei gruppi); il file non si esegue mai. Le porte dei gruppi stanno
  **nel codice**, non nel file, come per le porte Wazuh in `firewall-wt0.sh`.
- Genera il ruleset, lo prova con `nft -c`, lo carica in modo atomico con `nft -f`, rilegge la tabella.
- Con l'utenza dedicata: una riga di sudoers per quel solo eseguibile, senza argomenti liberi.
- L'app lo chiama con `execFile` (mai una shell), e scrive ogni chiamata nel registro.

### 4.3 Non chiudersi fuori

- **Chiuso di serie, senza chiudere fuori chi c'è già**: un'installazione **nuova** nasce col filtro
  acceso e gli elenchi dichiarati dall'installatore (domanda 2). Un'installazione **esistente**
  riceve il filtro in **osserva** (regole caricate che contano e basta: «con queste regole, negli
  ultimi 7 giorni sarebbero rimasti fuori questi indirizzi») e la pagina dice «NON protetta» finché
  non si accende; non resta mai spento in silenzio.
- **Anteprima** prima di applicare: le differenze in parole («192.0.2.14 non aprirà più la pagina
  web») e gli indirizzi oggi collegati che resterebbero fuori.
- **Prova a tempo**: «Applica in prova» carica le regole e arma un timer di systemd (120 s) che
  rimette quelle di prima. Si conferma solo con una **richiesta nuova** arrivata dal browser dopo
  il caricamento: se la pagina non raggiunge più l'appliance, la conferma non arriva e torna tutto com'era.
- **Sempre ammessi, nel codice**: la macchina stessa, Docker, `wt0` (DA-Link e NetBird, cioè la via dei
  tecnici Domarc), l'indirizzo di chi sta applicando (aggiunto da sé e mostrato). In più un elenco
  «sempre ammessi» modificabile, che non può restare vuoto finché il filtro è acceso.
- **Console**: `da-ipam-accessi spegni` dalla console della VM (Proxmox) toglie la tabella. È scritto
  nel «Come si usa» e nella schermata di console dell'appliance.
- **Guasto del filtro**: se al riavvio il file non è valido o `nft` rifiuta, proposta: si carica la
  **politica minima nel codice** (solo NetBird/DA-Link e «sempre ammessi» dell'ultima politica
  buona, salvata a parte), la pagina dice «Filtro in emergenza» e parte un avviso. Non aperto a
  tutti (non sarebbe «estremamente protetto»), non chiuso del tutto (l'appliance sta dal cliente). Domanda 6.
- **Registro**: ogni cambio (chi, quando, da dove, cosa prima e cosa dopo, confermato o tornato
  indietro) in `<DATA_DIR>/audit/protezione-*.jsonl`, 400 giorni, visibile nella scheda 4.

### 4.4 Indirizzo vero di chi si collega

Due piani distinti, e la pagina li tiene distinti:

- **Rete** (chi arriva alla porta): lo decide nftables sull'indirizzo del pacchetto. Dietro un NAT o un
  proxy del cliente si vede l'indirizzo del NAT: la pagina lo dice.
- **Applicazione** (chi fa il login): l'app legge `X-Real-IP` **solo** se la richiesta arriva da nginx
  (macchina o bridge di Docker); da chiunque altro l'intestazione si ignora. Vale solo con le porte
  interne chiuse (3001 non raggiungibile da fuori): diventa un controllo d'ingresso della funzione.
- «Chi apre la pagina web» e «quali sistemi remoti ci parlano» sono **due elenchi diversi** (gruppi
  Pagina web e Ricezione dati): un collector o un agente ammesso a consegnare dati non per questo
  apre la pagina di login.

### 4.5 Esche (honeypot)

- Un servizio a parte, `da-ipam-esche.service`: utenza effimera (`DynamicUser`), nessuna capability,
  `NoNewPrivileges`, file di sistema in sola lettura, memoria e numero di connessioni limitati, nessun
  accesso ai dati di DA-IPAM. Ascolta **solo su 127.0.0.1 a porte alte**; la tabella porta lì le porte
  finte (redirect), così non serve nessun privilegio per le porte basse.
- **Poca interazione**: il banner, al più la richiesta di credenziali, poi chiude. Niente shell finta,
  niente file, niente esecuzione di ciò che arriva. Limite di byte e di secondi per connessione.
- **Cosa si registra**: quando, da quale indirizzo, su quale esca, quanti tentativi, il nome utente
  provato (troncato). **Mai la password**: solo lunghezza e un'impronta con chiave locale, per dire
  «la stessa di prima» senza poterla rileggere.
- **Nessun conflitto**: l'elenco delle esche possibili è chiuso, e una porta già usata da un servizio
  vero o riservata a un modulo (anche spento) non si può scegliere; il controllo guarda le porte in
  ascolto al momento. Se un modulo occupa poi quella porta, l'esca si spegne e avvisa.
- **I nostri scanner non sono intrusi**: mai contati IPAM stesso, lo Scanner-Edge, Vulcan, Zabbix e il
  suo proxy, le sonde e i collector registrati, LibreNMS; l'elenco «mai bloccati» nasce da quello che
  l'installazione conosce già e si può allungare. Le esche si dichiarano a Vulcan/Edge perché non
  finiscano fra le vulnerabilità dell'appliance.
- **Violazioni multiple → allerta → blocco**: soglie in pagina (proposta: 3 connessioni a esche in
  10 minuti = allerta; 2 esche diverse oppure 10 tentativi = blocco). Blocco a tempo che cresce
  (1 ora, 24 ore, 7 giorni), sblocco con un clic, «Non bloccare mai» dalla riga.
- **Indirizzi falsificati**: conta solo chi ha **completato la connessione TCP** con l'esca (un SYN
  con sorgente falsa non ci arriva). Niente blocchi da UDP. Tetto al numero di bloccati (set con
  scadenza e dimensione massima) e al ritmo dei nuovi blocchi: sopra il tetto si avvisa e basta.
  Gateway, DNS e i «sempre ammessi» non si bloccano mai.
- **Notifiche**: attraverso `dispatchNotification` (email e webhook già configurati), un evento per
  allerta e uno per blocco, col riepilogo giornaliero che c'è già. Verso Vulcan/SIEM: domanda 3.
- Parte in **solo allerta**; il blocco automatico si accende a parte.

### 4.6 «Traffico di contrasto»: solo difesa sul nostro lato

Proposta, in ordine di forza, tutto dentro l'appliance o la rete del cliente:

1. rifiuto o scarto delle connessioni dell'indirizzo bloccato;
2. **rallentamento** sulle esche (tarpit: si risponde un byte ogni tanto, chi scansiona resta appeso);
3. limite di velocità per sorgente sulle porte vere;
4. **isolamento** della porta dello switch o della VLAN dell'apparato, dove IPAM governa lo switch:
   proposto dalla pagina, eseguito solo dopo il clic di una persona;
5. segnalazione a Vulcan / SIEM / DA-Link.

**Non si progetta traffico verso la sorgente** (saturazione, exploit, scansioni di ritorsione).
L'indirizzo può essere falsificato o essere il PC compromesso di un cliente: si colpirebbe una vittima,
ed è un reato (accesso abusivo e danneggiamento, artt. 615-ter e 635-bis c.p.) anche se «ha
cominciato lui». Se per «contrasto» si intendeva altro, è la domanda 4.

### 4.7 Avvisi su tutte le strade, non solo sulle esche

Un solo raccoglitore di «tentativi», una sola tabella, una sola politica di avviso:

| Fonte | Evento | Da dove si legge |
| --- | --- | --- |
| Pagina web | login rifiutato, bloccato, seconda verifica sbagliata, accesso riuscito da indirizzo nuovo | registro accessi (c'è) |
| API | gettone sbagliato, rotta di amministrazione rifiutata, `setup` dopo la prima configurazione | guardie di `api-auth.ts` (da agganciare in un punto solo) |
| SSH | tentativo fallito, accesso riuscito da indirizzo nuovo | journal di sshd |
| Filtro di rete | connessione da indirizzo non ammesso (contata, con limite di ritmo) | contatori e log della tabella |
| NetBird | scarti di `inet dalink` | contatori della tabella |
| Esche | contatto, tentativo | servizio esche |
| Sistema | firma dell'aggiornamento rifiutata, permessi di un file segreto cambiati, filtro in emergenza | guardie esistenti, controllo periodico |

Soglie per fonte, stesso blocco a tempo delle esche (fail2ban non serve: è lo stesso set), avvisi con
`dispatchNotification`. **Registro che l'app non riscrive**: oltre al JSONL, ogni evento va al
journal di sistema e, dove c'è DA-Link o un SIEM, fuori dalla macchina; file del registro in sola
aggiunta (`chattr +a`, posto dall'esecutore). Chi prende l'app non cancella le proprie tracce.

### 4.8 Strati di difesa: cosa c'è, cosa manca, costo, priorità

| # | Strato | Oggi | Proposta | Costo | Priorità |
| --- | --- | --- | --- | --- | --- |
| 1 | Filtro di rete sull'host | solo `wt0` | tabella chiusa di serie (4.1-4.3) | 6 g | **1** |
| 2 | Avvisi sui tentativi | registro dei login, nessun avviso | 4.7 | 3 g | **1** |
| 3 | Porte interne | «aperte» di serie | «chiuse» di serie, anche sulle esistenti | 0,5 g | **1** |
| 4 | Seconda verifica | possibile, non obbligatoria | obbligatoria per gli admin (domanda 5) | 1 g | **2** |
| 5 | Sessioni | 8 ore | più corte per gli admin, conferma recente già presente per le azioni gravi (domanda 5) | 0,5 g | 2 |
| 6 | SSH | a chiave, da ogni indirizzo | solo dai canali di gestione (gruppo SSH) | nel punto 1 | **1** |
| 7 | Ruoli al minimo | admin, viewer | «solo da questi indirizzi» per utente; chi può usare terminale e console | 1,5 g | 2 |
| 8 | Registro non riscrivibile | JSONL scrivibile dall'app | 4.7 | 1 g | 2 |
| 9 | Esche e blocco | niente | 4.5 | 5 g | 3 |
| 10 | Servizio senza root, restrizioni di systemd | root | **piano 14/11, P1-5**; qui l'esecutore nasce già separato | là | là |
| 11 | Dati e backup cifrati, chiave non sullo stesso disco | chiave in `.env.local` o vault a slot | **piano 14/11, P0-3 e P0-4** | là | là |
| 12 | Aggiornamenti con origine verificata | fatto (ADR 0039-0040) | solo l'avviso | 0,2 g | 2 |

## 5. Le schede: cosa si vede, cosa si cambia, da dove viene

Sezione nuova «Protezione» (solo admin), nove schede in **una fila sola**, senza seconda fila e
senza riga di titolo; «Come si usa» in fondo alla fila. Indirizzi: `/protezione/<scheda>`.
In cima a ogni scheda la stessa `BarraStato`: filtro (osserva · acceso · emergenza), esche, tentativi di oggi.

| Scheda | Si vede | Si cambia | Dato |
| --- | --- | --- | --- |
| **Stato della protezione** | gli strati della 4.8 uno per riga: a posto o no, perché, rimedio; e le **debolezze che restano** nella conservazione delle credenziali, in parole semplici con gravità e rimedio (chiave sullo stesso disco, volume non cifrato, backup non cifrato o mai provato, segreti in chiaro in un file o in una colonna, permessi larghi su un file segreto, password iniziali rimaste, credenziali riusate su molti apparati, SNMP v1/v2c e telnet ancora usati, seconda verifica assente). Ogni riga è **calcolata sulla macchina**, non scritta a mano | il rimedio è un pulsante che porta dove si fa («Accendi il filtro», «Rendi obbligatoria la seconda verifica», «Apri il vault»); **Ricontrolla ora** | controlli in sola lettura: permessi dei file, stato del vault e del volume, conteggi sul database (mai valori), tabella caricata |
| **Porte presentate** (A1) | per scheda di rete: indirizzi; per porta in ascolto: protocollo, chi la tiene, modulo, da chi è raggiungibile oggi, connessioni viste | **da chi** (Solo gli elenchi · Nessuno; «Tutti» solo con conferma e resta segnato ▲) | `/proc/net`, `ss`, `docker ps`, `nft -j` |
| **Chi può collegarsi** (A2) | elenchi di indirizzi per gruppo (Pagina web · SSH · Console dei moduli · Ricezione dati), «Sempre ammessi», chi è collegato, chi resterebbe fuori | aggiungi/togli (IPv4, IPv6, nota, scadenza), **Anteprima**, **Applica in prova**, **Conferma** | `accessi.json`, contatori |
| **Utenti** (A3) | nome, ruolo, tipo, seconda verifica, ultimo accesso e da dove, blocchi, chi può usare terminale e console | «Solo da questi indirizzi»; il resto resta in Impostazioni › Utenti | `users`, registro |
| **Sistemi remoti** (A5) | chi ci parla e a chi parliamo: verso, indirizzo, porta, come si autentica, ultimo contatto; **non riconosciuti** | **Riconosci**, **Togli** | gettoni, `quadro.ts`, connessioni |
| **Moduli e container** (A6) | per modulo: container, immagine e versione, porte pubblicate/interne/rete host, permessi in più | si cambia in Porte presentate; qui **Vai alle porte** | `docker ps`/`inspect`, `registry.ts` esteso con le porte attese |
| **Esche** (B1) | finti servizi possibili, accesi, porta e scheda, contatti; perché una porta non è disponibile | **Accendi/Spegni**, schede di rete, rallentamento | elenco chiuso, servizio esche |
| **Tentativi e blocchi** (B2 + avvisi) | ogni tentativo da **tutte** le strade (4.7): fonte, indirizzo, apparato dell'inventario se noto, quanti, primo/ultimo, stato; i bloccati con scadenza | soglie per fonte, durata, **Blocca ora**, **Sblocca**, **Non bloccare mai**, **Proponi isolamento della porta**, a chi vanno gli avvisi | raccoglitore dei tentativi, set dei bloccati |
| **Registro accessi** (A4) | accessi riusciti, cambi alla protezione, scarichi, aperture del terminale; filtri | niente; **Scarica CSV** | `audit/*.jsonl`, journal |

Menu (`sezioni.ts`): sezione «Protezione» dopo «Rete», `per: "admin"`. `/settings/cosa-esce` resta
dov'è, «Sistemi remoti» ci rimanda. Daltonismo: ogni stato ha segno e forma oltre al fondo, con
legenda. Azioni come pulsanti con nome.

## 6. Tappe, in ordine di rischio

| # | Tappa | Fatto quando | Stima |
| --- | --- | --- | --- |
| 0 | Decisioni e ADR | ADR scritto, tavola approvata | 0,5 g |
| 1 | **Vedere**: Stato della protezione, Porte presentate, Moduli, Sistemi remoti, Utenti in sola lettura | le schede dicono il vero su laboratorio e hub; nessun comando che scrive; ogni riga di «Stato» ha la sua prova | 5 g |
| 2 | **Chiudere la rete**: esecutore, filtro, osserva, anteprima, prova a tempo, porte interne chiuse, SSH dai canali di gestione | prove in netns con Docker (viste fallire): porte pubblicate filtrate, moduli vivi, IPv6, ritorno automatico senza conferma, politica minima al guasto | 6,5 g |
| 3 | **Avvisare**: raccoglitore dei tentativi da pagina, API, SSH, filtro, sistema; registro non riscrivibile; Tentativi e blocchi, Registro | un login sbagliato, un gettone sbagliato, un SSH fallito e una connessione non ammessa generano ognuno il suo avviso | 4 g |
| 4 | **Stringere l'accesso**: seconda verifica obbligatoria, sessioni, «solo da questi indirizzi», chi usa terminale e console (secondo le risposte) | prove viste fallire; nessun utente esistente chiuso fuori (migrazione con avviso) | 3 g |
| 5 | **Esche e blocco**: servizio isolato, soglie, set a tempo, rallentamento, proposta di isolamento | scanner di prova bloccato; Edge e Zabbix no; nessuna password su disco; sorgente falsificata non blocca | 5 g |
| 6 | **Collaudo**: laboratorio (snapshot prima), hub 533 in osserva una settimana, poi acceso; installatore (Deploy-Appliance) che dichiara gli elenchi; manuale, `CONTEXT`, `CHANGELOG`, consuntivo | una settimana senza moduli rotti né falsi blocchi; sblocco da console provato davvero | 3 g + la settimana |

**Totale: circa 27 giornate di lavoro, 6 settimane di calendario** contando la settimana in osserva.
Fuori dal conto: volume cifrato, backup, servizio non root (piano 14/11). Le tappe 1 e 3 possono
andare in parallelo alla 2 (file diversi). Dopo la tappa 3 l'installazione è già chiusa e avvisa:
le tappe 4 e 5 alzano il livello.

## 7. Livello di controllo: Completo

Prova vista fallire per esecutore, filtro, lettura di `X-Real-IP`, raccoglitore, password delle
esche, blocco. Prove in netns sul modello di `prova-firewall-netns.sh`. Snapshot della VM prima di
ogni prova sul vero. Una revisione del ramo prima di `dev`. Resa a 1920 per ogni scheda. Cancello
completo una volta, prima di `dev`.

## 8. Rischi

- **Chiudersi fuori** dall'appliance di un cliente: §4.3.
- **Rompere un modulo**: syslog, trap, NetFlow, agenti arrivano da molti indirizzi: «Ricezione dati»
  si stringe solo dopo aver visto in osserva chi consegna davvero; l'elenco nasce dall'inventario.
- **Bloccare un cliente o noi stessi**: «mai bloccati», blocco automatico acceso a parte, solo TCP completato, tetti.
- **Troppi avvisi**: soglie per fonte e riepilogo giornaliero; un avviso che nessuno legge non protegge.
- **Docker cambia le sue catene**: per questo non ci si appoggia a `DOCKER-USER`.
- **Uso quotidiano del tecnico**: seconda verifica e accesso solo da NetBird pesano: domande 2 e 5.

## 9. Decisioni di Riccardo (25/11/2026)

Risposte alle nove domande, con le sue parole fra virgolette. Dove il testo delle sezioni sopra dice
altro, **vale questa sezione** (ADR 0041).

1. **Appliance già installate** («si»): ricevono il filtro in osserva e si accendono una per una, a mano.
2. **Installazioni nuove** («sempre osservazione, chiusura manuale»): nascono anche loro in **osserva**;
   nessuna chiusura automatica, mai. Chiude una persona, dalla pagina, dopo aver visto chi resterebbe
   fuori. Finché è in osserva la pagina dice «NON protetta». Corregge la 4.3 (non nasce più acceso).
3. **Sempre ammessi** («netbird/da-link poi proponiamo»): di serie solo NetBird/DA-Link. Altre reti si
   proporranno dopo, dai dati dell'osservazione. Avvisi: email e webhook; verso DA-Link/Vulcan da proporre.
4. **Contrasto** («difesa»): solo difesa sul nostro lato, come nella 4.6.
5. **Seconda verifica** («da abilitare opzionale, poi troveremo anche altri sistemi di autenticazione»):
   resta **facoltativa**, non si rende obbligatoria. «Stato della protezione» la segnala come debolezza
   col pulsante per accenderla. La tappa 4 si riduce; altri sistemi di autenticazione sono un lavoro
   futuro, da tenere aperto nel disegno. Sessione (8 ore) e SSH: non risposto, restano come sono; SSH
   si chiude con il gruppo «SSH» quando si accende il filtro.
6. **Guasto del filtro** («si»): politica minima nel codice (NetBird/DA-Link e ultimi «sempre ammessi») e avviso.
7. **Esche** («ip abilitabile separato o quello di ipam»): le esche possono stare su un **indirizzo
   separato**, che si abilita dalla scheda, oppure sull'indirizzo di IPAM. Letta così; da confermare.
   Conseguenze: l'indirizzo in più lo mette l'esecutore sulla scheda di rete scelta (comando chiuso in
   più, `indirizzo-esche`), si controlla prima che sia libero (ARP) e fuori dal DHCP; su quell'indirizzo
   **non c'è conflitto di porte** coi servizi veri, e ogni connessione è per definizione un tentativo.
   La domanda originale (blocco automatico di un indirizzo interno) resta senza risposta: vale la
   proposta prudente, **solo avviso e blocco a mano**.
8. **Quali esche** («quelli che proponi vanno bene anche pagina login finta»): Telnet 23, FTP 21, SMB 445,
   RDP 3389, MySQL 3306, SSH finto 2222, pagina di login finta 8081.
9. **Menu** («si»): sezione «Protezione» dopo «Rete», solo admin, nove schede.

Stima aggiornata: tappa 4 da 3 a 1,5 giornate, tappa 5 da 5 a 5,5 (indirizzo separato): **circa 26 giornate**.

## 10. Scostamenti in corso d'opera

- **Tappa 2, 25/11**: il file della politica è `/etc/da-ipam/accessi.conf` in forma `chiave=valore`, non
  `accessi.json`: l'esecutore è bash come `firewall-wt0.sh` e un file a righe si rilegge e si rivalida
  senza un interprete JSON. I comandi dell'esecutore sono `anteprima`, `minima`, `stato`, `osserva`,
  `prova`, `conferma`, `annulla`, `spegni`, `avvio` (`blocca`/`sblocca` arrivano con la tappa 5).
- La catena sta a priorità `mangle + 5`, subito prima di `inet dalink` (`mangle + 10`, letta sull'hub),
  non a `mangle` secca.
- Una porta diretta alla macchina fuori da ogni gruppo, a filtro acceso, non risponde (catena «altre»):
  in osserva finisce fra chi «resterebbe fuori», così si vede prima di chiudere.

## 11. Consuntivo al 26/11/2026 (il collaudo è in corso)

**Fatto** (in `dev`, 0.9.1361; laboratorio aggiornato): tappa 0 (ADR 0041); tappa 1, cinque schede in sola lettura;
tappa 2, esecutore, filtro e «Chi può collegarsi», provati sui pacchetti veri del laboratorio compreso un
riavvio; tappa 3, registro dei tentativi da pagina, SSH e filtro, con avvisi; tappa 4, «Solo da questi
indirizzi» per utente; tappa 5, esche e blocco a mano. Tappa 6: hub 533 in osservazione dal 26/11 con politica
vuota (snapshot `pre-filtro-osserva-20261126` su DA-PX-03), manuale, `CONTEXT.md`, scheda-mappa.

**Mancante**: la settimana di osservazione sull'hub e la sua accensione; la prova dei gesti dalla pagina da
parte di Riccardo (le schede sono state provate dallo script e sui pacchetti, non a schermo); modifica degli
elenchi da «Porte presentate»; conferma d'identità prima di «Applica in prova»; chiamate API rifiutate e
gettoni sbagliati fra i tentativi; registro in sola aggiunta e copia fuori dalla macchina; scheda «Registro
accessi»; chi può usare terminale e console dei moduli; indirizzo separato per le esche; proposta di isolamento
della porta dello switch; blocchi che sopravvivono al riavvio; IPv6 e UDP dei moduli provati sui pacchetti;
controlli di «Stato della protezione» su volume cifrato, backup, segreti nei file, password riusate.

**Scostamenti**: §10. In più: nessun blocco automatico e seconda verifica facoltativa (decisioni di Riccardo);
la tavola aveva nove schede, ne sono uscite otto («Registro accessi» non fatta, i suoi dati stanno in «Tentativi»
e nei file di audit). Tempo: sei tappe in due giorni di sessione contro 26 giornate stimate; la stima contava
verifiche a schermo e una revisione del ramo che non sono state fatte.

**Errori da non ripetere**: pubblicato su `dev` senza compilazione completa (25/11: appliance ferme alla versione
di prima per un'ora); dichiarato «arrivato» un aggiornamento guardando il commit e non la ripartenza del
servizio. Lezioni in `~/.claude/lezioni/DA-IPAM.md` e nel `CONTEXT.md`.

**Consigli**: prima di accendere il filtro su un'appliance di un cliente, una settimana di osservazione e
l'elenco «mai bloccati» con i nostri scanner; una revisione del ramo da parte di un'altra sessione (zona rossa,
non fatta); decidere l'aggiornamento di Next.js, segnalato come vulnerabile.

## 12. Parte D — Archivio delle credenziali con interfaccia tipo KeePass (26/11/2026, da approvare)

> Riccardo, 26/11: «integrato al database kdbx interno dovremmo registrare anche un sistema per archiviare in modo
> sicuro le credenziali in generale per dare una UI che gestisce. vorrei poter avere una UI per keepass con
> credenziali aggiuntive richieste per accedere al DB».
> **Solo piano e tavola** (`docs/superpowers/tavole/2026-11-26-archivio-credenziali.html`): niente codice prima del
> suo sì. Zona rossa (credenziali, cifratura): livello Completo.

### 12.1 Cosa c'è già (letto nel codice il 26/11)

| Pezzo | Dove | Stato |
| --- | --- | --- |
| Formato «vault Domarc v1»: KDBX 4 aperto da un key file, gruppi annidati dal percorso, campi protetti, storico di 10 versioni, un solo scrittore col lucchetto, scrittura atomica e copia di prima | `src/lib/vault/kdbx.ts` | **scritto e provato (prove incrociate con DA-Link), ma nessuno lo usa**: nessun modulo dell'app lo importa |
| Credenziali degli apparati | tabelle `credentials`, `host_credentials`… cifrate con `encrypt()` | in uso; le leggono scansioni e giri senza una persona davanti |
| Archivio a slot (chiave dei dati dentro slot cliente, Domarc, TPM) | `vault/archivio.ts`, `locale.ts` | dietro `DA_VAULT_LOCALE=1`, spento di serie; ADR 0034 lo dichiara superato dal vault semplice KDBX (27/10) |
| Hub: credenziali lette da DA-Link | `vault/dalink.ts` | dietro `DA_VAULT_DALINK=1`; la fonte è il `domarc.kdbx` di DA-Link, IPAM legge e scrive dalle sue rotte |
| «Mostra password» | `vault/mostra.ts` | chiede la seconda verifica dell'utente, vale 5 minuti, ogni lettura nel registro `vault_visualizzazioni` |
| «Esporta in KeePass» | `vault/keepass.ts` | solo esportazione, con passphrase del cliente più key file |
| Pagina | Impostazioni › Vault | stato, sblocco, registro, esportazione: **non** un'interfaccia per voci e gruppi |

Quindi **«database kdbx interno» nel codice non è univoco**: può essere il formato KDBX locale di `kdbx.ts` (pronto,
non usato), oppure il `domarc.kdbx` di DA-Link visto dall'hub. È la domanda D1.

### 12.2 Proposta

Una scheda nuova, **«Archivio»**, nella sezione Protezione:

- **Albero dei gruppi** a sinistra, **voci** al centro, **dettaglio** a destra: titolo, utente, segreto nascosto, URL,
  note, campi in più, allegati; cerca su titolo, utente, URL e note (mai sui segreti).
- **Aggiungi, modifica, sposta, elimina** (nel cestino, come KeePass); **storico** della voce con ripristino.
- **Mostra** e **Copia** a tempo (il valore torna nascosto dopo 30 secondi; la copia si prova a togliere dagli
  appunti dopo 30 secondi, dove il browser lo permette).
- **Registro di ogni lettura** (chi, quale voce, quale campo, quando, da dove), visibile nella scheda e non
  cancellabile dall'app.
- Credenziali «in generale»: non solo quelle di un apparato. Una voce può essere **legata** a un apparato
  dell'inventario, ma non è obbligatorio.
- **Generatore** di password e segnale per le voci deboli, vecchie o doppie (alimenta «Stato della protezione»).

### 12.3 «Credenziali aggiuntive per accedere al DB»: tre varianti

| Variante | Come si apre | Pro | Contro |
| --- | --- | --- | --- |
| **A. Password principale dell'archivio** | il KDBX è cifrato con key file **più** una password principale; chi apre la scrive | il file rubato con tutto il disco non si apre; è KeePass com'è | una password condivisa fra chi la conosce: nel registro si vede l'utente dell'app, ma il segreto è uno solo; se si perde serve il recupero |
| **B. Secondo fattore dell'utente** | l'archivio si apre col key file tenuto dalla macchina; a ogni apertura l'utente dà il suo codice (come «Mostra password» oggi) | nessun segreto nuovo, ognuno risponde del suo | a riposo protegge quanto il key file: chi ruba disco e key file apre |
| **C. Tutte e due (proposta)** | password principale per decifrare **e** codice dell'utente per ogni apertura | a riposo forte, e si sa chi ha aperto | due passi a ogni apertura; chi non ha la seconda verifica non entra |

In ogni variante: l'apertura è **separata dal login** dell'app; vale per quell'utente, in memoria del server, e si
**richiude da sola** (proposta: 10 minuti senza gesti, 60 al massimo, «Chiudi ora» sempre); la password principale e la
chiave non stanno mai sul disco né nel browser (niente cookie, niente `localStorage`); un riavvio richiude; i tentativi
sbagliati si contano, bloccano con attesa crescente e finiscono in «Tentativi e blocchi» con avviso, come le altre strade.

### 12.4 Punti da trattare in chiaro

- **Lavori automatici.** Scansioni e giri leggono oggi le credenziali degli apparati senza nessuno davanti. Con un
  archivio che si apre solo con una password scritta da una persona non potrebbero. Proposta: **due scomparti**.
  «Di servizio» resta com'è oggi (tabelle cifrate, o lo scomparto aperto dalla macchina) e lo usano i lavori;
  «Riservato» è l'archivio nuovo, chiuso finché una persona non lo apre, e i lavori non lo leggono mai. Una voce si
  sposta da uno all'altro con un gesto esplicito. È la domanda D3.
- **Chi scrive il file.** Un solo scrittore col lucchetto e scrittura atomica ci sono già in `kdbx.ts`; due persone
  sulla stessa voce: vince chi salva per primo, l'altra vede «è cambiata» (versione della voce), mai una
  sovrascrittura muta.
- **Rapporto con DA-Link.** Regola della fonte (02/11): le credenziali di macchine e clienti di Domarc stanno nel
  `domarc.kdbx` di DA-Link. Sull'**hub** un secondo archivio locale sarebbe un doppione che diverge: lì la scheda
  dovrebbe essere una finestra sul vault di DA-Link (le sue rotte hanno già lettura, scrittura con versione attesa,
  cancellazione). Sulle **appliance dei clienti** l'archivio è locale e del cliente. È la domanda D2.
- **Backup.** Il file KDBX è già cifrato: entra nel backup così com'è; il key file **no**, sta a parte (e nel
  recupero). Ripristino provato su un'altra macchina prima di dichiararlo fatto.
- **Niente segreti fuori posto.** Mai nei log, mai negli errori, nelle risposte delle API solo il campo chiesto e
  solo ad archivio aperto; elenco e ricerca non portano i valori protetti; nessun esempio vero nel repo pubblico.
- **Importare ed esportare.** Importa un `.kdbx` esistente (con la sua password, usata e dimenticata); l'esportazione
  è quella che c'è già.

### 12.5 Tappe

| # | Tappa | Fatto quando | Stima |
| --- | --- | --- | --- |
| D0 | Decisioni (D1-D6) e ADR | ADR scritto, tavola approvata | 0,5 g |
| D1 | Motore: apertura con le credenziali in più, richiusura a tempo, tentativi contati, registro delle letture | prove viste fallire: archivio chiuso non dà niente, la chiave non è su disco, il tempo richiude | 4 g |
| D2 | Scheda in sola lettura: albero, voci, dettaglio, cerca, Mostra/Copia a tempo | a 1920 sul laboratorio, con un archivio di prova | 3 g |
| D3 | Scrittura: aggiungi, modifica, sposta, cestino, storico, conflitti | due sessioni sulla stessa voce non si sovrascrivono | 3 g |
| D4 | Importazione, generatore, voci deboli in «Stato della protezione», legame con gli apparati | importato un `.kdbx` di KeePassXC e riaperto là | 2,5 g |
| D5 | Hub: finestra sul vault di DA-Link (se D2 dice così) | lettura e scrittura provate contro DA-Link di prova | 3 g |
| D6 | Collaudo, backup e ripristino, manuale | ripristino su un'altra macchina | 2 g |

**Totale: circa 18 giornate** (15 senza la tappa D5).

### 12.6 Domande a Riccardo

- **D1.** «Database kdbx interno»: intendi un archivio KDBX locale a ogni installazione di IPAM, o il `domarc.kdbx` di DA-Link?
- **D2.** Sull'hub: la scheda è una finestra sul vault di DA-Link (nessun secondo archivio), e sulle appliance dei clienti l'archivio è locale?
- **D3.** Due scomparti («Di servizio» per i lavori automatici, «Riservato» chiuso finché una persona non lo apre): va bene, o le credenziali degli apparati devono entrare anche loro nell'archivio chiuso?
- **D4.** Credenziali in più per aprire: A (password principale), B (codice dell'utente), C (tutte e due, proposta)?
- **D5.** Richiusura: 10 minuti senza gesti e 60 al massimo vanno bene?
- **D6.** Chi può aprirlo: solo gli amministratori, o un ruolo a parte («custode») diverso da admin?

### 12.7 Decisioni di Riccardo (26/11/2026)

Parole sue: «un kdbx a disposizione degli utenti finali, slegato da quello di uso di ipam» e «una password
principale e un 2fa per accedere personale e una registrazione degli accessi». Dove le sezioni sopra dicono altro,
**vale questa**.

- **D1, D2.** Un archivio KDBX **locale all'installazione**, per gli **utenti finali** (le persone del cliente), **slegato**
  dalle credenziali che IPAM usa per lavorare. Non è una finestra sul vault di DA-Link e non tocca `credentials`,
  `host_credentials` né il `domarc.kdbx`. Cade la tappa D5 (hub su DA-Link).
- **D3.** Niente due scomparti: le credenziali degli apparati restano dove sono e i lavori automatici continuano a
  leggerle come oggi. L'archivio contiene solo ciò che ci mettono le persone; i lavori non lo leggono mai. Cade
  anche il legame obbligato con gli apparati (resta un campo facoltativo, da decidere se serve).
- **D4.** Variante **C**: **password principale** dell'archivio **più secondo fattore personale** (il codice a 6 cifre
  dell'utente) a ogni apertura, e **registro degli accessi** (aperture, chiusure, tentativi falliti, letture delle voci).
- **D5, D6: non risposto.** Valgono le proposte finché non dice altro: richiusura dopo 10 minuti senza gesti e 60 al
  massimo; lo aprono gli utenti che un amministratore abilita uno per uno («può usare l'archivio»), e solo se hanno
  la seconda verifica accesa. Da confermare, perché «utenti finali» può voler dire anche chi oggi è in sola lettura.
- Conseguenza da dire a schermo: la password principale è **una per l'archivio**, condivisa fra chi lo usa; il
  secondo fattore e il registro dicono **chi** ha aperto. Se si perde la password principale l'archivio non si apre:
  serve una procedura di recupero decisa prima (proposta: una chiave di recupero stampata alla creazione, da tenere
  in busta; nessuna copia a Domarc, perché è l'archivio del cliente).

Tappe aggiornate: D0 (ADR) · D1 motore (4 g) · D2 scheda in lettura (3 g) · D3 scrittura (3 g) · D4 importazione,
generatore, voci deboli (2 g) · D6 collaudo, backup e ripristino, manuale (2 g). **Totale: circa 14,5 giornate.**

### 12.8 Seconde decisioni di Riccardo (26/11/2026) e la copia cifrata

Parole sue: «richiusura automatica sì certo»; «solo utenti con una autorizzazione specifica non necessariamente
admin»; «il recupero con il superadmin che può resettare l'utenza»; «vorrei trovare un sistema per avere una copia
cifrata sicura dell'archivio».

- **Richiusura automatica**: sì (10 minuti senza gesti, 60 al massimo).
- **Chi lo apre**: chi ha un'**autorizzazione specifica** («può usare l'archivio»), data utente per utente; non
  dipende dal ruolo, un utente in sola lettura può averla e un admin può non averla.
- **Recupero dal superadmin**: perché «resettare l'utenza» ridia davvero l'accesso, la password principale non può
  essere una sola condivisa (nessuno potrebbe ridarla a chi l'ha persa senza conoscerla). Proposta, **da confermare**:
  **una serratura per utente**. L'archivio è cifrato con una chiave sua, casuale, che non sta mai in chiaro sul
  disco; ogni utente autorizzato ha la propria **password principale personale**, che apre la sua serratura (la
  chiave dell'archivio cifrata con la sua password, Argon2id). Il superadmin ha la sua serratura: «Reimposta
  l'accesso di…» apre con la propria e ne scrive una nuova per l'utente, con una password provvisoria da cambiare
  al primo uso, e gli azzera il secondo fattore. Togliere l'autorizzazione = cancellare la serratura. Nessun segreto
  condiviso, e il registro dice chi ha aperto con certezza.
  Limite da dire a schermo: **se tutte le serrature si perdono, l'archivio non si apre più**. Per questo la copia qui sotto.
- **Copia cifrata sicura dell'archivio** (proposta, da decidere):

| Variante | Come | Pro | Contro |
| --- | --- | --- | --- |
| **1. Copia automatica verso una chiave pubblica di recupero (proposta)** | ogni notte, e dopo ogni modifica, l'archivio viene copiato cifrato verso una chiave **pubblica**; la privata viene mostrata **una volta sola** alla creazione, da stampare e tenere fuori dalla macchina | sulla macchina non c'è niente che apra la copia; si fa da sola; chi ruba macchina e copie non legge | chi perde la chiave privata perde la copia; il ripristino va provato almeno una volta |
| 2. «Scarica una copia» a mano | un file `.kdbx` standard, cifrato con una frase scelta in quel momento, che KeePassXC apre ovunque | indipendente da IPAM; semplice da capire | dipende da qualcuno che si ricordi di farla; la frase scelta può essere debole |
| 3. Dentro il backup notturno dell'installazione | l'archivio entra nel backup cifrato che c'è già | nessun meccanismo nuovo | la chiave di quel backup sta nel vault della stessa macchina: non regge al furto di tutto |

  Proposta: **1 e 2 insieme**. Le copie tengono le ultime 30 versioni; stanno sulla macchina fuori dalla cartella dati
  e, se si vuole, anche fuori dalla macchina (una cartella di rete del cliente, il PBS, DA-Link). Ogni copia e ogni
  scaricamento vanno nel registro. In «Stato della protezione» una riga dice quando è stata fatta l'ultima copia e
  se un ripristino è mai stato provato.

Domande rimaste:

- **D7.** Password principale **personale** con una serratura per utente, così il superadmin può ridare l'accesso: è questo che intendi?
- **D8.** La copia cifrata: solo sulla macchina, o anche fuori (cartella di rete del cliente, PBS, DA-Link)?
- **D9.** La chiave privata di recupero la tiene solo il cliente, o una seconda copia anche Domarc?

## 13. Parte E — Disco cifrato con TPM virtuale (26/11/2026, da approvare)

> Riccardo, 26/11: «sugli ipam sicuramente servirebbe un disco cifrato con tpm virtuale nel caso», e subito dopo
> «almeno per il db delle password». **Solo piano**: nessuna macchina toccata prima del suo sì. Zona rossa, livello Completo.

### 13.1 C'è già, ed è provato: è il passo P0-3 del piano del 14/11

Letto nel codice e verificato sulle macchine il 26/11 (sola lettura):

| Cosa | Stato |
| --- | --- |
| `scripts/volume-cifrato.sh`: la cartella dati in un contenitore **LUKS2** a file, sblocco all'avvio col **TPM virtuale** (`systemd-cryptenroll`), oppure chiave su supporto esterno, oppure frase a mano | scritto il 15/11 |
| Dentro il volume: i database (quindi **tutte le credenziali dei sistemi**), il vault, e **`.env.local` con la chiave che le cifra** | così com'è disegnato |
| Freno: a volume chiuso l'app non parte e non crea database nuovi in chiaro | provato, visto fallire |
| Recupero: la passphrase del vault apre sempre; in più una chiave di recupero cifrata verso la chiave pubblica Domarc | scritto; il recupero con la chiave Domarc **non provato** (la privata è solo di Riccardo) |
| **Appliance di laboratorio** (`79993-ipam-2`): volume cifrato in uso dal 15/11, 3 serrature, TPM sì, `tpmstate0` sullo stesso storage della VM | in uso; ha retto anche il riavvio del 25/11 |
| **Hub** (VM 533): nessun TPM virtuale, BIOS tradizionale, nessun volume cifrato, 35 GB di dati | non fatto |
| Appliance dei clienti | non fatto: l'installatore non mette ancora i pacchetti né lancia lo script |

Prove fatte nel pilota del 15/11: riavvio completo (si apre da solo); TPM tolto (volume chiuso, app ferma, niente in
chiaro); aperto a mano con la passphrase; VM copiata **col suo TPM** (si apre da sola) e **con un TPM nuovo** (resta chiusa).

### 13.2 «Almeno il db delle password»: i due gradini

Nel codice le password dei sistemi non stanno in un file a sé: stanno **dentro i database SQLite** (`credentials`,
`host_credentials`, i gettoni dei moduli), cifrate con la chiave di `.env.local`. Cifrare «solo il kdbx» lasciando
accanto in chiaro quella chiave e i database non proteggerebbe niente.

| Gradino | Cosa cifra | Costo | Rischio |
| --- | --- | --- | --- |
| **1. Cartella dati** (com'è già fatto) | database, vault, futuro archivio KDBX, `.env.local` | pronto; da portare sulle macchine | fermo di qualche minuto alla conversione; se si perde il TPM serve la passphrase o il recupero |
| **2. Tutto il disco** | anche sistema, registri, file dei container, swap | reinstallazione o conversione della radice, sblocco nell'initramfs; va rifatta l'immagine | un errore lascia la macchina che non parte; più lavoro in Deploy-Appliance |

Il gradino 1 è il minimo che ha senso ed è già il disegno approvato il 15/11. Fuori dal gradino 1 restano in chiaro: i
registri di sistema, i file `.env` dei container dei moduli, la memoria di scambio. Da misurare prima di dire
che basta: cosa c'è di riservato in quei posti (va nella scheda «Stato della protezione», non in questo file).

### 13.3 Da cosa protegge e da cosa no

Il TPM virtuale di Proxmox è un file di stato (`tpmstate0`) che sta **sullo storage dello stesso nodo**, accanto al
disco della VM, e **finisce negli snapshot e nei backup della VM**.

- **Protegge**: il disco preso da solo (un disco dismesso o rubato senza lo stato del TPM), il contenitore o la
  cartella dati copiati da soli, un backup dei soli dati, chi monta il disco su un'altra macchina.
- **Non protegge**: chi copia la VM **insieme** al suo stato TPM (un backup completo, una replica, un clone a VM
  spenta), chi ha root sul nodo Proxmox, chi entra nella macchina accesa (il volume è aperto), uno snapshot con la RAM
  (dentro c'è la chiave). L'ha già mostrato il pilota: la copia col TPM si apre da sola.
- Oggi il TPM è legato **senza registri PCR** (`--tpm2-pcrs=` vuoto): basta lo stato del TPM, non conta come è
  partita la macchina.

Varianti per stringere, con il loro costo:

| Variante | Cosa aggiunge | Costo |
| --- | --- | --- |
| **Backup cifrati lato PBS con chiave separata** | un backup rubato non si legge, anche se dentro c'è lo stato del TPM | poco: una chiave per datastore, custodita fuori dal nodo; **consigliata** |
| Legame ai PCR con Secure Boot | la chiave esce solo se la macchina parte col suo avvio firmato | UEFI e Secure Boot su ogni VM (l'hub ha il BIOS tradizionale: va convertito); a ogni aggiornamento del kernel o dell'avvio si rischia di dover riagganciare |
| Sblocco da rete (tang/clevis) | la VM rubata con tutto si apre solo dentro la rete giusta | un servizio in più da tenere vivo per sede; se è giù la macchina non parte; dal cliente serve sulla sua rete |
| Frase a mano a ogni avvio (c'è già: `--sblocco frase`) | niente si apre senza una persona | ogni riavvio vuole qualcuno; gli aggiornamenti notturni restano fermi |

### 13.4 Cosa succede in esercizio

- **Avvio**: si apre da solo col TPM; se non si apre l'app non parte e lo dice.
- **Migrazione fra nodi**: lo stato del TPM viaggia con la VM (storage condiviso o replica): provato solo come copia a VM spenta.
- **Ripristino da backup completo**: riporta anche il TPM, quindi si apre. Non provato da un file `vzdump`.
- **Snapshot**: comprendono lo stato del TPM; quelli con la RAM contengono la chiave: da evitare.
- **Clone**: Proxmox non copia il TPM di una VM accesa; il clone resta chiuso finché non si apre con la passphrase e si riaggancia.
- **TPM perso o macchina spostata senza stato**: `apri` con la passphrase, poi riaggancio (oggi a mano: va fatto il comando).
- **Prestazioni**: non misurate. Da misurare sul laboratorio (una scansione e un giro completi, con e senza) prima di toccare l'hub.
- **Dimensione**: il contenitore nasce da 20 GB; l'hub ha 35 GB di dati. La crescita del contenitore **non è provata**.

### 13.5 Chiave di recupero

Due vie già scritte: la passphrase del vault e la chiave di recupero cifrata verso Domarc. Proposta: la passphrase
di ogni installazione nel KeePass `domarc.kdbx` su DA-Link (voce per nodo), una copia in busta al cliente; il recupero
con la chiave Domarc **provato una volta da Riccardo** prima di contare su di lui.

### 13.6 Tappe

| # | Tappa | Fatto quando | Stima |
| --- | --- | --- | --- |
| E0 | Decisioni (E1-E5) | risposte scritte | 0,5 g |
| E1 | Completare ciò che manca al gradino 1: comando di riaggancio a un TPM nuovo, riga «Volume cifrato» in «Stato della protezione», crescita del contenitore, misura delle prestazioni | provati sul laboratorio, crescita oltre 20 GB compresa | 3 g |
| E2 | Installazioni nuove: Deploy-Appliance mette i pacchetti, crea la VM con `tpmstate0`, lancia `volume-cifrato.sh crea` al primo avvio | un'appliance nuova nasce col volume cifrato | 3 g (in quel repo) |
| E3 | Hub: TPM virtuale alla VM 533, contenitore adeguato, conversione con snapshot e backup prima | hub su volume cifrato, riavvio provato | 1,5 g, fermo stimato 20-30 minuti |
| E4 | Appliance già dai clienti: conversione sul posto, una alla volta, backup verificato prima | ognuna convertita e riavviata | 0,5 g l'una |
| E5 | Backup cifrati lato PBS con chiave separata; ripristino da file provato | un ripristino vero su un'altra macchina | 2 g |

**Totale: circa 10 giornate**, più mezza per ogni appliance da convertire.

### 13.7 Domande a Riccardo

- **E1.** «Nel caso»: lo vuoi **subito** come difesa di serie, o solo dove serve (in caso di furto, su richiesta)? Cambia la priorità rispetto alle parti A-D.
- **E2.** Gradino 1 (cartella dati: database, vault, chiave) adesso, e tutto il disco solo dopo, se serve: va bene?
- **E3.** Hub: lo converto (fermo di 20-30 minuti, snapshot e backup prima)?
- **E4.** Appliance già dai clienti: conversione sul posto una alla volta, o solo alla prossima reinstallazione?
- **E5.** Oltre al TPM: aggiungo i backup cifrati lato PBS con chiave separata (consigliato)? Legame a Secure Boot e sblocco da rete li lascerei fuori per ora.

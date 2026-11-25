# Protezione dell'appliance: accessi ed esche — censimento e piano

> Riccardo, 25/11/2026: «vorrei che dall'UI si potesse gestire l'accesso al sistema impostando
> filtri sugli ip che possono collegarsi e le porte presentate. vorrei schede in cui le funzioni di
> sicurezza di IPAM sono chiare e modificabili»: A) gestione degli accessi (1 IP e porte presentate,
> 2 IP che possono accedere, 3 utenti, 4 log degli accessi, 5 sistemi remoti che parlano, 6 immagini
> interne con le porte, tutti i moduli); B) honeypot (1 finti servizi, 2 log di chi si collega, alert
> su violazioni multiple, ban, «traffico di contrasto»).
>
> **Solo piano: niente codice applicativo finché Riccardo non approva** le domande della §7, la
> tavola (`docs/superpowers/tavole/2026-11-25-protezione.html`) e il livello.
> Ramo `feat/sicurezza-accessi-honeypot`, da `origin/dev`. Niente su `dev` prima del suo sì.
> Livello proposto: **Completo** (zona rossa: accesso, autenticazione, appliance dei clienti).
> Il repo è pubblico: il censimento della macchina vera (porte, indirizzi, cosa oggi è aperto) sta
> fuori da git, nelle note della sessione; qui solo ciò che vale per ogni installazione.

## 1. Censimento (25/11/2026, `dev` a `6df040e7`)

### Cosa c'è già nel codice

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

Non c'è niente di: filtro sugli indirizzi per le reti locali, elenco delle porte presentate, esche, blocco
di indirizzi, fail2ban.

### Cosa si è visto sulla macchina (in generale, vale per le appliance fatte come l'hub)

- Le porte dei moduli sono **pubblicate da Docker** (nginx: 80, 443 e una porta per modulo). Docker le
  inoltra con un DNAT nel prerouting: **non passano dalla catena INPUT**, passano dal FORWARD. Una
  regola su INPUT (o UFW) non le filtra. La catena `DOCKER-USER` c'è ed è vuota.
- Sulle reti locali non c'è un filtro per indirizzo sorgente; il solo filtro vero è quello su `wt0`.
- NetBird mette un `accept` di `wt0` in cima alle catene di input che trova (visto sul pilota il 15/10):
  per questo `inet dalink` sta sul prerouting.
- IPv6 è acceso (solo link-local), e Docker ascolta anche su `[::]`.
- Lo Scanner-Edge è un container in rete `host` con `NET_ADMIN`/`NET_RAW`: le sue scansioni escono
  dalla macchina stessa.

## 2. Architettura proposta

### 2.1 Dove si filtra: una tabella nostra sul prerouting

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
4. Indirizzi in **«sempre ammessi»** → passano (salvagente, vedi 2.3).
5. Indirizzi nel set **bloccati** (a tempo) → rifiuto o scarto, contato.
6. Per ogni **gruppo di porte** (Pagina web · SSH · Console dei moduli · Ricezione dati · Esche):
   sorgente nel set di quel gruppo → passa; altrimenti scarta e conta.
7. Porte che la macchina non presenta: non si toccano (le chiude già l'assenza di un servizio).

Le uscite non si filtrano (scansioni, DNS, aggiornamenti, Vulcan, Zabbix): nessun `notrack`,
conntrack non si tocca, il DNS di riserva e `/etc/hosts` restano fuori dal perimetro.

### 2.2 Chi applica: un esecutore con comandi chiusi

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

### 2.3 Non chiudersi fuori

- **Nasce spento**, su ogni installazione, anche dopo l'aggiornamento. Tre stati: spento → **osserva**
  (regole caricate che contano e basta: «con queste regole, negli ultimi 7 giorni sarebbero rimasti
  fuori questi indirizzi») → acceso.
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
- **Guasto = aperto, e lo dice**: se al riavvio il file non è valido o `nft` rifiuta, la tabella non
  si carica, la pagina mostra «Filtro NON attivo» e parte una notifica. Scelta proposta perché una
  appliance chiusa fuori sta dal cliente; se Riccardo preferisce il contrario è la domanda 6.
- **Registro**: ogni cambio (chi, quando, da dove, cosa prima e cosa dopo, confermato o tornato
  indietro) in `<DATA_DIR>/audit/protezione-*.jsonl`, 400 giorni, visibile nella scheda 4.

### 2.4 Indirizzo vero di chi si collega

Due piani distinti, e la pagina li tiene distinti:

- **Rete** (chi arriva alla porta): lo decide nftables sull'indirizzo del pacchetto. Dietro un NAT o un
  proxy del cliente si vede l'indirizzo del NAT: la pagina lo dice.
- **Applicazione** (chi fa il login): l'app legge `X-Real-IP` **solo** se la richiesta arriva da nginx
  (macchina o bridge di Docker); da chiunque altro l'intestazione si ignora. Vale solo con le porte
  interne chiuse (3001 non raggiungibile da fuori): diventa un controllo d'ingresso della funzione.
- «Chi apre la pagina web» e «quali sistemi remoti ci parlano» sono **due elenchi diversi** (gruppi
  Pagina web e Ricezione dati): un collector o un agente ammesso a consegnare dati non per questo
  apre la pagina di login.

### 2.5 Esche (honeypot)

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
  allerta e uno per blocco, col riepilogo giornaliero che c'è già. Verso Vulcan/SIEM: domanda 4.
- Parte in **solo allerta**; il blocco automatico si accende a parte.

### 2.6 «Traffico di contrasto»: solo difesa sul nostro lato

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
cominciato lui». Se per «contrasto» si intendeva altro, è la domanda 3.

## 3. Le schede: cosa si vede, cosa si cambia, da dove viene

Una sezione nuova «Protezione» (solo admin), otto schede in **una fila sola**, senza seconda fila e
senza riga di titolo; «Come si usa» in fondo alla fila. Indirizzi: `/protezione/<scheda>`.
In cima a ogni scheda la stessa `BarraStato`: Filtro spento · osserva · acceso, e Esche spente · accese.

| # | Scheda | Si vede | Si cambia | Dato |
| --- | --- | --- | --- | --- |
| A1 | **Porte presentate** | per ogni scheda di rete: indirizzi; per ogni porta in ascolto: protocollo, chi la tiene (servizio o modulo), su quali schede, da chi è raggiungibile oggi (tutti · elenco · solo macchina), connessioni viste | il gruppo a cui la porta appartiene è fisso; si sceglie **da chi** (Tutti · Solo gli elenchi · Nessuno) per scheda di rete | `/proc/net`, `ss`, `docker ps`, tabella caricata (`nft -j`) |
| A2 | **Chi può collegarsi** | gli elenchi di indirizzi per gruppo di porte (Pagina web · SSH · Console dei moduli · Ricezione dati), «Sempre ammessi», chi è collegato adesso, chi resterebbe fuori | aggiungi/togli indirizzo o rete (IPv4, IPv6, nota, scadenza), **Anteprima**, **Applica in prova**, **Conferma**, **Spegni il filtro** | `accessi.json`, contatori della tabella |
| A3 | **Utenti** | chi può entrare: nome, ruolo, tipo (locale · Domarc · servizio · emergenza), seconda verifica, ultimo accesso e da dove, blocchi in corso | «Solo da questi indirizzi» per utente; il resto (crea, ruolo, password) resta in Impostazioni › Utenti, con un pulsante che ci porta | `users`, registro accessi |
| A4 | **Registro accessi** | una tabella sola: login riusciti/rifiutati/bloccati, SSH, connessioni scartate dal filtro, cambi alla protezione; filtri per tipo, indirizzo, utente, periodo | niente (sola lettura); **Scarica CSV** | `audit/accessi-*.jsonl`, `audit/protezione-*.jsonl`, journal di sshd, contatori |
| A5 | **Sistemi remoti** | chi ci parla e a chi parliamo: sistema, verso (entra · esce), indirizzo, porta, come si autentica, ultimo contatto; segnati quelli **non riconosciuti** | **Riconosci** (dà un nome e lo mette nell'elenco giusto), **Togli**; le uscite verso Domarc restano spiegate in «Cosa esce» | gettoni (`vuln_scanners`, `tenant_agents`, `inventory_ingest_tokens`), `quadro.ts`, connessioni aperte |
| A6 | **Moduli e container** | per modulo: container, immagine e versione, porte pubblicate/solo interne/rete host, capability in più, da chi è raggiungibile | la raggiungibilità si cambia in A1/A2 (un posto solo); qui **Vai alla porta** | `docker ps`/`inspect`, `registry.ts` (da estendere con le porte attese) |
| B1 | **Esche** | i finti servizi possibili, quali sono accesi, su quale porta e scheda, contatti delle ultime 24 ore; perché una porta non è disponibile | **Accendi/Spegni** per esca, su quali schede di rete, rallentamento sì/no | elenco chiuso nel codice, stato del servizio esche |
| B2 | **Intrusioni e blocchi** | chi ha toccato un'esca: indirizzo (e apparato dell'inventario, se noto), esche toccate, tentativi, primo/ultimo; allerte; bloccati con scadenza | soglie, durata, **Blocca ora**, **Sblocca**, **Non bloccare mai**, **Proponi isolamento della porta**; blocco automatico sì/no | eventi del servizio esche, set dei bloccati, inventario |

Menu (`sezioni.ts`): sezione «Protezione» dopo «Rete», `per: "admin"`, stacco fra A6 e B1 coi nomi di
gruppo «Accessi» ed «Esche». `/settings/cosa-esce` resta dov'è, A5 ci rimanda.

Daltonismo: ogni stato ha segno e forma oltre al fondo (● aperta a tutti, ◐ solo elenchi, ○ chiusa,
▲ non riconosciuto, ■ bloccato), con legenda. Azioni come pulsanti con nome.

## 4. Tappe

| # | Tappa | Fatto quando | Stima |
| --- | --- | --- | --- |
| 0 | Decisioni e ADR (risposte §7, ADR «filtro sul prerouting, esecutore chiuso, guasto = aperto») | ADR scritto, tavola approvata | 0,5 g |
| 1 | **Sola lettura**: schede A1, A3, A4, A5, A6 senza modifiche al sistema; menu, guida | le cinque schede mostrano il vero su laboratorio e hub; nessun comando che scrive | 4 g |
| 2 | **Esecutore e filtro**: `da-ipam-accessi`, politica, stato «osserva», anteprima, prova a tempo, registro; A2 e modifica in A1 | prove in netns con Docker (viste fallire): porte pubblicate filtrate, moduli vivi, IPv6, ritorno automatico senza conferma; `nft -c` verde | 6 g |
| 3 | **Esche, solo allerta**: servizio isolato, B1, B2 in lettura, notifiche, esclusione dei nostri scanner | uno scanner di prova genera l'allerta; Edge e Zabbix no; nessuna password su disco (prova che la cerca) | 4 g |
| 4 | **Blocco e contrasto difensivo**: set a tempo, soglie, tetti, sblocco, rallentamento, proposta di isolamento | blocco e sblocco provati; sorgente falsificata non blocca; tetto rispettato | 3 g |
| 5 | **Collaudo**: appliance di laboratorio (snapshot prima), poi hub 533 in «osserva» una settimana, poi acceso; manuale, `CONTEXT`, `CHANGELOG`, scheda-mappa, consuntivo | una settimana senza moduli rotti né falsi blocchi; sblocco da console provato davvero | 2,5 g + la settimana |

**Totale: circa 20 giornate di lavoro, 4-5 settimane di calendario** contando la settimana in
«osserva». Le tappe 1 e 3 possono andare in parallelo alla 2 (file diversi). Su `main` (appliance dei
clienti) arriva spento; si accende cliente per cliente.

## 5. Livello di controllo: Completo

Prova vista fallire per esecutore, filtro, lettura di `X-Real-IP`, password delle esche, blocco. Prove
in netns sul modello di `prova-firewall-netns.sh`. Snapshot della VM prima di ogni prova sul vero.
Una revisione del ramo prima di `dev`. Resa a 1920 per ogni scheda. Cancello completo una volta, prima
di `dev`.

## 6. Rischi

- **Chiudersi fuori** dall'appliance di un cliente: §2.3; si accende prima sul laboratorio e sull'hub.
- **Rompere un modulo**: syslog, trap SNMP, NetFlow/sFlow, agenti Wazuh e inventario arrivano da molti
  indirizzi: il gruppo «Ricezione dati» nasce «Tutti» e si stringe solo dopo aver visto in «osserva»
  chi consegna davvero.
- **Bloccare un cliente o noi stessi**: elenchi «mai bloccati», blocco automatico spento all'inizio,
  conta solo il TCP completato, tetti.
- **Docker cambia le sue catene** a ogni versione: per questo non ci si appoggia a `DOCKER-USER`.
- **Aggiornamenti**: chi scrive la tabella al riavvio è un servizio nostro (`After=` Docker e
  `dalink-firewall`); un aggiornamento dell'app non riscrive la politica.

## 7. Domande a Riccardo (25/11/2026)

1. Dove: solo hub e laboratorio adesso, e le appliance dei clienti dopo, spente finché non le accendi?
2. Moduli nel perimetro: tutti quelli dell'appliance (edge, LibreNMS, Wazuh, Graylog, MeshCentral, MDM,
   collector, proxy Zabbix), o si parte da pagina web, SSH ed edge?
3. «Traffico di contrasto»: va bene solo difesa (rifiuto, rallentamento, limite, isolamento con
   conferma, avviso)? Niente traffico verso chi attacca.
4. Sempre ammessi oltre a NetBird/DA-Link: quali reti dei tecnici? E gli avvisi vanno anche a Vulcan?
5. Quali esche: Telnet 23, FTP 21, SMB 445, RDP 3389, MySQL 3306, SSH finto 2222, pagina di login
   finta 8081: tutte o alcune?
6. Guasto del filtro al riavvio: aperto con allarme (proposto) o chiuso?
7. Blocco di un indirizzo **interno** alla rete del cliente: automatico, o solo allerta e blocco a mano?
8. Nome e posto: sezione «Protezione» dopo «Rete», solo admin: va bene?

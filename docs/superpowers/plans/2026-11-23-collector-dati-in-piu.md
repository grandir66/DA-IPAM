# Collector di traffico: i dati in più — piano di esecuzione

> Si esegue in linea, una tappa alla volta, in una sessione nuova. Le caselle tengono il conto:
> `[ ]` da fare · `[~]` in corso · `[x]` fatto (con `Verifica:` accanto) · `[!]` bloccato · `[-]` annullato.

**Obiettivo:** far dare ai collector tutto quello che il traffico in copia può dire, oltre a «chi parla con chi».
**Da dove nasce:** Riccardo, 23/11/2026: «direi di inserire tutte le proposte che hai fatto e con le mie decisioni; censire
sicuramente le network sconosciute, dando un nome agli oggetti pur non inserendoli tra le subnet interne; anche le altre
voci con mia decisione». Piano approvato da lui lo stesso giorno («sì»).
**Viene dopo:** `docs/superpowers/plans/2026-11-20-collector-traffico.md` (collector, lettura, anomalie, interfaccia: fatti).
**Livello di controllo:** leggero per le tappe 1-6; la tappa 7 è zona rossa (dati personali).
**Stato:** tappe 1-4 scritte e pubblicate, da chiudere sull'hub (vedi «Dove riprendere» nel Registro); tappa 5 a metà (dati fatti, interfaccia da proporre); 6-7 da fare · **Ultimo aggiornamento:** 2026-11-23

## Dove siamo

- Cinque collector veri in ufficio, uno per nodo Proxmox: `DA-COLLECTOR-PX01` (VM 116, 192.168.4.192), `PX02` (115, .190),
  `PX03` (114, .186), `PX04` (113, .185), `PX05` (102, .198). Indirizzi in DHCP. Letti dall'IPAM `192.168.4.8` (cliente 70791),
  che segue `dev` da solo ogni 15 minuti: **un push su `dev` è un rilascio sull'hub**.
- Il collector si aggiorna a mano: `git archive origin/dev collector-traffico | ssh root@<ip> 'tar -x -C /root/src'`, poi
  `bash /root/src/collector-traffico/installa.sh ens19 <nome>` (tiene gettone, certificato e archivio). Da Mac l'accesso è con la
  chiave `id_ed25519`; in zsh le opzioni di ssh vanno in un array, non in una variabile.
- Codice: collector in `collector-traffico/collector/` (`ascolto.py` legge l'inizio delle connessioni, `controlli.py` i controlli,
  `archivio.py` SQLite, `api.py` HTTPS); IPAM in `src/lib/traffico/` (`lettura.ts`, `anomalie.ts`, `insieme.ts`, `quadro.ts`,
  `frasi.ts`) e pagina `src/app/(dashboard)/traffico/`. Copia dell'uplink sui nodi: `collector-traffico/proxmox/` e README.

## Vincoli globali

- Valgono tutti i vincoli del piano del 20/11: servizio separato dalla sonda pesante, sola libreria standard di Python, la
  scheda in copia non trasmette, date `AAAA-MM-GG HH:MM:SS` in UTC, rotte con guardia d'accesso e `withTenantFromSession`,
  tabelle solo additive, `db-tenant` importato staticamente, mai IP o nomi nei log.
- Ramo `dev`, mai `main`. A fine tappa `npm run version:release -- --staged-only` e `git push origin dev`. Albero condiviso:
  stage per nome, mai `git add -A`, mai `git reset --hard`.
- **Il fatto e mai il valore** resta la regola. Uniche eccezioni decise da Riccardo il 23/11: il **nome utente** di un accesso
  (tappa 7) e la **versione dichiarata** di un programma (tappa 7). Mai password, hash, biglietti, contenuto.
- **Misura prima di allargare**: ogni tappa che fa leggere più pacchetti al collector si prova prima su `DA-COLLECTOR-PX03`
  (il più carico: oltre un milione di righe in due giorni). Si scrivono nel Registro CPU, RAM e copertura prima e dopo;
  se la RAM supera 700 MB su 1 GB o la copertura scende sotto il 99%, ci si ferma e si restringe il filtro.
- **Ogni dizionario in memoria ha un tetto** (come `MEMORIA_MASSIMA` in `ascolto.py`), ogni tabella nuova ha lo sfoltimento.
- Il filtro di `tcpdump` resta nel kernel e va sempre ripetuto dietro `vlan` (il mirror porta il tag).
- **Interfaccia: ogni tappa propone a Riccardo cosa si vede e dove, prima di scriverla.** Stile `docs/STILE-UI.md`, mattoni di
  `src/components/shared/console.tsx`, stati con segno e fondo pieno, testo ≥ 13 px. Il client importa valori solo da
  `frasi.ts`, mai da un modulo che tocca il database.
- Verifiche entro 2 minuti: `cd collector-traffico && python3 -m unittest discover -s tests -t .`,
  `node --import tsx --test "src/lib/traffico/**/*.test.ts"`, `npx eslint` sui file toccati, `npx tsc --noEmit`.
  Schermata a 1920 solo se cambia il layout. Niente revisori, niente prove rieseguite.

## Casi da non dimenticare

1. **Lo stesso fatto da più collector**: cinque collector vedono in parte lo stesso traffico. Ogni tabella nuova in IPAM ha
   `collector_id` nella chiave e la lettura prende il massimo o il più recente, mai la somma (come `traffico_coppie`).
2. **Le scansioni di IPAM sono traffico**: `192.168.4.8` che prova migliaia di porte riempie «connessioni fallite» e «servizi
   usati». Gli indirizzi dell'installazione stessa e dei collector si escludono o si marcano, altrimenti la pagina è rumore.
3. **Un IP che cambia padrone** (DHCP): con la mappa MAC-IP della tappa 2 la coppia si aggancia all'host che aveva quell'IP.
4. **Il collector non sa cos'è interno per il cliente**: «rete sconosciuta» lo decide IPAM, confrontando con le reti censite.
5. **GRO acceso sui nodi**: i pacchetti contati sono meno dei veri; ritrasmissioni e tempi si misurano sui segmenti visti e
   si presentano come indizio, non come misura esatta.

---

### [~] Tappa 1 — Quello che c'è già e non si vede

Solo IPAM, nessun cambio al collector.

- «Ultima ora» e andamento orario. Oggi `traffico_coppie` tiene una riga per giorno: aggiungere `traffico_ore` (ora, rete o
  host, byte, pacchetti, connessioni) riempita nello stesso passaggio in cui si scrivono le coppie, tenuta 7 giorni.
- In «Chi parla con chi»: periodo «Ultima ora»; colonne pacchetti e connessioni; in «Per host» quanti esterni diversi contatta.
- Un grafico piccolo dell'andamento (per la rete scelta o per un host), tavolozza per daltonici e tratteggi.

- [x] Dati: `traffico_ore`, riempimento, sfoltimento a 7 giorni, «Ultima ora» (`giorni=0`), pacchetti, connessioni ed
  esterni nelle tre viste, `GET /api/traffico/andamento`. Verifica: `node --import tsx --test "src/lib/traffico/**/*.test.ts"`
  28 su 28; `npx eslint src/lib/traffico src/app/api/traffico/andamento` pulito (23/11). Non ancora guardato sull'hub.
- [x] Interfaccia: proposta a Riccardo il 23/11 e approvata («Sì, scrivila»). Pulsante «Ultima ora» con «Dalle HH:MM»,
  colonne Pacchetti, Connessioni, Esterni, riquadro «Andamento, ultime 24 ore» (`traffico/andamento.tsx`).
  Verifica: `npx eslint "src/app/(dashboard)/traffico" src/lib/traffico` pulito, `npx tsc --noEmit` senza errori fuori da
  `.next/types` (23/11). **Non guardata resa**: in locale non ci sono dati di traffico.
- [~] Sull'hub: «Ultima ora» diversa da «Oggi» verificata dal database il 23/11 alle 00:21 UTC (841 MB contro 1,28 GB);
  resta il grafico a 24 ore e il conto delle righe di `traffico_ore` dopo un giorno.

**Fatto quando:** sull'hub «Ultima ora» mostra numeri diversi da «Oggi» e il grafico ha le ultime 24 ore.

### [~] Tappa 2 — Chi è un indirizzo

- Collector: nuova tabella `identita` (visto, mac, ip, vlan, fonte, nome, tipo). Fonti: ARP, DHCP (nome dell'host, classe del
  produttore, opzioni chieste), mDNS, NetBIOS, SSDP, LLDP/CDP (apparato vicino e porta). Una riga per coppia MAC-IP, aggiornata,
  non una per pacchetto. Nuova rotta `GET /v1/identita?dopo=`.
- IPAM: tabella `traffico_identita`; aggancio agli host (riempie MAC e nome dove mancano, **senza sovrascrivere** un dato messo
  a mano); anomalie nuove `ip_doppio` (due MAC per un IP nella stessa finestra) e `mac_cambiato`; la coppia si aggancia
  all'host che aveva l'IP (caso 3).
- Attenzione: ARP e DHCP non passano dalle porte del filtro attuale. Misura su PX03 prima.

- [x] Collector: `identita.py`, tabella `identita`, `GET /v1/identita`. Verifica: `python3 -m unittest discover -s tests -t .`
  50 su 50 (23/11).
- [x] Misura su `DA-COLLECTOR-PX03` (solo lui ha il codice nuovo): vedi Registro. Sotto le soglie, ma di notte e per tre minuti.
- [x] IPAM: `traffico_identita`, `identita.ts` (aggancio agli host solo dove il campo è vuoto, `ip_doppio`, `mac_cambiato`
  con interruttore per rete, host per MAC nel caso 3). Verifica: `node --import tsx --test "src/lib/traffico/**/*.test.ts"`
  30 su 30, eslint e `tsc` puliti fuori da `.next/types` (23/11).
- [ ] Rifare la misura su PX03 di giorno, poi portare il collector su PX01, PX02, PX04, PX05.
- [x] Interfaccia: approvata da Riccardo il 23/11 («Sì, scrivila»). «Come si presenta in rete» nel riquadro «Con chi
  parla» della scheda, i MAC sotto la frase di «IP doppio» e «MAC cambiato». Verifica: prove del traffico 31 su 31, eslint
  e `tsc` puliti (23/11). **Non guardata resa** (in locale non ci sono dati).
- [x] IP doppio provocato sul banco del PX-NAS (col sì di Riccardo). Verifica: dal contenitore 110 due MAC finti
  (`02:00:00:00:00:01` e `:02`) annunciano in ARP `10.77.0.9`; `collector-banco` li dà tutti e due su `/v1/identita`;
  quelle righe, passate a `sincronizzaTraffico` in un database usa e getta, danno un avviso `ip_doppio` di gravità 3 coi
  due MAC (23/11, 00:15 UTC). Dal codice, non dalla pagina.

**Fatto quando:** un host dell'ufficio senza MAC in IPAM lo riceve dal collector, e un IP doppio provocato sul banco compare.

### [~] Tappa 3 — Reti sconosciute e oggetti con nome

- IPAM: tabella `traffico_oggetti` (chiave: rete o indirizzo, interno non censito o esterno; nome, nota, chi e quando).
  **Non è la tabella `networks`**: niente scansioni, niente host creati, non entra fra le subnet interne.
- Scheda «Reti viste» nella pagina Traffico: indirizzi privati fuori dalle reti censite raggruppati per rete (/24 di serie),
  con host visti, volume, con chi parlano, prima e ultima volta; azione «Dai un nome». Il nome compare al posto di «Rete non
  censita» in tutte le viste.
- Lo stesso per l'esterno, dalla tappa 4.

- [x] Dati: `traffico_oggetti`, `oggetti.ts` (reti viste per /24 o per l'oggetto che le contiene, dare e togliere un nome),
  `GET /api/traffico/reti-viste`, `GET|PUT|DELETE /api/traffico/oggetti`; il nome entra in «Fra reti», nel filtro di rete
  e nell'andamento con la chiave `o:<rete>`. Verifica: `node --import tsx --test "src/lib/traffico/**/*.test.ts"` tutte
  verdi (33), eslint e `tsc` puliti fuori da `.next/types` (23/11).
- [x] Interfaccia: approvata da Riccardo il 23/11 («Sì, scrivila»). Scheda «Reti viste» (`traffico/reti-viste.tsx`) con
  «Dai un nome», gruppo «Reti con nome, non censite» nel filtro di «Chi parla con chi». Verifica: eslint e `tsc` puliti
  (23/11). **Non guardata resa.** Scostamento dalla proposta: «Vedi le coppie» funziona solo per una rete che ha già un
  nome, perché il filtro di «Chi parla con chi» conosce le reti censite e gli oggetti, non un /24 qualunque.
- [ ] Sull'hub: Riccardo dà un nome a una rete vista dall'ufficio e lo ritrova in «Fra reti».

**Fatto quando:** una rete non censita vista dall'ufficio ha un nome dato da Riccardo e quel nome compare in «Fra reti».

### [~] Tappa 4 — L'esterno per nome, paese e fornitore

- Collector: oggi tutto ciò che è fuori diventa `esterno`. Tenere la destinazione per le prime N esterne per host e finestra
  (N da misurare, partire da 50), il resto resta `esterno` e si conta. Nome da DNS e SNI già raccolti.
- IPAM: archivio paese e fornitore **scaricato sull'hub** (DB-IP Lite, mensile, licenza CC BY: citarla nella pagina), mai una
  richiesta a un servizio esterno con un indirizzo. Vista «Verso l'esterno»: per nome, paese, fornitore; nomi dati a mano
  dalla tappa 3. Anomalia `paese_nuovo` solo dopo l'apprendimento.
- Quando il tetto N scatta la pagina lo dice.

- [x] Collector: `piega.esterni` (i primi 50 indirizzi esterni per host e finestra, il resto in una riga «altri» che dice
  quanti e quanti byte), nome di un indirizzo da risposta DNS e saluto TLS, `GET /v1/esterni` e `/v1/nomi-ip`.
  Verifica: `python3 -m unittest discover -s tests -t .` 56 su 56 (23/11).
- [x] Misura su `DA-COLLECTOR-PX03` (solo lui ha il codice nuovo): vedi Registro. Sotto le soglie, di notte.
- [x] IPAM: `traffico_esterni`, `traffico_nomi_ip`, `esterno.ts`, archivio locale `geo.ts` (DB-IP Lite), `paese_nuovo` dopo
  14 giorni con interruttore per rete, `GET /api/traffico/esterno`, `GET|POST /api/traffico/geo`. Verifica: prove del
  traffico 35 su 35, eslint e `tsc` puliti; scarico vero dell'archivio provato una volta dal Mac in una cartella usa e
  getta: 2 secondi, 27 MB, 362.998 intervalli di paese e 409.312 di fornitore (23/11).
- [x] Interfaccia: approvata da Riccardo il 23/11 («Sì, scrivila»). Scheda «Verso l'esterno» (`traffico/esterno.tsx`):
  quattro viste, riga gialla quando il tetto scatta, citazione di DB-IP nel piede, «Scarica l'archivio» per gli
  amministratori, «Dai un nome» a una destinazione. Verifica: eslint e `tsc` puliti (23/11). **Non guardata resa.**
- [ ] Sull'hub: scaricare l'archivio, guardare la vista, contare le righe di `traffico_esterni` dopo un giorno.
- [ ] Misura di giorno su PX03, poi gli altri quattro collector (insieme alla tappa 2).

**Fatto quando:** «Verso l'esterno» mostra le destinazioni dell'ufficio con paese e fornitore, e l'archivio dell'hub non è
cresciuto più del previsto (scrivere i numeri nel Registro).

### [x] Tappa 5 — Connessioni fallite, tempi, servizi davvero usati

- Collector: per (client, server, porta) conta SYN senza risposta, rifiuti (RST), ritrasmissioni viste, tempo fra SYN e
  SYN-ACK (minimo e mediano). Si aggregano per finestra, non una riga per pacchetto.
- IPAM: vista «Cosa non va» (chi bussa a vuoto, servizi che rifiutano o rispondono lenti); «servizi davvero usati» per host,
  confrontati con le porte aperte che IPAM conosce dalle scansioni (aperta e mai usata, usata e non nota).
- Caso 2: escludere le scansioni di IPAM.

- [x] Collector: `connessioni.py` (SYN, SYN-ACK, RST in IPv4: senza risposta, rifiutate, SYN ripetuti, tempo fra SYN e
  SYN-ACK minimo e mediano; una riga per coppia storta e una per servizio, per finestra), `GET /v1/connessioni`.
  Verifica: `python3 -m unittest discover -s tests -t .` 62 su 62 (23/11).
- [x] IPAM: `traffico_connessioni`, `connessioni.ts` («cosa non va»: chi bussa a vuoto, servizi che rifiutano o non
  rispondono, servizi lenti sopra 200 ms; servizi usati contro `hosts.open_ports`), `GET /api/traffico/connessioni`, e
  `servizi` nella risposta di `/api/traffico/host/[ip]`. Le sonde note non si salvano (caso 2). Verifica: prove del
  traffico 37 su 37, eslint e `tsc` puliti (23/11).
- [x] Misura su `DA-COLLECTOR-PX03` (solo lui ha il codice nuovo), col filtro corretto e due finestre intere.
  Verifica: 02:23-02:35 UTC del 23/11, ascolto 0,37% di CPU e 12 MB, RAM usata 373 MB, copertura 99,964% (Registro).
  Di notte: quella di giorno resta da fare, insieme alle tappe 2 e 4.
- [x] Difetto del filtro di cattura trovato sul banco e corretto (SYN e RST scartati fuori dalle porte dell'elenco).
  Verifica: sei pacchetti finti, 0 su 5 col filtro vecchio e 5 su 5 col nuovo; `python3 -m unittest discover -s tests -t .`
  63 su 63 (23/11).
- [x] Interfaccia: approvata da Riccardo il 23/11 («Sì, scrivila»). Scheda «Cosa non va» (`traffico/cosa-non-va.tsx`:
  chi bussa a vuoto, servizi che non rispondono con «✕ Mai risposto» o «◐ A volte», servizi lenti) e «Servizi usati»
  nel riquadro «Con chi parla» (usati e noti, «! usati ma non noti a IPAM», aperti mai usati). Verifica: eslint pulito,
  `tsc` senza errori fuori da `.next/types`, prove del traffico 37 su 37 (23/11). **Non guardata resa** (in locale non
  ci sono dati).
- [x] Servizio spento apposta sul banco del PX-NAS, col filtro corretto. Verifica: 23/11 alle 11:59 UTC, porta 8099 nel
  contenitore 110, 6 aperture riuscite e poi 7 rifiutate; `collector-banco` le scrive tutte (riga del servizio con 6 riuscite,
  riga 192.168.99.1 → 8099 con 7 rifiutate). Sull'hub `192.168.4.8`, alle 12:01 UTC, `traffico_connessioni` ha 2.403 righe
  da 116 client e nessuna con client `192.168.4.8`: le scansioni dell'IPAM non entrano.

**Fatto quando:** un servizio spento apposta sul banco compare fra le connessioni fallite, e le scansioni dell'hub no.
**Verificato il 23/11** (vedi le caselle qui sopra). Resta, come per le tappe 2 e 4, la misura di giorno su PX03.

### [x] Tappa 6 — DNS, TLS, VLAN sbagliata

> 23/11: la bozza `docs/superpowers/specs/2026-11-23-sonda-avanzata-zeek-design.md` (non ancora approvata da Riccardo)
> propone Zeek come profilo del collector, con gli stessi tipi d'anomalia delle tappe 6-7 da due fonti. Finché Riccardo
> non decide, le tappe 6-7 vanno avanti come scritte qui; se la approva, i tipi nuovi si scrivono una volta per tutti e due.

- DNS: quali server usa ogni host (chi salta quello interno), richieste senza risposta o con errore.
- TLS: certificato scaduto o autofirmato (dove si vede, fino a TLS 1.2), impronta del programma che si collega (JA3).
- VLAN: un indirizzo visto con un tag diverso da quello della sua rete censita.
- Sono anomalie nuove in `anomalie.ts` e `frasi.ts`, con il loro interruttore per rete come gli altri controlli.

- [x] Collector: `tls_certificato` (certificato di un servizio di casa scaduto o autofirmato, letto dal volo del server
  fino a TLS 1.2; uno per servizio, non per client; dai primi 600 byte: dove il certificato è tronco dice solo quello che
  vede), `dns_esterno` (un host che chiede a un DNS fuori), `dns_errori` (per host e finestra almeno 20 risposte SERVFAIL o
  REFUSED, o 20 richieste senza risposta; senza nessuna risposta nella finestra i «senza risposta» non si contano). Nessun
  pacchetto in più: DNS e saluto TLS passavano già dal filtro. Verifica: `python3 -m unittest discover -s tests -t .`
  69 su 69 (23/11).
- [x] IPAM: i tre tipi in `TIPI_FATTO` (gravità: certificato media, i due DNS bassa), `vlan_sbagliata` in `identita.ts`
  (indirizzo visto in ARP con un tag diverso dalla VLAN della rete censita; senza tag o rete senza VLAN, niente); tutti
  e quattro hanno l'interruttore per rete perché stanno in `TIPI_CONTROLLO`. Verifica: prove del traffico 39 su 39, eslint
  e `tsc` puliti (23/11).
- [-] JA3 (impronta del programma che si collega): rimandato. Con la cattura a 600 byte il saluto dei browser di oggi
  (oltre 1.200 byte, per la chiave post-quantistica) arriva tronco e l'impronta verrebbe sbagliata; servirebbe catturare di
  più, che è un costo da misurare, e un posto nell'interfaccia. Da decidere con Riccardo (e con la bozza su Zeek, che lo dà).
- [x] Caso provocato sul banco del PX-NAS. Verifica: 23/11 alle 12:33 UTC, dal contenitore 110 un servizio TLS 1.2 con
  certificato autofirmato sulla porta 8443 e una richiesta DNS a 9.9.9.9; `collector-banco` scrive `tls_certificato`
  (`autofirmato`, server 192.168.99.88:8443) e `dns_esterno`. Dal collector, non dalla pagina; copia e server tolti.
- [x] Interfaccia: nessun riquadro nuovo, solo nomi e frasi in `frasi.ts` (i tipi compaiono da soli fra le anomalie e
  nella scheda «Collector e controlli»). Verifica: approvati da Riccardo il 23/11 («Sì, vai alla 7»).

**Fatto quando:** i tre tipi compaiono nella scheda «Collector e controlli» e almeno uno scatta su un caso provocato.

### [~] Tappa 7 — Chi accede a cosa, programmi in uso · ZONA ROSSA

- Nomi utente da Kerberos (AS-REQ), SMB e LDAP: si salva (utente, da dove, verso dove, protocollo, quando, riuscito o no).
- Programmi: versione dichiarata nei saluti in chiaro (SSH, HTTP `Server` e `User-Agent`, SMTP, FTP).
  23/11, accordo con la sessione «Sonda con Zeek»: i programmi vanno nella tabella `nome` col tipo `software` e il nome
  `<tipo>:<nome> <versione>`, lo stesso che scrive Zeek; niente tipo di fatto a parte. `tls_certificato` ha anche il motivo
  `non_valido` (da Zeek).
- **Prima del codice**: prova che fallisce se in archivio finisce una password, un hash o un biglietto, scritta con catture
  vere fatte sul banco del PX-NAS (mai sull'ufficio); vista fallire, poi il codice.
- Visibile solo agli amministratori; 90 giorni; mai nei log, mai negli export, mai verso un modello.
- Interruttore per installazione, **spento di serie**: lo accende Riccardo.

Livello completo (zona rossa), approvato da Riccardo il 23/11 («Sì, tutto così»), con catture da un controller di dominio
finto sul banco e l'interfaccia proposta (scheda «Accessi», interruttore, «Programmi dichiarati»).

| Passo | Stato | Verifica |
|---|---|---|
| Banco: contenitore 111 `banco-dc` (Samba AD finto, `banco.test`, utente `prova`, password finte) e client nel 110 | [x] | 23/11, 14:20 UTC: controller a 192.168.99.91 |
| Catture vere Kerberos, SMB, LDAP (giusta e sbagliata), SSH, HTTP | [x] | `tests/dati/accessi-banco.pcap`, 163 pacchetti, MAC azzerati; la password giusta c'è in chiaro una volta (bind LDAP) |
| Prova di non-fuga **vista rossa** prima del codice | [x] | `python3 -m unittest tests.test_accessi`: errore `scrivi_accessi` sconosciuto (14:31 UTC); verdi le prove che la cattura contiene password, risposte NTLM e testi cifrati Kerberos e che il rivelatore scatta sul grezzo |
| Collector: `accessi.py`, tabella `accesso` (2 giorni), `/v1/accessi`, `ACCESSI=0` di serie in `installa.sh` (un valore già scritto non si tocca), filtro + porta 88 e saluti SSH piccoli | [x] | prova di non-fuga verde, anche coi pacchetti tagliati a 600 byte come in produzione; tutte le prove 107 su 107 |
| Collector: programmi dichiarati (SSH, HTTP, FTP, SMTP) nella tabella `nome` col tipo `software`, forma di Zeek | [x] | `Programmi.test_dalla_cattura_del_banco`: `SSH::SERVER:OpenSSH …`, `HTTP::BROWSER:ProvaAgente 1.0` |
| IPAM: `traffico_accessi` (90 giorni), `accessi.ts`, lettura di `/v1/accessi` solo a interruttore acceso, `GET/PUT /api/traffico/accessi` con `requireAdmin` | [x] | `accessi.test.ts`: spento di serie, righe storte scartate, due collector al massimo, 90 giorni; prove del traffico 45 su 45 |
| Interfaccia: scheda «Accessi» (solo amministratori, solo a interruttore acceso), interruttore in «Collector e controlli», «Programmi dichiarati» nella scheda dell'host | [x] | eslint e `tsc` puliti. **Non guardata resa** |
| Nessun export porta fuori gli accessi | [x] | nessuna rotta di export legge le tabelle `traffico_*`. Il backup intero del database del cliente li contiene, come tutto il resto |
| Misura del filtro leggero nuovo (88 e SSH) | [!] | `DA-COLLECTOR-PX03` dal 23/11 gira col profilo avanzato (Zeek, sessione «Sonda con Zeek»): il profilo leggero va misurato su un altro collector, quando Riccardo lo decide. Su PX03 l'ascolto della v0.9.1313 non partiva (accessi passati per posizione in `main()`, errore mio), fermo 13:35:57-13:37:32 UTC, corretto dall'altra sessione (`35585048`) |
| Giro intero sul banco: collector con `ACCESSI=1` → righe in `/v1/accessi` | [x] | 23/11, 13:41 UTC: `collector-banco` scrive 5 righe (Kerberos e SMB riuscito e fallito per `prova`, LDAP fallito ×2) e i programmi (`SSH::SERVER:OpenSSH 9.2p1`, `HTTP::BROWSER:ProvaAgente 1.0`…); nel giornale nessun nome utente; poi `ACCESSI=0` di nuovo e contenitore 111 tolto |
| Sull'ufficio (acceso da Riccardo) si vede chi ha fatto accesso a un server di prova | [ ] | tocca a Riccardo accendere |

**Fatto quando:** la prova di non-fuga è verde dopo essere stata vista rossa, e sull'ufficio (acceso da Riccardo) si vede
chi ha fatto accesso a un server di prova.

---

## Registro

- 2026-11-23: piano scritto e approvato da Riccardo. Esecuzione da una sessione nuova.
- 2026-11-23, tappa 1, dati. **Scostamento dal piano**: `traffico_ore` non è per «rete o host» ma per coppia e servizio,
  come `traffico_coppie` con l'ora al posto del giorno. Motivi: «Ultima ora» deve valere per le tre viste (fra reti, per host,
  per coppia) e la regola «il massimo fra collector, mai la somma» è esatta solo sulla coppia. Costo: più righe (stima a
  occhio qualche decina di migliaia per ora coi cinque collector, non misurata); se pesa si accorcia `GIORNI_ORE`.
  «Ultima ora» è l'ora in corso più quella prima (da 60 a 120 minuti): la risposta porta `dalle` perché la pagina lo dica.
  Gli esterni di un host sono il conteggio più alto fra i suoi servizi («almeno N»): il collector li conta per servizio e
  finestra, la somma li conterebbe due volte. La tabella parte vuota: niente si ricostruisce dal passato, il grafico si
  riempie in 24 ore dal rilascio. `npx tsc --noEmit` dà solo due errori di `.next/types` vecchi, su rotte non di questo lavoro.

- 2026-11-23 (23:45 UTC del 22), tappa 1 sull'hub: **non ancora verificata**. L'IPAM `192.168.4.8` è rimasto alla 0.9.1292:
  `da-ipam-update` ha rimandato due volte (23:18 e 23:33) perché `/api/health` dà un giro in corso; lo script aspetta fino a
  3 ore e poi aggiorna comunque, oppure subito con «Aggiorna ora» dall'interfaccia. I cinque collector sono attivi e senza
  errori. Da rifare dopo l'aggiornamento: versione, righe di `traffico_ore` per ora, «Ultima ora» contro «Oggi».

- 2026-11-23, tappa 2. Misura su `DA-COLLECTOR-PX03` (VM 114), prima: `collector-ascolto` 864 s di CPU in 61,5 ore
  (0,39% di una CPU), 100 MB; `pmacctd` 0,32%; RAM usata 386 MB su 973; copertura 99,987% (149.729 persi su 1,146 miliardi).
  Dopo (23:49-23:52 UTC del 22, tre minuti, notte): `collector-ascolto` 0,37% di CPU, 9 MB; RAM usata 330 MB; 119 persi su
  369.651 (99,97%); 415 pacchetti al secondo all'ascolto contro 358 di media; nessun pacchetto saltato nel journal.
  Raccolte 105 identità: 81 ARP (74 MAC), 15 CDP, 4 DHCP, 4 mDNS, 1 LLDP, su otto VLAN; nessun IP con due MAC.
  **Limite della misura**: tre minuti di notte non dicono il carico di giorno; `collector-ascolto` ha `MemoryMax=96M`.
  La cattura è passata da 256 a 600 byte a pacchetto (le opzioni DHCP cominciano al byte 282).
  Scelte: `mac_cambiato` non corregge l'host, lo dice (gravità bassa); `ip_doppio` solo fra due MAC in ARP sulla stessa
  VLAN entro 10 minuti, esclusi i MAC virtuali (VRRP, HSRP); i due avvisi hanno l'interruttore per rete come i controlli.

- 2026-11-23, tappa 2, banco: `collector-banco` (VM 109) aggiornato al codice di `origin/dev`, resta col codice nuovo.
  L'indirizzo di prova è di una rete che sul banco non esiste, così nessun apparato vero ne è stato disturbato; i file
  temporanei sono stati tolti. Dal Mac la VM 109 si raggiunge solo passando dal PX-NAS (manca la sua chiave fra gli host noti).
  Sull'hub `192.168.4.8`, alle 00:14 UTC, `/opt/da-invent` era già al commit `2c2bb609` ma `da-ipam` girava dalle 18:31
  col codice vecchio e l'aggiornamento continuava a rimandarsi per un giro in corso: la verifica lì resta da fare.

- 2026-11-23, tappa 3, dati. Scelte: la chiave di un oggetto è sempre una rete IPv4 (`10.9.8.0/24`, un indirizzo solo è
  `/32`), prefisso da 8 a 32; una rete già censita fra le subnet non può avere un oggetto (ha già il suo nome); un indirizzo
  fuori dal censimento prende l'oggetto più stretto che lo contiene. Solo IPv4: gli IPv6 fuori dal censimento restano
  «Rete non censita». Gli oggetti compaiono nell'elenco `reti_censite` della vista d'insieme con `oggetto: true`, così
  il nome si vede in «Fra reti» e nel filtro senza toccare la pagina. Dare un nome lo può fare solo un amministratore.

- 2026-11-23, 00:21 UTC, sull'hub `192.168.4.8` (ripartito alle 00:14 con la 0.9.1297; lettura del database, non della
  pagina). Tappa 1: `traffico_ore` ha 2.188 righe per i primi 21 minuti dell'ora, da tutti e cinque i collector (a questo
  passo, di notte, sotto 10.000 righe per ora: circa un milione in 7 giorni, da ricontare di giorno); «Ultima ora» 841 MB,
  «Oggi» 1,28 GB. Tappa 2: `traffico_identita` ha 175 righe da `DA-COLLECTOR-PX03` (127 ARP, 15 CDP, 12 SSDP, 11 mDNS,
  9 DHCP, 1 LLDP); tre avvisi `mac_cambiato`, nessun `ip_doppio`. **Il «Fatto quando» della tappa 2 sull'hub non si può
  mostrare così com'è**: su 363 host uno solo è senza MAC e il collector non l'ha visto in ARP; nessun nome è stato messo
  dal collector (tutti gli host visti ne avevano già uno). Serve un host di prova senza MAC, o si accetta la prova fatta
  dal codice. La 0.9.1300 (interfaccia della tappa 3) non era ancora arrivata sull'hub.

- 2026-11-23, tappa 4. Su `DA-COLLECTOR-PX03` col codice della tappa 2, 82 minuti di notte (23:49-01:12 UTC):
  `collector-ascolto` 0,41% di una CPU e 12 MB, `collector-traffico` 0,07%, `pmacctd` 0,20%, RAM usata 368 MB, copertura
  99,978%: è anche la misura lunga che mancava alla tappa 2. Col codice della tappa 4, primi 4 minuti (01:12-01:16):
  ascolto 0,51% (c'è dentro l'avvio), RAM usata 346 MB, copertura 99,974%, nessun errore nel journal. Una finestra di 5
  minuti: 885 righe di destinazioni per 88 host e 350 indirizzi esterni, 4 host oltre il tetto di 50; i byte tornano con
  le coppie verso «esterno» della stessa finestra (34,976 MB contro 34,983). 580 nomi di indirizzi (472 DNS, 108 TLS).
  Stima, da ricontare di giorno: 250.000 righe al giorno nell'archivio del collector (tenute 7 giorni).
  Scelte: le coppie non cambiano (l'esterno lì resta una riga sola), le destinazioni sono righe in più lette da una rotta
  a parte, solo dal mirror; in IPAM si tengono 30 giorni; il nome è quello dato a mano, poi TLS, poi DNS; l'archivio dei
  paesi sta in `data/geo/dbip.db`, fuori dai tenant, e **si scarica a mano** (amministratore): un automatismo mensile
  nuovo nascerebbe spento, lo decide Riccardo. `paese_nuovo` guarda solo chi apre da dentro verso fuori.

- 2026-11-23, 01:25 UTC, sull'hub `192.168.4.8` (ripartito alle 01:21 con la 0.9.1302; lettura del database). In quattro
  minuti `traffico_esterni` ha 1.719 righe per 662 indirizzi esterni, tutte da `DA-COLLECTOR-PX03`; `traffico_ore` 5.561
  righe su due ore; nessun oggetto con nome ancora. L'archivio dei paesi sull'hub non è scaricato (lo fa un amministratore
  dalla scheda «Verso l'esterno», che arriva con la 0.9.1303).
- **Dove riprendere** (sessione nuova, questa è diventata lunga): tappe 5, 6, 7. Prima, di giorno: misura su
  `DA-COLLECTOR-PX03` e, se regge, `installa.sh` su PX01, PX02, PX04, PX05 (finché non si fa, identità e destinazioni
  esterne arrivano solo dal traffico che passa da DA-PX-03). Aperti sull'hub: grafico a 24 ore (tappa 1), un nome dato a
  una rete vista (tappa 3), archivio scaricato e righe di `traffico_esterni` dopo un giorno (tappa 4).

- 2026-11-23, tappa 5. Su `DA-COLLECTOR-PX03` col codice della tappa 4, 37 minuti di notte (01:12-01:49 UTC):
  `collector-ascolto` 0,34% di una CPU e 11 MB, `collector-traffico` 0,08%, RAM usata 355 MB, copertura 99,969%, 400
  pacchetti al secondo all'ascolto. Col codice della tappa 5, primi due minuti (01:49-01:51): ascolto 0,43% (c'è dentro
  l'avvio), 10 MB, RAM usata 322 MB, copertura 99,964%, 504 pacchetti al secondo (i SYN e i RST in più). Una sola
  finestra, parziale: 3 righe. **Non basta a giudicare**: va riletta con finestre intere.
  Scelte: solo l'apertura delle connessioni TCP IPv4 (il filtro aggiunge `tcp[13] & 6 != 0`); «ritrasmissioni» sono i
  SYN ripetuti, non quelle dei dati; se in una finestra non si vede nessuna risposta (copia di una sola direzione) i
  «senza risposta» non si scrivono; al più 20.000 aperture seguite insieme e 5.000 righe per finestra; il tempo del
  giorno è la media delle mediane pesata sulle riuscite; in IPAM 30 giorni; nessun avviso nuovo, solo viste.
- **Passaggio di consegne (Riccardo, 23/11: «le tappe successive apri un agente nuovo»)**: questa sessione si ferma qui.
  La sessione nuova chiude la tappa 5 (misura, interfaccia da proporre, banco) e fa le tappe 6 e 7.

- 2026-11-23, tappa 5, misura riletta (sessione nuova). `DA-COLLECTOR-PX03` col codice della tappa 5, 16 minuti di notte
  (01:49:36-02:05:38 UTC), tre finestre intere di `connessione`: `collector-ascolto` 0,40% di una CPU e 10 MB,
  `collector-traffico` 0,08% e 25 MB, `pmacctd` 0,16% e 51 MB; RAM usata 341 MB su 973; copertura 99,973% (322 persi su
  1.186.934 fra le 01:58 e le 02:05); 388 pacchetti al secondo all'ascolto; nessun avviso nel journal. Righe per finestra:
  26 (01:50), 26 (01:55), 151 (02:00, c'è dentro un giro di scansione dell'IPAM `192.168.4.8`: 55 righe sue con 154
  aperture fallite, che in IPAM non si salvano perché è una sonda nota). In tutto 8 client che bussano a vuoto verso 77
  servizi; mediana dei tempi 44 ms di media, massimo 3,1 s, nessun servizio «lento» (servono 5 aperture riuscite sopra
  200 ms). Sotto le soglie (700 MB, 99%). **Resta la misura di giorno**, come per le tappe 2 e 4.

- 2026-11-23, tappa 5, banco e **difetto trovato**. `collector-banco` (VM 109) aggiornato a `origin/dev` alle 02:06 UTC.
  Prova: servizio HTTP sulla porta 8099 nel contenitore 110, sei aperture riuscite dal nodo, poi spento, sette rifiutate;
  i pacchetti arrivavano alla scheda in copia (visti con `tcpdump port 8099`) ma in `connessione` non c'era niente.
  Causa: nel filtro la clausola TLS (`tcp[((tcp[12:1] & 0xf0) >> 2):1] = 0x16`) legge oltre la fine di un pacchetto
  senza dati e il kernel lo scarta prima delle clausole dopo; SYN e RST passavano solo sulle porte dell'elenco
  (80, 445, 389…). Riprodotto in locale con sei pacchetti finti: 0 su 5 col filtro vecchio, 5 su 5 col nuovo (clausola
  spostata prima). **La misura qui sopra vale quindi solo per le porte dell'elenco: va rifatta col filtro corretto.**
  Visto anche: con due porte in copia (103 e 110) ogni SYN fra i due si vede due volte e finisce in «ripetute»; in
  ufficio la copia è di una porta sola (uplink), e in IPAM una riga con soli SYN ripetuti non conta come fallimento.
  **Banco condiviso**: alle 02:17 UTC un'altra sessione ha fatto snapshot, spento e riacceso la VM 109 e fermato i
  servizi del collector; sulla porta del contenitore 110 c'era una coda `clsact` non mia che il mio comando di pulizia
  delle 02:10 ha tolto (poi rimessa da loro). Da lì il banco non l'ho più toccato: la prova col filtro corretto è da fare.

- 2026-11-23, tappa 5, misura col filtro corretto. `DA-COLLECTOR-PX03`, prima (01:49:36-02:22:55 UTC, filtro vecchio):
  `collector-ascolto` 0,38% di una CPU e 12 MB, 386 pacchetti al secondo, RAM usata 361 MB. Dopo (02:22:57-02:35:39,
  12 minuti e mezzo, due finestre intere): ascolto 0,37% e 12 MB, `collector-traffico` 0,09% e 38 MB, `pmacctd` 0,14% e
  54 MB, RAM usata 373 MB, 400 pacchetti al secondo, copertura 99,964% (527 persi su 1.478.301), nessun pacchetto
  saltato. Righe di `connessione`: 113 nella finestra delle 02:25 e 1.641 in quella delle 02:30 (prima erano 26-151),
  su 113 porte diverse invece di 9; in dieci minuti 30 client che bussano a vuoto verso 1.021 servizi (dentro c'è un
  giro di scansione dell'IPAM, che in IPAM non si salva), nessun servizio lento. Sotto le soglie (700 MB, 99%), di notte.
  Stima a occhio, da ricontare di giorno: fino a qualche centinaio di migliaia di righe al giorno nell'archivio del
  collector (tetto 5.000 per finestra, tenute 7 giorni).

- 2026-11-23, tappa 6, su `DA-COLLECTOR-PX03` di giorno (prima volta di giorno per il codice nuovo). Prima (12:13-12:34
  UTC, codice della tappa 5): `collector-ascolto` 1,0% di una CPU. Dopo (12:34:05-12:45:32, codice della tappa 6, due
  finestre intere): 1,17% di una CPU e 18 MB, 940 pacchetti al secondo all'ascolto (di notte erano 400), RAM usata 342 MB,
  copertura 99,987% (486 persi su 3,82 milioni), nessun pacchetto saltato. Fatti in 11 minuti: `tls_certificato` 25
  servizi (3 scaduti, dal 2015 e dal 2019; gli altri autofirmati: stampanti, desktop remoto, pannelli), `dns_esterno` 17
  host, `dns_errori` 2 host (uno con 30 richieste su 31 senza risposta). In IPAM un avviso si scrive una volta per tipo e
  coppia, quindi è il primo giro che pesa; se i certificati autofirmati di casa sono troppi si spegne il controllo per rete.

- 2026-11-23, tappa 7. Fatto tutto quello che dipende dal codice e dal banco (tabella dei passi nella tappa). Errore mio:
  nella v0.9.1313 `main()` passava gli accessi per posizione e finivano in `profilo` (aggiunto nel frattempo dalla
  sessione Zeek): l'ascolto di `DA-COLLECTOR-PX03` non è partito per un minuto e mezzo, l'ha corretto quella sessione.
  Le prove passavano perché non chiamano `main()`. Resta a Riccardo: accendere gli accessi sull'ufficio (interruttore
  in IPAM e `ACCESSI=1` su un collector) e fare un accesso a un server di prova. Il filtro leggero nuovo non è misurato
  di giorno su nessun collector (PX03 è passato a Zeek).

## Consuntivo

(a chiusura: fatto · mancante · scostamenti · consigli)

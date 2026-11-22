# Collector di traffico: i dati in più — piano di esecuzione

> Si esegue in linea, una tappa alla volta, in una sessione nuova. Le caselle tengono il conto:
> `[ ]` da fare · `[~]` in corso · `[x]` fatto (con `Verifica:` accanto) · `[!]` bloccato · `[-]` annullato.

**Obiettivo:** far dare ai collector tutto quello che il traffico in copia può dire, oltre a «chi parla con chi».
**Da dove nasce:** Riccardo, 23/11/2026: «direi di inserire tutte le proposte che hai fatto e con le mie decisioni; censire
sicuramente le network sconosciute, dando un nome agli oggetti pur non inserendoli tra le subnet interne; anche le altre
voci con mia decisione». Piano approvato da lui lo stesso giorno («sì»).
**Viene dopo:** `docs/superpowers/plans/2026-11-20-collector-traffico.md` (collector, lettura, anomalie, interfaccia: fatti).
**Livello di controllo:** leggero per le tappe 1-6; la tappa 7 è zona rossa (dati personali).
**Stato:** tappa 1 in corso (dati fatti, interfaccia da approvare) · **Ultimo aggiornamento:** 2026-11-23

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
- [ ] Sull'hub: contare le righe di `traffico_ore` dopo 24 ore e scriverle nel Registro.

**Fatto quando:** sull'hub «Ultima ora» mostra numeri diversi da «Oggi» e il grafico ha le ultime 24 ore.

### [ ] Tappa 2 — Chi è un indirizzo

- Collector: nuova tabella `identita` (visto, mac, ip, vlan, fonte, nome, tipo). Fonti: ARP, DHCP (nome dell'host, classe del
  produttore, opzioni chieste), mDNS, NetBIOS, SSDP, LLDP/CDP (apparato vicino e porta). Una riga per coppia MAC-IP, aggiornata,
  non una per pacchetto. Nuova rotta `GET /v1/identita?dopo=`.
- IPAM: tabella `traffico_identita`; aggancio agli host (riempie MAC e nome dove mancano, **senza sovrascrivere** un dato messo
  a mano); anomalie nuove `ip_doppio` (due MAC per un IP nella stessa finestra) e `mac_cambiato`; la coppia si aggancia
  all'host che aveva l'IP (caso 3).
- Attenzione: ARP e DHCP non passano dalle porte del filtro attuale. Misura su PX03 prima.

**Fatto quando:** un host dell'ufficio senza MAC in IPAM lo riceve dal collector, e un IP doppio provocato sul banco compare.

### [ ] Tappa 3 — Reti sconosciute e oggetti con nome

- IPAM: tabella `traffico_oggetti` (chiave: rete o indirizzo, interno non censito o esterno; nome, nota, chi e quando).
  **Non è la tabella `networks`**: niente scansioni, niente host creati, non entra fra le subnet interne.
- Scheda «Reti viste» nella pagina Traffico: indirizzi privati fuori dalle reti censite raggruppati per rete (/24 di serie),
  con host visti, volume, con chi parlano, prima e ultima volta; azione «Dai un nome». Il nome compare al posto di «Rete non
  censita» in tutte le viste.
- Lo stesso per l'esterno, dalla tappa 4.

**Fatto quando:** una rete non censita vista dall'ufficio ha un nome dato da Riccardo e quel nome compare in «Fra reti».

### [ ] Tappa 4 — L'esterno per nome, paese e fornitore

- Collector: oggi tutto ciò che è fuori diventa `esterno`. Tenere la destinazione per le prime N esterne per host e finestra
  (N da misurare, partire da 50), il resto resta `esterno` e si conta. Nome da DNS e SNI già raccolti.
- IPAM: archivio paese e fornitore **scaricato sull'hub** (DB-IP Lite, mensile, licenza CC BY: citarla nella pagina), mai una
  richiesta a un servizio esterno con un indirizzo. Vista «Verso l'esterno»: per nome, paese, fornitore; nomi dati a mano
  dalla tappa 3. Anomalia `paese_nuovo` solo dopo l'apprendimento.
- Quando il tetto N scatta la pagina lo dice.

**Fatto quando:** «Verso l'esterno» mostra le destinazioni dell'ufficio con paese e fornitore, e l'archivio dell'hub non è
cresciuto più del previsto (scrivere i numeri nel Registro).

### [ ] Tappa 5 — Connessioni fallite, tempi, servizi davvero usati

- Collector: per (client, server, porta) conta SYN senza risposta, rifiuti (RST), ritrasmissioni viste, tempo fra SYN e
  SYN-ACK (minimo e mediano). Si aggregano per finestra, non una riga per pacchetto.
- IPAM: vista «Cosa non va» (chi bussa a vuoto, servizi che rifiutano o rispondono lenti); «servizi davvero usati» per host,
  confrontati con le porte aperte che IPAM conosce dalle scansioni (aperta e mai usata, usata e non nota).
- Caso 2: escludere le scansioni di IPAM.

**Fatto quando:** un servizio spento apposta sul banco compare fra le connessioni fallite, e le scansioni dell'hub no.

### [ ] Tappa 6 — DNS, TLS, VLAN sbagliata

- DNS: quali server usa ogni host (chi salta quello interno), richieste senza risposta o con errore.
- TLS: certificato scaduto o autofirmato (dove si vede, fino a TLS 1.2), impronta del programma che si collega (JA3).
- VLAN: un indirizzo visto con un tag diverso da quello della sua rete censita.
- Sono anomalie nuove in `anomalie.ts` e `frasi.ts`, con il loro interruttore per rete come gli altri controlli.

**Fatto quando:** i tre tipi compaiono nella scheda «Collector e controlli» e almeno uno scatta su un caso provocato.

### [ ] Tappa 7 — Chi accede a cosa, programmi in uso · ZONA ROSSA

- Nomi utente da Kerberos (AS-REQ), SMB e LDAP: si salva (utente, da dove, verso dove, protocollo, quando, riuscito o no).
- Programmi: versione dichiarata nei saluti in chiaro (SSH, HTTP `Server` e `User-Agent`, SMTP, FTP).
- **Prima del codice**: prova che fallisce se in archivio finisce una password, un hash o un biglietto, scritta con catture
  vere fatte sul banco del PX-NAS (mai sull'ufficio); vista fallire, poi il codice.
- Visibile solo agli amministratori; 90 giorni; mai nei log, mai negli export, mai verso un modello.
- Interruttore per installazione, **spento di serie**: lo accende Riccardo.

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

## Consuntivo

(a chiusura: fatto · mancante · scostamenti · consigli)

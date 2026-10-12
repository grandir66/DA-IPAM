# Piano di miglioramento di DA-IPAM — dall'inventario all'appliance

> **Documento vivo**: lo stato delle tappe si aggiorna qui (§9), non in documenti
> nuovi accanto. Le decisioni stanno in [ADR 0004](../../adr/0004-da-ipam-appliance-edge-guidato.md).
> I codici dei difetti (`UI-n`, `MOD-n`, `EDG-n`, `INS-n`, `SEC-n`, `NUC-n`, `DB-n`,
> `INV-n`) sono descritti nell'analisi `docs/analisi-sistema.md`, **solo locale**
> perché contiene dettagli di sicurezza e questo repo è pubblico: qui si citano, non
> si spiegano.
>
> Fotografia: 2026-10-12, `dev` a v0.3.265. Richiesta di Riccardo: moduli più
> semplici, edge dentro DA-IPAM, installazione dentro DA-IPAM, topologia completa
> con i controller UniFi e Omada; **senza compromettere il dialogo fra edge e
> DA-Vul-can e senza distruggere quello che funziona**.

## 1. Dove si vuole arrivare

- **Un'installazione**: immagine pronta → `/setup` → configurazione guidata che
  comprende la scelta dei moduli.
- **Un catalogo**: ogni modulo si accende con lo stesso gesto, si guarda nello stesso
  modo, si aggiorna dallo stesso ciclo e si spegne sapendo cosa si perde.
- **L'edge è il motore delle scansioni di DA-IPAM**: si accende dal catalogo, si
  comanda da *Sicurezza → Scanner*, e continua a parlare con DA-Vul-can come oggi.
- **La rete si vede tutta**: dispositivi, collegamenti LLDP, access point e client,
  letti anche dai controller UniFi e Omada, nella mappa e nelle schede.
- **Un menu per compiti** e una dashboard che dice cosa c'è da fare.
- **Prima le fondamenta**: i difetti noti di dati, scansioni e permessi si chiudono
  prima di aggiungere fonti che scrivono dati nuovi.

## 2. Decisioni prese (Riccardo, 12/10 — non riaprire)

1. Un'installazione = un cliente; il tenant non è un confine di sicurezza.
2. Catalogo unico dei moduli, descritti da un manifesto dentro DA-IPAM.
3. Edge = motore guidato da DA-IPAM: container separato, installato, abbinato e
   aggiornato da DA-IPAM, tutte le funzioni in DA-IPAM, nessuna interfaccia propria
   per le scansioni interne. Lo scanner esterno dal cloud resta stand-alone.
4. Il dialogo edge ↔ DA-Vul-can non cambia (vedi §3, regola 3).
5. Installazione: prima l'appliance che si completa da sola, poi la console centrale
   Domarc come progetto separato.
6. Wazuh server, Graylog completo e DNS/DHCP restano su macchine proprie, DA-IPAM li
   collega; nessun diritto di DA-IPAM sull'host Proxmox.
7. I controller UniFi e Omada creano oggetti: access point, switch, router e client.

Ne discende un vincolo: il codice dell'edge resta nel repo privato DA-Vul-can, perché
questo repo è pubblico; DA-IPAM riceve l'edge come immagine pronta.

## 3. Regole del piano: migliorare senza distruggere

1. **Affiancare, poi sostituire.** Ogni pezzo nuovo nasce accanto al vecchio,
   spento; si prova, si accende, e il vecchio si toglie in un passo successivo, con la
   prova che nessuno lo usa più.
2. **Ogni tappa si rilascia da sola** e non lascia il sistema a metà. Percorso:
   `dev` → hub (VM 533, segue `dev`) → verifica → promote a `main` con conferma di
   Riccardo → appliance dei clienti. Ci si può fermare dopo qualunque tappa.
3. **Il canale edge ↔ DA-Vul-can non si tocca.** Restano com'erano: coda d'invio e
   cifratura dei risultati (ADR-0001 di DA-Vul-can), segnale di vita verso l'hub,
   aggiornamento dal tarball dell'hub (finché l'immagine nuova non lo sostituisce
   con lo stesso esito), comandi dell'hub via SSH, rotte dell'hub. **Verifica fissa** a
   ogni rilascio che tocca l'edge: sull'hub l'ultimo segnale di vita di quell'edge è
   recente e un invio di prova arriva. Lo script di verifica, in sola lettura, nasce
   nella tappa 6 prima di ogni modifica.
4. **Dati dei clienti**: migrazioni solo additive; prima di ogni bonifica backup,
   prova a vuoto e conferma.
5. **Deploy-Appliance resta funzionante**, per le appliance esistenti e come piano
   B, finché il percorso nuovo non ha installato un'appliance vera.
6. **L'interfaccia si propone oggetto per oggetto prima di scriverla** (regola grafica
   del parco) e si guarda resa a 1920 px.
7. **Livello di controllo per tappa** (§4); il cancello completo precede sempre il
   promote a `main`.
8. **Una tappa per volta su questo repo.** Prima di cominciare si guarda chi ci sta
   già lavorando (worktree, sessioni vive) e si lavora in un worktree proprio.
9. **Ogni regola che può diventare un test lo diventa**: ogni modulo del manifesto
   ha salute e disattivazione; nessuna rotta di modulo senza guardia; il token
   dell'edge di sola lettura non comanda niente.

## 4. Le tappe in un colpo d'occhio

| Tappa | Obiettivo | Livello | Dipende da | Dimensione | Cosa si vede |
|---|---|---|---|---|---|
| 1 | Correzioni visibili e difetti d'installazione | leggero (completo per permessi e installazione) | — | 1-2 sessioni | setup, utenti, link, testi giusti |
| 2 | Fondamenta: dati, scansioni, permessi | completo | — | 3-5 sessioni | database più piccolo, scansioni che non si accavallano |
| 3 | Catalogo dei moduli + primo modulo nuovo: *Controller di rete* | completo per installazioni e scritture, leggero per le pagine | 2 | 4-5 sessioni | pagina Moduli nuova; access point e client dai controller |
| 4 | Topologia completa | leggero | 3 | 2-3 sessioni | mappa con AP, porte, client; export drawio |
| 5 | Tutti i moduli nel catalogo, navigazione, dashboard | completo per installazioni e segreti, leggero per le pagine | 3 | 4-6 sessioni | menu per compiti, una scheda host, dashboard delle cose da fare |
| 6 | Edge guidato da DA-IPAM | completo | 2, 3 | 5-7 sessioni, due repo | *Sicurezza → Scanner*; edge acceso dal catalogo |
| 7 | Installazione dall'immagine | completo | 3, 6 | 3-5 sessioni | una nuova PX-NAS installata così |
| 8 | Console centrale Domarc | da decidere | 7 | progetto separato | elenco delle appliance con versione e salute |

Le tappe 4 e 5 possono scambiarsi di posto; la 6 può partire in parallelo alla 5 se
a lavorarci sono sessioni diverse, perché tocca soprattutto DA-Vul-can.

**Come parte una tappa**: in una sessione nuova (contesto pulito), che scrive per
prima cosa il piano di dettaglio della tappa (task, file toccati, prove) in
`docs/superpowers/plans/` e poi lo esegue fino al rilascio su `dev` e alla verifica.
Finché resta dentro quanto scritto qui non serve un nuovo via; serve se cambia lo
scope, per il promote a `main` e per ogni scrittura su dati di produzione.

## 5. Le tappe nel dettaglio

### Tappa 1 — Correzioni visibili e difetti d'installazione

**Già in corso altrove**: il blocco dei filtri (UI-1, UI-2, UI-8 chiusi; restano
UI-5, UI-7, UI-9) in un'altra sessione. Non si duplica.

- Il setup non propone più "Multi-Tenant" (UI-17).
- L'amministratore del cliente gestisce gli utenti del proprio cliente, con test di
  autorizzazione (UI-18).
- Link che portano dove dicono (UI-24); un nome solo, DA-IPAM, e "Moduli" nei testi
  (UI-23, parte).
- Testi della disinstallazione veri e conferma che dice cosa si perde (MOD-19).
- Profili di scansione letti dall'edge invece di una lista fissa (EDG-1).
- Le righe "Stato moduli" della dashboard portano al modulo (UI-20, parte).
- Installazione: lo script d'aggiornamento riconosce tutti e due i nomi del servizio
  (INS-1), dopo averlo verificato in sola lettura su un'appliance fatta col bundle;
  l'installazione su VM esistente parte da `main` (INS-2).

**Verifica**: prove mirate; foto a 1920 di setup, Utenti, Moduli, dashboard; per
INS-1 il registro del servizio dopo un aggiornamento su un'appliance del bundle.
**Fatto quando**: tutto su `dev`, verificato sull'hub, promote confermato.

### Tappa 2 — Fondamenta: dati, scansioni, permessi

- **Nucleo**: una sola copia delle funzioni del database (NUC-2: `db.ts` riesporta
  `db-tenant.ts`, per gruppi, con test di parità nel frattempo); niente ripiego muto
  sul tenant DEFAULT (NUC-1). Serve prima di aggiungere tabelle e funzioni nuove.
- **Database**: MAC normalizzato come chiave d'identità (DB-3); modello per MAC con
  più IP (DB-1); retention configurabile (DB-2); bonifica dello storico in
  produzione con backup, prova a vuoto e conferma.
- **Scansioni**: attese dallo scheduler, un lucchetto per rete, soglia prima di
  segnare offline (INV-1, INV-2). È il prerequisito per una fonte che crea host.
- **Permessi**: SEC-4, 5, 6, 13, 18 più i test di autorizzazione delle API.
- **Edge, solo permessi della sua API** (EDG-3, in DA-Vul-can). Non tocca il canale
  con l'hub.

**Verifica**: test di parità e di autorizzazione; misura del database prima e dopo;
due giri di scansione sovrapposti provati sul dev.

### Tappa 3 — Catalogo dei moduli e primo modulo nuovo

**Il catalogo:**

- Manifesto unico dei moduli; `requireModule()` su API e pagine (assorbe il gating
  del vecchio blocco 7); stato in un solo vocabolario (Non attivo · In
  installazione · Da completare · Attivo · Problema).
- Registro attività persistente; **esecutore fuori dal processo di DA-IPAM** per le
  operazioni lunghe (installare, aggiornare), con un elenco chiuso di operazioni:
  un aggiornamento che riavvia DA-IPAM non deve uccidere sé stesso a metà (MOD-17).
- Pagina *Moduli* a catalogo e una pagina per modulo, uguale per tutti: Stato,
  Configurazione, Registro, Versione e aggiornamento, Disattiva. Proposta oggetto per
  oggetto prima di scriverla.
- La pagina Moduli vecchia resta per i moduli non ancora migrati.

**Due moduli pilota sul catalogo nuovo:** NIS2, il più semplice, e
**Controller di rete**, nuovo:

- **Backend UniFi**: Network Application installata (API di sessione); UniFi OS e
  UDM (Integration API con chiave); cloud Site Manager, in sola lettura.
  **Backend Omada**: OpenAPI del controller (client id e secret). Sempre account in
  sola lettura.
- **Prima si misura**, in sola lettura, sui controller veri: DTS (UniFi installato,
  account di sola lettura già pronto), Domarc (UDM cloud: la chiave va rigenerata
  con permessi di lettura), un controller Omada da individuare. Le risposte
  registrate, anonimizzate, diventano i dati delle prove.
- **Cosa si legge**:
  - dispositivi: access point, switch, gateway, con modello, firmware, seriale, IP,
    MAC, uplink, porte con velocità e PoE;
  - vicini LLDP per porta;
  - client: MAC, IP, nome; per i cablati switch e porta; per i Wi-Fi access point,
    SSID, banda, segnale; ultimo visto.
- **Regole di nascita** (decisione 7):
  - access point, switch e router diventano dispositivi;
  - i client diventano host con origine "controller", fusi per MAC con quelli
    trovati dalla scansione;
  - i MAC privati casuali dei telefoni si riconoscono e hanno vita breve;
  - le subnet non censite si segnalano e non si creano da sole;
  - storico dei collegamenti dei client: proposta 30 giorni, configurabile.

**Verifica**: test del manifesto e delle regole di nascita sulle risposte
registrate; prima lettura vera su DTS in sola lettura, confronto dei numeri con
l'interfaccia del controller; misura di quante righe al giorno aggiunge.

### Tappa 4 — Topologia completa

Si aggiornano la spec e il piano esistenti (`2026-10-12-topology-map*`), non se ne
scrivono di nuovi.

- **Archi**: LLDP da SNMP e SSH e dal controller, abbinati anche per MAC del vicino
  e non solo per nome o IP; tabella MAC delle porte (SNMP) per collocare i client
  anche dietro switch che non sono UniFi.
- **Nodi**: access point; client raggruppati per porta o per access point, aperti a
  richiesta; livelli e filtri (infrastruttura · Wi-Fi · client) per sito.
- **Schede**: l'access point coi client collegati; lo switch con chi c'è dietro ogni
  porta; il client con dove è collegato e un breve storico.
- **Export drawio** (fase 2 della spec della topologia).

**Verifica**: test del grafo con risposte registrate; foto della mappa di DTS
confrontata coi drawio già fatti a mano per DTS.

### Tappa 5 — Tutti i moduli nel catalogo, navigazione, dashboard

- **Migrazione modulo per modulo**: Inventory Agent, Patch, LibreNMS, Graylog e
  Loki, MeshCentral (versioni unificate con Deploy-Appliance, password generate
  all'installazione); Wazuh e DNS/DHCP come *servizi esterni da collegare*, con
  procedura guidata.
- **Accesso unico** a tutte le interfacce esterne (MOD-21); credenziali dei moduli in
  un posto solo (MOD-22); sincronizzazioni che non cancellano dati buoni (MOD-3,
  MOD-8, MOD-10, MOD-11).
- **Rimozione** della pagina Moduli vecchia e del vault doppio, solo dopo la prova
  che nessun modulo ci dipende.
- **Navigazione per compiti**: Rete · Sicurezza · Inventario · Strumenti · Sistema
  (proposta in analisi §14.6 D); una sola scheda host; dashboard con le cose da fare;
  passo "Moduli" nella configurazione guidata; liste con filtri nell'URL (vecchio
  blocco 3).

**Verifica**: per ogni modulo migrato un giro completo sul dev (attiva → configura
→ apri → disattiva); foto del menu e della dashboard a 1920.

### Tappa 6 — Edge guidato da DA-IPAM

**Prima di tutto**: lo script di verifica del canale con l'hub (§3, regola 3), in
sola lettura, provato sugli edge di oggi.

- **6a — Contratto**: stati di scansione con errori e avanzamento (EDG-2), chiave di
  rete stabile invece del CIDR (EDG-4), ciclo di vita dei finding senza
  cancellazioni a cascata (MOD-4, MOD-5, MOD-7).
- **6b — API dell'edge che manca** (in DA-Vul-can, solo aggiunte, con versione
  dichiarata): motore e feed con avvio della sincronizzazione; reti con VLAN;
  sorgenti ARP; credenziali con chiave SSH; programmazioni ARP e web; moduli (nuclei,
  web) e loro risultati; stato del collegamento all'hub, **in sola lettura**.
- **6c — Pagine *Sicurezza → Scanner*** in DA-IPAM.
- **6d — Immagine dell'edge** costruita una volta nella CI di DA-Vul-can, versionata
  e firmata, con un solo Dockerfile; l'edge diventa un modulo del catalogo:
  installazione, abbinamento automatico, aggiornamento.
- **6e — Migrazione degli edge esistenti**, uno per volta: prima uno di prova, poi
  gli altri. L'interfaccia dell'edge resta come accesso tecnico Domarc, aperta da
  DA-IPAM.

**Non si tocca**: il dialogo con l'hub (§3, regola 3) e lo scanner esterno dal
cloud. **Verifica**: lo script del canale a ogni rilascio; un giro completo di
scansione dal nuovo pannello; risultati arrivati sia in DA-IPAM sia sull'hub.

### Tappa 7 — Installazione dall'immagine

- **Un solo script d'installazione** per le VM esistenti e **un'immagine**
  (qcow2/OVA) costruita dalla CI con lo stesso script; primo avvio = `/setup`.
- **Un nome di servizio**, un solo scrittore della configurazione (INS-3), segreti
  generati all'installazione.
- **Deploy-Appliance si riduce** a costruire l'immagine e le macchine per i servizi
  esterni (Wazuh, Graylog completo, DNS/DHCP) sull'host Proxmox; resta per le
  appliance esistenti.
- **Prova**: rifare PX-NAS con la logica nuova, poi migrare un'appliance esistente.

**Verifica**: installazione da zero cronometrata; tutti i moduli accesi dal
catalogo; aggiornamento di un modulo e di DA-IPAM senza interventi a mano.

### Tappa 8 — Console centrale Domarc (progetto separato, dopo)

Elenco delle appliance con versione, salute, moduli e ultimo contatto; canale
d'aggiornamento; creazione di un'appliance nuova dall'immagine. Punto di partenza:
un segnale di vita da ogni appliance (l'hub DA-Vul-can li riceve già dagli edge).
Spec propria quando ci si arriva; dove vive la console si decide lì.

### Igiene, in coda alle tappe

CHANGELOG allineato alle release; archiviazione degli audit superati; potatura dei
rami; `verify-bug-report.ts` riparato; manuale utente aggiornato quando cambiano
menu e moduli.

## 6. Cosa non si tocca, in nessuna tappa

- L'hub DA-Vul-can e il suo dialogo con gli edge.
- Lo scanner esterno dal cloud.
- Il flusso `dev` → `main` via promote.
- I dati dei clienti senza backup, prova a vuoto e conferma.
- Le appliance esistenti, finché il percorso nuovo non è provato: si aggiornano come
  oggi.

## 7. Come si verifica

- **Prove automatiche**: parti pure (manifesto, regole di nascita, grafo) con dati
  registrati; test di autorizzazione delle API; test-invarianti (§3, regola 9).
- **A schermo**: a 1920 px sui dati finti in locale; sul dev o sull'hub coi dati veri
  per le tappe che toccano dati.
- **Sul campo**: DTS per controller e topologia, in sola lettura finché non si
  conferma; la nuova PX-NAS per installazione ed edge.
- **Canale edge**: lo script di verifica sull'hub a ogni rilascio che tocca l'edge.

## 8. Rischi e come si tengono bassi

- **Più sessioni sullo stesso repo**: una tappa per volta, worktree propri, si
  pubblica da lì.
- **Volume dei client** (MAC casuali dei telefoni): retention e fusione per MAC nella
  tappa 2, misura del volume nella tappa 3 prima di accendere.
- **Contratto edge fra due repo**: versione dell'API dichiarata, DA-IPAM controlla la
  versione prima di usare una funzione.
- **API dei controller che cambiano fra versioni** (UniFi 9 e 10, Omada 5): un
  backend per tipo, misura sui controller veri, prove sulle risposte registrate.
- **Durata**: è un programma di settimane; ogni tappa porta qualcosa di visibile o
  chiude un rischio, così ci si può fermare dopo qualunque tappa.

**Aperti, non bloccano la tappa 1**: quale controller Omada usare per la misura;
chiave UniFi cloud Domarc da rigenerare con permessi di lettura (Riccardo); dove
vive la console centrale (tappa 8).

## 9. Stato delle tappe

| Tappa | Stato | Data | Note |
|---|---|---|---|
| 1 | da fare | — | il blocco filtri è in corso in un'altra sessione |
| 2 | da fare | — | |
| 3 | da fare | — | |
| 4 | da fare | — | la mappa di base è già su `dev` (v0.3.260) |
| 5 | da fare | — | |
| 6 | da fare | — | |
| 7 | da fare | — | |
| 8 | da fare | — | progetto separato |

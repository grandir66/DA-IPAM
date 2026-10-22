# Prompt per la sessione cloud — collector modulari (DA-IPAM)

Data: 21/10/2026. Da incollare (o da far leggere) a una sessione Claude Code nel cloud aperta sul repository
`grandir66/DA-IPAM`, ramo **`collector-modulari`**. Il piano è approvato: si esegue, non si ripianifica.

## Regole che nel cloud non arrivano da sole

Le regole dell'utente e dell'area (`~/.claude/AGENTS.md`, `~/Progetti/AGENTS.md`) qui non ci sono. Valgono
queste, riassunte:

- Si scrive a Riccardo **in italiano, dandogli del tu**: risposte, documenti, messaggi di commit. Codice e
  nomi di simboli restano in inglese, i testi dell'interfaccia in italiano.
- **Rami.** Si lavora solo su `collector-modulari` (o su rami nati da lì) e si pubblica solo lì. **Mai push
  su `dev` né su `main`**: `dev` arriva da solo all'appliance di un cliente (timer ogni 15 minuti), `main`
  alle appliance dei clienti. L'unione in `dev` la fa Riccardo in locale, quando lo decide.
- **Niente prove a caso.** Un comando che fallisce due volte senza causa chiara: ci si ferma, si legge una
  volta il log completo e il codice, un fix mirato, una prova; se non è chiaro si chiede.
- **Il cancello si legge dal codice di uscita**, mai dall'output (`cmd; ESITO=$?`, niente `| tail` prima di
  leggere l'esito). Log in una cartella temporanea della sessione.
- **Una prova vale se l'ho vista fallire**: esegue il codice e usa dati finti con la forma vera.
- **Niente ripieghi muti**: nessun `catch` largo che trasforma un guasto in «lista vuota» o «ok».
- **Repo pubblico**: nessuna credenziale, IP, MAC, hostname, seriale o nome di cliente in codice, fixture,
  commit o log. Le fixture sono uscite anonimizzate (IP di documentazione 192.0.2.0/24, 198.51.100.0/24; MAC
  `02:00:00:…`).
- **Checklist in `TASKS.md`** (sezione «2026-10-21 — recupero da DADude3 e DA-MKNET»): si spunta ogni punto
  appena è fatto e si aggiunge ciò che si scopre, con una riga sul perché. `TASKS.md` va nei commit.
- **Schermate**: prima la proposta degli oggetti (tavola grafica resa, oggetti numerati, mai schemi ASCII),
  poi il codice. Brand Domarc: navy `#0D2537`, cian `#00A7E7` (mai per il testo), giallo `#FFD400` solo come
  fondo, Signika; Riccardo è daltonico: stati distinti per luminanza e forma, non solo per tinta.
- Report finale in linguaggio semplice: fatto, funziona, come è verificato, aperto.

## Da leggere prima di toccare il codice

1. `CONTEXT.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/rules/` del repo.
2. Il piano: `docs/superpowers/plans/2026-10-21-recupero-dadude3-mknet.md` (v2, decisioni in §7).
3. La consegna dei collector: `docs/handoff/2026-10-21-acquisizione-infrastruttura-da-ipam.md`,
   ADR 0024-0026, manuale `docs/modules/acquisition.md`.
4. Donatori, solo da consultare (mai copiati interi): `github.com/grandir66/dadude-native` (DADude3,
   pubblico) e `github.com/grandir66/DA-MKNET` (**privato**: Riccardo dà accesso all'app GitHub di Claude).
   Le righe citate nel piano valgono per i commit `569b416` e `812b1ad`; il codice su `origin/main` è lo
   stesso. **Al primo passo** si prova a clonarli fuori dal repo (es. `/tmp/donatori/`); se DA-MKNET non è
   leggibile ci si ferma e lo si dice a Riccardo, senza aggirare il problema. La storia di DA-MKNET contiene
   una password vera negli `OLDSCRIPT` (righe `password = …`): non va copiata, citata o messa in fixture.

## Ambiente

Node 22 LTS (Node ≥25 rompe `better-sqlite3`), `npm ci`. Prove: `npm test` con `DA_INVENT_DATA_DIR` su una
cartella temporanea; `npx tsc --noEmit`; `npm run lint`; `npm run build`. Prove del modulo:
`node --import tsx --test src/lib/acquisition/__tests__/*.test.ts` (79 verdi il 21/10). Nella suite intera
cadono a caso `credential-chains`, `parita-gruppo0`, `ssh-connessione-caduta`, `ssh-chiave`,
`chiave-ssh-percorsi`: se rosse, si rilanciano da sole prima di indagare.

Nel cloud **non** ci sono: il DB dell'hub, le appliance, il vault delle credenziali, gli apparati. Ciò che
richiede quelle cose si prepara e si lascia a Riccardo, scritto in `TASKS.md` come «da fare in locale».

## Cosa fare, in ordine

0. **Riallineare** `collector-modulari` con `origin/dev` con un **merge** (niente rebase né force-push sul
   ramo pubblicato). I conflitti probabili sono in `TASKS.md`, `CONTEXT.md` e nel registry dei moduli: si
   tiene il lavoro di entrambi. Dopo il merge le prove del modulo e `tsc` devono essere verdi.
1. **S1** Export MikroTik solo admin (piano §5, controllo completo: revisione dopo il task).
2. **S2** Firmware QNAP nel percorso storico (leggero).
3. **C0** Framework pronto a crescere (leggero; lo schema è un contratto pubblico).
4. **C1** Aggancio manuale in sviluppo (completo): proposta d'interfaccia prima della schermata.
5. **C2** Proiezioni, anteprima, applicazione (completo).
6. **C3** Collector nuovi nell'ordine del §7 D6, uno alla volta, ognuno «non collaudato» finché Riccardo non
   lo prova su un apparato.

**S3** (MAC virtuali) solo dopo che in `origin/dev` è arrivato il lavoro della sessione «tappe 3-5», che
modifica `src/lib/topology/identity.ts`; la sua misura su copia del DB dell'hub resta da fare in locale.

Ci si ferma e si chiede solo per: un cambio di scope, un'azione distruttiva non prevista, un conflitto di
merge che tocca lavoro altrui in modo non ovvio. A fine di ogni blocco: commit e push su
`collector-modulari`, `TASKS.md` aggiornato, una riga a Riccardo su cosa è pronto da provare in locale.

## Giro 2 (22/10): C1 e C2 insieme

Il giro 1 ha chiuso merge, S1, S2, C0 e la tavola C1. Riccardo ha risposto alle 5 domande della tavola: leggi
il §7 del piano, paragrafo «Tavola C1». In breve: **è l'acquisizione normale con un altro formato**, la fonte
si ricava da sola, **i dati popolano l'apparato**.

0. Merge di `origin/dev` in `collector-modulari` (come nel giro 1). Se la prova `db-facade-ratchet` è
   ancora rossa per funzioni arrivate da `dev`, non è tua: annotalo e vai avanti; le funzioni DB nuove le
   metti in `db-tenant.ts`, non in `db.ts`.
1. **Schema** (controllo completo): `acquisition_snapshots` (e la fonte, se serve ancora come tabella) da
   `docs/proposte/2026-10-22-collector-snapshot-schema.md`, adattato alla decisione 4: la fonte è
   ricavata, si salva solo la scelta fatta nel caso dubbio. Migrazioni inline idempotenti; retention D5.
2. **Aggancio all'acquisizione esistente**: trova il flusso che parte dal pulsante d'acquisizione della
   scheda (rotta e `network-device-acquisition.ts` o equivalente). Con l'interruttore
   `acquisizione_modulare.attiva` acceso e un collector del catalogo adatto al prodotto, l'acquisizione usa
   il collector: credenziali risolte nel backend dall'archivio (anti-lockout, exit 2 non prova altre
   credenziali), snapshot salvato. Senza collector o con l'interruttore spento il percorso di oggi resta
   **bit per bit** (prova che lo dimostra).
3. **Proiezioni** (C2, controllo completo): funzioni pure snapshot → modifiche, una per destinazione
   della tabella del §3 del piano; poi applicazione in transazione. `switch_ports` scritta **per campo**
   (scoperta 5 del piano: campo assente = resta, `null` = letto e vuoto, porta tolta solo da sezione `ok`),
   senza cambiare il comportamento dei percorsi UniFi e SNMP. Vicini e fatti T3 con fonte nuova
   `collector`, letta solo dal modello per cavo (T1 bit per bit). Il manuale vince sempre. Ogni modifica
   registrata con fonte e snapshot, per mostrarla.
4. **Schermata** secondo la tavola, con le correzioni del §7: riquadro sotto «Credenziali» con l'ultimo
   snapshot, tabella delle sezioni, prime 5 righe, ultime acquisizioni, **cosa è cambiato nell'apparato**;
   finestra solo per il caso dubbio; interruttore in Impostazioni → Sistema, spento. Resa guardata con
   Playwright a 1280 e 1920 con dati finti.
5. Prove: contesto tenant, guardie (`permessi/rotte.ts`), nessun segreto in snapshot/risposte, `partial`
   che non cancella, manuale che vince, percorso vecchio invariato con interruttore spento, crash a metà
   con sessioni chiuse. Revisione rileggendo il diff dopo ogni task (controllo completo).

Fermati a fine C2. A fine giro: cancello completo, TASKS aggiornato con cosa provare in locale
(acquisizione vera di un HP della sede nuova, misura delle differenze sulla copia del DB dell'hub).

## Giro 3 (22/10): correzioni di fine C2, poi i collector nuovi

Decisioni di Riccardo nel §7 del piano, paragrafo «Fine giro 2». Prima di tutto merge di `origin/dev`.

1. **(a)** Con l'interruttore acceso e un collector per l'apparato, i giri pianificati (`cron/jobs.ts`,
   `upsertSwitchPorts`) non riscrivono le colonne che il collector fornisce. Controllo completo: prova vista rossa
   (il giro notturno che oggi rimette i dati vecchi), interruttore spento = comportamento di oggi.
2. **(c)** `collector` in `leggeViciniDiRete` (`topology/lettori/fonti.ts`), con prova; T1 resta bit per bit.
3. **(e)** `bulk-scan`: gli apparati nel caso dubbio si saltano e si elencano nell'esito, senza 409 per tutto il
   blocco.
4. **C3, collector nuovi**, uno per commit, ognuno col descrittore nel catalogo, allowlist, parser puri, fixture
   anonimizzate dalla forma documentata (non sono uscite vere: dichiaralo nel descrittore, «non collaudato»),
   prova di contratto e guida «Aggiungere una famiglia» rispettata. Ordine:
   `qnap-nas` → `mikrotik-routeros` → `windows` → `linux` → `synology-nas`. Donatori e regole nel piano §5, C3.
   Per `mikrotik-routeros` leggi prima cosa ha fatto la sessione della scheda MikroTik su `dev`
   (`devices/mikrotik-*`, uscite di prova anonime già nel repo) e riusane parser e fixture invece di riscriverli.
   Per `windows` gli script WinRM stanno nell'allowlist del descrittore (`script_winrm`), mai `Win32_Product`.
   Requisiti di regressione dei donatori (§6 del piano): tensione PoE mai come potenza, `vlan-ids` letto,
   colonne per nome e non per posizione.

Fermati a fine `synology-nas` o prima se il tempo non basta, lasciando ogni collector chiuso (mai a metà).
Cancello completo a fine giro, TASKS aggiornato.

## Giro 4 (22/10): i collector collaudati in locale, un collector per famiglia, aggancio

Livello **leggero** (Riccardo, 22/10): prove a fine tappa, cancello a fine giro, nessun revisore per passo.

Fatto nuovo: la notte del 22/10 una sessione locale ha scritto, **collaudati su apparati veri**, i profili
`unifi-controller`, `synology-dsm`, `qnap-nas`, `mikrotik-routeros`, `ubiquiti-device`, `proxmox-ve`, partendo dalla
base di prima di C0 (non conosce `catalogo.ts`). Sono sul ramo **`collector-locali`** (`6bf94155`); descrizione,
copertura e collaudi in `docs/modules/acquisition.md` e nel documento di consegna di quel ramo. Il giro 3 ha scritto
nel frattempo `qnap-nas`, `mikrotik-routeros`, `synology-nas`, `windows`, `linux` **non collaudati**.

0. Merge di `origin/dev`, poi merge di `origin/collector-locali` in `collector-modulari`. Adatta i profili locali al
   catalogo unico (descrittore, versione per collector, allowlist dal catalogo, prova di contratto con la loro
   fixture). Il loro motore `inventory-collector.ts` e l'estensione `inventory` dello snapshot restano.
1. **Un collector per famiglia.** Dove esistono due versioni (QNAP, MikroTik, Synology) la base è quella
   **collaudata** del ramo locale; dalla versione del giro 3 si prende solo ciò che manca e serve (per QNAP il
   firmware vero da `getsysinfo firmver`/`/etc/version` già usato da S2; share e pacchetti NAS se non ci sono), con
   prova. Nome definitivo della famiglia Synology: `synology-dsm` (il nome collaudato). `windows` e `linux` restano.
   Ogni descrittore dice il vero: `collaudato` coi modelli del collaudo per i profili locali, `non_collaudato` per gli
   altri. Nessun id di collector duplicato o orfano nel catalogo.
2. **Porte solo per switch e router**: la proiezione su `switch_ports` vale per le famiglie switch/router (dal
   descrittore); NAS, server, hypervisor, controller e AP non ricevono porte «da switch». Prova.
3. **Aggancio al riconoscimento del prodotto** (`riconosci.ts`) dei collector della famiglia giusta, come gli HP:
   con l'interruttore acceso «Aggiorna» li usa. Il controller UniFi resta separato dai device diretti: non si
   aggancia al pulsante dell'apparato senza una regola chiara (se non c'è, scrivilo in TASKS come decisione).
   `proxmox-ve` con `local_ssh` non è usabile dall'app: nell'app solo credenziali `ssh` dell'archivio.
4. **Scansione dei router dalla pagina Reti** (`POST /api/networks/bulk-scan-devices`): stesso comportamento del
   punto (a) del giro 3 (con interruttore acceso e collector, non riscrive le colonne del collector).
5. Guida «Aggiungere una famiglia» e manuale aggiornati: elenco dei collector con stato di collaudo.

Fermati a fine punto 5. Cancello completo a fine giro, TASKS aggiornato con cosa provare in locale e su quali
apparati. Non toccare il ramo `collector-locali` (si legge e si unisce, non si riscrive).

## Giro 5 (22/10): correzioni dai collaudi, Proxmox fuori dal pulsante, Windows e Linux agganciati

Livello **leggero**. Esiti dei collaudi veri in TASKS.md (sezione «giro 4 dei collector», voci del 22/10). Decisioni nel
§7 del piano, «Fine giro 4». Prima di tutto merge di `origin/dev`.

1. **Linux**: un comando che fallisce (uscita ≠ 0, comando assente, permesso negato) **non è un guasto di trasporto**:
   il lotto continua e quella lettura ha il suo stato (`unsupported`/`error` con codice). Si ferma solo per un guasto
   vero della connessione. Sul collaudo `da-ftp` il lotto si fermava dopo i primi comandi (`SSH_BATCH_ABORTED`). Vale per
   tutti i collector che usano lo stesso lettore SSH a lotti: prova vista rossa.
2. **Synology**: banner e messaggi su stderr del login SSH («Could not chdir to home directory…») non entrano mai nei
   campi: il nome host del collaudo conteneva il messaggio. Su DSM `ip -j` non esiste: ripiego dichiarato (le
   interfacce arrivano già da SNMP), niente errore che sembri un guasto.
3. **QNAP via solo SNMP**: modello e firmware dagli OID enterprise QNAP che il profilo storico già legge
   (`scanner/snmp-vendor-profiles.ts`, `id: "qnap"`: `…24681.1.2.1.0` modello, `.2.0` firmware, `.3.0` seriale) con le
   varianti QTS5 se presenti.
4. **MikroTik**: velocità e duplex dalle bandiere `terse` e dal monitor ethernet (il giro 3 aveva il parser; sul
   collaudo resta `TERSE_FLAGS_AND_NEGOTIATED_SPEED_NOT_INTERPRETED`); PoE su un apparato senza PoE = «non presente»
   (`unsupported` con codice chiaro), non `FORMAT_UNRECOGNIZED_OR_EMPTY`.
5. **Proxmox**: fuori dal riconoscimento del pulsante (decisione 3). Poi il collector `proxmox-ve` si estende verso la
   parità con la scansione Proxmox di oggi (`proxmox/run-proxmox-device-scan.ts`, `proxmox-client.ts`): VM e CT con
   stato, risorse, dischi e reti, storage, nodi. Si confronta campo per campo cosa legge la scansione e cosa il
   collector, e si scrive la tabella della differenza nel manuale. L'aggancio torna solo a parità, con decisione di
   Riccardo.
6. **Windows** (collaudato, esito ok su Windows Server 2022) e **Linux** (dopo il punto 1) agganciati al riconoscimento
   del prodotto, come gli altri; le porte da switch restano solo per switch e router. Descrittore `windows`: collaudato
   (Windows Server 2022 Standard, WinRM 5985, senza ruolo Hyper-V); `linux`: collaudato su Ubuntu 24.04 se il punto 1
   è verde sulla fixture con la forma del collaudo.

Fermati a fine punto 6. Cancello completo, TASKS aggiornato con cosa ricollaudare in locale (Linux `da-ftp`, MikroTik
`192.168.15.254`, QNAP `.24`, Synology `.22`).

## Da lasciare a Riccardo in locale

- Misure su copia del DB dell'hub (S3; differenze dell'anteprima in C2).
- Collaudo dei collector HP nella sede nuova (Comware, ProCurve, ArubaOS) e capire se «ArubaOS» è
  ArubaOS-Switch o AOS-CX (`sysDescr`).
- La resa delle schermate coi dati veri; nel cloud si guardano coi dati finti.
- L'unione in `dev` e il rilascio.

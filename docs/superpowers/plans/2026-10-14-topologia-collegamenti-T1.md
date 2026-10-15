# Topologia §13, tappe T1 e T1b — collegamenti come la rete reale — piano di attuazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** in qualunque rete e con qualunque marca (vincolo 9 di Riccardo, 14/10 sera), la mappa automatica mette ogni apparato sotto il cavo vero — sul cliente A core 1 sotto router 1 sul cavo a 10G, non sotto uno switch di accesso; sulla rete B (l'hub) il router di frontiera su un cavo vero e non su una VLAN, e nessun hypervisor sotto una sua VM — con le porte di una prova sola, l'«Ignora» per cavo, i pareggi decisi da velocità e verso, la testa decisa dalle prove e non dall'id, il protocollo vero dei vicini del router, le linee sul lato più vicino e l'elenco comprimibile (Parte 1, T1); poi toglie dall'albero gli oggetti dichiarati apparati di rete senza una prova, non lascia radici sole, e spiega ogni linea in parole (Parte 2, T1b).

**Architecture:** due rilasci separati, tutti e due a livello leggero, nessuno schema. **T1** corregge il lettore di `/ip neighbor` (stesso comando), aggiunge i **traduttori per prodotto** (`src/lib/topology/lettori/`) e la **chiave della porta** (`src/lib/topology/cavi/porte.ts`), riscrive `links.ts` sui fatti neutri (R-superata, regola del segmento, gruppi per apparato, conferma per porta, una linea per coppia con le porte di un candidato), porta l'«Ignora» al cavo (`ignorati.ts`) e cambia i pareggi dell'albero (`chiaveScelta`); a schermo il lato più vicino (`latiVicini`, una funzione sola per schermo, stampa e misura) e l'elenco comprimibile. **T1b** aggiunge `cavi/ruolo.ts` (prove di ruolo, «Da sistemare»), «Ruolo nella mappa» con la sua rotta, e `cavi/frasi.ts` («Perché questo collegamento»). Prima di toccare il modello si scrive la misura (`scripts/misura-cavi.ts`) e si salva il «prima» sulle copie, con la prova di ritorno R6 subito. T1 prepara anche lo script di «Tornare indietro» per le righe del lettore nuovo (`scripts/ripristina-vicini-router.ts`, Task 10b): la sola scrittura sul DB del cliente del lavoro, a livello completo, che parte solo se si torna indietro e con la conferma di Riccardo. **Il passaggio universale** (spec §13.16, 15/10 notte) porta in T1 cinque regole scritte per ogni rete — la porta fisica e il bridge dalla forma della riga e mai dal nome, gli apparati di una porta contati per apparato, nessun collegamento fra una VM e il suo hypervisor, la testa dalle reti di cui un router è gateway e non dall'id, la velocità di un nome doppio — e in T1b tre (nessuna radice sola, «hypervisor» solo con una prova, lo spanning tree come prova solo se attivo). Le cinque di T1 si spengono una per una **solo per la misura** (`src/lib/topology/regole.ts`, criterio C19: «prima e dopo ognuna»); l'app le ha tutte accese. Le prove su **reti-campione di cinque famiglie inventate** (`src/lib/topology/__tests__/support/reti-campione.ts`, Task 10c: solo MikroTik, solo UniFi, altre marche via SNMP, con hypervisor, mista) dicono per ogni criterio generale G1-G17 se passa, non passa o arriva in un'altra tappa; il cliente A e la rete B sono due misure su reti vere, con le loro prove C e H in `model-fixtures.test.ts`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, better-sqlite3, `node --import tsx --test`, Zod v4, shadcn v4 su `@base-ui/react`, `@xyflow/react` 12, `playwright-core` per la verifica a schermo.

**Spec:** `docs/superpowers/specs/2026-10-14-topologia-collegamenti-reali-design.md` — §13.11.1 (T1, pezzi T1.0-T1.7), §13.11.2 (T1b, pezzi T1b.1-T1b.3), e ciò che richiamano: §13.4-§13.10, §13.12 (scenari S0-S4, S9 e S12, prove-invariante, reti-campione di cinque famiglie del §13.12.2), criteri generali G1-G17 (§13.3.0: di T1 e T1b G1-G10 e G17; gli altri arrivano in T3), criteri sui due casi reali C1-C19, H1-H21 (di T1 e T1b: H1-H2, H4-H7, H9-H10, H13-H17), R1-R7 (§13.3), prove I58-I65 e I70 (§13.12.3), il riepilogo del passaggio universale e le scelte che restano a Riccardo (§13.16), decisioni del §13.15. Le decisioni D1-D7 e le sette scelte del 14/10 sera non si riaprono.

## Global Constraints

- **Repo pubblico.** Niente nomi, IP, MAC o seriali di clienti in codice, prove, fixture, commit, documenti: si scrive «cliente A», «core 1», «core 2», «switch di accesso A/B/C», «router 1», «router 2», «router di riserva»; la rete dell'hub è la «rete B», coi ruoli della spec («router di testa», «aggregazione», «router di frontiera», «router virtuale», «firewall virtuale»). I nomi scelti dal cliente per bridge, VLAN, VRRP e tunnel si scrivono inventati col loro disegno e con un altro numero («BR_RP», «VL_22_CGWR», «vrrp_rete_7»: mai quelli veri, nemmeno la numerazione); un'eccezione sola, scritta: la porta di fabbrica con la velocità in coda del cliente A (`ether1-2.5`), già pubblica nel codice di oggi (`links.ts:58`, `mikrotik-porte.test.ts`) e che il traduttore legge fisica. Nelle fixture anche versioni, firmware, date di build e modelli sono inventati, della stessa lunghezza (modelli di altri prodotti veri: la lunghezza tiene gli a capo del detail). Gli id interi del DB (`dev:114`) non identificano nessuno e possono stare nelle prove. Gli **elenchi per nome** (chi cambia padre, chi esce dall'albero) si danno a Riccardo **solo nella chat**, mai su un file del repo. Le copie dei DB, le istantanee e gli input esportati stanno solo nello scratchpad.
- Lingua: italiano. Orari a Riccardo in **ora italiana**: ora legale, UTC+2, **fino al 25/10 alle 3:00**, poi UTC+1 (la promozione «dopo una settimana» e le date di revisione possono cadere dopo); nel DB sono UTC.
- Interfaccia: testo **≥ 13 px**; **mai il solo colore** (forma più parola: Riccardo è daltonico); schermo di riferimento **1920**; verifica a schermo **una volta per tappa**, a **1280 e 1920**.
- Regole del repo (spec §13.5.1): `db-tenant` importato solo staticamente (ADR 0002); `JSON.parse` sempre in `try`; niente `any` né `console.log`; ogni rotta con `withTenantFromSession` e `requireAuth()` o `requireAdmin()` come prima istruzione; corpi validati con Zod, messaggi in italiano; `db.ts` espone le stesse firme di `db-tenant.ts` dove le espone (regola 12).
- **Nessuno schema** in T1 e T1b (§13.11.1, §13.11.2). Nessun lettore scrive in `device_neighbors.protocol` un valore fuori da `lldp`, `cdp`, `mndp`, `unknown` (`db-tenant-schema.ts:785`); nessun lettore nuovo scrive `unknown`.
- **Nessun comando nuovo sui router** in T1: il lettore tiene `/ip neighbor print terse`. T1-a (router 1 del cliente A, RouterOS 7.24.4) e la lettura dei quattro router della rete B (RouterOS 7.24, la stessa sera; nelle uscite le versioni vanno dalla 7.24.2 alla 7.24.5, prima non è provato) hanno mostrato che `discovered-by` c'è anche nel terse (spec §13.5.2): il protocollo vero viene dallo stesso comando. Il JSON (`:serialize … detail`) non entra in T1: non è provato prima della 7.24.2.
- **Universale** (vincolo 9 di Riccardo, spec §13.3.0): ogni regola vale per qualunque rete e marca. Nessuna regola conosce un nome scelto da un cliente: in `src/lib/topology/cavi/` e `src/lib/topology/lettori/` niente prefissi dei nomi scelti visti sulle reti misurate (`vl_`, `br_`), nemmeno nei commenti (prova I58, Task 3); nel codice di `links.ts` niente nomi di prodotto né forme di porta (prova I37, Task 7); niente valori tarati su un cliente. Ogni regola nuova ha la sua riga su una rete-campione inventata (Task 10c, Task 13); le due reti vere sono misure (criteri C e H), non famiglie. Il resoconto di ogni tappa ha una riga per criterio generale G1-G17 (passa, non passa, arriva in un'altra tappa, da fare).
- **Regole spegnibili solo dalla misura** (C19): `REGOLE_T1` in `src/lib/topology/regole.ts` (Task 6) elenca le cinque regole del passaggio universale entrate in T1 (`nome-scelto-non-fisico`, `conto-per-apparato`, `vm-e-mac-propri`, `testa-per-reti`, `velocita-nomi-doppi`). Il modello le riceve come ultimo parametro con `REGOLE_T1` di base; solo `scripts/misura-cavi.ts --senza-regola <nome>` ne spegne una. Spenta, una regola dà il comportamento che il piano aveva prima del passaggio universale. Se una regola cambia un padre senza un perché, resta fuori da T1 togliendola da `REGOLE_T1`: codice e prove restano.
- **Zona rossa**: l'unica scrittura sul DB del cliente che T1 prepara è lo script di «Tornare indietro» del Task 10b (spec §13.11.1). Il suo task segue il livello completo (prova vista fallire, prova a vuoto di base, copia delle righe prima di scrivere) e lo script parte solo con la conferma di Riccardo.
- Valori alla lettera: soglia «non visto» `topology_link_stale_days` = **2 giorni**; margine di un giro **5 minuti** (`NEIGHBORS_LATEST_ROUND_SQL`); fonti lette dal modello di T1 e dall'attribuzione: **`source IN ('device', 'unifi')`**; chiave della porta **`i:<indice>`** o **`n:<nome normalizzato>`**, normalizzazione neutra = minuscole senza spazi, **mai** togliendo «_» o «+»; rango delle fonti: uplink 1, LLDP/CDP/MNDP 2, a mano 3 (confermato) o 4, tabella MAC 3, VM 3,5; chiave dei pareggi `[★ ? 0 : 1, non visto ? 1 : 0, rango, uplinkFrom === da ? 1 : 0, −velocità]`, poi «da|a».
- Maniglie con id fissi: quelle di oggi `su`, `giu`, `sx`, `dx`, `fondo`; le nuove **`s-su`**, **`s-sx`**, **`t-giu`**, **`t-dx`**.
- Elenco a sinistra: **300 px**; `localStorage` chiave **`da-ipam.topologia.elenco`**, sempre in `try`; etichetta **«◂ Elenco»** quando è aperto, **«Elenco ▸»** quando è chiuso, `aria-pressed` = aperto; di base aperto.
- Testi alla lettera: «**annuncio di rete (MNDP o CDP)**»; voce «**Ignora questo cavo…**»; titolo «**Ignorare il cavo ‹A› · ‹porta› ↔ ‹B› · ‹porta›?**»; testo «**Questo cavo sparisce da tutte le mappe, anche se le letture continuano a vederlo (‹fonti›). Gli altri cavi fra ‹A› e ‹B›, se ci sono, restano. I dati letti non si toccano.**»; riga orfana «**non corrisponde a nessun cavo visto: non toglie niente**» con «**Togli la correzione**» e «**Scegli il cavo da ignorare…**» (nella scelta nessun cavo è già segnato; accanto alla linea: «**è il cavo che oggi regge la linea sulla mappa**»); «**Ripristina**» resta per le righe che nascondono davvero un cavo; «**Altri cavi visti fra questi due oggetti**»; T1b: «**Perché questo collegamento**», «**Ruolo nella mappa ▸ Apparato di rete · Attaccato (server, PC) · Decide il sistema**», valori `topology_role` **`''`**, **`'rete'`**, **`'attaccato'`**, rotta **`PATCH /api/topology/nodes/role { node_id, role }`**; la riga scartata su un nome scelto (T1b, spec §13.4.6): «**‹A› sente ‹B› su ‹pA›, un nome scelto a mano: non si sa se è una porta fisica, e una riga del router su di lei non prova un cavo.**»; più nomi scelti fra gli stessi due oggetti fanno una frase sola: «**‹A› sente ‹B› su ‹p1› e ‹p2›, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.**», con tre o più «**su ‹p1›, ‹p2› e altre ‹n› interfacce**» («e un'altra interfaccia» con tre).
- Misure: tempo del modello **≤ 20 ms** (C17; misurato il 15/10 notte sul prototipo del piano, copia del cliente A con le righe nuove del router, mediana di 30 giri: oggi 13,5 ms, T1 16,9, T1b 18,0 — il margine è stretto, sopra 17 ms lo si dice a Riccardo); ogni oggetto che cambia padre o esce dall'albero è contato e, a Riccardo, elencato per nome prima del rilascio (§13.3); la misura dice su quale lettura delle VM è fatta (R1), e «prima» e «dopo» stanno sulla stessa copia.
- Esecuzione: **al massimo 2 agenti che compilano insieme**, ognuno nel suo worktree; log nello scratchpad, esito dal codice d'uscita (`exit=`), mai dall'output; mai `git add -A`.
- **Ogni push su `dev` è un rilascio al cliente A** (pull, build e riavvio ogni 15 minuti): prima del push la conferma di Riccardo, chiesta **una volta e per esteso** per tre cose insieme: il push, l'aggiornamento dell'hub e il ritorno indietro (revert, `version:release`, push, e lo script del Task 10b se R6 lo chiede) nel caso che i controlli dopo il rilascio vadano male. «Rilasciato» si legge da `ActiveEnterTimestamp`, dalla riga d'avvio nel journal e dal commit in esecuzione, **non** da `/api/version` (cambia prima del riavvio, CONTEXT §6).
- Nessun job si accende in T1 e T1b. Se servisse, prima si leggono la regola d'avvio `scheduler-defaults` e il prefisso delle reti (CONTEXT §6).

## Review Focus

Le condizioni che la spec implica, che nessuna prova della spec copre e che più facilmente morderebbero chi usa la mappa: cinque per T1 e due per T1b, più due dal passaggio universale. Ognuna ha la sua prova nel task che possiede il codice.

1. **Righe dei vicini senza data, o con una data illeggibile** (`timestamp` NULL o rovinato): R-superata e la finestra «non visto» non le perdono e non si fermano; la riga resta e conta come attuale → prova nel **Task 7** («R-superata: una riga senza data leggibile resta»).
2. **Un MAC virtuale (VRRP) come telaio**: il router 1 e il router di riserva annunciano lo stesso MAC VRRP; le loro righe non si fondono in un apparato solo, e non nascondono un segmento → prova nel **Task 7** («il MAC VRRP non è un telaio»).
3. **Lo stesso apparato sentito sulla stessa porta da due fonti** (controller e lettura dell'apparato) o con due telai: è un apparato solo, non un segmento falso → prova nel **Task 7** («due fonti, un apparato»).
4. **Un valore di `print terse`/`detail` con «=» o virgolette dentro** (una descrizione «rack 2 a=b», un nome fra virgolette con `\"`): i campi dopo non si perdono → prova nel **Task 2**.
5. **Un «Ignora» salvato prima di T1**: su un host poi promosso ad apparato (id canonico cambiato) o con le porte nella forma grezza di allora («SFP_ 9», «ether3,bridge»): toglie ancora il cavo giusto, e solo lui → prova nel **Task 9**.

Per T1b (Parte 2), le due condizioni più probabili, aggiunte dalla revisione del 15/10:

6. **Un oggetto senza prove che oggi ha figli** (uno switch dichiarato, senza letture, con un apparato dietro): esce dall'albero, i figli non restano appesi a lui (vanno per un'altra via o diventano radici) e la misura li conta fra i padri cambiati → prova nel **Task 13** («Review Focus 6»).
7. **Un `topology_role` che T1b non conosce**, scritto da una versione successiva («core», «accesso» di T3, spec §13.9) prima di tornare indietro: «core» e «accesso» valgono «Apparato di rete», ogni altro valore «Decide il sistema», niente si rompe → prova nel **Task 13** («Review Focus 7»).

Dal passaggio universale (15/10 notte), le due condizioni più probabili che nessuna prova della spec copre:

8. **Una porta fisica di un MikroTik rinominata dal cliente** («uplink-core» al posto di `sfp-sfpplus1`): è il prezzo dichiarato di non indovinare dal nome (spec §13.13.2). Chi la usa si aspetta il cavo: resta, dal lato dello switch che la vede, con la porta del router non nota; le righe del router su quel nome non danno cavi → prova nel **Task 7** («una porta fisica rinominata su un MikroTik»).
9. **Un `print detail` letto via `ssh`, con un valore spezzato a capo la cui riga che continua comincia con «cifre spazio»** («24 porte e 4 SFP+»): non è un vicino nuovo, e il vicino vero non perde i campi dopo (`discovered-by`, quindi il protocollo) → prova nel **Task 2** («una riga che continua un valore…»).

---

## Struttura dei file

| Pezzo della spec | File | Responsabilità |
| --- | --- | --- |
| T1.7 (parte pura, anticipata) | `src/lib/topology/map-screen.ts` (+ prova) | `Lato`, `candidatiLati`, `latiVicini`, `percorso`, `percorsoDaPunti`, `centroLato`, `siGuardano`, `attraversa`, `ostacoli`, `rettangoli`, `troncoPossibile`, `lineaAlbero`, `maniglieLati` (la memoria dell'elenco la aggiunge il Task 8) |
| T1.1 (fixture del router), T1.2 | `src/lib/devices/mikrotik-vicini.ts` (nuovo), `src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-{terse,terse-ssh,detail-ssh,detail-incollato}.txt` (nuove: le forme vere delle due reti, rese anonime), `router-client.ts`, `edge-look.ts`, `dati-client.tsx` | lettore di `/ip neighbor` coi valori interi e `discovered-by`, sulle forme di due reti; la parola «annuncio di rete (MNDP o CDP)» |
| T1.3 (parte pura) | `src/lib/topology/lettori/{traduci,mikrotik,unifi,generico}.ts` (nuovi), `src/lib/topology/cavi/porte.ts` (nuovo), `links.ts` (solo lo spostamento) | traduttori per prodotto (il contenitore dalla forma, `macDelTelaio`); chiave della porta e indici di un nome doppio; prove I37, I58, I59 |
| T1.0 | `src/lib/topology/misura.ts` (nuovo, logica pura), `scripts/misura-cavi.ts` (nuovo) | conteggi, scenari S0-S4, S9 e S12, C10/C11, istantanee; teste (C19, H17), letture delle VM (R1), linee da un nome scelto (H7, con la scelta del traduttore di `lettori/`), hypervisor sotto una loro VM (H15); sulle copie, togliendo a fine giro la copia del DB |
| T1.1 (fixture del modello), T1.3 (dati) | `model-types.ts`, `db-tenant.ts` (`getTopologyModelInput`, `getAttributionSignalsForHost`), `db.ts`, `attribution/recompute.ts`, `anonimizza.ts`, prove delle fixture | elenco intero delle porte, via di lettura, piattaforma remota, filtro sulle fonti; anonimizzatore |
| T1.5 | `tree.ts`, `sites.ts`, `model.ts`, `model-types.ts`, `src/lib/topology/regole.ts` (nuovo), `scripts/misura-cavi.ts` | `chiaveScelta`; la testa proposta per reti di cui è gateway, non per id (I63); le regole del passaggio universale spegnibili dalla misura (`--senza-regola`, C19) |
| T1.3 (passi 0-3, 5, 6) | `links.ts`, `link-attrs.ts`, `attach.ts`, `node-index.ts`, `model.ts`, `misura.ts`, `scripts/misura-cavi.ts`, `scripts/estrai-fixture-topologia.ts`, `anonimizza.ts`, fixture riestratte | una linea per coppia con le porte di una prova sola; segmenti (e chi resta senza collegamenti su un segmento in «Da sistemare»); velocità per chiave, anche di un nome doppio; per i router col traduttore del loro prodotto un nome scelto non è una porta fisica (H7); le righe di RouterOS contate per apparato (I60); confronto delle fixture senza le VM |
| T1.7 (schermo e stampa) | `map-node.tsx`, `map-canvas.tsx`, `map-edge.tsx`, `map-toolbar.tsx`, `object-list.tsx`, `topology-map-client.tsx`, `print-draw.ts`, `print-map.tsx` | lato più vicino; elenco comprimibile |
| T1.4 (modello) | `src/lib/topology/ignorati.ts` (nuovo), `links.ts`, `attach.ts`, `vm-ports.ts`, `model.ts`, `model-types.ts` | «Ignora» per cavo, porte occupate, VM per cavo, correzioni orfane; nessun collegamento fra una VM e il suo hypervisor, i MAC propri non sono VM, client né vicini (§13.7.8, H15) |
| Reti-campione (§13.12.2, G1-G17) | `src/lib/topology/__tests__/support/reti-campione.ts` (nuovo), `src/lib/topology/__tests__/reti-campione.test.ts` (nuovo), `model-fixtures.test.ts` | cinque famiglie inventate (solo MikroTik, solo UniFi, SNMP di altre marche, con hypervisor, mista), la tabella attesa di ognuna, una prova per criterio e per famiglia; le misure sulle due reti vere (C e H) in `model-fixtures.test.ts` |
| T1.4 (testi), T1.6 | `map-menus.ts`, `topology-map-client.tsx`, `ignored-links.ts`, `ignored-links-card.tsx`, `linked-panel.tsx` | «Ignora questo cavo…», righe orfane, «Altri cavi visti» |
| T1, «Tornare indietro» (R6, spec §13.11.1) | `src/lib/topology/ripristino-vicini.ts` (nuovo), `scripts/ripristina-vicini-router.ts` (nuovo), `scripts/misura-cavi.ts` (`--ripristino`) | il testo SQL che riporta a `mndp` le righe del lettore di T1: prova a vuoto, copia delle righe, scrittura; la stessa scrittura sulla copia della copia |
| Repo pubblico (revisione del 15/10) | prove, un commento nel codice e documenti che su `origin/dev` hanno già dati di clienti (Task 5, Step 6) | valori inventati al loro posto |
| T1b.1 | `src/lib/topology/cavi/ruolo.ts` (nuovo), `src/lib/topology/da-sistemare.ts` (nuovo), `tree.ts`, `attach.ts`, `model.ts`, `model-types.ts`, `misura.ts`, `scripts/misura-cavi.ts`, `object-list.tsx`, `map-canvas.tsx`, `map-node.tsx`, `dati-client.tsx`; i dati finti di quattro prove (Task 13 Step 4); le righe di T1b delle reti-campione | prove di ruolo (lo spanning tree solo se attivo, «hypervisor» solo con una prova), «Da sistemare» col motivo, nessuna radice sola; gli oggetti visti solo via LLDP |
| T1b.2 | `db-tenant.ts` (`setTopologyRole`), `api-input.ts`, `src/app/api/topology/nodes/role/route.ts` (nuovo), `model-types.ts`, `node-index.ts`, `map-menus.ts`, `node-context-menu.tsx`, `topology-map-client.tsx`, `docs/auth-matrix.md` | «Ruolo nella mappa» |
| T1b.3 | `src/lib/topology/cavi/frasi.ts` (nuovo), `model-types.ts`, `links.ts`, `attach.ts`, `vm-ports.ts`, `model.ts`, `edge-look.ts`, `linked-panel.tsx` | «Perché questo collegamento», con la riga scartata su un nome scelto |

**Tocca più file di quanto sembri** (§13.11.1, «Perché è leggera»): l'ingresso del modello, il suo tipo e le fixture cambiano forma (Task 5, Task 7). Chi fa la revisione deve saperlo.

## Esecuzione

`superpowers:subagent-driven-development` con i **controlli leggeri** di Riccardo: un agente per task col suo prompt, prove mirate durante il lavoro, **una sola revisione finale** dell'intera tappa su **Opus** (non una per task), un giro di correzioni senza ri-revisione completa; verifica a schermo una volta per tappa; cancello completo una volta, prima del rilascio. **Al massimo 2 agenti compilano insieme**, ognuno nel suo worktree.

Ramo d'unione `topologia/collegamenti-t1` (da `origin/dev`, con dentro il ramo dei documenti `origin/topologia/collegamenti`, che ha spec e piano: P1), nel worktree `$SCRATCH/ipam-t1`; per T1b `topologia/collegamenti-t1b`, dal ramo d'unione di T1 dopo la sua revisione e il suo cancello, nel worktree `$SCRATCH/ipam-t1b`: il codice di T1b si scrive subito dopo T1, senza aspettare il suo rilascio, e dopo il rilascio di T1 si riallinea a `origin/dev` (P5). Il secondo agente di un'ondata lavora in `$SCRATCH/ipam-t1-b` su un ramo suo creato dal ramo d'unione; a fine ondata la sessione principale lo unisce (`git merge --no-ff`) e fa girare le prove della topologia.

| Ondata | Agente A | Agente B | Dopo l'ondata (sessione principale) |
| --- | --- | --- | --- |
| 1 | Task 1 — geometria dei lati · **Sonnet** | Task 2 — lettore dei vicini · **Sonnet** | unione |
| 2 | Task 3 — traduttori e chiave della porta · **Sonnet** | Task 8 — lato più vicino ed elenco a schermo · **Sonnet** (dai testi fissati: la bozza non lo ferma, P4) | unione |
| 2b | Task 4 — misura e scenari · **Sonnet** (usa il traduttore del Task 3) | — | unione; **misura «prima»** sulle due copie e prova di ritorno R6 col codice di prima (Task 4, Step 6) |
| 3 | Task 5 — ingresso del modello e fixture · **Sonnet** | Task 6 — pareggi · **Sonnet** | unione (prima il 5, poi il 6 ribasato) |
| 4 | Task 7 — una linea per coppia · **Sonnet** | — | unione |
| 5 | Task 9 — «Ignora» per cavo nel modello, VM e MAC propri · **Sonnet** | Task 10b — lo script di «Tornare indietro» · **Opus**, livello completo (zona rossa) | unione |
| 6 | Task 10 — «Ignora questo cavo…», orfane, «Altri cavi visti» · **Sonnet** | Task 10c — reti-campione di cinque famiglie · **Sonnet** | unione; le prove `G… · famiglie …` nel resoconto |
| — | Task 11 (verifica a schermo) e Task 12 (chiusura e rilascio di T1): sessione principale | | |
| T1b-1 | Task 13 — prove di ruolo · **Sonnet** | Task 14 — «Ruolo nella mappa» · **Sonnet** | unione |
| T1b-2 | Task 15 — «Perché questo collegamento» · **Sonnet** | — | unione |
| — | Task 16 (chiusura e rilascio di T1b): sessione principale | | |

**L'ordine cambiato dal passaggio universale (15/10 notte).** Il Task 10b passa dall'ondata 6 alla 5: dipende solo dal Task 4 e non ha file in comune col Task 9 (che ora porta anche il §13.7.8). Il Task 10c, nuovo, sta nell'ondata 6 accanto al Task 10: le reti-campione provano le regole dei Task 3-9 e non toccano file della pagina. **Revisione finale del 15/10 (verifica UV2):** la misura del Task 4 usa il traduttore del Task 3 (`haTraduttore`, `traduciPorta`), che nel ramo d'unione dopo l'ondata 1 non c'è ancora (provato: senza il Task 3 `misura.test.ts` dà «Cannot find module '@/lib/topology/lettori/traduci'» e `tsc` `exit=2`; con il Task 3 prima, verde). Per questo il Task 8, che consuma solo il Task 1 e non ha file in comune col Task 3, sale all'ondata 2, e il Task 4 fa un'ondata sua (2b), subito prima della misura «prima»: i Task 1, 2, 3 e 8 non cambiano il modello, quindi il «prima» resta il codice di oggi. Il Task 7 resta da solo nell'ondata 4. Le ondate di T1 diventano sette.

**Sonnet per tutti gli implementatori**: il codice è scritto qui per intero, e nel livello leggero Opus e il ciclo completo restano per le zone rosse (memoria di Riccardo «controlli leggeri», 28/09 e 06/10). **Opus** solo per le due revisioni finali (Task 12 e 16) e per il Task 10b, che prepara una scrittura sul DB del cliente. Opus sui task del modello (7, 9, 13) vorrebbe una deroga di Riccardo: si chiede in una riga del messaggio del mattino, e per la notte del 14/10 non vale. Le prove si lanciano dal worktree con `node --import tsx --test <file>`; ogni comando che serve a decidere scrive il log nello scratchpad e stampa `exit=$?`.

---

## Preparazione (sessione principale, prima dell'ondata 1)

- [ ] **P1 · Worktree.** `$SCRATCH` è lo scratchpad della sessione che esegue.

```bash
REPO=~/Progetti/Domarc/DA-IPAM
git -C "$REPO" fetch origin
git -C "$REPO" worktree add "$SCRATCH/ipam-t1" -b topologia/collegamenti-t1 origin/dev
git -C "$SCRATCH/ipam-t1" merge --no-ff origin/topologia/collegamenti -m "documenti: spec §13 e piano di T1 e T1b"; echo "merge exit=$?"
cd "$SCRATCH/ipam-t1" && npm ci > "$SCRATCH/npm-ci-t1.log" 2>&1; echo "exit=$?"
```

Atteso: `merge exit=0` e `exit=0`. Il ramo dei documenti `topologia/collegamenti` si pubblica prima (registro della notte, passo 4): spec e piano stanno lì, non su `dev`. Senza questa unione gli agenti non li trovano nel loro worktree, e il Task 12 non può scrivere la sua riga nella spec. L'unione porta solo `docs/`: nessun file di codice cambia. Per ogni ondata con due agenti: `git -C "$REPO" worktree add "$SCRATCH/ipam-t1-b" -b topologia/collegamenti-t1-<task> topologia/collegamenti-t1`, e `npm ci` anche lì.

- [ ] **P2 · Uscite vere T1-a (spec §13.11, tabella «Uscite vere»): fatto.** Il 14/10 sera Riccardo ha incollato, del **router 1**, `/ip neighbor print terse` (un estratto) e `/ip neighbor print detail without-paging` (completo, 52 vicini); stanno nel dossier del cliente A, **fuori dal repo**. Fatti letti: `discovered-by` c'è **anche nel terse** (`lldp`, `cdp,mndp`, `cdp,lldp,mndp`); nel *terse* i valori con spazi **non** hanno virgolette (è la causa delle porte troncate), nel *detail* sì; `interface=X,bridge` è una porta del bridge; i MikroTik remoti annunciano la porta col percorso (`bridge/sfp-sfpplus1`, `bridge/bond1/wlan60-1`, sull'hub anche `‹nome del bridge›/sfp-sfpplus2`); tutti i RouterOS visti dal router 1 sono 7.19 o dopo. **Nessun messaggio a Riccardo prima del Task 2** (mandato della notte del 14/10: domande solo prima del rilascio): il Task 2 parte con la forma del router 1. Le uscite del **router 2** e del **router di riserva** sono facoltative: se servono, si chiedono nel messaggio del mattino, insieme alla domanda di rilascio. Il *detail* resta in uso: dà le righe nuove del router per C18 e per la prova di ritorno R6 (`righeDiUscita` lo legge).
  **Rete B (l'hub), 14/10 dalle 22:12 alle 22:15:** i quattro router MikroTik letti in sola lettura coi comandi della spec (§13.5.2, «Le forme vere»), via `ssh` senza terminale come li legge l'app; le uscite stanno nella cartella di lavoro dell'indagine, fuori dal repo (la sessione principale sa dove: `$USCITA_HUB` è la *terse* di `/ip neighbor` del router di testa). Servono a tre cose: le fixture del lettore (Task 2, già ricavate e scritte nel piano, rese anonime), C18 sulla copia dell'hub (Task 4 Step 6 e Task 12, con `--uscita-router`), e il confronto neutro di Q-T1 sull'hub (H16: le righe nuove del router contro quelle che il lettore legge dall'uscita salvata).

- [ ] **P3 · Copie fresche.** Due copie, del DB del cliente A e del tenant dell'hub, prese con l'API di backup in sola lettura (la via d'accesso sta in `ACCESSI.md` e nel vault; i comandi verso i server da stdin, con heredoc fra apici). Per ognuna, sul server:
  1. `df -h /var/tmp`: lo spazio libero è almeno il doppio del DB (l'hub è 2,1 GB). La copia sta in `/var/tmp`, fuori dalla cartella dei dati dell'app;
  2. `sqlite3 <db> ".backup '/var/tmp/copia-<tenant>.db'"` (copia coerente: il DB vivo non si tocca);
  3. `sha256sum /var/tmp/copia-<tenant>.db`, poi `scp` nello scratchpad come `$SCRATCH/copie/<tenant>.db` (il nome del file è il codice del tenant: lo script lo esige) e `shasum -a 256` sul Mac: le due somme sono uguali;
  4. `rm /var/tmp/copia-<tenant>.db` sul server: nessuna copia del DB del cliente resta sulla sua macchina;
  5. `PRAGMA quick_check` della copia sul Mac (l'hub ha 4 pagine «never used» note, CONTEXT §6).
  6. **R1, la lettura delle VM** (spec §13.3.4): dal 15/10 il job `hypervisor_sync` dell'hub rilegge le VM ogni notte (primo giro il 15/10 alle 5:00, ora italiana), e una VM spenta o spostata cambia i collegamenti «dalle VM». La misura stampa `letture_vm` (per apparato scansionato, la data della scansione più recente) e `stessa_lettura_vm` quando confronta: «prima» e «dopo» si misurano sulla **stessa copia**, e se una copia nuova arriva in mezzo, il «prima» si rifà su di lei.

  I percorsi non vanno mai nel repo né nei commit.

- [ ] **P4 · Bozza di T1 (spec §13.10.4).** Una pagina HTML statica nello scratchpad (`$SCRATCH/bozza-t1.html`; contiene i nomi della copia del cliente A: non si pubblica) con: il pulsante «◂ Elenco» aperto e chiuso; una ridondanza di core 2 prima (dal lato opposto, col giro) e dopo `latiVicini`; un ramo con molti figli (il tronco resta); i dettagli di una linea con «Altri cavi visti fra questi due oggetti»; la riga del 14/10 in «Collegamenti ignorati» con «non corrisponde a nessun cavo visto: non toglie niente», «Togli la correzione» e «Scegli il cavo da ignorare…»; il dialogo «Ignorare il cavo …?». **La bozza non ferma il lavoro**: i Task 8 e 10 partono dai testi fissati alla lettera (Global Constraints, spec §13.9 e §13.10). La bozza va a Riccardo **insieme ai numeri del rilascio** (Task 12; con `SendUserFile` se non è al MacBook), e le sue correzioni entrano nel giro di correzioni, prima del cancello. Perché: il mandato della notte del 14/10 («senza altre domande… chiedimi SOLO prima del rilascio») e la regola del parco «l'interfaccia si propone prima di scriverla» qui si toccano; nel messaggio del mattino si dice a Riccardo come fatto da confermare.

---

## Parte 1 — T1: correzione rapida e disegno

### Task 1: geometria dei lati (T1.7, parte pura — anticipata perché la misura del Task 4 la usa)

Spec §13.10.1 (vincolo 5). Logica pura, nessun effetto sulla pagina finché il Task 8 non la usa: le prove di oggi di `map-screen.test.ts` restano verdi **senza toccare un numero**.

**Files:**
- Modify: `src/lib/topology/map-screen.ts` (in fondo al file; `type Pt` diventa `export type Pt`, riga 121; `import type { LayoutResult } from "@/lib/topology/tree-layout";` in testa, solo tipo: `tree-layout` non importa `map-screen`)
- Test: `src/lib/topology/__tests__/map-screen.test.ts` (in fondo al file)

**Interfaces:**
- Consumes: `Rect` (`map-screen.ts:120`), `MapOrientation` (`model-types.ts:217`), `LR_TRUNK` (`map-screen.ts:73`), `HANDLE_IN`, `HANDLE_OUT`, `HANDLE_IN_LR`, `HANDLE_OUT_LR` (`map-screen.ts:17-19`).
- Produces (tutti esportati da `src/lib/topology/map-screen.ts`):
  - `type Lato = "su" | "giu" | "sx" | "dx"`; `type Pt = { x: number; y: number }`
  - `HANDLE_OUT_SU = "s-su"`, `HANDLE_OUT_SX = "s-sx"`, `HANDLE_IN_GIU = "t-giu"`, `HANDLE_IN_DX = "t-dx"`
  - `maniglieLati(l: { da: Lato; a: Lato }): { source: string; target: string }`
  - `centroLato(r: Rect, l: Lato): Pt`
  - `percorsoDaPunti(pa: Pt, la: Lato, pb: Pt, lb: Lato): Pt[]`
  - `percorso(a: Rect, la: Lato, b: Rect, lb: Lato): Pt[]`
  - `siGuardano(a: Rect, la: Lato, b: Rect, lb: Lato): boolean`
  - `attraversa(punti: readonly Pt[], riquadri: readonly Rect[]): boolean`
  - `candidatiLati(a: Rect, b: Rect, o: MapOrientation): Array<{ da: Lato; a: Lato }>`
  - `latiVicini(a: Rect, b: Rect, o: MapOrientation, ostacoli: readonly Rect[]): { da: Lato; a: Lato }`
  - `ostacoli(riquadri: Iterable<Rect & { id: string }>, tranne: readonly string[]): Rect[]`
  - `rettangoli(layout: LayoutResult): Array<Rect & { id: string }>` (i riquadri della disposizione con il loro id: li usano la misura del Task 4, la pagina e la stampa del Task 8)
  - `troncoPossibile(o: MapOrientation, padre: Rect, figlio: Rect): boolean`
  - `lineaAlbero(o: MapOrientation, padre: Rect, figlio: Rect, ostacoli: readonly Rect[]): { tronco: true } | { tronco: false; lati: { da: Lato; a: Lato } }`

- [ ] **Step 1: le prove che falliscono** — in fondo a `src/lib/topology/__tests__/map-screen.test.ts`; aggiungere all'import da `@/lib/topology/map-screen` i nomi nuovi:

```ts
// ─── Lato più vicino (spec §13.10.1, vincolo 5 di Riccardo, 14/10) ───
// Oggi una ridondanza esce sempre dal lato destro del riquadro più a sinistra ed entra dal sinistro dell'altro
// (`redundantEnds`): fra due riquadri della stessa colonna fa il giro. I candidati sono coppie di lati che si guardano.
import {
  HANDLE_IN_DX, HANDLE_IN_GIU, HANDLE_OUT_SU, HANDLE_OUT_SX,
  attraversa, candidatiLati, latiVicini, lineaAlbero, maniglieLati, ostacoli, percorso, siGuardano, troncoPossibile,
} from "@/lib/topology/map-screen";

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

test("maniglie nuove con id fissi; quelle di oggi restano", () => {
  assert.deepEqual([HANDLE_OUT_SU, HANDLE_OUT_SX, HANDLE_IN_GIU, HANDLE_IN_DX], ["s-su", "s-sx", "t-giu", "t-dx"]);
  assert.deepEqual(maniglieLati({ da: "dx", a: "sx" }), { source: "dx", target: "sx" });
  assert.deepEqual(maniglieLati({ da: "giu", a: "su" }), { source: "giu", target: "su" });
  assert.deepEqual(maniglieLati({ da: "su", a: "giu" }), { source: "s-su", target: "t-giu" });
  assert.deepEqual(maniglieLati({ da: "sx", a: "dx" }), { source: "s-sx", target: "t-dx" });
});

test("candidati: B a destra alla stessa altezza → solo i lati affacciati, percorso dritto", () => {
  const a = R(0, 0, 100, 40), b = R(200, 0, 100, 40);
  assert.deepEqual(candidatiLati(a, b, "lr"), [{ da: "dx", a: "sx" }]);
  assert.deepEqual(percorso(a, "dx", b, "sx"), [{ x: 100, y: 20 }, { x: 200, y: 20 }]);
});

test("candidati: prima l'asse col vuoto maggiore, poi l'altro, poi le due «L» (a pari lunghezza nell'ordine)", () => {
  const a = R(0, 0, 100, 40), b = R(150, 200, 100, 40); // vuoto orizzontale 50, verticale 160
  assert.deepEqual(candidatiLati(a, b, "lr"), [{ da: "giu", a: "su" }, { da: "dx", a: "sx" }, { da: "dx", a: "su" }, { da: "giu", a: "sx" }]);
  assert.deepEqual(percorso(a, "giu", b, "su"), [{ x: 50, y: 40 }, { x: 50, y: 120 }, { x: 200, y: 120 }, { x: 200, y: 200 }]);
  assert.deepEqual(percorso(a, "dx", b, "su"), [{ x: 100, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 200 }]);
});

test("candidati: a pari vuoto vince l'asse dell'orientamento", () => {
  const a = R(0, 0, 100, 40), b = R(150, 90, 100, 40); // 50 e 50
  assert.deepEqual(candidatiLati(a, b, "lr").slice(0, 2), [{ da: "dx", a: "sx" }, { da: "giu", a: "su" }]);
  assert.deepEqual(candidatiLati(a, b, "tb").slice(0, 2), [{ da: "giu", a: "su" }, { da: "dx", a: "sx" }]);
});

test("latiVicini: il primo candidato che non attraversa un riquadro; se tutti attraversano, il più corto", () => {
  const a = R(0, 0, 100, 40), b = R(300, 200, 100, 40);
  const o1 = R(180, 100, 40, 40); // sul gradino della «Z» orizzontale e sul tratto della «Z» verticale
  assert.deepEqual(latiVicini(a, b, "lr", []), { da: "dx", a: "sx" });
  assert.deepEqual(latiVicini(a, b, "lr", [o1]), { da: "dx", a: "su" });
  const o2 = R(340, 60, 30, 40), o3 = R(30, 100, 40, 40); // chiudono anche le due «L»
  assert.deepEqual(latiVicini(a, b, "lr", [o1, o2, o3]), { da: "dx", a: "sx" }); // 400 px contro 430 e 460
  assert.equal(attraversa(percorso(a, "dx", b, "sx"), [o1]), true);
  assert.equal(attraversa(percorso(a, "dx", b, "su"), [o1]), false);
});

test("riquadri sovrapposti (non dovrebbe succedere): nessun candidato, i lati di oggi", () => {
  const a = R(0, 0, 100, 40), b = R(50, 10, 100, 40);
  assert.deepEqual(candidatiLati(a, b, "lr"), []);
  assert.deepEqual(latiVicini(a, b, "lr", []), { da: "dx", a: "sx" });
  assert.deepEqual(latiVicini(a, b, "tb", []), { da: "giu", a: "su" });
});

test("C10: fra due riquadri della stessa colonna i lati di oggi fanno il giro, quelli scelti no", () => {
  const s = R(0, 0, 200, 44), t = R(0, 100, 200, 44);
  assert.equal(siGuardano(s, "dx", t, "sx"), false);
  const l = latiVicini(s, t, "lr", []);
  assert.deepEqual(l, { da: "giu", a: "su" });
  assert.equal(siGuardano(s, l.da, t, l.a), true);
});

test("ostacoli: tutti i riquadri tranne i due capi", () => {
  const r = [{ id: "dev:1", ...R(0, 0, 10, 10) }, { id: "dev:2", ...R(20, 0, 10, 10) }, { id: "apg:dev:1", ...R(40, 0, 10, 10) }];
  assert.deepEqual(ostacoli(r, ["dev:1", "dev:2"]), [R(40, 0, 10, 10)]);
});

test("linee dell'albero: restano a tronco; un figlio spostato a mano dall'altra parte usa il lato più vicino", () => {
  const padre = R(0, 0, 200, 44);
  assert.equal(troncoPossibile("lr", padre, R(304, 100, 180, 44)), true);
  assert.deepEqual(lineaAlbero("lr", padre, R(304, 100, 180, 44), []), { tronco: true });
  assert.deepEqual(lineaAlbero("lr", padre, R(0, 200, 180, 44), []), { tronco: false, lati: { da: "giu", a: "su" } });
  const p2 = R(100, 100, 200, 44);
  assert.deepEqual(lineaAlbero("tb", p2, R(100, 300, 200, 44), []), { tronco: true });
  assert.deepEqual(lineaAlbero("tb", p2, R(100, 0, 200, 44), []), { tronco: false, lati: { da: "su", a: "giu" } });
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/map-screen.test.ts > "$SCRATCH/t1-1.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`, errori «does not provide an export named 'HANDLE_IN_DX'» (o simili) per i nomi nuovi.

- [ ] **Step 3: il codice** — riga 121: `type Pt = { x: number; y: number };` diventa `export type Pt = { x: number; y: number };`. In fondo a `src/lib/topology/map-screen.ts`:

```ts
// ─── Lato più vicino (spec §13.10.1, vincolo 5) ───────────────────────────────
// Una funzione sola per schermo, stampa e misura (ADR 0012, «cosa diventa difficile» 1; prova I31): i lati li sceglie
// solo `latiVicini`, il percorso lo traccia solo `percorso`. Le linee dell'albero restano a tronco, per scelta
// (confermato da Riccardo il 14/10 sera): il lato più vicino vale per ridondanze, linee a mano che non sono dell'albero
// e figli spostati a mano dall'altra parte.

/** Un lato del riquadro. */
export type Lato = "su" | "giu" | "sx" | "dx";

/** Le maniglie che mancavano: uscita in alto e a sinistra, entrata in basso e a destra. Id fissi. */
export const HANDLE_OUT_SU = "s-su", HANDLE_OUT_SX = "s-sx", HANDLE_IN_GIU = "t-giu", HANDLE_IN_DX = "t-dx";

const USCITA: Record<Lato, string> = { su: HANDLE_OUT_SU, giu: HANDLE_OUT, sx: HANDLE_OUT_SX, dx: HANDLE_OUT_LR };
const ENTRATA: Record<Lato, string> = { su: HANDLE_IN, giu: HANDLE_IN_GIU, sx: HANDLE_IN_LR, dx: HANDLE_IN_DX };

/** Le maniglie di React Flow di una linea che esce dal lato `da` ed entra dal lato `a`. */
export function maniglieLati(l: { da: Lato; a: Lato }): { source: string; target: string } {
  return { source: USCITA[l.da], target: ENTRATA[l.a] };
}

/** Il punto a metà di un lato (dove React Flow mette la maniglia). */
export function centroLato(r: Rect, l: Lato): Pt {
  switch (l) {
    case "su": return { x: r.x + r.w / 2, y: r.y };
    case "giu": return { x: r.x + r.w / 2, y: r.y + r.h };
    case "sx": return { x: r.x, y: r.y + r.h / 2 };
    case "dx": return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

const orizzontale = (l: Lato): boolean => l === "sx" || l === "dx";
const arrotonda = (p: Pt): Pt => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });

/**
 * Il percorso ortogonale fra due punti di lato, con al massimo due curve e raggio 0 (come oggi): a «Z» fra lati
 * paralleli, girando a metà; a «L» fra lati perpendicolari; dritto se i due punti sono allineati.
 */
export function percorsoDaPunti(pa: Pt, la: Lato, pb: Pt, lb: Lato): Pt[] {
  if (orizzontale(la) && orizzontale(lb)) {
    if (pa.y === pb.y) return [arrotonda(pa), arrotonda(pb)];
    const mx = (pa.x + pb.x) / 2;
    return [pa, { x: mx, y: pa.y }, { x: mx, y: pb.y }, pb].map(arrotonda);
  }
  if (!orizzontale(la) && !orizzontale(lb)) {
    if (pa.x === pb.x) return [arrotonda(pa), arrotonda(pb)];
    const my = (pa.y + pb.y) / 2;
    return [pa, { x: pa.x, y: my }, { x: pb.x, y: my }, pb].map(arrotonda);
  }
  return (orizzontale(la) ? [pa, { x: pb.x, y: pa.y }, pb] : [pa, { x: pa.x, y: pb.y }, pb]).map(arrotonda);
}

/** Il percorso fra il lato `la` di A e il lato `lb` di B. */
export function percorso(a: Rect, la: Lato, b: Rect, lb: Lato): Pt[] {
  return percorsoDaPunti(centroLato(a, la), la, centroLato(b, lb), lb);
}

/**
 * I due lati si guardano: la linea esce da A verso B ed entra in B venendo da A, senza tornare indietro e senza
 * passare nel proprio riquadro (spec §13.10.1; misura C10). Fra lati paralleli B sta tutto oltre il lato di A; a «L»
 * il gomito sta fuori da tutti e due i riquadri.
 */
export function siGuardano(a: Rect, la: Lato, b: Rect, lb: Lato): boolean {
  if (orizzontale(la) && orizzontale(lb)) {
    return (la === "dx" && lb === "sx" && b.x >= a.x + a.w) || (la === "sx" && lb === "dx" && b.x + b.w <= a.x);
  }
  if (!orizzontale(la) && !orizzontale(lb)) {
    return (la === "giu" && lb === "su" && b.y >= a.y + a.h) || (la === "su" && lb === "giu" && b.y + b.h <= a.y);
  }
  const pa = centroLato(a, la), pb = centroLato(b, lb);
  if (orizzontale(la)) {
    const avanti = la === "dx" ? pb.x > pa.x : pb.x < pa.x;
    const entra = lb === "su" ? pa.y < pb.y : pa.y > pb.y;
    return avanti && entra;
  }
  const avanti = la === "giu" ? pb.y > pa.y : pb.y < pa.y;
  const entra = lb === "sx" ? pa.x < pb.x : pa.x > pb.x;
  return avanti && entra;
}

/** Un tratto orizzontale o verticale passa dentro un riquadro (il bordo non conta). */
function tagliaRiquadro(p: Pt, q: Pt, r: Rect): boolean {
  const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y);
  return x1 < r.x + r.w && x2 > r.x && y1 < r.y + r.h && y2 > r.y;
}

/** Il percorso attraversa almeno un riquadro (scelta di `latiVicini`, misura C11). */
export function attraversa(punti: readonly Pt[], riquadri: readonly Rect[]): boolean {
  for (let i = 1; i < punti.length; i++) for (const r of riquadri) if (tagliaRiquadro(punti[i - 1], punti[i], r)) return true;
  return false;
}

function lunghezza(p: readonly Pt[]): number {
  let s = 0;
  for (let i = 1; i < p.length; i++) s += Math.abs(p[i].x - p[i - 1].x) + Math.abs(p[i].y - p[i - 1].y);
  return s;
}

/**
 * I quattro candidati (spec §13.10.1), in ordine: 1. la coppia di lati affacciati sull'asse dove il vuoto fra i due
 * riquadri è maggiore; 2. quella sull'altro asse; 3-4. le due coppie a «L», prima la più corta. Solo coppie di lati che
 * si guardano: una coppia che tornerebbe indietro non è un candidato. A pari vuoto vince l'asse dell'orientamento
 * (orizzontale in «Verticale», verticale in «Orizzontale»). Riquadri sovrapposti: nessun candidato.
 */
export function candidatiLati(a: Rect, b: Rect, o: MapOrientation): Array<{ da: Lato; a: Lato }> {
  const vuotoX = b.x >= a.x + a.w ? b.x - (a.x + a.w) : a.x >= b.x + b.w ? a.x - (b.x + b.w) : -1;
  const vuotoY = b.y >= a.y + a.h ? b.y - (a.y + a.h) : a.y >= b.y + b.h ? a.y - (b.y + b.h) : -1;
  const destra = b.x + b.w / 2 >= a.x + a.w / 2, sotto = b.y + b.h / 2 >= a.y + a.h / 2;
  const h: { da: Lato; a: Lato } = destra ? { da: "dx", a: "sx" } : { da: "sx", a: "dx" };
  const v: { da: Lato; a: Lato } = sotto ? { da: "giu", a: "su" } : { da: "su", a: "giu" };
  const assi = vuotoX > vuotoY || (vuotoX === vuotoY && o === "lr") ? [h, v] : [v, h];
  const elle = [{ da: h.da, a: v.a }, { da: v.da, a: h.a }]
    .filter((c) => siGuardano(a, c.da, b, c.a))
    .sort((x, y) => lunghezza(percorso(a, x.da, b, x.a)) - lunghezza(percorso(a, y.da, b, y.a)));
  return [...assi.filter((c) => siGuardano(a, c.da, b, c.a)), ...elle];
}

/**
 * Il lato più vicino: il primo candidato il cui percorso non attraversa un altro riquadro; se nessuno passa pulito,
 * quello col percorso più corto. Due riquadri sovrapposti usano i lati di oggi.
 */
export function latiVicini(a: Rect, b: Rect, o: MapOrientation, ostacoli: readonly Rect[]): { da: Lato; a: Lato } {
  const c = candidatiLati(a, b, o);
  if (c.length === 0) return o === "lr" ? { da: "dx", a: "sx" } : { da: "giu", a: "su" };
  return c.find((x) => !attraversa(percorso(a, x.da, b, x.a), ostacoli))
    ?? [...c].sort((x, y) => lunghezza(percorso(a, x.da, b, x.a)) - lunghezza(percorso(a, y.da, b, y.a)))[0];
}

/** Gli ostacoli di una linea: tutti i riquadri della disposizione tranne i suoi due capi. */
export function ostacoli(riquadri: Iterable<Rect & { id: string }>, tranne: readonly string[]): Rect[] {
  const via = new Set(tranne);
  const out: Rect[] = [];
  for (const r of riquadri) if (!via.has(r.id)) out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  return out;
}

/** I riquadri della disposizione con il loro id (i gruppi degli AP: «apg:‹padre›»). */
export function rettangoli(layout: LayoutResult): Array<Rect & { id: string }> {
  return [
    ...[...layout.nodes.values()].map((n) => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })),
    ...layout.apGroups.map((g) => ({ id: `apg:${g.parent}`, x: g.x, y: g.y, w: g.w, h: g.h })),
  ];
}

/** Il figlio sta dalla sua parte: in «Verticale» a destra del tronco del genitore, in «Orizzontale» sotto il genitore. */
export function troncoPossibile(o: MapOrientation, padre: Rect, figlio: Rect): boolean {
  return o === "lr" ? figlio.x >= padre.x + padre.w + LR_TRUNK : figlio.y >= padre.y + padre.h;
}

/** La linea fra un genitore e un figlio: a tronco come oggi; un figlio spostato a mano dall'altra parte, sul lato più vicino. */
export function lineaAlbero(o: MapOrientation, padre: Rect, figlio: Rect, ostacoli: readonly Rect[]):
  { tronco: true } | { tronco: false; lati: { da: Lato; a: Lato } } {
  return troncoPossibile(o, padre, figlio) ? { tronco: true } : { tronco: false, lati: latiVicini(padre, figlio, o, ostacoli) };
}
```

- [ ] **Step 4: verdi**

Run: `node --import tsx --test src/lib/topology/__tests__/map-screen.test.ts > "$SCRATCH/t1-1.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`; le prove di oggi del file verdi senza un numero cambiato. Poi `npx tsc --noEmit > "$SCRATCH/t1-1-tsc.log" 2>&1; echo "exit=$?"` → `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/map-screen.ts src/lib/topology/__tests__/map-screen.test.ts
git commit -m "feat(topologia): lato più vicino delle linee, logica pura (spec §13.10.1)"
```

---

### Task 2: lettore dei vicini del router (T1.1 fixture del router, T1.2)

Spec §13.5.2 (MK1, note, «Le forme vere»), §13.11.1 (T1.1, T1.2), prova I16. T1-a è fatto sul router 1 (P2): la fixture ha la sua forma, con nomi, IP, MAC, versioni e tempi inventati (nessun valore ricalca quelli veri, nemmeno la numerazione). Vale per tutte e quattro le fixture del task: la revisione finale del 15/10 (verifica UV1) ha trovato nelle tre fixture del passaggio universale il nome VRRP del cliente A, i numeri di due sue VLAN e firmware, date di build e modelli veri delle due reti, e li ha inventati della stessa lunghezza. Le uscite di router 2 e router di riserva sono facoltative: se arrivano prima del task, entrano con la stessa forma.

**Dal passaggio universale (vincoli 9 e 10; spec §13.5.2 e §13.12.2):** il lettore si prova sulle forme vere di **due reti**. Tre fixture in più, ricavate dalla sessione del piano (15/10 notte) dalle uscite vere con uno script fuori dal repo, rese anonime con la stessa forma: valori inventati a **pari lunghezza** (così gli a capo del detail restano dove RouterOS li mette), MAC `02:…`, IP `10.x`, IPv6 solo locali, identità e software-id inventati, i nomi scelti dal cliente inventati col loro disegno e con un altro numero («BR_RP», «VL_22_CGWR», «vrrp_rete_7», «vlan57-…»; resta `ether1-2.5`, l'eccezione scritta nelle Global Constraints), versioni, firmware, date di build e modelli inventati della stessa lunghezza (modelli di altri prodotti veri). Controllato dallo script: nessuna identità, IP, MAC, IPv6 o software-id vero, e ogni pezzo di `interface=` e `interface-name=` uguale a un pezzo vero è un nome di fabbrica dell'elenco chiuso dell'anonimizzatore (Task 5): 0 pezzi scelti il 15/10, mentre prima della revisione il controllo non guardava le interfacce e il nome VRRP del cliente A era passato; terse e detail dello stesso router danno gli stessi vicini; il lettore di questo task legge le uscite vere di cinque router di due reti (52, 33, 27, 3 e 2 vicini) come le loro fixture. Le forme che coprono: la terse via `ssh` (una riga per vicino, chiusa da `\r\n`, indici a due cifre senza spazio davanti, i valori con spazi senza virgolette, un bridge e delle VLAN dai nomi scelti, i membri di due fasci nel bridge, lo stesso apparato con più MAC, il CDP inoltrato su un membro di un fascio, un carattere di controllo nella piattaforma scritto come cifre); il detail via `ssh` (a capo a 79 colonne, i campi nuovi rientrati di 4 spazi, un valore spezzato rientrato di 7, il carattere di controllo come `\12`); il detail del router 1 del cliente A incollato dal terminale (commenti e prompt in testa, a capo fra un campo e l'altro fino a 158 colonne). La terse del cliente A incollata dal terminale va a capo a 159 colonne anche a metà parola: il lettore non la legge (legge ciò che arriva da `sshExec`), e la fixture `mikrotik-ip-neighbor-terse.txt` è già una riga per vicino.

**Files:**
- Create: `src/lib/devices/mikrotik-vicini.ts`
- Create: `src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-terse.txt`
- Create: `src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-terse-ssh.txt`, `mikrotik-ip-neighbor-detail-ssh.txt` (righe chiuse da `\r\n`), `mikrotik-ip-neighbor-detail-incollato.txt`
- Create: `src/lib/devices/__tests__/mikrotik-vicini.test.ts`
- Modify: `src/lib/devices/router-client.ts` (import in testa; `:674` usa il lettore nuovo; togliere `parseMikrotikNeighbors` privata, `:1077-1102`)
- Modify: `src/lib/topology/edge-look.ts:115-117` (`SOURCE_WORDS.mndp`)
- Modify: `src/app/(dashboard)/topology/dati/dati-client.tsx:17` (la mappa `FONTE` locale passa da `SOURCE_WORDS`)

**Interfaces:**
- Consumes: `NeighborEntry` (`router-client.ts:47-55`, solo il tipo).
- Produces (da `src/lib/devices/mikrotik-vicini.ts`): `righeDiUscita(output: string): string[]`; `campiTerse(riga: string): Map<string, string>`; `mikrotikProtocol(discoveredBy: string | undefined): "lldp" | "mndp"`; `parseMikrotikNeighbors(output: string): NeighborEntry[]`. Lo usa anche lo script del Task 4 (`--uscita-router`).

- [ ] **Step 1: la fixture anonima con la forma vera** — `src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-terse.txt`, una riga per vicino (come esce da `sshExec`; gli a capo a 160 colonne dell'uscita incollata erano del terminale). Valori inventati; forma del router 1 del 14/10: valori con spazi **senza** virgolette, campi vuoti (`identity=`), `platform=` con la virgola finale, la porta del bridge con «,bridge», la porta remota MikroTik col percorso del bridge, `discovered-by` nelle tre forme viste. Il file finisce con un a capo:

```text
 0 interface=ether1-2.5 mac-address=02:00:00:00:A1:01 identity=SW-ACC-A platform=UBNT version= unpack=none age=14s interface-name=Port 47 system-description=UBNT-USW8P60 system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=lldp
 1 interface=ether1-2.5 address=10.0.9.254 address4=10.0.9.254 mac-address=00:00:5E:00:01:0A identity=RTR-1 platform=MikroTik version=7.21.3 (stable) 2026-03-02 09:15:00 unpack=none age=16s uptime=5d3h10m2s software-id=AAAA-0001 board=CCR1016-12G ipv6=no interface-name=vrrp_rete_7 system-caps= system-caps-enabled= discovered-by=cdp,mndp
 2 interface=ether1-2.5 address=10.0.9.1 address4=10.0.9.1 mac-address=02:00:00:00:B1:01 identity=RTR-1 platform=MikroTik version=7.21.3 (stable) 2026-03-02 09:15:00 unpack=none age=16s uptime=5d3h10m2s software-id=AAAA-0001 board=CCR1016-12G ipv6=no interface-name=bridge/sfp-sfpplus1 system-caps= system-caps-enabled= discovered-by=cdp,mndp
 3 interface=ether3,bridge mac-address=02:00:00:00:C1:01 identity= platform= version= unpack=none age=26s system-caps=bridge system-caps-enabled=wlan-ap discovered-by=lldp
 4 interface=ether8 address=10.0.9.10 address4=10.0.9.10 mac-address=02:00:00:00:D1:01 identity=CORE-1 platform=US-8-60W, version= unpack=none age=11s interface-name=Port 15 - WAN sede system-description=US-8-60W, 7.0.0.10000, Linux 3.10.14 system-caps=bridge system-caps-enabled=bridge discovered-by=lldp
 5 interface=ether8 address=10.0.9.2 address4=10.0.9.2 mac-address=02:00:00:00:B2:01 identity=RTR-RISERVA platform=MikroTik version=7.21.3 (stable) 2026-03-02 09:15:00 unpack=none age=20s uptime=5d3h12m40s software-id=AAAA-0002 board=CCR1016-12G ipv6=no interface-name=bridge/ether8 system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=cdp,lldp,mndp
 6 interface=sfp-sfpplus1,bridge address=10.0.9.10 address4=10.0.9.10 mac-address=02:00:00:00:D1:01 identity=CORE-1 platform=US-8-60W, version= unpack=none age=14s interface-name=Uplink verso il router system-description=US-8-60W, 7.0.0.10000, Linux 3.10.14 system-caps=bridge system-caps-enabled=bridge discovered-by=lldp
 7 interface=vlan10-uffici address=10.0.9.3 address4=10.0.9.3 mac-address=02:00:00:00:B3:01 identity=RTR-2 platform=MikroTik version=7.21.4 (stable) 2026-04-06 14:00:00 unpack=none age=29s uptime=5d3h14m5s software-id=AAAA-0003 board=CCR1016-12G ipv6=no interface-name=vlan10-uffici system-caps= system-caps-enabled= discovered-by=cdp,mndp
 8 interface=ether4,bridge address=10.0.9.4 address4=10.0.9.4 mac-address=02:00:00:00:B4:01 identity=RTR-3 platform=MikroTik version=7.19.6 (stable) 2025-11-03 08:30:00 unpack=none age=31s uptime=9w4d2h7m1s software-id=AAAA-0004 board=CCR1016-12G ipv6=no interface-name=bridge/ether4 system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=lldp
```

Le tre fixture delle due reti, così come sono (gli spazi in fondo alle righe vuote del detail via `ssh` ci sono anche nell'uscita vera; se un editor li toglie, il lettore e le prove non cambiano). **`mikrotik-ip-neighbor-terse-ssh.txt` e `mikrotik-ip-neighbor-detail-ssh.txt` hanno le righe chiuse da `\r\n`**, come le scrive RouterOS via `ssh`: scritti i file, si convertono e si controlla (il repo non ha `.gitattributes` né `core.autocrlf`: git li tiene così; la prova lo verifica):

```bash
cd src/lib/devices/__tests__/fixtures
perl -pi -e 's/\r?\n/\r\n/' mikrotik-ip-neighbor-terse-ssh.txt mikrotik-ip-neighbor-detail-ssh.txt
grep -c $'\r$' mikrotik-ip-neighbor-terse-ssh.txt mikrotik-ip-neighbor-detail-ssh.txt   # atteso: 12 e 81
```

`src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-terse-ssh.txt` (rete B, router di testa, via `ssh`; 12 vicini):

```text
 0 interface=sfp-sfpplus1,BR_RP address=10.191.234.143 address4=10.191.234.143 mac-address=02:00:A0:1D:30:FF identity=AV-SZ-TLP platform=MikroTik version=7.17.2 (stable) 2025-02-11 09:40:12 unpack=none age=43s board=CRS520-4XS-16XQ-RM interface-name=sfp-sfpplus2 system-description=MikroTik RouterOS 7.17.2 (stable) 2025-02-11 09:40:12 CRS520-4XS-16XQ-RM system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=lldp
 1 interface=sfp-sfpplus4,BR_RP mac-address=02:00:A1:7B:35:37 identity= platform= version= unpack=none age=0s system-caps= system-caps-enabled= discovered-by=lldp
 2 interface=sfp-sfpplus11,bond2,BR_RP mac-address=02:00:A2:09:46:1C identity=XS-B1447T-Lpmpud platform=12.0.5.7760 version= unpack=none age=4s interface-name=10GigabitEthernet 1/2 system-description=2.0.1.0001 2026-01-01T00:00:00+08:00 system-caps=bridge system-caps-enabled=bridge discovered-by=lldp
 3 interface=sfp28-1,bond1,BR_RP mac-address=02:00:A0:5B:CD:CC identity=AV-SZ-TLP platform=MikroTik version=7.17.2 (stable) 2025-02-11 09:40:12 unpack=none age=43s interface-name=BR_RP/sfp-sfpplus12 system-caps= system-caps-enabled= discovered-by=cdp
 4 interface=sfp28-1,bond1,BR_RP mac-address=02:00:A3:61:89:AA identity=XC-CSU-WQT-092 platform=USW-EnterpriseXG-24, version= unpack=none age=0s interface-name=SFP28 32 system-description=USW-EnterpriseXG-24, 7.0.11.10000, Linux 4.4.100 system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=lldp
 5 interface=sfp28-1,bond1,BR_RP address=10.255.200.136 address4=10.255.200.136 mac-address=02:00:A0:04:51:EB identity=FM-PU-PKZZ-WBFDLLU platform=MikroTik version=7.16.2 (long-term) 2024-12-03 15:20:44 unpack=none age=36s interface-name=BR_RP/sfp-sfpplus2 system-caps= system-caps-enabled= discovered-by=cdp
 6 interface=sfp28-2,bond1,BR_RP mac-address=02:00:A0:5B:CD:CC identity=AV-SZ-TLP platform=MikroTik version=7.17.2 (stable) 2025-02-11 09:40:12 unpack=none age=43s uptime=2d19h42m48s software-id=EQVT-73B2 board=CRS520-4XS-16XQ-RM ipv6=no interface-name=BR_RP/sfp-sfpplus12 system-caps= system-caps-enabled= discovered-by=mndp
 7 interface=sfp28-2,bond1,BR_RP mac-address=02:00:A3:61:89:AA identity=XC-CSU-WQT-092 platform=USW-EnterpriseXG-24, version= unpack=none age=36s interface-name=SFP28 31 - CA-NCR-XJUK system-description=USW-EnterpriseXG-24, 7.0.11.10000, Linux 4.4.100 system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=lldp
 8 interface=VL_22_CGWR mac-address=02:00:A4:D2:E1:25 identity=HR-NPQ-SNF628-UC platform=MikroTik version=7.18 (stable) 2025-03-17 11:05:30 unpack=none age=22s uptime=3w1d22h4m software-id=WBE9-CU7E board=CRS504-4XQ-IN ipv6=no interface-name=LR-BX/sfp-sfpplus3 system-caps= system-caps-enabled= discovered-by=cdp,mndp
 9 interface=VL_22_CGWR address=10.143.120.130 address4=10.143.120.130 address6=fe80::68b5:b84e:48de:78f6 mac-address=02:00:A4:91:57:87 identity=FU-QHW-EMN platform=MikroTik version=7.18 (stable) 2025-03-17 11:05:30 unpack=none age=0s uptime=3w0d14h0m24s software-id=UW9R-HNM1 board=RB4011iGS+RM ipv6=yes interface-name=bridge1/ether1 system-caps= system-caps-enabled= discovered-by=cdp,mndp
10 interface=VL_22_CGWR address=10.101.109.236 address4=10.101.109.236 mac-address=02:00:A4:0B:CC:52 identity=HR-NPQ-SNF628-UC platform=MikroTik version=7.18 (stable) 2025-03-17 11:05:30 unpack=none age=22s uptime=3w1d22h4m software-id=WBE9-CU7E board=CRS504-4XQ-IN ipv6=no interface-name=ether1 system-caps= system-caps-enabled= discovered-by=cdp,mndp
11 interface=VL_214_BFPTPMF address=10.191.234.143 address4=10.191.234.143 mac-address=02:00:A0:1D:30:FF identity=AV-SZ-TLP platform=MikroTik version=7.17.2 (stable) 2025-02-11 09:40:12 unpack=none age=43s uptime=2d19h42m48s software-id=EQVT-73B2 board=CRS520-4XS-16XQ-RM ipv6=no interface-name=sfp-sfpplus2 system-caps= system-caps-enabled= discovered-by=cdp,mndp
```

`src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-detail-ssh.txt` (lo stesso router allo stesso giro, `print detail` via `ssh`: 81 righe, al massimo 79 colonne):

```text
 0  interface=sfp-sfpplus1,BR_RP address=10.191.234.143 address4=10.191.234.143
    mac-address=02:00:A0:1D:30:FF identity="AV-SZ-TLP" platform="MikroTik"
    version="7.17.2 (stable) 2025-02-11 09:40:12" unpack=none age=43s
    board="CRS520-4XS-16XQ-RM" interface-name="sfp-sfpplus2"
    system-description="MikroTik RouterOS 7.17.2 (stable) 2025-02-11 09:40:12 
       CRS520-4XS-16XQ-RM" system-caps=bridge,router
    system-caps-enabled=bridge,router discovered-by=lldp
 
 1  interface=sfp-sfpplus4,BR_RP mac-address=02:00:A1:7B:35:37 identity=""
    platform="" version="" unpack=none age=0s system-caps=""
    system-caps-enabled="" discovered-by=lldp
 
 2  interface=sfp-sfpplus11,bond2,BR_RP mac-address=02:00:A2:09:46:1C
    identity="XS-B1447T-Lpmpud" platform="\12.0.5.7760" version="" unpack=none
    age=4s interface-name="10GigabitEthernet 1/2"
    system-description="2.0.1.0001 2026-01-01T00:00:00+08:00"
    system-caps=bridge system-caps-enabled=bridge discovered-by=lldp
 
 3  interface=sfp28-1,bond1,BR_RP mac-address=02:00:A0:5B:CD:CC
    identity="AV-SZ-TLP" platform="MikroTik"
    version="7.17.2 (stable) 2025-02-11 09:40:12" unpack=none age=43s
    interface-name="BR_RP/sfp-sfpplus12" system-caps="" system-caps-enabled=""
    discovered-by=cdp
 
 4  interface=sfp28-1,bond1,BR_RP mac-address=02:00:A3:61:89:AA
    identity="XC-CSU-WQT-092" platform="USW-EnterpriseXG-24," version=""
    unpack=none age=0s interface-name="SFP28 32"
    system-description="USW-EnterpriseXG-24, 7.0.11.10000, Linux 4.4.100"
    system-caps=bridge,router system-caps-enabled=bridge,router
    discovered-by=lldp
 
 5  interface=sfp28-1,bond1,BR_RP address=10.255.200.136
    address4=10.255.200.136 mac-address=02:00:A0:04:51:EB
    identity="FM-PU-PKZZ-WBFDLLU" platform="MikroTik"
    version="7.16.2 (long-term) 2024-12-03 15:20:44" unpack=none age=36s
    interface-name="BR_RP/sfp-sfpplus2" system-caps="" system-caps-enabled=""
    discovered-by=cdp
 
 6  interface=sfp28-2,bond1,BR_RP mac-address=02:00:A0:5B:CD:CC
    identity="AV-SZ-TLP" platform="MikroTik"
    version="7.17.2 (stable) 2025-02-11 09:40:12" unpack=none age=43s
    uptime=2d19h42m48s software-id="EQVT-73B2" board="CRS520-4XS-16XQ-RM"
    ipv6=no interface-name="BR_RP/sfp-sfpplus12" system-caps=""
    system-caps-enabled="" discovered-by=mndp
 
 7  interface=sfp28-2,bond1,BR_RP mac-address=02:00:A3:61:89:AA
    identity="XC-CSU-WQT-092" platform="USW-EnterpriseXG-24," version=""
    unpack=none age=36s interface-name="SFP28 31 - CA-NCR-XJUK"
    system-description="USW-EnterpriseXG-24, 7.0.11.10000, Linux 4.4.100"
    system-caps=bridge,router system-caps-enabled=bridge,router
    discovered-by=lldp
 
 8  interface=VL_22_CGWR mac-address=02:00:A4:D2:E1:25
    identity="HR-NPQ-SNF628-UC" platform="MikroTik"
    version="7.18 (stable) 2025-03-17 11:05:30" unpack=none age=22s
    uptime=3w1d22h4m software-id="WBE9-CU7E" board="CRS504-4XQ-IN" ipv6=no
    interface-name="LR-BX/sfp-sfpplus3" system-caps="" system-caps-enabled=""
    discovered-by=cdp,mndp
 
 9  interface=VL_22_CGWR address=10.143.120.130 address4=10.143.120.130
    address6=fe80::68b5:b84e:48de:78f6 mac-address=02:00:A4:91:57:87
    identity="FU-QHW-EMN" platform="MikroTik"
    version="7.18 (stable) 2025-03-17 11:05:30" unpack=none age=0s
    uptime=3w0d14h0m24s software-id="UW9R-HNM1" board="RB4011iGS+RM" ipv6=yes
    interface-name="bridge1/ether1" system-caps="" system-caps-enabled=""
    discovered-by=cdp,mndp
 
10  interface=VL_22_CGWR address=10.101.109.236 address4=10.101.109.236
    mac-address=02:00:A4:0B:CC:52 identity="HR-NPQ-SNF628-UC"
    platform="MikroTik" version="7.18 (stable) 2025-03-17 11:05:30" unpack=none
    age=22s uptime=3w1d22h4m software-id="WBE9-CU7E" board="CRS504-4XQ-IN"
    ipv6=no interface-name="ether1" system-caps="" system-caps-enabled=""
    discovered-by=cdp,mndp
 
11  interface=VL_214_BFPTPMF address=10.191.234.143 address4=10.191.234.143
    mac-address=02:00:A0:1D:30:FF identity="AV-SZ-TLP" platform="MikroTik"
    version="7.17.2 (stable) 2025-02-11 09:40:12" unpack=none age=43s
    uptime=2d19h42m48s software-id="EQVT-73B2" board="CRS520-4XS-16XQ-RM"
    ipv6=no interface-name="sfp-sfpplus2" system-caps="" system-caps-enabled=""
    discovered-by=cdp,mndp
 
```

`src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-detail-incollato.txt` (cliente A, router 1, `print detail without-paging` incollato dal terminale; righe chiuse da `\n`):

```text
# uscita incollata dal terminale: router 1 del cliente A, 14/10 (resa anonima, stessa forma)
# /ip neighbor print detail without-paging

[admin@RTR-1] > /ip neighbor print detail without-paging
 0  interface=ether1-2.5 mac-address=02:00:A5:8B:EC:4A identity="UGZ5Vcp12z-4-JLN" platform="UBNT" version="" unpack=none age=43s interface-name="Port 47"
    system-description="ZWCV-HMXJ60N" system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=lldp

 1  interface=ether1-2.5 address=10.108.9.165 address4=10.108.9.165 mac-address=00:00:5E:00:01:C6 identity="UP-N6-ZZA" platform="MikroTik"
    version="7.17.1 (stable) 2025-01-20 13:10:05" unpack=none age=35s uptime=6w1d23h26m14s software-id="R96R-S85L" board="CCR1016-12G" ipv6=no
    interface-name="vrrp_rete_7" system-caps="" system-caps-enabled="" discovered-by=cdp,mndp

 2  interface=ether1-2.5 address=10.86.103.2 address4=10.86.103.2 mac-address=02:00:A6:13:B8:0D identity="UP-N6-ZZA" platform="MikroTik"
    version="7.17.1 (stable) 2025-01-20 13:10:05" unpack=none age=35s uptime=6w1d23h26m14s software-id="R96R-S85L" board="CCR1016-12G" ipv6=no
    interface-name="bridge/sfp-sfpplus1" system-caps="" system-caps-enabled="" discovered-by=cdp,mndp

 3  interface=ether2 address=10.221.249.52 address4=10.221.249.52 mac-address=02:00:A7:2A:48:97 identity="EK-UEW-83-R9-Z7" platform="MikroTik"
    version="7.15.1 (stable) 2024-08-26 16:45:03" unpack=none age=0s uptime=4w1d10h6m53s software-id="EA25-1K14" board="nRAYG-60adpro" ipv6=no
    interface-name="bridge/bond1/wlan60-1" system-caps="" system-caps-enabled="" discovered-by=cdp,mndp

 4  interface=ether3,bridge mac-address=02:00:A8:94:49:7B identity="" platform="" version="" unpack=none age=4s
    system-caps=repeater,bridge,wlan-ap,router,telephone,docsis-cable-device,station-only system-caps-enabled=bridge,telephone,docsis-cable-device
    discovered-by=lldp

 5  interface=ether4,bridge address=10.243.2.41 address4=10.243.2.41 mac-address=02:00:A6:14:64:87 identity="QM-N5-ZXS" platform="MikroTik"
    version="7.17.2 (stable) 2025-02-11 09:40:12" unpack=none age=35s uptime=0w1d0h3m6s software-id="5B00-X9WQ" board="CCR1016-12G" ipv6=yes
    interface-name="bridge/ether4" system-description="MikroTik RouterOS 7.17.2 (stable) 2025-02-11 09:40:12 CCR1016-12G" system-caps=bridge,router
    system-caps-enabled=bridge,router discovered-by=cdp,lldp,mndp

 6  interface=ether8 address=10.156.74.199 address4=10.156.74.199 mac-address=02:00:A0:B3:B1:98 identity="KJ-J7-ETHV" platform="MikroTik"
    version="7.17.1 (stable) 2025-01-20 13:10:05" unpack=none age=35s uptime=6w5d23h40m19s software-id="AFWP-GMGC" board="CCR1016-12G" interface-name="ether8"
    system-description="MikroTik RouterOS 7.17.1 (stable) 2025-01-20 13:10:05 CCR1016-12G" system-caps=bridge,router system-caps-enabled=bridge,router
    discovered-by=cdp,lldp,mndp

 7  interface=ether8 address=10.223.7.5 address4=10.223.7.5 mac-address=02:00:A9:5D:41:7C identity="AGE3-NMMD-32US-13" platform="US-8-60W," version=""
    unpack=none age=28s interface-name="Port 15 - XJS UZQ3 - Vkmeqvj" system-description="US-8-60W, 7.0.10.10000, Linux 3.6.0" system-caps=bridge
    system-caps-enabled=bridge discovered-by=lldp

 8  interface=sfp-sfpplus1,bridge address=10.223.7.5 address4=10.223.7.5 mac-address=02:00:A9:5D:41:7C identity="AGE3-NMMD-32US-13" platform="US-8-60W,"
    version="" unpack=none age=20s interface-name="Muczxpxa WU9649 KDM6 1.17" system-description="US-8-60W, 7.0.10.10000, Linux 3.6.0" system-caps=bridge
    system-caps-enabled=bridge discovered-by=lldp

 9  interface=vlan57-NJL79 address=10.129.8.153 address4=10.129.8.153 mac-address=02:00:A0:CD:D3:12 identity="KJ-J7-ETHV" platform="MikroTik"
    version="7.17.1 (stable) 2025-01-20 13:10:05" unpack=none age=35s uptime=6w5d23h40m19s software-id="AFWP-GMGC" board="CCR1016-12G" ipv6=no
    interface-name="vlan57-NJL79" system-caps="" system-caps-enabled="" discovered-by=cdp,mndp

10  interface=vrrp_rete_7 mac-address=02:00:A6:77:23:20 identity="UP-N6-ZZA" platform="MikroTik" version="7.17.1 (stable) 2025-01-20 13:10:05" unpack=none
    age=35s uptime=6w1d23h26m14s software-id="R96R-S85L" board="CCR1016-12G" ipv6=no interface-name="ether1-2.5" system-caps="" system-caps-enabled=""
    discovered-by=cdp,mndp

11  interface=vlan63-KKLDZVDFNJ mac-address=02:00:A6:A3:49:49 identity="KM-T1-PXA" platform="MikroTik" version="7.17.1 (stable) 2025-01-20 13:10:05"
    unpack=none age=21s uptime=2w1d12h27m54s software-id="V8HH-KA5V" board="CCR1016-12G" ipv6=no interface-name="vlan63_Lzemudfduc" system-caps=""
    system-caps-enabled="" discovered-by=cdp,mndp
```

- [ ] **Step 2: le prove che falliscono** — `src/lib/devices/__tests__/mikrotik-vicini.test.ts`:

```ts
// Spec topologia §13.5.2 (lettore di T1, prova I16). Incidente del 14/10: il lettore di prima leggeva ogni valore
// fino al primo spazio — nel «terse» RouterOS non mette le virgolette ai valori con gli spazi, e «Port 47» diventava
// «Port» — e scriveva sempre `mndp`, anche per le righe LLDP (sul cliente A 0 righe `lldp` su 52 del router 1).
// Fixture: la forma vera dell'uscita del router 1 del 14/10, con nomi, IP e MAC inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { campiTerse, mikrotikProtocol, parseMikrotikNeighbors, righeDiUscita } from "@/lib/devices/mikrotik-vicini";

const TERSE = fs.readFileSync(path.join(__dirname, "fixtures", "mikrotik-ip-neighbor-terse.txt"), "utf8");

test("valori interi: i valori con gli spazi senza virgolette finiscono alla chiave dopo", () => {
  const v = parseMikrotikNeighbors(TERSE);
  assert.equal(v.length, 9);
  assert.deepEqual(v[0], {
    localPort: "ether1-2.5", remoteDevice: "SW-ACC-A", remotePort: "Port 47", protocol: "lldp",
    remoteIp: undefined, remoteMac: "02:00:00:00:A1:01", remotePlatform: "UBNT",
  });
  assert.equal(v[4].remotePort, "Port 15 - WAN sede");
  assert.equal(v[6].remotePort, "Uplink verso il router");
  assert.equal(v[4].remotePlatform, "US-8-60W,");
  // Q-T1 in forma neutra (vale per ogni rete): nessuna porta remota senza spazio che sia la prima parola di un'altra con lo spazio.
  const conSpazio = v.map((x) => x.remotePort).filter((r) => r.includes(" "));
  assert.deepEqual(v.filter((x) => x.remotePort !== "" && !x.remotePort.includes(" ") && conSpazio.some((r) => r.startsWith(`${x.remotePort} `))), []);
});

test("campi vuoti: «identity= platform=» resta vuoto, non si mangia la chiave dopo", () => {
  const radio = parseMikrotikNeighbors(TERSE)[3];
  assert.deepEqual([radio.localPort, radio.remoteDevice, radio.remotePort, radio.remotePlatform, radio.protocol], ["ether3,bridge", "", "", undefined, "lldp"]);
});

test("I16 — il protocollo è quello letto: lldp se c'è, altrimenti mndp (anche con cdp); senza il campo mndp", () => {
  assert.equal(mikrotikProtocol("lldp"), "lldp");
  assert.equal(mikrotikProtocol("cdp,lldp,mndp"), "lldp");
  assert.equal(mikrotikProtocol("cdp,mndp"), "mndp"); // il CDP di un MikroTik attraversa gli switch: non conferma un cavo (M-5)
  assert.equal(mikrotikProtocol("cdp"), "mndp");
  assert.equal(mikrotikProtocol(undefined), "mndp"); // RouterOS prima della 7.7: come prima
  assert.equal(mikrotikProtocol(""), "mndp");
  assert.deepEqual(parseMikrotikNeighbors(TERSE).map((x) => x.protocol), ["lldp", "mndp", "mndp", "lldp", "lldp", "lldp", "lldp", "mndp", "lldp"]);
});

test("indirizzo: address4 prima di address; un IPv6 non è un IP del modello; il MAC in maiuscolo", () => {
  const v = parseMikrotikNeighbors(" 0 interface=ether2 address=fe80::1 mac-address=02:00:00:00:e1:01 identity=X discovered-by=lldp\n");
  assert.deepEqual([v[0].remoteIp, v[0].remoteMac], [undefined, "02:00:00:00:E1:01"]);
  assert.equal(parseMikrotikNeighbors(TERSE)[1].remoteIp, "10.0.9.254");
});

test("Review Focus 4 — «=» e virgolette dentro un valore del detail non fanno perdere i campi dopo", () => {
  const c = campiTerse(' 9  interface=ether2 identity="Radio 60 \\"lontana\\"" system-description="rack 2 a=b" interface-name="bridge/bond1/wlan60-1" discovered-by=lldp');
  assert.equal(c.get("identity"), 'Radio 60 "lontana"');
  assert.equal(c.get("system-description"), "rack 2 a=b");
  assert.equal(c.get("interface-name"), "bridge/bond1/wlan60-1");
  assert.equal(c.get("discovered-by"), "lldp");
  assert.equal(c.has("a"), false);
});

// Il detail incollato da Riccardo (T1-a) dà le righe nuove del router per C18 e per la prova di ritorno R6.
test("il detail incollato: righe a capo, prompt e commenti", () => {
  const detail = [
    "# uscita incollata", "[admin@RTR-1] > /ip neighbor print detail without-paging",
    ' 0  interface=ether1-2.5 mac-address=02:00:00:00:A1:01 identity="SW-ACC-A" platform="UBNT" version="" interface-name="Port 47"',
    '    system-description="UBNT-USW8P60" system-caps=bridge,router system-caps-enabled=bridge,router discovered-by=lldp', "",
    ' 1  interface=sfp-sfpplus1,bridge identity="CORE-1" interface-name="Uplink verso il router" discovered-by=lldp',
  ].join("\n");
  assert.deepEqual(righeDiUscita(detail).length, 2);
  const v = parseMikrotikNeighbors(detail);
  assert.deepEqual(v.map((x) => [x.localPort, x.remotePort, x.protocol]), [["ether1-2.5", "Port 47", "lldp"], ["sfp-sfpplus1,bridge", "Uplink verso il router", "lldp"]]);
});

test("una riga senza interfaccia né identità non è un vicino; «Flags:» non è una riga", () => {
  assert.deepEqual(parseMikrotikNeighbors("Flags: X - disabled\n 0 age=3s discovered-by=lldp\n"), []);
});

// ─── Le forme vere di due reti (spec §13.5.2, «Le forme vere»; vincolo 9 di Riccardo: il lettore vale per ogni rete) ───
// Rete B (l'hub): il router di testa, RouterOS 7.24, letto via ssh senza terminale come lo legge l'app (14/10 sera): righe
// chiuse da «\r\n», indici a due cifre senza spazio davanti, un bridge e delle VLAN coi nomi scelti, i membri di due fasci
// nel bridge, lo stesso apparato sentito con più MAC, CDP inoltrato su un membro di un fascio, un carattere di controllo
// nella piattaforma. Cliente A: il detail del router 1 incollato dal terminale (T1-a). Valori inventati a pari lunghezza:
// gli a capo restano dove RouterOS li mette (79 colonne via ssh; la larghezza del terminale, fino a 158, se incollato).
const leggi = (nome: string): string => fs.readFileSync(path.join(__dirname, "fixtures", nome), "utf8");
const TERSE_SSH = leggi("mikrotik-ip-neighbor-terse-ssh.txt");
const DETAIL_SSH = leggi("mikrotik-ip-neighbor-detail-ssh.txt");
const DETAIL_INCOLLATO = leggi("mikrotik-ip-neighbor-detail-incollato.txt");

test("rete B via ssh: «\\r\\n» a fine riga, indici a due cifre, contenitori coi nomi scelti, valori con spazi interi", () => {
  assert.equal((TERSE_SSH.match(/\r\n/g) ?? []).length, 12, "la fixture tiene i \\r\\n dell'uscita vera");
  const v = parseMikrotikNeighbors(TERSE_SSH);
  assert.deepEqual(v.map((x) => x.localPort), [
    "sfp-sfpplus1,BR_RP", "sfp-sfpplus4,BR_RP", "sfp-sfpplus11,bond2,BR_RP", "sfp28-1,bond1,BR_RP", "sfp28-1,bond1,BR_RP",
    "sfp28-1,bond1,BR_RP", "sfp28-2,bond1,BR_RP", "sfp28-2,bond1,BR_RP", "VL_22_CGWR", "VL_22_CGWR", "VL_22_CGWR", "VL_214_BFPTPMF",
  ]);
  // lldp solo dove `discovered-by` lo dice; cdp e mndp sono annunci di segmento (M-5)
  assert.deepEqual(v.map((x) => x.protocol), ["lldp", "lldp", "lldp", "mndp", "lldp", "mndp", "mndp", "lldp", "mndp", "mndp", "mndp", "mndp"]);
  assert.deepEqual([v[2].remotePort, v[4].remotePort, v[7].remotePort, v[8].remotePort], ["10GigabitEthernet 1/2", "SFP28 32", "SFP28 31 - CA-NCR-XJUK", "LR-BX/sfp-sfpplus3"]);
  assert.deepEqual([v[1].remoteDevice, v[1].remotePort, v[1].remotePlatform], ["", "", undefined]);
  assert.equal(v.some((x) => /\r/.test(`${x.localPort}${x.remoteDevice}${x.remotePort}${x.remotePlatform ?? ""}`)), false);
});

test("rete B: lo stesso apparato con più MAC (nelle righe di RouterOS il MAC è dell'interfaccia che annuncia, spec §13.6.4)", () => {
  const v = parseMikrotikNeighbors(TERSE_SSH);
  const mac = (nome: string, porta?: string) =>
    [...new Set(v.filter((x) => x.remoteDevice === nome && (porta === undefined || x.localPort === porta)).map((x) => x.remoteMac))].length;
  assert.equal(mac("AV-SZ-TLP"), 2);
  assert.equal(mac("HR-NPQ-SNF628-UC", "VL_22_CGWR"), 2, "due MAC sulla stessa interfaccia locale");
  // su un membro del fascio: l'aggregazione via LLDP e due apparati dietro di lei via CDP, che il lettore scrive `mndp`
  assert.deepEqual(v.filter((x) => x.localPort === "sfp28-1,bond1,BR_RP").map((x) => x.protocol).sort(), ["lldp", "mndp", "mndp"]);
});

test("rete B: terse e detail via ssh dello stesso router danno gli stessi vicini (il detail va a capo a 79 colonne)", () => {
  assert.equal((DETAIL_SSH.match(/\r\n/g) ?? []).length, 81);
  assert.equal(Math.max(...DETAIL_SSH.split("\r\n").map((r) => r.length)), 79);
  assert.equal(righeDiUscita(DETAIL_SSH).length, 12);
  const t = parseMikrotikNeighbors(TERSE_SSH), d = parseMikrotikNeighbors(DETAIL_SSH);
  // Il carattere di controllo nella piattaforma: la terse lo scrive come cifre, il detail con «\» (spec §13.5.2, MK1).
  assert.deepEqual([t[2].remotePlatform, d[2].remotePlatform], ["12.0.5.7760", "\\12.0.5.7760"]);
  const senza = (x: (typeof t)[number]) => ({ ...x, remotePlatform: x.remotePlatform === "\\12.0.5.7760" ? "12.0.5.7760" : x.remotePlatform });
  assert.deepEqual(d.map(senza), t);
  // Un valore fra virgolette spezzato a capo (riga rientrata di 7 spazi) si ricompone con uno spazio.
  assert.equal(campiTerse(righeDiUscita(DETAIL_SSH)[0]).get("system-description"), "MikroTik RouterOS 7.17.2 (stable) 2025-02-11 09:40:12 CRS520-4XS-16XQ-RM");
});

test("cliente A: il detail del router 1 incollato dal terminale (commenti, prompt, a capo fra un campo e l'altro)", () => {
  assert.equal(Math.max(...DETAIL_INCOLLATO.split("\n").map((r) => r.length)), 158);
  assert.equal(righeDiUscita(DETAIL_INCOLLATO).length, 12);
  const v = parseMikrotikNeighbors(DETAIL_INCOLLATO);
  assert.deepEqual(v.map((x) => [x.localPort, x.remotePort, x.protocol]), [
    ["ether1-2.5", "Port 47", "lldp"],
    ["ether1-2.5", "vrrp_rete_7", "mndp"],
    ["ether1-2.5", "bridge/sfp-sfpplus1", "mndp"],
    ["ether2", "bridge/bond1/wlan60-1", "mndp"],
    ["ether3,bridge", "", "lldp"],
    ["ether4,bridge", "bridge/ether4", "lldp"],
    ["ether8", "ether8", "lldp"],
    ["ether8", "Port 15 - XJS UZQ3 - Vkmeqvj", "lldp"],
    ["sfp-sfpplus1,bridge", "Muczxpxa WU9649 KDM6 1.17", "lldp"],
    ["vlan57-NJL79", "vlan57-NJL79", "mndp"],
    ["vrrp_rete_7", "ether1-2.5", "mndp"],
    ["vlan63-KKLDZVDFNJ", "vlan63_Lzemudfduc", "mndp"],
  ]);
  assert.equal(v[1].remoteMac, "00:00:5E:00:01:C6", "il MAC VRRP resta virtuale");
  assert.deepEqual([v[4].remoteDevice, v[4].remotePlatform], ["", undefined], "la radio: identità e piattaforma vuote");
});

// Un valore fra virgolette va a capo su uno spazio qualunque: la riga che lo continua può cominciare con «cifre spazio».
// Prima ogni riga che cominciava con un numero apriva un vicino, e il vicino vero perdeva i campi dopo (`discovered-by`:
// diventava `mndp`). Un indice ha al massimo due spazi davanti, una riga che continua almeno tre.
test("una riga che continua un valore e comincia con «cifre spazio» non apre un vicino nuovo", () => {
  const detail = [
    ' 0  interface=ether5 mac-address=02:00:00:00:E5:01 identity="SW-5" system-description="Switch gestito con ',
    '       24 porte e 4 SFP+" interface-name="Port 24" discovered-by=lldp',
    "",
    ' 1  interface=ether6 identity="SW-6" discovered-by=cdp,mndp',
  ].join("\r\n");
  assert.equal(righeDiUscita(detail).length, 2);
  assert.deepEqual(parseMikrotikNeighbors(detail).map((x) => [x.localPort, x.remotePort, x.protocol]), [["ether5", "Port 24", "lldp"], ["ether6", "", "mndp"]]);
});

test("le fixture sono anonime: solo MAC 02:… o virtuali, solo IP 10.x, IPv6 solo locali", () => {
  for (const testo of [TERSE, TERSE_SSH, DETAIL_SSH, DETAIL_INCOLLATO]) {
    for (const m of testo.match(/\b[0-9A-F]{2}(?::[0-9A-F]{2}){5}\b/gi) ?? []) assert.match(m, /^(02:|00:00:5E:00:0[12]:)/i, m);
    for (const ip of testo.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) assert.match(ip, /^10\./, ip);
    for (const v6 of testo.match(/address6=\S+/g) ?? []) assert.match(v6, /^address6=fe80::/, v6);
  }
});
```

- [ ] **Step 3: vederle fallire**

Run: `node --import tsx --test src/lib/devices/__tests__/mikrotik-vicini.test.ts > "$SCRATCH/t1-2.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`, «Cannot find module '@/lib/devices/mikrotik-vicini'». (Verificato sul prototipo del piano, 15/10 notte: col lettore di prima della correzione qui sotto, l'unica prova rossa fra le nuove è «una riga che continua un valore…»; le prove sulle forme vere sono verdi, cioè il lettore regge le due reti.)

- [ ] **Step 4: il codice** — `src/lib/devices/mikrotik-vicini.ts`:

```ts
/**
 * I vicini di un MikroTik da `/ip neighbor print terse` (spec topologia §13.5.2, lettore di T1). Logica pura.
 *
 * Perché esiste: il lettore di prima (router-client.ts) leggeva ogni valore fino al primo spazio, e nel «terse»
 * RouterOS non mette le virgolette ai valori con gli spazi (uscita vera del router 1 del cliente A, 14/10): «Port 47»
 * diventava «Port», un nome di porta dato dal cliente si fermava alla prima parola. E scriveva sempre `mndp`, anche per
 * le righe LLDP. Qui una riga si divide sul confine « chiave=» (una chiave è `[a-z][a-z0-9-]*`) e un valore va dalla
 * sua chiave alla chiave dopo; un valore fra virgolette (la forma di `print detail`) va fino alla virgoletta che lo
 * chiude. Il protocollo viene da `discovered-by` (RouterOS 7.7 e dopo). Stesso comando di prima: nessun comando nuovo
 * sui router dei clienti in un rilascio leggero (D1, confermato il 14/10 sera).
 * Limite noto: in un valore SENZA virgolette, uno spazio seguito da «parola=» è letto come la chiave dopo (il «terse»
 * non lo può distinguere).
 */
import type { NeighborEntry } from "@/lib/devices/router-client";

const CHIAVE = /(?:^|\s)([a-z][a-z0-9-]*)=/g;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

/**
 * Le righe di un'uscita, una per vicino. Un vicino comincia con l'indice, che ha al massimo due spazi davanti (la colonna
 * degli indici è larga quanto l'indice più lungo: fino a 999 vicini). Una riga rientrata di tre spazi o più lo continua: il
 * `print detail` va a capo da sé, fra un campo e l'altro (3, 4 o 5 spazi, secondo la larghezza degli indici) e, via ssh a
 * 79 colonne, anche dentro un valore fra virgolette (7 spazi); va a capo sempre su uno spazio, e per questo le righe si
 * uniscono con uno spazio. Una riga che continua un valore può cominciare con «cifre spazio» («24 porte»): con la regola di
 * prima (un numero in testa apre un vicino) il vicino vero perdeva i campi dopo. Commenti («#») e prompt di un'uscita
 * incollata stanno a inizio riga e non contano. La terse incollata da un terminale va a capo a metà parola e senza rientro:
 * il lettore legge ciò che arriva da `sshExec`, e la fixture di una terse incollata la ricompone in una riga.
 */
export function righeDiUscita(output: string): string[] {
  const out: string[] = [];
  for (const riga of output.split(/\r?\n/)) {
    if (/^#/.test(riga) || /^\[[^\]]*\]\s*>/.test(riga)) continue;
    if (/^ {0,2}\d+\s/.test(riga)) out.push(riga.trim());
    else if (/^\s{3,}\S/.test(riga) && out.length > 0) out[out.length - 1] += ` ${riga.trim()}`;
  }
  return out;
}

/** La virgoletta che chiude un valore che comincia a `da` (una `\"` dentro il valore non chiude). */
function chiusa(riga: string, da: number): number {
  for (let i = da; i < riga.length; i++) {
    if (riga[i] === "\\") { i++; continue; }
    if (riga[i] === '"') return i;
  }
  return -1;
}

/** Le coppie chiave=valore di una riga `print terse` o `print detail`. L'indice e i flag in testa non si leggono. */
export function campiTerse(riga: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(CHIAVE.source, "g");
  let m = re.exec(riga);
  while (m) {
    const chiave = m[1];
    const inizio = m.index + m[0].length;
    let valore: string;
    if (riga[inizio] === '"') {
      const fine = chiusa(riga, inizio + 1);
      valore = (fine < 0 ? riga.slice(inizio + 1) : riga.slice(inizio + 1, fine)).replace(/\\"/g, '"');
      re.lastIndex = fine < 0 ? riga.length : fine + 1;
      m = re.exec(riga);
    } else {
      const dopo = re.exec(riga);
      valore = riga.slice(inizio, dopo ? dopo.index : riga.length).trim();
      m = dopo;
    }
    if (!out.has(chiave)) out.set(chiave, valore);
  }
  return out;
}

/**
 * Il protocollo da `discovered-by` (spec §13.5.2): `lldp` se l'elenco lo contiene; altrimenti `mndp`, anche con `cdp`:
 * il CDP di un MikroTik attraversa gli switch che non sono Cisco, e scritto `cdp` confermerebbe un cavo e riporterebbe
 * il falso cavo fra router (revisione M-5). Senza il campo (RouterOS prima della 7.7) resta `mndp`, come prima.
 */
export function mikrotikProtocol(discoveredBy: string | undefined): "lldp" | "mndp" {
  const elenco = (discoveredBy ?? "").split(",").map((s) => s.trim().toLowerCase());
  return elenco.includes("lldp") ? "lldp" : "mndp";
}

/** `/ip neighbor print terse` (o `print detail`) → i vicini, coi valori interi e il protocollo vero. */
export function parseMikrotikNeighbors(output: string): NeighborEntry[] {
  const entries: NeighborEntry[] = [];
  for (const riga of righeDiUscita(output)) {
    const c = campiTerse(riga);
    const iface = c.get("interface") ?? "";
    const remoteName = c.get("identity") ?? "";
    if (!iface && !remoteName) continue;
    const ip = c.get("address4") || c.get("address") || "";
    const mac = c.get("mac-address") ?? "";
    const platform = c.get("platform") ?? "";
    entries.push({
      localPort: iface,
      remoteDevice: remoteName,
      remotePort: c.get("interface-name") ?? "",
      protocol: mikrotikProtocol(c.get("discovered-by")),
      remoteIp: IPV4.test(ip) ? ip : undefined,
      remoteMac: MAC.test(mac) ? mac.toUpperCase() : undefined,
      remotePlatform: platform || undefined,
    });
  }
  return entries;
}
```

In `src/lib/devices/router-client.ts`: in testa, accanto a `import { parseMikrotikInterfaceTypes, parseMikrotikMacTable } from "./mikrotik-porte";`, aggiungere `import { parseMikrotikNeighbors } from "./mikrotik-vicini";`; togliere la funzione privata `parseMikrotikNeighbors` (righe 1077-1102, col commento «/** MikroTik: /ip neighbor print terse */»). `getNeighbors()` a `:672-675` resta com'è (chiama ora quella importata).

In `src/lib/topology/edge-look.ts:115-117`:

```ts
/**
 * Le fonti di un collegamento in parole (dettagli, menu della linea, pagina dei dati). Una riga `mndp` scritta da un
 * router o da SNMP è un annuncio di rete: MNDP oppure il CDP di un MikroTik, che il lettore scrive `mndp` perché
 * attraversa gli switch (spec §13.5.2): finché `discovered_by` (T2) non dice quale, a schermo «annuncio di rete».
 */
export const SOURCE_WORDS: Readonly<Record<LinkSource, string>> = {
  manual: "a mano", unifi_uplink: "uplink UniFi", lldp: "LLDP", cdp: "CDP", mndp: "annuncio di rete (MNDP o CDP)", mac_table: "tabella MAC", vm_mac: "dalle VM",
};
```

In `src/app/(dashboard)/topology/dati/dati-client.tsx`: la riga 17 diventa `const FONTE: Readonly<Record<string, string>> = SOURCE_WORDS;` con `import { SOURCE_WORDS } from "@/lib/topology/edge-look";` (stesse parole della barra dei dettagli: «a mano», non più «manuale»; «tabella MAC», non più «Tabella MAC»).

Prova della parola, in `src/lib/topology/__tests__/edge-look.test.ts` (in fondo):

```ts
test("una riga mndp a schermo è un «annuncio di rete (MNDP o CDP)» (spec §13.5.2)", () => {
  assert.equal(SOURCE_WORDS.mndp, "annuncio di rete (MNDP o CDP)");
});
```

(aggiungere `SOURCE_WORDS` all'import da `@/lib/topology/edge-look` del file.)

- [ ] **Step 5: verdi**

Run: `node --import tsx --test src/lib/devices/__tests__/mikrotik-vicini.test.ts src/lib/devices/__tests__/mikrotik-porte.test.ts src/lib/topology/__tests__/edge-look.test.ts src/lib/topology/__tests__/vm-ports.test.ts > "$SCRATCH/t1-2.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`. Poi `npx tsc --noEmit > "$SCRATCH/t1-2-tsc.log" 2>&1; echo "exit=$?"` → `exit=0`; `npx eslint src/lib/devices src/lib/topology/edge-look.ts "src/app/(dashboard)/topology/dati" > "$SCRATCH/t1-2-lint.log" 2>&1; echo "exit=$?"` → `exit=0`.

- [ ] **Step 6: commit**

```bash
git add src/lib/devices/mikrotik-vicini.ts src/lib/devices/__tests__/mikrotik-vicini.test.ts src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-terse.txt src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-terse-ssh.txt src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-detail-ssh.txt src/lib/devices/__tests__/fixtures/mikrotik-ip-neighbor-detail-incollato.txt src/lib/devices/router-client.ts src/lib/topology/edge-look.ts src/lib/topology/__tests__/edge-look.test.ts "src/app/(dashboard)/topology/dati/dati-client.tsx"
git commit -m "fix(router): vicini MikroTik coi valori interi e il protocollo da discovered-by, sulle forme vere di due reti (spec §13.5.2)"
```

---
### Task 3: traduttori per prodotto e chiave della porta (T1.3, parte pura)

Spec §13.6.1 (traduttori, chiave, passi 1-6), §13.6.2 (logiche e senza fili), §13.6.4 (il MAC delle righe di RouterOS è dell'interfaccia), §13.5.1 («un lettore legge, un traduttore traduce, la logica non sa di marche»), prove I12, I13, I14, I41, I46, I47, I37 e, dal passaggio universale, I58 (un nome scelto vale quanto un altro; nessun prefisso dei nomi scelti visti nella logica né nei traduttori), I59 (il contenitore dalla forma, con qualunque nome del bridge: il traduttore qui sotto lo fa già, la prova lo fissa) e la parte pura di I70 (gli indici di un nome doppio). **Nessun effetto sul modello**: `links.ts` cambia solo dove stanno le espressioni MikroTik (`physicalPortName` le chiede al traduttore, con lo stesso risultato di prima); le prove di oggi restano verdi senza toccare un numero. Il modello le usa dal Task 7. Una risposta sola cambia, ed è voluta (revisione finale del 15/10, verifica UV1, vincolo 9): dopo un nome di fabbrica `MIKROTIK_FISICA` accetta solo una velocità che non si confonde con un numero di VLAN («-10g», «-2.5g», «-2.5»); un intero nudo o un numero col punto («ether1-20», «ether2-1.1») è un nome scelto e non è fisico. Prima su un'altra rete una VLAN chiamata «ether1-20» passava per una porta fisica, e le righe del router su di lei davano cavi (H7). Sulle due copie del 14/10 nessun nome cambia risposta (misurato sui nomi di porta delle copie: 0 pezzi su 147 e su 233); nella prova M-7 di oggi (`links.test.ts:205-215`) «ether2-1.1» passa dalla lista delle porte fisiche a quella delle non fisiche, col perché nel commento. `-2.5` resta perché il cliente A chiama così la sua porta a 2,5G (`ether1-2.5`): è un'abitudine di nome, accettata solo nella forma di una velocità; toglierla del tutto è una scelta di Riccardo (spec §13.16, scelta 9).

**Files:**
- Create: `src/lib/topology/lettori/traduci.ts`, `src/lib/topology/lettori/mikrotik.ts`, `src/lib/topology/lettori/unifi.ts`, `src/lib/topology/lettori/generico.ts`
- Create: `src/lib/topology/cavi/porte.ts`
- Create: `src/lib/topology/__tests__/traduci.test.ts`, `src/lib/topology/__tests__/porte.test.ts`, `src/lib/topology/__tests__/cavi-senza-prodotti.test.ts`
- Modify: `src/lib/topology/links.ts:57-83` (le espressioni vanno nel traduttore; `physicalPortName` e `isPhysicalPort` restano, stesse risposte salvo la coda ristretta, fino al Task 7)
- Modify: `src/lib/topology/__tests__/links.test.ts:205-215` (M-7: «ether2-1.1» fra le non fisiche)

**Interfaces:**
- Produces (da `src/lib/topology/lettori/traduci.ts`): `interface PortaLetta { nome: string; fisica: boolean | null; senzaFili: boolean | null; nelBridge: boolean | null; fascio: string | null }`; `interface ComeLetto { vendor: string | null; via: string | null; fonte: string; piattaforma: string | null }`; `traduciPorta(nome: string, lato: "locale" | "remoto", come: ComeLetto): PortaLetta`; `haTraduttore(come: ComeLetto): boolean` (il lato locale passa dal traduttore di un prodotto, non dal generico: lo usano il ripiego del router e la porta fisica del router nel Task 7, e la misura H7 del Task 4); `haTraduttoreRemoto(come: ComeLetto): boolean` (il lato remoto passa dal traduttore di un prodotto: la stessa scelta di `traduciPorta`, che la usa; la regola «nome-scelto-non-fisico» dal lato remoto, Task 7, la chiede qui invece di ricopiarla); `macDelTelaio(come: ComeLetto): boolean` (il MAC della riga è il telaio: falso per le righe di `/ip neighbor` di un MikroTik letto via SSH; lo usa il raggruppamento per apparato del Task 7).
- Produces (da `lettori/mikrotik.ts`): `traduciMikrotikLocale(grezzo: string): PortaLetta`, `traduciMikrotikRemoto(grezzo: string): PortaLetta`, `MIKROTIK_FISICA`; (da `lettori/unifi.ts`) `traduciUnifiLocale(grezzo: string): PortaLetta`; (da `lettori/generico.ts`) `traduciGenerico(nome: string): PortaLetta`, `LOGICA_COMUNE`.
- Produces (da `src/lib/topology/cavi/porte.ts`): `interface Porta { nodo: string; chiave: string | null; nome: string; certa: boolean; fisica: boolean | null; senzaFili: boolean | null; nelBridge: boolean | null }`; `interface ElencoPorte { perNome; perNomeNormale; perIndice }`; `normale(nome: string): string`; `elencoDa(righe)`; `elenchiPorte(righe: ReadonlyArray<{ device_id: number; port_index: number; port_name: string }>): Map<string, ElencoPorte>` (chiave «dev:N»); `chiavePorta(nodo: string, letta: PortaLetta, lato: "locale" | "remoto", elenco: ElencoPorte | undefined, indice?: number | null, nomiVisti?: ReadonlySet<string>): Porta`; `stessaPorta(x: Pick<Porta, "chiave">, y: Pick<Porta, "chiave">): boolean`; `portaInElenco(elenco: ElencoPorte, nome: string): number | null`; `indiciInElenco(elenco: ElencoPorte, nome: string): number[]` (tutti gli indici di un nome, per la velocità di un nome doppio nel Task 7).

- [ ] **Step 1: le prove che falliscono** — `src/lib/topology/__tests__/traduci.test.ts`:

```ts
// Spec topologia §13.6.1: un traduttore per prodotto porta i nomi di porta in fatti neutri; la logica dei collegamenti
// legge solo i fatti (vincolo 4 di Riccardo, 14/10: «a prescindere dal prodotto»). Nomi di serie dei prodotti; i nomi
// scelti dai clienti sono inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { haTraduttore, haTraduttoreRemoto, macDelTelaio, traduciPorta, type ComeLetto } from "@/lib/topology/lettori/traduci";
import { traduciMikrotikLocale, traduciMikrotikRemoto } from "@/lib/topology/lettori/mikrotik";
import { traduciUnifiLocale } from "@/lib/topology/lettori/unifi";
import { traduciGenerico } from "@/lib/topology/lettori/generico";

const SSH: ComeLetto = { vendor: "mikrotik", via: "ssh", fonte: "device", piattaforma: null };

test("MikroTik, lato locale: «,bridge» nel bridge; il fascio; una porta fisica senza bridge è fuori dal bridge", () => {
  assert.deepEqual(traduciMikrotikLocale("ether3,bridge"), { nome: "ether3", fisica: true, senzaFili: false, nelBridge: true, fascio: null });
  assert.deepEqual(traduciMikrotikLocale("ether8"), { nome: "ether8", fisica: true, senzaFili: false, nelBridge: false, fascio: null });
  // Il bridge col nome scelto dal cliente (sull'hub è così): nel bridge lo stesso.
  assert.deepEqual(traduciMikrotikLocale("sfp28-1,bond1,LAN_IN"), { nome: "sfp28-1", fisica: true, senzaFili: false, nelBridge: true, fascio: "bond1" });
  assert.deepEqual(traduciMikrotikLocale("sfp28-1,bond1"), { nome: "sfp28-1", fisica: true, senzaFili: false, nelBridge: false, fascio: "bond1" });
  assert.deepEqual(traduciMikrotikLocale("vlan10-uffici"), { nome: "vlan10-uffici", fisica: false, senzaFili: false, nelBridge: null, fascio: null });
  assert.deepEqual(traduciMikrotikLocale("wlan1"), { nome: "wlan1", fisica: false, senzaFili: true, nelBridge: null, fascio: null });
  // Un nome scelto a mano: non noto finché non si legge il tipo (T2, MK2).
  assert.deepEqual(traduciMikrotikLocale("VL_2_UFFICI"), { nome: "VL_2_UFFICI", fisica: null, senzaFili: null, nelBridge: null, fascio: null });
});

// Spostate da links.test.ts (I41, revisione finale M-7): le stesse risposte di physicalPortName di prima.
test("porta fisica: ether1-2.5 e «ether3,bridge» sì; VLAN, sottointerfacce, tunnel e wlan no", () => {
  for (const p of ["ether1-2.5", "ether3,bridge", "ether7", "sfp-sfpplus1", "sfp1", "sfp28-1", "combo1", "qsfp28-1-1", "bond1", "Port 24", "GigabitEthernet0/1"]) {
    assert.notEqual(traduciMikrotikLocale(p).fisica, false, p);
  }
  for (const p of ["bridge", "bridge,ether3", "vlan10", "vrrp_rete10", "ether1.20", "eoip-tunnel1", "wlan1", "wifi1", "wg0", "lo", "pppoe-out1", "Gi0/1.10"]) {
    assert.equal(traduciMikrotikLocale(p).fisica, false, p);
  }
  assert.equal(traduciMikrotikLocale("").fisica, null);
});

// M-7 e verifica del 15/10 (vincolo 9): dopo il nome di fabbrica solo una velocità che non si confonde con un numero di VLAN
// («-10g», «-2.5g», «-2.5»). Con «qualunque coda di cifre» una VLAN chiamata «ether1-20» passava per una porta fisica.
test("M-7: ether1-<coda> è fisica solo con una velocità (con la g, o 2.5); ether1-vlan20, ether1-20 ed ether5-1.20 no", () => {
  for (const p of ["ether1-2.5", "ether1-10g", "ether1-2.5g", "ether1-10G", "sfp-sfpplus1-10g", "qsfp28-1-1"]) {
    assert.equal(traduciMikrotikLocale(p).fisica, true, p);
  }
  for (const p of ["ether1-vlan20", "ether1-wan", "ether1-lan.10", "ether1-2.5x", "sfp1-uplink", "ether1-20", "ether2-100", "ether5-1.20", "ether2-1.1", "ether3-5"]) {
    assert.equal(traduciMikrotikLocale(p).fisica, false, p);
  }
});

test("MikroTik, lato remoto: «‹bridge›/porta» → l'ultimo pezzo, anche col bridge dal nome scelto dal cliente", () => {
  assert.deepEqual(traduciMikrotikRemoto("bridge/sfp-sfpplus1"), { nome: "sfp-sfpplus1", fisica: true, senzaFili: false, nelBridge: true, fascio: null });
  assert.deepEqual(traduciMikrotikRemoto("bridge/bond1/wlan60-1"), { nome: "wlan60-1", fisica: false, senzaFili: true, nelBridge: true, fascio: "bond1" });
  assert.equal(traduciMikrotikRemoto("LAN_IN/sfp-sfpplus2").nome, "sfp-sfpplus2");
  assert.equal(traduciMikrotikRemoto("vrrp_rete_7").fisica, false);
  assert.deepEqual(traduciMikrotikRemoto("sfp28-2"), { nome: "sfp28-2", fisica: true, senzaFili: false, nelBridge: null, fascio: null });
});

test("controller: «SFP_ N» è «SFP+ N», anche con la descrizione; «SFP 1» resta un'altra porta; le radio sono senza fili", () => {
  assert.equal(traduciUnifiLocale("SFP_ 9").nome, "SFP+ 9");
  assert.equal(traduciUnifiLocale("SFP_ 17 - nodo-a").nome, "SFP+ 17 - nodo-a");
  assert.equal(traduciUnifiLocale("SFP 1").nome, "SFP 1");
  assert.deepEqual(traduciUnifiLocale("Port 9"), { nome: "Port 9", fisica: true, senzaFili: false, nelBridge: null, fascio: null });
  // I47: un'interfaccia senza fili non è logica.
  assert.deepEqual(traduciUnifiLocale("wifi2ap9"), { nome: "wifi2ap9", fisica: false, senzaFili: true, nelBridge: null, fascio: null });
});

test("generico: il nome com'è; «Gi1/0/24» resta intero; VLAN, sottointerfacce e liste con la virgola non sono cavi", () => {
  assert.deepEqual(traduciGenerico("Gi1/0/24"), { nome: "Gi1/0/24", fisica: null, senzaFili: null, nelBridge: null, fascio: null });
  assert.equal(traduciGenerico("Gi0/1.10").fisica, false);
  assert.equal(traduciGenerico("vlan20").fisica, false);
  assert.equal(traduciGenerico("a,b").fisica, false);
  assert.equal(traduciGenerico("wlan0").senzaFili, true);
});

test("chi traduce: il controller le sue righe; un MikroTik letto via SSH il suo traduttore; il lato remoto per piattaforma o per apparato abbinato", () => {
  assert.equal(traduciPorta("ether3,bridge", "locale", SSH).nome, "ether3");
  assert.equal(traduciPorta("ether3,bridge", "locale", { ...SSH, via: "snmp_v2" }).nome, "ether3,bridge");
  assert.equal(traduciPorta("SFP_ 9", "locale", { vendor: "ubiquiti", via: "api", fonte: "unifi", piattaforma: null }).nome, "SFP+ 9");
  assert.equal(traduciPorta("bridge/ether3", "remoto", { vendor: null, via: null, fonte: "device", piattaforma: "MikroTik" }).nome, "ether3");
  assert.equal(traduciPorta("bridge/ether3", "remoto", { ...SSH, fonte: "unifi" }).nome, "ether3");
  assert.equal(traduciPorta("Gi1/0/24", "remoto", { vendor: "cisco", via: "ssh", fonte: "device", piattaforma: "Cisco" }).nome, "Gi1/0/24");
});

// Verifica del piano sul dato dell'hub (15/10): il ripiego del router da una VLAN col nome scelto a mano («VL_…») appendeva
// un hypervisor al router. Chi ha un traduttore suo conosce i nomi delle porte fisiche; il generico no (Task 7).
test("haTraduttore: il controller e un MikroTik letto via SSH hanno un traduttore loro; gli altri il generico", () => {
  assert.equal(haTraduttore(SSH), true);
  assert.equal(haTraduttore({ ...SSH, via: "snmp_v2" }), false);
  assert.equal(haTraduttore({ vendor: "ubiquiti", via: "api", fonte: "unifi", piattaforma: null }), true);
  assert.equal(haTraduttore({ vendor: "cisco", via: "ssh", fonte: "device", piattaforma: null }), false);
});

// Revisione finale del 15/10 (verifica UV2): la scelta del lato remoto sta qui, accanto a traduciPorta; links.ts la chiede invece
// di ricopiarla con un'espressione sulla marca (prova I37 sul codice di links.ts, Task 7).
test("haTraduttoreRemoto: la piattaforma annunciata, o l'apparato remoto letto col traduttore del suo prodotto", () => {
  assert.equal(haTraduttoreRemoto({ vendor: null, via: null, fonte: "device", piattaforma: "MikroTik" }), true);
  assert.equal(haTraduttoreRemoto({ ...SSH, fonte: "unifi" }), true, "la riga del controller verso un MikroTik letto via SSH");
  assert.equal(haTraduttoreRemoto({ ...SSH, via: "snmp_v2" }), false);
  assert.equal(haTraduttoreRemoto({ vendor: "cisco", via: "ssh", fonte: "device", piattaforma: "Cisco" }), false);
  for (const [nome, come] of [["bridge/ether3", { vendor: null, via: null, fonte: "device", piattaforma: "MikroTik" }], ["Gi1/0/24", { vendor: "cisco", via: "snmp_v2", fonte: "device", piattaforma: null }]] as const) {
    assert.equal(traduciPorta(nome, "remoto", come).nome === nome, !haTraduttoreRemoto(come), nome);
  }
});

// ─── Passaggio universale (spec §13.16; vincolo 9 di Riccardo, 14/10 sera: «il piano deve essere universale») ───
/**
 * Nomi inventati a caso, senza prefissi di fabbrica né punti (prova I58): la prima lettera non è mai quella di un prefisso
 * di fabbrica (ether, sfp, combo, qsfp, bond, bridge, vlan, vrrp, eoip, gre, ipip, 6to4, vxlan, wg, wireguard, ovpn, pppoe,
 * pptp, l2tp, sstp, lte, lo, loopback, veth, wlan, wifi). Generatore deterministico (Park-Miller): stessi nomi a ogni giro.
 */
function nomiACaso(n: number, seme = 20261015): string[] {
  let x = seme;
  const caso = (k: number): number => { x = (x * 48271) % 2147483647; return x % k; };
  const PRIME = "ADFHJKMNRTUXYZadfhjkmnrtuxyz";
  const ALTRE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  return Array.from({ length: n }, () => PRIME[caso(PRIME.length)] + Array.from({ length: 2 + caso(9) }, () => ALTRE[caso(ALTRE.length)]).join(""));
}
const SCELTI = ["XQ_7_ABC", "lan-piano2", "PONTE-A", "VL_22_CGWR", "BR_RP", "Rete Ospiti"];

// I58 (spec §13.12.3). Rete B (l'hub), 14/10: il router annuncia da ogni interfaccia, e una sua VLAN dal nome scelto,
// presa per una porta fisica, ha tracciato una linea fra due router (H7). Un nome scelto vale quanto un altro: per il
// traduttore del prodotto è «non noto» finché non si legge il tipo dell'interfaccia (T2), mai fisico né logico.
test("I58 — un nome scelto dal cliente, anche inventato a caso, sul lato locale di un MikroTik: «non noto»", () => {
  for (const nome of [...SCELTI, ...nomiACaso(200)]) {
    const l = traduciMikrotikLocale(nome);
    assert.deepEqual([l.nome, l.fisica, l.senzaFili, l.nelBridge], [nome, null, null, null], nome);
  }
});

// I58 anche coi prefissi di fabbrica (verifica del 15/10): i nomi a caso qui sopra non cominciano mai come un nome di fabbrica,
// e un nome scelto che comincia così («ether3-‹qualcosa›») con una coda che non è una velocità non è mai una porta fisica.
test("I58 — un prefisso di fabbrica con una coda scelta a caso non è una porta fisica", () => {
  const PREFISSI = ["ether", "sfp-sfpplus", "sfp28-", "sfp", "combo", "bond", "qsfp28-"];
  [...nomiACaso(100, 20261016), "20", "100", "1.20", "2", "3.5", "4-7"].forEach((coda, k) => {
    const nome = `${PREFISSI[k % PREFISSI.length]}${1 + (k % 9)}-${coda}`;
    assert.notEqual(traduciMikrotikLocale(nome).fisica, true, nome);
    assert.notEqual(traduciMikrotikRemoto(nome).fisica, true, nome);
  });
});

// I59 (spec §13.12.3): il contenitore di una riga di RouterOS si legge dalla forma, con qualunque nome del bridge. Rete B:
// ogni riga del router finisce col nome scelto del bridge; letta come «solo `,bridge` è nel bridge», ogni porta del
// router, fascio compreso, sarebbe instradata (§13.7.4).
test("I59 — il contenitore dalla forma: «porta,X» nel bridge X, «porta,bondN,X» membro del fascio nel bridge, «porta» fuori", () => {
  for (const br of ["bridge", ...SCELTI.filter((s) => !s.includes(" ")), ...nomiACaso(30)]) {
    assert.deepEqual(traduciMikrotikLocale(`sfp-sfpplus1,${br}`), { nome: "sfp-sfpplus1", fisica: true, senzaFili: false, nelBridge: true, fascio: null }, br);
    assert.deepEqual(traduciMikrotikLocale(`sfp28-1,bond1,${br}`), { nome: "sfp28-1", fisica: true, senzaFili: false, nelBridge: true, fascio: "bond1" }, br);
    assert.deepEqual([traduciMikrotikRemoto(`${br}/bond1/sfp28-1`).nome, traduciMikrotikRemoto(`${br}/sfp-sfpplus3`).nome], ["sfp28-1", "sfp-sfpplus3"], br);
  }
  assert.deepEqual(traduciMikrotikLocale("sfp-sfpplus2"), { nome: "sfp-sfpplus2", fisica: true, senzaFili: false, nelBridge: false, fascio: null });
  assert.equal(traduciGenerico("Gi1/0/24").nome, "Gi1/0/24", "un nome con la barra di un'altra marca resta intero");
});

// Spec §13.6.4: nelle righe di `/ip neighbor` il MAC è quello dell'interfaccia che ha mandato l'annuncio, non il telaio (sulla
// rete B lo stesso router compare con quattro MAC); il controller e SNMP (`lldpRemChassisId`) danno il telaio.
test("macDelTelaio: il controller e SNMP danno il telaio; le righe di un MikroTik letto via SSH il MAC dell'interfaccia", () => {
  assert.equal(macDelTelaio(SSH), false);
  assert.equal(macDelTelaio({ ...SSH, via: "snmp_v2" }), true);
  assert.equal(macDelTelaio({ vendor: "ubiquiti", via: "api", fonte: "unifi", piattaforma: null }), true);
  assert.equal(macDelTelaio({ vendor: "cisco", via: "snmp_v2", fonte: "device", piattaforma: null }), true);
});
```

`src/lib/topology/__tests__/porte.test.ts`:

```ts
// Spec topologia §13.6.1, «La chiave»: la stessa porta ha una chiave sola. Accesso B del cliente A, 14/10: «SFP+ 1» è
// l'indice 49, «SFP 1» il 51, «Port 1» l'1, e «Port 1» e «SFP_ 1» hanno vicini LLDP diversi. Elenchi inventati con la
// forma vera di switch_ports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chiavePorta, elencoDa, elenchiPorte, indiciInElenco, normale, portaInElenco, stessaPorta } from "@/lib/topology/cavi/porte";
import { traduciUnifiLocale } from "@/lib/topology/lettori/unifi";
import { traduciGenerico } from "@/lib/topology/lettori/generico";

const ACCESSO = elencoDa([
  { port_index: 1, port_name: "Port 1" }, { port_index: 16, port_name: "Port 16" }, { port_index: 47, port_name: "Port 47" },
  { port_index: 49, port_name: "SFP+ 1" }, { port_index: 50, port_name: "SFP+ 2" }, { port_index: 51, port_name: "SFP 1" },
]);
const g = (nome: string) => traduciGenerico(nome);

test("I12: «SFP_ 1» è «SFP+ 1» (indice 49), mai «SFP 1» (51) né «Port 1» (1)", () => {
  assert.equal(chiavePorta("dev:2", traduciUnifiLocale("SFP_ 1"), "locale", ACCESSO).chiave, "i:49");
  assert.equal(chiavePorta("dev:2", traduciUnifiLocale("SFP 1"), "locale", ACCESSO).chiave, "i:51");
  assert.equal(chiavePorta("dev:2", traduciUnifiLocale("Port 1"), "locale", ACCESSO).chiave, "i:1");
});

test("nome uguale dopo la normalizzazione neutra (minuscole, senza spazi), mai togliendo «_» o «+»", () => {
  assert.equal(normale(" SFP+ 2 "), "sfp+2");
  assert.equal(chiavePorta("dev:2", g("sfp+2"), "remoto", ACCESSO).chiave, "i:50");
  assert.equal(chiavePorta("dev:2", g("SFP_2"), "remoto", ACCESSO).chiave, null);
});

test("I14: un nome doppio non si risolve per nome; I13: un nome che l'apparato non ha non è una porta", () => {
  const AGG = elencoDa([{ port_index: 15, port_name: "SFP+ 15" }, { port_index: 16, port_name: "SFP+ 15" }]);
  assert.deepEqual([chiavePorta("dev:9", g("SFP+ 15"), "remoto", AGG).chiave, chiavePorta("dev:9", g("SFP+ 15"), "remoto", AGG).certa], [null, false]);
  assert.deepEqual([chiavePorta("dev:2", g("eth0"), "locale", ACCESSO).chiave, chiavePorta("dev:2", g("eth0"), "locale", ACCESSO).certa], [null, false]);
});

test("solo per la porta remota: «Port N» o «N» (assegnato localmente) → l'indice N, se l'apparato non ha quel nome", () => {
  const CORE = elencoDa([{ port_index: 10, port_name: "Uplink verso il router" }, { port_index: 15, port_name: "Port 15 - WAN sede" }]);
  assert.equal(chiavePorta("dev:114", g("Port 10"), "remoto", CORE).chiave, "i:10");
  assert.equal(chiavePorta("dev:114", g("10"), "remoto", CORE).chiave, "i:10");
  assert.equal(chiavePorta("dev:114", g("Port 10"), "locale", CORE).chiave, null);
  // Una porta rinominata dal cliente: stesso nome nell'elenco e nell'LLDP.
  assert.equal(chiavePorta("dev:114", g("Uplink verso il router"), "remoto", CORE).chiave, "i:10");
  assert.equal(chiavePorta("dev:114", g("Port 99"), "remoto", CORE).chiave, null);
});

test("apparato senza elenco: il nome normalizzato; per il lato remoto solo se è l'unico visto verso di lui (I46)", () => {
  assert.equal(chiavePorta("dev:1", g("ether3"), "locale", undefined).chiave, "n:ether3");
  assert.equal(chiavePorta("host:7", g("eth0"), "remoto", undefined, null, new Set(["eth0"])).chiave, "n:eth0");
  const due = chiavePorta("host:7", g("eth0"), "remoto", undefined, null, new Set(["eth0", "f4e2"]));
  assert.deepEqual([due.chiave, due.certa], [null, false]);
});

test("l'indice dato dal lettore vince (nel modello di T1: l'indice della porta di uplink in switch_ports)", () => {
  assert.equal(chiavePorta("dev:2", g("qualunque"), "locale", ACCESSO, 47).chiave, "i:47");
});

test("stessaPorta: due chiavi uguali; una porta non nota non è uguale a niente", () => {
  assert.equal(stessaPorta({ chiave: "i:10" }, { chiave: "i:10" }), true);
  assert.equal(stessaPorta({ chiave: "i:10" }, { chiave: "i:9" }), false);
  assert.equal(stessaPorta({ chiave: null }, { chiave: null }), false);
});

test("elenchi per apparato e indice di una porta per nome (per la velocità)", () => {
  const e = elenchiPorte([{ device_id: 2, port_index: 49, port_name: "SFP+ 1" }, { device_id: 3, port_index: 1, port_name: "Port 1" }]);
  assert.deepEqual([...e.keys()], ["dev:2", "dev:3"]);
  assert.equal(portaInElenco(e.get("dev:2")!, "SFP+ 1"), 49);
  assert.equal(portaInElenco(e.get("dev:3")!, "Port 1"), 1);
  assert.equal(portaInElenco(e.get("dev:3")!, "eth0"), null);
});

// I70 (spec §13.6.1, «Un nome doppio con una velocità sola»): un nome che corrisponde a più porte non dice la porta (I14),
// ma le porte che lo portano sì: la velocità per chiave (Task 7) le guarda tutte. Rete B: il cavo dati di un hypervisor sta
// su un nome di due porte a 10G.
test("indiciInElenco: tutti gli indici di un nome (passi 2-4 di chiavePorta, senza scegliere)", () => {
  const AGG = elencoDa([{ port_index: 15, port_name: "SFP+ 15" }, { port_index: 16, port_name: "SFP+ 15" }, { port_index: 17, port_name: "SFP+ 17" }]);
  assert.deepEqual(indiciInElenco(AGG, "SFP+ 15"), [15, 16]);
  assert.deepEqual(indiciInElenco(AGG, "sfp+17"), [17]);
  assert.deepEqual(indiciInElenco(AGG, "Port 17"), [17]);
  assert.deepEqual(indiciInElenco(AGG, "eth0"), []);
  assert.deepEqual(indiciInElenco(AGG, " "), []);
  assert.equal(portaInElenco(AGG, "SFP+ 15"), null, "la porta resta non nota");
});
```

`src/lib/topology/__tests__/cavi-senza-prodotti.test.ts`:

```ts
/**
 * Prova I37 (spec topologia §13.12.3; vincolo 4 di Riccardo, 14/10: la logica dei collegamenti vale «a prescindere dal
 * prodotto»). In src/lib/topology/cavi/ non c'è nessun nome di prodotto né forma di porta di un prodotto: stanno solo nei
 * traduttori (src/lib/topology/lettori/). Un elenco di parole ed espressioni in TypeScript, non un comando grep copiato
 * da una tabella (dove la barra verticale dell'espressione diventerebbe un carattere da cercare).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const DIR = path.join(__dirname, "..", "cavi");
const PAROLE = ["mikrotik", "routeros", "unifi", "ubiquiti", "cisco", "aruba", "proxmox", "mndp"];
// Una forma di porta può stare anche dentro un'espressione regolare, con la barra rovesciata («ether\d», «bridge\/»):
// la cifra o la barra possono essere scritte con l'escape (revisione del piano, 15/10: prima l'autoprova qui sotto era rossa).
const FORME: RegExp[] = [/\bhp\b/i, /ether(?:\d|\\d)/i, /sfp-sfpplus/i, /sfpplus/i, /sfp28/i, /SFP_/, /,bridge/i, /bridge\\?\//i, /wlan/i, /eoip/i, /["'`][^"'`\n]*\blocal\s/i];

function formeDiProdotto(testo: string): string[] {
  const out: string[] = [];
  testo.split("\n").forEach((riga, i) => {
    const r = riga.toLowerCase();
    for (const p of PAROLE) if (r.includes(p)) out.push(`riga ${i + 1}: «${p}»`);
    for (const re of FORME) if (re.test(riga)) out.push(`riga ${i + 1}: ${re.source}`);
  });
  return out;
}

test("la prova trova davvero le forme di un prodotto", () => {
  assert.equal(formeDiProdotto('const P = /^ether\\d+$/;').length > 0, true);
  assert.equal(formeDiProdotto("const B = /^bridge\\/ether/;").length > 0, true);
  assert.equal(formeDiProdotto("// lettura del router mndp").length > 0, true);
  assert.equal(formeDiProdotto('const l = "local Port 7";').length > 0, true);
  assert.deepEqual(formeDiProdotto('lato === "locale" ? "porta" : "remota"'), []);
});

test("I37: nessun nome di prodotto né forma di porta di un prodotto in src/lib/topology/cavi/", () => {
  const file = fs.readdirSync(DIR).filter((f) => f.endsWith(".ts"));
  assert.ok(file.length > 0, "la cartella cavi/ c'è");
  const trovate = file.flatMap((f) => formeDiProdotto(fs.readFileSync(path.join(DIR, f), "utf8")).map((x) => `${f} ${x}`));
  assert.deepEqual(trovate, []);
});

/**
 * I58 (spec §13.12.3; vincolo 9): nessuna regola conosce un nome scelto da un cliente. I prefissi dei nomi scelti visti sulle
 * reti misurate (le VLAN e il bridge della rete B) non stanno né nella logica né nei traduttori, nemmeno nei commenti: chi ha
 * fretta di riconoscerli riapre il problema della rete B (H7).
 */
const SCELTI_VISTI: RegExp[] = [/\bvl_/i, /\bbr_/i];
const LETTORI = path.join(__dirname, "..", "lettori");

function nomiScelti(testo: string): string[] {
  return testo.split("\n").flatMap((riga, i) => SCELTI_VISTI.filter((re) => re.test(riga)).map((re) => `riga ${i + 1}: ${re.source}`));
}

test("la prova dei nomi scelti trova davvero i prefissi", () => {
  assert.equal(nomiScelti("// un nome come «VL_…»").length, 1);
  assert.equal(nomiScelti('const B = /^br_/i;').length, 1);
  assert.deepEqual(nomiScelti("const vlan = /^vlan\\d+$/;"), []);
});

test("I58 — nessun prefisso di un nome scelto da un cliente in cavi/ e lettori/", () => {
  const trovate = [DIR, LETTORI].flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith(".ts"))
    .flatMap((f) => nomiScelti(fs.readFileSync(path.join(d, f), "utf8")).map((x) => `${path.basename(d)}/${f} ${x}`)));
  assert.deepEqual(trovate, []);
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/traduci.test.ts src/lib/topology/__tests__/porte.test.ts src/lib/topology/__tests__/cavi-senza-prodotti.test.ts > "$SCRATCH/t1-3.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`, «Cannot find module '@/lib/topology/lettori/traduci'» e la cartella `cavi/` che manca.

- [ ] **Step 3: il codice** — `src/lib/topology/lettori/traduci.ts`:

```ts
/**
 * Traduttori per prodotto (spec topologia §13.6.1; vincolo 4 di Riccardo: «a prescindere dal prodotto»). I nomi di porta
 * arrivano nella forma del prodotto che li ha scritti («ether3,bridge», «bridge/ether3», «SFP_ 9»); un traduttore li
 * porta in fatti neutri — il nome pulito, fisica o logica, senza fili, nel bridge, il fascio — quando si carica
 * l'ingresso del modello. È il solo posto, con i file accanto, dove stanno le forme dei nomi dei prodotti: la logica dei
 * collegamenti (links.ts in T1, cavi/ da T2) legge solo i fatti. Un prodotto sconosciuto passa dal traduttore generico.
 * Si calcola alla lettura: in T1 non serve schema. Logica pura.
 */
import { traduciGenerico } from "./generico";
import { traduciMikrotikLocale, traduciMikrotikRemoto } from "./mikrotik";
import { traduciUnifiLocale } from "./unifi";

export interface PortaLetta {
  /** Il nome pulito, com'è (o come sarebbe) nell'elenco delle porte dell'apparato. */
  nome: string;
  /** null = non noto. */
  fisica: boolean | null;
  senzaFili: boolean | null;
  nelBridge: boolean | null;
  /** Il fascio nominato insieme alla porta. */
  fascio: string | null;
}

export interface ComeLetto {
  /** network_devices.vendor dell'apparato a cui appartiene la porta (lato remoto: dell'apparato remoto, se abbinato). */
  vendor: string | null;
  /** network_devices.protocol dello stesso apparato: la via di lettura (ssh, snmp_v2, api…). */
  via: string | null;
  /** device_neighbors.source della riga; per le porte scritte dall'apparato o dal controller, «device» o «unifi». */
  fonte: string;
  /** device_neighbors.remote_platform: la piattaforma annunciata (vale per il lato remoto). */
  piattaforma: string | null;
}

const eMikrotik = (vendor: string | null): boolean => (vendor ?? "").trim().toLowerCase() === "mikrotik";
/** Le righe di un MikroTik letto via SSH: fonte `device` con vendor mikrotik e via `ssh` (da T2 anche la fonte `ssh`). */
const lettoDaMikrotik = (come: ComeLetto): boolean => eMikrotik(come.vendor) && (come.via === "ssh" || come.fonte === "ssh");

/**
 * Chi traduce. Lato locale: le righe del controller il traduttore del controller; quelle di un MikroTik letto via SSH
 * (fonte `device` con vendor mikrotik e via `ssh`; da T2 anche la fonte `ssh`) il traduttore MikroTik; le altre il
 * generico (in T1 anche le righe SNMP: il traduttore SNMP, che legge `ifType`, nasce in T2). Lato remoto: il traduttore
 * della piattaforma annunciata, o, se la riga non la dice, quello dell'apparato remoto abbinato (il controller non
 * scrive la piattaforma di un router che non gestisce).
 */
export function traduciPorta(nome: string, lato: "locale" | "remoto", come: ComeLetto): PortaLetta {
  const n = nome.trim();
  if (lato === "locale") {
    if (come.fonte === "unifi") return traduciUnifiLocale(n);
    return lettoDaMikrotik(come) ? traduciMikrotikLocale(n) : traduciGenerico(n);
  }
  return haTraduttoreRemoto(come) ? traduciMikrotikRemoto(n) : traduciGenerico(n);
}

/**
 * Il lato locale passa dal traduttore di un prodotto (il controller, un MikroTik letto via SSH), non dal generico: è la
 * stessa scelta di `traduciPorta`. Chi ha un traduttore suo conosce i nomi delle sue porte fisiche, quindi un nome che
 * non riconosce (`fisica: null`: un nome scelto dal cliente) non è una porta fisica; il generico invece non conosce i nomi
 * del prodotto.
 */
export function haTraduttore(come: ComeLetto): boolean {
  return come.fonte === "unifi" || lettoDaMikrotik(come);
}

/**
 * Il lato remoto passa dal traduttore di un prodotto, non dal generico: è la scelta di `traduciPorta` per il lato remoto (la
 * piattaforma annunciata, o l'apparato remoto abbinato letto col traduttore del suo prodotto). La usa la regola
 * «nome-scelto-non-fisico» dal lato remoto (links.ts, G2). Verifica del 15/10: prima links.ts ricopiava questa scelta con
 * un'espressione sulla marca, e le due copie potevano divergere; la scelta sta qui sola, accanto a `traduciPorta`.
 */
export function haTraduttoreRemoto(come: ComeLetto): boolean {
  return /mikrotik/i.test(come.piattaforma ?? "") || lettoDaMikrotik(come);
}

/**
 * Il MAC di una riga dei vicini è il telaio dell'apparato remoto? Sì per il controller e per SNMP (`lldpRemChassisId`).
 * No per le righe di `/ip neighbor` di un MikroTik letto via SSH: il MAC è quello dell'interfaccia che ha mandato
 * l'annuncio, e lo stesso router compare con più MAC (spec §13.6.4; sulla rete B un router con quattro). Lo usa il
 * raggruppamento per apparato delle righe (links.ts, passo 3b).
 */
export function macDelTelaio(come: ComeLetto): boolean {
  return !lettoDaMikrotik(come);
}
```

`src/lib/topology/lettori/generico.ts`:

```ts
/**
 * Il traduttore generico, per un prodotto senza traduttore suo: il nome resta com'è e dal nome si sa solo ciò che vale
 * per ogni prodotto (le regole comuni di `links.ts:75-83` di prima, senza le forme MikroTik): un nome da interfaccia
 * logica comune (bridge, VLAN, VRRP, tunnel, loopback) o con «,» o «.» (una sottointerfaccia, «Gi0/1.10») non è un
 * cavo; «wlan»/«wifi» è senza fili; il resto è non noto.
 */
import type { PortaLetta } from "./traduci";

export const LOGICA_COMUNE = /^(bridge|vlan|vrrp|eoip|gre|ipip|6to4|vxlan|wg|wireguard|ovpn|pppoe|pptp|l2tp|sstp|lte|lo$|loopback|veth)/;
const SENZA_FILI = /^(wlan|wifi)/;

export function traduciGenerico(nome: string): PortaLetta {
  const p = nome.toLowerCase();
  const base = { nome, nelBridge: null, fascio: null };
  if (p === "") return { ...base, fisica: null, senzaFili: null };
  if (SENZA_FILI.test(p)) return { ...base, fisica: false, senzaFili: true };
  if (LOGICA_COMUNE.test(p) || p.includes(",") || p.includes(".")) return { ...base, fisica: false, senzaFili: false };
  return { ...base, fisica: null, senzaFili: null };
}
```

`src/lib/topology/lettori/mikrotik.ts`:

```ts
/**
 * Il traduttore MikroTik (RouterOS), spec topologia §13.6.1. Lato locale, righe di `/ip neighbor`: `ether3,bridge` →
 * `ether3`, nel bridge; `sfp28-1,bond1,‹bridge›` → fascio `bond1`, nel bridge (il bridge può avere un nome scelto dal
 * cliente); una porta fisica senza bridge → fuori dal bridge (instradata). Lato remoto, porta annunciata da un MikroTik:
 * `‹bridge›/ether3`, `‹bridge›/bond1/wlan60-1` → l'ultimo pezzo (RouterOS scrive «master/porta»). Fisica: le porte per
 * prefisso (erano `links.ts:57-66`: Task 1b della fase 2b e revisione finale M-7, `ether1-vlan20` non è fisica). Logica:
 * i nomi delle interfacce logiche, senza `wlan` e `wifi`, che sono senza fili. Un nome scelto dal cliente (per una VLAN, un
 * bridge, un tunnel) resta non noto finché non si legge il tipo dell'interfaccia (T2, MK2): mai una regola sul nome (I58).
 */
import type { PortaLetta } from "./traduci";

/**
 * Le porte fisiche: i nomi di fabbrica `ether1`, `sfp-sfpplus1`, `sfp28-1`, `sfp1`, `combo1`, `bond1` (un fascio verso un
 * apparato) e `qsfp28-1-1` (la corsia di una QSFP), seguiti al più da una velocità che non si confonde con un numero di
 * VLAN: con la «g» (`-10g`, `-2.5g`) oppure `-2.5` (la porta a 2,5G rinominata così sul cliente A, `ether1-2.5`). Un intero
 * nudo (`ether1-20`) o un numero col punto (`ether5-1.20`) è un nome scelto, come una VLAN: non è fisico. Verifica del 15/10
 * (vincolo 9): con «qualunque coda di cifre» una VLAN chiamata `ether1-20` su un'altra rete passava per una porta fisica, e
 * le righe del router su di lei davano cavi (H7). Sulle due copie del 14/10 la restrizione non cambia nessun nome.
 */
export const MIKROTIK_FISICA = /^((ether|sfp-sfpplus|sfp28-|sfp|combo|bond)\d+|qsfp\w*?-?\d+(-[1-8])?)(-(\d+(\.\d+)?g|2\.5))?$/;
const MIKROTIK_RINOMINATA = /^(ether|sfp-sfpplus|sfp28-|sfp|combo|qsfp\w*?-?|bond)\d+-/;
const LOGICA = /^(bridge|vlan|vrrp|eoip|gre|ipip|6to4|vxlan|wg|wireguard|ovpn|pppoe|pptp|l2tp|sstp|lte|lo$|loopback|veth)/;
const SENZA_FILI = /^(wlan|wifi)/;
const FASCIO = /^bond\d+$/i;

function fatti(nome: string): Pick<PortaLetta, "fisica" | "senzaFili"> {
  const p = nome.toLowerCase();
  if (p === "") return { fisica: null, senzaFili: null };
  if (SENZA_FILI.test(p)) return { fisica: false, senzaFili: true };
  if (LOGICA.test(p)) return { fisica: false, senzaFili: false };
  if (MIKROTIK_FISICA.test(p)) return { fisica: true, senzaFili: false };
  if (MIKROTIK_RINOMINATA.test(p) || p.includes(".")) return { fisica: false, senzaFili: false };
  return { fisica: null, senzaFili: null };
}

export function traduciMikrotikLocale(grezzo: string): PortaLetta {
  const [primo, ...resto] = grezzo.split(",").map((s) => s.trim());
  const f = fatti(primo);
  // «porta,fascio,bridge»: l'ultimo pezzo è il padrone più in alto; un fascio senza bridge sopra non è nel bridge.
  const nelBridge = resto.length > 0 ? !FASCIO.test(resto[resto.length - 1]) : f.fisica === true ? false : null;
  const fascio = resto.find((r) => FASCIO.test(r)) ?? (resto.length >= 2 ? resto[0] : null);
  return { nome: primo, ...f, nelBridge, fascio };
}

export function traduciMikrotikRemoto(grezzo: string): PortaLetta {
  const pezzi = grezzo.split("/").map((s) => s.trim());
  const nome = pezzi[pezzi.length - 1];
  const fascio = pezzi.slice(0, -1).find((p) => FASCIO.test(p)) ?? null;
  return { nome, ...fatti(nome), nelBridge: pezzi.length > 1 ? true : null, fascio };
}
```

`src/lib/topology/lettori/unifi.ts`:

```ts
/**
 * Il traduttore del controller UniFi (spec topologia §13.1 punto 9, §13.6.1). Lato locale: nella tabella LLDP il
 * controller chiama «SFP_ N» la porta che nell'elenco delle porte è «SFP+ N», anche con la descrizione («SFP_ 17 - x» è
 * «SFP+ 17 - x»); «SFP_ 1» NON è «SFP 1», un'altra porta. Ogni porta del `port_table` è fisica; le interfacce radio di
 * un access point («wifi…», «ra…», «ath…», «wlan…») sono senza fili. Il «local » davanti lo toglie già il lettore
 * (`unifi-map.ts:159-163`). Da T3 la porta si prende dall'indice (`local_port_idx`).
 */
import type { PortaLetta } from "./traduci";

const RADIO = /^(wifi|ra|ath|wlan)\d/i;

export function traduciUnifiLocale(grezzo: string): PortaLetta {
  const nome = grezzo.trim().replace(/^SFP_(?=\s)/i, "SFP+");
  if (nome === "") return { nome, fisica: null, senzaFili: null, nelBridge: null, fascio: null };
  if (RADIO.test(nome)) return { nome, fisica: false, senzaFili: true, nelBridge: null, fascio: null };
  return { nome, fisica: true, senzaFili: false, nelBridge: null, fascio: null };
}
```

`src/lib/topology/cavi/porte.ts` (nessun nome né forma di prodotto, nemmeno nei commenti: lo controlla la prova I37):

```ts
/**
 * La chiave di una porta (spec topologia §13.6.1): la stessa porta, comunque la chiami chi la legge, ha una chiave sola —
 * «i:<indice>» se sta nell'elenco delle porte dell'apparato, «n:<nome normalizzato>» per un apparato senza elenco,
 * nessuna chiave se non si sa quale porta sia. I nomi arrivano già tradotti (lettori/): qui nessun nome e nessuna forma
 * di un prodotto (prova I37). Logica pura.
 */
import type { PortaLetta } from "@/lib/topology/lettori/traduci";

export interface Porta {
  nodo: string;
  chiave: string | null;
  nome: string;
  /** false = porta non nota: il nome non dice quale porta dell'apparato sia (su una porta non nota non si contano gli apparati). */
  certa: boolean;
  fisica: boolean | null;
  senzaFili: boolean | null;
  nelBridge: boolean | null;
}

export interface ElencoPorte {
  perNome: ReadonlyMap<string, number[]>;
  perNomeNormale: ReadonlyMap<string, number[]>;
  perIndice: ReadonlyMap<number, string>;
}

type RigaPorta = { port_index: number; port_name: string };

/** La normalizzazione neutra: minuscole, senza spazi. Mai togliendo «_» o «+»: sono porte diverse. */
export function normale(nome: string): string {
  return nome.replace(/\s+/g, "").toLowerCase();
}

function metti(m: Map<string, number[]>, k: string, i: number): void {
  const v = m.get(k);
  if (v) v.push(i);
  else m.set(k, [i]);
}

export function elencoDa(righe: ReadonlyArray<RigaPorta>): ElencoPorte {
  const perNome = new Map<string, number[]>(), perNomeNormale = new Map<string, number[]>(), perIndice = new Map<number, string>();
  for (const r of righe) {
    perIndice.set(r.port_index, r.port_name);
    metti(perNome, r.port_name.trim(), r.port_index);
    metti(perNomeNormale, normale(r.port_name), r.port_index);
  }
  return { perNome, perNomeNormale, perIndice };
}

/** Gli elenchi delle porte di ogni apparato («dev:N» → elenco), dalle righe di switch_ports. */
export function elenchiPorte(righe: ReadonlyArray<RigaPorta & { device_id: number }>): Map<string, ElencoPorte> {
  const perApparato = new Map<string, RigaPorta[]>();
  for (const r of righe) {
    const k = `dev:${r.device_id}`;
    const v = perApparato.get(k);
    if (v) v.push(r);
    else perApparato.set(k, [r]);
  }
  return new Map([...perApparato].map(([k, v]) => [k, elencoDa(v)]));
}

/** L'identificativo LLDP «assegnato localmente»: «Port N» o solo «N». */
const PORTA_N = /^(?:port\s*)?(\d+)$/i;

/**
 * La chiave della porta. Vince il primo passo che dà un risultato unico: 1. l'indice dato dal lettore; 2. il nome
 * esatto fra le porte dell'apparato; 3. il nome uguale dopo la normalizzazione neutra; 4. solo per la porta remota,
 * «Port N» o «N» quando l'apparato ha la porta d'indice N e nessuna porta con quel nome; 5. un apparato senza elenco:
 * il nome normalizzato, per la porta remota solo se è l'unico nome visto verso di lui (`nomiVisti`, prova I46);
 * 6. altrimenti porta non nota (un nome che l'apparato non ha; un nome che corrisponde a più porte).
 */
export function chiavePorta(nodo: string, letta: PortaLetta, lato: "locale" | "remoto", elenco: ElencoPorte | undefined,
  indice?: number | null, nomiVisti?: ReadonlySet<string>): Porta {
  const base = { nodo, nome: letta.nome, fisica: letta.fisica, senzaFili: letta.senzaFili, nelBridge: letta.nelBridge };
  const conIndice = (i: number): Porta => ({ ...base, chiave: `i:${i}`, certa: true });
  const nonNota: Porta = { ...base, chiave: null, certa: false };
  if (indice !== undefined && indice !== null) return conIndice(indice);
  const nome = letta.nome.trim();
  if (nome === "") return nonNota;
  if (elenco) {
    const esatti = elenco.perNome.get(nome) ?? [];
    if (esatti.length === 1) return conIndice(esatti[0]);
    if (esatti.length > 1) return nonNota;
    const normali = elenco.perNomeNormale.get(normale(nome)) ?? [];
    if (normali.length === 1) return conIndice(normali[0]);
    if (normali.length > 1) return nonNota;
    const n = lato === "remoto" ? PORTA_N.exec(nome) : null;
    if (n && elenco.perIndice.has(Number(n[1]))) return conIndice(Number(n[1]));
    return nonNota;
  }
  if (lato === "remoto" && nomiVisti !== undefined && nomiVisti.size > 1) return nonNota;
  return { ...base, chiave: `n:${normale(nome)}`, certa: true };
}

export function stessaPorta(x: Pick<Porta, "chiave">, y: Pick<Porta, "chiave">): boolean {
  return x.chiave !== null && x.chiave === y.chiave;
}

/**
 * Tutti gli indici che portano quel nome nell'elenco, coi passi 2-4 di `chiavePorta` ma senza scegliere: uno se la porta si
 * sa; più di uno per un nome doppio, che non dice la porta (I14) ma può dire la velocità (spec §13.6.1, «Un nome doppio con
 * una velocità sola», I70); nessuno se l'apparato non ha quel nome.
 */
export function indiciInElenco(elenco: ElencoPorte, nome: string): number[] {
  const n = nome.trim();
  if (n === "") return [];
  const esatti = elenco.perNome.get(n) ?? [];
  if (esatti.length > 0) return [...esatti];
  const normali = elenco.perNomeNormale.get(normale(n)) ?? [];
  if (normali.length > 0) return [...normali];
  const p = PORTA_N.exec(n);
  return p && elenco.perIndice.has(Number(p[1])) ? [Number(p[1])] : [];
}

/** L'indice della porta che ha quel nome nell'elenco (passi 2-4), o null: serve alla velocità per chiave. */
export function portaInElenco(elenco: ElencoPorte, nome: string): number | null {
  const p = chiavePorta("", { nome, fisica: null, senzaFili: null, nelBridge: null, fascio: null }, "remoto", elenco);
  return p.chiave === null ? null : Number(p.chiave.slice(2));
}
```

In `src/lib/topology/links.ts` le righe 57-83 (le tre espressioni e `physicalPortName`) diventano (stesse risposte di prima per ogni nome; dal Task 7 la logica legge i fatti dei traduttori e queste due funzioni si tolgono). L'import va in testa al file, con gli altri:

```ts
import { traduciMikrotikLocale } from "@/lib/topology/lettori/mikrotik";

/**
 * La porta fisica di un nome di porta, o null. Le forme MikroTik stanno nel loro traduttore (spec §13.6.1); qui, fino
 * al Task 7, lo stesso risultato di prima per ogni nome: MNDP riporta la porta di un bridge come «ether3,bridge» e conta
 * il primo elemento; un nome non MikroTik con «,» o «.» non è una porta fisica.
 */
export function physicalPortName(port: string): string | null {
  const l = traduciMikrotikLocale(port);
  if (l.fisica === true) return l.nome;
  if (l.fisica === false || l.nome === "" || port.includes(",")) return null;
  return l.nome;
}
```

(`isPhysicalPort` a `:85-87` resta com'è.) In `src/lib/topology/__tests__/links.test.ts` la prova M-7 (`:205-215`) diventa (si toglie nel Task 7, come quella accanto):

```ts
// Revisione finale M-7: il suffisso dopo `ether1-` era qualunque cosa, così `ether1-vlan20` (una VLAN rinominata) passava per
// porta fisica. Verifica del 15/10 (vincolo 9): nemmeno un intero nudo o un numero col punto («ether1-20», «ether2-1.1»), che
// su un'altra rete può essere una VLAN; resta una velocità (`-2.5`, `10g`, `2.5g`).
test("M-7: ether1-<suffisso> è fisica solo con una velocità; ether1-vlan20, ether1-20 ed ether2-1.1 no", () => {
  for (const p of ["ether1-2.5", "ether1-10g", "ether1-2.5g", "ether1-10G", "sfp-sfpplus1-10g", "qsfp28-1-1"]) {
    assert.equal(isPhysicalPort(p), true, p);
  }
  for (const p of ["ether1-vlan20", "ether1-wan", "ether1-lan.10", "ether1-2.5x", "sfp1-uplink", "ether1-20", "ether2-1.1"]) {
    assert.equal(isPhysicalPort(p), false, p);
  }
});
```

- [ ] **Step 4: verdi** — le prove nuove e tutte quelle della topologia (le due prove di `links.test.ts` sui nomi fisici restano verdi: il wrapper dà le stesse risposte; si tolgono nel Task 7):

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1-3.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`. Poi `npx tsc --noEmit` e `npx eslint src/lib/topology` con `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/lettori src/lib/topology/cavi/porte.ts src/lib/topology/links.ts src/lib/topology/__tests__/traduci.test.ts src/lib/topology/__tests__/porte.test.ts src/lib/topology/__tests__/cavi-senza-prodotti.test.ts src/lib/topology/__tests__/links.test.ts
git commit -m "feat(topologia): traduttori per prodotto e chiave della porta, logica pura; nessun nome scelto nella logica (spec §13.6.1, I58)"
```

---

### Task 4: misura e scenari (T1.0)

Spec §13.12.1 (`misura-cavi`, scenari, S12), §13.3.2 (C1-C19), §13.3.3 (H1-H21: in T1 H7, H15, H16, H17 dal passaggio universale), §13.3.4 (R1-R7: R1 dice su quale lettura delle VM è fatta la misura), §13.10.1 («Misura»). **Si scrive prima di toccare il modello.** Dal passaggio universale la misura conta anche la testa proposta della mappa automatica e quella di ogni sede (C19, H17), le linee di un router col traduttore del suo prodotto da un nome scelto (H7, con la stessa scelta del traduttore della regola), gli hypervisor sotto una loro VM (H15), e stampa la data dell'ultima lettura delle VM di ogni hypervisor (R1): così il «prima» li ha già. I Task 1-3 non cambiano il modello (le prove di oggi sono verdi senza un numero cambiato): il «prima» misurato dopo l'ondata 2 è quello del codice di oggi. La logica delle misure sta in un modulo puro provato da `npm test` (`scripts/__tests__` non gira con `npm test`); lo script legge la copia, chiama, stampa.

**Files:**
- Create: `src/lib/topology/misura.ts`
- Create: `src/lib/topology/__tests__/misura.test.ts`
- Create: `scripts/misura-cavi.ts`

**Interfaces:**
- Consumes: Task 1 (`attraversa`, `candidatiLati`, `latiVicini`, `lineaAlbero`, `ostacoli`, `percorso`, `rettangoli`, `siGuardano`, `troncoPossibile`, `Lato`, `Pt`, `Rect`), `redundantEnds`, `drawableLinks` (`map-screen.ts`), `stepPoints` (`print-draw.ts:30`), `computeMapView`/`MapComputed` (`map-compute.ts`), `buildNodeIndex`/`resolveNode`/`addNodeMacs` (`node-index.ts`, `addNodeMacs` a `:60`), `resolveScanHosts` (`vms.ts:98`), Task 2 (`parseMikrotikNeighbors`), **Task 3** (`haTraduttore`, `traduciPorta`, `type ComeLetto` da `lettori/traduci.ts`: per questo il Task 4 gira dopo il Task 3, ondata 2b), `getSmoothStepPath`/`Position` (`@xyflow/react`, solo nello script: è il percorso che disegna la pagina di oggi).
- Produces (da `src/lib/topology/misura.ts`): `chiaveMisura(nome: string): string`; `lineeCucite(input: TopologyModelInput, model: Pick<TopologyModel, "links" | "canonical">): MapLink[]`; `ramiControVerso(tree: Pick<TreeResult, "via" | "children">): number`; `padriDi(tree: Pick<TreeResult, "children" | "roots">): Record<string, string | null>`; `padriCambiati(prima, dopo): Array<{ id: string; prima: string | null | undefined; dopo: string | null | undefined }>`; `interface LineaMisurata { a: Rect; la: Lato; b: Rect; lb: Lato; punti: Pt[]; tra: [string, string] }`; `lineeDaMisurare(c, regola: "oggi" | "nuova", percorsoOggi: (s: Rect, la: Lato, t: Rect, lb: Lato) => Pt[]): LineaMisurata[]`; `giriEAttraversamenti(linee, ostacoliDi: (l: LineaMisurata) => readonly Rect[], o: MapOrientation): { giri: number; attraversamenti: number }`; `type Scenario`; `applicaScenario(input: TopologyModelInput, s: Scenario): TopologyModelInput`; `leggiScenario(testo: string): Scenario | null`; `conteggi(input, model, c, percorsoOggi): Record<string, number>`; dal passaggio universale `teste(model: TopologyModel): { proposta: string | null; sedi: Record<string, string | null> }`, `testeCambiate(prima, dopo): Array<{ dove: string; prima: string | null | undefined; dopo: string | null | undefined }>`, `lettureVm(input: Pick<TopologyModelInput, "vms" | "scanHosts">): Record<string, string | null>`, `sottoUnaSuaVm(model: Pick<TopologyModel, "vms">, padri: Readonly<Record<string, string | null>>): string[]`, `lineeDaNomeScelto(input: { devices: ReadonlyArray<Pick<ModelDeviceRow, "id" | "vendor" | "device_type" | "controller_mac"> & { via?: string | null }> }, model: Pick<TopologyModel, "links">): MapLink[]` (la via si legge dall'ingresso dal Task 5; prima si suppone SSH), e lo scenario `{ nome: "S12"; apparato: number; vmid: number }`. Il Task 6 aggiunge allo script `--senza-regola`; il Task 7 aggiunge `porte_di_segmento` a `conteggi` (e l'elenco delle porte di segmento a `--nomi`), il Task 9 `correzioni_orfane`, il Task 13 `senza_prove` e `visti_solo_via_lldp`; il Task 10b aggiunge allo script l'opzione `--ripristino`.

- [ ] **Step 1: le prove che falliscono** — `src/lib/topology/__tests__/misura.test.ts`:

```ts
// Le misure del capitolo 13 (spec topologia §13.12.1, pezzo T1.0): contano, non disegnano. Dati inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applicaScenario, chiaveMisura, giriEAttraversamenti, leggiScenario, lettureVm, lineeCucite, lineeDaNomeScelto, padriCambiati, padriDi,
  ramiControVerso, sottoUnaSuaVm, teste, testeCambiate, type LineaMisurata,
} from "@/lib/topology/misura";
import { buildTopologyModel } from "@/lib/topology/model";
import { LINK_ATTRS_DEFAULT, type MapLink } from "@/lib/topology/model-types";
import { baseInput, dev } from "./support/righe";

const L = (a: string, aPort: string, b: string, bPort: string, over: Partial<MapLink> = {}): MapLink => ({
  id: `link:${a}|${b}`, a, aPort, b, bPort, source: "lldp", sources: ["lldp"], uplinkFrom: null, lastSeen: null, daysUnseen: null,
  stale: false, ...LINK_ATTRS_DEFAULT, ...over,
});

test("chiaveMisura: la stessa porta scritta prima (grezza) e dopo (tradotta) dà la stessa chiave", () => {
  assert.equal(chiaveMisura("ether3,bridge"), chiaveMisura("ether3"));
  assert.equal(chiaveMisura("bridge/sfp-sfpplus1"), chiaveMisura("sfp-sfpplus1"));
  assert.equal(chiaveMisura("SFP_ 9"), chiaveMisura("SFP+ 9"));
  assert.notEqual(chiaveMisura("SFP 1"), chiaveMisura("SFP+ 1"));
});

test("C4, linee cucite: due porte piene che nessuna prova sola ha (incidente del 14/10, «porta 10 ↔ ether8»)", () => {
  const input = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router" }), dev(114, { name: "CORE-1", controller_mac: "02:00:00:00:01:14", uplink_mac: "02:00:00:00:00:01" })],
    knownMacs: [{ device_id: 1, mac: "02:00:00:00:00:01" }],
    uplinkPorts: [{ device_id: 114, port_index: 10, port_name: "Port 10" }],
    neighbors: [
      { device_id: 1, local_port: "ether8", remote_device_name: "CORE-1", remote_port: "Port 15", protocol: "lldp", remote_ip: null, remote_mac: "02:00:00:00:01:14", timestamp: "2026-10-13 11:00:00", source: "device" },
      { device_id: 1, local_port: "sfp-sfpplus1,bridge", remote_device_name: "CORE-1", remote_port: "Port 10", protocol: "lldp", remote_ip: null, remote_mac: "02:00:00:00:01:14", timestamp: "2026-10-13 11:00:00", source: "device" },
    ],
  });
  const cucita = L("dev:114", "Port 10", "dev:1", "ether8");      // la porta del figlio dall'uplink, quella del padre dalla prima riga
  const buona = L("dev:114", "Port 10", "dev:1", "sfp-sfpplus1"); // le due porte della stessa riga del router
  const mezza = L("dev:114", "Port 10", "dev:1", "");
  assert.deepEqual(lineeCucite(input, { links: [cucita, buona, mezza], canonical: {} }).map((l) => l.bPort), ["ether8"]);
});

// Rete-campione della famiglia 4 (15/10): la scheda di un hypervisor si annuncia con l'LLDP del firmware, senza nome; il modello la
// abbina col MAC della scansione delle VM, e la misura deve fare lo stesso, altrimenti la linea vera risulta «cucita».
test("C4 — una riga abbinata col MAC della scansione dell'hypervisor è una prova come le altre", () => {
  const NIC = "02:00:00:00:41:a1";
  const input = baseInput({
    devices: [dev(2, { name: "CORE" }), dev(41, { name: "pve-1", device_type: "server", vendor: "proxmox", proxmox_scan: 1, port_count: 0 })],
    neighbors: [{ device_id: 2, local_port: "Port 3", remote_device_name: "", remote_port: NIC, protocol: "lldp", remote_ip: null, remote_mac: NIC, timestamp: "2026-10-13 11:00:00", source: "unifi" }],
    scanHosts: [{ scannedDeviceId: 41, hostname: "pve-1", ips: [], macs: [NIC] }],
  });
  assert.deepEqual(lineeCucite(input, { links: [L("dev:2", "Port 3", "dev:41", NIC)], canonical: {} }), []);
});

// C2 (spec §13.3.2) conta solo gli uplink del CONTROLLER: anche una linea «tabella MAC» o «dalle VM» ha `uplinkFrom`, ma con
// un altro senso (revisione del piano, 15/10: sull'hub il «prima» contava 1 per una linea «tabella MAC»).
test("C2, rami contro il verso: il padre è il figlio secondo l'uplink del controller; le altre fonti non contano", () => {
  const verso = L("dev:112", "Port 47", "dev:114", "Port 9", { uplinkFrom: "dev:112", source: "unifi_uplink", sources: ["unifi_uplink", "lldp"] });
  const tree = { roots: ["dev:1"], children: new Map([["dev:1", ["dev:112"]], ["dev:112", ["dev:114"]], ["dev:114", []]]), via: new Map([["dev:114", verso]]) };
  assert.equal(ramiControVerso(tree), 1);
  const giusto = { ...tree, children: new Map([["dev:1", ["dev:114"]], ["dev:114", ["dev:112"]], ["dev:112", []]]), via: new Map([["dev:112", verso]]) };
  assert.equal(ramiControVerso(giusto), 0);
  const tabellaMac = { ...tree, via: new Map([["dev:114", { ...verso, source: "mac_table" as const, sources: ["mac_table" as const] }]]) };
  assert.equal(ramiControVerso(tabellaMac), 0);
});

test("padri e padri cambiati (chi entra o esce dall'albero ha undefined dall'altra parte)", () => {
  const p = padriDi({ roots: ["dev:1"], children: new Map([["dev:1", ["dev:114"]], ["dev:114", ["dev:112"]], ["dev:112", []]]) });
  assert.deepEqual(p, { "dev:1": null, "dev:112": "dev:114", "dev:114": "dev:1" });
  assert.deepEqual(padriCambiati({ "dev:1": null, "dev:112": "dev:1", "host:9": "dev:1" }, p), [
    { id: "dev:112", prima: "dev:1", dopo: "dev:114" }, { id: "dev:114", prima: undefined, dopo: "dev:1" }, { id: "host:9", prima: "dev:1", dopo: undefined },
  ]);
});

test("C10 e C11: una linea che fa il giro; una che attraversa un riquadro quando un candidato non lo fa", () => {
  const s = { x: 0, y: 0, w: 200, h: 44 }, t = { x: 0, y: 100, w: 200, h: 44 };
  const giro: LineaMisurata = { a: s, la: "dx", b: t, lb: "sx", punti: [{ x: 200, y: 22 }, { x: 220, y: 22 }, { x: 220, y: 122 }, { x: 0, y: 122 }], tra: ["dev:1", "dev:2"] };
  const ostacolo = { x: 80, y: 50, w: 40, h: 30 };
  assert.deepEqual(giriEAttraversamenti([giro], () => [ostacolo], "lr"), { giri: 1, attraversamenti: 0 });
  const dritta: LineaMisurata = { a: s, la: "giu", b: t, lb: "su", punti: [{ x: 100, y: 44 }, { x: 100, y: 100 }], tra: ["dev:1", "dev:2"] };
  // Attraversa il riquadro in mezzo, ma la «Z» fra gli stessi lati… passa sullo stesso tratto: nessun candidato pulito.
  assert.deepEqual(giriEAttraversamenti([dritta], () => [ostacolo], "lr"), { giri: 0, attraversamenti: 0 });
  const lontani: LineaMisurata = { a: s, la: "dx", b: { x: 400, y: 300, w: 200, h: 44 }, lb: "sx",
    punti: [{ x: 200, y: 22 }, { x: 300, y: 22 }, { x: 300, y: 322 }, { x: 400, y: 322 }], tra: ["dev:1", "dev:3"] };
  assert.deepEqual(giriEAttraversamenti([lontani], () => [{ x: 280, y: 150, w: 40, h: 40 }], "lr"), { giri: 0, attraversamenti: 1 });
});

test("scenari: S1 senza correzioni; S3 senza l'uplink di un apparato; S4 lldp su tutte le righe fra router; S9 un vicino di ieri", () => {
  const input = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router" }), dev(2, { name: "RTR-2", device_type: "router" }), dev(114, { uplink_mac: "02:00:00:00:00:01" })],
    uplinkPorts: [{ device_id: 114, port_index: 10, port_name: "Port 10" }],
    overrides: [{ id: 1, action: "ignore", a_node: "dev:114", a_port: "Port 10", b_node: "dev:1", b_port: "ether8", medium: null }],
    neighbors: [
      { device_id: 1, local_port: "ether3", remote_device_name: "RTR-2", remote_port: "ether3", protocol: "mndp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: "2026-10-13 11:00:00", source: "device" },
      { device_id: 1, local_port: "ether1", remote_device_name: "SW-114", remote_port: "Port 1", protocol: "mndp", remote_ip: null, remote_mac: null, timestamp: "2026-10-13 11:00:00", source: "device" },
    ],
  });
  assert.deepEqual(applicaScenario(input, { nome: "S1" }).overrides, []);
  const s3 = applicaScenario(input, { nome: "S3", apparato: 114 });
  assert.deepEqual([s3.devices.find((d) => d.id === 114)?.uplink_mac, s3.uplinkPorts], [null, []]);
  assert.deepEqual(applicaScenario(input, { nome: "S4" }).neighbors.map((n) => n.protocol), ["lldp", "mndp"]);
  const s9 = applicaScenario(input, { nome: "S9", apparato: 114, porta: "Port 10", fonte: "unifi" });
  const vecchia = s9.neighbors[s9.neighbors.length - 1];
  assert.deepEqual([vecchia.device_id, vecchia.local_port, vecchia.source, vecchia.timestamp], [114, "Port 10", "unifi", "2026-10-10 12:00:00"]);
  assert.deepEqual(leggiScenario("S9:114:Port 10:unifi"), { nome: "S9", apparato: 114, porta: "Port 10", fonte: "unifi" });
  assert.deepEqual(leggiScenario("S3:114"), { nome: "S3", apparato: 114 });
  assert.equal(leggiScenario("S7"), null);
});

// ─── Passaggio universale (spec §13.16): le misure che i criteri nuovi chiedono, sui due casi reali e su ogni rete ───

// C19 e H17: la testa proposta (quando nessuno l'ha scelta) e la testa di ogni sede, prima e dopo ogni regola.
test("teste: la proposta della mappa automatica e quella di ogni sede; testeCambiate dice dove cambiano", () => {
  const m = buildTopologyModel(baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", location_id: 7 }), dev(2, { name: "SW-2", location_id: 7 })],
    locations: [{ id: 7, name: "Sede 7", parent_id: null, head_device_id: null }],
    networks: [{ id: 1, cidr: "10.0.0.0/24", name: "lan", gateway: "10.0.0.1", location_id: 7 }],
    // il router legge i suoi vicini (la prova di ruolo che il dato vero ha: da T1b un router senza prove non fa la testa)
    neighbors: [{ device_id: 1, local_port: "ether2", remote_device_name: "SW-2", remote_port: "Port 1", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: "2026-10-13 11:00:00", source: "device" }],
  }));
  const t = teste(m);
  assert.deepEqual(t, { proposta: "dev:1", sedi: { "7": "dev:1" } });
  assert.deepEqual(testeCambiate(t, { proposta: "dev:2", sedi: { "7": "dev:1", "8": null } }), [
    { dove: "mappa automatica", prima: "dev:1", dopo: "dev:2" }, { dove: "sede 8", prima: undefined, dopo: null },
  ]);
});

// R1 (spec §13.3.4): la misura dice su quale lettura delle VM è fatta. Dal 15/10 l'hub rilegge le VM ogni notte, e una VM
// spenta o spostata cambia i collegamenti «dalle VM»: «prima» e «dopo» si misurano sulla stessa copia.
test("R1 — lettureVm: per ogni apparato scansionato, la lettura delle VM più recente (anche dagli host del cluster)", () => {
  const vm = (scannedDeviceId: number, vmid: number, scannedAt: string | null) => ({
    scannedDeviceId, vmid, name: `vm-${vmid}`, node: "pve-a", status: "running", type: "qemu", macs: [], ips: [], scannedAt,
  });
  const i = baseInput({
    vms: [vm(4, 100, "2026-04-27 09:00:00"), vm(4, 101, "2026-04-27T09:05:00.000Z"), vm(5, 200, null)],
    scanHosts: [{ scannedDeviceId: 4, hostname: "pve-a", ips: [], macs: [], scannedAt: "2026-10-15 03:00:00" }],
  });
  assert.deepEqual(lettureVm(i), { "dev:4": "2026-10-15 03:00:00", "dev:5": null });
});

// H15, I62 (spec §13.7.8): nessun oggetto sotto una sua VM. Rete B: l'hypervisor appeso alla scheda del firewall virtuale.
test("H15 — sottoUnaSuaVm: gli hypervisor il cui padre è una loro VM", () => {
  const vms = [{ id: "vm:4:120", name: "fw", status: "running", ips: [], hypervisorNodeId: "dev:4", nodeId: "dev:15", scannedAt: null }];
  assert.deepEqual(sottoUnaSuaVm({ vms }, { "dev:4": "dev:15", "dev:15": "dev:2" }), ["dev:4"]);
  assert.deepEqual(sottoUnaSuaVm({ vms }, { "dev:4": "dev:2", "dev:15": "dev:2" }), []);
});

// H7 (spec §13.3.3): nessuna linea di un router col traduttore del suo prodotto da un nome scelto dal cliente. Il conto vale sulle
// porte grezze di prima («VL_16_X», «ether3,bridge») e su quelle tradotte di dopo; le correzioni a mano non contano.
test("H7 — lineeDaNomeScelto: linee dei dati con un capo su un router col traduttore del suo prodotto e una porta che il traduttore non riconosce", () => {
  // dev:4 è un MikroTik letto via SNMP: passa dal traduttore generico, e la regola lo lascia stare (verifica del 15/10)
  const snmp = Object.assign(dev(4, { device_type: "router", vendor: "mikrotik" }), { via: "snmp_v2" });
  const i = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik" }), dev(2), dev(3, { device_type: "router", vendor: "cisco" }), snmp] });
  const l = (id: string, aPort: string, b: string, over: Partial<MapLink> = {}) => L("dev:1", aPort, b, "Port 1", { id, ...over });
  const linee = [
    l("a", "VL_16_X", "dev:2"), l("b", "ether3,bridge", "dev:2"), l("c", "sfp-sfpplus1", "dev:2"), l("d", "vlan10", "dev:2"),
    l("e", "PONTE-A", "dev:2", { source: "manual", sources: ["manual"] }), L("dev:3", "Gi1/0/5", "dev:2", "Port 2", { id: "f" }),
    L("dev:4", "VL_16_X", "dev:2", "Port 3", { id: "g" }),
  ];
  assert.deepEqual(lineeDaNomeScelto(i, { links: linee }).map((x) => x.id), ["a"]);
});

test("S12 — lettura delle VM rinnovata: la VM indicata spenta, al suo posto un'altra accesa con gli stessi MAC", () => {
  const vm = { scannedDeviceId: 4, vmid: 120, name: "fw", node: "pve-a", status: "running", type: "qemu", macs: ["02:00:00:00:12:01"], ips: [], scannedAt: "2026-04-27 09:00:00" };
  const s = applicaScenario(baseInput({ vms: [vm] }), { nome: "S12", apparato: 4, vmid: 120 });
  assert.deepEqual(s.vms.map((v) => [v.vmid, v.status, v.macs]), [[120, "stopped", ["02:00:00:00:12:01"]], [100120, "running", ["02:00:00:00:12:01"]]]);
  assert.equal(s.vms[1].scannedAt, "2026-10-13T12:00:00.000Z");
  assert.deepEqual(leggiScenario("S12:4:120"), { nome: "S12", apparato: 4, vmid: 120 });
  assert.equal(leggiScenario("S12:4"), null);
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/misura.test.ts > "$SCRATCH/t1-4.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`, «Cannot find module '@/lib/topology/misura'».

- [ ] **Step 3: il codice** — `src/lib/topology/misura.ts`:

```ts
/**
 * Le misure della topologia sulle copie (spec topologia §13.12.1, pezzo T1.0): contano, non disegnano. Lo script
 * `scripts/misura-cavi.ts` legge una copia, chiama queste funzioni e stampa i numeri; i nomi solo con `--nomi`, a
 * terminale. Le stesse funzioni misurano il codice di prima e quello di dopo: per questo il confronto delle porte usa
 * una normalizzazione sua (`chiaveMisura`), che vale sia per i nomi grezzi di prima sia per quelli tradotti di dopo.
 * Logica pura.
 */
import type { MapComputed } from "@/lib/topology/map-compute";
import {
  attraversa, candidatiLati, drawableLinks, latiVicini, lineaAlbero, ostacoli, percorso, redundantEnds, rettangoli, siGuardano, troncoPossibile,
  type Lato, type Pt, type Rect,
} from "@/lib/topology/map-screen";
import { parseDbDate } from "@/lib/db-date";
import { haTraduttore, traduciPorta, type ComeLetto } from "@/lib/topology/lettori/traduci";
import type { MapLink, MapOrientation, MapVm, ModelDeviceRow, TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, resolveNode } from "@/lib/topology/node-index";
import { stepPoints } from "@/lib/topology/print-draw";
import { proposeHead, type TreeResult } from "@/lib/topology/tree";
import { resolveScanHosts } from "@/lib/topology/vms";

const DAY_MS = 86_400_000;

/** Una porta per il confronto fra prima e dopo: «ether3,bridge» e «ether3», «bridge/ether3» ed «ether3», «SFP_ 9» e «SFP+ 9». */
export function chiaveMisura(nome: string): string {
  const primo = nome.split(",")[0];
  const ultimo = primo.split("/").pop() ?? primo;
  return ultimo.replace(/^sfp_(?=\s)/i, "sfp+").replace(/\s+/g, "").toLowerCase();
}

/**
 * C4 — le linee «cucite»: due porte piene che nessuna prova sola ha. Una prova sola è la riga di un vicino (porta
 * locale e porta remota, per IP, MAC o nome), l'uplink del controller (porta del figlio e porta del padre, se il
 * controller la sa) o una correzione «aggiungi». La porta riempita dalle VM non è una prova delle due porte.
 */
export function lineeCucite(input: TopologyModelInput, model: Pick<TopologyModel, "links" | "canonical">): MapLink[] {
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
  // Gli stessi abbinamenti del modello (model.ts): i MAC delle schede di un hypervisor vengono dalla sua scansione. Senza, una
  // riga LLDP del firmware di una scheda (senza nome) non si abbinava qui, e la linea vera risultava «cucita» (famiglia 4 delle
  // reti-campione, 15/10).
  for (const { row, nodeId } of resolveScanHosts(input.scanHosts, idx)) if (nodeId) addNodeMacs(idx, nodeId, row.macs);
  const canon = (id: string) => model.canonical[id] ?? id;
  const prove = new Set<string>();
  const aggiungi = (x: string, px: string, y: string, py: string): void => {
    if (!px.trim() || !py.trim()) return;
    prove.add(`${canon(x)}|${chiaveMisura(px)}|${canon(y)}|${chiaveMisura(py)}`);
    prove.add(`${canon(y)}|${chiaveMisura(py)}|${canon(x)}|${chiaveMisura(px)}`);
  };
  for (const n of input.neighbors) {
    const x = `dev:${n.device_id}`;
    for (const ref of [{ ip: n.remote_ip }, { mac: n.remote_mac }, { name: n.remote_device_name }]) {
      const y = resolveNode(idx, ref);
      if (y && y !== x) aggiungi(x, n.local_port, y, n.remote_port);
    }
  }
  const primaPorta = new Map<number, string>();
  for (const p of [...input.uplinkPorts].sort((a, b) => a.device_id - b.device_id || a.port_index - b.port_index)) {
    if (!primaPorta.has(p.device_id)) primaPorta.set(p.device_id, p.port_name);
  }
  for (const d of input.devices) {
    if (!d.uplink_mac || d.uplink_remote_port == null) continue;
    const y = resolveNode(idx, { mac: d.uplink_mac });
    if (y) aggiungi(`dev:${d.id}`, primaPorta.get(d.id) ?? "", y, `Port ${d.uplink_remote_port}`);
  }
  for (const o of input.overrides) if (o.action === "add") aggiungi(o.a_node, o.a_port, o.b_node, o.b_port);
  return model.links.filter((l) => l.aPort.trim() && l.bPort.trim() && !prove.has(`${l.a}|${chiaveMisura(l.aPort)}|${l.b}|${chiaveMisura(l.bPort)}`));
}

/**
 * C2 — rami dell'albero che percorrono un uplink del controller al contrario: il padre è il figlio secondo il
 * controller. Solo le linee con la fonte `unifi_uplink`: anche «tabella MAC» e «dalle VM» hanno `uplinkFrom`, con un
 * altro senso. Il caso «non c'è un'altra via di pari rango» della spec non si calcola: si guarda nell'elenco `--nomi`.
 */
export function ramiControVerso(tree: Pick<TreeResult, "via" | "children">): number {
  const padre = new Map<string, string>();
  for (const [p, figli] of tree.children) for (const f of figli) padre.set(f, p);
  let n = 0;
  for (const [figlio, l] of tree.via) if (l.sources.includes("unifi_uplink") && l.uplinkFrom !== null && l.uplinkFrom === padre.get(figlio)) n++;
  return n;
}

/** Il padre di ogni oggetto dell'albero (le radici: null), in ordine di id. */
export function padriDi(tree: Pick<TreeResult, "children" | "roots">): Record<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of tree.roots) out.set(r, null);
  for (const [p, figli] of tree.children) for (const f of figli) out.set(f, p);
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Chi ha un altro padre; `undefined` da una parte = l'oggetto entra o esce dall'albero. */
export function padriCambiati(prima: Readonly<Record<string, string | null>>, dopo: Readonly<Record<string, string | null>>):
  Array<{ id: string; prima: string | null | undefined; dopo: string | null | undefined }> {
  const ids = [...new Set([...Object.keys(prima), ...Object.keys(dopo)])].sort();
  return ids.filter((id) => prima[id] !== dopo[id]).map((id) => ({ id, prima: prima[id], dopo: dopo[id] }));
}

export interface LineaMisurata { a: Rect; la: Lato; b: Rect; lb: Lato; punti: Pt[]; tra: [string, string] }

/**
 * Le linee che il lato più vicino cambia: le ridondanze fra due riquadri e le linee dei figli spostati a mano dall'altra
 * parte. «oggi»: i lati di prima (in «Verticale» da destra a sinistra, in «Orizzontale» dal fondo alla cima) col
 * percorso che disegna la pagina di prima (`percorsoOggi`, dallo script) o i gradini della stampa; «nuova»: `latiVicini`.
 */
export function lineeDaMisurare(c: Pick<MapComputed<TopologyModel>, "tree" | "layout">, regola: "oggi" | "nuova",
  percorsoOggi: (s: Rect, la: Lato, t: Rect, lb: Lato) => Pt[]): LineaMisurata[] {
  const { tree, layout } = c;
  const o = layout.orientation;
  const tutti = rettangoli(layout);
  const oggi: { da: Lato; a: Lato } = o === "lr" ? { da: "dx", a: "sx" } : { da: "giu", a: "su" };
  const out: LineaMisurata[] = [];
  for (const l of drawableLinks(tree.links, layout.nodes)) {
    if (!l.redundant) continue;
    const [s, t] = redundantEnds(o, layout.nodes.get(l.a)!, layout.nodes.get(l.b)!);
    const rs = layout.nodes.get(s)!, rt = layout.nodes.get(t)!;
    const lati = regola === "oggi" ? oggi : latiVicini(rs, rt, o, ostacoli(tutti, [s, t]));
    const punti = regola === "oggi" ? percorsoOggi(rs, lati.da, rt, lati.a) : percorso(rs, lati.da, rt, lati.a);
    out.push({ a: rs, la: lati.da, b: rt, lb: lati.a, punti, tra: [s, t] });
  }
  for (const [figlio] of tree.via) {
    const f = layout.nodes.get(figlio);
    const p = f?.parent ? layout.nodes.get(f.parent) : undefined;
    if (!f || !p || f.role !== "box" || troncoPossibile(o, p, f)) continue;
    const la = regola === "oggi" ? { tronco: true as const } : lineaAlbero(o, p, f, ostacoli(tutti, [p.id, f.id]));
    out.push(la.tronco
      ? { a: p, la: oggi.da, b: f, lb: oggi.a, punti: stepPoints(o, p, f), tra: [p.id, f.id] }
      : { a: p, la: la.lati.da, b: f, lb: la.lati.a, punti: percorso(p, la.lati.da, f, la.lati.a), tra: [p.id, f.id] });
  }
  return out;
}

/** C10 (linee che fanno il giro) e C11 (linee che attraversano un riquadro quando uno dei quattro candidati non lo fa). */
export function giriEAttraversamenti(linee: readonly LineaMisurata[], ostacoliDi: (l: LineaMisurata) => readonly Rect[], o: MapOrientation):
  { giri: number; attraversamenti: number } {
  let giri = 0, attraversamenti = 0;
  for (const l of linee) {
    if (!siGuardano(l.a, l.la, l.b, l.lb)) giri++;
    const ost = ostacoliDi(l);
    if (attraversa(l.punti, ost) && candidatiLati(l.a, l.b, o).some((c) => !attraversa(percorso(l.a, c.da, l.b, c.a), ost))) attraversamenti++;
  }
  return { giri, attraversamenti };
}

/** Gli scenari costruiti in memoria sull'ingresso del modello (spec §13.12.1). S2b è il codice di T1 sul dato vero (S0). */
export type Scenario =
  | { nome: "S0" }
  | { nome: "S1" }
  | { nome: "S3"; apparato: number }
  | { nome: "S4" }
  | { nome: "S9"; apparato: number; porta: string; fonte: string }
  | { nome: "S12"; apparato: number; vmid: number };

/** «S0», «S1», «S3:‹id›», «S4», «S9:‹id›:‹porta›:‹fonte›», «S12:‹apparato scansionato›:‹vmid›»; altrimenti null. */
export function leggiScenario(testo: string): Scenario | null {
  const [nome, ...resto] = testo.split(":");
  if (nome === "S0" || nome === "S1" || nome === "S4") return resto.length === 0 ? { nome } : null;
  if (nome === "S3" && resto.length === 1 && /^\d+$/.test(resto[0])) return { nome, apparato: Number(resto[0]) };
  if (nome === "S9" && resto.length === 3 && /^\d+$/.test(resto[0]) && resto[1] && resto[2]) return { nome, apparato: Number(resto[0]), porta: resto[1], fonte: resto[2] };
  if (nome === "S12" && resto.length === 2 && resto.every((x) => /^\d+$/.test(x))) return { nome, apparato: Number(resto[0]), vmid: Number(resto[1]) };
  return null;
}

export function applicaScenario(input: TopologyModelInput, s: Scenario): TopologyModelInput {
  switch (s.nome) {
    case "S0":
      return input;
    case "S1": // senza correzioni
      return { ...input, overrides: [] };
    case "S3": // senza l'uplink del controller di un apparato (core 1): C3
      return {
        ...input,
        devices: input.devices.map((d) => (d.id === s.apparato ? { ...d, uplink_mac: null, uplink_remote_port: null, uplink_seen_at: null } : d)),
        uplinkPorts: input.uplinkPorts.filter((p) => p.device_id !== s.apparato),
      };
    case "S4": { // caso peggiore di R6: lldp su tutte le righe fra router, dai due lati
      const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
      const router = (id: string | null): boolean => !!id && ["router", "firewall"].includes(idx.nodes.get(id)?.type ?? "");
      return {
        ...input,
        neighbors: input.neighbors.map((n) => (router(`dev:${n.device_id}`) && router(resolveNode(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name }))
          ? { ...n, protocol: "lldp" } : n)),
      };
    }
    case "S9": { // cavo spostato: sulla porta il vicino di ieri, non visto da più della soglia, accanto a quello di oggi
      const ieri = new Date(input.nowMs - (input.staleDays + 1) * DAY_MS).toISOString().slice(0, 19).replace("T", " ");
      return {
        ...input,
        neighbors: [...input.neighbors, {
          device_id: s.apparato, local_port: s.porta, remote_device_name: "S9-VICINO-DI-IERI", remote_port: "Port 1", protocol: "lldp",
          remote_ip: null, remote_mac: "02:00:00:5e:09:09", timestamp: ieri, source: s.fonte,
        }],
      };
    }
    case "S12": { // lettura delle VM rinnovata (R1, H15): la VM indicata spenta; al suo posto una accesa, con gli stessi MAC
      const vecchia = input.vms.find((v) => v.scannedDeviceId === s.apparato && v.vmid === s.vmid);
      if (!vecchia) return input;
      const ora = new Date(input.nowMs).toISOString();
      return {
        ...input,
        vms: [...input.vms.map((v) => (v === vecchia ? { ...v, status: "stopped", scannedAt: ora } : v)),
          { ...vecchia, vmid: vecchia.vmid + 100000, name: `${vecchia.name}-nuova`, status: "running", scannedAt: ora }],
      };
    }
  }
}

/**
 * C19 e H17 (spec §13.3.2, §13.3.3): la testa che il sistema propone per la mappa automatica (`proposeHead`, quando nessuno
 * l'ha scelta) e quella di ogni sede. La misura le confronta prima e dopo ogni regola del passaggio universale (§13.16).
 */
export function teste(model: TopologyModel): { proposta: string | null; sedi: Record<string, string | null> } {
  return { proposta: proposeHead(model), sedi: Object.fromEntries(model.sites.map((s) => [String(s.locationId), s.headNodeId])) };
}

/** Dove la testa cambia: «mappa automatica» o «sede ‹id›»; `undefined` da una parte = la sede non c'era. */
export function testeCambiate(prima: ReturnType<typeof teste>, dopo: ReturnType<typeof teste>):
  Array<{ dove: string; prima: string | null | undefined; dopo: string | null | undefined }> {
  const out: Array<{ dove: string; prima: string | null | undefined; dopo: string | null | undefined }> = [];
  if (prima.proposta !== dopo.proposta) out.push({ dove: "mappa automatica", prima: prima.proposta, dopo: dopo.proposta });
  for (const id of [...new Set([...Object.keys(prima.sedi), ...Object.keys(dopo.sedi)])].sort()) {
    if (prima.sedi[id] !== dopo.sedi[id]) out.push({ dove: `sede ${id}`, prima: prima.sedi[id], dopo: dopo.sedi[id] });
  }
  return out;
}

/**
 * R1 (spec §13.3.4): su quale lettura delle VM è fatta la misura — per ogni apparato scansionato, la data della scansione
 * più recente (VM e host del cluster). Un job che rilegge le VM ogni notte cambia la base da solo (l'hub dal 15/10).
 */
export function lettureVm(input: Pick<TopologyModelInput, "vms" | "scanHosts">): Record<string, string | null> {
  const out = new Map<string, string | null>();
  for (const r of [...input.vms, ...input.scanHosts]) {
    const k = `dev:${r.scannedDeviceId}`;
    const t = r.scannedAt ?? null;
    const cur = out.get(k);
    const ms = (x: string | null | undefined) => (x ? parseDbDate(x).getTime() : NaN);
    if (cur === undefined || (t !== null && (cur === null || ms(t) > ms(cur)))) out.set(k, t);
  }
  return Object.fromEntries([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** H15 (spec §13.7.8): gli hypervisor che stanno sotto una loro VM. Dopo T1 nessuno. */
export function sottoUnaSuaVm(model: Pick<TopologyModel, "vms">, padri: Readonly<Record<string, string | null>>): string[] {
  const vmDi = new Set(model.vms.flatMap((v: MapVm) => (v.nodeId && v.hypervisorNodeId ? [`${v.hypervisorNodeId}|${v.nodeId}`] : [])));
  return Object.entries(padri).filter(([id, p]) => p !== null && vmDi.has(`${id}|${p}`)).map(([id]) => id).sort();
}

/**
 * H7 (spec §13.3.3): le linee dei dati con un capo su un router il cui lato locale passa dal traduttore del suo prodotto
 * (`haTraduttore`: la stessa scelta della regola «nome-scelto-non-fisico») e, da quel capo, una porta che il traduttore non
 * riconosce (un nome scelto dal cliente: «non noto»). Vale sui nomi grezzi di prima e su quelli tradotti di dopo; le
 * correzioni a mano non contano. La via di lettura viene dall'ingresso (dal Task 5); l'ingresso del codice di prima non la
 * porta, e allora si suppone SSH, la via delle righe di `/ip neighbor` (sulle due copie del 14/10 ogni MikroTik è un router
 * letto via SSH). Verifica del 15/10: prima la misura guardava la marca e il traduttore MikroTik, cioè contava anche un
 * MikroTik letto via SNMP, che la regola lascia stare. Dopo T1 nessuna.
 */
export function lineeDaNomeScelto(
  input: { devices: ReadonlyArray<Pick<ModelDeviceRow, "id" | "vendor" | "device_type" | "controller_mac"> & { via?: string | null }> },
  model: Pick<TopologyModel, "links">,
): MapLink[] {
  const come = new Map(input.devices.filter((d) => ["router", "firewall"].includes(d.device_type)).map((d): [string, ComeLetto] => [
    `dev:${d.id}`, { vendor: d.vendor, via: d.via === undefined ? "ssh" : d.via, fonte: d.controller_mac ? "unifi" : "device", piattaforma: null },
  ]));
  const scelto = (nodo: string, porta: string): boolean => {
    const c = come.get(nodo);
    if (!c || porta.trim() === "" || !haTraduttore(c)) return false;
    const l = traduciPorta(porta, "locale", c);
    return l.fisica === null && l.senzaFili !== true;
  };
  return model.links.filter((l) => !l.sources.includes("manual") && (scelto(l.a, l.aPort) || scelto(l.b, l.bPort)));
}

/** I numeri della tappa (spec §13.12.1, §13.3.2): niente nomi. */
export function conteggi(input: TopologyModelInput, model: TopologyModel, c: Pick<MapComputed<TopologyModel>, "tree" | "layout">,
  percorsoOggi: (s: Rect, la: Lato, t: Rect, lb: Lato) => Pt[]): Record<string, number> {
  const o = c.layout.orientation;
  const tutti = rettangoli(c.layout);
  const ost = (l: LineaMisurata) => ostacoli(tutti, l.tra);
  const oggi = giriEAttraversamenti(lineeDaMisurare(c, "oggi", percorsoOggi), ost, o);
  const nuova = giriEAttraversamenti(lineeDaMisurare(c, "nuova", percorsoOggi), ost, o);
  return {
    collegamenti: model.counts.links,
    ...Object.fromEntries(Object.entries(model.counts.linksBySource).map(([k, v]) => [`fonte_${k}`, v])),
    fra_apparati: model.counts.deviceLinks,
    attaccati: model.counts.attachedLinks,
    vicini_non_abbinati: model.counts.unmatchedNeighbors,
    non_visti: model.counts.staleLinks,
    una_porta_vuota: model.links.filter((l) => (l.aPort.trim() === "") !== (l.bPort.trim() === "")).length,
    cucite: lineeCucite(input, model).length,
    linee_da_nome_scelto: lineeDaNomeScelto(input, model).length,
    sotto_una_sua_vm: sottoUnaSuaVm(model, padriDi(c.tree)).length,
    contro_verso: ramiControVerso(c.tree),
    radici: c.tree.roots.length,
    ridondanze: c.tree.links.filter((l) => l.redundant).length,
    da_sistemare_isolati: model.isolated.length,
    da_sistemare_tipi_sospetti: model.suspicious.length,
    host_da_promuovere: model.promote.length,
    giri_oggi: oggi.giri, attraversamenti_oggi: oggi.attraversamenti,
    giri_regola_nuova: nuova.giri, attraversamenti_regola_nuova: nuova.attraversamenti,
  };
}
```

`scripts/misura-cavi.ts`:

```ts
/**
 * misura-cavi.ts — i numeri del capitolo 13 della spec della topologia su una COPIA del DB di un tenant (pezzo T1.0,
 * spec §13.12.1). Copia della copia in una cartella di lavoro dentro --cartella (stesse guardie di misura-topologia);
 * migrazioni applicate lì; stampa solo conteggi. Con --nomi stampa anche i nomi, a terminale: mai su un file del repo.
 *
 * Uso:  npx tsx scripts/misura-cavi.ts <copia.db> --cartella <scratchpad>
 *         [--scenario S0|S1|S3:<id>|S4|S9:<id>:<porta>:<fonte>|S12:<id>:<vmid>] [--soglia <giorni>]
 *         [--uscita-router <id>=<file>]...   righe nuove del router dall'uscita incollata (lettore di T1), insieme alle vecchie
 *         [--salva <istantanea.json>] [--confronta <istantanea.json>]
 *         [--esporta-input <file.json>] [--input-json <file.json>] [--nomi] [--json]
 *   I file di --salva, --confronta, --esporta-input e --input-json stanno dentro --cartella (dati del cliente).
 *   Uscita: 0 fatto, 1 integrità rovinata, 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi, percorsoReale } from "../src/lib/scanner/__tests__/support/percorsi-prova";

const CON_VALORE = ["--cartella", "--scenario", "--soglia", "--uscita-router", "--salva", "--confronta", "--esporta-input", "--input-json"];

function uso(msg?: string): number {
  if (msg) process.stderr.write(`${msg}\n`);
  process.stderr.write("Uso: npx tsx scripts/misura-cavi.ts <copia.db> --cartella <scratchpad> [--scenario …] [--uscita-router <id>=<file>] [--salva|--confronta <file>] [--esporta-input|--input-json <file>] [--nomi] [--json]\n");
  return 2;
}

function dentro(file: string, cartella: string): boolean {
  const rel = path.relative(percorsoReale(cartella), percorsoReale(file));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

const mediana = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Le copie del DB fatte da questo giro (320 MB sul cliente A, 2 GB sull'hub): si tolgono a fine giro, comunque vada; resta il registro. */
const copie: string[] = [];

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const valori = (k: string): string[] => a.flatMap((x, i) => (x === k && a[i + 1] !== undefined ? [a[i + 1]] : []));
  const val = (k: string): string | undefined => valori(k)[0];
  const liberi = a.filter((x, i) => !x.startsWith("--") && !CON_VALORE.includes(a[i - 1] ?? ""));
  const cartella = val("--cartella");
  if (!cartella || liberi.length !== 1) return uso();
  for (const k of ["--salva", "--confronta", "--esporta-input", "--input-json"]) {
    const f = val(k);
    if (f && !dentro(f, cartella)) return uso(`${k} deve stare dentro --cartella: i dati del cliente non escono dallo scratchpad.`);
  }
  const {
    applicaScenario, conteggi, leggiScenario, lettureVm, lineeCucite, lineeDaNomeScelto, padriCambiati, padriDi, sottoUnaSuaVm, teste, testeCambiate,
  } = await import("../src/lib/topology/misura");
  const scenario = leggiScenario(val("--scenario") ?? "S0");
  if (!scenario) return uso("Scenario non valido: S0, S1, S3:<id>, S4, S9:<id>:<porta>:<fonte>, S12:<id>:<vmid>.");
  const soglia = Number(val("--soglia") ?? "2");
  if (!Number.isInteger(soglia) || soglia < 1) return uso("--soglia: giorni interi, almeno 1.");
  const uscite = valori("--uscita-router").map((v) => /^(\d+)=(.+)$/.exec(v));
  if (uscite.some((m) => m === null)) return uso("--uscita-router vuole <id dell'apparato>=<file>.");

  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) return uso("Nome del file non valido come codice tenant.");
  const lavoro = path.join(path.resolve(cartella), `misura-cavi-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  copie.push(dataDir, hubDb, `${hubDb}-wal`, `${hubDb}-shm`);
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) return uso(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}`);
  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  const wal = `${sorgente}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${dest}-wal`);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  // I registri dell'app contengono nomi e indirizzi: vanno nel file di lavoro, non a schermo.
  const registro = path.join(lavoro, "misura.log");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) console[k] = (...p: unknown[]) => fs.appendFileSync(registro, `[${k}] ${p.map(String).join(" ")}\n`);

  // Import dinamico voluto qui (come misura-topologia.ts): l'ambiente va impostato prima che db-tenant si carichi, e lo
  // script è un processo solo, fuori dall'app. ADR 0002 riguarda il runtime dell'app.
  const tenantDb = await import("../src/lib/db-tenant");
  const db = tenantDb.getTenantDb(tenant);
  // Come misura-topologia.ts: una riga di quick_check può portarne molte («*** in database main ***», poi una «Page N:
  // never used» per riga), e una pagina mai usata è spazio non referenziato, non un danno (l'hub ne ha 4, CONTEXT §6).
  // Si va a capo prima di giudicare: unite con «; », sulla copia dell'hub lo script usciva con 1 (verifica del 15/10).
  const righeQuick = (): string[] => (db.prepare("PRAGMA quick_check").all() as Array<{ quick_check: string }>)
    .flatMap((r) => r.quick_check.split("\n")).map((r) => r.trim()).filter((r) => r !== "" && r !== "*** in database main ***");
  const quick = (): string => righeQuick().join("; ");
  const out: Record<string, unknown> = { tenant, scenario: val("--scenario") ?? "S0", quick_check_prima: quick() };

  // C18: le classificazioni degli host prima e dopo le righe nuove del router (l'upsert ricalcola l'attribuzione).
  const classi = () => new Map((db.prepare("SELECT id, COALESCE(classification, '') AS c FROM hosts").all() as Array<{ id: number; c: string }>).map((r) => [r.id, r.c]));
  let cambiati: number[] = [];
  if (uscite.length > 0) {
    const { parseMikrotikNeighbors } = await import("../src/lib/devices/mikrotik-vicini");
    const prima = classi();
    tenantDb.withTenant(tenant, () => {
      for (const m of uscite) tenantDb.upsertNeighbors(Number(m![1]), parseMikrotikNeighbors(fs.readFileSync(m![2], "utf8")));
    });
    const dopo = classi();
    cambiati = [...dopo].filter(([id, c]) => prima.get(id) !== c).map(([id]) => id);
    out.host_cambiati_di_categoria = cambiati.length;
  }

  const fileInput = val("--input-json");
  let letto: unknown = null;
  if (fileInput) {
    try { letto = JSON.parse(fs.readFileSync(fileInput, "utf8")); } catch { return uso("--input-json: file non leggibile."); }
  }
  const { buildTopologyModel } = await import("../src/lib/topology/model");
  const { computeMapView } = await import("../src/lib/topology/map-compute");
  const { centroLato } = await import("../src/lib/topology/map-screen");
  const { pathPoints } = await import("../src/lib/topology/edge-look");
  const { getSmoothStepPath, Position } = await import("@xyflow/react");
  type Input = ReturnType<typeof tenantDb.getTopologyModelInput>;
  const base: Input = (letto as Input | null) ?? tenantDb.withTenant(tenant, () => tenantDb.getTopologyModelInput(soglia));
  const input = applicaScenario(base, scenario);
  const esporta = val("--esporta-input");
  if (esporta) fs.writeFileSync(esporta, JSON.stringify(input));

  let model = buildTopologyModel(input);
  const tempi: number[] = [];
  // 30 giri, la mediana (C17): con 5 la misura appena dopo il primo giro ballava di qualche millisecondo, troppo per un margine
  // di 2-3 ms sui 20 (misura del 15/10 notte: 5 giri 15,4 / 18,5 / 21,2 ms, 30 giri 13,5 / 16,9 / 18,0 per oggi, T1 e T1b).
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now();
    model = buildTopologyModel(input);
    tempi.push(performance.now() - t0);
  }
  out.modello_ms = Math.round(mediana(tempi) * 10) / 10;

  const viste = tenantDb.withTenant(tenant, () => ({
    auto: tenantDb.getAutoMap(), autoVista: tenantDb.getTopologyMapView("auto"),
    mappe: tenantDb.listTopologyMaps().map((m) => ({ m, v: tenantDb.getTopologyMapView(`mappa:${m.id}`) })),
  }));
  const auto = computeMapView(model, {
    auto: true, members: [], roots: [], head: viste.auto?.head_node ?? null, tweaks: viste.autoVista.tweaks, expanded: new Set(), orientation: viste.autoVista.orientation,
  });
  const POS = { su: Position.Top, giu: Position.Bottom, sx: Position.Left, dx: Position.Right } as const;
  const percorsoOggi = (s: { x: number; y: number; w: number; h: number }, la: keyof typeof POS, t: { x: number; y: number; w: number; h: number }, lb: keyof typeof POS) => {
    const ps = centroLato(s, la), pt = centroLato(t, lb);
    const [d] = getSmoothStepPath({ sourceX: ps.x, sourceY: ps.y, sourcePosition: POS[la], targetX: pt.x, targetY: pt.y, targetPosition: POS[lb], borderRadius: 0 });
    return pathPoints(d);
  };
  const numeri = conteggi(input, model, auto, percorsoOggi);
  out.conteggi = numeri;
  // R1: su quale lettura delle VM è fatta la misura (per apparato scansionato, la data della scansione più recente).
  out.letture_vm = lettureVm(input);
  // C19, H17: la testa proposta della mappa automatica e quella di ogni sede (id, non nomi).
  const leTeste = teste(model);
  out.teste = leTeste;
  // R2: ritocchi validi e scaduti, e oggetti persi, per mappa E per orientamento (gli id delle mappe, non i nomi). Una
  // mappa salvata in verticale può avere i ritocchi in orizzontale (la sede 1 del cliente A ne ha 7, R2), e
  // `layout.expired` conta solo l'orientamento in uso: si calcola in quello salvato e in ogni altro che ha ritocchi
  // (verifica del 15/10: calcolata solo nel suo, la mappa della sede 1 dava 0 ritocchi).
  const ORIENTAMENTI = ["lr", "tb"] as const;
  const mappe = [
    { vista: "auto", base: { auto: true, members: [] as string[], roots: [] as string[], head: viste.auto?.head_node ?? null }, tweaks: viste.autoVista.tweaks, salvato: viste.autoVista.orientation },
    ...viste.mappe.map(({ m, v }) => ({ vista: `mappa:${m.id}`, base: { auto: false, members: v.nodes, roots: m.roots, head: null }, tweaks: v.tweaks, salvato: v.orientation })),
  ].flatMap((x) => ORIENTAMENTI.filter((o) => o === x.salvato || x.tweaks.some((t) => t.orientation === o)).map((o) => {
    const c = computeMapView(model, { ...x.base, tweaks: x.tweaks, expanded: new Set(), orientation: o });
    const delVerso = c.tweaks.filter((t) => t.orientation === o);
    const validi = delVerso.filter((t) => c.layout.nodes.get(t.nodeId)?.role === "box" && !c.layout.expired.includes(t.nodeId)).length;
    return { vista: x.vista, orientamento: o, ritocchi: delVerso.length, validi, scaduti: c.layout.expired, oggetti_persi: c.missing.length };
  }));
  out.mappe = mappe.map((x) => ({ ...x, scaduti: x.scaduti.length }));

  const padri = padriDi(auto.tree);
  const salva = val("--salva");
  if (salva) fs.writeFileSync(salva, JSON.stringify({ padri, radici: auto.tree.roots, conteggi: numeri, teste: leTeste, letture_vm: out.letture_vm }, null, 1));
  const confronta = val("--confronta");
  let cambi: ReturnType<typeof padriCambiati> = [];
  if (confronta) {
    let prima: { padri: Record<string, string | null>; conteggi: Record<string, number>; teste?: ReturnType<typeof teste>; letture_vm?: Record<string, string | null> };
    try { prima = JSON.parse(fs.readFileSync(confronta, "utf8")) as typeof prima; } catch { return uso("--confronta: istantanea non leggibile."); }
    cambi = padriCambiati(prima.padri, padri);
    out.padri_cambiati = cambi.length;
    out.teste_cambiate = prima.teste ? testeCambiate(prima.teste, leTeste) : "istantanea senza teste";
    // R1: «prima» e «dopo» sulla stessa lettura delle VM, o la differenza si dice.
    out.stessa_lettura_vm = JSON.stringify(prima.letture_vm ?? null) === JSON.stringify(out.letture_vm);
    out.conteggi_cambiati = Object.fromEntries(Object.keys({ ...prima.conteggi, ...numeri })
      .filter((k) => prima.conteggi[k] !== numeri[k]).map((k) => [k, `${prima.conteggi[k] ?? "—"} → ${numeri[k] ?? "—"}`]));
  }
  out.quick_check_dopo = quick();
  process.stdout.write(a.includes("--json") ? `${JSON.stringify(out, null, 1)}\n` : `${Object.entries(out).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n")}\n`);

  if (a.includes("--nomi")) {
    // A terminale e basta: nomi del cliente. Mai su un file del repo.
    const nome = (id: string | null | undefined) => (id ? (model.nodes.find((n) => n.id === id)?.name ?? id) : "—");
    const w = (s: string) => process.stdout.write(`${s}\n`);
    w("\n— padri cambiati —");
    for (const c of cambi) w(`${nome(c.id)}: ${c.prima === undefined ? "fuori dall'albero" : nome(c.prima)} → ${c.dopo === undefined ? "fuori dall'albero" : nome(c.dopo)}`);
    w("\n— collegamenti fra apparati (mappa automatica) —");
    const vista = new Map(auto.tree.links.map((l) => [l.id, l]));
    for (const l of model.links.filter((x) => x.a.startsWith("dev:") && x.b.startsWith("dev:"))) {
      const v = vista.get(l.id) ?? l;
      w(`${nome(l.a)} ${l.aPort || "?"} ↔ ${nome(l.b)} ${l.bPort || "?"} · ${l.speedMbps ?? "velocità non nota"} · ${l.sources.join("+")} · ${v.primary ? "principale" : v.redundant ? "ridondanza" : "fuori vista"}${l.medium ? ` · ${l.medium}` : ""}`);
    }
    w("\n— teste (C19, H17) —");
    w(`mappa automatica: ${nome(leTeste.proposta)}`);
    for (const s of model.sites) w(`${s.name}: ${nome(s.headNodeId)}${s.headProposed ? " (proposta)" : ""}`);
    w("\n— linee di un router MikroTik da un nome scelto (H7) —");
    for (const l of lineeDaNomeScelto(input, model)) w(`${nome(l.a)} ${l.aPort} ↔ ${nome(l.b)} ${l.bPort} · ${l.sources.join("+")}`);
    w("\n— hypervisor sotto una loro VM (H15) —");
    for (const id of sottoUnaSuaVm(model, padri)) w(`${nome(id)} sotto ${nome(padri[id])}`);
    w("\n— linee cucite —");
    for (const l of lineeCucite(input, model)) w(`${nome(l.a)} ${l.aPort} ↔ ${nome(l.b)} ${l.bPort}`);
    w("\n— ritocchi scaduti, per mappa e orientamento (R2) —");
    for (const x of mappe) for (const id of x.scaduti) w(`${x.vista} ${x.orientamento}: ${nome(id)}`);
    w("\n— «Da sistemare»: senza collegamenti —");
    for (const id of model.isolated) w(nome(id));
    if (cambiati.length > 0) {
      w("\n— host che cambiano categoria (C18) —");
      for (const id of cambiati) w(nome(`host:${id}`));
    }
  }
  return righeQuick().every((r) => r === "ok" || /^Page \d+: never used$/.test(r)) ? 0 : 1;
}

main()
  .catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); return 2; })
  .then((c) => { for (const p of copie) fs.rmSync(p, { recursive: true, force: true }); process.exit(c); });
```

- [ ] **Step 4: verdi**

Run: `node --import tsx --test src/lib/topology/__tests__/misura.test.ts > "$SCRATCH/t1-4.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`. Poi `npx tsc --noEmit` e `npx eslint src/lib/topology/misura.ts scripts/misura-cavi.ts` con `exit=0`. Prova di fumo dello script, che non scrive niente nel repo:

```bash
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<tenant cliente A>.db" --cartella "$SCRATCH" --json > "$SCRATCH/misura-fumo.json" 2> "$SCRATCH/misura-fumo.err"; echo "exit=$?"
git status --short   # nessun file nuovo nel worktree
```

Expected: `exit=0`; il JSON ha `conteggi` (con `linee_da_nome_scelto` e `sotto_una_sua_vm`), `mappe` (una voce per mappa e per orientamento), `modello_ms`, `letture_vm`, `teste`, `quick_check_prima` e `quick_check_dopo` uguali; nella cartella di lavoro `misura-cavi-‹ora›` resta solo `misura.log` (la copia del DB si toglie a fine giro: `du -sh "$SCRATCH"/misura-cavi-*` dà pochi kB; verifica UV2 del 15/10: senza, ogni giro lasciava 320 MB sul cliente A e 2 GB sull'hub); `git status --short` non mostra nessun file oltre ai tre del task (`misura.ts`, `misura.test.ts`, `scripts/misura-cavi.ts`: il commit arriva allo Step 5). La stessa prova sulla copia dell'hub esce con `exit=0` anche con le sue 4 pagine «never used».

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/misura.ts src/lib/topology/__tests__/misura.test.ts scripts/misura-cavi.ts
git commit -m "feat(topologia): misura dei collegamenti sulle copie, scenari S0-S12, teste, letture delle VM (spec §13.12.1, T1.0)"
```

- [ ] **Step 6 (sessione principale, dopo l'unione dell'ondata 2): il «prima» e la prova di ritorno subito** — sul codice dell'unione (il modello è ancora quello di oggi), per ognuna delle due copie (`<A>` = cliente A, `<H>` = hub; `<core 1>` = 114 sul cliente A):

```bash
cd "$SCRATCH/ipam-t1"
for s in S0 S1 S4; do npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --scenario $s --salva "$SCRATCH/prima-A-$s.json" --json > "$SCRATCH/prima-A-$s.out" 2>&1; echo "A $s exit=$?"; done
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --scenario S3:114 --salva "$SCRATCH/prima-A-S3.json" --json > "$SCRATCH/prima-A-S3.out" 2>&1; echo "A S3 exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<H>.db" --cartella "$SCRATCH" --salva "$SCRATCH/prima-H-S0.json" --json > "$SCRATCH/prima-H-S0.out" 2>&1; echo "H S0 exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --nomi > "$SCRATCH/prima-A-nomi.txt" 2>&1; echo "nomi exit=$?"
```

Expected: tutti `exit=0` (anche l'hub, con le sue 4 pagine «never used»). Si annotano nel resoconto di lavoro (scratchpad, non repo): cliente A `cucite` 1 (2 in S1), `contro_verso` 1, `radici` (2 sulle copie del 14/10, 1 su quelle del 15/10: la base cambia da sola, vale quella delle copie di P3), `modello_ms` (circa 13-15), `giri_oggi`/`attraversamenti_oggi` (C10, C11 «prima»), e in `mappe` la mappa passo passo della sede 1 in `tb` (orizzontale) con 7 ritocchi (R2: oggi 4 validi); hub `cucite` 1 (rimisurato il 15/10 con `lineeCucite` corretta coi MAC della scansione: stessi numeri sulle due copie, 1, 2 in S1 e 1), `contro_verso` 0, `linee_da_nome_scelto` 1 (H7: la linea fra il router e il router di frontiera da una VLAN), `sotto_una_sua_vm` 1 (H15: l'hypervisor appeso al firewall virtuale); su tutte e due `teste.proposta` il router (H17, C19) e `letture_vm` (R1: sull'hub, fino al primo giro del job, due scansioni a mano del 27/04). Misurato il 15/10 notte sul prototipo del piano, copie delle 01:48-01:52.

Poi C18 anche sulla rete B (spec §13.5.2, «Lo stesso conto si fa sulla copia dell'hub»), con l'uscita vera del suo router di testa (P2), che il lettore del Task 2 legge com'è:

```bash
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<H>.db" --cartella "$SCRATCH" --uscita-router "1=$USCITA_HUB" --confronta "$SCRATCH/prima-H-S0.json" --json > "$SCRATCH/prima-H-c18.out" 2>&1; echo "C18 H exit=$?"
```

Expected: `host_cambiati_di_categoria` 0 (misurato il 15/10 notte sulla copia delle 01:52; l'attribuzione degli host non dipende dal modello della mappa); le righe del router nell'ingresso hanno 8 `lldp`, porte remote con lo spazio intere, nessuna troncata (la forma di H16). `padri_cambiati` e `conteggi_cambiati` si annotano: col codice di prima e le righe nuove dicono che cosa vedrebbe l'hub tornando indietro (col codice di T1 del prototipo: nessun padre cambiato, due linee da `mndp` a `lldp`). **Il commit dell'unione dell'ondata 2 è il «codice di prima» della prova di ritorno (R6)**: se ne scrive l'hash nel resoconto.

Poi, sullo stesso codice (che è il codice di prima), la **prova di ritorno R6** subito, per sapere prima del rilascio se lo script del Task 10b servirà. Le righe nuove del router 1 vengono dal *detail* incollato da Riccardo (fuori dal repo, la sessione principale sa dove), lette dal lettore del Task 2:

```bash
U="$USCITA_ROUTER1"   # il «detail» del router 1 incollato da Riccardo: dossier del cliente, sola lettura
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --uscita-router "1=$U" --esporta-input "$SCRATCH/r6-input.json" --json > "$SCRATCH/r6-0.out" 2>&1; echo "C18 exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --input-json "$SCRATCH/r6-input.json" --confronta "$SCRATCH/prima-A-S0.json" --json > "$SCRATCH/r6-1.out" 2>&1; echo "R6 exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --input-json "$SCRATCH/r6-input.json" --scenario S4 --confronta "$SCRATCH/prima-A-S0.json" --json > "$SCRATCH/r6-2.out" 2>&1; echo "R6 peggiore exit=$?"
```

Expected (misurato il 15/10 sulla copia del 14/10 del cliente A, revisione del piano): `host_cambiati_di_categoria` 0 (C18); col codice di prima e le righe nuove `padri_cambiati` 0, con `conteggi_cambiati` spiegati dalle righe nuove (una fonte `lldp` al posto di `mndp`, un vicino non abbinato in più); nel caso peggiore `padri_cambiati` 1: **R6 non regge nel caso peggiore, e lo script del Task 10b serve**. Le cifre si annotano nel resoconto, e i nomi (`--nomi`) solo in chat.

---

### Task 5: ingresso del modello, filtro sulle fonti, anonimizzatore (T1.3 dati, T1.1 fixture del modello)

Spec §13.6.1 («L'ingresso del modello di T1 riceve ciò che serve ai traduttori»), §13.5.7 («Chi legge che cosa»: `WHERE source IN ('device', 'unifi')` nel modello **e** nell'attribuzione, già in T1), §13.12.2 (`PORTA_GENERICA` allargata). Il modello non cambia ancora (i campi nuovi li legge il Task 7). I campi nuovi sono **facoltativi** nel tipo, come `proxmox_scan`: le fixture e le prove di prima non li hanno. Le fixture si riestraggono nel Task 7, col codice nuovo, perché lo script d'estrazione controlla che il modello dia gli stessi conteggi sul dato vero e sulla fixture.

`stp_state` delle porte e `topology_role` degli apparati entrano già qui (li legge T1b, Task 13): così le fixture si riestraggono una volta sola. Sono dati che l'app legge già oggi (non letture in più): R7 resta vero.

**Nomi scelti nelle fixture del modello (spec §13.12.2, passaggio universale).** La spec chiede che un nome scelto dal cliente resti anonimo «con la sua forma», perché le prove dei traduttori girino su un nome scelto e non di fabbrica. L'anonimizzatore lo fa già a modo suo: un nome scelto diventa `porta-N` (o `vlan-porta-N` se comincia con un prefisso logico di fabbrica), che non è mai un nome di fabbrica e che il traduttore legge come il nome vero (`fisica: null`, nel bridge se stava nel bridge, l'ultimo pezzo dopo «/»). Il disegno «BR_…», «VL_…» sta nelle fixture del lettore (Task 2) e nelle reti-campione (Task 10c). Una prova lo fissa (Step 1, «G17: lo pseudonimo di un nome scelto…»): passa già col codice dell'anonimizzatore, ed è una guardia — cadrebbe se uno pseudonimo somigliasse a un nome di fabbrica. Lo stesso per i nomi VRRP scelti dal cliente: diventano `vrrp-porta-N`, logici come il vero. **Revisione finale del 15/10 (verifica UV1):** il piano aggiungeva a `PORTA_GENERICA` un'alternativa per «vrrpN» che accettava anche il disegno dei nomi VRRP del cliente A, e con lei la fixture riestratta nel Task 7 avrebbe pubblicato in chiaro le cinque VRRP del cliente (misurato sulla copia: cinque nomi, 26 righe; la fixture di oggi non ne ha). L'alternativa non c'è più, la coda dopo un nome di fabbrica è quella del traduttore (una velocità, Task 3), e c'è un **secondo controllo che fallisce chiuso** (`porteInChiaro`): ogni pezzo di un nome di porta rimasto uguale al vero deve essere in un elenco chiuso di nomi di fabbrica, che non segue `PORTA_GENERICA`; altrimenti lo script d'estrazione non scrive la fixture (Task 7). Provato sulla copia: con l'alternativa di prima l'estrazione si ferma con «5», senza esce con `exit=0`.

**Files:**
- Modify: `src/lib/topology/model-types.ts` (`ModelDeviceRow`, `ModelNeighborRow`, `LinkOverrideRow`, `ModelPortRow` nuovo, `TopologyModelInput`)
- Modify: `src/lib/db-tenant.ts` (`NEIGHBORS_MODEL_SOURCES_SQL` nuova accanto a `NEIGHBORS_LATEST_ROUND_SQL` a `:5012`; `getAttributionSignalsForHost` a `:2746`, con la query a `:2764`; `getTopologyModelInput` a `:9117-9165`)
- Modify: `src/lib/db.ts` (import a `:60`; `getAttributionSignalsForHost` a `:3152`)
- Modify: `src/lib/attribution/recompute.ts` (copia della costante accanto a `:54`; `getAttributionSignalsFromHandle` a `:85-93`)
- Modify: `src/lib/topology/anonimizza.ts`
- Test: `src/lib/__tests__/neighbors-old-readers.test.ts`, `src/lib/topology/__tests__/anonimizza.test.ts`, `src/lib/topology/__tests__/fixture-anonime.test.ts`

**Interfaces:**
- Produces (in `model-types.ts`):

```ts
export interface ModelPortRow {
  device_id: number;
  port_index: number;
  port_name: string;
  speed: string | null;
  status: string | null;
  /** Stato dello spanning tree come lo scrive la lettura di oggi: lo legge la prova di ruolo di T1b. */
  stp_state: string | null;
}
// ModelDeviceRow += via?: string | null; topology_role?: string | null
// ModelNeighborRow += remote_platform?: string | null
// LinkOverrideRow += created_by?: string | null; created_at?: string | null
// TopologyModelInput += ports?: ModelPortRow[]
```

- Produces (in `db-tenant.ts`, ricopiata alla lettera in `recompute.ts`): `export const NEIGHBORS_MODEL_SOURCES_SQL = "dn.source IN ('device', 'unifi')";`
- Produces (in `anonimizza.ts`): `PORTA_GENERICA` allargata; `portaAnonima(v: string): boolean`; `porteInChiaro(vero: TopologyModelInput, anonimo: TopologyModelInput): number` (il secondo controllo, con l'elenco chiuso `NOMI_DI_FABBRICA`, non esportato; lo usa lo script d'estrazione del Task 7); `VOCABOLARIO.via`, `VOCABOLARIO.piattaforma`.

- [ ] **Step 1: le prove che falliscono** — in fondo a `src/lib/__tests__/neighbors-old-readers.test.ts` (aggiungere `NEIGHBORS_MODEL_SOURCES_SQL` all'import da `@/lib/db-tenant` e `NEIGHBORS_MODEL_SOURCES_SQL as RECOMPUTE_SOURCES_SQL` a quello da `@/lib/attribution/recompute`):

```ts
// Spec topologia §13.5.7, «Chi legge che cosa» (R7): il modello di T1 e l'attribuzione degli host leggono solo le fonti
// di oggi. Da T2 le letture in più scrivono fonti nuove (snmp, host, ssh): accenderle non deve cambiare né la mappa né
// le classificazioni, che sono dati di produzione. Oggi le fonti sono solo device e unifi: il filtro non cambia niente.
test("fonti nuove: non entrano nel modello di T1 né nell'attribuzione (db-tenant e facciata)", () => {
  withTenant(T, () => upsertNeighbors(1, [v("PC-50", "Port 8", HOST_MAC)]));
  db().prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_mac, source, first_seen, timestamp)
    VALUES (1, 'Port 9', 'SNMP-X', 'Port 1', 'lldp', ?, 'snmp', datetime('now'), datetime('now'))`).run(HOST_MAC);
  assert.deepEqual(nomi(withTenant(T, () => getTopologyModelInput(7)).neighbors), ["PC-50"]);
  assert.equal(withTenant(T, () => getAttributionSignalsForHost(1))?.neighborSightings.length, 1);
  assert.equal(withTenant(T, () => facadeAttributionSignals(1))?.neighborSightings.length, 1);
});

test("la copia del filtro sulle fonti in recompute.ts è identica all'originale di db-tenant.ts", () => {
  assert.equal(RECOMPUTE_SOURCES_SQL, NEIGHBORS_MODEL_SOURCES_SQL);
});

test("ingresso del modello (spec §13.6.1): tutte le porte con l'indice, anche giù; la via di lettura; la piattaforma remota", () => {
  db().exec("DELETE FROM switch_ports");
  db().prepare(`INSERT INTO switch_ports (device_id, port_index, port_name, status, speed, stp_state)
    VALUES (1, 49, 'SFP+ 1', 'up', '10000 Mbps', 'forwarding'), (1, 5, 'Port 5', 'down', NULL, NULL)`).run();
  withTenant(T, () => upsertNeighbors(1, [{ ...v("RTR-1", "Port 1"), remotePlatform: "MikroTik" }]));
  const i = withTenant(T, () => getTopologyModelInput(2));
  assert.deepEqual(i.ports, [
    { device_id: 1, port_index: 5, port_name: "Port 5", speed: null, status: "down", stp_state: null },
    { device_id: 1, port_index: 49, port_name: "SFP+ 1", speed: "10000 Mbps", status: "up", stp_state: "forwarding" },
  ]);
  assert.deepEqual(i.devices.map((d) => [d.id, d.via, d.topology_role]), [[1, "api", null], [2, "snmp_v2", null]]);
  assert.equal(i.neighbors[0].remote_platform, "MikroTik");
});
```

In fondo a `src/lib/topology/__tests__/anonimizza.test.ts` (aggiungere `portaAnonima` e `porteInChiaro` all'import da `@/lib/topology/anonimizza`, e in testa `import { traduciMikrotikLocale, traduciMikrotikRemoto } from "@/lib/topology/lettori/mikrotik";`):

```ts
// Spec topologia §13.12.2: nella fixture del cliente A 329 nomi di porta su 676 erano «porta-N», proprio quelli su cui
// si basa T1. I nomi di serie che mancavano restano; un nome composto si anonimizza pezzo per pezzo (la parte di serie
// resta e il traduttore la legge come sul dato vero); un nome scelto dal cliente resta anonimo.
test("T1: nomi di serie in più; nomi composti pezzo per pezzo; l'interfaccia logica tiene il prefisso", () => {
  const conPorte: TopologyModelInput = {
    ...VERO,
    neighbors: [
      { ...VERO.neighbors[0], device_id: 1, local_port: "sfp28-1,bond1,LAN_BERGAMO", remote_port: "LAN_BERGAMO/sfp-sfpplus2", remote_platform: "MikroTik" },
      { ...VERO.neighbors[0], local_port: "SFP_ 17 - nodo-bergamo", remote_port: "ether1-2.5", remote_platform: "US48P500" },
      { ...VERO.neighbors[0], local_port: "vlan10-Magazzino", remote_port: "vrrp_rete_12" },
      { ...VERO.neighbors[0], local_port: "ether3,bridge", remote_port: "bridge/bond1/wlan60-1" },
    ],
    ports: [{ device_id: 2, port_index: 17, port_name: "SFP+ 17 - nodo-bergamo", speed: "10000 Mbps", status: "up", stp_state: "forwarding" }],
  };
  const out = anonimizzaInput(conPorte);
  const testo = JSON.stringify(out).toLowerCase();
  assert.equal(testo.includes("bergamo"), false);
  assert.equal(testo.includes("magazzino"), false);
  const [a, b, c, d] = out.neighbors;
  assert.match(a.local_port, /^sfp28-1,bond1,porta-\d+$/);
  assert.match(a.remote_port, /^porta-\d+\/sfp-sfpplus2$/);
  assert.equal(a.local_port.split(",")[2], a.remote_port.split("/")[0], "lo stesso bridge ha lo stesso pseudonimo");
  assert.match(b.local_port, /^SFP_ 17 - porta-\d+$/);
  assert.equal(out.ports?.[0].port_name, `SFP+ 17 - ${b.local_port.split(" - ")[1]}`, "la descrizione ha lo stesso pseudonimo nell'elenco e nell'LLDP");
  assert.equal(b.remote_port, "ether1-2.5");
  assert.match(c.local_port, /^vlan-porta-\d+$/);
  assert.match(c.remote_port, /^vrrp-porta-\d+$/, "un nome VRRP scelto dal cliente diventa uno pseudonimo, logico come il vero");
  assert.deepEqual([d.local_port, d.remote_port], ["ether3,bridge", "bridge/bond1/wlan60-1"]);
  assert.deepEqual([a.remote_platform, b.remote_platform, c.remote_platform], ["MikroTik", "altro", undefined]);
  for (const n of out.neighbors) for (const p of [n.local_port, n.remote_port]) assert.equal(portaAnonima(p), true, p);
});

test("T1: chi ha fatto una correzione non entra nella fixture; quando sì", () => {
  const out = anonimizzaInput({ ...VERO, overrides: [{ id: 1, action: "ignore", a_node: "dev:1", a_port: "ether8", b_node: "dev:2", b_port: "Port 15", medium: null, created_by: "mario.rossi", created_at: "2026-10-14 10:07:00" }] });
  assert.deepEqual([out.overrides[0].created_by, out.overrides[0].created_at], [null, "2026-10-14 10:07:00"]);
});

// Spec §13.12.2 e G17 (vincolo 9): un nome scelto dal cliente diventa uno pseudonimo, mai un nome di fabbrica; il traduttore
// legge lo pseudonimo come il nome vero (stessi fatti), così le prove sulle fixture girano su nomi scelti e non di fabbrica.
// Il bridge e le VLAN coi nomi scelti della rete B (qui inventati, col loro disegno) restano «non noti» e «nel bridge».
test("T1, G17: lo pseudonimo di un nome scelto dà al traduttore gli stessi fatti del nome vero", () => {
  const scelti = ["sfp28-1,bond1,BR_QX", "VL_44_ZETA", "sfp-sfpplus1,BR_QX", "BR_QX/sfp-sfpplus12"];
  const out = anonimizzaInput({ ...VERO, neighbors: scelti.map((p) => ({ ...VERO.neighbors[0], device_id: 1, local_port: p, remote_port: p, remote_platform: "MikroTik" })) });
  const fatti = (p: string) => { const l = traduciMikrotikLocale(p); return [l.fisica, l.senzaFili, l.nelBridge, l.fascio]; };
  scelti.forEach((p, k) => {
    assert.deepEqual(fatti(out.neighbors[k].local_port), fatti(p), p);
    const [r, v] = [traduciMikrotikRemoto(out.neighbors[k].remote_port), traduciMikrotikRemoto(p)];
    assert.deepEqual([r.fisica, r.senzaFili, r.nelBridge, r.fascio], [v.fisica, v.senzaFili, v.nelBridge, v.fascio], p);
  });
  assert.equal(JSON.stringify(out).includes("QX"), false);
  assert.equal(JSON.stringify(out).includes("ZETA"), false);
});

// Spec §13.12.2. Verifica del 15/10: un'alternativa allargata di PORTA_GENERICA («vrrp_rete_N», il disegno dei nomi che un cliente
// dà alle sue VRRP) avrebbe pubblicato i nomi veri come «di serie»; il controllo dei nomi degli oggetti non guarda le porte.
// Il secondo controllo usa un elenco chiuso di nomi di fabbrica e si ferma su ogni altro pezzo rimasto uguale al vero.
test("porteInChiaro: un nome scelto rimasto uguale al vero ferma l'estrazione; i nomi di fabbrica no", () => {
  const conPorte: TopologyModelInput = {
    ...VERO,
    neighbors: [
      { ...VERO.neighbors[0], local_port: "sfp28-1,bond1,LAN_BERGAMO", remote_port: "Port 47" },
      { ...VERO.neighbors[0], local_port: "ether1-2.5", remote_port: "vrrp_rete_12" },
      { ...VERO.neighbors[0], local_port: "SFP_ 17 - nodo-bergamo", remote_port: "bridge/bond1/wlan60-1" },
    ],
  };
  const out = anonimizzaInput(conPorte);
  assert.equal(porteInChiaro(conPorte, out), 0);
  const fuga = { ...out, neighbors: out.neighbors.map((n, k) => (k === 1 ? { ...n, remote_port: "vrrp_rete_12" } : n)) };
  assert.equal(porteInChiaro(conPorte, fuga), 1, "lo pseudonimo tolto: il nome vero torna, e il controllo lo vede");
  const bridge = { ...out, neighbors: out.neighbors.map((n, k) => (k === 0 ? { ...n, local_port: "sfp28-1,bond1,LAN_BERGAMO" } : n)) };
  assert.equal(porteInChiaro(conPorte, bridge), 1, "anche un pezzo di un nome composto");
});
```

In `src/lib/topology/__tests__/fixture-anonime.test.ts`, una prova nuova in fondo (la forma delle fixture riestratte dal Task 7; le due fixture di oggi restano valide):

```ts
test("forma di T1 (spec §13.6.1): porte con l'indice, via di lettura, piattaforma remota, ruolo a mano, autore delle correzioni", () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, FILES[0]), "utf8")) as Record<string, Array<Record<string, unknown>>>;
  const nuova = {
    ...j,
    devices: j.devices.map((d, i) => ({ ...d, via: i === 0 ? "ssh" : "api", topology_role: null, proxmox_scan: 0 })),
    neighbors: j.neighbors.map((n, i) => ({ ...n, remote_platform: i === 0 ? "MikroTik" : null, local_port: i === 0 ? "sfp28-1,bond1,porta-3" : n.local_port, remote_port: i === 0 ? "porta-3/sfp-sfpplus2" : n.remote_port })),
    overrides: [{ id: 1, action: "ignore", a_node: "dev:114", a_port: "porta-9", b_node: "dev:1", b_port: "ether8", medium: null, created_by: null, created_at: "2026-10-14 10:07:00" }],
    ports: [{ device_id: 1, port_index: 9, port_name: "SFP+ 17 - porta-4", speed: "10000 Mbps", status: "up", stp_state: "forwarding" }],
  };
  assert.deepEqual(scartiDiForma(nuova), []);
  assert.deepEqual(scartiDiForma({ ...nuova, neighbors: [{ ...nuova.neighbors[0], remote_platform: "Router di Mario" }] }), ["neighbors[0].remote_platform: valore fuori forma"]);
  assert.deepEqual(scartiDiForma({ ...nuova, overrides: [{ ...nuova.overrides[0], created_by: "mario.rossi" }] }), ["overrides[0].created_by: valore fuori forma"]);
  assert.deepEqual(scartiDiForma({ ...nuova, ports: [{ ...nuova.ports[0], port_name: "SFP+ 17 - nodo Mario" }] }), ["ports[0].port_name: valore fuori forma"]);
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/__tests__/neighbors-old-readers.test.ts src/lib/topology/__tests__/anonimizza.test.ts src/lib/topology/__tests__/fixture-anonime.test.ts > "$SCRATCH/t1-5.log" 2>&1; echo "exit=$?"`
Expected: `exit=1` (export mancante `NEIGHBORS_MODEL_SOURCES_SQL`, `portaAnonima`; `ports` assente; forma rifiutata).

- [ ] **Step 3: il codice**

`model-types.ts`: aggiungere `ModelPortRow` (sopra, «Interfaces») dopo `ModelPortInfoRow` (`:127-133`), e i campi facoltativi:

```ts
// in ModelDeviceRow, dopo proxmox_scan:
  /** network_devices.protocol, la via di lettura (ssh, snmp_v2, api…): la usano i traduttori (spec §13.6.1). Assente nelle fixture di prima. */
  via?: string | null;
  /** network_devices.topology_role, «Ruolo nella mappa» a mano (T1b): '' o null = decide il sistema. Assente nelle fixture di prima. */
  topology_role?: string | null;
// in ModelNeighborRow, dopo remote_mac:
  /** La piattaforma annunciata dal vicino: il traduttore del lato remoto (spec §13.6.1). Assente nelle fixture di prima. */
  remote_platform?: string | null;
// in LinkOverrideRow, dopo medium:
  /** Chi e quando, per le frasi di T1b («Collegato a mano da ‹utente› il ‹data›»). Assenti nelle fixture di prima. */
  created_by?: string | null;
  created_at?: string | null;
// in TopologyModelInput, dopo portInfo:
  /** Tutte le porte di ogni apparato, con l'indice (spec §13.6.1): la chiave della porta e la velocità per chiave. */
  ports?: ModelPortRow[];
```

`db-tenant.ts`, subito dopo `NEIGHBORS_LATEST_ROUND_SQL` (`:5012-5013`):

```ts
/**
 * Le fonti dei vicini che leggono il modello della mappa di oggi e l'attribuzione degli host (spec topologia §13.5.7,
 * «Chi legge che cosa»; R7). Oggi le fonti sono solo queste due e il filtro non cambia niente; da T2 le letture in più
 * scrivono fonti nuove (snmp, host, ssh), che legge solo il modello per cavo: accenderle non cambia la mappa né le
 * classificazioni degli host, che sono dati di produzione. Una copia identica sta in attribution/recompute.ts
 * (ciclo db-tenant ↔ attribution), presidiata da neighbors-old-readers.test.ts.
 */
export const NEIGHBORS_MODEL_SOURCES_SQL = "dn.source IN ('device', 'unifi')";
```

`getAttributionSignalsForHost` (`db-tenant.ts:2746`, la query a `:2764-2772`) e la sua facciata (`db.ts:3152-3160`): nella query `neighborSightings`, dopo `AND ${NEIGHBORS_LATEST_ROUND_SQL}`, la riga `AND ${NEIGHBORS_MODEL_SOURCES_SQL}`. In `db.ts:60` l'import diventa `import { cleanOrphanedForeignKeys as cleanOrphanedForeignKeysSu, NEIGHBORS_LATEST_ROUND_SQL, NEIGHBORS_MODEL_SOURCES_SQL } from "./db-tenant";`.

`attribution/recompute.ts`, dopo la costante di `:54-55`:

```ts
/**
 * Copia IDENTICA di db-tenant.ts::NEIGHBORS_MODEL_SOURCES_SQL (spec topologia §13.5.7): l'attribuzione legge solo le
 * fonti di oggi, così una lettura in più accesa non cambia la classificazione degli host. Copia e non import per lo
 * stesso motivo della costante qui sopra; presidiata da src/lib/__tests__/neighbors-old-readers.test.ts.
 */
export const NEIGHBORS_MODEL_SOURCES_SQL = "dn.source IN ('device', 'unifi')";
```

e nella query di `getAttributionSignalsFromHandle` (`:85-93`), dopo `AND ${NEIGHBORS_LATEST_ROUND_SQL}`, `AND ${NEIGHBORS_MODEL_SOURCES_SQL}`.

`getTopologyModelInput` (`db-tenant.ts:9117-9165`): la query `devices` aggiunge `nd.protocol AS via, nd.topology_role` dopo `nd.topology_hidden`; la query `neighbors` diventa

```ts
    neighbors: d.prepare(`
      SELECT dn.device_id, dn.local_port, dn.remote_device_name, dn.remote_port, dn.protocol, dn.remote_ip, dn.remote_mac,
             dn.remote_platform, dn.timestamp, dn.source
        FROM device_neighbors dn
       WHERE ${NEIGHBORS_MODEL_SOURCES_SQL}`).all() as ModelInput["neighbors"],
```

la query `overrides` diventa `SELECT id, action, a_node, a_port, b_node, b_port, medium, created_by, created_at FROM topology_link_overrides ORDER BY id`; dopo `portInfo` una sezione nuova:

```ts
    // Spec §13.6.1: l'elenco intero delle porte, con l'indice e lo stato (anche quelle giù), per la chiave della porta.
    ports: d.prepare(`
      SELECT device_id, port_index, port_name, speed, status, stp_state FROM switch_ports ORDER BY device_id, port_index`).all() as ModelInput["ports"],
```

`anonimizza.ts`:
1. `PORTA_GENERICA` (`:30-41`): all'elenco delle alternative si aggiungono, dopo `"\\d+([/:.]\\d+)*",`:

```ts
      // T1 (spec §13.12.2): i nomi di serie che mancavano. Non dicono chi è il cliente.
      "sfp(\\+|_|28)?\\s?\\d+",                                                                   // «SFP+ 9», «SFP_ 9», «SFP 1», «SFP28 29»
      // Una porta di fabbrica con la velocità in coda come la legge il traduttore (MIKROTIK_FISICA: «-10g», «-2.5»), la corsia
      // di una QSFP, la radio coi suoi numeri («wlan60-1»), nel bridge o in un fascio: un intero o un numero col punto dopo il
      // trattino è un nome scelto e diventa uno pseudonimo (verifica del 15/10).
      "(bridge\\d*/)?(bond\\d+/)?((ether|sfp-sfpplus|sfp28-|sfp|combo|bond)\\d+(-(\\d+(\\.\\d+)?g|2\\.5))?|qsfp\\d*-?\\d+(-[1-8])?|(wlan|wifi)\\d+(-\\d+)?)(,(bridge\\d*|bond\\d+))*",
      "(wifi|ath|wlan)\\d+[a-z]+\\d*",                                                            // «wifi2ap9»
```

Nessuna alternativa per i nomi VRRP: «vrrpN» di fabbrica e i nomi scelti dal cliente diventano `vrrp-porta-N` (`PREFISSO_LOGICO`, punto 4), che il traduttore legge logici come i veri (G17 regge).

2. `VOCABOLARIO` riceve `via: ["ssh", "snmp_v2", "snmp_v3", "api", "winrm"]`, `piattaforma: ["MikroTik", "altro"]` e gli stati delle porte, che sono parole dell'app e non dati del cliente:

```ts
  // T1 (spec §13.6.1): gli stati delle porte e dello spanning tree come li scrive la lettura. Stanno qui perché
  // PAROLE_DELL_APP li prende dal vocabolario: sull'hub «down» (137 porte) è anche una parola di un nome vero, e senza
  // questa riga l'estrazione della fixture si fermava con «nomi 137» (verifica del piano, 15/10).
  stato_porta: ["up", "down", "disabled"],
  stp: ["forwarding", "blocking", "discarding", "disabled", "learning", "listening", "broken"],
```
3. `portsOf` (`:77-83`) aggiunge `...(input.ports ?? []).map((p) => p.port_name)`.
4. La funzione `porta` (`:262-277`, con `portMap` e `portSeq` sopra) diventa questa coppia (stesso `portMap`, stesso `portSeq`):

```ts
  /** Interfacce logiche: un nome scelto dal cliente che comincia così tiene il prefisso («vlan-porta-N»), il traduttore lo legge ancora logico. */
  const PREFISSO_LOGICO = /^(bridge|vlan|vrrp|eoip|gre|ipip|vxlan|wireguard|wg|ovpn|pppoe|pptp|l2tp|sstp|lte|loopback|veth)/i;
  const pezzo = (v: string): string => {
    const t = v.trim();
    if (t === "" || PORTA_GENERICA.test(t)) return v;
    if (IPV4.test(t)) return ip(t) as string;
    if (MAC_ANY.test(t)) return mac(t) as string;
    let out = portMap.get(t);
    if (!out) {
      const pre = PREFISSO_LOGICO.exec(t)?.[1]?.toLowerCase();
      do out = `${pre ? `${pre}-` : ""}porta-${++portSeq}`;
      while (realPorts.has(out));
      portMap.set(t, out);
    }
    return out;
  };
  /**
   * Un nome di porta: di serie resta; composto («‹porta›,‹fascio›,‹bridge›», «‹bridge›/‹porta›», «‹porta di serie› -
   * ‹descrizione›») si anonimizza pezzo per pezzo: la parte di serie resta e il traduttore la legge come sul dato vero;
   * lo stesso pezzo ha sempre lo stesso pseudonimo (il bridge, la descrizione di una porta nell'elenco e nell'LLDP).
   */
  const porta = (v: string): string => {
    if (!v || v.trim() === "") return v;
    const t = v.trim();
    // Prima IP e MAC: «192.0.2.1» e «00:11:22:33:44:55» passerebbero per numeri di porta di serie.
    if (IPV4.test(t)) return ip(t) as string;
    if (MAC_ANY.test(t)) return mac(t) as string;
    if (PORTA_GENERICA.test(t)) return v;
    const conDescrizione = /^(.+?) - (.+)$/.exec(t);
    if (conDescrizione && PORTA_GENERICA.test(conDescrizione[1])) return `${conDescrizione[1]} - ${pezzo(conDescrizione[2])}`;
    if (t.includes(",")) return t.split(",").map(pezzo).join(",");
    if (t.includes("/") && !/\d\/\d/.test(t)) return t.split("/").map(pezzo).join("/");
    return pezzo(t);
  };
  const piattaforma = (v: string | null | undefined): string | null => (!v || v.trim() === "" ? null : /mikrotik/i.test(v) ? "MikroTik" : "altro");
```

5. Nel ritorno di `anonimizzaInput` (`:301-313`): `neighbors` aggiunge `...(n.remote_platform !== undefined ? { remote_platform: piattaforma(n.remote_platform) } : {})`; `overrides` aggiunge `...(o.created_by !== undefined ? { created_by: null } : {})` (chi ha fatto una correzione è una persona: non entra); in fondo `...(input.ports ? { ports: input.ports.map((p) => ({ ...p, port_name: porta(p.port_name) })) } : {})`.
6. `PAROLE_DELL_APP` (`:317-323`) aggiunge `"vrrp", "eoip", "vxlan", "wireguard", "ovpn", "pppoe", "pptp", "l2tp", "sstp", "loopback", "veth", "sfp28"`.
7. Dopo `PORTA_GENERICA`, l'elenco chiuso del secondo controllo e la funzione che lo usa (verifica UV1 del 15/10):

```ts
/**
 * I nomi di porta di fabbrica, per prodotto: l'elenco chiuso del secondo controllo delle fixture (`porteInChiaro`). Non
 * segue PORTA_GENERICA e non ha forme viste solo su un cliente: allargarlo vuol dire scrivere qui il prodotto che dà quel
 * nome da sé. La sola forma scelta da un cliente che resta è la porta di fabbrica con la velocità in coda («ether1-2.5»): il
 * traduttore la legge fisica (MIKROTIK_FISICA) e non dice chi è il cliente, perché è un numero di una norma Ethernet.
 */
const NOMI_DI_FABBRICA = new RegExp(
  "^(" +
    [
      "(port|porta)\\s*\\d+", "sfp(\\+|_|28)?\\s?\\d+",
      "(ether|sfp-sfpplus|sfp28-|sfp|combo|bond)\\d+(-(\\d+(\\.\\d+)?g|2\\.5))?", "qsfp\\w*?-?\\d+(-[1-8])?",
      "(wlan|wifi)\\d+(-\\d+)?", "(wifi|ath|wlan|ra)\\d+[a-z]+\\d*", "bridge\\d*", "vrrp\\d+", "vlan[\\s-]?\\d+",
      "(eth|sfpplus|qsfpplus|vmbr|lan|wan|mgmt|ge|xe|et|gi|te|fa|tw|hu|fo|po|gigabitethernet|tengigabitethernet|twentyfivegige|" +
        "fortygigabitethernet|hundredgige|fastethernet|ethernet|port-channel|interface|ath|\\d+gigabitethernet)[\\s-]?\\d+([/:.]\\d+)*",
      "en[ospx]\\d+(s\\d+)?(f\\d+)?(np\\d+)?", "\\d+([/:.]\\d+)*",
    ].join("|") +
    ")$",
  "i",
);

/**
 * Il secondo controllo dei nomi di porta (spec §13.12.2). Verifica del 15/10: un'alternativa di PORTA_GENERICA allargata ai
 * nomi VRRP che il cliente A dà alle sue interfacce li avrebbe pubblicati nella fixture come «di serie», e nessun controllo se
 * ne accorgeva (`contaValoriVeri` guarda IP, MAC e nomi degli oggetti). Conta i pezzi dei nomi di porta della fixture uguali a
 * un pezzo di un nome di porta vero che non sono nomi di fabbrica: lo script d'estrazione non scrive la fixture se non è 0.
 */
export function porteInChiaro(vero: TopologyModelInput, anonimo: TopologyModelInput): number {
  const pezzi = (v: string): string[] => v.split(/[,/]| - /).map((p) => p.trim()).filter((p) => p !== "");
  const veri = new Set(portsOf(vero).flatMap(pezzi));
  return new Set(portsOf(anonimo).flatMap(pezzi).filter((p) => veri.has(p) && !NOMI_DI_FABBRICA.test(p))).size;
}
```

8. Dopo l'elenco chiuso, esportata per la prova della forma:

```ts
const PEZZO_ANONIMO = /^((bridge|vlan|vrrp|eoip|gre|ipip|vxlan|wireguard|wg|ovpn|pppoe|pptp|l2tp|sstp|lte|loopback|veth)-)?porta-\d+$/;

/** Una porta come la scrive l'anonimizzatore: di serie, uno pseudonimo, o composta di questi pezzi (prova della forma delle fixture). */
export function portaAnonima(v: string): boolean {
  const t = v.trim();
  const ok = (p: string): boolean => PORTA_GENERICA.test(p.trim()) || PEZZO_ANONIMO.test(p.trim());
  if (t === "" || ok(t)) return true;
  const conDescrizione = /^(.+?) - (.+)$/.exec(t);
  if (conDescrizione) return PORTA_GENERICA.test(conDescrizione[1]) && ok(conDescrizione[2]);
  if (t.includes(",")) return t.split(",").every(ok);
  if (t.includes("/")) return t.split("/").every(ok);
  return false;
}
```

`fixture-anonime.test.ts`: `const porta: Regola = o((v) => typeof v === "string" && portaAnonima(v), s(IP_FINTO), s(MAC_FINTO));` (import di `portaAnonima`); `FASE_2B_CAMPI` riceve:

```ts
  devices: { uplink_type: o(nul, tra(["wire", "wireless"])), via: o(nul, tra(VOCABOLARIO.via)), topology_role: o(nul, tra(["", "rete", "attaccato"])), proxmox_scan: num },
  neighbors: { remote_platform: o(nul, tra(VOCABOLARIO.piattaforma)) },
  overrides: { medium: o(nul, tra(["cavo", "fibra", "wireless"])), created_by: nul, created_at: o(nul, s(DATA)) },
```

e `FASE_2B_SEZIONI` riceve:

```ts
  ports: {
    device_id: num, port_index: num, port_name: porta, speed: o(nul, s(/^\d+(\.\d+)?\s?(Mbps|Gbps|M|G)?$/)),
    status: o(nul, tra(VOCABOLARIO.stato_porta)), stp_state: o(nul, tra(VOCABOLARIO.stp)),
  },
```

(il commento sopra le due costanti dice «Fase 2b e T1: campi e sezioni che le fixture estratte prima non hanno»). L'import da `@/lib/topology/anonimizza` diventa `import { portaAnonima, VOCABOLARIO } from "@/lib/topology/anonimizza";`: con la regola `porta` nuova `PORTA_GENERICA` non serve più in questo file, e resterebbe un avviso di lint nuovo.

- [ ] **Step 4: verdi** — tutte le prove della topologia, dei vicini e dell'attribuzione:

Run: `node --import tsx --test src/lib/__tests__/neighbors-old-readers.test.ts src/lib/__tests__/neighbors-age.test.ts "src/lib/attribution/__tests__/*.test.ts" "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1-5.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`; `model-fixtures.test.ts` senza un numero cambiato (il modello non legge ancora i campi nuovi). Poi `npx tsc --noEmit` e `npx eslint src/lib/topology src/lib/db-tenant.ts src/lib/db.ts src/lib/attribution` con `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/model-types.ts src/lib/db-tenant.ts src/lib/db.ts src/lib/attribution/recompute.ts src/lib/topology/anonimizza.ts src/lib/__tests__/neighbors-old-readers.test.ts src/lib/topology/__tests__/anonimizza.test.ts src/lib/topology/__tests__/fixture-anonime.test.ts
git commit -m "feat(topologia): ingresso del modello con l'elenco delle porte, la via di lettura e il filtro sulle fonti (spec §13.5.7, §13.6.1)"
```

- [ ] **Step 6: i dati di clienti già nel repo pubblico** (revisione del 15/10). Su `origin/dev` alcune prove, un commento nel codice e alcuni documenti hanno già dati di clienti: il dominio di Active Directory del cliente A con i nomi del suo router principale e di uno switch, l'account di servizio del fornitore in quel dominio, un IP del cliente A, il nome del router dell'hub, il nome del cliente A in un manuale. Il repo è pubblico (CONTEXT, Global Constraints). File noti, da ricontrollare con la ricerca:
  - `src/lib/topology/__tests__/match.test.ts`, `anonimizza.test.ts`, `sites.test.ts`;
  - `src/lib/integrations/__tests__/self-identity.test.ts`, `wazuh-alerts.test.ts`, e il commento di `src/lib/integrations/wazuh-alerts.ts:191`;
  - `docs/superpowers/plans/2026-10-12-topology-map.md`, `docs/superpowers/plans/2026-10-13-topologia-fase1-dati.md`, `docs/MANUALE-ACTIVE-DIRECTORY.md`, e ogni altro file che la ricerca trova;
  - il disegno dei nomi VRRP del cliente A nelle prove di oggi («vrrp_rete10» in `links.test.ts`, `attach.test.ts:216`, `mikrotik-porte.test.ts:19`; revisione finale del 15/10): diventa «vrrp_rete10», logico come prima. `ether1-2.5` resta: è l'eccezione scritta nelle Global Constraints.

  L'espressione di ricerca contiene i valori veri: la sessione principale la scrive **solo nel prompt** dell'agente (l'elenco completo sta nella verifica V3 della revisione, fuori dal repo), mai in un file del repo né in un messaggio di commit. Si cerca senza distinguere maiuscole e minuscole, perché `match.test.ts` ha anche la forma normalizzata:

```bash
git grep -n -i -E "$ESPR" -- src docs > "$SCRATCH/dati-clienti-prima.txt"; echo "exit=$?"
```

  Ogni valore diventa uno inventato, con lo stesso ruolo nella prova: il dominio → `cliente-a.local` (`rtr-1.cliente-a.local`, `sw1.cliente-a.local`; nella forma con la barra `CLIENTE-A\`); il nome dell'account resta, cambia solo il dominio; il router principale del cliente A → `RTR-1` (normalizzato `rtr-1`); il router dell'hub → `RTR-CORE`; gli IP del cliente A in quelle righe → `10.0.0.2` e vicini (`10.0.0.x`); il nome del cliente A in un testo → «cliente A»; gli indirizzi e i MAC della rete dell'hub che alcune prove usano come «valori veri» (la sessione principale li mette nell'espressione) → valori inventati della stessa forma, con la lista dei «veri» della prova aggiornata di conseguenza. Il senso di ogni prova non cambia (le stesse uguaglianze, gli stessi esiti). Dopo:

```bash
git grep -n -i -E "$ESPR" -- src docs; echo "exit=$?"     # atteso: nessuna riga, exit=1
node --import tsx --test src/lib/topology/__tests__/match.test.ts src/lib/topology/__tests__/anonimizza.test.ts src/lib/topology/__tests__/sites.test.ts src/lib/integrations/__tests__/self-identity.test.ts src/lib/integrations/__tests__/wazuh-alerts.test.ts > "$SCRATCH/t1-5-dati.log" 2>&1; echo "exit=$?"
```

  Atteso: `exit=1` per la ricerca (niente trovato) e `exit=0` per le prove; `npx eslint` sui file toccati con `exit=0`. Commit a parte, col messaggio senza valori: `git commit -m "fix(repo): valori inventati al posto di dati di clienti in prove, commenti e documenti"` (solo i file toccati, mai `git add -A`). La storia di git conserva i valori vecchi: se riscriverla lo decide Riccardo (domanda nel messaggio del mattino). Questo commit arriva su `dev` con T1: da solo sarebbe già un rilascio al cliente A, perché `auto-update.sh` salta solo i commit di soli `docs/` e `.md`.

---

### Task 6: pareggi fisici, non alfabetici; la testa dalle prove; le regole spegnibili (T1.5)

Spec §13.8.1 (D1; «La testa proposta», dal passaggio universale), prove I10, I11, I63, scenario S3, criteri H17 e C19. Cambia l'ordine con cui Prim sceglie (`tree.ts:44-58`): restano le foglie (`:47-48`), la ★ e il principale dell'hypervisor come scelte forzate (`:30-35`, `:95-116`), le radici (`:68-77`). `linkCost` resta per il principale dell'hypervisor.

**Dal passaggio universale (G8, I63, H17).** Dove nessuna testa è confermata, `proposeHead` (`tree.ts:130-148`) prova i router in ordine di id e tiene il primo che raggiunge più nodi: due router nella stessa componente sono pari, e vince l'id più basso. Sulla rete B il router e il gateway del controller sono pari, e vince il router per caso. A pari nodi raggiunti vince il router gateway di più reti, contate su `networks.gateway` col conto della testa proposta di una sede (`sites.ts:113-158`: il suo IP, quelli degli host fusi e degli host col suo MAC); l'id resta l'ultimo spareggio (I39). Il conto lo fa il modello (`TopologyModel.gatewayDi`), perché `proposeHead` riceve solo il modello. Qui nasce anche `src/lib/topology/regole.ts`: le cinque regole del passaggio universale entrate in T1, che il modello riceve accese e che solo la misura spegne una per una (`--senza-regola`, C19: «prima e dopo ognuna»); questo task usa `testa-per-reti`, i Task 7 e 9 le altre.

**Files:**
- Create: `src/lib/topology/regole.ts`
- Modify: `src/lib/topology/tree.ts:1-8` (import), `:44-58` (pick), `:129-148` (`proposeHead`)
- Modify: `src/lib/topology/sites.ts:112-127` (gli IP dei nodi in una funzione), in fondo `ipDeiNodi` e `retiDiCuiGateway`
- Modify: `src/lib/topology/model.ts` (`regole`, `gatewayDi`), `src/lib/topology/model-types.ts` (`TopologyModel.gatewayDi?`)
- Modify: `scripts/misura-cavi.ts` (`--senza-regola`)
- Test: `src/lib/topology/__tests__/tree.test.ts`, `src/lib/topology/__tests__/model.test.ts`

**Interfaces:**
- Consumes: `LINK_SOURCE_RANK` (`model-types.ts:13`), `MapLink`; `NodeIndex` (`node-index.ts:12-22`).
- Produces: `chiaveScelta(l: MapLink, da: string): readonly number[]` (esportata da `tree.ts`); da `src/lib/topology/regole.ts`: `NOMI_REGOLE` (`"nome-scelto-non-fisico" | "conto-per-apparato" | "vm-e-mac-propri" | "testa-per-reti" | "velocita-nomi-doppi"`), `type RegolaUniversale`, `type Regole = ReadonlySet<RegolaUniversale>`, `REGOLE_T1: Regole`, `leggiRegola(x: string): RegolaUniversale | null`; `buildTopologyModel(input: TopologyModelInput, regole: Regole = REGOLE_T1): TopologyModel`; `TopologyModel.gatewayDi?: Record<string, number>`; da `sites.ts` `ipDeiNodi(idx: NodeIndex): Map<string, Set<string>>` e `retiDiCuiGateway(input: Pick<TopologyModelInput, "networks">, idx: NodeIndex): Map<string, number>`; `scripts/misura-cavi.ts --senza-regola <regola>` (si ripete).

- [ ] **Step 1: le prove che falliscono** — in fondo a `src/lib/topology/__tests__/tree.test.ts` (aggiungere `chiaveScelta` all'import da `@/lib/topology/tree`):

```ts
// Spec §13.8.1 (D1). Incidente del 14/10: a pari costo vinceva la stringa «da|a» più piccola, e chi è il figlio secondo
// il controller non contava: router 1 prendeva accesso A via ether1-2.5 (2,5G) e core 1 finiva sotto accesso A.
// La fonte va anche a `link`, che ne fa l'id («dev:112~dev:114~unifi_uplink»): passata solo in `over`, l'id restava «~lldp».
const sp = (a: string, b: string, speedMbps: number, over: Partial<MapLink> = {}): MapLink => ({ ...link(a, b, over.source ?? "lldp"), speedMbps, ...over });

test("chiaveScelta: ★, non visto, rango, contro verso, velocità — in quest'ordine", () => {
  assert.deepEqual(chiaveScelta(sp("dev:1", "dev:114", 10000), "dev:1"), [1, 0, 2, 0, -10000]);
  assert.deepEqual(chiaveScelta(sp("dev:112", "dev:114", 10000, { source: "unifi_uplink", sources: ["unifi_uplink"], uplinkFrom: "dev:112" }), "dev:112"), [1, 0, 1, 1, -10000]);
  assert.deepEqual(chiaveScelta({ ...link("dev:1", "dev:9", "manual"), manual: { confirmed: true } }, "dev:1"), [1, 0, 3, 0, -0]);
  assert.deepEqual(chiaveScelta({ ...link("dev:1", "dev:9", "lldp", true), primary: "user" }, "dev:1"), [0, 1, 2, 0, -0]);
});

test("I11 — senza l'uplink di core 1, router 1 → core 1 (10G) vince su router 1 → accesso A (2,5G), non l'alfabeto", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:112", "switch"), node("dev:114", "switch")],
    [
      sp("dev:1", "dev:114", 10000),
      sp("dev:1", "dev:112", 2500),
      sp("dev:112", "dev:114", 10000, { source: "unifi_uplink", sources: ["unifi_uplink"], uplinkFrom: "dev:112" }),
    ],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.equal(t.via.get("dev:114")!.id, "dev:1~dev:114~lldp");
  assert.equal(t.via.get("dev:112")!.id, "dev:112~dev:114~unifi_uplink", "accesso A sotto core 1, sul suo uplink");
});

test("I10 — il verso non batte il rango: core 1 non va sotto il router di riserva attraverso la porta della WAN", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:112", "switch"), node("dev:114", "switch"), node("dev:7", "router")],
    [
      sp("dev:1", "dev:112", 2500),
      sp("dev:112", "dev:114", 10000, { source: "unifi_uplink", sources: ["unifi_uplink"], uplinkFrom: "dev:112" }),
      sp("dev:7", "dev:114", 1000),
      sp("dev:1", "dev:7", 1000),
    ],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.equal(t.via.get("dev:114")!.id, "dev:112~dev:114~unifi_uplink");
});

test("a pari rango un uplink del controller si percorre dal padre al figlio", () => {
  const m = model(
    [node("dev:1", "router"), node("dev:2", "switch"), node("dev:3", "switch")],
    [sp("dev:1", "dev:2", 1000), sp("dev:1", "dev:3", 1000), sp("dev:2", "dev:3", 1000, { uplinkFrom: "dev:2" })],
  );
  const t = buildTree(m, all(m), ["dev:1"]);
  assert.deepEqual([t.via.get("dev:2")!.id, t.via.get("dev:3")!.id], ["dev:1~dev:2~lldp", "dev:1~dev:3~lldp"]);
});

// I63 (spec §13.8.1, H17; vincolo 9 di Riccardo: niente scelte per ordine di id prima delle prove). Rete B: il router e il
// gateway del controller raggiungono gli stessi nodi, e vinceva l'id più basso, per caso. A pari nodi raggiunti vince il
// router gateway di più reti (`gatewayDi`, contate come per la testa di una sede); l'id resta l'ultimo spareggio (I39).
test("I63 — testa proposta: a pari nodi raggiunti il router gateway di più reti; a pari reti, l'id più basso", () => {
  const nodes = [node("dev:1", "router"), node("dev:5", "router"), node("dev:3", "switch")];
  const links = [link("dev:1", "dev:3"), link("dev:5", "dev:3")];
  assert.equal(proposeHead(model(nodes, links, { gatewayDi: { "dev:5": 2 } })), "dev:5");
  assert.equal(proposeHead(model(nodes, links, { gatewayDi: { "dev:1": 1, "dev:5": 1 } })), "dev:1");
  assert.equal(proposeHead(model(nodes, links)), "dev:1", "senza il conto delle reti (regola spenta): come prima");
  // i nodi raggiunti vengono prima delle reti
  assert.equal(proposeHead(model(nodes, [link("dev:1", "dev:3")], { gatewayDi: { "dev:5": 9 } })), "dev:1");
});
```

In fondo a `src/lib/topology/__tests__/model.test.ts` (l'import da `./support/righe` diventa `import { baseInput, dev, host } from "./support/righe";`):

```ts
// I63 (spec §13.8.1): il modello conta di quante reti ogni apparato è il gateway, come la testa proposta di una sede
// (sites.ts: il suo IP, quelli degli host fusi e degli host col suo MAC). Spenta la regola (misura C19), il conto non c'è.
test("gatewayDi: le reti di cui ogni apparato è gateway; assente con la regola «testa-per-reti» spenta", () => {
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1" }), dev(5, { name: "GW-5", device_type: "router", host: "10.0.5.1" })],
    hosts: [host(9, { ip: "10.0.9.1", mac: "02:00:00:00:00:05" })],
    knownMacs: [{ device_id: 5, mac: "02:00:00:00:00:05" }],
    networks: [
      { id: 1, cidr: "10.0.0.0/24", name: "a", gateway: "10.0.0.1", location_id: null },
      { id: 2, cidr: "10.0.5.0/24", name: "b", gateway: "10.0.5.1", location_id: null },
      { id: 3, cidr: "10.0.9.0/24", name: "c", gateway: "10.0.9.1", location_id: null },
      { id: 4, cidr: "10.0.7.0/24", name: "d", gateway: null, location_id: null },
    ],
  });
  assert.deepEqual(buildTopologyModel(i).gatewayDi, { "dev:1": 1, "dev:5": 2 });
  assert.equal(buildTopologyModel(i, new Set()).gatewayDi, undefined);
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/tree.test.ts src/lib/topology/__tests__/model.test.ts > "$SCRATCH/t1-6.log" 2>&1; echo "exit=$?"`
Expected: `exit=1` (export mancante `chiaveScelta`; con l'import tolto, I11 rossa: `dev:114` sotto `dev:112`; I63 rossa: vince `dev:1`; `gatewayDi` assente). Verificato sul prototipo del piano (15/10 notte): I63 e `gatewayDi` rosse prima del codice qui sotto, verdi dopo, e le prove delle sedi (`sites.test.ts`) verdi dopo lo spostamento del conto degli IP.

- [ ] **Step 3: il codice** — in `tree.ts`, import: `import { LINK_SOURCE_RANK, type MapLink, type MapNode, type TopologyModel } from "@/lib/topology/model-types";` (al posto dell'import di soli tipi a `:8`). Prima di `buildTree`:

```ts
/** Rango della fonte (spec §3): uplink 1, LLDP/CDP/MNDP 2, a mano 3 se confermato o 4, tabella MAC 3, VM 3,5. */
function rango(l: MapLink): number {
  return l.source === "manual" ? (l.manual?.confirmed ? 3 : 4) : LINK_SOURCE_RANK[l.source];
}

/**
 * La chiave con cui l'albero sceglie (spec §13.8.1, D1), confrontata elemento per elemento: vince la più piccola. La ★
 * vince sempre; poi i collegamenti visti; poi la fonte più affidabile; poi chi non percorre un uplink del controller dal
 * figlio al padre; poi il cavo più veloce. A pari chiave «da|a» in ordine, solo per avere lo stesso disegno con gli
 * stessi dati. Il verso viene DOPO il rango: messo prima, sulla copia del cliente A cambiava 4 padri e portava core 1
 * sotto il router di riserva attraverso la porta della WAN (misura del 14/10).
 */
export function chiaveScelta(l: MapLink, da: string): readonly number[] {
  return [l.primary === "user" ? 0 : 1, l.stale ? 1 : 0, rango(l), l.uplinkFrom === da ? 1 : 0, -(l.speedMbps ?? 0)];
}

function confronta(x: readonly number[], y: readonly number[]): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}
```

e `pick` (`:44-58`):

```ts
    const pick = (strict: boolean) => {
      let best: { k: readonly number[]; from: string; to: string; l: MapLink } | null = null;
      for (const x of [...taken].sort()) {
        const cls = nodeClass(nodes.get(x)!);
        if (cls === "att" || cls === "client" || cls === "hyper") continue; // foglie: non fanno da ponte
        for (const l of adj.get(x) ?? []) {
          const to = l.a === x ? l.b : l.a;
          if (taken.has(to)) continue;
          if (strict && chosen.has(to) && chosen.get(to) !== l) continue;
          const k = chiaveScelta(l, x);
          const d = best ? confronta(k, best.k) : -1;
          if (!best || d < 0 || (d === 0 && x + "|" + to < best.from + "|" + best.to)) best = { k, from: x, to, l };
        }
      }
      return best;
    };
```

(`linkCost` non serve più a `pick`: l'import da `link-attrs` resta per `hypervisorPreferred`.)

`src/lib/topology/regole.ts` (nuovo):

```ts
/**
 * Le regole del passaggio universale entrate in T1 (spec topologia §13.16; criterio C19). Ognuna si può spegnere per la
 * misura (`scripts/misura-cavi.ts --senza-regola <nome>`), che conta padri e teste con tutte le regole e con tutte meno una:
 * così sa che cosa cambia ognuna. Spenta, una regola dà il comportamento che la tappa aveva prima del passaggio universale.
 * Una regola che cambia un padre senza un perché resta fuori da T1 (C19): si toglie da `REGOLE_T1`, codice e prove restano.
 * Logica pura.
 */
export const NOMI_REGOLE = [
  "nome-scelto-non-fisico", // un nome scelto dal cliente non è una porta fisica per un router col traduttore del suo prodotto (§13.6.1, H7)
  "conto-per-apparato", // le righe di RouterOS dello stesso apparato con più MAC sono un apparato solo (§13.6.4, I60)
  "vm-e-mac-propri", // fra una VM e il suo hypervisor nessun collegamento; i MAC propri non sono VM, client né vicini (§13.7.8, H15)
  "testa-per-reti", // a pari nodi raggiunti, la testa proposta è il gateway di più reti, non l'id più basso (§13.8.1, H17)
  "velocita-nomi-doppi", // un nome di più porte tutte alla stessa velocità dà la velocità (§13.6.1, H13, I70)
] as const;

export type RegolaUniversale = (typeof NOMI_REGOLE)[number];
export type Regole = ReadonlySet<RegolaUniversale>;

/** Le regole accese nell'app. */
export const REGOLE_T1: Regole = new Set<RegolaUniversale>(NOMI_REGOLE);

export function leggiRegola(x: string): RegolaUniversale | null {
  return (NOMI_REGOLE as readonly string[]).includes(x) ? (x as RegolaUniversale) : null;
}
```

`sites.ts`: il blocco «// 4. Testa.» (`:112-127`, da `const ipsByNode = new Map…` alla fine del secondo ciclo) diventa `const ipsByNode = ipDeiNodi(idx);`, e in fondo al file:

```ts
/**
 * Gli IP di ogni nodo, per la testa (spec §3): il suo, quelli degli host fusi e quelli degli host col MAC di un apparato.
 * Li usano la testa proposta di una sede (sopra) e quella della mappa automatica (`retiDiCuiGateway`, spec §13.8.1).
 */
export function ipDeiNodi(idx: NodeIndex): Map<string, Set<string>> {
  const ipsByNode = new Map<string, Set<string>>();
  const addIp = (id: string, ip: string | null | undefined) => {
    if (!ip) return;
    const s = ipsByNode.get(id) ?? new Set<string>();
    s.add(ip);
    ipsByNode.set(id, s);
  };
  for (const n of [...idx.nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    addIp(n.id, n.mgmtIp);
    for (const h of n.fusedHostIds) addIp(n.id, idx.hostById.get(h)?.ip);
  }
  for (const h of idx.hostById.values()) {
    const owner = h.mac ? idx.byMac.get(normalizeMacForStorage(h.mac) ?? "") : undefined;
    if (typeof owner === "string" && owner.startsWith("dev:")) addIp(owner, h.ip);
  }
  return ipsByNode;
}

/**
 * Per ogni apparato, di quante reti censite è il gateway (`networks.gateway` è uno dei suoi IP): lo stesso conto della testa
 * proposta di una sede (spec §3, «il router che fa da gateway del maggior numero di subnet»), su tutte le reti. Lo usa la
 * testa proposta della mappa automatica (`proposeHead`, spec §13.8.1). Solo gli apparati con almeno una rete.
 */
export function retiDiCuiGateway(input: Pick<TopologyModelInput, "networks">, idx: NodeIndex): Map<string, number> {
  const ips = ipDeiNodi(idx);
  const out = new Map<string, number>();
  for (const [id, mine] of [...ips].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!id.startsWith("dev:")) continue;
    const n = input.networks.filter((nw) => nw.gateway !== null && mine.has(nw.gateway)).length;
    if (n > 0) out.set(id, n);
  }
  return out;
}
```

`model-types.ts`, in `TopologyModel` dopo `vms`:

```ts
  /**
   * Di quante reti censite ogni apparato è il gateway (spec §13.8.1): a pari nodi raggiunti la testa proposta è il router
   * gateway di più reti. Assente con la regola «testa-per-reti» spenta e nei modelli costruiti a mano dalle prove.
   */
  gatewayDi?: Record<string, number>;
```

`model.ts`: import `import { REGOLE_T1, type Regole } from "@/lib/topology/regole";` e `retiDiCuiGateway` accanto ad `assignSites` (`import { assignSites, retiDiCuiGateway } from "@/lib/topology/sites";`); la firma diventa

```ts
/** `regole`: le regole del passaggio universale accese (spec §13.16); le spegne solo la misura (C19). */
export function buildTopologyModel(input: TopologyModelInput, regole: Regole = REGOLE_T1): TopologyModel {
```

dopo `const sites = assignSites(input, idx, links);`:

```ts
  // Spec §13.8.1 (I63, H17): le reti di cui ogni apparato è gateway, per la testa proposta della mappa automatica.
  const gatewayDi = regole.has("testa-per-reti") ? Object.fromEntries(retiDiCuiGateway(input, idx)) : undefined;
```

e nell'oggetto ritornato, dopo `vms`: `...(gatewayDi ? { gatewayDi } : {}),`.

`tree.ts`, `proposeHead` (`:129-148`):

```ts
/**
 * Testa confermata di una sede; altrimenti il router (apparato) che raggiunge più nodi coi collegamenti non vecchi; a pari
 * nodi quello gateway di più reti (`gatewayDi`, spec §13.8.1, I63: sulla rete B il router e il gateway del controller sono
 * pari, e vinceva l'id più basso, per caso); l'id solo per ultimo, perché stessi dati diano la stessa testa (I39).
 */
export function proposeHead(model: TopologyModel): string | null {
  const confirmed = model.sites.find((s) => s.headNodeId !== null && !s.headProposed)?.headNodeId;
  if (confirmed) return confirmed;
  const fresh = new Map<string, string[]>();
  for (const l of model.links) {
    if (l.stale) continue;
    fresh.set(l.a, [...(fresh.get(l.a) ?? []), l.b]);
    fresh.set(l.b, [...(fresh.get(l.b) ?? []), l.a]);
  }
  let best: string | null = null;
  let size = -1;
  const reti = (id: string | null): number => (id ? (model.gatewayDi?.[id] ?? 0) : 0);
  for (const n of model.nodes.filter((x) => x.kind === "device" && x.type === "router").sort((a, b) => a.refId - b.refId)) {
    const seen = new Set([n.id]);
    const q = [n.id];
    while (q.length) for (const y of fresh.get(q.shift()!) ?? []) if (!seen.has(y)) { seen.add(y); q.push(y); }
    if (seen.size > size || (seen.size === size && reti(n.id) > reti(best))) { size = seen.size; best = n.id; }
  }
  return best;
}
```

`scripts/misura-cavi.ts`: nel commento d'uso, dopo la riga di `--esporta-input`, ` *         [--senza-regola <regola>]...   spegne una regola del passaggio universale (src/lib/topology/regole.ts): la misura C19 confronta «tutte le regole» con «tutte meno una»`; `"--senza-regola"` in fondo a `CON_VALORE`; subito prima di `const uscite = valori("--uscita-router")…`:

```ts
  const { NOMI_REGOLE, REGOLE_T1, leggiRegola } = await import("../src/lib/topology/regole");
  const senza = valori("--senza-regola");
  if (senza.some((r) => leggiRegola(r) === null)) return uso(`--senza-regola vuole una di: ${NOMI_REGOLE.join(", ")}.`);
  const regole = new Set([...REGOLE_T1].filter((r) => !senza.includes(r)));
```

le due chiamate `buildTopologyModel(input)` diventano `buildTopologyModel(input, regole)`, e l'oggetto `out` comincia con `{ tenant, scenario: val("--scenario") ?? "S0", regole_spente: senza, quick_check_prima: quick() }`.

- [ ] **Step 4: verdi** — `tree.test.ts` e tutte le prove della topologia.

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1-6.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`. Se cambiano i numeri di `model-fixtures.test.ts` legati all'albero (dimensioni della disposizione verticale, `:137`): i valori nuovi si leggono dal messaggio della prova che cade (`expected`/`actual` nel log `$SCRATCH/t1-6.log`) e si riscrivono, col commento «Task 6 (pareggi §13.8.1): ‹quale pareggio cambia e perché›»; se cambia altro che le dimensioni, ci si ferma e si guarda. **Unione** (sessione principale): il Task 6 si unisce dopo il Task 5, ribasato; le prove si rifanno sull'unione.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/tree.ts src/lib/topology/regole.ts src/lib/topology/sites.ts src/lib/topology/model.ts src/lib/topology/model-types.ts scripts/misura-cavi.ts src/lib/topology/__tests__/tree.test.ts src/lib/topology/__tests__/model.test.ts src/lib/topology/__tests__/model-fixtures.test.ts
git commit -m "fix(topologia): pareggi dell'albero per verso e velocità, la testa per reti e non per id, regole spegnibili dalla misura (spec §13.8.1, §13.16)"
```

---

### Task 7: una linea per coppia, con le porte di una prova sola (T1.3, passi 0-3, 5, 6)

Spec §13.7.1 (passi 0, 1, 2, 3a, 3b, 3c, 5, 6 e le «due trappole»), §13.6.1 (velocità per chiave), §13.6.2, §13.15 punto 2 (la regola del segmento in T1). Prove I2, I4, I5, I6, I7, I13, I15, I43, I47, H2, H10 e Review Focus 1-3; dal passaggio universale I58 (la parte del modello), I60, I61, I70, H7, H13 e Review Focus 8. **Il passo 4 («Ignora» per cavo) è del Task 9**: qui la correzione «ignora» toglie ancora la coppia, come prima, così il task si rivede da solo. È il cuore della tappa: Sonnet, col codice scritto qui per intero; la revisione finale di T1 è su Opus.

Due trappole viste sui dati (§13.7.1): si raggruppa per **telaio**, non per nodo abbinato (la riga VRRP della porta 10 di core 1 si abbinerebbe per IP a un altro nodo e farebbe della porta 10 un segmento); `attach.ts` deve ricevere il nome **tradotto** della porta del router (`ether4`, non `ether4,bridge`), altrimenti la porta non risulta occupata e nasce un ripiego che oggi non c'è.

**Dal passaggio universale (spec §13.16; §13.6.1, §13.6.4, §13.7.1 passi 1-3 e «Quattro trappole»), tre regole, ognuna spegnibile dalla misura (Task 6):**
- `nome-scelto-non-fisico` (I58, H7, G2): per un router letto col traduttore del suo prodotto (un MikroTik via SSH) «porta fisica» vuol dire `fisica: true` nell'«unico vicino», nella conferma (3c) e nel conteggio del passo 2 (`contabile`, già così) come nel ripiego (`fisicaDelRouter`, già così): un nome scelto dal cliente, «non noto», non dà cavi dalle righe del router. Col traduttore generico vale «non logica», come prima: un router di un'altra marca non perde i cavi che ha. Anche dal lato remoto (G2): dal lato di un MikroTik un nome scelto non è una porta fisica, e la porta remota resta non nota come per una VLAN. Rete B: la linea fra il router e il router di frontiera passava da una VLAN dove il secondo era l'unico vicino (la quarta trappola della spec). Il prezzo dichiarato (§13.13.2): una porta fisica rinominata su un MikroTik non dà cavi dalle righe del router; il cavo resta se lo vede l'altro capo (Review Focus 8).
- `conto-per-apparato` (I60, G4): nelle righe di `/ip neighbor` il MAC è dell'interfaccia che ha mandato l'annuncio, non il telaio (`macDelTelaio`, Task 3): i gruppi delle righe di RouterOS sulla stessa porta si uniscono per nome annunciato, quando il nome identifica (`identifiesByName`, `identity.ts:29-32`), salvo MAC veri di OUI diversi (`node-index.ts:171-177`); le righe VRRP, senza OUI, si uniscono al nome. Senza, lo stesso router sentito con due MAC sulla stessa porta fa un segmento falso che toglie un cavo provato (sulla rete B, appena il router di frontiera fosse letto). Il controller e SNMP danno il telaio: niente cambia.
- `velocita-nomi-doppi` (I70, H13): un nome che corrisponde a più porte dello stesso apparato non dice la porta (I14), ma se tutte hanno la stessa velocità la velocità si sa. Rete B: il cavo dati di un hypervisor sta su un nome di due porte a 10G; senza, l'hypervisor finisce sotto la sua porta di gestione a 1G.

Misurato sul prototipo del piano (15/10 notte), spegnendo una regola per volta: sulla fixture e sulla copia del cliente A nessuna delle tre cambia un padre, una testa o un conteggio (sui router del cliente A nessuna porta è «non nota»: i nomi sono di fabbrica, o scelti col prefisso di un'interfaccia che il traduttore legge — le VLAN «vlanNN-…» e le VRRP sono logiche, `ether1-2.5` è fisica per la velocità in coda; verifica UV1 del 15/10: prima qui si leggeva «solo nomi di fabbrica», ed era falso); sulla rete B `nome-scelto-non-fisico` toglie la linea dalla VLAN sulla copia (`linee_da_nome_scelto` 1 → 0, nessun padre cambia; sulla fixture nessun effetto), `conto-per-apparato` toglie un vicino non abbinato (8 → 7, copia e fixture), `velocita-nomi-doppi` porta un hypervisor dalla sua porta di gestione (lo switch a 48 porte) all'aggregazione a 10G (H13, copia e fixture: sulla fixture `dev:4` passa da `dev:7` a `dev:11`).

**Files:**
- Modify: `src/lib/topology/links.ts` (riscritto: stesse esportazioni `buildLinks`, `pairKey`, `DEFAULT_STALE_DAYS`; via `physicalPortName` e `isPhysicalPort`; nuove `righeUltimoGiro`, `comeDi`, `portaLocale`, tipo `RisultatoCollegamenti`)
- Modify: `src/lib/topology/model-types.ts` (`AltroCavo`; `MapLink.altriCavi?`; `MapNode.via?`)
- Modify: `src/lib/topology/node-index.ts:102-106` (`via` sul nodo dell'apparato)
- Modify: `src/lib/topology/link-attrs.ts` (`enrichLinks`: velocità per chiave, anche di un nome doppio, `medium` senza fili, `regole`; `confirmManual`: anche gli altri cavi della coppia)
- Modify: `src/lib/topology/attach.ts` (opzioni in un oggetto; porta fisica del router dal traduttore; niente linee dalla tabella MAC verso chi sta su una porta di segmento)
- Modify: `src/lib/topology/model.ts:31-32` e `:56-68` (`isolated` riceve chi resta senza collegamenti su una porta di segmento; `suspicious` solo per gli apparati; `segmenti` nel ritorno)
- Modify: `src/lib/topology/misura.ts` (`lineeCucite`: la porta del padre dell'uplink anche col nome dell'elenco; `conteggi` += `porte_di_segmento`), `scripts/misura-cavi.ts` (`--nomi`: le porte di segmento coi loro membri, per H5, H6 e C8)
- Modify: `scripts/estrai-fixture-topologia.ts` (`:55-69`, il confronto dei conteggi senza le VM), `src/lib/topology/anonimizza.ts` (`ingressoDellaFixture`)
- Test: `src/lib/topology/__tests__/links.test.ts`, `link-attrs.test.ts`, `attach.test.ts` (aiuto `run`), `anonimizza.test.ts`, `model-fixtures.test.ts`, `cavi-senza-prodotti.test.ts` (I37 sul codice di `links.ts`), fixture `src/lib/topology/__tests__/fixtures/topologia-{cliente-a,domarc}.json` (riestratte)

**Interfaces:**
- Consumes: Task 3 (`traduciPorta`, `ComeLetto`, `haTraduttore`, `haTraduttoreRemoto`, `macDelTelaio`, `chiavePorta`, `elenchiPorte`, `normale`, `portaInElenco`, `indiciInElenco`, `Porta`), Task 5 (`ports`, `via`, `remote_platform`), Task 6 (`chiaveScelta`, `REGOLE_T1`, `type Regole`, `buildTopologyModel(input, regole)`), `identifiesByName`, `realOui` (`identity.ts:29-39`), `nameKey` (`node-index.ts:28`), `RunningVmMacs` (`vm-ports.ts:37`), `placeVms` (`vms.ts:146`, già chiamata prima di `buildLinks` in `model.ts:30`).
- Produces:

```ts
// model-types.ts
/** Un altro cavo visto fra gli stessi due oggetti (spec §13.4.6, T1): una linea è una coppia fino a T3. Porte orientate come la linea. */
export interface AltroCavo { aPort: string; bPort: string; sources: LinkSource[]; lastSeen: string | null }
// MapLink += altriCavi?: AltroCavo[]      MapNode += via?: string
// TopologyModel += segmenti?: Record<string, string[]>   («nodo|porta normalizzata» → membri; per la misura, in T1 non si disegna)

// anonimizza.ts
export function ingressoDellaFixture(input: TopologyModelInput): TopologyModelInput;   // l'ingresso senza VM e host dei cluster

// links.ts
export interface RisultatoCollegamenti {
  links: MapLink[];
  unmatched: UnmatchedNeighbor[];
  /** Le coppie ignorate a mano: per coppia fino al Task 9, che la sostituisce con `ignorati`. */
  ignored: ReadonlySet<string>;
  /** Le porte di segmento (passo 2): «nodo|porta normalizzata» → gli oggetti abbinati che la porta sente via LLDP o CDP. */
  segmenti: ReadonlyMap<string, ReadonlySet<string>>;
}
export function buildLinks(input: TopologyModelInput, idx: NodeIndex, vmAccese?: RunningVmMacs, regole?: Regole): RisultatoCollegamenti;   // regole: di base REGOLE_T1
export function righeUltimoGiro(input: Pick<TopologyModelInput, "neighbors" | "devices">): ModelNeighborRow[];
export function comeDi(input: Pick<TopologyModelInput, "devices">): (nodo: string | null, fonte: string, piattaforma: string | null) => ComeLetto;
export function portaLocale(input: TopologyModelInput): (nodo: string, nome: string) => Porta | null;

// attach.ts
export interface OpzioniAttacco {
  vmMacs?: ReadonlySet<string>;
  runningVmMacs?: RunningVmMacs;
  ignored?: ReadonlySet<string>;
  segmenti?: ReadonlyMap<string, ReadonlySet<string>>;
}
export function attachMacs(input: TopologyModelInput, idx: NodeIndex, links: MapLink[], opzioni?: OpzioniAttacco):
  { portClients: PortClients[]; clientCount: Record<string, number>; attachLinks: MapLink[] };
```

- [ ] **Step 1: le prove che falliscono** — `src/lib/topology/__tests__/links.test.ts`. In testa: l'import diventa `import { buildLinks, righeUltimoGiro } from "@/lib/topology/links";`; `run` resta; l'aiuto dei router diventa quello dei MikroTik veri, letti via SSH:

```ts
const rtr = (id: number) => dev(id, { name: `RTR-${id}`, device_type: "router", vendor: "mikrotik", via: "ssh" });
```

Si **tolgono** le due prove dei nomi fisici («porta fisica: ether1-2.5 …», righe 162-171, e «M-7: …», righe 205-215): sono in `traduci.test.ts` dal Task 3 (I41). Si **riscrivono**, col motivo nel commento, «switch (non router) con più vicini su una porta: comportamento invariato» (righe 154-160) e «router: lo stesso caso via LLDP dai due lati → collegamento fra i router» (righe 199-203):

```ts
test("uno switch con più vicini MNDP sulla stessa porta fisica: come prima (MNDP non fa un segmento)", () => {
  const i = input({ devices: [dev(1), dev(2), dev(3)], neighbors: [via(2, { local_port: "Port 3" }), via(3, { local_port: "Port 3" })] });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b]), [["dev:1", "dev:2"], ["dev:1", "dev:3"]]);
});

// I5 (spec §13.6.2): prima valeva solo per i router, e solo finché la coppia non era confermata (`links.ts:178-181`).
test("I5 — da un'interfaccia logica di chi osserva non nasce un cavo, router o switch", () => {
  const i = input({ devices: [dev(1), dev(2), dev(3)], neighbors: [via(2, { local_port: "bridge" }), via(3, { local_port: "bridge" })] });
  assert.deepEqual(run(i).links, []);
});

// Prima questa prova voleva il cavo fra i router: ognuno però sente due apparati via LLDP su quella porta, quindi in
// mezzo c'è un apparato che non si vede (la regola del segmento, decisa per T1 il 14/10 sera, §13.15 punto 2).
test("I7, M-5 — via LLDP dai due lati, ma ognuno sente due apparati su quella porta: segmento, nessun cavo fra i router", () => {
  const coppie = run(dueRouter("lldp")).links.map((l) => [l.a, l.b]);
  assert.ok(!coppie.some(([a, b]) => a === "dev:1" && b === "dev:2"), JSON.stringify(coppie));
});

test("due router che si vedono via LLDP dai due lati, ognuno unico apparato sulla sua porta: un cavo (radio trasparente, §13.7.6 punto 7)", () => {
  const i = input({
    devices: [rtr(1), rtr(2)],
    neighbors: [
      nb(1, { local_port: "ether4", remote_ip: "10.0.0.2", remote_device_name: "RTR-2", remote_port: "ether4", protocol: "lldp", remote_platform: "MikroTik" }),
      nb(2, { local_port: "ether4", remote_ip: "10.0.0.1", remote_device_name: "RTR-1", remote_port: "ether4", protocol: "lldp", remote_platform: "MikroTik" }),
    ],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.aPort, l.b, l.bPort, l.source]), [["dev:1", "ether4", "dev:2", "ether4", "lldp"]]);
});
```

In fondo al file, la sede 1 del cliente A in piccolo (forma vera, nomi e MAC inventati) e le prove nuove:

```ts
// ─── Spec §13.7.1: la sede 1 del cliente A in piccolo ───
// Router 1 (dev:1), accesso A (dev:112), core 1 (dev:114), router di riserva (host:7, censito solo come host). Le righe
// del router come le scrive il lettore di T1; quelle di core 1 e di accesso A dal controller. Core 1 sale al router con
// l'uplink del controller, che non sa la porta del router (il router non è del controller).
const ORA = "2026-10-13 11:00:00", ORA_CONTROLLER = "2026-10-13 03:00:00";
const RTR_MAC = "02:00:00:00:00:01", CORE_MAC = "02:00:00:00:01:14", ACC_MAC = "02:00:00:00:01:12", RIS_MAC = "02:00:00:00:00:07";
const porta = (device_id: number, port_index: number, port_name: string, speed: string | null = null) =>
  ({ device_id, port_index, port_name, speed, status: "up", stp_state: null });

function sede1(): TopologyModelInput {
  const r = (local_port: string, remote_device_name: string, remote_port: string, remote_mac: string, protocol = "lldp", remote_platform: string | null = null) =>
    nb(1, { local_port, remote_device_name, remote_port, remote_mac, protocol, remote_platform, timestamp: ORA });
  const c = (device_id: number, local_port: string, remote_device_name: string, remote_port: string, remote_mac: string) =>
    nb(device_id, { local_port, remote_device_name, remote_port, remote_mac, protocol: "lldp", source: "unifi", timestamp: ORA_CONTROLLER });
  return input({
    devices: [
      rtr(1),
      dev(112, { name: "ACC-A", controller_mac: ACC_MAC, uplink_mac: CORE_MAC, uplink_remote_port: 9, uplink_seen_at: ORA_CONTROLLER, via: "api" }),
      dev(114, { name: "CORE-1", controller_mac: CORE_MAC, uplink_mac: RTR_MAC, uplink_seen_at: ORA_CONTROLLER, via: "api" }),
    ],
    hosts: [host(7, { ip: "10.0.9.2", mac: RIS_MAC, hostname: "RTR-RISERVA", classification: "router" })],
    knownMacs: [{ device_id: 1, mac: RTR_MAC }],
    uplinkPorts: [{ device_id: 114, port_index: 10, port_name: "Uplink verso il router" }, { device_id: 112, port_index: 50, port_name: "SFP+ 2" }],
    ports: [
      porta(1, 1, "ether1-2.5", "2500 Mbps"), porta(1, 3, "ether3", "1000 Mbps"), porta(1, 8, "ether8", "1000 Mbps"),
      porta(1, 9, "sfp-sfpplus1", "10000 Mbps"), porta(1, 10, "bridge"), porta(1, 11, "vlan10-uffici"),
      porta(114, 9, "Port 9", "10000 Mbps"), porta(114, 10, "Uplink verso il router", "10000 Mbps"), porta(114, 15, "Port 15 - WAN", "1000 Mbps"),
      porta(112, 47, "Port 47", "2500 Mbps"), porta(112, 50, "SFP+ 2", "10000 Mbps"),
    ],
    neighbors: [
      r("sfp-sfpplus1,bridge", "CORE-1", "Uplink verso il router", CORE_MAC),
      r("ether8", "CORE-1", "Port 15 - WAN", CORE_MAC),
      r("ether8", "RTR-RISERVA", "bridge/ether8", RIS_MAC, "lldp", "MikroTik"),
      r("ether1-2.5", "ACC-A", "Port 47", ACC_MAC),
      r("ether1-2.5", "RTR-RISERVA", "bridge/ether1-2.5", RIS_MAC, "mndp", "MikroTik"),
      r("vlan10-uffici", "RTR-RISERVA", "vlan10-uffici", RIS_MAC, "mndp", "MikroTik"),
      c(114, "Uplink verso il router", "RTR-1", "sfp-sfpplus1", RTR_MAC),
      c(114, "Port 15 - WAN", "RTR-1", "ether8", RTR_MAC),
      c(114, "Port 15 - WAN", "RTR-RISERVA", "ether8", RIS_MAC),
      c(114, "Port 9", "ACC-A", "SFP+ 2", ACC_MAC),
      c(112, "Port 47", "RTR-1", "ether1-2.5", RTR_MAC),
      c(112, "SFP+ 2", "CORE-1", "Port 9", CORE_MAC),
    ],
  });
}
const linea = (i: TopologyModelInput, id: string) => run(i).links.find((l) => l.id === id)!;

test("I6 — le porte di una linea vengono da una prova sola: l'uplink si completa con la riga LLDP di core 1 sulla sua porta di uplink", () => {
  const { links, segmenti } = run(sede1());
  const rc = links.find((l) => l.id === "link:dev:1|dev:114")!;
  assert.deepEqual([rc.a, rc.aPort, rc.b, rc.bPort, rc.sources, rc.uplinkFrom], ["dev:114", "Uplink verso il router", "dev:1", "sfp-sfpplus1", ["unifi_uplink", "lldp"], "dev:114"]);
  assert.equal(rc.altriCavi, undefined, "ether8 e la porta 15 non danno un cavo");
  assert.deepEqual(links.map((l) => l.id), ["link:dev:112|dev:114", "link:dev:1|dev:112", "link:dev:1|dev:114"]);
  assert.deepEqual([...segmenti.keys()].sort(), ["dev:114|port15-wan", "dev:1|ether8"]);
  assert.deepEqual([...segmenti.get("dev:1|ether8")!].sort(), ["dev:114", "host:7"]);
});

test("I4 — conferma per porta: core 1 vede router 1 sulla porta 10, non sulla 15 → la riga del router su ether8 non passa", () => {
  const i = sede1();
  // Senza il router di riserva e senza le righe della porta 15: ether8 non è un segmento, ma sente core 1 (LLDP) e un
  // altro router (MNDP), quindi non è «unico vicino» e serve la conferma sulla porta.
  i.neighbors = i.neighbors.filter((n) => n.remote_mac !== RIS_MAC && !(n.device_id === 114 && n.local_port === "Port 15 - WAN"));
  i.devices.push(rtr(2));
  i.neighbors.push(nb(1, { local_port: "ether8", remote_device_name: "RTR-2", remote_ip: "10.0.0.2", protocol: "mndp", remote_platform: "MikroTik", timestamp: ORA }));
  const rc = linea(i, "link:dev:1|dev:114");
  assert.deepEqual([rc.aPort, rc.bPort, rc.altriCavi], ["Uplink verso il router", "sfp-sfpplus1", undefined]);
});

test("I5 — la riga del router da una VLAN verso core 1, con la coppia confermata: niente", () => {
  const i = sede1();
  i.neighbors.push(nb(1, { local_port: "vlan10-uffici", remote_device_name: "CORE-1", remote_port: "Uplink verso il router", remote_mac: CORE_MAC, protocol: "lldp", timestamp: ORA }));
  assert.equal(linea(i, "link:dev:1|dev:114").altriCavi, undefined);
});

test("I7, C8 — la porta 15 di core 1 sente due apparati: non dà cavi; il router di riserva sta sotto accesso B, porta 16", () => {
  const i = sede1();
  i.devices.push(dev(78, { name: "ACC-B", controller_mac: "02:00:00:00:00:78", via: "api" }));
  // Il router di riserva annuncia solo da una VLAN: la sua porta non è nota.
  i.neighbors.push(nb(78, { local_port: "Port 16", remote_device_name: "RTR-RISERVA", remote_port: "vrrp_rete_7", remote_mac: RIS_MAC, source: "unifi", timestamp: ORA_CONTROLLER, remote_platform: "MikroTik" }));
  const ris = run(i).links.filter((l) => l.a === "host:7" || l.b === "host:7");
  assert.deepEqual(ris.map((l) => [l.a, l.aPort, l.b, l.bPort]), [["dev:78", "Port 16", "host:7", ""]]);
});

test("I15 — le righe dello stesso apparato sulla porta 10 di core 1 sono un gruppo; la riga VRRP col suo IP non porta sul nodo sbagliato", () => {
  const i = sede1();
  i.hosts.push(host(9, { ip: "10.0.9.254", hostname: "VIP-GATEWAY", classification: "server" }));
  i.neighbors.push(
    nb(114, { local_port: "Uplink verso il router", remote_device_name: "RTR-1", remote_port: "vrrp_rete_7", remote_ip: "10.0.9.254", remote_mac: RTR_MAC, source: "unifi", timestamp: ORA_CONTROLLER }),
    nb(114, { local_port: "Uplink verso il router", remote_device_name: "RTR-1", remote_port: "vlan10-uffici", remote_mac: RTR_MAC, source: "unifi", timestamp: ORA_CONTROLLER }),
  );
  const { links, segmenti } = run(i);
  assert.equal(links.some((l) => l.a === "host:9" || l.b === "host:9"), false, "nessuna linea verso il nodo dell'IP virtuale");
  assert.equal(segmenti.has("dev:114|uplinkversoilrouter"), false, "la porta 10 non diventa un segmento");
  const rc = links.find((l) => l.id === "link:dev:1|dev:114")!;
  assert.deepEqual([rc.aPort, rc.bPort, rc.altriCavi], ["Uplink verso il router", "sfp-sfpplus1", undefined]);
});

// I15 vale anche per un gruppo di una riga sola (revisione del piano, 15/10): una riga da una VRRP porta l'IP virtuale, che
// è di un altro nodo. Prima un gruppo di una riga si abbinava come una volta, cioè per IP per primo.
test("I15 — una riga sola da una VRRP, con l'IP virtuale che è di un altro nodo: si abbina per telaio, non all'IP", () => {
  const RTR = "02:00:00:00:00:01";
  const i = input({
    devices: [dev(5, { name: "SW-5", via: "api" }), rtr(1)],
    hosts: [host(9, { ip: "10.0.9.254", hostname: "VIP-GATEWAY", classification: "server" })],
    knownMacs: [{ device_id: 1, mac: RTR }],
    neighbors: [nb(5, { local_port: "Port 15", remote_device_name: "", remote_port: "vrrp_rete_7", remote_ip: "10.0.9.254", remote_mac: RTR, source: "unifi" })],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.b]), [["dev:5", "dev:1"]]);
});

test("I13 — «eth0» su uno switch che non ha quella porta: porta non nota, nessun segmento", () => {
  const i = input({
    devices: [dev(5, { name: "FLEX-5", via: "api" }), dev(6), dev(7)],
    ports: [porta(5, 1, "Port 1")],
    neighbors: [
      nb(5, { local_port: "eth0", remote_device_name: "SW-6", remote_ip: "10.0.0.6", source: "unifi" }),
      nb(5, { local_port: "eth0", remote_device_name: "SW-7", remote_ip: "10.0.0.7", source: "unifi" }),
    ],
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  assert.equal(links.length, 2, "le righe valgono come prima, con la porta da completare dall'altro capo");
});

test("I43 — un vicino vecchio non fa un segmento: dopo un ricablaggio il cavo nuovo c'è, il vecchio è «non visto»", () => {
  const i = input({
    devices: [dev(2, { via: "api" }), dev(3), dev(4)],
    neighbors: [
      nb(2, { local_port: "Port 5", remote_device_name: "SW-3", remote_ip: "10.0.0.3", source: "unifi", timestamp: "2026-10-09 03:00:00" }),
      nb(2, { local_port: "Port 5", remote_device_name: "SW-4", remote_ip: "10.0.0.4", source: "unifi", timestamp: "2026-10-13 03:00:00" }),
    ],
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  const per = new Map(links.map((l) => [l.b, l]));
  assert.deepEqual([per.get("dev:4")?.stale, per.get("dev:3")?.stale], [false, true]);
});

test("R-superata: la riga troncata di ieri lascia il posto a quella intera di oggi; un vicino sparito resta e invecchia", () => {
  const i = input({
    devices: [rtr(1), dev(112, { name: "ACC-A" })],
    knownMacs: [{ device_id: 112, mac: ACC_MAC }],
    neighbors: [
      nb(1, { local_port: "ether1-2.5", remote_device_name: "ACC-A", remote_port: "Port", remote_mac: ACC_MAC, protocol: "mndp", timestamp: "2026-10-13 10:00:00" }),
      nb(1, { local_port: "ether1-2.5", remote_device_name: "ACC-A", remote_port: "Port 47", remote_mac: ACC_MAC, protocol: "lldp", timestamp: "2026-10-13 11:00:00" }),
      nb(1, { local_port: "ether7", remote_device_name: "SW-SPARITO", remote_port: "Port 1", remote_mac: "02:00:00:00:09:99", protocol: "lldp", timestamp: "2026-10-01 11:00:00" }),
    ],
  });
  assert.deepEqual(righeUltimoGiro(i).map((n) => n.remote_port).sort(), ["Port 1", "Port 47"]);
  const l = run(i).links.find((x) => x.b === "dev:112")!;
  assert.deepEqual([l.aPort, l.bPort, l.source], ["ether1-2.5", "Port 47", "lldp"]);
});

test("Review Focus 1 — righe senza data o con una data illeggibile: restano, contano come attuali, niente errori", () => {
  const i = input({
    devices: [dev(2, { via: "api" }), dev(3), dev(4)],
    neighbors: [
      nb(2, { local_port: "Port 5", remote_device_name: "SW-3", remote_ip: "10.0.0.3", source: "unifi", timestamp: null }),
      nb(2, { local_port: "Port 6", remote_device_name: "SW-4", remote_ip: "10.0.0.4", source: "unifi", timestamp: "non è una data" }),
    ],
  });
  assert.equal(righeUltimoGiro(i).length, 2);
  assert.deepEqual(run(i).links.map((l) => [l.b, l.stale, l.daysUnseen]), [["dev:3", false, null], ["dev:4", false, null]]);
});

test("Review Focus 2 — il MAC VRRP non è un telaio: router 1 e router di riserva sulla stessa porta restano due apparati", () => {
  const VRRP = "00:00:5E:00:01:0A";
  const i = input({
    devices: [dev(5, { name: "SW-5", via: "api" }), rtr(1), rtr(8)],
    neighbors: [
      nb(5, { local_port: "Port 15", remote_device_name: "RTR-1", remote_port: "vrrp_rete_7", remote_mac: VRRP, source: "unifi" }),
      nb(5, { local_port: "Port 15", remote_device_name: "RTR-8", remote_port: "vrrp_rete_7", remote_mac: VRRP, source: "unifi" }),
    ],
  });
  const { links, segmenti } = run(i);
  assert.deepEqual([...segmenti.keys()], ["dev:5|port15"]);
  assert.deepEqual(links, []);
});

test("Review Focus 3 — lo stesso apparato sulla stessa porta dal controller e dalla lettura dell'apparato, con due telai: uno solo", () => {
  const i = input({
    devices: [dev(5, { name: "SW-5", via: "api" }), dev(6, { name: "SW-6", controller_mac: "02:00:00:00:00:06" })],
    knownMacs: [{ device_id: 6, mac: "02:00:00:00:06:01" }],
    neighbors: [
      nb(5, { local_port: "Port 3", remote_device_name: "SW-6", remote_mac: "02:00:00:00:00:06", source: "unifi" }),
      nb(5, { local_port: "Port 3", remote_device_name: "SW-6", remote_mac: "02:00:00:00:06:01", source: "device" }),
    ],
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  assert.deepEqual(links.map((l) => [l.a, l.b, l.sources]), [["dev:5", "dev:6", ["lldp"]]]);
});

test("H2 — router e aggregazione con due cavi: la linea ha le porte di un cavo (porta 31 ↔ sfp28-2), l'altro fra gli altri cavi visti", () => {
  const AGG = "02:00:00:00:00:11", RTR = "02:00:00:00:00:01";
  const i = input({
    devices: [rtr(1), dev(11, { name: "AGG-11", controller_mac: AGG, uplink_mac: RTR, uplink_seen_at: ORA_CONTROLLER, via: "snmp_v2" })],
    knownMacs: [{ device_id: 1, mac: RTR }],
    uplinkPorts: [{ device_id: 11, port_index: 31, port_name: "SFP28 31 - verso il router" }],
    ports: [porta(1, 1, "sfp28-1", "25000 Mbps"), porta(1, 2, "sfp28-2", "25000 Mbps"), porta(11, 31, "SFP28 31 - verso il router", "25000 Mbps"), porta(11, 32, "SFP28 32", "25000 Mbps")],
    neighbors: [
      nb(11, { local_port: "SFP28 31 - verso il router", remote_device_name: "RTR-1", remote_port: "sfp28-2", remote_mac: RTR, source: "unifi", timestamp: ORA_CONTROLLER }),
      nb(11, { local_port: "SFP28 31 - verso il router", remote_device_name: "RTR-1", remote_port: "VL_31_XY", remote_mac: RTR, source: "unifi", timestamp: ORA_CONTROLLER }),
      nb(11, { local_port: "SFP28 32", remote_device_name: "RTR-1", remote_port: "sfp28-1", remote_mac: RTR, source: "unifi", timestamp: ORA_CONTROLLER }),
      nb(1, { local_port: "sfp28-1,bond1,LAN_IN", remote_device_name: "AGG-11", remote_port: "SFP28 32", remote_mac: AGG, protocol: "mndp", timestamp: ORA }),
      nb(1, { local_port: "sfp28-2,bond1,LAN_IN", remote_device_name: "AGG-11", remote_port: "SFP28 31 - verso il router", remote_mac: AGG, protocol: "mndp", timestamp: ORA }),
    ],
  });
  const [l] = run(i).links;
  assert.deepEqual([l.a, l.aPort, l.b, l.bPort, l.sources], ["dev:11", "SFP28 31 - verso il router", "dev:1", "sfp28-2", ["unifi_uplink", "lldp", "mndp"]]);
  assert.deepEqual(l.altriCavi, [{ aPort: "SFP28 32", bPort: "sfp28-1", sources: ["lldp", "mndp"], lastSeen: ORA }]);
});

test("I47, H10 — un'interfaccia senza fili non è logica: il client dell'access point resta collegato, «≋ Wi-Fi»", () => {
  const i = input({
    devices: [dev(191, { name: "AP-191", device_type: "access_point", via: "api" }), dev(192, { name: "AP-192", device_type: "access_point" })],
    neighbors: [nb(191, { local_port: "wifi2ap9", remote_device_name: "AP-192", remote_ip: "10.0.0.192", source: "unifi" })],
  });
  const [l] = run(i).links;
  assert.deepEqual([l.a, l.aPort, l.b, l.medium], ["dev:191", "wifi2ap9", "dev:192", "wireless"]);
});

// ─── Passaggio universale (spec §13.16): le regole entrate in T1, scritte per ogni rete ───
/** Come `run`, con una regola del passaggio universale spenta (la misura C19 confronta «tutte» e «tutte meno una»). */
function senza(i: TopologyModelInput, regola: RegolaUniversale) {
  return buildLinks(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs), new Map(), new Set([...REGOLE_T1].filter((r) => r !== regola)));
}
const RF_MAC = "02:00:00:00:00:21";
/** Il router di testa (dev:1) e un secondo router (dev:21) con due cavi diretti fra loro: la forma della rete B (l'hub). */
function testaEFrontiera(extra: ModelNeighborRow[]): TopologyModelInput {
  return input({
    devices: [rtr(1), dev(21, { name: "RTR-FRONTIERA", device_type: "router", vendor: "mikrotik", via: "ssh", host: "10.0.0.21" })],
    knownMacs: [{ device_id: 21, mac: RF_MAC }],
    ports: [porta(1, 1, "sfp-sfpplus1", "10000 Mbps"), porta(1, 3, "sfp-sfpplus3", "10000 Mbps"), porta(21, 2, "sfp-sfpplus2", "10000 Mbps"), porta(21, 4, "sfp-sfpplus4", "10000 Mbps")],
    neighbors: [
      nb(1, { local_port: "sfp-sfpplus1,BR_RP", remote_device_name: "RTR-FRONTIERA", remote_port: "sfp-sfpplus2", remote_mac: RF_MAC, protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA }),
      nb(1, { local_port: "sfp-sfpplus3,BR_RP", remote_device_name: "RTR-FRONTIERA", remote_port: "sfp-sfpplus4", remote_mac: RF_MAC, protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA }),
      ...extra,
    ],
  });
}
const porteDi = (l: { aPort: string; bPort: string; altriCavi?: Array<{ aPort: string; bPort: string }> }) => [l.aPort, l.bPort, ...(l.altriCavi ?? []).flatMap((c) => [c.aPort, c.bPort])];

// I58 (spec §13.12.3) e H7 anticipato per i MikroTik (§13.6.1; §13.7.1 passo 1 e quarta trappola). Rete B, 14/10: il router
// sente il router di frontiera su dieci VLAN dai nomi scelti, e su una è l'unico vicino: la mappa tracciava la linea fra i due
// da lì («VL_… ↔ VL_…»). Per un router col traduttore del suo prodotto un nome scelto non è una porta fisica.
test("I58, H7 — dalle righe di un MikroTik su un nome scelto nessun cavo: né come unico vicino, né confermato", () => {
  const i = testaEFrontiera([
    nb(1, { local_port: "VL_16_QWE", remote_device_name: "RTR-FRONTIERA", remote_port: "VL_16_QWE", remote_mac: RF_MAC, protocol: "mndp", remote_platform: "MikroTik", timestamp: ORA }),
    nb(1, { local_port: "XQ_7_ABC", remote_device_name: "RTR-FRONTIERA", remote_port: "sfp-sfpplus2", remote_mac: RF_MAC, protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA }),
    nb(21, { local_port: "sfp-sfpplus2", remote_device_name: "RTR-1", remote_port: "XQ_7_ABC", remote_ip: "10.0.0.1", protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA }),
  ]);
  const [l] = run(i).links;
  assert.deepEqual(porteDi(l).filter((p) => /^(VL_|XQ_)/.test(p)), [], JSON.stringify(l));
  assert.deepEqual([l.a, l.aPort, l.b, l.bPort], ["dev:1", "sfp-sfpplus1", "dev:21", "sfp-sfpplus2"]);
  assert.deepEqual(l.altriCavi?.map((c) => [c.aPort, c.bPort]), [["sfp-sfpplus3", "sfp-sfpplus4"]], "il secondo cavo vero fra gli altri cavi visti");
  const prima = senza(i, "nome-scelto-non-fisico").links[0];
  assert.equal(porteDi(prima).some((p) => /^(VL_|XQ_)/.test(p)), true, "spenta la regola (misura C19), il nome scelto torna");
});

// Spec §13.13.2: il prezzo di non indovinare dal nome (G2). Una porta fisica rinominata dal cliente su un MikroTik non dà cavi
// dalle righe del router; il cavo resta se l'altro capo è uno switch che lo vede, con la porta del router non nota.
test("Review Focus 8 — una porta fisica rinominata su un MikroTik: il cavo resta dal lato dello switch, la porta del router non nota", () => {
  const i = input({
    devices: [rtr(1), dev(5, { name: "SW-5", via: "api" })],
    ports: [porta(5, 9, "Port 9", "10000 Mbps")],
    neighbors: [
      nb(1, { local_port: "uplink-core", remote_device_name: "SW-5", remote_port: "Port 9", remote_ip: "10.0.0.5", protocol: "lldp", timestamp: ORA }),
      nb(5, { local_port: "Port 9", remote_device_name: "RTR-1", remote_port: "uplink-core", remote_ip: "10.0.0.1", protocol: "lldp", remote_platform: "MikroTik", source: "unifi", timestamp: ORA_CONTROLLER }),
    ],
  });
  assert.deepEqual(run(i).links.map((l) => [l.a, l.aPort, l.b, l.bPort, l.sources]), [["dev:5", "Port 9", "dev:1", "", ["lldp"]]]);
});

// I60 (spec §13.6.4; §13.7.1 passi 2 e 3b). Nelle righe di RouterOS il MAC è dell'interfaccia che ha mandato l'annuncio, non il
// telaio: sulla rete B il router di frontiera sentirebbe il router su una porta con due MAC (uno dalla porta, uno da una VLAN),
// cioè due «apparati», e la porta diventerebbe un segmento falso che toglie un cavo provato.
test("I60 — gli apparati di una porta si contano per apparato: lo stesso router con due MAC e un nome che identifica è uno", () => {
  const riga = (mac: string, remote_port: string, remote_device_name = "RTR-TESTA") =>
    nb(21, { local_port: "sfp-sfpplus4", remote_device_name, remote_port, remote_mac: mac, protocol: "lldp", remote_platform: "MikroTik", timestamp: ORA });
  const solo21 = (righe: ModelNeighborRow[]) => input({
    devices: [dev(21, { name: "RTR-FRONTIERA", device_type: "router", vendor: "mikrotik", via: "ssh" })], ports: [porta(21, 4, "sfp-sfpplus4", "10000 Mbps")], neighbors: righe,
  });
  const stesso = solo21([riga("02:00:A0:00:00:01", "VL_88_X"), riga("02:00:A0:00:00:03", "BR_RP/sfp-sfpplus3")]);
  assert.equal(run(stesso).segmenti.size, 0, "un apparato: nessun segmento");
  assert.equal(senza(stesso, "conto-per-apparato").segmenti.size, 1, "contato per MAC (regola spenta): il segmento falso");
  // guardie di identity.ts e node-index.ts: un nome di fabbrica non identifica; MAC di OUI diversi sono due oggetti
  assert.equal(run(solo21([riga("02:00:A0:00:00:01", "ether1", "MikroTik"), riga("02:00:A0:00:00:03", "ether2", "MikroTik")])).segmenti.size, 1);
  assert.equal(run(solo21([riga("02:00:A0:00:00:01", "ether1"), riga("02:00:B7:00:00:03", "ether2")])).segmenti.size, 1);
  // il controller dà il telaio: due telai restano due apparati anche col nome uguale
  const ctrl = input({ devices: [dev(5, { name: "SW-5", via: "api" })], neighbors: [
    nb(5, { local_port: "Port 3", remote_device_name: "AP-X", remote_mac: "02:00:A0:00:00:01", source: "unifi" }),
    nb(5, { local_port: "Port 3", remote_device_name: "AP-X", remote_mac: "02:00:A0:00:00:05", source: "unifi" }),
  ] });
  assert.equal(run(ctrl).segmenti.size, 1);
});

test("I60 — sul membro di un fascio l'aggregazione via LLDP e tre apparati via CDP inoltrato (scritti `mndp`): un cavo, non un segmento", () => {
  const AGG = "02:00:00:00:00:11";
  const i = input({
    devices: [rtr(1), dev(11, { name: "AGG-11", controller_mac: AGG, via: "api" }), dev(31), dev(32), dev(33)],
    knownMacs: [{ device_id: 1, mac: RTR_MAC }],
    ports: [porta(1, 1, "sfp28-1", "25000 Mbps"), porta(11, 32, "SFP28 32", "25000 Mbps")],
    neighbors: [
      nb(1, { local_port: "sfp28-1,bond1,BR_RP", remote_device_name: "AGG-11", remote_port: "SFP28 32", remote_mac: AGG, protocol: "lldp", timestamp: ORA }),
      // l'aggregazione vede il router sulla sua porta 32 (conferma per porta, passo 3c): le righe CDP inoltrate contano per
      // l'«unico vicino» (§11.1, come prima), non per il segmento
      nb(11, { local_port: "SFP28 32", remote_device_name: "RTR-1", remote_port: "sfp28-1", remote_mac: RTR_MAC, source: "unifi", timestamp: ORA_CONTROLLER }),
      ...[31, 32, 33].map((k) => nb(1, { local_port: "sfp28-1,bond1,BR_RP", remote_device_name: `SW-${k}`, remote_ip: `10.0.0.${k}`, remote_port: "ether1", protocol: "mndp", remote_platform: "MikroTik", timestamp: ORA })),
    ],
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  assert.deepEqual(links.filter((l) => l.b === "dev:11" || l.a === "dev:11").map((l) => [l.aPort, l.bPort]), [["sfp28-1", "SFP28 32"]]);
});

// I61 (spec §13.7.3, G5): una VLAN su più porte d'accesso di un bridge gestito non è un segmento. Rete B e cliente A: la WAN
// come VLAN dentro il bridge del router, su più porte d'accesso, un apparato ciascuna. Passa già (la regola c'è dal §13.7.3):
// è la prova che la tiene.
test("I61 — la stessa VLAN su sei porte d'accesso del router: sei cavi, nessun segmento", () => {
  const k6 = [1, 2, 3, 4, 5, 6];
  const i = input({
    devices: [rtr(1)],
    hosts: k6.map((k) => host(30 + k, { ip: `10.0.2.${k}`, mac: `02:00:00:00:0b:0${k}`, hostname: `MODEM-${k}`, classification: "router" })),
    ports: k6.map((k) => porta(1, k, `sfp-sfpplus${k}`, "1000 Mbps")),
    neighbors: k6.flatMap((k) => [
      nb(1, { local_port: `sfp-sfpplus${k},BR_RP`, remote_device_name: `MODEM-${k}`, remote_port: "eth0", remote_mac: `02:00:00:00:0b:0${k}`, protocol: "lldp", timestamp: ORA }),
      nb(1, { local_port: "VL_9_WAN", remote_device_name: `MODEM-${k}`, remote_port: "eth0", remote_mac: `02:00:00:00:0b:0${k}`, protocol: "mndp", timestamp: ORA }),
    ]),
  });
  const { links, segmenti } = run(i);
  assert.equal(segmenti.size, 0);
  assert.deepEqual(links.map((l) => [l.aPort, l.bPort]), k6.map((k) => [`sfp-sfpplus${k}`, "eth0"]));
});
```

In testa a `links.test.ts`, accanto agli altri import: `import { REGOLE_T1, type RegolaUniversale } from "@/lib/topology/regole";` (il nome `dueRouter` c'è già nel file, per la prova M-5: l'aiuto nuovo si chiama `testaEFrontiera`).

In fondo a `src/lib/topology/__tests__/cavi-senza-prodotti.test.ts` (Task 3), la prova I37 anche sul codice di `links.ts` (revisione finale del 15/10, verifica UV2: `links.ts` sceglieva il traduttore del lato remoto con un'espressione sulla marca, copia di quella di `traduci.ts`; la spec §13.5.1 dice che la logica legge solo i fatti, «lo controlla la prova I37», ma I37 guardava solo `cavi/`):

```ts
/**
 * I37 anche per la logica dei collegamenti di T1 (spec §13.5.1: «links.ts in T1, cavi/ da T2, legge solo quei fatti»).
 * Verifica del 15/10: links.ts sceglieva il traduttore del lato remoto con un'espressione sulla marca, copia di quella di
 * traduci.ts. Nel CODICE di links.ts (i commenti possono dire da dove vengono i fatti) nessun nome di prodotto né forma di
 * porta; restano i valori delle colonne del DB che il modello legge così come sono scritti: la fonte «unifi», la fonte del
 * collegamento «unifi_uplink» e il protocollo «mndp».
 */
const LINKS = path.join(__dirname, "..", "links.ts");
const VALORI_DEL_DB = /["'`](?:mndp|unifi|unifi_uplink)["'`]/g;
function codiceDi(testo: string): string {
  return testo.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, "")).replace(/(^|[^:\\])\/\/.*$/gm, "$1").replace(VALORI_DEL_DB, '""');
}

test("la prova di links.ts lascia i commenti e i valori del DB, e trova una marca nel codice", () => {
  assert.deepEqual(formeDiProdotto(codiceDi('// un MikroTik letto via SSH\nconst f = "unifi";\nconst p = n.protocol === "mndp";')), []);
  assert.equal(formeDiProdotto(codiceDi("const m = /mikrotik/i.test(c.piattaforma);")).length > 0, true);
  assert.equal(formeDiProdotto(codiceDi('const b = porta.endsWith(",bridge");')).length > 0, true);
});

test("I37 — nel codice di links.ts nessun nome di prodotto né forma di porta", () => {
  assert.deepEqual(formeDiProdotto(codiceDi(fs.readFileSync(LINKS, "utf8"))), []);
});
```

Sul modello intero (velocità per chiave, C9 e H9), in fondo a `src/lib/topology/__tests__/link-attrs.test.ts`:

```ts
// Spec §13.6.1: la velocità di una linea è la minima delle due porte trovate per CHIAVE. Prima si cercava per nome
// normalizzato, e «SFP_ 17 - x» (tabella LLDP del controller) non trovava «SFP+ 17 - x» (elenco delle porte): sull'hub
// tre hypervisor finivano sotto lo switch di gestione a 2,5G invece che sotto l'aggregazione a 10G (H9); sul cliente A
// i cavi 8 e 9 di core 2 non avevano velocità (C9).
test("velocità per chiave: «SFP_ 17 - x» del controller trova «SFP+ 17 - x» nell'elenco; «Port N» remota trova l'indice N", () => {
  const i = baseInput({
    devices: [dev(11, { name: "AGG-11", via: "api" }), dev(4, { name: "HV-4", device_type: "hypervisor", vendor: "proxmox" })],
    ports: [{ device_id: 11, port_index: 17, port_name: "SFP+ 17 - nodo-a", speed: "10000 Mbps", status: "up", stp_state: null }],
    neighbors: [{ device_id: 11, local_port: "SFP_ 17 - nodo-a", remote_device_name: "HV-4", remote_port: "enp1s0", protocol: "lldp", remote_ip: "10.0.0.4", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" }],
  });
  const l = buildTopologyModel(i).links.find((x) => x.id === "link:dev:11|dev:4")!;
  assert.deepEqual([l.a === "dev:11" ? l.aPort : l.bPort, l.speedMbps], ["SFP+ 17 - nodo-a", 10000]);
});

// I70 (spec §13.6.1, «Un nome doppio con una velocità sola»; H13). Un nome che corrisponde a più porte non dice la porta (I14),
// ma se tutte hanno la stessa velocità la velocità sì. Rete B: il cavo dati di un hypervisor sta su un nome di due porte a 10G,
// e senza velocità l'hypervisor andava sotto la sua porta di gestione a 1G.
test("I70 — un nome doppio con una velocità sola dà la velocità; con due velocità no; spenta la regola, come prima", () => {
  const conPorte = (v2: string) => baseInput({
    devices: [dev(11, { name: "AGG-11", via: "api" }), dev(4, { name: "HV-4", device_type: "server", vendor: "proxmox" })],
    ports: [
      { device_id: 11, port_index: 15, port_name: "SFP+ 15", speed: "10000 Mbps", status: "up", stp_state: null },
      { device_id: 11, port_index: 16, port_name: "SFP+ 15", speed: v2, status: "up", stp_state: null },
    ],
    neighbors: [{ device_id: 11, local_port: "SFP+ 15", remote_device_name: "HV-4", remote_port: "enp1s0", protocol: "lldp", remote_ip: "10.0.0.4", remote_mac: null, timestamp: "2026-10-13 03:00:00", source: "unifi" }],
  });
  const velocita = (i: ReturnType<typeof conPorte>, regole?: Regole) => buildTopologyModel(i, regole).links.find((x) => x.id === "link:dev:11|dev:4")?.speedMbps;
  assert.equal(velocita(conPorte("10000 Mbps")), 10000);
  assert.equal(velocita(conPorte("1000 Mbps")), null);
  assert.equal(velocita(conPorte("10000 Mbps"), new Set()), null, "regola spenta (misura C19): come prima");
});
```

(in `link-attrs.test.ts` aggiungere gli import di `buildTopologyModel` da `@/lib/topology/model`, di `baseInput`, `dev` da `./support/righe`, se mancano, e `import type { Regole } from "@/lib/topology/regole";`.)

In `src/lib/topology/__tests__/attach.test.ts`, l'aiuto `run` (righe 33-37) diventa:

```ts
function run(i: TopologyModelInput) {
  const idx = buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors);
  const { links, ignored, segmenti } = buildLinks(i, idx);
  return { links, ...attachMacs(i, idx, links, { ignored, segmenti }) };
}
```

e in fondo:

```ts
// Spec §13.7.1 passo 2 e §13.3.1 riga 3: una porta che sente due o più apparati non dà linee verso di loro, nemmeno dalla
// tabella MAC. Sull'hub gli switch di laboratorio (solo host) sulla porta 5 dello switch 48 PoE vanno in «Da sistemare» (H5).
test("porta di segmento: la tabella MAC non rifà la linea verso chi la porta sente via LLDP; un client sulla stessa porta resta", () => {
  const LAB1 = "02:00:00:00:0a:01", LAB2 = "02:00:00:00:0a:02", PC = "02:00:00:00:0a:09";
  const i = baseInput({
    devices: [dev(2, { name: "SW-48POE", host: "10.0.0.2", via: "api" })],
    hosts: [
      host(31, { ip: "10.0.1.31", mac: LAB1, hostname: "LAB-SW-1", classification: "switch" }),
      host(32, { ip: "10.0.1.32", mac: LAB2, hostname: "LAB-SW-2", classification: "switch" }),
      host(39, { ip: "10.0.1.39", mac: PC, hostname: "PC-39", classification: "workstation" }),
    ],
    neighbors: [
      { device_id: 2, local_port: "Port 5", remote_device_name: "LAB-SW-1", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: LAB1, timestamp: RECENTE, source: "unifi" },
      { device_id: 2, local_port: "Port 5", remote_device_name: "LAB-SW-2", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: LAB2, timestamp: RECENTE, source: "unifi" },
    ],
    macPorts: [mp(2, LAB1, "Port 5"), mp(2, LAB2, "Port 5"), mp(2, PC, "Port 5")],
  });
  const r = run(i);
  assert.deepEqual([...r.links, ...r.attachLinks], [], "nessuna linea verso gli switch di laboratorio");
  assert.deepEqual(r.portClients.map((p) => [p.nodeId, p.port, p.clients.map((c) => c.nodeId)]), [["dev:2", "Port 5", ["host:39"]]]);
});

// Spec §13.3 e H5: chi resta senza collegamenti per la regola del segmento va in «Da sistemare» («nessun collegamento»).
// Revisione del piano (15/10): `isolated` prendeva solo apparati, attaccati e hypervisor, e gli switch di laboratorio
// dell'hub (host classificati switch) diventavano tre radici sole della mappa automatica. Solo i membri di un segmento:
// un host isolato per altri motivi resta com'era (sul cliente A la radio lontana a 60 GHz è e resta la seconda radice, C16).
test("H5 — gli host classificati switch che la regola del segmento lascia senza linee sono «Da sistemare», non radici sole", () => {
  const LAB1 = "02:00:00:00:0a:01", LAB2 = "02:00:00:00:0a:02";
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1", vendor: "mikrotik", via: "ssh" }), dev(2, { name: "SW-48POE", host: "10.0.0.2", via: "api" })],
    hosts: [
      host(31, { ip: "10.0.1.31", mac: LAB1, hostname: "LAB-SW-1", classification: "switch" }),
      host(32, { ip: "10.0.1.32", mac: LAB2, hostname: "LAB-SW-2", classification: "switch" }),
    ],
    neighbors: [
      { device_id: 2, local_port: "Port 24", remote_device_name: "RTR-1", remote_port: "ether2", protocol: "lldp", remote_ip: "10.0.0.1", remote_mac: null, timestamp: RECENTE, source: "unifi" },
      // Il router letto via SSH ha le sue righe (la forma vera): così la prova regge anche con T1b, che vuole una prova di ruolo.
      { device_id: 1, local_port: "ether2", remote_device_name: "SW-48POE", remote_port: "Port 24", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: RECENTE, source: "device" },
      { device_id: 2, local_port: "Port 5", remote_device_name: "LAB-SW-1", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: LAB1, timestamp: RECENTE, source: "unifi" },
      { device_id: 2, local_port: "Port 5", remote_device_name: "LAB-SW-2", remote_port: "Port 1", protocol: "lldp", remote_ip: null, remote_mac: LAB2, timestamp: RECENTE, source: "unifi" },
    ],
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(m.isolated.filter((id) => id.startsWith("host:")), ["host:31", "host:32"]);
  assert.deepEqual([...autoVisible(m)].sort(), ["dev:1", "dev:2"]);
});

// Verifica del piano sul dato dell'hub (15/10): il ripiego del router da una VLAN col nome scelto a mano («VL_…») appendeva
// un hypervisor al router. Per un router col traduttore del suo prodotto il ripiego vuole `fisica: true`; col generico,
// come prima, basta che la porta non sia logica.
test("ripiego del router: da un'interfaccia che il traduttore del prodotto non riconosce, niente", () => {
  const mk = dev(1, { name: "RTR-1", device_type: "router", host: "10.0.0.1", vendor: "mikrotik", via: "ssh" });
  const i = (router: typeof mk, porta: string) => input({
    devices: [router, dev(2), dev(3), dev(7, { name: "SRV-7", device_type: "server", host: "10.0.1.7" })],
    knownMacs: [{ device_id: 7, mac: SRV_MAC }],
    macPorts: [mp(1, SRV_MAC, porta)],
  });
  assert.deepEqual(run(i(mk, "VL_2_UFFICI")).attachLinks, []);
  assert.deepEqual(run(i(mk, "ether7")).attachLinks.map((l) => [l.a, l.aPort, l.b]), [["dev:1", "ether7", "dev:7"]]);
  assert.deepEqual(run(i(RTR, "VL_2_UFFICI")).attachLinks.map((l) => [l.a, l.aPort, l.b]), [["dev:1", "VL_2_UFFICI", "dev:7"]]);
});
```

(in testa ad `attach.test.ts`, `import { autoVisible } from "@/lib/topology/tree";`.)

Sulle fixture riestratte, in fondo a `src/lib/topology/__tests__/model-fixtures.test.ts` (import di `computeMapView` da `@/lib/topology/map-compute`):

```ts
// T1 (spec §13.3.1, §13.3.3) sulle fixture riestratte dal Task 7: chiave della porta, segmenti e conferma per porta girano
// sulla forma vera. Id (interi del DB, non identificano nessuno): cliente A router 1 = dev:1, accesso A = dev:112,
// core 1 = dev:114; hub router = dev:1, aggregazione = dev:11, access point = dev:191.
const alberoDa = (m: ReturnType<typeof buildTopologyModel>, testa: string) =>
  computeMapView(m, { auto: true, members: [], roots: [], head: testa, tweaks: [], expanded: new Set(), orientation: "lr" }).tree;
const padreDi = (t: ReturnType<typeof alberoDa>, id: string): string | null => {
  for (const [p, figli] of t.children) if (figli.includes(id)) return p;
  return null;
};

test("cliente A senza correzioni (S1): core 1 figlio di router 1 sul cavo sfp-sfpplus1 a 10G; accesso A sotto core 1 (C1)", () => {
  const m = buildTopologyModel({ ...carica("topologia-cliente-a.json"), overrides: [] });
  const t = alberoDa(m, "dev:1");
  assert.equal(padreDi(t, "dev:114"), "dev:1");
  assert.equal(padreDi(t, "dev:112"), "dev:114");
  const l = t.via.get("dev:114")!;
  assert.deepEqual([l.a === "dev:1" ? l.aPort : l.bPort, l.speedMbps], ["sfp-sfpplus1", 10000]);
});

test("cliente A, S3 (senza l'uplink di core 1): core 1 resta sotto router 1, 10G contro 2,5G (C3)", () => {
  const i = carica("topologia-cliente-a.json");
  const s3 = { ...i, overrides: [], devices: i.devices.map((d) => (d.id === 114 ? { ...d, uplink_mac: null, uplink_remote_port: null } : d)), uplinkPorts: i.uplinkPorts.filter((p) => p.device_id !== 114) };
  assert.equal(padreDi(alberoDa(buildTopologyModel(s3), "dev:1"), "dev:114"), "dev:1");
});

test("hub: router–aggregazione sulle porte di un cavo solo, porta 31 ↔ sfp28-2 (H2)", () => {
  const l = buildTopologyModel(carica("topologia-domarc.json")).links.find((x) => x.id === "link:dev:1|dev:11")!;
  const [agg, rtrPorta] = l.a === "dev:11" ? [l.aPort, l.bPort] : [l.bPort, l.aPort];
  assert.equal(rtrPorta, "sfp28-2");
  assert.match(agg, /^SFP28 31( - |$)/);
});

test("hub: il client dell'access point sulla sua interfaccia senza fili resta collegato, «≋ Wi-Fi» (H10)", () => {
  const l = buildTopologyModel(carica("topologia-domarc.json")).links.find((x) => (x.a === "dev:191" && x.aPort === "wifi2ap9") || (x.b === "dev:191" && x.bPort === "wifi2ap9"));
  assert.ok(l);
  assert.equal(l.medium, "wireless");
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/links.test.ts src/lib/topology/__tests__/attach.test.ts src/lib/topology/__tests__/link-attrs.test.ts > "$SCRATCH/t1-7.log" 2>&1; echo "exit=$?"`
Expected: `exit=1` (export mancante `righeUltimoGiro`; `segmenti` assente; le prove nuove rosse). Le prove sulle fixture si vedono rosse dopo la riestrazione (Step 4). Verificato sul prototipo del piano (15/10 notte), sopra il codice di questo task senza le tre regole universali: rosse I58/H7, «Review Focus 8», la prima I60 e I70; verdi la seconda I60 (il membro di un fascio: tiene il conto coi soli annunci di collegamento, G4, non la regola `conto-per-apparato`; verifica UV2 del 15/10) e I61, che fissano regole già scritte (§13.7.3). Sul `links.ts` del Task 3 è rossa anche «I37 — nel codice di links.ts…» (importa il traduttore MikroTik): `node --import tsx --test src/lib/topology/__tests__/cavi-senza-prodotti.test.ts` → `exit=1`, verde dopo lo Step 3.

- [ ] **Step 3: il codice** — `src/lib/topology/links.ts`, intero:

```ts
/**
 * Collegamenti della mappa (spec §3 e §13.7.1, tappa T1): correzioni a mano, uplink del controller, LLDP/CDP/MNDP. Una
 * linea per coppia di oggetti (lo resta fino a T3), con le DUE PORTE PRESE DA UNA PROVA SOLA: il 14/10 la linea
 * «porta 10 ↔ ether8» cuciva la porta di core 1 dell'uplink con la prima riga del router in ordine, e l'«Ignora» su quella
 * linea ha tolto anche il cavo vero a 10G (D1, D3). Passi (§13.7.1): 0. solo l'ultimo giro di ogni vicino (R-superata);
 * 1. la porta locale per chiave, sul nome tradotto: da un'interfaccia logica nessun cavo; 2. una porta che sente due o
 * più apparati via LLDP o CDP è di segmento: non dà cavi, non presta porte, non conferma; 3. i candidati, con l'uplink
 * completato dalla riga del figlio, le righe raggruppate per apparato e la conferma per porta dei router; 5. una linea
 * per coppia con le porte di un candidato solo, gli altri cavi nei dettagli («Altri cavi visti fra questi due oggetti»).
 * I nomi dei prodotti stanno nei traduttori (lettori/): qui solo fatti neutri. Un collegamento che sparisce non si
 * cancella: dopo `staleDays` è «non visto». Logica pura.
 */
import { parseDbDate } from "@/lib/db-date";
import { chiavePorta, elenchiPorte, normale, type Porta } from "@/lib/topology/cavi/porte";
import { identifiesByName, isVirtualMac, realOui } from "@/lib/topology/identity";
import { haTraduttore, haTraduttoreRemoto, macDelTelaio, traduciPorta, type ComeLetto } from "@/lib/topology/lettori/traduci";
import {
  LINK_ATTRS_DEFAULT, LINK_SOURCE_RANK,
  type AltroCavo, type LinkSource, type MapLink, type ModelNeighborRow, type TopologyModelInput, type UnmatchedNeighbor,
} from "@/lib/topology/model-types";
import { canonical, nameKey, nodeFor, resolveNode, type NodeIndex } from "@/lib/topology/node-index";
import { REGOLE_T1, type Regole } from "@/lib/topology/regole";
import type { RunningVmMacs } from "@/lib/topology/vm-ports";
import { normalizeMacForStorage } from "@/lib/utils";

export const DEFAULT_STALE_DAYS = 2;
const DAY_MS = 86_400_000;
/** Il margine di un giro di letture, come NEIGHBORS_LATEST_ROUND_SQL (db-tenant.ts): 5 minuti. */
const GIRO_MS = 5 * 60_000;

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function timeOf(s: string | null): number | null {
  if (!s) return null;
  const t = parseDbDate(s).getTime();
  return Number.isNaN(t) ? null : t;
}

function sourceOfProtocol(p: string): LinkSource {
  if (p === "cdp") return "cdp";
  if (p === "mndp") return "mndp";
  return "lldp";
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const perRango = (x: LinkSource, y: LinkSource): number => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || cmp(x, y);

function isRouterNode(idx: NodeIndex, id: string): boolean {
  const t = idx.nodes.get(id)?.type;
  return t === "router" || t === "firewall";
}

function aggiungiA<V>(m: Map<string, V[]>, k: string, v: V): void {
  const x = m.get(k);
  if (x) x.push(v);
  else m.set(k, [v]);
}

function aggiungiIn<V>(m: Map<string, Set<V>>, k: string, v: V): void {
  const x = m.get(k);
  if (x) x.add(v);
  else m.set(k, new Set([v]));
}

/** Come si è letta una porta (spec §13.6.1): `vendor` e `via` sono dell'apparato a cui la porta appartiene. */
export function comeDi(input: Pick<TopologyModelInput, "devices">): (nodo: string | null, fonte: string, piattaforma: string | null) => ComeLetto {
  const d = new Map(input.devices.map((x) => [`dev:${x.id}`, x]));
  return (nodo, fonte, piattaforma) => {
    const r = nodo ? d.get(nodo) : undefined;
    return { vendor: r?.vendor ?? null, via: r?.via ?? null, fonte, piattaforma };
  };
}

/**
 * La porta di un apparato come la scrive lui (correzioni a mano, tabella MAC, VM): tradotta e con la chiave. Le porte di
 * un apparato del controller col traduttore del controller.
 */
export function portaLocale(input: TopologyModelInput): (nodo: string, nome: string) => Porta | null {
  const come = comeDi(input);
  const elenchi = elenchiPorte(input.ports ?? []);
  const delController = new Set(input.devices.filter((d) => d.controller_mac).map((d) => `dev:${d.id}`));
  return (nodo, nome) => (nome.trim() === ""
    ? null
    : chiavePorta(nodo, traduciPorta(nome, "locale", come(nodo, delController.has(nodo) ? "unifi" : "device", null)), "locale", elenchi.get(nodo)));
}

/** L'apparato remoto di una riga: il telaio (un MAC vero; un MAC VRRP non identifica nessuno), altrimenti il nome. */
function telaio(n: ModelNeighborRow): string {
  const mac = normalizeMacForStorage(n.remote_mac);
  if (mac && !isVirtualMac(mac)) return `mac:${mac}`;
  const nome = n.remote_device_name.trim().toLowerCase();
  return nome ? `nome:${nome}` : `riga:${n.remote_ip ?? ""}|${n.remote_port}`;
}

/**
 * Passo 0, R-superata: per apparato, fonte, porta locale (tradotta) e apparato remoto contano solo le righe dell'ultimo
 * giro di quel gruppo, dal timestamp più recente meno 5 minuti. Una riga troncata («Port») è superata dalla riga nuova
 * («Port 47») dello stesso apparato sulla stessa porta. Un vicino sparito del tutto non è superato: invecchia e diventa
 * «non visto» (ADR 0008). Una riga senza data leggibile resta.
 */
export function righeUltimoGiro(input: Pick<TopologyModelInput, "neighbors" | "devices">): ModelNeighborRow[] {
  const come = comeDi(input);
  const gruppi = new Map<string, ModelNeighborRow[]>();
  for (const n of input.neighbors) {
    const locale = traduciPorta(n.local_port, "locale", come(`dev:${n.device_id}`, n.source, n.remote_platform ?? null));
    aggiungiA(gruppi, `${n.device_id}|${n.source}|${normale(locale.nome)}|${telaio(n)}`, n);
  }
  const out: ModelNeighborRow[] = [];
  for (const g of gruppi.values()) {
    const tempi = g.map((n) => timeOf(n.timestamp)).filter((t): t is number => t !== null);
    const max = tempi.length > 0 ? Math.max(...tempi) : null;
    for (const n of g) {
      const t = timeOf(n.timestamp);
      if (t === null || max === null || t >= max - GIRO_MS) out.push(n);
    }
  }
  return out;
}

/** Le righe di un apparato remoto sulla stessa porta locale (spec §13.6.2): una prova sola. */
interface Gruppo {
  osservatore: string;
  locale: Porta;
  righe: ModelNeighborRow[];
  telaio: string;
  b: string | null;
  /** La porta remota (la certamente fisica fra le righe); null = non nota, l'apparato annuncia solo da una VLAN o una VRRP. */
  remota: Porta | null;
  /** LLDP o CDP (o un valore sconosciuto, che vale come LLDP): un annuncio che non attraversa un apparato gestito. */
  collegamento: boolean;
  source: LinkSource;
  lastSeen: string | null;
}

interface Candidato {
  a: string;
  aPorta: Porta | null;
  b: string;
  bPorta: Porta | null;
  source: LinkSource;
  lastSeen: string | null;
  uplinkFrom: string | null;
  senzaFili: boolean;
}

export interface RisultatoCollegamenti {
  links: MapLink[];
  unmatched: UnmatchedNeighbor[];
  /** Le coppie ignorate a mano: per coppia fino al Task 9 del piano di T1, che le porta al cavo. */
  ignored: ReadonlySet<string>;
  /** Le porte di segmento (passo 2): «nodo|porta normalizzata» → gli oggetti abbinati che la porta sente via LLDP o CDP. */
  segmenti: ReadonlyMap<string, ReadonlySet<string>>;
}

const piuRecente = (xs: ReadonlyArray<string | null>): string | null =>
  xs.reduce<string | null>((acc, s) => ((timeOf(s) ?? -Infinity) > (timeOf(acc) ?? -Infinity) ? s : acc), null);

/**
 * Unisce i gruppi di righe di RouterOS dello stesso apparato sulla stessa porta locale (spec §13.6.4): stesso nome annunciato
 * che identifica e OUI dei MAC veri compatibili (al più uno). Il gruppo unito conta come un apparato (telaio «nome:…|OUI»);
 * due gruppi col nome uguale e OUI diversi restano due, ognuno col suo telaio.
 */
function unisciPerNome(gruppi: Map<string, Gruppo>, diInterfaccia: (g: Gruppo) => boolean): void {
  const perNome = new Map<string, string[]>();
  for (const [k, g] of gruppi) {
    if (!diInterfaccia(g)) continue;
    const nome = g.righe.map((n) => nameKey(n.remote_device_name)).find((x): x is string => !!x && identifiesByName(x));
    if (nome) aggiungiA(perNome, `${g.osservatore}|${g.locale.chiave ?? `?${normale(g.locale.nome)}`}|${nome}`, k);
  }
  const ouiDi = (g: Gruppo): Set<string> => new Set(g.righe.flatMap((n) => { const o = realOui(normalizeMacForStorage(n.remote_mac)); return o ? [o] : []; }));
  for (const [chiave, chiavi] of perNome) {
    if (chiavi.length < 2) continue;
    const nome = chiave.slice(chiave.lastIndexOf("|") + 1);
    const uniti: Gruppo[] = [];
    for (const k of chiavi) {
      const g = gruppi.get(k)!;
      const dove = uniti.find((u) => new Set([...ouiDi(u), ...ouiDi(g)]).size <= 1);
      if (!dove) {
        uniti.push(g);
        continue;
      }
      dove.righe.push(...g.righe);
      dove.telaio = `nome:${nome}|${[...ouiDi(dove)].sort().join(",")}`;
      gruppi.delete(k);
    }
  }
}

/** `regole`: le regole del passaggio universale accese (spec §13.16); le spegne solo la misura (C19). */
export function buildLinks(input: TopologyModelInput, idx: NodeIndex, vmAccese: RunningVmMacs = new Map(), regole: Regole = REGOLE_T1): RisultatoCollegamenti {
  const come = comeDi(input);
  const elenchi = elenchiPorte(input.ports ?? []);
  const locale = portaLocale(input);
  const unmatched: UnmatchedNeighbor[] = [];
  const candidati: Candidato[] = [];
  const ignored = new Set<string>();

  // Correzioni: «aggiungi» è un candidato a mano e vince sempre; «ignora» toglie la coppia (per cavo dal Task 9).
  for (const o of [...input.overrides].sort((x, y) => x.id - y.id)) {
    const a = nodeFor(idx, canonical(idx, o.a_node));
    const b = nodeFor(idx, canonical(idx, o.b_node));
    if (!a || !b || a === b) continue;
    if (o.action === "ignore") {
      ignored.add(pairKey(a, b));
      continue;
    }
    // Senza fili dalle porte tradotte, come per le righe dei vicini: con `false` fisso la porta «wifi» di un collegamento a
    // mano non era più sulla linea e il tipo «wireless» si perdeva (prova di oggi in link-attrs.test.ts, verifica del 15/10).
    const aPorta = locale(a, o.a_port), bPorta = locale(b, o.b_port);
    candidati.push({ a, aPorta, b, bPorta, source: "manual", lastSeen: null, uplinkFrom: null, senzaFili: aPorta?.senzaFili === true || bPorta?.senzaFili === true });
  }

  // Passi 0 e 3b: le righe dell'ultimo giro, raggruppate per apparato remoto (telaio) sulla stessa porta locale. Per
  // telaio e non per nodo abbinato: la riga VRRP della porta 10 di core 1 si abbinerebbe per IP a un altro nodo.
  const righe = righeUltimoGiro(input)
    .filter((n) => idx.nodes.has(`dev:${n.device_id}`))
    .sort((x, y) => x.device_id - y.device_id || cmp(x.local_port, y.local_port) || cmp(x.remote_device_name, y.remote_device_name)
      || cmp(x.remote_port, y.remote_port) || cmp(x.source, y.source));
  const gruppi = new Map<string, Gruppo>();
  for (const n of righe) {
    const osservatore = `dev:${n.device_id}`;
    const loc = chiavePorta(osservatore, traduciPorta(n.local_port, "locale", come(osservatore, n.source, n.remote_platform ?? null)), "locale", elenchi.get(osservatore));
    const t = telaio(n);
    const k = `${osservatore}|${loc.chiave ?? `?${normale(loc.nome)}`}|${t}`;
    const g = gruppi.get(k);
    if (g) g.righe.push(n);
    else gruppi.set(k, { osservatore, locale: loc, righe: [n], telaio: t, b: null, remota: null, collegamento: false, source: "mndp", lastSeen: null });
  }

  // Passo 3b, righe di RouterOS (spec §13.6.4, I60; regola «conto-per-apparato»): il MAC è quello dell'interfaccia che ha
  // mandato l'annuncio, non il telaio, e lo stesso router compare sulla stessa porta con più MAC (rete B: il router di
  // frontiera con quattro). Il gruppo si completa col nome annunciato, quando identifica (`identifiesByName`: niente nomi di
  // fabbrica, corti o esadecimali), salvo due gruppi con MAC veri di OUI diversi, che restano due (la regola di node-index.ts).
  // Le righe col MAC virtuale (VRRP) non hanno un OUI e si uniscono al nome. Il controller e SNMP danno il telaio: niente cambia.
  if (regole.has("conto-per-apparato")) unisciPerNome(gruppi, (g) => !macDelTelaio(come(g.osservatore, g.righe[0].source, null)));

  // L'abbinamento (§13.6.2, I15). Una riga sola da una porta remota fisica o non nota: come prima (IP, MAC, nome). Più righe
  // dello stesso apparato, o una riga sola da una VLAN o da una VRRP: telaio, poi nome; l'IP solo dalle righe la cui porta
  // remota non è un'interfaccia logica. La riga VRRP porta l'IP virtuale, che è di un altro nodo: anche da sola non si
  // abbina per IP (revisione del piano, 15/10).
  const abbina = (g: Gruppo): string | null => {
    const fisica = (n: ModelNeighborRow): boolean => traduciPorta(n.remote_port, "remoto", come(null, n.source, n.remote_platform ?? null)).fisica !== false;
    const r0 = g.righe[0];
    if (g.righe.length === 1 && fisica(r0)) return resolveNode(idx, { ip: r0.remote_ip, mac: r0.remote_mac, name: r0.remote_device_name });
    for (const n of g.righe) {
      const b = resolveNode(idx, { mac: n.remote_mac });
      if (b) return b;
    }
    for (const n of g.righe) {
      const b = resolveNode(idx, { name: n.remote_device_name });
      if (b) return b;
    }
    for (const n of g.righe) {
      if (!n.remote_ip || !fisica(n)) continue;
      const b = resolveNode(idx, { ip: n.remote_ip });
      if (b) return b;
    }
    return null;
  };
  for (const g of gruppi.values()) {
    g.b = abbina(g);
    g.collegamento = g.righe.some((n) => sourceOfProtocol(n.protocol) !== "mndp");
    g.source = g.righe.some((n) => sourceOfProtocol(n.protocol) === "lldp") ? "lldp" : g.collegamento ? "cdp" : "mndp";
    g.lastSeen = piuRecente(g.righe.map((n) => n.timestamp));
    if (g.b === null) {
      const r0 = g.righe[0];
      unmatched.push({ deviceNodeId: g.osservatore, localPort: r0.local_port, remoteName: r0.remote_device_name, remoteIp: r0.remote_ip, remoteMac: r0.remote_mac });
    }
  }

  // La porta remota: la certamente fisica fra le righe del gruppo; se le righe vengono solo da VLAN o VRRP, non è nota (il
  // router di riserva sulla porta 16 di accesso B). Per un apparato senza elenco, il nome vale come chiave solo se è
  // l'unico visto verso di lui (I46).
  const nomiVisti = new Map<string, Set<string>>();
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b || elenchi.has(b)) continue;
    for (const n of g.righe) {
      const l = traduciPorta(n.remote_port, "remoto", come(b, n.source, n.remote_platform ?? null));
      if (l.nome !== "" && l.fisica !== false) aggiungiIn(nomiVisti, b, normale(l.nome));
    }
  }
  const ordineFisica = (f: boolean | null): number => (f === true ? 0 : f === null ? 1 : 2);
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b) continue;
    const lette = g.righe
      .map((n) => ({ n, l: traduciPorta(n.remote_port, "remoto", come(b, n.source, n.remote_platform ?? null)), t: timeOf(n.timestamp) ?? 0 }))
      .filter((x) => x.l.nome !== "")
      .sort((x, y) => ordineFisica(x.l.fisica) - ordineFisica(y.l.fisica) || y.t - x.t || cmp(x.l.nome, y.l.nome));
    const scelta = lette[0];
    // G2 (spec §13.6.1): dal lato di un MikroTik un nome che il traduttore non riconosce (scelto dal cliente, «non noto») non è
    // una porta fisica: la porta remota resta non nota, come per una VLAN o una VRRP (regola «nome-scelto-non-fisico»).
    const sceltoRemoto = scelta !== undefined && scelta.l.fisica === null && scelta.l.senzaFili !== true && regole.has("nome-scelto-non-fisico")
      && haTraduttoreRemoto(come(b, scelta.n.source, scelta.n.remote_platform ?? null));
    g.remota = scelta && scelta.l.fisica !== false && !sceltoRemoto ? chiavePorta(b, scelta.l, "remoto", elenchi.get(b), null, nomiVisti.get(b)) : null;
  }

  // Passo 2: apparati per porta, via LLDP o CDP, entro la soglia «non visto» dalla lettura più recente dello stesso
  // apparato e della stessa fonte, uno per apparato (un hypervisor e le sue VM sono uno solo). Due o più: porta di
  // segmento (decisa in T1, §13.15 punto 2). Senza la finestra, dopo un ricablaggio la porta sentirebbe per 90 giorni il
  // vicino di ieri e quello di oggi, e diventerebbe di segmento togliendo il cavo vero (I43). Su una porta non nota non
  // si conta (I13).
  const ultima = new Map<string, number>();
  for (const n of righe) {
    const t = timeOf(n.timestamp);
    const k = `${n.device_id}|${n.source}`;
    if (t !== null) ultima.set(k, Math.max(ultima.get(k) ?? t, t));
  }
  const finestra = input.staleDays * DAY_MS;
  const fresca = (n: ModelNeighborRow): boolean => {
    const t = timeOf(n.timestamp);
    const u = ultima.get(`${n.device_id}|${n.source}`);
    return t === null || u === undefined || t >= u - finestra;
  };
  const ipervisori = new Set([...vmAccese.values()].flatMap((v) => (v.hypervisor ? [v.hypervisor] : [])));
  const apparato = (g: Gruppo): string => {
    const mac = g.telaio.startsWith("mac:") ? g.telaio.slice(4) : null;
    const h = (mac ? vmAccese.get(mac)?.hypervisor : null) ?? (g.b !== null && ipervisori.has(g.b) ? g.b : null);
    return h ? `nodo:${h}` : g.b ? `nodo:${g.b}` : g.telaio;
  };
  const contabile = (p: Porta): boolean => p.certa && (p.fisica === true || p.senzaFili === true);
  const sentiti = new Map<string, Set<string>>();
  const membri = new Map<string, Set<string>>();
  for (const g of gruppi.values()) {
    if (!contabile(g.locale) || g.b === g.osservatore) continue;
    if (!g.righe.some((n) => sourceOfProtocol(n.protocol) !== "mndp" && fresca(n))) continue;
    aggiungiIn(sentiti, `${g.osservatore}|${g.locale.chiave}`, apparato(g));
    if (g.b) aggiungiIn(membri, `${g.osservatore}|${normale(g.locale.nome)}`, g.b);
  }
  const diSegmento = new Set([...sentiti].filter(([, s]) => s.size >= 2).map(([k]) => k));
  const sulSegmento = (g: Gruppo): boolean => diSegmento.has(`${g.osservatore}|${g.locale.chiave}`);
  const segmenti = new Map<string, ReadonlySet<string>>();
  for (const g of gruppi.values()) {
    const k = `${g.osservatore}|${normale(g.locale.nome)}`;
    if (sulSegmento(g)) segmenti.set(k, membri.get(k) ?? new Set());
  }

  // Passo 3a: uplink del controller, dal figlio (chi esce) al padre. Se il controller non sa la porta del padre (un padre
  // che non è del controller, come il router), la porta viene dalla riga LLDP che il figlio ha sulla sua porta di uplink
  // verso lo stesso nodo: mai da un'altra porta, mai da una porta di segmento, mai da MNDP; se quella riga non c'è,
  // resta vuota. Prima la riempiva la prima riga del router in ordine (`ether8`): la porta cucita del 14/10 (I6).
  const uplinkPort = new Map<number, { index: number; name: string }>();
  for (const p of [...input.uplinkPorts].sort((x, y) => x.device_id - y.device_id || x.port_index - y.port_index)) {
    if (!uplinkPort.has(p.device_id)) uplinkPort.set(p.device_id, { index: p.port_index, name: p.port_name });
  }
  const gruppiDi = new Map<string, Gruppo[]>();
  for (const g of gruppi.values()) aggiungiA(gruppiDi, g.osservatore, g);
  for (const d of [...input.devices].sort((x, y) => x.id - y.id)) {
    if (!d.uplink_mac) continue;
    const a = `dev:${d.id}`;
    const b = resolveNode(idx, { mac: d.uplink_mac });
    if (!b || b === a) continue;
    const up = uplinkPort.get(d.id);
    // La porta di uplink è una riga dell'elenco delle porte (switch_ports): il suo indice è la chiave.
    const aPorta = up ? chiavePorta(a, traduciPorta(up.name, "locale", come(a, "unifi", null)), "locale", elenchi.get(a), up.index) : null;
    let bPorta: Porta | null = null;
    if (d.uplink_remote_port != null) {
      const nomeInElenco = elenchi.get(b)?.perIndice.get(d.uplink_remote_port);
      bPorta = chiavePorta(b, traduciPorta(nomeInElenco ?? `Port ${d.uplink_remote_port}`, "remoto", come(b, "unifi", null)), "remoto",
        elenchi.get(b), nomeInElenco !== undefined ? d.uplink_remote_port : null);
    } else if (aPorta?.chiave) {
      const k = aPorta.chiave;
      bPorta = (gruppiDi.get(a) ?? []).find((g) => g.b === b && g.collegamento && g.locale.chiave === k && !sulSegmento(g))?.remota ?? null;
    }
    candidati.push({ a, aPorta, b, bPorta, source: "unifi_uplink", lastSeen: d.uplink_seen_at, uplinkFrom: a, senzaFili: false });
  }

  // Passo 3c, conferma per porta (completa §11.1): una riga del router sulla sua porta P verso B è candidata se B è l'unico
  // oggetto su P (contando tutte le righe, MNDP compreso, come prima), oppure se B vede il router via LLDP, CDP o uplink del
  // controller su una sua porta che non è di segmento e con porta remota uguale a P. MNDP non conferma mai (M-5). Prima la
  // conferma era per coppia: la riga su `ether8` passava perché core 1 vede il router… sulla porta 10 (I4).
  const chiaveSu = (g: Gruppo): string => `${g.osservatore}|${g.locale.chiave ?? `?${normale(g.locale.nome)}`}`;
  const logica = (p: Porta): boolean => p.fisica === false && p.senzaFili !== true;
  /**
   * Passo 1 per le righe di un router (spec §13.6.1, §13.7.1; I58, H7; regola «nome-scelto-non-fisico»): per un router letto
   * col traduttore del suo prodotto (un MikroTik via SSH) «porta fisica» vuol dire `fisica: true` — un nome scelto dal
   * cliente («non noto») non lo è, né per l'«unico vicino» né per la conferma. Col traduttore generico (un router di un'altra
   * marca, letto via SNMP in T1) vale «non logica», come prima: senza fatti dal nome, un router di un'altra marca non perde i
   * cavi che ha. Le porte senza fili hanno le loro regole (sotto). Rete B: la linea fra il router e il router di frontiera
   * passava da una VLAN dal nome scelto, dove il secondo era l'unico vicino.
   */
  const portaDelRouter = (g: Gruppo): boolean => {
    if (g.locale.senzaFili === true) return true;
    const conTraduttore = regole.has("nome-scelto-non-fisico") && haTraduttore(come(g.osservatore, g.righe[0].source, null));
    return conTraduttore ? g.locale.fisica === true : g.locale.fisica !== false;
  };
  const vedeDaPortaFisica = (g: Gruppo): boolean => !logica(g.locale) && (!isRouterNode(idx, g.osservatore) || portaDelRouter(g));
  const nodiSu = new Map<string, Set<string>>();
  for (const g of gruppi.values()) if (g.b && g.b !== g.osservatore) aggiungiIn(nodiSu, chiaveSu(g), g.b);
  const conferme = new Set<string>(); // «router|chiave della sua porta|chi lo vede»
  for (const g of gruppi.values()) {
    if (g.b && g.collegamento && !sulSegmento(g) && vedeDaPortaFisica(g) && g.remota?.chiave) conferme.add(`${g.b}|${g.remota.chiave}|${g.osservatore}`);
  }
  for (const c of candidati) if (c.source === "unifi_uplink" && c.bPorta?.chiave) conferme.add(`${c.b}|${c.bPorta.chiave}|${c.a}`);
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b || b === g.osservatore || logica(g.locale) || sulSegmento(g)) continue; // passo 1 (I5) e passo 2 (I7)
    if (isRouterNode(idx, g.osservatore)) {
      if (g.locale.nome === "" || !portaDelRouter(g)) continue;
      const diretto = (nodiSu.get(chiaveSu(g))?.size ?? 0) === 1;
      const confermato = g.locale.chiave !== null && conferme.has(`${g.osservatore}|${g.locale.chiave}|${b}`);
      // Una porta senza fili del router ha le regole di una porta fisica, ma vuole la conferma (§13.6.2).
      if (!confermato && (!diretto || g.locale.senzaFili === true)) continue;
    }
    candidati.push({
      a: g.osservatore, aPorta: g.locale.nome ? g.locale : null, b, bPorta: g.remota, source: g.source, lastSeen: g.lastSeen,
      uplinkFrom: null, senzaFili: g.locale.senzaFili === true || g.remota?.senzaFili === true,
    });
  }

  // Passo 5: una linea per coppia, con le porte di un candidato solo (sostituisce ADR 0008 punto 11).
  const perCoppia = new Map<string, Candidato[]>();
  for (const c of candidati) {
    const k = pairKey(c.a, c.b);
    if (!ignored.has(k)) aggiungiA(perCoppia, k, c);
  }
  const links = [...perCoppia].map(([k, cs]) => lineaDellaCoppia(k, cs)).sort((x, y) => cmp(x.id, y.id));
  for (const l of links) {
    const t = timeOf(l.lastSeen);
    if (l.sources.includes("manual") || t === null) {
      l.stale = false;
      l.daysUnseen = null;
      continue;
    }
    const age = Math.max(0, input.nowMs - t);
    l.daysUnseen = Math.floor(age / DAY_MS);
    l.stale = age > input.staleDays * DAY_MS;
  }
  return { links, unmatched, ignored, segmenti };
}

const chiaveDi = (p: Porta | null): string | null => p?.chiave ?? null;
const compatibili = (x: Porta | null, y: Porta | null): boolean => {
  const a = chiaveDi(x), b = chiaveDi(y);
  return a === null || b === null || a === b;
};
const piena = (p: Porta | null): boolean => !!p && p.nome.trim() !== "";

/**
 * La linea di una coppia (§13.7.1, passo 5): le due porte vengono da UN candidato — il migliore per rango fra quelli che
 * le hanno tutte e due; se nessuno, il migliore con una; a pari rango il cavo visto da più prove, poi il più recente.
 * Fonti e «visto» raccolgono solo i candidati dello stesso cavo (stesse porte, o porta vuota compatibile); gli altri sono
 * «Altri cavi visti fra questi due oggetti». Il verso (uplinkFrom) è della coppia. Il capo «a» è quello del primo
 * candidato, come prima.
 */
function lineaDellaCoppia(key: string, cs: readonly Candidato[]): MapLink {
  const a = cs[0].a, b = cs[0].b;
  const lati = (c: Candidato): { pa: Porta | null; pb: Porta | null } => (c.a === a ? { pa: c.aPorta, pb: c.bPorta } : { pa: c.bPorta, pb: c.aPorta });
  const stesso = (x: Candidato, y: Candidato): boolean => {
    const X = lati(x), Y = lati(y);
    return compatibili(X.pa, Y.pa) && compatibili(X.pb, Y.pb);
  };
  const livello = (c: Candidato): number => (piena(c.aPorta) && piena(c.bPorta) ? 0 : piena(c.aPorta) || piena(c.bPorta) ? 1 : 2);
  const firma = (c: Candidato): string => {
    const X = lati(c);
    return `${X.pa?.chiave ?? X.pa?.nome ?? ""}|${X.pb?.chiave ?? X.pb?.nome ?? ""}|${c.source}`;
  };
  const prove = (c: Candidato): number => cs.filter((d) => stesso(c, d)).length;
  const scelto = [...cs].sort((x, y) =>
    livello(x) - livello(y) || LINK_SOURCE_RANK[x.source] - LINK_SOURCE_RANK[y.source] || prove(y) - prove(x)
    || (timeOf(y.lastSeen) ?? 0) - (timeOf(x.lastSeen) ?? 0) || cmp(firma(x), firma(y)))[0];
  const stessi = cs.filter((c) => stesso(scelto, c));
  const sources = [...new Set(stessi.map((c) => c.source))].sort(perRango);
  const altri = new Map<string, AltroCavo>();
  for (const c of cs) {
    if (stesso(scelto, c)) continue;
    const X = lati(c);
    const k = `${X.pa?.chiave ?? X.pa?.nome ?? ""}|${X.pb?.chiave ?? X.pb?.nome ?? ""}`;
    const cur = altri.get(k) ?? { aPort: X.pa?.nome ?? "", bPort: X.pb?.nome ?? "", sources: [], lastSeen: null };
    if (!cur.sources.includes(c.source)) cur.sources = [...cur.sources, c.source].sort(perRango);
    cur.lastSeen = piuRecente([cur.lastSeen, c.lastSeen]);
    altri.set(k, cur);
  }
  const S = lati(scelto);
  const altriCavi = [...altri.values()].sort((x, y) => cmp(x.aPort, y.aPort) || cmp(x.bPort, y.bPort));
  return {
    id: `link:${key}`, a, aPort: S.pa?.nome ?? "", b, bPort: S.pb?.nome ?? "", source: sources[0], sources,
    uplinkFrom: cs.find((c) => c.uplinkFrom !== null)?.uplinkFrom ?? null, lastSeen: piuRecente(stessi.map((c) => c.lastSeen)),
    daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT,
    ...(stessi.some((c) => c.senzaFili) ? { medium: "wireless" as const } : {}),
    ...(altriCavi.length > 0 ? { altriCavi } : {}),
  };
}
```

`model-types.ts`: `AltroCavo` (sopra, «Interfaces») prima di `MapLink`; in `MapLink`, dopo `vmCount`:

```ts
  /** Gli altri cavi visti fra gli stessi due oggetti (spec §13.4.6): servono all'«Ignora» per cavo e alla verifica a mano. */
  altriCavi?: AltroCavo[];
```

in `MapNode`, dopo `proxmoxScan`: `/** La via di lettura dell'apparato (per i traduttori, spec §13.6.1); assente per un host. */ via?: string;`. In `node-index.ts:102-106` il nodo dell'apparato riceve `...(d.via ? { via: d.via } : {})` accanto a `proxmoxScan`.

`link-attrs.ts`: import `import { elenchiPorte, indiciInElenco, portaInElenco } from "@/lib/topology/cavi/porte";` e `import { REGOLE_T1, type Regole } from "@/lib/topology/regole";`; la firma diventa `export function enrichLinks(links: MapLink[], input: TopologyModelInput, idx: NodeIndex, regole: Regole = REGOLE_T1): void {`. `confirmManual` (`:78-92`), le prime righe:

```ts
export function confirmManual(link: MapLink, input: TopologyModelInput, idx: NodeIndex): boolean {
  const soglia = input.staleDays * DAY;
  // Un collegamento automatico non vecchio fra gli stessi oggetti: sulla linea o fra gli altri cavi visti. In T1 la
  // verifica resta per coppia (§11.3); per cavo da T3 (spec §13.9).
  const automatici = [
    ...(link.sources.some((s) => s !== "manual") ? [link.lastSeen] : []),
    ...(link.altriCavi ?? []).filter((c) => c.sources.some((s) => s !== "manual")).map((c) => c.lastSeen),
  ];
  for (const s of automatici) {
    const t = s ? parseDbDate(s).getTime() : NaN;
    if (Number.isNaN(t) || input.nowMs - t <= soglia) return true;
  }
  const { macsOf, onPort } = lookups(input, idx);
  // … (il resto com'è)
```

`enrichLinks` (`:95-131`): dopo `const portInfo = …` (`:96-97`):

```ts
  const elenchi = elenchiPorte(input.ports ?? []);
  // Il tipo della chiave va scritto: con `as const` diventa `dev:${number}|${number}` e la lettura con una stringa non compila.
  const velocitaPorta = new Map<string, string | null>((input.ports ?? []).map((p) => [`dev:${p.device_id}|${p.port_index}`, p.speed]));
  /**
   * La velocità di una porta per chiave (spec §13.6.1): l'indice nell'elenco delle porte dell'apparato. Per nome, «SFP_ N»
   * della tabella LLDP del controller non trovava «SFP+ N» dell'elenco: sull'hub tre hypervisor finivano sotto lo switch
   * di gestione a 2,5G invece che sotto l'aggregazione a 10G (H9). Senza elenco (prove e fixture di prima), per nome.
   */
  const velocita = (nodo: string, porta: string): number | null => {
    if (!porta.trim()) return null;
    const el = elenchi.get(nodo);
    if (el) {
      const i = portaInElenco(el, porta);
      if (i !== null) return parseSpeedMbps(velocitaPorta.get(`${nodo}|${i}`) ?? null);
      // Un nome doppio (spec §13.6.1, I70; regola «velocita-nomi-doppi»): la porta non si sa, ma se tutte le porte con quel
      // nome hanno la stessa velocità la velocità sì. Rete B: il cavo dati di un hypervisor su un nome di due porte a 10G (H13).
      if (!regole.has("velocita-nomi-doppi")) return null;
      const v = [...new Set(indiciInElenco(el, porta).map((k) => parseSpeedMbps(velocitaPorta.get(`${nodo}|${k}`) ?? null)))];
      return v.length === 1 ? v[0] : null;
    }
    const m = /^dev:(\d+)$/.exec(nodo);
    const r = m ? portInfo.get(`${m[1]}|${normalizePortNameForMatch(porta)}`) : undefined;
    return r ? parseSpeedMbps(r.speed) : null;
  };
```

e nel ciclo (`:116-118`, `:124`):

```ts
    const speeds = [velocita(l.a, l.aPort), velocita(l.b, l.bPort)].filter((v): v is number => v !== null);
    l.speedMbps = speeds.length ? Math.min(...speeds) : null;
    const rows = ends(l).map((e) => portInfo.get(`${e.deviceId}|${normalizePortNameForMatch(e.port)}`)).filter((r): r is NonNullable<typeof r> => !!r);
    const poe = rows.map((r) => (r.poe_power_mw ?? 0) / 1000).filter((v) => v > 0);
    l.poeW = poe.length ? Math.max(...poe) : null;
    // … wireless come prima …
    l.medium = mediumByPair.get(key) ?? (wireless || l.medium === "wireless" ? "wireless" : null); // senza fili dal traduttore (I47)
```

`attach.ts`: import `import { haTraduttore, traduciPorta, type ComeLetto } from "@/lib/topology/lettori/traduci";` al posto di `import { isPhysicalPort } from "@/lib/topology/links";`; `MapNode` fra i tipi importati da `model-types`. La firma:

```ts
export interface OpzioniAttacco {
  vmMacs?: ReadonlySet<string>;
  runningVmMacs?: RunningVmMacs;
  /** Le coppie ignorate a mano (`buildLinks`): non tornano da tabella MAC, ripiego del router, VM (I-3). */
  ignored?: ReadonlySet<string>;
  /** Le porte di segmento (`buildLinks`, §13.7.1 passo 2): da lì niente linee verso chi la porta sente via LLDP o CDP. */
  segmenti?: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Una porta del router è fisica per il suo traduttore (spec §13.6.1): la bridge host dà ether, sfp e bond. Un router col
 * traduttore del suo prodotto (MikroTik letto via SSH) conosce i nomi delle sue porte fisiche: un nome che il traduttore
 * non riconosce («VL_…», `fisica: null`) non è una porta del bridge host. Col traduttore generico vale «non logica», come
 * prima. Sull'hub, senza questa distinzione, il ripiego appendeva un hypervisor al router da una VLAN col nome scelto.
 */
function fisicaDelRouter(n: MapNode, porta: string): boolean {
  const come: ComeLetto = { vendor: n.vendor, via: n.via ?? null, fonte: "device", piattaforma: null };
  const f = traduciPorta(porta, "locale", come).fisica;
  return haTraduttore(come) ? f === true : f !== false;
}

export function attachMacs(input: TopologyModelInput, idx: NodeIndex, links: MapLink[], opzioni: OpzioniAttacco = {}):
  { portClients: PortClients[]; clientCount: Record<string, number>; attachLinks: MapLink[] } {
  const { vmMacs = new Set<string>(), runningVmMacs = new Map(), ignored = new Set<string>(), segmenti = new Map() } = opzioni;
  // … il corpo di prima, con questi due cambi:
```

1. riga 73: `const fisica = (n.type === "router" || n.type === "firewall") && fisicaDelRouter(n, r.port_name);`
2. nel ramo degli apparati (`:106-123`), subito prima di `const key = [best.node, other.id].sort().join("|");`:

```ts
      // Spec §13.7.1 passo 2 e §13.3.1 riga 3: una porta che sente due o più apparati non dà linee verso di loro, nemmeno
      // dalla tabella MAC. Il ripiego del router ha le sue regole (§11.1 bis) e non passa da qui.
      if (segmenti.get(portKey(best.node, best.port))?.has(other.id)) continue;
```

`model.ts:31-32`:

```ts
  const { links: baseLinks, unmatched, ignored, segmenti } = buildLinks(input, idx, runningVmMacs, regole);
  const { portClients, clientCount, attachLinks } = attachMacs(input, idx, baseLinks, { vmMacs, runningVmMacs, ignored, segmenti });
```

e più sotto `enrichLinks(links, input, idx);` diventa `enrichLinks(links, input, idx, regole);` (le regole del Task 6).

`model.ts`, `isolated` e `suspicious` (`:56-68`):

```ts
  // «Da sistemare» (spec §10.2): apparati senza collegamenti e oggetti attaccati (server, NAS, hypervisor) senza
  // collegamenti; da T1 anche chi la porta di un segmento sente e, per la regola del segmento, resta senza collegamenti
  // (H5: sull'hub gli switch di laboratorio, solo host, diventavano radici sole della mappa automatica; revisione del
  // piano, 15/10). Solo loro: un host isolato per altri motivi resta com'era (sul cliente A la radio lontana a 60 GHz
  // resta la seconda radice, C16). Un nodo che è una VM (spec §11.5) sta dentro il suo hypervisor: niente da sistemare.
  const membriDiSegmento = new Set([...segmenti.values()].flatMap((m) => [...m]));
  const isolated = nodes
    .filter((n) => !n.hidden && !vmNodeIds.has(n.id) && (degree.get(n.id) ?? 0) === 0
      && (n.kind === "device" || ["att", "hyper"].includes(nodeClass(n)) || membriDiSegmento.has(n.id)))
    .map((n) => n.id);
  // I tipi sospetti sono degli apparati: il numero di porte è di network_devices, e ora fra gli isolati può esserci un host.
  const suspicious = isolated.filter((id) => {
    const n = idx.nodes.get(id);
    return n !== undefined && n.kind === "device" && SUSPICIOUS_TYPES.includes(n.type) && (portCount.get(n.refId) ?? 0) === 0;
  });
```

e nell'oggetto ritornato, dopo `vms`: `segmenti: Object.fromEntries([...segmenti].map(([k, membri]) => [k, [...membri].sort()])),`. In `model-types.ts`, in `TopologyModel` dopo `vms`:

```ts
  /**
   * Le porte di segmento (spec §13.7.1 passo 2): «nodo|porta normalizzata» → gli oggetti che la porta sente via LLDP o CDP.
   * In T1 non si disegnano; le legge la misura (H5, H6, C8). Assente nei modelli costruiti a mano dalle prove.
   */
  segmenti?: Record<string, string[]>;
```

`misura.ts`, in `lineeCucite`, il ciclo degli uplink: la porta del padre è anche il nome che l'elenco dà all'indice (la linea la scrive così dal Task 7):

```ts
    if (y) {
      aggiungi(`dev:${d.id}`, primaPorta.get(d.id) ?? "", y, `Port ${d.uplink_remote_port}`);
      const nomeInElenco = (input.ports ?? []).find((p) => `dev:${p.device_id}` === y && p.port_index === d.uplink_remote_port)?.port_name;
      if (nomeInElenco) aggiungi(`dev:${d.id}`, primaPorta.get(d.id) ?? "", y, nomeInElenco);
    }
```

e in `conteggi`, dopo `cucite`: `porte_di_segmento: Object.keys(model.segmenti ?? {}).length,` (H6 si legge così: nessuna porta di segmento da «eth0»). `scripts/misura-cavi.ts`, nel blocco `--nomi`, prima di «— linee cucite —»:

```ts
    w("\n— porte di segmento: nessun cavo da lì (H5, H6, C8) —");
    for (const [k, membri] of Object.entries(model.segmenti ?? {})) {
      const [nodo, porta] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
      w(`${nome(nodo)} ${porta}: ${membri.map(nome).join(", ")}`);
    }
```

- [ ] **Step 4: riestrarre le fixture e verdi** — prima le prove sintetiche:

Run: `node --import tsx --test src/lib/topology/__tests__/links.test.ts src/lib/topology/__tests__/attach.test.ts src/lib/topology/__tests__/link-attrs.test.ts src/lib/topology/__tests__/vm-ports.test.ts src/lib/topology/__tests__/sites.test.ts > "$SCRATCH/t1-7.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`.

Poi le fixture. Prima lo script d'estrazione: la fixture non ha VM né host dei cluster (portano nomi, IP e MAC veri, e la prova della forma lo vieta: `FASE_2B_SEZIONI.vms: null`), ma dalla fase 2b le VM cambiano il modello. Confrontando col dato vero intero l'estrazione esce con 1 su tutte e due le copie, già col codice di prima (verifica del 15/10), e correggere `anonimizza.ts` non si può. Il confronto si fa quindi fra l'ingresso vero **senza le VM** e la fixture. In `src/lib/topology/anonimizza.ts`, in fondo:

```ts
/**
 * L'ingresso che una fixture può avere: senza le VM e gli host dei cluster, che portano nomi, IP e MAC veri dei clienti
 * (`FASE_2B_SEZIONI.vms: null` nella prova della forma). Lo script d'estrazione confronta i conteggi del modello su
 * questo e sulla fixture anonima: dalla fase 2b le VM cambiano il modello, e col dato vero intero il confronto falliva.
 */
export function ingressoDellaFixture(input: TopologyModelInput): TopologyModelInput {
  return { ...input, vms: [], scanHosts: [] };
}
```

in fondo a `src/lib/topology/__tests__/anonimizza.test.ts` (aggiungere `ingressoDellaFixture` all'import da `@/lib/topology/anonimizza`; `buildTopologyModel` è già importato):

```ts
// Revisione del piano (15/10): la fixture non ha VM, e dalla fase 2b le VM cambiano il modello. L'estrazione confronta la
// fixture con l'ingresso vero senza le VM: i conteggi del modello devono coincidere.
test("ingressoDellaFixture: senza VM né host dei cluster; la fixture anonima dà gli stessi conteggi del modello", () => {
  const conVm: TopologyModelInput = {
    ...VERO,
    vms: [{ scannedDeviceId: 1, vmid: 100, name: "vm-vera", node: "pve-vero", status: "running", type: "qemu", macs: ["02:00:00:aa:bb:09"], ips: ["192.0.2.9"], scannedAt: "2026-10-13T06:00:00.000Z" }],
    scanHosts: [{ scannedDeviceId: 1, hostname: "pve-vero", ips: ["192.0.2.9"], macs: [] }],
  };
  const r = ingressoDellaFixture(conVm);
  assert.deepEqual([r.vms, r.scanHosts], [[], []]);
  assert.deepEqual(buildTopologyModel(anonimizzaInput(r)).counts, buildTopologyModel(r).counts);
});
```

e in `scripts/estrai-fixture-topologia.ts` l'import diventa `const { anonimizzaInput, contaValoriVeri, ingressoDellaFixture, porteInChiaro } = await import("../src/lib/topology/anonimizza");` e le righe `:56-69` (da «// Tutti gli host» al primo `return 1;` con la sua graffa) diventano:

```ts
  // Tutti gli host: dalla fase 2 il modello conta ogni host come nodo (`nodes`) e i gruppi di host
  // fusi fra loro (`mergedHosts`), quindi togliere host «che non servono» cambierebbe i conteggi.
  // Le VM e gli host dei cluster invece no: portano nomi, IP e MAC veri e la fixture non li ha (prova della forma,
  // FASE_2B_SEZIONI.vms: null). Dalla fase 2b le VM cambiano il modello, quindi il confronto si fa fra l'ingresso vero
  // SENZA le VM e la fixture, e la differenza dovuta alle VM si stampa a parte (revisione del piano, 15/10: confrontando
  // col dato vero intero l'estrazione usciva con 1 su tutte e due le copie, già col codice di prima).
  const ridotto = ingressoDellaFixture(input);
  const anonimo = anonimizzaInput(ridotto);

  // Il modello della fixture dev'essere quello vero senza le VM: stessi conteggi, o niente fixture.
  const vero = JSON.stringify(buildTopologyModel(input).counts);
  const conteggiRidotto = JSON.stringify(buildTopologyModel(ridotto).counts);
  const conteggiAnonimo = JSON.stringify(buildTopologyModel(anonimo).counts);
  process.stdout.write(`conteggi del modello: ${vero}\n`);
  if (conteggiRidotto !== vero) process.stdout.write(`senza le VM (la forma della fixture): ${conteggiRidotto}\n`);
  if (conteggiAnonimo !== conteggiRidotto) {
    process.stderr.write(`Conteggi diversi, fixture NON scritta.\n  senza le VM: ${conteggiRidotto}\n  anonimo: ${conteggiAnonimo}\n`);
    return 1;
  }
```

Il secondo controllo dei nomi di porta (Task 5, `porteInChiaro`; verifica UV1 del 15/10): la riga `process.stdout.write("valori veri nella fixture: 0 IP · 0 MAC · 0 nomi\n");` diventa

```ts
  // I nomi di porta (spec §13.12.2): ogni pezzo rimasto uguale al vero dev'essere un nome di fabbrica, o niente fixture.
  const porte = porteInChiaro(ridotto, anonimo);
  if (porte > 0) {
    process.stderr.write(`Nomi di porta veri che non sono di fabbrica nella fixture, NON scritta: ${porte}\n`);
    return 2;
  }
  process.stdout.write("valori veri nella fixture: 0 IP · 0 MAC · 0 nomi · 0 nomi di porta scelti\n");
```

e la cartella di lavoro con la copia del DB si toglie a fine giro, comunque vada (verifica UV2 del 15/10: ogni giro lasciava 320 MB sul cliente A e 2 GB sull'hub nello scratchpad). Sopra `async function main()`:

```ts
/** La cartella di lavoro con la copia del DB (320 MB sul cliente A, 2 GB sull'hub): si toglie a fine giro, comunque vada. */
const copie: string[] = [];
```

subito dopo `const lavoro = …`: `copie.push(lavoro);`, e l'ultima riga del file diventa

```ts
main()
  .catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); return 2; })
  .then((c) => { for (const p of copie) fs.rmSync(p, { recursive: true, force: true }); process.exit(c); });
```

Run: `node --import tsx --test src/lib/topology/__tests__/anonimizza.test.ts > "$SCRATCH/t1-7-anon.log" 2>&1; echo "exit=$?"` → `exit=0`. Poi le fixture, dalle copie fresche di P3 (percorsi dati dalla sessione principale nel prompt; lo script controlla che il modello **nuovo** dia gli stessi conteggi sull'ingresso vero senza le VM e sulla fixture, e che nella fixture non ci siano IP, MAC o nomi veri: senza, non scrive):

```bash
npx tsx scripts/estrai-fixture-topologia.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --uscita src/lib/topology/__tests__/fixtures/topologia-cliente-a.json > "$SCRATCH/estrai-A.log" 2>&1; echo "A exit=$?"
npx tsx scripts/estrai-fixture-topologia.ts "$SCRATCH/copie/<H>.db" --cartella "$SCRATCH" --uscita src/lib/topology/__tests__/fixtures/topologia-domarc.json > "$SCRATCH/estrai-H.log" 2>&1; echo "H exit=$?"
```

Expected: `A exit=0`, `H exit=0`, «valori veri nella fixture: 0 IP · 0 MAC · 0 nomi · 0 nomi di porta scelti», e nessuna cartella `fixture-topologia-*` rimasta nello scratchpad (verificato il 15/10 sulle copie di P3 col codice di questo task corretto dalle revisioni; con l'alternativa VRRP di prima nell'anonimizzatore l'estrazione del cliente A esce con 2, «… NON scritta: 5»). Se esce 2 con «nomi di porta»: un nome scelto da un cliente passava per un nome di serie — si corregge `PORTA_GENERICA` o l'anonimizzatore (con una prova), **mai** l'elenco chiuso per farlo passare. Se esce 1 (conteggi diversi): l'anonimizzatore perde un fatto che il modello nuovo usa — si corregge `anonimizza.ts` (con una prova), non si abbassa il controllo. Se esce 2 con «nomi N»: un valore dell'app coincide con una parola di un nome vero (era «down» degli stati delle porte, ora nel vocabolario dal Task 5): si aggiunge la parola al vocabolario con una prova, non si toglie il controllo.

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1-7-tutte.log" 2>&1; echo "exit=$?"`
Expected: le prove nuove sulle fixture verdi; `model-fixtures.test.ts` rossa **solo** su `MISURATI`, `MISURATI_DATO_VERO` e le dimensioni della disposizione: i valori nuovi si leggono dal messaggio della prova (il valore `actual`) e si scrivono, con un commento sopra ogni costante: «Task 7 di T1 (spec §13.7.1), fixture riestratte il ‹data› dalle copie: ‹chiave› ‹prima›→‹dopo› perché ‹causa›». Nel commento solo la causa dell'elenco qui sotto, **mai un nome o un indirizzo letto dalla copia**. La causa è una di queste e si verifica con `misura-cavi --nomi` sulla copia: righe raggruppate per apparato (meno vicini non abbinati); R-superata (righe troncate superate); una riga da una VLAN o da una VRRP che non si abbina più per IP (I15); porta di segmento (linee tolte: porta 15 di core 1, `ether8`, porta 5 dello switch 48 PoE dell'hub) e chi resta senza collegamenti su quella porta in «Da sistemare» (H5); niente cavi da interfacce logiche; niente ripiego del router da un'interfaccia che il suo traduttore non riconosce (l'hypervisor dell'hub che entrava sotto il router); dal passaggio universale: nessun cavo e nessuna conferma dalle righe di un router su un nome scelto (H7), righe di RouterOS dello stesso apparato unite per nome (un vicino non abbinato in meno), la velocità di un nome doppio (sulla fixture della rete B un hypervisor passa dallo switch 48 PoE all'aggregazione, H13: misurato sul prototipo); uplink completato dalla riga del figlio; tabella MAC che non rifà le linee dei segmenti; dati nuovi delle copie del ‹data›. Un numero che cambia per una causa che non è in questo elenco ferma il task: si chiede alla sessione principale. Poi di nuovo `exit=0`; `npx tsc --noEmit` e `npx eslint src/lib/topology scripts/estrai-fixture-topologia.ts scripts/misura-cavi.ts` con `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/links.ts src/lib/topology/model-types.ts src/lib/topology/node-index.ts src/lib/topology/link-attrs.ts src/lib/topology/attach.ts src/lib/topology/model.ts src/lib/topology/misura.ts src/lib/topology/anonimizza.ts scripts/misura-cavi.ts scripts/estrai-fixture-topologia.ts src/lib/topology/__tests__/links.test.ts src/lib/topology/__tests__/attach.test.ts src/lib/topology/__tests__/link-attrs.test.ts src/lib/topology/__tests__/anonimizza.test.ts src/lib/topology/__tests__/model-fixtures.test.ts src/lib/topology/__tests__/cavi-senza-prodotti.test.ts src/lib/topology/__tests__/fixtures/topologia-cliente-a.json src/lib/topology/__tests__/fixtures/topologia-domarc.json
git commit -m "fix(topologia): una linea per coppia con le porte di una prova sola, regola del segmento, velocità per chiave; nome scelto non fisico, conto per apparato, velocità dei nomi doppi (spec §13.7.1, §13.16)"
```

---

### Task 8: lato più vicino a schermo e in stampa, elenco comprimibile (T1.7, pagina)

Spec §13.10.1 («Che cosa cambia»: maniglie, ridondanze, figli spostati a mano, stampa), §13.10.2 (elenco), §13.15 («Linee fra un padre e i suoi figli: restano a tronco»), prova I31. Parte dai testi fissati dalla spec (§13.10) e dalle Global Constraints, **senza aspettare la bozza** (P4): le correzioni di Riccardo alla bozza arrivano col messaggio del rilascio ed entrano nel giro di correzioni del Task 12. Il modello non cambia e consuma solo il Task 1: va nell'ondata 2, accanto al Task 3 (revisione finale del 15/10; nessun file in comune). Le linee dell'albero restano a tronco; il lato più vicino vale per le ridondanze (fra cui i collegamenti a mano che l'albero non usa) e per i figli spostati a mano dall'altra parte. In stampa le ridondanze restano un elenco (§12.5).

**Files:**
- Modify: `src/lib/topology/map-screen.ts` (memoria e pulsante dell'elenco)
- Modify: `src/lib/topology/print-draw.ts` (`puntiLineaAlbero`)
- Modify: `src/components/topology/map/map-node.tsx:19`, `:66-77` (quattro maniglie nuove)
- Modify: `src/components/topology/map/map-edge.tsx` (percorso sul lato scelto)
- Modify: `src/components/topology/map/map-canvas.tsx:165-210` (lati delle ridondanze e dei figli spostati)
- Modify: `src/components/topology/print/print-map.tsx:75` (le linee dei figli con `puntiLineaAlbero`)
- Modify: `src/components/topology/map/map-toolbar.tsx` (pulsante «◂ Elenco»), `src/components/topology/map/topology-map-client.tsx` (stato dell'elenco)
- Test: `src/lib/topology/__tests__/map-screen.test.ts`, `src/lib/topology/__tests__/print-draw.test.ts`

**Interfaces:**
- Consumes: Task 1 (`latiVicini`, `lineaAlbero`, `maniglieLati`, `percorso`, `percorsoDaPunti`, `ostacoli`, `rettangoli`, `HANDLE_OUT_SU`, `HANDLE_OUT_SX`, `HANDLE_IN_GIU`, `HANDLE_IN_DX`, `Lato`, `Pt`).
- Produces: `ELENCO_KEY = "da-ipam.topologia.elenco"`, `elencoAperto(leggi: () => string | null): boolean`, `salvaElenco(scrivi: (v: string) => void, aperto: boolean): void`, `pulsanteElenco(aperto: boolean, passo: boolean): { etichetta: string; titolo: string }` (da `map-screen.ts`); `puntiLineaAlbero(orientation: MapOrientation, from: Rect, to: Rect, ostacoli: readonly Rect[]): Pt[]` (da `print-draw.ts`); `MapEdgeData.lati?: { da: Lato; a: Lato }`; prop nuove di `MapToolbar`: `listOpen: boolean`, `onToggleList: () => void`.

- [ ] **Step 1: le prove che falliscono** — in fondo a `src/lib/topology/__tests__/map-screen.test.ts` (aggiungere `ELENCO_KEY`, `elencoAperto`, `pulsanteElenco`, `salvaElenco` all'import):

```ts
// Spec §13.10.2 (vincolo 6 di Riccardo): l'elenco a sinistra si chiude per lasciare spazio alla mappa; la scelta si ricorda
// per chi guarda, come la barra dei dettagli, e una memoria che non si legge (navigazione privata) non rompe la pagina.
test("elenco: si ricorda per chi guarda; senza memoria leggibile resta aperto; una scrittura che fallisce non rompe niente", () => {
  assert.equal(ELENCO_KEY, "da-ipam.topologia.elenco");
  assert.equal(elencoAperto(() => null), true);
  assert.equal(elencoAperto(() => "chiuso"), false);
  assert.equal(elencoAperto(() => "aperto"), true);
  assert.equal(elencoAperto(() => { throw new Error("SecurityError"); }), true);
  const scritti: string[] = [];
  salvaElenco((v) => scritti.push(v), false);
  salvaElenco((v) => scritti.push(v), true);
  assert.deepEqual(scritti, ["chiuso", "aperto"]);
  assert.doesNotThrow(() => salvaElenco(() => { throw new Error("QuotaExceeded"); }, true));
});

test("pulsante dell'elenco: «◂ Elenco» aperto, «Elenco ▸» chiuso; in passo passo dice a che serve aprirlo", () => {
  assert.equal(pulsanteElenco(true, false).etichetta, "◂ Elenco");
  assert.equal(pulsanteElenco(false, false).etichetta, "Elenco ▸");
  assert.equal(pulsanteElenco(false, true).titolo, "Apre l'elenco per trascinare gli oggetti sulla mappa");
  assert.match(pulsanteElenco(true, true).titolo, /Chiude l'elenco/);
});
```

In fondo a `src/lib/topology/__tests__/print-draw.test.ts` (import di `puntiLineaAlbero` da `print-draw` e di `latiVicini`, `percorso` da `map-screen`):

```ts
// Prova I31 (ADR 0012 punto 1): schermo e stampa con la stessa geometria, `latiVicini` unica fonte dei lati.
test("I31 — un figlio spostato a mano dall'altra parte: in stampa sul lato più vicino, come a schermo; un figlio al suo posto: i gradini di oggi", () => {
  const padre = { x: 0, y: 0, w: 200, h: 44 }, spostato = { x: 0, y: 200, w: 180, h: 44 }, alSuoPosto = { x: 304, y: 100, w: 180, h: 44 };
  const l = latiVicini(padre, spostato, "lr", []);
  assert.deepEqual(puntiLineaAlbero("lr", padre, spostato, []), percorso(padre, l.da, spostato, l.a));
  assert.deepEqual(puntiLineaAlbero("lr", padre, alSuoPosto, []), stepPoints("lr", padre, alSuoPosto));
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/map-screen.test.ts src/lib/topology/__tests__/print-draw.test.ts > "$SCRATCH/t1-8.log" 2>&1; echo "exit=$?"`
Expected: `exit=1` (export mancanti).

- [ ] **Step 3: il codice**

`map-screen.ts`, in fondo:

```ts
// ─── Elenco a sinistra comprimibile (spec §13.10.2, vincolo 6) ────────────────
/** Elenco aperto o chiuso: si ricorda per chi guarda, in questo browser, come la barra dei dettagli. */
export const ELENCO_KEY = "da-ipam.topologia.elenco";

export function elencoAperto(leggi: () => string | null): boolean {
  try {
    return leggi() !== "chiuso";
  } catch {
    return true; // memoria non disponibile (navigazione privata, bloccata): aperto, come di base
  }
}

export function salvaElenco(scrivi: (v: string) => void, aperto: boolean): void {
  try {
    scrivi(aperto ? "aperto" : "chiuso");
  } catch {
    // memoria non disponibile: la scelta vale solo per questa visita
  }
}

/** La freccia dice dove va l'elenco: «◂ Elenco» quando è aperto (il clic lo chiude), «Elenco ▸» quando è chiuso. */
export function pulsanteElenco(aperto: boolean, passo: boolean): { etichetta: string; titolo: string } {
  if (aperto) return { etichetta: "◂ Elenco", titolo: "Chiude l'elenco degli oggetti: la mappa prende tutta la larghezza" };
  return { etichetta: "Elenco ▸", titolo: passo ? "Apre l'elenco per trascinare gli oggetti sulla mappa" : "Apre l'elenco degli oggetti a sinistra" };
}
```

`print-draw.ts`: l'import da `map-screen` diventa `import { LR_TRUNK, drawableLinks, lineaAlbero, percorso } from "@/lib/topology/map-screen";` e dopo `stepPoints`:

```ts
/**
 * I punti della linea fra un genitore e un figlio, in stampa come a schermo (spec §13.10.1, prova I31): i gradini di
 * oggi; per un figlio spostato a mano dall'altra parte, il lato più vicino.
 */
export function puntiLineaAlbero(orientation: MapOrientation, from: Rect, to: Rect, ostacoli: readonly Rect[]): Pt[] {
  const l = lineaAlbero(orientation, from, to, ostacoli);
  return l.tronco ? stepPoints(orientation, from, to) : percorso(from, l.lati.da, to, l.lati.a);
}
```

`print-map.tsx:75`: `const pts: Pt[] = puntiLineaAlbero(orientation, parent, ln, ostacoli(rettangoli(layout), [ln.parent, child]));` (import di `puntiLineaAlbero` da `print-draw`, di `ostacoli` e `rettangoli` da `map-screen`); la linea verso il gruppo degli AP (`:72`) resta `stepPoints`.

`map-node.tsx:19`: `import { HANDLE_ATT, HANDLE_IN, HANDLE_IN_DX, HANDLE_IN_GIU, HANDLE_IN_LR, HANDLE_OUT, HANDLE_OUT_LR, HANDLE_OUT_SU, HANDLE_OUT_SX } from "@/lib/topology/map-screen";`; in `Handles` (`:66-77`), dopo le quattro di oggi:

```tsx
      {/* Lato più vicino (spec §13.10.1): uscita in alto e a sinistra, entrata in basso e a destra. */}
      <Handle id={HANDLE_OUT_SU} type="source" position={Position.Top} isConnectable={false} className={HIDDEN_HANDLE} />
      <Handle id={HANDLE_OUT_SX} type="source" position={Position.Left} isConnectable={false} className={HIDDEN_HANDLE} />
      <Handle id={HANDLE_IN_GIU} type="target" position={Position.Bottom} isConnectable={false} className={HIDDEN_HANDLE} />
      <Handle id={HANDLE_IN_DX} type="target" position={Position.Right} isConnectable={false} className={HIDDEN_HANDLE} />
```

`map-edge.tsx`: import `percorsoDaPunti` e i tipi `Lato` e `Pt` da `map-screen` (`Pt` serve alla firma nuova di `redundantAt`: senza, `tsc` dà TS2304), `pointsPath` da `print-draw`; `MapEdgeData` riceve

```ts
  /** Il lato più vicino (spec §13.10.1): la linea esce dal lato `da` ed entra da `a`. Assente: le linee di oggi. */
  lati?: { da: Lato; a: Lato };
```

e in `MapEdge` (`:44-62`):

```tsx
  const trunk = data?.orientation === "lr" && data.inTree && !data.lati;
  const [smooth, labelX, labelY] = getSmoothStepPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0,
    ...(trunk ? { centerX: sourceX + LR_TRUNK, offset: LR_TRUNK } : {}),
  });
  // Sul lato scelto il percorso è quello di `percorsoDaPunti`, lo stesso della stampa e della misura (I31).
  const punti = data?.lati ? percorsoDaPunti({ x: sourceX, y: sourceY }, data.lati.da, { x: targetX, y: targetY }, data.lati.a) : null;
  const path = punti ? pointsPath(punti) : smooth;
  if (!data) return <BaseEdge id={id} path={path} />;
  if (!data.link) return <BaseEdge id={id} path={path} style={TREE_EDGE} />;
  const look = edgeLook(data.link, { inTree: data.inTree });
  const d = look.wavy ? wavyPath(punti ?? pathPoints(path)) : path;
  // … outer, stroke, dash, cap come prima …
  const at = trunk
    ? `translate(${targetX - 4}px, ${targetY - 1}px) translate(-100%, -100%)`
    : data.inTree && !data.lati
      ? `translate(${targetX}px, ${labelY}px) translate(${data.labelSide === "left" ? "calc(-100% - 4px)" : "4px"}, calc(-100% - 1px))`
      : redundantAt(path, look.tokens, data.avoid, labelX, labelY, punti);
```

con `redundantAt` che riceve i punti del lato scelto:

```ts
function redundantAt(path: string, tokens: readonly string[], avoid: readonly Rect[] | null | undefined, midX: number, midY: number, punti: Pt[] | null): string {
  const size = { w: tokens.join(" · ").length * CHAR_W + 8, h: 16 };
  // Sul lato scelto la parola sta vicino alla metà del percorso vero, fuori dai riquadri (anche dalla riga delle porte).
  const p = punti ? redundantLabelAt(punti, size, avoid ?? []) : avoid?.length ? redundantLabelAt(pathPoints(path), size, avoid) : { x: midX, y: midY };
  return `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
}
```

`map-canvas.tsx`: import di `lineaAlbero`, `latiVicini`, `maniglieLati`, `ostacoli`, `rettangoli` da `map-screen`. Prima di `edges`:

```tsx
  const riquadri = useMemo(() => rettangoli(layout), [layout]);
```

Nel ciclo delle linee dell'albero (`:169-189`), al posto del blocco dopo `if (ln.role === "ap") { … }`:

```tsx
      const padre = layout.nodes.get(ln.parent);
      const la = padre ? lineaAlbero(o, padre, ln, ostacoli(riquadri, [ln.parent, child])) : { tronco: true as const };
      if (la.tronco) {
        // L'etichetta della linea va dalla parte opposta alle porte scritte sopra il riquadro (a sinistra col «+N»).
        const data: MapEdgeData = { link, inTree: true, labelSide: p.plus.has(child) ? "right" : "left", orientation: o };
        out.push({ id: `t:${child}`, source: ln.parent, target: child, sourceHandle: h.source, targetHandle: h.target, type: "map", selectable: false, focusable: false, data });
      } else {
        // Un figlio spostato a mano dall'altra parte (spec §13.10.1): sul lato più vicino, senza giri.
        const m = maniglieLati(la.lati);
        avoid ??= labelBoxes(layout.nodes.values(), layout.apGroups);
        const data: MapEdgeData = { link, inTree: true, labelSide: "left", orientation: o, avoid, lati: la.lati };
        out.push({ id: `t:${child}`, source: ln.parent, target: child, sourceHandle: m.source, targetHandle: m.target, type: "map", selectable: false, focusable: false, data });
      }
```

(`let avoid: Rect[] | null = null;` si sposta in testa a `edges`, prima del ciclo dell'albero.) Il ciclo delle ridondanze (`:200-208`):

```tsx
    for (const l of visibleEdges(drawable, { showAll: p.showExtra, selected: p.selected })) {
      if (!l.redundant) continue;
      avoid ??= labelBoxes(layout.nodes.values(), layout.apGroups);
      const [s, t] = redundantEnds(o, layout.nodes.get(l.a)!, layout.nodes.get(l.b)!);
      // Spec §13.10.1: dal lato più vicino, mai dal lato opposto (prima dal destro del riquadro più a sinistra al sinistro
      // dell'altro: fra due riquadri della stessa colonna la linea faceva il giro).
      const lati = latiVicini(layout.nodes.get(s)!, layout.nodes.get(t)!, o, ostacoli(riquadri, [s, t]));
      const m = maniglieLati(lati);
      const data: MapEdgeData = { link: l, inTree: false, labelSide: "left", orientation: o, avoid, lati };
      out.push({ id: `x:${l.id}`, source: s, target: t, sourceHandle: m.source, targetHandle: m.target, type: "map", selectable: false, focusable: false, data });
    }
```

e le dipendenze di `edges` ricevono `riquadri`.

`map-toolbar.tsx`: in `Props`

```ts
  /** L'elenco degli oggetti a sinistra è aperto (spec §13.10.2, scelta ricordata). */
  listOpen: boolean;
  onToggleList: () => void;
```

in testa a `MapToolbar`: `const elenco = pulsanteElenco(p.listOpen, p.mode === "passo");` (import da `map-screen`), e come **primo** elemento della barra, prima del gruppo «Tipo di mappa» (l'elenco sta a sinistra, il pulsante anche; stesso stile di «Dettagli»):

```tsx
      <Button size="sm" className="text-[13px]" variant="outline" aria-pressed={p.listOpen} onClick={p.onToggleList} title={elenco.titolo}>
        {elenco.etichetta}
      </Button>
```

`topology-map-client.tsx`: import di `ELENCO_KEY`, `elencoAperto`, `salvaElenco` da `map-screen`; stato e memoria accanto a quelli dei dettagli (`:106`, `:130-132`):

```tsx
  const [listOpen, setListOpen] = useState(true);
  // …
  useEffect(() => {
    setDetailsOpen(readDetailsOpen());
    setShowExtra(readShowRedundant());
    setListOpen(elencoAperto(() => window.localStorage.getItem(ELENCO_KEY)));
  }, []);
  const changeList = (open: boolean) => { setListOpen(open); salvaElenco((v) => window.localStorage.setItem(ELENCO_KEY, v), open); };
```

`<MapToolbar … listOpen={listOpen} onToggleList={() => changeList(!listOpen)} />`; `<ObjectList …/>` (`:502-508`) si disegna solo con `listOpen`: `{listOpen && <ObjectList … />}`. Nei due testi vuoti di «Passo passo» che dicono «dall'elenco a sinistra» (`:422`, `:433`), con l'elenco chiuso si aggiunge « (l'elenco si apre con «Elenco ▸»)».

- [ ] **Step 4: verdi** — prove pure, tipi, lint (il build si fa una volta, nel cancello del Task 12):

Run: `node --import tsx --test src/lib/topology/__tests__/map-screen.test.ts src/lib/topology/__tests__/print-draw.test.ts > "$SCRATCH/t1-8.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`. Poi `npx tsc --noEmit > "$SCRATCH/t1-8-tsc.log" 2>&1; echo "exit=$?"` → `exit=0`; `npx eslint src/components/topology src/lib/topology > "$SCRATCH/t1-8-lint.log" 2>&1; echo "exit=$?"` → `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/map-screen.ts src/lib/topology/print-draw.ts src/components/topology/map/map-node.tsx src/components/topology/map/map-edge.tsx src/components/topology/map/map-canvas.tsx src/components/topology/print/print-map.tsx src/components/topology/map/map-toolbar.tsx src/components/topology/map/topology-map-client.tsx src/lib/topology/__tests__/map-screen.test.ts src/lib/topology/__tests__/print-draw.test.ts
git commit -m "feat(topologia): linee sul lato più vicino a schermo e in stampa, elenco a sinistra comprimibile (spec §13.10.1-13.10.2)"
```

---

### Task 9: «Ignora» per cavo, porte occupate, VM per cavo, correzioni orfane; VM e MAC propri (T1.4, modello; §13.7.8)

Spec §13.9 (D3; «Le correzioni che ci sono già: nessuna conversione automatica»), §13.7.1 passi 4 e 5 (le VM per cavo), prove I8, I9, I36, C4, C5 e Review Focus 5. Sonnet (la revisione finale di T1 è su Opus). La correzione del 14/10 (porta 10 di core 1 ↔ `ether8` di router 1) non si converte: diventa orfana, si vede, e Riccardo la toglie a mano dopo il rilascio.

**Dal passaggio universale (spec §13.7.8 «Router e firewall in una VM», regola `vm-e-mac-propri`; prove G9, I62, H15, S12): Step 6-10, con un commit a parte.** Fra una VM e il suo hypervisor non c'è un collegamento, perché la VM sta dentro: nessuna prova lo crea, né dalle VM, né dalla tabella MAC, né dal ripiego del router, né da un annuncio; un collegamento a mano resta. I MAC propri dell'apparato che osserva non sono suoi client, sue VM o suoi vicini; sulla porta di un altro apparato restano la prova del cavo. Vale per ogni marca: un router o un firewall virtuale è una VM come un'altra. Rete B, 14/10: il firewall virtuale, VM di un hypervisor e registrato come switch, vede nella sua tabella il MAC della sua scheda, che è il MAC della VM, e la mappa appendeva l'hypervisor sotto il suo firewall con un collegamento «dalle VM» (H15). Prima si escludeva solo l'hypervisor che è l'apparato stesso (`vm-ports.ts:109`). Misurato sul prototipo del piano (15/10 notte), regola accesa e spenta: sulla copia della rete B l'hypervisor passa da sotto il suo firewall virtuale all'aggregazione (`sotto_una_sua_vm` 1 → 0, collegamenti 56 → 55); sulla copia del cliente A e sulle due fixture, che non hanno VM, nessun effetto.

**Files:**
- Create: `src/lib/topology/ignorati.ts`
- Modify: `src/lib/topology/links.ts` (correzioni «ignora» come regole per cavo; passo 4; `RisultatoCollegamenti.ignorati` al posto di `ignored`)
- Modify: `src/lib/topology/attach.ts` (`OpzioniAttacco.ignorati` al posto di `ignored`; tabella MAC e ripiego per cavo)
- Modify: `src/lib/topology/vm-ports.ts` (`ignorati`; per cavo: non riempie, un'altra porta è un altro cavo visto)
- Modify: `src/lib/topology/model.ts`, `src/lib/topology/model-types.ts` (`TopologyModel.correzioniOrfane?`)
- Modify: `src/lib/topology/misura.ts` (`conteggi` += `correzioni_orfane`)
- Test: `src/lib/topology/__tests__/links.test.ts`, `attach.test.ts`, `vm-ports.test.ts`, `model-fixtures.test.ts`
- Modify (Step 6-10, §13.7.8): `src/lib/topology/vm-ports.ts` (`IpervisoriDi`, `ipervisoriDelleVm`, `vmEIpervisore`, `macProprio`; `vmPortLinks(…, vm)`), `src/lib/topology/attach.ts` (`OpzioniAttacco.ipervisori?`, `OpzioniAttacco.regole?`), `src/lib/topology/model.ts` (le VM e i loro hypervisor; il filtro finale dei collegamenti)
- Test (Step 6-10): `src/lib/topology/__tests__/vm-ports.test.ts`, `src/lib/topology/__tests__/attach.test.ts`

**Interfaces:**
- Consumes: Task 7 (`portaLocale`, `RisultatoCollegamenti`, `OpzioniAttacco`), `Porta`, `normale` (`cavi/porte.ts`); per gli Step 6-10 Task 6 (`REGOLE_T1`, `type Regole`, `buildTopologyModel(input, regole)`), Task 4 (`applicaScenario`, scenario S12), `MapVm` (`model-types.ts:257`), `canonical` (`node-index.ts:260`) e `idx.byMac` (`node-index.ts:16`).
- Produces (da `src/lib/topology/ignorati.ts`):

```ts
export interface RegolaIgnora { id: number; a: string; aPorta: Porta | null; b: string; bPorta: Porta | null }
export interface Ignorati { regole: readonly RegolaIgnora[]; usate: Set<number> }
export function nessunIgnorato(): Ignorati;
export function regoleIgnora(overrides: readonly LinkOverrideRow[], idx: NodeIndex, porta: (nodo: string, nome: string) => Porta | null): Ignorati;
export function ignorato(ig: Ignorati, x: string, xPorta: Pick<Porta, "chiave" | "nome"> | null, y: string, yPorta: Pick<Porta, "chiave" | "nome"> | null): boolean;
export function portaOccupata(ig: Ignorati, nodo: string, porta: Pick<Porta, "chiave" | "nome"> | null, altro: string): boolean;
export function correzioniOrfane(ig: Ignorati, overrides: readonly LinkOverrideRow[]): number[];
```

- Produces (Step 8, §13.7.8, da `src/lib/topology/vm-ports.ts`):

```ts
export type IpervisoriDi = ReadonlyMap<string, ReadonlySet<string>>;   // per ogni nodo che è una VM, il suo hypervisor
export function ipervisoriDelleVm(vms: readonly MapVm[]): Map<string, Set<string>>;
export function vmEIpervisore(ip: IpervisoriDi, x: string, y: string): boolean;
export function macProprio(idx: NodeIndex, mac: string, nodo: string): boolean;   // senza creare nodi (idx.byMac)
```

e `vmPortLinks(…, ignorati, vm: { ipervisori?: IpervisoriDi; regole?: Regole } = {})`, `OpzioniAttacco.ipervisori?: IpervisoriDi`, `OpzioniAttacco.regole?: Regole`.
- `RisultatoCollegamenti.ignorati: Ignorati`; `OpzioniAttacco.ignorati?: Ignorati`; `vmPortLinks(input, idx, known, running, ignorati: Ignorati = nessunIgnorato())`; `TopologyModel.correzioniOrfane?: number[]` (gli id delle correzioni «ignora» che non tolgono niente; assente nei modelli costruiti a mano dalle prove).

- [ ] **Step 1: le prove che falliscono** — in `src/lib/topology/__tests__/links.test.ts` la prova «la correzione manuale vince su LLDP: «ignora» toglie, «aggiungi» non invecchia mai» (righe 64-71) si **riscrive** col motivo (§13.9: la prova di oggi fissava l'«Ignora» per coppia; non si cancella):

```ts
// Spec §13.9 (D3). Incidente del 14/10: «Ignora» toglieva la COPPIA, e con la linea cucita «porta 10 ↔ ether8» è
// sparito anche il cavo vero a 10G. Ora toglie il cavo con quelle due porte (la pagina le scrive sempre, quelle della linea).
test("la correzione manuale vince su LLDP: «ignora» toglie il cavo con le sue porte, «aggiungi» non invecchia mai", () => {
  const base = { devices: [dev(1), dev(2), dev(3)], neighbors: [nb(1, { remote_ip: "10.0.0.2", timestamp: "2026-09-01 03:00:00" })] };
  const ignorato = run(input({ ...base, overrides: [{ id: 1, action: "ignore", a_node: "dev:2", a_port: "", b_node: "dev:1", b_port: "Port 1", medium: null }] }));
  assert.equal(ignorato.links.length, 0);
  assert.deepEqual([...ignorato.ignorati.usate], [1]);
  const aggiunto = run(input({ ...base, overrides: [{ id: 2, action: "add", a_node: "dev:1", a_port: "Port 9", b_node: "dev:3", b_port: "Port 1", medium: null }] }));
  const man = aggiunto.links.find((l) => l.source === "manual")!;
  assert.deepEqual([man.a, man.aPort, man.b, man.bPort, man.stale, man.daysUnseen], ["dev:1", "Port 9", "dev:3", "Port 1", false, null]);
});
```

e in fondo (sulla `sede1()` del Task 7):

```ts
const ignora = (id: number, a: string, aPort: string, b: string, bPort: string) => ({ id, action: "ignore" as const, a_node: a, a_port: aPort, b_node: b, b_port: bPort, medium: null });

test("I8 — «Ignora» per cavo: (porta 10, ether8) non tocca il cavo a 10G ed è orfana; (porta 10, sfp-sfpplus1) toglie solo lui", () => {
  const del14 = run({ ...sede1(), overrides: [ignora(1, "dev:114", "Uplink verso il router", "dev:1", "ether8")] });
  assert.equal(del14.links.some((l) => l.id === "link:dev:1|dev:114"), true, "il cavo sfp-sfpplus1 ↔ porta 10 resta");
  assert.deepEqual([...del14.ignorati.usate], [], "non corrisponde a nessun cavo visto: orfana");
  const giusto = run({ ...sede1(), overrides: [ignora(2, "dev:114", "Uplink verso il router", "dev:1", "sfp-sfpplus1")] });
  assert.equal(giusto.links.some((l) => l.id === "link:dev:1|dev:114"), false);
  assert.deepEqual([...giusto.ignorati.usate], [2]);
  assert.equal(giusto.links.some((l) => l.id === "link:dev:1|dev:112"), true, "gli altri cavi del router restano");
});

test("I8 — una porta vuota vale per ogni porta su quel lato; due porte vuote: orfana, non toglie niente", () => {
  const una = run({ ...sede1(), overrides: [ignora(3, "dev:1", "sfp-sfpplus1", "dev:114", "")] });
  assert.equal(una.links.some((l) => l.id === "link:dev:1|dev:114"), false);
  const nessuna = run({ ...sede1(), overrides: [ignora(4, "dev:1", "", "dev:114", "")] });
  assert.equal(nessuna.links.some((l) => l.id === "link:dev:1|dev:114"), true);
  assert.deepEqual([...nessuna.ignorati.usate], []);
});

// Review Focus 5: le correzioni salvate prima di T1 hanno le porte come le scriveva la linea di allora (grezze) e possono
// citare un host poi promosso ad apparato.
test("Review Focus 5 — un «Ignora» di prima: porte nella forma grezza («ether3,bridge», «SFP_ 9») e un host poi promosso", () => {
  const i = input({
    devices: [rtr(1), dev(2, { name: "SW-2", host: "10.0.1.40", host_id: 40, controller_mac: "02:00:00:00:00:02", via: "api" })],
    hosts: [host(40, { ip: "10.0.1.40" })],
    ports: [porta(2, 9, "SFP+ 9", "10000 Mbps"), porta(1, 3, "ether3", "1000 Mbps")],
    neighbors: [
      nb(2, { local_port: "SFP_ 9", remote_device_name: "RTR-1", remote_port: "ether3", remote_ip: "10.0.0.1", source: "unifi" }),
      // Il router sente lo switch sulla porta che lo switch annuncia («Port 9»: l'identificativo assegnato localmente).
      nb(1, { local_port: "ether3,bridge", remote_device_name: "SW-2", remote_port: "Port 9", remote_ip: "10.0.1.40", protocol: "lldp" }),
    ],
    overrides: [ignora(5, "host:40", "SFP_ 9", "dev:1", "ether3,bridge")],
  });
  const r = run(i);
  assert.deepEqual(r.links, []);
  assert.deepEqual([...r.ignorati.usate], [5]);
});
```

In `src/lib/topology/__tests__/attach.test.ts`, l'aiuto `run` (righe 33-37) passa `ignorati`:

```ts
function run(i: TopologyModelInput) {
  const idx = buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors);
  const { links, ignorati, segmenti } = buildLinks(i, idx);
  return { links, ...attachMacs(i, idx, links, { ignorati, segmenti }) };
}
```

e le tre prove I-3 (righe 314-354) si **riscrivono** con le porte che la pagina scrive (quelle della linea), più due prove nuove:

```ts
// Revisione finale del ramo (I-3), ora per cavo (spec §13.9, I9): «Ignora» vale anche per tabella MAC, ripiego del router
// e «dalle VM», sulla porta del cavo ignorato verso quell'oggetto. La pagina scrive le porte della linea: per una linea
// della tabella MAC, la porta dello switch e niente dall'altra parte (vale per ogni porta).
const ignora = (a: string, aPort: string, b: string, bPort = "") => [{ id: 1, action: "ignore" as const, a_node: a, a_port: aPort, b_node: b, b_port: bPort, medium: null }];
// Generico sul tipo della linea: le prove leggono anche le porte (`aPort`, `bPort`), che un tipo `{ a; b }` non ha (TS2339).
const fra = <T extends { a: string; b: string }>(links: T[], x: string, y: string) => links.filter((l) => [l.a, l.b].sort().join("|") === [x, y].sort().join("|"));

test("I-3/I9: un collegamento «tabella MAC» ignorato non torna, e il MAC non diventa un client", () => {
  const SRV = "02:00:00:00:05:01";
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "SRV-5", device_type: "server", host: "192.0.2.15", port_count: 0 })],
    knownMacs: [{ device_id: 5, mac: SRV }],
    macPorts: [mp(2, SRV, "Port 7")],
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:2", "dev:5").length, 1, "senza «Ignora» il collegamento c'è");
  const m = buildTopologyModel({ ...i, overrides: ignora("dev:2", "Port 7", "dev:5") });
  assert.deepEqual(fra(m.links, "dev:2", "dev:5"), []);
  assert.deepEqual(m.portClients, []);
  assert.deepEqual(m.correzioniOrfane, []);
});

test("I9: la porta del cavo ignorato resta occupata verso quell'oggetto; lo stesso oggetto su un'altra porta compare", () => {
  const SRV = "02:00:00:00:05:01";
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "SRV-5", device_type: "server", host: "192.0.2.15", port_count: 0 })],
    knownMacs: [{ device_id: 5, mac: SRV }],
    macPorts: [mp(2, SRV, "Port 8")],
    overrides: ignora("dev:2", "Port 7", "dev:5"),
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(fra(m.links, "dev:2", "dev:5").map((l) => (l.a === "dev:2" ? l.aPort : l.bPort)), ["Port 8"]);
  assert.deepEqual(m.correzioniOrfane, [1], "la correzione su Port 7 non toglie niente: orfana");
});

// Revisione del piano (15/10): su una linea LLDP o uplink la pagina scrive TUTTE E DUE le porte. Tabella MAC, ripiego e VM
// sanno una porta sola: con `ignorato(…, null)` la porta dell'altro capo non tornava mai, la porta restava libera e il MAC
// di accesso A sulla porta 9 di core 1 rifaceva subito la linea. `portaOccupata` guarda solo la porta di chi vede il MAC.
test("I9: un cavo LLDP ignorato con le sue due porte non torna dalla tabella MAC sulla stessa porta", () => {
  const ACC = "02:00:00:00:01:12";
  const i = baseInput({
    devices: [dev(114, { name: "CORE-1", host: "192.0.2.114" }), dev(112, { name: "ACC-A", host: "192.0.2.112" })],
    knownMacs: [{ device_id: 112, mac: ACC }],
    neighbors: [{ device_id: 114, local_port: "Port 9", remote_device_name: "ACC-A", remote_port: "SFP+ 2", protocol: "lldp", remote_ip: "192.0.2.112", remote_mac: null, timestamp: RECENTE, source: "device" }],
    macPorts: [mp(114, ACC, "Port 9")],
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:114", "dev:112").length, 1, "senza «Ignora» il cavo c'è");
  const m = buildTopologyModel({ ...i, overrides: ignora("dev:114", "Port 9", "dev:112", "SFP+ 2") });
  assert.deepEqual(fra(m.links, "dev:114", "dev:112"), [], "né il cavo LLDP né una linea «tabella MAC» sulla porta 9");
  assert.deepEqual(m.correzioniOrfane, []);
});

test("I9: un cavo LLDP ignorato verso un hypervisor non torna «dalle VM» sulla stessa porta", () => {
  const vm = (vmid: number, mac: string) => ({
    scannedDeviceId: 5, vmid, name: `vm-${vmid}`, node: "px-h", status: "running", type: "qemu", macs: [mac], ips: [], scannedAt: "2026-10-13T06:00:00.000Z",
  });
  const vms = [vm(501, "02:00:00:aa:00:01"), vm(502, "02:00:00:aa:00:02")];
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "px-h", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 })],
    scanHosts: [{ scannedDeviceId: 5, hostname: "px-h", ips: ["192.0.2.15"], macs: [] }],
    neighbors: [{ device_id: 2, local_port: "Port 1", remote_device_name: "px-h", remote_port: "eno1", protocol: "lldp", remote_ip: "192.0.2.15", remote_mac: null, timestamp: RECENTE, source: "device" }],
    vms, macPorts: vms.map((v) => mp(2, v.macs[0], "Port 1")),
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:2", "dev:5").length, 1, "senza «Ignora» il cavo c'è");
  const m = buildTopologyModel({ ...i, overrides: ignora("dev:2", "Port 1", "dev:5", "eno1") });
  assert.deepEqual(fra(m.links, "dev:2", "dev:5"), [], "né il cavo LLDP né una linea «dalle VM» sulla porta 1");
  assert.deepEqual(m.correzioniOrfane, []);
});

test("I-3/I9: il ripiego del router ignorato non torna", () => {
  const i = input({
    devices: [RTR, dev(2), dev(3), dev(7, { name: "SRV-7", device_type: "server", host: "10.0.1.7" })],
    knownMacs: [{ device_id: 7, mac: SRV_MAC }],
    macPorts: [mp(1, SRV_MAC, "ether7")],
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:1", "dev:7").length, 1, "senza «Ignora» il collegamento c'è");
  assert.deepEqual(fra(buildTopologyModel({ ...i, overrides: ignora("dev:1", "ether7", "dev:7") }).links, "dev:1", "dev:7"), []);
});

test("I-3/I9: un collegamento «dalle VM» ignorato non torna", () => {
  const vm = (vmid: number, mac: string) => ({
    scannedDeviceId: 5, vmid, name: `vm-${vmid}`, node: "px-h", status: "running", type: "qemu", macs: [mac], ips: [], scannedAt: "2026-10-13T06:00:00.000Z",
  });
  const vms = [vm(501, "02:00:00:aa:00:01"), vm(502, "02:00:00:aa:00:02")];
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "px-h", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 })],
    scanHosts: [{ scannedDeviceId: 5, hostname: "px-h", ips: ["192.0.2.15"], macs: [] }],
    vms, macPorts: vms.map((v) => mp(2, v.macs[0], "Port 1")),
  });
  assert.equal(fra(buildTopologyModel(i).links, "dev:2", "dev:5").length, 1, "senza «Ignora» il collegamento c'è");
  assert.deepEqual(fra(buildTopologyModel({ ...i, overrides: ignora("dev:2", "Port 1", "dev:5") }).links, "dev:2", "dev:5"), []);
});

test("C5 — un «Ignora» senza porte non toglie niente: è orfano", () => {
  const SRV = "02:00:00:00:05:01";
  const i = baseInput({
    devices: [dev(2, { name: "CENTRALE-2", host: "192.0.2.2" }), dev(5, { name: "SRV-5", device_type: "server", host: "192.0.2.15", port_count: 0 })],
    knownMacs: [{ device_id: 5, mac: SRV }],
    macPorts: [mp(2, SRV, "Port 7")],
    overrides: ignora("dev:2", "", "dev:5"),
  });
  const m = buildTopologyModel(i);
  assert.equal(fra(m.links, "dev:2", "dev:5").length, 1);
  assert.deepEqual(m.correzioniOrfane, [1]);
});
```

In fondo a `src/lib/topology/__tests__/vm-ports.test.ts`:

```ts
// Spec §13.7.1 passo 5: le porte di una linea vengono da una prova sola. Prima una prova dalle VM su una porta diversa
// da quella della linea rinfrescava fonti e «visto», e una linea con la porta vuota la riempiva (una linea «cucita», C4).
test("VM per cavo: su un'altra porta dello stesso switch è un altro cavo visto; non riempie e non rinfresca", () => {
  const vms = vmsOf(5, "px-h", 1, 2);
  const m = buildTopologyModel(rete({ vms, macPorts: [mp(4, H_MAC, "Port 5", VECCHIO), ...vms.map((v) => mp(4, v.macs[0], "Port 6"))] }));
  const [l] = pair(m.links, "dev:4", "dev:5");
  assert.deepEqual([l.aPort, l.sources, l.lastSeen, l.vmCount], ["Port 5", ["mac_table"], VECCHIO, undefined]);
  assert.deepEqual(l.altriCavi, [{ aPort: "Port 6", bPort: "", sources: ["vm_mac"], lastSeen: RECENTE }]);
});

test("VM per cavo: una linea a mano senza porte non prende la porta dalle VM", () => {
  const vms = vmsOf(5, "px-h", 1, 1);
  const m = buildTopologyModel(rete({ vms, macPorts: vms.map((v) => mp(2, v.macs[0], "Port 1")),
    overrides: [{ id: 1, action: "add", a_node: "dev:2", a_port: "", b_node: "dev:5", b_port: "", medium: null }] }));
  const [l] = pair(m.links, "dev:2", "dev:5");
  assert.deepEqual([l.aPort, l.bPort, l.sources], ["", "", ["manual", "vm_mac"]]);
});
```

In fondo a `src/lib/topology/__tests__/model-fixtures.test.ts`:

```ts
// I36 (D3): la correzione del 14/10 (porta 10 di core 1 ↔ ether8 di router 1) non si converte da sola: resta, orfana, e
// non nasconde più il cavo a 10G. Riccardo la toglie a mano dopo il rilascio («Togli la correzione»).
test("cliente A col dato vero (S0): la correzione del 14/10 è orfana e core 1 sta sotto router 1 (C1, C5)", () => {
  const m = buildTopologyModel(carica("topologia-cliente-a.json"));
  const ignora = carica("topologia-cliente-a.json").overrides.filter((o) => o.action === "ignore").map((o) => o.id);
  assert.deepEqual(m.correzioniOrfane, ignora);
  assert.equal(padreDi(alberoDa(m, "dev:1"), "dev:114"), "dev:1");
});

test("cliente A e hub: nessuna linea cucita (C4)", () => {
  for (const nome of ["topologia-cliente-a.json", "topologia-domarc.json"]) {
    const i = carica(nome);
    assert.deepEqual(lineeCucite(i, buildTopologyModel(i)).map((l) => l.id), [], nome);
  }
});
```

(import di `lineeCucite` da `@/lib/topology/misura`.)

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/links.test.ts src/lib/topology/__tests__/attach.test.ts src/lib/topology/__tests__/vm-ports.test.ts src/lib/topology/__tests__/model-fixtures.test.ts > "$SCRATCH/t1-9.log" 2>&1; echo "exit=$?"`
Expected: `exit=1` (`ignorati` e `correzioniOrfane` assenti; I8 rossa: la coppia sparisce; le VM riempiono ancora).

- [ ] **Step 3: il codice** — `src/lib/topology/ignorati.ts`:

```ts
/**
 * «Ignora» per cavo (spec topologia §13.9, D3). Una correzione «ignora» toglie solo il cavo con quelle due porte,
 * confrontate per chiave (dopo il completamento dell'uplink, §13.7.1 passo 3a): una porta vuota vale per qualunque porta
 * su quel lato; con tutte e due le porte vuote non toglie niente. Vale per ogni fonte di quel cavo: vicini, uplink,
 * tabella MAC, ripiego del router e VM (la regola I-3 della fase 2b, prima per coppia). Incidente del 14/10: un «Ignora»
 * sulla linea cucita «porta 10 ↔ ether8» toglieva la coppia, e con lei il cavo vero a 10G. Le correzioni salvate prima
 * non si convertono (D3): quelle che non tolgono niente sono orfane, si vedono in «Dati della mappa» e le toglie una
 * persona. Logica pura.
 */
import { normale, type Porta } from "@/lib/topology/cavi/porte";
import type { LinkOverrideRow } from "@/lib/topology/model-types";
import { canonical, nodeFor, type NodeIndex } from "@/lib/topology/node-index";

export interface RegolaIgnora { id: number; a: string; aPorta: Porta | null; b: string; bPorta: Porta | null }

export interface Ignorati {
  regole: readonly RegolaIgnora[];
  /** Le regole che hanno tolto qualcosa: le altre «ignora» sono le correzioni orfane. Si riempie mentre si calcola il modello. */
  usate: Set<number>;
}

export function nessunIgnorato(): Ignorati {
  return { regole: [], usate: new Set() };
}

/** Le correzioni «ignora», coi nodi passati dall'id canonico (un host poi promosso è l'apparato) e le porte con la chiave. */
export function regoleIgnora(overrides: readonly LinkOverrideRow[], idx: NodeIndex, porta: (nodo: string, nome: string) => Porta | null): Ignorati {
  const regole: RegolaIgnora[] = [];
  for (const o of [...overrides].sort((x, y) => x.id - y.id)) {
    if (o.action !== "ignore") continue;
    const a = nodeFor(idx, canonical(idx, o.a_node));
    const b = nodeFor(idx, canonical(idx, o.b_node));
    if (!a || !b || a === b) continue;
    regole.push({ id: o.id, a, aPorta: porta(a, o.a_port), b, bPorta: porta(b, o.b_port) });
  }
  return { regole, usate: new Set() };
}

/** Un lato: la porta vuota della regola vale per ogni porta; una porta della regola vuole la stessa porta del cavo. */
function stessoLato(regola: Porta | null, cavo: Pick<Porta, "chiave" | "nome"> | null): boolean {
  if (!regola) return true;
  if (!cavo || cavo.nome.trim() === "") return false;
  return regola.chiave !== null && cavo.chiave !== null ? regola.chiave === cavo.chiave : normale(regola.nome) === normale(cavo.nome);
}

/** Il cavo x:xPorta ↔ y:yPorta è ignorato a mano? Se sì, la regola si segna come usata (non è orfana). */
export function ignorato(ig: Ignorati, x: string, xPorta: Pick<Porta, "chiave" | "nome"> | null, y: string, yPorta: Pick<Porta, "chiave" | "nome"> | null): boolean {
  let tolto = false;
  for (const r of ig.regole) {
    if (!r.aPorta && !r.bPorta) continue; // senza porte: orfana, non toglie niente (chiede «Scegli il cavo da ignorare…»)
    const diritto = r.a === x && r.b === y && stessoLato(r.aPorta, xPorta) && stessoLato(r.bPorta, yPorta);
    const rovescio = r.a === y && r.b === x && stessoLato(r.aPorta, yPorta) && stessoLato(r.bPorta, xPorta);
    if (diritto || rovescio) {
      ig.usate.add(r.id);
      tolto = true;
    }
  }
  return tolto;
}

/**
 * La porta `porta` di `nodo` è quella di un cavo ignorato verso `altro`? Per la tabella MAC, il ripiego del router e le VM,
 * che sanno una porta sola (spec §13.9: «le porte di un cavo ignorato restano occupate verso quell'oggetto»). La porta
 * dell'altro capo della regola non conta: su una linea LLDP o uplink la pagina scrive tutte e due le porte, e con
 * `ignorato(…, null)` la porta restava libera, così il MAC di accesso A sulla porta 9 di core 1 rifaceva subito la linea
 * (revisione del piano, 15/10). Se sì, la regola si segna come usata.
 */
export function portaOccupata(ig: Ignorati, nodo: string, porta: Pick<Porta, "chiave" | "nome"> | null, altro: string): boolean {
  let occupata = false;
  for (const r of ig.regole) {
    if (!r.aPorta && !r.bPorta) continue; // senza porte: orfana, non toglie niente
    const diritto = r.a === nodo && r.b === altro && stessoLato(r.aPorta, porta);
    const rovescio = r.b === nodo && r.a === altro && stessoLato(r.bPorta, porta);
    if (diritto || rovescio) {
      ig.usate.add(r.id);
      occupata = true;
    }
  }
  return occupata;
}

/** Gli id delle correzioni «ignora» che non tolgono niente (C5): anche quelle che citano un oggetto che non c'è più. */
export function correzioniOrfane(ig: Ignorati, overrides: readonly LinkOverrideRow[]): number[] {
  return overrides.filter((o) => o.action === "ignore" && !ig.usate.has(o.id)).map((o) => o.id).sort((x, y) => x - y);
}
```

`links.ts`: import `import { ignorato, regoleIgnora, type Ignorati } from "@/lib/topology/ignorati";`; nel ciclo delle correzioni il ramo «ignora» si toglie (`if (o.action !== "add") continue;`) e prima del ciclo:

```ts
  // Passo 4 (§13.9): le correzioni «ignora» sono regole per cavo, confrontate sulle porte dei candidati.
  const ignorati = regoleIgnora(input.overrides, idx, locale);
```

la `const ignored = new Set<string>();` si toglie; nel passo 5 il filtro diventa `if (!ignorato(ignorati, c.a, c.aPorta, c.b, c.bPorta)) aggiungiA(perCoppia, pairKey(c.a, c.b), c);`; il ritorno `return { links, unmatched, ignorati, segmenti };`; in `RisultatoCollegamenti` il campo `ignored` diventa

```ts
  /** Le correzioni «ignora» come regole per cavo; `usate` dice quali hanno tolto qualcosa (attach.ts e vm-ports.ts aggiungono le loro). */
  ignorati: Ignorati;
```

`attach.ts`: in `OpzioniAttacco` il campo `ignored` diventa `ignorati?: Ignorati` (stesso commento, «per cavo»); `const { …, ignorati = nessunIgnorato(), … } = opzioni;` e `const portaDi = portaLocale(input);` (import di `portaLocale` da `links`, di `nessunIgnorato`, `portaOccupata` e del tipo `Ignorati` da `ignorati`). La riga 58 diventa `const linked = new Set(links.map((l) => [l.a, l.b].sort().join("|")));` (una coppia ignorata non è più «già collegata»: lo è solo la porta del cavo). Nel ramo degli apparati, prima della prova del segmento:

```ts
      // §13.9: la porta di un cavo ignorato resta occupata verso quell'oggetto (I9), anche se la regola ha le due porte di
      // una linea LLDP; su un'altra porta il cavo compare.
      if (portaOccupata(ignorati, best.node, portaDi(best.node, best.port), other.id)) continue;
```

`ripiegoRouter` riceve un parametro in più, `bloccato: (router: string, porta: string, nodo: string) => boolean`, passato come `(router, porta, nodo) => portaOccupata(ignorati, router, portaDi(router, porta), nodo)`, e nel suo ciclo, dopo `if (linked.has([router, r.node].sort().join("|"))) continue;`: `if (bloccato(router, r.c.port, r.node)) continue;`. La chiamata a `vmPortLinks` (`:131`) passa `ignorati` al posto di `ignored`.

`vm-ports.ts`: firma `vmPortLinks(input, idx, known, running, ignorati: Ignorati = nessunIgnorato())`; `const portaDi = portaLocale(input);`; `:111` diventa `if (portaOccupata(ignorati, s.node, portaDi(s.node, s.port), h)) continue; // «Ignora» per cavo (§13.9, I9)` (import di `nessunIgnorato`, `portaOccupata` e del tipo `Ignorati` da `ignorati`, di `portaLocale` da `links`). Il ramo che fonde in una linea che c'è già (`:130-143`):

```ts
    const side = l.a === s.node ? "aPort" : "bPort";
    const portaLinea = l[side];
    if (portaLinea && key(s.node, portaLinea) !== k) {
      // Un'altra porta dello stesso switch: un altro cavo visto (spec §13.7.1 passo 5). Non riempie e non rinfresca.
      l.altriCavi = [...(l.altriCavi ?? []), { aPort: side === "aPort" ? s.port : "", bPort: side === "bPort" ? s.port : "", sources: ["vm_mac"], lastSeen: s.ts }];
      continue;
    }
    if (!l.sources.includes("vm_mac")) {
      l.sources.push("vm_mac");
      l.sources.sort((x, y) => LINK_SOURCE_RANK[x] - LINK_SOURCE_RANK[y] || (x < y ? -1 : x > y ? 1 : 0));
    }
    // La porta vuota non si riempie: le porte di una linea vengono da una prova sola (prima la riempiva, C4).
    if (portaLinea) l.vmCount = s.vms.size;
    if (l.uplinkFrom === null) l.uplinkFrom = h;
    const t = l.lastSeen ? parseDbDate(l.lastSeen).getTime() : NaN;
    if (!l.sources.includes("manual") && (Number.isNaN(t) || s.ms > t)) {
      l.lastSeen = s.ts;
      l.daysUnseen = daysUnseen;
      l.stale = false;
    }
```

`model-types.ts`, in `TopologyModel` dopo `vms`:

```ts
  /**
   * Le correzioni «ignora» che non corrispondono a nessun cavo visto (spec §13.9, C5): non tolgono niente, «Dati della
   * mappa» le mostra con «Togli la correzione». Assente nei modelli costruiti a mano dalle prove.
   */
  correzioniOrfane?: number[];
```

`model.ts`:

```ts
  const { links: baseLinks, unmatched, ignorati, segmenti } = buildLinks(input, idx, runningVmMacs, regole);
  const { portClients, clientCount, attachLinks } = attachMacs(input, idx, baseLinks, { vmMacs, runningVmMacs, ignorati, segmenti });
  // … e nel ritorno, accanto a vms:
  correzioniOrfane: correzioniOrfane(ignorati, input.overrides),
```

(import di `correzioniOrfane` da `@/lib/topology/ignorati`; l'oggetto ritornato elenca `correzioniOrfane` dopo `vms`.)

`misura.ts`, in `conteggi`: `correzioni_orfane: model.correzioniOrfane?.length ?? 0,`.

- [ ] **Step 4: verdi** — tutte le prove della topologia (le fixture del Task 7 hanno la correzione del 14/10):

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1-9.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`. Se `MISURATI` di `model-fixtures.test.ts` cambia ancora (la coppia router 1 – core 1 non è più ignorata nel dato vero): si riscrivono i valori col commento «Task 9 di T1: l'«Ignora» del 14/10 non toglie più la coppia (I36)». `npx tsc --noEmit` e `npx eslint src/lib/topology` con `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/ignorati.ts src/lib/topology/links.ts src/lib/topology/attach.ts src/lib/topology/vm-ports.ts src/lib/topology/model.ts src/lib/topology/model-types.ts src/lib/topology/misura.ts src/lib/topology/__tests__/links.test.ts src/lib/topology/__tests__/attach.test.ts src/lib/topology/__tests__/vm-ports.test.ts src/lib/topology/__tests__/model-fixtures.test.ts
git commit -m "fix(topologia): «Ignora» per cavo, porte occupate, VM per cavo, correzioni orfane (spec §13.9, D3)"
```

- [ ] **Step 6: le prove che falliscono (§13.7.8)** — in testa a `src/lib/topology/__tests__/vm-ports.test.ts`, dopo l'import di `./support/righe`:

```ts
import { applicaScenario } from "@/lib/topology/misura";
import { REGOLE_T1 } from "@/lib/topology/regole";
```

e in fondo allo stesso file (gli aiuti `mp`, `vmMac`, `vm`, `vmsOf`, `H_MAC`, `rete` e `pair` ci sono già, righe 13-59):

```ts
// ─── Spec §13.7.8 (G9, I62, H15): router e firewall in una VM ───
// Rete B (l'hub), 14/10: il firewall virtuale, VM dell'hypervisor, è registrato come switch; nella sua «tabella MAC» (la sua
// tabella ARP per interfaccia) c'è il MAC della sua stessa scheda, che è anche il MAC della VM: la mappa appendeva l'hypervisor
// al suo firewall con un collegamento «dalle VM». Prima si escludeva solo l'hypervisor che è l'apparato stesso (`vm-ports.ts:109`).
const FW_MAC = vmMac(5, 66);
function conFirewallVirtuale(): TopologyModelInput {
  const base = rete();
  const vmDiPxh = vmsOf(5, "px-h", 1, 2);
  return {
    ...base,
    devices: [...base.devices, dev(15, { name: "FW-VIRT", device_type: "switch", vendor: "altro", host: "192.0.2.66", port_count: 4 })],
    knownMacs: [...base.knownMacs, { device_id: 15, mac: FW_MAC }],
    vms: [vm(566, "px-h", FW_MAC), ...vmDiPxh],
    macPorts: [mp(15, FW_MAC, "vtnet0"), mp(4, H_MAC, "Port 5"), ...vmDiPxh.map((v) => mp(2, v.macs[0], "Port 1"))],
  };
}

test("I62, H15 — fra una VM e il suo hypervisor nessun collegamento: px-h non sta sotto il suo firewall virtuale", () => {
  const m = buildTopologyModel(conFirewallVirtuale());
  assert.equal(m.vms.find((v) => v.nodeId === "dev:15")?.hypervisorNodeId, "dev:5", "il firewall è la VM 566 di px-h");
  assert.deepEqual(pair(m.links, "dev:15", "dev:5"), []);
  // px-h resta sui suoi cavi: la gestione sull'accesso e i 10G «dalle VM» sul centrale
  assert.deepEqual(m.links.filter((l) => l.a === "dev:5" || l.b === "dev:5").map((l) => [l.a === "dev:5" ? l.b : l.a, l.source]).sort(),
    [["dev:2", "vm_mac"], ["dev:4", "mac_table"]]);
  const prima = buildTopologyModel(conFirewallVirtuale(), new Set([...REGOLE_T1].filter((r) => r !== "vm-e-mac-propri")));
  assert.equal(pair(prima.links, "dev:15", "dev:5").length, 1, "regola spenta (misura C19): il collegamento falso di prima");
});

// R1 e S12 (spec §13.3.4, §13.12.1): dal 15/10 l'hub rilegge le VM ogni notte. Con la VM del firewall spenta e un'altra accesa
// al suo posto, con gli stessi MAC, l'hypervisor resta lo stesso fuori dal suo firewall.
test("S12, H15 — lettura delle VM rinnovata: nessun oggetto sotto una sua VM, né prima né dopo", () => {
  const nuova = applicaScenario(conFirewallVirtuale(), { nome: "S12", apparato: 5, vmid: 566 });
  assert.deepEqual(nuova.vms.filter((v) => v.macs.includes(FW_MAC)).map((v) => [v.vmid, v.status]), [[566, "stopped"], [100566, "running"]]);
  assert.deepEqual(pair(buildTopologyModel(nuova).links, "dev:15", "dev:5"), []);
});
```

In fondo a `src/lib/topology/__tests__/attach.test.ts` (`buildTopologyModel`, `baseInput`, `dev` e `mp` ci sono già, righe 6-13):

```ts
// Spec §13.7.8 (G9): un apparato non è client di sé stesso. Uno switch vede il suo MAC sulla porta della CPU: prima contava fra i
// client di quella porta (`attach.ts:124-129`) e toglieva la prova del cavo all'altro switch che lo vede.
test("G9 — il MAC proprio di uno switch sulla sua porta non è un suo client; sulla porta di un altro switch prova il cavo", () => {
  const SW = "02:00:00:00:00:02";
  const i = baseInput({
    devices: [dev(2, { name: "SW-2", controller_mac: SW }), dev(3, { name: "SW-3" })],
    macPorts: [mp(2, SW, "Port 0"), mp(3, SW, "Port 7")],
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(m.portClients.filter((p) => p.nodeId === "dev:2"), []);
  assert.deepEqual(m.links.map((l) => [l.a, l.aPort, l.b, l.source]), [["dev:3", "Port 7", "dev:2", "mac_table"]]);
});
```

- [ ] **Step 7: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/vm-ports.test.ts src/lib/topology/__tests__/attach.test.ts > "$SCRATCH/t1-9b.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`, rosse le tre nuove e solo quelle: G9 (lo switch è client di sé stesso sulla sua porta), I62/H15 e S12 (il collegamento fra il firewall virtuale e il suo hypervisor c'è): 3 rosse su 61 (verifica UV2 del 15/10, sullo stato intero del piano; il prototipo, che non aveva H5, il ripiego del router e le due I9, ne contava 57).

- [ ] **Step 8: il codice** — `src/lib/topology/vm-ports.ts`: gli import `:23-24` diventano

```ts
import { LINK_ATTRS_DEFAULT, LINK_SOURCE_RANK, type MapLink, type MapVm, type TopologyModelInput } from "@/lib/topology/model-types";
import { canonical, type NodeIndex } from "@/lib/topology/node-index";
import { REGOLE_T1, type Regole } from "@/lib/topology/regole";
```

subito dopo `export type RunningVmMacs = …;` (`:37`):

```ts
/** Per ogni nodo che è una VM, il suo hypervisor (spec §13.7.8): fra i due nessun collegamento. */
export type IpervisoriDi = ReadonlyMap<string, ReadonlySet<string>>;

export function ipervisoriDelleVm(vms: readonly MapVm[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const v of vms) {
    if (!v.nodeId || !v.hypervisorNodeId) continue;
    const s = out.get(v.nodeId);
    if (s) s.add(v.hypervisorNodeId);
    else out.set(v.nodeId, new Set([v.hypervisorNodeId]));
  }
  return out;
}

/**
 * Spec §13.7.8 (G9, I62): fra una VM e il suo hypervisor non c'è un collegamento — la VM sta dentro. Nessuna prova lo crea:
 * né dalle VM, né dalla tabella MAC, né dal ripiego. Rete B: l'hypervisor appeso alla scheda del suo firewall virtuale.
 */
export function vmEIpervisore(ip: IpervisoriDi, x: string, y: string): boolean {
  return ip.get(x)?.has(y) === true || ip.get(y)?.has(x) === true;
}

/**
 * Spec §13.7.8 (G9): il MAC è dell'apparato che lo osserva — uno dei MAC noti che si abbinano a lui (controller, MAC noti,
 * host fusi). Un apparato non è vicino, client né VM di sé stesso. Senza creare nodi (`idx.byMac`, non `resolveNode`).
 */
export function macProprio(idx: NodeIndex, mac: string, nodo: string): boolean {
  const id = idx.byMac.get(mac);
  return typeof id === "string" && canonical(idx, id) === nodo;
}
```

`vmPortLinks` riceve un ultimo parametro e il corpo comincia dalle regole:

```ts
  ignorati: Ignorati = nessunIgnorato(),
  /** Spec §13.7.8: le VM e i loro hypervisor; `regole` dice se la regola «vm-e-mac-propri» è accesa (misura C19). */
  vm: { ipervisori?: IpervisoriDi; regole?: Regole } = {},
): MapLink[] {
  const { ipervisori = new Map(), regole = REGOLE_T1 } = vm;
  const vmEMacPropri = regole.has("vm-e-mac-propri");
  if (running.size === 0) return [];
```

subito dopo `perPort.set(k, (perPort.get(k) ?? new Set()).add(mac));` (`:79`):

```ts
    // Spec §13.7.8 (G9): i MAC propri dell'apparato che osserva non sono VM sulla sua porta. Rete B: il firewall virtuale vede
    // nella sua tabella il MAC della sua scheda, che è il MAC della VM, e da lì l'hypervisor gli finiva sotto.
    if (vmEMacPropri && macProprio(idx, mac, node)) continue;
```

e subito dopo `if (h === null || h === s.node || !idx.nodes.has(h)) continue;` (`:109`):

```ts
    if (vmEMacPropri && vmEIpervisore(ipervisori, s.node, h)) continue; // una VM non fa da padre al suo hypervisor (§13.7.8)
```

`src/lib/topology/attach.ts`: l'import di `vm-ports` (`:34`) diventa

```ts
import { REGOLE_T1, type Regole } from "@/lib/topology/regole";
import { macProprio, vmEIpervisore, vmPortLinks, type IpervisoriDi, type RunningVmMacs } from "@/lib/topology/vm-ports";
```

in `OpzioniAttacco`, dopo `segmenti?`:

```ts
  /** Spec §13.7.8: per ogni nodo che è una VM, il suo hypervisor; fra i due nessun collegamento (`ipervisoriDelleVm`). */
  ipervisori?: IpervisoriDi;
  /** Le regole del passaggio universale accese (spec §13.16; le spegne solo la misura C19). */
  regole?: Regole;
```

la lettura delle opzioni in `attachMacs`:

```ts
  const { vmMacs = new Set<string>(), runningVmMacs = new Map(), ignorati = nessunIgnorato(), segmenti = new Map(), ipervisori = new Map(), regole = REGOLE_T1 } = opzioni;
  const vmEMacPropri = regole.has("vm-e-mac-propri");
```

subito dopo `if (input.nowMs - ms <= soglia) perPort.set(k, (perPort.get(k) ?? new Set()).add(mac));` (`:72`):

```ts
    // Spec §13.7.8 (G9): i MAC propri dell'apparato che osserva non sono suoi client né suoi vicini; su un altro apparato
    // restano la prova del cavo. Uno switch vede il suo MAC sulla porta della CPU: prima era un suo client.
    if (vmEMacPropri && macProprio(idx, mac, node)) continue;
```

subito dopo la riga della porta di segmento del Task 7 (`if (segmenti.get(portKey(best.node, best.port))?.has(other.id)) continue;`):

```ts
      // Spec §13.7.8: fra una VM e il suo hypervisor nessun collegamento, nemmeno dalla tabella MAC.
      if (vmEMacPropri && vmEIpervisore(ipervisori, best.node, other.id)) continue;
```

la chiamata a `vmPortLinks` passa `{ ipervisori, regole }` dopo `ignorati`, e il blocco del ripiego (Step 3) diventa `(router, porta, nodo) => portaOccupata(ignorati, router, portaDi(router, porta), nodo) || (vmEMacPropri && vmEIpervisore(ipervisori, router, nodo))`.

`src/lib/topology/model.ts`: import `import { ipervisoriDelleVm, vmEIpervisore } from "@/lib/topology/vm-ports";`; subito dopo `placeVms` (`:30`):

```ts
  // Spec §13.7.8: per ogni nodo che è una VM, il suo hypervisor: fra i due nessun collegamento dai dati (G9).
  const ipervisori = ipervisoriDelleVm(vms);
```

le opzioni di `attachMacs` diventano `{ vmMacs, runningVmMacs, ignorati, segmenti, ipervisori, regole }`, e `links` (`:33`):

```ts
  // Nemmeno da un annuncio (una VM che sente il bridge del suo hypervisor): la VM sta dentro; un collegamento a mano resta.
  const links = [...baseLinks, ...attachLinks]
    .filter((l) => !regole.has("vm-e-mac-propri") || l.sources.includes("manual") || !vmEIpervisore(ipervisori, l.a, l.b))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
```

- [ ] **Step 9: verdi**

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1-9b.log" 2>&1; echo "exit=$?"; npx tsc --noEmit > "$SCRATCH/t1-9b-tsc.log" 2>&1; echo "tsc exit=$?"`
Expected: `exit=0`, `tsc exit=0`. Le fixture non hanno VM (`FASE_2B_SEZIONI.vms: null`): `MISURATI` non cambia (verificato sul prototipo: nessun conteggio, padre o testa delle due fixture cambia con la regola accesa o spenta).

- [ ] **Step 10: commit**

```bash
git add src/lib/topology/vm-ports.ts src/lib/topology/attach.ts src/lib/topology/model.ts src/lib/topology/__tests__/vm-ports.test.ts src/lib/topology/__tests__/attach.test.ts
git commit -m "fix(topologia): fra una VM e il suo hypervisor nessun collegamento; i MAC propri non sono client né VM (spec §13.7.8)"
```

---

### Task 10: «Ignora questo cavo…», correzioni orfane in «Dati della mappa», «Altri cavi visti» (T1.4 testi, T1.6)

Spec §13.9 («Testi che cambiano», «Correzione orfana»), §13.4.6 («Altri cavi visti fra questi due oggetti» entra in T1; le frasi «Perché» in T1b, §13.15 punto 6). Parte dai testi fissati, **senza aspettare la bozza** (P4): le correzioni di Riccardo arrivano col messaggio del rilascio ed entrano nel giro di correzioni del Task 12. Testi alla lettera dalle Global Constraints. Mai il solo colore: lo stato di una correzione è una parola.

**Files:**
- Modify: `src/lib/topology/map-menus.ts:89` (voce della linea)
- Modify: `src/lib/topology/ignored-links.ts` (testi del dialogo, righe orfane, cavi fra due oggetti)
- Modify: `src/lib/topology/edge-look.ts` (`altriCaviDi`)
- Modify: `src/components/topology/map/topology-map-client.tsx:562-586` (dialogo)
- Modify: `src/app/(dashboard)/topology/dati/ignored-links-card.tsx` (orfane: «Togli la correzione», «Scegli il cavo da ignorare…»)
- Modify: `src/components/topology/map/linked-panel.tsx:151-172` (gli altri cavi sotto ogni collegamento)
- Test: `src/lib/topology/__tests__/ignored-links.test.ts`, `map-menus.test.ts`, `edge-look.test.ts`

**Interfaces:**
- Consumes: Task 7 (`MapLink.altriCavi`, `AltroCavo`), Task 9 (`TopologyModel.correzioniOrfane`), `SOURCE_WORDS` (Task 2).
- Produces (da `ignored-links.ts`): `ORFANA = "non corrisponde a nessun cavo visto: non toglie niente"`; `testiIgnoraCavo(a: string, aPort: string, b: string, bPort: string, fonti: string): { titolo: string; testo: string }`; `IgnoredLinkRow.orfana: boolean`; `ignoredLinkRows(rows, model: { nodes; canonical; correzioniOrfane? })`; `interface CavoDaScegliere { aPort: string; bPort: string; parole: string; linea: boolean }`; `caviFra(model: { links: readonly MapLink[]; canonical: Readonly<Record<string, string>> }, aNode: string, bNode: string): CavoDaScegliere[]`. Da `edge-look.ts`: `altriCaviDi(l: MapLink, nodo: string): Array<{ mia: string; sua: string; fonti: string; visto: string | null }>`.

- [ ] **Step 1: le prove che falliscono** — in fondo a `src/lib/topology/__tests__/ignored-links.test.ts` (import di `ORFANA`, `caviFra`, `testiIgnoraCavo` e di `LINK_ATTRS_DEFAULT`, `MapLink`):

```ts
// Spec §13.9: «Ignora» toglie il cavo con le sue porte; una correzione che non corrisponde a nessun cavo non toglie niente
// e si vede (la riga del 14/10 del cliente A), con «Togli la correzione» e «Scegli il cavo da ignorare…».
test("il dialogo dell'«Ignora» dice quale cavo, con le porte, e che gli altri cavi restano", () => {
  const t = testiIgnoraCavo("CORE-1", "Port 10", "RTR-1", "sfp-sfpplus1", "uplink UniFi + LLDP");
  assert.equal(t.titolo, "Ignorare il cavo CORE-1 · Port 10 ↔ RTR-1 · sfp-sfpplus1?");
  assert.equal(t.testo, "Questo cavo sparisce da tutte le mappe, anche se le letture continuano a vederlo (uplink UniFi + LLDP). Gli altri cavi fra CORE-1 e RTR-1, se ci sono, restano. I dati letti non si toccano.");
  assert.equal(testiIgnoraCavo("A", "", "B", "eth0", "x").titolo, "Ignorare il cavo A · porta non nota ↔ B · eth0?");
});

test("le righe orfane si riconoscono: «non corrisponde a nessun cavo visto: non toglie niente»", () => {
  const model = { nodes: [node("dev:1", "RTR-1"), node("dev:114", "CORE-1")], canonical: {}, correzioniOrfane: [1] };
  const r = ignoredLinkRows([riga(1, "ignore", "dev:114", "porta-10", "dev:1", "ether8"), riga(2, "ignore", "dev:1", "ether3", "dev:114", "")], model);
  assert.deepEqual(r.map((x) => [x.id, x.orfana]), [[2, false], [1, true]]);
  assert.equal(ORFANA, "non corrisponde a nessun cavo visto: non toglie niente");
});

test("Scegli il cavo da ignorare…: la linea e gli altri cavi visti fra i due oggetti, con le porte orientate come la correzione", () => {
  const l: MapLink = {
    id: "link:dev:1|dev:114", a: "dev:114", aPort: "Port 10", b: "dev:1", bPort: "sfp-sfpplus1", source: "unifi_uplink", sources: ["unifi_uplink", "lldp"],
    uplinkFrom: "dev:114", lastSeen: null, daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT,
    altriCavi: [{ aPort: "Port 16", bPort: "ether2", sources: ["lldp"], lastSeen: null }],
  };
  assert.deepEqual(caviFra({ links: [l], canonical: {} }, "dev:1", "host:5"), []);
  assert.deepEqual(caviFra({ links: [l], canonical: {} }, "dev:1", "dev:114"), [
    { aPort: "sfp-sfpplus1", bPort: "Port 10", parole: "la linea sulla mappa · uplink UniFi + LLDP", linea: true },
    { aPort: "ether2", bPort: "Port 16", parole: "altro cavo visto · LLDP", linea: false },
  ]);
});
```

e la prova di oggi «solo gli «ignora», i più recenti prima…» (`ignored-links.test.ts:19-33`), che confronta le righe intere, riceve il campo nuovo nelle due righe attese, col perché:

```ts
  // Spec §13.9 (T1): ogni riga dice se è orfana; qui il modello non ha `correzioniOrfane`, quindi nessuna lo è.
  assert.deepEqual(r, [
    { id: 5, a: "SRV-9", aPort: "porta non indicata", b: "oggetto non più nella mappa (dev:12)", bPort: "porta eth0", by: "riccardo", when: "14/10/2026, 08:00", orfana: false },
    { id: 3, a: "RTR-1", aPort: "porta ether2", b: "SW-2", bPort: "porta Port 5", by: "riccardo", when: "14/10/2026, 00:51", orfana: false },
  ]);
```

In `src/lib/topology/__tests__/map-menus.test.ts`, in fondo:

```ts
test("§13.9: la voce della linea dice che si ignora un cavo, non la coppia", () => {
  assert.equal(edgeMenuItems(link("dev:1", "dev:2"), true).find((x) => x.key === "ignore")!.label, "Ignora questo cavo…");
});
```

In fondo a `src/lib/topology/__tests__/edge-look.test.ts` (import di `altriCaviDi`):

```ts
test("«Altri cavi visti fra questi due oggetti»: le porte dalla parte dell'oggetto scelto, le fonti in parole", () => {
  const l = { ...link(), a: "dev:114", aPort: "Port 10", b: "dev:1", bPort: "sfp-sfpplus1",
    altriCavi: [{ aPort: "Port 15", bPort: "ether8", sources: ["mndp" as const], lastSeen: "2026-10-13 11:00:00" }] };
  assert.deepEqual(altriCaviDi(l, "dev:1"), [{ mia: "ether8", sua: "Port 15", fonti: "annuncio di rete (MNDP o CDP)", visto: "2026-10-13 11:00:00" }]);
  assert.deepEqual(altriCaviDi(l, "dev:114")[0].mia, "Port 15");
  assert.deepEqual(altriCaviDi({ ...l, altriCavi: undefined }, "dev:1"), []);
});
```

(`edge-look.test.ts` ha già l'aiuto `link(over: Partial<MapLink> = {}): MapLink`, con `id: "link:dev:1|dev:2"`, `a: "dev:1"`, `aPort: "Port 1"`, `b: "dev:2"`, `bPort: "eth0"`: basta aggiungere `altriCaviDi` all'import da `@/lib/topology/edge-look`.)

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/ignored-links.test.ts src/lib/topology/__tests__/map-menus.test.ts src/lib/topology/__tests__/edge-look.test.ts > "$SCRATCH/t1-10.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`.

- [ ] **Step 3: il codice**

`map-menus.ts:89`: `out.push(manual ? { key: "remove", label: "Rimuovi il collegamento a mano" } : { key: "ignore", label: "Ignora questo cavo…" });` (in T1 una linea è una coppia: «Ignora questo cavo…» per tutte, §13.9).

`ignored-links.ts`: import `import { SOURCE_WORDS } from "@/lib/topology/edge-look";` e `MapLink` fra i tipi; `IgnoredLinkRow` riceve `orfana: boolean`; in fondo:

```ts
/** Una correzione che non corrisponde a nessun cavo visto (spec §13.9, C5): si mostra, non si converte da sola (D3). */
export const ORFANA = "non corrisponde a nessun cavo visto: non toglie niente";

/** Titolo e testo del dialogo di «Ignora questo cavo…» (spec §13.9, «Testi che cambiano»). */
export function testiIgnoraCavo(a: string, aPort: string, b: string, bPort: string, fonti: string): { titolo: string; testo: string } {
  const p = (x: string) => x.trim() || "porta non nota";
  return {
    titolo: `Ignorare il cavo ${a} · ${p(aPort)} ↔ ${b} · ${p(bPort)}?`,
    testo: `Questo cavo sparisce da tutte le mappe, anche se le letture continuano a vederlo (${fonti}). Gli altri cavi fra ${a} e ${b}, se ci sono, restano. I dati letti non si toccano.`,
  };
}

/** `linea`: è il cavo che oggi regge la linea sulla mappa. Ignorarlo toglie la linea: lo si dice accanto, non si preseleziona. */
export interface CavoDaScegliere { aPort: string; bPort: string; parole: string; linea: boolean }

/**
 * «Scegli il cavo da ignorare…» per una correzione orfana: i cavi fra i due oggetti — in T1 la linea e gli «Altri cavi
 * visti» — con le porte orientate come la correzione (a_node, b_node), per scriverne una nuova al posto dell'orfana.
 */
export function caviFra(model: { links: readonly MapLink[]; canonical: Readonly<Record<string, string>> }, aNode: string, bNode: string): CavoDaScegliere[] {
  const a = model.canonical[aNode] ?? aNode, b = model.canonical[bNode] ?? bNode;
  const l = model.links.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  if (!l) return [];
  const dritto = l.a === a;
  const verso = (p: string, q: string) => (dritto ? { aPort: p, bPort: q } : { aPort: q, bPort: p });
  const fonti = (s: readonly MapLink["source"][]) => s.map((x) => SOURCE_WORDS[x]).join(" + ");
  return [
    { ...verso(l.aPort, l.bPort), parole: `la linea sulla mappa · ${fonti(l.sources)}`, linea: true },
    ...(l.altriCavi ?? []).map((c) => ({ ...verso(c.aPort, c.bPort), parole: `altro cavo visto · ${fonti(c.sources)}`, linea: false })),
  ];
}
```

e in `ignoredLinkRows` il tipo di `model` riceve `correzioniOrfane?: readonly number[]`, e ogni riga `orfana: (model.correzioniOrfane ?? []).includes(r.id)`.

`edge-look.ts`, dopo `vmPortWords`:

```ts
/**
 * «Altri cavi visti fra questi due oggetti» (spec §13.4.6, T1): le porte dalla parte dell'oggetto scelto, le fonti in
 * parole. Servono all'«Ignora» per cavo: dicono che cosa resta se si ignora la linea.
 */
export function altriCaviDi(l: Pick<MapLink, "a" | "altriCavi">, nodo: string): Array<{ mia: string; sua: string; fonti: string; visto: string | null }> {
  return (l.altriCavi ?? []).map((c) => ({
    mia: l.a === nodo ? c.aPort : c.bPort,
    sua: l.a === nodo ? c.bPort : c.aPort,
    fonti: c.sources.map((s) => SOURCE_WORDS[s]).join(" + "),
    visto: c.lastSeen,
  }));
}
```

`topology-map-client.tsx`, il dialogo (`:562-586`): import di `testiIgnoraCavo` da `ignored-links`; nel corpo, prima del `return`:

```tsx
  const testiIgnora = ignoreAsk
    ? testiIgnoraCavo(name(ignoreAsk.a), ignoreAsk.aPort, name(ignoreAsk.b), ignoreAsk.bPort, ignoreAsk.sources.map((s) => FONTE[s]).join(" + "))
    : null;
```

e il dialogo:

```tsx
      <Dialog open={ignoreAsk !== null} onOpenChange={(o) => { if (!o) setIgnoreAsk(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{testiIgnora?.titolo ?? ""}</DialogTitle></DialogHeader>
          <p className="text-[13px]">{testiIgnora?.testo ?? ""}</p>
          <p className="text-[13px]">{IGNORA_SI_ANNULLA}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreAsk(null)}>Annulla</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const l = ignoreAsk;
                if (!l) return;
                if ((await ignoreLink(send, { action: "ignore", a_node: l.a, a_port: l.aPort, b_node: l.b, b_port: l.bPort })).ok) setIgnoreAsk(null);
              }}
            >
              Ignora questo cavo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

`ignored-links-card.tsx`: il `model` della prop diventa `{ nodes: readonly Pick<MapNode, "id" | "name">[]; canonical: Readonly<Record<string, string>>; links: readonly MapLink[]; correzioniOrfane?: readonly number[] }` (la pagina passa già `m`, il modello intero). Stato in più: `const [scegli, setScegli] = useState<LinkOverrideView | null>(null);` e `const [scelto, setScelto] = useState<number | null>(null);` (nessun cavo scelto di base: per l'orfana del 14/10 l'unica scelta è il cavo vero a 10G, e preselezionarlo vorrebbe dire nasconderlo di nuovo con un clic). Una colonna «Stato» dopo la seconda «Porta», testo e non colore:

```tsx
                  <TableHead>Da</TableHead><TableHead>Porta</TableHead><TableHead>A</TableHead><TableHead>Porta</TableHead><TableHead>Stato</TableHead>
```

```tsx
                    <TableCell>{r.b}</TableCell><TableCell>{r.bPort}</TableCell><TableCell>{r.orfana ? ORFANA : "nasconde un cavo"}</TableCell>
```

Accanto a `ripristina`, la funzione che toglie una correzione orfana (stessa rotta, `DELETE /api/topology/links/[id]`, esito diverso):

```tsx
  async function togli(id: number, testo: string) {
    setBusy(id);
    setEsito(null);
    const r = await fetchJson<{ ok: true }>(`/api/topology/links/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) {
      setEsito(`Non tolta: ${r.message}`);
      return;
    }
    setEsito(`Correzione tolta: non nascondeva niente (${testo}).`);
    await load();
    onChanged();
  }
```

I pulsanti dell'admin:

```tsx
                    {isAdmin && (
                      <TableCell className="space-x-1 text-right whitespace-nowrap">
                        {r.orfana ? (
                          <>
                            <Button variant="outline" size="sm" className="text-[13px]" disabled={busy !== null} onClick={() => void togli(r.id, `${r.a} ↔ ${r.b}`)}>
                              {busy === r.id ? "Tolgo…" : "Togli la correzione"}
                            </Button>
                            <Button variant="outline" size="sm" className="text-[13px]" disabled={busy !== null} onClick={() => { setScelto(null); setScegli(raw?.find((x) => x.id === r.id) ?? null); }}>
                              Scegli il cavo da ignorare…
                            </Button>
                          </>
                        ) : (
                          <Button variant="outline" size="sm" className="text-[13px]" disabled={busy !== null} onClick={() => void ripristina(r.id, `${r.a} ↔ ${r.b}`)}>
                            {busy === r.id ? "Ripristino…" : "Ripristina"}
                          </Button>
                        )}
                      </TableCell>
                    )}
```

e il dialogo della scelta (nessun cavo segnato di base; accanto alla linea la scritta che dice che è il cavo che oggi la regge; l'apostrofo nel testo JSX si scrive `&apos;`, altrimenti `react/no-unescaped-entities` è un errore e `npm run lint` esce con 1):

```tsx
      <Dialog open={scegli !== null} onOpenChange={(o) => { if (!o) setScegli(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Scegli il cavo da ignorare</DialogTitle></DialogHeader>
          {(() => {
            if (!scegli) return null;
            const cavi = caviFra(model, scegli.a_node, scegli.b_node);
            if (cavi.length === 0) return <p className="text-[13px]">Fra questi due oggetti oggi non c&apos;è nessun cavo visto: si può solo togliere la correzione.</p>;
            return (
              <fieldset className="space-y-1 text-[13px]">
                <legend className="mb-1">I cavi visti fra i due oggetti. Quello scelto sparisce dalle mappe; la correzione di prima si toglie.</legend>
                {cavi.map((c, k) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="radio" name="cavo" checked={scelto === k} onChange={() => setScelto(k)} className="size-4" />
                    <span>{c.aPort || "porta non nota"} ↔ {c.bPort || "porta non nota"} · {c.parole}{c.linea ? " — è il cavo che oggi regge la linea sulla mappa" : ""}</span>
                  </label>
                ))}
              </fieldset>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setScegli(null)}>Annulla</Button>
            <Button
              variant="destructive"
              disabled={!scegli || scelto === null || busy !== null}
              onClick={() => void sostituisci()}
            >
              Ignora questo cavo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
```

dove `sostituisci` scrive la correzione nuova e poi toglie l'orfana (due chiamate dell'admin già esistenti; se la seconda non riesce resta un'orfana in più, che non toglie niente e si vede):

```tsx
  async function sostituisci() {
    const o = scegli;
    const c = o && scelto !== null ? caviFra(model, o.a_node, o.b_node)[scelto] : undefined;
    if (!o || !c) return;
    setBusy(o.id);
    const nuova = await fetchJson<{ id: number }>("/api/topology/links", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "ignore", a_node: o.a_node, a_port: c.aPort, b_node: o.b_node, b_port: c.bPort }),
    });
    if (!nuova.ok) { setBusy(null); setEsito(`Non ignorato: ${nuova.message}`); return; }
    const via = await fetchJson<{ ok: true }>(`/api/topology/links/${o.id}`, { method: "DELETE" });
    setBusy(null);
    setScegli(null);
    setEsito(via.ok ? "Cavo ignorato; la correzione di prima è tolta." : `Cavo ignorato; la correzione di prima resta (orfana): ${via.message}`);
    await load();
    onChanged();
  }
```

(import di `Dialog…` da `@/components/ui/dialog`, di `ORFANA`, `caviFra` da `ignored-links`, di `MapLink` da `model-types`.)

`linked-panel.tsx`: import di `altriCaviDi` da `edge-look`; nella cella delle fonti di ogni collegamento (`:161-166`), dopo `linkWords`:

```tsx
                    {l.altriCavi && l.altriCavi.length > 0 && (
                      <div className="mt-1">
                        <div className="font-semibold">Altri cavi visti fra questi due oggetti</div>
                        <ul>
                          {altriCaviDi(l, n.id).map((c, k) => (
                            <li key={k}>
                              <Porta s={c.mia} /> → <Porta s={c.sua} /> · {c.fonti}{c.visto ? ` · visto ${quando(c.visto)}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
```

- [ ] **Step 4: verdi**

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1-10.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`. `npx tsc --noEmit`, `npx eslint src/components/topology "src/app/(dashboard)/topology" src/lib/topology` con `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/map-menus.ts src/lib/topology/ignored-links.ts src/lib/topology/edge-look.ts src/components/topology/map/topology-map-client.tsx "src/app/(dashboard)/topology/dati/ignored-links-card.tsx" src/components/topology/map/linked-panel.tsx src/lib/topology/__tests__/ignored-links.test.ts src/lib/topology/__tests__/map-menus.test.ts src/lib/topology/__tests__/edge-look.test.ts
git commit -m "feat(topologia): «Ignora questo cavo…», correzioni orfane con «Togli la correzione», altri cavi visti nei dettagli (spec §13.9, §13.4.6)"
```

---

### Task 10b: lo script di «Tornare indietro» (R6, spec §13.11.1) — livello completo

Spec §13.11.1 («Tornare indietro»), §13.3.4 (R6). **Zona rossa, quindi livello completo per questo pezzo**: prova vista fallire, prova a vuoto di base, copia delle righe prima di scrivere. **Opus.** Parte nell'ondata 5, in parallelo al Task 9 (nessun file in comune; era nell'ondata 6 prima del passaggio universale, vedi «Esecuzione»).

Perché esiste: misurato il 15/10 sulla copia del 14/10 del cliente A, col *detail* incollato del router 1 (revisione del piano). Col codice di prima e le righe nuove del router i padri sono quelli di prima; nel caso peggiore (`lldp` fra router dai due lati) un padre cambia, quindi R6 non regge. Il lettore di prima scriveva sempre `mndp`: riportate a `mndp` le righe che il lettore di T1 ha scritto col protocollo vero, il codice di prima ritrova i dati che conosce (misurato: stessi padri di prima). Lo script **non apre nessun DB**: stampa il testo SQL, e la sessione principale lo manda all'impianto da stdin con `sqlite3` via ssh, come le altre interrogazioni. Così dopo il `git revert` non serve nessun file del repo sull'impianto, e la stessa scrittura si prova sulla copia della copia (`misura-cavi --ripristino`).

**Files:**
- Create: `src/lib/topology/ripristino-vicini.ts`
- Create: `src/lib/topology/__tests__/ripristino-vicini.test.ts`
- Create: `scripts/ripristina-vicini-router.ts`
- Modify: `scripts/misura-cavi.ts` (`--ripristino <ora UTC>`)

**Interfaces:**
- Consumes: Task 4 (`scripts/misura-cavi.ts`, la copia della copia e `--uscita-router`).
- Produces (da `src/lib/topology/ripristino-vicini.ts`): `sqlConta(dalle: string): string`, `sqlCopia(dalle: string): string`, `sqlApplica(dalle: string): string` (un errore se `dalle` non è «AAAA-MM-GG HH:MM:SS»).

- [ ] **Step 1: le prove che falliscono** — `src/lib/topology/__tests__/ripristino-vicini.test.ts`:

```ts
// Spec topologia §13.11.1 («Tornare indietro») e R6. Verifica del piano (15/10): col codice di prima e `lldp` fra router
// dai due lati un padre cambiava; queste righe tornano `mndp`, solo per i MikroTik letti via SSH e solo dal rilascio in
// poi. DB finto in memoria, con le colonne vere di device_neighbors.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { sqlApplica, sqlConta, sqlCopia } from "@/lib/topology/ripristino-vicini";

const RILASCIO = "2026-10-15 08:00:00";

function dbFinto() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE network_devices (id INTEGER PRIMARY KEY, vendor TEXT, protocol TEXT);
    CREATE TABLE device_neighbors (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL, local_port TEXT NOT NULL, remote_device_name TEXT NOT NULL DEFAULT '',
      remote_port TEXT NOT NULL DEFAULT '', protocol TEXT NOT NULL CHECK(protocol IN ('lldp', 'cdp', 'mndp', 'unknown')),
      source TEXT NOT NULL DEFAULT 'device', timestamp TEXT, UNIQUE(device_id, local_port, remote_device_name, remote_port));
    INSERT INTO network_devices VALUES (1, 'MikroTik', 'ssh'), (2, 'mikrotik', 'snmp_v2'), (3, 'ubiquiti', 'api');
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, source, timestamp) VALUES
      (1, 'ether3', 'RTR-2', 'ether3', 'lldp', 'device', '2026-10-15 09:00:00'),
      (1, 'sfp-sfpplus1', 'CORE-1', 'Port 10', 'lldp', 'device', '2026-10-15 09:00:00'),
      (1, 'ether8', 'CORE-1', 'Port', 'mndp', 'device', '2026-10-14 10:00:00'),
      (1, 'ether2', 'RTR-2', 'ether2', 'lldp', 'device', '2026-10-14 10:00:00'),
      (2, 'ether4', 'RTR-3', 'ether4', 'lldp', 'device', '2026-10-15 09:00:00'),
      (3, 'Port 9', 'ACC-A', 'SFP+ 2', 'lldp', 'unifi', '2026-10-15 09:00:00');
  `);
  return d;
}
const protocolli = (d: Database.Database) => d.prepare("SELECT id, protocol FROM device_neighbors ORDER BY id").all();

test("prova a vuoto e copia: solo le righe del lettore di T1 dal rilascio in poi; niente si scrive", () => {
  const d = dbFinto();
  const prima = protocolli(d);
  assert.deepEqual(d.prepare(sqlConta(RILASCIO)).all(), [{ device_id: 1, protocol: "lldp", righe: 2 }]);
  assert.deepEqual(d.prepare(sqlCopia(RILASCIO)).all().map((r) => (r as { id: number }).id), [1, 2]);
  assert.deepEqual(protocolli(d), prima);
});

test("applica: le due righe tornano mndp e le altre restano; una seconda volta non cambia niente", () => {
  const d = dbFinto();
  d.exec(sqlApplica(RILASCIO));
  const dopo = protocolli(d);
  assert.deepEqual(dopo, [
    { id: 1, protocol: "mndp" }, { id: 2, protocol: "mndp" }, { id: 3, protocol: "mndp" },
    { id: 4, protocol: "lldp" }, { id: 5, protocol: "lldp" }, { id: 6, protocol: "lldp" },
  ]);
  d.exec(sqlApplica(RILASCIO));
  assert.deepEqual(protocolli(d), dopo);
  assert.deepEqual(d.prepare(sqlConta(RILASCIO)).all(), []);
});

test("l'ora del rilascio si scrive in un modo solo: altrimenti nessun testo SQL", () => {
  for (const x of ["2026-10-15", "2026-10-15T08:00:00Z", "2026-10-15 08:00:00' OR '1'='1", ""]) {
    assert.throws(() => sqlApplica(x), /AAAA-MM-GG HH:MM:SS/, x);
  }
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/ripristino-vicini.test.ts > "$SCRATCH/t1-10b.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`, «Cannot find module '@/lib/topology/ripristino-vicini'».

- [ ] **Step 3: il codice** — `src/lib/topology/ripristino-vicini.ts`:

```ts
/**
 * «Tornare indietro» da T1 (spec topologia §13.11.1, prova di ritorno R6). Il lettore dei vicini di T1 scrive il
 * protocollo vero (`lldp`) dove il lettore di prima scriveva sempre `mndp`. Se si torna al codice di prima e la prova R6
 * non regge (verifica del piano sul dato del 14/10: col codice di prima e `lldp` fra router dai due lati un padre
 * cambiava), queste righe tornano `mndp`, e il codice di prima vede i dati come li ha sempre visti. Solo le righe dei
 * MikroTik letti via SSH (il ramo del lettore di T1), scritte dall'ora del rilascio in poi.
 *
 * Qui si scrive solo il testo SQL: lo script lo stampa e la sessione principale lo manda all'impianto da stdin, come le
 * altre interrogazioni. Così dopo il ritorno non serve nessun file del repo sull'impianto. È una scrittura sul DB del
 * cliente: prima la prova a vuoto e la copia delle righe, e solo con la conferma di Riccardo. Logica pura.
 */
const ORA_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Le righe da riportare a `mndp`. `dalle` è l'ora del rilascio in UTC, come la scrive il DB («AAAA-MM-GG HH:MM:SS»). */
function righeDelLettoreT1(dalle: string): string {
  if (!ORA_UTC.test(dalle)) throw new Error("L'ora del rilascio va scritta «AAAA-MM-GG HH:MM:SS», in UTC.");
  return `FROM device_neighbors
 WHERE source = 'device' AND protocol <> 'mndp' AND timestamp >= '${dalle}'
   AND device_id IN (SELECT id FROM network_devices WHERE LOWER(TRIM(COALESCE(vendor, ''))) = 'mikrotik' AND protocol = 'ssh')`;
}

/** Prova a vuoto: quante righe cambierebbero, per apparato e protocollo (niente nomi). */
export function sqlConta(dalle: string): string {
  return `SELECT device_id, protocol, COUNT(*) AS righe ${righeDelLettoreT1(dalle)} GROUP BY device_id, protocol ORDER BY device_id, protocol;`;
}

/** Le righe che si toccheranno, da salvare PRIMA (con `sqlite3 -cmd '.mode insert device_neighbors'` diventano INSERT). */
export function sqlCopia(dalle: string): string {
  return `SELECT * ${righeDelLettoreT1(dalle)} ORDER BY id;`;
}

/** La scrittura, in una transazione; dopo, quante righe restano da riportare (atteso 0). */
export function sqlApplica(dalle: string): string {
  return `BEGIN IMMEDIATE;
UPDATE device_neighbors SET protocol = 'mndp' WHERE id IN (SELECT id ${righeDelLettoreT1(dalle)});
SELECT changes() AS riportate;
COMMIT;
SELECT COUNT(*) AS restano ${righeDelLettoreT1(dalle)};`;
}
```

`scripts/ripristina-vicini-router.ts`:

```ts
/**
 * ripristina-vicini-router.ts — stampa il testo SQL di «Tornare indietro» da T1 (spec topologia §13.11.1, R6), da mandare
 * all'impianto da stdin con sqlite3 via ssh, come le altre interrogazioni. Non apre nessun DB.
 *
 * Uso:  npx tsx scripts/ripristina-vicini-router.ts --dalle "AAAA-MM-GG HH:MM:SS" [--copia | --applica]
 *   (di base)  prova a vuoto: righe da riportare a `mndp`, per apparato e protocollo (niente nomi)
 *   --copia    le righe che si toccheranno, da salvare PRIMA: sqlite3 -readonly -cmd '.mode insert device_neighbors'
 *   --applica  la scrittura, in una transazione; poi le righe che restano (atteso 0). Solo con la conferma di Riccardo.
 *   --dalle    l'ora del rilascio di T1, in UTC, come la scrive il DB.
 *   Uscita: 0 testo stampato, 2 non partito.
 */
import { sqlApplica, sqlConta, sqlCopia } from "../src/lib/topology/ripristino-vicini";

function main(): number {
  const a = process.argv.slice(2);
  const i = a.indexOf("--dalle");
  const dalle = i >= 0 ? a[i + 1] : undefined;
  if (!dalle || (a.includes("--copia") && a.includes("--applica"))) {
    process.stderr.write('Uso: npx tsx scripts/ripristina-vicini-router.ts --dalle "AAAA-MM-GG HH:MM:SS" [--copia | --applica]\n');
    return 2;
  }
  try {
    process.stdout.write(`${a.includes("--applica") ? sqlApplica(dalle) : a.includes("--copia") ? sqlCopia(dalle) : sqlConta(dalle)}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    return 2;
  }
}

process.exit(main());
```

`scripts/misura-cavi.ts`: in `CON_VALORE` si aggiunge `"--ripristino"` (dopo `"--uscita-router"`); nell'uso, dopo la riga di `--uscita-router`, `[--ripristino <ora UTC>]   dopo le righe nuove del router, lo stesso testo SQL di «Tornare indietro» (Task 10b)`; subito prima di `const fileInput = val("--input-json");`:

```ts
  // «Tornare indietro» (Task 10b, R6): sulla copia della copia, dopo le righe nuove del router, lo stesso testo SQL che si
  // manderebbe all'impianto. Solo conteggi.
  const ripristino = val("--ripristino");
  if (ripristino) {
    const { sqlApplica, sqlConta } = await import("../src/lib/topology/ripristino-vicini");
    out.righe_riportate_a_mndp = (db.prepare(sqlConta(ripristino)).all() as Array<{ righe: number }>).reduce((s, r) => s + r.righe, 0);
    db.exec(sqlApplica(ripristino));
  }
```

- [ ] **Step 4: verdi, e la prova sulla copia della copia**

Run: `node --import tsx --test src/lib/topology/__tests__/ripristino-vicini.test.ts > "$SCRATCH/t1-10b.log" 2>&1; echo "exit=$?"` → `exit=0`. Poi `npx tsc --noEmit` e `npx eslint src/lib/topology/ripristino-vicini.ts src/lib/topology/__tests__/ripristino-vicini.test.ts scripts/ripristina-vicini-router.ts scripts/misura-cavi.ts` con `exit=0`. Prova di fumo dello script con il `sqlite3` della macchina su un DB finto nello scratchpad (mai sulla copia del cliente con `--applica`):

```bash
F="$SCRATCH/fumo-ripristino.db"; rm -f "$F"
sqlite3 "$F" "CREATE TABLE network_devices (id INTEGER PRIMARY KEY, vendor TEXT, protocol TEXT); CREATE TABLE device_neighbors (id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER, local_port TEXT, remote_device_name TEXT, remote_port TEXT, protocol TEXT, source TEXT, timestamp TEXT); INSERT INTO network_devices VALUES (1, 'mikrotik', 'ssh'); INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, source, timestamp) VALUES (1, 'ether3', 'RTR-2', 'ether3', 'lldp', 'device', '2026-10-15 09:00:00');"
npx tsx scripts/ripristina-vicini-router.ts --dalle "2026-10-15 08:00:00" | sqlite3 -readonly "$F"; echo "conta exit=$?"
npx tsx scripts/ripristina-vicini-router.ts --dalle "2026-10-15 08:00:00" --copia | sqlite3 -readonly -cmd '.mode insert device_neighbors' "$F"; echo "copia exit=$?"
npx tsx scripts/ripristina-vicini-router.ts --dalle "2026-10-15 08:00:00" --applica | sqlite3 -bail "$F"; echo "applica exit=$?"
npx tsx scripts/ripristina-vicini-router.ts --dalle "2026-10-15 08:00"; echo "formato sbagliato exit=$?"
rm -f "$F"
```

Expected (provato il 15/10): `1|lldp|1`, poi una riga `INSERT INTO device_neighbors VALUES(…)`, poi `1` (riportate) e `0` (restano), tutti `exit=0`; il formato sbagliato dà il messaggio e `exit=2`. Sulla copia del cliente A di P3 (presa prima del rilascio: il lettore nuovo non ha scritto niente), la prova a vuoto non trova righe: `npx tsx scripts/ripristina-vicini-router.ts --dalle "$(date -u +"%Y-%m-%d %H:%M:%S")" | sqlite3 -readonly "$SCRATCH/copie/<A>.db"` non stampa niente. La prova con le righe nuove e il codice di prima è nel Task 12 (R6).

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/ripristino-vicini.ts src/lib/topology/__tests__/ripristino-vicini.test.ts scripts/ripristina-vicini-router.ts scripts/misura-cavi.ts
git commit -m "feat(topologia): lo script di «Tornare indietro» per le righe del lettore dei vicini di T1 (spec §13.11.1, R6)"
```

---

### Task 10c: reti-campione di cinque famiglie e criteri G (passaggio universale, prove di T1)

Spec §13.12.2 («Reti-campione per famiglia»), §13.3.0 (criteri G1-G17: vincolo 9 di Riccardo, 14/10 sera, «il piano deve essere universale»), §13.16 (le regole spegnibili). **Sonnet.** Ondata 6, in parallelo al Task 10 (nessun file in comune: qui solo prove). Le regole dei Task 3-9 sono scritte per ogni rete; qui si provano su cinque famiglie **inventate**, così che il cliente A e la rete B restino due misure su reti vere e un caso nuovo visto sul campo diventi prima una riga di una famiglia, poi codice (§13.13.3, punto 15):

- famiglia 1, solo MikroTik: bridge e VLAN dai nomi scelti (e uno switch col nome di fabbrica del bridge), un fascio LACP col CDP inoltrato, un secondo router con due cavi diretti fuori dal bridge (in due VRF) sentito dalla testa anche su due VLAN, un router virtuale con un tunnel, la WAN come VLAN su due porte d'accesso. Le forme vengono dai casi nati sulla rete dell'hub; la rete no (l'aggregazione è un MikroTik, la testa non è l'id più basso);
- famiglia 2, solo UniFi col controller: il gateway unico router, con WAN e LAN verso lo stesso switch (la variante della spec; l'hub li ha verso due switch diversi), le sue porte «ethN», un'etichetta a mano su una porta, un nome doppio a 10G, uno switch senza spanning tree, un AP in mesh, due switch di laboratorio dietro uno switch muto;
- famiglia 3, altre marche via SNMP: forme delle MIB standard e della documentazione dei produttori, **non osservate su un apparato** (§13.12.2), che in T1 passano dal traduttore generico;
- famiglia 4, con hypervisor: due nodi Proxmox con la gestione a 1G sull'accesso e i dati a 10G sul core, uno su una porta etichettata e l'altro su un bond attivo e di riserva di due porte col nome doppio; VM viste su tutte e due le porte; una VM router e una VM firewall (registrata come switch) che legge la sua tabella MAC; schede che si annunciano con l'LLDP del firmware, senza nome; una lettura delle VM vecchia; un host classificato hypervisor senza VM né scansione;
- famiglia 5, mista: un router MikroTik coi nomi di fabbrica (`bridge`, nessun fascio) e un router di riserva sul segmento della WAN con un modem; uno switch del controller e uno di un'altra marca letto via SNMP, con un telefono IP che si annuncia via CDP e un PC che solo la tabella MAC vede; un ponte radio che si annuncia, oltre il quale il router di una sede si sente sulla stessa porta della radio.

Le due reti vere non sono una famiglia: le loro prove (H5, H6, H7 e C19, H13, H15, H17; in T1b H14 e C16, I65) stanno con le altre misure in `model-fixtures.test.ts` (Step 1b). **Revisione finale del 15/10 (verifiche UV1 e UV2):** prima la «famiglia 4» erano le due fixture vere e la famiglia 1 «la forma della rete B», mancava una rete con hypervisor inventata, e diverse prove promettevano famiglie che non toccavano; la famiglia 4 inventata ha anche trovato un difetto della misura C4 (`lineeCucite` non abbinava le schede col MAC della scansione: corretto nel Task 4).

Una prova per criterio e per famiglia, con nomi, IP e MAC inventati; i nomi scelti hanno il disegno dei nomi veri («BR_…», «VL_…») ma nessuna regola li conosce (G17, I58). Dove una regola del passaggio universale decide il criterio, la prova la spegne e guarda l'errore. I titoli delle prove nominano solo le famiglie che la prova tocca. I criteri che arrivano dopo T1 sono prove saltate col perché: G6 per la famiglia 3 (l'elenco chiuso di chi consuma il CDP sta nel lettore SNMP, che in T1 non cambia) e G11-G16 (T3); di G14 la parte di T1 (un uplink senza fili) ha la sua prova. Il resoconto di T1 riporta le righe «G… · famiglie …» così come le stampa `node --test` (Task 12). Le parti di T1b (G10 senza radici sole, «hypervisor» solo con una prova, il telefono che si annuncia via CDP) le aggiunge il Task 13.

**Files:**
- Create: `src/lib/topology/__tests__/support/reti-campione.ts`
- Create: `src/lib/topology/__tests__/reti-campione.test.ts`
- Modify: `src/lib/topology/__tests__/model-fixtures.test.ts` (le misure sulle due reti vere, Step 1b)

**Interfaces:**
- Consumes: Task 3 (`traduciPorta`), Task 4 (`padriDi`, `lineeCucite`, `lineeDaNomeScelto`), Task 5 (`ports`, `via`, `remote_platform` nell'ingresso), Task 6 (`REGOLE_T1`, `NOMI_REGOLE`, `type RegolaUniversale`, `buildTopologyModel(input, regole)`), Task 7 (`comeDi`, `segmenti`, le fixture riestratte), Task 9 (§13.7.8), `computeMapView` (`map-compute.ts`), `baseInput`, `dev`, `host` (`__tests__/support/righe.ts`).
- Produces (da `src/lib/topology/__tests__/support/reti-campione.ts`, solo per le prove):

```ts
export const ORA: string;
export const ORA_CONTROLLER: string;
export function riga(r: Partial<ModelNeighborRow> & Pick<ModelNeighborRow, "device_id" | "local_port">): ModelNeighborRow;
export function porte(device_id: number, elenco: Array<[number, string, string | null]>): ModelPortRow[];
export function soloMikrotik(): TopologyModelInput;      // famiglia 1
export function soloUnifi(): TopologyModelInput;         // famiglia 2
export function altreMarcheSnmp(): TopologyModelInput;   // famiglia 3
export function conHypervisor(): TopologyModelInput;     // famiglia 4
export function mista(): TopologyModelInput;             // famiglia 5
```

- [ ] **Step 1: le prove** — `src/lib/topology/__tests__/reti-campione.test.ts`, intero:

```ts
/**
 * Reti-campione (spec topologia §13.12.2) e criteri generali G1-G17 (§13.3.0): una prova per criterio e per famiglia. Vincolo 9
 * di Riccardo (14/10 sera): «il piano deve essere universale» — le regole valgono per ogni rete e ogni marca. Le cinque famiglie
 * sono reti inventate; il cliente A e la rete dell'hub sono le due misure su reti vere, e le loro prove stanno con le altre misure
 * in `model-fixtures.test.ts` (C e H, non G). Una prova saltata dice perché il criterio non si applica in T1 (e in quale tappa
 * arriva); una prova «da fare» (todo) è un caso che le regole di oggi sbagliano, portato a Riccardo. Il resoconto di T1 riporta
 * le righe «G… · famiglie …» così come le stampa `node --test` (Task 12). Dove una regola del passaggio universale (§13.16)
 * decide il criterio, la prova la spegne e guarda l'errore.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { traduciPorta } from "@/lib/topology/lettori/traduci";
import { comeDi } from "@/lib/topology/links";
import { computeMapView } from "@/lib/topology/map-compute";
import { lineeCucite, padriDi } from "@/lib/topology/misura";
import { buildTopologyModel } from "@/lib/topology/model";
import type { TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";
import { REGOLE_T1, type RegolaUniversale } from "@/lib/topology/regole";
import { altreMarcheSnmp, conHypervisor, mista, soloMikrotik, soloUnifi } from "./support/reti-campione";

const modello = (i: TopologyModelInput, senza?: RegolaUniversale): TopologyModel =>
  buildTopologyModel(i, new Set([...REGOLE_T1].filter((r) => r !== senza)));
function albero(m: TopologyModel): { testa: string | null; padri: Record<string, string | null> } {
  const c = computeMapView(m, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
  return { testa: c.head, padri: padriDi(c.tree) };
}
/** Le linee coi due capi, le fonti, il genere (se c'è) e gli altri cavi visti. */
const linee = (m: TopologyModel): string[] =>
  m.links.map((l) => `${l.a} ${l.aPort || "?"} ↔ ${l.b} ${l.bPort || "?"} · ${l.sources.join("+")}${l.medium ? ` · ${l.medium}` : ""}${l.altriCavi ? ` · altri ${l.altriCavi.map((c) => `${c.aPort}↔${c.bPort}`).join(",")}` : ""}`).sort();
const FAMIGLIE: Array<[string, () => TopologyModelInput]> = [["1", soloMikrotik], ["2", soloUnifi], ["3", altreMarcheSnmp], ["4", conHypervisor], ["5", mista]];

// ─── Le tabelle attese di T1, famiglia per famiglia: collegamenti coi due capi, «Da sistemare», testa, padri ───

test("famiglia 1 · solo MikroTik: la tabella attesa di T1", () => {
  const m = modello(soloMikrotik());
  assert.deepEqual(linee(m), [
    "dev:1 sfp-sfpplus1 ↔ dev:11 sfp-sfpplus10 · lldp",
    "dev:11 sfp-sfpplus2 ↔ dev:21 sfp-sfpplus1 · lldp",
    "dev:11 sfp-sfpplus5 ↔ dev:41 enp1s0f0 · lldp",
    "dev:3 bond2 ↔ host:61 ? · mac_table",
    "dev:3 sfp-sfpplus1 ↔ dev:1 sfp-sfpplus2 · lldp · altri sfp-sfpplus3↔sfp-sfpplus4",
    "dev:3 sfp-sfpplus5 ↔ host:71 eth0 · lldp",
    "dev:3 sfp-sfpplus6 ↔ host:72 eth0 · lldp",
    "dev:3 sfp28-1 ↔ dev:11 sfp28-1 · lldp · altri sfp28-2↔sfp28-2",
    "dev:51 ether1 ↔ dev:3 ? · mndp",
  ]);
  assert.deepEqual([m.segmenti, m.isolated], [{}, []]);
  assert.deepEqual(albero(m), {
    testa: "dev:3",
    padri: { "dev:1": "dev:11", "dev:11": "dev:3", "dev:21": "dev:11", "dev:3": null, "dev:41": "dev:11", "dev:51": "dev:3", "host:61": "dev:3", "host:71": "dev:3", "host:72": "dev:3" },
  });
});

test("famiglia 2 · solo UniFi: la tabella attesa di T1 (WAN e LAN del gateway verso lo stesso switch: la linea tiene un cavo, l'altro fra gli altri cavi visti; la WAN come uplink è «contro verso» fino a T3, G13)", () => {
  const m = modello(soloUnifi());
  assert.deepEqual(linee(m), [
    "dev:1 SFP+ 1 ↔ dev:2 SFP28 25 · unifi_uplink+lldp · altri eth10↔SFP+ 2",
    "dev:2 SFP+ 5 ↔ host:8 eno1 · lldp",
    "dev:2 SFP+ 9 - srv-b ↔ host:7 enp1s0 · lldp",
    "dev:3 SFP+ 1 ↔ dev:2 SFP+ 1 · unifi_uplink+lldp",
    "dev:4 Port 1 ↔ dev:3 Port 7 · unifi_uplink+lldp",
    "dev:5 Port 1 ↔ dev:3 Port 8 · unifi_uplink+lldp",
    "dev:6 ? ↔ dev:5 ? · unifi_uplink · wireless",
  ]);
  assert.deepEqual([m.segmenti, m.isolated], [{ "dev:3|port20": ["host:31", "host:32"] }, ["host:31", "host:32"]]);
  assert.deepEqual(albero(m), {
    testa: "dev:1",
    padri: { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2", "dev:4": "dev:3", "dev:5": "dev:3", "dev:6": "dev:5", "host:7": "dev:2", "host:8": "dev:2" },
  });
});

test("famiglia 3 · altre marche via SNMP: la tabella attesa di T1", () => {
  const m = modello(altreMarcheSnmp());
  assert.deepEqual(linee(m), ["dev:1 Gi0/0/1 ↔ dev:2 Gi1/0/24 · lldp", "dev:2 Te1/1/1 ↔ dev:3 Te1/1/1 · cdp", "dev:3 Gi1/0/2 ↔ dev:4 1/1/24 · lldp"]);
  assert.deepEqual(albero(m), { testa: "dev:1", padri: { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2", "dev:4": "dev:3" } });
});

test("famiglia 4 · con hypervisor: la tabella attesa di T1 (i dati a 10G sul core, la gestione a 1G come ridondanza; le VM dentro i loro hypervisor)", () => {
  const m = modello(conHypervisor());
  assert.deepEqual(linee(m), [
    "dev:2 SFP+ 1 ↔ dev:1 sfp-sfpplus1 · unifi_uplink+lldp",
    "dev:2 SFP+ 3 - pve-1 ↔ dev:41 02:00:f4:00:41:a1 · lldp+vm_mac",
    "dev:2 SFP+ 7 ↔ dev:42 ? · mac_table+vm_mac",
    "dev:3 Port 1 ↔ dev:41 ? · mac_table",
    "dev:3 Port 2 ↔ dev:42 02:00:f4:00:42:b2 · lldp",
    "dev:3 Port 3 ↔ host:49 ? · mac_table",
    "dev:3 SFP+ 1 ↔ dev:2 SFP+ 2 · unifi_uplink+lldp",
    "dev:51 ether1 ↔ dev:1 ? · mndp",
  ]);
  assert.deepEqual([m.segmenti, m.isolated], [{}, []]);
  assert.deepEqual(m.vms.map((v) => [v.id, v.nodeId, v.hypervisorNodeId]), [
    ["vm:41:101", "dev:51", "dev:41"], ["vm:41:102", "dev:52", "dev:41"], ["vm:41:103", null, "dev:41"], ["vm:42:201", null, "dev:42"], ["vm:42:202", null, "dev:42"],
  ]);
  assert.deepEqual(albero(m), { testa: "dev:1", padri: { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2", "dev:41": "dev:2", "dev:42": "dev:2", "dev:51": "dev:1", "host:49": "dev:3" } });
});

test("famiglia 5 · mista: la tabella attesa di T1 (il segmento della WAN e il ponte radio non danno cavi: chi resta senza collegamenti è «Da sistemare», il salto radio arriva in T3)", () => {
  const m = modello(mista());
  assert.deepEqual(linee(m), [
    "dev:2 ether2 ↔ dev:3 Port 2 · lldp",
    "dev:3 Port 1 ↔ dev:1 ether2 · unifi_uplink+lldp",
    "dev:3 Port 24 ↔ dev:4 Gi1/0/48 · lldp",
    "dev:4 Gi1/0/5 ↔ host:81 Port 1 · cdp",
  ]);
  assert.deepEqual(m.segmenti, { "dev:1|ether1": ["dev:2", "host:61"], "dev:1|ether5": ["dev:5", "host:71"], "dev:2|ether1": ["dev:1", "host:61"], "dev:5|ether1": ["dev:1", "host:72"] });
  assert.deepEqual(m.isolated, ["dev:5", "host:61", "host:71", "host:72"]);
  assert.deepEqual(m.portClients.map((p) => [p.nodeId, p.port, p.clients.map((c) => c.nodeId)]), [["dev:4", "Gi1/0/10", ["host:91"]]]);
  assert.deepEqual(albero(m), { testa: "dev:1", padri: { "dev:1": null, "dev:2": "dev:3", "dev:3": "dev:1", "dev:4": "dev:3", "host:81": "dev:4" } });
});

// ─── G1-G10, G14 (la parte di T1) e G17, famiglia per famiglia ───

test("G1 · famiglie 1, 2, 3, 4, 5 · le due porte di una linea vengono da una prova sola: nessuna linea cucita", () => {
  for (const [f, crea] of FAMIGLIE) { const i = crea(); assert.deepEqual(lineeCucite(i, modello(i)).map((l) => l.id), [], `famiglia ${f}`); }
});

test("G2 · famiglie 1, 3, 5 · nessun cavo da un'interfaccia logica né da un nome scelto (per chi ha il traduttore del suo prodotto)", () => {
  const porteDi = (m: TopologyModel) => m.links.flatMap((l) => [l.aPort, l.bPort, ...(l.altriCavi ?? []).flatMap((c) => [c.aPort, c.bPort])]);
  // famiglia 1: la linea fra i due router e quella del router virtuale non passano da una VLAN dal nome scelto (H7, I58)
  assert.deepEqual(porteDi(modello(soloMikrotik())).filter((p) => /^(VL_|BR_|eoip|wg)/.test(p)), []);
  assert.equal(porteDi(modello(soloMikrotik(), "nome-scelto-non-fisico")).some((p) => p.startsWith("VL_")), true, "regola spenta: la VLAN torna");
  // famiglia 3: col traduttore generico «Vlan100» è logica e non dà cavi; «Gi0/0/1» del router di un'altra marca sì (come prima)
  assert.equal(porteDi(modello(altreMarcheSnmp())).includes("Vlan100"), false);
  assert.deepEqual(linee(modello(altreMarcheSnmp(), "nome-scelto-non-fisico")), linee(modello(altreMarcheSnmp())), "il generico non dipende dalla regola");
  // famiglia 5: coi nomi di fabbrica la regola non toglie niente
  assert.deepEqual(linee(modello(mista(), "nome-scelto-non-fisico")), linee(modello(mista())));
});

test("G3 · famiglie 1, 5 · «nel bridge» dalla forma della riga, con qualunque nome del bridge (il fatto in T1; l'effetto «instradato» in T3)", () => {
  const nelBridge = (i: TopologyModelInput, device_id: number, porta: string) => traduciPorta(porta, "locale", comeDi(i)(`dev:${device_id}`, "device", null)).nelBridge;
  const f1 = soloMikrotik();
  assert.deepEqual(f1.neighbors.filter((n) => n.device_id === 3 && n.local_port.includes(",")).map((n) => nelBridge(f1, 3, n.local_port)), Array(9).fill(true), "le 9 righe della testa con un contenitore, l'EoIP compreso");
  assert.deepEqual([nelBridge(f1, 1, "sfp-sfpplus2"), nelBridge(f1, 1, "sfp-sfpplus4"), nelBridge(f1, 1, "sfp-sfpplus1,BR_FX"), nelBridge(f1, 21, "sfp-sfpplus1,bridge")], [false, false, true, true]);
  const f5 = mista();
  assert.deepEqual([nelBridge(f5, 1, "ether2,bridge"), nelBridge(f5, 1, "ether5,bridge"), nelBridge(f5, 1, "ether1")], [true, true, false]);
});

test("G4 · famiglie 1, 2, 5 · gli apparati di una porta si contano per apparato: due o più fanno un segmento, uno è il cavo", () => {
  // famiglia 1: il secondo router sente la testa con due MAC sulla stessa porta (I60); sul fascio, il CDP inoltrato non conta
  assert.deepEqual(modello(soloMikrotik()).segmenti, {});
  assert.deepEqual(modello(soloMikrotik(), "conto-per-apparato").segmenti, { "dev:1|sfp-sfpplus4": [] }, "regola spenta: il segmento falso");
  // famiglia 2: due switch di laboratorio dietro uno switch muto sulla stessa porta
  assert.deepEqual(Object.keys(modello(soloUnifi()).segmenti ?? {}), ["dev:3|port20"]);
  // famiglia 5: il modem e i due router sulla WAN; la radio vicina e il router della sede oltre il ponte
  assert.deepEqual(Object.keys(modello(mista()).segmenti ?? {}).sort(), ["dev:1|ether1", "dev:1|ether5", "dev:2|ether1", "dev:5|ether1"]);
});

test("G5 · famiglia 1 · una VLAN su più porte d'accesso non è un segmento: un cavo per porta", () => {
  const m = modello(soloMikrotik());
  assert.deepEqual(m.links.filter((l) => l.b === "host:71" || l.b === "host:72").map((l) => [l.aPort, l.bPort]), [["sfp-sfpplus5", "eth0"], ["sfp-sfpplus6", "eth0"]]);
});

test("G6 · famiglie 1, 5 · gli annunci che attraversano gli apparati non fanno cavi; fra router solo come unico vicino, e la fonte lo dice («probabile» da T3)", () => {
  const m = modello(soloMikrotik());
  // SW-A si annuncia via CDP inoltrato sui membri del fascio della testa: nessun cavo fra la testa e SW-A
  assert.equal(m.links.some((l) => [l.a, l.b].sort().join("|") === "dev:21|dev:3"), false);
  // il router virtuale sente la testa via MNDP, unico vicino sulla sua ether1: un collegamento dall'annuncio, senza porta remota
  assert.deepEqual(m.links.filter((l) => l.a === "dev:51").map((l) => [l.aPort, l.bPort, l.source]), [["ether1", "", "mndp"]]);
  // famiglia 5: l'annuncio del router attraversa lo switch del controller fino al router di riserva: nessun cavo fra i due router
  assert.equal(modello(mista()).links.some((l) => [l.a, l.b].sort().join("|") === "dev:1|dev:2"), false);
});

test("G6 · famiglia 3 · CDP inoltrato da uno switch che non è Cisco", { skip: "T3: l'elenco chiuso di chi consuma il CDP sta nel lettore SNMP (§13.5.4); in T1 il lettore SNMP non cambia" }, () => {});

test("G7 · famiglie 2, 4 · la stessa porta scritta in modi diversi è una porta sola; un nome doppio non si risolve per nome; la velocità per chiave", () => {
  const m = modello(soloUnifi());
  const verso = (mm: TopologyModel, h: string) => mm.links.find((l) => l.b === h)!;
  assert.deepEqual([verso(m, "host:7").aPort, verso(m, "host:7").speedMbps], ["SFP+ 9 - srv-b", 10000], "«SFP_ 9 - etichetta» del controller è «SFP+ 9 - etichetta»");
  assert.deepEqual([verso(m, "host:8").aPort, verso(m, "host:8").speedMbps], ["SFP+ 5", 10000], "nome doppio: porta non nota, velocità sì (I70)");
  assert.equal(verso(modello(soloUnifi(), "velocita-nomi-doppi"), "host:8").speedMbps, null, "regola spenta");
  // famiglia 4: l'etichetta del core e il bond sulle due «SFP+ 7»; spenta la regola, pve-2 finisce sotto la sua gestione a 1G (H13)
  const h = modello(conHypervisor());
  assert.deepEqual(h.links.filter((l) => l.b === "dev:41" || l.b === "dev:42").map((l) => [l.a, l.aPort, l.b, l.speedMbps]).sort(), [
    ["dev:2", "SFP+ 3 - pve-1", "dev:41", 10000], ["dev:2", "SFP+ 7", "dev:42", 10000], ["dev:3", "Port 1", "dev:41", 1000], ["dev:3", "Port 2", "dev:42", 1000],
  ]);
  assert.equal(albero(modello(conHypervisor(), "velocita-nomi-doppi")).padri["dev:42"], "dev:3", "regola spenta: sotto la porta di gestione");
});

test("G8 · famiglie 1, 2, 3, 4, 5 · nessuna testa né padre per ordine di id prima delle prove", () => {
  assert.equal(albero(modello(soloMikrotik())).testa, "dev:3", "la testa è il gateway di più reti, non l'id più basso (I63)");
  assert.equal(albero(modello(soloMikrotik(), "testa-per-reti")).testa, "dev:1", "regola spenta: vince l'id");
  for (const [f, crea] of FAMIGLIE.slice(1)) assert.equal(albero(modello(crea())).testa, "dev:1", `famiglia ${f}`);
});

test("G9 · famiglia 4 · un apparato non è vicino né client di sé stesso; una VM non fa da padre al suo hypervisor", () => {
  // la VM firewall (registrata come switch) legge la sua tabella MAC: ci sono le sue schede e pve-1. Nessun collegamento fra i due.
  const tra = (m: TopologyModel, a: string, b: string) => m.links.some((l) => [l.a, l.b].sort().join("|") === [a, b].sort().join("|"));
  const m = modello(conHypervisor());
  assert.equal(tra(m, "dev:41", "dev:52"), false);
  assert.equal(Object.values(albero(m).padri).includes("dev:52"), false);
  const senza = modello(conHypervisor(), "vm-e-mac-propri");
  assert.equal(tra(senza, "dev:41", "dev:52"), true, "regola spenta: il collegamento falso");
  assert.equal(albero(senza).padri["dev:52"], null, "regola spenta: la VM diventa una radice sola");
});

test("G10 · famiglie 2, 5 · chi resta senza collegamenti su un segmento è «Da sistemare», non una radice sola (la parte di T1)", () => {
  const m = modello(soloUnifi());
  assert.deepEqual(m.isolated, ["host:31", "host:32"]);
  assert.equal(Object.values(albero(m).padri).filter((p) => p === null).length, 1, "una radice sola: il gateway");
  const x = modello(mista());
  for (const id of ["host:61", "host:71", "host:72"]) assert.equal(x.isolated.includes(id), true, id);
  assert.equal(Object.values(albero(x).padri).filter((p) => p === null).length, 1, "una radice sola: il router");
});

test("G14 · famiglia 2 · la parte di T1: un uplink senza fili (AP in mesh) è senza fili", () => {
  assert.deepEqual(modello(soloUnifi()).links.filter((l) => l.a === "dev:6").map((l) => [l.b, l.medium]), [["dev:5", "wireless"]]);
});

test("G17 · famiglie 1, 2, 4 · nessuna regola conosce un nome scelto: nomi inventati a caso danno gli stessi fatti", () => {
  // I nomi scelti (bridge, VLAN, tunnel della famiglia 1; le etichette delle porte delle famiglie 2 e 4) rinominati a caso,
  // tenendo la forma della riga: stesse linee, stessi padri.
  const SCELTI = ["BR_RP", "BR_AGG", "BR_FX", "VL_16_QWE", "VL_20_ABC", "VL_88_WAN", "VL_10_LAN", "srv-b", "pve-1"];
  const A_CASO = ["kq7-Zeta", "Xu_ponte", "mappa9", "Rete Nord", "Tr_00x", "uplink-2", "NODO-z", "armadio 3", "Qz_lab"];
  const pezzi = (s: string, da: string[], a: string[]) => s.split(/([,/]| - )/).map((p) => (da.includes(p) ? a[da.indexOf(p)] : p)).join("");
  const indietro = (s: string) => A_CASO.reduce((x, n, k) => x.split(n).join(SCELTI[k]), s);
  const rinomina = (i: TopologyModelInput): TopologyModelInput => ({
    ...i,
    neighbors: i.neighbors.map((n) => ({ ...n, local_port: pezzi(n.local_port, SCELTI, A_CASO), remote_port: pezzi(n.remote_port, SCELTI, A_CASO) })),
    ports: (i.ports ?? []).map((p) => ({ ...p, port_name: pezzi(p.port_name, SCELTI, A_CASO) })),
    macPorts: i.macPorts.map((r) => ({ ...r, port_name: pezzi(r.port_name, SCELTI, A_CASO) })),
  });
  for (const [f, crea] of [FAMIGLIE[0], FAMIGLIE[1], FAMIGLIE[3]]) {
    const i = crea(), j = rinomina(i);
    assert.notDeepEqual(j.neighbors, i.neighbors, `famiglia ${f}: la prova rinomina davvero`);
    assert.deepEqual(linee(modello(j)).map(indietro), linee(modello(i)), `famiglia ${f}`);
    assert.deepEqual(albero(modello(j)), albero(modello(i)), `famiglia ${f}`);
  }
});

// ─── Criteri che arrivano dopo T1 (§13.3.0): saltati col perché, una riga per famiglia ───
for (const [g, famiglie, tappa] of [
  ["G11", "1, 2, 3", "T3: il fascio come linea sola, provato da LACP, dalla forma o dal controller"],
  ["G12", "2, 3, 5", "T3: l'albero dallo spanning tree"],
  ["G13", "1, 2, 5", "T3: il collegamento instradato e la WAN del gateway"],
  ["G14", "1, 5", "T3: tunnel e ponti radio (il senza fili è già in T1: famiglia 2)"],
  ["G15", "1, 4", "T3: router e firewall in una VM dentro il loro hypervisor (G9 è già in T1)"],
  ["G16", "tutte", "T3: la stessa rete in quattro letture"],
] as const) test(`${g} · famiglie ${famiglie}`, { skip: tappa }, () => {});
```

- [ ] **Step 1b: le misure sulle due reti vere** — in fondo a `src/lib/topology/__tests__/model-fixtures.test.ts` (l'import `import { lineeCucite } from "@/lib/topology/misura";` diventa `import { lineeCucite, lineeDaNomeScelto } from "@/lib/topology/misura";`, e accanto `import { comeDi } from "@/lib/topology/links";`, `import { traduciPorta } from "@/lib/topology/lettori/traduci";`, `import { REGOLE_T1 } from "@/lib/topology/regole";`; `carica`, `computeMapView` e `padreDi` ci sono già, dal Task 7):

```ts
// ─── Passaggio universale (spec §13.16) sulle due reti vere: le misure C e H ───
// Fino alla verifica del 15/10 erano la «famiglia 4» delle reti-campione; sono misure su due reti vere, non criteri generali
// (vincolo 9: le famiglie sono reti inventate). Come `MISURATI`, se cambiano con la riestrazione delle fixture la causa si
// legge con `misura-cavi --nomi` sulla copia, e non si abbassa la prova. Id (interi del DB, non identificano nessuno): sull'hub
// router = dev:1, aggregazione = dev:11, hypervisor sul nome doppio = dev:4, firewall virtuale = dev:15.
const FIXTURE_VERE = ["topologia-cliente-a.json", "topologia-domarc.json"] as const;
const automatico = (m: ReturnType<typeof buildTopologyModel>) =>
  computeMapView(m, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });

/**
 * La rete dell'hub con la VM che le fixture non hanno (spec §13.7.8, H15): il firewall virtuale (dev:15, registrato come switch)
 * è una VM dell'hypervisor dev:4, accesa, col MAC della sua scheda che compare nella sua stessa tabella. Il MAC e il nome
 * dell'hypervisor si leggono dalla fixture, perché la riestrazione li rinomina.
 */
function hubConFirewallVirtuale(): TopologyModelInput {
  const i = carica("topologia-domarc.json");
  const propri = new Set(i.knownMacs.filter((k) => k.device_id === 15).map((k) => k.mac.toLowerCase()));
  const scheda = i.macPorts.find((r) => r.device_id === 15 && propri.has(r.mac.toLowerCase()));
  const hv = i.devices.find((d) => d.id === 4);
  if (!scheda || !hv) throw new Error("fixture dell'hub senza il firewall virtuale (dev:15) o senza l'hypervisor (dev:4): riestratta male?");
  return {
    ...i,
    scanHosts: [{ scannedDeviceId: 4, hostname: hv.name, ips: [hv.host], macs: [] }],
    vms: [{ scannedDeviceId: 4, vmid: 120, name: "fw-virtuale", node: hv.name, status: "running", type: "qemu", macs: [scheda.mac], ips: [], scannedAt: "2026-10-13T06:00:00.000Z" }],
  };
}

test("H7 (hub) e C19 (cliente A): nessuna linea di un router col traduttore del suo prodotto da un nome scelto", () => {
  for (const nome of FIXTURE_VERE) { const i = carica(nome); assert.deepEqual(lineeDaNomeScelto(i, buildTopologyModel(i)).map((l) => l.id), [], nome); }
});

test("H5: sull'hub un segmento solo, coi soli switch di laboratorio (host), tutti in «Da sistemare»", () => {
  const m = buildTopologyModel(carica("topologia-domarc.json"));
  const membri = Object.values(m.segmenti ?? {}).flat();
  assert.equal(Object.keys(m.segmenti ?? {}).length, 1);
  assert.equal(membri.every((id) => id.startsWith("host:")), true);
  for (const id of membri) assert.equal(m.isolated.includes(id), true, id);
});

test("H6: sulle due reti un segmento nasce solo da una porta fisica certa (niente «eth0»)", () => {
  for (const nome of FIXTURE_VERE) {
    const i = carica(nome);
    const come = comeDi(i);
    for (const k of Object.keys(buildTopologyModel(i).segmenti ?? {})) {
      const [nodo, porta] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
      const n = i.neighbors.find((r) => `dev:${r.device_id}` === nodo && traduciPorta(r.local_port, "locale", come(nodo, r.source, null)).nome.replace(/\s+/g, "").toLowerCase() === porta);
      assert.ok(n, `${nome} ${k}`);
      assert.equal(traduciPorta(n.local_port, "locale", come(nodo, n.source, null)).fisica, true, `${nome} ${k}`);
    }
  }
});

test("H13: sull'hub l'hypervisor sul nome doppio dell'aggregazione sta sotto l'aggregazione, a 10G", () => {
  const m = buildTopologyModel(carica("topologia-domarc.json"));
  assert.equal(padreDi(automatico(m).tree, "dev:4"), "dev:11");
  assert.equal(m.links.find((l) => [l.a, l.b].sort().join("|") === "dev:11|dev:4")?.speedMbps, 10000);
});

test("H17 e C19: la testa proposta è il router sulle due reti", () => {
  for (const nome of FIXTURE_VERE) assert.equal(automatico(buildTopologyModel(carica(nome))).head, "dev:1", nome);
});

test("H15: sull'hub con la VM del firewall virtuale nessun collegamento fra la VM e il suo hypervisor; spenta la regola, torna", () => {
  const i = hubConFirewallVirtuale();
  const m = buildTopologyModel(i);
  const tra = (mm: ReturnType<typeof buildTopologyModel>) => mm.links.some((l) => [l.a, l.b].sort().join("|") === "dev:15|dev:4");
  assert.equal(m.vms.find((v) => v.nodeId === "dev:15")?.hypervisorNodeId, "dev:4");
  assert.equal(tra(m), false);
  assert.notEqual(padreDi(automatico(m).tree, "dev:4"), "dev:15");
  assert.equal(tra(buildTopologyModel(i, new Set([...REGOLE_T1].filter((r) => r !== "vm-e-mac-propri")))), true, "regola spenta: il collegamento falso");
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/reti-campione.test.ts > "$SCRATCH/t1-10c.log" 2>&1; echo "exit=$?"`
Expected: `exit=1` (manca `./support/reti-campione`). Che le prove sappiano fallire per la ragione giusta lo dicono le asserzioni «regola spenta» dentro le prove e lo Step 4.

- [ ] **Step 3: le reti-campione** — `src/lib/topology/__tests__/support/reti-campione.ts`, intero:

```ts
/**
 * Reti-campione per famiglia (spec topologia §13.12.2; vincolo 9 di Riccardo, 14/10 sera: «il piano deve essere universale»).
 * Ogni famiglia è una rete inventata, scritta nella forma vera delle sue letture — le righe come le scrivono i lettori di oggi:
 * `/ip neighbor` di RouterOS (il contenitore dopo la virgola, il percorso del bridge nella porta remota, il MAC
 * dell'interfaccia che annuncia), il controller (le porte «SFP_ N» nella tabella LLDP, l'uplink, «ethN» del gateway), SNMP (i
 * nomi di porta delle altre marche), la scansione delle VM. Nomi, IP e MAC inventati; i nomi scelti dal cliente hanno il
 * disegno dei nomi veri («BR_…», «VL_…») ma nessuna regola li conosce (I58). Il cliente A e la rete dell'hub sono misure, non
 * famiglie: le loro prove stanno in `model-fixtures.test.ts`. Un caso nuovo visto sul campo diventa prima una riga di una
 * famiglia, poi codice (§13.13.3, punto 15).
 */
import type { ModelNeighborRow, ModelPortRow, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./righe";

export const ORA = "2026-10-13 11:00:00";
export const ORA_CONTROLLER = "2026-10-13 03:00:00";

/** Una riga dei vicini con i default dei lettori di oggi (LLDP, letta dall'apparato, adesso). */
export function riga(r: Partial<ModelNeighborRow> & Pick<ModelNeighborRow, "device_id" | "local_port">): ModelNeighborRow {
  return { remote_device_name: "", remote_port: "", protocol: "lldp", remote_ip: null, remote_mac: null, timestamp: ORA, source: "device", ...r };
}

/** Le porte di un apparato come le scrive switch_ports: [indice, nome, velocità]. */
export function porte(device_id: number, elenco: Array<[number, string, string | null]>): ModelPortRow[] {
  return elenco.map(([port_index, port_name, speed]) => ({ device_id, port_index, port_name, speed, status: "up", stp_state: null }));
}

const mk = { vendor: "mikrotik", via: "ssh" } as const;

/**
 * Famiglia 1 · Solo MikroTik. Il router di testa (dev:3) ha un bridge dal nome scelto e VLAN dai nomi scelti, e annuncia da ogni
 * interfaccia; un fascio LACP di due cavi verso l'aggregazione (dev:11, un MikroTik), coi membri nel bridge, dove il CDP di uno
 * switch che sta dietro l'aggregazione arriva inoltrato; lo switch (dev:21) tiene il nome di fabbrica del bridge; un secondo
 * router (dev:1) con la porta radice verso l'aggregazione e due cavi diretti verso la testa, dal suo lato fuori dal bridge (in
 * due VRF), dove sente la testa con due MAC da due interfacce e con un nome annunciato diverso da quello dell'inventario; la
 * testa sente il secondo router anche su due VLAN dai nomi scelti, da sola su ognuna; un router virtuale (dev:51), VM
 * dell'hypervisor dev:41, con un tunnel WireGuard verso un router remoto non censito; un EoIP nel bridge; la WAN come VLAN su
 * due porte d'accesso (due modem); un NAS che solo la tabella MAC della testa vede, dietro un fascio. La testa ha l'id più alto
 * del secondo router ma fa da gateway di due reti (I63). Le forme vengono dai casi nati sulla rete dell'hub; la rete no.
 */
export function soloMikrotik(): TopologyModelInput {
  return baseInput({
    devices: [
      dev(1, { name: "RTR-FRONTIERA", device_type: "router", host: "10.1.0.2", ...mk }),
      dev(3, { name: "RTR-TESTA", device_type: "router", host: "10.1.0.1", ...mk }),
      dev(11, { name: "AGG-CRS", host: "10.1.0.11", ...mk }),
      dev(21, { name: "SW-A", host: "10.1.0.21", ...mk }),
      dev(41, { name: "pve-a", device_type: "server", vendor: "proxmox", host: "10.1.0.41", proxmox_scan: 1, port_count: 0 }),
      dev(51, { name: "RTR-VIRTUALE", device_type: "router", host: "10.1.0.51", ...mk }),
    ],
    hosts: [
      host(61, { ip: "10.1.0.61", mac: "02:00:b1:00:61:01", hostname: "NAS-1", classification: "nas" }),
      host(71, { ip: "10.66.0.2", mac: "02:00:b2:00:71:01", hostname: "MODEM-1", classification: "router" }),
      host(72, { ip: "10.66.0.3", mac: "02:00:b2:00:72:01", hostname: "MODEM-2", classification: "router" }),
      host(81, { ip: "10.1.10.1", mac: "02:00:a0:00:03:01" }), // il secondo indirizzo della testa, fuso per MAC
    ],
    knownMacs: [{ device_id: 3, mac: "02:00:a0:00:03:01" }, { device_id: 51, mac: "02:00:a0:00:51:01" }],
    networks: [
      { id: 1, cidr: "10.1.0.0/24", name: "lan", gateway: "10.1.0.1", location_id: null },
      { id: 2, cidr: "10.1.10.0/24", name: "servizi", gateway: "10.1.10.1", location_id: null },
      { id: 3, cidr: "10.66.0.0/24", name: "wan", gateway: null, location_id: null },
    ],
    ports: [
      ...porte(3, [[1, "sfp-sfpplus1", "10000 Mbps"], [3, "sfp-sfpplus3", "10000 Mbps"], [5, "sfp-sfpplus5", "1000 Mbps"], [6, "sfp-sfpplus6", "1000 Mbps"], [21, "sfp28-1", "25000 Mbps"], [22, "sfp28-2", "25000 Mbps"]]),
      ...porte(11, [[2, "sfp-sfpplus2", "10000 Mbps"], [5, "sfp-sfpplus5", "10000 Mbps"], [10, "sfp-sfpplus10", "10000 Mbps"], [21, "sfp28-1", "25000 Mbps"], [22, "sfp28-2", "25000 Mbps"]]),
      ...porte(21, [[1, "sfp-sfpplus1", "10000 Mbps"]]),
      ...porte(1, [[1, "sfp-sfpplus1", "10000 Mbps"], [2, "sfp-sfpplus2", "10000 Mbps"], [4, "sfp-sfpplus4", "10000 Mbps"]]),
      ...porte(51, [[1, "ether1", "1000 Mbps"]]),
    ],
    neighbors: [
      // la testa: il fascio verso l'aggregazione (LLDP sui due membri), e su un membro il CDP inoltrato di SW-A
      riga({ device_id: 3, local_port: "sfp28-1,bond1,BR_RP", remote_device_name: "AGG-CRS", remote_ip: "10.1.0.11", remote_mac: "02:00:a0:00:11:21", remote_port: "BR_AGG/bond1/sfp28-1", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "sfp28-2,bond1,BR_RP", remote_device_name: "AGG-CRS", remote_ip: "10.1.0.11", remote_mac: "02:00:a0:00:11:22", remote_port: "BR_AGG/bond1/sfp28-2", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "sfp28-1,bond1,BR_RP", remote_device_name: "SW-A", remote_ip: "10.1.0.21", remote_mac: "02:00:a0:00:21:01", remote_port: "bridge/sfp-sfpplus1", protocol: "mndp", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "sfp28-2,bond1,BR_RP", remote_device_name: "SW-A", remote_ip: "10.1.0.21", remote_mac: "02:00:a0:00:21:01", remote_port: "bridge/sfp-sfpplus1", protocol: "mndp", remote_platform: "MikroTik" }),
      // la testa sente il secondo router sui due cavi diretti, e su una VLAN dal nome scelto dove è l'unico vicino (H7)
      riga({ device_id: 3, local_port: "sfp-sfpplus1,BR_RP", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:02", remote_port: "sfp-sfpplus2", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "sfp-sfpplus3,BR_RP", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:04", remote_port: "sfp-sfpplus4", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "VL_16_QWE", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:16", remote_port: "VL_16_QWE", protocol: "mndp", remote_platform: "MikroTik" }),
      riga({ device_id: 3, local_port: "VL_20_ABC", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:20", remote_port: "VL_20_ABC", protocol: "mndp", remote_platform: "MikroTik" }),
      // la WAN come VLAN dentro il bridge, su due porte d'accesso, un modem ciascuna (G5)
      riga({ device_id: 3, local_port: "sfp-sfpplus5,BR_RP", remote_device_name: "MODEM-1", remote_ip: "10.66.0.2", remote_mac: "02:00:b2:00:71:01", remote_port: "eth0" }),
      riga({ device_id: 3, local_port: "sfp-sfpplus6,BR_RP", remote_device_name: "MODEM-2", remote_ip: "10.66.0.3", remote_mac: "02:00:b2:00:72:01", remote_port: "eth0" }),
      riga({ device_id: 3, local_port: "VL_88_WAN", remote_device_name: "MODEM-1", remote_ip: "10.66.0.2", remote_mac: "02:00:b2:00:71:01", remote_port: "eth0", protocol: "mndp" }),
      riga({ device_id: 3, local_port: "VL_88_WAN", remote_device_name: "MODEM-2", remote_ip: "10.66.0.3", remote_mac: "02:00:b2:00:72:01", remote_port: "eth0", protocol: "mndp" }),
      // un EoIP nel bridge verso una sede non censita: un tunnel, mai un cavo (G2; il tunnel in T3)
      riga({ device_id: 3, local_port: "eoip-sede2,BR_RP", remote_device_name: "RTR-SEDE2", remote_ip: "10.9.0.1", remote_mac: "02:00:a9:00:00:01", remote_port: "eoip-sede1", protocol: "mndp", remote_platform: "MikroTik" }),
      // l'aggregazione (MikroTik letto via SSH): il fascio verso la testa, SW-A, la porta radice del secondo router, l'hypervisor
      riga({ device_id: 11, local_port: "sfp28-1,bond1,BR_AGG", remote_device_name: "RTR-TESTA", remote_ip: "10.1.0.1", remote_mac: "02:00:a0:00:03:21", remote_port: "BR_RP/bond1/sfp28-1", remote_platform: "MikroTik" }),
      riga({ device_id: 11, local_port: "sfp28-2,bond1,BR_AGG", remote_device_name: "RTR-TESTA", remote_ip: "10.1.0.1", remote_mac: "02:00:a0:00:03:22", remote_port: "BR_RP/bond1/sfp28-2", remote_platform: "MikroTik" }),
      riga({ device_id: 11, local_port: "sfp-sfpplus2,BR_AGG", remote_device_name: "SW-A", remote_ip: "10.1.0.21", remote_mac: "02:00:a0:00:21:01", remote_port: "bridge/sfp-sfpplus1", remote_platform: "MikroTik" }),
      riga({ device_id: 11, local_port: "sfp-sfpplus10,BR_AGG", remote_device_name: "RTR-FRONTIERA", remote_ip: "10.1.0.2", remote_mac: "02:00:a0:00:01:01", remote_port: "BR_FX/sfp-sfpplus1", remote_platform: "MikroTik" }),
      riga({ device_id: 11, local_port: "sfp-sfpplus5,BR_AGG", remote_device_name: "pve-a", remote_ip: "10.1.0.41", remote_mac: "02:00:c1:00:41:01", remote_port: "enp1s0f0" }),
      riga({ device_id: 21, local_port: "sfp-sfpplus1,bridge", remote_device_name: "AGG-CRS", remote_ip: "10.1.0.11", remote_mac: "02:00:a0:00:11:02", remote_port: "BR_AGG/sfp-sfpplus2", remote_platform: "MikroTik" }),
      // il secondo router: la porta radice nel suo bridge; i due cavi diretti fuori dal bridge. Sente la testa col nome che lei
      // annuncia (diverso dall'inventario) e dall'indirizzo della WAN: righe non abbinate, e sulla sfp-sfpplus4 con due MAC (I60)
      riga({ device_id: 1, local_port: "sfp-sfpplus1,BR_FX", remote_device_name: "AGG-CRS", remote_ip: "10.1.0.11", remote_mac: "02:00:a0:00:11:10", remote_port: "BR_AGG/sfp-sfpplus10", remote_platform: "MikroTik" }),
      riga({ device_id: 1, local_port: "sfp-sfpplus2", remote_device_name: "testa-ccr", remote_ip: "10.66.0.1", remote_mac: "02:00:a0:00:03:11", remote_port: "BR_RP/sfp-sfpplus1", remote_platform: "MikroTik" }),
      riga({ device_id: 1, local_port: "sfp-sfpplus4", remote_device_name: "testa-ccr", remote_ip: "10.66.0.1", remote_mac: "02:00:a0:00:03:13", remote_port: "BR_RP/sfp-sfpplus3", remote_platform: "MikroTik" }),
      riga({ device_id: 1, local_port: "sfp-sfpplus4", remote_device_name: "testa-ccr", remote_ip: "10.66.0.1", remote_mac: "02:00:a0:00:03:88", remote_port: "VL_88_WAN", remote_platform: "MikroTik" }),
      // il router virtuale: sente la testa attraverso il bridge dell'hypervisor (MNDP, unico vicino); un tunnel WireGuard verso un
      // router nel cloud non censito, in un verso solo (G14: un tunnel, mai un cavo)
      riga({ device_id: 51, local_port: "ether1", remote_device_name: "RTR-TESTA", remote_ip: "10.1.0.1", remote_mac: "02:00:a0:00:03:10", remote_port: "VL_10_LAN", protocol: "mndp", remote_platform: "MikroTik" }),
      riga({ device_id: 51, local_port: "wg-cloud", remote_device_name: "RTR-CLOUD", remote_ip: "10.200.0.1", remote_mac: null, remote_port: "wg-sede", protocol: "mndp", remote_platform: "MikroTik" }),
    ],
    // il NAS lo vede solo la tabella MAC della testa, dietro un fascio senza LLDP (in T3 il partner LACP: H18)
    macPorts: [{ device_id: 3, mac: "02:00:b1:00:61:01", port_name: "bond2", timestamp: ORA, source: "device" }],
    vms: [{ scannedDeviceId: 41, vmid: 100, name: "rtr-virtuale", node: "pve-a", status: "running", type: "qemu", macs: ["02:00:a0:00:51:01"], ips: ["10.1.0.51"], scannedAt: "2026-10-13T06:00:00.000Z" }],
    scanHosts: [{ scannedDeviceId: 41, hostname: "pve-a", ips: ["10.1.0.41"], macs: [] }],
  });
}

const uf = { vendor: "ubiquiti", via: "api" } as const;
const ctrl = (r: Partial<ModelNeighborRow> & Pick<ModelNeighborRow, "device_id" | "local_port">) => riga({ source: "unifi", timestamp: ORA_CONTROLLER, ...r });

/**
 * Famiglia 2 · Solo UniFi, col controller. Il gateway del controller (dev:1, un UDM) è l'unico router, con WAN e LAN verso lo
 * stesso switch (l'aggregazione, dev:2): il controller ne segna come uplink la WAN (SFP+ 1), e il gateway scrive le sue porte
 * come «ethN», che il suo elenco non ha. L'aggregazione ha un'etichetta scritta a mano su una porta («SFP+ 9 - srv-b», che nella
 * tabella LLDP il controller scrive «SFP_ 9 - srv-b») e un nome doppio («SFP+ 5» su due porte a 10G). Uno switch senza spanning
 * tree (dev:4, uplink `disabled` su una porta accesa), un AP cablato (dev:5) e uno in mesh (dev:6); due switch di laboratorio,
 * solo host, dietro uno switch muto sulla porta 20 dello switch da 48 (dev:3).
 */
export function soloUnifi(): TopologyModelInput {
  const mac = (id: number) => `02:00:d0:00:0${id}:00`;
  return baseInput({
    devices: [
      dev(1, { name: "UDM-GW", device_type: "router", host: "10.2.0.1", controller_mac: mac(1), uplink_mac: mac(2), uplink_remote_port: 25, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(2, { name: "USW-AGG", host: "10.2.0.2", controller_mac: mac(2), ...uf }),
      dev(3, { name: "USW-48", host: "10.2.0.3", controller_mac: mac(3), uplink_mac: mac(2), uplink_remote_port: 1, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(4, { name: "FLEX-1", host: "10.2.0.4", controller_mac: mac(4), uplink_mac: mac(3), uplink_remote_port: 7, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(5, { name: "AP-1", device_type: "access_point", host: "10.2.0.5", controller_mac: mac(5), uplink_mac: mac(3), uplink_remote_port: 8, uplink_seen_at: ORA_CONTROLLER, uplink_type: "wire", ...uf }),
      dev(6, { name: "AP-2", device_type: "access_point", host: "10.2.0.6", controller_mac: mac(6), uplink_mac: mac(5), uplink_seen_at: ORA_CONTROLLER, uplink_type: "wireless", ...uf }),
    ],
    hosts: [
      host(7, { ip: "10.2.0.7", mac: "02:00:e0:00:07:01", hostname: "srv-b", classification: "server" }),
      host(8, { ip: "10.2.0.8", mac: "02:00:e0:00:08:01", hostname: "srv-c", classification: "server" }),
      host(31, { ip: "10.2.9.31", mac: "02:00:e0:00:31:01", hostname: "LAB-SW-1", classification: "switch" }),
      host(32, { ip: "10.2.9.32", mac: "02:00:e0:00:32:01", hostname: "LAB-SW-2", classification: "switch" }),
    ],
    uplinkPorts: [
      { device_id: 1, port_index: 10, port_name: "SFP+ 1" }, { device_id: 3, port_index: 49, port_name: "SFP+ 1" },
      { device_id: 4, port_index: 1, port_name: "Port 1" }, { device_id: 5, port_index: 1, port_name: "Port 1" },
    ],
    ports: [
      ...porte(1, [[1, "Port 1", "1000 Mbps"], [10, "SFP+ 1", "10000 Mbps"], [11, "SFP+ 2", "10000 Mbps"]]),
      ...porte(2, [[1, "SFP+ 1", "10000 Mbps"], [2, "SFP+ 2", "10000 Mbps"], [5, "SFP+ 5", "10000 Mbps"], [6, "SFP+ 5", "10000 Mbps"], [9, "SFP+ 9 - srv-b", "10000 Mbps"], [25, "SFP28 25", "25000 Mbps"]]),
      ...porte(3, [[7, "Port 7", "1000 Mbps"], [8, "Port 8", "1000 Mbps"], [20, "Port 20", "1000 Mbps"], [49, "SFP+ 1", "10000 Mbps"], [50, "SFP+ 2", "10000 Mbps"], [51, "SFP 1", "1000 Mbps"]]),
      ...porte(4, [[1, "Port 1", "1000 Mbps"]]).map((p) => ({ ...p, stp_state: "disabled" })),
      ...porte(5, [[1, "Port 1", "1000 Mbps"]]),
    ],
    neighbors: [
      ctrl({ device_id: 3, local_port: "SFP+ 1", remote_device_name: "USW-AGG", remote_mac: mac(2), remote_port: "SFP+ 1" }),
      ctrl({ device_id: 2, local_port: "SFP+ 1", remote_device_name: "USW-48", remote_mac: mac(3), remote_port: "SFP+ 1" }),
      // WAN e LAN del gateway: l'aggregazione e lo switch da 48 lo vedono; lui scrive le sue porte come «ethN»
      ctrl({ device_id: 2, local_port: "SFP28 25", remote_device_name: "UDM-GW", remote_mac: mac(1), remote_port: "eth9" }),
      ctrl({ device_id: 2, local_port: "SFP+ 2", remote_device_name: "UDM-GW", remote_mac: mac(1), remote_port: "eth10" }),
      ctrl({ device_id: 1, local_port: "eth9", remote_device_name: "USW-AGG", remote_mac: mac(2), remote_port: "SFP28 25" }),
      ctrl({ device_id: 1, local_port: "eth10", remote_device_name: "USW-AGG", remote_mac: mac(2), remote_port: "SFP+ 2" }),
      // l'etichetta scritta a mano e il nome doppio, come li scrive il controller nella tabella LLDP
      ctrl({ device_id: 2, local_port: "SFP_ 9 - srv-b", remote_device_name: "srv-b", remote_mac: "02:00:e0:00:07:01", remote_port: "enp1s0" }),
      ctrl({ device_id: 2, local_port: "SFP_ 5", remote_device_name: "srv-c", remote_mac: "02:00:e0:00:08:01", remote_port: "eno1" }),
      ctrl({ device_id: 3, local_port: "Port 7", remote_device_name: "FLEX-1", remote_mac: mac(4), remote_port: "Port 1" }),
      ctrl({ device_id: 3, local_port: "Port 8", remote_device_name: "AP-1", remote_mac: mac(5), remote_port: "eth0" }),
      ctrl({ device_id: 4, local_port: "Port 1", remote_device_name: "USW-48", remote_mac: mac(3), remote_port: "Port 7" }),
      // due switch di laboratorio dietro uno switch muto: la porta 20 sente due apparati (un segmento)
      ctrl({ device_id: 3, local_port: "Port 20", remote_device_name: "LAB-SW-1", remote_mac: "02:00:e0:00:31:01", remote_port: "Port 1" }),
      ctrl({ device_id: 3, local_port: "Port 20", remote_device_name: "LAB-SW-2", remote_mac: "02:00:e0:00:32:01", remote_port: "Port 1" }),
    ],
  });
}

const snmp = { vendor: "cisco", via: "snmp_v2" } as const;

/**
 * Famiglia 3 · Altre marche via SNMP. Le forme delle MIB standard e della documentazione dei produttori, **non osservate su un
 * apparato** (spec §13.12.2): porta locale LLDP tradotta da `lldpLocPortTable` («Gi1/0/24»), CDP fra due Cisco, «1/1/24» di uno
 * switch HP/Aruba. In T1 queste righe passano dal traduttore generico: un router di un'altra marca non perde i cavi che ha
 * (`fisica: null` vale «non logica» per le sue regole), e un'interfaccia logica comune («Vlan100») non dà cavi. Le altre prove
 * di questa famiglia (CDP inoltrato, fasci «Po1» e «Trk1», MSTP) arrivano col modello per cavo, in T3.
 */
export function altreMarcheSnmp(): TopologyModelInput {
  return baseInput({
    devices: [
      dev(1, { name: "RTR-C", device_type: "router", host: "10.3.0.1", ...snmp }),
      dev(2, { name: "SW-C1", host: "10.3.0.2", ...snmp }),
      dev(3, { name: "SW-C2", host: "10.3.0.3", ...snmp }),
      dev(4, { name: "SW-HP1", host: "10.3.0.4", vendor: "aruba", via: "snmp_v2" }),
    ],
    ports: [
      ...porte(1, [[1, "Gi0/0/1", "1000 Mbps"], [100, "Vlan100", null]]),
      ...porte(2, [[1, "Te1/1/1", "10000 Mbps"], [24, "Gi1/0/24", "1000 Mbps"]]),
      ...porte(3, [[1, "Te1/1/1", "10000 Mbps"], [2, "Gi1/0/2", "1000 Mbps"]]),
      ...porte(4, [[24, "1/1/24", "1000 Mbps"]]),
    ],
    neighbors: [
      riga({ device_id: 1, local_port: "Gi0/0/1", remote_device_name: "SW-C1", remote_ip: "10.3.0.2", remote_port: "Gi1/0/24" }),
      riga({ device_id: 1, local_port: "Vlan100", remote_device_name: "SW-C2", remote_ip: "10.3.0.3", remote_port: "Vlan100", protocol: "cdp" }),
      riga({ device_id: 2, local_port: "Gi1/0/24", remote_device_name: "RTR-C", remote_ip: "10.3.0.1", remote_port: "Gi0/0/1" }),
      riga({ device_id: 2, local_port: "Te1/1/1", remote_device_name: "SW-C2", remote_ip: "10.3.0.3", remote_port: "Te1/1/1", protocol: "cdp" }),
      riga({ device_id: 3, local_port: "Te1/1/1", remote_device_name: "SW-C1", remote_ip: "10.3.0.2", remote_port: "Te1/1/1", protocol: "cdp" }),
      riga({ device_id: 3, local_port: "Gi1/0/2", remote_device_name: "SW-HP1", remote_ip: "10.3.0.4", remote_port: "1/1/24" }),
      riga({ device_id: 4, local_port: "1/1/24", remote_device_name: "SW-C2", remote_ip: "10.3.0.3", remote_port: "Gi1/0/2" }),
    ],
  });
}

/**
 * Famiglia 4 · Con hypervisor (inventata). Un router (dev:1), un core del controller (dev:2) e uno switch di accesso (dev:3);
 * due nodi Proxmox (dev:41, dev:42) con la gestione a 1G sull'accesso e i dati a 10G sul core: pve-1 su una porta con
 * l'etichetta scritta a mano («SFP+ 3 - pve-1», che la tabella LLDP del controller scrive «SFP_ 3 - pve-1»), pve-2 su un bond
 * attivo e di riserva di due porte del core che il controller chiama tutte e due «SFP+ 7» (un nome doppio, tutte e due a
 * 10G). Le VM si vedono su tutte e due le porte di ogni nodo; le schede di pve-1 (dati) e di pve-2 (gestione) si
 * annunciano con l'LLDP del firmware, senza nome. Su pve-1 una VM router (dev:51) e una VM firewall registrata come switch (dev:52) che legge la sua tabella MAC: ci sono le sue schede e il MAC
 * di pve-1. La lettura delle VM di pve-2 è vecchia (aprile). Un host che la classificazione dice hypervisor, senza VM né scansione, sta
 * sulla porta 3 dell'accesso.
 */
export function conHypervisor(): TopologyModelInput {
  const M = { rtr: "02:00:f4:00:01:01", core: "02:00:f4:00:02:00", acc: "02:00:f4:00:03:00", hv1: "02:00:f4:00:41:01", hv2: "02:00:f4:00:42:01",
    nic1: "02:00:f4:00:41:a1", nic2: "02:00:f4:00:42:b2", r51: "02:00:f4:00:51:01", fwLan: "02:00:f4:00:52:01", fwWan: "02:00:f4:00:52:02", app: "02:00:f4:01:03:01",
    db: "02:00:f4:02:01:01", web: "02:00:f4:02:02:01" };
  const vm = (scannedDeviceId: number, vmid: number, name: string, node: string, macs: string[], scannedAt: string) =>
    ({ scannedDeviceId, vmid, name, node, status: "running", type: "qemu", macs, ips: [], scannedAt });
  const mp = (device_id: number, mac: string, port_name: string, source = "unifi") => ({ device_id, mac, port_name, timestamp: ORA_CONTROLLER, source });
  return baseInput({
    devices: [
      dev(1, { name: "RTR-H", device_type: "router", host: "10.4.0.1", ...mk }),
      dev(2, { name: "CORE-H", host: "10.4.0.2", controller_mac: M.core, uplink_mac: M.rtr, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(3, { name: "ACC-H", host: "10.4.0.3", controller_mac: M.acc, uplink_mac: M.core, uplink_remote_port: 2, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(41, { name: "pve-1", device_type: "server", vendor: "proxmox", host: "10.4.0.41", proxmox_scan: 1, port_count: 0 }),
      dev(42, { name: "pve-2", device_type: "server", vendor: "proxmox", host: "10.4.0.42", proxmox_scan: 1, port_count: 0 }),
      dev(51, { name: "RTR-VM", device_type: "router", host: "10.4.0.51", ...mk }),
      dev(52, { name: "FW-VM", device_type: "switch", vendor: "stormshield", via: "ssh", host: "10.4.0.52", port_count: 2 }),
    ],
    // un host che la classificazione dice hypervisor, senza VM né scansione: in T1b è un attaccato (I65)
    hosts: [host(49, { ip: "10.4.0.49", mac: "02:00:f4:00:49:01", hostname: "pve-vecchio", classification: "hypervisor" })],
    knownMacs: [{ device_id: 1, mac: M.rtr }, { device_id: 51, mac: M.r51 }, { device_id: 52, mac: M.fwLan }, { device_id: 52, mac: M.fwWan }],
    networks: [{ id: 1, cidr: "10.4.0.0/24", name: "lan", gateway: "10.4.0.1", location_id: null }],
    uplinkPorts: [{ device_id: 2, port_index: 1, port_name: "SFP+ 1" }, { device_id: 3, port_index: 25, port_name: "SFP+ 1" }],
    ports: [
      ...porte(1, [[1, "sfp-sfpplus1", "10000 Mbps"]]),
      ...porte(2, [[1, "SFP+ 1", "10000 Mbps"], [2, "SFP+ 2", "10000 Mbps"], [3, "SFP+ 3 - pve-1", "10000 Mbps"], [7, "SFP+ 7", "10000 Mbps"], [8, "SFP+ 7", "10000 Mbps"]]),
      ...porte(3, [[1, "Port 1", "1000 Mbps"], [2, "Port 2", "1000 Mbps"], [3, "Port 3", "1000 Mbps"], [25, "SFP+ 1", "10000 Mbps"]]),
    ],
    neighbors: [
      riga({ device_id: 1, local_port: "sfp-sfpplus1,bridge", remote_device_name: "CORE-H", remote_mac: M.core, remote_port: "SFP+ 1" }),
      ctrl({ device_id: 2, local_port: "SFP+ 1", remote_device_name: "RTR-H", remote_mac: M.rtr, remote_port: "sfp-sfpplus1", remote_platform: "MikroTik" }),
      ctrl({ device_id: 2, local_port: "SFP+ 2", remote_device_name: "ACC-H", remote_mac: M.acc, remote_port: "SFP+ 1" }),
      ctrl({ device_id: 3, local_port: "SFP+ 1", remote_device_name: "CORE-H", remote_mac: M.core, remote_port: "SFP+ 2" }),
      // l'LLDP del firmware della scheda di pve-1: senza nome, col MAC della scheda come porta
      ctrl({ device_id: 2, local_port: "SFP_ 3 - pve-1", remote_device_name: "", remote_mac: M.nic1, remote_port: M.nic1 }),
      ctrl({ device_id: 3, local_port: "Port 2", remote_device_name: "", remote_mac: M.nic2, remote_port: M.nic2 }),
      // la VM router sente il router attraverso il bridge dell'hypervisor (MNDP)
      riga({ device_id: 51, local_port: "ether1", remote_device_name: "RTR-H", remote_ip: "10.4.0.1", remote_mac: M.rtr, remote_port: "bridge", protocol: "mndp", remote_platform: "MikroTik" }),
    ],
    macPorts: [
      // pve-1: i dati sul core, la gestione sull'accesso; le VM si vedono da tutte e due le parti
      ...[M.hv1, M.r51, M.fwLan, M.app].map((m) => mp(2, m, "SFP+ 3 - pve-1")),
      ...[M.hv1, M.r51, M.fwLan, M.app].map((m) => mp(3, m, "Port 1")),
      // pve-2: il bond sulle due «SFP+ 7» del core; la gestione sull'accesso
      ...[M.hv2, M.db, M.web].map((m) => mp(2, m, "SFP+ 7")),
      ...[M.hv2, M.db, M.web].map((m) => mp(3, m, "Port 2")),
      mp(3, "02:00:f4:00:49:01", "Port 3"),
      // la tabella MAC della VM firewall: le sue schede e pve-1 (stessa rete), mai un cavo verso il suo hypervisor
      mp(52, M.fwLan, "lan", "device"), mp(52, M.fwWan, "wan", "device"), mp(52, M.hv1, "lan", "device"),
    ],
    vms: [
      vm(41, 101, "rtr-vm", "pve-1", [M.r51], "2026-10-13T06:00:00.000Z"),
      vm(41, 102, "fw-vm", "pve-1", [M.fwLan, M.fwWan], "2026-10-13T06:00:00.000Z"),
      vm(41, 103, "srv-app", "pve-1", [M.app], "2026-10-13T06:00:00.000Z"),
      vm(42, 201, "srv-db", "pve-2", [M.db], "2026-04-27T09:00:00.000Z"),
      vm(42, 202, "srv-web", "pve-2", [M.web], "2026-04-27T09:00:00.000Z"),
    ],
    scanHosts: [
      { scannedDeviceId: 41, hostname: "pve-1", ips: ["10.4.0.41"], macs: [M.hv1, M.nic1], scannedAt: "2026-10-13T06:00:00.000Z" },
      { scannedDeviceId: 42, hostname: "pve-2", ips: ["10.4.0.42"], macs: [M.hv2, M.nic2], scannedAt: "2026-04-27T09:00:00.000Z" },
    ],
  });
}

/**
 * Famiglia 5 · Mista (inventata). Un router MikroTik coi nomi di fabbrica (dev:1: `bridge`, nessun fascio) e un secondo
 * router di riserva (dev:2) sullo stesso segmento della WAN, con un modem (host:61): le due porte della WAN sentono due
 * apparati, nessun cavo fra loro. Uno switch del controller (dev:3) e uno switch di un'altra marca letto via SNMP (dev:4),
 * con un telefono IP che si annuncia via CDP (host:81, che la classificazione automatica dice router) e un PC che solo la
 * tabella MAC vede. Un ponte radio che si annuncia (host:71 e host:72) verso il router di una sede (dev:5): oltre la radio il
 * router della sede si sente via LLDP, sulla stessa porta della radio.
 */
export function mista(): TopologyModelInput {
  const M = { r1: "02:00:f5:00:01:01", r2: "02:00:f5:00:02:01", sw: "02:00:f5:00:03:00", cisco: "02:00:f5:00:04:01", sede: "02:00:f5:00:05:01",
    modem: "02:00:f5:00:61:01", radio1: "02:00:f5:00:71:01", radio2: "02:00:f5:00:72:01", tel: "02:00:f5:00:81:01", pc: "02:00:f5:00:91:01" };
  const cisco = { vendor: "cisco", via: "snmp_v2" } as const;
  return baseInput({
    devices: [
      dev(1, { name: "RTR-M", device_type: "router", host: "10.5.0.1", ...mk }),
      dev(2, { name: "RTR-RISERVA", device_type: "router", host: "10.5.0.2", ...mk }),
      dev(3, { name: "USW-M", host: "10.5.0.3", controller_mac: M.sw, uplink_mac: M.r1, uplink_seen_at: ORA_CONTROLLER, ...uf }),
      dev(4, { name: "SW-C", host: "10.5.0.4", ...cisco }),
      dev(5, { name: "RTR-SEDE", device_type: "router", host: "10.5.9.1", ...mk }),
    ],
    hosts: [
      host(61, { ip: "192.0.2.1", mac: M.modem, hostname: "modem", classification: "router" }),
      host(71, { ip: "10.5.0.71", mac: M.radio1, hostname: null, classification: "access_point" }),
      host(72, { ip: "10.5.0.72", mac: M.radio2, hostname: null, classification: "access_point" }),
      host(81, { ip: "10.5.0.81", mac: M.tel, hostname: "SEP0A1B2C3D4E5F", classification: "router" }),
      host(91, { ip: "10.5.0.91", mac: M.pc, hostname: "PC-91", classification: "workstation" }),
    ],
    knownMacs: [{ device_id: 1, mac: M.r1 }, { device_id: 2, mac: M.r2 }, { device_id: 4, mac: M.cisco }, { device_id: 5, mac: M.sede }],
    networks: [
      { id: 1, cidr: "10.5.0.0/24", name: "lan", gateway: "10.5.0.1", location_id: null },
      { id: 2, cidr: "10.5.9.0/24", name: "sede", gateway: "10.5.9.1", location_id: null },
    ],
    uplinkPorts: [{ device_id: 3, port_index: 1, port_name: "Port 1" }],
    ports: [
      ...porte(1, [[1, "ether1", "1000 Mbps"], [2, "ether2", "1000 Mbps"], [5, "ether5", "1000 Mbps"]]),
      ...porte(2, [[1, "ether1", "1000 Mbps"], [2, "ether2", "1000 Mbps"]]),
      ...porte(3, [[1, "Port 1", "1000 Mbps"], [2, "Port 2", "1000 Mbps"], [24, "Port 24", "1000 Mbps"]]),
      ...porte(4, [[5, "Gi1/0/5", "1000 Mbps"], [10, "Gi1/0/10", "1000 Mbps"], [48, "Gi1/0/48", "1000 Mbps"]]),
      ...porte(5, [[1, "ether1", "1000 Mbps"]]),
    ],
    neighbors: [
      // il segmento della WAN: ogni router sente il modem e l'altro router sulla sua ether1
      riga({ device_id: 1, local_port: "ether1", remote_device_name: "modem", remote_mac: M.modem, remote_port: "eth0" }),
      riga({ device_id: 1, local_port: "ether1", remote_device_name: "RTR-RISERVA", remote_mac: M.r2, remote_port: "ether1", remote_platform: "MikroTik" }),
      riga({ device_id: 2, local_port: "ether1", remote_device_name: "modem", remote_mac: M.modem, remote_port: "eth0" }),
      riga({ device_id: 2, local_port: "ether1", remote_device_name: "RTR-M", remote_mac: M.r1, remote_port: "ether1", remote_platform: "MikroTik" }),
      // le LAN dei due router verso lo switch del controller (nomi di fabbrica: «ether2,bridge»)
      riga({ device_id: 1, local_port: "ether2,bridge", remote_device_name: "USW-M", remote_mac: M.sw, remote_port: "Port 1" }),
      riga({ device_id: 2, local_port: "ether2,bridge", remote_device_name: "USW-M", remote_mac: M.sw, remote_port: "Port 2" }),
      // l'annuncio del router attraversa lo switch: sulla LAN il router di riserva lo sente via MNDP, mai un cavo (G6)
      riga({ device_id: 2, local_port: "ether2,bridge", remote_device_name: "RTR-M", remote_mac: M.r1, remote_port: "bridge", protocol: "mndp", remote_platform: "MikroTik" }),
      ctrl({ device_id: 3, local_port: "Port 1", remote_device_name: "RTR-M", remote_mac: M.r1, remote_port: "ether2", remote_platform: "MikroTik" }),
      ctrl({ device_id: 3, local_port: "Port 2", remote_device_name: "RTR-RISERVA", remote_mac: M.r2, remote_port: "ether2", remote_platform: "MikroTik" }),
      // lo switch di un'altra marca: LLDP dai due capi; il telefono via CDP
      ctrl({ device_id: 3, local_port: "Port 24", remote_device_name: "SW-C", remote_mac: M.cisco, remote_port: "Gi1/0/48" }),
      riga({ device_id: 4, local_port: "Gi1/0/48", remote_device_name: "USW-M", remote_mac: M.sw, remote_port: "Port 24" }),
      riga({ device_id: 4, local_port: "Gi1/0/5", remote_device_name: "SEP0A1B2C3D4E5F", remote_mac: M.tel, remote_port: "Port 1", protocol: "cdp", remote_platform: "Cisco IP Phone 8845" }),
      // il ponte radio: il router sente la radio vicina e, attraverso le due radio, il router della sede
      riga({ device_id: 1, local_port: "ether5,bridge", remote_device_name: "", remote_mac: M.radio1, remote_port: "" }),
      riga({ device_id: 1, local_port: "ether5,bridge", remote_device_name: "RTR-SEDE", remote_mac: M.sede, remote_port: "ether1", remote_platform: "MikroTik" }),
      riga({ device_id: 5, local_port: "ether1", remote_device_name: "", remote_mac: M.radio2, remote_port: "" }),
      riga({ device_id: 5, local_port: "ether1", remote_device_name: "RTR-M", remote_mac: M.r1, remote_port: "ether5", remote_platform: "MikroTik" }),
    ],
    macPorts: [{ device_id: 4, mac: M.pc, port_name: "Gi1/0/10", timestamp: ORA, source: "device" }],
  });
}
```

- [ ] **Step 4: verdi, e ogni regola le fa cadere**

Run: `node --import tsx --test src/lib/topology/__tests__/reti-campione.test.ts > "$SCRATCH/t1-10c.log" 2>&1; echo "exit=$?"; grep -E "^# (tests|pass|fail|skipped)" "$SCRATCH/t1-10c.log"`
Expected: `exit=0`; `# tests 24`, `# pass 17`, `# fail 0`, `# skipped 7` (G6 · famiglia 3 e G11-G16). Poi `node --import tsx --test src/lib/topology/__tests__/model-fixtures.test.ts` → `exit=0` (le sei misure nuove verdi sulle fixture riestratte nel Task 7). Verificato il 15/10 sullo stato intero del piano (revisione finale), con le fixture riestratte dalle copie di P3.

Poi che ogni regola del passaggio universale sia portante: questo script, nello scratchpad e non nel repo (`$SCRATCH/sensibilita-rc.ts`), spegne una regola per volta e dice quali famiglie cambiano (linee coi due capi e la velocità, segmenti, «Da sistemare», testa, padri):

```ts
/** Task 10c, Step 4 (nello scratchpad, non nel repo): per ogni regola spenta, quali reti-campione cambiano. */
import path from "node:path";
async function main(): Promise<void> {
  const radice = process.argv[2];
  const rc = await import(path.join(radice, "src/lib/topology/__tests__/support/reti-campione.ts"));
  const { buildTopologyModel } = await import(path.join(radice, "src/lib/topology/model.ts"));
  const { computeMapView } = await import(path.join(radice, "src/lib/topology/map-compute.ts"));
  const { padriDi } = await import(path.join(radice, "src/lib/topology/misura.ts"));
  const { REGOLE_T1, NOMI_REGOLE } = await import(path.join(radice, "src/lib/topology/regole.ts"));
  const famiglie: Array<[string, () => unknown]> = [
    ["f1", rc.soloMikrotik], ["f2", rc.soloUnifi], ["f3", rc.altreMarcheSnmp], ["f4", rc.conHypervisor], ["f5", rc.mista],
  ];
  const foto = (i: unknown, regole: Set<string>) => {
    const m = buildTopologyModel(i, regole);
    const c = computeMapView(m, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
    const linee: string[] = m.links.map((l: { a: string; aPort: string; b: string; bPort: string; speedMbps: number | null }) => `${l.a} ${l.aPort}|${l.b} ${l.bPort}|${l.speedMbps}`).sort();
    return { linee, segmenti: JSON.stringify(m.segmenti), isolati: JSON.stringify(m.isolated), testa: c.head, padri: padriDi(c.tree) as Record<string, string | null> };
  };
  for (const r of NOMI_REGOLE as string[]) {
    const righe: string[] = [];
    for (const [f, crea] of famiglie) {
      const a = foto(crea(), new Set(REGOLE_T1)), b = foto(crea(), new Set([...REGOLE_T1].filter((x: string) => x !== r)));
      const d: string[] = [];
      const piu = b.linee.filter((x) => !a.linee.includes(x)), meno = a.linee.filter((x) => !b.linee.includes(x));
      if (piu.length || meno.length) d.push(`linee +${piu.length}/-${meno.length}`);
      if (a.segmenti !== b.segmenti) d.push(`segmenti ${b.segmenti}`);
      if (a.isolati !== b.isolati) d.push("isolati");
      if (a.testa !== b.testa) d.push(`testa ${b.testa}`);
      const cambiati = [...new Set([...Object.keys(a.padri), ...Object.keys(b.padri)])].filter((k) => a.padri[k] !== b.padri[k]);
      if (cambiati.length) d.push(`padri ${cambiati.length}`);
      righe.push(`${f}: ${d.join(", ") || "="}`);
    }
    console.log(`${r}: ${righe.join(" · ")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
```

Run: `npx tsx "$SCRATCH/sensibilita-rc.ts" "$PWD" > "$SCRATCH/t1-10c-regole.log" 2>&1; echo "exit=$?"; cat "$SCRATCH/t1-10c-regole.log"`
Expected: `exit=0`, ogni regola cambia almeno una famiglia inventata (verificato il 15/10, revisione finale):

```text
nome-scelto-non-fisico: f1: linee +2/-2 · f2: = · f3: = · f4: = · f5: =
conto-per-apparato: f1: segmenti {"dev:1|sfp-sfpplus4":[]} · f2: = · f3: = · f4: = · f5: =
vm-e-mac-propri: f1: = · f2: = · f3: = · f4: linee +1/-0, padri 1 · f5: =
testa-per-reti: f1: testa dev:1, padri 3 · f2: = · f3: = · f4: = · f5: =
velocita-nomi-doppi: f1: = · f2: linee +1/-1 · f3: = · f4: linee +1/-1, padri 1 · f5: =
```

Le righe sono di reti inventate: devono essere queste. La famiglia 5 non cambia con nessuna regola, ed è voluto: coi nomi di fabbrica e senza VM le regole del passaggio universale non hanno niente da togliere (la riga di G2 lo fissa). Le misure sulle reti vere (Step 1b) seguono invece le fixture riestratte nel Task 7: se una cambia con la riestrazione, la causa si legge con `misura-cavi --nomi` sulla copia, come per `MISURATI`, e non si abbassa la prova.

Run: `npx tsc --noEmit > "$SCRATCH/t1-10c-tsc.log" 2>&1; echo "tsc exit=$?"; npx eslint src/lib/topology/__tests__/reti-campione.test.ts src/lib/topology/__tests__/support/reti-campione.ts src/lib/topology/__tests__/model-fixtures.test.ts > "$SCRATCH/t1-10c-lint.log" 2>&1; echo "lint exit=$?"`
Expected: `tsc exit=0`, `lint exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/__tests__/support/reti-campione.ts src/lib/topology/__tests__/reti-campione.test.ts src/lib/topology/__tests__/model-fixtures.test.ts
git commit -m "test(topologia): reti-campione di cinque famiglie e criteri G1-G17 per T1; le misure sulle reti vere fra le C e le H (spec §13.12.2, §13.3.0)"
```

---

### Task 11 (sessione principale): verifica a schermo, una volta, a 1280 e 1920

Spec §13.12.4 («A schermo»), §13.10.2 («si prova a 1280 px, dove la barra del passo passo va già su due righe, e a 1920»). Regole di Riccardo: una volta per tappa, solo schermi da scrivania. Sul ramo d'unione dopo l'ondata 6.

- [ ] App in locale sulla **copia della copia** del cliente A e su quella dell'hub (la ricetta del Task 12 della fase 2b: porta 3101, `DA_INVENT_DATA_DIR` nello scratchpad, utenza di prova con la password in un file `chmod 600`, mai in un argomento), `playwright-core` con Chrome, finestre da 1920 × 1080 e 1280 × 800 (si stampa `innerWidth` per controllo). Le immagini stanno nello scratchpad, mai nel repo.
- [ ] Cliente A, «Tutto automatico», verticale e orizzontale: core 1 sotto router 1 con «10G»; accesso A sotto core 1; il router di riserva sotto accesso B; un ramo con molti figli resta a tronco; clic su core 2 → le sue ridondanze escono dal lato più vicino, nessuna fa il giro, nessuna parola sopra un riquadro; «Mostra ridondanze» acceso: idem; un riquadro spostato a mano dall'altra parte del padre: la linea esce dal lato più vicino (poi «Riordina»).
- [ ] Elenco: «◂ Elenco» chiude, la mappa si allarga (300 px), «Adatta» rifà il conto, ricaricando la pagina resta chiuso; «Elenco ▸» lo riapre; in «Passo passo» il `title` dice «Apre l'elenco per trascinare gli oggetti sulla mappa»; da tastiera (Tab, Invio) funziona.
- [ ] Dettagli della linea router 1 – core 1: nessun «Altri cavi visti» (ether8 è un segmento); quelli della linea router–aggregazione dell'hub: «Altri cavi visti fra questi due oggetti» col secondo cavo da 25G.
- [ ] Hub: nell'elenco a sinistra, gruppo «Da sistemare», gli switch di laboratorio della porta 5 dello switch 48 PoE con «nessun collegamento» (H5); nella mappa automatica le radici di prima, nessuna radice sola in più, e nessun hypervisor sotto il router.
- [ ] Hub, le regole del passaggio universale: la linea fra il router e il router di frontiera ha porte fisiche dai due lati, nessun nome di VLAN, e il secondo cavo fra gli «Altri cavi visti» (H7); l'hypervisor che stava sotto il suo firewall virtuale è sotto l'aggregazione, con «10G» sulla linea (H15, H13); la testa è il router (H17).
- [ ] Tasto destro su una linea (admin): «Ignora questo cavo…»; il dialogo col titolo «Ignorare il cavo ‹A› · ‹porta› ↔ ‹B› · ‹porta›?» (si annulla, non si scrive).
- [ ] «Dati della mappa → Collegamenti ignorati» sulla copia del cliente A: la riga del 14/10 con «non corrisponde a nessun cavo visto: non toglie niente», «Togli la correzione» e «Scegli il cavo da ignorare…» (si apre il dialogo, si annulla: **la verifica non scrive**).
- [ ] Stampa A3 al 100 % in bianco e nero di una mappa passo passo con un figlio spostato: le linee come a schermo.
- [ ] Ciò che si vede storto si corregge (commit `fix(topologia): quel che si è visto a schermo (T1)`), senza rifare il giro completo.

---

### Task 12 (sessione principale): misura «dopo», ritorno, revisione, documenti, cancello, conferma, rilascio di T1

Spec §13.11.1 (misure, conferme, controlli dopo il rilascio, «Tornare indietro»), §13.16 (il passaggio universale, C19). Fra parentesi, «misurato il 15/10»: i valori che la revisione del piano ha misurato sulle copie del 14/10, col codice di questo piano corretto; «15/10 notte»: quelli misurati sul prototipo del piano col passaggio universale, sulle copie del 15/10 notte (la stessa misura «prima» col codice di oggi). Le copie di P3 sono più fresche, quindi le cifre possono spostarsi di poco, ma un cambio di **chi** cambia padre o esce si spiega o ferma il rilascio. I nomi di chi cambia padre o esce stanno solo nella chat, mai nel repo.

- [ ] **Misura «dopo» sulle copie** (le stesse di P3; se nel frattempo il router 1 ha fatto la lettura oraria col lettore nuovo non conta: le copie sono di prima del rilascio), dal worktree del ramo d'unione:

```bash
for s in S0 S1 S4; do npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --scenario $s --confronta "$SCRATCH/prima-A-$s.json" --salva "$SCRATCH/dopo-A-$s.json" --json > "$SCRATCH/dopo-A-$s.out" 2>&1; echo "A $s exit=$?"; done
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --scenario S3:114 --confronta "$SCRATCH/prima-A-S3.json" --json > "$SCRATCH/dopo-A-S3.out" 2>&1; echo "A S3 exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --scenario "S9:114:<nome della porta 10 di core 1>:unifi" --confronta "$SCRATCH/prima-A-S0.json" --json > "$SCRATCH/dopo-A-S9.out" 2>&1; echo "A S9 exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<H>.db" --cartella "$SCRATCH" --confronta "$SCRATCH/prima-H-S0.json" --salva "$SCRATCH/dopo-H-S0.json" --json > "$SCRATCH/dopo-H-S0.out" 2>&1; echo "H exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --confronta "$SCRATCH/prima-A-S0.json" --nomi > "$SCRATCH/dopo-A-nomi.txt" 2>&1; echo "nomi A exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<H>.db" --cartella "$SCRATCH" --confronta "$SCRATCH/prima-H-S0.json" --nomi > "$SCRATCH/dopo-H-nomi.txt" 2>&1; echo "nomi H exit=$?"
```

Atteso (spec §13.11.1, «Misure sulle copie»), tutti `exit=0`.

Cliente A:
- padri cambiati: core 1, accesso A e il router di riserva (sotto accesso B, porta 16), nient'altro (misurato: esattamente questi tre, anche il 15/10 notte);
- `contro_verso` 0 (C2; prima 1); `cucite` 0 (C4; prima 1, 2 in S1); `correzioni_orfane` 1 (C5); `porte_di_segmento` 1; `radici` uguali a prima (C16; misurato: 2 e 2 sulle copie del 14/10, router 1 e la radio lontana a 60 GHz; 1 e 1 su quelle del 15/10 notte);
- la testa proposta resta router 1 e `teste_cambiate` è vuoto (C19); `linee_da_nome_scelto` 0 e `sotto_una_sua_vm` 0, prima e dopo (15/10 notte: sui router del cliente A nessuna porta è «non nota» — nomi di fabbrica, VLAN e VRRP che il traduttore legge logiche, `ether1-2.5` fisica per la velocità in coda);
- `letture_vm`: la data dell'ultima lettura delle VM di ogni hypervisor va nel resoconto (R1; il 15/10 notte una del 14/10 e una del 22/05);
- S3 con core 1 sotto router 1 (C3); S9 senza segmento sulla porta 10 e con gli stessi padri di S0;
- nell'elenco `--nomi`: i cavi 8 e 9 di core 2 a 10G (C9); nessuna linea fra router nuova, router 2 sotto router 1 via `ether3` («tabella MAC») e router 3 via `ether4` (unico vicino) (C7); fra le porte di segmento la porta 15 di core 1 (`ether8` lo diventa quando le righe del router saranno `lldp`) e nessuna «eth0»;
- `giri_regola_nuova` e `attraversamenti_regola_nuova` 0 (C10, C11; il «prima» sono i valori `_oggi`);
- `modello_ms` ≤ 20 (C17, mediana di 30 giri; misurato il 15/10 notte sulla stessa copia: 13,5 ms col codice di oggi, 16,9 con T1, 18,0 con T1b; con 5 giri soli 15,4 / 18,5 / 21,2, quindi la mediana di 30 non si accorcia. Il margine è stretto e l'appliance è più lenta: sopra 17 ms lo si dice a Riccardo);
- in `mappe`, la mappa passo passo della sede 1 in `tb`: 7 ritocchi, 4 validi (R2, misurato); nell'elenco `--nomi` tornano validi core 1 e la radio a 60 GHz, scadono accesso A, accesso D e il router di riserva.

Hub:
- padri del controller uguali (H1) salvo i tre hypervisor sotto l'aggregazione (H9). Uno dei tre ci arriva per le regole del passaggio universale: stava sotto il suo firewall virtuale, una sua VM (H15), e senza la velocità dei nomi doppi andrebbe sotto la sua porta di gestione sullo switch a 48 porte (H13);
- router–aggregazione su porta 31 ↔ `sfp28-2` (H2); il client senza fili ancora collegato (H10);
- gli oggetti che stavano solo sulla porta 5 dello switch 48 PoE fuori dall'albero e in «Da sistemare», «nessun collegamento» (H5; misurato: i tre switch di laboratorio);
- `radici` uguali a prima (misurato: 6 e 6 sulle copie del 14/10, 5 e 5 su quelle del 15/10 notte); nessun oggetto appeso al router da un'interfaccia col nome scelto (misurato: nessun hypervisor sotto il router);
- `porte_di_segmento` 1, nessuna «eth0» (H6); `contro_verso` 0 prima e dopo;
- `linee_da_nome_scelto` 0 (H7, prima 1): la linea verso il router di frontiera sulle porte fisiche, il secondo cavo fra gli «Altri cavi visti»; `sotto_una_sua_vm` 0 (H15, prima 1); la testa proposta resta il router (H17), `teste_cambiate` vuoto;
- `letture_vm` nel resoconto (R1; il 15/10 notte due hypervisor fermi al 27/04: la lettura notturna delle VM dell'hub non era ancora passata; se le date cambiano fra «prima» e «dopo», i collegamenti «dalle VM» cambiano da soli e il resoconto lo dice).

Collegamenti fra apparati, vicini non abbinati e attaccati prima e dopo: ogni differenza spiegata (raggruppamento per apparato, R-superata, segmenti, righe da VLAN o VRRP non più abbinate per IP, le regole del passaggio universale). **Ogni altro cambio ferma il rilascio** finché non è spiegato. Il 15/10 notte, prima → dopo: cliente A collegamenti 131 → 130, fra apparati 85 → 86, attaccati 45 → 43, vicini non abbinati 13 → 13; hub collegamenti 59 → 55, fra apparati 30 → 29, attaccati 29 → 26, vicini non abbinati 9 → 7.

- [ ] **C19, le regole del passaggio universale una per volta** (spec §13.16; criterio C19: la testa di ogni sede e della mappa automatica uguale a oggi, nessun altro padre cambiato o ognuno spiegato), sulle stesse copie, contro il «dopo» con tutte le regole:

```bash
for r in nome-scelto-non-fisico conto-per-apparato vm-e-mac-propri testa-per-reti velocita-nomi-doppi; do
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --senza-regola $r --confronta "$SCRATCH/dopo-A-S0.json" --json > "$SCRATCH/c19-A-$r.out" 2>&1; echo "A $r exit=$?"
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<H>.db" --cartella "$SCRATCH" --senza-regola $r --confronta "$SCRATCH/dopo-H-S0.json" --json > "$SCRATCH/c19-H-$r.out" 2>&1; echo "H $r exit=$?"
done
```

Atteso, tutti `exit=0`; in ogni uscita `teste_cambiate` vuoto. Misurato il 15/10 notte (la regola spenta contro tutte accese):
- cliente A: nessuna delle cinque cambia un padre, una testa o un conteggio;
- hub, `nome-scelto-non-fisico`: nessun padre; torna la linea dalla VLAN (`linee_da_nome_scelto` 1 contro 0);
- hub, `conto-per-apparato`: nessun padre; un vicino non abbinato in più (8 contro 7);
- hub, `vm-e-mac-propri`: un padre, l'hypervisor che torna sotto il suo firewall virtuale (`sotto_una_sua_vm` 1 contro 0, collegamenti 56 contro 55);
- hub, `testa-per-reti`: niente: il router e il gateway del controller sono pari per nodi raggiunti e il router ha anche l'id più basso, quindi oggi vince per caso e con la regola vince perché fa da gateway (H17); la regola decide sulla famiglia 1 delle reti-campione (Task 10c);
- hub, `velocita-nomi-doppi`: un padre, lo stesso hypervisor sotto lo switch a 48 porte invece che sotto l'aggregazione (H13).

Un padre o una testa che cambia in un modo diverso, e non si spiega con `--nomi`, tiene quella regola fuori da T1 (si toglie da `REGOLE_T1`, con la sua prova che resta a dire perché) e lo si dice a Riccardo; la misura si rifà una volta.

- [ ] **Le righe G delle reti-campione**, per il resoconto (spec §13.3.0): `node --import tsx --test src/lib/topology/__tests__/reti-campione.test.ts > "$SCRATCH/righe-g-t1.log" 2>&1; echo "exit=$?"; grep -E "^(not )?ok .* G[0-9]+ · " "$SCRATCH/righe-g-t1.log"`. Atteso: `exit=0`; le righe `G… · famiglie …` passano o sono saltate col perché (17 passano, 7 saltate: G6 per la famiglia 3, G11-G16), e vanno così come sono nel messaggio a Riccardo e nella revisione: ogni titolo nomina solo le famiglie che la prova tocca. Accanto, le misure sulle due reti vere: `node --import tsx --test src/lib/topology/__tests__/model-fixtures.test.ts`, righe H5, H6, H7 e C19, H13, H15, H17.

- [ ] **C18 e prova di ritorno R6** — le righe nuove del router 1 vengono dal *detail* incollato da Riccardo (`righeDiUscita` lo legge), scritte sulla copia della copia; poi lo stesso ingresso col codice di prima (il commit dell'unione dell'ondata 2, annotato nel Task 4) e con lo script del Task 10b:

```bash
U="$USCITA_ROUTER1"   # il «detail» del router 1 incollato da Riccardo: un file del dossier del cliente, fuori dal repo (la sessione principale sa dove); sola lettura
DALLE=$(date -u +"%Y-%m-%d %H:%M:%S")   # prima delle scritture sulla copia della copia: le righe nuove avranno un'ora uguale o dopo
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --uscita-router "1=$U" --esporta-input "$SCRATCH/r6-input.json" --nomi > "$SCRATCH/c18.txt" 2>&1; echo "C18 exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<H>.db" --cartella "$SCRATCH" --uscita-router "1=$USCITA_HUB" --nomi > "$SCRATCH/c18-H.txt" 2>&1; echo "C18 H exit=$?"   # il terse del router dell'hub (P2): l'altra forma, sull'altra rete
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --uscita-router "1=$U" --scenario S4 --confronta "$SCRATCH/dopo-A-S0.json" --esporta-input "$SCRATCH/r6-peggiore.json" --json > "$SCRATCH/s4-nuovo.out" 2>&1; echo "S4 nuovo exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --uscita-router "1=$U" --scenario S4 --confronta "$SCRATCH/dopo-A-S0.json" --nomi > "$SCRATCH/s4-nuovo-nomi.txt" 2>&1; echo "S4 nuovo nomi exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --uscita-router "1=$U" --ripristino "$DALLE" --esporta-input "$SCRATCH/r6-ripristinato.json" --json > "$SCRATCH/r6-ripristino.out" 2>&1; echo "ripristino exit=$?"
git -C "$REPO" worktree add "$SCRATCH/ipam-prima" <hash dell'unione dell'ondata 2> && (cd "$SCRATCH/ipam-prima" && npm ci > /dev/null 2>&1)
(cd "$SCRATCH/ipam-prima" && npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --input-json "$SCRATCH/r6-input.json" --confronta "$SCRATCH/prima-A-S0.json" --json > "$SCRATCH/r6-prima.out" 2>&1; echo "R6 exit=$?")
(cd "$SCRATCH/ipam-prima" && npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --input-json "$SCRATCH/r6-input.json" --nomi > "$SCRATCH/r6-prima-nomi.txt" 2>&1; echo "R6 nomi exit=$?")
(cd "$SCRATCH/ipam-prima" && npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --input-json "$SCRATCH/r6-peggiore.json" --confronta "$SCRATCH/prima-A-S0.json" --json > "$SCRATCH/r6-peggiore.out" 2>&1; echo "R6 peggiore exit=$?")
(cd "$SCRATCH/ipam-prima" && npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --input-json "$SCRATCH/r6-ripristinato.json" --confronta "$SCRATCH/prima-A-S0.json" --json > "$SCRATCH/r6-dopo-script.out" 2>&1; echo "R6 dopo lo script exit=$?")
```

Atteso, tutti `exit=0` (misurato il 15/10 con lo stesso *detail*):
- C18: `host_cambiati_di_categoria` 0, oppure l'elenco per nome (in chat) accettato da Riccardo; sull'hub, col *terse* del suo router, 0 (misurato il 15/10 notte: 0; le righe del router lette dal *terse*: 8 `lldp`, nessuna porta troncata; sul modello la fonte `lldp` passa da 12 a 14);
- S4 col codice nuovo, contro il «dopo» S0: la riga su `ether8` non conferma niente e nessun collegamento fra router su una VLAN o sul tunnel (`s4-nuovo-nomi.txt`); un solo padre cambiato, la radio lontana a 60 GHz, che resta senza collegamenti su una porta diventata di segmento e va in «Da sistemare» (spec §13.12.1, S4: da dire a Riccardo);
- col codice di prima e le righe nuove: `padri_cambiati` 0 e `conteggi_cambiati` spiegati (una fonte `lldp` al posto di `mndp`, un vicino non abbinato in più); nell'elenco `r6-prima-nomi.txt`, le linee fra router come nel «prima»;
- col codice di prima nel caso peggiore: `padri_cambiati` 1, cioè **R6 non regge da solo**; dopo lo script (`righe_riportate_a_mndp` più di 0): `padri_cambiati` 0 e, fra i `conteggi_cambiati`, solo il vicino non abbinato in più. R6 regge **con lo script**: se si torna indietro, si manda anche lo script («Tornare indietro», sotto).

Se uno di questi esiti non torna: ci si ferma, si passa al livello completo e il ritorno si progetta con Riccardo, prima del rilascio.

- [ ] **Una revisione finale** dell'intero ramo contro `origin/dev`, su **Opus** (`superpowers:requesting-code-review`), con in mano la spec (§13.11.1) e questo piano; un giro di correzioni; nessuna ri-revisione completa (solo un'occhiata mirata alle correzioni).

- [ ] **Documenti, nel ramo d'unione e prima del cancello** (così il commit di rilascio li porta con sé; la regola del parco vuole il CHANGELOG prima del commit):
  - `CHANGELOG.md`: la voce di T1 col perché (incidente del 14/10, porte da una prova sola, «Ignora» per cavo, regola del segmento con chi resta senza collegamenti in «Da sistemare», pareggi, protocollo vero, ripiego del router solo da porte riconosciute, lato più vicino, elenco, script di ritorno) e le regole del passaggio universale, scritte per ogni rete e provate su cinque famiglie di reti-campione inventate (un nome scelto dal cliente non è una porta fisica; gli apparati di una porta contati per apparato; fra una VM e il suo hypervisor nessun collegamento; la testa proposta dalle reti di cui fa da gateway; la velocità di un nome doppio);
  - `CONTEXT.md` §6: stato e trappole nuove (le correzioni orfane; `ports` nell'ingresso del modello; il filtro delle fonti; la parola «annuncio di rete»; le fixture del modello senza VM, e lo script d'estrazione che confronta sull'ingresso senza VM; gli stati delle porte nel vocabolario dell'anonimizzatore). Il file è già sopra il tetto di circa 10.000 caratteri: le voci nuove entrano **togliendo** il dettaglio delle trappole della fase 2b e della verticale, che va negli ADR 0010 e 0012, con un rimando nel §6;
  - l'ADR della tappa: `docs/adr/‹NNNN›-topologia-collegamenti-per-prova.md`, dove ‹NNNN› è **il primo numero libero su `origin/dev` al momento del commit**, riletto con `git fetch origin` subito prima (il lavoro NetBird ne scrive in parallelo: lo 0013 e lo 0014 sono suoi, quindi oggi sarebbe lo 0015). Decisione: porte da una prova sola, «Ignora» per cavo, regola del segmento in T1, traduttori per prodotto, e le regole del passaggio universale (spec §13.16), spegnibili solo dalla misura; alternative scartate dalla spec §13.13.1; **cosa diventa difficile**: §13.13.3 punti 2, 5, 6, 9, 10, 15 (le reti-campione sono codice da tenere vivo: ogni lettore nuovo porta la sua famiglia) e 16 (ciò che sceglie il cliente non entra nella logica: una regola su un nome sta nel traduttore del prodotto solo per i nomi di fabbrica).

  Un commit di soli documenti, coi file nominati uno per uno (mai `git add -A`).

- [ ] **Cancello completo, una volta**, sul ramo d'unione aggiornato a `origin/dev` (`git fetch origin && git merge --no-ff origin/dev` se `dev` è andato avanti):

```bash
(npm run lint && npx tsc --noEmit && npm test && npm run build) > "$SCRATCH/cancello-t1.log" 2>&1; echo "exit=$?"
```

Atteso: `exit=0`. (`credential-chains.test.ts` cade a caso nella suite intera, CONTEXT §6: se è l'unica rossa si rilancia da sola e si annota; non si tocca.)

- [ ] **Il messaggio a Riccardo**, uno solo, in chat, in ora italiana e in parole: mai una sigla da sola («nessun host cambia categoria per i valori interi letti dal router», non «C18»; «se si torna indietro la mappa torna quella di prima, a patto di mandare anche lo script», non «R6»; «i tre switch di laboratorio dell'hub vanno in Da sistemare», non «H5»). Contiene:
  - i conteggi prima → dopo delle due copie;
  - **solo nella chat** l'elenco per nome di chi cambia padre (cliente A: core 1, accesso A, router di riserva; hub: i tre hypervisor) e di chi esce dall'albero (gli switch di laboratorio della porta 5 dello switch 48 PoE dell'hub), gli host che cambiano categoria se ce ne sono, l'esito della prova di ritorno e la radio lontana del caso peggiore;
  - la bozza di P4, allegata con `SendUserFile` se non è al MacBook;
  - la richiesta di conferma, **una volta e per esteso, per tre cose insieme**: il push su `dev` (arriva al cliente A in 15 minuti), l'aggiornamento dell'hub, e il ritorno indietro (revert, `version:release`, push, e lo script di ritorno con la copia delle righe prima) se i controlli dopo il rilascio vanno male;
  - i fatti da confermare: che chi resta senza collegamenti su una porta di segmento vada già in T1 in «Da sistemare» (spec §13.7.1 passo 2, H5); la bozza fatta senza aspettare l'approvazione (spec §13.10.4); se riscrivere la storia di git per i dati di clienti tolti nel Task 5, Step 6; se vuole Opus sugli implementatori dei task del modello di T1b;
  - le regole del passaggio universale (spec §13.16) come fatti da confermare, in parole e coi numeri della misura C19: sul cliente A nessuna cambia niente; sull'hub la linea verso il router di frontiera passa dai cavi veri e non da una VLAN, un vicino non abbinato in meno, e l'hypervisor del firewall virtuale sotto l'aggregazione a 10G invece che sotto la sua VM; più le righe «G… · famiglie …» delle reti-campione (cinque famiglie inventate) e le misure sulle due reti vere;
  - le scelte che restano a lui (spec §13.16, «Scelte che restano a Riccardo»), una riga ciascuna e per esteso: censire il router di frontiera, il router virtuale e quello nel cloud dell'hub (1); da quale età una posizione delle VM smette di creare collegamenti (2); la testa quando l'unico router è una VM (3); il laboratorio dell'hub dentro o fuori dall'albero (5); il perimetro, cioè lo spanning tree e non l'instradamento, da confermare (6); a che cosa serve il gateway del controller dell'hub (7); la porta di fabbrica con la velocità in coda (9: `ether1-2.5` resta fisica, oppure ogni nome rinominato diventa «non noto», col cavo che resta dal lato di accesso A; oggi, misurato, la restrizione del Task 3 non cambia nessun nome sulle due copie). Gli switch visti solo via LLDP (4) e il telefono che si annuncia via CDP (8) si chiedono col rilascio di T1b (Task 16). Finché non risponde, le tappe non ne dipendono;
  - le uscite di `/ip neighbor print terse` del router 2 e del router di riserva, se può darle (facoltative).

  Se Riccardo corregge la bozza: un giro di correzioni e il cancello si rifà una volta prima del push.

- [ ] **Rilascio**, solo dopo la sua conferma, dal worktree del ramo d'unione (pulito, aggiornato a `origin/dev`):

```bash
npm run version:release > "$SCRATCH/release-t1.log" 2>&1; echo "exit=$?"     # commit «release: vX.Y.Z»
git rev-parse --short HEAD                                                    # il commit di rilascio, per i controlli dopo
git push origin HEAD:dev; echo "exit=$?"
date -u +"%Y-%m-%d %H:%M:%S"   # ora del push (UTC), per i controlli dopo
```

Hub: l'aggiornamento con lo script staccato, com'è stato fatto per le tappe del 14/10 (`/root/aggiorna-f2b.sh` è il modello: fetch, reset su `origin/dev`, `npm ci`, build, riavvio), lanciato con `systemd-run --unit=aggiorna-t1 /root/aggiorna-f2b.sh` via la skill `deploy-prod`, così un ssh che cade non ferma la build a metà.

- [ ] **Controlli dopo il rilascio** (sola lettura; SQL verso un server solo da stdin, con heredoc fra apici). Tempo massimo circa **30 minuti** dal push (il timer gira ogni 15 minuti, più la build):
  - **Il processo è ripartito, col commit del rilascio**, sull'appliance del cliente A (servizio `da-ipam`, in `/opt/da-ipam`) e sull'hub (servizio `da-invent`, in `/opt/da-invent`; CONTEXT §3): `systemctl show <servizio> -p ActiveEnterTimestamp` dopo l'ora del push; `journalctl -u <servizio> --since "<ora del push UTC>" --no-pager | grep -m1 "DA-INVENT ready"` con la riga d'avvio; sull'appliance `journalctl -u da-ipam-update --since "<ora del push UTC>" --no-pager | grep -m1 "nuovo commit su origin/dev"` con l'hash del commit di rilascio, oppure `git -C /opt/da-ipam rev-parse --short HEAD` uguale a quell'hash (sull'hub `git -C /opt/da-invent rev-parse --short HEAD`). **Non** `/api/version`, che cambia prima del riavvio (CONTEXT §6). Se dopo 30 minuti il servizio non è ripartito o gira un altro commit: si legge `journalctl -u da-ipam-update` (una build fallita lascia acceso il processo di prima, CONTEXT §3) e si avvisa subito Riccardo. `PRAGMA quick_check` del tenant: «ok» (l'hub con le sue 4 pagine «never used» note).
  - I conteggi di `GET /api/topology/model` confrontati con quelli di una copia presa subito prima del riavvio e passata al codice nuovo: uguali finché il router 1 non si rilegge.
  - **Q-T1**, alla prima lettura oraria del router 1 dopo il riavvio (cliente A: il router 1 si legge ogni ora dalla scansione veloce di una rete; nessun job da accendere), sull'appliance:

```bash
ssh <appliance del cliente A> 'sqlite3 -readonly /opt/da-ipam/data/tenants/<tenant>.db' <<'SQL'
SELECT protocol, COUNT(*), SUM(remote_port LIKE '% %')
  FROM device_neighbors
 WHERE device_id = 1 AND timestamp >= '<ora del riavvio, UTC>' GROUP BY protocol;
SQL
```

  e, per i valori troncati, il **confronto neutro** con l'uscita vera salvata (verifica UV1 del 15/10: la query di prima cercava «Port» e «Mikrotik», i troncati del cliente A, e sull'hub, dove il lettore di prima troncava altri nomi, sarebbe passata qualunque cosa; l'elenco dei troncati dipende dalla rete e qui non c'è). Le righe nuove del router si esportano in sola lettura nello scratchpad e si confrontano, per porta locale e MAC remoto, con quelle che il lettore legge dall'uscita incollata da Riccardo (`$USCITA_ROUTER1`); lo script sta nello scratchpad, non nel repo:

```bash
ssh <appliance del cliente A> 'sqlite3 -readonly -json /opt/da-ipam/data/tenants/<tenant>.db' <<'SQL' > "$SCRATCH/qt1-A.json"
SELECT local_port, remote_mac, remote_port FROM device_neighbors WHERE device_id = 1 AND timestamp >= '<ora del riavvio, UTC>';
SQL
cd "$SCRATCH/ipam-t1" && npx tsx "$SCRATCH/qt1-confronta.ts" "$SCRATCH/qt1-A.json" "$USCITA_ROUTER1"; echo "exit=$?"; rm -f "$SCRATCH/qt1-A.json"
```

  `$SCRATCH/qt1-confronta.ts`:

```ts
/** Q-T1 col riferimento (spec §13.11.1): le porte remote delle righe del router contro quelle che il lettore legge dall'uscita
 *  salvata, per porta locale e MAC remoto. Stampa solo numeri. Uso: npx tsx qt1-confronta.ts <righe.json> <uscita.txt> */
import fs from "node:fs";
import path from "node:path";
async function main(): Promise<void> {
  const { parseMikrotikNeighbors } = await import(path.join(process.cwd(), "src/lib/devices/mikrotik-vicini.ts"));
  const righe = JSON.parse(fs.readFileSync(process.argv[2], "utf8")) as Array<{ local_port: string; remote_mac: string | null; remote_port: string }>;
  const mac = (m: string | null | undefined) => (m ?? "").toUpperCase();
  const uscita = new Map((parseMikrotikNeighbors(fs.readFileSync(process.argv[3], "utf8")) as Array<{ localPort: string; remoteMac?: string; remotePort: string }>)
    .map((v) => [`${v.localPort}|${mac(v.remoteMac)}`, v.remotePort]));
  let abbinate = 0, diverse = 0;
  for (const r of righe) {
    const atteso = uscita.get(`${r.local_port}|${mac(r.remote_mac)}`);
    if (atteso === undefined) continue;
    abbinate++;
    if (atteso !== r.remote_port) diverse++;
  }
  console.log(`righe ${righe.length} · abbinate all'uscita ${abbinate} · porte remote diverse ${diverse}`);
}
void main();
```

  (La cartella dei dati si guarda prima, in sola lettura: `DA_INVENT_DATA_DIR` nel `.env.local` dell'appliance, altrimenti `data/` accanto all'app.) Atteso: righe `lldp` più di 0, porte remote con lo spazio, e «porte remote diverse 0» (C6; ogni differenza si spiega, per esempio una porta rinominata dopo il 14/10). Misurato il 15/10 sulle copie: con le righe del lettore di prima lo stesso confronto dà 3 sul cliente A e 4 sull'hub, cioè vede i troncati di tutte e due le reti; una query che cercasse i nomi troncati senza un riferimento ne vedeva 0 sul cliente A. Se `lldp` resta a 0 o le porte diverse ci sono, il formato non è quello della fixture: **non si indovina**, si chiede a Riccardo l'uscita di quel momento.
  - **Q-T1 sull'hub** (H16), alla prima lettura del suo router dopo il riavvio, con la stessa query e lo stesso confronto sul tenant dell'hub (`ssh <hub> 'sqlite3 -readonly …/tenants/<tenant dell'hub>.db'`, cartella dei dati guardata prima, in sola lettura, come per l'appliance; `device_id` del router dell'hub; l'uscita salvata è `$USCITA_HUB`, e il file esportato si toglie subito dopo) e in più `SELECT DISTINCT local_port FROM device_neighbors WHERE device_id = <router dell'hub> AND protocol = 'lldp' AND timestamp >= '<ora del riavvio, UTC>';`, letta in chat e mai copiata nel repo. Atteso: righe `lldp` più di 0, tutte su porte fisiche (la porta prima della virgola); porte remote intere, con lo spazio; «porte remote diverse 0». I conti esatti della lettura del 14/10 (8 righe `lldp`) non fanno da cancello: cambiano appena si spegne un apparato di laboratorio.

- [ ] **Tornare indietro** (solo se i controlli dopo il rilascio vanno male; già nella conferma di Riccardo): `git revert -m 1 <commit di unione di T1>`, `npm run version:release`, `git push origin HEAD:dev`, e gli stessi controlli (commit e riavvio). Poi, perché R6 regge solo con lo script, sull'appliance del cliente A con l'ora del rilascio di T1 (`$DALLE`, UTC):

```bash
npx tsx scripts/ripristina-vicini-router.ts --dalle "$DALLE" | ssh <appliance del cliente A> 'sqlite3 -readonly /opt/da-ipam/data/tenants/<tenant>.db'; echo "prova a vuoto exit=$?"
npx tsx scripts/ripristina-vicini-router.ts --dalle "$DALLE" --copia | ssh <appliance del cliente A> "sqlite3 -readonly -cmd '.mode insert device_neighbors' /opt/da-ipam/data/tenants/<tenant>.db" > "$SCRATCH/ripristino-copia-righe.sql"; echo "copia exit=$?"
npx tsx scripts/ripristina-vicini-router.ts --dalle "$DALLE" --applica | ssh <appliance del cliente A> 'sqlite3 -bail /opt/da-ipam/data/tenants/<tenant>.db'; echo "applica exit=$?"
```

  Lo script si lancia dal worktree del ramo d'unione di T1 (dopo il revert non è più su `dev`, e non serve sull'impianto). Atteso: la prova a vuoto elenca le righe per apparato e protocollo; la copia delle righe (dati del cliente: solo nello scratchpad) ha tante righe quante la prova a vuoto; dopo `--applica` le righe che restano sono 0. Lo stesso sull'hub, se il suo router è un MikroTik letto via SSH. Se una delle tre esce diversa da 0: ci si ferma e si avvisa Riccardo.

- [ ] **Istruzioni passo passo a Riccardo**, in chat, in ora italiana. In testa quattro parti: dove siamo, che cosa è fatto, che cosa resta, che cosa fare tu e che effetto ha sul sistema. L'indirizzo dell'appliance del cliente A (da `ACCESSI.md`) e i nomi delle porte come appaiono a schermo stanno **solo nel messaggio**, mai nel repo. Per ogni passo: dove, che cosa fare, che cosa vedi se va bene, che cosa vedi se va male, l'effetto sul sistema.
  1. Apri DA-IPAM del cliente A (l'indirizzo è nel messaggio) → **Topologia → «Tutto automatico»** e guarda dove sta **core 1**. Se va bene: sta **sotto router 1**, con «10G» sulla linea. Se va male: è ancora sotto accesso A; scrivimelo e non toccare altro, guardiamo i conteggi del modello. Effetto sul sistema: nessuno, guardi soltanto.
  2. Fai clic sulla linea fra router 1 e core 1. Se va bene: nei dettagli a destra le porte sono `sfp-sfpplus1` di router 1 e la porta 10 di core 1 (nel messaggio il suo nome come appare a schermo); accesso A sta sotto core 1 e il router di riserva sotto accesso B. Se va male: porte diverse o un'altra linea; scrivimelo. Effetto: nessuno.
  3. Nella barra premi **«◂ Elenco»**. Se va bene: l'elenco a sinistra si chiude, la mappa si allarga e il pulsante diventa «Elenco ▸», che lo riapre. Se va male: non cambia niente, o la mappa non si allarga; scrivimelo. Effetto: la scelta si ricorda solo nel tuo browser; sul server niente.
  4. Fai clic su **core 2**. Se va bene: le sue ridondanze escono dal lato del riquadro più vicino, senza fare il giro. Se va male: una linea esce dal lato opposto o passa sopra un riquadro; mandami una schermata. Effetto: nessuno.
  5. Vai in **«Dati della mappa» → «Collegamenti ignorati»**: la riga del 14/10 (la porta 10 di core 1 con `ether8` di router 1) dice «non corrisponde a nessun cavo visto: non toglie niente». Se al passo 1 core 1 stava sotto router 1, premi **«Togli la correzione»**. Se va bene: la riga sparisce e la mappa non cambia, perché quella correzione già non toglieva niente. Se va male: compare un errore, o la mappa cambia; fermati e scrivimelo. Effetto sul sistema: cancella una riga delle correzioni a mano nel DB del cliente, quella del 14/10. Se invece vuoi ignorare un cavo vero fra i due, usa «Scegli il cavo da ignorare…» (nessun cavo è già segnato: scegli tu).
  6. Perché il passo 5 lo fai tu e non io: è una scrittura sui dati del cliente, e la correzione del 14/10 l'hai decisa tu; nessuno script la tocca.
- [ ] **Dopo il rilascio** (commit di soli `docs/`/`.md`, che non riavviano niente): la riga «Rilasciato in vX.Y.Z il ‹data›» nel §13.11.1 della spec; la bacheca.
- [ ] **Prima della promozione a `main`** (non in questo rilascio; dopo una settimana senza ritorni su cliente A e hub; la settimana può finire dopo il 25/10, quando l'ora italiana torna UTC+1): su ogni appliance, in sola lettura e con l'ok di Riccardo, `SELECT action, COUNT(*) FROM topology_link_overrides GROUP BY action;`, `SELECT COUNT(*) FROM topology_link_primary;` e `SELECT COUNT(*) FROM device_neighbors dn JOIN network_devices nd ON nd.id = dn.device_id WHERE nd.vendor = 'mikrotik' AND nd.protocol <> 'ssh';` (un MikroTik letto via SNMP passa dal traduttore generico in T1: se ce ne sono, si guarda prima). Gli «Ignora» e le ★ trovati si guardano con Riccardo prima di promuovere.

---

## Parte 2 — T1b: il ruolo dalle prove e «Perché questo collegamento»

Un rilascio a parte, **subito dopo T1** (spec §13.11.2; §13.15 punti 3 e 6). Leggero: nessuno schema (`topology_role` c'è, `db-tenant.ts:265`), scritture solo per mano di un admin. Il codice si scrive subito dopo T1, sul suo ramo d'unione (P5); misura e rilascio aspettano la lettura del router. **Si rilascia dopo almeno una lettura oraria del router 1 col lettore di T1** (Q-T1 verde), perché la prova «si annuncia come apparato» è pulita solo sulle righe nuove; per lo stesso motivo **la misura si fa su copie prese dopo quella lettura**.

**Preparazione T1b (sessione principale):**

- [ ] **P5.** Ramo `topologia/collegamenti-t1b` **dal ramo d'unione di T1** (dopo la sua revisione e il suo cancello), worktree `$SCRATCH/ipam-t1b` (`npm ci`): il codice di T1b si scrive subito dopo T1, senza aspettare il rilascio di T1 (la decisione 3 di Riccardo lega alla lettura del router la misura e il rilascio di T1b, non il codice). Dopo il rilascio di T1 (`origin/dev` contiene il commit «release» di T1) e con Q-T1 verde: `git -C "$SCRATCH/ipam-t1b" fetch origin && git -C "$SCRATCH/ipam-t1b" rebase origin/dev; echo "exit=$?"` (atteso `exit=0`: i commit di T1 sono già su `origin/dev`, restano solo quelli di T1b), e le prove della topologia di nuovo verdi.
- [ ] **P6.** Due copie fresche (come P3), prese **dopo** almeno una lettura oraria del router 1 col lettore di T1: `$SCRATCH/copie-t1b/<tenant>.db`.
- [ ] **P7.** Il «prima» di T1b sul codice di T1 rilasciato (il worktree del rilascio di T1, o un worktree al suo commit `release:`): `npx tsx scripts/misura-cavi.ts "$SCRATCH/copie-t1b/<A>.db" --cartella "$SCRATCH" --salva "$SCRATCH/prima-t1b-A.json" --json` e lo stesso per l'hub; `exit=0`.
- [ ] **P8 · Bozza di T1b (spec §13.10.4).** Pagina statica nello scratchpad (dati della copia, non si pubblica): una riga di «Da sistemare» col motivo per un apparato e per un host; il menu «Ruolo nella mappa ▸ Apparato di rete · Attaccato (server, PC) · Decide il sistema»; i dettagli della linea router 1 – core 1 con «Perché questo collegamento» e il motivo delle righe scartate («Sulla porta ether8 router 1 sente 2 apparati…»). **Non ferma i Task 14 e 15**, che partono dai testi fissati (Global Constraints, spec §13.4.6 e §13.9): va a Riccardo insieme ai numeri del rilascio di T1b (Task 16), e le sue correzioni entrano nel giro di correzioni prima del cancello (come P4).

### Task 13: le prove di ruolo e «Da sistemare» (T1b.1)

Spec §13.8.2 (D6; le sei prove aggiunte e il ruolo a mano, confermati il 14/10 sera), §13.3.3 H4, H4b, prova I28. Sonnet (la revisione finale di T1b è su Opus). `nodeClass` è chiamata 25 volte in 10 file: la mappa passa per `classeInMappa` **solo** dove decide foglie, ponti e visibilità (`tree.ts`, `attach.ts`); attribuzione e altri moduli non cambiano. Non sono prove il tipo dichiarato, la classificazione automatica, essere visti via LLDP da uno switch (sull'hub un PC registrato come switch manda LLDP dalla sua scheda) o essere visti nella tabella MAC di altri. «Capo di un ponte radio» e «capacità annunciate» sono nel tipo ma arrivano in T3 (le radio sulla linea, `remote_caps`): `proveDiRuolo` accetta già i capi dei salti radio come parametro.

**Dal passaggio universale (spec §13.8.2 e §13.16; prove I64, I65, G10, G12; H14, C16): Step 6-10, con un commit a parte.** Tre regole, scritte per ogni rete:
- **nessuna radice sola**: un host di rete (classe «infra» o «ap») con una prova di ruolo e nessun collegamento va in «Da sistemare», «nessun collegamento», come gli apparati; senza una prova sta già fra i «senza prove di ruolo». Rete B: cinque oggetti di rete senza collegamenti erano radici sole della mappa automatica (H14); cliente A: la radio lontana a 60 GHz, fino al salto radio di T3 (C16);
- **«hypervisor» solo con una prova**: ospita VM, oppure è un hypervisor censito e letto (la scansione delle sue VM, `proxmox_scan`, passata dal modello: il nome del prodotto in `cavi/` non si scrive, I37); la classificazione da sola no. Rete B: un nodo «hypervisor» fatto di host fusi su un MAC passa ad attaccato, al suo posto;
- **lo spanning tree è una prova solo se attivo**: `forwarding`, `learning`, `listening`, `blocking` o `discarding`, su una porta accesa. `disabled` vuol dire spanning tree spento (gli switch senza spanning tree della rete B: uplink acceso e `disabled`), e su una porta giù ogni stato vale «giù» (G12).

In più `vistiSoloViaLldp`: gli oggetti senza prove che altri vedono via LLDP, contati nella misura ed elencati per nome a Riccardo per la scelta 4 del §13.16 (Task 16). Misurato sul prototipo del piano (15/10 notte). Sulle fixture (riestratte dalle copie del 14/10): cliente A da 2 radici a 1 (la radio lontana esce: un isolato in più); rete B da 3 radici a 1 (due isolati in più) e due nodi «hypervisor» senza VM né scansione che diventano attaccati; i «senza prove di ruolo» non cambiano (9 e 27). Sulle copie del 15/10 notte, con le righe nuove del router: cliente A una radice, 3 senza prove, nessuno visto solo via LLDP; rete B da 5 radici a 1 (H14), 22 senza prove, 6 visti solo via LLDP (fra loro PC registrati come switch: la spec ne aspettava uno, lo switch di storage).

**Files:**
- Create: `src/lib/topology/cavi/ruolo.ts` (logica pura, nessun nome di prodotto: prova I37)
- Create: `src/lib/topology/da-sistemare.ts` (il motivo in parole: nomina i protocolli, quindi fuori da `cavi/`)
- Modify: `src/lib/topology/model-types.ts` (`TopologyModel.classiMappa?`, `.daSistemare?`; `ModelCounts.senzaProve`)
- Modify: `src/lib/topology/model.ts` (prove prima di `attachMacs`; `classiMappa`, `daSistemare`, `counts.senzaProve`)
- Modify: `src/lib/topology/attach.ts` (`OpzioniAttacco.classe`: chi è «da sistemare» conta come un client e non fa da apparato di passaggio)
- Modify: `src/lib/topology/tree.ts` (foglie, `autoVisible`, principale dell'hypervisor, «+N», testa proposta)
- Modify: `src/components/topology/map/object-list.tsx:53-58` (il motivo), `map-canvas.tsx` e `map-node.tsx` (la parola «da sistemare» sul riquadro), `src/app/(dashboard)/topology/dati/dati-client.tsx` (un numero in più)
- Modify: `src/lib/topology/misura.ts` (`senza_prove`, `soloProveAggiunte`), `scripts/misura-cavi.ts` (`--nomi`: l'elenco di chi esce col motivo)
- Test: `src/lib/topology/__tests__/ruolo.test.ts` (nuovo); `attach.test.ts`, `link-attrs.test.ts`, `vm-ports.test.ts`, `vms.test.ts` (i dati finti ricevono la prova di ruolo che il dato vero ha: Step 4); `model-fixtures.test.ts` (i numeri)
- Modify (Step 6-10, passaggio universale): `src/lib/topology/cavi/ruolo.ts` (`ProvaRuolo` += `"scansione"`; `STP_ATTIVO`; `extra.scansioni`; «hyper» solo con una prova), `src/lib/topology/model.ts` (`scansioni`; `isolated` += gli host di rete con una prova), `src/lib/topology/misura.ts` (`vistiSoloViaLldp`; `conteggi` += `visti_solo_via_lldp`), `scripts/misura-cavi.ts` (`--nomi`: i visti solo via LLDP)
- Test (Step 6-10): `ruolo.test.ts` (I64, I65), `misura.test.ts` (`vistiSoloViaLldp`), `reti-campione.test.ts` (G10 di T1b e il telefono, Task 10c), `model-fixtures.test.ts` (H14 e C16, I65 sull'hub; i numeri)

**Interfaces:**
- Consumes: `righeUltimoGiro` (Task 7), `ModelPortRow.stp_state` e `ModelDeviceRow.topology_role` (Task 5), `nodeClass`, `NodeClass` (`identity.ts:45-60`), `placeVms` (`vms.ts:146`); per gli Step 6-10 `ModelPortRow.status`, `ModelDeviceRow.proxmox_scan`, `computeMapView` (`map-compute.ts`), le reti-campione (Task 10c).
- Produces (Step 6-10): `ProvaRuolo` += `"scansione"`; `proveDiRuolo(input, idx, extra?: { vms?; capiRadio?; scansioni?: ReadonlySet<string> })`; da `misura.ts` `vistiSoloViaLldp(input: TopologyModelInput, model: Pick<TopologyModel, "daSistemare">): string[]`; `conteggi(…).visti_solo_via_lldp`.
- Produces:

```ts
// cavi/ruolo.ts
export type ProvaRuolo = "vicini" | "spanning_tree" | "mac_dietro" | "vm" | "uplink" | "controller" | "padre_di" | "annuncio" | "radio" | "capacita" | "a_mano";
export const PROVE_AGGIUNTE: ReadonlySet<ProvaRuolo>;
export function proveDiRuolo(input: TopologyModelInput, idx: NodeIndex, extra?: { vms?: readonly MapVm[]; capiRadio?: ReadonlySet<string> }): Map<string, ProvaRuolo[]>;
export function classeInMappa(n: Parameters<typeof nodeClass>[0], prove: readonly ProvaRuolo[] | undefined, ruoloAMano: "rete" | "attaccato" | null): NodeClass | "da_sistemare";
export function ruoloLetto(v: string | null | undefined): "rete" | "attaccato" | null;   // «core» e «accesso» (T3) valgono «rete»
// da-sistemare.ts
export function motivoDaSistemare(n: Pick<MapNode, "kind" | "type">): string;
// model-types.ts
type ClasseMappa = "infra" | "ap" | "hyper" | "att" | "client" | "da_sistemare";
// TopologyModel += classiMappa?: Record<string, ClasseMappa>  (solo dove è diversa da nodeClass)
//                += daSistemare?: Array<{ id: string; motivo: string }>
// ModelCounts += senzaProve: number
// attach.ts: OpzioniAttacco += classe?: (n: MapNode) => ClasseMappa
// misura.ts: soloProveAggiunte(input: TopologyModelInput, model: TopologyModel): string[]
```

- [ ] **Step 1: le prove che falliscono** — `src/lib/topology/__tests__/ruolo.test.ts`:

```ts
// Spec topologia §13.8.2 (D6) e prova I28. Vincolo 7 di Riccardo (14/10): sull'hub 19 PC e server (16 Windows e 3 Linux,
// spec §13.1 punto 12) registrati come «switch» per l'inventario, sei nell'albero; host classificati router su prove deboli (un telefono,
// un notebook) anche. Ora un oggetto fa da switch, router o AP solo con una prova sua. Dati inventati con la forma vera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVE_AGGIUNTE, classeInMappa, proveDiRuolo } from "@/lib/topology/cavi/ruolo";
import { motivoDaSistemare } from "@/lib/topology/da-sistemare";
import { buildTopologyModel } from "@/lib/topology/model";
import { buildNodeIndex } from "@/lib/topology/node-index";
import { autoVisible, buildTree } from "@/lib/topology/tree";
import type { TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";

const ORA = "2026-10-13 11:00:00";
const prove = (i: TopologyModelInput, id: string) =>
  proveDiRuolo(i, buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors)).get(id) ?? [];

test("le prove, una per una (D6 e le sei aggiunte del 14/10 sera; il ruolo a mano)", () => {
  const i = baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh" }),
      dev(2, { name: "SW-2", controller_mac: "02:00:00:00:00:02", uplink_mac: "02:00:00:00:00:03" }),
      dev(3, { name: "SW-3", controller_mac: "02:00:00:00:00:03" }),
      dev(4, { name: "SW-4", topology_role: "rete" }),
      dev(5, { name: "SW-5" }),
      dev(6, { name: "RTR-6", device_type: "router" }),
    ],
    neighbors: [{ device_id: 1, local_port: "ether2", remote_device_name: "RTR-6", remote_port: "ether1", protocol: "mndp", remote_ip: "10.0.0.6", remote_mac: null, timestamp: ORA, source: "device" }],
    uplinkPorts: [{ device_id: 2, port_index: 25, port_name: "SFP+ 1" }],
    ports: [{ device_id: 5, port_index: 1, port_name: "Port 1", speed: null, status: "up", stp_state: "forwarding" }],
    macPorts: [{ device_id: 1, mac: "02:00:00:00:00:02", port_name: "ether3", timestamp: ORA, source: "device" }],
  });
  assert.deepEqual(prove(i, "dev:1"), ["mac_dietro", "vicini"]);      // legge vicini; dietro una sua porta c'è SW-2
  assert.deepEqual(prove(i, "dev:2"), ["controller", "uplink"]);      // gestito dal controller, con la sua porta di uplink
  assert.deepEqual(prove(i, "dev:3"), ["controller", "padre_di"]);    // SW-2 esce verso di lui
  assert.deepEqual(prove(i, "dev:4"), ["a_mano"]);                     // «Ruolo nella mappa → Apparato di rete»
  assert.deepEqual(prove(i, "dev:5"), ["spanning_tree"]);             // una porta con lo stato dello spanning tree
  assert.deepEqual(prove(i, "dev:6"), ["annuncio"]);                  // si annuncia come apparato (MNDP o CDP)
  assert.equal(PROVE_AGGIUNTE.has("annuncio"), true);
  assert.equal(PROVE_AGGIUNTE.has("vicini"), false);
});

test("VM ospitate e capi di un salto radio sono prove (il salto radio arriva in T3: qui come parametro)", () => {
  const i = baseInput({ devices: [dev(7, { name: "RADIO-7", device_type: "access_point" })] });
  const idx = buildNodeIndex(i.devices, i.hosts, i.knownMacs, i.neighbors);
  const vm = { id: "vm:9:100", name: "vm", status: "running", ips: [], hypervisorNodeId: "dev:9", nodeId: null, scannedAt: null };
  const p = proveDiRuolo(i, idx, { vms: [vm], capiRadio: new Set(["dev:7"]) });
  assert.deepEqual([p.get("dev:9"), p.get("dev:7")], [["vm"], ["radio"]]);
});

test("I28 — non sono prove: il tipo dichiarato, la classificazione, essere visto via LLDP da uno switch o nella tabella MAC di altri", () => {
  const PC = "02:00:00:00:00:31";
  const i = baseInput({
    devices: [dev(2, { name: "SW-2", via: "api" }), dev(31, { name: "PC-31", device_type: "switch", vendor: "windows", host: "10.0.0.31" })],
    hosts: [host(40, { ip: "10.0.1.40", hostname: "TELEFONO-40", classification: "router" })],
    knownMacs: [{ device_id: 31, mac: PC }],
    neighbors: [{ device_id: 2, local_port: "Port 7", remote_device_name: "PC-31", remote_port: "eth0", protocol: "lldp", remote_ip: null, remote_mac: PC, timestamp: ORA, source: "unifi" }],
    macPorts: [{ device_id: 2, mac: PC, port_name: "Port 7", timestamp: ORA, source: "device" }],
  });
  assert.deepEqual(prove(i, "dev:31"), []);
  assert.deepEqual(prove(i, "host:40"), []);
  const m = buildTopologyModel(i);
  assert.deepEqual(m.daSistemare?.map((d) => d.id), ["dev:31"]);
  assert.equal(m.classiMappa?.["dev:31"], "da_sistemare");
  assert.deepEqual([...autoVisible(m)].sort(), ["dev:2"], "fuori dalla mappa automatica");
});

test("classeInMappa: «infra» e «ap» solo con una prova; il ruolo a mano decide prima di tutto; gli altri come nodeClass", () => {
  const sw = { type: "switch", vendor: null };
  assert.equal(classeInMappa(sw, [], null), "da_sistemare");
  assert.equal(classeInMappa(sw, ["vicini"], null), "infra");
  assert.equal(classeInMappa({ type: "access_point", vendor: null }, undefined, null), "da_sistemare");
  assert.equal(classeInMappa(sw, [], "rete"), "infra");
  assert.equal(classeInMappa(sw, ["vicini"], "attaccato"), "att");
  assert.equal(classeInMappa({ type: "server", vendor: null }, [], null), "att");
  assert.equal(classeInMappa({ type: "workstation", vendor: null }, [], null), "client");
});

test("H4b — un host che la classificazione dice router, senza prove, è «da sistemare» col motivo; un apparato col suo", () => {
  assert.equal(motivoDaSistemare({ kind: "device", type: "switch" }),
    "dichiarato switch, ma nessuna prova che lo sia: non vede vicini (LLDP, CDP, MNDP), nessuna porta con spanning tree, nessun apparato dietro le sue porte. Se lo è: Ruolo nella mappa → Apparato di rete");
  assert.match(motivoDaSistemare({ kind: "host", type: "router" }), /^la classificazione automatica lo dice router, ma nessuna prova che lo sia: .* prima Promuovi ad apparato/);
});

test("«Da sistemare» si comporta come un client: conta come client sulla porta, i MAC dietro di lui non lo rendono di passaggio", () => {
  const PC = "02:00:00:00:00:31", DIETRO = "02:00:00:00:00:41";
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router" }), dev(2, { name: "SW-2", via: "api", uplink_mac: "02:00:00:00:00:01" }), dev(31, { name: "PC-31", device_type: "switch", vendor: "windows", host: "10.0.0.31" })],
    knownMacs: [{ device_id: 1, mac: "02:00:00:00:00:01" }, { device_id: 31, mac: PC }],
    hosts: [host(41, { ip: "10.0.1.41", mac: DIETRO, hostname: "STAMPANTE-41", classification: "printer" })],
    macPorts: [
      { device_id: 2, mac: PC, port_name: "Port 7", timestamp: ORA, source: "device" },
      { device_id: 31, mac: DIETRO, port_name: "Port 1", timestamp: ORA, source: "device" },
    ],
  });
  const m = buildTopologyModel(i);
  assert.equal(m.links.some((l) => l.a === "dev:31" || l.b === "dev:31"), false, "nessuna linea «tabella MAC» verso il PC");
  assert.deepEqual(m.portClients.map((p) => [p.nodeId, p.port, p.clients.map((c) => c.nodeId)]), [["dev:2", "Port 7", ["dev:31"]]]);
});

test("R2 — in una mappa passo passo «da sistemare» resta, come foglia: non fa da ponte verso chi sta dietro", () => {
  const add = (id: number, a: string, b: string) => ({ id, action: "add" as const, a_node: a, a_port: "", b_node: b, b_port: "", medium: null });
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", topology_role: "rete" }), dev(31, { name: "PC-31", vendor: "windows" }), dev(5, { name: "SW-5", topology_role: "rete" })],
    overrides: [add(1, "dev:1", "dev:31"), add(2, "dev:31", "dev:5")],
  });
  const t = buildTree(buildTopologyModel(i), new Set(["dev:1", "dev:31", "dev:5"]), ["dev:1"]);
  assert.deepEqual([t.children.get("dev:1"), t.children.get("dev:31"), t.roots], [["dev:31"], [], ["dev:1", "dev:5"]]);
});

// Review Focus 6 (revisione del piano, 15/10): un oggetto senza prove che oggi ha un figlio. Esce dall'albero; il figlio
// non resta appeso a lui: va per un'altra via o diventa radice, e la misura lo conta fra i padri cambiati.
test("Review Focus 6 — chi va in «Da sistemare» non si porta dietro i figli: il figlio diventa radice, e si conta", () => {
  const i = baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh" }),
      dev(31, { name: "PC-31", vendor: "windows" }),
      dev(5, { name: "SW-5", via: "api", controller_mac: "02:00:00:00:00:05" }),
    ],
    neighbors: [
      { device_id: 1, local_port: "ether5", remote_device_name: "PC-31", remote_port: "eth0", protocol: "lldp", remote_ip: "10.0.0.31", remote_mac: null, timestamp: ORA, source: "device" },
      { device_id: 5, local_port: "Port 1", remote_device_name: "PC-31", remote_port: "eth0", protocol: "lldp", remote_ip: "10.0.0.31", remote_mac: null, timestamp: ORA, source: "unifi" },
    ],
  });
  const m = buildTopologyModel(i);
  assert.equal(m.classiMappa?.["dev:31"], "da_sistemare");
  const dopo = buildTree(m, autoVisible(m), ["dev:1"]);
  const comeT1 = { ...m, classiMappa: {}, daSistemare: [] };
  const prima = buildTree(comeT1, autoVisible(comeT1), ["dev:1"]);
  assert.deepEqual(padriCambiati(padriDi(prima), padriDi(dopo)), [
    { id: "dev:31", prima: "dev:1", dopo: undefined }, { id: "dev:5", prima: "dev:31", dopo: null },
  ]);
});

// Review Focus 7: un `topology_role` scritto da una versione successiva («core» e «accesso» di T3, spec §13.9), e poi si è
// tornati a T1b. «Core» e «accesso» sono ruoli di rete; un valore sconosciuto non rompe niente: decide il sistema.
test("Review Focus 7 — un ruolo a mano che T1b non conosce: «core» e «accesso» valgono apparato di rete; un altro valore, decide il sistema", () => {
  const i = baseInput({ devices: [dev(4, { topology_role: "core" }), dev(6, { topology_role: "accesso" }), dev(7, { topology_role: "boh" })] });
  assert.deepEqual([prove(i, "dev:4"), prove(i, "dev:6"), prove(i, "dev:7")], [["a_mano"], ["a_mano"], []]);
  assert.deepEqual(buildTopologyModel(i).daSistemare?.map((d) => d.id), ["dev:7"]);
});
```

(in testa a `ruolo.test.ts`, anche `import { padriCambiati, padriDi } from "@/lib/topology/misura";`.)

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/ruolo.test.ts > "$SCRATCH/t1b-13.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`, «Cannot find module '@/lib/topology/cavi/ruolo'».

- [ ] **Step 3: il codice** — `src/lib/topology/cavi/ruolo.ts`:

```ts
/**
 * Il ruolo dalle prove (spec topologia §13.8.2, D6): un oggetto fa da switch, router o access point nell'albero solo se
 * ha almeno una prova SUA. Il tipo dichiarato e la classificazione automatica non bastano: sull'hub 19 PC e server
 * (spec §13.1 punto 12) registrati come «switch» per l'inventario, sei nell'albero, e la promessa della spec §8 («la
 * mappa li mette in Da sistemare») non era mantenuta (vincolo 7 di Riccardo, 14/10). Alle quattro prove di D6 Riccardo
 * ne ha aggiunte sei e il ruolo a mano (14/10 sera). Logica pura, senza nomi di prodotto (prova I37).
 */
import { nodeClass, type NodeClass } from "@/lib/topology/identity";
import { righeUltimoGiro } from "@/lib/topology/links";
import type { MapVm, TopologyModelInput } from "@/lib/topology/model-types";
import { canonical, nameKey, type NodeIndex } from "@/lib/topology/node-index";
import { normalizeMacForStorage } from "@/lib/utils";

export type ProvaRuolo = "vicini" | "spanning_tree" | "mac_dietro" | "vm" | "uplink" | "controller" | "padre_di" | "annuncio" | "radio" | "capacita" | "a_mano";

/** Le prove aggiunte il 14/10 sera (§13.15): nell'elenco per nome si segnano a parte gli oggetti tenuti solo da loro. */
export const PROVE_AGGIUNTE: ReadonlySet<ProvaRuolo> = new Set<ProvaRuolo>(["uplink", "controller", "padre_di", "annuncio", "radio", "capacita"]);

/** Come resolveNode (node-index.ts), ma senza creare il nodo di un host: le prove non cambiano i nodi del modello. */
function chiDi(idx: NodeIndex, ref: { ip?: string | null; mac?: string | null; name?: string | null }): string | null {
  const mac = normalizeMacForStorage(ref.mac ?? null);
  const k = nameKey(ref.name);
  for (const c of [ref.ip ? idx.byIp.get(ref.ip) : undefined, mac ? idx.byMac.get(mac) : undefined, k ? idx.byName.get(k) : undefined]) {
    if (typeof c === "string") return canonical(idx, c);
  }
  return null;
}

/** La classe di un nodo, anche se il suo host non è ancora un nodo (le prove si calcolano prima di attaccare i MAC). */
function classeDi(idx: NodeIndex, id: string): NodeClass | null {
  const n = idx.nodes.get(id);
  if (n) return nodeClass(n);
  const m = /^host:(\d+)$/.exec(id);
  const h = m ? idx.hostById.get(Number(m[1])) : undefined;
  return h ? nodeClass({ type: h.classification || "unknown" }) : null;
}

/**
 * Il ruolo a mano come lo legge T1b: «rete» e «attaccato»; «core» e «accesso», che scriverà T3 (spec §13.9), valgono
 * «rete» (una versione successiva li ha scritti e si è tornati indietro: Review Focus 7); ogni altro valore, o vuoto,
 * decide il sistema.
 */
export function ruoloLetto(v: string | null | undefined): "rete" | "attaccato" | null {
  const r = (v ?? "").trim();
  return r === "rete" || r === "core" || r === "accesso" ? "rete" : r === "attaccato" ? "attaccato" : null;
}

export function proveDiRuolo(input: TopologyModelInput, idx: NodeIndex, extra: { vms?: readonly MapVm[]; capiRadio?: ReadonlySet<string> } = {}): Map<string, ProvaRuolo[]> {
  const prove = new Map<string, Set<ProvaRuolo>>();
  const metti = (id: string | null | undefined, p: ProvaRuolo): void => {
    if (!id) return;
    const s = prove.get(id);
    if (s) s.add(p);
    else prove.set(id, new Set([p]));
  };
  // Legge vicini: lo interroghiamo come apparato di rete.
  for (const n of input.neighbors) metti(`dev:${n.device_id}`, "vicini");
  // Ha porte con uno stato di spanning tree (la lettura di oggi; nel modello per cavo i fatti per porta).
  for (const p of input.ports ?? []) if ((p.stp_state ?? "").trim() !== "") metti(`dev:${p.device_id}`, "spanning_tree");
  // La sua tabella MAC vede altri apparati di rete dietro una porta.
  for (const r of input.macPorts) {
    const io = `dev:${r.device_id}`;
    const altro = chiDi(idx, { mac: r.mac });
    const k = altro && altro !== io ? classeDi(idx, altro) : null;
    if (k === "infra" || k === "ap") metti(io, "mac_dietro");
  }
  // Ospita VM (allora è un hypervisor).
  for (const v of extra.vms ?? []) metti(v.hypervisorNodeId, "vm");
  // Le sei aggiunte: porta di uplink secondo il controller; gestito da un controller; padre di un altro apparato.
  for (const u of input.uplinkPorts) metti(`dev:${u.device_id}`, "uplink");
  for (const d of input.devices) {
    if (d.controller_mac) metti(`dev:${d.id}`, "controller");
    if (d.uplink_mac) metti(chiDi(idx, { mac: d.uplink_mac }), "padre_di");
    if (ruoloLetto(d.topology_role) === "rete") metti(`dev:${d.id}`, "a_mano");
  }
  // Si annuncia come apparato, contando solo le righe che passano R-superata: gli annunci di rete (non LLDP).
  for (const n of righeUltimoGiro(input)) {
    if (n.protocol === "lldp" || n.protocol === "unknown") continue;
    const chi = chiDi(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name });
    if (chi && chi !== `dev:${n.device_id}`) metti(chi, "annuncio");
  }
  // Capo di un salto radio: lo dicono i collegamenti di genere «radio» del modello per cavo (T3).
  for (const id of extra.capiRadio ?? []) metti(id, "radio");
  return new Map([...prove].map(([k, s]) => [k, [...s].sort()]));
}

/**
 * La classe nella mappa: quella di nodeClass (identity.ts:52-60), ma «infra» e «ap» solo con una prova. Il ruolo a mano
 * decide prima di tutto: «Attaccato (server, PC)» fa foglia, «Apparato di rete» tiene nell'albero. Il tipo del nodo è
 * quello che chiede nodeClass, preso da lì: scritto qui nominerebbe un prodotto (prova I37).
 */
export function classeInMappa(n: Parameters<typeof nodeClass>[0], prove: readonly ProvaRuolo[] | undefined,
  ruoloAMano: "rete" | "attaccato" | null): NodeClass | "da_sistemare" {
  const base = nodeClass(n);
  if (ruoloAMano === "attaccato") return base === "hyper" ? "hyper" : "att";
  if (ruoloAMano === "rete") return base === "ap" ? "ap" : "infra";
  if (base !== "infra" && base !== "ap") return base;
  return (prove?.length ?? 0) > 0 ? base : "da_sistemare";
}
```

`src/lib/topology/da-sistemare.ts`:

```ts
/**
 * Il motivo di «Da sistemare» per un oggetto senza prove di ruolo (spec topologia §13.8.2), in parole: chi guarda capisce
 * perché non è nell'albero e come rimetterlo. Fuori da cavi/ perché nomina i protocolli (prova I37).
 */
import type { MapNode } from "@/lib/topology/model-types";

const TIPO: Readonly<Record<string, string>> = { router: "router", firewall: "firewall", switch: "switch", access_point: "access point" };
const NESSUNA = "ma nessuna prova che lo sia: non vede vicini (LLDP, CDP, MNDP), nessuna porta con spanning tree, nessun apparato dietro le sue porte";

export function motivoDaSistemare(n: Pick<MapNode, "kind" | "type">): string {
  const tipo = TIPO[n.type] ?? n.type;
  return n.kind === "device"
    ? `dichiarato ${tipo}, ${NESSUNA}. Se lo è: Ruolo nella mappa → Apparato di rete`
    : `la classificazione automatica lo dice ${tipo}, ${NESSUNA}. Se lo è: prima Promuovi ad apparato, poi Ruolo nella mappa → Apparato di rete`;
}
```

`model-types.ts`: prima di `TopologyModel`, `export type ClasseMappa = "infra" | "ap" | "hyper" | "att" | "client" | "da_sistemare";`; in `TopologyModel`, dopo `correzioniOrfane`:

```ts
  /** La classe nella mappa dove è diversa da nodeClass (spec §13.8.2): «da sistemare» o il ruolo a mano. Assente nelle prove di prima. */
  classiMappa?: Record<string, ClasseMappa>;
  /** Gli oggetti senza prove di ruolo, col motivo in parole: l'elenco «Da sistemare» (spec §8, D6). */
  daSistemare?: Array<{ id: string; motivo: string }>;
```

e in `ModelCounts`, dopo `vmsOnNodes`: `/** Oggetti dichiarati apparati di rete senza una prova (spec §13.8.2). */ senzaProve: number;`.

`model.ts`: import di `proveDiRuolo`, `classeInMappa`, `ruoloLetto` da `cavi/ruolo`, di `motivoDaSistemare` da `da-sistemare`, dei tipi `ClasseMappa` e `MapNode` da `model-types`; dopo `placeVms` (oggi `:30`):

```ts
  // T1b (spec §13.8.2): le prove di ruolo, prima di attaccare i MAC — chi è «da sistemare» conta come un client.
  const prove = proveDiRuolo(input, idx, { vms });
  const ruoloAMano = new Map<string, "rete" | "attaccato" | null>(
    input.devices.map((d) => [`dev:${d.id}`, ruoloLetto(d.topology_role)]),
  );
  const classe = (n: MapNode) => classeInMappa(n, prove.get(n.id), ruoloAMano.get(n.id) ?? null);
```

`attachMacs(..., { vmMacs, runningVmMacs, ignorati, segmenti, ipervisori, regole, classe })`; dopo `nodes` (`:42-48`):

```ts
  const classiMappa: Record<string, ClasseMappa> = {};
  for (const n of nodes) {
    if (vmNodeIds.has(n.id)) continue;
    const k = classe(n);
    if (k !== nodeClass(n)) classiMappa[n.id] = k;
  }
  const daSistemare = nodes
    .filter((n) => !n.hidden && classiMappa[n.id] === "da_sistemare")
    .map((n) => ({ id: n.id, motivo: motivoDaSistemare(n) }));
```

`counts` riceve `senzaProve: daSistemare.length`; il ritorno `classiMappa, daSistemare`.

`attach.ts` (tipo `ClasseMappa` importato da `model-types`): `OpzioniAttacco` riceve

```ts
  /** La classe nella mappa (T1b, §13.8.2): chi è «da sistemare» conta come un client e i MAC dietro di lui non lo rendono di passaggio. */
  classe?: (n: MapNode) => ClasseMappa;
```

e nella destrutturazione delle opzioni `classe = nodeClass`. Cinque cambi, cercati per contenuto (i numeri di riga sono quelli di oggi, prima dei Task 7 e 9):

1. la candidatura di una riga (oggi `:73-74`): `counting: CLIENT_COUNTING.includes(n.type) && classe(n) !== "da_sistemare"`, e `const fisica = (n.type === "router" || n.type === "firewall") && classe(n) !== "da_sistemare" && fisicaDelRouter(n, r.port_name);` — la tabella MAC di chi è «da sistemare» non conta client e non lo rende di passaggio, nemmeno come ripiego del router;
2. `const apparato = …` (oggi `:98`): `const apparato = other && !["client", "da_sistemare"].includes(classe(other)) ? other : undefined;`;
3. la condizione del ramo degli apparati (oggi `:106`): `if (other && other.id !== best.node && !["client", "da_sistemare"].includes(classe(other)))` — chi è «da sistemare» finisce fra i client della porta, nessuna linea «tabella MAC»;
4. `diRete` riceve la classe, e `ripiegoRouter` un parametro in più (`classe`, dopo `bloccato` del Task 9) che passa a ogni chiamata di `diRete`:

```ts
/** Apparati di rete: possono stare sopra un altro apparato (lo switch, l'AP, un altro router). «Da sistemare» no (T1b). */
function diRete(idx: NodeIndex, id: string, classe: (n: MapNode) => ClasseMappa): boolean {
  const n = idx.nodes.get(id);
  if (!n) return false;
  const k = classe(n);
  return k === "infra" || k === "ap";
}
```

`tree.ts` (tipo `ClasseMappa` importato da `model-types`; i numeri di riga sono quelli di oggi): in testa a `buildTree`, `const classe = (n: MapNode): ClasseMappa => model.classiMappa?.[n.id] ?? nodeClass(n);` e le foglie (`:47-48`): `const cls = classe(nodes.get(x)!); if (cls === "att" || cls === "client" || cls === "hyper" || cls === "da_sistemare") continue;`; l'ordine delle radici (`:73`) usa `classe(…) !== "infra"`; `hypervisorPreferred` riceve la stessa `classe` e la usa in `padre` (`["att", "client", "hyper", "da_sistemare"].includes(classe(o))`). `autoVisible`: `model.nodes.filter((n) => !["client", "da_sistemare"].includes(model.classiMappa?.[n.id] ?? nodeClass(n)) && …)`. `missingNeighbors`: `!["client", "da_sistemare"].includes(model.classiMappa?.[other.id] ?? nodeClass(other))`. `proposeHead`: fra i router solo quelli che non sono «da sistemare» (`&& model.classiMappa?.[x.id] !== "da_sistemare"`).

`object-list.tsx` (`:53-70`), nel calcolo dei gruppi e del motivo:

```tsx
    const fuori = new Map((model.daSistemare ?? []).map((d) => [d.id, d.motivo]));
    const why = (n: MapNode): string | null =>
      promote.has(n.id) ? "host da promuovere" : fuori.has(n.id) ? "senza prove di ruolo" : suspicious.has(n.id) ? "tipo sospetto" : isolated.has(n.id) ? "nessun collegamento" : null;
    // … i gruppi di prima …
    return { list: out, why, motivo: (n: MapNode) => fuori.get(n.id) ?? null };
```

e nella riga dell'elenco (oggi `:119`) il `title` riceve il motivo intero:

```tsx
                      title={[n.name, n.mgmtIp, typeLabel(n.type), why, groups.motivo(n), inMap ? null : DRAG_HINT[drag]].filter(Boolean).join(" · ")}
```

`map-canvas.tsx`, nei dati del riquadro (dopo `redundantShown`):

```tsx
          daSistemare: model.classiMappa?.[ln.id] === "da_sistemare",
```

`map-node.tsx`: in `BoxData`, dopo `redundantShown`:

```tsx
  /** T1b (spec §13.8.2): senza prove di ruolo, «da sistemare» (resta in una mappa passo passo, come foglia). */
  daSistemare?: boolean;
```

e la seconda riga del riquadro (`:86-88`), come «host · da promuovere» (IP e tipo restano nel `title`):

```tsx
  const second = data.promote
    ? "host · da promuovere"
    : data.daSistemare
    ? "da sistemare"
    : [n.mgmtIp ?? typeLabel(n.type), data.clients ? `${data.clients} client` : null].filter(Boolean).join(" · ");
```

`dati-client.tsx`, nei numeri, dopo `["Tipi sospetti", c.suspiciousTypes],`:

```tsx
    ["«Da sistemare»: senza prove di ruolo", c.senzaProve],
```

`misura.ts`: in `conteggi`, `senza_prove: model.daSistemare?.length ?? 0,` e:

```ts
/** Gli oggetti di rete nell'albero tenuti SOLO da una prova aggiunta il 14/10 sera (da guardare a parte con Riccardo, §13.8.2). */
export function soloProveAggiunte(input: TopologyModelInput, model: TopologyModel): string[] {
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
  const prove = proveDiRuolo(input, idx, { vms: model.vms });
  return model.nodes
    .filter((n) => ["infra", "ap"].includes(model.classiMappa?.[n.id] ?? nodeClass(n)))
    .filter((n) => { const p = prove.get(n.id) ?? []; return p.length > 0 && p.every((x) => PROVE_AGGIUNTE.has(x)); })
    .map((n) => n.id).sort();
}
```

(import in `misura.ts` di `PROVE_AGGIUNTE` e `proveDiRuolo` da `cavi/ruolo` e di `nodeClass` da `identity`.) `scripts/misura-cavi.ts`: `soloProveAggiunte` entra nell'import da `../src/lib/topology/misura`, e nel blocco `--nomi`, prima di «— «Da sistemare»: senza collegamenti —»:

```ts
    w("\n— «Da sistemare»: senza prove di ruolo —");
    for (const d of model.daSistemare ?? []) w(`${nome(d.id)} · ${d.motivo}`);
    w("\n— nell'albero solo per una prova aggiunta —");
    for (const id of soloProveAggiunte(input, model)) w(nome(id));
```

- [ ] **Step 4: verdi** — tutte le prove della topologia (I37 su `cavi/ruolo.ts` compresa):

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1b-13.log" 2>&1; echo "exit=$?"`

Atteso, **misurato il 14/10 su un prototipo di questo task sopra il codice di oggi** (333 prove della topologia): cadono 10 prove, e nessuna per un difetto della regola. Sei perché i dati finti non hanno la forma vera — un router letto via SSH ha le sue righe di vicini, uno switch del controller ha `controller_mac` — e si correggono dando ai dati la prova che il dato vero ha, **mai** con `topology_role` (nasconderebbe la regola), col commento «T1b (spec §13.8.2): la prova di ruolo che il dato vero ha»:

1. `attach.test.ts`, le prove del Task 9 con `dev(2, { name: "CENTRALE-2", host: "192.0.2.2" })` (I-3/I9 tabella MAC, I9 porta occupata, C5 cadono; alle due «dalle VM» non serve, perché CENTRALE-2 ha già la sua riga LLDP o è la stessa forma vera; la prova «un cavo LLDP ignorato … dalla tabella MAC» del Task 9 ha CORE-1 con la sua riga LLDP, e ACC-A senza prove va fra i client della porta: resta verde così): `dev(2, { name: "CENTRALE-2", host: "192.0.2.2", controller_mac: "02:00:00:00:02:02" })`;
2. `attach.test.ts`, «I-3/I9: il ripiego del router ignorato non torna»: nell'`input` `neighbors: [...input().neighbors, { device_id: 1, local_port: "ether2", remote_device_name: "SW-2", remote_port: "Port 2", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: RECENTE, source: "device" }]`;
3. `link-attrs.test.ts`, `rete()`: in `neighbors` le due righe del router, `{ device_id: 1, local_port: "ether2", remote_device_name: "SW-A", remote_port: "Port 1", protocol: "lldp", remote_ip: "192.0.2.2", remote_mac: null, timestamp: RECENTE, source: "device" }` e la stessa con `ether3`, `SW-B`, `192.0.2.3` (le stesse dei cavi già visti dagli switch, dal lato del router: nessun collegamento nuovo);
4. `vm-ports.test.ts`, `rete()`: sopra la funzione

```ts
/** Il router letto via SSH ha le sue righe: gli stessi cavi verso i tre switch, visti dal suo lato (T1b, spec §13.8.2). */
const routerVede = (id: number, nome: string) => ({
  device_id: 1, local_port: `ether${id}`, remote_device_name: nome, remote_port: "Port 24", protocol: "lldp",
  remote_ip: `192.0.2.${id}`, remote_mac: null, timestamp: RECENTE, source: "device",
});
```

   e `neighbors: [lldp(2), lldp(3), lldp(4), routerVede(2, "CENTRALE-2"), routerVede(3, "CENTRALE-3"), routerVede(4, "ACCESSO-4")]`;
5. `vms.test.ts`, `cluster()`: `dev(2, { name: "SW-1", host: "192.0.2.2", controller_mac: "02:00:00:00:02:02" })`.

Con queste, il prototipo dà 329 verdi su 333; le 4 rimaste sono i numeri delle fixture in `model-fixtures.test.ts` («conteggi misurati» e «conteggi principali uguali a quelli del dato vero» del cliente A, le dimensioni in verticale delle due fixture). Sul prototipo: cliente A 9 oggetti «da sistemare» (7 apparati dichiarati switch e 2 host classificati router, come la «Misura di lavoro» della spec), 5 collegamenti «tabella MAC» fra switch in meno (verso 5 di quegli switch, che diventano client della porta), nessun altro collegamento cambiato; hub 24 «da sistemare», nessun collegamento cambiato. Si riscrivono `MISURATI`, `MISURATI_DATO_VERO` e le dimensioni coi valori nuovi e il commento «T1b (spec §13.8.2): ‹n› oggetti senza prove di ruolo; da riconfermare sulle copie nel Task 16» (le fixture hanno le righe del router tutte `mndp`: i numeri sono **indicativi**). Se cade un'altra prova: se è per la stessa ragione (un apparato finto senza la prova che il vero ha), stessa cura; altrimenti **ci si ferma** e si guarda il perché, senza ritoccare numeri.

Poi `npx tsc --noEmit` e `npx eslint src/lib/topology src/components/topology "src/app/(dashboard)/topology"` con `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/cavi/ruolo.ts src/lib/topology/da-sistemare.ts src/lib/topology/model-types.ts src/lib/topology/model.ts src/lib/topology/attach.ts src/lib/topology/tree.ts src/lib/topology/misura.ts scripts/misura-cavi.ts src/components/topology/map/object-list.tsx src/components/topology/map/map-canvas.tsx src/components/topology/map/map-node.tsx "src/app/(dashboard)/topology/dati/dati-client.tsx" src/lib/topology/__tests__/ruolo.test.ts src/lib/topology/__tests__/model-fixtures.test.ts src/lib/topology/__tests__/attach.test.ts src/lib/topology/__tests__/link-attrs.test.ts src/lib/topology/__tests__/vm-ports.test.ts src/lib/topology/__tests__/vms.test.ts
git commit -m "feat(topologia): apparato di rete solo con una prova, gli altri in «Da sistemare» col motivo (spec §13.8.2, D6)"
```

- [ ] **Step 6: le prove che falliscono (passaggio universale)** — in `src/lib/topology/__tests__/ruolo.test.ts` l'import `import { computeMapView } from "@/lib/topology/map-compute";` (dopo quello di `tree`), e in fondo:

```ts
// ─── Passaggio universale (spec §13.16) per T1b ───

// I64 (spec §13.8.2, G10; H14, C16). Rete B: cinque oggetti di rete senza collegamenti (due switch di laboratorio che si
// annunciano via MNDP, uno switch che non risponde, un notebook e un telefono classificati router) erano radici sole della
// mappa automatica: «Da sistemare» prendeva solo apparati, attaccati e hypervisor. Cliente A: la radio lontana a 60 GHz.
test("I64 — nessuna radice sola: un host di rete con una prova di ruolo e nessun collegamento va in «Da sistemare», «nessun collegamento»", () => {
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh", host: "10.0.0.1" }), dev(2, { name: "SW-2", host: "10.0.0.2", controller_mac: "02:00:00:00:00:02" })],
    hosts: [host(40, { ip: "10.0.1.40", mac: "02:00:00:00:00:40", hostname: "LAB-SW-40", classification: "switch" })],
    neighbors: [
      { device_id: 1, local_port: "ether2", remote_device_name: "SW-2", remote_port: "Port 1", protocol: "lldp", remote_ip: "10.0.0.2", remote_mac: null, timestamp: ORA, source: "device" },
      // lo switch di laboratorio si annuncia (MNDP) su una VLAN del router: una prova di ruolo, nessun cavo
      { device_id: 1, local_port: "vlan40", remote_device_name: "LAB-SW-40", remote_port: "bridge", protocol: "mndp", remote_ip: "10.0.1.40", remote_mac: "02:00:00:00:00:40", timestamp: ORA, source: "device" },
    ],
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(prove(i, "host:40"), ["annuncio"]);
  assert.deepEqual(m.isolated, ["host:40"]);
  assert.deepEqual([...autoVisible(m)].sort(), ["dev:1", "dev:2"], "fuori dalla mappa automatica: non è una seconda radice");
  // nessun oggetto perso dalle mappe passo passo: chi ce l'ha messo lo ritrova
  const passo = computeMapView(m, { auto: false, members: ["dev:1", "host:40"], roots: ["dev:1"], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
  assert.deepEqual([passo.missing, passo.visible.has("host:40")], [[], true]);
});

// I65 (spec §13.8.2, G10, G12). «Hypervisor» solo con una prova: ospita VM o è un hypervisor censito e letto (scansione Proxmox);
// la classificazione da sola no (rete B: un nodo «hypervisor» fatto di host fusi su un MAC). Lo stato dello spanning tree vale
// come prova solo se attivo: `disabled` vuol dire spanning tree spento, e su una porta giù ogni stato vale «giù».
test("I65 — «hypervisor» solo con una prova; `disabled`, o uno stato su una porta giù, non è una prova di spanning tree", () => {
  const i = baseInput({
    devices: [
      dev(60, { name: "SW-60" }), dev(61, { name: "SW-61" }), dev(62, { name: "SW-62" }),
      dev(63, { name: "HV-63", device_type: "server", vendor: "proxmox", proxmox_scan: 1 }),
    ],
    // due host fusi sullo stesso MAC, classificati hypervisor (la forma del caso della rete B, che ne ha diciotto)
    hosts: [50, 51].map((k) => host(k, { ip: `10.0.1.${k}`, mac: "02:00:00:00:00:50", hostname: "HV-FUSO", classification: "hypervisor" })),
    ports: [
      { device_id: 60, port_index: 1, port_name: "Port 1", speed: null, status: "up", stp_state: "disabled" },
      { device_id: 61, port_index: 1, port_name: "Port 1", speed: null, status: "down", stp_state: "forwarding" },
      { device_id: 62, port_index: 1, port_name: "Port 1", speed: null, status: "up", stp_state: "forwarding" },
    ],
  });
  assert.deepEqual([prove(i, "dev:60"), prove(i, "dev:61"), prove(i, "dev:62")], [[], [], ["spanning_tree"]]);
  assert.equal(classeInMappa({ type: "hypervisor" }, ["scansione"], null), "hyper", "un hypervisor censito e letto resta hypervisor");
  const m = buildTopologyModel(i);
  assert.deepEqual(m.daSistemare?.map((d) => d.id), ["dev:60", "dev:61"]);
  assert.equal(m.classiMappa?.["host:50"], "att", "classificato hypervisor, senza VM né scansione: un attaccato");
  assert.equal(m.classiMappa?.["dev:63"], undefined, "un hypervisor censito e letto resta hypervisor");
  assert.equal(classeInMappa({ type: "hypervisor" }, ["vm"], null), "hyper", "chi ospita VM è un hypervisor");
});
```

In `src/lib/topology/__tests__/misura.test.ts`, `vistiSoloViaLldp` entra nell'import da `@/lib/topology/misura`, e in fondo:

```ts
// Scelta 4 del §13.16 (spec §13.8.2): in T1b le capacità annunciate non sono ancora una prova; uno switch che solo l'LLDP di altri
// vede esce dall'albero. Si contano, e sul cliente A si elencano per nome a Riccardo prima del rilascio di T1b.
test("vistiSoloViaLldp: gli oggetti senza prove di ruolo che altri vedono via LLDP", () => {
  const i = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh" }), dev(9, { name: "SW-STORAGE" })],
    neighbors: [{ device_id: 1, local_port: "sfp-sfpplus11", remote_device_name: "SW-STORAGE", remote_port: "Port 1", protocol: "lldp", remote_ip: "10.0.0.9", remote_mac: null, timestamp: "2026-10-13 11:00:00", source: "device" }],
  });
  const m = buildTopologyModel(i);
  assert.deepEqual(m.daSistemare?.map((d) => d.id), ["dev:9"]);
  assert.deepEqual(vistiSoloViaLldp(i, m), ["dev:9"]);
});
```

In `src/lib/topology/__tests__/reti-campione.test.ts` (Task 10c) l'import `import { nodeClass } from "@/lib/topology/identity";`, e prima di «// ─── Criteri che arrivano dopo T1»:

```ts
// ─── T1b (spec §13.8.2): la parte di G10 che resta, e «hypervisor» solo con una prova ───
const radici = (m: TopologyModel): string[] => Object.entries(albero(m).padri).filter(([, p]) => p === null).map(([id]) => id).sort();

test("G10 · famiglie 1, 2, 3, 4, 5 · T1b: nessuna radice sola, nessun ruolo di rete senza una prova", () => {
  // famiglia 2: gli switch di laboratorio, che solo l'LLDP del controller vede, non hanno prove di ruolo
  assert.deepEqual(modello(soloUnifi()).daSistemare?.map((d) => d.id), ["host:31", "host:32"]);
  // famiglia 5: il modem e le due radio, che la classificazione dice router e access point, senza una prova loro
  assert.deepEqual(modello(mista()).daSistemare?.map((d) => d.id), ["host:61", "host:71", "host:72"]);
  for (const [f, crea] of FAMIGLIE) assert.equal(radici(modello(crea())).length, 1, `famiglia ${f}`);
});

test("G10 · famiglia 4 · T1b: «hypervisor» solo con una prova: i due nodi Proxmox restano hypervisor, l'host senza VM né scansione è un attaccato", () => {
  const m = modello(conHypervisor());
  const nodi = new Map(m.nodes.map((n) => [n.id, n]));
  assert.deepEqual([nodeClass(nodi.get("dev:41")!), nodeClass(nodi.get("dev:42")!), nodeClass(nodi.get("host:49")!)], ["hyper", "hyper", "hyper"]);
  assert.deepEqual(m.classiMappa ?? {}, { "host:49": "att" });
  assert.equal(m.vms.some((v) => v.hypervisorNodeId === "host:49"), false);
});

// Spec §13.8.2 e §13.16, scelta 8: la prova «si annuncia come apparato (MNDP o CDP)» è confermata da Riccardo il 14/10. Un
// telefono IP che la classificazione automatica dice router si annuncia via CDP, la passa e resta nell'albero come apparato di
// rete. La riga dice che cosa vorrebbe la rete; se Riccardo sceglie una guardia, la prova smette di essere «da fare».
test("G10 · famiglia 5 · T1b: un telefono che si annuncia via CDP non è un apparato di rete", { todo: "fatto da confermare a Riccardo (spec §13.16, scelta 8)" }, () => {
  assert.equal(modello(mista()).daSistemare?.some((d) => d.id === "host:81"), true);
});
```

In fondo a `src/lib/topology/__tests__/model-fixtures.test.ts`, dopo le misure del Task 10c (Step 1b), le stesse due prove sulle due reti vere che prima erano la «famiglia 4» (revisione finale del 15/10: le reti vere sono misure, non famiglie):

```ts
// T1b (spec §13.8.2) sulle due reti vere: H14 sull'hub, C16 sul cliente A (la radio lontana esce dall'albero), I65 sull'hub.
test("H14 e C16, T1b: sulle due reti una radice sola, il router", () => {
  for (const nome of FIXTURE_VERE) assert.deepEqual(automatico(buildTopologyModel(carica(nome))).tree.roots, ["dev:1"], nome);
});

test("I65, T1b: sull'hub un «hypervisor» senza VM né scansione è un attaccato (un nodo di host fusi)", () => {
  const m = buildTopologyModel(carica("topologia-domarc.json"));
  const nodi = new Map(m.nodes.map((n) => [n.id, n]));
  const declassati = Object.entries(m.classiMappa ?? {}).filter(([id, k]) => k === "att" && nodeClass(nodi.get(id)!) === "hyper").map(([id]) => id);
  assert.equal(declassati.length > 0, true);
  for (const id of declassati) assert.equal(m.vms.some((v) => v.hypervisorNodeId === id), false, id);
});
```

- [ ] **Step 7: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/ruolo.test.ts src/lib/topology/__tests__/misura.test.ts src/lib/topology/__tests__/reti-campione.test.ts > "$SCRATCH/t1b-13u.log" 2>&1; echo "exit=$?"; grep -E "^not ok|^# (tests|pass|fail|skipped)" "$SCRATCH/t1b-13u.log"`
Expected: `exit=1`, rosse le quattro nuove e solo quelle: I64, I65, `vistiSoloViaLldp` («is not a function») e «G10 · famiglia 4 · T1b»; «G10 · famiglie 1, 2, 3, 4, 5 · T1b» è già verde (le reti-campione non hanno radici sole nemmeno prima: è una guardia), e la prova del telefono resta «da fare» (todo, non conta fra le rosse). Le tre prove danno 51 prove, 39 verdi, 4 rosse, 7 saltate, 1 da fare (verificato il 15/10 sullo stato intero del piano, togliendo il codice dello Step 8; il prototipo, che non aveva Review Focus 6 e 7, ne contava 44). Poi le due misure sulle reti vere: `node --import tsx --test --test-name-pattern "H14 e C16|I65, T1b" src/lib/topology/__tests__/model-fixtures.test.ts > "$SCRATCH/t1b-13m.log" 2>&1; echo "exit=$?"` → `exit=1`, 2 rosse su 2.

- [ ] **Step 8: il codice** — `src/lib/topology/cavi/ruolo.ts`: la riga di `ProvaRuolo` diventa

```ts
export type ProvaRuolo = "vicini" | "spanning_tree" | "mac_dietro" | "vm" | "scansione" | "uplink" | "controller" | "padre_di" | "annuncio" | "radio" | "capacita" | "a_mano";

/** Gli stati dello spanning tree che dicono che l'apparato lo parla (spec §13.8.2, I65): non `disabled`, non `broken`. */
const STP_ATTIVO: ReadonlySet<string> = new Set(["forwarding", "learning", "listening", "blocking", "discarding"]);
```

la firma di `proveDiRuolo`:

```ts
export function proveDiRuolo(input: TopologyModelInput, idx: NodeIndex,
  extra: { vms?: readonly MapVm[]; capiRadio?: ReadonlySet<string>; scansioni?: ReadonlySet<string> } = {}): Map<string, ProvaRuolo[]> {
```

la riga dello spanning tree (`for (const p of input.ports ?? []) if ((p.stp_state ?? "").trim() !== "") …`) diventa:

```ts
  // Ha porte con uno stato di spanning tree ATTIVO (la lettura di oggi; nel modello per cavo i fatti per porta e i BPDU
  // ricevuti): inoltra, impara o è bloccata, su una porta accesa (I65). `disabled` vuol dire spanning tree spento (gli switch
  // senza spanning tree della rete B: uplink acceso e `disabled`), e su una porta giù ogni stato vale «giù» (G12).
  for (const p of input.ports ?? []) {
    const giu = ["down", "disabled"].includes((p.status ?? "").trim().toLowerCase());
    if (STP_ATTIVO.has((p.stp_state ?? "").trim().toLowerCase()) && !giu) metti(`dev:${p.device_id}`, "spanning_tree");
  }
```

dopo `for (const v of extra.vms ?? []) metti(v.hypervisorNodeId, "vm");`:

```ts
  // oppure è un hypervisor censito e letto (la scansione delle sue VM, passata dal modello: il nome del prodotto qui non
  // si scrive, prova I37).
  for (const id of extra.scansioni ?? []) metti(id, "scansione");
```

e in `classeInMappa` la prima riga del corpo (`const base = nodeClass(n);`) diventa:

```ts
  const nominale = nodeClass(n);
  // «hyper» solo con una prova (spec §13.8.2, G10, I65): ospita VM, o è un hypervisor censito e letto (una scansione). La
  // classificazione da sola no: sulla rete B un nodo «hypervisor» fatto di host fusi su un MAC resta dov'è, come attaccato.
  const base = nominale === "hyper" && !(prove ?? []).some((p) => p === "vm" || p === "scansione") ? "att" : nominale;
```

(il commento sopra la funzione dice anche: «e «hyper» solo per chi ospita VM o è un hypervisor censito e letto: altrimenti «att»».)

`src/lib/topology/model.ts`: la chiamata `const prove = proveDiRuolo(input, idx, { vms });` (Step 3) diventa

```ts
  // La scansione delle VM di un hypervisor censito (spec §11.5): una prova del ruolo «hypervisor» (§13.8.2, I65).
  const scansioni = new Set(input.devices.filter((d) => d.proxmox_scan === 1).map((d) => `dev:${d.id}`));
  const prove = proveDiRuolo(input, idx, { vms, scansioni });
```

e il filtro di `isolated` (Task 7) riceve gli host di rete:

```ts
  const isolated = nodes
    .filter((n) => !n.hidden && !vmNodeIds.has(n.id) && (degree.get(n.id) ?? 0) === 0
      && (n.kind === "device" || ["att", "hyper"].includes(nodeClass(n)) || membriDiSegmento.has(n.id)
        // T1b (spec §13.8.2, G10, I64): nessuna radice sola — un host di rete con una prova di ruolo e nessun collegamento.
        // Senza una prova sta già in `daSistemare` («senza prove di ruolo»). Rete B: cinque radici sole; cliente A la radio.
        || (n.kind === "host" && ["infra", "ap"].includes(classe(n)))))
    .map((n) => n.id);
```

`src/lib/topology/misura.ts`: import `import { righeUltimoGiro } from "@/lib/topology/links";`; in `conteggi`, dopo `senza_prove`, `visti_solo_via_lldp: vistiSoloViaLldp(input, model).length,`; prima di `soloProveAggiunte`:

```ts
/**
 * Gli oggetti senza prove di ruolo che altri vedono via LLDP (spec §13.8.2, scelta 4 del §13.16): in T1b le capacità annunciate
 * non sono ancora una prova (`remote_caps` arriva con T2), e uno switch visto solo così esce dall'albero. Sulla rete B è lo
 * switch di storage; sul cliente A si contano prima del rilascio di T1b.
 */
export function vistiSoloViaLldp(input: TopologyModelInput, model: Pick<TopologyModel, "daSistemare">): string[] {
  const fuori = new Set((model.daSistemare ?? []).map((d) => d.id));
  const idx = buildNodeIndex(input.devices, input.hosts, input.knownMacs, input.neighbors);
  const visti = new Set<string>();
  for (const n of righeUltimoGiro(input)) {
    if (n.protocol !== "lldp") continue;
    const chi = resolveNode(idx, { ip: n.remote_ip, mac: n.remote_mac, name: n.remote_device_name });
    if (chi && fuori.has(chi)) visti.add(chi);
  }
  return [...visti].sort();
}
```

`scripts/misura-cavi.ts`: `vistiSoloViaLldp` entra nell'import da `../src/lib/topology/misura`, e nel blocco `--nomi`, dopo l'elenco «— «Da sistemare»: senza prove di ruolo —» dello Step 3:

```ts
    w("\n— senza prove di ruolo, visti solo via LLDP (scelta 4 del §13.16) —");
    for (const id of vistiSoloViaLldp(input, model)) w(nome(id));
```

- [ ] **Step 9: verdi**

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1b-13u.log" 2>&1; echo "exit=$?"`
Expected: le quattro nuove verdi (le tre prove dello Step 7 danno 51 prove, 43 verdi, 7 saltate, 1 da fare; il comando con `--test-name-pattern` dello Step 7 dà 2 verdi su 2); `model-fixtures.test.ts` rossa solo sui numeri delle fixture, che si riscrivono come allo Step 4 col commento «T1b, passaggio universale (spec §13.8.2): ‹chiave› ‹prima›→‹dopo› perché ‹causa›». Le cause possibili, verificate con `misura-cavi --nomi` sulla copia: un host di rete senza collegamenti va in «Da sistemare» (I64: sul prototipo un isolato in più sul cliente A, due sulla rete B, e una radice sola su tutte e due); un «hypervisor» senza VM né scansione diventa attaccato (I65: due sulla rete B); uno stato di spanning tree non attivo non tiene più un apparato nell'albero (I65). Poi `npx tsc --noEmit` e `npx eslint src/lib/topology scripts/misura-cavi.ts` con `exit=0`.

- [ ] **Step 10: commit**

```bash
git add src/lib/topology/cavi/ruolo.ts src/lib/topology/model.ts src/lib/topology/misura.ts scripts/misura-cavi.ts src/lib/topology/__tests__/ruolo.test.ts src/lib/topology/__tests__/misura.test.ts src/lib/topology/__tests__/reti-campione.test.ts src/lib/topology/__tests__/model-fixtures.test.ts
git commit -m "feat(topologia): nessuna radice sola, «hypervisor» solo con una prova, spanning tree solo se attivo (spec §13.8.2, §13.16)"
```

---

### Task 14: «Ruolo nella mappa» (T1b.2)

Spec §13.8.2 («Ruolo a mano»), §13.11.2 (T1b.2), §13.12.4 («la rotta del ruolo nel censimento dei permessi»). **Sonnet** (meccanico: segue alla lettera la rotta «nascondi» e la sua prova). In parallelo al Task 13: questo porta il ruolo sul nodo per il menu; il Task 13 lo legge dalle righe degli apparati per la classe (stessa colonna, due usi, nessun file in comune tranne `model-types.ts`, in punti diversi).

**Files:**
- Modify: `src/lib/db-tenant.ts` (dopo `setNodeHidden`, `:9495-9498`: `setTopologyRole`)
- Modify: `src/lib/topology/api-input.ts` (dopo `parseHiddenBody`, `:302-313`: `roleSchema`, `parseNodeRoleBody`)
- Create: `src/app/api/topology/nodes/role/route.ts`
- Modify: `src/lib/topology/model-types.ts` (`MapNode.ruolo?`), `src/lib/topology/node-index.ts` (il nodo dell'apparato riceve `ruolo`)
- Modify: `src/lib/topology/map-menus.ts` (`NodeMenuKey` += `"role"`, `NodeMenuCtx.ruolo`, `RuoloMappa`, `ruoloVoci`), `src/components/topology/map/node-context-menu.tsx` (il sottomenu), `src/components/topology/map/topology-map-client.tsx:396-413` (contesto e azione)
- Modify: `docs/auth-matrix.md` (si rigenera)
- Test: `src/lib/__tests__/topology-maps-db.test.ts`, `src/lib/topology/__tests__/api-input.test.ts`, `src/lib/topology/__tests__/map-menus.test.ts`, `src/lib/topology/__tests__/node-index.test.ts`

**Interfaces:**
- Produces:

```ts
// db-tenant.ts
export function setTopologyRole(deviceId: number, role: "" | "rete" | "attaccato"): Esito;
// api-input.ts
export function parseNodeRoleBody(raw: unknown): Parsed<{ deviceId: number; role: "" | "rete" | "attaccato" }>;
// map-menus.ts
export type RuoloMappa = "" | "rete" | "attaccato";
export function ruoloVoci(attuale: RuoloMappa): Array<{ value: RuoloMappa; label: string }>;
// NodeMenuKey += "role"; NodeMenuCtx += ruolo: RuoloMappa | null
// model-types.ts: MapNode += ruolo?: "rete" | "attaccato"
// rotta: PATCH /api/topology/nodes/role { node_id: "dev:N", role: "" | "rete" | "attaccato" } → { ok: true } | { error } 400/404/500
```

- [ ] **Step 1: le prove che falliscono**

In `src/lib/__tests__/topology-maps-db.test.ts`, `setTopologyRole` nell'import da `@/lib/db-tenant` e dopo la prova «nascondi»:

```ts
test("ruolo nella mappa (T1b, spec §13.8.2): si scrive '', 'rete' o 'attaccato'; un apparato che non c'è si rifiuta", () => {
  const ruolo = () => db().prepare("SELECT topology_role FROM network_devices WHERE id = 1").pluck().get();
  assert.deepEqual(w(() => setTopologyRole(1, "rete")), { ok: true });
  assert.equal(ruolo(), "rete");
  assert.deepEqual(w(() => setTopologyRole(1, "")), { ok: true });
  assert.equal(ruolo(), "", "«Decide il sistema» torna alla stringa vuota, come le righe di oggi");
  assert.equal(w(() => setTopologyRole(99, "attaccato")).ok, false);
});
```

In `src/lib/topology/__tests__/api-input.test.ts`, in fondo:

```ts
test("ruolo nella mappa (T1b): solo gli apparati, solo i tre valori di oggi", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseNodeRoleBody({ node_id: "dev:7", role: "rete" }), { ok: true, data: { deviceId: 7, role: "rete" } });
  assert.deepEqual(m.parseNodeRoleBody({ node_id: "dev:7", role: "" }), { ok: true, data: { deviceId: 7, role: "" } });
  assert.deepEqual(m.parseNodeRoleBody({ node_id: "host:7", role: "rete" }),
    { ok: false, error: "Il ruolo nella mappa si sceglie solo per un apparato: un host prima si promuove ad apparato" });
  assert.equal(m.parseNodeRoleBody({ node_id: "dev:7", role: "core" }).ok, false, "«core» e «accesso» arrivano in T3 (§13.9)");
  assert.equal(m.parseNodeRoleBody({ node_id: "dev:7" }).ok, false);
});
```

In `src/lib/topology/__tests__/map-menus.test.ts`: `ruoloVoci` nell'import; l'aiuto `ctx` riceve `ruolo: ""` fra i valori di base; le liste attese delle prove di oggi ricevono «role» (gli apparati di un admin ce l'hanno, un host che è infrastruttura ha l'avviso), col motivo nel commento:

```ts
// T1b (spec §13.8.2): «Ruolo nella mappa ▸» per gli apparati, prima di «Nascondi»; per un host è un avviso, prima di «Promuovi».
test("menu dell'oggetto, passo passo, admin: le voci della spec §11.2 nell'ordine, solo quelle che hanno senso", () => {
  assert.deepEqual(keys(nodeMenuItems(ctx())), ["details", "connect", "start", "remove", "role", "hide"]);
  assert.deepEqual(
    keys(nodeMenuItems(ctx({ isHypervisor: true, vmCount: 4, canRefreshVms: true, addableCount: 2 }))),
    ["details", "toggleVms", "refreshVms", "connect", "addLinked", "start", "remove", "role", "hide"],
  );
  // Un host che è infrastruttura: niente «Nascondi» (solo apparati), sì «Promuovi»; il ruolo solo dopo.
  assert.deepEqual(keys(nodeMenuItems(ctx({ isDevice: false, infraHost: true, ruolo: null }))), ["details", "connect", "start", "remove", "role", "promote"]);
});
```

e allo stesso modo `["details", "connect", "head", "role", "hide"]` nella prova «tutto automatico» e `["details", "connect", "role", "hide"]` in quella con `inMap: false`. In fondo:

```ts
test("T1b — «Ruolo nella mappa ▸»: tre voci, quella di adesso segnata col testo; per un host un avviso; chi non è admin niente", () => {
  assert.deepEqual(ruoloVoci("rete"), [
    { value: "rete", label: "✓ Apparato di rete" }, { value: "attaccato", label: "Attaccato (server, PC)" }, { value: "", label: "Decide il sistema" },
  ]);
  assert.equal(ruoloVoci("").at(-1)!.label, "✓ Decide il sistema");
  const host = nodeMenuItems(ctx({ isDevice: false, infraHost: true, ruolo: null })).find((x) => x.key === "role")!;
  assert.deepEqual([host.label, host.disabled], ["Ruolo nella mappa: prima Promuovi ad apparato", true]);
  assert.equal(nodeMenuItems(ctx({ isAdmin: false, canEditMap: false })).some((x) => x.key === "role"), false);
  assert.equal(nodeMenuItems(ctx({ isDevice: false, isUncensusedVm: true, ruolo: null })).some((x) => x.key === "role"), false);
});
```

In `src/lib/topology/__tests__/node-index.test.ts` (importa già `buildNodeIndex` e `dev`), in fondo:

```ts
test("T1b — il ruolo scelto a mano arriva sul nodo dell'apparato; vuoto o assente, niente", () => {
  const idx = buildNodeIndex([dev(1, { topology_role: "rete" }), dev(2, { topology_role: "" }), dev(3)], [], []);
  assert.deepEqual([1, 2, 3].map((i) => idx.nodes.get(`dev:${i}`)!.ruolo), ["rete", undefined, undefined]);
});
```

- [ ] **Step 2: vederle fallire**

Run: `DA_INVENT_DATA_DIR="$SCRATCH/dati-prove" node --import tsx --test src/lib/__tests__/topology-maps-db.test.ts src/lib/topology/__tests__/api-input.test.ts src/lib/topology/__tests__/map-menus.test.ts src/lib/topology/__tests__/node-index.test.ts > "$SCRATCH/t1b-14.log" 2>&1; echo "exit=$?"`
Expected: `exit=1` (export mancanti `setTopologyRole`, `parseNodeRoleBody`, `ruoloVoci`; liste dei menu senza «role»).

- [ ] **Step 3: il codice**

`db-tenant.ts`, dopo `setNodeHidden`:

```ts
/** «Ruolo nella mappa» (T1b, spec §13.8.2): '' decide il sistema, 'rete' apparato di rete, 'attaccato' foglia (server, PC). */
export function setTopologyRole(deviceId: number, role: "" | "rete" | "attaccato"): Esito {
  const r = db().prepare("UPDATE network_devices SET topology_role = ? WHERE id = ?").run(role, deviceId);
  return r.changes > 0 ? { ok: true } : { ok: false, error: "Apparato non trovato" };
}
```

`api-input.ts`, dopo `parseHiddenBody`:

```ts
const roleSchema = z.object(
  {
    node_id: z.string({ error: "Apparato non valido" })
      .regex(/^dev:\d+$/, "Il ruolo nella mappa si sceglie solo per un apparato: un host prima si promuove ad apparato"),
    // Da T3 anche «core» e «accesso» (spec §13.9): oggi la rotta non li accetta.
    role: z.enum(["", "rete", "attaccato"], { error: "Ruolo non valido: «» (decide il sistema), «rete» o «attaccato»" }),
  },
  BODY,
);

export function parseNodeRoleBody(raw: unknown): Parsed<{ deviceId: number; role: "" | "rete" | "attaccato" }> {
  const r = roleSchema.safeParse(raw);
  return r.success ? { ok: true, data: { deviceId: Number(r.data.node_id.slice(4)), role: r.data.role } } : { ok: false, error: first(r.error) };
}
```

`src/app/api/topology/nodes/role/route.ts` (come `nodes/hidden/route.ts`: `requireAdmin` per primo, Zod, l'errore in italiano):

```ts
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { setTopologyRole } from "@/lib/db-tenant";
import { parseNodeRoleBody } from "@/lib/topology/api-input";
import { readJson } from "@/lib/controllers/route-helpers";

/** PATCH /api/topology/nodes/role — «Ruolo nella mappa» di un apparato (T1b, spec §13.8.2): '', 'rete' o 'attaccato'. */
export async function PATCH(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const body = parseNodeRoleBody(await readJson(req));
    if (!body.ok) return NextResponse.json({ error: body.error }, { status: 400 });
    try {
      const esito = setTopologyRole(body.data.deviceId, body.data.role);
      return esito.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: esito.error }, { status: 404 });
    } catch (error) {
      console.error("[topology] ruolo nella mappa:", error);
      return NextResponse.json({ error: "Errore nel salvataggio" }, { status: 500 });
    }
  });
}
```

`model-types.ts`, in `MapNode` dopo `proxmoxScan`:

```ts
  /** «Ruolo nella mappa» scelto a mano da un admin (T1b, spec §13.8.2); assente = decide il sistema. Solo per un apparato. */
  ruolo?: "rete" | "attaccato";
```

`node-index.ts`, nel nodo dell'apparato (`buildNodeIndex`, accanto a `proxmoxScan`): `...(d.topology_role === "rete" || d.topology_role === "attaccato" ? { ruolo: d.topology_role } : {}),`.

`map-menus.ts`: `NodeMenuKey` riceve `| "role"`; `NodeMenuCtx`, dopo `isUncensusedVm`:

```ts
  /** Il ruolo nella mappa di un apparato ('' = decide il sistema); null per un host o una VM (T1b, spec §13.8.2). */
  ruolo: RuoloMappa | null;
```

in `nodeMenuItems`, prima della riga di «hide»:

```ts
  if (c.isAdmin && c.isDevice && c.ruolo !== null) out.push({ key: "role", label: "Ruolo nella mappa" });
  else if (c.isAdmin && c.infraHost) out.push({ key: "role", label: "Ruolo nella mappa: prima Promuovi ad apparato", disabled: true });
```

e in fondo al blocco del menu dell'oggetto:

```ts
export type RuoloMappa = "" | "rete" | "attaccato";

/** Le voci di «Ruolo nella mappa ▸» nell'ordine della spec §13.8.2; quella di adesso porta «✓» (il segno è testo, non colore). */
export function ruoloVoci(attuale: RuoloMappa): Array<{ value: RuoloMappa; label: string }> {
  const voci: Array<[RuoloMappa, string]> = [["rete", "Apparato di rete"], ["attaccato", "Attaccato (server, PC)"], ["", "Decide il sistema"]];
  return voci.map(([value, label]) => ({ value, label: value === attuale ? `✓ ${label}` : label }));
}
```

`node-context-menu.tsx`: `Props` riceve `ruolo: RuoloMappa | null; onRole: (r: RuoloMappa) => void;` (import di `ruoloVoci` e del tipo da `map-menus`); nel `map` delle voci, prima di `addLinked`: `it.key === "role" && !it.disabled ? <RoleSub key={it.key} label={it.label} attuale={ruolo ?? ""} onRole={onRole} /> : …`; e in fondo:

```tsx
/** «Ruolo nella mappa ▸»: tre voci; quella di adesso è segnata e spenta (sceglierla non cambierebbe niente). */
function RoleSub({ label, attuale, onRole }: { label: string; attuale: RuoloMappa; onRole: (r: RuoloMappa) => void }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>{label}</ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {ruoloVoci(attuale).map((v) => (
          <ContextMenuItem key={v.value || "sistema"} disabled={v.value === attuale} onClick={() => onRole(v.value)}>{v.label}</ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
```

`topology-map-client.tsx` (`:396-413`): nel contesto di `nodeMenuItems` `ruolo: n.kind === "device" ? (n.ruolo ?? "") : null`; a `NodeMenuContent` `ruolo={n.kind === "device" ? (n.ruolo ?? "") : null}` e `onRole={(r) => { close(); void send("/api/topology/nodes/role", "PATCH", { node_id: n.id, role: r }); }}` (`send` mostra l'errore e ricarica il modello: l'oggetto entra o esce dall'albero subito).

- [ ] **Step 4: verdi, censimento dei permessi e matrice**

Run: `DA_INVENT_DATA_DIR="$SCRATCH/dati-prove" node --import tsx --test src/lib/__tests__/topology-maps-db.test.ts src/lib/topology/__tests__/api-input.test.ts src/lib/topology/__tests__/map-menus.test.ts src/lib/topology/__tests__/node-index.test.ts src/lib/permessi/__tests__/rotte-censite.test.ts > "$SCRATCH/t1b-14.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`. Il censimento passa senza voci nuove: una scrittura con `requireAdmin` è al livello atteso. Poi `AUDIT_STAMP=$(date +%F) npx tsx scripts/audit-api-auth.ts docs/auth-matrix.md` (nel diff: la riga `PATCH /api/topology/nodes/role` · admin, la data della matrice e i contatori che crescono di uno — file `route.ts`, gestori, guardie `admin`, esiti ok: il 14/10 erano 311, 481, 275 e 448 —; nient'altro; senza `AUDIT_STAMP` la riga della data dice «esegui con AUDIT_STAMP…»), `npx tsc --noEmit`, `npx eslint src/lib/topology src/components/topology src/app/api/topology` con `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/db-tenant.ts src/lib/topology/api-input.ts src/app/api/topology/nodes/role/route.ts src/lib/topology/model-types.ts src/lib/topology/node-index.ts src/lib/topology/map-menus.ts src/components/topology/map/node-context-menu.tsx src/components/topology/map/topology-map-client.tsx docs/auth-matrix.md src/lib/__tests__/topology-maps-db.test.ts src/lib/topology/__tests__/api-input.test.ts src/lib/topology/__tests__/map-menus.test.ts src/lib/topology/__tests__/node-index.test.ts
git commit -m "feat(topologia): «Ruolo nella mappa» per gli apparati, solo admin (spec §13.8.2)"
```

---

### Task 15: «Perché questo collegamento» in forma corta (T1b.3)

Spec §13.4.6 (le frasi; «in T1b la frase corta, fatta con le fonti di oggi, col motivo delle righe scartate sulla coppia»), §13.15 punto 6, §13.12.4 («le frasi: una per fonte di oggi, e il motivo delle righe scartate»). Sonnet (tocca il modello dei collegamenti, ma il codice è qui per intero; la revisione finale di T1b è su Opus). Dopo l'unione dei Task 13 e 14. Dal passaggio universale (I58, H7; spec §13.4.6, «Nome scelto (riga scartata, da T1b)»): la riga di un router su un nome scelto, che da T1 non prova un cavo (Task 7, `portaDelRouter`), lascia il suo motivo sulla coppia con la frase della spec alla lettera; più nomi scelti fra gli stessi due oggetti fanno **una frase sola** (spec §13.4.6; revisione finale del 15/10, verifica UV2: sulla copia dell'hub la linea fra il router e il router di frontiera aveva 13 frasi, 10 quasi uguali, una per VLAN; con la frase unita ne ha 4); le prove usano anche la famiglia 1 delle reti-campione (Task 10c), dove la testa sente il secondo router su due VLAN. La fiducia («certo», «probabile»), «Perché è il principale» e «Candidati per porta» sono di T3: qui no. Le frasi sono quelle della spec alla lettera dove la spec le scrive; per tabella MAC, ripiego del router e VM la spec dà solo la fiducia («dedotto: ‹MAC o VM› visto sulla porta ‹porta›»), e le frasi qui sotto ne sono la forma lunga: la bozza di P8 le fa vedere a Riccardo insieme ai numeri del rilascio di T1b.

**Files:**
- Create: `src/lib/topology/cavi/frasi.ts` (logica pura; nessun nome di prodotto: prova I37)
- Modify: `src/lib/topology/model-types.ts` (`PassoPerche`, `MapLink.perche?`)
- Modify: `src/lib/topology/links.ts` (un passo per candidato; le righe scartate col motivo; `RisultatoCollegamenti.scartate`)
- Modify: `src/lib/topology/attach.ts` (il passo della tabella MAC e del ripiego del router), `src/lib/topology/vm-ports.ts` (il passo «dalle VM»)
- Modify: `src/lib/topology/model.ts` (le righe scartate in fondo ai passi della linea della coppia)
- Modify: `src/lib/topology/edge-look.ts` (`dettoInFrase`)
- Modify: `src/components/topology/map/linked-panel.tsx` (sotto ogni collegamento di «Collegato a», «Perché questo collegamento» chiuso, da aprire)
- Test: `src/lib/topology/__tests__/frasi.test.ts`

**Interfaces:**
- Consumes: `Candidato`, `Gruppo`, `sulSegmento`, `logica`, `portaDelRouter`, `apparato`, `lineaDellaCoppia` (Task 7), `soloMikrotik` (Task 10c), `ignorato` (Task 9), `SOURCE_WORDS` con «annuncio di rete (MNDP o CDP)» (Task 2), `LinkOverrideRow.created_by/created_at` (Task 5).
- Produces:

```ts
// model-types.ts
export type PassoPerche =
  | { tipo: "a_mano"; utente: string | null; quando: string | null }
  | { tipo: "vicino"; da: string; porta: string; altro: string; portaRemota: string; fonte: LinkSource; visto: string | null; altreRighe: number }
  | { tipo: "uplink"; figlio: string; porta: string; padre: string; dallaRiga: boolean; stessaOsservazione: boolean }
  | { tipo: "tabella_mac"; da: string; porta: string; altro: string; visto: string | null; router: boolean }
  | { tipo: "vm"; da: string; porta: string; hypervisor: string; vm: number; visto: string | null }
  | { tipo: "scartata"; motivo: "segmento"; da: string; porta: string; sentiti: Array<{ nodo: string | null; nome: string }> }
  | { tipo: "scartata"; motivo: "stessa_rete"; da: string; porta: string; altro: string; fonte: LinkSource }
  /** Spec §13.4.6, «Nome scelto»: la riga di un router su un nome che il traduttore del suo prodotto non riconosce (I58). */
  | { tipo: "scartata"; motivo: "nome_scelto"; da: string; porta: string; altro: string };
// MapLink += perche?: PassoPerche[]
// links.ts: RisultatoCollegamenti += scartate: ReadonlyMap<string, readonly PassoPerche[]>   (chiave: pairKey)
// cavi/frasi.ts
export interface ParoleFrasi { nome: (id: string) => string; detto: (fonte: LinkSource) => string; ora: (quando: string) => string; giorno: (quando: string) => string }
export function frasiPerche(l: Pick<MapLink, "perche" | "manual">, p: ParoleFrasi): string[];
// edge-look.ts
export function dettoInFrase(f: LinkSource): string;
```

- [ ] **Step 1: le prove che falliscono** — `src/lib/topology/__tests__/frasi.test.ts`:

```ts
// Spec topologia §13.4.6 e §13.15 punto 6: «Perché questo collegamento» in forma corta, una frase per fonte di oggi e il
// motivo delle righe scartate sulla coppia. Il 14/10 «perché quella porta e non il 10G?» aveva la risposta solo nel codice.
// Dati inventati con la forma vera.
import { test } from "node:test";
import assert from "node:assert/strict";
import { frasiPerche, type ParoleFrasi } from "@/lib/topology/cavi/frasi";
import { dettoInFrase } from "@/lib/topology/edge-look";
import { buildTopologyModel } from "@/lib/topology/model";
import type { ModelNeighborRow, ModelVmRow, PassoPerche, TopologyModel, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev, host } from "./support/righe";
import { soloMikrotik } from "./support/reti-campione";

const ORA = "2026-10-13 11:00:00", ORA_C = "2026-10-13 03:00:00";
const NOMI: Readonly<Record<string, string>> = { "dev:1": "RTR-1", "dev:2": "SW-2", "dev:9": "PVE-9" };
const P: ParoleFrasi = { nome: (id) => NOMI[id] ?? id, detto: dettoInFrase, ora: (s) => s.slice(11, 16), giorno: (s) => s.slice(0, 10) };
const frasi = (perche: PassoPerche[], confermato = false) => frasiPerche({ perche, manual: confermato ? { confirmed: true } : null }, P);

test("LLDP, righe dello stesso apparato, due capi", () => {
  assert.deepEqual(frasi([
    { tipo: "vicino", da: "dev:1", porta: "ether3", altro: "dev:2", portaRemota: "Port 3", fonte: "lldp", visto: ORA, altreRighe: 2 },
    { tipo: "vicino", da: "dev:2", porta: "Port 3", altro: "dev:1", portaRemota: "ether3", fonte: "lldp", visto: ORA, altreRighe: 0 },
  ]), [
    "RTR-1 vede SW-2 via LLDP sulla porta ether3 (porta remota Port 3), letto alle 11:00, e altre 2 righe di SW-2 dalle sue VLAN o VRRP: contate una volta sola.",
    "SW-2 vede RTR-1 sulla porta Port 3: il cavo è confermato dai due capi.",
  ]);
});

test("un annuncio di rete come sola prova: la parola del lettore; la porta remota non nota si dice", () => {
  assert.deepEqual(frasi([{ tipo: "vicino", da: "dev:1", porta: "ether3", altro: "dev:2", portaRemota: "", fonte: "mndp", visto: null, altreRighe: 0 }]),
    ["RTR-1 vede SW-2 via un annuncio di rete (MNDP o CDP) sulla porta ether3 (porta remota non nota)."]);
});

test("uplink del controller: la stessa osservazione dell'LLDP, e la porta del padre dalla stessa prova", () => {
  assert.deepEqual(frasi([{ tipo: "uplink", figlio: "dev:2", porta: "Port 10", padre: "dev:1", dallaRiga: true, stessaOsservazione: true }]), [
    "Il controller dice che SW-2 esce dalla porta Port 10 verso RTR-1; lo calcola dall'LLDP di SW-2: è la stessa osservazione, non una seconda prova.",
    "La porta di RTR-1 viene dalla stessa prova LLDP sulla porta Port 10.",
  ]);
  assert.deepEqual(frasi([{ tipo: "uplink", figlio: "dev:2", porta: "", padre: "dev:1", dallaRiga: false, stessaOsservazione: false }]),
    ["Il controller dice che SW-2 esce verso RTR-1."]);
});

test("a mano, tabella MAC, ripiego del router, VM", () => {
  assert.deepEqual(frasi([{ tipo: "a_mano", utente: "admin", quando: "2026-10-14 08:07:00" }], true), ["Collegato a mano da admin il 2026-10-14; confermato dai dati."]);
  assert.deepEqual(frasi([{ tipo: "a_mano", utente: null, quando: null }]), ["Collegato a mano; non visto dai dati."]);
  assert.deepEqual(frasi([
    { tipo: "tabella_mac", da: "dev:2", porta: "Port 8", altro: "dev:9", visto: ORA, router: false },
    { tipo: "tabella_mac", da: "dev:1", porta: "ether7", altro: "dev:9", visto: ORA, router: true },
    { tipo: "vm", da: "dev:2", porta: "Port 5", hypervisor: "dev:9", vm: 3, visto: ORA },
    { tipo: "vm", da: "dev:2", porta: "Port 6", hypervisor: "dev:9", vm: 1, visto: null },
  ]), [
    "Dedotto: il MAC di PVE-9 è visto sulla porta Port 8 di SW-2 (tabella MAC, letta alle 11:00).",
    "Dedotto: il MAC di PVE-9 è visto sulla porta ether7 del router RTR-1 (tabella MAC, letta alle 11:00): nessuno switch lo vede su una porta di bordo.",
    "Dedotto: 3 VM accese di PVE-9 sono viste sulla porta Port 5 di SW-2 (tabella MAC, letta alle 11:00).",
    "Dedotto: 1 VM accesa di PVE-9 è vista sulla porta Port 6 di SW-2 (tabella MAC).",
  ]);
});

test("§13.15 punto 6 — il motivo delle righe scartate: segmento e stessa rete", () => {
  assert.deepEqual(frasi([
    { tipo: "scartata", motivo: "segmento", da: "dev:1", porta: "ether8", sentiti: [{ nodo: "dev:2", nome: "SW-2" }, { nodo: null, nome: "modem-fibra" }] },
    { tipo: "scartata", motivo: "stessa_rete", da: "dev:1", porta: "vlan10-uffici", altro: "dev:2", fonte: "mndp" },
  ]), [
    "Sulla porta ether8 RTR-1 sente 2 apparati (SW-2, modem-fibra): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).",
    "RTR-1 sente SW-2 con un annuncio di rete (MNDP o CDP) sulla porta vlan10-uffici: sono nella stessa rete, ma questo non prova un cavo.",
  ]);
});

test("l'ordine è fisso — a mano, vicini, uplink, dedotti, scartate — e non quello in cui arrivano le prove", () => {
  const f = frasi([
    { tipo: "scartata", motivo: "stessa_rete", da: "dev:1", porta: "bridge", altro: "dev:2", fonte: "lldp" },
    { tipo: "uplink", figlio: "dev:2", porta: "Port 1", padre: "dev:1", dallaRiga: false, stessaOsservazione: false },
    { tipo: "vicino", da: "dev:2", porta: "Port 1", altro: "dev:1", portaRemota: "ether2", fonte: "lldp", visto: ORA, altreRighe: 0 },
  ]);
  assert.deepEqual(f.map((x) => x.split(" ")[0]), ["SW-2", "Il", "RTR-1"]);
});

// ─── Sul modello: la sede 1 del cliente A in piccolo (forma vera; nomi e MAC inventati) ───
// Router 1 sente core 1 e il router di riserva sulla stessa porta (il segmento della WAN); core 1 sente i due router sulla
// sua porta 15 e sale al router con l'uplink del controller, che non sa la porta del router.
const RTR = "02:00:00:00:00:01", CORE = "02:00:00:00:01:14", RIS = "02:00:00:00:00:07";
const riga = (device_id: number, local_port: string, remote_device_name: string, remote_port: string, remote_mac: string, extra: Partial<ModelNeighborRow> = {}): ModelNeighborRow =>
  ({ device_id, local_port, remote_device_name, remote_port, protocol: "lldp", remote_ip: null, remote_mac, timestamp: ORA, source: "device", ...extra });
const porta = (device_id: number, port_index: number, port_name: string) => ({ device_id, port_index, port_name, speed: null, status: "up", stp_state: null });

function sedeInPiccolo(): TopologyModelInput {
  const c = { source: "unifi", timestamp: ORA_C };
  return baseInput({
    devices: [
      dev(1, { name: "RTR-1", device_type: "router", vendor: "mikrotik", via: "ssh" }),
      dev(114, { name: "CORE-1", controller_mac: CORE, uplink_mac: RTR, uplink_seen_at: ORA_C, via: "api" }),
    ],
    hosts: [host(7, { ip: "10.0.9.2", mac: RIS, hostname: "RTR-RISERVA", classification: "router" })],
    knownMacs: [{ device_id: 1, mac: RTR }],
    uplinkPorts: [{ device_id: 114, port_index: 10, port_name: "Uplink verso il router" }],
    ports: [porta(1, 8, "ether8"), porta(1, 9, "sfp-sfpplus1"), porta(1, 10, "bridge"), porta(114, 10, "Uplink verso il router"), porta(114, 15, "Port 15 - WAN")],
    neighbors: [
      riga(1, "sfp-sfpplus1,bridge", "CORE-1", "Uplink verso il router", CORE),
      riga(1, "ether8", "CORE-1", "Port 15 - WAN", CORE),
      riga(1, "ether8", "RTR-RISERVA", "bridge/ether8", RIS, { remote_platform: "MikroTik" }),
      riga(114, "Uplink verso il router", "RTR-1", "sfp-sfpplus1", RTR, c),
      riga(114, "Port 15 - WAN", "RTR-1", "ether8", RTR, c),
      riga(114, "Port 15 - WAN", "RTR-RISERVA", "ether8", RIS, c),
    ],
  });
}
const paroleDi = (m: TopologyModel): ParoleFrasi => ({ ...P, nome: (id) => m.nodes.find((n) => n.id === id)?.name ?? id });

test("la linea router 1 – core 1: i due capi, l'uplink, e perché ether8 e la porta 15 non sono un cavo", () => {
  const m = buildTopologyModel(sedeInPiccolo());
  const l = m.links.find((x) => x.id === "link:dev:1|dev:114")!;
  assert.deepEqual(frasiPerche(l, paroleDi(m)), [
    "RTR-1 vede CORE-1 via LLDP sulla porta sfp-sfpplus1 (porta remota Uplink verso il router), letto alle 11:00.",
    "CORE-1 vede RTR-1 sulla porta Uplink verso il router: il cavo è confermato dai due capi.",
    "Il controller dice che CORE-1 esce dalla porta Uplink verso il router verso RTR-1; lo calcola dall'LLDP di CORE-1: è la stessa osservazione, non una seconda prova.",
    "La porta di RTR-1 viene dalla stessa prova LLDP sulla porta Uplink verso il router.",
    "Sulla porta ether8 RTR-1 sente 2 apparati (CORE-1, RTR-RISERVA): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).",
    "Sulla porta Port 15 - WAN CORE-1 sente 2 apparati (RTR-1, RTR-RISERVA): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).",
  ]);
});

test("la tabella MAC e le VM lasciano la loro frase sulla linea che creano", () => {
  const SRV = "02:00:00:00:06:01";
  const vm = (vmid: number, mac: string): ModelVmRow => ({
    scannedDeviceId: 5, vmid, name: `vm-${vmid}`, node: "px-h", status: "running", type: "qemu", macs: [mac], ips: [], scannedAt: "2026-10-13T06:00:00.000Z",
  });
  const vms = [vm(501, "02:00:00:aa:00:01"), vm(502, "02:00:00:aa:00:02")];
  const m = buildTopologyModel(baseInput({
    devices: [
      dev(2, { name: "SW-2", controller_mac: "02:00:00:00:02:02" }),
      dev(5, { name: "px-h", device_type: "server", vendor: "proxmox", host: "192.0.2.15", port_count: 0 }),
      dev(6, { name: "SRV-6", device_type: "server", host: "192.0.2.16", port_count: 0 }),
    ],
    knownMacs: [{ device_id: 6, mac: SRV }],
    scanHosts: [{ scannedDeviceId: 5, hostname: "px-h", ips: ["192.0.2.15"], macs: [] }],
    vms,
    macPorts: [
      ...vms.map((v) => ({ device_id: 2, mac: v.macs[0], port_name: "Port 1", timestamp: ORA, source: "device" })),
      { device_id: 2, mac: SRV, port_name: "Port 8", timestamp: ORA, source: "device" },
    ],
  }));
  const di = (id: string) => frasiPerche(m.links.find((l) => l.a === id || l.b === id)!, paroleDi(m));
  assert.deepEqual(di("dev:6"), ["Dedotto: il MAC di SRV-6 è visto sulla porta Port 8 di SW-2 (tabella MAC, letta alle 11:00)."]);
  assert.deepEqual(di("dev:5"), ["Dedotto: 2 VM accese di px-h sono viste sulla porta Port 1 di SW-2 (tabella MAC, letta alle 11:00)."]);
});

// Spec §13.4.6, «Nome scelto (riga scartata, da T1b)»; I58, H7. Rete B: la linea fra il router e il router di frontiera passava
// da una VLAN dal nome scelto. Da T1 la riga non prova un cavo; da T1b la frase lo dice.
test("I58 — la riga del router su un nome scelto è scartata col suo motivo, alla lettera della spec", () => {
  assert.deepEqual(frasi([{ tipo: "scartata", motivo: "nome_scelto", da: "dev:1", porta: "VL_16_QWE", altro: "dev:2" }]), [
    "RTR-1 sente SW-2 su VL_16_QWE, un nome scelto a mano: non si sa se è una porta fisica, e una riga del router su di lei non prova un cavo.",
  ]);
});

// Verifica del 15/10: sull'hub il router sente il router di frontiera su dieci VLAN dai nomi scelti, e la linea aveva dieci
// frasi quasi uguali. I nomi scelti fra gli stessi due oggetti fanno una frase sola; un'altra coppia ha la sua.
test("I58 — più nomi scelti fra gli stessi due oggetti: una frase sola, con le prime due interfacce e quante altre", () => {
  const s = (porta: string, altro = "dev:2"): PassoPerche => ({ tipo: "scartata", motivo: "nome_scelto", da: "dev:1", porta, altro });
  assert.deepEqual(frasi([s("VL_16_QWE"), s("VL_20_ABC"), s("VL_7_XYZ"), s("VL_9_K"), s("VL_3_W", "dev:9")]), [
    "RTR-1 sente SW-2 su VL_16_QWE, VL_20_ABC e altre 2 interfacce, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.",
    "RTR-1 sente PVE-9 su VL_3_W, un nome scelto a mano: non si sa se è una porta fisica, e una riga del router su di lei non prova un cavo.",
  ]);
  assert.deepEqual(frasi([s("VL_16_QWE"), s("VL_20_ABC")]), [
    "RTR-1 sente SW-2 su VL_16_QWE e VL_20_ABC, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.",
  ]);
  assert.equal(frasi([s("A_1"), s("B_2"), s("C_3")])[0].includes("e un'altra interfaccia,"), true);
});

test("I58 — rete-campione della famiglia 1: la linea fra la testa e il secondo router dice in una frase sola perché le due VLAN dai nomi scelti non contano", () => {
  const m = buildTopologyModel(soloMikrotik());
  const l = m.links.find((x) => x.id === "link:dev:1|dev:3")!;
  assert.deepEqual(frasiPerche(l, paroleDi(m)).filter((f) => f.includes("scelt")), [
    "RTR-TESTA sente RTR-FRONTIERA su VL_16_QWE e VL_20_ABC, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.",
  ]);
});
```

- [ ] **Step 2: vederle fallire**

Run: `node --import tsx --test src/lib/topology/__tests__/frasi.test.ts > "$SCRATCH/t1b-15.log" 2>&1; echo "exit=$?"`
Expected: `exit=1`, «Cannot find module '@/lib/topology/cavi/frasi'».

- [ ] **Step 3: il codice**

`model-types.ts`, prima di `MapLink`:

```ts
/**
 * Un passo di «Perché questo collegamento» (T1b; spec §13.4.6 in forma corta, §13.15 punto 6): un fatto sulla coppia, con
 * gli id degli oggetti e i nomi delle porte come li dice la prova. La frase la scrive `cavi/frasi.ts`.
 */
export type PassoPerche =
  | { tipo: "a_mano"; utente: string | null; quando: string | null }
  | { tipo: "vicino"; da: string; porta: string; altro: string; portaRemota: string; fonte: LinkSource; visto: string | null; altreRighe: number }
  | { tipo: "uplink"; figlio: string; porta: string; padre: string; dallaRiga: boolean; stessaOsservazione: boolean }
  | { tipo: "tabella_mac"; da: string; porta: string; altro: string; visto: string | null; router: boolean }
  | { tipo: "vm"; da: string; porta: string; hypervisor: string; vm: number; visto: string | null }
  | { tipo: "scartata"; motivo: "segmento"; da: string; porta: string; sentiti: Array<{ nodo: string | null; nome: string }> }
  | { tipo: "scartata"; motivo: "stessa_rete"; da: string; porta: string; altro: string; fonte: LinkSource }
  /** Spec §13.4.6, «Nome scelto»: la riga di un router su un nome che il traduttore del suo prodotto non riconosce (I58). */
  | { tipo: "scartata"; motivo: "nome_scelto"; da: string; porta: string; altro: string };
```

e in `MapLink`, dopo `altriCavi`:

```ts
  /** «Perché questo collegamento» (T1b): le prove del cavo della linea, poi le righe scartate sulla coppia. Assente nelle linee fatte a mano dalle prove. */
  perche?: PassoPerche[];
```

`src/lib/topology/cavi/frasi.ts`:

```ts
/**
 * «Perché questo collegamento» in forma corta (T1b; spec topologia §13.4.6 e §13.15 punto 6): una frase per prova, con le
 * fonti di oggi, e il motivo delle righe scartate sulla coppia. Il 14/10 la domanda «perché quella porta e non il 10G?»
 * aveva la risposta solo nel codice. Logica pura, senza nomi di prodotto (prova I37): i nomi degli oggetti, le parole dei
 * protocolli e l'ora italiana li dà chi chiama.
 */
import type { LinkSource, MapLink, PassoPerche } from "@/lib/topology/model-types";

export interface ParoleFrasi {
  /** Il nome a schermo di un oggetto. */
  nome: (id: string) => string;
  /** Il protocollo dentro la frase («LLDP», «CDP», «un annuncio di rete (…)»): `dettoInFrase` di edge-look.ts. */
  detto: (fonte: LinkSource) => string;
  /** L'ora italiana di una lettura (il DB è in UTC), col giorno se non è oggi. */
  ora: (quando: string) => string;
  /** Il giorno italiano di una data del DB. */
  giorno: (quando: string) => string;
}

/** L'ordine delle frasi: chi l'ha detto a mano, chi l'ha visto, chi l'ha calcolato, chi l'ha dedotto, e infine lo scartato. */
const ORDINE: Readonly<Record<PassoPerche["tipo"], number>> = { a_mano: 0, vicino: 1, uplink: 2, tabella_mac: 3, vm: 4, scartata: 5 };
/** Un annuncio che non attraversa un apparato gestito: vale come cavo dai due capi. */
const daCavo = (f: LinkSource): boolean => f === "lldp" || f === "cdp";

export function frasiPerche(l: Pick<MapLink, "perche" | "manual">, p: ParoleFrasi): string[] {
  const N = p.nome;
  const alle = (quando: string | null, parola: string): string => (quando ? `, ${parola} alle ${p.ora(quando)}` : "");
  const out: string[] = [];
  const conCavo = new Set<string>(); // chi ha già la frase del cavo: l'altro capo la conferma
  // I nomi scelti fra gli stessi due oggetti fanno una frase sola (verifica del 15/10: sull'hub il router sente il router di
  // frontiera su dieci VLAN dai nomi scelti, e dieci frasi quasi uguali coprivano le altre).
  const scelti = new Map<string, string[]>();
  for (const x of l.perche ?? []) if (x.tipo === "scartata" && x.motivo === "nome_scelto") scelti.set(`${x.da}|${x.altro}`, [...(scelti.get(`${x.da}|${x.altro}`) ?? []), x.porta]);
  for (const x of [...(l.perche ?? [])].sort((u, v) => ORDINE[u.tipo] - ORDINE[v.tipo])) {
    switch (x.tipo) {
      case "a_mano": {
        const chi = x.utente ? ` da ${x.utente}` : "";
        const quando = x.quando ? ` il ${p.giorno(x.quando)}` : "";
        out.push(`Collegato a mano${chi}${quando}; ${l.manual?.confirmed ? "confermato dai dati" : "non visto dai dati"}.`);
        break;
      }
      case "vicino": {
        if (daCavo(x.fonte) && conCavo.has(x.altro)) {
          out.push(`${N(x.da)} vede ${N(x.altro)} sulla porta ${x.porta}: il cavo è confermato dai due capi.`);
          break;
        }
        if (daCavo(x.fonte)) conCavo.add(x.da);
        const remota = x.portaRemota ? `porta remota ${x.portaRemota}` : "porta remota non nota";
        const altre = x.altreRighe === 0 ? ""
          : `, e ${x.altreRighe === 1 ? "un'altra riga" : `altre ${x.altreRighe} righe`} di ${N(x.altro)} dalle sue VLAN o VRRP: contate una volta sola`;
        out.push(`${N(x.da)} vede ${N(x.altro)} via ${p.detto(x.fonte)} sulla porta ${x.porta} (${remota})${alle(x.visto, "letto")}${altre}.`);
        break;
      }
      case "uplink": {
        const porta = x.porta ? ` dalla porta ${x.porta}` : "";
        const stessa = x.stessaOsservazione ? `; lo calcola dall'LLDP di ${N(x.figlio)}: è la stessa osservazione, non una seconda prova` : "";
        out.push(`Il controller dice che ${N(x.figlio)} esce${porta} verso ${N(x.padre)}${stessa}.`);
        if (x.dallaRiga) out.push(`La porta di ${N(x.padre)} viene dalla stessa prova LLDP sulla porta ${x.porta}.`);
        break;
      }
      case "tabella_mac":
        out.push(x.router
          ? `Dedotto: il MAC di ${N(x.altro)} è visto sulla porta ${x.porta} del router ${N(x.da)} (tabella MAC${alle(x.visto, "letta")}): nessuno switch lo vede su una porta di bordo.`
          : `Dedotto: il MAC di ${N(x.altro)} è visto sulla porta ${x.porta} di ${N(x.da)} (tabella MAC${alle(x.visto, "letta")}).`);
        break;
      case "vm": {
        const una = x.vm === 1;
        out.push(`Dedotto: ${x.vm} ${una ? "VM accesa" : "VM accese"} di ${N(x.hypervisor)} ${una ? "è vista" : "sono viste"} sulla porta ${x.porta} di ${N(x.da)} (tabella MAC${alle(x.visto, "letta")}).`);
        break;
      }
      case "scartata":
        if (x.motivo === "segmento") out.push(`Sulla porta ${x.porta} ${N(x.da)} sente ${x.sentiti.length} apparati (${x.sentiti.map((s) => (s.nodo ? N(s.nodo) : s.nome)).join(", ")}): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).`);
        else if (x.motivo === "nome_scelto") {
          const porte = scelti.get(`${x.da}|${x.altro}`) ?? [x.porta];
          if (porte[0] !== x.porta) break; // la frase l'ha già scritta la prima porta della coppia
          if (porte.length === 1) out.push(`${N(x.da)} sente ${N(x.altro)} su ${x.porta}, un nome scelto a mano: non si sa se è una porta fisica, e una riga del router su di lei non prova un cavo.`);
          else {
            const su = porte.length === 2 ? `${porte[0]} e ${porte[1]}` : `${porte[0]}, ${porte[1]} e ${porte.length === 3 ? "un'altra interfaccia" : `altre ${porte.length - 2} interfacce`}`;
            out.push(`${N(x.da)} sente ${N(x.altro)} su ${su}, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.`);
          }
        }
        else out.push(`${N(x.da)} sente ${N(x.altro)} con ${p.detto(x.fonte)} sulla porta ${x.porta}: sono nella stessa rete, ma questo non prova un cavo.`);
        break;
    }
  }
  return out;
}
```

`edge-look.ts`, dopo `SOURCE_WORDS`:

```ts
/** Il protocollo dentro una frase di «Perché questo collegamento» (spec §13.4.6): «LLDP», «CDP», «un annuncio di rete (MNDP o CDP)». */
export function dettoInFrase(f: LinkSource): string {
  return f === "mndp" ? `un ${SOURCE_WORDS.mndp}` : SOURCE_WORDS[f];
}
```

`links.ts` (sul codice dei Task 7 e 9):

1. import di `type PassoPerche` da `model-types`; `Candidato` riceve `passo: PassoPerche;` (ogni candidato ha la sua prova); `RisultatoCollegamenti` riceve

```ts
  /** Le righe scartate (T1b, §13.4.6): «coppia» → il motivo, per la frase in fondo alla linea di quella coppia. */
  scartate: ReadonlyMap<string, readonly PassoPerche[]>;
```

2. la correzione «aggiungi»: `passo: { tipo: "a_mano", utente: o.created_by ?? null, quando: o.created_at ?? null }`;
3. nel passo 2, accanto a `sentiti`, i nomi di chi si sente (per la frase del segmento):

```ts
  const sentitiNomi = new Map<string, Map<string, { nodo: string | null; nome: string }>>();
  // … nel ciclo, dopo aggiungiIn(sentiti, …, apparato(g)):
    const chi = apparato(g);
    const nomi = sentitiNomi.get(`${g.osservatore}|${g.locale.chiave}`) ?? new Map<string, { nodo: string | null; nome: string }>();
    if (!nomi.has(chi)) nomi.set(chi, { nodo: chi.startsWith("nodo:") ? chi.slice(5) : null, nome: g.righe[0].remote_device_name });
    sentitiNomi.set(`${g.osservatore}|${g.locale.chiave}`, nomi);
  // … e dopo il ciclo:
  const sentitiSu = (g: Gruppo): Array<{ nodo: string | null; nome: string }> =>
    [...(sentitiNomi.get(`${g.osservatore}|${g.locale.chiave}`)?.values() ?? [])].sort((x, y) => cmp(x.nome, y.nome));
```

4. nel passo 3a, la riga del figlio si cerca una volta sola e dice anche se l'uplink è la stessa osservazione:

```ts
    const k = aPorta?.chiave ?? null;
    const riga = k === null ? undefined
      : (gruppiDi.get(a) ?? []).find((g) => g.b === b && g.collegamento && g.locale.chiave === k && !sulSegmento(g));
    let bPorta: Porta | null = null;
    if (d.uplink_remote_port != null) {
      // … come prima …
    } else bPorta = riga?.remota ?? null;
    candidati.push({
      a, aPorta, b, bPorta, source: "unifi_uplink", lastSeen: d.uplink_seen_at, uplinkFrom: a, senzaFili: false,
      passo: { tipo: "uplink", figlio: a, porta: aPorta?.nome ?? "", padre: b, dallaRiga: d.uplink_remote_port == null && bPorta !== null, stessaOsservazione: riga?.source === "lldp" },
    });
```

5. il ciclo dei candidati dai vicini (passo 3c) tiene il motivo di ciò che scarta:

```ts
  // T1b (§13.4.6, §13.15 punto 6): ogni riga scartata lascia il suo motivo sulla coppia; model.ts lo mette in fondo alla linea.
  const scartate = new Map<string, PassoPerche[]>();
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b || b === g.osservatore) continue;
    const stessaRete: PassoPerche = { tipo: "scartata", motivo: "stessa_rete", da: g.osservatore, porta: g.locale.nome, altro: b, fonte: g.source };
    if (sulSegmento(g)) { // passo 2 (I7)
      aggiungiA(scartate, pairKey(g.osservatore, b), { tipo: "scartata", motivo: "segmento", da: g.osservatore, porta: g.locale.nome, sentiti: sentitiSu(g) });
      continue;
    }
    if (logica(g.locale)) { // passo 1 (I5)
      aggiungiA(scartate, pairKey(g.osservatore, b), stessaRete);
      continue;
    }
    if (isRouterNode(idx, g.osservatore)) {
      if (g.locale.nome === "") continue;
      if (!portaDelRouter(g)) { // passo 1 per i router col traduttore del loro prodotto (I58, H7): un nome scelto
        aggiungiA(scartate, pairKey(g.osservatore, b), { tipo: "scartata", motivo: "nome_scelto", da: g.osservatore, porta: g.locale.nome, altro: b });
        continue;
      }
      const diretto = (nodiSu.get(chiaveSu(g))?.size ?? 0) === 1;
      const confermato = g.locale.chiave !== null && conferme.has(`${g.osservatore}|${g.locale.chiave}|${b}`);
      if (!confermato && (!diretto || g.locale.senzaFili === true)) {
        aggiungiA(scartate, pairKey(g.osservatore, b), stessaRete);
        continue;
      }
    }
    candidati.push({
      a: g.osservatore, aPorta: g.locale.nome ? g.locale : null, b, bPorta: g.remota, source: g.source, lastSeen: g.lastSeen,
      uplinkFrom: null, senzaFili: g.locale.senzaFili === true || g.remota?.senzaFili === true,
      passo: { tipo: "vicino", da: g.osservatore, porta: g.locale.nome, altro: b, portaRemota: g.remota?.nome ?? "", fonte: g.source, visto: g.lastSeen, altreRighe: g.righe.length - 1 },
    });
  }
```

6. `lineaDellaCoppia`: nel ritorno `perche: stessi.map((c) => c.passo),` (le prove del cavo scelto: gli altri cavi hanno le loro in «Altri cavi visti»); il ritorno di `buildLinks` diventa `return { links, unmatched, ignorati, segmenti, scartate };`.

`attach.ts`: la linea «tabella MAC» del ciclo principale riceve `perche: [{ tipo: "tabella_mac", da: best.node, porta: best.port, altro: other.id, visto: best.ts, router: false }],`; quella di `ripiegoRouter` `perche: [{ tipo: "tabella_mac", da: c.node, porta: c.port, altro: node, visto: c.ts, router: true }],`.

`vm-ports.ts`: la linea nuova riceve `perche: [{ tipo: "vm", da: s.node, porta: s.port, hypervisor: h, vm: s.vms.size, visto: s.ts }],`; nel ramo che fonde in una linea che c'è già, dopo il `continue` degli altri cavi (Task 9): `l.perche = [...(l.perche ?? []), { tipo: "vm", da: s.node, porta: s.port, hypervisor: h, vm: s.vms.size, visto: s.ts }];`.

`model.ts`: `const { links: baseLinks, unmatched, ignorati, segmenti, scartate } = buildLinks(input, idx, runningVmMacs, regole);` (import di `pairKey` da `links`) e, subito dopo l'ordinamento di `links`:

```ts
  // T1b (§13.4.6): il motivo delle righe scartate sulla coppia, in fondo ai passi della sua linea (anche di una linea della
  // tabella MAC o delle VM: la coppia è la stessa).
  for (const l of links) {
    const s = scartate.get(pairKey(l.a, l.b));
    if (s) l.perche = [...(l.perche ?? []), ...s];
  }
```

`linked-panel.tsx`: import di `frasiPerche`, `type ParoleFrasi` da `@/lib/topology/cavi/frasi` e di `dettoInFrase` da `edge-look`; l'import da `@/lib/db-date` diventa `import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";`; accanto a `quando`:

```tsx
/**
 * L'ora italiana di una lettura, col giorno se non è oggi. Il DB è in UTC e il fuso è quello degli utenti (FUSO_UTENTI),
 * non quello del browser: le frasi promettono l'ora italiana (spec §13.4.6), come le altre date della topologia
 * (`device-location-field.tsx:92`, `site-topology-dialog.tsx:112`). Anche «oggi» si decide nello stesso fuso.
 */
function oraBreve(s: string): string {
  const d = parseDbDate(s);
  if (Number.isNaN(d.getTime())) return s;
  const fuso = { timeZone: FUSO_UTENTI } as const;
  const ora = d.toLocaleTimeString("it-IT", { ...fuso, hour: "2-digit", minute: "2-digit" });
  const giornoDi = (x: Date) => x.toLocaleDateString("it-IT", fuso);
  return giornoDi(d) === giornoDi(new Date()) ? ora : `${ora} del ${d.toLocaleDateString("it-IT", { ...fuso, day: "2-digit", month: "2-digit" })}`;
}
function giorno(s: string): string {
  const d = parseDbDate(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI });
}
```

in `Detail`, `const parole: ParoleFrasi = { nome: (id) => byId.get(id)?.name ?? id, detto: dettoInFrase, ora: oraBreve, giorno };`; nel corpo della tabella di «Collegato a» ogni collegamento diventa un `Fragment` (già importato) con la riga di oggi e, sotto, una riga intera (chiusa: si apre al clic, niente spazio preso a chi non la chiede):

```tsx
            {links.slice(0, MAX).map((l) => {
              const o = byId.get(other(l));
              const vmWords = vmPortWords(l, (id) => byId.get(id)?.name ?? id);
              const perche = frasiPerche(l, parole);
              return (
                <Fragment key={l.id}>
                  <tr className="border-t border-border align-top">
                    {/* … le quattro celle di oggi, invariate … */}
                  </tr>
                  {perche.length > 0 && (
                    <tr className="align-top">
                      <td colSpan={4} className="pb-1.5">
                        <details>
                          <summary className="cursor-pointer">Perché questo collegamento</summary>
                          <ul className="ml-4 list-disc">
                            {perche.map((f, k) => <li key={k}>{f}</li>)}
                          </ul>
                        </details>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
```

- [ ] **Step 4: verdi** — tutte le prove della topologia (I37 su `cavi/frasi.ts` compresa):

Run: `node --import tsx --test "src/lib/topology/__tests__/*.test.ts" > "$SCRATCH/t1b-15.log" 2>&1; echo "exit=$?"`
Expected: `exit=0`, senza toccare altre prove (le linee ricevono un campo in più; nessun numero cambia). `npx tsc --noEmit`, `npx eslint src/lib/topology src/components/topology` con `exit=0`.

- [ ] **Step 5: commit**

```bash
git add src/lib/topology/cavi/frasi.ts src/lib/topology/model-types.ts src/lib/topology/links.ts src/lib/topology/attach.ts src/lib/topology/vm-ports.ts src/lib/topology/model.ts src/lib/topology/edge-look.ts src/components/topology/map/linked-panel.tsx src/lib/topology/__tests__/frasi.test.ts
git commit -m "feat(topologia): «Perché questo collegamento» con le fonti di oggi e il motivo delle righe scartate (spec §13.4.6)"
```

---

### Task 16 (sessione principale): schermo, misura, revisione, cancello, conferma, rilascio di T1b

Come il Task 11 e il Task 12, sul ramo d'unione di T1b dopo l'ondata T1b-2 (e dopo il riallineamento a `origin/dev` di P5). Spec §13.11.2 («Misure: l'elenco per nome di chi esce, su tutte e due le copie, guardato con Riccardo prima del rilascio (solo in chat), con a parte chi resta solo per una prova aggiunta a D6; nessun altro padre cambiato. Conferme come T1»).

- [ ] **A schermo, una volta, a 1280 e 1920** (la ricetta del Task 11, sulla copia della copia di P6; immagini nello scratchpad, **la verifica non scrive**):
  - cliente A, «Tutto automatico»: gli oggetti senza prove non sono più nell'albero e stanno nel gruppo «Da sistemare» dell'elenco con «senza prove di ruolo» (il motivo intero al passaggio del mouse); nessun altro nodo spostato;
  - tasto destro su un apparato (admin): «Ruolo nella mappa ▸» con «Apparato di rete · Attaccato (server, PC) · Decide il sistema», quella di adesso con «✓»; su un host «da sistemare»: «Ruolo nella mappa: prima Promuovi ad apparato», spento (si apre il menu, non si sceglie);
  - clic sulla linea router 1 – core 1: nei dettagli, sotto la riga del collegamento, «Perché questo collegamento» chiuso; aperto, le frasi della bozza di P8 (i due capi, l'uplink come stessa osservazione, `ether8` e la porta 15 con «in mezzo c'è un apparato che non si legge»); testo ≥ 13 px, nessuna fascia sopra la mappa;
  - hub: i PC e lo scanner registrati come switch fuori dall'albero, in «Da sistemare» (H4); una mappa passo passo con uno di loro: resta, come foglia, con «da sistemare» sul riquadro (R2);
  - le regole del passaggio universale di T1b: sull'hub una radice sola, il router, e i cinque oggetti di rete senza collegamenti in «Da sistemare» con «nessun collegamento» (H14); il nodo «hypervisor» fatto di host fusi resta al suo posto, come attaccato (I65); sul cliente A la radio lontana a 60 GHz in «Da sistemare», «nessun collegamento» (C16);
  - ciò che si vede storto si corregge (commit `fix(topologia): quel che si è visto a schermo (T1b)`), senza rifare il giro.

- [ ] **Misura «dopo» sulle copie di P6** (prese dopo una lettura oraria del router 1 col lettore di T1), dal worktree del ramo d'unione:

```bash
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie-t1b/<A>.db" --cartella "$SCRATCH" --confronta "$SCRATCH/prima-t1b-A.json" --json > "$SCRATCH/dopo-t1b-A.out" 2>&1; echo "A exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie-t1b/<H>.db" --cartella "$SCRATCH" --confronta "$SCRATCH/prima-t1b-H.json" --json > "$SCRATCH/dopo-t1b-H.out" 2>&1; echo "H exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie-t1b/<A>.db" --cartella "$SCRATCH" --confronta "$SCRATCH/prima-t1b-A.json" --nomi > "$SCRATCH/dopo-t1b-A-nomi.txt" 2>&1; echo "nomi A exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie-t1b/<H>.db" --cartella "$SCRATCH" --confronta "$SCRATCH/prima-t1b-H.json" --nomi > "$SCRATCH/dopo-t1b-H-nomi.txt" 2>&1; echo "nomi H exit=$?"
npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<A>.db" --cartella "$SCRATCH" --json > "$SCRATCH/t1b-copie-p3-A.out" 2>&1; echo "P3 A exit=$?"
node --import tsx --test src/lib/topology/__tests__/reti-campione.test.ts > "$SCRATCH/righe-g-t1b.log" 2>&1; echo "righe G exit=$?"
```

Atteso (spec §13.8.2, «Misura di lavoro», e §13.11.2): `senza_prove` vicino a 9 sul cliente A e a 27 sull'hub (indicativi; sul dato del 14/10, prima della lettura del router col lettore nuovo, la verifica del piano ha misurato 3 e 21, con uscite solo di chi deve uscire, 2 e 14, e nessun altro padre cambiato: con le righe nuove del router la prova «si annuncia» è pulita, e i due switch veri dell'hub che col MNDP sporco l'avevano sola possono restare); `padri_cambiati` solo per oggetti che escono, **nessuno con figli**; nessun altro padre cambiato (C2 resta 0, `cucite` 0); accanto a ogni oggetto che esce, i client e gli attaccati che stavano sulle sue porte (la sua tabella MAC non conta più, §13.8.2: sul prototipo del Task 13 erano 5 collegamenti «tabella MAC» fra switch sulla fixture del cliente A); H4 (hub: PC e scanner registrati come switch, switch di laboratorio che esistono solo come host, un notebook, un telefono, in «Da sistemare») e H4b (host classificati router senza prove; sul cliente A i 2 di cui non si sa che cosa siano); `modello_ms` ≤ 20 (C17; sul Mac fino a 18 ms con T1b sul dato del 14/10, e 18,0 ms di mediana su 30 giri sulla copia del cliente A del 15/10 notte: il margine è stretto, sopra 17 ms lo si dice a Riccardo). Dal passaggio universale (spec §13.8.2, §13.16): `radici` 1 su tutte e due le copie (H14, C16; misurato il 15/10 notte con le righe nuove del router: cliente A 1, hub da 5 a 1), e su quelle copie `senza_prove` 3 e 22, uscite 2 e 14; `visti_solo_via_lldp` contato, con l'elenco per nome nella sola chat (15/10 notte: cliente A 0, hub 6, fra loro PC registrati come switch: la spec ne aspettava uno, lo switch di storage); le righe «G10 · … · T1b» delle reti-campione verdi e la riga del telefono «da fare» (todo), nel resoconto così come le stampa `node --test`; le misure H14 e C16 e I65 in `model-fixtures.test.ts` verdi. L'ultima riga: i conteggi principali della copia di P3 col codice di T1b sono quelli scritti in `MISURATI_DATO_VERO` dal Task 13 (la fixture viene da lì). **Ogni altro cambio ferma il rilascio** finché non è spiegato.

- [ ] **Una revisione finale** del ramo di T1b contro `origin/dev`, su **Opus** (`superpowers:requesting-code-review`), con la spec (§13.8.2, §13.4.6, §13.11.2) e questo piano; un giro di correzioni; nessuna ri-revisione completa.

- [ ] **Documenti, nel ramo d'unione e prima del cancello** (il commit di rilascio li porta con sé): `CHANGELOG.md` (voce di T1b col perché: vincolo 7, PC e server registrati come switch nell'albero; il ruolo a mano; le frasi; dal passaggio universale nessuna radice sola, «hypervisor» solo con una prova, lo spanning tree come prova solo se attivo); `CONTEXT.md` §6 (`topology_role` ora lo scrive la pagina; un oggetto «da sistemare» conta come client e la sua tabella MAC non conta; le prove aggiunte; i dati finti delle prove hanno la prova di ruolo che il dato vero ha; «core» e «accesso» letti come «rete»), aggiunte togliendo altrettanto, come nel Task 12 (il file sta sotto i 10.000 caratteri); l'ADR in `docs/adr/‹NNNN›-topologia-ruolo-dalle-prove.md`, col **primo numero libero su `origin/dev` al momento del commit**, riletto con `git fetch origin` subito prima (decisione: apparato di rete nella mappa solo con una prova sua, ruolo a mano come via d'uscita, nessuna radice sola e «hypervisor» solo con una prova; alternative scartate: il tipo dichiarato, solo a mano; **cosa diventa difficile**: un apparato di rete senza letture va segnato a mano, il numero di «da sistemare» dipende da come i lettori scrivono il protocollo, e uno switch che solo l'LLDP di altri vede resta fuori finché le capacità annunciate non sono una prova, T2-T3). Un commit di soli documenti, coi file nominati uno per uno.

- [ ] **Cancello completo, una volta**, sul ramo d'unione aggiornato a `origin/dev`:

```bash
(npm run lint && npx tsc --noEmit && npm test && npm run build) > "$SCRATCH/cancello-t1b.log" 2>&1; echo "exit=$?"
```

Atteso: `exit=0` (stessa nota del Task 12 su `credential-chains.test.ts`).

- [ ] **Il messaggio a Riccardo**, uno solo, in chat, in parole e in ora italiana (mai una sigla da sola): `senza_prove` prima → dopo sulle due copie; **solo nella chat** l'elenco per nome di chi esce dall'albero col suo motivo, **a parte** chi resta nell'albero solo per una prova aggiunta il 14/10 sera (`soloProveAggiunte`), i client e gli attaccati che lo seguono, i 2 host «router» del cliente A; le regole del passaggio universale di T1b come fatti da confermare, in parole (nessuna radice sola: sull'hub i cinque oggetti di rete senza collegamenti e sul cliente A la radio lontana in «Da sistemare»; un «hypervisor» solo se ha VM o è letto; lo spanning tree conta solo se attivo) e le righe «G10 · … · T1b»; la **scelta 8 del §13.16**, per esteso: un telefono IP che la classificazione dice router e che si annuncia via CDP passa la prova «si annuncia» (confermata da lui il 14/10) e resta nell'albero come apparato di rete (riga «da fare» della famiglia 5); se vuole, una guardia sull'annuncio (per esempio le capacità «Phone» del CDP, che arrivano con T2), altrimenti resta così; la **scelta 4 del §13.16**, per esteso: gli switch che solo l'LLDP di altri vede restano fuori dall'albero fino a T3, oppure si promuovono a mano subito col ruolo «Apparato di rete», con l'elenco per nome di `visti_solo_via_lldp` (solo in chat; sull'hub non è uno solo: ci sono anche PC registrati come switch); la bozza di P8 (con `SendUserFile` se non è al MacBook); la richiesta di conferma, **una volta e per esteso, per tre cose insieme**: il push su `dev` (arriva al cliente A in 15 minuti), l'aggiornamento dell'hub, e il ritorno indietro se i controlli dopo il rilascio vanno male. L'elenco si guarda insieme a lui prima del rilascio (§13.15 punto 3). Se corregge la bozza: un giro di correzioni e il cancello si rifà una volta prima del push.

- [ ] **Rilascio** (come il Task 12), solo dopo la sua conferma: `npm run version:release` (commit «release: vX.Y.Z»), `git rev-parse --short HEAD` (il commit di rilascio), `git push origin HEAD:dev`, l'ora del push in UTC; hub con `systemd-run --unit=aggiorna-t1b /root/aggiorna-f2b.sh` via la skill `deploy-prod`.

- [ ] **Controlli dopo il rilascio** (sola lettura; SQL solo da stdin con heredoc fra apici; tempo massimo circa 30 minuti dal push, come nel Task 12): il processo è ripartito **col commit del rilascio** — `ActiveEnterTimestamp` dopo l'ora del push, la riga «DA-INVENT ready» nel journal, e l'hash del commit di rilascio nella riga «nuovo commit su origin/dev» di `journalctl -u da-ipam-update` o in `git -C /opt/da-ipam rev-parse --short HEAD`, sull'appliance (`da-ipam`) e sull'hub (`da-invent`, `/opt/da-invent`); se no, il journal di `da-ipam-update` e subito un avviso a Riccardo; `PRAGMA quick_check` «ok»; in `GET /api/topology/model` `counts.senzaProve` uguale alla misura sulla copia presa subito prima del riavvio; nessuna riga con `topology_role` scritta finché Riccardo non ne sceglie una:

```bash
ssh <appliance del cliente A> 'sqlite3 -readonly /opt/da-ipam/data/tenants/<tenant>.db' <<'SQL'
SELECT COALESCE(topology_role, '(null)'), COUNT(*) FROM network_devices GROUP BY 1;
SQL
```

- [ ] **Tornare indietro** (solo se i controlli vanno male; già nella conferma di Riccardo): `git revert -m 1 <commit di unione di T1b>`, `npm run version:release`, `git push origin HEAD:dev`, gli stessi controlli. Nessuna scrittura sui dati: i ruoli scelti a mano restano in `topology_role`, e il codice di T1 non li legge.

- [ ] **Istruzioni passo passo a Riccardo**, in chat, in ora italiana. In testa quattro parti: dove siamo, che cosa è fatto, che cosa resta, che cosa fare tu e che effetto ha sul sistema. L'indirizzo dell'appliance del cliente A (da `ACCESSI.md`) sta solo nel messaggio. Per ogni passo: dove, che cosa fare, che cosa vedi se va bene, che cosa vedi se va male, l'effetto sul sistema.
  1. Apri DA-IPAM del cliente A (l'indirizzo è nel messaggio) → **Topologia → «Tutto automatico»**. Se va bene: gli oggetti dell'elenco che ti ho dato in chat non sono più nell'albero, e nessun altro si è spostato. Se va male: ne vedi uno spostato che non è nell'elenco; scrivimelo e non toccare altro. Effetto sul sistema: nessuno, guardi soltanto.
  2. Nell'elenco a sinistra apri il gruppo **«Da sistemare»**. Se va bene: ognuno dice «senza prove di ruolo», e passandoci sopra col mouse leggi il motivo intero. Se va male: manca un motivo, o c'è un oggetto che sai essere uno switch che leggiamo; scrivimelo. Effetto: nessuno.
  3. Se uno di loro è davvero uno switch o un router che non leggiamo: tasto destro → **«Ruolo nella mappa ▸ Apparato di rete»** (se è un host, prima **«Promuovi ad apparato»**, poi il ruolo). Se va bene: torna nell'albero subito, sotto il suo padre. Se va male: non torna, o compare un errore; scrivimelo. Effetto sul sistema: scrive il ruolo di quell'apparato nel DB del cliente; si annulla con **«Decide il sistema»**.
  4. Al contrario, se un server o un PC sta nell'albero come switch: **«Ruolo nella mappa ▸ Attaccato (server, PC)»**. Se va bene: diventa una foglia, attaccata alla sua porta. Se va male: resta dov'era, o compare un errore; scrivimelo. Effetto sul sistema: scrive il ruolo nel DB del cliente; «Decide il sistema» toglie la tua scelta.
  5. Fai clic sulla linea fra router 1 e core 1 e, nei dettagli a destra, sotto la riga del collegamento, apri **«Perché questo collegamento»**. Se va bene: chi vede chi, con l'ora italiana, e perché `ether8` e la porta 15 non sono un cavo. Se va male: frasi vuote, ore sbagliate o in inglese; mandami una schermata. Effetto: nessuno.
  6. Perché i passi 3 e 4 li fai tu e non io: il ruolo a mano è una scelta sui dati del cliente, e la decide chi conosce l'impianto (per i 2 host «router» del cliente A non sappiamo che cosa siano).
- [ ] **Dopo il rilascio** (commit di soli `docs/`/`.md`, che non riavviano niente): la riga «Rilasciato in vX.Y.Z il ‹data›» nel §13.11.2 della spec; la bacheca.
- [ ] **Prima della promozione a `main`**: una settimana dopo il rilascio senza ritorni (spec §13.11, tabella delle tappe), insieme a T1.

---

## Self-review (fatta il 14/10, rifatta il 15/10 dopo le tre verifiche, la notte del 15/10 dopo il passaggio universale, e il 15/10 mattina dopo le verifiche UV1 e UV2)

**Copertura della spec.**

| Spec | Dove |
| --- | --- |
| T1.0 misura e scenari (C10, C11, C17, C18, S0, S1, S3, S4, S9, R2 per orientamento, R6) | Task 4 (con R6 subito, Step 6); Task 12 (misura «dopo», C18, R6 col codice nuovo, con quello di prima e con lo script) |
| T1.1 fixture del router e del modello | Task 2 (fixture del router, valori inventati), Task 5 e Task 7 Step 4 (fixture riestratte, confronto senza le VM) |
| T1.2 lettore dei vicini (protocollo vero, valori interi), «annuncio di rete (MNDP o CDP)» | Task 2; P2 (T1-a fatto) |
| T1.3 traduttori, chiave della porta, passi 0-3 e 5-6 di §13.7.1, filtro delle fonti; chi resta senza collegamenti su un segmento in «Da sistemare»; il ripiego del router solo da porte riconosciute (§13.7.1, «Tre trappole») | Task 3, Task 5, Task 7 |
| T1.4 «Ignora» per cavo, porte occupate (anche con le due porte di una linea LLDP), correzioni orfane, VM per cavo | Task 9 (modello), Task 10 (testi e «Dati della mappa») |
| T1.5 pareggi fisici (D1) | Task 6 |
| T1.6 «Altri cavi visti fra questi due oggetti» | Task 7 (modello), Task 10 (dettagli) |
| T1.7 lato più vicino, linee dell'albero a tronco, elenco comprimibile; le etichette come corrette il 15/10 (§13.10.1) | Task 1, Task 8 |
| «Tornare indietro» con lo script (§13.11.1, R6) | Task 10b, Task 12 |
| T1b.1 prove di ruolo (D6 + le sei aggiunte + ruolo a mano), «Da sistemare» col motivo | Task 13 |
| T1b.2 «Ruolo nella mappa», `PATCH /api/topology/nodes/role` | Task 14 |
| T1b.3 «Perché questo collegamento» (ora italiana) e il motivo delle righe scartate | Task 15 |
| §13.12.3 prove-invariante citate per T1 e T1b (I4-I11, I13-I15, I28, I36, I37, I41, I43, I46, I47) | Task 3, 6, 7, 9, 13; I15 anche per un gruppo di una riga (Task 7); I37 su `cavi/porte.ts`, `cavi/ruolo.ts`, `cavi/frasi.ts`, anche con le forme dentro un'espressione |
| Criteri C1-C19, H1-H17, R1-R7 di T1 e T1b (H3, H8, H11, H12 e H18-H21 sono di T3) | Task 6 (H17), Task 7 (C1, C3, C8, H2, H5, H7, H10, H13), Task 9 (C4, C5, H15), Task 12 (C2, C7, C9, C16, C17, C18, C19, H1, H6, H9, H16, R1, R2, R6) e Task 16 (H4, H4b, H14) |
| Decisioni del 14/10 sera 1-7 e conferme | 1, 4, 5, 7: T3, fuori dal piano (qui solo che `ether8` è un segmento); 2: Task 7 e Task 12; 3: P5-P8 e Task 16; 6: Task 7, 10, 15 |
| Rilascio: conferma unica per tre cose, `version:release`, push, hub con lo script staccato, controlli col commit e un tempo massimo, Q-T1, ritorno, istruzioni a Riccardo con «se va male» ed «effetto sul sistema» | Task 12, Task 16 |
| §13.10.4 bozze, che non fermano il lavoro | P4, P8, Task 12, Task 16 |
| Repo pubblico: dati di clienti già su `origin/dev`; nelle fixture nuove nessun nome d'interfaccia scelto da un cliente né la sua numerazione, versioni, firmware, date di build e modelli inventati; un secondo controllo dei nomi di porta che ferma l'estrazione (fallisce chiuso) | Task 5 (Step 6, `porteInChiaro`), Task 2 (fixture), Task 7 (lo script d'estrazione) |
| Passaggio universale (§13.16, vincolo 9) in T1: il contenitore di RouterOS dalla forma (I59), un nome scelto non è una porta fisica per chi ha il traduttore del suo prodotto, anche dal lato remoto (I58, H7, G2), gli apparati di una porta contati per apparato (I60, G4), fra VM e hypervisor nessun collegamento e i MAC propri (I62, G9, H15), la testa per reti (I63, G8, H17), la velocità dei nomi doppi (I70, H13); le regole spegnibili solo dalla misura (C19) | Task 3 (I58, I59, `macDelTelaio`, `indiciInElenco`, la scansione dei prefissi), Task 6 (`regole.ts`, testa, `--senza-regola`), Task 7, Task 9 (Step 6-10), Task 12 (C19 sulle due copie) |
| Il lettore sulle due forme vere e sulle due reti: *terse* e *detail* via ssh (righe spezzate a 79 colonne), *detail* incollato, righe del *terse* senza virgolette, CRLF; fixture anonime con la stessa forma | Task 2 (Step 1: le fixture; Review Focus 9) |
| Reti-campione di cinque famiglie inventate (§13.12.2) e criteri G1-G17 (§13.3.0), con le prove saltate col perché e una «da fare»; le misure sulle due reti vere fra le C e le H | Task 10c (T1: le cinque tabelle, le righe G, le misure in `model-fixtures.test.ts`), Task 13 Step 6 (G10 di T1b, il telefono, H14 e C16, I65), Task 15 (I58 sulla famiglia 1), Task 12 e Task 16 (righe G nel resoconto) |
| T1b dal passaggio universale: nessuna radice sola (I64, G10, H14, C16), «hypervisor» solo con una prova e lo spanning tree solo se attivo (I65, G12), i visti solo via LLDP (scelta 4) | Task 13 Step 6-10, Task 16 |
| Misure su due copie (cliente A e rete B = hub) con criteri anonimi nel piano: C17 su 30 giri, R1 (`letture_vm`), teste, H7 (con la scelta del traduttore), H15, S12, C4 con gli abbinamenti del modello, C18 e Q-T1 neutro anche sull'hub (H16: le righe nuove contro l'uscita vera salvata); le copie del DB tolte a fine giro | Task 4 (Step 6), Task 7 (estrazione), Task 12, Task 16 |
| §13.5.1, la logica non sa di marche: la scelta del traduttore del lato remoto sta in `lettori/traduci.ts` (`haTraduttoreRemoto`), e I37 guarda anche il codice di `links.ts`; la porta fisica dalla forma con una coda che è una velocità (I58 anche coi prefissi di fabbrica) | Task 3, Task 7 |
| §13.4.6, più nomi scelti fra gli stessi due oggetti in una frase sola | Task 15 |
| L'anonimizzatore e i nomi scelti (§13.12.2): `porta-N` dà gli stessi fatti dei traduttori (G17) | Task 5 |
| Scelte che restano a Riccardo (§13.16): 1, 2, 3, 5, 6, 7 e 9 col rilascio di T1, la 4 e la 8 con T1b | Task 12, Task 16 |

**Segnaposti.** Nessun «da fare», «come sopra» o «simile al Task N» al posto del codice (la prova «da fare» della famiglia 5 non è un segnaposto: è lo stato `todo` di `node:test`, con la sua asserzione scritta, per un caso che le regole di oggi sbagliano e che va a Riccardo). I `// …` dentro alcuni blocchi (`link-attrs.ts`, `map-edge.tsx`, `linked-panel.tsx`) indicano codice di oggi che non cambia, accanto alle righe che cambiano scritte per intero. I `<A>`, `<H>`, `<tenant>`, `<tenant dell'hub>`, `<hub>`, `<appliance del cliente A>`, `<router dell'hub>`, `$USCITA_ROUTER1`, `$USCITA_HUB`, `$ESPR` e l'hash dell'unione dell'ondata 2 sono nomi del cliente, dati del cliente o valori che esistono solo al momento: li mette la sessione principale, mai nel repo. Il codice nuovo del passaggio universale è scritto per intero (Task 7, 9, 10c, 13, 15), copiato dal prototipo che ha girato le prove; quello della revisione finale del 15/10 (Task 2-5, 7, 10c, 12, 13, 15) è copiato dalle copie di lavoro dove è stato provato, blocco per blocco. Il Task 16 rimanda alle ricette dei Task 11 e 12 per la sessione principale, che ha il piano intero; i comandi che cambiano sono scritti.

**Coerenza dei nomi** fra i task: `chiavePorta`/`Porta`/`normale` (Task 3) usati dai Task 5, 7, 9; `haTraduttore` (Task 3) usato da `fisicaDelRouter` (Task 7); `righeUltimoGiro`, `portaLocale`, `comeDi`, `RisultatoCollegamenti` (Task 7) usati dai Task 9, 13, 15; `TopologyModel.segmenti` (Task 7) letto da `conteggi` e da `--nomi`; `ingressoDellaFixture` (Task 7) usato dallo script d'estrazione; `Ignorati`/`ignorato`/`portaOccupata`/`nessunIgnorato` (Task 9) usati da `links.ts`, `attach.ts` e `vm-ports.ts`; `OpzioniAttacco` (Task 7) riceve `ignorati` (Task 9) e `classe` (Task 13); `CavoDaScegliere.linea` (Task 10) letto dal dialogo; `sqlConta`/`sqlCopia`/`sqlApplica` (Task 10b) usati dallo script e da `misura-cavi --ripristino`; `ClasseMappa`, `classiMappa`, `ruoloLetto` (Task 13) letti da `tree.ts`, `model.ts` e dalla pagina; `MapNode.ruolo` (Task 14) solo per il menu, mentre la classe legge `topology_role` dalle righe (Task 13); `PassoPerche`/`frasiPerche`/`dettoInFrase` (Task 15). `rettangoli` sta in `map-screen.ts` (Task 1) e la usano `misura.ts` (Task 4) e la pagina (Task 8). Dal passaggio universale: `NOMI_REGOLE`/`RegolaUniversale`/`Regole`/`REGOLE_T1`/`leggiRegola` (Task 6) usati da `links.ts`, `link-attrs.ts`, `model.ts` (Task 7), `attach.ts` e `vm-ports.ts` (Task 9), dalle reti-campione (Task 10c) e da `misura-cavi --senza-regola`; `macDelTelaio` e `indiciInElenco` (Task 3) usati da `unisciPerNome` e da `enrichLinks` (Task 7); `portaDelRouter` (Task 7) usato anche dal ciclo del Task 15 (`motivo: "nome_scelto"`); `haTraduttoreRemoto` (Task 3) usato da `traduciPorta` e da `links.ts` (Task 7), al posto della copia che `links.ts` aveva; `unisciPerNome` solo in `links.ts`; `haTraduttore` e `traduciPorta` (Task 3) usati anche da `lineeDaNomeScelto` (Task 4, che per questo gira dopo il Task 3); `resolveScanHosts` e `addNodeMacs` (di oggi) usati da `lineeCucite` come da `model.ts`; `porteInChiaro` (Task 5) usato dallo script d'estrazione (Task 7); `gatewayDi`, `retiDiCuiGateway`, `ipDeiNodi` (Task 6); `teste`, `testeCambiate`, `lettureVm`, `sottoUnaSuaVm`, `lineeDaNomeScelto` (Task 4) usati dallo script e, gli ultimi, dalle reti-campione; `IpervisoriDi`/`ipervisoriDelleVm`/`vmEIpervisore`/`macProprio` (Task 9) usati da `attach.ts` e `model.ts`; `vistiSoloViaLldp` (Task 13) usato da `conteggi` e da `--nomi`; `soloMikrotik`, `soloUnifi`, `altreMarcheSnmp`, `conHypervisor`, `mista` (Task 10c) usati dai Task 13 e 15; `FIXTURE_VERE`, `automatico`, `hubConFirewallVirtuale` (Task 10c, in `model-fixtures.test.ts`) usati dal Task 13. Le chiamate a `buildLinks` e `attachMacs` riscritte dai Task 9, 13 e 15 passano ancora `regole` (e `ipervisori`).

**Review Focus → prove.** 1: Task 7 (`timestamp` nullo o illeggibile); 2: Task 7 (MAC VRRP non è un telaio); 3: Task 7 (stesso apparato da due fonti o con due telai); 4: Task 2 (`=` e virgolette nei valori); 5: Task 9 («Ignora» vecchio con porte grezze, host promosso); 6: Task 13 (un oggetto senza prove con un figlio); 7: Task 13 (`topology_role` di una versione successiva); 8: Task 7 (una porta fisica di un MikroTik rinominata: il cavo resta dal lato dello switch); 9: Task 2 (una riga che continua un valore e comincia con «cifre spazio»).

**Verificato il 15/10** (revisione del piano, in copie di lavoro fuori dal repo, sopra il codice del piano già provato dalla verifica V2): le prove nuove della revisione, viste fallire senza le correzioni e verdi con le correzioni (I15 di una riga, I9 con le due porte per la tabella MAC e per le VM, H5, il ripiego da «VL_…», `haTraduttore`, l'autoprova di I37 con le forme dentro un'espressione, lo script di ritorno, `ingressoDellaFixture`, i Review Focus 6 e 7); `tsc` ed `eslint` puliti; con T1b sopra T1 le prove della topologia verdi salvo i numeri delle fixture, che i task fanno riscrivere. Sulle copie del 14/10: la misura dà i valori scritti nel Task 12 (cliente A con i soli tre padri attesi e 2 radici; hub coi tre hypervisor, i tre switch di laboratorio in «Da sistemare», 6 radici come prima, nessun hypervisor sotto il router), esce con 0 anche sull'hub, e conta i 7 ritocchi della sede 1 in orizzontale (4 validi); l'estrazione delle fixture esce con 0 su tutte e due le copie, con 0 IP, 0 MAC e 0 nomi; R6 col *detail* incollato dà gli esiti scritti nel Task 12 (0 padri cambiati con le righe nuove, 1 nel caso peggiore, 0 dopo lo script); C18 0.

**Verificato il 15/10 notte (passaggio universale)**, su un prototipo del piano fuori dal repo (un clone del ramo di verifica, coi `node_modules` della copia in sola lettura): per ogni regola nuova la prova vista fallire senza il codice e verde con il codice (Task 2: la riga che continua un valore, mentre le prove sulle forme vere erano già verdi col lettore di prima; Task 3: I58, I59, `macDelTelaio`, `indiciInElenco`; Task 4: teste, R1, H15, H7, S12; Task 6: I63 e `gatewayDi`; Task 7: I58/H7, Review Focus 8, I60, I70; Task 9: G9, I62/H15, S12; Task 13: I64, I65, `vistiSoloViaLldp`, G10 di T1b; Task 15: la frase del nome scelto), e le reti-campione verdi (allora 21 prove: 14 verdi, 7 saltate col perché; 23 con T1b); ogni regola, spenta, cambia almeno una famiglia (Task 10c, Step 4). Le prove della topologia verdi salvo le 7 che dipendono da dati del prototipo (i numeri delle fixture, che i task fanno riscrivere, e `ignored-links.test.ts`, a cui nel prototipo mancava `orfana: false`: nessuna prova del piano dipende dal fuso orario, misurato da UV2 con `TZ=UTC`, `America/New_York` e `Asia/Tokyo`). Il prototipo non conteneva tutte le correzioni delle verifiche precedenti: lo stato intero del piano l'ha costruito e provato a parte la verifica UV2, e su quello lavora la revisione finale (sotto); `tsc` pulito, `eslint` senza errori. Sulle copie del 15/10 notte (cliente A e hub): «prima → dopo» e C19 come scritti nel Task 12, C18 0 su tutte e due (sull'hub col *terse* del suo router), T1b come scritto nel Task 16; `modello_ms` 13,5 / 16,9 / 18,0 ms (oggi / T1 / T1b, mediana di 30 giri). I nomi di chi cambia padre o esce sono stati detti solo in chat.

**Revisione finale del 15/10 (verifiche UV1, universalità e repo pubblico, e UV2, codice).** Quindici problemi, tutti applicati (registro fuori dal repo). Provato in due copie di lavoro dello stato intero del piano (T1 e T1b sopra T1, quelle costruite da UV2 dal prototipo più le parti mancanti, coi `node_modules` della copia in sola lettura), dove ogni correzione è stata scritta prima di copiarla qui:
- le prove nuove viste fallire senza la correzione e verdi con lei: M-7 ristretta e I58 coi prefissi di fabbrica, `haTraduttoreRemoto`, I37 sul codice di `links.ts`, H7 che non conta un MikroTik letto via SNMP, C4 con i MAC della scansione, `porteInChiaro`, la frase unita dei nomi scelti; le reti-campione (T1: 24 prove, 17 verdi, 7 saltate; T1b: 27, 19 verdi, 7 saltate, una «da fare»); le misure sulle reti vere in `model-fixtures.test.ts` verdi, e quelle di T1b viste rosse senza lo Step 8 del Task 13;
- tutte le prove della topologia, degli apparati, dei vicini e dell'attribuzione: T1 856 (843 verdi, 7 saltate, 6 rosse), T1b 887 (873 verdi, 7 saltate, 1 da fare, 6 rosse); le 6 rosse sono i numeri delle fixture che i Task 7 e 13 fanno riscrivere; `tsc` `exit=0`, `eslint` senza errori (5 avvisi di oggi, in file che il piano non tocca);
- sulle copie di P3: l'estrazione delle fixture esce con 0 su tutte e due («0 nomi di porta scelti»), e con l'alternativa VRRP di prima si ferma («5»); nessuna cartella di lavoro rimasta; la restrizione di `MIKROTIK_FISICA` non cambia nessun nome (0 su 147 e 233); C4 coi MAC della scansione dà gli stessi numeri (cliente A 1, 2 in S1; hub 1); sull'hub la linea verso il router di frontiera passa da 13 frasi a 4; il confronto neutro di Q-T1 vede i troncati del lettore di prima su tutte e due le reti (3 e 4), dove la query coi nomi del cliente A ne avrebbe visti 0 sull'hub;
- con le uscite vere: nelle quattro fixture del Task 2 nessun pezzo di `interface=` e `interface-name=` uguale al vero che non sia un nome di fabbrica (prima della revisione: il nome VRRP del cliente A in due), e nessuna versione, data di build o modello nuovo che compaia nelle uscite vere.

**Sfumature da portare alla spec** (non cambiano il piano): G6 per la famiglia 3 non può passare in T1, perché l'elenco chiuso di chi consuma il CDP sta nel lettore SNMP (T2-T3): la prova è saltata col perché; l'estensione di G2 al lato remoto (un nome scelto sul lato di un MikroTik non dà la porta remota) va confermata nel §13.7.1, passo 3b; l'anonimizzatore tiene `porta-N` invece del «disegno» del nome scelto (§13.12.2), con la prova G17 che lo dimostra equivalente per i traduttori; «visti solo via LLDP» sull'hub sono 6, non uno (ci sono anche PC registrati come switch); il margine di C17 è stretto (18,0 ms con T1b su 20); le radici delle copie del 15/10 (cliente A 1, hub 5) non sono quelle del 14/10 (2 e 6), e il Task 12 le confronta «prima e dopo» sulla stessa copia. Dalla revisione finale, già portate nella spec: le cinque famiglie e le misure sulle reti vere (§13.12.2), Q-T1 neutro (§13.11.1, C6, H16), la frase unita (§13.4.6), la coda di `MIKROTIK_FISICA` (§13.6.1), la versione del router 1 (7.24.4), le scelte 8 e 9 (§13.16).

# Topologia — mappa verticale e stampa — piano di attuazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** la mappa si dispone anche da sinistra a destra («Verticale», predefinito: i fratelli impilati, si legge dall'alto in basso) e si stampa in A4/A3 su più fogli con panoramica, legenda e tasselli sovrapposti.

**Architecture:** quattro tappe. **G** (completo) aggiunge `orientation` a `topology_maps` e a `topology_position` e la rotta per cambiarlo. **H** (leggero, logica pura) insegna a `layoutTree` l'orientamento `lr`. **I** (leggero) ruota maniglie e linee della pagina, mette l'interruttore, «Adatta» in larghezza e la rotellina che scorre. **L** (leggero) è la pagina di stampa: SVG statico con le stesse coordinate e lo stesso `edgeLook`, tasselli calcolati da una funzione pura.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, better-sqlite3, `node --import tsx --test`, Zod v4, shadcn v4 su `@base-ui/react`, `@xyflow/react` 12, `playwright-core` per le verifiche a schermo e in PDF.

**Spec:** `docs/superpowers/specs/2026-10-12-topology-map-design.md` §12 (vincolante), §10-§11 per il resto. ADR 0009, 0010.

## Global Constraints

- Repo **pubblico**: niente nomi, IP, MAC o seriali dei clienti in codice, prove, fixture, commit, documenti. Dati di prova inventati con la forma vera; si scrive «cliente A».
- `db-tenant` si importa solo staticamente (ADR 0002). Ogni rotta: `withTenantFromSession` + `requireAuth()`/`requireAdmin()` come prima istruzione; corpi con Zod, messaggi in italiano. `db.ts` e `db-tenant.ts` non divergono.
- Migrazioni additive, idempotenti, in transazione, in fondo a `getTenantDb` **dopo** `migrateTopologyPhase2b`; nomi delle colonne e valori alla lettera: `topology_maps.orientation TEXT NOT NULL DEFAULT 'lr' CHECK(orientation IN ('lr','tb'))`, `topology_position.orientation TEXT` (NULL = `tb`, le righe di oggi).
- Valori della disposizione verticale alla lettera (spec §12.2): fra due colonne `LEVEL_GAP_LR = 90`; rientro degli attaccati `ATT_INDENT = 12`, al massimo `ATT_MAX` (4) più «+ altri N»; AP in `AP_COLS_LR = 2` colonne; VM in `VM_COLS_LR = 2` colonne; partenze una sotto l'altra con `ROOT_GAP` (60).
- Stampa alla lettera (spec §12.3): fogli A4 (area 190 × 277 mm) e A3 (277 × 400 mm), 96 dpi (1 px = 0,2646 mm), scala 100 % (predefinita) o 80 %, foglio predefinito A3, sovrapposizione 15 mm, orientamento del foglio quello con meno fogli; primo foglio con nome, data e ora italiana, legenda, panoramica con la griglia «riga-colonna».
- Interfaccia: italiano, ≥ 13 px a schermo, **mai il solo colore** (Riccardo è daltonico), 1920 px di riferimento, verifiche a 1280 e 1920. Date con `parseDbDate`, caricamenti con `fetchJson` + `LoadError`, `localStorage` solo in try/catch.
- Ogni push su `dev` arriva al server del cliente A da solo: il rilascio passa dalla misura sulle copie e dalla conferma di Riccardo (la migrazione tocca i DB dei clienti). Prima della migrazione, `quick_check` di **tutti** i tenant della macchina e copia con l'API di backup.
- SQL verso un server solo da stdin con heredoc tra apici; JSON in SQL con `json_object()`. Dentro ssh `pgrep -x`. Segreti mai nel trascritto.
- Al massimo 2 agenti che compilano insieme, ciascuno nel suo worktree. Log nello scratchpad, esito da `exit=`.

## Review Focus

1. **Un genitore con 60 figli** (lo switch centrale): in verticale nessun riquadro si sovrappone, il genitore sta a metà fra il primo e l'ultimo figlio, la colonna è larga quanto il figlio più largo → prova nel Task 2.
2. **Ritocchi fatti in orizzontale, poi si passa al verticale**: i ritocchi `tb` non si applicano in `lr` e non vanno persi; tornando in orizzontale ricompaiono; un ritocco in `lr` sullo stesso oggetto sostituisce il vecchio → prove nei Task 1 e 2.
3. **Hypervisor espanso in verticale**: si allarga solo la sua colonna, le colonne dopo scorrono a destra, niente si sovrappone, le VM non escono dal riquadro (`fitLabel`) → prova nel Task 2.
4. **Una mappa più grande di un foglio**: ogni riquadro compare intero in almeno un tassello; i tasselli sono numerati e coprono tutto il disegno senza buchi → prova nel Task 4.
5. **La pagina di stampa senza dati** (rotta in errore, mappa cancellata): si vede l'errore in parole, mai un foglio bianco o una mappa vuota → prova nel Task 4 e verifica nel Task 5.

---

## Struttura dei file

- **Tappa G**: `src/lib/db-tenant.ts` (`migrateTopologyOrientation`, lettura e scrittura dell'orientamento, ritocchi con l'orientamento), `src/lib/db.ts` (stesse firme se il facade le espone), `src/lib/topology/api-input.ts` (parser), `src/app/api/topology/maps/[id]/route.ts` (PATCH `{ orientation }`, anche per `auto`), `src/app/api/topology/positions/route.ts` (orientamento del ritocco); prove `src/lib/__tests__/topology-orientation-migration.test.ts`, `src/lib/topology/__tests__/api-input.test.ts`, prova DB.
- **Tappa H**: `src/lib/topology/tree-layout.ts` (+ eventuale `tree-layout-lr.ts` se il file supera ~300 righe); prova `src/lib/topology/__tests__/tree-layout-lr.test.ts`; `scripts/misura-orientamento.ts` (già scritto con la stima: passa alla disposizione vera).
- **Tappa I**: `src/components/topology/map/{map-node,map-canvas,map-edge,map-toolbar,topology-map-client,use-topology-data,api}.ts(x)`.
- **Tappa L**: nuovi `src/lib/topology/print-tiles.ts` (logica pura), `src/components/topology/print/{print-map.tsx,print-sheet.tsx}`, `src/app/(dashboard)/topology/stampa/page.tsx` (o fuori dal layout del cruscotto se la barra laterale non si toglie con la stampa), CSS `@page`; prova `src/lib/topology/__tests__/print-tiles.test.ts`.

**Ordine** (aggiornato 14/10 pomeriggio): Task 1 (G) e Task 2 (H) in parallelo, due agenti, due worktree (H non legge il DB: riceve l'orientamento come argomento). Poi Task 3 (I) e Task 4 (L) in parallelo sopra l'unione. Poi Task 2b (H2, logica del modello, spec §12.5). Task 5-6 nella sessione principale.

---

## Tappa G — dati (livello completo)

### Task 1: orientamento nel DB e nelle rotte

**Files:** Modify `src/lib/db-tenant.ts`, `src/lib/topology/api-input.ts`, `src/app/api/topology/maps/[id]/route.ts`, `src/app/api/topology/positions/route.ts`; Test `src/lib/__tests__/topology-orientation-migration.test.ts`, `src/lib/topology/__tests__/api-input.test.ts`, prova DB delle mappe esistente (`topology-db.test.ts` o gemella).

**Interfaces — Produces:**
- `type MapOrientation = "lr" | "tb"` in `src/lib/topology/model-types.ts` (lo usa anche H).
- `migrateTopologyOrientation(db): string[]` — gemella di `migrateTopologyPhase2b` (stessa forma `has`/`add`, transazione, elenco di ciò che aggiunge), chiamata subito dopo di lei in `getTenantDb`.
- `getMapOrientation(view: "auto" | \`mappa:${number}\`): MapOrientation` (riga assente o `auto` senza riga → `"lr"`); `setMapOrientation(view, o: MapOrientation, actor: string): Esito` (per `auto` crea la riga come fa `setAutoHead`).
- La vista della mappa (`getTopologyMapView`, quella che risponde `GET /api/topology/maps/[id]`) porta `orientation: MapOrientation` e nei ritocchi `orientation: MapOrientation` per riga (`NULL` → `"tb"`).
- `PATCH /api/topology/maps/[id]` accetta `{ orientation: "lr" | "tb" }` (anche `id = auto`), `requireAdmin`; parser `parseMapOrientationBody` in `api-input.ts` con messaggio «Orientamento non valido: si sceglie fra verticale e orizzontale».
- Il salvataggio di un ritocco (`/api/topology/positions`) riceve `orientation` e lo scrive; un ritocco nuovo sostituisce la riga (stessa chiave `view, node_id`). L'appartenenza (`pinned = 0`) non scrive l'orientamento.

- [ ] **Step 1: prove che falliscono** — sul modello di `topology-phase2b-migration.test.ts`: la migrazione aggiunge le due colonne; la seconda volta niente; le righe esistenti di `topology_maps` valgono `'lr'` e quelle di `topology_position` restano `NULL`; un valore fuori dal CHECK si rifiuta. Poi: `getMapOrientation("auto")` senza riga → `"lr"`; `setMapOrientation("auto", "tb", …)` crea la riga `auto` e la testa resta quella di prima; un ritocco salvato con `"lr"` sostituisce quello `NULL` dello stesso oggetto e l'appartenenza non cambia (Review Focus 2). Parser: `{ orientation: "lr" }` ok, `"verticale"` rifiutato col messaggio.
- [ ] **Step 2: vederle fallire** — `node --import tsx --test src/lib/__tests__/topology-orientation-migration.test.ts src/lib/topology/__tests__/api-input.test.ts`.
- [ ] **Step 3: il codice**, migrazione, funzioni DB, rotte. Rigenerare `docs/auth-matrix.md` col suo generatore se le rotte cambiano firma.
- [ ] **Step 4: verdi** + prove esistenti delle migrazioni topologia e delle rotte delle mappe; misura sulla copia della copia del cliente A (durata, `integrity_check` prima e dopo, riapertura che non aggiunge niente).
- [ ] **Step 5: commit** `feat(topologia): orientamento delle mappe e dei ritocchi nel DB`.

---

## Tappa H — disposizione (livello leggero)

### Task 2: `layoutTree` da sinistra a destra

**Files:** Modify `src/lib/topology/tree-layout.ts`, `scripts/misura-orientamento.ts`; Test `src/lib/topology/__tests__/tree-layout-lr.test.ts`, `src/lib/topology/__tests__/model-fixtures.test.ts`.

**Interfaces — Consumes:** `MapOrientation` (Task 1; nel ramo H si dichiara uguale in `model-types.ts` e all'unione resta una sola definizione).
**Produces:**
- `layoutTree(model, tree, tweaks, expanded = new Set(), orientation: MapOrientation = "lr"): LayoutResult` — **attenzione: il predefinito passa a `"lr"`**; i chiamanti di oggi che vogliono l'orizzontale passano `"tb"` (le prove esistenti dell'orizzontale lo passano esplicitamente).
- `SavedTweak` += `orientation: MapOrientation`; un ritocco si applica solo se `t.orientation === orientation` (oltre alla firma); quelli dell'altro orientamento non finiscono in `expired`.
- `LayoutResult` += `orientation: MapOrientation`; in `lr` `LayoutNode` e `apGroups` hanno le coordinate della disposizione verticale; `vmChips` in `VM_COLS_LR` colonne.
- Costanti esportate: `LEVEL_GAP_LR = 90`, `ATT_INDENT = 12`, `AP_COLS_LR = 2`, `VM_COLS_LR = 2`.

Regole (spec §12.2): colonna `c` a `x = MARGIN + Σ(larghezza colonne precedenti + LEVEL_GAP_LR)`; larghezza di una colonna = massimo fra i riquadri del livello (`boxW`, VM comprese in `VM_COLS_LR`), `ATT_INDENT + ATT_W` se c'è un attaccato, `AP_COLS_LR * (AP_W + 8)` se c'è un gruppo AP; altezza di un sottoalbero = massimo fra il proprio blocco (riquadro + attaccati sotto + «+ altri N») e la somma dei figli (infrastruttura, poi il gruppo AP come un figlio) con `GAP` fra l'uno e l'altro; genitore a metà fra il centro del primo e dell'ultimo figlio, dentro la sua fetta (stessa regola del Task 12 della fase 2, ruotata); attaccati a `x = riquadro.x + ATT_INDENT`, `y = riquadro.y + riquadro.h + 4 + i * ATT_ROW`; partenze una sotto l'altra con `ROOT_GAP`.

- [ ] **Step 1: prove che falliscono** (dati inventati): stessi dati → stesse coordinate (due chiamate); un genitore con 60 figli switch → nessuna sovrapposizione fra riquadri (prova a coppie sui rettangoli), genitore centrato fra primo e ultimo figlio, x dei figli tutte uguali (Review Focus 1); un hypervisor espanso con 7 VM → la sua colonna si allarga, le colonne dopo scorrono, nessuna sovrapposizione, ogni `vmChip` dentro il riquadro e `label` accorciata da `fitLabel` (Review Focus 3); attaccati sotto il riquadro e «+ altri N» oltre 4; gruppo AP in 2 colonne nella colonna dei figli; tre partenze una sotto l'altra senza sovrapporsi; ritocco `tb` ignorato in `lr` e non in `expired`, ritocco `lr` applicato a tutto il ramo (Review Focus 2); in `tb` coordinate **identiche** a quelle di oggi (le prove esistenti, con `"tb"` esplicito, restano verdi senza cambiare un numero).
- [ ] **Step 2: vederle fallire.**
- [ ] **Step 3: il codice** — un ramo `lr` accanto a quello di oggi, con le funzioni di misura e di posizionamento proprie; se `tree-layout.ts` supera ~300 righe, il ramo `lr` va in `tree-layout-lr.ts` e `layoutTree` sceglie.
- [ ] **Step 4: verdi** + tutte le prove della topologia; in `model-fixtures.test.ts`, per le due fixture, larghezza e altezza in `lr` scritte nella prova con un commento che dice da dove vengono; `scripts/misura-orientamento.ts` usa `layoutTree(…, "lr")` al posto della stima e stampa i due orientamenti misurati davvero.
- [ ] **Step 5: commit** `feat(topologia): disposizione verticale (da sinistra a destra) dell'albero`.

---

## Tappa H2 — dati della mappa (livello leggero, logica pura)

### Task 2b: hypervisor dalle VM sulla porta, principale dell'hypervisor, nome dal Proxmox

**Spec:** §12.5 (vincolante). **Files:** `src/lib/topology/attach.ts` (o un file nuovo `vm-ports.ts` chiamato da lì), `src/lib/topology/model-types.ts` (`LinkSource` += `"vm_mac"` con il suo posto in `LINK_SOURCE_RANK`, subito dopo `mac_table`), `src/lib/topology/tree.ts` (scelta del principale), `src/lib/topology/model.ts` / `vms.ts` / `known-ports.ts` (nome dal Proxmox, riusando come oggi si trova l'host giusto di un apparato: l'IP dell'apparato nelle schede dell'host), le etichette in parole della fonte dove le altre fonti hanno la loro (dettagli del collegamento); prove in `src/lib/topology/__tests__/` (dati inventati, forma vera: VM con `node`, `status`, MAC nelle schede di rete).

**Produces:**
- Fonte `vm_mac`: per ogni porta di bordo di uno switch o AP (non in `linkPorts`, non uplink) i MAC di VM **accese** freschi (entro la soglia «non visto») su quella porta; se appartengono **tutti** allo stesso hypervisor H (≥ 1 VM) → collegamento porta ↔ H, `source: "vm_mac"`, `uplinkFrom: H`, con il numero di VM disponibile ai dettagli («N VM di H passano da questa porta»). VM di due hypervisor sulla stessa porta → niente. Le VM restano fuori dai client della porta (come oggi). Se H ha già un collegamento fra gli stessi due oggetti da un'altra fonte, si fonde come le altre fonti (`sources`).
- Principale di un hypervisor (nodo con VM / tipo hypervisor): fra i suoi collegamenti dai dati vince quello con la porta dello switch più veloce (`portInfo.speed`), a parità quello con più VM, poi le regole di oggi. `★` scelto a mano vince sempre. Gli altri apparati: invariati.
- Nome dal Proxmox: se l'IP dell'apparato hypervisor sta nelle schede di un host della scansione e il `hostname` dell'host è diverso (confronto senza dominio e senza maiuscole), il nodo della mappa ha `name` = nome del Proxmox e un campo `dnsName` = nome di prima; il riquadro (schermo e stampa) mostra sotto «DNS: <dnsName>» in piccolo (≥ 13 px). L'inventario non cambia.

- [ ] **Step 1: prove che falliscono** — porta con 3 VM accese tutte di H → collegamento `vm_mac` verso H; porta con VM di H e di K → niente; porta che è uplink o di un collegamento fra apparati → niente; VM spente non contano; VM vecchie oltre la soglia non contano; H con un cavo `mac_table` 1G e uno `vm_mac` 10G → principale il 10G, l'altro ridondanza; con `★` sul 1G → il 1G; due cavi 10G → vince quello con più VM; nome: apparato «px-02.dominio» il cui IP sta nell'host «PX-DOWN» → `name` «PX-DOWN», `dnsName` «px-02.dominio»; stesso nome con dominio diverso → nessun `dnsName`.
- [ ] **Step 2: vederle fallire.**
- [ ] **Step 3: il codice.**
- [ ] **Step 4: verdi** + tutte le prove della topologia; `npx tsc --noEmit`, `npm run lint`; `scripts/misura-topologia.ts` sulla copia del cliente A (path passato come argomento, mai nel repo) per contare i collegamenti `vm_mac` e i principali cambiati: numeri nel report, non nel repo.
- [ ] **Step 5: commit** `feat(topologia): hypervisor dalle VM sulla porta, principale più veloce, nome dal Proxmox`.

---

## Tappa I — la pagina (livello leggero)

### Task 3: la mappa in verticale a schermo

**Files:** Modify `src/components/topology/map/map-node.tsx` (maniglie), `map-canvas.tsx` (linee, scorrimento, «Adatta»), `map-edge.tsx` (posizione delle etichette), `map-toolbar.tsx` (interruttore e «Stampa»), `topology-map-client.tsx` (orientamento letto dalla vista e passato a `layoutTree`; ritocchi salvati con l'orientamento), `use-topology-data.ts`, `api.ts`.

**Interfaces — Consumes:** Task 1 (`orientation` nella vista, PATCH, ritocchi), Task 2 (`layoutTree(…, orientation)`).
**Produces:** maniglie con id fissi `HANDLE_IN = "su"`, `HANDLE_OUT = "giu"` (orizzontale, come oggi) e `HANDLE_IN_LR = "sx"`, `HANDLE_OUT_LR = "dx"` (verticale, `Position.Left` / `Position.Right`), `HANDLE_ATT = "fondo"` per il tratto verso gli attaccati; `sourceHandle`/`targetHandle` scelti dall'orientamento in `map-canvas.tsx`; le ridondanze in `lr` vanno dal riquadro più a sinistra a quello più a destra.

- **Interruttore** «Verticale | Orizzontale» (due pulsanti a segmento col testo, quello attivo con fondo **e** bordo; solo admin; per gli altri il valore in parole, disabilitato con il motivo al passaggio del mouse). Cambiarlo chiama la PATCH, ricarica la vista e ricentra.
- **«Adatta»** in `lr`: zoom = larghezza del riquadro della mappa / larghezza della disposizione (fra 0,25 e 1), poi in cima a sinistra; in `tb` come oggi (`fitView`).
- **Rotellina** in `lr`: `panOnScroll` (scorre in verticale), `zoomOnScroll` spento, zoom con Ctrl+rotellina e col pizzico (`zoomActivationKeyCode` / `zoomOnPinch`); in `tb` come oggi.
- **Etichette delle linee** (porte, velocità, ⚡, ★, «✎ ✓/?»): in `lr` stanno sopra il tratto orizzontale vicino al figlio e non coprono i riquadri (≥ 13 px).
- **Ritocchi**: il trascinamento salva l'orientamento corrente.
- Pulsante **«Stampa»** nella barra: apre `/topology/stampa?mappa=<id|auto>` in una scheda nuova (Task 4).
- **Ridondanze a richiesta (spec §12.5)**, in tutti e due gli orientamenti: le linee con `redundant` (o comunque non principali) non si disegnano; il riquadro mostra «⇄ N» (≥ 13 px, testo, mai solo colore) con N = sue ridondanze; clic sul riquadro → si disegnano le sue (stile di oggi: doppia linea sottile + «ridondanza»), clic altrove le toglie; interruttore «Mostra ridondanze» nella barra (per tutti, non solo admin; ricordato in `localStorage` in try/catch, predefinito spento); il pannello dei dettagli continua a elencarle. Funzione pura `visibleEdges(edges, { showAll, selected })` provata con `node --test` (nessuna ridondanza visibile di base, solo quelle del selezionato, tutte con l'interruttore, i principali sempre). La disposizione non cambia.

- [ ] Prove pure dove c'è logica (scelta delle maniglie, zoom di «Adatta» in `lr`, verso delle ridondanze) con `node --import tsx --test`; `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [ ] Commit `feat(topologia): mappa verticale a schermo — interruttore, linee da sinistra a destra, «Adatta» in larghezza`.

---

## Tappa L — la stampa (livello leggero)

### Task 4: pagina di stampa con panoramica e tasselli

**Files:** Create `src/lib/topology/print-tiles.ts`, `src/components/topology/print/print-map.tsx`, `src/components/topology/print/print-sheet.tsx`, la pagina `stampa` (vedi Struttura dei file); Test `src/lib/topology/__tests__/print-tiles.test.ts`, prova pura del disegno se c'è logica (scelta dei tratti dallo `edgeLook`).

**Interfaces — Consumes:** Task 2 (`layoutTree`, `LayoutResult` con `orientation`), `edgeLook` (`src/lib/topology/edge-look.ts`), la vista della mappa del Task 1 (ritocchi e orientamento).
**Produces:**
- `planSheets(drawing: { width: number; height: number }, opts: { paper: "A4" | "A3"; scale: 1 | 0.8; overlapMm: number }): SheetPlan` con `SheetPlan = { paper; landscape: boolean; rows: number; cols: number; tiles: Array<{ row: number; col: number; x: number; y: number; w: number; h: number }> }` — coordinate dei tasselli nel sistema del disegno (px a scala 1). Area stampabile alla lettera: A4 190 × 277 mm, A3 277 × 400 mm; `pxPerMm = 1 / 0.2646`; `landscape` = quello con meno tasselli (a parità, verticale).
- `<PrintMap layout tree model orientation viewBox />` — SVG statico: riquadri (nome con `fitLabel`, tipo in parole), gruppi AP, attaccati, linee ortogonali con lo stile di `edgeLook` in nero/grigi (spessore, tratteggio, doppia linea, onda, etichette «10G», «≋ Wi-Fi», «▲ non visto da N g», «⚡ N W», «★», «✎ ✓/?»).
- Pagina: legge `mappa`, `foglio` (A4|A3, predefinito A3), `scala` (100|80, predefinito 100), `vm` (0|1); carica la vista con `fetchJson` + `LoadError`; in errore mostra il messaggio in parole (Review Focus 5). Primo foglio: nome della mappa, data e ora italiana (`FUSO_UTENTI`), legenda, panoramica a tutta pagina con la griglia dei tasselli «riga-colonna». Sul primo foglio, sotto la legenda, l'elenco **«Cavi di ridondanza»** (oggetto · porta → oggetto · porta, velocità; spec §12.5): nei tasselli le ridondanze **non** si disegnano. Poi un foglio per tassello (`<svg viewBox>` sullo stesso disegno) con «Foglio r-c di R×C» e le frecce ai vicini. CSS: `@page { size: A3 portrait|landscape; margin: 10mm }`, `break-after: page`, nessuna barra dell'app in stampa. Sopra i fogli, solo a schermo, una barra con foglio, scala, «con le VM» e «Stampa» (`window.print()`).

- [ ] **Step 1: prove che falliscono** — `planSheets`: un disegno più piccolo di un foglio → 1 tassello; 2.617 × 2.462 px in A3 al 100 % → righe × colonne uguali al conto a mano scritto nella prova; ogni punto del disegno sta in almeno un tassello e tasselli vicini si sovrappongono di 15 mm (Review Focus 4); un riquadro alto `BOX_H` tagliato dal bordo compare intero nel tassello vicino; orientamento del foglio scelto col minor numero di fogli.
- [ ] **Step 2-4**: rosso, codice, verde; `npx tsc --noEmit`, `npm run lint`, `npm run build`.
- [ ] **Step 5: commit** `feat(topologia): stampa della mappa su A4/A3 con panoramica, legenda e tasselli`.

---

## Uscita (sessione principale)

### Task 5: a schermo e in PDF sulla copia

- [ ] App locale sulla copia della copia del cliente A e dell'hub (ricetta del Task 12 della fase 2b, `task-12` nello storico: porta 3101, utenza di prova con password in un file `chmod 600`), `playwright-core` con Chrome, 1920 e 1280, `innerWidth` stampato.
- [ ] A schermo: automatica e una mappa passo passo in verticale (predefinito) e in orizzontale; interruttore; «Adatta» in larghezza; rotellina che scorre; un ritocco in verticale, poi orizzontale e ritorno (Review Focus 2); hypervisor espanso; linee con velocità, PoE, ridondanza, a mano.
- [ ] In PDF: `page.pdf()` della pagina di stampa in A3 e A4, 100 % e 80 %; si guardano le pagine (immagini nello scratchpad, mai nel repo): panoramica leggibile, nessun riquadro tagliato senza il suo intero nel foglio vicino, legenda, data italiana; mappa inesistente → errore in parole.
- [ ] Si corregge quel che si vede; commit `fix(topologia): quel che si è visto a schermo e in stampa (verticale)`.

### Task 6: unione, revisione finale, misura, conferma, rilascio, documenti

- [ ] Unione dei rami in un worktree da `origin/dev`; **una revisione finale** su Opus dell'intero lavoro, un solo giro di correzioni, una revisione mirata; cancello completo una volta (`exit=`).
- [ ] Copie fresche (API di backup), `quick_check` di tutti i tenant di DTS e dell'hub, `scripts/misura-orientamento.ts` sulle copie (larghezza, altezza e fogli nei due orientamenti, misurati davvero) e la migrazione sulla copia (durata, integrità prima e dopo, riapertura).
- [ ] **Conferma di Riccardo** con i numeri; poi copie sui server (`data/backups/<tenant>-pre-topologia-verticale-<data>.db`), `version:release`, push di `dev`, hub con lo script staccato (`/root/aggiorna-f2b.sh` è il modello), controlli dopo (processo riavviato davvero — `ActiveEnterTimestamp`, riga della migrazione nel journal — versione, `quick_check`).
- [ ] ADR 0011 `docs/adr/0011-topologia-verticale-e-stampa.md` (decisione: verticale predefinito e per mappa; ritocchi per orientamento; stampa SVG con tasselli; **cosa diventa difficile**: due disposizioni da tenere allineate in ogni ritocco della disposizione; i ritocchi esistenti non valgono in verticale; la stampa dipende dal browser per il PDF), CHANGELOG, CONTEXT §6, spec §12.4 con la versione, bacheca, istruzioni passo passo a Riccardo per provare e stampare a 1920.

## Self-review (fatta)

- **Copertura della spec §12**: 12.1 → Task 2 (misura vera) e 6; 12.2 → Task 1 (dati, predefinito, ritocchi), 2 (disposizione), 3 (interruttore, linee, «Adatta», rotellina); 12.3 → Task 4 (stampa), 5 (PDF); 12.4 → ordine delle tappe e Task 6.
- **Nomi coerenti**: `MapOrientation` (`"lr" | "tb"`), `migrateTopologyOrientation`, `getMapOrientation`, `setMapOrientation`, `parseMapOrientationBody`, `layoutTree(…, orientation)`, `LEVEL_GAP_LR`, `ATT_INDENT`, `AP_COLS_LR`, `VM_COLS_LR`, `HANDLE_IN_LR`, `HANDLE_OUT_LR`, `HANDLE_ATT`, `planSheets`, `SheetPlan`, `PrintMap`.
- **Review Focus**: 1, 3 → Task 2; 2 → Task 1 e 2 (e a schermo nel 5); 4 → Task 4; 5 → Task 4 e 5.

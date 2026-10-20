# Dashboard e Alert sicurezza, nuova disposizione — piano di esecuzione

> Si esegue in linea (una sessione che esegue i task in ordine). Le caselle `- [ ]` tengono il conto.

**Obiettivo:** dashboard a 3 colonne come il mockup di Riccardo e pagina «Alert sicurezza» in una
schermata (coda di lavoro a sinistra, analisi a destra), a 1920 px senza scorrere la pagina.
**Architettura:** stessi dati di oggi; cambiano disposizione e componenti di resa. Unica novità di
dato: gli accessi falliti della dashboard leggono gli istogrammi dell'indexer Wazuh (come la pagina
degli alert), tenuti 5 minuti in memoria, con ripiego sulla stima di oggi scritto in vista.
**Spec:** decisioni di Riccardo del 20/10 (sessione `da-ipam-dashboard-estetica`): dashboard A
«3 colonne», alert A «coda + analisi a lato», accessi «indexer con ripiego»; prompt
`~/.claude/prompts/da-ipam-dashboard-estetica.md`.
**Livello di controllo:** leggero (Riccardo, 20/10).

## Vincoli globali

- Una schermata a 1920×1080 per tutte e due le pagine; le liste scorrono dentro il riquadro.
- Testo ≥ 13 px (valori, etichette, badge); niente fasce o frasi di spiegazione: vanno nel `title`.
- Token di stato da `components/shared/stile-stato-modulo.ts` (✓ `#1F7A4D`, ▲ `#FFD400`, ✕ `#8E1B20`,
  ● `#5B6B77`); card di Sicurezza **bianche con striscia sinistra a tinta piena + simbolo** (deciso);
  niente fondi pastello.
- Restano separati Offline / Assenti / Archiviati.
- Stati con doppio segnale (simbolo o trama + colore); verde e rosso mai soli (Riccardo è daltonico).
- Grafici: una serie = un colore + titolo, niente legenda; niente doppio asse nei componenti nuovi.

## Casi da non dimenticare

1. Indexer non configurato o irraggiungibile → dashboard con la stima e la parola «stima» (T1, T3).
2. Wazuh non configurato → card grigia «Wazuh non configurato», non zero (T3).
3. Stats degli alert senza indexer → KPI «—», non 0 (T4).
4. Nessun modulo configurato → riquadro moduli con la sola riga «N non configurati» (T2).
5. Una sola subnet o subnet con 0 host → barra vuota con «0», niente divisione per zero (T2).

## Task 1 — Accessi falliti dall'indexer

**File:** crea `src/lib/security/accessi-indexer.ts`, prova `src/lib/security/__tests__/accessi-indexer.test.ts`.

**Produce:**
```ts
export interface SerieAccessi {
  fonte: "indexer" | "stima";
  ore: { ora: string; falliti: number }[];      // 24 punti, ora italiana «HH», dal più vecchio
  giorni: { giorno: string; falliti: number }[]; // 14 punti, «YYYY-MM-DD» italiano
  totale24h: number;
  totale24hPrima: number;
}
export function accessiDaSerie(serie48h: SeriesRow[], serie14g: SeriesRow[], ora: Date): Omit<SerieAccessi, "fonte">
export async function leggiAccessiIndexer(tenantCode: string): Promise<SerieAccessi | null>
```
- `accessiDaSerie` (pura): dalla categoria `auth_failure` di ogni bucket; le ore mancanti valgono 0;
  le ultime 24 ore piene più l'ora in corso → `ore`; le 24 prima → `totale24hPrima`.
- `leggiAccessiIndexer`: config da `getWazuhConfig()`; senza indexer → `null`. Due `alertStats`
  (`since` 48 h `interval: "1h"`, `since` 14 g `interval: "1d"`), stesse esclusioni della rotta stats
  (`collectSelfIdentity`, `deviceRuleIds`). Cache in memoria per tenant, 5 minuti. Errore → `null`
  e `console.warn("[dashboard] indexer: …")` (niente IP nel messaggio).

**Verifica:** prova vista fallire, poi verde:
`DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/security/__tests__/accessi-indexer.test.ts`
(bucket mancanti, confine 24/48 h, giorno italiano a cavallo di mezzanotte UTC).
**Commit:** `feat(dashboard): accessi falliti dagli istogrammi dell'indexer, stima come ripiego`.

## Task 2 — Componenti della dashboard

**File:** crea `src/components/dashboard/card-sicurezza.tsx`, `barre-subnet.tsx`,
`istogramma-accessi.tsx` (sostituisce `grafico-accessi.tsx`, che si toglie), `moduli-compatti.tsx`.

- `CardSicurezza({ tono, titolo, valore, nota?, href, title? })`: card bianca, `border-l-[6px]` col
  colore pieno del tono, simbolo del tono accanto al titolo (13 px), valore 20 px bold; tono `grigio`
  = striscia tratteggiata grigia, valore in muted.
- `BarreSubnet({ reti })`: lunghezza della barra ∝ `total_hosts / max(total_hosts)`; segmenti online
  (`#1F7A4D` pieno), offline (`#8E1B20` con trama diagonale `repeating-linear-gradient`), sconosciuti
  (grigio chiaro); a destra `online / offline (totale)` 13 px; riga cliccabile verso `/networks/<id>`.
- `IstogrammaAccessi({ ore, giorni, fonte })`: barre sottili (gap 2 px, angoli 2 px) navy
  `#0D2537` / scuro `#A9BECC`; linea tratteggiata della **media** con etichetta «media N»; il
  **picco** con il valore sopra la barra; interruttore 24 ore / 14 giorni; `fonte === "stima"` →
  «stima» accanto al totale col `title` che spiega la ripartizione. `title` per barra.
- `ModuliCompatti({ riquadri })`: riquadri dei moduli configurati (stesso `RiquadroModulo` di oggi,
  spostato qui), poi una riga «N non configurati →» verso `/settings?tab=moduli`.

**Verifica:** `npx tsc --noEmit` e lint sui file; resa nel Task 3.
**Commit:** `feat(dashboard): card di sicurezza, barre delle subnet, istogramma e moduli compatti`.

## Task 3 — Disposizione A della dashboard

**File:** modifica `src/app/(dashboard)/page.tsx`, `src/components/shared/status-over-time-chart.tsx`
(solo le etichette).

- Riga 1: «Dashboard» + indicatori come card basse (Health con anello SVG 36 px e percentuale,
  Subnet, Host, Offline, Assenti > 7 g, Archiviati, Monitorati), stessi link e `title` di oggi.
- Riga 2: le card di Sicurezza in griglia `repeat(6, 1fr)` (Vulnerabilità critiche, alte, Accessi
  falliti 24h, Account bloccati 30g, Alert da gestire, Health AD), stessi toni e soglie di oggi; gli
  accessi 24h e la freccia dalla serie dell'indexer se c'è.
- Riga 3, griglia 3 colonne a tutta altezza: sinistra «Stato host nel tempo» + «Accessi falliti»;
  centro «Host conosciuti offline» (alta quanto il contenuto, max metà) + «Transizioni recenti»
  (riempie e scorre); destra «Subnet» + «Moduli».
- Grafico dello stato host: l'etichetta «Health» diventa «Uptime 24 h» (in testa e nella legenda),
  `title` «host controllati nelle ultime 24 ore; la Health in alto conta gli ultimi 7 giorni».

**Verifica:** resa a 1920×1080 sulla copia (app locale porta 3101): pagina alta 1080, niente testo
fuori dai riquadri. **Commit:** `feat(dashboard): disposizione a tre colonne (Riccardo, 20/10)`.

## Task 4 — Disposizione A di Alert sicurezza

**File:** modifica `security-alerts-client.tsx`, `alert-charts.tsx` (solo ciò che serve),
`src/components/integrations/wazuh-health-band.tsx` (variante `compatta`).

- Testata in una riga: titolo, `WazuhHealthBand compatta` (4 pastiglie: simbolo del tono + nome +
  `headline` nel `title`, clic → impostazioni se non configurato), «aggiornato hh:mm», Auto,
  «Aggiorna ora». Via la frase sotto il titolo. Avvisi «grafici non disponibili» e «ultimo poll
  fallito» in una riga sottile sotto i filtri.
- Filtri in una riga: periodo | sistema | categorie (con conteggio aperti) | Solo aperti.
- KPI in una riga di indicatori bassi (come la dashboard): Alert nel periodo, Eventi aperti, Agent,
  Regole; senza stats → «—» con il motivo nel `title`.
- Corpo a tutta altezza, griglia `minmax(0,1.7fr) minmax(0,1fr)`: sinistra la tabella in
  `ScorrimentoTabella` + `<Table fissa>`; livello come badge a tinta piena dei token (≥12 ✕,
  10-11 ▲, sotto ● neutro); destra «Nel tempo» (`AlertsOverTime`) e sotto linguette «Account ·
  Destinazioni · Origini» (`TargetedAccounts`, `RankedTable`) che scorrono; `DiagnosticStrip` in
  fondo alla colonna destra. Via la torta («Composizione») e le frasi di spiegazione (→ `title`).

**Verifica:** resa a 1920×1080 sulla copia, pagina alta 1080. **Commit:**
`feat(alert): coda di lavoro e analisi a lato in una schermata (Riccardo, 20/10)`.

## Task 5 — Cancello, revisione, rilascio

- Una revisione sola sull'intero diff; si correggono i rilievi.
- Cancello: `npm run lint && npx tsc --noEmit && DA_INVENT_DATA_DIR=$(mktemp -d) npm test && npm run build`,
  esito dal codice di uscita, log nello scratchpad.
- CHANGELOG, CONTEXT §9, `docs/scheda-mappa.md`; `npm run version:release`; `git push origin dev`.
- Hub: in una chiamata a parte `ps -eo pid,args | grep -E "[u]pdate\.sh|[n]ext build"`; se libero
  `scripts/update.sh --restart`; verifica col commit servito.

# STILE-UI — come si disegna una pagina di DA-IPAM

> **Vincolante.** Ogni pagina nuova o rifatta segue questa guida, anche quando la richiesta non
> parla di aspetto. Chi lavora sull'interfaccia la legge **prima** di scrivere codice.
> Decisa da Riccardo il 25/10/2026: «uno stile dovrebbe essere preso in considerazione in modo
> consistente, non solo a richiesta».

## Perché esiste

Ogni sessione partiva da zero, non trovava regole scritte e copiava la pagina più vicina. Così
le pagine venivano piatte, piene di doppioni e con l'informazione principale nascosta; miglioravano
solo quando Riccardo rimandava un suo modello. Questa guida è quel modello, scritto una volta.

**Modello di riferimento:** la console HTML di Riccardo del 24/10 per il sensore trunk
(`console_discovery_l2_trunk_ipam_sensor.html`, nella Library del progetto IPAM-VA), portata sui
colori Domarc. **Non** la pagina «Reti dal trunk» uscita con la v0.9.902: Riccardo l'ha giudicata
molto peggio del modello (doppioni, manca l'elenco degli oggetti rilevati). Colori e regole di
contrasto vengono dal kit di DA-Template (`kit/tokens.css`).

La pagina rifatta sul modello (PR #26, `arp-table/trunk/trunk-client.tsx`) è l'esempio in
codice: i suoi pezzi locali (`Tessera`, `Pannello`…) passeranno a quelli di `console.tsx`.

**Mattoni pronti:** `src/components/shared/console.tsx`. Si usano quelli, non si ridisegnano.

## Le dieci regole

1. **Una cosa si dice una volta.** Un dato, un elenco o un pulsante compare in un punto solo della
   pagina. Se la stessa azione serve in tre posti, il posto giusto è uno: dove si sceglie l'oggetto.
2. **L'elenco degli oggetti è il centro della pagina.** Quello che la pagina mostra (host, MAC,
   reti, finding) sta in una tabella completa, filtrabile e paginata, visibile senza clic.
   Mappe, griglie e grafici sono viste in più, mai al posto dell'elenco.
3. **Si scende per livelli.** Lista a sinistra → dettaglio a destra. Pannelli numerati
   (1. VLAN → 2. Subnet → 3. Oggetti): scegliere al livello 1 filtra il 2 e il 3.
4. **Prima i numeri.** Sotto il titolo, una fila di 3–4 tessere con i conteggi che contano.
5. **Ogni riquadro dice cos'è in una riga.** Titolo + conteggio + una frase. I paragrafi di
   spiegazione vanno nel `title` o nel manuale, non nella pagina.
6. **Valori tecnici in monospazio**: IP, MAC, CIDR, VLAN, porte, interfacce, orari.
7. **Stato = segno + fondo pieno**, mai la sola tinta (Riccardo è daltonico: distingue per
   luminanza e per forma). Ogni colore che codifica qualcosa ha la sua **legenda** accanto.
8. **Ciano per bordi e fondi, mai per il testo** (contrasto 2,7:1). Il testo ciano è
   `text-cian-testo` (#006C96, scuro #3FBBF0). Il giallo solo come fondo, con testo navy.
9. **Testo mai sotto i 13 px.** Niente `text-[10px]`, `text-[11px]`, `text-[0.6rem]`.
10. **Mai una pagina vuota senza perché.** Vuoto, errore e caricamento hanno ognuno il suo
    riquadro (sezione «Stati»).

## Struttura della pagina

```
IntestazionePagina   titolo + una riga + azioni globali
BarraStato           (se i dati vengono da un servizio: acceso/spento, ultima lettura, dove si cambia)
TesseraNumero × 3-4  grid grid-cols-2 lg:grid-cols-4 gap-3
┌ Pannello 1 ────┐ ┌ Pannello 2 (scelte del livello 1) ──────────────────┐
│ VoceSelezionab.│ │ VoceSelezionabile in griglia md:2 xl:3 colonne       │
│ piede: consiglio│ │                                                      │
└────────────────┘ └──────────────────────────────────────────────────────┘
┌ Pannello 3: [Elenco | Mappa /24] + filtri + ricerca ─── tutta larghezza ┐
│ Tabella degli oggetti rilevati (prima vista, sempre)                     │
└──────────────────────────────────────────────────────────────────────────┘
```

- Contenitore: `space-y-4`. Colonne: `grid gap-4 lg:grid-cols-12`, lista `lg:col-span-3`,
  scelte del livello 2 `lg:col-span-9`. Su schermo stretto si impila, non si scorre in orizzontale.
- **La tabella degli oggetti va a tutta larghezza, sotto i livelli**, mai stretta in una colonna
  a destra: lì le colonne si tagliano (Riccardo, 25/10, «Reti dal trunk» PR #26).
- Pagine di elenco semplici (senza livelli): `IntestazionePagina` → tessere (se servono) →
  un `Pannello` con filtri nelle azioni e la tabella dentro.
- Le liste lunghe scorrono **dentro** il pannello (`max-h-[…] overflow-y-auto`, oppure
  `<Table fissa>`), non fanno scorrere la pagina.
- **Schede ben visibili, sempre** (Riccardo, 25/10): una pagina che diventa troppo lunga si divide
  con `SchedePagina`, mai con `Tabs` di `ui/tabs` (alto 32 px, testo grigio: «pulsantini
  microscopici», non si capisce che ci sono). Le schede stanno tutte in vista sotto la barra di
  stato, a tutta larghezza, ognuna con titolo a 16 px, una riga che dice cosa contiene e, se serve,
  il segno degli allarmi. Al massimo 4: se ne servono di più, o se le parti non hanno niente in
  comune, sono voci di menu separate. La scheda scelta sta nell'indirizzo (`#nome`).

## I mattoni (`src/components/shared/console.tsx`)

| Mattone | Quando | Note |
|---|---|---|
| `IntestazionePagina` | sempre, in cima | l'unico `h1` della pagina: `text-2xl font-bold tracking-tight` |
| `BarraStato` | dati che vengono da un servizio o sensore | pallino pieno/vuoto + parola «acceso/spento», dettagli in mono, azione a destra |
| `TesseraNumero` | i 3–4 numeri sotto il titolo | `valore={null}` scrive «—» (non sappiamo), mai 0 finto; `qualifica` accanto al numero, `nota` = la fonte |
| `Pannello` | ogni riquadro | `numero` per i livelli; `azioni` = filtri e pulsanti del riquadro; `piede` = un consiglio |
| `SchedePagina` | dividere una pagina lunga in 2–4 parti | grandi e tutte in vista; scelta = fondo navy e barra ciano; mai `Tabs` di `ui/tabs` |
| `VoceSelezionabile` | voce di una lista che filtra il resto | scelta = bordo ciano + `bg-selezione`; tastiera inclusa |
| `Etichetta` | identificativi corti: «VLAN 20», «GW», «DHCP», «eth1» | `tono="ruolo"` = giallo pieno con navy |
| `Legenda` | accanto a ogni mappa, griglia, barra colorata | stesse classi delle celle che spiega |
| `BarraDivisa` | composizione di un totale (ascolto / giro ARP) | i numeri scritti sopra la barra |
| `SchedaDettaglio` + `DatoDettaglio` | dettaglio della voce scelta | nome sopra, valore sotto; frase guida quando non c'è scelta |
| `Vuoto` | nessun dato | cosa manca **e** cosa fare |
| `InCorso` | operazione lanciata (giro ARP, scansione) | bordo giallo, percentuale se nota |

Già esistenti, da usare così come sono:
`LoadError` (errore di caricamento con «Riprova»), `SkeletonTable` (caricamento),
`Pagination` (anche `inTesta` per metterla nella riga del titolo), `SortableTableHead`,
`Table fissa` (intestazioni ferme), `STILE_STATO` di `stile-stato-modulo.ts` (✓ ▲ ✕ ● –),
`StatusBadge` per lo stato degli host, `CardSicurezza` per le card di stato cliccabili.

## Tabelle

- La prima colonna è l'identità dell'oggetto (IP, nome), in mono e `font-semibold`; i ruoli
  (`Etichetta tono="ruolo"`: GW, DHCP) le stanno accanto, non in una colonna a parte.
- Una colonna = un fatto. Due fatti brevi legati (VLAN • subnet) possono stare insieme.
- «Come è stato trovato» / stato: badge con **pallino + parola**, mai il solo colore.
- Azioni di riga a destra (`text-right`), piccole (`size="sm"`), una o due al massimo.
- Valori mancanti: «—». Date: `gg/mm hh:mm` o relative («3h fa»), mai l'ISO grezzo con la `T`.
- Righe paginate dal server (regola 9 di CLAUDE.md): 50 o 100 per pagina, totale sempre visibile.
- Conteggio nel titolo del pannello o della scheda (`Pannello conteggio={totale}`), non in fondo.

## Filtri e ricerca

- Stanno **nella stessa riga** delle schede o del titolo del pannello (`Pannello azioni`), non
  in una fascia sopra.
- Scelte esclusive con 2–5 voci: pulsanti `size="sm"`, scelto `variant="default"`, gli altri
  `outline`. Più di 5 voci: `Select`.
- Ricerca: `Input` largo `w-56 sm:w-64`, segnaposto che dice cosa si cerca («Cerca IP, MAC,
  produttore, nome»); filtra mentre si scrive quando i dati sono già in pagina, con Invio quando
  chiede al server.
- Un filtro attivo si vede: il pulsante resta pieno, l'`Etichetta` del pannello lo ripete
  («VLAN 20»), c'è sempre «Tutte» per tornare indietro.

## Pulsanti

- Uno solo `variant="default"` (pieno: ciano con testo navy, deciso da Riccardo il 25/10) per
  riquadro: l'azione principale. Mai testo bianco sul ciano (2,7:1). Il resto `outline`;
  `ghost` per le icone in riga; `destructive` solo per cancellare.
- Testo = verbo + oggetto: «Giro ARP su 10.0.20.0/24», «Porta in DA-IPAM». Niente «OK», «Vai».
- Icona lucide a sinistra quando aiuta a riconoscere l'azione; mai icona sola senza `title`.
- Un'azione che non si può fare resta visibile ma `disabled`, con `title` che dice perché
  («Il sensore è spento»).

## Colori

| Uso | Classe / valore |
|---|---|
| Fondo pagina / riquadri | `bg-background` (#EDEDED) / `bg-card` (bianco) |
| Testo / testo secondario | `text-foreground` (navy #0D2537) / `text-muted-foreground` |
| Titoli dei pannelli, qualifiche, link | `text-cian-testo` (#006C96; scuro #3FBBF0) |
| Bordo e fondo «scelto» | `border-primary` + `bg-selezione` |
| Fondo d'accento tenue | `bg-primary/10` con `border-primary/25` |
| Ruolo, attenzione, in corso | `bg-[#FFD400] text-[#0D2537]`, bordo `#C9A800` |
| Stati | `STILE_STATO`: ok #1F7A4D ✓ · attenzione #FFD400 ▲ · guasto #8E1B20 ✕ · da verificare grigio chiaro ● · non configurato tratteggiato – |
| Grafici | `--series-*`, `--host-*`, `--alert-cat-*` di `globals.css` (validati per daltonici) |

- Mai i colori di Tailwind per significato (`bg-green-500`, `text-red-600`, `bg-purple-500`,
  `text-sky-400`…): non sono Domarc e non sono validati per daltonici. Grigi neutri solo tramite
  i token (`muted`, `border`).
- Mai verde e rosso da soli per distinguere due stati; mai rosa e verde tenui (stessa luminanza).
- Il tema scuro deve funzionare: si usano token o si scrive anche la variante `dark:`.

## Testo e spazi

- Scala: titolo pagina `text-2xl font-bold`; titolo pannello `text-[13px] font-bold uppercase
  tracking-wider text-cian-testo`; corpo `text-sm` (14 px); secondario `text-[13px]
  text-muted-foreground`; numeri grandi `text-2xl font-bold font-mono tabular-nums`.
- Minimo 13 px (`text-[13px]`). `text-xs` (12 px) solo dentro `Badge`, già così nel componente.
- Spazi: fra blocchi `gap-4`/`space-y-4`; dentro un pannello `p-3`/`p-3.5`; fra voci `gap-2`/`space-y-2`.
- Angoli: riquadri `rounded-xl`, voci interne `rounded-lg`, etichette `rounded-md`.
- Interfaccia in italiano, frasi brevi e concrete. Parole del cliente, non del codice
  («giro ARP», non «sweep»; «visto in ascolto», non «PASSIVE»).

## Stati

| Situazione | Cosa si mostra |
|---|---|
| Caricamento | `SkeletonTable` o scheletro della stessa forma; mai la pagina bianca |
| Errore | `LoadError what="le osservazioni del trunk" message=… onRetry=…`; **mai** «nessun dato» al posto di un errore |
| Vuoto perché il servizio è spento | `BarraStato acceso={false}` + `Vuoto` con l'azione per accenderlo |
| Vuoto davvero | `Vuoto titolo="Nessun MAC visto finora" testo="Il sensore legge ogni 5 minuti…"` |
| Numero sconosciuto | «—» (`TesseraNumero valore={null}`), mai 0 |
| Operazione lanciata | `toast.success` subito + `InCorso` finché dura |

## Sì / no, con esempi veri

| Sì | No |
|---|---|
| Una tabella «3. Oggetti rilevati» con IP, MAC, produttore, VLAN, come, nome, ultima vista | Solo la mappa /24 a 256 caselle (prima versione di «Reti dal trunk», v0.9.902) |
| «Giro ARP» una volta, sulla voce della subnet | Lo stesso pulsante nella voce, nella scheda di dettaglio e nella matrice |
| Gateway e IP della subnet scritti una volta, nella voce della subnet | La stessa riga «N IP · gw …» ripetuta nella lista e nella tabella «Nel tempo» |
| `TesseraNumero titolo="MAC unici" valore={166} nota="senza leggere il router"` | Una `Card` con tre `<p>` scritti a mano, diversa in ogni pagina |
| `Pannello numero={2} titolo="Subnet" conteggio={7} sottotitolo="Scegli una subnet o lancia un giro ARP"` | `CardTitle className="text-base"` e sotto un paragrafo di quattro righe |
| `Etichetta tono="ruolo">GW</Etichetta>` accanto all'IP | Una colonna «Ruolo» quasi sempre vuota |
| Badge «● visto in ascolto» / «▲ trovato col giro ARP» + `Legenda` | Celle colorate senza legenda; `bg-emerald-500` contro `bg-red-500` |
| `text-[13px]` per le note | `text-[10px]`, `text-[0.6rem]` |
| `text-cian-testo` per una qualifica | `text-[#00A7E7]` o `text-sky-400` su fondo bianco |

## Prima di aprire la PR

- [ ] La pagina usa `IntestazionePagina` e i mattoni di `console.tsx` dove servono.
- [ ] Ogni dato, elenco e pulsante compare una volta sola.
- [ ] L'elenco completo degli oggetti è visibile senza clic.
- [ ] Nessun colore Tailwind «di significato», nessun testo sotto 13 px, nessun ciano come testo.
- [ ] Ogni colore che codifica qualcosa ha la legenda; gli stati hanno il segno.
- [ ] Caricamento, errore e vuoto provati (anche a servizio spento).
- [ ] Guardata in tema chiaro **e** scuro, a 1920 px e a 1280 px.
- [ ] Se c'è un modello di Riccardo, messo accanto alla pagina finita e confrontato voce per voce.

## Pagine da rifare in seguito

Misurate il 25/10 contando colori Tailwind fuori palette e testo sotto 13 px (più alto = peggio).
Non si toccano ora: si rifanno una alla volta, ciascuna nel suo lavoro.

| Pagina / componente | Problema principale |
|---|---|
| `arp-table/trunk` (Reti dal trunk) | doppioni, manca l'elenco degli oggetti — **in rifacimento** sul modello |
| `devices/[id]/page.tsx` | 23 colori fuori palette, 34 testi sotto 13 px |
| `discovery/page.tsx` | 61 colori fuori palette, 16 testi minuti, 3200 righe in un file |
| `components/scheda/dettagli/sistema.tsx`, `rete.tsx` | testo minuto ovunque (29–39 casi) |
| `components/settings/scanner-edge-card.tsx`, `wazuh-card.tsx`, `integration-card.tsx` | stati in verde/rosso Tailwind |
| `components/hosts/host-software-card.tsx`, `host-wazuh-card.tsx` | colori fuori palette e testo minuto |
| `active-directory/page.tsx` | 32 colori fuori palette |
| `dhcp/sources`, `services`, `launchpad`, `analytics`, `settings/transfer` | colori fuori palette, intestazioni diverse |
| tutte | il titolo `h1` ha 10 forme diverse: passare a `IntestazionePagina` |

Per rifare l'elenco: `for f in $(find "src/app/(dashboard)" src/components -name "*.tsx"); do …`
contando `(bg|text|border)-(gray|slate|red|green|blue|…)-[0-9]+` e `text-\[(8|9|10|11|12)px\]`.

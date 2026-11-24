# Tavola di cablaggio — contesto per chi la modifica

> Da passare all'agente insieme alla richiesta. Scritto il 24/11/2026 sul codice di `dev` (ultimo rilascio che tocca il
> modulo: v0.9.1329). In caso di differenza vince il codice. Dove spec e codice non coincidono, vedi §6.

**Repo** `/Users/riccardo/Progetti/Domarc/DA-IPAM`, ramo `dev`. **Pagina** `/topology/tavola`, dal link «Tavola di
cablaggio» nella Topologia. **Spec** `docs/superpowers/specs/2026-11-23-tavola-di-cablaggio-design.md`. **Aperti** in
`TASKS.md`, sezione «2026-11-23 — Idea: la "tavola di cablaggio"…».

## 1. Cos'è

Seconda vista della Topologia: ogni apparato è un pannello di porte, sotto ogni porta è scritto dove va, i cavi corrono
nei corridoi fra le file. Risponde a «cosa c'è sulla porta 17 di quello switch, e dov'è l'altro capo?».

Decisioni di Riccardo (23/11), da non riaprire: sede → armadio; ordine automatico (niente posizioni a mano); hub e
appliance; **sola lettura** (un cavo si corregge nella Topologia). Non comprende le viste «Servizi» e «Sedi» (TASKS).

## 2. Percorso dei dati

```
modelloDellaMappa(staleDays)         lib/topology/mappa-server.ts   lo stesso di /api/topology/model
  → ritagliaSito(model, sito)        tavola/api.ts                  nodi e collegamenti che toccano il sito
  + getTopologyTavolaPorte(ids)      lib/db-tenant.ts               porte di tutti gli apparati del sito
  = TavolaView                       GET /api/topology/tavola       requireAuth + withTenantFromSession, NO_STORE
────────────────────────────── da qui nel browser ──────────────────────────────
  → componiTavola                    tavola/componi.ts              tipo e destinazione di ogni porta, cavi
  → disponiEInstrada                 tavola/righe.ts + instrada.ts  righe entro la larghezza, polilinee
  → TavolaClient → TavolaSvg         components/topology/tavola/
```

- `?site=` assente → la prima sede; `0` → «Senza sede» (apparati con `siteId` null); non numerico → 400.
- `getTopologyTavolaPorte` fa **una** query `IN` su `switch_ports`; per chi non ha righe usa `hypervisorNics` (scansione
  Proxmox). Non introdurre query per apparato.
- I dati si caricano all'apertura e al cambio di sede: nessun aggiornamento periodico.

## 3. File

| File | Cosa fa | Si tocca per |
| --- | --- | --- |
| `src/lib/topology/tavola/tipi.ts` | `PortaTavola`, `TavolaView`, `TipoPorta`, `PortaComposta`, `ApparatoComposto`, `CavoComposto` | un dato nuovo su una porta |
| `…/tavola/api.ts` | `parseSitoTavola`, `ritagliaSito`, `nelSito`, `SENZA_SEDE` | scelta della sede |
| `…/tavola/componi.ts` | `componiTavola`, `tipoCollegamento`, `rangoDi`, `eRete`, `eServer`, `numeroCorto` | tipo, destinazione, ruolo |
| `…/tavola/righe.ts` | `GEO` (misure), `ordina`, `posaApparato`, `disponi` | misure, ordine, a capo |
| `…/tavola/instrada.ts` | `instrada`, `disponiEInstrada` | percorso dei cavi |
| `…/tavola/ricerca.ts` | `cercaInTavola`, risultati in ordine di vista | cosa trova la ricerca |
| `…/tavola/__tests__/tavola.test.ts` | 8 prove, dati inventati | prove nuove in aggiunta |
| `src/lib/db-tenant.ts` | `getTopologyTavolaPorte` | colonne lette |
| `src/app/api/topology/tavola/route.ts` | la rotta | risposta |
| `src/components/topology/tavola/tavola-client.tsx` | stato, barra, ricerca, fuoco, riquadro del collegamento | comportamento della pagina |
| `…/tavola-svg.tsx` | disegno: telai, porte, etichette, graffe, cavi | aspetto |
| `…/porta-svg.tsx` | `SegnoPorta`, motivo a righe | la forma della porta |
| `…/stile-tavola.ts` | `STILE_PORTA`, `STILE_CAVO`, `NOME_TIPO`, `ORDINE_TIPI` | colori, tratti, nomi |
| `…/riquadro-scelta.tsx` | riquadro fisso del collegamento o della porta scelta | cosa si legge di un cavo o di una porta |
| `…/legenda.tsx` | legenda | segue `ORDINE_TIPI` |
| `src/app/(dashboard)/topology/tavola/page.tsx` | monta `TavolaClient` | quasi mai |

(`…/` = la stessa cartella della riga sopra.) `lib/topology/tavola/` è logica pura: **niente import del database**,
perché gira anche nel browser e nelle prove.

## 4. Regole del dominio

**Tipo della porta.** Con un collegamento decide `tipoCollegamento`, uguale dai due capi, nell'ordine: `linea` (WAN o
altro capo fuori sede) → `trunk` (fascio, o due apparati di rete) → `server` (un capo hypervisor o server) → `trunk`
(altri due apparati) → `client`. Senza collegamento, nell'ordine: `libera` (down o disabled) → `client` (al più un MAC,
con nome o IP) → `molti` (più MAC) → `attiva` (accesa, nessun dato).

- **`dubbio` non è un tipo**: è un segno sopra il tipo. Vale per collegamento `stale`, `porteDaVerificare`, o porta giù.
- **Più MAC non vuol dire trunk 802.1Q**: si scrive «N MAC».
- **Porta fantasma**: nome di porta citato da un collegamento ma assente dall'elenco. Resta visibile in fondo, più chiara.
- **Fascio**: un cavo per membro (id `<collegamento>#<i>`), uniti da una graffa.
- **Più collegamenti sulla stessa porta**: si scrive il primo e «(+N)».
- **Solo i cavi con tutti e due i capi nella tavola sono disegnati**; gli altri restano scritti sotto la porta.
- Le porte si abbinano con `elencoDa`, `indiciInElenco` e `normale` di `lib/topology/cavi/porte.ts`: non farne una copia.

**Disposizione.** Armadio (senza armadio in fondo) → rango (0 router e firewall, 1 core, 2 accesso, 3 hypervisor e
server, 4 il resto) → nome. Oltre 24 porte due file; oltre 28 riga propria; una riga non mescola due armadi.

**Cavi.** Fra file adiacenti una corsia del corridoio (alto 30 + 8 × corsie); fra file lontane si passa dal bordo,
senza attraversare gli apparati; nella stessa fila il corridoio sotto. Due cavi non stanno sullo stesso tratto.
Le corsie di bordo tolgono larghezza: per questo `disponiEInstrada` ripete l'a capo (al massimo altre due volte).

## 5. Vincoli dell'interfaccia

Leggi `docs/STILE-UI.md` (vincolante). In più, per questa pagina:

- **Riccardo è daltonico**: ogni tipo si distingue per forma, tratto o luminanza; mai solo per tinta.
- **Il fuoco abbassa solo i cavi** (`SPENTO_CAVI` 0,25). Porte, scritte e telai restano pieni. Riccardo ha respinto due
  volte le versioni che sbiadivano il resto («scompare praticamente tutto», «è ancora quasi invisibile»).
- Solo token del tema, contrasto del testo almeno 4,5:1, testo almeno 13 px.
- Si ragiona a 1920, niente telefono. La pagina non scorre in orizzontale: sotto 1240 px scorre il riquadro.
- Barra in una riga, niente fasce in cima. Etichette vere: «Sede», «Mostra porte libere», «Trova porta o apparato»,
  «Topologia», «Per correggere questo cavo: Topologia».
- Scelte ricordate in `localStorage`: `topologia.tavola.sito`, `topologia.tavola.libere`.
- Posizioni e calcoli stanno in `righe.ts`/`instrada.ts`; in `tavola-svg.tsx` solo il disegno.

## 6. Dove il codice è diverso dalla spec

- La rotta dà anche `nodi`, `collegamenti` e `siti` (la spec: solo le porte); `site` è facoltativo.
- `getTopologyTavolaPorte` prende gli id degli apparati, non il sito.
- Tipo in più `attiva`; `dubbio` è un segno. Sede «Senza sede» aggiunta: l'hub non ha sedi nella mappa.
- Il clic sul nome porta a `/devices/<id>`, non a `/objects/<id>` (che vuole l'id dell'host).
- Il clic su una porta o un cavo apre un riquadro breve, non il pannello completo della Topologia.
- Fuoco: vale il §5, non il 10 % della spec.

## 7. Aperto e non provato

Aperto: nome dell'armadio sopra le sue righe (il modello ha solo `rackId`); filtro per armadio oltre 80 apparati;
pannello completo del collegamento; preferire il bordo con meno cavi. Non si fanno senza richiesta.

**Mai guardati**: tema scuro, ricerca, un'istanza con sedi vere (sull'hub c'è solo «Senza sede»).

## 8. Come si lavora

- Altre sessioni usano lo stesso albero: mai `git add -A`, `git reset --hard`, `stash` o cambio di ramo; si rilegge
  `git diff <file>` e si mette in stage file per file.
- **Mai push su `main`**: è un rilascio alle appliance dei clienti, lo promuove Riccardo.
- Repo pubblico: nelle prove e nei documenti nomi, IP e MAC inventati. Le prove esistenti non si cambiano per farle passare.
- Livello base, verifica entro 2 minuti:

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM && node --import tsx --test src/lib/topology/tavola/__tests__/tavola.test.ts
```

  Poi `npx eslint` sui file toccati e `npx tsc --noEmit` (errori in `.next/types` = file generati vecchi, non il codice).
- Rilascio: una riga in `CHANGELOG.md`, `npm run version:release -- --staged-only`, `git push origin dev`. L'hub si
  aggiorna da solo entro 15 minuti; si controlla che sia arrivato il **proprio** commit, non un numero di versione.
- Se cambia il layout: una schermata a 1920 sull'hub, con l'utente in sola lettura `prova-claude` (password in
  `~/.config/da-ipam/hub-utenza-prova.txt`, letta da uno script e mai stampata).

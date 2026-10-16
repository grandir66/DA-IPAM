# Mappa topologia — «Unisci con…» e «Separa…»: un apparato con più indirizzi diventa un oggetto solo, a mano — piano di esecuzione

> Si esegue con la skill `subagent-driven-development`, livello **completo**, in questa sessione (decisione di Riccardo del
> 16/10). Le caselle `- [ ]` tengono il conto. Il codice è scritto qui solo dove la logica è sottile (la regola dell'indice
> dei nodi, la migrazione, i tipi condivisi); altrove file, firme, valori, testi e prove. Righe citate: `origin/dev` alla
> v0.3.309, riverificate il 16/10.

**Obiettivo:** dire **a mano** «questi indirizzi sono lo stesso oggetto» («Unisci con…») e toglierlo («Separa…»), nella
mappa, nella scheda e nella Discovery. Caso di partenza: il NAS dell'hub, tre host su tre reti con tre MAC diversi, oggi tre
nodi; dopo l'unione un nodo solo, coi collegamenti di tutti e tre.

**Architettura:** due tabelle nuove nel DB del cliente, `topology_unioni` (gruppi) e `topology_separazioni` (coppie che non
si fondono da sole), mai cancellate. L'ingresso del modello le porta (`unioni`, `separazioni`) **solo se ci sono righe**, e
le applica un punto solo, `buildNodeIndex`, che è l'indice dei nodi di **tutte e due** le mappe (`model.ts:35` per T1,
`cavi/modello.ts:34` per T3): le separazioni tolgono fusioni automatiche deboli, le unioni si applicano **dopo** tutte le
regole automatiche. Collegamenti, correzioni, ★, posizioni e ritocchi seguono da soli perché passano già da `canonical`.
Quattro rotte con anteprima obbligatoria, un dialogo per i tre posti. Scansioni, credenziali e `physical_device_id` non si
toccano.

**Tech Stack:** Next.js 16 / React 19 / TS strict, better-sqlite3, `node --import tsx --test`, Zod v4, shadcn v4 su `@base-ui/react`.
**Spec:** nessuna a parte: le decisioni di Riccardo qui sotto e le «Scelte». Riferimenti: `specs/2026-10-12-topology-map-design.md`
§10.4 (righe 332-334: «Unire o separare a mano due oggetti resta fuori dalla fase 2 (servirebbe una tabella…)»),
`specs/2026-10-14-topologia-collegamenti-reali-design.md` §13; ADR 0015, 0018, 0020. **ADR nuovo: 0021** (il primo libero).
**Livello di controllo:** **completo** (Riccardo, 16/10): cambia il modello di T1 e quello per cavo di T3 (acceso su hub e
cliente A dal 16/10) e scrive nel DB dei clienti.

## Le decisioni di Riccardo (16/10) — non si riaprono

1. **Nessuna regola automatica nuova**: si unisce **solo a mano**.
2. «Unisci con…» e «Separa…» in **tre posti**: mappa (tasto destro su un nodo), scheda (`/objects/[id]`), l'elenco di host e
   apparati (la **Discovery**, Scelte 10).
3. Esecuzione **in questa sessione** coi subagent, livello completo; **rilascio a parte**, con la sua conferma; prima del
   rilascio l'elenco per nome di ciò che si unirebbe sulle copie vere (nessuno) e che cosa la misura controlla (Task 7).

## Fatti di partenza (verificati nel codice)

1. **Schema.** `physical_devices` (`db-tenant-schema.ts:275`), `device_interfaces` (`:296`), `device_interface_addresses`
   (`:314`); `physical_device_id … ON DELETE SET NULL` su `hosts` (`:130`) e `network_devices` (`:255`); `multihomed_links`
   (`:477`) serve alla deduplica delle scansioni e all'icona della Discovery, **la topologia non la legge**.
2. **Il collegamento a mano di oggi è per le scansioni:** `manualLinkHostsToPhysicalDevice` (`devices/physical-device-db.ts:308`,
   rotta `/api/physical-devices/link`) scrive solo `hosts.physical_device_id` e ricalcola `multihomed_links` (`:405-410`).
   UI: `components/devices/link-ips-dialog.tsx`, «Stesso device fisico» (`discovery/page.tsx:2051-2056`), «IP collegati allo
   stesso device fisico» (`objects/[id]/page.tsx:1875-1945`).
3. **Il risolutore scrive `physical_device_id` da solo**: `resolvePhysicalDevice` (`devices/identity-resolver.ts:182`) aggancia
   l'apparato (`:231`) e crea o **ri-punta** un host per ogni IP letto (`ensureHostForIp` `:163-180`, sovrascrittura `:168-170`).
4. **`buildNodeIndex`** (`topology/node-index.ts:73-261`). Un host entra in un apparato per `host_id` (`:99`), IP di gestione
   (`:100`), `physical_device_id` dell'apparato (`:101`), MAC vero di un solo apparato (`:117-141`), nome annunciato solo per
   `IDENTITY_TYPES` (`:142-161`); gli host rimasti si raggruppano per MAC e nome con OUI compatibili (union-find `:162-194`,
   rappresentante l'id più basso `:195-215`). Host con lo stesso `physical_device_id` **senza** apparato non si fondono; **due
   apparati mai**. Gli assorbiti vanno in `idx.alias` → `model.canonical` (`model.ts:141`).
5. **Chi passa da `canonical`:** correzioni (`links.ts:228-233`, capi uguali saltati; `ignorati.ts:39`), ★ e tipo
   (`link-attrs.ts:140-144`), mappe salvate e ritocchi (`map-view.ts:31-46`), modello per cavo (`cavi/prove.ts:481`,
   `cavi/mappa.ts:145`, `:164`, `:238`), pagina (`topology-map-client.tsx:297`). I vicini di un apparato che non è un nodo si
   scartano (`links.ts:241-243`); `src/lib/topology/` costruisce `dev:${…device_id}` in **61 punti**.
6. **Chiamanti di `buildNodeIndex`** fuori dalle prove: `model.ts:35`, `misura.ts:39`, `:192`, `:296`, `:308`,
   `cavi/modello.ts:34`, `scripts/misura-vm.ts:68`; nelle prove 49, con quattro argomenti.
7. **La pagina per cavo sceglie i campi di T1 uno per uno** (`cavi/mappa.ts:272-280`).
8. **Impronte:** `PRIMA_DI_T2` (`__tests__/cavi-ombra.test.ts:30-44`) = sha256 del modello intero e dell'albero
   (`support/impronta.ts:16-25`) su sette reti: un campo in più, anche vuoto, le cambia.
9. **Menu** `map-menus.ts:59-86` (voci `:81-84`), azioni `topology-map-client.tsx:322-337`; `map-menus.test.ts:46-73`
   confronta gli elenchi interi.
10. **Elenchi:** la Discovery è «l'entrypoint unico per host/device» (`shared/sidebar.tsx:398-402`); «Asset» elenca asset NIS2.
11. **Guardie:** censimento `permessi/rotte.ts`; `__tests__/api-auth-guards.test.ts:60-77`; `docs/auth-matrix.md` generata.
12. **Trasferimento:** ogni tabella del tenant in `transfer/table-registry.ts`, o `registry.test.ts:32-40` fallisce.
13. **Migrazioni della topologia** (`migrateTopologyCavi`, `db-tenant.ts:502-532`, chiamata `:2018-2036`): additive,
    idempotenti, una transazione; CREATE anche nello schema (`DDL_TOPOLOGY_CAVI`, schema `:18`, `:876`), indici solo nella
    migrazione; presenza annotata all'apertura (`schemaCaviPresente`, `:5174-5190`).

## Vincoli globali

- **Livello completo:** prova scritta prima e **vista fallire** (uscita rossa nel resoconto), poi codice, poi verde. Esito dal
  codice d'uscita (`cmd > "$LOG" 2>&1; echo "exit=$?"`), log nello scratchpad di chi esegue, mai in `/tmp` con nome fisso.
- **Solo a mano.** Scrivono le tabelle solo le due rotte di scrittura con `applica: true`, chiamate da un admin; nessuno
  script le scrive nel DB di un cliente (`misura-cavi` le aggiunge in memoria). Un'unione non trascina fusioni automatiche.
  I `physical_device_id` di oggi, anche quelli messi a mano per le scansioni, **non si convertono**.
- **Niente righe = la mappa di oggi, bit per bit, nelle due mappe — il cancello del rilascio.** Senza righe l'ingresso non ha
  `unioni`/`separazioni` e il modello non ha `unioni`; le 7 impronte `PRIMA_DI_T2` non cambiano (`git diff origin/dev --
  src/lib/topology/__tests__/cavi-ombra.test.ts src/lib/topology/__tests__/support/impronta.ts` vuoto); con elenchi vuoti
  passati a mano le impronte sono le stesse (Task 1); `misura-cavi` sulle copie dà impronte e padri uguali col codice di prima
  e con quello nuovo, a mappa per cavo spenta e accesa (Task 7). A fine tappa
  `git diff --stat origin/dev -- src/lib/topology/{links,attach,link-attrs,ignorati,vm-ports,vms,sites,map-view}.ts` è vuoto.
- **Una regola, due mappe:** la fusione si decide solo in `buildNodeIndex`; ogni chiamante fuori dalle prove usa
  `indiceDeiNodi(input)` (lucchetto, Task 1).
- **Dato:** tabelle e indici del Task 2, righe attive = `tolto_il IS NULL`, togliere = `tolto_da`/`tolto_il`, **mai `DELETE`**.
  Membri `host:N` o `dev:N` (regex `^(host|dev):[1-9]\d{0,9}$`); in una separazione `membro` è sempre `host:N`. Gruppo nuovo
  `MAX(gruppo) + 1` dentro la transazione; in memoria gruppi negativi.
- **Rotte:** `GET /api/topology/unioni?oggetto=`, `GET /api/topology/unioni/candidati?da=&q=` (`requireAuth`); `POST
  /api/topology/unioni`, `POST /api/topology/unioni/separa` (`requireAdmin`, anche l'anteprima). Guardia prima istruzione
  dentro `withTenantFromSession`; Zod `.strict()` con `BODY_STRETTO` di `api-input.ts`; `applica` **obbligatorio**; 2-20 membri
  distinti; ricerca da 2 caratteri, 20 risultati più «+ altri N». Nessun `await` fra lettura delle righe e scrittura; la
  scrittura verifica che ogni riga da togliere sia ancora attiva (409 «cambiato»).
- **Storia:** chi e quando nelle righe (`actorOf(s)`), nessun registro in più; errori nel journal con
  `console.error("[topology] unioni: …")`, solo il messaggio.
- **Interfaccia:** testo **≥ 13 px** nei pezzi nuovi (niente `text-xs`/`text-[10px]`); **mai il solo colore** (Riccardo è
  daltonico); italiano, con le parole di `unioni-tipi.ts`; verifica una volta a 1280 e 1920; niente fasce sopra la mappa.
- **Regole del repo:** `db-tenant` solo con import statico (ADR 0002), mai sotto un componente client (solo
  `unioni-server.ts` lo importa, e lo importano solo le rotte); `JSON.parse` in `try`; niente N+1, `any`, `console.log`.
- **Repo pubblico:** niente nomi, IP, MAC veri in codice, prove, commenti, commit, documenti; fixture `02:00:…`; copie e
  schermate nello scratchpad, elenchi per nome **solo in chat**.
- **Ogni push su `dev` è un rilascio al cliente A entro 15 minuti** (CONTEXT §3), qui con una migrazione additiva: su `dev`
  solo al Task 10, con la conferma. «Rilasciato» = `ActiveEnterTimestamp` dopo il push, riga d'avvio, riga «nuovo commit su
  origin/dev» di `da-ipam-update`, riga della migrazione per tenant; mai `/api/version`. Orari in ora italiana (UTC+2 fino
  al 25/10 alle 3:00, poi UTC+1).
- **Esecuzione:** come nella sezione «Esecuzione»; mai `git add -A`, un commit per task. `credential-chains`, `parita-gruppo0`,
  `ssh-connessione-caduta`, `chiave-ssh-percorsi` cadono a caso (CONTEXT §5): si rilanciano da sole e il resoconto lo dice.

## Casi da non dimenticare

1. **Un membro promosso dopo l'unione** (`host:‹b›` → apparato): il gruppo si risolve nel nuovo apparato, che prende il nodo;
   posizioni, ★ e correzioni seguono dall'alias. Togliere l'apparato lascia il suo host e l'unione resta → Task 1, Scelte 3.
2. **Un membro sparito** (host o apparato cancellati): meno di due membri esistenti = niente; il mancante si conta
   (`unioni.mancanti`) e la scheda lo dice; mai un errore → Task 1, 3, 6.
3. **Un'unione che diventa «due apparati»**: non si applica (la mappa resta com'era prima dell'unione) e lo dicono scheda e
   dettagli (`unioni.nonApplicate`): mai un ripiego muto, mai un'unione a metà → Task 1, 5, 6.
4. **«Separa» su un membro col suo gemello automatico** (`host:‹b›` unito a un apparato, `host:‹c›` stesso MAC): escono
   insieme e l'anteprima lo dice; in un nodo di soli host una catena che passa dal separato si spezza, e l'anteprima la
   mostra → Task 3.
5. **«Unisci» dopo un «Separa» fra gli stessi oggetti:** le separazioni fra chi finisce insieme si tolgono (con la storia) e
   l'anteprima le elenca con la data → Task 3.

---

## Esecuzione

Ramo d'unione `topologia/unioni-a-mano` da `origin/dev`, worktree `$SCRATCH/ipam-unioni`; il secondo agente di un'ondata in
`$SCRATCH/ipam-unioni-b` su `topologia/unioni-a-mano-<task>`; a fine ondata la sessione principale unisce (`git merge --no-ff`),
lancia le prove toccate e `npx tsc --noEmit`. Dopo ogni task di zona rossa una revisione Opus prima di unirlo.

| Ondata | Agente A | Agente B | Dopo (sessione principale) |
| --- | --- | --- | --- |
| 0 | — | — | P1, P2, **P3** (tipi, commit), **Task 0** |
| 1 | Task 1 — regola · **Opus**, zona rossa | Task 2 — dato · **Opus**, zona rossa | due revisioni; unione |
| 2 | Task 3 — decisioni, rotte, misura · **Opus**, zona rossa | Task 4 — dialogo · **Sonnet** | revisione del 3; unione |
| 3 | Task 5 — mappa · **Sonnet** | Task 6 — scheda e Discovery · **Sonnet** | unione |
| — | Task 7 (misure), 8 (schermo), 9 (revisione finale, documenti, cancello) | | |
| — | Task 10 (conferma e rilascio), 11 (la prima unione sull'hub), con Riccardo | | |

**Perché.** P3 mette i tipi prima: 1 e 2 partono insieme su file disgiunti; il 3 vuole 1 e 2, il 4 solo P3, il 5 e il 6 il 4.
Unica fermata prevista: il NAS fatto di due apparati (Task 0). Un difetto di regola o rotte trovato da Sonnet va a un Opus.

---

## Parte 0 — Sessione principale

- [ ] **P1 · Worktree e piano.**

```bash
REPO=~/Progetti/Domarc/DA-IPAM
git -C "$REPO" fetch origin
git -C "$REPO" worktree add "$SCRATCH/ipam-unioni" -b topologia/unioni-a-mano origin/dev
cp "$SCRATCH/ipam-t3/docs/superpowers/plans/2026-10-16-apparati-multihomed-unisci.md" "$SCRATCH/ipam-unioni/docs/superpowers/plans/"
git -C "$SCRATCH/ipam-unioni" add docs/superpowers/plans/2026-10-16-apparati-multihomed-unisci.md
git -C "$SCRATCH/ipam-unioni" commit -m "documenti: piano delle unioni a mano (multihomed)"; echo "piano exit=$?"
cd "$SCRATCH/ipam-unioni" && npm ci > "$SCRATCH/npm-ci-unioni.log" 2>&1; echo "exit=$?"
# il codice di prima, per il Task 0 e il Task 7 (se esiste già: git -C "$SCRATCH/ipam-dev" checkout --detach origin/dev)
git -C "$REPO" worktree add --detach "$SCRATCH/ipam-dev" origin/dev
cd "$SCRATCH/ipam-dev" && npm ci > "$SCRATCH/npm-ci-dev.log" 2>&1; echo "exit=$?"
```

  Atteso `exit=0`. Per il secondo agente: `git -C "$REPO" worktree add "$SCRATCH/ipam-unioni-b" -b topologia/unioni-a-mano-<task> topologia/unioni-a-mano` e `npm ci`.

- [ ] **P2 · Copie fresche** dell'hub e del cliente A con la **procedura P6 del piano di T2** (rimanda a P3 di T1):
  `sqlite3 <db> ".backup '/var/tmp/copia-<tenant>.db'"` in sottofondo con `nohup` e log (il salto via `192.168.40.4` cade nei
  comandi lunghi; l'hub si raggiunge diretto), `sha256sum` uguale sui due lati, `rm` della copia sul server, `PRAGMA
  quick_check` sul Mac. In `$SCRATCH/copie/`; l'ora UTC di ogni copia (`ADESSO`) va in ogni misura con `--adesso`.

- [ ] **P3 · I tipi condivisi**, un commit prima dell'ondata 1. `src/lib/topology/unioni-tipi.ts` **così**:

```ts
/** Unioni e separazioni a mano (piano 2026-10-16, ADR 0021): tipi e parole fra DB, indice, rotte e dialoghi. Nessun import. */

/** Perché un host sta nel nodo di un altro oggetto: le regole di node-index.ts, in ordine. */
export type ComeFuso = "host_dell_apparato" | "stesso_ip" | "stesso_apparato_fisico" | "stesso_mac" | "stesso_nome" | "a_mano";
/** Gli indirizzi dell'apparato stesso: non si separano. */
export const NON_SEPARABILI: ReadonlySet<ComeFuso> = new Set<ComeFuso>(["host_dell_apparato", "stesso_ip"]);

export interface ModelUnioneRow { gruppo: number; membro: string }
/** `membro` («host:N») non si fonde da solo con `altro` («dev:N» o «host:N»). */
export interface ModelSeparazioneRow { membro: string; altro: string }
export interface RigaUnione extends ModelUnioneRow { id: number; creato_da: string; creato_il: string }
export interface RigaSeparazione extends ModelSeparazioneRow { id: number; creato_da: string; creato_il: string }
/** Che cosa scrivere in una transazione; le righe «nuovo» hanno lo stesso gruppo nuovo. */
export interface PianoUnioni {
  togliUnioni: number[]; togliSeparazioni: number[];
  aggiungiUnioni: Array<{ gruppo: number | "nuovo"; membro: string }>;
  aggiungiSeparazioni: Array<{ membro: string; altro: string }>;
}
/** Nel modello solo se l'ingresso ha righe. */
export interface InfoUnioni {
  aMano: Record<string, number[]>; // nodo → host entrati a mano
  nonApplicate: Array<{ gruppo: number; membri: string[]; motivo: string }>;
  mancanti: string[];
  separazioni: number;
}

export interface OggettoDaUnire { id: string; nome: string; tipo: "apparato" | "host"; indirizzi: string[]; bloccato: string | null }
export interface CandidatiUnione { candidati: OggettoDaUnire[]; altri: number }
export interface MembroDelNodo {
  id: string; nome: string; ip: string | null;
  come: ComeFuso | "oggetto"; // «oggetto» = l'apparato del nodo o il rappresentante di un nodo di soli host
  separabile: boolean; perche: string | null; aMano: { da: string; il: string } | null;
}
export interface StatoDelNodo {
  oggetto: string; nodo: string; nome: string; membri: MembroDelNodo[];
  nonApplicata: { membri: string[]; motivo: string } | null; mancanti: string[];
  disponibile: boolean; // false = tabelle assenti su questo cliente
}
export interface AnteprimaUnione {
  nodo: string; nome: string; entrano: Array<{ id: string; nome: string; perche: string }>;
  separazioniTolte: Array<{ membro: string; altro: string; il: string }>; scritto: boolean;
}
export interface AnteprimaSeparazione {
  resta: { nodo: string; nome: string; membri: string[] };
  escono: Array<{ nodo: string; nome: string; membri: string[] }>; scritto: boolean;
}
export interface CorpoUnione { membri: string[]; applica: boolean }
export interface CorpoSeparazione { nodo: string; membro: string; applica: boolean }

export const LIMITE_CANDIDATI = 20;
export const MIN_CARATTERI_RICERCA = 2;
export const MAX_MEMBRI_UNIONE = 20;

export const PAROLA_COME: Readonly<Record<ComeFuso, string>> = {
  host_dell_apparato: "indirizzo dell'apparato",
  stesso_ip: "stesso IP con cui si gestisce l'apparato",
  stesso_apparato_fisico: "stesso apparato fisico (dalle sue interfacce)",
  stesso_mac: "stesso MAC",
  stesso_nome: "stesso nome",
  a_mano: "unito a mano",
};
export const TESTI_UNIONI = {
  giaStesso: "Sono già lo stesso oggetto sulla mappa.",
  dueApparati: (a: string, b: string): string =>
    `«${a}» e «${b}» sono due apparati censiti: non si uniscono. Si toglie uno dei due da «Apparati» e poi si unisce il suo indirizzo.`,
  nonTrovato: (id: string): string => `Oggetto non trovato: ${id}.`,
  nonNelNodo: "Questo indirizzo non fa parte di quell'oggetto sulla mappa.",
  eLApparato: "È l'apparato: si separano i suoi indirizzi, non l'apparato.",
  nonSeparabile: (come: "host_dell_apparato" | "stesso_ip"): string =>
    come === "host_dell_apparato" ? "È l'indirizzo dell'apparato: non si separa." : "Ha l'IP con cui si gestisce l'apparato: non si separa.",
  doppio: "Lo stesso oggetto è scelto due volte.",
  schemaAssente: "Le unioni non sono disponibili su questo cliente: la migrazione non è riuscita (vedi il journal).",
  cambiato: "Nel frattempo le unioni sono cambiate: riapri il dialogo.",
} as const;
```

  In `model-types.ts`: `import type { InfoUnioni, ModelSeparazioneRow, ModelUnioneRow } from "@/lib/topology/unioni-tipi";`; in
  `TopologyModelInput` dopo `staleDays` `unioni?: ModelUnioneRow[];` e `separazioni?: ModelSeparazioneRow[];` (commento:
  «presenti solo se c'è almeno una riga»); in `TopologyModel` dopo `cavi?` `unioni?: InfoUnioni;`. Verifica: `npx tsc --noEmit`
  → `exit=0`, `cavi-ombra.test.ts` verde. Commit: `topologia: i tipi delle unioni a mano (nessun comportamento)`.

### Task 0: la misura di partenza e il NAS — sessione principale, zona rossa (dati veri), sola lettura

- [ ] **Step 1.** Su tutte e due le copie (`sqlite3 -readonly`): `SELECT name FROM sqlite_master WHERE name IN
  ('topology_unioni','topology_separazioni');` → nessuna riga.
- [ ] **Step 2: ciò che c'è già di «stesso oggetto»**, nel registro `misure-unioni.md` dello scratchpad:

```sql
-- (a) collegamenti a mano per le scansioni: non si convertono, sono candidati da proporre
SELECT pd.id, COUNT(h.id) FROM physical_devices pd JOIN hosts h ON h.physical_device_id = pd.id
 WHERE pd.identity_anchor = 'manual_link' GROUP BY pd.id HAVING COUNT(h.id) >= 2;
-- (b) due apparati censiti dello stesso apparato fisico («apparato + apparato», fuori tappa: Scelte 5)
SELECT physical_device_id, COUNT(*) FROM network_devices WHERE physical_device_id IS NOT NULL GROUP BY 1 HAVING COUNT(*) >= 2;
-- (c) host dello stesso apparato fisico senza apparato censito (oggi nodi separati)
SELECT h.physical_device_id, COUNT(*) FROM hosts h WHERE h.physical_device_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM network_devices nd WHERE nd.physical_device_id = h.physical_device_id)
 GROUP BY 1 HAVING COUNT(*) >= 2;
```

- [ ] **Step 3: il NAS** (copia dell'hub; nomi e IP **in chat**):

```sql
SELECT h.id, h.network_id, h.ip, h.mac, h.hostname, h.custom_name, h.classification, h.physical_device_id,
       (SELECT nd.id FROM network_devices nd WHERE nd.host_id = h.id OR nd.host = h.ip LIMIT 1) AS apparato
  FROM hosts h WHERE h.classification IN ('nas','storage') OR lower(coalesce(h.custom_name, h.hostname, '')) LIKE '%nas%'
 ORDER BY h.hostname, h.ip;
```

  I tre host si confermano con Riccardo nel messaggio dei numeri (servono al Task 7, non fermano il codice). **Se due sono
  apparati censiti** (colonna `apparato` piena su due righe) ci si ferma e si chiede (Scelte 5).
- [ ] **Step 4: le misure «prima»**, col codice di oggi:

```bash
ADESSO="<ora UTC della copia>"
for t in A H; do
  (cd "$SCRATCH/ipam-dev" && npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --salva "$SCRATCH/unioni-prima-$t.json" --json > "$SCRATCH/unioni-prima-$t.out" 2>&1); echo "prima $t exit=$?"
  (cd "$SCRATCH/ipam-dev" && npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --mappa-cavi --salva-cavi "$SCRATCH/unioni-prima-cavi-$t.json" --json > "$SCRATCH/unioni-prima-cavi-$t.out" 2>&1); echo "cavi $t exit=$?"
done
```

  Nel registro: nodi, collegamenti, `fusedHosts`, `mergedHosts`, le due impronte; in chat i tre nodi del NAS coi collegamenti.

---

## Parte 1 — La regola e il dato

### Task 1: la regola nell'indice dei nodi, per le due mappe · zona rossa, Opus

**File.** Modifica `topology/node-index.ts` (`NodeIndex` `:12-22`, `buildNodeIndex`), `model.ts` (`:35`, ritorno `:141-149`),
`misura.ts` (4 chiamate), `cavi/modello.ts:34`, `cavi/mappa.ts` (ritorno `:272-280`), `scripts/misura-vm.ts:68`. Crea
`__tests__/support/nas.ts`, `__tests__/unioni-indice.test.ts`.

**Interfacce.** Usa P3. Produce:

```ts
export interface SceltePerNodi { unioni: readonly ModelUnioneRow[]; separazioni: readonly ModelSeparazioneRow[] }
export const NESSUNA_SCELTA: SceltePerNodi = { unioni: [], separazioni: [] };
// in NodeIndex (interni, mai serializzati):
//   come: Map<number, ComeFuso>; aMano: Map<string, number[]>;
//   nonApplicate: Array<{ gruppo: number; membri: string[]; apparati: string[] }>; mancanti: string[];
export function buildNodeIndex(devices, hosts, knownMacs, neighbors = [], scelte: SceltePerNodi = NESSUNA_SCELTA): NodeIndex
export function indiceDeiNodi(input: Pick<TopologyModelInput, "devices" | "hosts" | "knownMacs" | "neighbors" | "unioni" | "separazioni">): NodeIndex
```

- [ ] **Step 1: la rete del NAS** (`support/nas.ts`, con `dev`/`host`/`baseInput` di `support/righe.ts:4-19` e `riga` di
  `support/reti-campione.ts:18`): reti `10.71.1.0/24`, `10.71.2.0/24`, `10.71.3.0/24`; switch MikroTik `dev(1)` «SW-ALFA»
  `10.71.1.2`, `dev(2)` «SW-BETA» `10.71.2.2`, `dev(3)` «SW-GAMMA» `10.71.3.2`; NAS di classe `nas`: `host(11)` `10.71.1.20`
  MAC `02:00:7a:00:01:11` hostname «QWNAS-7», `host(12)` `10.71.2.20` `02:00:7b:00:02:12`, `host(13)` `10.71.3.20`
  `02:00:7c:00:03:13`, senza nome (OUI diversi: nessuna regola li fonde); un vicino LLDP per switch verso l'IP del NAS nella
  sua rete (`riga({ device_id: 1, local_port: "ether5", remote_ip: "10.71.1.20", remote_device_name: "QWNAS-7",
  protocol: "lldp", source: "device" })`, così 2 e 3); una correzione «aggiungi» `host:12`–`host:13`; una ★ `node_id:
  "host:12"`, `other_node: "dev:2"`. Esporta `nas()`, `nasPromosso()` (più `dev(5)` «QWNAS-7» `10.71.1.20` tipo `nas`,
  `host_id: 11`), `nasDueApparati()` (più `dev(6)` «QWNAS-7-B» `10.71.2.20` tipo `nas`, `host_id: 12`) e `GRUPPO_NAS` =
  `host:11`, `host:12`, `host:13` nel gruppo 1.
- [ ] **Step 2: le prove, prima del codice** (`unioni-indice.test.ts`). Sul codice di oggi la 1 e la 2 passano (sono il
  freno), dalla 3 alla 13 falliscono:
  1. **Freno:** sulle sette reti di `PRIMA_DI_T2` (le cinque di `support/reti-campione.ts` e le due fixture con
     `caricaFixture`, `support/famiglie-cavi.ts:45`) `improntaT1({ ...rete(), unioni: [], separazioni: [] })` = `improntaT1(rete())`;
     su `RETI_CAVI` (`famiglie-cavi.ts:58`) la `mappa` di `modelloMappaDaIngresso` serializzata è la stessa con e senza
     elenchi vuoti. Nessuna impronta scritta a mano.
  2. **NAS senza unione:** nodi `host:11`, `host:12`, `host:13`; collegamenti LLDP `dev:1–host:11`, `dev:2–host:12`,
     `dev:3–host:13` e quello a mano 12–13; `model.unioni` assente.
  3. **NAS unito:** un nodo `host:11` «QWNAS-7», `fusedHostIds` `[12, 13]`, tre indirizzi; `canonical` 12 e 13 → `host:11`; i
     tre LLDP verso `host:11`; il collegamento a mano 12–13 sparito (capi uguali, `links.ts:232`); la ★ sulla coppia
     `host:11–dev:2`; `counts.nodes` −2; `model.unioni` = `{ aMano: { "host:11": [12, 13] }, nonApplicate: [], mancanti: [], separazioni: 0 }`.
  4. **Mappa salvata** con membro e ritocco su `host:13`: `resolveMapView` col `canonical` unito → `visible` con `host:11`,
     ritocco su `host:11`, `renames` `host:13 → host:11`.
  5. **Schermo = traccia:** `modelloMappaDaIngresso(ingresso({ ...nas(), unioni: GRUPPO_NAS }), { testaScelta: null })` (con
     `ingresso` di `support/cavi.ts:37`): fra i nodi `host:11` e non 12/13; ogni collegamento per cavo del NAS tocca
     `host:11`; in `cavi.nonCalcolato` nessuna riga «capo … fuso» (`fusi` di `cavi/mappa.ts:145` = 0); `mappa.unioni` = `t1.unioni`.
  6. **Un apparato vince:** `nasPromosso()` + `GRUPPO_NAS` → nodo `dev:5`, `fusedHostIds` `[11, 12, 13]`, `come` 11
     `host_dell_apparato`, 12 e 13 `a_mano`; `canonical` `host:12 → dev:5`.
  7. **Due apparati no:** `nasDueApparati()` + `GRUPPO_NAS` → `dev:5`, `dev:6`, `host:13` come senza unione (impronta del
     modello senza la chiave `unioni` uguale), `nonApplicate` = `[{ gruppo: 1, membri: ["host:11", "host:12", "host:13"],
     motivo: TESTI_UNIONI.dueApparati("QWNAS-7", "QWNAS-7-B") }]`.
  8. **Mancante:** `GRUPPO_NAS` più `host:99` → NAS unito come nella 3, `mancanti: ["host:99"]`; un gruppo con un solo
     membro esistente non fa niente.
  9. **Separazioni:** per ognuna delle cinque fusioni deboli (`stesso_apparato_fisico`, `stesso_mac` e `stesso_nome` verso un
     apparato, due host per MAC, due host `server` per nome) una rete minima: senza coppia fuso col `come` giusto, con la coppia
     due nodi.
  10. **Non separabili:** una coppia sull'host del `host_id` o su quello con l'IP di gestione non cambia niente.
  11. **Gemello separato:** su `nasPromosso()`, `host:14` con lo stesso MAC di `host:12`, unione `{ host:11, host:12 }`, coppia
      `{ host:14, dev:5 }` → in `dev:5` entra il 12; il 14 resta `host:14` e il suo IP e MAC si risolvono a `host:14`.
  12. **Nessuna fusione trascinata:** `nasPromosso()` con `custom_name: "ZETA-NAS"` su `host:12` e `host(20)` `server`
      `10.71.4.20` MAC `02:00:7d:00:04:20` «ZETA-NAS»: con `GRUPPO_NAS` il 20 resta `host:20` (unione prima dei nomi = il nome
      del 12 alias di `dev:5`, `:151`, e il 20 attirato).
  13. **Lucchetto:** nessun file sotto `src/` o `scripts/`, fuori da `node-index.ts` e da `__tests__/`, contiene
      `buildNodeIndex(` (la prova legge i file, come `no-dynamic-db-tenant-import.test.ts`).

  `node --import tsx --test src/lib/topology/__tests__/unioni-indice.test.ts > "$LOG" 2>&1; echo "exit=$?"` → `exit=1`, uscita
  rossa nel resoconto.
- [ ] **Step 3: il codice.** Campi nuovi inizializzati vuoti. Dopo `hostsByPhys` (`:87`):

```ts
  // Separazioni a mano: «questo host non si fonde da solo con quell'oggetto». Fra due host vale nei due versi.
  const sep = new Map<number, Set<string>>();
  const segna = (h: number, altro: string): void => { sep.set(h, new Set([...(sep.get(h) ?? []), altro])); };
  for (const s of scelte.separazioni) {
    const m = /^host:(\d+)$/.exec(s.membro);
    if (!m) continue;
    segna(Number(m[1]), s.altro);
    const o = /^host:(\d+)$/.exec(s.altro);
    if (o) segna(Number(o[1]), s.membro);
  }
  const separato = (h: number, altro: string): boolean => sep.get(h)?.has(altro) === true;
```

  `take` riceve il motivo e lo scrive in `idx.come`: `:99` `"host_dell_apparato"`, `:100` `"stesso_ip"` (queste due **ignorano**
  le separazioni), `:101` solo `if (!separato(h.id, id))`, `"stesso_apparato_fisico"`. MAC (`:130-141`): `if (separato(h.id,
  devId)) continue;`, `come` `"stesso_mac"`. Nomi (`:152-161`): `|| separato(h.id, devId)` nel `continue`, `come` `"stesso_nome"`.
  Union-find:

```ts
  const membri = new Map<number, number[]>(); // radice → membri
  const membriDi = (r: number): number[] => membri.get(r) ?? [r];
  const puo = (a: number, b: number): boolean => {
    if (sep.size === 0) return true;
    const B = membriDi(find(b));
    return !membriDi(find(a)).some((x) => B.some((y) => separato(x, `host:${y}`)));
  };
  /** «a_mano» vince sulle separazioni: le rotte tolgono quelle che contraddirebbe. */
  const union = (a: number, b: number, come: ComeFuso): boolean => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return true;
    if (come !== "a_mano" && !puo(ra, rb)) return false;
    const lo = Math.min(ra, rb), hi = Math.max(ra, rb);
    parent.set(hi, lo);
    const sposta = membriDi(hi);
    membri.set(lo, [...membriDi(lo), ...sposta]);
    membri.delete(hi);
    for (const x of sposta) if (!idx.come.has(x)) idx.come.set(x, come);
    return true;
  };
```

  Per MAC `union(f, h.id, "stesso_mac")`; per nome `seen.find((x) => find(x) !== find(h.id) && compatible(x, h.id) && puo(x, h.id))`
  e gli OUI si uniscono solo se `union(other, h.id, "stesso_nome")` dà `true`. Con `sep` vuota tutto come oggi. Poi, prima di
  `groupMembers` (`:195`), le unioni a mano:

```ts
  // Unioni a mano: dopo TUTTE le regole automatiche (decisione 1). Ogni membro va nel nodo che lo contiene adesso.
  const perGruppo = new Map<number, string[]>();
  for (const u of [...scelte.unioni].sort((x, y) => x.gruppo - y.gruppo || (x.membro < y.membro ? -1 : x.membro > y.membro ? 1 : 0))) {
    perGruppo.set(u.gruppo, [...(perGruppo.get(u.gruppo) ?? []), u.membro]);
  }
  const radicePrima = new Map<number, number>();
  for (const [gruppo, elenco] of perGruppo) {
    const apparati = new Set<string>(), radici = new Set<number>(), espliciti = new Set<number>();
    for (const m of elenco) {
      const hm = /^host:(\d+)$/.exec(m);
      if (/^dev:\d+$/.test(m) && idx.nodes.has(m)) apparati.add(m);
      else if (hm && idx.hostById.has(Number(hm[1]))) {
        const hid = Number(hm[1]);
        espliciti.add(hid);
        const dev = absorbedBy.get(hid);
        if (dev) apparati.add(dev); else radici.add(find(hid));
      } else idx.mancanti.push(m);
    }
    if (apparati.size + radici.size < 2) continue;
    if (apparati.size >= 2) { idx.nonApplicate.push({ gruppo, membri: [...elenco].sort(), apparati: [...apparati].sort() }); continue; }
    if (apparati.size === 1) {
      const devId = [...apparati][0];
      const entrano: number[] = [];
      for (const h of sortedHosts) {
        if (absorbedBy.has(h.id) || !radici.has(find(h.id))) continue;
        if (!espliciti.has(h.id) && separato(h.id, devId)) continue; // un gemello separato a mano resta fuori
        absorbedBy.set(h.id, devId);
        idx.come.set(h.id, "a_mano");
        entrano.push(h.id);
      }
      const node = idx.nodes.get(devId)!;
      node.fusedHostIds = [...node.fusedHostIds, ...entrano].sort((a, b) => a - b);
      idx.aMano.set(devId, [...(idx.aMano.get(devId) ?? []), ...entrano].sort((a, b) => a - b));
    } else {
      const rs = [...radici].sort((a, b) => a - b);
      for (const h of sortedHosts) if (!absorbedBy.has(h.id) && radici.has(find(h.id))) radicePrima.set(h.id, find(h.id));
      for (const r of rs.slice(1)) union(rs[0], r, "a_mano");
    }
  }
```

  `groupMembers` resta per radice, ma il **rappresentante è il primo membro rimasto** (`members[0].id`): `repOf` e il ciclo dei
  nodi (`:203-215`) usano quello (senza unioni a mano la radice è già il membro più basso: nessun cambio). Dopo quel ciclo,
  ogni host con `radicePrima` diversa dalla radice più bassa del suo gruppo prende `come` `"a_mano"` ed entra in
  `idx.aMano` del nodo `host:<rappresentante>`. Il resto (`:216-259`) non cambia e vale anche per gli entrati a mano: è ciò che
  ri-punta i collegamenti. Infine `indiceDeiNodi(input)` = `buildNodeIndex(input.devices, input.hosts, input.knownMacs,
  input.neighbors, { unioni: input.unioni ?? [], separazioni: input.separazioni ?? [] })`.
- [ ] **Step 4: chiamanti e modello.** I sette chiamanti passano a `indiceDeiNodi(input)` (`cavi/modello.ts`: `ing.t1`). In
  `model.ts`, nel ritorno, `...(input.unioni?.length || input.separazioni?.length ? { unioni: infoUnioni(idx, input) } : {})`:
  `aMano` da `idx.aMano` (chiavi in ordine), `nonApplicate` con `motivo` `TESTI_UNIONI.dueApparati(nome del primo, nome del
  secondo)` dai `apparati`, `mancanti` senza doppi in ordine, `separazioni: input.separazioni?.length ?? 0`. In `cavi/mappa.ts`
  dopo `gatewayDi`: `...(t1.unioni ? { unioni: t1.unioni } : {})`.

**Come si verifica.** `unioni-indice.test.ts` → `exit=0`; senza toccarne una, `node --import tsx --test
src/lib/topology/__tests__/{node-index,cavi-ombra,model-fixtures,reti-campione,cavi-reti-campione,cavi-scenari,cavi-prove,links,attach,sites,vms,identity,ruolo}.test.ts`
→ `exit=0`; `npx tsc --noEmit` → `exit=0`; `npx eslint` sui file toccati → 0 errori.
**Commit:** `topologia: unioni e separazioni a mano nell'indice dei nodi, per le due mappe (niente righe = mappa di oggi)`.

### Task 2: tabelle, migrazione, letture, scrittura · zona rossa, Opus

**File.** Modifica `db-tenant-schema.ts` (accanto a `DDL_TOPOLOGY_CAVI`, incluso come a `:876`), `db-tenant.ts` (migrazione
accanto a `:502`, chiamata dopo `:2036`, letture accanto a `:5174`, `getTopologyModelInput` `:9389-9443`),
`transfer/table-registry.ts`. Crea `src/lib/__tests__/topology-unioni-migration.test.ts`, `topology-unioni-db.test.ts`.

**Interfacce.** Usa P3. Produce:

```ts
export function migrateTopologyUnioni(db: Database.Database): string[]
export function schemaUnioniPresente(): boolean   // annotato all'apertura (WeakMap come SCHEMA_CAVI)
export function rileggiSchemaUnioni(): boolean
export function getRigheScelte(): { unioni: RigaUnione[]; separazioni: RigaSeparazione[] }   // attive; schema assente → vuote
export function getIngressoNodi(): Pick<TopologyModelInput, "devices" | "hosts" | "knownMacs" | "neighbors" | "unioni" | "separazioni">
export class UnioniCambiate extends Error {}
export function scriviPianoUnioni(piano: PianoUnioni, da: string, adesso?: string): void
```

- [ ] **Step 1: prove, prima.** Migrazione (come `topology-cavi-migration.test.ts`): su un DB senza tabelle aggiunge due
  tabelle e tre indici e li elenca, la seconda volta `[]`; con le tabelle dello schema solo gli indici; un errore a metà (una
  `topology_separazioni` senza `altro`) non lascia niente (una transazione); un tenant nuovo ha `schemaUnioniPresente()`.
  DB (tenant di prova come `topologia-t3-freno.test.ts`): senza righe l'ingresso **non ha** le chiavi; con righe le ha, ordinate,
  senza le tolte; due «nuovo» nello stesso gruppo `MAX + 1`; togliere lascia la riga; l'indice unico rifiuta due attive con lo
  stesso membro; una riga già tolta → `UnioniCambiate` e niente scritto; tabelle tolte (`DROP` + `rileggiSchemaUnioni()`) →
  `false`, vuote, nessuna chiave; `getIngressoNodi()` uguale (testo serializzato) ai quattro campi di `getTopologyModelInput`
  sulla famiglia 1. Run → `exit=1`.
- [ ] **Step 2: schema e migrazione.**

```ts
/** Unioni e separazioni a mano (ADR 0021): le scrivono solo le rotte /api/topology/unioni; mai cancellate (tolto_*: la storia).
 *  Membri come id della mappa, senza chiavi esterne né CHECK. Indici solo nella migrazione. */
export const DDL_TOPOLOGY_UNIONI: ReadonlyArray<readonly [string, string]> = [
  ["topology_unioni", `CREATE TABLE IF NOT EXISTS topology_unioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT, gruppo INTEGER NOT NULL, membro TEXT NOT NULL,
  creato_da TEXT NOT NULL, creato_il TEXT NOT NULL DEFAULT (datetime('now')), tolto_da TEXT, tolto_il TEXT)`],
  ["topology_separazioni", `CREATE TABLE IF NOT EXISTS topology_separazioni (
  id INTEGER PRIMARY KEY AUTOINCREMENT, membro TEXT NOT NULL, altro TEXT NOT NULL,
  creato_da TEXT NOT NULL, creato_il TEXT NOT NULL DEFAULT (datetime('now')), tolto_da TEXT, tolto_il TEXT)`],
];
export const INDICI_TOPOLOGY_UNIONI: ReadonlyArray<readonly [string, string]> = [
  ["idx_topology_unioni_membro_attivo", "CREATE UNIQUE INDEX idx_topology_unioni_membro_attivo ON topology_unioni(membro) WHERE tolto_il IS NULL"],
  ["idx_topology_unioni_gruppo", "CREATE INDEX idx_topology_unioni_gruppo ON topology_unioni(gruppo) WHERE tolto_il IS NULL"],
  ["idx_topology_separazioni_coppia_attiva", "CREATE UNIQUE INDEX idx_topology_separazioni_coppia_attiva ON topology_separazioni(membro, altro) WHERE tolto_il IS NULL"],
];
```

  `migrateTopologyUnioni` come `migrateTopologyCavi`: in una `db.transaction`, le CREATE delle tabelle e degli indici che non
  ci sono; restituisce i nomi. In `getTenantDb` dopo la verifica di T2, in `try/catch`: se ha aggiunto qualcosa
  `console.info(\`[db-tenant] ${tenantCode}: topologia unioni, aggiunto ${added.join(", ")}\`)` (prova del rilascio); in errore
  `console.error(\`[db-tenant] ${tenantCode}: migrazione topologia unioni fallita, le unioni non sono disponibili:\`, e)` e il
  tenant si apre lo stesso; poi l'annotazione (tabelle e indici presenti). Registro: `{ table: "topology_unioni", scope:
  "tenant", tier: "config" }` e lo stesso per `topology_separazioni`.
- [ ] **Step 3: letture, ingresso, scrittura.** `getRigheScelte()`: schema assente → vuote; altrimenti `… WHERE tolto_il IS
  NULL ORDER BY gruppo, membro` e `… ORDER BY membro, altro`. In fondo all'oggetto di `getTopologyModelInput` (dopo
  `staleDays`: l'ordine delle chiavi di oggi resta) `unioni` (`{ gruppo, membro }`) e `separazioni` (`{ membro, altro }`)
  **solo se non vuote**. Le query di `devices`, `hosts`, `neighbors` (`:9403-9419`) diventano tre funzioni private usate da
  `getTopologyModelInput` e da `getIngressoNodi`, stesso testo SQL. `scriviPianoUnioni(piano, da, adesso = ora UTC del DB)`,
  in **una** `db.transaction`: per ogni id da togliere `UPDATE <tabella> SET tolto_da = ?, tolto_il = ? WHERE id = ? AND tolto_il
  IS NULL`, e se `changes !== 1` `throw new UnioniCambiate(TESTI_UNIONI.cambiato)` (tutto annullato); se una riga è «nuovo», il
  gruppo `SELECT COALESCE(MAX(gruppo), 0) + 1 FROM topology_unioni` una volta per tutte; poi le `INSERT` con `creato_da = da`,
  `creato_il = adesso`.

**Come si verifica.** `node --import tsx --test src/lib/__tests__/topology-unioni-{migration,db}.test.ts src/lib/transfer/__tests__/{registry,roundtrip}.test.ts src/lib/__tests__/topologia-t{2,3}-freno.test.ts src/lib/__tests__/topology-cavi-ingresso.test.ts`
→ `exit=0`; `npx tsc --noEmit` → `exit=0`.
**Commit:** `db: tabelle delle unioni e separazioni a mano, migrazione additiva, ingresso del modello solo con righe`.

---

## Parte 2 — Decisioni e rotte; il dialogo

### Task 3: decisioni, rotte, misura · zona rossa, Opus

**File.** Crea `topology/unioni.ts` (puro), `topology/unioni-server.ts` (DB, solo per le rotte), `topology/misura-unioni.ts`
(puro), le tre `route.ts`, prove `topology/__tests__/unioni-decisioni.test.ts`, `src/lib/__tests__/topology-unioni-rotte.test.ts`.
Modifica `topology/api-input.ts` (accanto a `roleSchema` `:352`), `scripts/misura-cavi.ts`, `topology/anonimizza.ts` (copia
`unioni`/`separazioni` così come sono: solo id), `__tests__/api-auth-guards.test.ts` (dopo `:77`), `docs/auth-matrix.md`.

**Interfacce.** Usa Task 1 (`indiceDeiNodi`, `NodeIndex.come/aMano/nonApplicate/mancanti`, `canonical`), Task 2, P3. Produce:

```ts
// unioni.ts
export type IngressoNodi = Pick<TopologyModelInput, "devices" | "hosts" | "knownMacs" | "neighbors">;
export interface RigheScelte { unioni: RigaUnione[]; separazioni: RigaSeparazione[] }
export type Esito<T> = { ok: true; dati: T } | { ok: false; status: 404 | 409; error: string };
export function conRighe(ing: IngressoNodi, r: { unioni: readonly ModelUnioneRow[]; separazioni: readonly ModelSeparazioneRow[] }): IngressoNodi & SceltePerNodi
export function righeDopo(righe: RigheScelte, piano: PianoUnioni): { unioni: ModelUnioneRow[]; separazioni: ModelSeparazioneRow[] }
export function ancoraDi(ing: IngressoNodi, id: string): string | null
export function nodoDi(idx: NodeIndex, id: string): string | null
export function statoDelNodo(ing: IngressoNodi, righe: RigheScelte, oggetto: string): Esito<Omit<StatoDelNodo, "disponibile">>
export function cercaCandidati(ing: IngressoNodi, righe: RigheScelte, da: string, testo: string, limite?: number): Esito<CandidatiUnione>
export function decidiUnione(ing: IngressoNodi, righe: RigheScelte, scelti: string[]): Esito<{ piano: PianoUnioni; anteprima: Omit<AnteprimaUnione, "scritto"> }>
export function decidiSeparazione(ing: IngressoNodi, righe: RigheScelte, nodo: string, membro: string): Esito<{ piano: PianoUnioni; anteprima: Omit<AnteprimaSeparazione, "scritto"> }>
// api-input.ts
export function parseUnioneBody(raw: unknown): Parsed<CorpoUnione>
export function parseSeparaBody(raw: unknown): Parsed<CorpoSeparazione>
export function parseOggettoParam(v: string | null): Parsed<string>
// unioni-server.ts — le rotte sono un involucro
export interface RispostaRotta { status: number; body: unknown }
export function rispostaStato(oggetto: string | null): RispostaRotta
export function rispostaCandidati(da: string | null, q: string | null): RispostaRotta
export function rispostaUnione(raw: unknown, utente: string): RispostaRotta
export function rispostaSeparazione(raw: unknown, utente: string): RispostaRotta
// misura-unioni.ts
export function aggiungiScelte(input: TopologyModelInput, unisci: string[][], separa: Array<[string, string]>): TopologyModelInput
export function confrontoUnione(prima: TopologyModel, dopo: TopologyModel): { nodiPrima: number; nodiDopo: number; ripuntati: number; coppieScomparse: string[]; autoanelli: number }
export function fusioniPerCome(idx: NodeIndex): Record<ComeFuso, number>
```

**Regole** (testi da `TESTI_UNIONI`):
- **`ancoraDi`** (che cosa si scrive, Scelte 3): `host:N` esistente → sé stesso; `dev:N` → il suo host (`host_id`, altrimenti
  l'host di id più basso con `ip === device.host`), `dev:N` solo se non ne ha; altrimenti `null` (404 `nonTrovato`).
- **`nodoDi`**: `canonical(idx, id)`; un host in nessun nodo è il nodo `host:N`; un `dev:N` non fra i nodi → `null`.
- **`decidiUnione`**: doppi → 409 `doppio`; `idx = indiceDeiNodi(conRighe(ing, righe))`; ogni scelto → `ancoraDi` → `nodoDi`;
  tutti in un nodo → 409 `giaStesso`; fra i nodi che finiscono insieme (contando i gruppi esistenti delle ancore) due o più
  apparati → 409 `dueApparati`. Gruppo: se delle ancore stanno già in gruppi attivi, il più basso, e le righe degli altri
  gruppi si tolgono e si rimettono sotto quello; altrimenti `"nuovo"`. Si aggiungono le ancore non ancora nel gruppo; si
  tolgono le separazioni attive coi due capi (risolti con `nodoDi` sull'indice di oggi) fra i nodi che si uniscono (Caso 5).
  Anteprima su `indiceDeiNodi(conRighe(ing, righeDopo(righe, piano)))`: il nodo della prima ancora, `entrano` = chi ora ne fa
  parte e prima no, `perche` da `PAROLA_COME` («insieme a ‹nome›» per chi arriva col gemello), `separazioniTolte` con `creato_il`.
- **`decidiSeparazione`**: `membro` `host:N` dentro `nodo` (altrimenti 409 `nonNelNodo`); il nodo apparato stesso → 409
  `eLApparato`; `idx.come.get(N)` in `NON_SEPARABILI` → 409 `nonSeparabile`. Piano: si toglie la riga attiva del membro, e
  l'ultima del gruppo se ne resta una; coppie (Scelte 2): nodo apparato → `{ membro, altro: nodo }`; nodo di soli host →
  `{ membro, altro: "host:X" }` per ogni altro membro, senza ripetere coppie attive. Anteprima: `resta` ed `escono` (ogni nodo
  dove finiscono il membro e chi c'era per lui, Caso 4).
- **`statoDelNodo`**: membri (prima `come: "oggetto"`, poi per IP) con `separabile`, `perche`, `aMano` (riga del membro o del
  gemello), `nonApplicata`, `mancanti`.
- **`cercaCandidati`**: sotto 2 caratteri vuoto; nodi dell'indice e host soli (VM e segmenti non ci sono), escluso il nodo di
  `da`; testo (minuscolo) in nome, alias, IP o MAC; prima l'IP uguale, poi il nome che comincia così, poi il resto, a pari per
  nome («it») e id; `bloccato` = `dueApparati` se tutti e due hanno un apparato; primi 20 e `altri`.

- [ ] **Step 1: prove delle decisioni, prima** (`unioni-decisioni.test.ts`, rete del NAS e reti minime del Task 1): una
  prova per ogni riga delle regole qui sopra, col Caso 4 nelle sue due forme e il Caso 5. Run → `exit=1` (il modulo non c'è).
- [ ] **Step 2: prove delle rotte, prima** (`topology-unioni-rotte.test.ts`, tenant di prova col NAS scritto come in
  `topologia-t3-freno.test.ts`): anteprima → 200 `scritto: false` e nessuna riga; `applica: true` → tre righe con `creato_da` e
  il NAS in un nodo in `buildTopologyModel(getTopologyModelInput(2))`; `rispostaStato("host:13")` → nodo `host:11`; separazione
  → `host:13` torna solo, righe con `tolto_il`; campo in più, `applica` mancante, `vm:`/`seg:` → 400; tabelle assenti (`DROP` +
  `rileggiSchemaUnioni()`) → 409 `schemaAssente` e `disponibile: false`; riga già tolta → 409 `cambiato`; candidati per nome e
  IP. Run → `exit=1`.
- [ ] **Step 3: il codice.** `api-input.ts`: `MEMBRO = z.string({ error: "Oggetto non valido" }).regex(/^(dev|host):[1-9]\d{0,9}$/,
  "Oggetto non valido: «host:N» o «dev:N»")`; unione = `membri` (`min(2, "Servono almeno due oggetti")`, `max(20, "Al massimo
  20 oggetti alla volta")`, doppi → `doppio`) e `applica` (`z.boolean({ error: "«applica» deve essere vero o falso" })`); separa =
  `nodo: MEMBRO`, `membro` (`^host:[1-9]\d{0,9}$`, «Si separa un indirizzo: «host:N»»), `applica`; stretti con `BODY_STRETTO`.
  `unioni-server.ts`: `schemaUnioniPresente()` (assente: 409 `schemaAssente` per le scritture, `disponibile: false` per lo
  stato), `getIngressoNodi()`, `getRigheScelte()`, la decisione, con `applica: true` `scriviPianoUnioni` e l'anteprima ricalcolata
  (`scritto: true`); `UnioniCambiate` → 409. Le rotte come `api/topology/settings/mappa/route.ts`:

```ts
export async function POST(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    try {
      const r = rispostaUnione(await readJson(req), actorOf(s) ?? "amministratore");
      return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
    } catch (error) {
      console.error("[topology] unioni:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel salvataggio dell'unione" }, { status: 500 });
    }
  });
}
```

  Le GET con `requireAuth()` e `parseOggettoParam` sui parametri. **Nessuna voce in `permessi/rotte.ts`**: i livelli predefiniti
  sono quelli giusti e il censimento le prende da sole. In `api-auth-guards.test.ts`, col commento «Unioni a mano (piano
  2026-10-16): scrivono il DB del cliente, anche l'anteprima resta a un admin», `topology/unioni` e `topology/unioni/separa`
  POST `requireAdmin`. Poi `npx tsx scripts/audit-api-auth.ts` rigenera `docs/auth-matrix.md` (debiti 0, scoperti 0).
- [ ] **Step 4: la misura.** `misura-cavi.ts` (uso e `CON_VALORE`): `--unisci <id>,<id>[,…]` (ripetibile, un gruppo per volta,
  gruppi `-1`, `-2`…), `--separa <host:N>=<altro>` (ripetibile), `--unioni`. Le righe in memoria si aggiungono all'ingresso
  letto (`aggiungiScelte`) prima di ogni calcolo, così valgono per T1, `--mappa-cavi` e `--traccia`. Sezione `unioni` (JSON; con
  `--nomi` i nomi a terminale, mai su file): `righe_db` (attive, nella copia della copia dopo la migrazione), le query (a), (b),
  (c) del Task 0 con, per (a), quanti gruppi sono già un nodo solo; `fusioni_automatiche` (`fusioniPerCome`); con `--unisci`/
  `--separa` `in_memoria` = `confrontoUnione` più `applicate`, `non_applicate`, `mancanti` e, con `--mappa-cavi`, la riga «capi
  fusi» di `cavi.nonCalcolato` (attesa assente). `confrontoUnione`: `ripuntati` = linee del «dopo» con un capo che prima era un
  id ora alias; `coppieScomparse` = coppie del «prima» (passate dal `canonical` del «dopo») assenti nel «dopo», esclusi gli
  `autoanelli` (capi nello stesso nodo).

**Come si verifica.** `node --import tsx --test src/lib/topology/__tests__/{unioni-decisioni,anonimizza}.test.ts src/lib/__tests__/{topology-unioni-rotte,api-auth-guards}.test.ts src/lib/permessi/__tests__/rotte-censite.test.ts`
→ `exit=0`; `bash scripts/verifica-permessi.sh` verde; `npx tsc --noEmit` → `exit=0`.
**Commit:** `topologia: rotte di «Unisci con…» e «Separa…» con anteprima, decisioni pure, misura in memoria`.

### Task 4: il dialogo condiviso · Sonnet

**File.** Crea `topology/unioni-testi.ts` (puro), `components/topology/unioni/{api.ts,unisci-dialog.tsx,separa-dialog.tsx}`,
prova `topology/__tests__/unioni-testi.test.ts`. Struttura e stile di `components/devices/link-ips-dialog.tsx` (`Dialog`,
`DialogScrollableArea`, `DIALOG_PANEL_COMPACT_CLASS`, `Input` con `Search`, `toast` di `sonner`).

**Interfacce.** Usa solo P3 e le firme delle rotte del Task 3. Produce:

```ts
export function parolaCome(m: Pick<MembroDelNodo, "come" | "aMano">): string     // «stesso MAC»; «unito a mano il 16/10 da ‹utente›» (FUSO_UTENTI)
export function membriSeparabili(n: Pick<MapNode, "kind" | "mgmtIp" | "fusedHostIds" | "addresses">): number
export function titoloUnisci(nome: string): string    // «Unisci ‹nome› con…»
export function titoloSepara(nome: string): string    // «Separa da ‹nome›…»
// api.ts, tutto con fetchJson: un errore torna come errore
export function caricaStato(oggetto: string): Promise<FetchJsonResult<StatoDelNodo>>
export function cercaCandidati(da: string, q: string, signal?: AbortSignal): Promise<FetchJsonResult<CandidatiUnione>>
export function chiediUnione(corpo: CorpoUnione): Promise<FetchJsonResult<AnteprimaUnione>>
export function chiediSeparazione(corpo: CorpoSeparazione): Promise<FetchJsonResult<AnteprimaSeparazione>>
export interface UnisciDialogProps { open: boolean; onOpenChange: (o: boolean) => void; da: string; nomeDa: string; scelti?: string[]; onFatto: () => void }
export interface SeparaDialogProps { open: boolean; onOpenChange: (o: boolean) => void; oggetto: string; onFatto: () => void }
export function UnisciDialog(p: UnisciDialogProps): JSX.Element
export function SeparaDialog(p: SeparaDialogProps): JSX.Element
```

- [ ] **Step 1: prove delle parti pure, prima:** `membriSeparabili` = fusi meno quello con l'IP di gestione per un apparato (2 con
  due altri, 0 col solo suo host), fusi + 1 per un nodo di soli host con fusi, 0 per un host solo (è una stima per mostrare
  «Separa…»; il dialogo dice il resto); `parolaCome` per ogni `ComeFuso` e per `a_mano` con la data italiana; i titoli. Run →
  `exit=1`, codice, `exit=0`.
- [ ] **Step 2: `UnisciDialog`.** Senza `scelti`: ricerca «Cerca per nome, IP o MAC» (300 ms dopo l'ultimo tasto, da 2
  caratteri, `AbortController`); righe con nome, «Apparato»/«Host», IP; `bloccato` disattivato col motivo scritto; «+ altri N:
  affina la ricerca»; più scelte con le caselle. «Vedi cosa succede» (`applica: false`) → «Diventano un oggetto solo: ‹nome›»,
  «Entrano» col perché, le separazioni annullate con la data; «Indietro» e «Unisci» (`applica: true`, toast, `onFatto`). Con
  `scelti` si parte dall'anteprima. Gli errori della rotta (409, 403, 500) si scrivono **nel dialogo**, che resta aperto.
- [ ] **Step 3: `SeparaDialog`.** `caricaStato` (con `LoadError`); l'oggetto in testa, poi i membri con `parolaCome`, i non
  separabili disattivati col `perche`; `disponibile: false` → solo `schemaAssente`; `nonApplicata` → «Unione a mano non
  applicata: ‹motivo›»; nessun altro membro → «Questo indirizzo sulla mappa è un oggetto solo». Anteprima («Resta…», «Escono…»)
  e «Separa».
- [ ] **Step 4:** `text-sm` o `text-[13px]`, mai meno; ogni stato con la parola; niente icone senza testo.

**Come si verifica.** `unioni-testi.test.ts` → `exit=0`; `npx tsc --noEmit` → `exit=0`; `npx eslint` sui file nuovi → 0
errori; la resa nel Task 8. **Commit:** `interfaccia: il dialogo di «Unisci con…» e «Separa…», uno per i tre posti`.

---

## Parte 3 — I tre posti

### Task 5: la mappa · Sonnet

**File.** `topology/map-menus.ts` (`NodeMenuCtx` `:14-41`, `NodeMenuKey` `:59`, `nodeMenuItems` `:70-86`),
`components/topology/map/topology-map-client.tsx` (`:322-337`, `:423-428`), `linked-panel.tsx` (indirizzi `:149-158`); casi
nuovi in `map-menus.test.ts` (quelli di `:46-73` **non** si toccano). Usa Task 4, `model.unioni`, `reload` (`:133`).

- [ ] **Step 1: le voci, prova prima.** `NodeMenuCtx.unioni?: { separabili: number }` (la pagina lo passa sempre; assente = le
  prove di prima); `NodeMenuKey` più `"merge" | "split"`; dopo «Nascondi…» e prima di «Promuovi ad apparato»:
  `if (c.unioni && c.isAdmin && !c.isUncensusedVm && !c.isSegmento) out.push({ key: "merge", label: "Unisci con…" });`
  `if (c.unioni && c.isAdmin && c.unioni.separabili > 0) out.push({ key: "split", label: "Separa…" });`. Prove: admin con
  `separabili: 0` → «Unisci con…» sola; con 2 → tutte e due nell'ordine; non admin, VM non censita, segmento → niente
  «Unisci con…»; senza `unioni` le voci di oggi. Run → `exit=1`, codice, `exit=0`.
- [ ] **Step 2: la pagina.** Contesto `unioni: { separabili: membriSeparabili(n) }`; `case "merge": setUnisciDa(id)`, `case
  "split": setSeparaDa(id)`; i dialoghi con `onFatto` = `await reload()` e poi la selezione su `d.model.canonical[id] ?? id`
  (come `dropNode` `:297`). Vale per la mappa di T1 e per quella per cavo.
- [ ] **Step 3: i dettagli.** Accanto a un indirizzo con `hostId` in `model.unioni?.aMano[n.id]` «· unito a mano»
  (`text-muted-foreground`); sotto, per ogni `nonApplicate` con un membro il cui nodo (`model.canonical[m] ?? m`) è `n.id`,
  «Unione a mano non applicata: ‹motivo›».

**Come si verifica.** `map-menus.test.ts` → `exit=0`; `npx tsc --noEmit`, `npx eslint` → 0 errori. **Commit:** `mappa: «Unisci
con…» e «Separa…» nel tasto destro, «unito a mano» nei dettagli`.

### Task 6: la scheda e la Discovery · Sonnet

**File.** `app/(dashboard)/objects/[id]/page.tsx` (sezione prima di `:1875`, scheda «Rete», `dynamic` come `:35`),
`app/(dashboard)/discovery/page.tsx` (barra `:2037-2075`, dialoghi accanto a `:3005`). Usa Task 4.

- [ ] **Step 1: la scheda.** `Section` «Sulla mappa» (icona `Workflow`) sopra «IP collegati allo stesso device fisico»:
  `caricaStato(\`host:${hostId}\`)` con `fetchJson` + `LoadError`; «Sulla mappa è **‹nome›**» e, se ci sono altri membri,
  l'elenco (IP `font-mono text-sm`, nome, `parolaCome`, la parola «qui» accanto a questo indirizzo, link `/objects/<id>` agli
  altri); «Unione a mano non applicata: ‹motivo›»; «Non ci sono più: ‹id›» per i `mancanti`; con `disponibile: false` solo
  `schemaAssente`. Pulsanti «Unisci con…» e «Separa…» (questo solo con un membro `separabile`); dopo, la sezione si ricarica. La
  sezione delle scansioni resta com'è (Scelte 9).
- [ ] **Step 2: la Discovery**, dopo «Stesso device fisico»: con **una** riga «Unisci con…» e «Separa…» (`host:${id}`); con **due
  o più** «Unisci (N)…» (`scelti` = le righe come `host:N`, `da` la prima). Icone `Merge` e `Split` di `lucide-react`, sempre con
  la parola. Dopo il dialogo `setSelectedIds(new Set())` e il ricaricamento come per le altre azioni in blocco.

**Come si verifica.** `npx tsc --noEmit`, `npx eslint` sui due file → 0 errori; `npm run build` nel worktree → `exit=0`; la resa
nel Task 8. **Commit:** `scheda e Discovery: «Sulla mappa», «Unisci con…» e «Separa…»`.

---

## Parte 4 — Sessione principale

### Task 7: le misure sulle copie — zona rossa (dati veri)

Copie del P2 (fresche se è passato un giorno), worktree del ramo d'unione dopo l'ondata 3. Uscite nello scratchpad, numeri a
Riccardo, nomi in chat, registro `misure-unioni.md`.

- [ ] **Step 1: niente righe = la mappa di oggi**, stesso orologio del Task 0:

```bash
for t in A H; do
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --confronta "$SCRATCH/unioni-prima-$t.json" --json > "$SCRATCH/unioni-dopo-$t.out" 2>&1; echo "dopo $t exit=$?"
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --mappa-cavi --confronta-cavi "$SCRATCH/unioni-prima-cavi-$t.json" --json > "$SCRATCH/unioni-dopo-cavi-$t.out" 2>&1; echo "cavi $t exit=$?"
done
```

  Atteso: `impronta_modello` uguale al Task 0, `padri_cambiati: 0`, `conteggi_cambiati: {}`, `stesso_orologio: true`; mappa per
  cavo con impronta e padri uguali. **Una differenza ferma il rilascio.**
- [ ] **Step 2: l'elenco per nome di Riccardo (decisione 3)**: `--unioni --json`, poi `--unioni --nomi`, sulle due copie. Il
  messaggio dice che cosa la misura controlla: (a) `righe_db` 0 e 0 → **col rilascio non si unisce niente**, elenco vuoto;
  (b) collegamenti a mano per le scansioni e quanti sono già un nodo: non si convertono, candidati da unire a mano; (c)
  apparati censiti dello stesso apparato fisico (fuori tappa); (d) host dello stesso apparato fisico senza apparato
  (candidati); (e) fusioni automatiche per motivo: ciò che «Separa…» può togliere.
- [ ] **Step 3: il NAS in memoria** (copia dell'hub): `--unisci host:‹a›,host:‹b›,host:‹c› --unioni --mappa-cavi --traccia --json`.
  Atteso: due nodi in meno; `ripuntati` = i collegamenti di ‹b› e ‹c› del Task 0; `coppieScomparse` vuoto (ognuna è un
  `Criterio` da correggere prima del rilascio, con un implementatore Opus e la prova vista fallire, o un `Fatto` spiegato);
  `autoanelli` 0 o spiegati; `applicate: 1`; nessuna riga «capi fusi»; nella traccia solo le differenze del Task 0.
- [ ] **Step 4: «Separa» in memoria**: una fusione automatica di (e) sull'hub (scelta in chat), `--separa host:‹x›=<nodo>`: un
  nodo in più, i collegamenti di ‹x› da lui; sul cliente A lo stesso con una fusione per MAC, se c'è.

### Task 8: lo schermo, una volta, a 1280 e 1920

In locale, mai sui server: server del ramo d'unione con `DA_INVENT_DATA_DIR` su una cartella dello scratchpad con la **copia
della copia** dell'hub e l'utenza di prova nel suo `hub.db` (procedura del piano di T2, Task 15: password generata sulla
macchina, mai in un argomento). Schermate nello scratchpad.

- [ ] **Mappa** (per cavo accesa come sull'hub, poi spenta da «Dati della mappa» nella copia): NAS → «Unisci con…» → ricerca per IP
  e per nome → anteprima → «Unisci»: un nodo coi tre indirizzi «· unito a mano»; «Separa…» → anteprima → «Separa»: torna; un
  «Separa…» su una fusione automatica (motivo scritto) e su un indirizzo non separabile (disattivato, perché scritto); un non
  admin non vede le voci.
- [ ] **Scheda** di uno dei tre: «Sulla mappa» prima e dopo. **Discovery**: una riga e tre righe.
- [ ] Testo ≥ 13 px nei pezzi nuovi, nessuno stato col solo colore, nessuna fascia, il dialogo dentro lo schermo a 1280.

### Task 9: revisione finale, documenti, cancello

- [ ] **Step 1: revisione finale su Opus** di `git diff origin/dev...topologia/unioni-a-mano`, sui Vincoli globali e sui
  Casi, in particolare: niente righe = mappa di oggi; tabelle scritte solo dalle due rotte con `applica: true`; separazioni
  rispettate dalle regole deboli e ignorate per `host_id` e IP di gestione; rotte (guardia, admin anche per l'anteprima, Zod
  stretto, 409 `cambiato`, nessun `await` fra decisione e scrittura); migrazione; nessun ripiego muto; niente dati veri;
  interfaccia; nessun componente client sopra `db-tenant`. Un giro di correzioni (Opus, l'elenco intero), poi una revisione
  mirata della correzione.
- [ ] **Step 2: documenti** (commit di soli documenti):
  - `docs/adr/0021-unire-e-separare-a-mano.md`: Contesto (il NAS, §10.4 della spec del 12/10, Fatto 3, decisione 1);
    Decisione (Scelte 1-6, 11); Alternative scartate (scrivere `physical_device_id`; una colonna; fondere gli host con lo
    stesso `physical_device_id`, che sarebbe una regola automatica; alias per gli apparati; un interruttore); «che cosa
    diventa difficile»: due funzioni simili convivono; «apparato + apparato» vorrà riscrivere gli id `dev:` nell'ingresso;
    ogni chiamante nuovo dell'indice passa da `indiceDeiNodi` e ogni regola automatica nuova rispetta le separazioni; dopo un
    «Separa» le mappe passo passo che avevano rinominato il membro non lo mostrano più;
  - `CHANGELOG.md` `[Non rilasciato]` → Aggiunte, col perché (il NAS a tre nodi; nessuna regola automatica nuova; migrazione additiva);
  - `CONTEXT.md` §6, «Mappa topologia»: «Unioni a mano (ADR 0021) dalla v‹x›; niente righe = mappa di prima», trappole:
    l'indice solo con `indiceDeiNodi`; un campo nuovo di T1 va passato in `cavi/mappa.ts`; sotto i 10k (`wc -c`);
  - spec 2026-10-12 §10.4 dopo la riga 334: «**Superato il 16/10:** ADR 0021, piano `plans/2026-10-16-apparati-multihomed-unisci.md`.»;
  - `docs/scheda-mappa.md`: la riga delle unioni a mano.
- [ ] **Step 3: il cancello, una volta** —
  `npm run lint && npx tsc --noEmit && DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gate.XXXXXX")" npm test && npm run build`
  `> "$SCRATCH/gate-unioni.log" 2>&1; echo "exit=$?"`; `pass`/`fail` in fondo al log.

### Task 10: la conferma e il rilascio

- [ ] **Step 1: la conferma, una volta e per esteso**, per: (a) i preparativi su appliance del cliente A e VM dell'hub (vie in
  `ACCESSI.md` e nel vault, comandi da stdin, lavori lunghi con `nohup` e log): `df -h` dei dati (libero almeno il doppio della
  somma dei DB; l'hub ~2,1 GB), `PRAGMA quick_check` di **tutti** i tenant (`for f in data/tenants/*.db; do sqlite3 "$f" 'PRAGMA
  quick_check'; done`: «ok» o le 4 pagine «never used» dell'hub), la copia con l'API di backup di ogni tenant in
  `data/backups/<tenant>-pre-unioni-<AAAAMMGG>.db` col suo `quick_check`; (b) il push su `dev` = rilascio al cliente A **con una
  migrazione additiva** e la mappa uguale a oggi; (c) l'aggiornamento dell'hub; (d) il ritorno indietro. Nel messaggio i numeri
  dei Task 7 e 8, l'elenco del Task 7 Step 2 (in chat), i fatti da confermare, e che **col rilascio non si unisce niente**.
- [ ] **Step 2: il rilascio** — preparativi subito prima; `npm run version:release`, `git push origin dev`; l'hub con la skill
  `deploy-prod`. Controlli sulle due macchine: `ActiveEnterTimestamp` dopo il push e riga d'avvio; «nuovo commit su origin/dev»
  di `da-ipam-update` sul cliente A; per ogni tenant «topologia unioni, aggiunto …» e nessuna «migrazione topologia unioni
  fallita»; `SELECT COUNT(*)` delle due tabelle = 0 ovunque; `GET /api/topology/model` con `mappa: "cavi"` e i conteggi della
  copia presa prima del riavvio; nel journal nessuna «[topology] mappa nuova non calcolata» né «[topology] unioni:».

### Task 11: la prima unione, il NAS dell'hub, con l'ok di Riccardo

Scrittura nel DB dell'hub (produzione): con la sua conferma scritta, o la fa lui.

- [ ] Dalla mappa, come admin: «Unisci con…» sul NAS, gli altri due indirizzi, **anteprima** (non scrive) → i numeri a Riccardo;
  col suo ok, «Unisci».
- [ ] In sola lettura: `SELECT * FROM topology_unioni` (tre righe, il suo utente, l'ora); `GET /api/topology/model` con due nodi
  in meno e i collegamenti del NAS sul nodo unito (quelli del Task 7 Step 3); a schermo la mappa automatica, una passo passo con
  uno dei tre, la scheda. Un numero fuori misura → «Separa…» dei due indirizzi (torna com'era, righe con `tolto_il`) e si guarda.

---

## Tornare indietro

- **Senza codice:** «Separa…» di ogni membro: la mappa torna quella di prima, le righe restano con `tolto_*`. Una separazione si
  toglie con «Unisci con…» fra gli stessi oggetti.
- **Col codice:** `git revert` del commit d'unione, `npm run version:release`, push. Le tabelle restano e nessuno le legge. Le mappe
  passo passo che avevano rinominato un membro nell'alias lo danno «non più presente»: si rimette con «Aggiungi collegati».
- I backup del Task 10 servono solo per un DB rovinato: il ripristino è una scrittura di produzione, con la conferma di Riccardo.

## Scelte

**Decise dal piano, col perché** (a Riccardo come fatti da confermare nel messaggio del rilascio):

1. **Una tabella propria**, non `physical_device_id` né una colonna su `hosts`/`network_devices`: il risolutore riscrive
   `physical_device_id` da solo (Fatto 3), quindi una decisione a mano lì si perderebbe senza traccia (e una colonna accanto,
   che il risolutore non conosce, avrebbe lo stesso difetto); e `physical_device_id` guida la deduplica delle scansioni
   (Fatto 1), che un gesto sulla mappa non deve toccare. Due tabelle perché gruppi e coppie hanno forme diverse; mai
   cancellate, così la riga è l'audit.
2. **«Separa» toglie anche le fusioni automatiche deboli** (apparato fisico, MAC, nome, gruppi di host), non l'host del
   `host_id` né quello con l'IP di gestione (sono l'apparato): senza, una fusione automatica sbagliata non avrebbe rimedio; e
   toglie soltanto, quindi non è una regola nuova. In un nodo apparato la coppia è con l'apparato (il gemello esce col membro),
   in un nodo di soli host con ogni altro membro (il union-find non ha altro modo di dire «non insieme»).
3. **I membri sono gli indirizzi** (l'host scelto; per un apparato il suo host; `dev:N` solo senza host): l'unione regge alla
   promozione e alla rimozione dell'apparato (Caso 1).
4. **Il nodo che resta:** un apparato vince su un host; fra soli host l'id più basso col primo nome dei membri, la regola dei
   gruppi automatici di oggi (Fatto 4). Niente scelta nel dialogo; un altro nome si dà con «nome personalizzato».
5. **«Apparato + apparato» fuori tappa:** la rotta lo rifiuta e, se nasce dopo, l'unione non si applica e lo si dice. Un alias
   per un apparato perderebbe i suoi vicini nelle due mappe (Fatto 5), due giorni dopo l'accensione di T3; e due apparati per
   una scatola sono due credenziali e due letture dello stesso telaio, da sistemare togliendo il doppione. Il Task 0 li conta.
6. **Le unioni dopo le regole automatiche, prima delle chiavi e degli indirizzi:** il nodo unito ha tutti gli indirizzi e gli
   alias, i vicini che nominano un suo IP o MAC lo trovano (collegamenti ri-puntati), un'unione non attira altri per nome.
   Correzioni, ★, posizioni, ritocchi e testa da `canonical` (Fatto 5); un collegamento a mano fra due membri sparisce; ruolo,
   «nascosto» e sede dell'apparato; credenziali e scansioni invariate.
7. **Nessun interruttore:** il gesto è già a mano e per oggetto, e senza righe la mappa è quella di oggi (cancello del Task 7).
8. **Campi solo se servono** (`unioni`, `separazioni`, `model.unioni`, come `cavi?`): un campo vuoto cambierebbe impronte,
   ingresso esportato e fixture (Fatto 8).
9. **La funzione per le scansioni resta** e i suoi dati non si convertono; nella scheda due sezioni con nomi diversi («Sulla
   mappa», «IP collegati allo stesso device fisico»). **Confermato da Riccardo il 16/10:** convivono due funzioni simili; riunirle è una
   proposta per dopo.
10. **Il terzo posto è la Discovery**, non «Asset» (Fatto 10); lì c'è già «Stesso device fisico». **Confermato da Riccardo il 16/10.**
11. **Anteprima obbligatoria** (`applica` esplicito, `false` non scrive, calcolata con lo stesso indice della mappa): il
    `--dry-run` di casa in forma di dialogo; è una POST, quindi resta a un admin.
12. **Ricerca sul server**, sull'indice leggero (`getIngressoNodi`), 20 risultati e «+ altri N» (regola 9). «Candidati probabili»
    come `link-candidates` è un miglioramento per dopo.

**Lasciate a Riccardo** (si procede col valore scritto): i tre id del NAS (Task 0); se unire i candidati (b) e (d) del Task 7;
se e quando fare «apparato + apparato».

---

## Auto-revisione (skill writing-plans)

1. **Ogni requisito ha un task.** Decisione 1 → Task 1 (prova 12), 2, 3, 9 (b); decisione 2 → Task 4, 5, 6; decisione 3 →
   Esecuzione, Task 7 Step 2, Task 10. Domande del mandato: sorgente e migrazione → Scelte 1, Task 2; «Separa» a mano e
   automatico → Scelte 2, Task 1 (9-11), Task 3; semantica e nodo che resta, collegamenti, posizioni, ★, ruoli, correzioni,
   credenziali, scansioni → Scelte 3-6, Task 1 (3-8); spento/acceso col freno delle impronte → Vincoli, Task 1 (1), Task 7 Step 1;
   T3 uguale → Task 1 (5), Task 7 Step 3; rotte → Task 3; interfaccia → Task 4-6; prove → Task 1-5, 7, 8; rilascio → Task 10.
2. **Nomi e firme coincidono** fra P3 e i Task 1-6 (riletti dopo la scrittura). `cercaCandidati` ha due omonimi (puro in
   `unioni.ts`, client in `components/topology/unioni/api.ts`), mai nello stesso file.
3. **Niente segnaposto:** fra «‹ ›» solo dati veri che non vanno nel repo (id del NAS, ore delle copie, versione), fissati dalla
   sessione principale nei Task 0, 7 e 10.

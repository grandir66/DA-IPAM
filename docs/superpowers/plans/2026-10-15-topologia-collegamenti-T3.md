# Topologia §13, tappa T3 — una linea per cavo e albero dallo spanning tree — piano di esecuzione

> Si esegue con la skill `subagent-driven-development`, livello **completo**. Le caselle `- [ ]` tengono il conto. Il
> codice è scritto qui solo dove la logica è sottile (regole del modello, chiavi, contrazioni, invarianti, la misura);
> altrove il piano dà file, firme esatte, valori, testi e prove, e chi esegue scrive il codice senza ridisegnare niente.
> La spec si cita per paragrafo: aprila al paragrafo citato, non ricopiarla. Dove la spec lascia una scelta, il piano la
> dichiara (sezione «Scelte»). Le righe citate nel codice sono quelle di `origin/dev` alla v0.3.297, riverificate.

**Obiettivo:** portare il modello per cavo, che oggi si calcola in ombra solo per la traccia (T2), sulla pagina della
mappa e sulla stampa, dietro l'interruttore per cliente `topologia.mappa.cavi` che **nasce spento**: spento, la mappa è
quella di T1 bit per bit; acceso, una linea per collegamento (cavo, fascio, tunnel, ponte radio, senza fili, appartenenza
a un segmento), il segmento come oggetto, l'albero dallo spanning tree, le parole e le forme del §13.10.3.

**Architettura:** T3 non cambia lo schema (l'interruttore sta in `tenant_settings`). Il modello per cavo
(`src/lib/topology/cavi/`) riceve le regole che in T2 mancavano (`NON_CALCOLATO_IN_T2`): identità «telaio, nome, IP»,
prove di ruolo coi fatti di T2, «oltre» una radio non letta, router e firewall virtuali dentro l'hypervisor, bordo per
porta, «dalle VM» solo nei dettagli, verifica a mano per cavo, ★ per collegamento, ruoli «Core» e «Accesso». Una funzione
pura, `modelloMappaCavi`, lo traduce nella forma che la pagina legge già (`TopologyModel`): un `MapLink` per collegamento
col campo `cavo`, i segmenti come `MapNode` di genere `"segmento"`, il campo `cavi` (scelte dello spanning tree, testa,
anomalie, segmenti, ponti radio, ★ di prima). `GET /api/topology/model` legge l'interruttore e sceglie il modello; pagina e
stampa calcolano l'albero con `buildTree`, che quando il modello ha `cavi` usa `primCavi` (lo stesso Prim, con la chiave del
§13.8.3, del modello in ombra). Il modello di T1 (`links.ts`, `model.ts`, `attach.ts`, `node-index.ts`, `vm-ports.ts`,
`vms.ts`, `sites.ts`) **non si tocca**.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, better-sqlite3, `node --import tsx --test`, Zod v4, shadcn v4 su
`@base-ui/react`, React Flow (`@xyflow/react`).

**Spec:** `docs/superpowers/specs/2026-10-14-topologia-collegamenti-reali-design.md` — §13.11.4 (T3.1-T3.7, misure,
conferme), §13.7.2-13.7.8, §13.6.1 (velocità e passi della chiave), §13.6.3-13.6.4, §13.8.2 (le prove che arrivano in T3),
§13.8.3, §13.9, §13.10 (13.10.1, 13.10.3, 13.10.4, 13.10.5), §13.12 (S5-S11, 13.12.2, 13.12.3, 13.12.4 per T3), §13.13.3,
§13.14, §13.15, §13.16, criteri §13.3.0-13.3.6.
**ADR:** 0015 (T1), 0018 (T2, «che cosa diventa difficile»: due modelli, impronte, potatura per fonte); si scrive lo 0019.
**Livello di controllo:** **completo**, deciso da Riccardo il 15/10: zone rosse i dati dei clienti, le scritture nei loro
DB e il modello che decide la mappa. Ogni task dice se è zona rossa e con quale modello si esegue.

## Fatti del 15/10 notte, da cui parte la tappa

Detti senza nomi, IP e MAC (il repo è pubblico); i nomi stanno solo in chat.

1. **T2 è su `dev` dalla v0.3.297.** Riccardo ha acceso le letture **MikroTik** e **controller** sull'hub e sul cliente A;
   **SNMP resta spento** su tutti e due (gli unici «switch» senza controller sono server segnati switch: non c'è niente da
   leggere). Quindi in T3 i fatti veri vengono da: righe di oggi (`device`, `unifi`), letture MikroTik (porte, bridge, MAC
   propri), campi del controller. Il ramo SNMP del modello resta corretto ma **non avrà dati veri**: le sue prove restano
   sulle fixture (famiglia 3, letture B e C della rete-campione in quattro letture).
2. **Prima lettura MikroTik sull'hub** (router di testa): 6 comandi su 6, nessun «non so»; 33 righe di porte, 1 bridge,
   17 MAC propri. **Sul cliente A** le letture partono stanotte: il router 1 ogni ora, gli altri router e le radio
   MikroTik ogni 6 ore; il controller alle 03:00 UTC (le 05:00 italiane fino al 25/10, poi le 04:00).
3. **MSTP:** le uscite T2-a dei router del cliente A non ci sono (le porterà Riccardo). T3 funziona **senza istanze**,
   con il solo albero comune (CIST): un cavo bloccato è «bloccato», mai «in parte». Che cosa cambia quando arriva il Task 3b
   del piano di T2: sezione «Quando arriva il Task 3b del piano di T2».
4. **T2-b fatto stanotte:** `lldpd` su un nodo Proxmox dell'hub, con l'LLDP del firmware X710 spento. Il controller ora
   vede quel nodo **su 4 porte come un apparato solo**: telaio = MAC della prima scheda, port id = MAC di ogni scheda,
   nessun nome di sistema. Nel modello per cavo: quattro cavi verso l'hypervisor, abbinato per telaio (se quel MAC è fra i
   MAC noti delle sue schede), con la porta dell'hypervisor **non nota** (§13.6.1 passi 5-6: quattro nomi diversi verso
   lo stesso apparato senza elenco). T3 non aggiunge una regola «porta remota = MAC di una scheda» (Scelte, punto 3).
5. **Il Task 7 del piano di T2** (lettura dal lato dell'host) è il secondo rilascio di T2, separato. T3 usa la fonte
   `host` **se c'è** (riserva del bond, conferma dei collegamenti «dalle VM», porta dell'host completata dall'altro capo),
   senza dipenderne: tutte le prove con `host` stanno sulle fixture. Sezione «Quando arriva il Task 7 del piano di T2».
6. **Nessuna misura del primo giro** di letture accese: la fa il Task 0, prima di ogni task di codice.

## Vincoli globali (Global Constraints)

- **Livello completo.** Ogni task con logica o dato: prova scritta prima e **vista fallire** (l'uscita rossa nel
  resoconto), poi il codice, poi la prova verde. Esito sempre dal codice d'uscita: `cmd > "$LOG" 2>&1; echo "exit=$?"`,
  log nello scratchpad di chi esegue, mai in `/tmp` con nome fisso.
- **L'interruttore.** Chiave `topologia.mappa.cavi` in `tenant_settings` del DB del cliente, valore JSON
  `{"acceso": true, "da": "<utente>", "il": "<UTC AAAA-MM-GG HH:MM:SS>"}`, stessa forma delle letture di T2. Chiave
  assente, JSON rovinato o `acceso` diverso da `true` = **spento**. Lo scrive solo `PUT /api/topology/settings/mappa`
  (admin); accendere chiede lo schema di T2 (`schemaCaviPresente()`, altrimenti 409). Nessun codice lo accende da solo.
- **Spento = T1, bit per bit.** Con l'interruttore spento `GET /api/topology/model` calcola
  `buildTopologyModel(getTopologyModelInput(staleDays, nowMs))` come oggi e **non legge** niente di T3 (niente
  `getIngressoCavi`). Lo provano: le 7 impronte `PRIMA_DI_T2` di `cavi-ombra.test.ts`, che non cambiano di un carattere;
  la prova sul DB del Task 6; `misura-cavi` sulle copie col codice di prima e con quello di T3 (Task 13). I moduli comuni
  che T3 tocca (`tree.ts`, `edge-look.ts`, `link-attrs.ts`, `api-input.ts`, `map-menus.ts`, `ignored-links.ts`,
  `ignorati.ts`, `print-draw.ts`, i componenti della pagina) prendono la strada nuova **solo** quando c'è `model.cavi` o
  `link.cavo`; le prove di T1 restano verdi senza toccare un numero. A fine tappa
  `git diff origin/dev -- src/lib/topology/{links,model,attach,node-index,vm-ports,vms,sites}.ts` è vuoto.
- **Due modelli (ADR 0018).** Una regola nuova del modello di oggi va anche nel modello per cavo. T3 non aggiunge regole
  al modello di T1: se servisse, è un rilascio a parte, con le impronte ricalcolate e il perché scritto.
- **Nessuna migrazione.** `topology_role` non ha CHECK (`db-tenant-schema.ts:251`): «core» e «accesso» si scrivono lì, e
  il modello di T1 li legge già «rete» (`ruoloLetto`, `identity.ts`). `medium` delle correzioni non ha CHECK: «tunnel» lo
  valida Zod. `topology_link_primary` ha `node_port` e `other_port` (`db-tenant.ts:383-392`).
- **Correzioni che ci sono già:** nessuna conversione automatica (D3, I36). Nessuno script scrive nel DB di un cliente.
- **Repo pubblico.** Niente nomi, IP, MAC, seriali, numeri di VLAN o nomi scelti veri in codice, prove, fixture,
  commenti, commit, documenti: «cliente A», «rete B» (l'hub), «router 1», «core 1», «accesso A», «router di testa»,
  «router di frontiera». Le reti-campione sono **inventate con la forma vera** (§13.12.2): MAC `02:00:…`, nomi di bridge e
  VLAN inventati a caso (`BR_RP`, `VL_3_QWRTY`, `XQ_7_ABC`). Le copie dei DB, le istantanee e le schermate dei dati veri
  restano nello scratchpad; gli elenchi per nome stanno **solo in chat**.
- **Universale (I37, I58).** In `src/lib/topology/cavi/` nessun nome di prodotto né forma di porta di un prodotto, anche
  nei commenti e nelle stringhe; i file nuovi di `cavi/` li legge già `cavi-senza-prodotti.test.ts` (legge la cartella):
  verificalo lanciandola dopo ogni task che crea un file lì. I valori del DB passano da `src/lib/topology/lettori/fonti.ts`.
- **Interfaccia.** Testo **≥ 13 px** (niente `text-xs`); **mai il solo colore** (Riccardo è daltonico: forma o parola
  accanto, luminanza diversa, ogni forma provata in bianco e nero); testi in italiano; schermo di riferimento 1920,
  verifica a 1280 e 1920; niente fasce né spiegazioni sopra la mappa (§13.10.3, «Spazio sullo schermo»); **la bozza prima
  del codice** (Task 1): la Parte 4 parte dopo la risposta di Riccardo.
- **Regole del repo** (`CLAUDE.md` di DA-IPAM): in ogni rotta `requireAuth()`/`requireAdmin()` è la prima istruzione dentro
  `withTenantFromSession`; `db-tenant` solo con import statico (ADR 0002), e nessun componente client importa un modulo
  che importa `db-tenant`; `JSON.parse` sempre in `try`; niente N+1 (una query per tabella, mai una per apparato); liste a
  schermo con limite e «+ altri N»; niente `any` né `console.log`; messaggi in italiano; corpi Zod `.strict()`.
- **Ogni push su `dev` è un rilascio al cliente A entro 15 minuti** (CONTEXT §3): su `dev` solo codice pronto, a fine
  tappa (Task 15), con la conferma di Riccardo. Un commit di soli documenti non riavvia.
- **«Rilasciato»** si legge da `ActiveEnterTimestamp` del servizio dopo l'ora del push, dalla riga d'avvio nel journal e
  dalla riga «nuovo commit su origin/dev (‹hash›)» di `da-ipam-update`; mai da `/api/version` (CONTEXT §3).
- Orari a Riccardo in **ora italiana** (UTC+2 fino al 25/10 alle 3:00, poi UTC+1); nel DB sono UTC.
- **Esecuzione:** al massimo **2 agenti che compilano insieme**, ognuno nel suo worktree; **Opus** per i task di zona
  rossa, **Sonnet** per gli altri; **una revisione per ogni task di zona rossa** (Opus, `review-package` +
  `task-reviewer-prompt.md`, al massimo due giri); **una revisione finale su Opus** di tutta la tappa; mai `git add -A`;
  un commit per task; cancello **una volta** prima del rilascio:
  `npm run lint && npx tsc --noEmit && DA_INVENT_DATA_DIR=<cartella temporanea> npm test && npm run build`, esito dal
  codice d'uscita, log nello scratchpad. `credential-chains.test.ts` cade a caso nella suite intera: se cade, si rilancia
  da sola e il resoconto lo dice (CONTEXT §5).

## Casi da non dimenticare (Review Focus)

1. **Un id `seg:` salvato** in una mappa passo passo (membro, partenza, ritocco) quando il segmento cambia id perché il
   membro con la chiave più piccola esce: si risolve nel segmento che contiene ancora quel membro (alias in `canonical`);
   se nessuno lo contiene, «non più presente», contato (R2, §13.13.3 punto 4) → Task 6 (alias), Task 12 (prova).
2. **Una ★ salvata prima di T3** senza porte, o con porte che non indicano più nessun collegamento: vale per il migliore
   della coppia e i dettagli lo dicono, mai persa in silenzio; una ★ su un cavo bloccato vince (I20) → Task 5, Task 10.
3. **Interruttore acceso e modello per cavo che lancia un'eccezione:** la rotta dà la mappa di T1 con `mappa: "oggi"` e
   `mappaErrore`, lo scrive nel journal, la pagina lo dice («mappa di prima: la nuova non si è potuta calcolare»); mai una
   pagina bianca, mai un ripiego muto (lezione 6) → Task 6, Task 10.
4. **Un fascio con un membro ignorato o giù:** la linea resta (un cavo solo, oppure «fascio di 2 cavi, 1 giù»), la
   velocità è la somma dei membri accesi → Task 4 (modello), Task 9 (parole).
5. **Un fatto di porta vecchio** (`running = 0` di una fonte non più letta, fino a 90 giorni) accanto a un vicino LLDP di
   oggi sulla stessa porta: il cavo **non** è «giù» (M5) → Task 2.

---

## Struttura dei file

| Pezzo della spec | File | Task |
| --- | --- | --- |
| misura del primo giro | `scripts/misura-cavi.ts` (`--cavi`) | 0 |
| T3.7 (dati), M5, M6 | `src/lib/topology/model-types.ts` (tipi), `cavi/collegamenti.ts` (riesporta i tipi), `letture/interruttori.ts` (`leggiStatoChiave`), `letture/mappa.ts` (nuovo), `letture/corpo.ts` (nuovo), `src/app/api/topology/settings/letture/route.ts`, `src/app/api/topology/settings/mappa/route.ts` (nuovo), `src/lib/db-tenant.ts` (`getIngressoCavi`), `src/lib/__tests__/api-auth-guards.test.ts`, `src/components/topology/map/use-topology-data.ts` (tipo `ModelData`) | 2 |
| T3.6, prove di ruolo di T3 (§13.8.2) | `cavi/prove.ts` (`abbina`, `conNome`), `cavi/ruolo.ts` (`proveDiRuoloCavi`, `classiCavi`), `lettori/fonti.ts` (`eReteDalleCapacita`), `cavi/modello.ts` (classi, ponti) | 3 |
| 13.7.4-13.7.8, 13.7.2 passo 10, 13.9 nel modello | `cavi/collegamenti.ts`, `cavi/prove.ts` (correzioni a mano), `cavi/modello.ts` (contesto, «dalle VM», `NON_CALCOLATO`), `ignorati.ts` (`regoleIgnora` con i segmenti), `link-attrs.ts` (`MEDIA`, `macSullaPorta`), `cavi/traccia.ts` (nome della costante) | 4 |
| 13.8.3 (punti 1-8 per la pagina), ★, ruoli | `cavi/albero.ts` (`primCavi`, `risolviStelle`, ruoli, ponti), `identity.ts` (`ruoloRete`), `cavi/modello.ts` | 5 |
| T3.1, T3.2 (nodo), T3.7 (rotta) | `cavi/mappa.ts` (nuovo), `src/lib/topology/mappa-server.ts` (nuovo), `src/app/api/topology/model/route.ts`, `src/app/api/topology/candidati/route.ts` (nuovo), `scripts/misura-cavi.ts` (`--mappa-cavi`) | 6 |
| 13.7.7, 13.8.3 a schermo | `tree.ts` (ramo per cavo di `buildTree`, `proposeHead`), `cavi/albero-pagina.ts` (nuovo: `contrazioni`, `alberoDellaPagina`) | 7 |
| T3.2 (rotte), T3.4 (scritture) | `api-input.ts`, `vm-nodes.ts` (`SEGMENTO_NON_COLLEGABILE`), `map-menus.ts` (`connectRefusal`), `db-tenant.ts` (`setTopologyRole`, `deleteLinkOverride`), `src/app/api/topology/links/[id]/route.ts`, `src/app/api/topology/nodes/role/route.ts` | 8 |
| T3.5 (13.10.3) | `edge-look.ts`, `src/components/topology/map/map-edge.tsx`, `map-node.tsx`, `print-draw.ts` (`printStrokes`), `src/components/topology/print/print-sheet.tsx` (legenda) | 9 |
| T3.1, T3.3, T3.4 (pannello) | `map-menus.ts`, `ignored-links.ts`, `cavi/pannello.ts` (nuovo), `src/components/topology/map/linked-panel.tsx`, `topology-map-client.tsx`, `map-toolbar.tsx` | 10 |
| T3.3 («Anomalie della rete»), T3.7 (pagina), stampa | `letture/testi-mappa.ts` (nuovo), `src/app/(dashboard)/topology/dati/mappa-card.tsx` (nuovo), `anomalie-card.tsx` (nuovo), `dati-client.tsx`, `traccia-card.tsx`, `print-draw.ts` (`redundantCables`), `print-sheet.tsx` | 11 |
| prove di tappa | `src/lib/topology/__tests__/cavi-reti-campione.test.ts`, `cavi-quattro-letture.test.ts`, `cavi-fixture-dedicate.test.ts`, `cavi-scenari.test.ts`, `support/quattro-letture.ts` (nuovi), `reti-campione.test.ts` (tolti gli skip G11-G16), `src/lib/__tests__/topologia-t3-freno.test.ts` (nuovo) | 12 |
| documenti | `docs/adr/0019-mappa-per-cavo-dietro-interruttore.md` (nuovo), `CHANGELOG.md`, `CONTEXT.md` §6, spec §13.11.4 («Stato»), `docs/auth-matrix.md`, `docs/scheda-mappa.md` | 15 |

## Esecuzione

`subagent-driven-development` coi controlli del **livello completo**. Ramo d'unione `topologia/collegamenti-t3` da
`origin/dev`, worktree `$SCRATCH/ipam-t3`; il secondo agente di un'ondata lavora in `$SCRATCH/ipam-t3-b` su un ramo suo
creato dal ramo d'unione (`topologia/collegamenti-t3-<task>`); a fine ondata la sessione principale unisce
(`git merge --no-ff`), lancia le prove toccate e `npx tsc --noEmit`, esito dal codice d'uscita. Dopo ogni task di zona
rossa: una revisione (Opus) prima di unirlo.

| Ondata | Agente A | Agente B | Dopo l'ondata (sessione principale) |
| --- | --- | --- | --- |
| 0 | — | — | P1, P2, **Task 0** (misura del primo giro), **Task 1** (bozza a Riccardo) |
| 1 | Task 2 — interruttore, M5, M6, tipi · **Opus** (zona rossa) | Task 3 — identità e ruolo · **Opus** (zona rossa) | revisioni; unione |
| 2 | Task 4 — collegamenti che mancano · **Opus** (zona rossa) | Task 8 — scritture con gli id nuovi · **Opus** (zona rossa) | revisioni; unione |
| 3 | Task 5 — albero: `primCavi`, ★, ruoli, ponti · **Opus** (zona rossa) | Task 9 — forme e parole · **Sonnet** (solo dopo la risposta alla bozza) | revisione del 5; unione |
| 4 | Task 6 — `modelloMappaCavi` e la rotta · **Opus** (zona rossa) | Task 10 — menu, pannello, dettagli · **Sonnet** | revisione del 6; unione |
| 5 | Task 7 — l'albero della pagina e le contrazioni · **Opus** (zona rossa) | Task 11 — «Dati della mappa» e stampa · **Sonnet** | revisione del 7; unione |
| 6 | Task 12 — prove di tappa · **Sonnet** | — | unione; le correzioni che le prove chiedono al modello: un implementatore **Opus** con l'elenco |
| — | Task 13 (misure), 14 (schermo), 15 (revisione finale, documenti, cancello, copie, rilascio spento): sessione principale | | |
| — | Task 16-18 (accensioni, promozione): sessione principale con Riccardo | | |

**Perché quest'ordine.** I file si toccano in ondate diverse: `cavi/prove.ts` (3, poi 4), `cavi/modello.ts` (3, 4, 5, in
ondate diverse), `db-tenant.ts` (2, poi 8), `map-menus.ts` (8, poi 10), `print-draw.ts` e `print-sheet.tsx` (9, poi 11),
`link-attrs.ts` solo nel 4, `api-input.ts` solo nell'8. I tipi della pagina (`CavoLinea`, `InfoCavi`, `CandidatoPorta`)
nascono nel Task 2, così i task d'interfaccia (9-11) partono senza aspettare il modello. Il 6 vuole il 3, il 4 e il 5; il 7
vuole il 6; il 12 vuole tutto. Se Riccardo non ha ancora risposto alla bozza all'ondata 3, il Task 9 slitta all'ondata 4
(col 6) e il 10 all'ondata 5 (col 7), l'11 all'ondata 6 (col 12): è l'unica fermata ammessa, e riguarda solo la Parte 4.

**Modelli.** Opus dove il codice decide la mappa o scrive nei DB dei clienti (2-8) e per le revisioni; Sonnet per
l'interfaccia (9-11) e per le prove di tappa (12), che non cambiano il modello: se una prova del 12 trova un difetto del
modello, l'agente lo descrive e si ferma su quella prova; la correzione la fa un implementatore Opus (ondata 6, colonna
«Dopo»). Le prove si lanciano dal worktree con `node --import tsx --test <file>`.

---

## Parte 0 — Sessione principale, prima del codice

- [ ] **P1 · Worktree.** `$SCRATCH` è lo scratchpad della sessione che esegue.

```bash
REPO=~/Progetti/Domarc/DA-IPAM
git -C "$REPO" fetch origin
git -C "$REPO" worktree add "$SCRATCH/ipam-t3" -b topologia/collegamenti-t3 origin/dev
git -C "$SCRATCH/ipam-t3" log --oneline -1 -- docs/superpowers/plans/2026-10-15-topologia-collegamenti-T3.md; echo "piano exit=$?"
cd "$SCRATCH/ipam-t3" && npm ci > "$SCRATCH/npm-ci-t3.log" 2>&1; echo "exit=$?"
# il codice di prima di T3 (v0.3.297 o il dev di quel momento), per «spento = T1» del Task 13
git -C "$REPO" worktree add --detach "$SCRATCH/ipam-dev" origin/dev
cd "$SCRATCH/ipam-dev" && npm ci > "$SCRATCH/npm-ci-dev.log" 2>&1; echo "exit=$?"
```

  Atteso: `exit=0`. Se il piano non è ancora su `origin/dev` (sta sul ramo `topologia/t3`):
  `git -C "$SCRATCH/ipam-t3" merge --no-ff origin/topologia/t3 -m "documenti: piano di T3"`. Per ogni ondata con due
  agenti: `git -C "$REPO" worktree add "$SCRATCH/ipam-t3-b" -b topologia/collegamenti-t3-<task> topologia/collegamenti-t3`,
  e `npm ci` anche lì.

- [ ] **P2 · Letture accese e copie fresche.** Le copie si prendono **dopo almeno un giro** di letture accese sull'hub e
  sul cliente A: sul cliente A dopo le 03:00 UTC del 16/10 (controller) **e** almeno 6 ore dopo l'accensione (il giro dei
  router secondari e delle radio). Prima, in sola lettura su ogni macchina, si guarda che l'esito ci sia per tutti gli
  apparati attesi, con l'ora dopo l'accensione:

```sql
SELECT key, length(value) FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';
SELECT value FROM tenant_settings WHERE key = 'topologia.lettura.mikrotik.esito';
SELECT value FROM tenant_settings WHERE key = 'topologia.lettura.controller.esito';
SELECT source, COUNT(*) FROM topology_port_facts GROUP BY source;
SELECT source, COUNT(*) FROM topology_bridge_facts GROUP BY source;
```

  Poi le copie con la **procedura P6 del piano di T2** (che rimanda a P3 del piano di T1): `sqlite3 <db> ".backup
  '/var/tmp/copia-<tenant>.db'"`, `sha256sum` sul server e sul Mac uguali, `rm` della copia sul server, `PRAGMA
  quick_check` sul Mac. Servono la copia del cliente A e quella dell'hub, in `$SCRATCH/copie/`. Si annota l'ora UTC di
  ogni copia (`ADESSO`): ogni misura di questa tappa usa `--adesso` con quell'ora. I percorsi non vanno mai nel repo.

### Task 0: la misura del primo giro di letture accese — sessione principale, prima del codice

Spec §13.11.4 («Misure sulle copie»), §13.3.1, §13.3.2 (C13-C17), §13.3.3 (H1-H21), §13.14 (i collegamenti «dalle VM»),
§13.15 punto 4. **Zona rossa:** sì (dati dei clienti, solo in lettura, sulle copie). **Chi:** la sessione principale.

Lo scopo: sapere **prima del codice** che cosa dice il modello per cavo di oggi (quello in ombra di T2) sui dati veri con
le letture accese, e trasformare ogni differenza dalle mappe attese in un **criterio del modello** (una prova in più nel
task che possiede la regola) o in un **fatto da spiegare** a Riccardo.

**Files:**
- Modify: `scripts/misura-cavi.ts` (opzione `--cavi`; nessun cambio del prodotto)

- [ ] **Step 1: l'opzione `--cavi` di `misura-cavi`** (sul ramo d'unione; commit
  `strumenti(topologia): misura-cavi --cavi, l'elenco dei collegamenti del modello per cavo (T3, Task 0)`). Il modello in
  ombra si calcola **una volta** se c'è `--traccia` o `--cavi` (oggi lo calcola solo il blocco `--traccia`, righe 160-175):
  sposta il calcolo di `ombra` fuori dal blocco e usalo per tutti e due. Poi, prima di `out.quick_check_dopo = quick();`:

```ts
  // T3, Task 0: i collegamenti del modello per cavo in numeri (sempre) e, con --nomi, riga per riga a terminale.
  if (ombra && a.includes("--cavi")) {
    const conta = (xs: readonly string[]) => xs.reduce<Record<string, number>>((o, k) => ({ ...o, [k]: (o[k] ?? 0) + 1 }), {});
    const ipv = new Set(model.vms.flatMap((v) => (v.hypervisorNodeId ? [v.hypervisorNodeId] : [])));
    // §13.14, §13.15 punto 4: i collegamenti che hanno SOLO la prova «dalle VM».
    const dalleVm = ombra.collegamenti.flatMap((c) => {
      if (c.prove.length === 0 || !c.prove.every((p) => p.classe === "vm")) return [];
      const h = ipv.has(c.a.nodo) ? c.a : ipv.has(c.b.nodo) ? c.b : null;
      if (!h) return [];
      const sw = h === c.a ? c.b : c.a;
      const sc = ombra.albero.scelto.get(sw.nodo);
      const uplink = sc === undefined ? "non noto"
        : ombra.collegamenti.some((x) => x.id === sc && ((x.a.nodo === sw.nodo && x.a.chiave === sw.chiave) || (x.b.nodo === sw.nodo && x.b.chiave === sw.chiave)))
          ? "noto, è questa porta" : "noto, è un'altra porta";
      return [{ id: c.id, ipervisore: h.nodo, switch: sw.nodo, porta: sw.nome, vm: c.vm ?? 0, principale: ombra.albero.via.get(h.nodo)?.id === c.id, uplink }];
    });
    out.cavi = {
      per_genere: conta(ombra.collegamenti.map((c) => c.genere)),
      per_stato: conta(ombra.collegamenti.map((c) => c.stato ?? "nessuno")),
      per_fiducia: conta(ombra.collegamenti.map((c) => c.fiducia)),
      non_visti: ombra.collegamenti.filter((c) => c.nonVisto).length,
      porte_da_verificare: ombra.collegamenti.filter((c) => c.porteDaVerificare).length,
      segmenti: ombra.segmenti.length,
      radici: ombra.albero.radici.length,
      anomalie: ombra.albero.anomalie.length,
      avvisi: ombra.albero.avvisi.length,
      dalle_vm: { totale: dalleVm.length, non_principali: dalleVm.filter((x) => !x.principale).length,
        uplink: conta(dalleVm.filter((x) => !x.principale).map((x) => x.uplink)) },
    };
    caviDaStampare = { dalleVm };
  }
```

  `caviDaStampare` è un `let caviDaStampare: { dalleVm: Array<…> } | null = null;` dichiarato accanto a `traccia`. Nel
  blocco `--nomi` esistente, dopo «cosa cambierebbe con la mappa nuova», a terminale e basta:

```ts
    if (ombra && caviDaStampare) {
      const nc = (id: string) => (id.startsWith("seg:") ? `segmento ${id}` : nome(id));
      w("\n— collegamenti del modello per cavo (T3, Task 0) —");
      for (const c of ombra.collegamenti) {
        w(`${c.genere} · ${nc(c.a.nodo)} ${c.a.nome || "?"} ↔ ${nc(c.b.nodo)} ${c.b.nome || "?"} · ${c.stato ?? "—"} · ${c.fiducia}`
          + `${c.velocitaMbps ? ` · ${c.velocitaMbps} Mbps` : ""}${c.nonVisto ? " · non visto" : ""}${c.porteDaVerificare ? " · porte da verificare" : ""}`
          + `${c.wan ? " · WAN" : ""}${c.attraverso ? " · attraverso apparati non letti" : ""}${c.fascioDedotto ? " · fascio dedotto" : ""}`);
      }
      w("\n— segmenti —");
      for (const s of ombra.segmenti) w(`${s.id}: ${s.membri.map((p) => `${nome(p.nodo)} ${p.nome}`).join(", ")}${s.altriApparati ? ` · +${s.altriApparati} non gestiti` : ""}`);
      w("\n— padri del modello per cavo (mappa automatica) —");
      for (const [id, p] of Object.entries(ombra.albero.padri)) w(`${nc(id)} ← ${p === null ? "partenza" : nc(p)}${ombra.albero.scelto.has(id) ? " (porta radice o uplink)" : ""}`);
      w("\n— anomalie e avvisi —");
      for (const x of ombra.albero.anomalie) w(`${nome(x.nodo)} sotto ${nome(x.padre)}; allo stesso livello: ${x.altri.map(nome).join(", ")}`);
      for (const x of ombra.albero.avvisi) w(`${nc(x.nodo)}: ${x.testo}`);
      w("\n— collegamenti «dalle VM» (§13.14) —");
      for (const x of caviDaStampare.dalleVm) w(`${nome(x.ipervisore)} · ${nome(x.switch)} ${x.porta} · ${x.vm} VM · ${x.principale ? "principale" : "NON principale"} · uplink dello switch: ${x.uplink}`);
    }
```

  Verifica: `npx tsc --noEmit` verde, e il giro dello Step 2 che esce con 0 (lo script non ha prove sue: si prova
  sulla copia, come in T2).

- [ ] **Step 2: la misura sulle due copie.**

```bash
cd "$SCRATCH/ipam-t3"
for t in A H; do
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --traccia --cavi --json > "$SCRATCH/t3-giro1-$t.json" 2> "$SCRATCH/t3-giro1-$t.err"; echo "$t exit=$?"
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --traccia --cavi --nomi > "$SCRATCH/t3-giro1-$t-nomi.txt" 2>&1; echo "$t nomi exit=$?"
done
```

  `exit=0`. Il file coi nomi resta nello scratchpad; i nomi si scrivono solo in chat.

- [ ] **Step 3: il confronto riga per riga**, in un registro `$SCRATCH/misure-t3.md` (fuori dal repo):
  - **cliente A, tabella 13.3.1, righe 1-19** (colonna «Dopo T3»): per ogni riga il collegamento trovato (genere, stato,
    fiducia, porte, padre) e «uguale» o la differenza. Le righe **12-17** dipendono da letture che non ci sono (T2-a, le
    radio non lette, `lldpd` sugli host del cliente A): si misurano ma **non fanno da cancello** (§13.3.1, C13); la riga
    13 (tunnel) senza istanze MSTP può dire solo «bloccato» o «inoltra», mai «in parte». Il prototipo di lavoro fuori dal
    repo fa da oracolo per le righe 1-11;
  - **C13-C17** dal JSON (`cavi`, `traccia`, `cavi_ms`): C13 la tabella, core 2 con 3 cavi (1 attivo, 2 bloccati); C14
    padri di un bridge diversi dal vicino sulla porta radice (dai padri e da `scelto`); C15 anomalie (atteso 1, core 2);
    C16 radici (atteso 1 solo dopo il salto radio, che il modello in ombra non ha ancora: oggi 2 o la radio in «Da
    sistemare»); C17 `cavi_ms` (≤ 50 ms sul Mac);
  - **hub, H1-H21** colonna T3 (H3, H5, H6, H8, H11, H12, H18, H19, H20, H21 e quelle di T1 che non devono tornare
    indietro): uguale o la differenza;
  - **il nodo con `lldpd`** (fatto 4): quattro cavi verso l'hypervisor, padre dell'hypervisor (atteso: l'aggregazione a
    10G, H9; se torna sotto lo switch di gestione, è un fatto da portare subito a Riccardo: §13.5.5, «L'ordine col
    firmware delle schede»);
  - **«dalle VM»** (§13.14): l'elenco dei non principali con switch, porta, numero di VM e «uplink dello switch».

- [ ] **Step 4: che cosa farne.** Ogni differenza va in una di tre righe del registro, e da lì nel prompt
  dell'implementatore del task indicato:
  - `Criterio: <regola> — <caso con la forma vera, senza nomi> — Task <N>`: la regola del modello sbaglia un caso di
    rete. Diventa **una prova in più** del task che possiede la regola (4: collegamenti; 5: albero; 3: identità e ruolo),
    scritta su una rete inventata con la stessa forma, e vista fallire prima del codice. Se la regola che la corregge non
    è nella spec, **non si inventa**: diventa un fatto da portare a Riccardo (riga sotto) e il criterio resta aperto.
  - `Fatto: <che cosa> — <perché non è del modello>`: un dato (un router fermo da maggio, una radio non letta, una porta
    rinominata, un apparato non censito). Va a Riccardo coi numeri; i nomi in chat. Nessun codice.
  - `Decisione: dalle VM — <entra | non entra> — <perché> — <che cosa costa se è sbagliata>`: la regola del §13.7.2
    passo 10 **entra** (`DALLE_VM_SOLO_DETTAGLI = true`, Task 4) se ogni collegamento «dalle VM» non principale è una
    ridondanza che nessun'altra lettura vede (le tre verso l'hypervisor 2 del cliente A, M26, e quelle che sull'hub
    risultano col «uplink dello switch: noto, è questa porta» o «non noto»: MAC di VM imparati sulla porta da cui passa il
    traffico); **non entra** (`false`) se anche uno solo è un cavo vero che la mappa attesa conosce. Il registro porta
    l'elenco per nome in chat e la decisione scritta.
  - Le righe 12-17 e la riga 13 senza MSTP: `Fatto: …` (non un criterio), coi valori misurati.

- [ ] **Step 5: i numeri a Riccardo**, in un messaggio solo (ora italiana): le righe uguali e diverse della tabella
  13.3.1, C13-C17, H, la decisione «dalle VM», i criteri nuovi per task. Non si aspetta la risposta per partire con
  l'ondata 1: le sue correzioni entrano come criteri nei task dopo.

### Task 1: la bozza dell'interfaccia di T3 — sessione principale, mandata a Riccardo prima del codice della Parte 4

Spec §13.10.4 (T3), §13.10.3, §13.10.5 («Alla fine»), regola grafica del parco («l'interfaccia si propone oggetto per
oggetto prima di scriverla»). **Zona rossa:** no. **Chi:** la sessione principale, dopo il Task 0, mentre gira l'ondata 1.

- [ ] **Step 1: la bozza statica**, un file HTML nello scratchpad (`$SCRATCH/bozza-t3.html`), costruita sui collegamenti
  della sede 1 del cliente A misurati nel Task 0, **con le etichette della spec al posto dei nomi** («router 1», «core 1»,
  «accesso A»…), così si può aprire anche fuori dalla macchina; mai nel repo. Font Signika, token del marchio, testo
  ≥ 13 px. Mostra, oggetto per oggetto, con le parole esatte del §13.10.3:
  1. il segmento della WAN sotto `ether8` di router 1, riquadro a capsula con «⋯», «segmento» / «modem o switch non
     gestito», «+1 apparati non gestiti»; i due membri (porta 15 di core 1, `ether8` del router di riserva) come ridondanze;
  2. un cavo bloccato a richiesta (core 2, «⇄ 3» sul riquadro, la doppia sottile con «10G · ⊘ bloccato dallo spanning
     tree» dopo il clic) e la sua forma in bianco e nero;
  3. un instradato sullo spazio minimo («2,5G» «instrad…», intero al passaggio del mouse);
  4. un cavo giù (tratteggio lungo «10 4» nero, «cavo giù»), accanto a un «non visto» di oggi (grigio «6 4») per vedere
     che si distinguono per forma e luminanza;
  5. il tunnel EoIP («tunnel», tratto «8 3 2 3»), un ponte radio («≋ radio», radio sulla linea), un fascio («50G» «2
     cavi», nei dettagli «fascio di 2 cavi · 2 × 25G»);
  6. l'anomalia su core 2 («⚠ core sotto accesso» al posto della seconda riga) e il testo intero nei dettagli;
  7. «Candidati per porta» nella barra dei dettagli di router 1 (righe per porta, prove, scelto, scartati col motivo);
  8. nella barra dei dettagli di una linea: «Perché questo cavo», la conclusione «→ certo, principale»;
  9. «Dati della mappa»: la sezione «Mappa nuova (una linea per cavo)» spenta, col pulsante «Accendi» e il testo del
     dialogo; «Anomalie della rete»;
  10. un foglio di stampa A3 in bianco e nero con la legenda nuova e l'elenco «Cavi di ridondanza» con la colonna «stato».
- [ ] **Step 2: il messaggio a Riccardo**, una volta: la bozza (il file, o le schermate a 1280 e 1920), le domande
  **solo** dove la spec non fissa la forma (Scelte 6 e 7: la misura del riquadro del segmento, l'«Ignora» di un fascio
  membro per membro), e che la Parte 4 parte dopo la sua risposta.
  Le correzioni vanno nel registro come `Decisione: bozza — <oggetto> — <correzione>` e nel prompt dei Task 9-11.

---
## Parte 1 — Fondamenta: interruttore, ingresso, tipi, identità e ruolo

### Task 2: l'interruttore `topologia.mappa.cavi`, i fatti vecchi fuori (M5), le prove della rotta delle letture (M6), i tipi della pagina (T3.7, dati)

Spec §13.11.4 (T3.7), §13.5.6 (forma degli interruttori), §13.5.7 («Chi legge che cosa», ultimo giro), §13.7.2 (tipi).
Minori aperti di T2: **M5** (`getIngressoCavi`: l'«ultimo giro» di una fonte non più letta può avere fino a 90 giorni, e
un `running = 0` vecchio diventerebbe «giù») e **M6** (`PUT /api/topology/settings/letture` senza prove di comportamento).
**Zona rossa:** sì (lettura e scrittura in `tenant_settings` e nell'ingresso del modello dei DB dei clienti). **Modello:** Opus.

**Files:**
- Modify: `src/lib/topology/model-types.ts` (tipi nuovi, `LinkMedium`, `MapNode.kind`, `MapLink.cavo`, `TopologyModel.cavi`)
- Modify: `src/lib/topology/cavi/collegamenti.ts` (righe 16-18: i tre tipi si tolgono e si riesportano da `model-types`)
- Modify: `src/lib/topology/letture/interruttori.ts` (`leggiStatoChiave`)
- Create: `src/lib/topology/letture/mappa.ts`, `src/lib/topology/letture/corpo.ts`
- Modify: `src/app/api/topology/settings/letture/route.ts` (il corpo passa da `decidiCorpoLetture`)
- Create: `src/app/api/topology/settings/mappa/route.ts`
- Modify: `src/lib/db-tenant.ts` (`getIngressoCavi`, riga 9570)
- Modify: `src/lib/__tests__/api-auth-guards.test.ts` (`CONTRACT`)
- Modify: `src/components/topology/map/use-topology-data.ts` (riga 21, il tipo `ModelData`: lo leggono i Task 6 e 10)
- Test: `src/lib/topology/letture/__tests__/mappa.test.ts`, `src/lib/topology/letture/__tests__/corpo.test.ts` (nuovi),
  `src/lib/__tests__/topology-cavi-ingresso.test.ts` (un caso nuovo)

**Interfaces:**
- Consumes: `getTenantSetting`, `setTenantSetting`, `schemaCaviPresente`, `scriviFattiTopologia(deviceId, fonte, fatti,
  adesso?)` (`db-tenant.ts`); `StatoInterruttore`, `oraUtc`, `LETTURE`, `LETTURE_DISPONIBILI` (`letture/interruttori.ts`);
  `actorOf`, `readJson`, `NO_STORE` (`controllers/route-helpers`).
- Produces (`model-types.ts`), usati da tutti i task dopo:

```ts
// T3 (spec §13.7.2, §13.10.3): i tipi del modello per cavo che la pagina legge. Stanno qui (nessuna logica), e
// cavi/collegamenti.ts li riesporta: i componenti della pagina non importano la logica del modello.
export type Genere = "cavo" | "fascio" | "tunnel" | "radio" | "senza_fili" | "segmento";
export type StatoCollegamento = "inoltra" | "bloccato" | "bloccato_comune" | "instradato" | "riserva_bond" | "giu" | null;
export type Fiducia = "certo" | "probabile" | "dedotto" | "a_mano_confermato" | "a_mano";
/** Il genere di una linea della pagina: quello del collegamento, più la contrazione di una mappa passo passo (§13.7.7). */
export type GenereLinea = Genere | "contrazione";
// LinkMedium (oggi alla riga 239) riceve «tunnel» (§13.9): una correzione a mano può dichiarare un tunnel.
export type LinkMedium = "cavo" | "fibra" | "wireless" | "tunnel";

/** Il collegamento per cavo dietro una linea (presente solo con la mappa nuova accesa). */
export interface CavoLinea {
  genere: GenereLinea;
  stato: StatoCollegamento;
  fiducia: Fiducia;
  /** Bloccato nell'albero comune, attivo per le VLAN di un'istanza (§13.7.2 passo 8). */
  attivoPerVlan?: number[];
  /** Bloccato fra due bridge della stessa regione MSTP di cui le istanze non sono lette: «… può portare altre VLAN». */
  istanzeNonLette?: boolean;
  /** L'uplink di un gateway del controller: «instradato: la WAN del gateway» (§13.8.3 punto 1). */
  wan?: boolean;
  /** Fra router, un annuncio di segmento come unico vicino: «probabile, attraverso apparati non letti». */
  attraverso?: boolean;
  /** «dedotto: oltre ‹radio›, salto non letto» (§13.7.6 punto 5): l'id della radio vicina. */
  oltre?: string;
  /** Un fascio (§13.6.3): i membri porta per porta, e se è dedotto. */
  fascio?: { membri: Array<{ aPort: string; bPort: string; stato: StatoCollegamento; velocitaMbps: number | null }>; dedotto: boolean };
  /** La prova accoppia porte con velocità diverse (§13.6.1, I45). */
  porteDaVerificare: boolean;
  /** Una linea a mano su porte diverse da quelle viste fra gli stessi oggetti (§13.9). */
  aManoDiverse?: boolean;
  /** Un tunnel sentito da un capo solo (§13.4.6). */
  unVerso?: boolean;
  /** Il capo giù di un collegamento «giu»: «cavo giù: la porta ‹p› di ‹A› è giù» (§13.10.3). */
  giuSu?: { nodo: string; porta: string };
  /** Le prove in parole, senza doppi, nell'ordine in cui le dà il modello («LLDP», «uplink del controller», «partner LACP»…). */
  detti: string[];
  /** «Perché questo ‹genere›» (§13.4.6): le frasi già scritte dal modello, con la conclusione in fondo. */
  frasi: string[];
  /** Solo per una contrazione: che cosa è stato contratto. */
  via?: "segmento" | "radio";
}

/** Ciò che la pagina sa del modello per cavo oltre le linee (presente solo con la mappa nuova accesa). */
export interface InfoCavi {
  /** nodo → id della linea scelta dalla porta radice o dall'uplink del controller (§13.8.3 punto 1). */
  scelto: Record<string, string>;
  /** La testa del modello per cavo (§13.8.3 punto 7), con la scelta dell'admin della mappa automatica già applicata. */
  testa: string | null;
  /** «core che esce da uno switch di accesso» (§13.8.3 punto 8), sulla mappa automatica. */
  anomalie: Array<{ nodo: string; padre: string; porta: string; altri: string[] }>;
  /** In parole, senza dati («uplink del controller su una porta ferma»…). */
  avvisi: Array<{ nodo: string; testo: string }>;
  segmenti: Array<{ id: string; membri: Array<{ nodo: string; porta: string }>; altriApparati: number; frase: string }>;
  /** I capi dei ponti radio: fanno da ponte nell'albero anche se sono server o host (§13.7.6 punto 4). */
  ponti: string[];
  /** ★ scelte prima di T3, senza porte o con porte che non indicano più un collegamento (§13.9). */
  stelleDiPrima: Array<{ nodo: string; altro: string; linea: string }>;
  /** hypervisor → i collegamenti «dalle VM» che non si disegnano (§13.7.2 passo 10). */
  dalleVm: Record<string, Array<{ altro: string; porta: string; vm: number }>>;
  /** Le parti che la mappa nuova non calcola ancora, una riga ciascuna. */
  nonCalcolato: readonly string[];
}

/** Una riga di «Candidati per porta» (§13.4.6): le prove di una porta, il collegamento scelto, gli scartati col motivo. */
export interface CandidatoPorta {
  porta: string;
  prove: Array<{ chi: string; detto: string; quando: string | null }>;
  scelto: { linea: string; verso: string; genere: Genere } | null;
  scartati: Array<{ chi: string; motivo: string }>;
}
```

  e in `MapNode` `kind: "device" | "host" | "segmento";`, in `MapLink` `cavo?: CavoLinea;`, in `TopologyModel`
  `cavi?: InfoCavi;`. In `use-topology-data.ts`: `export type ModelData = TopologyModel & { staleDays: number; status:
  Record<string, TopologyStatus>; mappa?: "oggi" | "cavi"; mappaErrore?: string };`. In `cavi/collegamenti.ts` le righe 16-18 diventano
  `export type { Genere, StatoCollegamento, Fiducia } from "@/lib/topology/model-types";` più l'`import type` per l'uso
  locale: nessun altro file cambia.
- Produces (`letture/interruttori.ts`): `export function leggiStatoChiave(chiave: string): StatoInterruttore` (il corpo di
  oggi di `leggiInterruttore`, che diventa `return leggiStatoChiave(chiaveLettura(l))`).
- Produces (`letture/mappa.ts`):

```ts
/** L'interruttore della mappa nuova (spec §13.11.4, T3.7): per cliente, in tenant_settings, nasce spento (D4). */
export const CHIAVE_MAPPA_CAVI = "topologia.mappa.cavi";
export function leggiMappaCavi(): StatoInterruttore;          // = leggiStatoChiave(CHIAVE_MAPPA_CAVI)
export function mappaCaviAccesa(): boolean;                     // leggiMappaCavi().acceso
export function scriviMappaCavi(acceso: boolean, da: string, adesso: Date = new Date()): StatoInterruttore;
```

- Produces (`letture/corpo.ts`, logica pura, nessun import di `db-tenant`):

```ts
export type DecisioneCorpo<T> = { ok: true; dati: T } | { ok: false; status: 400 | 409; error: string };
export function decidiCorpoLetture(raw: unknown, dip: { schemaPresente: () => boolean }): DecisioneCorpo<{ lettura: Lettura; acceso: boolean }>;
export function decidiCorpoMappa(raw: unknown, dip: { schemaPresente: () => boolean }): DecisioneCorpo<{ acceso: boolean }>;
```

- Produces (rotta): `GET /api/topology/settings/mappa` (`requireAuth`) → `{ stato: StatoInterruttore, schema: boolean }`;
  `PUT` (`requireAdmin`), corpo `{ acceso: boolean }` strict → `{ stato }`; 400 corpo, 409 senza schema (solo per
  accendere), 500 «Errore nel salvataggio della mappa nuova».

- [ ] **Step 1: le prove, viste fallire.**
  - `corpo.test.ts` (M6; il 403 non si prova qui, vedi sotto):
    1. `decidiCorpoLetture({ lettura: "mikrotik", acceso: true }, { schemaPresente: () => true })` → `ok`;
    2. stesso corpo con `schemaPresente: () => false` → `{ ok: false, status: 409, error: "Letture in più non disponibili:
       lo schema di questo cliente non è aggiornato" }`;
    3. `{ lettura: "mikrotik", acceso: false }` senza schema → `ok` (spegnere si può sempre);
    4. una lettura non disponibile accesa → 400 «Questa lettura non è disponibile in questa versione»: la prova prende
       `LETTURE.find((l) => !LETTURE_DISPONIBILI.has(l))`; se non ce n'è nessuna (il Task 7 di T2 è rilasciato) si salta
       con `t.skip("tutte le letture sono disponibili: il Task 7 di T2 è rilasciato")`;
    5. corpo con un campo in più (`{ lettura: "mikrotik", acceso: true, x: 1 }`) → 400 (strict);
    6. lettura sconosciuta → 400 «Lettura sconosciuta»; `acceso: "true"` → 400 «Indica se accendere (true) o spegnere
       (false)»; `null`, `"x"`, `[]` → 400;
    7. `decidiCorpoMappa`: `{ acceso: true }` con schema → `ok`; senza schema → 409 «Mappa nuova non disponibile: lo
       schema di questo cliente non è aggiornato»; `{ acceso: false }` senza schema → `ok`; strict; non booleano → 400
       «Indica se accendere (true) o spegnere (false)».
  - `mappa.test.ts` (sul DB, con `withTenant` e `deleteTenantDatabase` in `after`, come `interruttori.test.ts`): chiave
    assente → spento con `da: null, il: null`; JSON rovinato → spento; `{"acceso":"true"}` → spento; `scriviMappaCavi(true,
    "prova", new Date("2026-10-16T08:00:00Z"))` → `{ acceso: true, da: "prova", il: "2026-10-16 08:00:00" }` e
    `mappaCaviAccesa()` vero; `scriviMappaCavi(false, …)` → spento, con chi e quando.
  - `topology-cavi-ingresso.test.ts`, caso nuovo «M5: un fatto più vecchio della soglia "non visto" non entra»: con
    `scriviFattiTopologia(1, "device", { porte: [un fatto con running: 0] }, <adesso − 3 giorni>)` e
    `getIngressoCavi(2, <adesso>)`, il fatto **non** c'è; scritto a `<adesso − 1 giorno>` c'è. Commento: l'incidente
    (revisione finale di T2, M5) e che cosa rompeva (un cavo visto oggi via LLDP diventava «giù»).
  - `api-auth-guards.test.ts`, in `CONTRACT`: `{ route: "topology/settings/letture", method: "PUT", guard: "requireAdmin" }`,
    `{ route: "topology/settings/mappa", method: "PUT", guard: "requireAdmin" }`, `{ route: "topology/traccia", method:
    "GET", guard: "requireAdmin" }`. **Il 403 a un non admin si prova così** (M6): nel repo `mock.module` non gira sotto
    Node 22 con `tsx` (`meshcentral/__tests__/remote-session.test.ts`), e `requireAdmin` chiama `auth()`; il lucchetto sul
    sorgente è la prova che il repo usa per le guardie, accanto al censimento `rotte-censite.test.ts`.
  Lancia i quattro file: rossi (moduli che non esistono, il fatto vecchio che entra, la rotta che non c'è).

- [ ] **Step 2: il codice.**
  - `getIngressoCavi` (M5): la soglia si calcola **dall'orologio passato** (`nowMs`), non da `datetime('now')`, così la
    misura con `--adesso` resta coerente; niente `oraUtc` da `interruttori.ts` (importa `db-tenant`: sarebbe circolare):

```ts
  // M5 (revisione finale di T2): l'«ultimo giro» di una fonte che non si legge più resta nel DB fino alla potatura (90
  // giorni), e un `running = 0` di allora faceva «giù» un cavo che l'LLDP vede oggi. Un fatto più vecchio della soglia «non
  // visto» non entra: per il modello per cavo quella porta non è letta. Stessa soglia dei collegamenti (staleDays).
  const soglia = new Date(nowMs - staleDays * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  const ultimoGiro = (t: string) =>
    `SELECT f.* FROM ${t} f WHERE f.seen_at >= ? AND f.seen_at >= (SELECT datetime((${giro}), '-5 minutes')) ORDER BY f.device_id, f.source`;
```

    e `.all(soglia)` alle due query dei fatti. `macApparati` e `uplink` non cambiano (non dicono uno stato).
  - `letture/corpo.ts`: lo schema Zod di oggi della rotta (`Corpo`, `.strict()`, messaggi uguali) e i due controlli dopo
    (disponibile, schema), nello stesso ordine; `decidiCorpoMappa` con `z.object({ acceso: z.boolean({ error: "Indica se
    accendere (true) o spegnere (false)" }) }).strict()`. Un corpo che non è un oggetto dà il primo messaggio di Zod, o
    «Richiesta non valida».
  - Rotta delle letture: dopo `requireAdmin`, `const d = decidiCorpoLetture(await readJson(req), { schemaPresente:
    schemaCaviPresente }); if (!d.ok) return NextResponse.json({ error: d.error }, { status: d.status });` — il resto uguale.
  - Rotta della mappa: come quella delle letture. Nel PUT chi e quando stanno già nel JSON scritto (`da`, `il`): è la
    storia, nessuna riga di log in più. Un errore → 500 col messaggio sopra e
    `console.error("[topology] mappa nuova, scrittura:", error instanceof Error ? error.message : "errore")`.
  - Tipi: come sopra. `npx tsc --noEmit` deve passare senza toccare altro: se un `switch` su `MapNode.kind` diventa non
    esaustivo, si aggiunge il caso `"segmento"` che fa quello che fa `"host"` e si scrive perché in una riga.

- [ ] **Step 3: verifica.**

```bash
for f in src/lib/topology/letture/__tests__/corpo.test.ts src/lib/topology/letture/__tests__/mappa.test.ts \
         src/lib/topology/letture/__tests__/interruttori.test.ts src/lib/__tests__/topology-cavi-ingresso.test.ts \
         src/lib/__tests__/api-auth-guards.test.ts src/lib/permessi/__tests__/rotte-censite.test.ts \
         src/lib/topology/__tests__/cavi-ombra.test.ts src/lib/__tests__/topology-cavi-traccia.test.ts; do
  DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/t3.XXXXXX")" node --import tsx --test "$f" > "$LOG" 2>&1; echo "$f exit=$?"
done
npx tsc --noEmit > "$LOG" 2>&1; echo "tsc exit=$?"
```

  Atteso: tutti `exit=0`; `cavi-ombra.test.ts` con le 7 impronte `PRIMA_DI_T2` invariate.

- [ ] **Step 4: commit** — `feat(topologia): l'interruttore della mappa nuova (spento), i fatti vecchi fuori dal modello per
  cavo (M5), le prove della rotta delle letture (M6), i tipi della pagina (T3.7)`.

### Task 3: identità e ruolo nel modello per cavo — l'abbinamento «telaio, nome, IP» (T3.6) e le prove di ruolo coi fatti di T2

Spec §13.6.4 (ultimo punto: «per una riga LLDP prima il telaio, poi il nome, poi l'IP, e l'IP solo dalle righe con una
porta remota fisica»), §13.8.2 (le prove che arrivano in T3: capacità annunciate, BPDU ricevuti, capo di un ponte radio;
«Una prova che in T1b non c'è ancora»), §13.7.6 punto 4. Prove I15, I28, I65. **Zona rossa:** sì (cambia chi è chi e chi
sta nell'albero). **Modello:** Opus.

**Files:**
- Modify: `src/lib/topology/cavi/prove.ts` (`abbina`, righe 227-241; il campo `conNome` della prova)
- Modify: `src/lib/topology/cavi/ruolo.ts` (`proveDiRuoloCavi`, `classiCavi`)
- Modify: `src/lib/topology/lettori/fonti.ts` (`eReteDalleCapacita`)
- Modify: `src/lib/topology/cavi/modello.ts` (classi del modello per cavo, ponti; `ModelloCavi.classi`, `.ponti`)
- Test: `src/lib/topology/__tests__/cavi-prove.test.ts`, `ruolo.test.ts`, `cavi-albero.test.ts` (casi nuovi)

**Interfaces:**
- Consumes: `resolveNode`, `NodeIndex` (`node-index.ts`); `proveDiRuolo(input, idx, { vms, capiRadio, scansioni })`,
  `classeInMappa`, `ruoloLetto` (`cavi/ruolo.ts`, `identity.ts`); `IndiceFatti`, `Prova`, `IngressoCavi` (`cavi/prove.ts`).
- Produces:

```ts
// cavi/prove.ts — Prova ha un campo in più:
/** Almeno una riga del gruppo ha il nome di sistema (non vuoto): solo così le capacità annunciate sono una prova (§13.8.2). */
conNome?: boolean;

// lettori/fonti.ts
/** Capacità annunciate che dicono «apparato di rete» (§13.8.2): bridge, router, AP. Nel formato dei lettori (elenco con virgole). */
export function eReteDalleCapacita(capacita: string | null): boolean;   // bridge | router | wlan-ap

// cavi/ruolo.ts
/** Le prove di ruolo che vede solo il modello per cavo (§13.8.2): capacità con il nome di sistema, spanning tree dai fatti
 * per porta e BPDU ricevuti da chi sta sull'altro capo, capo di un ponte radio. */
export function proveDiRuoloCavi(ing: Pick<IngressoCavi, "fattiPorta">, prove: readonly Prova[], fatti: IndiceFatti,
  capiRadio: ReadonlySet<string>, nominale: (id: string) => NodeClass | null): Map<string, ProvaRuolo[]>;
/** La classe di ogni nodo nel modello per cavo: classeInMappa con le prove di oggi più quelle di T3; un capo di un ponte
 * radio non è mai «client» né «da sistemare» (diventa «att»: sta sulla linea, §13.7.6 punto 4). */
export function classiCavi(nodi: Iterable<Pick<MapNode, "id" | "type" | "vendor" | "proxmoxScan">>,
  prove: ReadonlyMap<string, readonly ProvaRuolo[]>, ruoloAMano: (id: string) => "rete" | "attaccato" | null,
  ponti: ReadonlySet<string>): Map<string, ClasseMappa>;

// cavi/modello.ts — ModelloCavi ha due campi in più:
classi: ReadonlyMap<string, ClasseMappa>;
/** I capi dei collegamenti di genere «radio». */
ponti: ReadonlySet<string>;
```

- [ ] **Step 1: le prove, viste fallire.**
  - `cavi-prove.test.ts`, «T3.6 (I15): il telaio prima dell'IP»: due router inventati R1 e R2; l'host dell'IP
    `10.1.0.1` è fuso in R2 (un indirizzo VRRP che l'inventario ha messo su R2); uno switch sente **una riga** da R1 con
    `remote_mac` = MAC di R1, `remote_ip: "10.1.0.1"`, `remote_port: "ether1"`. Atteso: la prova ha `altro.nodo` = R1.
    Oggi (`abbina` con la riga sola fisica: `resolveNode` prova l'IP per primo, `node-index.ts:279-296`) è R2. Secondo
    caso: una riga con la porta remota logica (`vrrp1`) e solo l'IP → nessun abbinamento per IP (atteso `altro` null, o il
    nome se identifica).
  - `ruolo.test.ts` (o un file nuovo `cavi-ruolo.test.ts`, se `ruolo.test.ts` resta solo per T1b), con reti inventate:
    1. «uno switch visto solo via LLDP che manda BPDU al router torna fra gli apparati di rete»: lo switch S, dichiarato
       switch, senza letture sue; il router sente S via LLDP su `ether5`, e il fatto di porta del router su `ether5` ha
       `bpdu_rx: 12` → `classiCavi` dà «infra» a S (in T1b era «da sistemare»: §13.8.2, il caso dell'hub);
    2. «le capacità "bridge, router" con il nome di sistema sono una prova; senza nome no; per un server noto no»: un host
       classificato switch sentito con `remote_caps: "bridge,router"` e `remote_device_name` non vuoto → «infra»; la stessa
       riga col nome vuoto (l'LLDP del firmware delle schede) → «da sistemare»; un server (nodeClass «att») con le stesse
       capacità → resta «att»;
    3. «`disabled` non è spanning tree» (I65): un fatto con `stp_state: "disabled"` su una porta accesa non dà la prova;
    4. «il capo di un ponte radio sta sulla linea»: un host con classe «client» che è capo di un collegamento di genere
       «radio» → «att», e sta in `ponti`.
  - `cavi-albero.test.ts`: «un capo di un ponte radio classificato server fa da ponte» — router R, radio vicina V
    (server), radio lontana L (host «client»), router di sede S2: con il salto radio letto, S2 sta sotto L, L sotto V, V
    sotto R (oggi V è una foglia e S2 resta senza padre). **Questa prova passa solo dopo il Task 5** (`ponti` nel Prim):
    nel Task 3 si scrive con `{ todo: "Task 5: ponti nel Prim" }`, e il Task 5 toglie il `todo`.

- [ ] **Step 2: il codice.**
  - `abbina`: si toglie la scorciatoia della riga sola (righe 230-231); restano, nell'ordine, MAC delle righe, nome delle
    righe, IP solo dalle righe con la porta remota non logica (`fisica !== false`). Il commento cita §13.6.4 e I15.
  - `conNome` nella prova: `g.righe.some((n) => n.remote_device_name.trim() !== "")`.
  - `eReteDalleCapacita`: `bridge`, `router`, `wlan-ap` (gli stessi valori che `eRadioDalleCapacita` legge, minuscoli).
  - `proveDiRuoloCavi`:

```ts
export function proveDiRuoloCavi(ing: Pick<IngressoCavi, "fattiPorta">, prove: readonly Prova[], fatti: IndiceFatti,
  capiRadio: ReadonlySet<string>, nominale: (id: string) => NodeClass | null): Map<string, ProvaRuolo[]> {
  const out = new Map<string, Set<ProvaRuolo>>();
  const metti = (id: string | null | undefined, p: ProvaRuolo) => { if (id) out.set(id, (out.get(id) ?? new Set<ProvaRuolo>()).add(p)); };
  // Le porte dell'apparato con uno stato di spanning tree attivo, su una porta accesa (I65: `disabled` e `broken` no).
  for (const f of ing.fattiPorta) {
    if (f.running === 0) continue;
    if (STP_ATTIVO.has((f.stp_state ?? "").trim().toLowerCase())) metti(`dev:${f.device_id}`, "spanning_tree");
  }
  for (const p of prove) {
    if (!p.altro || p.altro.nodo === p.da.nodo || p.classe !== "annuncio_collegamento") continue;
    // I BPDU che l'osservatore riceve sulla porta che vede l'altro: l'altro parla lo spanning tree (lo switch di storage
    // dell'hub, §13.8.2).
    if (fatti.porta(p.da.nodo, p.da).some((f) => (f.bpdu_rx ?? 0) > 0 && f.running !== 0)) metti(p.altro.nodo, "spanning_tree");
    // Capacità annunciate: solo con il nome di sistema, mai per un server o un hypervisor noto (§13.8.2).
    const k = nominale(p.altro.nodo);
    if (p.conNome && eReteDalleCapacita(p.capacita ?? null) && k !== "att" && k !== "hyper") metti(p.altro.nodo, "capacita");
  }
  for (const id of capiRadio) metti(id, "radio");
  return new Map([...out].map(([k, s]) => [k, [...s].sort()]));
}
```

    (`STP_ATTIVO` c'è già in `ruolo.ts`, riga 20: si riusa.)
  - `classiCavi`: per ogni nodo `classeInMappa(n, prove.get(n.id), ruoloAMano(n.id))`; poi, se `ponti.has(n.id)` e la
    classe è «client» o «da_sistemare», «att». Restituisce solo le classi (tutte, non solo le diverse da `nodeClass`).
  - `costruisciModelloCavi`, dopo `costruisciCollegamenti`:

```ts
  const ponti = new Set(collegamenti.filter((c) => c.genere === "radio").flatMap((c) => [c.a.nodo, c.b.nodo]));
  const scansioni = new Set(ing.t1.devices.filter((d) => d.proxmox_scan === 1).map((d) => `dev:${d.id}`));
  // Le prove di oggi (le stesse di buildTopologyModel, ricalcolate sull'indice del modello per cavo) e quelle di T3.
  const proveOggi = proveDiRuolo(ing.t1, p.idx, { vms: t1.vms, scansioni });
  const proveT3 = proveDiRuoloCavi(ing, p.prove, p.fatti, ponti, (id) => { const n = p.idx.nodes.get(id); return n ? nodeClass(n) : null; });
  const unite = new Map<string, ProvaRuolo[]>();
  for (const m of [proveOggi, proveT3]) for (const [id, l] of m) unite.set(id, [...new Set([...(unite.get(id) ?? []), ...l])].sort());
  const ruoli = new Map(ing.t1.devices.map((d) => [`dev:${d.id}`, ruoloLetto(d.topology_role)]));
  const nodiTutti = [...p.idx.nodes.values(), ...t1.nodes.filter((n) => !p.idx.nodes.has(n.id))];
  const classi = classiCavi(nodiTutti, unite, (id) => ruoli.get(id) ?? null, ponti);
```

    e `NodoCavi.classe` diventa `classi.get(n.id) ?? t1.classiMappa?.[n.id] ?? nodeClass(n)`; `visibili` resta la regola
    di oggi (non nascosto, non client, non «da sistemare», con un collegamento). Il ritorno porta `classi` e `ponti`.
  - Dalla lista `NON_CALCOLATO_IN_T2` si toglie la riga delle prove di ruolo (la costante cambia nome nel Task 4: qui si
    toglie solo la riga).

- [ ] **Step 3: verifica.** `cavi-prove.test.ts`, `ruolo.test.ts` (o `cavi-ruolo.test.ts`), `cavi-albero.test.ts`,
  `cavi-collegamenti.test.ts`, `cavi-ombra.test.ts`, `cavi-traccia.test.ts`, `cavi-senza-prodotti.test.ts`,
  `model-fixtures.test.ts`, `reti-campione.test.ts`: `exit=0` (il `todo` del Task 5 non fa fallire). Le impronte
  `PRIMA_DI_T2` invariate (il modello di T1 non è toccato). Se un numero di `cavi-ombra.test.ts` sul modello **per cavo**
  cambia (le famiglie 1 e 2 a letture accese), si riscrive col perché nel commento (T3.6 o la prova di ruolo nuova), mai
  senza.

- [ ] **Step 4: commit** — `feat(topologia): il modello per cavo abbina per telaio, nome e IP (T3.6) e prende le prove di
  ruolo coi fatti di T2 (capacità, BPDU, ponti radio)`.

---
## Parte 2 — Le regole che mancano al modello per cavo

### Task 4: i collegamenti che mancano — «oltre» una radio, router virtuali, bordo per porta, «dalle VM», correzioni per cavo

Spec §13.7.2 passi 5, 8, 9, 10; §13.7.4; §13.7.5 (tunnel di livello 3 da un capo, frase); §13.7.6 punto 5; §13.7.8;
§13.9 («Verifica» da T3, «Togli dal segmento», tipo «tunnel», le porte di un cavo ignorato restano occupate); §13.13.3
punto 8 (istanze a metà). Prove I9, I18, I56, I62, I69. **Zona rossa:** sì (il modello che decide la mappa). **Modello:** Opus.
Con i `Criterio: … — Task 4` del registro del Task 0 come prove in più.

**Files:**
- Modify: `src/lib/topology/cavi/collegamenti.ts`, `src/lib/topology/cavi/prove.ts` (correzioni a mano),
  `src/lib/topology/cavi/modello.ts` (contesto, «dalle VM», `NON_CALCOLATO`), `src/lib/topology/ignorati.ts`
  (`regoleIgnora` con i segmenti), `src/lib/topology/link-attrs.ts` (`MEDIA`, `macSullaPorta`); chi importa
  `NON_CALCOLATO_IN_T2` (oggi solo `cavi/modello.ts`: `rg --no-ignore NON_CALCOLATO_IN_T2 src scripts`)
- Test: `src/lib/topology/__tests__/cavi-collegamenti.test.ts`, `cavi-ombra.test.ts` (modello per cavo, se cambia un
  numero col perché), `link-attrs.test.ts` (invariato: la prova che il rifacimento non cambia T1)

**Interfaces:**
- Consumes: Task 3 (`proveDiRuoloCavi`, `classiCavi`, `ModelloCavi.classi`, `.ponti`); `portaOccupata`, `ignorato`
  (`ignorati.ts`); `portaVuota`, `Prova` (`cavi/prove.ts`); Task 2 (tipi in `model-types.ts`).
- Produces:

```ts
// link-attrs.ts — estratta da confirmManual senza cambiarne il comportamento (T1 identico):
/** Un MAC dell'oggetto `altro` (anche di una scheda viva dell'hypervisor o di un host fuso) visto non vecchio sulla porta `porta` di `nodo`. */
export function macSullaPorta(input: TopologyModelInput, idx: NodeIndex, nodo: string, porta: string, altro: string): boolean;
// MEDIA = ["cavo", "fibra", "wireless", "tunnel"]

// ignorati.ts — `segmenti: true` solo dal modello per cavo: un capo «seg:…» resta com'è, con la porta null. Il modello di T1
// non lo passa, e una correzione su un segmento resta fuori dalle sue regole come oggi.
export function regoleIgnora(overrides: readonly LinkOverrideRow[], idx: NodeIndex, porta: (nodo: string, nome: string) => Porta | null,
  opz: { segmenti?: boolean } = {}): Ignorati;

// cavi/prove.ts
// ContestoProve: + macSullaPorta?: (nodo: string, porta: string, altro: string) => boolean
// Prova:        + medio?: LinkMedium | null        (il tipo dichiarato di una correzione a mano)

// cavi/collegamenti.ts
// ContestoCavi: + letti: ReadonlySet<string>      (apparati che leggono vicini propri, qualunque fonte)
//               + rete: ReadonlySet<string>       (apparati di rete per le prove di ruolo, senza i ponti radio)
//               + ipervisori: ReadonlySet<string> (classe «hyper» o hypervisor di una VM)
// Collegamento: + oltre?: string; aManoDiverse?: boolean; unVerso?: boolean; istanzeNonLette?: boolean; medio?: LinkMedium | null
//               giuSu?: { nodo: string; porta: string }   (il primo capo giù, per la parola «cavo giù: la porta ‹p› di ‹A›»)
//               membri?: Array<{ a: Porta; b: Porta; stato: StatoCollegamento; velocitaMbps: number | null }>
// RisultatoCavi: + oltre: Array<{ porta: Porta; radio: string; apparati: string[] }>
//                + scartateBordo: Array<{ porta: Porta; verso: string; motivo: string }>
//                + scartateVm: Array<{ porta: Porta; ipervisore: string }>
/** alias «seg:<apparato>:<porta>» di ogni membro gestito → id di oggi del segmento (§13.7.3: un id salvato si risolve nel
 * segmento che contiene ancora quel membro). Lo usa anche cavi/mappa.ts per `canonical`. */
export function aliasDeiSegmenti(segmenti: readonly Segmento[]): Map<string, string>;

// cavi/modello.ts
/** §13.15 punto 4: decisa dalla misura del Task 0 (riga «Decisione: dalle VM» del registro). */
export const DALLE_VM_SOLO_DETTAGLI: boolean;
export const NON_CALCOLATO: readonly string[];       // sostituisce NON_CALCOLATO_IN_T2
// costruisciModelloCavi(ing, t1, opz: { testaScelta: string | null; dalleVmSoloDettagli?: boolean })
// ModelloCavi: + stessaRete: Prova[]; oltre: RisultatoCavi["oltre"]; scartateBordo: RisultatoCavi["scartateBordo"];
//              + soloDettagli: Array<{ collegamento: Collegamento; ipervisore: string; altro: string; porta: string; vm: number }>
```

- [ ] **Step 1: le prove, viste fallire** — in `cavi-collegamenti.test.ts`, reti inventate con la forma vera (`vic`, `fp`,
  `ingresso` di `support/cavi.ts`; `dev`, `baseInput` di `support/righe.ts`):
  1. **«oltre» (I18, §13.7.6 punto 5)**: router R (`ether3`) ↔ radio vicina V via LLDP di V; V non legge vicini; su
     `ether3` R sente anche il router di sede S2 con una riga `mndp`. Atteso: un collegamento V–S2, genere «cavo»,
     fiducia «dedotto», `oltre = V`, frase «‹S2› si sente dalla porta ether3 oltre ‹V›: sta oltre il ponte radio, il
     salto non è letto.»; con **due** apparati di rete oltre V → nessun collegamento e una voce in `oltre` con 2
     apparati; con S2 solo nella tabella MAC di `ether3` → niente (la tabella MAC di una porta di passaggio non conta);
  2. **router in una VM (§13.7.8, G15, I62)**: un router VR che è una VM dell'hypervisor H; le righe di VR (legge vicini)
     vedono lo switch S → stessa rete, nessun cavo di VR; S vede VR via LLDP sulla porta 4 → il cavo è S:4 ↔ H; VR resta
     senza collegamenti (sta dentro H);
  3. **tunnel di livello 3 da un capo (I69)**: R1 sente R2 con una riga `mndp` su `wg1` (fatto di porta `if_kind:
     "tunnel"`, `running: 1`), R2 non sente R1: R2 censito → genere «tunnel», «probabile», `unVerso`, frase «‹R1› sente
     ‹R2› sul tunnel wg1, ma ‹R2› non sente ‹R1›: il tunnel c'è, e gli annunci passano in un verso solo.»; R2 non
     censito → nessun collegamento; mai un «cavo»;
  4. **bordo per porta (§13.7.2 passo 10, I9)**: la porta 5 dello switch S è il capo di un cavo LLDP verso X; una linea di
     T1 «tabella MAC» S:5 ↔ Y non diventa un collegamento (`scartateBordo`, motivo «la porta è il capo di un cavo verso
     un altro oggetto: non è di bordo»); sulla porta 6, libera, sì; un cavo ignorato S:7 ↔ Z tiene la porta 7 occupata
     verso Z (nessun ritorno dalla tabella MAC), mentre Z su un'altra porta torna;
  5. **«dalle VM» con `lldpd` (I56, seconda parte)**: H ha righe di fonte `host` che vedono S sulla porta 1; un
     collegamento solo «dalle VM» H ↔ S:9 si scarta (`scartateVm`); senza righe `host` resta;
  6. **verifica a mano per cavo (§13.9)**: correzione «add» A:p1 ↔ B:q1 con un cavo LLDP sulle stesse porte → una linea
     sola, «a_mano_confermato»; la stessa correzione su p2/q2 con il cavo su p1/q1 → due linee, quella a mano «a_mano»
     con `aManoDiverse`; il MAC di B visto su A:p2 → «a_mano_confermato» anche senza cavo; porte vuote e un cavo solo fra
     i due → si unisce; porte vuote e due cavi → linea a sé; correzione con `medium: "tunnel"` → genere «tunnel», tenuto
     anche se nessun capo dice «acceso»;
  7. **«Togli dal segmento» (§13.9)**: segmento sulla porta 15 di S con i membri R:ether8 e R2:ether8; la correzione
     «ignore» `{ a_node: R2, a_port: "ether8", b_node: "seg:<S>:15", b_port: "" }` toglie solo l'appartenenza di R2; la
     stessa con l'id di un altro membro (alias `seg:<R>:n-ether8`) fa lo stesso; nessuna delle due è orfana;
  8. **istanze a metà (§13.13.3 punto 8)**: due bridge della stessa regione (nome, revisione, `config_digest`) con il
     collegamento bloccato nell'albero comune e **nessuna** riga d'istanza → «bloccato» con `istanzeNonLette`; con una
     riga d'istanza la cui porta radice è quella → «bloccato_comune» e le VLAN (la prova di T2, invariata);
  9. **fascio con un membro giù (Caso 4)**: due membri da 25G, uno con `running: 0` → «fascio», velocità 25000, il
     membro giù con stato «giu» e la sua velocità;
  10. **«dalle VM» solo nei dettagli (S11, I56)** sulla famiglia 4 (`conHypervisor`) con una VM vista anche su una porta
     di uno switch di accesso: con `dalleVmSoloDettagli: true` quel collegamento non sta in `collegamenti` ma in
     `soloDettagli`; i padri sono **gli stessi** che con `false`; un server con una VM sola tiene il suo principale.

- [ ] **Step 2: il codice.** In `costruisciCollegamenti`, nell'ordine:
  - **le correzioni si leggono all'inizio**: `const ig = regoleIgnora(correzioni, ctx.idx, ctx.portaSalvata, { segmenti:
    true })` sale in testa (serve al bordo); sotto, al posto della riga di oggi, il filtro coi segmenti (punto «Togli»).
  - **le VM (§13.7.8)**, prima di tutto il resto, su una copia delle prove:

```ts
  // §13.7.8 (G15, I62): una VM sta dentro il suo hypervisor. I suoi annunci e la sua tabella MAC passano dal bridge
  // dell'hypervisor: stessa rete, mai un cavo. Chi vede una VM via LLDP vede il cavo dell'hypervisor che la ospita.
  const normali: Prova[] = [];
  for (const p of prove) {
    if (p.tipo === "a_mano") { normali.push(p); continue; }
    if (ctx.vmIpervisore.has(p.da.nodo)) { stessaRete.push(p); continue; }
    const h = p.altro ? (ctx.vmIpervisore.get(p.altro.nodo) ?? null) : null;
    if (h !== null && p.da.nodo !== h) {
      if (p.tipo === "bordo") continue;                 // la VM vista su una porta: lo dice già la prova «dalle VM» di h
      normali.push({ ...p, altro: portaVuota(h), frase: `${p.frase} È una VM di ${ctx.idx.nodes.get(h)?.name ?? h}: il cavo è il suo.` });
      continue;
    }
    normali.push(p);
  }
```

    `stessaRete` si dichiara prima; da qui in giù ogni uso di `prove` diventa `normali`.
  - **«oltre»**, subito dopo il ciclo dei vicini e dopo i ponti radio, prima dell'uplink:

```ts
  // §13.7.6 punto 5 (I18): il router dall'altra parte di un ponte radio non letto. Regola chiusa, eccezione a §11.1 e §11.1 bis
  // solo qui: la porta fisica P di un router ha il suo cavo verso N, che non legge vicini suoi; oltre N, sulla stessa porta,
  // si sente UN solo apparato di rete R (annunci freschi dell'ultimo giro; mai la tabella MAC). Allora R sta oltre N,
  // dedotto. Con due o più nessun collegamento, e la porta lo dice. Una porta che sente due apparati via LLDP è un segmento
  // (§13.7.3, prima di questa regola): qui arrivano solo porte col loro cavo.
  const oltre: RisultatoCavi["oltre"] = [];
  for (const z of [...bozze]) {
    if (z.genere !== "cavo" || z.prove.some((p) => p.tipo === "a_mano" || p.tipo === "bordo")) continue;
    for (const [P, N] of [[z.a, z.b.nodo], [z.b, z.a.nodo]] as const) {
      if (!ctx.router.has(P.nodo) || P.fisica !== true || P.chiave === null || ctx.letti.has(N)) continue;
      const k = chiaveDi(P);
      const sentiti = vicini.filter((q) => chiaveDi(q.da) === k && fresca(q) && q.altro !== null && q.altro.nodo !== N && q.altro.nodo !== P.nodo && ctx.rete.has(q.altro.nodo));
      const R = [...new Set(sentiti.map((q) => q.altro!.nodo))].sort();
      if (R.length === 1) {
        const q = sentiti[0];
        const nome = (id: string) => ctx.idx.nodes.get(id)?.name ?? id;
        aggiungi("cavo", portaVuota(N), portaVuota(R[0]), { ...q, tipo: "cavo", da: portaVuota(N), altro: portaVuota(R[0]),
          frase: `${nome(R[0])} si sente dalla porta ${P.nome} oltre ${nome(N)}: sta oltre il ponte radio, il salto non è letto.` }, null).oltre = N;
      } else if (R.length >= 2) oltre.push({ porta: P, radio: N, apparati: R });
    }
  }
```

    `Bozza` riceve `oltre?: string`; `fiduciaDi` comincia con
    `if (z.oltre !== undefined && z.osservatori.size === 0) return "dedotto";` (dopo il controllo delle correzioni a mano,
    sotto).
  - **bordo per porta e «dalle VM» con `lldpd`**, nel ciclo «partner, bordo, correzioni, tunnel»:

```ts
  // §13.7.2 passo 10 (I9): tabella MAC, VM e ripiego restano le regole di oggi, ma per porta. Una porta che è il capo di un
  // cavo verso un altro oggetto non è di bordo; la porta di un cavo ignorato resta occupata verso quell'oggetto (§13.9).
  const capiDati = new Map<string, Set<string>>();
  for (const z of bozze) for (const [x, y] of [[z.a, z.b], [z.b, z.a]] as const) {
    if (x.chiave !== null && z.prove.some((p) => p.tipo !== "bordo" && p.tipo !== "a_mano")) capiDati.set(chiaveDi(x), (capiDati.get(chiaveDi(x)) ?? new Set<string>()).add(y.nodo));
  }
  const occupata = (x: Porta, verso: string): boolean => x.chiave !== null && [...(capiDati.get(chiaveDi(x)) ?? [])].some((n) => n !== verso);
  // … nel ciclo, al posto di `else if (p.tipo === "bordo") aggiungi(…)`:
  else if (p.tipo === "bordo") {
    if (occupata(p.da, p.altro.nodo) || occupata(p.altro, p.da.nodo) || portaOccupata(ig, p.da.nodo, p.da, p.altro.nodo)) {
      scartateBordo.push({ porta: p.da, verso: p.altro.nodo, motivo: "la porta è il capo di un cavo verso un altro oggetto: non è di bordo" });
      continue;
    }
    if (p.classe === "vm") {
      // Con `lldpd` sull'host (§13.5.5): un collegamento «dalle VM» su una porta che l'host non conferma si scarta.
      const [h, sw] = ctx.ipervisori.has(p.da.nodo) ? [p.da, p.altro] : [p.altro, p.da];
      const dallHost = normali.filter((q) => q.lettore === "host" && q.da.nodo === h.nodo && q.altro !== null);
      if (dallHost.length > 0 && !dallHost.some((q) => q.altro!.nodo === sw.nodo && compatibili(q.altro!, sw))) { scartateVm.push({ porta: sw, ipervisore: h.nodo }); continue; }
    }
    aggiungi("cavo", p.da, p.altro, p, null);
  }
```

  - **correzioni a mano per cavo (§13.9, «Verifica» da T3)**, nello stesso ciclo, al posto della riga `a_mano` di oggi:

```ts
  else if (p.tipo === "a_mano") {
    const genere: Genere = p.medio === "tunnel" ? "tunnel" : p.medio === "wireless" || p.da.senzaFili === true || p.altro.senzaFili === true ? "senza_fili" : "cavo";
    // Da T3 la conferma un cavo visto CON LE STESSE PORTE (o il MAC sulla porta dichiarata, in prove.ts); un cavo fra gli
    // stessi oggetti su altre porte non conferma più ed è una linea sua. Due porte vuote: si unisce solo a un cavo solo.
    const fra = bozze.filter((z) => z.genere === genere && z.prove.some((q) => q.tipo !== "a_mano")
      && ((z.a.nodo === p.da.nodo && z.b.nodo === p.altro!.nodo) || (z.a.nodo === p.altro!.nodo && z.b.nodo === p.da.nodo)));
    const z = aggiungi(genere, p.da, p.altro, p, null, p.da.nome === "" && p.altro.nome === "" && fra.length !== 1);
    if (p.medio) z.medio = p.medio;
    if (z.prove.every((q) => q.tipo === "a_mano") && fra.length > 0) z.aManoDiverse = true;
  }
```

    `fiduciaDi` comincia con:
    `const aMano = z.prove.filter((p) => p.tipo === "a_mano"); if (aMano.length > 0) return z.prove.some((p) => p.tipo !== "a_mano" && p.tipo !== "bordo") || aMano.some((p) => p.confermato) ? "a_mano_confermato" : "a_mano";`
    e nel filtro dei tunnel una correzione a mano tiene il tunnel: `if (z.prove.some((p) => p.tipo === "a_mano")) { tenute.push(z); continue; }`.
    In `prove.ts`, nella riga delle correzioni: `confermato` = `ctx.macSullaPorta?.(l.a, l.aPort, l.b) || ctx.macSullaPorta?.(l.b, l.bPort, l.a)`
    (con `macSullaPorta` assente, il valore di oggi), `medio: l.medium`, frase «Collegato a mano da ‹utente› il ‹giorno›.»
    con utente e giorno della correzione «add» della coppia (`ing.t1.overrides`, nodi per id canonico, la più recente;
    senza: «Collegato a mano.»). «confermato dai dati / non visto dai dati» lo dice la conclusione (`PAROLE_FIDUCIA`).
  - **«Togli dal segmento»**, dopo la costruzione dei segmenti, al posto del filtro `rimaste` di oggi:

```ts
  // §13.9: «Togli ‹A› dal segmento» è una correzione «ignore» con un capo «seg:…». L'id salvato può essere di prima: vale per il
  // segmento che oggi contiene quel membro (come un id salvato in una mappa, §13.7.3).
  const alias = aliasDeiSegmenti(segmenti);
  const igSeg: Ignorati = { regole: ig.regole.map((r) => ({ ...r, a: alias.get(r.a) ?? r.a, b: alias.get(r.b) ?? r.b })), usate: ig.usate };
  const rimaste = [...new Set(tenute)].filter((z) => !ignorato(igSeg, z.a.nodo, z.a, z.b.nodo, z.genere === "segmento" ? null : z.b));
```

    `aliasDeiSegmenti`: per ogni segmento, l'id stesso e `seg:<numero dell'apparato>:<idPorta(m)>` di ogni membro gestito
    con la chiave (la stessa `idPorta` dell'id del segmento, che sale a livello di modulo).
  - **stato e conclusioni**: in `statoDi`, bloccato fra due bridge della stessa regione senza nessuna riga d'istanza su
    nessuno dei due → `{ stato: "bloccato", istanzeNonLette: true }`; i membri di un fascio portano `velocitaMbps:
    velocitaCavo(m)`; un collegamento «giu» porta `giuSu` (il primo capo con `statoCapo(…).giu`, nodo e nome della porta); un tunnel con un osservatore solo fra due router → `unVerso` e la frase sopra; `oltre`,
    `aManoDiverse`, `medio` passano dalla bozza al collegamento. Il ritorno porta `oltre`, `scartateBordo`, `scartateVm`.
  - **contesto (`preparaCavi`)**: `letti = new Set(ing.vicini.map((n) => \`dev:${n.device_id}\`))`; `ipervisori` = classe
    «hyper» più gli hypervisor delle VM; `rete` = i nodi con classe «infra» o «ap» da `classiCavi` con le prove di oggi e
    quelle di T3 **senza** i ponti (`proveDiRuoloCavi(ing, prove, fatti, new Set(), nominale)`): la regola «oltre» non
    può aspettare i ponti, che si conoscono dopo. `ContestoProve.macSullaPorta = (n, p, a) => macSullaPorta(ing.t1, idx, n, p, a)`.
  - **«dalle VM» solo nei dettagli**, in `costruisciModelloCavi` dopo `alberoCavi`:

```ts
  // §13.7.2 passo 10, §13.15 punto 4 (I56, S11): un collegamento con la SOLA prova «dalle VM» che non è il principale del suo
  // hypervisor non si disegna, nemmeno a richiesta: sta nei dettagli dell'hypervisor. L'hypervisor è una foglia, quindi quel
  // collegamento non è il padre di nessuno: toglierlo non cambia l'albero (lo prova la prova 10).
  const soloDettagli: ModelloCavi["soloDettagli"] = [];
  const disegnati = !(opz.dalleVmSoloDettagli ?? DALLE_VM_SOLO_DETTAGLI) ? collegamenti : collegamenti.filter((c) => {
    if (c.prove.length === 0 || !c.prove.every((p) => p.classe === "vm")) return true;
    const h = ipervisori.has(c.a.nodo) ? c.a : ipervisori.has(c.b.nodo) ? c.b : null;
    if (h === null || albero.via.get(h.nodo)?.id === c.id) return true;     // il principale resta, anche con una VM sola
    const sw = h === c.a ? c.b : c.a;
    soloDettagli.push({ collegamento: c, ipervisore: h.nodo, altro: sw.nodo, porta: sw.nome, vm: c.vm ?? 0 });
    return false;
  });
```

    `collegamenti` del ritorno = `disegnati`. `DALLE_VM_SOLO_DETTAGLI` si scrive col valore della riga «Decisione: dalle VM»
    del registro, col commento: data della misura, numero di casi (non i nomi) e che cosa costa se è sbagliata.
  - **`NON_CALCOLATO`** (sostituisce `NON_CALCOLATO_IN_T2`): «lo stato per istanza dello spanning tree, finché le istanze
    non sono lette sulla forma vera (Task 3b del piano di T2)»; «la testa quando l'unico router è una VM: resta la regola di
    oggi, scelta di Riccardo (§13.16, punto 3)»; con `DALLE_VM_SOLO_DETTAGLI = false` anche «i collegamenti "dalle VM" non
    principali restano ridondanze a richiesta: la misura non ha confermato la regola (§13.15, punto 4)».
  - `link-attrs.ts`: `macSullaPorta` è il `sees` di `confirmManual` (righe 93-99) portato fuori; `confirmManual` lo chiama.
    `MEDIA` riceve «tunnel». Nessun altro cambio.

- [ ] **Step 3: verifica.** `cavi-collegamenti.test.ts`, `cavi-prove.test.ts`, `cavi-albero.test.ts`,
  `cavi-ombra.test.ts`, `cavi-traccia.test.ts`, `cavi-traccia-nomi.test.ts`, `cavi-senza-prodotti.test.ts`,
  `link-attrs.test.ts`, `links.test.ts`, `attach.test.ts`, `vm-ports.test.ts`, `model-fixtures.test.ts`,
  `reti-campione.test.ts`, `topology-cavi-traccia.test.ts`, `topologia-t2-freno.test.ts`: `exit=0`; le impronte
  `PRIMA_DI_T2` invariate; nessun numero di T1 toccato. `npx tsc --noEmit` verde.

- [ ] **Step 4: commit** — `feat(topologia): il modello per cavo con «oltre» una radio non letta, i router virtuali dentro
  l'hypervisor, il bordo per porta, «dalle VM» nei dettagli e le correzioni per cavo (§13.7, §13.9)`.

### Task 5: l'albero — `primCavi` per la pagina, ★ per collegamento, ruoli «Core» e «Accesso», ponti radio

Spec §13.8.3 (punti 1-8; 9 e 10 sono del pannello, Task 10), §13.9 (★ per collegamento, ★ di prima, ruoli), §13.7.6
punto 4. Prove I20, I21, I22, I24, I49, I50, I63, I67, I68. **Zona rossa:** sì. **Modello:** Opus. Con i
`Criterio: … — Task 5` del registro del Task 0.

**Files:**
- Modify: `src/lib/topology/cavi/albero.ts`, `src/lib/topology/cavi/modello.ts`, `src/lib/topology/identity.ts`
- Test: `src/lib/topology/__tests__/cavi-albero.test.ts` (le prove di oggi restano **senza toccarle**; casi nuovi; il
  `todo` del Task 3 diventa una prova)

**Interfaces:**
- Consumes: Task 3 (`ModelloCavi.classi`, `.ponti`), Task 4 (`Collegamento`, `ContestoCavi.portaSalvata`), `ModelPrimaryRow`.
- Produces:

```ts
// identity.ts — il ruolo «Core» o «Accesso» scelto a mano (T3, §13.9); ruoloLetto non cambia (T1 li legge «rete»).
export function ruoloRete(v: string | null | undefined): "core" | "accesso" | null;

// cavi/albero.ts
/** Una linea per il Prim: quello che la chiave del punto 3 guarda. Un Collegamento (in ombra) e un MapLink con `cavo` (a
 * schermo, Task 7) diventano la stessa cosa: così schermo e traccia scelgono con lo stesso codice. */
export interface LineaAlbero {
  id: string; a: string; b: string;
  nonVisto: boolean; stato: StatoCollegamento; fiducia: Fiducia;
  verso: string | null; velocitaMbps: number | null; vm?: number;
  /** Solo a mano (le correzioni non scelgono il principale dell'hypervisor). */
  aMano: boolean;
}
export function lineaDi(c: Collegamento): LineaAlbero;
export interface IngressoPrim {
  /** La classe di ogni nodo; undefined = non è un nodo della vista (foglia). */
  classe: (id: string) => ClasseMappa | "segmento" | undefined;
  /** I capi dei ponti radio: fanno da ponte anche se la classe dice foglia (§13.7.6 punto 4). */
  ponti: ReadonlySet<string>;
  visibili: ReadonlySet<string>;
  linee: readonly LineaAlbero[];
  /** Le partenze in ordine: la testa della mappa automatica, o le partenze salvate di una mappa passo passo. */
  partenze: readonly string[];
  scelto: ReadonlyMap<string, string>;
  /** ★: nodo → id della linea scelta a mano, già risolta per collegamento (`risolviStelle`). */
  stelle: ReadonlyMap<string, string>;
  ipervisori: ReadonlySet<string>;
}
export interface EsitoPrim { radici: string[]; padri: Record<string, string | null>; via: Map<string, LineaAlbero>; profondita: Map<string, number> }
export function primCavi(ing: IngressoPrim): EsitoPrim;
export interface Stella { nodo: string; altro: string; linea: string; diPrima: boolean }
export function risolviStelle(cs: readonly Collegamento[], primari: ReadonlyArray<Pick<ModelPrimaryRow, "node_id" | "other_node" | "node_port" | "other_port">>,
  portaSalvata: (nodo: string, nome: string) => Porta | null): Stella[];
// chiaveCavo(c: LineaAlbero, da, to, ctx) — stessa chiave, sulla linea invece che sul collegamento
// IngressoAlbero: + ruoli: ReadonlyMap<string, "core" | "accesso">; + ponti: ReadonlySet<string>;
//   primari: ReadonlyArray<Pick<ModelPrimaryRow, "node_id" | "other_node" | "node_port" | "other_port">>; + portaSalvata
// Anomalia: + porta: string (la porta del padre sul collegamento scelto, per il testo di D2)
// AlberoCavi: + stelle: Stella[]
```

- [ ] **Step 1: le prove, viste fallire** (in `cavi-albero.test.ts`, reti inventate):
  1. **★ per collegamento (§13.9, I20)**: due cavi fra S e X (porte 1 e 2, tutti e due in inoltro, il 2 più lento); ★
     salvata per X con `node_port` = porta 2 di X e `other_port` = porta 2 di S → `via` di X è il cavo 2, `stelle` ha
     `diPrima: false`; la stessa ★ senza porte → il cavo migliore della coppia, `diPrima: true`; con porte che non
     indicano nessun collegamento (una porta rinominata) → il migliore, `diPrima: true`; ★ su un cavo bloccato → vince;
  2. **ruoli (§13.8.3 punto 8, §13.9)**: la rete del caso «core che esce da uno switch di accesso» (la prova di T2 che dà
     l'anomalia) con il ruolo «accesso» a mano su X → nessuna anomalia; un core «core» a mano con padre «accesso» a mano e
     un solo altro switch allo stesso livello → anomalia (la regola dei ruoli vale anche dove la struttura non basta);
     l'anomalia porta `porta`, il nome della porta del padre;
  3. **ponte radio (§13.7.6 punto 4)**: il `todo` del Task 3 diventa prova (V server e L host fanno da ponte, S2 sotto L);
  4. **`primCavi` uguale ad `alberoCavi`**: su ogni rete delle prove di T2 di questo file, `primCavi` con le linee di
     `lineaDi` dà gli stessi `padri` e la stessa `via` (per id) di `alberoCavi`: è l'invariante che il Task 7 usa per dire
     «schermo e traccia scelgono uguale».

- [ ] **Step 2: il codice.**
  - `primCavi` è il corpo di oggi di `alberoCavi` (righe 138-206) **senza** le scelte, la testa e le anomalie, sulle linee:

```ts
export function primCavi(ing: IngressoPrim): EsitoPrim {
  const adj = new Map<string, LineaAlbero[]>();
  for (const c of ing.linee) {
    if (!ing.visibili.has(c.a) || !ing.visibili.has(c.b)) continue;
    adj.set(c.a, [...(adj.get(c.a) ?? []), c]);
    adj.set(c.b, [...(adj.get(c.b) ?? []), c]);
  }
  // Foglie (come oggi): attaccati, client, hypervisor e «da sistemare» non fanno da ponte; il segmento sì; il capo di un ponte
  // radio sì, anche se è un server o un host (§13.7.6 punto 4: eccezione a tree.ts, dove sono foglie).
  const foglia = (id: string): boolean => {
    if (ing.ponti.has(id)) return false;
    const k = ing.classe(id);
    return k === undefined || k === "att" || k === "client" || k === "hyper" || k === "da_sistemare";
  };
  const altro = (c: LineaAlbero, n: string): string => (c.a === n ? c.b : c.a);
  const forzati = new Map(ing.stelle);
  // Punto 6: il principale dell'hypervisor (§12.5): prima il non vecchio, poi il non giù, poi il più veloce, poi più VM.
  for (const id of [...ing.ipervisori].sort()) {
    if (forzati.has(id)) continue;
    const cs = (adj.get(id) ?? []).filter((c) => !c.aMano && !foglia(altro(c, id)));
    if (cs.length < 2) continue;
    forzati.set(id, [...cs].sort((x, y) => Number(x.nonVisto) - Number(y.nonVisto) || Number(x.stato === "giu") - Number(y.stato === "giu")
      || (y.velocitaMbps ?? 0) - (x.velocitaMbps ?? 0) || (y.vm ?? 0) - (x.vm ?? 0) || cmp(x.id, y.id))[0].id);
  }
  const stella = (c: LineaAlbero, to: string): boolean => ing.stelle.get(to) === c.id;
  // … `profondita`, `padri`, `via`, `radici`, `preso`, `cresci(r)` con le due passate e `chiaveCavo(c, x, to, { scelto:
  // ing.scelto, stella, profondita })`, identici alle righe 166-198 di oggi …
  for (const r of ing.partenze) if (ing.visibili.has(r) && ing.classe(r) !== undefined && !preso.has(r)) cresci(r);
  const resto = [...ing.visibili].filter((x) => !preso.has(x) && ing.classe(x) !== undefined).sort((a, b) =>
    Number(ing.classe(a) !== "infra") - Number(ing.classe(b) !== "infra") || (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) || cmp(a, b));
  for (const r of resto) if (!preso.has(r)) cresci(r);
  return { radici, padri, via, profondita };
}
```

    Attenzione: oggi la ★ forza `migliore(…)` della coppia; ora `stelle` arriva già risolta per collegamento (sotto), e la
    `stella` della chiave guarda l'id. `ipervisori` si scorre in ordine (prima era l'ordine d'inserimento: stesso esito,
    perché ogni hypervisor si sceglie da solo).
  - `risolviStelle`:

```ts
export function risolviStelle(cs: readonly Collegamento[], primari: ReadonlyArray<Pick<ModelPrimaryRow, "node_id" | "other_node" | "node_port" | "other_port">>,
  portaSalvata: (nodo: string, nome: string) => Porta | null): Stella[] {
  const out: Stella[] = [];
  for (const s of primari) {
    const fra = cs.filter((c) => (c.a.nodo === s.node_id && c.b.nodo === s.other_node) || (c.b.nodo === s.node_id && c.a.nodo === s.other_node));
    if (fra.length === 0) continue;                                  // irraggiungibile: lo dice il pannello (★ non applicabile)
    const pn = s.node_port.trim() ? portaSalvata(s.node_id, s.node_port) : null;
    const po = s.other_port.trim() ? portaSalvata(s.other_node, s.other_port) : null;
    // Da T3 la ★ vale per il collegamento con quelle porte (§13.9); una ★ di prima (senza porte, o con porte che non indicano
    // più un collegamento) vale per il migliore della coppia, e i dettagli lo dicono.
    const combacia = (c: Collegamento): boolean => (pn !== null || po !== null)
      && (pn === null || (pn.chiave !== null && capo(c, s.node_id).chiave === pn.chiave))
      && (po === null || (po.chiave !== null && altroCapo(c, s.node_id).chiave === po.chiave));
    const esatto = migliore(fra.filter(combacia));
    out.push({ nodo: s.node_id, altro: s.other_node, linea: (esatto ?? migliore(fra)!).id, diPrima: esatto === undefined });
  }
  return out;
}
```

    Gli id delle ★ passano dall'id canonico (`canonical(p.idx, …)`) in `costruisciModelloCavi`, come fa oggi
    `enrichLinks` per il modello di T1.
  - `alberoCavi(ing)` = `scelte(ing)` + `testaCavi` + `risolviStelle` + `primCavi({ … partenze: testa ? [testa] : [] … })`
    + anomalie; `via` torna `Map<string, Collegamento>` passando per gli id. L'anomalia del punto 8 con i ruoli:

```ts
  // Punto 8 con i ruoli a mano (§13.9: «Core · Accesso», solo per correggere l'anomalia): un «accesso» non ha mai l'anomalia;
  // un «core» con il padre «accesso» ce l'ha anche se la struttura non basta; senza ruoli vale la regola dei due switch.
  if (ing.ruoli.get(x) === "accesso") continue;
  const altri = …;   // come oggi
  if (altri.length >= 2 || (ing.ruoli.get(x) === "core" && ing.ruoli.get(p) === "accesso")) anomalie.push({ nodo: x, padre: p, porta: capo(via.get(x)!, p).nome, altri });
```

  - `costruisciModelloCavi`: passa `ruoli` (`ruoloRete(d.topology_role)` per apparato), `ponti` (Task 3), `primari` con le
    porte (`ing.t1.primaries`, id canonici) e `portaSalvata: p.ctx.portaSalvata`.
  - `ruoloRete`: «core» → «core», «accesso» → «accesso», altro → null.

- [ ] **Step 3: verifica.** `cavi-albero.test.ts` (le prove di oggi **senza una riga cambiata**), `cavi-ombra.test.ts`,
  `cavi-traccia.test.ts`, `topology-cavi-traccia.test.ts`, `ruolo.test.ts`, `identity.test.ts`, `model-fixtures.test.ts`:
  `exit=0`; impronte `PRIMA_DI_T2` invariate.

- [ ] **Step 4: commit** — `feat(topologia): l'albero per cavo con la ★ per collegamento, i ruoli «Core» e «Accesso», i
  ponti radio, e il Prim che userà anche la pagina (§13.8.3, §13.9)`.

---
## Parte 3 — Dal modello alla pagina

### Task 6: `modelloMappaCavi`, la rotta del modello che legge l'interruttore, «Candidati per porta», `misura-cavi --mappa-cavi` (T3.1, T3.2, T3.7)

Spec §13.11.4 (T3.1: id della linea per collegamento, «⇄ N» per collegamento; T3.2: il segmento come nodo con l'id `seg:`
e la sua risoluzione; T3.7), §13.7.3 (oggetto segmento, id, alias), §13.4.6 («Candidati per porta»), §13.13.3 punti 3-4.
**Zona rossa:** sì (decide che cosa vede la pagina del cliente). **Modello:** Opus.

**Files:**
- Create: `src/lib/topology/cavi/mappa.ts`, `src/lib/topology/mappa-server.ts`, `src/app/api/topology/candidati/route.ts`
- Modify: `src/app/api/topology/model/route.ts`, `scripts/misura-cavi.ts` (`--mappa-cavi`, `--salva-cavi`,
  `--confronta-cavi`)
- Test: `src/lib/topology/__tests__/cavi-mappa.test.ts` (nuovo), `src/lib/__tests__/topologia-t3-freno.test.ts` (nuovo,
  prima parte: la rotta)

**Interfaces:**
- Consumes: Task 2 (tipi, `mappaCaviAccesa`), Task 3-5 (`ModelloCavi` con `classi`, `ponti`, `stessaRete`, `oltre`,
  `scartateBordo`, `soloDettagli`, `albero.stelle`, `albero.anomalie[].porta`, `aliasDeiSegmenti`); `buildTopologyModel`;
  `motivoDaSistemare` (`da-sistemare.ts`); `piuRecente` (`cavi/prove.ts`); `parseDbDate`; `LINK_SOURCE_RANK`.
- Produces:

```ts
// cavi/mappa.ts — logica pura, nessun import di db-tenant.
/** Il modello per cavo nella forma che la pagina e la stampa leggono (TopologyModel): un MapLink per collegamento, i segmenti
 * come nodi, `cavi` con ciò che serve all'albero e ai dettagli. I nodi, le VM, le sedi e i client sono quelli del modello di
 * oggi; le classi, gli isolati, «Da sistemare», le proposte e i conteggi si ricalcolano sulle linee nuove. */
export function modelloMappaCavi(t1: TopologyModel, m: ModelloCavi, ing: IngressoCavi): TopologyModel & { cavi: InfoCavi };
/** Dall'ingresso alla mappa: il modello di oggi, quello per cavo e la mappa. La testa scelta passa dall'id canonico. */
export function modelloMappaDaIngresso(ing: IngressoCavi, opz: { testaScelta: string | null }): { t1: TopologyModel; m: ModelloCavi; mappa: TopologyModel & { cavi: InfoCavi } };
/** «Candidati per porta» di un nodo (§13.4.6): una riga per porta, con un limite e quante ne restano fuori. */
export function candidatiPerPorta(m: ModelloCavi, nodo: string, nomeDi: (id: string) => string, limite?: number): { righe: CandidatoPorta[]; altri: number };

// mappa-server.ts — solo lato server (import statico di db-tenant, ADR 0002).
export interface ModelloDellaMappa { model: TopologyModel; mappa: "oggi" | "cavi"; errore: string | null; nowMs: number }
export function modelloDellaMappa(staleDays: number, nowMs?: number): ModelloDellaMappa;

// (il tipo `ModelData` con `mappa` e `mappaErrore` l'ha già il Task 2)
```

  Rotte: `GET /api/topology/model` risponde `{ ...model, staleDays, status, mappa, ...(errore ? { mappaErrore } : {}) }`;
  `GET /api/topology/candidati?nodo=<id>` (`requireAuth`) → `{ nodo, righe, altri }`, 400 nodo non valido, **409**
  «"Candidati per porta" c'è solo con la mappa nuova accesa» a interruttore spento, 500 «Errore nel calcolo dei candidati
  per porta».

- [ ] **Step 1: le prove, viste fallire.**
  - `cavi-mappa.test.ts` (su `soloMikrotik`, `soloUnifi`, `mista` con i fatti di T2 di `cavi-ombra.test.ts`, e su una rete
    piccola col segmento della WAN):
    1. **una linea per collegamento**: `mappa.links.length` = `m.collegamenti.length`; ogni `id` è l'id del collegamento;
       ogni linea ha `cavo` con genere, stato, fiducia uguali al collegamento; due cavi fra gli stessi apparati sono due
       linee (ADR 0012 M-2, §13.7.2 passo 11): quello che l'albero non usa è una ridondanza e `redundancyCounts` lo conta
       (T3.1: «⇄ N» conta i collegamenti; in T1 stava fra gli «Altri cavi visti» e non contava);
    2. **il segmento è un nodo**: un `MapNode` con `kind: "segmento"`, `id` del segmento, `name: "segmento"`,
       `type: "segmento"`, `classiMappa[id] = "infra"`, `hidden: false`, nella sede del suo primo membro gestito; le linee
       «membro ↔ segmento» hanno `b = <id del segmento>` e `bPort` vuoto; `cavi.segmenti` ha membri e «+N»;
    3. **alias**: `canonical["seg:<apparato>:<porta>"]` di ogni membro gestito = id del segmento (Caso 1);
       `resolveMapView` con un id di membro diverso dall'id attuale lo porta sul segmento (`renames` lo dice); un id che
       nessun segmento contiene → `missing`;
    4. **★**: `primary: "user"` e `primaryFor` sulla linea risolta da `albero.stelle`; `cavi.stelleDiPrima` ha solo quelle
       `diPrima`;
    5. **isolati e «Da sistemare» ricalcolati**: un apparato con solo un collegamento «radio» non è isolato (C16); un
       nodo che è una VM non entra mai negli isolati;
    6. **«dalle VM»**: `cavi.dalleVm[<hypervisor>]` ha l'altro capo, la porta e il numero di VM; quelle linee non ci sono;
    7. **«Candidati per porta»**: la porta del router della WAN dà una riga con le prove dei membri, `scelto` = la linea
       verso il segmento, e gli scartati col motivo (una riga `mndp` → «sentito solo con un annuncio di rete: stessa
       rete»); una porta con un nome scelto → «nome scelto: non si sa se è una porta fisica»; la porta di bordo scartata
       → il motivo del Task 4; `oltre` con due apparati → «Oltre ‹N› ci sono 2 apparati di rete: il salto non è letto»;
       il limite e `altri`.
  - `topologia-t3-freno.test.ts`, prima parte (sul DB, `withTenant`, i dati di `soloMikrotik` scritti con le funzioni di
    `db-tenant` come fa `topologia-t2-freno.test.ts`): con l'interruttore **assente**, rovinato o spento,
    `modelloDellaMappa(2, ORA)` dà `mappa: "oggi"` e `serializza(model) === serializza(buildTopologyModel(
    getTopologyModelInput(2, ORA)))`; acceso (`scriviMappaCavi(true, …)`) → `mappa: "cavi"`, `model.cavi` presente,
    almeno una linea con `cavo`.

- [ ] **Step 2: il codice.**
  - `lineaDellaMappa(c, ctx)` (non esportata): `id`, `a`/`aPort` = `c.a.nodo`/`c.a.nome`, `b`/`bPort` = `c.b.nodo`/
    (`""` se `b` è un segmento, altrimenti `c.b.nome`); `sources` dalle classi delle prove con la tabella sotto, senza doppi,
    ordinate con `LINK_SOURCE_RANK`, `source` = la prima; `uplinkFrom = c.verso`; `lastSeen = piuRecente(prove.visto)`,
    `daysUnseen` dal `nowMs` dell'ingresso, `stale = c.nonVisto`; `medium` = `c.medio` se c'è, altrimenti «wireless» per
    «senza_fili» e «radio», «tunnel» per «tunnel», null; `manual` = `{ confirmed: c.fiducia === "a_mano_confermato" }` se c'è
    una prova a mano; `speedMbps = c.velocitaMbps`; `poeW` = il massimo PoE delle due porte da `ing.t1.portInfo` (stessa
    lettura di `enrichLinks`, `link-attrs.ts:149-152`); `primary`/`primaryFor` dalle stelle; `redundant: false` (lo mette
    l'albero); `vmCount = c.vm`; nessun `altriCavi` né `perche` (una linea è un cavo); `cavo` = `CavoLinea` coi campi del
    collegamento (`giuSu` compreso), `detti` = i `detto` delle prove senza doppi, `frasi = c.frasi`, i membri di un fascio coi nomi delle porte.

```ts
// Le classi delle prove nelle fonti di oggi, solo per i campi che la pagina di T1 legge già (`source`, `sources`): con la
// mappa nuova le parole vengono da `cavo.detti`. Il partner LACP vale come un annuncio di collegamento: non attraversa un
// apparato, come LLDP. Una fonte nuova in LinkSource cambierebbe `linksBySource` del modello di T1, che resta com'è.
const FONTE_DELLA_CLASSE: Readonly<Record<Classe, LinkSource>> = {
  annuncio_collegamento: "lldp", annuncio_segmento: "mndp", uplink: "unifi_uplink", spanning_tree: "lldp", fascio: "lldp",
  tabella_mac: "mac_table", vm: "vm_mac", a_mano: "manual",
};
```

  - `modelloMappaCavi`:
    - `nodes` = `t1.nodes` più un nodo per segmento (`{ id, kind: "segmento", refId: 0, name: "segmento", type: "segmento",
      mgmtIp: null, fusedHostIds: [], addresses: [], aliases: [], siteId: <sede del primo membro gestito per id>, rackId:
      null, siteProposed: true, hidden: false, vendor: null }`), in ordine di id come `model.ts`;
    - `classiMappa` = per ogni nodo la classe di `m.classi` dove è diversa da `nodeClass`, i segmenti «infra»; le VM come
      in `model.ts` (escluse);
    - `links` = `m.collegamenti.map(lineaDellaMappa)`, in ordine di id;
    - `isolated`, `daSistemare`, `promote`, `suspicious`, `withoutSite` e `counts` con le **stesse regole** di
      `buildTopologyModel` (`model.ts:78-140`) sulle linee nuove (il grado conta le linee per cavo; un nodo «segmento»
      non è mai isolato né in «Da sistemare»); le chiavi di `counts` restano quelle di `ModelCounts`;
    - `sites` = quelle di `t1`, con l'id di ogni segmento aggiunto ai `nodeIds` della sede del suo primo membro;
    - `canonical` = `t1.canonical` più `aliasDeiSegmenti(m.segmenti)` dove l'alias è diverso dall'id;
    - `correzioniOrfane = m.correzioniOrfane`; `vms`, `portClients`, `clientCount`, `unmatched`, `gatewayDi`,
      `segmenti` (il campo di T1) come in `t1`;
    - `cavi` = `{ scelto: Object.fromEntries(m.albero.scelto), testa: m.albero.testa, anomalie: m.albero.anomalie,
      avvisi: m.albero.avvisi, segmenti: m.segmenti.map(…membri { nodo, porta: nome }…), ponti: [...m.ponti].sort(),
      stelleDiPrima: m.albero.stelle.filter((s) => s.diPrima).map(({ nodo, altro, linea }) => ({ nodo, altro, linea })),
      dalleVm: <da m.soloDettagli, per ipervisore>, nonCalcolato: m.nonCalcolato }`.
  - `modelloMappaDaIngresso`: `t1 = buildTopologyModel(ing.t1)`; `testa = opz.testaScelta ? (t1.canonical[opz.testaScelta]
    ?? opz.testaScelta) : null`; `m = costruisciModelloCavi(ing, t1, { testaScelta: testa })`; `mappa = modelloMappaCavi(t1, m, ing)`.
  - `candidatiPerPorta`: per le porte del nodo, raggruppate per chiave (o nome normalizzato senza chiave), in ordine di
    nome con i numeri (`localeCompare(…, "it", { numeric: true })`): `prove` = le prove dei collegamenti con `da` su quella
    porta (`chi` = nome dell'altro, `detto`, `quando` = `visto`); `scelto` = il collegamento che ha quella porta come capo
    (`linea`, `verso` = nome dell'altro capo, `genere`); `scartati` da `m.stessaRete` (motivi: annuncio di segmento →
    «sentito solo con un annuncio di rete: stessa rete»; `da.fisica === false` → «sentito da un'interfaccia logica (VLAN,
    VRRP, bridge): stessa rete»; `da.fisica === null` con `traduttoreLocale` → «nome scelto: non si sa se è una porta
    fisica»; tunnel → «tunnel spento o stato non letto»; altrimenti «stessa rete, non un cavo»), da `m.scartateBordo`
    (il suo motivo) e da `m.oltre` («Oltre ‹N› ci sono ‹n› apparati di rete: il salto non è letto»). Limite di base 64.
  - `modelloDellaMappa`:

```ts
export function modelloDellaMappa(staleDays: number, nowMs: number = Date.now()): ModelloDellaMappa {
  // Spento (o assente, o rovinato): la mappa di T1 com'era, senza leggere niente di T3 (spec §13.11.4, T3.7; R7).
  if (!mappaCaviAccesa()) {
    const input = getTopologyModelInput(staleDays, nowMs);
    return { model: buildTopologyModel(input), mappa: "oggi", errore: null, nowMs: input.nowMs };
  }
  const ing = getIngressoCavi(staleDays, nowMs);
  try {
    const { mappa } = modelloMappaDaIngresso(ing, { testaScelta: getAutoMap()?.head_node ?? null });
    return { model: mappa, mappa: "cavi", errore: null, nowMs: ing.t1.nowMs };
  } catch (e) {
    // Mai una pagina bianca, mai un ripiego muto (Caso 3): la mappa di prima, detta nel journal e a schermo.
    console.error(`[topology] mappa nuova non calcolata, si mostra quella di prima: ${e instanceof Error ? e.message : "errore"}`);
    return { model: buildTopologyModel(ing.t1), mappa: "oggi", errore: "La mappa nuova non si è potuta calcolare: si vede quella di prima.", nowMs: ing.t1.nowMs };
  }
}
```

  - Rotta del modello: `const { model, mappa, errore, nowMs } = modelloDellaMappa(staleDays);` e `status` da
    `statusForModel(model.nodes.filter((n) => n.kind !== "segmento"), computeStatusByNode(getTopologyData(), nowMs))`.
  - Rotta dei candidati: `requireAuth` prima istruzione; il nodo con `parsePortsQuery`; il nome di ogni oggetto dai nodi
    del modello di oggi; `NO_STORE`.
  - `misura-cavi`: `--mappa-cavi` calcola `modelloMappaDaIngresso({ ...getIngressoCavi(soglia, base.nowMs), t1: input },
    { testaScelta: viste.auto?.head_node ?? null })` 30 volte (mediana in `mappa_cavi_ms`, C17), l'impronta
    (`impronta_mappa_cavi`), e con `computeMapView` sulla mappa (stessa testa, ritocchi e orientamento della mappa
    automatica salvata) i numeri in `out.mappa_cavi`: `radici`, `padri_diversi_da_oggi` (contro i padri del modello di
    oggi della stessa misura), `testa_cambiata`, `isolati`, `da_sistemare`, `segmenti`, `anomalie`, `per_genere`,
    `per_stato`, `stelle_di_prima`, `dalle_vm_nei_dettagli`, e per ogni mappa salvata e orientamento i ritocchi validi e
    scaduti e gli oggetti persi (R2), come fa oggi per T1 (righe 205-218). `--salva-cavi <file>` / `--confronta-cavi
    <file>` (dentro `--cartella`) salvano e confrontano i padri della mappa nuova. Con `--nomi`: padri diversi da oggi,
    isolati, «Da sistemare» e anomalie coi nomi, a terminale.

- [ ] **Step 3: verifica.** `cavi-mappa.test.ts`, `topologia-t3-freno.test.ts`, `cavi-ombra.test.ts`,
  `topology-cavi-traccia.test.ts`, `map-view.test.ts`, `rotte-censite.test.ts`, `api-routes-export-handlers.test.ts`,
  `no-dynamic-db-tenant-import.test.ts`: `exit=0`; `npx tsc --noEmit` verde. `misura-cavi --mappa-cavi` si prova sulle
  copie nel Task 13 (lo script non ha prove sue).

- [ ] **Step 4: commit** — `feat(topologia): la mappa nuova dietro l'interruttore — una linea per collegamento, il segmento
  come oggetto, «Candidati per porta» (T3.1, T3.2, T3.7)`.

### Task 7: l'albero della pagina per cavo e le contrazioni nelle mappe passo passo

Spec §13.7.7, §13.8.3 (a schermo), §13.10.3 («I cavi bloccati si vedono a richiesta»), prove I40, I57. **Zona rossa:** sì
(decide l'albero che vede il cliente). **Modello:** Opus.

**Files:**
- Create: `src/lib/topology/cavi/albero-pagina.ts`
- Modify: `src/lib/topology/tree.ts` (`buildTree` riga 48, `proposeHead` riga 165: un ramo ciascuno, solo con `model.cavi`)
- Test: `src/lib/topology/__tests__/cavi-albero-pagina.test.ts` (nuovo); `tree.test.ts`, `map-compute.test.ts`,
  `tree-layout*.test.ts`, `map-screen.test.ts` invariati

**Interfaces:**
- Consumes: Task 5 (`primCavi`, `LineaAlbero`, `IngressoPrim`), Task 6 (`model.cavi`, `MapLink.cavo`, nodi «segmento»).
- Produces:

```ts
// cavi/albero-pagina.ts
/** §13.7.7: in una vista, un segmento o un ponte radio che non sta fra gli oggetti visibili si contrae in linee fra gli
 * oggetti visibili che lega, con la parola «segmento» o «≋ radio». Senza, Prim farebbe due radici (I40). */
export function contrazioni(model: TopologyModel, visible: ReadonlySet<string>): MapLink[];
/** L'albero della pagina con la mappa nuova: lo stesso Prim del modello per cavo (`primCavi`) sulle linee della vista. */
export function alberoDellaPagina(model: TopologyModel, visible: ReadonlySet<string>, roots: readonly string[]): TreeResult;
export function lineaDellaVista(l: MapLink): LineaAlbero;
// tree.ts: buildTree(model, visible, roots) → con model.cavi, alberoDellaPagina(…); proposeHead(model) → con model.cavi, model.cavi.testa
```

- [ ] **Step 1: le prove, viste fallire** (`cavi-albero-pagina.test.ts`):
  1. **schermo = traccia**: su `soloMikrotik`, `soloUnifi`, `mista` coi fatti di T2 e sulla rete del segmento della WAN,
     `computeMapView(mappa, { auto: true, … })` dà gli stessi padri di `m.albero.padri` (stessa testa);
  2. **I40, contrazione di un segmento**: mappa passo passo coi due membri del segmento e senza il segmento → una radice
     sola, una linea `contr:…` con `cavo.genere = "contrazione"`, `cavo.via = "segmento"`; aggiunto il segmento alla
     mappa, la contrazione sparisce e il segmento sta sotto il membro più vicino alla partenza;
  3. **contrazione di un ponte radio**: router R, radio V e L, router S2; mappa passo passo con R e S2 → una linea
     «≋ radio» (`via: "radio"`), S2 sotto R; una contrazione non usata dall'albero non resta fra le linee (non è un cavo
     e non conta nel «⇄ N»);
  4. **I57, bloccati a richiesta**: core 2 con due cavi bloccati e uno attivo → i bloccati sono `redundant`,
     `visibleEdges(links, { showAll: false, selected: null })` non li disegna, `redundancyCounts` dà 2 su core 2, con
     `selected = core 2` si disegnano;
  5. **spento = T1**: `buildTree` su un modello **senza** `cavi` è quello di oggi: le prove di `tree.test.ts` e le
     impronte `PRIMA_DI_T2` non cambiano.

- [ ] **Step 2: il codice.**

```ts
export function contrazioni(model: TopologyModel, visible: ReadonlySet<string>): MapLink[] {
  const cavi = model.cavi;
  if (!cavi) return [];
  const passaggio = new Set([...cavi.segmenti.map((s) => s.id), ...cavi.ponti].filter((id) => !visible.has(id)));
  if (passaggio.size === 0) return [];
  const adj = new Map<string, MapLink[]>();
  for (const l of model.links) for (const n of [l.a, l.b]) adj.set(n, [...(adj.get(n) ?? []), l]);
  const visti = new Set<string>();
  const out: MapLink[] = [];
  for (const inizio of [...passaggio].sort()) {
    if (visti.has(inizio)) continue;
    // La componente degli oggetti di passaggio non visibili, e gli oggetti visibili sul suo bordo con la loro linea.
    const comp = new Set([inizio]);
    const coda = [inizio];
    const bordo = new Map<string, MapLink>();
    let via: "segmento" | "radio" = inizio.startsWith("seg:") ? "segmento" : "radio";
    while (coda.length) {
      const x = coda.shift()!;
      for (const l of adj.get(x) ?? []) {
        const y = l.a === x ? l.b : l.a;
        if (passaggio.has(y)) { if (!comp.has(y)) { comp.add(y); coda.push(y); } if (y.startsWith("seg:")) via = "segmento"; }
        else if (visible.has(y) && !bordo.has(y)) bordo.set(y, l);
      }
    }
    for (const x of comp) visti.add(x);
    const capi = [...bordo.keys()].sort();
    const radice = [...comp].sort()[0];
    for (let i = 0; i < capi.length; i++) for (let j = i + 1; j < capi.length; j++) {
      const la = bordo.get(capi[i])!, lb = bordo.get(capi[j])!;
      out.push(contratta(`contr:${radice}:${capi[i]}~${capi[j]}`, capi[i], la, capi[j], lb, via));
    }
  }
  return out;
}
```

  `contratta(id, x, lx, y, ly, via)`: `LINK_ATTRS_DEFAULT` più `a: x`, `aPort` = la porta di `x` su `lx`, `b: y`, `bPort` =
  la porta di `y` su `ly`; `sources` unite; `lastSeen` la più vecchia delle due; `stale` se una delle due lo è;
  `speedMbps` la minima; `cavo: { genere: "contrazione", via, stato: <"giu" se una delle due è giù, altrimenti "inoltra">,
  fiducia: <la peggiore delle due>, porteDaVerificare: false, detti: [], frasi: [via === "segmento" ? "via segmento non
  gestito: non è in questa mappa" : "via ponte radio: le radio non sono in questa mappa"] }`.
  `alberoDellaPagina`: linee = `model.links` + `contrazioni(…)`; `classe(id)` = `model.classiMappa?.[id] ?? nodeClass(n)`
  per i nodi del modello (undefined altrimenti); `stelle` dalle linee con `primary === "user"` e `primaryFor`;
  `ipervisori` = classe «hyper» più gli hypervisor delle VM; `scelto` da `model.cavi.scelto`; `primCavi`; poi
  `TreeResult` come `buildTree` (righe 107-113): `children` nell'ordine in cui `padri` li ha ricevuti, `links` = le linee con
  i due capi visibili **tranne le contrazioni non usate**, annotate `primary: "auto"`/`"user"` e `redundant`; `via` sulle
  copie annotate. `lineaDellaVista(l)` = `{ id, a, b, nonVisto: l.stale, stato: l.cavo?.stato ?? null, fiducia:
  l.cavo?.fiducia ?? "probabile", verso: l.uplinkFrom, velocitaMbps: l.speedMbps, vm: l.vmCount, aMano: l.manual !== null }`.
  In `tree.ts`: prima riga di `buildTree` `if (model.cavi) return alberoDellaPagina(model, visible, roots);`, prima riga
  di `proposeHead` `if (model.cavi) return model.cavi.testa;` (la testa confermata di una sede vale già lì,
  `testaCavi`). `autoVisible`, `missingNeighbors`, `computeMapView` e la disposizione non cambiano: i segmenti sono
  «infra» in `classiMappa`, le radio dei ponti almeno «att». `cavi/albero-pagina.ts` finisce nel pacchetto del browser
  (lo importa `tree.ts`, che usa la pagina): come `albero.ts`, `collegamenti.ts` e `prove.ts`, non importa `db-tenant` né
  moduli di Node; lo dice `npm run build` del cancello.

- [ ] **Step 3: verifica.** Il file nuovo, `tree.test.ts`, `map-compute.test.ts`, `tree-layout.test.ts`,
  `tree-layout-lr.test.ts`, `map-screen.test.ts`, `print-draw.test.ts`, `print-tiles.test.ts`, `cavi-ombra.test.ts`,
  `cavi-senza-prodotti.test.ts`: `exit=0`, nessun numero di oggi cambiato.

- [ ] **Step 4: commit** — `feat(topologia): l'albero della pagina per cavo, con le contrazioni nelle mappe passo passo
  (§13.7.7, §13.8.3)`.

### Task 8: le scritture con gli id nuovi — `seg:` nelle rotte, «tunnel», «Core» e «Accesso», la ★ che non cade più per coppia

Spec §13.7.3 («Nelle rotte»), §13.9 (tabella: «Ignora» su un segmento, ★ per collegamento, tipo «tunnel», ruoli), T3.2,
T3.4. **Zona rossa:** sì (scritture nei DB dei clienti con valori nuovi). **Modello:** Opus.

**Files:**
- Modify: `src/lib/topology/api-input.ts` (righe 51-66, `linkSchema`, `LinkPatch`, `roleSchema` riga 320-325),
  `src/lib/topology/vm-nodes.ts` (`SEGMENTO_NON_COLLEGABILE` accanto a `VM_NON_COLLEGABILE`, riga 18),
  `src/lib/topology/map-menus.ts` (`connectRefusal`, riga 48), `src/lib/db-tenant.ts` (`setTopologyRole` riga 9934,
  `deleteLinkOverride` riga 9991), `src/app/api/topology/links/[id]/route.ts` (DELETE), `src/app/api/topology/nodes/role/route.ts`
- Test: `src/lib/topology/__tests__/api-input.test.ts` (la prova della riga 223 si riscrive col perché), `map-menus.test.ts`,
  `src/lib/__tests__/topology-db.test.ts` (o un file nuovo `topology-t3-scritture.test.ts`)

**Interfaces:**

```ts
// api-input.ts
/** L'id di un segmento (§13.7.3): «seg:<id apparato>:<indice>» oppure «seg:<id apparato>:n-<nome codificato con encodeURIComponent>». */
const SEG = /^seg:\d+:(\d+|n-[A-Za-z0-9\-_.!~*'()%]{1,90})$/;
const NODE_ANY = z.string({ error: "Nodo non valido" }).max(120, "Nodo non valido")
  .refine((v) => /^(dev|host|vm):\d+(:\d+)?$/.test(v) || SEG.test(v), "Nodo non valido");
// LINK_NODE resta NODE_ANY senza le VM: accetta «seg:» (★ e «Togli dal segmento»); «add» con un segmento si rifiuta nello
// schema dei collegamenti con SEGMENTO_NON_COLLEGABILE.
const MEDIUM = z.enum(["cavo", "fibra", "wireless", "tunnel"], { error: "Tipo non valido: «cavo», «fibra», «wireless» o «tunnel»" });
// roleSchema: z.enum(["", "rete", "attaccato", "core", "accesso"], { error: "Ruolo non valido: «» (decide il sistema), «rete», «attaccato», «core» o «accesso»" })
export function parseNodeRoleBody(raw: unknown): Parsed<{ deviceId: number; role: "" | "rete" | "attaccato" | "core" | "accesso" }>;

// vm-nodes.ts
export const SEGMENTO_NON_COLLEGABILE = "Un segmento non si collega a mano: si collegano gli apparati che ne fanno parte.";

// db-tenant.ts
export function setTopologyRole(deviceId: number, role: "" | "rete" | "attaccato" | "core" | "accesso"): Esito;
/** `perCavo` (mappa nuova accesa): toglie solo la ★ con le stesse porte della correzione tolta (ADR 0010 N-2 superato, §13.9);
 * senza, come oggi: ogni ★ della coppia. */
export function deleteLinkOverride(id: number, opz?: { perCavo?: boolean }): boolean;
```

- [ ] **Step 1: le prove, viste fallire.**
  - `api-input.test.ts`: `seg:114:15` e `seg:1:n-ether8` accettati da `parseMapNodesBody`, `parsePositionsBody` (ritocco e
    rinomina), `parsePortsQuery`, `parsePrimaryBody`, `parsePrimaryDeleteBody`; `parseLinkOverrideBody` «ignore» con
    `b_node: "seg:114:15"` accettato, «add» rifiutato con `SEGMENTO_NON_COLLEGABILE`; rifiutati `seg:1`, `seg:x:1`,
    `seg:1:n-a|b`, `seg:1:n-` e un id di 121 caratteri; `parseAutoHeadBody` e `parseHiddenBody` rifiutano `seg:` (un
    segmento non è una testa e non si nasconde); `medium: "tunnel"` accettato in creazione e in modifica; la prova di riga
    223 diventa «"core" e "accesso" si scrivono da T3 (§13.9): li legge il modello per cavo, quello di T1 li legge "rete"».
  - `map-menus.test.ts`: `connectRefusal("dev:1", "seg:1:5")` = `SEGMENTO_NON_COLLEGABILE`.
  - DB: correzione «add» A:p1 ↔ B:q1 e una ★ per A su (B, p2, q2); `deleteLinkOverride(id, { perCavo: true })` → la ★
    resta; con una ★ per A su (B, p1, q1) → tolta; `deleteLinkOverride(id)` senza opzioni → come oggi, tolta in ogni caso
    (la prova di oggi resta). `setTopologyRole(id, "core")` scrive «core».

- [ ] **Step 2: il codice.** `linkSchema` riceve un `superRefine` («add» con un capo `seg:` → l'errore su `a_node` o
  `b_node`); `LinkPatch.medium` riceve «tunnel»; `deleteLinkOverride` legge anche `a_port`, `b_port` e con `perCavo`
  esegue
  `DELETE FROM topology_link_primary WHERE (node_id = ? AND other_node = ? AND node_port = ? AND other_port = ?) OR (node_id = ? AND other_node = ? AND node_port = ? AND other_port = ?)`
  con `(a_node, b_node, a_port, b_port, b_node, a_node, b_port, a_port)`; la rotta DELETE passa
  `{ perCavo: mappaCaviAccesa() }`; la rotta del ruolo accetta il tipo allargato (il messaggio d'errore dal parser).

- [ ] **Step 3: verifica.** `api-input.test.ts`, `map-menus.test.ts`, `connect-form.test.ts`, il file del DB,
  `rotte-censite.test.ts`, `api-auth-guards.test.ts`: `exit=0`; `npx tsc --noEmit` verde.

- [ ] **Step 4: commit** — `feat(topologia): le rotte accettano l'id del segmento, il tipo «tunnel» e i ruoli «Core» e
  «Accesso»; la ★ non cade più per coppia con la mappa nuova (T3.2, T3.4)`.

---
## Parte 4 — Interfaccia (parte dopo la risposta di Riccardo alla bozza del Task 1)

I tre task partono dai testi che il §13.10.3, il §13.4.6 e il §13.9 fissano alla lettera, più le correzioni della bozza
(righe `Decisione: bozza — …` del registro). Tutto ciò che è nuovo si vede **solo** con `model.cavi` o `link.cavo`: a
interruttore spento la pagina è quella di oggi. Testo ≥ 13 px, mai il solo colore, mai fasce sopra la mappa.

### Task 9: forme e parole delle linee e dei riquadri (T3.5)

Spec §13.10.3 (le due tabelle, «Combinazioni», «Spazio per le parole», «I cavi bloccati si vedono a richiesta»),
§13.10.1 (`latiVicini` per ridondanze, bloccati, instradati, segmenti), prove I30, I31, I32. **Zona rossa:** no. **Modello:** Sonnet.

**Files:**
- Modify: `src/lib/topology/edge-look.ts`, `src/components/topology/map/map-edge.tsx`, `src/components/topology/map/map-node.tsx`,
  `src/components/topology/map/map-canvas.tsx` (dati del riquadro: segmento, anomalia), `src/lib/topology/print-draw.ts`
  (`printStrokes`), `src/components/topology/print/print-sheet.tsx` e `print-map.tsx` (legenda e linee in bianco e nero)
- Test: `src/lib/topology/__tests__/edge-look.test.ts` (casi nuovi; quelli di oggi invariati), `print-draw.test.ts`

**Interfaces:**
- Consumes: Task 2 (`CavoLinea`, `InfoCavi`); `CHAR_W`, `fitLabel` (`tree-layout-consts.ts`); `lrLabelMaxWidth` (`map-screen.ts`).
- Produces (`edge-look.ts`):

```ts
// EdgeLook: + nero?: boolean (cavo giù: tratto scuro, mai il grigio di «non visto»); + centro?: string («⋯» della contrazione)
/** La parola dello stato (§13.10.3): «corta» sulla linea dell'albero, «intera» su una ridondanza e nei dettagli. */
export function parolaStato(c: CavoLinea, forma: "corta" | "intera", nomeDi: (id: string) => string): string | null;   // «giù» intera usa c.giuSu
/** Un pezzo d'etichetta che non sta nel suo spazio si accorcia con «…» (I32): resta intero al passaggio del mouse. */
export function pezzoNelloSpazio(pezzo: string, maxCaratteri: number): string;
export const TRATTI: Readonly<{ nonVisto: "6 4"; aMano: "1.5 4"; giu: "10 4"; tunnel: "8 3 2 3" }>;
```

- [ ] **Step 1: le prove, viste fallire** (`edge-look.test.ts`):
  - per ogni stato e genere della prima tabella del §13.10.3 la parola corta e intera **alla lettera** («bloccato» /
    «⊘ bloccato dallo spanning tree»; «in parte» / «⊘ bloccato nell'albero comune · VLAN ‹n› attiva»; con `istanzeNonLette`
    «⊘ bloccato nell'albero comune · può portare altre VLAN»; «instradato» / «instradato, fuori dal bridge», con `wan`
    «instradato: la WAN del gateway»; «cavo giù» / «cavo giù: la porta ‹p› di ‹A› è giù»; «2 cavi» / «fascio di 2 cavi ·
    2 × 25G», con un membro giù «fascio di 2 cavi, 1 giù», dedotto «fascio dedotto»; «tunnel» / «tunnel EoIP» o il tipo
    letto; «≋ radio» / «≋ ponte radio»; «riserva» / «riserva del bond: si usa se cade l'altra scheda»; «oltre ‹radio›» /
    «dedotto: oltre ‹radio›, salto non letto»; contrazione «segmento» o «≋ radio», «via segmento non gestito: non è in
    questa mappa»);
  - **combinazioni** (seconda tabella): l'ordine dei pezzi (velocità, stato, poi PoE, ★, «✎ ✓/?»); «giù» senza velocità;
    «tunnel ▲» per un tunnel acceso con annunci vecchi; un tunnel spento non arriva qui (non è una linea);
  - **I30**: ogni stato ha una parola **e** una forma, e due stati diversi non hanno la stessa coppia (tratto, doppia,
    ondulata, nero) — in bianco e nero (`printStrokes`) restano distinti; «giù» (`10 4`, nero) ≠ «non visto» (`6 4`,
    grigio); il tunnel `8 3 2 3` non coincide con nessuno dei tre di oggi;
  - **I32**: `pezzoNelloSpazio("instradato", 8)` = «instrad…»; ogni parola corta della tabella misurata con `CHAR_W`
    contro i 60 px di testo di `lrLabelMaxWidth` minimo: quelle di 8 caratteri o meno restano intere;
  - **a interruttore spento**: un `MapLink` senza `cavo` dà lo stesso `EdgeLook` di oggi (le prove di oggi invariate),
    salvo `medium: "tunnel"` che dà il pezzo «tunnel».

- [ ] **Step 2: il codice.**
  - `edgeLook(l, opts)`: con `l.cavo`, i pezzi sono velocità (non per «giù»), lo stato (`parolaStato`, corto sulla linea
    dell'albero, intero altrimenti; una ridondanza non ripete «ridondanza» se lo stato lo dice già), poi PoE, ★, a mano;
    `dash` = `TRATTI.giu` per «giu», `TRATTI.tunnel` per il genere «tunnel», altrimenti le regole di oggi; `nero` per
    «giu»; `wavy` per «radio», «senza_fili» e la contrazione via radio; `double` per le ridondanze (bloccati e riserva del
    bond lo sono già); `centro: "⋯"` per la contrazione via segmento.
  - `map-edge.tsx`: `nero` → `stroke: var(--foreground)` pieno (mai il grigio), il `centro` scritto a metà linea con lo
    stesso stile delle parole, i pezzi accorciati con `pezzoNelloSpazio` e interi nel `title`. Ridondanze, bloccati,
    instradati, membri di un segmento e contrazioni usano già `latiVicini` (sono ridondanze o non sono dell'albero).
  - `map-node.tsx`, `BoxData` riceve `segmento?: { altri: number } | null` e `anomalia?: string | null`:
    - un nodo «segmento»: riquadro a capsula (`rounded-full`), bordo pieno sottile (mai tratteggiato: è «host da
      promuovere»), simbolo «⋯», due righe «segmento» / «modem o switch non gestito», sotto «+N apparati non gestiti» se
      `altri > 0`; nessuno stato del monitoraggio; stesse misure della disposizione (Scelte, punto 6);
    - l'anomalia: «⚠ core sotto accesso» **al posto della seconda riga** (IP o tipo, `map-node.tsx:86-88`), che resta nel
      `title` e nei dettagli; accorciata con `fitLabel` su un riquadro stretto.
  - `map-canvas.tsx`: `segmento` da `model.cavi.segmenti`, `anomalia` per `model.cavi.anomalie[].nodo`.
  - `printStrokes` (`print-draw.ts`): «giù» col tratto `10 4` in `INK`, il tunnel `8 3 2 3`, ondulata per radio; la
    legenda di `print-sheet.tsx` aggiunge, **solo con `model.cavi`**, le righe: bloccato, instradato, cavo giù, fascio,
    tunnel, ponte radio, riserva del bond, segmento, contrazione — ognuna col suo campione in bianco e nero.

- [ ] **Step 3: verifica.** `edge-look.test.ts`, `print-draw.test.ts`, `map-screen.test.ts`, `print-tiles.test.ts`:
  `exit=0`; `npx tsc --noEmit` e `npm run lint` verdi; `rg --no-ignore 'text-xs' src/components/topology` vuoto.

- [ ] **Step 4: commit** — `feat(topologia): forme e parole della mappa nuova — stati, fasci, tunnel, ponti radio,
  segmento, anomalia (T3.5)`.

### Task 10: menu, pannello dei collegati e dettagli per cavo (T3.1, T3.3, T3.4 a schermo)

Spec §13.9 (testi del tasto destro e del dialogo, «Scegli il cavo da ignorare…», ★ di prima, ruoli), §13.4.6 («Perché
questo ‹genere›», «Candidati per porta»), §13.8.3 punti 8-10, §13.7.2 passo 10 («visto dalle VM anche su ‹porta›»),
Caso 3 («mappa di prima»). **Zona rossa:** no (le scritture passano dalle rotte del Task 8). **Modello:** Sonnet.

**Files:**
- Create: `src/lib/topology/cavi/pannello.ts` (logica pura dei testi del pannello)
- Modify: `src/lib/topology/map-menus.ts` (`edgeMenuItems`, `ruoloVoci`), `src/lib/topology/ignored-links.ts`
  (`testiIgnora` per genere; `testiIgnoraCavo` resta per le linee senza `cavo`), `src/components/topology/map/linked-panel.tsx`, `topology-map-client.tsx`,
  `map-toolbar.tsx`, `src/components/topology/map/api.ts` (lettura dei candidati)
- Test: `src/lib/topology/__tests__/cavi-pannello.test.ts` (nuovo), `map-menus.test.ts`, `ignored-links.test.ts`

**Interfaces:**

```ts
// cavi/pannello.ts
export function titoloPerche(g: GenereLinea | undefined): string;   // «Perché questo cavo|tunnel|ponte radio|fascio|collegamento»
/** §13.8.3 punto 10: la ★ non usata perché l'altro capo si raggiunge solo passando dal nodo stesso. */
export function stellaNonApplicabile(l: MapLink, tree: TreeResult, nomeDi: (id: string) => string): string | null;
/** §13.8.3 punto 9: «‹X› è raggiungibile da ‹testa›: sta nell'albero sotto ‹padre›», una riga per partenza scartata. */
export function partenzeScartate(c: Pick<MapComputed<TopologyModel>, "savedRoots" | "tree">, nomeDi: (id: string) => string): string[];
/** Il testo di D2 nei dettagli (§13.8.3 punto 8), titolo e corpo. */
export function testoAnomalia(a: InfoCavi["anomalie"][number], nomeDi: (id: string) => string): { titolo: string; testo: string };
export function testoStellaDiPrima(): string;   // «★ scelta prima che le linee fossero per cavo: ora vale per il cavo migliore fra questi due apparati. Scegli il cavo»
export function righeDalleVm(righe: InfoCavi["dalleVm"][string], nomeDi: (id: string) => string): string[];   // «visto dalle VM anche su ‹porta› di ‹switch› (N VM)»
// map-menus.ts
export function edgeMenuItems(l: MapLink, isAdmin: boolean, nomeDi?: (id: string) => string): Array<MenuItem<EdgeMenuKey>>;
export function ruoloVoci(attuale: RuoloMappa, conCavi?: boolean): Array<{ value: RuoloMappa; label: string }>;   // RuoloMappa + "core" | "accesso"
// ignored-links.ts
export function testiIgnora(genere: GenereLinea | undefined, a: string, aPort: string, b: string, bPort: string, fonti: string): { titolo: string; testo: string };
// api.ts
export function fetchCandidati(nodo: string): Promise<{ ok: true; data: { righe: CandidatoPorta[]; altri: number } } | { ok: false; message: string }>;
```

- [ ] **Step 1: le prove, viste fallire** (`cavi-pannello.test.ts`, `map-menus.test.ts`, `ignored-links.test.ts`):
  - voce del tasto destro per genere: «Ignora questo cavo…», «Ignora questo tunnel…», «Ignora questo ponte radio…»,
    «Ignora questo fascio…», «Togli ‹A› dal segmento…»; nessuna voce su una contrazione; senza `cavo` la voce di oggi;
  - dialogo: titolo «Ignorare il cavo ‹A› · ‹porta› ↔ ‹B› · ‹porta›?» (e le parole del genere), testo «Questo cavo
    sparisce da tutte le mappe, anche se le letture continuano a vederlo (‹fonti›). Gli altri cavi fra ‹A› e ‹B›, se ci
    sono, restano. I dati letti non si toccano.» più `IGNORA_SI_ANNULLA`; per un segmento «Togliere ‹A› dal segmento?»;
  - `stellaNonApplicabile`: ★ su A→B con B discendente di A → «★ non applicabile: ‹B› si raggiunge solo passando da ‹A›»;
    ★ usata → null;
  - `partenzeScartate`: una seconda partenza raggiungibile dalla prima → la riga col padre; nessuna → `[]`;
  - `ruoloVoci("", true)` ha «Core» e «Accesso» oltre alle tre di oggi; senza `conCavi` le tre di oggi.

- [ ] **Step 2: il codice.**
  - `linked-panel.tsx`, solo con `model.cavi`: per una linea, il titolo `titoloPerche`, le `cavo.frasi` in fila, i membri
    di un fascio porta per porta con lo stato, «a mano su porte diverse da quelle viste» se c'è; per un apparato,
    «Candidati per porta» (caricati con `fetchCandidati` quando si aprono i dettagli; un errore è un errore in parole,
    `LoadError`), al massimo 64 righe e «+ altri N»; per un hypervisor, `righeDalleVm`; per un nodo con anomalia,
    `testoAnomalia`; `stellaNonApplicabile` e `partenzeScartate` dove servono; per una ★ di prima, `testoStellaDiPrima` col
    pulsante «Scegli il cavo» che apre l'elenco dei cavi fra i due (le linee della coppia) e, scelto, chiama `setPrimary`
    con le porte di quella linea. «Altri cavi visti» e «Perché questo collegamento» di T1 restano per le linee senza `cavo`.
  - `topology-map-client.tsx`: il dialogo dell'«Ignora» con `testiIgnora`; per un **fascio** l'elenco dei membri con una
    casella spuntata ciascuno e «Ignora i cavi scelti», che scrive una correzione per membro spuntato (una chiamata
    `ignoreLink` per membro, in fila; un errore ferma e lo dice); per un **segmento** la correzione
    `{ action: "ignore", a_node: <membro>, a_port: <porta>, b_node: <id del segmento>, b_port: "" }`; il menu del ruolo con
    `ruoloVoci(attuale, !!model.cavi)`.
  - `map-toolbar.tsx`: con `mappaErrore` un testo breve «mappa di prima: la nuova non si è potuta calcolare» accanto al
    nome della mappa (13 px, con «⚠» davanti, `title` col messaggio intero); nessuna fascia.

- [ ] **Step 3: verifica.** I tre file di prova, `linked-panel` e la pagina compilano (`npx tsc --noEmit`, `npm run lint`),
  `exit=0`. La verifica a schermo è del Task 14.

- [ ] **Step 4: commit** — `feat(topologia): menu, pannello e dettagli per cavo — «Perché questo cavo», «Candidati per
  porta», ★ di prima, ruoli, «Togli dal segmento» (T3.1, T3.3, T3.4)`.

### Task 11: «Dati della mappa» (la mappa nuova, le anomalie) e la stampa con lo stato

Spec §13.11.4 (T3.7), §13.8.3 punto 8 («Anomalie della rete»), §13.10.3 («L'elenco "Cavi di ridondanza" della stampa
riceve la colonna "stato"»), §13.10.5 («Alla fine»). **Zona rossa:** no (la scrittura dell'interruttore è la rotta del
Task 2). **Modello:** Sonnet.

**Files:**
- Create: `src/lib/topology/letture/testi-mappa.ts` (testi, nessun import di `db-tenant`),
  `src/app/(dashboard)/topology/dati/mappa-card.tsx`, `src/app/(dashboard)/topology/dati/anomalie-card.tsx`
- Modify: `src/app/(dashboard)/topology/dati/dati-client.tsx`, `traccia-card.tsx`, `src/lib/topology/print-draw.ts`
  (`redundantCables`), `src/components/topology/print/print-sheet.tsx`, `print-page-client.tsx`
- Test: `src/lib/topology/letture/__tests__/testi-mappa.test.ts` (nuovo), `print-draw.test.ts`

**Interfaces:**

```ts
// letture/testi-mappa.ts
export const TITOLO_MAPPA = "Mappa nuova (una linea per cavo)";
export function testoStatoMappa(s: StatoInterruttore): string;   // «Spenta: si vede la mappa di prima.» · «Accesa dal ‹giorno ora italiana› da ‹utente›.»
export function testoDialogoMappa(accendi: boolean): string;     // il testo del dialogo, sotto
// print-draw.ts — RedundantCable: + stato: string (la parola intera, o «—» senza `cavo`)
```

- [ ] **Step 1: le prove, viste fallire.** `testi-mappa.test.ts`: i testi alla lettera e l'ora italiana (16/10 08:00 UTC →
  «16/10 alle 10:00»; 27/10 08:00 UTC → «27/10 alle 09:00»); `print-draw.test.ts`: `redundantCables` ha lo stato
  («⊘ bloccato dallo spanning tree», «instradato, fuori dal bridge») e non elenca le contrazioni.
- [ ] **Step 2: il codice.**
  - `mappa-card.tsx` (in «Dati della mappa», dopo «Letture in più per la mappa»): `GET /api/topology/settings/mappa`; lo
    stato in parole; per un admin «Accendi» o «Spegni» con un dialogo, per gli altri la riga «Sola lettura: solo un
    amministratore accende o spegne la mappa nuova.»; senza schema «Non disponibile: lo schema di questo cliente non è
    aggiornato». Il dialogo per accendere: «Con la mappa nuova ogni cavo è una linea sua, con la sua parola (bloccato,
    instradato, giù, fascio, tunnel, ponte radio); un segmento non gestito è un oggetto; l'albero segue lo spanning
    tree. Vale solo per questo cliente. Prima di accendere, ogni differenza di "Cosa cambierebbe con la mappa nuova"
    dovrebbe essere spiegata. Si spegne da qui: torna la mappa di prima, nessun dato si perde.»; per spegnere: «Torna la
    mappa di prima (una linea per coppia). Le correzioni fatte con la mappa nuova restano salvate.» Dopo la scrittura si
    ricarica il modello.
  - `anomalie-card.tsx`: «Anomalie della rete» da `model.cavi.anomalie`, una riga per anomalia col titolo di D2 («core
    che esce da uno switch di accesso») e il testo di `testoAnomalia`, al massimo 50 e «+ altri N»; con la mappa spenta la
    sezione non c'è (le anomalie in ombra stanno già in «Cosa cambierebbe»).
  - `traccia-card.tsx`: con la mappa accesa il titolo diventa «Differenze fra la mappa nuova e quella di prima» (il
    calcolo è lo stesso).
  - `redundantCables` e `print-sheet.tsx`: la colonna «stato» accanto a «velocità»; le contrazioni non sono cavi.
- [ ] **Step 3: verifica.** Le prove, `npx tsc --noEmit`, `npm run lint`: `exit=0`.
- [ ] **Step 4: commit** — `feat(topologia): «Mappa nuova» e «Anomalie della rete» in «Dati della mappa», lo stato dei cavi
  di ridondanza in stampa (T3.3, T3.7)`.

---
## Parte 5 — Prove di tappa

### Task 12: le reti-campione di T3, la rete in quattro letture, le fixture dedicate, gli scenari, il freno

Spec §13.12.1 (S5-S8, S10, S11; H3-H8, H11-H13, H18-H21), §13.12.2 (cinque famiglie, rete-campione in quattro letture,
fixture dedicate), §13.12.3 (I22, I38, I40, I43-I47, I56, I57, I60, I66-I69), §13.12.4 (T3), §13.3.0 (G11-G16). **Zona
rossa:** no (prove; non cambia il modello). **Modello:** Sonnet. Se una prova trova un difetto del modello: la prova
resta rossa, l'agente scrive nel rapporto la regola, il caso e il file, e passa alla prova dopo; la correzione la fa
un implementatore Opus nella colonna «Dopo» dell'ondata 6, con quella prova come prova vista fallire.

**Files:**
- Create: `src/lib/topology/__tests__/support/quattro-letture.ts`, `cavi-quattro-letture.test.ts`,
  `cavi-reti-campione.test.ts`, `cavi-fixture-dedicate.test.ts`, `cavi-scenari.test.ts`
- Modify: `src/lib/topology/__tests__/reti-campione.test.ts` (righe 257-265: tolti gli skip di G11-G16, con un commento
  che dice dove stanno), `src/lib/__tests__/topologia-t3-freno.test.ts` (seconda parte)

**Interfaces:**
- Consumes: Task 6 (`modelloMappaDaIngresso`, `modelloMappaCavi`), Task 7 (`buildTree` per cavo, `contrazioni`); i
  supporti `support/cavi.ts` (`vic`, `fp`, `fb`, `ingresso`, `ORA_T2`), `support/reti-campione.ts`, `support/righe.ts`,
  `support/impronta.ts`.
- Produces (`support/quattro-letture.ts`): `letturaA(): IngressoCavi`, `letturaB(): IngressoCavi`, `letturaC():
  IngressoCavi`, `letturaD(): IngressoCavi`, `uguale(x, y, parte?: (c: Collegamento) => boolean): string[]` (le
  differenze in parole; vuoto = uguale: stessi collegamenti coi due capi per chiave di porta e genere, stesso stato e
  stessa fiducia, stesso padre per ogni nodo).

- [ ] **Step 1: la rete-campione in quattro letture (G16, I38)** — inventata, nomi e MAC inventati, una sola topologia:

| Oggetto | Ruolo | Cavi (porte nella lettura A) |
| --- | --- | --- |
| R | router di testa | fascio `bond1` (`sfp28-1`, `sfp28-2`) ↔ C1 (LAG porte 1-2, 2 × 25G); `ether2` fuori dal bridge ↔ A1 porta 47 (2,5G, instradato); `ether3` ↔ radio V; `ether8` fuori dal bridge sul segmento della WAN; EoIP ↔ R2S (solo lettura A) |
| C1 | core 1 (porta radice: il fascio verso R, che è la radice dell'albero comune) | porte 9, 11, 12 ↔ A1, A2, A3 (10G) |
| C2 | core 2 | porta 11 ↔ A3 porta 49 (porta radice di C2); porte 9 e 12 ↔ A1 e A2 porta 50, **bloccate** dal lato di C2 → anomalia «core che esce da uno switch di accesso» |
| A1, A2, A3 | accesso | A2 porta 16 ↔ RR porta 2 |
| RR | router di riserva | porta 1 sul segmento della WAN |
| M | modem non gestito | sente R `ether8` e RR porta 1 (segmento con R, RR e +1 non gestito) |
| V, L | radio vicina e lontana (ponte) | V ≋ L (salto radio); L ↔ R2S `ether3` |
| R2S | router della sede 2 | — |
| H | hypervisor (solo lettura D, più i cavi visti dagli switch) | `ens1` ↔ C1 porta 20 (attiva); `ens2` ↔ A3 porta 20 (riserva del bond `active-backup`) |

  - **A**: MikroTik (le righe e i fatti come li scrivono i lettori di T2: `fattiMikrotik`, `/ip neighbor`) per R, RR,
    R2S; controller (righe `unifi`, `uplink_local_port_idx`, `stp_state`, `lag_idx`, `ethernet_table`) per C1, C2, A1-A3; è
    il riferimento;
  - **B**: Cisco in Rapid-PVST via SNMP, nella forma che scrive il lettore SNMP di T2 (`snmp-topologia.ts`, fonte `snmp`):
    porta locale LLDP tradotta da `lldpLocPortTable` («Gi1/0/24»), BRIDGE-MIB della VLAN 1, CDP fra due Cisco, il fascio
    «Po1» (`ifType` 161); **forma dedotta dalla MIB**: tutta la rete tranne l'EoIP e gli annunci MNDP;
  - **C**: HP/Aruba in MSTP via SNMP: ruolo nell'albero comune e un'istanza, «Trk1», `lldpRemPortId` numerico, senza porta
    designata; **dedotta**; come B;
  - **D**: host con `lldpcli -f json0 show neighbors details` e il bond `active-backup` (fonte `host`, `lag_state`), nella
    forma del Task 7 del piano di T2: solo i cavi di H.
  Le prove: `uguale(A, B, <tutto tranne tunnel e annunci di segmento>)` vuoto; `uguale(A, C, idem)` vuoto, e dove C non
  sa una cosa (la porta designata) la prova scrive quale criterio decide al suo posto; i cavi di H in D uguali a quelli in
  A per capi e genere, quello di riserva «riserva_bond» in D. Il commento dice che B e C provano la coerenza con chi ha
  scritto le fixture, non l'indipendenza dal prodotto (§13.5.4: serve una lettura SNMP vera, e SNMP oggi è spento).

- [ ] **Step 2: le cinque famiglie (G11-G16)** in `cavi-reti-campione.test.ts`, una prova per criterio e per famiglia, coi
  titoli «G11 · famiglie 1, 2, 3 · …» come in `reti-campione.test.ts`, sui fatti di T2 nella forma dei lettori (quelli di
  `cavi-ombra.test.ts` per le famiglie 1 e 2; per la 3 i fatti SNMP; per la 4 le VM; per la 5 il salto radio):
  G11 fascio una linea sola (provato, dal controller, dedotto solo con lo spanning tree fra i due capi: I66); G12 porta
  radice, `disabled` che inoltra, «giù» che vince (I22, I24, I25, I67); G13 instradato e WAN del gateway (I23, I68); G14
  tunnel, ponte radio, senza fili (I29, I47, I69); G15 router e firewall virtuali dentro l'hypervisor (famiglie 1 e 4,
  I62); G16 rimanda a `cavi-quattro-letture.test.ts`. In `reti-campione.test.ts` le sei righe saltate diventano una riga di
  commento «G11-G16: in cavi-reti-campione.test.ts e cavi-quattro-letture.test.ts (T3)».

- [ ] **Step 3: le fixture dedicate** (`cavi-fixture-dedicate.test.ts`, §13.12.2 «In più»): la trappola della radice
  regionale (I22: due MikroTik della stessa regione e uno switch RSTP di altra marca sul secondo → il cavo va al secondo
  router); uno switch non gestito (due apparati sulla porta → segmento); l'EoIP nella regione, bloccato nell'albero comune
  e attivo nell'istanza 1 (fatti d'istanza nella forma neutra: la forma vera arriva con T2-a); un ponte radio che inoltra
  l'LLDP **e si annuncia** (salto, non segmento) e uno che non lo inoltra col salto a mano; un 48 porte con «Port 1»,
  «SFP_ 1», «SFP 1» (I12); due porte con lo stesso nome (I14); «eth0» su uno switch (I13); un AP con due nomi di porta
  (I46); un gateway con l'uplink su porte di velocità diverse (I45); un cavo spostato (I43); una porta tolta dal bridge
  (I44); dall'hub: un bridge col nome scelto e un fascio nel bridge (`porta,bondN,‹bridge›`), lo stesso router con un
  MAC per interfaccia (I60), tre righe CDP inoltrate su un membro, nomi inventati a caso (I58: «XQ_7_ABC», «lan-piano2»,
  «PONTE-A»). Ogni prova dice collegamenti, stato, fiducia e padri attesi.

- [ ] **Step 4: gli scenari sulle due fixture delle reti vere** (`cavi-scenari.test.ts`), coi fatti simulati in memoria
  (`ingresso(carica(…), { fattiPorta, fattiBridge, macApparati })`); id del cliente A già noti (router 1 = `dev:1`,
  accesso A = `dev:112`, core 1 = `dev:114`; gli altri della sede 1 si trovano nella fixture dalle porte e si scrivono nel
  commento, come in `model-fixtures.test.ts:224-225`):
  S5 (stati del controller: cavi 1-11 e il segmento, 8 e 9 bloccati, anomalia su core 2); S6 (spanning tree del router
  simulato, radice router 1 e poi core 1: stesso albero); S7 («Ignora» sul cavo 1: sparisce solo lui, segmento e cavo 2
  restano); S8 (il «MAC + 1» in `macApparati`: il cavo 2 diventa «certo»); S10 (il segmento della WAN sotto `ether8` di
  router 1, membri come ridondanze, nessun altro padre cambia; I49, I50); S11 e I56 sulla famiglia 4 (le fixture delle
  reti vere non hanno VM, ADR 0010 n. 8); sull'hub H3, H5, H6, H8 (0 anomalie), H11, H12, H13, H18 (il fascio verso il NAS
  dal partner LACP), H19, H20, H21 (con il router di frontiera censito in memoria). I40 e I57 sono già nel Task 7.

- [ ] **Step 5: il freno, seconda parte** (`topologia-t3-freno.test.ts`): con le letture accese e i fatti scritti nel DB,
  interruttore spento → `modelloDellaMappa` uguale a `buildTopologyModel(getTopologyModelInput(…))` bit per bit
  (`serializza`); acceso e poi spento → di nuovo uguale (niente resta indietro); acceso con lo schema assente → la rotta
  non lo permette (Task 2), e un valore scritto a mano nel DB senza schema dà comunque una mappa (elenchi vuoti, `cavi`
  presente, nessuna eccezione).

- [ ] **Step 6: verifica.** I file nuovi e `reti-campione.test.ts`: tutto verde tranne le prove che l'agente ha segnato
  come difetti del modello (elencate nel rapporto). Il rapporto riporta una riga per G1-G17 come la stampa `node --test`
  (passa, non passa, non applicabile, da fare), per le cinque famiglie: va nel resoconto della tappa (§13.3.0).

- [ ] **Step 7: commit** — `test(topologia): le prove di T3 — reti-campione, la rete in quattro letture, fixture
  dedicate, scenari, il freno`.

---

## Parte 6 — Sessione principale: misure, schermo, revisione, documenti, rilascio spento, accensioni

### Task 13: le misure sulle copie, con l'interruttore acceso in memoria

Spec §13.11.4 («Misure sulle copie»), §13.3.1-13.3.4. Copie **fresche** come in P2 (dopo almeno un giro in più di
letture accese rispetto al Task 0, se è passato un giorno), dal worktree del ramo d'unione dopo l'ondata 6. Ogni uscita
nello scratchpad; i numeri a Riccardo, i nomi solo in chat.

- [ ] **Step 1: spento = T1, bit per bit**, con lo stesso orologio:

```bash
ADESSO="<ora UTC della copia, AAAA-MM-GG HH:MM:SS>"
for t in A H; do
  (cd "$SCRATCH/ipam-dev" && npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --salva "$SCRATCH/t3-prima-$t.json" --json > "$SCRATCH/t3-prima-$t.out" 2>&1); echo "prima $t exit=$?"
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --confronta "$SCRATCH/t3-prima-$t.json" --json > "$SCRATCH/t3-spento-$t.out" 2>&1; echo "spento $t exit=$?"
done
```

  Atteso: `impronta_modello` **uguale** fra «prima» e «spento», `padri_cambiati: 0`, `conteggi_cambiati: {}`,
  `stesso_orologio: true`, `stessa_lettura_vm: true`. Se l'impronta cambia, **il rilascio non parte**: si cerca quale
  modulo comune prende la strada nuova senza `cavi`.

- [ ] **Step 2: acceso in memoria**:

```bash
for t in A H; do
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --mappa-cavi --cavi --traccia --salva-cavi "$SCRATCH/t3-cavi-$t.json" --json > "$SCRATCH/t3-acceso-$t.out" 2>&1; echo "acceso $t exit=$?"
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --mappa-cavi --cavi --nomi > "$SCRATCH/t3-acceso-$t-nomi.txt" 2>&1; echo "nomi $t exit=$?"
done
```

  Si confrontano, riga per riga nel registro `misure-t3.md`: **cliente A** la tabella 13.3.1 (righe 1-11, 18, 19 come
  cancello; 12-17 misurate, non cancello, §13.3.1), C13 (core 2 con 3 cavi, 1 attivo e 2 bloccati), C14 = 0, C15 = 1
  (core 2; un'anomalia in più si spiega o la regola si corregge prima del rilascio), C16 = 1 se il salto radio a 60 GHz
  è dedotto dagli annunci (altrimenti il fatto), C17 `mappa_cavi_ms` ≤ 50 sul Mac, C2 = 0, C4 = 0, C10 = C11 = 0;
  **hub** H1 (padri del controller come oggi), H3, H5, H6, H8 = 0, H11, H12, H13, H18, H19, H20, H21 (non applicabile
  finché il router di frontiera non è censito); **il nodo con `lldpd`** (quattro cavi, padre a 10G); **«dalle VM»**: quante
  nei dettagli, uguali alla decisione del Task 0; **T3.6** (l'identità): collegamenti fra apparati, vicini non abbinati,
  attaccati, prima (Task 0) e dopo, ogni differenza spiegata (§13.6.4); **R1** la lettura delle VM; **R2** per ogni mappa
  salvata e orientamento ritocchi validi e scaduti e **oggetti persi = 0** (gli id `seg:` passano dagli alias); le
  correzioni orfane (sul cliente A la riga del 14/10, finché Riccardo non la toglie); le ★ di prima (0 e 0 al 14/10).
  Ogni differenza: `Criterio` (si corregge prima del rilascio, con un implementatore Opus e la prova vista fallire) o
  `Fatto` (a Riccardo).

- [ ] **Step 3: G1-G17** dalle righe del Task 12 (una per criterio e per famiglia) nel resoconto.

### Task 14: la verifica a schermo, una volta, a 1280 e 1920

Spec §13.12.4 («A schermo»), §13.10.4. In locale, mai sui server: il server del ramo d'unione con `DA_INVENT_DATA_DIR`
su una cartella dello scratchpad con la **copia della copia** del cliente A (e poi dell'hub) e l'utenza di prova creata
nel suo `hub.db` con la procedura del piano di T2 (Task 15: password generata sulla macchina, mai in un argomento).
L'interruttore si accende **nella copia**, da «Dati della mappa», come admin di prova. Le schermate restano nello
scratchpad: a Riccardo solo quelle di una rete-campione o con le etichette della spec.

- [ ] A 1920 e a 1280, in «Verticale» e in «Orizzontale», elenco aperto e chiuso: il segmento della WAN (capsula, «⋯»,
  «+N»), core 2 con «⇄ 3» e i bloccati a richiesta (clic e «Mostra ridondanze»), un instradato sullo spazio minimo
  («instrad…» e intero al passaggio del mouse), un cavo giù accanto a un «non visto», il tunnel, il ponte radio con le
  radio sulla linea, un fascio, «⚠ core sotto accesso» sul riquadro, i dettagli di una linea («Perché questo cavo»), di
  un apparato («Candidati per porta», «+ altri N»), di un hypervisor («visto dalle VM anche su…»), una ★ di prima se c'è;
  una mappa passo passo con un membro del segmento senza il segmento (contrazione «segmento»); testo ≥ 13 px; nessuna
  fascia sopra la mappa.
- [ ] «Dati della mappa»: «Mappa nuova (una linea per cavo)» (dialogo aperto e annullato, poi acceso nella copia),
  «Anomalie della rete», «Differenze fra la mappa nuova e quella di prima»; da utente non admin la riga di sola lettura.
- [ ] Stampa A3 al 100 % in bianco e nero: la legenda nuova, ogni forma distinta senza colore, «Cavi di ridondanza» con
  la colonna «stato».
- [ ] Interruttore spento nella copia: la mappa uguale a quella del codice di prima (una schermata prima e dopo, e i
  conteggi di `GET /api/topology/model`).

### Task 15: revisione finale, documenti, cancello, conferma e rilascio con la mappa nuova spenta

- [ ] **Step 1: una revisione finale su Opus** di tutta la tappa (`git diff origin/dev...topologia/collegamenti-t3`), con
  questo mandato: (a) spento = T1: `git diff --stat origin/dev -- src/lib/topology/{links,model,attach,node-index,vm-ports,vms,sites}.ts`
  vuoto; ogni modulo comune prende la strada nuova solo con `cavi`/`cavo`; la rotta del modello a interruttore spento non
  legge `getIngressoCavi`; (b) l'interruttore fallisce chiuso; (c) le scritture nuove (ruoli, «tunnel», `seg:`, ★ per
  cavo) e le loro rotte con la guardia giusta; (d) nessun ripiego muto (Caso 3); (e) niente dati veri in fixture, prove,
  commenti, commit; (f) I37 e I58 sui file nuovi di `cavi/`; (g) schermo e traccia scelgono con lo stesso Prim (prova 1
  del Task 7); (h) i Casi da non dimenticare; (i) interfaccia: 13 px, mai il solo colore, niente fasce. Un giro di
  correzioni (un implementatore Opus con l'elenco intero), poi una revisione mirata della sola correzione.
- [ ] **Step 2: i documenti** (commit di soli documenti, sullo stesso ramo):
  - `docs/adr/0019-mappa-per-cavo-dietro-interruttore.md` (0019 se al momento è libero, altrimenti il primo libero: lo 0017
    è prenotato dal piano della tappa 2 delle credenziali; il numero scelto si scrive anche negli altri documenti): Stato,
    Data; Contesto (D1, D2, D5; il freno con traccia di T2; i fatti del 15/10 notte); Decisione (la mappa nuova dietro un
    interruttore per cliente che nasce spento; il modello per cavo nella forma della pagina; un Prim solo per schermo e
    traccia; il segmento come nodo calcolato con alias; nessuna migrazione); Alternative scartate (accendere per tutti;
    un secondo componente di pagina per T3; salvare i collegamenti; convertire le correzioni); Conseguenze con «che cosa
    diventa difficile in futuro»: due modelli vivi fino a quando si toglie il ramo vecchio (§13.13.3 punto 1); l'id della
    linea è il collegamento e cambia se cambia il nome di una porta letta per nome (punto 3); l'id del segmento e i suoi
    alias (punto 4); MSTP per istanza a metà finché non arriva T2-a (punto 8); `sources` delle linee nuove solo per
    compatibilità; le misure vanno rifatte quando arrivano T2-a e la lettura dell'host;
  - `CHANGELOG.md`, `## [Non rilasciato]`: Aggiunte (la mappa nuova per cliente, spenta; «Mappa nuova» e «Anomalie della
    rete» in «Dati della mappa»; «Candidati per porta»; i ruoli «Core» e «Accesso»; il tipo «tunnel»; «Togli dal
    segmento»), Correzioni (M5: un fatto vecchio non fa più «giù» un cavo visto oggi; le prove della rotta delle letture),
    col perché;
  - `CONTEXT.md` §6, voce «Mappa topologia»: «T3 (ADR 0019) su `dev` dalla v‹x›, mappa nuova spenta per cliente
    (`topologia.mappa.cavi`, da "Dati della mappa")», con le trappole: spento = T1 bit per bit, misurato con le impronte;
    `model.cavi` decide la strada nuova in ogni modulo comune; gli id `seg:` passano dagli alias di `canonical`; la ★ da
    T3 è per collegamento; «dalle VM» nei dettagli secondo `DALLE_VM_SOLO_DETTAGLI`; senza T2-a nessun «in parte»;
    sotto i 10k caratteri (`wc -c`);
  - spec §13.11.4: una riga «**Stato (‹data›):** pronta sul ramo `topologia/collegamenti-t3`…» coi numeri dei Task 13 e 14;
  - `docs/auth-matrix.md`: `GET/PUT /api/topology/settings/mappa` (auth/admin), `GET /api/topology/candidati` (auth);
  - `docs/scheda-mappa.md`: la riga di T3.
- [ ] **Step 3: il cancello, una volta** — `npm run lint && npx tsc --noEmit && DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gate.XXXXXX")" npm test && npm run build`,
  `> "$SCRATCH/gate-t3.log" 2>&1; echo "exit=$?"`; `pass`/`fail` in fondo al log. `credential-chains.test.ts` caduto: si
  rilancia da solo e il resoconto lo dice.
- [ ] **Step 4: la conferma di Riccardo, chiesta una volta e per esteso**, per: (a) i preparativi sulle due macchine
  (l'appliance del cliente A e la VM dell'hub; vie d'accesso in `ACCESSI.md` e nel vault, comandi da stdin): `df -h` della
  cartella dei dati (spazio libero almeno il doppio della somma dei DB; l'hub 2,1 GB), `PRAGMA quick_check` di **tutti** i
  tenant (`for f in data/tenants/*.db; do sqlite3 "$f" 'PRAGMA quick_check'; done`: «ok» o le 4 pagine «never used»
  dell'hub), la copia con l'API di backup di ogni tenant in `data/backups/<tenant>-pre-topologia-t3-<AAAAMMGG>.db` e il
  suo `quick_check`; (b) il push su `dev`, che è un rilascio al cliente A **con la mappa nuova spenta e senza
  migrazione**; (c) l'aggiornamento dell'hub; (d) il ritorno indietro se i controlli vanno male. Nel messaggio: i numeri
  dei Task 13 e 14, i fatti da confermare (Scelte), e che la mappa nuova **resta spenta** finché non la accende lui.
- [ ] **Step 5: il rilascio** — i preparativi dello Step 4 subito prima; `npm run version:release`, `git push origin dev`;
  l'hub con lo script di aggiornamento. Controlli: `ActiveEnterTimestamp` dopo l'ora del push e la riga d'avvio nel
  journal; la riga «nuovo commit su origin/dev (‹hash›)» di `da-ipam-update`; `SELECT key FROM tenant_settings WHERE key =
  'topologia.mappa.cavi'` vuoto su ogni tenant; `GET /api/topology/model` con `mappa: "oggi"` e i conteggi uguali a quelli
  della copia presa prima del riavvio; nessuna riga «[topology] mappa nuova non calcolata» nel journal. Orari a Riccardo
  in ora italiana.

### Task 16: l'accensione sull'hub, con la conferma di Riccardo

Decisione di Riccardo del 15/10 notte: **niente attese di settimane**. La mappa nuova si accende appena **ogni
differenza** di «Cosa cambierebbe con la mappa nuova» dell'hub è spiegata (§13.11.4, «Conferme»; §13.15 punto 5).

- [ ] La traccia dell'hub dopo il rilascio (da «Dati della mappa», come admin): una riga per differenza col perché; i nomi
  in chat; ogni differenza `Criterio` già corretto o `Fatto` accettato da Riccardo.
- [ ] Con la sua conferma, «Accendi» in «Dati della mappa → Mappa nuova» (lo fa lui, o la sessione col suo ok scritto).
- [ ] Subito dopo, in sola lettura: `GET /api/topology/model` con `mappa: "cavi"` e nessun `mappaErrore`; il journal senza
  «mappa nuova non calcolata»; a schermo la mappa automatica e una mappa passo passo (oggetti persi 0, ritocchi scaduti
  contati come nel Task 13); «Collegamenti ignorati» (orfane); le ★ di prima; «Anomalie della rete» (atteso 0, H8).
  Un numero fuori misura → si spegne da «Dati della mappa» (torna la mappa di prima, nessun dato perso) e si guarda.

### Task 17: l'accensione sul cliente A, dopo l'hub, con la conferma di Riccardo

- [ ] Come il Task 16, coi numeri dell'hub accanto: la traccia del cliente A spiegata riga per riga; la riga del 14/10 in
  «Collegamenti ignorati» resta orfana finché Riccardo non la toglie (D3, I36); «Anomalie della rete» = 1 (core 2, C15).

### Task 18: prima della promozione a `main`, a parte, con la sua conferma

- [ ] Su ogni appliance che segue `main`: spazio libero, `quick_check` di tutti i tenant e copia con l'API di backup, come
  il Task 15 Step 4, con l'ok di Riccardo. Nessuna migrazione arriva; la mappa nuova resta spenta finché un admin non la
  accende per quel cliente. «Togliere il ramo vecchio» (§13.11.4) **non** è di questa tappa.

---

## Quando arriva il Task 3b del piano di T2 (MSTP)

Con le uscite T2-a, il lettore MK7 scrive le righe d'istanza (`topology_bridge_facts.instance > 0`, regione, VLAN, porta
radice per istanza). Il modello per cavo le legge già (`statoDi` del Task 4): un collegamento bloccato nell'albero comune
fra due bridge della stessa regione, porta radice di un'istanza su uno dei due, diventa «bloccato_comune» con le VLAN; a
schermo «in parte» sulla linea dell'albero e «⊘ bloccato nell'albero comune · VLAN ‹n› attiva» nei dettagli (Task 9);
`istanzeNonLette` sparisce dove le istanze sono lette. **Nessun codice di T3 cambia**: si rifanno le misure del Task 13
(le righe 12-17 della tabella 13.3.1 si riscrivono con le uscite vere e diventano cancello, C13), e la riga MSTP di
`NON_CALCOLATO` si toglie. Se la forma vera smentisce i fatti neutri delle prove del Task 12, si corregge il lettore di T2,
non il modello (§13.13.3 punto 5).

## Quando arriva il Task 7 del piano di T2 (lettura dell'host)

Righe di fonte `host` e `lag_state` dei membri dei bond: il modello per cavo le usa già (Task 4: riserva del bond,
conferma dei collegamenti «dalle VM», scarto di quelli che l'host non conferma; il lettore «host»). Il nodo con `lldpd`
dell'hub vede i suoi quattro cavi anche dal suo lato: la porta dell'hypervisor si completa dall'altro capo e i cavi
diventano «certo». Si rifà la misura del Task 13 sull'hub; nessun codice di T3 cambia.

## Tornare indietro

- **Senza codice:** «Spegni» in «Dati della mappa → Mappa nuova»: torna la mappa di T1 alla prossima apertura. Le
  scritture fatte con la mappa accesa restano e il modello di T1 le legge così: «core» e «accesso» valgono «rete»
  (`ruoloLetto`); una correzione «ignore» verso un `seg:` non tocca niente (il modello di T1 la salta, come prima); una ★
  con le porte vale per la coppia; una correzione a mano «tunnel» resta una linea a mano.
- **Col codice:** `git revert` del commit d'unione di T3, `npm run version:release`, push. Nessuno schema da togliere;
  l'interruttore resta in `tenant_settings`, non letto da nessuno. Dopo il revert, `medium = 'tunnel'` non è più fra i tipi
  noti di `enrichLinks` e la linea a mano perde la parola; «core»/«accesso» li legge `ruoloLetto` (già prima di T3).
- I backup del Task 15 servono solo se un DB si rovinasse: il ripristino è una scrittura di produzione, con la conferma di
  Riccardo.

## Scelte

**Decise dal piano, dichiarate (a Riccardo come fatti da confermare col messaggio del rilascio):**
1. **T3.6 solo nel modello per cavo.** L'ordine «telaio, nome, IP» cambia `abbina` di `cavi/prove.ts`; `resolveNode` e il
   modello di T1 restano (spento = T1). I numeri di `model-fixtures.test.ts` non cambiano: la misura dell'identità del
   §13.6.4 si fa sul modello per cavo (Task 0 prima, Task 13 dopo).
2. **`source`/`sources` delle linee nuove per compatibilità** (`FONTE_DELLA_CLASSE`, il partner LACP vale «lldp»): con la
   mappa nuova le parole vengono da `cavo.detti`. Una fonte nuova in `LinkSource` cambierebbe `linksBySource` di T1.
3. **Nessuna regola «porta remota = MAC di una scheda»** per il nodo con `lldpd`: quattro cavi con la porta dell'host da
   completare (§13.6.1 passi 5-6), finché non arriva la lettura dell'host. Una regola nuova sui MAC come porta non è
   nella spec: se la misura la chiede, è un fatto per Riccardo.
4. **Teste delle sedi e rotte della sede** (`/api/locations/[id]/topology`, `/api/devices/[id]/location`): restano sul
   modello di T1; la testa del modello per cavo vale per la mappa automatica (`cavi.testa`). Sul cliente A e sull'hub è
   la stessa (si misura, H17).
5. **Ripiego visibile** se il modello per cavo lancia un'eccezione (Caso 3): la mappa di prima, il journal e una scritta
   nella barra; mai una pagina bianca.
6. **Il segmento ha le misure di un riquadro** nella disposizione (forma a capsula, contenuto ridotto): un riquadro più
   piccolo toccherebbe `tree-layout` per un genere solo. La bozza lo mostra.
7. **«Ignora» su un fascio** = una correzione per membro spuntato, con la rotta di oggi; nessuna rotta nuova.
8. **Ruoli a mano nell'anomalia:** «accesso» non l'ha mai; «core» sotto «accesso» l'ha anche con meno di due altri
   switch; senza ruoli vale la regola dei due switch.
9. **Contrazioni:** una linea per ogni coppia di oggetti visibili sul bordo della parte contratta; quelle che l'albero non
   usa non si disegnano e non contano nel «⇄ N».
10. **La ★ e la correzione tolta** (`deleteLinkOverride` con la mappa accesa): cade solo la ★ con le stesse porte; una ★
    senza porte resta e vale per il migliore della coppia.
11. **«Candidati per porta» a richiesta**, con una rotta sua, solo con la mappa accesa: nel modello peserebbe su ogni
    apertura della pagina.
12. **«★ non applicabile» e «seconda partenza»** solo con la mappa accesa (spento, la pagina è quella di prima).
13. **M6, il 403:** provato dal lucchetto sul sorgente (`api-auth-guards.test.ts`) e dal censimento: `mock.module` non
    gira sotto Node 22 con `tsx`, e `requireAdmin` legge la sessione.
14. **Accendere la mappa nuova chiede lo schema di T2**; spegnerla si può sempre.
15. **«Oltre» una radio** guarda solo porte che hanno il loro cavo: con l'LLDP inoltrato dalla radio la porta sente due
    apparati via LLDP e vale prima la regola del segmento (§13.7.3).
16. **Una VM vista via LLDP da uno switch** dà il cavo del suo hypervisor (§13.7.8, «Il percorso fisico è quello delle
    schede dell'hypervisor»); la VM vista nella tabella MAC di una porta lo dice già la prova «dalle VM».

**Lasciate nel modo raccomandato (spec §13.16, «Scelte che restano a Riccardo»), finché non risponde:**
1. Censire il router di frontiera e il router virtuale dell'hub: nessun codice; H21 si prova in memoria e sulla copia è
   «non applicabile».
2. L'età della posizione delle VM: resta com'è (nessuna soglia).
3. La testa quando l'unico router è una VM: la regola di oggi (la VM non è una testa); sta in `NON_CALCOLATO`.
4. Gli switch visti solo via LLDP: in T3 tornano nell'albero con le capacità o coi BPDU (Task 3); il ruolo a mano resta.
5. Il laboratorio dell'hub: come oggi (segmento della porta 5, «Da sistemare» finché non si promuove).
6. Il perimetro: la mappa disegna lo spanning tree, non l'instradamento (fatto da confermare).
7. Il gateway del controller dell'hub: la regola del §13.8.3 punto 1 (WAN a 10G, LAN a 25G), fatto da confermare (H11).
8. La guardia «telefono» sulle capacità CDP: non entra; la riga «da fare» della famiglia 5 resta.
9. La porta di fabbrica con la velocità in coda (`ether1-2.5`): resta letta fisica.

---

## Auto-revisione (skill writing-plans)

1. **Ogni requisito della spec ha un task.** T3.1 → Task 6 (linea per collegamento, «⇄ N»), 7 («⇄ N» con le contrazioni,
   bloccati a richiesta), 10 (menu, pannello, verifica a mano per cavo a schermo), 4 (verifica a mano per cavo, `vm-ports`
   per cavo nel modello: bordo per porta e «dalle VM»), 5 (principale per collegamento), 11 (stampa con lo stato); T3.2 →
   Task 6 (nodo, id, alias), 8 (rotte e prove), 7 (contrazione), 9 (radio sulla linea, forma); T3.3 → Task 5 (chiave, testa,
   anomalie, ruoli, ponti), 4 (WAN e `disabled` già in T2, fascio dedotto, tunnel L3, VM), 10 (seconda partenza, ★ non
   applicabile), 11 («Anomalie della rete»); T3.4 → Task 4 (modello), 5 (★), 8 (scritture), 10 (dialoghi); T3.5 → Task 9,
   10 («Candidati per porta»), 11 (stampa); T3.6 → Task 3; T3.7 → Task 2 (interruttore), 6 (rotta), 11 (pagina); M5, M6 →
   Task 2; misure → Task 0 e 13; schermo → Task 14; conferme, rilascio spento, accensioni → Task 15-18; prove del 13.12.4
   di T3 → Task 3-12; reti-campione e G11-G16 → Task 12; MSTP e host → sezioni dedicate.
2. **Nomi e firme coincidono fra i task:** `mappaCaviAccesa()`, `scriviMappaCavi(acceso, da, adesso?)`,
   `decidiCorpoLetture`, `decidiCorpoMappa`, `proveDiRuoloCavi(ing, prove, fatti, capiRadio, nominale)`,
   `classiCavi(nodi, prove, ruoloAMano, ponti)`, `macSullaPorta(input, idx, nodo, porta, altro)`,
   `aliasDeiSegmenti(segmenti)`, `DALLE_VM_SOLO_DETTAGLI`, `NON_CALCOLATO`, `primCavi(IngressoPrim)`, `lineaDi`,
   `risolviStelle(cs, primari, portaSalvata)`, `ruoloRete`, `modelloMappaCavi(t1, m, ing)`,
   `modelloMappaDaIngresso(ing, { testaScelta })`, `candidatiPerPorta(m, nodo, nomeDi, limite?)`,
   `modelloDellaMappa(staleDays, nowMs?)`, `contrazioni(model, visible)`, `alberoDellaPagina(model, visible, roots)`,
   `lineaDellaVista`, `parolaStato`, `pezzoNelloSpazio`, `testiIgnora`, `fetchCandidati`: riletti dopo la scrittura.
3. **Niente segnaposto:** il valore di `DALLE_VM_SOLO_DETTAGLI` lo decide la misura del Task 0 con la regola scritta lì;
   le uscite che non ci sono (T2-a, lettura dell'host) hanno la loro sezione; i percorsi dei DB, le ore delle copie e gli
   id degli apparati delle copie restano fra «‹ ›» perché non vanno nel repo.

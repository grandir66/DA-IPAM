# Topologia §13, tappa T2 — letture in più, spente, con la traccia — piano di esecuzione

> Si esegue con la skill `subagent-driven-development` oppure in linea (una sessione che esegue i task in ordine). Le
> caselle `- [ ]` tengono il conto. Il codice è scritto qui per intero: chi esegue lo copia, lo fa compilare e passare
> le prove, e non ridisegna niente. Dove la spec lascia una scelta, il piano la dichiara (sezione «Scelte»).

**Obiettivo:** leggere dagli apparati i fatti che mancano alla mappa nuova (spanning tree, bridge, fasci, indici delle
porte, tutti i MAC, LLDP dell'host) **con ogni lettura spenta di default** e accesa per cliente, salvarli in tabelle
nuove che il modello di oggi non legge, e calcolare **in ombra** il modello per cavo per dire, in «Dati della mappa»,
«Cosa cambierebbe con la mappa nuova» — senza che la mappa a schermo cambi di un pixel.

**Architettura:** una migrazione additiva (`migrateTopologyCavi`, tre tabelle e sei colonne) in fondo a `getTenantDb`,
con l'annotazione «schema presente»; quattro lettori, uno per via (MikroTik via SSH, controller, SNMP, host), ognuno
dietro il suo interruttore in `tenant_settings`, con la cadenza propria (al più una volta l'ora per apparato), il
lucchetto per apparato, il tempo massimo per comando e l'esito per apparato. I lettori scrivono fatti con le parole
dello standard; la logica nuova (`src/lib/topology/cavi/`: `prove.ts`, `collegamenti.ts`, `albero.ts`, `modello.ts`,
`traccia.ts`) li legge e non sa di marche. La traccia si calcola a richiesta, in memoria, servita da
`GET /api/topology/traccia` (solo admin). Il modello di T1 (`links.ts`, `model.ts`, `tree.ts`) **non si tocca**.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, better-sqlite3, `node --import tsx --test`, Zod v4, shadcn v4
su `@base-ui/react`, `ssh2`, `net-snmp` (sessioni solo da `src/lib/protocols/snmp-sessione.ts`, ADR 0016).

**Spec:** `docs/superpowers/specs/2026-10-14-topologia-collegamenti-reali-design.md` — §13.11.3 (T2: pezzi T2.1-T2.7,
misure, conferme e ordine di accensione, tornare indietro), §13.5 tutta (13.5.1 regole comuni; 13.5.2 MK1-MK8 e le
forme vere; 13.5.3 controller; 13.5.4 SN1-SN9; 13.5.5 hypervisor; 13.5.6 interruttori; 13.5.7 schema e «Chi legge che
cosa»), §13.4.4-13.4.5 (prove e fiducia), §13.6 (identità), §13.7.2-13.7.6 (collegamenti per cavo), §13.8.3 (albero
dallo spanning tree), §13.12 (scenari «letture spente» e «letture accese», prove I33-I37, I44, I52-I55, I58, prove di T2
del 13.12.4), §13.15 e §13.16 (decisioni prese e scelte aperte).

**Livello di controllo:** **completo** (schema e scritture nei DB dei clienti, letture nuove sui loro apparati), con
**una sola revisione finale su Opus** (scelta di Riccardo per l'esecuzione, 15/10).

## Vincoli globali (Global Constraints)

- **Livello completo.** Ogni task con logica o dato: prova scritta prima e **vista fallire** (si riporta l'uscita
  rossa nel resoconto del task), poi il codice, poi la prova verde. Esito sempre dal codice d'uscita: `cmd > "$LOG"
  2>&1; echo "exit=$?"`, log nello scratchpad dell'esecutore, mai in `/tmp` con nome fisso.
- **Migrazione** additiva, idempotente, in **una transazione**, chiamata **in fondo a `getTenantDb`** (dopo
  `migrateSnmpVersione`, l'ultima di oggi; dopo le ricostruzioni di `network_devices`, ADR 0008 punto 6), restituisce
  l'elenco di ciò che aggiunge; indici solo nella migrazione; **nessun CHECK** sulle colonne nuove; `device_neighbors`
  **non si ricostruisce** (CHECK di `protocol` e chiave unica restano uguali, `db-tenant-schema.ts:789`, `:796`). Se
  fallisce, il tenant si apre lo stesso e le letture in più non scrivono (ADR 0008 punti 10 e 12).
- **Misura sulla copia** prima del rilascio, per ogni tenant: durata, `PRAGMA integrity_check` prima e dopo, seconda
  apertura che non aggiunge niente (`scripts/misura-migrazione-cavi.ts`, Task 1). **Prima del rilascio**: spazio libero
  (`df`; il DB dell'hub pesa 2,1 GB), `PRAGMA quick_check` di **tutti** i tenant di ogni macchina e copie con l'API di
  backup in `data/backups/<tenant>-pre-topologia-cavi-<AAAAMMGG>.db`.
- **Tutte le letture nuove nascono spente.** Interruttori in `tenant_settings` del DB del cliente, valore JSON
  `{"acceso": true, "da": "<utente>", "il": "<UTC>"}`; chiave assente, valore rovinato o `acceso` diverso da `true` =
  **spento**. Chiavi esatte: `topologia.lettura.mikrotik`, `topologia.lettura.controller`, `topologia.lettura.snmp`,
  `topologia.lettura.host`; esito per apparato in `topologia.lettura.<x>.esito`, JSON `{ "<id apparato>": { "il":
  "<UTC>", "comandi": n, "riusciti": m, "codice": "<codice>" | null } }`. `topologia.mappa.cavi` è di T3: qui non nasce.
- **Ordine di accensione:** prima l'hub (apparati nostri: `mikrotik`, poi `controller`, poi `snmp`), poi il cliente A;
  **ogni accensione con la conferma di Riccardo**, dopo i numeri della precedente. `host` solo dopo il nodo di prova e
  l'uscita vera T2-b.
- **La mappa a schermo non cambia in T2**, nemmeno a letture accese: il modello di T1 non legge niente di ciò che T2
  scrive (spec §13.5.7, «Chi legge che cosa»; prove R7/I33). `links.ts`, `model.ts`, `tree.ts`, `attach.ts`,
  `getTopologyModelInput` e il filtro `NEIGHBORS_MODEL_SOURCES_SQL` (`source IN ('device', 'unifi')`) **non si toccano**.
  Le fonti nuove (`ssh`, `snmp`, `host`) non entrano nell'attribuzione degli host (filtro già in T1).
- **Niente comandi che scrivono sugli apparati**: solo `print`, `monitor … once`, GET sul controller, `get`/`walk`
  SNMP, `command -v`, `lldpcli show`, `ip -d -j link show`. Nessun comando senza `once`.
- **Ogni comando remoto ha tre esiti**: riuscito (uscita letta), non riuscito con un codice (errore riconosciuto dal
  **testo**: «no such item», «bad command name», «syntax error», «expected end of command» — su RouterOS ssh esce con 0
  anche sbagliando), non so (tempo scaduto: `TEMPO_SCADUTO`, oppure il codice del trasporto). Un errore non ferma il giro
  e non diventa «uscita vuota». Il resoconto e il log portano **solo il codice**, mai MAC, IP o nomi.
- **Tempo massimo per comando nuovo**: `TEMPO_COMANDO_MS = 20_000` (SSH), `TEMPO_WALK_MS = 10_000` (SNMP). I comandi di
  oggi restano senza (spec §13.5.1). **Cadenza**: al più una lettura in più **ogni 60 minuti per apparato e per
  lettura** (`CADENZA_MS = 3_600_000`), qualunque job chiami il giro; **lucchetto** per apparato nel processo.
- **Carico misurato prima di accendere** (Task 17): durata delle scansioni veloci (`scan_history`), connessioni SSH al
  router (log del router, in sola lettura), righe scritte per tabella, durata del giro degli switch e letture SNMP per
  switch, prima e dopo.
- **Repo pubblico.** Niente nomi, IP, MAC, seriali, numeri di VLAN o nomi scelti veri in codice, prove, fixture, commit,
  documenti: «cliente A», «rete B» (l'hub), «router di testa», «router di frontiera», «router virtuale», «aggregazione».
  Le fixture sono le uscite vere **rese anonime con la stessa forma** (stesse colonne, stesse lunghezze, stessi `\r\n`):
  MAC `02:00:A…`, bridge `BR_RP`/`BR_ZQ_77K`, VLAN `VL_3_QWRTY`…, commenti `cavo-a`…, PVID inventati. Le copie dei DB,
  le istantanee e le uscite vere restano nello scratchpad. Gli elenchi per nome stanno **solo nella chat**.
- **Universale** (vincolo 9): in `src/lib/topology/cavi/` nessun nome di prodotto, nessuna forma di porta di un
  prodotto e **nessun valore del DB che nomina un prodotto** (prova I37, `cavi-senza-prodotti.test.ts`: le parole
  vietate sono cercate anche nei commenti e nelle stringhe); i valori del DB passano da `src/lib/topology/lettori/fonti.ts`.
  Nessun prefisso di nome scelto (`vl_`, `br_`) in `cavi/` e `lettori/` (I58).
- **Prima di accendere qualsiasi job** (es. `unifi_sync` o `hypervisor_sync` su un cliente dove è spento) si leggono
  `src/lib/cron/scheduler-defaults.ts` (incidente 25/05: spegne `fast_scan`/`ping_sweep` sotto i 720 minuti sulle reti
  da 1024 indirizzi in su) e il prefisso delle reti del cliente (`SELECT cidr FROM networks`). T2 non crea job.
- **«Rilasciato»** si legge da `ActiveEnterTimestamp` del servizio dopo l'ora del push, dalla riga d'avvio nel journal e
  dalla riga «nuovo commit su origin/dev (‹hash›)» di `da-ipam-update`; **mai** da `/api/version` (CONTEXT §6). In più,
  per T2: la riga `topologia cavi (T2), aggiunto …` per ogni tenant nel journal.
- Orari a Riccardo in **ora italiana** (UTC+2 fino al 25/10 alle 3:00, poi UTC+1); nel DB sono UTC. Interfaccia: testo
  **≥ 13 px**, **mai il solo colore** (parola o forma accanto), verifica a schermo **una volta, a 1280 e 1920**.
- Regole del repo: `db-tenant` importato solo staticamente (ADR 0002); `JSON.parse` sempre in `try`; niente `any` né
  `console.log`; ogni rotta con `withTenantFromSession` e `requireAuth()`/`requireAdmin()` come prima istruzione; corpi
  validati con Zod; messaggi in italiano; liste a schermo con limite e «+ altri N» (regola 9).
- **Esecuzione:** al massimo **2 agenti che compilano insieme**, ognuno nel suo worktree; mai `git add -A`; un commit per
  task; **una revisione finale su Opus** dell'intera tappa, un giro di correzioni senza ri-revisione completa; cancello
  completo **una volta** prima del rilascio.

## Casi da non dimenticare (Review Focus)

Le condizioni che la spec implica e che nessuna sua prova copre, con il task che le prova.

1. **Un tenant che ha già una delle colonne nuove** (un ritorno indietro e un nuovo avanzamento, o una migrazione
   fermata a metà da un crash fuori transazione): la migrazione aggiunge solo ciò che manca, per colonna, e la seconda
   apertura non aggiunge niente → **Task 1** («una colonna c'è già»).
2. **Una tabella di `monitor` con una colonna stretta** (porta inattiva: la colonna è larga quanto il nome più uno
   spazio) **o con un nome d'interfaccia che contiene uno spazio**: le colonne si prendono dalle posizioni della prima
   riga, e un confine vale solo se in tutte le righe il carattere prima è uno spazio → **Task 3**.
3. **Un router con due bridge**: MK5 ha due colonne e nessuna riga coi nomi; la colonna i è il bridge i di MK3 (stesso
   `[find]`, stesso ordine) → **Task 3** (fixture del router di frontiera).
4. **L'esito salvato rovinato** (JSON tagliato, un id non numerico): vale «mai letto», non blocca la lettura e si
   riscrive pulito; un interruttore rovinato vale **spento** → **Task 2**.
5. **Un apparato che cambia lettore** (uno switch prima letto via SNMP, poi via controller): i fatti delle due fonti
   restano in righe diverse (`source` nella chiave), il modello per cavo prende solo l'ultimo giro di ogni fonte, e
   l'elenco delle porte segue la precedenza del §13.5.7 (controller, poi SNMP, poi `switch_ports`) → **Task 9**.

---

## Struttura dei file

| Pezzo della spec | File | Responsabilità |
| --- | --- | --- |
| T2.1 | `src/lib/db-tenant-schema.ts` (`DDL_TOPOLOGY_CAVI`), `src/lib/db-tenant.ts` (`migrateTopologyCavi`, `schemaCaviPresente`, `rileggiSchemaCavi`, `scriviFattiTopologia`, `setUplinkCavi`, `upsertNeighbors` con le colonne nuove, `NeighborSource`), `scripts/misura-migrazione-cavi.ts` (nuovo), prove in `src/lib/__tests__/topology-cavi-{migration,scrittura}.test.ts` | schema additivo, scrittori, potatura a 90 giorni, misura sulla copia |
| 13.5.1, 13.5.6 (dati) | `src/lib/topology/letture/{interruttori,cadenza}.ts` (nuovi), `src/lib/devices/ssh-transport.ts` (`execConTempo`, `ComandoScaduto`) | interruttori, esito per apparato, cadenza e lucchetto, tempo massimo per comando |
| T2.2 (lettori) | `src/lib/devices/mikrotik-stp.ts` (nuovo), `mikrotik-vicini.ts` (`discoveredBy`, `remoteCaps`), `router-client.ts` (`NeighborEntry`), `stp-ssh.ts` (MK3 e MK5), `snmp-stp-info.ts` (`"mstp"`), fixture `src/lib/devices/__tests__/fixtures/mikrotik-mk*.txt` | le forme vere di MK2-MK8 in fatti neutri |
| T2.2 (giro) | `src/lib/devices/mikrotik-letture.ts` (nuovo), `router-client.ts` (`opzioniSshDiApparato`, `ultimaUscitaInterfacce`), `src/lib/cron/jobs.ts` (ramo dei router e ramo degli switch MikroTik) | una connessione, un `exec` per comando, MK1 di T2, scrittura dei fatti, resoconto |
| T2.3 | `src/lib/integrations/unifi-device.ts`, `unifi-map.ts`, `unifi-sync.ts`, fixture `unifi-stat-device-gateway.json` (nuova) | campi del controller dietro l'interruttore |
| T2.4 | `src/lib/devices/snmp-walk.ts` (nuovo, SN1), `snmp-topologia.ts` (nuovo, SN2-SN9), `switch-client.ts` (`creaWalkSnmp`, `deviceHasSnmpSession` esportata), `src/app/api/devices/[id]/query/route.ts`, `src/app/api/networks/bulk-scan-devices/route.ts`, `jobs.ts` (ramo degli switch) | una sessione per lettura; letture SNMP nuove nel giro degli switch |
| T2.5 (dopo T2-b) | `src/lib/proxmox/lldp-host.ts` (nuovo), `live-interfaces.ts`, `jobs.ts` (`runHypervisorSync`) | `lldpcli` in un comando a parte, stato e MAC permanente dei membri dei bond |
| T2.6 | `src/lib/topology/letture/testi.ts` (nuovo), `src/app/api/topology/settings/letture/route.ts` (nuovo), `src/app/(dashboard)/topology/dati/letture-card.tsx` (nuovo), `dati-client.tsx`, `db-tenant.ts` (`cadenzaLetture`) | «Letture in più per la mappa» |
| T2.7 (modello per cavo) | `src/lib/topology/lettori/fonti.ts` (nuovo), `lettori/traduci.ts` e `lettori/mikrotik.ts` (tunnel di fabbrica), `src/lib/topology/cavi/{prove,collegamenti,albero,modello}.ts` (nuovi), `db-tenant.ts` (`getIngressoCavi`) | prove neutre per porta, collegamenti per cavo, albero dallo spanning tree, in ombra |
| T2.7 (traccia) | `src/lib/topology/cavi/traccia.ts` (nuovo), `src/app/api/topology/traccia/route.ts` (nuovo), `src/lib/permessi/rotte.ts` (`ATTESI`), `src/app/(dashboard)/topology/dati/traccia-card.tsx` (nuovo), `scripts/misura-cavi.ts` (`--fatti-prova`, `--traccia`, `impronta_modello`) | «Cosa cambierebbe con la mappa nuova (una linea per cavo)» |
| prove di tappa | `src/lib/topology/__tests__/cavi-ombra.test.ts`, `src/lib/__tests__/topologia-t2-freno.test.ts` (nuovi) | I33 al livello del DB; «letture accese» sulle reti-campione |
| documenti | spec §13.11.3 (stato), `CONTEXT.md`, `CHANGELOG.md`, `docs/adr/0017-letture-in-piu-spente-e-modello-in-ombra.md` (nuovo), `docs/auth-matrix.md` | (Task 16) |

**Tocca più file di quanto sembri, ma non tocca il modello di T1.** La revisione finale controlla che `git diff
origin/dev -- src/lib/topology/{links,model,tree,attach,link-attrs,node-index}.ts` sia vuoto.

## Esecuzione

`subagent-driven-development` coi controlli del **livello completo** dentro ogni task (prova vista fallire, prove
mirate) e **una sola revisione finale su Opus** di tutta la tappa (Task 16). Al massimo **2 agenti compilano insieme**,
ognuno nel suo worktree. Ramo d'unione `topologia/collegamenti-t2` da `origin/dev`, worktree `$SCRATCH/ipam-t2`; il
secondo agente di un'ondata lavora in `$SCRATCH/ipam-t2-b` su un ramo suo creato dal ramo d'unione; a fine ondata la
sessione principale unisce (`git merge --no-ff`), lancia le prove toccate e `npx tsc --noEmit`, esito dal codice
d'uscita.

| Ondata | Agente A | Agente B | Dopo l'ondata (sessione principale) |
| --- | --- | --- | --- |
| 1 | Task 1 — migrazione e scrittori · **Opus** (zona rossa: schema nei DB dei clienti) | Task 3 — lettori MikroTik sulle forme vere · **Sonnet** | unione; misura della migrazione sulle copie (Task 14, Step 1) |
| 2 | Task 2 — interruttori, cadenza, tempo massimo · **Sonnet** | Task 9 — ingresso e prove del modello per cavo · **Sonnet** | unione |
| 3 | Task 4 — MikroTik nel giro · **Opus** (letture nuove sui router dei clienti) | Task 10 — collegamenti per cavo · **Sonnet** | unione |
| 4 | Task 6 — SNMP · **Opus** (letture nuove sugli switch dei clienti) | Task 5 — controller · **Opus** (scritture nei DB dei clienti dalla sincronizzazione) | unione (prima il 6, poi il 5) |
| 5 | Task 11 — albero dallo spanning tree e modello in ombra · **Sonnet** | Task 8 — «Letture in più per la mappa» · **Sonnet** | unione |
| 6 | Task 12 — la traccia · **Sonnet** | Task 13 — prove di tappa (I33 sul DB, letture accese) · **Sonnet** (non usa la traccia: i suoi numeri li prova il Task 12) | unione |
| 7 (solo se arrivate) | Task 7 — host, dopo T2-b · **Opus** | Task 3b — istanze MSTP (MK7), dopo T2-a · **Sonnet** | unione |
| — | Task 14 (misure sulle copie), 15 (schermo), 16 (revisione, documenti, cancello, conferma, rilascio spento): sessione principale | | |
| — | Task 17-20 (accensioni, data di revisione, promozione): sessione principale con Riccardo | | |

**Perché quest'ordine.** Il 3 e il 9 non dipendono dal codice di altri task se non dallo schema (il 9 legge le tabelle
del Task 1). Il 4 e il 6 toccano tutti e due `jobs.ts`: stanno in ondate diverse. Il 5 tocca solo i file del
controller. Il 12 e l'8 toccano tutti e due `dati-client.tsx`: l'8 viene prima. Il 7 e il 3b dipendono da uscite vere
che non ci sono ancora (T2-b, T2-a): se non arrivano prima del Task 16, il rilascio parte senza di loro, con la lettura
`host` dichiarata «non disponibile in questa versione» e MK7 non mandato («stato per istanza non letto»), e arrivano
con un secondo rilascio della tappa, che segue i Task 14-16 senza migrazione.

**Modelli.** Opus dove il codice scrive nei DB dei clienti o manda comandi nuovi ai loro apparati (1, 4, 5, 6, 7) e per
la revisione finale; Sonnet altrove (logica pura, prove, pagina), col codice di questo piano. Le prove si lanciano dal
worktree con `node --import tsx --test <file>`.

---

## Preparazione (sessione principale, prima dell'ondata 1)

- [ ] **P1 · Worktree.** `$SCRATCH` è lo scratchpad della sessione che esegue.

```bash
REPO=~/Progetti/Domarc/DA-IPAM
git -C "$REPO" fetch origin
git -C "$REPO" worktree add "$SCRATCH/ipam-t2" -b topologia/collegamenti-t2 origin/dev
git -C "$SCRATCH/ipam-t2" log --oneline -1 -- docs/superpowers/plans/2026-10-15-topologia-collegamenti-T2.md; echo "piano exit=$?"
cd "$SCRATCH/ipam-t2" && npm ci > "$SCRATCH/npm-ci-t2.log" 2>&1; echo "exit=$?"
# il codice di prima di T2, per la misura «letture spente» del Task 14
git -C "$REPO" worktree add --detach "$SCRATCH/ipam-dev" origin/dev
cd "$SCRATCH/ipam-dev" && npm ci > "$SCRATCH/npm-ci-dev.log" 2>&1; echo "exit=$?"
```

Atteso: il piano c'è (è su `topologia/t2-piano`, da unire in `dev` come commit di soli documenti, che non riavvia
l'appliance: CONTEXT §3) e `exit=0`. Se il piano non è ancora su `origin/dev`: `git -C "$SCRATCH/ipam-t2" merge --no-ff
origin/topologia/t2-piano -m "documenti: piano di T2"`. Per ogni ondata con due agenti: `git -C "$REPO" worktree add
"$SCRATCH/ipam-t2-b" -b topologia/collegamenti-t2-<task> topologia/collegamenti-t2`, e `npm ci` anche lì.

- [ ] **P2 · Uscite vere della rete B: fatto il 14/10 sera.** I quattro router MikroTik dell'hub, letti in sola lettura
  coi comandi MK1-MK8 (RouterOS 7.24.2 e 7.24.5, via `ssh` senza terminale), stanno nella cartella di lavoro
  dell'indagine, **fuori dal repo** (`$USCITE_HUB`: la sessione principale sa dove). Le fixture del Task 3 sono già
  ricavate da lì e rese anonime in questo piano. Che cosa dicono: forme in RSTP, nessun MSTP; MK5 e MK6 sono tabelle a
  colonne; il bridge-id ha due forme (`0x8000.MAC`, `0.MAC`); un `[find]` vuoto non dà errore; un errore non catturato
  va su stdout con ssh uscito con 0; 32 comandi in circa un secondo per router.

- [ ] **P3 · T2-a: la forma con MSTP (cliente A).** Nel messaggio del mattino, a Riccardo, **una volta**, in sola
  lettura dal terminale del **router 1** (RouterOS 7.24.4), incollando le uscite in un file del dossier del cliente A:

```text
/interface bridge print terse without-paging
/interface bridge port print terse without-paging
/interface bridge monitor [find] once
/interface bridge port monitor [find] once
/interface bridge msti print terse without-paging
/interface bridge msti monitor [find] once
/interface bonding print terse without-paging
/interface bonding monitor [find] once
/interface bridge monitor [find where name=zz] once
:put [:serialize to=json options=json.no-string-conversion [/ip/neighbor/print detail as-value]]
```

  e i tre comandi di MK5-MK7 (`/interface bridge monitor [find] once`, `/interface bridge msti print terse
  without-paging`, `/interface bridge msti monitor [find] once`) su **router di riserva, router 2 e router 3**, che
  dicono regione e radice. Servono al Task 3b (le istanze MSTP) e a decidere se il JSON con `detail` regge sulla RouterOS
  più vecchia fra i clienti. **Non fermano** le ondate 1-6: senza T2-a, MK7 non si manda.

- [ ] **P4 · T2-b: il nodo di prova con `lldpd` (rete B).** Lo prepara chi gestisce i nodi Proxmox dell'hub, con l'ok
  di Riccardo (spec §13.5.5): `lldpd` installato e **nello stesso intervento** spento l'LLDP del firmware delle schede
  Intel X710; se lo switch non vede `lldpd`, si riaccende subito. Poi, dal nodo, in sola lettura:
  `lldpcli -f json0 show neighbors details` e `ip -d -j link show`, salvati nella cartella di lavoro. Servono al Task 7.
  Senza T2-b il Task 7 non parte.

- [ ] **P5 · Il controller con un gateway (rete B, spec §13.5.3).** Una GET in sola lettura di `stat/device` sul
  controller dell'hub (un UDM, che è anche gateway). La chiave API sta nel vault (`secret_ref` nell'`ACCESSI.md` di
  DA-IPAM); si passa a `curl` **da stdin**, mai in argomento (memoria «segreti verso ssh»):

```bash
mkdir -p "$SCRATCH/controller" && chmod 700 "$SCRATCH/controller"
# <host del controller> dall'ACCESSI.md; la chiave dal vault, letta e passata da stdin senza stamparla.
printf 'header = "X-API-KEY: %s"\n' "$(cat "$CHIAVE_UDM_FILE")" \
  | curl -sk -K - "https://<host del controller>/proxy/network/api/s/default/stat/device" \
  > "$SCRATCH/controller/stat-device-vero.json"; echo "exit=$?"
python3 -I "$SCRATCH/controller/anonimizza.py" < "$SCRATCH/controller/stat-device-vero.json" > "$SCRATCH/controller/gateway-anonimo.json"; echo "exit=$?"
```

  `anonimizza.py` (nello scratchpad, mai nel repo) tiene solo il gateway (`type` in `udm`, `ugw`, `uxg`) e un Flex Mini
  (`model` che comincia con `USMINI`), e di loro solo i campi che il parser legge; MAC → `02:00:00:00:00:4N` in ordine,
  IP → `10.0.0.N`, nomi → `name-N`, niente seriali:

```python
import json, re, sys
d = json.load(sys.stdin)
macs, ips = {}, {}
def m(x):
    if not isinstance(x, str) or not re.fullmatch(r"[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}", x): return x
    k = x.lower(); macs.setdefault(k, "02:00:00:00:00:%02x" % (0x40 + len(macs))); return macs[k]
def ip(x):
    if not isinstance(x, str) or not re.fullmatch(r"\d+\.\d+\.\d+\.\d+", x): return x
    ips.setdefault(x, "10.0.0.%d" % (100 + len(ips))); return ips[x]
def porta(p):
    t = {k: p.get(k) for k in ("port_idx", "name", "up", "enable", "speed", "is_uplink", "stp_state", "stp_pathcost", "lag_idx", "aggregated_by", "media") if k in p}
    if isinstance(t.get("name"), str) and not re.fullmatch(r"(Port|SFP\+?|SFP28|eth|SFP_) ?\d+", t["name"]): t["name"] = "Port %s" % t.get("port_idx")
    return t
def lldp(e):
    t = {k: e.get(k) for k in ("chassis_id", "chassis_id_subtype", "port_id", "local_port_idx", "local_port_name", "is_wired") if k in e}
    t["chassis_id"] = m(t.get("chassis_id")); pid = t.get("port_id")
    if isinstance(pid, str) and re.fullmatch(r"[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}", pid): t["port_id"] = m(pid)
    return t
out = []
for x in d.get("data", []):
    tipo, modello = x.get("type"), str(x.get("model", ""))
    if tipo not in ("udm", "ugw", "uxg") and not modello.startswith("USMINI"): continue
    up = x.get("uplink") or {}
    out.append({
        "type": tipo, "model": modello, "mac": m(x.get("mac")), "name": "name-%d" % (len(out) + 40), "ip": ip(x.get("ip")),
        "state": x.get("state"), "adopted": x.get("adopted"), "stp_version": x.get("stp_version"), "stp_priority": x.get("stp_priority"),
        "root_switch": m(x.get("root_switch")),
        "ethernet_table": [{"mac": m(e.get("mac")), "name": "name-%d" % i, **({"num_port": e["num_port"]} if "num_port" in e else {})} for i, e in enumerate(x.get("ethernet_table") or [])],
        "port_table": [porta(p) for p in x.get("port_table") or []],
        "lldp_table": [lldp(e) for e in x.get("lldp_table") or []],
        "uplink": {k: (m(v) if k == "uplink_mac" else v) for k, v in up.items() if k in ("port_idx", "uplink_mac", "uplink_remote_port", "uplink_source", "type", "up", "speed")},
    })
json.dump({"meta": {"rc": "ok"}, "data": out}, sys.stdout, indent=1, ensure_ascii=False)
```

  Poi la sessione principale legge, sul file anonimo: (a) se le righe `lldp_table` del gateway hanno `local_port_idx`;
  (b) se c'è un partner LACP in qualche campo del fascio; (c) se `ethernet_table` contiene il «MAC del controller + 1»
  con cui lo switch si annuncia (S8). Le risposte vanno nel resoconto del Task 5 e nella spec (13.5.3), **come fatti**.
  Prima del commit, `grep -E -c '([0-9a-f]{2}:){5}' gateway-anonimo.json` contro l'elenco dei MAC veri: 0 coincidenze.

- [ ] **P6 · Copie fresche.** Come P3 del piano di T1 (`2026-10-14-topologia-collegamenti-T1.md`): copia coerente con
  `sqlite3 <db> ".backup '/var/tmp/copia-<tenant>.db'"`, `sha256sum` sul server e sul Mac uguali, `rm` della copia sul
  server, `PRAGMA quick_check` sul Mac. Servono: la copia del cliente A, quella dell'hub, e **una copia di ogni altro
  tenant** delle due macchine (per la misura della migrazione, Task 14 Step 1). I percorsi non vanno mai nel repo.

---
## Parte 1 — Dati e lettori

### Task 1: la migrazione, gli scrittori e la misura sulla copia (T2.1) — livello completo, zona rossa

Spec §13.5.7 tutta, §13.11.3 (T2.1, «Misure sulle copie», primo punto), prove I34, I35, I55, prove di T2 del 13.12.4
(«migrazione additiva e idempotente, righe vecchie intatte, CHECK di `protocol` e chiave unica uguali»).

**Una colonna in più rispetto al DDL del §13.5.7 (scelta del piano, dichiarata):** `topology_port_facts.lag_state`
(`'attivo'` | `'riserva'`). La spec chiede di leggere lo stato del membro di un bond (§13.5.5, «Riserva del bond») e di
usarlo (§13.7.2 passo 8, «riserva del bond»), ma il suo DDL non ha dove scriverlo. È additiva e senza CHECK; va a
Riccardo come fatto da confermare col messaggio del rilascio.

**Files:**
- Modify: `src/lib/db-tenant-schema.ts` (dopo l'import, `DDL_TOPOLOGY_CAVI`; nel testo di `TENANT_SCHEMA_SQL`, subito
  dopo `CREATE TABLE IF NOT EXISTS device_neighbors (…);`, le tre CREATE)
- Modify: `src/lib/db-tenant.ts` (`migrateTopologyCavi` dopo `migrateSnmpVersione`; la chiamata in fondo a `getTenantDb`
  dopo quella di `migrateSnmpVersione`; `NeighborSource`; `CampiViciniCavi` e l'istruzione a parte in `upsertNeighbors`;
  `schemaCaviPresente`, `rileggiSchemaCavi`, `scriviFattiTopologia`, `setUplinkCavi` subito dopo `getNeighborsByDevice`)
- Create: `scripts/misura-migrazione-cavi.ts`
- Test: `src/lib/__tests__/topology-cavi-migration.test.ts`, `src/lib/__tests__/topology-cavi-scrittura.test.ts`

**Interfaces:**
- Consumes: `getTenantDb`, `withTenant`, `upsertNeighbors`, `upsertSwitchPorts`, `getNetworkDeviceKnownMacs`,
  `getTopologyModelInput` (tutti di oggi, `db-tenant.ts`).
- Produces (da `src/lib/db-tenant-schema.ts`): `DDL_TOPOLOGY_CAVI: ReadonlyArray<readonly [string, string]>`.
- Produces (da `src/lib/db-tenant.ts`):
  - `migrateTopologyCavi(db: Database.Database): string[]`
  - `schemaCaviPresente(): boolean`, `rileggiSchemaCavi(): boolean`
  - `type NeighborSource = "device" | "unifi" | "ssh" | "snmp" | "host"`
  - `interface CampiViciniCavi { discoveredBy?: string | null; localPortIndex?: number | null; remotePortIndex?: number | null; remoteCaps?: string | null }`
  - `type FonteFatti = "device" | "controller" | "snmp" | "host"`
  - `interface FattoPortaIn`, `interface FattoBridgeIn`, `interface MacApparatoIn`, `interface FattiLettura` (sotto)
  - `scriviFattiTopologia(deviceId: number, fonte: FonteFatti, fatti: FattiLettura, adesso?: Date): { porte: number; bridge: number; macs: number } | null`
  - `setUplinkCavi(deviceId: number, porta: number | null, origine: string | null): boolean`

- [ ] **Step 1: le prove della migrazione, viste fallire** — `src/lib/__tests__/topology-cavi-migration.test.ts`:

```ts
// Migrazione «topologia cavi» (spec 2026-10-14 §13.5.7, tappa T2): tre tabelle di fatti delle letture in più e sei
// colonne (quattro su device_neighbors, due su network_devices), più `lag_state` (stato del membro di un bond, §13.5.5:
// la spec lo usa e il suo DDL non l'aveva). Additiva, idempotente, in UNA transazione: device_neighbors non si ricostruisce
// (CHECK di protocol e chiave unica uguali, ADR 0008 «Alternative scartate», regola 10 del repo). Il DB «vecchio»
// riproduce le due tabelle come sono alla v0.3.293.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, migrateTopologyCavi, schemaCaviPresente, withTenant } from "@/lib/db-tenant";

const T = "TESTTOPOCAVIMIG";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

function vecchio(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE network_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, host TEXT NOT NULL, device_type TEXT NOT NULL,
      vendor TEXT NOT NULL, protocol TEXT NOT NULL, uplink_mac TEXT, uplink_remote_port INTEGER
    );
    CREATE TABLE device_neighbors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
      local_port TEXT NOT NULL,
      remote_device_name TEXT NOT NULL DEFAULT '',
      remote_port TEXT NOT NULL DEFAULT '',
      protocol TEXT NOT NULL CHECK(protocol IN ('lldp', 'cdp', 'mndp', 'unknown')),
      remote_ip TEXT,
      remote_mac TEXT,
      remote_platform TEXT,
      first_seen TEXT,
      source TEXT NOT NULL DEFAULT 'device',
      timestamp TEXT DEFAULT (datetime('now')),
      UNIQUE(device_id, local_port, remote_device_name, remote_port)
    );
    INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (7, 'SW-7', '10.0.0.7', 'switch', 'other', 'ssh');
    INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_mac, source, timestamp)
      VALUES (7, 'Port 3', 'RTR-1', 'ether2', 'lldp', '02:00:00:00:01:01', 'unifi', '2026-10-13 11:00:00');
  `);
  return db;
}

const schema = (db: Database.Database) => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
const sqlDi = (db: Database.Database, nome: string): string =>
  String((db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(nome) as { sql: string }).sql);

test("aggiunge colonne, tabelle e indice; la seconda volta niente", () => {
  const db = vecchio();
  assert.deepEqual([...migrateTopologyCavi(db)].sort(), [
    "device_neighbors.discovered_by", "device_neighbors.local_port_index", "device_neighbors.remote_caps",
    "device_neighbors.remote_port_index", "idx_topology_device_macs_mac", "network_devices.uplink_local_port_idx",
    "network_devices.uplink_source", "topology_bridge_facts", "topology_device_macs", "topology_port_facts",
  ]);
  const prima = schema(db);
  assert.deepEqual(migrateTopologyCavi(db), []);
  assert.deepEqual(schema(db), prima, "seconda apertura: niente cambia");
});

test("device_neighbors non si ricostruisce: CHECK, chiave unica e righe di prima uguali", () => {
  const db = vecchio();
  const sqlPrima = sqlDi(db, "device_neighbors");
  migrateTopologyCavi(db);
  const sqlDopo = sqlDi(db, "device_neighbors");
  assert.ok(sqlDopo.includes("CHECK(protocol IN ('lldp', 'cdp', 'mndp', 'unknown'))"));
  assert.ok(sqlDopo.includes("UNIQUE(device_id, local_port, remote_device_name, remote_port)"));
  assert.ok(sqlDopo.startsWith(sqlPrima.slice(0, sqlPrima.lastIndexOf(")"))), "solo colonne aggiunte in coda");
  assert.deepEqual(
    db.prepare("SELECT device_id, local_port, remote_device_name, remote_port, protocol, source, discovered_by FROM device_neighbors").all(),
    [{ device_id: 7, local_port: "Port 3", remote_device_name: "RTR-1", remote_port: "ether2", protocol: "lldp", source: "unifi", discovered_by: null }],
  );
  assert.throws(() => db.prepare("INSERT INTO device_neighbors (device_id, local_port, protocol) VALUES (7, 'x', 'snmp')").run(), /CHECK/);
  // Le colonne nuove sono senza CHECK: un valore nuovo non chiede una ricostruzione.
  assert.doesNotThrow(() => db.prepare("INSERT INTO topology_port_facts (device_id, source, port_key, port_name, if_kind) VALUES (7, 'nuova', 'n:x', 'x', 'qualunque')").run());
});

test("una colonna c'è già (ritorno indietro e nuovo avanzamento): si aggiunge solo ciò che manca", () => {
  const db = vecchio();
  db.exec("ALTER TABLE device_neighbors ADD COLUMN discovered_by TEXT");
  const aggiunte = migrateTopologyCavi(db);
  assert.equal(aggiunte.includes("device_neighbors.discovered_by"), false);
  assert.equal(aggiunte.includes("device_neighbors.remote_caps"), true);
});

test("in transazione: se un passo fallisce non resta niente a metà", () => {
  const db = new Database(":memory:");
  // Manca network_devices: l'ALTER su network_devices fallisce dopo quelli su device_neighbors.
  db.exec("CREATE TABLE device_neighbors (id INTEGER PRIMARY KEY, device_id INTEGER, local_port TEXT, protocol TEXT)");
  assert.throws(() => migrateTopologyCavi(db));
  const colonne = (db.prepare("PRAGMA table_info(device_neighbors)").all() as Array<{ name: string }>).map((c) => c.name);
  assert.deepEqual(colonne, ["id", "device_id", "local_port", "protocol"]);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'topology_port_facts'").get(), undefined);
});

test("all'apertura del tenant: schema presente, e le tabelle nuove puntano ancora a network_devices", () => {
  getTenantDb(T);
  assert.equal(withTenant(T, () => schemaCaviPresente()), true);
  for (const t of ["topology_port_facts", "topology_bridge_facts", "topology_device_macs"]) {
    const fk = getTenantDb(T).prepare(`PRAGMA foreign_key_list(${t})`).all() as Array<{ table: string; on_delete: string }>;
    assert.deepEqual(fk.map((f) => [f.table, f.on_delete]), [["network_devices", "CASCADE"]], t);
  }
});
```

```bash
cd "$SCRATCH/ipam-t2" && node --import tsx --test src/lib/__tests__/topology-cavi-migration.test.ts > "$SCRATCH/t1-rosso.log" 2>&1; echo "exit=$?"
```

Atteso: `exit=1`, «does not provide an export named 'migrateTopologyCavi'» (o simile). Si riporta la riga nel resoconto.

- [ ] **Step 2: lo schema** — in `src/lib/db-tenant-schema.ts`, dopo `import { SCHEDULED_JOB_TYPES_CHECK_SQL } …`:

```ts
/**
 * Topologia T2 (spec 2026-10-14 §13.5.7): i fatti delle letture in più, uno per lettore (la fonte sta nella chiave:
 * due lettori dello stesso apparato non si sovrascrivono, ADR 0009 punto 4). Le stesse CREATE stanno qui e nella
 * migrazione (`migrateTopologyCavi`, db-tenant.ts); gli indici solo nella migrazione. Nessun CHECK: i valori li valida
 * TypeScript (un valore nuovo non deve chiedere una ricostruzione, vietata con le chiavi esterne). `lag_state`
 * ('attivo' | 'riserva') è lo stato del membro di un bond letto dall'host (§13.5.5), che il DDL della spec non aveva.
 */
export const DDL_TOPOLOGY_CAVI: ReadonlyArray<readonly [string, string]> = [
  ["topology_port_facts", `CREATE TABLE IF NOT EXISTS topology_port_facts (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  port_key TEXT NOT NULL,
  port_name TEXT NOT NULL,
  port_index INTEGER,
  if_kind TEXT,
  running INTEGER,
  in_bridge INTEGER,
  bridge TEXT,
  lag_group TEXT,
  lag_partner TEXT,
  lag_state TEXT,
  stp_role TEXT,
  stp_state TEXT,
  designated_bridge TEXT,
  designated_port TEXT,
  path_cost INTEGER,
  edge INTEGER,
  point_to_point INTEGER,
  sending_rstp INTEGER,
  bpdu_rx INTEGER,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, source, port_key)
)`],
  ["topology_bridge_facts", `CREATE TABLE IF NOT EXISTS topology_bridge_facts (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  bridge_name TEXT NOT NULL DEFAULT '',
  instance INTEGER NOT NULL DEFAULT 0,
  protocol TEXT,
  priority INTEGER,
  bridge_id TEXT,
  root_id TEXT,
  regional_root_id TEXT,
  region_name TEXT,
  region_revision INTEGER,
  config_digest TEXT,
  vlans TEXT,
  root_port TEXT,
  root_path_cost INTEGER,
  first_seen TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, source, bridge_name, instance)
)`],
  ["topology_device_macs", `CREATE TABLE IF NOT EXISTS topology_device_macs (
  device_id INTEGER NOT NULL REFERENCES network_devices(id) ON DELETE CASCADE,
  mac TEXT NOT NULL,
  source TEXT NOT NULL,
  port_key TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (device_id, mac)
)`],
];
```

  e in `TENANT_SCHEMA_SQL`, sulla riga vuota subito dopo la chiusura di `device_neighbors` (`);` della riga 797):

```ts
${DDL_TOPOLOGY_CAVI.map(([, ddl]) => `${ddl};`).join("\n\n")}
```

- [ ] **Step 3: la migrazione e l'annotazione** — in `src/lib/db-tenant.ts`, subito dopo `migrateSnmpVersione`:

```ts
/**
 * Migrazione «topologia cavi» (spec 2026-10-14 §13.5.7, tappa T2): le colonne nuove dei vicini e degli apparati e le tre
 * tabelle dei fatti delle letture in più, con l'indice sui MAC. Additiva, idempotente, in UNA transazione (o tutto o
 * niente); restituisce ciò che aggiunge. Le tabelle nascono anche dallo schema (stesse CREATE, `DDL_TOPOLOGY_CAVI`): qui
 * servono ai DB aperti senza lo schema di oggi e alle prove. Chiamata in fondo a `getTenantDb`, dopo le ricostruzioni di
 * network_devices (ADR 0008 punto 6). Esportata per le prove (`topology-cavi-migration.test.ts`).
 */
export function migrateTopologyCavi(db: Database.Database): string[] {
  const added: string[] = [];
  const has = (table: string, col: string): boolean =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
  const exists = (type: "table" | "index", name: string): boolean =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get(type, name);
  const add = (table: string, col: string, ddl: string): void => {
    if (has(table, col)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
    added.push(`${table}.${col}`);
  };
  db.transaction(() => {
    add("device_neighbors", "discovered_by", "TEXT");
    add("device_neighbors", "local_port_index", "INTEGER");
    add("device_neighbors", "remote_port_index", "INTEGER");
    add("device_neighbors", "remote_caps", "TEXT");
    add("network_devices", "uplink_local_port_idx", "INTEGER");
    add("network_devices", "uplink_source", "TEXT");
    for (const [name, ddl] of DDL_TOPOLOGY_CAVI) {
      if (exists("table", name)) continue;
      db.exec(ddl);
      added.push(name);
    }
    add("topology_port_facts", "lag_state", "TEXT");
    if (!exists("index", "idx_topology_device_macs_mac")) {
      db.exec("CREATE INDEX idx_topology_device_macs_mac ON topology_device_macs(mac)");
      added.push("idx_topology_device_macs_mac");
    }
  })();
  return added;
}

/** Le colonne che le letture in più scrivono: tutte, o le letture non scrivono (§13.5.7, «Se la migrazione non riesce»). */
const COLONNE_CAVI: ReadonlyArray<readonly [string, string]> = [
  ["device_neighbors", "discovered_by"], ["device_neighbors", "local_port_index"], ["device_neighbors", "remote_port_index"],
  ["device_neighbors", "remote_caps"], ["network_devices", "uplink_local_port_idx"], ["network_devices", "uplink_source"],
  ["topology_port_facts", "lag_state"],
];
/** «Lo schema nuovo c'è», annotato all'apertura del DB del tenant: chi scrive i fatti lo chiede, non lo indovina. */
const SCHEMA_CAVI = new WeakMap<Database.Database, boolean>();

function verificaSchemaCavi(d: Database.Database): boolean {
  const tabelle = new Set((d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
  if (!DDL_TOPOLOGY_CAVI.every(([n]) => tabelle.has(n))) return false;
  return COLONNE_CAVI.every(([t, c]) => (d.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).some((x) => x.name === c));
}
```

  `import { TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "./db-tenant-schema";` diventa
  `import { DDL_TOPOLOGY_CAVI, TENANT_SCHEMA_SQL, TENANT_INDEXES_SQL } from "./db-tenant-schema";`.

  In fondo a `getTenantDb`, dopo il blocco di `migrateSnmpVersione` e prima di `tenantDbs.set(…)`:

```ts
  // Topologia T2 (spec §13.5.7): fatti delle letture in più. Per ultima, dopo le ricostruzioni di network_devices
  // (ADR 0008 punto 6). Se fallisce il tenant si apre lo stesso: l'annotazione dice «schema assente», le letture in
  // più non scrivono, il modello per cavo riceve elenchi vuoti e «Dati della mappa» lo dice. La riga «topologia cavi
  // (T2), aggiunto …» nel journal è la prova del rilascio (piano di T2, Task 16).
  try {
    const added = migrateTopologyCavi(newDb);
    if (added.length > 0) {
      console.info(`[db-tenant] ${tenantCode}: topologia cavi (T2), aggiunto ${added.join(", ")}`);
    }
  } catch (e) {
    console.error(`[db-tenant] ${tenantCode}: migrazione topologia cavi (T2) fallita, le letture in più non scrivono:`, e);
  }
  SCHEMA_CAVI.set(newDb, verificaSchemaCavi(newDb));
```

- [ ] **Step 4: verde** — `node --import tsx --test src/lib/__tests__/topology-cavi-migration.test.ts`, atteso `exit=0`.

- [ ] **Step 5: le prove della scrittura, viste fallire** — `src/lib/__tests__/topology-cavi-scrittura.test.ts`:

```ts
// Scrittura dei fatti delle letture in più (spec §13.5.7, «Come si scrive»): INSERT … ON CONFLICT, `seen_at` si sposta,
// `first_seen` resta, le colonne che il lettore non conosce restano com'erano; niente DELETE del giro; potatura a 90
// giorni delle righe dell'apparato, nella stessa transazione. Le colonne nuove dei vicini con un'istruzione a parte, che
// non ferma mai la scrittura dei vicini (I34). I fatti non entrano in switch_ports (I35) né nei MAC noti che decidono
// l'abbinamento del controller (I55).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase, getNetworkDeviceKnownMacs, getTenantDb, getTopologyModelInput, rileggiSchemaCavi, schemaCaviPresente,
  scriviFattiTopologia, setUplinkCavi, upsertNeighbors, upsertSwitchPorts, withTenant,
} from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";

const T = "TESTTOPOCAVISCRIVE";
const db = () => getTenantDb(T);
const ORA = new Date("2026-10-15T10:00:00Z");

beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM switch_ports; DELETE FROM network_devices; DELETE FROM hosts;`);
  db().prepare("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh'), (2, 'SW-2', '10.0.0.2', 'switch', 'ubiquiti', 'api')").run();
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const porta = (over: Record<string, unknown> = {}) => ({ port_key: "n:ether2", port_name: "ether2", if_kind: "physical", running: 1, stp_state: "forwarding", ...over });

test("scrive, poi aggiorna: seen_at si sposta, first_seen resta; le colonne che il lettore non conosce restano", () => {
  withTenant(T, () => {
    assert.deepEqual(scriviFattiTopologia(1, "device", { porte: [porta({ stp_role: "designated" })], bridge: [], macs: [] }, ORA), { porte: 1, bridge: 0, macs: 0 });
    const dopo = new Date("2026-10-15T11:00:00Z");
    // Il secondo giro non conosce stp_role (assente da tutte le righe): resta; stp_state letto e vuoto (null): si scrive null.
    scriviFattiTopologia(1, "device", { porte: [{ port_key: "n:ether2", port_name: "ether2", stp_state: null }], bridge: [], macs: [] }, dopo);
  });
  const r = db().prepare("SELECT stp_role, stp_state, if_kind, first_seen, seen_at FROM topology_port_facts").get();
  assert.deepEqual(r, { stp_role: "designated", stp_state: null, if_kind: "physical", first_seen: "2026-10-15 10:00:00", seen_at: "2026-10-15 11:00:00" });
});

test("due lettori dello stesso apparato non si sovrascrivono (la fonte è nella chiave)", () => {
  withTenant(T, () => {
    scriviFattiTopologia(2, "controller", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3 })], bridge: [], macs: [] }, ORA);
    scriviFattiTopologia(2, "snmp", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3, stp_state: "discarding" })], bridge: [], macs: [] }, ORA);
  });
  assert.deepEqual(db().prepare("SELECT source, stp_state FROM topology_port_facts ORDER BY source").all(),
    [{ source: "controller", stp_state: "forwarding" }, { source: "snmp", stp_state: "discarding" }]);
});

test("potatura: le righe dell'apparato non viste da 90 giorni se ne vanno alla scrittura dopo; quelle di 30 restano", () => {
  db().prepare("INSERT INTO topology_port_facts (device_id, source, port_key, port_name, seen_at) VALUES (1, 'device', 'n:vecchia', 'vecchia', '2026-07-01 10:00:00'), (1, 'device', 'n:recente', 'recente', '2026-09-20 10:00:00')").run();
  db().prepare("INSERT INTO topology_device_macs (device_id, mac, source, seen_at) VALUES (1, '02:00:00:00:00:99', 'device', '2026-07-01 10:00:00')").run();
  withTenant(T, () => scriviFattiTopologia(1, "device", { porte: [porta()], bridge: [], macs: [{ mac: "02:00:00:00:00:01", port_key: "n:ether2" }] }, ORA));
  assert.deepEqual((db().prepare("SELECT port_key FROM topology_port_facts ORDER BY port_key").all() as Array<{ port_key: string }>).map((r) => r.port_key), ["n:ether2", "n:recente"]);
  assert.deepEqual((db().prepare("SELECT mac FROM topology_device_macs").all() as Array<{ mac: string }>).map((r) => r.mac), ["02:00:00:00:00:01"]);
});

test("bridge per istanza e MAC normalizzati; un MAC tutto zeri non si scrive", () => {
  withTenant(T, () => scriviFattiTopologia(1, "device", {
    porte: [],
    bridge: [{ bridge_name: "BR_RP", instance: 0, protocol: "rstp", priority: 0, bridge_id: "0.02:00:a0:10:0e:02", root_id: "0.02:00:a0:10:0e:02", root_port: null }],
    macs: [{ mac: "02-00-a0-10-0e-02", port_key: "n:sfp-sfpplus1" }, { mac: "00:00:00:00:00:00", port_key: "n:lo" }],
  }, ORA));
  assert.deepEqual(db().prepare("SELECT bridge_name, instance, protocol, priority, root_port FROM topology_bridge_facts").all(),
    [{ bridge_name: "BR_RP", instance: 0, protocol: "rstp", priority: 0, root_port: null }]);
  assert.deepEqual((db().prepare("SELECT mac FROM topology_device_macs").all() as Array<{ mac: string }>).map((r) => r.mac), ["02:00:A0:10:0E:02"]);
});

test("I35: upsertSwitchPorts riscrive switch_ports e lascia stare i fatti", () => {
  withTenant(T, () => {
    scriviFattiTopologia(2, "controller", { porte: [porta({ port_key: "i:3", port_name: "Port 3", port_index: 3 })], bridge: [], macs: [] }, ORA);
    upsertSwitchPorts(2, []);
  });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM topology_port_facts").get() as { n: number }).n, 1);
});

test("I55: i MAC dei lettori nuovi non entrano nei MAC noti (la sincronizzazione del controller li usa per abbinare)", () => {
  const prima = withTenant(T, () => getNetworkDeviceKnownMacs());
  withTenant(T, () => scriviFattiTopologia(1, "device", { porte: [], bridge: [], macs: [{ mac: "02:00:00:00:00:77", port_key: null }] }, ORA));
  assert.deepEqual(withTenant(T, () => getNetworkDeviceKnownMacs()), prima);
});

test("colonne nuove dei vicini: scritte a parte quando ci sono, lasciate stare quando mancano", () => {
  withTenant(T, () => {
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp", discoveredBy: "cdp,lldp,mndp", remoteCaps: "bridge" }]);
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" }]);
  });
  assert.deepEqual(db().prepare("SELECT discovered_by, remote_caps, local_port_index FROM device_neighbors").get(),
    { discovered_by: "cdp,lldp,mndp", remote_caps: "bridge", local_port_index: null });
});

test("le fonti nuove (ssh, snmp, host) non entrano nell'ingresso del modello di oggi", () => {
  withTenant(T, () => {
    upsertNeighbors(2, [{ localPort: "Port 3", remoteDevice: "RTR-1", remotePort: "ether2", protocol: "lldp" }], "snmp");
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp" }], "ssh");
  });
  assert.equal(withTenant(T, () => getTopologyModelInput(2)).neighbors.length, 0);
});

test("I34: una migrazione non riuscita non ferma i vicini, e il modello si calcola", () => {
  db().exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps"); // simula lo schema a metà
  withTenant(T, () => {
    assert.equal(schemaCaviPresente(), true, "l'annotazione di prima dice ancora «presente»: l'istruzione a parte fallirà");
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Port 3", protocol: "lldp", remoteCaps: "bridge" }]);
    assert.equal(rileggiSchemaCavi(), false);
    assert.equal(scriviFattiTopologia(1, "device", { porte: [porta()], bridge: [], macs: [] }, ORA), null, "senza schema non si scrive");
    assert.equal(setUplinkCavi(2, 3, "lldp_uplink"), false);
    assert.equal(buildTopologyModel(getTopologyModelInput(2)).counts.devices, 2);
  });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM device_neighbors").get() as { n: number }).n, 1, "il vicino c'è");
  db().exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
});
```

```bash
node --import tsx --test src/lib/__tests__/topology-cavi-scrittura.test.ts > "$SCRATCH/t1-scrittura-rosso.log" 2>&1; echo "exit=$?"
```

Atteso: `exit=1` (esportazioni mancanti).

- [ ] **Step 6: gli scrittori** — in `src/lib/db-tenant.ts`:

  `export type NeighborSource = "device" | "unifi";` diventa:

```ts
/**
 * Chi ha scritto una riga dei vicini. `device` e `unifi` sono quelle che leggono il modello di oggi e l'attribuzione
 * (NEIGHBORS_MODEL_SOURCES_SQL); `ssh` (switch MikroTik nel giro), `snmp` (switch non del controller) e `host` (`lldpcli`
 * sugli hypervisor) sono le fonti nuove di T2 (spec §13.5.7): le legge solo il modello per cavo. La colonna non ha
 * vincoli (db-tenant-schema.ts): non serve schema.
 */
export type NeighborSource = "device" | "unifi" | "ssh" | "snmp" | "host";

/**
 * Le colonne nuove dei vicini (spec §13.5.7): l'elenco letto di `discovered-by`, gli indici delle due porte quando il
 * lettore li sa, le capacità annunciate attive. Si scrivono con un'istruzione a parte, solo se lo schema le ha.
 */
export interface CampiViciniCavi {
  discoveredBy?: string | null;
  localPortIndex?: number | null;
  remotePortIndex?: number | null;
  remoteCaps?: string | null;
}
```

  La firma di `upsertNeighbors` riceve le colonne nuove (`neighbors: Array<{ … remotePlatform?: string } &
  CampiViciniCavi>`); dopo la transazione di oggi e **prima** del blocco dell'attribuzione:

```ts
  // T2 (spec §13.5.7): le colonne nuove con un'istruzione a parte, dopo quella di oggi e solo se lo schema le ha. Un
  // errore qui non tocca i vicini già scritti (I34): si scrive nel log col solo messaggio di SQLite, senza dati.
  const conCavi = neighbors.filter((n) => n.discoveredBy !== undefined || n.localPortIndex !== undefined
    || n.remotePortIndex !== undefined || n.remoteCaps !== undefined);
  if (conCavi.length > 0 && schemaCaviPresente()) {
    try {
      const up = d.prepare(`UPDATE device_neighbors SET
          discovered_by = COALESCE(?, discovered_by), local_port_index = COALESCE(?, local_port_index),
          remote_port_index = COALESCE(?, remote_port_index), remote_caps = COALESCE(?, remote_caps)
        WHERE device_id = ? AND local_port = ? AND remote_device_name = ? AND remote_port = ?`);
      d.transaction(() => {
        for (const n of conCavi) {
          up.run(n.discoveredBy ?? null, n.localPortIndex ?? null, n.remotePortIndex ?? null, n.remoteCaps ?? null,
            deviceId, n.localPort, n.remoteDevice, n.remotePort);
        }
      })();
    } catch (e) {
      console.error(`[db-tenant] apparato #${deviceId}: colonne nuove dei vicini non scritte (${e instanceof Error ? e.message : "errore"})`);
    }
  }
```

  Subito dopo `getNeighborsByDevice`:

```ts
// ═══════════════════════════════════════════════════════════════════════════
// TOPOLOGIA T2 — fatti delle letture in più (spec 2026-10-14 §13.5.7)
// ═══════════════════════════════════════════════════════════════════════════

/** Lo schema delle letture in più c'è in questo tenant (annotato all'apertura, `getTenantDb`). */
export function schemaCaviPresente(): boolean {
  const d = db();
  const v = SCHEMA_CAVI.get(d);
  if (v !== undefined) return v;
  const ok = verificaSchemaCavi(d);
  SCHEMA_CAVI.set(d, ok);
  return ok;
}

/** Riguarda lo schema e aggiorna l'annotazione (per le prove, e per chi ha appena riparato un tenant a mano). */
export function rileggiSchemaCavi(): boolean {
  const d = db();
  const ok = verificaSchemaCavi(d);
  SCHEMA_CAVI.set(d, ok);
  return ok;
}

/** Chi ha letto i fatti (spec §13.5.7): il lettore, mai la marca. */
export type FonteFatti = "device" | "controller" | "snmp" | "host";

/**
 * Un fatto di porta come lo scrive un lettore. `port_key`: «i:<indice>» se l'indice è noto, altrimenti «n:<nome
 * normalizzato>» (minuscole, senza spazi). Un campo ASSENTE (undefined) da tutte le righe di una scrittura = «questo
 * lettore non lo sa»: resta com'era. Un campo `null` = letto e vuoto: si scrive null.
 */
export interface FattoPortaIn {
  port_key: string;
  port_name: string;
  port_index?: number | null;
  /** 'physical' | 'lag' | 'vlan' | 'vrrp' | 'bridge' | 'tunnel' | 'wireless' | 'other' */
  if_kind?: string | null;
  running?: number | null;
  in_bridge?: number | null;
  bridge?: string | null;
  lag_group?: string | null;
  lag_partner?: string | null;
  /** 'attivo' | 'riserva' (membro di un bond letto dall'host). */
  lag_state?: string | null;
  /** 'root' | 'designated' | 'alternate' | 'backup' | 'disabled' */
  stp_role?: string | null;
  /** 'forwarding' | 'discarding' | 'learning' | 'disabled' */
  stp_state?: string | null;
  designated_bridge?: string | null;
  designated_port?: string | null;
  path_cost?: number | null;
  edge?: number | null;
  point_to_point?: number | null;
  sending_rstp?: number | null;
  bpdu_rx?: number | null;
}

/** Un bridge per istanza (0 = albero comune). `root_port` null con `root_id` uguale a `bridge_id` = la radice. */
export interface FattoBridgeIn {
  bridge_name: string;
  instance: number;
  protocol?: string | null;
  priority?: number | null;
  bridge_id?: string | null;
  root_id?: string | null;
  regional_root_id?: string | null;
  region_name?: string | null;
  region_revision?: number | null;
  config_digest?: string | null;
  vlans?: string | null;
  root_port?: string | null;
  root_path_cost?: number | null;
}

export interface MacApparatoIn { mac: string; port_key: string | null }

export interface FattiLettura {
  porte: readonly FattoPortaIn[];
  bridge: readonly FattoBridgeIn[];
  macs: readonly MacApparatoIn[];
}

const COLONNE_PORTA = ["port_index", "if_kind", "running", "in_bridge", "bridge", "lag_group", "lag_partner", "lag_state", "stp_role",
  "stp_state", "designated_bridge", "designated_port", "path_cost", "edge", "point_to_point", "sending_rstp", "bpdu_rx"] as const;
const COLONNE_BRIDGE = ["protocol", "priority", "bridge_id", "root_id", "regional_root_id", "region_name", "region_revision",
  "config_digest", "vlans", "root_port", "root_path_cost"] as const;
/** I fatti non visti da tanti giorni si tolgono alla scrittura successiva dello stesso apparato (come i vicini). */
const FATTI_RETENTION_DAYS = 90;

/** Le colonne che un lettore conosce: presenti (anche null) in almeno una riga della scrittura. Elenco chiuso: niente SQL dal dato. */
function colonneNote<C extends string>(righe: readonly object[], tutte: readonly C[]): C[] {
  return tutte.filter((c) => righe.some((r) => (r as Record<string, unknown>)[c] !== undefined));
}

/**
 * Scrive i fatti di un giro di un lettore su un apparato (spec §13.5.7): una transazione, INSERT … ON CONFLICT DO UPDATE,
 * niente DELETE del giro, e la potatura delle righe dell'apparato non viste da 90 giorni. `adesso` è l'ora del giro, una
 * per tutte le righe (così «ultimo giro» = `seen_at` più recente meno 5 minuti). null = schema assente: non si scrive.
 */
export function scriviFattiTopologia(deviceId: number, fonte: FonteFatti, fatti: FattiLettura, adesso: Date = new Date()):
  { porte: number; bridge: number; macs: number } | null {
  if (!schemaCaviPresente()) return null;
  const d = db();
  const ora = adesso.toISOString().slice(0, 19).replace("T", " ");
  const cp = colonneNote(fatti.porte, COLONNE_PORTA);
  const cb = colonneNote(fatti.bridge, COLONNE_BRIDGE);
  const insP = d.prepare(`INSERT INTO topology_port_facts (device_id, source, port_key, port_name, ${cp.map((c) => `${c}, `).join("")}first_seen, seen_at)
    VALUES (?, ?, ?, ?, ${cp.map(() => "?, ").join("")}?, ?)
    ON CONFLICT(device_id, source, port_key) DO UPDATE SET port_name = excluded.port_name, ${cp.map((c) => `${c} = excluded.${c}, `).join("")}seen_at = excluded.seen_at`);
  const insB = d.prepare(`INSERT INTO topology_bridge_facts (device_id, source, bridge_name, instance, ${cb.map((c) => `${c}, `).join("")}first_seen, seen_at)
    VALUES (?, ?, ?, ?, ${cb.map(() => "?, ").join("")}?, ?)
    ON CONFLICT(device_id, source, bridge_name, instance) DO UPDATE SET ${cb.map((c) => `${c} = excluded.${c}, `).join("")}seen_at = excluded.seen_at`);
  const insM = d.prepare(`INSERT INTO topology_device_macs (device_id, mac, source, port_key, seen_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(device_id, mac) DO UPDATE SET source = excluded.source, port_key = COALESCE(excluded.port_key, port_key), seen_at = excluded.seen_at`);
  const limite = `datetime(?, '-${FATTI_RETENTION_DAYS} days')`;
  const out = { porte: 0, bridge: 0, macs: 0 };
  d.transaction(() => {
    for (const p of fatti.porte) {
      const r = p as unknown as Record<string, unknown>;
      insP.run(deviceId, fonte, p.port_key, p.port_name, ...cp.map((c) => r[c] ?? null), ora, ora);
      out.porte++;
    }
    for (const b of fatti.bridge) {
      const r = b as unknown as Record<string, unknown>;
      insB.run(deviceId, fonte, b.bridge_name, b.instance, ...cb.map((c) => r[c] ?? null), ora, ora);
      out.bridge++;
    }
    const visti = new Set<string>();
    for (const m of fatti.macs) {
      const mac = normalizeMacForStorage(m.mac);
      if (!mac || visti.has(mac)) continue;
      visti.add(mac);
      insM.run(deviceId, mac, fonte, m.port_key, ora);
      out.macs++;
    }
    d.prepare(`DELETE FROM topology_port_facts WHERE device_id = ? AND seen_at < ${limite}`).run(deviceId, ora);
    d.prepare(`DELETE FROM topology_bridge_facts WHERE device_id = ? AND seen_at < ${limite}`).run(deviceId, ora);
    d.prepare(`DELETE FROM topology_device_macs WHERE device_id = ? AND seen_at < ${limite}`).run(deviceId, ora);
  })();
  return out;
}

/** Porta di uscita secondo il controller, per indice, e da dove la ricava (`uplink.port_idx`, `uplink_source`). */
export function setUplinkCavi(deviceId: number, porta: number | null, origine: string | null): boolean {
  if (!schemaCaviPresente()) return false;
  db().prepare("UPDATE network_devices SET uplink_local_port_idx = ?, uplink_source = ? WHERE id = ?").run(porta, origine, deviceId);
  return true;
}
```

  `normalizeMacForStorage` è già importato in `db-tenant.ts` (se no, da `@/lib/utils`).

- [ ] **Step 7: verde, e le prove di oggi dei vicini** —

```bash
for f in src/lib/__tests__/topology-cavi-migration.test.ts src/lib/__tests__/topology-cavi-scrittura.test.ts \
         src/lib/__tests__/neighbors-old-readers.test.ts src/lib/__tests__/neighbors-age.test.ts \
         src/lib/__tests__/topology-phase1-migration.test.ts src/lib/__tests__/topology-orientation-migration.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t1-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
npx tsc --noEmit > "$SCRATCH/t1-tsc.log" 2>&1; echo "tsc exit=$?"
```

Atteso: tutti `exit=0`.

- [ ] **Step 8: la misura sulla copia** — `scripts/misura-migrazione-cavi.ts`:

```ts
/**
 * misura-migrazione-cavi.ts — la migrazione di T2 su una COPIA del DB di un tenant (spec 2026-10-14 §13.11.3, «Misure
 * sulle copie», primo punto): copia della copia dentro --cartella, `integrity_check` prima, apertura col codice nuovo
 * (schema e migrazioni) misurata, `integrity_check` dopo, che cosa è stato aggiunto, seconda apertura che non aggiunge
 * niente. Stampa solo conteggi e nomi di colonne: niente dati del cliente. La copia della copia si toglie a fine giro.
 *
 * Uso:  npx tsx scripts/misura-migrazione-cavi.ts <copia.db> --cartella <scratchpad>
 *   Uscita: 0 fatto e integro; 1 integrità rovinata o seconda apertura che aggiunge; 2 non partito.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { controllaPercorsi } from "../src/lib/scanner/__tests__/support/percorsi-prova";

const copie: string[] = [];

async function main(): Promise<number> {
  const a = process.argv.slice(2);
  const i = a.indexOf("--cartella");
  const cartella = i >= 0 ? a[i + 1] : undefined;
  const liberi = a.filter((x, k) => !x.startsWith("--") && a[k - 1] !== "--cartella");
  if (!cartella || liberi.length !== 1) {
    process.stderr.write("Uso: npx tsx scripts/misura-migrazione-cavi.ts <copia.db> --cartella <scratchpad>\n");
    return 2;
  }
  const sorgente = path.resolve(liberi[0]);
  const tenant = path.basename(sorgente).replace(/\.db$/i, "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tenant)) { process.stderr.write("Nome del file non valido come codice tenant.\n"); return 2; }
  const lavoro = path.join(path.resolve(cartella), `misura-migrazione-cavi-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const dataDir = path.join(lavoro, "data");
  const hubDb = path.join(lavoro, "hub.db");
  copie.push(dataDir, hubDb, `${hubDb}-wal`, `${hubDb}-shm`);
  const errori = controllaPercorsi({ scratchpad: cartella, sorgente, dataDir, hubDb, repo: process.cwd() });
  if (errori.length > 0) { process.stderr.write(`Non parto:\n${errori.map((e) => `  - ${e}`).join("\n")}\n`); return 2; }
  const dest = path.join(dataDir, "tenants", `${tenant}.db`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sorgente, dest);
  const wal = `${sorgente}-wal`;
  if (fs.existsSync(wal) && fs.statSync(wal).size > 0) fs.copyFileSync(wal, `${dest}-wal`);
  process.env.DA_INVENT_DATA_DIR = dataDir;
  process.env.DA_IPAM_HUB_DB_PATH = hubDb;
  process.env.ENCRYPTION_KEY ||= crypto.randomBytes(16).toString("hex");
  const registro = path.join(lavoro, "misura.log");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) console[k] = (...p: unknown[]) => fs.appendFileSync(registro, `[${k}] ${p.map(String).join(" ")}\n`);

  const Database = (await import("better-sqlite3")).default;
  const integrita = (file: string): string[] => {
    const raw = new Database(file, { readonly: true });
    try {
      return (raw.prepare("PRAGMA integrity_check").all() as Array<{ integrity_check: string }>)
        .flatMap((r) => r.integrity_check.split("\n")).map((r) => r.trim()).filter((r) => r !== "" && r !== "*** in database main ***");
    } finally { raw.close(); }
  };
  const struttura = (file: string): string => {
    const raw = new Database(file, { readonly: true });
    try {
      const oggetti = raw.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
      const colonne = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>)
        .map((t) => [t.name, raw.prepare(`PRAGMA table_info(${t.name})`).all()]);
      return JSON.stringify({ oggetti, colonne });
    } finally { raw.close(); }
  };
  const integraPrima = integrita(dest);
  const strutturaPrima = struttura(dest);
  // Import dinamico voluto qui (come misura-cavi.ts): l'ambiente va impostato prima che db-tenant si carichi.
  const tenantDb = await import("../src/lib/db-tenant");
  const t0 = performance.now();
  tenantDb.getTenantDb(tenant);
  const durata = Math.round(performance.now() - t0);
  const schema = tenantDb.withTenant(tenant, () => tenantDb.schemaCaviPresente());
  tenantDb.closeTenantDb(tenant);
  const strutturaDopo = struttura(dest);
  const integraDopo = integrita(dest);
  tenantDb.getTenantDb(tenant);
  tenantDb.closeTenantDb(tenant);
  const secondaUguale = struttura(dest) === strutturaDopo;
  const aggiunto = (JSON.parse(strutturaDopo) as { oggetti: Array<{ name: string }> }).oggetti.map((o) => o.name)
    .filter((n) => !strutturaPrima.includes(`"name":"${n}"`));
  const ok = (r: string[]) => r.every((x) => x === "ok" || /^Page \d+: never used$/.test(x));
  const out = {
    tenant, durata_apertura_ms: durata, integrity_prima: integraPrima.join("; "), integrity_dopo: integraDopo.join("; "),
    schema_cavi_presente: schema, oggetti_aggiunti: aggiunto, seconda_apertura_uguale: secondaUguale,
    righe_migrazione: fs.existsSync(registro) ? fs.readFileSync(registro, "utf8").split("\n").filter((r) => r.includes("topologia cavi (T2)")).length : 0,
  };
  process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
  return ok(integraPrima) && ok(integraDopo) && secondaUguale && schema ? 0 : 1;
}

main()
  .catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); return 2; })
  .then((c) => { for (const p of copie) fs.rmSync(p, { recursive: true, force: true }); process.exit(c); });
```

  Prova a secco dello script su un DB vuoto generato (non serve un cliente): `npm run db:empty` crea il modello vuoto;
  `cp` in `$SCRATCH/copie-prova/PROVAVUOTO.db`, poi
  `npx tsx scripts/misura-migrazione-cavi.ts "$SCRATCH/copie-prova/PROVAVUOTO.db" --cartella "$SCRATCH" > "$SCRATCH/t1-misura.log" 2>&1; echo "exit=$?"`.
  Atteso `exit=0`, `schema_cavi_presente: true`, `seconda_apertura_uguale: true`, `righe_migrazione: 1`, e nella
  cartella di lavoro nessuna copia rimasta (`ls "$SCRATCH"/misura-migrazione-cavi-*/data` → assente).

- [ ] **Step 9: commit** — `git add src/lib/db-tenant-schema.ts src/lib/db-tenant.ts scripts/misura-migrazione-cavi.ts
  src/lib/__tests__/topology-cavi-migration.test.ts src/lib/__tests__/topology-cavi-scrittura.test.ts`, poi
  `git commit -m "feat(topologia): schema additivo e scrittori dei fatti delle letture in più (T2.1)"`.

---
### Task 2: interruttori, esito, cadenza, lucchetto e tempo massimo per comando (13.5.1, 13.5.6) — livello completo

Spec §13.5.1 («Un errore non ferma il giro», «Un errore si riconosce dal testo», «Una cadenza propria»), §13.5.6
(interruttori ed esito), prove I53 e «cadenza propria e lucchetto (due giri paralleli dello stesso apparato → una
lettura)» del 13.12.4. Il riconoscimento del testo d'errore di RouterOS sta nel Task 3 (`erroreRouterOs`).

**Files:**
- Create: `src/lib/topology/letture/interruttori.ts`, `src/lib/topology/letture/cadenza.ts`
- Modify: `src/lib/devices/ssh-transport.ts` (in fondo: `CODICE_TEMPO_SCADUTO`, `ComandoScaduto`, `execConTempo`)
- Test: `src/lib/topology/letture/__tests__/interruttori.test.ts`, `src/lib/topology/letture/__tests__/cadenza.test.ts`,
  `src/lib/devices/__tests__/ssh-tempo.test.ts`

**Interfaces:**
- Consumes: `getTenantSetting`, `setTenantSetting`, `runInTenantTransaction`, `getCurrentTenantCode`,
  `schemaCaviPresente`, `rileggiSchemaCavi`, `CampiViciniCavi` (Task 1); `codiceErrore` (`mikrotik-porte.ts`);
  `parseDbDate` (`@/lib/db-date`).
- Produces (`src/lib/topology/letture/interruttori.ts`): `LETTURE`, `type Lettura`, `eLettura(x: unknown): x is Lettura`,
  `chiaveLettura(l)`, `chiaveEsito(l)`, `interface StatoInterruttore { acceso: boolean; da: string | null; il: string | null }`,
  `interface EsitoApparato { il: string; comandi: number; riusciti: number; codice: string | null }`, `oraUtc(d: Date): string`,
  `leggiInterruttore(l)`, `letturaAccesa(l)`, `scriviInterruttore(l, acceso, da, adesso?)`, `leggiEsiti(l)`,
  `scriviEsito(l, deviceId, e)`, `senzaCampiCavi<T extends CampiViciniCavi>(n: T): T`,
  `LETTURE_DISPONIBILI: ReadonlySet<Lettura>` (oggi `mikrotik`, `controller`, `snmp`; il Task 7 aggiunge `host`).
- Produces (`src/lib/topology/letture/cadenza.ts`): `CADENZA_MS`, `interface Conteggio { comandi: number; riusciti: number; codice: string | null }`,
  `type MotivoSalto = "spenta" | "schema" | "cadenza" | "lucchetto"`, `type EsitoGiro<T>`,
  `conCadenza<T>(l: Lettura, deviceId: number, leggi: () => Promise<{ valore: T; conteggio: Conteggio }>, adesso?: () => Date): Promise<EsitoGiro<T>>`,
  `riassuntoLetture(esiti: ReadonlyArray<EsitoGiro<unknown>>): string | null`.
- Produces (`ssh-transport.ts`): `CODICE_TEMPO_SCADUTO = "TEMPO_SCADUTO"`, `class ComandoScaduto extends Error { readonly code }`,
  `execConTempo(conn: Pick<SshClient, "exec">, command: string, tempoMs: number): Promise<SshResult>`.

- [ ] **Step 1: le prove, viste fallire.**

`src/lib/devices/__tests__/ssh-tempo.test.ts`:

```ts
// I53 (spec §13.5.1): il tempo massimo di oggi vale solo per aprire la connessione (`readyTimeout`), e `sshExec` aspetta
// che il canale si chiuda: un `monitor` senza `once`, una domanda interattiva o un apparato bloccato fermavano il giro per
// sempre, e con lui gli apparati dopo (si leggono uno alla volta). `execConTempo` chiude il canale allo scadere e dà un
// errore col suo codice, che il resoconto nomina da solo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Client as SshClient } from "ssh2";
import { CODICE_TEMPO_SCADUTO, execConTempo } from "@/lib/devices/ssh-transport";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";

function flusso() {
  const s = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), chiuso: 0, close() { s.chiuso++; } });
  return s;
}
function connFinta(comportamento: (s: ReturnType<typeof flusso>) => void, errore?: Error) {
  const s = flusso();
  const conn = { exec(_cmd: string, cb: (err: Error | undefined, stream: unknown) => void) { setImmediate(() => { if (errore) cb(errore, undefined); else { cb(undefined, s); comportamento(s); } }); } };
  return { conn: conn as unknown as Pick<SshClient, "exec">, s };
}

test("un comando che non chiude il canale: errore TEMPO_SCADUTO allo scadere, e il canale si chiude", async () => {
  const { conn, s } = connFinta(() => { /* non risponde mai */ });
  const t0 = Date.now();
  await assert.rejects(execConTempo(conn, "/interface bridge monitor [find]", 40), (e: unknown) => codiceErrore(e) === CODICE_TEMPO_SCADUTO);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(s.chiuso, 1);
});

test("un comando che risponde: stdout, stderr e codice d'uscita, e il tempo non scade dopo", async () => {
  const { conn } = connFinta((s) => { s.emit("data", Buffer.from("riga\r\n")); s.stderr.emit("data", Buffer.from("")); s.emit("close", 0); });
  assert.deepEqual(await execConTempo(conn, "/interface bridge print terse", 1000), { stdout: "riga\r\n", stderr: "", code: 0 });
});

test("il canale rifiutato è un errore, non un'uscita vuota", async () => {
  const { conn } = connFinta(() => undefined, Object.assign(new Error("Channel open failure"), { code: "CHANNEL_OPEN_FAILURE" }));
  await assert.rejects(execConTempo(conn, "x", 1000), (e: unknown) => codiceErrore(e) === "CHANNEL_OPEN_FAILURE");
});
```

`src/lib/topology/letture/__tests__/interruttori.test.ts`:

```ts
// Spec §13.5.6: un interruttore per lettura e per cliente; chiave assente = SPENTO, e lo stesso un valore rovinato (freno
// a prova di guasto, D4). L'esito per apparato serve alla cadenza e alla pagina; uno rovinato vale «mai letto».
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { chiaveEsito, chiaveLettura, leggiEsiti, leggiInterruttore, letturaAccesa, scriviEsito, scriviInterruttore, senzaCampiCavi } from "@/lib/topology/letture/interruttori";

const T = "TESTLETTUREINT";
beforeEach(() => { getTenantDb(T).exec("DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%'"); });
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("chiave assente, valore rovinato o diverso da acceso:true → spento", () => {
  withTenant(T, () => {
    assert.equal(letturaAccesa("mikrotik"), false);
    for (const v of ["{", "true", '{"acceso":"si"}', '{"acceso":1}', "[]"]) {
      setTenantSetting(chiaveLettura("mikrotik"), v);
      assert.equal(letturaAccesa("mikrotik"), false, v);
    }
  });
});

test("accesa e spenta da un admin, con chi e quando (UTC)", () => {
  withTenant(T, () => {
    scriviInterruttore("snmp", true, "admin", new Date("2026-10-15T08:30:00Z"));
    assert.deepEqual(leggiInterruttore("snmp"), { acceso: true, da: "admin", il: "2026-10-15 08:30:00" });
    scriviInterruttore("snmp", false, "admin", new Date("2026-10-15T09:00:00Z"));
    assert.equal(letturaAccesa("snmp"), false);
    assert.equal(letturaAccesa("mikrotik"), false, "le altre restano spente");
  });
});

test("esiti per apparato: si uniscono; uno rovinato o con un id non numerico non c'è", () => {
  withTenant(T, () => {
    scriviEsito("mikrotik", 3, { il: "2026-10-15 08:00:00", comandi: 6, riusciti: 6, codice: null });
    scriviEsito("mikrotik", 4, { il: "2026-10-15 08:01:00", comandi: 6, riusciti: 4, codice: "TEMPO_SCADUTO" });
    assert.deepEqual(Object.keys(leggiEsiti("mikrotik")).sort(), ["3", "4"]);
    setTenantSetting(chiaveEsito("mikrotik"), '{"3":{"il":"x","comandi":"sei"},"abc":{"il":"2026-10-15 08:00:00","comandi":1,"riusciti":1,"codice":null}}');
    assert.deepEqual(leggiEsiti("mikrotik"), {});
    setTenantSetting(chiaveEsito("mikrotik"), "{tagliato");
    assert.deepEqual(leggiEsiti("mikrotik"), {});
    scriviEsito("mikrotik", 3, { il: "2026-10-15 09:00:00", comandi: 6, riusciti: 6, codice: null });
    assert.deepEqual(Object.keys(leggiEsiti("mikrotik")), ["3"], "si riscrive pulito");
  });
});

test("senzaCampiCavi toglie solo le colonne nuove dei vicini", () => {
  const n = { localPort: "ether2", remoteDevice: "SW", remotePort: "Port 3", protocol: "lldp", discoveredBy: "lldp", remoteCaps: "bridge", localPortIndex: 2, remotePortIndex: 3 };
  assert.deepEqual(senzaCampiCavi(n), { localPort: "ether2", remoteDevice: "SW", remotePort: "Port 3", protocol: "lldp" });
});
```

`src/lib/topology/letture/__tests__/cadenza.test.ts`:

```ts
// Spec §13.5.1, «Una cadenza propria»: le letture in più partono al più una volta l'ora per apparato, qualunque job chiami
// il giro (sulla rete B il router si legge ogni 15 minuti da sei scansioni veloci in parallelo, più volte nello stesso
// secondo); un lucchetto per apparato, nel processo, impedisce che due giri paralleli le ripetano.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { conCadenza, riassuntoLetture } from "@/lib/topology/letture/cadenza";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";

const T = "TESTLETTURECAD";
const ore = (h: number, m = 0) => () => new Date(Date.UTC(2026, 9, 15, h, m, 0));
beforeEach(() => {
  getTenantDb(T).exec("DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%'");
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const leggi = (conteggio = { comandi: 6, riusciti: 6, codice: null }) => async () => ({ valore: "fatto", conteggio });

test("spenta: non si legge niente", async () => {
  let chiamate = 0;
  const r = await withTenant(T, () => conCadenza("mikrotik", 1, async () => { chiamate++; return { valore: 1, conteggio: { comandi: 0, riusciti: 0, codice: null } }; }, ore(8)));
  assert.deepEqual(r, { stato: "saltato", motivo: "spenta" });
  assert.equal(chiamate, 0);
});

test("accesa: legge, scrive l'esito; dopo 30 minuti salta per la cadenza; dopo 61 rilegge", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("mikrotik", true, "admin");
    assert.equal((await conCadenza("mikrotik", 1, leggi(), ore(8))).stato, "letto");
    assert.deepEqual(leggiEsiti("mikrotik")["1"], { il: "2026-10-15 08:00:00", comandi: 6, riusciti: 6, codice: null });
    assert.deepEqual(await conCadenza("mikrotik", 1, leggi(), ore(8, 30)), { stato: "saltato", motivo: "cadenza" });
    assert.equal((await conCadenza("mikrotik", 2, leggi(), ore(8, 30))).stato, "letto", "la cadenza è per apparato");
    assert.equal((await conCadenza("mikrotik", 1, leggi(), ore(9, 1))).stato, "letto");
  });
});

test("due giri paralleli dello stesso apparato: una lettura sola", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("snmp", true, "admin");
    let libera: () => void = () => undefined;
    const attesa = new Promise<void>((r) => { libera = r; });
    let chiamate = 0;
    const lenta = async () => { chiamate++; await attesa; return { valore: 1, conteggio: { comandi: 9, riusciti: 9, codice: null } }; };
    const primo = conCadenza("snmp", 5, lenta, ore(10));
    const secondo = await conCadenza("snmp", 5, lenta, ore(10));
    assert.deepEqual(secondo, { stato: "saltato", motivo: "lucchetto" });
    libera();
    assert.equal((await primo).stato, "letto");
    assert.equal(chiamate, 1);
  });
});

test("un errore: esito col solo codice, e il lucchetto si libera", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("mikrotik", true, "admin");
    const r = await conCadenza("mikrotik", 7, async () => { throw Object.assign(new Error("connect ETIMEDOUT 192.0.2.1:22"), { code: "ETIMEDOUT" }); }, ore(11));
    assert.deepEqual(r, { stato: "errore", esito: { il: "2026-10-15 11:00:00", comandi: 0, riusciti: 0, codice: "ETIMEDOUT" } });
    assert.equal((await conCadenza("mikrotik", 7, leggi(), ore(12, 1))).stato, "letto");
  });
});

test("schema assente: non si legge, e il resoconto lo dice", async () => {
  await withTenant(T, async () => {
    scriviInterruttore("mikrotik", true, "admin");
    getTenantDb(T).exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps");
    rileggiSchemaCavi();
    const r = await conCadenza("mikrotik", 1, leggi(), ore(8));
    assert.deepEqual(r, { stato: "saltato", motivo: "schema" });
    assert.equal(riassuntoLetture([r]), "letture in più non disponibili: lo schema di questo cliente non è aggiornato");
    getTenantDb(T).exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
  });
});

test("il riassunto conta, nomina i codici e mai un indirizzo", () => {
  const s = riassuntoLetture([
    { stato: "letto", valore: 1, esito: { il: "x", comandi: 6, riusciti: 6, codice: null } },
    { stato: "letto", valore: 1, esito: { il: "x", comandi: 6, riusciti: 4, codice: "TEMPO_SCADUTO" } },
    { stato: "saltato", motivo: "cadenza" }, { stato: "saltato", motivo: "lucchetto" }, { stato: "saltato", motivo: "spenta" },
    { stato: "errore", esito: { il: "x", comandi: 0, riusciti: 0, codice: "ETIMEDOUT" } },
  ]);
  assert.equal(s, "letture in più: 2 lette (1 in parte), 2 saltate (cadenza 1, lucchetto 1), 1 non riuscita; codici: ETIMEDOUT, TEMPO_SCADUTO");
  assert.equal(riassuntoLetture([{ stato: "saltato", motivo: "spenta" }]), null, "tutto spento: niente da dire");
});
```

```bash
for f in src/lib/devices/__tests__/ssh-tempo.test.ts src/lib/topology/letture/__tests__/interruttori.test.ts src/lib/topology/letture/__tests__/cadenza.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t2-rosso-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
```

Atteso: tre `exit=1` (moduli o esportazioni mancanti).

- [ ] **Step 2: il tempo massimo** — in fondo a `src/lib/devices/ssh-transport.ts`:

```ts
/** Codice dell'errore di un comando che non ha risposto entro il suo tempo massimo (spec topologia §13.5.1, I53). */
export const CODICE_TEMPO_SCADUTO = "TEMPO_SCADUTO";

export class ComandoScaduto extends Error {
  readonly code = CODICE_TEMPO_SCADUTO;
  constructor(tempoMs: number) {
    super(`Il comando non ha risposto entro ${tempoMs} ms`);
    this.name = "ComandoScaduto";
  }
}

/**
 * Un `exec` su una connessione già aperta (`withSshClient`), con un tempo massimo: allo scadere chiude il canale e dà
 * `ComandoScaduto` (codice `TEMPO_SCADUTO`). Lo usano solo i comandi nuovi delle letture in più (spec §13.5.1): quelli di
 * oggi restano senza finché non si misura la durata vera dei loro giri. Il codice d'uscita torna com'è: su RouterOS un
 * comando sbagliato esce con 0 e scrive l'errore su stdout, e chi chiama lo riconosce dal testo.
 */
export function execConTempo(conn: Pick<SshClient, "exec">, command: string, tempoMs: number): Promise<SshResult> {
  return new Promise((resolve, reject) => {
    let finito = false;
    let canale: { close?: () => void } | null = null;
    const timer = setTimeout(() => {
      if (finito) return;
      finito = true;
      try { canale?.close?.(); } catch { /* il canale può essere già chiuso */ }
      reject(new ComandoScaduto(tempoMs));
    }, tempoMs);
    conn.exec(command, (err, stream) => {
      if (err) {
        if (finito) return;
        finito = true;
        clearTimeout(timer);
        reject(err);
        return;
      }
      canale = stream;
      let stdout = "";
      let stderr = "";
      stream.on("data", (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      stream.on("close", (code: number) => {
        if (finito) return;
        finito = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  });
}
```

- [ ] **Step 3: gli interruttori** — `src/lib/topology/letture/interruttori.ts`:

```ts
/**
 * Gli interruttori delle letture in più per la mappa (spec topologia §13.5.6), uno per lettura e per cliente, in
 * tenant_settings del DB del cliente. Chiave assente, valore rovinato o `acceso` diverso da `true` = SPENTO: un ambiente
 * che non dichiara niente non legge (D4). Accanto, l'esito di ogni lettura per apparato: serve alla cadenza propria
 * (cadenza.ts) e alla riga «ultima lettura ed esito» di «Dati della mappa». Ore in UTC, come nel DB.
 */
import { getTenantSetting, runInTenantTransaction, setTenantSetting, type CampiViciniCavi } from "@/lib/db-tenant";

export const LETTURE = ["mikrotik", "controller", "snmp", "host"] as const;
export type Lettura = (typeof LETTURE)[number];

/** Le letture che questa versione sa fare. `host` arriva col Task 7 del piano di T2, dopo l'uscita vera T2-b. */
export const LETTURE_DISPONIBILI: ReadonlySet<Lettura> = new Set<Lettura>(["mikrotik", "controller", "snmp"]);

export function eLettura(x: unknown): x is Lettura {
  return typeof x === "string" && (LETTURE as readonly string[]).includes(x);
}

export const chiaveLettura = (l: Lettura): string => `topologia.lettura.${l}`;
export const chiaveEsito = (l: Lettura): string => `topologia.lettura.${l}.esito`;

export interface StatoInterruttore { acceso: boolean; da: string | null; il: string | null }
export interface EsitoApparato { il: string; comandi: number; riusciti: number; codice: string | null }

/** L'ora come la scrive il DB: UTC, «AAAA-MM-GG HH:MM:SS». */
export function oraUtc(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

function leggiJson(chiave: string): unknown {
  let testo: string | null;
  try {
    testo = getTenantSetting(chiave);
  } catch {
    return null; // impostazione illeggibile: come assente, quindi spenta
  }
  if (testo === null) return null;
  try {
    return JSON.parse(testo) as unknown;
  } catch {
    return null;
  }
}

const oggetto = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

export function leggiInterruttore(l: Lettura): StatoInterruttore {
  const o = oggetto(leggiJson(chiaveLettura(l)));
  return { acceso: o?.acceso === true, da: typeof o?.da === "string" ? o.da : null, il: typeof o?.il === "string" ? o.il : null };
}

export function letturaAccesa(l: Lettura): boolean {
  return leggiInterruttore(l).acceso;
}

/** Accende o spegne (solo un admin, dalla rotta PUT). Spento si scrive comunque, con chi e quando: resta la storia. */
export function scriviInterruttore(l: Lettura, acceso: boolean, da: string, adesso: Date = new Date()): StatoInterruttore {
  const s: StatoInterruttore = { acceso, da, il: oraUtc(adesso) };
  setTenantSetting(chiaveLettura(l), JSON.stringify(s));
  return s;
}

function esitoValido(x: unknown): x is EsitoApparato {
  const o = oggetto(x);
  return !!o && typeof o.il === "string" && typeof o.comandi === "number" && typeof o.riusciti === "number"
    && (o.codice === null || typeof o.codice === "string");
}

export function leggiEsiti(l: Lettura): Record<string, EsitoApparato> {
  const o = oggetto(leggiJson(chiaveEsito(l)));
  if (!o) return {};
  const out: Record<string, EsitoApparato> = {};
  for (const [k, e] of Object.entries(o)) if (/^\d+$/.test(k) && esitoValido(e)) out[k] = e;
  return out;
}

/** Leggi, unisci e riscrivi in una transazione: due apparati dello stesso giro non si tolgono l'esito a vicenda. */
export function scriviEsito(l: Lettura, deviceId: number, e: EsitoApparato): void {
  runInTenantTransaction(() => {
    const tutti = leggiEsiti(l);
    tutti[String(deviceId)] = e;
    setTenantSetting(chiaveEsito(l), JSON.stringify(tutti));
  });
}

/** Con la lettura spenta le colonne nuove dei vicini non si scrivono (I33): chi chiama le toglie qui. */
export function senzaCampiCavi<T extends CampiViciniCavi>(n: T): T {
  const c = { ...n };
  delete c.discoveredBy;
  delete c.localPortIndex;
  delete c.remotePortIndex;
  delete c.remoteCaps;
  return c;
}
```

- [ ] **Step 4: la cadenza** — `src/lib/topology/letture/cadenza.ts`:

```ts
/**
 * La cadenza propria delle letture in più (spec topologia §13.5.1): al più una lettura ogni ora per apparato e per
 * lettura, qualunque job chiami il giro; un lucchetto per apparato nel processo; l'esito per apparato a fine lettura,
 * anche quando non riesce (col solo codice). Prima di tutto l'interruttore (spenta: niente) e lo schema (assente:
 * niente, e il resoconto lo dice, §13.5.7).
 */
import { parseDbDate } from "@/lib/db-date";
import { getCurrentTenantCode, schemaCaviPresente } from "@/lib/db-tenant";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import { leggiEsiti, letturaAccesa, oraUtc, scriviEsito, type EsitoApparato, type Lettura } from "./interruttori";

export const CADENZA_MS = 60 * 60_000;

export interface Conteggio { comandi: number; riusciti: number; codice: string | null }
export type MotivoSalto = "spenta" | "schema" | "cadenza" | "lucchetto";
export type EsitoGiro<T> =
  | { stato: "letto"; valore: T; esito: EsitoApparato }
  | { stato: "errore"; esito: EsitoApparato }
  | { stato: "saltato"; motivo: MotivoSalto };

const occupati = new Set<string>();

export async function conCadenza<T>(l: Lettura, deviceId: number, leggi: () => Promise<{ valore: T; conteggio: Conteggio }>,
  adesso: () => Date = () => new Date()): Promise<EsitoGiro<T>> {
  if (!letturaAccesa(l)) return { stato: "saltato", motivo: "spenta" };
  if (!schemaCaviPresente()) return { stato: "saltato", motivo: "schema" };
  const prima = leggiEsiti(l)[String(deviceId)];
  const t = prima ? parseDbDate(prima.il).getTime() : Number.NaN;
  if (Number.isFinite(t) && adesso().getTime() - t < CADENZA_MS) return { stato: "saltato", motivo: "cadenza" };
  // Fino a qui niente `await`: il controllo e la presa del lucchetto non si possono intrecciare con un altro giro.
  const chiave = `${getCurrentTenantCode() ?? ""}|${l}|${deviceId}`;
  if (occupati.has(chiave)) return { stato: "saltato", motivo: "lucchetto" };
  occupati.add(chiave);
  try {
    const r = await leggi();
    const esito: EsitoApparato = { il: oraUtc(adesso()), ...r.conteggio };
    scriviEsito(l, deviceId, esito);
    return { stato: "letto", valore: r.valore, esito };
  } catch (err) {
    const esito: EsitoApparato = { il: oraUtc(adesso()), comandi: 0, riusciti: 0, codice: codiceErrore(err) };
    try {
      scriviEsito(l, deviceId, esito);
    } catch {
      // l'esito non si scrive: al prossimo giro la lettura si riprova
    }
    return { stato: "errore", esito };
  } finally {
    occupati.delete(chiave);
  }
}

/** Una riga per il resoconto del job: numeri e codici, mai nomi, MAC o IP. null = niente da dire (tutto spento). */
export function riassuntoLetture(esiti: ReadonlyArray<EsitoGiro<unknown>>): string | null {
  if (esiti.some((e) => e.stato === "saltato" && e.motivo === "schema")) {
    return "letture in più non disponibili: lo schema di questo cliente non è aggiornato";
  }
  const lette = esiti.filter((e): e is Extract<EsitoGiro<unknown>, { stato: "letto" }> => e.stato === "letto");
  const inParte = lette.filter((e) => e.esito.riusciti < e.esito.comandi).length;
  const cadenza = esiti.filter((e) => e.stato === "saltato" && e.motivo === "cadenza").length;
  const lucchetto = esiti.filter((e) => e.stato === "saltato" && e.motivo === "lucchetto").length;
  const errori = esiti.filter((e): e is Extract<EsitoGiro<unknown>, { stato: "errore" }> => e.stato === "errore");
  if (lette.length + cadenza + lucchetto + errori.length === 0) return null;
  const codici = [...new Set([...errori, ...lette].map((e) => e.esito.codice).filter((c): c is string => c !== null))].sort();
  const parti = [`${lette.length} lette${inParte > 0 ? ` (${inParte} in parte)` : ""}`];
  if (cadenza + lucchetto > 0) parti.push(`${cadenza + lucchetto} saltate (cadenza ${cadenza}, lucchetto ${lucchetto})`);
  if (errori.length > 0) parti.push(`${errori.length} non riuscit${errori.length === 1 ? "a" : "e"}`);
  return `letture in più: ${parti.join(", ")}${codici.length > 0 ? `; codici: ${codici.join(", ")}` : ""}`;
}
```

- [ ] **Step 5: verde** — le tre prove dello Step 1, atteso `exit=0` per tutte; `npx tsc --noEmit`, `exit=0`.

- [ ] **Step 6: commit** — `git add src/lib/devices/ssh-transport.ts src/lib/topology/letture/ src/lib/devices/__tests__/ssh-tempo.test.ts`,
  `git commit -m "feat(topologia): interruttori, esito, cadenza e tempo massimo delle letture in più (T2)"`.

---

### Task 3: i lettori MikroTik sulle forme vere (T2.2, parte pura)

Spec §13.5.2 (tabella MK1-MK8, «Le forme vere», note «Le tabelle di `monitor`» e «Dove gira» per `stp-ssh.ts`), prove
di T2 del 13.12.4 («le tabelle di `monitor` lette per colonne, con una porta inattiva dalle celle vuote e
`active-ports` su più righe, il bridge-id nelle due forme, un errore riconosciuto dal testo con `ssh` uscito con 0,
`bpdu_rx`, MK7 vuoto senza MSTP»). MK7 con MSTP si scrive nel Task 3b, sull'uscita vera T2-a.

**Files:**
- Create: `src/lib/devices/mikrotik-stp.ts`
- Create: fixture in `src/lib/devices/__tests__/fixtures/` (sotto, **righe chiuse da `\r\n`**): `mikrotik-mk2-testa.txt`,
  `mikrotik-mk3-testa.txt`, `mikrotik-mk4-testa.txt`, `mikrotik-mk5-testa.txt`, `mikrotik-mk6-testa.txt`,
  `mikrotik-mk8a-testa.txt`, `mikrotik-mk8b-testa.txt`, `mikrotik-mk3-frontiera.txt`, `mikrotik-mk4-frontiera.txt`,
  `mikrotik-mk5-frontiera.txt`, `mikrotik-mk6-frontiera.txt`, `mikrotik-mk8a-frontiera.txt`,
  `mikrotik-mk8b-frontiera.txt`, `mikrotik-vuoto.txt`, `mikrotik-errore.txt`
- Create: `src/lib/devices/__tests__/mikrotik-stp.test.ts`
- Modify: `src/lib/devices/mikrotik-vicini.ts` (`parseMikrotikNeighbors`: `discoveredBy`, `remoteCaps`) e la sua prova
- Modify: `src/lib/devices/router-client.ts:49-57` (`NeighborEntry`: due campi facoltativi)
- Modify: `src/lib/devices/stp-ssh.ts` (`getMikrotikStpInfo` su MK3 e MK5; via `parseMikrotikBridgePrint`, `parseMikrotikBridgeMonitor`, `mikrotikBridgeIdToPriorityMac`)
- Modify: `src/lib/devices/snmp-stp-info.ts:18` (`protocol: "stp" | "rstp" | "mstp" | null`)
- Test: `src/lib/devices/__tests__/stp-ssh.test.ts` (nuovo o esteso)

**Interfaces:**
- Consumes: `campiTerse`, `righeDiUscita` (`mikrotik-vicini.ts`); `normale` (`@/lib/topology/cavi/porte`); i tipi
  `FattoPortaIn`, `FattoBridgeIn`, `MacApparatoIn`, `FattiLettura` (Task 1, solo `import type`).
- Produces (`src/lib/devices/mikrotik-stp.ts`): `segni(riga)`, `parseInterfacce(out): InterfacciaMk[]`,
  `tipoNeutro(tipo: string | null): string | null`, `parseBridge(out): BridgeMk[]`, `parsePorteBridge(out): PortaBridgeMk[]`,
  `tabellaMonitor(out): TabellaMonitor`, `cella(t, etichetta, i): string | null`, `bridgeIdNormale(s): string | null`,
  `parseMonitorBridge(out): MonitorBridgeMk[]`, `parseMonitorPorte(out): MonitorPortaMk[]`, `parseFasci(out): FascioMk[]`,
  `parseMonitorFasci(out): MonitorFascioMk[]`, `erroreRouterOs(testo): string | null`,
  `fattiMikrotik(l: LetturaMk): FattiLettura`, e i tipi `InterfacciaMk`, `BridgeMk`, `PortaBridgeMk`, `TabellaMonitor`,
  `MonitorBridgeMk`, `MonitorPortaMk`, `FascioMk`, `MonitorFascioMk`, `LetturaMk`.
- Produces (`NeighborEntry`): `discoveredBy?: string; remoteCaps?: string`.

- [ ] **Step 1: le fixture con la forma vera.**

Le fixture sono le uscite vere della rete B (P2), rese anonime **con la stessa forma**: stesse colonne e stesse
lunghezze (le tabelle di `monitor` si leggono per posizione), MAC `02:00:A0:…` coerenti fra i file (il bridge del router
di testa è la radice che il router di frontiera vede; il partner LACP del primo fascio è il bridge designato sulla porta
radice del router di frontiera), nomi scelti dal cliente inventati col loro disegno (`BR_RP`, `BR_ZQ_77K`,
`VL_3_QWRTY`, `vrf-zq01`, `tunnel-qa`, commenti `cavo-a/b/c`), PVID e date inventati. Gli spazi in fondo alle righe
delle tabelle ci sono anche nell'uscita vera: **non si tolgono** (un editor che li toglie rompe le posizioni; la prova lo
controlla). Scritti i file, le righe si chiudono con `\r\n`, come le scrive RouterOS via `ssh`:

```bash
cd src/lib/devices/__tests__/fixtures
perl -pi -e 's/\r?\n/\r\n/' mikrotik-mk*.txt mikrotik-vuoto.txt mikrotik-errore.txt
for f in mikrotik-mk*.txt mikrotik-vuoto.txt mikrotik-errore.txt; do printf '%s %s\n' "$f" "$(grep -c $'\r$' "$f")"; done
```

Atteso (righe con `\r`):
`mikrotik-mk2-testa.txt 24`, `mikrotik-mk3-testa.txt 1`, `mikrotik-mk4-testa.txt 10`, `mikrotik-mk5-testa.txt 10`, `mikrotik-mk6-testa.txt 23`, `mikrotik-mk8a-testa.txt 3`, `mikrotik-mk8b-testa.txt 7`, `mikrotik-mk3-frontiera.txt 2`, `mikrotik-mk4-frontiera.txt 3`, `mikrotik-mk5-frontiera.txt 10`, `mikrotik-mk6-frontiera.txt 24`, `mikrotik-mk8a-frontiera.txt 1`, `mikrotik-mk8b-frontiera.txt 6`, `mikrotik-vuoto.txt 1`, `mikrotik-errore.txt 1`.

`src/lib/devices/__tests__/fixtures/mikrotik-mk2-testa.txt` — MK2 del router di testa (`/interface print terse`, 24 interfacce: porte fisiche accese, spente e in un fascio, il bridge col nome scelto, due VLAN, tre fasci, loopback, un tunnel, una VRF):

```text
 0    name=ether1 default-name=ether1 type=ether mtu=1500 actual-mtu=1500 l2mtu=1600 max-l2mtu=9586 vrf=vrf-zq01 mac-address=02:00:A0:10:07:01 link-downs=0
 1 RS name=sfp-sfpplus1 default-name=sfp-sfpplus1 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:0E:02 last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
 2 RS name=sfp-sfpplus2 default-name=sfp-sfpplus2 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:15:03 last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
 3 RS name=sfp-sfpplus3 default-name=sfp-sfpplus3 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:1C:04 last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
 4 RS name=sfp-sfpplus4 default-name=sfp-sfpplus4 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:23:05 last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
 5  S name=sfp-sfpplus5 default-name=sfp-sfpplus5 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:2A:06 last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
 6 RS name=sfp-sfpplus6 default-name=sfp-sfpplus6 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:31:07 last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
 7 RS name=sfp-sfpplus7 default-name=sfp-sfpplus7 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:38:08 last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
 8    name=sfp-sfpplus8 default-name=sfp-sfpplus8 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:3F:09 last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
 9 RS comment=cavo-c name=sfp-sfpplus9 default-name=sfp-sfpplus9 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:46:0A last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
10 RS comment=cavo-c name=sfp-sfpplus10 default-name=sfp-sfpplus10 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:4D:0B last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
11 RS comment=cavo-b name=sfp-sfpplus11 default-name=sfp-sfpplus11 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:54:0C last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
12 RS comment=cavo-b name=sfp-sfpplus12 default-name=sfp-sfpplus12 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:5B:0D last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
13 RS name=sfp28-1 default-name=sfp28-1 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:62:0E last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
14 RS name=sfp28-2 default-name=sfp28-2 type=ether mtu=1500 actual-mtu=1500 l2mtu=1592 max-l2mtu=9578 vrf=main mac-address=02:00:A0:10:69:0F last-link-down-time=2026-09-02 11:20:05 last-link-up-time=2026-09-02 11:20:05 link-downs=1
15 R  name=BR_RP type=bridge mtu=auto actual-mtu=1500 l2mtu=1592 vrf=main mac-address=02:00:A0:10:0E:02 last-link-up-time=2026-09-02 11:20:05 link-downs=0
16 R  name=VL_3_QWRTY type=vlan mtu=1500 actual-mtu=1500 l2mtu=1588 vrf=main mac-address=02:00:A0:10:0E:02 last-link-up-time=2026-09-02 11:20:05 link-downs=0
17 R  name=VL_44_EDCR type=vlan mtu=1500 actual-mtu=1500 l2mtu=1588 vrf=main mac-address=02:00:A0:10:0E:02 last-link-up-time=2026-09-02 11:20:05 link-downs=0
18 RS comment=cavo-a name=bond1 type=bond mtu=1500 actual-mtu=1500 l2mtu=1592 vrf=main mac-address=02:00:A0:10:62:0E last-link-up-time=2026-09-02 11:20:05 link-downs=0
19 RS comment=cavo-b name=bond2 type=bond mtu=1500 actual-mtu=1500 l2mtu=1592 vrf=main mac-address=02:00:A0:10:54:0C last-link-up-time=2026-09-02 11:20:05 link-downs=0
20 RS name=bond3 type=bond mtu=1500 actual-mtu=1500 l2mtu=1592 vrf=main mac-address=02:00:A0:10:46:0A last-link-up-time=2026-09-02 11:20:05 link-downs=0
21 R  name=lo type=loopback mtu=65536 actual-mtu=65536 vrf=main mac-address=00:00:00:00:00:00 last-link-up-time=2026-09-02 11:20:05 link-downs=0
22 R  name=tunnel-qa type=ovpn-out mtu=1500 actual-mtu=1500 vrf=main mac-address=02:00:A0:10:70:10 last-link-up-time=2026-09-02 11:20:05 link-downs=0
23 R  name=vrf-zq01 type=vrf mtu=65536 actual-mtu=65536 vrf=main mac-address=02:00:A0:10:77:11 last-link-up-time=2026-09-02 11:20:05 link-downs=0
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk3-testa.txt` — MK3 del router di testa (radice dell'albero comune, priorità `0x0000`):

```text
0 R name=BR_RP mtu=auto actual-mtu=1500 l2mtu=1592 arp=enabled arp-timeout=auto mac-address=02:00:A0:10:0E:02 protocol-mode=rstp fast-forward=yes igmp-snooping=no auto-mac=yes ageing-time=5m priority=0x0000 max-message-age=20s forward-delay=15s transmit-hold-count=6 vlan-filtering=yes ether-type=0x8100 pvid=1 frame-types=admit-all ingress-filtering=yes dhcp-snooping=no dhcpv6-snooping=no ra-guard=no port-cost-mode=long mvrp=no max-learned-entries=auto mlag-peer-port=none mlag-priority=128 mlag-heartbeat=5s
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk4-testa.txt` — MK4 del router di testa (una porta inattiva, segno `I`; i fasci come porte, i membri no):

```text
0   interface=sfp-sfpplus1 bridge=BR_RP priority=0x80 path-cost=10 internal-path-cost=10 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=214 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
1   interface=sfp-sfpplus2 bridge=BR_RP priority=0x80 path-cost=10 internal-path-cost=10 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=214 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
2   interface=sfp-sfpplus3 bridge=BR_RP priority=0x80 path-cost=10 internal-path-cost=10 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=214 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
3   interface=sfp-sfpplus4 bridge=BR_RP priority=0x80 path-cost=10 internal-path-cost=10 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=214 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
4 I interface=sfp-sfpplus5 bridge=BR_RP priority=0x80 path-cost=10 internal-path-cost=10 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=214 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
5   interface=sfp-sfpplus6 bridge=BR_RP priority=0x80 path-cost=10 internal-path-cost=10 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=214 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
6   interface=bond1 bridge=BR_RP priority=0x80 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=1 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
7   interface=bond2 bridge=BR_RP priority=0x80 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=22 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
8   interface=bond3 bridge=BR_RP priority=0x80 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=1 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
9   interface=sfp-sfpplus7 bridge=BR_RP priority=0x80 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=214 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk5-testa.txt` — MK5 del router di testa (una colonna; bridge-id nella forma `0.MAC`):

```text
                  state: enabled            
    current-mac-address: 02:00:A0:10:0E:02  
              bridge-id: 0.02:00:A0:10:0E:02
            root-bridge: yes                
         root-bridge-id: 0.02:00:A0:10:0E:02
         root-path-cost: 0                  
              root-port: none               
             port-count: 10                 
  designated-port-count: 9                  
           fast-forward: no                 
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk6-testa.txt` — MK6 del router di testa (dieci colonne; la quinta, inattiva, è stretta e ha le celle vuote):

```text
               interface: sfp-sfpplus1        sfp-sfpplus2        sfp-sfpplus3        sfp-sfpplus4        sfp-sfpplus5 sfp-sfpplus6        bond1               bond2               bond3               sfp-sfpplus7
                  status: in-bridge           in-bridge           in-bridge           in-bridge           inactive     in-bridge           in-bridge           in-bridge           in-bridge           in-bridge
                 port-id: 0x80.1              0x80.2              0x80.3              0x80.4                           0x80.6              0x80.8              0x80.9              0x80.10             0x80.7
                    role: designated-port     designated-port     designated-port     designated-port                  designated-port     designated-port     designated-port     designated-port     designated-port
               edge-port: yes                 yes                 yes                 yes                              yes                 no                  no                  yes                 yes
     edge-port-discovery: yes                 yes                 yes                 yes                              yes                 yes                 yes                 yes                 yes
     point-to-point-port: yes                 yes                 yes                 yes                              yes                 yes                 yes                 yes                 yes
            external-fdb: no                  no                  no                  no                               no                  no                  no                  no                  no
            sending-rstp: yes                 yes                 yes                 yes                              yes                 yes                 yes                 yes                 yes
                learning: yes                 yes                 yes                 yes                              yes                 yes                 yes                 yes                 yes
              forwarding: yes                 yes                 yes                 yes                              yes                 yes                 yes                 yes                 yes
        actual-path-cost: 10                  10                  10                  10                               10                  800                 2000                4000                2000
    designated-bridge-id: 0.02:00:A0:10:0E:02 0.02:00:A0:10:0E:02 0.02:00:A0:10:0E:02 0.02:00:A0:10:0E:02              0.02:00:A0:10:0E:02 0.02:00:A0:10:0E:02 0.02:00:A0:10:0E:02 0.02:00:A0:10:0E:02 0.02:00:A0:10:0E:02
         designated-cost: 0                   0                   0                   0                                0                   0                   0                   0                   0
      designated-port-id: 0x80.1              0x80.2              0x80.3              0x80.4                           0x80.6              0x80.8              0x80.9              0x80.10             0x80.7
  designated-message-age: 0s                  0s                  0s                  0s                               0s                  0s                  0s                  0s                  0s
      designated-max-age: 20s                 20s                 20s                 20s                              20s                 20s                 20s                 20s                 20s
              tx-rx-bpdu: 301466/0            301466/0            301466/0            301466/0                         301464/0            301466/237          301584/4            301463/0            301464/0
     discard-transitions: 0                   0                   0                   0                                0                   0                   1                   0                   0
     forward-transitions: 1                   1                   1                   1                                1                   1                   2                   1                   1
                tx-rx-tc: 0/0                 0/0                 0/0                 0/0                              0/0                 2/237               236/3               0/0                 0/0
        topology-changes: 0                   0                   0                   0                                0                   1                   118                 0                   0
    last-topology-change:                                                                                                                  6d23h41m30s         2h9m25s
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk8a-testa.txt` — MK8, `print`, del router di testa (tre fasci LACP):

```text
0 R comment=cavo-a name=bond1 mtu=1500 mac-address=02:00:A0:10:62:0E arp=enabled arp-timeout=auto slaves=sfp28-2,sfp28-1 mode=802.3ad primary=none link-monitoring=mii arp-interval=100ms arp-ip-targets= mii-interval=100ms down-delay=0ms up-delay=0ms lacp-rate=30secs transmit-hash-policy=layer-3-and-4 min-links=0 lacp-mode=active lacp-system-priority=65535
1 R comment=cavo-b name=bond2 mtu=1500 mac-address=02:00:A0:10:54:0C arp=enabled arp-timeout=auto slaves=sfp-sfpplus11,sfp-sfpplus12 mode=802.3ad primary=none link-monitoring=mii arp-interval=100ms arp-ip-targets= mii-interval=100ms down-delay=0ms up-delay=0ms lacp-rate=30secs transmit-hash-policy=layer-3-and-4 min-links=0 lacp-mode=active lacp-system-priority=65535
2 R name=bond3 mtu=1500 mac-address=02:00:A0:10:46:0A arp=enabled arp-timeout=auto slaves=sfp-sfpplus9,sfp-sfpplus10 mode=802.3ad primary=none link-monitoring=mii arp-interval=100ms arp-ip-targets= mii-interval=100ms down-delay=0ms up-delay=0ms lacp-rate=30secs transmit-hash-policy=layer-2 min-links=0 lacp-mode=active lacp-system-priority=65535
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk8b-testa.txt` — MK8, `monitor`, del router di testa (`active-ports` su due righe, il partner LACP):

```text
                    mode: 802.3ad           802.3ad           802.3ad          
            active-ports: sfp28-1           sfp-sfpplus11     sfp-sfpplus9     
                          sfp28-2           sfp-sfpplus12     sfp-sfpplus10    
          inactive-ports:                                                      
          lacp-system-id: 02:00:A0:10:62:0E 02:00:A0:10:54:0C 02:00:A0:10:46:0A
    lacp-system-priority: 65535             65535             65535            
  lacp-partner-system-id: 02:00:A0:10:7E:12 02:00:A0:10:85:13 02:00:A0:10:8C:14
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk3-frontiera.txt` — MK3 del router di frontiera (due bridge):

```text
0 R name=BR_RP mtu=auto actual-mtu=1500 l2mtu=1592 arp=enabled arp-timeout=auto mac-address=02:00:A0:10:93:15 protocol-mode=rstp fast-forward=yes igmp-snooping=no auto-mac=yes ageing-time=5m priority=0x8000 max-message-age=20s forward-delay=15s transmit-hold-count=6 vlan-filtering=yes ether-type=0x8100 pvid=1 frame-types=admit-all ingress-filtering=yes dhcp-snooping=no dhcpv6-snooping=no ra-guard=no port-cost-mode=long mvrp=no max-learned-entries=auto mlag-peer-port=none mlag-priority=128 mlag-heartbeat=5s
1 R name=BR_ZQ_77K mtu=auto actual-mtu=1500 l2mtu=1592 arp=enabled arp-timeout=auto mac-address=02:00:A0:10:9A:16 protocol-mode=rstp fast-forward=yes igmp-snooping=no auto-mac=yes ageing-time=5m priority=0x8000 max-message-age=20s forward-delay=15s transmit-hold-count=6 vlan-filtering=no dhcp-snooping=no dhcpv6-snooping=no ra-guard=no port-cost-mode=long max-learned-entries=auto mlag-peer-port=none mlag-priority=128 mlag-heartbeat=5s
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk4-frontiera.txt` — MK4 del router di frontiera (due porte inattive, una in un fascio dal nome scelto):

```text
0   interface=sfp-sfpplus12 bridge=BR_RP priority=0x80 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=1 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
1 I interface=bonding1 bridge=BR_RP priority=0x80 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=1 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
2 I interface=sfp-sfpplus8 bridge=BR_ZQ_77K priority=0x80 edge=auto point-to-point=auto learn=auto horizon=none hw=yes auto-isolate=no restricted-role=no restricted-tcn=no pvid=1 frame-types=admit-all ingress-filtering=yes unknown-unicast-flood=yes unknown-multicast-flood=yes broadcast-flood=yes tag-stacking=no bpdu-guard=no trusted=no trusted-ra=no trusted-dhcpv6=no mvrp-registrar-state=normal mvrp-applicant-state=normal-participant multicast-router=temporary-query fast-leave=no
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk5-frontiera.txt` — MK5 del router di frontiera (due colonne, nessuna riga coi nomi; bridge-id nelle due forme; porta radice):

```text
                  state: enabled                  enabled                 
    current-mac-address: 02:00:A0:10:93:15        02:00:A0:10:9A:16       
              bridge-id: 0x8000.02:00:A0:10:93:15 0x8000.02:00:A0:10:9A:16
            root-bridge: no                       yes                     
         root-bridge-id: 0.02:00:A0:10:0E:02      0x8000.02:00:A0:10:9A:16
         root-path-cost: 2400                     0                       
              root-port: sfp-sfpplus12            none                    
             port-count: 2                        1                       
  designated-port-count: 0                        0                       
           fast-forward: no                       no                      
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk6-frontiera.txt` — MK6 del router di frontiera (la porta radice, e due colonne inattive strette):

```text
               interface: sfp-sfpplus12            bonding1 sfp-sfpplus8
                  status: in-bridge                inactive inactive    
                 port-id: 0x80.1                                        
                    role: root-port                                     
               edge-port: no                                            
     edge-port-discovery: yes                                           
     point-to-point-port: yes                                           
            external-fdb: no                                            
            sending-rstp: yes                                           
                learning: yes                                           
              forwarding: yes                                           
        actual-path-cost: 2000                                          
          root-path-cost: 2400                                          
    designated-bridge-id: 0x8000.02:00:A0:10:7E:12                      
         designated-cost: 400                                           
      designated-port-id: 0x80.10                                       
  designated-message-age: 1s                                            
      designated-max-age: 20s                                           
              tx-rx-bpdu: 10/302210                                     
     discard-transitions: 0                                             
     forward-transitions: 1                                             
                tx-rx-tc: 3/241                                         
        topology-changes: 1                                             
    last-topology-change: 6d23h50m51s                                   
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk8a-frontiera.txt` — MK8, `print`, del router di frontiera (un fascio spento):

```text
0 name=bonding1 mtu=1500 mac-address=02:00:A0:10:A1:17 arp=enabled arp-timeout=auto slaves=sfp28-1,sfp28-2 mode=802.3ad primary=none link-monitoring=mii arp-interval=100ms arp-ip-targets= mii-interval=100ms down-delay=0ms up-delay=0ms lacp-rate=30secs transmit-hash-policy=layer-2 min-links=0 lacp-mode=active lacp-system-priority=65535
```

`src/lib/devices/__tests__/fixtures/mikrotik-mk8b-frontiera.txt` — MK8, `monitor`, del router di frontiera (nessun membro attivo, nessuna riga del partner):

```text
                  mode: 802.3ad          
          active-ports:                  
        inactive-ports: sfp28-1          
                        sfp28-2          
        lacp-system-id: 02:00:A0:10:A1:17
  lacp-system-priority: 65535            
```

`src/lib/devices/__tests__/fixtures/mikrotik-vuoto.txt` — un comando su un router senza bridge (il router virtuale) o un `[find]` vuoto: una riga vuota, nessun errore:

```text

```

`src/lib/devices/__tests__/fixtures/mikrotik-errore.txt` — un errore non catturato: su stdout, con `ssh` uscito con 0:

```text
no such item (/interface/bridge/monitor; line 1)
```

- [ ] **Step 2: le prove dei lettori, viste fallire** — `src/lib/devices/__tests__/mikrotik-stp.test.ts`:

```ts
// Lettori di MK2-MK8 (spec topologia §13.5.2) sulle forme vere della rete B (14/10 sera, RouterOS 7.24), rese anonime.
// Le tabelle di `monitor` si leggono per colonne dalle posizioni della prima riga: divise sugli spazi si spostano appena
// una cella è vuota, come per una porta inattiva. Il bridge-id ha due forme. Un errore va su stdout con ssh uscito con 0:
// si riconosce dal testo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  bridgeIdNormale, cella, erroreRouterOs, fattiMikrotik, parseBridge, parseFasci, parseInterfacce, parseMonitorBridge,
  parseMonitorFasci, parseMonitorPorte, parsePorteBridge, tabellaMonitor, tipoNeutro,
} from "@/lib/devices/mikrotik-stp";

const F = (n: string): string => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

test("le fixture hanno la forma vera: righe chiuse da \\r\\n, spazi in coda conservati", () => {
  assert.equal(F("mikrotik-mk6-testa.txt").split("\r\n").length - 1, 23);
  assert.ok(F("mikrotik-mk5-testa.txt").includes("enabled            \r\n"), "gli spazi in coda della colonna ci sono");
});

test("MK2: nome, tipo, MAC; acceso dal segno R", () => {
  const i = parseInterfacce(F("mikrotik-mk2-testa.txt"));
  assert.equal(i.length, 24);
  assert.deepEqual(i[0], { nome: "ether1", tipo: "ether", mac: "02:00:A0:10:07:01", accesa: false, spenta: false });
  assert.deepEqual(i[1], { nome: "sfp-sfpplus1", tipo: "ether", mac: "02:00:A0:10:0E:02", accesa: true, spenta: false });
  assert.equal(i[5].accesa, false, "« S» senza R: la porta è giù");
  assert.deepEqual(i.filter((x) => x.mac === null).map((x) => x.nome), ["lo"], "un MAC tutto zeri non è un MAC");
  assert.deepEqual([...new Set(i.map((x) => tipoNeutro(x.tipo)))].sort(), ["bridge", "lag", "other", "physical", "tunnel", "vlan"]);
});

test("MK3: priorità esadecimale, modo, regione assente senza MSTP; un router senza bridge non ha righe", () => {
  assert.deepEqual(parseBridge(F("mikrotik-mk3-testa.txt")), [
    { nome: "BR_RP", modo: "rstp", priorita: 0, regione: null, revisione: null, mac: "02:00:A0:10:0E:02", vlanFiltering: true, maxAge: "20s", forwardDelay: "15s" },
  ]);
  assert.deepEqual(parseBridge(F("mikrotik-mk3-frontiera.txt")).map((b) => [b.nome, b.priorita, b.vlanFiltering]),
    [["BR_RP", 32768, true], ["BR_ZQ_77K", 32768, false]]);
  assert.deepEqual(parseBridge(F("mikrotik-vuoto.txt")), []);
});

test("MK4: porta del bridge, PVID, segno I; i fasci come porte", () => {
  const p = parsePorteBridge(F("mikrotik-mk4-testa.txt"));
  assert.equal(p.length, 10);
  assert.deepEqual(p[4], { porta: "sfp-sfpplus5", bridge: "BR_RP", pvid: 214, inattiva: true });
  assert.deepEqual(p.filter((x) => x.porta.startsWith("bond")).map((x) => x.porta), ["bond1", "bond2", "bond3"]);
  assert.deepEqual(parsePorteBridge(F("mikrotik-mk4-frontiera.txt")).map((x) => [x.porta, x.bridge, x.inattiva]),
    [["sfp-sfpplus12", "BR_RP", false], ["bonding1", "BR_RP", true], ["sfp-sfpplus8", "BR_ZQ_77K", true]]);
});

test("tabelle di monitor per colonne: una colonna stretta e le celle vuote non spostano le altre", () => {
  const t = tabellaMonitor(F("mikrotik-mk6-testa.txt"));
  assert.equal(t.colonne, 10);
  assert.equal(cella(t, "interface", 5), "sfp-sfpplus6");
  assert.equal(cella(t, "port-id", 4), "", "la porta inattiva ha le celle vuote");
  assert.equal(cella(t, "port-id", 5), "0x80.6");
  assert.equal(cella(t, "last-topology-change", 7), "2h9m25s");
  assert.equal(cella(t, "root-path-cost", 0), null, "una riga che manca vale «non letto»");
});

test("Casi da non dimenticare 2: un nome con uno spazio resta una colonna", () => {
  const out = [
    "               interface: uplink core  ether2     \r",
    "                  status: in-bridge    in-bridge  \r",
    "                    role: root-port    designated-port\r",
    "",
  ].join("\n");
  const t = tabellaMonitor(out);
  assert.equal(t.colonne, 2);
  assert.equal(cella(t, "interface", 0), "uplink core");
  assert.equal(cella(t, "role", 1), "designated-port");
});

test("MK5: una colonna per bridge, nell'ordine di MK3; bridge-id nelle due forme; porta radice", () => {
  assert.deepEqual(parseMonitorBridge(F("mikrotik-mk5-testa.txt")), [
    { bridgeId: "0.02:00:a0:10:0e:02", radice: true, radiceId: "0.02:00:a0:10:0e:02", radiceRegionaleId: null, portaRadice: null, costo: 0, digest: null },
  ]);
  assert.deepEqual(parseMonitorBridge(F("mikrotik-mk5-frontiera.txt")).map((b) => [b.bridgeId, b.radice, b.radiceId, b.portaRadice, b.costo]), [
    ["32768.02:00:a0:10:93:15", false, "0.02:00:a0:10:0e:02", "sfp-sfpplus12", 2400],
    ["32768.02:00:a0:10:9a:16", true, "32768.02:00:a0:10:9a:16", null, 0],
  ]);
  assert.deepEqual(parseMonitorBridge(F("mikrotik-vuoto.txt")), []);
});

test("bridgeIdNormale: le due forme di RouterOS in una (priorità decimale, MAC minuscolo)", () => {
  assert.equal(bridgeIdNormale("0x8000.02:00:A0:10:93:15"), "32768.02:00:a0:10:93:15");
  assert.equal(bridgeIdNormale("0.02:00:A0:10:0E:02"), "0.02:00:a0:10:0e:02");
  assert.equal(bridgeIdNormale("none"), null);
  assert.equal(bridgeIdNormale(""), null);
});

test("MK6: ruoli e stati nelle parole dello standard, BPDU ricevuti, porta inattiva senza stato", () => {
  const p = parseMonitorPorte(F("mikrotik-mk6-testa.txt"));
  assert.equal(p.length, 10);
  assert.deepEqual(p[0], {
    porta: "sfp-sfpplus1", attiva: true, ruolo: "designated", stato: "forwarding", bridgeDesignato: "0.02:00:a0:10:0e:02",
    portaDesignata: "0x80.1", costo: 10, bordo: true, puntoPunto: true, rstp: true, bpduRicevuti: 0,
  });
  assert.deepEqual(p[4], {
    porta: "sfp-sfpplus5", attiva: false, ruolo: null, stato: null, bridgeDesignato: null, portaDesignata: null, costo: null,
    bordo: null, puntoPunto: null, rstp: null, bpduRicevuti: null,
  });
  assert.deepEqual([p[6].porta, p[6].bordo, p[6].bpduRicevuti], ["bond1", false, 237]);
  const f = parseMonitorPorte(F("mikrotik-mk6-frontiera.txt"));
  assert.deepEqual([f[0].porta, f[0].ruolo, f[0].stato, f[0].bridgeDesignato, f[0].bpduRicevuti],
    ["sfp-sfpplus12", "root", "forwarding", "32768.02:00:a0:10:7e:12", 302210]);
  assert.deepEqual(f.slice(1).map((x) => [x.porta, x.attiva]), [["bonding1", false], ["sfp-sfpplus8", false]]);
});

test("MK8: membri, partner LACP, active-ports su più righe; nessun partner se la riga manca", () => {
  assert.deepEqual(parseFasci(F("mikrotik-mk8a-testa.txt")).map((f) => [f.nome, f.membri]), [
    ["bond1", ["sfp28-2", "sfp28-1"]], ["bond2", ["sfp-sfpplus11", "sfp-sfpplus12"]], ["bond3", ["sfp-sfpplus9", "sfp-sfpplus10"]],
  ]);
  assert.deepEqual(parseMonitorFasci(F("mikrotik-mk8b-testa.txt"))[0], { attivi: ["sfp28-1", "sfp28-2"], inattivi: [], partner: "02:00:A0:10:7E:12" });
  assert.deepEqual(parseMonitorFasci(F("mikrotik-mk8b-frontiera.txt")), [{ attivi: [], inattivi: ["sfp28-1", "sfp28-2"], partner: null }]);
});

test("un errore si riconosce dal testo, non dal codice d'uscita; le uscite buone non sono errori", () => {
  assert.equal(erroreRouterOs(F("mikrotik-errore.txt")), "NO_SUCH_ITEM");
  assert.equal(erroreRouterOs("bad command name zz (line 1 column 20)\r\n"), "BAD_COMMAND");
  assert.equal(erroreRouterOs("syntax error (line 1 column 5)\r\n"), "SYNTAX_ERROR");
  assert.equal(erroreRouterOs("expected end of command (line 1 column 31)\r\n"), "EXPECTED_END");
  for (const f of ["mikrotik-mk2-testa.txt", "mikrotik-mk5-testa.txt", "mikrotik-mk6-testa.txt", "mikrotik-vuoto.txt"]) assert.equal(erroreRouterOs(F(f)), null, f);
});

const lettura = () => ({
  interfacce: parseInterfacce(F("mikrotik-mk2-testa.txt")), bridge: parseBridge(F("mikrotik-mk3-testa.txt")),
  porteBridge: parsePorteBridge(F("mikrotik-mk4-testa.txt")), monitorBridge: parseMonitorBridge(F("mikrotik-mk5-testa.txt")),
  monitorPorte: parseMonitorPorte(F("mikrotik-mk6-testa.txt")), fasci: parseFasci(F("mikrotik-mk8a-testa.txt")),
  monitorFasci: parseMonitorFasci(F("mikrotik-mk8b-testa.txt")),
});

test("i fatti del router di testa: porta, fascio, bridge, spanning tree, MAC", () => {
  const f = fattiMikrotik(lettura());
  const p = (n: string) => f.porte.find((x) => x.port_name === n);
  assert.deepEqual(p("sfp-sfpplus1"), {
    port_key: "n:sfp-sfpplus1", port_name: "sfp-sfpplus1", port_index: null, if_kind: "physical", running: 1, in_bridge: 1,
    bridge: "BR_RP", lag_group: null, lag_partner: null, stp_role: "designated", stp_state: "forwarding",
    designated_bridge: "0.02:00:a0:10:0e:02", designated_port: "0x80.1", path_cost: 10, edge: 1, point_to_point: 1,
    sending_rstp: 1, bpdu_rx: 0,
  });
  assert.deepEqual([p("sfp28-1")?.lag_group, p("sfp28-1")?.lag_partner, p("sfp28-1")?.in_bridge, p("sfp28-1")?.stp_state], ["bond1", "02:00:A0:10:7E:12", 1, null]);
  assert.deepEqual([p("bond1")?.if_kind, p("bond1")?.lag_group, p("bond1")?.stp_state, p("bond1")?.bpdu_rx], ["lag", "bond1", "forwarding", 237]);
  assert.deepEqual([p("ether1")?.in_bridge, p("ether1")?.running], [0, 0]);
  assert.deepEqual([p("tunnel-qa")?.if_kind, p("VL_3_QWRTY")?.if_kind, p("sfp-sfpplus5")?.stp_state], ["tunnel", "vlan", null]);
  assert.deepEqual(f.bridge, [{
    bridge_name: "BR_RP", instance: 0, protocol: "rstp", priority: 0, bridge_id: "0.02:00:a0:10:0e:02", root_id: "0.02:00:a0:10:0e:02",
    regional_root_id: null, region_name: null, region_revision: null, config_digest: null, vlans: null, root_port: null, root_path_cost: 0,
  }]);
  assert.equal(f.macs.length, 17, "un MAC una volta sola; il loopback no");
});

test("senza MK4 una porta non è «fuori dal bridge»: non nota; senza MK3 nessun bridge", () => {
  const f = fattiMikrotik({ ...lettura(), bridge: null, porteBridge: null, monitorBridge: null });
  assert.equal(f.porte.find((x) => x.port_name === "ether1")?.in_bridge, null);
  assert.deepEqual(f.bridge, []);
});
```

```bash
node --import tsx --test src/lib/devices/__tests__/mikrotik-stp.test.ts > "$SCRATCH/t3-rosso.log" 2>&1; echo "exit=$?"
```

Atteso: `exit=1` (modulo mancante).

- [ ] **Step 3: il lettore** — `src/lib/devices/mikrotik-stp.ts`:

```ts
/**
 * Spanning tree, bridge, fasci e interfacce di un MikroTik (spec topologia §13.5.2, MK2-MK8) in fatti con le parole
 * dello standard (ruoli root, designated, alternate, backup, disabled; stati forwarding, discarding, learning, disabled;
 * tipi physical, lag, vlan, vrrp, bridge, tunnel, wireless, other). Scritto sulle forme vere viste il 14/10 sera sui
 * quattro router della rete B (RouterOS 7.24.2 e 7.24.5, via ssh senza terminale). Tre forme d'uscita:
 * - `print terse`: una riga per voce, `chiave=valore`, valori con spazi SENZA virgolette (si legge con `campiTerse`);
 * - la tabella di `monitor … once`: una colonna per elemento (bridge, porta, fascio), righe `etichetta: valore`; si legge
 *   per colonne, dalle posizioni della prima riga: divisa sugli spazi si sposta appena una cella è vuota (porta inattiva);
 * - un errore non catturato, scritto su stdout con ssh uscito con 0: si riconosce dal testo (`erroreRouterOs`).
 * Logica pura: niente rete, niente DB.
 */
import { campiTerse, righeDiUscita } from "@/lib/devices/mikrotik-vicini";
import type { FattiLettura, FattoBridgeIn, FattoPortaIn, MacApparatoIn } from "@/lib/db-tenant";
import { normale } from "@/lib/topology/cavi/porte";

const MAC = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

function macValido(s: string | null | undefined): string | null {
  const v = (s ?? "").trim();
  if (!MAC.test(v) || /^(00:){5}00$/.test(v)) return null;
  return v.toUpperCase();
}
const vuotoNull = (s: string | null | undefined): string | null => (s === null || s === undefined || s.trim() === "" ? null : s.trim());
function intero(s: string | null | undefined): number | null {
  const v = (s ?? "").trim();
  return /^-?\d+$/.test(v) ? Number(v) : null;
}
function siNo(s: string | null | undefined): boolean | null {
  const v = (s ?? "").trim().toLowerCase();
  return v === "yes" || v === "true" ? true : v === "no" || v === "false" ? false : null;
}
function priorita(s: string | undefined): number | null {
  const v = (s ?? "").trim();
  return /^0x[0-9a-f]+$/i.test(v) ? parseInt(v.slice(2), 16) : intero(v);
}
const lista = (s: string | null | undefined): string[] => (s ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
const zeroUno = (b: boolean | null | undefined): number | null => (b === true ? 1 : b === false ? 0 : null);

/** I segni fra l'indice e il primo campo di una riga `print terse` (« 1 RS name=…» → «RS»; « 0    name=…» → «»). */
export function segni(riga: string): string {
  const m = /^\s*\d+\s+([A-Z]+)\s/.exec(riga);
  return m ? m[1] : "";
}

// ── MK2: /interface print terse ──────────────────────────────────────────────

export interface InterfacciaMk { nome: string; tipo: string | null; mac: string | null; accesa: boolean; spenta: boolean }

export function parseInterfacce(out: string): InterfacciaMk[] {
  const r: InterfacciaMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const nome = c.get("name");
    if (!nome) continue;
    const s = segni(riga);
    r.push({ nome, tipo: c.get("type")?.toLowerCase() || null, mac: macValido(c.get("mac-address")), accesa: s.includes("R"), spenta: s.includes("X") });
  }
  return r;
}

/** Il tipo di RouterOS nella parola neutra (spec §13.5.1). Un tipo che non c'è qui è «other», mai indovinato dal nome. */
const TIPO_NEUTRO: Readonly<Record<string, string>> = {
  ether: "physical", bond: "lag", vlan: "vlan", vrrp: "vrrp", bridge: "bridge",
  wlan: "wireless", wifi: "wireless", w60g: "wireless",
  wg: "tunnel", "ovpn-out": "tunnel", "ovpn-client": "tunnel", "l2tp-out": "tunnel", "l2tp-client": "tunnel", "sstp-out": "tunnel",
  "pptp-out": "tunnel", gre: "tunnel", gre6: "tunnel", eoip: "tunnel", eoipv6: "tunnel", ipip: "tunnel", ipipv6: "tunnel", vxlan: "tunnel",
};
export function tipoNeutro(tipo: string | null): string | null {
  return tipo === null ? null : (TIPO_NEUTRO[tipo] ?? "other");
}

// ── MK3: /interface bridge print terse without-paging ────────────────────────

export interface BridgeMk {
  nome: string;
  modo: "stp" | "rstp" | "mstp" | "none" | null;
  priorita: number | null;
  regione: string | null;
  revisione: number | null;
  mac: string | null;
  vlanFiltering: boolean | null;
  maxAge: string | null;
  forwardDelay: string | null;
}
const MODI = new Set(["stp", "rstp", "mstp", "none"]);

export function parseBridge(out: string): BridgeMk[] {
  const r: BridgeMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const nome = c.get("name");
    if (!nome) continue;
    const modo = (c.get("protocol-mode") ?? "").toLowerCase();
    r.push({
      nome, modo: MODI.has(modo) ? (modo as BridgeMk["modo"]) : null, priorita: priorita(c.get("priority")),
      regione: vuotoNull(c.get("region-name")), revisione: intero(c.get("region-revision")), mac: macValido(c.get("mac-address")),
      vlanFiltering: siNo(c.get("vlan-filtering")), maxAge: vuotoNull(c.get("max-message-age")), forwardDelay: vuotoNull(c.get("forward-delay")),
    });
  }
  return r;
}

// ── MK4: /interface bridge port print terse without-paging ───────────────────

export interface PortaBridgeMk { porta: string; bridge: string; pvid: number | null; inattiva: boolean }

export function parsePorteBridge(out: string): PortaBridgeMk[] {
  const r: PortaBridgeMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const porta = c.get("interface"), bridge = c.get("bridge");
    if (!porta || !bridge) continue;
    r.push({ porta, bridge, pvid: intero(c.get("pvid")), inattiva: segni(riga).includes("I") });
  }
  return r;
}

// ── Le tabelle di monitor ─────────────────────────────────────────────────────

export interface TabellaMonitor { colonne: number; righe: ReadonlyMap<string, readonly string[]> }
const ETICHETTA = /^\s*([a-z][a-z0-9-]*):(?:\s|$)/;

/**
 * Una tabella di `monitor … once`. Il valore comincia due caratteri dopo i due punti dell'etichetta (le etichette sono
 * allineate a destra). Un confine di colonna è l'inizio di una parola della prima riga che in TUTTE le righe con
 * l'etichetta ha uno spazio davanti: così una cella vuota non sposta le altre, e una parola dentro un nome con uno spazio
 * non diventa una colonna. Una riga senza etichetta continua quella sopra (`active-ports` su più righe): le celle si
 * uniscono con la virgola. Le righe `;;; commento` non contano.
 */
export function tabellaMonitor(out: string): TabellaMonitor {
  const linee = out.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "" && !l.trim().startsWith(";;;"));
  const conEtichetta = linee.filter((l) => ETICHETTA.test(l));
  const prima = conEtichetta[0];
  if (prima === undefined) return { colonne: 0, righe: new Map() };
  const valore = prima.indexOf(":") + 2;
  const candidati: number[] = [];
  for (let p = valore; p < prima.length; p++) if (prima[p] !== " " && (p === valore || prima[p - 1] === " ")) candidati.push(p);
  const confini = candidati.filter((p) => p === valore || conEtichetta.every((l) => (l[p - 1] ?? " ") === " "));
  const righe = new Map<string, string[]>();
  let ultima: string | null = null;
  for (const l of linee) {
    const celle = confini.map((p, i) => l.slice(p, confini[i + 1] ?? l.length).trim());
    const m = ETICHETTA.exec(l);
    if (m) {
      righe.set(m[1], celle);
      ultima = m[1];
    } else if (ultima !== null && l.slice(0, valore).trim() === "") {
      const prec = righe.get(ultima) ?? [];
      righe.set(ultima, confini.map((_, i) => (celle[i] ? (prec[i] ? `${prec[i]},${celle[i]}` : celle[i]) : (prec[i] ?? ""))));
    }
  }
  return { colonne: confini.length, righe };
}

/** La cella i di una riga: "" vuota, null = la riga non c'è («non letto»). */
export function cella(t: TabellaMonitor, etichetta: string, i: number): string | null {
  const r = t.righe.get(etichetta);
  return r === undefined ? null : (r[i] ?? "");
}

/** Il bridge-id in una forma sola, «priorità.mac» con la priorità decimale e il MAC minuscolo: RouterOS scrive `0x8000.MAC` e, con priorità 0, `0.MAC`. */
export function bridgeIdNormale(s: string | null | undefined): string | null {
  const m = /^(0x[0-9a-fA-F]+|\d+)\.([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})$/.exec((s ?? "").trim());
  if (!m) return null;
  const p = m[1].toLowerCase().startsWith("0x") ? parseInt(m[1].slice(2), 16) : parseInt(m[1], 10);
  return `${p}.${m[2].toLowerCase()}`;
}

// ── MK5: /interface bridge monitor [find] once ───────────────────────────────

export interface MonitorBridgeMk {
  bridgeId: string | null;
  radice: boolean | null;
  radiceId: string | null;
  radiceRegionaleId: string | null;
  /** null = questo bridge è la radice, o la riga non c'è. */
  portaRadice: string | null;
  costo: number | null;
  digest: string | null;
}

/** Una colonna per bridge, senza una riga coi nomi: la colonna i è il bridge i di MK3 (stesso `[find]`, stesso ordine). */
export function parseMonitorBridge(out: string): MonitorBridgeMk[] {
  const t = tabellaMonitor(out);
  return Array.from({ length: t.colonne }, (_, i): MonitorBridgeMk => {
    const rp = vuotoNull(cella(t, "root-port", i));
    return {
      bridgeId: bridgeIdNormale(cella(t, "bridge-id", i)), radice: siNo(cella(t, "root-bridge", i)),
      radiceId: bridgeIdNormale(cella(t, "root-bridge-id", i)), radiceRegionaleId: bridgeIdNormale(cella(t, "regional-root-bridge-id", i)),
      portaRadice: rp === null || rp === "none" ? null : rp, costo: intero(cella(t, "root-path-cost", i)), digest: vuotoNull(cella(t, "mst-config-digest", i)),
    };
  });
}

// ── MK6: /interface bridge port monitor [find] once ──────────────────────────

export type RuoloStp = "root" | "designated" | "alternate" | "backup" | "disabled";
export type StatoStp = "forwarding" | "discarding" | "learning" | "disabled";
const RUOLI: Readonly<Record<string, RuoloStp>> = {
  "root-port": "root", "designated-port": "designated", "alternate-port": "alternate", "backup-port": "backup", "disabled-port": "disabled",
};

export interface MonitorPortaMk {
  porta: string;
  /** `status: in-bridge`; inattiva = tutte le altre celle vuote. */
  attiva: boolean;
  ruolo: RuoloStp | null;
  stato: StatoStp | null;
  bridgeDesignato: string | null;
  portaDesignata: string | null;
  costo: number | null;
  bordo: boolean | null;
  puntoPunto: boolean | null;
  rstp: boolean | null;
  /** Il secondo numero di `tx-rx-bpdu`: BPDU ricevuti (il vicino parla spanning tree). */
  bpduRicevuti: number | null;
}

export function parseMonitorPorte(out: string): MonitorPortaMk[] {
  const t = tabellaMonitor(out);
  const r: MonitorPortaMk[] = [];
  for (let i = 0; i < t.colonne; i++) {
    const porta = cella(t, "interface", i) ?? "";
    if (porta === "") continue;
    if (cella(t, "status", i) !== "in-bridge") {
      r.push({ porta, attiva: false, ruolo: null, stato: null, bridgeDesignato: null, portaDesignata: null, costo: null, bordo: null, puntoPunto: null, rstp: null, bpduRicevuti: null });
      continue;
    }
    const ruolo = RUOLI[cella(t, "role", i) ?? ""] ?? null;
    const avanti = siNo(cella(t, "forwarding", i)), impara = siNo(cella(t, "learning", i));
    // Lo stato viene da forwarding e learning (`status` dice solo in-bridge o inactive, spec §13.5.2).
    const stato: StatoStp | null = avanti === true ? "forwarding" : impara === true ? "learning"
      : avanti === false ? (ruolo === "disabled" ? "disabled" : "discarding") : null;
    const bpdu = /^(\d+)\/(\d+)$/.exec(cella(t, "tx-rx-bpdu", i) ?? "");
    r.push({
      porta, attiva: true, ruolo, stato, bridgeDesignato: bridgeIdNormale(cella(t, "designated-bridge-id", i)),
      portaDesignata: vuotoNull(cella(t, "designated-port-id", i)), costo: intero(cella(t, "actual-path-cost", i)),
      bordo: siNo(cella(t, "edge-port", i)), puntoPunto: siNo(cella(t, "point-to-point-port", i)), rstp: siNo(cella(t, "sending-rstp", i)),
      bpduRicevuti: bpdu ? Number(bpdu[2]) : null,
    });
  }
  return r;
}

// ── MK8: /interface bonding print terse e monitor [find] once ────────────────

export interface FascioMk { nome: string; membri: string[]; modo: string | null }
export interface MonitorFascioMk { attivi: string[]; inattivi: string[]; partner: string | null }

export function parseFasci(out: string): FascioMk[] {
  const r: FascioMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const nome = c.get("name");
    if (!nome) continue;
    r.push({ nome, membri: lista(c.get("slaves")), modo: vuotoNull(c.get("mode")) });
  }
  return r;
}

/** Una colonna per fascio, nell'ordine di `print`. `lacp-partner-system-id` c'è solo se c'è un partner. */
export function parseMonitorFasci(out: string): MonitorFascioMk[] {
  const t = tabellaMonitor(out);
  return Array.from({ length: t.colonne }, (_, i): MonitorFascioMk => ({
    attivi: lista(cella(t, "active-ports", i)), inattivi: lista(cella(t, "inactive-ports", i)), partner: macValido(cella(t, "lacp-partner-system-id", i)),
  }));
}

// ── Errori ───────────────────────────────────────────────────────────────────

const ERRORI: ReadonlyArray<readonly [RegExp, string]> = [
  [/^no such item\b/m, "NO_SUCH_ITEM"], [/^bad command name\b/m, "BAD_COMMAND"],
  [/^syntax error\b/m, "SYNTAX_ERROR"], [/^expected end of command\b/m, "EXPECTED_END"],
];
/** Il codice di un errore di RouterOS dal testo dell'uscita (a inizio riga), o null. Non conta sul codice d'uscita di ssh. */
export function erroreRouterOs(testo: string): string | null {
  const t = testo.replace(/\r/g, "");
  for (const [re, codice] of ERRORI) if (re.test(t)) return codice;
  return null;
}

// ── I fatti da scrivere ───────────────────────────────────────────────────────

/** Una lettura: null = quel comando non è riuscito (o non è stato mandato), [] = riuscito e vuoto. */
export interface LetturaMk {
  interfacce: InterfacciaMk[] | null;
  bridge: BridgeMk[] | null;
  porteBridge: PortaBridgeMk[] | null;
  monitorBridge: MonitorBridgeMk[] | null;
  monitorPorte: MonitorPortaMk[] | null;
  fasci: FascioMk[] | null;
  monitorFasci: MonitorFascioMk[] | null;
}

/**
 * I fatti per `scriviFattiTopologia` (fonte `device`). La chiave della porta è il nome normalizzato («n:…»): il MikroTik
 * letto via SSH non dà un indice. Un membro di un fascio sta nel bridge se ci sta il fascio (in MK4 il fascio compare come
 * porta, i membri no); lo stato dello spanning tree è del fascio, non dei membri. Senza MK4 «nel bridge» non è noto.
 */
export function fattiMikrotik(l: LetturaMk): FattiLettura {
  const chiave = (nome: string): string => `n:${normale(nome)}`;
  const nelBridge = new Map((l.porteBridge ?? []).map((p) => [p.porta, p]));
  const fascioDi = new Map<string, string>();
  for (const f of l.fasci ?? []) for (const m of f.membri) fascioDi.set(m, f.nome);
  const partnerDi = new Map<string, string | null>();
  (l.fasci ?? []).forEach((f, i) => partnerDi.set(f.nome, l.monitorFasci?.[i]?.partner ?? null));
  const stp = new Map((l.monitorPorte ?? []).map((m) => [m.porta, m]));
  const porte: FattoPortaIn[] = [];
  const macs: MacApparatoIn[] = [];
  for (const i of l.interfacce ?? []) {
    const fascio = fascioDi.get(i.nome) ?? (i.tipo === "bond" ? i.nome : null);
    const pb = nelBridge.get(i.nome) ?? (fascio !== null ? nelBridge.get(fascio) : undefined);
    const m = stp.get(i.nome);
    porte.push({
      port_key: chiave(i.nome), port_name: i.nome, port_index: null, if_kind: tipoNeutro(i.tipo), running: i.accesa ? 1 : 0,
      in_bridge: l.porteBridge === null ? null : pb ? 1 : 0, bridge: pb?.bridge ?? null,
      lag_group: fascio, lag_partner: fascio !== null ? (partnerDi.get(fascio) ?? null) : null,
      stp_role: m?.ruolo ?? null, stp_state: m?.stato ?? null, designated_bridge: m?.bridgeDesignato ?? null,
      designated_port: m?.portaDesignata ?? null, path_cost: m?.costo ?? null, edge: zeroUno(m?.bordo), point_to_point: zeroUno(m?.puntoPunto),
      sending_rstp: zeroUno(m?.rstp), bpdu_rx: m?.bpduRicevuti ?? null,
    });
    if (i.mac) macs.push({ mac: i.mac, port_key: chiave(i.nome) });
  }
  const bridge: FattoBridgeIn[] = (l.bridge ?? []).map((b, i) => {
    const mon = l.monitorBridge?.[i];
    return {
      bridge_name: b.nome, instance: 0, protocol: b.modo, priority: b.priorita,
      bridge_id: mon?.bridgeId ?? (b.mac && b.priorita !== null ? `${b.priorita}.${b.mac.toLowerCase()}` : null),
      root_id: mon?.radiceId ?? null, regional_root_id: mon?.radiceRegionaleId ?? null, region_name: b.regione, region_revision: b.revisione,
      config_digest: mon?.digest ?? null, vlans: null, root_port: mon?.portaRadice ?? null, root_path_cost: mon?.costo ?? null,
    };
  });
  const visti = new Set<string>();
  return { porte, bridge, macs: macs.filter((m) => !visti.has(m.mac) && !!visti.add(m.mac)) };
}
```

  Una porta inattiva in MK4 resta «nel bridge»: `in_bridge` dice l'appartenenza; acceso o spento lo dicono `running` e
  lo spanning tree.

- [ ] **Step 4: MK1, la parte di T2** — in `src/lib/devices/router-client.ts`, in `NeighborEntry` dopo `remotePlatform`:

```ts
  /**
   * T2 (spec §13.5.2, MK1): l'elenco letto di `discovered-by` («cdp,lldp,mndp», in ordine) e le capacità annunciate
   * attive (`system-caps-enabled`). Le legge il lettore dei MikroTik; si scrivono solo con `topologia.lettura.mikrotik`
   * accesa (chi chiama `upsertNeighbors` le toglie altrimenti, `senzaCampiCavi`).
   */
  discoveredBy?: string;
  remoteCaps?: string;
```

  In `src/lib/devices/mikrotik-vicini.ts`, sopra `parseMikrotikNeighbors`:

```ts
/** Un elenco separato da virgole in una forma sola: minuscolo, in ordine, senza vuoti; assente se vuoto. */
function elenco(v: string | undefined): string | undefined {
  const s = (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x !== "");
  return s.length > 0 ? [...new Set(s)].sort().join(",") : undefined;
}
```

  e nel `push` di `parseMikrotikNeighbors`, dopo `remotePlatform`:

```ts
      ...(elenco(c.get("discovered-by")) ? { discoveredBy: elenco(c.get("discovered-by")) } : {}),
      ...(elenco(c.get("system-caps-enabled")) ? { remoteCaps: elenco(c.get("system-caps-enabled")) } : {}),
```

  Nella prova di oggi `src/lib/devices/__tests__/mikrotik-vicini.test.ts:16` l'oggetto atteso del primo vicino riceve
  `discoveredBy: "lldp", remoteCaps: "bridge,router"`; nessun altro valore cambia. Una prova nuova in fondo allo stesso
  file:

```ts
test("T2: discovered-by e capacità annunciate, in una forma sola; assenti se vuote", () => {
  const v = parseMikrotikNeighbors(TERSE);
  assert.deepEqual([v[0].discoveredBy, v[0].remoteCaps], ["lldp", "bridge,router"]);
  assert.deepEqual([v[5].discoveredBy, v[5].remoteCaps], ["cdp,lldp,mndp", "bridge,router"]);
  assert.equal("remoteCaps" in v[1], false, "system-caps-enabled= vuoto: niente campo");
});
```

- [ ] **Step 5: `stp-ssh.ts` passa a MK3 e MK5** (spec §13.5.2, «Dove gira»: oggi legge `/interface bridge print`, che è il
  detail e va a capo, prende la riga sbagliata e accetta solo `0x…`) — `src/lib/devices/snmp-stp-info.ts:18` diventa
  `protocol: "stp" | "rstp" | "mstp" | null;` (prima `rg -n "\.protocol" src | grep -i stp` per vedere chi lo legge:
  chi confronta con `"rstp"` resta giusto; chi elenca i casi riceve `"mstp"`). In `src/lib/devices/stp-ssh.ts` si tolgono
  `parseMikrotikBridgePrint`, `mikrotikBridgeIdToPriorityMac` e `parseMikrotikBridgeMonitor`, e `getMikrotikStpInfo`
  diventa:

```ts
import { erroreRouterOs, parseBridge, parseMonitorBridge } from "./mikrotik-stp";

/**
 * MikroTik: MK3 (`/interface bridge print terse`) e MK5 (`/interface bridge monitor [find] once`), coi lettori delle
 * forme vere (spec topologia §13.5.2). Il primo bridge, come prima. MSTP non diventa più null. Un errore riconosciuto dal
 * testo, o nessun bridge, dà null (niente informazioni, mai informazioni sbagliate).
 */
export async function getMikrotikStpInfo(execCommand: (cmd: string) => Promise<string>): Promise<StpInfo | null> {
  try {
    const out3 = await execCommand("/interface bridge print terse without-paging");
    if (erroreRouterOs(out3)) return null;
    const b = parseBridge(out3)[0];
    if (!b) return null;
    const out5 = await execCommand("/interface bridge monitor [find] once");
    if (erroreRouterOs(out5)) return null;
    const m = parseMonitorBridge(out5)[0];
    if (!m || (!m.bridgeId && !m.radiceId)) return null;
    const prio = b.priorita ?? (m.bridgeId ? Number(m.bridgeId.split(".")[0]) : null);
    return {
      bridge_id: m.bridgeId, root_bridge_id: m.radiceId ?? m.bridgeId, priority: prio, root_cost: m.costo,
      root_port: m.portaRadice ?? "none", hello_time_s: null,
      forward_delay_s: parseMikrotikDuration(b.forwardDelay ?? ""), max_age_s: parseMikrotikDuration(b.maxAge ?? ""),
      is_root_bridge: m.radice === true, protocol: b.modo === "stp" || b.modo === "rstp" || b.modo === "mstp" ? b.modo : null,
    };
  } catch {
    return null;
  }
}
```

  Prova, `src/lib/devices/__tests__/stp-ssh.test.ts` (nuovo; se esiste già, in fondo):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getMikrotikStpInfo } from "@/lib/devices/stp-ssh";

const F = (n: string): string => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");
const exec = (m: Record<string, string>) => async (cmd: string): Promise<string> => {
  if (!(cmd in m)) throw new Error(`comando inatteso: ${cmd}`);
  return m[cmd];
};
const MK3 = "/interface bridge print terse without-paging", MK5 = "/interface bridge monitor [find] once";

test("router di testa: radice, priorità 0 dalla forma «0.MAC»", async () => {
  const s = await getMikrotikStpInfo(exec({ [MK3]: F("mikrotik-mk3-testa.txt"), [MK5]: F("mikrotik-mk5-testa.txt") }));
  assert.deepEqual([s?.bridge_id, s?.priority, s?.is_root_bridge, s?.root_port, s?.protocol, s?.max_age_s, s?.forward_delay_s],
    ["0.02:00:a0:10:0e:02", 0, true, "none", "rstp", 20, 15]);
});

test("router di frontiera: il primo bridge, con la sua porta radice e la radice nell'altra forma", async () => {
  const s = await getMikrotikStpInfo(exec({ [MK3]: F("mikrotik-mk3-frontiera.txt"), [MK5]: F("mikrotik-mk5-frontiera.txt") }));
  assert.deepEqual([s?.bridge_id, s?.root_bridge_id, s?.root_port, s?.root_cost, s?.priority], ["32768.02:00:a0:10:93:15", "0.02:00:a0:10:0e:02", "sfp-sfpplus12", 2400, 32768]);
});

test("senza bridge o con un errore: null", async () => {
  assert.equal(await getMikrotikStpInfo(exec({ [MK3]: F("mikrotik-vuoto.txt") })), null);
  assert.equal(await getMikrotikStpInfo(exec({ [MK3]: F("mikrotik-mk3-testa.txt"), [MK5]: F("mikrotik-errore.txt") })), null);
});
```

- [ ] **Step 6: verde** —

```bash
for f in src/lib/devices/__tests__/mikrotik-stp.test.ts src/lib/devices/__tests__/mikrotik-vicini.test.ts src/lib/devices/__tests__/stp-ssh.test.ts \
         src/lib/topology/__tests__/fixture-anonime.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t3-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
npx tsc --noEmit > "$SCRATCH/t3-tsc.log" 2>&1; echo "tsc exit=$?"
```

  Atteso: tutti `exit=0`. Poi il controllo dei dati veri nelle fixture, fuori dal repo: lo script della sessione
  principale (P2) confronta ogni MAC, nome di VLAN, commento e PVID delle fixture nuove con le uscite vere della rete B:
  **0 coincidenze** (i nomi di fabbrica — `sfp-sfpplus1`, `sfp28-1`, `bond1`, `ether1`, `lo` — sono ammessi).

- [ ] **Step 7: commit** — `git add src/lib/devices/mikrotik-stp.ts src/lib/devices/mikrotik-vicini.ts src/lib/devices/router-client.ts
  src/lib/devices/stp-ssh.ts src/lib/devices/snmp-stp-info.ts src/lib/devices/__tests__/`, poi
  `git commit -m "feat(topologia): lettori MikroTik MK2-MK8 sulle forme vere, stp-ssh su MK3 e MK5 (T2.2)"`.

---
### Task 4: le letture in più dei MikroTik nel giro (T2.2) — livello completo, zona rossa

Spec §13.5.1 (una connessione per i comandi nuovi, tempo massimo, cadenza e lucchetto, errori dal testo), §13.5.2
(«Più comandi, una connessione»: di base MK3-MK8 in più `exec` sulla stessa connessione; «Dove gira»: ramo dei router e
ramo degli switch MikroTik di `runArpPoll`, i vicini degli switch con `source = 'ssh'`; MK1, la parte di T2), §13.5.6,
prove I33 (spia sui comandi) e I53. MK7 non si manda: arriva col Task 3b (T2-a).

**Files:**
- Create: `src/lib/devices/mikrotik-letture.ts`
- Modify: `src/lib/devices/router-client.ts` (`RouterClient.ultimaUscitaInterfacce?`, `opzioniSshDiApparato`, `createMikrotikClient`)
- Modify: `src/lib/cron/jobs.ts` (`RunArpPollOptions`, i due rami di `runArpPoll`, il resoconto e la riga dei tempi)
- Test: `src/lib/cron/__tests__/arp-letture-mikrotik.test.ts`

**Interfaces:**
- Consumes: `execConTempo`, `withSshClient` (ssh-transport, Task 2); `parseInterfacce`, `parseBridge`, `parsePorteBridge`,
  `parseMonitorBridge`, `parseMonitorPorte`, `parseFasci`, `parseMonitorFasci`, `erroreRouterOs`, `fattiMikrotik`,
  `LetturaMk` (Task 3); `parseMikrotikNeighbors` (con `discoveredBy`, `remoteCaps`, Task 3); `codiceErrore`;
  `scriviFattiTopologia` (Task 1); `conCadenza`, `riassuntoLetture`, `EsitoGiro` (Task 2); `letturaAccesa`,
  `senzaCampiCavi` (Task 2).
- Produces (`src/lib/devices/mikrotik-letture.ts`): `TEMPO_COMANDO_MS = 20_000`, `COMANDI_MK` (oggetto coi comandi esatti),
  `type Esegui = (comando: string, tempoMs: number) => Promise<string>`,
  `type ApriEsecutore = <T>(device: NetworkDevice, fn: (esegui: Esegui) => Promise<T>) => Promise<T>`, `apriEsecutoreSsh`,
  `interface RisultatoMk { lettura: LetturaMk; vicini: NeighborEntry[] | null; comandi: number; riusciti: number; codice: string | null }`,
  `leggiMikrotikTopologia(esegui: Esegui, opz: { uscitaInterfacce: string | null; conVicini: boolean }): Promise<RisultatoMk>`.
- Produces (`router-client.ts`): `opzioniSshDiApparato(device: NetworkDevice): SshOptions | null`;
  `RouterClient.ultimaUscitaInterfacce?(): string | null`.
- Produces (`jobs.ts`): `RunArpPollOptions.apriEsecutore?: ApriEsecutore`, `RunArpPollOptions.adesso?: () => Date`.

- [ ] **Step 1: le prove, viste fallire** — `src/lib/cron/__tests__/arp-letture-mikrotik.test.ts`:

```ts
// Le letture in più dei MikroTik nel giro (spec topologia §13.5.2, T2.2). Spente di default: con la chiave assente il
// giro non manda nessun comando nuovo (spia sull'esecutore, I33) e le colonne nuove dei vicini restano vuote. Accese: una
// connessione per apparato, un `exec` per comando col suo tempo massimo; il router non rimanda MK2 (l'uscita c'è già);
// al più una volta l'ora per apparato; due giri paralleli → una lettura; un comando che non risponde non ferma né la
// lettura né gli apparati dopo (I53); un errore si riconosce dal testo.
//
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { runArpPoll } from "@/lib/cron/jobs";
import type { RouterClient } from "@/lib/devices/router-client";
import { parseMikrotikNeighbors } from "@/lib/devices/mikrotik-vicini";
import { parseMikrotikInterfaceTypes } from "@/lib/devices/mikrotik-porte";
import { ComandoScaduto } from "@/lib/devices/ssh-transport";
import { COMANDI_MK, type ApriEsecutore } from "@/lib/devices/mikrotik-letture";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";

const T = "TESTARPLETTUREMK";
const db = () => getTenantDb(T);
const FX = path.join(__dirname, "..", "..", "devices", "__tests__", "fixtures");
const F = (n: string): string => fs.readFileSync(path.join(FX, n), "utf8");
const USCITE: Record<string, string> = {
  [COMANDI_MK.interfacce]: F("mikrotik-mk2-testa.txt"), [COMANDI_MK.vicini]: F("mikrotik-ip-neighbor-terse.txt"),
  [COMANDI_MK.bridge]: F("mikrotik-mk3-testa.txt"), [COMANDI_MK.porteBridge]: F("mikrotik-mk4-testa.txt"),
  [COMANDI_MK.monitorBridge]: F("mikrotik-mk5-testa.txt"), [COMANDI_MK.monitorPorte]: F("mikrotik-mk6-testa.txt"),
  [COMANDI_MK.fasci]: F("mikrotik-mk8a-testa.txt"), [COMANDI_MK.monitorFasci]: F("mikrotik-mk8b-testa.txt"),
};

function spia(diverse: Record<string, () => Promise<string>> = {}) {
  const chiamate: Array<{ device: number; comandi: string[] }> = [];
  const apri: ApriEsecutore = async (device, fn) => {
    const voce = { device: device.id, comandi: [] as string[] };
    chiamate.push(voce);
    return fn(async (cmd) => {
      voce.comandi.push(cmd);
      const d = diverse[cmd];
      if (d) return d();
      if (!(cmd in USCITE)) throw new Error(`comando inatteso: ${cmd}`);
      return USCITE[cmd];
    });
  };
  return { apri, chiamate };
}

function clientFinto(): RouterClient {
  const mk2 = F("mikrotik-mk2-testa.txt");
  return {
    async getArpTable() { return []; },
    async testConnection() { return true; },
    async getNeighbors() { return parseMikrotikNeighbors(F("mikrotik-ip-neighbor-terse.txt")); },
    async getBridgeHosts() { return []; },
    async getInterfaceTypes() { return parseMikrotikInterfaceTypes(mk2); },
    ultimaUscitaInterfacce() { return mk2; },
  };
}

beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM mac_port_entries; DELETE FROM network_devices; DELETE FROM networks;
    DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';`);
  db().exec("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'LAN prova')");
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll) "
    + "VALUES (1, 'RTR-1', '192.0.2.1', 'router', 'mikrotik', 'ssh', 1, 1), (2, 'SW-2', '192.0.2.2', 'switch', 'mikrotik', 'ssh', 1, 0)");
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const ora = (h: number, m = 0) => () => new Date(Date.UTC(2026, 9, 15, h, m));
const giro = (s: ReturnType<typeof spia>, adesso = ora(8)) =>
  withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: async () => clientFinto(), apriEsecutore: s.apri, adesso }));
const conta = (sql: string): number => (db().prepare(sql).get() as { n: number }).n;
const accendi = () => withTenant(T, () => scriviInterruttore("mikrotik", true, "admin"));

test("I33: letture spente → nessun comando nuovo, nessun fatto, vicini senza le colonne nuove", async () => {
  const s = spia();
  await giro(s);
  assert.deepEqual(s.chiamate, []);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_port_facts"), 0);
  assert.equal(conta("SELECT COUNT(*) AS n FROM device_neighbors WHERE device_id = 1"), 9, "i vicini di oggi ci sono");
  assert.equal(conta("SELECT COUNT(discovered_by) + COUNT(remote_caps) AS n FROM device_neighbors"), 0);
});

test("accese: una connessione per apparato; il router non rimanda MK2; fatti, esito, vicini dello switch con la fonte ssh", async () => {
  accendi();
  const s = spia();
  const r = await giro(s);
  assert.deepEqual(s.chiamate.map((c) => [c.device, c.comandi.length]), [[1, 6], [2, 8]]);
  assert.equal(s.chiamate[0].comandi.includes(COMANDI_MK.interfacce), false, "MK2 dall'uscita già letta dal giro");
  assert.ok(conta("SELECT COUNT(*) AS n FROM topology_port_facts WHERE device_id = 1 AND source = 'device'") > 20);
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_bridge_facts"), 2);
  assert.ok(conta("SELECT COUNT(*) AS n FROM device_neighbors WHERE device_id = 2 AND source = 'ssh'") > 0);
  assert.ok(conta("SELECT COUNT(discovered_by) AS n FROM device_neighbors WHERE device_id = 1") > 0);
  assert.deepEqual(Object.keys(withTenant(T, () => leggiEsiti("mikrotik"))).sort(), ["1", "2"]);
  assert.match(r.phase ?? "", /letture in più: 2 lette/);
});

test("cadenza e lucchetto: due giri paralleli → una lettura per apparato; mezz'ora dopo nessun comando", async () => {
  accendi();
  const s1 = spia();
  await Promise.all([giro(s1, ora(8)), giro(s1, ora(8))]);
  assert.equal(s1.chiamate.length, 2);
  const s2 = spia();
  await giro(s2, ora(8, 30));
  assert.deepEqual(s2.chiamate, []);
});

test("I53: un comando che non risponde non ferma la lettura né gli apparati dopo", async () => {
  accendi();
  const s = spia({ [COMANDI_MK.monitorBridge]: async () => { throw new ComandoScaduto(20_000); } });
  await giro(s);
  const e = withTenant(T, () => leggiEsiti("mikrotik"));
  assert.deepEqual([e["1"].comandi, e["1"].riusciti, e["1"].codice], [6, 5, "TEMPO_SCADUTO"]);
  assert.equal(s.chiamate.length, 2, "lo switch dopo si legge lo stesso");
  assert.equal(conta("SELECT COUNT(*) AS n FROM topology_bridge_facts WHERE device_id = 1 AND root_id IS NULL"), 1, "il bridge c'è, la radice non è letta");
});

test("un errore riconosciuto dal testo conta come non riuscito (ssh uscito con 0)", async () => {
  accendi();
  await giro(spia({ [COMANDI_MK.fasci]: async () => F("mikrotik-errore.txt") }));
  assert.equal(withTenant(T, () => leggiEsiti("mikrotik"))["1"].codice, "NO_SUCH_ITEM");
});
```

```bash
node --import tsx --test src/lib/cron/__tests__/arp-letture-mikrotik.test.ts > "$SCRATCH/t4-rosso.log" 2>&1; echo "exit=$?"
```

Atteso: `exit=1` (modulo `mikrotik-letture` mancante).

- [ ] **Step 2: il lettore sulla connessione** — `src/lib/devices/mikrotik-letture.ts`:

```ts
/**
 * Le letture in più di un MikroTik via SSH (spec topologia §13.5.2, T2.2): una connessione sola (`withSshClient`), un
 * `exec` per comando, ognuno col suo tempo massimo e il suo esito; un errore si riconosce dal testo (ssh esce con 0). MK2 nel
 * ramo dei router è l'uscita che il giro ha già letto per la tabella del bridge (nessun comando nuovo); nel ramo degli
 * switch MikroTik si legge qui, con MK1 (i vicini, fonte `ssh`). MK7 (istanze MSTP) non si manda finché il suo lettore non
 * è scritto sull'uscita vera (Task 3b, T2-a): fino ad allora lo stato per istanza è «non letto». Sola lettura.
 */
import type { NetworkDevice } from "@/types";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import { parseMikrotikNeighbors } from "@/lib/devices/mikrotik-vicini";
import { opzioniSshDiApparato, type NeighborEntry } from "@/lib/devices/router-client";
import { execConTempo, withSshClient } from "@/lib/devices/ssh-transport";
import {
  erroreRouterOs, parseBridge, parseFasci, parseInterfacce, parseMonitorBridge, parseMonitorFasci, parseMonitorPorte,
  parsePorteBridge, type LetturaMk,
} from "@/lib/devices/mikrotik-stp";

/** Il tempo massimo di un comando nuovo (spec §13.5.1). Sulla rete B 32 comandi in circa un secondo: 20 s è largo. */
export const TEMPO_COMANDO_MS = 20_000;

/** I comandi, esatti, in sola lettura (spec §13.5.2). */
export const COMANDI_MK = {
  interfacce: "/interface print terse",
  vicini: "/ip neighbor print terse",
  bridge: "/interface bridge print terse without-paging",
  porteBridge: "/interface bridge port print terse without-paging",
  monitorBridge: "/interface bridge monitor [find] once",
  monitorPorte: "/interface bridge port monitor [find] once",
  fasci: "/interface bonding print terse without-paging",
  monitorFasci: "/interface bonding monitor [find] once",
} as const;

export type Esegui = (comando: string, tempoMs: number) => Promise<string>;
export type ApriEsecutore = <T>(device: NetworkDevice, fn: (esegui: Esegui) => Promise<T>) => Promise<T>;

/** La connessione vera: una per apparato e per lettura, chiusa alla fine anche se un comando fallisce. */
export const apriEsecutoreSsh: ApriEsecutore = async (device, fn) => {
  const opts = opzioniSshDiApparato(device);
  if (!opts) throw Object.assign(new Error("Credenziali SSH mancanti"), { code: "SENZA_CREDENZIALI" });
  return withSshClient(opts, (conn) => fn(async (comando, tempoMs) => {
    const r = await execConTempo(conn, comando, tempoMs);
    return r.stdout + r.stderr;
  }));
};

export interface RisultatoMk {
  lettura: LetturaMk;
  vicini: NeighborEntry[] | null;
  comandi: number;
  riusciti: number;
  /** Il primo errore, col solo codice (resoconto ed esito). */
  codice: string | null;
}

export async function leggiMikrotikTopologia(esegui: Esegui, opz: { uscitaInterfacce: string | null; conVicini: boolean }): Promise<RisultatoMk> {
  let comandi = 0, riusciti = 0;
  let codice: string | null = null;
  const prova = async <T>(cmd: string, leggi: (out: string) => T): Promise<T | null> => {
    comandi++;
    try {
      const out = await esegui(cmd, TEMPO_COMANDO_MS);
      const errore = erroreRouterOs(out);
      if (errore) {
        codice ??= errore;
        return null;
      }
      riusciti++;
      return leggi(out);
    } catch (e) {
      codice ??= codiceErrore(e);
      return null;
    }
  };
  const interfacce = opz.uscitaInterfacce !== null && !erroreRouterOs(opz.uscitaInterfacce)
    ? parseInterfacce(opz.uscitaInterfacce)
    : await prova(COMANDI_MK.interfacce, parseInterfacce);
  const vicini = opz.conVicini ? await prova(COMANDI_MK.vicini, parseMikrotikNeighbors) : null;
  const bridge = await prova(COMANDI_MK.bridge, parseBridge);
  const porteBridge = await prova(COMANDI_MK.porteBridge, parsePorteBridge);
  const monitorBridge = await prova(COMANDI_MK.monitorBridge, parseMonitorBridge);
  const monitorPorte = await prova(COMANDI_MK.monitorPorte, parseMonitorPorte);
  const fasci = await prova(COMANDI_MK.fasci, parseFasci);
  const monitorFasci = await prova(COMANDI_MK.monitorFasci, parseMonitorFasci);
  return { lettura: { interfacce, bridge, porteBridge, monitorBridge, monitorPorte, fasci, monitorFasci }, vicini, comandi, riusciti, codice };
}
```

  (Sei comandi nel ramo dei router — MK3, MK4, MK5, MK6, MK8 `print` e `monitor` — come dice il dialogo di accensione,
  §13.5.6; otto nel ramo degli switch, con MK2 e MK1. Un `[find]` vuoto non dà errore: i comandi si mandano anche su un
  router senza bridge, ed escono vuoti.)

- [ ] **Step 3: il client del router** — in `src/lib/devices/router-client.ts`, nell'interfaccia `RouterClient` dopo
  `getInterfaceTypes?`:

```ts
  /** Solo MikroTik SSH: l'ultima uscita di `/interface print terse` letta da `getInterfaceTypes` (MK2 delle letture in più, senza un comando nuovo). */
  ultimaUscitaInterfacce?(): string | null;
```

  dopo `buildDeviceSshOptions`:

```ts
/** Le opzioni SSH di un apparato con le sue credenziali, per le letture in più su una connessione sola (spec §13.5.1). null = credenziali mancanti. */
export function opzioniSshDiApparato(device: NetworkDevice): SshOptions | null {
  const creds = getDeviceCredentials(device);
  return buildDeviceSshOptions(device, { username: creds?.username ?? device.username ?? undefined, password: creds?.password });
}
```

  e in `createMikrotikClient`, dopo `const execCommand = …`, `let uscitaInterfacce: string | null = null;`; il metodo
  `getInterfaceTypes` diventa:

```ts
    async getInterfaceTypes() {
      const out = await execCommand("/interface print terse");
      uscitaInterfacce = out;
      return parseMikrotikInterfaceTypes(out);
    },
    ultimaUscitaInterfacce() {
      return uscitaInterfacce;
    },
```

- [ ] **Step 4: il giro** — in `src/lib/cron/jobs.ts`:
  - import: `scriviFattiTopologia` dall'elenco di `@/lib/db-tenant`; `import { apriEsecutoreSsh, leggiMikrotikTopologia, type ApriEsecutore } from "@/lib/devices/mikrotik-letture";`
    `import { fattiMikrotik } from "@/lib/devices/mikrotik-stp";` `import { conCadenza, riassuntoLetture, type EsitoGiro } from "@/lib/topology/letture/cadenza";`
    `import { letturaAccesa, senzaCampiCavi } from "@/lib/topology/letture/interruttori";` `import type { NetworkDevice } from "@/types";` (se manca).
  - in `RunArpPollOptions`, dopo `creaClientRouter`:

```ts
  /** Solo per le prove: la connessione delle letture in più dei MikroTik al posto di quella SSH vera (spia, I33). */
  apriEsecutore?: ApriEsecutore;
  /** Solo per le prove: l'ora del giro per la cadenza delle letture in più. */
  adesso?: () => Date;
```

  - prima di `runArpPoll`:

```ts
/**
 * Le letture in più di un MikroTik letto via SSH (spec topologia §13.5.2, T2.2), dietro `topologia.lettura.mikrotik`, al
 * più una volta l'ora per apparato. `uscitaInterfacce`: MK2 già letto dal giro (ramo dei router); null = si legge qui.
 * `conVicini`: il ramo degli switch legge anche MK1, con la fonte nuova `ssh`, che legge solo il modello per cavo.
 */
async function letturaMikrotik(device: NetworkDevice, uscitaInterfacce: string | null, conVicini: boolean, options?: RunArpPollOptions): Promise<EsitoGiro<unknown>> {
  return conCadenza("mikrotik", device.id, async () => {
    const r = await (options?.apriEsecutore ?? apriEsecutoreSsh)(device, (esegui) => leggiMikrotikTopologia(esegui, { uscitaInterfacce, conVicini }));
    const scritti = scriviFattiTopologia(device.id, "device", fattiMikrotik(r.lettura), options?.adesso?.() ?? new Date());
    if (r.vicini && r.vicini.length > 0) upsertNeighbors(device.id, r.vicini, "ssh");
    return { valore: scritti, conteggio: { comandi: r.comandi, riusciti: r.riusciti, codice: r.codice } };
  }, options?.adesso);
}
```

  - in `runArpPoll`, accanto a `porteNonLette`: `const esitiLetture: Array<EsitoGiro<unknown>> = [];` e
    `const durate = { router: 0, switch: 0, nRouter: 0, nSwitch: 0 };`; all'inizio del `for (const device of devices)`:
    `const t0 = performance.now();`, e alla fine del corpo (dentro il `try`, dopo i due rami, e nel `catch`) si somma il
    tempo a `durate.router`/`durate.switch` secondo il ramo. Il modo più semplice: una funzione locale
    `const conta = (ramo: "router" | "switch") => { durate[ramo] += performance.now() - t0; if (ramo === "router") durate.nRouter++; else durate.nSwitch++; };`
    chiamata in un `finally` col ramo deciso da `networkDeviceUsesArpPoll(device)` (gli hypervisor, che fanno `continue`,
    non contano).
  - nel ramo dei router, il blocco dei vicini diventa:

```ts
        if (client.getNeighbors) {
          try {
            const neighbors = await client.getNeighbors();
            if (neighbors.length > 0) {
              // T2 (spec §13.5.2, MK1): discovered-by e capacità solo con la lettura dei MikroTik accesa (I33).
              upsertNeighbors(device.id, letturaAccesa("mikrotik") ? neighbors : neighbors.map(senzaCampiCavi));
            }
          } catch (err) {
            console.warn(`[Neighbors] Errore su ${device.name}:`, err);
          }
        }
```

  - nel ramo dei router, dopo il blocco della tabella di routing:

```ts
        if (device.vendor === "mikrotik" && device.protocol === "ssh") {
          esitiLetture.push(await letturaMikrotik(device, client.ultimaUscitaInterfacce?.() ?? null, false, options));
        }
```

  - nel ramo degli switch, **come prima istruzione** (prima di `createSwitchClient`: una tabella MAC che fallisce non deve
    togliere le letture in più):

```ts
        if (device.vendor === "mikrotik" && device.protocol === "ssh") {
          esitiLetture.push(await letturaMikrotik(device, null, true, options));
        }
```

  - in fondo, il resoconto e la riga dei tempi (numeri, mai nomi):

```ts
  const letture = riassuntoLetture(esitiLetture);
  const phase = [base, porteNonLette.length > 0 ? `porte fisiche non lette: ${porteNonLette.join(", ")}` : null, letture]
    .filter((x): x is string => !!x).join("; ");
  if (networkId == null) {
    const s = (ms: number): string => (ms / 1000).toFixed(1).replace(".", ",");
    console.info(`[ARP Poll] giro: ${durate.nRouter} router in ${s(durate.router)} s, ${durate.nSwitch} switch in ${s(durate.switch)} s${letture ? `; ${letture}` : ""}`);
  }
  return { phase };
```

  (La riga dei tempi serve alla misura del carico, Task 17: la durata del giro degli switch prima e dopo l'accensione.)

- [ ] **Step 5: verde, e le prove di oggi del giro** —

```bash
for f in src/lib/cron/__tests__/arp-letture-mikrotik.test.ts src/lib/cron/__tests__/arp-router-porte.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t4-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
rg -l "runArpPoll|router-client" src --glob '*.test.ts' | while read -r f; do node --import tsx --test "$f" > "$SCRATCH/t4-x-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
npx tsc --noEmit > "$SCRATCH/t4-tsc.log" 2>&1; echo "tsc exit=$?"
```

  Atteso: tutti `exit=0`.

- [ ] **Step 6: commit** — `git add src/lib/devices/mikrotik-letture.ts src/lib/devices/router-client.ts src/lib/cron/jobs.ts
  src/lib/cron/__tests__/arp-letture-mikrotik.test.ts`, `git commit -m "feat(topologia): letture in più dei MikroTik nel giro, spente di default (T2.2)"`.

---
### Task 5: i campi del controller (T2.3) — livello completo, zona rossa

Spec §13.5.3 tutta (campi già nella risposta di `stat/device`; nessuna chiamata nuova; dietro
`topologia.lettura.controller`; prima, la verifica su un controller con un gateway e la fixture estesa con un gateway e
un Flex Mini), §13.5.7 (`device_neighbors.local_port_index`, `.remote_port_index`; `network_devices.uplink_local_port_idx`,
`.uplink_source`; fatti di fonte `controller`). Dipende da P5 (il file anonimo del gateway).

**Scelte del piano, dichiarate.** (a) La fixture del gateway è un **file nuovo**, `unifi-stat-device-gateway.json`,
accanto a quella di oggi: aggiungere apparati a `unifi-stat-device.json` cambierebbe i conteggi delle prove di oggi della
sincronizzazione senza un perché. (b) Il controller non manda comandi nuovi agli apparati: niente cadenza (le scritture
seguono la sincronizzazione notturna); l'esito per apparato si scrive lo stesso, per la pagina. (c) Il controller non dice
la porta radice: nei fatti di bridge di fonte `controller` `root_port` resta assente, e il modello per cavo usa l'uplink
(§13.8.3, punto 1). (d) `root_switch` è un MAC senza priorità: `root_id` si scrive come MAC minuscolo; il modello per cavo
confronta i bridge per MAC (la parte dopo il punto).

**Files:**
- Modify: `src/lib/integrations/unifi-device.ts` (campi nuovi, facoltativi nel tipo, letti dal parser)
- Modify: `src/lib/integrations/unifi-map.ts` (`mapUnifiLldpConIndici`, `mapUnifiFattiCavi`)
- Modify: `src/lib/integrations/unifi-sync.ts` (`writeDevices`, `writeDevice`)
- Create: `src/lib/integrations/__tests__/fixtures/unifi-stat-device-gateway.json` (da P5, anonima)
- Test: `src/lib/integrations/__tests__/unifi-cavi.test.ts`

**Interfaces:**
- Consumes: `scriviFattiTopologia`, `setUplinkCavi`, `schemaCaviPresente`, `FattiLettura` (Task 1); `letturaAccesa`,
  `scriviEsito`, `oraUtc`, `senzaCampiCavi` (Task 2).
- Produces: `UnifiDevice.stp_version?`, `.stp_priority?`, `.root_switch?`, `.ethernet_table?: UnifiEthernet[]`;
  `UnifiPort.lag_idx?`, `.stp_pathcost?`; `UnifiNeighbor.localPortIndex?`, `.remotePortIndex?`;
  `mapUnifiLldpConIndici(d: UnifiDevice, index: UnifiMacIndex): UnifiNeighbor[]`; `mapUnifiFattiCavi(d: UnifiDevice): FattiLettura`.

- [ ] **Step 1: la fixture del gateway** — il file anonimo di P5 (`gateway-anonimo.json`) si copia in
  `src/lib/integrations/__tests__/fixtures/unifi-stat-device-gateway.json` dopo il controllo di P5 (0 MAC veri). Nel
  resoconto del task, in parole e senza dati: se le righe LLDP del gateway hanno `local_port_idx`; se c'è il partner LACP;
  se `ethernet_table` contiene il «MAC + 1» (S8). Se P5 non è fatto, il task si ferma qui e lo dice: senza la forma vera
  del gateway il parser non si scrive (spec §13.5.3, «Da verificare su un controller vero»).

- [ ] **Step 2: le prove, viste fallire** — `src/lib/integrations/__tests__/unifi-cavi.test.ts`:

```ts
// I campi del controller per la mappa per cavo (spec topologia §13.5.3): già nella risposta di stat/device, finora letti e
// buttati (local_port_idx, uplink.port_idx, uplink_source) o non letti (stp_version, stp_priority, root_switch,
// ethernet_table, lag_idx, stp_pathcost). Si scrivono solo con `topologia.lettura.controller` accesa; spenta, la
// sincronizzazione scrive esattamente ciò che scriveva prima.
import { removeTestHubDb } from "./support/hub-isolato";
import path from "node:path";
import fs from "node:fs";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { parseStatDeviceResponse } from "../unifi-device";
import { buildUnifiMacIndex, mapUnifiFattiCavi, mapUnifiLldp, mapUnifiLldpConIndici } from "../unifi-map";
import { syncUnifiForTenant } from "../unifi-sync";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";

const T = "TESTUNIFICAVI";
const db = () => getTenantDb(T);
const leggi = (f: string) => parseStatDeviceResponse(JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8")) as unknown);
const devs = () => leggi("unifi-stat-device.json");

beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs;
    DELETE FROM device_neighbors; DELETE FROM switch_ports; DELETE FROM network_devices; DELETE FROM hosts;
    DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';`);
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("il parser legge i campi nuovi dalla fixture vera", () => {
  const sw = devs().find((d) => d.model === "US8P60");
  assert.ok(sw);
  assert.deepEqual([sw.stp_version, sw.stp_priority, sw.root_switch, sw.ethernet_table?.length], ["rstp", 32768, "02:00:00:00:00:0a", 2]);
  assert.deepEqual([sw.port_table[0].lag_idx, sw.port_table[0].stp_pathcost], [null, 0]);
  const mini = devs().find((d) => d.model === "USMINI");
  assert.deepEqual([mini?.stp_version, mini?.port_table[0].stp_state], [null, null], "il Flex Mini senza spanning tree");
});

test("i fatti di uno switch del controller: porte per indice, stato, bridge, tutti i MAC", () => {
  const sw = devs().find((d) => d.model === "US8P60");
  assert.ok(sw);
  const f = mapUnifiFattiCavi(sw);
  assert.equal(f.porte.length, sw.port_table.length);
  assert.deepEqual([f.porte[0].port_key, f.porte[0].port_index, f.porte[0].if_kind, f.porte[0].stp_state], ["i:1", 1, "physical", "disabled"]);
  assert.equal(f.bridge.length, 1);
  assert.deepEqual([f.bridge[0].protocol, f.bridge[0].priority, f.bridge[0].root_id], ["rstp", 32768, "02:00:00:00:00:0a"]);
  assert.equal("root_port" in f.bridge[0], false, "il controller non dice la porta radice");
  assert.ok(f.macs.length >= 2);
  assert.deepEqual(mapUnifiFattiCavi(devs().find((d) => d.model === "USMINI")!).bridge, [], "senza spanning tree nessun bridge");
});

test("i vicini con gli indici: la porta locale sempre, la remota quando il vicino è nella risposta e ha quella porta", () => {
  const d = devs();
  const idx = buildUnifiMacIndex(d);
  const sw = d.find((x) => x.model === "US8P60")!;
  const con = mapUnifiLldpConIndici(sw, idx);
  const senza = mapUnifiLldp(sw, idx);
  assert.deepEqual(con.map(({ localPortIndex: _l, remotePortIndex: _r, ...resto }) => resto), senza, "stessi vicini, solo gli indici in più");
  const p6 = con.find((n) => n.localPort === "Port 6");
  assert.deepEqual([p6?.localPortIndex, p6?.remotePortIndex], [6, 14]);
});

test("la fixture del gateway (P5) si legge: porte, uplink e la sua origine", () => {
  const g = leggi("unifi-stat-device-gateway.json");
  const gw = g.find((x) => x.type === "udm" || x.type === "ugw" || x.type === "uxg");
  assert.ok(gw, "c'è il gateway");
  assert.ok(gw.port_table.length > 0);
  assert.ok(g.some((x) => (x.model ?? "").startsWith("USMINI")), "c'è il Flex Mini nella forma dell'hub");
});

test("spenta: la sincronizzazione scrive ciò che scriveva prima, niente di nuovo", async () => {
  await withTenant(T, () => syncUnifiForTenant({ source: { async listDevices() { return devs(); } } }));
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM topology_port_facts").get() as { n: number }).n, 0);
  assert.equal((db().prepare("SELECT COUNT(local_port_index) AS n FROM device_neighbors").get() as { n: number }).n, 0);
  assert.equal((db().prepare("SELECT COUNT(uplink_source) AS n FROM network_devices").get() as { n: number }).n, 0);
  assert.deepEqual(withTenant(T, () => leggiEsiti("controller")), {});
});

test("accesa: fatti di fonte controller, indici dei vicini, uplink per indice, esito per apparato", async () => {
  withTenant(T, () => scriviInterruttore("controller", true, "admin"));
  await withTenant(T, () => syncUnifiForTenant({ source: { async listDevices() { return devs(); } } }));
  assert.ok((db().prepare("SELECT COUNT(*) AS n FROM topology_port_facts WHERE source = 'controller'").get() as { n: number }).n > 0);
  assert.ok((db().prepare("SELECT COUNT(local_port_index) AS n FROM device_neighbors").get() as { n: number }).n > 0);
  assert.ok((db().prepare("SELECT COUNT(uplink_source) AS n FROM network_devices").get() as { n: number }).n > 0);
  const esiti = Object.keys(withTenant(T, () => leggiEsiti("controller")));
  const ids = new Set((db().prepare("SELECT id FROM network_devices").all() as Array<{ id: number }>).map((r) => String(r.id)));
  assert.ok(esiti.length > 0 && esiti.every((k) => ids.has(k)), "un esito per apparato connesso letto, e solo per loro");
});
```

```bash
node --import tsx --test src/lib/integrations/__tests__/unifi-cavi.test.ts > "$SCRATCH/t5-rosso.log" 2>&1; echo "exit=$?"
```

  Atteso: `exit=1`.

- [ ] **Step 3: il parser** — in `src/lib/integrations/unifi-device.ts`:

```ts
/** Una voce di `ethernet_table`: i MAC dell'apparato (spec §13.5.3; il «MAC del controller + 1» non è verificato, S8). */
export interface UnifiEthernet {
  mac: string | null;
  name: string | null;
}
```

  in `UnifiPort`, dopo `aggregated_by`:

```ts
  /** T2 (spec §13.5.3): fascio (LAG) di cui la porta fa parte, e il costo della porta nello spanning tree. Assenti nelle risposte costruite a mano dalle prove. */
  lag_idx?: number | null;
  stp_pathcost?: number | null;
```

  in `UnifiDevice`, dopo `uplink`:

```ts
  /** T2 (spec §13.5.3): modo e priorità dello spanning tree, radice vista dallo switch (un MAC), tutti i MAC dell'apparato. */
  stp_version?: string | null;
  stp_priority?: number | null;
  root_switch?: string | null;
  ethernet_table?: UnifiEthernet[];
```

  in `parsePort`, dopo `aggregated_by: int(r.aggregated_by),`: `lag_idx: int(r.lag_idx), stp_pathcost: int(r.stp_pathcost),`;
  una funzione nuova:

```ts
function parseEthernet(raw: unknown): UnifiEthernet | null {
  const r = asRecord(raw);
  return r ? { mac: str(r.mac), name: str(r.name) } : null;
}
```

  e in `parseUnifiDevice`, dopo `uplink: parseUplink(r.uplink),`:

```ts
    stp_version: str(r.stp_version),
    stp_priority: int(r.stp_priority),
    root_switch: str(r.root_switch),
    ethernet_table: compact(r.ethernet_table, parseEthernet),
```

  Le prove di oggi che confrontano un apparato o una porta interi (`unifi-device.test.ts`) ricevono i campi nuovi nel
  valore atteso; nessun altro valore cambia.

- [ ] **Step 4: la mappa verso i fatti** — in `src/lib/integrations/unifi-map.ts`:
  - `UnifiNeighbor` riceve `localPortIndex?: number | null; remotePortIndex?: number | null;` (T2, spec §13.5.3);
  - `LldpLink` riceve `remotePortIdx: number | null`, che `lldpLinks` calcola così, prima del `push`:

```ts
    // T2 (spec §13.5.3): «Port N» quando il vicino è un apparato della stessa risposta che ha la porta d'indice N.
    const n = /^Port (\d+)$/i.exec(remotePort);
    const remotePortIdx = remote && n && remote.port_table.some((p) => p.port_idx === Number(n[1])) ? Number(n[1]) : null;
    links.push({ localPortIdx: e.local_port_idx, neighbor, remotePortIdx });
```

  - dopo `mapUnifiLldp`:

```ts
/** I vicini con gli indici delle due porte (T2, spec §13.5.3): li usa la sincronizzazione solo con la lettura accesa. */
export function mapUnifiLldpConIndici(d: UnifiDevice, index: UnifiMacIndex): UnifiNeighbor[] {
  return lldpLinks(d, index).map((l) => ({
    ...l.neighbor,
    ...(l.localPortIdx !== null ? { localPortIndex: l.localPortIdx } : {}),
    ...(l.remotePortIdx !== null ? { remotePortIndex: l.remotePortIdx } : {}),
  }));
}

/** Lo stato dello spanning tree come lo scrive il controller, nelle parole dello standard; un valore che non si conosce: null. */
const STATI_STP: Readonly<Record<string, string>> = {
  forwarding: "forwarding", blocking: "discarding", discarding: "discarding", learning: "learning", listening: "learning",
  disabled: "disabled", broken: "discarding",
};

/**
 * I fatti di un apparato del controller (spec §13.5.3), fonte `controller`: ogni porta del `port_table` per indice
 * («i:N»), fisica; accesa o spenta; fascio (`lag_idx`, oppure il gruppo della porta che aggrega, `aggregated_by`); stato e
 * costo nello spanning tree (gli switch del controller parlano RSTP; `disabled` su una porta accesa = spanning tree
 * spento, e la porta inoltra: lo decide il modello per cavo). Il bridge: modo, priorità, radice vista (un MAC: il
 * controller non dà la sua priorità); la porta radice no, il controller non la dice. I MAC: quello dell'apparato e
 * `ethernet_table`.
 */
export function mapUnifiFattiCavi(d: UnifiDevice): FattiLettura {
  const aggregatori = new Set(d.port_table.flatMap((p) => (p.aggregated_by != null ? [p.aggregated_by] : [])));
  const gruppo = (p: UnifiPort): string | null =>
    p.lag_idx != null ? `lag:${p.lag_idx}` : p.aggregated_by != null ? `porta:${p.aggregated_by}` : aggregatori.has(p.port_idx) ? `porta:${p.port_idx}` : null;
  const porte: FattoPortaIn[] = d.port_table.map((p) => ({
    port_key: `i:${p.port_idx}`, port_name: p.name ?? `Port ${p.port_idx}`, port_index: p.port_idx, if_kind: "physical",
    running: p.up === null ? null : p.up ? 1 : 0, lag_group: gruppo(p),
    stp_state: p.stp_state ? (STATI_STP[p.stp_state.toLowerCase()] ?? null) : null, path_cost: p.stp_pathcost ?? null,
  }));
  const modo = (d.stp_version ?? "").toLowerCase();
  const bridge: FattoBridgeIn[] = d.stp_version || d.stp_priority != null || d.root_switch
    ? [{
        bridge_name: "", instance: 0, protocol: ["stp", "rstp", "mstp"].includes(modo) ? modo : null, priority: d.stp_priority ?? null,
        bridge_id: d.mac && d.stp_priority != null ? `${d.stp_priority}.${d.mac.toLowerCase()}` : null,
        root_id: d.root_switch ? d.root_switch.toLowerCase() : null,
      }]
    : [];
  const macs: MacApparatoIn[] = [d.mac, ...(d.ethernet_table ?? []).map((e) => e.mac)]
    .filter((m): m is string => !!m).map((mac) => ({ mac, port_key: null }));
  return { porte, bridge, macs };
}
```

  con `import type { FattiLettura, FattoBridgeIn, FattoPortaIn, MacApparatoIn } from "@/lib/db-tenant";` e `UnifiPort`
  nell'import di `./unifi-device`.

- [ ] **Step 5: la sincronizzazione** — in `src/lib/integrations/unifi-sync.ts`:
  - import da `@/lib/db-tenant`: `schemaCaviPresente`, `scriviFattiTopologia`, `setUplinkCavi`; da `./unifi-map`:
    `mapUnifiFattiCavi`, `mapUnifiLldpConIndici`; `import { letturaAccesa, oraUtc, scriviEsito } from "@/lib/topology/letture/interruttori";`
  - il contesto di `writeDevice` riceve `cavi: boolean`; in `writeDevices`, nell'oggetto `ctx`:
    `cavi: letturaAccesa("controller") && schemaCaviPresente(),` (letto una volta per giro: lo stesso valore per tutti gli
    apparati del giro);
  - in `writeDevice`, `const neighbors = uniqueNeighbors(mapUnifiLldp(d, ctx.index));` diventa
    `const neighbors = uniqueNeighbors(ctx.cavi ? mapUnifiLldpConIndici(d, ctx.index) : mapUnifiLldp(d, ctx.index));`
  - in `writeDevice`, dopo `setNetworkDeviceControllerFacts(…)`:

```ts
  // T2 (spec §13.5.3): i campi per la mappa per cavo, solo con la lettura accesa e solo per un apparato connesso (offline il
  // controller manda l'ultima lettura buona, che non è di adesso). Nessuna chiamata nuova: l'esito dice «letto dal controller».
  if (ctx.cavi && connected) {
    scriviFattiTopologia(nd.id, "controller", mapUnifiFattiCavi(d));
    setUplinkCavi(nd.id, d.uplink?.port_idx ?? null, d.uplink?.uplink_source ?? null);
    scriviEsito("controller", nd.id, { il: oraUtc(new Date()), comandi: 1, riusciti: 1, codice: null });
  }
```

- [ ] **Step 6: verde, e le prove di oggi del controller** —

```bash
for f in src/lib/integrations/__tests__/unifi-cavi.test.ts src/lib/integrations/__tests__/unifi-device.test.ts \
         src/lib/integrations/__tests__/unifi-map.test.ts src/lib/integrations/__tests__/unifi-sync.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t5-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
npx tsc --noEmit > "$SCRATCH/t5-tsc.log" 2>&1; echo "tsc exit=$?"
```

  Atteso: tutti `exit=0`.

- [ ] **Step 7: commit** — `git add src/lib/integrations/unifi-device.ts src/lib/integrations/unifi-map.ts src/lib/integrations/unifi-sync.ts
  src/lib/integrations/__tests__/unifi-cavi.test.ts src/lib/integrations/__tests__/unifi-device.test.ts src/lib/integrations/__tests__/fixtures/unifi-stat-device-gateway.json`,
  `git commit -m "feat(topologia): campi del controller per la mappa per cavo, spenti di default (T2.3)"`.

---
### Task 6: SNMP — una sessione per lettura (SN1) e le letture nuove nel giro degli switch (SN2-SN9, T2.4) — livello completo, zona rossa

Spec §13.5.4 tutta («Dove gira», SN1-SN9, «Che cosa cambia accendendo»), prove I26 (lo stato solo sulle porte
tradotte), I33 (spia SNMP), «SN1 con un falso agente che annulla le richieste alla chiusura della sessione» (13.12.4).

**Scelte del piano, dichiarate.** (a) **Dieci letture** per switch, una per tabella (non una per colonna): tabella delle
interfacce, `ifName`, base del bridge, spanning tree, porte locali LLDP, vicini LLDP, indirizzi LLDP, cache CDP, porte
dei fasci, ruolo nell'albero comune MSTP — la spec dice «otto-dieci letture in più per switch». (b) **SN8** legge solo
il ruolo nell'albero comune (`…6.1.3.1.14`); la tabella per istanza (`…6.1.4.1.{5,10,11,12}`) non si legge in T2: senza
un'uscita vera la colonna giusta non si sa, e uno stato per istanza indovinato è peggio di «stato per istanza non letto»
(spec §13.13.2). Il partner LACP viene dalla colonna 9 di `dot3adAggPortTable` (`dot3adAggPortPartnerOperSystemID`, LAG-MIB).
I valori numerici del ruolo MSTP (`root(1)`, `alternate(2)`, `designated(3)`, `backup(4)`) sono quelli della MIB, **da
verificare** sulla prima lettura vera. (c) Le letture nuove saltano gli switch del controller (SN6: la chiave dei vicini
non ha la fonte) **e** i MikroTik letti via SSH (hanno le loro, Task 4). (d) La porta radice di un bridge che non si
traduce si scrive `bridge-port:<n>`, mai null (null vuol dire «radice»). (e) SN2 vale solo per la lettura nuova: la
lettura a mano dello spanning tree (`network_devices.stp_info`) riceve solo SN1.

**Files:**
- Create: `src/lib/devices/snmp-walk.ts`, `src/lib/devices/snmp-topologia.ts`
- Modify: `src/lib/devices/switch-client.ts` (`apriSessioneSnmpApparato`, `creaWalkSnmp`, `deviceHasSnmpSession` esportata;
  `createSnmpSwitchClient` usa `apriSessioneSnmpApparato`)
- Modify: `src/app/api/devices/[id]/query/route.ts:286-296`, `src/app/api/networks/bulk-scan-devices/route.ts:163-168` (SN1)
- Modify: `src/lib/cron/jobs.ts` (`RunArpPollOptions.creaWalkSnmp?`, `.creaClientSwitch?`, `letturaSnmp`, ramo degli switch)
- Test: `src/lib/devices/__tests__/snmp-walk.test.ts`, `src/lib/devices/__tests__/snmp-topologia.test.ts`,
  `src/lib/cron/__tests__/arp-letture-snmp.test.ts`

**Interfaces:**
- Consumes: `CODICE_TEMPO_SCADUTO` (Task 2); `codiceErrore`; `getSnmpStpInfo`; `apriSessioneCommunity`, `versioneApparato`
  (`snmp-sessione.ts`); `scriviFattiTopologia`, `FattiLettura` (Task 1); `conCadenza` (Task 2); `normalizeMacForStorage`.
- Produces (`snmp-walk.ts`): `type VoceSnmp`, `type SnmpWalkFn`, `interface SessioneWalk`, `TEMPO_WALK_MS = 10_000`,
  `walkConSessioneSua(apri: () => SessioneWalk, tempoMs: number): SnmpWalkFn`.
- Produces (`snmp-topologia.ts`): `TABELLE_SNMP`, `type VicinoSnmp`, `interface LetturaSnmp extends FattiLettura`,
  `leggiSnmpTopologia(walk: SnmpWalkFn, opz: { lettoreCisco: boolean }): Promise<LetturaSnmp>`.
- Produces (`switch-client.ts`): `apriSessioneSnmpApparato(snmp, device)`, `creaWalkSnmp(device, tempoMs?): Promise<SnmpWalkFn>`,
  `deviceHasSnmpSession(device): boolean` (esportata).

- [ ] **Step 1: le prove, viste fallire.**

`src/lib/devices/__tests__/snmp-walk.test.ts`:

```ts
// SN1 (spec §13.5.4): la lettura a mano dello spanning tree apriva UNA sessione e la chiudeva alla fine del primo walk:
// gli altri otto, partiti insieme, finivano annullati. Il falso agente fa come net-snmp: chiudere una sessione annulla le
// sue richieste ancora aperte. Con una sessione per lettura ogni walk arriva in fondo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSnmpStpInfo } from "@/lib/devices/snmp-stp-info";
import { walkConSessioneSua, type SessioneWalk, type VoceSnmp } from "@/lib/devices/snmp-walk";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";

const B = "1.3.6.1.2.1.17";
const VALORI: Record<string, Array<[string, Buffer | number]>> = {
  [`${B}.1.1`]: [[`${B}.1.1.0`, Buffer.from([2, 0, 0, 0, 0, 0x11])]],
  [`${B}.2.2`]: [[`${B}.2.2.0`, 32768]],
  [`${B}.2.5`]: [[`${B}.2.5.0`, Buffer.from([0x10, 0, 2, 0, 0, 0, 0, 0x01])]],
  [`${B}.2.6`]: [[`${B}.2.6.0`, 4]],
  [`${B}.2.7`]: [[`${B}.2.7.0`, 3]],
  [`${B}.2.8`]: [[`${B}.2.8.0`, 2000]],
  [`${B}.2.9`]: [[`${B}.2.9.0`, 200]],
  [`${B}.2.11`]: [[`${B}.2.11.0`, 1500]],
  [`${B}.2.1`]: [[`${B}.2.1.0`, 3]],
};

function agente(ritardoMs = 5) {
  let sessioni = 0;
  const apri = (): SessioneWalk => {
    sessioni++;
    let chiusa = false;
    const attese: Array<() => void> = [];
    return {
      subtree(oid, feed, done) {
        let fatto = false;
        const fine = (err?: Error) => { if (!fatto) { fatto = true; done(err); } };
        attese.push(() => fine(new Error("richiesta annullata: sessione chiusa")));
        setTimeout(() => {
          if (chiusa) return fine(new Error("sessione chiusa"));
          feed((VALORI[oid] ?? []).map(([o, v]) => ({ oid: o, value: v })));
          fine();
        }, ritardoMs);
      },
      close() {
        chiusa = true;
        for (const a of attese.splice(0)) a();
      },
    };
  };
  return { apri, sessioni: () => sessioni };
}

test("il falso agente riproduce il difetto: una sessione condivisa chiusa dal primo walk annulla gli altri", async () => {
  const a = agente();
  const s = a.apri();
  const condivisa = (oid: string) => new Promise<VoceSnmp[]>((resolve) => {
    const out: VoceSnmp[] = [];
    s.subtree(oid, (vbs) => { for (const vb of vbs) out.push({ oid: vb.oid, value: vb.value as VoceSnmp["value"] }); }, (err) => { s.close(); resolve(err ? [] : out); });
  });
  const info = await getSnmpStpInfo(condivisa);
  assert.ok(info === null || info.priority === null || info.root_cost === null, "con la sessione condivisa si perdono valori");
});

test("SN1: una sessione per lettura, e ogni valore arriva", async () => {
  const a = agente();
  const info = await getSnmpStpInfo(walkConSessioneSua(a.apri, 1000));
  assert.deepEqual([info?.priority, info?.root_cost, info?.root_port, info?.max_age_s, info?.is_root_bridge], [32768, 4, "3", 20, false]);
  assert.equal(a.sessioni(), 9, "nove letture, nove sessioni");
});

test("un walk che non risponde: TEMPO_SCADUTO, e chiude solo la sua sessione", async () => {
  const a = agente(500);
  await assert.rejects(walkConSessioneSua(a.apri, 30)(`${B}.2.2`), (e: unknown) => codiceErrore(e) === "TEMPO_SCADUTO");
});
```

`src/lib/devices/__tests__/snmp-topologia.test.ts`:

```ts
// SN2-SN9 (spec §13.5.4) su una lettura inventata con la forma delle MIB standard e della CISCO-CDP-MIB (famiglia 3 delle
// reti-campione, spec §13.12.2): DEDOTTA DALLE MIB, NON OSSERVATA. Uno switch in Rapid-PVST con un fascio «Po1», una porta
// bloccata, un vicino LLDP con porta locale data come porta del bridge (SN5: secondo pezzo dell'indice), CDP fra due
// apparati della stessa marca e da un'altra marca (SN9), e una porta del bridge che non si traduce (SN4, I26).
import { test } from "node:test";
import assert from "node:assert/strict";
import { leggiSnmpTopologia } from "@/lib/devices/snmp-topologia";
import type { SnmpWalkFn } from "@/lib/devices/snmp-walk";

const IF = "1.3.6.1.2.1.2.2.1", XIF = "1.3.6.1.2.1.31.1.1.1.1", BASE = "1.3.6.1.2.1.17.1", STP = "1.3.6.1.2.1.17.2";
const LOC = "1.0.8802.1.1.2.1.3.7.1", REM = "1.0.8802.1.1.2.1.4.1.1", MAN = "1.0.8802.1.1.2.1.4.2.1", CDP = "1.3.6.1.4.1.9.9.23.1.2.1.1";
const LAG = "1.2.840.10006.300.43.1.2.1.1", MSTP = "1.3.111.2.802.1.1.6.1.3.1.14";
const mac = (...b: number[]) => Buffer.from(b);
const VOCI: Array<[string, Buffer | number | string]> = [
  [`${IF}.2.10101`, "GigabitEthernet1/0/1"], [`${IF}.2.10124`, "GigabitEthernet1/0/24"], [`${IF}.2.5001`, "Port-channel1"], [`${IF}.2.1`, "Vlan1"],
  [`${IF}.3.10101`, 6], [`${IF}.3.10124`, 6], [`${IF}.3.5001`, 161], [`${IF}.3.1`, 135],
  [`${IF}.6.10101`, mac(2, 0, 0xc, 0, 0, 1)], [`${IF}.6.10124`, mac(2, 0, 0xc, 0, 0, 0x18)], [`${IF}.6.5001`, mac(2, 0, 0xc, 0, 0, 0x30)], [`${IF}.6.1`, mac(2, 0, 0xc, 0, 0, 0x40)],
  [`${IF}.8.10101`, 1], [`${IF}.8.10124`, 1], [`${IF}.8.5001`, 1], [`${IF}.8.1`, 1],
  [`${XIF}.10101`, "Gi1/0/1"], [`${XIF}.10124`, "Gi1/0/24"], [`${XIF}.5001`, "Po1"], [`${XIF}.1`, "Vl1"],
  [`${BASE}.1.0`, mac(2, 0, 0xc, 0, 0, 0x40)],
  [`${BASE}.4.1.2.1`, 10101], [`${BASE}.4.1.2.24`, 10124], [`${BASE}.4.1.2.25`, 5001],
  [`${STP}.2.0`, 32768], [`${STP}.5.0`, mac(0x10, 0, 2, 0, 0xc, 0, 0, 0x99)], [`${STP}.6.0`, 4], [`${STP}.7.0`, 25], [`${STP}.16.0`, 2],
  [`${STP}.15.1.3.1`, 5], [`${STP}.15.1.3.24`, 2], [`${STP}.15.1.3.25`, 5], [`${STP}.15.1.3.30`, 5],
  [`${STP}.15.1.8.25`, mac(0x10, 0, 2, 0, 0xc, 0, 0, 0x99)], [`${STP}.15.1.9.25`, mac(0x80, 0x19)],
  [`${LOC}.3.24`, "Gi1/0/24"], [`${LOC}.4.24`, "GigabitEthernet1/0/24"],
  [`${REM}.4.0.24.1`, 4], [`${REM}.5.0.24.1`, mac(2, 0, 0xc, 0, 0, 0x99)], [`${REM}.6.0.24.1`, 5], [`${REM}.7.0.24.1`, "Gi1/0/48"],
  [`${REM}.9.0.24.1`, "SW-CENTRO"], [`${REM}.12.0.24.1`, mac(0x28)],
  [`${MAN}.3.0.24.1.1.4.10.0.0.9`, 2],
  [`${CDP}.6.10101.1`, "SW-B"], [`${CDP}.7.10101.1`, "GigabitEthernet1/0/2"], [`${CDP}.8.10101.1`, "cisco WS-C2960X-48TS-L"], [`${CDP}.4.10101.1`, mac(10, 0, 0, 7)],
  [`${CDP}.6.10124.2`, "AP-3"], [`${CDP}.7.10124.2`, "eth0"], [`${CDP}.8.10124.2`, "HPE J9772A"],
  [`${LAG}.13.10101`, 5001], [`${LAG}.9.10101`, mac(2, 0, 0xc, 0, 0, 0x99)], [`${LAG}.13.10124`, 0],
  [`${MSTP}.1.25`, 1], [`${MSTP}.1.24`, 2],
];
function walkFinto(fallisce: string[] = []): { walk: SnmpWalkFn; letti: string[] } {
  const letti: string[] = [];
  const walk: SnmpWalkFn = async (oid) => {
    letti.push(oid);
    if (fallisce.includes(oid)) throw Object.assign(new Error("Request timed out"), { code: "TEMPO_SCADUTO" });
    return VOCI.filter(([o]) => o.startsWith(`${oid}.`)).map(([o, v]) => ({ oid: o, value: v }));
  };
  return { walk, letti };
}

test("dieci letture, una per tabella", async () => {
  const w = walkFinto();
  const l = await leggiSnmpTopologia(w.walk, { lettoreCisco: true });
  assert.deepEqual([l.letture, l.riuscite, l.codice, w.letti.length], [10, 10, null, 10]);
});

test("SN2 e SN3: versione vera, radice, porta radice tradotta dalla porta del bridge", async () => {
  const l = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: true });
  assert.deepEqual(l.bridge, [{
    bridge_name: "", instance: 0, protocol: "rstp", priority: 32768, bridge_id: "32768.02:00:0c:00:00:40",
    root_id: "4096.02:00:0c:00:00:99", root_port: "Po1", root_path_cost: 4,
  }]);
});

test("SN3, SN4 (I26) e SN7: stato solo sulle porte tradotte; tipo dall'ifType, mai dal nome; fascio e partner", async () => {
  const l = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: true });
  const p = (k: string) => l.porte.find((x) => x.port_key === k);
  assert.deepEqual([p("i:10124")?.stp_state, p("i:10124")?.stp_role, p("i:10124")?.in_bridge], ["discarding", "alternate", 1]);
  assert.deepEqual([p("i:5001")?.if_kind, p("i:5001")?.stp_state, p("i:5001")?.stp_role, p("i:5001")?.designated_bridge, p("i:5001")?.designated_port],
    ["lag", "forwarding", "root", "4096.02:00:0c:00:00:99", "0x80.25"]);
  assert.deepEqual([p("i:10101")?.lag_group, p("i:10101")?.lag_partner], ["if:5001", "02:00:0C:00:00:99"]);
  assert.deepEqual([p("i:1")?.if_kind, p("i:1")?.stp_state, p("i:1")?.in_bridge], ["vlan", null, 0]);
  assert.equal(l.porte.some((x) => x.stp_state !== null && x.port_index === 30), false, "la porta 30 del bridge non si traduce: nessuno stato");
  assert.equal(new Set(l.macs.map((m) => m.mac)).size, 4, "il MAC del bridge è anche quello della VLAN: una volta sola");
});

test("SN5: il vicino LLDP sulla porta locale data dal secondo pezzo dell'indice, con telaio, capacità e indirizzo", async () => {
  const l = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: true });
  assert.deepEqual(l.vicini.filter((v) => v.protocol === "lldp"), [{
    localPort: "Gi1/0/24", localPortIndex: 10124, remoteDevice: "SW-CENTRO", remotePort: "Gi1/0/48", protocol: "lldp",
    remoteMac: "02:00:0C:00:00:99", remoteIp: "10.0.0.9", remoteCaps: "bridge,router",
  }]);
});

test("SN9: CDP come collegamento solo fra due apparati della stessa marca; altrimenti annuncio di segmento", async () => {
  const cisco = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: true });
  assert.deepEqual(cisco.vicini.filter((v) => v.protocol !== "lldp").map((v) => [v.remoteDevice, v.protocol]), [["SW-B", "cdp"], ["AP-3", "mndp"]]);
  const altra = await leggiSnmpTopologia(walkFinto().walk, { lettoreCisco: false });
  assert.deepEqual(altra.vicini.filter((v) => v.protocol !== "lldp").map((v) => v.protocol), ["mndp", "mndp"]);
});

test("una tabella che non risponde non ferma le altre", async () => {
  const l = await leggiSnmpTopologia(walkFinto([REM]).walk, { lettoreCisco: true });
  assert.deepEqual([l.letture, l.riuscite, l.codice], [10, 9, "TEMPO_SCADUTO"]);
  assert.equal(l.vicini.filter((v) => v.protocol === "lldp").length, 0);
  assert.ok(l.porte.length > 0);
});
```

`src/lib/cron/__tests__/arp-letture-snmp.test.ts`:

```ts
// I33 per SNMP (spec §13.5.4, §13.12.3): con la lettura spenta il giro degli switch non manda nessuna richiesta nuova (spia
// sulla funzione di walk); accesa, legge solo gli switch che non sono del controller, una volta l'ora.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, rileggiSchemaCavi, withTenant } from "@/lib/db-tenant";
import { runArpPoll } from "@/lib/cron/jobs";
import type { SwitchClient } from "@/lib/devices/switch-client";
import type { SnmpWalkFn } from "@/lib/devices/snmp-walk";
import { leggiEsiti, scriviInterruttore } from "@/lib/topology/letture/interruttori";

const T = "TESTARPLETTURESNMP";
const db = () => getTenantDb(T);
beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM device_neighbors; DELETE FROM network_devices; DELETE FROM networks;
    DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.%';`);
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, enabled, use_for_arp_poll, community_string) "
    + "VALUES (5, 'SW-5', '192.0.2.5', 'switch', 'cisco', 'snmp_v2', 1, 0, 'public'), (6, 'SW-6', '192.0.2.6', 'switch', 'ubiquiti', 'snmp_v2', 1, 0, 'public')");
  db().exec("UPDATE network_devices SET controller_mac = '02:00:00:00:00:06' WHERE id = 6");
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const switchFinto = async (): Promise<SwitchClient> => ({ async getMacTable() { return []; }, async getPortSchema() { return []; }, async testConnection() { return true; } });
function spia() {
  const apparati: number[] = [];
  const crea = async (device: { id: number }): Promise<SnmpWalkFn> => { apparati.push(device.id); return async () => []; };
  return { crea, apparati };
}
const giro = (s: ReturnType<typeof spia>, ora: Date) =>
  withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientSwitch: switchFinto, creaWalkSnmp: s.crea, adesso: () => ora }));

test("spenta: nessuna richiesta SNMP nuova", async () => {
  const s = spia();
  await giro(s, new Date("2026-10-15T08:00:00Z"));
  assert.deepEqual(s.apparati, []);
});

test("accesa: solo lo switch che non è del controller; un'ora dopo di nuovo, mezz'ora dopo no", async () => {
  withTenant(T, () => scriviInterruttore("snmp", true, "admin"));
  const s = spia();
  await giro(s, new Date("2026-10-15T08:00:00Z"));
  await giro(s, new Date("2026-10-15T08:30:00Z"));
  await giro(s, new Date("2026-10-15T09:01:00Z"));
  assert.deepEqual(s.apparati, [5, 5]);
  assert.deepEqual(Object.keys(withTenant(T, () => leggiEsiti("snmp"))), ["5"]);
});
```

```bash
for f in src/lib/devices/__tests__/snmp-walk.test.ts src/lib/devices/__tests__/snmp-topologia.test.ts src/lib/cron/__tests__/arp-letture-snmp.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t6-rosso-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
```

  Atteso: tre `exit=1`.

- [ ] **Step 2: una sessione per lettura** — `src/lib/devices/snmp-walk.ts`:

```ts
/**
 * Una sessione SNMP per ogni lettura (spec topologia §13.5.4, SN1). La lettura a mano dello spanning tree apriva UNA
 * sessione e la chiudeva alla fine del primo walk: gli altri, partiti insieme, finivano annullati e davano «nessun valore»
 * (query/route.ts, networks/bulk-scan-devices/route.ts). Qui ogni walk apre la sua e la chiude alla fine; un walk che non
 * risponde entro il suo tempo dà `TEMPO_SCADUTO` e chiude solo la sua. Le sessioni le apre chi chiama, da
 * `snmp-sessione.ts` (ADR 0016).
 */
import { CODICE_TEMPO_SCADUTO } from "@/lib/devices/ssh-transport";

export type VoceSnmp = { oid: string; value: Buffer | string | number };
export type SnmpWalkFn = (oid: string) => Promise<VoceSnmp[]>;

/** Ciò che serve di una sessione net-snmp. */
export interface SessioneWalk {
  subtree(oid: string, feed: (vbs: Array<{ oid: string; value: unknown }>) => void, done: (err?: Error) => void): void;
  close(): void;
}

/** Il tempo massimo di una lettura nuova (spec §13.5.1). */
export const TEMPO_WALK_MS = 10_000;

export function walkConSessioneSua(apri: () => SessioneWalk, tempoMs: number): SnmpWalkFn {
  return (oid) => new Promise<VoceSnmp[]>((resolve, reject) => {
    let s: SessioneWalk;
    try {
      s = apri();
    } catch (e) {
      reject(e);
      return;
    }
    const out: VoceSnmp[] = [];
    let finito = false;
    const chiudi = (): void => {
      try { s.close(); } catch { /* già chiusa */ }
    };
    const timer = setTimeout(() => {
      if (finito) return;
      finito = true;
      chiudi();
      reject(Object.assign(new Error(`nessuna risposta entro ${tempoMs} ms`), { code: CODICE_TEMPO_SCADUTO }));
    }, tempoMs);
    s.subtree(oid, (vbs) => {
      for (const vb of vbs) out.push({ oid: vb.oid, value: vb.value as VoceSnmp["value"] });
    }, (err) => {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      chiudi();
      if (err) reject(err);
      else resolve(out);
    });
  });
}
```

- [ ] **Step 3: SN1 nei due chiamanti** — in `src/app/api/devices/[id]/query/route.ts`, il blocco «STP via SNMP» perde
  `sessionClosed`, `safeClose` e la funzione `snmpWalk` locale; al loro posto:

```ts
    const snmpWalk = walkConSessioneSua(
      () => apriSessioneCommunity(snmpMod, device.host, community, { port: 161, timeout: 5000, versione: versioneApparato(device, "1") }) as unknown as SessioneWalk,
      10_000,
    );
```

  (con `import { walkConSessioneSua, type SessioneWalk } from "@/lib/devices/snmp-walk";`; `getSnmpStpInfo` prende
  `null` per ogni lettura non riuscita, come prima). Lo stesso in `src/app/api/networks/bulk-scan-devices/route.ts`: la
  sessione unica e la funzione `snmpWalk` diventano `walkConSessioneSua(() => apriSessioneCommunity(snmpMod, device.host,
  community, { port: 161, timeout: 8000, versione: versioneApparato(device, "1") }) as unknown as SessioneWalk, 10_000)`.
  `switch-client.ts` apre già una sessione per walk: lo controlla la stessa prova, perché `creaWalkSnmp` (sotto) passa da
  `walkConSessioneSua`.

- [ ] **Step 4: la sessione dell'apparato e il walk** — in `src/lib/devices/switch-client.ts`:
  - `function deviceHasSnmpSession` diventa `export function deviceHasSnmpSession`;
  - il corpo di `createSession` dentro `createSnmpSwitchClient` si sposta in una funzione esportata, e `createSession`
    diventa `() => apriSessioneSnmpApparato(snmp, device)`:

```ts
/** La sessione SNMP di un apparato come la apre la lettura degli switch: v3 se configurato; a community con la versione dell'apparato (NULL = v1, come prima). */
export function apriSessioneSnmpApparato(snmp: typeof import("net-snmp"), device: NetworkDevice) {
  const isSnmpProtocol = device.protocol === "snmp_v2" || device.protocol === "snmp_v3";
  // device.port può essere la porta SSH (22) quando il device ha credenziali miste SSH+SNMP.
  const rawPort = device.port || 0;
  const snmpPort = isSnmpProtocol && rawPort > 0 && rawPort !== 22 ? rawPort : 161;
  const opts = { port: snmpPort, timeout: 10000 };
  if (device.protocol === "snmp_v3") {
    const v3 = getDeviceSnmpV3Credentials(device);
    if (v3) {
      const user = { name: v3.username, level: snmp.SecurityLevel.authNoPriv, authProtocol: snmp.AuthProtocols.md5, authKey: v3.authKey };
      return snmp.createV3Session(device.host, user, opts);
    }
  }
  return apriSessioneCommunity(snmp, device.host, getDeviceCommunityString(device), { ...opts, versione: versioneApparato(device, "1") });
}

/** Il walk SNMP delle letture in più (spec §13.5.4): una sessione per lettura (SN1), un tempo massimo per lettura. */
export async function creaWalkSnmp(device: NetworkDevice, tempoMs: number = TEMPO_WALK_MS): Promise<SnmpWalkFn> {
  const snmp = await import("net-snmp");
  return walkConSessioneSua(() => apriSessioneSnmpApparato(snmp, device) as unknown as SessioneWalk, tempoMs);
}
```

  con `import { TEMPO_WALK_MS, walkConSessioneSua, type SessioneWalk, type SnmpWalkFn } from "./snmp-walk";`. La prova
  di oggi che vieta `createSession(` fuori da `snmp-sessione.ts` resta verde (`createV3Session` non è `createSession`).

- [ ] **Step 5: il lettore** — `src/lib/devices/snmp-topologia.ts`:

```ts
/**
 * Le letture SNMP per la mappa per cavo (spec topologia §13.5.4, SN2-SN9) negli switch che non sono del controller,
 * dietro `topologia.lettura.snmp`. Dieci letture, una per tabella, ognuna con la sua sessione (SN1). Le forme sono quelle
 * delle MIB standard (IF-MIB, BRIDGE-MIB, RSTP-MIB, IEEE8021-MSTP-MIB, LLDP-MIB, LAG-MIB) e della CISCO-CDP-MIB:
 * DEDOTTE DALLE MIB, NON OSSERVATE su un apparato. L'indipendenza dal prodotto si scrive in un ADR solo dopo una lettura
 * SNMP vera. Fatti con le parole dello standard; lo stato di una porta solo dove la porta del bridge si traduce in un
 * ifIndex (SN4: niente ripiego «porta del bridge = ifIndex»). Logica pura sulla funzione di walk.
 */
import type { FattiLettura, FattoBridgeIn, FattoPortaIn, MacApparatoIn } from "@/lib/db-tenant";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import type { SnmpWalkFn, VoceSnmp } from "@/lib/devices/snmp-walk";

/** Le dieci tabelle, in ordine di lettura. */
export const TABELLE_SNMP = {
  interfacce: "1.3.6.1.2.1.2.2.1", nomi: "1.3.6.1.2.1.31.1.1.1.1", base: "1.3.6.1.2.1.17.1", stp: "1.3.6.1.2.1.17.2",
  lldpLocali: "1.0.8802.1.1.2.1.3.7.1", lldpRemoti: "1.0.8802.1.1.2.1.4.1.1", lldpIndirizzi: "1.0.8802.1.1.2.1.4.2.1",
  cdp: "1.3.6.1.4.1.9.9.23.1.2.1.1", fasci: "1.2.840.10006.300.43.1.2.1.1", mstpRuoli: "1.3.111.2.802.1.1.6.1.3.1.14",
} as const;

export type VicinoSnmp = {
  localPort: string; remoteDevice: string; remotePort: string; protocol: "lldp" | "cdp" | "mndp";
  remoteIp?: string; remoteMac?: string; remotePlatform?: string; localPortIndex?: number | null; remoteCaps?: string | null;
};
export interface LetturaSnmp extends FattiLettura {
  porte: FattoPortaIn[]; bridge: FattoBridgeIn[]; macs: MacApparatoIn[];
  vicini: VicinoSnmp[]; letture: number; riuscite: number; codice: string | null;
}

const TIPO_IF: Readonly<Record<number, string>> = { 6: "physical", 161: "lag", 135: "vlan", 136: "vlan", 131: "tunnel", 209: "bridge", 71: "wireless" };
const STATO_PORTA: Readonly<Record<number, string>> = { 1: "disabled", 2: "discarding", 3: "discarding", 4: "learning", 5: "forwarding" };
const RUOLO_CIST: Readonly<Record<number, string>> = { 1: "root", 2: "alternate", 3: "designated", 4: "backup" };
const VERSIONE: Readonly<Record<number, string>> = { 0: "stp", 2: "rstp", 3: "mstp" };
const CAPACITA = ["other", "repeater", "bridge", "wlan-ap", "router", "telephone", "docsis", "station"];

const testo = (v: unknown): string => (Buffer.isBuffer(v) ? v.toString("utf8").replace(/\0+$/, "") : String(v ?? "")).trim();
const numero = (v: unknown): number | null => (typeof v === "number" ? v : /^\d+$/.test(testo(v)) ? Number(testo(v)) : null);
const esa = (b: number): string => b.toString(16).padStart(2, "0");
function macDi(v: unknown): string | null {
  return Buffer.isBuffer(v) && v.length === 6 && !v.every((b) => b === 0) ? [...v].map(esa).join(":").toUpperCase() : null;
}
/** Un BridgeId di 8 ottetti nella forma «priorità.mac» (come `bridgeIdNormale` dei MikroTik). */
function bridgeIdDi(v: unknown): string | null {
  return Buffer.isBuffer(v) && v.length >= 8 ? `${v.readUInt16BE(0)}.${[...v.subarray(2, 8)].map(esa).join(":")}` : null;
}
/** La porta designata (2 ottetti: priorità, numero) nella forma di RouterOS, «0x80.N». */
function portaIdDi(v: unknown): string | null {
  return Buffer.isBuffer(v) && v.length === 2 ? `0x${esa(v[0])}.${v[1]}` : null;
}
function capacitaDi(v: unknown): string | null {
  if (!Buffer.isBuffer(v) || v.length === 0) return null;
  const c = CAPACITA.filter((_, i) => (v[0] & (0x80 >> i)) !== 0).sort();
  return c.length > 0 ? c.join(",") : null;
}

/** Le voci di una colonna di una tabella, per indice (il resto dell'OID dopo la colonna). */
function colonna(voci: VoceSnmp[] | null, base: string, col: number): Map<string, VoceSnmp["value"]> {
  const pre = `${base}.${col}.`;
  return new Map((voci ?? []).filter((v) => v.oid.startsWith(pre)).map((v) => [v.oid.slice(pre.length), v.value]));
}

export async function leggiSnmpTopologia(walk: SnmpWalkFn, opz: { lettoreCisco: boolean }): Promise<LetturaSnmp> {
  let letture = 0, riuscite = 0;
  let codice: string | null = null;
  const leggi = async (oid: string): Promise<VoceSnmp[] | null> => {
    letture++;
    try {
      const r = await walk(oid);
      riuscite++;
      return r;
    } catch (e) {
      codice ??= codiceErrore(e);
      return null;
    }
  };
  const S = TABELLE_SNMP;
  const ifT = await leggi(S.interfacce), nomiT = await leggi(S.nomi), baseT = await leggi(S.base), stpT = await leggi(S.stp);
  const locT = await leggi(S.lldpLocali), remT = await leggi(S.lldpRemoti), manT = await leggi(S.lldpIndirizzi);
  const cdpT = await leggi(S.cdp), lagT = await leggi(S.fasci), mstpT = await leggi(S.mstpRuoli);

  // IF-MIB (SN7): nome, tipo (mai dal nome), MAC, acceso.
  const descr = colonna(ifT, S.interfacce, 2), tipo = colonna(ifT, S.interfacce, 3), fis = colonna(ifT, S.interfacce, 6), oper = colonna(ifT, S.interfacce, 8);
  const nomi = new Map((nomiT ?? []).map((v) => [v.oid.slice(S.nomi.length + 1), v.value]));
  const nomeDi = (ifIndex: string): string => testo(nomi.get(ifIndex)) || testo(descr.get(ifIndex)) || `if${ifIndex}`;
  // BRIDGE-MIB: porta del bridge → ifIndex (SN3); senza traduzione, niente stato (SN4).
  const ifDellaPorta = new Map([...colonna(baseT, `${S.base}.4.1`, 2)].map(([bp, v]) => [bp, String(numero(v) ?? "")]).filter(([, i]) => i !== ""));
  const porteDelBridge = new Set(ifDellaPorta.values());
  const scalare = (col: number): VoceSnmp["value"] | undefined => colonna(stpT, S.stp, col).get("0");
  const statoDi = new Map<string, { stato: string | null; bridge: string | null; porta: string | null }>();
  const stati = colonna(stpT, `${S.stp}.15.1`, 3), desB = colonna(stpT, `${S.stp}.15.1`, 8), desP = colonna(stpT, `${S.stp}.15.1`, 9);
  for (const [bp, v] of stati) {
    const ifIndex = ifDellaPorta.get(bp);
    if (!ifIndex) continue;
    statoDi.set(ifIndex, { stato: STATO_PORTA[numero(v) ?? -1] ?? null, bridge: bridgeIdDi(desB.get(bp)), porta: portaIdDi(desP.get(bp)) });
  }
  // IEEE8021-MSTP-MIB (SN8): il ruolo nell'albero comune, indice «componente.porta del bridge».
  const ruoloDi = new Map<string, string>();
  for (const v of mstpT ?? []) {
    const bp = v.oid.slice(S.mstpRuoli.length + 1).split(".")[1];
    const ifIndex = bp ? ifDellaPorta.get(bp) : undefined;
    const r = RUOLO_CIST[numero(v.value) ?? -1];
    if (ifIndex && r) ruoloDi.set(ifIndex, r);
  }
  // LAG-MIB (SN7): fascio di cui la porta fa parte (ifIndex del fascio; 0 = nessuno) e partner LACP.
  const agg = colonna(lagT, S.fasci, 13), partner = colonna(lagT, S.fasci, 9);
  const porte: FattoPortaIn[] = [];
  const macs: MacApparatoIn[] = [];
  for (const [ifIndex, t] of tipo) {
    const n = numero(t);
    const a = numero(agg.get(ifIndex));
    const st = statoDi.get(ifIndex);
    const op = numero(oper.get(ifIndex));
    porte.push({
      port_key: `i:${ifIndex}`, port_name: nomeDi(ifIndex), port_index: Number(ifIndex), if_kind: n !== null ? (TIPO_IF[n] ?? "other") : null,
      running: op === 1 ? 1 : op === 2 ? 0 : null, in_bridge: baseT === null ? null : porteDelBridge.has(ifIndex) ? 1 : 0,
      lag_group: a !== null && a !== 0 && String(a) !== ifIndex ? `if:${a}` : null, lag_partner: macDi(partner.get(ifIndex)),
      stp_role: ruoloDi.get(ifIndex) ?? null, stp_state: st?.stato ?? null, designated_bridge: st?.bridge ?? null, designated_port: st?.porta ?? null,
    });
    const m = macDi(fis.get(ifIndex));
    if (m) macs.push({ mac: m, port_key: `i:${ifIndex}` });
  }
  // Il bridge (SN2, SN3): versione vera (RSTP-MIB dot1dStpVersion), radice, porta radice tradotta.
  const indirizzo = macDi(colonna(baseT, S.base, 1).get("0"));
  const prio = numero(scalare(2));
  const rp = numero(scalare(7));
  const bridge: FattoBridgeIn[] = stpT === null ? [] : [{
    bridge_name: "", instance: 0, protocol: VERSIONE[numero(scalare(16)) ?? -1] ?? null, priority: prio,
    bridge_id: indirizzo && prio !== null ? `${prio}.${indirizzo.toLowerCase()}` : null, root_id: bridgeIdDi(scalare(5)),
    root_port: rp === null || rp === 0 ? null : (ifDellaPorta.has(String(rp)) ? nomeDi(ifDellaPorta.get(String(rp))!) : `bridge-port:${rp}`),
    root_path_cost: numero(scalare(6)),
  }];
  if (indirizzo) macs.push({ mac: indirizzo, port_key: null });
  // LLDP-MIB (SN5): indice «timeMark.porta locale.remIndex»; la porta locale è il SECONDO pezzo, ed è la porta del bridge.
  const locNome = colonna(locT, S.lldpLocali, 3), locDescr = colonna(locT, S.lldpLocali, 4);
  const ifPerNome = new Map([...tipo.keys()].map((i) => [nomeDi(i).toLowerCase(), i]));
  const ipDi = new Map<string, string>();
  for (const v of manT ?? []) {
    const parti = v.oid.slice(`${S.lldpIndirizzi}.3.`.length).split(".");
    if (!v.oid.startsWith(`${S.lldpIndirizzi}.3.`) || parti.length < 9 || parti[3] !== "1" || parti[4] !== "4") continue;
    ipDi.set(parti.slice(0, 3).join("."), parti.slice(5, 9).join("."));
  }
  const vicini: VicinoSnmp[] = [];
  const sotto = colonna(remT, S.lldpRemoti, 4), telaio = colonna(remT, S.lldpRemoti, 5), sottoPorta = colonna(remT, S.lldpRemoti, 6);
  const portaRem = colonna(remT, S.lldpRemoti, 7), nomeRem = colonna(remT, S.lldpRemoti, 9), capRem = colonna(remT, S.lldpRemoti, 12);
  for (const [k, nome] of nomeRem) {
    const [, porta] = k.split(".");
    const ifIndex = ifDellaPorta.get(porta) ?? ifPerNome.get(testo(locNome.get(porta)).toLowerCase()) ?? ifPerNome.get(testo(locDescr.get(porta)).toLowerCase()) ?? null;
    const mac = numero(sotto.get(k)) === 4 ? macDi(telaio.get(k)) : null;
    const pr = portaRem.get(k);
    const remotePort = numero(sottoPorta.get(k)) === 3 ? (macDi(pr) ?? "") : testo(pr);
    vicini.push({
      localPort: ifIndex ? nomeDi(ifIndex) : (testo(locNome.get(porta)) || testo(locDescr.get(porta)) || `porta ${porta}`),
      localPortIndex: ifIndex ? Number(ifIndex) : null, remoteDevice: testo(nome) || mac || "", remotePort, protocol: "lldp",
      ...(mac ? { remoteMac: mac } : {}), ...(ipDi.has(k) ? { remoteIp: ipDi.get(k) } : {}), ...(capacitaDi(capRem.get(k)) ? { remoteCaps: capacitaDi(capRem.get(k)) } : {}),
    });
  }
  // CISCO-CDP-MIB (SN9): «cdp» (annuncio di collegamento) solo se chi legge e la piattaforma annunciata sono tutti e due
  // della marca che lo consuma (elenco chiuso: «cisco» nella piattaforma); altrimenti «mndp» (annuncio di segmento).
  const cdpId = colonna(cdpT, S.cdp, 6), cdpPorta = colonna(cdpT, S.cdp, 7), cdpPiatt = colonna(cdpT, S.cdp, 8), cdpInd = colonna(cdpT, S.cdp, 4);
  for (const [k, id] of cdpId) {
    const ifIndex = k.split(".")[0];
    const piatt = testo(cdpPiatt.get(k));
    const ind = cdpInd.get(k);
    vicini.push({
      localPort: nomeDi(ifIndex), localPortIndex: Number(ifIndex), remoteDevice: testo(id), remotePort: testo(cdpPorta.get(k)),
      protocol: opz.lettoreCisco && /cisco/i.test(piatt) ? "cdp" : "mndp",
      ...(piatt ? { remotePlatform: piatt } : {}), ...(Buffer.isBuffer(ind) && ind.length === 4 ? { remoteIp: [...ind].join(".") } : {}),
    });
  }
  return { porte, bridge, macs, vicini, letture, riuscite, codice };
}
```

- [ ] **Step 6: il giro degli switch** — in `src/lib/cron/jobs.ts`:
  - import: `import { createSwitchClient, creaWalkSnmp, deviceHasSnmpSession } from "@/lib/devices/switch-client";` (al posto
    dell'import di oggi), `import { leggiSnmpTopologia } from "@/lib/devices/snmp-topologia";`
  - in `RunArpPollOptions`:

```ts
  /** Solo per le prove: il walk SNMP delle letture in più al posto di quello vero (spia, I33). */
  creaWalkSnmp?: typeof creaWalkSnmp;
  /** Solo per le prove: il client dello switch al posto di quello vero. */
  creaClientSwitch?: typeof createSwitchClient;
```

  - accanto a `letturaMikrotik`:

```ts
/**
 * Le letture SNMP in più (spec topologia §13.5.4, SN2-SN9) di uno switch che non è del controller e non è un MikroTik letto
 * via SSH, dietro `topologia.lettura.snmp`, al più una volta l'ora. Chi legge «della marca che consuma il CDP»: il
 * fornitore dell'apparato o la sua descrizione SNMP (SN9).
 */
async function letturaSnmp(device: NetworkDevice, options?: RunArpPollOptions): Promise<EsitoGiro<unknown>> {
  return conCadenza("snmp", device.id, async () => {
    const walk = await (options?.creaWalkSnmp ?? creaWalkSnmp)(device);
    const l = await leggiSnmpTopologia(walk, { lettoreCisco: device.vendor === "cisco" || /cisco/i.test(device.sysdescr ?? "") });
    const scritti = scriviFattiTopologia(device.id, "snmp", l, options?.adesso?.() ?? new Date());
    if (l.vicini.length > 0) upsertNeighbors(device.id, l.vicini, "snmp");
    return { valore: scritti, conteggio: { comandi: l.letture, riusciti: l.riuscite, codice: l.codice } };
  }, options?.adesso);
}
```

  - nel ramo degli switch, subito dopo il blocco MikroTik del Task 4 e prima del client dello switch:

```ts
        // SN6: solo per gli switch senza controller (la chiave dei vicini non ha la fonte: due lettori della stessa riga si
        // scambierebbero la fonte) e non letti come MikroTik via SSH (hanno le loro letture).
        const delController = !!(device as NetworkDevice & { controller_mac?: string | null }).controller_mac;
        if (!delController && !(device.vendor === "mikrotik" && device.protocol === "ssh") && deviceHasSnmpSession(device)) {
          esitiLetture.push(await letturaSnmp(device, options));
        }
        const client = await (options?.creaClientSwitch ?? createSwitchClient)(device);
```

  (la riga `const client = await createSwitchClient(device);` di oggi diventa l'ultima qui sopra).

- [ ] **Step 7: verde, e le prove di oggi** —

```bash
for f in src/lib/devices/__tests__/snmp-walk.test.ts src/lib/devices/__tests__/snmp-topologia.test.ts src/lib/cron/__tests__/arp-letture-snmp.test.ts \
         src/lib/cron/__tests__/arp-letture-mikrotik.test.ts src/lib/cron/__tests__/arp-router-porte.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t6-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
rg -l "createSession|snmp-sessione|switch-client" src --glob '*.test.ts' | while read -r f; do node --import tsx --test "$f" > "$SCRATCH/t6-x-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
npx tsc --noEmit > "$SCRATCH/t6-tsc.log" 2>&1; echo "tsc exit=$?"
```

  Atteso: tutti `exit=0`.

- [ ] **Step 8: commit** — `git add src/lib/devices/snmp-walk.ts src/lib/devices/snmp-topologia.ts src/lib/devices/switch-client.ts
  "src/app/api/devices/[id]/query/route.ts" src/app/api/networks/bulk-scan-devices/route.ts src/lib/cron/jobs.ts
  src/lib/devices/__tests__/snmp-walk.test.ts src/lib/devices/__tests__/snmp-topologia.test.ts src/lib/cron/__tests__/arp-letture-snmp.test.ts`,
  `git commit -m "feat(topologia): SNMP, una sessione per lettura (SN1) e letture nuove negli switch, spente (T2.4)"`.

---
### Task 7: la lettura dal lato dell'host (T2.5) — solo dopo T2-b — livello completo, zona rossa

Spec §13.5.5 («La lettura dal lato dell'host», «Perché `-f json0` e `details`», «Che cosa si scrive», «Riserva del
bond»), prove I52 e I54. **Parte solo con l'uscita vera T2-b (P4)**: il parser si scrive sulla sua forma. Senza T2-b il
task non parte, `host` resta fuori da `LETTURE_DISPONIBILI` e la pagina lo dice («non disponibile in questa versione»).

**Scelta del piano, dichiarata.** Un apparato hypervisor può coprire più nodi di un cluster (host «a,b,c»): le righe di
un nodo si scrivono sull'apparato del nodo (`network_devices.host` uguale all'indirizzo del nodo) o, se l'apparato ha un
nodo solo, sull'apparato stesso; un nodo che non è censito come apparato non si scrive, e si conta nel resoconto. Così la
porta locale (la scheda) è sempre di un apparato solo.

**Files:**
- Create: `src/lib/proxmox/lldp-host.ts`
- Modify: `src/lib/proxmox/live-interfaces.ts` (`membriDeiBond`)
- Modify: `src/lib/cron/jobs.ts` (`runHypervisorSync`: la lettura dopo la scansione, dietro l'interruttore)
- Modify: `src/lib/topology/letture/interruttori.ts` (`LETTURE_DISPONIBILI` riceve `"host"`)
- Create: fixture `src/lib/proxmox/__tests__/fixtures/lldpcli-json0.json` e `ip-link-bond.json` (da T2-b, anonime)
- Test: `src/lib/proxmox/__tests__/lldp-host.test.ts`

**Interfaces:**
- Consumes: `execConTempo`, `withSshClient` (Task 2); `scriviFattiTopologia` (Task 1); `conCadenza`, `EsitoGiro` (Task 2);
  `parseLiveInterfaces`, `parseSpeedLines` (`live-interfaces.ts`); `resolveProxmoxTargetIps`, `proxmoxSshUsername`,
  `proxmoxSshPort` (`proxmox-targets.ts`); `getNetworkDeviceById`, `getNetworkDeviceByHost`, `getDeviceCredentials`,
  `getDeviceCredentialBindings` (`@/lib/db`); `normale` (`cavi/porte.ts`).
- Produces: `COMANDI_HOST`, `type VicinoHost`, `parseLldpcliJson0(testo: string): VicinoHost[]`,
  `fattiHost(ipLinkJson: unknown): FattiLettura`, `type ApriHost`, `leggiHost(deviceId: number, apri?: ApriHost, adesso?: () => Date): Promise<Array<EsitoGiro<unknown>>>`;
  `membriDeiBond(ipLinkJson: unknown): MembroBond[]`; `EsitoHypervisorSync.letture: string | null`.

- [ ] **Step 1: le fixture da T2-b.** Le due uscite del nodo di prova (P4) si rendono anonime **con la stessa forma** in
  `src/lib/proxmox/__tests__/fixtures/`: `lldpcli-json0.json` (nomi `SW-…`, MAC `02:00:B0:…`, indirizzi `10.0.0.N`,
  descrizioni e seriali inventati) e `ip-link-bond.json` (le schede di un bond attivo e di riserva; MAC `02:00:B1:…`).
  Prima di scrivere il parser si guardano e si scrivono nel resoconto, come fatti: la struttura di `json0` (atteso:
  `lldp[].interface[]` con `name`, `via`, `chassis[]` con `id[]{type,value}`, `name[]{value}`, `mgmt-ip[]{value}`,
  `capability[]{type,enabled}`, e `port[]` con `id[]{type,value}`, `descr[]{value}`); se lo stato del membro è
  `linkinfo.info_slave_data.state` (`ACTIVE`/`BACKUP`) e se il MAC permanente è `info_slave_data.perm_hwaddr` o `permaddr`
  (la spec lo dice «da verificare»). **Se la forma è diversa, il codice qui sotto si corregge sulla forma vera prima di
  andare avanti**, e il resoconto lo dice.

- [ ] **Step 2: le prove, viste fallire** — `src/lib/proxmox/__tests__/lldp-host.test.ts`:

```ts
// La lettura dal lato dell'host (spec topologia §13.5.5): `lldpcli` in un comando a parte, mai accodato al comando delle
// schede vive (I54: su un host senza lldpcli l'uscita 1 farebbe perdere le schede); solo LLDP diventa un vicino (I52:
// CDP, EDP, FDP e SONMP li rifiuterebbe il vincolo di protocol, e il giro intero dell'apparato fallirebbe); il membro di
// riserva di un bond e il suo MAC permanente.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { COMANDI_HOST, fattiHost, parseLldpcliJson0 } from "@/lib/proxmox/lldp-host";
import { membriDeiBond } from "@/lib/proxmox/live-interfaces";

const F = (n: string): string => fs.readFileSync(path.join(__dirname, "fixtures", n), "utf8");

test("json0 vero: ogni vicino via LLDP con la scheda, il nome, la porta e il telaio", () => {
  const v = parseLldpcliJson0(F("lldpcli-json0.json"));
  assert.ok(v.length > 0);
  for (const x of v) {
    assert.equal(x.protocol, "lldp");
    assert.ok(x.localPort !== "", "la scheda locale c'è");
    assert.ok(x.remoteDevice !== "" || x.remoteMac !== undefined, "un nome o un telaio");
  }
});

test("I52: le righe CDP, EDP, FDP e SONMP non diventano vicini", () => {
  const j = { lldp: [{ interface: [
    { name: "nic0", via: "LLDP", chassis: [{ id: [{ type: "mac", value: "02:00:b0:00:00:01" }], name: [{ value: "SW-1" }], capability: [{ type: "Bridge", enabled: true }] }], port: [{ id: [{ type: "ifname", value: "Port 3" }] }] },
    { name: "nic1", via: "CDPv2", chassis: [{ name: [{ value: "SW-2" }] }], port: [{ id: [{ type: "ifname", value: "Gi1/0/2" }] }] },
    { name: "nic2", via: "EDP", chassis: [{ name: [{ value: "SW-3" }] }], port: [{ id: [{ type: "ifname", value: "1:2" }] }] },
  ] }] };
  assert.deepEqual(parseLldpcliJson0(JSON.stringify(j)), [
    { localPort: "nic0", remoteDevice: "SW-1", remotePort: "Port 3", protocol: "lldp", remoteMac: "02:00:B0:00:00:01", remoteCaps: "bridge" },
  ]);
});

test("un'uscita che non è JSON è un errore col suo codice, non «nessun vicino»", () => {
  assert.throws(() => parseLldpcliJson0("lldpcli: command not found"), (e: unknown) => (e as { code?: string }).code === "JSON_ILLEGGIBILE");
});

test("bond: il membro attivo e quello di riserva, col MAC permanente", () => {
  const m = membriDeiBond(JSON.parse(F("ip-link-bond.json")) as unknown);
  assert.ok(m.some((x) => x.stato === "attivo"));
  assert.ok(m.some((x) => x.stato === "riserva"));
  assert.ok(m.every((x) => x.bond !== "" && (x.macPermanente === null || /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(x.macPermanente))));
  const f = fattiHost(JSON.parse(F("ip-link-bond.json")) as unknown);
  assert.ok(f.porte.some((p) => p.lag_state === "riserva" && p.lag_group !== null));
});

test("I54: i comandi sono tre, separati; nessuno è accodato al comando delle schede vive", () => {
  assert.deepEqual(Object.values(COMANDI_HOST), ["command -v lldpcli", "lldpcli -f json0 show neighbors details", "ip -d -j link show"]);
  for (const c of Object.values(COMANDI_HOST)) assert.equal(/;|&&|\|\|/.test(c), false, c);
});
```

```bash
node --import tsx --test src/lib/proxmox/__tests__/lldp-host.test.ts > "$SCRATCH/t7-rosso.log" 2>&1; echo "exit=$?"
```

  Atteso: `exit=1`.

- [ ] **Step 3: i membri dei bond** — in fondo a `src/lib/proxmox/live-interfaces.ts`:

```ts
/** Un membro di un bond (spec §13.5.5, «Riserva del bond»): stato letto e MAC permanente, con cui il firmware si annuncia agli switch. */
export interface MembroBond { nome: string; bond: string; stato: "attivo" | "riserva" | null; macPermanente: string | null }

/**
 * I membri dei bond da `ip -d -j link show`: `master` è il bond, `linkinfo.info_slave_kind` è `bond`,
 * `linkinfo.info_slave_data.state` vale `ACTIVE` o `BACKUP`; il MAC permanente sta in `info_slave_data.perm_hwaddr` o,
 * secondo la versione di iproute2, in `permaddr` (letto sull'uscita vera T2-b).
 */
export function membriDeiBond(ipLinkJson: unknown): MembroBond[] {
  if (!Array.isArray(ipLinkJson)) return [];
  const out: MembroBond[] = [];
  for (const item of ipLinkJson) {
    const o = asRecord(item);
    const info = asRecord(o?.linkinfo);
    if (!o || typeof o.ifname !== "string" || typeof o.master !== "string" || info?.info_slave_kind !== "bond") continue;
    const dati = asRecord(info.info_slave_data);
    const stato = dati?.state === "ACTIVE" ? "attivo" : dati?.state === "BACKUP" ? "riserva" : null;
    const perm = typeof dati?.perm_hwaddr === "string" ? dati.perm_hwaddr : typeof o.permaddr === "string" ? o.permaddr : null;
    out.push({ nome: o.ifname.trim(), bond: o.master, stato, macPermanente: normalizeMacForStorage(perm) });
  }
  return out;
}
```

- [ ] **Step 4: il lettore** — `src/lib/proxmox/lldp-host.ts`:

```ts
/**
 * La lettura dal lato dell'host (spec topologia §13.5.5, T2.5), dentro la lettura degli hypervisor, dietro
 * `topologia.lettura.host`: per ogni nodo, una connessione SSH e tre comandi a parte, ognuno col suo tempo massimo. Prima
 * `command -v lldpcli` (uscita 1 = «lldpd non installato», non un errore); poi `lldpcli -f json0 show neighbors details`
 * (json0: una struttura sola, ogni campo un elenco); poi `ip -d -j link show` per lo stato e il MAC permanente dei membri
 * dei bond. Solo le righe via LLDP diventano vicini (`lldp`, fonte `host`); le altre no (I52). Mai accodato a
 * LIVE_INTERFACES_COMMAND (I54). Sola lettura.
 */
import { getDeviceCredentialBindings, getDeviceCredentials, getNetworkDeviceByHost, getNetworkDeviceById } from "@/lib/db";
import { scriviFattiTopologia, upsertNeighbors, type FattiLettura, type FattoPortaIn, type MacApparatoIn } from "@/lib/db-tenant";
import { execConTempo, withSshClient, type SshOptions } from "@/lib/devices/ssh-transport";
import { membriDeiBond, parseLiveInterfaces } from "@/lib/proxmox/live-interfaces";
import { proxmoxSshPort, proxmoxSshUsername, resolveProxmoxTargetIps } from "@/lib/proxmox/proxmox-targets";
import { normale } from "@/lib/topology/cavi/porte";
import { conCadenza, type EsitoGiro } from "@/lib/topology/letture/cadenza";
import { normalizeMacForStorage } from "@/lib/utils";

export const COMANDI_HOST = {
  cerca: "command -v lldpcli",
  vicini: "lldpcli -f json0 show neighbors details",
  schede: "ip -d -j link show",
} as const;
const TEMPO_HOST_MS = 20_000;

export interface VicinoHost {
  localPort: string; remoteDevice: string; remotePort: string; protocol: "lldp";
  remoteMac?: string; remoteIp?: string; remoteCaps?: string;
}

const elenco = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const voce = (x: unknown): Record<string, unknown> => (x !== null && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const valore = (x: unknown): string => {
  const v = voce(elenco(x)[0]).value;
  return typeof v === "string" ? v.trim() : "";
};

export function parseLldpcliJson0(testo: string): VicinoHost[] {
  let j: unknown;
  try {
    j = JSON.parse(testo);
  } catch {
    throw Object.assign(new Error("uscita di lldpcli non leggibile"), { code: "JSON_ILLEGGIBILE" });
  }
  const out: VicinoHost[] = [];
  for (const l of elenco(voce(j).lldp)) {
    for (const i of elenco(voce(l).interface)) {
      const r = voce(i);
      if (String(r.via ?? "").toUpperCase() !== "LLDP") continue; // I52
      const ch = voce(elenco(r.chassis)[0]);
      const po = voce(elenco(r.port)[0]);
      const idCh = voce(elenco(ch.id)[0]);
      const idPo = voce(elenco(po.id)[0]);
      const mac = idCh.type === "mac" && typeof idCh.value === "string" ? normalizeMacForStorage(idCh.value) : null;
      const capacita = elenco(ch.capability).map(voce).filter((c) => c.enabled === true)
        .map((c) => String(c.type ?? "").toLowerCase()).filter((c) => c !== "").map((c) => (c === "wlan" ? "wlan-ap" : c)).sort();
      const ip = valore(ch["mgmt-ip"]);
      out.push({
        localPort: String(r.name ?? ""), remoteDevice: valore(ch.name) || mac || "",
        remotePort: typeof idPo.value === "string" && idPo.type !== "mac" ? idPo.value.trim() : valore(po.descr), protocol: "lldp",
        ...(mac ? { remoteMac: mac } : {}), ...(ip ? { remoteIp: ip } : {}), ...(capacita.length > 0 ? { remoteCaps: capacita.join(",") } : {}),
      });
    }
  }
  return out;
}

const TIPO_SCHEDA: Readonly<Record<string, string>> = { eth: "physical", bond: "lag", bridge: "bridge", vlan: "vlan", other: "other" };

/** I fatti delle schede di un nodo (fonte `host`): tipo, acceso, bond e stato del membro; i MAC permanenti fra i MAC dell'apparato. */
export function fattiHost(ipLinkJson: unknown): FattiLettura {
  const schede = parseLiveInterfaces(ipLinkJson, {});
  const membri = new Map(membriDeiBond(ipLinkJson).map((m) => [m.nome, m]));
  const porte: FattoPortaIn[] = schede.map((s) => {
    const m = membri.get(s.name);
    return {
      port_key: `n:${normale(s.name)}`, port_name: s.name, port_index: null, if_kind: TIPO_SCHEDA[s.kind] ?? "other",
      running: s.state === "up" ? 1 : s.state === "down" ? 0 : null,
      lag_group: m?.bond ?? (s.kind === "bond" ? s.name : null), lag_state: m?.stato ?? null,
    };
  });
  const macs: MacApparatoIn[] = [...membri.values()].flatMap((m) => (m.macPermanente ? [{ mac: m.macPermanente, port_key: `n:${normale(m.nome)}` }] : []));
  for (const s of schede) if (s.mac && s.kind === "eth") macs.push({ mac: s.mac, port_key: `n:${normale(s.name)}` });
  return { porte, bridge: [], macs };
}

export type ApriHost = <T>(opts: SshOptions, fn: (esegui: (cmd: string) => Promise<{ stdout: string; code: number }>) => Promise<T>) => Promise<T>;
const apriHostSsh: ApriHost = (opts, fn) => withSshClient(opts, (conn) => fn(async (cmd) => {
  const r = await execConTempo(conn, cmd, TEMPO_HOST_MS);
  return { stdout: r.stdout, code: r.code };
}));

/** Per ogni nodo dell'apparato, la lettura con la sua cadenza; un nodo non censito come apparato non si scrive (resoconto). */
export async function leggiHost(deviceId: number, apri: ApriHost = apriHostSsh, adesso?: () => Date): Promise<Array<EsitoGiro<unknown>>> {
  const device = getNetworkDeviceById(deviceId);
  const creds = device ? getDeviceCredentials(device) : null;
  if (!device || !creds) return [{ stato: "errore", esito: { il: new Date().toISOString().slice(0, 19).replace("T", " "), comandi: 0, riusciti: 0, codice: "SENZA_CREDENZIALI" } }];
  const nodi = resolveProxmoxTargetIps(device);
  const port = proxmoxSshPort(getDeviceCredentialBindings(device.id));
  const username = proxmoxSshUsername(creds.username);
  const esiti: Array<EsitoGiro<unknown>> = [];
  for (const ip of nodi) {
    const dev = nodi.length === 1 ? deviceId : (getNetworkDeviceByHost(ip)?.id ?? null);
    if (dev === null) {
      esiti.push({ stato: "errore", esito: { il: new Date().toISOString().slice(0, 19).replace("T", " "), comandi: 0, riusciti: 0, codice: "NODO_NON_CENSITO" } });
      continue;
    }
    esiti.push(await conCadenza("host", dev, async () => {
      let comandi = 0, riusciti = 0;
      const r = await apri({ host: ip, port, username, password: creds.password, timeout: 15_000 }, async (esegui) => {
        comandi++;
        const c = await esegui(COMANDI_HOST.cerca);
        riusciti++;
        let vicini: VicinoHost[] = [];
        if (c.code === 0 && c.stdout.trim() !== "") {
          comandi++;
          vicini = parseLldpcliJson0((await esegui(COMANDI_HOST.vicini)).stdout);
          riusciti++;
        }
        comandi++;
        const out = (await esegui(COMANDI_HOST.schede)).stdout;
        let schede: unknown;
        try {
          schede = JSON.parse(out);
        } catch {
          throw Object.assign(new Error("uscita di ip -j link non leggibile"), { code: "JSON_ILLEGGIBILE" });
        }
        riusciti++;
        return { vicini, schede };
      });
      const scritti = scriviFattiTopologia(dev, "host", fattiHost(r.schede), adesso?.() ?? new Date());
      if (r.vicini.length > 0) upsertNeighbors(dev, r.vicini, "host");
      return { valore: scritti, conteggio: { comandi, riusciti, codice: null } };
    }, adesso));
  }
  return esiti;
}
```

  (`getDeviceCredentials` restituisce `{ username, password }`: se nel codice di oggi la forma è un'altra, si usa quella di
  `runProxmoxDeviceScan`, righe 122-138.)

- [ ] **Step 5: nella lettura degli hypervisor** — in `src/lib/cron/jobs.ts`, `EsitoHypervisorSync` riceve
  `letture: string | null;`; `runHypervisorSync` riceve un secondo parametro `host: (deviceId: number) => Promise<Array<EsitoGiro<unknown>>> = (id) => leggiHost(id)`
  e, dopo `esito.letti++`:

```ts
      // T2 (spec §13.5.5): la lettura dal lato dell'host, dopo la scansione e in comandi a parte (I54), dietro
      // `topologia.lettura.host`. Un suo errore va nel resoconto e non tocca la scansione.
      if (letturaAccesa("host")) esitiHost.push(...await host(d.id));
```

  con `const esitiHost: Array<EsitoGiro<unknown>> = [];` in testa e, in fondo, `esito.letture = riassuntoLetture(esitiHost);`
  (l'oggetto `esito` nasce con `letture: null`). Nel `case "hypervisor_sync"` di `runJob`, se `r.letture` c'è, il
  `motivo` dell'esito lo aggiunge in coda. `LETTURE_DISPONIBILI` in `interruttori.ts` riceve `"host"`.

- [ ] **Step 6: verde** — `node --import tsx --test src/lib/proxmox/__tests__/lldp-host.test.ts`, le prove di oggi di
  `src/lib/proxmox/__tests__/` e di `runHypervisorSync` (`rg -l runHypervisorSync src --glob '*.test.ts'`), `npx tsc
  --noEmit`: tutti `exit=0`. In più, sul nodo di prova e con l'ok di Riccardo, **una** lettura vera a mano con
  `leggiHost` su una copia del DB dell'hub (script di una riga dallo scratchpad, credenziali da stdin): le righe scritte
  per tabella e il tempo, nel resoconto.

- [ ] **Step 7: commit** — `git add src/lib/proxmox/lldp-host.ts src/lib/proxmox/live-interfaces.ts src/lib/cron/jobs.ts
  src/lib/topology/letture/interruttori.ts src/lib/proxmox/__tests__/`,
  `git commit -m "feat(topologia): lettura LLDP e bond dal lato dell'host, spenta di default (T2.5)"`.

---

### Task 3b: le istanze MSTP (MK7) — solo dopo T2-a

Spec §13.5.2 (MK7: «solo se MK3 dice `protocol-mode=mstp`»; «Istanze MSTP»: il ripiego è la porta radice di ogni
istanza, e una porta di cui non si sa lo stato per istanza si scrive «stato per istanza non letto», mai «inoltra»).
**Parte solo con le uscite vere T2-a (P3).** Le forme sono quelle generali di RouterOS (`print terse` e tabella di
`monitor`), lette coi lettori del Task 3; i nomi dei campi vengono dalla tabella MK7 della spec (`identifier`,
`vlan-mapping`, `priority`; per istanza la radice regionale e `root-port`) e **si verificano sull'uscita vera** prima del
codice: se un campo ha un altro nome, si usa quello vero e il resoconto lo dice.

**Files:** Modify `src/lib/devices/mikrotik-stp.ts` (`parseMsti`, `parseMonitorMsti`, `fattiMikrotik` con le istanze),
`src/lib/devices/mikrotik-letture.ts` (MK7 se un bridge è `mstp`; `COMANDI_MK.msti`, `COMANDI_MK.monitorMsti`); fixture
`mikrotik-mk7-msti.txt`, `mikrotik-mk7-monitor.txt`, `mikrotik-mk3-mstp.txt`, `mikrotik-mk5-mstp.txt` (da T2-a, anonime
come quelle del Task 3: regione inventata, VLAN inventate); prove in fondo a `mikrotik-stp.test.ts` e a `arp-letture-mikrotik.test.ts`.

- [ ] **Step 1: fixture e prove viste fallire.** Prove: MK3 in MSTP dà `modo: "mstp"`, `regione` e `revisione`; MK5 dà
  `radiceRegionaleId` e `digest`; `parseMsti` dà un'istanza per riga con `identificatore` intero e `vlan` non vuoto;
  `parseMonitorMsti` una colonna per istanza, nell'ordine di `parseMsti`, con `portaRadice` che è un nome di MK4 oppure
  null; `fattiMikrotik` scrive un bridge per istanza (`instance` = identificatore, `vlans`, `root_port`); il giro manda
  MK7 **solo** quando un bridge è `mstp` (spia: le fixture di oggi in RSTP non lo mandano, `[[1, 6], [2, 8]]` resta).
- [ ] **Step 2: il codice**:

```ts
// in mikrotik-stp.ts
export interface IstanzaMk { bridge: string; identificatore: number; vlan: string; priorita: number | null }
export interface MonitorIstanzaMk { radiceRegionaleId: string | null; portaRadice: string | null }

/** `/interface bridge msti print terse without-paging`: una riga per istanza. Vuota senza MSTP (nessun errore, 14/10). */
export function parseMsti(out: string): IstanzaMk[] {
  const r: IstanzaMk[] = [];
  for (const riga of righeDiUscita(out)) {
    const c = campiTerse(riga);
    const id = intero(c.get("identifier"));
    const bridge = c.get("bridge");
    if (id === null || !bridge) continue;
    r.push({ bridge, identificatore: id, vlan: (c.get("vlan-mapping") ?? "").trim(), priorita: priorita(c.get("priority")) });
  }
  return r;
}

/** `/interface bridge msti monitor [find] once`: una colonna per istanza, nell'ordine di `parseMsti`. */
export function parseMonitorMsti(out: string): MonitorIstanzaMk[] {
  const t = tabellaMonitor(out);
  return Array.from({ length: t.colonne }, (_, i): MonitorIstanzaMk => {
    const rp = vuotoNull(cella(t, "root-port", i));
    return { radiceRegionaleId: bridgeIdNormale(cella(t, "regional-root-bridge-id", i)), portaRadice: rp === null || rp === "none" ? null : rp };
  });
}
```

  `LetturaMk` riceve `istanze: IstanzaMk[] | null; monitorIstanze: MonitorIstanzaMk[] | null;` (null nelle letture senza
  MSTP; le prove dei Task 3, 4 e 13 e `scripts/misura-cavi.ts --fatti-prova` che costruiscono un `LetturaMk` ricevono
  `istanze: null, monitorIstanze: null`), e `fattiMikrotik` aggiunge, per ogni istanza i, `{ bridge_name: ist.bridge, instance: ist.identificatore,
  protocol: "mstp", priority: ist.priorita, regional_root_id: mon?.radiceRegionaleId ?? null, vlans: ist.vlan || null,
  root_port: mon?.portaRadice ?? null }` (con `mon = l.monitorIstanze?.[i]`). In `leggiMikrotikTopologia`, dopo
  `monitorFasci`:

```ts
  // MK7 (spec §13.5.2): solo se un bridge è in MSTP, lo decide il codice fra un comando e l'altro.
  const mstp = (bridge ?? []).some((b) => b.modo === "mstp");
  const istanze = mstp ? await prova(COMANDI_MK.msti, parseMsti) : null;
  const monitorIstanze = mstp ? await prova(COMANDI_MK.monitorMsti, parseMonitorMsti) : null;
```

  con `msti: "/interface bridge msti print terse without-paging"`, `monitorMsti: "/interface bridge msti monitor [find] once"`
  in `COMANDI_MK`, e il `return` mette `istanze` e `monitorIstanze` nella `lettura`.
- [ ] **Step 3: verde** (le prove di `mikrotik-stp`, `arp-letture-mikrotik`, `tsc`), **commit**
  `feat(topologia): istanze MSTP dei MikroTik sulla forma vera (T2.2, MK7)`.

---

### Task 8: «Letture in più per la mappa» (T2.6)

Spec §13.5.6 (la sezione, una riga per lettura con che cosa legge in parole e coi comandi, «spenta» oppure «accesa da
‹utente› il ‹data›», l'ultima lettura e il suo esito dall'esito salvato, «Accendi»/«Spegni» solo per un amministratore,
il dialogo con la cadenza vera di quel cliente, la rotta `PUT /api/topology/settings/letture` con `requireAdmin` e Zod),
§13.5.7 («non disponibili: lo schema di questo cliente non è aggiornato»).

**Files:**
- Create: `src/lib/topology/letture/testi.ts`, `src/app/api/topology/settings/letture/route.ts`,
  `src/app/(dashboard)/topology/dati/letture-card.tsx`
- Modify: `src/lib/db-tenant.ts` (`cadenzaLetture`), `src/app/(dashboard)/topology/dati/dati-client.tsx` (la scheda dopo
  `HypervisorSyncCard`)
- Test: `src/lib/topology/letture/__tests__/testi.test.ts`

**Interfaces:**
- Consumes: `LETTURE`, `LETTURE_DISPONIBILI`, `leggiInterruttore`, `leggiEsiti`, `scriviInterruttore`, `StatoInterruttore`,
  `EsitoApparato` (Task 2); `schemaCaviPresente` (Task 1); `getNetworkDevices`; `actorOf`, `readJson`, `NO_STORE`;
  `FUSO_UTENTI`, `parseDbDate`.
- Produces: `cadenzaLetture(): { router: { minuti: number | null; daScansioni: boolean }; switch: number | null }`;
  `DESCRIZIONE_LETTURE`, `quandoItaliano(utc)`, `testoStato(s)`, `testoEsito(e)`, `righeEsito(esiti, nomeDi, max?)`,
  `frequenza(minuti, daScansioni)`, `testoDialogo(l, accendi, cadenza)`; `GET` e `PUT /api/topology/settings/letture`;
  `LettureCard`.

- [ ] **Step 1: le prove dei testi, viste fallire** — `src/lib/topology/letture/__tests__/testi.test.ts`:

```ts
// I testi di «Letture in più per la mappa» (spec §13.5.6): il dialogo dice che cosa succede con la cadenza vera di quel
// cliente (sulla rete B il router si legge ogni 15 minuti dalle scansioni veloci; sul cliente A ogni ora); gli orari in ora
// italiana; l'esito in parole («letta in parte: 6 comandi su 8»).
import { test } from "node:test";
import assert from "node:assert/strict";
import { frequenza, quandoItaliano, righeEsito, testoDialogo, testoEsito, testoStato } from "@/lib/topology/letture/testi";

test("il dialogo con la cadenza dell'hub e quella del cliente A, alla lettera della spec", () => {
  assert.equal(testoDialogo("mikrotik", true, { router: { minuti: 15, daScansioni: true }, switch: 60 }),
    "Accendere la lettura dello spanning tree sui MikroTik di questo cliente? Il router si legge ogni 15 minuti dalle scansioni veloci: le letture in più partono al più una volta l'ora, sei comandi in sola lettura su una connessione sola. La mappa non cambia finché non si accende la mappa nuova. Si spegne da qui.");
  assert.ok(testoDialogo("mikrotik", true, { router: { minuti: 60, daScansioni: false }, switch: 60 }).includes("Il router si legge ogni ora: "));
  assert.ok(testoDialogo("snmp", false, { router: { minuti: 60, daScansioni: false }, switch: 60 }).startsWith("Spegnere la lettura"));
});

test("frequenza in parole", () => {
  assert.equal(frequenza(15, true), "ogni 15 minuti dalle scansioni veloci");
  assert.equal(frequenza(60, false), "ogni ora");
  assert.equal(frequenza(180, false), "ogni 3 ore");
  assert.equal(frequenza(null, false), "solo quando lo chiede qualcuno (nessun giro programmato)");
});

test("stato e orari in ora italiana (UTC+2 fino al 25/10)", () => {
  assert.ok(quandoItaliano("2026-10-15 08:30:00").includes("10:30"));
  assert.equal(testoStato({ acceso: false, da: "admin", il: "2026-10-15 08:30:00" }), "spenta");
  assert.ok(testoStato({ acceso: true, da: "admin", il: "2026-10-15 08:30:00" }).startsWith("accesa da admin il "));
});

test("l'esito in parole, e un limite con «+ altri N»", () => {
  assert.equal(testoEsito({ il: "x", comandi: 6, riusciti: 6, codice: null }), "tutti i 6 comandi");
  assert.equal(testoEsito({ il: "x", comandi: 8, riusciti: 6, codice: "TEMPO_SCADUTO" }), "letta in parte: 6 comandi su 8 (TEMPO_SCADUTO)");
  assert.equal(testoEsito({ il: "x", comandi: 0, riusciti: 0, codice: "SENZA_CREDENZIALI" }), "non letta (SENZA_CREDENZIALI)");
  const esiti = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i + 1), { il: `2026-10-15 08:${String(i).padStart(2, "0")}:00`, comandi: 6, riusciti: 6, codice: null }]));
  const r = righeEsito(esiti, (id) => `SW-${id}`, 10);
  assert.equal(r.righe.length, 10);
  assert.equal(r.altri, 2);
  assert.ok(r.righe[0].startsWith("SW-12: letta il "), "le più recenti per prime");
});
```

  Atteso dopo la scrittura della prova: `exit=1`.

- [ ] **Step 2: i testi** — `src/lib/topology/letture/testi.ts`:

```ts
/**
 * I testi di «Letture in più per la mappa» (spec topologia §13.5.6), puri: che cosa legge ogni lettura (in parole e coi
 * comandi), lo stato, l'esito per apparato, il dialogo di accensione con la cadenza vera del cliente. Orari in ora italiana.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { EsitoApparato, Lettura, StatoInterruttore } from "./interruttori";

export const DESCRIZIONE_LETTURE: Readonly<Record<Lettura, { titolo: string; legge: string; comandi: string }>> = {
  mikrotik: {
    titolo: "Spanning tree, bridge e fasci dei MikroTik",
    legge: "Per ogni porta: nel bridge o instradata, ruolo e stato nello spanning tree, fascio e partner; i bridge e la radice; tutti i MAC dell'apparato. Sugli switch MikroTik anche i vicini.",
    comandi: "/interface bridge print · /interface bridge port print · /interface bridge monitor · /interface bridge port monitor · /interface bonding print e monitor (sola lettura, una connessione per apparato)",
  },
  controller: {
    titolo: "Campi del controller",
    legge: "L'indice delle porte nei vicini, la porta di uscita e da dove la ricava il controller, lo stato delle porte nello spanning tree, i fasci, tutti i MAC degli apparati.",
    comandi: "Nessuna chiamata nuova: campi della risposta che la lettura notturna degli apparati del controller riceve già.",
  },
  snmp: {
    titolo: "Spanning tree, LLDP e fasci via SNMP",
    legge: "Per gli switch che non sono del controller: tipo di ogni porta, stato e verso nello spanning tree, vicini LLDP e CDP, fasci e partner.",
    comandi: "Dieci letture in sola lettura: IF-MIB, BRIDGE-MIB, RSTP-MIB, LLDP-MIB, CISCO-CDP-MIB, LAG-MIB, IEEE8021-MSTP-MIB.",
  },
  host: {
    titolo: "LLDP e bond degli hypervisor",
    legge: "I vicini che ogni scheda dell'hypervisor vede (con lldpd installato), lo stato dei membri dei bond e il loro MAC permanente.",
    comandi: "command -v lldpcli · lldpcli -f json0 show neighbors details · ip -d -j link show (sola lettura, nella lettura notturna degli hypervisor)",
  },
};

export function quandoItaliano(utc: string | null): string {
  if (!utc) return "—";
  const d = parseDbDate(utc);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function testoStato(s: StatoInterruttore): string {
  return s.acceso ? `accesa da ${s.da ?? "utente non noto"} il ${quandoItaliano(s.il)}` : "spenta";
}

export function testoEsito(e: EsitoApparato): string {
  if (e.riusciti === 0 && e.comandi === 0) return `non letta (${e.codice ?? "errore"})`;
  if (e.riusciti >= e.comandi && e.codice === null) return e.comandi === 1 ? "letta" : `tutti i ${e.comandi} comandi`;
  return `letta in parte: ${e.riusciti} comandi su ${e.comandi}${e.codice ? ` (${e.codice})` : ""}`;
}

export function righeEsito(esiti: Readonly<Record<string, EsitoApparato>>, nomeDi: (id: number) => string, max = 10): { righe: string[]; altri: number } {
  const tutte = Object.entries(esiti).sort(([, a], [, b]) => (a.il < b.il ? 1 : a.il > b.il ? -1 : 0))
    .map(([id, e]) => `${nomeDi(Number(id))}: letta il ${quandoItaliano(e.il)} · ${testoEsito(e)}`);
  return { righe: tutte.slice(0, max), altri: Math.max(0, tutte.length - max) };
}

export function frequenza(minuti: number | null, daScansioni: boolean): string {
  if (minuti === null) return "solo quando lo chiede qualcuno (nessun giro programmato)";
  if (minuti < 60) return `ogni ${minuti} minuti${daScansioni ? " dalle scansioni veloci" : ""}`;
  if (minuti === 60) return "ogni ora";
  return minuti % 60 === 0 ? `ogni ${minuti / 60} ore` : `ogni ${minuti} minuti`;
}

const CHIUSA = "La mappa non cambia finché non si accende la mappa nuova. Si spegne da qui.";

export function testoDialogo(l: Lettura, accendi: boolean, c: { router: { minuti: number | null; daScansioni: boolean }; switch: number | null }): string {
  if (!accendi) return `Spegnere la lettura «${DESCRIZIONE_LETTURE[l].titolo}»? I dati già letti restano e invecchiano; la mappa non cambia.`;
  switch (l) {
    case "mikrotik":
      return `Accendere la lettura dello spanning tree sui MikroTik di questo cliente? Il router si legge ${frequenza(c.router.minuti, c.router.daScansioni)}: le letture in più partono al più una volta l'ora, sei comandi in sola lettura su una connessione sola. ${CHIUSA}`;
    case "controller":
      return `Accendere la lettura dei campi del controller? Nessuna chiamata nuova agli apparati: si salvano campi che la lettura notturna riceve già. ${CHIUSA}`;
    case "snmp":
      return `Accendere le letture SNMP per la mappa sugli switch che non sono del controller? Il giro degli switch parte ${frequenza(c.switch, false)}: le letture in più partono al più una volta l'ora per switch, dieci letture in sola lettura. ${CHIUSA}`;
    case "host":
      return `Accendere la lettura LLDP degli hypervisor? Si legge con la lettura notturna degli hypervisor, tre comandi in sola lettura per nodo. ${CHIUSA}`;
  }
}
```

- [ ] **Step 3: la cadenza vera** — in `src/lib/db-tenant.ts`, accanto a `getHypervisorSyncSchedule`:

```ts
/**
 * Ogni quanto si leggono router e switch (spec §13.5.6, il dialogo delle letture in più): il router lo leggono il giro
 * ARP e le scansioni delle reti (il più frequente fra i job accesi); gli switch solo il giro ARP. null = nessun job acceso.
 */
export function cadenzaLetture(): { router: { minuti: number | null; daScansioni: boolean }; switch: number | null } {
  const righe = db().prepare(`SELECT job_type, MIN(interval_minutes) AS m FROM scheduled_jobs
     WHERE enabled = 1 AND job_type IN ('arp_poll', 'fast_scan', 'ping_sweep', 'snmp_scan', 'nmap_scan') GROUP BY job_type`).all() as Array<{ job_type: string; m: number }>;
  const arp = righe.find((r) => r.job_type === "arp_poll")?.m ?? null;
  if (righe.length === 0) return { router: { minuti: null, daScansioni: false }, switch: null };
  const min = Math.min(...righe.map((r) => r.m));
  return { router: { minuti: min, daScansioni: righe.some((r) => r.m === min && r.job_type !== "arp_poll") }, switch: arp };
}
```

- [ ] **Step 4: la rotta** — `src/app/api/topology/settings/letture/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { cadenzaLetture, getNetworkDevices, schemaCaviPresente } from "@/lib/db-tenant";
import { actorOf, NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { LETTURE, LETTURE_DISPONIBILI, leggiEsiti, leggiInterruttore, scriviInterruttore } from "@/lib/topology/letture/interruttori";

/**
 * Letture in più per la mappa (spec topologia §13.5.6): GET lo stato di ogni lettura, l'esito per apparato, la cadenza
 * vera e se lo schema c'è; PUT `{ lettura, acceso }` le accende o le spegne, solo un amministratore. Spente di default.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAuth();
    if (isAuthError(s)) return s;
    try {
      const nomi = new Map(getNetworkDevices().map((d) => [d.id, d.name]));
      const letture = LETTURE.map((l) => ({
        lettura: l, disponibile: LETTURE_DISPONIBILI.has(l), stato: leggiInterruttore(l),
        esiti: Object.fromEntries(Object.entries(leggiEsiti(l))),
        nomi: Object.fromEntries(Object.keys(leggiEsiti(l)).map((id) => [id, nomi.get(Number(id)) ?? `apparato #${id}`])),
      }));
      return NextResponse.json({ letture, schema: schemaCaviPresente(), cadenza: cadenzaLetture() }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] letture in più, stato:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nella lettura dello stato delle letture in più" }, { status: 500 });
    }
  });
}

const Corpo = z.object({
  lettura: z.enum(LETTURE, { error: "Lettura sconosciuta" }),
  acceso: z.boolean({ error: "Indica se accendere (true) o spegnere (false)" }),
}).strict();

export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const parsed = Corpo.safeParse(await readJson(req));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
    const { lettura, acceso } = parsed.data;
    if (acceso && !LETTURE_DISPONIBILI.has(lettura)) {
      return NextResponse.json({ error: "Questa lettura non è disponibile in questa versione" }, { status: 400 });
    }
    if (acceso && !schemaCaviPresente()) {
      return NextResponse.json({ error: "Letture in più non disponibili: lo schema di questo cliente non è aggiornato" }, { status: 409 });
    }
    try {
      const stato = scriviInterruttore(lettura, acceso, actorOf(s) ?? "amministratore");
      return NextResponse.json({ lettura, stato }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] letture in più, scrittura:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel salvataggio della lettura" }, { status: 500 });
    }
  });
}
```

- [ ] **Step 5: la scheda** — `src/app/(dashboard)/topology/dati/letture-card.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { EsitoApparato, Lettura, StatoInterruttore } from "@/lib/topology/letture/interruttori";
import { DESCRIZIONE_LETTURE, righeEsito, testoDialogo, testoStato } from "@/lib/topology/letture/testi";

type Riga = { lettura: Lettura; disponibile: boolean; stato: StatoInterruttore; esiti: Record<string, EsitoApparato>; nomi: Record<string, string> };
type Stato = { letture: Riga[]; schema: boolean; cadenza: { router: { minuti: number | null; daScansioni: boolean }; switch: number | null } };

/**
 * «Letture in più per la mappa» (spec topologia §13.5.6): una riga per lettura, che cosa legge, accesa o spenta e da chi,
 * l'ultima lettura per apparato con l'esito, «Accendi»/«Spegni» solo per un amministratore, col dialogo che dice la
 * cadenza vera di questo cliente. Stato sempre in parole (mai il solo colore).
 */
export function LettureCard({ isAdmin }: { isAdmin: boolean }) {
  const [s, setS] = useState<Stato | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [chiedi, setChiedi] = useState<{ lettura: Lettura; accendi: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setErrore(null);
    const r = await fetchJson<Stato>("/api/topology/settings/letture", { cache: "no-store" });
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setS(r.data);
  }, []);
  useEffect(() => {
    void carica();
  }, [carica]);

  async function conferma() {
    if (!chiedi) return;
    setSalvando(true);
    const r = await fetchJson<{ stato: StatoInterruttore }>("/api/topology/settings/letture", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lettura: chiedi.lettura, acceso: chiedi.accendi }),
    });
    setSalvando(false);
    setEsito(r.ok ? `Salvato: ${DESCRIZIONE_LETTURE[chiedi.lettura].titolo} ${chiedi.accendi ? "accesa" : "spenta"}.` : `Non salvato: ${r.message}`);
    setChiedi(null);
    void carica();
  }

  return (
    <Card className="xl:col-span-2">
      <CardHeader><CardTitle>Letture in più per la mappa</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {errore ? (
          <LoadError what="lo stato delle letture in più" message={errore} onRetry={carica} />
        ) : !s ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : (
          <>
            <p className="text-sm">Spente di default. Accese, aggiungono letture in sola lettura; la mappa non cambia finché non si accende la mappa nuova.</p>
            {!s.schema && <p className="text-sm font-medium" role="status">Non disponibili: lo schema di questo cliente non è aggiornato.</p>}
            {!isAdmin && <p className="text-sm text-muted-foreground">Sola lettura: solo un amministratore accende o spegne una lettura.</p>}
            {s.letture.map((r) => {
              const d = DESCRIZIONE_LETTURE[r.lettura];
              const e = righeEsito(r.esiti, (id) => r.nomi[String(id)] ?? `apparato #${id}`, 10);
              return (
                <div key={r.lettura} className="rounded-md border p-3 space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{d.titolo}</p>
                    <p className="text-sm">{r.disponibile ? (r.stato.acceso ? "● " : "○ ") + testoStato(r.stato) : "non disponibile in questa versione"}</p>
                  </div>
                  <p className="text-sm">{d.legge}</p>
                  <p className="text-sm text-muted-foreground">{d.comandi}</p>
                  {e.righe.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nessuna lettura ancora.</p>
                  ) : (
                    <ul className="text-sm list-disc pl-5">
                      {e.righe.map((t) => <li key={t}>{t}</li>)}
                      {e.altri > 0 && <li>+ altri {e.altri}</li>}
                    </ul>
                  )}
                  {isAdmin && r.disponibile && (
                    <Button variant="outline" size="sm" disabled={salvando || (!s.schema && !r.stato.acceso)}
                      onClick={() => setChiedi({ lettura: r.lettura, accendi: !r.stato.acceso })}>
                      {r.stato.acceso ? "Spegni" : "Accendi"}
                    </Button>
                  )}
                </div>
              );
            })}
            {esito && <p className="text-sm text-muted-foreground" role="status">{esito}</p>}
          </>
        )}
      </CardContent>
      <Dialog open={chiedi !== null} onOpenChange={(o) => { if (!o) setChiedi(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{chiedi ? `${chiedi.accendi ? "Accendere" : "Spegnere"}: ${DESCRIZIONE_LETTURE[chiedi.lettura].titolo}` : ""}</DialogTitle>
            <DialogDescription>{chiedi && s ? testoDialogo(chiedi.lettura, chiedi.accendi, s.cadenza) : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChiedi(null)}>Annulla</Button>
            <Button onClick={() => void conferma()} disabled={salvando}>{chiedi?.accendi ? "Accendi" : "Spegni"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
```

  In `dati-client.tsx`: `import { LettureCard } from "./letture-card";` e `<LettureCard isAdmin={isAdmin} />` subito dopo
  `<HypervisorSyncCard isAdmin={isAdmin} />`. (I simboli «●»/«○» stanno sempre accanto alla parola «accesa»/«spenta».)

- [ ] **Step 6: verde** —

```bash
for f in src/lib/topology/letture/__tests__/testi.test.ts $(rg -l "permessi|rotte" src/lib/permessi --glob '*.test.ts'); do
  node --import tsx --test "$f" > "$SCRATCH/t8-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
npx tsc --noEmit > "$SCRATCH/t8-tsc.log" 2>&1; echo "tsc exit=$?"; npm run lint > "$SCRATCH/t8-lint.log" 2>&1; echo "lint exit=$?"
```

  Atteso: tutti `exit=0` (il censimento delle guardie vede la rotta nuova: GET con `requireAuth`, PUT con `requireAdmin`,
  i livelli attesi; niente da dichiarare in `ATTESI`). La pagina si guarda nel Task 15.

- [ ] **Step 7: commit** — `git add src/lib/topology/letture/testi.ts src/lib/topology/letture/__tests__/testi.test.ts src/lib/db-tenant.ts
  src/app/api/topology/settings/letture/route.ts "src/app/(dashboard)/topology/dati/letture-card.tsx" "src/app/(dashboard)/topology/dati/dati-client.tsx"`,
  `git commit -m "feat(topologia): «Letture in più per la mappa» e la rotta per accenderle (T2.6)"`.

---
## Parte 2 — Il modello per cavo in ombra e la traccia (T2.7)

Il modello per cavo si calcola **solo** per la traccia, a richiesta e in memoria (spec §13.11.3, «La traccia»): non si
salva, non entra in `GET /api/topology/model`, non cambia la mappa. È il modello della spec §13.7.2-13.7.6 e §13.8.3, con
cinque parti lasciate a T3 e dette dalla traccia stessa (`NON_CALCOLATO_IN_T2`, Task 11): «oltre» una radio non letta
(§13.7.6 punto 5), router e firewall in una VM dentro il loro hypervisor (§13.7.8), la regola dei collegamenti «dalle VM»
(§13.15 punto 4, da misurare in T3), l'ordine nuovo dell'abbinamento (§13.6.4, T3.6), le mappe passo passo (§13.7.7).
L'identità degli oggetti è quella del modello di T1 (stessi nodi, stessi id): così «padre oggi» e «padre con la mappa
nuova» si confrontano oggetto per oggetto. Le parole di `cavi/` non nominano prodotti né valori del DB che li nominano
(I37): commenti compresi, niente «MNDP», nomi di marca, «wlan», forme di porta.

### Task 9: l'ingresso e le prove neutre per porta (T2.7, prima parte)

Spec §13.4.3-13.4.4 (tipi di prova, campi), §13.5.7 («Chi legge che cosa»: le fonti nuove, le colonne nuove, i fatti
dell'ultimo giro, `topology_device_macs` e `device_interfaces` in una query a parte, l'elenco delle porte con la sua
precedenza), §13.6.1-13.6.2 (chiave della porta con l'indice del lettore; il tipo letto vince sul nome), §13.7.5 (un
tunnel dal tipo letto o dal nome di fabbrica), prove I44 (i fatti valgono solo dall'ultimo giro) e Casi da non
dimenticare 5.

**Files:**
- Create: `src/lib/topology/lettori/fonti.ts`, `src/lib/topology/cavi/prove.ts`
- Modify: `src/lib/topology/lettori/mikrotik.ts` (`MIKROTIK_TUNNEL`), `src/lib/topology/lettori/traduci.ts` (`eTunnelDiFabbrica`),
  `src/lib/db-tenant.ts` (`getIngressoCavi`)
- Create: `src/lib/topology/__tests__/support/cavi.ts` (costruttori di righe per le prove dei Task 9-13)
- Test: `src/lib/topology/__tests__/cavi-prove.test.ts`, `src/lib/__tests__/topology-cavi-ingresso.test.ts`

**Interfaces:**
- Consumes: `traduciPorta`, `haTraduttore`, `haTraduttoreRemoto`, `macDelTelaio` (lettori); `chiavePorta`, `elencoDa`,
  `elenchiPorte`, `normale`, `Porta`, `ElencoPorte` (`cavi/porte.ts`); `comeDi`, `portaLocale`, `righeUltimoGiro`
  (`links.ts`, esportate in T1, **non modificate**); `resolveNode`, `nameKey`, `NodeIndex`; `identifiesByName`,
  `isVirtualMac`, `realOui`; `schemaCaviPresente`, `getTopologyModelInput` (db-tenant).
- Produces (`lettori/fonti.ts`): `FONTE_CONTROLLER`, `lettoreDellaFonte(fonte): Lettore`, `classeDelProtocollo(p)`,
  `dettoDelProtocollo(p, discoveredBy)`, `eRadioDalleCapacita(capacita)`.
- Produces (`lettori/traduci.ts`): `eTunnelDiFabbrica(nome: string, come: ComeLetto): boolean`.
- Produces (`cavi/prove.ts`): `TipoProva`, `Lettore`, `Classe`, `Prova`, `ViciniCaviRow`, `FattoPorta`, `FattoBridge`,
  `IngressoCavi`, `IndiceFatti`, `indiceFatti(ing)`, `conFatti(p, fatti)`, `elenchiCavi(ing)`, `portaVuota(nodo)`,
  `piuRecente(xs)`, `ContestoProve`, `proveDaInput(ing, ctx, t1): Prova[]`.
- Produces (`db-tenant.ts`): `getIngressoCavi(staleDays: number, nowMs?: number): IngressoCavi`.

- [ ] **Step 1: i costruttori delle prove** — `src/lib/topology/__tests__/support/cavi.ts`:

```ts
// Costruttori per le prove del modello per cavo (piano di T2, Task 9-13): righe dei vicini con le colonne nuove, fatti di
// porta e di bridge con tutti i campi, l'ingresso del modello per cavo da un ingresso del modello di oggi.
import type { FattoBridge, FattoPorta, IngressoCavi, ViciniCaviRow } from "@/lib/topology/cavi/prove";
import type { ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";

export const ORA_T2 = "2026-10-13 11:00:00";

export function vic(r: Partial<ViciniCaviRow> & Pick<ViciniCaviRow, "device_id" | "local_port">): ViciniCaviRow {
  return {
    remote_device_name: "", remote_port: "", protocol: "lldp", remote_ip: null, remote_mac: null, remote_platform: null,
    timestamp: ORA_T2, source: "unifi", discovered_by: null, local_port_index: null, remote_port_index: null, remote_caps: null, ...r,
  };
}

export function daRiga(n: ModelNeighborRow): ViciniCaviRow {
  return { ...n, remote_platform: n.remote_platform ?? null, discovered_by: null, local_port_index: null, remote_port_index: null, remote_caps: null };
}

export function fp(device_id: number, port_key: string, port_name: string, over: Partial<FattoPorta> = {}): FattoPorta {
  return {
    device_id, source: "controller", port_key, port_name, port_index: port_key.startsWith("i:") ? Number(port_key.slice(2)) : null,
    if_kind: "physical", running: 1, in_bridge: null, bridge: null, lag_group: null, lag_partner: null, lag_state: null,
    stp_role: null, stp_state: null, designated_bridge: null, designated_port: null, path_cost: null, edge: null,
    point_to_point: null, sending_rstp: null, bpdu_rx: null, seen_at: ORA_T2, ...over,
  };
}

export function fb(device_id: number, over: Partial<FattoBridge> = {}): FattoBridge {
  return {
    device_id, source: "device", bridge_name: "", instance: 0, protocol: "rstp", priority: 32768, bridge_id: null, root_id: null,
    regional_root_id: null, region_name: null, region_revision: null, config_digest: null, vlans: null, root_port: null,
    root_path_cost: null, seen_at: ORA_T2, ...over,
  };
}

/** L'ingresso del modello per cavo: le righe di oggi più `vicini` (le fonti nuove), i fatti, i MAC, gli uplink per indice. */
export function ingresso(t1: TopologyModelInput, over: Partial<Omit<IngressoCavi, "t1">> = {}): IngressoCavi {
  const { vicini = [], ...resto } = over;
  return { t1, vicini: [...t1.neighbors.map(daRiga), ...vicini], fattiPorta: [], fattiBridge: [], macApparati: [], uplink: [], schema: true, ...resto };
}
```

- [ ] **Step 2: le prove, viste fallire** — `src/lib/topology/__tests__/cavi-prove.test.ts`:

```ts
// Le prove neutre per porta (spec topologia §13.4.4) dall'ingresso del modello per cavo: tutte le fonti, l'ultimo giro, la
// porta con l'indice del lettore, il tipo letto che vince sul nome, il tunnel, l'uplink del controller, il partner del fascio,
// l'elenco delle porte con la precedenza del §13.5.7. Righe e nomi inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { addNodeMacs, buildNodeIndex } from "@/lib/topology/node-index";
import { comeDi } from "@/lib/topology/links";
import { elenchiCavi, indiceFatti, proveDaInput, type IngressoCavi } from "@/lib/topology/cavi/prove";
import { baseInput, dev } from "./support/righe";
import { porte } from "./support/reti-campione";
import { fp, ingresso, vic } from "./support/cavi";

function prove(ing: IngressoCavi, macs: Record<string, string[]> = {}) {
  const idx = buildNodeIndex(ing.t1.devices, ing.t1.hosts, ing.t1.knownMacs, ing.t1.neighbors);
  for (const [n, m] of Object.entries(macs)) addNodeMacs(idx, n, m);
  return proveDaInput(ing, { idx, elenchi: elenchiCavi(ing), come: comeDi(ing.t1), fatti: indiceFatti(ing) }, buildTopologyModel(ing.t1));
}
const mk = { vendor: "mikrotik", via: "ssh" } as const;

test("tutte le fonti; la porta locale con l'indice del lettore (SNMP): «i:N»", () => {
  const t1 = baseInput({ devices: [dev(2, { vendor: "cisco", via: "snmp_v2" }), dev(3)] });
  const p = prove(ingresso(t1, { vicini: [vic({ device_id: 2, local_port: "Gi1/0/24", local_port_index: 10124, remote_device_name: "SW-3", remote_port: "Port 5", source: "snmp" })] }));
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].tipo, p[0].da.chiave, p[0].altro?.nodo, p[0].lettore, p[0].classe], ["cavo", "i:10124", "dev:3", "snmp", "annuncio_collegamento"]);
});

test("il tipo letto vince sul nome: un nome scelto con il tipo «physical» letto è una porta fisica (§13.6.1)", () => {
  const t1 = baseInput({ devices: [dev(1, { device_type: "router", ...mk }), dev(3)] });
  const senza = prove(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "uplink-core", remote_device_name: "SW-3", source: "device" })] }));
  assert.equal(senza[0].da.fisica, null, "senza lettura un nome scelto resta non noto");
  const con = prove(ingresso(t1, {
    vicini: [vic({ device_id: 1, local_port: "uplink-core", remote_device_name: "SW-3", source: "device" })],
    fattiPorta: [fp(1, "n:uplink-core", "uplink-core", { source: "device", in_bridge: 0 })],
  }));
  assert.deepEqual([con[0].da.fisica, con[0].da.nelBridge], [true, false]);
});

test("un tunnel: dal tipo letto, o dal nome di fabbrica; mai un cavo", () => {
  const t1 = baseInput({ devices: [dev(1, { device_type: "router", ...mk }), dev(2, { device_type: "router", ...mk })] });
  const letto = prove(ingresso(t1, {
    vicini: [vic({ device_id: 1, local_port: "verso-sede2", remote_device_name: "SW-2", protocol: "mndp", source: "device" })],
    fattiPorta: [fp(1, "n:verso-sede2", "verso-sede2", { source: "device", if_kind: "tunnel" })],
  }));
  assert.equal(letto[0].tipo, "tunnel");
  const fabbrica = prove(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "eoip-tunnel1", remote_device_name: "SW-2", protocol: "mndp", source: "device" })] }));
  assert.equal(fabbrica[0].tipo, "tunnel");
});

test("l'uplink del controller: una prova di verso dalla porta per indice; per un gateway la porta è la WAN", () => {
  const t1 = baseInput({
    devices: [
      dev(1, { device_type: "router", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00" }),
      dev(2, { controller_mac: "02:00:d0:00:02:00" }),
    ],
    ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"]]), ...porte(2, [[25, "SFP28 25", "25000 Mbps"]])],
  });
  const p = prove(ingresso(t1, { uplink: [{ device_id: 1, uplink_local_port_idx: 10, uplink_source: "lldp_uplink" }] })).filter((x) => x.classe === "uplink");
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].da.nodo, p[0].da.chiave, p[0].altro?.nodo, p[0].altro?.chiave, p[0].gateway, p[0].origine], ["dev:1", "i:10", "dev:2", "i:25", true, "lldp_uplink"]);
});

test("il partner LACP di un membro è una prova del fascio e del suo apparato (abbinato coi MAC)", () => {
  const t1 = baseInput({ devices: [dev(3, { device_type: "router", ...mk }), dev(9, { name: "NAS-1", device_type: "nas" })] });
  const p = prove(ingresso(t1, { fattiPorta: [fp(3, "n:sfp-sfpplus9", "sfp-sfpplus9", { source: "device", lag_group: "bond3", lag_partner: "02:00:A0:10:8C:14" })] }), { "dev:9": ["02:00:A0:10:8C:14"] });
  assert.deepEqual(p.map((x) => [x.classe, x.da.nodo, x.altro?.nodo, x.appartiene?.fascio]), [["fascio", "dev:3", "dev:9", "bond3"]]);
});

test("Casi da non dimenticare 5: l'elenco delle porte segue la precedenza controller, poi SNMP, poi switch_ports", () => {
  const t1 = baseInput({ devices: [dev(2)], ports: porte(2, [[1, "Port 1", "1000 Mbps"]]) });
  const e = elenchiCavi(ingresso(t1, {
    fattiPorta: [fp(2, "i:7", "SFP+ 7", { source: "snmp" }), fp(2, "i:9", "SFP+ 9", { source: "controller" })],
  }));
  assert.deepEqual([...(e.get("dev:2")?.perIndice.keys() ?? [])], [9], "il controller vince");
  const s = elenchiCavi(ingresso(t1, { fattiPorta: [fp(2, "i:7", "SFP+ 7", { source: "snmp" })] }));
  assert.deepEqual([...(s.get("dev:2")?.perIndice.keys() ?? [])], [7]);
  assert.deepEqual([...(elenchiCavi(ingresso(t1)).get("dev:2")?.perIndice.keys() ?? [])], [1]);
});

test("I37: le prove dicono chi ha letto con le parole neutre, mai la marca", () => {
  const t1 = baseInput({ devices: [dev(2), dev(3)] });
  const p = prove(ingresso(t1, { vicini: [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3" })] }));
  assert.equal(p[0].lettore, "controller");
});
```

  `src/lib/__tests__/topology-cavi-ingresso.test.ts`:

```ts
// L'ingresso del modello per cavo (spec §13.5.7, «Chi legge che cosa»): tutte le fonti dei vicini con le colonne nuove; i
// fatti dell'ultimo giro di ogni apparato e lettore (I44: una porta tolta dal bridge non è più nel bridge); i MAC dei
// lettori e le schede dell'inventario in una query a parte; senza schema, elenchi vuoti (mai un errore muto).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getIngressoCavi, getTenantDb, rileggiSchemaCavi, scriviFattiTopologia, upsertNeighbors, withTenant } from "@/lib/db-tenant";

const T = "TESTCAVIINGRESSO";
const db = () => getTenantDb(T);
beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs; DELETE FROM device_neighbors;
    DELETE FROM network_devices; DELETE FROM device_interfaces; DELETE FROM physical_devices;`);
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh'), (2, 'SW-2', '10.0.0.2', 'switch', 'cisco', 'snmp_v2')");
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("tutte le fonti dei vicini, con le colonne nuove; il modello di oggi solo le sue", () => {
  withTenant(T, () => {
    upsertNeighbors(2, [{ localPort: "Gi1/0/24", remoteDevice: "RTR-1", remotePort: "ether2", protocol: "lldp", localPortIndex: 10124 }], "snmp");
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Gi1/0/24", protocol: "lldp" }]);
  });
  const ing = withTenant(T, () => getIngressoCavi(2));
  assert.deepEqual(ing.vicini.map((v) => [v.source, v.local_port_index]).sort(), [["device", null], ["snmp", 10124]]);
  assert.equal(ing.t1.neighbors.length, 1);
  assert.equal(ing.schema, true);
});

test("I44: i fatti valgono solo dall'ultimo giro dello stesso apparato e lettore", () => {
  withTenant(T, () => {
    scriviFattiTopologia(1, "device", { porte: [{ port_key: "n:ether2", port_name: "ether2", in_bridge: 1 }, { port_key: "n:ether3", port_name: "ether3", in_bridge: 1 }], bridge: [], macs: [] }, new Date("2026-10-15T08:00:00Z"));
    scriviFattiTopologia(1, "device", { porte: [{ port_key: "n:ether2", port_name: "ether2", in_bridge: 0 }], bridge: [], macs: [] }, new Date("2026-10-15T09:00:00Z"));
  });
  const f = withTenant(T, () => getIngressoCavi(2)).fattiPorta;
  assert.deepEqual(f.map((x) => [x.port_key, x.in_bridge]), [["n:ether2", 0]], "ether3 non è più nell'ultimo giro; ether2 fuori dal bridge");
});

test("i MAC degli apparati: dai lettori e dalle schede dell'inventario (solo identità)", () => {
  db().exec("INSERT INTO physical_devices (id, primary_mac) VALUES (5, NULL)");
  db().exec("UPDATE network_devices SET physical_device_id = 5 WHERE id = 1");
  db().exec("INSERT INTO device_interfaces (physical_device_id, ifname, mac, is_virtual_mac) VALUES (5, 'eth1', '02:00:00:00:05:01', 0), (5, 'vrrp1', '00:00:5E:00:01:0A', 1)");
  withTenant(T, () => scriviFattiTopologia(1, "device", { porte: [], bridge: [], macs: [{ mac: "02:00:00:00:01:02", port_key: "n:ether2" }] }));
  const m = withTenant(T, () => getIngressoCavi(2)).macApparati;
  assert.deepEqual(m.map((x) => [x.device_id, x.mac]), [[1, "02:00:00:00:01:02"], [1, "02:00:00:00:05:01"]]);
});

test("senza schema: elenchi vuoti e `schema: false`, detto", () => {
  db().exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps");
  withTenant(T, () => rileggiSchemaCavi());
  const ing = withTenant(T, () => getIngressoCavi(2));
  assert.deepEqual([ing.schema, ing.fattiPorta.length, ing.macApparati.length], [false, 0, 0]);
  db().exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
});
```

  (Se `physical_devices` ha altre colonne `NOT NULL`, l'`INSERT` della terza prova le riceve con valori inventati: si
  guarda `db-tenant-schema.ts` prima di scriverlo.)

```bash
for f in src/lib/topology/__tests__/cavi-prove.test.ts src/lib/__tests__/topology-cavi-ingresso.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t9-rosso-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
```

  Atteso: `exit=1` per tutte e due.

- [ ] **Step 3: i valori del DB in fatti neutri** — `src/lib/topology/lettori/fonti.ts`:

```ts
/**
 * I valori delle colonne del DB in fatti neutri, per il modello per cavo (spec topologia §13.4.4: la logica di cavi/ non
 * nomina prodotti né i valori che li nominano, prova I37). Qui stanno le fonti dei vicini e dei fatti («device», «unifi»,
 * «ssh», «snmp», «host»; «controller» per i fatti) e i protocolli («lldp», «cdp», «mndp», «unknown») come li scrivono i
 * lettori, e le capacità annunciate che dicono «radio».
 */
import type { Classe, Lettore } from "@/lib/topology/cavi/prove";

/** La fonte con cui il controller scrive i vicini (device_neighbors.source). */
export const FONTE_CONTROLLER = "unifi";

export function lettoreDellaFonte(fonte: string): Lettore {
  switch (fonte) {
    case "unifi":
    case "controller":
      return "controller";
    case "snmp":
      return "snmp";
    case "host":
      return "host";
    case "manual":
      return "persona";
    default:
      return "apparato"; // device, ssh
  }
}

/**
 * La classe di un annuncio (spec §13.5.2): LLDP e CDP scritti come tali non attraversano un apparato gestito; «mndp» (che il
 * lettore di un MikroTik scrive anche per il CDP che attraversa gli switch, e SNMP per il CDP fra marche diverse) sì. Un
 * valore sconosciuto vale come LLDP, come nel modello di oggi (`unknown`).
 */
export function classeDelProtocollo(protocollo: string): Extract<Classe, "annuncio_collegamento" | "annuncio_segmento"> {
  return protocollo === "mndp" ? "annuncio_segmento" : "annuncio_collegamento";
}

/** Il protocollo in parole, per le frasi (mai per le regole): «discovered_by» dice quale, quando c'è (T2). */
export function dettoDelProtocollo(protocollo: string, discoveredBy: string | null): string {
  if (protocollo === "lldp" || protocollo === "unknown") return "LLDP";
  if (protocollo === "cdp") return "CDP";
  const elenco = (discoveredBy ?? "").split(",").map((s) => s.trim().toLowerCase()).filter((s) => s !== "");
  if (elenco.includes("cdp") && !elenco.includes("mndp")) return "CDP inoltrato";
  if (elenco.includes("mndp") && !elenco.includes("cdp")) return "MNDP";
  return "un annuncio di rete (MNDP o CDP)";
}

/** Le due radio di un ponte (spec §13.7.6, punto 3): capacità LLDP «WLAN» (o «station»), oppure «bridge» senza «router». */
export function eRadioDalleCapacita(capacita: string | null): boolean {
  const c = new Set((capacita ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x !== ""));
  return c.has("wlan-ap") || c.has("wlan") || c.has("station") || (c.has("bridge") && !c.has("router"));
}
```

  In `src/lib/topology/lettori/mikrotik.ts`, dopo `MIKROTIK_FISICA`:

```ts
/** I nomi di fabbrica dei tunnel di RouterOS (spec §13.7.5): senza il tipo letto, solo questi dicono «tunnel»; un nome scelto resta non noto. */
export const MIKROTIK_TUNNEL = /^(eoip-tunnel|gre-tunnel|ipip-tunnel|6to4-tunnel|wireguard|ovpn-out|ovpn-in|l2tp-out|l2tp-in|sstp-out|sstp-in|pptp-out|pptp-in)\d+$/;
```

  In `src/lib/topology/lettori/traduci.ts` (con `MIKROTIK_TUNNEL` nell'import da `./mikrotik`):

```ts
/** Un'interfaccia tunnel dal nome di fabbrica del prodotto (spec §13.7.5), quando il tipo non è letto. Lo sa solo il traduttore. */
export function eTunnelDiFabbrica(nome: string, come: ComeLetto): boolean {
  return lettoDaMikrotik(come) && MIKROTIK_TUNNEL.test(nome.trim());
}
```

- [ ] **Step 4: le prove** — `src/lib/topology/cavi/prove.ts`:

```ts
/**
 * Le prove neutre per porta del modello per cavo (spec topologia §13.4.3-13.4.4, §13.5.7 «Chi legge che cosa»; T2 in ombra,
 * T3 a schermo). I lettori scrivono fatti, i traduttori (lettori/) portano le forme dei nomi in fatti neutri, e qui le righe
 * dei vicini di TUTTE le fonti, gli uplink del controller, i partner dei fasci, la tabella MAC, le VM e le correzioni a mano
 * diventano prove con le parole dello standard. Nessun prodotto, nessuna forma di porta di un prodotto, nessun valore del DB
 * che nomina un prodotto (prova I37): quei valori passano da lettori/fonti.ts. Logica pura.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { identifiesByName, isVirtualMac, realOui } from "@/lib/topology/identity";
import { classeDelProtocollo, dettoDelProtocollo, FONTE_CONTROLLER, lettoreDellaFonte } from "@/lib/topology/lettori/fonti";
import { eTunnelDiFabbrica, haTraduttore, haTraduttoreRemoto, macDelTelaio, traduciPorta } from "@/lib/topology/lettori/traduci";
import { comeDi, portaLocale, righeUltimoGiro } from "@/lib/topology/links";
import type { MapLink, ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";
import { nameKey, resolveNode, type NodeIndex } from "@/lib/topology/node-index";
import { normalizeMacForStorage } from "@/lib/utils";
import { chiavePorta, elencoDa, elenchiPorte, normale, type ElencoPorte, type Porta } from "./porte";

export type { Porta };
export type TipoProva = "cavo" | "senza_fili" | "tunnel" | "segmento" | "stessa_rete" | "verso" | "stato" | "bordo" | "a_mano";
/** Chi ha letto, mai la marca. */
export type Lettore = "apparato" | "controller" | "snmp" | "host" | "persona";
/** Che cosa vale l'annuncio per la logica: «collegamento» non attraversa un apparato gestito, «segmento» sì. */
export type Classe = "annuncio_collegamento" | "annuncio_segmento" | "uplink" | "spanning_tree" | "fascio" | "tabella_mac" | "vm" | "a_mano";

export interface Prova {
  tipo: TipoProva;
  /** Chi osserva, sulla sua porta. */
  da: Porta;
  /** L'altro capo, se la prova lo dice (nodo abbinato; porta non nota = chiave null). */
  altro: Porta | null;
  /** L'apparato annunciato, anche se non si abbina a un nodo. */
  telaio: string | null;
  classe: Classe;
  /** Il protocollo in parole, scritto da lettori/fonti.ts («LLDP», «CDP», «un annuncio di rete»…): solo per le frasi, mai per le regole. */
  detto: string;
  lettore: Lettore;
  stato?: "inoltra" | "bloccata" | "instradata" | "riserva_bond" | "giu" | "spenta";
  ruolo?: "root" | "designated" | "alternate" | "backup" | "disabled";
  albero?: number;
  vlan?: number[];
  appartiene?: { bridge?: string; fascio?: string };
  /** Ultima lettura (UTC, come nel DB). */
  visto: string | null;
  /** In italiano: «Perché questo collegamento». */
  frase: string;
  /** Le capacità annunciate attive (T2): servono a riconoscere le due radio di un ponte (§13.7.6). */
  capacita?: string | null;
  /** La porta locale passa dal traduttore del suo prodotto (per le regole dei router, §13.7.1 passo 1). */
  traduttoreLocale?: boolean;
  /** L'apparato remoto annuncia da un'interfaccia senza fili (la radio lontana di un ponte, §13.7.6). */
  annunciaSenzaFili?: boolean;
  /** Uplink del controller: il figlio è un gateway (la porta è la sua WAN, §13.8.3 punto 1); da dove il controller lo ricava. */
  gateway?: boolean;
  origine?: string | null;
  /** Correzione a mano: confermata dai dati (come la verifica del modello di oggi). */
  confermato?: boolean;
  /** Prova dalle VM: quante VM accese passano dalla porta (§12.5, principale dell'hypervisor). */
  vm?: number;
}

export interface ViciniCaviRow extends ModelNeighborRow {
  remote_platform: string | null;
  discovered_by: string | null;
  local_port_index: number | null;
  remote_port_index: number | null;
  remote_caps: string | null;
}

export interface FattoPorta {
  device_id: number; source: string; port_key: string; port_name: string; port_index: number | null;
  if_kind: string | null; running: number | null; in_bridge: number | null; bridge: string | null;
  lag_group: string | null; lag_partner: string | null; lag_state: string | null;
  stp_role: string | null; stp_state: string | null; designated_bridge: string | null; designated_port: string | null;
  path_cost: number | null; edge: number | null; point_to_point: number | null; sending_rstp: number | null; bpdu_rx: number | null;
  seen_at: string;
}

export interface FattoBridge {
  device_id: number; source: string; bridge_name: string; instance: number; protocol: string | null; priority: number | null;
  bridge_id: string | null; root_id: string | null; regional_root_id: string | null; region_name: string | null;
  region_revision: number | null; config_digest: string | null; vlans: string | null; root_port: string | null;
  root_path_cost: number | null; seen_at: string;
}

/** L'ingresso del modello di oggi più ciò che legge solo il modello per cavo (spec §13.5.7, «Chi legge che cosa»). */
export interface IngressoCavi {
  t1: TopologyModelInput;
  /** Tutte le fonti, con le colonne nuove. */
  vicini: ViciniCaviRow[];
  /** Solo l'ultimo giro di ogni apparato e lettore. */
  fattiPorta: FattoPorta[];
  fattiBridge: FattoBridge[];
  /** `topology_device_macs` e le schede di `device_interfaces`: solo per l'identità. */
  macApparati: Array<{ device_id: number; mac: string; source: string }>;
  uplink: Array<{ device_id: number; uplink_local_port_idx: number | null; uplink_source: string | null }>;
  /** false = lo schema delle letture in più non c'è: gli elenchi sono vuoti, e la traccia lo dice. */
  schema: boolean;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
function metti<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const x = m.get(k);
  if (x) x.push(v);
  else m.set(k, [v]);
}
function tempo(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = parseDbDate(s).getTime();
  return Number.isNaN(t) ? null : t;
}
export function piuRecente(xs: ReadonlyArray<string | null>): string | null {
  return xs.reduce<string | null>((acc, s) => ((tempo(s) ?? -Infinity) > (tempo(acc) ?? -Infinity) ? s : acc), null);
}
function quando(utc: string | null): string {
  const t = tempo(utc);
  return t === null ? "in un momento non noto" : new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(t));
}

/** Una porta di cui si sa solo l'apparato. */
export function portaVuota(nodo: string): Porta {
  return { nodo, chiave: null, nome: "", certa: false, fisica: null, senzaFili: null, nelBridge: null };
}

export interface IndiceFatti {
  /** I fatti di una porta, di ogni lettore: per chiave e per nome normalizzato. */
  porta(nodo: string, p: Pick<Porta, "chiave" | "nome">): FattoPorta[];
  /** I bridge di un apparato. */
  bridge(nodo: string): FattoBridge[];
}

export function indiceFatti(ing: Pick<IngressoCavi, "fattiPorta" | "fattiBridge">): IndiceFatti {
  const perChiave = new Map<string, FattoPorta[]>(), perNome = new Map<string, FattoPorta[]>(), br = new Map<string, FattoBridge[]>();
  for (const f of ing.fattiPorta) {
    metti(perChiave, `dev:${f.device_id}|${f.port_key}`, f);
    metti(perNome, `dev:${f.device_id}|${normale(f.port_name)}`, f);
  }
  for (const b of ing.fattiBridge) metti(br, `dev:${b.device_id}`, b);
  return {
    porta: (nodo, p) => {
      const a = p.chiave ? (perChiave.get(`${nodo}|${p.chiave}`) ?? []) : [];
      const b = p.nome ? (perNome.get(`${nodo}|${normale(p.nome)}`) ?? []) : [];
      return [...new Set([...a, ...b])];
    },
    bridge: (nodo) => br.get(nodo) ?? [],
  };
}

const FISICI = new Set(["physical", "lag"]);
/** Il tipo letto vince sul nome (spec §13.6.1): fisica, logica o senza fili da `if_kind`; nel bridge da `in_bridge`. */
export function conFatti(p: Porta, fatti: readonly FattoPorta[]): Porta {
  const tipo = fatti.find((f) => f.if_kind !== null)?.if_kind ?? null;
  const ponte = fatti.find((f) => f.in_bridge !== null)?.in_bridge ?? null;
  if (tipo === null && ponte === null) return p;
  return {
    ...p,
    ...(tipo !== null ? { fisica: FISICI.has(tipo), senzaFili: tipo === "wireless" } : {}),
    ...(ponte !== null ? { nelBridge: ponte === 1 } : {}),
  };
}

/**
 * Gli elenchi delle porte con la precedenza del §13.5.7: per un apparato del controller l'elenco del controller (i fatti di
 * quel lettore, con l'indice); per gli altri quello del loro lettore (SNMP, con l'ifIndex); `switch_ports` solo dove non ce
 * n'è un altro (un'interrogazione a mano riscrive switch_ports fino alla lettura notturna, ADR 0008 punto 4).
 */
export function elenchiCavi(ing: Pick<IngressoCavi, "t1" | "fattiPorta">): Map<string, ElencoPorte> {
  const out = elenchiPorte(ing.t1.ports ?? []);
  const perLettore = new Map<string, Map<Lettore, Array<{ port_index: number; port_name: string }>>>();
  for (const f of ing.fattiPorta) {
    if (f.port_index === null) continue;
    const nodo = `dev:${f.device_id}`;
    const m = perLettore.get(nodo) ?? new Map<Lettore, Array<{ port_index: number; port_name: string }>>();
    metti(m, lettoreDellaFonte(f.source), { port_index: f.port_index, port_name: f.port_name });
    perLettore.set(nodo, m);
  }
  for (const [nodo, m] of perLettore) {
    const righe = m.get("controller") ?? m.get("snmp");
    if (righe && righe.length > 0) out.set(nodo, elencoDa(righe));
  }
  return out;
}

export interface ContestoProve {
  idx: NodeIndex;
  elenchi: ReadonlyMap<string, ElencoPorte>;
  come: ReturnType<typeof comeDi>;
  fatti: IndiceFatti;
}

interface Gruppo { osservatore: string; locale: Porta; righe: ViciniCaviRow[]; telaio: string; b: string | null; remota: Porta | null }

/** L'apparato remoto di una riga: il telaio (un MAC vero), altrimenti il nome (come il modello di oggi). */
function telaioDi(n: ModelNeighborRow): string {
  const mac = normalizeMacForStorage(n.remote_mac);
  if (mac && !isVirtualMac(mac)) return `mac:${mac}`;
  const nome = n.remote_device_name.trim().toLowerCase();
  return nome ? `nome:${nome}` : `riga:${n.remote_ip ?? ""}|${n.remote_port}`;
}

/** Righe di un'interfaccia (non del telaio) dello stesso apparato sulla stessa porta: unite col nome annunciato che identifica (§13.6.4, I60). */
function unisciPerNome(gruppi: Map<string, Gruppo>, diInterfaccia: (g: Gruppo) => boolean): void {
  const perNome = new Map<string, string[]>();
  for (const [k, g] of gruppi) {
    if (!diInterfaccia(g)) continue;
    const nome = g.righe.map((n) => nameKey(n.remote_device_name)).find((x): x is string => !!x && identifiesByName(x));
    if (nome) metti(perNome, `${g.osservatore}|${g.locale.chiave ?? `?${normale(g.locale.nome)}`}|${nome}`, k);
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

/** L'abbinamento come nel modello di oggi (§13.6.2, I15): l'ordine nuovo «telaio, nome, IP» arriva in T3 (T3.6). */
function abbina(g: Gruppo, idx: NodeIndex, come: ContestoProve["come"]): string | null {
  const fisica = (n: ViciniCaviRow): boolean => traduciPorta(n.remote_port, "remoto", come(null, n.source, n.remote_platform)).fisica !== false;
  const r0 = g.righe[0];
  if (g.righe.length === 1 && fisica(r0)) return resolveNode(idx, { ip: r0.remote_ip, mac: r0.remote_mac, name: r0.remote_device_name });
  for (const n of g.righe) { const b = resolveNode(idx, { mac: n.remote_mac }); if (b) return b; }
  for (const n of g.righe) { const b = resolveNode(idx, { name: n.remote_device_name }); if (b) return b; }
  for (const n of g.righe) {
    if (!n.remote_ip || !fisica(n)) continue;
    const b = resolveNode(idx, { ip: n.remote_ip });
    if (b) return b;
  }
  return null;
}

/**
 * Le prove dall'ingresso (spec §13.4.4). Vicini: una prova per apparato remoto e porta locale (le righe dello stesso
 * apparato sono una prova sola, §13.6.2), dall'ultimo giro (R-superata, come oggi), con la porta locale tradotta, la chiave
 * con l'indice del lettore e il tipo letto; la porta remota come oggi, con l'indice del lettore. Poi gli uplink del
 * controller (verso), i partner dei fasci, la tabella MAC e le VM (bordo, le regole di oggi) e le correzioni a mano.
 */
export function proveDaInput(ing: IngressoCavi, ctx: ContestoProve, t1: { links: readonly MapLink[] }): Prova[] {
  const { idx, elenchi, come, fatti } = ctx;
  const prove: Prova[] = [];
  const nome = (id: string | null): string => (id ? (idx.nodes.get(id)?.name ?? id) : "un apparato non censito");

  const righe = (righeUltimoGiro({ neighbors: ing.vicini, devices: ing.t1.devices }) as ViciniCaviRow[])
    .filter((n) => idx.nodes.has(`dev:${n.device_id}`))
    .sort((x, y) => x.device_id - y.device_id || cmp(x.local_port, y.local_port) || cmp(x.remote_device_name, y.remote_device_name)
      || cmp(x.remote_port, y.remote_port) || cmp(x.source, y.source));
  const gruppi = new Map<string, Gruppo>();
  for (const n of righe) {
    const oss = `dev:${n.device_id}`;
    const base = chiavePorta(oss, traduciPorta(n.local_port, "locale", come(oss, n.source, n.remote_platform)), "locale", elenchi.get(oss), n.local_port_index);
    const locale = conFatti(base, fatti.porta(oss, base));
    const t = telaioDi(n);
    const k = `${oss}|${locale.chiave ?? `?${normale(locale.nome)}`}|${t}`;
    const g = gruppi.get(k);
    if (g) g.righe.push(n);
    else gruppi.set(k, { osservatore: oss, locale, righe: [n], telaio: t, b: null, remota: null });
  }
  unisciPerNome(gruppi, (g) => !macDelTelaio(come(g.osservatore, g.righe[0].source, null)));
  for (const g of gruppi.values()) g.b = abbina(g, idx, come);

  // La porta remota: la certamente fisica fra le righe; per un apparato senza elenco il nome vale solo se è l'unico visto (I46).
  const nomiVisti = new Map<string, Set<string>>();
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b || elenchi.has(b)) continue;
    for (const n of g.righe) {
      const l = traduciPorta(n.remote_port, "remoto", come(b, n.source, n.remote_platform));
      if (l.nome !== "" && l.fisica !== false) {
        const s = nomiVisti.get(b) ?? new Set<string>();
        s.add(normale(l.nome));
        nomiVisti.set(b, s);
      }
    }
  }
  const ordine = (f: boolean | null): number => (f === true ? 0 : f === null ? 1 : 2);
  for (const g of gruppi.values()) {
    const b = g.b;
    if (!b) continue;
    const lette = g.righe
      .map((n) => ({ n, l: traduciPorta(n.remote_port, "remoto", come(b, n.source, n.remote_platform)), t: tempo(n.timestamp) ?? 0 }))
      .filter((x) => x.l.nome !== "")
      .sort((x, y) => ordine(x.l.fisica) - ordine(y.l.fisica) || y.t - x.t || cmp(x.l.nome, y.l.nome));
    const s = lette[0];
    const scelto = s !== undefined && s.l.fisica === null && s.l.senzaFili !== true && haTraduttoreRemoto(come(b, s.n.source, s.n.remote_platform));
    if (!s || s.l.fisica === false || scelto) continue;
    // Un apparato senza elenco ma letto (MK2: i nomi delle sue interfacce): il nome è una sua porta, anche se lo si sente
    // su più porte (l'elenco del suo lettore, §13.5.7). Senza lettura vale la regola del nome unico (I46).
    const letta = !elenchi.has(b) && s.n.remote_port_index === null && fatti.porta(b, { chiave: null, nome: s.l.nome }).length > 0;
    const p = letta
      ? { nodo: b, chiave: `n:${normale(s.l.nome)}`, nome: s.l.nome, certa: true, fisica: s.l.fisica, senzaFili: s.l.senzaFili, nelBridge: s.l.nelBridge }
      : chiavePorta(b, s.l, "remoto", elenchi.get(b), s.n.remote_port_index, nomiVisti.get(b));
    g.remota = conFatti(p, fatti.porta(b, p));
  }

  for (const g of gruppi.values()) {
    const classe = g.righe.some((n) => classeDelProtocollo(n.protocol) === "annuncio_collegamento") ? "annuncio_collegamento" : "annuncio_segmento";
    const r0 = g.righe.find((n) => classeDelProtocollo(n.protocol) === classe) ?? g.righe[0];
    const visto = piuRecente(g.righe.map((n) => n.timestamp));
    const comeLocale = come(g.osservatore, r0.source, null);
    const tunnel = fatti.porta(g.osservatore, g.locale).some((f) => f.if_kind === "tunnel") || eTunnelDiFabbrica(g.locale.nome, comeLocale);
    const tipo: TipoProva = tunnel ? "tunnel" : g.locale.senzaFili === true ? "senza_fili"
      : g.locale.fisica === false || classe === "annuncio_segmento" ? "stessa_rete" : "cavo";
    const detto = dettoDelProtocollo(r0.protocol, r0.discovered_by);
    const annunciaSenzaFili = g.b !== null && g.righe.some((n) => traduciPorta(n.remote_port, "remoto", come(g.b, n.source, n.remote_platform)).senzaFili === true);
    prove.push({
      tipo, da: g.locale, altro: g.b ? (g.remota ?? portaVuota(g.b)) : null, telaio: g.telaio, classe, detto, lettore: lettoreDellaFonte(r0.source),
      visto, capacita: g.righe.map((n) => n.remote_caps).find((c): c is string => !!c) ?? null, traduttoreLocale: haTraduttore(comeLocale),
      annunciaSenzaFili,
      frase: `${nome(g.osservatore)} vede ${g.b ? nome(g.b) : (r0.remote_device_name || "un apparato non censito")} con ${detto} sulla porta ${g.locale.nome || "non nota"}${g.remota ? ` (porta remota ${g.remota.nome})` : ""}, letto il ${quando(visto)}.${g.righe.length > 1 ? ` Altre ${g.righe.length - 1} righe dello stesso apparato: contate una volta sola.` : ""}`,
    });
  }

  // Uplink del controller (§13.7.2 passo 4): una prova di verso; la porta locale per indice (`uplink_local_port_idx`, poi
  // `is_uplink`), quella del padre per indice. Per un gateway del controller è la WAN (§13.8.3 punto 1).
  const upCavi = new Map(ing.uplink.map((u) => [u.device_id, u]));
  const upPorta = new Map<number, { index: number; name: string }>();
  for (const p of [...ing.t1.uplinkPorts].sort((x, y) => x.device_id - y.device_id || x.port_index - y.port_index)) {
    if (!upPorta.has(p.device_id)) upPorta.set(p.device_id, { index: p.port_index, name: p.port_name });
  }
  for (const d of [...ing.t1.devices].sort((x, y) => x.id - y.id)) {
    if (!d.uplink_mac) continue;
    const a = `dev:${d.id}`;
    const b = resolveNode(idx, { mac: d.uplink_mac });
    if (!b || b === a || !idx.nodes.has(a)) continue;
    const i = upCavi.get(d.id)?.uplink_local_port_idx ?? upPorta.get(d.id)?.index ?? null;
    const nomeA = i !== null ? (elenchi.get(a)?.perIndice.get(i) ?? upPorta.get(d.id)?.name ?? `Port ${i}`) : "";
    const pa = i !== null ? chiavePorta(a, traduciPorta(nomeA, "locale", come(a, FONTE_CONTROLLER, null)), "locale", elenchi.get(a), i) : portaVuota(a);
    const da = i !== null ? conFatti(pa, fatti.porta(a, pa)) : pa;
    const j = d.uplink_remote_port;
    const nomeB = j !== null ? (elenchi.get(b)?.perIndice.get(j) ?? `Port ${j}`) : "";
    const altro = j !== null
      ? chiavePorta(b, traduciPorta(nomeB, "remoto", come(b, FONTE_CONTROLLER, null)), "remoto", elenchi.get(b), elenchi.get(b)?.perIndice.has(j) ? j : null)
      : portaVuota(b);
    prove.push({
      tipo: d.uplink_type === "wireless" ? "senza_fili" : "verso", da, altro, telaio: null, classe: "uplink", detto: "uplink del controller",
      lettore: "controller", visto: d.uplink_seen_at, gateway: d.controller_mac !== null && (d.device_type === "router" || d.device_type === "firewall"),
      origine: upCavi.get(d.id)?.uplink_source ?? null,
      frase: `Il controller dice che ${nome(a)} esce dalla porta ${da.nome || "non nota"} verso ${nome(b)}.`,
    });
  }

  // Il partner LACP di un membro di un fascio (§13.6.3): prova del fascio e dell'apparato dall'altra parte, abbinato coi MAC.
  for (const f of ing.fattiPorta) {
    if (!f.lag_partner || f.if_kind === "lag") continue;
    const a = `dev:${f.device_id}`;
    const b = idx.nodes.has(a) ? resolveNode(idx, { mac: f.lag_partner }) : null;
    if (!b || b === a) continue;
    const pa = chiavePorta(a, { nome: f.port_name, fisica: true, senzaFili: false, nelBridge: null, fascio: f.lag_group }, "locale", elenchi.get(a), f.port_index);
    prove.push({
      tipo: "cavo", da: conFatti(pa, [f]), altro: portaVuota(b), telaio: `mac:${f.lag_partner}`, classe: "fascio", detto: "partner LACP",
      lettore: lettoreDellaFonte(f.source), visto: f.seen_at, ...(f.lag_group ? { appartiene: { fascio: f.lag_group } } : {}),
      frase: `${nome(a)} ha la porta ${f.port_name} nel fascio ${f.lag_group ?? ""} con ${nome(b)}: lo dice il partner LACP.`,
    });
  }

  // Bordo (tabella MAC, ripiego del router, VM sulla porta) e correzioni a mano: le regole di oggi (§13.7.2 passo 10), dalle
  // linee del modello di oggi, con le porte tradotte. Il bordo per porta arriva in T3 (T3.1).
  const locale = portaLocale(ing.t1);
  for (const l of t1.links) {
    const pa = (l.aPort ? locale(l.a, l.aPort) : null) ?? portaVuota(l.a);
    const pb = (l.bPort ? locale(l.b, l.bPort) : null) ?? portaVuota(l.b);
    if (l.sources.includes("manual")) {
      prove.push({ tipo: "a_mano", da: pa, altro: pb, telaio: null, classe: "a_mano", detto: "a mano", lettore: "persona", visto: null,
        confermato: l.manual?.confirmed === true, frase: `Collegato a mano; ${l.manual?.confirmed ? "confermato dai dati" : "non visto dai dati"}.` });
      continue;
    }
    const vm = l.sources.includes("vm_mac");
    if (!vm && !l.sources.includes("mac_table")) continue;
    prove.push({
      tipo: "bordo", da: pa, altro: pb, telaio: null, classe: vm ? "vm" : "tabella_mac", detto: vm ? "VM sulla porta" : "tabella MAC",
      lettore: "apparato", visto: l.lastSeen, ...(l.vmCount ? { vm: l.vmCount } : {}),
      frase: `Dedotto: ${vm ? "VM" : "MAC"} di ${nome(l.b)} visto sulla porta ${l.aPort || "non nota"} di ${nome(l.a)}.`,
    });
  }
  return prove;
}
```

- [ ] **Step 5: l'ingresso dal DB** — in `src/lib/db-tenant.ts`, dopo `getTopologyModelInput`:

```ts
type IngressoCavi = import("@/lib/topology/cavi/prove").IngressoCavi;

/**
 * L'ingresso del modello per cavo (spec §13.5.7, «Chi legge che cosa»): quello del modello di oggi più le righe dei vicini di
 * TUTTE le fonti con le colonne nuove, i fatti dell'ultimo giro di ogni apparato e lettore (`seen_at` almeno pari al più
 * recente meno 5 minuti, come NEIGHBORS_LATEST_ROUND_SQL), i MAC dei lettori e le schede dell'inventario (solo identità, mai
 * `getNetworkDeviceKnownMacs`), gli uplink per indice. Senza schema, elenchi vuoti e `schema: false`: la traccia lo dice.
 */
export function getIngressoCavi(staleDays: number, nowMs: number = Date.now()): IngressoCavi {
  const d = db();
  const t1 = getTopologyModelInput(staleDays, nowMs);
  const daRiga = (n: ModelInput["neighbors"][number]) => ({ ...n, remote_platform: n.remote_platform ?? null, discovered_by: null, local_port_index: null, remote_port_index: null, remote_caps: null });
  if (!schemaCaviPresente()) {
    return { t1, vicini: t1.neighbors.map(daRiga), fattiPorta: [], fattiBridge: [], macApparati: [], uplink: [], schema: false };
  }
  const ultimoGiro = (t: string) =>
    `SELECT f.* FROM ${t} f WHERE f.seen_at >= (SELECT datetime(MAX(f2.seen_at), '-5 minutes') FROM ${t} f2 WHERE f2.device_id = f.device_id AND f2.source = f.source) ORDER BY f.device_id, f.source`;
  return {
    t1,
    vicini: d.prepare(`SELECT device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, remote_platform, timestamp,
        source, discovered_by, local_port_index, remote_port_index, remote_caps FROM device_neighbors`).all() as IngressoCavi["vicini"],
    fattiPorta: d.prepare(`${ultimoGiro("topology_port_facts")}, f.port_key`).all() as IngressoCavi["fattiPorta"],
    fattiBridge: d.prepare(`${ultimoGiro("topology_bridge_facts")}, f.bridge_name, f.instance`).all() as IngressoCavi["fattiBridge"],
    macApparati: d.prepare(`SELECT device_id, mac, source FROM topology_device_macs
      UNION SELECT nd.id, di.mac, 'inventario' FROM network_devices nd JOIN device_interfaces di ON di.physical_device_id = nd.physical_device_id
       WHERE di.mac IS NOT NULL AND di.mac <> '' AND di.is_virtual_mac = 0 ORDER BY 1, 2`).all() as IngressoCavi["macApparati"],
    uplink: d.prepare(`SELECT id AS device_id, uplink_local_port_idx, uplink_source FROM network_devices
      WHERE uplink_local_port_idx IS NOT NULL OR uplink_source IS NOT NULL ORDER BY id`).all() as IngressoCavi["uplink"],
    schema: true,
  };
}
```

  (Nessun `try` che dia «elenchi vuoti» su un errore: un errore qui è un errore della rotta della traccia, che lo dice.)

- [ ] **Step 6: verde** — le due prove dello Step 2, più `cavi-senza-prodotti.test.ts` (I37, I58: `cavi/prove.ts` non
  nomina prodotti, `lettori/fonti.ts` non ha prefissi di nomi scelti) e le prove di oggi dei traduttori (`traduci.test.ts`):

```bash
for f in src/lib/topology/__tests__/cavi-prove.test.ts src/lib/__tests__/topology-cavi-ingresso.test.ts \
         src/lib/topology/__tests__/cavi-senza-prodotti.test.ts src/lib/topology/__tests__/traduci.test.ts src/lib/topology/__tests__/links.test.ts; do
  node --import tsx --test "$f" > "$SCRATCH/t9-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
npx tsc --noEmit > "$SCRATCH/t9-tsc.log" 2>&1; echo "tsc exit=$?"
git diff --stat origin/dev -- src/lib/topology/links.ts src/lib/topology/model.ts src/lib/topology/tree.ts; echo "modello di oggi intatto: nessuna riga sopra"
```

  Atteso: tutti `exit=0`; il `git diff --stat` non stampa niente.

- [ ] **Step 7: commit** — `git add src/lib/topology/lettori/ src/lib/topology/cavi/prove.ts src/lib/db-tenant.ts
  src/lib/topology/__tests__/support/cavi.ts src/lib/topology/__tests__/cavi-prove.test.ts src/lib/__tests__/topology-cavi-ingresso.test.ts`,
  `git commit -m "feat(topologia): ingresso e prove neutre del modello per cavo, in ombra (T2.7)"`.

---
### Task 10: i collegamenti per cavo (T2.7, seconda parte)

Spec §13.7.2 (passi 1-9 e 11), §13.7.3 (segmenti, id `seg:`), §13.7.4 (instradati), §13.7.5 (tunnel, solo se accesi, il
capo letto più di recente), §13.7.6 punto 3 (il salto radio, le due radio di un ponte sulla stessa porta), §13.6.3
(fasci provati e dedotti), §13.4.5 (fiducia), prove I3, I5, I7, I25, I43, I45, I48, I58, I61, I66, I67, I69 nella forma
del modello per cavo. Il passo 10 (bordo) usa le regole di oggi (Task 9); la regola «dalle VM» (§13.15 punto 4) e
«oltre» una radio (§13.7.6 punto 5) restano a T3.

**Files:**
- Create: `src/lib/topology/cavi/collegamenti.ts`, `src/lib/topology/cavi/modello.ts` (prima parte: `preparaCavi`)
- Test: `src/lib/topology/__tests__/cavi-collegamenti.test.ts`

**Interfaces:**
- Consumes: Task 9 (`Prova`, `IngressoCavi`, `IndiceFatti`, `indiceFatti`, `elenchiCavi`, `proveDaInput`, `portaVuota`,
  `FattoPorta`, `FattoBridge`); `regoleIgnora`, `ignorato`, `correzioniOrfane` (`ignorati.ts`); `portaSalvata`, `comeDi`
  (`links.ts`); `buildNodeIndex`, `addNodeMacs`; `resolveScanHosts` (`vms.ts`); `parseSpeedMbps` (`link-attrs.ts`);
  `eRadioDalleCapacita` (Task 9).
- Produces (`cavi/collegamenti.ts`): `Genere`, `StatoCollegamento`, `Fiducia`, `Collegamento`, `Segmento`, `ContestoCavi`,
  `RisultatoCavi`, `costruisciCollegamenti(prove, correzioni, ctx): RisultatoCavi`, `capo(c, nodo)`, `altroCapo(c, nodo)`.
- Produces (`cavi/modello.ts`): `interface PreparatoCavi { idx; prove; ctx; elenchi; fatti }`,
  `preparaCavi(ing: IngressoCavi, t1: TopologyModel): PreparatoCavi`.

- [ ] **Step 1: le prove, viste fallire** — `src/lib/topology/__tests__/cavi-collegamenti.test.ts`:

```ts
// I collegamenti per cavo (spec topologia §13.7.2-13.7.6, §13.6.3), in ombra: una linea per cavo, la fiducia in parole, lo
// stato dai due capi, i segmenti come oggetti, i fasci, i tunnel solo se accesi, il salto radio. Reti piccole inventate
// (righe come le scrivono i lettori), l'incidente o l'origine nel titolo di ogni prova.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciCollegamenti, type Collegamento } from "@/lib/topology/cavi/collegamenti";
import { preparaCavi } from "@/lib/topology/cavi/modello";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import type { LinkOverrideRow } from "@/lib/topology/model-types";
import { baseInput, dev } from "./support/righe";
import { porte } from "./support/reti-campione";
import { fp, ingresso, vic } from "./support/cavi";

function collega(ing: IngressoCavi) {
  const t1 = buildTopologyModel(ing.t1);
  const p = preparaCavi(ing, t1);
  return costruisciCollegamenti(p.prove, ing.t1.overrides, p.ctx);
}
const fra = (cs: readonly Collegamento[], x: string, y: string): Collegamento[] =>
  cs.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));
const due = (over: Parameters<typeof baseInput>[0] = {}) => baseInput({
  devices: [dev(2, { name: "SW-2" }), dev(3, { name: "SW-3" }), dev(4, { name: "SW-4" })],
  ports: [...porte(2, [[1, "Port 1", "10000 Mbps"], [5, "Port 5", "1000 Mbps"], [6, "Port 6", "10000 Mbps"]]), ...porte(3, [[2, "Port 2", "10000 Mbps"], [7, "Port 7", "10000 Mbps"]]), ...porte(4, [[3, "Port 3", "1000 Mbps"]])],
  ...over,
});

test("passo 3: dai due capi è certo, da un capo probabile; una linea per cavo con le due porte", () => {
  const unoSolo = collega(ingresso(due(), { vicini: [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" })] }));
  const c = fra(unoSolo.collegamenti, "dev:2", "dev:3");
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].genere, c[0].fiducia, c[0].velocitaMbps, [c[0].a.chiave, c[0].b.chiave].sort()], ["cavo", "probabile", 10000, ["i:1", "i:2"]]);
  const dueCapi = collega(ingresso(due(), { vicini: [
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
    vic({ device_id: 3, local_port: "Port 2", remote_device_name: "SW-2", remote_port: "Port 1" }),
  ] }));
  assert.equal(fra(dueCapi.collegamenti, "dev:2", "dev:3")[0].fiducia, "certo");
});

test("passo 11: due cavi veri fra gli stessi apparati sono due linee (non un fascio senza lo spanning tree fra loro)", () => {
  const r = collega(ingresso(due(), { vicini: [
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
    vic({ device_id: 2, local_port: "Port 6", remote_device_name: "SW-3", remote_port: "Port 7" }),
  ] }));
  assert.deepEqual(fra(r.collegamenti, "dev:2", "dev:3").map((c) => c.genere), ["cavo", "cavo"]);
});

test("I66: due cavi in inoltro con lo spanning tree attivo fra loro sono un fascio dedotto; il fascio letto è un fascio", () => {
  const vicini = [
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
    vic({ device_id: 2, local_port: "Port 6", remote_device_name: "SW-3", remote_port: "Port 7" }),
  ];
  const attivo = (d: number, k: string, n: string) => fp(d, k, n, { stp_state: "forwarding" });
  const dedotto = collega(ingresso(due(), { vicini, fattiPorta: [attivo(2, "i:1", "Port 1"), attivo(2, "i:6", "Port 6"), attivo(3, "i:2", "Port 2"), attivo(3, "i:7", "Port 7")] }));
  const f = fra(dedotto.collegamenti, "dev:2", "dev:3");
  assert.deepEqual([f.length, f[0].genere, f[0].membri?.length, f[0].velocitaMbps, f[0].fascioDedotto], [1, "fascio", 2, 20000, true]);
  const letto = collega(ingresso(due(), { vicini, fattiPorta: [fp(2, "i:1", "Port 1", { lag_group: "lag:1" }), fp(2, "i:6", "Port 6", { lag_group: "lag:1" })] }));
  const g = fra(letto.collegamenti, "dev:2", "dev:3");
  assert.deepEqual([g.length, g[0].genere, g[0].fascioDedotto], [1, "fascio", false]);
});

test("I7 e §13.7.3: una porta che sente due apparati è un segmento: id «seg:», un'appartenenza per membro, nessun cavo", () => {
  const r = collega(ingresso(due(), { vicini: [
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "SW-3", remote_port: "Port 7" }),
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "SW-4", remote_port: "Port 3" }),
  ] }));
  assert.equal(r.segmenti.length, 1);
  assert.equal(r.segmenti[0].id, "seg:2:5");
  assert.deepEqual(r.segmenti[0].membri.map((m) => `${m.nodo}|${m.chiave}`).sort(), ["dev:2|i:5", "dev:3|i:7", "dev:4|i:3"]);
  assert.equal(r.collegamenti.filter((c) => c.genere === "cavo").length, 0);
  assert.equal(r.collegamenti.filter((c) => c.genere === "segmento").length, 3);
});

test("I43: un vicino vecchio non fa un segmento", () => {
  const r = collega(ingresso(due(), { vicini: [
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "SW-3", remote_port: "Port 7", timestamp: "2026-10-01 11:00:00" }),
    vic({ device_id: 2, local_port: "Port 5", remote_device_name: "SW-4", remote_port: "Port 3" }),
  ] }));
  assert.equal(r.segmenti.length, 0);
  assert.equal(fra(r.collegamenti, "dev:2", "dev:4").length, 1);
});

test("I25 e I67: giù vince su «forwarding»; «disabled» su una porta accesa inoltra; discarding o alternate = bloccato", () => {
  const vicini = [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" })];
  const stato = (f: Parameters<typeof fp>[3]) => fra(collega(ingresso(due(), { vicini, fattiPorta: [fp(2, "i:1", "Port 1", f)] })).collegamenti, "dev:2", "dev:3")[0].stato;
  assert.equal(stato({ running: 0, stp_state: "forwarding" }), "giu");
  assert.equal(stato({ stp_state: "disabled" }), "inoltra");
  assert.equal(stato({ stp_state: "discarding" }), "bloccato");
  assert.equal(stato({ stp_role: "alternate", stp_state: "forwarding" }), "bloccato");
  assert.equal(stato({ in_bridge: 0 }), "instradato");
  const giuDaSwitchPorts = collega(ingresso(due({ ports: porte(2, [[1, "Port 1", "10000 Mbps"]]).map((p) => ({ ...p, status: "down" })) }), { vicini }));
  assert.equal(fra(giuDaSwitchPorts.collegamenti, "dev:2", "dev:3")[0].stato, "giu");
});

test("I5 e I58: da un'interfaccia logica nessun cavo; per un router col traduttore del suo prodotto un nome scelto non è una porta fisica", () => {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(3, { name: "SW-3" })], ports: porte(3, [[2, "Port 2", "1000 Mbps"]]) });
  const vlan = collega(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "vlan20", remote_device_name: "SW-3", remote_port: "Port 2", source: "device" })] }));
  assert.equal(vlan.collegamenti.length, 0);
  const scelto = collega(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "PONTE-A", remote_device_name: "SW-3", remote_port: "Port 2", source: "device" })] }));
  assert.equal(scelto.collegamenti.length, 0, "senza il tipo letto, il nome scelto non dà cavi");
  const letto = collega(ingresso(t1, {
    vicini: [vic({ device_id: 1, local_port: "PONTE-A", remote_device_name: "SW-3", remote_port: "Port 2", source: "device" })],
    fattiPorta: [fp(1, "n:ponte-a", "PONTE-A", { source: "device" })],
  }));
  assert.equal(letto.collegamenti.length, 1, "col tipo letto (MK2) è una porta fisica: il cavo c'è (§13.13.2, «in T2 il tipo letto lo rende»)");
});

test("I3 e I51: fra router un annuncio di segmento non conferma; vale solo come unico vicino su una porta fisica, probabile «attraverso»", () => {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "RTR-2", device_type: "router", ...mk }), dev(3, { name: "SW-3" })] });
  const unico = collega(ingresso(t1, { vicini: [vic({ device_id: 1, local_port: "ether4", remote_device_name: "RTR-2", remote_port: "ether2", protocol: "mndp", source: "device" })] }));
  const c = fra(unico.collegamenti, "dev:1", "dev:2");
  assert.deepEqual([c.length, c[0]?.fiducia, c[0]?.attraverso], [1, "probabile", true]);
  const conAltri = collega(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether4", remote_device_name: "RTR-2", remote_port: "ether2", protocol: "mndp", source: "device" }),
    vic({ device_id: 1, local_port: "ether4", remote_device_name: "SW-3", remote_port: "Port 9", protocol: "mndp", source: "device" }),
  ] }));
  assert.equal(conAltri.collegamenti.length, 0);
});

test("I45: un uplink che accoppia porte di velocità diverse dà il verso, non le porte", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "GW", device_type: "switch", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00" }), dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00" })],
    uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }],
    ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"]]), ...porte(2, [[25, "SFP28 25", "25000 Mbps"]])],
  });
  const c = fra(collega(ingresso(t1)).collegamenti, "dev:1", "dev:2");
  assert.deepEqual([c.length, c[0].porteDaVerificare, c[0].verso, c[0].a.chiave, c[0].b.chiave], [1, true, "dev:1", null, null]);
});

test("I68 (in ombra): l'uplink di un gateway del controller è la sua WAN: instradato, senza verso", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "GW", device_type: "router", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00" }), dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00" })],
    uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }],
    ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"]]), ...porte(2, [[25, "SFP28 25", "10000 Mbps"]])],
  });
  const c = fra(collega(ingresso(t1)).collegamenti, "dev:1", "dev:2")[0];
  assert.deepEqual([c.wan, c.stato, c.verso], [true, "instradato", null]);
});

test("I69 e I48: un tunnel acceso è un collegamento «tunnel», mai un cavo; spento, o mai letto, nessuna linea", () => {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "RTR-2", device_type: "router", ...mk })] });
  const riga = vic({ device_id: 1, local_port: "wg-sede", remote_device_name: "RTR-2", remote_port: "wg-sede1", protocol: "mndp", source: "device" });
  const acceso = collega(ingresso(t1, { vicini: [riga], fattiPorta: [fp(1, "n:wg-sede", "wg-sede", { source: "device", if_kind: "tunnel", running: 1 })] }));
  assert.deepEqual(acceso.collegamenti.map((c) => [c.genere, c.fiducia]), [["tunnel", "probabile"]]);
  const spento = collega(ingresso(t1, { vicini: [riga], fattiPorta: [fp(1, "n:wg-sede", "wg-sede", { source: "device", if_kind: "tunnel", running: 0 })] }));
  assert.equal(spento.collegamenti.length, 0);
});

test("§13.7.6 punto 3: due radio sulla stessa porta non sono un segmento; la vicina sul cavo, la lontana dopo il salto", () => {
  const mk = { vendor: "mikrotik", via: "ssh" } as const;
  const t1 = baseInput({ devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(7, { name: "RADIO-VICINA", device_type: "access_point", ...mk }), dev(8, { name: "RADIO-LONTANA", device_type: "access_point", ...mk })] });
  const r = collega(ingresso(t1, { vicini: [
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-VICINA", remote_port: "bridge/ether1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
    vic({ device_id: 1, local_port: "ether3", remote_device_name: "RADIO-LONTANA", remote_port: "bridge/bond1/wlan60-1", remote_caps: "bridge", source: "device", remote_platform: "MikroTik" }),
  ] }));
  assert.equal(r.segmenti.length, 0);
  assert.deepEqual(fra(r.collegamenti, "dev:1", "dev:7").map((c) => c.genere), ["cavo"]);
  assert.deepEqual(fra(r.collegamenti, "dev:7", "dev:8").map((c) => c.genere), ["radio"]);
});

test("§13.9: «Ignora» toglie solo quel cavo; una correzione che non tocca niente è orfana", () => {
  const vicini = [
    vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }),
    vic({ device_id: 2, local_port: "Port 6", remote_device_name: "SW-3", remote_port: "Port 7" }),
  ];
  const ignora = (id: number, aPort: string, bPort: string): LinkOverrideRow => ({ id, action: "ignore", a_node: "dev:2", a_port: aPort, b_node: "dev:3", b_port: bPort, medium: null });
  const r = collega(ingresso(due({ overrides: [ignora(1, "Port 1", "Port 2"), ignora(2, "Port 5", "Port 9")] }), { vicini }));
  assert.deepEqual(fra(r.collegamenti, "dev:2", "dev:3").map((c) => [c.a.chiave, c.b.chiave].sort().join("|")), ["i:6|i:7"]);
  assert.deepEqual(r.correzioniOrfane, [2]);
});

test("I39: stessi dati, stessi collegamenti (id compresi)", () => {
  const ing = () => ingresso(due(), { vicini: [vic({ device_id: 2, local_port: "Port 1", remote_device_name: "SW-3", remote_port: "Port 2" }), vic({ device_id: 3, local_port: "Port 2", remote_device_name: "SW-2", remote_port: "Port 1" })] });
  assert.deepEqual(collega(ing()).collegamenti.map((c) => c.id), collega(ing()).collegamenti.map((c) => c.id));
  assert.ok(collega(ing()).collegamenti.every((c) => c.id.startsWith(`${c.genere}:`)));
});
```

```bash
node --import tsx --test src/lib/topology/__tests__/cavi-collegamenti.test.ts > "$SCRATCH/t10-rosso.log" 2>&1; echo "exit=$?"
```

  Atteso: `exit=1` (moduli mancanti).

- [ ] **Step 2: i collegamenti** — `src/lib/topology/cavi/collegamenti.ts`:

```ts
/**
 * Il modello per cavo: una linea per collegamento (spec topologia §13.7.2-13.7.6, §13.6.3; T2 in ombra, T3 a schermo). Le
 * prove per porta (prove.ts) diventano collegamenti — cavi, fasci, tunnel, ponti radio, collegamenti senza fili,
 * appartenenze a un segmento — con lo stato dai due capi (inoltra, bloccato, instradato, riserva del bond, giù), la fiducia e
 * il verso quando una prova lo dice. Le correzioni «ignora» valgono per cavo. Nessun prodotto: solo fatti neutri (I37).
 * Logica pura e deterministica (stessi dati, stessi collegamenti: I39).
 */
import { parseDbDate } from "@/lib/db-date";
import { correzioniOrfane, ignorato, regoleIgnora } from "@/lib/topology/ignorati";
import { eRadioDalleCapacita } from "@/lib/topology/lettori/fonti";
import type { LinkOverrideRow } from "@/lib/topology/model-types";
import type { NodeIndex } from "@/lib/topology/node-index";
import { normale, type ElencoPorte, type Porta } from "./porte";
import { portaVuota, type IndiceFatti, type Prova } from "./prove";

export type Genere = "cavo" | "fascio" | "tunnel" | "radio" | "senza_fili" | "segmento";
export type StatoCollegamento = "inoltra" | "bloccato" | "bloccato_comune" | "instradato" | "riserva_bond" | "giu" | null;
export type Fiducia = "certo" | "probabile" | "dedotto" | "a_mano_confermato" | "a_mano";

export interface Collegamento {
  /** Il genere più i due capi ordinati con la chiave della porta. */
  id: string;
  /** Per il genere «segmento», `b` è il segmento. */
  a: Porta;
  b: Porta;
  genere: Genere;
  membri?: Array<{ a: Porta; b: Porta; stato: StatoCollegamento }>;
  /** Il nome del fascio dai due capi (per la porta radice di un bridge che è un fascio). */
  fascio?: { a: string | null; b: string | null };
  /** Fascio senza la prova del fascio: due cavi in inoltro con lo spanning tree attivo fra loro (§13.6.3). */
  fascioDedotto?: boolean;
  stato: StatoCollegamento;
  /** Bloccato nell'albero comune, attivo in un'istanza: le VLAN di quell'istanza. */
  attivoPerVlan?: number[];
  fiducia: Fiducia;
  /** Il figlio, se una prova di verso lo dice. */
  verso: string | null;
  velocitaMbps: number | null;
  /** La prova accoppia porte con velocità diverse (§13.6.1, I45). */
  porteDaVerificare: boolean;
  prove: Prova[];
  frasi: string[];
  /** Nessuna prova vista entro la soglia «non visto» (le correzioni a mano non invecchiano). */
  nonVisto: boolean;
  /** «Instradato (WAN)»: l'uplink di un gateway del controller (§13.8.3, punto 1). */
  wan?: boolean;
  /** Fra router, un annuncio di segmento come unico vicino: probabile, «attraverso apparati non letti». */
  attraverso?: boolean;
  /** VM accese dell'hypervisor che passano dalla porta (§12.5). */
  vm?: number;
}

export interface Segmento { id: string; membri: Porta[]; altriApparati: number; frase: string }

export interface ContestoCavi {
  nowMs: number;
  staleDays: number;
  /** nodo → elenco delle porte, con la precedenza del §13.5.7. */
  porte: ReadonlyMap<string, ElencoPorte>;
  /** I fatti di porta e di bridge, già filtrati all'ultimo giro (§13.5.7). */
  fatti: IndiceFatti;
  /** «nodo|chiave» → stato da switch_ports.status. */
  statoPorte: ReadonlyMap<string, "su" | "giu" | "spenta">;
  /** «nodo|chiave» → velocità in Mbps. */
  velocita: ReadonlyMap<string, number>;
  /** nodo → MAC dell'apparato (MAIUSCOLO), dai lettori e dall'inventario. */
  macApparati: ReadonlyMap<string, ReadonlySet<string>>;
  idx: NodeIndex;
  /** I router e i firewall (le regole dei router, §13.7.2 passo 5). */
  router: ReadonlySet<string>;
  /** VM → il suo hypervisor: un hypervisor e le sue VM sentiti sulla stessa porta sono un apparato solo. */
  vmIpervisore: ReadonlyMap<string, string>;
  /** La porta di una correzione salvata (`portaSalvata` di links.ts: anche la forma di prima di T1). */
  portaSalvata: (nodo: string, nome: string) => Porta | null;
}

export interface RisultatoCavi {
  collegamenti: Collegamento[];
  segmenti: Segmento[];
  /** Le prove che non diventano un collegamento: stessa rete, tunnel spenti o non letti. */
  stessaRete: Prova[];
  correzioniOrfane: number[];
}

const DAY_MS = 86_400_000;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
function tempo(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = parseDbDate(s).getTime();
  return Number.isNaN(t) ? null : t;
}
const chiaveDi = (p: Pick<Porta, "nodo" | "chiave" | "nome">): string => `${p.nodo}|${p.chiave ?? `?${normale(p.nome)}`}`;
const compatibili = (x: Porta, y: Porta): boolean => x.chiave === null || y.chiave === null || x.chiave === y.chiave;
const unisci = (x: Porta, y: Porta): Porta => (x.chiave !== null ? x : y.chiave !== null ? y : x.nome !== "" ? x : y);
export const capo = (c: Pick<Collegamento, "a" | "b">, nodo: string): Porta => (c.a.nodo === nodo ? c.a : c.b);
export const altroCapo = (c: Pick<Collegamento, "a" | "b">, nodo: string): Porta => (c.a.nodo === nodo ? c.b : c.a);
const macDelBridge = (id: string | null): string | null => (id ? (id.split(".").pop() ?? "").toUpperCase() : null);

interface Bozza {
  genere: Genere; a: Porta; b: Porta; prove: Prova[]; osservatori: Set<string>;
  verso: string | null; porteDaVerificare: boolean; wan: boolean; attraverso: boolean; vm: number;
}

const PAROLE_FIDUCIA: Readonly<Record<Fiducia, string>> = {
  certo: "certo: lo vedono tutti e due gli apparati", probabile: "probabile", dedotto: "dedotto",
  a_mano_confermato: "a mano, confermato dai dati", a_mano: "a mano, non visto dai dati",
};

function vlanDa(testo: string | null): number[] {
  const out: number[] = [];
  for (const parte of (testo ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "")) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(parte);
    if (!m) continue;
    const da = Number(m[1]), a = m[2] ? Number(m[2]) : da;
    for (let v = da; v <= a && out.length < 4096; v++) out.push(v);
  }
  return out;
}

export function costruisciCollegamenti(prove: readonly Prova[], correzioni: readonly LinkOverrideRow[], ctx: ContestoCavi): RisultatoCavi {
  const finestra = ctx.staleDays * DAY_MS;
  const velocitaDi = (p: Porta): number | null => (p.chiave ? (ctx.velocita.get(`${p.nodo}|${p.chiave}`) ?? null) : null);
  const contabile = (p: Porta): boolean => p.certa && p.chiave !== null && (p.fisica === true || p.senzaFili === true);

  // Passo 2: la freschezza di una prova rispetto alla lettura più recente dello stesso apparato e lettore (I43).
  const ultima = new Map<string, number>();
  for (const p of prove) {
    const t = tempo(p.visto);
    const k = `${p.da.nodo}|${p.lettore}`;
    if (t !== null) ultima.set(k, Math.max(ultima.get(k) ?? t, t));
  }
  const fresca = (p: Prova): boolean => {
    const t = tempo(p.visto);
    const u = ultima.get(`${p.da.nodo}|${p.lettore}`);
    return t === null || u === undefined || t >= u - finestra;
  };
  const apparato = (p: Prova): string => {
    const b = p.altro?.nodo ?? null;
    return b ? `nodo:${ctx.vmIpervisore.get(b) ?? b}` : (p.telaio ?? "?");
  };

  // Passo 2: gli apparati di ogni porta fisica e nota, sentiti con un annuncio di collegamento, contati per apparato.
  const vicini = prove.filter((p) => p.altro !== null && p.altro.nodo !== p.da.nodo && (p.classe === "annuncio_collegamento" || p.classe === "annuncio_segmento")
    && (p.tipo === "cavo" || p.tipo === "senza_fili" || p.tipo === "stessa_rete"));
  const sentiti = new Map<string, Map<string, Prova>>();
  for (const p of prove) {
    if ((p.tipo !== "cavo" && p.tipo !== "senza_fili") || p.classe !== "annuncio_collegamento") continue;
    if (!contabile(p.da) || !fresca(p) || p.altro?.nodo === p.da.nodo) continue;
    const m = sentiti.get(chiaveDi(p.da)) ?? new Map<string, Prova>();
    m.set(apparato(p), p);
    sentiti.set(chiaveDi(p.da), m);
  }
  // Le due radio di un ponte sulla stessa porta (§13.7.6, punto 3): non un segmento. La lontana annuncia da un'interfaccia
  // senza fili; se non si riconosce chi è la lontana, il segmento resta.
  const ponti = new Map<string, { vicina: Prova; lontana: Prova }>();
  for (const [k, m] of sentiti) {
    if (m.size !== 2) continue;
    const [x, y] = [...m.values()];
    if (!eRadioDalleCapacita(x.capacita ?? null) || !eRadioDalleCapacita(y.capacita ?? null)) continue;
    if (!!x.annunciaSenzaFili === !!y.annunciaSenzaFili) continue;
    ponti.set(k, x.annunciaSenzaFili ? { vicina: y, lontana: x } : { vicina: x, lontana: y });
  }
  const diSegmento = new Set([...sentiti].filter(([k, m]) => m.size >= 2 && !ponti.has(k)).map(([k]) => k));

  const bozze: Bozza[] = [];
  const aggiungi = (genere: Genere, pa: Porta, pb: Porta, p: Prova, osservatore: string | null): Bozza => {
    for (const z of bozze) {
      if (z.genere !== genere) continue;
      const diritto = z.a.nodo === pa.nodo && z.b.nodo === pb.nodo && compatibili(z.a, pa) && compatibili(z.b, pb);
      const rovescio = !diritto && z.a.nodo === pb.nodo && z.b.nodo === pa.nodo && compatibili(z.a, pb) && compatibili(z.b, pa);
      if (!diritto && !rovescio) continue;
      if (diritto) { z.a = unisci(z.a, pa); z.b = unisci(z.b, pb); } else { z.a = unisci(z.a, pb); z.b = unisci(z.b, pa); }
      z.prove.push(p);
      if (osservatore) z.osservatori.add(osservatore);
      if (p.vm) z.vm = Math.max(z.vm, p.vm);
      return z;
    }
    const z: Bozza = { genere, a: pa, b: pb, prove: [p], osservatori: new Set(osservatore ? [osservatore] : []), verso: null, porteDaVerificare: false, wan: false, attraverso: false, vm: p.vm ?? 0 };
    bozze.push(z);
    return z;
  };

  // Passi 1, 3, 5, 6: i vicini. Il ritorno serve alla conferma per porta dei router e al salto radio.
  const vede = (x: string, y: string, porta: Porta): boolean => vicini.some((q) => q.da.nodo === x && q.altro?.nodo === y
    && q.classe === "annuncio_collegamento" && (q.tipo === "cavo" || q.tipo === "senza_fili") && !diSegmento.has(chiaveDi(q.da))
    && porta.chiave !== null && q.altro.chiave === porta.chiave);
  const uplinkVerso = (figlio: string, padre: string, porta: Porta): boolean => prove.some((q) => q.classe === "uplink"
    && q.da.nodo === figlio && q.altro?.nodo === padre && porta.chiave !== null && q.altro.chiave === porta.chiave);
  const tuttiSu = new Map<string, Set<string>>();
  for (const p of vicini) {
    const s = tuttiSu.get(chiaveDi(p.da)) ?? new Set<string>();
    s.add(p.altro!.nodo);
    tuttiSu.set(chiaveDi(p.da), s);
  }
  const portaDelRouter = (p: Prova): boolean => p.da.senzaFili === true || (p.traduttoreLocale ? p.da.fisica === true : p.da.fisica !== false);
  const stessaRete: Prova[] = [];
  for (const p of vicini) {
    const k = chiaveDi(p.da);
    const b = p.altro!;
    if (diSegmento.has(k)) continue;                                        // passo 2 (I7)
    if (ponti.get(k)?.lontana === p) continue;                              // la radio lontana sta dopo il salto
    if (p.da.fisica === false && p.da.senzaFili !== true) { stessaRete.push(p); continue; }   // passo 1 (I5)
    const collegamento = p.classe === "annuncio_collegamento";
    if (ctx.router.has(p.da.nodo)) {
      if (!portaDelRouter(p)) { stessaRete.push(p); continue; }             // un nome scelto non è una porta fisica (I58)
      const confermato = vede(b.nodo, p.da.nodo, p.da) || uplinkVerso(b.nodo, p.da.nodo, p.da);
      if (!collegamento) {
        // Un annuncio di segmento non conferma mai (M-5): vale solo come unico vicino su una porta fisica, contando tutte le
        // righe della porta (§11.1, come oggi), probabile «attraverso apparati non letti» (I51).
        if ((tuttiSu.get(k)?.size ?? 0) !== 1 || p.da.fisica !== true) { stessaRete.push(p); continue; }
        aggiungi("cavo", p.da, b, p, null).attraverso = true;
        continue;
      }
      const unico = (sentiti.get(k)?.size ?? 0) <= 1 || ponti.has(k);   // le due radio di un ponte contano come il cavo verso la vicina
      if (p.da.chiave === null && !confermato) { stessaRete.push(p); continue; }
      if (p.da.senzaFili === true ? !confermato : !(unico || confermato)) { stessaRete.push(p); continue; }
    } else if (!collegamento || p.tipo === "stessa_rete") {
      stessaRete.push(p);
      continue;
    }
    const salto = p.da.senzaFili === true && vicini.some((q) => q.da.nodo === b.nodo && q.altro?.nodo === p.da.nodo && q.da.fisica === true);
    aggiungi(salto ? "radio" : p.da.senzaFili === true ? "senza_fili" : "cavo", p.da, b, p, p.da.nodo);
  }
  for (const { vicina, lontana } of ponti.values()) {
    if (vicina.altro && lontana.altro) aggiungi("radio", portaVuota(vicina.altro.nodo), portaVuota(lontana.altro.nodo), lontana, null);
  }

  // Passo 4: l'uplink del controller. Velocità diverse ai due capi: solo il verso (I45). Un gateway: la WAN (I68).
  const uplinkSuSegmento = new Map<string, string>();
  for (const p of prove) {
    if (p.classe !== "uplink" || !p.altro) continue;
    const figlio = p.da.nodo, padre = p.altro.nodo;
    if (diSegmento.has(chiaveDi(p.da))) { uplinkSuSegmento.set(chiaveDi(p.da), figlio); continue; }
    const va = velocitaDi(p.da), vb = velocitaDi(p.altro);
    if (va !== null && vb !== null && va !== vb) {
      const fraLoro = bozze.filter((z) => (z.genere === "cavo" || z.genere === "senza_fili") && ((z.a.nodo === figlio && z.b.nodo === padre) || (z.a.nodo === padre && z.b.nodo === figlio)));
      const z = fraLoro.find((x) => p.altro?.chiave !== null && capo(x, padre).chiave === p.altro?.chiave) ?? fraLoro[0];
      const scelta = z ?? aggiungi("cavo", portaVuota(figlio), portaVuota(padre), p, null);
      if (z) z.prove.push(p);
      scelta.porteDaVerificare = true;
      if (p.gateway) scelta.wan = true;
      else scelta.verso ??= figlio;
      continue;
    }
    const z = aggiungi(p.tipo === "senza_fili" ? "senza_fili" : "cavo", p.da, p.altro, p, figlio);
    if (p.gateway) z.wan = true;
    else z.verso = figlio;
  }

  // Partner dei fasci, bordo (tabella MAC, VM, ripiego del router: le regole di oggi), correzioni «aggiungi», tunnel.
  for (const p of prove) {
    if (!p.altro) continue;
    if (p.classe === "fascio") aggiungi("cavo", p.da, p.altro, p, p.da.nodo);
    else if (p.tipo === "bordo") aggiungi("cavo", p.da, p.altro, p, null);
    else if (p.tipo === "a_mano") aggiungi(p.da.senzaFili === true || p.altro.senzaFili === true ? "senza_fili" : "cavo", p.da, p.altro, p, null);
    else if (p.tipo === "tunnel") aggiungi("tunnel", p.da, p.altro, p, p.da.nodo);
  }

  // Lo stato di un capo (passo 8): giù su una porta giù o spenta, qualunque stato dica lo spanning tree (I25, I67);
  // bloccato se discarding, alternate o backup su una porta accesa («disabled» su una porta accesa inoltra); fuori dal
  // bridge = instradato; il membro di riserva di un bond.
  const statoCapo = (p: Porta) => {
    const f = p.nodo.startsWith("seg:") ? [] : ctx.fatti.porta(p.nodo, p);
    const sp = p.chiave ? ctx.statoPorte.get(`${p.nodo}|${p.chiave}`) : undefined;
    const giu = sp === "giu" || sp === "spenta" || f.some((x) => x.running === 0);
    return {
      giu,
      bloccato: !giu && f.some((x) => x.stp_state === "discarding" || x.stp_role === "alternate" || x.stp_role === "backup"),
      instradato: f.some((x) => x.in_bridge === 0) || p.nelBridge === false,
      riserva: f.some((x) => x.lag_state === "riserva"),
      lag: f.find((x) => x.lag_group !== null)?.lag_group ?? null,
      stpAttivo: f.some((x) => (x.edge === 0 && (x.bpdu_rx ?? 0) > 0) || (x.stp_state !== null && x.stp_state !== "disabled")),
    };
  };
  // Il tunnel si disegna solo se acceso; vale il capo letto più di recente (I48). Spento o non letto: solo nei dettagli.
  const accesoDi = (p: Porta): { acceso: boolean; quando: number } | null => {
    const f = ctx.fatti.porta(p.nodo, p).filter((x) => x.running !== null).sort((x, y) => cmp(y.seen_at, x.seen_at))[0];
    if (f) return { acceso: f.running === 1, quando: tempo(f.seen_at) ?? 0 };
    const sp = p.chiave ? ctx.statoPorte.get(`${p.nodo}|${p.chiave}`) : undefined;
    return sp ? { acceso: sp === "su", quando: 0 } : null;
  };
  const tenute: Bozza[] = [];
  for (const z of bozze) {
    if (z.genere !== "tunnel") { tenute.push(z); continue; }
    const letti = [accesoDi(z.a), accesoDi(z.b)].filter((x): x is { acceso: boolean; quando: number } => x !== null).sort((x, y) => y.quando - x.quando);
    if (letti[0]?.acceso === true) tenute.push(z);
    else stessaRete.push(...z.prove);
  }

  // I segmenti (§13.7.3): membri = la porta che sente e gli apparati sentiti con una porta nota; due segmenti con un membro in
  // comune sono uno solo. Id: «seg:<id apparato>:<porta>» del membro gestito con la chiave più piccola.
  const gruppi: Array<{ chiavi: Set<string>; membri: Map<string, Porta>; prove: Prova[]; altri: Set<string> }> = [];
  for (const k of [...diSegmento].sort()) {
    const m = sentiti.get(k)!;
    const chiavi = new Set<string>([k]);
    const membri = new Map<string, Porta>([[k, [...m.values()][0].da]]);
    const altri = new Set<string>();
    for (const p of m.values()) {
      if (p.altro && p.altro.chiave !== null) { chiavi.add(chiaveDi(p.altro)); membri.set(chiaveDi(p.altro), p.altro); }
      else altri.add(apparato(p));
    }
    const toccati = gruppi.filter((g) => [...chiavi].some((x) => g.chiavi.has(x)));
    const unito = { chiavi, membri, prove: [...m.values()], altri };
    for (const g of toccati) {
      for (const x of g.chiavi) unito.chiavi.add(x);
      for (const [x, p] of g.membri) unito.membri.set(x, p);
      unito.prove.push(...g.prove);
      for (const x of g.altri) unito.altri.add(x);
      gruppi.splice(gruppi.indexOf(g), 1);
    }
    gruppi.push(unito);
  }
  const idPorta = (p: Porta): string => (p.chiave?.startsWith("i:") ? p.chiave.slice(2) : `n-${encodeURIComponent(p.chiave ? p.chiave.slice(2) : normale(p.nome))}`);
  const segmenti: Segmento[] = [];
  for (const g of gruppi) {
    const gestiti = [...g.membri.values()].filter((p) => p.nodo.startsWith("dev:"))
      .sort((x, y) => Number(x.nodo.slice(4)) - Number(y.nodo.slice(4)) || cmp(idPorta(x), idPorta(y)));
    const primo = gestiti[0];
    if (!primo) continue;
    const id = `seg:${primo.nodo.slice(4)}:${idPorta(primo)}`;
    const nomi = [...g.membri.values()].map((p) => ctx.idx.nodes.get(p.nodo)?.name ?? p.nodo);
    const frase = `Sulla porta ${primo.nome} si sentono ${g.membri.size - 1 + g.altri.size} apparati (${nomi.join(", ")}${g.altri.size > 0 ? ` e altri ${g.altri.size} non gestiti` : ""}): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).`;
    segmenti.push({ id, membri: [...g.membri.values()], altriApparati: g.altri.size, frase });
    for (const [k, p] of g.membri) {
      const prova = g.prove.find((x) => chiaveDi(x.da) === k || (x.altro !== null && chiaveDi(x.altro) === k)) ?? g.prove[0];
      const z = aggiungi("segmento", p, portaVuota(id), prova, null);
      const figlio = uplinkSuSegmento.get(k);
      if (figlio) z.verso = figlio;
      tenute.push(z);
    }
  }

  // «Ignora» per cavo (§13.9): una correzione toglie il collegamento con quelle porte; le altre restano. Le orfane si contano.
  const ig = regoleIgnora(correzioni, ctx.idx, ctx.portaSalvata);
  const rimaste = [...new Set(tenute)].filter((z) => z.genere === "segmento" || !ignorato(ig, z.a.nodo, z.a, z.b.nodo, z.b));

  // I fasci (§13.6.3): provati (stesso fascio letto a un capo) o dedotti (due o più cavi in inoltro fra gli stessi due
  // apparati con lo spanning tree attivo fra loro). Una linea sola, i membri elencati, la velocità somma dei membri accesi.
  const perCoppia = new Map<string, Bozza[]>();
  for (const z of rimaste) {
    if (z.genere !== "cavo" || z.wan) continue;
    const k = [z.a.nodo, z.b.nodo].sort().join("|");
    const v = perCoppia.get(k) ?? [];
    v.push(z);
    perCoppia.set(k, v);
  }
  const fasci = new Map<Bozza, { membri: Bozza[]; dedotto: boolean; lagA: string | null; lagB: string | null }>();
  const neiFasci = new Set<Bozza>();
  for (const cavi of perCoppia.values()) {
    if (cavi.length < 2) continue;
    const perLag = new Map<string, Bozza[]>();
    for (const z of cavi) {
      const la = statoCapo(z.a).lag, lb = statoCapo(z.b).lag;
      const k = la !== null ? `a:${z.a.nodo}:${la}` : lb !== null ? `b:${z.b.nodo}:${lb}` : null;
      if (k === null) continue;
      const v = perLag.get(k) ?? [];
      v.push(z);
      perLag.set(k, v);
    }
    for (const membri of perLag.values()) {
      if (membri.length < 2) continue;
      fasci.set(membri[0], { membri, dedotto: false, lagA: statoCapo(membri[0].a).lag, lagB: statoCapo(membri[0].b).lag });
      for (const z of membri) neiFasci.add(z);
    }
    const liberi = cavi.filter((z) => !neiFasci.has(z));
    const attivi = liberi.filter((z) => {
      const sa = statoCapo(z.a), sb = statoCapo(z.b);
      return !sa.giu && !sb.giu && !sa.bloccato && !sb.bloccato && !sa.instradato && !sb.instradato && sa.stpAttivo && sb.stpAttivo;
    });
    if (attivi.length >= 2) {
      fasci.set(attivi[0], { membri: attivi, dedotto: true, lagA: null, lagB: null });
      for (const z of attivi) neiFasci.add(z);
    }
  }

  const FIDUCIA_ORDINE: Readonly<Record<Fiducia, number>> = { certo: 0, probabile: 1, dedotto: 2, a_mano_confermato: 3, a_mano: 4 };
  const fiduciaDi = (z: Bozza): Fiducia => {
    const dati = z.prove.filter((p) => p.tipo !== "a_mano" && p.tipo !== "bordo");
    if (dati.length > 0) {
      if (z.osservatori.has(z.a.nodo) && z.osservatori.has(z.b.nodo)) return "certo";
      // LLDP da un capo, e il bridge designato della porta radice dell'altro capo che indica lo stesso apparato, letto da chi
      // riceve RSTP dall'altro capo (la trappola della radice regionale, §13.8.3 punto 2).
      for (const [oss, altro] of [[z.a.nodo, z.b], [z.b.nodo, z.a]] as const) {
        if (!z.osservatori.has(oss) || altro.nodo.startsWith("seg:")) continue;
        const macOss = new Set([...(ctx.macApparati.get(oss) ?? []), ...ctx.fatti.bridge(oss).map((b) => macDelBridge(b.bridge_id)).filter((m): m is string => !!m)]);
        if (ctx.fatti.porta(altro.nodo, altro).some((f) => f.stp_role === "root" && f.sending_rstp !== 0 && macOss.has(macDelBridge(f.designated_bridge) ?? ""))) return "certo";
      }
      return "probabile";
    }
    if (z.prove.some((p) => p.tipo === "bordo")) return "dedotto";
    return z.prove.some((p) => p.tipo === "a_mano" && p.confermato) ? "a_mano_confermato" : "a_mano";
  };
  const statoDi = (z: Bozza, capi: Array<{ a: Porta; b: Porta }>): { stato: StatoCollegamento; vlan?: number[] } => {
    // Giù se è giù un capo di ogni cavo: per un cavo solo, un capo; per un fascio, tutti i membri.
    if (capi.length > 0 && capi.every((x) => statoCapo(x.a).giu || statoCapo(x.b).giu)) return { stato: "giu" };
    const s = capi.flatMap((x) => [statoCapo(x.a), statoCapo(x.b)]);
    if (s.some((x) => x.bloccato)) {
      // Bloccato nell'albero comune, attivo per le VLAN di un'istanza se i due capi sono della stessa regione MSTP e il
      // collegamento è la porta radice di un'istanza su uno dei due capi.
      const reg = (n: string) => ctx.fatti.bridge(n).find((b) => b.instance === 0 && b.region_name !== null);
      const ra = reg(z.a.nodo), rb = reg(z.b.nodo);
      if (ra && rb && ra.region_name === rb.region_name && ra.region_revision === rb.region_revision && ra.config_digest !== null && ra.config_digest === rb.config_digest) {
        for (const p of [z.a, z.b]) {
          const ist = ctx.fatti.bridge(p.nodo).find((b) => b.instance > 0 && b.root_port !== null && normale(b.root_port) === normale(p.nome));
          if (ist) return { stato: "bloccato_comune", vlan: vlanDa(ist.vlans) };
        }
      }
      return { stato: "bloccato" };
    }
    if (z.wan || s.some((x) => x.instradato)) return { stato: "instradato" };
    if (s.some((x) => x.riserva)) return { stato: "riserva_bond" };
    return { stato: "inoltra" };
  };
  const nonVistoDi = (z: Bozza): boolean => {
    if (z.prove.some((p) => p.tipo === "a_mano")) return false;
    const t = z.prove.map((p) => tempo(p.visto)).filter((x): x is number => x !== null);
    return t.length > 0 && ctx.nowMs - Math.max(...t) > finestra;
  };
  const velocitaCavo = (z: Bozza): number | null => {
    const v = [velocitaDi(z.a), velocitaDi(z.b)].filter((x): x is number => x !== null);
    return v.length > 0 ? Math.min(...v) : null;
  };

  const collegamenti: Collegamento[] = [];
  for (const z of rimaste) {
    if (neiFasci.has(z) && !fasci.has(z)) continue;
    const f = fasci.get(z);
    const membri = f?.membri ?? [z];
    const tutte = membri.flatMap((m) => m.prove);
    const sintesi: Bozza = { ...z, prove: tutte, osservatori: new Set(membri.flatMap((m) => [...m.osservatori])) };
    // Lo stato di un fascio è quello del fascio (lo spanning tree lo vede come una porta sola), letto sull'interfaccia del fascio.
    const capi = f && f.lagA ? [{ a: { ...z.a, chiave: `n:${normale(f.lagA)}`, nome: f.lagA }, b: f.lagB ? { ...z.b, chiave: `n:${normale(f.lagB)}`, nome: f.lagB } : z.b }] : membri.map((m) => ({ a: m.a, b: m.b }));
    const st = statoDi(sintesi, capi);
    const fiducia = fiduciaDi(sintesi);
    const membriStato = f ? membri.map((m) => ({ a: m.a, b: m.b, stato: statoDi(m, [{ a: m.a, b: m.b }]).stato })) : undefined;
    const velocita = f ? membri.filter((m, i) => membriStato?.[i].stato !== "giu").map(velocitaCavo).reduce<number | null>((s, v) => (v === null ? s : (s ?? 0) + v), null) : velocitaCavo(z);
    collegamenti.push({
      id: "", a: z.a, b: z.b, genere: f ? "fascio" : z.genere, ...(membriStato ? { membri: membriStato } : {}),
      ...(f ? { fascio: { a: f.lagA, b: f.lagB }, fascioDedotto: f.dedotto } : {}),
      stato: z.genere === "segmento" ? (statoCapo(z.a).giu ? "giu" : "inoltra") : st.stato, ...(st.vlan ? { attivoPerVlan: st.vlan } : {}),
      fiducia: z.genere === "segmento" || z.genere === "tunnel" ? (fiducia === "certo" ? "probabile" : fiducia) : z.attraverso && fiducia === "certo" ? "probabile" : fiducia,
      verso: sintesi.wan ? null : z.verso, velocitaMbps: velocita, porteDaVerificare: membri.some((m) => m.porteDaVerificare),
      prove: tutte, frasi: [...new Set(tutte.map((p) => p.frase))], nonVisto: nonVistoDi(sintesi),
      ...(z.wan ? { wan: true } : {}), ...(z.attraverso ? { attraverso: true } : {}), ...(z.vm > 0 ? { vm: z.vm } : {}),
    });
  }
  // L'id: il genere e i due capi ordinati con la chiave della porta; un doppio (due cavi con le porte non note) prende «#n».
  const visti = new Map<string, number>();
  for (const c of collegamenti.sort((x, y) => cmp([chiaveDi(x.a), chiaveDi(x.b)].sort().join("~"), [chiaveDi(y.a), chiaveDi(y.b)].sort().join("~")) || cmp(x.genere, y.genere))) {
    const base = `${c.genere}:${[chiaveDi(c.a), chiaveDi(c.b)].sort().join("~")}`;
    const n = visti.get(base) ?? 0;
    visti.set(base, n + 1);
    c.id = n === 0 ? base : `${base}#${n + 1}`;
    c.frasi.push(`→ ${PAROLE_FIDUCIA[c.fiducia]}${c.stato && c.stato !== "inoltra" ? `, ${c.stato.replace("_", " ")}` : ""}`);
  }
  collegamenti.sort((x, y) => cmp(x.id, y.id) || FIDUCIA_ORDINE[x.fiducia] - FIDUCIA_ORDINE[y.fiducia]);
  return { collegamenti, segmenti: segmenti.sort((x, y) => cmp(x.id, y.id)), stessaRete, correzioniOrfane: correzioniOrfane(ig, correzioni) };
}
```

- [ ] **Step 3: la preparazione** — `src/lib/topology/cavi/modello.ts` (la seconda parte arriva col Task 11):

```ts
/**
 * Il modello per cavo in ombra (spec topologia §13.11.3, T2.7): dall'ingresso alle prove, ai collegamenti e (Task 11)
 * all'albero dallo spanning tree. L'identità degli oggetti è quella del modello di oggi (stessi nodi, stessi id), con in più
 * i MAC degli apparati letti in T2 (solo per abbinare le righe). Logica pura; si calcola a richiesta e non si salva.
 */
import { parseSpeedMbps } from "@/lib/topology/link-attrs";
import { comeDi, portaSalvata } from "@/lib/topology/links";
import type { TopologyModel } from "@/lib/topology/model-types";
import { addNodeMacs, buildNodeIndex, type NodeIndex } from "@/lib/topology/node-index";
import { resolveScanHosts } from "@/lib/topology/vms";
import type { ContestoCavi } from "./collegamenti";
import type { ElencoPorte } from "./porte";
import { elenchiCavi, indiceFatti, proveDaInput, type IndiceFatti, type IngressoCavi, type Prova } from "./prove";

export interface PreparatoCavi { idx: NodeIndex; prove: Prova[]; ctx: ContestoCavi; elenchi: Map<string, ElencoPorte>; fatti: IndiceFatti }

export function preparaCavi(ing: IngressoCavi, t1: TopologyModel): PreparatoCavi {
  const idx = buildNodeIndex(ing.t1.devices, ing.t1.hosts, ing.t1.knownMacs, ing.t1.neighbors);
  for (const { row, nodeId } of resolveScanHosts(ing.t1.scanHosts, idx)) if (nodeId) addNodeMacs(idx, nodeId, row.macs);
  const macApparati = new Map<string, Set<string>>();
  for (const m of ing.macApparati) {
    const nodo = `dev:${m.device_id}`;
    const s = macApparati.get(nodo) ?? new Set<string>();
    s.add(m.mac.toUpperCase());
    macApparati.set(nodo, s);
  }
  for (const [nodo, macs] of macApparati) if (idx.nodes.has(nodo)) addNodeMacs(idx, nodo, [...macs]);
  const elenchi = elenchiCavi(ing);
  const fatti = indiceFatti(ing);
  const prove = proveDaInput(ing, { idx, elenchi, come: comeDi(ing.t1), fatti }, t1);
  const velocita = new Map<string, number>();
  const statoPorte = new Map<string, "su" | "giu" | "spenta">();
  for (const p of ing.t1.ports ?? []) {
    const k = `dev:${p.device_id}|i:${p.port_index}`;
    const v = parseSpeedMbps(p.speed);
    if (v) velocita.set(k, v);
    const s = p.status === "up" ? "su" : p.status === "down" ? "giu" : p.status === "disabled" ? "spenta" : null;
    if (s) statoPorte.set(k, s);
  }
  const router = new Set([...idx.nodes.values()].filter((n) => n.type === "router" || n.type === "firewall").map((n) => n.id));
  const vmIpervisore = new Map(t1.vms.flatMap((v) => (v.nodeId && v.hypervisorNodeId ? [[v.nodeId, v.hypervisorNodeId] as const] : [])));
  const ctx: ContestoCavi = {
    nowMs: ing.t1.nowMs, staleDays: ing.t1.staleDays, porte: elenchi, fatti, statoPorte, velocita, macApparati, idx, router, vmIpervisore,
    portaSalvata: portaSalvata(ing.t1),
  };
  return { idx, prove, ctx, elenchi, fatti };
}
```

- [ ] **Step 4: verde** — `cavi-collegamenti.test.ts`, `cavi-prove.test.ts`, `cavi-senza-prodotti.test.ts`, `npx tsc --noEmit`,
  tutti `exit=0`. Se una prova non passa, si legge il collegamento costruito (`JSON.stringify` nella prova, una volta) e si
  corregge **il codice o la prova con il perché scritto nel resoconto**, mai la prova da sola per farla passare.

- [ ] **Step 5: commit** — `git add src/lib/topology/cavi/collegamenti.ts src/lib/topology/cavi/modello.ts
  src/lib/topology/__tests__/cavi-collegamenti.test.ts`, `git commit -m "feat(topologia): collegamenti per cavo in ombra (T2.7)"`.

---
### Task 11: l'albero dallo spanning tree e il modello in ombra (T2.7, terza parte)

Spec §13.8.3 punti 1-8 (porta radice dell'albero comune; uplink del controller solo se non è fermo; il gateway del
controller non sceglie; la trappola della radice regionale; Prim con la chiave del punto 3; bloccati, instradati e
segmenti; dove lo spanning tree manca; il principale dell'hypervisor; la testa; l'anomalia «core che esce da uno switch di
accesso»), prove I20, I22, I23, I24, I49, I50, I63, I67, I68 nella forma del modello per cavo. I punti 9 e 10 (seconda
partenza, «★ non applicabile») sono del pannello: T3.

**Files:**
- Create: `src/lib/topology/cavi/albero.ts`
- Modify: `src/lib/topology/cavi/modello.ts` (`costruisciModelloCavi`, `ModelloCavi`, `NON_CALCOLATO_IN_T2`)
- Test: `src/lib/topology/__tests__/cavi-albero.test.ts`

**Interfaces:**
- Consumes: Task 10 (`Collegamento`, `Fiducia`, `capo`, `altroCapo`, `preparaCavi`, `costruisciCollegamenti`); Task 9
  (`IngressoCavi`, `FattoBridge`, `lettoreDellaFonte` da `lettori/fonti.ts`); `nodeClass`; `normale`.
- Produces (`cavi/albero.ts`): `NodoCavi`, `Anomalia`, `IngressoAlbero`, `AlberoCavi`, `scelte(ing)`,
  `chiaveCavo(c, da, to, ctx): number[]`, `testaCavi(ing, radiciStp): string | null`, `alberoCavi(ing): AlberoCavi`.
- Produces (`cavi/modello.ts`): `ModelloCavi`, `NON_CALCOLATO_IN_T2`,
  `costruisciModelloCavi(ing: IngressoCavi, t1: TopologyModel, opz: { testaScelta: string | null }): ModelloCavi`.

- [ ] **Step 1: le prove, viste fallire** — `src/lib/topology/__tests__/cavi-albero.test.ts`:

```ts
// L'albero dallo spanning tree (spec topologia §13.8.3), in ombra: la porta radice sceglie; un bloccato fa da padre solo se
// non c'è altro; un instradato non batte un percorso nel bridge, ma verso un segmento non perde; il segmento sotto il membro
// più vicino alla testa; il gateway del controller attaccato per la LAN; «disabled» su una porta accesa sceglie; l'anomalia
// «core che esce da uno switch di accesso»; la testa dalle prove, mai per id. Reti piccole inventate: le righe stanno
// nell'ingresso del modello di oggi (fonti `device` e `unifi`), così la classe di ogni oggetto è quella della mappa di oggi.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import type { IngressoCavi } from "@/lib/topology/cavi/prove";
import type { ModelDeviceRow, ModelNeighborRow, TopologyModelInput } from "@/lib/topology/model-types";
import { baseInput, dev } from "./support/righe";
import { porte } from "./support/reti-campione";
import { fb, fp, ingresso, vic } from "./support/cavi";

const ombra = (ing: IngressoCavi, testa: string | null = null) => costruisciModelloCavi(ing, buildTopologyModel(ing.t1), { testaScelta: testa });
const mk = { vendor: "mikrotik", via: "ssh" } as const;
const lan = (n: number) => ({ id: n, cidr: `10.${n}.0.0/24`, name: `rete ${n}`, gateway: `10.${n}.0.1`, location_id: null });
/** Le righe dei due capi di un cavo fra due MikroTik letti via SSH, porte col nome di fabbrica. */
const cavo = (a: number, pa: string, b: number, pb: string, nomeB: string, nomeA: string): ModelNeighborRow[] => [
  vic({ device_id: a, local_port: `${pa},bridge`, remote_device_name: nomeB, remote_port: `bridge/${pb}`, source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: b, local_port: `${pb},bridge`, remote_device_name: nomeA, remote_port: `bridge/${pa}`, source: "device", remote_platform: "MikroTik" }),
];
const rete = (devices: ModelDeviceRow[], neighbors: ModelNeighborRow[], over: Partial<TopologyModelInput> = {}) =>
  baseInput({ devices, neighbors, networks: [lan(1)], ...over });
const fra = (m: ReturnType<typeof ombra>, x: string, y: string) =>
  m.collegamenti.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));

test("I24 e punto 1: la porta radice sceglie il padre", () => {
  const t1 = rete([dev(1, { name: "RTR-1", device_type: "router", host: "10.1.0.1", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")]);
  const m = ombra(ingresso(t1, {
    fattiBridge: [fb(3, { bridge_id: "32768.02:00:00:00:00:03", root_id: "0.02:00:00:00:00:01", root_port: "ether2" }), fb(1, { bridge_id: "0.02:00:00:00:00:01", root_id: "0.02:00:00:00:00:01" })],
  }));
  assert.equal(m.albero.testa, "dev:1");
  assert.equal(m.albero.padri["dev:3"], "dev:2", "la porta radice di SW-3 va verso SW-2");
});

test("un collegamento bloccato fa da padre solo se non c'è altro (I24)", () => {
  const d = [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })];
  const bloccato = ombra(ingresso(rete(d, [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")]),
    { fattiPorta: [fp(3, "n:ether3", "ether3", { source: "device", stp_state: "discarding", stp_role: "alternate" })] }));
  assert.equal(bloccato.albero.padri["dev:3"], "dev:2");
  const solo = ombra(ingresso(rete(d, cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")), { fattiPorta: [fp(3, "n:ether3", "ether3", { source: "device", stp_state: "discarding" })] }));
  assert.equal(solo.albero.padri["dev:3"], "dev:1", "senza altro, il bloccato fa da padre");
});

test("I23: un instradato non batte un percorso nel bridge", () => {
  const t1 = rete([dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(4, { name: "SW-4", ...mk })], [
    vic({ device_id: 1, local_port: "ether2", remote_device_name: "SW-4", remote_port: "bridge/ether4", source: "device", remote_platform: "MikroTik" }),
    ...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether3", 4, "ether3", "SW-4", "SW-2"),
  ]);
  const m = ombra(ingresso(t1));
  assert.equal(fra(m, "dev:1", "dev:4")[0]?.stato, "instradato", "la porta del router è fuori dal bridge");
  assert.equal(m.albero.padri["dev:4"], "dev:2");
});

test("I49 e I50 (S10): il segmento sta sotto il membro più vicino alla testa, anche fuori dal bridge; a pari fiducia un cavo vero batte il segmento", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(9, { name: "RTR-RIS", device_type: "router", ...mk }), dev(5, { name: "SW-5", ...mk })],
    [
      ...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"),
      // la WAN di RTR-1 (fuori dal bridge) e la porta 8 di SW-2 sentono tutte e due RTR-RIS (e la WAN anche un modem): un segmento
      vic({ device_id: 1, local_port: "ether8", remote_device_name: "RTR-RIS", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 1, local_port: "ether8", remote_device_name: "MODEM", remote_port: "eth0", source: "device", remote_mac: "02:00:00:00:77:01" }),
      vic({ device_id: 2, local_port: "ether8,bridge", remote_device_name: "RTR-1", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
      vic({ device_id: 2, local_port: "ether8,bridge", remote_device_name: "RTR-RIS", remote_port: "ether8", source: "device", remote_platform: "MikroTik" }),
      // RTR-RIS ha anche un cavo vero verso SW-5, che sta sotto SW-2
      ...cavo(2, "ether5", 5, "ether5", "SW-5", "SW-2"), ...cavo(5, "ether6", 9, "ether6", "RTR-RIS", "SW-5"),
    ],
    {
      ports: [...porte(1, [[1, "ether1", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]), ...porte(2, [[1, "ether1", "1000 Mbps"], [5, "ether5", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]),
        ...porte(9, [[6, "ether6", "1000 Mbps"], [8, "ether8", "1000 Mbps"]]), ...porte(5, [[5, "ether5", "1000 Mbps"], [6, "ether6", "1000 Mbps"]])],
    },
  );
  const m = ombra(ingresso(t1), "dev:1");
  const seg = m.segmenti.find((s) => s.membri.some((p) => p.nodo === "dev:1"));
  assert.ok(seg, "c'è il segmento della WAN");
  assert.equal(seg.id, "seg:1:8");
  assert.equal(m.albero.padri[seg.id], "dev:1", "sotto la porta della WAN di RTR-1, non sotto SW-2 per alfabeto");
  assert.equal(m.albero.padri["dev:9"], "dev:5", "il cavo vero batte l'appartenenza al segmento");
});

test("I67 e I68: «disabled» su una porta accesa sceglie e non è un'anomalia; il gateway del controller è attaccato per la LAN", () => {
  const u = { vendor: "ubiquiti", via: "api" } as const;
  const t1 = rete(
    [
      dev(1, { name: "GW", device_type: "router", controller_mac: "02:00:d0:00:01:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 25, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
      dev(2, { name: "AGG", controller_mac: "02:00:d0:00:02:00", ...u }),
      dev(4, { name: "FLEX", controller_mac: "02:00:d0:00:04:00", uplink_mac: "02:00:d0:00:02:00", uplink_remote_port: 7, uplink_seen_at: "2026-10-13 03:00:00", ...u }),
    ],
    [
      vic({ device_id: 2, local_port: "SFP28 25", remote_device_name: "GW", remote_mac: "02:00:d0:00:01:00", remote_port: "SFP+ 1" }),
      vic({ device_id: 2, local_port: "SFP+ 2", remote_device_name: "GW", remote_mac: "02:00:d0:00:01:00", remote_port: "SFP+ 2" }),
      vic({ device_id: 4, local_port: "Port 1", remote_device_name: "AGG", remote_mac: "02:00:d0:00:02:00", remote_port: "Port 7" }),
    ],
    {
      uplinkPorts: [{ device_id: 1, port_index: 10, port_name: "SFP+ 1" }, { device_id: 4, port_index: 1, port_name: "Port 1" }],
      ports: [...porte(1, [[10, "SFP+ 1", "10000 Mbps"], [11, "SFP+ 2", "10000 Mbps"]]), ...porte(2, [[2, "SFP+ 2", "10000 Mbps"], [7, "Port 7", "1000 Mbps"], [25, "SFP28 25", "10000 Mbps"]]),
        ...porte(4, [[1, "Port 1", "1000 Mbps"]])],
    },
  );
  const m = ombra(ingresso(t1, { fattiPorta: [fp(4, "i:1", "Port 1", { stp_state: "disabled" })] }), "dev:1");
  const via = m.albero.via.get("dev:2");
  assert.ok(via && !via.wan, "AGG appeso al gateway per la LAN, non per la WAN");
  assert.equal(fra(m, "dev:1", "dev:2").filter((c) => c.wan).length, 1, "la WAN c'è, instradata");
  assert.equal(m.albero.padri["dev:4"], "dev:2");
  assert.ok(m.albero.scelto.has("dev:4"), "l'uplink «disabled» su una porta accesa sceglie");
  assert.deepEqual(m.albero.anomalie, []);
});

test("punto 8: «core che esce da uno switch di accesso» con cavi verso almeno altri due switch dello stesso livello del padre", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(10, { name: "CORE-1", ...mk }), dev(21, { name: "ACC-A", ...mk }), dev(22, { name: "ACC-B", ...mk }), dev(23, { name: "ACC-C", ...mk }), dev(11, { name: "CORE-2", ...mk })],
    [
      ...cavo(1, "ether1", 10, "ether1", "CORE-1", "RTR-1"),
      ...cavo(10, "ether2", 21, "ether2", "ACC-A", "CORE-1"), ...cavo(10, "ether3", 22, "ether3", "ACC-B", "CORE-1"), ...cavo(10, "ether4", 23, "ether4", "ACC-C", "CORE-1"),
      ...cavo(23, "ether9", 11, "ether9", "CORE-2", "ACC-C"), ...cavo(21, "ether8", 11, "ether8", "CORE-2", "ACC-A"), ...cavo(22, "ether7", 11, "ether7", "CORE-2", "ACC-B"),
    ],
  );
  const m = ombra(ingresso(t1, { fattiPorta: [fp(11, "n:ether8", "ether8", { source: "device", stp_state: "discarding" }), fp(11, "n:ether7", "ether7", { source: "device", stp_state: "discarding" })] }), "dev:1");
  assert.equal(m.albero.padri["dev:11"], "dev:23");
  assert.deepEqual(m.albero.anomalie, [{ nodo: "dev:11", padre: "dev:23", altri: ["dev:21", "dev:22"] }]);
});

test("I63 e punto 7: a pari nodi raggiunti la testa è il gateway di più reti, mai l'id", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-A", device_type: "router", host: "10.5.0.2", ...mk }), dev(2, { name: "RTR-B", device_type: "router", host: "10.1.0.1", ...mk }), dev(3, { name: "SW-3", ...mk })],
    [...cavo(1, "ether1", 3, "ether1", "SW-3", "RTR-A"), ...cavo(2, "ether1", 3, "ether2", "SW-3", "RTR-B")],
    { networks: [lan(1), { id: 2, cidr: "10.2.0.0/24", name: "rete 2", gateway: "10.1.0.1", location_id: null }] },
  );
  assert.equal(ombra(ingresso(t1)).albero.testa, "dev:2");
});

test("★ (I20): il principale scelto a mano vince sempre, anche su un bloccato", () => {
  const t1 = rete(
    [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")],
    { primaries: [{ node_id: "dev:3", other_node: "dev:1", node_port: "ether3", other_port: "ether3" }] },
  );
  const m = ombra(ingresso(t1, { fattiPorta: [fp(3, "n:ether3", "ether3", { source: "device", stp_state: "discarding" })] }), "dev:1");
  assert.equal(m.albero.padri["dev:3"], "dev:1");
});

test("I22: il bridge designato conferma un cavo già provato da LLDP; non sceglie il padre e non crea collegamenti", () => {
  const t1 = rete([dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk })],
    [vic({ device_id: 1, local_port: "ether1,bridge", remote_device_name: "SW-2", remote_port: "bridge/ether1", source: "device", remote_platform: "MikroTik" })]);
  const m = ombra(ingresso(t1, {
    fattiPorta: [fp(2, "n:ether1", "ether1", { source: "device", stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "0.02:00:00:00:00:01" })],
    fattiBridge: [fb(1, { bridge_id: "0.02:00:00:00:00:01", root_id: "0.02:00:00:00:00:01" })],
  }), "dev:1");
  assert.equal(m.collegamenti.length, 1);
  assert.equal(m.collegamenti[0].fiducia, "certo", "LLDP da un capo e il bridge designato della porta radice dell'altro");
});

test("lo schema assente si dice, e le parti non calcolate in T2 sono elencate", () => {
  const m = ombra({ ...ingresso(baseInput({ devices: [dev(2)] })), schema: false });
  assert.equal(m.schema, false);
  assert.ok(m.nonCalcolato.length >= 6);
});
```

```bash
node --import tsx --test src/lib/topology/__tests__/cavi-albero.test.ts > "$SCRATCH/t11-rosso.log" 2>&1; echo "exit=$?"
```

  Atteso: `exit=1`.

- [ ] **Step 2: l'albero** — `src/lib/topology/cavi/albero.ts`:

```ts
/**
 * L'albero del modello per cavo (spec topologia §13.8.3; T2 in ombra, T3 a schermo): lo decide lo spanning tree. Il
 * collegamento scelto di ogni bridge è quello sulla sua porta radice dell'albero comune; per un apparato del controller la
 * porta di uplink, se non è ferma; il gateway del controller non sceglie (la sua uscita è la WAN). Prim con le due passate
 * di oggi e la chiave del punto 3; la testa dalle prove; l'anomalia «core che esce da uno switch di accesso». Il bridge
 * designato non sceglie e non crea: conferma (collegamenti.ts). Logica pura, deterministica.
 */
import type { ClasseMappa } from "@/lib/topology/model-types";
import { altroCapo, capo, type Collegamento, type Fiducia } from "./collegamenti";
import { normale, type Porta } from "./porte";

export interface NodoCavi { id: string; classe: ClasseMappa | "segmento"; tipo: string; numero: number; hidden: boolean }
export interface Anomalia { nodo: string; padre: string; altri: string[] }

export interface IngressoAlbero {
  nodi: ReadonlyMap<string, NodoCavi>;
  visibili: ReadonlySet<string>;
  collegamenti: readonly Collegamento[];
  /** La testa confermata (della mappa automatica o della sede); null = la propone il sistema. */
  testaConfermata: string | null;
  /** La porta radice dell'albero comune letta dal bridge del nodo («radice» = il nodo è la radice). */
  portaRadice: ReadonlyMap<string, string>;
  /** La porta di uplink del controller per i suoi apparati. */
  portaUplink: ReadonlyMap<string, Pick<Porta, "chiave" | "nome">>;
  /** Gli apparati del controller che fanno da router: la loro uscita è la WAN, non scelgono il padre. */
  gateway: ReadonlySet<string>;
  gatewayDi: Readonly<Record<string, number>>;
  primari: ReadonlyArray<{ node_id: string; other_node: string }>;
  ipervisori: ReadonlySet<string>;
}

export interface AlberoCavi {
  radici: string[];
  /** Il padre di ogni oggetto dell'albero (le radici: null). */
  padri: Record<string, string | null>;
  via: Map<string, Collegamento>;
  profondita: Map<string, number>;
  /** nodo → id del collegamento scelto dallo spanning tree (punto 1). */
  scelto: ReadonlyMap<string, string>;
  anomalie: Anomalia[];
  /** In parole, senza dati: «uplink del controller su una porta ferma», «la porta radice non ha un collegamento». */
  avvisi: Array<{ nodo: string; testo: string }>;
  testa: string | null;
}

const RADICE = "radice";
const FIDUCIA: Readonly<Record<Fiducia, number>> = { certo: 0, probabile: 1, dedotto: 2, a_mano_confermato: 3, a_mano: 4 };
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const fermo = (c: Collegamento): boolean => c.stato === "bloccato" || c.stato === "bloccato_comune";
const migliore = (cs: readonly Collegamento[]): Collegamento | undefined =>
  [...cs].sort((x, y) => Number(x.nonVisto) - Number(y.nonVisto) || FIDUCIA[x.fiducia] - FIDUCIA[y.fiducia] || cmp(x.id, y.id))[0];

/** Il collegamento sta su quella porta del nodo: per nome, per chiave «n:», o perché è il fascio con quel nome. */
function suPorta(c: Collegamento, nodo: string, nome: string): boolean {
  const p = capo(c, nodo);
  const n = normale(nome);
  const fascio = c.fascio ? (c.a.nodo === nodo ? c.fascio.a : c.fascio.b) : null;
  return normale(p.nome) === n || p.chiave === `n:${n}` || (fascio !== null && normale(fascio) === n);
}

/** Punto 1: il collegamento scelto di ogni nodo. */
export function scelte(ing: IngressoAlbero): { scelto: Map<string, string>; avvisi: Array<{ nodo: string; testo: string }>; radiciStp: Set<string> } {
  const scelto = new Map<string, string>();
  const avvisi: Array<{ nodo: string; testo: string }> = [];
  const radiciStp = new Set<string>();
  const di = (nodo: string) => ing.collegamenti.filter((c) => c.a.nodo === nodo || c.b.nodo === nodo);
  for (const [nodo, rp] of [...ing.portaRadice].sort(([a], [b]) => cmp(a, b))) {
    if (rp === RADICE) { radiciStp.add(nodo); continue; }
    const c = migliore(di(nodo).filter((x) => suPorta(x, nodo, rp)));
    if (!c) { avvisi.push({ nodo, testo: "la porta radice non ha un collegamento visto: decide il ripiego" }); continue; }
    if (c.nonVisto) { avvisi.push({ nodo, testo: "il collegamento della porta radice non è visto da giorni: decide il ripiego" }); continue; }
    scelto.set(nodo, c.id);
  }
  for (const [nodo, p] of [...ing.portaUplink].sort(([a], [b]) => cmp(a, b))) {
    if (scelto.has(nodo) || ing.portaRadice.has(nodo) || ing.gateway.has(nodo)) continue;
    const c = migliore(di(nodo).filter((x) => (p.chiave !== null && capo(x, nodo).chiave === p.chiave) || (p.nome !== "" && normale(capo(x, nodo).nome) === normale(p.nome))));
    if (!c || c.nonVisto) continue;
    if (fermo(c)) { avvisi.push({ nodo, testo: "uplink del controller su una porta ferma" }); continue; }
    scelto.set(nodo, c.id);
  }
  return { scelto, avvisi, radiciStp };
}

/** Punto 3: la chiave con cui Prim sceglie, confrontata elemento per elemento (vince la più piccola). */
export function chiaveCavo(c: Collegamento, da: string, to: string, ctx: { scelto: ReadonlyMap<string, string>; stella: (c: Collegamento, to: string) => boolean; profondita: ReadonlyMap<string, number> }): number[] {
  const versoSegmento = to.startsWith("seg:") || da.startsWith("seg:");
  return [
    ctx.stella(c, to) ? 0 : 1,
    ctx.scelto.get(to) === c.id ? 0 : 1,
    c.nonVisto ? 1 : 0,
    c.stato === "giu" ? 1 : 0,
    fermo(c) ? 1 : 0,
    c.stato === "instradato" && !versoSegmento ? 1 : 0,
    FIDUCIA[c.fiducia],
    versoSegmento ? 1 : 0,
    versoSegmento ? (ctx.profondita.get(da) ?? 0) : 0,
    c.verso !== null && c.verso === da ? 1 : 0,
    -(c.velocitaMbps ?? 0),
  ];
}

function confronta(x: readonly number[], y: readonly number[]): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Punto 7: la testa confermata; altrimenti il router o firewall di rete che raggiunge più nodi coi collegamenti visti e non bloccati; a pari, il gateway di più reti, poi la radice dello spanning tree, l'id solo per ultimo. */
export function testaCavi(ing: IngressoAlbero, radiciStp: ReadonlySet<string>): string | null {
  if (ing.testaConfermata && ing.visibili.has(ing.testaConfermata)) return ing.testaConfermata;
  const vivi = new Map<string, string[]>();
  for (const c of ing.collegamenti) {
    if (c.nonVisto || fermo(c)) continue;
    vivi.set(c.a.nodo, [...(vivi.get(c.a.nodo) ?? []), c.b.nodo]);
    vivi.set(c.b.nodo, [...(vivi.get(c.b.nodo) ?? []), c.a.nodo]);
  }
  const reti = (id: string | null): number => (id ? (ing.gatewayDi[id] ?? 0) : 0);
  const radice = (id: string | null): number => (id && radiciStp.has(id) ? 1 : 0);
  let best: string | null = null;
  let size = -1;
  const candidati = [...ing.nodi.values()].filter((n) => (n.tipo === "router" || n.tipo === "firewall") && n.classe === "infra" && ing.visibili.has(n.id))
    .sort((a, b) => a.numero - b.numero);
  for (const n of candidati) {
    const visti = new Set([n.id]);
    const coda = [n.id];
    while (coda.length) for (const y of vivi.get(coda.shift()!) ?? []) if (!visti.has(y)) { visti.add(y); coda.push(y); }
    const s = visti.size;
    if (s > size || (s === size && (reti(n.id) > reti(best) || (reti(n.id) === reti(best) && radice(n.id) > radice(best))))) {
      size = s;
      best = n.id;
    }
  }
  return best;
}

export function alberoCavi(ing: IngressoAlbero): AlberoCavi {
  const { scelto, avvisi, radiciStp } = scelte(ing);
  const testa = testaCavi(ing, radiciStp);
  const adj = new Map<string, Collegamento[]>();
  for (const c of ing.collegamenti) {
    if (!ing.visibili.has(c.a.nodo) || !ing.visibili.has(c.b.nodo)) continue;
    adj.set(c.a.nodo, [...(adj.get(c.a.nodo) ?? []), c]);
    adj.set(c.b.nodo, [...(adj.get(c.b.nodo) ?? []), c]);
  }
  // Foglie (come oggi): attaccati, client, hypervisor e «da sistemare» non fanno da ponte; il segmento sì.
  const foglia = (id: string): boolean => {
    const k = ing.nodi.get(id)?.classe;
    return k === undefined || k === "att" || k === "client" || k === "hyper" || k === "da_sistemare";
  };
  const forzati = new Map<string, string>();
  // ★ (I20): vince sempre, se raggiungibile.
  for (const s of ing.primari) {
    const c = migliore((adj.get(s.node_id) ?? []).filter((x) => altroCapo(x, s.node_id).nodo === s.other_node));
    if (c) forzati.set(s.node_id, c.id);
  }
  // Punto 6: il principale dell'hypervisor (§12.5): prima il non vecchio, poi il non giù, poi il più veloce, poi più VM.
  for (const id of ing.ipervisori) {
    if (forzati.has(id)) continue;
    const cs = (adj.get(id) ?? []).filter((c) => c.fiducia !== "a_mano" && c.fiducia !== "a_mano_confermato" && !foglia(altroCapo(c, id).nodo));
    if (cs.length < 2) continue;
    const c = [...cs].sort((x, y) => Number(x.nonVisto) - Number(y.nonVisto) || Number(x.stato === "giu") - Number(y.stato === "giu")
      || (y.velocitaMbps ?? 0) - (x.velocitaMbps ?? 0) || (y.vm ?? 0) - (x.vm ?? 0) || cmp(x.id, y.id))[0];
    forzati.set(id, c.id);
  }
  const stella = (c: Collegamento, to: string): boolean => ing.primari.some((s) => s.node_id === to && altroCapo(c, to).nodo === s.other_node);
  const profondita = new Map<string, number>();
  const padri: Record<string, string | null> = {};
  const via = new Map<string, Collegamento>();
  const radici: string[] = [];
  const preso = new Set<string>();
  const cresci = (r: string): void => {
    preso.add(r);
    profondita.set(r, 0);
    padri[r] = null;
    radici.push(r);
    const scegli = (stretto: boolean) => {
      let best: { k: number[]; da: string; to: string; c: Collegamento } | null = null;
      for (const x of [...preso].sort()) {
        if (foglia(x)) continue;
        for (const c of adj.get(x) ?? []) {
          const to = altroCapo(c, x).nodo;
          if (preso.has(to)) continue;
          const f = forzati.get(to);
          if (stretto && f !== undefined && f !== c.id) continue;
          const k = chiaveCavo(c, x, to, { scelto, stella, profondita });
          const d = best ? confronta(k, best.k) : -1;
          if (!best || d < 0 || (d === 0 && `${x}|${to}` < `${best.da}|${best.to}`)) best = { k, da: x, to, c };
        }
      }
      return best;
    };
    for (;;) {
      const b = scegli(true) ?? scegli(false);
      if (!b) return;
      preso.add(b.to);
      profondita.set(b.to, (profondita.get(b.da) ?? 0) + 1);
      padri[b.to] = b.da;
      via.set(b.to, b.c);
    }
  };
  if (testa) cresci(testa);
  const resto = [...ing.visibili].filter((x) => !preso.has(x) && ing.nodi.has(x)).sort((a, b) =>
    Number(ing.nodi.get(a)?.classe !== "infra") - Number(ing.nodi.get(b)?.classe !== "infra")
    || (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) || cmp(a, b));
  for (const r of resto) if (!preso.has(r)) cresci(r);

  // Punto 8: uno switch X con padre P ha l'anomalia se ha cavi, anche bloccati, verso almeno altri due switch che stanno allo
  // stesso livello di P. Due soli uplink verso due switch dello stesso livello non la fanno scattare.
  const anomalie: Anomalia[] = [];
  for (const [x, p] of Object.entries(padri).sort(([a], [b]) => cmp(a, b))) {
    if (p === null || p.startsWith("seg:")) continue;
    const n = ing.nodi.get(x);
    const livello = profondita.get(p);
    if (!n || n.tipo !== "switch" || n.classe !== "infra" || livello === undefined) continue;
    const altri = [...new Set((adj.get(x) ?? []).map((c) => altroCapo(c, x).nodo))]
      .filter((y) => y !== p && ing.nodi.get(y)?.tipo === "switch" && profondita.get(y) === livello).sort();
    if (altri.length >= 2) anomalie.push({ nodo: x, padre: p, altri });
  }
  return { radici, padri, via, profondita, scelto, anomalie, avvisi, testa };
}
```

  (Nella prova dell'anomalia, CORE-2 ha cavi verso ACC-A, ACC-B e ACC-C, tutti allo stesso livello: il padre è ACC-C,
  gli «altri» sono ACC-A e ACC-B. Il testo di D2 e la forma corta «⚠ core sotto accesso» sono del pannello, T3. Gli
  apparati MikroTik senza `switch_ports` nelle prove non hanno un elenco: le chiavi «n:…» vengono dal nome, e i due capi di
  un cavo si completano a vicenda nell'unione delle prove.)

- [ ] **Step 3: il modello in ombra** — in fondo a `src/lib/topology/cavi/modello.ts`:

```ts
import { nodeClass } from "@/lib/topology/identity";
import { lettoreDellaFonte } from "@/lib/topology/lettori/fonti";
import { chiavePorta } from "./porte";
import { alberoCavi, type AlberoCavi, type NodoCavi } from "./albero";
import { costruisciCollegamenti, type Collegamento, type Segmento } from "./collegamenti";

/** Le parti del modello per cavo che T2 non calcola: la traccia le dice in una riga ciascuna (§13.11.3). */
export const NON_CALCOLATO_IN_T2: readonly string[] = [
  "«oltre» una radio non letta (§13.7.6, punto 5): arriva in T3",
  "router e firewall in una VM dentro il loro hypervisor (§13.7.8): arriva in T3",
  "i collegamenti «dalle VM» che non sono principali e che nessun'altra lettura vede (§13.15, punto 4): si misurano in T3",
  "l'ordine nuovo dell'abbinamento «telaio, nome, IP» (§13.6.4): arriva in T3",
  "le mappe passo passo (§13.7.7): la traccia guarda la mappa automatica",
  "lo stato per istanza dello spanning tree, finché le istanze non sono lette sulla forma vera",
  "le prove di ruolo coi fatti nuovi (BPDU ricevuti, capacità annunciate): la classe di ogni oggetto è quella della mappa di oggi; arrivano in T3",
];

export interface ModelloCavi {
  collegamenti: Collegamento[];
  segmenti: Segmento[];
  albero: AlberoCavi;
  correzioniOrfane: number[];
  /** false = lo schema delle letture in più non c'è: il modello per cavo lavora solo sulle righe di oggi, e la traccia lo dice. */
  schema: boolean;
  nonCalcolato: readonly string[];
}

const macDel = (id: string | null): string | null => (id ? (id.split(".").pop() ?? "").toLowerCase() : null);

export function costruisciModelloCavi(ing: IngressoCavi, t1: TopologyModel, opz: { testaScelta: string | null }): ModelloCavi {
  const p = preparaCavi(ing, t1);
  const { collegamenti, segmenti, correzioniOrfane } = costruisciCollegamenti(p.prove, ing.t1.overrides, p.ctx);
  const nodi = new Map<string, NodoCavi>();
  for (const n of p.idx.nodes.values()) {
    nodi.set(n.id, { id: n.id, classe: t1.classiMappa?.[n.id] ?? nodeClass(n), tipo: n.type, numero: n.refId, hidden: n.hidden });
  }
  for (const s of segmenti) nodi.set(s.id, { id: s.id, classe: "segmento", tipo: "segmento", numero: Number.MAX_SAFE_INTEGER, hidden: false });
  const collegati = new Set(collegamenti.flatMap((c) => [c.a.nodo, c.b.nodo]));
  const visibili = new Set([...nodi.values()].filter((n) => !n.hidden && n.classe !== "client" && n.classe !== "da_sistemare" && collegati.has(n.id)).map((n) => n.id));
  // Punto 1: la porta radice dai bridge letti (il controller non la dice), la radice; la porta di uplink del controller.
  const portaRadice = new Map<string, string>();
  for (const b of [...ing.fattiBridge].sort((x, y) => x.device_id - y.device_id || (x.bridge_name < y.bridge_name ? -1 : 1))) {
    const nodo = `dev:${b.device_id}`;
    if (b.instance !== 0 || lettoreDellaFonte(b.source) === "controller" || b.root_id === null || portaRadice.has(nodo)) continue;
    if (b.root_port !== null) portaRadice.set(nodo, b.root_port);
    else if (b.bridge_id !== null && macDel(b.root_id) === macDel(b.bridge_id)) portaRadice.set(nodo, "radice");
  }
  const portaUplink = new Map<string, { chiave: string | null; nome: string }>();
  const gateway = new Set<string>();
  const upCavi = new Map(ing.uplink.map((u) => [u.device_id, u.uplink_local_port_idx]));
  for (const d of ing.t1.devices) {
    if (!d.controller_mac) continue;
    const nodo = `dev:${d.id}`;
    if (d.device_type === "router" || d.device_type === "firewall") gateway.add(nodo);
    const i = upCavi.get(d.id) ?? ing.t1.uplinkPorts.find((u) => u.device_id === d.id)?.port_index ?? null;
    if (i === null) continue;
    const nome = p.elenchi.get(nodo)?.perIndice.get(i) ?? `Port ${i}`;
    portaUplink.set(nodo, { chiave: chiavePorta(nodo, { nome, fisica: true, senzaFili: false, nelBridge: null, fascio: null }, "locale", p.elenchi.get(nodo), i).chiave, nome });
  }
  const ipervisori = new Set([...nodi.values()].filter((n) => n.classe === "hyper").map((n) => n.id));
  for (const v of t1.vms) if (v.hypervisorNodeId) ipervisori.add(v.hypervisorNodeId);
  const testaConfermata = opz.testaScelta ?? t1.sites.find((s) => s.headNodeId !== null && !s.headProposed)?.headNodeId ?? null;
  const albero = alberoCavi({
    nodi, visibili, collegamenti, testaConfermata, portaRadice, portaUplink, gateway, gatewayDi: t1.gatewayDi ?? {},
    primari: ing.t1.primaries.map((x) => ({ node_id: x.node_id, other_node: x.other_node })), ipervisori,
  });
  return { collegamenti, segmenti, albero, correzioniOrfane, schema: ing.schema, nonCalcolato: NON_CALCOLATO_IN_T2 };
}
```

  (Gli `import` nuovi vanno in testa al file, accanto a quelli del Task 10; `TopologyModel` e `IngressoCavi` ci sono già.)

- [ ] **Step 4: verde** — `cavi-albero.test.ts`, `cavi-collegamenti.test.ts`, `cavi-prove.test.ts`, `cavi-senza-prodotti.test.ts`,
  `npx tsc --noEmit`: tutti `exit=0`; e il tempo, una volta, sulla fixture del modello del cliente A
  (`src/lib/topology/__tests__/fixtures/topologia-cliente-a.json`, senza fatti): `costruisciModelloCavi` sotto i 100 ms
  (si scrive nel resoconto; la traccia si calcola a richiesta, non a ogni apertura della mappa).

- [ ] **Step 5: commit** — `git add src/lib/topology/cavi/albero.ts src/lib/topology/cavi/modello.ts src/lib/topology/__tests__/cavi-albero.test.ts`,
  `git commit -m "feat(topologia): albero dallo spanning tree e modello per cavo in ombra (T2.7)"`.

---
### Task 12: la traccia «Cosa cambierebbe con la mappa nuova» (T2.7, ultima parte)

Spec §13.11.3 («La traccia»: in «Dati della mappa», solo per gli admin, una sezione calcolata a richiesta, in memoria e
senza scrivere niente; quanti oggetti avrebbero un altro padre, quanti collegamenti nuovi per genere — bloccati,
instradati, fasci, tunnel, ponti radio —, quanti segmenti, chi entra o esce dall'albero, quante anomalie; poi una riga per
differenza «‹oggetto› · padre oggi ‹A› · con la mappa nuova ‹B› · perché», con un limite e «+ altri N»; servita da
`GET /api/topology/traccia` con `requireAdmin` come prima istruzione e dichiarata in `ATTESI`), §13.12.1 (scenari
«letture spente» e «letture accese»), prove «`confrontaAlberi`» e «la rotta della traccia nel censimento dei permessi»
del 13.12.4.

**Files:**
- Create: `src/lib/topology/cavi/traccia.ts`, `src/app/api/topology/traccia/route.ts`, `src/app/(dashboard)/topology/dati/traccia-card.tsx`
- Modify: `src/lib/permessi/rotte.ts` (`ATTESI`), `src/app/(dashboard)/topology/dati/dati-client.tsx`, `scripts/misura-cavi.ts`
- Test: `src/lib/topology/__tests__/cavi-traccia.test.ts`

**Interfaces:**
- Consumes: `costruisciModelloCavi`, `ModelloCavi` (Task 11); `getIngressoCavi` (Task 9); `buildTopologyModel`,
  `computeMapView`, `padriDi` (`misura.ts`); `getAutoMap`, `getLinkStaleDays`; `LETTURE`, `leggiInterruttore`, `oraUtc`
  (Task 2); `quandoItaliano` (Task 8).
- Produces: `interface Differenza`, `confrontaAlberi(oggi, nuovo): Differenza[]`, `interface RigaTraccia`,
  `interface Traccia`, `calcolaTraccia(oggi, m, limite = 50): Traccia`, `nomiTraccia(t1, m, tr): Record<string, string>`;
  la rotta `GET /api/topology/traccia`; `TracciaCard`; in `misura-cavi`: `--fatti-prova <id>`, `--traccia`, `impronta_modello`.

- [ ] **Step 1: le prove, viste fallire** — `src/lib/topology/__tests__/cavi-traccia.test.ts`:

```ts
// La traccia (spec topologia §13.11.3): il confronto fra l'albero della mappa di oggi e quello del modello per cavo, oggetto
// per oggetto, con il perché in parole; un limite di righe e «+ altri N»; le VM e i segmenti non sono «oggetti che entrano».
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { computeMapView } from "@/lib/topology/map-compute";
import { padriDi } from "@/lib/topology/misura";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { calcolaTraccia, confrontaAlberi, nomiTraccia } from "@/lib/topology/cavi/traccia";
import { baseInput, dev } from "./support/righe";
import { fb, ingresso, vic } from "./support/cavi";

test("confrontaAlberi: padre diverso, entra, esce; VM e segmenti non contano come oggetti", () => {
  const d = confrontaAlberi(
    { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:1", "host:9": "dev:2", "vm:4:100": "dev:3" },
    { "dev:1": null, "dev:2": "dev:1", "dev:3": "dev:2", "dev:5": "seg:1:8", "seg:1:8": "dev:1" },
  );
  assert.deepEqual(d, [
    { id: "dev:3", prima: "dev:1", dopo: "dev:2" },
    { id: "dev:5", prima: undefined, dopo: "seg:1:8" },
    { id: "host:9", prima: "dev:2", dopo: undefined },
  ]);
});

const mk = { vendor: "mikrotik", via: "ssh" } as const;
const cavo = (a: number, pa: string, b: number, pb: string, nomeB: string, nomeA: string) => [
  vic({ device_id: a, local_port: `${pa},bridge`, remote_device_name: nomeB, remote_port: `bridge/${pb}`, source: "device", remote_platform: "MikroTik" }),
  vic({ device_id: b, local_port: `${pb},bridge`, remote_device_name: nomeA, remote_port: `bridge/${pa}`, source: "device", remote_platform: "MikroTik" }),
];

test("letture accese su una rete piccola: la porta radice cambia un padre, e la riga dice perché", () => {
  const t1 = baseInput({
    devices: [dev(1, { name: "RTR-1", device_type: "router", ...mk }), dev(2, { name: "SW-2", ...mk }), dev(3, { name: "SW-3", ...mk })],
    neighbors: [...cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1"), ...cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2"), ...cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1")],
    networks: [{ id: 1, cidr: "10.1.0.0/24", name: "lan", gateway: "10.1.0.1", location_id: null }],
  });
  const ing = ingresso(t1, { fattiBridge: [fb(3, { bridge_id: "32768.02:00:00:00:00:03", root_id: "0.02:00:00:00:00:01", root_port: "ether2" })] });
  const modello = buildTopologyModel(t1);
  const vista = computeMapView(modello, { auto: true, members: [], roots: [], head: "dev:1", tweaks: [], expanded: new Set(), orientation: "lr" });
  const tr = calcolaTraccia(padriDi(vista.tree), costruisciModelloCavi(ing, modello, { testaScelta: "dev:1" }));
  assert.equal(tr.padriDiversi, 1);
  assert.deepEqual(tr.righe.map((r) => [r.id, r.prima, r.dopo]), [["dev:3", "dev:1", "dev:2"]]);
  assert.match(tr.righe[0].perche, /porta radice/);
  assert.equal(tr.perGenere.cavo, 3);
  const nomi = nomiTraccia(modello, costruisciModelloCavi(ing, modello, { testaScelta: "dev:1" }), tr);
  assert.deepEqual([nomi["dev:3"], nomi["dev:2"]], ["SW-3", "SW-2"]);
});

test("il limite: al più `limite` righe, le altre contate in «+ altri N»", () => {
  const oggi: Record<string, string | null> = { "dev:1": null };
  const nuovo: Record<string, string | null> = { "dev:1": null };
  for (let i = 2; i < 80; i++) { oggi[`dev:${i}`] = "dev:1"; nuovo[`dev:${i}`] = `dev:${i - 1}`; }
  const m = costruisciModelloCavi(ingresso(baseInput()), buildTopologyModel(baseInput()), { testaScelta: null });
  const tr = calcolaTraccia(oggi, { ...m, albero: { ...m.albero, padri: nuovo } }, 50);
  assert.deepEqual([tr.righe.length, tr.altri, tr.padriDiversi], [50, 27, 77]);
});
```

```bash
node --import tsx --test src/lib/topology/__tests__/cavi-traccia.test.ts > "$SCRATCH/t12-rosso.log" 2>&1; echo "exit=$?"
```

  Atteso: `exit=1`.

- [ ] **Step 2: la traccia** — `src/lib/topology/cavi/traccia.ts`:

```ts
/**
 * La traccia «Cosa cambierebbe con la mappa nuova (una linea per cavo)» (spec topologia §13.11.3): il freno con la sua
 * traccia contabile. Confronta l'albero della mappa automatica di oggi con quello del modello per cavo calcolato in ombra:
 * quanti oggetti avrebbero un altro padre, quanti collegamenti per genere e quanti dei generi nuovi (bloccati, instradati,
 * fasci, tunnel, ponti radio), quanti segmenti, chi entra o esce dall'albero, quante anomalie; poi una riga per differenza
 * col perché, con un limite. Logica pura, in memoria: non scrive niente, non si calcola a ogni apertura della mappa.
 */
import type { TopologyModel } from "@/lib/topology/model-types";
import type { Collegamento, Genere } from "./collegamenti";
import type { ModelloCavi } from "./modello";

export interface Differenza { id: string; prima: string | null | undefined; dopo: string | null | undefined }
export interface RigaTraccia extends Differenza { perche: string }
export interface Traccia {
  schema: boolean;
  padriDiversi: number;
  entrano: string[];
  escono: string[];
  perGenere: Record<Genere, number>;
  nuovi: { bloccati: number; instradati: number; fasci: number; tunnel: number; radio: number };
  segmenti: number;
  anomalie: number;
  righe: RigaTraccia[];
  altri: number;
  avvisi: Array<{ nodo: string; testo: string }>;
  nonCalcolato: readonly string[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Le VM appese dalla pagina e i segmenti non sono oggetti dell'inventario: non «entrano» né «escono». */
const oggetto = (id: string): boolean => !id.startsWith("vm:") && !id.startsWith("seg:");

export function confrontaAlberi(oggi: Readonly<Record<string, string | null>>, nuovo: Readonly<Record<string, string | null>>): Differenza[] {
  const ids = [...new Set([...Object.keys(oggi), ...Object.keys(nuovo)])].filter(oggetto).sort(cmp);
  return ids.filter((id) => oggi[id] !== nuovo[id]).map((id) => ({ id, prima: oggi[id], dopo: nuovo[id] }));
}

const GENERE: Readonly<Record<Genere, string>> = {
  cavo: "cavo", fascio: "fascio di cavi", tunnel: "tunnel", radio: "ponte radio", senza_fili: "collegamento senza fili", segmento: "appartenenza a un segmento",
};
const FIDUCIA: Readonly<Record<Collegamento["fiducia"], string>> = {
  certo: "certo", probabile: "probabile", dedotto: "dedotto", a_mano_confermato: "a mano, confermato", a_mano: "a mano",
};
const fra = (cs: readonly Collegamento[], x: string, y: string): Collegamento | undefined =>
  cs.find((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));

function perche(d: Differenza, m: ModelloCavi): string {
  if (d.dopo === undefined) return "nella mappa nuova non ha un collegamento verso l'albero";
  if (d.dopo === null) return "nella mappa nuova è una partenza dell'albero";
  const c = m.albero.via.get(d.id);
  const parti: string[] = [];
  if (c && m.albero.scelto.get(d.id) === c.id) parti.push("è la sua porta radice nello spanning tree");
  else if (d.dopo.startsWith("seg:")) parti.push("la sua porta sente più apparati: sta su un segmento");
  else if (c) parti.push(`${GENERE[c.genere]} ${FIDUCIA[c.fiducia]}${c.velocitaMbps ? `, ${c.velocitaMbps >= 1000 ? `${c.velocitaMbps / 1000}G` : `${c.velocitaMbps}M`}` : ""}; nessuna prova dello spanning tree: scelto per fiducia e velocità`);
  if (d.prima) {
    const vecchio = fra(m.collegamenti, d.id, d.prima);
    if (!vecchio) parti.push("il collegamento di oggi non c'è nel modello per cavo");
    else if (vecchio.stato === "bloccato" || vecchio.stato === "bloccato_comune") parti.push("il collegamento di oggi è bloccato dallo spanning tree");
    else if (vecchio.stato === "instradato") parti.push("il collegamento di oggi è instradato (fuori dal bridge)");
    else if (vecchio.stato === "giu") parti.push("il collegamento di oggi è giù");
  }
  return parti.join("; ");
}

export function calcolaTraccia(oggi: Readonly<Record<string, string | null>>, m: ModelloCavi, limite = 50): Traccia {
  const diff = confrontaAlberi(oggi, m.albero.padri);
  const perGenere: Record<Genere, number> = { cavo: 0, fascio: 0, tunnel: 0, radio: 0, senza_fili: 0, segmento: 0 };
  for (const c of m.collegamenti) perGenere[c.genere]++;
  return {
    schema: m.schema,
    padriDiversi: diff.filter((d) => d.prima !== undefined && d.dopo !== undefined).length,
    entrano: diff.filter((d) => d.prima === undefined).map((d) => d.id),
    escono: diff.filter((d) => d.dopo === undefined).map((d) => d.id),
    perGenere,
    nuovi: {
      bloccati: m.collegamenti.filter((c) => c.stato === "bloccato" || c.stato === "bloccato_comune").length,
      instradati: m.collegamenti.filter((c) => c.stato === "instradato").length,
      fasci: perGenere.fascio, tunnel: perGenere.tunnel, radio: perGenere.radio,
    },
    segmenti: m.segmenti.length,
    anomalie: m.albero.anomalie.length,
    righe: diff.slice(0, limite).map((d) => ({ ...d, perche: perche(d, m) })),
    altri: Math.max(0, diff.length - limite),
    avvisi: m.albero.avvisi,
    nonCalcolato: m.nonCalcolato,
  };
}

/** I nomi degli oggetti nominati dalla traccia (righe, padri, chi entra o esce, avvisi). Un segmento: «segmento su ‹membro› ‹porta›». */
export function nomiTraccia(t1: Pick<TopologyModel, "nodes">, m: ModelloCavi, tr: Traccia): Record<string, string> {
  const nodi = new Map(t1.nodes.map((n) => [n.id, n.name]));
  const seg = new Map(m.segmenti.map((s) => {
    const primo = s.membri.find((p) => p.nodo.startsWith("dev:")) ?? s.membri[0];
    return [s.id, `segmento su ${nodi.get(primo?.nodo ?? "") ?? primo?.nodo ?? "?"} ${primo?.nome ?? ""}`.trim()];
  }));
  const ids = new Set<string>([...tr.entrano, ...tr.escono, ...tr.avvisi.map((a) => a.nodo)]);
  for (const r of tr.righe) for (const x of [r.id, r.prima, r.dopo]) if (typeof x === "string") ids.add(x);
  return Object.fromEntries([...ids].sort(cmp).map((id) => [id, seg.get(id) ?? nodi.get(id) ?? id]));
}
```

- [ ] **Step 3: la rotta** — `src/app/api/topology/traccia/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAutoMap, getIngressoCavi } from "@/lib/db-tenant";
import { NO_STORE } from "@/lib/controllers/route-helpers";
import { buildTopologyModel } from "@/lib/topology/model";
import { computeMapView } from "@/lib/topology/map-compute";
import { padriDi } from "@/lib/topology/misura";
import { getLinkStaleDays } from "@/lib/topology/settings";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { calcolaTraccia, nomiTraccia } from "@/lib/topology/cavi/traccia";
import { LETTURE, leggiInterruttore, oraUtc } from "@/lib/topology/letture/interruttori";

/**
 * GET /api/topology/traccia — «Cosa cambierebbe con la mappa nuova (una linea per cavo)» (spec topologia §13.11.3). Solo
 * per gli amministratori (dichiarata in ATTESI di src/lib/permessi/rotte.ts: un GET si aspetterebbe `auth`). Calcolata a
 * richiesta, in memoria: non scrive niente e non cambia la mappa.
 */
export async function GET() {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    try {
      const staleDays = getLinkStaleDays();
      const ing = getIngressoCavi(staleDays);
      const t1 = buildTopologyModel(ing.t1);
      const auto = getAutoMap();
      const vista = computeMapView(t1, { auto: true, members: [], roots: [], head: auto?.head_node ?? null, tweaks: [], expanded: new Set(), orientation: "lr" });
      const m = costruisciModelloCavi(ing, t1, { testaScelta: vista.headChosen ? vista.head : null });
      const tr = calcolaTraccia(padriDi(vista.tree), m);
      return NextResponse.json({
        calcolataIl: oraUtc(new Date()), staleDays,
        letture: LETTURE.map((l) => ({ lettura: l, acceso: leggiInterruttore(l).acceso })),
        ...tr, nomi: nomiTraccia(t1, m, tr),
      }, { headers: NO_STORE });
    } catch (error) {
      console.error("[topology] traccia:", error instanceof Error ? error.message : "errore");
      return NextResponse.json({ error: "Errore nel calcolo di «Cosa cambierebbe con la mappa nuova»" }, { status: 500 });
    }
  });
}
```

  In `src/lib/permessi/rotte.ts`, in fondo ad `ATTESI`:

```ts
  {
    rotta: "/api/topology/traccia",
    metodi: ["GET"],
    livello: "admin",
    motivo: "«Cosa cambierebbe con la mappa nuova»: un calcolo per chi decide quando accendere la mappa nuova (spec topologia §13.11.3)",
  },
```

- [ ] **Step 4: la sezione** — `src/app/(dashboard)/topology/dati/traccia-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { fetchJson } from "@/lib/fetch-json";
import type { Traccia } from "@/lib/topology/cavi/traccia";
import { quandoItaliano } from "@/lib/topology/letture/testi";

type Risposta = Traccia & { calcolataIl: string; staleDays: number; letture: Array<{ lettura: string; acceso: boolean }>; nomi: Record<string, string> };

/**
 * «Cosa cambierebbe con la mappa nuova (una linea per cavo)» (spec topologia §13.11.3), solo per gli amministratori:
 * calcolata quando si preme «Calcola», mai all'apertura della pagina. La mappa non cambia.
 */
export function TracciaCard() {
  const [t, setT] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [calcolo, setCalcolo] = useState(false);
  async function calcola() {
    setCalcolo(true);
    setErrore(null);
    const r = await fetchJson<Risposta>("/api/topology/traccia", { cache: "no-store" });
    setCalcolo(false);
    if (!r.ok) setErrore(r.message);
    else setT(r.data);
  }
  const n = (id: string | null | undefined): string => (id === undefined ? "fuori dall'albero" : id === null ? "partenza dell'albero" : (t?.nomi[id] ?? id));
  const accese = t?.letture.filter((l) => l.acceso).map((l) => l.lettura) ?? [];
  const numeri: Array<[string, number]> = t ? [
    ["Oggetti con un altro padre", t.padriDiversi], ["Entrano nell'albero", t.entrano.length], ["Escono dall'albero", t.escono.length],
    ["Segmenti", t.segmenti], ["Anomalie «core che esce da uno switch di accesso»", t.anomalie],
    ["Cavi", t.perGenere.cavo], ["Fasci di cavi", t.nuovi.fasci], ["Tunnel", t.nuovi.tunnel], ["Ponti radio", t.nuovi.radio],
    ["Collegamenti senza fili", t.perGenere.senza_fili], ["Bloccati dallo spanning tree", t.nuovi.bloccati], ["Instradati (fuori dal bridge)", t.nuovi.instradati],
  ] : [];
  return (
    <Card className="xl:col-span-2">
      <CardHeader><CardTitle>Cosa cambierebbe con la mappa nuova (una linea per cavo)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">Un calcolo in memoria: la mappa non cambia. Serve a decidere quando accendere la mappa nuova, a differenze spiegate.</p>
        <Button variant="outline" onClick={() => void calcola()} disabled={calcolo}>{calcolo ? "Calcolo…" : t ? "Ricalcola" : "Calcola"}</Button>
        {errore && <p className="text-sm" role="status">Non calcolata: {errore}</p>}
        {t && (
          <>
            <p className="text-sm text-muted-foreground">Calcolata il {quandoItaliano(t.calcolataIl)}. Letture in più accese: {accese.length > 0 ? accese.join(", ") : "nessuna (solo le righe di oggi)"}.</p>
            {!t.schema && <p className="text-sm font-medium">Lo schema delle letture in più non c'è su questo cliente: il calcolo usa solo le righe di oggi.</p>}
            <Table><TableBody>
              {numeri.map(([k, v]) => <TableRow key={k}><TableCell>{k}</TableCell><TableCell className="text-right tabular-nums">{v}</TableCell></TableRow>)}
            </TableBody></Table>
            {t.righe.length > 0 && (
              <ul className="text-sm space-y-1">
                {t.righe.map((r) => (
                  <li key={r.id}>{n(r.id)} · padre oggi {n(r.prima)} · con la mappa nuova {n(r.dopo)} · {r.perche}</li>
                ))}
                {t.altri > 0 && <li>+ altri {t.altri}</li>}
              </ul>
            )}
            {t.avvisi.length > 0 && (
              <ul className="text-sm list-disc pl-5">{t.avvisi.slice(0, 20).map((a) => <li key={`${a.nodo}-${a.testo}`}>{n(a.nodo)}: {a.testo}</li>)}</ul>
            )}
            <details className="text-sm">
              <summary>Non calcolato in questa tappa</summary>
              <ul className="list-disc pl-5">{t.nonCalcolato.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

  In `dati-client.tsx`: `import { TracciaCard } from "./traccia-card";` e, subito dopo `<LettureCard isAdmin={isAdmin} />`,
  `{isAdmin && <TracciaCard />}`.

- [ ] **Step 5: la misura** — in `scripts/misura-cavi.ts`:
  - `--fatti-prova` in `CON_VALORE` e nel testo d'uso: `[--fatti-prova <id>]   T2: fatti dei MikroTik (fixture anonime del repo) e vicini con le fonti nuove (ssh, snmp) sull'apparato <id>, nella copia della copia`;
    `[--traccia]   T2: «Cosa cambierebbe con la mappa nuova» (numeri; con --nomi le righe a terminale)`.
  - dopo il blocco di `--ripristino`:

```ts
  // T2 (piano di T2, Task 12): «letture accese» con le fixture vere rese anonime, sulla copia della copia: i fatti dei
  // MikroTik sull'apparato dato e righe dei vicini con le fonti nuove. Il modello di oggi non le legge: `impronta_modello`
  // deve restare quella di «letture spente» (R7, I33). Nomi inventati: non toccano le righe vere (la chiave dei vicini non ha
  // la fonte, SN6).
  const fattiProva = val("--fatti-prova");
  if (fattiProva) {
    if (!/^\d+$/.test(fattiProva)) return uso("--fatti-prova vuole l'id di un apparato.");
    const stp = await import("../src/lib/devices/mikrotik-stp");
    const { parseMikrotikNeighbors } = await import("../src/lib/devices/mikrotik-vicini");
    const FX = path.join(process.cwd(), "src/lib/devices/__tests__/fixtures");
    const F = (n: string) => fs.readFileSync(path.join(FX, n), "utf8");
    const id = Number(fattiProva);
    const scritti = tenantDb.withTenant(tenant, () => {
      const r = tenantDb.scriviFattiTopologia(id, "device", stp.fattiMikrotik({
        interfacce: stp.parseInterfacce(F("mikrotik-mk2-testa.txt")), bridge: stp.parseBridge(F("mikrotik-mk3-testa.txt")),
        porteBridge: stp.parsePorteBridge(F("mikrotik-mk4-testa.txt")), monitorBridge: stp.parseMonitorBridge(F("mikrotik-mk5-testa.txt")),
        monitorPorte: stp.parseMonitorPorte(F("mikrotik-mk6-testa.txt")), fasci: stp.parseFasci(F("mikrotik-mk8a-testa.txt")),
        monitorFasci: stp.parseMonitorFasci(F("mikrotik-mk8b-testa.txt")),
      }));
      tenantDb.upsertNeighbors(id, parseMikrotikNeighbors(F("mikrotik-ip-neighbor-terse-ssh.txt")), "ssh");
      tenantDb.upsertNeighbors(id, parseMikrotikNeighbors(F("mikrotik-ip-neighbor-terse.txt")).map((n) => ({ ...n, localPortIndex: 1, remoteCaps: "bridge" })), "snmp");
      return r;
    });
    out.fatti_prova = scritti ?? "schema assente";
  }
```

  - dopo il ciclo dei 30 giri del modello: `out.impronta_modello = crypto.createHash("sha256").update(JSON.stringify(model)).digest("hex").slice(0, 16);`
  - prima di `out.quick_check_dopo = quick();`:

```ts
  let traccia: import("../src/lib/topology/cavi/traccia").Traccia | null = null;
  if (a.includes("--traccia")) {
    const { costruisciModelloCavi } = await import("../src/lib/topology/cavi/modello");
    const { calcolaTraccia } = await import("../src/lib/topology/cavi/traccia");
    const ing = tenantDb.withTenant(tenant, () => tenantDb.getIngressoCavi(soglia, base.nowMs));
    const t0 = performance.now();
    const ombra = costruisciModelloCavi({ ...ing, t1: input }, model, { testaScelta: auto.headChosen ? auto.head : null });
    out.cavi_ms = Math.round((performance.now() - t0) * 10) / 10;
    traccia = calcolaTraccia(padri, ombra);
    out.traccia = {
      schema: traccia.schema, padri_diversi: traccia.padriDiversi, entrano: traccia.entrano.length, escono: traccia.escono.length,
      per_genere: traccia.perGenere, nuovi: traccia.nuovi, segmenti: traccia.segmenti, anomalie: traccia.anomalie, avvisi: traccia.avvisi.length,
    };
  }
```

  - nel blocco `--nomi`, in fondo:

```ts
    if (traccia) {
      w("\n— cosa cambierebbe con la mappa nuova (in ombra) —");
      for (const r of traccia.righe) w(`${nome(r.id)} · padre oggi ${r.prima === undefined ? "fuori" : nome(r.prima)} · con la mappa nuova ${r.dopo === undefined ? "fuori" : nome(r.dopo)} · ${r.perche}`);
      if (traccia.altri > 0) w(`+ altri ${traccia.altri}`);
    }
```

  (`input` è l'ingresso con lo scenario applicato; `auto` è la vista della mappa automatica già calcolata dallo script.)

- [ ] **Step 6: verde** —

```bash
for f in src/lib/topology/__tests__/cavi-traccia.test.ts $(rg -l "permessi" src/lib/permessi --glob '*.test.ts'); do
  node --import tsx --test "$f" > "$SCRATCH/t12-$(basename "$f").log" 2>&1; echo "$f exit=$?"; done
npx tsc --noEmit > "$SCRATCH/t12-tsc.log" 2>&1; echo "tsc exit=$?"; npm run lint > "$SCRATCH/t12-lint.log" 2>&1; echo "lint exit=$?"
```

  Atteso: tutti `exit=0`; il censimento delle guardie vede `GET /api/topology/traccia` con `requireAdmin` al livello atteso
  `admin` (dichiarato), e nessun debito nuovo.

- [ ] **Step 7: commit** — `git add src/lib/topology/cavi/traccia.ts src/app/api/topology/traccia/route.ts src/lib/permessi/rotte.ts
  "src/app/(dashboard)/topology/dati/traccia-card.tsx" "src/app/(dashboard)/topology/dati/dati-client.tsx" scripts/misura-cavi.ts
  src/lib/topology/__tests__/cavi-traccia.test.ts`, `git commit -m "feat(topologia): «Cosa cambierebbe con la mappa nuova», la traccia in ombra (T2.7)"`.

---
### Task 13: le prove di tappa — il freno frena (I33, R7) e le letture accese sulle reti-campione

Spec §13.11.3 («Misure sulle copie»: letture spente = mappa identica a T1 bit per bit; letture accese con le fixture di T2
= la mappa di T1 ancora identica; classificazioni degli host uguali), §13.12.1 (scenari «letture spente» e «letture
accese»), §13.12.2 (reti-campione delle famiglie 1 e 2 con le letture nuove), prove I33 e I55.

**Files:**
- Create: `src/lib/__tests__/topologia-t2-freno.test.ts`, `src/lib/topology/__tests__/cavi-ombra.test.ts`

**Interfaces:**
- Consumes: tutto quello che T2 scrive (Task 1, 3, 5, 6) e il modello in ombra (Task 11); `soloMikrotik`, `soloUnifi`
  (reti-campione); `buildTopologyModel`, `getTopologyModelInput`.
- Produces: nessuna interfaccia: due file di prova.

- [ ] **Step 1: I33 sul DB** — `src/lib/__tests__/topologia-t2-freno.test.ts`:

```ts
// I33 e R7 (spec topologia §13.5.7 «Chi legge che cosa», §13.12.3): accendere le letture in più non cambia la mappa di oggi
// né le classificazioni degli host (dati di produzione). Su un tenant di prova: le righe di oggi; il modello e le
// classificazioni; poi TUTTO ciò che T2 scrive — fatti di porta e di bridge di ogni lettore, MAC degli apparati, uplink per
// indice, colonne nuove dei vicini, righe delle fonti nuove (ssh, snmp, host), anche verso un host — e lo stesso modello,
// bit per bit. Freno a prova di guasto (verifica sul codice, 14/10).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { closeHubDb } from "@/lib/db-hub";
import {
  deleteTenantDatabase, getNetworkDeviceKnownMacs, getTenantDb, getTopologyModelInput, rileggiSchemaCavi, scriviFattiTopologia,
  setUplinkCavi, upsertNeighbors, withTenant,
} from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import {
  fattiMikrotik, parseBridge, parseFasci, parseInterfacce, parseMonitorBridge, parseMonitorFasci, parseMonitorPorte, parsePorteBridge,
} from "@/lib/devices/mikrotik-stp";

const T = "TESTT2FRENO";
const db = () => getTenantDb(T);
const NOW = Date.parse("2026-10-15T12:00:00Z");
const FX = path.join(__dirname, "..", "devices", "__tests__", "fixtures");
const F = (n: string): string => fs.readFileSync(path.join(FX, n), "utf8");
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("I33: con tutto ciò che T2 scrive, il modello di oggi è identico e le classificazioni degli host non cambiano", () => {
  db().exec(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, controller_mac) VALUES
    (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh', NULL), (2, 'SW-2', '10.0.0.2', 'switch', 'ubiquiti', 'api', '02:00:D0:00:02:00'),
    (3, 'SW-3', '10.0.0.3', 'switch', 'cisco', 'snmp_v2', NULL)`);
  db().exec(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.0.0.0/24', 'lan');
    INSERT INTO hosts (id, network_id, ip, mac, hostname, classification, status) VALUES (10, 1, '10.0.0.50', '02:00:00:00:50:01', 'telefono-1', 'workstation', 'online')`);
  withTenant(T, () => {
    rileggiSchemaCavi();
    upsertNeighbors(1, [{ localPort: "ether2,bridge", remoteDevice: "SW-2", remotePort: "Port 1", protocol: "lldp", remoteMac: "02:00:D0:00:02:00" }]);
    upsertNeighbors(2, [{ localPort: "Port 1", remoteDevice: "RTR-1", remotePort: "bridge/ether2", protocol: "lldp" }], "unifi");
  });
  const modello = () => JSON.stringify(withTenant(T, () => buildTopologyModel(getTopologyModelInput(2, NOW))));
  const classi = () => JSON.stringify(db().prepare("SELECT id, classification FROM hosts ORDER BY id").all());
  const macNoti = () => JSON.stringify(withTenant(T, () => getNetworkDeviceKnownMacs()));
  const [m0, c0, k0] = [modello(), classi(), macNoti()];

  withTenant(T, () => {
    scriviFattiTopologia(1, "device", fattiMikrotik({
      interfacce: parseInterfacce(F("mikrotik-mk2-testa.txt")), bridge: parseBridge(F("mikrotik-mk3-testa.txt")),
      porteBridge: parsePorteBridge(F("mikrotik-mk4-testa.txt")), monitorBridge: parseMonitorBridge(F("mikrotik-mk5-testa.txt")),
      monitorPorte: parseMonitorPorte(F("mikrotik-mk6-testa.txt")), fasci: parseFasci(F("mikrotik-mk8a-testa.txt")),
      monitorFasci: parseMonitorFasci(F("mikrotik-mk8b-testa.txt")),
    }));
    scriviFattiTopologia(2, "controller", {
      porte: [{ port_key: "i:1", port_name: "Port 1", port_index: 1, if_kind: "physical", running: 1, stp_state: "forwarding" }],
      bridge: [{ bridge_name: "", instance: 0, protocol: "rstp", priority: 32768, root_id: "02:00:d0:00:02:00" }],
      macs: [{ mac: "02:00:D0:00:02:01", port_key: null }],
    });
    scriviFattiTopologia(3, "snmp", { porte: [{ port_key: "i:10101", port_name: "Gi1/0/1", port_index: 10101, if_kind: "lag", stp_state: "discarding" }], bridge: [], macs: [] });
    setUplinkCavi(2, 1, "lldp_uplink");
    // le righe delle fonti nuove, anche verso l'host (che una piattaforma «router» farebbe cambiare categoria, se l'attribuzione le leggesse)
    upsertNeighbors(3, [{ localPort: "Gi1/0/1", remoteDevice: "telefono-1", remotePort: "Port 1", protocol: "cdp", remoteMac: "02:00:00:00:50:01", remotePlatform: "MikroTik RouterOS", localPortIndex: 10101, remoteCaps: "router" }], "snmp");
    upsertNeighbors(1, [{ localPort: "ether7", remoteDevice: "SW-3", remotePort: "Gi1/0/2", protocol: "lldp" }], "ssh");
    upsertNeighbors(3, [{ localPort: "nic0", remoteDevice: "SW-3", remotePort: "Gi1/0/3", protocol: "lldp", remoteIp: "10.0.0.50" }], "host");
  });
  // Le colonne nuove sulle righe di oggi, con l'istruzione a parte del writer (non sposta il timestamp).
  db().exec("UPDATE device_neighbors SET discovered_by = 'cdp,lldp,mndp', remote_caps = 'bridge,router', local_port_index = 2, remote_port_index = 1 WHERE source IN ('device', 'unifi')");

  assert.equal(modello(), m0, "la mappa di oggi, bit per bit");
  assert.equal(classi(), c0, "le classificazioni degli host");
  assert.equal(macNoti(), k0, "I55: i MAC noti che decidono l'abbinamento del controller");
});
```

- [ ] **Step 2: le letture accese sulle reti-campione** — `src/lib/topology/__tests__/cavi-ombra.test.ts`:

```ts
// Le letture accese sulle reti-campione (spec topologia §13.12.2): la famiglia 1 (solo MikroTik) e la famiglia 2 (solo
// UniFi) con i fatti che T2 legge, nella forma che i lettori scrivono. Il modello di oggi resta quello (gli ingressi del
// modello di oggi sono gli stessi); il modello per cavo in ombra dice ciò che la mappa nuova farebbe: il fascio, le porte
// radice, i cavi diretti instradati e certi coi MAC di MK2, la WAN del gateway, il segmento, nessuna anomalia falsa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { soloMikrotik, soloUnifi } from "./support/reti-campione";
import { fb, fp, ingresso } from "./support/cavi";

const dev = (id: number, k: string, n: string, over: Parameters<typeof fp>[3] = {}) => fp(id, k, n, { source: "device", in_bridge: 1, ...over });
const macs = (device_id: number, l: string[]) => l.map((mac) => ({ device_id, mac, source: "device" }));
const fra = (m: ReturnType<typeof costruisciModelloCavi>, x: string, y: string) =>
  m.collegamenti.filter((c) => (c.a.nodo === x && c.b.nodo === y) || (c.a.nodo === y && c.b.nodo === x));

test("famiglia 1, letture accese: il fascio della testa, i padri dalle porte radice, i cavi diretti instradati e certi coi MAC di MK2", () => {
  const t1 = soloMikrotik();
  const ing = ingresso(t1, {
    fattiBridge: [
      fb(3, { bridge_name: "BR_RP", bridge_id: "0.02:00:a0:00:03:00", root_id: "0.02:00:a0:00:03:00" }),
      fb(11, { bridge_name: "BR_AGG", bridge_id: "32768.02:00:a0:00:11:00", root_id: "0.02:00:a0:00:03:00", root_port: "bond1" }),
      fb(1, { bridge_name: "BR_FX", bridge_id: "32768.02:00:a0:00:01:00", root_id: "0.02:00:a0:00:03:00", root_port: "sfp-sfpplus1" }),
    ],
    fattiPorta: [
      dev(3, "n:sfp28-1", "sfp28-1", { lag_group: "bond1", lag_partner: "02:00:A0:00:11:00" }), dev(3, "n:sfp28-2", "sfp28-2", { lag_group: "bond1", lag_partner: "02:00:A0:00:11:00" }),
      dev(3, "n:bond1", "bond1", { if_kind: "lag", lag_group: "bond1", stp_role: "designated", stp_state: "forwarding", edge: 0, bpdu_rx: 10 }),
      dev(3, "n:sfp-sfpplus1", "sfp-sfpplus1", { stp_role: "designated", stp_state: "forwarding", edge: 1, bpdu_rx: 0 }),
      dev(3, "n:sfp-sfpplus3", "sfp-sfpplus3", { stp_role: "designated", stp_state: "forwarding", edge: 1, bpdu_rx: 0 }),
      dev(11, "n:sfp28-1", "sfp28-1", { lag_group: "bond1", lag_partner: "02:00:A0:00:03:00" }), dev(11, "n:sfp28-2", "sfp28-2", { lag_group: "bond1", lag_partner: "02:00:A0:00:03:00" }),
      dev(11, "n:bond1", "bond1", { if_kind: "lag", lag_group: "bond1", stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "0.02:00:a0:00:03:00" }),
      dev(1, "n:sfp-sfpplus1", "sfp-sfpplus1", { stp_role: "root", stp_state: "forwarding", sending_rstp: 1, designated_bridge: "32768.02:00:a0:00:11:00" }),
      dev(1, "n:sfp-sfpplus2", "sfp-sfpplus2", { in_bridge: 0 }), dev(1, "n:sfp-sfpplus4", "sfp-sfpplus4", { in_bridge: 0 }),
    ],
    macApparati: [
      ...macs(3, ["02:00:A0:00:03:00", "02:00:A0:00:03:01", "02:00:A0:00:03:10", "02:00:A0:00:03:11", "02:00:A0:00:03:13", "02:00:A0:00:03:21", "02:00:A0:00:03:22", "02:00:A0:00:03:88"]),
      ...macs(11, ["02:00:A0:00:11:00", "02:00:A0:00:11:02", "02:00:A0:00:11:10", "02:00:A0:00:11:21", "02:00:A0:00:11:22"]),
      ...macs(1, ["02:00:A0:00:01:01", "02:00:A0:00:01:02", "02:00:A0:00:01:04", "02:00:A0:00:01:16", "02:00:A0:00:01:20"]),
    ],
  });
  const modello = buildTopologyModel(t1);
  assert.equal(JSON.stringify(buildTopologyModel(ing.t1)), JSON.stringify(modello), "il modello di oggi non legge niente di T2 (R7)");
  const m = costruisciModelloCavi(ing, modello, { testaScelta: null });
  assert.equal(m.albero.testa, "dev:3");
  const fascio = fra(m, "dev:3", "dev:11");
  assert.deepEqual([fascio.length, fascio[0]?.genere, fascio[0]?.membri?.length], [1, "fascio", 2]);
  assert.equal(m.albero.padri["dev:11"], "dev:3", "la porta radice dell'aggregazione è il fascio");
  assert.equal(m.albero.padri["dev:1"], "dev:11", "il router di frontiera sta dove lo mette lo spanning tree (H21 in forma inventata)");
  assert.equal(m.albero.padri["dev:21"], "dev:11");
  const diretti = fra(m, "dev:1", "dev:3").filter((c) => c.genere === "cavo");
  assert.equal(diretti.length, 2);
  assert.ok(diretti.every((c) => c.stato === "instradato" && c.fiducia === "certo"), "fuori dal bridge; certi perché i MAC di MK2 abbinano le righe del router di frontiera");
  assert.deepEqual(m.albero.anomalie, []);
});

test("famiglia 2, letture accese: il gateway attaccato per la LAN, la WAN instradata con le porte da verificare, il segmento, nessuna anomalia dal Flex", () => {
  const t1 = soloUnifi();
  const ing = ingresso(t1, {
    uplink: [{ device_id: 1, uplink_local_port_idx: 10, uplink_source: "lldp_uplink" }, { device_id: 4, uplink_local_port_idx: 1, uplink_source: "lldp_uplink" }],
    fattiPorta: [fp(4, "i:1", "Port 1", { stp_state: "disabled" })],
  });
  const modello = buildTopologyModel(t1);
  const m = costruisciModelloCavi(ing, modello, { testaScelta: null });
  assert.equal(m.albero.testa, "dev:1");
  assert.notEqual(m.albero.via.get("dev:2")?.wan, true, "AGG appeso alla LAN del gateway");
  assert.ok(fra(m, "dev:1", "dev:2").some((c) => c.wan && c.porteDaVerificare), "la WAN: 10G da un capo, 25G dall'altro (I45)");
  assert.equal(m.albero.padri["dev:4"], "dev:3");
  assert.deepEqual(m.albero.anomalie, []);
  assert.ok(m.segmenti.some((s) => s.id === "seg:3:20"), "la porta 20 dello switch da 48 è un segmento (H5 in forma inventata)");
});
```

- [ ] **Step 3: verde** — le due prove, `exit=0`. Se la famiglia 1 non dà un padre atteso, si guarda la scelta (`m.albero.scelto`,
  `m.albero.avvisi`) e il collegamento (`fra`), e si corregge il codice dei Task 9-11 col perché nel resoconto; le attese
  di questa prova non si cambiano senza scriverlo nel resoconto e dirlo nella revisione finale.

- [ ] **Step 4: commit** — `git add src/lib/__tests__/topologia-t2-freno.test.ts src/lib/topology/__tests__/cavi-ombra.test.ts`,
  `git commit -m "test(topologia): il freno frena (I33, R7) e le letture accese sulle reti-campione (T2)"`.

---

## Parte 3 — Sessione principale: misure, schermo, revisione, rilascio spento, accensioni

### Task 14: le misure sulle copie

Spec §13.11.3, «Misure sulle copie». Le copie sono quelle di P6; i comandi girano dal worktree del ramo d'unione dopo
l'ondata 6 (e dopo la 7, se c'è). Ogni uscita va nello scratchpad; i numeri a Riccardo, i nomi **solo in chat**.

- [ ] **Step 1: la migrazione su una copia della copia di OGNI tenant** delle due macchine (cliente A e hub):

```bash
for db in "$SCRATCH"/copie/*.db; do
  npx tsx scripts/misura-migrazione-cavi.ts "$db" --cartella "$SCRATCH" > "$SCRATCH/mig-$(basename "$db" .db).json" 2> "$SCRATCH/mig-$(basename "$db" .db).err"
  echo "$(basename "$db") exit=$?"
done
```

  Atteso per ognuno: `exit=0`, `integrity_prima` e `integrity_dopo` «ok» (sull'hub anche «Page N: never used», noto:
  CONTEXT §6), `schema_cavi_presente: true`, `seconda_apertura_uguale: true`, `righe_migrazione: 1`; la durata
  (`durata_apertura_ms`) nel resoconto, tenant per tenant (sull'hub, 2,1 GB, è la più lunga: se supera 30 s lo si dice
  a Riccardo prima del rilascio, perché il servizio non risponde finché il tenant non si apre).

- [ ] **Step 2: «letture spente» = mappa identica a T1, bit per bit** — la stessa copia misurata col codice di `origin/dev`
  (prima di T2) e col ramo d'unione, con lo stesso orologio (`--adesso`, l'ora UTC della copia):

```bash
ADESSO="<ora UTC della copia, AAAA-MM-GG HH:MM:SS>"
for t in A H; do
  git -C "$SCRATCH/ipam-dev" checkout -q origin/dev   # un worktree di origin/dev, da P1
  (cd "$SCRATCH/ipam-dev" && npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --salva "$SCRATCH/t2-prima-$t.json" --json > "$SCRATCH/t2-prima-$t.out" 2>&1); echo "prima $t exit=$?"
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --confronta "$SCRATCH/t2-prima-$t.json" --json > "$SCRATCH/t2-spente-$t.out" 2>&1; echo "spente $t exit=$?"
done
```

  Atteso: `padri_cambiati: 0`, `conteggi_cambiati: {}`, `stesso_orologio: true`, `stessa_lettura_vm: true`. Il codice di
  `origin/dev` non ha `impronta_modello`: l'impronta del ramo d'unione si salva come riferimento per lo Step 3.

- [ ] **Step 3: «letture accese» con le fixture di T2 = la mappa di T1 ancora identica** — sul ramo d'unione, la stessa
  copia con `--fatti-prova <id del router 1>` (cliente A) e `--fatti-prova <id del router di testa>` (hub), e `--traccia`:

```bash
for t in A H; do
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --json > "$SCRATCH/t2-rif-$t.out" 2>&1; echo "rif $t exit=$?"
  npx tsx scripts/misura-cavi.ts "$SCRATCH/copie/<$t>.db" --cartella "$SCRATCH" --adesso "$ADESSO" --fatti-prova <id> --traccia --confronta "$SCRATCH/t2-prima-$t.json" --json > "$SCRATCH/t2-accese-$t.out" 2>&1; echo "accese $t exit=$?"
done
```

  Atteso: `impronta_modello` di «accese» **uguale** a quella di «rif»; `padri_cambiati: 0`; `host_cambiati_di_categoria`
  non c'è (nessuna riga delle fonti di oggi scritta); `fatti_prova` con i conteggi delle righe; `traccia` coi numeri;
  `cavi_ms` nel resoconto. Se l'impronta cambia, **il rilascio non parte**: si cerca quale lettura del modello di oggi ha
  letto un dato di T2.

- [ ] **Step 4: la traccia sulle copie, coi nomi solo a terminale** — `--traccia --nomi` sulle due copie, senza
  `--fatti-prova` (cioè con quello che il DB ha oggi: niente fatti nuovi, ma le fonti di oggi lette dal modello per cavo):
  quanti padri cambierebbero già senza letture in più, per l'effetto delle regole del modello per cavo sulle righe di oggi
  (segmenti come oggetti, conferma dai due capi, instradati dalla forma). I numeri vanno a Riccardo; i nomi restano in chat.

- [ ] **Step 5: il carico non si misura qui** (spec: «solo su un impianto, sul percorso vero»): è il Task 17.

### Task 15: la verifica a schermo, una volta, a 1280 e 1920

Spec §13.12.4, «A schermo» (solo schermi da scrivania). Sul dev con l'utenza di prova di DA-IPAM (la procedura che il
progetto usa: utenza creata sul dev, password generata sulla macchina, mai in un argomento); la verifica **non scrive**:
si apre «Dati della mappa», si guarda e basta. «Accendi» si prova solo nel dialogo (si apre e si annulla).

- [ ] «Dati della mappa» a **1280** e **1920**: la sezione «Letture in più per la mappa» con quattro righe (tre
  disponibili, `host` «non disponibile in questa versione» se il Task 7 non c'è), «spenta» scritto, nessuna lettura;
  per un admin i pulsanti «Accendi», il dialogo col testo della cadenza vera (lo si apre e si annulla); per un utente non
  admin la riga «Sola lettura…» e niente pulsanti; testo ≥ 13 px (nessun `text-xs`), lo stato in parole accanto al
  simbolo.
- [ ] La sezione «Cosa cambierebbe con la mappa nuova» (solo admin): «Calcola», i numeri, le righe con «+ altri N»,
  «Non calcolato in questa tappa».
- [ ] La mappa automatica e una mappa passo passo: **uguali** a prima (una schermata prima e dopo, confrontate a occhio e
  coi conteggi del modello di `GET /api/topology/model`).
- [ ] Le schermate stanno nello scratchpad; a Riccardo vanno solo quelle dei dati finti o del dev, mai di un cliente.

### Task 16: revisione finale, documenti, cancello, conferma e rilascio con tutto spento

- [ ] **Step 1: una revisione finale su Opus** dell'intera tappa (`git diff origin/dev...topologia/collegamenti-t2`), con
  questo mandato: (a) nessuna lettura del modello di oggi tocca ciò che T2 scrive (`git diff --stat origin/dev --
  src/lib/topology/{links,model,tree,attach,link-attrs,node-index}.ts` vuoto; `getTopologyModelInput` e
  `attribution/recompute.ts` invariati); (b) nessun comando che scrive sugli apparati; (c) ogni lettura nuova dietro il
  suo interruttore, con cadenza, lucchetto, tempo massimo e esito; (d) la migrazione additiva, idempotente, in
  transazione, senza CHECK, senza ricostruzioni; (e) niente dati veri in fixture, prove, commenti, commit; (f) I37 e
  I58; (g) i Casi da non dimenticare. Un giro di correzioni, senza ri-revisione completa.
- [ ] **Step 2: i documenti** —
  - spec §13.11.3: una riga «**Stato (‹data›):** pronta sul ramo `topologia/collegamenti-t2`…» coi numeri dei Task 14 e
    15, e i fatti nuovi del 13.5.3 (P5: indice delle righe del gateway, partner LACP, «MAC + 1»), detti come fatti;
  - `docs/adr/0017-letture-in-piu-spente-e-modello-in-ombra.md` (nuovo): Stato/Data; Contesto (D4, il freno con traccia
    contabile); Decisione (letture in più spente e per cliente, fatti in tabelle nuove che il modello di oggi non legge, il
    modello per cavo calcolato in ombra solo per la traccia); Alternative scartate (accendere per tutti; scrivere in
    `switch_ports`; ricostruire `device_neighbors`); Conseguenze, con «che cosa diventa difficile in futuro»: due modelli
    vivi insieme fino a T3, la colonna `lag_state` aggiunta, le dieci letture SNMP dedotte dalle MIB finché non si vede una
    lettura vera;
  - `CONTEXT.md` §6, una voce «Mappa topologia, T2 (ADR 0017)» con le trappole: le letture nascono spente e si accendono
    da «Dati della mappa»; l'esito sta in `tenant_settings`; il modello di oggi legge solo `device`/`unifi`; la
    migrazione e la sua riga nel journal; «Cosa cambierebbe» si calcola a richiesta; `host` solo dopo T2-b;
  - `CHANGELOG.md`, `## [Non rilasciato]`: Aggiunte (letture in più spente; «Letture in più per la mappa»; «Cosa
    cambierebbe con la mappa nuova»), Correzioni (SN1: la lettura a mano dello spanning tree via SNMP perdeva otto letture
    su nove; `stp-ssh` su MK3 e MK5: la priorità e le forme del bridge-id), col perché;
  - `docs/auth-matrix.md`: `GET/PUT /api/topology/settings/letture` (auth/admin), `GET /api/topology/traccia` (admin);
  - `docs/scheda-mappa.md` se lo stato del progetto cambia (riga di T2).
- [ ] **Step 3: il cancello, una volta** — `npm run lint && npx tsc --noEmit && npm test && npm run build`, esito dal codice
  d'uscita, log nello scratchpad. (`credential-chains.test.ts` cade a caso nella suite intera, CONTEXT §6: se cade, si
  rilancia da sola e il resoconto lo dice.)
- [ ] **Step 4: i preparativi del rilascio, in sola lettura** (le due macchine: l'appliance del cliente A e la VM dell'hub;
  vie d'accesso in `ACCESSI.md` e nel vault; comandi da stdin):
  1. `df -h` della cartella dei dati: lo spazio libero è almeno il doppio della somma dei DB dei tenant (l'hub: 2,1 GB);
  2. `PRAGMA quick_check` di **tutti** i tenant della macchina (`for f in data/tenants/*.db; do sqlite3 "$f" 'PRAGMA quick_check'; done`): «ok», o le pagine «never used» note;
  3. la copia con l'API di backup di ogni tenant: `sqlite3 "$f" ".backup 'data/backups/<tenant>-pre-topologia-cavi-<AAAAMMGG>.db'"`,
     poi `PRAGMA quick_check` della copia.
  Questi tre passi creano file sul server: si fanno **con la conferma di Riccardo** dello Step 5, subito prima del push.
- [ ] **Step 5: la conferma di Riccardo, chiesta una volta e per esteso**, per: (a) i preparativi dello Step 4 sulle due
  macchine; (b) il push su `dev`, che è un rilascio al cliente A **con la migrazione del suo DB** al riavvio; (c)
  l'aggiornamento dell'hub; (d) il ritorno indietro (sotto) se i controlli dopo il rilascio vanno male. Nel messaggio:
  i numeri dei Task 14 e 15, i fatti da confermare (la colonna `lag_state` in più; il tempo massimo di 20 s; SN8 limitata
  al ruolo nell'albero comune; MK7 non mandato senza T2-a; i fatti di P5), e che **tutte le letture restano spente**.
- [ ] **Step 6: il rilascio** — `npm run version:release`, `git push origin dev`; l'hub con lo script di aggiornamento. Poi i
  controlli: `ActiveEnterTimestamp` del servizio dopo l'ora del push e la riga d'avvio nel journal; il commit dalla riga
  «nuovo commit su origin/dev (‹hash›)» di `da-ipam-update` (sull'hub, il commit della cartella dell'app); **una riga**
  `topologia cavi (T2), aggiunto …` per tenant nel journal (`journalctl -u da-invent --since "<ora del push>" | grep -c "topologia cavi (T2)"`
  uguale al numero dei tenant aperti), nessuna riga «migrazione topologia cavi (T2) fallita»; `SELECT key FROM
  tenant_settings WHERE key LIKE 'topologia.lettura.%'` vuoto su ogni tenant; i conteggi di `GET /api/topology/model`
  uguali a quelli della copia presa subito prima del riavvio. Tempo massimo circa 30 minuti; se il servizio non è
  ripartito, si legge il journal di `da-ipam-update` e si avvisa subito Riccardo. Orari a Riccardo in ora italiana.

### Task 17: l'accensione sull'hub (apparati nostri) — una lettura alla volta, ognuna con la conferma di Riccardo

- [ ] **Prima di tutto**: si leggono `src/lib/cron/scheduler-defaults.ts` e le reti dell'hub (`SELECT cidr FROM networks`);
  si controlla che `unifi_sync` e `arp_poll` dell'hub siano accesi e con quale intervallo (`SELECT job_type, enabled,
  interval_minutes FROM scheduled_jobs`). T2 non accende job: se uno serve ed è spento, si chiede a Riccardo a parte.
- [ ] **«prima»** (24 ore di riferimento, in sola lettura): durata delle scansioni veloci (`SELECT scan_type, COUNT(*),
  AVG(duration_ms), MAX(duration_ms) FROM scan_history WHERE host_id IS NULL AND timestamp >= datetime('now','-1 day')
  GROUP BY scan_type`); la riga `[ARP Poll] giro: …` del journal (durata del giro degli switch); le connessioni SSH al
  router di testa nell'ultima ora dal suo log, in sola lettura (`/log print where topics~"account" and message~"logged in"`),
  con l'ok di Riccardo.
- [ ] **`topologia.lettura.mikrotik`**: Riccardo, da «Dati della mappa → Letture in più per la mappa», «Accendi» sulla
  riga dei MikroTik; dopo un'ora e mezza: l'esito per apparato nella pagina («tutti i 6 comandi»); le righe scritte per
  tabella (`SELECT source, COUNT(*) FROM topology_port_facts GROUP BY source`, idem per `topology_bridge_facts`,
  `topology_device_macs`); di nuovo durata delle scansioni veloci, connessioni SSH al router (attese: **una in più
  all'ora** per router), riga dei tempi del giro. «Cosa cambierebbe»: i numeri a Riccardo, i nomi in chat.
- [ ] **`topologia.lettura.controller`**, dopo la lettura notturna del controller (03:00 UTC, le 5:00 italiane fino al
  25/10, poi le 4:00): l'esito per apparato, le righe di fonte `controller`, «Cosa cambierebbe».
- [ ] **`topologia.lettura.snmp`**: la durata del giro degli switch prima e dopo (riga `[ARP Poll] giro:`), le letture SNMP
  per switch (l'esito: `comandi` = 16; revisione finale: colonne e scalari invece delle tabelle intere), «Cosa cambierebbe».
- [ ] Un numero fuori misura (una scansione veloce che raddoppia, un esito con errori su tutti gli apparati) → si spegne da
  «Dati della mappa» e si guarda prima di andare avanti.

### Task 18: l'accensione sul cliente A, dopo i numeri dell'hub, con la conferma di Riccardo

- [ ] Le stesse tre accensioni, nello stesso ordine, ognuna con la sua conferma e coi numeri dell'hub accanto. Sul cliente
  A il router si legge ogni ora (il dialogo lo dice). Prima: la regola `scheduler-defaults` e le reti del cliente, come
  sopra. Se T2-a è arrivato e il Task 3b è rilasciato, MK7 parte solo sui bridge in MSTP: si guarda l'esito e la forma.
- [ ] La **data di revisione** di ogni cliente, una settimana dopo l'accensione (spec §13.15 punto 5): un piano «pensato»
  con `lavori apri topologia-t2-revisione-<cliente>` (`non_prima_di` = la data; `autonomo: no`, REGOLA #2), che dice di
  guardare con Riccardo le differenze di «Cosa cambierebbe» ancora da spiegare.

### Task 19: la lettura dell'host, dopo T2-b

- [ ] Se il Task 7 è nel rilascio: `topologia.lettura.host` solo sull'hub, dopo il nodo di prova (P4), con la conferma di
  Riccardo; si guardano i vicini scritti con la fonte `host` e «Cosa cambierebbe» (il cavo di riserva del bond, il cavo
  diretto fra due hypervisor). Sugli host dei clienti `lldpd` si installa solo con conferma, e se si generalizza, in
  Deploy-Appliance (spec §13.5.5): DA-IPAM non installa niente.

### Task 20: prima della promozione a `main`

- [ ] Su **ogni** appliance che segue `main`, con l'ok di Riccardo: spazio libero, `PRAGMA quick_check` di tutti i tenant e
  copia con l'API di backup (come il Task 16, Step 4). La migrazione arriva lì al primo avvio dopo il pull; le letture
  restano spente finché qualcuno non le accende da «Dati della mappa».

---

## Tornare indietro

- **Senza codice**: si spegne la lettura da «Dati della mappa» (l'interruttore torna `acceso: false`); i fatti già scritti
  restano e invecchiano (potatura a 90 giorni), non letti dal modello di oggi.
- **Col codice**: `git revert` del commit d'unione di T2, `npm run version:release`, push; le tabelle e le colonne nuove
  restano, non lette (lo schema è additivo, niente da togliere). Le righe delle fonti `ssh`, `snmp`, `host` restano in
  `device_neighbors`: il modello di oggi e l'attribuzione non le leggono (filtro di T1). Le correzioni SN1 e `stp-ssh`
  tornano come prima con il revert (dati non letti dalla mappa).
- I backup del Task 16 servono solo se la migrazione rovinasse un DB (`integrity_check` diverso da «ok»): il ripristino di
  un DB del cliente è una scrittura di produzione, con la conferma di Riccardo.

## Scelte

**Decise dal piano, dichiarate (a Riccardo come fatti da confermare col messaggio del rilascio):**
1. `topology_port_facts.lag_state` in più rispetto al DDL del §13.5.7 (stato del membro di un bond, che la spec usa).
2. Tempo massimo dei comandi nuovi: 20 s per comando SSH, 10 s per lettura SNMP, 20 s sugli host.
3. ~~Dieci letture SNMP, una per tabella~~ (superata dal punto 10); SN8 solo col ruolo nell'albero comune; il partner LACP
   dalla colonna 9 della LAG-MIB; i valori del ruolo MSTP dalla MIB, da verificare sulla prima lettura vera.
4. Di base MK3-MK8 in più `exec` sulla stessa connessione (la spec); lo script unico e il JSON con `detail` non entrano
   (servirebbe T2-a sulla RouterOS più vecchia); MK7 solo dopo T2-a (Task 3b).
5. La fixture del gateway in un file nuovo; il controller senza cadenza (nessuna chiamata nuova), con l'esito scritto.
6. Le righe dell'host di un cluster sull'apparato del nodo; un nodo non censito non si scrive.
7. Il modello per cavo usa la classe degli oggetti della mappa di oggi; le prove di ruolo coi fatti nuovi (BPDU, capacità)
   arrivano in T3.
8. **Fatti delle porte e dei bridge: `COALESCE` per colonna, non per riga** (revisione del Task 1). La spec (§13.5.7, «Come
   si scrive») tiene con `COALESCE(excluded.x, x)` le colonne che un lettore non conosce. `scriviFattiTopologia` lo fa per
   colonna: una colonna assente da TUTTE le righe della scrittura non entra nel `SET` e resta com'era; una colonna che il
   lettore conosce si scrive col valore della riga, `null` compreso (e un campo assente solo da alcune righe vale `null`
   lì). Il `COALESCE` per riga è stato provato come mutante: non rompe le prove dei Task 3 e 4, ma rompe quella del Task 1
   («letto e vuoto: si scrive null») e lascerebbe valori di un giro vecchio in righe dell'ultimo giro, quelle che il
   modello per cavo legge: un bridge diventato radice (`root_port` null = è la radice) resterebbe con la porta radice di
   prima, una porta uscita da un fascio o dal bridge col fascio o il ruolo di prima. **Contratto dei lettori**: ogni riga
   porta tutte le colonne che il lettore conosce (`fattiMikrotik` lo fa già), `null` dove il valore è vuoto o non noto; una
   colonna che il lettore non legge in quel giro (cadenza diversa, comando non mandato) manca da tutte le righe. **Contratto
   di chi legge** (modello per cavo, Task 9): un `null` in una riga dell'ultimo giro vuol dire «vuoto o non noto adesso»,
   mai «il valore di prima». La prova: «un null letto cancella il valore di prima» in `topology-cavi-scrittura.test.ts`.
   **L'ultimo giro** che legge il modello per cavo (`getIngressoCavi`) è uno per apparato e lettore, il più recente fra
   porte e bridge insieme (revisione del Task 6): calcolato tabella per tabella, un giro che scrive il bridge e non le porte
   lasciava le porte del giro di prima accanto al bridge nuovo. Prova in `topology-cavi-ingresso.test.ts` («Scelta 8»).
9. **Potatura a 90 giorni dei vicini: R7 vince sul §13.5.1** (revisione dei Task 4 e 6, 15/10). Le fonti di oggi (`device`,
   `unifi`) potano tutte le righe vecchie dell'apparato, come prima; una fonte nuova (`ssh`, `snmp`, `host`) pota **solo le
   proprie**. Il §13.5.1 dice «le righe dell'apparato», ma così la prima scrittura di una lettura accesa cancellava un vicino
   `device` di 91 giorni che la mappa di T1 mostra «non visto»: accendere cambiava la mappa, contro R7. Costo: una riga
   `ssh`/`snmp` sulla chiave di una riga vecchia di oggi non la rinfresca (la WHERE dell'upsert la lascia stare), e quella
   riga se ne va solo con una scrittura della sua fonte — caso raro. Prova «R7: la potatura di una fonte nuova…» in
   `topology-cavi-scrittura.test.ts`.
10. **Letture SNMP: delle tabelle grandi solo le colonne che il lettore usa** (revisione del Task 6, 15/10; scostamento
   dal punto 3). In v1 (GETNEXT, un valore per richiesta) la tabella intera delle interfacce (22 colonne) e quella delle
   porte dello spanning tree non stanno nei 10 s di una lettura. Si leggono: interfacce colonne 2, 3, 6, 8 (`ifDescr`,
   `ifType`, `ifPhysAddress`, `ifOperStatus`: quelle che il lettore usa, `ifSpeed` no); spanning tree con **un GET** degli
   scalari (`.2.0` priorità, `.5.0` radice, `.6.0` costo, `.7.0` porta radice, `.16.0` versione RSTP-MIB) più le colonne 3,
   8, 9 della tabella delle porte (stato, bridge e porta designati). Le altre otto letture restano per tabella (`ifName`,
   base del bridge, LLDP ×3, CDP, fasci, MSTP). Totale **sedici letture** per switch, ognuna con la sua sessione e i suoi
   10 s (il registro diceva «13»: il conto giusto è 4 + 1 + 1 + 4 + 6 = 16), da misurare al Task 17. Il GET in v1: lo stato
   «noSuchName» vale per tutta la richiesta, e allora si chiede un OID alla volta sulla stessa sessione (chi non c'è manca,
   come `noSuchObject` in v2c). Con la stessa revisione: se la **prima** lettura dà «non so» (tempo scaduto, trasporto) le
   altre si saltano (uno switch spento costa 10 s, non 160); nessuna lettura riuscita = errore col codice, niente scrittura
   né potatura; le letture nuove **solo su `device_type = switch`** (spec §13.5.4: estenderle ad AP e NAS è una scelta di
   Riccardo); una porta assente dalla tabella delle porte del bridge è `in_bridge` null, non 0.

**Lasciate spente o nel modo raccomandato (spec §13.16, «Scelte che restano a Riccardo»), finché non risponde:**
1. Censire il router di frontiera e il router virtuale dell'hub (H21): nessun codice; la traccia lo mostra solo se censiti.
2. L'età della posizione delle VM per i collegamenti «dalle VM»: resta com'è (nessuna soglia).
3. La testa quando l'unico router è una VM: in ombra vale la regola di oggi (la VM non è una testa).
4. Gli switch visti solo via LLDP (T1b): restano dove T1b li mette.
5. Il laboratorio dell'hub: dentro o fuori come oggi.
6. Il perimetro (spanning tree, non instradamento): fatto da confermare.
7. Il gateway del controller dell'hub (WAN a 10G, LAN a 25G): in ombra vale la regola del §13.8.3 punto 1 («l'uplink di un
   gateway è la WAN»), fatto da confermare.
8. La guardia «telefono» sulle capacità CDP («Phone»): non entra in T2 (le capacità si salvano, la guardia no).
9. La porta di fabbrica con la velocità in coda (`ether1-2.5`): resta letta fisica.

---

## Auto-revisione (skill writing-plans)

1. **Ogni requisito della spec ha un task.** T2.1 → Task 1; T2.2 → Task 3, 4, 3b (MK7, dopo T2-a); T2.3 → Task 5 (P5);
   T2.4 → Task 6; T2.5 → Task 7 (dopo T2-b); T2.6 → Task 2 (interruttori, esito) e Task 8 (pagina e rotta); T2.7 → Task
   9-12 (prove, collegamenti, albero, traccia, rotta in `ATTESI`); 13.5.1 (sola lettura, spenti, traduttori, errori che non
   fermano, errori dal testo, cadenza e lucchetto, potatura, una connessione, valori ammessi, regole del repo) → Task 1, 2,
   3, 4, 6, 7; 13.5.7 («Chi legge che cosa», «Se la migrazione non riesce») → Task 1, 9, 13; misure e conferme del 13.11.3
   → Task 14-20; prove del 13.12.4 di T2 → Task 1-13; I33 (spia SSH e SNMP, DB) → Task 4, 6, 13; I34 → Task 1; I35, I55
   → Task 1, 13; I37, I58 → Task 9-12 (prova di oggi); I52-I54 → Task 2, 4, 7; scelte del §13.16 → «Scelte».
2. **Nomi e firme coincidono fra i task**: `scriviFattiTopologia(deviceId, fonte, fatti, adesso?)`, `FattiLettura`,
   `conCadenza(l, deviceId, leggi, adesso?)`, `leggiMikrotikTopologia(esegui, { uscitaInterfacce, conVicini })`,
   `fattiMikrotik(LetturaMk)`, `leggiSnmpTopologia(walk, { lettoreCisco })`, `getIngressoCavi(staleDays, nowMs?)`,
   `proveDaInput(ing, ctx, t1)`, `preparaCavi(ing, t1)`, `costruisciCollegamenti(prove, correzioni, ctx)`,
   `costruisciModelloCavi(ing, t1, { testaScelta })`, `calcolaTraccia(oggi, m, limite?)`, `nomiTraccia(t1, m, tr)`:
   riletti dopo la scrittura.
3. **Niente segnaposto**: le uscite vere che non ci sono ancora (T2-a, T2-b, P5) sono dichiarate come condizione del loro
   task, con la verifica della forma prima del codice; i percorsi dei DB e gli id degli apparati delle copie restano fra
   «‹ ›» perché non vanno nel repo.

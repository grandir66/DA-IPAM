# Topologia fase 2b — trascinamento, tasto destro, collegamenti a mano, hypervisor e VM — piano di attuazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** la mappa si costruisce trascinando e col tasto destro; i collegamenti si fanno a mano con le porte e il sistema li verifica e sceglie il principale (che Riccardo può cambiare); gli hypervisor contengono le loro VM; le linee dicono velocità, wireless e PoE.

**Architecture:** quattro tappe. **0** correzione subito (un router non crea collegamenti da ciò che vede sul bridge). **D** (completo) raccoglie: tipo e principale dei collegamenti nel DB, tipo di uplink UniFi, job «lettura hypervisor» con le schede vive via SSH. **E** (leggero, logica pura in `src/lib/topology/`) verifica i collegamenti a mano, sceglie il principale, calcola gli attributi delle linee, mette le VM dentro gli hypervisor. **F** (leggero) è la pagina: trascinamento, menu del tasto destro, barra chiudibile, «Collega a…», VM espandibili, stile delle linee.

**Tech Stack:** Next.js 16 / React 19 / TypeScript strict, better-sqlite3, `node --import tsx --test`, Zod v4, shadcn v4 su `@base-ui/react` 1.3 (c'è `context-menu`), `@xyflow/react` 12.

**Spec:** `docs/superpowers/specs/2026-10-12-topology-map-design.md` §11 (vincolante), §10 per il resto. ADR 0008, 0009.

## Global Constraints

- Repo **pubblico**: niente nomi, IP, MAC o seriali dei clienti in codice, prove, fixture, commit, documenti. Dati di prova inventati con la forma vera (IP di documentazione, MAC `02:00:00:…`).
- `db-tenant` si importa solo staticamente (ADR 0002). Ogni rotta: `withTenantFromSession` + `requireAuth()`/`requireAdmin()` come prima istruzione; corpi con Zod, messaggi in italiano.
- Migrazioni additive e idempotenti, in transazione, in fondo a `getTenantDb` **dopo** `migrateTopologyPhase2`; un nuovo valore nel CHECK di `scheduled_jobs` solo con lo stesso schema di `migrateScheduledJobsV8` (ricostruzione con guardia, prova dedicata).
- `db.ts` e `db-tenant.ts` non divergono (o il chiamante importa da `db-tenant`).
- Date del DB con `parseDbDate`; caricamenti con `fetchJson` + `LoadError`; `setInterval` con pulizia.
- MAC virtuali (VRRP/HSRP) non identificano nessuno; **ciò che un router vede sul bridge o su una VLAN non crea collegamenti** (spec §11.1).
- Interfaccia: italiano, ≥13 px, **mai il solo colore** (stile A, spec §11.4), 1920 px di riferimento, verifiche a 1280 e 1920.
- Segreti: mai nel trascritto né in argomento; solo prima riga di stdin dal filtro del vault che fallisce chiuso. SQL verso un server **solo da stdin** con heredoc tra apici; JSON in SQL con `json_object()` (lezione del 13/10). Dentro ssh `pgrep -x`.
- Ogni push su `dev` arriva al server del cliente da solo: il rilascio passa dalla conferma di Riccardo (tappa 0: nessuna scrittura sui dati, si rilascia con l'ok di questo piano; tappa D+E+F: numeri sulla copia e conferma).
- Al massimo 2 agenti che compilano insieme, ciascuno nel suo worktree. Log nello scratchpad, esito da `exit=`.

## Review Focus

1. **Un hypervisor con due schede su due switch** (bond attivo/riserva): un solo principale, l'altro «ridondanza», e il principale scelto a mano vince anche se i dati preferiscono l'altro → prova nel Task 7.
2. **Un collegamento a mano verso una porta sbagliata**: resta «✎ ?» (non confermato), non diventa principale se c'è un collegamento confermato → prova nel Task 7.
3. **Una VM che esiste anche come host censito** (stesso MAC): un oggetto solo, dentro il suo hypervisor, fuori da «Da sistemare» e fuori dai client della porta → prova nel Task 6.
4. **Scansione Proxmox fallita o vecchia** (SSH irraggiungibile): le VM e le schede di prima restano con la data dell'ultima lettura, mai «0 VM» → prova nel Task 4.
5. **Trascinare un oggetto quando nessuna mappa è scelta**: si chiede il nome, si crea la mappa, l'oggetto c'è; annullare non crea niente → verifica a schermo nel Task 12.

---

## Struttura dei file

- **Tappa 0**: `src/lib/topology/attach.ts` + prova.
- **Tappa D**: `src/lib/db-tenant.ts` (migrazione `migrateTopologyPhase2b`, `migrateScheduledJobsV9`, funzioni del principale e del tipo), `src/lib/scheduled-job-types.ts`, `src/lib/integrations/unifi-device.ts` + `unifi-map.ts` (tipo di uplink), `src/lib/proxmox/live-interfaces.ts` (nuovo, logica pura), `src/lib/proxmox/proxmox-ssh.ts`, `src/lib/proxmox/run-proxmox-device-scan.ts`, `src/lib/cron/jobs.ts` (job `hypervisor_sync`), `scripts/misura-fase2b.ts`.
- **Tappa E**: `src/lib/topology/model-types.ts`, `links.ts`, `identity.ts`, `attach.ts`, `tree.ts`, `tree-layout.ts`, nuovi `vms.ts` e `link-attrs.ts`.
- **Tappa F**: `src/components/topology/map/*` (nuovi `node-context-menu.tsx`, `edge-context-menu.tsx`, `connect-dialog.tsx`, `map-edge.tsx`), rotte `src/app/api/topology/{links,primary,ports}`, `src/app/(dashboard)/topology/dati/` (interruttore del job).

**Ordine**: Task 1 (tappa 0) e rilascio subito. Poi due agenti in parallelo: D (Task 2-5) e E (Task 6-8, che non dipende dallo schema: legge le colonne nuove solo nel Task 8, dopo l'unione). F (Task 9-12) dopo E. Task 13-14 nella sessione principale.

---

## Tappa 0 — correzione (rilascio subito)

### Task 1: un router aggiunge solo ciò che gli è collegato direttamente

**Files:** Modify `src/lib/topology/attach.ts:71`, `src/lib/topology/links.ts` (collegamenti dai vicini LLDP/CDP/MNDP); Test `src/lib/topology/__tests__/attach.test.ts`, `src/lib/topology/__tests__/links.test.ts`

Regola (spec §11.1, Riccardo 14/10): un router (apparato `router`/`firewall`) crea un collegamento verso un vicino LLDP/CDP/MNDP **solo se è diretto**: porta locale fisica (non `bridge`, `vlan*`, `vrrp*`, nomi con `.`/`,` che indicano interfacce logiche o liste come `ether1-2.5,bridge`) **e** unico vicino su quella porta; oppure il vicino conferma dall'altro lato (ha il router fra i suoi vicini su una sua porta, o ha l'uplink UniFi verso il router). I vicini non diretti non diventano collegamenti ma restano negli indici (abbinamento, «non visto»). Dalla tabella MAC un router non crea mai collegamenti (ramo sotto).

- [ ] **Step 0: prove sui vicini** in `links.test.ts` (dati inventati): router con 5 vicini MNDP su `bridge` → nessun collegamento; router con un solo vicino LLDP su `ether3` → collegamento; router con 3 vicini su `ether1` di cui uno è lo switch che vede il router sulla sua `Port 24` → solo router ↔ switch; switch (non router) con più vicini su una porta → comportamento invariato (non è un router). Vederle fallire, poi il codice in `links.ts`, poi verdi.

- [ ] **Step 1: prova che fallisce** — in `attach.test.ts`: un server (host classificato `server_linux` e apparato di tipo `server`, due casi) il cui MAC è visto **solo** da un router su `bridge` → `attachLinks` vuoto e nessun client; lo stesso MAC visto anche su `sw1|Port 15` → collegamento `mac_table` sw1(Port 15) ↔ server.
- [ ] **Step 2: vederla fallire**: `node --import tsx --test src/lib/topology/__tests__/attach.test.ts` → FAIL (oggi crea router ↔ server).
- [ ] **Step 3: il codice** — nel ramo del nodo noto:

```ts
    if (other && other.id !== best.node && nodeClass(other) !== "client") {
      // Spec §11.1: ciò che un router vede sul bridge o su una VLAN non prova nessun cavo.
      if (!best.counting) continue;
```
- [ ] **Step 4: verde** + `node --import tsx --test "src/lib/topology/__tests__/*.test.ts"`, `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 5: misura sulla copia del cliente A** (modello prima/dopo: collegamenti dei router, apparati che passano da un router a uno switch, isolati) — i numeri vanno nel messaggio a Riccardo.
- [ ] **Step 6: commit, cancello, rilascio** — `fix(topologia): un router aggiunge solo ciò che gli è collegato direttamente`; cancello completo una volta (lint, tsc, test, build) con `exit=`; `npm run version:release`; push di `dev`; hub aggiornato come da skill `deploy-prod` (script staccato con registro, come il 13/10); versione e servizio controllati su tutti e due. Nessuna migrazione, nessuna scrittura sui dati.

---

## Tappa D — raccolta (livello completo)

### Task 2: migrazione fase 2b e job `hypervisor_sync`

**Files:** Modify `src/lib/db-tenant.ts`, `src/lib/scheduled-job-types.ts`; Test `src/lib/__tests__/topology-phase2b-migration.test.ts`, `src/lib/__tests__/scheduled-jobs-v9.test.ts`

**Interfaces — Produces:**
- `topology_link_overrides.medium TEXT` (`'cavo' | 'fibra' | 'wireless'` o NULL; validato dalle rotte)
- tabella `topology_link_primary(node_id TEXT PRIMARY KEY, other_node TEXT NOT NULL, node_port TEXT NOT NULL DEFAULT '', other_port TEXT NOT NULL DEFAULT '', set_by TEXT, set_at TEXT NOT NULL DEFAULT (datetime('now')))` — «per l'oggetto `node_id`, il principale è il collegamento verso `other_node` su quelle porte»
- `network_devices.uplink_type TEXT` (`'wire' | 'wireless'` da UniFi)
- `migrateTopologyPhase2b(db): string[]`; `migrateScheduledJobsV9(db): boolean` (CHECK con `'hypervisor_sync'`); `SCHEDULED_JOB_TYPES` += `"hypervisor_sync"`

- [ ] **Step 1: prove che falliscono** — sul modello di `topology-phase2-migration.test.ts` (aggiunge le tre cose, la seconda volta niente, le righe esistenti di `topology_link_overrides` restano con `medium` NULL) e di `scheduled-jobs-v8.test.ts` (dopo la v9 un job `hypervisor_sync` si inserisce, i job esistenti restano identici colonna per colonna, la v9 su un DB già v9 non fa niente).
- [ ] **Step 2: vederle fallire.**
- [ ] **Step 3: il codice** — `migrateTopologyPhase2b` gemella di `migrateTopologyPhase2` (stessa forma: `has`, `add`, transazione, elenco di ciò che aggiunge), chiamata subito dopo quella in `getTenantDb`; `migrateScheduledJobsV9` copia esatta della v8 con la guardia `row.sql.includes("'hypervisor_sync'")`, chiamata dopo la v8.
- [ ] **Step 4: verdi** + prove esistenti della v8 e delle migrazioni topologia.
- [ ] **Step 5: commit** `feat(topologia): migrazione fase 2b — tipo e principale dei collegamenti, tipo di uplink, job hypervisor`.

### Task 3: il tipo di uplink UniFi (cavo o wireless)

**Files:** Modify `src/lib/integrations/unifi-device.ts` (`UnifiUplink` + parser), `unifi-map.ts` / `unifi-sync.ts` (dove si salvano `uplink_mac`/`uplink_seen_at`), `src/lib/db-tenant.ts` (`setNetworkDeviceControllerFacts` o equivalente), fixture `unifi-stat-device.json` (aggiungere `"type": "wire"` e un AP con `"type": "wireless"`, valori inventati); Test: prove UniFi esistenti + una nuova.

- [ ] **Step 1: prova che fallisce** — il parser legge `uplink.type` (`"wire"`, `"wireless"`, altro → null) e la lettura salva `network_devices.uplink_type`; un apparato senza `uplink` mantiene il valore di prima solo se la lettura non lo riporta (come `uplink_mac`).
- [ ] **Step 2-4**: rosso, codice, verde (`node --import tsx --test "src/lib/integrations/__tests__/*.test.ts"`).
- [ ] **Step 5: commit** `feat(controller): tipo di uplink UniFi (cavo o wireless) salvato sull'apparato`.

### Task 4: schede vive degli hypervisor e job `hypervisor_sync`

**Files:** Create `src/lib/proxmox/live-interfaces.ts`; Modify `src/lib/proxmox/proxmox-ssh.ts`, `src/lib/proxmox/run-proxmox-device-scan.ts`, `src/lib/cron/jobs.ts`, `src/lib/db-tenant.ts` (accensione del job), `src/app/(dashboard)/topology/dati/dati-client.tsx` + rotta delle impostazioni topologia; Test `src/lib/proxmox/__tests__/live-interfaces.test.ts`, prova del job.

**Interfaces — Produces:**
- `parseLiveInterfaces(ipLinkJson: unknown, speeds: Record<string, number | null>): LiveInterface[]` con `LiveInterface = { name: string; mac: string | null; state: "up" | "down" | "unknown"; speedMbps: number | null; master: string | null; kind: "eth" | "bond" | "bridge" | "vlan" | "other" }` (logica pura; `kind` da `linkinfo.info_kind` e dal nome; `master` dal campo `master` di `ip -j link`; le schede virtuali `tap*`, `fwbr*`, `veth*`, `fwpr*`, `fwln*` scartate)
- `readLiveInterfaces(opts): Promise<LiveInterface[]>` in `proxmox-ssh.ts`: **un** comando SSH `ip -j link show; echo ---; for f in /sys/class/net/*/speed; do echo "$f $(cat $f 2>/dev/null)"; done`
- nel risultato della scansione: `hosts[i].network_interfaces[j]` riceve `mac_address`, `state`, `speed_mbps`, `master` dalle schede vive con lo stesso nome; `hosts[i].live_read_at` (UTC)
- job `hypervisor_sync`: config `{}` (uno per tenant), `interval_minutes 1440`, **spento di default**; legge tutti gli apparati hypervisor con scansione Proxmox configurata; `setHypervisorSyncSchedule(on: boolean)`; nella pagina «Dati della mappa» una casella «Leggi gli hypervisor ogni giorno (VM e schede)» con lo stato in parole.

- [ ] **Step 1: prove che falliscono** — `parseLiveInterfaces` su un `ip -j link` **inventato con la forma vera** (eno1/eno2 membri di bond0 con `master`, bond0 con `linkinfo.info_kind = "bond"`, vmbr0 `bridge`, vmbr0.40 `vlan`, tap100i0 scartata) + velocità (`eno1 1000`, `eno2 -1` → null); unione col risultato API per nome; **una scansione fallita non sovrascrive** il risultato precedente (Review Focus 4: il JSON resta, la data resta quella vecchia, l'errore va nel resoconto); job fuori dal tenant senza hypervisor → nessuna chiamata.
- [ ] **Step 2-4**: rosso, codice, verde. Nessun MAC, nome o IP nel log.
- [ ] **Step 5: commit** `feat(hypervisor): schede vive via SSH e job di lettura giornaliero, spento di default`.

### Task 5: misura sulla copia

**Files:** Create `scripts/misura-fase2b.ts` (sul modello di `scripts/misura-mac-porta.ts`: copia della copia in `--cartella`, `integrity_check` prima/dopo, migrazione 2b con durata, con `--hypervisor <id> --segreto-stdin` una scansione Proxmox **in sola lettura** sul server del cliente e scrittura **solo sulla copia**; stampa solo conteggi: VM, schede vive con MAC, schede trovate su uno switch, collegamenti proposti, VM riconosciute fra host e apparati).

- [ ] Step 1-3: script, prova su copia sintetica, commit `feat(topologia): misura della fase 2b sulla copia`.

---

## Tappa E — il motore (livello leggero)

### Task 6: hypervisor e VM nel modello

**Files:** Create `src/lib/topology/vms.ts`; Modify `model-types.ts`, `identity.ts` (`nodeClass`), `attach.ts`, `model.ts`, `src/lib/db-tenant.ts` (`getTopologyModelInput`: `vms`); Test `src/lib/topology/__tests__/vms.test.ts`

**Interfaces — Produces:**
- `ModelVmRow = { scannedDeviceId: number; vmid: number; name: string; node: string; status: string; type: string; macs: string[]; ips: string[]; scannedAt: string | null }` — `getTopologyModelInput` li estrae da `network_devices.last_proxmox_scan_result` (JSON in try/catch: un JSON rovinato = nessuna VM per quell'apparato, mai un errore della pagina) insieme a `scanHosts: Array<{ scannedDeviceId: number; hostname: string; ips: string[]; macs: string[] }>`
- `NodeClass` += `"hyper"`; `nodeClass(n)` = `"hyper"` se `type === "hypervisor"`, o se l'apparato ha `vendor` `proxmox`/`vmware` (campo `vendor` aggiunto a `MapNode` come `vendor: string | null`)
- `placeVms(input, idx): { vms: MapVm[]; vmNodeIds: Set<string>; vmMacs: Set<string> }` con `MapVm = { id: string /* "vm:<scannedDeviceId>:<vmid>" */; name; status; ips; hypervisorNodeId: string | null; nodeId: string | null /* nodo esistente che è questa VM */; scannedAt }`. Host della VM: l'host della scansione con `hostname` = `vm.node`, abbinato a un nodo hypervisor per IP, poi per nome (`nameKey`, alias compresi); se non si abbina, l'apparato scansionato. Una VM «è» un nodo esistente se un suo MAC è del nodo (`byMac`) o, senza MAC, se il nome coincide con quello di un nodo `att`/`client`.
- `TopologyModel.vms: MapVm[]`; `attachMacs` riceve `vmMacs` e non conta quei MAC fra i client né crea collegamenti; i nodi VM escono da `isolated`, `withoutSite`, `suspicious`.

- [ ] **Step 1: prove che falliscono** (dati inventati): tre host di cluster con 4 VM; una VM il cui MAC è di un host censito → `nodeId` = quell'host, fuori da `isolated`; un MAC di VM visto su `sw1|Port 17` → non è un client di Port 17; un apparato «server» con `vendor: "proxmox"` → classe `hyper`; JSON rovinato → nessuna VM, nessun errore.
- [ ] **Step 2-4**: rosso, codice, verde (tutte le prove della topologia).
- [ ] **Step 5: commit** `feat(topologia): hypervisor come contenitori, VM dentro il loro host`.

### Task 7: collegamenti a mano verificati e collegamento principale

**Files:** Create `src/lib/topology/link-attrs.ts`; Modify `model-types.ts`, `links.ts`, `tree.ts`; Test `src/lib/topology/__tests__/link-attrs.test.ts`, `tree.test.ts`

**Interfaces — Produces:**
- `LinkOverrideRow` += `medium: string | null`; `TopologyModelInput` += `primaries: Array<{ node_id: string; other_node: string; node_port: string; other_port: string }>`, `portInfo: Array<{ device_id: number; port_name: string; speed: string | null; poe_status: string | null; poe_power_mw: number | null }>`, `devices[].uplink_type` (Task 3; nel ramo E vale `null` finché non si unisce D — stessa regola del 13/10)
- `MapLink` += `medium: "cavo" | "fibra" | "wireless" | null`, `manual: { confirmed: boolean } | null`, `speedMbps: number | null`, `poeW: number | null`, `primary: "user" | "auto" | null`, `redundant: boolean`
- `confirmManual(link, input, idx): boolean` — confermato se esiste un collegamento automatico fra gli stessi nodi, o un MAC del nodo di arrivo (comprese le schede vive dell'hypervisor, Task 4, e i suoi host fusi) visto **non vecchio** sulla porta dichiarata del nodo di partenza (`macPorts`)
- `linkCost(l: MapLink): number` — `primary === "user"` → −1000; poi `(stale ? 100 : 0)` + rango: `unifi_uplink 1`, `lldp/cdp/mndp 2`, `mac_table 3`, a mano confermato `3`, a mano non confermato `4`
- `buildTree` usa `linkCost`; dopo l'albero, per ogni nodo i collegamenti verso nodi visibili che non sono `via` diventano `redundant: true`; `primary: "auto"` sul `via`, `"user"` dove c'è la scelta in `primaries` (che vince anche se costa di più)
- `speedMbps` dal `portInfo` della porta dello switch sul collegamento (`"1000 Mbps"` → 1000, `"10G"` → 10000, sconosciuto → null); `poeW` = `poe_power_mw / 1000` se > 0; `medium` = a mano, altrimenti `"wireless"` se l'uplink del figlio è `wireless` o la porta è `"wifi"`

- [ ] **Step 1: prove che falliscono** — hypervisor con due collegamenti (uplink UniFi verso SW-A, mac_table verso SW-B) → principale SW-A, SW-B `redundant`; con la riga in `primaries` verso SW-B → principale SW-B anche se costa di più (Review Focus 1); a mano verso una porta dove il MAC non c'è → `manual.confirmed = false` e non principale se c'è un confermato (Review Focus 2); a mano verso la porta giusta → confermato; velocità e PoE dalla porta; wireless dall'uplink; stessi dati → stesso albero.
- [ ] **Step 2-4**: rosso, codice, verde.
- [ ] **Step 5: commit** `feat(topologia): collegamenti a mano verificati, principale scelto dal sistema o a mano, velocità, PoE e wireless`.

### Task 8: disposizione con hypervisor espansi

**Files:** Modify `src/lib/topology/tree-layout.ts`; Test `tree-layout.test.ts`

**Interfaces — Produces:** `layoutTree(model, tree, tweaks, expanded: ReadonlySet<string> = new Set())`; un hypervisor è un riquadro come uno switch (classe `hyper`, nella fila dei figli, non nella fascia degli attaccati); se è in `expanded` il riquadro diventa largo `VM_COLS * (VM_W + 8) + 16` (`VM_COLS = 3`, `VM_W = 150`) e alto `BOX_H + 12 + righe * 26`, con `LayoutResult.vmChips: Array<{ vmId: string; hypervisor: string; x: number; y: number; w: number; h: number }>`.

- [ ] **Step 1: prove** — espandere un hypervisor non cambia la x dei rami a sinistra; gli altri livelli scendono solo dell'altezza in più; nessuna scritta delle VM esce dall'etichetta (`fitLabel`).
- [ ] **Step 2-5**: rosso, codice, verde, commit `feat(topologia): hypervisor espandibili con le VM nella disposizione`.

---

## Tappa F — la pagina (livello leggero)

### Task 9: rotte per collegamenti, principale e porte

**Files:** Modify `src/app/api/topology/links/route.ts` (+`medium`), `links/[id]/route.ts` (PATCH porte e tipo); Create `src/app/api/topology/primary/route.ts` (PUT `{ node_id, other_node, node_port, other_port }`, DELETE `{ node_id }`), `src/app/api/topology/ports/route.ts` (GET `?node=dev:N` → porte note: righe di `switch_ports` con velocità e PoE, oppure schede dell'hypervisor dalla scansione); parser in `api-input.ts`; funzioni DB in `db-tenant.ts`; Test parser + DB.

- [ ] TDD come nei task precedenti; `requireAdmin` sulle scritture; nodi validati `^(dev|host|vm):\d+(:\d+)?$` dove servono le VM; rigenerare `docs/auth-matrix.md` col suo generatore. Commit `feat(topologia): rotte per collegamenti a mano col tipo, principale e porte note`.

### Task 10: trascinamento, tasto destro, barra chiudibile

**Files:** Modify `topology-map-client.tsx`, `object-list.tsx`, `map-canvas.tsx`, `linked-panel.tsx`, `map-toolbar.tsx`; Create `node-context-menu.tsx`, `edge-context-menu.tsx`.

- **Trascinamento**: le voci dell'elenco sono `draggable` (dato `application/x-da-ipam-node` con l'id); il contenitore di React Flow gestisce `onDragOver`/`onDrop` e converte il punto con `screenToFlowPosition`: l'oggetto entra nella mappa (`PUT …/nodes`) e, se lo si rilascia in un punto preciso, quel punto diventa il suo ritocco. Senza mappa scelta: dialogo «Nome della nuova mappa» → crea → aggiunge; annulla = niente. **«Inserisci» sparisce.** In «Tutto automatico» il trascinamento non c'è (la mappa mostra già tutto) e l'elenco lo dice nel suggerimento al passaggio del mouse.
- **Tasto destro su un oggetto** (`@base-ui/react/context-menu`, wrapper in `src/components/ui/context-menu.tsx` sullo stile degli altri wrapper): le voci della spec §11.2, ciascuna visibile solo dove ha senso (passo passo / automatico, admin, hypervisor, host); «Aggiungi collegati ▸» è un sottomenu con i collegati non ancora nella mappa, una casella per ognuno e «Aggiungi i selezionati».
- **Tasto destro su una linea**: Modifica porte (solo a mano) · ★ Rendi principale (o «Togli la scelta») · Rimuovi (a mano) / Ignora (automatico, con conferma).
- **Barra di destra**: resta con i dettagli; pulsante «◂ Dettagli» / «Dettagli ▸» nella barra degli strumenti e ✕ nella barra; aperta/chiusa ricordato per chi guarda (`localStorage` in try/catch). I pulsanti d'azione della barra spariscono (stanno nel menu); restano i dati (indirizzi, alias, collegati con porte e fonte, client per porta, VM).
- Spostare gli oggetti trascinandoli resta com'è (ritocchi con firma).
- Commit `feat(topologia): trascinamento dall'elenco, menu del tasto destro, barra dei dettagli chiudibile`.

### Task 11: «Collega a…», stile delle linee, VM espandibili

**Files:** Create `connect-dialog.tsx`, `map-edge.tsx`; Modify `map-node.tsx`, `map-canvas.tsx`, `topology-map-client.tsx`.

- **«Collega a…»**: sui nodi un `Handle` di React Flow (solo admin, pallino visibile al passaggio del mouse); `onConnect` (o la voce del menu, che mette la mappa in «scegli l'oggetto di arrivo») apre `connect-dialog`: porta di partenza e di arrivo (`Select` con le porte note da `GET /api/topology/ports`, più «scrivi a mano»), tipo cavo/fibra/wireless, nota; salva con `POST /api/topology/links`; dopo il ricaricamento la linea mostra «✎ ✓» o «✎ ?» e la barra dice perché in parole.
- **Linee** (`map-edge.tsx`, tipo personalizzato su `getSmoothStepPath` con `borderRadius: 0`): spessore da `speedMbps` (≥10000 → 6, ≥2500 → 4, ≥1000 → 2,4, <1000 → 1,2, null → 2,4) + etichetta («10G», «2,5G», «1G», «100M»); `medium === "wireless"` → tracciato ondulato + «≋ Wi-Fi»; `redundant` → due tracciati paralleli sottili + «ridondanza»; `stale` → grigio tratteggiato + «▲ non visto da N g»; `manual` → badge «✎ ✓» / «✎ ?» (non confermato puntinato); `poeW` → «⚡ N W» vicino alla porta dello switch; `primary === "user"` → «★». Etichette ≥13 px che non coprono i riquadri.
- **VM**: riquadro dell'hypervisor con «N VM, M accese ▸»; «Mostra VM» lo mette in `expanded` (stato della pagina, non salvato) e disegna le etichette delle VM (▶ accesa / ■ spenta, nome, IP); tasto destro su una VM: «Aggiungi alla mappa» (id `vm:…`, o il nodo esistente se la VM è un oggetto censito), «Dettagli». «Aggiorna VM» chiama `POST /api/devices/[id]/proxmox-scan` e ricarica.
- Commit `feat(topologia): collega a mano con le porte, stile delle linee (velocità, wireless, PoE, ridondanza), VM espandibili`.

### Task 12: a schermo sulla copia

- [ ] App locale sulla copia del cliente A (ricetta del Task 12 della fase 2, utenza di prova con password generata in un file `chmod 600`), `playwright-core` con Chrome, 1920 e 1280, `innerWidth` stampato: trascinamento con e senza mappa (Review Focus 5), menu su oggetto e su linea, «Collega a…» verso la porta giusta e verso una sbagliata, «Rendi principale», hypervisor espanso con le VM, linee 10G/1G/100M/wireless/PoE/ridondanza visibili, barra chiusa e riaperta. Foto nello scratchpad, mai nel repo. Si corregge quello che si vede; commit `fix(topologia): quel che si è visto a schermo (fase 2b)`.

---

## Uscita (sessione principale)

### Task 13: unione, revisione finale, misura, conferma, rilascio

- [ ] Unione di D e E+F in un worktree da `origin/dev`; conflitti tenendo entrambe le aggiunte (in `getTopologyModelInput` vincono le query vere di D).
- [ ] **Una revisione finale** su Opus dell'intero lavoro, un solo giro di correzioni, una revisione mirata.
- [ ] Cancello completo una volta (`exit=`).
- [ ] Copie fresche, `quick_check` di tutti i tenant, `scripts/misura-fase2b.ts` sulle copie (con una scansione Proxmox in sola lettura dove ci sono le credenziali, segreto dal filtro del vault).
- [ ] **Conferma di Riccardo** con i numeri (migrazione, VM trovate, schede vive, collegamenti proposti, VM riconosciute) e la domanda separata per accendere `hypervisor_sync` sul server del cliente A e sull'hub.
- [ ] Copie sui server, `version:release`, push di `dev`, hub aggiornato, controlli dopo (versione, servizio, journal, `quick_check`). Job acceso solo se confermato, **con `json_object()` e SQL da stdin**, poi `json_valid` letto.

### Task 14: documenti e chiusura

- [ ] ADR 0010 `docs/adr/0010-topologia-fase2b-collegamenti-e-vm.md` (decisione: collegamenti a mano verificati e principale scelto dal sistema con la scelta di Riccardo che vince; hypervisor contenitori con le VM; schede vive via SSH; stile delle linee; **cosa diventa difficile**: due scrittori del principale — sistema e Riccardo —; VMware non c'è; le VM senza MAC si riconoscono solo per nome; gli id `vm:` nelle mappe dipendono dal `vmid` di Proxmox).
- [ ] CHANGELOG, CONTEXT §6, spec §11.6 con la versione, bacheca, lezioni nuove.
- [ ] Istruzioni a Riccardo passo passo per provare la mappa a 1920.

## Self-review (fatta)

- **Copertura della spec §11**: 11.1 → Task 1 (router), 6 (server Proxmox come hypervisor, VM, isolati), 3 (tipo di uplink); 11.2 → Task 10; 11.3 → Task 2, 7, 9, 11; 11.4 → Task 7 (dati), 11 (disegno); 11.5 → Task 4, 6, 8, 11; 11.6 → l'ordine delle tappe.
- **Nomi coerenti**: `migrateTopologyPhase2b`, `migrateScheduledJobsV9`, `hypervisor_sync`, `setHypervisorSyncSchedule`, `parseLiveInterfaces`, `readLiveInterfaces`, `LiveInterface`, `ModelVmRow`, `placeVms`, `MapVm`, `confirmManual`, `linkCost`, `layoutTree(…, expanded)`, `vmChips`, `topology_link_primary`, `medium`, `uplink_type`.
- **Review Focus**: 1-2 → Task 7; 3 → Task 6; 4 → Task 4; 5 → Task 12.

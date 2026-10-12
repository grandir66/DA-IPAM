# Design — Mappa topologia interattiva (fisica + logica) con stato

> Spec di progettazione. Stato: **bozza da approvare**. Data: 2026-10-12.
> Feature **generale e multi-tenant** di DA-IPAM (non specifica di un cliente).
> Primo caso d'uso di validazione: tenant **DTS**. Alla conferma → piano di
> implementazione. Decisione architetturale → ADR `docs/adr/0003-topology-map.md`.

## 1. Obiettivo

Una **vista topologia interattiva** dentro DA-IPAM che mostri la rete in modo
**fisico + logico**, con:

- **icone per tipo** di apparato (router, switch, access point, storage, host
  Proxmox, VM);
- **nodi trascinabili con posizione salvata** (layout persistente per tenant/vista);
- **stato a semaforo** 🟢 OK / 🟠 Warning / 🔴 Fail / ⚪ sconosciuto, dal monitoraggio
  già presente;
- **export drawio** della mappa corrente (editing offline / documenti).

**Scope nodi**: device di rete + host Proxmox + VM. **No** PC/client.
**Dettaglio**: adiacenze **LLDP + porte + modelli** (nessun rilievo rack/cablaggio).

Principio ROADMAP rispettato: **additivo e non distruttivo**, opzionale per tenant,
air-gapped (nessuna dipendenza cloud).

## 2. Sorgente dati (riuso, non reinvenzione)

Tutto dall'inventario **già presente** in DA-IPAM, **per-tenant**:

- `devices` (+ `/devices/[id]/mikrotik`) → nodi router/switch/hypervisor (type, model, mgmt_ip).
- `physical-devices` (+ `link`) → adiacenze fisiche note/confermate.
- `hosts` → host Proxmox + VM (filtrati per classe; esclusi endpoint/PC).
- porte + `trunk_neighbor_name/port` → `Port` + archi LLDP.
- **UniFi**: oggi DA-IPAM legge UniFi via **SNMP** (summary) e **SSH CLI** (`unifi-cli.ts`),
  **non** via API del controller. SNMP è **indipendente dal tipo di controller** (self-hosted
  *o* UDM/cloud) → base dell'MVP. Come **arricchimento (Fase 2)** si aggiunge un **collector API
  controller multi-backend**, scelto per-tenant: (a) **Network App self-hosted** classica — session
  API `:8443/api/...` (es. DTS `172.16.1.222` v10.6.1, 74 device, 72 con `lldp_table`); (b) **UDM /
  UniFi OS** locale — Integration API `/proxy/network/integration/v1/...` con `X-API-KEY`;
  (c) **UniFi cloud** — Site Manager API `api.ui.com` con API-key. Il tipo NON blocca l'MVP.
- **Stato** da: `status` (online/offline/unknown · up/down), `port_status`, `latency_ms`,
  `severity` (anomaly), e **LibreNMS** (device up/down, alert).

## 3. Architettura (conforme alle regole DA-IPAM)

Tre parti additive: **tabella posizioni (tenant)**, **API topologia**, **pagina mappa**.

### 3.1 Persistenza posizioni — DB **tenant**

Dati specifici cliente → **DB tenant** (regola #11). Nuova tabella in
`src/lib/db-tenant-schema.ts` con `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE`
idempotente inline (regola #10, niente framework migrazioni):

```
topology_position(
  id INTEGER PRIMARY KEY,
  view TEXT NOT NULL,            -- chiave vista: sito o 'default'
  node_kind TEXT NOT NULL,       -- 'device' | 'host' | 'vm'
  node_id INTEGER NOT NULL,      -- ref a devices/hosts
  x REAL NOT NULL, y REAL NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(view, node_kind, node_id)
)
```

Funzioni in `db-tenant.ts` (+ facade `db.ts`, regola #12): `getTopologyPositions(view)`,
`upsertTopologyPositions(rows)` (in `db.transaction()`, regola #7). Import di
`db-tenant` **solo statico** (regola #14).

### 3.2 Derivazione stato (4 livelli) — server-side

Funzione pura `deriveStatus(signals) -> 'ok'|'warning'|'fail'|'unknown'`:

| Livello | Colore | Condizione |
|---|---|---|
| **fail** | 🔴 | offline/down · alert LibreNMS critico · anomaly `critical` |
| **warning** | 🟠 | online ma degradato: `latency_ms` > soglia · porta uplink down · alert/anomaly `warning` |
| **ok** | 🟢 | online, nessun alert/anomalia |
| **unknown** | ⚪ | stato `unknown` / non monitorato / `last_seen` oltre finestra |

Soglie (latenza, finestra `last_seen`) in settings tenant, con default documentati.

### 3.3 API (auth obbligatoria, tenant-scoped via `withTenantFromSession`)

- `GET /api/topology?view=<sito>` → `{ nodes:[{kind,id,name,type,model,mgmt_ip,site,status}],
  edges:[{a,aPort,b,bPort,medium}], positions:[...] }`. `requireAuth()` (regola #2).
  Query con JOIN per nodi+stato (no N+1, regola #6); `LIMIT`/scoping per vista (regola #9).
- `PUT /api/topology/positions` → salva `[{kind,id,x,y,pinned}]`. `requireAuth()`, transazione.
- `GET /api/topology/status?view=<sito>` → solo lo stato dei nodi (per polling leggero).
- `GET /api/topology/export?view=<sito>&format=drawio` → **export drawio** (vedi §3.5).

### 3.4 Frontend — pagina mappa (client component)

- Rotta nuova (es. `/topology`) + **una voce di nav** (unico tocco a file di nav).
- **Libreria: React Flow (`@xyflow/react`)** + **dagre** per auto-layout dei nodi senza
  posizione salvata. Motivazione: nodi custom (icona per tipo + anello colore stato),
  drag nativo, posizioni esportabili/persistibili, zoom/pan; dimensioni topologia
  per-vista gestibili. (Decisione in ADR 0003.)
- **Nodo custom**: icona generica per tipo (lucide-react / SVG: router, switch, wifi/AP,
  storage, server=Proxmox, box=VM) + bordo/badge colore stato + tooltip (nome, IP, modello,
  porte vicine).
- **Drag → salvataggio**: `onNodeDragStop` → PUT `positions` con **debounce**.
- **Stato live**: polling `GET /api/topology/status` ogni N s (default 30s) via
  `useEffect`+`useRef` con **cleanup** (regola #8).
- **Selettore vista** per sito. Palette Domarc; testi in italiano (regola #13).

### 3.5 Export drawio

Endpoint server che riusa il grafo di `/api/topology` ed emette **XML drawio** con shape
`mxgraph.networks.*` per tipo, posizioni salvate (se presenti) e colore di stato. È il
"generatore" dell'ipotesi iniziale, ora ridotto a **export** (non deliverable primario).

## 4. Sicurezza

- **Sola lettura** verso gli apparati: lo stato viene dal monitoraggio già esistente;
  nessuna scrittura sui device. Le uniche scritture sono le **posizioni** (DB tenant).
- Auth su ogni endpoint (regola #2); credenziali cifrate (`safeDecrypt`, regola #3);
  `JSON.parse` in try-catch lato server (regola #4); niente debug committato (regola #5).
- Multi-tenant: dati e viste isolati per tenant.

## 5. Testing

- Unit: `deriveStatus` (fixture segnali → livello atteso), `buildTopology` (fixture
  inventario → nodi/archi attesi), `exportDrawio` (grafo → XML valido con nodi attesi).
  Fixture con **forma reale**; le prove si auto-predispongono e ripuliscono.
- Verifica obbligatoria: `npm run lint && npx tsc --noEmit && npm run build`.
- Post-modifica codice: `npm run version:release && git push`.

## 6. Non distruttività (cosa si tocca)

Additivo: nuova tabella tenant (idempotente), nuove API routes, nuova pagina + 1 voce
nav, nuove dipendenze (`@xyflow/react`, `dagre`). **Nessuna** modifica ai file critici
(`db-hub-schema`, `auth`, `api-tenant`, `server.ts`) oltre allo schema tenant additivo.

## 7. Performance

- Scoping **per vista/sito**; query con JOIN; paginazione/limiti sulle liste.
- Polling stato leggero e configurabile; render React Flow con nodi custom memoizzati.

## 8. Fasi

- **Fase 0 — misura (read-only, su DTS)**: quanto DA-IPAM già copre (devices, hosts,
  physical-devices/link, porte, `trunk_neighbor_*`, LibreNMS) → sapere quali archi/stati
  sono disponibili e dove arricchire (UniFi).
- **Fase 1 — MVP**: tabella `topology_position` + API topologia (nodi/archi/posizioni/stato)
  + pagina mappa (React Flow, drag+save, 4 colori, auto-layout). Per-sito. Test + ADR 0003.
- **Fase 2 — arricchimento**: export drawio; LLDP da UniFi dove il summary è magro;
  raffinamento storage/VM; soglie stato in settings.
- **Fase 3 — generalizzazione**: validazione su DTS come primo tenant, poi tutti;
  manuale utente; ROADMAP (nuova voce additiva).

## 9. Aperti / da confermare

- ADR 0003 (React Flow + tabella tenant + derivazione stato).
- Copertura reale DA-IPAM e **LibreNMS** a DTS (esito fase 0).
- DTS: l'account `map` sul self-hosted `172.16.1.222` ha **già diritti di sola lettura** → usabile così com'è per il collector (nessun account nuovo da creare).
- **Tenant Domarc** (UDM cloud, rete Domarc): backend (c) `api.ui.com` **raggiungibile e la key è valida**, ma risponde `insufficient permissions` → **rigenerare la cloud API-key su unifi.ui.com con scope di lettura** (hosts/sites/devices). Chiave nel vault `da-IPAM-accessi.md` → `## UNIFI DOMARC`.
- Doc di configurazione dell'utente per riconciliazioni residue (lato DTS).

---

**Nota DTS**: i diagrammi drawio già prodotti (`D5` to-be, `topologia-attuale-riconciliata`,
`DTS-Network-aggiornato`) restano come **documenti di progetto** nel client folder DTS; la
mappa viva diventa questa vista in DA-IPAM.

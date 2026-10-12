# Mappa topologia interattiva — Implementation Plan (Fase 1 MVP)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una vista `/topology` dentro DA-IPAM che disegna la rete del tenant (device + host Proxmox/VM) con icone per tipo, nodi trascinabili con posizione salvata, archi dalle adiacenze LLDP, e stato a semaforo (OK/Warning/Fail/sconosciuto).

**Architecture:** Feature additiva multi-tenant. Logica pura testabile in `src/lib/topology/` (status, graph, layout). Persistenza posizioni in nuova tabella tenant `topology_position`. Tre route API (`GET /api/topology`, `PUT /api/topology/positions`). Pagina client React Flow sotto `src/app/(dashboard)/topology/`. Nessun dato nuovo scoperto: si riusa `network_devices`, `hosts`, `device_neighbors`, `switch_ports`, LibreNMS.

**Tech Stack:** Next.js 16 / React 19 / TS strict · better-sqlite3 (tenant DB) · **@xyflow/react** (React Flow) + **dagre** (auto-layout) · lucide-react (icone) · node:test (unit, logica pura).

**Spec:** `docs/superpowers/specs/2026-10-12-topology-map-design.md`

## Global Constraints

- Node **20.x o 22.x LTS** (≥25 rompe better-sqlite3).
- **`db-tenant` import SOLO statico** (`import`/`require`, mai `await import()`); presidiato da `no-dynamic-db-tenant-import.test.ts`.
- **Nessun framework migrazioni**: tabella nuova in `db-tenant-schema.ts` (`CREATE TABLE IF NOT EXISTS`); eventuali ALTER idempotenti `PRAGMA table_info`-guarded dentro `getTenantDb` in `db-tenant.ts` dopo `newDb.exec(TENANT_SCHEMA_SQL)`.
- **Funzione DB** = sorgente in `db-tenant.ts` + esposta nel facade `db.ts`; non divergere.
- **Auth** su ogni route: `requireAuth()`/`requireAdmin()` da `api-auth.ts`, dentro `withTenantFromSession()`; errori Zod via `parsed.error.issues[0].message` (Zod v4).
- **DELETE+INSERT** sempre in `d.transaction(...)`; niente N+1.
- **React**: `useEffect`+`useRef` con cleanup per ogni `setInterval`; shadcn su **@base-ui** (`render={<.../>}`, `nativeButton={false}`, niente `asChild`).
- **UI in italiano**; palette Domarc (Primary `#00A7E7`, Navy `#0D2537`, Gold `#FFD400`).
- **Post-modifica**: `npm run lint && npx tsc --noEmit && npm run build`; poi `npm run version:release && git push`.
- Test: `npm test` (node:test + tsx, co-locati in `__tests__/`, **solo logica pura**).

## Review Focus

- **Vicino LLDP verso un device non in inventario** (`remote_device_name`/`remote_ip` non risolvibile): deve creare un nodo "esterno" placeholder o essere ignorato con grazia, mai crashare. → test in Task 4 (graph).
- **Nodo senza posizione salvata** (device appena comparso): l'auto-layout deve posizionarlo; le posizioni salvate hanno la precedenza. → test in Task 5 (layout).
- **Segnali di stato assenti/misti** (host `unknown`, nessun LibreNMS, device `enabled=0`): `deriveNodeStatus` → `unknown`, mai eccezione; `enabled=0` ≠ `fail`. → test in Task 3 (status).
- **Adiacenze bidirezionali duplicate** (A→B e B→A): un solo arco nel grafo. → test in Task 4 (graph).
- **Isolamento tenant sulle posizioni**: salvataggio nel DB del tenant sbagliato se non si passa da `withTenantFromSession`/`withTenant`. → presidiato dal pattern tenant in Task 6/7 (nessuna chiamata DB fuori dal wrapper).

---

## Task 1: Dipendenze + tipi condivisi

**Files:**
- Modify: `package.json` (deps)
- Create: `src/lib/topology/types.ts`

**Interfaces:**
- Produces: `TopologyStatus`, `StatusSignals`, `TopologyNode`, `TopologyEdge`, `TopologyGraph`, `PositionedNode`, `SavedPosition`, le row-shape `DeviceRow`/`HostRow`/`NeighborRow`.

- [ ] **Step 1: Installare le dipendenze**

```bash
nvm use 22
npm install @xyflow/react@12.8.6 dagre@0.8.5
npm install -D @types/dagre@0.7.53
```

- [ ] **Step 2: Creare i tipi condivisi**

`src/lib/topology/types.ts`:
```ts
export type TopologyStatus = "ok" | "warning" | "fail" | "unknown";
export type NodeKind = "device" | "host" | "external";

export interface StatusSignals {
  hostStatus?: "online" | "offline" | "unknown" | null;
  latencyMs?: number | null;
  lastSeen?: string | null;           // SQL/ISO datetime
  deviceEnabled?: boolean | null;
  libreStatus?: number | null;        // 1=up, 0=down
  anomalySeverity?: "low" | "medium" | "high" | null;
  uplinkDown?: boolean;
  nowMs?: number;                     // clock iniettato (test)
  latencyWarnMs?: number;             // default 150
  staleSeconds?: number;              // default 900
}

export interface DeviceRow {
  id: number; name: string; device_type: string;
  model: string | null; host: string | null; enabled: number;
}
export interface HostRow {
  id: number; ip: string; hostname: string | null; custom_name: string | null;
  classification: string; status: string | null; last_response_time_ms: number | null;
  last_seen: string | null; model: string | null; network_id: number;
}
export interface NeighborRow {
  device_id: number; local_port: string; remote_device_name: string;
  remote_port: string; protocol: string; remote_ip: string | null;
}

export interface TopologyNode {
  id: string; kind: NodeKind; refId: number | null;
  name: string; type: string; model: string | null; mgmtIp: string | null;
  status: TopologyStatus;
}
export interface TopologyEdge {
  id: string; source: string; target: string;
  sourcePort?: string; targetPort?: string; protocol: string;
}
export interface TopologyGraph { nodes: TopologyNode[]; edges: TopologyEdge[]; }

export interface SavedPosition { nodeId: string; x: number; y: number; pinned: boolean; }
export interface PositionedNode { nodeId: string; x: number; y: number; fromSaved: boolean; }
```

- [ ] **Step 3: Verificare compilazione**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/topology/types.ts
git commit -m "feat(topology): dipendenze React Flow/dagre + tipi condivisi"
```

---

## Task 2: Risoluzione nodi/archi — helper puri di matching

**Files:**
- Create: `src/lib/topology/match.ts`
- Test: `src/lib/topology/__tests__/match.test.ts`

**Interfaces:**
- Produces: `normalizeName(s: string): string`; `resolveRemote(remote: {name: string; ip: string|null}, index: {byName: Map<string,string>; byIp: Map<string,string>}): string | null` (ritorna il `TopologyNode.id` risolto o `null`).

- [ ] **Step 1: Scrivere i test (falliscono)**

`src/lib/topology/__tests__/match.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeName, resolveRemote } from "@/lib/topology/match";

test("normalizeName abbassa e toglie dominio/spazi", () => {
  assert.equal(normalizeName("MK-D1-RTR.dts.local "), "mk-d1-rtr");
});

test("resolveRemote preferisce il match per IP", () => {
  const index = { byName: new Map([["sw1", "dev:1"]]), byIp: new Map([["172.17.0.5", "host:9"]]) };
  assert.equal(resolveRemote({ name: "sw1", ip: "172.17.0.5" }, index), "host:9");
});

test("resolveRemote ripiega sul nome normalizzato", () => {
  const index = { byName: new Map([["sw1", "dev:1"]]), byIp: new Map() };
  assert.equal(resolveRemote({ name: "SW1.dts.local", ip: null }, index), "dev:1");
});

test("resolveRemote ritorna null se non risolvibile", () => {
  assert.equal(resolveRemote({ name: "ignoto", ip: null }, { byName: new Map(), byIp: new Map() }), null);
});
```

- [ ] **Step 2: Eseguire i test (devono fallire)**

Run: `npm test -- src/lib/topology/__tests__/match.test.ts` (oppure `node --import tsx --test src/lib/topology/__tests__/match.test.ts`)
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implementare**

`src/lib/topology/match.ts`:
```ts
export function normalizeName(s: string): string {
  return s.trim().toLowerCase().split(".")[0];
}

export function resolveRemote(
  remote: { name: string; ip: string | null },
  index: { byName: Map<string, string>; byIp: Map<string, string> }
): string | null {
  if (remote.ip) {
    const byIp = index.byIp.get(remote.ip);
    if (byIp) return byIp;
  }
  if (remote.name) {
    const byName = index.byName.get(normalizeName(remote.name));
    if (byName) return byName;
  }
  return null;
}
```

- [ ] **Step 4: Eseguire i test (passano)**

Run: `npm test -- src/lib/topology/__tests__/match.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/topology/match.ts src/lib/topology/__tests__/match.test.ts
git commit -m "feat(topology): helper puri di matching nodi (nome/IP)"
```

---

## Task 3: Derivazione stato (puro) — `deriveNodeStatus`

**Files:**
- Create: `src/lib/topology/status.ts`
- Test: `src/lib/topology/__tests__/status.test.ts`

**Interfaces:**
- Consumes: `StatusSignals` (Task 1).
- Produces: `deriveNodeStatus(sig: StatusSignals): TopologyStatus`.

- [ ] **Step 1: Scrivere i test (falliscono)**

`src/lib/topology/__tests__/status.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveNodeStatus } from "@/lib/topology/status";

const NOW = Date.parse("2026-10-12T10:00:00Z");

test("offline → fail", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "offline", nowMs: NOW }), "fail");
});
test("libreStatus 0 → fail", () => {
  assert.equal(deriveNodeStatus({ libreStatus: 0, nowMs: NOW }), "fail");
});
test("anomalia high → fail", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", anomalySeverity: "high", nowMs: NOW }), "fail");
});
test("online + latenza alta → warning", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", latencyMs: 300, nowMs: NOW }), "warning");
});
test("online + uplink down → warning", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", uplinkDown: true, nowMs: NOW }), "warning");
});
test("online pulito → ok", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", latencyMs: 10, nowMs: NOW }), "ok");
});
test("libreStatus 1 pulito → ok", () => {
  assert.equal(deriveNodeStatus({ libreStatus: 1, nowMs: NOW }), "ok");
});
test("device disabilitato senza segnali → unknown (non fail)", () => {
  assert.equal(deriveNodeStatus({ deviceEnabled: false, nowMs: NOW }), "unknown");
});
test("nessun segnale → unknown", () => {
  assert.equal(deriveNodeStatus({ nowMs: NOW }), "unknown");
});
test("online ma last_seen stale e nessun altro segnale → unknown", () => {
  assert.equal(deriveNodeStatus({ hostStatus: "online", lastSeen: "2026-10-12 08:00:00", nowMs: NOW, staleSeconds: 900 }), "unknown");
});
```

- [ ] **Step 2: Eseguire i test (devono fallire)**

Run: `npm test -- src/lib/topology/__tests__/status.test.ts`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implementare**

`src/lib/topology/status.ts`:
```ts
import type { StatusSignals, TopologyStatus } from "@/lib/topology/types";

function parseSqlUtc(s: string): number {
  // "YYYY-MM-DD HH:MM:SS" (UTC) o ISO
  const iso = s.includes("T") ? s : s.replace(" ", "T") + "Z";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}

export function deriveNodeStatus(sig: StatusSignals): TopologyStatus {
  const now = sig.nowMs ?? Date.now();
  const latencyWarn = sig.latencyWarnMs ?? 150;
  const staleSec = sig.staleSeconds ?? 900;

  // FAIL
  if (sig.hostStatus === "offline") return "fail";
  if (sig.libreStatus === 0) return "fail";
  if (sig.anomalySeverity === "high") return "fail";

  const isLive = sig.hostStatus === "online" || sig.libreStatus === 1;

  // UNKNOWN: nessun segnale di liveness
  if (!isLive) return "unknown";

  // UNKNOWN: vivo per stato ma last_seen troppo vecchio e nessun segnale fresco
  if (sig.lastSeen) {
    const seen = parseSqlUtc(sig.lastSeen);
    if (!Number.isNaN(seen) && now - seen > staleSec * 1000 && sig.libreStatus !== 1) {
      return "unknown";
    }
  }

  // WARNING
  if (sig.anomalySeverity === "medium") return "warning";
  if (sig.uplinkDown) return "warning";
  if (sig.latencyMs != null && sig.latencyMs > latencyWarn) return "warning";

  return "ok";
}
```

- [ ] **Step 4: Eseguire i test (passano)**

Run: `npm test -- src/lib/topology/__tests__/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/topology/status.ts src/lib/topology/__tests__/status.test.ts
git commit -m "feat(topology): derivazione stato a 4 livelli (puro)"
```

---

## Task 4: Costruzione grafo (puro) — `buildTopologyGraph`

**Files:**
- Create: `src/lib/topology/graph.ts`
- Test: `src/lib/topology/__tests__/graph.test.ts`

**Interfaces:**
- Consumes: `DeviceRow[]`, `HostRow[]`, `NeighborRow[]`, mappa `statusByNode: Map<string, TopologyStatus>`, `hostClassifications: string[]` (default `["hypervisor","vm","proxmox"]`), `resolveRemote`/`normalizeName` (Task 2).
- Produces: `buildTopologyGraph(input: { devices; hosts; neighbors; statusByNode; hostClassifications? }): TopologyGraph`.
- Node id: device → `dev:<id>`, host → `host:<id>`, esterno → `ext:<normalizeName>`.

- [ ] **Step 1: Scrivere i test (falliscono)**

`src/lib/topology/__tests__/graph.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTopologyGraph } from "@/lib/topology/graph";
import type { DeviceRow, HostRow, NeighborRow } from "@/lib/topology/types";

const dev = (o: Partial<DeviceRow>): DeviceRow => ({ id: 1, name: "SW1", device_type: "switch", model: "US8P60", host: "172.16.3.1", enabled: 1, ...o });
const host = (o: Partial<HostRow>): HostRow => ({ id: 1, ip: "172.17.16.5", hostname: "px-up", custom_name: null, classification: "hypervisor", status: "online", last_response_time_ms: 5, last_seen: null, model: null, network_id: 1, ...o });
const nb = (o: Partial<NeighborRow>): NeighborRow => ({ device_id: 1, local_port: "1", remote_device_name: "SW2", remote_port: "2", protocol: "lldp", remote_ip: null, ...o });

test("device + host (hypervisor) diventano nodi; PC esclusi", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1, name: "SW1" })],
    hosts: [host({ id: 1, classification: "hypervisor" }), host({ id: 2, classification: "workstation" })],
    neighbors: [], statusByNode: new Map(),
  });
  const ids = g.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["dev:1", "host:1"]);
});

test("vicino verso device noto → arco dev→dev", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1, name: "SW1" }), dev({ id: 2, name: "SW2" })],
    hosts: [], neighbors: [nb({ device_id: 1, remote_device_name: "SW2" })], statusByNode: new Map(),
  });
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].source, "dev:1");
  assert.equal(g.edges[0].target, "dev:2");
});

test("vicino non risolvibile → nodo esterno placeholder", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1, name: "SW1" })],
    hosts: [], neighbors: [nb({ device_id: 1, remote_device_name: "ISP-GW" })], statusByNode: new Map(),
  });
  assert.ok(g.nodes.some((n) => n.kind === "external" && n.id === "ext:isp-gw"));
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].target, "ext:isp-gw");
});

test("archi bidirezionali deduplicati", () => {
  const g = buildTopologyGraph({
    devices: [dev({ id: 1, name: "SW1" }), dev({ id: 2, name: "SW2" })],
    hosts: [],
    neighbors: [nb({ device_id: 1, remote_device_name: "SW2" }), nb({ device_id: 2, remote_device_name: "SW1", local_port: "2", remote_port: "1" })],
    statusByNode: new Map(),
  });
  assert.equal(g.edges.length, 1);
});

test("nodo orfano (senza archi) resta nel grafo", () => {
  const g = buildTopologyGraph({ devices: [dev({ id: 7, name: "ORPH" })], hosts: [], neighbors: [], statusByNode: new Map() });
  assert.ok(g.nodes.some((n) => n.id === "dev:7"));
});

test("status applicato ai nodi, default unknown", () => {
  const g = buildTopologyGraph({ devices: [dev({ id: 1 })], hosts: [], neighbors: [], statusByNode: new Map([["dev:1", "ok"]]) });
  assert.equal(g.nodes.find((n) => n.id === "dev:1")!.status, "ok");
});
```

- [ ] **Step 2: Eseguire i test (devono fallire)**

Run: `npm test -- src/lib/topology/__tests__/graph.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementare**

`src/lib/topology/graph.ts`:
```ts
import type { DeviceRow, HostRow, NeighborRow, TopologyGraph, TopologyNode, TopologyEdge, TopologyStatus } from "@/lib/topology/types";
import { normalizeName, resolveRemote } from "@/lib/topology/match";

const DEFAULT_HOST_CLASSES = ["hypervisor", "vm", "proxmox"];

export function buildTopologyGraph(input: {
  devices: DeviceRow[]; hosts: HostRow[]; neighbors: NeighborRow[];
  statusByNode: Map<string, TopologyStatus>; hostClassifications?: string[];
}): TopologyGraph {
  const classes = (input.hostClassifications ?? DEFAULT_HOST_CLASSES).map((c) => c.toLowerCase());
  const nodes = new Map<string, TopologyNode>();
  const byName = new Map<string, string>();
  const byIp = new Map<string, string>();
  const st = (id: string): TopologyStatus => input.statusByNode.get(id) ?? "unknown";

  for (const d of input.devices) {
    const id = `dev:${d.id}`;
    nodes.set(id, { id, kind: "device", refId: d.id, name: d.name, type: d.device_type, model: d.model, mgmtIp: d.host, status: st(id) });
    if (d.name) byName.set(normalizeName(d.name), id);
    if (d.host) byIp.set(d.host, id);
  }
  for (const h of input.hosts) {
    if (!classes.includes((h.classification || "").toLowerCase())) continue;
    const id = `host:${h.id}`;
    const name = h.custom_name || h.hostname || h.ip;
    nodes.set(id, { id, kind: "host", refId: h.id, name, type: h.classification, model: h.model, mgmtIp: h.ip, status: st(id) });
    if (h.hostname) byName.set(normalizeName(h.hostname), id);
    if (h.ip) byIp.set(h.ip, id);
  }

  const index = { byName, byIp };
  const edges = new Map<string, TopologyEdge>();
  for (const n of input.neighbors) {
    const source = `dev:${n.device_id}`;
    if (!nodes.has(source)) continue;
    let target = resolveRemote({ name: n.remote_device_name, ip: n.remote_ip }, index);
    if (!target) {
      if (!n.remote_device_name) continue;
      target = `ext:${normalizeName(n.remote_device_name)}`;
      if (!nodes.has(target)) {
        nodes.set(target, { id: target, kind: "external", refId: null, name: n.remote_device_name, type: "external", model: null, mgmtIp: n.remote_ip, status: "unknown" });
      }
    }
    if (source === target) continue;
    const key = [source, target].sort().join("|");
    if (edges.has(key)) continue;
    edges.set(key, { id: `edge:${key}`, source, target, sourcePort: n.local_port || undefined, targetPort: n.remote_port || undefined, protocol: n.protocol });
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
```

- [ ] **Step 4: Eseguire i test (passano)**

Run: `npm test -- src/lib/topology/__tests__/graph.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/topology/graph.ts src/lib/topology/__tests__/graph.test.ts
git commit -m "feat(topology): costruzione grafo da device/host/vicini (puro)"
```

---

## Task 5: Auto-layout (puro) — `autoLayout` su dagre

**Files:**
- Create: `src/lib/topology/layout.ts`
- Test: `src/lib/topology/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: `TopologyGraph`, `SavedPosition[]`.
- Produces: `autoLayout(graph: TopologyGraph, saved: SavedPosition[]): PositionedNode[]` — posizioni salvate vincono; i restanti posizionati da dagre; ogni nodo del grafo ha una posizione.

- [ ] **Step 1: Scrivere i test (falliscono)**

`src/lib/topology/__tests__/layout.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoLayout } from "@/lib/topology/layout";
import type { TopologyGraph } from "@/lib/topology/types";

const g: TopologyGraph = {
  nodes: [
    { id: "dev:1", kind: "device", refId: 1, name: "A", type: "router", model: null, mgmtIp: null, status: "ok" },
    { id: "dev:2", kind: "device", refId: 2, name: "B", type: "switch", model: null, mgmtIp: null, status: "ok" },
  ],
  edges: [{ id: "e", source: "dev:1", target: "dev:2", protocol: "lldp" }],
};

test("ogni nodo riceve una posizione", () => {
  const pos = autoLayout(g, []);
  assert.equal(pos.length, 2);
  assert.ok(pos.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.ok(pos.every((p) => p.fromSaved === false));
});

test("la posizione salvata vince e viene marcata fromSaved", () => {
  const pos = autoLayout(g, [{ nodeId: "dev:1", x: 42, y: 99, pinned: true }]);
  const p1 = pos.find((p) => p.nodeId === "dev:1")!;
  assert.equal(p1.x, 42);
  assert.equal(p1.y, 99);
  assert.equal(p1.fromSaved, true);
});
```

- [ ] **Step 2: Eseguire i test (devono fallire)**

Run: `npm test -- src/lib/topology/__tests__/layout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementare**

`src/lib/topology/layout.ts`:
```ts
import dagre from "dagre";
import type { TopologyGraph, SavedPosition, PositionedNode } from "@/lib/topology/types";

const NODE_W = 170;
const NODE_H = 72;

export function autoLayout(graph: TopologyGraph, saved: SavedPosition[]): PositionedNode[] {
  const savedById = new Map(saved.map((s) => [s.nodeId, s]));
  const out: PositionedNode[] = [];

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));
  const needLayout = graph.nodes.filter((n) => !savedById.has(n.id));
  for (const n of needLayout) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of graph.edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  for (const n of graph.nodes) {
    const s = savedById.get(n.id);
    if (s) { out.push({ nodeId: n.id, x: s.x, y: s.y, fromSaved: true }); continue; }
    const p = g.node(n.id);
    out.push({ nodeId: n.id, x: p ? p.x - NODE_W / 2 : 0, y: p ? p.y - NODE_H / 2 : 0, fromSaved: false });
  }
  return out;
}
```

- [ ] **Step 4: Eseguire i test (passano)**

Run: `npm test -- src/lib/topology/__tests__/layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/topology/layout.ts src/lib/topology/__tests__/layout.test.ts
git commit -m "feat(topology): auto-layout dagre con posizioni salvate prioritarie (puro)"
```

---

## Task 6: Schema tabella posizioni + funzioni DB tenant + facade

**Files:**
- Modify: `src/lib/db-tenant-schema.ts` (nuova `CREATE TABLE IF NOT EXISTS topology_position` + indice)
- Modify: `src/lib/db-tenant.ts` (funzioni `getTopologyPositions`, `upsertTopologyPositions`, `getTopologyData`)
- Modify: `src/lib/db.ts` (re-export delle tre funzioni)

**Interfaces:**
- Produces:
  - `getTopologyPositions(view: string): SavedPosition[]`
  - `upsertTopologyPositions(view: string, rows: SavedPosition[]): void` (in transazione)
  - `getTopologyData(): { devices: DeviceRow[]; hosts: HostRow[]; neighbors: NeighborRow[]; portsDown: Set<number>; libreStatus: Map<string, number>; anomalyBySeverity: Map<string, "low"|"medium"|"high"> }`

- [ ] **Step 1: Aggiungere la tabella in `db-tenant-schema.ts`**

Dentro `TENANT_SCHEMA_SQL` (in fondo, prima della chiusura del template):
```sql
CREATE TABLE IF NOT EXISTS topology_position (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view TEXT NOT NULL DEFAULT 'default',
  node_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(view, node_id)
);
```
In `TENANT_INDEXES_SQL`:
```sql
CREATE INDEX IF NOT EXISTS idx_topology_position_view ON topology_position(view);
```
(Tabella nuova → il solo `CREATE TABLE IF NOT EXISTS` basta; nessun ALTER perché non modifica tabelle esistenti.)

- [ ] **Step 2: Funzioni posizioni in `db-tenant.ts`** (import statico di `SavedPosition` type-only è ok)

```ts
import type { SavedPosition, DeviceRow, HostRow, NeighborRow } from "@/lib/topology/types";

export function getTopologyPositions(view: string): SavedPosition[] {
  const rows = db().prepare("SELECT node_id, x, y, pinned FROM topology_position WHERE view = ?").all(view) as Array<{ node_id: string; x: number; y: number; pinned: number }>;
  return rows.map((r) => ({ nodeId: r.node_id, x: r.x, y: r.y, pinned: r.pinned === 1 }));
}

export function upsertTopologyPositions(view: string, rows: SavedPosition[]): void {
  const d = db();
  const ins = d.prepare(`
    INSERT INTO topology_position (view, node_id, x, y, pinned, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(view, node_id) DO UPDATE SET x = excluded.x, y = excluded.y, pinned = excluded.pinned, updated_at = datetime('now')
  `);
  d.transaction(() => {
    for (const r of rows) ins.run(view, r.nodeId, r.x, r.y, r.pinned ? 1 : 0);
  })();
}
```

- [ ] **Step 3: Funzione dati topologia in `db-tenant.ts`** (JOIN/aggregazioni, niente N+1)

```ts
export function getTopologyData() {
  const d = db();
  const devices = d.prepare("SELECT id, name, device_type, model, host, enabled FROM network_devices").all() as DeviceRow[];
  const hosts = d.prepare("SELECT id, ip, hostname, custom_name, classification, status, last_response_time_ms, last_seen, model, network_id FROM hosts").all() as HostRow[];
  const neighbors = d.prepare("SELECT device_id, local_port, remote_device_name, remote_port, protocol, remote_ip FROM device_neighbors").all() as NeighborRow[];
  // uplink down per device: una porta trunk/uplink con status 'down'
  const downRows = d.prepare("SELECT DISTINCT device_id FROM switch_ports WHERE status = 'down' AND (trunk_neighbor_name IS NOT NULL AND trunk_neighbor_name <> '')").all() as Array<{ device_id: number }>;
  const portsDown = new Set(downRows.map((r) => r.device_id));
  // LibreNMS stato per host (via mappa)
  const libre = d.prepare("SELECT network_id, host_ip, last_status FROM librenms_host_map").all() as Array<{ network_id: number; host_ip: string; last_status: string | null }>;
  const libreStatus = new Map<string, number>();
  for (const l of libre) if (l.last_status != null) libreStatus.set(`${l.network_id}|${l.host_ip}`, l.last_status === "up" || l.last_status === "1" ? 1 : 0);
  // anomalie aperte peggiori per host
  const anomalyBySeverity = new Map<string, "low" | "medium" | "high">();
  const anomalies = d.prepare("SELECT host_id, severity FROM anomaly_events WHERE acknowledged = 0").all() as Array<{ host_id: number; severity: "low" | "medium" | "high" }>;
  const rank = { low: 1, medium: 2, high: 3 } as const;
  for (const a of anomalies) {
    const k = `host:${a.host_id}`;
    const cur = anomalyBySeverity.get(k);
    if (!cur || rank[a.severity] > rank[cur]) anomalyBySeverity.set(k, a.severity);
  }
  return { devices, hosts, neighbors, portsDown, libreStatus, anomalyBySeverity };
}
```
> Nota per l'implementatore: verificare i nomi reali delle colonne `anomaly_events.acknowledged`/`severity`/`host_id` e `librenms_host_map.last_status` con `PRAGMA table_info` sul template `data/ipam.empty.db`; adeguare le `SELECT` se differiscono (nessun ALTER, solo lettura).

- [ ] **Step 4: Facade in `db.ts`** — delega via `require` (coerente col pattern esistente):

```ts
export function getTopologyPositions(view: string): import("@/lib/topology/types").SavedPosition[] {
  return require("./db-tenant").getTopologyPositions(view);
}
export function upsertTopologyPositions(view: string, rows: import("@/lib/topology/types").SavedPosition[]): void {
  require("./db-tenant").upsertTopologyPositions(view, rows);
}
export function getTopologyData(): ReturnType<typeof import("./db-tenant").getTopologyData> {
  return require("./db-tenant").getTopologyData();
}
```

- [ ] **Step 5: Verifica build + schema applicato**

Run: `npx tsc --noEmit && npm run build`
Poi, su un DB template, verifica che la tabella venga creata:
```bash
npm run db:empty
sqlite3 data/ipam.empty.db "PRAGMA table_info(topology_position);"
```
Expected: colonne `id,view,node_id,x,y,pinned,updated_at`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db-tenant-schema.ts src/lib/db-tenant.ts src/lib/db.ts
git commit -m "feat(topology): tabella posizioni tenant + funzioni dati/posizioni + facade"
```

---

## Task 7: API routes — `GET /api/topology` e `PUT /api/topology/positions`

**Files:**
- Create: `src/app/api/topology/route.ts`
- Create: `src/app/api/topology/positions/route.ts`

**Interfaces:**
- Consumes: `getTopologyData`, `getTopologyPositions`, `upsertTopologyPositions` (Task 6); `buildTopologyGraph` (Task 4); `deriveNodeStatus` (Task 3); auth/tenant helpers.
- Produces (GET): `{ graph: TopologyGraph, positions: SavedPosition[] }`. (PUT): `{ ok: true }`.

- [ ] **Step 1: GET assembla grafo + stato + posizioni**

`src/app/api/topology/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getTopologyData, getTopologyPositions } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { buildTopologyGraph } from "@/lib/topology/graph";
import { deriveNodeStatus } from "@/lib/topology/status";
import type { TopologyStatus } from "@/lib/topology/types";

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    try {
      const { searchParams } = new URL(request.url);
      const view = searchParams.get("view") || "default";
      const data = getTopologyData();
      const now = Date.now();

      const statusByNode = new Map<string, TopologyStatus>();
      for (const h of data.hosts) {
        const id = `host:${h.id}`;
        statusByNode.set(id, deriveNodeStatus({
          hostStatus: (h.status as "online" | "offline" | "unknown" | null) ?? null,
          latencyMs: h.last_response_time_ms, lastSeen: h.last_seen,
          libreStatus: data.libreStatus.get(`${h.network_id}|${h.ip}`) ?? null,
          anomalySeverity: data.anomalyBySeverity.get(id) ?? null, nowMs: now,
        }));
      }
      for (const d of data.devices) {
        const id = `dev:${d.id}`;
        statusByNode.set(id, deriveNodeStatus({
          deviceEnabled: d.enabled === 1, uplinkDown: data.portsDown.has(d.id), nowMs: now,
        }));
      }

      const graph = buildTopologyGraph({ devices: data.devices, hosts: data.hosts, neighbors: data.neighbors, statusByNode });
      const positions = getTopologyPositions(view);
      return NextResponse.json({ graph, positions });
    } catch (error) {
      console.error("Error building topology:", error);
      return NextResponse.json({ error: "Errore nel calcolo della topologia" }, { status: 500 });
    }
  });
}
```

- [ ] **Step 2: PUT salva le posizioni (Zod v4)**

`src/app/api/topology/positions/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertTopologyPositions } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

const BodySchema = z.object({
  view: z.string().min(1).default("default"),
  positions: z.array(z.object({
    nodeId: z.string().min(1), x: z.number(), y: z.number(), pinned: z.boolean().default(true),
  })).max(5000),
});

export async function PUT(request: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    try {
      const parsed = BodySchema.safeParse(await request.json());
      if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      upsertTopologyPositions(parsed.data.view, parsed.data.positions);
      return NextResponse.json({ ok: true });
    } catch (error) {
      console.error("Error saving positions:", error);
      return NextResponse.json({ error: "Errore nel salvataggio posizioni" }, { status: 500 });
    }
  });
}
```

- [ ] **Step 3: Verifica**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/topology/
git commit -m "feat(topology): API GET topologia (grafo+stato) e PUT posizioni"
```

---

## Task 8: Pagina mappa React Flow + nodo custom + voce di nav

**Files:**
- Create: `src/app/(dashboard)/topology/page.tsx`
- Create: `src/app/(dashboard)/topology/topology-client.tsx`
- Create: `src/app/(dashboard)/topology/status-node.tsx`
- Modify: `src/components/shared/sidebar.tsx` (voce "Topologia")

**Interfaces:**
- Consumes: `GET /api/topology`, `PUT /api/topology/positions`, `autoLayout` (Task 5), i tipi (Task 1).

- [ ] **Step 1: Pagina (server component, gate automatico sotto `(dashboard)`)**

`src/app/(dashboard)/topology/page.tsx`:
```tsx
import { TopologyClient } from "./topology-client";

export default function TopologyPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Topologia</h1>
        <p className="text-muted-foreground mt-1 text-sm">Mappa interattiva della rete. Trascina i nodi: la posizione viene salvata.</p>
      </div>
      <TopologyClient />
    </div>
  );
}
```

- [ ] **Step 2: Nodo custom con icona per tipo + colore stato**

`src/app/(dashboard)/topology/status-node.tsx`:
```tsx
"use client";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Router, Network, Wifi, HardDrive, Server, Box, HelpCircle } from "lucide-react";
import type { TopologyStatus } from "@/lib/topology/types";

const ICON: Record<string, typeof Router> = {
  router: Router, switch: Network, firewall: Server, access_point: Wifi, nas: HardDrive,
  hypervisor: Server, vm: Box, server: Server, external: HelpCircle,
};
const COLOR: Record<TopologyStatus, string> = { ok: "#16a34a", warning: "#f59e0b", fail: "#dc2626", unknown: "#9ca3af" };

export function StatusNode({ data }: NodeProps) {
  const d = data as { label: string; type: string; status: TopologyStatus; mgmtIp: string | null };
  const Icon = ICON[d.type] ?? HelpCircle;
  return (
    <div style={{ borderColor: COLOR[d.status] }} className="flex w-[160px] items-center gap-2 rounded-md border-2 bg-white px-2 py-1.5 shadow-sm">
      <Handle type="target" position={Position.Top} />
      <span style={{ color: COLOR[d.status] }}><Icon size={20} /></span>
      <span className="truncate text-xs" title={d.mgmtIp ?? ""}>{d.label}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

- [ ] **Step 3: Client React Flow — carica, auto-layout, drag→save (debounce), polling stato**

`src/app/(dashboard)/topology/topology-client.tsx`:
```tsx
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge, useNodesState, useEdgesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import { StatusNode } from "./status-node";
import { autoLayout } from "@/lib/topology/layout";
import type { TopologyGraph, SavedPosition } from "@/lib/topology/types";

const nodeTypes = { status: StatusNode };

export function TopologyClient() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toFlow = useCallback((graph: TopologyGraph, positions: SavedPosition[]) => {
    const pos = autoLayout(graph, positions);
    const posById = new Map(pos.map((p) => [p.nodeId, p]));
    const fnodes: Node[] = graph.nodes.map((n) => ({
      id: n.id, type: "status",
      position: { x: posById.get(n.id)?.x ?? 0, y: posById.get(n.id)?.y ?? 0 },
      data: { label: n.name, type: n.type, status: n.status, mgmtIp: n.mgmtIp },
    }));
    const fedges: Edge[] = graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.sourcePort && e.targetPort ? `${e.sourcePort}↔${e.targetPort}` : undefined }));
    setNodes(fnodes); setEdges(fedges);
  }, [setNodes, setEdges]);

  const load = useCallback(async (refreshStatusOnly = false) => {
    const res = await fetch("/api/topology?view=default");
    if (!res.ok) { toast.error("Errore nel caricamento topologia"); return; }
    const { graph, positions } = (await res.json()) as { graph: TopologyGraph; positions: SavedPosition[] };
    if (refreshStatusOnly) {
      const stByÂ = new Map(graph.nodes.map((n) => [n.id, n.status]));
      setNodes((cur) => cur.map((n) => ({ ...n, data: { ...n.data, status: stByÂ.get(n.id) ?? "unknown" } })));
    } else {
      toFlow(graph, positions);
    }
  }, [toFlow, setNodes]);

  useEffect(() => {
    load(false);
    pollRef.current = setInterval(() => load(true), 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  const persist = useCallback((ns: Node[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const positions: SavedPosition[] = ns.map((n) => ({ nodeId: n.id, x: n.position.x, y: n.position.y, pinned: true }));
      await fetch("/api/topology/positions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ view: "default", positions }) });
    }, 600);
  }, []);

  const onNodeDragStop = useCallback(() => { setNodes((cur) => { persist(cur); return cur; }); }, [persist, setNodes]);

  const flowNodeTypes = useMemo(() => nodeTypes, []);
  return (
    <div className="h-[75vh] w-full rounded-md border">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={flowNodeTypes} onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} fitView>
        <Background /><Controls />
      </ReactFlow>
    </div>
  );
}
```
> Nota: correggere l'identificatore `stByÂ`/`refreshStatusOnly` in nomi ASCII puliti (`statusById`) in fase di stesura; qui è solo per mostrare la mappatura.

- [ ] **Step 4: Voce di nav in `sidebar.tsx`**

Importare un'icona: `import { Workflow } from "lucide-react";`. Aggiungere all'array `networkSubItems` (riga ~66):
```tsx
{ href: "/topology", label: "Topologia", icon: Workflow },
```

- [ ] **Step 5: Verifica build + visiva**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Poi `npm run dev` e aprire `http://localhost:3001/topology` (tenant con dati): verificare nodi con icone+colori, archi con porte, drag che persiste (ricaricando la pagina le posizioni restano), e che dopo 30s lo stato si aggiorni senza perdere il layout. Fare uno screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/topology/ src/components/shared/sidebar.tsx
git commit -m "feat(topology): pagina mappa React Flow (nodi, stato, drag+save) + nav"
```

---

## Task 9: ADR + rilascio

**Files:**
- Create: `docs/adr/0003-topology-map.md` (template `docs/adr/0000-template.md`)

- [ ] **Step 1: Scrivere l'ADR 0003** — decisione: React Flow + dagre; tabella tenant `topology_position`; derivazione stato a 4 livelli; approccio additivo/non distruttivo; multi-backend UniFi rimandato a Fase 2.

- [ ] **Step 2: Gate completo**

Run: `npm run lint && npx tsc --noEmit && npm run build && npm test`
Expected: tutto verde.

- [ ] **Step 3: Release + push**

```bash
npm run version:release
git push origin dev
```

- [ ] **Step 4: Aggiornare `CONTEXT.md`** di DA-IPAM con la nuova feature (sezione "Fatto") e il puntatore alla spec/piano.

---

## Self-review

- **Copertura spec**: tabella posizioni (Task 6) ✓ · API nodi/archi/posizioni/stato (Task 7) ✓ · derivazione stato 4 livelli (Task 3) ✓ · pagina React Flow drag+save+colori+auto-layout+polling (Task 8) ✓ · icone per tipo (Task 8) ✓ · multi-tenant/non distruttivo (vincoli globali + Task 6/7) ✓ · scope device+Proxmox+VM, no PC (filtro classi Task 4) ✓. **Fuori da questo piano (Fase 2+)**: export drawio, collector API controller UniFi multi-backend, soglie stato in settings — piano separato.
- **Placeholder**: nessun "TBD"; le due note (`anomaly_events`/`librenms_host_map` colonne, identificatori ASCII nel client) sono istruzioni di verifica puntuale, non buchi di logica.
- **Coerenza tipi**: `SavedPosition`/`PositionedNode`/`TopologyGraph` usati coerentemente tra Task 1/5/6/7/8; `deriveNodeStatus` firma stabile tra Task 3 e Task 7.
- **Review Focus**: vicino non risolvibile (Task 4 test) · nodo senza posizione (Task 5 test) · segnali assenti/`enabled=0` (Task 3 test) · archi bidirezionali (Task 4 test) · isolamento tenant (pattern `withTenantFromSession` in Task 7, nessuna chiamata DB fuori dal wrapper).

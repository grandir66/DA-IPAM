/**
 * Lo stato di ogni nodo della mappa (ok / avviso / giù / sconosciuto), dai
 * segnali che `getTopologyData()` legge dal DB: stato dell'host, LibreNMS,
 * anomalie aperte, apparato attivo, uplink giù. Logica pura; era nel GET di
 * `/api/topology` (mappa vecchia, tolta al Task 12) e qui è coperta da prova
 * (status-map.test.ts).
 */
import { deriveNodeStatus } from "@/lib/topology/status";
import type { DeviceRow, HostRow, TopologyStatus } from "@/lib/topology/types";
import type { MapNode } from "@/lib/topology/model-types";

/** La forma di `getTopologyData()` che serve allo stato (strutturale: niente import del DB). */
export interface StatusData {
  devices: Array<Pick<DeviceRow, "id" | "enabled">>;
  hosts: Array<Pick<HostRow, "id" | "network_id" | "ip" | "status" | "last_response_time_ms" | "last_seen">>;
  portsDown: ReadonlySet<number>;
  libreStatus: ReadonlyMap<string, number>;
  anomalyBySeverity: ReadonlyMap<string, "low" | "medium" | "high">;
}

/** Stato per "host:<id>" e "dev:<id>" grezzi, prima della fusione degli host negli apparati. */
export function computeStatusByNode(data: StatusData, nowMs: number): Record<string, TopologyStatus> {
  const out: Record<string, TopologyStatus> = {};
  for (const h of data.hosts) {
    const id = `host:${h.id}`;
    out[id] = deriveNodeStatus({
      hostStatus: (h.status as "online" | "offline" | "unknown" | null) ?? null,
      latencyMs: h.last_response_time_ms,
      lastSeen: h.last_seen,
      libreStatus: data.libreStatus.get(`${h.network_id}|${h.ip}`) ?? null,
      anomalySeverity: data.anomalyBySeverity.get(id) ?? null,
      nowMs,
    });
  }
  for (const d of data.devices) {
    out[`dev:${d.id}`] = deriveNodeStatus({ deviceEnabled: d.enabled === 1, uplinkDown: data.portsDown.has(d.id), nowMs });
  }
  return out;
}

/**
 * Gravità per fondere gli stati degli host: giù > avviso > ok > sconosciuto.
 * «Sconosciuto» vuol dire «nessun segnale», non «guasto»: non deve coprire un
 * host che risponde (deciso al Task 12, 2026-10-13).
 */
const GRAVITA: Readonly<Record<TopologyStatus, number>> = { unknown: 0, ok: 1, warning: 2, fail: 3 };

/** Il peggiore dei due: giù > avviso > ok > sconosciuto. */
export function worstStatus(a: TopologyStatus, b: TopologyStatus): TopologyStatus {
  return GRAVITA[b] > GRAVITA[a] ? b : a;
}

/**
 * Lo stato coi nodi del modello. Un nodo che ha uno stato suo (l'apparato, o
 * l'host stesso) usa quello; solo se non ce l'ha prende il peggiore fra gli
 * host fusi dentro di lui, dove «sconosciuto» non batte «ok». Le chiavi sono
 * gli id del modello; gli host fusi non hanno una chiave loro.
 */
export function statusForModel(
  nodes: ReadonlyArray<Pick<MapNode, "id" | "kind" | "fusedHostIds">>,
  byNode: Readonly<Record<string, TopologyStatus>>,
): Record<string, TopologyStatus> {
  const out: Record<string, TopologyStatus> = {};
  for (const n of nodes) {
    const own = byNode[n.id];
    if (own) {
      out[n.id] = own;
      continue;
    }
    let s: TopologyStatus = "unknown";
    for (const h of n.fusedHostIds) {
      const hs = byNode[`host:${h}`];
      if (hs) s = worstStatus(s, hs);
    }
    out[n.id] = s;
  }
  return out;
}

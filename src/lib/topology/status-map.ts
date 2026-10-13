/**
 * Lo stato di ogni nodo della mappa (ok / avviso / giù / sconosciuto), dai
 * segnali che `getTopologyData()` legge dal DB: stato dell'host, LibreNMS,
 * anomalie aperte, apparato attivo, uplink giù. Logica pura; era nel GET di
 * `/api/topology` e qui è coperta da prova (status-map.test.ts).
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

const GRAVITA: Readonly<Record<TopologyStatus, number>> = { ok: 0, unknown: 1, warning: 2, fail: 3 };

/** Il peggiore dei due: giù > avviso > sconosciuto > ok. */
export function worstStatus(a: TopologyStatus, b: TopologyStatus): TopologyStatus {
  return GRAVITA[b] > GRAVITA[a] ? b : a;
}

/**
 * Lo stato coi nodi del modello: un apparato prende il peggiore fra il suo e
 * quello degli host fusi dentro di lui (un router che risponde al ping da un
 * indirizzo e non da un altro è giù da qualche parte). Le chiavi sono gli id
 * del modello; gli host fusi non hanno una chiave loro.
 */
export function statusForModel(
  nodes: ReadonlyArray<Pick<MapNode, "id" | "kind" | "fusedHostIds">>,
  byNode: Readonly<Record<string, TopologyStatus>>,
): Record<string, TopologyStatus> {
  const out: Record<string, TopologyStatus> = {};
  for (const n of nodes) {
    let s: TopologyStatus = byNode[n.id] ?? "unknown";
    for (const h of n.fusedHostIds) {
      const hs = byNode[`host:${h}`];
      if (hs) s = worstStatus(s, hs);
    }
    out[n.id] = s;
  }
  return out;
}

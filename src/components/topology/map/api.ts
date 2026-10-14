/**
 * Le chiamate della pagina Topologia verso le rotte della fase 2b (piano
 * 2026-10-14, Task 9) e i tipi dei loro corpi: un posto solo, così chi scrive
 * le rotte le allinea qui. Le scritture passano da `send` di useTopologyData
 * (toast con l'errore del server, poi ricarica); le letture da `fetchJson`:
 * un errore torna come errore, mai come lista vuota.
 *
 * Contratto (le rotte nuove le scrive il Task 9):
 * - POST   /api/topology/links          corpo ManualLinkBody | IgnoreLinkBody → 201 { id }
 * - PATCH  /api/topology/links/[id]     corpo LinkPatchBody → { ok: true }; 404 se la correzione non c'è
 * - DELETE /api/topology/links/[id]     (c'è già) → { ok: true }
 * - GET    /api/topology/links          (c'è già) → LinkOverrideView[] (con `medium` dopo la migrazione 2b)
 * - PUT    /api/topology/primary        corpo PrimaryBody → { ok: true }
 * - DELETE /api/topology/primary        corpo { node_id } → { ok: true }
 * - GET    /api/topology/ports?node=ID  → PortsResponse (porte note; elenco vuoto se non se ne conoscono)
 * - POST   /api/devices/[id]/proxmox-scan  (c'è già) → rilegge VM e schede dell'hypervisor
 * - PUT    /api/topology/maps/[id]/nodes e POST /api/topology/maps: accettano anche «vm:<apparato>:<vmid>»
 * Nodi: «dev:N», «host:N», «vm:N:M» (regex del piano: ^(dev|host|vm):\d+(:\d+)?$).
 */
import { fetchJson, type FetchJsonResult } from "@/lib/fetch-json";
import type { LinkMedium } from "@/lib/topology/model-types";
import type { PrimaryBody } from "@/lib/topology/map-menus";

export type { PrimaryBody };

export type Send = <T>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown) => Promise<FetchJsonResult<T>>;

/** Un collegamento a mano: porte come le scrive la fonte («Port 5», «eno1»), "" = porta non nota. */
export interface ManualLinkBody {
  action: "add";
  a_node: string;
  a_port: string;
  b_node: string;
  b_port: string;
  /** null = tipo non indicato. */
  medium: LinkMedium | null;
  note: string | null;
}

/** Un collegamento visto dai dati che non si vuole sulla mappa (vale per tutte le mappe). */
export interface IgnoreLinkBody {
  action: "ignore";
  a_node: string;
  a_port: string;
  b_node: string;
  b_port: string;
}

/** Modifica di un collegamento a mano: solo i campi presenti cambiano. */
export interface LinkPatchBody {
  a_port?: string;
  b_port?: string;
  medium?: LinkMedium | null;
  note?: string | null;
}

/** Una riga di topology_link_overrides come la restituisce GET /api/topology/links. */
export interface LinkOverrideView {
  id: number;
  action: "add" | "ignore";
  a_node: string;
  a_port: string;
  b_node: string;
  b_port: string;
  /** Assente o null prima della migrazione 2b. */
  medium?: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** Una porta nota di un oggetto: una porta dello switch (switch_ports) o una scheda dell'hypervisor (scansione). */
export interface KnownPort {
  name: string;
  /** Velocità come la scrive la fonte («1000 Mbps», «10G»); null se non nota. */
  speed: string | null;
  /** Potenza PoE erogata in W; null se nessuna o non nota. */
  poeW: number | null;
  kind: "switch_port" | "hypervisor_nic";
  /** Altro da dire in parole, già in italiano: «uplink», «membro di bond0», «giù». */
  note: string | null;
}

export interface PortsResponse {
  node: string;
  ports: KnownPort[];
}

export function createManualLink(send: Send, body: ManualLinkBody) {
  return send<{ id: number }>("/api/topology/links", "POST", body);
}

export function ignoreLink(send: Send, body: IgnoreLinkBody) {
  return send<{ id: number }>("/api/topology/links", "POST", body);
}

export function patchManualLink(send: Send, id: number, body: LinkPatchBody) {
  return send<{ ok: true }>(`/api/topology/links/${id}`, "PATCH", body);
}

export function deleteManualLink(send: Send, id: number) {
  return send<{ ok: true }>(`/api/topology/links/${id}`, "DELETE");
}

export function setPrimary(send: Send, body: PrimaryBody) {
  return send<{ ok: true }>("/api/topology/primary", "PUT", body);
}

export function clearPrimary(send: Send, nodeId: string) {
  return send<{ ok: true }>("/api/topology/primary", "DELETE", { node_id: nodeId });
}

export function refreshProxmoxScan(send: Send, deviceId: number) {
  return send<unknown>(`/api/devices/${deviceId}/proxmox-scan`, "POST");
}

export function fetchLinkOverrides(signal?: AbortSignal) {
  return fetchJson<LinkOverrideView[]>("/api/topology/links", { cache: "no-store", signal });
}

export function fetchPorts(nodeId: string, signal?: AbortSignal) {
  return fetchJson<PortsResponse>(`/api/topology/ports?node=${encodeURIComponent(nodeId)}`, { cache: "no-store", signal });
}

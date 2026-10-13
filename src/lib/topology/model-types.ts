/**
 * Tipi del modello della mappa (spec 2026-10-12-topology-map-design §3).
 * Logica pura: nessun import del DB. Gli id dei nodi sono "dev:<id>" (apparato
 * di rete) e "host:<id>" (host non fuso con un apparato).
 */
export type LinkSource = "manual" | "unifi_uplink" | "lldp" | "cdp" | "mndp";

/** Più basso = più affidabile (spec §3, «fonti in ordine di fiducia»). */
export const LINK_SOURCE_RANK: Readonly<Record<LinkSource, number>> = {
  manual: 0,
  unifi_uplink: 1,
  lldp: 2,
  cdp: 2,
  mndp: 2,
};

export interface ModelDeviceRow {
  id: number;
  name: string;
  host: string;
  device_type: string;
  vendor: string;
  model: string | null;
  enabled: number;
  host_id: number | null;
  physical_device_id: number | null;
  location_id: number | null;
  controller_mac: string | null;
  uplink_mac: string | null;
  uplink_remote_port: number | null;
  uplink_seen_at: string | null;
  topology_hidden: number;
  port_count: number;
}

export interface ModelHostRow {
  id: number;
  network_id: number;
  ip: string;
  mac: string | null;
  hostname: string | null;
  custom_name: string | null;
  classification: string | null;
  status: string | null;
  physical_device_id: number | null;
}

export interface ModelNeighborRow {
  device_id: number;
  local_port: string;
  remote_device_name: string;
  remote_port: string;
  protocol: string;
  remote_ip: string | null;
  remote_mac: string | null;
  timestamp: string | null;
  source: string;
}

export interface ModelUplinkPortRow {
  device_id: number;
  port_index: number;
  port_name: string;
}

export interface ModelLocationRow {
  id: number;
  name: string;
  parent_id: number | null;
  head_device_id: number | null;
}

export interface ModelNetworkRow {
  id: number;
  cidr: string;
  name: string;
  gateway: string | null;
  location_id: number | null;
}

export interface ModelKnownMacRow {
  device_id: number;
  mac: string;
}

export interface LinkOverrideRow {
  id: number;
  action: "add" | "ignore";
  a_node: string;
  a_port: string;
  b_node: string;
  b_port: string;
}

export interface TopologyModelInput {
  devices: ModelDeviceRow[];
  hosts: ModelHostRow[];
  neighbors: ModelNeighborRow[];
  uplinkPorts: ModelUplinkPortRow[];
  locations: ModelLocationRow[];
  networks: ModelNetworkRow[];
  knownMacs: ModelKnownMacRow[];
  overrides: LinkOverrideRow[];
  /** Orologio iniettato: stessi dati + stesso nowMs = stesso modello. */
  nowMs: number;
  /** Giorni dopo cui un collegamento è «non visto» (decisione 13/10: 2). */
  staleDays: number;
}

export interface MapNode {
  id: string;
  kind: "device" | "host";
  refId: number;
  name: string;
  /** device_type dell'apparato, o classificazione dell'host. */
  type: string;
  mgmtIp: string | null;
  /** Host assorbiti dall'apparato: niente doppi (spec §3). */
  fusedHostIds: number[];
  siteId: number | null;
  rackId: number | null;
  /** true = sede proposta dal sistema, non confermata da un admin. */
  siteProposed: boolean;
  hidden: boolean;
}

export interface MapLink {
  id: string;
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  /** La fonte più affidabile fra quelle che vedono il collegamento. */
  source: LinkSource;
  sources: LinkSource[];
  /** Per un uplink UniFi: il nodo che esce (il figlio). */
  uplinkFrom: string | null;
  lastSeen: string | null;
  daysUnseen: number | null;
  stale: boolean;
}

export interface SiteInfo {
  locationId: number;
  name: string;
  headNodeId: string | null;
  headProposed: boolean;
  nodeIds: string[];
}

export interface PromoteProposal {
  hostId: number;
  name: string;
  ip: string;
  classification: string;
  links: number;
}

export interface UnmatchedNeighbor {
  deviceNodeId: string;
  localPort: string;
  remoteName: string;
  remoteIp: string | null;
  remoteMac: string | null;
}

export interface ModelCounts {
  nodes: number;
  devices: number;
  links: number;
  linksBySource: Record<LinkSource, number>;
  deviceLinks: number;
  attachedLinks: number;
  staleLinks: number;
  unmatchedNeighbors: number;
  isolatedDevices: number;
  fusedHosts: number;
  devicesWithoutSite: number;
  sitesWithHead: number;
  promoteProposals: number;
  suspiciousTypes: number;
}

export interface TopologyModel {
  nodes: MapNode[];
  links: MapLink[];
  sites: SiteInfo[];
  promote: PromoteProposal[];
  unmatched: UnmatchedNeighbor[];
  isolated: string[];
  suspicious: string[];
  withoutSite: string[];
  counts: ModelCounts;
}

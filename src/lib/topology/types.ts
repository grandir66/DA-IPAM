export type TopologyStatus = "ok" | "warning" | "fail" | "unknown";
export type NodeKind = "device" | "host" | "external";

export interface StatusSignals {
  hostStatus?: "online" | "offline" | "unknown" | null;
  latencyMs?: number | null;
  lastSeen?: string | null; // SQL/ISO datetime
  deviceEnabled?: boolean | null;
  libreStatus?: number | null; // 1=up, 0=down
  anomalySeverity?: "low" | "medium" | "high" | null;
  uplinkDown?: boolean;
  nowMs?: number; // clock iniettato (test)
  latencyWarnMs?: number; // default 150
  staleSeconds?: number; // default 900
}

export interface DeviceRow {
  id: number;
  name: string;
  device_type: string;
  model: string | null;
  host: string | null;
  enabled: number;
}

export interface HostRow {
  id: number;
  ip: string;
  hostname: string | null;
  custom_name: string | null;
  classification: string;
  status: string | null;
  last_response_time_ms: number | null;
  last_seen: string | null;
  model: string | null;
  network_id: number;
}

export interface NeighborRow {
  device_id: number;
  local_port: string;
  remote_device_name: string;
  remote_port: string;
  protocol: string;
  remote_ip: string | null;
}

export interface TopologyNode {
  id: string;
  kind: NodeKind;
  refId: number | null;
  name: string;
  type: string;
  model: string | null;
  mgmtIp: string | null;
  status: TopologyStatus;
}

export interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  sourcePort?: string;
  targetPort?: string;
  protocol: string;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface SavedPosition {
  nodeId: string;
  x: number;
  y: number;
  pinned: boolean;
}

export interface PositionedNode {
  nodeId: string;
  x: number;
  y: number;
  fromSaved: boolean;
}

/**
 * Bridge subnet DA-IPAM → scanner-edge (ensure network + trigger Greenbone scan).
 */

import { getNetworkById, getHostsByNetwork, setNetworkTargetingMode } from "@/lib/db";
import {
  collectEdgeCredentialsForNetwork,
  type EdgeCredentialPreview,
  type EdgeCredentialTransfer,
} from "@/lib/vuln/edge-credentials-bridge";
import {
  EdgeClientError,
  edgeApiGet,
  edgeApiPost,
  edgeApiPut,
  edgeApiDelete,
} from "@/lib/vuln/scanner-edge-client";
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";

export type EdgeScanProfile = "fast" | "balanced" | "deep";
export type EdgeTargetingMode = "full_subnet" | "found_ips" | "populated_24";

export interface EdgeSubnetLastScan {
  id: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  finding_count: number;
}

export interface EdgeVulnSchedule {
  id: number;
  network_id: number;
  scan_kind: string;
  cron_expr: string;
  profile: EdgeScanProfile;
  enabled: number;
  interval_minutes: number | null;
  last_run_at: string | null;
  last_run_status: string | null;
  next_run_at: string | null;
}

export interface EdgeSubnetStatus {
  edgeConfigured: boolean;
  edgeEnabled: boolean;
  scannerName: string | null;
  ipamCredentials: EdgeCredentialPreview[];
  targeting_mode: EdgeTargetingMode;
  edgeNetwork: {
    network_id: number;
    cidr: string;
    label: string | null;
    host_count: number;
    last_scan: EdgeSubnetLastScan | null;
    schedule: EdgeVulnSchedule | null;
    credentials?: {
      ssh: { id: string; name: string } | null;
      smb: { id: string; name: string } | null;
      snmp: { id: string; name: string } | null;
    };
  } | null;
}

export async function loadEdgeSubnetStatus(networkId: number): Promise<EdgeSubnetStatus> {
  const scanner = getActiveEdgeScanner();
  const network = getNetworkById(networkId);
  const { preview: ipamCredentials } = collectEdgeCredentialsForNetwork(networkId);
  const targetingMode: EdgeTargetingMode =
    (network?.targeting_mode as EdgeTargetingMode | null) ?? "full_subnet";

  if (!network || !scanner) {
    return {
      edgeConfigured: !!scanner,
      edgeEnabled: scanner?.enabled === 1,
      scannerName: scanner?.name ?? null,
      ipamCredentials,
      targeting_mode: targetingMode,
      edgeNetwork: null,
    };
  }

  try {
    const lookup = await edgeApiGet<{
      found: boolean;
      network_id?: number;
      cidr?: string;
      label?: string | null;
      host_count?: number;
      last_scan?: EdgeSubnetLastScan | null;
      schedule?: EdgeVulnSchedule | null;
      credentials?: {
        ssh: { id: string; name: string } | null;
        smb: { id: string; name: string } | null;
        snmp: { id: string; name: string } | null;
      };
    }>(scanner, `/api/v1/networks/lookup?cidr=${encodeURIComponent(network.cidr)}`);

    if (!lookup.found || lookup.network_id == null) {
      return {
        edgeConfigured: true,
        edgeEnabled: scanner.enabled === 1,
        scannerName: scanner.name,
        ipamCredentials,
        targeting_mode: targetingMode,
        edgeNetwork: null,
      };
    }

    return {
      edgeConfigured: true,
      edgeEnabled: scanner.enabled === 1,
      scannerName: scanner.name,
      ipamCredentials,
      targeting_mode: targetingMode,
      edgeNetwork: {
        network_id: lookup.network_id,
        cidr: lookup.cidr ?? network.cidr,
        label: lookup.label ?? null,
        host_count: lookup.host_count ?? 0,
        last_scan: lookup.last_scan ?? null,
        schedule: lookup.schedule ?? null,
        credentials: lookup.credentials,
      },
    };
  } catch {
    return {
      edgeConfigured: true,
      edgeEnabled: scanner.enabled === 1,
      scannerName: scanner.name,
      ipamCredentials,
      targeting_mode: targetingMode,
      edgeNetwork: null,
    };
  }
}

function buildEdgeEnsureBody(
  networkId: number,
  opts: { syncHosts?: boolean; syncCredentials?: boolean; targetingMode?: EdgeTargetingMode } = {},
): Record<string, unknown> {
  const network = getNetworkById(networkId);
  if (!network) throw new Error("Rete non trovata");

  const syncHosts = opts.syncHosts !== false;
  const syncCredentials = opts.syncCredentials !== false;

  const body: Record<string, unknown> = {
    cidr: network.cidr,
    label: network.name || network.description || `IPAM #${network.id}`,
    ipam_network_id: network.id,
  };

  if (syncHosts) {
    body.hosts = hostsForEdgeSync(networkId);
  }

  if (syncCredentials) {
    const { transfer } = collectEdgeCredentialsForNetwork(networkId);
    if (transfer.length > 0) {
      body.credentials = transfer.map((c: EdgeCredentialTransfer) => ({
        slot: c.slot,
        name: c.name,
        cred_type: c.cred_type,
        ...(c.login ? { login: c.login } : {}),
        ...(c.password ? { password: c.password } : {}),
        ...(c.community ? { community: c.community } : {}),
        ...(c.ipam_credential_id != null ? { ipam_credential_id: c.ipam_credential_id } : {}),
        sort_order: c.sort_order,
      }));
    }
  }

  if (opts.targetingMode != null) {
    body.targeting_mode = opts.targetingMode;
  }

  return body;
}

function hostsForEdgeSync(networkId: number) {
  return getHostsByNetwork(networkId)
    .filter((h) => h.status !== "offline")
    .map((h) => ({
      ip: h.ip,
      hostname: h.hostname || h.custom_name || h.dns_forward || null,
      mac: h.mac,
      status: h.status,
    }));
}

export async function triggerSubnetEdgeScan(
  networkId: number,
  opts: {
    profile?: EdgeScanProfile;
    syncHosts?: boolean;
    syncCredentials?: boolean;
    runArp?: boolean;
    targetingMode?: EdgeTargetingMode;
  } = {},
): Promise<{
  ok: boolean;
  scan_id?: number;
  edge_network_id?: number;
  host_count?: number;
  error?: string;
}> {
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) {
    return { ok: false, error: "Scanner-Edge non configurato o disabilitato" };
  }

  const network = getNetworkById(networkId);
  if (!network) {
    return { ok: false, error: "Rete non trovata" };
  }

  const profile = opts.profile ?? "balanced";
  const syncHosts = opts.syncHosts !== false;
  const syncCredentials = opts.syncCredentials !== false;

  try {
    const ensured = await edgeApiPost<{
      ok: boolean;
      network_id: number;
      host_count: number;
      credentials_synced?: number;
    }>(
      scanner,
      "/api/v1/networks/ensure",
      buildEdgeEnsureBody(networkId, { syncHosts, syncCredentials, targetingMode: opts.targetingMode }),
      { timeoutMs: 120000 },
    );

    const scan = await edgeApiPost<{
      ok: boolean;
      scan_id: number;
    }>(
      scanner,
      `/api/v1/networks/${ensured.network_id}/scan`,
      {
        profile,
        run_arp: opts.runArp === true,
        ...(opts.targetingMode != null ? { targeting_mode: opts.targetingMode } : {}),
      },
      { timeoutMs: 120000 },
    );

    if (opts.targetingMode != null) {
      setNetworkTargetingMode(networkId, opts.targetingMode);
    }

    return {
      ok: true,
      scan_id: scan.scan_id,
      edge_network_id: ensured.network_id,
      host_count: ensured.host_count,
    };
  } catch (e) {
    const msg =
      e instanceof EdgeClientError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Errore sconosciuto";
    return { ok: false, error: msg };
  }
}

export async function saveEdgeSubnetSchedule(
  networkId: number,
  opts: {
    enabled: boolean;
    intervalMinutes: number;
    profile: EdgeScanProfile;
    targetingMode?: EdgeTargetingMode;
  },
): Promise<{ ok: boolean; error?: string }> {
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) {
    return { ok: false, error: "Scanner-Edge non configurato o disabilitato" };
  }

  const network = getNetworkById(networkId);
  if (!network) {
    return { ok: false, error: "Rete non trovata" };
  }

  try {
    const ensured = await edgeApiPost<{ ok: boolean; network_id: number }>(
      scanner,
      "/api/v1/networks/ensure",
      buildEdgeEnsureBody(networkId, { syncHosts: false, syncCredentials: true, targetingMode: opts.targetingMode }),
      { timeoutMs: 120000 },
    );

    await edgeApiPut(
      scanner,
      `/api/v1/networks/${ensured.network_id}/schedule`,
      {
        enabled: opts.enabled,
        interval_minutes: opts.intervalMinutes,
        profile: opts.profile,
        ...(opts.targetingMode != null ? { targeting_mode: opts.targetingMode } : {}),
      },
      { timeoutMs: 30000 },
    );

    if (opts.targetingMode != null) {
      setNetworkTargetingMode(networkId, opts.targetingMode);
    }

    return { ok: true };
  } catch (e) {
    const msg =
      e instanceof EdgeClientError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Errore sconosciuto";
    return { ok: false, error: msg };
  }
}

export async function removeEdgeSubnetSchedule(
  networkId: number,
): Promise<{ ok: boolean; error?: string }> {
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) {
    return { ok: false, error: "Scanner-Edge non configurato o disabilitato" };
  }

  const network = getNetworkById(networkId);
  if (!network) {
    return { ok: false, error: "Rete non trovata" };
  }

  try {
    const lookup = await edgeApiGet<{ found: boolean; network_id?: number }>(
      scanner,
      `/api/v1/networks/lookup?cidr=${encodeURIComponent(network.cidr)}`,
    );
    if (!lookup.found || lookup.network_id == null) {
      return { ok: false, error: "Rete non registrata sull'edge" };
    }

    await edgeApiDelete(
      scanner,
      `/api/v1/networks/${lookup.network_id}/schedule`,
      { timeoutMs: 15000 },
    );
    return { ok: true };
  } catch (e) {
    const msg =
      e instanceof EdgeClientError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Errore sconosciuto";
    return { ok: false, error: msg };
  }
}

/**
 * Tenant-DB accessors for the MeshCentral RMM module.
 *
 * - listMeshNodes(): nodes synced from MeshCentral (incl. unmatched), joined to
 *   the host they map to (for display in the manual-bind UI / node list).
 * - bindNodeToHost(): manual association node→host (sets match_status='manual',
 *   which mesh-sync then preserves on re-sync), with an audit row in mc_node_bind.
 *
 * Call inside withTenant(code, ...) — these use the current tenant context.
 */
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";

export interface MeshNodeRow {
  node_id: string;
  host_id: number | null;
  mesh_id: string;
  name: string | null;
  rname: string | null;
  primary_ip: string | null;
  primary_mac: string | null;
  osdesc: string | null;
  conn: number;
  last_connect: string | null;
  match_status: string | null;
  synced_at: string | null;
  /** Joined from hosts(host_id): the host's hostname, null when unmatched. */
  host_hostname: string | null;
  /** Joined from hosts(host_id): the host's IP, null when unmatched. */
  host_ip: string | null;
}

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("meshcentral/db: nessun contesto tenant attivo");
  return getTenantDb(code);
}

/** All MeshCentral nodes for the tenant, newest sync first, with host join. */
export function listMeshNodes(): MeshNodeRow[] {
  return db()
    .prepare(
      `SELECT n.node_id, n.host_id, n.mesh_id, n.name, n.rname, n.primary_ip,
              n.primary_mac, n.osdesc, n.conn, n.last_connect, n.match_status, n.synced_at,
              h.hostname AS host_hostname, h.ip AS host_ip
         FROM mc_node n
         LEFT JOIN hosts h ON h.id = n.host_id
        ORDER BY (n.match_status = 'unmatched') DESC, n.synced_at DESC`,
    )
    .all() as MeshNodeRow[];
}

export type BindResult =
  | { ok: true }
  | { ok: false; error: "node_not_found" | "host_not_found" };

/**
 * Manually bind a MeshCentral node to a DA-IPAM host. Sets host_id and marks the
 * row match_status='manual' so a later mesh-sync will NOT overwrite the binding.
 * Records an audit row. Idempotent (re-binding updates host_id + adds an audit row).
 */
export function bindNodeToHost(
  nodeId: string,
  hostId: number,
  operator: string,
): BindResult {
  const d = db();
  const node = d
    .prepare("SELECT 1 FROM mc_node WHERE node_id = ?")
    .get(nodeId);
  if (!node) return { ok: false, error: "node_not_found" };
  const host = d.prepare("SELECT 1 FROM hosts WHERE id = ?").get(hostId);
  if (!host) return { ok: false, error: "host_not_found" };

  const tx = d.transaction(() => {
    d.prepare(
      "UPDATE mc_node SET host_id = ?, match_status = 'manual', synced_at = datetime('now') WHERE node_id = ?",
    ).run(hostId, nodeId);
    d.prepare(
      "INSERT INTO mc_node_bind (node_id, host_id, operator) VALUES (?, ?, ?)",
    ).run(nodeId, hostId, operator);
  });
  tx();
  return { ok: true };
}

export interface MeshHostStatus {
  present: boolean;
  nodeId?: string;
  conn?: number;
  online?: boolean;
  matchStatus?: string;
}

/**
 * Stato Mesh del singolo host (per la card host detail). present=true se esiste
 * un nodo matched/manual; online = bit di connettività (conn & 1).
 */
export function getMeshStatusForHost(hostId: number): MeshHostStatus {
  const row = db()
    .prepare(
      `SELECT node_id, conn, match_status
         FROM mc_node
        WHERE host_id = ? AND match_status IN ('matched', 'manual')
        ORDER BY (conn & 1) DESC, synced_at DESC
        LIMIT 1`,
    )
    .get(hostId) as { node_id: string; conn: number | null; match_status: string } | undefined;
  if (!row) return { present: false };
  return {
    present: true,
    nodeId: row.node_id,
    conn: row.conn ?? 0,
    online: ((row.conn ?? 0) & 1) === 1,
    matchStatus: row.match_status,
  };
}

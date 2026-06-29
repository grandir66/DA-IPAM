import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";

/**
 * Inserisce una riga di audit in mc_remote_session (§10 punto 7).
 * NON persiste MAI token o chiave: solo metadati del launch-out.
 * Ritorna l'id della riga creata.
 */
export function recordRemoteSession(input: {
  hostId: number;
  nodeId: string | null;
  operator: string;
  meshUser: string;
  viewmode: number;
  expireMinutes: number;
  once: boolean;
  status: "minted" | "failed";
}): number {
  const code = getCurrentTenantCode();
  if (!code) {
    throw new Error(
      "recordRemoteSession: nessun contesto tenant (usare withTenant/withTenantFromSession)",
    );
  }
  const db = getTenantDb(code);
  const info = db
    .prepare(
      `INSERT INTO mc_remote_session
         (host_id, node_id, operator, mesh_user, viewmode, token_expire_min, token_once, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.hostId,
      input.nodeId,
      input.operator,
      input.meshUser,
      input.viewmode,
      input.expireMinutes,
      input.once ? 1 : 0,
      input.status,
    );
  return Number(info.lastInsertRowid);
}

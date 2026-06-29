/**
 * Sync MeshCentral nodes → tenant DB (`mc_node`).
 *
 * Logica (mirror di wazuh-sync.ts):
 *   1. Una sola `listNodes` sul control.ashx.
 *   2. Per ogni nodo: resolveNodeToHostId (MAC → IP → hostname).
 *   3. Upsert in mc_node. Un bind 'manual' NON viene MAI sovrascritto
 *      su host_id/match_status (i campi volatili conn/name/ip si rinfrescano).
 *
 * Da chiamare dentro withTenant(code, () => syncMeshForTenant()).
 */
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { getMeshCreds } from "./config";
import { resolveNodeToHostId } from "./node-resolver";
import { MeshControlClient } from "./control-client";
import type { MeshNode } from "./control-client";
import type { MeshCreds } from "./config";

/** Minimal surface used by the sync — lets tests inject a fake. */
export interface MeshControlClientLike {
  listNodes(): Promise<MeshNode[]>;
  close(): void;
}

let clientFactory: ((creds: MeshCreds) => MeshControlClientLike) | null = null;
/** Test-only: inject a fake control client. Pass null to restore the real one. */
export function _setControlClientFactory(
  f: ((creds: MeshCreds) => MeshControlClientLike) | null,
): void {
  clientFactory = f;
}

export async function syncMeshForTenant(): Promise<{ totalNodes: number; matched: number; unmatched: number }> {
  const tenantCode = getCurrentTenantCode();
  if (!tenantCode) throw new Error("Nessun contesto tenant attivo");

  const creds = getMeshCreds();
  if (!creds) {
    console.info("[mesh-sync] Configurazione MeshCentral assente, skip");
    return { totalNodes: 0, matched: 0, unmatched: 0 };
  }

  const client: MeshControlClientLike = clientFactory
    ? clientFactory(creds)
    : new MeshControlClient(creds);

  let nodes: MeshNode[];
  try {
    nodes = await client.listNodes();
  } finally {
    client.close();
  }

  const db = getTenantDb(tenantCode);

  const selectStatus = db.prepare("SELECT match_status FROM mc_node WHERE node_id = ?");

  // Upsert per nodo NON-manual: host_id + match_status risolti freschi.
  const upsertResolved = db.prepare(`
    INSERT INTO mc_node
      (node_id, host_id, mesh_id, name, rname, primary_ip, primary_mac, osdesc, conn, last_connect, match_status, synced_at)
    VALUES
      (@node_id, @host_id, @mesh_id, @name, @rname, @primary_ip, @primary_mac, @osdesc, @conn, @last_connect, @match_status, datetime('now'))
    ON CONFLICT(node_id) DO UPDATE SET
      host_id      = excluded.host_id,
      mesh_id      = excluded.mesh_id,
      name         = excluded.name,
      rname        = excluded.rname,
      primary_ip   = excluded.primary_ip,
      primary_mac  = excluded.primary_mac,
      osdesc       = excluded.osdesc,
      conn         = excluded.conn,
      last_connect = excluded.last_connect,
      match_status = excluded.match_status,
      synced_at    = datetime('now')
  `);

  // Upsert per nodo manual ESISTENTE: NON tocca host_id/match_status, solo volatili.
  const refreshManual = db.prepare(`
    UPDATE mc_node SET
      mesh_id      = @mesh_id,
      name         = @name,
      rname        = @rname,
      primary_ip   = @primary_ip,
      primary_mac  = @primary_mac,
      osdesc       = @osdesc,
      conn         = @conn,
      last_connect = @last_connect,
      synced_at    = datetime('now')
    WHERE node_id = @node_id
  `);

  let matched = 0;
  let unmatched = 0;

  const activeNodeIds = nodes.map((n) => n.nodeId);

  const run = db.transaction((items: MeshNode[]) => {
    for (const n of items) {
      const existing = selectStatus.get(n.nodeId) as { match_status: string } | undefined;
      const res = resolveNodeToHostId(n);
      const params = {
        node_id: n.nodeId,
        host_id: res.hostId,
        mesh_id: n.meshId,
        name: n.name || null,
        rname: n.rname || null,
        primary_ip: res.ip ?? n.ip ?? null,
        primary_mac: res.mac ?? (n.macs[0] ?? null),
        osdesc: n.osdesc,
        conn: n.conn,
        last_connect: n.lastConnect,
      };

      if (existing?.match_status === "manual") {
        // bind manuale: preserva host_id/match_status, rinfresca solo i volatili.
        refreshManual.run(params);
        matched++; // un bind manuale è per definizione associato a un host
      } else {
        upsertResolved.run({ ...params, match_status: res.matchStatus });
        if (res.matchStatus === "matched") matched++;
        else unmatched++;
      }
    }

    // Delete stale: rimuove nodi non più presenti in listNodes — ma MAI azzerare
    // tutto su risultato vuoto (false-zero safety, cfr. Wazuh B3): un listNodes
    // vuoto (errore transitorio / visibilità gruppo) NON deve cancellare le
    // mappature né i bind manuali. Vuoto ⇒ "niente da prunare", non "tutto via".
    if (activeNodeIds.length > 0) {
      const placeholders = activeNodeIds.map(() => "?").join(", ");
      db.prepare(`DELETE FROM mc_node WHERE node_id NOT IN (${placeholders})`).run(...activeNodeIds);
    }
  });

  run(nodes);

  return { totalNodes: nodes.length, matched, unmatched };
}

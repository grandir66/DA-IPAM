import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { getMeshCreds as realGetMeshCreds } from "@/lib/integrations/meshcentral/config";
import { mintLoginToken as realMintLoginToken } from "@/lib/integrations/meshcentral/login-token";
import { buildRemoteSessionUrl as realBuildRemoteSessionUrl } from "@/lib/integrations/meshcentral/deep-link";
import { recordRemoteSession as realRecordRemoteSession } from "@/lib/integrations/meshcentral/remote-session-audit";
import type { MeshCreds } from "@/lib/integrations/meshcentral/config";

interface MatchedNodeRow {
  node_id: string;
  conn: number | null;
}

/**
 * Dipendenze iniettabili (DI seam) — il toolchain Node22+tsx non supporta
 * `mock.module` su namespace ESM (getter-only), quindi i test iniettano i fake
 * via `deps`. I caller di produzione usano i default.
 */
export interface RemoteSessionDeps {
  getMeshCreds: () => MeshCreds | null;
  mintLoginToken: (opts: { meshUser: string; expireMinutes: number; once?: boolean }) => string;
  buildRemoteSessionUrl: (opts: { serverUrl: string; token: string; nodeId: string; viewmode: number }) => string;
  recordRemoteSession: typeof realRecordRemoteSession;
}

const defaultDeps: RemoteSessionDeps = {
  getMeshCreds: realGetMeshCreds,
  mintLoginToken: realMintLoginToken,
  buildRemoteSessionUrl: realBuildRemoteSessionUrl,
  recordRemoteSession: realRecordRemoteSession,
};

/**
 * Prepara una sessione di controllo remoto (§10): risolve il nodo matched,
 * minta un login token effimero (3 min, single-use) per il service account,
 * costruisce il deep-link e scrive l'audit. Token e chiave NON escono da qui:
 * non vengono mai loggati né persistiti.
 */
export function prepareRemoteSession(
  input: { hostId: number; viewmode: number; operator: string },
  deps: RemoteSessionDeps = defaultDeps,
): { ok: true; url: string } | { ok: false; status: number; error: string } {
  const code = getCurrentTenantCode();
  if (!code) {
    return { ok: false, status: 401, error: "Nessun contesto tenant" };
  }
  const db = getTenantDb(code);

  const node = db
    .prepare(
      `SELECT node_id, conn
         FROM mc_node
        WHERE host_id = ? AND match_status IN ('matched', 'manual')
        ORDER BY (conn & 1) DESC, synced_at DESC
        LIMIT 1`,
    )
    .get(input.hostId) as MatchedNodeRow | undefined;

  if (!node) {
    return { ok: false, status: 404, error: "Nessun nodo MeshCentral associato all'host" };
  }

  const creds = deps.getMeshCreds();
  if (!creds) {
    return { ok: false, status: 409, error: "MeshCentral non configurato per questo tenant" };
  }

  const meshUser = `user/${creds.domain}/${creds.serviceUser}`;

  let url: string;
  try {
    const token = deps.mintLoginToken({ meshUser, expireMinutes: 3, once: true });
    url = deps.buildRemoteSessionUrl({
      serverUrl: creds.serverUrl,
      token,
      nodeId: node.node_id,
      viewmode: input.viewmode,
    });
  } catch {
    // Audit del fallimento SENZA dettagli sensibili (token/chiave mai loggati).
    deps.recordRemoteSession({
      hostId: input.hostId,
      nodeId: node.node_id,
      operator: input.operator,
      meshUser,
      viewmode: input.viewmode,
      expireMinutes: 3,
      once: true,
      status: "failed",
    });
    return { ok: false, status: 502, error: "Generazione token di sessione fallita" };
  }

  deps.recordRemoteSession({
    hostId: input.hostId,
    nodeId: node.node_id,
    operator: input.operator,
    meshUser,
    viewmode: input.viewmode,
    expireMinutes: 3,
    once: true,
    status: "minted",
  });

  return { ok: true, url };
}

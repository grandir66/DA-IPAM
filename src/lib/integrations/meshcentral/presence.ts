/**
 * Presenza agenti endpoint in batch — UNA query per sorgente (mesh/wazuh/glpi/choco),
 * MAI getXxxById dentro .map() (anti-regressione #8). Soglie freschezza: spec §8.
 *
 * Robustezza: inv_agent_endpoint (GLPI) e patch_operations (Choco) sono tabelle
 * OPT-IN dei rispettivi moduli — NON presenti su ogni tenant. Ogni sorgente è
 * guardata con tableExists() (via pragma, non altera il conteggio prepare): se la
 * tabella manca, quella capability resta semplicemente present:false.
 */
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";

export interface EndpointAgentCapabilities {
  glpi: { present: boolean; lastSeen?: string };
  choco: { present: boolean; lastProbed?: string; probeStatus?: string };
  mesh: { present: boolean; nodeId?: string; conn?: number; syncedAt?: string };
  wazuh: { present: boolean; agentId?: string; status?: string };
}

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

function emptyCaps(): EndpointAgentCapabilities {
  return {
    glpi: { present: false },
    choco: { present: false },
    mesh: { present: false },
    wazuh: { present: false },
  };
}

/** Esiste la tabella? Usa pragma (NON db.prepare) per non alterare il conteggio prepare. */
function tableExists(d: ReturnType<typeof db>, name: string): boolean {
  const safe = name.replace(/[^a-zA-Z0-9_]/g, "");
  return (d.pragma(`table_info('${safe}')`) as unknown[]).length > 0;
}

export function getEndpointAgentsForHosts(
  hostIds: number[],
): Map<number, EndpointAgentCapabilities> {
  const out = new Map<number, EndpointAgentCapabilities>();
  if (hostIds.length === 0) return out;

  const ids = Array.from(new Set(hostIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, emptyCaps());

  const ph = ids.map(() => "?").join(",");
  const d = db();

  // ── Mesh: mc_node JOIN host_id. present = matched; active vs stale lo decide la UI da conn/syncedAt.
  if (tableExists(d, "mc_node")) {
    const meshRows = d
      .prepare(`SELECT host_id, node_id, conn, synced_at FROM mc_node WHERE host_id IN (${ph})`)
      .all(...ids) as Array<{ host_id: number; node_id: string; conn: number | null; synced_at: string | null }>;
    for (const r of meshRows) {
      const caps = out.get(r.host_id);
      if (!caps) continue;
      caps.mesh = {
        present: true,
        nodeId: r.node_id,
        conn: r.conn ?? 0,
        syncedAt: r.synced_at ?? undefined,
      };
    }
  }

  // ── Wazuh: wazuh_agent. present = registrato; active = status='active'.
  if (tableExists(d, "wazuh_agent")) {
    const wazuhRows = d
      .prepare(`SELECT host_id, agent_id, status FROM wazuh_agent WHERE host_id IN (${ph})`)
      .all(...ids) as Array<{ host_id: number | null; agent_id: string; status: string | null }>;
    for (const r of wazuhRows) {
      if (r.host_id == null) continue;
      const caps = out.get(r.host_id);
      if (!caps) continue;
      caps.wazuh = { present: true, agentId: r.agent_id, status: r.status ?? undefined };
    }
  }

  // ── GLPI: inv_agent_endpoint.last_seen_at > now-7d (stale -> present false).
  if (tableExists(d, "inv_agent_endpoint")) {
    const glpiRows = d
      .prepare(
        `SELECT host_id, MAX(last_seen_at) AS last_seen_at
           FROM inv_agent_endpoint
          WHERE host_id IN (${ph})
          GROUP BY host_id`,
      )
      .all(...ids) as Array<{ host_id: number | null; last_seen_at: string | null }>;
    for (const r of glpiRows) {
      if (r.host_id == null) continue;
      const caps = out.get(r.host_id);
      if (!caps || !r.last_seen_at) continue;
      const fresh = isWithin(r.last_seen_at, 7);
      caps.glpi = fresh
        ? { present: true, lastSeen: r.last_seen_at }
        : { present: false, lastSeen: r.last_seen_at };
    }
  }

  // ── Choco: ultimo patch_operations per host (MAX started_at); active = exit_code 0, else stale.
  if (tableExists(d, "patch_operations")) {
    const chocoRows = d
      .prepare(
        `SELECT po.host_id, po.exit_code, po.started_at
           FROM patch_operations po
           JOIN (SELECT host_id, MAX(started_at) AS mx
                   FROM patch_operations
                  WHERE host_id IN (${ph}) AND package_manager = 'choco'
                  GROUP BY host_id) last
             ON last.host_id = po.host_id AND last.mx = po.started_at
          WHERE po.package_manager = 'choco'`,
      )
      .all(...ids) as Array<{ host_id: number; exit_code: number | null; started_at: string | null }>;
    const seenChoco = new Set<number>();
    for (const r of chocoRows) {
      if (seenChoco.has(r.host_id)) continue; // ties on started_at: take first
      seenChoco.add(r.host_id);
      const caps = out.get(r.host_id);
      if (!caps) continue;
      const ok = r.exit_code === 0;
      caps.choco = {
        present: true,
        lastProbed: r.started_at ?? undefined,
        probeStatus: ok ? "active" : "stale",
      };
    }
  }

  return out;
}

/** true se ts (ISO8601) è entro `days` giorni da adesso. Confronto datetime-safe. */
function isWithin(ts: string, days: number): boolean {
  const t = Date.parse(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= days * 24 * 60 * 60 * 1000;
}

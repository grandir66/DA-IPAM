/**
 * Sync Wazuh → tenant DB.
 *
 * Logica:
 *   1. Recupera la lista agent dal manager Wazuh.
 *   2. Per ogni agent prova il match contro gli host del tenant nell'ordine:
 *      IP > MAC (da netiface) > hostname.
 *   3. Per ogni agent (matchato o meno) persiste: agent meta, HW, OS,
 *      software completo (replace), vulnerability complete (replace).
 *   4. A fine giro elimina gli agent non più presenti su Wazuh.
 *
 * Da chiamare dentro `withTenant(code, () => syncWazuhForTenant())`.
 */

import { getCurrentTenantCode, getAllHostsFlat, getHostByIp, getHostByMac } from "../db-tenant";
import { normalizeMac } from "../utils";
import { getWazuhConfig } from "./wazuh-config";
import { createWazuhClient, WazuhClient, type WazuhAgent, type WazuhSyscollectorNetiface } from "./wazuh-api";
import {
  createWazuhIndexerClient,
  indexerDocToWazuhVuln,
  type WazuhIndexerClient,
} from "./wazuh-indexer-api";
import {
  upsertWazuhAgent,
  upsertWazuhHw,
  upsertWazuhOs,
  replaceSoftwareForAgent,
  replaceVulnsForAgent,
  replacePortsForAgent,
  replaceHotfixesForAgent,
  replaceNetifacesForAgent,
  replaceNetaddrsForAgent,
  deleteWazuhAgentsExcept,
  enrichHostFromWazuh,
  getWazuhAgentByHostId,
  type WazuhAgentRow,
} from "./wazuh-db";

export interface WazuhSyncResult {
  tenantCode: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalAgents: number;
  matchedHosts: number;
  softwareRows: number;
  vulnRows: number;
  portRows: number;
  hotfixRows: number;
  netaddrRows: number;
  hostsEnriched: number;
  removedAgents: number;
  errors: string[];
}

function pickAgentIp(agent: WazuhAgent): string | null {
  const ip = agent.ip || agent.registerIP;
  if (!ip) return null;
  // Wazuh può restituire "any" / "0.0.0.0" → scarta
  if (ip === "any" || ip === "0.0.0.0") return null;
  return ip;
}

/**
 * Match agent → host. Prova IP → MAC (da netiface) → hostname.
 * Ritorna { hostId, primaryMac, netifaces }: netifaces è la lista grezza già
 * fetchata, riusata dal chiamante per persisterla in wazuh_netiface senza
 * duplicare la chiamata HTTP.
 */
async function matchAgentToHost(
  client: WazuhClient,
  agent: WazuhAgent,
  hostnameIndex: Map<string, number>,
): Promise<{ hostId: number | null; primaryMac: string | null; netifaces: WazuhSyscollectorNetiface[] }> {
  let hostId: number | null = null;
  let primaryMac: string | null = null;
  let netifaces: WazuhSyscollectorNetiface[] = [];

  // 1) IP
  const ip = pickAgentIp(agent);
  if (ip) {
    const h = getHostByIp(ip);
    if (h) hostId = h.id;
  }

  // 2) MAC da netiface (utile sia per match che per arricchimento)
  try {
    netifaces = await client.getNetifaces(agent.id);
    for (const n of netifaces) {
      const mac = n.mac ? normalizeMac(n.mac) : null;
      if (!mac) continue;
      // Esclude MAC vuoti, virtuali, di loopback
      if (mac === "00:00:00:00:00:00") continue;
      if (!primaryMac) primaryMac = mac;
      if (!hostId) {
        const hm = getHostByMac(mac);
        if (hm) hostId = hm.id;
      }
    }
  } catch {
    // netiface può essere vuoto / non disponibile → ignora
  }

  // 3) Hostname (case-insensitive)
  if (!hostId && agent.name) {
    const key = agent.name.toLowerCase();
    const id = hostnameIndex.get(key);
    if (id) hostId = id;
  }

  return { hostId, primaryMac, netifaces };
}

function buildHostnameIndex(): Map<string, number> {
  const idx = new Map<string, number>();
  const hosts = getAllHostsFlat();
  for (const h of hosts) {
    if (h.hostname) idx.set(h.hostname.toLowerCase(), h.id);
    if (h.custom_name) idx.set(h.custom_name.toLowerCase(), h.id);
  }
  return idx;
}

/** Recupera vulnerabilities da indexer se configurato, altrimenti dal manager API (legacy < 4.8). */
async function fetchVulnsForAgent(
  agentId: string,
  manager: WazuhClient,
  indexer: WazuhIndexerClient | null,
): Promise<Parameters<typeof replaceVulnsForAgent>[1]> {
  if (indexer) {
    const docs = await indexer.getVulnerabilitiesForAgent(agentId);
    return docs.map(indexerDocToWazuhVuln);
  }
  return manager.getVulnerabilities(agentId);
}

/**
 * Sincronizza un singolo agent (utile per refresh on-demand dalla scheda host).
 * Da chiamare dentro withTenant. Lancia eccezione su errori di connessione.
 */
export async function syncSingleAgent(agentId: string): Promise<void> {
  const cfg = getWazuhConfig();
  if (!cfg.enabled) throw new Error("Integrazione Wazuh disabilitata");
  const client = createWazuhClient(cfg);
  if (!client) throw new Error("Configurazione Wazuh incompleta");
  const indexer = createWazuhIndexerClient({
    url: cfg.indexerUrl,
    username: cfg.indexerUsername,
    password: cfg.indexerPassword,
    verifyTls: cfg.verifyTls,
  });

  const all = await client.listAgents(true);
  const agent = all.find((a) => a.id === agentId);
  if (!agent) throw new Error(`Agent ${agentId} non trovato su Wazuh`);

  const hostnameIndex = buildHostnameIndex();
  const { hostId, primaryMac, netifaces } = await matchAgentToHost(client, agent, hostnameIndex);
  upsertWazuhAgent(agent, hostId, primaryMac);
  replaceNetifacesForAgent(agent.id, netifaces);

  const [hw, os, pkgs, ports, hotfixes, netaddrs, vulns] = await Promise.all([
    client.getHardware(agent.id),
    client.getOs(agent.id),
    client.getPackages(agent.id),
    client.getPorts(agent.id),
    client.getHotfixes(agent.id),
    client.getNetaddrs(agent.id),
    fetchVulnsForAgent(agent.id, client, indexer),
  ]);
  if (hw) upsertWazuhHw(agent.id, hw);
  if (os) upsertWazuhOs(agent.id, os);
  if (hostId && (hw || os)) enrichHostFromWazuh(hostId, hw, os);
  replaceSoftwareForAgent(agent.id, pkgs);
  replacePortsForAgent(agent.id, ports);
  replaceHotfixesForAgent(agent.id, hotfixes);
  replaceNetaddrsForAgent(agent.id, netaddrs);
  replaceVulnsForAgent(agent.id, vulns);
}

/**
 * Sync full tenant. Da chiamare dentro withTenant(code, ...).
 */
export async function syncWazuhForTenant(): Promise<WazuhSyncResult> {
  const tenantCode = getCurrentTenantCode();
  if (!tenantCode) throw new Error("Nessun contesto tenant attivo");

  const startedAt = new Date();
  const result: WazuhSyncResult = {
    tenantCode,
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    durationMs: 0,
    totalAgents: 0,
    matchedHosts: 0,
    softwareRows: 0,
    vulnRows: 0,
    portRows: 0,
    hotfixRows: 0,
    netaddrRows: 0,
    hostsEnriched: 0,
    removedAgents: 0,
    errors: [],
  };

  const cfg = getWazuhConfig();
  if (!cfg.enabled) {
    result.errors.push("Integrazione Wazuh disabilitata");
    return finalize(result, startedAt);
  }
  const client = createWazuhClient(cfg);
  if (!client) {
    result.errors.push("Configurazione Wazuh incompleta (url/username/password)");
    return finalize(result, startedAt);
  }
  const indexer = createWazuhIndexerClient({
    url: cfg.indexerUrl,
    username: cfg.indexerUsername,
    password: cfg.indexerPassword,
    verifyTls: cfg.verifyTls,
  });

  let agents: WazuhAgent[];
  try {
    agents = await client.listAgents();
  } catch (e) {
    result.errors.push(`Lista agent fallita: ${(e as Error).message}`);
    return finalize(result, startedAt);
  }
  result.totalAgents = agents.length;

  const hostnameIndex = buildHostnameIndex();
  const activeAgentIds: string[] = [];

  for (const agent of agents) {
    activeAgentIds.push(agent.id);
    try {
      const { hostId, primaryMac, netifaces } = await matchAgentToHost(client, agent, hostnameIndex);
      upsertWazuhAgent(agent, hostId, primaryMac);
      if (hostId) result.matchedHosts++;

      // Sincronizza dati per gli agent attivi e disconnected recenti.
      // Skip per never_connected (non hanno mai inviato dati).
      if (agent.status === "never_connected") continue;

      replaceNetifacesForAgent(agent.id, netifaces);

      const [hw, os, pkgs, ports, hotfixes, netaddrs, vulns] = await Promise.all([
        client.getHardware(agent.id),
        client.getOs(agent.id),
        client.getPackages(agent.id),
        client.getPorts(agent.id),
        client.getHotfixes(agent.id),
        client.getNetaddrs(agent.id),
        fetchVulnsForAgent(agent.id, client, indexer),
      ]);

      if (hw) upsertWazuhHw(agent.id, hw);
      if (os) upsertWazuhOs(agent.id, os);
      if (hostId && (hw || os)) {
        if (enrichHostFromWazuh(hostId, hw, os) > 0) result.hostsEnriched++;
      }
      result.softwareRows += replaceSoftwareForAgent(agent.id, pkgs);
      result.portRows += replacePortsForAgent(agent.id, ports);
      result.hotfixRows += replaceHotfixesForAgent(agent.id, hotfixes);
      result.netaddrRows += replaceNetaddrsForAgent(agent.id, netaddrs);
      result.vulnRows += replaceVulnsForAgent(agent.id, vulns);
    } catch (e) {
      result.errors.push(`agent ${agent.id} (${agent.name ?? "?"}): ${(e as Error).message}`);
    }
  }

  try {
    result.removedAgents = deleteWazuhAgentsExcept(activeAgentIds);
  } catch (e) {
    result.errors.push(`Cleanup agent rimossi: ${(e as Error).message}`);
  }

  return finalize(result, startedAt);
}

function finalize(result: WazuhSyncResult, startedAt: Date): WazuhSyncResult {
  const end = new Date();
  result.finishedAt = end.toISOString();
  result.durationMs = end.getTime() - startedAt.getTime();
  return result;
}

/**
 * Helper di lettura: ritorna l'agent associato a un host (se mai matchato).
 * Da chiamare dentro withTenant.
 */
export function getWazuhAgentForHost(hostId: number): WazuhAgentRow | null {
  return getWazuhAgentByHostId(hostId);
}

/**
 * Pool HTTP/HTTPS condiviso per le integrazioni (LibreNMS, Wazuh, Proxmox).
 *
 * v0.2.642 audit perf MC8: prima ogni client (WazuhClient, LibreNMSClient, ...)
 * creava un `https.Agent({ keepAlive: true })` istanza-locale, oppure usava
 * `fetch()` Node default (no keepAlive → TLS handshake ad ogni call). Su un
 * sync Wazuh con 100 agent = 100 handshake TLS (~200ms/cad). Ora un singolo
 * Agent per host:port è riutilizzato cross-istanza.
 *
 * NOTA: l'agent qui usa `rejectUnauthorized` configurabile dal caller — i
 * pattern self-signed (Wazuh Manager, OpenSearch interno, Proxmox) restano
 * gestiti dal caller, non vengono modificati.
 */

import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

interface PoolKey {
  protocol: "http" | "https";
  verifyTls: boolean;
}

const httpPool = new Map<string, HttpAgent | HttpsAgent>();

function keyFor(k: PoolKey): string {
  return `${k.protocol}:${k.verifyTls ? "verify" : "noverify"}`;
}

const DEFAULT_OPTS = {
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 32,
  maxFreeSockets: 8,
  timeout: 60_000,
};

/**
 * Ritorna un Agent condiviso per il profilo richiesto. Cached in memoria per
 * la vita del processo Node (rilasciato a process exit).
 */
export function getSharedAgent(protocol: "http" | "https", verifyTls = true): HttpAgent | HttpsAgent {
  const key = keyFor({ protocol, verifyTls });
  const existing = httpPool.get(key);
  if (existing) return existing;
  const agent = protocol === "https"
    ? new HttpsAgent({ ...DEFAULT_OPTS, rejectUnauthorized: verifyTls })
    : new HttpAgent(DEFAULT_OPTS);
  httpPool.set(key, agent);
  return agent;
}

/** Per testing / shutdown ordinato. */
export function destroyAllSharedAgents(): void {
  for (const agent of httpPool.values()) {
    try { agent.destroy(); } catch { /* ignore */ }
  }
  httpPool.clear();
}

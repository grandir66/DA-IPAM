/**
 * Client REST per Wazuh Manager API (4.x).
 *
 * Endpoint base: https://<host>:55000
 * Auth: Basic Auth → JWT (POST /security/user/authenticate?raw=true).
 *       JWT in cache (TTL ~15min). Rinnovo trasparente su 401.
 *
 * Implementazione: node:https raw — niente undici/axios — per coerenza con
 * proxmox-client.ts e per gestire cert self-signed senza fetch dispatcher.
 *
 * Refs:
 *   - https://documentation.wazuh.com/current/user-manual/api/reference.html
 *   - GET /agents
 *   - GET /syscollector/{agent_id}/{hardware|os|packages|netiface}
 *   - GET /vulnerability/{agent_id}
 */

import * as https from "node:https";
import { URL } from "node:url";

export interface WazuhClientConfig {
  url: string;            // es. https://da-wazuh.domarc.it:55000
  username: string;
  password: string;
  verifyTls: boolean;     // false per cert self-signed
}

export interface WazuhPagedResponse<T> {
  data: {
    affected_items: T[];
    total_affected_items: number;
    failed_items: unknown[];
    total_failed_items: number;
  };
  message?: string;
  error?: number;
}

export interface WazuhAgent {
  id: string;
  name: string;
  ip?: string;
  registerIP?: string;
  status?: string;
  os?: {
    arch?: string;
    name?: string;
    platform?: string;
    uname?: string;
    version?: string;
  };
  version?: string;
  node_name?: string;
  manager?: string;
  lastKeepAlive?: string;
  dateAdd?: string;
}

export interface WazuhSyscollectorHw {
  scan?: { time?: string };
  board_serial?: string;
  board_vendor?: string;
  board_product?: string;
  cpu?: { name?: string; cores?: number; mhz?: number };
  ram?: { total?: number; free?: number };
}

export interface WazuhSyscollectorOs {
  scan?: { time?: string };
  hostname?: string;
  architecture?: string;
  os?: {
    name?: string;
    codename?: string;
    major?: string;
    minor?: string;
    build?: string;
    platform?: string;
    version?: string;
  };
  sysname?: string;
  release?: string;
  version?: string;
}

export interface WazuhSyscollectorPackage {
  scan?: { time?: string };
  name?: string;
  version?: string;
  vendor?: string;
  architecture?: string;
  format?: string;
  source?: string;
  install_time?: string;
  description?: string;
}

export interface WazuhSyscollectorNetiface {
  name?: string;
  mac?: string;
  type?: string;
  state?: string;
}

export interface WazuhSyscollectorPort {
  scan?: { time?: string };
  protocol?: string;                    // tcp|udp|tcp6|udp6
  local?: { ip?: string; port?: number };
  remote?: { ip?: string; port?: number };
  state?: string;                       // listening|established|...
  process?: string;
  pid?: number;
}

export interface WazuhVulnerability {
  cve?: string;
  severity?: string;
  cvss2_score?: number;
  cvss3_score?: number;
  name?: string;            // package name
  version?: string;         // package version
  architecture?: string;
  status?: string;          // VALID|PENDING|SOLVED|OBSOLETE
  detection_time?: string;
  published?: string;
  updated?: string;
  condition?: string;
  title?: string;
  external_references?: string[] | string;
}

export class WazuhClient {
  private baseUrl: URL;
  private agent: https.Agent;
  private username: string;
  private password: string;
  private jwt: string | null = null;
  private jwtExpiresAt = 0;

  constructor(cfg: WazuhClientConfig) {
    if (!cfg.url) throw new Error("WazuhClient: url mancante");
    const normalized = cfg.url.replace(/\/+$/, "");
    this.baseUrl = new URL(normalized);
    this.username = cfg.username;
    this.password = cfg.password;
    this.agent = new https.Agent({
      rejectUnauthorized: cfg.verifyTls,
      keepAlive: true,
    });
  }

  // ──────────────────────────────── HTTP core ────────────────────────────────

  private rawRequest(
    method: "GET" | "POST",
    path: string,
    opts: { useBasicAuth?: boolean; rawText?: boolean; timeoutMs?: number } = {},
  ): Promise<{ status: number; body: string }> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (opts.useBasicAuth) {
      const basic = Buffer.from(`${this.username}:${this.password}`).toString("base64");
      headers["Authorization"] = `Basic ${basic}`;
    } else if (this.jwt) {
      headers["Authorization"] = `Bearer ${this.jwt}`;
    }

    const reqOpts: https.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      headers,
      agent: this.agent,
      timeout: opts.timeoutMs ?? 20_000,
    };

    return new Promise((resolve, reject) => {
      const req = https.request(reqOpts, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
      });
      req.on("timeout", () => {
        req.destroy(new Error(`Wazuh API timeout dopo ${opts.timeoutMs ?? 20_000}ms`));
      });
      req.on("error", reject);
      req.end();
    });
  }

  // ──────────────────────────────── Auth ────────────────────────────────

  /** Ottiene un JWT (raw text) e lo cacha 13 minuti (TTL Wazuh = 15min). */
  private async login(): Promise<void> {
    const { status, body } = await this.rawRequest(
      "POST",
      "/security/user/authenticate?raw=true",
      { useBasicAuth: true, rawText: true },
    );
    if (status !== 200) {
      throw new Error(`Wazuh login fallito (HTTP ${status}): ${body.slice(0, 200)}`);
    }
    const token = body.trim();
    if (!token || token.split(".").length !== 3) {
      throw new Error("Wazuh login: token JWT non valido nella risposta");
    }
    this.jwt = token;
    this.jwtExpiresAt = Date.now() + 13 * 60 * 1000;
  }

  private async ensureAuth(): Promise<void> {
    if (!this.jwt || Date.now() >= this.jwtExpiresAt) {
      await this.login();
    }
  }

  /** Effettua una GET con auth Bearer e retry singolo su 401 (token scaduto). */
  private async getJson<T>(path: string): Promise<T> {
    await this.ensureAuth();
    let res = await this.rawRequest("GET", path);
    if (res.status === 401) {
      this.jwt = null;
      await this.login();
      res = await this.rawRequest("GET", path);
    }
    if (res.status < 200 || res.status >= 300) {
      const preview = res.body.slice(0, 300);
      throw new Error(`Wazuh API ${path} → HTTP ${res.status}: ${preview}`);
    }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new Error(`Wazuh API ${path}: risposta non JSON (${res.body.slice(0, 200)})`);
    }
  }

  // ──────────────────────────────── Paging helper ────────────────────────────────

  private async getPaged<T>(basePath: string, pageSize = 500): Promise<T[]> {
    const out: T[] = [];
    const sep = basePath.includes("?") ? "&" : "?";
    let offset = 0;
    let total = Infinity;
    while (offset < total) {
      const path = `${basePath}${sep}limit=${pageSize}&offset=${offset}`;
      const res = await this.getJson<WazuhPagedResponse<T>>(path);
      const items = res.data?.affected_items ?? [];
      total = res.data?.total_affected_items ?? items.length;
      out.push(...items);
      if (items.length === 0) break;
      offset += items.length;
      if (offset >= total) break;
      if (offset > 50_000) break; // safety
    }
    return out;
  }

  // ──────────────────────────────── Public API ────────────────────────────────

  /** Test di raggiungibilità + auth. Lancia eccezione se KO. */
  async ping(): Promise<{ apiVersion?: string; nodeName?: string }> {
    await this.ensureAuth();
    const info = await this.getJson<{ data?: { api_version?: string; node_name?: string; revision?: string } }>("/?pretty=false");
    return {
      apiVersion: info.data?.api_version,
      nodeName: info.data?.node_name,
    };
  }

  /** Lista TUTTI gli agent (paginazione automatica). Esclude agent "000" (manager). */
  async listAgents(includeManager = false): Promise<WazuhAgent[]> {
    const all = await this.getPaged<WazuhAgent>("/agents");
    if (includeManager) return all;
    return all.filter((a) => a.id !== "000");
  }

  async getHardware(agentId: string): Promise<WazuhSyscollectorHw | null> {
    try {
      const res = await this.getJson<WazuhPagedResponse<WazuhSyscollectorHw>>(`/syscollector/${agentId}/hardware`);
      return res.data?.affected_items?.[0] ?? null;
    } catch (e) {
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) return null;
      throw e;
    }
  }

  async getOs(agentId: string): Promise<WazuhSyscollectorOs | null> {
    try {
      const res = await this.getJson<WazuhPagedResponse<WazuhSyscollectorOs>>(`/syscollector/${agentId}/os`);
      return res.data?.affected_items?.[0] ?? null;
    } catch (e) {
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) return null;
      throw e;
    }
  }

  async getPackages(agentId: string): Promise<WazuhSyscollectorPackage[]> {
    try {
      return await this.getPaged<WazuhSyscollectorPackage>(`/syscollector/${agentId}/packages`);
    } catch (e) {
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) return [];
      throw e;
    }
  }

  async getNetifaces(agentId: string): Promise<WazuhSyscollectorNetiface[]> {
    try {
      return await this.getPaged<WazuhSyscollectorNetiface>(`/syscollector/${agentId}/netiface`);
    } catch (e) {
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) return [];
      throw e;
    }
  }

  /** Porte (tutte). Il filtro state=listening avviene lato sync. */
  async getPorts(agentId: string): Promise<WazuhSyscollectorPort[]> {
    try {
      return await this.getPaged<WazuhSyscollectorPort>(`/syscollector/${agentId}/ports`);
    } catch (e) {
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) return [];
      throw e;
    }
  }

  /**
   * NOTA: in Wazuh ≥ 4.8 l'endpoint /vulnerability è stato rimosso dal manager
   * API. I dati CVE vivono ora nell'indexer (OpenSearch) sull'indice
   * `wazuh-states-vulnerabilities-*` e richiedono un utente OpenSearch separato.
   * Manteniamo questa chiamata per back-compat con Wazuh < 4.8; su 404 ritorna [].
   * Per CVE su 4.14.x usare WazuhIndexerClient (TODO).
   */
  async getVulnerabilities(agentId: string): Promise<WazuhVulnerability[]> {
    try {
      return await this.getPaged<WazuhVulnerability>(`/vulnerability/${agentId}`);
    } catch (e) {
      if (e instanceof Error && /HTTP 4\d\d/.test(e.message)) return [];
      throw e;
    }
  }
}

/** Factory: costruisce un client se la config è valida, altrimenti null. */
export function createWazuhClient(cfg: WazuhClientConfig): WazuhClient | null {
  if (!cfg.url || !cfg.username || !cfg.password) return null;
  return new WazuhClient(cfg);
}

/**
 * Client per il Wazuh Indexer (OpenSearch). Sorgente CVE in Wazuh ≥ 4.8.
 *
 * Endpoint base: https://<host>:9200
 * Auth: Basic. Indici:
 *   - wazuh-states-vulnerabilities-*     (CVE — fonte primaria)
 *   - wazuh-states-inventory-*            (inventario syscollector storicizzato)
 *
 * Implementazione: node:https raw — coerente con wazuh-api.ts e proxmox-client.ts.
 *
 * Nota infra: il Wazuh-indexer single-node è bound spesso su 127.0.0.1.
 * Per accesso da DA-IPAM remoto serve `network.host: 0.0.0.0` (o tunnel SSH).
 */

import * as https from "node:https";
import { URL } from "node:url";

export interface WazuhIndexerConfig {
  url: string;            // es. https://da-wazuh.domarc.it:9200
  username: string;
  password: string;
  verifyTls: boolean;     // false per cert self-signed (default Wazuh)
}

interface IndexerHit<T> {
  _index: string;
  _id: string;
  _source: T;
}

interface IndexerSearchResponse<T> {
  took?: number;
  hits: {
    total: { value: number; relation: string } | number;
    hits: IndexerHit<T>[];
  };
}

/**
 * Documento singolo dell'indice wazuh-states-vulnerabilities-* (Wazuh 4.8+).
 * Schema parziale — usiamo i campi che ci servono per persistere su wazuh_vuln.
 */
export interface IndexerVulnDoc {
  agent?: {
    id?: string;
    name?: string;
    version?: string;
  };
  host?: {
    os?: {
      full?: string;
      kernel?: string;
      name?: string;
      platform?: string;
      version?: string;
    };
  };
  package?: {
    name?: string;
    version?: string;
    architecture?: string;
    type?: string;     // deb|rpm|win|pkg
    description?: string;
  };
  vulnerability?: {
    id?: string;       // CVE-YYYY-NNNN
    severity?: string; // Critical|High|Medium|Low|Untriaged
    score?: { base?: number; version?: string };
    description?: string;
    published_at?: string;
    detected_at?: string;
    updated_at?: string;
    reference?: string;
    enumeration?: string;
    category?: string;
    classification?: string;
    under_evaluation?: boolean;
    scanner?: {
      source?: string;
      vendor?: string;
      reference?: string;
      condition?: string;
    };
  };
}

export class WazuhIndexerClient {
  private baseUrl: URL;
  private agent: https.Agent;
  private authHeader: string;

  constructor(cfg: WazuhIndexerConfig) {
    if (!cfg.url) throw new Error("WazuhIndexerClient: url mancante");
    this.baseUrl = new URL(cfg.url.replace(/\/+$/, ""));
    this.agent = new https.Agent({
      rejectUnauthorized: cfg.verifyTls,
      keepAlive: true,
    });
    this.authHeader = "Basic " + Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64");
  }

  private request(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30_000): Promise<{ status: number; body: string }> {
    const url = new URL(path, this.baseUrl);
    const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: this.authHeader,
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = String(payload.length);
    }

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          method,
          hostname: url.hostname,
          port: url.port || 9200,
          path: url.pathname + url.search,
          headers,
          agent: this.agent,
          timeout: timeoutMs,
        },
        (res) => {
          let data = "";
          res.on("data", (c) => { data += c; });
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
        },
      );
      req.on("timeout", () => req.destroy(new Error(`OpenSearch timeout dopo ${timeoutMs}ms`)));
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  private async json<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.request(method, path, body);
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`OpenSearch ${method} ${path} → HTTP ${res.status}: ${res.body.slice(0, 300)}`);
    }
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new Error(`OpenSearch ${path}: risposta non JSON (${res.body.slice(0, 200)})`);
    }
  }

  /** Test connessione + ritorna stato cluster. */
  async ping(): Promise<{ clusterName?: string; status?: string; numberOfNodes?: number }> {
    const res = await this.json<{ cluster_name?: string; status?: string; number_of_nodes?: number }>(
      "GET",
      "/_cluster/health",
    );
    return {
      clusterName: res.cluster_name,
      status: res.status,
      numberOfNodes: res.number_of_nodes,
    };
  }

  /**
   * Lista CVE per un agent specifico. Usa paginazione tramite search_after.
   * `agentId` può essere ID Wazuh (string padded "001") oppure name.
   */
  async getVulnerabilitiesForAgent(agentId: string, maxRows = 5_000): Promise<IndexerVulnDoc[]> {
    const out: IndexerVulnDoc[] = [];
    const pageSize = 1_000;
    let searchAfter: unknown[] | undefined = undefined;

    while (out.length < maxRows) {
      const body: Record<string, unknown> = {
        size: pageSize,
        query: { term: { "agent.id": agentId } },
        sort: [{ "vulnerability.detected_at": "desc" }, { _id: "asc" }],
      };
      if (searchAfter) body.search_after = searchAfter;

      const res = await this.json<IndexerSearchResponse<IndexerVulnDoc>>(
        "POST",
        "/wazuh-states-vulnerabilities-*/_search",
        body,
      );
      const hits = res.hits?.hits ?? [];
      if (hits.length === 0) break;
      for (const h of hits) out.push(h._source);
      if (hits.length < pageSize) break;
      const last = hits[hits.length - 1];
      // search_after = sort values dell'ultimo doc
      const lastSort = (last as IndexerHit<IndexerVulnDoc> & { sort?: unknown[] }).sort;
      if (!lastSort || !Array.isArray(lastSort)) break;
      searchAfter = lastSort;
    }
    return out;
  }

  /**
   * Conta i CVE per severity (aggregazione, NO scan full).
   * Utile per ottenere il totale o una breakdown veloce.
   */
  async countSeverityForAgent(agentId: string): Promise<Record<string, number>> {
    const body = {
      size: 0,
      query: { term: { "agent.id": agentId } },
      aggs: { by_severity: { terms: { field: "vulnerability.severity", size: 10 } } },
    };
    const res = await this.json<{
      hits: { total: { value: number } | number };
      aggregations?: {
        by_severity?: { buckets: { key: string; doc_count: number }[] };
      };
    }>("POST", "/wazuh-states-vulnerabilities-*/_search", body);
    const out: Record<string, number> = {};
    for (const b of res.aggregations?.by_severity?.buckets ?? []) out[b.key] = b.doc_count;
    return out;
  }

  /** Numero totale di documenti CVE nell'indice (sanity check). */
  async totalVulnDocs(): Promise<number> {
    const res = await this.json<{ count: number }>("GET", "/wazuh-states-vulnerabilities-*/_count");
    return res.count;
  }
}

export function createWazuhIndexerClient(cfg: WazuhIndexerConfig): WazuhIndexerClient | null {
  if (!cfg.url || !cfg.username || !cfg.password) return null;
  return new WazuhIndexerClient(cfg);
}

/**
 * Mappa un doc OpenSearch verso il formato persistito in wazuh_vuln.
 * Output compatibile con WazuhVulnerability dell'API manager (per riusare
 * replaceVulnsForAgent senza cambiare la firma).
 */
export function indexerDocToWazuhVuln(doc: IndexerVulnDoc): {
  cve: string;
  severity?: string;
  cvss2_score?: number;
  cvss3_score?: number;
  name?: string;
  version?: string;
  architecture?: string;
  status?: string;
  detection_time?: string;
  published?: string;
  updated?: string;
  condition?: string;
  title?: string;
  external_references?: string;
} {
  const v = doc.vulnerability ?? {};
  const p = doc.package ?? {};
  const cve = v.id ?? "";
  // CVSS: il campo `score.version` ci dice se è v2 o v3
  let cvss2: number | undefined;
  let cvss3: number | undefined;
  if (v.score?.version?.startsWith("3")) cvss3 = v.score.base;
  else if (v.score?.version?.startsWith("2")) cvss2 = v.score.base;
  return {
    cve,
    severity: v.severity,
    cvss2_score: cvss2,
    cvss3_score: cvss3,
    name: p.name,
    version: p.version,
    architecture: p.architecture,
    status: v.under_evaluation ? "PENDING" : "VALID",
    detection_time: v.detected_at,
    published: v.published_at,
    updated: v.updated_at,
    condition: v.scanner?.condition,
    title: v.description ? v.description.slice(0, 240) : undefined,
    external_references: v.reference,
  };
}

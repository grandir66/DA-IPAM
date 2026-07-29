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
import { getSharedAgent } from "./http-pool";
import {
  buildAlertsQuery,
  normalizeAlert,
  type NormalizedAlert,
  type SelfIdentity,
  type WazuhAlertDoc,
} from "./wazuh-alerts";
import {
  buildStatsQuery,
  parseStatsResponse,
  type AlertStats,
} from "./wazuh-alerts-stats";

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
    // v0.2.642 audit perf MC8: agent condiviso (vedi http-pool.ts).
    this.agent = getSharedAgent("https", cfg.verifyTls) as https.Agent;
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

  /**
   * Test connessione + ritorna stato cluster. `numberOfNodes` e
   * `initializingShards` (fix cruscotto salute, blocco indexer: cluster
   * yellow a nodo singolo) servono a `classifyIndexer` per distinguere un
   * giallo strutturale (repliche non assegnabili su un solo nodo) da un
   * giallo vero su un cluster multi-nodo — non aggiungono chiamate, sono già
   * nella risposta di `_cluster/health`. Firma retrocompatibile: i chiamanti
   * esistenti (route di test, `modules/health.ts`) che leggono solo
   * `status`/`clusterName` non sono affetti.
   */
  async ping(): Promise<{
    clusterName?: string;
    status?: string;
    numberOfNodes?: number;
    initializingShards?: number;
  }> {
    const res = await this.json<{
      cluster_name?: string;
      status?: string;
      number_of_nodes?: number;
      initializing_shards?: number;
    }>("GET", "/_cluster/health");
    return {
      clusterName: res.cluster_name,
      status: res.status,
      numberOfNodes: res.number_of_nodes,
      initializingShards: res.initializing_shards,
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

  /**
   * Legge gli alert di sicurezza selezionati da `wazuh-alerts-*` a partire da
   * `since` (ISO). Paginazione search_after, cap su `maxRows` per non tirare
   * dentro milioni di documenti: l'indice reale misurato supera i 390M doc.
   *
   * Ritorna anche il cursore dell'ultimo documento, da persistere per il poll
   * successivo ed evitare di rileggere la stessa finestra.
   */
  async searchAlerts(args: {
    since: string;
    minLevel?: number;
    maxRows?: number;
    searchAfter?: unknown[];
    self?: SelfIdentity;
    deviceRuleIds?: string[];
  }): Promise<{ alerts: NormalizedAlert[]; nextCursor: unknown[] | null }> {
    const maxRows = args.maxRows ?? 2_000;
    const pageSize = Math.min(500, maxRows);
    const out: NormalizedAlert[] = [];
    let searchAfter = args.searchAfter;
    let nextCursor: unknown[] | null = null;

    while (out.length < maxRows) {
      const body = buildAlertsQuery({
        since: args.since,
        minLevel: args.minLevel,
        size: Math.min(pageSize, maxRows - out.length),
        searchAfter,
        extraRuleIds: args.deviceRuleIds,
      });
      const res = await this.json<IndexerSearchResponse<WazuhAlertDoc>>(
        "POST",
        "/wazuh-alerts-*/_search",
        body as unknown as Record<string, unknown>,
      );
      const hits = res.hits?.hits ?? [];
      if (hits.length === 0) break;
      for (const h of hits)
        out.push(normalizeAlert(h._source, h._id, args.self, args.deviceRuleIds));

      const last = hits[hits.length - 1] as IndexerHit<WazuhAlertDoc> & {
        sort?: unknown[];
      };
      if (!last?.sort || !Array.isArray(last.sort)) break;
      nextCursor = last.sort;
      searchAfter = last.sort;
      if (hits.length < body.size) break;
    }
    return { alerts: out, nextCursor };
  }

  /**
   * Distribuzione temporale e composizione degli alert selezionati.
   * Aggregazione pura (size 0): non scarica documenti.
   */
  async alertStats(args: {
    since: string;
    interval: string;
    excludeAccounts?: string[];
    excludeIps?: string[];
    system?: string;
    extraRuleIds?: string[];
  }): Promise<AlertStats> {
    const body = buildStatsQuery(args);
    const res = await this.json<Record<string, unknown>>(
      "POST",
      "/wazuh-alerts-*/_search",
      body as unknown as Record<string, unknown>,
    );
    return parseStatsResponse(res);
  }

  /**
   * `@timestamp` del documento più recente in `wazuh-alerts-*` (cruscotto
   * salute, blocco ingestione — misura Wazuh stesso, non la tabella locale
   * DA-IPAM: vedi brief fix-misure Difetto 2). Aggregazione `max` con
   * `size: 0`: nessun documento scaricato, costo minimo anche sull'indice
   * reale (>390M doc). Si legge `value` (epoch millis), non
   * `value_as_string`, per non dipendere da un parametro `format`
   * sull'aggregazione. `null` = indice raggiungibile ma senza alcun
   * documento (fresh install). Una ricerca su pattern wildcard
   * (`wazuh-alerts-*`) senza indici corrispondenti risponde normalmente 200
   * con l'aggregazione a `null`, non 404: il ramo 404 sotto è una difesa in
   * più per varianti di OpenSearch/Elasticsearch meno comuni che lo
   * restituissero comunque, non il percorso atteso. Qualsiasi altro errore
   * di rete/HTTP lancia, e il chiamante (wazuh-health.ts) decide come
   * trattarlo senza inventare un verdetto "ok".
   */
  async getLatestAlertTimestamp(): Promise<string | null> {
    try {
      const res = await this.json<{
        aggregations?: { latest?: { value?: number | null } };
      }>("POST", "/wazuh-alerts-*/_search", {
        size: 0,
        aggs: { latest: { max: { field: "@timestamp" } } },
      });
      const value = res.aggregations?.latest?.value;
      return typeof value === "number" && Number.isFinite(value) ? new Date(value).toISOString() : null;
    } catch (e) {
      if (e instanceof Error && /HTTP 404\b/.test(e.message)) return null;
      throw e;
    }
  }

  /** Numero totale di documenti CVE nell'indice (sanity check). */
  async totalVulnDocs(): Promise<number> {
    const res = await this.json<{ count: number }>("GET", "/wazuh-states-vulnerabilities-*/_count");
    return res.count;
  }

  /**
   * Spazio disco per nodo (cruscotto salute, blocco indexer). Verificato
   * contro l'API reale (192.168.4.19): `_cat/allocation?format=json` ritorna
   * righe con chiave letterale `"disk.percent"` (stringa, es. "53", o `null`
   * per lo pseudo-nodo "UNASSIGNED" che rappresenta shard non assegnate — non
   * un nodo fisico, escluso dal risultato).
   */
  async getNodesDiskUsage(): Promise<Array<{ node: string; diskPercent: number | null }>> {
    try {
      const rows = await this.json<Array<Record<string, string | null>>>(
        "GET",
        "/_cat/allocation?format=json",
      );
      return rows
        .filter((r) => r.node && r.node !== "UNASSIGNED")
        .map((r) => {
          const raw = r["disk.percent"];
          const n = raw !== null && raw !== undefined && raw !== "" ? Number(raw) : NaN;
          return { node: r.node ?? "", diskPercent: Number.isFinite(n) ? n : null };
        });
    } catch (e) {
      if (e instanceof Error && /HTTP 404\b/.test(e.message)) return [];
      throw e;
    }
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

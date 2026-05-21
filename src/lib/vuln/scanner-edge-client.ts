/**
 * Client HTTP per lo scanner-edge (DA-Vul-can).
 *
 * Single-tenant singleton: DA-IPAM ha al massimo un edge configurato.
 * Bearer token cifrato AES-GCM nella tabella `vuln_scanners.token_encrypted`,
 * decifrato server-side a ogni chiamata (`safeDecrypt`).
 *
 * Tutte le funzioni gettano `EdgeClientError` su errori di rete o status
 * non-2xx, mai dati parziali. Il chiamante decide se loggare o silenziare.
 */

import { safeDecrypt } from "@/lib/crypto";

export interface VulnScannerRow {
  id: number;
  name: string;
  base_url: string;
  token_encrypted: string;
  enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
}

export class EdgeClientError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "EdgeClientError";
  }
}

export interface EdgeHealth {
  ok: boolean;
  version: string;
  scanner_id: string;
  sealed_mode: boolean;
}

export interface EdgeScan {
  id: number;
  network_id: number | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  finding_count: number;
}

export interface EdgeFinding {
  id: number;
  scan_id: number;
  ip: string;
  mac: string | null;
  hostname: string | null;
  port: string | null;
  service: string | null;
  cve_id: string | null;
  cvss_score: number | null;
  cvss_vector: string | null;
  severity: string;
  nvt_oid: string | null;
  nvt_name: string | null;
  description: string | null;
  scanned_at: string;
  network_id: number | null;
}

export interface EdgeCvePage {
  items: EdgeFinding[];
  next_offset: number | null;
  limit: number;
}

function resolveToken(scanner: Pick<VulnScannerRow, "token_encrypted">): string {
  const t = safeDecrypt(scanner.token_encrypted);
  if (!t) {
    throw new EdgeClientError(500, "token cifrato non decifrabile (ENCRYPTION_KEY cambiata?)");
  }
  return t;
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/$/, "") + path;
}

async function edgeFetch<T>(
  scanner: Pick<VulnScannerRow, "base_url" | "token_encrypted">,
  path: string,
  init: RequestInit = {},
  opts: { skipAuth?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!opts.skipAuth) {
    headers.set("Authorization", `Bearer ${resolveToken(scanner)}`);
  }
  headers.set("Accept", "application/json");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);

  try {
    const res = await fetch(joinUrl(scanner.base_url, path), {
      ...init,
      headers,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        // ignore
      }
      throw new EdgeClientError(res.status, `edge ${res.status}: ${detail || res.statusText}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof EdgeClientError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new EdgeClientError(0, `network: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

/** GET /api/v1/health — pubblico, nessuna auth. */
export async function pingEdge(
  baseUrl: string,
  token: string,
): Promise<EdgeHealth> {
  // Health endpoint pubblico, ma includiamo bearer per testare anche il
  // path autenticato — se health rifiuta auth la chiamata segue comunque.
  // In realtà /health ignora auth → usiamo skipAuth per non confondere.
  const fake: Pick<VulnScannerRow, "base_url" | "token_encrypted"> = {
    base_url: baseUrl,
    token_encrypted: "", // non usato (skipAuth)
  };
  const health = await edgeFetch<EdgeHealth>(
    fake,
    "/api/v1/health",
    {},
    { skipAuth: true, timeoutMs: 8000 },
  );
  // Verifica auth: chiama un endpoint protetto (networks) per validare il token.
  // Se networks ritorna 401/404 il token è invalido o l'integrazione è off.
  const fake2: Pick<VulnScannerRow, "base_url" | "token_encrypted"> = {
    base_url: baseUrl,
    token_encrypted: "",
  };
  await edgeFetchWithRawToken(fake2, "/api/v1/networks", token);
  return health;
}

async function edgeFetchWithRawToken(
  fake: Pick<VulnScannerRow, "base_url">,
  path: string,
  rawToken: string,
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(joinUrl(fake.base_url, path), {
      headers: {
        Authorization: `Bearer ${rawToken}`,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new EdgeClientError(res.status, `edge ${res.status} su ${path}`);
    }
    return await res.json();
  } catch (e) {
    if (e instanceof EdgeClientError) throw e;
    throw new EdgeClientError(0, (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export async function listScans(
  scanner: VulnScannerRow,
  since?: string,
): Promise<EdgeScan[]> {
  const q = since ? `?since=${encodeURIComponent(since)}` : "";
  return edgeFetch<EdgeScan[]>(scanner, `/api/v1/scans${q}`);
}

export async function pullFindings(
  scanner: VulnScannerRow,
  opts: { since?: string; offset?: number; limit?: number } = {},
): Promise<EdgeCvePage> {
  const params = new URLSearchParams();
  if (opts.since) params.set("since", opts.since);
  params.set("offset", String(opts.offset ?? 0));
  params.set("limit", String(opts.limit ?? 1000));
  return edgeFetch<EdgeCvePage>(
    scanner,
    `/api/v1/cve?${params.toString()}`,
    {},
    { timeoutMs: 30000 },
  );
}

/**
 * Verifica produzione: rifiuta base_url non HTTPS a meno che l'env
 * `ALLOW_INSECURE_EDGE` sia esplicitamente "1" (dev/LAN testing).
 */
export function validateBaseUrl(baseUrl: string): { ok: true } | { ok: false; error: string } {
  const trimmed = baseUrl.trim();
  if (!trimmed) return { ok: false, error: "URL vuoto" };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: "URL malformato" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    return { ok: false, error: "Protocollo deve essere http o https" };
  }
  if (u.protocol === "http:" && process.env.ALLOW_INSECURE_EDGE !== "1") {
    return {
      ok: false,
      error: "HTTPS richiesto in produzione (set ALLOW_INSECURE_EDGE=1 per dev/LAN)",
    };
  }
  return { ok: true };
}

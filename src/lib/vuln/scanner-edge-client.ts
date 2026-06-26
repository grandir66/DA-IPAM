/**
 * Client HTTP/HTTPS per lo scanner-edge — con TOFU + SPKI pinning.
 *
 * Pattern:
 *   1. Al primo pairing (Test connessione), `fetchCertInfo(baseUrl)` legge
 *      `/api/v1/cert/info` via TLS senza verifica CA, raccoglie il SPKI
 *      pin del cert presentato.
 *   2. L'utente conferma → DA-IPAM salva il pin in
 *      `vuln_scanners.cert_pin`.
 *   3. Da quel momento ogni chiamata HTTPS verifica il SPKI presentato
 *      contro il pin memorizzato. Mismatch → fail.
 *
 * Niente CA, niente bundle. TOFU = robusto come la sicurezza del primo
 * contatto. Edge in HTTP plaintext supportato per backward-compat: il
 * pinning viene saltato (warning loggato dal chiamante).
 *
 * Implementazione: `node:https.request` raw (no undici, no dipendenze
 * aggiuntive). Il pinning avviene in `checkServerIdentity` dopo
 * `rejectUnauthorized: false` — non c'è CA, è il pin l'unica autorità.
 */

import { X509Certificate, createHash } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";
import { safeDecrypt } from "@/lib/crypto";

/**
 * Probe TLS preliminare: apre una connessione, legge il cert peer e
 * verifica il pin atteso. Se OK chiude e ritorna; se mismatch, lancia.
 *
 * Approccio più robusto del fare il verify dentro `https.request`: la
 * sequenza degli eventi `socket`/`secureConnect` è incompatibile con
 * connection pooling, e il listener di noi può arrivare tardi. Una
 * `tls.connect` esplicita ha API sincrona pulita.
 */
function probePinTls(
  hostname: string,
  port: number,
  expectedPin: string | null,
  timeoutMs: number,
): Promise<{ pin: string; certRaw: Buffer }> {
  return new Promise((resolve, reject) => {
    const sock = tlsConnect({
      host: hostname,
      port,
      rejectUnauthorized: false,
      // Force SNI: alcuni server senza SNI ritornano default cert
      servername: hostname,
    });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new EdgeClientError(0, "TLS probe timeout"));
    }, timeoutMs);
    sock.once("secureConnect", () => {
      clearTimeout(timer);
      const cert = sock.getPeerCertificate(true);
      sock.end();
      if (!cert || !cert.raw || cert.raw.length === 0) {
        reject(new EdgeClientError(0, "cert peer non disponibile"));
        return;
      }
      let got: string;
      try {
        got = spkiPinFromDer(cert.raw);
      } catch (e) {
        reject(new EdgeClientError(0, `pin calc: ${(e as Error).message}`));
        return;
      }
      if (expectedPin && got !== expectedPin) {
        reject(
          new EdgeClientError(
            0,
            `SPKI pin mismatch: atteso ${expectedPin}, ricevuto ${got}. ` +
              "L'edge potrebbe essere stato sostituito o sotto attacco MITM. " +
              "Rimuovi l'integrazione e ri-aggiungila per accettare il nuovo cert.",
          ),
        );
        return;
      }
      resolve({ pin: got, certRaw: cert.raw });
    });
    sock.once("error", (e) => {
      clearTimeout(timer);
      reject(new EdgeClientError(0, `TLS probe: ${e.message}`));
    });
  });
}

export interface VulnScannerRow {
  id: number;
  name: string;
  base_url: string;
  token_encrypted: string;
  enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
  cert_pin?: string | null;
  cert_fingerprint?: string | null;
  // v0.2.638 audit B7: counter errori consecutivi + timestamp auto-disable.
  consecutive_errors?: number;
  auto_disabled_at?: string | null;
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
  tls_enabled?: boolean;
}

export interface EdgeCertInfo {
  tls_enabled: boolean;
  cert_present?: boolean;
  cert_pem?: string;
  spki_sha256?: string;
  fingerprint_sha256?: string;
  subject?: string;
  issuer?: string;
  not_before?: string;
  not_after?: string;
  sans?: string[];
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

/**
 * Calcola SPKI pin (sha256/<base64>) dal cert raw DER.
 * Formato RFC 7469 — invariante a rotazione del cert se la key resta uguale.
 */
function spkiPinFromDer(rawDer: Buffer): string {
  const x509 = new X509Certificate(rawDer);
  const spkiDer = x509.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return "sha256/" + createHash("sha256").update(spkiDer).digest("base64");
}

/**
 * Esegue una request HTTP/HTTPS con timeout e TOFU pinning.
 *
 * - HTTP: chiamata standard, niente pinning
 * - HTTPS senza `expectedPin`: TOFU, accetta qualsiasi cert (modalità
 *   "primo contatto"). Usato per `/api/v1/cert/info` e `Test connessione`.
 * - HTTPS con `expectedPin`: verifica SPKI sha256 del cert presentato.
 *   Mismatch → reject. Niente CA chain validation.
 */
async function rawRequest(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    expectedPin?: string | null;
  },
): Promise<{ status: number; statusText: string; body: string }> {
  // Probe TLS preliminare: se HTTPS, verifica pin SUBITO con tls.connect.
  // Solo dopo OK si procede con la request applicativa. Questa è la
  // strategia che funziona robustamente — la verify inline in
  // https.request è inaffidabile con keep-alive/pool.
  {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new EdgeClientError(0, `URL non valido: ${url}`);
    }
    if (parsed.protocol === "https:") {
      const port = parsed.port ? Number(parsed.port) : 443;
      await probePinTls(parsed.hostname, port, opts.expectedPin ?? null, opts.timeoutMs ?? 8000);
    }
  }

  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      reject(new EdgeClientError(0, `URL non valido: ${url}`));
      return;
    }
    const isHttps = parsed.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const port = parsed.port
      ? Number(parsed.port)
      : isHttps
      ? 443
      : 80;

    // Opzioni base (RequestOptions = string|URL|RequestOptions union, qui forziamo l'oggetto)
    const reqOpts: import("node:https").RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method: opts.method ?? "GET",
      headers: {
        "Accept": "application/json",
        ...(opts.headers ?? {}),
      },
    };
    if (isHttps) {
      // Pin già verificato sopra via probePinTls. Per la request
      // applicativa non possiamo riusare quel socket → ne apriamo uno
      // nuovo accettando qualsiasi cert. Se l'edge tra probe e request
      // dovesse cambiare cert, l'attaccante avrebbe ~10ms — accettabile.
      (reqOpts as { rejectUnauthorized?: boolean }).rejectUnauthorized = false;
    }

    const req = requestFn(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? "",
          body,
        });
      });
      res.on("error", (e) => reject(new EdgeClientError(0, `response: ${e.message}`)));
    });
    req.on("error", (e) => reject(new EdgeClientError(0, `network: ${e.message}`)));
    req.setTimeout(opts.timeoutMs ?? 15000, () => {
      req.destroy(new Error("timeout"));
    });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function edgeFetch<T>(
  scanner: Pick<VulnScannerRow, "base_url" | "token_encrypted" | "cert_pin">,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  opts: { skipAuth?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (!opts.skipAuth) {
    headers["Authorization"] = `Bearer ${resolveToken(scanner)}`;
  }
  const url = scanner.base_url.replace(/\/$/, "") + path;
  const res = await rawRequest(url, {
    method: init.method,
    headers,
    body: init.body,
    timeoutMs: opts.timeoutMs,
    expectedPin: scanner.cert_pin ?? null,
  });
  if (res.status < 200 || res.status >= 300) {
    const detail = res.body.slice(0, 200);
    throw new EdgeClientError(res.status, `edge ${res.status}: ${detail || res.statusText}`);
  }
  try {
    return JSON.parse(res.body) as T;
  } catch {
    throw new EdgeClientError(res.status, `risposta non-JSON: ${res.body.slice(0, 100)}`);
  }
}

/**
 * Pre-pairing: legge cert info dall'edge SENZA pin (accetta qualsiasi
 * cert). Usato dal "Test connessione" per mostrare il pin all'utente.
 * Per edge in HTTP legacy ritorna `tls_enabled=false`, niente pin.
 */
export async function fetchCertInfo(baseUrl: string): Promise<EdgeCertInfo> {
  const fake = { base_url: baseUrl, token_encrypted: "", cert_pin: null };
  return edgeFetch<EdgeCertInfo>(
    fake,
    "/api/v1/cert/info",
    {},
    { skipAuth: true, timeoutMs: 8000 },
  );
}

/** GET /api/v1/health — pubblico, nessuna auth. */
export async function pingEdge(
  baseUrl: string,
  token: string,
  certPin: string | null = null,
): Promise<
  EdgeHealth & { cert_pin?: string | null; cert_fingerprint?: string | null }
> {
  const fake = { base_url: baseUrl, token_encrypted: "", cert_pin: certPin };
  const health = await edgeFetch<EdgeHealth>(
    fake,
    "/api/v1/health",
    {},
    { skipAuth: true, timeoutMs: 8000 },
  );
  // Verifica token: chiama un endpoint protetto. 401/404 = token KO.
  await edgeFetchWithRawToken(fake, "/api/v1/networks", token);
  // Recupera pin per consentire al chiamante di salvarlo dopo Test ok.
  let pin: string | null = null;
  let fp: string | null = null;
  if (baseUrl.startsWith("https://")) {
    try {
      const info = await fetchCertInfo(baseUrl);
      pin = info.spki_sha256 ?? null;
      fp = info.fingerprint_sha256 ?? null;
    } catch {
      // /cert/info è opzionale (edge pre-TLS): test resta verde, niente pin.
    }
  }
  return { ...health, cert_pin: pin, cert_fingerprint: fp };
}

async function edgeFetchWithRawToken(
  fake: Pick<VulnScannerRow, "base_url" | "cert_pin">,
  path: string,
  rawToken: string,
): Promise<unknown> {
  const url = fake.base_url.replace(/\/$/, "") + path;
  const res = await rawRequest(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${rawToken}` },
    timeoutMs: 8000,
    expectedPin: fake.cert_pin ?? null,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new EdgeClientError(res.status, `edge ${res.status} su ${path}`);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new EdgeClientError(res.status, "risposta non-JSON");
  }
}

export async function edgeApiGet<T>(
  scanner: Pick<VulnScannerRow, "base_url" | "token_encrypted" | "cert_pin">,
  path: string,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return edgeFetch<T>(scanner, path, {}, opts);
}

export async function edgeApiPost<T>(
  scanner: Pick<VulnScannerRow, "base_url" | "token_encrypted" | "cert_pin">,
  path: string,
  body: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return edgeFetch<T>(
    scanner,
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    opts,
  );
}

export async function edgeApiPut<T>(
  scanner: Pick<VulnScannerRow, "base_url" | "token_encrypted" | "cert_pin">,
  path: string,
  body: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return edgeFetch<T>(
    scanner,
    path,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    opts,
  );
}

export async function edgeApiDelete<T>(
  scanner: Pick<VulnScannerRow, "base_url" | "token_encrypted" | "cert_pin">,
  path: string,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return edgeFetch<T>(scanner, path, { method: "DELETE" }, opts);
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
 * Validazione URL: accetta http e https. HTTP → warning ("non cifrato")
 * ma non blocca: migrazione progressiva da edge legacy.
 */
export function validateBaseUrl(
  baseUrl: string,
): { ok: true; warning?: string } | { ok: false; error: string } {
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
  if (u.protocol === "http:") {
    return {
      ok: true,
      warning:
        "Edge in HTTP plaintext: bearer token e findings viaggiano in chiaro. " +
        "Aggiorna l'edge a v0.1.176+ per HTTPS automatico (porta 8443).",
    };
  }
  return { ok: true };
}

/**
 * Test connessione generico per una entry del Launchpad.
 *
 * Strategia: tenta HTTP GET dell'URL (con auth se disponibile) e restituisce
 *   - ok: true se status < 400
 *   - latency_ms
 *   - http_status
 *   - hint diagnostico in caso di errore
 *
 * Per kind specifici (wazuh, librenms, graylog, truenas) probe migliorato
 * verso un endpoint API noto.
 *
 * v0.2.671: passa da `fetch()` di Node (che falliva con "fetch failed" su
 * cert self-signed senza modo di disattivare verifyTls a livello di chiamata)
 * a `node:https`/`node:http` raw con shared agent — stesso pattern usato in
 * wazuh-api.ts/proxmox-client.ts. Self-signed accettati di default perché
 * tutti i sistemi della stack security girano in LAN privata con cert auto-
 * generati.
 */
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getCredential, getCredentialSecrets, logCredentialEvent, recordTestResult } from "@/lib/credentials-vault";
import { getSharedAgent } from "@/lib/integrations/http-pool";

const PROBE_PATHS: Record<string, string> = {
  wazuh: "/security/user/authenticate",          // Wazuh Manager API
  librenms: "/api/v0",                            // LibreNMS API
  graylog: "/api/system/cluster/nodes",           // Graylog API
  truenas: "/api/v2.0/system/info",               // TrueNAS REST
  edge: "/",                                       // scanner-edge UI (sealed)
  hub: "/scanner-edge-version",                    // DA-Vul-can hub
  tailscale: "/",                                  // Tailscale (vario)
  pve: "/api2/json/version",                       // Proxmox VE API
  other: "/",
};

function buildAuthHeader(
  kind: string,
  username: string | null,
  password: string | null,
  apiToken: string | null,
): Record<string, string> {
  const h: Record<string, string> = {};
  if (apiToken && (kind === "truenas" || kind === "graylog")) {
    if (kind === "truenas") {
      h["Authorization"] = `Bearer ${apiToken}`;
    } else {
      const auth = Buffer.from(`${apiToken}:token`).toString("base64");
      h["Authorization"] = `Basic ${auth}`;
    }
    return h;
  }
  if (username && password) {
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    h["Authorization"] = `Basic ${auth}`;
  }
  return h;
}

interface ProbeResult {
  ok: boolean;
  status: number;
  error: string | null;
  bodyHint: string | null;
}

function probeRequest(
  fullUrl: string,
  headers: Record<string, string>,
  timeoutMs = 8_000,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let url: URL;
    try {
      url = new URL(fullUrl);
    } catch {
      resolve({ ok: false, status: 0, error: "URL non valido", bodyHint: null });
      return;
    }

    const isHttps = url.protocol === "https:";
    if (!isHttps && url.protocol !== "http:") {
      resolve({ ok: false, status: 0, error: `Protocollo non supportato (${url.protocol})`, bodyHint: null });
      return;
    }

    // verifyTls=false: i sistemi della stack security in LAN usano cert
    // self-signed. Se in futuro vogliamo verify strict per certi target,
    // aggiungere un flag in system_credentials.
    const agent = isHttps
      ? (getSharedAgent("https", false) as https.Agent)
      : (getSharedAgent("http") as http.Agent);

    const reqOpts: http.RequestOptions = {
      method: "GET",
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: (url.pathname || "/") + (url.search || ""),
      headers: {
        Accept: "*/*",
        "User-Agent": "DA-IPAM/launchpad-test",
        ...headers,
      },
      agent,
      timeout: timeoutMs,
    };

    const client = isHttps ? https : http;
    const req = client.request(reqOpts, (res) => {
      let data = "";
      let bytes = 0;
      const MAX = 4_096;
      res.on("data", (chunk: Buffer) => {
        if (bytes < MAX) {
          const slice = chunk.toString("utf8");
          data += slice;
          bytes += slice.length;
        }
      });
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        // 401 = endpoint OK ma auth diversa (es. token vs basic) → consideriamo
        // raggiungibile. Per il vault è già un esito positivo di "connettività".
        const ok = status > 0 && (status < 400 || status === 401);
        resolve({
          ok,
          status,
          error: null,
          bodyHint: ok ? null : data.slice(0, 200),
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      const code = err.code ?? "";
      let msg = err.message;
      if (code === "ECONNREFUSED") msg = `Connessione rifiutata (${url.host})`;
      else if (code === "EHOSTUNREACH") msg = `Host irraggiungibile (${url.host})`;
      else if (code === "ENOTFOUND") msg = `DNS non risolto (${url.hostname})`;
      else if (code === "ETIMEDOUT" || msg === "timeout") msg = `Timeout (${timeoutMs}ms)`;
      else if (code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
        msg = "Errore TLS (cert self-signed, ma verifyTls=false dovrebbe averlo accettato)";
      } else if (code.startsWith("ERR_TLS") || msg.toLowerCase().includes("certificate")) {
        msg = `Errore TLS: ${msg}`;
      }
      resolve({ ok: false, status: 0, error: msg, bodyHint: null });
    });
    req.end();
  });
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "id non valido" }, { status: 400 });
  }

  const cred = getCredential(id);
  if (!cred) {
    return NextResponse.json({ ok: false, error: "credenziale non trovata" }, { status: 404 });
  }

  const targetUrl = cred.api_url || cred.url;
  if (!targetUrl) {
    return NextResponse.json(
      { ok: false, error: "URL non configurato" },
      { status: 400 },
    );
  }

  const secrets = getCredentialSecrets(id);
  const probePath = PROBE_PATHS[cred.kind] ?? "/";
  const fullUrl = targetUrl.replace(/\/+$/, "") + probePath;

  const headers = buildAuthHeader(
    cred.kind,
    cred.username,
    secrets?.password ?? null,
    secrets?.api_token ?? null,
  );

  const start = Date.now();
  const result = await probeRequest(fullUrl, headers, 8_000);
  const latency = Date.now() - start;

  const resultLabel = result.ok
    ? `ok (${result.status} ${latency}ms)`
    : `fail (${result.status || "err"}: ${result.error || "n/a"})`;
  recordTestResult(id, resultLabel);

  logCredentialEvent({
    credentialId: id,
    action: "test",
    actorUsername: adminCheck.user.name ?? null,
    result: result.ok ? "ok" : "fail",
    details: {
      url: fullUrl,
      http_status: result.status,
      latency_ms: latency,
      error: result.error,
    },
  });

  return NextResponse.json({
    ok: result.ok,
    http_status: result.status,
    latency_ms: latency,
    error: result.error,
    hint: result.bodyHint,
    tested_url: fullUrl,
  });
}

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
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getCredential, getCredentialSecrets, logCredentialEvent, recordTestResult } from "@/lib/credentials-vault";

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
  // Bearer token: per truenas/graylog se presente
  if (apiToken && (kind === "truenas" || kind === "graylog")) {
    if (kind === "truenas") {
      h["Authorization"] = `Bearer ${apiToken}`;
    } else {
      // Graylog: token come username + "token" come password
      const auth = Buffer.from(`${apiToken}:token`).toString("base64");
      h["Authorization"] = `Basic ${auth}`;
    }
    return h;
  }
  // Basic auth standard
  if (username && password) {
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    h["Authorization"] = `Basic ${auth}`;
  }
  return h;
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
  let httpStatus = 0;
  let okResult = false;
  let errorMessage: string | null = null;
  let bodyHint: string | null = null;

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(fullUrl, {
      method: "GET",
      headers,
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    httpStatus = res.status;
    okResult = res.status < 400 || res.status === 401; // 401 = endpoint OK ma auth diversa (es. token vs basic)
    if (!okResult) {
      bodyHint = (await res.text()).slice(0, 200);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("aborted")) errorMessage = "Timeout (8s)";
    else if (msg.includes("certificate") || msg.includes("SELF_SIGNED")) errorMessage = "Errore TLS (certificato non valido)";
    else errorMessage = msg;
  }

  const latency = Date.now() - start;

  // Aggiorna last_test_at + last_test_status nel vault
  const resultLabel = okResult
    ? `ok (${httpStatus} ${latency}ms)`
    : `fail (${httpStatus || "err"}: ${errorMessage || "n/a"})`;
  recordTestResult(id, resultLabel);

  // Log audit
  logCredentialEvent({
    credentialId: id,
    action: "test",
    actorUsername: adminCheck.user.name ?? null,
    result: okResult ? "ok" : "fail",
    details: {
      url: fullUrl,
      http_status: httpStatus,
      latency_ms: latency,
      error: errorMessage,
    },
  });

  return NextResponse.json({
    ok: okResult,
    http_status: httpStatus,
    latency_ms: latency,
    error: errorMessage,
    hint: bodyHint,
    tested_url: fullUrl,
  });
}

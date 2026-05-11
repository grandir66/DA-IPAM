import { NextResponse } from "next/server";
import { getTenantById } from "@/lib/db-hub";
import { safeDecrypt } from "@/lib/crypto";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

interface TestSuccessResponse {
  ok: true;
  latency_ms: number;
  label: string;
  scopes: string[];
  tenant_code: string;
}

interface TestErrorResponse {
  ok: false;
  latency_ms: number;
  error_code: string;
  error_message: string;
  status?: number;
  retriable?: boolean;
}

type AgentErrorBody = {
  error?: {
    code?: string;
    message?: string;
    retriable?: boolean;
  };
};

type WhoamiBody = {
  label?: string;
  scopes?: string[];
  tenant_code?: string;
};

const TEST_TIMEOUT_MS = 5_000;

/**
 * Testa la raggiungibilità dell'agente remoto del tenant:
 *   1. decifra il bearer token salvato (agent_token_encrypted)
 *   2. chiama HTTP GET <hostname>:<port>/whoami con timeout 5s
 *   3. ritorna esito strutturato (ok + latency, oppure error_code mappato)
 *
 * Non aggiorna persistenza: per l'overview /agents la chiamiamo live in parallelo.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { id } = await params;
    const tenant = getTenantById(Number(id));
    if (!tenant) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    if (tenant.agent_mode !== "remote") {
      const body: TestErrorResponse = {
        ok: false,
        latency_ms: 0,
        error_code: "not_remote",
        error_message: "Tenant in modalità local — non c'è agente remoto da testare.",
      };
      return NextResponse.json(body);
    }
    if (!tenant.agent_hostname) {
      const body: TestErrorResponse = {
        ok: false,
        latency_ms: 0,
        error_code: "no_hostname",
        error_message: "Hostname Tailscale dell'agente non configurato.",
      };
      return NextResponse.json(body);
    }
    if (!tenant.agent_token_encrypted) {
      const body: TestErrorResponse = {
        ok: false,
        latency_ms: 0,
        error_code: "no_token",
        error_message: "Token bearer non configurato. Genera un token e copialo sull'agente.",
      };
      return NextResponse.json(body);
    }

    const token = safeDecrypt(tenant.agent_token_encrypted);
    if (!token) {
      const body: TestErrorResponse = {
        ok: false,
        latency_ms: 0,
        error_code: "decrypt_failed",
        error_message: "Decifratura token fallita (ENCRYPTION_KEY cambiata?).",
      };
      return NextResponse.json(body);
    }

    const url = `http://${tenant.agent_hostname}:${tenant.agent_port}/whoami`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    const started = Date.now();

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const latency_ms = Date.now() - started;
      const body = (await res.json().catch(() => ({}))) as WhoamiBody & AgentErrorBody;

      if (!res.ok) {
        const errBody: TestErrorResponse = {
          ok: false,
          latency_ms,
          status: res.status,
          error_code: body?.error?.code ?? `http_${res.status}`,
          error_message: body?.error?.message ?? `HTTP ${res.status}`,
          retriable: body?.error?.retriable,
        };
        return NextResponse.json(errBody);
      }

      const okBody: TestSuccessResponse = {
        ok: true,
        latency_ms,
        label: typeof body.label === "string" ? body.label : "",
        scopes: Array.isArray(body.scopes) ? body.scopes : [],
        tenant_code: typeof body.tenant_code === "string" ? body.tenant_code : "",
      };
      return NextResponse.json(okBody);
    } catch (e: unknown) {
      const latency_ms = Date.now() - started;
      const err = e as { name?: string; message?: string };
      const isAbort = err?.name === "AbortError";
      const errBody: TestErrorResponse = {
        ok: false,
        latency_ms,
        error_code: isAbort ? "timeout" : "network_error",
        error_message: isAbort
          ? `Timeout dopo ${TEST_TIMEOUT_MS} ms — agente non raggiungibile via Tailscale?`
          : (err?.message ?? "Errore di rete generico"),
      };
      return NextResponse.json(errBody);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error("Errore nel test dell'agente:", error);
    return NextResponse.json({ error: "Errore interno nel test dell'agente" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getTenantAgentById } from "@/lib/db-hub";
import { safeDecrypt } from "@/lib/crypto";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

interface TestSuccess { ok: true; latency_ms: number; label: string; scopes: string[]; tenant_code: string }
interface TestError { ok: false; latency_ms: number; error_code: string; error_message: string; status?: number; retriable?: boolean }
type WhoamiBody = { label?: string; scopes?: string[]; tenant_code?: string };
type AgentErr = { error?: { code?: string; message?: string; retriable?: boolean } };

const TIMEOUT_MS = 5_000;

/**
 * POST /api/tenant-agents/[id]/test
 * Decrypta il token salvato per l'agente specifico e chiama /whoami sul
 * remoto via Tailscale. Ritorna risultato strutturato (ok/error_code/latency).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const agent = getTenantAgentById(Number(id));
    if (!agent) return NextResponse.json({ error: "Agente non trovato" }, { status: 404 });

    if (!agent.hostname) {
      return NextResponse.json({ ok: false, latency_ms: 0, error_code: "no_hostname", error_message: "Hostname agente non configurato" } as TestError);
    }
    if (!agent.token_encrypted) {
      return NextResponse.json({ ok: false, latency_ms: 0, error_code: "no_token", error_message: "Token non configurato. Genera o importa un token." } as TestError);
    }

    const token = safeDecrypt(agent.token_encrypted);
    if (!token) {
      return NextResponse.json({ ok: false, latency_ms: 0, error_code: "decrypt_failed", error_message: "Decifratura token fallita (ENCRYPTION_KEY cambiata?)" } as TestError);
    }

    const url = `http://${agent.hostname}:${agent.port}/whoami`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const started = Date.now();

    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      const latency_ms = Date.now() - started;
      const body = (await res.json().catch(() => ({}))) as WhoamiBody & AgentErr;
      if (!res.ok) {
        return NextResponse.json({
          ok: false, latency_ms, status: res.status,
          error_code: body?.error?.code ?? `http_${res.status}`,
          error_message: body?.error?.message ?? `HTTP ${res.status}`,
          retriable: body?.error?.retriable,
        } as TestError);
      }
      return NextResponse.json({
        ok: true, latency_ms,
        label: typeof body.label === "string" ? body.label : "",
        scopes: Array.isArray(body.scopes) ? body.scopes : [],
        tenant_code: typeof body.tenant_code === "string" ? body.tenant_code : "",
      } as TestSuccess);
    } catch (e: unknown) {
      const latency_ms = Date.now() - started;
      const err = e as { name?: string; message?: string };
      const isAbort = err?.name === "AbortError";
      return NextResponse.json({
        ok: false, latency_ms,
        error_code: isAbort ? "timeout" : "network_error",
        error_message: isAbort ? `Timeout dopo ${TIMEOUT_MS} ms — agent non raggiungibile?` : (err?.message ?? "errore di rete"),
      } as TestError);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("Errore test agente:", e);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}

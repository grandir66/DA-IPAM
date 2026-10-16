import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { PROBED_MODULE_KEYS, verificaAperturaModulo } from "@/lib/modules/health";
import type { ModuleKey } from "@/lib/modules/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Solo un'origine http(s) pulita (`https://nome[:porta]`), altrimenti null. */
function origineValida(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin === raw.replace(/\/+$/, "") ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * GET /api/modules/[key]/apertura?origine=https://nome — verifica «apertura per
 * il browser» (passo 4b, 16/10): per ogni interfaccia del modulo certificato
 * (fidato, nome, date, impronta SHA-256), dove porta la pagina e, per i
 * riquadri, se si lascia incorporare da `origine` (l'indirizzo con cui il
 * browser ha aperto DA-IPAM). Modulo spento → nessuna chiamata.
 *
 * Lettura senza segreti nella risposta (impronte e URL): basta la sessione.
 * Niente cache: si chiama dal pulsante «Verifica» o quando il riquadro resta vuoto.
 */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const session = await requireAuth();
  if (isAuthError(session)) return session;
  const { key } = await params;
  if (!PROBED_MODULE_KEYS.includes(key as ModuleKey)) {
    return NextResponse.json({ error: `Modulo sconosciuto: ${key}` }, { status: 400 });
  }
  const origine = origineValida(new URL(req.url).searchParams.get("origine"));
  return withTenantFromSession(async () => {
    const tenantCode = getCurrentTenantCode() ?? "DEFAULT";
    try {
      const apertura = await verificaAperturaModulo(tenantCode, key as ModuleKey, origine);
      return NextResponse.json({ ok: true, apertura }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      console.error("[modules/apertura]", e instanceof Error ? e.message : String(e));
      return NextResponse.json({ error: "Verifica dell'apertura non riuscita" }, { status: 500 });
    }
  });
}

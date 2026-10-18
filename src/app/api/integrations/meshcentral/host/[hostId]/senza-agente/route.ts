/**
 * POST /api/integrations/meshcentral/host/[hostId]/senza-agente  { protocollo: "rdp" | "vnc" }
 *
 * Desktop remoto senza agente (senza-agente.ts): prepara la sessione RDP o VNC
 * in MeshCentral verso l'IP dell'host e ritorna l'URL per l'iframe.
 * Mutazione/secret → requireAdmin. Token e cookie non sono mai salvati né
 * loggati; Referrer-Policy: no-referrer come per remote-session.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { guardiaMesh } from "@/lib/integrations/meshcentral/guardia";
import { prepareSessioneSenzaAgente } from "@/lib/integrations/meshcentral/senza-agente";

const bodySchema = z.object({
  protocollo: z.enum(["rdp", "vnc"]),
});

function parseHostId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  const { hostId: hostIdRaw } = await ctx.params;
  const hostId = parseHostId(hostIdRaw);
  if (hostId === null) {
    return NextResponse.json({ error: "hostId non valido" }, { status: 400 });
  }

  return withTenantFromSession(async () => {
    const auth = await requireAdmin();
    if (isAuthError(auth)) return auth;
    const spento = guardiaMesh();
    if (spento) return spento;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const res = await prepareSessioneSenzaAgente({
      hostId,
      protocollo: parsed.data.protocollo,
      operator: auth.user.email ?? "unknown",
    });
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    return NextResponse.json(
      { url: res.url },
      { status: 200, headers: { "Referrer-Policy": "no-referrer" } },
    );
  });
}

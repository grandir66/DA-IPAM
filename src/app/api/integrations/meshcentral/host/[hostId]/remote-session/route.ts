/**
 * POST /api/integrations/meshcentral/host/[hostId]/remote-session
 *
 * Launch-out: minta un login token effimero (3 min, single-use) per il service
 * account e ritorna il deep-link MeshCentral verso il nodo associato all'host.
 * Body opzionale: { viewmode?: 11|12|13 } (11=desktop default, 12=terminale, 13=file).
 *
 * Mutazione/secret → requireAdmin. Token e chiave NON vengono mai persistiti né
 * loggati (audit in mc_remote_session). Header Referrer-Policy: no-referrer (C7,
 * §10.8/§12) così il token in URL non trapela via Referer.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { prepareRemoteSession } from "@/lib/integrations/meshcentral/remote-session";

const bodySchema = z.object({
  viewmode: z.union([z.literal(11), z.literal(12), z.literal(13)]).optional(),
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

    // Body opzionale (può mancare del tutto se la UI non manda nulla).
    let body: unknown = {};
    try {
      const text = await req.text();
      if (text.trim()) body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const operator = auth.user.email ?? "unknown";
    const res = prepareRemoteSession({
      hostId,
      viewmode: parsed.data.viewmode ?? 11,
      operator,
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

/**
 * Test connessione scanner-edge: chiama /api/v1/health + /api/v1/networks
 * con il token fornito (non ancora salvato). Usato dalla UI prima del
 * "Salva" per validare URL+token in un colpo solo.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { pingEdge, validateBaseUrl, EdgeClientError } from "@/lib/vuln/scanner-edge-client";

const Schema = z.object({
  base_url: z.string().min(1),
  token: z.string().min(8),
});

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validazione fallita", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const urlCheck = validateBaseUrl(parsed.data.base_url);
  if (!urlCheck.ok) {
    return NextResponse.json({ error: urlCheck.error }, { status: 400 });
  }

  try {
    const health = await pingEdge(parsed.data.base_url, parsed.data.token);
    return NextResponse.json({ ok: true, health });
  } catch (e) {
    const status = e instanceof EdgeClientError ? e.status : 0;
    const message = (e as Error).message || "errore sconosciuto";
    return NextResponse.json(
      { ok: false, status, error: message },
      // 502 per problemi di rete/edge, 400 per validazione, 401 per token
      { status: status === 401 || status === 404 ? 400 : 502 },
    );
  }
}

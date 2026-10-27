/**
 * Corregge a mano la maschera di una rete vista dal sensore trunk (25/10): la deduzione
 * dai /24 può sbagliare, e prima di portare la rete in DA-IPAM la si sistema con un clic.
 * `prefisso: null` toglie la correzione.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { salvaCorrezioneMaschera } from "@/lib/trunk/sensore-trunk";

const Corpo = z.object({
  vid: z.number().int().min(0).max(4094),
  dedotta: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, "Rete non valida"),
  prefisso: z.number().int().min(16).max(30).nullable(),
});

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = Corpo.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validazione fallita", details: parsed.error.issues }, { status: 400 });
  }
  const { vid, dedotta, prefisso } = parsed.data;
  return withTenantFromSession(() => {
    salvaCorrezioneMaschera(vid, dedotta, prefisso);
    return NextResponse.json({ ok: true });
  });
}

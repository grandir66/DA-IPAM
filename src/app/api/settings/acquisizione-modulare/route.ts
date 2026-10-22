/**
 * Impostazione «Acquisizione modulare» (tavola C1, oggetto 14): la levetta sta in Opzioni (ADR 0032); questa rotta resta per chi la usa già.
 * tenant `acquisizione_modulare.attiva`, assente = spento. Lettura con la sessione, scrittura solo admin.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { acquisizioneModulareAccesa, impostaAcquisizioneModulare } from "@/lib/db-tenant";

const corpo = z.object({ acceso: z.boolean() }).strict();

export async function GET() {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return withTenantFromSession(() => NextResponse.json({ acceso: acquisizioneModulareAccesa() }));
}

export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  const body = await request.json().catch(() => null);
  const parsed = corpo.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  return withTenantFromSession(() => {
    impostaAcquisizioneModulare(parsed.data.acceso);
    return NextResponse.json({ acceso: acquisizioneModulareAccesa() });
  });
}

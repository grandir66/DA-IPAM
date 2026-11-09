/**
 * POST /api/devices/[id]/acquisizione/importa — importa l'estrazione del PC del tecnico (busta `da-ipam-estrazione` 1.0,
 * prompt in `src/lib/estrazione/prompt-tecnico.md`) nell'apparato: archivio, proiezioni, rotte. Solo admin, nel profilo
 * attivo. Logica in `src/lib/estrazione/importa.ts`.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { importaEstrazione } from "@/lib/estrazione/importa";

type RouteParams = { params: Promise<{ id: string }> };

/** Come il limite d'uscita dei collector (`max_output_bytes`, 4 MB). */
const MASSIMO_BYTE = 4 * 1024 * 1024;

export async function POST(request: Request, { params }: RouteParams) {
  const authCheck = await requireAdmin();
  if (isAuthError(authCheck)) return authCheck;
  const { id } = await params;
  const deviceId = Number(id);
  if (!Number.isInteger(deviceId) || deviceId <= 0) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
  const testo = await request.text();
  if (Buffer.byteLength(testo) > MASSIMO_BYTE) return NextResponse.json({ error: "Estrazione troppo grande (massimo 4 MB)" }, { status: 413 });
  let dato: unknown;
  try {
    dato = JSON.parse(testo);
  } catch {
    return NextResponse.json({ error: "Il file non è un JSON valido" }, { status: 400 });
  }
  const utente = authCheck.user as { id?: string | number; name?: string | null };
  const idUtente = utente.id != null && Number.isInteger(Number(utente.id)) ? Number(utente.id) : null;
  return withTenantFromSession(() => {
    const e = importaEstrazione(deviceId, dato, { id: idUtente, nome: utente.name ?? null });
    if (!e.ok) return NextResponse.json({ error: e.errore, dettagli: e.dettagli }, { status: e.status });
    return NextResponse.json(e);
  });
}

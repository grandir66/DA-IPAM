/**
 * POST /api/scans/lancia — tipo + profilo → motori già fatti (Discovery, sonde, matrice, trunk).
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { ErroreLancio, lanciaGiro, type LancioGiro } from "@/lib/scanner/lancia-giro";

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (isAuthError(admin)) return admin;
  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  if (!corpo || typeof corpo !== "object") {
    return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
  }
  return withTenantFromSession(async () => {
    try {
      const esito = await lanciaGiro(corpo as LancioGiro);
      return NextResponse.json(esito);
    } catch (e) {
      if (e instanceof ErroreLancio) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Avvio fallito" },
        { status: 500 },
      );
    }
  });
}

/**
 * Elenco degli indirizzi dell'ultimo passaggio di una finestra (05/11/2026), una pagina alla volta,
 * letto dalla sonda. `?stato=` filtra (da_fare, in_prova, finito, non_risponde, assente, non_finito),
 * `limit` da 1 a 1000, `offset` da 0.
 *
 * Risponde sempre 200 col suo `stato` («ok», «da_aggiornare», «errore»): il pannello dice quale.
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { leggiFinestraIp } from "@/lib/vuln/edge-subnet-bridge";
import { STATI_IP, type StatoIp } from "@/lib/vuln/finestra";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  return withTenantFromSession(async () => {
    const { id } = await params;
    const networkId = Number(id);
    if (!Number.isInteger(networkId) || networkId <= 0) {
      return NextResponse.json({ error: "ID rete non valido" }, { status: 400 });
    }
    const q = new URL(req.url).searchParams;

    const stato = q.get("stato");
    if (stato !== null && stato !== "" && !(STATI_IP as readonly string[]).includes(stato)) {
      return NextResponse.json({ error: `Stato sconosciuto: ${stato}` }, { status: 400 });
    }
    const numero = (nome: string, min: number, max: number, predefinito: number): number | null => {
      const v = q.get(nome);
      if (v === null || v === "") return predefinito;
      const n = Number(v);
      return Number.isInteger(n) && n >= min && n <= max ? n : null;
    };
    const limit = numero("limit", 1, 1000, 200);
    const offset = numero("offset", 0, 10_000_000, 0);
    if (limit === null) return NextResponse.json({ error: "limit deve essere da 1 a 1000" }, { status: 400 });
    if (offset === null) return NextResponse.json({ error: "offset non valido" }, { status: 400 });

    return NextResponse.json(await leggiFinestraIp(networkId, { stato: (stato || undefined) as StatoIp | undefined, limit, offset }));
  });
}

/**
 * Rilievi di sicurezza della rete osservata dal sensore trunk (25/10).
 * GET  → elenco a pagine (filtri: categoria, tipo, vid, q, daPrendere) + riepilogo;
 *        `?conteggio=1` → solo gli allarmi gravi da prendere in carico (numero del menu).
 * POST → prende in carico (o rimette da prendere) un rilievo.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  contaAllarmiAlti,
  getRiepilogoRilievi,
  getRilieviPaginated,
  prendiInCarico,
  TIPI_RILIEVO,
  type CategoriaRilievo,
  type TipoRilievo,
} from "@/lib/trunk/rilievi";

const CATEGORIE: CategoriaRilievo[] = ["allarme", "esposizione", "novita"];

export async function GET(request: Request) {
  const session = await requireAuth();
  if (session instanceof NextResponse) return session;
  return withTenantFromSession(() => {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("conteggio") === "1") return NextResponse.json({ allarmiAlti: contaAllarmiAlti() });
    const categoria = searchParams.get("categoria");
    const tipo = searchParams.get("tipo");
    const vidRaw = searchParams.get("vid");
    const { righe, totale } = getRilieviPaginated({
      categoria: CATEGORIE.includes(categoria as CategoriaRilievo) ? (categoria as CategoriaRilievo) : null,
      tipo: tipo && tipo in TIPI_RILIEVO ? (tipo as TipoRilievo) : null,
      vid: vidRaw != null && vidRaw !== "" && Number.isInteger(Number(vidRaw)) ? Number(vidRaw) : null,
      q: searchParams.get("q") ?? undefined,
      daPrendere: searchParams.get("daPrendere") === "1",
      limit: Number(searchParams.get("limit")) || 50,
      offset: Number(searchParams.get("offset")) || 0,
    });
    return NextResponse.json({ rilievi: righe, totale, riepilogo: getRiepilogoRilievi() });
  });
}

const Corpo = z.object({ id: z.number().int().positive(), preso: z.boolean() });

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
  const utente = session.user?.name ?? session.user?.email ?? "admin";
  return withTenantFromSession(() => {
    if (!prendiInCarico(parsed.data.id, parsed.data.preso, utente)) {
      return NextResponse.json({ error: "Rilievo non trovato" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, riepilogo: getRiepilogoRilievi() });
  });
}

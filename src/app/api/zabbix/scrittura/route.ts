/**
 * La chiave di **scrittura** del centro Zabbix (13/11/2026, tappa C di DATIA MONITORING).
 * Solo admin. La chiave entra una volta e non esce più: GET dà solo la parte pubblica.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { leggiConfigScrittura, salvaChiaveScrittura, togliChiaveScrittura } from "@/lib/zabbix-lettura/config";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";

export async function GET() {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  return withTenantFromSession(() => NextResponse.json({ config: leggiConfigScrittura(dipendenzeReali().db) }));
}

const Corpo = z.object({ chiave: z.string().min(1).max(200) }).strict();

export async function PUT(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = Corpo.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  return withTenantFromSession(() => {
    const db = dipendenzeReali().db;
    const esito = salvaChiaveScrittura(db, parsed.data.chiave, session.user?.name ?? "admin");
    if (!esito.ok) return NextResponse.json({ error: "errore" in esito ? esito.errore : "Chiave non valida" }, { status: 400 });
    return NextResponse.json({ ok: true, config: leggiConfigScrittura(db) });
  });
}

export async function DELETE() {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  return withTenantFromSession(() => NextResponse.json({ ok: true, tolta: togliChiaveScrittura(dipendenzeReali().db) }));
}

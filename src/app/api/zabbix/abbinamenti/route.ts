/**
 * Abbinamenti host del centro ↔ DA-IPAM (passo 7.4, §5 del design dell'API). Solo
 * admin: confermare un abbinamento proposto, o togliere uno verificato (anche perso).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { togliAbbinamento } from "@/lib/zabbix-lettura/abbinamenti-db";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { confermaAbbinamento } from "@/lib/zabbix-lettura/servizio";

const HOSTID = z.string().regex(/^\d{1,20}$/);
const Conferma = z.object({ hostid: HOSTID, hostId: z.number().int().positive() }).strict();

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = Conferma.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Dati non validi", details: parsed.error.issues }, { status: 400 });
  return withTenantFromSession(() => {
    const esito = confermaAbbinamento(dipendenzeReali(), parsed.data, session.user?.name ?? "admin");
    if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: esito.status });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  const hostid = HOSTID.safeParse(new URL(req.url).searchParams.get("hostid") ?? "");
  if (!hostid.success) return NextResponse.json({ error: "hostid non valido" }, { status: 400 });
  return withTenantFromSession(() => {
    const tolto = togliAbbinamento(dipendenzeReali().db, hostid.data);
    return NextResponse.json({ ok: true, tolto });
  });
}

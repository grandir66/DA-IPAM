/**
 * Configurazione del pannello Zabbix in sola lettura (passo 7.4). Solo admin: porta la
 * chiave di lettura del centro (mai restituita) e decide verso dove parte.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { leggiConfigDalink } from "@/lib/dalink/config";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { leggiConfigLettura, salvaConfigLettura, togliConfigLettura } from "@/lib/zabbix-lettura/config";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { svuotaCachePannello } from "@/lib/zabbix-lettura/servizio";

function codcliDaDalink(): string | null {
  try {
    const c = leggiConfigDalink();
    return c.stato === "pronta" ? c.codcli : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  return withTenantFromSession(() => {
    const d = dipendenzeReali();
    const config = leggiConfigLettura(d.db);
    return NextResponse.json({
      acquistato: opzioneAcquistata("zabbix"),
      config,
      codcliSuggerito: config ? null : codcliDaDalink(),
      proxyLocale: d.proxyLocale(config?.proxyLocale ?? null),
    });
  });
}

const Corpo = z
  .object({
    baseUrl: z.string().min(1).max(500),
    /** Vuota = non cambiare quella salvata. */
    chiave: z.string().max(200).nullable().optional(),
    impronta: z.string().max(200).nullable().optional(),
    codcli: z.string().min(1).max(20),
    proxyLocale: z.string().max(128).nullable().optional(),
    enabled: z.boolean(),
  })
  .strict();

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
  if (!parsed.success) return NextResponse.json({ error: "Dati non validi", details: parsed.error.issues }, { status: 400 });
  return withTenantFromSession(() => {
    const d = dipendenzeReali();
    const esito = salvaConfigLettura(d.db, parsed.data, session.user?.name ?? "admin");
    if (!esito.ok) return NextResponse.json({ error: esito.errore }, { status: 400 });
    svuotaCachePannello(d.tenant);
    return NextResponse.json({ ok: true, config: esito.config });
  });
}

export async function DELETE() {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  return withTenantFromSession(() => {
    const d = dipendenzeReali();
    const tolta = togliConfigLettura(d.db);
    svuotaCachePannello(d.tenant);
    return NextResponse.json({ ok: true, tolta });
  });
}

/**
 * Il comando dell'agente Windows o Linux da lanciare a mano sulla macchina (13/11/2026). Solo admin. Senza
 * `hostname`: un comando per tutte le macchine, che si presentano col loro nome (GPO, Intune, più Linux).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { comandoAgenteApparato } from "@/lib/zabbix-lettura/inserimento";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { trasportoTlsPost } from "@/lib/zabbix-lettura/trasporto";

const Corpo = z
  .object({
    sistema: z.enum(["windows", "linux"]),
    hostname: z.string().max(128).nullable().optional(),
    serverActive: z.string().regex(/^(?:\d{1,3}\.){3}\d{1,3}$/).nullable().optional(),
  })
  .strict();

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  let corpo: unknown;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Richiesta non leggibile" }, { status: 400 });
  }
  const p = Corpo.safeParse(corpo);
  if (!p.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  return withTenantFromSession(async () => {
    const d = dipendenzeReali();
    const r = await comandoAgenteApparato(
      { db: d.db, acquistato: () => opzioneAcquistata("zabbix"), trasportoPost: (base, chiave, impronta) => trasportoTlsPost({ base, chiave, impronta }) },
      p.data,
    );
    if (!r.ok) return NextResponse.json({ error: r.errore }, { status: r.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(r.esito, { headers: { "Cache-Control": "no-store" } });
  });
}

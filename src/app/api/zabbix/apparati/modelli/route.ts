/**
 * Aggiunge e toglie modelli a un apparato in Zabbix (13/11/2026, Riccardo: «sì, solo modelli»). Solo admin.
 * Togliere un modello cancella in Zabbix le sue misure su quell'apparato: la pagina lo fa confermare.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { cambiaModelliApparato } from "@/lib/zabbix-lettura/inserimento";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { dimenticaFamiglie } from "@/lib/zabbix-lettura/servizio";
import { trasportoTlsPost } from "@/lib/zabbix-lettura/trasporto";

const Corpo = z
  .object({
    hostid: z.string().regex(/^\d{1,20}$/),
    aggiungi: z.array(z.string().min(1).max(120)).max(10).optional(),
    togli: z.array(z.string().min(1).max(120)).max(10).optional(),
    prova: z.boolean().optional(),
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
    const r = await cambiaModelliApparato(
      { db: d.db, acquistato: () => opzioneAcquistata("zabbix"), trasportoPost: (base, chiave, impronta) => trasportoTlsPost({ base, chiave, impronta }) },
      p.data,
    );
    if (!r.ok) return NextResponse.json({ error: r.errore }, { status: r.status, headers: { "Cache-Control": "no-store" } });
    if (r.esito.esito === "cambiato") dimenticaFamiglie(d.tenant);
    return NextResponse.json(r.esito, { headers: { "Cache-Control": "no-store" } });
  });
}

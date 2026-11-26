/**
 * I modelli che il centro proporrebbe oggi per un apparato già in Zabbix (26/11/2026). Non scrive niente: si
 * applica con la rotta dei modelli. Il record dell'apparato lo legge il server dal DB del tenant, non lo manda
 * il browser. Solo admin.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { proponiModelliApparato } from "@/lib/zabbix-lettura/inserimento";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { trasportoTlsPost } from "@/lib/zabbix-lettura/trasporto";

const Corpo = z
  .object({
    hostid: z.string().regex(/^\d{1,20}$/),
    /** L'host di DA-IPAM, se l'apparato è lì; senza, si manda al centro solo l'IP. */
    ipamId: z.number().int().positive().nullable(),
    ip: z.string().regex(/^[0-9a-fA-F:.]{3,45}$/).nullable(),
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
    const r = await proponiModelliApparato(
      { db: d.db, acquistato: () => opzioneAcquistata("zabbix"), trasportoPost: (base, chiave, impronta) => trasportoTlsPost({ base, chiave, impronta }) },
      p.data,
    );
    if (!r.ok) return NextResponse.json({ error: r.errore }, { status: r.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(r.esito, { headers: { "Cache-Control": "no-store" } });
  });
}

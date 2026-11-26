/**
 * Rinomina un apparato in Zabbix (26/11/2026): cambia il solo nome mostrato, mai quello che l'agente dichiara.
 * `prova: true` dice cosa farebbe senza scrivere. Solo admin.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { rinominaApparato } from "@/lib/zabbix-lettura/inserimento";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { dimenticaFamiglie } from "@/lib/zabbix-lettura/servizio";
import { trasportoTlsPost } from "@/lib/zabbix-lettura/trasporto";

const Corpo = z
  .object({
    hostid: z.string().regex(/^\d{1,20}$/),
    nome: z.string().trim().min(1).max(128),
    prova: z.boolean(),
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
  if (!p.success) return NextResponse.json({ error: "Dati non validi: il nome va da 1 a 128 caratteri" }, { status: 400 });
  return withTenantFromSession(async () => {
    const d = dipendenzeReali();
    const r = await rinominaApparato(
      { db: d.db, acquistato: () => opzioneAcquistata("zabbix"), trasportoPost: (base, chiave, impronta) => trasportoTlsPost({ base, chiave, impronta }) },
      p.data,
    );
    if (!r.ok) return NextResponse.json({ error: r.errore }, { status: r.status, headers: { "Cache-Control": "no-store" } });
    if (r.esito.esito === "fatto") dimenticaFamiglie(d.tenant);
    return NextResponse.json(r.esito, { headers: { "Cache-Control": "no-store" } });
  });
}

/**
 * L'elenco della pagina «Apparati» di DatIA Mon (13/11/2026): apparati in Zabbix con modelli, stato e agente, e
 * quelli di DA-IPAM non ancora aggiunti. Solo admin, solo lettura.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { elencoApparati, type RigaIpam } from "@/lib/zabbix-lettura/apparati";
import { perchéNonSiPuò } from "@/lib/zabbix-lettura/inserimento";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { leggiModelliCentro, leggiMonitoringCentro } from "@/lib/zabbix-lettura/servizio";

export async function GET() {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  return withTenantFromSession(async () => {
    const d = dipendenzeReali();
    const l = await leggiMonitoringCentro(d);
    if (l.stato === "fermo") {
      return NextResponse.json({ letto: false, motivo: l.pannello.messaggio }, { headers: { "Cache-Control": "no-store" } });
    }
    const ipam = d.db
      .prepare(
        `SELECT h.id, h.ip, COALESCE(NULLIF(TRIM(h.custom_name), ''), NULLIF(TRIM(h.hostname), ''), h.ip) AS nome,
                h.classification AS classificazione,
                (SELECT group_concat(x.ip) FROM hosts x WHERE h.physical_device_id IS NOT NULL
                   AND x.physical_device_id = h.physical_device_id AND x.id <> h.id) AS altri
         FROM hosts h WHERE h.ip IS NOT NULL AND h.ip <> '' ORDER BY nome LIMIT 3000`,
      )
      .all() as RigaIpam[];
    const modelli = await leggiModelliCentro(d);
    const scrittura = perchéNonSiPuò({ db: d.db, acquistato: () => opzioneAcquistata("zabbix") });
    return NextResponse.json(
      {
        letto: true,
        lettoAlle: l.centro.cliente.letto_alle ?? null,
        vecchio: l.centro.vecchio || l.famiglie.vecchio,
        famiglie: l.famiglie.famiglie,
        apparati: elencoApparati({ host: l.centro.host, famiglie: l.famiglie.host, problemi: l.centro.problemi.problemi, vecchio: l.centro.vecchio, ipam }),
        modelliAdatti: modelli?.famiglie ?? null,
        scrittura: scrittura ? { possibile: false, motivo: scrittura } : { possibile: true },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

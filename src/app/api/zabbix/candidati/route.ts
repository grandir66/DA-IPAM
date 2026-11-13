/**
 * Gli apparati di DA-IPAM che non sono ancora abbinati a Zabbix: la lista della pagina
 * «Aggiungi a Zabbix» (13/11/2026, tappa C di DATIA MONITORING). Solo admin, solo lettura.
 * Il centro decide poi, uno per uno, se e come entrano: qui non si filtra per tipo.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { perchéNonSiPuò } from "@/lib/zabbix-lettura/inserimento";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";

export interface Candidato {
  id: number;
  ip: string;
  nome: string;
  classificazione: string | null;
  stato: string | null;
}

export async function GET() {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  return withTenantFromSession(() => {
    const { db } = dipendenzeReali();
    const motivo = perchéNonSiPuò({ db, acquistato: () => opzioneAcquistata("zabbix") });
    if (motivo) return NextResponse.json({ possibile: false, motivo, candidati: [] });
    const conAbbinamenti = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = 'zabbix_abbinamenti'").get();
    const candidati = db
      .prepare(
        `SELECT h.id, h.ip, COALESCE(NULLIF(TRIM(h.custom_name), ''), NULLIF(TRIM(h.hostname), ''), h.ip) AS nome,
                h.classification AS classificazione, h.status AS stato
         FROM hosts h
         WHERE h.ip IS NOT NULL AND h.ip <> ''
           ${conAbbinamenti ? "AND NOT EXISTS (SELECT 1 FROM zabbix_abbinamenti a WHERE a.host_id = h.id)" : ""}
         ORDER BY h.classification IS NULL, h.classification, nome
         LIMIT 2000`,
      )
      .all() as Candidato[];
    return NextResponse.json({ possibile: true, candidati }, { headers: { "Cache-Control": "no-store" } });
  });
}

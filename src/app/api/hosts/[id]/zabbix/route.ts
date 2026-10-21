/**
 * Stato Zabbix di un host per la scheda apparato (tab Gestione, «Collegamenti esterni»): se il pannello di lettura
 * è acquistato e configurato, e se questo host ha un abbinamento verificato (`zabbix_abbinamenti`). Solo lettura.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { leggiConfigLettura } from "@/lib/zabbix-lettura/config";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const { id } = await params;
  const hostId = Number(id);
  if (!Number.isInteger(hostId) || hostId <= 0) return NextResponse.json({ error: "Host non valido" }, { status: 400 });
  return withTenantFromSession(() => {
    if (!opzioneAcquistata("zabbix")) return NextResponse.json({ configurato: false, abbinato: false });
    const { db } = dipendenzeReali();
    if (!leggiConfigLettura(db)) return NextResponse.json({ configurato: false, abbinato: false });
    // Un GET legge: se la tabella non c'è ancora (nessun abbinamento mai fatto) l'host è «non abbinato», senza creare niente.
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = 'zabbix_abbinamenti'").get()) {
      return NextResponse.json({ configurato: true, abbinato: false });
    }
    const riga = db.prepare("SELECT hostid FROM zabbix_abbinamenti WHERE host_id = ? ORDER BY CAST(hostid AS INTEGER) LIMIT 1").get(hostId) as
      | { hostid: string }
      | undefined;
    return NextResponse.json({ configurato: true, abbinato: riga != null, ...(riga ? { hostid: riga.hostid } : {}) });
  });
}

/**
 * Stato Zabbix di un host per la scheda apparato (tab Gestione, «Collegamenti esterni»): se il pannello di lettura
 * è acquistato e configurato, e se questo host ha un abbinamento verificato (`zabbix_abbinamenti`). Solo lettura.
 */
import { NextResponse } from "next/server";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { opzioneAcquistata } from "@/lib/modules/offerta";
import { leggiConfigLettura } from "@/lib/zabbix-lettura/config";
import { inserisciHost, perchéNonSiPuò } from "@/lib/zabbix-lettura/inserimento";
import { dipendenzeReali } from "@/lib/zabbix-lettura/reale";
import { trasportoTlsPost } from "@/lib/zabbix-lettura/trasporto";

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
    // «Metti in monitoraggio» si offre solo se si può davvero: altrimenti il motivo, per chi è admin.
    const nonSiPuò = perchéNonSiPuò({ db, acquistato: () => true });
    return NextResponse.json({
      configurato: true,
      abbinato: riga != null,
      ...(riga ? { hostid: riga.hostid } : {}),
      inserimento: nonSiPuò ? { possibile: false, motivo: nonSiPuò } : { possibile: true },
    });
  });
}

/**
 * «Metti in monitoraggio» (13/11/2026, tappa C di DATIA MONITORING). Solo amministratori.
 * Corpo facoltativo `{ prova?, forza?, serverActive? }`. Per Windows e Linux la risposta
 * porta lo script dell'agente, da lanciare a mano sulla macchina: qui non si esegue niente.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authCheck = await requireAdmin();
  if (isAuthError(authCheck)) return authCheck;
  const { id } = await params;
  const hostId = Number(id);
  if (!Number.isInteger(hostId) || hostId <= 0) return NextResponse.json({ error: "Host non valido" }, { status: 400 });
  let corpo: Record<string, unknown> = {};
  try {
    const letto = await req.json();
    if (letto && typeof letto === "object") corpo = letto as Record<string, unknown>;
  } catch {
    corpo = {};
  }
  const serverActive = typeof corpo.serverActive === "string" ? corpo.serverActive : null;
  if (serverActive && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(serverActive.trim())) {
    return NextResponse.json({ error: "Indirizzo del proxy non valido: serve un IPv4" }, { status: 400 });
  }
  return withTenantFromSession(async () => {
    const { db } = dipendenzeReali();
    const r = await inserisciHost(
      {
        db,
        acquistato: () => opzioneAcquistata("zabbix"),
        trasportoPost: (base, chiave, impronta) => trasportoTlsPost({ base, chiave, impronta }),
      },
      hostId,
      { prova: corpo.prova === true, forza: corpo.forza === true, serverActive },
    );
    if (!r.ok) return NextResponse.json({ error: r.errore }, { status: r.status, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(r.esito, { headers: { "Cache-Control": "no-store" } });
  });
}

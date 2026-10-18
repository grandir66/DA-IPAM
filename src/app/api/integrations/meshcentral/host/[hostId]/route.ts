/**
 * GET /api/integrations/meshcentral/host/[hostId]
 * Stato Mesh del singolo host (per la card "Controllo remoto"). Lettura → requireAuth.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMeshStatusForHost } from "@/lib/integrations/meshcentral/db";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { meshAttivo } from "@/lib/integrations/meshcentral/feature";
import {
  protocolliDisponibili,
  senzaAgenteAttivo,
} from "@/lib/integrations/meshcentral/senza-agente";

function parseHostId(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

/**
 * Pulsanti RDP/VNC senza agente (senza-agente.ts): solo con modulo e flag accesi,
 * e solo per le porte che la scansione ha trovato aperte.
 */
function senzaAgente(hostId: number): { rdp: boolean; vnc: boolean } {
  const no = { rdp: false, vnc: false };
  const code = getCurrentTenantCode();
  if (!code || !senzaAgenteAttivo() || !meshAttivo(code)) return no;
  const row = getTenantDb(code)
    .prepare("SELECT open_ports FROM hosts WHERE id = ?")
    .get(hostId) as { open_ports: string | null } | undefined;
  return row ? protocolliDisponibili(row.open_ports) : no;
}

export async function GET(_req: Request, ctx: { params: Promise<{ hostId: string }> }) {
  const { hostId: hostIdRaw } = await ctx.params;
  const hostId = parseHostId(hostIdRaw);
  if (hostId === null) {
    return NextResponse.json({ error: "hostId non valido" }, { status: 400 });
  }
  return withTenantFromSession(async () => {
    const auth = await requireAuth();
    if (isAuthError(auth)) return auth;
    return NextResponse.json({ mesh: getMeshStatusForHost(hostId), senzaAgente: senzaAgente(hostId) });
  });
}

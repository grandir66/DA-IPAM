/**
 * GET /api/integrations/meshcentral/host/[hostId]
 * Stato Mesh del singolo host (per la card "Controllo remoto"), più quali
 * pulsanti senza agente (RDP/VNC) e SSH mostrare. Lettura → requireAuth.
 */
import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getMeshStatusForHost } from "@/lib/integrations/meshcentral/db";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { meshAttivo } from "@/lib/integrations/meshcentral/feature";
import {
  porteAperte,
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
 * per le porte che la scansione ha trovato aperte (RDP anche per ogni host Windows).
 */
function senzaAgente(hostId: number): { rdp: boolean; vnc: boolean } {
  const no = { rdp: false, vnc: false };
  const code = getCurrentTenantCode();
  if (!code || !senzaAgenteAttivo() || !meshAttivo(code)) return no;
  const row = getTenantDb(code)
    .prepare("SELECT open_ports, os_family FROM hosts WHERE id = ?")
    .get(hostId) as { open_ports: string | null; os_family: string | null } | undefined;
  return row ? protocolliDisponibili(row.open_ports, row.os_family) : no;
}

/**
 * Porta 22 aperta: la card offre il terminale SSH di DA-IPAM
 * (components/ssh-terminal, credenziali salvate dell'host). Non dipende da
 * MeshCentral né dal flag senza agente.
 */
function sshAperto(hostId: number): boolean {
  const code = getCurrentTenantCode();
  if (!code) return false;
  const row = getTenantDb(code)
    .prepare("SELECT open_ports FROM hosts WHERE id = ?")
    .get(hostId) as { open_ports: string | null } | undefined;
  return row ? porteAperte(row.open_ports).includes(22) : false;
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
    // Tabelle del modulo assenti (mai installato): nessun nodo, ma il pulsante
    // SSH della card (terminale di DA-IPAM, non di MeshCentral) resta.
    let mesh: ReturnType<typeof getMeshStatusForHost> = { present: false };
    try {
      mesh = getMeshStatusForHost(hostId);
    } catch {
      /* modulo mai installato */
    }
    return NextResponse.json({ mesh, senzaAgente: senzaAgente(hostId), ssh: sshAperto(hostId) });
  });
}

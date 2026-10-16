import { NextResponse } from "next/server";
import {
  getNetworkById,
  deleteNetwork,
  getNetworkRouterId,
  getHostsByNetworkWithDevices,
  getNetworkCredentials,
  getHostValidatedProtocolsByNetwork,
} from "@/lib/db";
import { NetworkUpdateSchema } from "@/lib/validators";
import { aggiornaRete, CredenzialiReteNonValide } from "@/lib/networks/salva-rete";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
    const network = getNetworkById(Number(id));
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    const hosts = getHostsByNetworkWithDevices(Number(id));
    const router_id = getNetworkRouterId(Number(id));
    // Dalla 2d (T17) la rete ha una lista sola: le catene vecchie per ruolo non si restituiscono più.
    const network_credentials = getNetworkCredentials(Number(id));
    // Badge: protocolli validati per host (mappa host_id → protocol_type[])
    const validatedMap = getHostValidatedProtocolsByNetwork(Number(id));
    const host_validated_protocols: Record<number, string[]> = {};
    for (const [hostId, protocols] of validatedMap) {
      host_validated_protocols[hostId] = protocols;
    }
    return NextResponse.json({
      ...network,
      hosts,
      router_id,
      network_credentials,
      host_validated_protocols,
    });
    } catch (error) {
      console.error("Error fetching network:", error);
      return NextResponse.json({ error: "Errore nel recupero della rete" }, { status: 500 });
    }
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const networkId = Number(id);
    const body = await request.json();
    const parsed = NetworkUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    // Rete, router e lista credenziali (`credential_ids`) in una transazione:
    // una voce rifiutata è un 400 e non lascia scritto niente. I campi delle
    // catene vecchie si accodano alla lista, con `avvisi` nella risposta (T17).
    let salvata;
    try {
      salvata = aggiornaRete(networkId, parsed.data);
    } catch (e) {
      if (e instanceof CredenzialiReteNonValide) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    if (!salvata) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    return NextResponse.json(salvata);
    } catch (error) {
      console.error("Error updating network:", error);
      return NextResponse.json({ error: "Errore nell'aggiornamento della rete" }, { status: 500 });
    }
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const { id } = await params;
      const deleted = deleteNetwork(Number(id));
      if (!deleted) {
        return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (error) {
      console.error("Error deleting network:", error);
      return NextResponse.json({ error: "Errore nell'eliminazione della rete" }, { status: 500 });
    }
  });
}

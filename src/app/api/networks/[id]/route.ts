import { NextResponse } from "next/server";
import {
  getNetworkById,
  updateNetwork,
  deleteNetwork,
  setNetworkRouter,
  deleteNetworkRouter,
  getNetworkRouterId,
  getHostsByNetworkWithDevices,
  getNetworkHostCredentialIds,
  replaceNetworkHostCredentials,
  getNetworkCredentials,
  getHostValidatedProtocolsByNetwork,
} from "@/lib/db";
import { NetworkUpdateSchema } from "@/lib/validators";
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
    const windows_credential_ids = getNetworkHostCredentialIds(Number(id), "windows");
    const linux_credential_ids = getNetworkHostCredentialIds(Number(id), "linux");
    const ssh_credential_ids = getNetworkHostCredentialIds(Number(id), "ssh");
    const snmp_credential_ids = getNetworkHostCredentialIds(Number(id), "snmp");
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
      windows_credential_ids,
      linux_credential_ids,
      ssh_credential_ids,
      snmp_credential_ids,
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
    const {
      router_id,
      windows_credential_ids,
      linux_credential_ids,
      ssh_credential_ids,
      snmp_credential_ids,
      ...networkData
    } = parsed.data;
    const network = updateNetwork(networkId, networkData);
    if (!network) {
      return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    }
    if (router_id !== undefined) {
      if (router_id) {
        setNetworkRouter(networkId, router_id);
      } else {
        deleteNetworkRouter(networkId);
      }
    }
    try {
      if (windows_credential_ids !== undefined) {
        replaceNetworkHostCredentials(networkId, "windows", windows_credential_ids);
      }
      if (linux_credential_ids !== undefined) {
        replaceNetworkHostCredentials(networkId, "linux", linux_credential_ids);
      }
      if (ssh_credential_ids !== undefined) {
        replaceNetworkHostCredentials(networkId, "ssh", ssh_credential_ids);
      }
      if (snmp_credential_ids !== undefined) {
        replaceNetworkHostCredentials(networkId, "snmp", snmp_credential_ids);
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Credenziali non valide" },
        { status: 400 }
      );
    }
    const updated = getNetworkById(networkId);
    const currentRouterId = getNetworkRouterId(networkId);
    return NextResponse.json({
      ...updated,
      router_id: currentRouterId,
      windows_credential_ids: getNetworkHostCredentialIds(networkId, "windows"),
      linux_credential_ids: getNetworkHostCredentialIds(networkId, "linux"),
      ssh_credential_ids: getNetworkHostCredentialIds(networkId, "ssh"),
      snmp_credential_ids: getNetworkHostCredentialIds(networkId, "snmp"),
    });
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

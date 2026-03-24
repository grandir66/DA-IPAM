import { NextResponse } from "next/server";
import { getNetworkRouterId, updateNetworkDevice, getCredentialCommunityString } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

/**
 * Assegna credenziali (SSH e/o SNMP) ai router delle reti selezionate.
 * POST /api/networks/bulk-assign-credential
 * Body: { network_ids: number[], credential_id?: number | null, snmp_credential_id?: number | null }
 * Le credenziali devono essere scelte da quelle registrate.
 * credential_id = SSH (per ARP), snmp_credential_id = SNMP (per porte/LLDP/community).
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const networkIds = Array.isArray(body.network_ids) ? body.network_ids.map(Number) : [];
    const credentialId = body.credential_id != null ? Number(body.credential_id) : undefined;
    const snmpCredentialId = body.snmp_credential_id != null ? Number(body.snmp_credential_id) : undefined;

    if (networkIds.length === 0) {
      return NextResponse.json({ error: "Seleziona almeno una rete" }, { status: 400 });
    }

    if (credentialId === undefined && snmpCredentialId === undefined) {
      return NextResponse.json({ error: "Indica almeno una credenziale SSH o SNMP registrata" }, { status: 400 });
    }

    let communityString: string | undefined;
    if (snmpCredentialId && snmpCredentialId > 0) {
      communityString = getCredentialCommunityString(snmpCredentialId) ?? undefined;
      if (!communityString) {
        return NextResponse.json({ error: "Credenziale SNMP non valida: verifica che sia registrata con tipo SNMP e community string" }, { status: 400 });
      }
    }

    const updates: Record<string, unknown> = {};
    if (credentialId !== undefined) {
      updates.credential_id = credentialId === 0 ? null : credentialId;
      if (updates.credential_id) {
        updates.username = null;
        updates.encrypted_password = null;
      }
    }
    if (snmpCredentialId !== undefined) {
      updates.snmp_credential_id = snmpCredentialId === 0 ? null : snmpCredentialId;
    }
    if (communityString !== undefined && communityString !== "") {
      updates.community_string = encrypt(communityString);
    } else if (body.snmp_credential_id === null || body.snmp_credential_id === 0) {
      updates.community_string = null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nessuna modifica da applicare" }, { status: 400 });
    }

    let updated = 0;
    const routerIds = new Set<number>();

    for (const networkId of networkIds) {
      const routerId = getNetworkRouterId(networkId);
      if (routerId && !routerIds.has(routerId)) {
        routerIds.add(routerId);
        const device = updateNetworkDevice(routerId, updates as Parameters<typeof updateNetworkDevice>[1]);
        if (device) updated++;
      }
    }

    return NextResponse.json({
      success: true,
      networks_processed: networkIds.length,
      devices_updated: updated,
      message: `Credenziali assegnate a ${updated} router`,
    });
    } catch (error) {
      console.error("Bulk assign credential error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nell'assegnazione" },
        { status: 500 }
      );
    }
  });
}

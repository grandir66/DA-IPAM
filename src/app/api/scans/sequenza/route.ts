import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getHostById, getNetworkById, getNetworkCredentials } from "@/lib/db";
import { ARGOMENTI_VUOTI, argomentiNmap } from "@/lib/scanner/argomenti-nmap";
import { discoverNetwork, type DiscoveryScanType } from "@/lib/scanner/discovery";
import { corpoScanInCorso, isScanInCorso } from "@/lib/scanner/network-scan-lock";
import { avviaSequenza, type FaseSequenza } from "@/lib/scanner/sequenze";
import { ScanSequenzaSchema } from "@/lib/validators";

/**
 * Le sequenze a più fasi della pagina rete, eseguite sul server: chi chiude la pagina non ferma le
 * fasi che mancano. La sequenza si sceglie per nome: le fasi le decide il server, mai il browser.
 */
export async function POST(request: Request) {
  return await withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    try {
      const parsed = ScanSequenzaSchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }
      const { network_id: networkId, sequenza, host_ids: hostIds } = parsed.data;
      const tenantCode = getCurrentTenantCode();
      const rete = getNetworkById(networkId);
      if (!tenantCode || !rete) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });

      const targetIps = (hostIds ?? [])
        .map((id) => getHostById(id))
        .filter((h) => h?.network_id === networkId)
        .map((h) => h!.ip);
      // Avanzata e accesso fanno tentativi e probe sui singoli host: solo su quelli scelti, come l'avvio singolo.
      if (sequenza !== "scoperta" && targetIps.length === 0) {
        return NextResponse.json({ error: "Seleziona uno o più host nella lista e riprova" }, { status: 400 });
      }

      const fase = (nome: string, tipo: DiscoveryScanType): FaseSequenza => ({
        nome,
        avvia: (sequenzaId) => {
          const a = tipo === "nmap" ? argomentiNmap() : ARGOMENTI_VUOTI;
          return discoverNetwork(networkId, tipo, a.nmapArgs, a.snmpCommunity, {
            ...(targetIps.length > 0 ? { targetIps } : {}),
            tcpPorts: a.tcpPorts,
            udpPorts: a.udpPorts,
            sequenzaId,
          });
        },
      });

      const fasi: Record<typeof sequenza, FaseSequenza[]> = {
        scoperta: [fase("ICMP", "scan_icmp"), fase("Nmap quick", "scan_nmap_base")],
        avanzata: [fase("Porte e servizi", "nmap"), fase("SNMP", "snmp")],
        accesso: [
          ...(getNetworkCredentials(networkId).length > 0 ? [fase("Verifica credenziali", "credential_validate")] : []),
          fase("WinRM (Windows)", "windows"),
          fase("SSH (Linux)", "ssh"),
        ],
      };

      const { id, progress } = await avviaSequenza({
        tenantCode,
        networkId,
        etichetta: rete.name,
        tipo: `sequenza_${sequenza}`,
        fasi: fasi[sequenza],
      });
      return NextResponse.json({ id, progress });
    } catch (error) {
      if (isScanInCorso(error)) return NextResponse.json(corpoScanInCorso(error.giro), { status: 409 });
      console.error("Scan sequence error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nell'avvio della sequenza" },
        { status: 500 },
      );
    }
  });
}

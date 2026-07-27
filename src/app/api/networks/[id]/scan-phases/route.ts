import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getNetworkById,
  getSetting,
  getScanPhaseStatusForNetwork,
  getAttributionCompletenessForNetwork,
} from "@/lib/db";
import type { ScanPhaseKey } from "@/lib/db";
import { isNaabuAvailable } from "@/lib/scanner/naabu";

// Ordine e testo del blocco Acquisizione (spec §6.2).
const PHASE_META: Array<{ key: ScanPhaseKey; label: string; adds: string }> = [
  {
    key: "initial",
    label: "Scansione iniziale",
    adds: "ICMP + Naabu (o ICMP + Nmap quick se Naabu non è disponibile): scopre host attivi e porte di base",
  },
  {
    key: "nmap_deep",
    label: "Porte approfondite (Nmap -sV)",
    adds: "Nmap -sV: banner e versioni dei servizi, OS fingerprint approfondito",
  },
  {
    key: "snmp",
    label: "SNMP",
    adds: "SNMP → sysObjectID, LLDP: distingue AP da switch",
  },
  {
    key: "enrich",
    label: "Enrich (ARP/DHCP/AD)",
    adds: "ARP/DHCP/AD: hostname, MAC/vendor, collegamento a computer Active Directory",
  },
  {
    key: "credentials",
    label: "Credenziali (SSH/WinRM)",
    // Solo host selezionati: ogni tentativo è un logon fallito reale (allarmi MDR/XDR, lockout AD).
    adds: "SSH/WinRM sugli host selezionati: OS esatto, board vendor, enrichment via agent",
  },
];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const authCheck = await requireAuth();
      if (isAuthError(authCheck)) return authCheck;

      const { id } = await params;
      const networkId = Number(id);
      const network = getNetworkById(networkId);
      if (!network) {
        return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
      }

      const naabuBinPath = (getSetting("naabu_bin_path") ?? "").trim();
      let naabuAvailable = false;
      try {
        naabuAvailable = await isNaabuAvailable(naabuBinPath || undefined);
      } catch {
        naabuAvailable = false;
      }

      const statusByKey = new Map(
        getScanPhaseStatusForNetwork(networkId).map((s) => [s.key, s])
      );
      const phases = PHASE_META.map((meta) => {
        const status = statusByKey.get(meta.key);
        return {
          key: meta.key,
          label: meta.label,
          adds: meta.adds,
          last_run: status?.last_run ?? null,
          stale: status?.stale ?? false,
        };
      });

      const attribution = getAttributionCompletenessForNetwork(networkId);

      return NextResponse.json({ naabuAvailable, phases, attribution });
    } catch (error) {
      console.error("Error fetching scan phases:", error);
      return NextResponse.json({ error: "Errore nel recupero dello stato delle fasi di scansione" }, { status: 500 });
    }
  });
}

import { NextResponse } from "next/server";
import { ScanTriggerSchema } from "@/lib/validators";
import { getNmapProfileById, getActiveNmapProfile, getNetworkById, getHostById } from "@/lib/db";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { buildCustomScanArgs } from "@/lib/scanner/ports";
import { runArpPoll, runDhcpPollForNetwork, runDnsResolve } from "@/lib/cron/jobs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

function resolveTargetIps(networkId: number, hostIds: number[] | undefined): string[] | undefined {
  if (!hostIds?.length) return undefined;
  const ips: string[] = [];
  for (const id of hostIds) {
    const h = getHostById(id);
    if (h && h.network_id === networkId) ips.push(h.ip);
  }
  return ips.length ? ips : undefined;
}

const MANUAL_SCAN_TYPES = new Set<string>(["nmap", "snmp", "windows", "ssh", "dns", "arp_poll", "dhcp", "ipam_full"]);

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = ScanTriggerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const targetIps = resolveTargetIps(parsed.data.network_id, parsed.data.host_ids);
    if (parsed.data.host_ids?.length && !targetIps?.length) {
      return NextResponse.json({ error: "Nessun host valido tra quelli selezionati per questa rete" }, { status: 400 });
    }

    if (MANUAL_SCAN_TYPES.has(parsed.data.scan_type) && !parsed.data.host_ids?.length) {
      return NextResponse.json(
        { error: "Seleziona uno o più host nella lista e riprova (azioni manuali solo su IP selezionati)" },
        { status: 400 }
      );
    }

    if (parsed.data.scan_type === "arp_poll") {
      const result = await runArpPoll(parsed.data.network_id, targetIps ? { onlyEnrichIps: targetIps } : undefined);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({
        id: "arp-poll",
        progress: { status: "completed", phase: result.phase ?? "ARP poll completato" },
      });
    }

    if (parsed.data.scan_type === "dns") {
      const result = await runDnsResolve(parsed.data.network_id, parsed.data.host_ids);
      return NextResponse.json({
        id: "dns-resolve",
        progress: { status: "completed", phase: `DNS: ${result.resolved}/${result.total} host risolti` },
      });
    }

    if (parsed.data.scan_type === "dhcp") {
      const result = await runDhcpPollForNetwork(parsed.data.network_id, targetIps ? { onlyIps: targetIps } : undefined);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({
        id: "dhcp-poll",
        progress: { status: "completed", phase: `DHCP: ${result.updated} host aggiornati` },
      });
    }

    let nmapArgs: string | undefined;
    let snmpCommunity: string | null | undefined;
    let tcpPorts: string | null = null;
    let udpPorts: string | null = null;
    const network = getNetworkById(parsed.data.network_id);

    if (parsed.data.scan_type === "nmap") {
      const profile = parsed.data.nmap_profile_id
        ? getNmapProfileById(parsed.data.nmap_profile_id)
        : getActiveNmapProfile();
      if (profile) {
        // Usa porte esplicite se presenti nel profilo
        tcpPorts = profile.tcp_ports ?? null;
        udpPorts = profile.udp_ports ?? null;
        // Fallback a custom_ports o args per retrocompatibilità
        if (!tcpPorts) {
          nmapArgs =
            profile.custom_ports !== null && profile.custom_ports !== undefined
              ? buildCustomScanArgs(profile.custom_ports)
              : profile.args;
        }
        if (!snmpCommunity && profile.snmp_community) {
          snmpCommunity = profile.snmp_community;
        }
      } else {
        nmapArgs = buildCustomScanArgs(null);
      }
    }
    // SNMP: community da catena credenziali + campo rete in buildSnmpCommunitiesForNetwork (evita duplicati)

    const discoverOpts: import("@/lib/scanner/discovery").DiscoverNetworkOptions = {
      ...(targetIps ? { targetIps } : {}),
      tcpPorts,
      udpPorts,
    };

    const { id, progress } = await discoverNetwork(
      parsed.data.network_id,
      parsed.data.scan_type as "ping" | "network_discovery" | "snmp" | "nmap" | "windows" | "ssh" | "ipam_full" | "credential_validate",
      nmapArgs,
      snmpCommunity,
      discoverOpts
    );

    return NextResponse.json({ id, progress });
  } catch (error) {
    console.error("Scan trigger error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore nell'avvio della scansione" },
      { status: 500 }
    );
  }
}

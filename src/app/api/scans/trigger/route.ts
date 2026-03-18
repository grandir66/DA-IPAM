import { NextResponse } from "next/server";
import { ScanTriggerSchema } from "@/lib/validators";
import { getNmapProfileById, getNetworkById } from "@/lib/db";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { buildCustomScanArgs } from "@/lib/scanner/ports";
import { runArpPoll, runDhcpPollForNetwork, runDnsResolve } from "@/lib/cron/jobs";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = ScanTriggerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (parsed.data.scan_type === "arp_poll") {
      const result = await runArpPoll(parsed.data.network_id);
      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({
        id: "arp-poll",
        progress: { status: "completed", phase: result.phase ?? "ARP poll completato" },
      });
    }

    if (parsed.data.scan_type === "dns") {
      const result = await runDnsResolve(parsed.data.network_id);
      return NextResponse.json({
        id: "dns-resolve",
        progress: { status: "completed", phase: `DNS: ${result.resolved}/${result.total} host risolti` },
      });
    }

    if (parsed.data.scan_type === "dhcp") {
      const result = await runDhcpPollForNetwork(parsed.data.network_id);
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
    const network = getNetworkById(parsed.data.network_id);

    if (parsed.data.scan_type === "nmap") {
      if (parsed.data.nmap_profile_id) {
        const profile = getNmapProfileById(parsed.data.nmap_profile_id);
        if (!profile) {
          return NextResponse.json({ error: "Profilo nmap non trovato" }, { status: 404 });
        }
        nmapArgs =
          profile.custom_ports !== null && profile.custom_ports !== undefined
            ? buildCustomScanArgs(profile.custom_ports)
            : profile.args;
      } else if (network) {
        nmapArgs = buildCustomScanArgs(null);
      }
    } else if (parsed.data.scan_type === "snmp" && network) {
      snmpCommunity = network.snmp_community ?? null;
    }

    const { id, progress } = await discoverNetwork(
      parsed.data.network_id,
      parsed.data.scan_type as "ping" | "snmp" | "nmap" | "windows" | "ssh",
      nmapArgs,
      snmpCommunity
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

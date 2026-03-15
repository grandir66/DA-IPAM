import { NextResponse } from "next/server";
import { ScanTriggerSchema } from "@/lib/validators";
import { getNmapProfileById, getNetworkById } from "@/lib/db";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { buildCustomScanArgs } from "@/lib/scanner/ports";
import { runArpPoll, runDhcpPollForNetwork } from "@/lib/cron/jobs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = ScanTriggerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    if (parsed.data.scan_type === "arp_poll") {
      await runArpPoll();
      return NextResponse.json({ id: "arp-poll", progress: { status: "completed", phase: "ARP poll completato" } });
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

    // Resolve nmap profile from DB if profile_id is provided
    let nmapArgs: string | undefined;
    let snmpCommunity: string | null | undefined;
    const network = getNetworkById(parsed.data.network_id);
    if (parsed.data.scan_type === "nmap" && parsed.data.nmap_profile_id) {
      const profile = getNmapProfileById(parsed.data.nmap_profile_id);
      if (!profile) {
        return NextResponse.json({ error: "Profilo nmap non trovato" }, { status: 404 });
      }
      // Profilo Personalizzato: top 100 TCP + porte esplicite + UDP note + SNMP
      nmapArgs =
        profile.custom_ports !== null && profile.custom_ports !== undefined
          ? buildCustomScanArgs(profile.custom_ports)
          : profile.args;
      snmpCommunity = network?.snmp_community ?? profile.snmp_community ?? null;
    } else if (parsed.data.scan_type === "nmap" && network) {
      nmapArgs = buildCustomScanArgs(null);
      snmpCommunity = network.snmp_community ?? null;
    }

    const { id, progress } = await discoverNetwork(
      parsed.data.network_id,
      parsed.data.scan_type,
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

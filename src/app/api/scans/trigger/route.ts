import { NextResponse } from "next/server";
import { ScanTriggerSchema } from "@/lib/validators";
import { getNmapProfileById, getActiveNmapProfile, getHostById, getHostsByNetwork, relinkAdComputersForNetwork, addScanHistory } from "@/lib/db";
import { discoverNetwork } from "@/lib/scanner/discovery";
import { buildCustomScanArgs } from "@/lib/scanner/ports";
import { runArpPoll, runDhcpPollForNetwork, runDnsResolve } from "@/lib/cron/jobs";
import { withTenantFromSession } from "@/lib/api-tenant";
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

const MANUAL_SCAN_TYPES = new Set<string>(["nmap", "snmp", "windows", "ssh", "dns", "ipam_full", "credential_validate"]);

export async function POST(request: Request) {
  const result = await withTenantFromSession(async () => {
    // requireAdmin: lanciare scan attivi (nmap/snmp/arp/dns) è azione mutante →
    // non deve bastare un viewer loggato (privilege escalation).
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    try {
      const body = await request.json();
      const parsed = ScanTriggerSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
      }

      let targetIps = resolveTargetIps(parsed.data.network_id, parsed.data.host_ids);
      if (parsed.data.host_ids?.length && !targetIps?.length) {
        return NextResponse.json({ error: "Nessun host valido tra quelli selezionati per questa rete" }, { status: 400 });
      }

      // credential_validate: la fase "Credenziali" del pannello Acquisizione (§6.2, fase 3b)
      // è subnet-wide — senza host_ids selezionati manualmente opera su TUTTI gli host già
      // noti della rete (stessa shape targetIps della selezione manuale, popolata da tutta la
      // rete invece che dalla selezione). Le altre MANUAL_SCAN_TYPES (pannello Detect) restano
      // vincolate a host_ids esplicito: comportamento invariato quando host_ids è presente.
      const isNetworkWideCredentialValidate =
        parsed.data.scan_type === "credential_validate" && !parsed.data.host_ids?.length;
      if (isNetworkWideCredentialValidate) {
        targetIps = getHostsByNetwork(parsed.data.network_id).map((h) => h.ip);
      }

      if (
        MANUAL_SCAN_TYPES.has(parsed.data.scan_type) &&
        !parsed.data.host_ids?.length &&
        !isNetworkWideCredentialValidate
      ) {
        return NextResponse.json(
          { error: "Seleziona uno o più host nella lista e riprova (azioni manuali solo su IP selezionati)" },
          { status: 400 }
        );
      }

      if (parsed.data.scan_type === "arp_poll") {
        const arpResult = await runArpPoll(parsed.data.network_id, targetIps ? { onlyEnrichIps: targetIps } : undefined);
        if (arpResult.error) {
          return NextResponse.json({ error: arpResult.error }, { status: 400 });
        }
        return NextResponse.json({
          id: "arp-poll",
          progress: { status: "completed", phase: arpResult.phase ?? "ARP poll completato" },
        });
      }

      if (parsed.data.scan_type === "dns") {
        const dnsResult = await runDnsResolve(parsed.data.network_id, parsed.data.host_ids);
        return NextResponse.json({
          id: "dns-resolve",
          progress: { status: "completed", phase: `DNS: ${dnsResult.resolved}/${dnsResult.total} host risolti` },
        });
      }

      if (parsed.data.scan_type === "dhcp") {
        const dhcpResult = await runDhcpPollForNetwork(parsed.data.network_id, targetIps ? { onlyIps: targetIps } : undefined);
        if (dhcpResult.error) {
          return NextResponse.json({ error: dhcpResult.error }, { status: 400 });
        }
        return NextResponse.json({
          id: "dhcp-poll",
          progress: { status: "completed", phase: `DHCP: ${dhcpResult.updated} host aggiornati` },
        });
      }

      // scan_enrich (fase 1.4): ARP + DHCP + AD (sync fresco opzionale + relink).
      // Non passa per discoverNetwork — è solo arricchimento dati esistenti.
      // Con fresh_sync=true esegue una query LDAP fresca prima del relink:
      // utile quando la cache AD è vecchia o vuota, ma più lento (10-60s).
      if (parsed.data.scan_type === "scan_enrich") {
        const enrichStart = Date.now();
        const phases: string[] = [];
        const errors: string[] = [];
        const freshSync = parsed.data.fresh_sync === true;

        const arpResult = await runArpPoll(parsed.data.network_id, targetIps ? { onlyEnrichIps: targetIps } : undefined);
        if (arpResult.error) errors.push(`ARP: ${arpResult.error}`);
        else phases.push(`ARP: ${arpResult.phase ?? "ok"}`);

        try {
          const dhcpResult = await runDhcpPollForNetwork(parsed.data.network_id, targetIps ? { onlyIps: targetIps } : undefined);
          if (dhcpResult.error) errors.push(`DHCP: ${dhcpResult.error}`);
          else phases.push(`DHCP: ${dhcpResult.updated} host aggiornati`);
        } catch (e) {
          errors.push(`DHCP: ${e instanceof Error ? e.message : "errore"}`);
        }

        try {
          const dnsResult = await runDnsResolve(parsed.data.network_id, parsed.data.host_ids);
          phases.push(`DNS: ${dnsResult.resolved}/${dnsResult.total} risolti`);
        } catch (e) {
          errors.push(`DNS: ${e instanceof Error ? e.message : "errore"}`);
        }

        // Fresh sync LDAP opzionale (unica AD attiva — se 0 o >1 → skip)
        if (freshSync) {
          try {
            const { getAdIntegrations } = await import("@/lib/db");
            const enabled = getAdIntegrations().filter((i) => i.enabled);
            if (enabled.length === 0) {
              phases.push("AD sync: nessuna integrazione abilitata");
            } else if (enabled.length > 1) {
              phases.push(`AD sync: ${enabled.length} integrazioni attive (skip, abilitarne solo una)`);
            } else {
              const { syncActiveDirectory } = await import("@/lib/ad/ad-client");
              const r = await syncActiveDirectory(enabled[0].id);
              phases.push(`AD sync: ${r.computers} computer, ${r.users} utenti, ${r.linked_hosts} host linkati (${r.duration_ms}ms)`);
            }
          } catch (e) {
            errors.push(`AD sync: ${e instanceof Error ? e.message : "errore"}`);
          }
        }

        try {
          const adResult = relinkAdComputersForNetwork(parsed.data.network_id);
          phases.push(`AD relink: ${adResult.linked} linkati, ${adResult.enriched} arricchiti`);
        } catch (e) {
          errors.push(`AD relink: ${e instanceof Error ? e.message : "errore"}`);
        }

        const phaseMsg = phases.length > 0 ? phases.join(" · ") : "Enrich completato";
        const status = errors.length > 0 && phases.length === 0 ? "failed" : "completed";
        const statusText = phaseMsg + (errors.length > 0 ? ` (errori: ${errors.join("; ")})` : "");

        // Traccia in scan_history così il pannello acquisizione (fase 3b) mostra
        // last_run reale per "Enrich" invece di "mai eseguita" (bug fix 2026-07-27).
        try {
          addScanHistory({
            host_id: null,
            network_id: parsed.data.network_id,
            scan_type: "scan_enrich",
            status: statusText,
            ports_open: null,
            raw_output: errors.length > 0 ? errors.join("; ") : null,
            duration_ms: Date.now() - enrichStart,
          });
        } catch (e) {
          console.error("scan_enrich: scrittura scan_history fallita:", e);
        }

        return NextResponse.json({
          id: "scan-enrich",
          progress: {
            status,
            phase: statusText,
          },
        });
      }

      let nmapArgs: string | undefined;
      let snmpCommunity: string | null | undefined;
      let tcpPorts: string | null = null;
      let udpPorts: string | null = null;

      if (parsed.data.scan_type === "nmap") {
        const profile = parsed.data.nmap_profile_id
          ? getNmapProfileById(parsed.data.nmap_profile_id)
          : getActiveNmapProfile();
        if (profile) {
          tcpPorts = profile.tcp_ports ?? null;
          udpPorts = profile.udp_ports ?? null;
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

      const discoverOpts: import("@/lib/scanner/discovery").DiscoverNetworkOptions = {
        ...(targetIps ? { targetIps } : {}),
        tcpPorts,
        udpPorts,
      };

      const { id, progress } = await discoverNetwork(
        parsed.data.network_id,
        parsed.data.scan_type as import("@/lib/scanner/discovery").DiscoveryScanType,
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
  });
  return result;
}

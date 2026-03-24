import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { getSetting } from "@/lib/db";
import {
  NETWORK_DISCOVERY_QUICK_TCP_PORTS,
  NMAP_DEFAULT_TCP_PORTS,
  NMAP_DEFAULT_UDP_PORTS,
  getNetworkDiscoveryQuickHostTimeoutSeconds,
  getNetworkDiscoveryQuickConcurrency,
  getNetworkDiscoveryQuickExecMs,
  buildNetworkDiscoveryQuickTcpArgs,
  getNmapHostTimeoutSeconds,
  buildTcpScanArgs,
  buildUdpScanArgs,
  setGetSettingFn,
} from "@/lib/scanner/ports";

export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    // Inietta getSetting per leggere porte custom dal DB
    setGetSettingFn(getSetting);

    const customQuickPorts = getSetting("quick_scan_tcp_ports");

    return NextResponse.json({
      quickScan: {
        tcpPorts: customQuickPorts?.trim() || NETWORK_DISCOVERY_QUICK_TCP_PORTS,
        hostTimeoutSeconds: getNetworkDiscoveryQuickHostTimeoutSeconds(),
        concurrency: getNetworkDiscoveryQuickConcurrency(),
        execLimitMs: getNetworkDiscoveryQuickExecMs(),
        nmapArgs: buildNetworkDiscoveryQuickTcpArgs(),
      },
      fullScan: {
        defaultTcpPorts: NMAP_DEFAULT_TCP_PORTS,
        defaultUdpPorts: NMAP_DEFAULT_UDP_PORTS,
        hostTimeoutSeconds: getNmapHostTimeoutSeconds(),
        tcpArgs: buildTcpScanArgs(),
        udpArgs: buildUdpScanArgs(),
      },
      envOverrides: {
        DA_INVENT_NMAP_HOST_TIMEOUT_S: process.env.DA_INVENT_NMAP_HOST_TIMEOUT_S ?? null,
        DA_INVENT_NMAP_DISCOVERY_QUICK_TIMEOUT_S: process.env.DA_INVENT_NMAP_DISCOVERY_QUICK_TIMEOUT_S ?? null,
        DA_INVENT_NMAP_DISCOVERY_CONCURRENCY: process.env.DA_INVENT_NMAP_DISCOVERY_CONCURRENCY ?? null,
        DA_INVENT_NMAP_DISCOVERY_EXEC_MS: process.env.DA_INVENT_NMAP_DISCOVERY_EXEC_MS ?? null,
        DA_INVENT_FINGERPRINT: process.env.DA_INVENT_FINGERPRINT ?? null,
        DA_INVENT_FINGERPRINT_PROBES_MAX_HOSTS: process.env.DA_INVENT_FINGERPRINT_PROBES_MAX_HOSTS ?? null,
      },
    });
  } catch (e) {
    console.error("Error fetching scan config:", e);
    return NextResponse.json({ error: "Errore nel recupero configurazione scan" }, { status: 500 });
  }
}

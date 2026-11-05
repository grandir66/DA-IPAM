import { getActiveNmapProfile, getNmapProfileById } from "@/lib/db";
import { buildCustomScanArgs } from "./ports";

export interface ArgomentiNmap {
  nmapArgs?: string;
  snmpCommunity?: string | null;
  tcpPorts: string | null;
  udpPorts: string | null;
}

export const ARGOMENTI_VUOTI: ArgomentiNmap = { tcpPorts: null, udpPorts: null };

/** Argomenti di un giro `nmap`: dal profilo scelto o da quello attivo. Lo usano l'avvio singolo e le sequenze. */
export function argomentiNmap(profiloId?: number): ArgomentiNmap {
  const profile = profiloId ? getNmapProfileById(profiloId) : getActiveNmapProfile();
  if (!profile) return { ...ARGOMENTI_VUOTI, nmapArgs: buildCustomScanArgs(null) };
  const tcpPorts = profile.tcp_ports ?? null;
  const nmapArgs = tcpPorts
    ? undefined
    : profile.custom_ports !== null && profile.custom_ports !== undefined
      ? buildCustomScanArgs(profile.custom_ports)
      : profile.args;
  return {
    nmapArgs,
    snmpCommunity: profile.snmp_community || undefined,
    tcpPorts,
    udpPorts: profile.udp_ports ?? null,
  };
}

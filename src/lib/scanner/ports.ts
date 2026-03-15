/**
 * Port lists for nmap scans.
 * TCP e UDP vengono scansionati separatamente:
 *   -sT per TCP (non richiede root)
 *   -sU per UDP (richiede root, tentativo separato)
 */

/** Top 100 TCP ports by open frequency (from nmap-services) + 5001 (Synology/Docker HTTPS) */
export const NMAP_TOP_100_TCP =
  "80,23,443,21,22,25,3389,110,445,139,143,53,135,3306,8080,1723,111,995,993,5900,1025,587,8888,199,1720,465,548,113,81,6001,10000,514,5060,179,1026,2000,8443,8000,32768,554,26,1433,49152,2001,515,8008,49154,1027,5666,646,5000,5001,5631,631,49153,8081,2049,88,79,5800,106,2121,1110,49155,6000,513,990,5357,427,49156,543,544,5101,144,7,389,8009,3128,444,9999,5009,7070,5190,3000,5432,3986,1900,13,1029,9,6646,5051,49157,1028,873,1755,2717,4899,9100,119,37";

/** Known UDP ports: DNS, DHCP, TFTP, NTP, SNMP, syslog, IKE, etc. */
export const KNOWN_UDP_PORTS = "53,67,68,69,123,161,162,500,514,520,4500";

/**
 * Build nmap args per scansione TCP (non richiede root).
 * Top 100 TCP + porte esplicite, con version detection.
 * @param customPorts - Comma-separated additional TCP ports (e.g. "8080,8443")
 */
export function buildTcpScanArgs(customPorts?: string | null): string {
  const tcpExtra = (customPorts ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^\d+$/.test(p));
  const tcpSet = new Set([...NMAP_TOP_100_TCP.split(","), ...tcpExtra]);
  const tcpList = [...tcpSet].map(Number).sort((a, b) => a - b).join(",");
  return `-sT -p ${tcpList} -sV --version-intensity 0 -T4 --host-timeout 120s`;
}

/**
 * Build nmap args per scansione UDP (richiede root/sudo).
 * Porte UDP note: DNS, DHCP, TFTP, NTP, SNMP, syslog, etc.
 */
export function buildUdpScanArgs(): string {
  return `-sU -p ${KNOWN_UDP_PORTS} -T4 --host-timeout 60s`;
}

/** @deprecated Usa buildTcpScanArgs — mantenuto per retrocompatibilità */
export function buildCustomScanArgs(customPorts?: string | null): string {
  return buildTcpScanArgs(customPorts);
}

/**
 * Estrae solo la parte TCP da un args string che potrebbe contenere -sU.
 * Rimuove -sU, porte U:, --script snmp-info e relativi --script-args.
 */
export function stripUdpFromArgs(argsStr: string): string {
  const parts = argsStr.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let hasAnyScanType = false;
  let i = 0;
  while (i < parts.length) {
    if (parts[i] === "-sU") {
      i++;
      continue;
    }
    if (parts[i] === "-sS" || parts[i] === "-sT") {
      hasAnyScanType = true;
    }
    if (parts[i] === "--script" && i + 1 < parts.length && parts[i + 1].includes("snmp")) {
      i += 2;
      continue;
    }
    if (parts[i] === "--script-args" && i + 1 < parts.length && parts[i + 1].includes("snmp")) {
      i += 2;
      continue;
    }
    if (parts[i].startsWith("--script=") && parts[i].includes("snmp")) {
      i++;
      continue;
    }
    if (parts[i].startsWith("--script-args=") && parts[i].includes("snmp")) {
      i++;
      continue;
    }
    if (parts[i] === "-p" && i + 1 < parts.length) {
      const portSpec = parts[i + 1];
      const tcpPorts: number[] = [];
      let mode: "tcp" | "udp" = "tcp";
      for (const seg of portSpec.split(",")) {
        const s = seg.trim();
        if (s.startsWith("T:")) {
          mode = "tcp";
          const num = parseInt(s.slice(2), 10);
          if (!isNaN(num)) tcpPorts.push(num);
        } else if (s.startsWith("U:")) {
          mode = "udp";
        } else if (mode === "tcp") {
          const num = parseInt(s, 10);
          if (!isNaN(num)) tcpPorts.push(num);
        }
      }
      if (tcpPorts.length > 0) {
        out.push("-p", [...new Set(tcpPorts)].sort((a, b) => a - b).join(","));
      }
      i += 2;
      continue;
    }
    out.push(parts[i]);
    i++;
  }
  if (!hasAnyScanType && !out.includes("-sT")) {
    out.unshift("-sT");
  }
  return out.join(" ");
}

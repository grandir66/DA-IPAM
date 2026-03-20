/**
 * Port lists for nmap scans.
 * TCP e UDP vengono scansionati in sequenza (due invocazioni nmap distinte):
 *   1) -sT TCP (non richiede root)
 *   2) -sU UDP (richiede root; fallisce in modo silenzioso se non disponibile)
 *
 * Default allineato a profilo “infrastruttura” (servizi comuni + monitoring).
 */

/** Porte TCP predefinite (scan -sT + -sV --version-intensity 0 -T4 --host-timeout 120s) */
export const NMAP_DEFAULT_TCP_PORTS =
  "21,22,23,25,53,80,81,88,110,111,135,139,143,179,199,389,443,445,465,554,587,631,873,990,993,995,1433,1514,1515,1720,1723,2049,2121,3000,3128,3306,3389,4899,5000,5001,5060,5061,5100,5432,5631,5666,5800,5900,6000,6690,6789,7304,8000,8001,8006,8007,8080,8081,8291,8443,8554,8880,8888,9000,9100,9999,10000,10050,10051,17988,17990,34567,37777,49152,49153,49154,49155,49156,49157,55000";

/** Porte UDP predefinite (sudo nmap -sU …) */
export const NMAP_DEFAULT_UDP_PORTS =
  "53,67,68,69,123,161,162,500,514,520,521,623,1194,1900,4500,4789,5060,5353,10161";

/** @deprecated Usare NMAP_DEFAULT_TCP_PORTS */
export const NMAP_TOP_100_TCP = NMAP_DEFAULT_TCP_PORTS;

/** @deprecated Usare NMAP_DEFAULT_UDP_PORTS */
export const KNOWN_UDP_PORTS = NMAP_DEFAULT_UDP_PORTS;

/**
 * Build nmap args per scansione TCP (non richiede root).
 * Porte default + eventuali porte extra dal profilo.
 * @param customPorts - Porte TCP aggiuntive separate da virgola (es. "8444,9443")
 */
export function buildTcpScanArgs(customPorts?: string | null): string {
  const tcpExtra = (customPorts ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => /^\d+$/.test(p));
  const tcpSet = new Set([...NMAP_DEFAULT_TCP_PORTS.split(","), ...tcpExtra]);
  const tcpList = [...tcpSet].map(Number).sort((a, b) => a - b).join(",");
  return `-sT -p ${tcpList} -sV --version-intensity 0 -T4 --host-timeout 120s`;
}

/**
 * Build nmap args per scansione UDP (richiede privilegi root su molti sistemi).
 * Eseguita come seconda fase dopo il TCP in nmapPortScan.
 */
export function buildUdpScanArgs(): string {
  return `-sU -p ${NMAP_DEFAULT_UDP_PORTS} -sV --version-intensity 0 -T4 --host-timeout 120s`;
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

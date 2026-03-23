/**
 * Port lists for nmap scans.
 * TCP e UDP sono **sempre** due invocazioni `nmap` separate (`nmap.ts` → `nmapPortScan`):
 * non passare mai `-sT` e `-sU` nello stesso comando: in molti ambienti va in errore.
 *
 *   1) -sT TCP (non richiede root) — il profilo utente personalizza solo questa fase
 *   2) -sU UDP (richiede root; fallisce in modo silenzioso se non disponibile) — porte da `buildUdpScanArgs()`
 *
 * Default allineato a profilo “infrastruttura” (servizi comuni + monitoring).
 */

/** Porte TCP predefinite (scan -sT + -sV …; `--host-timeout` da `getNmapHostTimeoutSeconds()`, default 75s).
 *  Allineate a device fingerprinting (WinRM 5985, MikroTik API 8728, Stormshield 1300, IPMI 623 TCP). */
export const NMAP_DEFAULT_TCP_PORTS =
  "21,22,23,25,53,80,81,88,110,111,135,139,143,179,199,389,443,445,465,554,587,623,631,873,990,993,995,1300,1433,1514,1515,1720,1723,2049,2121,3000,3128,3306,3389,4899,5000,5001,5060,5061,5100,5432,5631,5666,5800,5900,5985,6000,6690,6789,7304,8000,8001,8006,8007,8080,8081,8291,8443,8554,8728,8880,8888,9000,9100,9999,10000,10050,10051,17988,17990,34567,37777,49152,49153,49154,49155,49156,49157,55000";

/** Porte UDP predefinite (sudo nmap -sU …) */
export const NMAP_DEFAULT_UDP_PORTS =
  "53,67,68,69,123,161,162,500,514,520,521,623,1194,1900,4500,4789,5060,5353,10161";

/** @deprecated Usare NMAP_DEFAULT_TCP_PORTS */
export const NMAP_TOP_100_TCP = NMAP_DEFAULT_TCP_PORTS;

/** @deprecated Usare NMAP_DEFAULT_UDP_PORTS */
export const KNOWN_UDP_PORTS = NMAP_DEFAULT_UDP_PORTS;

/** Timeout per singolo host durante scan porte TCP/UDP complete (default 75s — TLS/servizi lenti come Proxmox :8006). */
export function getNmapHostTimeoutSeconds(): number {
  const n = parseInt(process.env.DA_INVENT_NMAP_HOST_TIMEOUT_S || "75", 10);
  if (Number.isNaN(n)) return 75;
  return Math.min(180, Math.max(20, n));
}

/**
 * Porte TCP “quick” per scoperta rete dopo ICMP (SSH, HTTP/S, RDP, SMB, …).
 * Include **8291** (Winbox) e **8728** (API) MikroTik: la lista ridotta storica non le aveva e Nmap non le sondava
 * pur essendo in `NMAP_DEFAULT_TCP_PORTS` per lo scan profilo completo.
 * Include **88** (Kerberos), **139** (NetBIOS), **389** (LDAP), **636** (LDAPS) per Domain Controller / AD — altrimenti i DC
 * non mostrano LDAP in UI se si usa solo questa fase (network_discovery / ipam_full non rifanno lo scan TCP completo).
 */
export const NETWORK_DISCOVERY_QUICK_TCP_PORTS =
  "22,25,53,80,88,110,135,139,143,389,443,445,636,993,995,3389,8291,8728";

/** Timeout Nmap interno per fase quick (s). L’host è già verificato con ICMP. */
export function getNetworkDiscoveryQuickHostTimeoutSeconds(): number {
  const n = parseInt(process.env.DA_INVENT_NMAP_DISCOVERY_QUICK_TIMEOUT_S || "10", 10);
  if (Number.isNaN(n)) return 10;
  return Math.min(20, Math.max(5, n));
}

/** Host Nmap quick in parallelo (default 6). */
export function getNetworkDiscoveryQuickConcurrency(): number {
  const n = parseInt(process.env.DA_INVENT_NMAP_DISCOVERY_CONCURRENCY || "6", 10);
  if (Number.isNaN(n)) return 6;
  return Math.min(16, Math.max(1, n));
}

/** Limite duro (ms) sul processo `nmap` per host in fase quick. */
export function getNetworkDiscoveryQuickExecMs(): number {
  const n = parseInt(process.env.DA_INVENT_NMAP_DISCOVERY_EXEC_MS || "22000", 10);
  if (Number.isNaN(n)) return 22_000;
  return Math.min(90_000, Math.max(10_000, n));
}

/**
 * Profilo Nmap leggero: -Pn (già “up” da ICMP), TCP senza -sV, timing aggressivo.
 * Usato da `network_discovery`.
 */
export function buildNetworkDiscoveryQuickTcpArgs(): string {
  const ht = getNetworkDiscoveryQuickHostTimeoutSeconds();
  return `-Pn -sT -p ${NETWORK_DISCOVERY_QUICK_TCP_PORTS} -T5 --max-retries 1 --min-rate 150 --host-timeout ${ht}s`;
}

/**
 * Build nmap args per scansione TCP (non richiede root).
 * Porte default + eventuali porte extra dal profilo.
 * @param customPorts - Porte TCP aggiuntive separate da virgola (es. "8444,9443")
 */
/**
 * Build nmap args per scansione TCP.
 * @param customPorts - Porte TCP aggiuntive (legacy, merge con default)
 * @param explicitTcpPorts - Porte dal profilo Nmap (`tcp_ports`): vengono **unite** all’elenco predefinito
 *   (`NMAP_DEFAULT_TCP_PORTS`), non lo sostituiscono — così un profilo “ridotto” non esclude più servizi
 *   infrastrutturali (es. MikroTik 8291/8728 già nel default).
 */
export function buildTcpScanArgs(customPorts?: string | null, explicitTcpPorts?: string | null): string {
  const parsePortNums = (s: string) =>
    s
      .split(",")
      .map((p) => p.trim())
      .filter((p) => /^\d+$/.test(p));
  let tcpList: string;
  if (explicitTcpPorts && explicitTcpPorts.trim()) {
    const tcpSet = new Set([...parsePortNums(NMAP_DEFAULT_TCP_PORTS), ...parsePortNums(explicitTcpPorts)]);
    tcpList = [...tcpSet].map(Number).sort((a, b) => a - b).join(",");
  } else {
    const tcpExtra = parsePortNums(customPorts ?? "");
    const tcpSet = new Set([...NMAP_DEFAULT_TCP_PORTS.split(","), ...tcpExtra]);
    tcpList = [...tcpSet].map(Number).sort((a, b) => a - b).join(",");
  }
  const ht = getNmapHostTimeoutSeconds();
  /* -Pn: host già verificato online da ping/nmap-sn → salta host discovery di Nmap (evita falsi "down"); min-rate basso = meno perdite su rete congestionata */
  return `-Pn -sT -p ${tcpList} -sV --version-intensity 0 -T4 --max-retries 3 --min-rate 35 --host-timeout ${ht}s`;
}

/**
 * Build nmap args per scansione UDP (richiede privilegi root su molti sistemi).
 * Eseguita come seconda fase dopo il TCP in nmapPortScan.
 */
/**
 * Build nmap args per scansione UDP.
 * @param explicitUdpPorts - Elenco UDP esplicito (se presente, sovrascrive default)
 */
export function buildUdpScanArgs(explicitUdpPorts?: string | null): string {
  const udpList = explicitUdpPorts && explicitUdpPorts.trim()
    ? explicitUdpPorts.split(",").map((p) => p.trim()).filter((p) => /^\d+$/.test(p)).join(",")
    : NMAP_DEFAULT_UDP_PORTS;
  const ht = getNmapHostTimeoutSeconds();
  /* -Pn: host già verificato online; UDP scan spesso richiede root, -Pn evita doppio controllo liveness */
  return `-Pn -sU -p ${udpList} -sV --version-intensity 0 -T4 --max-retries 2 --min-rate 40 --host-timeout ${ht}s`;
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

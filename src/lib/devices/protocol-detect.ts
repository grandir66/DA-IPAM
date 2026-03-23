/**
 * Auto-detect del protocollo migliore per comunicare con un device di rete.
 * Probe sequenziale: WinRM (5985) → SSH (22) → SNMP (161 UDP) → API (443/8006/8728).
 */

import { tcpConnect } from "@/lib/scanner/tcp-check";

export interface DetectedProtocol {
  protocol: "winrm" | "ssh" | "snmp_v2" | "api" | null;
  port: number;
  /** Porte addizionali aperte (utili per classificazione) */
  openPorts: number[];
}

/** Porte da sondare con timeout (ms) per protocollo */
const PROBE_PORTS = [
  { port: 5985, protocol: "winrm" as const, label: "WinRM" },
  { port: 22, protocol: "ssh" as const, label: "SSH" },
  { port: 443, protocol: "api" as const, label: "HTTPS API" },
  { port: 8006, protocol: "api" as const, label: "Proxmox API" },
  { port: 8728, protocol: "api" as const, label: "MikroTik API" },
] as const;

/**
 * Rileva il protocollo migliore per un host.
 * Probing parallelo delle porte TCP + check SNMP UDP separato.
 */
export async function detectProtocol(host: string, timeoutMs = 3000): Promise<DetectedProtocol> {
  // Parallel TCP probing di tutte le porte
  const tcpResults = await Promise.all(
    PROBE_PORTS.map(async ({ port, protocol }) => ({
      port,
      protocol,
      open: await tcpConnect(host, port, timeoutMs),
    }))
  );

  const openPorts: number[] = tcpResults.filter((r) => r.open).map((r) => r.port);

  // SNMP UDP probe (invio SNMP GET sysDescr e attesa risposta)
  const snmpOpen = await probeSnmpUdp(host, 161, timeoutMs);
  if (snmpOpen) openPorts.push(161);

  // Priorità: WinRM > SSH > SNMP > API
  const winrm = tcpResults.find((r) => r.port === 5985 && r.open);
  if (winrm) return { protocol: "winrm", port: 5985, openPorts };

  const ssh = tcpResults.find((r) => r.port === 22 && r.open);
  if (ssh) return { protocol: "ssh", port: 22, openPorts };

  if (snmpOpen) return { protocol: "snmp_v2", port: 161, openPorts };

  const api = tcpResults.find((r) => r.open && r.protocol === "api");
  if (api) return { protocol: "api", port: api.port, openPorts };

  return { protocol: null, port: 0, openPorts };
}

/** Probe SNMP UDP: invia un GET sysDescr con community "public" */
function probeSnmpUdp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    // SNMP v2c GET sysDescr.0 (community "public") — pacchetto binario pre-costruito
    const snmpGetSysDescr = Buffer.from([
      0x30, 0x29, // SEQUENCE, length 41
      0x02, 0x01, 0x01, // version: v2c (1)
      0x04, 0x06, 0x70, 0x75, 0x62, 0x6c, 0x69, 0x63, // community: "public"
      0xa0, 0x1c, // GetRequest PDU
      0x02, 0x04, 0x00, 0x00, 0x00, 0x01, // request-id: 1
      0x02, 0x01, 0x00, // error-status: 0
      0x02, 0x01, 0x00, // error-index: 0
      0x30, 0x0e, // varbind list
      0x30, 0x0c, // varbind
      0x06, 0x08, 0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x01, 0x00, // OID: 1.3.6.1.2.1.1.1.0 (sysDescr)
      0x05, 0x00, // NULL value
    ]);

    import("dgram").then(({ createSocket }) => {
      const socket = createSocket("udp4");
      const timer = setTimeout(() => {
        socket.close();
        resolve(false);
      }, timeoutMs);

      socket.on("message", () => {
        clearTimeout(timer);
        socket.close();
        resolve(true);
      });

      socket.on("error", () => {
        clearTimeout(timer);
        socket.close();
        resolve(false);
      });

      socket.send(snmpGetSysDescr, 0, snmpGetSysDescr.length, port, host, (err) => {
        if (err) {
          clearTimeout(timer);
          socket.close();
          resolve(false);
        }
      });
    }).catch(() => resolve(false));
  });
}

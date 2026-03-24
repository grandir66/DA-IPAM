"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Radar, Zap, Terminal, ArrowRight, Wifi, Search } from "lucide-react";
import Link from "next/link";

interface ScanConfig {
  quickScan: {
    tcpPorts: string;
    hostTimeoutSeconds: number;
    concurrency: number;
    execLimitMs: number;
    nmapArgs: string;
  };
  fullScan: {
    defaultTcpPorts: string;
    defaultUdpPorts: string;
    hostTimeoutSeconds: number;
    tcpArgs: string;
    udpArgs: string;
  };
  envOverrides: Record<string, string | null>;
}

const WELL_KNOWN_PORTS: Record<number, string> = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
  67: "DHCP-S", 68: "DHCP-C", 69: "TFTP", 80: "HTTP", 110: "POP3",
  111: "RPC", 123: "NTP", 135: "RPC/WMI", 137: "NetBIOS", 139: "NetBIOS",
  143: "IMAP", 161: "SNMP", 162: "SNMP-Trap", 389: "LDAP", 443: "HTTPS",
  445: "SMB", 514: "Syslog", 515: "LPD", 554: "RTSP", 623: "IPMI",
  636: "LDAPS", 993: "IMAPS", 995: "POP3S", 1433: "MSSQL", 1514: "Wazuh",
  1723: "PPTP", 1883: "MQTT", 2049: "NFS", 3128: "Squid", 3306: "MySQL",
  3389: "RDP", 3990: "Yealink", 5000: "Synology", 5001: "Synology-S",
  5060: "SIP", 5432: "PostgreSQL", 5900: "VNC", 5985: "WinRM",
  5986: "WinRM-S", 6379: "Redis", 6690: "Synology Drive",
  8006: "Proxmox", 8080: "HTTP-Alt", 8291: "MikroTik WinBox",
  8443: "UniFi", 8728: "MikroTik API", 8880: "HTTP-Alt",
  9090: "Prometheus", 9100: "JetDirect", 10050: "Zabbix-Agent",
  10051: "Zabbix-Server", 17988: "iLO", 27017: "MongoDB",
  32400: "Plex",
};

function PortList({ ports, protocol }: { ports: string; protocol: "TCP" | "UDP" }) {
  const portNums = ports.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
  if (portNums.length === 0) return <span className="text-muted-foreground">Nessuna porta</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {portNums.map((p) => {
        const name = WELL_KNOWN_PORTS[p];
        return (
          <Badge key={p} variant="outline" className="font-mono text-[11px] py-0.5 px-1.5" title={name ?? `${protocol}/${p}`}>
            {p}
            {name && <span className="text-muted-foreground ml-1 font-sans">{name}</span>}
          </Badge>
        );
      })}
    </div>
  );
}

function EnvRow({ name, value, defaultValue, description }: { name: string; value: string | null; defaultValue: string; description: string }) {
  return (
    <tr className="border-b border-border/50">
      <td className="py-2 pr-3 font-mono text-xs text-primary">{name}</td>
      <td className="py-2 pr-3">
        {value ? (
          <Badge variant="default" className="font-mono text-xs">{value}</Badge>
        ) : (
          <span className="text-muted-foreground text-xs">{defaultValue}</span>
        )}
      </td>
      <td className="py-2 text-xs text-muted-foreground">{description}</td>
    </tr>
  );
}

export function QuickScanTab() {
  const [config, setConfig] = useState<ScanConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scan-config");
      if (res.ok) setConfig(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading || !config) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento…</CardContent></Card>;
  }

  return (
    <div className="space-y-6">
      {/* Quick Scan */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Scoperta rete veloce (Network Discovery)</CardTitle>
          </div>
          <CardDescription>
            Porte TCP scansionate durante la fase Nmap &quot;quick&quot; nella scoperta rete.
            Queste porte vengono testate su ogni host che risponde al ping ICMP.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Porte TCP quick scan ({config.quickScan.tcpPorts.split(",").length})</h4>
            <PortList ports={config.quickScan.tcpPorts} protocol="TCP" />
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="rounded-md border p-3 text-center">
              <div className="text-2xl font-bold">{config.quickScan.concurrency}</div>
              <div className="text-xs text-muted-foreground">Host paralleli</div>
            </div>
            <div className="rounded-md border p-3 text-center">
              <div className="text-2xl font-bold">{config.quickScan.hostTimeoutSeconds}s</div>
              <div className="text-xs text-muted-foreground">Timeout per host</div>
            </div>
            <div className="rounded-md border p-3 text-center">
              <div className="text-2xl font-bold">{Math.round(config.quickScan.execLimitMs / 1000)}s</div>
              <div className="text-xs text-muted-foreground">Limite exec Nmap</div>
            </div>
          </div>
          <div className="mt-3">
            <h4 className="text-sm font-medium mb-1">Comando Nmap generato</h4>
            <pre className="bg-muted/50 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
              nmap {config.quickScan.nmapArgs} &lt;ip&gt;
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Full Scan */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Scansione completa (Full Nmap)</CardTitle>
          </div>
          <CardDescription>
            Porte predefinite per la scansione Nmap completa. Possono essere sovrascritte dal profilo Nmap configurato nella tab &quot;Profilo Nmap&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Porte TCP default ({config.fullScan.defaultTcpPorts.split(",").length})</h4>
            <PortList ports={config.fullScan.defaultTcpPorts} protocol="TCP" />
          </div>
          <div>
            <h4 className="text-sm font-medium mb-2 mt-4">Porte UDP default ({config.fullScan.defaultUdpPorts.split(",").length})</h4>
            <PortList ports={config.fullScan.defaultUdpPorts} protocol="UDP" />
          </div>
          <div className="mt-3 space-y-2">
            <h4 className="text-sm font-medium">Comandi Nmap generati</h4>
            <pre className="bg-muted/50 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
              TCP: nmap {config.fullScan.tcpArgs} &lt;ip&gt;{"\n"}UDP: nmap {config.fullScan.udpArgs} &lt;ip&gt;
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* SNMP Match Logic */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Wifi className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Pipeline identificazione SNMP</CardTitle>
          </div>
          <CardDescription>
            Come vengono classificati i dispositivi durante la scoperta rete. Ogni fase ha priorità decrescente:
            la prima che matcha determina la classificazione.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { step: 1, name: "Profilo vendor SNMP", desc: "Match OID enterprise → vendor profile (confidenza ≥ 90%)", link: "/settings/snmp-profiles", linkLabel: "Gestisci profili" },
              { step: 2, name: "Hostname prefix", desc: 'Pattern hostname admin (es. "SW-" → switch, "AP-" → access point)', link: null, linkLabel: null },
              { step: 3, name: "sysObjectID Lookup", desc: "Match per prefisso più lungo nella tabella sysObjectID → vendor/prodotto", link: null, linkLabel: "Tab «sysObjectID Lookup»" },
              { step: 4, name: "Fingerprint OID probe", desc: "SNMP GETNEXT su prefissi OID per confermare tipo device (regole DB)", link: null, linkLabel: null },
              { step: 5, name: "Fingerprint snapshot", desc: "Mappa final_device del fingerprint → classificazione", link: null, linkLabel: null },
              { step: 6, name: "Classificatore generico", desc: "Regole su sysDescr, OID, porte, hostname, MAC vendor", link: null, linkLabel: null },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3 rounded-md border p-3">
                <Badge variant="outline" className="mt-0.5 shrink-0">{s.step}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.desc}</div>
                </div>
                {s.link && (
                  <Link href={s.link} className="text-xs text-primary hover:underline shrink-0 flex items-center gap-1">
                    {s.linkLabel} <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Environment Variables */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Variabili ambiente</CardTitle>
          </div>
          <CardDescription>
            Override delle impostazioni di scansione via variabili ambiente del server. Se non impostate, si usano i valori predefiniti.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-2 pr-3">Variabile</th>
                <th className="text-left py-2 pr-3">Valore</th>
                <th className="text-left py-2">Descrizione</th>
              </tr>
            </thead>
            <tbody>
              <EnvRow name="DA_INVENT_NMAP_HOST_TIMEOUT_S" value={config.envOverrides.DA_INVENT_NMAP_HOST_TIMEOUT_S} defaultValue="75" description="Timeout host scansione completa (sec)" />
              <EnvRow name="DA_INVENT_NMAP_DISCOVERY_QUICK_TIMEOUT_S" value={config.envOverrides.DA_INVENT_NMAP_DISCOVERY_QUICK_TIMEOUT_S} defaultValue="10" description="Timeout host quick scan (sec)" />
              <EnvRow name="DA_INVENT_NMAP_DISCOVERY_CONCURRENCY" value={config.envOverrides.DA_INVENT_NMAP_DISCOVERY_CONCURRENCY} defaultValue="6" description="Host scansionati in parallelo (quick)" />
              <EnvRow name="DA_INVENT_NMAP_DISCOVERY_EXEC_MS" value={config.envOverrides.DA_INVENT_NMAP_DISCOVERY_EXEC_MS} defaultValue="22000" description="Limite tempo exec Nmap quick (ms)" />
              <EnvRow name="DA_INVENT_FINGERPRINT" value={config.envOverrides.DA_INVENT_FINGERPRINT} defaultValue="true" description="Abilita/disabilita device fingerprint" />
              <EnvRow name="DA_INVENT_FINGERPRINT_PROBES_MAX_HOSTS" value={config.envOverrides.DA_INVENT_FINGERPRINT_PROBES_MAX_HOSTS} defaultValue="8" description="Max host per probe HTTP/SSH/SMB" />
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

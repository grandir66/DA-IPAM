"use client";

import { RigheRimando } from "@/components/opzioni/riga-rimando";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Radar, Zap, Terminal, Save, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { buildTcpScanArgs, buildUdpScanArgs } from "@/lib/scanner/ports";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NmapProfile {
  id: number;
  name: string;
  description: string;
  args: string;
  snmp_community: string | null;
  custom_ports: string | null;
  tcp_ports: string | null;
  udp_ports: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

type PortDiscoveryMode = "nmap" | "naabu+nmap";

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
  portDiscovery?: PortDiscoveryMode;
  naabuBinPath?: string;
  naabuAvailable?: boolean;
  envOverrides: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WELL_KNOWN_PORTS: Record<number, string> = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
  67: "DHCP-S", 68: "DHCP-C", 69: "TFTP", 80: "HTTP", 88: "Kerberos",
  110: "POP3", 111: "RPC", 123: "NTP", 135: "RPC/WMI", 137: "NetBIOS",
  139: "NetBIOS", 143: "IMAP", 161: "SNMP", 162: "SNMP-Trap",
  389: "LDAP", 443: "HTTPS", 445: "SMB", 514: "Syslog", 515: "LPD",
  541: "Stormshield", 542: "Stormshield", 554: "RTSP", 623: "IPMI",
  636: "LDAPS", 902: "VMware", 993: "IMAPS", 995: "POP3S",
  1433: "MSSQL", 1514: "Wazuh", 1723: "PPTP", 1883: "MQTT",
  2049: "NFS", 3128: "Squid", 3306: "MySQL", 3389: "RDP",
  3990: "Yealink", 4786: "Cisco SI", 5000: "Synology", 5001: "Synology-S",
  5060: "SIP", 5432: "PostgreSQL", 5900: "VNC", 5985: "WinRM",
  5986: "WinRM-S", 5988: "WBEM", 5989: "WBEM-S", 6379: "Redis",
  6690: "Synology Drive", 8006: "Proxmox", 8007: "Proxmox BS",
  8080: "HTTP-Alt", 8200: "MikroTik ND", 8291: "MikroTik WinBox",
  8443: "UniFi", 8728: "MikroTik API", 8729: "MikroTik API-S",
  8880: "HTTP-Alt", 9090: "Prometheus", 9100: "JetDirect", 9443: "VMware VC",
  10050: "Zabbix-Agent", 10051: "Zabbix-Server", 10443: "FortiGate",
  17988: "iLO", 27017: "MongoDB", 32400: "Plex",
};

function getNmapCommandForForm(form: { tcp_ports: string; udp_ports: string; snmp_community: string }): string {
  const tcpTrim = form.tcp_ports.trim();
  const udpTrim = form.udp_ports.trim();
  const tcp = tcpTrim ? buildTcpScanArgs(null, tcpTrim) : "— inserisci le porte TCP —";
  const udp = udpTrim ? buildUdpScanArgs(udpTrim) : "— nessuna UDP (solo TCP) —";
  const snmp = form.snmp_community?.trim()
    ? `SNMP (community profilo: ${form.snmp_community.trim()} + catena rete/credenziali)`
    : "SNMP (community da rete / credenziali)";
  return `TCP: nmap ${tcp} <ip>\nUDP: nmap ${udp} <ip>\n${snmp}`;
}

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScanConfigTab() {
  // --- Nmap profile state ---
  const [nmapProfile, setNmapProfile] = useState<NmapProfile | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: "",
    description: "",
    tcp_ports: "",
    udp_ports: "",
    snmp_community: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // --- Quick scan state ---
  const [config, setConfig] = useState<ScanConfig | null>(null);

  // --- Naabu / port discovery ---
  const [naabuAvailable, setNaabuAvailable] = useState<boolean | null>(null);

  // --- Env vars collapsible ---
  const [envOpen, setEnvOpen] = useState(false);

  // --- Loading ---
  const [loading, setLoading] = useState(true);

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------

  const loadAll = useCallback(async () => {
    try {
      const [profileRes, scanRes] = await Promise.all([fetch("/api/nmap-profiles"), fetch("/api/scan-config")]);

      // Nmap profile
      if (profileRes.ok) {
        const rows = (await profileRes.json()) as NmapProfile[];
        const profile = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        setNmapProfile(profile);
        if (profile) {
          setProfileForm({
            name: profile.name,
            description: profile.description,
            tcp_ports: profile.tcp_ports ?? "",
            udp_ports: profile.udp_ports ?? "",
            snmp_community: profile.snmp_community || "",
          });
        }
      }

      // Scan config (env-based defaults)
      if (scanRes.ok) {
        const sc = (await scanRes.json()) as ScanConfig;
        setConfig(sc);

        setNaabuAvailable(
          typeof sc.naabuAvailable === "boolean" ? sc.naabuAvailable : null
        );
      }
    } catch {
      toast.error("Errore nel caricamento configurazione scansione");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ---------------------------------------------------------------------------
  // Nmap profile save
  // ---------------------------------------------------------------------------

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileForm.name.trim()) {
      toast.error("Nome richiesto");
      return;
    }
    if (!profileForm.tcp_ports.trim()) {
      toast.error("Indica le porte TCP da testare (numeri separati da virgola, es. 22,80,443,445)");
      return;
    }

    setSavingProfile(true);
    try {
      const body: Record<string, unknown> = {
        name: profileForm.name,
        description: profileForm.description,
        args: "",
        custom_ports: null,
        tcp_ports: profileForm.tcp_ports.trim(),
        udp_ports: profileForm.udp_ports.trim(),
        snmp_community: profileForm.snmp_community.trim() || null,
      };
      if (nmapProfile) body.id = nmapProfile.id;

      const res = await fetch("/api/nmap-profiles", {
        method: nmapProfile ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success("Profilo Nmap salvato");
        const updated = await fetch("/api/nmap-profiles").then((r) => r.json()) as NmapProfile[];
        if (Array.isArray(updated) && updated.length > 0) setNmapProfile(updated[0]);
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nel salvataggio");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSavingProfile(false);
    }
  }


  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento...</CardContent></Card>;
  }

  return (
    <div className="space-y-6">

      {/* ================================================================= */}
      {/* Card 1 — Profilo Nmap (Scansione completa) */}
      {/* ================================================================= */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Profilo Nmap (Scansione completa)</CardTitle>
          </div>
          <CardDescription className="mt-1">
            Indica solo le porte che vuoi testare (TCP obbligatorie; UDP opzionali — se lasci vuoto UDP, non viene eseguita alcuna scansione UDP). Usato per scansioni Nmap manuali e job pianificati. La scoperta rete automatica resta in modalita veloce su altre porte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  value={profileForm.name}
                  onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="es. Il mio profilo"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Descrizione</Label>
                <Input
                  value={profileForm.description}
                  onChange={(e) => setProfileForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Note libere"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Porte TCP da testare</Label>
              <Textarea
                value={profileForm.tcp_ports}
                onChange={(e) => setProfileForm((f) => ({ ...f, tcp_ports: e.target.value }))}
                placeholder="es. 22,8006,443 — includi 8006 per l'interfaccia Proxmox (HTTPS)"
                className="font-mono text-sm min-h-[88px]"
                required
              />
              <p className="text-xs text-muted-foreground">
                Elenco separato da virgole. Solo queste porte TCP vengono usate nello scan con questo profilo (nessun elenco predefinito aggiunto dal sistema).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Porte UDP da testare (opzionale)</Label>
              <Textarea
                value={profileForm.udp_ports}
                onChange={(e) => setProfileForm((f) => ({ ...f, udp_ports: e.target.value }))}
                placeholder="es. 53,123,161,500 oppure lascia vuoto per non fare scan UDP"
                className="font-mono text-sm min-h-[88px]"
              />
              <p className="text-xs text-muted-foreground">
                Se lasci vuoto, <strong>non</strong> viene eseguita la fase UDP (solo TCP). La scansione UDP richiede spesso privilegi root sul server.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Community SNMP (opzionale)</Label>
              <Input
                value={profileForm.snmp_community}
                onChange={(e) => setProfileForm((f) => ({ ...f, snmp_community: e.target.value }))}
                placeholder="es. public"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Usata in sessione con Nmap per walk SNMP e rilevamento dispositivi (oltre alle community configurate per rete/credenziali).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Anteprima (comandi effettivi)</Label>
              <code className="block text-xs font-mono break-all bg-muted/50 px-2 py-1.5 rounded overflow-x-auto whitespace-pre-wrap">
                {getNmapCommandForForm(profileForm)}
              </code>
            </div>
            <Button type="submit" disabled={savingProfile}>
              <Save className="h-4 w-4 mr-2" />
              {savingProfile ? "Salvataggio..." : "Salva Profilo"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ================================================================= */}
      {/* Card 2 — Scoperta rete veloce (Quick Scan) */}
      {/* ================================================================= */}
      {config && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Scoperta rete veloce (Quick Scan)</CardTitle>
            </div>
            <CardDescription>
              Porte TCP scansionate durante la fase Nmap &quot;quick&quot; nella scoperta rete.
              Queste porte vengono testate su ogni host che risponde al ping ICMP.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Porte e numeri si cambiano da Opzioni (23/10): qui il riepilogo. I tre numeri valgono dal file dell'appliance. */}
            <RigheRimando
              ids={["parametro.quick_scan_tcp_ports", "parametro.quick_scan_concurrency", "parametro.quick_scan_host_timeout_s", "parametro.quick_scan_exec_limit_ms"]}
              mostraEsito={false}
            />
            {config.quickScan.tcpPorts && <PortList ports={config.quickScan.tcpPorts} protocol="TCP" />}

            <div className="mt-3">
              <h4 className="text-sm font-medium mb-1">Comando Nmap generato</h4>
              <pre className="bg-muted/50 rounded-md p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">
                nmap {config.quickScan.nmapArgs} &lt;ip&gt;
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================= */}
      {/* Card 3 — Port discovery (Naabu opzionale) */}
      {/* ================================================================= */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Port discovery TCP</CardTitle>
          </div>
          <CardDescription>
            Opzionale: pre-pass Naabu prima di Nmap mirato (-sV). Se Naabu non è installato, lo scan continua con Nmap only (fail-soft).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 max-w-2xl">
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div className="space-y-1">
              <Label htmlFor="port-discovery-naabu" className="text-sm font-medium">
                Naabu + Nmap
              </Label>
              <p className="text-xs text-muted-foreground">
                Off = solo Nmap (default). On = Naabu TCP poi Nmap -sV sulle porte trovate + porte sempre utili.
              </p>
              <RigheRimando ids={["automatismo.naabu"]} mostraEsito={false} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium">Naabu sul server</span>
              {naabuAvailable === true && (
                <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 dark:bg-green-950/30 dark:text-green-300">
                  naabu: disponibile
                </Badge>
              )}
              {naabuAvailable === false && (
                <Badge variant="outline" className="text-amber-800 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300">
                  naabu: non trovato
                </Badge>
              )}
              {naabuAvailable === null && (
                <Badge variant="outline" className="text-muted-foreground">
                  naabu: —
                </Badge>
              )}
            </div>
            <RigheRimando ids={["parametro.naabu_bin_path"]} mostraEsito={false} />
          </div>

        </CardContent>
      </Card>

      {/* ================================================================= */}
      {/* Card 4 — Variabili ambiente (collapsible) */}
      {/* ================================================================= */}
      {config && (
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setEnvOpen((o) => !o)}
          >
            <div className="flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              <CardTitle className="text-base flex-1">Variabili ambiente</CardTitle>
              {envOpen
                ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground" />
              }
            </div>
            <CardDescription>
              Override delle impostazioni di scansione via variabili ambiente del server. Se non impostate, si usano i valori predefiniti.
            </CardDescription>
          </CardHeader>
          {envOpen && (
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
          )}
        </Card>
      )}
    </div>
  );
}

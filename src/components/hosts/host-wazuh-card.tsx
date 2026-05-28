"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, RefreshCw, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface WazuhAgentRow {
  agent_id: string;
  host_id: number | null;
  name: string | null;
  ip: string | null;
  mac: string | null;
  hostname: string | null;
  os_platform: string | null;
  os_name: string | null;
  os_version: string | null;
  os_arch: string | null;
  agent_version: string | null;
  status: string | null;
  node_name: string | null;
  manager_host: string | null;
  last_keep_alive: string | null;
  synced_at: string;
}

interface WazuhHwRow {
  board_serial: string | null;
  board_vendor: string | null;
  board_product: string | null;
  cpu_name: string | null;
  cpu_cores: number | null;
  cpu_mhz: number | null;
  ram_total_kb: number | null;
}

interface WazuhOsRow {
  hostname: string | null;
  architecture: string | null;
  os_name: string | null;
  os_version: string | null;
  os_build: string | null;
  sysname: string | null;
}

interface WazuhSoftwareRow {
  id: number;
  name: string;
  version: string | null;
  vendor: string | null;
  architecture: string | null;
}

interface WazuhPortRow {
  id: number;
  protocol: string | null;
  local_ip: string | null;
  local_port: number | null;
  state: string | null;
  process: string | null;
  pid: number | null;
}

interface WazuhHotfixRow {
  id: number;
  hotfix: string;
  scan_time: string | null;
}

interface WazuhNetifaceRow {
  id: number;
  name: string;
  mac: string | null;
  type: string | null;
  state: string | null;
  mtu: number | null;
}

interface WazuhNetaddrRow {
  id: number;
  iface: string | null;
  proto: string | null;
  address: string;
  netmask: string | null;
}

interface WazuhVulnRow {
  id: number;
  cve: string;
  severity: string | null;
  cvss3_score: number | null;
  cvss2_score: number | null;
  package_name: string | null;
  package_version: string | null;
  package_architecture: string | null;
  status: string | null;
  detection_time: string | null;
  title: string | null;
  external_references: string | null;
}

interface WazuhProcessRow {
  id: number;
  pid: number;
  ppid: number | null;
  name: string | null;
  cmd: string | null;
  vm_size: number | null;
  resident_size: number | null;
  nlwp: number | null;
}

interface WazuhServiceRow {
  id: number;
  service_id: string;
  enabled: string | null;
  start_type: string | null;
  service_type: string | null;
  exit_code: number | null;
  process_pid: number | null;
  process_executable: string | null;
}

interface WazuhNetprotoRow {
  id: number;
  iface: string | null;
  type: string | null;
  gateway: string | null;
  dhcp: string | null;
}

interface Payload {
  hasAgent: boolean;
  agent?: WazuhAgentRow;
  hw?: WazuhHwRow | null;
  os?: WazuhOsRow | null;
  counts?: {
    software: number; vulns: number; vulnsCritical: number; vulnsHigh: number;
    ports: number; hotfixes: number; netifaces: number; netaddrs: number;
    processes: number; services: number; netproto: number;
  };
  software?: WazuhSoftwareRow[];
  vulns?: WazuhVulnRow[];
  ports?: WazuhPortRow[];
  hotfixes?: WazuhHotfixRow[];
  netifaces?: WazuhNetifaceRow[];
  netaddrs?: WazuhNetaddrRow[];
  netproto?: WazuhNetprotoRow[];
  processes?: WazuhProcessRow[];
  services?: WazuhServiceRow[];
}

function formatRam(kb: number | null | undefined): string {
  if (!kb) return "—";
  const gb = kb / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(kb / 1024).toFixed(0)} MB`;
}

function statusStyle(status: string | null): string {
  if (status === "active") return "text-green-700 dark:text-green-400";
  if (status === "disconnected") return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

export function HostWazuhCard({ hostId }: { hostId: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showSoftware, setShowSoftware] = useState(false);
  const [softwareData, setSoftwareData] = useState<WazuhSoftwareRow[] | null>(null);
  const [showVulns, setShowVulns] = useState(false);
  const [vulnsData, setVulnsData] = useState<WazuhVulnRow[] | null>(null);
  const [showPorts, setShowPorts] = useState(false);
  const [portsData, setPortsData] = useState<WazuhPortRow[] | null>(null);
  const [showHotfixes, setShowHotfixes] = useState(false);
  const [hotfixesData, setHotfixesData] = useState<WazuhHotfixRow[] | null>(null);
  const [showNetwork, setShowNetwork] = useState(false);
  const [networkData, setNetworkData] = useState<{ netifaces: WazuhNetifaceRow[]; netaddrs: WazuhNetaddrRow[]; netproto: WazuhNetprotoRow[] } | null>(null);
  const [showProcesses, setShowProcesses] = useState(false);
  const [processesData, setProcessesData] = useState<WazuhProcessRow[] | null>(null);
  const [showServices, setShowServices] = useState(false);
  const [servicesData, setServicesData] = useState<WazuhServiceRow[] | null>(null);

  const load = async (opts: { withSoftware?: boolean; withVulns?: boolean; withPorts?: boolean; withHotfixes?: boolean; withNetwork?: boolean; withProcesses?: boolean; withServices?: boolean } = {}) => {
    setLoading(true);
    try {
      const includes: string[] = [];
      if (opts.withSoftware) includes.push("software");
      if (opts.withVulns) includes.push("vulns");
      if (opts.withPorts) includes.push("ports");
      if (opts.withHotfixes) includes.push("hotfixes");
      if (opts.withNetwork) includes.push("network");
      if (opts.withProcesses) includes.push("processes");
      if (opts.withServices) includes.push("services");
      const qs = includes.length ? `?include=${includes.join(",")}` : "";
      const r = await fetch(`/api/integrations/wazuh/host/${hostId}${qs}`);
      if (!r.ok) { setData(null); return; }
      const d = (await r.json()) as Payload;
      setData(d);
      if (opts.withSoftware && d.software) setSoftwareData(d.software);
      if (opts.withVulns && d.vulns) setVulnsData(d.vulns);
      if (opts.withPorts && d.ports) setPortsData(d.ports);
      if (opts.withHotfixes && d.hotfixes) setHotfixesData(d.hotfixes);
      if (opts.withNetwork && (d.netifaces || d.netaddrs || d.netproto)) {
        setNetworkData({ netifaces: d.netifaces ?? [], netaddrs: d.netaddrs ?? [], netproto: d.netproto ?? [] });
      }
      if (opts.withProcesses && d.processes) setProcessesData(d.processes);
      if (opts.withServices && d.services) setServicesData(d.services);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [hostId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/integrations/wazuh/host/${hostId}`, { method: "POST" });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && d.ok) {
        toast.success("Dati Wazuh aggiornati");
        await load({ withSoftware: showSoftware, withVulns: showVulns, withPorts: showPorts, withHotfixes: showHotfixes, withNetwork: showNetwork, withProcesses: showProcesses, withServices: showServices });
      } else {
        toast.error(d.error ?? "Refresh fallito");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSoftware = async () => {
    if (!showSoftware && !softwareData) {
      await load({ withSoftware: true });
    }
    setShowSoftware((v) => !v);
  };

  const toggleVulns = async () => {
    if (!showVulns && !vulnsData) {
      await load({ withVulns: true });
    }
    setShowVulns((v) => !v);
  };

  const togglePorts = async () => {
    if (!showPorts && !portsData) {
      await load({ withPorts: true });
    }
    setShowPorts((v) => !v);
  };

  const toggleHotfixes = async () => {
    if (!showHotfixes && !hotfixesData) {
      await load({ withHotfixes: true });
    }
    setShowHotfixes((v) => !v);
  };

  const toggleNetwork = async () => {
    if (!showNetwork && !networkData) {
      await load({ withNetwork: true });
    }
    setShowNetwork((v) => !v);
  };

  const toggleProcesses = async () => {
    if (!showProcesses && !processesData) {
      await load({ withProcesses: true });
    }
    setShowProcesses((v) => !v);
  };

  const toggleServices = async () => {
    if (!showServices && !servicesData) {
      await load({ withServices: true });
    }
    setShowServices((v) => !v);
  };

  if (loading && !data) return null;
  if (!data?.hasAgent) return null;

  const { agent, hw, os, counts } = data;
  if (!agent) return null;

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          Wazuh agent <code className="text-xs font-mono">{agent.agent_id}</code>
          <span className={`text-xs ${statusStyle(agent.status)}`}>● {agent.status ?? "?"}</span>
        </CardTitle>
        <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
          Aggiorna
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
          <div><dt className="text-muted-foreground inline">Agent name:</dt> <dd className="inline font-mono text-xs">{agent.name ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground inline">Manager:</dt> <dd className="inline">{agent.manager_host ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground inline">Versione agent:</dt> <dd className="inline">{agent.agent_version ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground inline">OS:</dt> <dd className="inline">{os?.os_name ?? agent.os_name ?? "—"} {os?.os_version ?? agent.os_version ?? ""}</dd></div>
          <div><dt className="text-muted-foreground inline">Architettura:</dt> <dd className="inline">{os?.architecture ?? agent.os_arch ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground inline">Build:</dt> <dd className="inline font-mono text-xs">{os?.os_build ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground inline">MAC matchato:</dt> <dd className="inline font-mono text-xs">{agent.mac ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground inline">Last keepalive:</dt> <dd className="inline text-xs">{agent.last_keep_alive ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground inline">Sync DA-IPAM:</dt> <dd className="inline text-xs">{agent.synced_at}</dd></div>
        </dl>

        {hw && (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs space-y-1">
            <div className="font-medium text-muted-foreground">Hardware (syscollector)</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4">
              <div>CPU: {hw.cpu_name ?? "—"}</div>
              <div>Core: {hw.cpu_cores ?? "—"} @ {hw.cpu_mhz ? `${hw.cpu_mhz.toFixed(0)} MHz` : "—"}</div>
              <div>RAM: {formatRam(hw.ram_total_kb)}</div>
              <div>Board: {hw.board_vendor ?? "—"} {hw.board_product ?? ""}</div>
              <div>Serial: <code className="font-mono">{hw.board_serial ?? "—"}</code></div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 text-xs flex-wrap">
          <button onClick={toggleSoftware} className="inline-flex items-center gap-1 hover:underline">
            {showSoftware ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <strong>{counts?.software ?? 0}</strong> pacchetti software
          </button>
          <span className="text-muted-foreground">·</span>
          {counts && counts.vulns > 0 ? (
            <button onClick={toggleVulns} className="inline-flex items-center gap-1 hover:underline">
              {showVulns ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <strong>{counts.vulns}</strong> CVE Wazuh
              <span className="text-muted-foreground">
                ({counts.vulnsCritical} crit · {counts.vulnsHigh} high)
              </span>
            </button>
          ) : (
            <span>
              <strong>0</strong> CVE Wazuh
              <span className="ml-1 text-amber-700 dark:text-amber-400 text-[10px]">
                · richiede utente OpenSearch in config Wazuh
              </span>
            </span>
          )}
          {counts && counts.ports > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <button onClick={togglePorts} className="inline-flex items-center gap-1 hover:underline">
                {showPorts ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <strong>{counts.ports}</strong> porte in ascolto
              </button>
            </>
          )}
          {counts && counts.hotfixes > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <button onClick={toggleHotfixes} className="inline-flex items-center gap-1 hover:underline">
                {showHotfixes ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <strong>{counts.hotfixes}</strong> patch KB
              </button>
            </>
          )}
          {counts && (counts.netifaces > 0 || counts.netaddrs > 0 || counts.netproto > 0) && (
            <>
              <span className="text-muted-foreground">·</span>
              <button onClick={toggleNetwork} className="inline-flex items-center gap-1 hover:underline">
                {showNetwork ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <strong>{counts.netifaces}</strong> if · <strong>{counts.netaddrs}</strong> IP{counts.netproto > 0 ? <> · <strong>{counts.netproto}</strong> route</> : null}
              </button>
            </>
          )}
          {counts && counts.processes > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <button onClick={toggleProcesses} className="inline-flex items-center gap-1 hover:underline">
                {showProcesses ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <strong>{counts.processes}</strong> processi
              </button>
            </>
          )}
          {counts && counts.services > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              <button onClick={toggleServices} className="inline-flex items-center gap-1 hover:underline">
                {showServices ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <strong>{counts.services}</strong> servizi
              </button>
            </>
          )}
        </div>

        {showSoftware && softwareData && (
          <div className="rounded-md border max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Nome</th>
                  <th className="text-left px-2 py-1">Versione</th>
                  <th className="text-left px-2 py-1">Vendor</th>
                  <th className="text-left px-2 py-1">Arch</th>
                </tr>
              </thead>
              <tbody>
                {softwareData.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-2 py-1">{s.name}</td>
                    <td className="px-2 py-1 font-mono">{s.version ?? "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground">{s.vendor ?? "—"}</td>
                    <td className="px-2 py-1 text-muted-foreground">{s.architecture ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showVulns && vulnsData && (
          <div className="rounded-md border max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">CVE</th>
                  <th className="text-left px-2 py-1 w-20">Severity</th>
                  <th className="text-right px-2 py-1 w-14">CVSS</th>
                  <th className="text-left px-2 py-1">Pacchetto</th>
                  <th className="text-left px-2 py-1">Versione</th>
                  <th className="text-left px-2 py-1 w-32">Rilevato</th>
                </tr>
              </thead>
              <tbody>
                {vulnsData.map((v) => {
                  const refUrl = v.external_references
                    ? v.external_references.split(/[\n,]+/).find((s) => s.trim().startsWith("http"))?.trim() ?? null
                    : null;
                  const cveHref = refUrl ?? `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(v.cve)}`;
                  return (
                    <tr key={v.id} className="border-t">
                      <td className="px-2 py-1 font-mono">
                        <a href={cveHref} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {v.cve}
                        </a>
                      </td>
                      <td className="px-2 py-1">
                        <span className={severityBadge(v.severity)}>{v.severity ?? "—"}</span>
                      </td>
                      <td className="px-2 py-1 font-mono text-right">
                        {v.cvss3_score?.toFixed(1) ?? v.cvss2_score?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-2 py-1">{v.package_name ?? "—"}</td>
                      <td className="px-2 py-1 font-mono text-muted-foreground">{v.package_version ?? "—"}</td>
                      <td className="px-2 py-1 text-muted-foreground text-[10px]">
                        {v.detection_time ? new Date(v.detection_time).toLocaleDateString("it-IT") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-[10px] text-muted-foreground px-2 py-1 border-t bg-muted/30">
              Fonte: <strong>Wazuh OpenSearch</strong> · indice <code>wazuh-states-vulnerabilities-*</code> · le finding di vuln scanner (Edge) restano nella card separata sopra.
            </div>
          </div>
        )}

        {showPorts && portsData && (
          <div className="rounded-md border max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1 w-16">Proto</th>
                  <th className="text-left px-2 py-1">IP locale</th>
                  <th className="text-right px-2 py-1 w-20">Porta</th>
                  <th className="text-left px-2 py-1">Processo</th>
                  <th className="text-right px-2 py-1 w-20">PID</th>
                </tr>
              </thead>
              <tbody>
                {portsData.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-2 py-1 font-mono uppercase">{p.protocol ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-muted-foreground">{p.local_ip ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{p.local_port ?? "—"}</td>
                    <td className="px-2 py-1">{p.process ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-right text-muted-foreground">{p.pid ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-muted-foreground px-2 py-1 border-t bg-muted/30">
              Fonte: <strong>Wazuh syscollector</strong> · solo state=listening · aggiornato a ogni sync.
            </div>
          </div>
        )}

        {showHotfixes && hotfixesData && (
          <div className="rounded-md border max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Patch (KB)</th>
                  <th className="text-left px-2 py-1 w-40">Rilevato</th>
                </tr>
              </thead>
              <tbody>
                {hotfixesData.map((h) => (
                  <tr key={h.id} className="border-t">
                    <td className="px-2 py-1 font-mono">
                      <a
                        href={`https://support.microsoft.com/help/${encodeURIComponent(h.hotfix.replace(/^KB/i, ""))}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline"
                      >
                        {h.hotfix}
                      </a>
                    </td>
                    <td className="px-2 py-1 text-muted-foreground text-[10px]">
                      {h.scan_time ? new Date(h.scan_time).toLocaleString("it-IT") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-muted-foreground px-2 py-1 border-t bg-muted/30">
              Fonte: <strong>Wazuh syscollector hotfixes</strong> · solo agent Windows · link a Microsoft Support.
            </div>
          </div>
        )}

        {showNetwork && networkData && (
          <div className="space-y-2">
            {networkData.netifaces.length > 0 && (
              <div className="rounded-md border max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1">Interfaccia</th>
                      <th className="text-left px-2 py-1">MAC</th>
                      <th className="text-left px-2 py-1 w-20">Tipo</th>
                      <th className="text-left px-2 py-1 w-16">Stato</th>
                      <th className="text-right px-2 py-1 w-16">MTU</th>
                    </tr>
                  </thead>
                  <tbody>
                    {networkData.netifaces.map((n) => (
                      <tr key={n.id} className="border-t">
                        <td className="px-2 py-1 font-mono">{n.name}</td>
                        <td className="px-2 py-1 font-mono text-muted-foreground">{n.mac ?? "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground">{n.type ?? "—"}</td>
                        <td className="px-2 py-1">
                          <span className={n.state === "up" ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}>
                            {n.state ?? "—"}
                          </span>
                        </td>
                        <td className="px-2 py-1 font-mono text-right text-muted-foreground">{n.mtu ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {networkData.netaddrs.length > 0 && (
              <div className="rounded-md border max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 w-24">Interfaccia</th>
                      <th className="text-left px-2 py-1 w-16">Proto</th>
                      <th className="text-left px-2 py-1">Indirizzo</th>
                      <th className="text-left px-2 py-1">Netmask</th>
                    </tr>
                  </thead>
                  <tbody>
                    {networkData.netaddrs.map((a) => (
                      <tr key={a.id} className="border-t">
                        <td className="px-2 py-1 font-mono">{a.iface ?? "—"}</td>
                        <td className="px-2 py-1 font-mono uppercase text-muted-foreground">{a.proto ?? "—"}</td>
                        <td className="px-2 py-1 font-mono">{a.address}</td>
                        <td className="px-2 py-1 font-mono text-muted-foreground">{a.netmask ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {networkData.netproto.length > 0 && (
              <div className="rounded-md border max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 w-24">Interfaccia</th>
                      <th className="text-left px-2 py-1 w-16">Tipo</th>
                      <th className="text-left px-2 py-1">Gateway</th>
                      <th className="text-left px-2 py-1 w-20">DHCP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {networkData.netproto.map((n) => (
                      <tr key={n.id} className="border-t">
                        <td className="px-2 py-1 font-mono">{n.iface ?? "—"}</td>
                        <td className="px-2 py-1 font-mono uppercase text-muted-foreground">{n.type ?? "—"}</td>
                        <td className="px-2 py-1 font-mono">{n.gateway ?? "—"}</td>
                        <td className="px-2 py-1 text-muted-foreground">{n.dhcp ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground">
              Fonte: <strong>Wazuh syscollector netiface + netaddr + netproto</strong>.
            </div>
          </div>
        )}

        {showProcesses && processesData && (
          <div className="rounded-md border max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Processo</th>
                  <th className="text-right px-2 py-1 w-20">PID</th>
                  <th className="text-right px-2 py-1 w-20">PPID</th>
                  <th className="text-right px-2 py-1 w-24">VM (MB)</th>
                  <th className="text-right px-2 py-1 w-20">Thread</th>
                </tr>
              </thead>
              <tbody>
                {processesData.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-2 py-1 font-mono" title={p.cmd ?? undefined}>{p.name ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{p.pid}</td>
                    <td className="px-2 py-1 font-mono text-right text-muted-foreground">{p.ppid ?? "—"}</td>
                    <td className="px-2 py-1 font-mono text-right">{p.vm_size ? (p.vm_size / 1024).toFixed(1) : "—"}</td>
                    <td className="px-2 py-1 font-mono text-right text-muted-foreground">{p.nlwp ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-muted-foreground px-2 py-1 border-t bg-muted/30">
              Fonte: <strong>Wazuh syscollector processes</strong> · top 50 per VM size · snapshot ultima scansione.
            </div>
          </div>
        )}

        {showServices && servicesData && (
          <div className="rounded-md border max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="text-left px-2 py-1">Servizio</th>
                  <th className="text-left px-2 py-1 w-20">Avvio</th>
                  <th className="text-left px-2 py-1 w-20">Stato</th>
                  <th className="text-left px-2 py-1">Eseguibile</th>
                  <th className="text-right px-2 py-1 w-16">PID</th>
                </tr>
              </thead>
              <tbody>
                {servicesData.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td className="px-2 py-1 font-mono">{s.service_id}</td>
                    <td className="px-2 py-1 text-muted-foreground">{s.start_type ?? "—"}</td>
                    <td className="px-2 py-1">
                      <span className={s.enabled === "true" ? "text-green-700 dark:text-green-400" : "text-muted-foreground"}>
                        {s.enabled === "true" ? "abilitato" : (s.enabled === "false" ? "disabilitato" : "—")}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono text-muted-foreground text-[10px] truncate max-w-[280px]" title={s.process_executable ?? undefined}>
                      {s.process_executable ?? "—"}
                    </td>
                    <td className="px-2 py-1 font-mono text-right text-muted-foreground">{s.process_pid ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-muted-foreground px-2 py-1 border-t bg-muted/30">
              Fonte: <strong>Wazuh syscollector services</strong> · disponibile da Wazuh 4.13+.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function severityBadge(sev: string | null): string {
  const base = "inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ";
  switch (sev) {
    case "Critical": return base + "bg-red-600 text-white";
    case "High":     return base + "bg-orange-500 text-white";
    case "Medium":   return base + "bg-amber-500 text-black";
    case "Low":      return base + "bg-blue-500 text-white";
    default:         return base + "bg-muted text-muted-foreground";
  }
}

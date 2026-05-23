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

interface Payload {
  hasAgent: boolean;
  agent?: WazuhAgentRow;
  hw?: WazuhHwRow | null;
  os?: WazuhOsRow | null;
  counts?: { software: number; vulns: number; vulnsCritical: number; vulnsHigh: number };
  software?: WazuhSoftwareRow[];
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

  const load = async (withSoftware = false) => {
    setLoading(true);
    try {
      const url = `/api/integrations/wazuh/host/${hostId}${withSoftware ? "?include=software" : ""}`;
      const r = await fetch(url);
      if (!r.ok) { setData(null); return; }
      const d = (await r.json()) as Payload;
      setData(d);
      if (withSoftware && d.software) setSoftwareData(d.software);
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
        await load(showSoftware);
      } else {
        toast.error(d.error ?? "Refresh fallito");
      }
    } finally {
      setRefreshing(false);
    }
  };

  const toggleSoftware = async () => {
    if (!showSoftware && !softwareData) {
      await load(true);
    }
    setShowSoftware((v) => !v);
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

        <div className="flex items-center gap-3 text-xs">
          <button onClick={toggleSoftware} className="inline-flex items-center gap-1 hover:underline">
            {showSoftware ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            <strong>{counts?.software ?? 0}</strong> pacchetti software
          </button>
          <span className="text-muted-foreground">·</span>
          <span>
            <strong>{counts?.vulns ?? 0}</strong> CVE
            {counts && counts.vulns > 0 && (
              <span className="ml-1 text-muted-foreground">
                ({counts.vulnsCritical} critical, {counts.vulnsHigh} high)
              </span>
            )}
          </span>
          {counts && counts.vulns === 0 && (
            <span className="text-amber-700 dark:text-amber-400 text-[10px]">
              · CVE non disponibili (richiede utente OpenSearch — vedi config Wazuh)
            </span>
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
      </CardContent>
    </Card>
  );
}

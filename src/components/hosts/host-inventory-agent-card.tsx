"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Link from "next/link";
import { Cpu, HardDrive, Loader2, Monitor, Network, PackageSearch, RefreshCw, Search, Server, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import type { ParsedGlpiInventoryProfile } from "@/lib/inventory-agent/parse-glpi-inventory";

interface InvSoftwareRow {
  id: number;
  name: string;
  version: string | null;
  publisher: string | null;
  install_date: string | null;
}

interface InvLicenseRow {
  id: number;
  name: string;
  full_name: string | null;
  product_id: string | null;
  license_key: string | null;
  trial: number | null;
  activation_date: string | null;
}

interface InvRuntimeRow {
  id: number;
  category: "database" | "remote_mgmt" | "firewall" | "process";
  name: string;
  version: string | null;
  status: string | null;
  port: number | null;
  user_name: string | null;
  command_line: string | null;
}

interface VulnSummary {
  max_severity: string;
  critical: number;
  high: number;
  medium: number;
  total: number;
}

interface InvEndpoint {
  device_id: string;
  hostname: string | null;
  primary_ip: string | null;
  os_name: string | null;
  os_version: string | null;
  last_seen_at: string;
}

interface InvAgentResponse {
  enabled: boolean;
  endpoint: InvEndpoint | null;
  software: InvSoftwareRow[];
  licenses: InvLicenseRow[];
  runtime: InvRuntimeRow[];
  profile: ParsedGlpiInventoryProfile | null;
  process_count?: number;
  vuln_summary?: VulnSummary | null;
  security_flags?: {
    remote_mgmt_count: number;
    firewall_off: boolean;
    av_disabled: boolean;
    av_outdated: boolean;
  };
  license_keys_visible?: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

function formatMb(mb: number | null): string {
  if (mb == null) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function ProfileSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {title}
      </div>
      {children}
    </div>
  );
}

function ProfileGrid({ items }: { items: Array<{ label: string; value: string | null | undefined }> }) {
  const visible = items.filter((i) => i.value);
  if (visible.length === 0) return <p className="text-xs text-muted-foreground">Nessun dato</p>;
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {visible.map((item) => (
        <div key={item.label} className="flex gap-2 min-w-0">
          <dt className="text-muted-foreground shrink-0">{item.label}:</dt>
          <dd className="truncate">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function InventoryProfilePanel({ profile }: { profile: ParsedGlpiInventoryProfile }) {
  const hw = profile.hardware;
  const bios = profile.bios;
  const serial = hw.serial ?? bios?.system_serial ?? bios?.motherboard_serial ?? null;
  const model = hw.model ?? bios?.system_model ?? bios?.motherboard_model ?? null;
  const manufacturer =
    hw.manufacturer ?? bios?.system_manufacturer ?? bios?.motherboard_manufacturer ?? null;
  const totalRamMb =
    profile.memories.reduce((s, m) => s + (m.capacity_mb ?? 0), 0) || hw.memory_mb;
  const totalDiskMb = profile.storages.reduce((s, d) => s + (d.size_mb ?? 0), 0);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ProfileSection title="Sistema" icon={Monitor}>
        <ProfileGrid
          items={[
            { label: "Modello hardware", value: model },
            { label: "Produttore", value: manufacturer },
            { label: "Numero di serie", value: serial },
            { label: "Tipo prodotto", value: hw.chassis_type },
            { label: "UUID", value: hw.uuid },
            { label: "VM/Hypervisor", value: hw.vm_system },
            { label: "Utente loggato", value: hw.last_logged_user },
            { label: "Workgroup/AD", value: hw.workgroup },
            { label: "Gateway", value: hw.default_gateway },
            { label: "DNS", value: hw.dns },
            { label: "RAM totale", value: totalRamMb ? formatMb(totalRamMb) : null },
          ]}
        />
      </ProfileSection>

      {bios && (bios.version || bios.date || bios.asset_tag) && (
        <ProfileSection title="BIOS / firmware" icon={Shield}>
          <ProfileGrid
            items={[
              { label: "Versione firmware", value: bios.version },
              { label: "Data firmware", value: bios.date },
              { label: "Asset tag", value: bios.asset_tag },
            ]}
          />
        </ProfileSection>
      )}

      {profile.cpus.length > 0 && (
        <ProfileSection title="CPU" icon={Cpu}>
          <ul className="space-y-1 text-xs">
            {profile.cpus.map((cpu, i) => (
              <li key={i} className="border-t first:border-t-0 pt-1 first:pt-0">
                <span className="font-medium">{cpu.name ?? "CPU"}</span>
                {cpu.cores != null && <span className="text-muted-foreground"> · {cpu.cores} core</span>}
                {cpu.threads != null && cpu.threads !== cpu.cores && (
                  <span className="text-muted-foreground"> / {cpu.threads} thread</span>
                )}
                {cpu.speed_mhz != null && (
                  <span className="text-muted-foreground"> · {cpu.speed_mhz} MHz</span>
                )}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {profile.storages.length > 0 && (
        <ProfileSection title="Dischi" icon={HardDrive}>
          <ul className="space-y-1 text-xs">
            {profile.storages.map((disk, i) => (
              <li key={i} className="border-t first:border-t-0 pt-1 first:pt-0">
                <span className="font-medium">{disk.model ?? disk.name ?? "Disco"}</span>
                {disk.size_mb != null && <span className="text-muted-foreground"> · {formatMb(disk.size_mb)}</span>}
                {disk.interface && <span className="text-muted-foreground"> · {disk.interface}</span>}
              </li>
            ))}
          </ul>
          {totalDiskMb > 0 && (
            <p className="text-[10px] text-muted-foreground pt-1">Totale: {formatMb(totalDiskMb)}</p>
          )}
        </ProfileSection>
      )}

      {profile.networks.length > 0 && (
        <ProfileSection title="Interfacce di rete" icon={Network}>
          <ul className="space-y-1 text-xs">
            {profile.networks.map((n, i) => (
              <li key={i} className="border-t first:border-t-0 pt-1 first:pt-0 font-mono">
                {n.ip ?? "—"}
                {n.mac && <span className="text-muted-foreground font-sans"> · {n.mac}</span>}
                {n.description && <span className="text-muted-foreground font-sans"> · {n.description}</span>}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {profile.antivirus.length > 0 && (
        <ProfileSection title="Antivirus" icon={Shield}>
          <ul className="space-y-1 text-xs">
            {profile.antivirus.map((av, i) => (
              <li key={i}>
                {av.name ?? av.company ?? "AV"}
                {av.version && <span className="text-muted-foreground"> v{av.version}</span>}
                {av.enabled != null && (
                  <Badge variant={av.enabled ? "secondary" : "outline"} className="ml-2 text-[10px]">
                    {av.enabled ? "attivo" : "off"}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}

      {profile.users.length > 0 && (
        <ProfileSection title="Account locali" icon={User}>
          <p className="text-xs text-muted-foreground mb-1">{profile.users.length} account rilevati</p>
          <ul className="space-y-0.5 text-xs max-h-24 overflow-y-auto">
            {profile.users.slice(0, 12).map((u, i) => (
              <li key={i}>
                {u.domain ? `${u.domain}\\` : ""}
                {u.login ?? "—"}
              </li>
            ))}
          </ul>
        </ProfileSection>
      )}
    </div>
  );
}

export function HostInventoryAgentCard({ hostId }: { hostId: number }) {
  const [data, setData] = useState<InvAgentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/hosts/${hostId}/inventory-agent`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as InvAgentResponse);
    } catch {
      toast.error("Errore caricamento inventario agent");
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filteredSoftware = useMemo(() => {
    if (!data?.software) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.software;
    return data.software.filter(
      (sw) =>
        sw.name.toLowerCase().includes(q) ||
        (sw.publisher?.toLowerCase().includes(q) ?? false) ||
        (sw.version?.toLowerCase().includes(q) ?? false),
    );
  }, [data?.software, filter]);

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" />
        Caricamento inventario agent…
      </div>
    );
  }

  if (!data?.enabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Modulo Inventory Agent non installato. Abilitalo in Impostazioni → Moduli.
      </p>
    );
  }

  if (!data.endpoint) {
    return (
      <p className="text-sm text-muted-foreground">
        Nessun report GLPI Agent associato a questo host (ID {hostId}). Se l&apos;endpoint compare in
        Impostazioni ma con host diverso, apri l&apos;oggetto con IP/hostname corrispondente.
      </p>
    );
  }

  const ep = data.endpoint;
  const total = data.software.length;
  const profile = data.profile;
  const licenses = data.licenses ?? [];
  const runtime = data.runtime ?? [];
  const securityRuntime = runtime.filter((r) => r.category !== "process");
  const processes = runtime.filter((r) => r.category === "process");
  const processTotal = data.process_count ?? processes.length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <PackageSearch className="h-3 w-3" />
            GLPI Agent push
          </Badge>
          <Badge variant="secondary">{total} software</Badge>
          {licenses.length > 0 && <Badge variant="secondary">{licenses.length} licenze</Badge>}
          {data.vuln_summary && data.vuln_summary.total > 0 && (
            <Link href="/vulnerabilities" className="inline-flex">
              <Badge variant="destructive" className="gap-1">
                {data.vuln_summary.critical + data.vuln_summary.high} CVE Critical/High
              </Badge>
            </Link>
          )}
          <span>Ultimo report: {formatDate(ep.last_seen_at)}</span>
          {ep.os_name && (
            <span>
              {ep.os_name} {ep.os_version ?? ""}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => void fetchData()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {data.security_flags &&
        (data.security_flags.firewall_off ||
          data.security_flags.av_disabled ||
          data.security_flags.av_outdated ||
          data.security_flags.remote_mgmt_count > 0) && (
          <div className="flex flex-wrap gap-2 text-[10px]">
            {data.security_flags.remote_mgmt_count > 0 && (
              <Badge variant="outline">Remote mgmt: {data.security_flags.remote_mgmt_count}</Badge>
            )}
            {data.security_flags.firewall_off && <Badge variant="destructive">Firewall off</Badge>}
            {data.security_flags.av_disabled && <Badge variant="destructive">AV disattivo</Badge>}
            {data.security_flags.av_outdated && <Badge variant="secondary">AV non aggiornato</Badge>}
          </div>
        )}

      <Tabs defaultValue="hardware">
        <TabsList className="h-8">
          <TabsTrigger value="hardware" className="text-xs">Hardware</TabsTrigger>
          <TabsTrigger value="software" className="text-xs">Software ({total})</TabsTrigger>
          <TabsTrigger value="licenses" className="text-xs">Licenze ({licenses.length})</TabsTrigger>
          <TabsTrigger value="runtime" className="text-xs">Runtime ({securityRuntime.length + (processTotal > 0 ? 1 : 0)})</TabsTrigger>
        </TabsList>

        <TabsContent value="hardware" className="mt-3">
          {profile ? (
            <InventoryProfilePanel profile={profile} />
          ) : (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
              Profilo hardware non disponibile su report precedenti. Al prossimo push GLPI Agent verranno acquisiti
              CPU, RAM, dischi, rete, utenti e antivirus.
            </p>
          )}
        </TabsContent>

        <TabsContent value="software" className="mt-3 space-y-3">
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun software nel report.</p>
          ) : (
            <>
              <div className="relative max-w-sm">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="h-8 pl-8 text-xs"
                  placeholder="Filtra software…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
              <div className="rounded-md border overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2">Software</th>
                      <th className="text-left p-2">Versione</th>
                      <th className="text-left p-2">Publisher</th>
                      <th className="text-left p-2">Installato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSoftware.map((sw) => (
                      <tr key={sw.id} className="border-t">
                        <td className="p-2">{sw.name}</td>
                        <td className="p-2 font-mono">{sw.version ?? "—"}</td>
                        <td className="p-2">{sw.publisher ?? "—"}</td>
                        <td className="p-2">{sw.install_date ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="licenses" className="mt-3">
          {licenses.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessuna licenza nel report GLPI.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">Prodotto</th>
                    <th className="text-left p-2">Product ID</th>
                    <th className="text-left p-2">Chiave</th>
                    <th className="text-left p-2">Attivazione</th>
                  </tr>
                </thead>
                <tbody>
                  {licenses.map((lic) => (
                    <tr key={lic.id} className="border-t">
                      <td className="p-2">{lic.full_name ?? lic.name}</td>
                      <td className="p-2 font-mono">{lic.product_id ?? "—"}</td>
                      <td className="p-2 font-mono">{lic.license_key ?? "—"}</td>
                      <td className="p-2">{lic.activation_date ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.license_keys_visible && (
                <p className="text-[10px] text-muted-foreground p-2 border-t">Chiavi mascherate (solo admin vede il valore completo).</p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="runtime" className="mt-3 space-y-3">
          {securityRuntime.length === 0 && processes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nessun servizio/database/processi nel report.</p>
          ) : (
            <>
              {securityRuntime.length > 0 && (
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2">Tipo</th>
                        <th className="text-left p-2">Nome</th>
                        <th className="text-left p-2">Versione</th>
                        <th className="text-left p-2">Stato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {securityRuntime.map((rt) => (
                        <tr key={rt.id} className="border-t">
                          <td className="p-2">
                            <Badge variant="outline" className="text-[10px]">{rt.category}</Badge>
                          </td>
                          <td className="p-2">{rt.name}</td>
                          <td className="p-2 font-mono">{rt.version ?? "—"}</td>
                          <td className="p-2">{rt.status ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {processes.length > 0 && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs font-medium">
                    <Server className="h-3.5 w-3.5" />
                    Processi ({processTotal > processes.length ? `${processes.length}/${processTotal}` : processes.length})
                  </div>
                  <div className="rounded-md border overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 sticky top-0">
                        <tr>
                          <th className="text-left p-2">PID</th>
                          <th className="text-left p-2">User</th>
                          <th className="text-left p-2">Comando</th>
                        </tr>
                      </thead>
                      <tbody>
                        {processes.map((p) => (
                          <tr key={p.id} className="border-t">
                            <td className="p-2 font-mono">{p.port ?? "—"}</td>
                            <td className="p-2">{p.user_name ?? "—"}</td>
                            <td className="p-2 font-mono truncate max-w-md" title={p.command_line ?? undefined}>
                              {p.command_line ?? p.name}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      <p className="text-[10px] text-muted-foreground">
        device_id <code>{ep.device_id}</code>
        {data.vuln_summary && data.vuln_summary.total > 0 && (
          <> · incrocia software installati con CVE in <Link href="/vulnerabilities" className="text-primary hover:underline">Vulnerabilità</Link></>
        )}
      </p>
    </div>
  );
}

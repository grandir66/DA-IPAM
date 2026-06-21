"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { Cpu, HardDrive, Loader2, Monitor, Network, PackageSearch, RefreshCw, Search, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { ParsedGlpiInventoryProfile } from "@/lib/inventory-agent/parse-glpi-inventory";

interface InvSoftwareRow {
  id: number;
  name: string;
  version: string | null;
  publisher: string | null;
  install_date: string | null;
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
  profile: ParsedGlpiInventoryProfile | null;
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
  children: React.ReactNode;
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
  const totalRamMb =
    profile.memories.reduce((s, m) => s + (m.capacity_mb ?? 0), 0) || hw.memory_mb;
  const totalDiskMb = profile.storages.reduce((s, d) => s + (d.size_mb ?? 0), 0);

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <ProfileSection title="Sistema" icon={Monitor}>
        <ProfileGrid
          items={[
            { label: "Modello", value: hw.model },
            { label: "Produttore", value: hw.manufacturer },
            { label: "Serial", value: hw.serial },
            { label: "UUID", value: hw.uuid },
            { label: "Form factor", value: hw.chassis_type },
            { label: "VM/Hypervisor", value: hw.vm_system },
            { label: "Utente loggato", value: hw.last_logged_user },
            { label: "Workgroup/AD", value: hw.workgroup },
            { label: "Gateway", value: hw.default_gateway },
            { label: "DNS", value: hw.dns },
            { label: "RAM totale", value: totalRamMb ? formatMb(totalRamMb) : null },
          ]}
        />
      </ProfileSection>

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

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="gap-1">
            <PackageSearch className="h-3 w-3" />
            GLPI Agent push
          </Badge>
          <Badge variant="secondary">{total} pacchetti</Badge>
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

      {profile ? (
        <InventoryProfilePanel profile={profile} />
      ) : (
        <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
          Profilo hardware non disponibile su report precedenti. Al prossimo push GLPI Agent verranno acquisiti
          CPU, RAM, dischi, rete, utenti e antivirus e propagati anche nella scheda oggetto.
        </p>
      )}

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">Report ricevuto ma senza voci software nel parser.</p>
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
          <p className="text-[10px] text-muted-foreground">
            {filter.trim()
              ? `${filteredSoftware.length} / ${total} pacchetti`
              : `${total} pacchetti`}{" "}
            · device_id <code>{ep.device_id}</code>
          </p>
        </>
      )}
    </div>
  );
}

"use client";

/**
 * Pagina unificata "Oggetto di rete" — `/objects/[hostId]`.
 *
 * Sostituisce le vecchie pagine separate /hosts/[id] e /devices/[id] che
 * mostravano viste parziali dello stesso oggetto fisico (stesso IP/MAC).
 * Qui tutte le info sono in un'unica vista con sezioni condizionate dallo
 * stato di evoluzione (rilevato → gestito come device → asset NIS2).
 *
 * Ordine sezioni (deciso 2026-05-22): priorità sicurezza.
 *   Identità · Rete · Vulnerabilità · Software · Asset NIS2 · Credenziali · Discovery · Cronologia
 */

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { StatusBadge } from "@/components/shared/status-badge";
import { HostVulnerabilitiesCard } from "@/components/hosts/host-vulnerabilities-card";
import { DeviceSoftwareCard, HostSoftwareCard } from "@/components/hosts/host-software-card";
import {
  ArrowLeft,
  RefreshCw,
  PackagePlus,
  Boxes,
  Wrench,
  Pencil,
  Shield,
  Network,
  Cpu,
  ScanSearch,
  HardDrive,
  Activity,
  KeyRound,
  Server,
} from "lucide-react";
import { toast } from "sonner";
import type { HostDetail, InventoryAsset, NetworkDevice } from "@/types";
import { getClassificationLabel } from "@/lib/device-classifications";

// ─── Helpers ────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function parsePorts(jsonStr: string | null | undefined): string[] {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    if (Array.isArray(arr)) return arr.map(String);
  } catch { /* ignore */ }
  return [];
}

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

function InfoRow({ label, value, mono }: InfoRowProps) {
  const empty = value == null || value === "" || value === "—";
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</dt>
      <dd className={`text-sm mt-0.5 ${mono ? "font-mono" : ""} ${empty ? "text-muted-foreground/50" : ""}`}>
        {empty ? "—" : value}
      </dd>
    </div>
  );
}

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ icon, title, badge, children }: SectionProps) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-muted/30 border-b py-2.5 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span>{title}</span>
          {badge}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────

export default function ObjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const hostId = typeof params.id === "string" ? Number(params.id) : NaN;

  const [host, setHost] = useState<HostDetail | null>(null);
  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [asset, setAsset] = useState<InventoryAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!Number.isFinite(hostId) || hostId <= 0) {
      router.push("/discovery");
      return;
    }
    try {
      const hRes = await fetch(`/api/hosts/${hostId}`);
      if (!hRes.ok) {
        toast.error(`Host ${hostId} non trovato`);
        router.push("/discovery");
        return;
      }
      const h = (await hRes.json()) as HostDetail;
      setHost(h);
      // Device linkato (per IP)
      if (h.network_device?.id) {
        const dRes = await fetch(`/api/devices/${h.network_device.id}`);
        if (dRes.ok) setDevice((await dRes.json()) as NetworkDevice);
      }
      // Asset linkato (per host_id)
      const aRes = await fetch(`/api/inventory?host_id=${hostId}`);
      if (aRes.ok) {
        const list = (await aRes.json()) as InventoryAsset[];
        if (Array.isArray(list) && list.length > 0) setAsset(list[0]);
      }
    } finally {
      setLoading(false);
    }
  }, [hostId, router]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  async function handleUpdateAll() {
    if (!host?.network_device?.id || !device) {
      toast.error("Promuovi prima l'host a device per eseguire 'Aggiorna tutto'");
      return;
    }
    setRefreshing(true);
    try {
      const qr = await fetch(`/api/devices/${device.id}/query`, { method: "POST" });
      const qd = (await qr.json()) as { id?: string; error?: string };
      if (!qr.ok) {
        toast.error(qd.error ?? "Errore avvio query");
        return;
      }
      if (qd.id) {
        // attende polling completion
        await new Promise<void>((resolve) => {
          const poll = setInterval(async () => {
            try {
              const pr = await fetch(`/api/scans/progress/${qd.id}`);
              if (!pr.ok) return;
              const pd = (await pr.json()) as { status: string; phase?: string };
              if (pd.status === "completed" || pd.status === "failed") {
                clearInterval(poll);
                if (pd.status === "completed") toast.success(pd.phase ?? "Query OK");
                else toast.error(pd.phase ?? "Query fallita");
                resolve();
              }
            } catch { /* ignore */ }
          }, 1500);
        });
      }
      if (device.vendor === "windows" || device.vendor === "linux") {
        toast.info("Inventario software in corso...");
        const sr = await fetch(`/api/devices/${device.id}/software-scan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const sd = (await sr.json()) as { status?: string; appsCount?: number; errorMessage?: string };
        if (sr.ok && sd.status === "ok") {
          toast.success(`Software: ${sd.appsCount ?? 0} applicazioni`);
        } else {
          toast.error(sd.errorMessage ?? "Software scan fallito");
        }
      }
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleCreateAsset() {
    if (!host) return;
    try {
      const r = await fetch("/api/inventory/bulk-from-hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: [host.id] }),
      });
      const data = (await r.json()) as { message?: string };
      if (r.ok) {
        toast.success(data.message ?? "Asset creato");
        await fetchAll();
      } else {
        toast.error("Errore creazione asset");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <RefreshCw className="h-4 w-4 animate-spin" />
        Caricamento...
      </div>
    );
  }
  if (!host) return null;

  const displayName = host.custom_name || host.hostname || host.dns_reverse || host.ip;
  const classificationLabel = host.classification ? getClassificationLabel(host.classification) : null;
  const isManaged = !!device;
  const isAsset = !!asset;
  const isWindowsOrLinux = device?.vendor === "windows" || device?.vendor === "linux";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* ─── Header sticky ─── */}
      <div className="sticky top-0 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-background/95 backdrop-blur z-20 border-b">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="shrink-0 mt-0.5">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1 className="text-xl font-bold tracking-tight font-mono">{host.ip}</h1>
              <span className="text-base text-muted-foreground truncate">{displayName}</span>
              <StatusBadge status={host.status} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <Boxes className="h-3.5 w-3.5" aria-label="Rilevato in Discovery" />
                <span>Discovery</span>
              </span>
              <Wrench className={`h-3.5 w-3.5 ${isManaged ? "text-blue-600" : "text-muted-foreground/30"}`} />
              <span className={isManaged ? "" : "text-muted-foreground/40"}>
                {isManaged ? `Gestito · ${device?.name}` : "Non gestito"}
              </span>
              <PackagePlus className={`h-3.5 w-3.5 ${isAsset ? "text-emerald-600" : "text-muted-foreground/30"}`} />
              <span className={isAsset ? "" : "text-muted-foreground/40"}>
                {isAsset ? `Asset · ${asset?.asset_tag ?? asset?.id}` : "Nessun asset NIS2"}
              </span>
              {classificationLabel && (
                <>
                  <Separator orientation="vertical" className="h-3.5" />
                  <Badge variant="outline" className="text-[10px]">{classificationLabel}</Badge>
                </>
              )}
              {host.network_name && (
                <>
                  <Separator orientation="vertical" className="h-3.5" />
                  <span>{host.network_name} · {host.network_cidr}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {isManaged && (
              <Button
                onClick={handleUpdateAll}
                disabled={refreshing}
                className="bg-primary hover:bg-primary/90"
                title="Test connessione → query SNMP/ARP → inventario software"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Aggiornamento..." : "Aggiorna tutto"}
              </Button>
            )}
            {!isAsset && host && (
              <Button variant="outline" onClick={handleCreateAsset}>
                <PackagePlus className="h-4 w-4 mr-2" />
                Crea asset NIS2
              </Button>
            )}
            <Button variant="outline" nativeButton={false} render={<Link href={`/hosts/${host.id}`} />}>
              <Pencil className="h-4 w-4 mr-2" />
              Modifica
            </Button>
          </div>
        </div>
      </div>

      {/* ─── 1. Identità ─── */}
      <Section icon={<Cpu className="h-4 w-4" />} title="Identità">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoRow label="IP" value={host.ip} mono />
          <InfoRow label="MAC" value={host.mac} mono />
          <InfoRow label="Hostname" value={host.hostname} />
          <InfoRow label="DNS reverse" value={host.dns_reverse} />
          <InfoRow label="Vendor (MAC OUI)" value={host.vendor} />
          <InfoRow label="Manufacturer" value={host.device_manufacturer} />
          <InfoRow label="OS" value={host.os_info} />
          <InfoRow label="Classification" value={classificationLabel} />
          {host.model && <InfoRow label="Modello" value={host.model} />}
          {host.serial_number && <InfoRow label="Seriale" value={host.serial_number} mono />}
          {host.firmware && <InfoRow label="Firmware" value={host.firmware} />}
          {host.ip_assignment && <InfoRow label="IP assignment" value={host.ip_assignment} />}
        </dl>
      </Section>

      {/* ─── 2. Rete ─── */}
      <Section icon={<Network className="h-4 w-4" />} title="Rete">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <InfoRow label="Subnet" value={host.network_name ? `${host.network_name} (${host.network_cidr})` : null} />
          <InfoRow label="VLAN" value={host.switch_port?.vlan ? String(host.switch_port.vlan) : null} />
          <InfoRow
            label="Switch port"
            value={host.switch_port ? `${host.switch_port.device_name} · ${host.switch_port.port_name}` : null}
          />
          <InfoRow
            label="ARP source"
            value={host.arp_source ? `${host.arp_source.device_name} (${host.arp_source.device_vendor})` : null}
          />
        </dl>
      </Section>

      {/* ─── 3. Vulnerabilità (sempre, anche se vuoto) ─── */}
      <Section icon={<Shield className="h-4 w-4" />} title="Vulnerabilità">
        <HostVulnerabilitiesCard hostId={host.id} />
      </Section>

      {/* ─── 4. Software inventory (solo se device + windows/linux) ─── */}
      {isManaged && isWindowsOrLinux && device && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato">
          <DeviceSoftwareCard deviceId={device.id} osHint={device.vendor as "windows" | "linux"} />
        </Section>
      )}
      {isManaged && !isWindowsOrLinux && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato">
          <p className="text-sm text-muted-foreground">
            Inventario software non applicabile per vendor <Badge variant="outline">{device?.vendor}</Badge>.
            Disponibile solo per device <Badge variant="outline">windows</Badge> o <Badge variant="outline">linux</Badge>.
          </p>
        </Section>
      )}
      {!isManaged && (host.classification === "server_windows" || host.classification === "server_linux" || host.classification === "workstation") && (
        <Section icon={<HardDrive className="h-4 w-4" />} title="Software installato">
          <p className="text-sm text-muted-foreground">
            Per scansionare il software, promuovi prima questo host a device gestito da Discovery
            (selezione → &quot;Aggiungi a dispositivi&quot;).
          </p>
        </Section>
      )}

      {/* ─── 5. Asset NIS2 (solo se asset linkato) ─── */}
      {isAsset && asset && (
        <Section icon={<PackagePlus className="h-4 w-4" />} title="Asset NIS2"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{asset.asset_tag ?? `#${asset.id}`}</Badge>}>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <InfoRow label="Categoria NIS2" value={asset.categoria_nis2 ?? null} />
            <InfoRow label="Criticità NIS2" value={asset.criticita_nis2 ?? null} />
            <InfoRow label="Categoria" value={asset.categoria ?? null} />
            <InfoRow label="Stato" value={asset.stato ?? null} />
            <InfoRow label="Sede" value={asset.sede ?? null} />
            <InfoRow label="Reparto" value={asset.reparto ?? null} />
            <InfoRow label="Posizione fisica" value={asset.posizione_fisica ?? null} />
            <InfoRow label="Asset tag" value={asset.asset_tag ?? null} mono />
          </dl>
          <div className="mt-3">
            <Button variant="link" size="sm" nativeButton={false} render={<Link href={`/inventory/${asset.id}`} />}>
              Apri dettaglio asset completo →
            </Button>
          </div>
        </Section>
      )}

      {/* ─── 6. Credenziali e gestione (solo se host promosso a device) ─── */}
      {isManaged && device && (
        <Section icon={<KeyRound className="h-4 w-4" />} title="Credenziali e gestione"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.protocol}</Badge>}>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
            <InfoRow label="Device name" value={device.name} />
            <InfoRow label="Vendor" value={device.vendor} />
            <InfoRow label="Protocollo" value={device.protocol} />
            <InfoRow label="Porta" value={String(device.port)} mono />
            <InfoRow label="Scan target" value={device.scan_target ?? null} />
            <InfoRow label="Sysname (SNMP)" value={device.sysname} />
            <InfoRow label="Modello" value={device.model} />
            <InfoRow label="Firmware" value={device.firmware} />
          </dl>
          {host.host_credentials && host.host_credentials.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Credenziali validate
              </div>
              <div className="flex flex-wrap gap-2">
                {host.host_credentials.map((hc) => (
                  <Badge key={hc.id} variant="outline" className="font-mono text-xs">
                    {hc.credential_name} · {hc.protocol_type}:{hc.port}
                    {hc.validated === 1 && <span className="ml-1 text-emerald-600">✓</span>}
                  </Badge>
                ))}
              </div>
            </>
          )}
          <div className="mt-3">
            <Button variant="link" size="sm" nativeButton={false} render={<Link href={`/devices/${device.id}`} />}>
              Apri dettaglio device completo →
            </Button>
          </div>
        </Section>
      )}
      {!isManaged && (
        <Section icon={<KeyRound className="h-4 w-4" />} title="Credenziali e gestione">
          <p className="text-sm text-muted-foreground">
            Host non ancora promosso a device gestito.
            Da Discovery seleziona questo host → &quot;Aggiungi a dispositivi&quot; per assegnare credenziali e
            abilitare le scansioni di acquisizione dati.
          </p>
        </Section>
      )}

      {/* ─── 7. Discovery ─── */}
      <Section icon={<ScanSearch className="h-4 w-4" />} title="Discovery">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
          <InfoRow label="First seen" value={formatDate(host.first_seen)} />
          <InfoRow label="Last seen" value={formatDate(host.last_seen)} />
          <InfoRow label="Known host" value={host.known_host ? "Sì" : "No"} />
          <InfoRow label="Response time" value={host.last_response_time_ms ? `${host.last_response_time_ms}ms` : null} />
        </dl>
        {(() => {
          const tcp = parsePorts(host.open_ports);
          return tcp.length > 0 ? (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                Porte aperte ({tcp.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tcp.slice(0, 50).map((p) => (
                  <Badge key={p} variant="outline" className="font-mono text-[10px]">{p}</Badge>
                ))}
                {tcp.length > 50 && (
                  <Badge variant="outline" className="text-[10px]">+{tcp.length - 50}</Badge>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nessuna porta aperta registrata.</p>
          );
        })()}
      </Section>

      {/* ─── 8. Cronologia ─── */}
      <Section icon={<Activity className="h-4 w-4" />} title="Cronologia scansioni">
        {host.recent_scans && host.recent_scans.length > 0 ? (
          <div className="space-y-1.5">
            {host.recent_scans.slice(0, 10).map((s) => (
              <div key={s.id} className="text-xs flex items-center gap-3 font-mono">
                <span className="text-muted-foreground">{formatDate(s.timestamp)}</span>
                <Badge variant="outline" className="text-[10px]">{s.scan_type}</Badge>
                <span className={s.status === "online" ? "text-emerald-600" : "text-muted-foreground"}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nessuna scansione registrata.</p>
        )}
      </Section>

      {/* Spazio in fondo per scroll comodo */}
      <div className="h-8" />

      {/* HostSoftwareCard non viene mai mostrata: lasciamo l'import per coerenza
          (l'unico path di scan ora è via DeviceSoftwareCard sopra) */}
      {false && <HostSoftwareCard hostId={host.id} />}
    </div>
  );
}

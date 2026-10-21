"use client";

/**
 * «Dettagli» > Rete (spostato da `objects/[id]/page.tsx`, 21/10): «Sulla mappa», IP collegati, Proxmox,
 * STP, porte switch, MAC/ARP/routing/DHCP, vicini LLDP/CDP. Ogni tipo se lo porta via nel suo task.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/shared/status-badge";
import { LoadError } from "@/components/shared/load-error";
import { Server, Layers, Radio, Cable, Route, Link2, Unlink, Merge, Split, Workflow, Table as TableIcon, HardDrive, Network } from "lucide-react";
import dynamic from "next/dynamic";
import { caricaStato } from "@/components/topology/unioni/api";
import { parolaCome } from "@/lib/topology/unioni-testi";
import { TESTI_UNIONI, type StatoDelNodo } from "@/lib/topology/unioni-tipi";
import { parseDbDate } from "@/lib/db-date";
import { InfoRow, Section, formatGb } from "../blocchi";
import type { ContestoScheda } from "../contesto";

const UnisciDialog = dynamic(() => import("@/components/topology/unioni/unisci-dialog").then((m) => ({ default: m.UnisciDialog })), { ssr: false });
const SeparaDialog = dynamic(() => import("@/components/topology/unioni/separa-dialog").then((m) => ({ default: m.SeparaDialog })), { ssr: false });

/**
 * «Sulla mappa» (unioni a mano, piano 2026-10-16, Task 6): con quali altri indirizzi questo host è un oggetto solo
 * nella topologia, e i pulsanti per unire o separare (solo admin). Legge lo stato dalla rotta, non dai file del repo.
 */
export function SullaMappa({ hostId, isAdmin }: { hostId: number; isAdmin: boolean }) {
  const oggetto = `host:${hostId}`;
  const [stato, setStato] = useState<StatoDelNodo | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [tentativo, setTentativo] = useState(0);
  const [unisciOpen, setUnisciOpen] = useState(false);
  const [separaOpen, setSeparaOpen] = useState(false);

  useEffect(() => {
    let vivo = true;
    caricaStato(oggetto).then((r) => {
      if (!vivo) return;
      if (r.ok) { setStato(r.data); setErrore(null); } else setErrore(r.message);
    }).catch(() => { if (vivo) setErrore("Server non raggiungibile"); });
    return () => { vivo = false; };
  }, [oggetto, tentativo]);

  const ricarica = () => setTentativo((t) => t + 1);

  return (
    <Section icon={<Workflow className="h-4 w-4" />} title="Sulla mappa">
      {errore !== null ? (
        <LoadError what="lo stato sulla mappa" message={errore} onRetry={ricarica} />
      ) : stato === null ? (
        <p className="text-sm text-muted-foreground">Caricamento…</p>
      ) : !stato.disponibile ? (
        <p className="text-sm text-muted-foreground">{TESTI_UNIONI.schemaAssente}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">Sulla mappa è <strong>{stato.nome}</strong></p>
          {stato.membri.length > 1 && (
            <div className="border rounded-md divide-y">
              {stato.membri.map((m) => {
                const qui = m.id === oggetto;
                const idHost = m.id.startsWith("host:") ? m.id.slice(5) : null;
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    {m.ip !== null && (qui || idHost === null
                      ? <span className="font-mono text-sm">{m.ip}</span>
                      : <Link href={`/objects/${idHost}`} className="font-mono text-sm underline underline-offset-2">{m.ip}</Link>)}
                    <span className="text-sm">{m.nome}</span>
                    <span className="text-sm text-muted-foreground">· {parolaCome(m)}</span>
                    {qui && <span className="text-sm font-semibold">· qui</span>}
                  </div>
                );
              })}
            </div>
          )}
          {stato.nonApplicata && <p className="text-sm">Unione a mano non applicata: {stato.nonApplicata.motivo}</p>}
          {stato.mancanti.length > 0 && <p className="text-sm">Non ci sono più: {stato.mancanti.join(", ")}</p>}
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="text-[13px]" onClick={() => setUnisciOpen(true)}>
                <Merge className="h-3.5 w-3.5 mr-1.5" />
                Unisci con…
              </Button>
              {stato.membri.some((m) => m.separabile) && (
                <Button variant="outline" size="sm" className="text-[13px]" onClick={() => setSeparaOpen(true)}>
                  <Split className="h-3.5 w-3.5 mr-1.5" />
                  Separa…
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {unisciOpen && (
        <UnisciDialog open onOpenChange={setUnisciOpen} da={oggetto} nomeDa={stato?.nome ?? oggetto} onFatto={ricarica} />
      )}
      {separaOpen && <SeparaDialog open onOpenChange={setSeparaOpen} oggetto={oggetto} onFatto={ricarica} />}
    </Section>
  );
}

/** Cluster fisico: gli altri IP dello stesso apparato. Esportato: la scheda switch lo riusa in «Vicini e MAC». */
export function IpCollegati({ ctx }: { ctx: ContestoScheda }) {
  const { host, clusterMembers, unlinkingHostId, scollegaIp, apriCollegaIp } = ctx;
  return (
    <Section icon={<Link2 className="h-4 w-4" />} title="IP collegati allo stesso device fisico">
      <div className="space-y-3">
        {host?.physical_device_id && clusterMembers.length > 0 ? (
          <>
            <div className="text-xs text-muted-foreground">
              Cluster fisico <span className="font-mono">#{host.physical_device_id}</span> · {clusterMembers.length} {clusterMembers.length === 1 ? "IP" : "IP"} aggregati
            </div>
            <div className="border rounded-md divide-y">
              {clusterMembers.map((m) => {
                const isCurrent = m.id === host?.id;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      {isCurrent ? (
                        <span className="font-mono text-sm">{m.ip}</span>
                      ) : (
                        <Link href={`/objects/${m.id}`} className="font-mono text-sm hover:underline text-primary">{m.ip}</Link>
                      )}
                      {m.hostname && <span className="text-sm text-muted-foreground truncate">{m.hostname}</span>}
                      <span className="text-[10px] text-muted-foreground">· {m.network_name}</span>
                      {isCurrent && <Badge variant="secondary" className="text-[10px]">qui</Badge>}
                      <StatusBadge status={m.status} />
                    </div>
                    {!isCurrent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => scollegaIp(m.id)}
                        disabled={unlinkingHostId === m.id}
                        title="Scollega questo IP dal device fisico"
                      >
                        <Unlink className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nessun altro IP aggregato. Se questo device ha più indirizzi (es. NIC su VLAN diverse, gateway multipli), collegali manualmente.
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => apriCollegaIp()} disabled={!host}>
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Collega altro IP
          </Button>
          {host?.physical_device_id && clusterMembers.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => host?.id && scollegaIp(host.id)}
              disabled={unlinkingHostId === host?.id}
            >
              <Unlink className="h-3.5 w-3.5 mr-1.5" />
              Esci dal cluster
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}

export function DettagliRete({ ctx }: { ctx: ContestoScheda }) {
  const { hostId, device, isAdmin } = ctx;
  return (
    <div className="space-y-4">
      {/* ─── 3.0 IP collegati (cluster fisico) ─────────────────────────
          Espone l'aggregazione physical_device: tutti gli IP che il sistema
          (o l'utente, via "Collega altro IP") ha dichiarato appartenere allo
          stesso device fisico. Caso d'uso tipico: Proxmox con NIC su VLAN
          diverse (mgmt 40.1 + VM 16.1), router/firewall con gateway multipli.
      */}
      {Number.isFinite(hostId) && hostId > 0 && <SullaMappa hostId={hostId} isAdmin={isAdmin} />}

      <IpCollegati ctx={ctx} />

      {/* ─── 3a. Proxmox (host + VM + subscription) ─── */}
      {(() => {
        const px = device?.proxmox_data ?? null;
        if (!px || (!px.hosts?.length && !px.vms?.length)) return null;
        return (
          <Section icon={<Server className="h-4 w-4" />} title="Proxmox VE"
            badge={px.scanned_at && (
              <span className="ml-2 text-[10px] text-muted-foreground">
                scan {parseDbDate(px.scanned_at).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}>
            <Tabs defaultValue="px-host" className="space-y-3">
              <TabsList className="!h-9 p-0.5 gap-0.5">
                <TabsTrigger value="px-host" className="px-3 py-1 text-xs">
                  Host cluster {px.hosts?.length ? `(${px.hosts.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="px-vms" className="px-3 py-1 text-xs">
                  VM e Container {px._total_vm_rows ?? px.vms?.length ?? 0 > 0 ? `(${px._total_vm_rows ?? px.vms?.length})` : ""}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="px-host" className="space-y-4">
              {/* Hosts cluster */}
              {px.hosts && px.hosts.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
                    Host del cluster ({px.hosts.length})
                  </div>
                  <div className="space-y-2">
                    {px.hosts.map((h, i) => {
                      const subStatus = h.subscription?.status?.toLowerCase();
                      const subActive = subStatus === "active" || subStatus === "active/valid";
                      return (
                        <div key={i} className="border rounded p-3">
                          <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                            <div className="font-mono font-semibold text-sm">{h.hostname}</div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[10px] ${h.status === "online" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                                {h.status}
                              </Badge>
                              {h.proxmox_version && <Badge variant="outline" className="text-[10px]">PVE {h.proxmox_version}</Badge>}
                              {h.subscription?.productname && (
                                <Badge variant="outline" className={`text-[10px] ${subActive ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "border-amber-400 text-amber-700 bg-amber-50"}`}>
                                  {h.subscription.productname}{h.subscription.level && ` (${h.subscription.level})`}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <InfoRow label="CPU" value={h.cpu_model ?? null} />
                            <InfoRow label="Core / Socket" value={h.cpu_total_cores ? `${h.cpu_total_cores} core${h.cpu_sockets ? ` · ${h.cpu_sockets} socket` : ""}${h.cpu_cores ? ` (${h.cpu_cores}/socket)` : ""}` : null} />
                            <InfoRow label="CPU MHz" value={h.cpu_mhz ? `${Math.round(h.cpu_mhz)} MHz` : null} />
                            <InfoRow label="RAM totale" value={h.memory_total_gb ? `${h.memory_total_gb.toFixed(1)} GB` : null} />
                            <InfoRow label="RAM usata" value={h.memory_used_gb != null ? `${h.memory_used_gb.toFixed(1)} GB${h.memory_usage_percent != null ? ` · ${Math.round(h.memory_usage_percent)}%` : ""}` : null} />
                            <InfoRow label="RAM libera" value={h.memory_free_gb != null ? `${h.memory_free_gb.toFixed(1)} GB` : null} />
                            <InfoRow label="Uptime" value={h.uptime_human ?? null} />
                            <InfoRow label="Kernel" value={h.kernel_version ?? null} />
                            <InfoRow
                              label="Root FS"
                              value={h.rootfs_total_gb ? `${formatGb(h.rootfs_used_gb)} / ${formatGb(h.rootfs_total_gb)}` : null}
                            />
                            <InfoRow label="Hardware" value={h.hardware_manufacturer || h.hardware_model ? `${h.hardware_manufacturer ?? ""} ${h.hardware_model ?? ""}`.trim() : null} />
                            <InfoRow label="Serial HW" value={h.hardware_serial ?? null} mono />
                          </dl>

                          {/* Subscription dettagliata */}
                          {h.subscription && (
                            <div className="mt-3 p-2 bg-muted/30 rounded">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">Subscription</div>
                              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <InfoRow label="Status" value={h.subscription.status ?? null} />
                                <InfoRow label="Prodotto" value={h.subscription.productname ?? null} />
                                <InfoRow label="Level" value={h.subscription.level ?? null} />
                                <InfoRow label="Key" value={h.subscription.key ?? null} mono />
                                <InfoRow label="Registrata il" value={h.subscription.regdate ?? null} />
                                <InfoRow label="Scade il" value={h.subscription.nextduedate ?? null} />
                                <InfoRow label="Socket" value={h.subscription.sockets != null ? String(h.subscription.sockets) : null} />
                                <InfoRow label="Server ID" value={h.subscription.serverid ?? null} mono />
                              </dl>
                            </div>
                          )}

                          {/* Storage pools host */}
                          {h.storage && h.storage.length > 0 && (
                            <div className="mt-3">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                                <HardDrive className="h-3 w-3" />
                                Storage ({h.storage.length})
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                                    <tr>
                                      <th className="text-left py-1.5 pr-3">Nome</th>
                                      <th className="text-left pr-3">Tipo</th>
                                      <th className="text-left pr-3">Contenuto</th>
                                      <th className="text-left pr-3">Usato</th>
                                      <th className="text-left pr-3">Disponibile</th>
                                      <th className="text-left">Totale</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {h.storage.map((s, j) => {
                                      const usedPct = s.total_gb && s.used_gb != null ? Math.round((s.used_gb / s.total_gb) * 100) : null;
                                      return (
                                        <tr key={j} className="border-b border-border/30 last:border-0">
                                          <td className="py-1 pr-3 font-mono">{s.name}</td>
                                          <td className="pr-3"><Badge variant="outline" className="text-[10px]">{s.type ?? "?"}</Badge></td>
                                          <td className="pr-3 text-[10px] text-muted-foreground">{s.content ?? "—"}</td>
                                          <td className="pr-3">
                                            {formatGb(s.used_gb)}
                                            {usedPct != null && (
                                              <span className={`ml-1 text-[10px] ${usedPct >= 90 ? "text-red-600 font-semibold" : usedPct >= 75 ? "text-amber-600" : "text-muted-foreground"}`}>
                                                ({usedPct}%)
                                              </span>
                                            )}
                                          </td>
                                          <td className="pr-3">{formatGb(s.available_gb)}</td>
                                          <td>{formatGb(s.total_gb)}</td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}

                          {/* Network interfaces host */}
                          {h.network_interfaces && h.network_interfaces.length > 0 && (
                            <div className="mt-3">
                              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                                <Network className="h-3 w-3" />
                                Interfacce di rete ({h.network_interfaces.length})
                              </div>
                              <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                  <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                                    <tr>
                                      <th className="text-left py-1.5 pr-3">Nome</th>
                                      <th className="text-left pr-3">Tipo</th>
                                      <th className="text-left pr-3">Stato</th>
                                      <th className="text-left pr-3">MAC</th>
                                      <th className="text-left pr-3">IP</th>
                                      <th className="text-left pr-3">Bridge</th>
                                      <th className="text-left">Speed</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {h.network_interfaces.map((nic, j) => (
                                      <tr key={j} className="border-b border-border/30 last:border-0">
                                        <td className="py-1 pr-3 font-mono">{nic.name}</td>
                                        <td className="pr-3"><Badge variant="outline" className="text-[10px]">{nic.type ?? "?"}</Badge></td>
                                        <td className="pr-3">
                                          <Badge variant="outline" className={`text-[10px] ${nic.state === "up" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                                            {nic.state ?? "?"}
                                          </Badge>
                                        </td>
                                        <td className="pr-3 font-mono">{nic.mac_address ?? "—"}</td>
                                        <td className="pr-3 font-mono">{nic.ip_addresses ?? "—"}</td>
                                        <td className="pr-3 font-mono">{nic.bridge ?? "—"}</td>
                                        <td>{nic.speed_mbps ? `${nic.speed_mbps} Mb/s` : "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              </TabsContent>

              <TabsContent value="px-vms" className="space-y-4">
              {/* VM e CT */}
              {px.vms && px.vms.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5 flex items-center gap-1.5">
                    <Layers className="h-3 w-3" />
                    VM e Container ({px._total_vm_rows ?? px.vms.length})
                    {px._truncated && (
                      <span className="text-[10px] text-amber-600">· mostrate prime {px.vms.length}</span>
                    )}
                  </div>
                  <div className="overflow-x-auto max-h-[600px]">
                    <table className="w-full text-xs">
                      <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                        <tr>
                          <th className="text-left py-1.5 pr-3">VMID</th>
                          <th className="text-left pr-3">Nome</th>
                          <th className="text-left pr-3">Tipo</th>
                          <th className="text-left pr-3">CPU</th>
                          <th className="text-left pr-3">RAM</th>
                          <th className="text-left pr-3">Dischi</th>
                          <th className="text-left pr-3">Reti</th>
                          <th className="text-left pr-3">BIOS</th>
                          <th className="text-left">IP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {px.vms.map((vm) => {
                          const disksDetail = vm.disks_details?.filter((d) => d.id && d.size) ?? [];
                          const netsDetail = vm.networks_details ?? [];
                          return (
                            <tr key={`${vm.node}-${vm.vmid}`} className="border-b border-border/30 last:border-0 align-top">
                              <td className="py-1 pr-3 font-mono">{vm.vmid}</td>
                              <td className="pr-3 font-medium">
                                {vm.name}
                                <div className="text-[10px] text-muted-foreground font-normal">{vm.node}</div>
                              </td>
                              <td className="pr-3">
                                <Badge variant="outline" className="text-[10px] uppercase">{vm.type}</Badge>
                                {vm.status && (
                                  <Badge variant="outline" className={`ml-1 text-[10px] ${vm.status === "running" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                                    {vm.status}
                                  </Badge>
                                )}
                                {vm.agent === 1 && (
                                  <Badge variant="outline" className="ml-1 text-[10px] border-blue-400 text-blue-700 bg-blue-50" title="QEMU guest agent attivo">agent</Badge>
                                )}
                              </td>
                              <td className="pr-3 font-mono">
                                {vm.maxcpu}
                                {vm.cores && vm.sockets && <div className="text-[10px] text-muted-foreground">{vm.sockets}s·{vm.cores}c</div>}
                              </td>
                              <td className="pr-3 font-mono">{vm.memory_mb ? `${(vm.memory_mb / 1024).toFixed(1)} GB` : "—"}</td>
                              <td className="pr-3">
                                {disksDetail.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {disksDetail.map((d, j) => (
                                      <div key={j} className="text-[10px] font-mono">
                                        <span className="text-muted-foreground">{d.id}:</span> {d.size}
                                        {d.storage && d.storage !== "N/A" && <span className="text-muted-foreground"> @ {d.storage}</span>}
                                      </div>
                                    ))}
                                  </div>
                                ) : vm.disk_gb ? (
                                  <span className="font-mono">{vm.disk_gb} GB</span>
                                ) : "—"}
                              </td>
                              <td className="pr-3">
                                {netsDetail.length > 0 ? (
                                  <div className="space-y-0.5">
                                    {netsDetail.map((n, j) => (
                                      <div key={j} className="text-[10px] font-mono">
                                        <span className="text-muted-foreground">{n.id}:</span> {n.bridge ?? "?"}
                                        {n.vlan && <Badge variant="outline" className="ml-1 text-[9px] py-0">v{n.vlan}</Badge>}
                                        {n.mac && <span className="text-muted-foreground block">{n.mac}</span>}
                                      </div>
                                    ))}
                                  </div>
                                ) : "—"}
                              </td>
                              <td className="pr-3 text-[10px] font-mono">{vm.bios ?? "—"}</td>
                              <td className="font-mono text-[10px]">
                                {vm.ip_addresses && vm.ip_addresses.length > 0 ? vm.ip_addresses.join(", ") : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              </TabsContent>
            </Tabs>
          </Section>
        );
      })()}

      {/* ─── 3a-bis. Spanning Tree Protocol (STP) — solo switch ─── */}
      {(() => {
        const stp = device?.stp_info ?? null;
        if (!stp) return null;
        return (
          <Section icon={<Radio className="h-4 w-4" />} title="Spanning Tree Protocol"
            badge={
              <span className="ml-2 inline-flex gap-1.5">
                {stp.is_root_bridge && <Badge variant="outline" className="text-[10px] border-emerald-400 text-emerald-700 bg-emerald-50">ROOT BRIDGE</Badge>}
                {stp.protocol && <Badge variant="outline" className="text-[10px]">{stp.protocol.toUpperCase()}</Badge>}
              </span>
            }>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <InfoRow label="Bridge ID" value={stp.bridge_id ?? null} mono />
              <InfoRow label="Root Bridge ID" value={stp.root_bridge_id ?? null} mono />
              <InfoRow label="Priority" value={stp.priority != null ? String(stp.priority) : null} />
              <InfoRow label="Root cost" value={stp.root_cost != null ? String(stp.root_cost) : null} />
              <InfoRow label="Root port" value={stp.root_port ?? null} />
              <InfoRow label="Hello time" value={stp.hello_time_s != null ? `${stp.hello_time_s}s` : null} />
              <InfoRow label="Forward delay" value={stp.forward_delay_s != null ? `${stp.forward_delay_s}s` : null} />
              <InfoRow label="Max age" value={stp.max_age_s != null ? `${stp.max_age_s}s` : null} />
            </dl>
          </Section>
        );
      })()}

      {/* ─── 3b. Porte switch (solo per switch) ─── */}
      {device?.switch_ports && device.switch_ports.length > 0 && (
        <Section icon={<Cable className="h-4 w-4" />} title="Porte switch"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.switch_ports.length}</Badge>}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b">
                <tr><th className="text-left py-1.5 pr-3">Porta</th><th className="text-left pr-3">VLAN</th><th className="text-left pr-3">Status</th><th className="text-left">Host linkato</th></tr>
              </thead>
              <tbody>
                {device.switch_ports.slice(0, 100).map((p) => (
                  <tr key={p.id} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{p.port_name}</td>
                    <td className="pr-3">{p.vlan ?? "—"}</td>
                    <td className="pr-3">
                      {p.status && (
                        <Badge variant="outline" className={`text-[10px] ${p.status === "up" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                          {p.status}
                        </Badge>
                      )}
                      {p.speed && <span className="text-[10px] text-muted-foreground ml-1.5">{p.speed}</span>}
                    </td>
                    <td className="font-mono">{p.host_id ? <Link href={`/objects/${p.host_id}`} className="text-primary hover:underline">#{p.host_id}</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.switch_ports.length > 100 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 100 di {device.switch_ports.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3c. MAC port table (switch) ─── */}
      {device?.mac_port_entries && device.mac_port_entries.length > 0 && (
        <Section icon={<TableIcon className="h-4 w-4" />} title="MAC table (switch)"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.mac_port_entries.length}</Badge>}>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                <tr>
                  <th className="text-left py-1.5 pr-3">MAC</th>
                  <th className="text-left pr-3">Porta</th>
                  <th className="text-left pr-3">VLAN</th>
                  <th className="text-left">Host collegato</th>
                </tr>
              </thead>
              <tbody>
                {device.mac_port_entries.slice(0, 200).map((m) => (
                  <tr key={m.id} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{m.mac}</td>
                    <td className="pr-3 font-mono">{m.port_name}</td>
                    <td className="pr-3">{m.vlan ?? "—"}</td>
                    <td className="text-xs">
                      {m.host_ip || m.host_name ? (
                        <span>
                          <span className="font-mono">{m.host_ip ?? ""}</span>
                          {m.host_name && <span className="text-muted-foreground ml-1">· {m.host_name}</span>}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.mac_port_entries.length > 200 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 200 di {device.mac_port_entries.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3d. ARP table (router) ─── */}
      {device?.arp_entries && device.arp_entries.length > 0 && (
        <Section icon={<TableIcon className="h-4 w-4" />} title="ARP table (router)"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.arp_entries.length}</Badge>}>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                <tr><th className="text-left py-1.5 pr-3">IP</th><th className="text-left pr-3">MAC</th><th className="text-left pr-3">Interfaccia</th><th className="text-left">Hostname</th></tr>
              </thead>
              <tbody>
                {device.arp_entries.slice(0, 200).map((a) => (
                  <tr key={a.id} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{a.ip ?? "—"}</td>
                    <td className="pr-3 font-mono">{a.mac}</td>
                    <td className="pr-3">{a.interface_name ?? "—"}</td>
                    <td>{a.hostname ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.arp_entries.length > 200 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 200 di {device.arp_entries.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3e. Routing table (router) ─── */}
      {device?.routes && device.routes.length > 0 && (
        <Section icon={<Route className="h-4 w-4" />} title="Routing table"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.routes.length}</Badge>}>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                <tr><th className="text-left py-1.5 pr-3">Destinazione</th><th className="text-left pr-3">Gateway</th><th className="text-left pr-3">Interfaccia</th><th className="text-left pr-3">Protocollo</th><th className="text-left">Distanza</th></tr>
              </thead>
              <tbody>
                {device.routes.slice(0, 200).map((r, i) => (
                  <tr key={r.id ?? i} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{r.destination ?? "—"}</td>
                    <td className="pr-3 font-mono">{r.gateway ?? "—"}</td>
                    <td className="pr-3">{r.interface_name ?? "—"}</td>
                    <td className="pr-3">{r.protocol ?? "—"}</td>
                    <td>{r.distance ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.routes.length > 200 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 200 di {device.routes.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3e-bis. DHCP leases (router/firewall) ─── */}
      {device?.dhcp_leases && device.dhcp_leases.length > 0 && (
        <Section icon={<TableIcon className="h-4 w-4" />} title="DHCP leases"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.dhcp_leases.length}</Badge>}>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground border-b sticky top-0 bg-background">
                <tr>
                  <th className="text-left py-1.5 pr-3">IP</th>
                  <th className="text-left pr-3">MAC</th>
                  <th className="text-left pr-3">Hostname</th>
                  <th className="text-left pr-3">Status</th>
                  <th className="text-left pr-3">Server</th>
                  <th className="text-left pr-3">Tipo</th>
                  <th className="text-left">Scade</th>
                </tr>
              </thead>
              <tbody>
                {device.dhcp_leases.slice(0, 200).map((l, i) => (
                  <tr key={l.id ?? i} className="border-b border-border/30 last:border-0">
                    <td className="py-1 pr-3 font-mono">{l.ip}</td>
                    <td className="pr-3 font-mono">{l.mac}</td>
                    <td className="pr-3">{l.hostname ?? "—"}</td>
                    <td className="pr-3">
                      {l.status && (
                        <Badge variant="outline" className={`text-[10px] ${l.status === "bound" || l.status === "active" ? "border-emerald-400 text-emerald-700 bg-emerald-50" : "text-muted-foreground"}`}>
                          {l.status}
                        </Badge>
                      )}
                    </td>
                    <td className="pr-3 text-[10px] text-muted-foreground">{l.server ?? "—"}</td>
                    <td className="pr-3 text-[10px]">{l.lease_type ?? "—"}</td>
                    <td className="text-[10px]">{l.expires_at ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {device.dhcp_leases.length > 200 && (
              <p className="text-[10px] text-muted-foreground mt-2">Mostrate prime 200 di {device.dhcp_leases.length}</p>
            )}
          </div>
        </Section>
      )}

      {/* ─── 3f. Neighbors LLDP/CDP ─── */}
      {device?.neighbors && device.neighbors.length > 0 && (
        <Section icon={<Radio className="h-4 w-4" />} title="Neighbors LLDP/CDP"
          badge={<Badge variant="outline" className="ml-2 text-[10px]">{device.neighbors.length}</Badge>}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {device.neighbors.map((n, i) => (
              <div key={n.id ?? i} className="text-xs border rounded px-2 py-1.5">
                <div className="font-mono font-medium">{n.neighbor_name ?? n.neighbor_address ?? "?"}</div>
                <div className="text-muted-foreground text-[11px] mt-0.5">
                  {n.interface_name && `Locale: ${n.interface_name}`}
                  {n.neighbor_port && ` → Remoto: ${n.neighbor_port}`}
                  {n.protocol && (
                    <Badge variant="outline" className="ml-1.5 text-[9px] py-0">{n.protocol}</Badge>
                  )}
                </div>
                {n.neighbor_platform && (
                  <div className="text-muted-foreground text-[11px] truncate" title={n.neighbor_platform}>
                    {n.neighbor_platform}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

"use client";

/**
 * «Dettagli» > Rete (spostato da `objects/[id]/page.tsx`, 21/10): «Sulla mappa», IP collegati, Proxmox,
 * STP, porte switch, MAC/ARP/routing/DHCP, vicini LLDP/CDP. Ogni tipo se lo porta via nel suo task.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { LoadError } from "@/components/shared/load-error";
import { Radio, Cable, Route, Link2, Unlink, Merge, Split, Workflow, Table as TableIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { caricaStato } from "@/components/topology/unioni/api";
import { parolaCome } from "@/lib/topology/unioni-testi";
import { TESTI_UNIONI, type StatoDelNodo } from "@/lib/topology/unioni-tipi";
import { InfoRow, Section } from "../blocchi";
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
  const { host, clusterMembers, unlinkingHostId, scollegaIp, apriCollegaIp, clusterPrincipaleHostId, clusterHaApparato, scegliPrincipale, isAdmin } = ctx;
  const [inCambio, setInCambio] = useState<number | null>(null);
  async function scegli(id: number) {
    setInCambio(id);
    try { await scegliPrincipale(id); } finally { setInCambio(null); }
  }
  return (
    <Section icon={<Link2 className="h-4 w-4" />} title="IP collegati allo stesso device fisico">
      <div className="space-y-3">
        {host?.physical_device_id && clusterMembers.length > 0 ? (
          <>
            <div className="text-xs text-muted-foreground">
              Cluster fisico <span className="font-mono">#{host.physical_device_id}</span> · {clusterMembers.length} {clusterMembers.length === 1 ? "IP" : "IP"} aggregati
            </div>
            {clusterHaApparato && (
              <p className="text-[13px] text-muted-foreground">
                Il cluster ha un apparato gestito: il suo IP è il principale e non si cambia.
              </p>
            )}
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
                    {m.id === clusterPrincipaleHostId ? (
                      <span
                        className="inline-flex min-h-[26px] items-center rounded-md border-2 border-[#0D2537] bg-[#0D2537] px-2.5 text-[13px] font-semibold text-white"
                        title="È l'IP che porta la riga in Discovery"
                      >
                        {m.ha_apparato ? "★ principale: IP dell'apparato" : "★ principale"}
                      </span>
                    ) : isAdmin && clusterPrincipaleHostId !== null && !clusterHaApparato && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[13px]"
                        onClick={() => void scegli(m.id)}
                        disabled={inCambio === m.id}
                        title="Questo IP porta la riga in Discovery; gli altri restano sotto «+N IP»"
                      >
                        {inCambio === m.id ? "…" : "Scegli come principale"}
                      </Button>
                    )}
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

      {/* Proxmox (nodi, VM, storage, interfacce): dal 21/10 sta nelle tab dell'hypervisor (tipi/hypervisor/). */}

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

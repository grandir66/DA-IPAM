"use client";

/**
 * Nodi del cluster. In Panoramica una riga per nodo (stato, RAM, VM, versione PVE); nella tab Nodi le card di
 * una volta (11 campi hardware + abbonamento), in griglia a due colonne. Storage e interfacce di rete dei nodi
 * stanno nelle loro tab. Il nodo della scheda è «questo», gli altri portano alla loro scheda.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { nodoDellaScheda, type NodoProxmox } from "@/lib/scheda/hypervisor";
import { cn } from "@/lib/utils";
import { BarraUso } from "../../barra-uso";
import { InfoRow, formatGb } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { lnk, pxDi, SenzaScansione, statoNodo, useAbbinamenti, type Abbinamenti } from "./dati-hypervisor";

function StatoNodoBadge({ stato }: { stato: "online" | "offline" | null }) {
  if (stato === "online") return <span className="font-semibold"><span aria-hidden>✓ </span>online</span>;
  if (stato === "offline") return <span className="font-semibold text-[#8E1B20] dark:text-[#E8625A]"><span aria-hidden>✕ </span>offline</span>;
  return <span className="text-muted-foreground"><span aria-hidden>● </span>non letto</span>;
}

function NomeNodo({ h, ctx, ab }: { h: NodoProxmox; ctx: ContestoScheda; ab: Abbinamenti }) {
  const questo = nodoDellaScheda(h, ctx.host);
  const id = ab.nodi.find((n) => n.nodo === h.hostname)?.host_id ?? null;
  return (
    <span className="inline-flex items-center gap-2">
      {!questo && id != null ? <Link href={`/objects/${id}`} className={cn(lnk, "font-mono")}>{h.hostname}</Link> : <span className="font-mono font-semibold">{h.hostname}</span>}
      {questo && <span className="rounded border-2 border-[#0D2537] px-1.5 text-[13px] font-semibold dark:border-[#E6EEF4]">questo</span>}
    </span>
  );
}

/** Una riga per nodo, per la Panoramica. */
export function RigheNodi({ ctx, nodi, ab }: { ctx: ContestoScheda; nodi: NodoProxmox[]; ab: Abbinamenti }) {
  const vms = ctx.device?.proxmox_data?.vms ?? [];
  const th = "border-b-2 bg-muted/60 px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground";
  const td = "border-b px-2 py-1.5 align-middle text-[13px]";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>Nodo</th><th className={th}>Stato</th><th className={th}>RAM</th><th className={th}>VM</th><th className={th}>PVE</th></tr></thead>
        <tbody>
          {nodi.map((h) => (
            <tr key={h.hostname}>
              <td className={cn(td, "whitespace-nowrap")}><NomeNodo h={h} ctx={ctx} ab={ab} /></td>
              <td className={cn(td, "whitespace-nowrap")}><StatoNodoBadge stato={statoNodo(h.hostname, h.status, ab)} /></td>
              <td className={cn(td, "w-40")}>{h.memory_usage_percent != null ? <BarraUso percento={h.memory_usage_percent} etichetta={`${Math.round(h.memory_usage_percent)}%`} /> : <span className="text-muted-foreground">non letta</span>}</td>
              <td className={cn(td, "tabular-nums")}>{vms.filter((v) => v.node === h.hostname).length}</td>
              <td className={cn(td, "whitespace-nowrap")}>{h.proxmox_version ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CardNodo({ h, ctx, ab }: { h: NodoProxmox; ctx: ContestoScheda; ab: Abbinamenti }) {
  const sub = h.subscription;
  const subStatus = sub?.status?.toLowerCase();
  const subAttiva = subStatus === "active" || subStatus === "active/valid";
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <NomeNodo h={h} ctx={ctx} ab={ab} />
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <StatoNodoBadge stato={statoNodo(h.hostname, h.status, ab)} />
          {h.proxmox_version && <Badge variant="outline" className="text-[13px]">PVE {h.proxmox_version}</Badge>}
          {sub?.productname && (
            <Badge variant="outline" className="text-[13px]"><span aria-hidden>{subAttiva ? "✓ " : "▲ "}</span>{sub.productname}{sub.level && ` (${sub.level})`}</Badge>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <InfoRow label="CPU" value={h.cpu_model ?? null} />
        <InfoRow label="Core / Socket" value={h.cpu_total_cores ? `${h.cpu_total_cores} core${h.cpu_sockets ? ` · ${h.cpu_sockets} socket` : ""}${h.cpu_cores ? ` (${h.cpu_cores}/socket)` : ""}` : null} />
        <InfoRow label="CPU MHz" value={h.cpu_mhz ? `${Math.round(h.cpu_mhz)} MHz` : null} />
        <InfoRow label="RAM totale" value={h.memory_total_gb ? `${h.memory_total_gb.toFixed(1)} GB` : null} />
        <InfoRow label="RAM usata" value={h.memory_used_gb != null ? `${h.memory_used_gb.toFixed(1)} GB${h.memory_usage_percent != null ? ` · ${Math.round(h.memory_usage_percent)}%` : ""}` : null} />
        <InfoRow label="RAM libera" value={h.memory_free_gb != null ? `${h.memory_free_gb.toFixed(1)} GB` : null} />
        <InfoRow label="Uptime" value={h.uptime_human ?? null} />
        <InfoRow label="Kernel" value={h.kernel_version ?? null} />
        <InfoRow label="Root FS" value={h.rootfs_total_gb ? `${formatGb(h.rootfs_used_gb)} / ${formatGb(h.rootfs_total_gb)}` : null} />
        <InfoRow label="Hardware" value={h.hardware_manufacturer || h.hardware_model ? `${h.hardware_manufacturer ?? ""} ${h.hardware_model ?? ""}`.trim() : null} />
        <InfoRow label="Serial HW" value={h.hardware_serial ?? null} mono />
      </dl>
      {sub && (
        <div className="mt-3 rounded-lg bg-muted/40 p-3">
          <div className="mb-1.5 text-[13px] font-bold uppercase tracking-wider text-muted-foreground">Abbonamento</div>
          <dl className="grid grid-cols-2 gap-3 [&_dd]:break-all">
            <InfoRow label="Stato" value={sub.status ?? null} />
            <InfoRow label="Prodotto" value={sub.productname ?? null} />
            <InfoRow label="Livello" value={sub.level ?? null} />
            <InfoRow label="Chiave" value={sub.key ?? null} mono />
            <InfoRow label="Registrata il" value={sub.regdate ?? null} />
            <InfoRow label="Scade il" value={sub.nextduedate ?? null} />
            <InfoRow label="Socket" value={sub.sockets != null ? String(sub.sockets) : null} />
            <InfoRow label="Server ID" value={sub.serverid ?? null} mono />
          </dl>
        </div>
      )}
    </section>
  );
}

export function NodiHypervisor({ ctx }: { ctx: ContestoScheda }) {
  const px = pxDi(ctx);
  const ab = useAbbinamenti(ctx.device?.id);
  const nodi = px?.hosts ?? [];
  if (!px || nodi.length === 0) return <SenzaScansione />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {nodi.map((h) => <CardNodo key={h.hostname} h={h} ctx={ctx} ab={ab} />)}
    </div>
  );
}

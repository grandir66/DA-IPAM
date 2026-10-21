"use client";

/**
 * VM e container: chip Accese/Spente/Senza agente/Tutte, ricerca per nome, IP o VLAN, e la tabella con
 * l'abbinamento «In IPAM» (link alla scheda dell'host). Lo scorrimento sta SOLO dentro la tabella.
 */
import { useState } from "react";
import Link from "next/link";
import { chiaveVm, lnk, pxDi, SenzaScansione, useAbbinamenti, type Abbinamenti } from "./dati-hypervisor";
import { contaChip, filtraVm, numeroVm, vlanVm, type ChipVm, type VmProxmox } from "@/lib/scheda/hypervisor";
import { cn } from "@/lib/utils";
import { formatGb } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";

export const CHIP: Array<{ id: ChipVm; testo: string }> = [
  { id: "accese", testo: "Accese" },
  { id: "spente", testo: "Spente" },
  { id: "senza_agente", testo: "Senza agente" },
  { id: "tutte", testo: "Tutte" },
];

export function Chip({ attivo, testo, n, onClick }: { attivo: boolean; testo: string; n: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={attivo}
      className={cn(
        "h-7 rounded-full border px-3 text-[13px] font-semibold",
        attivo ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]" : "bg-card hover:bg-muted/50",
      )}
    >
      {attivo && <span aria-hidden>● </span>}{testo} {n}
    </button>
  );
}

/** Stato con segno + parola: acceso ✓, spento ●, container acceso ✓; l'agente mancante ▲. */
function StatoVm({ v }: { v: VmProxmox }) {
  const acceso = v.status === "running";
  if (!acceso) return <span className="text-muted-foreground"><span aria-hidden>● </span>spenta</span>;
  if (v.type === "qemu" && Number(v.agent) !== 1) return <span className="font-semibold"><span aria-hidden>▲ </span>senza agente</span>;
  return <span><span aria-hidden>✓ </span>{v.type === "lxc" ? "acceso" : "accesa"}</span>;
}

function InIpam({ v, ab }: { v: VmProxmox; ab: Abbinamenti }) {
  const m = ab.vm.get(chiaveVm(v.node, v.vmid));
  if (m) return <Link href={`/objects/${m.host_id}`} className={lnk} title={m.hostname ?? undefined}>scheda ›</Link>;
  if (ab.stato === "caricamento") return <span className="text-muted-foreground">…</span>;
  if (ab.stato === "errore") return <span className="text-muted-foreground" title="L'abbinamento non è stato letto">non verificato</span>;
  return <span className="text-muted-foreground">non trovata</span>;
}

/** IP della VM: il primo che le appartiene (non quelli condivisi con altre VM, tipo i bridge docker) e quanti altri. */
function ipVm(v: VmProxmox, comuni: Set<string>): { primo: string | null; altri: number } {
  const propri = (v.ip_addresses ?? []).filter((ip) => !comuni.has(ip));
  return { primo: propri[0] ?? null, altri: Math.max(0, propri.length - 1) };
}

/** Gli IP che compaiono in più di una VM (docker, duplicati): non identificano la VM e non si mostrano come suoi. */
export function ipComuni(vms: VmProxmox[]): Set<string> {
  const n = new Map<string, number>();
  for (const v of vms) for (const ip of new Set(v.ip_addresses ?? [])) n.set(ip, (n.get(ip) ?? 0) + 1);
  return new Set([...n].filter(([, c]) => c > 1).map(([ip]) => ip));
}

export function TabellaVm({ vms, ab, compatta, altezza }: { vms: VmProxmox[]; ab: Abbinamenti; compatta?: boolean; altezza?: string }) {
  const comuni = ipComuni(vms);
  const th = "whitespace-nowrap border-b-2 bg-muted/60 px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground";
  const td = "whitespace-nowrap border-b px-2 py-1 align-middle text-[13px]";
  return (
    <div className={cn("overflow-auto rounded-lg border", altezza)}>
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10">
          <tr>
            <th className={th}>VMID</th><th className={th}>Nome</th><th className={th}>Nodo</th><th className={th}>Stato</th>
            {!compatta && <th className={th}>CPU · RAM</th>}
            {!compatta && <th className={th}>Disco</th>}
            <th className={th}>IP · VLAN</th><th className={th}>In IPAM</th>
          </tr>
        </thead>
        <tbody>
          {vms.map((v) => {
            const { primo, altri } = ipVm(v, comuni);
            const vlan = vlanVm(v);
            return (
              <tr key={chiaveVm(v.node, v.vmid)} className="hover:bg-muted/30">
                <td className={cn(td, "font-mono")}>{v.vmid}</td>
                <td className={cn(td, "max-w-[14rem] truncate font-semibold")} title={v.name}>
                  {v.name}{v.type === "lxc" && <span className="ml-1.5 rounded border px-1 text-[13px] font-normal text-muted-foreground">LXC</span>}
                </td>
                <td className={td}>{v.node}</td>
                <td className={td}><StatoVm v={v} /></td>
                {!compatta && <td className={cn(td, "tabular-nums")}>{v.maxcpu} · {v.memory_mb ? formatGb(v.memory_mb / 1024) : "—"}</td>}
                {!compatta && <td className={cn(td, "tabular-nums")}>{v.disk_gb ? formatGb(v.disk_gb) : "—"}</td>}
                <td className={td}>
                  {primo ? <span className="font-mono">{primo}{altri > 0 && <span className="text-muted-foreground"> +{altri}</span>}</span> : <span className="text-muted-foreground">IP non letto</span>}
                  {vlan.length > 0 && <span className="text-muted-foreground"> · VLAN {vlan.join(", ")}</span>}
                </td>
                <td className={td}><InIpam v={v} ab={ab} /></td>
              </tr>
            );
          })}
          {vms.length === 0 && (
            <tr><td colSpan={compatta ? 6 : 8} className="px-3 py-6 text-center text-sm text-muted-foreground">Nessuna VM con questi criteri.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function VmHypervisor({ ctx }: { ctx: ContestoScheda }) {
  const px = pxDi(ctx);
  const ab = useAbbinamenti(ctx.device?.id);
  const [chip, setChip] = useState<ChipVm>("accese");
  const [ricerca, setRicerca] = useState("");
  const vms = px?.vms ?? [];
  const conta = contaChip(vms);
  const visibili = filtraVm(vms, chip, ricerca);
  if (!px || vms.length === 0) return <SenzaScansione />;
  const totale = numeroVm(px);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {CHIP.map((c) => <Chip key={c.id} attivo={chip === c.id} testo={c.testo} n={conta[c.id]} onClick={() => setChip(c.id)} />)}
        <input
          type="search"
          value={ricerca}
          onChange={(e) => setRicerca(e.target.value)}
          placeholder="Cerca per nome, IP o VLAN"
          aria-label="Cerca per nome, IP o VLAN"
          className="ml-auto h-8 w-64 rounded-md border bg-background px-3 text-[13px]"
        />
      </div>
      {px._truncated && totale > vms.length && (
        <p className="text-[13px] font-semibold"><span aria-hidden>▲ </span>Elenco troncato: mostrate le prime {vms.length} di {totale}.</p>
      )}
      <TabellaVm vms={visibili} ab={ab} altezza="max-h-[calc(100vh-20.5rem)]" />
      <p className="text-[13px] text-muted-foreground">
        «In IPAM» abbina la VM al suo host per IP. Un IP che sta in più VM (bridge docker) non vale come abbinamento. {visibili.length} di {vms.length} mostrate.
      </p>
    </div>
  );
}

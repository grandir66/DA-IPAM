"use client";

/**
 * Rete dei nodi: le interfacce di ogni nodo del cluster (prima in fondo alla card del nodo), più «Sulla mappa»
 * e gli IP collegati allo stesso device fisico (un Proxmox ha spesso NIC su VLAN diverse).
 */
import { Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Section } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { IpCollegati, SullaMappa } from "../../dettagli/rete";
import { pxDi } from "./dati-hypervisor";

export function ReteHypervisor({ ctx }: { ctx: ContestoScheda }) {
  const nodi = (pxDi(ctx)?.hosts ?? []).filter((h) => (h.network_interfaces?.length ?? 0) > 0);
  const th = "border-b-2 bg-muted/60 px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground";
  const td = "border-b px-2 py-1.5 align-middle text-[13px]";
  return (
    <div className="space-y-4">
      {nodi.map((h) => (
        <Section key={h.hostname} icon={<Network className="h-4 w-4" />} title={`Interfacce di ${h.hostname} (${h.network_interfaces?.length ?? 0})`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr><th className={th}>Nome</th><th className={th}>Tipo</th><th className={th}>Stato</th><th className={th}>MAC</th><th className={th}>IP</th><th className={th}>Bridge</th><th className={th}>Velocità</th></tr></thead>
              <tbody>
                {h.network_interfaces?.map((nic) => (
                  <tr key={nic.name}>
                    <td className={`${td} font-mono font-semibold`}>{nic.name}</td>
                    <td className={td}><Badge variant="outline" className="text-[13px]">{nic.type ?? "?"}</Badge></td>
                    <td className={td}>{nic.state === "up" ? <span><span aria-hidden>✓ </span>up</span> : <span className="text-muted-foreground"><span aria-hidden>● </span>{nic.state ?? "?"}</span>}</td>
                    <td className={`${td} font-mono`}>{nic.mac_address ?? "—"}</td>
                    <td className={`${td} font-mono`}>{nic.ip_addresses ?? "—"}</td>
                    <td className={`${td} font-mono`}>{nic.bridge ?? "—"}</td>
                    <td className={td}>{nic.speed_mbps ? `${nic.speed_mbps} Mb/s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ))}
      {nodi.length === 0 && <p className="text-sm text-muted-foreground">La scansione non ha letto le interfacce dei nodi.</p>}
      {Number.isFinite(ctx.hostId) && ctx.hostId > 0 && <SullaMappa hostId={ctx.hostId} isAdmin={ctx.isAdmin} />}
      <IpCollegati ctx={ctx} />
    </div>
  );
}

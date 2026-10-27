"use client";

/**
 * Tab «Vicini e MAC»: vicini LLDP/CDP, «Neighbor per trunk» (dal vecchio schema porte), MAC table, Spanning Tree,
 * IP collegati e «Sulla mappa» (che stavano in Dettagli > Rete, che lo switch non ha più).
 */
import { Badge } from "@/components/ui/badge";
import { Riquadro } from "../../riquadro";
import { InfoRow } from "../../blocchi";
import { IpCollegati, SullaMappa } from "../../dettagli/rete";
import type { ContestoScheda } from "../../contesto";
import { NomeVicino, useViciniIpam } from "../../nome-vicino";
import { parseDbDate } from "@/lib/db-date";
import { porteDi, viciniDi } from "./dati-porte";
import { EtichettaFonte } from "../../librenms-pezzi";
import { datiAttivi, unisciVicini } from "@/lib/scheda/librenms-vista";

const th = "px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground whitespace-nowrap";
const MAX_MAC = 200;

export function ViciniSwitch({ ctx }: { ctx: ContestoScheda }) {
  const { device, hostId, isAdmin } = ctx;
  const l = datiAttivi(ctx.librenmsDati);
  const vicini = unisciVicini(viciniDi(ctx), l);
  const nDisaccordi = new Set(vicini.filter((v) => v.disaccordo).map((v) => v.portaLocale)).size;
  const mappaVicini = useViciniIpam(device?.id);
  const trunk = porteDi(ctx).filter((p) => p.is_trunk && (p.trunk_neighbor_name || p.trunk_neighbor_port || p.trunk_primary_name));
  const mac = device?.mac_port_entries ?? [];
  const stp = device?.stp_info ?? null;
  return (
    <div className="space-y-4">
      <Riquadro
        titolo={`Vicini LLDP / CDP (${vicini.length})`}
        vuoto={vicini.length === 0}
        azione={nDisaccordi > 0 ? <span className="text-[13px] font-semibold"><span aria-hidden>▲ </span>{nDisaccordi} {nDisaccordi === 1 ? "disaccordo" : "disaccordi"}</span> : undefined}
      >
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40">
              <tr><th className={th}>Porta locale</th><th className={th}>Dispositivo remoto</th><th className={th}>Porta remota</th><th className={th}>Protocollo</th><th className={th}>IP remoto</th><th className={th}>Piattaforma</th>{l && <th className={th}>Fonte</th>}</tr>
            </thead>
            <tbody>
              {vicini.map((v) => (
                <tr key={v.chiave} className={v.disaccordo ? "border-b bg-[repeating-linear-gradient(135deg,transparent_0_8px,rgba(230,159,0,0.14)_8px_10px)]" : "border-b"}>
                  <td className="px-3 py-1.5 font-mono font-semibold">{v.portaLocale}</td>
                  <td className="px-3 py-1.5 font-medium"><NomeVicino nome={v.nome} ip={v.ip} mac={v.mac} mappa={mappaVicini} /></td>
                  <td className="px-3 py-1.5 font-mono">{v.portaRemota ?? "—"}</td>
                  <td className="px-3 py-1.5"><Badge variant="outline" className="text-[13px] uppercase">{v.protocollo || "?"}</Badge></td>
                  <td className="px-3 py-1.5 font-mono">{v.ip ?? "—"}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{v.piattaforma ?? "—"}</td>
                  {l && (
                    <td className="px-3 py-1.5">
                      <EtichettaFonte fonte={v.fonte} ora={v.fonte === "ipam" ? null : v.ora} />
                      {v.disaccordo && v.fonte === "librenms" && <span className="ml-2 inline-block whitespace-nowrap rounded-full bg-[repeating-linear-gradient(135deg,#E69F00_0_6px,#F3C25A_6px_10px)] px-2 text-[13px] font-semibold text-[#0D2537]"><span aria-hidden>▲ </span>le fonti non concordano</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Riquadro>

      <Riquadro titolo={`Neighbor per trunk (${trunk.length})`} vuoto={trunk.length === 0}>
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40">
              <tr><th className={th}>Porta</th><th className={th}>Vicino</th><th className={th}>Da dove lo so</th><th className={th}>MAC</th></tr>
            </thead>
            <tbody>
              {trunk.map((p) => {
                const lldp = [p.trunk_neighbor_name, p.trunk_neighbor_port].filter(Boolean).join(" · porta ");
                return (
                  <tr key={p.id} className="border-b">
                    <td className="px-3 py-1.5 font-mono font-semibold">{p.port_name}</td>
                    <td className="px-3 py-1.5">{lldp || p.trunk_primary_name}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{lldp ? "LLDP / CDP" : "ARP e apparati registrati (peer principale)"}</td>
                    <td className="px-3 py-1.5 font-mono">{p.mac_count}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Riquadro>

      <Riquadro titolo={`MAC table (${mac.length})`} vuoto={mac.length === 0}>
        <div className="-m-4 max-h-96 overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 border-b-2 bg-muted"><tr><th className={th}>Porta</th><th className={th}>MAC</th><th className={th}>VLAN</th><th className={th}>Host associato</th><th className={th}>Visto</th></tr></thead>
            <tbody>
              {mac.slice(0, MAX_MAC).map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="px-3 py-1.5 font-mono font-semibold">{m.port_name}</td>
                  <td className="px-3 py-1.5 font-mono">{m.mac}</td>
                  <td className="px-3 py-1.5 font-mono">{m.vlan ?? "—"}</td>
                  <td className="px-3 py-1.5">{m.host_ip || m.host_name ? <><span className="font-mono">{m.host_ip ?? ""}</span>{m.host_name && <span className="text-muted-foreground"> · {m.host_name}</span>}</> : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{m.timestamp ? parseDbDate(m.timestamp).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mac.length > MAX_MAC && <p className="mt-3 text-[13px] text-muted-foreground">Mostrate le prime {MAX_MAC} di {mac.length}.</p>}
      </Riquadro>

      <Riquadro
        titolo="Spanning Tree"
        vuoto={!stp}
        azione={stp ? (
          <span className="inline-flex gap-1.5">
            {stp.is_root_bridge && <Badge variant="outline" className="text-[13px]">✓ root bridge</Badge>}
            {stp.protocol && <Badge variant="outline" className="text-[13px]">{stp.protocol.toUpperCase()}</Badge>}
          </span>
        ) : undefined}
      >
        {stp && (
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <InfoRow label="Bridge ID" value={stp.bridge_id ?? null} mono />
            <InfoRow label="Root bridge ID" value={stp.root_bridge_id ?? null} mono />
            <InfoRow label="Priorità" value={stp.priority != null ? String(stp.priority) : null} />
            <InfoRow label="Costo verso la root" value={stp.root_cost != null ? String(stp.root_cost) : null} />
            <InfoRow label="Porta root" value={stp.root_port ?? null} />
            <InfoRow label="Hello time" value={stp.hello_time_s != null ? `${stp.hello_time_s}s` : null} />
            <InfoRow label="Forward delay" value={stp.forward_delay_s != null ? `${stp.forward_delay_s}s` : null} />
            <InfoRow label="Max age" value={stp.max_age_s != null ? `${stp.max_age_s}s` : null} />
          </dl>
        )}
      </Riquadro>

      {Number.isFinite(hostId) && hostId > 0 && <SullaMappa hostId={hostId} isAdmin={isAdmin} />}
      <IpCollegati ctx={ctx} />
    </div>
  );
}

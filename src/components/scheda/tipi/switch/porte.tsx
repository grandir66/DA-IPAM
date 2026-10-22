"use client";

/**
 * Tab «Porte»: la tabella completa delle porte (spostata da `devices/[id]/page.tsx` «Schema porte», 9 colonne),
 * con i link a `/objects/<hostId>`. Le colonne senza dati per tutte le porte non si rendono. In fondo LibreNMS
 * (grafici), che senza «Dettagli» non avrebbe più un posto.
 */
import { Cable } from "lucide-react";
import { Riquadro } from "../../riquadro";
import { SezioneLibreNms } from "../../dettagli/generale";
import type { ContestoScheda } from "../../contesto";
import { PoePorta, StatoPorta, Velocita, AttaccatoCella, colonneConDato } from "./celle";
import { porteDi } from "./dati-porte";
import { EtichettaFonte, oraBreve } from "../../librenms-pezzi";
import type { SwitchPort } from "@/types";
import { datiAttivi, haAlias, nostroGiroVecchio, unisciPorte, type PortaVista } from "@/lib/scheda/librenms-vista";

/** La riga con lo stato, la velocità e la VLAN della fonte scelta; le colonne dei nostri dati (MAC, PoE, STP) restano le nostre. */
function portaDiRiga(v: PortaVista, nostre: Map<number, SwitchPort>): SwitchPort {
  const n = v.portaId !== null ? nostre.get(v.portaId) : undefined;
  const base: SwitchPort = n ?? {
    id: -1, device_id: 0, port_index: 0, port_name: v.nome, status: null, speed: null, duplex: null, vlan: null, poe_status: null, poe_power_mw: null,
    mac_count: 0, is_trunk: 0, single_mac: null, single_mac_vendor: null, single_mac_ip: null, single_mac_hostname: null, host_id: null,
    trunk_neighbor_name: null, trunk_neighbor_port: null, trunk_primary_device_id: null, trunk_primary_name: null, stp_state: null, timestamp: "",
  };
  return { ...base, status: v.stato, speed: v.velocita, vlan: v.vlan };
}

export function PorteSwitch({ ctx }: { ctx: ContestoScheda }) {
  const nostre = porteDi(ctx);
  const l = datiAttivi(ctx.librenmsDati);
  const vista = unisciPorte(nostre, l);
  const perId = new Map(nostre.map((p) => [p.id, p]));
  const righe = vista.map((v) => ({ v, p: portaDiRiga(v, perId) }));
  const porte = righe.map((r) => r.p);
  const col = colonneConDato(porte);
  const alias = haAlias(vista);
  const vecchio = nostroGiroVecchio(vista, nostre);
  const su = porte.filter((p) => p.status === "up").length;
  const trunk = porte.filter((p) => p.is_trunk).length;
  const th = "px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground whitespace-nowrap";
  return (
    <div className="space-y-4">
      <Riquadro titolo={`Schema porte (${porte.length})`} azione={<span className="text-[13px] text-muted-foreground">{su} su · {porte.length - su} giù · {trunk} trunk</span>}>
        {vecchio && (
          <p className="mb-3 rounded-md border border-[#E69F00] px-3 py-2 text-[13px] font-semibold"><span aria-hidden>▲ </span>Porte da LibreNMS: la lettura di DA-IPAM è del {oraBreve(vecchio)}</p>
        )}
        {porte.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Cable className="h-4 w-4" />Nessuna porta rilevata. Aggiorna i dati per acquisire lo schema porte, LLDP/CDP e Spanning Tree.</p>
        ) : (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b-2 bg-muted/40">
                <tr>
                  <th className={th}>Porta</th>
                  <th className={th}>Stato</th>
                  {col.velocita && <th className={th}>Velocità</th>}
                  {col.vlan && <th className={th}>VLAN</th>}
                  {col.stp && <th className={th}>STP</th>}
                  {col.poe && <th className={th}>PoE</th>}
                  {alias && <th className={th}>Alias</th>}
                  <th className={th}>MAC</th>
                  <th className={th}>Neighbor / dispositivo collegato</th>
                  {l && <th className={th}>Fonte</th>}
                </tr>
              </thead>
              <tbody>
                {righe.map(({ v, p }) => (
                  <tr key={v.chiave} className={`border-b ${p.status === "up" ? "" : "bg-muted/30 text-muted-foreground"}`}>
                    <td className="px-3 py-1.5 font-mono font-semibold">{p.port_name}{p.is_trunk ? <span title="Trunk / LAG" className="ml-1.5 font-sans text-[13px] font-normal text-muted-foreground">trunk</span> : null}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap"><StatoPorta p={p} trunkSegno={false} /></td>
                    {col.velocita && <td className="px-3 py-1.5 whitespace-nowrap"><Velocita p={p} /></td>}
                    {col.vlan && <td className="px-3 py-1.5 font-mono">{p.vlan ?? "—"}</td>}
                    {col.stp && <td className="px-3 py-1.5 capitalize" title="Spanning Tree">{p.stp_state ?? "—"}</td>}
                    {col.poe && <td className="px-3 py-1.5 whitespace-nowrap"><PoePorta p={p} /></td>}
                    {alias && <td className="px-3 py-1.5">{v.alias ?? ""}</td>}
                    <td className="px-3 py-1.5 font-mono">{v.portaId !== null ? p.mac_count : "—"}</td>
                    <td className="px-3 py-1.5">{v.portaId !== null ? <AttaccatoCella p={p} /> : null}</td>
                    {l && <td className="px-3 py-1.5"><EtichettaFonte fonte={v.fonte} ora={v.ora} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Riquadro>
      <SezioneLibreNms ctx={ctx} />
    </div>
  );
}

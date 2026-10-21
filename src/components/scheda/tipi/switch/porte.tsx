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

export function PorteSwitch({ ctx }: { ctx: ContestoScheda }) {
  const porte = porteDi(ctx);
  const col = colonneConDato(porte);
  const su = porte.filter((p) => p.status === "up").length;
  const trunk = porte.filter((p) => p.is_trunk).length;
  const th = "px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground whitespace-nowrap";
  return (
    <div className="space-y-4">
      <Riquadro titolo={`Schema porte (${porte.length})`} azione={<span className="text-[13px] text-muted-foreground">{su} su · {porte.length - su} giù · {trunk} trunk</span>}>
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
                  <th className={th}>MAC</th>
                  <th className={th}>Neighbor / dispositivo collegato</th>
                </tr>
              </thead>
              <tbody>
                {porte.map((p) => (
                  <tr key={p.id} className={`border-b ${p.status === "up" ? "" : "bg-muted/30 text-muted-foreground"}`}>
                    <td className="px-3 py-1.5 font-mono font-semibold">{p.port_name}{p.is_trunk ? <span title="Trunk / LAG" className="ml-1.5 font-sans text-[13px] font-normal text-muted-foreground">trunk</span> : null}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap"><StatoPorta p={p} trunkSegno={false} /></td>
                    {col.velocita && <td className="px-3 py-1.5 whitespace-nowrap"><Velocita p={p} /></td>}
                    {col.vlan && <td className="px-3 py-1.5 font-mono">{p.vlan ?? "—"}</td>}
                    {col.stp && <td className="px-3 py-1.5 capitalize" title="Spanning Tree">{p.stp_state ?? "—"}</td>}
                    {col.poe && <td className="px-3 py-1.5 whitespace-nowrap"><PoePorta p={p} /></td>}
                    <td className="px-3 py-1.5 font-mono">{p.mac_count}</td>
                    <td className="px-3 py-1.5"><AttaccatoCella p={p} /></td>
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

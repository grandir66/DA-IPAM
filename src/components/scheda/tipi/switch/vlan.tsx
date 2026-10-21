"use client";

/** Tab «VLAN»: le VLAN distinte lette da `switch_ports.vlan`, con quante porte e quali. (I nomi delle VLAN non sono nel dato.) */
import { Riquadro } from "../../riquadro";
import { numeroPorta, vlanDistinte } from "@/lib/scheda/porte-da-guardare";
import type { ContestoScheda } from "../../contesto";
import { porteDi } from "./dati-porte";

export function VlanSwitch({ ctx }: { ctx: ContestoScheda }) {
  const porte = porteDi(ctx);
  const vlan = vlanDistinte(porte);
  const th = "px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground";
  return (
    <Riquadro titolo={`VLAN (${vlan.length})`}>
      {vlan.length === 0 ? (
        <p className="text-sm text-muted-foreground">Lo switch non dichiara la VLAN delle porte.</p>
      ) : (
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40">
              <tr><th className={th}>VLAN</th><th className={th}>Porte</th><th className={th}>di cui trunk</th><th className={th}>Quali</th></tr>
            </thead>
            <tbody>
              {vlan.map((v) => {
                const quali = porte.filter((p) => p.vlan === v.vlan).map((p) => numeroPorta(p));
                return (
                  <tr key={v.vlan} className="border-b align-top">
                    <td className="px-3 py-2 font-mono text-base font-semibold">{v.vlan}</td>
                    <td className="px-3 py-2">{v.porte}</td>
                    <td className="px-3 py-2">{v.trunk > 0 ? `${v.trunk}` : "—"}</td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{quali.join(", ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Riquadro>
  );
}

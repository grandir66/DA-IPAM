"use client";

/**
 * Tab «Sensori» (piano 2026-10-22 LibreNMS, task 7, tavola L1): i sensori che LibreNMS ha dell'oggetto, un gruppo per classe.
 * La tab c'è solo se LibreNMS ha almeno un sensore e la sua lettura è accesa (`haSensori` in `tabDelTipo`).
 */
import { Riquadro } from "./riquadro";
import type { ContestoScheda } from "./contesto";
import { PastigliaStato, oraBreve, soloOra } from "./librenms-pezzi";
import { datiAttivi, gruppiSensori, letturaVecchia, statoSensore, unitaSensore } from "@/lib/scheda/librenms-vista";

const th = "px-3 py-2 text-left text-[13px] font-semibold text-muted-foreground whitespace-nowrap";
const nf = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 });
const num = (n: number | null, u: string): string => (n === null ? "—" : `${nf.format(n)}${u ? ` ${u}` : ""}`);

export function TabSensori({ ctx }: { ctx: ContestoScheda }) {
  const d = datiAttivi(ctx.librenmsDati);
  if (!d || d.sensori.length === 0) return <p className="text-sm text-muted-foreground">LibreNMS non ha sensori di questo oggetto.</p>;
  const gruppi = gruppiSensori(d.sensori);
  const letto = d.letture.sensori.letto_il;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted-foreground">Da LibreNMS · letti il {oraBreve(letto)} · {d.sensori.length} sensori</p>
      {letturaVecchia(letto) && (
        <p className="rounded-md border border-[#E69F00] px-3 py-2 text-[13px] font-semibold"><span aria-hidden>▲ </span>Dati di LibreNMS del {oraBreve(letto)}: possono essere vecchi.</p>
      )}
      {gruppi.map((g) => (
        <Riquadro key={g.id} titolo={g.titolo} azione={g.unita ? <span className="text-[13px] text-muted-foreground">{g.unita}</span> : undefined}>
          <div className="-m-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="border-b-2 bg-muted/40">
                <tr><th className={th}>Sensore</th><th className={th}>Valore</th><th className={th}>Limite basso</th><th className={th}>Limite alto</th><th className={th}>Stato</th><th className={th}>Aggiornato</th></tr>
              </thead>
              <tbody>
                {g.righe.map((s) => {
                  const u = unitaSensore(s.classe);
                  return (
                    <tr key={s.sensor_id} className="border-b">
                      <td className="px-3 py-1.5">{s.descrizione ?? `Sensore ${s.sensor_id}`}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{num(s.valore, u)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{num(s.limite_basso, u)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">{num(s.limite_alto, u)}</td>
                      <td className="px-3 py-1.5"><PastigliaStato stato={statoSensore(s.valore, s.limite_basso, s.limite_alto)} /></td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{soloOra(s.aggiornato_il ?? s.letto_il)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Riquadro>
      ))}
    </div>
  );
}

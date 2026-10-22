"use client";

/**
 * Tab «Dipendenze»: i servizi NIS2 che poggiano su questo server (service_asset_dependencies), il più critico
 * per primo. Il dato era già nel database e non si vedeva in scheda.
 */
import Link from "next/link";
import type { ContestoScheda } from "../../contesto";
import { Riquadro } from "../../riquadro";
import { Nessun, lnk, td, th } from "./dati-server";

const TIPO: Record<string, string> = { primario: "primario", secondario: "secondario", supporto: "di supporto" };

export function DipendenzeServer({ ctx }: { ctx: ContestoScheda }) {
  const servizi = ctx.dipendenze?.servizi ?? [];
  if (servizi.length === 0) return <Nessun>Nessun servizio NIS2 dipende da questo server.</Nessun>;
  return (
    <Riquadro titolo={`Chi dipende da questo server (${servizi.length})`} azione={<Link href="/services" className={lnk}>tutti i servizi ›</Link>}>
      <table className="w-full border-collapse">
        <thead><tr><th className={th}>Servizio</th><th className={th}>Criticità</th><th className={th}>Dipendenza</th></tr></thead>
        <tbody>
          {servizi.map((s) => {
            const critico = s.criticita === "critica" || s.criticita === "alta";
            return (
              <tr key={s.id}>
                <td className={td}><Link href={`/services/${s.id}`} className={`${lnk} text-sm`}>{s.nome}</Link></td>
                <td className={td}>
                  {s.criticita ? <span className={critico ? "font-semibold text-[#8E1B20] dark:text-[#E8625A]" : ""}><span aria-hidden>{critico ? "▲ " : "● "}</span>{s.criticita}</span> : <span className="text-muted-foreground">non indicata</span>}
                </td>
                <td className={td}>{TIPO[s.tipo] ?? s.tipo}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Riquadro>
  );
}

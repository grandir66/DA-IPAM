"use client";

/**
 * Tab «Software» dei server Windows: i programmi chiave rilevati (`key_software`, prima solo in /devices) e,
 * sotto, l'inventario di prima (agente GLPI e scansione remota).
 */
import { Campo } from "../../blocchi";
import type { ContestoScheda } from "../../contesto";
import { DettagliSoftware } from "../../dettagli/software";
import { Riquadro } from "../../riquadro";
import { infoDi, td, th } from "./dati-server";

export function SoftwareServer({ ctx }: { ctx: ContestoScheda }) {
  const di = infoDi(ctx);
  const chiave = di?.key_software ?? [];
  const conteggio = di?.installed_software_count ?? null;
  return (
    <div className="space-y-4">
      <Riquadro titolo={`Programmi chiave (${chiave.length})`} vuoto={chiave.length === 0 && conteggio == null}
        azione={conteggio != null ? <span className="text-[13px] text-muted-foreground">{conteggio} installati in tutto</span> : undefined}>
        {chiave.length === 0 ? (
          <dl><Campo label="Programmi installati" value={String(conteggio)} /></dl>
        ) : (
          <table className="w-full border-collapse">
            <thead><tr><th className={th}>Programma</th><th className={th}>Versione</th><th className={th}>Produttore</th></tr></thead>
            <tbody>
              {chiave.map((s, i) => (
                <tr key={`${s.name}-${i}`}>
                  <td className={`${td} font-semibold`}>{s.name}</td>
                  <td className={`${td} font-mono`}>{s.version ?? ""}</td>
                  <td className={`${td} text-muted-foreground`}>{s.publisher ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Riquadro>
      <DettagliSoftware ctx={ctx} />
    </div>
  );
}

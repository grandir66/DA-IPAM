"use client";

/**
 * Tab «UPS»: tutto lo stato letto, in quattro riquadri (UPS, batteria, rete elettrica e uscita, ultimo test). Le righe
 * da guardare hanno ▲ e il testo ambra. Senza inventario lo dice.
 */
import { riquadriUps } from "@/lib/scheda/ups";
import { Riquadro } from "../../riquadro";
import type { ContestoScheda } from "../../contesto";
import { SenzaInventarioUps, upsDi, upsLetto } from "./dati-ups";

export function StatoUps({ ctx }: { ctx: ContestoScheda }) {
  const snap = upsDi(ctx);
  if (!upsLetto(snap)) return <SenzaInventarioUps />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {riquadriUps(snap).map((r) => (
        <Riquadro key={r.titolo} titolo={r.titolo}>
          <dl className="grid grid-cols-1 gap-y-1">
            {r.righe.map((riga) => (
              <div key={riga.etichetta} className="flex justify-between gap-3 border-b border-border/50 py-1">
                <dt className="text-[13px] text-muted-foreground">{riga.etichetta}</dt>
                <dd className={riga.attenzione ? "text-right text-[13px] font-semibold text-[#7A5E00] dark:text-[#FFD400]" : "text-right text-[13px] font-medium text-[#0D2537] dark:text-foreground"}>
                  {riga.attenzione && <span aria-hidden>▲ </span>}
                  {riga.valore}
                </dd>
              </div>
            ))}
          </dl>
        </Riquadro>
      ))}
    </div>
  );
}

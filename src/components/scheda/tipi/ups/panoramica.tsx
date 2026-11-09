"use client";

/**
 * Panoramica UPS: striscia dei numeri (rete elettrica, batteria, autonomia, carico, ultimo test, allarmi), le due barre
 * carica e carico, e la riga delle fonti. Senza inventario letto ricade sulla panoramica generica.
 */
import { batteriaInAllarme, caselleUps, fmtAutonomia, SOGLIE_UPS } from "@/lib/scheda/ups";
import { parseUtcDate } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import { RigaFontiScheda, type Fonte } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import { PanoramicaGenerica } from "../../panoramica-generica";
import type { ContestoScheda } from "../../contesto";
import { BarraUps, upsDi, upsLetto } from "./dati-ups";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PanoramicaUps({ ctx }: { ctx: ContestoScheda }) {
  const snap = upsDi(ctx);
  if (!upsLetto(snap)) return <PanoramicaGenerica ctx={ctx} />;

  const { apriTab, device } = ctx;
  const di = device?.device_info ?? null;
  const carica = snap.battery?.charge_pct;
  const carico = snap.output?.load_pct;
  const autonomia = snap.battery?.runtime_min;

  const quando = di?.scanned_at ? breve(di.scanned_at) : undefined;
  const fonte = (nome: string, letta: boolean): Fonte =>
    letta ? { nome, esito: "ok" as const, ...(quando ? { quando } : {}) } : { nome, esito: "assente" as const, nota: "non risponde" };
  const fonti: Fonte[] = [fonte("UPS-MIB", snap.sources.includes("ups_mib")), fonte("APC PowerNet", snap.sources.includes("apc"))];

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselleUps(snap)} onApriTab={apriTab} />

      <Riquadro
        titolo="Batteria e carico"
        vuoto={typeof carica !== "number" && typeof carico !== "number"}
        azione={<button type="button" onClick={() => apriTab("ups")} className="text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300">stato completo ›</button>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {typeof carica === "number" && (
            <BarraUps
              etichetta="Carica della batteria"
              pct={carica}
              attenzione={batteriaInAllarme(snap)}
              nota={typeof autonomia === "number" ? `${fmtAutonomia(autonomia)} di autonomia` : undefined}
            />
          )}
          {typeof carico === "number" && (
            <BarraUps
              etichetta="Carico in uscita"
              pct={carico}
              attenzione={carico >= SOGLIE_UPS.caricoMax}
              nota={typeof snap.output?.power_w === "number" ? `${snap.output.power_w.toLocaleString("it-IT")} W` : undefined}
            />
          )}
        </div>
      </Riquadro>

      <RigaFontiScheda ctx={ctx} fonti={fonti} />
    </div>
  );
}

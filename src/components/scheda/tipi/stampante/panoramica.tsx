"use client";

/**
 * Panoramica stampante: striscia dei numeri (pagine, stato, materiali, errori), i materiali coi livelli
 * e la riga delle fonti. Senza inventario Printer-MIB ricade sulla panoramica generica.
 */
import { caselleStampante, materialiOrdinati } from "@/lib/scheda/stampante";
import { parseUtcDate } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import { RigaFontiScheda, type Fonte } from "../../riga-fonti";
import { StrisciaNumeri } from "../../striscia-numeri";
import { PanoramicaGenerica } from "../../panoramica-generica";
import type { ContestoScheda } from "../../contesto";
import { stampanteDi, BarraMateriale } from "./dati-stampante";

const breve = (iso: string): string =>
  parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function PanoramicaStampante({ ctx }: { ctx: ContestoScheda }) {
  const snap = stampanteDi(ctx);
  if (!snap) return <PanoramicaGenerica ctx={ctx} />;

  const { apriTab, device } = ctx;
  const di = device?.device_info ?? null;
  const caselle = caselleStampante(snap);
  const materiali = materialiOrdinati(snap);
  const errori = snap.snmp?.errors ?? [];

  const quando = di?.scanned_at ? breve(di.scanned_at) : undefined;
  const fonti: Fonte[] = [
    snap.sources.includes("snmp")
      ? { nome: "SNMP", esito: "ok" as const, ...(quando ? { quando } : {}) }
      : { nome: "SNMP", esito: "assente" as const, nota: "non letto" },
  ];

  return (
    <div className="space-y-4">
      <StrisciaNumeri caselle={caselle} onApriTab={apriTab} />

      <Riquadro
        titolo={`Materiali di consumo (${materiali.length})`}
        vuoto={materiali.length === 0}
        azione={<button type="button" onClick={() => apriTab("materiali")} className="text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300">materiali e contatori ›</button>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {materiali.slice(0, 6).map((m, i) => <BarraMateriale key={i} m={m} />)}
        </div>
      </Riquadro>

      {errori.length > 0 && (
        <Riquadro titolo={`Errori (${errori.length})`}>
          <ul className="space-y-1 text-[13px] text-[#7A5E00] dark:text-[#FFD400]">
            {errori.map((e, i) => <li key={i}><span aria-hidden>▲ </span>{e}</li>)}
          </ul>
        </Riquadro>
      )}

      <RigaFontiScheda ctx={ctx} fonti={fonti} />
    </div>
  );
}

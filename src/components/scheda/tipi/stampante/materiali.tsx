"use client";

/**
 * Tab «Materiali e contatori» della stampante: tutti i materiali di consumo coi livelli, i vassoi,
 * il contatore pagine, modello/seriale ed eventuali errori. Senza inventario lo dice.
 */
import { Riquadro } from "../../riquadro";
import type { ContestoScheda } from "../../contesto";
import { materialiOrdinati } from "@/lib/scheda/stampante";
import { stampanteDi, SenzaInventarioStampante, BarraMateriale } from "./dati-stampante";

export function MaterialiStampante({ ctx }: { ctx: ContestoScheda }) {
  const snap = stampanteDi(ctx);
  if (!snap?.snmp) return <SenzaInventarioStampante />;
  const s = snap.snmp;
  const materiali = materialiOrdinati(snap);
  const vassoi = s.trays ?? [];
  const errori = s.errors ?? [];

  const righeInfo: Array<[string, string]> = [];
  if (s.model) righeInfo.push(["Modello", s.model]);
  if (s.serial) righeInfo.push(["Seriale", s.serial]);
  if (ctx.device?.part_number) righeInfo.push(["Part number", ctx.device.part_number]);
  if (typeof s.total_pages === "number" && s.total_pages >= 0) righeInfo.push(["Pagine totali", s.total_pages.toLocaleString("it-IT")]);
  if (s.status) righeInfo.push(["Stato", s.status]);

  return (
    <div className="space-y-4">
      <Riquadro titolo="Stampante" vuoto={righeInfo.length === 0}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {righeInfo.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 border-b border-border/50 py-1">
              <dt className="text-[13px] text-muted-foreground">{k}</dt>
              <dd className="text-[13px] font-medium text-[#0D2537] dark:text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </Riquadro>

      <Riquadro titolo={`Materiali di consumo (${materiali.length})`} vuoto={materiali.length === 0}>
        <div className="grid gap-4 sm:grid-cols-2">
          {materiali.map((m, i) => <BarraMateriale key={i} m={m} />)}
        </div>
      </Riquadro>

      <Riquadro titolo={`Vassoi (${vassoi.length})`} vuoto={vassoi.length === 0}>
        <ul className="divide-y divide-border/50">
          {vassoi.map((t, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
              <span className="truncate text-[#0D2537] dark:text-foreground">{t.name || `Vassoio ${i + 1}`}{t.media ? ` — ${t.media}` : ""}</span>
              <span className="text-muted-foreground">{typeof t.level_pct === "number" ? `${t.level_pct}%` : "livello n/d"}</span>
            </li>
          ))}
        </ul>
      </Riquadro>

      {errori.length > 0 && (
        <Riquadro titolo={`Errori (${errori.length})`}>
          <ul className="space-y-1 text-[13px] text-[#7A5E00] dark:text-[#FFD400]">
            {errori.map((e, i) => <li key={i}><span aria-hidden>▲ </span>{e}</li>)}
          </ul>
        </Riquadro>
      )}
    </div>
  );
}

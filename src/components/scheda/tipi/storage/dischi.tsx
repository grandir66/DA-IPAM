"use client";

/**
 * Alloggiamenti del NAS e dettaglio del disco (usati dalla Panoramica e dalla tab «Dischi e RAID»). Un riquadro
 * per disco nell'ordine dello slot: buono scuro pieno, attenzione giallo col bordo spesso, ▲ e il motivo, vuoto
 * tratteggiato. Il clic sceglie il disco e ne mostra il dettaglio con i soli campi che l'apparato dà.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { alloggiamenti, formattaGb, gruppiRaidNas, riepilogoDischi, type Alloggiamento } from "@/lib/scheda/nas";
import { Campo } from "../../blocchi";
import { Riquadro } from "../../riquadro";
import { BarraUso } from "../../barra-uso";
import type { ContestoScheda } from "../../contesto";
import { SenzaInventario, StatoNas, nasDi } from "./dati-nas";

/** Il disco da mostrare all'apertura: il primo in attenzione, altrimenti nessuno. */
export function discoIniziale(a: Alloggiamento[]): number | null {
  return a.find((x) => x.stato.stato === "attenzione")?.numero ?? null;
}

export function Alloggiamenti({ lista, scelto, onScegli }: { lista: Alloggiamento[]; scelto: number | null; onScegli: (n: number) => void }) {
  const colonne = lista.length > 8 ? "grid-cols-6" : "grid-cols-4";
  return (
    <ul className={cn("grid gap-2", colonne)}>
      {lista.map((x) => {
        const st = x.stato.stato;
        const base = "flex h-[112px] w-full min-w-0 flex-col justify-between rounded-lg p-2 text-left text-[13px]";
        const classi = st === "buono"
          ? "border-2 border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]"
          : st === "attenzione"
            ? "border-[3px] border-[#0D2537] bg-[#FFD400] text-[#0D2537]"
            : "border-2 border-dashed border-[#C5CED4] bg-card text-muted-foreground dark:border-[#4A6070]";
        if (st === "vuoto") {
          return (
            <li key={x.numero}>
              <div className={cn(base, classi)} aria-label={`Alloggiamento ${x.numero} vuoto`}>
                <span className="font-bold">{x.numero}</span>
                <span>vuoto</span>
              </div>
            </li>
          );
        }
        const d = x.disco!;
        return (
          <li key={x.numero}>
            <button
              type="button"
              onClick={() => onScegli(x.numero)}
              aria-pressed={scelto === x.numero}
              className={cn(base, classi, scelto === x.numero && "ring-2 ring-[#006C96] ring-offset-2 ring-offset-background")}
            >
              <span className="flex items-center justify-between font-bold">
                <span>{x.numero}</span>
                <span aria-hidden>{st === "attenzione" ? "▲" : "✓"}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold" title={d.model}>{d.model || "disco"}</span>
                {d.capacity_gb != null && <span className="block">{formattaGb(d.capacity_gb)}</span>}
              </span>
              <span className="block truncate" title={x.stato.motivi.join(" · ")}>
                {st === "attenzione" ? x.stato.motivi[0] : d.temperature_c != null ? `${d.temperature_c} °C` : "buono"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function DettaglioDisco({ a }: { a: Alloggiamento | undefined }) {
  if (!a || !a.disco) return <p className="text-sm text-muted-foreground">Clic su un disco per vederne il dettaglio.</p>;
  const d = a.disco;
  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold">Disco {a.numero}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
        <Campo label="Modello" value={d.model} />
        <Campo label="Seriale" value={d.serial} mono />
        <Campo label="Tipo" value={d.type} />
        <Campo label="Capacità" value={d.capacity_gb != null ? formattaGb(d.capacity_gb) : null} />
        <Campo label="Temperatura" value={d.temperature_c != null ? `${d.temperature_c} °C` : null} />
        <Campo label="SMART">
          {a.stato.stato === "attenzione"
            ? <StatoNas ok={false} testo={a.stato.motivi.join(" · ")} />
            : <StatoNas ok testo={d.smart_health ? "buono" : "nessun avviso"} />}
        </Campo>
      </dl>
      <p className="text-[13px] text-muted-foreground">Settori riallocati e ore di lavoro non vengono letti da questo apparato.</p>
    </div>
  );
}

export function DischiNas({ ctx }: { ctx: ContestoScheda }) {
  const nas = nasDi(ctx);
  const lista = nas ? alloggiamenti(nas.snmp?.disks, nas.vendor) : [];
  const [scelto, setScelto] = useState<number | null>(() => discoIniziale(lista));
  if (!nas) return <SenzaInventario />;
  if (lista.length === 0) return <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Nessun disco letto dall&apos;apparato.</p>;
  const r = riepilogoDischi(lista);
  const gruppi = gruppiRaidNas(nas);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Riquadro titolo={`Alloggiamenti (${r.presenti} dischi${r.attenzione ? ` · ${r.attenzione} in attenzione` : ""})`}>
          <Alloggiamenti lista={lista} scelto={scelto} onScegli={setScelto} />
        </Riquadro>
        <Riquadro titolo="Dettaglio disco">
          <DettaglioDisco a={lista.find((x) => x.numero === scelto)} />
        </Riquadro>
      </div>

      <Riquadro titolo={`Dischi (${r.presenti})`}>
        <div className="-m-4 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b-2 bg-muted/40">
              <tr>{["Slot", "Modello", "Capacità", "Stato", "Temperatura", "Seriale"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-muted-foreground">{h}</th>)}</tr>
            </thead>
            <tbody>
              {lista.filter((x) => x.disco).map((x) => (
                <tr key={x.numero} className="cursor-pointer border-b hover:bg-muted/30" onClick={() => setScelto(x.numero)}>
                  <td className="px-3 py-1.5 font-mono font-semibold">{x.numero}</td>
                  <td className="px-3 py-1.5">{x.disco?.model || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{x.disco?.capacity_gb != null ? formattaGb(x.disco.capacity_gb) : "—"}</td>
                  <td className="px-3 py-1.5">{x.stato.stato === "attenzione" ? <StatoNas ok={false} testo={x.stato.motivi.join(" · ")} /> : <StatoNas ok testo="buono" />}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{x.disco?.temperature_c != null ? `${x.disco.temperature_c} °C` : "—"}</td>
                  <td className="px-3 py-1.5 font-mono">{x.disco?.serial || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Riquadro>

      <Riquadro titolo={`Gruppi RAID (${gruppi.length})`} vuoto={gruppi.length === 0}>
        <ul className="space-y-2">
          {gruppi.map((g) => (
            <li key={g.nome} className="grid grid-cols-[minmax(0,10rem)_8rem_1fr] items-center gap-3 text-[13px]">
              <span className="truncate font-semibold" title={g.nome}>{g.nome}</span>
              {g.stato ? <StatoNas ok={g.stato.ok} testo={g.stato.testo} /> : <span />}
              {g.percento != null && g.totaleGb != null && g.usatoGb != null
                ? <BarraUso percento={g.percento} etichetta={`${formattaGb(g.usatoGb)} / ${formattaGb(g.totaleGb)}`} />
                : <span className="text-muted-foreground">{g.totaleGb != null ? formattaGb(g.totaleGb) : ""}</span>}
            </li>
          ))}
        </ul>
      </Riquadro>
    </div>
  );
}

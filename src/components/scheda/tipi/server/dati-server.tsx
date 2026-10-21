"use client";

/**
 * Pezzi comuni alle tab dei server Windows e Linux: il `device_info` della scansione, lo stato di un servizio
 * (segno + parola, a tinta piena solo se è un guasto), l'elenco dei dischi con barra, i rilievi AD e le sessioni.
 * Ogni elenco serve sia alla Panoramica (poche righe) sia alla sua tab (tutto).
 */
import Link from "next/link";
import { BarraUso } from "../../barra-uso";
import { parseUtcDate } from "../../blocchi";
import type { DeviceInfoJson } from "../../dati";
import type { ContestoScheda } from "../../contesto";
import {
  esitoServizio, eAutomatico, gravitaAd, ordinaRilievi, testoGb,
  type DiscoSrv, type RilievoAd, type ServizioSrv,
} from "@/lib/scheda/server";
import { cn } from "@/lib/utils";

export const lnk = "text-[13px] font-semibold text-[#006C96] underline-offset-2 hover:underline dark:text-[#7FD3F5]";
export const th = "border-b-2 bg-muted/60 px-2 py-1.5 text-left text-[13px] font-semibold text-muted-foreground";
export const td = "border-b px-2 py-1.5 align-middle text-[13px]";

export const infoDi = (ctx: ContestoScheda): DeviceInfoJson | null => ctx.device?.device_info ?? null;

export const dataBreve = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  try { return parseUtcDate(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }); } catch { return iso; }
};
export const dataOra = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  try { return parseUtcDate(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
};

/** Esito di un servizio: segno + parola. Un guasto è in rosso scuro grassetto (si legge anche per luminanza e per segno). */
export function EsitoServizioTesto({ s }: { s: ServizioSrv }) {
  const e = esitoServizio(s);
  return (
    <span className={cn("whitespace-nowrap", e.livello === "guasto" && "font-semibold text-[#8E1B20] dark:text-[#E8625A]", e.livello === "attenzione" && "font-semibold", e.livello === "neutro" && "text-muted-foreground")}>
      <span aria-hidden>{e.segno} </span>{e.testo}
    </span>
  );
}

/** Righe nome · descrizione · esito · avvio. `senzaAvvio` per i riquadri stretti della Panoramica. */
export function ElencoServizi({ servizi, max, senzaAvvio }: { servizi: ServizioSrv[]; max?: number; senzaAvvio?: boolean }) {
  const mostrati = servizi.slice(0, max ?? servizi.length);
  return (
    <ul className="space-y-1.5 text-[13px]">
      {mostrati.map((s, i) => (
        <li key={`${s.name}-${i}`} className="flex items-baseline gap-3">
          <span className="min-w-[7rem] font-mono font-semibold">{s.name ?? "?"}</span>
          {s.display_name && s.display_name !== s.name && <span className="min-w-0 flex-1 truncate text-muted-foreground" title={s.display_name}>{s.display_name}</span>}
          <span className="ml-auto flex shrink-0 items-baseline gap-3">
            <EsitoServizioTesto s={s} />
            {!senzaAvvio && eAutomatico(s) && <span className="text-muted-foreground">automatico</span>}
          </span>
        </li>
      ))}
      {servizi.length > mostrati.length && <li className="text-muted-foreground">… altri {servizi.length - mostrati.length}</li>}
    </ul>
  );
}

/** Un disco per riga: nome, barra di utilizzo e spazio. */
export function ElencoDischi({ dischi, max }: { dischi: DiscoSrv[]; max?: number }) {
  const mostrati = dischi.slice(0, max ?? dischi.length);
  return (
    <ul className="space-y-1.5">
      {mostrati.map((d, i) => (
        <li key={`${d.nome}-${i}`} className="grid grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-[13px]">
          <span className="min-w-0 truncate font-mono font-semibold" title={d.etichetta ? `${d.nome} · ${d.etichetta}` : d.nome}>
            {d.nome}{d.etichetta && <span className="font-sans font-normal text-muted-foreground"> {d.etichetta}</span>}
          </span>
          {d.usatoPct != null ? <BarraUso percento={d.usatoPct} etichetta={`${d.piccolo ? "~" : ""}${d.usatoPct}%`} soglia={d.piccolo ? 101 : 85} /> : <span className="text-muted-foreground">uso non letto</span>}
          <span className="whitespace-nowrap text-muted-foreground">
            {d.totaleGb != null && d.liberoGb != null ? `${testoGb(d.totaleGb - d.liberoGb)} / ${testoGb(d.totaleGb)}` : d.totaleGb != null ? testoGb(d.totaleGb) : ""}
            {d.rete && " · rete"}
          </span>
        </li>
      ))}
      {dischi.length > mostrati.length && <li className="text-[13px] text-muted-foreground">… altri {dischi.length - mostrati.length}</li>}
    </ul>
  );
}

/** Rilievi AD con segno + parola della gravità, i più gravi per primi. */
export function ElencoRilievi({ rilievi, max }: { rilievi: RilievoAd[]; max?: number }) {
  const ordinati = ordinaRilievi(rilievi);
  const mostrati = ordinati.slice(0, max ?? ordinati.length);
  return (
    <ul className="space-y-1.5 text-[13px]">
      {mostrati.map((r, i) => {
        const g = gravitaAd(r.gravita);
        return (
          <li key={`${r.titolo}-${i}`} className="flex items-baseline gap-3">
            <span className={cn("w-[4.5rem] shrink-0 whitespace-nowrap", g.peso <= 1 && "font-semibold text-[#8E1B20] dark:text-[#E8625A]", g.peso === 2 && "font-semibold")}>
              <span aria-hidden>{g.segno} </span>{g.testo}
            </span>
            <span className="min-w-0">{r.titolo}</span>
          </li>
        );
      })}
      {ordinati.length > mostrati.length && <li className="text-muted-foreground">… altri {ordinati.length - mostrati.length}</li>}
    </ul>
  );
}

export const LinkPatch = ({ hostId }: { hostId: number }) => (
  <Link href={`/patch-management/device/${hostId}`} className={lnk}>apri in Patch management ›</Link>
);

export const Nessun = ({ children }: { children: string }) => <p className="text-sm text-muted-foreground">{children}</p>;

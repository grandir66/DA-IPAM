"use client";

/** Pezzi della scheda per i dati di LibreNMS: stato dei sensori e fonte di una riga. Segno e parola sempre, il colore in più (Riccardo è daltonico). */
import { cn } from "@/lib/utils";
import { parseDbDate } from "@/lib/db-date";
import type { FonteVicino, StatoSensore } from "@/lib/scheda/librenms-vista";

/** Ore in ora italiana: «10:15» oggi, «22/10 10:15» altrimenti. */
export function oraBreve(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseDbDate(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export const soloOra = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = parseDbDate(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" });
};

const PASTIGLIA: Record<StatoSensore, { segno: string; testo: string; classe: string }> = {
  ok: { segno: "✓", testo: "nei limiti", classe: "bg-[#1F7A4D] text-white dark:bg-[#5ED3A0] dark:text-[#0D2537]" },
  vicino: { segno: "▲", testo: "vicino al limite", classe: "bg-[repeating-linear-gradient(135deg,#E69F00_0_6px,#F3C25A_6px_10px)] text-[#0D2537]" },
  oltre: { segno: "✕", testo: "oltre il limite", classe: "bg-[#0D2537] text-white outline outline-2 -outline-offset-2 outline-[#E69F00] dark:bg-[#E6EEF4] dark:text-[#0D2537]" },
  nd: { segno: "–", testo: "senza limiti", classe: "bg-[#D0D8DC] text-[#0D2537] dark:bg-[#4A6070] dark:text-white" },
};

export function PastigliaStato({ stato }: { stato: StatoSensore }) {
  const p = PASTIGLIA[stato];
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-px text-[13px] font-semibold", p.classe)}><span aria-hidden>{p.segno}</span>{p.testo}</span>;
}

/** Chi ha dato la riga: bordo sottile (DA-IPAM), azzurro (LibreNMS), doppio (le due fonti). */
export function EtichettaFonte({ fonte, ora }: { fonte: FonteVicino; ora?: string | null }) {
  const testo = fonte === "ipam" ? "DA-IPAM" : fonte === "librenms" ? "LibreNMS" : "DA-IPAM e LibreNMS";
  return (
    <span className={cn("inline-block whitespace-nowrap rounded border px-1.5 text-[13px]", fonte === "librenms" && "border-[#00A7E7]", fonte === "entrambe" && "border-[3px] border-double")}>
      {testo}{ora ? ` ${soloOra(ora)}` : ""}
    </span>
  );
}

/**
 * Pezzi comuni delle pagine degli assegnatari (piano 2026-10-23-assegnatari-da-ad, tavola): badge a tinta piena con
 * segno e parola (✓ ▲ ✕ ●, Riccardo è daltonico: luminanza e forma), date del DB in ora italiana dette a parole.
 */
import type { ReactNode } from "react";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";

export type TipoSegno = "ok" | "attenzione" | "errore" | "neutro";

const STILE: Record<TipoSegno, string> = {
  ok: "bg-[#1F7A4D] text-white dark:bg-[#5ED3A0] dark:text-[#0D2537]",
  attenzione: "bg-[#FFD400] text-[#0D2537] border border-[#8A6D00]",
  errore: "bg-[#8E1B20] text-white dark:bg-[#E8625A] dark:text-[#0D2537]",
  neutro: "bg-[#5B6B77] text-white dark:bg-[#A9BECC] dark:text-[#0D2537]",
};
const SEGNO: Record<TipoSegno, string> = { ok: "✓", attenzione: "▲", errore: "✕", neutro: "●" };

export function BadgeSegno({ tipo, children, title }: { tipo: TipoSegno; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-[13px] font-medium ${STILE[tipo]}`}>
      <span aria-hidden="true">{SEGNO[tipo]}</span>
      {children}
    </span>
  );
}

/** Una fonte degli accessi («Wazuh 14»), grigia piena. */
export function BadgeFonte({ children }: { children: ReactNode }) {
  return <span className="mr-1 inline-block rounded-md bg-[#5B6B77] px-1.5 py-px text-[13px] text-white dark:bg-[#A9BECC] dark:text-[#0D2537]">{children}</span>;
}

const giorno = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: FUSO_UTENTI });
const ora = (d: Date) => d.toLocaleTimeString("it-IT", { timeZone: FUSO_UTENTI, hour: "2-digit", minute: "2-digit" });

/** «oggi 17:52», «ieri 17:52», «08/10 09:14» (con l'ora) o «oggi», «ieri», «12 giorni fa» (senza). */
export function quando(valore: string | null | undefined, conOra = true, adesso = new Date()): string {
  if (!valore) return "—";
  const d = parseDbDate(valore);
  if (Number.isNaN(d.getTime())) return "—";
  const oggi = giorno(adesso);
  const ieri = giorno(new Date(adesso.getTime() - 86_400_000));
  const g = giorno(d);
  if (conOra) {
    if (g === oggi) return `oggi ${ora(d)}`;
    if (g === ieri) return `ieri ${ora(d)}`;
    return `${d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit" })} ${ora(d)}`;
  }
  if (g === oggi) return "oggi";
  if (g === ieri) return "ieri";
  const giorni = Math.round((Date.parse(oggi) - Date.parse(g)) / 86_400_000);
  return giorni < 60 ? `${giorni} giorni fa` : d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI });
}

/** «02/10» per le date di disattivazione. */
export function giornoBreve(valore: string | null | undefined): string {
  if (!valore) return "";
  const d = parseDbDate(valore);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit" });
}

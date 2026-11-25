/**
 * I pezzi comuni alle schede di «Protezione» (tappa 1, sola lettura; tavola del 25/11/2026). Niente stato:
 * si usano dalle pagine lette sul server.
 */
import type { ReactNode } from "react";
import { BarraStato, Legenda, Vuoto } from "@/components/shared/console";
import { cn } from "@/lib/utils";
import type { QuadroProtezione } from "@/lib/protezione/raccolta";

const TONI = {
  /** Fondo pieno scuro: stato forte (aperta a tutti, bloccato, acceso). */
  pieno: "border-foreground bg-foreground text-background",
  /** Giallo pieno con testo navy: attenzione. */
  avviso: "border-[#C9A800] bg-[#FFD400] text-[#0D2537]",
  /** Solo bordo: chiuso, spento, a posto. */
  vuoto: "border-foreground/50 bg-card text-foreground",
} as const;

/** Stato = segno + fondo, mai la sola tinta (Riccardo è daltonico). */
export function Segno({ tono, segno, children }: { tono: keyof typeof TONI; segno: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border-2 px-2 py-0.5 text-[13px] leading-tight font-semibold whitespace-nowrap", TONI[tono])}>
      <span aria-hidden>{segno}</span>
      {children}
    </span>
  );
}

export const LEGENDA_SEGNI = (
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
    <span>● aperta a tutti</span>
    <span>◐ solo NetBird</span>
    <span>○ solo la macchina / a posto</span>
    <span>▲ da guardare</span>
    <span>? non letto</span>
  </div>
);
export { Legenda };

/** La striscia uguale in ogni scheda: com'è il filtro, quando si è letto. */
export function BarraProtezione({ quadro }: { quadro: QuadroProtezione }) {
  const stato = quadro.filtro === null ? "non letto" : quadro.filtro === "acceso" ? "acceso" : quadro.filtro === "osserva" ? "osserva" : "non c'è ancora";
  const aperte = quadro.porte?.filter((p) => p.raggiunge === "tutti").length;
  return (
    <BarraStato
      acceso={quadro.filtro === "acceso"}
      titolo="Filtro degli accessi"
      stato={stato}
      dettagli={[
        quadro.filtro === "acceso" ? "installazione protetta" : "installazione NON protetta",
        aperte == null ? "porte: non lette" : `${aperte} porte aperte a tutti`,
        `letto alle ${new Date(quadro.lettoAlle).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}`,
      ]}
    />
  );
}

/** Una fonte che su questa macchina non si è potuta leggere: si dice quale e perché, non una tabella vuota. */
export function NonLetto({ cosa, comando }: { cosa: string; comando: string }) {
  return <Vuoto titolo={`${cosa}: non letto`} testo={`Su questa macchina «${comando}» non ha risposto. Sulle appliance DA-IPAM lo legge da sé; su un computer di sviluppo è normale.`} />;
}

export function SoloAdmin() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Protezione</h1>
      <p className="text-sm text-muted-foreground">Pagina riservata agli amministratori di questa istanza.</p>
    </div>
  );
}

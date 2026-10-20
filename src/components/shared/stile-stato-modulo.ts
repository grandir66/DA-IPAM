/**
 * Colori degli stati dei moduli, un posto solo (elenco di Impostazioni → Moduli, riquadri e
 * riga Sicurezza della dashboard). Valori dei token di DA-Template, come il design system
 * Domarc (`~/.claude/rules/design-system.md`, «Badge di stato»): tinta piena, segno e
 * luminanza diversi — Riccardo è daltonico, lo stato si legge anche senza i colori.
 * 20/10: «il verde deve essere un verde e dire che funziona» (prima green-800, più scuro).
 */
export type ToniStato = "ok" | "attenzione" | "guasto" | "da_verificare" | "grigio";

export const STILE_STATO: Record<ToniStato, { segno: string; classi: string }> = {
  ok: { segno: "✓", classi: "bg-[#1F7A4D] text-white border-[#1F7A4D] dark:bg-[#5ED3A0] dark:text-[#0D2537] dark:border-[#5ED3A0]" },
  attenzione: { segno: "▲", classi: "bg-[#FFD400] text-[#0D2537] border-[#C9A800]" },
  guasto: { segno: "✕", classi: "bg-[#8E1B20] text-white border-[#8E1B20] dark:bg-[#E8625A] dark:text-[#0D2537] dark:border-[#E8625A]" },
  da_verificare: { segno: "●", classi: "bg-[#5B6B77] text-white border-[#5B6B77] dark:bg-[#A9BECC] dark:text-[#0D2537] dark:border-[#A9BECC]" },
  grigio: { segno: "–", classi: "bg-muted/60 text-muted-foreground border-dashed border-slate-400" },
};

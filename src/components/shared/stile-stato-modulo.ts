/**
 * Colori degli stati dei moduli, un posto solo (elenco di Impostazioni → Moduli e
 * riquadri della dashboard, 20/10). Fondo e bordo diversi per luminanza e un simbolo:
 * Riccardo è daltonico, lo stato si legge anche senza i colori.
 */
export type ToniStato = "ok" | "attenzione" | "guasto" | "da_verificare" | "grigio";

export const STILE_STATO: Record<ToniStato, { segno: string; classi: string }> = {
  ok: { segno: "✓", classi: "bg-green-800 text-white border-green-950" },
  attenzione: { segno: "!", classi: "bg-amber-100 text-amber-950 border-amber-600" },
  guasto: { segno: "✕", classi: "bg-red-700 text-white border-red-900" },
  da_verificare: { segno: "?", classi: "bg-white text-slate-800 border-slate-500 dark:bg-slate-900 dark:text-slate-100" },
  grigio: { segno: "–", classi: "bg-muted/60 text-muted-foreground border-dashed border-slate-400" },
};

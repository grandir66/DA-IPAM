"use client";

/**
 * Pannello frontale (artboard Switch ①): porte numerate su due file (dispari sopra), SFP a parte, legenda sotto.
 * Su = scuro pieno; giù = bianco col bordo grigio; trunk = scuro col bordo spesso ciano; errori = rosso scuro con ✕;
 * PoE = pallino giallo bordato. Si distinguono per luminanza e forma, non per tinta. Clic = porta selezionata.
 */
import { cn } from "@/lib/utils";
import type { SwitchPort } from "@/types";
import { eSfp, ePortaFisica, numeroPorta } from "@/lib/scheda/porte-da-guardare";

function classiPorta(p: SwitchPort): string {
  if ((p.status === "up") && (p as { errori?: number | null }).errori) return "bg-[#8E1B20] text-white border-2 border-[#5E1014]";
  if (p.status === "up" && p.is_trunk) return "bg-[#0D2537] text-white border-[3px] border-[#00A7E7] dark:bg-slate-200 dark:text-[#0D2537]";
  if (p.status === "up") return "bg-[#0D2537] text-white border-2 border-[#0D2537] dark:border-slate-200 dark:bg-slate-200 dark:text-[#0D2537]";
  return "bg-white text-[#6B7C88] border-2 border-[#C5CED4] dark:bg-transparent dark:border-slate-600 dark:text-slate-400";
}

function Tasto({ p, scelta, onScegli }: { p: SwitchPort; scelta: boolean; onScegli: (id: number) => void }) {
  const errori = p.status === "up" && !!(p as { errori?: number | null }).errori;
  return (
    <button
      type="button"
      onClick={() => onScegli(p.id)}
      aria-pressed={scelta}
      aria-label={`Porta ${numeroPorta(p)}${p.status === "up" ? " su" : " giù"}${p.is_trunk ? ", trunk" : ""}${p.poe_status === "delivering" ? ", PoE attivo" : ""}`}
      className={cn("relative flex h-[30px] w-[30px] items-center justify-center rounded text-[13px] font-bold", classiPorta(p), scelta && "outline outline-[3px] outline-offset-2 outline-[#FFD400]")}
    >
      {errori ? "✕" : numeroPorta(p)}
      {p.poe_status === "delivering" && <span aria-hidden className="absolute -right-[5px] -top-[5px] h-3 w-3 rounded-full border-2 border-[#0D2537] bg-[#FFD400]" />}
    </button>
  );
}

export function PannelloFrontale({ porte, scelta, onScegli }: { porte: SwitchPort[]; scelta: number | null; onScegli: (id: number) => void }) {
  const fisiche = porte.filter(ePortaFisica);
  const sfp = fisiche.filter(eSfp);
  const rame = fisiche.filter((p) => !eSfp(p));
  // Dispari sopra, pari sotto, come sui pannelli veri.
  const sopra = rame.filter((p) => numeroPorta(p) % 2 === 1);
  const sotto = rame.filter((p) => numeroPorta(p) % 2 === 0);
  const riga = (l: SwitchPort[]) => (
    <div className="flex gap-1">{l.map((p) => <Tasto key={p.id} p={p} scelta={scelta === p.id} onScegli={onScegli} />)}</div>
  );
  if (fisiche.length === 0) return null;
  return (
    <div>
      <div className="overflow-x-auto pb-1 pt-2">
        <div className="flex items-start gap-5">
          <div className="flex flex-col gap-2">{riga(sopra)}{riga(sotto)}</div>
          {sfp.length > 0 && (
            <div className="flex flex-col gap-2 border-l-2 pl-4">
              <div className="flex gap-1">{sfp.map((p) => <Tasto key={p.id} p={p} scelta={scelta === p.id} onScegli={onScegli} />)}</div>
              <span className="text-[13px] text-muted-foreground">SFP</span>
            </div>
          )}
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-4 w-5 rounded-sm border-2 border-[#0D2537] bg-[#0D2537] dark:border-slate-200 dark:bg-slate-200" />su</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-4 w-5 rounded-sm border-2 border-[#C5CED4] bg-white dark:bg-transparent" />giù</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-4 w-5 rounded-sm border-[3px] border-[#00A7E7] bg-[#0D2537] dark:bg-slate-200" />trunk / uplink (bordo spesso)</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-flex h-4 w-5 items-center justify-center rounded-sm border-2 border-[#5E1014] bg-[#8E1B20] text-[10px] text-white">✕</span>errori</li>
        <li className="flex items-center gap-1.5"><span aria-hidden className="inline-block h-3 w-3 rounded-full border-2 border-[#0D2537] bg-[#FFD400]" />PoE attivo</li>
      </ul>
    </div>
  );
}

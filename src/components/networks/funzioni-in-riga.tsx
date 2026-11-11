"use client";

/**
 * Le funzioni di un apparato in una riga, con il comando per metterle e toglierle a mano (11/11/2026, passo 4).
 * Un clic su «Funzioni» apre l'elenco a gruppi con la ricerca: la spunta dice che la funzione c'è. Se la riga è
 * fra quelle spuntate nella lista, la scelta vale per tutte le spuntate (lo dice l'avviso in cima).
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { gruppiFunzioni } from "@/lib/classification/funzioni";
import { PilloleFunzioni, type FunzioneInRiga } from "@/components/networks/funzioni-host";

function piatto(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function FunzioniInRiga({
  funzioni,
  quantiHost,
  onCambia,
}: {
  funzioni: readonly FunzioneInRiga[] | undefined;
  /** Su quanti host vale la scelta: 1, oppure il numero delle righe spuntate se questa è fra quelle. */
  quantiHost: number;
  onCambia: (funzione: string, azione: "metti" | "togli" | "automatica") => void | Promise<void>;
}) {
  const [aperto, setAperto] = useState(false);
  const [cerca, setCerca] = useState("");
  const [gruppoAperto, setGruppoAperto] = useState<string | null>(null);
  const attive = useMemo(() => new Map((funzioni ?? []).map((f) => [f.funzione, f])), [funzioni]);
  const q = piatto(cerca);
  const gruppi = useMemo(
    () => gruppiFunzioni()
      .map((g) => ({ ...g, voci: g.voci.filter((v) => !q || piatto(v.etichetta).includes(q) || piatto(g.titolo).includes(q)) }))
      .filter((g) => g.voci.length > 0),
    [q],
  );
  const riga = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent hover:text-accent-foreground";

  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-1">
      <PilloleFunzioni funzioni={funzioni} />
      <Popover open={aperto} onOpenChange={setAperto}>
        <PopoverTrigger
          render={
            <button
              type="button"
              title="Metti o togli le funzioni di questo apparato"
              className="inline-flex items-center gap-0.5 rounded border border-dashed px-1 text-[13px] leading-5 text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            />
          }
        >
          <Plus className="size-3.5" aria-hidden />
          Funzioni
        </PopoverTrigger>
        <PopoverContent onClick={(e) => e.stopPropagation()}>
          {quantiHost > 1 && (
            <p className="mb-1 shrink-0 rounded-md border border-[#C9A800] bg-[#FFD400] px-2 py-1 text-[13px] font-medium text-[#0D2537]">
              Vale per i {quantiHost} host spuntati
            </p>
          )}
          <div className="flex min-h-0 w-72 flex-1 flex-col gap-1">
            <Input
              autoFocus
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
              placeholder="Cerca: dns, backup, web"
              aria-label="Cerca una funzione"
              className="h-8 shrink-0 text-[13px]"
            />
            <div className="max-h-72 min-h-24 flex-1 overflow-y-auto">
              {gruppi.length === 0 && <p className="px-2 py-2 text-[13px] text-muted-foreground">Nessuna funzione con questo nome</p>}
              {gruppi.map((g) => {
                const haAttive = g.voci.some((v) => attive.has(v.slug));
                const mostra = q !== "" || gruppoAperto === g.gruppo || (gruppoAperto === null && haAttive);
                return (
                  <div key={g.gruppo}>
                    <button type="button" className={`${riga} font-medium`} aria-expanded={mostra} onClick={() => setGruppoAperto(gruppoAperto === g.gruppo ? "" : g.gruppo)}>
                      {mostra ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                      <span className="min-w-0 flex-1 truncate">{g.titolo}</span>
                      <span className="shrink-0 font-mono text-muted-foreground">{g.voci.length}</span>
                    </button>
                    {mostra && g.voci.map((v) => {
                      const attiva = attive.get(v.slug);
                      return (
                        <span key={v.slug} className="flex items-center">
                          <button
                            type="button"
                            className={`${riga} pl-8`}
                            aria-pressed={!!attiva}
                            title={attiva ? (attiva.a_mano ? "messa a mano: un clic la toglie" : `${attiva.origine}: un clic la toglie`) : "un clic la mette"}
                            onClick={() => void onCambia(v.slug, attiva ? "togli" : "metti")}
                          >
                            <span className="flex size-4 shrink-0 items-center justify-center rounded border">
                              {attiva && <Check className="size-3.5" aria-hidden />}
                            </span>
                            <span className="min-w-0 flex-1 truncate">{v.etichetta}</span>
                            {attiva?.a_mano && <span className="shrink-0 text-muted-foreground">a mano</span>}
                          </button>
                          <button
                            type="button"
                            title="Torna automatica: decide di nuovo il sistema"
                            aria-label={`Torna automatica: ${v.etichetta}`}
                            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            onClick={() => void onCambia(v.slug, "automatica")}
                          >
                            <RotateCcw className="size-3.5" aria-hidden />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </span>
  );
}

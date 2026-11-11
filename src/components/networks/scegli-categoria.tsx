"use client";

/**
 * La scelta della categoria: ricerca, proposta del sistema da confermare, voci a gruppi, «Torna automatica».
 * Si usa sulla riga della subnet (dentro un popover) e nella finestra per più righe. Regole in
 * `lib/classification/scelta-categoria.ts`.
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getClassificationLabel } from "@/lib/device-classifications";
import { gruppiScelta, type VoceScelta } from "@/lib/classification/scelta-categoria";

export function ScegliCategoria({
  attuale,
  proposta,
  onScegli,
  onAutomatica,
  extra,
}: {
  /** Categorie aggiunte dal cliente, fuori dal catalogo: un gruppo in fondo. */
  extra?: readonly VoceScelta[];
  /** La classe di adesso, per segnarla nell'elenco. */
  attuale?: string | null;
  /** La classe proposta dal sistema e non ancora scelta a mano: in cima, da confermare con un clic. */
  proposta?: string | null;
  onScegli: (slug: string) => void;
  /** Se c'è, in fondo compare «Torna automatica». */
  onAutomatica?: () => void;
}) {
  const [cerca, setCerca] = useState("");
  const [aperto, setAperto] = useState<string | null>(null);
  const gruppi = useMemo(() => gruppiScelta(cerca, extra), [cerca, extra]);
  const etichetta = (slug: string) => extra?.find((v) => v.slug === slug)?.etichetta ?? getClassificationLabel(slug);
  const cercando = cerca.trim() !== "";
  const riga = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent hover:text-accent-foreground";

  return (
    <div className="flex w-72 flex-col gap-1">
      <Input
        autoFocus
        value={cerca}
        onChange={(e) => setCerca(e.target.value)}
        placeholder="Cerca: stampante, nas, telefono"
        aria-label="Cerca una categoria"
        className="h-8 text-[13px]"
      />
      {proposta && !cercando && (
        <>
          <p className="px-2 pt-1 text-[13px] text-muted-foreground">Proposta dal sistema</p>
          <button type="button" className={`${riga} border`} onClick={() => onScegli(proposta)}>
            <Check className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium">{etichetta(proposta)}</span>
            <span className="shrink-0 text-muted-foreground">conferma</span>
          </button>
        </>
      )}
      <div className="max-h-72 overflow-y-auto">
        {gruppi.length === 0 && <p className="px-2 py-2 text-[13px] text-muted-foreground">Nessuna categoria con questo nome</p>}
        {gruppi.map((g) => {
          const mostra = cercando || aperto === g.gruppo;
          return (
            <div key={g.gruppo}>
              <button
                type="button"
                className={`${riga} font-medium`}
                aria-expanded={mostra}
                title={g.cosa}
                onClick={() => setAperto(aperto === g.gruppo ? null : g.gruppo)}
              >
                {mostra ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{g.titolo}</span>
                <span className="shrink-0 font-mono text-muted-foreground">{g.voci.length}</span>
              </button>
              {mostra && g.voci.map((v) => (
                <button key={v.slug} type="button" className={`${riga} pl-8`} onClick={() => onScegli(v.slug)}>
                  <span className="min-w-0 flex-1 truncate">{v.etichetta}</span>
                  {attuale === v.slug && <Check className="size-4 shrink-0" aria-label="categoria di adesso" />}
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {onAutomatica && (
        <button type="button" className={`${riga} border-t pt-2 text-muted-foreground`} onClick={onAutomatica}>
          <RotateCcw className="size-4 shrink-0" aria-hidden />
          Torna automatica
        </button>
      )}
    </div>
  );
}

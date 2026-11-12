"use client";

/**
 * La barra dei filtri comune (Riccardo, 13/11/2026: «un sistema di kpi comune e di filtri simile»). Nata il 12/11
 * nella subnet e in Apparati, qui diventa un mattone: ricerca (se serve), «Filtri · N» che apre il pannello a
 * destra, i filtri accesi come etichette che si tolgono, il conteggio «N di M» e, in fondo a destra, quello che la
 * pagina vuole mettere (cambio di vista, colonne, esporta). I comandi dei filtri stanno nei `children` del pannello.
 */
import type { ReactNode } from "react";
import { Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export interface FiltroAcceso { chiave: string; testo: string; togli: () => void }

export function BarraFiltri({
  cerca,
  onCerca,
  segnaposto = "Cerca…",
  accesi,
  onApri,
  onTogliTutti,
  conteggio,
  destra,
}: {
  /** Testo della ricerca; senza `onCerca` la casella non c'è. */
  cerca?: string;
  onCerca?: (v: string) => void;
  segnaposto?: string;
  accesi: FiltroAcceso[];
  onApri: () => void;
  onTogliTutti?: () => void;
  /** «252 di 1.925», già scritto. */
  conteggio?: string;
  destra?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {onCerca && (
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={cerca ?? ""} onChange={(e) => onCerca(e.target.value)} placeholder={segnaposto} className="h-8 w-48 pl-8" />
        </div>
      )}
      <Button variant="outline" size="sm" className="shrink-0" onClick={onApri}>
        <Filter className="mr-1 h-4 w-4" />
        Filtri{accesi.length > 0 ? ` · ${accesi.length}` : ""}
      </Button>
      <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        {accesi.map((f) => (
          <button
            key={f.chiave}
            type="button"
            onClick={f.togli}
            title="Togli questo filtro"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-primary/60 bg-primary/10 px-2 text-[13px] hover:bg-primary/20"
          >
            {f.testo}
            <X className="h-3 w-3" />
          </button>
        ))}
        {onTogliTutti && accesi.length > 1 && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onTogliTutti}>Togli tutti</Button>
        )}
      </div>
      {conteggio && <span className="ml-auto shrink-0 text-[13px] tabular-nums text-muted-foreground">{conteggio}</span>}
      {destra && <div className={conteggio ? "flex shrink-0 items-center gap-2" : "ml-auto flex shrink-0 items-center gap-2"}>{destra}</div>}
    </div>
  );
}

/** Il pannello a destra coi comandi dei filtri. In fondo «Togli tutti» e il pulsante che chiude dicendo quante righe restano. */
export function PannelloFiltri({
  aperto,
  onAperto,
  onTogliTutti,
  nessunFiltro,
  chiudi,
  children,
}: {
  aperto: boolean;
  onAperto: (v: boolean) => void;
  onTogliTutti?: () => void;
  nessunFiltro?: boolean;
  /** Testo del pulsante che chiude: «Mostra 252 righe». */
  chiudi: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={aperto} onOpenChange={onAperto}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-sm" showCloseButton>
        <SheetHeader>
          <SheetTitle>Filtri</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          {children}
          <div className="flex justify-between gap-2 pt-2">
            {onTogliTutti ? <Button variant="ghost" size="sm" onClick={onTogliTutti} disabled={nessunFiltro}>Togli tutti</Button> : <span />}
            <Button size="sm" onClick={() => onAperto(false)}>{chiudi}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Una voce del pannello: etichetta sopra, comando sotto. */
export function VoceFiltro({ etichetta, children }: { etichetta: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[13px] text-muted-foreground">
      {etichetta}
      {children}
    </label>
  );
}

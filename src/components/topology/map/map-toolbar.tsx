"use client";

/**
 * La barra sopra la mappa: «Tutto automatico» / «Passo passo» (il segmento
 * attivo ha il fondo pieno E il «●»: doppio segnale), la scelta della mappa o
 * la testa, e a destra «Verticale | Orizzontale» (spec §12.2: lo cambia un admin, vale per tutti),
 * «Mostra ridondanze» (spec §12.5: per chi guarda), zoom, «Adatta» (in verticale adatta la
 * larghezza e porta in cima), «Riordina», «Stampa» (scheda nuova, spec §12.3) e
 * «◂ Dettagli» / «Dettagli ▸» (apre e chiude la barra di destra); a sinistra, per primo,
 * «◂ Elenco» / «Elenco ▸» (apre e chiude l'elenco degli oggetti, spec §13.10.2).
 * Le scritture (mappe, testa, orientamento, riordina) si vedono solo agli admin.
 */
import { useState } from "react";
import { useReactFlow, useStoreApi } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { oraItaliana } from "@/lib/topology/load-state";
import { fitWidthViewport, pulsanteElenco } from "@/lib/topology/map-screen";
import type { MapOrientation } from "@/lib/topology/model-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MapRow } from "./use-topology-data";

export type Mode = "auto" | "passo";

interface Props {
  mode: Mode;
  onMode: (m: Mode) => void;
  isAdmin: boolean;
  maps: MapRow[];
  mapId: number | null;
  onMap: (id: number) => void;
  /** Le scritture rispondono true se sono andate: solo allora il dialogo si chiude. */
  onCreate: (name: string) => Promise<boolean>;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
  headName: string | null;
  /** «proposta dal sistema» o «scelta da <autore>». */
  headOrigin: string;
  onCreateFromAuto: (name: string) => Promise<boolean>;
  showExtra: boolean;
  onShowExtra: (v: boolean) => void;
  /** L'orientamento della mappa a schermo; null finché la vista non è caricata. */
  orientation: MapOrientation | null;
  /** Solo admin, a vista caricata: cambia l'orientamento salvato della mappa. */
  onOrientation: ((o: MapOrientation) => void) | null;
  /** Larghezza della disposizione (per «Adatta» in verticale). */
  layoutWidth: number | null;
  /** La pagina di stampa della mappa che si guarda; null se non c'è una mappa. */
  printHref: string | null;
  canRiordina: boolean;
  onRiordina: () => void;
  /** L'ultimo aggiornamento automatico non è riuscito (ms): la mappa è quella di prima. */
  refreshFailedAt: number | null;
  refreshMessage: string | null;
  onRetry: () => void;
  /** L'elenco degli oggetti a sinistra è aperto (spec §13.10.2, scelta ricordata). */
  listOpen: boolean;
  onToggleList: () => void;
  /** La barra dei dettagli è aperta (scelta ricordata). */
  detailsOpen: boolean;
  /** C'è qualcosa da mostrare (un oggetto scelto, oggetti spariti): solo allora il pulsante c'è. */
  detailsAvailable: boolean;
  onToggleDetails: () => void;
  /** La mappa nuova è accesa ma non si è potuta calcolare: la rotta ha dato quella di prima e il messaggio (T3, caso 3 del piano). */
  mappaErrore?: string | null;
}

type Asked = null | "new" | "rename" | "fromAuto" | "delete";

const ORIENTAMENTI: Array<{ o: MapOrientation; label: string }> = [{ o: "lr", label: "Verticale" }, { o: "tb", label: "Orizzontale" }];

export function MapToolbar(p: Props) {
  const rf = useReactFlow();
  const store = useStoreApi();
  /** In verticale la larghezza nel riquadro della mappa, poi in cima; in orizzontale tutta la mappa, come prima. */
  const adatta = () => {
    if (p.orientation === "lr" && p.layoutWidth) void rf.setViewport(fitWidthViewport(p.layoutWidth, store.getState().width));
    else void rf.fitView({ padding: 0.05 });
  };
  const lockedWhy = p.onOrientation ? undefined : "Lo sceglie un amministratore: vale per tutti quelli che guardano questa mappa";
  const [asked, setAsked] = useState<Asked>(null);
  const current = p.maps.find((m) => m.id === p.mapId) ?? null;
  const elenco = pulsanteElenco(p.listOpen, p.mode === "passo");

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-2.5 py-1.5 text-[13px]">
      {/* L'elenco sta a sinistra e il suo pulsante anche: primo della barra, stesso stile di «Dettagli» (spec §13.10.2). */}
      <Button size="sm" className="text-[13px]" variant="outline" aria-pressed={p.listOpen} onClick={p.onToggleList} title={elenco.titolo}>
        {elenco.etichetta}
      </Button>
      <div className="inline-flex overflow-hidden rounded-md border border-foreground" role="group" aria-label="Tipo di mappa">
        {(["auto", "passo"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={p.mode === m}
            onClick={() => p.onMode(m)}
            className={cn("px-3 py-1", p.mode === m ? "bg-foreground font-semibold text-background" : "bg-card text-foreground hover:bg-muted")}
          >
            {p.mode === m && "● "}
            {m === "auto" ? "Tutto automatico" : "Passo passo"}
          </button>
        ))}
      </div>

      {p.mode === "auto" ? (
        <>
          <span>
            Testa: <b>{p.headName ?? "nessuna"}</b>
            {p.headName && <span className="text-muted-foreground"> ({p.headOrigin})</span>}
          </span>
          {p.isAdmin && (
            <Button size="sm" className="text-[13px]" variant="outline" onClick={() => setAsked("fromAuto")}>Crea una mappa passo passo da qui</Button>
          )}
        </>
      ) : (
        <>
          {p.maps.length > 0 ? (
            <Select value={p.mapId === null ? "" : String(p.mapId)} onValueChange={(v) => { if (v) p.onMap(Number(v)); }}>
              <SelectTrigger size="sm" className="min-w-[200px]" aria-label="Mappa"><SelectValue placeholder="Scegli una mappa" /></SelectTrigger>
              <SelectContent>
                {p.maps.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-muted-foreground">Nessuna mappa salvata</span>
          )}
          {p.isAdmin && (
            <>
              <Button size="sm" className="text-[13px]" variant="outline" onClick={() => setAsked("new")}>Nuova mappa…</Button>
              {current && <Button size="sm" className="text-[13px]" variant="outline" onClick={() => setAsked("rename")}>Rinomina</Button>}
              {current && <Button size="sm" className="text-[13px]" variant="destructive" onClick={() => setAsked("delete")}>Elimina</Button>}
            </>
          )}
        </>
      )}

      {p.mappaErrore && (
        // Una riga breve accanto al nome della mappa, niente fascia (§13.10.3); il messaggio intero al passaggio del mouse.
        <span role="status" className="font-medium" title={p.mappaErrore}>⚠ mappa di prima: la nuova non si è potuta calcolare</span>
      )}
      <span className="ml-auto" />
      {p.refreshFailedAt !== null && (
        <span role="status" className="inline-flex items-center gap-1.5 rounded-md border border-destructive bg-destructive/10 px-2 py-0.5 font-medium text-destructive" title={p.refreshMessage ?? undefined}>
          ▲ Aggiornamento non riuscito alle {oraItaliana(p.refreshFailedAt)} ·
          <button type="button" onClick={p.onRetry} className="underline underline-offset-2 hover:no-underline">Riprova</button>
        </span>
      )}
      {p.orientation && (
        // Per chi non è admin il valore in parole, fermo; il motivo al passaggio del mouse (sul gruppo: un pulsante spento non lo mostra).
        <div className="inline-flex overflow-hidden rounded-md border border-foreground" role="group" aria-label="Orientamento della mappa" title={lockedWhy}>
          {ORIENTAMENTI.map(({ o, label }) => (
            <button
              key={o}
              type="button"
              aria-pressed={p.orientation === o}
              disabled={!p.onOrientation}
              onClick={() => { if (p.orientation !== o) p.onOrientation?.(o); }}
              className={cn(
                "px-3 py-1 disabled:pointer-events-none",
                p.orientation === o ? "bg-foreground font-semibold text-background" : "bg-card text-foreground hover:bg-muted",
                !p.onOrientation && p.orientation !== o && "text-muted-foreground",
              )}
            >
              {p.orientation === o && "● "}
              {label}
            </button>
          ))}
        </div>
      )}
      <label className="flex cursor-pointer items-center gap-1.5" title="Le linee dei secondi cavi: spente, si vedono quelle del riquadro su cui fai clic">
        <input type="checkbox" checked={p.showExtra} onChange={(e) => p.onShowExtra(e.target.checked)} className="size-4" />
        Mostra ridondanze
      </label>
      <Button size="sm" className="text-[13px]" variant="outline" onClick={() => void rf.zoomOut()} aria-label="Rimpicciolisci">−</Button>
      <Button size="sm" className="text-[13px]" variant="outline" onClick={() => void rf.zoomIn()} aria-label="Ingrandisci">+</Button>
      <Button
        size="sm"
        className="text-[13px]"
        variant="outline"
        onClick={adatta}
        title={p.orientation === "lr" ? "Tutta la larghezza della mappa, dalla cima: poi si scorre con la rotellina" : "Tutta la mappa nel riquadro"}
      >
        Adatta
      </Button>
      {p.isAdmin && (
        <Button size="sm" className="text-[13px]" variant="outline" disabled={!p.canRiordina} onClick={p.onRiordina} title="Toglie gli spostamenti fatti a mano">
          Riordina
        </Button>
      )}
      {p.printHref ? (
        <Button
          size="sm"
          className="text-[13px]"
          variant="outline"
          nativeButton={false}
          render={<a href={p.printHref} target="_blank" rel="noopener noreferrer" />}
          title="Apre in una scheda nuova la mappa pronta per la carta (A4 o A3, più fogli)"
        >
          Stampa
        </Button>
      ) : (
        // Il motivo sul contenitore: un pulsante spento non mostra il suo.
        <span title="Scegli prima una mappa da stampare"><Button size="sm" className="text-[13px]" variant="outline" disabled>Stampa</Button></span>
      )}
      {p.detailsAvailable && <Button
        size="sm"
        className="text-[13px]"
        variant="outline"
        aria-pressed={p.detailsOpen}
        onClick={p.onToggleDetails}
        title={p.detailsOpen ? "Chiude la barra dei dettagli: la mappa prende tutto lo spazio" : "Apre la barra dei dettagli dell'oggetto scelto"}
      >
        {p.detailsOpen ? "Dettagli ▸" : "◂ Dettagli"}
      </Button>}

      <NameDialog
        open={asked === "new" || asked === "fromAuto"}
        title={asked === "fromAuto" ? "Nuova mappa passo passo da quella automatica" : "Nuova mappa passo passo"}
        initial=""
        onClose={() => setAsked(null)}
        onSubmit={asked === "fromAuto" ? p.onCreateFromAuto : p.onCreate}
      />
      <NameDialog
        open={asked === "rename"}
        title="Rinomina la mappa"
        initial={current?.name ?? ""}
        onClose={() => setAsked(null)}
        onSubmit={p.onRename}
      />
      <Dialog open={asked === "delete"} onOpenChange={(o) => { if (!o) setAsked(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Eliminare la mappa «{current?.name}»?</DialogTitle></DialogHeader>
          <p className="text-[13px]">Si tolgono la mappa e i suoi spostamenti. Gli apparati restano.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsked(null)}>Annulla</Button>
            <Button variant="destructive" onClick={async () => { if (await p.onDelete()) setAsked(null); }}>Elimina</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function NameDialog(props: {
  open: boolean;
  title: string;
  initial: string;
  /** Una riga sotto il titolo (es. quale oggetto entra nella mappa nuova). */
  hint?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<boolean>;
}) {
  return (
    <Dialog open={props.open} onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <DialogContent>
        {/* Il form si rimonta a ogni apertura: il nome riparte da quello attuale. */}
        {props.open && <NameForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ title, initial, hint, onClose, onSubmit }: {
  title: string; initial: string; hint?: string; onClose: () => void; onSubmit: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ok = name.trim().length > 0 && name.trim().length <= 80;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        const done = await onSubmit(name.trim());
        setBusy(false);
        if (done) onClose();
      }}
      className="grid gap-3"
    >
      <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
      {hint && <p className="text-[13px]">{hint}</p>}
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Nome della mappa" placeholder="Nome della mappa" />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
        <Button type="submit" disabled={!ok || busy}>Salva</Button>
      </DialogFooter>
    </form>
  );
}

"use client";

/**
 * La barra sopra la mappa: «Tutto automatico» / «Passo passo» (il segmento
 * attivo ha il fondo pieno E il «●»: doppio segnale), la scelta della mappa o
 * la testa, e a destra collegamenti in più, zoom, «Adatta», «Riordina».
 * Le scritture (mappe, testa, riordina) si vedono solo agli admin.
 */
import { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { oraItaliana } from "@/lib/topology/load-state";
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
  canRiordina: boolean;
  onRiordina: () => void;
  /** L'ultimo aggiornamento automatico non è riuscito (ms): la mappa è quella di prima. */
  refreshFailedAt: number | null;
  refreshMessage: string | null;
  onRetry: () => void;
}

type Asked = null | "new" | "rename" | "fromAuto" | "delete";

export function MapToolbar(p: Props) {
  const rf = useReactFlow();
  const [asked, setAsked] = useState<Asked>(null);
  const current = p.maps.find((m) => m.id === p.mapId) ?? null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-2.5 py-1.5 text-[13px]">
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
            <Button size="sm" variant="outline" onClick={() => setAsked("fromAuto")}>Crea una mappa passo passo da qui</Button>
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
              <Button size="sm" variant="outline" onClick={() => setAsked("new")}>Nuova mappa…</Button>
              {current && <Button size="sm" variant="outline" onClick={() => setAsked("rename")}>Rinomina</Button>}
              {current && <Button size="sm" variant="destructive" onClick={() => setAsked("delete")}>Elimina</Button>}
            </>
          )}
        </>
      )}

      <span className="ml-auto" />
      {p.refreshFailedAt !== null && (
        <span role="status" className="inline-flex items-center gap-1.5 rounded-md border border-destructive bg-destructive/10 px-2 py-0.5 font-medium text-destructive" title={p.refreshMessage ?? undefined}>
          ▲ Aggiornamento non riuscito alle {oraItaliana(p.refreshFailedAt)} ·
          <button type="button" onClick={p.onRetry} className="underline underline-offset-2 hover:no-underline">Riprova</button>
        </span>
      )}
      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" checked={p.showExtra} onChange={(e) => p.onShowExtra(e.target.checked)} className="size-4" />
        Collegamenti in più
      </label>
      <Button size="sm" variant="outline" onClick={() => void rf.zoomOut()} aria-label="Rimpicciolisci">−</Button>
      <Button size="sm" variant="outline" onClick={() => void rf.zoomIn()} aria-label="Ingrandisci">+</Button>
      <Button size="sm" variant="outline" onClick={() => void rf.fitView({ padding: 0.05 })}>Adatta</Button>
      {p.isAdmin && (
        <Button size="sm" variant="outline" disabled={!p.canRiordina} onClick={p.onRiordina} title="Toglie gli spostamenti fatti a mano">
          Riordina
        </Button>
      )}

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

function NameDialog(props: { open: boolean; title: string; initial: string; onClose: () => void; onSubmit: (name: string) => Promise<boolean> }) {
  return (
    <Dialog open={props.open} onOpenChange={(o) => { if (!o) props.onClose(); }}>
      <DialogContent>
        {/* Il form si rimonta a ogni apertura: il nome riparte da quello attuale. */}
        {props.open && <NameForm {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function NameForm({ title, initial, onClose, onSubmit }: { title: string; initial: string; onClose: () => void; onSubmit: (name: string) => Promise<boolean> }) {
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
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Nome della mappa" placeholder="Nome della mappa" />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Annulla</Button>
        <Button type="submit" disabled={!ok || busy}>Salva</Button>
      </DialogFooter>
    </form>
  );
}

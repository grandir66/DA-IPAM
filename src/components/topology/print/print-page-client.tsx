"use client";

/**
 * La pagina di stampa della mappa (spec topologia §12.3, §12.5): carica modello e vista con
 * `fetchJson` (un errore è un errore in parole, mai un foglio bianco: Review Focus 5), rifà albero e
 * disposizione come la pagina della mappa (`buildPrintView`), taglia il disegno in fogli
 * (`planSheets`) e li mette in fila per la carta. Sopra i fogli, solo a schermo, la barra con foglio,
 * scala, «con le VM» e «Stampa». Le scelte stanno nell'indirizzo, così un ricaricamento le tiene.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Printer } from "lucide-react";
import { LoadError } from "@/components/shared/load-error";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJson } from "@/lib/fetch-json";
import { drawingBoxes, redundantCables } from "@/lib/topology/print-draw";
import { OVERLAP_MM, cablePages, planSheets, type Paper, type PrintScale } from "@/lib/topology/print-tiles";
import { buildPrintView, printQuery, type PrintParams, type PrintViewInput } from "@/lib/topology/print-view";
import type { ModelData } from "@/components/topology/map/use-topology-data";
import { PrintSheets } from "./print-sheet";

type Loaded = { model: ModelData; view: PrintViewInput; at: Date };

function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<{ value: T; text: string }>; onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex">
        {options.map((o, i) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              "border px-3 py-1 text-sm",
              i === 0 ? "rounded-l-md" : "-ml-px rounded-r-md",
              o.value === value ? "relative z-10 border-foreground bg-foreground font-semibold text-background" : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PrintPageClient({ initial }: { initial: PrintParams }) {
  const [params, setParams] = useState<PrintParams>(initial);
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = params.key;

  useEffect(() => {
    if (key === null) return;
    const ctrl = new AbortController();
    const opts: RequestInit = { cache: "no-store", signal: ctrl.signal };
    setError(null);
    setData(null);
    Promise.all([
      fetchJson<ModelData>("/api/topology/model", opts),
      fetchJson<PrintViewInput>(`/api/topology/maps/${encodeURIComponent(String(key))}`, opts),
    ]).then(([m, v]) => {
      if (!m.ok) return setError(m.message);
      if (!v.ok) return setError(v.status === 404 ? "Mappa non trovata: forse è stata cancellata. Riaprila dalla pagina Topologia." : v.message);
      setData({ model: m.data, view: v.data, at: new Date() });
    }).catch((e: unknown) => {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Errore sconosciuto");
    });
    return () => ctrl.abort();
  }, [key, attempt]);

  const change = useCallback((p: Partial<PrintParams>) => {
    setParams((old) => {
      const next = { ...old, ...p };
      try { window.history.replaceState(null, "", printQuery(next)); } catch { /* l'indirizzo resta quello di prima */ }
      return next;
    });
  }, []);

  const view = useMemo(() => (data && key !== null ? buildPrintView(data.model, key, data.view, params.withVms) : null), [data, key, params.withVms]);
  const plan = useMemo(
    () => (view?.ok ? planSheets({ width: view.layout.width, height: view.layout.height, boxes: drawingBoxes(view.layout) }, { paper: params.paper, scale: params.scale, overlapMm: OVERLAP_MM }) : null),
    [view, params.paper, params.scale],
  );
  const cables = useMemo(() => {
    if (!view?.ok) return [];
    const names = new Map(view.model.nodes.map((n) => [n.id, n.name]));
    return redundantCables(view.tree, new Set(view.layout.nodes.keys()), (id) => names.get(id) ?? id);
  }, [view]);

  useEffect(() => {
    if (view?.ok) document.title = `Topologia — ${view.title}`;
  }, [view]);

  let body: ReactNode;
  if (key === null) {
    body = <Problem text="Manca la mappa da stampare: apri la stampa col pulsante «Stampa» della pagina Topologia." />;
  } else if (error) {
    body = <div className="max-w-[720px]"><LoadError what="la mappa da stampare" message={error} onRetry={() => setAttempt((a) => a + 1)} /></div>;
  } else if (!data || !view) {
    body = <p className="text-sm text-muted-foreground">Caricamento della mappa…</p>;
  } else if (!view.ok) {
    body = <Problem text={view.message} />;
  } else if (plan) {
    body = <PrintSheets view={view} plan={plan} cables={cables} at={data.at} withVms={params.withVms} />;
  }

  const printable = !!plan && !!view?.ok;
  return (
    <div className="stampa-fondo min-h-screen bg-muted/60 p-4">
      <style>{`
        .stampa-fondo { display: flex; flex-direction: column; align-items: center; gap: 16px; }
        .stampa-foglio { box-shadow: 0 1px 6px rgb(0 0 0 / 0.25); print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        @media print {
          html, body { background: #fff !important; }
          .stampa-barra { display: none !important; }
          .stampa-fondo { display: block; padding: 0 !important; background: #fff !important; min-height: 0 !important; }
          .stampa-foglio { box-shadow: none !important; break-after: page; page-break-after: always; }
          section.stampa-foglio:last-of-type { break-after: auto; page-break-after: auto; }
        }
      `}</style>
      <div className="stampa-barra sticky top-0 z-20 flex w-full max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2 rounded-md border bg-card px-4 py-2 text-foreground shadow-sm">
        <strong className="text-base">Stampa della mappa</strong>
        <Segmented<Paper> label="Foglio" value={params.paper} onChange={(v) => change({ paper: v })} options={[{ value: "A4", text: "A4" }, { value: "A3", text: "A3" }]} />
        <Segmented<PrintScale> label="Scala" value={params.scale} onChange={(v) => change({ scale: v })} options={[{ value: 1, text: "100 %" }, { value: 0.8, text: "80 %" }]} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={params.withVms} onChange={(e) => change({ withVms: e.target.checked })} />
          con le VM
        </label>
        <Button onClick={() => window.print()} disabled={!printable} title={printable ? "Apre la finestra di stampa del browser (anche «Salva come PDF»)" : "Niente da stampare"}>
          <Printer className="mr-1.5 size-4" /> Stampa
        </Button>
        {plan && (
          <span className="text-sm text-muted-foreground">
            {1 + cablePages(cables.length, plan.pageMm).length + plan.printed} fogli {plan.paper}{" "}
            {plan.landscape ? "orizzontali" : "verticali"}. Nella finestra di stampa: margini «Predefiniti», scala «Predefinita» (100 %).
          </span>
        )}
      </div>
      {body}
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <div className="max-w-[720px] rounded-md border-2 border-foreground bg-card p-6 text-foreground">
      <p className="text-base font-semibold">Niente da stampare</p>
      <p className="mt-1 text-sm">{text}</p>
    </div>
  );
}

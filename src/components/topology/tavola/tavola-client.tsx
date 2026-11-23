"use client";

/**
 * La pagina «Tavola di cablaggio» (spec 2026-11-23 §4): barra in una riga (sito, porte libere, ricerca, numeri), legenda,
 * tavola nel suo riquadro che scorre in orizzontale sotto i 1240 px, e il pannello del collegamento scelto. Sola lettura:
 * per correggere un cavo si va alla Topologia. Dati da GET /api/topology/tavola; un errore si mostra come errore.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { LoadError } from "@/components/shared/load-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/fetch-json";
import { SOURCE_WORDS, seenWords, speedLabel } from "@/lib/topology/edge-look";
import { componiTavola } from "@/lib/topology/tavola/componi";
import { disponiEInstrada } from "@/lib/topology/tavola/instrada";
import type { PortaComposta, TavolaView, TipoPorta } from "@/lib/topology/tavola/tipi";
import { LegendaTavola } from "./legenda";
import { TavolaSvg, type Fuoco } from "./tavola-svg";

const CHIAVE_SITO = "topologia.tavola.sito";
const CHIAVE_LIBERE = "topologia.tavola.libere";
const LARGHEZZA_MIN = 1240;

function leggi(k: string): string | null {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function scrivi(k: string, v: string): void {
  try { window.localStorage.setItem(k, v); } catch { /* memoria del browser non disponibile: si riparte dal predefinito */ }
}

export function TavolaClient() {
  const [sito, setSito] = useState<number | null>(null);
  const [pronto, setPronto] = useState(false);
  const [dati, setDati] = useState<TavolaView | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [carica, setCarica] = useState(true);
  const [libere, setLibere] = useState(true);
  const [cerca, setCerca] = useState("");
  const [sopraPorta, setSopraPorta] = useState<PortaComposta | null>(null);
  const [sopraCavo, setSopraCavo] = useState<string | null>(null);
  const [scelto, setScelto] = useState<string | null>(null);
  const [larghezza, setLarghezza] = useState(1600);
  const riquadro = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = leggi(CHIAVE_SITO);
    if (s && /^\d+$/.test(s)) setSito(Number(s));
    setLibere(leggi(CHIAVE_LIBERE) !== "nascoste");
    setPronto(true);
  }, []);

  const ricarica = useCallback(async (s: number | null) => {
    setCarica(true);
    setErrore(null);
    const r = await fetchJson<TavolaView>(`/api/topology/tavola${s !== null ? `?site=${s}` : ""}`);
    if (r.ok) {
      setDati(r.data);
      // Un sito ricordato che non c'è più: la rotta ha già scelto il primo, ma con quello chiesto non trova apparati.
      if (s !== null && !r.data.siti.some((x) => x.id === s) && r.data.siti.length > 0) {
        setSito(r.data.siti[0].id);
        return;
      }
    } else setErrore(r.message);
    setCarica(false);
  }, []);

  useEffect(() => {
    if (pronto) void ricarica(sito);
  }, [pronto, sito, ricarica]);

  useEffect(() => {
    const el = riquadro.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setLarghezza(Math.max(LARGHEZZA_MIN, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [dati]);

  const tavola = useMemo(() => {
    if (!dati) return null;
    const composta = componiTavola({ sito: dati.site, nodi: dati.nodi, collegamenti: dati.collegamenti, apparati: dati.apparati });
    const apparati = libere ? composta.apparati : composta.apparati.map((a) => ({ ...a, porte: a.porte.filter((p) => p.tipo !== "libera" || p.collegamento) }));
    const { righe, disegno } = disponiEInstrada(apparati, composta.cavi, larghezza);
    const tipoCavo = new Map(composta.cavi.map((c) => [c.id, { tipo: c.tipo, dubbio: c.dubbio }]));
    const porte = apparati.flatMap((a) => a.porte);
    return { apparati, righe, disegno, tipoCavo, porte, cavi: composta.cavi };
  }, [dati, libere, larghezza]);

  const perCollegamento = useCallback((ids: Iterable<string>): Fuoco | null => {
    if (!tavola) return null;
    const coll = new Set(ids);
    const porte = tavola.porte.filter((p) => p.collegamento !== null && coll.has(p.collegamento));
    return { collegamenti: coll, porte: new Set(porte.map((p) => p.id)), nodi: new Set(porte.map((p) => p.nodo)) };
  }, [tavola]);

  const fuoco = useMemo((): Fuoco | null => {
    if (!tavola) return null;
    if (sopraPorta) {
      if (sopraPorta.collegamento) return perCollegamento([sopraPorta.collegamento]);
      return { collegamenti: new Set(), porte: new Set([sopraPorta.id]), nodi: new Set() };
    }
    if (sopraCavo) return perCollegamento([sopraCavo]);
    if (scelto) return perCollegamento([scelto]);
    const q = cerca.trim().toLowerCase();
    if (q.length < 2) return null;
    const app = tavola.apparati.filter((a) => a.nome.toLowerCase().includes(q) || (a.ip ?? "").includes(q));
    const nodi = new Set(app.map((a) => a.nodo));
    const porte = tavola.porte.filter((p) => nodi.has(p.nodo) || (p.destinazione ?? "").toLowerCase().includes(q) || p.nome.toLowerCase() === q);
    return { collegamenti: new Set(porte.flatMap((p) => (p.collegamento ? [p.collegamento] : []))), porte: new Set(porte.map((p) => p.id)), nodi };
  }, [tavola, sopraPorta, sopraCavo, scelto, cerca, perCollegamento]);

  const nomeDi = useCallback((id: string) => dati?.nodi.find((n) => n.id === id)?.name ?? id, [dati]);
  const collegamento = scelto ? dati?.collegamenti.find((l) => l.id === scelto) ?? null : null;
  const contaTipi = (t: TipoPorta) => tavola?.porte.filter((p) => p.tipo === t).length ?? 0;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-2">
        <h1 className="text-xl font-bold tracking-tight">Tavola di cablaggio</h1>
        <label className="flex items-center gap-2 border-l pl-4 text-[13px]">
          Sede
          <select className="h-9 rounded-md border bg-background px-2 text-[14px]" value={dati?.site ?? ""} disabled={!dati || dati.siti.length === 0}
            onChange={(e) => { const v = Number(e.target.value); setScelto(null); setSito(v); scrivi(CHIAVE_SITO, String(v)); }}>
            {(dati?.siti ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {tavola && (
          <div className="flex flex-wrap items-center gap-2 border-l pl-4 font-mono text-[13px] text-muted-foreground">
            <span className="rounded-md border bg-muted/50 px-2 py-0.5">{tavola.apparati.length} apparati</span>
            <span className="rounded-md border bg-muted/50 px-2 py-0.5">{tavola.disegno.linee.length} cavi</span>
            <span className="rounded-md border bg-muted/50 px-2 py-0.5">{contaTipi("libera")} porte libere</span>
            {tavola.porte.some((p) => p.dubbio) && (
              <span className="rounded-md border border-destructive/60 bg-destructive/10 px-2 py-0.5 text-foreground">! {tavola.porte.filter((p) => p.dubbio).length} da verificare</span>
            )}
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" className="h-4 w-4" checked={libere} onChange={(e) => { setLibere(e.target.checked); scrivi(CHIAVE_LIBERE, e.target.checked ? "mostrate" : "nascoste"); }} />
            Mostra porte libere
          </label>
          <Input className="h-9 w-64" placeholder="Trova porta o apparato" value={cerca} onChange={(e) => { setCerca(e.target.value); setScelto(null); }} />
          <span className="h-6 w-px bg-border" />
          <Link href="/topology" className="text-[13px] underline">Topologia</Link>
        </div>
      </div>

      <LegendaTavola />

      {collegamento && (
        <section className="rounded-xl border bg-card px-4 py-3 text-[13px]">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[15px] font-semibold">
                {nomeDi(collegamento.a)} <span className="font-mono">{collegamento.aPort || "?"}</span>
                {" ↔ "}
                {nomeDi(collegamento.b)} <span className="font-mono">{collegamento.bPort || "?"}</span>
              </p>
              <p className="text-muted-foreground">
                {[collegamento.sources.map((s) => SOURCE_WORDS[s]).join(" + "), seenWords(collegamento), speedLabel(collegamento.speedMbps),
                  collegamento.cavo?.fascio ? `fascio di ${collegamento.cavo.fascio.membri.length} cavi` : null].filter(Boolean).join(" · ")}
              </p>
              {(collegamento.cavo?.frasi.length ?? 0) > 0 && (
                <ul className="list-disc pl-5">
                  {collegamento.cavo!.frasi.slice(0, 6).map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              )}
              <p><Link href="/topology" className="underline">Per correggere questo cavo: Topologia</Link></p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setScelto(null)} aria-label="Chiudi"><X className="h-4 w-4" /></Button>
          </div>
        </section>
      )}

      {errore ? (
        <LoadError what="la tavola di cablaggio" message={errore} onRetry={() => void ricarica(sito)} />
      ) : !dati || (carica && !tavola) ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-[14px] text-muted-foreground">Caricamento della tavola…</div>
      ) : dati.siti.length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-[14px]">Nessun apparato nella mappa.</div>
      ) : tavola && tavola.apparati.length === 0 ? (
        <div className="rounded-xl border bg-card px-4 py-10 text-center text-[14px]">Nessun apparato in questa sede: gli apparati si assegnano alla sede dalla loro scheda.</div>
      ) : (
        <div ref={riquadro} className="overflow-x-auto rounded-xl border bg-background p-3" style={{ opacity: carica ? 0.6 : 1 }}>
          {tavola && (
            <TavolaSvg apparati={tavola.apparati} righe={tavola.righe} disegno={tavola.disegno} tipoCavo={tavola.tipoCavo} fuoco={fuoco}
              onVuoto={() => setScelto(null)}
              onPorta={setSopraPorta} onCavo={setSopraCavo} onScegli={(c) => setScelto((x) => (x === c ? null : c))} />
          )}
        </div>
      )}
    </div>
  );
}

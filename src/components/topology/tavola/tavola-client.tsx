"use client";

/**
 * La pagina «Tavola di cablaggio» (spec 2026-11-23 §4): barra in una riga (sito, porte libere, ricerca, numeri), legenda,
 * tavola nel suo riquadro che scorre in orizzontale sotto i 1240 px, e il riquadro del collegamento o della porta scelta. Sola lettura:
 * per correggere un cavo si va alla Topologia. Dati da GET /api/topology/tavola; un errore si mostra come errore.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LoadError } from "@/components/shared/load-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchJson } from "@/lib/fetch-json";
import { componiTavola } from "@/lib/topology/tavola/componi";
import { disponiEInstrada } from "@/lib/topology/tavola/instrada";
import { cercaInTavola } from "@/lib/topology/tavola/ricerca";
import type { PortaComposta, TavolaView, TipoPorta, VmComposta } from "@/lib/topology/tavola/tipi";
import { LegendaTavola } from "./legenda";
import { RiquadroScelta } from "./riquadro-scelta";
import { TavolaSvg, scrittaVm, type Fuoco } from "./tavola-svg";

const CHIAVE_SITO = "topologia.tavola.sito";
const CHIAVE_LIBERE = "topologia.tavola.libere";
const LARGHEZZA_MIN = 1240;

function leggi(k: string): string | null {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function scrivi(k: string, v: string): void {
  try { window.localStorage.setItem(k, v); } catch { /* memoria del browser non disponibile: si riparte dal predefinito */ }
}

/** Ciò che non ha un posto nella tavola: chiuso, per non occupare spazio. */
function ElencoFuori({ titolo, voci }: { titolo: string; voci: readonly VmComposta[] }) {
  if (voci.length === 0) return null;
  return (
    <details className="rounded-xl border bg-card px-4 py-2 text-[13px]">
      <summary className="cursor-pointer font-semibold">{titolo} · {voci.length}</summary>
      <ul className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-x-4">
        {voci.map((v) => <li key={v.id} className="truncate">{v.scheda ? <Link href={v.scheda} className="hover:underline">{scrittaVm(v, 60)}</Link> : scrittaVm(v, 60)}</li>)}
      </ul>
    </details>
  );
}

/** Porta al centro dello schermo una porta o un apparato della tavola. */
function vaiA(id: string): void {
  const fermo = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(`tavola-${id}`)?.scrollIntoView({ block: "center", inline: "center", behavior: fermo ? "auto" : "smooth" });
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
  const [portaScelta, setPortaScelta] = useState<string | null>(null);
  const [quale, setQuale] = useState(0);
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
    const composta = componiTavola({ sito: dati.site, nodi: dati.nodi, collegamenti: dati.collegamenti, apparati: dati.apparati, armadi: dati.armadi, vms: dati.vms });
    const conPorte = libere ? composta.apparati : composta.apparati.map((a) => ({ ...a, porte: a.porte.filter((p) => p.tipo !== "libera" || p.collegamento) }));
    // Con le porte libere nascoste un telaio senza porte non dice niente: si nasconde, e la barra dice quanti sono.
    const tutti = composta.apparati.length;
    const apparati = libere ? conPorte : conPorte.filter((a) => a.porte.length > 0 || (a.vms?.length ?? 0) > 0);
    const { righe, disegno } = disponiEInstrada(apparati, composta.cavi, larghezza);
    const tipoCavo = new Map(composta.cavi.map((c) => [c.id, { tipo: c.tipo, dubbio: c.dubbio }]));
    const porte = apparati.flatMap((a) => a.porte);
    return { apparati, righe, disegno, tipoCavo, porte, cavi: composta.cavi, nascosti: tutti - apparati.length, vmSenzaCasa: composta.vmSenzaCasa, postazioniSenzaPorta: composta.postazioniSenzaPorta,
      quanteVm: composta.apparati.reduce((n, a) => n + (a.vms?.length ?? 0), composta.vmSenzaCasa.length) };
  }, [dati, libere, larghezza]);

  const perCollegamento = useCallback((ids: Iterable<string>): Fuoco | null => {
    if (!tavola) return null;
    const coll = new Set(ids);
    const porte = tavola.porte.filter((p) => p.collegamento !== null && coll.has(p.collegamento));
    return { collegamenti: coll, porte: new Set(porte.map((p) => p.id)), nodi: new Set(porte.map((p) => p.nodo)) };
  }, [tavola]);

  const trovati = useMemo(() => (tavola ? cercaInTavola(tavola.apparati, cerca) : []), [tavola, cerca]);
  const attuale = trovati.length > 0 ? trovati[Math.min(quale, trovati.length - 1)] : null;
  const corrente = attuale && !scelto && !portaScelta ? attuale.porta ?? attuale.nodo : null;
  useEffect(() => { if (corrente) vaiA(corrente); }, [corrente]);
  const togliScelta = () => { setScelto(null); setPortaScelta(null); };
  const gira = (passo: number) => {
    if (trovati.length === 0) return;
    togliScelta();
    setQuale((q) => (Math.min(q, trovati.length - 1) + passo + trovati.length) % trovati.length);
  };

  const fuoco = useMemo((): Fuoco | null => {
    if (!tavola) return null;
    if (sopraPorta) {
      if (sopraPorta.collegamento) return perCollegamento([sopraPorta.collegamento]);
      return { collegamenti: new Set(), porte: new Set([sopraPorta.id]), nodi: new Set() };
    }
    if (sopraCavo) return perCollegamento([sopraCavo]);
    if (scelto) return perCollegamento([scelto]);
    if (portaScelta) return { collegamenti: new Set(), porte: new Set([portaScelta]), nodi: new Set() };
    if (cerca.trim().length < 2) return null;
    const nodi = new Set(trovati.filter((t) => t.porta === null).map((t) => t.nodo));
    const singole = new Set(trovati.map((t) => t.porta));
    const porte = tavola.porte.filter((p) => nodi.has(p.nodo) || singole.has(p.id));
    return { collegamenti: new Set(porte.flatMap((p) => (p.collegamento ? [p.collegamento] : []))), porte: new Set(porte.map((p) => p.id)), nodi };
  }, [tavola, sopraPorta, sopraCavo, scelto, portaScelta, cerca, trovati, perCollegamento]);

  const nomeDi = useCallback((id: string) => dati?.nodi.find((n) => n.id === id)?.name ?? id, [dati]);
  const collegamento = scelto ? dati?.collegamenti.find((l) => l.id === scelto) ?? null : null;
  const contaTipi = (t: TipoPorta) => tavola?.porte.filter((p) => p.tipo === t).length ?? 0;

  const scegli = (c: string | null, porta: PortaComposta | null) => {
    const stessa = scelto === c && portaScelta === (porta?.id ?? null);
    setScelto(stessa ? null : c);
    setPortaScelta(stessa ? null : porta?.id ?? null);
  };
  const portaAperta = portaScelta ? tavola?.porte.find((x) => x.id === portaScelta) ?? null : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-2">
        <h1 className="text-xl font-bold tracking-tight">Tavola di cablaggio</h1>
        <label className="flex items-center gap-2 border-l pl-4 text-[13px]">
          Sede
          <select className="h-9 rounded-md border bg-background px-2 text-[14px]" value={dati?.site ?? ""} disabled={!dati || dati.siti.length === 0}
            onChange={(e) => { const v = Number(e.target.value); togliScelta(); setQuale(0); setSito(v); scrivi(CHIAVE_SITO, String(v)); }}>
            {(dati?.siti ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {tavola && (
          <div className="flex flex-wrap items-center gap-2 border-l pl-4 font-mono text-[13px] text-muted-foreground">
            <span className="rounded-md border bg-muted/50 px-2 py-0.5">{tavola.apparati.length} apparati{tavola.nascosti > 0 ? ` · ${tavola.nascosti} nascosti` : ""}</span>
            {tavola.quanteVm > 0 && <span className="rounded-md border bg-muted/50 px-2 py-0.5">{tavola.quanteVm} VM</span>}
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
          <Input className="h-9 w-64" placeholder="Trova porta o apparato" value={cerca} onChange={(e) => { setCerca(e.target.value); setQuale(0); togliScelta(); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); gira(e.shiftKey ? -1 : 1); } }} />
          {cerca.trim().length >= 2 && (
            <div className="flex items-center gap-1 text-[13px]" aria-live="polite">
              <span className="font-mono">{trovati.length === 0 ? "Nessun risultato" : `${Math.min(quale, trovati.length - 1) + 1} di ${trovati.length}`}</span>
              <Button variant="outline" size="sm" disabled={trovati.length < 2} onClick={() => gira(-1)} aria-label="Risultato precedente"><ChevronLeft className="h-4 w-4" /></Button>
              <Button variant="outline" size="sm" disabled={trovati.length < 2} onClick={() => gira(1)} aria-label="Risultato successivo"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      </div>

      <LegendaTavola />

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
            <TavolaSvg apparati={tavola.apparati} righe={tavola.righe} disegno={tavola.disegno} tipoCavo={tavola.tipoCavo} fuoco={fuoco} corrente={corrente}
              onVuoto={togliScelta}
              onPorta={setSopraPorta} onCavo={setSopraCavo} onScegli={scegli} />
          )}
        </div>
      )}

      {tavola && <ElencoFuori titolo="Macchine virtuali senza hypervisor nella tavola" voci={tavola.vmSenzaCasa} />}
      {tavola && <ElencoFuori titolo="Postazioni, stampanti, telefoni e telecamere senza una porta nota" voci={tavola.postazioniSenzaPorta} />}

      {tavola && (
        <RiquadroScelta collegamento={collegamento} porta={portaAperta} apparati={tavola.apparati} nomeDi={nomeDi}
          onVai={(id) => { setPortaScelta(id); vaiA(id); }} onChiudi={togliScelta} />
      )}
    </div>
  );
}

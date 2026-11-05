"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ScanProgress } from "@/components/shared/scan-progress";
import { etichettaGiro } from "@/lib/scanner/giri";
import type { GiroInElenco, JobInElenco, ScanProgress as ScanProgressType } from "@/types";

const CONTROLLO_MS = 5_000;
/** Con niente in corso l'elenco si rilegge più di rado: lo chiede ogni pagina aperta, tutto il giorno. */
const RIPOSO_MS = 20_000;
const DETTAGLIO_MS = 1_000;
/** Letture 404 di fila prima di chiudere il pannello: i progressi vivono in memoria, un riavvio li perde. */
const MAX_ASSENTI = 5;

interface OpzioniApri {
  /** Fase precedente di una sequenza: se il pannello era stato chiuso, questa fase non lo riapre. */
  dopo?: string | null;
  /** Scelta esplicita dalla bacheca: riapre anche un giro chiuso prima. */
  forza?: boolean;
}

interface GiriCtx {
  giri: GiroInElenco[];
  job: JobInElenco[];
  /** Quanti giri e job stanno girando adesso. */
  inCorso: number;
  caricato: boolean;
  errore: string | null;
  ricarica: () => void;
  apri: (id: string, opzioni?: OpzioniApri) => void;
}

const GiriContext = createContext<GiriCtx | null>(null);

/** La bacheca dei giri, su tutte le pagine: elenco, pannello aperto ed esito di quelli avviati da qui. */
export function GiriProvider({ children }: { children: React.ReactNode }) {
  const [giri, setGiri] = useState<GiroInElenco[]>([]);
  const [job, setJob] = useState<JobInElenco[]>([]);
  const [caricato, setCaricato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [apertoId, setApertoId] = useState<string | null>(null);
  const [dettaglio, setDettaglio] = useState<ScanProgressType | null>(null);
  const apertoRef = useRef<string | null>(null);
  const chiusiRef = useRef(new Set<string>());
  const seguitiRef = useRef(new Set<string>());
  const inCorsoRef = useRef(0);
  const ultimaLetturaRef = useRef(0);

  const leggi = useCallback(async () => {
    ultimaLetturaRef.current = Date.now();
    try {
      const res = await fetch("/api/scans/progress");
      const dati = (await res.json()) as { giri?: GiroInElenco[]; job?: JobInElenco[]; error?: string };
      if (!res.ok) {
        setErrore(dati.error ?? "Errore nella lettura");
        return;
      }
      const elenco = dati.giri ?? [];
      const inEsecuzione = dati.job ?? [];
      setGiri(elenco);
      setJob(inEsecuzione);
      setErrore(null);
      inCorsoRef.current = elenco.filter((g) => g.status === "running").length + inEsecuzione.length;
      // L'esito di un giro avviato da qui si dice anche se il pannello è chiuso: è il solo avviso che resta.
      for (const g of elenco) {
        if (g.status === "running" || !seguitiRef.current.delete(g.id) || g.id === apertoRef.current) continue;
        const nome = `${etichettaGiro(g.scan_type)}${g.etichetta ? ` · ${g.etichetta}` : ""}`;
        if (g.status === "completed") toast.success(`${nome}: completata`);
        else toast.error(`${nome}: ${g.error ?? "fallita"}`);
      }
    } catch {
      setErrore("Errore di rete");
    } finally {
      setCaricato(true);
    }
  }, []);

  useEffect(() => {
    void leggi();
    const id = setInterval(() => {
      if (document.hidden) return;
      if (inCorsoRef.current === 0 && Date.now() - ultimaLetturaRef.current < RIPOSO_MS) return;
      void leggi();
    }, CONTROLLO_MS);
    return () => clearInterval(id);
  }, [leggi]);

  const chiudi = useCallback(() => {
    if (apertoRef.current) chiusiRef.current.add(apertoRef.current);
    apertoRef.current = null;
    setApertoId(null);
  }, []);

  useEffect(() => {
    if (!apertoId) return;
    let assenti = 0;
    let id: ReturnType<typeof setInterval> | null = null;
    const smetti = () => {
      if (id) clearInterval(id);
      id = null;
    };
    const leggiGiro = async () => {
      try {
        const res = await fetch(`/api/scans/progress/${apertoId}`);
        if (!res.ok) {
          if (++assenti >= MAX_ASSENTI) {
            smetti();
            chiudi();
          }
          return;
        }
        assenti = 0;
        const giro = (await res.json()) as ScanProgressType;
        setDettaglio(giro);
        if (giro.status !== "running") smetti();
      } catch {
        /* il prossimo giro riprova */
      }
    };
    void leggiGiro();
    id = setInterval(() => void leggiGiro(), DETTAGLIO_MS);
    return smetti;
  }, [apertoId, chiudi]);

  const apri = useCallback((id: string, opzioni?: OpzioniApri) => {
    if (opzioni?.forza) {
      chiusiRef.current.delete(id);
    } else {
      seguitiRef.current.add(id);
      if (opzioni?.dopo && chiusiRef.current.has(opzioni.dopo)) chiusiRef.current.add(id);
    }
    ultimaLetturaRef.current = 0;
    if (chiusiRef.current.has(id)) return;
    apertoRef.current = id;
    setApertoId(id);
  }, []);

  const valore = useMemo<GiriCtx>(() => ({
    giri,
    job,
    inCorso: giri.filter((g) => g.status === "running").length + job.length,
    caricato,
    errore,
    ricarica: () => void leggi(),
    apri,
  }), [giri, job, caricato, errore, leggi, apri]);

  return (
    <GiriContext.Provider value={valore}>
      {children}
      {dettaglio && dettaglio.id === apertoId && <ScanProgress progress={dettaglio} onClose={chiudi} />}
    </GiriContext.Provider>
  );
}

export function useGiri(): GiriCtx {
  const ctx = useContext(GiriContext);
  if (!ctx) throw new Error("useGiri fuori da GiriProvider");
  return ctx;
}

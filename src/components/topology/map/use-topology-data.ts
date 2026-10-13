"use client";

/**
 * I dati della pagina Topologia: il modello (con lo stato dei nodi), le mappe
 * salvate e la vista scelta (nodi e ritocchi). Un errore è un errore, mai una
 * «mappa vuota» (fetchJson + LoadError); si ricarica da solo ogni 30 secondi e
 * dopo ogni scrittura. Un aggiornamento fallito con la mappa già a schermo la
 * tiene e lo dice (`refreshError`, ora italiana): solo il primo caricamento
 * fallito diventa l'errore pieno (load-state.ts).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchJson, type FetchJsonResult } from "@/lib/fetch-json";
import { afterLoadFailure } from "@/lib/topology/load-state";
import type { TopologyModel } from "@/lib/topology/model-types";
import type { TopologyStatus } from "@/lib/topology/types";
import type { SavedTweak } from "@/lib/topology/tree-layout";

export type ModelData = TopologyModel & { staleDays: number; status: Record<string, TopologyStatus> };

/** Una riga di topology_maps come la restituisce /api/topology/maps. */
export interface MapRow {
  id: number;
  name: string;
  kind: "auto" | "passo";
  roots: string[];
  head_node: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MapsData {
  maps: MapRow[];
  auto: MapRow | null;
}

export interface ViewData {
  map: MapRow | null;
  nodes: string[];
  tweaks: SavedTweak[];
}

export interface Loaded {
  model: ModelData;
  maps: MapsData;
  /** null = nessuna vista chiesta, o mappa cancellata nel frattempo (404). */
  view: ViewData | null;
  /** La vista a cui si riferisce `view`: finché non coincide con quella chiesta, la vista sta caricando. */
  viewKey: string | null;
}

const REFRESH_MS = 30_000;

/** `viewKey`: "auto", l'id di una mappa passo passo, o null. */
export function useTopologyData(viewKey: string | null) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** L'ultimo aggiornamento non è riuscito: la mappa a schermo è quella di prima. */
  const [refreshError, setRefreshError] = useState<{ message: string; at: number } | null>(null);
  const hasDataRef = useRef(false);
  const keyRef = useRef<string | null>(viewKey);
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    const key = keyRef.current;
    const seq = ++seqRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const opts: RequestInit = { cache: "no-store", signal: ctrl.signal };
    let m: FetchJsonResult<ModelData>, l: FetchJsonResult<MapsData>, v: FetchJsonResult<ViewData> | null;
    try {
      [m, l, v] = await Promise.all([
        fetchJson<ModelData>("/api/topology/model", opts),
        fetchJson<MapsData>("/api/topology/maps", opts),
        key ? fetchJson<ViewData>(`/api/topology/maps/${encodeURIComponent(key)}`, opts) : Promise.resolve(null),
      ]);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      throw e;
    }
    if (seq !== seqRef.current) return; // nel frattempo è partito un caricamento più nuovo
    const fail = (message: string) => {
      const f = afterLoadFailure(hasDataRef.current, message, Date.now());
      if (f.kind === "error") setError(f.message);
      else setRefreshError({ message: f.message, at: f.at });
    };
    if (!m.ok) return fail(m.message);
    if (!l.ok) return fail(l.message);
    // Una mappa cancellata da un altro: niente errore, la pagina ripiega su un'altra.
    if (v && !v.ok && !(v.status === 404 && key !== "auto")) return fail(v.message);
    hasDataRef.current = true;
    setError(null);
    setRefreshError(null);
    setData({ model: m.data, maps: l.data, view: v && v.ok ? v.data : null, viewKey: key });
  }, []);

  useEffect(() => {
    keyRef.current = viewKey;
    void reload();
  }, [viewKey, reload]);

  useEffect(() => {
    timerRef.current = setInterval(() => void reload(), REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      abortRef.current?.abort();
    };
  }, [reload]);

  /** Una scrittura: l'errore si vede (toast col messaggio del server), poi si ricarica. */
  const send = useCallback(
    async <T,>(url: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<FetchJsonResult<T>> => {
      const r = await fetchJson<T>(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!r.ok) toast.error(`Errore: ${r.message}`);
      else await reload();
      return r;
    },
    [reload],
  );

  return { data, error, refreshError, reload, send };
}

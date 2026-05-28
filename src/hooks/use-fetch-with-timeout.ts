"use client";

/**
 * Helper fetch con AbortController + timeout (v0.2.635, audit B1).
 *
 * Risolve il pattern endemico nei client component DA-IPAM:
 *   fetch("/api/…").then(r => r.json()).then(setX).catch(() => setX([]))
 * → senza timeout: API stalled → spinner eterno, .catch silenzioso, utente al buio.
 *
 * Uso:
 *   const data = await fetchWithTimeout("/api/hosts", { timeoutMs: 12_000 });
 *   if (!data.ok) toast.error(data.error); else setHosts(data.value);
 *
 * Restituisce un Result tagged invece di throw: l'aborted vs network vs HTTP
 * error sono distinguibili senza wrapping in try/catch ovunque.
 */

export interface FetchResultOk<T> { ok: true; value: T; status: number }
export interface FetchResultErr { ok: false; error: string; status?: number; reason: "abort" | "network" | "timeout" | "http" | "parse" }
export type FetchResult<T> = FetchResultOk<T> | FetchResultErr;

interface Opts extends Omit<RequestInit, "signal"> {
  /** Timeout in ms. Default 12 secondi. */
  timeoutMs?: number;
  /** Signal esterno opzionale (es. cancellation on unmount tramite useEffect). */
  externalSignal?: AbortSignal;
  /** Se true (default), parse il body come JSON. Se false, ritorna Response. */
  parseJson?: boolean;
}

/**
 * Fetch wrapper con AbortController + timeout. Errore mai throw — sempre
 * tagged result. Combina facilmente con `if (!r.ok) toast.error(r.error)`.
 */
export async function fetchWithTimeout<T = unknown>(url: string, opts: Opts = {}): Promise<FetchResult<T>> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  // Compose con signal esterno (es. unmount): se il chiamante aborta, propaga.
  const onExternalAbort = () => ctrl.abort();
  opts.externalSignal?.addEventListener("abort", onExternalAbort);

  try {
    const { timeoutMs: _t, externalSignal: _e, parseJson: _p, ...restInit } = opts;
    void _t; void _e; void _p;
    const r = await fetch(url, { ...restInit, signal: ctrl.signal });
    if (!r.ok) {
      let errMsg = `HTTP ${r.status}`;
      try {
        const errBody = await r.json();
        if (errBody?.error && typeof errBody.error === "string") errMsg = errBody.error;
      } catch { /* keep generic */ }
      return { ok: false, error: errMsg, status: r.status, reason: "http" };
    }
    if (opts.parseJson === false) {
      return { ok: true, value: r as unknown as T, status: r.status };
    }
    try {
      const value = (await r.json()) as T;
      return { ok: true, value, status: r.status };
    } catch {
      return { ok: false, error: "Risposta JSON non valida", status: r.status, reason: "parse" };
    }
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === "AbortError";
    if (isAbort) {
      // Distinguere abort esterno (unmount, navigazione) da timeout interno:
      // se externalSignal è abortato, è abort utente; altrimenti timeout interno.
      if (opts.externalSignal?.aborted) return { ok: false, error: "Richiesta annullata", reason: "abort" };
      return { ok: false, error: `Timeout dopo ${Math.round(timeoutMs / 1000)}s`, reason: "timeout" };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, reason: "network" };
  } finally {
    clearTimeout(timer);
    opts.externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

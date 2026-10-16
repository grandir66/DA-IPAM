// Le chiamate dei dialoghi «Unisci con…» e «Separa…» (piano 2026-10-16, Task 4). Solo HTTP e tipi: nessun import del server.
// Un errore (403, 409, 500, rete) torna come errore, mai come «nessun risultato».
import { fetchJson, type FetchJsonResult } from "@/lib/fetch-json";
import type {
  AnteprimaSeparazione, AnteprimaUnione, CandidatiUnione, CorpoSeparazione, CorpoUnione, StatoDelNodo,
} from "@/lib/topology/unioni-tipi";

const JSON_HEADERS = { "Content-Type": "application/json" };
const BASE = "/api/topology/unioni";

export function caricaStato(oggetto: string): Promise<FetchJsonResult<StatoDelNodo>> {
  return fetchJson<StatoDelNodo>(`${BASE}?oggetto=${encodeURIComponent(oggetto)}`, { cache: "no-store" });
}

/** Una richiesta annullata (`signal`) rilancia l'AbortError: il chiamante la ignora. */
export function cercaCandidati(da: string, q: string, signal?: AbortSignal): Promise<FetchJsonResult<CandidatiUnione>> {
  return fetchJson<CandidatiUnione>(`${BASE}/candidati?da=${encodeURIComponent(da)}&q=${encodeURIComponent(q)}`, { cache: "no-store", signal });
}

/** `applica: false` = anteprima, non scrive; `applica: true` = scrive. */
export function chiediUnione(corpo: CorpoUnione): Promise<FetchJsonResult<AnteprimaUnione>> {
  return fetchJson<AnteprimaUnione>(BASE, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(corpo) });
}

export function chiediSeparazione(corpo: CorpoSeparazione): Promise<FetchJsonResult<AnteprimaSeparazione>> {
  return fetchJson<AnteprimaSeparazione>(`${BASE}/separa`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(corpo) });
}

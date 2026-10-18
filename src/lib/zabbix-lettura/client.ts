/**
 * Il client dell'API di lettura del centro (passo 7.4): percorsi, interpretazione
 * degli esiti HTTP, validazione, controllo del cliente.
 *
 * Il controllo che regge tutto: ogni risposta 200 porta `codcli`, e deve essere quello
 * di questa istanza. Una risposta per un altro cliente è un guasto («cliente
 * errato») e nessun suo dato arriva al pannello, neanche in parte.
 *
 * Senza import lato server: il trasporto si passa (vero in `trasporto.ts`, finto
 * nelle prove).
 */
import type { z } from "zod";
import {
  ErroreApi,
  LIMITE_HOST_PAGINA,
  MAX_HOSTID_VALORI,
  RispostaCliente,
  RispostaHost,
  RispostaProblemi,
  RispostaValori,
  TESTO_CODICE_ERRORE,
  type HostDelCentro,
  type RottaLettura,
} from "./api";
import { ErroreLettura, type Trasporto } from "./trasporto";

export const PERCORSO_API = "/api/lettura/v1/";

/** Pagine di host lette al massimo in una lettura: 20 × 500 = 10 000 host. */
export const MAX_PAGINE_HOST = 20;

/**
 * La base del centro come la si scrive in configurazione: `https://centro/wizard`.
 * Si accetta anche con il percorso dell'API in fondo, e lo si toglie.
 */
export function normalizzaBase(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/api\/lettura\/v1$/, "");
}

export function percorsoRotta(base: URL, rotta: RottaLettura, query: Record<string, string> = {}): string {
  const radice = base.pathname.replace(/\/+$/, "");
  const q = new URLSearchParams(query).toString();
  return `${radice}${PERCORSO_API}${rotta}${q ? `?${q}` : ""}`;
}

function secondiRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v.trim());
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

export interface Lettore {
  base: URL;
  codcli: string;
  trasporto: Trasporto;
}

/**
 * GET di una rotta, validata col suo schema. Lancia `ErroreLettura` per rete,
 * certificato, tempo, HTTP diverso da 200, JSON o forma non validi, cliente errato.
 */
export async function leggiRotta<S extends z.ZodType>(
  l: Lettore,
  rotta: RottaLettura,
  query: Record<string, string>,
  schema: S,
): Promise<z.infer<S>> {
  const r = await l.trasporto(percorsoRotta(l.base, rotta, query));
  let corpo: unknown = null;
  try {
    corpo = r.body ? JSON.parse(r.body) : null;
  } catch {
    corpo = null;
  }
  if (r.status !== 200) {
    const e = ErroreApi.safeParse(corpo);
    const codice = e.success ? e.data.codice : undefined;
    const testo =
      (codice && TESTO_CODICE_ERRORE[codice]) ??
      (r.status >= 500 ? `il centro ha risposto con un errore (HTTP ${r.status})` : `richiesta rifiutata dal centro (HTTP ${r.status})`);
    throw new ErroreLettura("http", testo, {
      status: r.status,
      codice,
      riprovaTraS: secondiRetryAfter(r.retryAfter),
    });
  }
  if (!corpo || typeof corpo !== "object") {
    throw new ErroreLettura("risposta", "risposta del centro non leggibile (non è JSON)");
  }
  // Prima di tutto il cliente: una risposta per un altro cliente non si guarda nemmeno.
  const codcli = (corpo as { codcli?: unknown }).codcli;
  if (typeof codcli === "string" && codcli.trim() !== l.codcli) {
    throw new ErroreLettura("cliente_errato", "cliente errato: il centro ha risposto per un altro codice cliente");
  }
  const p = schema.safeParse(corpo);
  if (!p.success) {
    throw new ErroreLettura("risposta", `risposta del centro di forma inattesa (${rotta})`);
  }
  return p.data;
}

export interface LetturaCentro {
  cliente: RispostaCliente;
  host: HostDelCentro[];
  problemi: RispostaProblemi;
  /** La lettura più vecchia fra quelle servite (s) e se una di loro era dalla cache del centro. */
  etaS: number;
  vecchio: boolean;
}

/** Tutto ciò che serve al pannello tranne i valori: cliente, tutti gli host, problemi. */
export async function leggiCentro(l: Lettore): Promise<LetturaCentro> {
  const cliente = await leggiRotta(l, "cliente", {}, RispostaCliente);
  const host: HostDelCentro[] = [];
  let dopo: string | null = null;
  let etaS = cliente.eta_s;
  let vecchio = cliente.vecchio;
  for (let pagina = 0; ; pagina++) {
    if (pagina >= MAX_PAGINE_HOST) {
      // Elenco incompleto: l'abbinamento direbbe «perso» a host che ci sono. Meglio un guasto.
      throw new ErroreLettura("risposta", `più di ${MAX_PAGINE_HOST * LIMITE_HOST_PAGINA} host: elenco non letto per intero`);
    }
    const q: Record<string, string> = { limite: String(LIMITE_HOST_PAGINA) };
    if (dopo) q.dopo = dopo;
    const r: RispostaHost = await leggiRotta(l, "host", q, RispostaHost);
    host.push(...r.host);
    etaS = Math.max(etaS, r.eta_s);
    vecchio = vecchio || r.vecchio;
    if (!r.successivo) break;
    if (r.successivo === dopo) throw new ErroreLettura("risposta", "paginazione degli host ferma sulla stessa pagina");
    dopo = r.successivo;
  }
  const problemi = await leggiRotta(l, "problemi", { limite: "200" }, RispostaProblemi);
  etaS = Math.max(etaS, problemi.eta_s);
  vecchio = vecchio || problemi.vecchio;
  return { cliente, host, problemi, etaS, vecchio };
}

/** Ultimi valori per al più 50 host (§3). */
export async function leggiValori(l: Lettore, hostids: string[]): Promise<z.infer<typeof RispostaValori>> {
  const ids = [...new Set(hostids)].slice(0, MAX_HOSTID_VALORI);
  return leggiRotta(l, "valori", { hostid: ids.join(",") }, RispostaValori);
}

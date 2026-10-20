/**
 * Il blocco `edge` del segnale verso DA-Link (sonde integrate, spec DA-Vul-can
 * 2026-10-20 §8.2): lo stato che la sonda locale dichiara su `/api/v1/health` (§8.1),
 * copiato a LISTA BIANCA. DA-IPAM non interpreta: porta i campi del contratto e basta.
 *
 * Regole (le stesse di `aggiornamentoPerSegnale`):
 * - solo i campi della §8.1; tutto il resto della risposta resta qui (anche `scanner_id`,
 *   il nome dell'istanza, che può contenere il nome del cliente);
 * - i valori a elenco chiuso fuori elenco diventano null: mai un testo libero, che può
 *   portare percorsi, nomi o indirizzi della rete del cliente;
 * - versioni e commit solo coi caratteri di una versione, tagliati come in `LIMITI`;
 *   date solo nella forma ISO, tagliate a `LIMITI.data`;
 * - la sonda vecchia (solo `ok`/`version`) risponde ma non dichiara niente: `version` NON
 *   diventa `versione_vera` (è il pyproject: PX-NAS dichiarava 0.1.0, diagnosi del 19/10);
 * - sonda muta o risposta che non è un oggetto JSON: `raggiungibile: false` e tutto il
 *   resto null. Un errore di trasporto non è un «ok».
 *
 * Modulo senza dipendenze: lo usa il costruttore del segnale, la lettura sta in
 * `edge-sonda.ts`. DA-Link (`dalink/segnale.py`, `extra="ignore"`) scarta il campo finché
 * non lo conosce: il segnale non prende 422 per questo.
 */
import { LIMITI } from "./segnale-limiti";

/** Ciò che ha dato la lettura di `/api/v1/health` (vedi `edge-sonda.ts`). */
export type LetturaEdge = { raggiungibile: false } | { raggiungibile: true; health: unknown };

export const MOTIVI_EDGE = ["dns", "tls", "401", "http", "rete", "configurazione"] as const;
export const ESITI_HUB_EDGE = ["ok", "errore"] as const;
export const ESITI_AGGIORNAMENTO_EDGE = ["riuscito", "fallito", "interrotto", "in_corso"] as const;
export const FASI_EDGE = ["scarica", "verifica", "prepara", "scambio", "riavvio", "salute", "ritorno", "avvio", "fine"] as const;
export const CONTROLLI_EDGE = [
  "gia_aggiornato",
  "attesa_versione",
  "avviato",
  "hub_non_raggiungibile",
  "hub_non_configurato",
  "manifesto_non_valido",
  "spazio_insufficiente",
  "tentativi_esauriti",
  "spento",
] as const;
export const MODALITA_EDGE = ["standalone", "container"] as const;

type Di<T extends readonly string[]> = T[number];

export interface HubEdge {
  esito: Di<typeof ESITI_HUB_EDGE> | null;
  motivo: Di<typeof MOTIVI_EDGE> | null;
  ultimo_battito_il: string | null;
  ultimo_ok_il: string | null;
  ultimo_errore_il: string | null;
  ultimo_errore_motivo: Di<typeof MOTIVI_EDGE> | null;
  errori_consecutivi: number | null;
}

export interface AggiornamentoEdge {
  esito: Di<typeof ESITI_AGGIORNAMENTO_EDGE> | null;
  fase: Di<typeof FASI_EDGE> | null;
  commit_avviato: string | null;
  commit_tentato: string | null;
  tentativi: number | null;
  tentativo_iniziato_il: string | null;
  tentativo_finito_il: string | null;
  ultimo_successo_il: string | null;
  ultimo_controllo: Di<typeof CONTROLLI_EDGE> | null;
  ultimo_controllo_il: string | null;
  controllo_motivo: Di<typeof MOTIVI_EDGE> | null;
  modalita: Di<typeof MODALITA_EDGE> | null;
}

export interface DiscoEdge {
  total_gb: number | null;
  free_gb: number | null;
}

export interface EdgeSegnale {
  raggiungibile: boolean;
  versione_vera: string | null;
  hub: HubEdge | null;
  aggiornamento: AggiornamentoEdge | null;
  disco: DiscoEdge | null;
}

const NON_RAGGIUNGIBILE: EdgeSegnale = { raggiungibile: false, versione_vera: null, hub: null, aggiornamento: null, disco: null };

/** La forma delle date della sonda (`2026-10-20T08:00:00Z`), con frazioni e fuso facoltativi. */
const DATA_ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})?$/;
/** I caratteri di una versione o di un commit (gli stessi che la sonda accetta per le sue). */
const VERSIONE = /^[A-Za-z0-9.+_-]+$/;
/** Oltre un milione di GB non è un disco: è un numero storto. */
const MAX_GB = 1_000_000;

function oggetto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function inElenco<T extends readonly string[]>(elenco: T, v: unknown): Di<T> | null {
  return typeof v === "string" && (elenco as readonly string[]).includes(v) ? (v as Di<T>) : null;
}

function versione(v: unknown, n: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.slice(0, n);
  return t && VERSIONE.test(t) ? t : null;
}

function data(v: unknown): string | null {
  return typeof v === "string" && v.length <= LIMITI.data && DATA_ISO.test(v) ? v : null;
}

function intero(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

function gb(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_GB ? v : null;
}

function hubPerSegnale(v: unknown): HubEdge | null {
  const h = oggetto(v);
  if (!h) return null;
  return {
    esito: inElenco(ESITI_HUB_EDGE, h.esito),
    motivo: inElenco(MOTIVI_EDGE, h.motivo),
    ultimo_battito_il: data(h.ultimo_battito_il),
    ultimo_ok_il: data(h.ultimo_ok_il),
    ultimo_errore_il: data(h.ultimo_errore_il),
    ultimo_errore_motivo: inElenco(MOTIVI_EDGE, h.ultimo_errore_motivo),
    errori_consecutivi: intero(h.errori_consecutivi),
  };
}

function aggiornamentoEdgePerSegnale(v: unknown): AggiornamentoEdge | null {
  const a = oggetto(v);
  if (!a) return null;
  return {
    esito: inElenco(ESITI_AGGIORNAMENTO_EDGE, a.esito),
    fase: inElenco(FASI_EDGE, a.fase),
    commit_avviato: versione(a.commit_avviato, LIMITI.commit),
    commit_tentato: versione(a.commit_tentato, LIMITI.commit),
    tentativi: intero(a.tentativi),
    tentativo_iniziato_il: data(a.tentativo_iniziato_il),
    tentativo_finito_il: data(a.tentativo_finito_il),
    ultimo_successo_il: data(a.ultimo_successo_il),
    ultimo_controllo: inElenco(CONTROLLI_EDGE, a.ultimo_controllo),
    ultimo_controllo_il: data(a.ultimo_controllo_il),
    controllo_motivo: inElenco(MOTIVI_EDGE, a.controllo_motivo),
    modalita: inElenco(MODALITA_EDGE, a.modalita),
  };
}

function discoPerSegnale(v: unknown): DiscoEdge | null {
  const d = oggetto(v);
  if (!d) return null;
  const disco = { total_gb: gb(d.total_gb), free_gb: gb(d.free_gb) };
  // Nessun numero valido: null, mai zeri inventati.
  return disco.total_gb === null && disco.free_gb === null ? null : disco;
}

/** Dalla lettura della sonda al blocco `edge` del segnale. */
export function edgePerSegnale(l: LetturaEdge): EdgeSegnale {
  if (!l.raggiungibile) return { ...NON_RAGGIUNGIBILE };
  const h = oggetto(l.health);
  // Ha risposto qualcosa che non è lo stato della sonda (un proxy, una pagina): non è lei.
  if (!h) return { ...NON_RAGGIUNGIBILE };
  return {
    raggiungibile: true,
    versione_vera: versione(h.versione_vera, LIMITI.versione),
    hub: hubPerSegnale(h.hub),
    aggiornamento: aggiornamentoEdgePerSegnale(h.aggiornamento),
    disco: discoPerSegnale(h.disco),
  };
}

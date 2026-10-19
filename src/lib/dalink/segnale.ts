/**
 * Il segnale di vita dell'istanza verso DA-Link (tappa C1, spec NetBird §5.2, §5.3).
 *
 * Contratto (DA-Link `dalink/segnale.py`, classe `Segnale`): `codcli` (testo),
 * `nodo`, `livello` (`solo_stato` | `stato_inventario` | null), `versione`, `moduli`
 * ({testo: bool}), `salute` ({testo: testo}), `ultimo_errore` (≤500 o null),
 * `porte_netbird` ([int], ≤64), `inventario` (numeri o null), `aggiornamento`
 * (facoltativo, dal 16/10: stato dell'aggiornamento automatico, `AggiornamentoSegnale`).
 *
 * La scelta vale ALL'ORIGINE: con «solo stato», o senza scelta dichiarata, i numeri
 * dell'inventario non si leggono nemmeno (`leggiInventario` non viene chiamata). Anche
 * col livello più aperto escono solo numeri, mai l'inventario riga per riga.
 * Nessun segreto nel corpo: il token viaggia solo nell'intestazione.
 */
import type { StatoAggiornamento } from "@/lib/aggiornamento-stato";
import type { Livello } from "./stato";
import type { StatiComponenti } from "./stati-componenti";

export interface FattiIstanza {
  versione: string;
  moduli: Record<string, boolean>;
  salute: Record<string, string>;
  ultimoErrore: string | null;
  porte: number[];
  /** Stato dell'aggiornamento automatico; null se l'istanza non lo registra ancora. */
  aggiornamento?: AggiornamentoSegnale | null;
  /** Solo sulle basi modulari; null/assente = campo non mandato (DA-Link conserva). */
  statiComponenti?: StatiComponenti | null;
}

/**
 * Lo stato dell'aggiornamento nel segnale (passo 1d del piano di solidità, 16/10):
 * solo stato, mai log né messaggi d'errore, che possono contenere percorsi o nomi.
 * Contratto: `Aggiornamento` in DA-Link (`dalink/aggiornamento.py`), tutto facoltativo.
 */
export interface AggiornamentoSegnale {
  commit_avviato: string | null;
  ramo: string | null;
  esito: "riuscito" | "fallito" | "interrotto" | "in_corso" | null;
  fase: string | null;
  commit_tentato: string | null;
  tentativi: number | null;
  tentativo_iniziato_il: string | null;
  tentativo_finito_il: string | null;
  ultimo_successo_il: string | null;
}

export interface Inventario {
  dispositivi: number;
  reti: number;
  ultima_scansione: string | null;
  esito_scansione: string | null;
}

export interface CorpoSegnale {
  codcli: string;
  nodo: string;
  livello: Livello | null;
  versione: string;
  moduli: Record<string, boolean>;
  salute: Record<string, string>;
  ultimo_errore: string | null;
  porte_netbird: number[];
  inventario: Inventario | null;
  /** Assente (non null) quando non c'è: le istanze vecchie non lo mandano affatto. */
  aggiornamento?: AggiornamentoSegnale;
  /** Assente fuori dalle basi modulari di Deploy-Appliance. */
  stati_componenti?: StatiComponenti;
}

/** Limiti del contratto di DA-Link: oltre, il segnale prende 422. */
export const LIMITI = {
  ultimoErrore: 500,
  porte: 64,
  versione: 64,
  ultimaScansione: 32,
  esitoScansione: 64,
  commit: 64,
  ramo: 64,
  fase: 32,
  data: 40,
} as const;

function taglia(v: string | null, n: number): string | null {
  return v == null ? null : v.slice(0, n);
}

function porteValide(porte: number[]): number[] {
  const s = new Set(porte.filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535));
  return [...s].sort((a, b) => a - b).slice(0, LIMITI.porte);
}

function numero(n: number): number {
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Dallo stato su file (`data/aggiornamento.json`) al campo del segnale; null se è vuoto. */
export function aggiornamentoPerSegnale(stato: StatoAggiornamento, ramo: string | null): AggiornamentoSegnale | null {
  const t = stato.ultimoTentativo;
  if (!stato.commitAvviato && !t && !stato.ultimoSuccesso) return null;
  return {
    commit_avviato: taglia(stato.commitAvviato, LIMITI.commit),
    ramo: taglia(ramo, LIMITI.ramo),
    // DA-Link conosce quattro esiti e scarta il campo intero se ne arriva un altro: la
    // build pronta col servizio fermo, per lui, è un giro fermato prima dell'avvio (19/10, F03).
    esito: t?.esito === "pronto_non_avviato" ? "interrotto" : (t?.esito ?? null),
    fase: t?.esito === "pronto_non_avviato" ? "avvio" : taglia(t?.fase ?? null, LIMITI.fase),
    commit_tentato: taglia(t?.commit ?? null, LIMITI.commit),
    tentativi: t?.tentativi != null && t.tentativi >= 0 ? Math.floor(t.tentativi) : null,
    tentativo_iniziato_il: taglia(t?.iniziatoIl ?? null, LIMITI.data),
    tentativo_finito_il: taglia(t?.finitoIl ?? null, LIMITI.data),
    ultimo_successo_il: taglia(stato.ultimoSuccesso?.il ?? null, LIMITI.data),
  };
}

export function costruisciSegnale(
  cfg: { codcli: string; nodo: string },
  livello: Livello | null,
  fatti: FattiIstanza,
  leggiInventario: () => Inventario | null,
): CorpoSegnale {
  let inventario: Inventario | null = null;
  if (livello === "stato_inventario") {
    const inv = leggiInventario();
    inventario = inv
      ? {
          dispositivi: numero(inv.dispositivi),
          reti: numero(inv.reti),
          ultima_scansione: taglia(inv.ultima_scansione, LIMITI.ultimaScansione),
          esito_scansione: taglia(inv.esito_scansione, LIMITI.esitoScansione),
        }
      : null;
  }
  return {
    codcli: String(cfg.codcli),
    nodo: cfg.nodo,
    livello,
    versione: fatti.versione.slice(0, LIMITI.versione),
    moduli: { ...fatti.moduli },
    salute: { ...fatti.salute },
    ultimo_errore: taglia(fatti.ultimoErrore, LIMITI.ultimoErrore),
    porte_netbird: porteValide(fatti.porte),
    inventario,
    ...(fatti.aggiornamento ? { aggiornamento: { ...fatti.aggiornamento } } : {}),
    ...(fatti.statiComponenti ? { stati_componenti: { ...fatti.statiComponenti } } : {}),
  };
}

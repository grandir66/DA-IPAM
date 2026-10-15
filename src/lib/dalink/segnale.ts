/**
 * Il segnale di vita dell'istanza verso DA-Link (tappa C1, spec NetBird §5.2, §5.3).
 *
 * Contratto (DA-Link `dalink/segnale.py`, classe `Segnale`): `codcli` (testo),
 * `nodo`, `livello` (`solo_stato` | `stato_inventario` | null), `versione`, `moduli`
 * ({testo: bool}), `salute` ({testo: testo}), `ultimo_errore` (≤500 o null),
 * `porte_netbird` ([int], ≤64), `inventario` (numeri o null).
 *
 * La scelta vale ALL'ORIGINE: con «solo stato», o senza scelta dichiarata, i numeri
 * dell'inventario non si leggono nemmeno (`leggiInventario` non viene chiamata). Anche
 * col livello più aperto escono solo numeri, mai l'inventario riga per riga.
 * Nessun segreto nel corpo: il token viaggia solo nell'intestazione.
 */
import type { Livello } from "./stato";

export interface FattiIstanza {
  versione: string;
  moduli: Record<string, boolean>;
  salute: Record<string, string>;
  ultimoErrore: string | null;
  porte: number[];
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
}

/** Limiti del contratto di DA-Link: oltre, il segnale prende 422. */
export const LIMITI = {
  ultimoErrore: 500,
  porte: 64,
  versione: 64,
  ultimaScansione: 32,
  esitoScansione: 64,
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
  };
}

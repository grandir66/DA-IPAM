/**
 * Limiti del contratto di DA-Link sul segnale (`dalink/segnale.py`, `dalink/aggiornamento.py`):
 * oltre, il segnale prende 422. In un file a sé perché li usano sia il costruttore del
 * segnale (`segnale.ts`) sia il blocco della sonda (`edge-segnale.ts`), senza import circolari.
 */
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

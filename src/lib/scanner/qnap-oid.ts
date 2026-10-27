/**
 * OID QNAP letti via SNMP (walk del collaudo QGD-1602P, 22/10/2026).
 * `…24681.1.2.1/.2/.3` NON sono modello/firmware/seriale: sono CPU %, memoria totale, memoria libera.
 * Il firmware via SNMP non è stato trovato: resta assente, mai preso da un altro OID.
 */
export const QNAP_OID = {
  model: ["1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.3.1", "1.3.6.1.4.1.55062.1.12.3.0"],
  serial: ["1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.4.1"],
  name: "1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.6.1",
  temperature: "1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.7.1",
  fanTable: "1.3.6.1.4.1.55062.1.12.9.1",
} as const;

/** Valori che sono una misura (CPU %, memoria in MB/GB, temperatura, giri) e non un nome/versione/seriale. */
const MISURA = /^[-+]?\d[\d.,]*\s*(%|[KMGT]i?B|°?\s?[CF]|rpm)$/i;

export function eUnaMisura(valore: string): boolean {
  return MISURA.test(valore.trim());
}

/** Per i campi di identità (modello, firmware, seriale): testo non vuoto che non è una misura, altrimenti `null`. */
export function identitaQnap(valore: string | null | undefined): string | null {
  const t = (valore ?? "").trim();
  return t && !eUnaMisura(t) ? t : null;
}

/** Delimitatore CSV unificato in tutta l'app (compatibile con Excel in locale italiana). */
export const CSV_DELIMITER = ";" as const;

/**
 * Escape RFC 4180: virgolette se il valore contiene `;`, `"` o a capo.
 * Un valore che comincia con `=`, `+`, `-`, `@`, tab o a capo Excel lo apre come
 * formula (CSV injection): gli si antepone un apostrofo, che Excel non mostra.
 * I numeri, anche negativi, restano numeri.
 */
export function escapeCsvField(value: string | number | boolean | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const s = /^[=+\-@\t\r]/.test(raw) && !/^[+-]?\d+([.,]\d+)?$/.test(raw) ? `'${raw}` : raw;
  const mustQuote =
    s.includes(CSV_DELIMITER) || s.includes('"') || s.includes("\n") || s.includes("\r");
  if (mustQuote) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Una riga CSV con delimitatore `;`. */
export function joinCsvRow(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map((c) => escapeCsvField(c)).join(CSV_DELIMITER);
}

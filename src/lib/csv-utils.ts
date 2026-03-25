/** Delimitatore CSV unificato in tutta l'app (compatibile con Excel in locale italiana). */
export const CSV_DELIMITER = ";" as const;

/** Escape RFC 4180: virgolette se il valore contiene `;`, `"` o a capo. */
export function escapeCsvField(value: string | number | boolean | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
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

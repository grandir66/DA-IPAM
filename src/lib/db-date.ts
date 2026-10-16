/**
 * I timestamp scritti da SQLite con `datetime('now')` sono UTC ma senza fuso
 * ("2026-10-12 08:00:00"): `new Date()` li legge come ora LOCALE, e le pagine
 * mostravano orari 1-2 ore indietro (difetto UI-2, analisi 2026-10-12); Safari
 * non li legge affatto ("Invalid Date"). Il database non salva mai ora locale:
 * ogni data-ora senza fuso è UTC.
 *
 * `parseDbDate` legge quel formato come UTC e per tutto il resto (ISO con `Z` o
 * offset, sola data, numeri, Date, null) si comporta esattamente come
 * `new Date(x)`, così può sostituirlo ovunque.
 */
const SQL_SENZA_FUSO = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

export function parseDbDate(value: string | number | Date | null | undefined): Date {
  if (typeof value === "string") {
    const m = SQL_SENZA_FUSO.exec(value.trim());
    if (m) return new Date(`${m[1]}T${m[2]}Z`);
  }
  return new Date(value as string | number | Date);
}

/**
 * Fuso degli utenti. Serve alle pagine rese sul server: la VM di produzione è in
 * UTC, e `toLocaleString()` senza `timeZone` scriverebbe l'ora UTC.
 */
export const FUSO_UTENTI = "Europe/Rome";

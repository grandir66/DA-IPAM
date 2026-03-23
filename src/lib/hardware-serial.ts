/**
 * Validazione euristica per numeri di serie hardware da SNMP/SSH.
 * Evita di salvare placeholder o valori privi di significato.
 */

const INVALID_SERIALS = new Set([
  "N/A",
  "NA",
  "NONE",
  "UNKNOWN",
  "NULL",
  "0",
  "00",
  "000",
  "0000",
  "TBD",
  "EMPTY",
]);

/**
 * Restituisce true se la stringa è un candidato seriale plausibile (non solo placeholder).
 */
export function isPlausibleHardwareSerial(raw: string): boolean {
  const s = raw.trim();
  if (s.length < 4 || s.length > 96) return false;
  const up = s.toUpperCase();
  if (INVALID_SERIALS.has(up)) return false;
  if (/^(0+|-+|\.+)$/.test(s)) return false;
  if (/^n\/?a$/i.test(s)) return false;
  if (/to be filled|default string|not specified|no serial|invalid/i.test(s)) return false;
  if (!/[0-9A-Za-z]/.test(s)) return false;
  return true;
}

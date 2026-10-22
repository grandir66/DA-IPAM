/**
 * Durate di RouterOS in secondi. Foglia pura (nessun DB, nessuna rete): la usano `router-client.ts`, che la
 * riesporta com'era, `mikrotik-scheda.ts` e il collector `mikrotik-routeros`.
 */

/**
 * v0.2.659: converte una durata RouterOS (es. `1w2d3h4m5s`, `01:23:45`, `30s`)
 * in numero di secondi. Necessaria per derivare timestamps assoluti da campi
 * relativi tipo `last-seen=1w2d` o `expires-after=23h59m`.
 *
 * Ritorna null se l'input non è parsabile.
 */
export function parseRouterOsDurationSeconds(input: string | null | undefined): number | null {
  if (!input) return null;
  const s = input.trim();
  if (!s || s === "never" || s === "00:00:00") return s === "00:00:00" ? 0 : null;

  // Formato `HH:MM:SS` (es. `01:23:45`)
  const hms = s.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (hms) return parseInt(hms[1], 10) * 3600 + parseInt(hms[2], 10) * 60 + parseInt(hms[3], 10);

  // Formato `1w2d3h4m5s` (parti opzionali, in qualsiasi combinazione)
  const weeks  = /(\d+)w/.exec(s)?.[1];
  const days   = /(\d+)d/.exec(s)?.[1];
  const hours  = /(\d+)h/.exec(s)?.[1];
  const mins   = /(\d+)m(?!s)/.exec(s)?.[1];  // m ma non ms
  const secs   = /(\d+)s/.exec(s)?.[1];
  const ms     = /(\d+)ms/.exec(s)?.[1];

  let total = 0;
  let matched = false;
  if (weeks) { total += parseInt(weeks, 10) * 7 * 86400; matched = true; }
  if (days)  { total += parseInt(days,  10) * 86400;     matched = true; }
  if (hours) { total += parseInt(hours, 10) * 3600;      matched = true; }
  if (mins)  { total += parseInt(mins,  10) * 60;        matched = true; }
  if (secs)  { total += parseInt(secs,  10);             matched = true; }
  if (ms)    { total += parseInt(ms,    10) / 1000;      matched = true; }

  return matched ? total : null;
}

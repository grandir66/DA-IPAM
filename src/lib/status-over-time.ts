import { parseDbDate } from "./db-date";

/**
 * Serie del grafico "Stato host nel tempo" (dashboard).
 *
 * Prima il grafico contava, ora per ora, solo gli host controllati DENTRO
 * quell'ora e metteva tutti gli altri fra gli "Sconosciuti". Con il controllo
 * degli host ogni 3 ore (DTS, ottobre 2026) la curva andava su e giù: picco
 * all'ora del controllo, quasi tutti sconosciuti e Health al 3% nelle due ore
 * dopo, anche se nessun host aveva cambiato stato.
 *
 * Qui ogni host porta avanti il suo ultimo stato noto finché non è più vecchio
 * di `staleAfterHours` (24 h): oltre, torna "sconosciuto". La serie è continua
 * (un punto per ogni ora o giorno, anche senza controlli) e la salute si calcola
 * sugli host di stato noto, così chi non viene mai controllato non la abbassa;
 * dove nessuno stato è noto vale null, e la linea ha un buco invece di uno 0%.
 */
export interface StatusObservation {
  host_id: number;
  status: string;
  /** UTC, formato SQLite ("2026-10-12 08:00:00") o ISO. */
  checked_at: string;
}

export interface StatusPoint {
  /** Inizio del periodo in UTC senza fuso: "2026-10-12T16:00:00" (ora) o "2026-10-12T00:00:00" (giorno). */
  time: string;
  online: number;
  offline: number;
  unknown: number;
  total: number;
  /** % online sugli host di stato noto; null se nessuno stato è noto (buco nella linea). */
  health_pct: number | null;
}

const ORA_MS = 3_600_000;
const GIORNO_MS = 24 * ORA_MS;

/** Oltre le 48 ore il grafico va a giorni, come prima. */
export function statusBucketMs(hours: number): number {
  return hours <= 48 ? ORA_MS : GIORNO_MS;
}

/** Inizio del primo periodo mostrato per una finestra di `hours` ore. */
export function statusWindowStartMs(hours: number, nowMs: number): number {
  const b = statusBucketMs(hours);
  return Math.floor((nowMs - hours * ORA_MS) / b) * b;
}

function etichetta(ms: number, bucketMs: number): string {
  const iso = new Date(ms).toISOString();
  return bucketMs === ORA_MS ? `${iso.slice(0, 13)}:00:00` : `${iso.slice(0, 10)}T00:00:00`;
}

export function buildStatusSeries(opts: {
  hours: number;
  nowMs: number;
  totalHosts: number;
  /** Controlli dalla finestra (e fino a `staleAfterHours` prima), in qualsiasi ordine. */
  observations: StatusObservation[];
  staleAfterHours?: number;
}): StatusPoint[] {
  const bucketMs = statusBucketMs(opts.hours);
  const staleMs = (opts.staleAfterHours ?? 24) * ORA_MS;
  const inizio = statusWindowStartMs(opts.hours, opts.nowMs);
  const ultimo = Math.floor(opts.nowMs / bucketMs) * bucketMs;

  const obs = opts.observations
    .map((o) => ({ id: o.host_id, status: o.status, t: parseDbDate(o.checked_at).getTime() }))
    .filter((o) => Number.isFinite(o.t))
    .sort((a, b) => a.t - b.t);
  // nessun controllo: serie vuota, il grafico mostra "Nessun dato disponibile"
  if (obs.length === 0) return [];

  const stato = new Map<number, { status: string; t: number }>();
  const serie: StatusPoint[] = [];
  let i = 0;
  for (let s = inizio; s <= ultimo; s += bucketMs) {
    // lo stato del periodo è quello alla sua fine (per il periodo in corso: adesso)
    const fine = Math.min(s + bucketMs, opts.nowMs + 1);
    while (i < obs.length && obs[i].t < fine) {
      stato.set(obs[i].id, { status: obs[i].status, t: obs[i].t });
      i++;
    }
    let online = 0;
    let offline = 0;
    for (const v of stato.values()) {
      if (v.t < fine - staleMs) continue;
      if (v.status === "online") online++;
      else if (v.status === "offline") offline++;
    }
    const noti = online + offline;
    serie.push({
      time: etichetta(s, bucketMs),
      online,
      offline,
      unknown: Math.max(0, opts.totalHosts - noti),
      total: opts.totalHosts,
      health_pct: noti > 0 ? Math.round((online / noti) * 100) : null,
    });
  }
  return serie;
}

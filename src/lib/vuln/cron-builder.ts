export type Frequency = "daily" | "weekly" | "monthly";

export interface ScheduleInput {
  frequency: Frequency;
  at: string; // "HH:MM"
  daysOfWeek?: number[]; // 0=Dom..6=Sab
  dayOfMonth?: number; // 1..28
}

function hhmm(at: string): { h: number; m: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!match) throw new Error(`orario non valido: ${at}`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) throw new Error(`orario fuori range: ${at}`);
  return { h, m };
}

/** Builder → cron 5-field (min hour dom month dow). */
export function buildCron(s: ScheduleInput): string {
  const { h, m } = hhmm(s.at);
  if (s.frequency === "daily") return `${m} ${h} * * *`;
  if (s.frequency === "weekly") {
    const dows = (s.daysOfWeek && s.daysOfWeek.length ? s.daysOfWeek : [1]).slice().sort((a, b) => a - b);
    return `${m} ${h} * * ${dows.join(",")}`;
  }
  const dom = s.dayOfMonth && s.dayOfMonth >= 1 && s.dayOfMonth <= 28 ? s.dayOfMonth : 1;
  return `${m} ${h} ${dom} * *`;
}

const DOW_IT = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];

/** Anteprima leggibile in italiano. */
export function describeCron(s: ScheduleInput): string {
  const at = s.at.trim();
  if (s.frequency === "daily") return `Ogni giorno alle ${at}`;
  if (s.frequency === "weekly") {
    const days = (s.daysOfWeek && s.daysOfWeek.length ? s.daysOfWeek : [1]).map((d) => DOW_IT[d]).join("/");
    return `Ogni ${days} alle ${at}`;
  }
  return `Ogni ${s.dayOfMonth ?? 1} del mese alle ${at}`;
}

/** Nome job/report sicuro: niente spazi, token con `_`, parole con `-`, solo [A-Za-z0-9._-]. */
export function slugifyJobName(parts: string[]): string {
  const slug = parts
    .map((p) =>
      (p ?? "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "") // accenti
        .trim()
        .replace(/\//g, "-")
        .replace(/\s+/g, "-")
        .replace(/[^A-Za-z0-9._-]/g, ""),
    )
    .filter((p) => p.length > 0)
    .join("_");
  return slug.length > 0 ? slug : "scan";
}

/** Intervallo preset più vicino per il fallback edge (no cron support). */
export function nearestIntervalForFrequency(f: Frequency): number {
  if (f === "daily") return 1440;
  return 10080; // weekly + monthly → preset settimanale
}

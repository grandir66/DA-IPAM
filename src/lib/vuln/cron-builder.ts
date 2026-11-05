import type { EdgeScanProfile, EdgeTargetingMode } from "@/lib/vuln/edge-subnet-bridge";

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

/**
 * Scansione a finestra (05/11/2026): una fascia oraria in ora italiana, nei giorni scelti, in cui la
 * sonda fa un gruppo di IP alla volta. Non è un cron: `giorni` è 0=domenica…6=sabato.
 */
export interface FinestraInput {
  enabled: boolean;
  giorni: number[];
  dalle: string; // "HH:MM", ora italiana
  alle: string; // "HH:MM"; se non viene dopo «dalle» la fascia passa la mezzanotte
  ripeti: "mese" | "settimana";
  ipPerGruppo: number; // 1..20
  tentativi: number; // 1..10
  profile: EdgeScanProfile;
  targetingMode: EdgeTargetingMode;
  assessmentEnabled?: boolean;
  /** Id già controllato sull'edge (`resolveAssessmentForNetwork`). */
  assessmentProfileId?: string | null;
}

/** Giorni scritti dal lunedì (come li legge chi li sceglie), con 0=domenica in coda. */
const ORDINE_GIORNI = [1, 2, 3, 4, 5, 6, 0];

/** Anteprima leggibile: «lun/mar/mer dalle 08:00 alle 20:00, ogni mese». */
export function describeFinestra(f: Pick<FinestraInput, "giorni" | "dalle" | "alle" | "ripeti">): string {
  const giorni = ORDINE_GIORNI.filter((g) => f.giorni.includes(g)).map((g) => DOW_IT[g]);
  const quando = giorni.length ? giorni.join("/") : "nessun giorno";
  const { h: hd, m: md } = hhmm(f.dalle);
  const { h: ha, m: ma } = hhmm(f.alle);
  const dalle = `${String(hd).padStart(2, "0")}:${String(md).padStart(2, "0")}`;
  const alle = `${String(ha).padStart(2, "0")}:${String(ma).padStart(2, "0")}`;
  // La fascia che passa la mezzanotte appartiene al giorno in cui comincia: lo si dice.
  const passa = ha * 60 + ma <= hd * 60 + md;
  return `${quando} dalle ${dalle} alle ${alle}${passa ? " del giorno dopo" : ""}, ogni ${f.ripeti}`;
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

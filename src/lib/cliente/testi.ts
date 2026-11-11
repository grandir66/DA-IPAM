import { FUSO_UTENTI } from "@/lib/db-date";

const MS_ORA = 3_600_000;

/**
 * «da meno di un'ora», «da 3 ore», «da 1 giorno», «da 5 giorni»;
 * oltre 7 giorni «dal 26/10/2026». Data illeggibile → «da tempo».
 */
export function daQuanto(data: Date, adesso: Date): string {
  const ms = adesso.getTime() - data.getTime();
  if (!Number.isFinite(ms)) return "da tempo";
  if (ms < MS_ORA) return "da meno di un'ora";
  const ore = Math.floor(ms / MS_ORA);
  if (ore < 24) return ore === 1 ? "da 1 ora" : `da ${ore} ore`;
  const giorni = Math.floor(ore / 24);
  if (giorni <= 7) return giorni === 1 ? "da 1 giorno" : `da ${giorni} giorni`;
  const giorno = data.toLocaleDateString("it-IT", {
    timeZone: FUSO_UTENTI,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `dal ${giorno}`;
}

/** Scarta l'insegna generica e quella che è il banner di una porta, non un sistema. */
export function sistemaPulito(s: string | null): string | null {
  const t = s?.trim();
  if (!t) return null;
  if (t === "Linux/Unix/embedded") return null;
  if (/^\d+\//.test(t)) return null;
  return t;
}

/**
 * Le porte in ascolto sulla macchina, lette da `ss -H -tulnp` (Protezione, tappa 1: sola lettura).
 * Modulo puro: chi lancia `ss` sta in `raccolta.ts`.
 */
export interface Ascolto {
  proto: "tcp" | "udp";
  /** Indirizzo su cui ascolta, senza parentesi né `%scheda`: `0.0.0.0`, `::`, `127.0.0.1`, `*`. */
  indirizzo: string;
  porta: number;
  /** La scheda a cui è legato (`0.0.0.0%lo` → `lo`): un ascolto su `lo` non esce dalla macchina. */
  scheda: string | null;
  /** Nome del processo, se `ss` lo dice (per le porte del kernel non c'è). */
  processo: string | null;
}

/** Solo dentro la macchina: 127.0.0.0/8 e ::1. */
export function soloMacchina(indirizzo: string): boolean {
  return indirizzo.startsWith("127.") || indirizzo === "::1";
}

/** Questo ascolto non esce dalla macchina: indirizzo locale, oppure legato alla scheda `lo`. */
export function ascoltoLocale(a: Pick<Ascolto, "indirizzo" | "scheda">): boolean {
  return a.scheda === "lo" || soloMacchina(a.indirizzo);
}

/** Porte UDP che il sistema assegna da sé a chi chiama fuori (un client SNMP, un DNS): non sono servizi presentati. */
export const PRIMA_PORTA_EFFIMERA = 32768;

/** Su tutte le schede: `0.0.0.0`, `::` o `*`. */
export function suTutte(indirizzo: string): boolean {
  return indirizzo === "0.0.0.0" || indirizzo === "::" || indirizzo === "*";
}

export function eIpv6(indirizzo: string): boolean {
  return indirizzo.includes(":");
}

/** `0.0.0.0:22`, `[::]:443`, `127.0.0.53%lo:53`, `*:80` → indirizzo e porta; `null` se non si legge. */
export function separaIndirizzo(locale: string): { indirizzo: string; porta: number } | null {
  const i = locale.lastIndexOf(":");
  if (i <= 0) return null;
  const porta = Number(locale.slice(i + 1));
  if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) return null;
  const indirizzo = locale.slice(0, i).replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  return indirizzo ? { indirizzo, porta } : null;
}

export function leggiAscolto(testo: string): Ascolto[] {
  const visti = new Set<string>();
  const righe: Ascolto[] = [];
  for (const riga of testo.split("\n")) {
    const campi = riga.trim().split(/\s+/);
    if (campi.length < 5) continue;
    const proto = campi[0] === "tcp" ? "tcp" : campi[0] === "udp" ? "udp" : null;
    if (!proto) continue;
    const dove = separaIndirizzo(campi[4]);
    if (!dove) continue;
    const scheda = /%([A-Za-z0-9_.-]+):\d+$/.exec(campi[4])?.[1] ?? null;
    const processo = /users:\(\("([^"]+)"/.exec(riga)?.[1] ?? null;
    const chiave = `${proto}|${dove.indirizzo}|${dove.porta}`;
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    righe.push({ proto, ...dove, scheda, processo });
  }
  return righe;
}

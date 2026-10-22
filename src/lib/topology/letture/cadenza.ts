/**
 * La cadenza propria delle letture in più (spec topologia §13.5.1): al più una lettura ogni ora per apparato e per
 * lettura, qualunque job chiami il giro; un lucchetto per apparato nel processo; l'esito per apparato a fine lettura,
 * anche quando non riesce (col solo codice). Prima di tutto l'interruttore (spenta: niente) e lo schema (assente:
 * niente, e il resoconto lo dice, §13.5.7).
 */
import { parseDbDate } from "@/lib/db-date";
import { getCurrentTenantCode, schemaCaviPresente } from "@/lib/db-tenant";
import { codiceErrore } from "@/lib/devices/mikrotik-porte";
import { leggiEsiti, letturaAccesa, oraUtc, scriviEsito, type EsitoApparato, type Lettura } from "./interruttori";

export const CADENZA_MS = 60 * 60_000;

export interface Conteggio { comandi: number; riusciti: number; codice: string | null }
export type MotivoSalto = "spenta" | "schema" | "cadenza" | "lucchetto";
export type EsitoGiro<T> =
  | { stato: "letto"; valore: T; esito: EsitoApparato }
  | { stato: "errore"; esito: EsitoApparato }
  | { stato: "saltato"; motivo: MotivoSalto };

const occupati = new Set<string>();

/**
 * `ignoraCadenza`: la lettura chiesta a mano («Interroga» di un admin sull'apparato) non aspetta l'ora; interruttore, schema,
 * lucchetto ed esito valgono come nel giro (spenta = niente, anche a mano).
 */
export async function conCadenza<T>(l: Lettura, deviceId: number, leggi: () => Promise<{ valore: T; conteggio: Conteggio }>,
  adesso: () => Date = () => new Date(), opzioni: { ignoraCadenza?: boolean } = {}): Promise<EsitoGiro<T>> {
  if (!letturaAccesa(l)) return { stato: "saltato", motivo: "spenta" };
  if (!schemaCaviPresente()) return { stato: "saltato", motivo: "schema" };
  const prima = opzioni.ignoraCadenza ? undefined : leggiEsiti(l)[String(deviceId)];
  const t = prima ? parseDbDate(prima.il).getTime() : Number.NaN;
  if (Number.isFinite(t) && adesso().getTime() - t < CADENZA_MS) return { stato: "saltato", motivo: "cadenza" };
  // Fino a qui niente `await`: il controllo e la presa del lucchetto non si possono intrecciare con un altro giro.
  const chiave = `${getCurrentTenantCode() ?? ""}|${l}|${deviceId}`;
  if (occupati.has(chiave)) return { stato: "saltato", motivo: "lucchetto" };
  occupati.add(chiave);
  try {
    const r = await leggi();
    const esito: EsitoApparato = { il: oraUtc(adesso()), ...r.conteggio };
    scriviEsito(l, deviceId, esito);
    return { stato: "letto", valore: r.valore, esito };
  } catch (err) {
    const esito: EsitoApparato = { il: oraUtc(adesso()), comandi: 0, riusciti: 0, codice: codiceErrore(err) };
    try {
      scriviEsito(l, deviceId, esito);
    } catch {
      // l'esito non si scrive: al prossimo giro la lettura si riprova
    }
    return { stato: "errore", esito };
  } finally {
    occupati.delete(chiave);
  }
}

/** Una riga per il resoconto del job: numeri e codici, mai nomi, MAC o IP. null = niente da dire (tutto spento). */
export function riassuntoLetture(esiti: ReadonlyArray<EsitoGiro<unknown>>): string | null {
  if (esiti.some((e) => e.stato === "saltato" && e.motivo === "schema")) {
    return "letture in più non disponibili: lo schema di questo cliente non è aggiornato";
  }
  const lette = esiti.filter((e): e is Extract<EsitoGiro<unknown>, { stato: "letto" }> => e.stato === "letto");
  const inParte = lette.filter((e) => e.esito.riusciti < e.esito.comandi).length;
  const cadenza = esiti.filter((e) => e.stato === "saltato" && e.motivo === "cadenza").length;
  const lucchetto = esiti.filter((e) => e.stato === "saltato" && e.motivo === "lucchetto").length;
  const errori = esiti.filter((e): e is Extract<EsitoGiro<unknown>, { stato: "errore" }> => e.stato === "errore");
  if (lette.length + cadenza + lucchetto + errori.length === 0) return null;
  const codici = [...new Set([...errori, ...lette].map((e) => e.esito.codice).filter((c): c is string => c !== null))].sort();
  const parti = [`${lette.length} lette${inParte > 0 ? ` (${inParte} in parte)` : ""}`];
  if (cadenza + lucchetto > 0) parti.push(`${cadenza + lucchetto} saltate (cadenza ${cadenza}, lucchetto ${lucchetto})`);
  if (errori.length > 0) parti.push(`${errori.length} non riuscit${errori.length === 1 ? "a" : "e"}`);
  return `letture in più: ${parti.join(", ")}${codici.length > 0 ? `; codici: ${codici.join(", ")}` : ""}`;
}

/**
 * Pianificazione «Per device» (piano profili-per-device, Passo 6, 08/11/2026; tavola oggetti 27-31 approvata).
 *
 * Decisioni di Riccardo dell'08/11: all'ora fissata è DA-IPAM a lanciare i gruppi confermati IN QUEL MOMENTO,
 * con lo stesso codice del pulsante (`lanciaGruppiConfermati`): niente elenchi di IP copiati sulla sonda, che
 * invecchierebbero quando una persona cambia un tipo. Una pianificazione per rete, con le famiglie spuntate.
 * Una sola pianificazione per rete: questa e quella «Un profilo solo» si escludono.
 *
 * Il lancio rilegge conferme e host dal database e toglie gli impianti; il freno `protetti` di Edge resta sotto.
 * DA-IPAM spento all'ora fissata: al riavvio parte se sono passate meno di 2 ore, altrimenti salta e lo scrive.
 * Un giro ancora in corso non si raddoppia: Edge rifiuta il gruppo con IP già in coda (`gia_in_corso`).
 */
import { getDb } from "@/lib/db";
import { ETICHETTE_FAMIGLIA, type Famiglia } from "./regole";
import type { EsitoLancio } from "./lancio";
import { parolaEsito } from "./testi-esito";
export { quandoInParole } from "./pianificazione-parole";

// Tappa 2 (Riccardo, 08/11/2026): con un consenso che copre l'ora gli impianti entrano anche nelle pianificazioni e
// nelle finestre. Senza consenso restano fuori e l'esito lo dice: decide la sonda, che lo ricontrolla al lancio.
export const FAMIGLIE_PIANIFICABILI = ["rete", "windows", "linux", "web", "periferiche", "da_chiarire", "impianti"] as const;
export type ModoPianificazione = "orario" | "finestra";
export interface FasciaDevice { giorni: number[]; dalle: string; alle: string }
export type FamigliaPianificabile = (typeof FAMIGLIE_PIANIFICABILI)[number];
export type Frequenza = "giornaliera" | "settimanale" | "mensile";
export type Tono = "ok" | "avviso" | "errore" | "spento";

/** Oltre questo ritardo un giro mancato (DA-IPAM spento) non parte più: salta e lo dice. */
export const RITARDO_MASSIMO_MS = 2 * 3600_000;

export interface Pianificazione {
  network_id: number;
  famiglie: FamigliaPianificabile[];
  frequenza: Frequenza;
  /** settimanale: 0 = domenica … 6 = sabato; mensile: 1-28; giornaliera: null */
  giorno: number | null;
  /** «HH:MM», ora italiana */
  ora: string;
  attiva: boolean;
  prossima_il: string | null;
  ultima_il: string | null;
  ultimo_esito: string | null;
  ultimo_tono: Tono | null;
  chi: string;
  aggiornata_il: string;
  /** Tappa 3: «orario» = DA-IPAM lancia all'ora fissata; «finestra» = la sonda lavora nella fascia, gruppo per gruppo. */
  modo: ModoPianificazione;
  fascia: FasciaDevice | null;
  /** Gli ultimi gruppi mandati alla sonda (solo «finestra»): si rimandano quando cambiano. */
  firma_gruppi: string | null;
}

const ZONA = "Europe/Rome";
function partiRoma(d: Date): { y: number; m: number; g: number; h: number; mi: number; dow: number } {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { y: Number(p.year), m: Number(p.month), g: Number(p.day), h: Number(p.hour), mi: Number(p.minute), dow };
}

/** L'istante in cui a Roma è quel giorno a quell'ora. Due passi bastano anche al cambio dell'ora legale. */
export function istanteRoma(y: number, m: number, g: number, h: number, mi: number): Date {
  const voluto = Date.UTC(y, m - 1, g, h, mi);
  let t = voluto;
  for (let i = 0; i < 2; i++) {
    const p = partiRoma(new Date(t));
    t += voluto - Date.UTC(p.y, p.m - 1, p.g, p.h, p.mi);
  }
  return new Date(t);
}

/** Il prossimo istante, dopo `dopo`, in cui la pianificazione deve partire. Pura, per le prove. */
export function prossimaEsecuzione(p: Pick<Pianificazione, "frequenza" | "giorno" | "ora">, dopo: Date): Date {
  const [h, mi] = p.ora.split(":").map(Number);
  const oggi = partiRoma(dopo);
  for (let i = 0; i <= 62; i++) {
    // Mezzogiorno UTC del giorno i: nessun cambio d'ora sposta il giorno di calendario.
    const giornoI = partiRoma(new Date(Date.UTC(oggi.y, oggi.m - 1, oggi.g + i, 12)));
    const vale =
      p.frequenza === "giornaliera" ||
      (p.frequenza === "settimanale" && giornoI.dow === p.giorno) ||
      (p.frequenza === "mensile" && giornoI.g === p.giorno);
    if (!vale) continue;
    const t = istanteRoma(giornoI.y, giornoI.m, giornoI.g, h, mi);
    if (t.getTime() > dopo.getTime()) return t;
  }
  throw new Error("Pianificazione senza un giorno valido nei prossimi due mesi");
}

/** Cosa fare adesso di una pianificazione accesa. Pura, per le prove. */
export function decisione(p: Pick<Pianificazione, "attiva" | "prossima_il">, adesso: Date): "aspetta" | "esegui" | "salta" {
  if (!p.attiva || !p.prossima_il) return "aspetta";
  const t = Date.parse(p.prossima_il);
  if (!Number.isFinite(t) || adesso.getTime() < t) return "aspetta";
  return adesso.getTime() - t <= RITARDO_MASSIMO_MS ? "esegui" : "salta";
}

/** La riga «Ultimo giro» in una frase, col tono del badge. Pura, per le prove. */
export function riassuntoEsito(e: EsitoLancio, chieste: readonly Famiglia[]): { testo: string; tono: Tono } {
  if (e.errore) return { testo: `Non partita: ${e.errore}`, tono: "errore" };
  const partiti = e.gruppi.filter((g) => g.esito.stato === "lanciato").length;
  const parti: string[] = [`${partiti} ${partiti === 1 ? "gruppo" : "gruppi"} su ${chieste.length} partiti`];
  const presenti = new Set(e.gruppi.map((g) => g.famiglia));
  // Impianti chiesti e assenti dai gruppi: nessun consenso copriva l'ora del giro (il resto dell'esito lo dice la sonda).
  if (chieste.includes("impianti") && !presenti.has("impianti")) parti.push("IoT e OT fuori: nessun consenso che copra quest'ora");
  const saltate = chieste.filter((f) => f !== "impianti" && !presenti.has(f));
  if (saltate.length) parti.push(`${saltate.map((f) => ETICHETTE_FAMIGLIA[f]).join(", ")} ${saltate.length === 1 ? "saltato" : "saltati"}: nessun device confermato`);
  const gia = e.gruppi.filter((g) => g.esito.stato === "gia_in_corso").map((g) => ETICHETTE_FAMIGLIA[g.famiglia]);
  if (gia.length) parti.push(`${gia.join(", ")}: giro precedente ancora in corso`);
  const altri = e.gruppi.filter((g) => !["lanciato", "gia_in_corso"].includes(g.esito.stato));
  for (const g of altri) parti.push(`${ETICHETTE_FAMIGLIA[g.famiglia]}: ${parolaEsito(g.esito).parola}`);
  const impianti = e.tolti.filter((t) => t.motivo.startsWith("è un impianto")).length;
  if (impianti) parti.push(`${impianti} ${impianti === 1 ? "impianto tolto" : "impianti tolti"}`);
  const daRivedere = e.tolti.filter((t) => t.motivo.includes("da rivedere")).length;
  if (daRivedere) parti.push(`${daRivedere} da rivedere, fuori dal giro`);
  const tono: Tono = partiti === 0 ? (altri.length ? "errore" : "avviso") : altri.length || saltate.length || gia.length ? "avviso" : "ok";
  return { testo: parti.join(" · "), tono };
}

// ── Archivio (DB del cliente) ────────────────────────────────────────────────────────────────────

interface Riga {
  network_id: number; famiglie: string; frequenza: Frequenza; giorno: number | null; ora: string; attiva: number;
  prossima_il: string | null; ultima_il: string | null; ultimo_esito: string | null; ultimo_tono: string | null; chi: string; aggiornata_il: string;
  modo?: string | null; fascia_giorni?: string | null; fascia_dalle?: string | null; fascia_alle?: string | null; firma_gruppi?: string | null;
}

function daRiga(r: Riga): Pianificazione {
  const famiglie = r.famiglie.split(",").filter((f): f is FamigliaPianificabile => (FAMIGLIE_PIANIFICABILI as readonly string[]).includes(f));
  const tono = (["ok", "avviso", "errore", "spento"] as const).find((x) => x === r.ultimo_tono) ?? null;
  const modo: ModoPianificazione = r.modo === "finestra" ? "finestra" : "orario";
  const fascia = modo === "finestra" && r.fascia_dalle && r.fascia_alle
    ? { giorni: (r.fascia_giorni ?? "").split(",").filter((g) => g !== "").map(Number), dalle: r.fascia_dalle, alle: r.fascia_alle }
    : null;
  return {
    network_id: r.network_id, frequenza: r.frequenza, giorno: r.giorno, ora: r.ora, prossima_il: r.prossima_il, ultima_il: r.ultima_il,
    ultimo_esito: r.ultimo_esito, chi: r.chi, aggiornata_il: r.aggiornata_il, famiglie, attiva: r.attiva === 1, ultimo_tono: tono, modo, fascia, firma_gruppi: r.firma_gruppi ?? null };
}

export function leggiPianificazione(networkId: number): Pianificazione | null {
  const r = getDb().prepare(`SELECT * FROM va_pianificazioni_device WHERE network_id = ?`).get(networkId) as Riga | undefined;
  return r ? daRiga(r) : null;
}

export function elencoPianificazioni(): Pianificazione[] {
  return (getDb().prepare(`SELECT * FROM va_pianificazioni_device ORDER BY network_id LIMIT 500`).all() as Riga[]).map(daRiga);
}

export function salvaPianificazione(
  p: Pick<Pianificazione, "network_id" | "famiglie" | "frequenza" | "giorno" | "ora" | "chi">,
  adesso = new Date(),
): Pianificazione {
  const prossima = prossimaEsecuzione(p, adesso).toISOString();
  getDb().prepare(
    `INSERT INTO va_pianificazioni_device (network_id, famiglie, frequenza, giorno, ora, attiva, prossima_il, chi, aggiornata_il, modo)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), 'orario')
     ON CONFLICT(network_id) DO UPDATE SET famiglie = excluded.famiglie, frequenza = excluded.frequenza, giorno = excluded.giorno,
       ora = excluded.ora, attiva = 1, prossima_il = excluded.prossima_il, chi = excluded.chi, aggiornata_il = datetime('now'),
       modo = 'orario', firma_gruppi = NULL`,
  ).run(p.network_id, p.famiglie.join(","), p.frequenza, p.giorno, p.ora, prossima, p.chi);
  return leggiPianificazione(p.network_id)!;
}

/**
 * Tappa 3: salva la finestra «Per device». Niente prossima esecuzione (il giro dei minuti non la lancia): la sonda
 * lavora nella fascia coi gruppi che DA-IPAM le manda, e la `firma` dice quali le sono arrivati.
 */
export function salvaFinestraDevice(
  p: Pick<Pianificazione, "network_id" | "famiglie" | "chi"> & { fascia: FasciaDevice; firma: string },
): Pianificazione {
  const giorni = [...p.fascia.giorni].sort((a, b) => a - b).join(",");
  getDb().prepare(
    `INSERT INTO va_pianificazioni_device (network_id, famiglie, frequenza, giorno, ora, attiva, prossima_il, chi, aggiornata_il,
       modo, fascia_giorni, fascia_dalle, fascia_alle, firma_gruppi)
     VALUES (?, ?, 'giornaliera', NULL, ?, 1, NULL, ?, datetime('now'), 'finestra', ?, ?, ?, ?)
     ON CONFLICT(network_id) DO UPDATE SET famiglie = excluded.famiglie, frequenza = 'giornaliera', giorno = NULL, ora = excluded.ora,
       attiva = 1, prossima_il = NULL, chi = excluded.chi, aggiornata_il = datetime('now'), modo = 'finestra',
       fascia_giorni = excluded.fascia_giorni, fascia_dalle = excluded.fascia_dalle, fascia_alle = excluded.fascia_alle,
       firma_gruppi = excluded.firma_gruppi`,
  ).run(p.network_id, p.famiglie.join(","), p.fascia.dalle, p.chi, giorni, p.fascia.dalle, p.fascia.alle, p.firma);
  return leggiPianificazione(p.network_id)!;
}

/** Finestre «Per device» accese: il giro dei minuti ne riallinea i gruppi sulla sonda. */
export function finestreDevice(): Pianificazione[] {
  return (getDb().prepare(`SELECT * FROM va_pianificazioni_device WHERE attiva = 1 AND modo = 'finestra' LIMIT 500`).all() as Riga[]).map(daRiga);
}

export function registraFirma(networkId: number, firma: string): void {
  getDb().prepare(`UPDATE va_pianificazioni_device SET firma_gruppi = ? WHERE network_id = ?`).run(firma, networkId);
}

/** Spegne senza cancellare: «Modifica» ripropone l'ultima. `motivo` va nell'ultimo esito se c'è. */
export function spegniPianificazione(networkId: number, motivo?: string): boolean {
  const r = getDb().prepare(
    `UPDATE va_pianificazioni_device SET attiva = 0, prossima_il = NULL, aggiornata_il = datetime('now')
       ${motivo ? ", ultimo_esito = ?, ultimo_tono = 'spento'" : ""}
     WHERE network_id = ? AND attiva = 1`,
  ).run(...(motivo ? [motivo, networkId] : [networkId]));
  return r.changes > 0;
}

/** Prima del lancio: la prossima passa avanti, così un giro lento o un errore non lo fa ripartire al minuto dopo. */
export function avanzaProssima(p: Pianificazione, adesso: Date): void {
  getDb().prepare(`UPDATE va_pianificazioni_device SET prossima_il = ? WHERE network_id = ?`)
    .run(prossimaEsecuzione(p, adesso).toISOString(), p.network_id);
}

export function registraEsito(networkId: number, il: Date, testo: string, tono: Tono): void {
  getDb().prepare(`UPDATE va_pianificazioni_device SET ultima_il = ?, ultimo_esito = ?, ultimo_tono = ? WHERE network_id = ?`)
    .run(il.toISOString(), testo, tono, networkId);
}

/** Pianificazioni accese da guardare adesso: la prossima è già passata. */
export function scadute(adesso: Date): Pianificazione[] {
  return (getDb().prepare(
    `SELECT * FROM va_pianificazioni_device WHERE attiva = 1 AND modo = 'orario' AND prossima_il IS NOT NULL AND prossima_il <= ? LIMIT 100`,
  ).all(adesso.toISOString()) as Riga[]).map(daRiga);
}

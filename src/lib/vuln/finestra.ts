/**
 * Scansione a finestra (05/11/2026): conti e letture che servono al pannello della rete.
 *
 * Solo funzioni pure, senza database e senza rete: le importano sia il server (bridge, rotte) sia
 * il componente a schermo. La sonda Edge è la fonte dei dati; qui si leggono, si convertono gli
 * orari in ora italiana e si fanno i conti della stima.
 */

import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { EdgeScanProfile } from "@/lib/vuln/edge-subnet-bridge";

/**
 * Minuti per gruppo di IP, per profilo. Stessi valori di `STIMA_GRUPPO_MIN` della sonda
 * (`services/finestra_runner.py`): sono un'ipotesi non misurata, e la sonda li sostituisce con la
 * media dei gruppi già finiti del passaggio.
 */
export const MINUTI_GRUPPO: Record<EdgeScanProfile, number> = { fast: 20, balanced: 60, deep: 120 };

export interface StimaFinestra {
  gruppi: number;
  ore: number;
  /** Quante aperture della fascia servono per fare tutti gli IP (0 se non ci sono IP). */
  cicli: number;
  /** Vero se tutti gli IP stanno in una sola apertura della fascia (e anche se non ce n'è nessuno). */
  basta: boolean;
}

/**
 * Quanto ci vuole a fare tutti gli IP, a gruppi, e se entrano in una apertura della fascia.
 * `oreCiclo` = ore di una apertura della fascia. Valori che non permettono il conto (IP negativi o
 * non interi, gruppo o ciclo a zero) sono un errore: una stima inventata sarebbe peggio di nessuna.
 */
export function stimaFinestra(i: { ip: number; ipPerGruppo: number; minutiGruppo: number; oreCiclo: number }): StimaFinestra {
  if (!Number.isInteger(i.ip) || i.ip < 0) throw new RangeError(`IP non valido: ${i.ip}`);
  if (!Number.isInteger(i.ipPerGruppo) || i.ipPerGruppo < 1) throw new RangeError(`IP per gruppo non valido: ${i.ipPerGruppo}`);
  if (!(i.minutiGruppo > 0)) throw new RangeError(`Minuti per gruppo non validi: ${i.minutiGruppo}`);
  if (!(i.oreCiclo > 0)) throw new RangeError(`Ore del ciclo non valide: ${i.oreCiclo}`);
  const gruppi = Math.ceil(i.ip / i.ipPerGruppo);
  const ore = (gruppi * i.minutiGruppo) / 60;
  return { gruppi, ore, cicli: gruppi === 0 ? 0 : Math.ceil(ore / i.oreCiclo), basta: ore <= i.oreCiclo };
}

function minutiDelGiorno(hhmm: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `alle` uguale o prima di `dalle`: la fascia passa la mezzanotte (se uguali dura 24 ore). */
export function passaLaMezzanotte(dalle: string, alle: string): boolean {
  const d = minutiDelGiorno(dalle);
  const a = minutiDelGiorno(alle);
  if (d === null || a === null) return false;
  return a <= d;
}

/** Ore di una apertura della fascia, o `null` se un orario non è «HH:MM». */
export function oreDellaFascia(dalle: string, alle: string): number | null {
  const d = minutiDelGiorno(dalle);
  const a = minutiDelGiorno(alle);
  if (d === null || a === null) return null;
  const minuti = a > d ? a - d : a + 1440 - d;
  return minuti / 60;
}

// ── Lettura della risposta della sonda ──────────────────────────────────────────────────────────

export type RipetiFinestra = "mese" | "settimana";

export interface FinestraSonda {
  enabled: number;
  giorni: number[];
  dalle: string;
  alle: string;
  ip_per_gruppo: number;
  tentativi: number;
  ripeti: RipetiFinestra;
  profile: string;
  targeting_mode: string | null;
  aggiornata_at: string | null;
  ultimo_errore: string | null;
}

export interface PassaggioSonda {
  id: number;
  stato: string;
  iniziato_at: string | null;
  finito_at: string | null;
  avviso: string | null;
  sospeso_fino: string | null;
  totale: number;
  da_fare: number;
  in_prova: number;
  finiti: number;
  non_rispondono: number;
  assenti: number;
  non_finiti: number;
  gruppi_fatti: number;
  rapporti_inviati: number;
  rapporti_in_coda: number;
  rapporti_arresi: number;
  durata_media_min: number | null;
}

export interface GruppoSonda {
  scan_id: number;
  ip: string;
  partito_at: string | null;
  percento: number | null;
}

/** Risposta di `GET /api/v1/networks/{id}/finestra` della sonda, già controllata. */
export interface DatiFinestra {
  finestra: FinestraSonda | null;
  passaggio: PassaggioSonda | null;
  gruppo: GruppoSonda | null;
  dentro_fascia: boolean | null;
  prossima_apertura: string | null;
  sftp_escluso: boolean;
}

/** Cosa dice il pannello di una finestra: ogni caso ha il suo nome, nessuno si confonde con «nessuna finestra». */
export type StatoFinestra =
  /** La sonda risponde 404 «Not Found» alla rotta: è una versione senza la finestra. */
  | { stato: "da_aggiornare" }
  /** Scanner-Edge non configurato o spento in DA-IPAM. */
  | { stato: "sonda_assente"; messaggio: string }
  /** La sonda non conosce ancora la rete (si registra al primo salvataggio): niente da leggere. */
  | { stato: "rete_non_registrata" }
  /** La lettura è fallita: si dice, non diventa «nessun passaggio». */
  | { stato: "errore"; messaggio: string }
  | ({ stato: "ok" } & DatiFinestra);

const CAMPI_NUMERICI_PASSAGGIO = [
  "id", "totale", "da_fare", "in_prova", "finiti", "non_rispondono", "assenti", "non_finiti",
  "gruppi_fatti", "rapporti_inviati", "rapporti_in_coda", "rapporti_arresi",
] as const;

const eOggetto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const testoOnull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Controlla la forma della risposta: una forma diversa è un errore detto, non un pannello vuoto. */
export function leggiRispostaFinestra(raw: unknown): { ok: true; dati: DatiFinestra } | { ok: false; error: string } {
  const male = (cosa: string) => ({ ok: false as const, error: `Risposta della sonda non riconosciuta: ${cosa}.` });
  if (!eOggetto(raw)) return male("non è un oggetto");
  if (raw.ok !== true) return male("manca «ok»");
  const { finestra, passaggio, gruppo } = raw;

  let f: FinestraSonda | null = null;
  if (finestra !== null) {
    if (!eOggetto(finestra)) return male("«finestra» non è un oggetto");
    if (!Array.isArray(finestra.giorni) || !finestra.giorni.every((g) => Number.isInteger(g))) return male("«giorni» non è un elenco di numeri");
    if (typeof finestra.dalle !== "string" || typeof finestra.alle !== "string") return male("mancano «dalle» e «alle»");
    if (typeof finestra.ip_per_gruppo !== "number" || typeof finestra.tentativi !== "number") return male("mancano «ip_per_gruppo» e «tentativi»");
    if (finestra.ripeti !== "mese" && finestra.ripeti !== "settimana") return male("«ripeti» non è mese o settimana");
    f = {
      enabled: Number(finestra.enabled) ? 1 : 0,
      giorni: finestra.giorni as number[],
      dalle: finestra.dalle,
      alle: finestra.alle,
      ip_per_gruppo: finestra.ip_per_gruppo,
      tentativi: finestra.tentativi,
      ripeti: finestra.ripeti,
      profile: typeof finestra.profile === "string" ? finestra.profile : "balanced",
      targeting_mode: typeof finestra.targeting_mode === "string" ? finestra.targeting_mode : null,
      aggiornata_at: typeof finestra.aggiornata_at === "string" ? finestra.aggiornata_at : null,
      ultimo_errore: typeof finestra.ultimo_errore === "string" && finestra.ultimo_errore.trim() ? finestra.ultimo_errore : null,
    };
  }

  let p: PassaggioSonda | null = null;
  if (passaggio !== null) {
    if (!eOggetto(passaggio)) return male("«passaggio» non è un oggetto");
    for (const c of CAMPI_NUMERICI_PASSAGGIO) {
      if (typeof passaggio[c] !== "number") return male(`nel passaggio manca «${c}»`);
    }
    if (typeof passaggio.stato !== "string") return male("nel passaggio manca «stato»");
    if (!testoOnull(passaggio.iniziato_at ?? null) || !testoOnull(passaggio.finito_at ?? null)) return male("date del passaggio illeggibili");
    p = {
      ...(passaggio as unknown as PassaggioSonda),
      iniziato_at: (passaggio.iniziato_at as string | null) ?? null,
      finito_at: (passaggio.finito_at as string | null) ?? null,
      avviso: typeof passaggio.avviso === "string" && passaggio.avviso.trim() ? passaggio.avviso : null,
      sospeso_fino: typeof passaggio.sospeso_fino === "string" ? passaggio.sospeso_fino : null,
      durata_media_min: typeof passaggio.durata_media_min === "number" ? passaggio.durata_media_min : null,
    };
  }

  let g: GruppoSonda | null = null;
  if (gruppo !== null && gruppo !== undefined) {
    if (!eOggetto(gruppo) || typeof gruppo.ip !== "string" || typeof gruppo.scan_id !== "number") return male("«gruppo» illeggibile");
    g = {
      scan_id: gruppo.scan_id,
      ip: gruppo.ip,
      partito_at: typeof gruppo.partito_at === "string" ? gruppo.partito_at : null,
      percento: typeof gruppo.percento === "number" ? gruppo.percento : null,
    };
  }

  return {
    ok: true,
    dati: {
      finestra: f,
      passaggio: p,
      gruppo: g,
      dentro_fascia: typeof raw.dentro_fascia === "boolean" ? raw.dentro_fascia : null,
      prossima_apertura: typeof raw.prossima_apertura === "string" ? raw.prossima_apertura : null,
      sftp_escluso: raw.sftp_escluso === true,
    },
  };
}

// ── Avanzamento ────────────────────────────────────────────────────────────────────────────────

export interface Barra {
  finiti: number;
  /** Totale senza gli IP usciti (assenti e non finiti), che non contano fra i mancanti. */
  su: number;
  usciti: number;
  percento: number;
}

/** «41 di 92»: i finiti sul totale senza assenti e non finiti. */
export function barraAvanzamento(p: Pick<PassaggioSonda, "totale" | "finiti" | "assenti" | "non_finiti">): Barra {
  const usciti = p.assenti + p.non_finiti;
  const su = Math.max(0, p.totale - usciti);
  return { finiti: p.finiti, su, usciti, percento: su > 0 ? Math.min(100, Math.round((p.finiti / su) * 100)) : 0 };
}

// ── Orari in ora italiana ──────────────────────────────────────────────────────────────────────

function parti(d: Date, opzioni: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, ...opzioni }).formatToParts(d)) out[p.type] = p.value;
  return out;
}

function dataValida(sql: string | null | undefined): Date | null {
  if (!sql) return null;
  const d = parseDbDate(sql);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** «13:05», l'ora italiana di un istante UTC della sonda («YYYY-MM-DD HH:MM:SS», senza «Z»). */
export function oraItaliana(sql: string | null | undefined): string {
  const d = dataValida(sql);
  if (!d) return "—";
  const p = parti(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}:${p.minute}`;
}

function giornoCivile(d: Date): string {
  const p = parti(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** «lunedì 09/11» in ora italiana. */
export function giornoItaliano(sql: string | null | undefined): string {
  const d = dataValida(sql);
  if (!d) return "—";
  const p = parti(d, { weekday: "long", day: "2-digit", month: "2-digit" });
  return `${p.weekday} ${p.day}/${p.month}`;
}

/** Il mese in lettere, in ora italiana: «novembre». */
export function meseItaliano(sql: string | null | undefined): string {
  const d = dataValida(sql);
  return d ? parti(d, { month: "long" }).month : "—";
}

/**
 * «oggi 13:05», «ieri 18:02», «domani 08:00», altrimenti «martedì 03/11 09:10». «Oggi» è quello
 * italiano: alle 23:30 UTC d'estate in Italia è già domani.
 */
export function giornoOraItaliano(sql: string | null | undefined, adesso: Date = new Date()): string {
  const d = dataValida(sql);
  if (!d) return "—";
  const giorno = giornoCivile(d);
  const oggi = giornoCivile(adesso);
  const ora = oraItaliana(sql);
  if (giorno === oggi) return `oggi ${ora}`;
  const ieri = giornoCivile(new Date(adesso.getTime() - 86_400_000));
  const domani = giornoCivile(new Date(adesso.getTime() + 86_400_000));
  if (giorno === ieri) return `ieri ${ora}`;
  if (giorno === domani) return `domani ${ora}`;
  return `${giornoItaliano(sql)} ${ora}`;
}

/** «oggi dalle 16:20», «martedì 03/11 dalle 09:10»: come `giornoOraItaliano`, per un istante da cui si può ripartire. */
export function dalleItaliano(sql: string | null | undefined, adesso: Date = new Date()): string {
  const t = giornoOraItaliano(sql, adesso);
  const i = t.lastIndexOf(" ");
  return i < 0 ? t : `${t.slice(0, i)} dalle ${t.slice(i + 1)}`;
}

/** Vero se l'istante (UTC, forma della sonda) è ancora nel futuro rispetto ad `adesso`. */
export function eNelFuturo(sql: string | null | undefined, adesso: Date = new Date()): boolean {
  const d = dataValida(sql);
  return !!d && d.getTime() > adesso.getTime();
}

// ── Elenco degli indirizzi ─────────────────────────────────────────────────────────────────────

export const STATI_IP = ["da_fare", "in_prova", "finito", "non_risponde", "assente", "non_finito"] as const;
export type StatoIp = (typeof STATI_IP)[number];

export interface IpFinestra {
  ip: string;
  stato: StatoIp;
  tentativi: number;
  ultimo_tentativo_at: string | null;
  prossimo_da: string | null;
  scan_id: number | null;
}

/** Risposta di `GET .../finestra/ip` della sonda, controllata riga per riga. */
export function leggiRispostaIp(raw: unknown): { ok: true; totale: number; ip: IpFinestra[] } | { ok: false; error: string } {
  const male = (cosa: string) => ({ ok: false as const, error: `Elenco degli IP non riconosciuto: ${cosa}.` });
  if (!eOggetto(raw) || raw.ok !== true) return male("manca «ok»");
  if (typeof raw.totale !== "number" || !Array.isArray(raw.ip)) return male("mancano «totale» e «ip»");
  const righe: IpFinestra[] = [];
  for (const r of raw.ip) {
    if (!eOggetto(r) || typeof r.ip !== "string" || typeof r.tentativi !== "number") return male("una riga è illeggibile");
    if (!(STATI_IP as readonly string[]).includes(String(r.stato))) return male(`stato «${String(r.stato)}» sconosciuto`);
    righe.push({
      ip: r.ip,
      stato: r.stato as StatoIp,
      tentativi: r.tentativi,
      ultimo_tentativo_at: typeof r.ultimo_tentativo_at === "string" ? r.ultimo_tentativo_at : null,
      prossimo_da: typeof r.prossimo_da === "string" ? r.prossimo_da : null,
      scan_id: typeof r.scan_id === "number" ? r.scan_id : null,
    });
  }
  return { ok: true, totale: raw.totale, ip: righe };
}

export type EsitoElencoIp =
  | { stato: "ok"; totale: number; ip: IpFinestra[] }
  | { stato: "da_aggiornare" }
  | { stato: "errore"; messaggio: string };

// ── Riga di stato (12) e casi limite (C1-C12 della tavola) ─────────────────────────────────────

/** Frase del pannello per una sonda che non ha la rotta (C1): la scelta «A finestra» resta spenta. */
export const SONDA_DA_AGGIORNARE = "Questa sonda è da aggiornare: «A finestra» si accende dopo l'aggiornamento.";

export type TonoStato = "neutro" | "attenzione" | "guasto";
export interface RigaStato {
  tono: TonoStato;
  /** Il segno (● ▲ ✕) fa parte del testo: si distingue senza guardare il colore. */
  testo: string;
}

const SEGNO: Record<TonoStato, string> = { neutro: "●", attenzione: "▲", guasto: "✕" };
const riga = (tono: TonoStato, testo: string): RigaStato => ({ tono, testo: `${SEGNO[tono]} ${testo}` });
const maiuscola = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);
const finePunto = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

// Gli avvisi che scrive il motore della sonda (`finestra_runner.py`, AVVISO_*): si traducono nelle
// frasi della tavola. Un avviso che non si conosce si mostra com'è, con ▲: non si nasconde.
const AVVISO_PAUSA = "passaggio in pausa dopo troppi gruppi caduti di fila";
const AVVISI_NOTI: Array<{ inizia: string; tono: TonoStato; frase: (resto: string) => string }> = [
  { inizia: "prova di presenza non riuscita", tono: "attenzione", frase: () => "Prova di presenza non riuscita: decide Greenbone." },
  { inizia: "gruppo non fermato a fine fascia", tono: "guasto", frase: () => "Il gruppo non si è fermato a fine fascia: si riprova." },
  { inizia: "uscita di scansione non pronta", tono: "guasto", frase: (r) => `Interfaccia della rete non disponibile: il gruppo non è partito.${r ? ` ${finePunto(maiuscola(r))}` : ""}` },
  { inizia: "licenza: niente gruppi", tono: "guasto", frase: () => "Licenza scaduta: i gruppi sono fermi." },
  { inizia: "nessun ip ha risposto", tono: "neutro", frase: () => "Nessun IP ha risposto: Greenbone non si è acceso. Si riprova più tardi." },
];

/** Il resto di un avviso dopo «prefisso: », senza i due punti. */
function dopoIlPrefisso(avviso: string, prefisso: string): string {
  return avviso.slice(prefisso.length).replace(/^\s*:\s*/, "").trim();
}

/**
 * Le righe della riga di stato (12): errori e avvisi prima, poi la fascia, poi i rapporti. Ogni riga
 * porta il suo segno. Una finestra senza passaggio non dice niente che non sappia: solo la fascia.
 */
export function righeStato(d: DatiFinestra, adesso: Date = new Date()): RigaStato[] {
  const righe: RigaStato[] = [];
  const f = d.finestra;
  const p = d.passaggio;
  if (f?.ultimo_errore) righe.push(riga("guasto", finePunto(f.ultimo_errore))); // C7
  if (f && !f.enabled) righe.push(riga("neutro", "Finestra spenta: «Salva la finestra» la riaccende."));

  if (p?.avviso) {
    const a = p.avviso.trim();
    const minuscolo = a.toLowerCase();
    if (minuscolo.startsWith(AVVISO_PAUSA)) {
      // C2: la pausa è in corso solo se `sospeso_fino` è ancora avanti.
      const motivo = dopoIlPrefisso(a, AVVISO_PAUSA);
      if (eNelFuturo(p.sospeso_fino, adesso)) {
        righe.push(riga("guasto", `Sospeso fino alle ${oraItaliana(p.sospeso_fino)}: tre gruppi di fila non sono riusciti.${motivo ? ` ${finePunto(maiuscola(motivo))}` : ""}`));
      } else {
        righe.push(riga("attenzione", `Tre gruppi di fila non sono riusciti.${motivo ? ` ${finePunto(maiuscola(motivo))}` : ""} Il passaggio è ripreso.`));
      }
    } else {
      const nota = AVVISI_NOTI.find((x) => minuscolo.startsWith(x.inizia));
      if (nota) righe.push(riga(nota.tono, nota.frase(dopoIlPrefisso(a, nota.inizia))));
      else righe.push(riga("attenzione", finePunto(maiuscola(a))));
    }
  }

  if (f && d.dentro_fascia !== null) {
    const prossima = d.prossima_apertura
      ? ` Prossima apertura ${giornoItaliano(d.prossima_apertura)} alle ${oraItaliana(d.prossima_apertura)}.`
      : "";
    if (d.dentro_fascia) {
      righe.push(riga("neutro", `Fascia aperta fino alle ${f.alle}.${prossima}`));
    } else {
      righe.push(riga("neutro", `Fascia chiusa.${prossima}`)); // C3: stato normale, niente allarme
    }
  }

  if (p && p.rapporti_arresi > 0) {
    const n = p.rapporti_arresi;
    righe.push(riga("attenzione", `${n} ${n === 1 ? "rapporto non arrivato" : "rapporti non arrivati"} a Vulcan: si riprova entro 24 ore.`)); // C8
  }
  if (f && d.sftp_escluso) righe.push(riga("attenzione", "Niente SFTP per le reti a finestra: i rapporti vanno solo a Vulcan.")); // C9
  return righe;
}

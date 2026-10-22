/**
 * Le rotte del job `apparati_scelti` (piano 2026-10-22 scansione automatica, Task 6), lato server: leggono il corpo,
 * ricontrollano l'idoneità con `valutaApparato` (la regola unica di `regole.ts`: il server non si fida della finestra
 * J2) e rendono `{ status, body }`. Le rotte sotto `src/app/api/jobs/apparati-scelti/` e
 * `src/app/api/devices/[id]/scansione-automatica/` ne sono l'involucro (guardia, contesto tenant, ricarica dello
 * scheduler), sul modello di `hosts/pulizia-server.ts`: così 400, 404 e 409 si provano senza sessione.
 *
 * Lavorano nel contesto tenant della rotta (`withTenantFromSession`). Import di `db-tenant` solo statico (ADR 0002).
 * Le risposte non portano IP salvo l'anteprima (la finestra J2 mostra l'host scelto, solo a un admin).
 */
import { z } from "zod";
import {
  aggiornaJobApparatiScelti,
  createScheduledJob,
  esitiApparatoNeiJob,
  getScheduledJobById,
  jobsDelApparato,
  leggiEsitiJob,
  riassuntiEsitiJobs,
  statoApparatiPerDevice,
  statoApparatiPerHost,
} from "@/lib/db-tenant";
import {
  etichettaFrequenza,
  frequenzaDaJob,
  interruttoreVlan,
  intervalloDaFrequenza,
  JobApparatiScelti,
  leggiConfig,
  lettureValide,
  MAX_APPARATI,
  prossimaEsecuzione,
  statoCredenziale,
  TESTO_MOTIVO,
  valutaApparato,
  type ConfigApparatiScelti,
  type Frequenza,
  type Lettura,
  type MotivoEsclusione,
  type StatoApparato,
} from "@/lib/apparati-scelti/regole";
import { letturaAccesa } from "@/lib/topology/letture/interruttori";
import { parseDbDate } from "@/lib/db-date";
import type { ScheduledJob } from "@/types";

export interface RispostaRotta { status: number; body: unknown }

const errore = (status: number, error: string): RispostaRotta => ({ status, body: { error } });

const TROPPI = `Al più ${MAX_APPARATI} apparati per job`;
const NESSUN_INCLUSO = "Nessun apparato con credenziale provata";
const NON_TROVATO = "Job non trovato";
const SI_AGGIUNGONO_DA_DISCOVERY = "Gli apparati si aggiungono da Discovery";

/** I messaggi scritti per chi usa la finestra; gli altri errori di forma diventano «Dati non validi: <campo>». */
const MESSAGGI_NOSTRI = new Set<string>([
  TROPPI,
  "Nessun host scelto",
  "Host ripetuti",
  "Apparati ripetuti",
  "Nessuna lettura scelta",
  "Ora non valida (HH:MM)",
  "Frequenza non prevista: ogni ora, ogni 4 ore o ogni giorno a un'ora scelta",
]);

function errore400(issues: ReadonlyArray<{ message: string; path: ReadonlyArray<PropertyKey> }>): RispostaRotta {
  const i = issues[0];
  if (i && MESSAGGI_NOSTRI.has(i.message)) return errore(400, i.message);
  const campo = i?.path.map(String).join(".") || "corpo";
  return errore(400, `Dati non validi: ${campo}`);
}

// ── Corpi ─────────────────────────────────────────────────────────────────

const HostIds = z
  .array(z.number().int().positive())
  .min(1, { message: "Nessun host scelto" })
  .max(MAX_APPARATI, { message: TROPPI })
  .refine((ids) => new Set(ids).size === ids.length, { message: "Host ripetuti" });

const FrequenzaBody = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("ora") }),
  z.object({ tipo: z.literal("4ore") }),
  z.object({ tipo: z.literal("giorno"), ora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Ora non valida (HH:MM)" }) }),
]);

const Cosa = z.object({ info: z.boolean(), porte_mac: z.boolean(), vlan: z.boolean() });

const AnteprimaBody = z.object({ host_ids: HostIds });

/** Il nome del job: tagliato, al più 80; vuoto vale il nome predefinito (l'errore dice «nome», non «config.nome»). */
const NOME_PREDEFINITO = "Apparati scelti";
const NomeBody = z.string().trim().max(80);

const CreaBody = z.object({
  nome: NomeBody.optional(),
  host_ids: HostIds,
  frequenza: FrequenzaBody,
  cosa: Cosa,
});

const ModificaBody = z
  .object({
    nome: NomeBody.optional(),
    device_ids: z.array(z.number().int().positive()).optional(),
    frequenza: FrequenzaBody.optional(),
    cosa: Cosa.optional(),
  })
  .strict();

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Righe dello stato (J2 in creazione e in modifica) ──────────────────────

/** Interruttori delle letture VLAN (ADR 0018): spenti, la casella VLAN di J2 è spenta col motivo. */
export function interruttoriVlan(): { switch_vlan: boolean; mikrotik_scheda: boolean } {
  return { switch_vlan: letturaAccesa("switch_vlan"), mikrotik_scheda: letturaAccesa("mikrotik_scheda") };
}

type Link = { testo: string; href: string } | { testo: string; azione: "rendi_apparato" };

/** Il link che risolve l'esclusione (J2): la finestra «Rendi apparato» o la scheda dell'host. */
function linkPer(motivo: MotivoEsclusione, hostId: number | null): Link | undefined {
  if (motivo === "NON_APPARATO") return { testo: "Rendi apparato ›", azione: "rendi_apparato" };
  if (hostId == null) return undefined;
  if (motivo === "SENZA_CREDENZIALE") return { testo: "Assegna credenziale ›", href: `/objects/${hostId}` };
  if (motivo === "CREDENZIALE_NON_PROVATA") return { testo: "Prova credenziali ›", href: `/objects/${hostId}` };
  return undefined;
}

interface Valutazione {
  incluso: boolean;
  motivo?: MotivoEsclusione;
  testo_motivo?: string;
  link?: Link;
  credenziale: "provata" | "non_provata" | "nessuna";
  letture_valide: Lettura[];
  /** La VLAN per questo apparato: accesa/spenta dal suo interruttore, null se non vale per il tipo. */
  vlan_accesa: boolean | null;
}

function valuta(s: StatoApparato): Valutazione {
  const v = valutaApparato(s);
  const interruttore = s.device_id != null ? interruttoreVlan(s.tipo) : null;
  const base = {
    credenziale: statoCredenziale(s),
    letture_valide: s.device_id != null ? lettureValide(s.tipo) : [],
    vlan_accesa: interruttore ? letturaAccesa(interruttore) : null,
  };
  if (v.incluso) return { incluso: true, ...base };
  const link = linkPer(v.motivo, s.host_id);
  return { incluso: false, motivo: v.motivo, testo_motivo: TESTO_MOTIVO[v.motivo], ...(link ? { link } : {}), ...base };
}

const TOLTO: Valutazione = {
  incluso: false, motivo: "TOLTO", testo_motivo: TESTO_MOTIVO.TOLTO, credenziale: "nessuna", letture_valide: [], vlan_accesa: null,
};

interface RigaHost extends Valutazione {
  host_id: number;
  device_id: number | null;
  nome: string | null;
  ip: string | null;
  tipo_scheda: string | null;
  /** Secondo host dello stesso apparato (regola del cluster): l'apparato entra una volta sola. */
  stesso_apparato_di?: number;
}

/** Gli host scelti nell'ordine della selezione, con l'idoneità; gli id inclusi senza doppi (decisione 6). */
function valutaHost(hostIds: number[]): { righe: RigaHost[]; deviceIds: number[] } {
  const per = new Map(statoApparatiPerHost(hostIds).map((s) => [s.host_id, s]));
  const primoHost = new Map<number, number>();
  const righe = hostIds.map((hostId): RigaHost => {
    const s = per.get(hostId);
    if (!s) return { host_id: hostId, device_id: null, nome: null, ip: null, tipo_scheda: null, ...TOLTO };
    const riga: RigaHost = { host_id: hostId, device_id: s.device_id, nome: s.nome, ip: s.ip, tipo_scheda: s.tipo_scheda, ...valuta(s) };
    if (riga.incluso && s.device_id != null) {
      const primo = primoHost.get(s.device_id);
      if (primo === undefined) primoHost.set(s.device_id, hostId);
      else riga.stesso_apparato_di = primo;
    }
    return riga;
  });
  return { righe, deviceIds: [...primoHost.keys()] };
}

// ── Rotte ─────────────────────────────────────────────────────────────────

/** POST /api/jobs/apparati-scelti/anteprima `{ host_ids }`: chi entra, chi no e perché, le letture per tipo. */
export function rispostaAnteprima(body: unknown): RispostaRotta {
  const p = AnteprimaBody.safeParse(body);
  if (!p.success) return errore400(p.error.issues);
  const { righe, deviceIds } = valutaHost(p.data.host_ids);
  return {
    status: 200,
    body: {
      righe,
      inclusi: deviceIds.length,
      esclusi: righe.filter((r) => !r.incluso).length,
      interruttori: interruttoriVlan(),
    },
  };
}

function configDa(nome: string, deviceIds: number[], cosa: ConfigApparatiScelti["cosa"], f: Frequenza): Record<string, unknown> {
  return { nome: nome.trim(), device_ids: deviceIds, cosa, ...(f.tipo === "giorno" ? { ora: f.ora } : {}) };
}

/**
 * POST /api/jobs/apparati-scelti `{ nome, host_ids, frequenza, cosa }`: ricalcola l'idoneità, tiene solo gli inclusi,
 * crea il job. 201 `{ id, inclusi, esclusi: [{ host_id, motivo }] }`; la rotta ricarica lo scheduler.
 */
export function rispostaCrea(body: unknown): RispostaRotta {
  const p = CreaBody.safeParse(body);
  if (!p.success) return errore400(p.error.issues);
  const { righe, deviceIds } = valutaHost(p.data.host_ids);
  if (deviceIds.length === 0) return errore(400, NESSUN_INCLUSO);
  const nome = p.data.nome || NOME_PREDEFINITO;
  const job = JobApparatiScelti.safeParse({
    interval_minutes: intervalloDaFrequenza(p.data.frequenza),
    config: configDa(nome, deviceIds, p.data.cosa, p.data.frequenza),
  });
  if (!job.success) return errore400(job.error.issues);
  const creato = createScheduledJob({ job_type: "apparati_scelti", interval_minutes: job.data.interval_minutes, config: job.data.config });
  return {
    status: 201,
    body: {
      id: creato.id,
      inclusi: deviceIds.length,
      esclusi: righe.filter((r) => !r.incluso).map((r) => ({ host_id: r.host_id, motivo: r.motivo })),
    },
  };
}

/** Il job, se è un `apparati_scelti`; altrimenti la risposta d'errore (400 id, 404 assente o d'altro tipo). */
function jobApparati(raw: string): { job: ScheduledJob } | { risposta: RispostaRotta } {
  const id = parseId(raw);
  if (id == null) return { risposta: errore(400, "ID non valido") };
  const job = getScheduledJobById(id);
  if (!job || job.job_type !== "apparati_scelti") return { risposta: errore(404, NON_TROVATO) };
  return { job };
}

const CONFIG_ROTTA = "Config del job illeggibile: si elimina e si ricrea da Discovery";

/** GET /api/jobs/apparati-scelti/[id]: config, frequenza e stato degli apparati, per la finestra in modifica. */
export function rispostaLeggiJob(raw: string): RispostaRotta {
  const j = jobApparati(raw);
  if ("risposta" in j) return j.risposta;
  const cfg = leggiConfig(j.job.config);
  if (!cfg) return errore(409, CONFIG_ROTTA);
  const stati = statoApparatiPerDevice(cfg.device_ids);
  const apparati = cfg.device_ids.map((id) => {
    const s = stati.get(id);
    if (!s) return { device_id: id, host_id: null, nome: null, ...TOLTO };
    return { device_id: id, host_id: s.host_id, nome: s.nome, ...valuta(s) };
  });
  return {
    status: 200,
    body: {
      id: j.job.id,
      nome: cfg.nome,
      attivo: j.job.enabled === 1,
      frequenza: frequenzaDaJob(j.job.interval_minutes, cfg),
      cosa: cfg.cosa,
      apparati,
      interruttori: interruttoriVlan(),
    },
  };
}

/**
 * PUT /api/jobs/apparati-scelti/[id] `{ nome?, device_ids?, frequenza?, cosa? }`: gli apparati si possono solo
 * togliere (decisione 15); config e intervallo insieme. La rotta ricarica lo scheduler. Un apparato escluso ora resta
 * se lo si manda: l'idoneità si ricontrolla al giro (decisione 13), qui solo «non se ne aggiungono». `cosa` si salva
 * com'è scelta, anche con la VLAN spenta adesso: il giro la salta e il dettaglio dice «spenta».
 */
export function rispostaModifica(raw: string, body: unknown): RispostaRotta {
  const j = jobApparati(raw);
  if ("risposta" in j) return j.risposta;
  const p = ModificaBody.safeParse(body);
  if (!p.success) return errore400(p.error.issues);
  const cfg = leggiConfig(j.job.config);
  if (!cfg) return errore(409, CONFIG_ROTTA);
  const deviceIds = p.data.device_ids ?? cfg.device_ids;
  const presenti = new Set(cfg.device_ids);
  if (deviceIds.some((id) => !presenti.has(id))) return errore(400, SI_AGGIUNGONO_DA_DISCOVERY);
  if (deviceIds.length === 0) return errore(400, "Almeno un apparato: per toglierli tutti si elimina il job");
  const f = p.data.frequenza ?? frequenzaDaJob(j.job.interval_minutes, cfg);
  if (!f) return errore(400, "Scegli la frequenza: ogni ora, ogni 4 ore o ogni giorno a un'ora scelta");
  const nuovo = JobApparatiScelti.safeParse({
    interval_minutes: intervalloDaFrequenza(f),
    config: configDa(p.data.nome === undefined ? cfg.nome : p.data.nome || NOME_PREDEFINITO, deviceIds, p.data.cosa ?? cfg.cosa, f),
  });
  if (!nuovo.success) return errore400(nuovo.error.issues);
  if (!aggiornaJobApparatiScelti(j.job.id, nuovo.data.interval_minutes, nuovo.data.config)) return errore(404, NON_TROVATO);
  return { status: 200, body: { ok: true } };
}

/** GET /api/jobs/apparati-scelti/[id]/esiti: l'ultimo esito di ogni apparato (dettaglio di J3). */
export function rispostaEsiti(raw: string): RispostaRotta {
  const j = jobApparati(raw);
  if ("risposta" in j) return j.risposta;
  return { status: 200, body: { job_id: j.job.id, ...leggiEsitiJob(j.job.id) } };
}

function etichettaJob(intervalMinutes: number, cfg: ConfigApparatiScelti | null): { f: Frequenza | null; testo: string } {
  const f = cfg ? frequenzaDaJob(intervalMinutes, cfg) : null;
  return { f, testo: f ? etichettaFrequenza(f) : `ogni ${intervalMinutes} minuti` };
}

/** `last_run` come ISO; una data illeggibile vale «mai» (toISOString su una data invalida lancerebbe). */
function ultimaIso(lastRun: string | null): string | null {
  if (!lastRun) return null;
  const d = parseDbDate(lastRun);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * GET /api/devices/[id]/scansione-automatica (testata J4, chiunque abbia la sessione): i job che contengono
 * l'apparato. Solo id, nome del job, frequenza, ore ed esito di QUESTO apparato: niente IP né nomi d'altri apparati.
 * `prossima` dal cron del job (ora italiana), non dal `next_run` del DB che per questi job non segue il cron.
 */
export function rispostaScansioneApparato(raw: string, adesso: Date = new Date()): RispostaRotta {
  const deviceId = parseId(raw);
  if (deviceId == null) return errore(400, "ID non valido");
  const esiti = esitiApparatoNeiJob(deviceId);
  const jobs = jobsDelApparato(deviceId).map((j) => {
    const { f, testo } = etichettaJob(j.interval_minutes, leggiConfig(j.config));
    return {
      id: j.id,
      nome: j.nome,
      frequenza: testo,
      attivo: j.enabled,
      ultima: ultimaIso(j.last_run),
      prossima: j.enabled && f ? prossimaEsecuzione(f, adesso).toISOString() : null,
      esito: esiti.get(j.id) ?? null,
    };
  });
  return { status: 200, body: { jobs } };
}

/**
 * GET /api/jobs: le righe `apparati_scelti` prendono nome, numero di apparati, frequenza, prossima e il riassunto
 * dell'ultimo giro (J3; una query per tutti i job); le altre righe restano come sono.
 */
export function arricchisciJobs(jobs: ScheduledJob[], adesso: Date = new Date()): Array<ScheduledJob | Record<string, unknown>> {
  const ids = jobs.filter((j) => j.job_type === "apparati_scelti").map((j) => j.id);
  if (ids.length === 0) return jobs;
  const riassunti = riassuntiEsitiJobs(ids);
  return jobs.map((j) => {
    if (j.job_type !== "apparati_scelti") return j;
    const cfg = leggiConfig(j.config);
    const { f, testo } = etichettaJob(j.interval_minutes, cfg);
    return {
      ...j,
      nome: cfg?.nome ?? null,
      apparati: cfg?.device_ids.length ?? 0,
      frequenza: testo,
      prossima: j.enabled === 1 && f ? prossimaEsecuzione(f, adesso).toISOString() : null,
      riassunto: riassunti.get(j.id) ?? null,
    };
  });
}

/**
 * PUT generica di /api/jobs (decisione 16): su un `apparati_scelti` passa solo `enabled` («Sospendi»); l'intervallo
 * si cambia da «Modifica», altrimenti l'ora del giornaliero starebbe in due posti. null = la PUT va avanti come prima.
 */
export function rifiutoPutGenerico(jobId: number, body: unknown): RispostaRotta | null {
  const conIntervallo = typeof body === "object" && body !== null && (body as Record<string, unknown>).interval_minutes !== undefined;
  if (!conIntervallo) return null;
  const job = getScheduledJobById(jobId);
  if (job?.job_type !== "apparati_scelti") return null;
  return errore(409, "La frequenza di questo job si modifica da «Modifica»");
}

/** Un errore inatteso diventa 500 col messaggio fisso; nel journal solo il nome dell'errore (può portare nomi e IP). */
export function conGuasto(contesto: string, calcola: () => RispostaRotta): RispostaRotta {
  try {
    return calcola();
  } catch (e) {
    console.error(`[apparati_scelti] ${contesto}:`, e instanceof Error ? e.name : "errore");
    return errore(500, "Errore");
  }
}

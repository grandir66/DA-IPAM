/**
 * Parte pura della pagina «Controller di rete» (`/controllers`): etichette,
 * modulo di aggiunta/modifica, corpo del salvataggio, testi degli esiti di
 * prova e sincronizzazione, lettura difensiva delle risposte. Provata in
 * `__tests__/controllers-model.test.ts`.
 *
 * Importa solo tipi dal lato server: lo usa il browser.
 */
import { parseDbDate } from "@/lib/db-date";
import type {
  ControllerInput,
  ControllerKind,
  ControllerRunView,
  NetworkControllerView,
} from "@/lib/controllers/types";
import { CONTROLLER_KINDS, CONTROLLER_SCHEDULE_MINUTES } from "@/lib/controllers/types";

// ── Etichette ────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<ControllerKind, string> = {
  udm: "UniFi OS",
  self_hosted: "UniFi (self-hosted)",
  omada: "Omada",
};

export function kindLabel(kind: ControllerKind): string {
  return KIND_LABEL[kind] ?? String(kind);
}

/** Voci del Select «Tipo» nel modulo; Omada c'è ma non si può scegliere. */
export const KIND_OPTIONS: ReadonlyArray<{ value: ControllerKind; label: string; disabled: boolean }> = [
  { value: "udm", label: "UniFi OS (UDM, Cloud Key Gen2+) — chiave API", disabled: false },
  { value: "self_hosted", label: "UniFi Network self-hosted — utente e password", disabled: false },
  { value: "omada", label: "Omada — client id e secret (in arrivo)", disabled: true },
];

export type ControllerStatusKey = "active" | "off" | "error";

export interface ControllerStatus {
  key: ControllerStatusKey;
  /** Segno + parola: la forma dice lo stato anche senza il colore. */
  label: string;
  /** Il messaggio d'errore dell'ultima lettura, se c'è. */
  tooltip: string | null;
}

export function controllerStatus(c: Pick<NetworkControllerView, "enabled" | "lastOk" | "lastMessage">): ControllerStatus {
  if (!c.enabled) return { key: "off", label: "○ Spento", tooltip: null };
  if (c.lastOk === false) return { key: "error", label: "▲ Errore", tooltip: c.lastMessage || "Ultima lettura non riuscita" };
  return { key: "active", label: "● Attivo", tooltip: null };
}

const SCHEDULE_LABEL: Record<number, string> = {
  60: "ogni ora",
  120: "ogni 2 ore",
  240: "ogni 4 ore",
  360: "ogni 6 ore",
  720: "ogni 12 ore",
  1440: "ogni giorno (03:00)",
};

export function scheduleLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "spenta";
  return SCHEDULE_LABEL[minutes] ?? `ogni ${minutes} min`;
}

/** Voci del Select «Pianificazione». Il valore è una stringa: "" = spenta. */
export const SCHEDULE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Spenta" },
  ...CONTROLLER_SCHEDULE_MINUTES.map((m) => ({
    value: String(m),
    label: SCHEDULE_LABEL[m][0].toUpperCase() + SCHEDULE_LABEL[m].slice(1),
  })),
];

export function scheduleFromValue(v: string): number | null {
  if (v === "") return null;
  const n = Number(v);
  return CONTROLLER_SCHEDULE_MINUTES.includes(n) ? n : null;
}

/** Ora italiana «13/10 18:40»; «mai» se manca. Le date del DB sono UTC senza fuso. */
export function formatRome(value: string | null | undefined, empty = "mai"): string {
  if (!value) return empty;
  const d = parseDbDate(value);
  if (Number.isNaN(d.getTime())) return empty;
  const parts = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const p = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return `${p("day")}/${p("month")} ${p("hour")}:${p("minute")}`;
}

export function countOrDash(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "–";
}

/** Durata di una lettura, «3 s» o «1 min 5 s». */
export function formatDuration(startedAt: string, finishedAt: string): string {
  const a = parseDbDate(startedAt).getTime();
  const b = parseDbDate(finishedAt).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return "–";
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function runOrigin(r: Pick<ControllerRunView, "trigger" | "triggeredBy">): string {
  if (r.trigger === "schedule") return "pianificata";
  return r.triggeredBy ? `a mano · ${r.triggeredBy}` : "a mano";
}

// ── Lettura dei client (ogni ora dalle 7 alle 20) ───────────────────────────

/** Lo stato della lettura dei client in parole: la casella da sola non basta. */
export function clientScheduleLabel(c: Pick<NetworkControllerView, "clientSchedule">): string {
  return c.clientSchedule === true ? "Client: letti ogni ora dalle 7 alle 20" : "Client: non letti";
}

/** «Ultima lettura dei client: 13/10 18:00 · ok · 40 letti, …» (ora italiana). */
export function clientRunLine(c: Pick<NetworkControllerView, "lastClientRun">): string {
  const r = c.lastClientRun;
  if (!r || typeof r !== "object" || typeof r.at !== "string") return "Ultima lettura dei client: mai";
  const esito = r.ok === true ? "ok" : "▲ non riuscita";
  const testo = typeof r.message === "string" ? r.message.replace(/^Lettura client:\s*/, "") : "";
  return `Ultima lettura dei client: ${formatRome(r.at)} · ${esito}${testo ? ` · ${testo}` : ""}`;
}

// ── Modulo ───────────────────────────────────────────────────────────────────

export interface ControllerForm {
  kind: ControllerKind;
  name: string;
  url: string;
  site: string;
  username: string;
  password: string;
  apiKey: string;
  enabled: boolean;
  /** "" = spenta, altrimenti i minuti come testo (valore del Select). */
  schedule: string;
}

export function emptyControllerForm(): ControllerForm {
  return {
    kind: "udm",
    name: "",
    url: "",
    site: "default",
    username: "",
    password: "",
    apiKey: "",
    enabled: true,
    schedule: "",
  };
}

/** In modifica i segreti non tornano dal server: restano vuoti. */
export function formFromController(c: NetworkControllerView): ControllerForm {
  return {
    kind: c.kind,
    name: c.name,
    url: c.url,
    site: c.site || "default",
    username: c.username,
    password: "",
    apiKey: "",
    enabled: c.enabled,
    schedule: c.scheduleMinutes === null ? "" : String(c.scheduleMinutes),
  };
}

export function urlPlaceholder(kind: ControllerKind): string {
  return kind === "self_hosted" ? "https://192.168.1.10:8443" : "https://192.168.1.1";
}

export function secretPlaceholder(isSet: boolean): string {
  return isSet ? "già impostata — lascia vuoto per non cambiarla" : "";
}

/** Campi minimi per provare o salvare; il resto lo controlla il server. */
export function formMissing(form: ControllerForm): string | null {
  if (!form.name.trim()) return "Scrivi un nome";
  if (!form.url.trim()) return "Scrivi l'indirizzo del controller";
  return null;
}

/**
 * Corpo di POST/PUT e della prova. Per `udm` l'utente non si manda (e per
 * `self_hosted` non si manda la chiave): il server vede solo i campi del tipo.
 */
export function buildControllerPayload(form: ControllerForm, certPin?: string | null): ControllerInput {
  const isUdm = form.kind === "udm";
  const body: ControllerInput = {
    name: form.name.trim(),
    kind: form.kind,
    url: form.url.trim(),
    site: form.site.trim() || "default",
    username: isUdm ? "" : form.username.trim(),
    password: isUdm ? "" : form.password,
    apiKey: isUdm ? form.apiKey.trim() : "",
    enabled: form.enabled,
    scheduleMinutes: scheduleFromValue(form.schedule),
  };
  if (certPin) body.certPin = certPin;
  return body;
}

/** Corpo del PUT per accendere/spegnere: stessi dati, segreti vuoti (= non cambiare). */
export function buildTogglePayload(c: NetworkControllerView): ControllerInput {
  return {
    name: c.name,
    kind: c.kind,
    url: c.url,
    site: c.site,
    username: c.username,
    password: "",
    apiKey: "",
    enabled: !c.enabled,
    scheduleMinutes: c.scheduleMinutes,
  };
}

// ── Esito della prova ────────────────────────────────────────────────────────

export type ProbeReason = "auth" | "network" | "server" | "cert" | "config" | "not_implemented" | "unknown";

export interface ProbeResult {
  ok: boolean;
  devices: number;
  certPin: string | null;
  certPinRecorded: boolean;
  sites: Array<{ name: string; desc: string }>;
  reason: ProbeReason;
  message: string;
  presentedPin: string | null;
  expectedPin: string | null;
}

const REASONS: readonly ProbeReason[] = ["auth", "network", "server", "cert", "config", "not_implemented", "unknown"];

/** Legge la risposta di probe / test in modo difensivo; null se non è una risposta di prova. */
export function parseProbeResult(raw: unknown): ProbeResult | null {
  if (!raw || typeof raw !== "object" || !("ok" in raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const sites = Array.isArray(r.sites)
    ? r.sites.flatMap((s) => {
        const o = s as { name?: unknown; desc?: unknown } | null;
        return o && typeof o.name === "string" && o.name
          ? [{ name: o.name, desc: typeof o.desc === "string" ? o.desc : "" }]
          : [];
      })
    : [];
  return {
    ok: r.ok === true,
    devices: typeof r.devices === "number" && Number.isFinite(r.devices) ? r.devices : 0,
    certPin: str(r.certPin),
    certPinRecorded: r.certPinRecorded === true,
    sites,
    reason: REASONS.includes(r.reason as ProbeReason) ? (r.reason as ProbeReason) : "unknown",
    message: typeof r.message === "string" ? r.message : "",
    presentedPin: str(r.presentedPin),
    expectedPin: str(r.expectedPin),
  };
}

const REASON_TITLE: Record<ProbeReason, string> = {
  auth: "Accesso rifiutato dal controller",
  network: "Controller non raggiungibile",
  server: "Il controller ha risposto con un errore",
  cert: "Certificato del controller cambiato",
  config: "Configurazione da correggere",
  not_implemented: "Tipo di controller non ancora supportato",
  unknown: "Prova non riuscita",
};

export interface ProbeView {
  tone: "ok" | "error";
  /** Una riga: «N apparati letti» oppure il titolo dell'errore. */
  title: string;
  detail: string | null;
  /** Solo per un certificato cambiato: le due impronte da confrontare. */
  pins: { expected: string | null; presented: string } | null;
}

export function describeProbe(r: ProbeResult): ProbeView {
  if (r.ok) {
    return {
      tone: "ok",
      title: r.devices === 1 ? "1 apparato letto" : `${r.devices} apparati letti`,
      detail: r.certPinRecorded
        ? "Primo collegamento: il certificato del controller è stato fissato. D'ora in poi un certificato diverso sarà rifiutato."
        : null,
      pins: null,
    };
  }
  return {
    tone: "error",
    title: REASON_TITLE[r.reason] ?? REASON_TITLE.unknown,
    detail: r.message || null,
    pins: r.reason === "cert" && r.presentedPin ? { expected: r.expectedPin, presented: r.presentedPin } : null,
  };
}

/** Riga unica per l'esito della «Prova» in tabella: i numeri o il messaggio. */
export function probeOneLine(r: ProbeResult): string {
  const v = describeProbe(r);
  return v.tone === "ok" ? v.title : v.detail ? `${v.title}: ${v.detail}` : v.title;
}

// ── Esito della sincronizzazione ─────────────────────────────────────────────

export interface SyncResponse {
  ok: boolean;
  failure: string | null;
  total: number;
  added: number;
  updated: number;
  skipped: number;
  skippedReasons: string[];
  portsUpserted: number;
  neighborsUpserted: number;
  errors: string[];
  offline: string[];
}

export function parseSyncResponse(raw: unknown): SyncResponse | null {
  if (!raw || typeof raw !== "object" || !("ok" in raw)) return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    ok: r.ok === true,
    failure: typeof r.failure === "string" && r.failure ? r.failure : null,
    total: n(r.total),
    added: n(r.added),
    updated: n(r.updated),
    skipped: n(r.skipped),
    skippedReasons: list(r.skippedReasons),
    portsUpserted: n(r.portsUpserted),
    neighborsUpserted: n(r.neighborsUpserted),
    errors: list(r.errors),
    offline: list(r.offline),
  };
}

export interface SyncView {
  tone: "ok" | "warning" | "error";
  text: string;
}

export function describeSync(r: SyncResponse): SyncView {
  if (!r.ok) {
    return {
      tone: "error",
      text: `Sincronizzazione non riuscita, niente è stato scritto${r.failure ? `: ${r.failure}` : ""}`,
    };
  }
  const base = `${r.added} nuovi, ${r.updated} aggiornati, ${r.portsUpserted} porte, ${r.neighborsUpserted} vicini, ${r.errors.length} errori`;
  return { tone: r.errors.length > 0 ? "warning" : "ok", text: `Sincronizzazione completata: ${base}` };
}

// ── Risposte delle rotte ─────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function isController(v: unknown): v is NetworkControllerView {
  return (
    isObj(v) &&
    typeof v.id === "number" &&
    typeof v.name === "string" &&
    typeof v.kind === "string" &&
    (CONTROLLER_KINDS as readonly string[]).includes(v.kind)
  );
}

/** GET /api/controllers → `{controllers}`; null se la forma non è quella attesa. */
export function parseControllerList(raw: unknown): NetworkControllerView[] | null {
  if (!isObj(raw) || !Array.isArray(raw.controllers)) return null;
  return raw.controllers.filter(isController);
}

function isRun(v: unknown): v is ControllerRunView {
  return isObj(v) && typeof v.id === "number" && typeof v.startedAt === "string";
}

/** GET /api/controllers/[id] → `{controller, runs}`. */
export function parseControllerDetail(
  raw: unknown,
): { controller: NetworkControllerView; runs: ControllerRunView[] } | null {
  if (!isObj(raw) || !isController(raw.controller)) return null;
  const runs = Array.isArray(raw.runs)
    ? raw.runs.filter(isRun).map((r) => ({
        ...r,
        errors: Array.isArray(r.errors) ? r.errors : [],
        skippedReasons: Array.isArray(r.skippedReasons) ? r.skippedReasons : [],
        offline: Array.isArray(r.offline) ? r.offline : [],
      }))
    : [];
  return { controller: raw.controller, runs };
}

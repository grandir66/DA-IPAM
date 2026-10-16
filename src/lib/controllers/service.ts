/**
 * Controller di rete (ADR 0007): logica sopra le tabelle `network_controllers`
 * e `network_controller_runs` del DB del cliente.
 *
 * - Credenziale (tappa 2f credenziali, T23): una voce dell'archivio
 *   (`credential_id`, tipo «Controller UniFi»), scelta nella tendina o creata
 *   dai segreti nuovi del modulo come «UniFi · <nome>» (`credenziale.ts`). La
 *   pagina non riceve mai i segreti, sa solo se ci sono e come si chiama la
 *   voce. Le colonne della riga (`password_enc`, `api_key_enc`) si leggono
 *   solo per le righe mai convertite (segno della 2f diverso da `done:`),
 *   registrando il ripiego `cred_riga_integrazione`; altrimenti senza voce è
 *   «Credenziale mancante» e non parte nessuna connessione.
 * - Certificato: un'impronta per controller, fissata al primo uso riuscito come
 *   prima (`unifi-api.ts`). Un indirizzo nuovo azzera impronta, voce e segreti
 *   della riga: la password o la chiave non partono verso un host mai
 *   verificato, a meno che la stessa richiesta non scelga di nuovo la voce.
 * - Lettura: la sincronizzazione resta `syncUnifiForTenant` (tappa 2), che
 *   riceve il client del controller come sorgente; qui si registra il giro.
 * - Configurazione vecchia (`integration_unifi_*` nelle impostazioni globali
 *   dell'hub): si porta nella tabella una volta per tenant, copiando i segreti
 *   già cifrati senza decifrarli. Le chiavi vecchie restano nell'hub, non si
 *   leggono più: servono solo a tornare indietro.
 *
 * Tutto va chiamato nel contesto del tenant (`withTenant`/`withTenantFromSession`).
 * Le funzioni DB si importano staticamente da `@/lib/db-tenant` (ADR 0002).
 */
import {
  attachOrphanUnifiJobs,
  creaVoceDelController,
  creaVoceDelControllerCifrata,
  credenzialeDelController,
  deleteNetworkController,
  getCurrentTenantCode,
  getNetworkController,
  getTenantSetting,
  controllerRunKindOf,
  insertNetworkController,
  integrazioniConvertite,
  listControllerClientScheduleJobs,
  listControllerRuns,
  listControllerScheduleJobs,
  listLastControllerClientRuns,
  listNetworkControllers,
  listVociDeiController,
  recordControllerRun,
  runInTenantTransaction,
  setControllerClientSchedule,
  setControllerSchedule,
  setTenantSetting,
  updateNetworkController,
  voceDelController,
  type ControllerRunRow,
  type NetworkControllerPatch,
} from "@/lib/db-tenant";
import { z } from "zod";
import { getActiveTenants, getSetting } from "@/lib/db-hub";
import { encrypt, safeDecrypt } from "@/lib/crypto";
import { isCiphertext } from "@/lib/integrations/config";
import { normalizeSpkiPin } from "@/lib/integrations/wazuh-config";
import { registraRipiego } from "@/lib/db-maintenance/ripieghi";
import {
  createUnifiClient,
  detectUnifiOs,
  UnifiApiError,
  UNIFI_OS_DETECTED_MESSAGE,
  type UnifiClient,
  type UnifiClientConfig,
  type UnifiClientOptions,
  type UnifiProbeResult,
} from "@/lib/integrations/unifi-api";
import {
  syncUnifiForTenant,
  unifiSyncFailure,
  type UnifiDeviceSource,
  type UnifiSyncResult,
} from "@/lib/integrations/unifi-sync";
import type { UnifiCertPinStore, UnifiKind } from "@/lib/integrations/types";
import {
  accessoDiMetodoVoce,
  CONTROLLER_KINDS_AVAILABLE,
  CONTROLLER_SCHEDULE_MINUTES,
  isControllerKind,
  metodoVoceDiAccesso,
  unifiOsAuthOf,
  vendorOfKind,
  type ControllerInput,
  type ControllerKind,
  type ControllerRunTrigger,
  type ControllerRunView,
  type NetworkControllerRow,
  type NetworkControllerView,
  type UnifiOsAuth,
} from "./types";
import {
  CREDENZIALE_MANCANTE,
  FORMA_VECCHIA,
  statoCredenzialeController,
  type NuovaCredenzialeController,
  type VoceDelController,
} from "./credenziale";

// ── Utilità ──────────────────────────────────────────────────────────────────

/** Forma di un'impronta di `spkiPinFromDer`: sha256/ + base64 di 32 byte. */
const SPKI_PIN_RE = /^sha256\/[A-Za-z0-9+/]{43}=$/;
const SITE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Schema+host+porta: un controller è il suo indirizzo, non il percorso. */
export function urlOrigin(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  try {
    return new URL(v).origin.toLowerCase();
  } catch {
    return v.toLowerCase();
  }
}

function openSecret(sealed: string): string {
  if (!sealed) return "";
  return isCiphertext(sealed) ? (safeDecrypt(sealed) ?? "") : sealed;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function nowSql(): string {
  // Stesso formato di datetime('now') di SQLite: UTC senza fuso (parseDbDate lo legge).
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function parseJsonList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// ── Viste per la pagina ──────────────────────────────────────────────────────

function scheduleByController(): Map<number, number> {
  const out = new Map<number, number>();
  for (const j of listControllerScheduleJobs()) {
    if (j.controller_id !== null && j.enabled === 1 && !out.has(Number(j.controller_id))) {
      out.set(Number(j.controller_id), j.interval_minutes);
    }
  }
  return out;
}

/** Quello che la vista sa della lettura dei client: pianificazione e ultimo giro. */
export interface ControllerClientInfo {
  clientSchedule: boolean;
  lastClientRun: NetworkControllerView["lastClientRun"];
}

/** Pianificazione e ultima lettura dei client di tutti i controller: due query, niente N+1. */
function clientInfoByController(): Map<number, ControllerClientInfo> {
  const out = new Map<number, ControllerClientInfo>();
  const get = (id: number) => {
    let v = out.get(id);
    if (!v) {
      v = { clientSchedule: false, lastClientRun: null };
      out.set(id, v);
    }
    return v;
  };
  for (const j of listControllerClientScheduleJobs()) {
    if (j.controller_id !== null && j.enabled === 1) get(Number(j.controller_id)).clientSchedule = true;
  }
  for (const r of listLastControllerClientRuns()) {
    get(r.controller_id).lastClientRun = { at: r.finished_at, ok: r.ok === 1, message: r.message };
  }
  return out;
}

const NO_CLIENT_INFO: ControllerClientInfo = { clientSchedule: false, lastClientRun: null };

/**
 * La vista di una riga. `voce`: nome e metodo della voce dell'archivio
 * (`listVociDeiController`). `convertita`: la 2f è chiusa con `done:`
 * (`integrazioniConvertite`). Lo stato della credenziale segue il criterio
 * del server; con la voce, «password» o «chiave» dicono il metodo della voce;
 * senza, le colonne valgono solo per una riga mai convertita.
 */
export function toControllerView(
  row: NetworkControllerRow,
  scheduleMinutes: number | null,
  client: ControllerClientInfo,
  voce: VoceDelController | null,
  convertita: boolean,
): NetworkControllerView {
  const stato = statoCredenzialeController(row, convertita);
  const conVoce = stato === "voce";
  const colonne = stato === "forma_vecchia";
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    kind: row.kind,
    url: row.url,
    site: row.site,
    username: row.username,
    credentialState: stato,
    passwordSet: conVoce ? voce?.metodo === "utente" || voce?.metodo === "client" : colonne && row.password_enc !== "",
    apiKeySet: conVoce ? voce?.metodo === "chiave" : colonne && row.api_key_enc !== "",
    credentialId: row.credential_id ?? null,
    credentialName: conVoce ? (voce?.nome ?? null) : null,
    credentialMethod: conVoce ? (voce?.metodo ?? null) : null,
    certPin: row.cert_pin || null,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    lastOk: row.last_ok === null ? null : row.last_ok === 1,
    lastMessage: row.last_message,
    lastDevices: row.last_devices,
    lastPorts: row.last_ports,
    lastNeighbors: row.last_neighbors,
    origin: row.origin,
    scheduleMinutes,
    clientSchedule: client.clientSchedule,
    lastClientRun: client.lastClientRun,
  };
}

export function listControllerViews(): NetworkControllerView[] {
  migrateLegacyUnifiConfig();
  const sched = scheduleByController();
  const clients = clientInfoByController();
  const voci = listVociDeiController();
  const convertita = integrazioniConvertite();
  return listNetworkControllers().map((r) =>
    toControllerView(r, sched.get(r.id) ?? null, clients.get(r.id) ?? NO_CLIENT_INFO, voci.get(r.id) ?? null, convertita),
  );
}

export function getControllerView(id: number): NetworkControllerView | null {
  const row = getNetworkController(id);
  if (!row) return null;
  return toControllerView(
    row,
    scheduleByController().get(id) ?? null,
    clientInfoByController().get(id) ?? NO_CLIENT_INFO,
    listVociDeiController().get(id) ?? null,
    integrazioniConvertite(),
  );
}

export function toRunView(r: ControllerRunRow): ControllerRunView {
  return {
    id: r.id,
    kind: controllerRunKindOf(r.trigger),
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    trigger: r.trigger === "schedule" || r.trigger === "client:schedule" ? "schedule" : "manual",
    triggeredBy: r.triggered_by,
    ok: r.ok === 1,
    total: r.total,
    added: r.added,
    updated: r.updated,
    skipped: r.skipped,
    ports: r.ports,
    neighbors: r.neighbors,
    message: r.message,
    errors: parseJsonList(r.errors_json),
    skippedReasons: parseJsonList(r.skipped_reasons_json),
    offline: parseJsonList(r.offline_json),
  };
}

/** Ultime letture degli apparati (lo storico della pagina; quelle dei client hanno la loro riga). */
export function listControllerRunViews(id: number, limit = 10): ControllerRunView[] {
  return listControllerRuns(id, limit, "apparati").map(toRunView);
}

/** Ultime letture dei client collegati (job ogni ora 7-20, topologia fase 2). */
export function listControllerClientRunViews(id: number, limit = 10): ControllerRunView[] {
  return listControllerRuns(id, limit, "client").map(toRunView);
}

// ── Lettura dei client (topologia fase 2) ────────────────────────────────────

const ControllerPatchSchema = z.object({ client_schedule: z.boolean() }).strict();

/** Corpo di PATCH /api/controllers/[id]: per ora solo `client_schedule`. */
export function parseControllerPatch(
  body: unknown,
): { ok: true; value: { clientSchedule: boolean } } | { ok: false; error: string } {
  const r = ControllerPatchSchema.safeParse(body);
  // I messaggi di Zod sono in inglese: la pagina ne riceve uno solo, in italiano.
  if (!r.success) return { ok: false, error: "Richiesta non valida: serve solo client_schedule, vero o falso" };
  return { ok: true, value: { clientSchedule: r.data.client_schedule } };
}

/**
 * Accende o spegne la lettura dei client ogni ora (7-20). Si accende solo su un
 * controller UniFi acceso: da spento il job fallirebbe a ogni ora. Spegnere si
 * può sempre.
 */
export function setClientScheduleFor(
  id: number,
  on: boolean,
): { ok: true; controller: NetworkControllerView } | { ok: false; status: 400 | 404; error: string } {
  const row = getNetworkController(id);
  if (!row) return { ok: false, status: 404, error: "Controller non trovato" };
  if (on && row.enabled !== 1) {
    return { ok: false, status: 400, error: "Controller spento: accendilo prima di pianificare la lettura dei client" };
  }
  if (on && row.kind === "omada") {
    return { ok: false, status: 400, error: "Omada non è ancora disponibile: niente lettura dei client" };
  }
  setControllerClientSchedule(id, on);
  return { ok: true, controller: getControllerView(id) as NetworkControllerView };
}

// ── Validazione del modulo ───────────────────────────────────────────────────

export type ControllerInputCheck =
  | { ok: true; value: ControllerInput }
  | { ok: false; error: string };

/** Forma del corpo; le regole che dipendono dal tipo e dalla riga salvata vengono dopo. */
const ControllerBodySchema = z.object({
  name: z.string().trim().min(1, "Il nome è obbligatorio").max(80, "Nome troppo lungo (al massimo 80 caratteri)"),
  kind: z.string(),
  url: z.string().trim().min(1, "L'indirizzo è obbligatorio"),
  site: z.string().trim().optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  apiKey: z.string().trim().optional(),
  udmAuth: z.enum(["api_key", "password"]).optional(),
  credentialId: z
    .number({ error: "Credenziale dell'archivio non valida" })
    .int("Credenziale dell'archivio non valida")
    .positive("Credenziale dell'archivio non valida")
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
  scheduleMinutes: z.number().int().nullable().optional(),
  certPin: z.string().nullable().optional(),
});

/** Il metodo che le colonne di una riga mai convertita dicono, come il client di prima (la chiave, se c'è, vince). */
function accessoDelleColonne(row: Pick<NetworkControllerRow, "username" | "api_key_enc">, scelto?: UnifiOsAuth): UnifiOsAuth {
  if (scelto) return scelto;
  if (row.api_key_enc) return "api_key";
  return row.username ? "password" : "api_key";
}

const INDIRIZZO_CAMBIATO =
  "L'indirizzo è cambiato: scegli di nuovo la credenziale dall'archivio o scrivine una nuova (quella salvata non parte verso un indirizzo nuovo)";

const UTENTE_SENZA_PASSWORD =
  "Hai scritto un utente senza la password: per una credenziale nuova servono utente e password, oppure scegline una dall'archivio";

/**
 * Niente voce scelta e niente segreti nuovi: vale la credenziale salvata, solo
 * allo stesso indirizzo e se va bene per il tipo (e per l'accesso scelto).
 * Legge il DB del tenant del contesto.
 */
function credenzialeSalvata(
  kind: ControllerKind,
  scelto: UnifiOsAuth | undefined,
  username: string,
  existing: NetworkControllerRow | undefined,
  sameOrigin: boolean,
): { ok: true; udmAuth?: UnifiOsAuth } | { ok: false; error: string } {
  if (!existing) {
    if (kind === "self_hosted") {
      return { ok: false, error: "Per il controller self-hosted servono utente e password: scegli una credenziale dall'archivio o scrivine una nuova" };
    }
    return unifiOsAuthOf({ apiKey: "", username, udmAuth: scelto }) === "password"
      ? { ok: false, error: "Per la console UniFi OS con utente locale serve la password" }
      : { ok: false, error: "Per la console UniFi OS serve una credenziale: scegline una dall'archivio, oppure scrivi la chiave API o utente locale e password" };
  }
  if (!sameOrigin) return { ok: false, error: INDIRIZZO_CAMBIATO };
  const metodo = kind === "udm" && scelto ? metodoVoceDiAccesso(scelto) : undefined;
  // La voce salvata si controlla col tipo NUOVO: un self-hosted con la voce a utente passato a UDM la tiene.
  const c = credenzialeDelController({ ...existing, kind }, metodo);
  // Un utente scritto senza password non è una voce nuova, e la credenziale
  // salvata non è la sua: si rifiuta invece di scartarlo in silenzio
  // (revisione della 2f). Passano l'utente rimasto nella riga, che
  // accendi/spegni rimanda (`buildTogglePayload`), e quello della voce.
  const utenteSalvato = username === existing.username || (c.ok && c.fonte === "voce" && username === c.username);
  if (username && !utenteSalvato) return { ok: false, error: UTENTE_SENZA_PASSWORD };
  if (!c.ok) return { ok: false, error: c.motivo };
  if (c.fonte === "voce") return { ok: true, ...(kind === "udm" ? { udmAuth: accessoDiMetodoVoce(c.metodo) } : {}) };
  // Riga mai convertita (segno della 2f diverso da done:): come prima, coi segreti delle colonne.
  if (kind === "self_hosted") {
    return existing.username && existing.password_enc
      ? { ok: true }
      : { ok: false, error: "Per il controller self-hosted servono utente e password: scegli una credenziale dall'archivio o scrivine una nuova" };
  }
  const a = accessoDelleColonne(existing, scelto);
  if (a === "password") {
    return existing.username && existing.password_enc
      ? { ok: true, udmAuth: a }
      : { ok: false, error: "Per la console UniFi OS con utente locale serve la password: scegli una credenziale dall'archivio o scrivine una nuova" };
  }
  return existing.api_key_enc
    ? { ok: true, udmAuth: a }
    : { ok: false, error: "Per la console UniFi OS serve la chiave API: scegli una credenziale dall'archivio o scrivine una nuova" };
}

/**
 * Legge e controlla il corpo di POST/PUT (tappa 2f, T23). `existing` = la riga
 * che si modifica. La credenziale è una delle tre:
 * - `credentialId`: una voce dell'archivio, che deve valere per il tipo
 *   (ADR 0019: UniFi OS chiave o utente, self-hosted utente) e per l'accesso
 *   scelto (`udmAuth`); senza `udmAuth` l'accesso è quello della voce;
 * - segreti nuovi (chiave, o utente e password): diventano una voce al
 *   salvataggio. Senza `udmAuth` il metodo si deduce dai campi;
 * - niente dei due: la credenziale salvata, solo allo stesso indirizzo.
 * Va chiamata nel contesto del tenant: la voce si legge dal suo DB.
 */
export function checkControllerInput(raw: unknown, existing?: NetworkControllerRow): ControllerInputCheck {
  const body = ControllerBodySchema.safeParse(raw);
  if (!body.success) return { ok: false, error: body.error.issues[0]?.message ?? "Dati non validi" };
  const b = body.data;
  const str = (v: string | undefined) => (v ?? "").trim();

  const name = b.name;

  if (!isControllerKind(b.kind)) return { ok: false, error: "Tipo di controller non valido" };
  const kind: ControllerKind = b.kind;
  if (!CONTROLLER_KINDS_AVAILABLE.includes(kind)) {
    return { ok: false, error: "Omada non è ancora disponibile: si accende dopo la misura su un controller vero" };
  }

  const url = str(b.url).replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Indirizzo non valido: es. https://192.168.1.1" };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "Il controller si legge solo in https" };

  const site = str(b.site) || "default";
  if (!SITE_RE.test(site)) return { ok: false, error: `Nome del site non valido: «${site}»` };

  const username = str(b.username);
  const password = b.password ?? "";
  const apiKey = str(b.apiKey);
  const credentialId = b.credentialId ?? null;
  const sameOrigin = existing !== undefined && urlOrigin(existing.url) === urlOrigin(url);
  const nuovi = password !== "" || apiKey !== "";

  let udmAuth: UnifiOsAuth | undefined;
  if (credentialId !== null) {
    // Voce scelta nella tendina: il metodo lo dice la voce. Vale anche verso
    // un indirizzo nuovo, perché è scelta nella stessa richiesta.
    if (nuovi) return { ok: false, error: "Scegli una credenziale dell'archivio oppure scrivine una nuova, non tutte e due" };
    const v = voceDelController(credentialId, kind, kind === "udm" && b.udmAuth ? metodoVoceDiAccesso(b.udmAuth) : undefined);
    if (!v.ok) return { ok: false, error: v.motivo };
    if (kind === "udm") udmAuth = accessoDiMetodoVoce(v.metodo);
  } else if (nuovi) {
    // Segreti nuovi: al salvataggio diventano la voce «UniFi · <nome>».
    if (kind === "self_hosted" && (!username || !password)) {
      return { ok: false, error: "Per il controller self-hosted servono utente e password" };
    }
    if (kind === "udm") {
      // Chiave API oppure utente locale e password (ADR 0019): vale il metodo
      // scelto nel modulo, dedotto dai campi solo se manca. I campi dell'altro
      // metodo si rifiutano: una password scritta non si scarta in silenzio
      // lasciando entrare la chiave salvata (revisione del 16/10).
      udmAuth = unifiOsAuthOf({ apiKey, username, udmAuth: b.udmAuth });
      if (password && !username) {
        return { ok: false, error: "Per la console UniFi OS con utente locale serve l'utente locale, oltre alla password" };
      }
      if (udmAuth === "password") {
        if (apiKey) return { ok: false, error: "Con utente locale e password la chiave API non si usa: scegli un metodo solo" };
        if (!password) return { ok: false, error: "Per la console UniFi OS con utente locale serve la password" };
      } else if (password) {
        return { ok: false, error: "Con la chiave API la password non si usa: per l'accesso con utente scegli «Utente locale e password»" };
      }
    }
  } else {
    const r = credenzialeSalvata(kind, b.udmAuth, username, existing, sameOrigin);
    if (!r.ok) return r;
    udmAuth = r.udmAuth;
  }

  const enabled = b.enabled ?? true;
  let scheduleMinutes: number | null = null;
  if (b.scheduleMinutes !== null && b.scheduleMinutes !== undefined) {
    if (!CONTROLLER_SCHEDULE_MINUTES.includes(b.scheduleMinutes)) return { ok: false, error: "Pianificazione non valida" };
    scheduleMinutes = b.scheduleMinutes;
  }
  let certPin: string | null = null;
  if (b.certPin && b.certPin.trim() !== "") {
    const pin = normalizeSpkiPin(b.certPin);
    if (!SPKI_PIN_RE.test(pin)) return { ok: false, error: "Impronta del certificato non valida" };
    certPin = pin;
  }

  return {
    ok: true,
    value: {
      name,
      kind,
      url,
      site,
      username,
      password,
      apiKey,
      ...(udmAuth ? { udmAuth } : {}),
      ...(credentialId !== null ? { credentialId } : {}),
      enabled,
      scheduleMinutes,
      certPin,
    },
  };
}

// ── Scritture ────────────────────────────────────────────────────────────────

/**
 * Quali segreti del modulo valgono: utente e password (self-hosted, o UniFi OS
 * con utente locale) oppure la chiave (UniFi OS con chiave API). Mai tutti e
 * due: quelli dell'altro metodo non partono.
 */
function secretsOf(input: ControllerInput): { password: boolean; apiKey: boolean } {
  if (input.kind === "self_hosted") return { password: true, apiKey: false };
  if (input.kind === "udm") {
    const usesKey = unifiOsAuthOf(input) === "api_key";
    return { password: !usesKey, apiKey: usesKey };
  }
  return { password: false, apiKey: false };
}

/** I segreti nuovi del modulo, se ci sono e non è stata scelta una voce: diventano una voce. */
function nuovaCredenzialeDi(input: ControllerInput): NuovaCredenzialeController | null {
  if (input.credentialId != null || (!input.password && !input.apiKey)) return null;
  const keeps = secretsOf(input);
  if (keeps.apiKey) return { metodo: "chiave", username: "", password: "", apiKey: input.apiKey };
  if (keeps.password) return { metodo: "utente", username: input.username, password: input.password, apiKey: "" };
  return null;
}

/**
 * Nuovo controller. La credenziale è la voce scelta, oppure una voce
 * «UniFi · <nome>» nata dai segreti nuovi, nella stessa transazione della
 * riga (il nome della voce, se è già preso, porta l'id del controller). Le
 * colonne vecchie dei segreti restano vuote.
 */
export function createController(input: ControllerInput): NetworkControllerView {
  migrateLegacyUnifiConfig();
  const id = runInTenantTransaction(() => {
    const row = insertNetworkController({
      name: input.name,
      vendor: vendorOfKind(input.kind),
      kind: input.kind,
      url: input.url,
      site: input.site,
      username: "",
      password_enc: "",
      api_key_enc: "",
      cert_pin: input.certPin ?? null,
      enabled: input.enabled ? 1 : 0,
      origin: "manual",
      credential_id: input.credentialId ?? null,
    });
    const nuova = nuovaCredenzialeDi(input);
    if (nuova) updateNetworkController(row.id, { credential_id: creaVoceDelController(row, nuova).id });
    return row.id;
  });
  setControllerSchedule(id, input.enabled ? input.scheduleMinutes : null);
  return getControllerView(id) as NetworkControllerView;
}

/**
 * Modifica. La voce scelta, o una voce nuova dai segreti nuovi; niente dei due
 * = la credenziale salvata resta. Indirizzo nuovo = controller nuovo:
 * impronta, voce e segreti rimasti nelle colonne si azzerano, a meno che la
 * stessa richiesta non scelga di nuovo una voce o porti segreti nuovi. È la
 * difesa che impedisce di mandare il segreto a un host nuovo: con le colonne
 * piene il ripiego le leggerebbe, e `unifi_sync` manderebbe chiave o password
 * al nuovo indirizzo.
 */
export function updateController(id: number, input: ControllerInput): NetworkControllerView | null {
  const row = getNetworkController(id);
  if (!row) return null;
  const moved = urlOrigin(row.url) !== urlOrigin(input.url);
  const patch: NetworkControllerPatch = {
    name: input.name,
    kind: input.kind,
    vendor: vendorOfKind(input.kind),
    url: input.url,
    site: input.site,
    enabled: input.enabled ? 1 : 0,
  };
  if (moved) {
    patch.cert_pin = null;
    patch.password_enc = "";
    patch.api_key_enc = "";
    patch.credential_id = null;
  }
  // L'impronta vista nella prova vale solo dove non ce n'è una (primo uso).
  if (input.certPin && (moved || !row.cert_pin)) patch.cert_pin = input.certPin;
  runInTenantTransaction(() => {
    if (input.credentialId != null) {
      patch.credential_id = input.credentialId;
    } else {
      const nuova = nuovaCredenzialeDi(input);
      if (nuova) patch.credential_id = creaVoceDelController({ id, name: input.name, kind: input.kind }, nuova).id;
    }
    updateNetworkController(id, patch);
  });
  setControllerSchedule(id, input.enabled ? input.scheduleMinutes : null);
  // Controller spento: anche la lettura dei client si spegne (fallirebbe a ogni ora).
  if (!input.enabled) setControllerClientSchedule(id, false);
  return getControllerView(id);
}

export function removeController(id: number): boolean {
  return deleteNetworkController(id);
}

// ── Certificato ──────────────────────────────────────────────────────────────

/** Impronta del certificato di UNA riga: la usa il client del controller. */
export function controllerPinStore(id: number): UnifiCertPinStore {
  return {
    get: () => normalizeSpkiPin(getNetworkController(id)?.cert_pin ?? "") || null,
    set: (pin: string) => {
      updateNetworkController(id, { cert_pin: normalizeSpkiPin(pin) });
    },
    clear: () => {
      updateNetworkController(id, { cert_pin: null });
    },
    matchesOrigin: (origin: string) => {
      const current = urlOrigin(getNetworkController(id)?.url ?? "");
      return current !== "" && current === urlOrigin(origin);
    },
  };
}

/** Impronta di una prova senza riga salvata: vale solo per quella prova. */
function ephemeralPinStore(): UnifiCertPinStore {
  let pin: string | null = null;
  return {
    get: () => pin,
    set: (p: string) => {
      pin = normalizeSpkiPin(p);
    },
    clear: () => {
      pin = null;
    },
  };
}

export type CertPinUpdate = { ok: true; certPin: string } | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * «Accetta il nuovo certificato»: `replaces` è l'impronta che l'amministratore
 * ha visto fissata (null = nessuna). Se intanto è cambiata si rifiuta (409).
 */
export function acceptControllerCertPin(id: number, pin: string, replaces: string | null): CertPinUpdate {
  const row = getNetworkController(id);
  if (!row) return { ok: false, status: 404, error: "Controller non trovato" };
  const next = normalizeSpkiPin(pin);
  if (!SPKI_PIN_RE.test(next)) {
    return { ok: false, status: 400, error: "Impronta non valida: è attesa la forma sha256/ seguita da 44 caratteri base64" };
  }
  const seen = replaces ? normalizeSpkiPin(replaces) : null;
  if ((normalizeSpkiPin(row.cert_pin ?? "") || null) !== seen) {
    return { ok: false, status: 409, error: "L'impronta fissata è cambiata nel frattempo: ripeti la prova" };
  }
  updateNetworkController(id, { cert_pin: next });
  return { ok: true, certPin: next };
}

// ── Client e prova ───────────────────────────────────────────────────────────

export type ConfigDelController =
  | { ok: true; fonte: "voce" | "colonne"; config: UnifiClientConfig }
  | { ok: false; motivo: string };

/**
 * La configurazione del client di UNA riga salvata (tappa 2f, T23): dalla
 * voce dell'archivio; senza voce, dalle colonne solo se la riga non è mai
 * stata convertita (come prima della 2f); altrimenti «Credenziale mancante».
 * Non registra il ripiego (lo fa chi apre la connessione) e non lancia.
 */
export function controllerClientConfig(row: NetworkControllerRow): ConfigDelController {
  const c = credenzialeDelController(row);
  if (!c.ok) return c;
  const base = { url: row.url, kind: row.kind as UnifiKind, site: row.site };
  if (c.fonte === "voce") {
    return { ok: true, fonte: "voce", config: { ...base, username: c.username, password: c.password, apiToken: c.apiKey } };
  }
  return {
    ok: true,
    fonte: "colonne",
    config: { ...base, username: row.username, password: openSecret(row.password_enc), apiToken: openSecret(row.api_key_enc) },
  };
}

/** Un client che non si collega mai: la credenziale manca, e lo dice. */
function clientSenzaCredenziale(kind: UnifiKind, motivo: string): UnifiClient {
  return {
    kind,
    probe: async () => ({ ok: false, reason: "config", message: motivo }),
    listDevices: async () => {
      throw new UnifiApiError("config", motivo);
    },
    listClients: async () => {
      throw new UnifiApiError("config", motivo);
    },
  };
}

/** Il client della riga e, se è entrata con le colonne vecchie, l'avviso per lo storico. */
function clientDelController(row: NetworkControllerRow, opts: UnifiClientOptions): { client: UnifiClient; avviso: string | null } {
  const c = controllerClientConfig(row);
  if (!c.ok) return { client: clientSenzaCredenziale(row.kind as UnifiKind, c.motivo), avviso: null };
  if (c.fonte === "colonne") registraRipiego("cred_riga_integrazione", getCurrentTenantCode());
  return { client: createUnifiClient(c.config, controllerPinStore(row.id), opts), avviso: c.fonte === "colonne" ? FORMA_VECCHIA : null };
}

/**
 * Il client di UNA riga salvata: credenziale dalla voce (o dalle colonne di
 * una riga mai convertita, col ripiego registrato), impronta della riga.
 * Unico punto di costruzione per la lettura degli apparati (`syncController`)
 * e dei client collegati (`unifi-clients-sync.ts`): stesse difese per tutte e
 * due. Senza credenziale il client non si collega e dice «Credenziale mancante».
 */
export function controllerClientOf(row: NetworkControllerRow, opts: UnifiClientOptions = {}): UnifiClient {
  return clientDelController(row, opts).client;
}

/**
 * «Prova» dal modulo, prima di salvare. La credenziale è la voce scelta, o i
 * segreti nuovi scritti, o (con `id` e lo stesso indirizzo) quella salvata;
 * con lo stesso indirizzo vale anche l'impronta salvata (e al primo uso
 * riuscito la fissa, come prima); altrimenti l'impronta vale solo per questa
 * prova e torna nel risultato: il modulo la manda col salvataggio. Non scrive
 * nel DB del cliente. Non lancia.
 */
export async function probeControllerInput(
  input: ControllerInput,
  id: number | null,
  opts: UnifiClientOptions = {},
): Promise<UnifiProbeResult> {
  const row = id !== null ? getNetworkController(id) : undefined;
  if (id !== null && !row) return { ok: false, reason: "config", message: "Controller non trovato" };
  const sameOrigin = row !== undefined && urlOrigin(row.url) === urlOrigin(input.url);
  const base = { url: input.url, kind: input.kind as UnifiKind, site: input.site };
  const scelto = input.kind === "udm" && input.udmAuth ? metodoVoceDiAccesso(input.udmAuth) : undefined;
  let cfg: UnifiClientConfig;
  if (input.credentialId != null) {
    // Voce scelta nella tendina: è una scelta, vale anche verso un indirizzo nuovo.
    const v = voceDelController(input.credentialId, input.kind, scelto);
    if (!v.ok) return { ok: false, reason: "config", message: v.motivo };
    cfg = { ...base, username: v.username, password: v.password, apiToken: v.apiKey };
  } else if (input.password || input.apiKey) {
    // Segreti nuovi del modulo: solo quelli del metodo scelto.
    const keeps = secretsOf(input);
    cfg = {
      ...base,
      username: keeps.password ? input.username : "",
      password: keeps.password ? input.password : "",
      apiToken: keeps.apiKey ? input.apiKey : "",
    };
  } else if (row && sameOrigin) {
    // La credenziale salvata, solo allo stesso indirizzo.
    const c = credenzialeDelController({ ...row, kind: input.kind }, scelto);
    if (!c.ok) return { ok: false, reason: "config", message: c.motivo };
    if (c.fonte === "voce") {
      cfg = { ...base, username: c.username, password: c.password, apiToken: c.apiKey };
    } else {
      registraRipiego("cred_riga_integrazione", getCurrentTenantCode());
      // Solo i segreti del metodo scelto: la chiave salvata non parte se si prova con l'utente.
      const conChiave = input.kind === "udm" && accessoDelleColonne(row, input.udmAuth) === "api_key";
      cfg = {
        ...base,
        username: conChiave ? "" : row.username,
        password: conChiave ? "" : openSecret(row.password_enc),
        apiToken: conChiave ? openSecret(row.api_key_enc) : "",
      };
    }
  } else {
    return { ok: false, reason: "config", message: row ? INDIRIZZO_CAMBIATO : CREDENZIALE_MANCANTE };
  }
  const store = sameOrigin && row ? controllerPinStore(row.id) : ephemeralPinStore();
  try {
    return await createUnifiClient(cfg, store, opts).probe();
  } catch (e) {
    return { ok: false, reason: "unknown", message: errorMessage(e) };
  }
}

/**
 * Avviso al salvataggio: un controller self-hosted il cui indirizzo è una
 * console UniFi OS non funzionerà mai (il tipo giusto è «udm»). Domanda
 * anonima, nessuna credenziale; null se non lo è o non risponde. Non lancia.
 */
export async function unifiOsWarningFor(
  input: ControllerInput,
  opts: Pick<UnifiClientOptions, "transportFactory"> = {},
): Promise<string | null> {
  if (input.kind !== "self_hosted") return null;
  return (await detectUnifiOs(input.url, opts)) ? UNIFI_OS_DETECTED_MESSAGE : null;
}

/** «Prova» dalla riga della tabella: configurazione salvata. Non lancia. */
export async function probeSavedController(id: number, opts: UnifiClientOptions = {}): Promise<UnifiProbeResult> {
  const row = getNetworkController(id);
  if (!row) return { ok: false, reason: "config", message: "Controller non trovato" };
  try {
    return await controllerClientOf(row, opts).probe();
  } catch (e) {
    return { ok: false, reason: "unknown", message: errorMessage(e) };
  }
}

// ── Sincronizzazione ─────────────────────────────────────────────────────────

export interface ControllerSyncOutcome extends UnifiSyncResult {
  ok: boolean;
  controllerId: number;
  /** Perché il giro è fallito; null se è andato. */
  failure: string | null;
}

/**
 * Un giro di lettura di UN controller nel tenant del contesto: legge, scrive
 * con `syncUnifiForTenant`, registra il giro nello storico. Non lancia.
 * `opts.clientOptions` e `opts.source` servono alle prove.
 */
export async function syncController(
  id: number,
  trigger: ControllerRunTrigger,
  triggeredBy: string | null,
  opts: { clientOptions?: UnifiClientOptions; source?: UnifiDeviceSource } = {},
): Promise<ControllerSyncOutcome> {
  migrateLegacyUnifiConfig();
  const startedAt = nowSql();
  const row = getNetworkController(id);
  const empty = (msg: string): ControllerSyncOutcome => ({
    ok: false,
    controllerId: id,
    failure: msg,
    tenantCode: getCurrentTenantCode(),
    total: 0,
    added: 0,
    updated: 0,
    skipped: 0,
    skippedReasons: [],
    portsUpserted: 0,
    neighborsUpserted: 0,
    uplinksSaved: 0,
    errors: [msg],
    offline: [],
  });
  if (!row) return empty("Controller non trovato");

  let result: UnifiSyncResult;
  // Riga entrata con le colonne vecchie (mai convertita): lo dice lo storico.
  let avviso: string | null = null;
  if (row.enabled !== 1) {
    result = empty("Controller spento: nessuna lettura");
  } else if (row.kind === "omada") {
    result = empty("Omada non è ancora disponibile: nessuna lettura");
  } else {
    let source = opts.source;
    if (!source) {
      const c = clientDelController(row, opts.clientOptions ?? {});
      source = c.client;
      avviso = c.avviso;
    }
    result = await syncUnifiForTenant({ source });
  }
  const failure = unifiSyncFailure(result);
  const esito =
    failure ??
    `${result.total} apparati, ${result.added} nuovi, ${result.updated} aggiornati` +
      (result.skipped ? `, ${result.skipped} saltati` : "");
  const message = avviso ? `${esito} · ${avviso}` : esito;
  try {
    recordControllerRun({
      controller_id: id,
      started_at: startedAt,
      finished_at: nowSql(),
      trigger,
      triggered_by: triggeredBy,
      ok: failure === null ? 1 : 0,
      total: result.total,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      ports: result.portsUpserted,
      neighbors: result.neighborsUpserted,
      message,
      errors_json: JSON.stringify(result.errors.slice(0, 200)),
      skipped_reasons_json: JSON.stringify(result.skippedReasons.slice(0, 200)),
      offline_json: JSON.stringify(result.offline.slice(0, 200)),
    });
  } catch (e) {
    // Lo storico non fa fallire una lettura già scritta: lo si dice nel resoconto.
    result.errors.push(`Storico della lettura non registrato: ${errorMessage(e)}`);
  }
  return { ...result, ok: failure === null, controllerId: id, failure };
}

// ── Configurazione vecchia dell'hub → tabella ────────────────────────────────

const LEGACY_MARK = "controllers_legacy_unifi";

export type LegacyMigration =
  | { state: "done"; controllerId: number | null; jobsAttached: number }
  | { state: "already" }
  | { state: "nothing" }
  | { state: "skipped_multi_tenant"; tenants: number };

/**
 * Porta `integration_unifi_*` dell'hub nella tabella dei controller, una volta
 * per tenant (segno in `tenant_settings`). Solo se l'hub ha UN tenant attivo:
 * con più clienti non si sa di chi sia il controller, e lo si dice nel log
 * invece di indovinare. Dalla 2f (T23) il segreto va in una voce dell'archivio
 * «UniFi · <nome>», creata nella stessa transazione del controller: copiato
 * cifrato com'è (stessa chiave, stessa macchina); un segreto ancora in chiaro
 * si cifra. Così un tenant aperto per la prima volta dopo la 2f, col segno
 * `done:` già scritto, ha la voce e non resta senza credenziale. Idempotente.
 */
export function migrateLegacyUnifiConfig(): LegacyMigration {
  if (getTenantSetting(LEGACY_MARK)) return { state: "already" };
  const url = (getSetting("integration_unifi_url") ?? "").trim();
  if (!url) {
    setTenantSetting(LEGACY_MARK, "nothing");
    return { state: "nothing" };
  }
  const tenants = getActiveTenants().length;
  if (tenants > 1) {
    console.warn(
      `[controllers] configurazione UniFi dell'hub non portata nel tenant ${getCurrentTenantCode()}: ` +
        `${tenants} tenant attivi, non si sa di chi sia il controller`,
    );
    setTenantSetting(LEGACY_MARK, "skipped_multi_tenant");
    return { state: "skipped_multi_tenant", tenants };
  }
  const reseal = (key: string): string => {
    const raw = getSetting(key) ?? "";
    if (!raw) return "";
    return isCiphertext(raw) ? raw : encrypt(raw);
  };
  const rawKind = getSetting("integration_unifi_kind");
  const kind: ControllerKind = rawKind === "udm" ? "udm" : "self_hosted";
  const pin = normalizeSpkiPin(getSetting("integration_unifi_cert_pin") ?? "") || null;
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {
    /* resta l'indirizzo com'è */
  }
  const chiave = kind === "udm" ? reseal("integration_unifi_api_token") : "";
  const password = kind === "self_hosted" ? reseal("integration_unifi_password") : "";
  const utente = kind === "self_hosted" ? (getSetting("integration_unifi_username") ?? "").trim() : "";
  const { row, jobsAttached, voce } = runInTenantTransaction(() => {
    const row = insertNetworkController({
      name: `Controller UniFi ${host}`,
      vendor: "unifi",
      kind,
      url,
      site: getSetting("integration_unifi_site")?.trim() || "default",
      username: "",
      password_enc: "",
      api_key_enc: "",
      cert_pin: pin,
      enabled: getSetting("integration_unifi_mode") === "external" ? 1 : 0,
      origin: "legacy_hub",
    });
    let voce: { id: number; nome: string } | null = null;
    if (chiave) {
      voce = creaVoceDelControllerCifrata(row, { metodo: "chiave", encrypted_username: null, encrypted_password: chiave });
    } else if (password && utente) {
      voce = creaVoceDelControllerCifrata(row, { metodo: "utente", encrypted_username: encrypt(utente), encrypted_password: password });
    }
    if (voce) updateNetworkController(row.id, { credential_id: voce.id });
    const jobsAttached = attachOrphanUnifiJobs(row.id);
    setTenantSetting(LEGACY_MARK, `done:${row.id}`);
    return { row, jobsAttached, voce };
  });
  if (!voce && (chiave || password)) {
    // Un segreto c'era ma senza l'utente: il controller nasce senza voce, e lo si dice.
    console.warn(
      `[controllers] tenant ${getCurrentTenantCode()}: configurazione UniFi dell'hub senza utente, ` +
        `controller #${row.id} portato senza credenziale (va scelta nella pagina Controller di rete)`,
    );
  }
  console.info(
    `[controllers] tenant ${getCurrentTenantCode()}: configurazione UniFi dell'hub portata nel controller #${row.id}` +
      ` (${jobsAttached} job collegati${voce ? `, voce d'archivio #${voce.id}` : ""})`,
  );
  return { state: "done", controllerId: row.id, jobsAttached };
}

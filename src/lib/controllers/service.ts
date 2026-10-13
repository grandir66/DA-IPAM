/**
 * Controller di rete (ADR 0007): logica sopra le tabelle `network_controllers`
 * e `network_controller_runs` del DB del cliente.
 *
 * - Segreti cifrati come nell'hub (`encrypt`, formato iv:tag:enc); la pagina
 *   non li riceve mai, sa solo se ci sono.
 * - Certificato: un'impronta per controller, fissata al primo uso riuscito come
 *   prima (`unifi-api.ts`). Un indirizzo nuovo azzera impronta e segreti: la
 *   password o la chiave vecchia non partono verso un host mai verificato.
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
  deleteNetworkController,
  getCurrentTenantCode,
  getNetworkController,
  getTenantSetting,
  insertNetworkController,
  listControllerRuns,
  listControllerScheduleJobs,
  listNetworkControllers,
  recordControllerRun,
  setControllerSchedule,
  setTenantSetting,
  updateNetworkController,
  type ControllerRunRow,
  type NetworkControllerPatch,
} from "@/lib/db-tenant";
import { z } from "zod";
import { getActiveTenants, getSetting } from "@/lib/db-hub";
import { encrypt, safeDecrypt } from "@/lib/crypto";
import { isCiphertext } from "@/lib/integrations/config";
import { normalizeSpkiPin } from "@/lib/integrations/wazuh-config";
import {
  createUnifiClient,
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
  CONTROLLER_KINDS_AVAILABLE,
  CONTROLLER_SCHEDULE_MINUTES,
  isControllerKind,
  vendorOfKind,
  type ControllerInput,
  type ControllerKind,
  type ControllerRunTrigger,
  type ControllerRunView,
  type NetworkControllerRow,
  type NetworkControllerView,
} from "./types";

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

function sealSecret(plain: string): string {
  return plain ? encrypt(plain) : "";
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

export function toControllerView(row: NetworkControllerRow, scheduleMinutes: number | null): NetworkControllerView {
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    kind: row.kind,
    url: row.url,
    site: row.site,
    username: row.username,
    passwordSet: row.password_enc !== "",
    apiKeySet: row.api_key_enc !== "",
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
  };
}

export function listControllerViews(): NetworkControllerView[] {
  migrateLegacyUnifiConfig();
  const sched = scheduleByController();
  return listNetworkControllers().map((r) => toControllerView(r, sched.get(r.id) ?? null));
}

export function getControllerView(id: number): NetworkControllerView | null {
  const row = getNetworkController(id);
  if (!row) return null;
  return toControllerView(row, scheduleByController().get(id) ?? null);
}

export function toRunView(r: ControllerRunRow): ControllerRunView {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    trigger: r.trigger,
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

export function listControllerRunViews(id: number, limit = 10): ControllerRunView[] {
  return listControllerRuns(id, limit).map(toRunView);
}

// ── Validazione del modulo ───────────────────────────────────────────────────

export type ControllerInputCheck =
  | { ok: true; value: ControllerInput }
  | { ok: false; error: string };

/**
 * Legge e controlla il corpo di POST/PUT. `existing` = la riga che si modifica:
 * i segreti vuoti valgono «non cambiare», quindi bastano quelli salvati.
 */
/** Forma del corpo; le regole che dipendono dal tipo e dalla riga salvata vengono dopo. */
const ControllerBodySchema = z.object({
  name: z.string().trim().min(1, "Il nome è obbligatorio").max(80, "Nome troppo lungo (al massimo 80 caratteri)"),
  kind: z.string(),
  url: z.string().trim().min(1, "L'indirizzo è obbligatorio"),
  site: z.string().trim().optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  apiKey: z.string().trim().optional(),
  enabled: z.boolean().optional(),
  scheduleMinutes: z.number().int().nullable().optional(),
  certPin: z.string().nullable().optional(),
});

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
  const sameOrigin = existing !== undefined && urlOrigin(existing.url) === urlOrigin(url);

  if (kind === "self_hosted") {
    if (!username) return { ok: false, error: "Per il controller self-hosted servono utente e password" };
    if (!password && !(sameOrigin && existing?.password_enc)) {
      return { ok: false, error: "Per il controller self-hosted serve la password" };
    }
  } else if (kind === "udm") {
    if (!apiKey && !(sameOrigin && existing?.api_key_enc)) {
      return { ok: false, error: "Per la console UniFi OS serve la chiave API" };
    }
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

  return { ok: true, value: { name, kind, url, site, username, password, apiKey, enabled, scheduleMinutes, certPin } };
}

// ── Scritture ────────────────────────────────────────────────────────────────

export function createController(input: ControllerInput): NetworkControllerView {
  migrateLegacyUnifiConfig();
  const row = insertNetworkController({
    name: input.name,
    vendor: vendorOfKind(input.kind),
    kind: input.kind,
    url: input.url,
    site: input.site,
    username: input.kind === "self_hosted" ? input.username : "",
    password_enc: input.kind === "self_hosted" ? sealSecret(input.password) : "",
    api_key_enc: input.kind === "udm" ? sealSecret(input.apiKey) : "",
    cert_pin: input.certPin ?? null,
    enabled: input.enabled ? 1 : 0,
    origin: "manual",
  });
  setControllerSchedule(row.id, input.enabled ? input.scheduleMinutes : null);
  return getControllerView(row.id) as NetworkControllerView;
}

/**
 * Modifica. Indirizzo nuovo = controller nuovo: impronta e segreti salvati si
 * azzerano (se ne arrivano di nuovi in questa richiesta, valgono quelli).
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
    username: input.kind === "self_hosted" ? input.username : "",
    enabled: input.enabled ? 1 : 0,
  };
  if (moved) {
    patch.cert_pin = null;
    patch.password_enc = "";
    patch.api_key_enc = "";
  }
  if (input.kind === "self_hosted") {
    if (input.password) patch.password_enc = sealSecret(input.password);
    patch.api_key_enc = "";
  } else if (input.kind === "udm") {
    if (input.apiKey) patch.api_key_enc = sealSecret(input.apiKey);
    patch.password_enc = "";
  }
  // L'impronta vista nella prova vale solo dove non ce n'è una (primo uso).
  if (input.certPin && (moved || !row.cert_pin)) patch.cert_pin = input.certPin;
  updateNetworkController(id, patch);
  setControllerSchedule(id, input.enabled ? input.scheduleMinutes : null);
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

function clientConfigOf(row: NetworkControllerRow): UnifiClientConfig {
  return {
    url: row.url,
    kind: row.kind as UnifiKind,
    site: row.site,
    username: row.username,
    password: openSecret(row.password_enc),
    apiToken: openSecret(row.api_key_enc),
  };
}

/**
 * «Prova» dal modulo, prima di salvare. Con `id` e lo stesso indirizzo usa i
 * segreti e l'impronta salvati (e al primo uso riuscito la fissa, come prima);
 * altrimenti l'impronta vale solo per questa prova e torna nel risultato: il
 * modulo la manda col salvataggio. Non scrive nel DB del cliente. Non lancia.
 */
export async function probeControllerInput(
  input: ControllerInput,
  id: number | null,
  opts: UnifiClientOptions = {},
): Promise<UnifiProbeResult> {
  const row = id !== null ? getNetworkController(id) : undefined;
  if (id !== null && !row) return { ok: false, reason: "config", message: "Controller non trovato" };
  const sameOrigin = row !== undefined && urlOrigin(row.url) === urlOrigin(input.url);
  const cfg: UnifiClientConfig = {
    url: input.url,
    kind: input.kind as UnifiKind,
    site: input.site,
    username: input.username,
    password: input.password || (sameOrigin && row ? openSecret(row.password_enc) : ""),
    apiToken: input.apiKey || (sameOrigin && row ? openSecret(row.api_key_enc) : ""),
  };
  const store = sameOrigin && row ? controllerPinStore(row.id) : ephemeralPinStore();
  try {
    return await createUnifiClient(cfg, store, opts).probe();
  } catch (e) {
    return { ok: false, reason: "unknown", message: errorMessage(e) };
  }
}

/** «Prova» dalla riga della tabella: configurazione salvata. Non lancia. */
export async function probeSavedController(id: number, opts: UnifiClientOptions = {}): Promise<UnifiProbeResult> {
  const row = getNetworkController(id);
  if (!row) return { ok: false, reason: "config", message: "Controller non trovato" };
  try {
    return await createUnifiClient(clientConfigOf(row), controllerPinStore(row.id), opts).probe();
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
    errors: [msg],
    offline: [],
  });
  if (!row) return empty("Controller non trovato");

  let result: UnifiSyncResult;
  if (row.enabled !== 1) {
    result = empty("Controller spento: nessuna lettura");
  } else if (row.kind === "omada") {
    result = empty("Omada non è ancora disponibile: nessuna lettura");
  } else {
    const source = opts.source ?? createUnifiClient(clientConfigOf(row), controllerPinStore(row.id), opts.clientOptions);
    result = await syncUnifiForTenant({ source });
  }
  const failure = unifiSyncFailure(result);
  const message =
    failure ??
    `${result.total} apparati, ${result.added} nuovi, ${result.updated} aggiornati` +
      (result.skipped ? `, ${result.skipped} saltati` : "");
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
 * invece di indovinare. I segreti si copiano cifrati come sono (stessa chiave,
 * stessa macchina); un segreto ancora in chiaro si cifra. Idempotente.
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
  const row = insertNetworkController({
    name: `Controller UniFi ${host}`,
    vendor: "unifi",
    kind,
    url,
    site: getSetting("integration_unifi_site")?.trim() || "default",
    username: kind === "self_hosted" ? (getSetting("integration_unifi_username") ?? "").trim() : "",
    password_enc: kind === "self_hosted" ? reseal("integration_unifi_password") : "",
    api_key_enc: kind === "udm" ? reseal("integration_unifi_api_token") : "",
    cert_pin: pin,
    enabled: getSetting("integration_unifi_mode") === "external" ? 1 : 0,
    origin: "legacy_hub",
  });
  const jobsAttached = attachOrphanUnifiJobs(row.id);
  setTenantSetting(LEGACY_MARK, `done:${row.id}`);
  console.info(
    `[controllers] tenant ${getCurrentTenantCode()}: configurazione UniFi dell'hub portata nel controller #${row.id}` +
      ` (${jobsAttached} job collegati)`,
  );
  return { state: "done", controllerId: row.id, jobsAttached };
}

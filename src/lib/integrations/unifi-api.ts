/**
 * Client del controller UniFi — SOLA LETTURA.
 *
 * Backend `self_hosted` (Network Application classica, es. DTS 10.6.1):
 *   POST /api/login {username, password, remember:false}
 *     → cookie di sessione (`unifises`, `csrf_token`) e, se c'è, X-CSRF-Token
 *   GET  /api/s/<site>/stat/device → apparati (vedi `unifi-device.ts`)
 *   POST /api/logout
 * Nient'altro: ogni richiesta passa da `isUnifiRequestAllowed`, che conosce
 * solo questi tre percorsi. Il client non scrive mai sul controller.
 * Backend `udm` e `cloud`: «backend non ancora implementato» (fase D).
 *
 * Certificato: il controller è self-signed, quindi niente CA. Si usa lo
 * stesso schema del `cert_pin` dello scanner-edge — impronta SPKI calcolata
 * da `spkiPinFromDer`, fissata al primo uso (TOFU):
 * - nessuna impronta salvata → quella presentata vale per la sessione e si
 *   salva SOLO se la sessione riesce (login + lettura), così un indirizzo
 *   sbagliato non lascia un pin sbagliato;
 * - impronta salvata e uguale → si procede;
 * - impronta salvata e diversa → errore «certificato del controller
 *   cambiato», mai accettato in silenzio. Rinnovarla è un'azione esplicita
 *   (`unifiCertPinStore` in config.ts).
 * A differenza dello scanner-edge (sonda TLS separata, poi un socket nuovo),
 * qui la verifica avviene sul socket che porta la richiesta: la password del
 * controller non parte mai prima che l'impronta sia stata controllata.
 */

import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { request as httpsRequest } from "node:https";
import type { IncomingHttpHeaders } from "node:http";
import { isIP } from "node:net";
import { spkiPinFromDer } from "@/lib/vuln/scanner-edge-client";
import { mergeCookieHeader, parseSetCookies } from "./librenms-web-session";
import { parseStatDeviceResponse, UnifiResponseError, type UnifiDevice } from "./unifi-device";
import type { ComponentConfig, UnifiCertPinStore, UnifiKind } from "./types";

// ── Errori ───────────────────────────────────────────────────────────────────

/**
 * Motivo di un fallimento, per un messaggio chiaro a chi configura:
 * auth = credenziali/permessi · network = non raggiungibile · server = il
 * controller sbaglia · cert = certificato cambiato o illeggibile · config =
 * configurazione incompleta o indirizzo/site sbagliati · not_implemented =
 * backend udm/cloud · unknown = il resto.
 */
export type UnifiErrorReason =
  | "auth"
  | "network"
  | "server"
  | "cert"
  | "config"
  | "not_implemented"
  | "unknown";

export class UnifiApiError extends Error {
  readonly reason: UnifiErrorReason;
  readonly status: number;
  /** Solo per reason "cert": impronta presentata dal controller. */
  readonly presentedPin: string | null;
  /** Solo per reason "cert": impronta fissata al primo uso. */
  readonly expectedPin: string | null;
  constructor(
    reason: UnifiErrorReason,
    message: string,
    opts: { status?: number; presentedPin?: string; expectedPin?: string } = {},
  ) {
    super(message);
    this.name = "UnifiApiError";
    this.reason = reason;
    this.status = opts.status ?? 0;
    this.presentedPin = opts.presentedPin ?? null;
    this.expectedPin = opts.expectedPin ?? null;
  }
}

export const UNIFI_CERT_CHANGED_MESSAGE =
  "Certificato del controller cambiato: l'impronta presentata non è quella fissata al primo " +
  "collegamento. Può essere un rinnovo del certificato o un'intercettazione; nessuna " +
  "credenziale è stata inviata. Se il rinnovo è atteso, accettare la nuova impronta " +
  "dalla configurazione UniFi.";

function toUnifiError(e: unknown): UnifiApiError {
  if (e instanceof UnifiApiError) return e;
  return new UnifiApiError("unknown", e instanceof Error ? e.message : String(e));
}

// ── Pin del certificato (logica pura) ────────────────────────────────────────

export type CertPinDecision =
  | { action: "record"; pin: string }
  | { action: "match"; pin: string }
  | { action: "mismatch"; expected: string; presented: string };

/**
 * Cosa fare con l'impronta presentata dal controller, dato quella attesa.
 * Le impronte sono nella forma canonica `sha256/<base64>` (lo store le
 * normalizza con `normalizeSpkiPin`). Vuota o assente = primo uso.
 */
export function decideCertPin(expected: string | null | undefined, presented: string): CertPinDecision {
  const exp = (expected ?? "").trim();
  if (exp === "") return { action: "record", pin: presented };
  if (exp === presented) return { action: "match", pin: presented };
  return { action: "mismatch", expected: exp, presented };
}

/** Impronta di una sessione: attesa (salvata o vista al primo contatto) e da salvare. */
export interface UnifiPinSession {
  expected: string | null;
  /** Impronta vista al primo uso: si salva solo se la sessione riesce. */
  recorded: string | null;
}

/**
 * Applica la decisione a una sessione: al primo uso fissa l'impronta per le
 * connessioni successive della stessa sessione; se non combacia lancia
 * l'errore «certificato del controller cambiato».
 */
export function checkPresentedPin(pins: UnifiPinSession, presented: string): void {
  const d = decideCertPin(pins.expected, presented);
  if (d.action === "mismatch") {
    throw new UnifiApiError("cert", UNIFI_CERT_CHANGED_MESSAGE, {
      presentedPin: d.presented,
      expectedPin: d.expected,
    });
  }
  if (d.action === "record") {
    pins.expected = d.pin;
    pins.recorded = d.pin;
  }
}

// ── Sola lettura: le uniche richieste ammesse ────────────────────────────────

const SITE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** true solo per login, logout e lettura degli apparati di un site. */
export function isUnifiRequestAllowed(method: string, path: string): boolean {
  if (method === "POST") return path === "/api/login" || path === "/api/logout";
  if (method === "GET") {
    const m = /^\/api\/s\/([^/]+)\/stat\/device$/.exec(path);
    return m !== null && SITE_RE.test(m[1]);
  }
  return false;
}

// ── Classificazione degli errori HTTP (logica pura) ──────────────────────────

/** `meta.msg` di una risposta del controller (es. "api.err.Invalid"), se c'è. */
export function controllerMsgFromBody(body: string): string | null {
  try {
    const j: unknown = JSON.parse(body);
    if (j && typeof j === "object") {
      const meta = (j as { meta?: unknown }).meta;
      if (meta && typeof meta === "object") {
        const msg = (meta as { msg?: unknown }).msg;
        if (typeof msg === "string" && msg.trim() !== "") return msg.trim();
      }
    }
  } catch {
    /* non JSON: nessun messaggio del controller */
  }
  return null;
}

export function classifyUnifiHttpError(
  status: number,
  controllerMsg: string | null,
  ctx: { step: "login" | "lettura"; site?: string },
): { reason: UnifiErrorReason; message: string } {
  const msg = controllerMsg ?? "";
  if (/2fa|mfa/i.test(msg)) {
    return {
      reason: "auth",
      message:
        "L'account richiede la verifica in due passaggi: serve un account locale del controller, " +
        "senza 2FA e in sola lettura",
    };
  }
  if (msg === "api.err.NoSiteContext" || msg === "api.err.InvalidSite") {
    return {
      reason: "config",
      message: `Site «${ctx.site ?? "?"}» non trovato sul controller: serve il nome interno del site (es. "default"), non quello mostrato`,
    };
  }
  if (msg === "api.err.NoPermission") {
    return { reason: "auth", message: "L'account del controller non ha il permesso di leggere gli apparati del site" };
  }
  if (status === 401 || status === 403 || msg === "api.err.Invalid" || msg === "api.err.LoginRequired") {
    return {
      reason: "auth",
      message:
        ctx.step === "login"
          ? "Credenziali del controller rifiutate (utente o password errati)"
          : "Il controller ha rifiutato la sessione durante la lettura degli apparati",
    };
  }
  if (status === 429) {
    return { reason: "auth", message: "Troppi tentativi di accesso: il controller ha sospeso i login per qualche minuto" };
  }
  if (status === 404) {
    return {
      reason: "config",
      message:
        "Percorso API inesistente: l'indirizzo non punta a un controller UniFi self-hosted " +
        "(per una console UniFi OS il tipo è «udm»)",
    };
  }
  if (status >= 300 && status < 400) {
    return {
      reason: "config",
      message: `Il controller risponde con un rinvio (HTTP ${status}): controllare indirizzo e porta (di solito https://…:8443)`,
    };
  }
  if (status >= 500) {
    return { reason: "server", message: `Errore interno del controller (HTTP ${status})` };
  }
  return {
    reason: "unknown",
    message: `Risposta inattesa dal controller (HTTP ${status}${msg ? `, ${msg}` : ""})`,
  };
}

function httpError(
  res: UnifiHttpResponse,
  ctx: { step: "login" | "lettura"; site?: string },
): UnifiApiError {
  const c = classifyUnifiHttpError(res.status, controllerMsgFromBody(res.body), ctx);
  return new UnifiApiError(c.reason, c.message, { status: res.status });
}

const NETWORK_CODES: Record<string, string> = {
  ECONNREFUSED: "connessione rifiutata",
  ETIMEDOUT: "tempo scaduto",
  EHOSTUNREACH: "host irraggiungibile",
  ENETUNREACH: "rete irraggiungibile",
  ENOTFOUND: "nome non risolto",
  EAI_AGAIN: "DNS non disponibile",
  ECONNRESET: "connessione interrotta",
  EPIPE: "connessione interrotta",
};

function networkError(e: unknown): UnifiApiError {
  if (e instanceof UnifiApiError) return e;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && NETWORK_CODES[code]) {
    return new UnifiApiError("network", `Controller non raggiungibile: ${NETWORK_CODES[code]} (${code})`);
  }
  if (typeof code === "string" && /^(ERR_SSL|EPROTO)/.test(code)) {
    return new UnifiApiError(
      "network",
      `Errore TLS verso il controller (${code}): l'indirizzo è https su una porta che non parla TLS?`,
    );
  }
  return new UnifiApiError("network", `Controller non raggiungibile: ${e instanceof Error ? e.message : String(e)}`);
}

// ── Trasporto HTTPS con verifica dell'impronta sullo stesso socket ───────────

export interface UnifiHttpRequest {
  method: "GET" | "POST";
  /** Percorso API (es. "/api/login"), senza l'eventuale prefisso dell'URL. */
  path: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export interface UnifiHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export type UnifiTransport = (req: UnifiHttpRequest) => Promise<UnifiHttpResponse>;
export type UnifiTransportFactory = (base: URL, pins: UnifiPinSession) => UnifiTransport;

/** Tetto alla risposta: ~35 KB per apparato, 64 MB bastano per ~1800 apparati. */
const MAX_BODY_BYTES = 64 * 1024 * 1024;

function hostOf(base: URL): string {
  // URL.hostname tiene le quadre degli IPv6 ("[::1]"): tls.connect le vuole senza.
  return base.hostname.replace(/^\[(.*)\]$/, "$1");
}

/**
 * Apre la connessione TLS, legge il certificato e applica il pin PRIMA di
 * restituire il socket: nessun byte applicativo (quindi nessuna password)
 * passa su un socket non verificato.
 */
function openPinnedSocket(host: string, port: number, pins: UnifiPinSession, timeoutMs: number): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const sock = tlsConnect({
      host,
      port,
      // Niente CA (self-signed): l'autorità è l'impronta, verificata qui sotto.
      rejectUnauthorized: false,
      // SNI solo con un nome: con un IP Node avvisa (RFC 6066) e non serve.
      ...(isIP(host) ? {} : { servername: host }),
    });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new UnifiApiError("network", `Controller non raggiungibile: nessuna risposta TLS entro ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    sock.once("secureConnect", () => {
      clearTimeout(timer);
      const cert = sock.getPeerCertificate(true);
      if (!cert || !cert.raw || cert.raw.length === 0) {
        sock.destroy();
        reject(new UnifiApiError("cert", "Il controller non ha presentato un certificato leggibile"));
        return;
      }
      try {
        checkPresentedPin(pins, spkiPinFromDer(cert.raw));
      } catch (e) {
        sock.destroy();
        reject(
          e instanceof UnifiApiError
            ? e
            : new UnifiApiError("cert", `Certificato del controller illeggibile: ${(e as Error).message}`),
        );
        return;
      }
      resolve(sock);
    });
    sock.once("error", (e) => {
      clearTimeout(timer);
      reject(networkError(e));
    });
  });
}

function sendOverSocket(
  sock: TLSSocket,
  host: string,
  port: number,
  fullPath: string,
  req: UnifiHttpRequest,
): Promise<UnifiHttpResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Connection: "close",
      ...req.headers,
    };
    if (req.body !== undefined) headers["Content-Length"] = String(Buffer.byteLength(req.body));
    const r = httpsRequest(
      {
        host,
        port,
        method: req.method,
        path: fullPath,
        headers,
        // Il socket già verificato: niente agent, niente secondo handshake.
        createConnection: () => sock,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let total = 0;
        let aborted = false;
        res.on("data", (c: Buffer) => {
          if (aborted) return;
          total += c.length;
          if (total > MAX_BODY_BYTES) {
            aborted = true;
            r.destroy();
            reject(new UnifiApiError("server", "Risposta del controller oltre 64 MB: lettura interrotta"));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          if (aborted) return;
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8") });
        });
        res.on("error", (e) => {
          if (!aborted) reject(networkError(e));
        });
      },
    );
    r.on("error", (e) => reject(networkError(e)));
    r.setTimeout(req.timeoutMs, () => {
      r.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    });
    if (req.body !== undefined) r.write(req.body);
    r.end();
  });
}

/** Trasporto vero: una connessione TLS verificata per richiesta. */
export const pinnedTransportFactory: UnifiTransportFactory = (base, pins) => {
  const host = hostOf(base);
  const port = base.port ? Number(base.port) : 443;
  const prefix = base.pathname.replace(/\/+$/, "");
  return async (req) => {
    const sock = await openPinnedSocket(host, port, pins, req.timeoutMs);
    return sendOverSocket(sock, host, port, prefix + req.path, req);
  };
};

function readOnly(t: UnifiTransport): UnifiTransport {
  return (req) => {
    if (!isUnifiRequestAllowed(req.method, req.path)) {
      return Promise.reject(
        new UnifiApiError("unknown", `Richiesta non consentita verso il controller (${req.method} ${req.path}): il client è in sola lettura`),
      );
    }
    return t(req);
  };
}

// ── Client ───────────────────────────────────────────────────────────────────

export type UnifiClientConfig = Pick<ComponentConfig, "url"> &
  Partial<Pick<ComponentConfig, "kind" | "site" | "username" | "password" | "apiToken">>;

export type UnifiProbeResult =
  | { ok: true; devices: number; certPin: string | null; certPinRecorded: boolean }
  | {
      ok: false;
      reason: UnifiErrorReason;
      message: string;
      presentedPin?: string;
      expectedPin?: string;
    };

export interface UnifiClient {
  readonly kind: UnifiKind;
  /** Login + lettura + logout; al primo uso riuscito fissa l'impronta. Non lancia. */
  probe(): Promise<UnifiProbeResult>;
  /** Apparati del site. Lancia `UnifiApiError`. */
  listDevices(): Promise<UnifiDevice[]>;
}

export interface UnifiClientOptions {
  /** Solo per le prove: sostituisce la rete. */
  transportFactory?: UnifiTransportFactory;
  loginTimeoutMs?: number;
  readTimeoutMs?: number;
}

interface UnifiSession {
  cookie: string;
  csrf: string | null;
}

function sessionHeaders(s: UnifiSession): Record<string, string> {
  const h: Record<string, string> = { Cookie: s.cookie };
  if (s.csrf) h["X-CSRF-Token"] = s.csrf;
  return h;
}

function cookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const t = part.trim();
    if (t.startsWith(`${name}=`)) return t.slice(name.length + 1) || null;
  }
  return null;
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new UnifiApiError(
      "config",
      "Risposta del controller non leggibile (non è JSON): l'indirizzo punta davvero a un controller UniFi?",
    );
  }
}

function validateSelfHosted(cfg: UnifiClientConfig): { base: URL; site: string; username: string; password: string } {
  const raw = (cfg.url ?? "").trim();
  if (!raw) throw new UnifiApiError("config", "Indirizzo del controller non configurato");
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new UnifiApiError("config", "Indirizzo del controller non valido");
  }
  if (base.protocol !== "https:") {
    throw new UnifiApiError("config", "Il controller si legge solo in https (di solito https://…:8443)");
  }
  const site = (cfg.site ?? "").trim() || "default";
  if (!SITE_RE.test(site)) throw new UnifiApiError("config", `Nome del site non valido: «${site}»`);
  const username = (cfg.username ?? "").trim();
  const password = cfg.password ?? "";
  if (!username || !password) throw new UnifiApiError("config", "Utente e password del controller non configurati");
  return { base, site, username, password };
}

async function login(
  send: UnifiTransport,
  username: string,
  password: string,
  timeoutMs: number,
): Promise<UnifiSession> {
  const res = await send({
    method: "POST",
    path: "/api/login",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, remember: false }),
    timeoutMs,
  });
  if (res.status !== 200) throw httpError(res, { step: "login" });
  const json = parseJsonBody(res.body);
  const rc = (json as { meta?: { rc?: unknown } } | null)?.meta?.rc;
  if (rc !== "ok") {
    const c = classifyUnifiHttpError(res.status, controllerMsgFromBody(res.body), { step: "login" });
    throw new UnifiApiError(c.reason, c.message, { status: res.status });
  }
  const cookie = mergeCookieHeader("", parseSetCookies(res.headers));
  if (!cookie) {
    throw new UnifiApiError("unknown", "Il controller ha accettato il login ma non ha aperto una sessione (nessun cookie)");
  }
  const h = res.headers["x-csrf-token"];
  const csrf = (Array.isArray(h) ? h[0] : h) || cookieValue(cookie, "csrf_token");
  return { cookie, csrf: csrf ?? null };
}

async function statDevice(send: UnifiTransport, s: UnifiSession, site: string, timeoutMs: number): Promise<UnifiDevice[]> {
  const res = await send({ method: "GET", path: `/api/s/${site}/stat/device`, headers: sessionHeaders(s), timeoutMs });
  if (res.status !== 200) throw httpError(res, { step: "lettura", site });
  const json = parseJsonBody(res.body);
  try {
    return parseStatDeviceResponse(json);
  } catch (e) {
    if (e instanceof UnifiResponseError) {
      const c = classifyUnifiHttpError(res.status, e.controllerMsg, { step: "lettura", site });
      // Un rc di errore senza codice noto resta un errore del controller.
      if (c.reason === "unknown") throw new UnifiApiError("server", e.message, { status: res.status });
      throw new UnifiApiError(c.reason, c.message, { status: res.status });
    }
    throw e;
  }
}

async function logout(send: UnifiTransport, s: UnifiSession, timeoutMs: number): Promise<void> {
  await send({
    method: "POST",
    path: "/api/logout",
    headers: { ...sessionHeaders(s), "Content-Type": "application/json" },
    body: "{}",
    timeoutMs,
  });
}

/**
 * Client per la configurazione `integration_unifi_*` (vedi
 * `getIntegrationConfig("unifi")`). `pinStore` è obbligatorio: senza, ogni
 * sessione sarebbe un primo uso e il pin non proteggerebbe niente.
 */
export function createUnifiClient(
  cfg: UnifiClientConfig,
  pinStore: UnifiCertPinStore,
  opts: UnifiClientOptions = {},
): UnifiClient {
  const kind: UnifiKind = cfg.kind ?? "self_hosted";
  const factory = opts.transportFactory ?? pinnedTransportFactory;
  const loginTimeoutMs = opts.loginTimeoutMs ?? 15_000;
  const readTimeoutMs = opts.readTimeoutMs ?? 60_000;

  async function readDevices(): Promise<{ devices: UnifiDevice[]; pin: string | null; recorded: boolean }> {
    if (kind !== "self_hosted") {
      throw new UnifiApiError(
        "not_implemented",
        `Backend «${kind}» non ancora implementato: per ora si legge solo il controller self-hosted`,
      );
    }
    const { base, site, username, password } = validateSelfHosted(cfg);
    const pins: UnifiPinSession = { expected: pinStore.get(), recorded: null };
    const send = readOnly(factory(base, pins));

    const session = await login(send, username, password, loginTimeoutMs);
    let devices: UnifiDevice[] = [];
    let failure: UnifiApiError | null = null;
    try {
      devices = await statDevice(send, session, site, readTimeoutMs);
    } catch (e) {
      failure = toUnifiError(e);
    }
    // Logout sempre, anche dopo un errore di lettura; un suo fallimento non
    // annulla la lettura, tranne un certificato cambiato a metà sessione.
    let logoutFailure: UnifiApiError | null = null;
    try {
      await logout(send, session, loginTimeoutMs);
    } catch (e) {
      logoutFailure = toUnifiError(e);
    }
    if (failure) throw failure;
    if (logoutFailure?.reason === "cert") throw logoutFailure;

    if (pins.recorded) pinStore.set(pins.recorded);
    return { devices, pin: pins.expected, recorded: pins.recorded !== null };
  }

  return {
    kind,
    async probe() {
      try {
        const r = await readDevices();
        return { ok: true, devices: r.devices.length, certPin: r.pin, certPinRecorded: r.recorded };
      } catch (e) {
        const err = toUnifiError(e);
        return {
          ok: false,
          reason: err.reason,
          message: err.message,
          ...(err.presentedPin ? { presentedPin: err.presentedPin } : {}),
          ...(err.expectedPin ? { expectedPin: err.expectedPin } : {}),
        };
      }
    },
    async listDevices() {
      try {
        return (await readDevices()).devices;
      } catch (e) {
        throw toUnifiError(e);
      }
    },
  };
}

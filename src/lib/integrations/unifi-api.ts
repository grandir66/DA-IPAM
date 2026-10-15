/**
 * Client del controller UniFi — SOLA LETTURA.
 *
 * Backend `self_hosted` (Network Application classica, es. cliente A 10.6.1):
 *   POST /api/login {username, password, remember:false}
 *     → cookie di sessione (`unifises`, `csrf_token`) e, se c'è, X-CSRF-Token
 *   GET  /api/s/<site>/stat/device → apparati (vedi `unifi-device.ts`)
 *   GET  /api/s/<site>/stat/sta    → client collegati (vedi `unifi-clients.ts`)
 *   POST /api/logout
 *   GET  /api/self/sites → i site, per sceglierne uno (facoltativo)
 *
 * Backend `udm` (console UniFi OS: UDM, UDM Pro/Beast, Cloud Key Gen2+), due vie:
 * - chiave API creata sulla console, nell'app Network (Control Plane, poi
 *   Integrazioni), intestazione X-API-KEY a ogni richiesta, niente login;
 * - utente LOCALE e password (ADR 0019), quando la chiave non si può creare:
 *   POST /api/auth/login {username, password, rememberMe:false}
 *     → cookie TOKEN e intestazione x-csrf-token (aggiornata da x-updated-csrf-token)
 *   POST /api/auth/logout alla fine. Un login rifiutato non si ritenta mai nel
 *   giro: la console blocca l'account dopo troppi tentativi.
 * Le letture, per tutte e due:
 *   GET  /proxy/network/api/s/<site>/stat/device
 *   GET  /proxy/network/api/s/<site>/stat/sta
 *   GET  /proxy/network/api/self/sites
 *
 * Nient'altro: ogni richiesta passa da `isUnifiRequestAllowed`, che conosce
 * solo questi percorsi. Il client non scrive mai sul controller. Unica
 * eccezione, fuori da quell'elenco e senza credenziali: `detectUnifiOs`, una
 * GET / anonima per dire «questa è una console UniFi OS» a chi ha scelto
 * self-hosted.
 * Backend `cloud`: «backend non ancora implementato».
 *
 * Certificato: il controller è self-signed, quindi niente CA. Si usa lo
 * stesso schema del `cert_pin` dello scanner-edge — impronta SPKI calcolata
 * da `spkiPinFromDer`, fissata al primo uso (TOFU), uguale per i due backend:
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
import { parseStatStaResponse, type UnifiStaClient } from "./unifi-clients";
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

/** Prefisso dell'applicazione Network dietro una console UniFi OS. */
export const UNIFI_OS_PREFIX = "/proxy/network";

/** I soli POST: login e logout, della Network Application e di UniFi OS. */
const ALLOWED_POSTS: ReadonlySet<string> = new Set(["/api/login", "/api/logout", "/api/auth/login", "/api/auth/logout"]);

/**
 * true solo per login e logout (self-hosted e UniFi OS), lettura degli apparati
 * e dei client collegati di un site ed elenco dei site, con o senza il prefisso
 * delle console UniFi OS. Tutte GET di `stat/`: nessun comando (`cmd/`), mai.
 */
export function isUnifiRequestAllowed(method: string, path: string): boolean {
  if (method === "POST") return ALLOWED_POSTS.has(path);
  if (method === "GET") {
    const rest = path.startsWith(`${UNIFI_OS_PREFIX}/`) ? path.slice(UNIFI_OS_PREFIX.length) : path;
    if (rest === "/api/self/sites") return true;
    const m = /^\/api\/s\/([^/]+)\/stat\/(device|sta)$/.exec(rest);
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

/**
 * Contesto di un errore: il passo e, per una lettura, che cosa si leggeva
 * (apparati di default). `unifiOs` = sessione con utente locale su una console
 * UniFi OS (ADR 0019).
 */
type ErrorCtx = { step: "login" | "lettura"; site?: string; apiKey?: boolean; unifiOs?: boolean; what?: "device" | "sta" };

export const UNIFI_OS_LOGIN_MESSAGES = {
  401: "Utente o password non accettati dalla console",
  403:
    "Account senza permessi sull'app Network o con la verifica in due passaggi: serve un account locale " +
    "senza 2FA, con almeno la lettura dell'app Network",
  429: "La console ha bloccato i tentativi: riprova fra qualche minuto (nessun nuovo tentativo in questo giro)",
} as const;

export function classifyUnifiHttpError(
  status: number,
  controllerMsg: string | null,
  ctx: ErrorCtx,
): { reason: UnifiErrorReason; message: string } {
  const msg = controllerMsg ?? "";
  const cosa = ctx.what === "sta" ? "client" : "apparati";
  if (ctx.unifiOs && ctx.step === "login") {
    if (status === 401) return { reason: "auth", message: UNIFI_OS_LOGIN_MESSAGES[401] };
    // 499 = la console chiede il secondo fattore (MFA_AUTH_REQUIRED): stesso rimedio del 403.
    if (status === 403 || status === 499) return { reason: "auth", message: UNIFI_OS_LOGIN_MESSAGES[403] };
    if (status === 429) return { reason: "auth", message: UNIFI_OS_LOGIN_MESSAGES[429] };
  }
  if (ctx.unifiOs && ctx.step === "lettura" && status === 403) {
    return {
      reason: "auth",
      message: `L'account della console non ha il permesso di leggere ${cosa === "client" ? "i client" : "gli apparati"} nell'app Network: serve almeno la lettura`,
    };
  }
  if (ctx.apiKey && (status === 401 || status === 403)) {
    return {
      reason: "auth",
      message:
        "Chiave API rifiutata dalla console UniFi OS: è stata revocata, o è stata creata su un'altra console " +
        "(si crea sulla console, nell'app Network: Control Plane, poi Integrazioni)",
    };
  }
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
    return {
      reason: "auth",
      message: `L'account del controller non ha il permesso di leggere ${cosa === "client" ? "i client" : "gli apparati"} del site`,
    };
  }
  if (status === 401 || status === 403 || msg === "api.err.Invalid" || msg === "api.err.LoginRequired") {
    return {
      reason: "auth",
      message:
        ctx.step === "login"
          ? "Credenziali del controller rifiutate (utente o password errati)"
          : `Il controller ha rifiutato la sessione durante la lettura ${cosa === "client" ? "dei client" : "degli apparati"}`,
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

function httpError(res: UnifiHttpResponse, ctx: ErrorCtx): UnifiApiError {
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

/** Un site del controller: `name` è il nome interno da configurare, `desc` quello mostrato. */
export interface UnifiSite {
  name: string;
  desc: string;
}

export type UnifiProbeResult =
  | {
      ok: true;
      devices: number;
      certPin: string | null;
      certPinRecorded: boolean;
      /** Site del controller, se l'elenco si è potuto leggere (facoltativo). */
      sites?: UnifiSite[];
    }
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
  /** Client collegati del site (stat/sta). Lancia `UnifiApiError`. */
  listClients(): Promise<UnifiStaClient[]>;
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

function parseBaseUrl(cfg: UnifiClientConfig, hint: string): URL {
  const raw = (cfg.url ?? "").trim();
  if (!raw) throw new UnifiApiError("config", "Indirizzo del controller non configurato");
  let base: URL;
  try {
    base = new URL(raw);
  } catch {
    throw new UnifiApiError("config", "Indirizzo del controller non valido");
  }
  if (base.protocol !== "https:") {
    throw new UnifiApiError("config", `Il controller si legge solo in https (${hint})`);
  }
  return base;
}

function parseSite(cfg: UnifiClientConfig): string {
  const site = (cfg.site ?? "").trim() || "default";
  if (!SITE_RE.test(site)) throw new UnifiApiError("config", `Nome del site non valido: «${site}»`);
  return site;
}

function validateSelfHosted(cfg: UnifiClientConfig): { base: URL; site: string; username: string; password: string } {
  const base = parseBaseUrl(cfg, "di solito https://…:8443");
  const site = parseSite(cfg);
  const username = (cfg.username ?? "").trim();
  const password = cfg.password ?? "";
  if (!username || !password) throw new UnifiApiError("config", "Utente e password del controller non configurati");
  return { base, site, username, password };
}

/** Come si entra in una console UniFi OS: la chiave se c'è, altrimenti utente locale e password. */
type UnifiOsCredentials = { apiKey: string } | { username: string; password: string };

function validateUnifiOs(cfg: UnifiClientConfig): { base: URL; site: string; cred: UnifiOsCredentials } {
  const base = parseBaseUrl(cfg, "l'indirizzo della console, es. https://192.168.1.1");
  const site = parseSite(cfg);
  const apiKey = (cfg.apiToken ?? "").trim();
  if (apiKey) return { base, site, cred: { apiKey } };
  const username = (cfg.username ?? "").trim();
  const password = cfg.password ?? "";
  if (username && password) return { base, site, cred: { username, password } };
  throw new UnifiApiError(
    "config",
    "Chiave API della console UniFi OS non configurata, e nemmeno utente locale e password",
  );
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
  const csrf = headerValue(res.headers, "x-csrf-token") || cookieValue(cookie, "csrf_token");
  return { cookie, csrf: csrf ?? null };
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | null {
  const h = headers[name];
  const v = Array.isArray(h) ? h[0] : h;
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Login con utente LOCALE su una console UniFi OS (ADR 0019). Un tentativo
 * solo: 401/403/429 tornano col loro messaggio e nessuno lo ripete.
 */
async function unifiOsLogin(
  send: UnifiTransport,
  username: string,
  password: string,
  timeoutMs: number,
): Promise<UnifiSession> {
  const res = await send({
    method: "POST",
    path: "/api/auth/login",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, rememberMe: false }),
    timeoutMs,
  });
  if (res.status !== 200) throw httpError(res, { step: "login", unifiOs: true });
  const token = cookieValue(mergeCookieHeader("", parseSetCookies(res.headers)), "TOKEN");
  if (!token) {
    throw new UnifiApiError("unknown", "La console ha accettato il login ma non ha aperto una sessione (nessun cookie TOKEN)");
  }
  return { cookie: `TOKEN=${token}`, csrf: headerValue(res.headers, "x-csrf-token") };
}

/** La console può rinnovare il CSRF a ogni risposta: le richieste dopo usano quello nuovo. */
function trackCsrf(send: UnifiTransport, s: UnifiSession): UnifiTransport {
  return async (req) => {
    const res = await send(req);
    const updated = headerValue(res.headers, "x-updated-csrf-token");
    if (updated) s.csrf = updated;
    return res;
  };
}

/**
 * Come si autentica una lettura: sessione (self-hosted, o UniFi OS con utente
 * locale) o chiave API (UniFi OS). `headers` si chiede a ogni richiesta: il
 * CSRF della sessione può cambiare a metà.
 */
interface ReadAuth {
  prefix: string;
  headers: () => Record<string, string>;
  apiKey: boolean;
  unifiOs: boolean;
}

/** Una lettura `stat/<what>` del site: stessa gestione degli errori per apparati e client. */
type StatReader<T> = (send: UnifiTransport, auth: ReadAuth, site: string, timeoutMs: number) => Promise<T>;

function statReader<T>(what: "device" | "sta", parse: (json: unknown) => T): StatReader<T> {
  return (send, auth, site, timeoutMs) => statGet(send, auth, site, timeoutMs, what, parse);
}

const statDevice = statReader("device", parseStatDeviceResponse);
const statSta = statReader("sta", parseStatStaResponse);

async function statGet<T>(
  send: UnifiTransport,
  auth: ReadAuth,
  site: string,
  timeoutMs: number,
  what: "device" | "sta",
  parse: (json: unknown) => T,
): Promise<T> {
  const res = await send({ method: "GET", path: `${auth.prefix}/api/s/${site}/stat/${what}`, headers: auth.headers(), timeoutMs });
  const ctx: ErrorCtx = { step: "lettura", site, apiKey: auth.apiKey, unifiOs: auth.unifiOs, what };
  if (res.status !== 200) throw httpError(res, ctx);
  const json = parseJsonBody(res.body);
  try {
    return parse(json);
  } catch (e) {
    if (e instanceof UnifiResponseError) {
      const c = classifyUnifiHttpError(res.status, e.controllerMsg, ctx);
      // Un rc di errore senza codice noto resta un errore del controller.
      if (c.reason === "unknown") throw new UnifiApiError("server", e.message, { status: res.status });
      throw new UnifiApiError(c.reason, c.message, { status: res.status });
    }
    throw e;
  }
}

/** Legge `data[]` di una risposta `self/sites`; voci senza nome interno scartate. */
export function parseSitesResponse(json: unknown): UnifiSite[] {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: UnifiSite[] = [];
  for (const x of data) {
    if (!x || typeof x !== "object") continue;
    const name = (x as { name?: unknown }).name;
    const desc = (x as { desc?: unknown }).desc;
    if (typeof name !== "string" || !SITE_RE.test(name)) continue;
    out.push({ name, desc: typeof desc === "string" && desc.trim() ? desc.trim() : name });
  }
  return out;
}

/** Elenco dei site: facoltativo, un suo errore non fa fallire la prova (null = non letto). */
async function selfSites(send: UnifiTransport, auth: ReadAuth, timeoutMs: number): Promise<UnifiSite[] | null> {
  try {
    const res = await send({ method: "GET", path: `${auth.prefix}/api/self/sites`, headers: auth.headers(), timeoutMs });
    if (res.status !== 200) return null;
    return parseSitesResponse(JSON.parse(res.body) as unknown);
  } catch (e) {
    // Un certificato cambiato a metà sessione non è «site non letti».
    if (e instanceof UnifiApiError && e.reason === "cert") throw e;
    return null;
  }
}

async function logout(send: UnifiTransport, s: UnifiSession, timeoutMs: number, path = "/api/logout"): Promise<void> {
  await send({
    method: "POST",
    path,
    headers: { ...sessionHeaders(s), "Content-Type": "application/json" },
    body: "{}",
    timeoutMs,
  });
}

export const UNIFI_OS_DETECTED_MESSAGE =
  "Questo indirizzo è una console UniFi OS: scegli UDM come tipo, con la chiave API o con un utente locale e la password";

const UNIFI_OS_TITLE_RE = /<title>\s*UniFi OS\s*<\/title>/i;

/**
 * GET / anonima: la pagina di una console UniFi OS ha il titolo «UniFi OS»
 * (la Network Application classica rinvia a /manage). Nessuna credenziale,
 * nessun cookie. Serve solo a spiegare un fallimento: un suo errore = false,
 * e resta il messaggio di prima.
 */
async function looksLikeUnifiOs(raw: UnifiTransport, timeoutMs: number): Promise<boolean> {
  try {
    const res = await raw({ method: "GET", path: "/", headers: { Accept: "text/html" }, timeoutMs });
    return res.status === 200 && UNIFI_OS_TITLE_RE.test(res.body);
  } catch {
    return false;
  }
}

/**
 * «Questo indirizzo è una console UniFi OS?» per l'avviso al salvataggio di un
 * controller self-hosted. Impronta usa e getta: nessuna credenziale parte, e
 * niente si fissa. Non lancia.
 */
export async function detectUnifiOs(url: string, opts: Pick<UnifiClientOptions, "transportFactory"> = {}): Promise<boolean> {
  let base: URL;
  try {
    base = parseBaseUrl({ url }, "");
  } catch {
    return false;
  }
  const factory = opts.transportFactory ?? pinnedTransportFactory;
  return looksLikeUnifiOs(factory(base, { expected: null, recorded: null }), 5_000);
}

/**
 * Client per un controller UniFi (`cfg`: indirizzo, tipo, site, credenziali).
 * `pinStore` è obbligatorio: senza, ogni sessione sarebbe un primo uso e il
 * pin non proteggerebbe niente.
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

  interface ReadResult<T> {
    data: T;
    sites: UnifiSite[] | null;
    pin: string | null;
    recorded: boolean;
  }

  /** Primo uso riuscito: si salva l'impronta (vedi in testa). */
  function commitPin(base: URL, pins: UnifiPinSession): boolean {
    // Primo uso (si registra solo partendo da nessuna impronta): si salva solo
    // se nel frattempo nessuno ne ha fissata una (prova riuscita, accetta) e se
    // la configurazione punta ancora a questo controller. Confronto e
    // scrittura sono sincroni: niente può infilarsi in mezzo.
    if (pins.recorded && pinStore.get() === null && (pinStore.matchesOrigin?.(base.origin) ?? true)) {
      pinStore.set(pins.recorded);
      return true;
    }
    return false;
  }

  /**
   * Una sessione intera: login, lettura (e site), logout SEMPRE, anche dopo
   * un errore di lettura; un fallimento del logout non annulla la lettura,
   * tranne un certificato cambiato a metà sessione. Il login non si ritenta.
   */
  async function readInSession<T>(
    send: UnifiTransport,
    base: URL,
    pins: UnifiPinSession,
    site: string,
    reader: StatReader<T>,
    withSites: boolean,
    s: { session: UnifiSession; prefix: string; unifiOs: boolean; logoutPath: string },
  ): Promise<ReadResult<T>> {
    const auth: ReadAuth = { prefix: s.prefix, headers: () => sessionHeaders(s.session), apiKey: false, unifiOs: s.unifiOs };
    let data: T | undefined;
    let sites: UnifiSite[] | null = null;
    let failure: UnifiApiError | null = null;
    try {
      data = await reader(send, auth, site, readTimeoutMs);
      if (withSites) sites = await selfSites(send, auth, loginTimeoutMs);
    } catch (e) {
      failure = toUnifiError(e);
    }
    let logoutFailure: UnifiApiError | null = null;
    try {
      await logout(send, s.session, loginTimeoutMs, s.logoutPath);
    } catch (e) {
      logoutFailure = toUnifiError(e);
    }
    if (failure) throw failure;
    if (logoutFailure?.reason === "cert") throw logoutFailure;
    const recorded = commitPin(base, pins);
    return { data: data as T, sites, pin: pins.expected, recorded };
  }

  async function readSelfHosted<T>(reader: StatReader<T>, withSites: boolean): Promise<ReadResult<T>> {
    const { base, site, username, password } = validateSelfHosted(cfg);
    const pins: UnifiPinSession = { expected: pinStore.get(), recorded: null };
    const raw = factory(base, pins);
    // Risposta del login, per capire se a rispondere è una Network Application.
    let loginBody: string | null = null;
    const send = readOnly(async (req) => {
      const res = await raw(req);
      if (req.path === "/api/login") loginBody = res.body;
      return res;
    });

    let session: UnifiSession;
    try {
      session = await login(send, username, password, loginTimeoutMs);
    } catch (e) {
      const err = toUnifiError(e);
      // Login fallito senza la risposta tipica della Network Application
      // (`meta.msg`): se l'indirizzo è una console UniFi OS lo si dice (il tipo
      // giusto è «udm»), invece di «credenziali» o «percorso inesistente».
      const classic = loginBody !== null && controllerMsgFromBody(loginBody) !== null;
      if (err.reason !== "cert" && err.reason !== "network" && !classic && (await looksLikeUnifiOs(raw, loginTimeoutMs))) {
        throw new UnifiApiError("config", UNIFI_OS_DETECTED_MESSAGE, { status: err.status });
      }
      throw err;
    }
    return readInSession(send, base, pins, site, reader, withSites, {
      session,
      prefix: "",
      unifiOs: false,
      logoutPath: "/api/logout",
    });
  }

  async function readUnifiOs<T>(reader: StatReader<T>, withSites: boolean): Promise<ReadResult<T>> {
    const { base, site, cred } = validateUnifiOs(cfg);
    const pins: UnifiPinSession = { expected: pinStore.get(), recorded: null };
    if ("username" in cred) {
      const session: UnifiSession = { cookie: "", csrf: null };
      const send = trackCsrf(readOnly(factory(base, pins)), session);
      Object.assign(session, await unifiOsLogin(send, cred.username, cred.password, loginTimeoutMs));
      return readInSession(send, base, pins, site, reader, withSites, {
        session,
        prefix: UNIFI_OS_PREFIX,
        unifiOs: true,
        logoutPath: "/api/auth/logout",
      });
    }
    const send = readOnly(factory(base, pins));
    const headers = { "X-API-KEY": cred.apiKey };
    const auth: ReadAuth = { prefix: UNIFI_OS_PREFIX, headers: () => ({ ...headers }), apiKey: true, unifiOs: false };
    const data = await reader(send, auth, site, readTimeoutMs);
    const sites = withSites ? await selfSites(send, auth, loginTimeoutMs) : null;
    const recorded = commitPin(base, pins);
    return { data, sites, pin: pins.expected, recorded };
  }

  async function read<T>(reader: StatReader<T>, withSites: boolean): Promise<ReadResult<T>> {
    if (kind === "self_hosted") return readSelfHosted(reader, withSites);
    if (kind === "udm") return readUnifiOs(reader, withSites);
    throw new UnifiApiError(
      "not_implemented",
      `Backend «${kind}» non ancora implementato: si leggono il controller self-hosted e le console UniFi OS`,
    );
  }

  return {
    kind,
    async probe() {
      try {
        const r = await read(statDevice, true);
        return {
          ok: true,
          devices: r.data.length,
          certPin: r.pin,
          certPinRecorded: r.recorded,
          ...(r.sites ? { sites: r.sites } : {}),
        };
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
        return (await read(statDevice, false)).data;
      } catch (e) {
        throw toUnifiError(e);
      }
    },
    async listClients() {
      try {
        return (await read(statSta, false)).data;
      } catch (e) {
        throw toUnifiError(e);
      }
    },
  };
}

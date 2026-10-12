/**
 * Parte pura della card «Controller UniFi» (tappa 2, Task 7): modulo della
 * configurazione, corpo del salvataggio e testi degli esiti di prova e
 * sincronizzazione. Provata in `__tests__/unifi-card.test.ts`.
 */
import type { UnifiKind } from "@/lib/integrations/types";
import type { UnifiErrorReason, UnifiProbeResult } from "@/lib/integrations/unifi-api";

/** Configurazione come la restituisce GET /api/integrations/unifi (mai i segreti). */
export interface UnifiSavedConfig {
  mode: "disabled" | "external";
  url: string;
  kind: UnifiKind;
  site: string;
  username: string;
  passwordSet: boolean;
  apiTokenSet: boolean;
  certPin: string | null;
  browserUrl: string;
}

/** Il modulo della card. Password e chiave sono vuote finché non si scrivono. */
export interface UnifiForm {
  mode: "disabled" | "external";
  url: string;
  kind: UnifiKind;
  site: string;
  username: string;
  password: string;
  apiToken: string;
}

/** Legge la risposta di GET /api/integrations/unifi in modo difensivo. */
export function parseUnifiSavedConfig(raw: unknown): UnifiSavedConfig {
  const c = ((raw as { config?: unknown } | null)?.config ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const kind: UnifiKind = c.kind === "udm" ? "udm" : c.kind === "cloud" ? "cloud" : "self_hosted";
  return {
    mode: c.mode === "external" ? "external" : "disabled",
    url: str(c.url),
    kind,
    site: str(c.site) || "default",
    username: str(c.username),
    passwordSet: c.passwordSet === true,
    apiTokenSet: c.apiTokenSet === true,
    certPin: str(c.certPin) || null,
    browserUrl: str(c.browserUrl),
  };
}

export function unifiFormFromConfig(cfg: UnifiSavedConfig): UnifiForm {
  return {
    mode: cfg.mode,
    url: cfg.url,
    kind: cfg.kind,
    site: cfg.site,
    username: cfg.username,
    password: "",
    apiToken: "",
  };
}

/** Il modulo è diverso da quanto salvato: prova e sync userebbero la configurazione vecchia. */
export function isUnifiFormDirty(form: UnifiForm, cfg: UnifiSavedConfig): boolean {
  return (
    form.mode !== cfg.mode ||
    form.url.trim() !== cfg.url ||
    form.kind !== cfg.kind ||
    (form.site.trim() || "default") !== cfg.site ||
    form.username.trim() !== cfg.username ||
    form.password !== "" ||
    form.apiToken.trim() !== ""
  );
}

/**
 * Corpo del PUT. Password e chiave partono solo se scritte: il server tratta
 * un campo vuoto come «non cambiare», qui non lo si manda nemmeno.
 */
export function buildUnifiPayload(form: UnifiForm): Record<string, string> {
  const body: Record<string, string> = {
    mode: form.mode,
    kind: form.kind,
    url: form.url.trim(),
    site: form.site.trim() || "default",
    username: form.username.trim(),
  };
  if (form.password !== "") body.password = form.password;
  if (form.apiToken.trim() !== "") body.apiToken = form.apiToken.trim();
  return body;
}

// ── Esito della prova di connessione ─────────────────────────────────────────

export interface UnifiProbeView {
  tone: "ok" | "error";
  title: string;
  detail: string | null;
  /** Solo per un certificato cambiato: le due impronte da confrontare. */
  pins: { expected: string; presented: string } | null;
}

const REASON_TITLE: Record<UnifiErrorReason, string> = {
  auth: "Accesso rifiutato dal controller",
  network: "Controller non raggiungibile",
  server: "Il controller ha risposto con un errore",
  cert: "Certificato del controller cambiato",
  config: "Configurazione da correggere",
  not_implemented: "Tipo di controller non ancora supportato",
  unknown: "Prova non riuscita",
};

export function describeUnifiProbe(r: UnifiProbeResult): UnifiProbeView {
  if (r.ok) {
    return {
      tone: "ok",
      title: `Collegamento riuscito: ${r.devices} apparati letti dal controller`,
      detail: r.certPinRecorded
        ? "Primo collegamento: il certificato del controller è stato fissato. D'ora in poi un certificato diverso sarà rifiutato."
        : null,
      pins: null,
    };
  }
  return {
    tone: "error",
    title: REASON_TITLE[r.reason] ?? REASON_TITLE.unknown,
    detail: r.message,
    pins:
      r.reason === "cert" && r.presentedPin && r.expectedPin
        ? { expected: r.expectedPin, presented: r.presentedPin }
        : null,
  };
}

// ── Esito della sincronizzazione ─────────────────────────────────────────────

/** Risposta di POST /api/integrations/unifi/sync (`{ ok, ...UnifiSyncResult }`). */
export interface UnifiSyncResponse {
  ok: boolean;
  total: number;
  added: number;
  updated: number;
  skipped: number;
  skippedReasons: string[];
  portsUpserted: number;
  neighborsUpserted: number;
  errors: string[];
}

export interface UnifiSyncView {
  tone: "ok" | "warning" | "error";
  title: string;
  counts: Array<{ label: string; value: number }>;
  skippedReasons: string[];
  errors: string[];
}

/** Legge la risposta della sync in modo difensivo (403, risposta vecchia, campi mancanti). */
export function parseUnifiSyncResponse(raw: unknown): UnifiSyncResponse | null {
  if (!raw || typeof raw !== "object" || !("ok" in raw)) return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    ok: r.ok === true,
    total: n(r.total),
    added: n(r.added),
    updated: n(r.updated),
    skipped: n(r.skipped),
    skippedReasons: list(r.skippedReasons),
    portsUpserted: n(r.portsUpserted),
    neighborsUpserted: n(r.neighborsUpserted),
    errors: list(r.errors),
  };
}

export function describeUnifiSync(r: UnifiSyncResponse): UnifiSyncView {
  const tone = !r.ok ? "error" : r.errors.length > 0 ? "warning" : "ok";
  const title = !r.ok
    ? "Sincronizzazione non riuscita: niente è stato scritto"
    : r.errors.length > 0
      ? "Sincronizzazione completata, con avvisi"
      : "Sincronizzazione completata";
  return {
    tone,
    title,
    counts: [
      { label: "Apparati letti", value: r.total },
      { label: "Aggiunti", value: r.added },
      { label: "Aggiornati", value: r.updated },
      { label: "Porte", value: r.portsUpserted },
      { label: "Vicini", value: r.neighborsUpserted },
      { label: "Saltati", value: r.skipped },
    ],
    skippedReasons: r.skippedReasons,
    errors: r.errors,
  };
}

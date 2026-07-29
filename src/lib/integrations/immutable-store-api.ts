/**
 * Client per l'endpoint di stato dell'archivio immutabile / repliche Wazuh
 * (cruscotto salute, fase 2).
 *
 * Servizio separato dalla Manager API di Wazuh: espone `GET /status` con
 * bearer token dedicato, TLS opzionale con SPKI pinning (TOFU) — stesso
 * pattern dello scanner-edge (vedi `src/lib/vuln/scanner-edge-client.ts`,
 * di cui riusiamo `probePinTls` invece di riscrivere la verifica).
 *
 * `parseImmutableStoreState` e' pura e non lancia mai: normalizza un JSON
 * potenzialmente incompleto o malformato (viene da `df -h` + stato interno
 * del servizio remoto) riempiendo i buchi invece di far esplodere il
 * chiamante. In particolare:
 *  - `backend.disk.*` e `local_disk.use_percent` NON condividono formato:
 *    il primo arriva da `df -h` (stringhe tipo "11%", "1.0T"), il secondo
 *    e' gia' un numero calcolato lato servizio. Niente parsing incrociato.
 *  - i timestamp non sono tutti nello stesso formato (`generated_at` e i
 *    run hanno la Z finale, `archives.oldest/newest` hanno i microsecondi
 *    senza Z): li trattiamo come stringhe opache, nessuna validazione
 *    stretta tipo ISO-8601-con-Z che le rifiuterebbe.
 */

import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { URL } from "node:url";
import { probePinTls } from "@/lib/vuln/scanner-edge-client";
import { getWazuhConfig, normalizeSpkiPin } from "./wazuh-config";

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 256 * 1024;

export class ImmutableStoreError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ImmutableStoreError";
  }
}

export interface ImmutableStoreConfig {
  url: string;
  token: string;
  certPin?: string | null;
}

export interface ImmutableStoreState {
  schema_version: number;
  generated_at: string;
  host: string;
  backend: {
    type?: string;
    reachable?: boolean;
    message?: string;
    destination?: string | null;
    disk?: {
      size?: string;
      used?: string;
      available?: string;
      // La spec §3 lo documenta come numero (`use_percent: 33`); l'endpoint
      // reale oggi manda una stringa `df -h` ("11%"). `parsePercent` a valle
      // (wazuh-health-thresholds.ts) gestisce già entrambi i formati: se qui
      // si accettasse solo la stringa, una versione del servizio conforme
      // alla spec spegnerebbe in silenzio la regola disco 85/95% (verde falso).
      use_percent?: string | number;
    };
  };
  local_disk: {
    size_gb?: number;
    used_gb?: number;
    available_gb?: number;
    use_percent?: number;
  };
  runs: {
    archive: {
      last_started_at?: string;
      last_finished_at?: string;
      outcome: string;
      archives_created?: number;
      uploaded?: number;
      failed?: number;
      bytes_uploaded?: number;
      error?: string | null;
    };
    retention: {
      last_finished_at?: string;
      outcome: string;
      local_files_deleted?: number;
      space_freed_mb?: number;
      errors_count?: number;
      error?: string | null;
    };
    verify: {
      last_finished_at?: string;
      outcome: string;
      manifest_chain_valid?: boolean;
      archives_checked?: number;
      archives_valid?: number;
      errors?: string[];
    };
  };
  archives: {
    total?: number;
    total_size_gb?: number;
    with_signature?: number;
    with_checksum?: number;
    oldest?: string | null;
    newest?: string | null;
  };
  retention_policy: {
    remote_days?: number;
    mode?: string;
    lock_until?: string | null;
  };
  schedule: {
    archive_interval?: string;
    next_archive_at?: string | null;
  };
}

// ---------------------------------------------------------------------
// Parsing puro — nessun I/O, non lancia mai.
// ---------------------------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function strOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Come `str`, ma accetta anche un numero finito: `backend.disk.use_percent`
 *  arriva come stringa `df -h` sull'endpoint reale, ma come numero secondo
 *  la spec §3 — entrambi validi, non lanciare su nessuno dei due. */
function strOrNum(v: unknown): string | number | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
}

/** Rimuove le chiavi con valore `undefined`: e' quello che distingue
 *  "sezione assente" (oggetto vuoto `{}`) da "sezione con buchi". */
function withDefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as T;
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

function parseBackend(raw: Record<string, unknown> | undefined): ImmutableStoreState["backend"] {
  const diskRaw = asRecord(raw?.disk);
  const disk = diskRaw
    ? withDefined({
        size: str(diskRaw.size),
        used: str(diskRaw.used),
        available: str(diskRaw.available),
        use_percent: strOrNum(diskRaw.use_percent),
      })
    : undefined;
  return withDefined({
    type: str(raw?.type),
    reachable: bool(raw?.reachable),
    message: str(raw?.message),
    destination: strOrNull(raw?.destination),
    disk,
  });
}

function parseLocalDisk(raw: Record<string, unknown> | undefined): ImmutableStoreState["local_disk"] {
  return withDefined({
    size_gb: num(raw?.size_gb),
    used_gb: num(raw?.used_gb),
    available_gb: num(raw?.available_gb),
    use_percent: num(raw?.use_percent),
  });
}

function parseArchiveRun(raw: Record<string, unknown> | undefined): ImmutableStoreState["runs"]["archive"] {
  return {
    outcome: str(raw?.outcome) ?? "never",
    ...withDefined({
      last_started_at: str(raw?.last_started_at),
      last_finished_at: str(raw?.last_finished_at),
      archives_created: num(raw?.archives_created),
      uploaded: num(raw?.uploaded),
      failed: num(raw?.failed),
      bytes_uploaded: num(raw?.bytes_uploaded),
      error: strOrNull(raw?.error),
    }),
  };
}

function parseRetentionRun(raw: Record<string, unknown> | undefined): ImmutableStoreState["runs"]["retention"] {
  return {
    outcome: str(raw?.outcome) ?? "never",
    ...withDefined({
      last_finished_at: str(raw?.last_finished_at),
      local_files_deleted: num(raw?.local_files_deleted),
      space_freed_mb: num(raw?.space_freed_mb),
      errors_count: num(raw?.errors_count),
      error: strOrNull(raw?.error),
    }),
  };
}

function parseVerifyRun(raw: Record<string, unknown> | undefined): ImmutableStoreState["runs"]["verify"] {
  return {
    outcome: str(raw?.outcome) ?? "never",
    ...withDefined({
      last_finished_at: str(raw?.last_finished_at),
      manifest_chain_valid: bool(raw?.manifest_chain_valid),
      archives_checked: num(raw?.archives_checked),
      archives_valid: num(raw?.archives_valid),
      errors: strArray(raw?.errors),
    }),
  };
}

function parseArchives(raw: Record<string, unknown> | undefined): ImmutableStoreState["archives"] {
  return withDefined({
    total: num(raw?.total),
    total_size_gb: num(raw?.total_size_gb),
    with_signature: num(raw?.with_signature),
    with_checksum: num(raw?.with_checksum),
    oldest: strOrNull(raw?.oldest),
    newest: strOrNull(raw?.newest),
  });
}

function parseRetentionPolicy(raw: Record<string, unknown> | undefined): ImmutableStoreState["retention_policy"] {
  return withDefined({
    remote_days: num(raw?.remote_days),
    mode: str(raw?.mode),
    lock_until: strOrNull(raw?.lock_until),
  });
}

function parseSchedule(raw: Record<string, unknown> | undefined): ImmutableStoreState["schedule"] {
  return withDefined({
    archive_interval: str(raw?.archive_interval),
    next_archive_at: strOrNull(raw?.next_archive_at),
  });
}

/**
 * Normalizza un payload grezzo (potenzialmente non un oggetto, o con
 * sezioni mancanti/malformate) in uno stato coerente. Non lancia mai.
 */
export function parseImmutableStoreState(raw: unknown): ImmutableStoreState {
  const root = asRecord(raw) ?? {};
  const runsRaw = asRecord(root.runs);
  return {
    schema_version: num(root.schema_version) ?? 0,
    generated_at: str(root.generated_at) ?? "",
    host: str(root.host) ?? "",
    backend: parseBackend(asRecord(root.backend)),
    local_disk: parseLocalDisk(asRecord(root.local_disk)),
    runs: {
      archive: parseArchiveRun(asRecord(runsRaw?.archive)),
      retention: parseRetentionRun(asRecord(runsRaw?.retention)),
      verify: parseVerifyRun(asRecord(runsRaw?.verify)),
    },
    archives: parseArchives(asRecord(root.archives)),
    retention_policy: parseRetentionPolicy(asRecord(root.retention_policy)),
    schedule: parseSchedule(asRecord(root.schedule)),
  };
}

// ---------------------------------------------------------------------
// Config da settings hub (wazuh-config.ts)
// ---------------------------------------------------------------------

/** Legge la config dell'endpoint di stato dai settings hub. `null` se non
 *  configurato (URL o token mancanti). Il token non viene mai loggato. */
export function getImmutableStoreConfig(): ImmutableStoreConfig | null {
  const cfg = getWazuhConfig();
  if (!cfg.immutableStoreUrl || !cfg.immutableStoreToken) return null;
  return {
    url: cfg.immutableStoreUrl,
    token: cfg.immutableStoreToken,
    certPin: cfg.immutableStoreCertPin ?? null,
  };
}

// ---------------------------------------------------------------------
// Fetch via node:https raw — modellato su scanner-edge-client.ts
// ---------------------------------------------------------------------

/**
 * GET `{url}/status` con bearer token. Se `certPin` e' valorizzato, il pin
 * SPKI viene verificato PRIMA di inviare il token (un endpoint sostituito
 * non deve mai riceverlo): la verifica riusa `probePinTls` dello
 * scanner-edge-client, non viene riscritta qui.
 *
 * Timeout di default 8000ms, corpo massimo 256 KB (oltre la soglia la
 * richiesta viene interrotta e si lancia).
 */
export async function fetchImmutableStoreState(
  cfg: ImmutableStoreConfig,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ImmutableStoreState> {
  let parsed: URL;
  try {
    parsed = new URL(cfg.url);
  } catch {
    throw new ImmutableStoreError(0, "URL dell'endpoint di stato non valido");
  }

  const isHttps = parsed.protocol === "https:";
  const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;

  if (isHttps && cfg.certPin) {
    try {
      // Normalizza PRIMA del confronto: un pin già salvato senza il
      // prefisso `sha256/` (script di installazione più vecchi) o con
      // whitespace non deve produrre un mismatch fantasma contro il pin
      // canonico calcolato da `probePinTls`. `probePinTls` stesso resta
      // invariato — lo riusa anche lo scanner-edge, che passa già pin
      // canonici.
      await probePinTls(parsed.hostname, port, normalizeSpkiPin(cfg.certPin), timeoutMs);
    } catch (e) {
      // La verifica del pin fallisce PRIMA di inviare il token: nessun
      // segreto raggiunge un endpoint potenzialmente sostituito.
      const status = e instanceof Error && "status" in e ? Number((e as { status: unknown }).status) : 0;
      throw new ImmutableStoreError(status || 0, `verifica impronta TLS fallita: ${(e as Error).message}`);
    }
  }

  const path = parsed.pathname.replace(/\/$/, "") + "/status";

  const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const requestFn = isHttps ? httpsRequest : httpRequest;
    const reqOpts: import("node:https").RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: path + parsed.search,
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
    };
    if (isHttps) {
      // Pin gia' verificato sopra via probePinTls. Nuovo socket per la
      // request applicativa: stesso compromesso documentato in
      // scanner-edge-client.ts (finestra di pochi ms, accettabile).
      (reqOpts as { rejectUnauthorized?: boolean }).rejectUnauthorized = false;
    }

    const req = requestFn(reqOpts, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let aborted = false;
      res.on("data", (c: Buffer) => {
        if (aborted) return;
        total += c.length;
        if (total > MAX_BODY_BYTES) {
          aborted = true;
          req.destroy();
          reject(new ImmutableStoreError(0, "risposta oltre il limite di 256 KB"));
          return;
        }
        chunks.push(c);
      });
      res.on("end", () => {
        if (aborted) return;
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") });
      });
      res.on("error", (e) => {
        if (aborted) return;
        reject(new ImmutableStoreError(0, `risposta di rete: ${e.message}`));
      });
    });
    req.on("error", (e) => reject(new ImmutableStoreError(0, `errore di rete: ${e.message}`)));
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("timeout"));
    });
    req.end();
  });

  if (status === 401) {
    throw new ImmutableStoreError(401, "token non accettato dall'endpoint di stato");
  }
  if (status < 200 || status >= 300) {
    throw new ImmutableStoreError(status, `endpoint di stato: risposta ${status}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    throw new ImmutableStoreError(status, "risposta non-JSON dall'endpoint di stato");
  }
  return parseImmutableStoreState(json);
}

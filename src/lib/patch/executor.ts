/**
 * Patch Management — Executor.
 *
 * Wrappa `runWinrmCommand()` per i tre verbi del modulo: probe, bootstrap,
 * upgrade. Ogni invocazione crea una riga in `patch_operations` (status
 * machine queued → running → success|failed|reboot_pending) e logga lo
 * stdout/stderr di Chocolatey su file Windows (`C:\ProgramData\DA-IPAM\op-<id>.log`).
 *
 * - **probe/bootstrap**: awaited (≤30s tipico).
 * - **upgrade**: fire-and-forget. Ritorna `operationId` subito; il run
 *   prosegue in background e aggiorna la riga DB al termine. La UI polla
 *   via `/api/patch/operations/:id/logs`.
 *
 * Anti-pattern:
 *  - NO `Win32_Product` WMI nei PS script (vedi ps-scripts.ts).
 *  - NO await su `executeUpgrade` (HTTP request non deve bloccarsi).
 *  - NO password in `console.log` / `patch_operation_logs` / `error_message`.
 *  - NO `decrypt()` raw (solo `safeDecrypt` via `loadWinrmCredentialsForHost`).
 */

import type { Database } from "better-sqlite3";
import { runWinrmCommand } from "@/lib/devices/winrm-run";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { loadWinrmCredentialsForHost } from "./credentials";
import {
  buildBootstrapScript,
  buildProbeScript,
  buildUpgradeScript,
  buildWazuhInstallScript,
  logFilePathForOperation,
} from "./ps-scripts";
import type {
  BootstrapResult,
  OutdatedPackage,
  PatchAction,
  PatchExecOptions,
  PatchStatus,
  ProbeResult,
  UpgradeOptions,
} from "./types";

// ─── Costanti exit code Chocolatey (vedi MSI reboot codes) ──────────────────

const EXIT_REBOOT_PENDING = 3010;
const EXIT_REBOOT_INITIATED = 1641;

// ─── Risoluzione tenant DB ──────────────────────────────────────────────────

/**
 * Ritorna il DB tenant corrente. Se `tenantCode` esplicito non viene passato,
 * estrae il valore dal contesto AsyncLocalStorage (`withTenantFromSession` lo
 * imposta). Throw se manca: l'executor NON deve girare fuori contesto tenant.
 */
function resolveTenantDb(tenantCode?: string): Database {
  const code = tenantCode ?? getCurrentTenantCode();
  if (!code) {
    throw new Error(
      "[patch/executor] tenant code non disponibile: l'executor va chiamato dentro withTenantFromSession()"
    );
  }
  return getTenantDb(code);
}

// ─── Helpers DB ─────────────────────────────────────────────────────────────

interface CreateOperationInput {
  hostId: number;
  userId: number;
  action: PatchAction;
  cveId?: string | null;
  packageId?: string | null;
  packageVersionTarget?: string | null;
}

function createOperation(db: Database, init: CreateOperationInput): number {
  const result = db
    .prepare(
      `INSERT INTO patch_operations
         (host_id, user_id, cve_id, package_manager, package_id,
          package_version_target, action, status)
       VALUES (?, ?, ?, 'choco', ?, ?, ?, 'queued')`
    )
    .run(
      init.hostId,
      init.userId,
      init.cveId ?? null,
      init.packageId ?? null,
      init.packageVersionTarget ?? null,
      init.action
    );
  return Number(result.lastInsertRowid);
}

interface UpdateOperationPatch {
  status?: PatchStatus;
  exitCode?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  rebootRequired?: boolean;
  logFilePath?: string | null;
  logOffset?: number;
  errorMessage?: string | null;
  packageVersionBefore?: string | null;
  packageVersionAfter?: string | null;
}

function updateOperation(
  db: Database,
  operationId: number,
  patch: UpdateOperationPatch
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  const map: Array<[keyof UpdateOperationPatch, string]> = [
    ["status", "status"],
    ["exitCode", "exit_code"],
    ["startedAt", "started_at"],
    ["finishedAt", "finished_at"],
    ["logFilePath", "log_file_path"],
    ["logOffset", "log_offset"],
    ["errorMessage", "error_message"],
    ["packageVersionBefore", "package_version_before"],
    ["packageVersionAfter", "package_version_after"],
  ];

  for (const [key, col] of map) {
    if (patch[key] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(patch[key] as unknown);
    }
  }

  if (patch.rebootRequired !== undefined) {
    fields.push(`reboot_required = ?`);
    values.push(patch.rebootRequired ? 1 : 0);
  }

  if (fields.length === 0) return;
  values.push(operationId);
  db.prepare(`UPDATE patch_operations SET ${fields.join(", ")} WHERE id = ?`).run(
    ...values
  );
}

/** ISO8601 UTC compatibile con il resto dei timestamp tenant. */
/**
 * Serializzazione per host: aspetta che NON ci siano operations `running` con
 * action `upgrade|bootstrap|install` per quel hostId. Choco mantiene file lock
 * (`.chocolateyPending`) per qualche secondo dopo l'exit del processo, e il
 * retry interno di choco (3 try * 300ms) non è sufficiente.
 *
 * Polling 3s, max wait 5 minuti. Se timeout → throw (il chiamante marca op
 * come failed con messaggio chiaro).
 */
async function waitForHostFree(
  db: Database,
  hostId: number,
  excludeOperationId: number
): Promise<void> {
  const POLL_MS = 3000;
  const MAX_WAIT_MS = 5 * 60 * 1000;
  const start = Date.now();
  // Grace period 10s: include op terminate negli ultimi 10s (choco potrebbe
  // tenere ancora lock .chocolateyPending dopo l'exit del processo).
  // v0.2.652 hotfix: `finished_at` è scritto via `nowIso()` come ISO 8601
  // (es. `2026-05-27T15:24:55.611Z`) mentre `datetime('now', '-10 seconds')`
  // SQLite ritorna `2026-05-27 15:24:45` (no T, no Z, no ms). Il confronto
  // STRINGA char-by-char era sempre TRUE perché `T` (0x54) > ` ` (0x20) →
  // qualunque job terminato in qualsiasi momento bloccava la coda 5 minuti
  // poi falliva. Normalizzo finished_at strippando T/Z e ms così il confronto
  // diventa pulito tra due stringhe nello stesso formato.
  const stmt = db.prepare(
    `SELECT id FROM patch_operations
      WHERE host_id = ?
        AND id != ?
        AND action IN ('upgrade','bootstrap','install')
        AND (
          status = 'running'
          OR (
            status IN ('success','failed','reboot_pending')
            AND finished_at IS NOT NULL
            AND substr(replace(replace(finished_at, 'T', ' '), 'Z', ''), 1, 19)
                > datetime('now', '-10 seconds')
          )
        )
      LIMIT 1`
  );
  while (Date.now() - start < MAX_WAIT_MS) {
    const busy = stmt.get(hostId, excludeOperationId) as { id: number } | undefined;
    if (!busy) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(
    `Timeout 5min attesa: un'altra operazione choco è ancora running sull'host`
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

// ─── Parser output PowerShell ───────────────────────────────────────────────

interface ParsedProbeOutput {
  chocoMissing: boolean;
  chocoVersion: string | null;
  outdated: OutdatedPackage[];
}

function parseProbeOutput(stdout: string): ParsedProbeOutput {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let chocoMissing = false;
  let chocoVersion: string | null = null;
  const outdated: OutdatedPackage[] = [];

  for (const line of lines) {
    if (line === "CHOCO_MISSING") {
      chocoMissing = true;
      continue;
    }
    if (line.startsWith("CHOCO_VERSION=")) {
      chocoVersion = line.slice("CHOCO_VERSION=".length).trim() || null;
      continue;
    }
    // Righe choco outdated: `pkg|currentVer|availableVer|pinned`
    const parts = line.split("|");
    if (parts.length === 4) {
      outdated.push({
        pkg: parts[0],
        currentVer: parts[1],
        availableVer: parts[2],
        pinned: parts[3].toLowerCase() === "true",
      });
    }
  }

  return { chocoMissing, chocoVersion, outdated };
}

function parseBootstrapOutput(stdout: string): { chocoVersion: string | null } {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim());
  let chocoVersion: string | null = null;
  for (const line of lines) {
    if (line.startsWith("CHOCO_VERSION=")) {
      chocoVersion = line.slice("CHOCO_VERSION=".length).trim() || null;
    }
  }
  return { chocoVersion };
}

/**
 * Mappa exit code → status. Per upgrade:
 *   0     → success
 *   3010  → reboot_pending
 *   1641  → reboot_pending (con reboot già iniziato lato choco)
 *   altro → failed
 */
function statusFromExitCode(exit: number | null): {
  status: PatchStatus;
  rebootRequired: boolean;
} {
  if (exit === 0) return { status: "success", rebootRequired: false };
  if (exit === EXIT_REBOOT_PENDING || exit === EXIT_REBOOT_INITIATED) {
    return { status: "reboot_pending", rebootRequired: true };
  }
  return { status: "failed", rebootRequired: false };
}

/**
 * Estrae le ultime N righe dello stdout per popolare `error_message` quando
 * il run fallisce. Tagliato a 2000 char per non sforare colonne TEXT lunghi.
 */
function tailForError(stdout: string, maxLines = 20): string {
  const lines = stdout.split(/\r?\n/);
  return lines.slice(-maxLines).join("\n").slice(-2000);
}

// ─── WinRM exit code recovery ───────────────────────────────────────────────

/**
 * `runWinrmCommand` non espone l'exit code direttamente: lo recuperiamo
 * parsando la riga `EXIT_CODE=<n>` emessa dallo script upgrade. Se non c'è
 * (es. timeout, errore prima di scriverla), ritorna `null`.
 */
function parseExitCodeFromOutput(stdout: string): number | null {
  const match = stdout.match(/EXIT_CODE=(-?\d+)/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface ExecutorOptions extends PatchExecOptions {
  /** Tenant code esplicito (opzionale: se assente prende da AsyncLocalStorage). */
  tenantCode?: string;
}

/**
 * Probe: verifica presenza Chocolatey su un host Windows.
 * Awaited (≤30s tipico). Aggiorna `patch_operations` con status finale prima
 * di ritornare. Errori catturati: status='failed' + error_message.
 */
export async function executeProbe(opts: ExecutorOptions): Promise<ProbeResult> {
  const db = resolveTenantDb(opts.tenantCode);
  const operationId = createOperation(db, {
    hostId: opts.hostId,
    userId: opts.userId,
    cveId: opts.cveId ?? null,
    action: "probe",
  });
  const logPath = logFilePathForOperation(operationId);

  updateOperation(db, operationId, {
    status: "running",
    startedAt: nowIso(),
    logFilePath: logPath,
  });

  const creds = loadWinrmCredentialsForHost(db, opts.hostId);
  if (!creds) {
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: "Credenziali WinRM mancanti o non decifrabili per l'host",
    });
    return { operationId, chocoVersion: null, outdated: [] };
  }

  const script = buildProbeScript(operationId);

  let stdout = "";
  try {
    stdout = await runWinrmCommand(
      creds.host,
      creds.port,
      creds.username,
      creds.password,
      script,
      true,
      creds.realm ?? ""
    );
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: message.slice(0, 2000),
    });
    return { operationId, chocoVersion: null, outdated: [] };
  }

  const parsed = parseProbeOutput(stdout);

  if (parsed.chocoMissing) {
    updateOperation(db, operationId, {
      status: "success",
      exitCode: 1,
      finishedAt: nowIso(),
      errorMessage: "CHOCO_MISSING",
    });
    return { operationId, chocoVersion: null, outdated: [] };
  }

  updateOperation(db, operationId, {
    status: "success",
    exitCode: 0,
    finishedAt: nowIso(),
  });

  return {
    operationId,
    chocoVersion: parsed.chocoVersion,
    outdated: parsed.outdated,
  };
}

/**
 * Bootstrap: scarica e installa Chocolatey via PS remoto. Awaited (60-120s).
 */
export async function executeBootstrap(
  opts: ExecutorOptions
): Promise<BootstrapResult> {
  const db = resolveTenantDb(opts.tenantCode);
  const operationId = createOperation(db, {
    hostId: opts.hostId,
    userId: opts.userId,
    cveId: opts.cveId ?? null,
    action: "bootstrap",
  });
  const logPath = logFilePathForOperation(operationId);

  // Serializzazione per host (vedi nota in waitForHostFree)
  try {
    await waitForHostFree(db, opts.hostId, operationId);
  } catch (err) {
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: (err as Error).message ?? "Wait host timeout",
    });
    return { operationId, chocoVersion: null, success: false };
  }

  updateOperation(db, operationId, {
    status: "running",
    startedAt: nowIso(),
    logFilePath: logPath,
  });

  const creds = loadWinrmCredentialsForHost(db, opts.hostId);
  if (!creds) {
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: "Credenziali WinRM mancanti o non decifrabili per l'host",
    });
    return { operationId, chocoVersion: null, success: false };
  }

  const script = buildBootstrapScript(operationId);

  let stdout = "";
  try {
    stdout = await runWinrmCommand(
      creds.host,
      creds.port,
      creds.username,
      creds.password,
      script,
      true,
      creds.realm ?? ""
    );
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: message.slice(0, 2000),
    });
    return { operationId, chocoVersion: null, success: false };
  }

  const parsed = parseBootstrapOutput(stdout);
  const success = parsed.chocoVersion != null;

  updateOperation(db, operationId, {
    status: success ? "success" : "failed",
    exitCode: success ? 0 : null,
    finishedAt: nowIso(),
    errorMessage: success
      ? null
      : tailForError(stdout) || "Bootstrap Chocolatey fallito (no CHOCO_VERSION)",
  });

  return { operationId, chocoVersion: parsed.chocoVersion, success };
}

/**
 * Wazuh agent install: download MSI ufficiale + msiexec con WAZUH_MANAGER
 * + start servizio. Idempotente lato target (skip se già running).
 *
 * Schema patch_operations:
 *   action='install'
 *   package_id='wazuh-agent'  (marker)
 *   package_manager='choco'   (placeholder — CHECK constraint accetta solo 'choco')
 *
 * Atteso: ~30-120s per host (download MSI 60MB + install). NON è fire-and-forget
 * perché vogliamo restituire l'esito alla UI con il payload (manager applicato,
 * servizio running). Per il bulk il client UI itera N POST.
 */
export interface WazuhInstallResult {
  operationId: number;
  success: boolean;
  alreadyInstalled: boolean;
}

export async function executeWazuhInstall(
  opts: ExecutorOptions & { managerHost: string }
): Promise<WazuhInstallResult> {
  const db = resolveTenantDb(opts.tenantCode);
  const operationId = createOperation(db, {
    hostId: opts.hostId,
    userId: opts.userId,
    cveId: opts.cveId ?? null,
    action: "install",
    packageId: "wazuh-agent",
  });
  const logPath = logFilePathForOperation(operationId);

  updateOperation(db, operationId, {
    status: "running",
    startedAt: nowIso(),
    logFilePath: logPath,
  });

  const creds = loadWinrmCredentialsForHost(db, opts.hostId);
  if (!creds) {
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: "Credenziali WinRM mancanti o non decifrabili per l'host",
    });
    return { operationId, success: false, alreadyInstalled: false };
  }

  // managerHost validato dentro buildWazuhInstallScript (assertSafeManagerHost)
  let script: string;
  try {
    script = buildWazuhInstallScript(operationId, opts.managerHost);
  } catch (err) {
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: `Manager host non valido: ${(err as Error).message ?? err}`,
    });
    return { operationId, success: false, alreadyInstalled: false };
  }

  let stdout = "";
  try {
    stdout = await runWinrmCommand(
      creds.host,
      creds.port,
      creds.username,
      creds.password,
      script,
      true,
      creds.realm ?? ""
    );
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: message.slice(0, 2000),
    });
    return { operationId, success: false, alreadyInstalled: false };
  }

  const exitCode = parseExitCodeFromOutput(stdout);
  const alreadyInstalled = stdout.includes("WAZUH_ALREADY_INSTALLED_AND_RUNNING");
  const installedOk =
    exitCode === 0 &&
    (alreadyInstalled || stdout.includes("WAZUH_INSTALLED_AND_RUNNING"));

  updateOperation(db, operationId, {
    status: installedOk ? "success" : "failed",
    exitCode: exitCode ?? null,
    finishedAt: nowIso(),
    errorMessage: installedOk
      ? null
      : tailForError(stdout) || "Wazuh agent install fallito",
  });

  return { operationId, success: installedOk, alreadyInstalled };
}

/**
 * Upgrade: lancia `choco upgrade` FIRE-AND-FORGET.
 *
 * Ritorna immediatamente `{ operationId }` per consentire alla UI di polare i
 * log via `/api/patch/operations/:id/logs`. Il run effettivo prosegue in
 * background e aggiorna lo stato DB al termine.
 *
 * NOTE: tenantCode catturato qui SINCRONAMENTE, perché il run prosegue dopo
 * che la request HTTP ha già exited dall'AsyncLocalStorage di
 * `withTenantFromSession()`.
 */
export function executeUpgrade(
  opts: ExecutorOptions & UpgradeOptions
): { operationId: number } {
  const tenantCode = opts.tenantCode ?? getCurrentTenantCode();
  if (!tenantCode) {
    throw new Error(
      "[patch/executor] executeUpgrade richiede tenant context (withTenantFromSession)"
    );
  }
  const db = getTenantDb(tenantCode);

  const operationId = createOperation(db, {
    hostId: opts.hostId,
    userId: opts.userId,
    cveId: opts.cveId ?? null,
    action: "upgrade",
    packageId: opts.packageId,
    packageVersionTarget: opts.version ?? null,
  });

  // Fire-and-forget: NON await. Il caller HTTP risponde subito.
  void executeUpgradeAsync(tenantCode, operationId, opts).catch((err) => {
    console.error(
      `[patch/executor] executeUpgradeAsync op=${operationId} fatale:`,
      (err as Error)?.message ?? err
    );
  });

  return { operationId };
}

/**
 * Worker async dell'upgrade. Tutte le eccezioni vengono swallowed dopo aver
 * marcato la riga `patch_operations` come `failed`: l'errore non deve
 * propagarsi (siamo già fuori dal ciclo della request HTTP).
 */
async function executeUpgradeAsync(
  tenantCode: string,
  operationId: number,
  opts: ExecutorOptions & UpgradeOptions
): Promise<void> {
  const db = getTenantDb(tenantCode);
  const logPath = logFilePathForOperation(operationId);

  // Attesa: choco serializzato per host (lock file .chocolateyPending).
  try {
    await waitForHostFree(db, opts.hostId, operationId);
  } catch (err) {
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: (err as Error).message ?? "Wait host timeout",
    });
    return;
  }

  updateOperation(db, operationId, {
    status: "running",
    startedAt: nowIso(),
    logFilePath: logPath,
  });

  const creds = loadWinrmCredentialsForHost(db, opts.hostId);
  if (!creds) {
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: "Credenziali WinRM mancanti o non decifrabili per l'host",
    });
    return;
  }

  let script: string;
  try {
    script = buildUpgradeScript(operationId, opts.packageId, opts.version);
  } catch (err) {
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: `Validazione input fallita: ${(err as Error).message}`,
    });
    return;
  }

  let stdout = "";
  try {
    stdout = await runWinrmCommand(
      creds.host,
      creds.port,
      creds.username,
      creds.password,
      script,
      true,
      creds.realm ?? ""
    );
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    updateOperation(db, operationId, {
      status: "failed",
      finishedAt: nowIso(),
      errorMessage: message.slice(0, 2000),
    });
    return;
  }

  const exitCode = parseExitCodeFromOutput(stdout);
  const { status, rebootRequired } = statusFromExitCode(exitCode);

  updateOperation(db, operationId, {
    status,
    exitCode,
    rebootRequired,
    finishedAt: nowIso(),
    errorMessage: status === "failed" ? tailForError(stdout) : null,
  });
}

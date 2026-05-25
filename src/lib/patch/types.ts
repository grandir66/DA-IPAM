/**
 * Tipi condivisi del modulo Patch Management.
 *
 * Le righe DB seguono 1:1 lo schema in `src/lib/patch/schema.ts` (snake_case
 * SQLite remappato in camelCase per consumo TS).
 */

export type PatchAction =
  | "probe"
  | "bootstrap"
  | "upgrade"
  | "install"
  | "uninstall"
  | "rollback";

export type PatchStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "reboot_pending"
  | "cancelled";

export type PatchPackageManager = "choco";

/** Riga `patch_operations` rimappata in camelCase. */
export interface PatchOperationRow {
  id: number;
  hostId: number;
  userId: number;
  cveId: string | null;
  packageManager: PatchPackageManager;
  packageId: string | null;
  packageVersionBefore: string | null;
  packageVersionTarget: string | null;
  packageVersionAfter: string | null;
  action: PatchAction;
  status: PatchStatus;
  exitCode: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  rebootRequired: boolean;
  logFilePath: string | null;
  logOffset: number;
  errorMessage: string | null;
}

/** Versione raw DB (snake_case) — output diretto di `prepare(...).get()`. */
export interface PatchOperationDbRow {
  id: number;
  host_id: number;
  user_id: number;
  cve_id: string | null;
  package_manager: PatchPackageManager;
  package_id: string | null;
  package_version_before: string | null;
  package_version_target: string | null;
  package_version_after: string | null;
  action: PatchAction;
  status: PatchStatus;
  exit_code: number | null;
  started_at: string | null;
  finished_at: string | null;
  reboot_required: number;
  log_file_path: string | null;
  log_offset: number;
  error_message: string | null;
}

export function mapOperationRow(raw: PatchOperationDbRow): PatchOperationRow {
  return {
    id: raw.id,
    hostId: raw.host_id,
    userId: raw.user_id,
    cveId: raw.cve_id,
    packageManager: raw.package_manager,
    packageId: raw.package_id,
    packageVersionBefore: raw.package_version_before,
    packageVersionTarget: raw.package_version_target,
    packageVersionAfter: raw.package_version_after,
    action: raw.action,
    status: raw.status,
    exitCode: raw.exit_code,
    startedAt: raw.started_at,
    finishedAt: raw.finished_at,
    rebootRequired: raw.reboot_required === 1,
    logFilePath: raw.log_file_path,
    logOffset: raw.log_offset,
    errorMessage: raw.error_message,
  };
}

/** Voce singola di `choco outdated --limit-output`. */
export interface OutdatedPackage {
  pkg: string;
  currentVer: string;
  availableVer: string;
  pinned: boolean;
}

export interface ProbeResult {
  operationId: number;
  chocoVersion: string | null;
  outdated: OutdatedPackage[];
}

export interface BootstrapResult {
  operationId: number;
  chocoVersion: string | null;
  success: boolean;
}

export interface UpgradeOptions {
  packageId: string;
  /** Se omesso/null → `choco upgrade` senza pin (last). */
  version?: string | null;
}

/** Credenziali WinRM risolte da host_credentials + credentials decifrate. */
export interface WinrmCredentialsResolved {
  host: string;
  port: number;
  username: string;
  password: string;
  realm?: string | null;
}

/** Input minimale per qualsiasi azione executor. */
export interface PatchExecOptions {
  hostId: number;
  userId: number;
  cveId?: string | null;
}

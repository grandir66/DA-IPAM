/**
 * Software inventory runner — orchestratore per scan applicativo on-demand.
 *
 * Funzione pura `runSoftwareScan()` invocabile da:
 *   - endpoint POST inline (oggi)
 *   - cron / queue background (futuro, vedi docs/plans/software-inventory.md)
 *
 * Multi-tenancy: il chiamante deve essere dentro `withTenant(tenantCode, ...)`
 * (es. via `withTenantFromSession()`). Il runner non sa nulla del tenant code.
 *
 * Detection OS: automatica da `credentials.credential_type` ('windows' | 'linux').
 * Mismatch → error con messaggio chiaro all'utente.
 */

import {
  cleanupOldSoftwareScansForHost,
  createSoftwareScan,
  getCredentialById,
  getHostById,
  getSoftwareScanRetention,
  insertSoftwareInventoryBulk,
  insertSoftwareScanLog,
  updateSoftwareScanFinish,
} from "@/lib/db-tenant";
import { safeDecrypt } from "@/lib/crypto";
import { runWindowsSoftwareProbe } from "@/lib/probes/software-windows";
import { runLinuxSoftwareScan } from "@/lib/probes/software-linux";
import type {
  SoftwareOsFamily,
  SoftwarePackage,
  SoftwareProbe,
  SoftwareScanTrigger,
} from "@/types";

/** Cap massimo righe inventario per singolo scan. */
export const MAX_APPS_PER_SCAN = 2000;

/** Default timeout per probe (ms). */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** Default port WinRM HTTPS. */
const WINRM_DEFAULT_PORT = 5986;

/** Default port SSH. */
const SSH_DEFAULT_PORT = 22;

export interface SoftwareScanOptions {
  hostId: number;
  credentialId: number;
  timeoutMs?: number;
  triggeredByUserId?: number | null;
  triggeredBy?: SoftwareScanTrigger;
  /** Override porta WinRM (default 5986). Ignorato per Linux/SSH. */
  port?: number;
  /** Override realm AD per Kerberos. Ignorato per Linux/SSH. */
  realm?: string;
}

export interface SoftwareScanResult {
  scanId: number;
  status: "ok" | "error" | "timeout";
  appsCount: number;
  errorMessage?: string;
}

/** Errore identificabile per timeout dal messaggio del bridge WinRM. */
function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("non ha risposto")
  );
}

/** Promise wrapper con timeout esplicito (la libreria può non rispettare il limite). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`Timeout ${label} dopo ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Esegue uno scan applicativo end-to-end.
 *
 * Crea immediatamente un record `software_scans` con `status='running'`,
 * esegue il probe, persiste l'inventario in transazione, aggiorna lo scan
 * a `ok|error|timeout`, applica cleanup retention. Ritorna sempre — non
 * lancia eccezioni al chiamante (le mappa su `status='error'` + log).
 */
export async function runSoftwareScan(
  opts: SoftwareScanOptions
): Promise<SoftwareScanResult> {
  const timeoutMs =
    Number.isFinite(opts.timeoutMs) && (opts.timeoutMs ?? 0) > 0
      ? Math.trunc(opts.timeoutMs as number)
      : DEFAULT_TIMEOUT_MS;
  const triggeredBy = opts.triggeredBy ?? "manual";

  // ── 1. Risolvi host + credential prima di creare lo scan ───────────────
  const host = getHostById(opts.hostId);
  if (!host) {
    throw new Error(`Host ${opts.hostId} non trovato`);
  }
  const cred = getCredentialById(opts.credentialId);
  if (!cred) {
    throw new Error(`Credenziale ${opts.credentialId} non trovata`);
  }

  const credType = String(cred.credential_type || "").toLowerCase();
  let osFamily: SoftwareOsFamily;
  let probe: SoftwareProbe;
  if (credType === "windows") {
    osFamily = "windows";
    probe = "winrm";
  } else if (credType === "linux") {
    osFamily = "linux";
    probe = "ssh-mixed";
  } else {
    throw new Error(
      `Tipo credenziale non supportato per software scan: '${cred.credential_type}'. Usa una credenziale 'windows' o 'linux'.`
    );
  }

  // ── 2. Crea record scan ────────────────────────────────────────────────
  const scanId = createSoftwareScan({
    host_id: opts.hostId,
    os_family: osFamily,
    probe,
    timeout_ms: timeoutMs,
    triggered_by: triggeredBy,
    triggered_by_user_id: opts.triggeredByUserId ?? null,
    credential_id: opts.credentialId,
  });

  insertSoftwareScanLog(scanId, "info", "init", "Scan creato", {
    host_id: opts.hostId,
    host_ip: host.ip,
    host_hostname: host.hostname ?? null,
    credential_id: opts.credentialId,
    credential_type: credType,
    os_family: osFamily,
    probe,
    timeout_ms: timeoutMs,
    triggered_by: triggeredBy,
  });

  // ── 3. Esegui probe in funzione dell'OS ────────────────────────────────
  let packages: SoftwarePackage[] = [];
  let finalStatus: "ok" | "error" | "timeout" = "ok";
  let errorMessage: string | null = null;
  let resolvedProbe: SoftwareProbe = probe;

  try {
    if (osFamily === "windows") {
      const username = cred.encrypted_username
        ? safeDecrypt(cred.encrypted_username)
        : null;
      const password = cred.encrypted_password
        ? safeDecrypt(cred.encrypted_password)
        : null;
      if (!username || !password) {
        throw new Error(
          "Credenziale Windows priva di username o password (decifrazione fallita o campo vuoto)"
        );
      }

      const port =
        opts.port && Number.isFinite(opts.port) && opts.port > 0
          ? Math.trunc(opts.port)
          : WINRM_DEFAULT_PORT;

      insertSoftwareScanLog(scanId, "info", "connect", "Avvio probe WinRM", {
        host: host.ip,
        port,
        username,
      });

      packages = await withTimeout(
        runWindowsSoftwareProbe({
          host: host.ip,
          port,
          username,
          password,
          realm: opts.realm,
        }),
        timeoutMs,
        "WinRM software probe"
      );
    } else {
      // Linux via SSH (paramiko bridge)
      const username = cred.encrypted_username
        ? safeDecrypt(cred.encrypted_username)
        : null;
      const password = cred.encrypted_password
        ? safeDecrypt(cred.encrypted_password)
        : null;
      if (!username || !password) {
        throw new Error(
          "Credenziale Linux priva di username o password (decifrazione fallita o campo vuoto)"
        );
      }

      const port =
        opts.port && Number.isFinite(opts.port) && opts.port > 0
          ? Math.trunc(opts.port)
          : SSH_DEFAULT_PORT;

      insertSoftwareScanLog(scanId, "info", "connect", "Avvio connessione SSH", {
        host: host.ip,
        port,
        username,
      });

      const timeoutSec = Math.max(5, Math.ceil(timeoutMs / 1000));
      const linuxResult = await withTimeout(
        runLinuxSoftwareScan({
          host: host.ip,
          port,
          username,
          password,
          timeoutSec,
        }),
        timeoutMs,
        "SSH software probe"
      );

      packages = linuxResult.packages;
      resolvedProbe = linuxResult.probe;

      insertSoftwareScanLog(
        scanId,
        "info",
        "parse",
        `Distro rilevata: ${linuxResult.distro.prettyName ?? linuxResult.distro.id} (family=${linuxResult.distro.family})`,
        {
          id: linuxResult.distro.id,
          id_like: linuxResult.distro.idLike,
          family: linuxResult.distro.family,
          probe: linuxResult.probe,
        }
      );

      for (const w of linuxResult.warnings) {
        insertSoftwareScanLog(scanId, "warn", "parse", w);
      }
    }

    insertSoftwareScanLog(
      scanId,
      "info",
      "parse",
      `Probe ha restituito ${packages.length} applicazioni`,
      { count: packages.length, probe: resolvedProbe }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isTimeoutError(err)) {
      finalStatus = "timeout";
      errorMessage = `Timeout dopo ${timeoutMs}ms: ${msg}`;
    } else {
      finalStatus = "error";
      errorMessage = msg;
    }
    insertSoftwareScanLog(
      scanId,
      "error",
      "probe",
      errorMessage,
      { stack: err instanceof Error ? err.stack : null }
    );
    updateSoftwareScanFinish(scanId, {
      status: finalStatus,
      apps_count: 0,
      error_message: errorMessage,
    });
    return {
      scanId,
      status: finalStatus,
      appsCount: 0,
      errorMessage: errorMessage ?? undefined,
    };
  }

  // ── 4. Cap + persistenza inventario ────────────────────────────────────
  let truncated = false;
  if (packages.length > MAX_APPS_PER_SCAN) {
    truncated = true;
    insertSoftwareScanLog(
      scanId,
      "warn",
      "parse",
      `Numero applicazioni (${packages.length}) supera cap ${MAX_APPS_PER_SCAN}: troncamento`,
      { received: packages.length, cap: MAX_APPS_PER_SCAN }
    );
    packages = packages.slice(0, MAX_APPS_PER_SCAN);
  }

  try {
    insertSoftwareInventoryBulk(scanId, packages);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    insertSoftwareScanLog(scanId, "error", "commit", `INSERT inventario fallito: ${msg}`);
    updateSoftwareScanFinish(scanId, {
      status: "error",
      apps_count: 0,
      error_message: `Persistenza inventario fallita: ${msg}`,
    });
    return {
      scanId,
      status: "error",
      appsCount: 0,
      errorMessage: msg,
    };
  }

  insertSoftwareScanLog(
    scanId,
    "info",
    "commit",
    `Inserite ${packages.length} righe in software_inventory`,
    { count: packages.length, truncated }
  );

  // ── 5. Finalize ────────────────────────────────────────────────────────
  const finalErrorMessage = truncated
    ? `Inventario troncato: ricevute >${MAX_APPS_PER_SCAN} applicazioni, salvate prime ${MAX_APPS_PER_SCAN}`
    : null;

  updateSoftwareScanFinish(scanId, {
    status: "ok",
    apps_count: packages.length,
    error_message: finalErrorMessage,
    probe: resolvedProbe,
  });

  // ── 6. Cleanup retention (ON DELETE CASCADE pulisce inventory + logs) ──
  try {
    const keep = getSoftwareScanRetention();
    const deleted = cleanupOldSoftwareScansForHost(opts.hostId, keep);
    if (deleted > 0) {
      insertSoftwareScanLog(
        scanId,
        "info",
        "cleanup",
        `Retention: rimossi ${deleted} scan storici (keep=${keep})`,
        { deleted, keep }
      );
    }
  } catch (err) {
    // Cleanup non deve far fallire lo scan: log e procedi
    const msg = err instanceof Error ? err.message : String(err);
    insertSoftwareScanLog(scanId, "warn", "cleanup", `Cleanup retention fallito: ${msg}`);
  }

  return {
    scanId,
    status: "ok",
    appsCount: packages.length,
    errorMessage: finalErrorMessage ?? undefined,
  };
}

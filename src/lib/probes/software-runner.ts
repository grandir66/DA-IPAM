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
 * Target di scan: host (entry di rete in `hosts`) o device (`network_devices`).
 * Per device la credenziale di default è quella linkata (device.credential_id).
 *
 * Detection OS:
 *   - host: da `credentials.credential_type` ('windows' | 'linux')
 *   - device: da `network_devices.vendor` ('windows' | 'linux') — gli appliance
 *     di rete (router/switch/firewall/hypervisor) sono rifiutati con errore.
 */

import {
  cleanupOldSoftwareScansForTarget,
  createSoftwareScan,
  getCredentialById,
  getHostById,
  getNetworkDeviceById,
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
  SoftwareScanTarget,
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
  /** Target di scan: host (entry di rete) o device (managed network_device). */
  target: SoftwareScanTarget;
  /**
   * ID credenziale. Per `host` è obbligatorio. Per `device` se omesso si usa
   * la credenziale linkata al device (`network_devices.credential_id`).
   */
  credentialId?: number;
  timeoutMs?: number;
  triggeredByUserId?: number | null;
  triggeredBy?: SoftwareScanTrigger;
  /** Override porta WinRM/SSH. Se omesso usa device.port o default. */
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

/** Tutto ciò che serve per eseguire il probe, risolto da host o device. */
interface ResolvedTarget {
  ip: string;
  label: string;
  osFamily: SoftwareOsFamily;
  initialProbe: SoftwareProbe;
  credentialId: number;
  defaultPort: number;
  identification: Record<string, unknown>;
}

function resolveTarget(opts: SoftwareScanOptions): ResolvedTarget {
  if (opts.target.kind === "host") {
    const host = getHostById(opts.target.hostId);
    if (!host) {
      throw new Error(`Host ${opts.target.hostId} non trovato`);
    }
    if (!opts.credentialId) {
      throw new Error("credentialId obbligatorio per scan su host");
    }
    const cred = getCredentialById(opts.credentialId);
    if (!cred) {
      throw new Error(`Credenziale ${opts.credentialId} non trovata`);
    }
    const credType = String(cred.credential_type || "").toLowerCase();
    let osFamily: SoftwareOsFamily;
    let initialProbe: SoftwareProbe;
    if (credType === "windows") {
      osFamily = "windows";
      initialProbe = "winrm";
    } else if (credType === "linux") {
      osFamily = "linux";
      initialProbe = "ssh-mixed";
    } else {
      throw new Error(
        `Tipo credenziale non supportato per software scan: '${cred.credential_type}'. Usa una credenziale 'windows' o 'linux'.`
      );
    }
    return {
      ip: host.ip,
      label: host.hostname ?? host.custom_name ?? host.ip,
      osFamily,
      initialProbe,
      credentialId: opts.credentialId,
      defaultPort: osFamily === "windows" ? WINRM_DEFAULT_PORT : SSH_DEFAULT_PORT,
      identification: {
        target_kind: "host",
        host_id: opts.target.hostId,
        host_ip: host.ip,
        host_hostname: host.hostname ?? null,
      },
    };
  }

  // device
  const device = getNetworkDeviceById(opts.target.deviceId);
  if (!device) {
    throw new Error(`Device ${opts.target.deviceId} non trovato`);
  }

  let osFamily: SoftwareOsFamily;
  let initialProbe: SoftwareProbe;
  if (device.vendor === "windows") {
    osFamily = "windows";
    initialProbe = "winrm";
  } else if (device.vendor === "linux") {
    osFamily = "linux";
    initialProbe = "ssh-mixed";
  } else {
    throw new Error(
      `Device '${device.name}' ha vendor '${device.vendor}': software inventory supporta solo vendor 'windows' o 'linux'. Per appliance di rete usare gli scan dedicati.`
    );
  }

  const credentialId = opts.credentialId ?? device.credential_id ?? null;
  if (!credentialId) {
    throw new Error(
      `Device '${device.name}' non ha credenziali linkate. Imposta una credenziale sul device o passa credentialId esplicito.`
    );
  }
  const cred = getCredentialById(credentialId);
  if (!cred) {
    throw new Error(`Credenziale ${credentialId} non trovata`);
  }

  // Porta default: ottieni dal device se valida per il protocollo, altrimenti default standard
  let defaultPort: number;
  if (osFamily === "windows") {
    defaultPort = device.port && (device.port === 5985 || device.port === 5986)
      ? device.port
      : WINRM_DEFAULT_PORT;
  } else {
    defaultPort = device.port && device.port > 0 ? device.port : SSH_DEFAULT_PORT;
  }

  return {
    ip: device.host,
    label: device.name || device.host,
    osFamily,
    initialProbe,
    credentialId,
    defaultPort,
    identification: {
      target_kind: "device",
      device_id: device.id,
      device_name: device.name,
      device_host: device.host,
      device_vendor: device.vendor,
      device_protocol: device.protocol,
    },
  };
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

  // ── 1. Risolvi target + credential prima di creare lo scan ─────────────
  const resolved = resolveTarget(opts);
  const cred = getCredentialById(resolved.credentialId);
  if (!cred) {
    // Difensivo: già verificato in resolveTarget, ma ricontroliamo dopo l'INSERT
    throw new Error(`Credenziale ${resolved.credentialId} non trovata`);
  }

  // ── 2. Crea record scan ────────────────────────────────────────────────
  const scanId = createSoftwareScan({
    target: opts.target,
    os_family: resolved.osFamily,
    probe: resolved.initialProbe,
    timeout_ms: timeoutMs,
    triggered_by: triggeredBy,
    triggered_by_user_id: opts.triggeredByUserId ?? null,
    credential_id: resolved.credentialId,
  });

  insertSoftwareScanLog(scanId, "info", "init", "Scan creato", {
    ...resolved.identification,
    credential_id: resolved.credentialId,
    credential_type: cred.credential_type,
    os_family: resolved.osFamily,
    probe: resolved.initialProbe,
    timeout_ms: timeoutMs,
    triggered_by: triggeredBy,
  });

  // ── 3. Esegui probe in funzione dell'OS ────────────────────────────────
  let packages: SoftwarePackage[] = [];
  let finalStatus: "ok" | "error" | "timeout" = "ok";
  let errorMessage: string | null = null;
  let resolvedProbe: SoftwareProbe = resolved.initialProbe;

  try {
    const username = cred.encrypted_username
      ? safeDecrypt(cred.encrypted_username)
      : null;
    const password = cred.encrypted_password
      ? safeDecrypt(cred.encrypted_password)
      : null;
    if (!username || !password) {
      throw new Error(
        `Credenziale ${resolved.osFamily} priva di username o password (decifrazione fallita o campo vuoto)`
      );
    }

    const port =
      opts.port && Number.isFinite(opts.port) && opts.port > 0
        ? Math.trunc(opts.port)
        : resolved.defaultPort;

    if (resolved.osFamily === "windows") {
      insertSoftwareScanLog(scanId, "info", "connect", "Avvio probe WinRM", {
        host: resolved.ip,
        port,
        username,
      });

      packages = await withTimeout(
        runWindowsSoftwareProbe({
          host: resolved.ip,
          port,
          username,
          password,
          realm: opts.realm,
        }),
        timeoutMs,
        "WinRM software probe"
      );
    } else {
      insertSoftwareScanLog(scanId, "info", "connect", "Avvio connessione SSH", {
        host: resolved.ip,
        port,
        username,
      });

      const timeoutSec = Math.max(5, Math.ceil(timeoutMs / 1000));
      const linuxResult = await withTimeout(
        runLinuxSoftwareScan({
          host: resolved.ip,
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
    const deleted = cleanupOldSoftwareScansForTarget(opts.target, keep);
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

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
 * Senza una voce esplicita la credenziale la sceglie il motore unico
 * (`credentials/resolve.ts`, vedi `resolveTarget`).
 *
 * Detection OS:
 *   - host: dal tipo della voce, con `tipiPerProtocollo` (WinRM → windows,
 *     SSH → linux: valgono `windows`, `ssh` e l'alias `linux`)
 *   - device: da `network_devices.vendor` ('windows' | 'linux') — gli appliance
 *     di rete (router/switch/firewall/hypervisor) sono rifiutati con errore.
 */

import type Database from "better-sqlite3";
import {
  cleanupOldSoftwareScansForTarget,
  createSoftwareScan,
  getCurrentTenantCode,
  getHostById,
  getNetworkDeviceById,
  getSoftwareScanRetention,
  getTenantDb,
  insertSoftwareInventoryBulk,
  insertSoftwareScanLog,
  updateSoftwareScanFinish,
} from "@/lib/db-tenant";
import {
  FONTI_APPARATO,
  scegliSegretoApparatoDb,
  scegliSegretoHostDb,
  type ResolvedCredentialSource,
} from "@/lib/credentials/resolve";
import { leggiSegretoDb, type Segreto } from "@/lib/credentials/segreti";
import { etichettaTipo, tipiPerProtocollo } from "@/lib/credentials/tipi";
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
  /** Voce d'archivio usata; null per un segreto fuori archivio (binding inline, colonne dell'apparato). */
  credentialId: number | null;
  /** Codice della voce com'è nel DB, null senza voce. */
  credentialType: string | null;
  /** Da dove viene la credenziale: «scelta» se l'ha passata chi lancia lo scan, altrimenti la fonte del motore. */
  fonte: ResolvedCredentialSource | "scelta";
  username: string;
  password: string;
  defaultPort: number;
  identification: Record<string, unknown>;
}

/** Il DB del tenant corrente: il runner gira dentro withTenant (vedi testa del file). */
function dbTenant(): Database.Database {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Inventario software senza contesto tenant");
  return getTenantDb(code);
}

const PROTOCOLLO: Record<SoftwareOsFamily, "winrm" | "ssh"> = { windows: "winrm", linux: "ssh" };
const PROBE_INIZIALE: Record<SoftwareOsFamily, SoftwareProbe> = { windows: "winrm", linux: "ssh-mixed" };

/** Utente e password dal segreto; un'altra forma (chiave SSH, token…) l'inventario per ora non la usa. */
function utenteEPassword(s: Segreto, chi: string): { username: string; password: string } {
  if (s.forma !== "utente") throw new Error(`${chi}: l'inventario software per ora accede solo con utente e password`);
  return { username: s.username, password: s.password };
}

/**
 * Voce scelta da chi lancia lo scan: il tipo si controlla con
 * `tipiPerProtocollo`, quindi per un host una voce `ssh` vale come `linux`.
 * Con `famiglia` (l'apparato, dal vendor) la voce deve valere per quella.
 */
function voceScelta(
  dbh: Database.Database,
  credentialId: number,
  famiglia: SoftwareOsFamily | null
): { osFamily: SoftwareOsFamily; credentialType: string; username: string; password: string } {
  const riga = dbh.prepare("SELECT name, credential_type FROM credentials WHERE id = ?").get(credentialId) as
    | { name: string; credential_type: string }
    | undefined;
  if (!riga) throw new Error(`Credenziale ${credentialId} non trovata`);
  const famiglie: SoftwareOsFamily[] = famiglia ? [famiglia] : ["windows", "linux"];
  const osFamily = famiglie.find((f) => tipiPerProtocollo(PROTOCOLLO[f]).includes(riga.credential_type));
  if (!osFamily) {
    const attese = famiglia === "windows" ? "Windows" : famiglia === "linux" ? "SSH" : "Windows o SSH";
    throw new Error(
      `La credenziale «${riga.name}» è di tipo ${etichettaTipo(riga.credential_type) || riga.credential_type}: per l'inventario software serve una credenziale ${attese}.`
    );
  }
  const e = leggiSegretoDb(dbh, credentialId, PROTOCOLLO[osFamily]);
  if (!e.ok) throw new Error(e.motivo);
  return { osFamily, credentialType: riga.credential_type, ...utenteEPassword(e.segreto, `La credenziale «${riga.name}»`) };
}

/**
 * Bersaglio e credenziale dello scan. Con una voce esplicita si usa quella;
 * senza, sceglie il motore unico (tappa 2 credenziali, T9):
 * - host: `scegliSegretoHostDb` su WinRM e poi su SSH (l'OS non è ancora
 *   noto), con la porta del candidato;
 * - apparato: `scegliSegretoApparatoDb` sulle fonti dell'apparato
 *   (FONTI_APPARATO: binding riusciti, non provati, inline, colonne), come
 *   prima solo le sue, ma nell'ordine del motore (D1: binding prima delle
 *   colonne) e senza i binding falliti (D10).
 */
function resolveTarget(opts: SoftwareScanOptions): ResolvedTarget {
  const dbh = dbTenant();
  if (opts.target.kind === "host") {
    const host = getHostById(opts.target.hostId);
    if (!host) {
      throw new Error(`Host ${opts.target.hostId} non trovato`);
    }
    const identification = {
      target_kind: "host",
      host_id: opts.target.hostId,
      host_ip: host.ip,
      host_hostname: host.hostname ?? null,
    };
    const label = host.hostname ?? host.custom_name ?? host.ip;
    if (opts.credentialId != null) {
      const v = voceScelta(dbh, opts.credentialId, null);
      return {
        ip: host.ip,
        label,
        osFamily: v.osFamily,
        initialProbe: PROBE_INIZIALE[v.osFamily],
        credentialId: opts.credentialId,
        credentialType: v.credentialType,
        fonte: "scelta",
        username: v.username,
        password: v.password,
        defaultPort: v.osFamily === "windows" ? WINRM_DEFAULT_PORT : SSH_DEFAULT_PORT,
        identification,
      };
    }
    const bersaglio = { hostId: host.id, ip: host.ip, networkId: host.network_id };
    const motivi: string[] = [];
    for (const osFamily of ["windows", "linux"] as const) {
      const s = scegliSegretoHostDb(dbh, bersaglio, PROTOCOLLO[osFamily]);
      if (!s.ok) {
        motivi.push(s.motivo);
        continue;
      }
      return {
        ip: host.ip,
        label,
        osFamily,
        initialProbe: PROBE_INIZIALE[osFamily],
        credentialId: s.candidato.credential_id,
        credentialType: s.candidato.tipo,
        fonte: s.candidato.source,
        ...utenteEPassword(s.segreto, `L'host ${host.ip}`),
        defaultPort: s.candidato.port,
        identification,
      };
    }
    throw new Error(`Nessuna credenziale per l'inventario software dell'host ${host.ip}: ${motivi.join("; ")}`);
  }

  // device
  const device = getNetworkDeviceById(opts.target.deviceId);
  if (!device) {
    throw new Error(`Device ${opts.target.deviceId} non trovato`);
  }

  let osFamily: SoftwareOsFamily;
  if (device.vendor === "windows") {
    osFamily = "windows";
  } else if (device.vendor === "linux") {
    osFamily = "linux";
  } else {
    throw new Error(
      `Device '${device.name}' ha vendor '${device.vendor}': software inventory supporta solo vendor 'windows' o 'linux'. Per appliance di rete usare gli scan dedicati.`
    );
  }

  let scelta: { credentialId: number | null; credentialType: string | null; fonte: ResolvedTarget["fonte"]; username: string; password: string; port: number | null };
  if (opts.credentialId != null) {
    const v = voceScelta(dbh, opts.credentialId, osFamily);
    scelta = { credentialId: opts.credentialId, credentialType: v.credentialType, fonte: "scelta", username: v.username, password: v.password, port: null };
  } else {
    const s = scegliSegretoApparatoDb(dbh, device.id, PROTOCOLLO[osFamily], { fonti: FONTI_APPARATO });
    if (!s.ok) {
      throw new Error(
        `Device '${device.name}' non ha credenziali ${osFamily === "windows" ? "WinRM" : "SSH"} utilizzabili (${s.motivo}). Vai sul device → Credenziali e abbinane una, oppure lancia l'auto-detect dalla pagina della subnet.`
      );
    }
    scelta = {
      credentialId: s.candidato.credential_id,
      credentialType: s.candidato.tipo,
      fonte: s.candidato.source,
      ...utenteEPassword(s.segreto, `Device '${device.name}'`),
      port: s.candidato.port,
    };
  }

  // Porta: quella del candidato > device.port valido > default standard (per WinRM solo 5985/5986).
  const candidata = scelta.port;
  let defaultPort: number;
  if (osFamily === "windows") {
    if (candidata && (candidata === 5985 || candidata === 5986)) {
      defaultPort = candidata;
    } else if (device.port && (device.port === 5985 || device.port === 5986)) {
      defaultPort = device.port;
    } else {
      defaultPort = WINRM_DEFAULT_PORT;
    }
  } else {
    defaultPort = candidata && candidata > 0
      ? candidata
      : device.port && device.port > 0
        ? device.port
        : SSH_DEFAULT_PORT;
  }

  return {
    ip: device.host,
    label: device.name || device.host,
    osFamily,
    initialProbe: PROBE_INIZIALE[osFamily],
    credentialId: scelta.credentialId,
    credentialType: scelta.credentialType,
    fonte: scelta.fonte,
    username: scelta.username,
    password: scelta.password,
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
    credential_type: resolved.credentialType,
    fonte: resolved.fonte,
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
    const { username, password } = resolved;

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

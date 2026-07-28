/**
 * Resolver unico per credenziali (fase 1b attribuzione v2, §7).
 *
 * Sostituisce le tre liste "legacy" sparse (network_host_credentials +
 * host_detect_credential, network_credentials v2, host_credentials/device
 * bindings) con un ordine di precedenza unico e uno stato di fallimento
 * condiviso (fail_count/backoff_until su host_credentials).
 *
 * Design (mirror di src/lib/attribution/recompute.ts): le funzioni "Db" sono
 * pure — prendono l'handle SQLite esplicito, non lanciano loro stesse ma sono
 * testabili con un DB in-memory senza passare dal contesto tenant
 * (AsyncLocalStorage). Le funzioni pubbliche (resolveCredentialsFor,
 * resolveCredentialFor) risolvono il tenant corrente via un `require`
 * dinamico di db-tenant.ts — import statico evitato apposta: la fase 2 del
 * piano fa sì che db-tenant.ts importi QUESTO modulo (i wrapper legacy
 * chiamano il resolver), quindi un import statico qui creerebbe un ciclo.
 * Non lanciano mai: qualunque errore (tenant assente, query malformata,
 * DB chiuso) ritorna array vuoto / null, mai un'eccezione propagata al
 * chiamante (scanner/collector).
 */
import type Database from "better-sqlite3";

// Fase 4b Task 4: 'redfish' (BMC iLO/iDRAC/XClarity) e 'onvif' (telecamere) sono
// protocolli dedicati (protocol_type su host_credentials/device_credential_bindings,
// CHECK esteso in db-tenant.ts/db.ts — vedi migrazione rebuild). La credenziale
// sottostante (`credentials.credential_type`) resta 'api' per entrambi: sono
// semplici coppie username/password, nessuna colonna dedicata necessaria (stessa
// scelta già presa per Redfish nel Task 1, vedi task-1-report.md).
export type CredProtocol = "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif";

export interface ResolveTarget {
  hostId?: number;
  deviceId?: number;
  ip?: string;
  networkId: number;
}

export type ResolvedCredentialSource =
  | "host_validated"
  | "host_unvalidated"
  | "device_binding"
  | "network_chain"
  | "legacy_chain";

export interface ResolvedCredential {
  credential_id: number;
  protocol: CredProtocol;
  port: number;
  source: ResolvedCredentialSource;
  validated: boolean;
  fail_count: number;
  backoff_until: string | null;
}

export interface ResolveOptions {
  /** Include anche le credenziali con backoff_until futuro (default: escluse). */
  includeBackoff?: boolean;
  /** Tronca il risultato a N candidati (applicato dopo l'ordinamento/dedup). */
  limit?: number;
}

/** Porta di default per protocollo quando la sorgente (network/legacy chain) non ne porta una propria. */
const DEFAULT_PORTS: Record<CredProtocol, number> = {
  ssh: 22,
  snmp: 161,
  winrm: 5985,
  api: 443,
  redfish: 443,
  onvif: 80,
};

/** credential_type ammessi in `credentials`/`network_credentials` per protocollo. */
function credentialTypesForProtocol(protocol: CredProtocol): string[] {
  switch (protocol) {
    case "ssh":
      return ["ssh", "linux"];
    case "winrm":
      return ["windows"];
    case "snmp":
      return ["snmp"];
    case "api":
    case "redfish":
    case "onvif":
      return ["api"];
  }
}

/** role legacy (network_host_credentials/host_detect_credential) per protocollo. 'api'/'redfish'/'onvif' non hanno ruolo legacy. */
function legacyRolesForProtocol(protocol: CredProtocol): Array<"windows" | "linux" | "ssh" | "snmp"> {
  switch (protocol) {
    case "ssh":
      return ["ssh", "linux"];
    case "winrm":
      return ["windows"];
    case "snmp":
      return ["snmp"];
    case "api":
    case "redfish":
    case "onvif":
      return [];
  }
}

interface HostCredentialStateRow {
  credential_id: number;
  port: number;
  validated: number;
  fail_count: number;
  backoff_until: string | null;
}

/**
 * Risolve il device collegato a un host (bridge host→device) o l'host
 * collegato a un device (bridge device→host), secondo le regole del brief:
 * preferire il match via FK `network_devices.host_id` (più affidabile),
 * fallback sul match stringa su `host` (IP) quando disponibile.
 */
function bridgeIds(
  dbh: Database.Database,
  hostId: number | null,
  deviceId: number | null,
  ip: string | undefined
): { hostId: number | null; deviceId: number | null } {
  let resolvedDeviceId = deviceId;
  let resolvedHostId = hostId;

  if (resolvedHostId != null && resolvedDeviceId == null) {
    const byFk = dbh
      .prepare(`SELECT id FROM network_devices WHERE host_id = ? ORDER BY id LIMIT 1`)
      .get(resolvedHostId) as { id: number } | undefined;
    if (byFk) {
      resolvedDeviceId = byFk.id;
    } else if (ip) {
      const byIp = dbh
        .prepare(`SELECT id FROM network_devices WHERE host = ? ORDER BY id LIMIT 1`)
        .get(ip) as { id: number } | undefined;
      resolvedDeviceId = byIp?.id ?? null;
    }
  }

  if (resolvedDeviceId != null && resolvedHostId == null) {
    const byFk = dbh
      .prepare(`SELECT host_id FROM network_devices WHERE id = ?`)
      .get(resolvedDeviceId) as { host_id: number | null } | undefined;
    resolvedHostId = byFk?.host_id ?? null;
  }

  return { hostId: resolvedHostId, deviceId: resolvedDeviceId };
}

/**
 * Variante pura (testabile in-memory senza contesto tenant): risolve le
 * credenziali candidate per (host|device, protocollo) nell'ordine di
 * precedenza del brief §Task1:
 *
 *   1. host_credentials validate
 *   2. device_credential_bindings con test_status='success'
 *   3. host_credentials non validate
 *   4. device_credential_bindings non testati (test_status='untested')
 *   5. network_credentials (catena di rete v2), filtrate per credential_type
 *   6. catena legacy: host_detect_credential (pin per host) poi
 *      network_host_credentials (per rete), per ciascun ruolo legacy
 *      applicabile al protocollo
 *
 * Deduplica per (credential_id, port): un candidato già emesso da un tier
 * precedente non viene ripetuto da un tier successivo. Il fail_count/
 * backoff_until riportato per OGNI candidato viene letto da host_credentials
 * quando esiste una riga per quella (host, credential, protocollo, porta) —
 * anche se il candidato proviene da un tier diverso (device binding/rete/
 * legacy) — così un fallimento registrato in precedenza continua a escludere
 * la credenziale in backoff indipendentemente da quale tier la riproponga.
 * `device_credential_bindings.test_status = 'failed'` viene escluso a monte:
 * un binding noto per fallire non deve essere riproposto dal resolver.
 */
export function resolveCredentialsForDb(
  dbh: Database.Database,
  target: ResolveTarget,
  protocol: CredProtocol,
  opts?: ResolveOptions
): ResolvedCredential[] {
  const includeBackoff = opts?.includeBackoff ?? false;
  const nowIso = new Date().toISOString();
  const { hostId, deviceId } = bridgeIds(dbh, target.hostId ?? null, target.deviceId ?? null, target.ip);

  const hostCredRows: HostCredentialStateRow[] =
    hostId != null
      ? (dbh
          .prepare(
            `SELECT credential_id, port, validated, fail_count, backoff_until
             FROM host_credentials
             WHERE host_id = ? AND protocol_type = ?
             ORDER BY sort_order ASC, id ASC`
          )
          .all(hostId, protocol) as HostCredentialStateRow[])
      : [];
  const hostCredByKey = new Map<string, HostCredentialStateRow>();
  for (const r of hostCredRows) hostCredByKey.set(`${r.credential_id}:${r.port}`, r);

  const results: ResolvedCredential[] = [];
  const seen = new Set<string>();

  const push = (credentialId: number, port: number, source: ResolvedCredentialSource, row?: HostCredentialStateRow): void => {
    const key = `${credentialId}:${port}`;
    if (seen.has(key)) return;
    const state = row ?? hostCredByKey.get(key);
    const backoffUntil = state?.backoff_until ?? null;
    if (!includeBackoff && backoffUntil && backoffUntil > nowIso) {
      seen.add(key);
      return;
    }
    seen.add(key);
    results.push({
      credential_id: credentialId,
      protocol,
      port,
      source,
      validated: state?.validated === 1,
      fail_count: state?.fail_count ?? 0,
      backoff_until: backoffUntil,
    });
  };

  // Tier 1: host_credentials validate.
  for (const r of hostCredRows) {
    if (r.validated === 1) push(r.credential_id, r.port, "host_validated", r);
  }

  // Tier 2 + 4: device bindings, split per test_status (failed esclusi a monte).
  const bindingRows =
    deviceId != null
      ? (dbh
          .prepare(
            `SELECT credential_id, port, test_status
             FROM device_credential_bindings
             WHERE device_id = ? AND protocol_type = ? AND credential_id IS NOT NULL AND test_status != 'failed'
             ORDER BY sort_order ASC, id ASC`
          )
          .all(deviceId, protocol) as Array<{ credential_id: number; port: number; test_status: string }>)
      : [];
  for (const b of bindingRows) {
    if (b.test_status === "success") push(b.credential_id, b.port, "device_binding");
  }

  // Tier 3: host_credentials non validate.
  for (const r of hostCredRows) {
    if (r.validated !== 1) push(r.credential_id, r.port, "host_unvalidated", r);
  }

  // Tier 4: device bindings non testati.
  for (const b of bindingRows) {
    if (b.test_status === "untested") push(b.credential_id, b.port, "device_binding");
  }

  // Tier 5: catena di rete (network_credentials v2).
  const types = credentialTypesForProtocol(protocol);
  if (types.length > 0) {
    const placeholders = types.map(() => "?").join(",");
    const netRows = dbh
      .prepare(
        `SELECT nc.credential_id
         FROM network_credentials nc
         JOIN credentials c ON c.id = nc.credential_id
         WHERE nc.network_id = ? AND c.credential_type IN (${placeholders})
         ORDER BY nc.sort_order ASC, nc.id ASC`
      )
      .all(target.networkId, ...types) as Array<{ credential_id: number }>;
    for (const r of netRows) push(r.credential_id, DEFAULT_PORTS[protocol], "network_chain");
  }

  // Tier 6: catena legacy — pin per host, poi lista per rete, per ciascun ruolo applicabile.
  const roles = legacyRolesForProtocol(protocol);
  if (hostId != null) {
    for (const role of roles) {
      const row = dbh
        .prepare(`SELECT credential_id FROM host_detect_credential WHERE host_id = ? AND role = ?`)
        .get(hostId, role) as { credential_id: number } | undefined;
      if (row) push(row.credential_id, DEFAULT_PORTS[protocol], "legacy_chain");
    }
  }
  for (const role of roles) {
    const rows = dbh
      .prepare(
        `SELECT credential_id FROM network_host_credentials WHERE network_id = ? AND role = ? ORDER BY sort_order ASC, id ASC`
      )
      .all(target.networkId, role) as Array<{ credential_id: number }>;
    for (const r of rows) push(r.credential_id, DEFAULT_PORTS[protocol], "legacy_chain");
  }

  return opts?.limit != null ? results.slice(0, opts.limit) : results;
}

/** Prima credenziale utilizzabile secondo `resolveCredentialsForDb`, o null. */
export function resolveCredentialForDb(
  dbh: Database.Database,
  target: ResolveTarget,
  protocol: CredProtocol
): ResolvedCredential | null {
  const [first] = resolveCredentialsForDb(dbh, target, protocol, { limit: 1 });
  return first ?? null;
}

/**
 * Risolve il DB del tenant corrente (AsyncLocalStorage di db-tenant.ts) senza
 * import statico — vedi commento di testa del file sul perché (evitare un
 * ciclo con db-tenant.ts, che nella fase 2 del piano importerà questo modulo).
 */
function getCurrentTenantDb(): Database.Database | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCurrentTenantCode, getTenantDb } = require("@/lib/db-tenant") as typeof import("@/lib/db-tenant");
    const code = getCurrentTenantCode();
    if (!code) return null;
    return getTenantDb(code);
  } catch {
    return null;
  }
}

/**
 * Ordine: host validate → binding device con test_status success → host non
 * validate → binding device non testati → catena di rete (network_credentials)
 * → catena legacy. Esclude le credenziali in backoff attivo salvo
 * `includeBackoff:true`. Non lancia mai: su qualunque errore (tenant assente,
 * DB non raggiungibile, query fallita) ritorna array vuoto.
 */
export function resolveCredentialsFor(
  target: ResolveTarget,
  protocol: CredProtocol,
  opts?: ResolveOptions
): ResolvedCredential[] {
  try {
    const dbh = getCurrentTenantDb();
    if (!dbh) return [];
    return resolveCredentialsForDb(dbh, target, protocol, opts);
  } catch (e) {
    console.error("[credentials] resolveCredentialsFor fallito:", e);
    return [];
  }
}

/** Prima credenziale utilizzabile, o null. */
export function resolveCredentialFor(
  target: Parameters<typeof resolveCredentialsFor>[0],
  protocol: CredProtocol
): ResolvedCredential | null {
  const [first] = resolveCredentialsFor(target, protocol, { limit: 1 });
  return first ?? null;
}

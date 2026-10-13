/**
 * Copia CONGELATA delle funzioni del dominio «credenziali» com'erano nella facciata
 * `db.ts` prima dello spostamento in `db-tenant.ts` (commit 73e47ed, T3-06,
 * NUC-2 gruppo 1b). Dopo lo spostamento `db.ts` le riesporta: la parità si prova
 * contro questa copia, come per il gruppo 0. Testo identico all'originale; non si
 * modifica. Generata dal parser di TypeScript, con gli aiutanti locali che usava.
 */
import { getDb, updateBindingTestStatus } from "@/lib/db";
import { getCredentialById, getNetworkCredentials, getNetworkDeviceByHostId, getNetworkDeviceByHost, findExistingBinding } from "@/lib/db-tenant";
import type { NetworkCredentialRole, CredentialCoverageRow, DeviceCredentialBinding } from "@/lib/db-tenant";
import type { CredProtocol } from "@/lib/credentials/resolve";

const CREDENTIAL_COVERAGE_PROTOCOLS: Record<string, readonly CredProtocol[]> = {
  network: ["snmp"],
  "network.router": ["snmp"],
  "network.switch": ["snmp"],
  "network.access_point": ["snmp"],
  "network.firewall": ["snmp"],
  "network.controller": ["snmp"],
  "network.modem": ["snmp"],
  "compute.workstation": ["winrm"],
  "compute.laptop": ["winrm"],
  "compute.server": ["winrm", "ssh", "redfish"],
  "compute.hypervisor": ["winrm", "ssh", "redfish"],
  "av.camera": ["onvif"],
  storage: ["ssh", "snmp"],
  "storage.nas": ["ssh", "snmp"],
  "storage.san": ["ssh", "snmp"],
  "storage.tape": ["ssh", "snmp"],
};

export function getCredentialCoverageByCategory(): CredentialCoverageRow[] {
  const d = getDb();
  let categoryRows: Array<{ category: string; hosts: number }>;
  try {
    categoryRows = d
      .prepare(
        `SELECT attr_category AS category, COUNT(*) AS hosts
         FROM hosts
         WHERE attr_category IS NOT NULL AND attr_category != 'unknown'
         GROUP BY attr_category`
      )
      .all() as Array<{ category: string; hosts: number }>;
  } catch (e) {
    console.error("[db] getCredentialCoverageByCategory: query categorie fallita:", e);
    return [];
  }

  const out: CredentialCoverageRow[] = [];
  for (const row of categoryRows) {
    const protocols = CREDENTIAL_COVERAGE_PROTOCOLS[row.category];
    if (!protocols || protocols.length === 0) continue;
    try {
      const placeholders = protocols.map(() => "?").join(",");
      const withValid = d
        .prepare(
          `SELECT COUNT(*) AS n FROM hosts h
           WHERE h.attr_category = ? AND EXISTS (
             SELECT 1 FROM host_credentials hc
             WHERE hc.host_id = h.id AND hc.validated = 1 AND hc.protocol_type IN (${placeholders})
           )`
        )
        .get(row.category, ...protocols) as { n: number };
      out.push({
        category: row.category,
        hosts: row.hosts,
        withValidCredential: withValid.n ?? 0,
        expectedProtocol: protocols.join("/"),
      });
    } catch (e) {
      console.error(`[db] getCredentialCoverageByCategory: query copertura fallita per ${row.category}:`, e);
    }
  }

  return out.sort((a, b) => a.category.localeCompare(b.category));
}

function credentialMatchesNetworkRole(
  credentialType: string,
  role: NetworkCredentialRole
): boolean {
  const t = credentialType.toLowerCase();
  if (role === "windows") return t === "windows";
  if (role === "linux") return t === "linux";
  if (role === "ssh") return t === "ssh";
  if (role === "snmp") return t === "snmp";
  return false;
}

export function replaceNetworkHostCredentials(
  networkId: number,
  role: NetworkCredentialRole,
  credentialIds: number[]
): void {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of credentialIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = getCredentialById(id);
    if (!c || !credentialMatchesNetworkRole(String(c.credential_type), role)) {
      throw new Error(`Credenziale #${id} non valida per ruolo ${role}`);
    }
    unique.push(id);
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM network_host_credentials WHERE network_id = ? AND role = ?`).run(networkId, role);
    const ins = db.prepare(
      `INSERT INTO network_host_credentials (network_id, credential_id, role, sort_order) VALUES (?,?,?,?)`
    );
    unique.forEach((cid, i) => ins.run(networkId, cid, role, i));
  })();
}

export function replaceNetworkCredentials(networkId: number, credentialIds: number[]): void {
  const seen = new Set<number>();
  const unique: number[] = [];
  for (const id of credentialIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM network_credentials WHERE network_id = ?`).run(networkId);
    const ins = db.prepare(
      `INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
    );
    unique.forEach((cid, i) => ins.run(networkId, cid, i));
  })();
}

export function addNetworkCredential(networkId: number, credentialId: number): void {
  const db = getDb();
  const max = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?`
  ).get(networkId) as { m: number };
  db.prepare(
    `INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
  ).run(networkId, credentialId, max.m + 1);
}

export function reorderNetworkCredentials(networkId: number, orderedCredentialIds: number[]): void {
  const db = getDb();
  db.transaction(() => {
    const upd = db.prepare(
      `UPDATE network_credentials SET sort_order = ? WHERE network_id = ? AND credential_id = ?`
    );
    orderedCredentialIds.forEach((cid, i) => upd.run(i, networkId, cid));
  })();
}

export function copyNetworkCredentials(sourceNetworkId: number, targetNetworkId: number): number {
  const db = getDb();
  const source = getNetworkCredentials(sourceNetworkId);
  const existing = new Set(
    getNetworkCredentials(targetNetworkId).map((r) => r.credential_id)
  );
  const max = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM network_credentials WHERE network_id = ?`
  ).get(targetNetworkId) as { m: number };
  let order = max.m + 1;
  let added = 0;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)`
  );
  db.transaction(() => {
    for (const s of source) {
      if (existing.has(s.credential_id)) continue;
      ins.run(targetNetworkId, s.credential_id, order++);
      added++;
    }
  })();
  return added;
}

export function addHostCredential(
  hostId: number,
  credentialId: number,
  protocolType: "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif",
  port: number,
  options?: { validated?: boolean; auto_detected?: boolean }
): void {
  const db = getDb();
  const max = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
  ).get(hostId) as { m: number };
  db.prepare(
    `INSERT OR IGNORE INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected)
     VALUES (?, ?, ?, ?, ?, ${options?.validated ? "datetime('now')" : "NULL"}, ?, ?)`
  ).run(
    hostId,
    credentialId,
    protocolType,
    port,
    options?.validated ? 1 : 0,
    max.m + 1,
    options?.auto_detected ? 1 : 0
  );
}

export function setHostCredentialValidatedByKey(
  hostId: number,
  credentialId: number,
  protocolType: "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif",
  port: number,
  options?: { auto_detected?: boolean }
): void {
  const db = getDb();
  const max = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
  ).get(hostId) as { m: number };
  db.prepare(
    `INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected)
     VALUES (?, ?, ?, ?, 1, datetime('now'), ?, ?)
     ON CONFLICT(host_id, credential_id, protocol_type, port) DO UPDATE SET
       validated = 1,
       validated_at = datetime('now')`
  ).run(
    hostId,
    credentialId,
    protocolType,
    port,
    max.m + 1,
    options?.auto_detected ? 1 : 0
  );
}

function findDeviceIdForHostCred(hostId: number): number | null {
  const byFk = getNetworkDeviceByHostId(hostId);
  if (byFk) return byFk.id;
  const host = getDb().prepare(`SELECT ip FROM hosts WHERE id = ?`).get(hostId) as { ip: string } | undefined;
  if (!host) return null;
  const byIp = getNetworkDeviceByHost(host.ip);
  return byIp?.id ?? null;
}

export function recordCredentialFailure(
  hostId: number,
  credentialId: number,
  protocol: CredProtocol,
  port: number,
  error: string
): void {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, fail_count FROM host_credentials WHERE host_id = ? AND credential_id = ? AND protocol_type = ? AND port = ?`
    )
    .get(hostId, credentialId, protocol, port) as { id: number; fail_count: number } | undefined;

  const newFailCount = (existing?.fail_count ?? 0) + 1;
  const backoffMs = Math.min(2 ** newFailCount * 5 * 60 * 1000, 24 * 60 * 60 * 1000);
  const nowIso = new Date().toISOString();
  const backoffUntil = new Date(Date.now() + backoffMs).toISOString();

  if (existing) {
    db.prepare(
      `UPDATE host_credentials
       SET fail_count = ?, last_error = ?, last_attempt_at = ?, backoff_until = ?,
           validated = 0, validated_at = NULL
       WHERE id = ?`
    ).run(newFailCount, error, nowIso, backoffUntil, existing.id);
  } else {
    const max = db.prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
    ).get(hostId) as { m: number };
    db.prepare(
      `INSERT INTO host_credentials
         (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected, fail_count, last_error, last_attempt_at, backoff_until)
       VALUES (?, ?, ?, ?, 0, NULL, ?, 0, ?, ?, ?, ?)`
    ).run(hostId, credentialId, protocol, port, max.m + 1, newFailCount, error, nowIso, backoffUntil);
  }

  const deviceId = findDeviceIdForHostCred(hostId);
  if (deviceId != null) {
    const binding = findExistingBinding(deviceId, credentialId, protocol, port);
    if (binding) updateBindingTestStatus(binding.id, "failed", error);
  }
}

export function recordCredentialSuccess(
  hostId: number,
  credentialId: number,
  protocol: CredProtocol,
  port: number
): void {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const max = db.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) AS m FROM host_credentials WHERE host_id = ?`
  ).get(hostId) as { m: number };
  db.prepare(
    `INSERT INTO host_credentials
       (host_id, credential_id, protocol_type, port, validated, validated_at, sort_order, auto_detected, fail_count, last_error, last_attempt_at, backoff_until)
     VALUES (?, ?, ?, ?, 1, datetime('now'), ?, 0, 0, NULL, ?, NULL)
     ON CONFLICT(host_id, credential_id, protocol_type, port) DO UPDATE SET
       validated = 1,
       validated_at = datetime('now'),
       fail_count = 0,
       last_error = NULL,
       last_attempt_at = excluded.last_attempt_at,
       backoff_until = NULL`
  ).run(hostId, credentialId, protocol, port, max.m + 1, nowIso);

  const deviceId = findDeviceIdForHostCred(hostId);
  if (deviceId != null) {
    const binding = findExistingBinding(deviceId, credentialId, protocol, port);
    if (binding) updateBindingTestStatus(binding.id, "success", "Autenticazione riuscita");
  }
}

export function addDeviceCredentialBinding(input: {
  device_id: number;
  credential_id?: number | null;
  protocol_type: string;
  port: number;
  sort_order?: number;
  inline_username?: string | null;
  inline_encrypted_password?: string | null;
  auto_detected?: boolean;
}): DeviceCredentialBinding {
  const db = getDb();
  // sort_order = max + 1 se non specificato
  const maxOrder = (db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) as m FROM device_credential_bindings WHERE device_id = ?"
  ).get(input.device_id) as { m: number }).m;
  const sortOrder = input.sort_order ?? maxOrder + 1;

  const result = db.prepare(`
    INSERT INTO device_credential_bindings
      (device_id, credential_id, protocol_type, port, sort_order, inline_username, inline_encrypted_password, auto_detected)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.device_id,
    input.credential_id ?? null,
    input.protocol_type,
    input.port,
    sortOrder,
    input.inline_username ?? null,
    input.inline_encrypted_password ?? null,
    input.auto_detected ? 1 : 0
  );

  return db.prepare(`
    SELECT dcb.*, c.name AS credential_name, c.credential_type
    FROM device_credential_bindings dcb
    LEFT JOIN credentials c ON c.id = dcb.credential_id
    WHERE dcb.id = ?
  `).get(result.lastInsertRowid) as DeviceCredentialBinding;
}

export function reorderDeviceCredentialBindings(deviceId: number, orderedIds: number[]): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE device_credential_bindings SET sort_order = ? WHERE id = ? AND device_id = ?");
  db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, orderedIds[i], deviceId);
    }
  })();
}

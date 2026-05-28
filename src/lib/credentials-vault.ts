/**
 * Credentials vault — AES-GCM encrypted single-source-of-truth per le
 * credenziali di accesso ai sistemi della stack security (Wazuh, Graylog,
 * LibreNMS, Scanner-Edge, DA-Vul-can hub, ecc.).
 *
 * DA-IPAM è l'entry point UI; questa libreria espone CRUD + reveal/audit.
 * Diverso dalla legacy `settings.integration_*` (plain text), questo è
 * un vault dedicato con encrypt at-rest + audit trail obbligatorio.
 */
import { getHubDb } from "./db-hub";
import { encrypt, safeDecrypt } from "./crypto";

export type CredentialKind =
  | "wazuh"
  | "graylog"
  | "librenms"
  | "edge"
  | "hub"
  | "tailscale"
  | "pve"
  | "other";

export type LaunchMode = "copy" | "sso_form" | "sso_token";

export interface SystemCredential {
  id: number;
  kind: CredentialKind;
  label: string;
  url: string | null;
  api_url: string | null;
  username: string | null;
  /** True se è valorizzato in DB. Plaintext NON viene mai restituito da list/get. */
  has_password: boolean;
  has_api_token: boolean;
  has_extra: boolean;
  launch_mode: LaunchMode;
  notes: string | null;
  last_tested_at: string | null;
  last_test_result: string | null;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SystemCredentialSecret {
  password: string | null;
  api_token: string | null;
  extra: Record<string, string> | null;
}

export interface CredentialInput {
  kind: CredentialKind;
  label: string;
  url?: string | null;
  api_url?: string | null;
  username?: string | null;
  password?: string | null;          // plaintext in; encrypted at-rest
  api_token?: string | null;
  extra?: Record<string, string> | null;
  launch_mode?: LaunchMode;
  notes?: string | null;
  enabled?: boolean;
  sort_order?: number;
}

interface Row {
  id: number;
  kind: string;
  label: string;
  url: string | null;
  api_url: string | null;
  username: string | null;
  password_enc: string | null;
  api_token_enc: string | null;
  extra_json_enc: string | null;
  launch_mode: string;
  notes: string | null;
  last_tested_at: string | null;
  last_test_result: string | null;
  enabled: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function rowToPublic(r: Row): SystemCredential {
  return {
    id: r.id,
    kind: r.kind as CredentialKind,
    label: r.label,
    url: r.url,
    api_url: r.api_url,
    username: r.username,
    has_password: !!r.password_enc,
    has_api_token: !!r.api_token_enc,
    has_extra: !!r.extra_json_enc,
    launch_mode: r.launch_mode as LaunchMode,
    notes: r.notes,
    last_tested_at: r.last_tested_at,
    last_test_result: r.last_test_result,
    enabled: !!r.enabled,
    sort_order: r.sort_order,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function listCredentials(opts: { enabledOnly?: boolean } = {}): SystemCredential[] {
  const db = getHubDb();
  const where = opts.enabledOnly ? "WHERE enabled = 1" : "";
  const rows = db
    .prepare(`SELECT * FROM system_credentials ${where} ORDER BY sort_order, id`)
    .all() as Row[];
  return rows.map(rowToPublic);
}

export function getCredential(id: number): SystemCredential | null {
  const db = getHubDb();
  const row = db
    .prepare("SELECT * FROM system_credentials WHERE id = ?")
    .get(id) as Row | undefined;
  return row ? rowToPublic(row) : null;
}

/** Recupera plaintext. Da usare SOLO in path autorizzati (reveal/launch/test). */
export function getCredentialSecrets(id: number): SystemCredentialSecret | null {
  const db = getHubDb();
  const row = db
    .prepare(
      "SELECT password_enc, api_token_enc, extra_json_enc FROM system_credentials WHERE id = ?",
    )
    .get(id) as
    | {
        password_enc: string | null;
        api_token_enc: string | null;
        extra_json_enc: string | null;
      }
    | undefined;
  if (!row) return null;

  let extra: Record<string, string> | null = null;
  if (row.extra_json_enc) {
    const plain = safeDecrypt(row.extra_json_enc);
    if (plain) {
      try {
        const parsed = JSON.parse(plain);
        if (parsed && typeof parsed === "object") {
          extra = parsed as Record<string, string>;
        }
      } catch {
        // ignore — extra rimane null
      }
    }
  }

  return {
    password: row.password_enc ? safeDecrypt(row.password_enc) : null,
    api_token: row.api_token_enc ? safeDecrypt(row.api_token_enc) : null,
    extra,
  };
}

export function createCredential(input: CredentialInput): SystemCredential {
  const db = getHubDb();
  const passwordEnc = input.password ? encrypt(input.password) : null;
  const apiTokenEnc = input.api_token ? encrypt(input.api_token) : null;
  const extraEnc = input.extra ? encrypt(JSON.stringify(input.extra)) : null;
  const launchMode = input.launch_mode ?? "copy";
  const enabled = input.enabled === false ? 0 : 1;
  const sortOrder = input.sort_order ?? 100;

  const info = db
    .prepare(
      `INSERT INTO system_credentials
       (kind, label, url, api_url, username, password_enc, api_token_enc, extra_json_enc,
        launch_mode, notes, enabled, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.kind,
      input.label,
      input.url ?? null,
      input.api_url ?? null,
      input.username ?? null,
      passwordEnc,
      apiTokenEnc,
      extraEnc,
      launchMode,
      input.notes ?? null,
      enabled,
      sortOrder,
    );
  const id = Number(info.lastInsertRowid);
  const created = getCredential(id);
  if (!created) throw new Error("Credential creata ma getCredential ritorna null");
  return created;
}

/**
 * Update parziale. Solo i campi presenti in `patch` vengono toccati.
 * Per i secret: una stringa vuota "" significa "rimuovi", `null`/undefined "non toccare".
 * NB: i bool 'enabled' devono essere passati esplicitamente per essere modificati.
 */
export function updateCredential(
  id: number,
  patch: Partial<CredentialInput>,
): SystemCredential | null {
  const existing = getCredential(id);
  if (!existing) return null;

  const sets: string[] = [];
  const values: unknown[] = [];

  if (patch.kind !== undefined) {
    sets.push("kind = ?");
    values.push(patch.kind);
  }
  if (patch.label !== undefined) {
    sets.push("label = ?");
    values.push(patch.label);
  }
  if (patch.url !== undefined) {
    sets.push("url = ?");
    values.push(patch.url);
  }
  if (patch.api_url !== undefined) {
    sets.push("api_url = ?");
    values.push(patch.api_url);
  }
  if (patch.username !== undefined) {
    sets.push("username = ?");
    values.push(patch.username);
  }
  if (patch.password !== undefined) {
    sets.push("password_enc = ?");
    values.push(patch.password ? encrypt(patch.password) : null);
  }
  if (patch.api_token !== undefined) {
    sets.push("api_token_enc = ?");
    values.push(patch.api_token ? encrypt(patch.api_token) : null);
  }
  if (patch.extra !== undefined) {
    sets.push("extra_json_enc = ?");
    values.push(patch.extra ? encrypt(JSON.stringify(patch.extra)) : null);
  }
  if (patch.launch_mode !== undefined) {
    sets.push("launch_mode = ?");
    values.push(patch.launch_mode);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    values.push(patch.notes);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.sort_order !== undefined) {
    sets.push("sort_order = ?");
    values.push(patch.sort_order);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = datetime('now')");
  values.push(id);

  const db = getHubDb();
  db.prepare(`UPDATE system_credentials SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  return getCredential(id);
}

export function deleteCredential(id: number): boolean {
  const db = getHubDb();
  const info = db.prepare("DELETE FROM system_credentials WHERE id = ?").run(id);
  return info.changes > 0;
}

export function recordTestResult(id: number, result: string): void {
  const db = getHubDb();
  db.prepare(
    "UPDATE system_credentials SET last_tested_at = datetime('now'), last_test_result = ? WHERE id = ?",
  ).run(result, id);
}

// ============================================================================
// Audit log
// ============================================================================
export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "reveal"
  | "launch"
  | "test"
  | "rotate";

export function logCredentialEvent(opts: {
  credentialId: number | null;
  action: AuditAction;
  actorUserId?: number | null;
  actorUsername?: string | null;
  result?: string | null;
  details?: Record<string, unknown>;
}): void {
  const db = getHubDb();
  db.prepare(
    `INSERT INTO system_credential_events
     (credential_id, action, actor_user_id, actor_username, result, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.credentialId,
    opts.action,
    opts.actorUserId ?? null,
    opts.actorUsername ?? null,
    opts.result ?? null,
    opts.details ? JSON.stringify(opts.details) : null,
  );
}

export interface CredentialEvent {
  id: number;
  credential_id: number | null;
  action: string;
  actor_user_id: number | null;
  actor_username: string | null;
  result: string | null;
  details_json: string | null;
  ts: string;
}

export function listCredentialEvents(opts: { credentialId?: number; limit?: number } = {}): CredentialEvent[] {
  const db = getHubDb();
  const limit = opts.limit ?? 50;
  if (opts.credentialId !== undefined) {
    return db
      .prepare(
        "SELECT * FROM system_credential_events WHERE credential_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(opts.credentialId, limit) as CredentialEvent[];
  }
  return db
    .prepare("SELECT * FROM system_credential_events ORDER BY id DESC LIMIT ?")
    .all(limit) as CredentialEvent[];
}

// ============================================================================
// Sync da legacy settings.integration_* → vault (one-shot migration helper)
// ============================================================================
import { getSetting } from "./db-hub";
import { getTenantDb } from "./db-tenant";
import { getActiveTenants } from "./db-hub";

/**
 * Importa le credenziali esistenti nel vault cifrato.
 * Idempotente: crea le entry mancanti, NON sovrascrive.
 *
 * Sorgenti:
 *  - hub `settings.integration_librenms_*`  (plain text legacy)
 *  - hub `settings.integration_graylog_*`   (plain text legacy)
 *  - hub `settings.integration_loki_*`      (plain text legacy)
 *  - hub `settings.integration_wazuh_*`     (password già encrypted via crypto.ts)
 *  - tenant `vuln_scanners`                  (scanner-edge per ogni tenant)
 */
export function syncFromLegacySettings(): { created: number; skipped: number } {
  const existing = listCredentials();
  const byKind = new Map(existing.map((c) => [`${c.kind}:${c.label}`, c]));
  let created = 0;
  let skipped = 0;

  const tryAdd = (
    kind: CredentialKind,
    label: string,
    fields: {
      url?: string;
      api_url?: string;
      username?: string;
      password?: string;
      api_token?: string;
    },
  ): void => {
    if (byKind.has(`${kind}:${label}`)) {
      skipped++;
      return;
    }
    const hasAny = fields.password || fields.api_token || fields.url;
    if (!hasAny) {
      skipped++;
      return;
    }
    createCredential({
      kind,
      label,
      url: fields.url ?? null,
      api_url: fields.api_url ?? null,
      username: fields.username ?? null,
      password: fields.password || null,
      api_token: fields.api_token || null,
    });
    created++;
  };

  // LibreNMS (settings legacy plain-text)
  tryAdd("librenms", "LibreNMS (managed)", {
    url: getSetting("integration_librenms_url") ?? undefined,
    username: "admin",
    api_token: getSetting("integration_librenms_api_token") ?? undefined,
    password: getSetting("integration_librenms_admin_password") ?? undefined,
  });

  // Graylog (settings legacy plain-text)
  tryAdd("graylog", "Graylog (managed)", {
    url: getSetting("integration_graylog_url") ?? undefined,
    username: getSetting("integration_graylog_username") ?? undefined,
    password: getSetting("integration_graylog_password") ?? undefined,
    api_token: getSetting("integration_graylog_api_token") ?? undefined,
  });

  // Loki (settings legacy, no UI)
  tryAdd("other", "Loki", {
    url: getSetting("integration_loki_url") ?? undefined,
    api_token: getSetting("integration_loki_api_token") ?? undefined,
  });

  // Wazuh Manager (settings hub, password già encrypted via crypto.ts)
  const wzPasswordEnc = getSetting("integration_wazuh_password_encrypted");
  const wzPassword = wzPasswordEnc ? safeDecrypt(wzPasswordEnc) : null;
  tryAdd("wazuh", "Wazuh Manager", {
    url: getSetting("integration_wazuh_url") ?? undefined,
    username: getSetting("integration_wazuh_username") ?? undefined,
    password: wzPassword ?? undefined,
  });

  // Wazuh Indexer (OpenSearch)
  const wzIdxPasswordEnc = getSetting("integration_wazuh_indexer_password_encrypted");
  const wzIdxPassword = wzIdxPasswordEnc ? safeDecrypt(wzIdxPasswordEnc) : null;
  tryAdd("wazuh", "Wazuh Indexer (OpenSearch)", {
    url: getSetting("integration_wazuh_indexer_url") ?? undefined,
    username: getSetting("integration_wazuh_indexer_username") ?? undefined,
    password: wzIdxPassword ?? undefined,
  });

  // Scanner-Edge: scan tenant DBs alla ricerca di vuln_scanners (token_encrypted).
  // Aggrega come "<scanner.name> (<tenant>)" — un'entry per ogni tenant×scanner.
  try {
    const tenants = getActiveTenants();
    for (const t of tenants) {
      try {
        const tdb = getTenantDb(t.codice_cliente);
        const scanners = tdb
          .prepare("SELECT name, base_url, token_encrypted FROM vuln_scanners WHERE enabled = 1")
          .all() as Array<{ name: string; base_url: string; token_encrypted: string }>;
        for (const s of scanners) {
          const token = s.token_encrypted ? safeDecrypt(s.token_encrypted) : null;
          tryAdd("edge", `${s.name} (${t.codice_cliente})`, {
            url: s.base_url,
            api_url: s.base_url,
            api_token: token ?? undefined,
          });
        }
      } catch {
        // tenant DB illeggibile: salta silenzioso (non-critical per sync)
      }
    }
  } catch {
    // ignore
  }

  return { created, skipped };
}

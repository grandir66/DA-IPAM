import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { encrypt, safeDecrypt } from "@/lib/crypto";

export interface MdmConfig {
  base_url: string | null;
  username: string | null;
  user_field: string;
  enabled: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  consecutive_errors: number;
}

function db() {
  const c = getCurrentTenantCode();
  if (!c) throw new Error("mdm-config: no tenant context");
  return getTenantDb(c);
}

/** Config pubblica (la password NON è mai inclusa). */
export function getMdmConfig(): MdmConfig {
  const r = db()
    .prepare(
      `SELECT base_url, username, user_field, enabled, last_sync_at, last_error, consecutive_errors
       FROM mdm_config WHERE id=1`,
    )
    .get() as Record<string, unknown> | undefined;
  return {
    base_url: (r?.base_url as string) ?? null,
    username: (r?.username as string) ?? null,
    user_field: (r?.user_field as string) ?? "description",
    enabled: !!r?.enabled,
    last_sync_at: (r?.last_sync_at as string) ?? null,
    last_error: (r?.last_error as string) ?? null,
    consecutive_errors: (r?.consecutive_errors as number) ?? 0,
  };
}

/** Credenziali in chiaro per il connettore (decifra la password). Null se incomplete. */
export function getMdmCreds(): { baseUrl: string; username: string; password: string } | null {
  const r = db()
    .prepare(`SELECT base_url, username, password_encrypted FROM mdm_config WHERE id=1`)
    .get() as Record<string, unknown> | undefined;
  if (!r?.base_url || !r?.username || !r?.password_encrypted) return null;
  const pwd = safeDecrypt(r.password_encrypted as string);
  if (pwd == null) return null;
  return { baseUrl: r.base_url as string, username: r.username as string, password: pwd };
}

export function saveMdmConfig(input: {
  base_url: string;
  username: string;
  password?: string;
  user_field?: string;
  enabled?: boolean;
}): void {
  const conn = db();
  const existing = conn.prepare(`SELECT password_encrypted FROM mdm_config WHERE id=1`).get() as
    | { password_encrypted?: string }
    | undefined;
  const enc = input.password ? encrypt(input.password) : (existing?.password_encrypted ?? null);
  conn
    .prepare(
      `INSERT INTO mdm_config (id, base_url, username, password_encrypted, user_field, enabled)
       VALUES (1, @base_url, @username, @enc, @user_field, @enabled)
       ON CONFLICT(id) DO UPDATE SET base_url=@base_url, username=@username,
         password_encrypted=@enc, user_field=@user_field, enabled=@enabled`,
    )
    .run({
      base_url: input.base_url,
      username: input.username,
      enc,
      user_field: input.user_field ?? "description",
      enabled: input.enabled ? 1 : 0,
    });
}

/** Aggiorna esito sync. Auto-disable dopo 5 errori consecutivi (pattern vuln_scanners). */
export function recordSync(ok: boolean, error?: string): void {
  const conn = db();
  if (ok) {
    conn
      .prepare(`UPDATE mdm_config SET last_sync_at=datetime('now'), last_error=NULL, consecutive_errors=0 WHERE id=1`)
      .run();
  } else {
    conn
      .prepare(
        `UPDATE mdm_config SET last_sync_at=datetime('now'), last_error=?, consecutive_errors=consecutive_errors+1 WHERE id=1`,
      )
      .run(error ?? "error");
    conn.prepare(`UPDATE mdm_config SET enabled=0 WHERE id=1 AND consecutive_errors>=5`).run();
  }
}

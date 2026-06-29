/**
 * Config MeshCentral per-tenant, cifrata at-rest (pattern mdm-config.ts).
 * Singleton row id=1 in mc_config (tabella in db-tenant-schema.ts).
 *   - loginTokenKey: stringa HEX (160 hex = 80 byte LoginCookieEncryptionKey),
 *     cifrata at-rest; getMeshCreds la restituisce come Buffer (Buffer.from(hex,'hex')).
 *   - adminPass: cifrata at-rest.
 * getMeshConfig() NON espone MAI alcun secret (login key / admin pass).
 */
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { encrypt, safeDecrypt } from "@/lib/crypto";

export interface MeshConfigPublic {
  present: boolean;
  serverUrl: string;
  domain: string;
  meshId: string;
  serviceUser: string;
}

export interface MeshCreds {
  serverUrl: string;
  domain: string;
  meshId: string;
  serviceUser: string;
  loginTokenKey: Buffer;
  adminUser: string;
  adminPass: string;
}

function db() {
  const c = getCurrentTenantCode();
  if (!c) throw new Error("mesh-config: no tenant context");
  return getTenantDb(c);
}

/** Config pubblica: nessun secret. null se mai configurata. */
export function getMeshConfig(): MeshConfigPublic | null {
  const r = db()
    .prepare(
      `SELECT server_url, domain, mesh_id, service_user
         FROM mc_config WHERE id = 1`,
    )
    .get() as Record<string, unknown> | undefined;
  if (!r || !r.server_url) return null;
  return {
    present: Boolean(r.server_url && r.mesh_id),
    serverUrl: (r.server_url as string) ?? "",
    domain: (r.domain as string) ?? "",
    meshId: (r.mesh_id as string) ?? "",
    serviceUser: (r.service_user as string) ?? "",
  };
}

/** Credenziali decifrate per il backend (control-client / login-token). null se incompleta. */
export function getMeshCreds(): MeshCreds | null {
  const r = db()
    .prepare(
      `SELECT server_url, domain, mesh_id, service_user,
              login_token_key_encrypted, admin_user, admin_pass_encrypted
         FROM mc_config WHERE id = 1`,
    )
    .get() as Record<string, unknown> | undefined;
  if (!r?.server_url || !r?.mesh_id || !r?.login_token_key_encrypted) return null;

  const keyHex = safeDecrypt(r.login_token_key_encrypted as string);
  if (keyHex == null) return null;
  const adminPass =
    r.admin_pass_encrypted != null ? safeDecrypt(r.admin_pass_encrypted as string) : "";
  if (adminPass == null) return null;

  return {
    serverUrl: r.server_url as string,
    domain: (r.domain as string) ?? "",
    meshId: r.mesh_id as string,
    serviceUser: (r.service_user as string) ?? "",
    loginTokenKey: Buffer.from(keyHex, "hex"),
    adminUser: (r.admin_user as string) ?? "",
    adminPass,
  };
}

/** Salva/aggiorna la config tenant. loginTokenKey e adminPass cifrati at-rest.
 *  loginTokenKey deve essere una stringa HEX di esattamente 160 caratteri (80 byte).
 */
export function saveMeshConfig(input: {
  serverUrl: string;
  domain: string;
  meshId: string;
  serviceUser: string;
  loginTokenKey: string;
  adminUser: string;
  adminPass: string;
}): void {
  if (!/^[0-9a-fA-F]{160}$/.test(input.loginTokenKey)) {
    throw new Error("saveMeshConfig: loginTokenKey must be exactly 160 hex characters (80 bytes)");
  }
  db()
    .prepare(
      `INSERT INTO mc_config
         (id, server_url, domain, mesh_id, service_user,
          login_token_key_encrypted, admin_user, admin_pass_encrypted, updated_at)
       VALUES (1, @server_url, @domain, @mesh_id, @service_user,
               @key_enc, @admin_user, @pass_enc, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         server_url = @server_url,
         domain = @domain,
         mesh_id = @mesh_id,
         service_user = @service_user,
         login_token_key_encrypted = @key_enc,
         admin_user = @admin_user,
         admin_pass_encrypted = @pass_enc,
         updated_at = datetime('now')`,
    )
    .run({
      server_url: input.serverUrl,
      domain: input.domain,
      mesh_id: input.meshId,
      service_user: input.serviceUser,
      key_enc: encrypt(input.loginTokenKey),
      admin_user: input.adminUser,
      pass_enc: encrypt(input.adminPass),
    });
}

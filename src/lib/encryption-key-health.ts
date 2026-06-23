import { createHash } from "crypto";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { safeDecrypt } from "@/lib/crypto";

function resolveTenantsDir(): string {
  const dataDir = process.env.DA_INVENT_DATA_DIR?.trim();
  if (dataDir) return join(dataDir, "tenants");
  return join(process.cwd(), "data", "tenants");
}

function resolveHubDbPath(): string {
  const dataDir = process.env.DA_INVENT_DATA_DIR?.trim();
  if (dataDir) return join(dataDir, "hub.db");
  return join(process.cwd(), "data", "hub.db");
}

export type EncryptionKeyHealth = {
  configured: boolean;
  fingerprint: string | null;
  credentialCount: number;
  decryptOkCount: number;
  ok: boolean;
  detail: string | null;
};

/** Fingerprint non reversibile della chiave attiva (monitoring / supporto). */
export function encryptionKeyFingerprint(): string | null {
  const key = process.env.ENCRYPTION_KEY?.trim();
  if (!key) return null;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Verifica che le credenziali cifrate nel DB siano decifrabili con ENCRYPTION_KEY attuale.
 * Usato al boot e da /api/health.
 */
export function probeEncryptionKeyHealth(): EncryptionKeyHealth {
  const fingerprint = encryptionKeyFingerprint();
  if (!fingerprint) {
    return {
      configured: false,
      fingerprint: null,
      credentialCount: 0,
      decryptOkCount: 0,
      ok: false,
      detail: "ENCRYPTION_KEY non configurata",
    };
  }

  let credentialCount = 0;
  let decryptOkCount = 0;

  // 1. Credenziali per-tenant (tenants/*.db → credentials.encrypted_password).
  const tenantsDir = resolveTenantsDir();
  if (existsSync(tenantsDir)) {
    for (const file of readdirSync(tenantsDir)) {
      if (!file.endsWith(".db")) continue;
      const dbPath = join(tenantsDir, file);
      let db: Database.Database | null = null;
      try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true });
        const rows = db
          .prepare(
            `SELECT encrypted_password FROM credentials
             WHERE encrypted_password IS NOT NULL AND trim(encrypted_password) != ''
             LIMIT 50`
          )
          .all() as { encrypted_password: string }[];
        for (const row of rows) {
          credentialCount++;
          if (safeDecrypt(row.encrypted_password)) decryptOkCount++;
        }
      } catch {
        /* DB tenant vuoto o schema non ancora migrato */
      } finally {
        db?.close();
      }
    }
  }

  // 2. Credenziali integrazioni nel vault hub (hub.db → system_credentials).
  //    Coprirle evita un falso senso di sicurezza: un drift di ENCRYPTION_KEY
  //    le renderebbe illeggibili anche quando nessun tenant ha ancora salvato
  //    credenziali per-rete (incident-class "ENCRYPTION_KEY rigenerata").
  const hubDb = resolveHubDbPath();
  if (existsSync(hubDb)) {
    let db: Database.Database | null = null;
    try {
      db = new Database(hubDb, { readonly: true, fileMustExist: true });
      const rows = db
        .prepare(
          `SELECT password_enc, api_token_enc, extra_json_enc FROM system_credentials`
        )
        .all() as {
        password_enc: string | null;
        api_token_enc: string | null;
        extra_json_enc: string | null;
      }[];
      for (const row of rows) {
        for (const enc of [row.password_enc, row.api_token_enc, row.extra_json_enc]) {
          if (enc && enc.trim()) {
            credentialCount++;
            if (safeDecrypt(enc)) decryptOkCount++;
          }
        }
      }
    } catch {
      /* tabella system_credentials assente o schema non migrato */
    } finally {
      db?.close();
    }
  }

  const ok = credentialCount === 0 || decryptOkCount > 0;
  return {
    configured: true,
    fingerprint,
    credentialCount,
    decryptOkCount,
    ok,
    detail: ok
      ? null
      : `${credentialCount} credenziali salvate ma nessuna decifrabile con ENCRYPTION_KEY attuale. ` +
        "Allinea la chiave Docker/systemd con quella usata al salvataggio o re-inserisci le credenziali.",
  };
}

export function logEncryptionKeyHealthAtBoot(): void {
  const probe = probeEncryptionKeyHealth();
  if (!probe.configured) {
    console.error("CRITICAL [encryption-key] ENCRYPTION_KEY assente — credenziali e token non cifrati correttamente.");
    return;
  }
  if (!probe.ok) {
    console.error(
      `CRITICAL [encryption-key] ${probe.detail} (fingerprint=${probe.fingerprint}, ` +
        `decrypt_ok=${probe.decryptOkCount}/${probe.credentialCount})`
    );
    return;
  }
  if (probe.credentialCount > 0) {
    console.log(
      `[encryption-key] OK — ${probe.decryptOkCount}/${probe.credentialCount} credenziali decifrabili ` +
        `(fingerprint=${probe.fingerprint})`
    );
  }
}

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

  const tenantsDir = resolveTenantsDir();
  if (!existsSync(tenantsDir)) {
    return {
      configured: true,
      fingerprint,
      credentialCount: 0,
      decryptOkCount: 0,
      ok: true,
      detail: null,
    };
  }

  let credentialCount = 0;
  let decryptOkCount = 0;

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

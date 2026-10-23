import { createHash } from "crypto";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import Database from "better-sqlite3";
import { safeDecrypt } from "@/lib/crypto";
import { resolveDataDir } from "./data-dir";
import { cartellaVault } from "./vault/appliance";
import { archivioPresente } from "./vault/archivio";
import { chiaveDatiAttiva, vaultLocaleAcceso } from "./vault/stato";

function resolveTenantsDir(): string {
  return join(resolveDataDir(), "tenants");
}

function resolveHubDbPath(): string {
  return join(resolveDataDir(), "hub.db");
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

  // 1. Credenziali per-tenant (tenants/*.db → credentials.encrypted_password ed
  //    encrypted_username). Dalla tappa 2 una voce SNMP v3 ha la password NULL
  //    e l'utente cifrato: senza l'utente un tenant di sole v3 contava zero
  //    credenziali, cioè «tutto bene» con la chiave sbagliata.
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
            `SELECT encrypted_username, encrypted_password FROM credentials
             WHERE trim(COALESCE(encrypted_password, '')) != '' OR trim(COALESCE(encrypted_username, '')) != ''
             LIMIT 50`
          )
          .all() as { encrypted_username: string | null; encrypted_password: string | null }[];
        for (const row of rows) {
          for (const enc of [row.encrypted_username, row.encrypted_password]) {
            if (!enc?.trim()) continue;
            credentialCount++;
            if (safeDecrypt(enc)) decryptOkCount++;
          }
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

  // COR-06: health verde SOLO se TUTTE le credenziali sono decifrabili.
  // Prima bastava un solo secret decifrabile (decryptOkCount > 0) → il monitoring
  // restava verde mentre credenziali di rete/integrazioni erano già irrecuperabili.
  const ok = credentialCount === 0 || decryptOkCount === credentialCount;
  const failCount = credentialCount - decryptOkCount;
  // da-vault: col vault locale acceso e bloccato le credenziali della chiave degli slot non si leggono per quello,
  // non per una ENCRYPTION_KEY sbagliata.
  const vaultBloccato = vaultLocaleAcceso() && !chiaveDatiAttiva();
  // Rilievo 8 della revisione: interruttore spento ma l'archivio del vault c'è e i valori non si aprono con
  // ENCRYPTION_KEY = quasi certamente sono stati ricifrati dal vault e qualcuno ha spento DA_VAULT_LOCALE. Lo si dice.
  const archivioCon = !vaultLocaleAcceso() && archivioPresente(cartellaVault());
  return {
    configured: true,
    fingerprint,
    credentialCount,
    decryptOkCount,
    ok,
    detail: ok
      ? null
      : vaultBloccato
        ? `${failCount}/${credentialCount} credenziali non leggibili: vault bloccato (Impostazioni › Vault).`
        : archivioCon
          ? `${failCount}/${credentialCount} credenziali non leggibili: valori ricifrati dal vault e DA_VAULT_LOCALE spento (c'è un archivio del vault). ` +
            "Riaccendi DA_VAULT_LOCALE=1 nel file dell'appliance e riavvia, oppure riporta i valori alla chiave d'installazione " +
            "(scripts/da-vault.ts ricifra --inversa --applica, a servizio fermo, con DA_VAULT_LOCALE=1; ADR 0034). Se non sono mai stati ricifrati, la causa è ENCRYPTION_KEY."
          : `${failCount}/${credentialCount} credenziali NON decifrabili con ENCRYPTION_KEY attuale. ` +
          "Allinea la chiave Docker/systemd con quella usata al salvataggio o re-inserisci le credenziali.",
  };
}

export function logEncryptionKeyHealthAtBoot(): void {
  // da-vault: col vault locale acceso il controllo all'avvio girerebbe prima dello sblocco (TPM o passphrase) e
  // scambierebbe i valori della chiave degli slot per una chiave sbagliata. Lo stato vero lo dicono /api/health e
  // Impostazioni › Vault, dopo lo sblocco.
  if (vaultLocaleAcceso()) {
    console.info("[encryption-key] vault locale acceso: le credenziali si controllano dopo lo sblocco (/api/health, Impostazioni › Vault)");
    return;
  }
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

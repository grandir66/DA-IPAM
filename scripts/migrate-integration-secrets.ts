/**
 * Migrazione one-shot: cifra i segreti integrazioni legacy plaintext in hub settings.
 *
 * Contesto (WAVE 5 / token-at-rest): da v0.3.152 `config.ts` cifra i segreti integrazioni
 * on-write e li legge in modo tollerante (decifra il ciphertext, passa il legacy plaintext).
 * I valori scritti PRIMA di quella versione restano plaintext finché non vengono ri-salvati.
 * Questo script li cifra proattivamente. È idempotente (guardato dal marker
 * `integration_secrets_encrypted_v1`) e sicuro: tocca solo valori non-vuoti e non-cifrati.
 *
 * Uso (sul nodo, con ENCRYPTION_KEY nell'ambiente/.env.local):
 *   npx tsx scripts/migrate-integration-secrets.ts
 */
import { getSetting, setSetting } from "@/lib/db-hub";
import { encrypt } from "@/lib/crypto";
import { isCiphertext } from "@/lib/integrations/config";

const MARKER = "integration_secrets_encrypted_v1";

function main() {
  if (getSetting(MARKER) === "1") {
    console.log("[migrate] già eseguita (marker presente) — nessuna azione.");
    return;
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error("[migrate] ENCRYPTION_KEY non impostata: impossibile cifrare. Abort.");
    process.exit(1);
  }

  const components = ["librenms", "loki", "graylog"];
  const keys: string[] = [];
  for (const c of components) {
    keys.push(`integration_${c}_api_token`, `integration_${c}_admin_password`);
  }
  keys.push("integration_graylog_password");

  let migrated = 0;
  for (const k of keys) {
    const raw = getSetting(k) ?? "";
    if (raw && !isCiphertext(raw)) {
      setSetting(k, encrypt(raw));
      migrated++;
      console.log(`[migrate] cifrato: ${k}`);
    }
  }
  setSetting(MARKER, "1");
  console.log(`[migrate] completata: ${migrated} segreti cifrati, marker impostato.`);
}

main();

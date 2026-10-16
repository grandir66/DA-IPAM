/**
 * Smoke test runtime per tutte le credenziali SSH (`ssh`/`linux`) e i loro binding
 * sui device. Pensato come "ground truth" anti-regressione dopo modifiche al
 * transport SSH o ai vendor handler.
 *
 * Esegue, per ogni tenant DB sotto `data/tenants/*.db`:
 *   1. Per ogni credenziale di tipo `ssh`/`linux`: nessun test puro (serve un host).
 *   2. Per ogni `device_credential_bindings` con `protocol_type='ssh'`: prova la
 *      connessione + comando innocuo (`true`) verso il device. Il segreto si legge
 *      dall'archivio (`leggiSegretoDb`, password o chiave SSH), come il motore:
 *      dalla 2e (tappa 2 credenziali, T20) un binding inline rimasto è un apparato
 *      che la conversione ha lasciato, e si segnala senza provarlo.
 *   3. Per ogni `host_credentials` con `protocol_type='ssh'`: stessa cosa verso host.
 *   4. Aggiorna `test_status`/`test_message`/`tested_at` nel binding con il
 *      messaggio parlante di `mapSshError`.
 *   5. Stampa tabella a colori (`✓`/`✗`/`⚠`) e codice di uscita != 0 se almeno un
 *      binding configurato fallisce con `auth_failed` o `auth_method_unsupported`
 *      (gli altri kind — timeout, refused — NON falliscono lo script perché
 *      possono dipendere da reachability di rete momentanea).
 *
 * Uso:
 *   npx tsx scripts/smoke-ssh-credentials.ts [--tenant=70791] [--ci]
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import dotenv from "dotenv";

// Carica .env.local prima di importare moduli che leggono ENV (crypto).
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

// Import statico DOPO dotenv: il transport non legge env di per sé, ma db.ts sì.
// Usiamo `require` dinamico per evitare top-level await.
async function main() {
  const args = process.argv.slice(2);
  const tenantFilter = args.find((a) => a.startsWith("--tenant="))?.split("=")[1];
  const ciMode = args.includes("--ci");

  const { sshTryConnect } = await import("../src/lib/devices/ssh-transport");
  const { leggiSegretoDb, opzioniSsh } = await import("../src/lib/credentials/segreti");

  /** Accesso SSH dalla voce d'archivio (password o chiave), o il motivo per cui non c'è. */
  const accessoDaVoce = (db: Database.Database, credentialId: number) => {
    const e = leggiSegretoDb(db, credentialId, "ssh");
    if (!e.ok) return { accesso: null, motivo: e.motivo };
    const accesso = opzioniSsh(e.segreto);
    return accesso ? { accesso, motivo: null } : { accesso: null, motivo: "la voce non è utente e password né chiave SSH" };
  };

  const tenantsDir = path.join(process.cwd(), "data", "tenants");
  if (!fs.existsSync(tenantsDir)) {
    console.error(`[smoke] Directory ${tenantsDir} non trovata`);
    process.exit(1);
  }

  const dbFiles = fs
    .readdirSync(tenantsDir)
    .filter((f) => f.endsWith(".db") && !f.endsWith("-wal") && !f.endsWith("-shm"))
    .filter((f) => !tenantFilter || f.startsWith(`${tenantFilter}.`));

  if (dbFiles.length === 0) {
    console.error(`[smoke] Nessun DB tenant trovato${tenantFilter ? ` con filtro ${tenantFilter}` : ""}`);
    process.exit(1);
  }

  let totalFailures = 0;
  const blockingKinds = new Set(["auth_failed", "auth_method_unsupported"]);

  for (const dbFile of dbFiles) {
    const dbPath = path.join(tenantsDir, dbFile);
    const tenantCode = dbFile.replace(/\.db$/, "");
    console.log(`\n=== Tenant ${tenantCode} (${dbPath}) ===`);

    const db = new Database(dbPath);

    // 1. Device bindings SSH
    const deviceBindings = db
      .prepare(
        `SELECT b.id AS binding_id, b.device_id, b.credential_id, b.port,
                d.name AS device_name, d.host AS device_host, d.vendor,
                c.name AS cred_name, c.credential_type
           FROM device_credential_bindings b
           JOIN network_devices d ON d.id = b.device_id
           LEFT JOIN credentials c ON c.id = b.credential_id
          WHERE b.protocol_type = 'ssh'`
      )
      .all() as Array<{
        binding_id: number;
        device_id: number;
        credential_id: number | null;
        port: number;
        device_name: string;
        device_host: string;
        vendor: string;
        cred_name: string | null;
        credential_type: string | null;
      }>;

    if (deviceBindings.length === 0) {
      console.log("  (nessun device_credential_bindings SSH)");
    } else {
      console.log(`\n  Device bindings SSH: ${deviceBindings.length}`);
      console.log("  " + "".padEnd(140, "-"));
      console.log(
        "  " +
          "id".padEnd(5) +
          "device".padEnd(28) +
          "host:port".padEnd(24) +
          "cred".padEnd(22) +
          "user".padEnd(14) +
          "esito".padEnd(46)
      );
      console.log("  " + "".padEnd(140, "-"));

      for (const b of deviceBindings) {
        const credLabel = b.cred_name ?? "inline";
        const letto = b.credential_id ? accessoDaVoce(db, b.credential_id) : { accesso: null, motivo: "binding inline: apparato lasciato dalla conversione 2e" };
        if (!letto.accesso) {
          console.log(
            "  " +
              String(b.binding_id).padEnd(5) +
              b.device_name.slice(0, 26).padEnd(28) +
              `${b.device_host}:${b.port}`.padEnd(24) +
              credLabel.slice(0, 20).padEnd(22) +
              "—".padEnd(14) +
              `⚠ ${letto.motivo}`
          );
          continue;
        }
        const username = letto.accesso.username;
        const result = await sshTryConnect({
          host: b.device_host,
          port: b.port,
          ...letto.accesso,
          timeout: 12000,
          credentialName: credLabel,
        });
        const esito = result.ok
          ? "✓ OK"
          : `✗ [${result.error.kind}] ${result.error.message.slice(0, 36)}`;
        console.log(
          "  " +
            String(b.binding_id).padEnd(5) +
            b.device_name.slice(0, 26).padEnd(28) +
            `${b.device_host}:${b.port}`.padEnd(24) +
            credLabel.slice(0, 20).padEnd(22) +
            username.slice(0, 12).padEnd(14) +
            esito.slice(0, 44).padEnd(46)
        );
        // Persist test_status / test_message
        const status = result.ok ? "success" : "failed";
        const message = result.ok
          ? "SSH OK (smoke)"
          : `[${result.error.kind}] ${result.error.message}${result.error.hint ? ` — ${result.error.hint}` : ""}`;
        db.prepare(
          `UPDATE device_credential_bindings
              SET test_status = ?, test_message = ?, tested_at = datetime('now')
            WHERE id = ?`
        ).run(status, message.slice(0, 500), b.binding_id);
        if (!result.ok && blockingKinds.has(result.error.kind)) totalFailures++;
      }
    }

    // 2. Host bindings SSH
    const hostBindings = db
      .prepare(
        `SELECT h.id AS host_id, h.ip, hc.id AS hc_id, hc.credential_id, hc.port,
                c.name AS cred_name
           FROM host_credentials hc
           JOIN hosts h ON h.id = hc.host_id
           JOIN credentials c ON c.id = hc.credential_id
          WHERE hc.protocol_type = 'ssh'`
      )
      .all() as Array<{
        host_id: number;
        ip: string;
        hc_id: number;
        credential_id: number;
        port: number;
        cred_name: string;
      }>;
    if (hostBindings.length > 0) {
      console.log(`\n  Host bindings SSH: ${hostBindings.length}`);
      for (const h of hostBindings) {
        const { accesso } = accessoDaVoce(db, h.credential_id);
        if (!accesso) continue;
        const result = await sshTryConnect({
          host: h.ip,
          port: h.port,
          ...accesso,
          timeout: 12000,
          credentialName: h.cred_name,
        });
        const esito = result.ok ? "✓ OK" : `✗ [${result.error.kind}] ${result.error.message.slice(0, 50)}`;
        console.log(`  host#${h.host_id} ${h.ip}:${h.port} cred="${h.cred_name}" → ${esito}`);
        if (!result.ok && blockingKinds.has(result.error.kind)) totalFailures++;
      }
    }

    db.close();
  }

  console.log(`\n=== Smoke completata. Auth fail bloccanti: ${totalFailures}. ===`);
  if (ciMode && totalFailures > 0) {
    console.error("[smoke] Exit code 1: ci sono credenziali con auth_failed / auth_method_unsupported.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[smoke] Errore fatale:", e);
  process.exit(2);
});

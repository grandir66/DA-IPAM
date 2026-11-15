#!/usr/bin/env node
/**
 * Reset password di un utente DA-IPAM nel database hub (recovery lock-out UI).
 *
 * Plain CommonJS di proposito: gira con `node` nudo dentro il container
 * dell'appliance (production), SENZA tsx/ts-node. Usa solo dipendenze
 * runtime gia' presenti in node_modules: better-sqlite3 + bcrypt
 * (gli stessi usati da src/lib/auth.ts, bcrypt rounds 12).
 *
 * Uso:
 *   node scripts/reset-admin-password.cjs                       → lista utenti
 *   printf '%s\n' '<password>' | node scripts/reset-admin-password.cjs <username> → reset (password sullo stdin)
 *   node scripts/reset-admin-password.cjs <username> <password> → reset (sconsigliato: resta nella storia della shell)
 *
 * Risoluzione hub.db (primo che esiste):
 *   1. $DA_IPAM_HUB_DB_PATH      (override esplicito, path assoluto al file)
 *   2. $DA_INVENT_DATA_DIR/hub.db (volume appliance — vedi resolveDataDir)
 *   3. ./data/hub.db             (dev locale, dalla root del progetto)
 *
 * Su appliance (DA-IPAM in Docker), tipicamente:
 *   docker exec -it <container-ipam> node scripts/reset-admin-password.cjs admin NuovaPwd8
 */

const path = require("path");
const fs = require("fs");

function resolveHubPath() {
  const explicit = process.env.DA_IPAM_HUB_DB_PATH && process.env.DA_IPAM_HUB_DB_PATH.trim();
  if (explicit) return path.resolve(explicit);
  const dataDir = process.env.DA_INVENT_DATA_DIR && process.env.DA_INVENT_DATA_DIR.trim();
  if (dataDir) {
    const p = path.join(path.resolve(dataDir), "hub.db");
    if (fs.existsSync(p)) return p;
  }
  return path.join(process.cwd(), "data", "hub.db");
}

function main() {
  const [username, daArgomento] = process.argv.slice(2);
  // La password si passa sullo stdin (piano di sicurezza 14/11): come argomento resta nella storia della shell
  // e si vede in `ps`. L'argomento funziona ancora, con un avviso, per non rompere chi lo usa.
  let password = daArgomento;
  if (username && !password && !process.stdin.isTTY) {
    password = fs.readFileSync(0, "utf8").split(/\r?\n/)[0];
  } else if (password) {
    console.error("ATTENZIONE: password passata come argomento, resta nella storia della shell. Meglio:");
    console.error("  printf '%s\\n' '<password>' | node scripts/reset-admin-password.cjs <username>");
  }

  const hubPath = resolveHubPath();
  if (!fs.existsSync(hubPath)) {
    console.error(`File hub non trovato: ${hubPath}`);
    console.error("Imposta DA_IPAM_HUB_DB_PATH o DA_INVENT_DATA_DIR, o lancia dalla root del progetto.");
    process.exit(1);
  }

  let Database, bcrypt;
  try {
    Database = require("better-sqlite3");
    bcrypt = require("bcrypt");
  } catch (e) {
    console.error("Dipendenze mancanti (better-sqlite3 / bcrypt). Lancia dentro l'installazione DA-IPAM.");
    console.error(String(e));
    process.exit(1);
  }

  const db = new Database(hubPath);
  const users = db
    .prepare("SELECT id, username, role, tenant_id FROM users ORDER BY id")
    .all();

  // Nessun argomento → mostra gli utenti e basta (read-only).
  if (!username || !password) {
    console.log(`Hub DB: ${hubPath}`);
    console.log(`Utenti (${users.length}):`);
    for (const u of users) {
      console.log(`  - id=${u.id} username="${u.username}" role=${u.role} tenant_id=${u.tenant_id ?? "null"}`);
    }
    console.log("\nReset:  printf '%s\\n' '<password>' | node scripts/reset-admin-password.cjs <username>");
    process.exit(0);
  }

  if (password.length < 8) {
    console.error("Password troppo corta: minimo 8 caratteri (puo' essere semplice, es. 'domarc123').");
    process.exit(1);
  }

  const target = users.find((u) => u.username === username);
  if (!target) {
    console.error(`Utente "${username}" non trovato. Utenti disponibili:`);
    for (const u of users) console.error(`  - ${u.username} (role=${u.role})`);
    process.exit(1);
  }

  const hash = bcrypt.hashSync(password, 12);
  // Prima la traccia, poi la scrittura: un recupero non passa senza riga nel registro degli accessi.
  const dataDir = (process.env.DA_INVENT_DATA_DIR && process.env.DA_INVENT_DATA_DIR.trim()) || path.dirname(hubPath);
  const audit = path.join(path.resolve(dataDir), "audit");
  fs.mkdirSync(audit, { recursive: true });
  const adesso = new Date();
  let chi = "sconosciuto";
  try { chi = require("os").userInfo().username; } catch (e) { /* resta sconosciuto */ }
  fs.appendFileSync(
    path.join(audit, `accessi-${adesso.toISOString().slice(0, 10)}.jsonl`),
    JSON.stringify({ il: adesso.toISOString(), azione: "password_reimposta", utente: target.username, utenteId: target.id, da: `riga di comando (${chi})` }) + "\n",
  );
  // Con la password si chiudono le sessioni aperte di quell'utente (come dalla pagina, P0-2 tappa A).
  const haSessioni = db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === "sessioni_valide_da");
  if (haSessioni) {
    db.prepare("UPDATE users SET password_hash = ?, sessioni_valide_da = ? WHERE id = ?").run(hash, Date.now(), target.id);
  } else {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, target.id);
  }

  console.log(`OK — password di "${username}" (id=${target.id}, role=${target.role}) aggiornata.`);
  console.log("Ora puoi accedere alla UI con le nuove credenziali.");
}

main();

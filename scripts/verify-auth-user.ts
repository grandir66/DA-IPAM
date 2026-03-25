#!/usr/bin/env tsx
/**
 * Verifica utenti e hash password nel database hub (stessa logica di login in auth.ts).
 *
 * IMPORTANTE — Configurazione guidata (/onboarding):
 *   Il wizard NON crea l'utente né imposta la password. Configura solo router, DNS, credenziali, ecc.
 *   Il primo account (superadmin) viene creato SOLO dalla pagina /setup → POST /api/setup
 *   (username ≥3 caratteri, password ≥8, bcrypt rounds 12).
 *
 * Uso (dalla directory dell'installazione, es. /opt/da-invent):
 *   npx tsx scripts/verify-auth-user.ts
 *   npx tsx scripts/verify-auth-user.ts --test <username> "<password>"
 *
 * Variabile: DA_IPAM_HUB_DB_PATH — percorso assoluto a hub.db (default: ./data/hub.db)
 */

import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import bcrypt from "bcrypt";

const args = process.argv.slice(2);
const testIdx = args.indexOf("--test");
const testUser = testIdx >= 0 ? args[testIdx + 1] : undefined;
const testPass = testIdx >= 0 ? args[testIdx + 2] : undefined;

const cwd = process.cwd();
const hubPath = process.env.DA_IPAM_HUB_DB_PATH?.trim()
  ? path.resolve(process.env.DA_IPAM_HUB_DB_PATH.trim())
  : path.join(cwd, "data", "hub.db");

if (!fs.existsSync(hubPath)) {
  console.error(`File hub non trovato: ${hubPath}`);
  console.error("Esegui lo script dalla root del progetto (dove esiste data/hub.db) oppure imposta DA_IPAM_HUB_DB_PATH.");
  process.exit(1);
}

const db = new Database(hubPath, { readonly: true });

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  email: string | null;
  role: string;
  tenant_id: number | null;
  created_at: string | null;
  last_login: string | null;
}

const users = db.prepare("SELECT id, username, password_hash, email, role, tenant_id, created_at, last_login FROM users ORDER BY id").all() as UserRow[];

console.log(`Hub DB: ${hubPath}`);
console.log(`Utenti nel database: ${users.length}\n`);

for (const u of users) {
  const hashOk = u.password_hash.startsWith("$2");
  const hashPreview = u.password_hash.length > 22 ? `${u.password_hash.slice(0, 22)}…` : u.password_hash;
  console.log(`— id=${u.id} username="${u.username}" role=${u.role}`);
  console.log(`  email=${u.email ?? "null"}  tenant_id=${u.tenant_id ?? "null"}`);
  console.log(`  last_login=${u.last_login ?? "mai"}`);
  console.log(`  password_hash: ${hashOk ? "formato bcrypt OK" : "ATTENZIONE: non sembra bcrypt"} (${hashPreview})`);

  const access = db
    .prepare(
      `SELECT t.codice_cliente, t.ragione_sociale, uta.role AS access_role
       FROM user_tenant_access uta
       JOIN tenants t ON t.id = uta.tenant_id
       WHERE uta.user_id = ?
       ORDER BY t.codice_cliente`
    )
    .all(u.id) as Array<{ codice_cliente: string; ragione_sociale: string; access_role: string }>;

  if (access.length === 0) {
    console.log(`  accesso tenant: (nessuna riga in user_tenant_access) — per ruolo "admin" il login funziona comunque; la sessione usa tenantCode null e le API usano DEFAULT se applicabile.`);
  } else {
    for (const a of access) {
      console.log(`  tenant: ${a.codice_cliente} — ${a.ragione_sociale} (${a.access_role})`);
    }
  }
  console.log("");
}

if (testUser !== undefined) {
  if (testPass === undefined) {
    console.error('Uso: npx tsx scripts/verify-auth-user.ts --test <username> "<password>"');
    db.close();
    process.exit(1);
  }
  const u = db.prepare("SELECT * FROM users WHERE username = ?").get(testUser) as UserRow | undefined;
  if (!u) {
    console.error(`Nessun utente con username "${testUser}".`);
    db.close();
    process.exit(2);
  }
  void bcrypt
    .compare(testPass, u.password_hash)
    .then((match) => {
      console.log(
        `bcrypt.compare("${testUser}", password fornita): ${match ? "OK — coincide con il DB" : "FALLITA — password diversa da quella salvata"}`
      );
      db.close();
      process.exit(match ? 0 : 3);
    })
    .catch((e: unknown) => {
      console.error("Errore bcrypt:", e);
      db.close();
      process.exit(4);
    });
} else {
  console.log("Suggerimento: per verificare una password senza modificarla:");
  console.log('  npm run verify-auth-user -- --test admin "LaTuaPassword"');
  db.close();
}

/**
 * da-vault, passo 10 (ADR 0034): col vault acceso i segreti della verifica in due passaggi (ADR 0023) restano sulla
 * chiave d'installazione. Altrimenti, col vault bloccato (niente TPM, passphrase non ancora inserita), un admin con la
 * 2FA non potrebbe entrare a sbloccarlo.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/accesso-vault.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "accesso-vault-"));
process.env.DA_INVENT_DATA_DIR = DIR;
process.env.DA_IPAM_HUB_DB_PATH = path.join(DIR, "hub.db");
process.env.ENCRYPTION_KEY = crypto.randomBytes(16).toString("hex");

type Mod = typeof import("@/lib/accesso/accesso-locale");
type Hub = typeof import("@/lib/db-hub");
type Totp = typeof import("@/lib/accesso/totp");
type Stato = typeof import("../stato");
let A: Mod;
let H: Hub;
let T: Totp;
let S: Stato;
let bcrypt: typeof import("bcrypt");

before(async () => {
  A = await import("@/lib/accesso/accesso-locale");
  H = await import("@/lib/db-hub");
  T = await import("@/lib/accesso/totp");
  S = await import("../stato");
  bcrypt = await import("bcrypt");
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  S.chiudiVault(null);
});

test("2FA attivata col vault aperto: dopo il blocco del vault l'admin entra lo stesso col codice", async () => {
  process.env.DA_VAULT_LOCALE = "1";
  S.impostaChiaveDati(crypto.randomBytes(32), "tpm");
  const u = H.createUser("admin-vault", await bcrypt.hash("giusta", 4), "admin", null);
  H.impostaSecondaVerifica(u.id, "richiedi");

  const ora = Date.parse("2026-10-23T09:00:00Z");
  const p1 = await A.verificaAccessoLocale({ username: "admin-vault", password: "giusta" }, { fase: "passo_uno", ora });
  assert.equal(p1.esito, "serve_attivazione");
  if (p1.esito !== "serve_attivazione") return;
  const att = await A.verificaAccessoLocale(
    { username: "admin-vault", password: "giusta", codice: T.codiceTotp(p1.segreto, Math.floor(ora / 30_000)) },
    { fase: "accesso", ora },
  );
  assert.equal(att.esito, "entra");

  // Riavvio senza TPM: vault bloccato.
  S.chiudiVault("niente slot TPM");
  const dopo = ora + 120_000;
  const p2 = await A.verificaAccessoLocale({ username: "admin-vault", password: "giusta" }, { fase: "passo_uno", ora: dopo });
  assert.equal(p2.esito, "serve_codice");
  const fine = await A.verificaAccessoLocale(
    { username: "admin-vault", password: "giusta", codice: T.codiceTotp(p1.segreto, Math.floor(dopo / 30_000)) },
    { fase: "accesso", ora: dopo },
  );
  assert.equal(fine.esito, "entra");
});

test("col vault bloccato si propone anche il QR di una 2FA appena richiesta", async () => {
  process.env.DA_VAULT_LOCALE = "1";
  S.chiudiVault("niente slot TPM");
  const u = H.createUser("admin-nuovo", await bcrypt.hash("giusta", 4), "admin", null);
  H.impostaSecondaVerifica(u.id, "richiedi");
  const p1 = await A.verificaAccessoLocale({ username: "admin-nuovo", password: "giusta" }, { fase: "passo_uno", ora: Date.now() });
  assert.equal(p1.esito, "serve_attivazione");
});

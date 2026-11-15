/**
 * Accesso d'emergenza del cliente (piano di sicurezza 14/11, P0-2 tappa D, oggetto 3). Se l'unico amministratore
 * perde tutto, oggi serve una shell sul server, che ha Domarc e non il cliente. Una frase in busta chiusa apre un
 * ingresso da amministratore: una volta sola, per 60 minuti, senza codice, e lascia traccia.
 *
 * Run: node --import tsx --test src/lib/accesso/__tests__/emergenza.test.ts
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { JWT } from "next-auth/jwt";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "emergenza-"));
process.env.DA_INVENT_DATA_DIR = DIR;
process.env.DA_IPAM_HUB_DB_PATH = path.join(DIR, "hub.db");
process.env.ENCRYPTION_KEY = crypto.randomBytes(16).toString("hex");
delete process.env.DOMARC_PASSWORD;

let H: typeof import("../../db-hub");
let A: typeof import("../accesso-locale");
let E: typeof import("../emergenza");
let S: typeof import("../sessione");
let D: typeof import("../due-passaggi-admin");
let tenantId: number;

before(async () => {
  H = await import("../../db-hub");
  A = await import("../accesso-locale");
  E = await import("../emergenza");
  S = await import("../sessione");
  D = await import("../due-passaggi-admin");
  tenantId = H.createTenant({
    codice_cliente: "EME01", ragione_sociale: "Prova", indirizzo: null, citta: null, provincia: null, cap: null,
    telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1,
  }).id;
});

const entra = (password: string, ora?: number) =>
  A.verificaAccessoLocale({ username: E.NOME_EMERGENZA, password }, { fase: "accesso", ora });

test("la frase apre l'accesso una volta sola, da amministratore, anche con i due passaggi obbligatori", async () => {
  const frase = await E.creaAccessoEmergenza([tenantId], "anna");
  assert.ok(frase.replace(/-/g, "").length >= 24, "frase lunga");
  const u = H.getUserByUsername(E.NOME_EMERGENZA)!;
  assert.equal(u.role, "admin");
  assert.equal(E.statoAccessoEmergenza().stato, "pronto");

  D.impostaDuePassaggiAdmin(true);
  try {
    assert.equal((await entra("frase-sbagliata-qualunque")).esito, "rifiuta");
    assert.equal((await entra(frase)).esito, "entra", "senza codice dell'app");
  } finally {
    D.impostaDuePassaggiAdmin(false);
  }
  assert.equal((await entra(frase)).esito, "rifiuta", "la frase è consumata");
  assert.equal(E.statoAccessoEmergenza().stato, "usato");
});

test("la sessione d'emergenza dura 60 minuti e cade se l'accesso viene tolto", async () => {
  const frase = await E.creaAccessoEmergenza([tenantId], "anna");
  const t0 = Date.UTC(2026, 10, 14, 10, 0, 0);
  assert.equal((await entra(frase, t0)).esito, "entra");
  const u = H.getUserByUsername(E.NOME_EMERGENZA)!;
  assert.ok(S.statoSessione(u.id, t0 + 1, "EME01", t0 + 59 * 60_000), "a 59 minuti vale");
  assert.equal(S.statoSessione(u.id, t0 + 1, "EME01", t0 + 61 * 60_000), null, "a 61 minuti no");
  E.togliAccessoEmergenza();
  assert.equal(S.statoSessione(u.id, t0 + 1, "EME01", t0 + 5 * 60_000), null, "tolto: fuori subito");
  assert.equal(E.statoAccessoEmergenza().stato, "assente");
});

test("rigenerare annulla la frase di prima; un utente vero con quel nome non viene toccato", async () => {
  const prima = await E.creaAccessoEmergenza([tenantId], "anna");
  const dopo = await E.creaAccessoEmergenza([tenantId], "anna");
  assert.equal((await entra(prima)).esito, "rifiuta");
  assert.equal((await entra(dopo)).esito, "entra");
  E.togliAccessoEmergenza();
  H.createUser(E.NOME_EMERGENZA, "hash-di-una-persona", "viewer", null);
  await assert.rejects(() => E.creaAccessoEmergenza([tenantId], "anna"), /esiste già/);
  assert.equal(H.getUserByUsername(E.NOME_EMERGENZA)!.role, "viewer");
});

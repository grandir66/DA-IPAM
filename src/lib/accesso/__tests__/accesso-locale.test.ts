/**
 * Accesso locale con la verifica in due passaggi (Riccardo, 20/10; ADR 0023). Una funzione sola
 * decide per il passo 1 della pagina e per `authorize` di NextAuth: password, poi, solo per chi
 * l'admin l'ha richiesta, il codice o l'attivazione col QR. DA-Auth non passa di qui.
 *
 * Run: node --import tsx --test src/lib/accesso/__tests__/accesso-locale.test.ts
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "accesso-locale-"));
const HUB = path.join(DIR, "hub.db");

// Un hub «vecchio», senza le colonne della 2FA: la migrazione deve aggiungerle.
{
  const db = new Database(HUB);
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, email TEXT, role TEXT NOT NULL DEFAULT 'admin', tenant_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')), last_login TEXT)`);
  db.close();
}
process.env.DA_INVENT_DATA_DIR = DIR;
process.env.DA_IPAM_HUB_DB_PATH = HUB;
process.env.ENCRYPTION_KEY = crypto.randomBytes(16).toString("hex");
process.env.DOMARC_USERNAME = "domarc";
process.env.DOMARC_PASSWORD = "servizio-segreto";

type Mod = typeof import("../accesso-locale");
type Hub = typeof import("../../db-hub");
type Totp = typeof import("../totp");
let A: Mod;
let H: Hub;
let T: Totp;
let bcrypt: typeof import("bcrypt");

before(async () => {
  A = await import("../accesso-locale");
  H = await import("../../db-hub");
  T = await import("../totp");
  bcrypt = await import("bcrypt");
});

let n = 0;
async function utente(con2fa: boolean): Promise<{ id: number; username: string }> {
  const username = `utente${++n}`;
  const u = H.createUser(username, await bcrypt.hash("giusta", 4), "admin", null);
  if (con2fa) H.impostaSecondaVerifica(u.id, "richiedi");
  return { id: u.id, username };
}

/** Attiva la 2FA come farebbe la persona: passo 1 → QR → codice giusto. Ritorna il segreto. */
async function attiva(username: string, ora: number): Promise<string> {
  const p1 = await A.verificaAccessoLocale({ username, password: "giusta" }, { fase: "passo_uno", ora });
  assert.equal(p1.esito, "serve_attivazione");
  if (p1.esito !== "serve_attivazione") throw new Error();
  const codice = T.codiceTotp(p1.segreto, Math.floor(ora / 30_000));
  const fine = await A.verificaAccessoLocale({ username, password: "giusta", codice }, { fase: "accesso", ora });
  assert.equal(fine.esito, "entra");
  return p1.segreto;
}

test("la migrazione aggiunge le colonne della 2FA a un hub vecchio", () => {
  const cols = (H.getHubDb().prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  for (const c of ["totp_richiesta", "totp_segreto", "totp_attivato_at", "totp_ultimo_passo", "totp_proposto", "totp_proposto_scade"]) {
    assert.ok(cols.includes(c), c);
  }
});

test("senza 2FA richiesta si entra come oggi; password sbagliata o nome inesistente = rifiuto", async () => {
  const u = await utente(false);
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno" })).esito, "entra");
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "accesso" })).esito, "entra");
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "no" }, { fase: "accesso" })).esito, "rifiuta");
  assert.equal((await A.verificaAccessoLocale({ username: "nessuno", password: "x" }, { fase: "passo_uno" })).esito, "rifiuta");
});

test("2FA richiesta e non attivata: il passo 1 dà il QR, lo stesso per 10 minuti, poi uno nuovo", async () => {
  const u = await utente(true);
  const ora = Date.parse("2026-10-20T10:00:00Z");
  const a = await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno", ora });
  const b = await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno", ora: ora + 5 * 60_000 });
  const c = await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno", ora: ora + 11 * 60_000 });
  assert.equal(a.esito, "serve_attivazione");
  if (a.esito !== "serve_attivazione" || b.esito !== "serve_attivazione" || c.esito !== "serve_attivazione") throw new Error();
  assert.match(a.qr, /^data:image\/png;base64,/);
  assert.equal(b.segreto, a.segreto, "entro 10 minuti lo stesso QR");
  assert.notEqual(c.segreto, a.segreto, "dopo 10 minuti un QR nuovo");
  // Il QR scaduto non attiva.
  const vecchio = T.codiceTotp(a.segreto, Math.floor((ora + 11 * 60_000) / 30_000));
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta", codice: vecchio }, { fase: "accesso", ora: ora + 11 * 60_000 })).esito, "rifiuta");
});

test("password sbagliata: niente QR, niente segreto proposto nel database", async () => {
  const u = await utente(true);
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "no" }, { fase: "passo_uno" })).esito, "rifiuta");
  const riga = H.getHubDb().prepare("SELECT totp_proposto FROM users WHERE id = ?").get(u.id) as { totp_proposto: string | null };
  assert.equal(riga.totp_proposto, null);
});

test("2FA attiva: il passo 1 chiede il codice; senza, sbagliato o ripetuto = rifiuto; giusto = entra", async () => {
  const u = await utente(true);
  const ora = Date.parse("2026-10-20T11:00:00Z");
  const segreto = await attiva(u.username, ora);
  const dopo = ora + 60_000;
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno", ora: dopo })).esito, "serve_codice");
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "accesso", ora: dopo })).esito, "rifiuta");
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta", codice: "000000" }, { fase: "accesso", ora: dopo })).esito, "rifiuta");
  const giusto = T.codiceTotp(segreto, Math.floor(dopo / 30_000));
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta", codice: giusto }, { fase: "accesso", ora: dopo })).esito, "entra");
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta", codice: giusto }, { fase: "accesso", ora: dopo })).esito, "rifiuta", "un codice usato non vale due volte");
  // Codice giusto con password sbagliata: rifiuto.
  const altro = T.codiceTotp(segreto, Math.floor(dopo / 30_000) + 1);
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "no", codice: altro }, { fase: "accesso", ora: dopo + 30_000 })).esito, "rifiuta");
});

test("segreto che non si apre (chiave cambiata o riga rovinata) = rifiuto, mai ingresso", async () => {
  const u = await utente(true);
  const ora = Date.parse("2026-10-20T12:00:00Z");
  const segreto = await attiva(u.username, ora);
  H.getHubDb().prepare("UPDATE users SET totp_segreto = 'rovinato' WHERE id = ?").run(u.id);
  const codice = T.codiceTotp(segreto, Math.floor((ora + 60_000) / 30_000));
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta", codice }, { fase: "accesso", ora: ora + 60_000 })).esito, "rifiuta");
});

test("azzera: al prossimo accesso torna il QR; togli: si entra con la sola password", async () => {
  const u = await utente(true);
  const ora = Date.parse("2026-10-20T13:00:00Z");
  await attiva(u.username, ora);
  H.impostaSecondaVerifica(u.id, "azzera");
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno", ora })).esito, "serve_attivazione");
  H.impostaSecondaVerifica(u.id, "togli");
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "accesso", ora })).esito, "entra");
});

test("codici sbagliati contano per il blocco: al sesto si è bloccati", async () => {
  const u = await utente(true);
  const ora = Date.now();
  await attiva(u.username, ora);
  for (let i = 0; i < 6; i++) await A.verificaAccessoLocale({ username: u.username, password: "giusta", codice: "000000" }, { fase: "accesso", ora });
  assert.equal((await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno", ora })).esito, "bloccato");
});

test("utenza di servizio Domarc: entra con la sua password, senza codice; sbagliata = rifiuto", async () => {
  assert.equal((await A.verificaAccessoLocale({ username: "domarc", password: "servizio-segreto" }, { fase: "passo_uno" })).esito, "servizio");
  assert.equal((await A.verificaAccessoLocale({ username: "domarc", password: "servizio-segreto" }, { fase: "accesso" })).esito, "servizio");
  assert.equal((await A.verificaAccessoLocale({ username: "domarc", password: "servizio-segretX" }, { fase: "accesso" })).esito, "rifiuta");
});

test("revisione 20/10: codici in parallelo non scavalcano il blocco (al più 6 tentativi passano)", async () => {
  const u = await utente(true);
  const ora = Date.now();
  await attiva(u.username, ora);
  const esiti = await Promise.all(
    Array.from({ length: 40 }, () => A.verificaAccessoLocale({ username: u.username, password: "giusta", codice: "000000" }, { fase: "accesso", ora })),
  );
  const provati = esiti.filter((e) => e.esito === "rifiuta").length;
  assert.ok(provati <= 6, `codici provati in parallelo: ${provati}`);
  assert.ok(esiti.some((e) => e.esito === "bloccato"));
});

test("revisione 20/10: un nome inesistente costa quanto una password sbagliata (bcrypt al costo vero, 12)", async () => {
  // Gli utenti veri hanno hash a costo 12 (setup, creazione, reimposta, cambia password).
  const vero = H.createUser(`costo12-${++n}`, await bcrypt.hash("giusta", 12), "admin", null);
  await A.verificaAccessoLocale({ username: "riscaldamento", password: "x" }, { fase: "passo_uno" }); // calcola l'hash finto
  const misura = async (username: string) => {
    const t0 = performance.now();
    await A.verificaAccessoLocale({ username, password: "sbagliata" }, { fase: "passo_uno" });
    return performance.now() - t0;
  };
  const tVero = await misura(vero.username);
  const tFinto = await misura("non-esiste-davvero");
  assert.ok(tFinto >= tVero * 0.6, `nome inesistente ${tFinto.toFixed(0)} ms contro esistente ${tVero.toFixed(0)} ms`);
});

test("revisione 20/10: due passi 1 insieme a QR scaduto danno lo stesso QR", async () => {
  const u = await utente(true);
  const ora = Date.parse("2026-10-20T14:00:00Z");
  const [a, b] = await Promise.all([
    A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno", ora }),
    A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno", ora }),
  ]);
  if (a.esito !== "serve_attivazione" || b.esito !== "serve_attivazione") throw new Error("atteso il QR");
  assert.equal(a.segreto, b.segreto);
});

test("il passo 1 riuscito non consuma tentativi: 10 rientri di fila non bloccano", async () => {
  const u = await utente(true);
  for (let i = 0; i < 10; i++) {
    const e = await A.verificaAccessoLocale({ username: u.username, password: "giusta" }, { fase: "passo_uno" });
    assert.equal(e.esito, "serve_attivazione", `giro ${i}`);
  }
});

// --- Piano di sicurezza 14/11, P0-2 tappa B: verifica in due passaggi per tutti gli amministratori. ---
// Un'opzione dell'installazione, spenta di serie: accesa, admin e superadmin passano dal codice anche se
// nessuno gliel'ha richiesta uno per uno; chi è in sola lettura resta com'era.

test("opzione «due passaggi per gli amministratori»: spenta non cambia niente, accesa li chiede agli admin e non ai viewer", async () => {
  const D = await import("../due-passaggi-admin");
  const admin = await utente(false);
  const viewer = H.createUser(`lettore${++n}`, await bcrypt.hash("giusta", 4), "viewer", null);

  assert.equal(D.duePassaggiAdminAccesi(), false, "spenta di serie");
  assert.equal((await A.verificaAccessoLocale({ username: admin.username, password: "giusta" }, { fase: "accesso" })).esito, "entra");

  D.impostaDuePassaggiAdmin(true);
  try {
    // L'admin senza codice non entra più, e il passo 1 gli propone il QR.
    assert.equal((await A.verificaAccessoLocale({ username: admin.username, password: "giusta" }, { fase: "accesso" })).esito, "rifiuta");
    const ora = Date.UTC(2026, 10, 14, 12, 0, 0);
    await attiva(admin.username, ora);
    // Il viewer entra come prima.
    assert.equal((await A.verificaAccessoLocale({ username: viewer.username, password: "giusta" }, { fase: "accesso" })).esito, "entra");
    // L'utenza di servizio resta com'è (scelta di Riccardo del 20/10).
    assert.equal((await A.verificaAccessoLocale({ username: "domarc", password: "servizio-segreto" }, { fase: "accesso" })).esito, "servizio");
  } finally {
    D.impostaDuePassaggiAdmin(false);
  }
});

// --- Piano di sicurezza 14/11, P0-2 tappa D: codici di recupero (Riccardo: «Sì, falli»). ---
// Telefono perso: oggi l'unica via è una shell sul server, che ha Domarc e non il cliente. Otto codici monouso,
// stampati, valgono al posto del codice dell'app. Nel database sta solo l'impronta.

test("codici di recupero: otto, monouso, valgono al posto del codice dell'app; azzerare la verifica li cancella", async () => {
  const R = await import("../codici-recupero");
  const u = await utente(true);
  const ora = Date.UTC(2026, 10, 14, 13, 0, 0);
  await attiva(u.username, ora);

  const codici = R.generaCodiciRecupero(u.id);
  assert.equal(codici.length, 8);
  assert.equal(new Set(codici).size, 8);
  assert.equal(R.codiciRecuperoRimasti(u.id), 8);
  // Nel database non c'è nessun codice in chiaro.
  const righe = H.getHubDb().prepare("SELECT * FROM codici_recupero WHERE user_id = ?").all(u.id);
  for (const c of codici) assert.ok(!JSON.stringify(righe).includes(c.replace(/-/g, "")) && !JSON.stringify(righe).includes(c));

  const entra = (codice: string) => A.verificaAccessoLocale({ username: u.username, password: "giusta", codice }, { fase: "accesso", ora });
  // Scritto come lo scrive una persona: minuscolo, con spazi.
  assert.equal((await entra(` ${codici[0].toLowerCase().replace(/-/g, " ")} `)).esito, "entra");
  assert.equal(R.codiciRecuperoRimasti(u.id), 7);
  assert.equal((await entra(codici[0])).esito, "rifiuta", "un codice usato non vale più");
  assert.equal((await entra("AAAA-AAAA-AAAA-AAAA")).esito, "rifiuta");
  // Il codice di un altro utente non vale.
  const altro = await utente(true);
  await attiva(altro.username, ora);
  const suoi = R.generaCodiciRecupero(altro.id);
  assert.equal((await entra(suoi[0])).esito, "rifiuta");
  // Rigenerare annulla i vecchi.
  const nuovi = R.generaCodiciRecupero(u.id);
  assert.equal((await entra(codici[1])).esito, "rifiuta");
  assert.equal((await entra(nuovi[0])).esito, "entra");
  // Azzerare la verifica in due passaggi cancella i codici.
  H.impostaSecondaVerifica(u.id, "azzera");
  assert.equal(R.codiciRecuperoRimasti(u.id), 0);
});

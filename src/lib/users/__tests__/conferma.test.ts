/**
 * Conferma di chi agisce sulle operazioni che creano potere (analisi del 15/11/2026; Riccardo: chi ha la verifica
 * in due passaggi dà il codice, chi non l'ha ridà la propria password). Incidente evitato: con una sessione admin
 * presa si creava un admin nuovo e con quello si passava ogni altra conferma.
 *
 * Run: node --import tsx --test src/lib/users/__tests__/conferma.test.ts
 */
// Hub isolato: PRIMO import, prima di db-hub (il percorso si fissa al caricamento).
import { TEST_HUB_DIR, TEST_HUB_PATH } from "./isolated-hub";
import fs from "node:fs";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { closeHubDb, createUser, getHubDb } from "../../db-hub";
import { cifraAccesso } from "../../crypto";
import { codiceTotp, nuovoSegreto } from "../../accesso/totp";
import { confermaIdentita, confermaPerOperazione, serveConferma } from "../conferma";

process.env.DA_INVENT_DATA_DIR = TEST_HUB_DIR;

after(() => {
  closeHubDb();
  fs.rmSync(TEST_HUB_DIR, { recursive: true, force: true });
});

let idSenza = 0;
let idCon = 0;
let idEmergenza = 0;
let segreto = "";

beforeEach(async () => {
  if (path.resolve(getHubDb().name) !== path.resolve(TEST_HUB_PATH)) throw new Error("hub non della prova: niente DELETE");
  getHubDb().exec("DELETE FROM user_tenant_access; DELETE FROM users;");
  const hash = await bcrypt.hash("password-giusta-1", 4);
  idSenza = createUser("admin-senza", hash, "admin").id;
  idCon = createUser("admin-con", hash, "admin").id;
  segreto = nuovoSegreto();
  getHubDb().prepare("UPDATE users SET totp_richiesta = 1, totp_segreto = ? WHERE id = ?").run(cifraAccesso(segreto), idCon);
  idEmergenza = createUser("emergenza", hash, "admin").id;
  getHubDb().prepare("UPDATE users SET emergenza = 1 WHERE id = ?").run(idEmergenza);
});

const sessione = (id: number, nome: string) => ({ user: { id: String(id), name: nome, role: "admin" } });
const chiede = (r: Awaited<ReturnType<typeof confermaIdentita>>) => (r?.body as { serveConferma?: string } | undefined)?.serveConferma;

test("quali operazioni chiedono la conferma", () => {
  assert.equal(serveConferma("crea", { role: "admin" }), true);
  assert.equal(serveConferma("crea", { role: "superadmin" }), true);
  assert.equal(serveConferma("crea", { role: "viewer" }), false);
  assert.equal(serveConferma("crea", {}), false, "ruolo assente = sola lettura");
  assert.equal(serveConferma("modifica", { role: "admin" }, "viewer"), true, "promozione");
  assert.equal(serveConferma("modifica", { role: "superadmin" }, "admin"), true);
  assert.equal(serveConferma("modifica", { role: "admin" }, "admin"), false, "stesso ruolo: solo i clienti");
  assert.equal(serveConferma("modifica", { role: "viewer" }, "admin"), false, "declassare non crea potere");
  assert.equal(serveConferma("seconda_verifica", { azione: "richiedi" }), false);
  assert.equal(serveConferma("seconda_verifica", { azione: "azzera" }), true);
  assert.equal(serveConferma("seconda_verifica", { azione: "togli" }), true);
  assert.equal(serveConferma("reimposta_password", {}), true);
});

test("senza verifica in due passaggi: serve la propria password", async () => {
  const s = sessione(idSenza, "admin-senza");
  const senza = await confermaIdentita(s, {});
  assert.equal(senza?.status, 403);
  assert.equal(chiede(senza), "password");
  const sbagliata = await confermaIdentita(s, { conferma_password: "non-questa" });
  assert.equal(sbagliata?.status, 403);
  assert.equal(await confermaIdentita(s, { conferma_password: "password-giusta-1" }), null);
});

test("cinque password sbagliate fermano, anche con quella giusta", async () => {
  const s = sessione(idSenza, "admin-senza");
  for (let i = 0; i < 5; i++) await confermaIdentita(s, { conferma_password: `no-${i}` });
  const dopo = await confermaIdentita(s, { conferma_password: "password-giusta-1" });
  assert.equal(dopo?.status, 429);
});

test("con la verifica attiva: serve il codice, la password non basta", async () => {
  const s = sessione(idCon, "admin-con");
  assert.equal(chiede(await confermaIdentita(s, {})), "codice");
  assert.equal(chiede(await confermaIdentita(s, { conferma_password: "password-giusta-1" })), "codice");
  const sbagliato = await confermaIdentita(s, { conferma_codice: "000000" });
  assert.equal(sbagliato?.status, 403);
  const giusto = codiceTotp(segreto, Math.floor(Date.now() / 1000 / 30));
  assert.equal(await confermaIdentita(s, { conferma_codice: giusto }), null);
  // La conferma vale 5 minuti: la richiesta dopo passa senza ridare il codice.
  assert.equal(await confermaIdentita(s, {}), null);
});

test("la sessione d'emergenza non conferma: serve proprio a reimpostare l'amministratore vero", async () => {
  assert.equal(await confermaIdentita(sessione(idEmergenza, "emergenza"), {}), null);
});

test("dalla rotta: una creazione in sola lettura passa, un admin nuovo chiede la conferma", async () => {
  const s = sessione(idSenza, "admin-senza");
  const req = (corpo: unknown) => new Request("http://localhost/api/users", { method: "POST", body: JSON.stringify(corpo) });
  assert.equal(await confermaPerOperazione(s, req({ username: "x", role: "viewer" }), "crea"), null);
  const r = await confermaPerOperazione(s, req({ username: "x", role: "admin" }), "crea");
  assert.equal(r?.status, 403);
  const richiesta = req({ username: "x", role: "admin", conferma_password: "password-giusta-1" });
  assert.equal(await confermaPerOperazione(s, richiesta, "crea"), null);
  assert.equal(((await richiesta.json()) as { username: string }).username, "x", "il corpo resta leggibile dal servizio");
});

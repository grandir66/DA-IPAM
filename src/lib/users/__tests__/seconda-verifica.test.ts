/**
 * Verifica in due passaggi gestita dall'admin (Riccardo, 20/10; ADR 0023): «Richiedi», «Azzera»,
 * «Togli» su un utente, con le stesse regole di «Reimposta password» (l'admin solo sugli utenti
 * dei suoi clienti, il viewer niente). Ogni azione va nel registro degli accessi, mai i segreti;
 * l'elenco utenti dice lo stato senza segreti.
 *
 * Run: node --import tsx --test src/lib/users/__tests__/seconda-verifica.test.ts
 */
// Hub isolato: PRIMO import, prima di db-hub (il percorso si fissa al caricamento).
import { TEST_HUB_DIR, TEST_HUB_PATH } from "./isolated-hub";
import fs from "node:fs";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant, createUser, getHubDb, getUserByUsername, setUserTenantAccess } from "../../db-hub";
import { listUsersAs, secondaVerificaAs, type SessionLike } from "../service";

process.env.DA_INVENT_DATA_DIR = TEST_HUB_DIR;
const AUDIT = path.join(TEST_HUB_DIR, "audit");

after(() => {
  closeHubDb();
  fs.rmSync(TEST_HUB_DIR, { recursive: true, force: true });
});

function tenant(code: string): number {
  return createTenant({ codice_cliente: code, ragione_sociale: code, indirizzo: null, citta: null, provincia: null, cap: null, telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1 }).id;
}

beforeEach(() => {
  if (path.resolve(getHubDb().name) !== path.resolve(TEST_HUB_PATH)) throw new Error("hub non della prova: niente DELETE");
  getHubDb().exec("DELETE FROM user_tenant_access; DELETE FROM users; DELETE FROM tenants;");
  fs.rmSync(AUDIT, { recursive: true, force: true });
  const A = tenant("CLIA");
  const B = tenant("CLIB");
  for (const [u, r, t] of [["admin-a", "admin", A], ["viewer-a", "viewer", A], ["admin-b", "admin", B]] as const) {
    setUserTenantAccess(createUser(u, "hash-finto", r).id, t, r === "viewer" ? "viewer" : "admin");
  }
});

const sess = (username: string, role: string, tenantCode: string): SessionLike => ({
  user: { id: String(getUserByUsername(username)?.id ?? 0), name: username, role, tenantCode },
});
const req = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body) });
const riga = (username: string) =>
  getHubDb().prepare("SELECT totp_richiesta, totp_segreto, totp_proposto FROM users WHERE username = ?").get(username) as {
    totp_richiesta: number; totp_segreto: string | null; totp_proposto: string | null;
  };
const registro = (): Array<Record<string, unknown>> =>
  fs.existsSync(AUDIT)
    ? fs.readdirSync(AUDIT).filter((f) => f.startsWith("accessi-")).flatMap((f) =>
        fs.readFileSync(path.join(AUDIT, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>))
    : [];

test("l'admin richiede la verifica a un utente del suo cliente: accesa e scritta nel registro", async () => {
  const id = String(getUserByUsername("viewer-a")!.id);
  const r = await secondaVerificaAs(sess("admin-a", "admin", "CLIA"), id, req({ azione: "richiedi" }));
  assert.equal(r.status, 200);
  assert.equal(riga("viewer-a").totp_richiesta, 1);
  const righe = registro();
  assert.equal(righe.length, 1);
  assert.equal(righe[0].azione, "seconda_verifica_richiedi");
  assert.equal(righe[0].utente, "viewer-a");
  assert.equal(righe[0].da, "admin-a");
});

test("il viewer non può (403) e niente cambia", async () => {
  const id = String(getUserByUsername("viewer-a")!.id);
  const r = await secondaVerificaAs(sess("viewer-a", "viewer", "CLIA"), id, req({ azione: "richiedi" }));
  assert.equal(r.status, 403);
  assert.equal(riga("viewer-a").totp_richiesta, 0);
  assert.equal(registro().length, 0);
});

test("l'admin non tocca gli utenti di un altro cliente (403)", async () => {
  const id = String(getUserByUsername("admin-b")!.id);
  const r = await secondaVerificaAs(sess("admin-a", "admin", "CLIA"), id, req({ azione: "richiedi" }));
  assert.equal(r.status, 403);
  assert.equal(riga("admin-b").totp_richiesta, 0);
});

test("azione sconosciuta o corpo rotto → 400; utente inesistente → 404", async () => {
  const id = String(getUserByUsername("viewer-a")!.id);
  assert.equal((await secondaVerificaAs(sess("admin-a", "admin", "CLIA"), id, req({ azione: "spegni-tutto" }))).status, 400);
  assert.equal((await secondaVerificaAs(sess("admin-a", "admin", "CLIA"), id, new Request("http://x", { method: "POST", body: "{" }))).status, 400);
  assert.equal((await secondaVerificaAs(sess("admin-a", "admin", "CLIA"), "999999", req({ azione: "richiedi" }))).status, 404);
});

test("azzera cancella segreto e proposto ma lascia la richiesta; togli spegne tutto", async () => {
  const u = getUserByUsername("viewer-a")!;
  getHubDb().prepare("UPDATE users SET totp_richiesta = 1, totp_segreto = 'x', totp_proposto = 'y' WHERE id = ?").run(u.id);
  await secondaVerificaAs(sess("admin-a", "admin", "CLIA"), String(u.id), req({ azione: "azzera" }));
  assert.deepEqual(riga("viewer-a"), { totp_richiesta: 1, totp_segreto: null, totp_proposto: null });
  await secondaVerificaAs(sess("admin-a", "admin", "CLIA"), String(u.id), req({ azione: "togli" }));
  assert.equal(riga("viewer-a").totp_richiesta, 0);
});

test("l'elenco utenti dice lo stato della verifica senza mai i segreti", async () => {
  const u = getUserByUsername("viewer-a")!;
  getHubDb().prepare("UPDATE users SET totp_richiesta = 1, totp_segreto = 'segreto-cifrato', totp_proposto = 'proposto' WHERE id = ?").run(u.id);
  const r = listUsersAs(sess("admin-a", "admin", "CLIA"));
  const testo = JSON.stringify(r.body);
  assert.ok(!testo.includes("segreto-cifrato") && !testo.includes("proposto\""), "niente segreti nell'elenco");
  const v = (r.body as Array<Record<string, unknown>>).find((x) => x.username === "viewer-a")!;
  assert.equal(v.totp_richiesta, 1);
  assert.equal(v.totp_attiva, 1);
});

test("su se stessi: richiedi e azzera sì, togli no (per nessun ruolo)", async () => {
  const id = String(getUserByUsername("admin-a")!.id);
  const me = sess("admin-a", "admin", "CLIA");
  assert.equal((await secondaVerificaAs(me, id, req({ azione: "richiedi" }))).status, 200);
  assert.equal((await secondaVerificaAs(me, id, req({ azione: "azzera" }))).status, 200);
  assert.equal((await secondaVerificaAs(me, id, req({ azione: "togli" }))).status, 400);
  assert.equal(riga("admin-a").totp_richiesta, 1);
});

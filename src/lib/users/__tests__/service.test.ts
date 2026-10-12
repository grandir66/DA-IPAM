/**
 * Prove di autorizzazione delle rotte utenti (UI-18), con sessioni simulate e
 * un hub.db vero in una cartella temporanea.
 *
 * Le rotte /api/users* sono gusci: `requireAdmin()` e poi una funzione di
 * `service.ts`, che riceve la sessione. Le rotte vere non si possono chiamare
 * qui (la sessione di NextAuth vive solo dentro una richiesta di Next), quindi
 * si prova il servizio con la sessione in mano; che ogni rotta passi davvero
 * dal servizio lo verifica `routes-use-service.test.ts`.
 *
 * Per ogni rotta: viewer → 403; admin → ok sul proprio cliente; admin → 403 su
 * utenti di un altro cliente e su un superadmin; admin rifiutato se crea o
 * promuove a superadmin; admin non elimina sé stesso. Superadmin invariato.
 *
 * Run: node --import tsx --test src/lib/users/__tests__/service.test.ts
 */
// Hub isolato: PRIMO import, prima di db-hub (il percorso si fissa al caricamento).
import { TEST_HUB_DIR, TEST_HUB_PATH } from "./isolated-hub";
import fs from "node:fs";
import path from "node:path";
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import {
  closeHubDb,
  createTenant,
  createUser,
  getHubDb,
  getUserById,
  getUserByUsername,
  getUserTenantAccess,
  setUserTenantAccess,
} from "@/lib/db-hub";
import {
  createUserAs,
  deleteUserAs,
  listUsersAs,
  resetPasswordAs,
  resolveUserManager,
  updateUserAs,
  type SessionLike,
} from "../service";

after(() => {
  closeHubDb();
  fs.rmSync(TEST_HUB_DIR, { recursive: true, force: true });
});

const HASH = "hash-finto-non-usato";

interface World {
  A: number;
  B: number;
  /** id per username */
  id: Record<string, number>;
}

let w: World;

function tenant(code: string, name: string): number {
  return createTenant({
    codice_cliente: code,
    ragione_sociale: name,
    indirizzo: null,
    citta: null,
    provincia: null,
    cap: null,
    telefono: null,
    email: null,
    piva: null,
    cf: null,
    referente: null,
    note: null,
    active: 1,
  }).id;
}

function user(username: string, role: "superadmin" | "admin" | "viewer", access: Array<[number, "admin" | "viewer"]>): number {
  const u = createUser(username, HASH, role);
  for (const [tid, r] of access) setUserTenantAccess(u.id, tid, r);
  return u.id;
}

/** Due clienti, A e B, e un utente per ogni caso che conta. */
function seed(): World {
  // Freno: si svuota solo l'hub temporaneo, mai un hub vero.
  const opened = path.resolve(getHubDb().name);
  if (opened !== path.resolve(TEST_HUB_PATH)) {
    throw new Error(`hub aperto su ${opened}, non su quello della prova: niente DELETE`);
  }
  getHubDb().exec("DELETE FROM user_tenant_access; DELETE FROM users; DELETE FROM tenants;");
  const A = tenant("CLIA", "Cliente A");
  const B = tenant("CLIB", "Cliente B");
  const id: Record<string, number> = {};
  // Il superadmin con un accesso al cliente A, come nei dati veri:
  // migrate-to-multitenant gli dà una riga 'admin' sul cliente di default, ed
  // enable-multitenant promuove l'admin del setup, che la riga ce l'ha già.
  // Senza, i 403 su di lui passerebbero dalla barriera «utente senza clienti».
  id["root"] = user("root", "superadmin", [[A, "admin"]]);
  id["admin-a"] = user("admin-a", "admin", [[A, "admin"]]);
  id["admin-a2"] = user("admin-a2", "admin", [[A, "admin"]]);
  id["viewer-a"] = user("viewer-a", "viewer", [[A, "viewer"]]);
  id["admin-b"] = user("admin-b", "admin", [[B, "admin"]]);
  id["viewer-ab"] = user("viewer-ab", "viewer", [[A, "viewer"], [B, "viewer"]]);
  id["orfano"] = user("orfano", "viewer", []);
  return { A, B, id };
}

beforeEach(() => {
  w = seed();
});

function sess(username: string, role: string, tenantCode: string | null): SessionLike {
  const row = getUserByUsername(username);
  return { user: { id: row ? String(row.id) : "0", name: username, role, tenantCode } };
}

const asSuper = () => sess("root", "superadmin", "__ALL__");
const asAdminA = () => sess("admin-a", "admin", "CLIA");
const asViewerA = () => sess("viewer-a", "viewer", "CLIA");

function req(body: unknown): Request {
  return new Request("http://localhost/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function usernames(body: unknown): string[] {
  assert.ok(Array.isArray(body), "risposta non è un elenco");
  return (body as Array<{ username: string }>).map((u) => u.username).sort();
}

function errorOf(body: unknown): string {
  return (body as { error?: string }).error ?? "";
}

function accessOf(username: string): Array<[number, string]> {
  const row = getUserByUsername(username);
  assert.ok(row, `utente ${username} assente`);
  return getUserTenantAccess(row.id).map((a) => [a.tenant_id, a.role]);
}

// ─── viewer: 403 su tutto, lettura compresa ───

test("viewer → 403 su ogni rotta utenti, e niente cambia", async () => {
  const s = asViewerA();
  const target = String(w.id["admin-a2"]);
  const before = getUserById(w.id["admin-a2"]);
  const results = [
    listUsersAs(s),
    await createUserAs(s, req({ username: "nuovo", password: "password-lunga", role: "viewer" })),
    await updateUserAs(s, target, req({ role: "viewer" })),
    deleteUserAs(s, target),
    await resetPasswordAs(s, target, req({ new_password: "password-nuova" })),
  ];
  for (const r of results) assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(getUserByUsername("nuovo"), undefined);
  assert.deepEqual(getUserById(w.id["admin-a2"]), before);
});

test("ruolo sconosciuto o assente → 403", () => {
  for (const role of ["", "operator", "SUPERADMIN"]) {
    assert.equal(listUsersAs({ user: { id: "1", name: "x", role, tenantCode: null } }).status, 403, role);
  }
  assert.equal(listUsersAs({ user: { name: "x" } }).status, 403);
});

// ─── GET /api/users ───

test("GET: l'admin vede solo gli utenti del suo cliente", () => {
  const r = listUsersAs(asAdminA());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // né il superadmin, né chi sta (anche) su B, né chi non ha clienti
  assert.deepEqual(usernames(r.body), ["admin-a", "admin-a2", "viewer-a"]);
  const viewerA = (r.body as Array<{ username: string; tenant_access: Array<{ tenant_id: number; codice_cliente: string; ragione_sociale: string; role: string }> }>).find(
    (u) => u.username === "viewer-a",
  );
  assert.deepEqual(viewerA?.tenant_access, [{ tenant_id: w.A, codice_cliente: "CLIA", ragione_sociale: "Cliente A", role: "viewer" }]);
  assert.ok(!("password_hash" in (viewerA as object)), "password_hash nella risposta");
});

test("GET: il superadmin vede tutti (invariato)", () => {
  const r = listUsersAs(asSuper());
  assert.equal(r.status, 200);
  assert.deepEqual(usernames(r.body), ["admin-a", "admin-a2", "admin-b", "orfano", "root", "viewer-a", "viewer-ab"]);
});

// ─── POST /api/users ───

test("POST: l'admin crea un utente, che finisce nel suo cliente", async () => {
  const r = await createUserAs(asAdminA(), req({ username: "nuovo.viewer", password: "password-lunga", role: "viewer" }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(!("password_hash" in (r.body as object)));
  assert.deepEqual(accessOf("nuovo.viewer"), [[w.A, "viewer"]]);
  const r2 = await createUserAs(asAdminA(), req({ username: "nuovo.admin", password: "password-lunga", role: "admin", tenant_ids: [w.A] }));
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.deepEqual(accessOf("nuovo.admin"), [[w.A, "admin"]]);
  assert.equal(getUserByUsername("nuovo.admin")?.role, "admin");
});

test("POST: l'admin non crea utenti in un altro cliente (403)", async () => {
  for (const tenant_ids of [[w.B], [w.A, w.B]]) {
    const r = await createUserAs(asAdminA(), req({ username: "intruso", password: "password-lunga", role: "viewer", tenant_ids }));
    assert.equal(r.status, 403, JSON.stringify(r.body));
  }
  assert.equal(getUserByUsername("intruso"), undefined);
});

test("POST: l'admin che crea un superadmin è rifiutato (403)", async () => {
  const r = await createUserAs(asAdminA(), req({ username: "capo", password: "password-lunga", role: "superadmin" }));
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(getUserByUsername("capo"), undefined);
});

test("POST: validazioni di prima, uguali per tutti", async () => {
  const cases: Array<[unknown, number, string]> = [
    [{ username: "", password: "password-lunga" }, 400, "Username e password sono obbligatori"],
    [{ username: "ab", password: "password-lunga" }, 400, "Lo username deve avere tra 3 e 50 caratteri"],
    [{ username: "con spazio", password: "password-lunga" }, 400, "Lo username può contenere solo lettere, numeri, punti, trattini e underscore"],
    [{ username: "corto", password: "1234567" }, 400, "La password deve avere almeno 8 caratteri"],
    [{ username: "ruolo", password: "password-lunga", role: "operator" }, 400, "Il ruolo deve essere 'superadmin', 'admin' o 'viewer'"],
    [{ username: "admin-a2", password: "password-lunga", role: "viewer" }, 409, "Username già in uso"],
    [{ username: "clienti", password: "password-lunga", tenant_ids: ["1"] }, 400, "Elenco clienti non valido"],
    [{ username: 42, password: "password-lunga" }, 400, "Username e password sono obbligatori"],
  ];
  for (const [body, status, error] of cases) {
    const r = await createUserAs(asAdminA(), req(body));
    assert.equal(r.status, status, JSON.stringify(body));
    assert.equal(errorOf(r.body), error);
  }
  const bad = await createUserAs(asAdminA(), new Request("http://localhost/api/users", { method: "POST", body: "{non json" }));
  assert.equal(bad.status, 400);
  assert.equal(errorOf(bad.body), "JSON non valido");
});

test("POST: il superadmin crea superadmin e utenti di qualunque cliente (invariato)", async () => {
  const r = await createUserAs(asSuper(), req({ username: "root2", password: "password-lunga", role: "superadmin" }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(accessOf("root2"), []);
  const r2 = await createUserAs(asSuper(), req({ username: "su-b", password: "password-lunga", role: "viewer", tenant_ids: [w.B] }));
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.deepEqual(accessOf("su-b"), [[w.B, "viewer"]]);
  const r3 = await createUserAs(asSuper(), req({ username: "senza", password: "password-lunga", role: "viewer" }));
  assert.equal(r3.status, 400);
  assert.equal(errorOf(r3.body), "Seleziona almeno un cliente per questo ruolo");
});

// ─── PUT /api/users/[id] ───

test("PUT: l'admin cambia il ruolo di un utente del suo cliente; i clienti restano", async () => {
  const r = await updateUserAs(asAdminA(), String(w.id["viewer-a"]), req({ role: "admin" }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(getUserById(w.id["viewer-a"])?.role, "admin");
  assert.deepEqual(accessOf("viewer-a"), [[w.A, "admin"]]);
});

test("PUT: l'admin → 403 su un utente di un altro cliente, su uno che sta anche su B, su un superadmin", async () => {
  for (const name of ["admin-b", "viewer-ab", "root", "orfano"]) {
    const before = getUserById(w.id[name]);
    const accessBefore = accessOf(name);
    const r = await updateUserAs(asAdminA(), String(w.id[name]), req({ role: "viewer", tenant_ids: [w.A] }));
    assert.equal(r.status, 403, `${name}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(getUserById(w.id[name]), before);
    assert.deepEqual(accessOf(name), accessBefore);
  }
});

test("PUT: l'admin che promuove a superadmin è rifiutato (403)", async () => {
  const r = await updateUserAs(asAdminA(), String(w.id["viewer-a"]), req({ role: "superadmin" }));
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(getUserById(w.id["viewer-a"])?.role, "viewer");
});

test("PUT: l'admin non sposta un suo utente in un altro cliente (403)", async () => {
  const r = await updateUserAs(asAdminA(), String(w.id["viewer-a"]), req({ role: "viewer", tenant_ids: [w.B] }));
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.deepEqual(accessOf("viewer-a"), [[w.A, "viewer"]]);
});

test("PUT: l'admin non si toglie il ruolo admin", async () => {
  const r = await updateUserAs(asAdminA(), String(w.id["admin-a"]), req({ role: "viewer" }));
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(getUserById(w.id["admin-a"])?.role, "admin");
  assert.deepEqual(accessOf("admin-a"), [[w.A, "admin"]]);
});

test("PUT: il superadmin modifica chiunque (invariato)", async () => {
  const r = await updateUserAs(asSuper(), String(w.id["admin-b"]), req({ role: "viewer", tenant_ids: [w.A, w.B] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(getUserById(w.id["admin-b"])?.role, "viewer");
  assert.deepEqual(accessOf("admin-b").sort(), [[w.A, "viewer"], [w.B, "viewer"]]);
  // l'ultimo superadmin resta protetto
  const last = await updateUserAs(asSuper(), String(w.id["root"]), req({ role: "admin", tenant_ids: [w.A] }));
  assert.equal(last.status, 400);
  assert.equal(errorOf(last.body), "Impossibile modificare il ruolo dell'ultimo super amministratore");
  // e i clienti restano obbligatori per admin e viewer
  const none = await updateUserAs(asSuper(), String(w.id["viewer-a"]), req({ role: "viewer" }));
  assert.equal(none.status, 400);
  assert.equal(errorOf(none.body), "Seleziona almeno un cliente per questo ruolo");
});

test("PUT: id non valido, utente assente, ruolo non valido", async () => {
  assert.equal((await updateUserAs(asAdminA(), "abc", req({ role: "viewer" }))).status, 400);
  assert.equal((await updateUserAs(asAdminA(), "99999", req({ role: "viewer" }))).status, 404);
  const bad = await updateUserAs(asAdminA(), String(w.id["viewer-a"]), req({ role: "operator" }));
  assert.equal(bad.status, 400);
  assert.equal(errorOf(bad.body), "Il ruolo deve essere 'superadmin', 'admin' o 'viewer'");
});

// ─── DELETE /api/users/[id] ───

test("DELETE: l'admin elimina un utente del suo cliente", () => {
  const r = deleteUserAs(asAdminA(), String(w.id["viewer-a"]));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(getUserById(w.id["viewer-a"]), undefined);
});

test("DELETE: l'admin → 403 su un altro cliente, su chi sta anche su B, su un superadmin, su chi non ha clienti", () => {
  for (const name of ["admin-b", "viewer-ab", "root", "orfano"]) {
    const r = deleteUserAs(asAdminA(), String(w.id[name]));
    assert.equal(r.status, 403, `${name}: ${JSON.stringify(r.body)}`);
    assert.ok(getUserById(w.id[name]), `${name} eliminato`);
  }
});

test("DELETE: l'admin non elimina sé stesso", () => {
  const r = deleteUserAs(asAdminA(), String(w.id["admin-a"]));
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(errorOf(r.body), "Non puoi eliminare il tuo stesso account");
  assert.ok(getUserById(w.id["admin-a"]));
});

test("DELETE: il superadmin elimina chiunque tranne sé stesso (invariato)", () => {
  assert.equal(deleteUserAs(asSuper(), String(w.id["admin-b"])).status, 200);
  const self = deleteUserAs(asSuper(), String(w.id["root"]));
  assert.equal(self.status, 400);
  assert.ok(getUserById(w.id["root"]));
});

// ─── POST /api/users/[id]/reset-password ───

test("reset password: l'admin reimposta quella di un utente del suo cliente", async () => {
  const r = await resetPasswordAs(asAdminA(), String(w.id["viewer-a"]), req({ new_password: "nuova-password-1" }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = getUserById(w.id["viewer-a"]);
  assert.ok(row && (await bcrypt.compare("nuova-password-1", row.password_hash)));
});

test("reset password: l'admin → 403 su un altro cliente, su chi sta anche su B, su un superadmin", async () => {
  for (const name of ["admin-b", "viewer-ab", "root"]) {
    const r = await resetPasswordAs(asAdminA(), String(w.id[name]), req({ new_password: "nuova-password-1" }));
    assert.equal(r.status, 403, `${name}: ${JSON.stringify(r.body)}`);
    assert.equal(getUserById(w.id[name])?.password_hash, HASH, `${name}: password cambiata`);
  }
});

test("reset password: l'admin non reimposta la propria (400): «Cambia password» chiede quella attuale", async () => {
  const r = await resetPasswordAs(asAdminA(), String(w.id["admin-a"]), req({ new_password: "nuova-password-1" }));
  assert.equal(r.status, 400, JSON.stringify(r.body));
  assert.equal(getUserById(w.id["admin-a"])?.password_hash, HASH, "password cambiata");
});

test("POST: lo username dell'utenza di servizio Domarc è riservato, per tutti (409)", async () => {
  for (const s of [asAdminA(), asSuper()]) {
    for (const username of ["domarc", "Domarc"]) {
      const r = await createUserAs(s, req({ username, password: "password-lunga", role: "viewer", tenant_ids: [w.A] }));
      assert.equal(r.status, 409, `${username}: ${JSON.stringify(r.body)}`);
      assert.equal(getUserByUsername(username), undefined);
    }
  }
});

// ─── La sessione di un admin si confronta col database ───

test("admin declassato dopo l'accesso: la sessione vecchia non gestisce più (403)", () => {
  getHubDb().prepare("UPDATE users SET role = 'viewer' WHERE id = ?").run(w.id["admin-a"]);
  assert.equal(listUsersAs(asAdminA()).status, 403);
});

test("admin senza più accesso da admin al suo cliente → 403", () => {
  getHubDb().prepare("UPDATE user_tenant_access SET role = 'viewer' WHERE user_id = ?").run(w.id["admin-a"]);
  assert.equal(listUsersAs(asAdminA()).status, 403);
});

test("superadmin declassato dopo l'accesso: la sessione vecchia non gestisce più e non si ripromuove (403)", async () => {
  getHubDb().prepare("UPDATE users SET role = 'viewer' WHERE id = ?").run(w.id["root"]);
  assert.equal(listUsersAs(asSuper()).status, 403);
  const r = await updateUserAs(asSuper(), String(w.id["root"]), req({ role: "superadmin" }));
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(getUserById(w.id["root"])?.role, "viewer");
});

test("utenza di servizio Domarc (id 0, senza riga): resta superadmin dal token", () => {
  const s: SessionLike = { user: { id: "0", name: "domarc", role: "superadmin", tenantCode: "__ALL__" } };
  const r = listUsersAs(s);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(usernames(r.body).length, 7);
});

test("sessione con id di un altro utente → 403", () => {
  const s: SessionLike = { user: { id: String(w.id["admin-b"]), name: "admin-a", role: "admin", tenantCode: "CLIA" } };
  assert.equal(listUsersAs(s).status, 403);
});

test("resolveUserManager: l'admin amministra A e lavora su A; su un cliente non suo, nessun cliente corrente", () => {
  const r = resolveUserManager(asAdminA());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.actor.tenantIds, [w.A]);
    assert.equal(r.actor.currentTenantId, w.A);
  }
  const altrove = resolveUserManager(sess("admin-a", "admin", "CLIB"));
  assert.equal(altrove.ok, true);
  if (altrove.ok) assert.equal(altrove.actor.currentTenantId, null);
});

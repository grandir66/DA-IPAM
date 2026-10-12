/**
 * Chi gestisce quali utenti (UI-18, tappa 1 del piano di miglioramento).
 *
 * Difetto: in un'installazione = un cliente, l'amministratore creato dal setup
 * non poteva gestire gli utenti del proprio cliente (le rotte /api/users*
 * chiedevano il superadmin e la pagina mostrava «Nessun utente trovato").
 * Aprire la gestione all'admin tocca i permessi: queste prove tengono fermi i
 * confini, su TUTTE le combinazioni di attore, bersaglio, clienti e ruolo.
 *
 * Due famiglie di prove, perché una sola non basta:
 * - sicurezza: nessuna decisione positiva dell'admin tocca un superadmin, un
 *   cliente che non amministra o il ruolo superadmin;
 * - vivezza: l'admin PUÒ davvero gestire gli utenti del suo cliente (una
 *   funzione che nega tutto passerebbe le prove di sicurezza).
 *
 * Run: node --import tsx --test src/lib/users/__tests__/permissions.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assignableRoles,
  canManageUser,
  decideCreate,
  decideDelete,
  decideResetPassword,
  decideUpdate,
  isSelf,
  type ManagedUser,
  type UserManager,
  type UserRole,
} from "../permissions";

const A = 10;
const B = 20;
const C = 30;

const SUPER: UserManager = { role: "superadmin", userId: 1, username: "root", tenantIds: [], currentTenantId: null };
/** admin del solo cliente A (il caso dell'appliance: un'installazione = un cliente) */
const ADMIN_A: UserManager = { role: "admin", userId: 2, username: "admin-a", tenantIds: [A], currentTenantId: A };
/** admin di A e B, che sta lavorando su B */
const ADMIN_AB: UserManager = { role: "admin", userId: 3, username: "admin-ab", tenantIds: [A, B], currentTenantId: B };
/** admin di A e B senza cliente corrente risolto */
const ADMIN_AB_NO_CURRENT: UserManager = { ...ADMIN_AB, userId: 4, username: "admin-ab2", currentTenantId: null };

const ADMINS = [ADMIN_A, ADMIN_AB, ADMIN_AB_NO_CURRENT];

const ROLES: UserRole[] = ["superadmin", "admin", "viewer"];
const TENANT_SETS: number[][] = [[], [A], [B], [C], [A, B], [A, C], [A, B, C]];
const INPUT_TENANTS: Array<number[] | undefined> = [undefined, [], [A], [B], [C], [A, B], [A, C]];

const subset = (xs: readonly number[], ys: readonly number[]) => xs.every((x) => ys.includes(x));
const sameSet = (xs: readonly number[], ys: readonly number[]) => subset(xs, ys) && subset(ys, xs);

/** Tutti i bersagli possibili per un attore: ogni ruolo × ogni insieme di clienti, altri e sé stesso. */
function targetsFor(actor: UserManager): Array<ManagedUser & { self: boolean }> {
  const out: Array<ManagedUser & { self: boolean }> = [];
  let id = 100;
  for (const role of ROLES) {
    for (const tenantIds of TENANT_SETS) {
      out.push({ id: id++, username: `u${id}`, role, tenantIds, self: false });
    }
  }
  // Sé stesso, con i clienti che ha davvero (e, per completezza, altri insiemi).
  for (const tenantIds of TENANT_SETS) {
    out.push({ id: actor.userId ?? 0, username: actor.username, role: actor.role, tenantIds, self: true });
  }
  return out;
}

// ─── Casi scritti a mano: il comportamento atteso, letto dalla richiesta ───

test("assignableRoles: l'admin non vede mai il ruolo superadmin", () => {
  assert.deepEqual(assignableRoles(SUPER), ["superadmin", "admin", "viewer"]);
  for (const a of ADMINS) assert.deepEqual(assignableRoles(a), ["admin", "viewer"]);
});

test("isSelf: per username o per id", () => {
  assert.equal(isSelf(ADMIN_A, { id: 2, username: "altro" }), true);
  assert.equal(isSelf(ADMIN_A, { id: 99, username: "admin-a" }), true);
  assert.equal(isSelf(ADMIN_A, { id: 99, username: "altro" }), false);
  // utenza di servizio senza riga (id null): solo per username
  const servizio: UserManager = { ...SUPER, userId: null, username: "domarc" };
  assert.equal(isSelf(servizio, { id: 1, username: "root" }), false);
  assert.equal(isSelf(servizio, { id: 1, username: "domarc" }), true);
});

test("admin di A: gestisce un viewer di A", () => {
  const v: ManagedUser = { id: 50, username: "viewer-a", role: "viewer", tenantIds: [A] };
  assert.equal(canManageUser(ADMIN_A, v), true);
  assert.deepEqual(decideDelete(ADMIN_A, v), { ok: true });
  assert.deepEqual(decideResetPassword(ADMIN_A, v), { ok: true });
  assert.deepEqual(decideUpdate(ADMIN_A, v, { role: "admin" }), { ok: true, tenantIds: [A] });
  assert.deepEqual(decideUpdate(ADMIN_A, v, { role: "viewer", tenantIds: [A] }), { ok: true, tenantIds: [A] });
});

test("admin di A: 403 su un utente di B, su uno di A e B, su un superadmin", () => {
  const b: ManagedUser = { id: 51, username: "viewer-b", role: "viewer", tenantIds: [B] };
  const ab: ManagedUser = { id: 52, username: "viewer-ab", role: "viewer", tenantIds: [A, B] };
  const root: ManagedUser = { id: 1, username: "root", role: "superadmin", tenantIds: [] };
  for (const t of [b, ab, root]) {
    assert.equal(canManageUser(ADMIN_A, t), false, t.username);
    for (const d of [
      decideDelete(ADMIN_A, t),
      decideResetPassword(ADMIN_A, t),
      decideUpdate(ADMIN_A, t, { role: "viewer" }),
    ]) {
      assert.equal(d.ok, false, t.username);
      if (!d.ok) assert.equal(d.status, 403, `${t.username}: ${d.error}`);
    }
  }
});

test("admin di A: un utente senza clienti non è suo (403)", () => {
  const orfano: ManagedUser = { id: 53, username: "orfano", role: "viewer", tenantIds: [] };
  assert.equal(canManageUser(ADMIN_A, orfano), false);
  const d = decideDelete(ADMIN_A, orfano);
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.status, 403);
});

test("admin: crea e promuove a superadmin → rifiutato (403)", () => {
  const c = decideCreate(ADMIN_A, { role: "superadmin", tenantIds: [A] });
  assert.equal(c.ok, false);
  if (!c.ok) assert.equal(c.status, 403);
  const v: ManagedUser = { id: 50, username: "viewer-a", role: "viewer", tenantIds: [A] };
  const u = decideUpdate(ADMIN_A, v, { role: "superadmin" });
  assert.equal(u.ok, false);
  if (!u.ok) assert.equal(u.status, 403);
});

test("admin: gli utenti che crea finiscono nel suo cliente", () => {
  // senza clienti indicati → il cliente su cui sta lavorando
  assert.deepEqual(decideCreate(ADMIN_A, { role: "viewer" }), { ok: true, tenantIds: [A] });
  assert.deepEqual(decideCreate(ADMIN_A, { role: "admin", tenantIds: [] }), { ok: true, tenantIds: [A] });
  assert.deepEqual(decideCreate(ADMIN_AB, { role: "viewer" }), { ok: true, tenantIds: [B] });
  // indicati: solo fra i suoi
  assert.deepEqual(decideCreate(ADMIN_AB, { role: "viewer", tenantIds: [A, B] }), { ok: true, tenantIds: [A, B] });
  const fuori = decideCreate(ADMIN_A, { role: "viewer", tenantIds: [B] });
  assert.equal(fuori.ok, false);
  if (!fuori.ok) assert.equal(fuori.status, 403);
  // due clienti e nessuno corrente: non si sceglie a caso
  const ambiguo = decideCreate(ADMIN_AB_NO_CURRENT, { role: "viewer" });
  assert.equal(ambiguo.ok, false);
  if (!ambiguo.ok) assert.equal(ambiguo.status, 400);
});

test("admin: non elimina sé stesso, non si toglie il ruolo admin, non cambia i propri clienti", () => {
  const me: ManagedUser = { id: 3, username: "admin-ab", role: "admin", tenantIds: [A, B] };
  const del = decideDelete(ADMIN_AB, me);
  assert.equal(del.ok, false);
  if (!del.ok) assert.equal(del.status, 400);
  const demote = decideUpdate(ADMIN_AB, me, { role: "viewer" });
  assert.equal(demote.ok, false);
  const shrink = decideUpdate(ADMIN_AB, me, { role: "admin", tenantIds: [A] });
  assert.equal(shrink.ok, false);
  // salvare senza cambiare niente resta possibile
  assert.deepEqual(decideUpdate(ADMIN_AB, me, { role: "admin" }), { ok: true, tenantIds: [A, B] });
  assert.deepEqual(decideUpdate(ADMIN_AB, me, { role: "admin", tenantIds: [B, A] }), { ok: true, tenantIds: [B, A] });
  // la propria password no: «Cambia password» chiede quella attuale, questa rotta
  // no, e una sessione rubata diventerebbe una credenziale permanente.
  const ownReset = decideResetPassword(ADMIN_AB, me);
  assert.equal(ownReset.ok, false);
  if (!ownReset.ok) assert.equal(ownReset.status, 400);
});

test("superadmin: invariato — tutto, tranne eliminare sé stesso", () => {
  const root: ManagedUser = { id: 1, username: "root", role: "superadmin", tenantIds: [] };
  const other: ManagedUser = { id: 9, username: "root2", role: "superadmin", tenantIds: [] };
  const b: ManagedUser = { id: 51, username: "viewer-b", role: "viewer", tenantIds: [B] };
  assert.deepEqual(decideDelete(SUPER, other), { ok: true });
  assert.deepEqual(decideDelete(SUPER, b), { ok: true });
  const self = decideDelete(SUPER, root);
  assert.equal(self.ok, false);
  if (!self.ok) assert.equal(self.status, 400);
  assert.deepEqual(decideResetPassword(SUPER, other), { ok: true });
  assert.deepEqual(decideCreate(SUPER, { role: "superadmin" }), { ok: true, tenantIds: [] });
  assert.deepEqual(decideCreate(SUPER, { role: "admin", tenantIds: [C] }), { ok: true, tenantIds: [C] });
  const senzaClienti = decideCreate(SUPER, { role: "viewer" });
  assert.equal(senzaClienti.ok, false);
  if (!senzaClienti.ok) assert.equal(senzaClienti.status, 400);
  assert.deepEqual(decideUpdate(SUPER, b, { role: "superadmin" }), { ok: true, tenantIds: [] });
  assert.deepEqual(decideUpdate(SUPER, other, { role: "admin", tenantIds: [C] }), { ok: true, tenantIds: [C] });
});

// ─── Prove esaustive: tutte le combinazioni ───

test("sicurezza: nessuna decisione positiva dell'admin esce dai suoi clienti o tocca un superadmin", () => {
  let checked = 0;
  for (const actor of ADMINS) {
    for (const target of targetsFor(actor)) {
      const decisions = [
        decideDelete(actor, target),
        decideResetPassword(actor, target),
        ...ROLES.flatMap((role) => INPUT_TENANTS.map((tenantIds) => decideUpdate(actor, target, { role, tenantIds }))),
      ];
      for (const d of decisions) {
        checked++;
        if (!d.ok) continue;
        assert.notEqual(target.role, "superadmin", `${actor.username} → ${target.username}: superadmin toccato`);
        assert.ok(target.tenantIds.length > 0, `${actor.username} → ${target.username}: utente senza clienti`);
        assert.ok(subset(target.tenantIds, actor.tenantIds), `${actor.username} → ${target.username}: cliente non suo`);
      }
      for (const role of ROLES) {
        for (const tenantIds of INPUT_TENANTS) {
          const d = decideUpdate(actor, target, { role, tenantIds });
          if (!d.ok) continue;
          assert.notEqual(role, "superadmin", "promozione a superadmin concessa");
          assert.ok(subset(d.tenantIds, actor.tenantIds), "assegnato un cliente non suo");
          if (target.self) {
            assert.equal(role, "admin", "l'admin si è tolto il ruolo admin");
            assert.ok(sameSet(d.tenantIds, target.tenantIds), "l'admin ha cambiato i propri clienti");
          }
        }
      }
      if (target.self) {
        assert.equal(decideDelete(actor, target).ok, false, "l'admin ha eliminato sé stesso");
        assert.equal(decideResetPassword(actor, target).ok, false, "l'admin ha reimpostato la propria password");
      }
    }
    for (const role of ROLES) {
      for (const tenantIds of INPUT_TENANTS) {
        const d = decideCreate(actor, { role, tenantIds });
        checked++;
        if (!d.ok) continue;
        assert.notEqual(role, "superadmin", "creato un superadmin");
        assert.ok(d.tenantIds.length > 0, "utente creato senza clienti");
        assert.ok(subset(d.tenantIds, actor.tenantIds), "utente creato in un cliente non suo");
      }
    }
  }
  assert.ok(checked > 1000, `poche combinazioni provate: ${checked}`);
});

test("sicurezza: i rifiuti per cliente altrui o superadmin sono 403", () => {
  for (const actor of ADMINS) {
    for (const target of targetsFor(actor)) {
      if (target.self) continue;
      const foreign =
        target.role === "superadmin" || target.tenantIds.length === 0 || !subset(target.tenantIds, actor.tenantIds);
      if (!foreign) continue;
      for (const d of [decideDelete(actor, target), decideResetPassword(actor, target), decideUpdate(actor, target, { role: "viewer" })]) {
        assert.equal(d.ok, false);
        if (!d.ok) assert.equal(d.status, 403, `${actor.username} → ${target.username} (${target.role}, [${target.tenantIds}])`);
      }
    }
  }
});

test("vivezza: l'admin gestisce davvero ogni utente non superadmin dei suoi clienti", () => {
  let allowed = 0;
  for (const actor of ADMINS) {
    for (const target of targetsFor(actor)) {
      if (target.self || target.role === "superadmin") continue;
      if (target.tenantIds.length === 0 || !subset(target.tenantIds, actor.tenantIds)) continue;
      assert.equal(canManageUser(actor, target), true, `${actor.username} → ${target.username}`);
      assert.deepEqual(decideDelete(actor, target), { ok: true });
      assert.deepEqual(decideResetPassword(actor, target), { ok: true });
      for (const role of ["admin", "viewer"] as const) {
        assert.deepEqual(decideUpdate(actor, target, { role }), { ok: true, tenantIds: [...target.tenantIds] });
        assert.deepEqual(decideUpdate(actor, target, { role, tenantIds: actor.tenantIds.slice(0, 1) }), {
          ok: true,
          tenantIds: actor.tenantIds.slice(0, 1),
        });
      }
      allowed++;
    }
    for (const role of ["admin", "viewer"] as const) {
      assert.deepEqual(decideCreate(actor, { role, tenantIds: [...actor.tenantIds] }), { ok: true, tenantIds: [...actor.tenantIds] });
    }
  }
  assert.ok(allowed >= 6, `troppo pochi casi positivi: ${allowed}`);
});

test("superadmin, esaustivo: ogni decisione concessa tranne eliminare sé stesso e creare senza clienti", () => {
  for (const target of targetsFor(SUPER)) {
    assert.equal(canManageUser(SUPER, target), true);
    assert.equal(decideDelete(SUPER, target).ok, !target.self);
    assert.deepEqual(decideResetPassword(SUPER, target), { ok: true });
    for (const role of ROLES) {
      for (const tenantIds of INPUT_TENANTS) {
        const d = decideUpdate(SUPER, target, { role, tenantIds });
        assert.equal(d.ok, true);
        if (d.ok) assert.deepEqual(d.tenantIds, role === "superadmin" ? [] : [...(tenantIds ?? [])]);
      }
    }
  }
  for (const role of ROLES) {
    for (const tenantIds of INPUT_TENANTS) {
      const d = decideCreate(SUPER, { role, tenantIds });
      const expectOk = role === "superadmin" || (tenantIds !== undefined && tenantIds.length > 0);
      assert.equal(d.ok, expectOk, `${role} [${tenantIds}]`);
    }
  }
});

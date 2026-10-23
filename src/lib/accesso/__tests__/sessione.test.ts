/**
 * Sessione e istanza (Riccardo, 23/10).
 *
 * - «Esci» non chiudeva la sessione: le richieste della dashboard partite prima dell'uscita
 *   tornavano dopo e rimettevano il cookie (il JWT si rinnova a ogni risposta). Traccia del
 *   23/10: signout `Max-Age=0` a +495 ms, `/api/status/*` rimettono il cookie a +525 ms, `/`
 *   riapre la sessione. Ora l'uscita segna l'ora sull'utente e un token d'accesso precedente
 *   non vale più, da qualunque richiesta arrivi.
 * - Il cambio d'istanza accettava qualsiasi codice dal browser (`update({ tenantCode })`)
 *   senza guardare gli accessi: un utente con la sola istanza A poteva chiedere B.
 * - L'ultima istanza scelta si ricorda: all'accesso si riparte da lì, se l'accesso c'è ancora.
 *
 * Le prove chiamano i callback veri di `authConfig`, non una copia della logica.
 *
 * Run: node --import tsx --test src/lib/accesso/__tests__/sessione.test.ts
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { JWT } from "next-auth/jwt";

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sessione-"));
process.env.DA_INVENT_DATA_DIR = DIR;
process.env.DA_IPAM_HUB_DB_PATH = path.join(DIR, "hub.db");
process.env.ENCRYPTION_KEY = crypto.randomBytes(16).toString("hex");

type Hub = typeof import("../../db-hub");
type Config = typeof import("../../auth.config");
type Sessione = typeof import("../sessione");
let H: Hub;
let C: Config;
let S: Sessione;
let A: { id: number; code: string };
let B: { id: number; code: string };

function istanza(code: string) {
  const t = H.createTenant({
    codice_cliente: code, ragione_sociale: `Istanza ${code}`, indirizzo: null, citta: null,
    provincia: null, cap: null, telefono: null, email: null, piva: null, cf: null,
    referente: null, note: null, active: 1,
  });
  return { id: t.id, code };
}

let n = 0;
function utente(ruolo: "superadmin" | "admin" | "viewer") {
  return H.createUser(`utente${++n}`, "hash-finto", ruolo, null);
}

/** Il callback `jwt` vero, con i parametri che gli passa Auth.js. */
async function jwt(arg: { token: JWT; user?: unknown; trigger?: "signIn" | "update"; session?: unknown }) {
  const cb = C.authConfig.callbacks!.jwt!;
  return cb({ token: arg.token, user: arg.user as never, account: null, trigger: arg.trigger, session: arg.session } as never);
}

/** Il token come lo crea l'accesso: passa da `jwt` con `user`. */
async function accesso(u: { id: number; role: string }, tenantCode: string | null): Promise<JWT> {
  const t = await jwt({ token: { sub: String(u.id) }, user: { id: String(u.id), role: u.role, tenants: [], tenantCode }, trigger: "signIn" });
  assert.ok(t);
  return t as JWT;
}

before(async () => {
  H = await import("../../db-hub");
  C = await import("../../auth.config");
  S = await import("../sessione");
  A = istanza("AAA01");
  B = istanza("BBB02");
});

test("dopo «Esci» il token d'accesso precedente non vale più, anche se rinnovato da una richiesta in ritardo", async () => {
  const u = utente("admin");
  const token = await accesso(u, A.code);
  assert.ok(await jwt({ token }), "prima dell'uscita il token vale");

  await C.authConfig.events!.signOut!({ token } as never);
  // La richiesta partita prima dell'uscita torna dopo: Auth.js richiama jwt col token vecchio.
  assert.equal(await jwt({ token }), null);
});

test("un accesso nuovo dopo l'uscita vale", async () => {
  const u = utente("admin");
  const vecchio = await accesso(u, A.code);
  await C.authConfig.events!.signOut!({ token: vecchio } as never);
  await new Promise((r) => setTimeout(r, 5));
  const nuovo = await accesso(u, A.code);
  assert.ok(await jwt({ token: nuovo }));
});

test("un utente con la sola istanza A non può passare a B né alla vista «tutte»", async () => {
  const u = utente("viewer");
  H.setUserTenantAccess(u.id, A.id, "viewer");
  const token = await accesso(u, A.code);

  const suB = await jwt({ token: { ...token }, trigger: "update", session: { tenantCode: B.code } });
  assert.equal((suB as JWT).tenantCode, A.code);
  const tutte = await jwt({ token: { ...token }, trigger: "update", session: { tenantCode: "__ALL__" } });
  assert.equal((tutte as JWT).tenantCode, A.code);
});

test("un'istanza che non esiste è rifiutata anche al superadmin", async () => {
  const u = utente("superadmin");
  const token = await accesso(u, "__ALL__");
  const t = await jwt({ token: { ...token }, trigger: "update", session: { tenantCode: "ZZZ99" } });
  assert.equal((t as JWT).tenantCode, "__ALL__");
});

test("l'istanza scelta si ricorda e all'accesso successivo si riparte da lì", async () => {
  const u = utente("viewer");
  H.setUserTenantAccess(u.id, A.id, "viewer");
  H.setUserTenantAccess(u.id, B.id, "viewer");
  const token = await accesso(u, null);
  const t = await jwt({ token: { ...token }, trigger: "update", session: { tenantCode: B.code } });
  assert.equal((t as JWT).tenantCode, B.code);

  const riga = H.getUserById(u.id)!;
  const lista = [{ code: A.code, name: "", role: "viewer" }, { code: B.code, name: "", role: "viewer" }];
  assert.equal(S.istanzaIniziale(riga, lista), B.code);
});

test("tolto l'accesso all'ultima istanza, si entra come prima", async () => {
  const u = utente("viewer");
  H.setUserTenantAccess(u.id, A.id, "viewer");
  H.setUserTenantAccess(u.id, B.id, "viewer");
  S.segnaUltimaIstanza(u.id, B.code);
  H.removeUserTenantAccess(u.id, B.id);
  const riga = H.getUserById(u.id)!;
  assert.equal(S.istanzaIniziale(riga, [{ code: A.code, name: "", role: "viewer" }]), A.code, "una sola istanza: quella");

  const s = utente("superadmin");
  S.segnaUltimaIstanza(s.id, "ZZZ99");
  const lista = [{ code: A.code, name: "", role: "superadmin" }, { code: B.code, name: "", role: "superadmin" }];
  assert.equal(S.istanzaIniziale(H.getUserById(s.id)!, lista), "__ALL__", "superadmin mai scelto o istanza sparita: vista «tutte»");
  S.segnaUltimaIstanza(s.id, B.code);
  assert.equal(S.istanzaIniziale(H.getUserById(s.id)!, lista), B.code);
});

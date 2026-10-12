/**
 * INVARIANTE (UI-18): ogni rotta /api/users* è un guscio che chiede
 * `requireAdmin()` e poi passa la sessione al servizio `src/lib/users/service.ts`.
 *
 * Perché: le regole su chi gestisce quali utenti (superadmin tutto, admin solo
 * i suoi clienti e mai un superadmin, viewer niente) stanno in
 * `permissions.ts` e le applica il servizio, provato con sessioni simulate in
 * `service.test.ts`. Le rotte vere non si possono chiamare in una prova (la
 * sessione di NextAuth esiste solo dentro una richiesta di Next): se una rotta
 * scrivesse sul database da sola, o tornasse a `requireSuperAdmin`, nessuna
 * prova se ne accorgerebbe. Questa lo legge dal sorgente.
 *
 * Una rotta nuova sotto /api/users (o un metodo nuovo) fa fallire la prova
 * finché non la si aggiunge qui sotto, con la funzione del servizio che usa.
 *
 * Run: node --import tsx --test src/lib/users/__tests__/routes-use-service.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const USERS_API = path.join(process.cwd(), "src", "app", "api", "users");

/** Rotta (relativa a /api/users) → metodo → funzione del servizio. */
const EXPECTED: Record<string, Record<string, string>> = {
  "route.ts": { GET: "listUsersAs", POST: "createUserAs" },
  "[id]/route.ts": { PUT: "updateUserAs", DELETE: "deleteUserAs" },
  "[id]/reset-password/route.ts": { POST: "resetPasswordAs" },
};

/** Funzioni del database che scrivono o leggono utenti: solo il servizio le usa. */
const DB_USER_FUNCTIONS = [
  "getUsers",
  "getUserById",
  "getUserByUsername",
  "createUser",
  "updateUserRole",
  "updateUserPassword",
  "deleteUser",
  "getUserTenantAccess",
  "setUserTenantAccess",
  "removeUserTenantAccess",
];

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Corpo di ogni `export async function METODO(...)`, fino al successivo export. */
function handlers(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  const starts: Array<{ method: string; index: number }> = [];
  for (let m = re.exec(src); m; m = re.exec(src)) starts.push({ method: m[1], index: m.index });
  starts.forEach((s, i) => out.set(s.method, src.slice(s.index, starts[i + 1]?.index ?? src.length)));
  return out;
}

test("le rotte utenti sono esattamente quelle censite", () => {
  const found = routeFiles(USERS_API)
    .map((f) => path.relative(USERS_API, f).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(found, Object.keys(EXPECTED).sort());
});

for (const [rel, methods] of Object.entries(EXPECTED)) {
  test(`/api/users/${rel}: requireAdmin per primo, poi il servizio`, () => {
    const src = stripComments(fs.readFileSync(path.join(USERS_API, rel), "utf8"));

    assert.ok(!/requireSuperAdmin/.test(src), "usa ancora requireSuperAdmin");
    assert.match(src, /from\s+["']@\/lib\/users\/service["']/, "non importa il servizio utenti");
    assert.ok(
      !/from\s+["']@\/lib\/(db|db-hub)["']/.test(src),
      "importa il database: le letture e le scritture sugli utenti passano dal servizio",
    );
    for (const fn of DB_USER_FUNCTIONS) {
      assert.ok(!new RegExp(`\\b${fn}\\s*\\(`).test(src), `chiama ${fn}() senza passare dal servizio`);
    }

    const found = handlers(src);
    assert.deepEqual([...found.keys()].sort(), Object.keys(methods).sort(), "metodi esportati diversi da quelli censiti");

    for (const [method, serviceFn] of Object.entries(methods)) {
      const body = found.get(method) ?? "";
      const firstAwait = /await\s+([A-Za-z_$][\w$]*)\s*\(/.exec(body);
      assert.equal(firstAwait?.[1], "requireAdmin", `${method}: la prima cosa non è requireAdmin()`);
      const call = new RegExp(`\\b${serviceFn}\\s*\\(\\s*([A-Za-z_$][\\w$]*)`).exec(body);
      assert.ok(call, `${method}: non chiama ${serviceFn}()`);
      // la sessione passata al servizio è quella restituita da requireAdmin
      const sessionVar = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+requireAdmin\s*\(/.exec(body)?.[1];
      assert.ok(sessionVar, `${method}: il risultato di requireAdmin() non è assegnato`);
      assert.equal(call[1], sessionVar, `${method}: ${serviceFn}() non riceve la sessione di requireAdmin()`);
      assert.match(
        body,
        new RegExp(`if\\s*\\(\\s*isAuthError\\(\\s*${sessionVar}\\s*\\)\\s*\\)\\s*return\\s+${sessionVar}`),
        `${method}: manca il ritorno anticipato su isAuthError`,
      );
    }
  });
}

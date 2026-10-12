/**
 * INVARIANTE (T3-24): le letture delle credenziali aperte anche a chi non è
 * admin non restituiscono campi cifrati. È la prova a cui rimandano le
 * eccezioni «mascherate» di src/lib/permessi/rotte.ts.
 *
 * Due forme:
 * - le rotte che rispondono con `{ ...riga, campo_cifrato: maschera }` devono
 *   sovrascrivere **ogni** colonna cifrata della tabella: una colonna cifrata
 *   nuova, aggiunta allo schema e non mascherata, passerebbe dallo spread;
 * - le rotte che restituiscono solo associazioni leggono da query che non
 *   prendono colonne cifrate né `c.*` della tabella delle credenziali.
 *
 * Le rotte vere non si chiamano in una prova (la sessione di NextAuth esiste
 * solo dentro una richiesta di Next): la prova legge il sorgente con l'albero
 * sintattico. Le funzioni del database stanno ancora in due copie (NUC-2): si
 * controllano tutte e due.
 *
 * Run: node --import tsx --test src/lib/permessi/__tests__/letture-mascherate.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const RADICE = process.cwd();
const leggi = (rel: string) => readFileSync(join(RADICE, rel), "utf8");

/** Colonne il cui nome dice «cifrato», da CREATE TABLE e ALTER TABLE … ADD COLUMN. */
function colonneCifrate(schema: string, tabella: string): string[] {
  const out = new Set<string>();
  const crea = new RegExp(`CREATE TABLE IF NOT EXISTS ${tabella} \\(([\\s\\S]*?)\\n\\);`).exec(schema);
  if (crea) {
    for (const riga of crea[1].split("\n")) {
      const m = /^\s*(\w*encrypted\w*)\s+\w+/i.exec(riga);
      if (m) out.add(m[1]);
    }
  }
  for (const m of schema.matchAll(new RegExp(`ALTER TABLE ${tabella} ADD COLUMN (\\w*encrypted\\w*)`, "gi"))) out.add(m[1]);
  return [...out].sort();
}

const eMaschera = (n: ts.Expression): boolean =>
  n.kind === ts.SyntaxKind.NullKeyword ||
  (ts.isConditionalExpression(n) &&
    ts.isStringLiteral(n.whenTrue) &&
    /^●+$/.test(n.whenTrue.text) &&
    n.whenFalse.kind === ts.SyntaxKind.NullKeyword);

/**
 * Per ogni oggetto con uno spread dentro il GET: le colonne cifrate che non
 * sovrascrive con la maschera. Vuoto = tutto mascherato.
 */
function colonneNonMascherate(sorgente: string, cifrate: string[]): string[][] {
  const sf = ts.createSourceFile("route.ts", sorgente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const get = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "GET");
  assert.ok(get?.body, "GET non trovato");
  const risultati: string[][] = [];
  const visita = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n) && n.properties.some(ts.isSpreadAssignment)) {
      const mascherate = new Set(
        n.properties
          .filter((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && eMaschera(p.initializer))
          .map((p) => p.name.getText(sf)),
      );
      // Uno spread condizionale di soli campi in chiaro (`...(x ? { username } : {})`)
      // non è la riga del database: si guarda l'oggetto che ne contiene il primo.
      risultati.push(cifrate.filter((c) => !mascherate.has(c)));
    }
    ts.forEachChild(n, visita);
  };
  visita(get.body);
  assert.ok(risultati.length > 0, "nessun oggetto con spread nel GET: la prova non sa più cosa guardare");
  return risultati;
}

/** Il testo SQL della funzione `nome` in un file, o null se il file non la definisce. */
function sqlDellaFunzione(sorgente: string, nome: string): string | null {
  const i = sorgente.indexOf(`export function ${nome}(`);
  if (i < 0) return null;
  const fine = sorgente.indexOf("\nexport ", i + 1);
  return sorgente.slice(i, fine < 0 ? undefined : fine);
}

const SCHEMA = leggi("src/lib/db-tenant-schema.ts");

test("schema: le colonne cifrate delle credenziali si leggono (se cambiano, la prova si rilegge)", () => {
  assert.deepEqual(colonneCifrate(SCHEMA, "credentials"), [
    "encrypted_auth_key",
    "encrypted_password",
    "encrypted_priv_key",
    "encrypted_username",
  ]);
  assert.deepEqual(colonneCifrate(SCHEMA, "device_credential_bindings"), ["inline_encrypted_password"]);
});

test("controllo: un oggetto con spread che dimentica una colonna cifrata viene segnalato", () => {
  const finto = `
export async function GET() {
  const rows = getAllCredentials();
  return Response.json(rows.map((c) => ({
    ...c,
    encrypted_username: c.encrypted_username ? "●●●●●●●●" : null,
    encrypted_password: c.encrypted_password ? "●●●●●●●●" : null,
  })));
}
`;
  assert.deepEqual(colonneNonMascherate(finto, colonneCifrate(SCHEMA, "credentials")), [
    ["encrypted_auth_key", "encrypted_priv_key"],
  ]);
});

const MASCHERATE: Array<{ rotta: string; tabella: string }> = [
  { rotta: "src/app/api/credentials/route.ts", tabella: "credentials" },
  { rotta: "src/app/api/credentials/[id]/route.ts", tabella: "credentials" },
  { rotta: "src/app/api/devices/[id]/credentials/route.ts", tabella: "device_credential_bindings" },
];

for (const { rotta, tabella } of MASCHERATE) {
  test(`GET ${rotta}: ogni colonna cifrata di ${tabella} è mascherata`, () => {
    const cifrate = colonneCifrate(SCHEMA, tabella);
    for (const mancanti of colonneNonMascherate(leggi(rotta), cifrate)) {
      assert.deepEqual(mancanti, [], `${rotta}: colonne cifrate restituite senza maschera`);
    }
  });
}

test("controllo: una query che prende c.* o una colonna cifrata viene segnalata", () => {
  const finto = "export function getX(id: number) {\n  return db().prepare(`SELECT hc.*, c.* FROM host_credentials hc JOIN credentials c ON c.id = hc.credential_id`).all(id);\n}\n";
  const sql = sqlDellaFunzione(finto, "getX");
  assert.ok(sql && /\bc\.\*|encrypted/i.test(sql));
});

const ASSOCIAZIONI: Array<{ rotta: string; funzioni: string[] }> = [
  { rotta: "src/app/api/hosts/[id]/credentials/route.ts", funzioni: ["getHostCredentials"] },
  { rotta: "src/app/api/networks/[id]/credentials/route.ts", funzioni: ["getNetworkCredentials", "getNetworksWithCredentials"] },
  { rotta: "src/app/api/devices/[id]/credentials/route.ts", funzioni: ["getDeviceCredentialBindings"] },
];

for (const { rotta, funzioni } of ASSOCIAZIONI) {
  test(`GET ${rotta}: le query non leggono campi cifrati delle credenziali`, () => {
    assert.ok(existsSync(join(RADICE, rotta)));
    for (const nome of funzioni) {
      const copie = ["src/lib/db.ts", "src/lib/db-tenant.ts"]
        .map((f) => [f, sqlDellaFunzione(leggi(f), nome)] as const)
        .filter(([, sql]) => sql !== null);
      assert.ok(copie.length > 0, `${nome} non trovata in db.ts né in db-tenant.ts`);
      for (const [file, sql] of copie) {
        assert.doesNotMatch(sql!, /\bc\.\*/, `${file} ${nome}: legge tutte le colonne delle credenziali`);
        // La sola colonna cifrata ammessa è quella della tabella delle
        // associazioni stesse, mascherata nella rotta (prova sopra).
        const cifrateLette = (sql!.match(/\b\w*encrypted\w*\b/gi) ?? []).filter((c) => c !== "inline_encrypted_password");
        assert.deepEqual(cifrateLette, [], `${file} ${nome}: legge colonne cifrate`);
      }
    }
  });
}

/**
 * INVARIANTE (tappa 2 credenziali, T13, 16/10): nell'archivio delle
 * credenziali si scrive una voce nuova solo dal CRUD
 * (`src/lib/credentials/archivio.ts`, usato dalle due gemelle
 * `createCredential`) e dalle conversioni dei dati
 * (`src/lib/credentials/{normalizza,converti}-*.ts`).
 *
 * Perché: dalla 2c la tabella non ha più il CHECK sui tipi (ADR 0017), e la
 * validazione sta solo in `tipi.ts` e nel CRUD. Un `INSERT INTO credentials`
 * scritto altrove scriverebbe un tipo sconosciuto o una «linux» senza che
 * niente lo fermi, e il motore poi scarterebbe la voce in silenzio.
 *
 * Run: node --import tsx --test src/lib/__tests__/insert-credentials-solo-crud.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const RADICE = process.cwd();
const CARTELLE = ["src", "scripts"];

/** `INSERT [OR …] INTO credentials` e `REPLACE INTO credentials`, col nome fra virgolette o no. */
const SCRITTURA = /\b(?:insert(?:\s+or\s+\w+)?|replace)\s+into\s+["`'[]?credentials["`'\]]?(?![\w])/i;

const AMMESSI = [/^src\/lib\/credentials\/archivio\.ts$/, /^src\/lib\/credentials\/(?:normalizza|converti)-[\w-]+\.ts$/];

function sorgenti(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const pieno = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === "__tests__") continue;
      out.push(...sorgenti(pieno));
    } else if (/\.(?:tsx?|mjs|cjs|js)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(pieno);
    }
  }
  return out;
}

test("controllo: la regola riconosce le forme di scrittura e non i nomi simili", () => {
  for (const s of [
    "INSERT INTO credentials (name) VALUES (?)",
    "insert or ignore into credentials (id) values (1)",
    'INSERT INTO "credentials" (name) VALUES (?)',
    "REPLACE INTO credentials (id) VALUES (1)",
    "INSERT OR REPLACE INTO `credentials` (id) VALUES (1)",
  ]) {
    assert.match(s, SCRITTURA, s);
  }
  for (const s of ["INSERT INTO credentials_nuova (id) SELECT id FROM credentials", "INSERT INTO host_credentials (id) VALUES (1)", "SELECT * FROM credentials"]) {
    assert.doesNotMatch(s, SCRITTURA, s);
  }
});

test("nessun INSERT INTO credentials fuori dal CRUD e dalle conversioni", () => {
  const fuori: string[] = [];
  for (const cartella of CARTELLE) {
    for (const f of sorgenti(path.join(RADICE, cartella))) {
      const rel = path.relative(RADICE, f).split(path.sep).join("/");
      if (AMMESSI.some((a) => a.test(rel))) continue;
      fs.readFileSync(f, "utf8")
        .split("\n")
        .forEach((riga, i) => {
          if (SCRITTURA.test(riga)) fuori.push(`${rel}:${i + 1}`);
        });
    }
  }
  assert.deepEqual(fuori, [], `scritture dirette nell'archivio fuori dal CRUD:\n${fuori.join("\n")}`);
});

test("il CRUD esiste ed è lui a scrivere", () => {
  const crud = fs.readFileSync(path.join(RADICE, "src/lib/credentials/archivio.ts"), "utf8");
  assert.match(crud, SCRITTURA);
});

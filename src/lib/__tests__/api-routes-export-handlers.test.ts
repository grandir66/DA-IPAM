/**
 * Ogni file di rotta sotto src/app/api esporta almeno un metodo HTTP, e le rotte
 * che l'interfaccia chiama con un metodo preciso esportano quel metodo.
 *
 * Perché (2026-10-12, tappa 1): risolvendo un conflitto, un'espressione regolare
 * troppo larga ha ridotto src/app/api/system/update/route.ts a 28 righe di
 * commento. type-check, 1.266 prove e build sono passati lo stesso — un file di
 * rotta senza export è valido — e l'errore si è visto solo a schermo (405 su
 * GET /api/system/update). Questa prova lo ferma prima.
 *
 * Run:  node --import tsx --test src/lib/__tests__/api-routes-export-handlers.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const API = path.join(process.cwd(), "src", "app", "api");
const METODI = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";
const EXPORT_METODO = new RegExp(
  // function GET · const GET = · export { GET } · const { GET, POST } = handlers (NextAuth)
  `export\\s+(?:async\\s+)?function\\s+(${METODI})\\b|export\\s+const\\s+(${METODI})\\s*=|export\\s*(?:const\\s*)?\\{[^}]*\\b(${METODI})\\b`,
  "g",
);

function rotte(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...rotte(p));
    else if (e.name === "route.ts") out.push(p);
  }
  return out;
}

function metodiEsportati(file: string): Set<string> {
  const src = fs.readFileSync(file, "utf8");
  const trovati = new Set<string>();
  for (const m of src.matchAll(EXPORT_METODO)) trovati.add(m[1] ?? m[2] ?? m[3]);
  return trovati;
}

test("ogni rotta API esporta almeno un metodo HTTP", () => {
  const files = rotte(API);
  assert.ok(files.length > 100, `rotte trovate: ${files.length}`);
  const vuote = files.filter((f) => metodiEsportati(f).size === 0).map((f) => path.relative(API, f));
  assert.deepEqual(vuote, [], `rotte senza metodi esportati: ${vuote.join(", ")}`);
});

// Rotte che l'interfaccia chiama con un metodo preciso (chi le chiama, fra parentesi).
const ATTESI: Array<{ rotta: string; metodi: string[] }> = [
  // update-checker.tsx (GET, controllo versione) e updates-tab.tsx (POST, Aggiorna/Riavvia)
  { rotta: "system/update/route.ts", metodi: ["GET", "POST"] },
];

for (const { rotta, metodi } of ATTESI) {
  test(`/api/${rotta.replace(/\/route\.ts$/, "")} esporta ${metodi.join(" e ")}`, () => {
    const presenti = metodiEsportati(path.join(API, rotta));
    for (const m of metodi) assert.ok(presenti.has(m), `manca ${m} in ${rotta}`);
  });
}

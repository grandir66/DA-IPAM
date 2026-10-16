/**
 * Test anti-drift — createNetwork deve seminare i job default in ENTRAMBE le copie
 * (`db.ts` facade + `db-tenant.ts` sorgente). Fix 2026-07-20: la copia db.ts aveva
 * perso `seedDefaultJobsForNetwork` → reti create via API senza monitoring default.
 * Questo test impedisce che il drift si ripresenti finché le due copie coesistono.
 * Run: node --import tsx --test src/lib/__tests__/db-createnetwork-drift.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

/** Estrae il corpo di `export function <name>(` fino al prossimo `export function`. */
function functionBody(file: string, name: string): string {
  const src = readFileSync(join(ROOT, file), "utf8");
  const start = src.search(new RegExp(`export function ${name}\\b`));
  assert.ok(start >= 0, `${name} non trovata in ${file}`);
  const rest = src.slice(start + 1);
  const nextRel = rest.search(/\nexport function \w/);
  return src.slice(start, nextRel < 0 ? src.length : start + 1 + nextRel);
}

for (const file of ["src/lib/db.ts", "src/lib/db-tenant.ts"]) {
  test(`${file} createNetwork semina i job default`, () => {
    const body = functionBody(file, "createNetwork");
    assert.match(
      body,
      /seedDefaultJobsForNetwork\s*\(/,
      `createNetwork in ${file} deve chiamare seedDefaultJobsForNetwork() — drift: la rete non riceverebbe il job di monitoring default`,
    );
  });
}

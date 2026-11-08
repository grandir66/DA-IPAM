/**
 * Tipo d'installazione da `DA_PROFILO` (ADR 0037, piano 2026-11-08-installazione-tecnico, Task 1).
 *
 * È la prova di equivalenza dell'interruttore «tecnico»: senza variabile il profilo è
 * `installazione`, e nessun file fuori da `src/lib/profilo.ts` legge `DA_PROFILO`. Finché
 * nessuno legge la variabile, nessun comportamento delle installazioni di oggi può cambiare.
 * Un valore sconosciuto (anche `centrale`, finché non lo aggiunge il Task 7 del piano 07/11)
 * non diventa in silenzio un profilo: l'app non parte.
 *
 * Run: node --import tsx --test src/lib/__tests__/profilo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { leggiProfilo, PROFILI } from "@/lib/profilo";

test("senza variabile, vuota o di soli spazi: installazione", () => {
  assert.deepEqual(leggiProfilo({}), { ok: true, profilo: "installazione" });
  assert.deepEqual(leggiProfilo({ DA_PROFILO: "" }), { ok: true, profilo: "installazione" });
  assert.deepEqual(leggiProfilo({ DA_PROFILO: "   " }), { ok: true, profilo: "installazione" });
});

test("valori ammessi", () => {
  assert.deepEqual(leggiProfilo({ DA_PROFILO: "tecnico" }), { ok: true, profilo: "tecnico" });
  assert.deepEqual(leggiProfilo({ DA_PROFILO: " tecnico\n" }), { ok: true, profilo: "tecnico" });
  assert.deepEqual(leggiProfilo({ DA_PROFILO: "installazione" }), { ok: true, profilo: "installazione" });
  assert.deepEqual([...PROFILI], ["installazione", "tecnico"]);
});

test("valore sconosciuto: non è un profilo", () => {
  for (const v of ["centrale", "TECNICO", "Tecnico", "pippo", "1"]) {
    assert.deepEqual(leggiProfilo({ DA_PROFILO: v }), { ok: false, letto: v.trim() }, v);
  }
});

function file(dir: string): string[] {
  const out: string[] = [];
  for (const voce of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, voce.name);
    if (voce.isDirectory()) {
      if (voce.name === "node_modules" || voce.name === "__tests__") continue;
      out.push(...file(p));
    } else if (/\.(ts|tsx|js|mjs)$/.test(voce.name)) {
      out.push(p);
    }
  }
  return out;
}

test("equivalenza: DA_PROFILO si legge solo in src/lib/profilo.ts", () => {
  const radice = process.cwd();
  const candidati = [...file(path.join(radice, "src")), path.join(radice, "server.ts")];
  const lettori = candidati
    .filter((f) => fs.readFileSync(f, "utf8").includes("DA_PROFILO"))
    .map((f) => path.relative(radice, f));
  assert.deepEqual(lettori, [path.join("src", "lib", "profilo.ts")]);
});

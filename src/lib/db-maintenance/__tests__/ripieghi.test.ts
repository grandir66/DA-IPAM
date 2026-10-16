// Firma del chiamante nel registro dei ripieghi (NUC-1, fase A).
//
// REVISIONE 2026-10-12: in produzione rotte e pagine girano dal build di Next
// (`.next/server/chunks/*.js`, minificato): nessun frame si chiama `db.ts`, i
// nomi delle funzioni sono di una lettera. La firma ricavata «dal primo frame
// fuori da db.ts» diventava la stessa per tutte le rotte, e dopo una settimana
// il registro avrebbe detto «N ripieghi» senza dire chi li fa. Gli stack qui
// sotto hanno la forma del build (chunk, riga 1, colonna).
import { TEST_DATA_DIR } from "../../__tests__/support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { firmaDa, registraRipiego, riepilogoPerRuolo, DIR_REGISTRO_RIPIEGHI, MAX_RIGHE_ORA } from "../ripieghi";

after(() => fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true }));

const LIB = "/opt/da-invent/.next/server/chunks/src_lib_22e32b39._.js";
const NEXT = "/opt/da-invent/.next/server/chunks/node_modules_next_dist_esm_build_templates_app-route_4f5e6d7c.js";

/** Stack come arriva a firmaDa: dal chiamante di registraRipiego (getDb) in giù. */
function stackBuild(rotta: string, colonna: number): string[] {
  return [
    `at I (${LIB}:1:48211)`,
    `at u (${LIB}:1:91877)`,
    `at GET (/opt/da-invent/.next/server/chunks/${rotta}:1:${colonna})`,
    `at async a (${NEXT}:1:9012)`,
    `at async Object.handle (${NEXT}:1:15530)`,
  ];
}

test("build di Next: due rotte che passano dalla stessa funzione hanno firme diverse", () => {
  const uno = firmaDa(stackBuild("[root-of-the-server]__0a1b2c3d._.js", 2210));
  const due = firmaDa(stackBuild("[root-of-the-server]__9f8e7d6c._.js", 771));
  assert.notEqual(uno, due);
  assert.match(uno, /0a1b2c3d\._\.js:1:2210/);
  assert.match(due, /9f8e7d6c\._\.js:1:771/);
});

test("build di Next: stessa rotta, colonne diverse nello stesso chunk → firme diverse", () => {
  const uno = firmaDa(stackBuild("[root-of-the-server]__0a1b2c3d._.js", 2210));
  const due = firmaDa(stackBuild("[root-of-the-server]__0a1b2c3d._.js", 5120));
  assert.notEqual(uno, due);
});

test("sorgenti (tsx: scheduler, script): firma leggibile con file, riga e colonna", () => {
  const firma = firmaDa([
    "at getDb (/opt/da-invent/src/lib/db.ts:150:20)",
    "at getHosts (/opt/da-invent/src/lib/db.ts:880:10)",
    "at runJob (/opt/da-invent/src/lib/cron/scheduler.ts:123:45)",
    "at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
  ]);
  assert.equal(firma, "runJob @ src/lib/cron/scheduler.ts:123:45");
});

test("chiamante nuovo oltre il tetto orario: la sua riga di stack si scrive lo stesso", () => {
  // Tetto dell'ora già raggiunto, come dopo un'ora con molte firme.
  registraRipiego("legacy"); // crea lo stato del registro
  const stato = (globalThis as unknown as Record<symbol, { oraCorrente: string; righeOra: number }>)[
    Symbol.for("da-ipam.db-maintenance.ripieghi")
  ];
  stato.oraCorrente = new Date().toISOString().slice(0, 13);
  stato.righeOra = MAX_RIGHE_ORA;

  (function chiamanteNuovoOltreIlTetto() {
    registraRipiego("default", "DEFAULT");
  })();
  (function chiamanteNuovoOltreIlTetto2() {
    registraRipiego("default", "DEFAULT");
  })();

  const righe: Array<Record<string, unknown>> = [];
  for (const f of fs.readdirSync(DIR_REGISTRO_RIPIEGHI())) {
    for (const r of fs.readFileSync(path.join(DIR_REGISTRO_RIPIEGHI(), f), "utf8").split("\n")) {
      if (r.trim()) righe.push(JSON.parse(r) as Record<string, unknown>);
    }
  }
  const stackNuovi = righe.filter((r) => r.tipo === "stack" && r.caso === "default");
  assert.equal(stackNuovi.length, 2, "lo stack dei chiamanti comparsi oltre il tetto è andato perso");
  assert.ok(righe.some((r) => r.tipo === "limite"), "il tetto dell'ora va comunque segnalato");
});

test("il dettaglio dei ripieghi (firme, codici di tutti i tenant) va solo al superadmin", () => {
  registraRipiego("tenant_non_registrato", "ALTROCLIENTE");
  // È lo stato dell'intero processo, non del tenant della sessione: un admin o
  // un viewer di un tenant non deve leggere i codici degli altri.
  for (const ruolo of ["viewer", "operator", "admin", undefined]) {
    assert.equal(riepilogoPerRuolo(ruolo), undefined, `dettaglio esposto al ruolo ${String(ruolo)}`);
  }
  const dettaglio = riepilogoPerRuolo("superadmin");
  assert.ok(dettaglio?.chiamanti.some((c) => c.tenant === "ALTROCLIENTE"));
});

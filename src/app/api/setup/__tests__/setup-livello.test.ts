import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SetupSchema } from "@/lib/validators";

/**
 * Tappa C1 NetBird/DA-Link (spec §5.3, §12): al `/setup` si chiede cosa esce verso
 * Domarc. La domanda è facoltativa e **senza valore preselezionato**: chi non
 * risponde non dichiara niente, e vale «solo stato». La rotta accetta lo stesso
 * campo da Deploy-Appliance (tappa G1).
 */
const pw = "p".repeat(12);
const base = { username: "admin", password: pw, confirm_password: pw, codice_cliente: "99999", ragione_sociale: "Prova" };

test("senza livello lo schema passa e il livello resta non dichiarato", () => {
  const r = SetupSchema.safeParse(base);
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.livello_uscita, undefined);
});

test("i due livelli ammessi passano", () => {
  for (const livello_uscita of ["solo_stato", "stato_inventario"]) {
    const r = SetupSchema.safeParse({ ...base, livello_uscita });
    assert.equal(r.success, true, livello_uscita);
    if (r.success) assert.equal(r.data.livello_uscita, livello_uscita);
  }
});

test("un livello non ammesso si rifiuta", () => {
  assert.equal(SetupSchema.safeParse({ ...base, livello_uscita: "tutto" }).success, false);
});

test("la pagina di setup chiede il livello senza preselezionarlo", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/app/setup/page.tsx"), "utf8");
  assert.match(src, /livello_uscita/, "la pagina non manda il livello");
  assert.match(src, /useState<Livello \| null>\(null\)/, "il livello deve partire da null (nessuna scelta)");
  assert.doesNotMatch(src, /defaultChecked/, "nessuna scelta preselezionata");
});

test("la rotta di setup registra il livello solo se dichiarato", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/setup/route.ts"), "utf8");
  assert.match(src, /if \(livello_uscita\)/);
  assert.match(src, /impostaLivello\(livello_uscita,/);
});

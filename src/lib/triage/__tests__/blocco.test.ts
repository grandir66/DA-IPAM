process.env.ENCRYPTION_KEY ||= "test-encryption-key-triage-blocco";

/**
 * `setTriageStatoBlocco` (10/11/2026): il triage in blocco dall'Elenco di Findings. Cambia lo stato
 * su più chiavi in una transazione, **preserva la nota** di ciascuna, e rispetta la regola
 * «da_fare + nota vuota = la riga si cancella» (così «N di M rivisti» resta vero).
 *
 * Run: node --import tsx --test src/lib/triage/__tests__/blocco.test.ts
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { setTriageStatoBlocco, setTriage, getTriage } from "@/lib/triage/db";

const T = "TESTTRIAGEBLOCCO";
after(() => deleteTenantDatabase(T));

test("blocco: stesso stato su più chiavi, nota preservata; da_fare vuoto cancella", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    setTriage(d, "a", "in_corso", "nota A", "u"); // ha una nota
    // "b" e "c" non hanno ancora una riga di triage

    setTriageStatoBlocco(d, ["a", "b", "c"], "fatto", "op");
    let m = getTriage(d, ["a", "b", "c"]);
    assert.equal(m.a.stato, "fatto");
    assert.equal(m.a.nota, "nota A", "il blocco cambia lo stato, non la nota");
    assert.equal(m.b.stato, "fatto");
    assert.equal(m.b.nota, "", "riga nuova: nessuna nota");
    assert.equal(m.c.stato, "fatto");
    assert.equal(m.c.aggiornato_da, "op");

    // Riportare a da_fare in blocco: "a" (con nota) resta, "b" (nota vuota) sparisce.
    setTriageStatoBlocco(d, ["a", "b"], "da_fare", "op");
    m = getTriage(d, ["a", "b"]);
    assert.equal(m.a?.stato, "da_fare");
    assert.equal(m.a?.nota, "nota A");
    assert.equal(m.b, undefined, "da_fare + nota vuota = riga cancellata");
  }));

test("blocco vuoto: nessun errore, niente da fare", () =>
  withTenant(T, () => {
    const d = getTenantDb(T);
    assert.doesNotThrow(() => setTriageStatoBlocco(d, [], "fatto", "op"));
  }));

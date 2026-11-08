/**
 * Gli ammessi: gli unici IP che Edge tocca su una rete non pubblica (72729, 06/11/2026). Il via è di una
 * persona: niente conferme, elenco vuoto, e la sonda non parte.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/vuln/proposta/__tests__/ammessi.test.ts
 */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, closeTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { ammessiDaMandare } from "@/lib/vuln/edge-credenziali-esito";
import { ipAmmessiDellaRete } from "@/lib/vuln/proposta/ammessi";
import { confermaProposte, rigeneraProposte } from "@/lib/vuln/proposta/store";

const T = "AMMESSI06";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

// Regola rovesciata da Riccardo l'08/11/2026 (tavola 40-44): prima entrava solo chi era confermato; ora entrano
// tutti tranne gli impianti, e chi una persona esclude. Il marcatempo del 72729 (campo) resta fuori in ogni caso.
test("di serie tutti dentro tranne gli impianti; chi è escluso a mano esce; un impianto non entra nemmeno confermato", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.6.0.0/24', 'x')").run().lastInsertRowid);
    const h = d.prepare("INSERT INTO hosts (network_id, ip, status, classification, vendor, open_ports) VALUES (?, ?, 'online', ?, ?, ?)");
    const pc = Number(h.run(n, "10.6.0.1", "workstation", "HP Inc.", JSON.stringify([{ port: 445 }])).lastInsertRowid);
    const altro = Number(h.run(n, "10.6.0.2", "workstation", "HP Inc.", JSON.stringify([{ port: 445 }])).lastInsertRowid);
    const marcatempo = Number(h.run(n, "10.6.0.41", "unknown", "Kronotech Srl", JSON.stringify([{ port: 3000 }])).lastInsertRowid);
    const ignoto = Number(h.run(n, "10.6.0.50", "unknown", null, null).lastInsertRowid);
    rigeneraProposte(n);
    const ordinati = () => [...ipAmmessiDellaRete(n)].sort();

    assert.deepEqual(ordinati(), ["10.6.0.1", "10.6.0.2", "10.6.0.50"], "di serie tutti, tranne l'impianto");
    confermaProposte(n, { hostIds: [marcatempo], stato: "confermato", chi: "prova" });
    confermaProposte(n, { hostIds: [altro], stato: "escluso", chi: "prova", nota: "server in manutenzione" });
    assert.deepEqual(ordinati(), ["10.6.0.1", "10.6.0.50"]);
    assert.ok(pc > 0 && ignoto > 0);
  });
});

test("un host confermato che diventa impianto esce dall'elenco", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.7.0.0/24', 'x')").run().lastInsertRowid);
    const pc = Number(d.prepare("INSERT INTO hosts (network_id, ip, status, classification, open_ports) VALUES (?, '10.7.0.1', 'online', 'workstation', ?)")
      .run(n, JSON.stringify([{ port: 445 }])).lastInsertRowid);
    rigeneraProposte(n);
    confermaProposte(n, { hostIds: [pc], stato: "confermato", chi: "prova" });
    assert.deepEqual(ipAmmessiDellaRete(n), ["10.7.0.1"]);
    d.prepare("UPDATE hosts SET classification = 'plc' WHERE id = ?").run(pc);
    assert.deepEqual(ipAmmessiDellaRete(n), []);
  });
});

test("una conferma tolta arriva alla sonda; una sonda vecchia non si insegue a vuoto", () => {
  assert.equal(ammessiDaMandare(["10.6.0.1"], ["10.6.0.1"]), false);
  assert.equal(ammessiDaMandare(["10.6.0.1"], []), true);
  assert.equal(ammessiDaMandare([], ["10.6.0.1"]), true);
  assert.equal(ammessiDaMandare([], undefined), false);
  assert.equal(ammessiDaMandare(["10.6.0.1"], undefined), true);
});

/** Proposta per device (06/11/2026): la prova che conta è chi non riceve un profilo. */
import "@/lib/vuln/__tests__/support/dati-isolati";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { proponiProfilo } from "@/lib/vuln/proposta/regole";
import { confermaProposte, contiPropostePerRete, esitoRigenerazione, leggiProposte, riapriProposte, rigeneraProposte } from "@/lib/vuln/proposta/store";

const h = (x: Record<string, unknown>) => ({ network_id: 1, ip: "10.0.0.1", ...x });
const porte = (...p: number[]) => JSON.stringify(p.map((port) => ({ port, protocol: "tcp" })));

test("apparati di rete, Windows e Linux hanno un profilo completo", () => {
  assert.equal(proponiProfilo(h({ attr_category: "network.switch", attr_confidence_category: 90 })).famiglia, "rete");
  assert.equal(proponiProfilo(h({ classification: "router" })).famiglia, "rete");
  const w = proponiProfilo(h({ attr_category: "compute.workstation", attr_confidence_category: 80, attr_os_family: "windows" }));
  assert.deepEqual([w.famiglia, w.voce], ["windows", "bilanciato"]);
  assert.equal(proponiProfilo(h({ classification: "server_linux", open_ports: porte(22) })).famiglia, "linux");
  assert.equal(proponiProfilo(h({ classification: "server", open_ports: porte(445) })).famiglia, "windows");
  assert.equal(proponiProfilo(h({ attr_category: "compute.hypervisor", attr_confidence_category: 90 })).famiglia, "linux");
});

test("periferiche: profilo ridotto", () => {
  const p = proponiProfilo(h({ attr_category: "peripheral.printer", attr_confidence_category: 90 }));
  assert.deepEqual([p.famiglia, p.voce], ["periferiche", "veloce"]);
});

test("gli impianti non ricevono mai un profilo, nemmeno con una scelta manuale", () => {
  for (const x of [
    { classification: "plc" },
    { attr_category: "ot.drive", attr_confidence_category: 90 },
    { attr_category: "ot.gateway", attr_confidence_category: 30 },
    { vendor: "CREVIS Co., Ltd", classification: "workstation", classification_manual: 1 },
    { classification: "server", open_ports: porte(502, 445) },
    { classification: "iot" },
  ]) {
    const p = proponiProfilo(h(x));
    assert.equal(p.famiglia, "impianti", JSON.stringify(x));
    assert.equal(p.voce, null);
  }
});

test("nel dubbio si scende", () => {
  for (const x of [
    {},
    { classification: "unknown" },
    { attr_category: "compute.server", attr_confidence_category: 40 },
    { classification: "server" },
    { attr_category: "unknown", attr_confidence_category: 99 },
  ]) {
    const p = proponiProfilo(h(x));
    assert.equal(p.voce, null, JSON.stringify(x));
  }
  assert.equal(proponiProfilo(h({ classification: "router" }), { conteso: true }).famiglia, "da_chiarire");
});

test("una scelta manuale vince sul conteso, non sul freno", () => {
  assert.equal(proponiProfilo(h({ classification: "router", classification_manual: 1 }), { conteso: true }).famiglia, "rete");
});

test("i servizi web si segnano senza cambiare famiglia", () => {
  const p = proponiProfilo(h({ classification: "server_linux", open_ports: porte(22, 443) }));
  assert.deepEqual([p.famiglia, p.conWeb], ["linux", true]);
  assert.equal(proponiProfilo(h({ classification: "server", open_ports: porte(8080) })).famiglia, "web");
});

test("rigenerazione: la scelta di una persona non si tocca, salvo che diventi impianto", () => {
  const nuova = proponiProfilo(h({ classification: "plc" }));
  const rete = proponiProfilo(h({ classification: "router" }));
  assert.equal(esitoRigenerazione(undefined, rete), "scrivi");
  assert.equal(esitoRigenerazione({ host_id: 1, famiglia: "rete", stato: "proposto" }, rete), "scrivi");
  assert.equal(esitoRigenerazione({ host_id: 1, famiglia: "rete", stato: "confermato" }, rete), "lascia");
  assert.equal(esitoRigenerazione({ host_id: 1, famiglia: "windows", stato: "confermato" }, rete), "segna");
  assert.equal(esitoRigenerazione({ host_id: 1, famiglia: "rete", stato: "confermato" }, nuova), "scrivi");
});

const T = "TESTPROPOSTE";
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
});

test("sul database: salva, conferma, rifiuta l'impianto, e l'host diventato impianto perde la conferma", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const id = Number(d.prepare("INSERT INTO networks(name,cidr) VALUES('n','10.0.0.0/24')").run().lastInsertRowid);
    const ins = d.prepare("INSERT INTO hosts(network_id,ip,classification,status) VALUES(?,?,?,'online')");
    const sw = Number(ins.run(id, "10.0.0.1", "switch").lastInsertRowid);
    const plc = Number(ins.run(id, "10.0.0.2", "plc").lastInsertRowid);
    ins.run(id, "10.0.0.3", "unknown");
    assert.equal(rigeneraProposte(id).scritte, 3);
    const esito = confermaProposte(id, { hostIds: [sw, plc], stato: "confermato", chi: "prova" });
    assert.deepEqual(esito, { aggiornate: 1, rifiutate: [plc] });
    rigeneraProposte(id);
    assert.equal(leggiProposte(id).find((r) => r.host_id === sw)?.stato, "confermato");
    d.prepare("UPDATE hosts SET classification='plc' WHERE id=?").run(sw);
    rigeneraProposte(id);
    const r = leggiProposte(id).find((x) => x.host_id === sw);
    assert.deepEqual([r?.stato, r?.famiglia, r?.voce], ["proposto", "impianti", null]);
  });
});

test("«Prendi il nuovo tipo»: l'host da rivedere torna proposto nella famiglia giusta, senza la conferma vecchia", async () => {
  const T = "TESTRIAPRI06";
  try {
    await withTenant(T, async () => {
      const d = getTenantDb(T);
      const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.8.0.0/24', 'x')").run().lastInsertRowid);
      const h = d.prepare("INSERT INTO hosts (network_id, ip, status, classification) VALUES (?, ?, 'online', ?)");
      const uno = Number(h.run(rete, "10.8.0.1", "router").lastInsertRowid);
      const due = Number(h.run(rete, "10.8.0.2", "router").lastInsertRowid);
      const tre = Number(h.run(rete, "10.8.0.3", "router").lastInsertRowid);
      rigeneraProposte(rete);
      confermaProposte(rete, { hostIds: [uno, due, tre], stato: "confermato", chi: "prova" });
      d.prepare("UPDATE hosts SET classification = 'server_linux', open_ports = ? WHERE id = ?").run(porte(22), uno);
      assert.equal(rigeneraProposte(rete).daRivedere, 1);
      assert.deepEqual(contiPropostePerRete()[rete], { totale: 3, confermate: 2, daRivedere: 1 });
      // Riaprirne uno non deve rivalutare gli altri: il tre cambia tipo, ma nessuno ha chiesto di rileggerlo.
      d.prepare("UPDATE hosts SET classification = 'server_linux', open_ports = ? WHERE id = ?").run(porte(22), tre);

      assert.equal(riapriProposte(rete, [due]).riaperte, 0, "chi non è da rivedere non si tocca");
      assert.equal(riapriProposte(rete, [uno]).riaperte, 1);
      const r = leggiProposte(rete).find((x) => x.host_id === uno)!;
      assert.deepEqual([r.famiglia, r.stato, r.da_rivedere, r.confermata_da], ["linux", "proposto", 0, null]);
      assert.equal(leggiProposte(rete).find((x) => x.host_id === due)!.stato, "confermato");
      assert.equal(leggiProposte(rete).find((x) => x.host_id === tre)!.da_rivedere, 0);
      d.prepare("UPDATE hosts SET status = 'offline', classification = 'server_linux', open_ports = ? WHERE id = ?").run(porte(22), due);
      d.prepare("UPDATE va_proposte SET da_rivedere = 1 WHERE host_id = ?").run(due);
      assert.equal(riapriProposte(rete, [due]).riaperte, 0, "un host offline non si riapre: resterebbe nella famiglia vecchia");
    });
  } finally {
    try { deleteTenantDatabase(T); } catch { /* già tolto */ }
  }
});

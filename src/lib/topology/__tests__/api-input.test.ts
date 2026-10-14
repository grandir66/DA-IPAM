import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLinkOverrideBody, parseSiteTopologyBody, parseDeviceLocationBody, parseStaleDaysBody } from "@/lib/topology/api-input";

test("correzione: nodi nella forma dev:N / host:N, azione nota, porte facoltative", () => {
  assert.deepEqual(parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "host:2" }), {
    ok: true, data: { action: "add", a_node: "dev:1", a_port: "", b_node: "host:2", b_port: "", medium: null, note: null },
  });
  assert.equal(parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:1" }).ok, false, "un nodo con se stesso");
  assert.equal(parseLinkOverrideBody({ action: "sposta", a_node: "dev:1", b_node: "dev:2" }).ok, false);
  assert.equal(parseLinkOverrideBody({ action: "add", a_node: "ext:x", b_node: "dev:2" }).ok, false);
});

test("sede: testa e subnet facoltative, interi positivi", () => {
  assert.deepEqual(parseSiteTopologyBody({ head_device_id: null, network_ids: [1, 2] }), { ok: true, data: { headDeviceId: null, networkIds: [1, 2] } });
  assert.deepEqual(parseSiteTopologyBody({}), { ok: true, data: {} });
  assert.equal(parseSiteTopologyBody({ network_ids: [-1] }).ok, false);
});

test("sede dell'apparato e soglia", () => {
  assert.deepEqual(parseDeviceLocationBody({ location_id: null }), { ok: true, data: { locationId: null } });
  assert.equal(parseDeviceLocationBody({}).ok, false);
  assert.deepEqual(parseStaleDaysBody({ staleDays: 3 }), { ok: true, data: 3 });
  assert.equal(parseStaleDaysBody({ staleDays: 0 }).ok, false);
});

test("i rifiuti parlano italiano: nessun messaggio predefinito di Zod arriva all'admin", () => {
  const rifiuti = [
    parseLinkOverrideBody(null),
    parseLinkOverrideBody({ action: "sposta", a_node: "dev:1", b_node: "dev:2" }),
    parseLinkOverrideBody({ action: "add", a_node: 5, b_node: "dev:2" }),
    parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:2", a_port: "x".repeat(101) }),
    parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:2", note: "x".repeat(501) }),
    parseSiteTopologyBody(null),
    parseSiteTopologyBody({ head_device_id: "3" }),
    parseSiteTopologyBody({ network_ids: [-1] }),
    parseSiteTopologyBody({ network_ids: "1,2" }),
    parseDeviceLocationBody(null),
    parseDeviceLocationBody({}),
    parseDeviceLocationBody({ location_id: 1.5 }),
  ];
  for (const r of rifiuti) {
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.doesNotMatch(r.error, /Invalid|expected|Too (small|big)|received/, r.error);
  }
});

test("mappe: nome 1-80 caratteri, nodi dev:N/host:N, al massimo 2000 per colpo", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseMapCreateBody({ name: "  Sede  ", roots: ["dev:1"], nodes: ["dev:1", "host:2"] }), {
    ok: true, data: { name: "Sede", roots: ["dev:1"], nodes: ["dev:1", "host:2"] },
  });
  assert.deepEqual(m.parseMapCreateBody({ name: "x" }), { ok: true, data: { name: "x", roots: [], nodes: [] } });
  for (const bad of [{ name: "" }, { name: "   " }, { name: "a".repeat(81) }, { name: "x", nodes: ["ext:1"] }, { name: "x", roots: ["dev:x"] },
    { name: "x", nodes: Array.from({ length: 2001 }, (_, i) => `dev:${i + 1}`) }]) {
    const r = m.parseMapCreateBody(bad);
    assert.equal(r.ok, false);
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected/i);
  }
  assert.equal(m.parseMapPatchBody({}).ok, false, "una modifica vuota");
  assert.deepEqual(m.parseMapPatchBody({ name: "Nuovo" }), { ok: true, data: { name: "Nuovo" } });
  assert.deepEqual(m.parseMapNodesBody({ add: ["dev:3"] }), { ok: true, data: { add: ["dev:3"], remove: [] } });
  assert.equal(m.parseMapNodesBody({ add: ["x"] }).ok, false);
  assert.deepEqual(m.parseAutoHeadBody({ head_node: null }), { ok: true, data: { headNode: null } });
  assert.equal(m.parseAutoHeadBody({ head_node: "foo" }).ok, false);
});

test("ritocchi e nascondi: vista auto o mappa:N; hidden solo dev:N", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parsePositionsBody({ view: "mappa:4", tweaks: [{ nodeId: "dev:1", x: 1.5, y: -2, sig: "abc" }] }), {
    ok: true, data: { view: "mappa:4", clear: false, tweaks: [{ nodeId: "dev:1", x: 1.5, y: -2, sig: "abc" }], rename: [] },
  });
  assert.deepEqual(m.parsePositionsBody({ view: "auto", clear: true }), { ok: true, data: { view: "auto", clear: true, tweaks: [], rename: [] } });
  assert.deepEqual(m.parsePositionsBody({ view: "mappa:4", rename: [{ from: "host:7", to: "dev:3" }] }), {
    ok: true, data: { view: "mappa:4", clear: false, tweaks: [], rename: [{ from: "host:7", to: "dev:3" }] },
  });
  assert.equal(m.parsePositionsBody({ view: "mappa:4", rename: [{ from: "host:7", to: "host:7" }] }).ok, false, "rinomina su se stesso");
  assert.equal(m.parsePositionsBody({ view: "mappa:4", rename: [{ from: "x", to: "dev:3" }] }).ok, false);
  assert.equal(m.parsePositionsBody({ view: "default", tweaks: [] }).ok, false);
  assert.equal(m.parsePositionsBody({ view: "auto" }).ok, false, "né ritocchi né riordino");
  assert.equal(m.parsePositionsBody({ view: "auto", tweaks: [{ nodeId: "dev:1", x: "a", y: 0, sig: "" }] }).ok, false);
  assert.deepEqual(m.parseHiddenBody({ node_id: "dev:7", hidden: true }), { ok: true, data: { deviceId: 7, hidden: true } });
  assert.equal(m.parseHiddenBody({ node_id: "host:7", hidden: true }).ok, false);
  assert.equal(m.parseHiddenBody({ node_id: "dev:7" }).ok, false);
});

// ─── Fase 2b (Task 9): tipo del collegamento, modifica, principale, porte note ───

test("collegamento a mano col tipo; il tipo non vale per «ignora»", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(
    m.parseLinkOverrideBody({ action: "add", a_node: "host:3", a_port: "net0", b_node: "dev:2", b_port: "Port 5", medium: "fibra", note: "armadio 2" }),
    { ok: true, data: { action: "add", a_node: "host:3", a_port: "net0", b_node: "dev:2", b_port: "Port 5", medium: "fibra", note: "armadio 2" } },
  );
  assert.equal(m.parseLinkOverrideBody({ action: "add", a_node: "dev:1", b_node: "dev:2", medium: null }).ok, true);
  for (const bad of [
    { action: "add", a_node: "dev:1", b_node: "dev:2", medium: "rame" },
    { action: "ignore", a_node: "dev:1", b_node: "dev:2", medium: "cavo" },
    { action: "add", a_node: "vm:x:1", b_node: "dev:2" },
    { action: "add", a_node: "dev:1:2:3", b_node: "dev:2" },
  ]) {
    const r = m.parseLinkOverrideBody(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected|received/);
  }
  const ign = m.parseLinkOverrideBody({ action: "ignore", a_node: "dev:1", b_node: "dev:2", medium: "cavo" });
  assert.deepEqual(ign, { ok: false, error: "Il tipo (cavo, fibra, wireless) si indica solo per un collegamento aggiunto a mano" });
});

// Revisione finale I-1: il modello non ha nodi `vm:` nei collegamenti, quindi un collegamento a mano o un
// principale verso una VM non censita si salverebbe senza mai comparire (ripiego muto). Si rifiuta in parole.
test("I-1: collegamenti e principale rifiutano una VM non censita (vm:N:M), con il motivo in italiano", async () => {
  const m = await import("@/lib/topology/api-input");
  const atteso = { ok: false, error: m.VM_NON_COLLEGABILE };
  assert.match(m.VM_NON_COLLEGABILE, /VM non censita/);
  for (const action of ["add", "ignore"]) {
    assert.deepEqual(m.parseLinkOverrideBody({ action, a_node: "vm:3:100", a_port: "net0", b_node: "dev:2", b_port: "Port 5" }), atteso, action);
    assert.deepEqual(m.parseLinkOverrideBody({ action, a_node: "dev:2", b_node: "vm:3:100" }), atteso, action);
  }
  assert.deepEqual(m.parsePrimaryBody({ node_id: "vm:3:100", other_node: "host:9" }), atteso);
  assert.deepEqual(m.parsePrimaryBody({ node_id: "dev:5", other_node: "vm:3:100" }), atteso);
  // Le mappe continuano ad accettare le VM (test più sotto); togliere una scelta resta possibile per qualunque nodo.
  assert.deepEqual(m.parsePrimaryDeleteBody({ node_id: "vm:3:100" }), { ok: true, data: { node_id: "vm:3:100" } });
});

test("modifica di un collegamento a mano: solo i campi presenti; almeno uno", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parseLinkPatchBody({ a_port: "Port 7" }), { ok: true, data: { a_port: "Port 7" } });
  assert.deepEqual(m.parseLinkPatchBody({ medium: null, note: null }), { ok: true, data: { medium: null, note: null } });
  assert.deepEqual(m.parseLinkPatchBody({ b_port: "", medium: "wireless" }), { ok: true, data: { b_port: "", medium: "wireless" } });
  assert.deepEqual(m.parseLinkPatchBody({}), { ok: false, error: "Niente da modificare: servono le porte, il tipo o la nota" });
  for (const bad of [null, { medium: "rame" }, { a_port: 5 }, { a_port: "x".repeat(101) }, { note: "x".repeat(501) }]) {
    const r = m.parseLinkPatchBody(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected|received/);
  }
});

test("principale scelto a mano: due nodi diversi, porte facoltative; per toglierlo basta il nodo", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parsePrimaryBody({ node_id: "dev:5", other_node: "dev:2", node_port: "eno1", other_port: "Port 17" }), {
    ok: true, data: { node_id: "dev:5", other_node: "dev:2", node_port: "eno1", other_port: "Port 17" },
  });
  assert.deepEqual(m.parsePrimaryBody({ node_id: "host:3", other_node: "host:9" }), {
    ok: true, data: { node_id: "host:3", other_node: "host:9", node_port: "", other_port: "" },
  });
  assert.deepEqual(m.parsePrimaryBody({ node_id: "dev:5", other_node: "dev:5" }), { ok: false, error: "Un collegamento unisce due nodi diversi" });
  for (const bad of [null, {}, { node_id: "dev:5" }, { node_id: "ext:1", other_node: "dev:2" }, { node_id: "dev:5", other_node: "dev:2", node_port: 3 }]) {
    const r = m.parsePrimaryBody(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.doesNotMatch(r.error, /Invalid|expected|received/);
  }
  assert.deepEqual(m.parsePrimaryDeleteBody({ node_id: "dev:5" }), { ok: true, data: { node_id: "dev:5" } });
  assert.equal(m.parsePrimaryDeleteBody({}).ok, false);
  assert.equal(m.parsePrimaryDeleteBody(null).ok, false);
});

test("porte note: il nodo nella query, nella forma dev:N, host:N o vm:N:M", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.deepEqual(m.parsePortsQuery("dev:4"), { ok: true, data: "dev:4" });
  assert.deepEqual(m.parsePortsQuery("vm:3:100"), { ok: true, data: "vm:3:100" });
  assert.deepEqual(m.parsePortsQuery(null), { ok: false, error: "Manca il nodo: ?node=dev:N" });
  assert.equal(m.parsePortsQuery("dev:x").ok, false);
});

test("mappe, radici e ritocchi accettano anche le VM (vm:<apparato>:<vmid>)", async () => {
  const m = await import("@/lib/topology/api-input");
  assert.equal(m.parseMapCreateBody({ name: "x", nodes: ["vm:3:100"], roots: ["vm:3:100"] }).ok, true);
  assert.deepEqual(m.parseMapNodesBody({ add: ["vm:3:100"] }), { ok: true, data: { add: ["vm:3:100"], remove: [] } });
  assert.equal(m.parsePositionsBody({ view: "mappa:1", tweaks: [{ nodeId: "vm:3:100", x: 0, y: 0, sig: "s" }] }).ok, true);
  assert.equal(m.parseMapNodesBody({ add: ["vm:3"] }).ok, true, "la regex del piano ammette anche vm:N");
  assert.equal(m.parseMapNodesBody({ add: ["vm:a:1"] }).ok, false);
});

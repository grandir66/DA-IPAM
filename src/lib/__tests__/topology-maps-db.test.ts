import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  clearTopologyTweaks, createTopologyMap, deleteTenantDatabase, deleteTopologyMap, getAutoMap, getTenantDb, getTopologyMap,
  getTopologyMapView, listTopologyMaps, renameTopologyNodes, saveTopologyTweaks, setAutoHead, setNodeHidden, setTopologyMapNodes, updateTopologyMap, withTenant,
} from "@/lib/db-tenant";

const T = "TESTTOPOMAPS";
const db = () => getTenantDb(T);
const w = <R>(fn: () => R): R => withTenant(T, fn);

beforeEach(() => {
  db().exec("DELETE FROM topology_position; DELETE FROM topology_maps; DELETE FROM network_devices;");
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh')");
});
after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  removeTestHubDb();
});

const nodesOf = (id: number) => w(() => getTopologyMapView(`mappa:${id}`)).nodes.sort();

test("crea una mappa con due nodi e una radice; la rilegge", () => {
  const m = w(() => createTopologyMap({ name: "Sede", roots: ["dev:1"], nodes: ["dev:1", "dev:2"] }, "riccardo"));
  assert.equal(m.kind, "passo");
  assert.deepEqual(m.roots, ["dev:1"]);
  assert.deepEqual(nodesOf(m.id), ["dev:1", "dev:2"]);
  assert.equal(w(() => getTopologyMap(m.id))?.name, "Sede");
  assert.equal(w(() => getTopologyMap(999)), null);
  assert.deepEqual(w(() => listTopologyMaps()).map((x) => x.name), ["Sede"]);
});

test("aggiungi/togli nodi: un nodo tolto esce anche dalle radici", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: ["dev:1"], nodes: ["dev:1", "dev:2"] }, "r"));
  assert.deepEqual(w(() => setTopologyMapNodes(m.id, ["dev:3"], ["dev:1"])), { ok: true });
  assert.deepEqual(nodesOf(m.id), ["dev:2", "dev:3"]);
  assert.deepEqual(w(() => getTopologyMap(m.id))?.roots, []);
  assert.equal(w(() => setTopologyMapNodes(999, ["dev:3"], [])).ok, false);
});

test("aggiungere due volte lo stesso nodo non crea doppi e non cancella un ritocco", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: [], nodes: ["dev:2"] }, "r"));
  w(() => saveTopologyTweaks(`mappa:${m.id}`, [{ nodeId: "dev:2", x: 10, y: 20, sig: "s1" }]));
  w(() => setTopologyMapNodes(m.id, ["dev:2", "dev:2"], []));
  w(() => setTopologyMapNodes(m.id, ["dev:2"], []));
  const v = w(() => getTopologyMapView(`mappa:${m.id}`));
  assert.deepEqual(v.nodes, ["dev:2"]);
  assert.deepEqual(v.tweaks, [{ nodeId: "dev:2", x: 10, y: 20, sig: "s1" }]);
});

test("ritocchi: solo i nodi con pinned; «Riordina» li toglie ma lascia i nodi nelle passo passo, e svuota auto", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: [], nodes: ["dev:1", "dev:2"] }, "r"));
  const view = `mappa:${m.id}`;
  assert.deepEqual(w(() => getTopologyMapView(view)).tweaks, []);
  w(() => saveTopologyTweaks(view, [{ nodeId: "dev:1", x: 1, y: 2, sig: "a" }]));
  w(() => saveTopologyTweaks(view, [{ nodeId: "dev:1", x: 5, y: 6, sig: "b" }]));
  assert.deepEqual(w(() => getTopologyMapView(view)).tweaks, [{ nodeId: "dev:1", x: 5, y: 6, sig: "b" }]);
  w(() => clearTopologyTweaks(view));
  const v = w(() => getTopologyMapView(view));
  assert.deepEqual(v.tweaks, []);
  assert.deepEqual(v.nodes.sort(), ["dev:1", "dev:2"]);
  w(() => saveTopologyTweaks("auto", [{ nodeId: "dev:1", x: 1, y: 1, sig: "z" }]));
  assert.equal(w(() => getTopologyMapView("auto")).tweaks.length, 1);
  w(() => clearTopologyTweaks("auto"));
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM topology_position WHERE view = 'auto'").get() as { n: number }).n, 0);
});

test("deleteTopologyMap toglie mappa e righe; l'altra mappa resta", () => {
  const a = w(() => createTopologyMap({ name: "A", roots: [], nodes: ["dev:1"] }, "r"));
  const b = w(() => createTopologyMap({ name: "B", roots: [], nodes: ["dev:1"] }, "r"));
  assert.equal(w(() => deleteTopologyMap(a.id)), true);
  assert.equal(w(() => deleteTopologyMap(a.id)), false);
  assert.equal(w(() => getTopologyMap(a.id)), null);
  assert.deepEqual(nodesOf(a.id), []);
  assert.deepEqual(nodesOf(b.id), ["dev:1"]);
});

test("una mappa con un apparato cancellato si legge lo stesso: il nodo resta nell'elenco", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: [], nodes: ["dev:1", "dev:77"] }, "r"));
  db().exec("DELETE FROM network_devices WHERE id = 1");
  assert.deepEqual(nodesOf(m.id), ["dev:1", "dev:77"]);
});

test("rinomina e radici; nome vuoto o mappa assente rifiutati", () => {
  const m = w(() => createTopologyMap({ name: "A", roots: [], nodes: ["dev:1"] }, "r"));
  assert.deepEqual(w(() => updateTopologyMap(m.id, { name: "B", roots: ["dev:1"] })), { ok: true });
  const r = w(() => getTopologyMap(m.id));
  assert.equal(r?.name, "B");
  assert.deepEqual(r?.roots, ["dev:1"]);
  assert.equal(w(() => updateTopologyMap(999, { name: "x" })).ok, false);
});

test("roots con JSON rovinato: si legge come elenco vuoto", () => {
  const m = w(() => createTopologyMap({ name: "A", roots: [], nodes: [] }, "r"));
  db().prepare("UPDATE topology_maps SET roots = '{rotto' WHERE id = ?").run(m.id);
  assert.deepEqual(w(() => getTopologyMap(m.id))?.roots, []);
});

test("testa della mappa automatica: la seconda scrittura aggiorna la stessa riga", () => {
  assert.equal(w(() => getAutoMap()), null);
  w(() => setAutoHead("dev:1", "riccardo"));
  w(() => setAutoHead("dev:2", "secondo"));
  const a = w(() => getAutoMap());
  assert.equal(a?.head_node, "dev:2");
  assert.equal(a?.created_by, "secondo", "la pagina dice chi ha scelto la testa per ultimo");
  assert.equal(a?.kind, "auto");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM topology_maps WHERE kind = 'auto'").get() as { n: number }).n, 1);
  w(() => setAutoHead(null, "riccardo"));
  assert.equal(w(() => getAutoMap())?.head_node, null);
  assert.deepEqual(w(() => listTopologyMaps()), [], "l'elenco ha solo le passo passo");
});

test("nascondi: l'apparato c'è o no", () => {
  assert.deepEqual(w(() => setNodeHidden(1, true)), { ok: true });
  assert.equal((db().prepare("SELECT topology_hidden AS h FROM network_devices WHERE id = 1").get() as { h: number }).h, 1);
  assert.deepEqual(w(() => setNodeHidden(1, false)), { ok: true });
  assert.equal(w(() => setNodeHidden(99, true)).ok, false);
});

test("rinomina degli id (I5): membri, partenze e ritocchi passano all'id canonico; un doppio si toglie", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: ["host:7"], nodes: ["host:7", "host:8", "dev:3", "dev:1"] }, "r"));
  const view = `mappa:${m.id}`;
  w(() => saveTopologyTweaks(view, [{ nodeId: "host:7", x: 4, y: 5, sig: "s" }]));
  w(() => renameTopologyNodes(view, [{ from: "host:7", to: "dev:9" }, { from: "host:8", to: "dev:3" }]));
  const v = w(() => getTopologyMapView(view));
  assert.deepEqual(v.nodes, ["dev:1", "dev:3", "dev:9"]);
  assert.deepEqual(v.tweaks, [{ nodeId: "dev:9", x: 4, y: 5, sig: "s" }]);
  assert.deepEqual(w(() => getTopologyMap(m.id))?.roots, ["dev:9"]);
});

test("rinomina nella mappa automatica: testa e ritocchi, senza cambiare chi ha scelto la testa (I5)", () => {
  w(() => setAutoHead("host:12", "riccardo"));
  w(() => saveTopologyTweaks("auto", [{ nodeId: "host:12", x: 1, y: 1, sig: "z" }]));
  w(() => renameTopologyNodes("auto", [{ from: "host:12", to: "host:9" }]));
  const a = w(() => getAutoMap());
  assert.equal(a?.head_node, "host:9");
  assert.equal(a?.created_by, "riccardo");
  assert.deepEqual(w(() => getTopologyMapView("auto")).tweaks.map((t) => t.nodeId), ["host:9"]);
});

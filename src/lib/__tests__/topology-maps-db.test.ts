import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import {
  clearTopologyTweaks, createTopologyMap, deleteTenantDatabase, deleteTopologyMap, getAutoMap, getTenantDb, getTopologyMap,
  getMapOrientation, getTopologyMapView, listTopologyMaps, renameTopologyNodes, saveTopologyTweaks, setAutoHead, setMapOrientation, setNodeHidden, setTopologyRole,
  setTopologyMapNodes, updateTopologyMap, withTenant,
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
  w(() => saveTopologyTweaks(`mappa:${m.id}`, [{ nodeId: "dev:2", x: 10, y: 20, sig: "s1" }], "tb"));
  w(() => setTopologyMapNodes(m.id, ["dev:2", "dev:2"], []));
  w(() => setTopologyMapNodes(m.id, ["dev:2"], []));
  const v = w(() => getTopologyMapView(`mappa:${m.id}`));
  assert.deepEqual(v.nodes, ["dev:2"]);
  assert.deepEqual(v.tweaks, [{ nodeId: "dev:2", x: 10, y: 20, sig: "s1", orientation: "tb" }]);
});

test("ritocchi: solo i nodi con pinned; «Riordina» li toglie ma lascia i nodi nelle passo passo, e svuota auto", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: [], nodes: ["dev:1", "dev:2"] }, "r"));
  const view = `mappa:${m.id}`;
  assert.deepEqual(w(() => getTopologyMapView(view)).tweaks, []);
  w(() => saveTopologyTweaks(view, [{ nodeId: "dev:1", x: 1, y: 2, sig: "a" }], "tb"));
  w(() => saveTopologyTweaks(view, [{ nodeId: "dev:1", x: 5, y: 6, sig: "b" }], "tb"));
  assert.deepEqual(w(() => getTopologyMapView(view)).tweaks, [{ nodeId: "dev:1", x: 5, y: 6, sig: "b", orientation: "tb" }]);
  w(() => clearTopologyTweaks(view));
  const v = w(() => getTopologyMapView(view));
  assert.deepEqual(v.tweaks, []);
  assert.deepEqual(v.nodes.sort(), ["dev:1", "dev:2"]);
  w(() => saveTopologyTweaks("auto", [{ nodeId: "dev:1", x: 1, y: 1, sig: "z" }], "tb"));
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

test("ruolo nella mappa (T1b, spec §13.8.2): si scrive '', 'rete' o 'attaccato'; un apparato che non c'è si rifiuta", () => {
  const ruolo = () => db().prepare("SELECT topology_role FROM network_devices WHERE id = 1").pluck().get();
  assert.deepEqual(w(() => setTopologyRole(1, "rete")), { ok: true });
  assert.equal(ruolo(), "rete");
  assert.deepEqual(w(() => setTopologyRole(1, "")), { ok: true });
  assert.equal(ruolo(), "", "«Decide il sistema» torna alla stringa vuota, come le righe di oggi");
  assert.equal(w(() => setTopologyRole(99, "attaccato")).ok, false);
});

test("rinomina degli id (I5): membri, partenze e ritocchi passano all'id canonico; un doppio si toglie", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: ["host:7"], nodes: ["host:7", "host:8", "dev:3", "dev:1"] }, "r"));
  const view = `mappa:${m.id}`;
  w(() => saveTopologyTweaks(view, [{ nodeId: "host:7", x: 4, y: 5, sig: "s" }], "tb"));
  w(() => renameTopologyNodes(view, [{ from: "host:7", to: "dev:9" }, { from: "host:8", to: "dev:3" }]));
  const v = w(() => getTopologyMapView(view));
  assert.deepEqual(v.nodes, ["dev:1", "dev:3", "dev:9"]);
  assert.deepEqual(v.tweaks, [{ nodeId: "dev:9", x: 4, y: 5, sig: "s", orientation: "tb" }]);
  assert.deepEqual(w(() => getTopologyMap(m.id))?.roots, ["dev:9"]);
});

test("rinomina nella mappa automatica: testa e ritocchi, senza cambiare chi ha scelto la testa (I5)", () => {
  w(() => setAutoHead("host:12", "riccardo"));
  w(() => saveTopologyTweaks("auto", [{ nodeId: "host:12", x: 1, y: 1, sig: "z" }], "tb"));
  w(() => renameTopologyNodes("auto", [{ from: "host:12", to: "host:9" }]));
  const a = w(() => getAutoMap());
  assert.equal(a?.head_node, "host:9");
  assert.equal(a?.created_by, "riccardo");
  assert.deepEqual(w(() => getTopologyMapView("auto")).tweaks.map((t) => t.nodeId), ["host:9"]);
});

// ─── Orientamento (spec §12.2, piano 2026-10-14-topologia-verticale-stampa, Task 1) ───

test("orientamento: senza riga «auto» vale 'lr'; la prima scelta crea la riga e la testa resta quella di prima", () => {
  assert.equal(w(() => getMapOrientation("auto")), "lr");
  assert.equal(w(() => getAutoMap()), null, "leggere non crea la riga");
  assert.deepEqual(w(() => setMapOrientation("auto", "tb", "riccardo")), { ok: true });
  const a = w(() => getAutoMap());
  assert.equal(a?.orientation, "tb");
  assert.equal(a?.head_node, null, "nessuna testa scelta: resta proposta dal sistema");
  assert.equal(w(() => getMapOrientation("auto")), "tb");
  assert.equal(w(() => getTopologyMapView("auto")).orientation, "tb");

  // Con una testa già scelta: l'orientamento non tocca né la testa né chi l'ha scelta.
  w(() => setAutoHead("dev:1", "primo"));
  assert.deepEqual(w(() => setMapOrientation("auto", "lr", "secondo")), { ok: true });
  const b = w(() => getAutoMap());
  assert.equal(b?.orientation, "lr");
  assert.equal(b?.head_node, "dev:1");
  assert.equal(b?.created_by, "primo", "la pagina dice chi ha scelto la testa, non chi ha girato la mappa");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM topology_maps WHERE kind = 'auto'").get() as { n: number }).n, 1);
  // La testa scelta dopo non riporta l'orientamento indietro.
  w(() => setMapOrientation("auto", "tb", "secondo"));
  w(() => setAutoHead("dev:2", "terzo"));
  assert.equal(w(() => getMapOrientation("auto")), "tb");
});

test("orientamento di una passo passo: nasce 'lr', si cambia, una mappa assente si rifiuta", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: [], nodes: ["dev:1"] }, "r"));
  assert.equal(m.orientation, "lr");
  assert.equal(w(() => getMapOrientation(`mappa:${m.id}`)), "lr");
  assert.equal(w(() => getTopologyMapView(`mappa:${m.id}`)).orientation, "lr");
  assert.deepEqual(w(() => setMapOrientation(`mappa:${m.id}`, "tb", "r")), { ok: true });
  assert.equal(w(() => getTopologyMap(m.id))?.orientation, "tb");
  assert.equal(w(() => getTopologyMapView(`mappa:${m.id}`)).orientation, "tb");
  assert.deepEqual(w(() => setMapOrientation("mappa:999", "tb", "r")), { ok: false, error: "Mappa non trovata" });
  assert.equal(w(() => getMapOrientation("mappa:999")), "lr");
  assert.deepEqual(w(() => listTopologyMaps()).map((x) => [x.name, x.orientation]), [["S", "tb"]]);
});

test("ritocchi delle righe di oggi (orientamento NULL) valgono per 'tb'", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: [], nodes: ["dev:1"] }, "r"));
  db().prepare("UPDATE topology_position SET x = 7, y = 8, pinned = 1, structure_sig = 'vecchia' WHERE view = ? AND node_id = 'dev:1'").run(`mappa:${m.id}`);
  assert.deepEqual(w(() => getTopologyMapView(`mappa:${m.id}`)).tweaks, [{ nodeId: "dev:1", x: 7, y: 8, sig: "vecchia", orientation: "tb" }]);
});

test("Review Focus 2: un ritocco in 'lr' sostituisce quello 'tb' dello stesso oggetto; l'appartenenza non cambia", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: ["dev:1"], nodes: ["dev:1", "dev:2", "dev:3"] }, "r"));
  const view = `mappa:${m.id}`;
  w(() => saveTopologyTweaks(view, [{ nodeId: "dev:1", x: 10, y: 20, sig: "s-tb" }, { nodeId: "dev:2", x: 30, y: 40, sig: "s-tb" }], "tb"));
  w(() => saveTopologyTweaks(view, [{ nodeId: "dev:1", x: 500, y: 60, sig: "s-lr" }], "lr"));
  const v = w(() => getTopologyMapView(view));
  assert.deepEqual(v.nodes, ["dev:1", "dev:2", "dev:3"]);
  assert.deepEqual(v.tweaks, [
    { nodeId: "dev:1", x: 500, y: 60, sig: "s-lr", orientation: "lr" },
    { nodeId: "dev:2", x: 30, y: 40, sig: "s-tb", orientation: "tb" },
  ]);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM topology_position WHERE view = ?").get(view) as { n: number }).n, 3, "una riga per mappa e oggetto");
  // L'appartenenza (pinned 0) non scrive l'orientamento.
  assert.deepEqual(db().prepare("SELECT node_id, pinned, orientation FROM topology_position WHERE view = ? AND node_id = 'dev:3'").get(view), {
    node_id: "dev:3", pinned: 0, orientation: null,
  });
  w(() => setTopologyMapNodes(m.id, ["dev:4"], []));
  assert.equal((db().prepare("SELECT orientation FROM topology_position WHERE view = ? AND node_id = 'dev:4'").get(view) as { orientation: null }).orientation, null);
});

test("«Riordina» con l'orientamento toglie solo i ritocchi di quell'orientamento; senza, tutti", () => {
  const m = w(() => createTopologyMap({ name: "S", roots: [], nodes: ["dev:1", "dev:2"] }, "r"));
  const view = `mappa:${m.id}`;
  w(() => saveTopologyTweaks(view, [{ nodeId: "dev:1", x: 1, y: 2, sig: "a" }], "tb"));
  w(() => saveTopologyTweaks(view, [{ nodeId: "dev:2", x: 3, y: 4, sig: "b" }], "lr"));
  w(() => clearTopologyTweaks(view, "lr"));
  let v = w(() => getTopologyMapView(view));
  assert.deepEqual(v.tweaks, [{ nodeId: "dev:1", x: 1, y: 2, sig: "a", orientation: "tb" }]);
  assert.deepEqual(v.nodes, ["dev:1", "dev:2"]);
  assert.deepEqual(db().prepare("SELECT pinned, x, y, structure_sig, orientation FROM topology_position WHERE view = ? AND node_id = 'dev:2'").get(view), {
    pinned: 0, x: 0, y: 0, structure_sig: null, orientation: null,
  }, "torna semplice appartenenza");
  w(() => clearTopologyTweaks(view));
  v = w(() => getTopologyMapView(view));
  assert.deepEqual(v.tweaks, []);
  assert.deepEqual(v.nodes, ["dev:1", "dev:2"]);

  // Nell'automatica: le righe di quell'orientamento si cancellano, le altre restano (anche le NULL = 'tb').
  w(() => saveTopologyTweaks("auto", [{ nodeId: "dev:1", x: 1, y: 1, sig: "z" }], "lr"));
  db().prepare("INSERT INTO topology_position (view, node_id, x, y, pinned, structure_sig) VALUES ('auto', 'dev:2', 5, 5, 1, 'vecchia')").run();
  w(() => clearTopologyTweaks("auto", "tb"));
  assert.deepEqual(w(() => getTopologyMapView("auto")).tweaks.map((t) => [t.nodeId, t.orientation]), [["dev:1", "lr"]]);
  w(() => clearTopologyTweaks("auto"));
  assert.deepEqual(w(() => getTopologyMapView("auto")).tweaks, []);
});

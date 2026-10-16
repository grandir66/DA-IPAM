// La traccia sul DB di un cliente (spec topologia §13.11.3, piano di T2, Task 12): il calcolo che serve la rotta
// GET /api/topology/traccia (stesso giro: ingresso, modello di oggi, mappa automatica, modello per cavo, confronto) non scrive
// niente; con le letture spente non trova differenze; con una lettura accesa dice la differenza e il perché, e il modello di
// oggi resta identico (R7). Il giro è lo stesso della rotta: se cambia lì, cambia anche qui.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getAutoMap, getIngressoCavi, getTenantDb, rileggiSchemaCavi, scriviFattiTopologia, upsertNeighbors, withTenant } from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { computeMapView } from "@/lib/topology/map-compute";
import { padriDi } from "@/lib/topology/misura";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";
import { calcolaTraccia, nomiTraccia } from "@/lib/topology/cavi/traccia";

const T = "TESTCAVITRACCIA";
const db = () => getTenantDb(T);
beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs; DELETE FROM device_neighbors;
    DELETE FROM network_devices;`);
  db().exec(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES
    (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh'), (2, 'SW-2', '10.0.0.2', 'switch', 'mikrotik', 'ssh'), (3, 'SW-3', '10.0.0.3', 'switch', 'mikrotik', 'ssh')`);
  withTenant(T, () => {
    rileggiSchemaCavi();
    const cavo = (a: number, pa: string, b: number, pb: string, nb: string, na: string) => {
      upsertNeighbors(a, [{ localPort: `${pa},bridge`, remoteDevice: nb, remotePort: `bridge/${pb}`, protocol: "lldp", remotePlatform: "MikroTik" }]);
      upsertNeighbors(b, [{ localPort: `${pb},bridge`, remoteDevice: na, remotePort: `bridge/${pa}`, protocol: "lldp", remotePlatform: "MikroTik" }]);
    };
    cavo(1, "ether1", 2, "ether1", "SW-2", "RTR-1");
    cavo(2, "ether2", 3, "ether2", "SW-3", "SW-2");
    cavo(1, "ether3", 3, "ether3", "SW-3", "RTR-1");
  });
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

/** Lo stesso giro della rotta della traccia. */
function traccia() {
  const ing = getIngressoCavi(2);
  const t1 = buildTopologyModel(ing.t1);
  const auto = getAutoMap();
  const vista = computeMapView(t1, { auto: true, members: [], roots: [], head: auto?.head_node ?? null, tweaks: [], expanded: new Set(), orientation: "lr" });
  const m = costruisciModelloCavi(ing, t1, { testaScelta: vista.headChosen ? vista.head : null });
  const tr = calcolaTraccia(padriDi(vista.tree), m);
  return { t1, tr, nomi: nomiTraccia(t1, m, tr) };
}
const scritture = (): number => (db().prepare("SELECT total_changes() AS n").get() as { n: number }).n;
const righe = (): string => JSON.stringify(["device_neighbors", "topology_port_facts", "topology_bridge_facts", "network_devices", "topology_maps"]
  .map((t) => (db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n));

test("letture spente: nessuna differenza, e il calcolo non scrive niente", () => {
  const prima = [scritture(), righe()];
  const { tr } = withTenant(T, traccia);
  assert.deepEqual([tr.schema, tr.padriDiversi, tr.righe.length, tr.perGenere.cavo], [true, 0, 0, 3]);
  assert.deepEqual([scritture(), righe()], prima, "né una riga cambiata né una aggiunta");
});

test("letture accese: la porta radice cambia un padre, la traccia dice quale e perché; il modello di oggi resta identico", () => {
  const oggi = JSON.stringify(withTenant(T, traccia).t1);
  withTenant(T, () => scriviFattiTopologia(3, "device", {
    porte: [{ port_key: "n:ether2", port_name: "ether2", in_bridge: 1, stp_role: "root", stp_state: "forwarding" },
      { port_key: "n:ether3", port_name: "ether3", in_bridge: 1, stp_role: "alternate", stp_state: "discarding" }],
    bridge: [{ bridge_name: "bridge", instance: 0, protocol: "rstp", bridge_id: "32768.02:00:00:00:00:03", root_id: "0.02:00:00:00:00:01", root_port: "ether2" }],
    macs: [],
  }));
  const prima = [scritture(), righe()];
  const { t1, tr, nomi } = withTenant(T, traccia);
  assert.equal(JSON.stringify(t1), oggi, "R7: ciò che T2 scrive non cambia il modello di oggi");
  assert.deepEqual(tr.righe.map((r) => [nomi[r.id], nomi[r.prima ?? ""], nomi[r.dopo ?? ""]]), [["SW-3", "RTR-1", "SW-2"]]);
  assert.match(tr.righe[0].perche, /porta radice nello spanning tree; il collegamento di oggi è bloccato dallo spanning tree/);
  assert.equal(tr.nuovi.bloccati, 1);
  assert.deepEqual([scritture(), righe()], prima, "né una riga cambiata né una aggiunta");
});

test("senza lo schema delle letture in più: solo le righe di oggi, e la traccia lo dice", () => {
  db().exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps");
  withTenant(T, () => rileggiSchemaCavi());
  const { tr } = withTenant(T, traccia);
  assert.deepEqual([tr.schema, tr.padriDiversi], [false, 0]);
  db().exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
  withTenant(T, () => rileggiSchemaCavi());
});

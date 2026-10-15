// L'ingresso del modello per cavo (spec §13.5.7, «Chi legge che cosa»): tutte le fonti dei vicini con le colonne nuove; i
// fatti dell'ultimo giro di ogni apparato e lettore (I44: una porta tolta dal bridge non è più nel bridge); i MAC dei
// lettori e le schede dell'inventario in una query a parte; senza schema, elenchi vuoti (mai un errore muto).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getIngressoCavi, getTenantDb, rileggiSchemaCavi, scriviFattiTopologia, upsertNeighbors, withTenant } from "@/lib/db-tenant";
import { buildTopologyModel } from "@/lib/topology/model";
import { costruisciModelloCavi } from "@/lib/topology/cavi/modello";

const T = "TESTCAVIINGRESSO";
/** L'orologio delle prove coi fatti scritti a data fissa (15/10): con la soglia «non visto» (M5) l'ingresso dipende dall'ora. */
const ORA_DELLE_PROVE = Date.parse("2026-10-15T10:00:00Z");
const db = () => getTenantDb(T);
beforeEach(() => {
  db().exec(`DELETE FROM topology_port_facts; DELETE FROM topology_bridge_facts; DELETE FROM topology_device_macs; DELETE FROM device_neighbors;
    DELETE FROM network_devices; DELETE FROM device_interfaces; DELETE FROM physical_devices;`);
  db().exec("INSERT INTO network_devices (id, name, host, device_type, vendor, protocol) VALUES (1, 'RTR-1', '10.0.0.1', 'router', 'mikrotik', 'ssh'), (2, 'SW-2', '10.0.0.2', 'switch', 'cisco', 'snmp_v2')");
  withTenant(T, () => rileggiSchemaCavi());
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("tutte le fonti dei vicini, con le colonne nuove; il modello di oggi solo le sue", () => {
  withTenant(T, () => {
    upsertNeighbors(2, [{ localPort: "Gi1/0/24", remoteDevice: "RTR-1", remotePort: "ether2", protocol: "lldp", localPortIndex: 10124 }], "snmp");
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Gi1/0/24", protocol: "lldp" }]);
  });
  const ing = withTenant(T, () => getIngressoCavi(2));
  assert.deepEqual(ing.vicini.map((v) => [v.source, v.local_port_index]).sort(), [["device", null], ["snmp", 10124]]);
  assert.equal(ing.t1.neighbors.length, 1);
  assert.equal(ing.schema, true);
});

test("I44: i fatti valgono solo dall'ultimo giro dello stesso apparato e lettore", () => {
  withTenant(T, () => {
    scriviFattiTopologia(1, "device", { porte: [{ port_key: "n:ether2", port_name: "ether2", in_bridge: 1 }, { port_key: "n:ether3", port_name: "ether3", in_bridge: 1 }], bridge: [], macs: [] }, new Date("2026-10-15T08:00:00Z"));
    scriviFattiTopologia(1, "device", { porte: [{ port_key: "n:ether2", port_name: "ether2", in_bridge: 0 }], bridge: [], macs: [] }, new Date("2026-10-15T09:00:00Z"));
  });
  const f = withTenant(T, () => getIngressoCavi(2, ORA_DELLE_PROVE)).fattiPorta;
  assert.deepEqual(f.map((x) => [x.port_key, x.in_bridge]), [["n:ether2", 0]], "ether3 non è più nell'ultimo giro; ether2 fuori dal bridge");
});

// Revisione del Task 6 di T2 (piano «Scelte» 8): l'ultimo giro si calcolava tabella per tabella. Un giro che scrive il
// bridge e non le porte (la tabella delle porte non ha risposto) lasciava passare le porte del giro di prima accanto al
// bridge del giro nuovo: una porta radice nuova con lo stato delle porte di un'ora prima. Il giro è uno per apparato e
// lettore, il più recente fra porte e bridge.
test("Scelta 8: l'ultimo giro è per apparato e lettore, fra porte e bridge insieme; una lettura parziale non mescola i giri", () => {
  withTenant(T, () => {
    scriviFattiTopologia(1, "device", { porte: [{ port_key: "n:ether2", port_name: "ether2", stp_state: "forwarding" }],
      bridge: [{ bridge_name: "bridge", instance: 0, protocol: "rstp", root_port: "ether2" }], macs: [] }, new Date("2026-10-15T08:00:00Z"));
    scriviFattiTopologia(1, "device", { porte: [], bridge: [{ bridge_name: "bridge", instance: 0, protocol: "rstp", root_port: "ether3" }], macs: [] },
      new Date("2026-10-15T09:00:00Z"));
  });
  const ing = withTenant(T, () => getIngressoCavi(2, ORA_DELLE_PROVE));
  assert.deepEqual(ing.fattiBridge.map((b) => b.root_port), ["ether3"]);
  assert.deepEqual(ing.fattiPorta, [], "le porte del giro delle 8 non stanno accanto al bridge delle 9");
});

// M5 (revisione finale di T2): l'«ultimo giro» di una fonte che non si legge più resta nel DB fino alla potatura (90
// giorni). Un `running = 0` di allora faceva «giù» un cavo che l'LLDP vede oggi sulla stessa porta: la mappa nuova avrebbe
// detto «cavo giù» per un cavo acceso. Un fatto più vecchio della soglia «non visto» (staleDays, la stessa dei collegamenti)
// non entra nell'ingresso: per il modello per cavo quella porta non è letta. La soglia si calcola dall'orologio passato.
test("M5: un fatto più vecchio della soglia «non visto» non entra, e il cavo visto oggi non è «giù»", () => {
  const adesso = Date.now();
  const giorniFa = (n: number) => new Date(adesso - n * 86_400_000);
  const fatti = {
    porte: [{ port_key: "n:ether2", port_name: "ether2", running: 0 }],
    bridge: [{ bridge_name: "bridge", instance: 0, protocol: "rstp", root_port: "ether2" }],
    macs: [],
  };
  withTenant(T, () => {
    upsertNeighbors(2, [{ localPort: "Gi1/0/24", remoteDevice: "RTR-1", remotePort: "ether2", protocol: "lldp" }]);
    upsertNeighbors(1, [{ localPort: "ether2", remoteDevice: "SW-2", remotePort: "Gi1/0/24", protocol: "lldp" }]);
  });
  const statoDelCavo = (ing: ReturnType<typeof getIngressoCavi>) => {
    const m = costruisciModelloCavi(ing, buildTopologyModel(ing.t1), { testaScelta: null });
    const c = m.collegamenti.filter((x) => [x.a.nodo, x.b.nodo].sort().join() === "dev:1,dev:2");
    assert.equal(c.length, 1, "un cavo fra i due apparati");
    return c[0].stato;
  };

  withTenant(T, () => scriviFattiTopologia(1, "device", fatti, giorniFa(3)));
  const vecchio = withTenant(T, () => getIngressoCavi(2, adesso));
  assert.deepEqual([vecchio.fattiPorta.length, vecchio.fattiBridge.length], [0, 0], "tre giorni con la soglia a due: fuori");
  assert.notEqual(statoDelCavo(vecchio), "giu", "il cavo visto oggi via LLDP non diventa «giù» per un fatto di tre giorni fa");

  withTenant(T, () => scriviFattiTopologia(1, "device", fatti, giorniFa(1)));
  const recente = withTenant(T, () => getIngressoCavi(2, adesso));
  assert.deepEqual(recente.fattiPorta.map((x) => [x.port_key, x.running]), [["n:ether2", 0]], "un giorno: dentro");
  assert.equal(recente.fattiBridge.length, 1);
  assert.equal(statoDelCavo(recente), "giu", "un fatto dentro la soglia dice ancora «giù»");
});

test("i MAC degli apparati: dai lettori e dalle schede dell'inventario (solo identità)", () => {
  db().exec("INSERT INTO physical_devices (id, primary_mac) VALUES (5, NULL)");
  db().exec("UPDATE network_devices SET physical_device_id = 5 WHERE id = 1");
  db().exec("INSERT INTO device_interfaces (physical_device_id, ifname, mac, is_virtual_mac) VALUES (5, 'eth1', '02:00:00:00:05:01', 0), (5, 'vrrp1', '00:00:5E:00:01:0A', 1)");
  withTenant(T, () => scriviFattiTopologia(1, "device", { porte: [], bridge: [], macs: [{ mac: "02:00:00:00:01:02", port_key: "n:ether2" }] }));
  const m = withTenant(T, () => getIngressoCavi(2)).macApparati;
  assert.deepEqual(m.map((x) => [x.device_id, x.mac]), [[1, "02:00:00:00:01:02"], [1, "02:00:00:00:05:01"]]);
});

test("senza schema: elenchi vuoti e `schema: false`, detto", () => {
  db().exec("ALTER TABLE device_neighbors DROP COLUMN remote_caps");
  withTenant(T, () => rileggiSchemaCavi());
  const ing = withTenant(T, () => getIngressoCavi(2));
  assert.deepEqual([ing.schema, ing.fattiPorta.length, ing.macApparati.length], [false, 0, 0]);
  db().exec("ALTER TABLE device_neighbors ADD COLUMN remote_caps TEXT");
});

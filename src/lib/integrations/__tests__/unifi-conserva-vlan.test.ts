// Incidente 21/10: la sincronizzazione UniFi delle 03:00 sostituiva tutte le porte e cancellava VLAN e STP letti via SNMP.
import { test } from "node:test";
import assert from "node:assert/strict";
import { conservaColonneNonDelController, type UnifiSwitchPortRow } from "@/lib/integrations/unifi-map";

const riga = (port_index: number, port_name: string, extra: Partial<UnifiSwitchPortRow> = {}): UnifiSwitchPortRow => ({
  port_index, port_name, status: "up", speed: null, duplex: null, vlan: null, poe_status: null, poe_power_mw: null,
  mac_count: 0, is_trunk: 0, single_mac: null, single_mac_vendor: null, single_mac_ip: null, single_mac_hostname: null,
  host_id: null, trunk_neighbor_name: null, trunk_neighbor_port: null, trunk_primary_device_id: null, trunk_primary_name: null,
  stp_state: null, is_uplink: 0, ...extra,
});

test("conserva vlan e stp già nel DB per indice e per nome", () => {
  const out = conservaColonneNonDelController(
    [riga(1, "Port 1"), riga(2, "Port 2")],
    [{ port_index: 1, port_name: "Port 1", vlan: 20, stp_state: "forwarding" }, { port_index: 2, port_name: "port2", vlan: 30, stp_state: null }],
  );
  assert.equal(out[0].vlan, 20);
  assert.equal(out[0].stp_state, "forwarding");
  assert.equal(out[1].vlan, 30);
});

test("un valore dato dal controller vince su quello esistente", () => {
  const out = conservaColonneNonDelController(
    [riga(1, "Port 1", { vlan: 5, stp_state: "blocking" })],
    [{ port_index: 1, port_name: "Port 1", vlan: 20, stp_state: "forwarding" }],
  );
  assert.equal(out[0].vlan, 5);
  assert.equal(out[0].stp_state, "blocking");
});

test("porta assente prima: vlan e stp restano null", () => {
  const out = conservaColonneNonDelController([riga(3, "Port 3")], [{ port_index: 1, port_name: "Port 1", vlan: 20, stp_state: "forwarding" }]);
  assert.equal(out[0].vlan, null);
  assert.equal(out[0].stp_state, null);
});

test("stesso indice ma nome di un'altra porta del controller: non si abbina (VLAN mai sulla porta sbagliata)", () => {
  const out = conservaColonneNonDelController(
    [riga(1, "Port 2"), riga(2, "Port 1")],
    [{ port_index: 1, port_name: "Port 1", vlan: 20, stp_state: null }],
  );
  assert.equal(out[0].vlan, null);
  assert.equal(out[1].vlan, 20);
});

test("senza righe esistenti le righe passano invariate", () => {
  const rows = [riga(1, "Port 1")];
  assert.deepEqual(conservaColonneNonDelController(rows, []), rows);
});

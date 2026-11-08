/**
 * Stormshield SNS come un firewall (Riccardo, 08/11): porte, VLAN, aggregati e ARP da `ifconfig -a` e `arp -an` di FreeBSD.
 * Prima SNS EVA2 sull'hub aveva 12 porte e l'ARP da SNMP, nessuna VLAN né interfaccia logica. Dati inventati.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArpFreebsd, parseIfconfigFreebsd } from "../stormshield-parsers";
import { collectorPossibili } from "../riconosci";
import { FIXTURE, STORMSHIELD_USCITE } from "./contratto-fixture";

test("stormshield: ifconfig di FreeBSD → interfacce, VLAN col padre, membri del lagg, velocità", () => {
  const i = parseIfconfigFreebsd(STORMSHIELD_USCITE["ifconfig -a"])!;
  assert.deepEqual(i.map((x) => x.nome), ["ix0", "ix1", "lagg0", "vlan0", "lo0", "pflog0"]);
  const ix0 = i[0];
  assert.deepEqual([ix0.descrizione, ix0.mac, ix0.velocitaBps, ix0.duplex, ix0.collegata, ix0.indirizzi], ["out", "02:00:00:00:95:01", 1e9, "full", true, [{ ip: "192.0.2.95", maschera: "255.255.255.0" }]]);
  assert.equal(i[1].velocitaBps, 10e9);
  assert.deepEqual(i[2].membri, ["ix2", "ix3"]);
  assert.deepEqual([i[3].vlanId, i[3].padre], [40, "ix1"]);
  assert.equal(parseIfconfigFreebsd("% Unknown command"), null);
});

test("stormshield: arp -an, le voci incomplete non hanno MAC; un testo estraneo è «non letto»", () => {
  assert.deepEqual(parseArpFreebsd(STORMSHIELD_USCITE["arp -an"]), [
    { ip: "192.0.2.1", mac: "02:00:00:00:a5:01", interfaccia: "ix0", permanente: false },
    { ip: "192.0.2.95", mac: "02:00:00:00:95:01", interfaccia: "ix0", permanente: true },
    { ip: "198.51.100.20", mac: "02:00:00:00:a5:20", interfaccia: "vlan0", permanente: false },
  ]);
  assert.equal(parseArpFreebsd("Unknown command"), null);
});

test("stormshield: il collector dà porte senza quelle di sistema, VLAN 40 tagged su ix1, lagg, ARP via SSH", async () => {
  const { snapshot: s } = await FIXTURE["stormshield-sns"].normale();
  assert.deepEqual(s.interfaces.data.map((x) => [x.name, x.kind]), [["ix0", "physical"], ["ix1", "physical"], ["lagg0", "aggregate"], ["vlan0", "other"]]);
  assert.deepEqual(s.vlans.data, [{ id: 40, name: "voip", description: null, tagged_ports: ["ix1"], untagged_ports: [], forbidden_ports: [] }]);
  assert.deepEqual(s.aggregation.data[0].members, ["ix2", "ix3"]);
  assert.equal(s.network.data.arp.length, 3);
  assert.equal(s.identity.data?.manufacturer, "Stormshield");
});

test("stormshield: riconosciuto dalla marca o dal profilo, qualunque tipo abbia", () => {
  assert.deepEqual(collectorPossibili({ vendor: "stormshield", device_type: "server" }), ["stormshield-sns"]);
  assert.deepEqual(collectorPossibili({ vendor: null, product_profile: "stormshield_firewall" }), ["stormshield-sns"]);
});

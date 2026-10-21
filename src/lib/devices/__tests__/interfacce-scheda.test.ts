/**
 * Interfacce di un apparato per la scheda router e firewall (21/10): `network_devices.physical_device_id` →
 * `device_interfaces` + `device_interface_addresses`. Un apparato senza `physical_device_id` NON è «nessuna
 * interfaccia»: la risposta lo distingue (`collegato: false`), così la scheda dice che manca l'abbinamento.
 *
 * Incidente evitato: «0 interfacce» scritto su un router che le ha, solo perché il collettore non l'ha ancora
 * abbinato a un apparato fisico.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/interfacce-scheda.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-interfacce-scheda";

import { withTenant, deleteTenantDatabase, createNetworkDevice } from "@/lib/db-tenant";
import {
  createPhysicalDevice, upsertDeviceInterface, upsertInterfaceAddress, setNetworkDevicePhysicalDevice,
} from "@/lib/devices/physical-device-db";
import { interfacceDellApparato } from "../interfacce-scheda";

const T = "TESTINTERFACCESCHEDA";
after(() => deleteTenantDatabase(T));

const nuovo = (nome: string, host: string) =>
  createNetworkDevice({ name: nome, host, device_type: "router", vendor: "mikrotik", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "router" } as never);

describe("interfacceDellApparato", () => {
  it("apparato con interfacce: nome, stato, velocità, MAC e indirizzi IPv4/IPv6", () => {
    withTenant(T, () => {
      const d = nuovo("rtr", "10.60.0.1");
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "test" });
      setNetworkDevicePhysicalDevice(d.id, pd.id);
      const a = upsertDeviceInterface(pd.id, { ifname: "sfp1", ifindex: 1, status: "up", speed_mbps: 10000, type: "ether", mac: "AA:BB:CC:00:00:01", alias: "WAN fibra" });
      upsertInterfaceAddress(a.id, { ip: "203.0.113.2", prefix: 29, family: 4 });
      upsertInterfaceAddress(a.id, { ip: "2001:db8::2", prefix: 64, family: 6 });
      upsertDeviceInterface(pd.id, { ifname: "ether8", ifindex: 8, status: "down" });

      const r = interfacceDellApparato(d.id);
      assert.ok(r);
      assert.equal(r.collegato, true);
      assert.equal(r.fonte, "device_interfaces");
      assert.deepEqual(r.interfacce.map((i) => i.ifname), ["sfp1", "ether8"]);
      const s = r.interfacce[0];
      assert.equal(s.stato, "up");
      assert.equal(s.velocita_mbps, 10000);
      assert.equal(s.alias, "WAN fibra");
      assert.equal(s.tipo, "ether");
      assert.deepEqual(s.indirizzi, [{ ip: "203.0.113.2", prefisso: 29, famiglia: 4 }, { ip: "2001:db8::2", prefisso: 64, famiglia: 6 }]);
      assert.deepEqual(r.interfacce[1].indirizzi, []);
      assert.ok(r.aggiornato, "data dell'ultimo aggiornamento");
    });
  });

  it("senza physical_device_id: lista vuota, collegato=false, aggiornato=null (non «nessuna interfaccia»)", () => {
    withTenant(T, () => {
      const d = nuovo("rtr2", "10.60.0.2");
      const r = interfacceDellApparato(d.id);
      assert.deepEqual(r, { interfacce: [], fonte: "device_interfaces", aggiornato: null, collegato: false });
    });
  });

  it("collegato ma senza interfacce lette: collegato=true, lista vuota", () => {
    withTenant(T, () => {
      const d = nuovo("rtr3", "10.60.0.3");
      const pd = createPhysicalDevice({ identity_confidence: 1, identity_anchor: "test" });
      setNetworkDevicePhysicalDevice(d.id, pd.id);
      const r = interfacceDellApparato(d.id);
      assert.equal(r?.collegato, true);
      assert.deepEqual(r?.interfacce, []);
    });
  });

  it("apparato inesistente: null (la rotta risponde 404)", () => {
    withTenant(T, () => {
      assert.equal(interfacceDellApparato(999999), null);
    });
  });
});

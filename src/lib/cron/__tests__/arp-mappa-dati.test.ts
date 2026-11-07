// Piano 2026-11-07, «tutti i dati»: la lettura `mappa_dati`. Sull'appliance 79993-ipam-2 la RB5009 impostata in SNMP aveva
// 0 MAC per porta con un accesso SSH provato; sull'hub tutti gli switch avevano 0 ARP e i router 0 VLAN.
// Hub isolato importato per primo (il perché sta in support/hub-isolato).
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getNetworkDeviceById, getTenantDb, withTenant } from "@/lib/db-tenant";
import { apparatoDelGiro, runArpPoll, vlanRouterDaLeggere } from "@/lib/cron/jobs";
import { scriviInterruttore } from "@/lib/topology/letture/interruttori";
import type { RouterClient } from "@/lib/devices/router-client";
import type { SwitchClient } from "@/lib/devices/switch-client";

const T = "TESTARPMAPPADATI";
const db = () => getTenantDb(T);
const ARP = [{ ip: "192.0.2.10", mac: "02:00:00:00:30:01", interface_name: "vlan10" }];
const accendi = () => withTenant(T, () => scriviInterruttore("mappa_dati", true, "prova"));
const lettore = (voci = ARP, viste: { n: number } = { n: 0 }) => async () => ({ async getArpTable() { viste.n++; return voci; }, async testConnection() { return true; } }) as RouterClient;
const switchFinto = (o: Partial<SwitchClient> = {}) => async () => ({ async getMacTable() { return []; }, async getPortSchema() { return []; }, async testConnection() { return true; }, ...o }) as unknown as SwitchClient;
const arpDi = (d: number) => (db().prepare("SELECT COUNT(*) AS n FROM arp_entries WHERE device_id = ?").get(d) as { n: number }).n;

beforeEach(() => {
  db().exec(`DELETE FROM device_credential_bindings; DELETE FROM mac_port_entries; DELETE FROM arp_entries; DELETE FROM hosts; DELETE FROM network_devices; DELETE FROM networks;
    DELETE FROM credentials WHERE id = 9; DELETE FROM tenant_settings WHERE key LIKE 'topologia.lettura.mappa_dati%';`);
  db().exec("INSERT INTO networks (id, cidr, name) VALUES (1, '192.0.2.0/24', 'LAN prova')");
  db().exec("INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (9, 'prova', 'ssh', 'x', 'x')");
  db().exec(`INSERT INTO network_devices (id, name, host, device_type, vendor, protocol, port, enabled, use_for_arp_poll) VALUES
    (1, 'RB', '192.0.2.1', 'router', 'mikrotik', 'snmp_v2', 161, 1, 1), (2, 'SW', '192.0.2.2', 'switch', 'hp', 'snmp_v2', 161, 1, 0), (3, 'FW', '192.0.2.3', 'firewall', 'stormshield', 'snmp_v2', 161, 1, 1)`);
});
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

const conBinding = (esito: string) => db().prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order, test_status) VALUES (1, 9, 'ssh', 2222, 0, ?)").run(esito);

test("spenta di serie: il MikroTik in SNMP resta in SNMP anche con un accesso SSH provato", () => {
  conBinding("success");
  withTenant(T, () => assert.equal(apparatoDelGiro(getNetworkDeviceById(1)!).protocol, "snmp_v2"));
});

test("accesa: il MikroTik con un accesso SSH provato si legge in SSH, sulla porta dell'accesso; il record non cambia", () => {
  conBinding("success"); accendi();
  withTenant(T, () => {
    const d = apparatoDelGiro(getNetworkDeviceById(1)!);
    assert.deepEqual([d.protocol, d.port], ["ssh", 2222]);
    assert.equal(getNetworkDeviceById(1)!.protocol, "snmp_v2");
  });
});

test("accesa: un accesso SSH fallito o mai provato non basta, e gli altri produttori non cambiano", () => {
  conBinding("failed"); accendi();
  withTenant(T, () => {
    assert.equal(apparatoDelGiro(getNetworkDeviceById(1)!).protocol, "snmp_v2");
    assert.equal(apparatoDelGiro(getNetworkDeviceById(3)!).protocol, "snmp_v2");
  });
});

test("router e firewall: le VLAN si leggono solo con la lettura accesa, e mai sul MikroTik in SSH", () => {
  withTenant(T, () => assert.equal(vlanRouterDaLeggere(getNetworkDeviceById(3)!), false));
  accendi();
  withTenant(T, () => {
    assert.equal(vlanRouterDaLeggere(getNetworkDeviceById(3)!), true);
    assert.equal(vlanRouterDaLeggere(getNetworkDeviceById(2)!), false, "lo switch ha la sua regola");
    assert.equal(vlanRouterDaLeggere({ ...getNetworkDeviceById(1)!, protocol: "ssh" }), false);
  });
});

const giro = (o: Parameters<typeof runArpPoll>[1]) => withTenant(T, () => runArpPoll(null, { skipDhcpLeases: true, creaClientRouter: async () => ({ async getArpTable() { return []; }, async testConnection() { return true; } }) as RouterClient, creaClientSwitch: switchFinto(), ...o }));

test("lo switch non ha ARP da spenta; accesa lo scrive", async () => {
  const viste = { n: 0 };
  await giro({ creaLettoreArp: lettore(ARP, viste) });
  assert.equal(viste.n, 0);
  assert.equal(arpDi(2), 0);
  accendi();
  await giro({ creaLettoreArp: lettore(ARP, viste) });
  assert.equal(arpDi(2), 1);
});

test("una lettura ARP vuota o guasta non cancella quella di prima, e non ferma la tabella MAC", async () => {
  accendi();
  await giro({ creaLettoreArp: lettore() });
  await giro({ creaLettoreArp: lettore([]) });
  assert.equal(arpDi(2), 1);
  let macLetti = 0;
  await giro({ creaLettoreArp: async () => { throw new Error("guasto"); }, creaClientSwitch: switchFinto({ async getMacTable() { macLetti++; return []; } }) });
  assert.equal(arpDi(2), 1);
  assert.ok(macLetti >= 1, "la tabella MAC si legge lo stesso");
});

test("un router senza bridge host con la lettura accesa scrive la tabella MAC SNMP", async () => {
  accendi();
  const fdb = [{ mac: "02:00:00:00:30:09", port_name: "1/1", vlan: 10, port_status: "up", speed: null }];
  await giro({ creaClientSwitch: switchFinto({ async getMacTable() { return fdb as never; } }), creaLettoreArp: lettore() });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM mac_port_entries WHERE device_id = 3").get() as { n: number }).n, 1);
});

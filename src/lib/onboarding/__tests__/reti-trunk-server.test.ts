/**
 * Reti del trunk nel wizard, lato server (28/10): la lettura si accende da sola
 * solo su un'appliance da un cliente con la sonda locale, e le reti scelte nascono
 * con VLAN, credenziali della nativa e host già visti.
 *
 * Run: node --import tsx --test src/lib/onboarding/__tests__/reti-trunk-server.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, getTenantSetting, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { accendiLetturaSeSondaLocale } from "@/lib/trunk/sensore-trunk";
import { creaRetiTrunk } from "@/lib/onboarding/reti-trunk-server";

const T = "TRUNKWIZ28";
const ORA = new Date().toISOString().slice(0, 19);
const sondaC = () => true;

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("lettura accesa da sola: un cliente, sonda locale, mai scelta a mano", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    d.prepare("DELETE FROM tenant_settings WHERE key = 'trunk_lettura'").run();
    assert.equal(accendiLetturaSeSondaLocale(2, sondaC), false, "più clienti: lo stesso trunk finirebbe in tutti");
    assert.equal(accendiLetturaSeSondaLocale(1, () => false), false, "senza sonda locale non si accende");
    assert.equal(getTenantSetting("trunk_lettura"), null);
    assert.equal(accendiLetturaSeSondaLocale(1, sondaC), true);
    assert.equal(getTenantSetting("trunk_lettura"), "1");
    setTenantSetting("trunk_lettura", "0");
    assert.equal(accendiLetturaSeSondaLocale(1, sondaC), false, "spenta a mano resta spenta");
    assert.equal(getTenantSetting("trunk_lettura"), "0");
  });
});

test("reti scelte: VLAN, credenziali della nativa, host dal trunk; una sovrapposta torna con l'errore", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.40.0.0/24', 'Già qui')").run();
    for (const [mac, ip, nome] of [["aa:bb:cc:00:20:01", "10.20.0.1", "gw20"], ["aa:bb:cc:00:20:02", "10.20.0.50", null]] as const) {
      d.prepare(
        `INSERT INTO trunk_osservazioni (vid, mac_normalized, mac_display, ip, nome, prima_vista, ultima_vista)
         VALUES (20, ?, ?, ?, ?, ?, ?)`,
      ).run(mac.replace(/:/g, "").toUpperCase(), mac.toUpperCase(), ip, nome, ORA, ORA);
    }
    const esito = creaRetiTrunk(
      [
        { vid: 20, cidr: "10.20.0.0/24", gateway: "10.20.0.1", nome: "Uffici" },
        { vid: 40, cidr: "10.40.0.0/24", gateway: "", nome: "Doppione" },
      ],
      { routerId: null, credentialIds: [], dns: "10.20.0.1" },
    );
    assert.equal(esito.esiti.length, 2);
    assert.equal(esito.esiti[0].errore, null);
    assert.ok(esito.esiti[1].errore, "sovrapposta a «Già qui»: errore, non un'eccezione");
    assert.equal(esito.host.creati, 2);
    const r = d.prepare("SELECT name, vlan_id, gateway, dns_server, description FROM networks WHERE id = ?").get(esito.esiti[0].id) as Record<string, unknown>;
    assert.deepEqual(r, { name: "Uffici", vlan_id: 20, gateway: "10.20.0.1", dns_server: "10.20.0.1", description: "Vista dal sensore trunk" });
    const h = d.prepare("SELECT ip, hostname FROM hosts WHERE network_id = ? ORDER BY ip").all(esito.esiti[0].id);
    assert.deepEqual(h.map((x) => (x as { ip: string }).ip), ["10.20.0.1", "10.20.0.50"]);
  });
});

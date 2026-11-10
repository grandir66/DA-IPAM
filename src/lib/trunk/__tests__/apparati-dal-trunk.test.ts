/**
 * Dagli annunci CDP/LLDP del trunk agli host (06/11/2026). Incidente: al 72729 due Cisco SG200-26 con
 * SNMP spento stavano `unknown` e senza modello mentre si annunciavano ogni 60 secondi.
 *
 * Run: node --import tsx --test src/lib/trunk/__tests__/apparati-dal-trunk.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { salvaVicini, type TrunkVicino } from "@/lib/trunk/sensore-trunk";
import { portaApparatiDalTrunk } from "@/lib/trunk/apparati-dal-trunk";

const T = "TRUNKAPP06";
const ORA = "2026-11-06T00:00:00Z";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

function rete(cidr: string): number {
  return Number(getTenantDb(T).prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(cidr, cidr).lastInsertRowid);
}
function host(net: number, ip: string, extra: Record<string, string | number> = {}): number {
  const col = ["network_id", "ip", ...Object.keys(extra)];
  const r = getTenantDb(T).prepare(`INSERT INTO hosts (${col.join(",")}) VALUES (${col.map(() => "?").join(",")})`)
    .run(net, ip, ...Object.values(extra));
  return Number(r.lastInsertRowid);
}
const riga = (id: number) => getTenantDb(T).prepare(
  "SELECT model, firmware, classification, attr_category FROM hosts WHERE id = ?",
).get(id) as { model: string | null; firmware: string | null; classification: string | null; attr_category: string | null };

const sg200 = (ip: string): TrunkVicino => ({
  protocollo: "cdp", sistema: `sw-${ip}`, porta: "gi25", vid: 0, indirizzo: ip, vlan_nativa: 1, ultima_vista: ORA,
  piattaforma: "Cisco SG200-26 (PID:SLM2024T)-VSD", versione: "1.3.2.02", capacita: "bridge", mac: null,
});

test("il caso del 72729: un SG200 che si annuncia diventa switch, con modello e firmware", async () => {
  await withTenant(T, async () => {
    const id = host(rete("192.168.0.0/24"), "192.168.0.53", { classification: "unknown" });
    salvaVicini([sg200("192.168.0.53")]);
    const e = portaApparatiDalTrunk();
    assert.equal(e.hostToccati, 1);
    const h = riga(id);
    assert.equal(h.model, "Cisco SG200-26 (PID:SLM2024T)-VSD");
    assert.equal(h.firmware, "1.3.2.02");
    assert.equal(h.attr_category, "network.switch");
    assert.equal(h.classification, "switch");
  });
});

test("si riempie, non si sovrascrive: modello già scritto e classificazione a mano restano", async () => {
  await withTenant(T, async () => {
    const id = host(rete("10.1.0.0/24"), "10.1.0.2", {
      model: "Scritto a mano", classification: "server", classification_manual: 1,
    });
    salvaVicini([sg200("10.1.0.2")]);
    portaApparatiDalTrunk();
    const h = riga(id);
    assert.equal(h.model, "Scritto a mano");
    assert.equal(h.firmware, "1.3.2.02");
    assert.equal(h.classification, "server");
  });
});

test("stesso IP in due reti: nessun legame, nessuna scrittura", async () => {
  await withTenant(T, async () => {
    const a = host(rete("172.16.0.0/24"), "172.16.0.9");
    const b = host(rete("172.16.0.0/25"), "172.16.0.9");
    salvaVicini([sg200("172.16.0.9")]);
    const e = portaApparatiDalTrunk();
    assert.equal(e.hostToccati, 0);
    assert.equal(riga(a).model, null);
    assert.equal(riga(b).model, null);
  });
});

test("LLDP senza indirizzo: l'host si trova dal MAC del telaio", async () => {
  await withTenant(T, async () => {
    const id = host(rete("10.2.0.0/24"), "10.2.0.3", { mac: "AA:BB:CC:00:00:03" });
    salvaVicini([{
      protocollo: "lldp", sistema: "core", porta: "1", vid: 0, indirizzo: null, vlan_nativa: null, ultima_vista: ORA,
      piattaforma: "HP J9660A Switch", versione: null, capacita: "bridge", mac: "aa:bb:cc:00:00:03",
    }]);
    portaApparatiDalTrunk();
    assert.equal(riga(id).model, "HP J9660A Switch");
  });
});

test("un sensore vecchio manda solo i campi di prima: niente errori e niente scritture", async () => {
  await withTenant(T, async () => {
    const id = host(rete("10.3.0.0/24"), "10.3.0.4");
    salvaVicini([{
      protocollo: "cdp", sistema: "vecchio", porta: "gi1", vid: 0, indirizzo: "10.3.0.4", vlan_nativa: 1, ultima_vista: ORA,
    }]);
    assert.equal(portaApparatiDalTrunk().hostToccati, 0);
    assert.equal(riga(id).model, null);
  });
});

test("un Linux con lldpd non è uno switch e la sua descrizione non è un modello (nodi Proxmox, T2-b)", async () => {
  await withTenant(T, async () => {
    const id = host(rete("10.4.0.0/24"), "10.4.0.5", { classification: "unknown" });
    salvaVicini([{
      protocollo: "lldp", sistema: "pve1", porta: "eno1", vid: 0, indirizzo: "10.4.0.5", vlan_nativa: null, ultima_vista: ORA,
      piattaforma: "Debian GNU/Linux 12 (bookworm) Linux 6.8.12-4-pve", versione: null, capacita: "bridge,router", mac: null,
    }]);
    portaApparatiDalTrunk();
    const h = riga(id);
    assert.equal(h.model, null);
    assert.notEqual(h.attr_category, "network.switch");
    assert.notEqual(h.attr_category, "network.router");
  });
});

// 10/11/2026, hub: un CRS504-4XQ si annuncia in CDP («MikroTik», capacità router) e in MNDP col
// modello vero. Il modello già scritto era «MikroTik» e la categoria «router».
test("MNDP: il modello annunciato sostituisce quello generico e decide il mestiere", () => {
  withTenant(T, () => {
    const net = rete("10.77.0.0/24");
    const generico = host(net, "10.77.0.5", { model: "MikroTik" });
    const routeros = host(net, "10.77.0.6", { model: "RouterOS (92QG-KMY6)" });
    const preciso = host(net, "10.77.0.7", { model: "CRS326-24G-2S+" });
    const annuncio = (ip: string, protocollo: string, piattaforma: string, capacita: string | null): TrunkVicino => ({
      protocollo, sistema: `mk-${ip}`, porta: protocollo === "cdp" ? "bridge/ether1" : "ether1", vid: 0, indirizzo: ip,
      vlan_nativa: null, ultima_vista: ORA, piattaforma, versione: "7.25.1", capacita, mac: null,
    });
    salvaVicini([
      annuncio("10.77.0.5", "cdp", "MikroTik", "router"),
      annuncio("10.77.0.5", "mndp", "CRS504-4XQ", null),
      annuncio("10.77.0.6", "mndp", "CCR2004-1G-12S+2XS", null),
      annuncio("10.77.0.7", "mndp", "CRS504-4XQ", null),
    ]);
    portaApparatiDalTrunk();
    assert.equal(riga(generico).model, "CRS504-4XQ", "«MikroTik» è solo il produttore: vince il modello annunciato");
    assert.equal(riga(generico).attr_category, "network.switch", "un CRS è uno switch, anche se in CDP si dichiara router");
    assert.equal(riga(routeros).model, "CCR2004-1G-12S+2XS");
    assert.equal(riga(preciso).model, "CRS326-24G-2S+", "un modello vero già scritto non si tocca");
  });
});

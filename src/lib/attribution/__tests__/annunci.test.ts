/**
 * Annunci di chi si presenta sulla rete (06/11/2026): dal CDP/LLDP sentito sul trunk sempre, dai vicini
 * letti via SNMP solo a interruttore acceso, perché l'ADR 0018 vuole che una lettura in più non cambi le
 * classificazioni da sola.
 *
 * Run: node --import tsx --test src/lib/attribution/__tests__/annunci.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getAttributionSignalsForHost, getTenantDb, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { categoriaDaCapacita, CHIAVE_VICINI_SNMP } from "@/lib/attribution/annunci";
import { emitEvidenceFromSignals } from "@/lib/attribution/emitters";

const T = "ANNUNCI06";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("capacità: il mestiere dichiarato, in ordine di specificità", () => {
  assert.equal(categoriaDaCapacita("bridge", null), "network.switch");
  assert.equal(categoriaDaCapacita("router", null), "network.router");
  assert.equal(categoriaDaCapacita("wlan-ap,bridge", null), "network.access_point");
  assert.equal(categoriaDaCapacita("station,telephone", null), "voip.phone");
  assert.equal(categoriaDaCapacita("station", null), null);
  assert.equal(categoriaDaCapacita(null, null), null);
});

test("capacità: uno switch L3 e un router con bridge non si distinguono, si resta su «rete»", () => {
  assert.equal(categoriaDaCapacita("bridge,router", null), "network");
});

test("capacità: un sistema operativo nella descrizione le annulla (lldpd su Linux)", () => {
  assert.equal(categoriaDaCapacita("bridge,router", "Debian GNU/Linux 12 Linux 6.8.12-4-pve"), null);
  assert.equal(categoriaDaCapacita("bridge", "VMware ESXi 8.0"), null);
});

test("vicino SNMP: spento non pesa, acceso sì, e la fonte di oggi resta com'era", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const net = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'n')").run().lastInsertRowid);
    const hostId = Number(d.prepare("INSERT INTO hosts (network_id, ip, mac) VALUES (?, '10.9.0.2', 'AA:BB:CC:00:00:02')").run(net).lastInsertRowid);
    const devId = Number(d.prepare("INSERT INTO network_devices (name, host, device_type, vendor, protocol) VALUES ('sw', '10.9.0.1', 'switch', 'other', 'snmp_v2')").run().lastInsertRowid);
    d.prepare(`INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_mac, source, remote_caps, timestamp, first_seen)
      VALUES (?, 'p1', 'AA:BB:CC:00:00:02', 'gi7', 'lldp', 'AA:BB:CC:00:00:02', 'snmp', 'bridge', datetime('now'), datetime('now'))`).run(devId);

    const prima = getAttributionSignalsForHost(hostId)!;
    assert.deepEqual(prima.annunci, []);
    assert.equal(emitEvidenceFromSignals(prima).some((e) => e.source === "lldp"), false);

    setTenantSetting(CHIAVE_VICINI_SNMP, "1");
    const dopo = getAttributionSignalsForHost(hostId)!;
    assert.equal(dopo.neighborSightings.length, 0, "il filtro di ADR 0018 non si tocca");
    const ev = emitEvidenceFromSignals(dopo).find((e) => e.source === "lldp");
    assert.equal(ev?.claim, "network.switch");
  });
});

test("-O: il testo di nmap dice il mestiere, a confidenza bassa", () => {
  const base = { id: 1, ip: "10.0.0.1", mac: null, vendor: null, hostname: null, open_ports: null, snmp_data: null, detection_json: null };
  const segnali = (os_info: string) => ({ host: { ...base, os_info }, adComputer: null, wazuh: null, neighborSightings: [] });
  const cat = (os: string) => emitEvidenceFromSignals(segnali(os)).find((e) => e.source === "nmap_os" && e.dimension === "category");
  assert.equal(cat("Cisco SG200 or SG300 switch")?.claim, "network.switch");
  assert.equal(cat("HP 2530 switch")?.confidence, 0.7);
  assert.equal(cat("Linux 3.2 - 4.9"), undefined);
  assert.equal(cat("Cisco SG200 or SG300 switch (ipotesi 87%)"), undefined, "un'ipotesi non dà un mestiere");
  const fam = emitEvidenceFromSignals(segnali("Linux 5.4 (ipotesi 90%)")).find((e) => e.source === "nmap_os" && e.dimension === "os");
  assert.equal(fam?.claim, "linux", "ma la famiglia del sistema operativo resta");
  assert.equal(cat("Microsoft Windows 10"), undefined);
});

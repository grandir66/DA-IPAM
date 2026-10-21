/**
 * Le quattro letture della tab «Dispositivi» (21/10): `ingressoDispositivi` prende solo ARP, lease e vicini DELL'APPARATO
 * (non di un altro router), e gli host IPAM per IP in blocco. Unito a `unisciDispositivi` dà la riga attesa.
 *
 * Incidente evitato: lease o ARP di un altro router nella tab di questo; nome DNS letto dall'host sbagliato.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/dispositivi-ingresso.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-dispositivi-ingresso";

import { withTenant, deleteTenantDatabase, createNetworkDevice, upsertDhcpLease } from "@/lib/db-tenant";
import { ingressoDispositivi } from "@/lib/db-tenant";
import { getDb } from "@/lib/db";
import { unisciDispositivi } from "@/lib/scheda/dispositivi-router";

const T = "TESTDISPOSITIVIINGR";
after(() => deleteTenantDatabase(T));

const nuovo = (nome: string, host: string) =>
  createNetworkDevice({ name: nome, host, device_type: "router", vendor: "mikrotik", protocol: "ssh", api_url: null, port: 22, enabled: 1, classification: "router" } as never);

describe("ingressoDispositivi", () => {
  it("solo le righe dell'apparato; host IPAM per IP; unione con le precedenze", () => {
    withTenant(T, () => {
      const a = nuovo("rtr-a", "10.70.0.1");
      const b = nuovo("rtr-b", "10.70.0.2");
      const d = getDb();
      d.prepare("INSERT INTO arp_entries (device_id, mac, ip, interface_name, status) VALUES (?, ?, ?, ?, ?)").run(a.id, "00:11:22:33:44:55", "10.70.1.5", "vlan10", "reachable");
      d.prepare("INSERT INTO arp_entries (device_id, mac, ip, interface_name, status) VALUES (?, ?, ?, ?, ?)").run(b.id, "00:11:22:33:44:66", "10.70.1.6", "vlan10", "reachable");
      upsertDhcpLease({ source_type: "mikrotik", source_device_id: a.id, ip_address: "10.70.1.5", mac_address: "00:11:22:33:44:56", hostname: "pc-uno", dynamic_lease: 0, description: "ufficio" });
      upsertDhcpLease({ source_type: "mikrotik", source_device_id: b.id, ip_address: "10.70.1.6", mac_address: "00:11:22:33:44:66", hostname: "altro" });
      d.prepare("INSERT INTO device_neighbors (device_id, local_port, remote_device_name, remote_port, protocol, remote_ip, remote_mac, source) VALUES (?, 'ether5', 'SW-1', 'p1', 'lldp', '10.70.1.9', '00:AA:BB:00:00:01', 'device')").run(a.id);
      d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.70.1.0/24', 'prova')").run();
      const net = (d.prepare("SELECT id FROM networks WHERE cidr='10.70.1.0/24'").get() as { id: number }).id;
      d.prepare("INSERT INTO hosts (network_id, ip, status, custom_name, hostname) VALUES (?, '10.70.1.9', 'online', NULL, 'sw1.lan')").run(net);

      const i = ingressoDispositivi(a.id);
      assert.deepEqual(i.arp.map((x) => x.ip), ["10.70.1.5"]);
      assert.deepEqual(i.lease.map((x) => x.ip_address), ["10.70.1.5"]);
      assert.deepEqual(i.vicini.map((x) => x.remote_ip), ["10.70.1.9"]);
      assert.deepEqual(i.host.map((x) => [x.ip, x.nome_dns]), [["10.70.1.9", "sw1.lan"]]);

      const righe = unisciDispositivi(i, () => null);
      assert.deepEqual(righe.map((r) => r.ip), ["10.70.1.5", "10.70.1.9"]);
      assert.equal(righe[0].mac, "00:11:22:33:44:56");
      assert.equal(righe[0].macArpDiverso, "00:11:22:33:44:55");
      assert.equal(righe[0].lease, "statico");
      assert.equal(righe[1].nome, "SW-1");
      assert.equal(righe[1].fonteNome, "lldp");
    });
  });

  // 22/10, revisione finale: l'host si cercava in tutto il tenant per IP. Un host di un'altra sede con lo stesso IP
  // (e online) teneva in vita un'ARP «failed» di questo router e gli prestava il nome DNS.
  it("stesso IP in due reti: vale l'host della rete servita dal router; senza reti servite, IP ambiguo = nessun host", () => {
    withTenant(T, () => {
      const a = nuovo("rtr-sede-a", "10.71.0.1");
      const b = nuovo("rtr-senza-reti", "10.71.0.2");
      const d = getDb();
      d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.71.1.0/24', 'sede-a')").run();
      d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.71.0.0/16', 'sede-b')").run();
      const netA = (d.prepare("SELECT id FROM networks WHERE cidr='10.71.1.0/24'").get() as { id: number }).id;
      const netB = (d.prepare("SELECT id FROM networks WHERE cidr='10.71.0.0/16'").get() as { id: number }).id;
      d.prepare("INSERT INTO network_router (network_id, router_id) VALUES (?, ?)").run(netA, a.id);
      d.prepare("INSERT INTO hosts (network_id, ip, status, hostname) VALUES (?, '10.71.1.7', 'offline', 'qui.lan')").run(netA);
      d.prepare("INSERT INTO hosts (network_id, ip, status, hostname) VALUES (?, '10.71.1.7', 'online', 'altra-sede.lan')").run(netB);
      for (const r of [a, b]) {
        d.prepare("INSERT INTO arp_entries (device_id, mac, ip, interface_name, status) VALUES (?, '00:11:22:33:44:77', '10.71.1.7', 'vlan10', 'failed')").run(r.id);
      }

      const ia = ingressoDispositivi(a.id);
      assert.deepEqual(ia.host.map((h) => h.nome_dns), ["qui.lan"], "solo l'host della rete servita");
      assert.deepEqual(unisciDispositivi(ia, () => null).map((r) => r.ip), [], "l'ARP fallita non la conferma l'altra sede");

      const ib = ingressoDispositivi(b.id);
      assert.deepEqual(ib.host, [], "due host con lo stesso IP e nessuna rete servita: non si collega");
      assert.deepEqual(unisciDispositivi(ib, () => null).map((r) => r.ip), []);
    });
  });

  // 22/10, revisione finale: i lease non si cancellano mai (upsert), quindi un lease sparito dal router restava
  // nella tab per sempre. Si tengono quelli riscritti entro un giorno dall'ultima lettura dell'apparato.
  it("lease: solo quelli della finestra dell'ultima lettura dell'apparato", () => {
    withTenant(T, () => {
      const c = nuovo("rtr-lease", "10.73.0.1");
      const d = getDb();
      for (const ip of ["10.73.1.1", "10.73.1.2", "10.73.1.3"]) {
        upsertDhcpLease({ source_type: "mikrotik", source_device_id: c.id, ip_address: ip, mac_address: "00:11:22:33:44:88", hostname: ip });
      }
      d.prepare("UPDATE dhcp_leases SET last_synced = datetime('now', '-3 days') WHERE source_device_id = ? AND ip_address = '10.73.1.1'").run(c.id);
      d.prepare("UPDATE dhcp_leases SET last_synced = datetime('now', '-2 hours') WHERE source_device_id = ? AND ip_address = '10.73.1.2'").run(c.id);
      assert.deepEqual(ingressoDispositivi(c.id).lease.map((l) => l.ip_address).sort(), ["10.73.1.2", "10.73.1.3"]);
    });
  });
});

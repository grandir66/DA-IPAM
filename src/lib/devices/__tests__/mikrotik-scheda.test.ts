/**
 * Risorse e hardware MikroTik dalle uscite vere del router (fixture anonimizzate).
 * Incidente: il Manager trattava MiB e GiB come lo stesso numero; qui si converte davvero.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/mikrotik-scheda.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { byteRouterOs, parseBondScheda, parseBridgeScheda, parsePorteBridgeScheda, parseRisorse, parseRouterboard } from "../mikrotik-scheda";
import { parseMikrotikArp } from "../router-client";

const fx = (n: string) => readFileSync(join(__dirname, "fixtures", n), "utf8");

describe("byteRouterOs", () => {
  it("converte davvero KiB/MiB/GiB", () => {
    assert.equal(byteRouterOs("1.0GiB"), 1073741824);
    assert.equal(byteRouterOs("1024.0MiB"), 1073741824);
    assert.equal(byteRouterOs("47.0KiB"), 48128);
    assert.equal(byteRouterOs("4096"), 4096);
  });
  it("illeggibile -> null", () => {
    assert.equal(byteRouterOs("x"), null);
    assert.equal(byteRouterOs(""), null);
    assert.equal(byteRouterOs(null), null);
  });
});

describe("parseRisorse", () => {
  const r = parseRisorse(fx("mikrotik-resource.txt"));
  it("campi dalla fixture vera", () => {
    assert.equal(r.uptime, "2w20m57s");
    assert.equal(r.uptime_s, 2 * 604800 + 20 * 60 + 57);
    assert.equal(r.versione, "7.24.5 (stable)");
    assert.equal(r.build, "2026-09-29 14:21:27");
    assert.equal(r.cpu, "ARM64");
    assert.equal(r.cpu_core, 4);
    assert.equal(r.cpu_mhz, 1700);
    assert.equal(r.cpu_carico, 1);
    assert.equal(r.memoria_totale_b, 4096 * 1048576);
    assert.equal(r.memoria_libera_b, Math.round(3729.3 * 1048576));
    assert.equal(r.disco_totale_b, 128 * 1048576);
    assert.equal(r.disco_libero_b, Math.round(83.4 * 1048576));
    assert.equal(r.architettura, "arm64");
    assert.equal(r.board, "CCR2004-1G-12S+2XS");
    assert.equal(r.piattaforma, "MikroTik");
  });
  it("uscita vuota -> tutto null", () => {
    const v = parseRisorse("");
    assert.ok(Object.values(v).every((x) => x === null));
  });
});

describe("parseRouterboard", () => {
  it("fixture vera", () => {
    const h = parseRouterboard(fx("mikrotik-routerboard.txt"));
    assert.equal(h.routerboard, true);
    assert.equal(h.modello, "CCR2004-1G-12S+2XS");
    assert.equal(h.seriale, "A0A0A0A0A0A0");
    assert.equal(h.firmware_tipo, "al64");
    assert.equal(h.firmware_corrente, "7.10.2");
    assert.equal(h.firmware_aggiornabile, "7.24.5");
    assert.equal(h.revisione, null);
  });
  it("CHR: routerboard no -> campi null", () => {
    const h = parseRouterboard("routerboard: no\n");
    assert.equal(h.routerboard, false);
    assert.equal(h.modello, null);
    assert.equal(h.seriale, null);
    assert.equal(h.firmware_corrente, null);
    assert.equal(h.firmware_aggiornabile, null);
  });
});

describe("parseMikrotikArp (stato e dinamico)", () => {
  const arp = parseMikrotikArp(fx("mikrotik-arp-terse.txt"));
  it("status= e flag D dalla fixture vera", () => {
    assert.deepEqual(arp[0], { ip: "10.20.1.178", mac: "02:00:A0:10:00:01", interface_name: "VL_4_ZONA01", status: "permanent", dynamic: false });
    assert.deepEqual(arp[1], { ip: "10.20.2.45", mac: "02:00:A0:10:00:02", interface_name: "VL_40_ZONA02", status: "incomplete", dynamic: true });
    assert.equal(arp[2].status, "reachable");
    assert.equal(arp[2].dynamic, true, "DC: dinamica e connessa");
  });
  it("le righe senza MAC (incomplete/failed) non entrano, come prima", () => {
    assert.ok(arp.every((e) => e.mac !== ""));
    assert.equal(arp.find((e) => e.ip === "10.20.1.35"), undefined);
  });
  it("ogni stato presente nella fixture è uno dei sei di RouterOS", () => {
    const stati = new Set(arp.map((e) => e.status));
    for (const s of stati) assert.ok(["reachable", "stale", "delay", "failed", "incomplete", "permanent"].includes(String(s)), String(s));
  });
});

// Task 8 (P3): attributi di bridge, porte e bond per le tabelle della scheda, dalle uscite che la lettura della topologia
// riceve già (MK3, MK4, MK8). Fixture vere anonimizzate (rete B 14/10 e router dell'hub 21/10).
describe("parseBridgeScheda", () => {
  it("testa: vlan_filtering sì, priority com'è scritta, segno R", () => {
    const [b] = parseBridgeScheda(fx("mikrotik-mk3-testa.txt"));
    assert.deepEqual(b, {
      name: "BR_RP", mac_address: "02:00:A0:10:0E:02", mtu: "auto", actual_mtu: 1500, l2mtu: 1592, arp: "enabled", arp_timeout: "auto",
      protocol_mode: "rstp", priority: "0x0000", fast_forward: true, igmp_snooping: false, dhcp_snooping: false, vlan_filtering: true,
      pvid: 1, frame_types: "admit-all", ingress_filtering: true, ether_type: "0x8100", ageing_time: "5m", forward_delay: "15s",
      max_message_age: "20s", comment: null, running: true, disabled: false,
    });
  });
  it("frontiera: due bridge, il secondo senza vlan filtering e senza pvid", () => {
    const r = parseBridgeScheda(fx("mikrotik-mk3-frontiera.txt"));
    assert.deepEqual(r.map((b) => [b.name, b.priority, b.vlan_filtering, b.pvid, b.ether_type]),
      [["BR_RP", "0x8000", true, 1, "0x8100"], ["BR_ZQ_77K", "0x8000", false, null, null]]);
  });
  it("router dell'hub: un bridge; X = spento, commento con spazi", () => {
    assert.equal(parseBridgeScheda(fx("mikrotik-bridge-terse.txt")).length, 1);
    const [b] = parseBridgeScheda(" 0 X comment=ponte di prova name=br-prova mtu=1500 protocol-mode=none");
    assert.deepEqual([b.name, b.comment, b.running, b.disabled, b.mtu, b.actual_mtu], ["br-prova", "ponte di prova", false, true, "1500", null]);
  });
});

describe("parsePorteBridgeScheda", () => {
  it("testa: pvid 214, hw sì, inactive sulle righe I, path cost dove c'è", () => {
    const r = parsePorteBridgeScheda(fx("mikrotik-mk4-testa.txt"));
    assert.equal(r.length, 10);
    assert.deepEqual(r[0], {
      interface: "sfp-sfpplus1", bridge: "BR_RP", pvid: 214, priority: "0x80", path_cost: 10, internal_path_cost: 10, edge: "auto",
      point_to_point: "auto", horizon: "none", hw: true, hw_offload: false, frame_types: "admit-all", ingress_filtering: true,
      bpdu_guard: false, trusted: false, inactive: false, disabled: false, dynamic: false, comment: null,
    });
    assert.deepEqual(r.filter((p) => p.inactive).map((p) => p.interface), ["sfp-sfpplus5"]);
    assert.deepEqual([r[6].interface, r[6].pvid, r[6].path_cost], ["bond1", 1, null]);
  });
  it("frontiera: due porte inattive su due bridge", () => {
    const r = parsePorteBridgeScheda(fx("mikrotik-mk4-frontiera.txt"));
    assert.deepEqual(r.map((p) => [p.interface, p.bridge, p.inactive]),
      [["sfp-sfpplus12", "BR_RP", false], ["bonding1", "BR_RP", true], ["sfp-sfpplus8", "BR_ZQ_77K", true]]);
  });
  it("segni D, H, X: dinamica, offload in hardware, spenta", () => {
    const r = parsePorteBridgeScheda(" 0 DH interface=ether2 bridge=br hw=yes\n 1 X interface=ether3 bridge=br");
    assert.deepEqual(r.map((p) => [p.dynamic, p.hw_offload, p.disabled, p.hw]), [[true, true, false, true], [false, false, true, null]]);
  });
});

describe("parseBondScheda", () => {
  it("testa: slaves di bond1, transmit hash policy, mlag_id assente = null, commento", () => {
    const r = parseBondScheda(fx("mikrotik-mk8a-testa.txt"));
    assert.equal(r.length, 3);
    assert.deepEqual(r[0], {
      name: "bond1", mode: "802.3ad", slaves: ["sfp28-2", "sfp28-1"], transmit_hash_policy: "layer-3-and-4", mlag_id: null,
      link_monitoring: "mii", mii_interval: "100ms", lacp_rate: "30secs", mtu: 1500, comment: "cavo-a", running: true, disabled: false,
    });
    assert.equal(r[2].transmit_hash_policy, "layer-2");
  });
  it("frontiera: senza R il fascio non è attivo", () => {
    const [b] = parseBondScheda(fx("mikrotik-mk8a-frontiera.txt"));
    assert.deepEqual([b.name, b.running, b.disabled, b.slaves], ["bonding1", false, false, ["sfp28-1", "sfp28-2"]]);
  });
});

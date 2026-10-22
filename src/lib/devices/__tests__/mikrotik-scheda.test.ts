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

import {
  byteRouterOs, parseBondScheda, parseBridgeScheda, parseDns, parsePorteBridgeScheda, parseRisorse, parseRouterboard, parseUtenti, parseVlanBridge,
  parseVlanInterfacce,
} from "../mikrotik-scheda";
import { COMANDI_MK_SCHEDA, TEMPO_COMANDO_MS, leggiMikrotikScheda } from "../mikrotik-letture";
import { ComandoScaduto } from "../ssh-transport";
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

// ── Task 10: VLAN dei bridge, interfacce VLAN, DNS, utenti (lettura «mikrotik_scheda», spenta di default) ─────────────

describe("parseVlanBridge", () => {
  it("fixture vera: 12 righe, liste tagged/untagged, commento intero con lo spazio, riga senza commento", () => {
    const r = parseVlanBridge(fx("mikrotik-bridge-vlan-terse.txt"));
    assert.equal(r.length, 12);
    assert.deepEqual(r[0], {
      bridge: "BR_LAN", vlan_ids: "2",
      tagged: ["BR_LAN", "sfp-sfpplus1", "sfp-sfpplus2", "sfp-sfpplus3", "sfp-sfpplus4", "sfp-sfpplus5", "sfp-sfpplus6", "bond1", "bond2"],
      untagged: [], current_tagged: ["BR_LAN", "sfp-sfpplus1", "sfp-sfpplus2", "sfp-sfpplus3", "sfp-sfpplus4", "bond2", "bond1", "sfp-sfpplus6"],
      current_untagged: [], dynamic: false, disabled: false, comment: "VLAN ZONA01",
    });
    const ultima = r[11];
    assert.deepEqual([ultima.vlan_ids, ultima.comment, ultima.tagged, ultima.untagged], ["1", null, ["bond2"], ["BR_LAN", "sfp-sfpplus6", "bond1", "bond3"]]);
    assert.deepEqual(r.map((x) => x.vlan_ids), ["2", "4", "5", "6", "7", "15", "16", "20", "40", "133", "666", "1"]);
  });
  it("segni D e X; vlan-ids con elenco e intervallo restano com'è scritto (riga costruita: la fixture vera non ne ha)", () => {
    const r = parseVlanBridge(" 0 D bridge=br1 vlan-ids=100-110,200 tagged=ether1 untagged= current-tagged=ether1 current-untagged=\n 1 X bridge=br1 vlan-ids=7 tagged= untagged=ether2");
    assert.deepEqual(r.map((x) => [x.vlan_ids, x.dynamic, x.disabled, x.untagged]), [["100-110,200", true, false, []], ["7", false, true, ["ether2"]]]);
  });
  it("una riga senza bridge o senza vlan-ids non si legge", () => {
    assert.deepEqual(parseVlanBridge(" 0 bridge=br1 tagged=ether1\n 1 vlan-ids=3"), []);
  });
});

describe("parseVlanInterfacce", () => {
  it("fixture vera: 11 VLAN sul bridge, id, MTU, MAC, attive", () => {
    const r = parseVlanInterfacce(fx("mikrotik-vlan-terse.txt"));
    assert.equal(r.length, 11);
    assert.deepEqual(r[0], { name: "VL_2_ZONA07", vlan_id: 2, interface: "BR_LAN", mtu: 1500, mac_address: "02:00:A0:10:00:11", running: true, disabled: false, comment: null });
    assert.ok(r.every((v) => v.interface === "BR_LAN" && v.running));
    assert.equal(r[10].vlan_id, 666);
  });
  it("segno X e commento", () => {
    const [v] = parseVlanInterfacce(" 0 X name=vl9 mtu=1500 vlan-id=9 interface=ether1 comment=ufficio due");
    assert.deepEqual([v.name, v.disabled, v.running, v.comment], ["vl9", true, false, "ufficio due"]);
  });
});

describe("parseDns", () => {
  it("fixture vera: due server su due righe, nessun server dinamico, cache e richieste remote", () => {
    assert.deepEqual(parseDns(fx("mikrotik-dns.txt")), {
      servers: ["10.20.1.1", "10.20.1.2"], dynamic_servers: [], allow_remote_requests: true, cache_size: "2048KiB",
      cache_used: "48KiB", max_concurrent_queries: 100, use_doh_server: null,
    });
  });
  it("server separati da virgola e IPv6 sulla riga dopo (non sono chiavi)", () => {
    const d = parseDns("  servers: 1.1.1.1,8.8.8.8\n           2001:db8::53\n  dynamic-servers: 192.0.2.1\n  allow-remote-requests: no\n");
    assert.deepEqual([d?.servers, d?.dynamic_servers, d?.allow_remote_requests], [["1.1.1.1", "8.8.8.8", "2001:db8::53"], ["192.0.2.1"], false]);
  });
  it("nessuna chiave nota → null (non «DNS vuoto»)", () => {
    assert.equal(parseDns("qualcosa di inatteso"), null);
    assert.equal(parseDns(""), null);
  });
});

describe("parseUtenti", () => {
  it("fixture vera: quattro utenti, gruppo, indirizzi, ultimo accesso con l'ora, commento", () => {
    const r = parseUtenti(fx("mikrotik-user-terse.txt"));
    assert.equal(r.length, 4);
    assert.deepEqual(r[0], { name: "utente01", group: "full", address: null, last_logged_in: "2026-09-30 15:10:51", disabled: false, comment: "commento 01" });
    assert.equal(r[1].comment, null);
    assert.equal(r[3].address, "10.20.11.0/16,10.20.12.0/8,10.20.13.0/12,198.51.100.1/10");
    assert.deepEqual(r.map((u) => u.group), ["full", "full", "gruppo01", "gruppo02"]);
  });
  it("nessuna password, anche se l'uscita avesse un campo così; segno X", () => {
    const [u] = parseUtenti("0 X name=u1 group=read password=segreto last-logged-in=");
    assert.deepEqual(Object.keys(u).sort(), ["address", "comment", "disabled", "group", "last_logged_in", "name"]);
    assert.equal(JSON.stringify(u).includes("segreto"), false);
    assert.deepEqual([u.disabled, u.last_logged_in], [true, null]);
  });
});

describe("leggiMikrotikScheda", () => {
  const USCITE: Record<string, string> = {
    [COMANDI_MK_SCHEDA.vlanBridge]: fx("mikrotik-bridge-vlan-terse.txt"), [COMANDI_MK_SCHEDA.vlan]: fx("mikrotik-vlan-terse.txt"),
    [COMANDI_MK_SCHEDA.dns]: fx("mikrotik-dns.txt"), [COMANDI_MK_SCHEDA.utenti]: fx("mikrotik-user-terse.txt"),
  };
  const finto = (diverse: Record<string, () => Promise<string>> = {}) => {
    const mandati: Array<[string, number]> = [];
    return {
      mandati,
      esegui: async (cmd: string, tempo: number) => {
        mandati.push([cmd, tempo]);
        return diverse[cmd] ? diverse[cmd]() : USCITE[cmd];
      },
    };
  };
  it("i quattro comandi, in sola lettura, ognuno col suo tempo; tutto letto", async () => {
    const f = finto();
    const r = await leggiMikrotikScheda(f.esegui);
    assert.deepEqual(f.mandati, Object.values(COMANDI_MK_SCHEDA).map((c) => [c, TEMPO_COMANDO_MS]));
    assert.ok(f.mandati.every(([c]) => / print( |$)/.test(c)), "solo print");
    assert.deepEqual([r.vlanBridge?.length, r.vlan?.length, r.dns?.servers.length, r.utenti?.length, r.comandi, r.riusciti, r.codice], [12, 11, 2, 4, 4, 4, null]);
  });
  it("un comando in errore RouterOS → quella parte null e il codice; le altre lette", async () => {
    const r = await leggiMikrotikScheda(finto({ [COMANDI_MK_SCHEDA.vlan]: async () => "bad command name vlan (line 1 column 12)" }).esegui);
    assert.deepEqual([r.vlan, r.vlanBridge?.length, r.dns === null, r.utenti?.length, r.comandi, r.riusciti, r.codice], [null, 12, false, 4, 4, 3, "BAD_COMMAND"]);
  });
  it("uscita non capita → null, mai []; tempo scaduto → null; letto e vuoto → []", async () => {
    const r = await leggiMikrotikScheda(finto({
      [COMANDI_MK_SCHEDA.vlanBridge]: async () => "Flags: qualcosa che non si legge",
      [COMANDI_MK_SCHEDA.dns]: async () => "uscita senza chiavi",
      [COMANDI_MK_SCHEDA.utenti]: async () => { throw new ComandoScaduto(20_000); },
      [COMANDI_MK_SCHEDA.vlan]: async () => "",
    }).esegui);
    assert.deepEqual([r.vlanBridge, r.dns, r.utenti, r.vlan], [null, null, null, []]);
    assert.deepEqual([r.comandi, r.riusciti, r.codice], [4, 1, "USCITA_NON_CAPITA"]);
  });
});

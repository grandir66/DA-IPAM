/**
 * Pezzi puri della Panoramica MikroTik (21/10): gruppo e stato delle interfacce, uso in percentuale, contatori e
 * caselle della striscia. Incidente evitato: il Manager metteva `wg` in «Altro»; un totale 0 non deve dare NaN.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/mikrotik.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { descriviBond, espandiVlanIds, matriceVlan, statoPortaBridge, caselleMikrotik, nomeFileExport, ripulisciExport, statoArp, contatoriMikrotik, gruppoInterfaccia, perTipo, raggruppaInterfacce, statoInterfaccia, usoPercento } from "../mikrotik";
import type { InterfacciaScheda } from "../router";
import type { HardwareMikrotik, RigaBondMk, RigaBridgeMk, RigaPortaBridgeMk, RigaVlanBridgeMk, RigaVlanMk, RisorseMikrotik } from "@/lib/devices/mikrotik-scheda";

const ifc = (ifname: string, tipo: string | null, stato: "up" | "down" | "unknown" = "up", extra: Partial<InterfacciaScheda> = {}): InterfacciaScheda => ({
  ifname, alias: null, stato, velocita_mbps: null, tipo, mtu: null, disabilitata: null, aggiornato: null, mac: null, indirizzi: [], ...extra,
});

describe("gruppoInterfaccia", () => {
  it("i tipi della tavola", () => {
    assert.equal(gruppoInterfaccia("ether"), "ethernet");
    assert.equal(gruppoInterfaccia("ethernet"), "ethernet");
    assert.equal(gruppoInterfaccia("vlan"), "vlan");
    assert.equal(gruppoInterfaccia("bond"), "bond");
    assert.equal(gruppoInterfaccia("bonding"), "bond");
    assert.equal(gruppoInterfaccia("bridge"), "bridge");
  });
  it("wg e i tunnel sono vpn_tunnel (il Manager metteva wg in Altro)", () => {
    for (const t of ["wg", "wireguard", "ovpn-in", "ovpn-out", "l2tp-client", "sstp-out", "pptp-in", "eoip", "eoipv6", "gre", "gre6", "ipip", "vxlan"]) {
      assert.equal(gruppoInterfaccia(t), "vpn_tunnel", t);
    }
  });
  it("il resto e null vanno in altro; maiuscole e spazi non contano", () => {
    for (const t of ["loopback", "vrrp", "pppoe-out", "wlan", "wifi", "cap", "lte", "", null]) assert.equal(gruppoInterfaccia(t), "altro", String(t));
    assert.equal(gruppoInterfaccia(" VLAN "), "vlan");
  });
});

describe("statoInterfaccia", () => {
  it("disabilitata vince su up", () => assert.equal(statoInterfaccia({ stato: "up", disabilitata: true }), "disabilitata"));
  it("up = attiva; down e unknown = inattiva; disabilitata null non conta", () => {
    assert.equal(statoInterfaccia({ stato: "up", disabilitata: null }), "attiva");
    assert.equal(statoInterfaccia({ stato: "down", disabilitata: false }), "inattiva");
    assert.equal(statoInterfaccia({ stato: "unknown", disabilitata: null }), "inattiva");
  });
});

describe("usoPercento", () => {
  it("usato su totale, arrotondato", () => assert.equal(usoPercento(1000, 790), 21));
  it("totale 0 o dato mancante: null, mai NaN", () => {
    assert.equal(usoPercento(0, 0), null);
    assert.equal(usoPercento(null, 5), null);
    assert.equal(usoPercento(5, null), null);
  });
  it("libero > totale: 0, non negativo", () => assert.equal(usoPercento(100, 150), 0));
});

describe("perTipo", () => {
  it("dal più numeroso; a parità l'ordine di comparsa; tipo mancante = altro", () => {
    const l = [ifc("a", "ether"), ifc("b", "vlan"), ifc("c", "ether"), ifc("d", null), ifc("e", "wg")];
    assert.deepEqual(perTipo(l), [{ tipo: "ether", numero: 2 }, { tipo: "vlan", numero: 1 }, { tipo: "altro", numero: 1 }, { tipo: "wg", numero: 1 }]);
  });
});

describe("contatoriMikrotik", () => {
  const base = { interfacce: null, rotte: 0, porteBridge: null, bond: null, vlan: null, utenti: null };
  it("indirizzi dalle interfacce, VLAN e bond dal tipo se non li dà altro", () => {
    const l = [ifc("v1", "vlan", "up", { indirizzi: [{ ip: "10.0.0.1", prefisso: 24, famiglia: 4 }, { ip: "fe80::1", prefisso: 64, famiglia: 6 }] }), ifc("b", "bond")];
    assert.deepEqual(contatoriMikrotik({ ...base, interfacce: l, rotte: 3 }), { indirizzi: 2, vlan: 1, porteBridge: null, bond: 1, rotte: 3, utenti: null });
  });
  it("senza interfacce: indirizzi, vlan e bond null; rotte 0 = null (non si mostra)", () => {
    assert.deepEqual(contatoriMikrotik(base), { indirizzi: null, vlan: null, porteBridge: null, bond: null, rotte: null, utenti: null });
  });
  it("tipi non ancora letti (null) o zero VLAN: nessun «0» inventato", () => {
    assert.equal(contatoriMikrotik({ ...base, interfacce: [ifc("a", null), ifc("b", null)] }).vlan, null);
    assert.equal(contatoriMikrotik({ ...base, interfacce: [ifc("a", "ether")] }).bond, null);
  });
  it("il dato esplicito vince sul conto dal tipo", () => {
    assert.equal(contatoriMikrotik({ ...base, interfacce: [ifc("v", "vlan")], vlan: 9 }).vlan, 9);
  });
});

describe("caselleMikrotik", () => {
  const risorse = (extra: Partial<RisorseMikrotik> = {}): RisorseMikrotik => ({
    uptime: "4w1d", uptime_s: 29 * 86400, versione: "7.19.4", build: null, cpu: "ARM64", cpu_core: 4, cpu_mhz: 700, cpu_carico: 18,
    memoria_totale_b: 1024 ** 3, memoria_libera_b: 806 * 1024 ** 2, disco_totale_b: 100, disco_libero_b: 95, architettura: "arm64", board: "RB5009", piattaforma: "MikroTik", ...extra,
  });
  const hw = (corr: string, agg: string): HardwareMikrotik => ({
    routerboard: true, modello: "RB5009UG+S+", seriale: "X", revisione: null, firmware_tipo: null, firmware_factory: "7.11.2", firmware_corrente: corr, firmware_aggiornabile: agg,
  });
  const scan = "2026-10-21 07:40:00";
  const tutto = { risorse: risorse(), hardware: hw("7.19.4", "7.19.4"), scansione: scan, interfacce: [ifc("e1", "ether"), ifc("e2", "ether", "down"), ifc("e3", "ether", "up", { disabilitata: true }), ifc("v", "vlan")], vlan: null };

  it("firmware uguale: nessuna attenzione e testo «Firmware»", () => {
    const c = caselleMikrotik(tutto);
    assert.equal(c.some((x) => x.attenzione), false);
    const f = c.find((x) => x.etichetta === "Firmware");
    assert.equal(f?.valore, "7.19.4");
  });
  it("firmware aggiornabile diverso: attenzione, valore della versione nuova, sotto «installato»", () => {
    const c = caselleMikrotik({ ...tutto, hardware: hw("7.19.4", "7.24.4") });
    const f = c.find((x) => x.etichetta === "Firmware aggiornabile");
    assert.equal(f?.valore, "7.24.4");
    assert.equal(f?.sotto, "installato 7.19.4");
    assert.equal(f?.attenzione, true);
  });
  it("sei caselle al massimo, nell'ordine della tavola", () => {
    const c = caselleMikrotik({ ...tutto, hardware: hw("7.19.4", "7.24.4"), vlan: { numero: 1, bridge: 1 } });
    assert.deepEqual(c.map((x) => x.etichetta), ["CPU", "Memoria usata", "Acceso da", "Interfacce su", "VLAN", "Firmware aggiornabile"]);
  });
  it("CPU: carico, sotto «n core · MHz»; da 85 in attenzione", () => {
    assert.equal(caselleMikrotik(tutto)[0].valore, "18%");
    assert.equal(caselleMikrotik(tutto)[0].sotto, "4 core · 700 MHz");
    assert.equal(caselleMikrotik({ ...tutto, risorse: risorse({ cpu_carico: 85 }) })[0].attenzione, true);
    assert.equal(caselleMikrotik({ ...tutto, risorse: risorse({ cpu_carico: 84 }) })[0].attenzione, undefined);
  });
  it("memoria, acceso da (giorni e data del riavvio in ora italiana), interfacce su totale con disabilitate", () => {
    const c = caselleMikrotik(tutto);
    assert.equal(c[1].valore, "21%");
    assert.match(c[1].sotto ?? "", /^806 MiB liberi su 1 GiB$/);
    assert.equal(c[2].valore, "29 g");
    assert.match(c[2].sotto ?? "", /^riavvio \d{2}\/\d{2}$/);
    const i = c.find((x) => x.etichetta === "Interfacce su");
    assert.equal(i?.valore, "2 / 4");
    assert.equal(i?.sotto, "1 disabilitata");
    assert.equal(i?.tab, "interfacce");
  });
  it("VLAN: sotto «su n bridge» solo se noto; con almeno un bridge apre la tab VLAN, altrimenti Interfacce", () => {
    assert.equal(caselleMikrotik(tutto).find((x) => x.etichetta === "VLAN")?.sotto, undefined);
    assert.equal(caselleMikrotik(tutto).find((x) => x.etichetta === "VLAN")?.tab, "interfacce");
    const conBridge = caselleMikrotik({ ...tutto, vlan: { numero: 9, bridge: 1 } }).find((x) => x.etichetta === "VLAN");
    assert.deepEqual([conBridge?.sotto, conBridge?.tab], ["su 1 bridge", "vlan"]);
    assert.equal(caselleMikrotik({ ...tutto, vlan: { numero: 9, bridge: 0 } }).find((x) => x.etichetta === "VLAN")?.tab, "interfacce", "zero bridge: la tab VLAN non c'è");
  });
  it("senza dati: nessuna casella inventata", () => {
    assert.deepEqual(caselleMikrotik({ risorse: null, hardware: null, scansione: null, interfacce: null, vlan: null }), []);
  });
});

describe("raggruppaInterfacce", () => {
  it("ordine ethernet, vlan, bond, bridge, vpn_tunnel, altro; gruppi vuoti tolti; tipo mancante in Altro", () => {
    const l = [ifc("lo", "loopback"), ifc("wg1", "wg"), ifc("br", "bridge"), ifc("v10", "vlan"), ifc("e1", "ether"), ifc("e2", "ethernet"), ifc("x", null), ifc("b1", "bond")];
    const g = raggruppaInterfacce(l);
    assert.deepEqual(g.map((x) => x.gruppo), ["ethernet", "vlan", "bond", "bridge", "vpn_tunnel", "altro"]);
    assert.deepEqual(g.map((x) => x.titolo), ["Ethernet", "VLAN", "Bond", "Bridge", "VPN e tunnel", "Altro"]);
    assert.deepEqual(g[0].righe.map((r) => r.ifname), ["e1", "e2"]);
    assert.equal(g[0].tipi, "ether, ethernet");
    assert.deepEqual(g[5].righe.map((r) => r.ifname), ["lo", "x"]);
    assert.equal(g[5].tipi, "loopback");
  });
  it("senza interfacce di un gruppo, quel gruppo non c'è; lista vuota = nessun gruppo", () => {
    assert.deepEqual(raggruppaInterfacce([ifc("e1", "ether")]).map((x) => x.gruppo), ["ethernet"]);
    assert.deepEqual(raggruppaInterfacce([]), []);
  });
});

describe("ripulisciExport", () => {
  const ESPORTATO = [
    "# 2026-10-21 10:00:00 by RouterOS 7.15",
    "/interface bridge",
    "add name=bridge1 comment=\\",
    "    \"LAN\"",
    "/system scheduler",
    "add interval=1d name=backup on-event=mikrotik_backup",
    "/system script",
    "add name=mikrotik_backup source=\"/tool fetch url=sftp://u:SEGRETO@h\"",
    "/system identity",
    "set name=RT1",
    "",
  ].join("\n");

  it("toglie script e scheduler, unisce le continuazioni, il resto resta identico", () => {
    const r = ripulisciExport(ESPORTATO);
    assert.deepEqual(r.tolte, ["/system scheduler", "/system script"]);
    assert.ok(!r.testo.includes("SEGRETO") && !r.testo.includes("/system script") && !r.testo.includes("/system scheduler"));
    assert.ok(r.testo.includes("add name=bridge1 comment=\"LAN\""), "continuazione unita");
    assert.ok(r.testo.includes("/system identity\nset name=RT1"));
    assert.ok(r.testo.startsWith("# 2026-10-21 10:00:00 by RouterOS 7.15\n/interface bridge\n"));
    assert.equal(r.righe, r.testo.replace(/\n$/, "").split("\n").length);
  });
  it("senza sezioni da togliere né continuazioni il testo è byte per byte lo stesso", () => {
    const t = "/ip address\nadd address=10.0.0.1/24 interface=bridge1\n/system identity\nset name=RT1\n";
    const r = ripulisciExport(t);
    assert.equal(r.testo, t);
    assert.deepEqual(r.tolte, []);
  });
  it("«/system scripts»-simili non si toccano: serve la sezione esatta", () => {
    const t = "/system script\nadd name=a\n/system script-extra\nadd x=1\n";
    const r = ripulisciExport(t);
    assert.equal(r.testo, "/system script-extra\nadd x=1\n");
  });
  it("fine riga CRLF e testo vuoto", () => {
    assert.equal(ripulisciExport("").testo, "");
    assert.equal(ripulisciExport("/system script\r\nadd a=1\r\n/ip dns\r\nset x=1\r\n").testo, "/ip dns\r\nset x=1\r\n");
  });
});

describe("nomeFileExport", () => {
  it("identity_AAAA-MM-GG_HHMM.rsc, senza caratteri strani", () => {
    assert.equal(nomeFileExport("RT 1/x", new Date("2026-10-21T08:05:00Z")), "RT_1_x_2026-10-21_1005.rsc");
    assert.equal(nomeFileExport(null, new Date("2026-10-21T08:05:00Z")), "mikrotik_2026-10-21_1005.rsc");
  });
});

describe("statoArp", () => {
  it("segno + parola per ogni stato; sconosciuto → null", () => {
    assert.deepEqual(statoArp("reachable"), { segno: "✓", parola: "raggiungibile", forte: true });
    assert.deepEqual(statoArp("permanent"), { segno: "✓", parola: "permanente", forte: true });
    assert.equal(statoArp("stale")?.segno, "●");
    assert.equal(statoArp("delay")?.segno, "●");
    assert.equal(statoArp("incomplete")?.segno, "●");
    assert.equal(statoArp("failed")?.segno, "✕");
    assert.equal(statoArp(null), null);
    assert.equal(statoArp(""), null);
  });
});

// ── Task 9: matrice porte × VLAN (regola U/T del Manager, censimento §1.8) e vlan-ids (caso 4 del piano) ──────────────

describe("espandiVlanIds", () => {
  it("numero, elenco, intervallo piccolo espanso", () => {
    assert.deepEqual(espandiVlanIds("10"), [{ id: 10, etichetta: "10" }]);
    assert.deepEqual(espandiVlanIds("10,20").map((c) => c.id), [10, 20]);
    const r = espandiVlanIds("100-110");
    assert.equal(r.length, 11);
    assert.deepEqual([r[0], r[10]], [{ id: 100, etichetta: "100" }, { id: 110, etichetta: "110" }]);
    assert.deepEqual(espandiVlanIds("5, 100-102").map((c) => c.id), [5, 100, 101, 102]);
  });
  it("oltre il massimo: una colonna sola con l'etichetta dell'intervallo", () => {
    assert.deepEqual(espandiVlanIds("2-4094"), [{ id: null, etichetta: "2-4094" }]);
    assert.equal(espandiVlanIds("1-64").length, 64, "64 numeri si espandono ancora");
    assert.deepEqual(espandiVlanIds("1-65"), [{ id: null, etichetta: "1-65" }]);
    assert.deepEqual(espandiVlanIds("1-10", 5), [{ id: null, etichetta: "1-10" }]);
  });
  it("vuoto, pezzi illeggibili e fuori 1-4094 non danno colonne inventate", () => {
    assert.deepEqual(espandiVlanIds(""), []);
    assert.deepEqual(espandiVlanIds("abc,0,5000,7").map((c) => c.id), [7]);
    assert.deepEqual(espandiVlanIds("20-10"), [], "intervallo rovesciato");
  });
});

const bridgeMk = (extra: Partial<RigaBridgeMk> = {}): RigaBridgeMk => ({
  name: "bridge", mac_address: null, mtu: null, actual_mtu: null, l2mtu: null, arp: null, arp_timeout: null, protocol_mode: null, priority: null,
  fast_forward: null, igmp_snooping: null, dhcp_snooping: null, vlan_filtering: true, pvid: 1, frame_types: null, ingress_filtering: null,
  ether_type: null, ageing_time: null, forward_delay: null, max_message_age: null, comment: null, running: true, disabled: false, ...extra,
});
const portaMk = (iface: string, pvid: number | null, extra: Partial<RigaPortaBridgeMk> = {}): RigaPortaBridgeMk => ({
  interface: iface, bridge: "bridge", pvid, priority: null, path_cost: null, internal_path_cost: null, edge: null, point_to_point: null,
  horizon: null, hw: null, hw_offload: false, frame_types: null, ingress_filtering: null, bpdu_guard: null, trusted: null, inactive: false,
  disabled: false, dynamic: false, comment: null, ...extra,
});
const vbMk = (vlan_ids: string, extra: Partial<RigaVlanBridgeMk> = {}): RigaVlanBridgeMk => ({
  bridge: "bridge", vlan_ids, tagged: [], untagged: [], current_tagged: [], current_untagged: [], dynamic: false, disabled: false, comment: null, ...extra,
});
const vlanMk = (name: string, vlan_id: number, iface = "bridge"): RigaVlanMk => ({
  name, vlan_id, interface: iface, mtu: null, mac_address: null, running: true, disabled: false, comment: null,
});
const bondMk = (name: string): RigaBondMk => ({
  name, mode: "802.3ad", slaves: ["ether7", "ether8"], transmit_hash_policy: "layer-2-and-3", mlag_id: null, link_monitoring: "mii",
  mii_interval: "100ms", lacp_rate: null, mtu: 1500, comment: null, running: true, disabled: false,
});
const attiva = () => "attiva" as const;

describe("matriceVlan", () => {
  const porte = [portaMk("ether2", 1), portaMk("ether3", 30), portaMk("bond1", 1), portaMk("ether9", 5, { bridge: "altro" })];
  const celle = (m: ReturnType<typeof matriceVlan>, porta: string) => {
    const r = m.righe.find((x) => x.porta === porta);
    assert.ok(r, porta);
    return Object.fromEntries(m.colonne.map((c, k) => [c.etichetta, r.celle[k]]));
  };

  it("porta negli untagged → U; nei tagged → T; solo PVID → U; niente → vuota", () => {
    const m = matriceVlan({
      bridge: bridgeMk(), porte, bond: [bondMk("bond1")],
      vlanBridge: [
        vbMk("10", { tagged: ["bridge", "bond1"], untagged: ["ether2"] }),
        vbMk("20", { current_tagged: ["ether2"], current_untagged: ["ether3"] }),
      ],
      vlan: [vlanMk("UFFICI", 10), vlanMk("VOIP", 20), vlanMk("ALTRA", 10, "altro")],
      statoPorta: attiva,
    });
    assert.equal(m.completa, true);
    assert.deepEqual(m.colonne.map((c) => c.id), [1, 10, 20, 30], "ordinate per id, PVID compresi");
    assert.deepEqual(m.colonne.map((c) => c.nome), [null, "UFFICI", "VOIP", null], "nome dalla VLAN su questo bridge");
    assert.deepEqual(m.righe.map((r) => r.porta), ["ether2", "ether3", "bond1"], "solo le porte di questo bridge");
    assert.deepEqual(celle(m, "ether2"), { 1: "U", 10: "U", 20: "T", 30: null });
    assert.deepEqual(celle(m, "ether3"), { 1: null, 10: null, 20: "U", 30: "U" });
    assert.deepEqual(celle(m, "bond1"), { 1: "U", 10: "T", 20: null, 30: null });
    assert.equal(m.righe[2].bond?.name, "bond1");
    assert.equal(m.righe[0].bond, null);
  });

  it("untagged vince su tagged e sul PVID; la riga disabilitata non conta", () => {
    const m = matriceVlan({
      bridge: bridgeMk(), porte: [portaMk("ether2", 10)], bond: [],
      vlanBridge: [vbMk("10", { tagged: ["ether2"], untagged: ["ether2"] }), vbMk("40", { tagged: ["ether2"], disabled: true })],
      vlan: null, statoPorta: attiva,
    });
    assert.deepEqual(m.colonne.map((c) => c.id), [1, 10]);
    assert.deepEqual(m.righe[0].celle, [null, "U"]);
  });

  it("intervallo 100-110 espanso in 11 colonne; 2-4094 resta una colonna con l'etichetta", () => {
    const m = matriceVlan({
      bridge: bridgeMk({ pvid: null }), porte: [portaMk("ether2", null), portaMk("ether3", null)], bond: [],
      vlanBridge: [vbMk("100-110", { tagged: ["ether2"] }), vbMk("2-4094", { untagged: ["ether3"] })],
      vlan: null, statoPorta: attiva,
    });
    assert.equal(m.colonne.filter((c) => c.id !== null).length, 11);
    const larga = m.colonne.at(-1);
    assert.deepEqual(larga, { id: null, etichetta: "2-4094", nome: null }, "in fondo, dopo le colonne numerate");
    assert.deepEqual([m.righe[0].celle[0], m.righe[0].celle.at(-1)], ["T", null]);
    assert.deepEqual([m.righe[1].celle[0], m.righe[1].celle.at(-1)], ["U", "U"], "l'intervallo largo vale anche sulla 100");
  });

  it("senza righe bridge vlan: colonne dai PVID di porte e bridge, solo la regola del PVID, completa=false", () => {
    const m = matriceVlan({ bridge: bridgeMk({ pvid: 1 }), porte, bond: [], vlanBridge: null, vlan: null, statoPorta: attiva });
    assert.equal(m.completa, false);
    assert.deepEqual(m.colonne.map((c) => c.id), [1, 30]);
    assert.deepEqual(celle(m, "ether2"), { 1: "U", 30: null });
    assert.deepEqual(celle(m, "ether3"), { 1: null, 30: "U" });
  });

  it("lo stato viene da chi chiama; PVID null → nessuna U implicita", () => {
    const m = matriceVlan({
      bridge: bridgeMk(), porte: [portaMk("ether2", null), portaMk("ether3", 1)], bond: [], vlanBridge: null, vlan: null,
      statoPorta: (n) => (n === "ether2" ? "disabilitata" : "inattiva"),
    });
    assert.deepEqual(m.righe.map((r) => [r.porta, r.stato, r.pvid, r.celle]), [["ether2", "disabilitata", null, [null]], ["ether3", "inattiva", 1, ["U"]]]);
  });
});

describe("statoPortaBridge e descriviBond", () => {
  it("X → disabilitata (vince), I → inattiva, altrimenti attiva", () => {
    assert.equal(statoPortaBridge({ disabled: true, inactive: true }), "disabilitata");
    assert.equal(statoPortaBridge({ disabled: false, inactive: true }), "inattiva");
    assert.equal(statoPortaBridge({ disabled: false, inactive: false }), "attiva");
  });
  it("modo · slave · hash, solo quelli che ci sono", () => {
    assert.equal(descriviBond(bondMk("bond1")), "802.3ad · ether7, ether8 · layer-2-and-3");
    assert.equal(descriviBond({ ...bondMk("b"), slaves: [], transmit_hash_policy: null }), "802.3ad");
  });
});

describe("matriceVlan: intervallo non espanso", () => {
  it("una colonna numerica conta anche le righe con un intervallo largo che la contiene (2-4094 tagged → T sulla 100)", () => {
    const m = matriceVlan({
      bridge: bridgeMk({ pvid: null }), porte: [portaMk("ether1", null), portaMk("ether2", 100)], bond: [],
      vlanBridge: [vbMk("2-4094", { tagged: ["ether1"] })], vlan: null, statoPorta: attiva,
    });
    assert.deepEqual(m.colonne.map((c) => c.etichetta), ["100", "2-4094"]);
    assert.deepEqual(m.righe.map((r) => [r.porta, r.celle]), [["ether1", ["T", "T"]], ["ether2", ["U", null]]]);
  });
});

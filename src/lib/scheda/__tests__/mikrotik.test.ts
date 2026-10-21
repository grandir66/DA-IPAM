/**
 * Pezzi puri della Panoramica MikroTik (21/10): gruppo e stato delle interfacce, uso in percentuale, contatori e
 * caselle della striscia. Incidente evitato: il Manager metteva `wg` in «Altro»; un totale 0 non deve dare NaN.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/mikrotik.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { caselleMikrotik, contatoriMikrotik, gruppoInterfaccia, perTipo, raggruppaInterfacce, statoInterfaccia, usoPercento } from "../mikrotik";
import type { InterfacciaScheda } from "../router";
import type { HardwareMikrotik, RisorseMikrotik } from "@/lib/devices/mikrotik-scheda";

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
  it("VLAN: sotto «su n bridge» solo se noto; la tab è interfacce finché la tab VLAN non c'è", () => {
    assert.equal(caselleMikrotik(tutto).find((x) => x.etichetta === "VLAN")?.sotto, undefined);
    assert.equal(caselleMikrotik({ ...tutto, vlan: { numero: 9, bridge: 1 } }).find((x) => x.etichetta === "VLAN")?.sotto, "su 1 bridge");
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

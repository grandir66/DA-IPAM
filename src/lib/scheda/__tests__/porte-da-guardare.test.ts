/**
 * «Porte da guardare» dello switch (21/10): errori, half duplex, più di 5 MAC su una porta non trunk.
 * Il trunk con molti MAC è normale e non si segnala. La regola «velocità sotto 1G su porta che ha visto 1G»
 * NON c'è: nel DB non esiste lo storico della velocità (switch_ports tiene solo l'ultimo giro).
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/scheda/__tests__/porte-da-guardare.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { motiviPorta, porteDaGuardare, velocitaMbps, etichettaVelocita, vlanDistinte, sommaPoe, numeroPorta, eSfp, casellePanoramicaSwitch, type PortaSwitch } from "../porte-da-guardare";

const porta = (o: Partial<PortaSwitch>): PortaSwitch => ({
  id: 1, port_index: 1, port_name: "Port 1", status: "up", speed: "1000 Mbps", duplex: "full", vlan: 40,
  poe_status: null, poe_power_mw: null, mac_count: 1, is_trunk: 0, stp_state: "forwarding", ...o,
});

describe("motiviPorta", () => {
  it("porta sana: nessun motivo", () => {
    assert.deepEqual(motiviPorta(porta({})), []);
  });
  it("errori > 0 -> motivo con il conteggio", () => {
    assert.deepEqual(motiviPorta(porta({ errori: 12 })), ["12 errori sulla porta"]);
  });
  it("half duplex", () => {
    assert.deepEqual(motiviPorta(porta({ duplex: "half" })), ["duplex half"]);
  });
  it("14 MAC su porta non trunk", () => {
    assert.deepEqual(motiviPorta(porta({ mac_count: 14 })), ["switch non gestito? 14 MAC su una porta"]);
  });
  it("5 MAC non bastano (soglia > 5)", () => {
    assert.deepEqual(motiviPorta(porta({ mac_count: 5 })), []);
  });
  it("14 MAC su trunk: escluso", () => {
    assert.deepEqual(motiviPorta(porta({ mac_count: 14, is_trunk: 1 })), []);
  });
  it("porta giù o disabilitata: i valori vecchi non contano", () => {
    assert.deepEqual(motiviPorta(porta({ status: "down", duplex: "half", mac_count: 20 })), []);
    assert.deepEqual(motiviPorta(porta({ status: "disabled", errori: 3 })), []);
  });
  it("più motivi insieme, nell'ordine errori, half, MAC", () => {
    assert.equal(motiviPorta(porta({ errori: 1, duplex: "half", mac_count: 9 })).length, 3);
  });
  it("una porta lenta (100M) senza storico NON è segnalata: manca il dato per dire che era a 1G", () => {
    assert.deepEqual(motiviPorta(porta({ speed: "100 Mbps" })), []);
  });
});

describe("porteDaGuardare", () => {
  it("restituisce solo le porte con almeno un motivo, con i motivi", () => {
    const r = porteDaGuardare([porta({ id: 1 }), porta({ id: 2, duplex: "half" }), porta({ id: 3, mac_count: 14, is_trunk: 1 })]);
    assert.deepEqual(r.map((x) => x.porta.id), [2]);
    assert.deepEqual(r[0]!.motivi, ["duplex half"]);
  });
});

describe("velocità", () => {
  it("Mbps -> numero", () => {
    assert.equal(velocitaMbps("1000 Mbps"), 1000);
    assert.equal(velocitaMbps("10 Gbps"), 10000);
    assert.equal(velocitaMbps(null), null);
    assert.equal(velocitaMbps("auto"), null);
  });
  it("etichetta corta", () => {
    assert.equal(etichettaVelocita("100 Mbps"), "100M");
    assert.equal(etichettaVelocita("1000 Mbps"), "1G");
    assert.equal(etichettaVelocita("10000 Mbps"), "10G");
    assert.equal(etichettaVelocita("auto"), "auto");
    assert.equal(etichettaVelocita(null), null);
  });
});

describe("VLAN, PoE, pannello", () => {
  it("VLAN distinte con numero di porte e di trunk, ordinate; senza VLAN non conta", () => {
    const r = vlanDistinte([porta({ vlan: 40 }), porta({ vlan: 40 }), porta({ vlan: 1, is_trunk: 1 }), porta({ vlan: null })]);
    assert.deepEqual(r, [{ vlan: 1, porte: 1, trunk: 1 }, { vlan: 40, porte: 2, trunk: 0 }]);
  });
  it("somma PoE: solo porte che erogano, in watt", () => {
    const s = sommaPoe([porta({ poe_status: "delivering", poe_power_mw: 4300 }), porta({ poe_status: "delivering", poe_power_mw: 17500 }), porta({ poe_status: "searching", poe_power_mw: 0 })]);
    assert.deepEqual(s, { watt: 21.8, porte: 2, haPoe: true });
    assert.equal(sommaPoe([porta({})]).haPoe, false);
  });
  it("numero porta dal nome, altrimenti dall'indice; SFP dal nome", () => {
    assert.equal(numeroPorta(porta({ port_name: "Port 17", port_index: 3 })), 17);
    assert.equal(numeroPorta(porta({ port_name: "gi1/0/5", port_index: 9 })), 5);
    assert.equal(numeroPorta(porta({ port_name: "uplink", port_index: 9 })), 9);
    assert.equal(numeroPorta(porta({ port_name: "CITOFONO 185", port_index: 14 })), 14);
    assert.equal(numeroPorta(porta({ port_name: "SFP+ 1", port_index: 49 })), 1);
    assert.equal(numeroPorta(porta({ port_name: "TenGigabitEthernet1", port_index: 52 })), 1);
    assert.equal(eSfp(porta({ port_name: "SFP+ 1" })), true);
    assert.equal(eSfp(porta({ port_name: "TenGigabitEthernet1" })), true);
    assert.equal(eSfp(porta({ port_name: "Port 1" })), false);
  });
});

describe("casellePanoramicaSwitch", () => {
  const base = { porte: [porta({}), porta({ status: "down" })], vicini: 3, protocolliVicini: ["lldp"], acceso: "41 g" };
  it("porte su/totale, VLAN, vicini, acceso da; PoE solo se c'è", () => {
    const c = casellePanoramicaSwitch(base);
    assert.deepEqual(c.map((x) => x.etichetta), ["Porte su", "Da guardare", "VLAN", "Vicini", "Acceso da"]);
    assert.equal(c[0]!.valore, "1 / 2");
  });
  it("PoE presente -> casella con i watt; da guardare > 0 -> attenzione", () => {
    const c = casellePanoramicaSwitch({ ...base, porte: [porta({ poe_status: "delivering", poe_power_mw: 6200, duplex: "half" })] });
    assert.equal(c.find((x) => x.etichetta === "PoE erogato")!.valore, "6,2 W");
    assert.equal(c.find((x) => x.etichetta === "Da guardare")!.attenzione, true);
  });
  it("mai più di sei caselle", () => {
    assert.ok(casellePanoramicaSwitch({ ...base, porte: [porta({ poe_status: "delivering", poe_power_mw: 1000 })] }).length <= 6);
  });
});

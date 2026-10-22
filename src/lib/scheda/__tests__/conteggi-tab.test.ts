/**
 * Numeri accanto al nome delle tab (22/10): solo dai dati che la pagina ha già caricato; senza dato nessun numero,
 * e mai uno «0» inventato.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX") node --import tsx --test src/lib/scheda/__tests__/conteggi-tab.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conteggioTab, type DatiConteggio } from "../conteggi-tab";

const porta = (i: number, vlan: number | null, trunk = 0) => ({ id: i, port_index: i, port_name: `ether${i}`, vlan, is_trunk: trunk });
const vicino = (porta: string, nome: string, mac?: string) => ({ local_port: porta, remote_device_name: nome, remote_mac: mac ?? null, remote_port: "x", protocol: "lldp" });

const switchCompleto = {
  switch_ports: [porta(1, 10), porta(2, 10), porta(3, 20, 1)],
  neighbors: [vicino("ether1", "sw-a"), vicino("ether1", "sw-a"), vicino("ether2", "sw-b")],
  mac_port_entries: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
} as unknown as DatiConteggio["device"];

describe("conteggioTab: switch", () => {
  const d: DatiConteggio = { device: switchCompleto, dipendenze: null };
  it("porte", () => assert.equal(conteggioTab("switch", "porte", d), "3"));
  it("VLAN distinte", () => assert.equal(conteggioTab("switch", "vlan", d), "2"));
  it("VLAN lette via Q-BRIDGE al posto di quelle dei PVID (Task 11 accorpamento); 0 = quelle dei PVID", () => {
    const letto = { ...switchCompleto, switch_vlan_n: 13 } as unknown as DatiConteggio["device"];
    assert.equal(conteggioTab("switch", "vlan", { device: letto, dipendenze: null }), "13");
    const zero = { ...switchCompleto, switch_vlan_n: 0 } as unknown as DatiConteggio["device"];
    assert.equal(conteggioTab("switch", "vlan", { device: zero, dipendenze: null }), "2");
  });
  it("vicini (una riga per porta e nome) · MAC", () => assert.equal(conteggioTab("switch", "vicini", d), "2 · 4"));
  it("vicini senza MAC table: solo i vicini, mai «0»", () => {
    const solo = { ...switchCompleto, mac_port_entries: [] } as unknown as DatiConteggio["device"];
    assert.equal(conteggioTab("switch", "vicini", { device: solo, dipendenze: null }), "2");
  });
  it("niente dati: null", () => {
    const vuoto = { device: { switch_ports: [], neighbors: [], mac_port_entries: [] } as unknown as DatiConteggio["device"], dipendenze: null };
    for (const t of ["porte", "vlan", "vicini"] as const) assert.equal(conteggioTab("switch", t, vuoto), null);
    assert.equal(conteggioTab("switch", "porte", { device: null, dipendenze: null }), null);
  });
  it("tab comuni e senza numero: null", () => {
    for (const t of ["panoramica", "sicurezza", "gestione", "storico"] as const) assert.equal(conteggioTab("switch", t, d), null);
  });
});

describe("conteggioTab: router e firewall", () => {
  const device = { routes: [{}, {}, {}], arp_entries: [{}, {}], mikrotik: { bridge: 2, letto_il: null, topologia_accesa: true } } as unknown as DatiConteggio["device"];
  it("rotte · ARP", () => {
    assert.equal(conteggioTab("router", "routing", { device, dipendenze: null }), "3 · 2");
    assert.equal(conteggioTab("firewall", "routing", { device, dipendenze: null }), "3 · 2");
  });
  it("bridge dall'ultima lettura (solo se > 0)", () => {
    assert.equal(conteggioTab("router", "bridge", { device, dipendenze: null }), "2");
    const senza = { mikrotik: { bridge: 0, letto_il: null, topologia_accesa: true } } as unknown as DatiConteggio["device"];
    assert.equal(conteggioTab("router", "bridge", { device: senza, dipendenze: null }), null);
  });
  it("interfacce, DHCP, dispositivi: servono richieste, quindi nessun numero", () => {
    for (const t of ["interfacce", "dhcp", "dispositivi"] as const) assert.equal(conteggioTab("router", t, { device, dipendenze: null }), null);
  });
});

describe("conteggioTab: hypervisor, storage, server", () => {
  it("hypervisor: VM, nodi, storage", () => {
    const device = {
      proxmox_data: {
        vms: [{ vmid: 1 }, { vmid: 2 }], hosts: [{ hostname: "pve1", storage: [{ storage: "local", total: 10, used: 1 }] }, { hostname: "pve2" }],
      },
    } as unknown as DatiConteggio["device"];
    const d = { device, dipendenze: null };
    assert.equal(conteggioTab("hypervisor", "vm", d), "2");
    assert.equal(conteggioTab("hypervisor", "nodi", d), "2");
    assert.equal(conteggioTab("hypervisor", "vm", { device: null, dipendenze: null }), null);
  });
  it("server: dipendenze", () => {
    const d = { device: null, dipendenze: { servizi: [{}, {}] } } as unknown as DatiConteggio;
    assert.equal(conteggioTab("server_windows", "dipendenze", d), "2");
    assert.equal(conteggioTab("server_linux", "dipendenze", { device: null, dipendenze: { servizi: [] } } as unknown as DatiConteggio), null);
  });
});

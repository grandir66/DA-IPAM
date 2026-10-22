/**
 * Collector `mikrotik-routeros` (base collaudata in locale; PoE, FDB, STP e velocità del giro 3 non ancora provati su un apparato). Requisiti di regressione dei donatori (piano §6): tensione PoE mai come
 * potenza, `vlan-ids` letto con gli intervalli, velocità e duplex dal monitor per colonne. Le uscite `terse` vere (anonime)
 * della scheda MikroTik passano dagli stessi parser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE, MIKROTIK_USCITE } from "./contratto-fixture";
import { espandiVlanIdsTutti, parseArp, parseMonitorEthernet, parseMonitorPoe, velocitaRouterOs } from "../mikrotik-routeros-parsers";
import { collectDevice } from "../index";
import { descrittore } from "../catalogo";
import type { AcquisitionTransports } from "../schema";

const FIX = join(process.cwd(), "src/lib/devices/__tests__/fixtures");

test("mikrotik-routeros: famiglia collaudata in locale, motore d'inventario, exec su una connessione", () => {
    const d = descrittore("mikrotik-routeros");
    assert.equal(d.collaudo, "collaudato");
    assert.equal(d.motore, "inventario");
    assert.equal(d.famiglia, "router");
    assert.equal(d.ssh_modo, "exec");
    assert.ok(!d.comandi?.some(c => /export|set |add |remove|reboot/.test(c)), "solo letture");
});

test("PoE: la potenza viene da poe-out-power, mai dalla tensione", () => {
    const p = parseMonitorPoe(MIKROTIK_USCITE["/interface ethernet poe monitor [find] once"]);
    assert.deepEqual(p.map(x => [x.porta, x.acceso, x.potenza_watt, x.tensione_volt]), [["ether1", true, 2.9, 24.1], ["ether2", false, null, null]]);
    const soloTensione = parseMonitorPoe("            name: ether5\n         poe-out: auto-on\n poe-out-voltage: 48.0V\n");
    assert.equal(soloTensione[0].potenza_watt, null, "senza poe-out-power la potenza è ignota, non 48");
});

test("vlan-ids: valori singoli, intervalli ed elenchi; un pezzo illeggibile non diventa un numero", () => {
    assert.deepEqual(espandiVlanIdsTutti("100-102,200"), [100, 101, 102, 200]);
    assert.deepEqual(espandiVlanIdsTutti("2"), [2]);
    assert.equal(espandiVlanIdsTutti("10-5"), null);
    assert.equal(espandiVlanIdsTutti("abc"), null);
    assert.equal(espandiVlanIdsTutti("4095"), null);
});

test("monitor ethernet per colonne: la porta senza link non prende la velocità della vicina", () => {
    assert.deepEqual(parseMonitorEthernet(MIKROTIK_USCITE["/interface ethernet monitor [find] once"]), [
        { nome: "ether1", collegata: true, velocita_bps: 1e9, duplex: "full" },
        { nome: "ether2", collegata: false, velocita_bps: null, duplex: null },
    ]);
    assert.equal(velocitaRouterOs("2.5Gbps"), 2.5e9);
    assert.equal(velocitaRouterOs("auto"), null);
});

test("snapshot dalla fixture: identità, interfacce, VLAN espanse, PoE, STP, LAG, vicini, rete", async () => {
    const { snapshot: s } = await FIXTURE["mikrotik-routeros"].normale();
    assert.equal(s.identity.data?.firmware, "7.24.5 (stable)");
    assert.equal(s.identity.data?.model, "CRS-LAB-8P");
    assert.equal(s.identity.data?.serial_number, "LABMK0001");
    assert.equal(s.identity.data?.uptime_seconds, 2 * 7 * 86400 + 20 * 60 + 57, "uptime da /system resource print");
    const e1 = s.interfaces.data.find(i => i.name === "ether1")!;
    assert.deepEqual([e1.kind, e1.admin_status, e1.oper_status, e1.speed_bps, e1.duplex, e1.pvid], ["physical", "up", "up", 1e9, "full", 10]);
    assert.equal(s.interfaces.data.find(i => i.name === "ether2")?.speed_bps, null, "la porta senza link non prende la velocità della vicina");
    assert.equal(s.interfaces.data.find(i => i.name === "bond1")?.kind, "aggregate");
    assert.equal(s.interfaces.data.find(i => i.name === "bridge")?.kind, "other");
    assert.deepEqual(s.vlans.data.map(v => v.id), [10, 100, 101, 102, 200]);
    assert.deepEqual(s.vlans.data[0].untagged_ports, ["ether1"]);
    assert.equal(s.poe.data[0].power_watts, 2.9);
    assert.deepEqual(s.spanning_tree.data.ports.map(p => [p.port, p.role, p.state, p.instance]), [["ether1", "designated", "forwarding", "CIST"], ["bond1", "root", "forwarding", "CIST"]]);
    assert.equal(s.spanning_tree.data.protocol, "rstp");
    assert.deepEqual(s.aggregation.data[0], { name: "bond1", protocol: "802.3ad", admin_status: "up", oper_status: "up", members: ["ether3", "ether4"] });
    assert.equal(s.neighbors.data[0].system_name, "sw-core");
    assert.deepEqual(s.neighbors.data[0].capabilities, ["bridge", "router"]);
    assert.deepEqual(s.network.data.ipv4_addresses, [{ address: "192.0.2.2", netmask: "255.255.255.0", if_index: null }]);
    assert.deepEqual(s.network.data.arp, [{ address: "192.0.2.50", mac: "02:00:00:00:30:01", if_index: null, type: "dynamic" }]);
    assert.equal(s.forwarding.data[0].vlan_id, 10);
    assert.equal(s.resources?.data.cpu_percent, 3);
});

test("un errore di RouterOS su stdout con exit 0 non è un'uscita buona", async () => {
    const t: AcquisitionTransports = {
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); },
        shell: async c => Object.fromEntries(c.map(x => [x, { status: "ok" as const, data: x === "/interface ethernet poe monitor [find] once" ? "bad command name poe (line 1 column 21)\n" : x === "/ip arp print terse without-paging" ? "not enough permissions (9)\n" : (MIKROTIK_USCITE[x] ?? ""), warnings: [] }])),
    };
    const s = await collectDevice(FIXTURE["mikrotik-routeros"].richiesta, t);
    assert.equal(s.poe.status, "unsupported");
    assert.ok(s.poe.warnings.includes("ROUTEROS_BAD_COMMAND"));
    assert.equal(s.network.status, "partial", "indirizzi letti, ARP negato");
});

test("le uscite terse vere della scheda MikroTik passano dai parser del collector", () => {
    const arp = parseArp(readFileSync(join(FIX, "mikrotik-arp-terse.txt"), "utf8"));
    assert.ok(arp.length > 0 && arp.every(a => /^\d+\.\d+\.\d+\.\d+$/.test(a.address)));
});

test("il core dei collector non importa DB, route o client storici con DB", () => {
    const dir = join(process.cwd(), "src/lib/acquisition");
    for (const f of readdirSync(dir).filter(x => x.endsWith(".ts"))) {
        const src = readFileSync(join(dir, f), "utf8");
        const importi = [...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm)].map(m => m[1]);
        for (const i of importi) assert.ok(!/(^|\/)db(-tenant|-hub)?$|router-client|switch-client|api-tenant|next-auth/.test(i), `${f} importa ${i}`);
    }
});

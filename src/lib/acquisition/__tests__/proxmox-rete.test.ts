/**
 * Proxmox come uno switch (Riccardo, 08/11): porte, tabella MAC, VLAN e ARP del nodo. Forme vere di `ip -d -j link show`,
 * `bridge -j fdb show`, `bridge -j vlan show` e `ip -j neigh show` di iproute2 su Proxmox VE 8; indirizzi e MAC inventati.
 * Prima il collector non leggeva dove sta un MAC: le VM restavano «sul nodo», senza porta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregatiProxmox, interfacceProxmox, parseFdbProxmox, parseLinkProxmox, parseNeighProxmox, vlanProxmox } from "../proxmox-rete";
import { collectDevice } from "../index";
import { FIXTURE, PROXMOX_USCITE } from "./contratto-fixture";
import type { AcquisitionTransports } from "../schema";

export const LINK = JSON.stringify([
    { ifindex: 1, ifname: "lo", mtu: 65536, operstate: "UNKNOWN", address: "00:00:00:00:00:00", linkinfo: undefined },
    { ifindex: 2, ifname: "eno1", mtu: 1500, operstate: "UP", master: "bond0", address: "02:00:00:00:91:01", linkinfo: { info_slave_kind: "bond" } },
    { ifindex: 3, ifname: "eno2", mtu: 1500, operstate: "UP", master: "vmbr0", address: "02:00:00:00:91:01", linkinfo: {} },
    { ifindex: 4, ifname: "bond0", mtu: 1500, operstate: "UP", master: "vmbr0", address: "02:00:00:00:91:01", linkinfo: { info_kind: "bond", info_data: { mode: "802.3ad" } } },
    { ifindex: 5, ifname: "vmbr0", mtu: 1500, operstate: "UP", address: "02:00:00:00:91:01", linkinfo: { info_kind: "bridge", info_data: { vlan_filtering: 1 } } },
    { ifindex: 6, ifname: "tap100i0", mtu: 1500, operstate: "UNKNOWN", master: "vmbr0", address: "02:00:00:00:91:10", linkinfo: { info_kind: "tun" } },
    { ifindex: 7, ifname: "tap101i0", mtu: 1500, operstate: "UNKNOWN", master: "fwbr101i0", address: "02:00:00:00:91:11", linkinfo: { info_kind: "tun" } },
    { ifindex: 8, ifname: "fwbr101i0", mtu: 1500, operstate: "UP", address: "02:00:00:00:91:12", linkinfo: { info_kind: "bridge", info_data: { vlan_filtering: 0 } } },
    { ifindex: 9, ifname: "fwln101i0", mtu: 1500, operstate: "UP", master: "fwbr101i0", address: "02:00:00:00:91:13", linkinfo: { info_kind: "veth" } },
    { ifindex: 10, ifname: "fwpr101p0", mtu: 1500, operstate: "UP", master: "vmbr0", address: "02:00:00:00:91:14", linkinfo: { info_kind: "veth" } },
    { ifindex: 11, ifname: "veth200i0", mtu: 1500, operstate: "UP", master: "vmbr0", address: "02:00:00:00:91:15", linkinfo: { info_kind: "veth" } },
]);
export const FDB = JSON.stringify([
    { mac: "02:00:00:00:91:01", ifname: "bond0", vlan: 1, master: "vmbr0", state: "permanent" },
    { mac: "33:33:00:00:00:01", ifname: "eno1", flags: ["self"], state: "permanent" },
    { mac: "02:00:00:00:a0:01", ifname: "eno1", flags: ["self"], state: "" },
    { mac: "bc:24:11:00:01:00", ifname: "tap100i0", vlan: 20, master: "vmbr0", state: "" },
    { mac: "bc:24:11:00:01:01", ifname: "fwpr101p0", vlan: 20, master: "vmbr0", state: "" },
    { mac: "bc:24:11:00:01:01", ifname: "tap101i0", master: "fwbr101i0", state: "" },
    { mac: "02:00:00:00:a0:02", ifname: "fwln101i0", master: "fwbr101i0", state: "" },
    { mac: "02:00:00:00:a0:02", ifname: "bond0", vlan: 20, master: "vmbr0", state: "" },
    { mac: "01:00:5e:00:00:01", ifname: "bond0", master: "vmbr0", state: "" },
]);
export const VLAN = JSON.stringify([
    { ifname: "bond0", vlans: [{ vlan: 1, flags: ["PVID", "Egress Untagged"] }, { vlan: 2, vlanEnd: 4094 }] },
    { ifname: "vmbr0", vlans: [{ vlan: 1, flags: ["PVID", "Egress Untagged"] }] },
    { ifname: "tap100i0", vlans: [{ vlan: 20, flags: ["PVID", "Egress Untagged"] }] },
    { ifname: "fwpr101p0", vlans: [{ vlan: 20, flags: ["PVID", "Egress Untagged"] }] },
    { ifname: "veth200i0", vlans: [{ vlan: 30, flags: ["PVID", "Egress Untagged"] }] },
    // Senza `-c`: una voce per VLAN (forma vista sull'hub, 4.094 per porta), anche questa vale solo per le VLAN usate.
    { ifname: "eno2", vlans: [{ vlan: 1, flags: ["PVID", "Egress Untagged"] }, ...Array.from({ length: 199 }, (_, i) => ({ vlan: i + 2 }))] },
]);
export const NEIGH = JSON.stringify([
    { dst: "192.0.2.1", dev: "vmbr0", lladdr: "02:00:00:00:a0:01", state: ["REACHABLE"] },
    { dst: "192.0.2.9", dev: "vmbr0", state: ["FAILED"] },
    { dst: "fe80::1", dev: "vmbr0", lladdr: "02:00:00:00:a0:01", router: null, state: ["STALE"] },
]);

test("proxmox-rete: porte senza l'interno del firewall, la VM si vede dalla porta fwpr", () => {
    const link = parseLinkProxmox(LINK)!;
    const nomi = interfacceProxmox(link).map((i) => [i.name, i.kind]);
    assert.deepEqual(nomi, [["eno1", "physical"], ["eno2", "physical"], ["bond0", "aggregate"], ["vmbr0", "other"], ["tap100i0", "other"], ["fwpr101p0", "other"], ["veth200i0", "other"]]);
    assert.equal(interfacceProxmox(link).find((i) => i.name === "fwpr101p0")?.description, "VM 101 scheda net0");
    assert.deepEqual(aggregatiProxmox(link), [{ name: "bond0", protocol: null, admin_status: null, oper_status: "up", members: ["eno1"] }]);
});

test("proxmox-rete: tabella MAC solo con le voci imparate su una porta di bridge", () => {
    const link = parseLinkProxmox(LINK)!;
    assert.deepEqual(parseFdbProxmox(FDB, link)!.map((f) => [f.mac, f.port, f.vlan_id, f.if_index]), [
        ["bc:24:11:00:01:00", "tap100i0", 20, 6],
        ["bc:24:11:00:01:01", "fwpr101p0", 20, 10],
        ["02:00:00:00:a0:02", "bond0", 20, 4],
    ]);
    assert.equal(parseFdbProxmox("non json", link), null, "illeggibile non è «nessun MAC»");
});

test("proxmox-rete: VLAN dal bridge filtrante, intervallo largo solo dove serve, tag delle VM", () => {
    const link = parseLinkProxmox(LINK)!;
    const v = vlanProxmox(link, VLAN, undefined);
    assert.deepEqual(v.map((x) => [x.id, x.tagged_ports, x.untagged_ports]), [
        [1, [], ["bond0", "eno2"]],
        [20, ["bond0", "eno2"], ["fwpr101p0", "tap100i0"]],
        [30, ["bond0", "eno2"], ["veth200i0"]],
    ], "2-4094 sull'uplink non diventa 4.093 VLAN, né con gli intervalli né una per una: vale solo per le VLAN usate");
    // Bridge non filtrante: `bridge vlan show` dice «VLAN 1» ovunque e non conta; il tag della VM sì.
    const senza = parseLinkProxmox(LINK.replace('"vlan_filtering":1', '"vlan_filtering":0'))!;
    const guests = { status: "ok" as const, collected_at: "", sources: [], warnings: [], data: [{ vmid: 100, networks: [{ id: "net0", model: "virtio", mac: "bc:24:11:00:01:00", bridge: "vmbr0", vlan: "40", ip: null }] }] };
    assert.deepEqual(vlanProxmox(senza, VLAN, guests as never).map((x) => [x.id, x.untagged_ports]), [[40, ["tap100i0"]]]);
});

test("proxmox-rete: VLAN da un'interfaccia bond0.50 dentro un bridge", () => {
    const link = parseLinkProxmox(JSON.stringify([
        { ifindex: 4, ifname: "bond0", linkinfo: { info_kind: "bond" } },
        { ifindex: 12, ifname: "bond0.50", link: "bond0", master: "vmbr0v50", linkinfo: { info_kind: "vlan", info_data: { protocol: "802.1Q", id: 50 } } },
        { ifindex: 13, ifname: "vmbr0v50", linkinfo: { info_kind: "bridge", info_data: { vlan_filtering: 0 } } },
        { ifindex: 14, ifname: "tap102i0", master: "vmbr0v50", linkinfo: { info_kind: "tun" } },
    ]))!;
    assert.deepEqual(vlanProxmox(link, "", undefined).map((x) => [x.id, x.tagged_ports, x.untagged_ports]), [[50, ["bond0"], ["tap102i0"]]]);
});

test("proxmox-rete: ARP solo IPv4 con un MAC", () => {
    const link = parseLinkProxmox(LINK)!;
    assert.deepEqual(parseNeighProxmox(NEIGH, link), [{ address: "192.0.2.1", mac: "02:00:00:00:a0:01", if_index: 5, type: "reachable" }]);
});

test("proxmox-ve: il collector riempie porte, FDB, VLAN e ARP; una lettura mancata resta dichiarata", async () => {
    const uscite: Record<string, string> = { ...PROXMOX_USCITE, "ip -d -j link show": LINK, "bridge -j fdb show dynamic": FDB, "bridge -j -c vlan show": VLAN, "ip -j neigh show": NEIGH };
    const t = (rotti: string[]): AcquisitionTransports => ({
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); },
        shell: async (c) => Object.fromEntries(c.map((x) => [x, rotti.includes(x)
            ? { status: "error" as const, data: "", warnings: ["SSH_COMMAND_FAILED"] }
            : { status: "ok" as const, data: uscite[x] ?? "", warnings: [] }])),
    });
    const s = await collectDevice(FIXTURE["proxmox-ve"].richiesta, t([]));
    assert.equal(s.forwarding.status, "ok");
    assert.equal(s.forwarding.data.length, 3);
    assert.deepEqual(s.vlans.data.map((v) => v.id), [1, 20, 30]);
    assert.equal(s.network.data.arp.length, 1);
    assert.ok(s.interfaces.data.some((i) => i.name === "fwpr101p0") && !s.interfaces.data.some((i) => i.name === "fwln101i0"));
    const rotto = await collectDevice(FIXTURE["proxmox-ve"].richiesta, t(["bridge -j fdb show dynamic", "ip -j neigh show"]));
    assert.equal(rotto.forwarding.status, "error");
    assert.ok(rotto.network.warnings.includes("ARP_NOT_READ"));
});

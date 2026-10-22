/**
 * Collector `proxmox-ve` esteso verso la parità con la scansione Proxmox di oggi (giro 5): guest con stato, risorse, dischi e
 * reti, storage, nodi. Forme da `pvesh` e dai file di configurazione di Proxmox; dati inventati.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./contratto-fixture";
import { collectDevice } from "../index";
import { descrittore } from "../catalogo";
import { parseConfigurazioniGuest, parseRisorseCluster } from "../proxmox-parsers";
import type { AcquisitionTransports } from "../schema";

test("proxmox-ve: guest, storage e nodi dalla fixture; nessun segreto del JSON di pvesh", async () => {
    const { snapshot: s } = await FIXTURE["proxmox-ve"].normale();
    const g = s.guests!.data;
    assert.deepEqual(g.map(x => [x.id, x.power_state, x.platform, x.node, x.vmid, x.cpu_count, x.memory_bytes, x.disk_bytes]), [
        ["qemu/100", "running", "qemu", "pve-lab", 100, 4, "8589934592", "34359738368"],
        ["qemu/101", "off", "qemu", "pve-lab", 101, 2, "2147483648", "10737418240"],
        ["lxc/200", "running", "lxc", "pve-lab", 200, 1, "536870912", "8589934592"],
    ]);
    assert.deepEqual(g[0].disks, [{ id: "scsi0", storage: "local-lvm", size: "32G" }], "il CD-ROM non è un disco; sotto [prima] c'è la configurazione vecchia");
    assert.deepEqual(g[0].networks, [{ id: "net0", model: "virtio", mac: "02:00:00:00:90:10", bridge: "vmbr0", vlan: "20", ip: null }]);
    assert.deepEqual([g[0].bios, g[0].machine, g[0].agent], ["ovmf", "q35", "1"]);
    assert.deepEqual(g[2].disks, [{ id: "rootfs", storage: "local-lvm", size: "8G" }]);
    assert.deepEqual(g[2].networks, [{ id: "net0", model: null, mac: "02:00:00:00:90:20", bridge: "vmbr0", vlan: "30", ip: "192.0.2.200/24" }]);
    assert.deepEqual(s.storage_pools!.data[0], { name: "local-lvm", node: "pve-lab", type: "lvmthin", status: "available", total_bytes: "100000000000", used_bytes: "25000000000", available_bytes: "75000000000", content: ["rootdir", "images"], shared: false });
    assert.deepEqual(s.cluster_nodes!.data[0], { name: "pve-lab", status: "online", uptime_seconds: 86400, cpu_count: 8, cpu_fraction: 0.05, memory_total_bytes: "34359738368", memory_used_bytes: "8589934592" });
    assert.ok(!JSON.stringify(s).includes("non-esportare"));
    assert.equal(s.guests!.status, "ok");
    assert.ok(s.guests!.warnings.includes("GUEST_IP_ADDRESSES_NOT_COLLECTED"));
});

test("proxmox-ve: configurazioni non leggibili (utente senza permesso) → guest senza dischi e reti, sezione parziale e dichiarata", async () => {
    const { PROXMOX_USCITE } = await import("./contratto-fixture");
    const t: AcquisitionTransports = {
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); },
        shell: async c => Object.fromEntries(c.map(x => [x, x.startsWith("grep -H")
            ? { status: "error" as const, data: "", warnings: ["SSH_PERMISSION_DENIED"] }
            : { status: "ok" as const, data: PROXMOX_USCITE[x] ?? "", warnings: [] }])),
    };
    const s = await collectDevice(FIXTURE["proxmox-ve"].richiesta, t);
    assert.equal(s.guests!.data.length, 3, "i guest letti dal cluster restano");
    assert.deepEqual(s.guests!.data[0].disks, []);
    assert.equal(s.guests!.status, "partial");
    assert.ok(s.guests!.warnings.includes("QEMU_CONFIG_NOT_READ") && s.guests!.warnings.includes("LXC_CONFIG_NOT_READ"));
});

test("proxmox-ve: cluster/resources illeggibile → sezioni vuote e parziali, mai un elenco vuoto «ok»", () => {
    assert.equal(parseRisorseCluster("non è json"), null);
    assert.equal(parseRisorseCluster('{"data":[]}'), null);
    assert.deepEqual(parseConfigurazioniGuest("niente di riconoscibile", false).size, 0);
});

test("proxmox-ve: l'allowlist ha i due grep in sola lettura e le sezioni nuove sono dichiarate", () => {
    const d = descrittore("proxmox-ve");
    assert.ok(d.comandi?.includes('grep -H "" /etc/pve/nodes/*/qemu-server/*.conf') && d.comandi.includes('grep -H "" /etc/pve/nodes/*/lxc/*.conf'));
    for (const sez of ["guests", "storage_pools", "cluster_nodes"]) assert.ok(d.sezioni.includes(sez), sez);
});

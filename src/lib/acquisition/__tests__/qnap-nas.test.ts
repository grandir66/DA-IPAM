/**
 * Collector `qnap-nas` (non collaudato): parser puri e snapshot dalla fixture con la forma documentata (dati inventati).
 * Requisiti dei donatori: firmware mai dall'uname; colonne di `df` per nome; byte come stringhe decimali.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE, QNAP_NAS_USCITE } from "./contratto-fixture";
import { parseDf, parseIpAddr, parseIpLink, parseLsblk, parseUname } from "../linux-parsers";
import { parseExports, parseQpkgConf, parseSmbConf, unisciCondivisioni } from "../qnap-nas-parsers";
import { descrittore } from "../catalogo";

test("qnap-nas: dichiarato non collaudato, nessun modello collaudato", () => {
    const d = descrittore("qnap-nas");
    assert.equal(d.collaudo, "non_collaudato");
    assert.deepEqual(d.collaudati, []);
    assert.equal(d.ssh_modo, "exec");
});

test("qnap-nas: identità col firmware della build, kernel solo in system", async () => {
    const { snapshot } = await FIXTURE["qnap-nas"].normale();
    assert.equal(snapshot.identity.data?.firmware, "5.1.5 build 20240101");
    assert.equal(snapshot.identity.data?.model, "TS-LAB4");
    assert.equal(snapshot.identity.data?.manufacturer, "QNAP");
    assert.equal(snapshot.system?.data.kernel, "Linux 5.10.60-qnap");
    assert.notEqual(snapshot.identity.data?.firmware, snapshot.system?.data.kernel);
    assert.equal(snapshot.identity.status, "ok");
});

test("qnap-nas: condivisioni SMB e NFS unite per percorso, pacchetti, filesystem in byte", async () => {
    const { snapshot } = await FIXTURE["qnap-nas"].normale();
    assert.deepEqual(snapshot.shares?.data, [{ name: "Public", path: "/share/CACHEDEV1_DATA/Public", protocols: ["smb", "nfs"], comment: "Cartella di prova", public: true }]);
    assert.equal(snapshot.shares?.status, "ok");
    assert.deepEqual(snapshot.software?.data.map(p => [p.name, p.version]), [["HybridBackup", "3.0.0"]]);
    const fs = snapshot.host_storage?.data.filesystems[0];
    assert.equal(fs?.size_bytes, "9216000000000");
    assert.equal(fs?.inodes_free, "299980000");
    assert.equal(snapshot.host_storage?.status, "partial", "dischi e RAID non letti: mai ok");
    assert.equal(snapshot.network.data.ipv4_addresses[0]?.netmask, "255.255.255.0");
    assert.deepEqual(snapshot.interfaces.data.map(i => [i.name, i.kind, i.oper_status]), [["lo", "other", null], ["eth0", "physical", "up"]]);
    assert.equal(snapshot.poe.status, "unsupported");
});

test("qnap-nas: un apparato che non risponde come QNAP non dichiara niente letto", async () => {
    const { snapshot } = await (async () => {
        const { collectDevice } = await import("../index");
        const t = { get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); }, shell: async (c: readonly string[]) => Object.fromEntries(c.map(x => [x, { status: "unsupported" as const, data: "", warnings: ["COMMAND_UNSUPPORTED"] }])) };
        return { snapshot: await collectDevice(FIXTURE["qnap-nas"].richiesta, t) };
    })();
    assert.equal(snapshot.status, "error");
    assert.equal(snapshot.identity.data, null);
    assert.equal(snapshot.shares, undefined);
});

test("parser: df con il punto di montaggio con spazi e intestazione per nome; formato ignoto = null", () => {
    const df = parseDf("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 40 60 40% /mnt/con spazi\n", "");
    assert.deepEqual(df?.[0], { device: "/dev/sda1", mount_point: "/mnt/con spazi", type: null, size_bytes: "102400", used_bytes: "40960", available_bytes: "61440", inodes_total: null, inodes_used: null, inodes_free: null });
    assert.equal(parseDf("qualcosa di diverso\n1 2 3", ""), null);
});

test("parser: uname, ip, lsblk", () => {
    assert.deepEqual(parseUname("Linux 6.1.0 x86_64\n"), { kernel: "Linux 6.1.0", architecture: "x86_64" });
    assert.deepEqual(parseUname("BusyBox"), { kernel: null, architecture: null });
    assert.equal(parseIpLink(QNAP_NAS_USCITE["ip -o link show"]).length, 2);
    assert.deepEqual(parseIpAddr("3: bond0    inet 198.51.100.7/30 scope global bond0"), [{ address: "198.51.100.7", netmask: "255.255.255.252", if_index: 3 }]);
    assert.deepEqual(parseLsblk('{"blockdevices":[{"name":"sda","size":4000787030016,"model":"LAB DISK","serial":"LABS1","rota":true,"tran":"sata"},{"name":"loop0","size":"1","rota":"0"}]}'),
        [{ name: "sda", model: "LAB DISK", serial_number: "LABS1", size_bytes: "4000787030016", rotational: true, transport: "sata" }]);
    assert.equal(parseLsblk("non json"), null);
});

test("parser: smb.conf senza sezioni speciali, exports con e senza virgolette, qpkg", () => {
    const smb = parseSmbConf("[global]\nx = 1\n[homes]\n[Dati]\npath = /share/Dati\nguest ok = no\n");
    assert.deepEqual(smb, [{ name: "Dati", path: "/share/Dati", protocols: ["smb"], comment: null, public: false }]);
    assert.equal(parseSmbConf(""), null);
    assert.deepEqual(parseExports('# c\n"/share/A B" *(ro)\n/share/C 192.0.2.0/24(rw)\n'), ["/share/A B", "/share/C"]);
    assert.deepEqual(unisciCondivisioni(smb ?? [], ["/share/Solo"]).map(c => [c.name, c.protocols]), [["Dati", ["smb"]], ["Solo", ["nfs"]]]);
    assert.equal(parseQpkgConf("[X]\nVersion = 1\n")?.[0].name, "X");
});

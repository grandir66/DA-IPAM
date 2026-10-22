/**
 * Collector `qnap-nas` (base collaudata in locale, più firmware, condivisioni e pacchetti del giro 3 non ancora provati su un apparato):
 * fixture con la forma documentata (dati inventati). Requisiti dei donatori: firmware mai dall'uname; colonne di `df` per nome.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE, QNAP_NAS_USCITE } from "./contratto-fixture";
import { parseDf, parseIpAddr, parseIpLink, parseLsblk, parseUname } from "../linux-parsers";
import { parseExports, parseQpkgConf, parseSmbConf, unisciCondivisioni } from "../qnap-nas-parsers";
import { descrittore } from "../catalogo";
import { collectDevice } from "../index";
import type { AcquisitionTransports } from "../schema";

test("qnap-nas: una sola famiglia, collaudata in locale, letta dal motore d'inventario con exec", () => {
    const d = descrittore("qnap-nas");
    assert.equal(d.collaudo, "collaudato");
    assert.equal(d.motore, "inventario");
    assert.equal(d.ssh_modo, "exec");
    assert.ok(d.comandi?.includes("getsysinfo firmver") && d.comandi.includes("cat /etc/version"), "firmware del percorso storico (S2)");
    assert.ok(!d.comandi?.some(c => /sudo|reboot|^set |^\/export/.test(c)), "solo letture");
});

test("qnap-nas: firmware dal percorso storico con la build, mai dal valore di getcfg quando getsysinfo risponde", async () => {
    const { snapshot } = await FIXTURE["qnap-nas"].normale();
    assert.equal(snapshot.identity.data?.firmware, "5.1.5 build 20240101", "getsysinfo firmver + build, non il 5.1.4 di getcfg");
    assert.equal(snapshot.identity.data?.model, "TS-LAB4");
    assert.equal(snapshot.identity.data?.manufacturer, "QNAP");
});

test("qnap-nas: se getsysinfo e /etc/version non rispondono resta il firmware del collaudo (getcfg)", async () => {
    const t: AcquisitionTransports = {
        get: async () => { throw Error("x"); }, walk: async () => { throw Error("x"); },
        shell: async c => Object.fromEntries(c.map(x => [x, x === "getsysinfo firmver" || x === "cat /etc/version" ? { status: "unsupported" as const, data: "", warnings: ["COMMAND_UNSUPPORTED"] } : { status: "ok" as const, data: QNAP_NAS_USCITE[x] ?? "", warnings: [] }])),
    };
    const s = await collectDevice(FIXTURE["qnap-nas"].richiesta, t);
    assert.equal(s.identity.data?.firmware, "5.1.4");
});

test("qnap-nas: condivisioni SMB e NFS unite per percorso, pacchetti QPKG", async () => {
    const { snapshot } = await FIXTURE["qnap-nas"].normale();
    assert.deepEqual(snapshot.shares?.data, [{ name: "Public", path: "/share/CACHEDEV1_DATA/Public", protocols: ["smb", "nfs"], comment: "Cartella di prova", public: true }]);
    assert.equal(snapshot.shares?.status, "ok");
    assert.deepEqual(snapshot.software?.data.map(p => [p.name, p.version]), [["HybridBackup", "3.0.0"]]);
    assert.equal(snapshot.poe.status, "skipped", "nessuna sezione da switch");
});

test("qnap-nas: con la sola SNMP non si dichiarano condivisioni né pacchetti letti", async () => {
    const t: AcquisitionTransports = { get: async () => ({ status: "ok", data: [], warnings: [] }), walk: async () => ({ status: "ok", data: [], warnings: [] }), shell: async () => { throw Error("nessuna shell senza SSH"); } };
    const s = await collectDevice({ collector: "qnap-nas", host: "192.0.2.40", snmp: { community: "lab" } }, t);
    assert.equal(s.shares, undefined);
    assert.equal(s.software, undefined);
});

test("parser: df con il punto di montaggio con spazi e intestazione per nome; formato ignoto = null", () => {
    const df = parseDf("Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 40 60 40% /mnt/con spazi\n", "");
    assert.deepEqual(df?.[0], { device: "/dev/sda1", mount_point: "/mnt/con spazi", type: null, size_bytes: "102400", used_bytes: "40960", available_bytes: "61440", inodes_total: null, inodes_used: null, inodes_free: null });
    assert.equal(parseDf("qualcosa di diverso\n1 2 3", ""), null);
});

test("parser: uname, ip, lsblk", () => {
    assert.deepEqual(parseUname("Linux 6.1.0 x86_64\n"), { kernel: "Linux 6.1.0", architecture: "x86_64" });
    assert.deepEqual(parseUname("BusyBox"), { kernel: null, architecture: null });
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

test("qnap-nas: solo SNMP (collaudo .24, QGD-1602P) – modello, seriale, nome, temperatura e ventole dagli OID giusti; firmware assente", async () => {
    // forma del walk del 22/10: 24681.1.2.1/.2/.3 sono CPU %, memoria totale e libera, NON identità
    const valori: Record<string, string> = {
        "1.3.6.1.4.1.24681.1.2.1.0": "12 %", "1.3.6.1.4.1.24681.1.2.2.0": "15979.0 MB", "1.3.6.1.4.1.24681.1.2.3.0": "9876.5 MB",
        "1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.3.1": "QGD-1602P", "1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.4.1": "Q000LAB01",
        "1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.6.1": "nas-prova", "1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.7.1": "41",
        "1.3.6.1.2.1.1.5.0": "nas-prova",
    };
    const ventole = [
        { oid: "1.3.6.1.4.1.55062.1.12.9.1.2.1", value: "Ventola 1" }, { oid: "1.3.6.1.4.1.55062.1.12.9.1.3.1", value: "2100" },
    ];
    const t: AcquisitionTransports = {
        get: async oids => ({ status: "ok", data: oids.filter(o => o in valori).map(o => ({ oid: o, value: valori[o] })) as never, warnings: [] }),
        walk: async oid => ({ status: "ok", data: (oid === "1.3.6.1.4.1.55062.1.12.9.1" ? ventole : []) as never, warnings: [] }),
        shell: async () => { throw Error("nessuna shell senza SSH"); },
    };
    const s = await collectDevice({ collector: "qnap-nas", host: "192.0.2.40", snmp: { community: "lab" } }, t);
    assert.deepEqual([s.identity.data?.model, s.identity.data?.firmware, s.identity.data?.serial_number], ["QGD-1602P", null, "Q000LAB01"]);
    for (const v of [s.identity.data?.model, s.identity.data?.firmware, s.identity.data?.serial_number]) assert.ok(!/MB|%/.test(String(v ?? "")), "mai una misura come identità");
    const sens = s.sensors?.data ?? [];
    assert.deepEqual(sens.filter(x => x.kind === "temperature").map(x => x.value), [41]);
    assert.deepEqual(sens.filter(x => x.kind === "fan").map(x => [x.name, x.value, x.unit]), [["Ventola 1", 2100, "rpm"]]);
});

test("qnap-nas: un OID che risponde con una misura (MB, %) non diventa mai modello, firmware o seriale", async () => {
    const valori: Record<string, string> = {
        "1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.3.1": "12 %", "1.3.6.1.4.1.24681.1.4.1.1.1.1.1.2.1.4.1": "15979.0 MB",
        "1.3.6.1.4.1.55062.1.12.3.0": "8 GB",
    };
    const t: AcquisitionTransports = {
        get: async oids => ({ status: "ok", data: oids.filter(o => o in valori).map(o => ({ oid: o, value: valori[o] })) as never, warnings: [] }),
        walk: async () => ({ status: "ok", data: [], warnings: [] }),
        shell: async () => { throw Error("nessuna shell senza SSH"); },
    };
    const s = await collectDevice({ collector: "qnap-nas", host: "192.0.2.40", snmp: { community: "lab" } }, t);
    assert.deepEqual([s.identity.data?.model, s.identity.data?.firmware, s.identity.data?.serial_number], [null, null, null]);
});

/**
 * Collector `linux` (collaudato il 22/10): utente senza sudo, comandi assenti = non supportato, colonne per nome, byte e
 * inode come stringhe decimali, LVM in JSON, servizi systemd per nome.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE } from "./contratto-fixture";
import { descrittore } from "../catalogo";
import { byteLvm, parseLvmReport, parseSystemctlShow, parseTimedatectl } from "../linux-parsers";

test("linux: collaudato (Ubuntu 24.04), nessun sudo nell'allowlist, solo letture", () => {
    const d = descrittore("linux");
    assert.equal(d.collaudo, "collaudato");
    for (const c of d.comandi ?? []) assert.ok(!/\bsudo\b|>|\brm\b|\bkill\b|systemctl (start|stop|restart|enable|disable)/.test(c), c);
});

test("linux: snapshot dalla fixture", async () => {
    const { snapshot: s } = await FIXTURE.linux.normale();
    assert.equal(s.identity.data?.firmware, "Debian GNU/Linux 12 (bookworm)");
    assert.equal(s.identity.data?.serial_number, null, "seriale DMI solo da root");
    assert.ok(s.identity.warnings.includes("SERIAL_NEEDS_ROOT_OR_ABSENT"));
    assert.deepEqual([s.system?.data.kernel, s.system?.data.timezone, s.system?.data.ntp.synchronized], ["Linux 6.1.0-26-amd64", "Europe/Rome", true]);
    assert.deepEqual(s.system?.data.mandatory_access_control, { selinux: null, apparmor: "enabled" });
    const hs = s.host_storage!.data;
    assert.deepEqual(hs.filesystems[0], { device: "/dev/mapper/vg0-root", mount_point: "/", type: "ext4", size_bytes: "51200000000", used_bytes: "10240000000", available_bytes: "37888000000", inodes_total: "3276800", inodes_used: "120000", inodes_free: "3156800" });
    assert.deepEqual(hs.volume_groups, [{ name: "vg0", size_bytes: "106300440576", free_bytes: "0", logical_volume_count: 2 }]);
    assert.equal(hs.logical_volumes[0].path, "/dev/vg0/root");
    assert.equal(hs.disks[0].rotational, false);
    assert.equal(s.host_storage?.status, "ok");
    assert.deepEqual(s.software?.data.map(p => [p.name, p.source]), [["openssh-server", "dpkg"], ["bash", "dpkg"]]);
    assert.equal(s.software?.status, "ok", "rpm assente non rende parziale il software letto con dpkg");
    assert.deepEqual(s.services?.data.map(x => [x.name, x.state, x.start_mode]), [["ssh.service", "running", "auto"], ["cron.service", "stopped", "disabled"]]);
});

test("parser: LVM con e senza suffisso, report non JSON; systemctl e timedatectl per chiave", () => {
    assert.equal(byteLvm("1000B"), "1000");
    assert.equal(byteLvm("1.5g"), null);
    assert.equal(parseLvmReport("  WARNING: Running as a non-root user.", "vg"), null);
    assert.equal(parseSystemctlShow("niente di riconoscibile"), null);
    assert.deepEqual(parseTimedatectl("NTP=no\n"), { timezone: null, enabled: false, synchronized: null });
});

test("linux: forma del collaudo `da-ftp` – timedatectl fallisce, dischi, pacchetti, servizi e interfacce restano letti", async () => {
    const { collectDevice } = await import("../index");
    const { LINUX_USCITE } = await import("./contratto-fixture");
    const t = {
        get: async () => { throw Error("nessuno SNMP"); }, walk: async () => { throw Error("nessuno SNMP"); },
        // Come fa leggiLotto: l'errore di un comando è la sua lettura, gli altri comandi sono stati eseguiti.
        shell: async (comandi: readonly string[]) => Object.fromEntries(comandi.map(c => [c, c.startsWith("timedatectl")
            ? { status: "error" as const, data: "", warnings: ["SSH_COMMAND_FAILED"] }
            : { status: "ok" as const, data: LINUX_USCITE[c] ?? "", warnings: [] }])),
    };
    const s = await collectDevice({ collector: "linux", host: "192.0.2.14", ssh: { username: "lab", password: "x" } }, t);
    assert.ok(s.host_storage?.data.filesystems.length, "dischi");
    assert.ok(s.software?.data.length, "pacchetti");
    assert.ok(s.services?.data.length, "servizi");
    assert.ok(s.interfaces.data.length, "interfacce");
    assert.ok(s.system?.warnings.length, "la lettura mancante è dichiarata, non nascosta");
});

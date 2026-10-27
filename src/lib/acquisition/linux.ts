/**
 * Collector `linux` (piano 2026-10-21 C3, E12, E14): un server Linux letto via SSH exec con un utente senza privilegi,
 * un login, allowlist `LINUX_COMMANDS` (nessun `sudo`). Sistema (os-release, kernel, fuso e NTP da `timedatectl`,
 * SELinux e AppArmor), memoria, interfacce e IPv4, dischi (`lsblk -J -b`), LVM in JSON (`pvs`/`vgs`/`lvs`), filesystem
 * con byte e inode (`df -P`, colonne per nome), pacchetti (dpkg o rpm, uno dei due) e servizi systemd per nome.
 *
 * Senza root alcune letture mancano (seriale DMI, LVM su molte distribuzioni): sono `error` o `partial` col codice, mai
 * vuote `ok`. **Non collaudato** (repertorio dei comandi da DADude3 `linux.py:432,794`) e non nel riconoscimento.
 */
import { versioneCollector } from "./catalogo";
import { LINUX_COMMANDS } from "./comandi";
import { chiudi, daLettura, leggiTutto, nonLetto, primoTesto, sez, sezioniDaSwitchNonApplicabili, statoGlobale } from "./costruzione";
import {
    byteLvm, parseApparmor, parseDf, parseGetenforce, parseIpAddr, parseIpLink, parseLsblk, parseLvmReport, parseMeminfo, parseNomeVersione, parseOsRelease,
    parseSystemctlShow, parseTimedatectl, parseUname, parseUptime,
} from "./linux-parsers";
import { acquisitionInputSchema } from "./schema";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports } from "./schema";
import { createTransports } from "./transports";

type Comando = (typeof LINUX_COMMANDS)[number];
/** Il comando dell'allowlist che comincia così (le stringhe lunghe non si ripetono a mano). */
const comando = (inizio: string): Comando => {
    const c = LINUX_COMMANDS.find(x => x.startsWith(inizio));
    if (!c) throw Error("COMMAND_NOT_IN_ALLOWLIST");
    return c;
};
const DPKG = comando("dpkg-query"), RPM = comando("rpm "), PVS = comando("pvs "), VGS = comando("vgs "), LVS = comando("lvs "), LSBLK = comando("lsblk "), SYSTEMCTL = comando("systemctl show");

export async function collectLinux(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== "linux") throw Error("COLLECTOR_MISMATCH");
    const inizio = Date.now(), io = transports ?? createTransports(input);
    const letture = await leggiTutto(c => io.shell(c), LINUX_COMMANDS, "SSH_TRANSPORT_EXCEPTION");
    const r = (c: Comando) => letture[c] ?? nonLetto();
    const okTesto = (c: Comando) => (r(c).status === "ok" ? r(c).data : "");

    const os = parseOsRelease(okTesto("cat /etc/os-release"));
    const uname = parseUname(okTesto("uname -srm"));
    const riconosciuto = os.os_name !== null && uname.kernel !== null;
    const uptime = parseUptime(okTesto("cat /proc/uptime"));
    const snapshot: AcquisitionSnapshot = {
        schema_version: "1.0", collector: "linux", collector_version: versioneCollector("linux"), target: input.host,
        collected_at: new Date(inizio).toISOString(), duration_ms: 0, status: "error",
        identity: sez(riconosciuto ? {
            manufacturer: primoTesto(r("cat /sys/class/dmi/id/sys_vendor")), model: primoTesto(r("cat /sys/class/dmi/id/product_name")), firmware: os.os_name,
            serial_number: primoTesto(r("cat /sys/class/dmi/id/product_serial")), hostname: primoTesto(r("hostname")), mac: null, sys_object_id: null, uptime_seconds: uptime,
        } : null, riconosciuto ? (primoTesto(r("cat /sys/class/dmi/id/product_name")) ? "ok" : "partial") : "error",
        ["ssh:cat /etc/os-release", "ssh:uname -srm", "ssh:cat /sys/class/dmi/id/product_name"],
        riconosciuto ? (r("cat /sys/class/dmi/id/product_serial").status === "ok" ? [] : ["SERIAL_NEEDS_ROOT_OR_ABSENT"]) : ["DEVICE_NOT_IDENTIFIED_AS_LINUX", ...r("cat /etc/os-release").warnings]),
        interfaces: sez([]), network: sez({ ipv4_addresses: [], arp: [] }),
        ...sezioniDaSwitchNonApplicabili(),
    };
    if (!riconosciuto) {
        snapshot.interfaces = sez([], "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_LINUX"]);
        snapshot.network = sez({ ipv4_addresses: [], arp: [] }, "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_LINUX"]);
        return chiudi(snapshot, input, inizio);
    }

    const tdc = parseTimedatectl(okTesto("timedatectl show"));
    const selinux = parseGetenforce(okTesto("getenforce")), apparmor = parseApparmor(okTesto("cat /sys/module/apparmor/parameters/enabled"));
    snapshot.system = sez({
        os_name: os.os_name, os_version: os.os_version, os_build: null, kernel: uname.kernel, architecture: uname.architecture, timezone: tdc.timezone, boot_time: null, uptime_seconds: uptime,
        ntp: { enabled: tdc.enabled, synchronized: tdc.synchronized, servers: [] }, mandatory_access_control: { selinux, apparmor },
    }, r("timedatectl show").status === "ok" && tdc.timezone ? "ok" : "partial",
    ["ssh:cat /etc/os-release", "ssh:uname -srm", "ssh:timedatectl show", "ssh:getenforce", "ssh:cat /sys/module/apparmor/parameters/enabled"],
    [...(r("timedatectl show").status === "ok" ? [] : ["TIMEDATECTL_NOT_READ"]), "NTP_SERVERS_NOT_COLLECTED"]);

    const mem = parseMeminfo(okTesto("cat /proc/meminfo"));
    snapshot.resources = sez({ cpu_percent: null, ...mem }, mem.memory_total_bytes !== null ? "ok" : r("cat /proc/meminfo").status === "ok" ? "partial" : r("cat /proc/meminfo").status, ["ssh:cat /proc/meminfo"], ["CPU_NOT_COLLECTED"]);

    snapshot.interfaces = daLettura(r("ip -o link show"), t => { const v = parseIpLink(t); return v.length ? v : null; }, [], "ssh:ip -o link show", v => v.length > 0);
    const ind = daLettura(r("ip -o -4 addr show"), t => { const v = parseIpAddr(t); return v.length ? v : null; }, [], "ssh:ip -o -4 addr show", v => v.length > 0);
    snapshot.network = sez({ ipv4_addresses: ind.data, arp: [] }, ind.status, ind.sources, [...ind.warnings, "ARP_NOT_COLLECTED"]);

    // Storage dell'host: ogni parte col suo esito; la sezione è ok solo se tutte e quattro lo sono.
    const dischi = daLettura(r(LSBLK), parseLsblk, [], "ssh:lsblk -J -b", () => true);
    const fs = daLettura(r("df -P -k -T"), t => parseDf(t, okTesto("df -P -i")), [], "ssh:df -P -k -T", v => v.length > 0);
    const pv = daLettura(r(PVS), t => parseLvmReport(t, "pv"), [], "ssh:pvs", () => true);
    const vg = daLettura(r(VGS), t => parseLvmReport(t, "vg"), [], "ssh:vgs", () => true);
    const lv = daLettura(r(LVS), t => parseLvmReport(t, "lv"), [], "ssh:lvs", () => true);
    const parti = [dischi, fs, pv, vg, lv];
    const lvmAssente = [pv, vg, lv].every(p => p.status === "unsupported");
    snapshot.host_storage = sez({
        disks: dischi.data,
        physical_volumes: pv.data.map(x => ({ name: x.pv_name, volume_group: x.vg_name || null, size_bytes: byteLvm(x.pv_size), free_bytes: byteLvm(x.pv_free) })),
        volume_groups: vg.data.map(x => ({ name: x.vg_name, size_bytes: byteLvm(x.vg_size), free_bytes: byteLvm(x.vg_free), logical_volume_count: /^\d+$/.test(x.lv_count ?? "") ? Number(x.lv_count) : null })),
        logical_volumes: lv.data.map(x => ({ name: x.lv_name, volume_group: x.vg_name || null, size_bytes: byteLvm(x.lv_size), path: x.lv_path || null })),
        filesystems: fs.data,
    }, parti.every(p => p.status === "ok" || (lvmAssente && p.status === "unsupported")) ? "ok" : parti.some(p => p.status === "ok" || p.status === "partial") ? "partial" : "error",
    parti.flatMap(p => p.sources), [...parti.flatMap(p => p.warnings), ...(lvmAssente ? ["LVM_NOT_INSTALLED"] : [])]);

    // Pacchetti: dpkg o rpm (l'altro manca: 127, non supportato). Nessuno dei due letto = errore detto.
    const dpkg = daLettura(r(DPKG), t => parseNomeVersione(t, "dpkg"), [], "ssh:dpkg-query", v => v.length > 0);
    const rpm = daLettura(r(RPM), t => parseNomeVersione(t, "rpm"), [], "ssh:rpm -qa", v => v.length > 0);
    const letto = [dpkg, rpm].find(p => p.status === "ok") ?? [dpkg, rpm].find(p => p.status === "partial");
    snapshot.software = letto ? sez(letto.data, letto.status, letto.sources, letto.warnings)
        : sez([], dpkg.status === "unsupported" && rpm.status === "unsupported" ? "unsupported" : "error", [...dpkg.sources, ...rpm.sources], [...dpkg.warnings, ...rpm.warnings, "NO_PACKAGE_MANAGER_READ"]);

    snapshot.services = daLettura(r(SYSTEMCTL), parseSystemctlShow, [], "ssh:systemctl show", v => v.length > 0);

    snapshot.status = statoGlobale([snapshot.identity, snapshot.system, snapshot.resources, snapshot.interfaces, snapshot.network, snapshot.host_storage, snapshot.software, snapshot.services]);
    return chiudi(snapshot, input, inizio);
}

/**
 * Collector `qnap-nas` (piano 2026-10-21 C3, D1 e D3): un QNAP NAS (QTS, QuTS hero) letto via SSH exec, solo comandi
 * dell'allowlist `QNAP_NAS_COMMANDS`, un login solo. Distinto da `qnap-switch` (QSS).
 *
 * Firmware come nel percorso storico corretto (S2): `getsysinfo firmver`, poi `/etc/version`, con la build; mai l'`uname`
 * (quello è il kernel, va in `system.kernel`). Cartelle condivise da `smb.conf` ed `/etc/exports`, pacchetti da
 * `qpkg.conf`. Le sezioni da switch sono `unsupported`.
 *
 * **Non collaudato**: forma delle uscite dalla documentazione e dal donatore, fixture inventate. Non è agganciato al
 * riconoscimento del prodotto (`riconosci.ts`): si usa dalla CLI finché un QNAP vero non l'ha letto.
 */
import { parseQnapVersione } from "../devices/nas/qnap-versione";
import { versioneCollector } from "./catalogo";
import { QNAP_NAS_COMMANDS } from "./comandi";
import { chiudi, daLettura, leggiTutto, nonLetto, primoTesto, sez, sezioniDaSwitchNonApplicabili, statoGlobale } from "./costruzione";
import { parseDf, parseIpAddr, parseIpLink, parseMeminfo, parseUname, parseUptime } from "./linux-parsers";
import { parseExports, parsePlatformConf, parseQpkgConf, parseSmbConf, unisciCondivisioni } from "./qnap-nas-parsers";
import { acquisitionInputSchema } from "./schema";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports } from "./schema";
import { createTransports } from "./transports";

export async function collectQnapNas(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== "qnap-nas") throw Error("COLLECTOR_MISMATCH");
    const inizio = Date.now(), io = transports ?? createTransports(input);
    // Una sola apertura della shell per tutti i comandi: un login, e nessun secondo tentativo dopo un errore.
    const letture = await leggiTutto(c => io.shell(c), QNAP_NAS_COMMANDS, "SSH_TRANSPORT_EXCEPTION");
    const r = (c: (typeof QNAP_NAS_COMMANDS)[number]) => letture[c] ?? nonLetto();

    const versione = parseQnapVersione({ firmver: r("getsysinfo firmver").status === "ok" ? r("getsysinfo firmver").data : "", etcVersion: r("cat /etc/version").status === "ok" ? r("cat /etc/version").data : "", build: r("cat /etc/default_config/WEBAPP.build").status === "ok" ? r("cat /etc/default_config/WEBAPP.build").data : "" });
    const piattaforma = parsePlatformConf(r("cat /etc/platform.conf").status === "ok" ? r("cat /etc/platform.conf").data : "");
    const modello = primoTesto(r("getsysinfo model")) ?? piattaforma.model;
    const riconosciuto = modello !== null || versione.firmware !== null;
    const uname = parseUname(r("uname -srm").status === "ok" ? r("uname -srm").data : "");
    const uptime = r("cat /proc/uptime").status === "ok" ? parseUptime(r("cat /proc/uptime").data) : null;
    const fontiId = ["ssh:getsysinfo model", "ssh:getsysinfo firmver", "ssh:cat /etc/version", "ssh:cat /etc/platform.conf"];
    const avvisiId = [...(modello ? [] : ["MODEL_NOT_READ"]), ...(versione.firmware ? [] : ["FIRMWARE_NOT_READ"]), ...(riconosciuto ? [] : ["DEVICE_NOT_IDENTIFIED_AS_QNAP_NAS", ...r("getsysinfo model").warnings])];

    const snapshot: AcquisitionSnapshot = {
        schema_version: "1.0", collector: "qnap-nas", collector_version: versioneCollector("qnap-nas"), target: input.host,
        collected_at: new Date(inizio).toISOString(), duration_ms: 0, status: "error",
        identity: sez(riconosciuto ? { manufacturer: "QNAP", model: modello, firmware: versione.firmware, serial_number: primoTesto(r("getsysinfo serial")), hostname: primoTesto(r("hostname")), mac: null, sys_object_id: null, uptime_seconds: uptime } : null,
            riconosciuto ? (modello && versione.firmware ? "ok" : "partial") : "error", fontiId, avvisiId),
        interfaces: daLettura(r("ip -o link show"), t => { const v = parseIpLink(t); return v.length ? v : null; }, [], "ssh:ip -o link show", v => v.length > 0),
        network: sez({ ipv4_addresses: [], arp: [] }),
        ...sezioniDaSwitchNonApplicabili(),
    };
    if (!riconosciuto) {
        // Non è un QNAP NAS (o la shell non ha risposto): niente altro si dichiara letto.
        snapshot.interfaces = sez([], snapshot.interfaces.status === "error" ? "error" : "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_QNAP_NAS"]);
        snapshot.status = "error";
        return chiudi(snapshot, input, inizio);
    }

    const indirizzi = daLettura(r("ip -o -4 addr show"), t => { const v = parseIpAddr(t); return v.length ? v : null; }, [], "ssh:ip -o -4 addr show", v => v.length > 0);
    snapshot.network = sez({ ipv4_addresses: indirizzi.data, arp: [] }, indirizzi.status, indirizzi.sources, [...indirizzi.warnings, "ARP_NOT_COLLECTED"]);

    const sistema = { os_name: "QNAP QTS/QuTS hero", os_version: versione.firmware, os_build: versione.build, kernel: uname.kernel, architecture: uname.architecture, timezone: null, boot_time: null, uptime_seconds: uptime, ntp: { enabled: null, synchronized: null, servers: [] }, mandatory_access_control: { selinux: null, apparmor: null } };
    snapshot.system = sez(sistema, uname.kernel && versione.firmware ? "ok" : "partial", ["ssh:uname -srm", "ssh:cat /proc/uptime", "ssh:getsysinfo firmver"], ["QTS_OR_QUTS_HERO_NOT_DISTINGUISHED", "NTP_NOT_COLLECTED"]);

    const memoria = r("cat /proc/meminfo");
    const mem = memoria.status === "ok" ? parseMeminfo(memoria.data) : { memory_total_bytes: null, memory_free_bytes: null };
    snapshot.resources = sez({ cpu_percent: null, ...mem }, memoria.status === "ok" ? (mem.memory_total_bytes !== null ? "ok" : "partial") : memoria.status, ["ssh:cat /proc/meminfo"], [...memoria.warnings, "CPU_NOT_COLLECTED"]);

    const df = r("df -P -k"), dfi = r("df -P -i");
    const fs = daLettura(df, t => parseDf(t, dfi.status === "ok" ? dfi.data : ""), [], "ssh:df -P -k", v => v.length > 0);
    snapshot.host_storage = sez({ disks: [], physical_volumes: [], volume_groups: [], logical_volumes: [], filesystems: fs.data },
        fs.status === "ok" ? "partial" : fs.status, [...fs.sources, "ssh:df -P -i"], [...fs.warnings, ...(dfi.status === "ok" ? [] : ["INODES_NOT_READ"]), "DISKS_AND_RAID_NOT_COLLECTED"]);

    const smb = daLettura(r("cat /etc/config/smb.conf"), parseSmbConf, [], "ssh:cat /etc/config/smb.conf", () => true);
    const exp = r("cat /etc/exports");
    const nfs = exp.status === "ok" ? parseExports(exp.data) : [];
    snapshot.shares = sez(unisciCondivisioni(smb.data, nfs), smb.status === "ok" && exp.status === "ok" ? "ok" : smb.status === "ok" || smb.status === "partial" ? "partial" : smb.status,
        [...smb.sources, "ssh:cat /etc/exports"], [...smb.warnings, ...(exp.status === "ok" ? [] : ["NFS_EXPORTS_NOT_READ", ...exp.warnings])]);

    snapshot.software = daLettura(r("cat /etc/config/qpkg.conf"), parseQpkgConf, [], "ssh:cat /etc/config/qpkg.conf", () => true);

    snapshot.status = statoGlobale([snapshot.identity, snapshot.interfaces, snapshot.network, snapshot.system, snapshot.resources, snapshot.host_storage, snapshot.shares, snapshot.software]);
    return chiudi(snapshot, input, inizio);
}

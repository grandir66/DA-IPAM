/**
 * Collector `synology-nas` (piano 2026-10-21 C3, D3): un Synology con DSM 7 via SSH exec, un login, allowlist
 * `SYNOLOGY_NAS_COMMANDS`, nessun `sudo`. Firmware intero da `/etc.defaults/VERSION` (versione, build, update), modello e
 * seriale dai file del kernel DSM, sistema e rete come Linux, filesystem da `df -P`, cartelle condivise da
 * `smb.share.conf` più `/etc/exports` (e i nomi di `synoshare`, se l'utente può leggerli), pacchetti da tutti gli
 * `INFO` di `/var/packages` senza limiti silenziosi.
 *
 * `synoshare` si prova nelle due forme (`--enum`, `-enum`): quale vale sulla DSM vera è da verificare (piano §5, C3).
 * **Non collaudato** e non nel riconoscimento del prodotto.
 */
import { versioneCollector } from "./catalogo";
import { SYNOLOGY_NAS_COMMANDS } from "./comandi";
import { chiudi, daLettura, leggiTutto, nonLetto, primoTesto, sez, sezioniDaSwitchNonApplicabili, statoGlobale } from "./costruzione";
import { parseDf, parseIpAddr, parseIpLink, parseKeyValue, parseMeminfo, parseUname, parseUptime } from "./linux-parsers";
import { parseExports, parseSmbConf, unisciCondivisioni } from "./qnap-nas-parsers";
import { acquisitionInputSchema } from "./schema";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports } from "./schema";
import { parseInfoPacchetti, parseSynoshareEnum, parseVersioneDsm } from "./synology-nas-parsers";
import { createTransports } from "./transports";

type Comando = (typeof SYNOLOGY_NAS_COMMANDS)[number];

export async function collectSynologyNas(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== "synology-nas") throw Error("COLLECTOR_MISMATCH");
    const inizio = Date.now(), io = transports ?? createTransports(input);
    const letture = await leggiTutto(c => io.shell(c), SYNOLOGY_NAS_COMMANDS, "SSH_TRANSPORT_EXCEPTION");
    const r = (c: Comando) => letture[c] ?? nonLetto();
    const okTesto = (c: Comando) => (r(c).status === "ok" ? r(c).data : "");

    const dsm = parseVersioneDsm(okTesto("cat /etc.defaults/VERSION"));
    const info = parseKeyValue(okTesto("cat /etc/synoinfo.conf"));
    const modello = primoTesto(r("cat /proc/sys/kernel/syno_hw_version")) ?? (info.upnpmodelname || null);
    const riconosciuto = dsm.firmware !== null;
    const uname = parseUname(okTesto("uname -srm"));
    const uptime = parseUptime(okTesto("cat /proc/uptime"));
    const snapshot: AcquisitionSnapshot = {
        schema_version: "1.0", collector: "synology-nas", collector_version: versioneCollector("synology-nas"), target: input.host,
        collected_at: new Date(inizio).toISOString(), duration_ms: 0, status: "error",
        identity: sez(riconosciuto ? { manufacturer: "Synology", model: modello, firmware: dsm.firmware, serial_number: primoTesto(r("cat /proc/sys/kernel/syno_serial")), hostname: primoTesto(r("hostname")), mac: null, sys_object_id: null, uptime_seconds: uptime } : null,
            riconosciuto ? (modello ? "ok" : "partial") : "error", ["ssh:cat /etc.defaults/VERSION", "ssh:cat /proc/sys/kernel/syno_hw_version", "ssh:cat /etc/synoinfo.conf"],
            riconosciuto ? (modello ? [] : ["MODEL_NOT_READ"]) : ["DEVICE_NOT_IDENTIFIED_AS_SYNOLOGY", ...r("cat /etc.defaults/VERSION").warnings]),
        interfaces: sez([]), network: sez({ ipv4_addresses: [], arp: [] }),
        ...sezioniDaSwitchNonApplicabili(),
    };
    if (!riconosciuto) {
        snapshot.interfaces = sez([], "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_SYNOLOGY"]);
        snapshot.network = sez({ ipv4_addresses: [], arp: [] }, "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_SYNOLOGY"]);
        return chiudi(snapshot, input, inizio);
    }
    snapshot.system = sez({ os_name: "Synology DSM", os_version: dsm.versione, os_build: dsm.build, kernel: uname.kernel, architecture: uname.architecture, timezone: null, boot_time: null, uptime_seconds: uptime, ntp: { enabled: null, synchronized: null, servers: [] }, mandatory_access_control: { selinux: null, apparmor: null } },
        uname.kernel ? "ok" : "partial", ["ssh:cat /etc.defaults/VERSION", "ssh:uname -srm", "ssh:cat /proc/uptime"], ["NTP_NOT_COLLECTED"]);
    const mem = parseMeminfo(okTesto("cat /proc/meminfo"));
    snapshot.resources = sez({ cpu_percent: null, ...mem }, mem.memory_total_bytes !== null ? "ok" : r("cat /proc/meminfo").status === "ok" ? "partial" : r("cat /proc/meminfo").status, ["ssh:cat /proc/meminfo"], ["CPU_NOT_COLLECTED"]);

    snapshot.interfaces = daLettura(r("ip -o link show"), t => { const v = parseIpLink(t); return v.length ? v : null; }, [], "ssh:ip -o link show", v => v.length > 0);
    const ind = daLettura(r("ip -o -4 addr show"), t => { const v = parseIpAddr(t); return v.length ? v : null; }, [], "ssh:ip -o -4 addr show", v => v.length > 0);
    snapshot.network = sez({ ipv4_addresses: ind.data, arp: [] }, ind.status, ind.sources, [...ind.warnings, "ARP_NOT_COLLECTED"]);

    const fs = daLettura(r("df -P -k"), t => parseDf(t, okTesto("df -P -i")), [], "ssh:df -P -k", v => v.length > 0);
    snapshot.host_storage = sez({ disks: [], physical_volumes: [], volume_groups: [], logical_volumes: [], filesystems: fs.data },
        fs.status === "ok" ? "partial" : fs.status, [...fs.sources, "ssh:df -P -i"], [...fs.warnings, "DISKS_AND_RAID_NOT_COLLECTED"]);

    // Cartelle condivise: percorsi da smb.share.conf ed exports; i nomi di synoshare (se letti) aggiungono quelle senza SMB.
    const smb = daLettura(r("cat /etc/samba/smb.share.conf"), parseSmbConf, [], "ssh:cat /etc/samba/smb.share.conf", () => true);
    const exp = r("cat /etc/exports");
    const enumLetta = [r("synoshare --enum ALL"), r("synoshare -enum ALL")].find(x => x.status === "ok" && parseSynoshareEnum(x.data) !== null);
    const nomi = enumLetta ? parseSynoshareEnum(enumLetta.data) ?? [] : [];
    const condivise = unisciCondivisioni(smb.data, exp.status === "ok" ? parseExports(exp.data) : []);
    for (const n of nomi) if (!condivise.some(c => c.name === n)) condivise.push({ name: n, path: null, protocols: ["other"], comment: null, public: null });
    snapshot.shares = sez(condivise, smb.status === "ok" && exp.status === "ok" ? "ok" : condivise.length ? "partial" : smb.status,
        [...smb.sources, "ssh:cat /etc/exports", "ssh:synoshare"], [...smb.warnings, ...(exp.status === "ok" ? [] : ["NFS_EXPORTS_NOT_READ"]), ...(enumLetta ? [] : ["SYNOSHARE_NOT_READ"])]);

    snapshot.software = daLettura(r("cat /var/packages/*/INFO"), parseInfoPacchetti, [], "ssh:cat /var/packages/*/INFO", () => true);

    snapshot.status = statoGlobale([snapshot.identity, snapshot.system, snapshot.resources, snapshot.interfaces, snapshot.network, snapshot.host_storage, snapshot.shares, snapshot.software]);
    return chiudi(snapshot, input, inizio);
}

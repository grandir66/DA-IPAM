/**
 * Collector `windows` (piano 2026-10-21 C3, E07-E09, E11): Windows e Windows Server letti via WinRM con i soli script a
 * id fisso del descrittore (`SCRIPT_WINDOWS`, `script_winrm`), uno alla volta (`createWinrmReader`: dopo un errore di rete
 * o d'autenticazione gli altri non partono, nessuna seconda credenziale). Identità e sistema, adattatori e IPv4, dischi e
 * volumi, software dal registro (mai `Win32_Product`), ruoli, servizi, Defender e profili firewall, VM Hyper-V col GUID.
 * Le sezioni da switch sono `unsupported`.
 *
 * **Non collaudato** e non agganciato al riconoscimento del prodotto (`riconosci.ts`).
 */
import { versioneCollector } from "./catalogo";
import { chiudi, leggiTutto, nonLetto, sez, sezioniDaSwitchNonApplicabili, statoGlobale } from "./costruzione";
import type { Sezione, StatoSezione } from "./costruzione";
import { acquisitionInputSchema } from "./schema";
import type { AcquisitionRequest, AcquisitionSnapshot, AcquisitionTransports, ReadResult } from "./schema";
import { createTransports } from "./transports";
import { ID_SCRIPT_WINDOWS, type ScriptWindows } from "./windows-script";
import {
    leggiBusta, parseDischiWindows, parseHyperv, parseIdentitaWindows, parseReteWindows, parseServiziWindows, parseSicurezzaWindows, parseSoftwareWindows,
} from "./windows-parsers";

/** Il dato di uno script con lo stato della sezione: errore del trasporto, busta ignota (partial), non supportato, ok. */
function dalloScript<T>(r: ReadResult<string>, id: ScriptWindows, parse: (d: unknown) => T | null, vuoto: T): Sezione<T> {
    const fonte = ["winrm:" + id];
    if (r.status !== "ok") return sez(vuoto, r.status === "partial" ? "partial" : r.status, fonte, r.warnings);
    const b = leggiBusta(r.data);
    if (!b) return sez(vuoto, "partial", fonte, ["FORMAT_UNRECOGNIZED_OR_EMPTY"]);
    if (!b.ok) return sez(vuoto, b.code === "UNSUPPORTED" ? "unsupported" : "error", fonte, [b.code]);
    const v = parse(b.data);
    return v === null ? sez(vuoto, "partial", fonte, ["FORMAT_UNRECOGNIZED_OR_EMPTY"]) : sez(v, "ok", fonte);
}

export async function collectWindows(request: AcquisitionRequest, transports?: AcquisitionTransports): Promise<AcquisitionSnapshot> {
    const input = acquisitionInputSchema.parse(request);
    if (input.collector !== "windows") throw Error("COLLECTOR_MISMATCH");
    const inizio = Date.now(), io = transports ?? createTransports(input);
    const winrm = io.winrm;
    const letture: Record<string, ReadResult<string>> = winrm
        ? await leggiTutto(ids => winrm(ids), ID_SCRIPT_WINDOWS, "WINRM_TRANSPORT_EXCEPTION")
        : Object.fromEntries(ID_SCRIPT_WINDOWS.map(id => [id, { status: "error" as const, data: "", warnings: ["NO_WINRM_TRANSPORT"] }]));
    const r = (id: ScriptWindows) => letture[id] ?? nonLetto();

    const id = dalloScript(r("identita"), "identita", parseIdentitaWindows, null);
    const i = id.data;
    const snapshot: AcquisitionSnapshot = {
        schema_version: "1.0", collector: "windows", collector_version: versioneCollector("windows"), target: input.host,
        collected_at: new Date(inizio).toISOString(), duration_ms: 0, status: "error",
        identity: sez(i ? { manufacturer: i.manufacturer, model: i.model, firmware: i.os_caption && i.os_build ? `${i.os_caption} (build ${i.os_build})` : i.os_caption, serial_number: i.serial, hostname: i.hostname, mac: null, sys_object_id: null, uptime_seconds: null, boot_rom: i.bios } : null,
            i ? (i.model && i.os_caption ? "ok" : "partial") : id.status === "ok" ? "error" : id.status, id.sources, i ? id.warnings : [...id.warnings, "DEVICE_NOT_IDENTIFIED_AS_WINDOWS"]),
        interfaces: sez([]), network: sez({ ipv4_addresses: [], arp: [] }),
        ...sezioniDaSwitchNonApplicabili(),
    };
    if (!i) {
        // Senza identità (trasporto o autenticazione falliti, o non Windows) non si dichiara letto nient'altro.
        snapshot.interfaces = sez([], "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_WINDOWS"]);
        snapshot.network = sez({ ipv4_addresses: [], arp: [] }, "skipped", [], ["DEVICE_NOT_IDENTIFIED_AS_WINDOWS"]);
        snapshot.status = "error";
        return chiudi(snapshot, input, inizio);
    }
    snapshot.system = sez({ os_name: i.os_caption, os_version: i.os_version, os_build: i.os_build, kernel: null, architecture: i.architecture, timezone: i.timezone, boot_time: i.boot_time, uptime_seconds: null, ntp: { enabled: null, synchronized: null, servers: [] }, mandatory_access_control: { selinux: null, apparmor: null } },
        "ok", id.sources, ["NTP_NOT_COLLECTED"]);
    snapshot.resources = sez({ cpu_percent: null, memory_total_bytes: i.memory_total_bytes === null ? null : Number(i.memory_total_bytes), memory_free_bytes: i.memory_free_bytes === null ? null : Number(i.memory_free_bytes) },
        i.memory_total_bytes ? "ok" : "partial", id.sources, ["CPU_NOT_COLLECTED"]);

    const rete = dalloScript(r("rete"), "rete", parseReteWindows, { interfacce: [], indirizzi: [] });
    snapshot.interfaces = sez(rete.data.interfacce, rete.status === "ok" && rete.data.interfacce.length === 0 ? "partial" : rete.status, rete.sources, [...rete.warnings, "DUPLEX_NOT_COLLECTED"]);
    snapshot.network = sez({ ipv4_addresses: rete.data.indirizzi, arp: [] }, rete.status, rete.sources, [...rete.warnings, "ARP_NOT_COLLECTED"]);

    const dischi = dalloScript(r("dischi"), "dischi", parseDischiWindows, { disks: [], filesystems: [] });
    snapshot.host_storage = sez({ disks: dischi.data.disks, physical_volumes: [], volume_groups: [], logical_volumes: [], filesystems: dischi.data.filesystems }, dischi.status, dischi.sources, dischi.warnings);

    // Software dal registro più i ruoli installati (se è un Server): una lista, con la fonte per riga.
    const sw = dalloScript(r("software"), "software", d => parseSoftwareWindows(d, "registry"), []);
    const ruoli = dalloScript(r("ruoli"), "ruoli", d => parseSoftwareWindows(d, "windows-feature"), []);
    const statoSw: StatoSezione = sw.status === "ok" && (ruoli.status === "ok" || ruoli.status === "unsupported") ? "ok" : sw.status === "ok" || sw.status === "partial" ? "partial" : sw.status;
    snapshot.software = sez([...sw.data, ...ruoli.data], statoSw, [...sw.sources, ...ruoli.sources], [...sw.warnings, ...ruoli.warnings.map(w => "ROLES_" + w)]);

    snapshot.services = dalloScript(r("servizi"), "servizi", d => parseServiziWindows(d), []);
    snapshot.security = dalloScript(r("sicurezza"), "sicurezza", parseSicurezzaWindows, { antivirus: [], firewall_profiles: [] });
    snapshot.guests = dalloScript(r("hyperv"), "hyperv", d => parseHyperv(d), []);

    snapshot.status = statoGlobale([snapshot.identity, snapshot.system, snapshot.interfaces, snapshot.network, snapshot.host_storage, snapshot.software, snapshot.services, snapshot.security, snapshot.guests]);
    return chiudi(snapshot, input, inizio);
}

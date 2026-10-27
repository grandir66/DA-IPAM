/**
 * Parser puri del collector `windows`: la busta JSON degli script (`windows-script.ts`) e i suoi campi, letti per nome.
 * PowerShell 5.1 a volte avvolge gli array in `{ "value": [...], "Count": n }` e scrive un oggetto solo invece di un
 * array di uno: `lista` accetta le tre forme. Nessuna rete.
 */
import type { DeviceInterface } from "./schema";

export type Busta = { ok: true; data: unknown } | { ok: false; code: string };

/** La busta di uno script; null = non è la busta attesa (formato ignoto). JSON.parse sempre in try-catch. */
export function leggiBusta(testo: string): Busta | null {
    let v: unknown;
    try { v = JSON.parse(testo.trim()); } catch { return null; }
    if (!v || typeof v !== "object") return null;
    const o = v as Record<string, unknown>;
    if (o.ok === true && "data" in o) return { ok: true, data: o.data };
    if (o.ok === false && typeof o.code === "string" && /^[A-Z_]+$/.test(o.code)) return { ok: false, code: o.code };
    return null;
}

export function lista(v: unknown): Record<string, unknown>[] {
    if (v === null || v === undefined) return [];
    if (Array.isArray(v)) return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    if (typeof v === "object" && Array.isArray((v as { value?: unknown }).value)) return lista((v as { value: unknown }).value);
    return typeof v === "object" ? [v as Record<string, unknown>] : [];
}

export const testo = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : typeof v === "number" ? String(v) : null);
const cifre = (v: unknown): string | null => { const t = testo(v); return t && /^\d+$/.test(t) ? t : null; };
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
const vero = (v: unknown): boolean | null => (v === true || v === "True" || v === "true" ? true : v === false || v === "False" || v === "false" ? false : null);

export interface IdentitaWindows {
    manufacturer: string | null; model: string | null; hostname: string | null; domain: string | null; serial: string | null; bios: string | null;
    os_caption: string | null; os_version: string | null; os_build: string | null; architecture: string | null; boot_time: string | null; timezone: string | null;
    memory_total_bytes: string | null; memory_free_bytes: string | null;
}

export function parseIdentitaWindows(d: unknown): IdentitaWindows | null {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const o = d as Record<string, unknown>;
    const r: IdentitaWindows = {
        manufacturer: testo(o.manufacturer), model: testo(o.model), hostname: testo(o.hostname), domain: testo(o.domain), serial: testo(o.serial), bios: testo(o.bios),
        os_caption: testo(o.os_caption), os_version: testo(o.os_version), os_build: testo(o.os_build), architecture: testo(o.architecture),
        boot_time: testo(o.boot_time), timezone: testo(o.timezone), memory_total_bytes: cifre(o.memory_total_bytes), memory_free_bytes: cifre(o.memory_free_bytes),
    };
    return r.os_caption || r.hostname ? r : null;
}

/** Adattatori e indirizzi IPv4. Velocità in bit/s (`Speed`), stato da `Status` (Up, Disconnected, Disabled...). */
export function parseReteWindows(d: unknown): { interfacce: DeviceInterface[]; indirizzi: Array<{ address: string; netmask: string | null; if_index: number | null }> } | null {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const o = d as Record<string, unknown>;
    const interfacce: DeviceInterface[] = lista(o.adapters).filter(a => testo(a.name)).map(a => {
        const stato = (testo(a.status) ?? "").toLowerCase();
        const vel = numero(a.speed_bps);
        const mac = testo(a.mac);
        return {
            name: testo(a.name)!, if_index: numero(a.if_index), description: testo(a.description), kind: vero(a.virtual) ? "other" : "physical",
            admin_status: stato === "disabled" ? "down" : stato ? "up" : null, oper_status: stato === "up" ? "up" : stato === "disconnected" || stato === "disabled" ? "down" : null,
            speed_bps: stato === "up" ? vel : null, reported_speed_bps: vel, duplex: null, mtu: numero(a.mtu),
            mac: mac ? mac.replace(/-/g, ":").toLowerCase() : null, counters: {}, pvid: null,
        };
    });
    const indirizzi = lista(o.addresses).filter(a => /^\d{1,3}(\.\d{1,3}){3}$/.test(testo(a.address) ?? "")).map(a => {
        const bits = numero(a.prefix_length);
        const maschera = bits === null || bits > 32 ? null : bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
        return { address: testo(a.address)!, netmask: maschera === null ? null : [24, 16, 8, 0].map(x => (maschera >>> x) & 255).join("."), if_index: numero(a.if_index) };
    });
    return { interfacce, indirizzi };
}

export function parseDischiWindows(d: unknown): { disks: Array<{ name: string; model: string | null; serial_number: string | null; size_bytes: string | null; rotational: boolean | null; transport: string | null }>; filesystems: Array<{ device: string | null; mount_point: string; type: string | null; size_bytes: string | null; used_bytes: string | null; available_bytes: string | null; inodes_total: null; inodes_used: null; inodes_free: null }> } | null {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const o = d as Record<string, unknown>;
    return {
        disks: lista(o.disks).filter(x => testo(x.name)).map(x => ({ name: testo(x.name)!, model: testo(x.model), serial_number: testo(x.serial), size_bytes: cifre(x.size_bytes), rotational: null, transport: testo(x.interface) })),
        filesystems: lista(o.volumes).filter(x => testo(x.device)).map(x => {
            const tot = cifre(x.size_bytes), lib = cifre(x.free_bytes);
            return { device: testo(x.device), mount_point: testo(x.device)!, type: testo(x.file_system), size_bytes: tot, used_bytes: tot && lib && BigInt(tot) >= BigInt(lib) ? (BigInt(tot) - BigInt(lib)).toString() : null, available_bytes: lib, inodes_total: null, inodes_used: null, inodes_free: null };
        }),
    };
}

export function parseSoftwareWindows(d: unknown, fonte: string): Array<{ name: string; version: string | null; publisher: string | null; install_date: string | null; source: string }> {
    return lista(d).filter(x => testo(x.name)).map(x => ({ name: testo(x.name)!, version: testo(x.version), publisher: testo(x.publisher), install_date: testo(x.install_date), source: fonte }));
}

const STATI_SERVIZIO: Record<string, "running" | "stopped"> = { running: "running", stopped: "stopped" };
const AVVII: Record<string, "auto" | "manual" | "disabled"> = { auto: "auto", manual: "manual", disabled: "disabled" };

export function parseServiziWindows(d: unknown): Array<{ name: string; display_name: string | null; state: "running" | "stopped" | "other" | null; start_mode: "auto" | "manual" | "disabled" | "other" | null; account: string | null }> {
    return lista(d).filter(x => testo(x.name)).map(x => {
        const st = (testo(x.state) ?? "").toLowerCase(), av = (testo(x.start_mode) ?? "").toLowerCase();
        return { name: testo(x.name)!, display_name: testo(x.display_name), state: st ? STATI_SERVIZIO[st] ?? "other" : null, start_mode: av ? AVVII[av] ?? "other" : null, account: testo(x.account) };
    });
}

/** Defender e profili firewall come li dicono i cmdlet, per nome; nessun riassunto («protetto sì/no»). */
export function parseSicurezzaWindows(d: unknown): { antivirus: Array<{ product: string; enabled: boolean | null; real_time_protection: boolean | null; signatures_up_to_date: null }>; firewall_profiles: Array<{ name: string; enabled: boolean | null; default_inbound: string | null; default_outbound: string | null }> } | null {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const o = d as Record<string, unknown>;
    const def = o.defender && typeof o.defender === "object" ? (o.defender as Record<string, unknown>) : null;
    return {
        antivirus: def ? [{ product: "Microsoft Defender Antivirus", enabled: vero(def.enabled), real_time_protection: vero(def.real_time), signatures_up_to_date: null }] : [],
        firewall_profiles: lista(o.firewall).filter(x => testo(x.name)).map(x => ({ name: testo(x.name)!, enabled: vero(x.enabled), default_inbound: testo(x.inbound), default_outbound: testo(x.outbound) })),
    };
}

/** `EnabledState` di `Msvm_ComputerSystem` (CIM): 2 acceso, 3 spento, 32768 in pausa, 32769 salvato; il resto «other». */
const STATI_VM: Record<number, "running" | "off" | "paused" | "saved"> = { 2: "running", 3: "off", 32768: "paused", 32769: "saved" };

export function parseHyperv(d: unknown): Array<{ id: string; name: string | null; power_state: "running" | "off" | "paused" | "saved" | "other" | null; platform: string }> {
    return lista(d).filter(x => /^[0-9A-Fa-f-]{36}$/.test(testo(x.id) ?? "")).map(x => {
        const e = numero(x.enabled_state);
        return { id: testo(x.id)!.toLowerCase(), name: testo(x.name), power_state: e === null ? null : STATI_VM[e] ?? "other", platform: "hyper-v" };
    });
}

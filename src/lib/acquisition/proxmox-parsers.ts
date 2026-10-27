/**
 * Parser puri del collector `proxmox-ve` per la parità con la scansione Proxmox di oggi (`proxmox/run-proxmox-device-scan.ts`):
 * VM e container con stato e risorse, storage, nodi, e la configurazione di ogni guest (dischi, reti). Solo i campi che servono
 * escono dal JSON di `pvesh`: il resto (token, ticket, ...) non passa mai.
 */
import type { z } from "zod";
import type { guestsSchema, storagePoolsSchema, clusterNodesSchema } from "./sistema-schema";

export type Guest = z.infer<typeof guestsSchema>[number];
export type StoragePool = z.infer<typeof storagePoolsSchema>[number];
export type ClusterNode = z.infer<typeof clusterNodesSchema>[number];

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
/** Capacità come stringa decimale intera (oltre 2^53 resta esatta), null se assente o negativa. */
const bytes = (v: unknown): string | null => { const n = num(v); return n !== null && n >= 0 ? String(Math.trunc(n)) : null; };

const STATI = new Set(["running", "paused"]);
const statoGuest = (v: unknown): Guest["power_state"] => (v === "running" ? "running" : v === "stopped" ? "off" : STATI.has(String(v)) ? "paused" : "other");

/** `pvesh get /cluster/resources --output-format json`: null se non è l'array atteso. */
export function parseRisorseCluster(testo: string): { guests: Guest[]; pools: StoragePool[]; nodes: ClusterNode[] } | null {
    let json: unknown;
    try { json = JSON.parse(testo); } catch { return null; }
    if (!Array.isArray(json)) return null;
    const out = { guests: [] as Guest[], pools: [] as StoragePool[], nodes: [] as ClusterNode[] };
    for (const r of json) {
        if (!r || typeof r !== "object") continue;
        const o = r as Record<string, unknown>;
        if (o.type === "qemu" || o.type === "lxc") {
            const vmid = num(o.vmid);
            out.guests.push({
                id: str(o.id) ?? `${o.type}/${vmid ?? "?"}`, name: str(o.name), power_state: statoGuest(o.status), platform: String(o.type),
                node: str(o.node), vmid, cpu_count: num(o.maxcpu), memory_bytes: bytes(o.maxmem), disk_bytes: bytes(o.maxdisk), uptime_seconds: num(o.uptime),
                disks: [], networks: [], bios: null, machine: null, agent: null,
            });
        }
        else if (o.type === "storage") {
            const nome = str(o.storage);
            if (!nome) continue;
            const totale = bytes(o.maxdisk), usato = bytes(o.disk);
            out.pools.push({
                name: nome, node: str(o.node), type: str(o.plugintype), status: str(o.status),
                total_bytes: totale, used_bytes: usato, available_bytes: totale !== null && usato !== null ? String(Math.max(0, Number(totale) - Number(usato))) : null,
                content: (str(o.content) ?? "").split(",").filter(Boolean), shared: o.shared === 1 ? true : o.shared === 0 ? false : null,
            });
        }
        else if (o.type === "node") {
            const nome = str(o.node);
            if (!nome) continue;
            out.nodes.push({ name: nome, status: str(o.status), uptime_seconds: num(o.uptime), cpu_count: num(o.maxcpu), cpu_fraction: num(o.cpu), memory_total_bytes: bytes(o.maxmem), memory_used_bytes: bytes(o.mem) });
        }
    }
    return out;
}

const VOLUME = /^(?:scsi|sata|ide|virtio|efidisk|tpmstate|rootfs|mp)\d*$/;
/** Dischi e reti da una riga di configurazione: `scsi0: local-lvm:vm-100-disk-0,size=32G`, `net0: virtio=02:00:...,bridge=vmbr0,tag=10`. */
function vociDiConfigurazione(righe: ReadonlyMap<string, string>, lxc: boolean): Pick<Guest, "disks" | "networks"> {
    const disks: NonNullable<Guest["disks"]> = [], networks: NonNullable<Guest["networks"]> = [];
    for (const [chiave, valore] of righe) {
        const parti = valore.split(",");
        const campo = (k: string) => parti.slice(1).find(p => p.startsWith(k + "="))?.slice(k.length + 1) ?? null;
        if (VOLUME.test(chiave) && !/media=cdrom/.test(valore)) {
            const primo = parti[0] ?? "";
            disks.push({ id: chiave, storage: primo.includes(":") ? primo.split(":")[0] : null, size: campo("size") });
        }
        else if (/^net\d+$/.test(chiave)) {
            const primo = parti[0] ?? "";
            const [m, v] = primo.includes("=") && !lxc ? primo.split("=", 2) : [null, null];
            networks.push({ id: chiave, model: m, mac: lxc ? (campo("hwaddr") ?? null) : v, bridge: campo("bridge"), vlan: campo("tag"), ip: lxc ? campo("ip") : null });
        }
    }
    return { disks, networks };
}

/**
 * Configurazioni dei guest da `grep -H ""` sui file `.conf` di qemu-server (o lxc) sotto /etc/pve/nodes: ogni riga è `percorso:chiave: valore`, il
 * nome del nodo e l'id della VM stanno nel percorso. La lettura si ferma alla prima intestazione `[snapshot]` di ogni file
 * (sotto ci sono le configurazioni vecchie). Chiave `node/vmid`.
 */
export function parseConfigurazioniGuest(testo: string, lxc: boolean): Map<string, Partial<Guest>> {
    const perFile = new Map<string, Map<string, string>>();
    const chiusi = new Set<string>();
    for (const riga of testo.split(/\r?\n/)) {
        const m = /^\/etc\/pve\/nodes\/([^/]+)\/(?:qemu-server|lxc)\/(\d+)\.conf:(.*)$/.exec(riga);
        if (!m) continue;
        const file = `${m[1]}/${m[2]}`, contenuto = m[3];
        if (chiusi.has(file)) continue;
        if (contenuto.startsWith("[")) { chiusi.add(file); continue; }
        const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(contenuto);
        if (!kv) continue;
        const righe = perFile.get(file) ?? new Map<string, string>();
        righe.set(kv[1], kv[2]);
        perFile.set(file, righe);
    }
    const out = new Map<string, Partial<Guest>>();
    for (const [file, righe] of perFile) {
        const { disks, networks } = vociDiConfigurazione(righe, lxc);
        out.set(file, { disks, networks, bios: righe.get("bios") ?? null, machine: righe.get("machine") ?? null, agent: lxc ? null : (righe.get("agent") ? "1" : "0") });
    }
    return out;
}

const NOME_NODO = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
/** Comandi per nodo e per VM: fissi nella forma, con solo nome nodo e id numerico validati. Mai testo libero. */
export const cmdStatoNodo = (nodo: string) => `pvesh get /nodes/${nodo}/status --output-format json`;
export const cmdAbbonamentoNodo = (nodo: string) => `pvesh get /nodes/${nodo}/subscription --output-format json`;
export const cmdReportNodo = (nodo: string) => `pvesh get /nodes/${nodo}/report`;
export const cmdAgentVm = (nodo: string, vmid: number) => `pvesh get /nodes/${nodo}/qemu/${vmid}/agent/network-get-interfaces --output-format json`;
export const nomeNodoValido = (nodo: string) => NOME_NODO.test(nodo);
/** Modelli accettati dall'allowlist oltre ai comandi fissi (stessa forma dei quattro comandi sopra). */
export const MODELLI_COMANDI_PROXMOX: readonly RegExp[] = [
    /^pvesh get \/nodes\/[A-Za-z0-9][A-Za-z0-9-]*\/(?:status|subscription) --output-format json$/,
    /^pvesh get \/nodes\/[A-Za-z0-9][A-Za-z0-9-]*\/report$/,
    /^pvesh get \/nodes\/[A-Za-z0-9][A-Za-z0-9-]*\/qemu\/\d+\/agent\/network-get-interfaces --output-format json$/,
];

type DatiNodo = Partial<Pick<ClusterNode, "cpu_model" | "cpu_mhz" | "cpu_sockets" | "cpu_cores" | "kernel_version" | "rootfs_total_bytes" | "rootfs_used_bytes">>;
/** `pvesh get /nodes/<nodo>/status`: CPU, kernel e disco root. `null` se non è un oggetto JSON. */
export function parseStatoNodo(testo: string): DatiNodo | null {
    let json: unknown;
    try { json = JSON.parse(testo); } catch { return null; }
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const o = json as Record<string, unknown>;
    const cpu = (o.cpuinfo && typeof o.cpuinfo === "object" ? o.cpuinfo : {}) as Record<string, unknown>;
    const root = (o.rootfs && typeof o.rootfs === "object" ? o.rootfs : {}) as Record<string, unknown>;
    const kernel = str(o["current-kernel"] && typeof o["current-kernel"] === "object" ? (o["current-kernel"] as Record<string, unknown>).release : null) ?? str(o.kversion);
    return {
        cpu_model: str(cpu.model), cpu_mhz: num(cpu.mhz), cpu_sockets: num(cpu.sockets), cpu_cores: num(cpu.cores),
        kernel_version: kernel, rootfs_total_bytes: bytes(root.total), rootfs_used_bytes: bytes(root.used),
    };
}

/** `pvesh get /nodes/<nodo>/subscription`: stato e livello; la chiave dell'abbonamento non esce mai. */
export function parseAbbonamentoNodo(testo: string): Pick<ClusterNode, "subscription_status" | "subscription_level"> | null {
    let json: unknown;
    try { json = JSON.parse(testo); } catch { return null; }
    if (!json || typeof json !== "object" || Array.isArray(json)) return null;
    const o = json as Record<string, unknown>;
    return { subscription_status: str(o.status), subscription_level: str(o.level) };
}

/** Rapporto del nodo (`pvesh get /nodes/<nodo>/report`): seriale, produttore e modello come li cerca la scansione di oggi. */
export function parseReportNodo(testo: string): Pick<ClusterNode, "hardware_serial" | "hardware_manufacturer" | "hardware_model"> | null {
    const campo = (...re: RegExp[]) => { for (const r of re) { const m = r.exec(testo); if (m && m[1].trim()) return m[1].trim(); } return null; };
    const out = {
        hardware_serial: campo(/Serial Number[:\s]+([^\n\r]+)/i),
        hardware_model: campo(/Product Name[:\s]+([^\n\r]+)/i),
        hardware_manufacturer: campo(/Manufacturer[:\s]+([^\n\r]+)/i, /Vendor[:\s]+([^\n\r]+)/i),
    };
    return out.hardware_serial || out.hardware_model || out.hardware_manufacturer ? out : null;
}

/** Indirizzi IP dell'agent QEMU, come li filtra la scansione di oggi (niente loopback, link-local). `null` se la forma non è riconosciuta. */
export function parseIpAgent(testo: string): string[] | null {
    let json: unknown;
    try { json = JSON.parse(testo); } catch { return null; }
    const elenco = Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as Record<string, unknown>).result) ? (json as { result: unknown[] }).result : null;
    if (!elenco) return null;
    const ips: string[] = [];
    for (const i of elenco) {
        if (!i || typeof i !== "object") continue;
        const o = i as Record<string, unknown>;
        const nome = String(o.name ?? "").toLowerCase();
        if (nome === "lo" || nome === "loopback") continue;
        const lista = o["ip-addresses"];
        if (!Array.isArray(lista)) continue;
        for (const x of lista) {
            const ip = x && typeof x === "object" ? String((x as Record<string, unknown>)["ip-address"] ?? "").trim() : "";
            if (ip && !ip.startsWith("127.") && !ip.startsWith("::1") && !ip.startsWith("fe80:") && !ip.startsWith("169.254.")) ips.push(ip);
        }
    }
    return [...new Set(ips)];
}

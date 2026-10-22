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

/**
 * Proiezione dello snapshot `proxmox-ve` verso l'inventario, come la scansione Proxmox di oggi
 * (`proxmox/run-proxmox-device-scan.ts`): stesso contenuto di `last_proxmox_scan_result` (nodi e VM), da cui
 * `syncInventoryFromDevice` e la topologia (VM come host collegati all'hypervisor) leggono. Funzione pura.
 *
 * Campo assente nello snapshot = resta quello della scansione di prima. Non si ricavano dallo snapshot (restano come
 * erano, o vuoti la prima volta): schede di rete dei nodi (la scansione ne legge la configurazione) e la divisione di
 * `cpu_count` di una VM in socket e core (qui `cores = cpu_count`, `sockets = 1`).
 */
import type { ProxmoxDeviceScanResult } from "@/lib/proxmox/run-proxmox-device-scan";
import type { ProxmoxHostInfo, ProxmoxStorageInfo, ProxmoxVM } from "@/lib/proxmox/proxmox-client";
import type { AcquisitionSnapshot } from "../schema";

const GIB = 1024 ** 3;
const gib = (bytes: string | null | undefined): number | null => (bytes == null ? null : Math.round((Number(bytes) / GIB) * 100) / 100);
const usabile = (s: { status: string } | undefined): boolean => s?.status === "ok" || s?.status === "partial";
const prova = (testo: string | null | undefined): ProxmoxDeviceScanResult | null => {
    if (!testo) return null;
    try {
        const j = JSON.parse(testo) as ProxmoxDeviceScanResult;
        return j && Array.isArray(j.hosts) && Array.isArray(j.vms) ? j : null;
    } catch { return null; }
};

function durata(secondi: number | null): string | null {
    if (secondi === null) return null;
    const g = Math.floor(secondi / 86400), o = Math.floor((secondi % 86400) / 3600), m = Math.floor((secondi % 3600) / 60);
    return [g && `${g}d`, o && `${o}h`, m && `${m}m`].filter(Boolean).join(" ") || "0m";
}

/** `null` se lo snapshot non è di Proxmox o i nodi non si sono letti: l'inventario resta com'è. */
export function proiettaProxmox(snapshot: AcquisitionSnapshot, risultatoPrecedente: string | null): ProxmoxDeviceScanResult | null {
    if (snapshot.collector !== "proxmox-ve" || !usabile(snapshot.cluster_nodes) || !snapshot.cluster_nodes) return null;
    const prima = prova(risultatoPrecedente);
    const nomeIdentita = snapshot.identity.data?.hostname ?? null;
    const versione = /pve-manager\/([^\s/]+)/.exec(snapshot.identity.data?.firmware ?? "")?.[1] ?? null;
    const pool = snapshot.storage_pools?.data ?? [];

    const hosts: ProxmoxHostInfo[] = snapshot.cluster_nodes.data.map((n) => {
        const p = prima?.hosts.find((h) => h.hostname === n.name);
        const storage: ProxmoxStorageInfo[] = usabile(snapshot.storage_pools)
            ? pool.filter((x) => x.node === n.name).map((x) => ({
                name: x.name, type: x.type ?? "", status: x.status ?? "", total_gb: gib(x.total_bytes), used_gb: gib(x.used_bytes), available_gb: gib(x.available_bytes), content: x.content.join(","),
            }))
            : (p?.storage ?? []);
        const totale = gib(n.memory_total_bytes), usata = gib(n.memory_used_bytes);
        return {
            hostname: n.name, status: n.status ?? p?.status ?? "unknown", uptime_seconds: n.uptime_seconds, uptime_human: durata(n.uptime_seconds),
            cpu_model: n.cpu_model ?? p?.cpu_model ?? null, cpu_mhz: n.cpu_mhz ?? p?.cpu_mhz ?? null,
            cpu_sockets: n.cpu_sockets ?? p?.cpu_sockets ?? null, cpu_cores: n.cpu_cores ?? p?.cpu_cores ?? null, cpu_total_cores: n.cpu_count ?? p?.cpu_total_cores ?? null,
            memory_total_gb: totale, memory_used_gb: usata, memory_free_gb: totale !== null && usata !== null ? Math.round((totale - usata) * 100) / 100 : null,
            memory_usage_percent: totale && usata !== null ? Math.round((usata / totale) * 1000) / 10 : null,
            proxmox_version: (n.name === nomeIdentita ? versione : null) ?? p?.proxmox_version ?? null,
            kernel_version: n.kernel_version ?? p?.kernel_version ?? null,
            rootfs_total_gb: n.rootfs_total_bytes !== undefined ? gib(n.rootfs_total_bytes) : (p?.rootfs_total_gb ?? null),
            rootfs_used_gb: n.rootfs_used_bytes !== undefined ? gib(n.rootfs_used_bytes) : (p?.rootfs_used_gb ?? null),
            storage, network_interfaces: p?.network_interfaces ?? [],
            subscription: n.subscription_status !== undefined
                ? { status: n.subscription_status ?? "unknown", productname: null, regdate: null, nextduedate: null, level: n.subscription_level ?? null, key: null, serverid: null, sockets: null, checktime: null }
                : (p?.subscription ?? null),
            hardware_serial: n.hardware_serial ?? p?.hardware_serial ?? null, hardware_model: n.hardware_model ?? p?.hardware_model ?? null,
            hardware_manufacturer: n.hardware_manufacturer ?? p?.hardware_manufacturer ?? null,
            ...(p?.live_read_at ? { live_read_at: p.live_read_at } : {}),
        };
    });

    // Se i guest non si sono letti restano quelli della scansione di prima: una lettura mancata non svuota la mappa.
    const vms: ProxmoxVM[] = usabile(snapshot.guests) && snapshot.guests
        ? snapshot.guests.data.filter((g) => g.vmid != null && g.node && (g.platform === "qemu" || g.platform === "lxc")).map((g) => {
            const p = prima?.vms.find((v) => v.node === g.node && v.vmid === g.vmid);
            const cpu = g.cpu_count ?? 0, mem = g.memory_bytes ? Number(g.memory_bytes) : 0, disco = g.disk_bytes ? Number(g.disk_bytes) : 0;
            const vm: ProxmoxVM = {
                node: g.node as string, vmid: g.vmid as number, name: g.name ?? `${g.platform}-${g.vmid}`,
                status: g.power_state === "off" ? "stopped" : (g.power_state ?? "unknown"), type: g.platform as "qemu" | "lxc",
                maxcpu: cpu, cores: cpu, sockets: 1, maxmem: mem, memory_mb: Math.round(mem / 1048576), maxdisk: disco, disk_gb: Math.round((disco / GIB) * 100) / 100,
                ip_addresses: g.ip_addresses ?? p?.ip_addresses ?? [],
                disks_details: (g.disks ?? []).map((d) => ({ id: d.id, storage: d.storage ?? "", ...(d.size ? { size: d.size } : {}) })),
                networks_details: (g.networks ?? []).map((r) => ({ id: r.id, ...(r.model ? { model: r.model } : {}), ...(r.mac ? { mac: r.mac } : {}), ...(r.bridge ? { bridge: r.bridge } : {}), ...(r.vlan ? { vlan: r.vlan } : {}) })),
            };
            if (g.bios) vm.bios = g.bios;
            if (g.machine) vm.machine = g.machine;
            if (g.agent) vm.agent = g.agent;
            return vm;
        })
        : (prima?.vms ?? []);

    return { hosts, vms, scanned_at: snapshot.collected_at, ...(prima?.avvisi?.length ? { avvisi: prima.avvisi } : {}) };
}

import type { ProxmoxHostInfo, ProxmoxVM } from "./proxmox-client";

function vmKey(v: ProxmoxVM): string {
  return `${v.node}:${v.vmid}:${v.type}`;
}

function vmScore(v: ProxmoxVM): number {
  return (
    v.ip_addresses.length * 20 +
    v.disks_details.length * 5 +
    v.networks_details.length * 3 +
    (v.maxdisk > 0 ? 2 : 0)
  );
}

function mergeVm(a: ProxmoxVM, b: ProxmoxVM): ProxmoxVM {
  const primary = vmScore(a) >= vmScore(b) ? a : b;
  const secondary = vmScore(a) >= vmScore(b) ? b : a;
  return {
    ...primary,
    ip_addresses: [...new Set([...primary.ip_addresses, ...secondary.ip_addresses])],
    disks_details:
      primary.disks_details.length >= secondary.disks_details.length
        ? primary.disks_details
        : secondary.disks_details,
    networks_details:
      primary.networks_details.length >= secondary.networks_details.length
        ? primary.networks_details
        : secondary.networks_details,
  };
}

function hostScore(h: ProxmoxHostInfo): number {
  return (
    h.storage.length * 5 +
    h.network_interfaces.length * 3 +
    (h.cpu_model ? 10 : 0) +
    (h.proxmox_version ? 5 : 0) +
    (h.memory_total_gb != null ? 2 : 0)
  );
}

function mergeHost(a: ProxmoxHostInfo, b: ProxmoxHostInfo): ProxmoxHostInfo {
  const primary = hostScore(a) >= hostScore(b) ? a : b;
  const secondary = hostScore(a) >= hostScore(b) ? b : a;
  return {
    ...primary,
    storage:
      primary.storage.length >= secondary.storage.length ? primary.storage : secondary.storage,
    network_interfaces:
      primary.network_interfaces.length >= secondary.network_interfaces.length
        ? primary.network_interfaces
        : secondary.network_interfaces,
  };
}

function mergePair(
  a: { hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] },
  b: { hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] }
): { hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] } {
  const hMap = new Map<string, ProxmoxHostInfo>();
  for (const h of a.hosts) hMap.set(h.hostname, h);
  for (const h of b.hosts) {
    const k = h.hostname;
    const ex = hMap.get(k);
    hMap.set(k, ex ? mergeHost(ex, h) : h);
  }
  const vMap = new Map<string, ProxmoxVM>();
  for (const v of a.vms) vMap.set(vmKey(v), v);
  for (const v of b.vms) {
    const k = vmKey(v);
    const ex = vMap.get(k);
    vMap.set(k, ex ? mergeVm(ex, v) : v);
  }
  return { hosts: [...hMap.values()], vms: [...vMap.values()] };
}

/** Unisce più estrazioni (API multi-nodo + SSH, cluster duplicato, ecc.). */
export function mergeProxmoxExtractResults(
  parts: { hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] }[]
): { hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] } {
  if (parts.length === 0) return { hosts: [], vms: [] };
  let acc = parts[0]!;
  for (let i = 1; i < parts.length; i++) {
    acc = mergePair(acc, parts[i]!);
  }
  return acc;
}

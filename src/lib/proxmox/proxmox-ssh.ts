/**
 * Estrazione dati Proxmox via SSH (pvesh).
 * Alternativa all'API: evita problemi SSL/TLS, usa porta 22 standard.
 */

import { sshExec } from "@/lib/devices/ssh-helper";
import type { ProxmoxHostInfo, ProxmoxVM } from "./proxmox-client";

function bytesToGib(value: number): number {
  return value / (1024 ** 3);
}

function secondsToHuman(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(" ");
}

export interface ProxmoxSshConfig {
  host: string;
  port?: number;
  username: string;
  password: string;
}

/**
 * Estrae hosts e VM da Proxmox via SSH (comando pvesh).
 * Restituisce lo stesso formato di ProxmoxClient.extractAll().
 */
export async function extractProxmoxViaSsh(
  config: ProxmoxSshConfig,
  options?: { includeStopped?: boolean; includeContainers?: boolean }
): Promise<{ hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] }> {
  const host = config.host.replace(/^https?:\/\//i, "").split(":")[0];
  const port = config.port ?? 22;
  const opts = {
    host,
    port,
    username: config.username,
    password: config.password,
    timeout: 30000,
  };

  // pvesh get /cluster/resources --output-format json (JSON è default)
  const res = await sshExec(opts, "pvesh get /cluster/resources --output-format json 2>/dev/null || pvesh get /cluster/resources 2>/dev/null");
  if (res.code !== 0 || !res.stdout.trim()) {
    throw new Error("pvesh non disponibile o cluster non configurato. Verifica che Proxmox sia accessibile via SSH (porta 22).");
  }

  let resources: Array<Record<string, unknown>>;
  try {
    resources = JSON.parse(res.stdout) as Array<Record<string, unknown>>;
  } catch {
    throw new Error("Risposta pvesh non valida. Verifica che pvesh sia installato sul nodo Proxmox.");
  }

  const hosts: ProxmoxHostInfo[] = [];
  const vms: ProxmoxVM[] = [];
  const includeStopped = options?.includeStopped ?? false;
  const includeContainers = options?.includeContainers ?? true;

  for (const r of resources) {
    const type = (r.type ?? "") as string;
    const node = (r.node ?? r.name ?? "") as string;
    const status = (r.status ?? "unknown") as string;

    if (type === "node") {
      const memTotal = Number(r.maxmem ?? r.mem ?? 0);
      const memUsed = Number(r.mem ?? 0);
      const memUsagePct = memTotal ? Math.round((memUsed / memTotal) * 10000) / 100 : null;
      const uptime = Number(r.uptime ?? 0);
      const versionStr = (r.version ?? "") as string;
      const proxmoxVersion = (versionStr.match(/pve-manager\/([0-9A-Za-z.\-]+)/i)?.[1] ?? versionStr) || null;

      hosts.push({
        hostname: node,
        status,
        uptime_seconds: uptime || null,
        uptime_human: uptime ? secondsToHuman(uptime) : null,
        cpu_model: null,
        cpu_mhz: null,
        cpu_sockets: null,
        cpu_cores: null,
        cpu_total_cores: Number(r.maxcpu ?? 0) || null,
        memory_total_gb: memTotal ? bytesToGib(memTotal) : null,
        memory_used_gb: memUsed ? bytesToGib(memUsed) : null,
        memory_free_gb: memTotal && memUsed ? bytesToGib(memTotal - memUsed) : null,
        memory_usage_percent: memUsagePct,
        proxmox_version: proxmoxVersion,
        kernel_version: null,
        rootfs_total_gb: null,
        rootfs_used_gb: null,
        storage: [],
        network_interfaces: [],
        subscription: null,
        hardware_serial: null,
        hardware_model: null,
        hardware_manufacturer: null,
      });
    }

    if (type === "qemu" && (includeStopped || status === "running")) {
      const vmid = Number(r.vmid ?? 0);
      const name = (r.name ?? `VM-${vmid}`) as string;
      const maxcpu = Number(r.maxcpu ?? 0);
      const maxmem = Number(r.maxmem ?? 0);
      const maxdisk = Number(r.maxdisk ?? 0);
      const memMb = Number(r.mem ?? 0);

      vms.push({
        node,
        vmid,
        name,
        status,
        type: "qemu",
        maxcpu,
        cores: maxcpu || 1,
        sockets: 1,
        maxmem,
        memory_mb: memMb,
        maxdisk,
        disk_gb: maxdisk ? bytesToGib(maxdisk) : 0,
        ip_addresses: [],
        disks_details: [],
        networks_details: [],
      });
    }

    if (type === "lxc" && includeContainers && (includeStopped || status === "running")) {
      const vmid = Number(r.vmid ?? 0);
      const name = (r.name ?? `CT-${vmid}`) as string;
      const maxcpu = Number(r.maxcpu ?? 0);
      const maxmem = Number(r.maxmem ?? 0);
      const maxdisk = Number(r.maxdisk ?? 0);
      const memMb = Number(r.mem ?? 0);

      vms.push({
        node,
        vmid,
        name,
        status,
        type: "lxc",
        maxcpu,
        cores: maxcpu || 1,
        sockets: 1,
        maxmem,
        memory_mb: memMb,
        maxdisk,
        disk_gb: maxdisk ? bytesToGib(maxdisk) : 0,
        ip_addresses: [],
        disks_details: [],
        networks_details: [],
      });
    }
  }

  return { hosts, vms };
}

/**
 * Testa connessione SSH a Proxmox (esegue pveversion).
 */
export async function testProxmoxSsh(config: ProxmoxSshConfig): Promise<boolean> {
  const host = config.host.replace(/^https?:\/\//i, "").split(":")[0];
  const port = config.port ?? 22;
  const opts = {
    host,
    port,
    username: config.username,
    password: config.password,
    timeout: 15000,
  };
  try {
    const res = await sshExec(opts, "pveversion 2>/dev/null || pvesh get /version 2>/dev/null");
    return res.code === 0 && (res.stdout.includes("pve-manager") || res.stdout.includes("version"));
  } catch {
    return false;
  }
}

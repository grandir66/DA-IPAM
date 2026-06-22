import { getNetworkDeviceById, updateNetworkDevice, getDeviceCredentials, syncInventoryFromDevice } from "@/lib/db";
import { ProxmoxClient, resolveProxmoxApiPortOverride, type ProxmoxHostInfo, type ProxmoxVM } from "@/lib/proxmox/proxmox-client";
import { extractProxmoxViaSsh } from "@/lib/proxmox/proxmox-ssh";
import { mergeProxmoxExtractResults } from "@/lib/proxmox/proxmox-merge-results";
import {
  buildProxmoxApiUrlForIp,
  MAX_PROXMOX_SCAN_TARGETS,
  proxmoxSshUsername,
  resolveProxmoxTargetIps,
} from "@/lib/proxmox/proxmox-targets";
import { isProxmoxVeDevice } from "@/lib/devices/device-acquisition-resolve";

export interface ProxmoxDeviceScanResult {
  hosts: ProxmoxHostInfo[];
  vms: ProxmoxVM[];
  scanned_at: string;
  avvisi?: string[];
}

function assertProxmoxDevice(device: import("@/types").NetworkDevice): void {
  if (!isProxmoxVeDevice(device)) {
    throw new Error(
      "Questo dispositivo non è configurato come Proxmox VE. Imposta vendor Proxmox, tipologia proxmox_ve e tipo scansione Proxmox."
    );
  }
  if (!device.enabled) {
    throw new Error("Dispositivo disabilitato");
  }
}

/** Esegue scan Proxmox VE (API :8006 + SSH) e persiste il risultato su network_devices. */
export async function runProxmoxDeviceScan(deviceId: number): Promise<ProxmoxDeviceScanResult> {
  const device = getNetworkDeviceById(deviceId);
  if (!device) {
    throw new Error("Dispositivo non trovato");
  }

  assertProxmoxDevice(device);

  const creds = getDeviceCredentials(device);
  if (!creds) {
    throw new Error("Configura le credenziali (SSH o API) per questo dispositivo. Per Proxmox usa root e password.");
  }
  const { username, password } = creds;

  const targets = resolveProxmoxTargetIps(device);
  if (targets.length === 0) {
    throw new Error("Indica un host o IP valido (es. 192.168.40.1 o 192.168.40.1,2,3).");
  }
  if (targets.length > MAX_PROXMOX_SCAN_TARGETS) {
    throw new Error(`Troppi indirizzi (${targets.length}). Massimo ${MAX_PROXMOX_SCAN_TARGETS}.`);
  }

  const apiUsername = username.includes("@") ? username : `${username}@pam`;
  const sshUsername = proxmoxSshUsername(username);

  const chunks: { hosts: ProxmoxHostInfo[]; vms: ProxmoxVM[] }[] = [];
  const partialErrors: string[] = [];

  for (const ip of targets) {
    const apiUrl = buildProxmoxApiUrlForIp(ip, device.api_url);
    try {
      const port = resolveProxmoxApiPortOverride(apiUrl, device.port ?? undefined);
      const client = new ProxmoxClient({
        host: apiUrl,
        ...(port !== undefined ? { port } : {}),
        username: apiUsername,
        password,
        verifySsl: false,
      });
      chunks.push(
        await client.extractAll({
          includeStopped: false,
          includeContainers: true,
        })
      );
    } catch (e) {
      partialErrors.push(`API ${ip}: ${e instanceof Error ? e.message : String(e)}`);
    }

    try {
      chunks.push(
        await extractProxmoxViaSsh(
          { host: ip, port: device.port ?? 22, username: sshUsername, password },
          { includeStopped: false, includeContainers: true }
        )
      );
    } catch (e) {
      partialErrors.push(`SSH ${ip}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const merged = mergeProxmoxExtractResults(chunks);
  if (merged.hosts.length === 0 && merged.vms.length === 0) {
    throw new Error(
      partialErrors.length > 0
        ? partialErrors.join(" | ")
        : "Nessun dato raccolto da API o SSH sui target indicati."
    );
  }

  const result: ProxmoxDeviceScanResult = {
    hosts: merged.hosts,
    vms: merged.vms,
    scanned_at: new Date().toISOString(),
    ...(partialErrors.length > 0 ? { avvisi: partialErrors } : {}),
  };

  const updatedDevice = {
    ...device,
    last_proxmox_scan_at: result.scanned_at,
    last_proxmox_scan_result: JSON.stringify(result),
  };
  updateNetworkDevice(deviceId, {
    last_proxmox_scan_at: result.scanned_at,
    last_proxmox_scan_result: JSON.stringify(result),
  });
  syncInventoryFromDevice(updatedDevice as typeof device & { last_proxmox_scan_result: string });

  return result;
}

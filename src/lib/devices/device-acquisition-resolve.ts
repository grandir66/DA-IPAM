import type { NetworkDevice } from "@/types";
import { networkDeviceUsesArpPoll } from "@/lib/network-device-arp";
import {
  type ProductProfileId,
  scanTargetHintFromProductProfile,
} from "@/lib/device-product-profiles";

/** Modulo di acquisizione dati attivato in base alla configurazione device. */
export type DeviceAcquisitionModule =
  | "proxmox_ve"
  | "vmware_vsphere"
  | "macos_glpi"
  | "windows_winrm"
  | "linux_ssh"
  | "nas_storage"
  | "router_arp"
  | "snmp_peripheral"
  | "switch_mac";

export interface DeviceAcquisitionPlan {
  module: DeviceAcquisitionModule;
  /** Etichetta operatore (UI / toast / progress) */
  label: string;
  /** Endpoint POST relativo: proxmox-scan (sync) o query (async + progress) */
  scanEndpoint: "proxmox-scan" | "query";
  /** false = scan non ancora implementato; query restituisce errore esplicito */
  implemented: boolean;
  notImplementedHint?: string;
}

export type DeviceAcquisitionInput = {
  vendor?: NetworkDevice["vendor"];
  protocol?: NetworkDevice["protocol"];
  device_type?: NetworkDevice["device_type"];
  classification?: string | null;
  community_string?: string | null;
  snmp_credential_id?: number | null;
  scan_target?: string | null;
  product_profile?: string | null;
  use_for_arp_poll?: number | boolean | null;
};

function profileId(device: DeviceAcquisitionInput): ProductProfileId | null {
  const p = device.product_profile?.trim();
  return p ? (p as ProductProfileId) : null;
}

function nasKind(device: DeviceAcquisitionInput): "synology" | "qnap" | null {
  const v = (device.vendor ?? "").toLowerCase();
  if (v === "synology") return "synology";
  if (v === "qnap") return "qnap";
  const c = device.classification ?? "";
  if (c === "nas_synology") return "synology";
  if (c === "nas_qnap") return "qnap";
  return null;
}

/**
 * True se va eseguito lo scan Proxmox VE (API :8006 + SSH), non PBS/Linux generico.
 * Non usa più il solo `device_type=hypervisor` (evita di trattare VMware come Proxmox).
 */
export function isProxmoxVeDevice(device: DeviceAcquisitionInput): boolean {
  const scanTarget = device.scan_target;
  if (scanTarget === "windows" || scanTarget === "vmware" || scanTarget === "linux" || scanTarget === "macos") {
    return false;
  }
  if (scanTarget === "proxmox") return true;

  const profile = profileId(device);
  if (profile === "proxmox_pbs") return false;
  if (profile === "proxmox_ve") return true;

  if (device.vendor === "proxmox") {
    return scanTarget !== "linux";
  }

  return false;
}

/** @deprecated Usare isProxmoxVeDevice — alias per compatibilità con codice esistente */
export function isProxmoxAcquisitionDevice(device: DeviceAcquisitionInput): boolean {
  return isProxmoxVeDevice(device);
}

export function isVmwareDevice(device: DeviceAcquisitionInput): boolean {
  if (device.scan_target === "vmware") return true;
  if (device.vendor === "vmware") return true;
  return profileId(device) === "vmware_vsphere";
}

export function isMacosDevice(device: DeviceAcquisitionInput): boolean {
  if (device.scan_target === "macos") return true;
  if (device.vendor !== "apple") return false;
  const profile = profileId(device);
  return profile === "macos_notebook" || profile === "macos_desktop" || profile === "macos_server";
}

/**
 * Sorgente unica di verità: da vendor + profilo + protocollo + scan_target
 * al modulo di acquisizione e all'endpoint da invocare.
 */
export function resolveDeviceAcquisition(device: DeviceAcquisitionInput): DeviceAcquisitionPlan {
  if (isProxmoxVeDevice(device)) {
    return {
      module: "proxmox_ve",
      label: "Proxmox VE (API + SSH)",
      scanEndpoint: "proxmox-scan",
      implemented: true,
    };
  }

  if (isVmwareDevice(device) && device.scan_target !== "linux") {
    return {
      module: "vmware_vsphere",
      label: "VMware vSphere",
      scanEndpoint: "query",
      implemented: false,
      notImplementedHint:
        "Scansione VMware vCenter/ESXi API non ancora implementata. Per ESXi singolo imposta tipo scansione Linux e credenziali SSH root.",
    };
  }

  if (isMacosDevice(device)) {
    return {
      module: "macos_glpi",
      label: "macOS (GLPI Agent)",
      scanEndpoint: "query",
      implemented: false,
      notImplementedHint:
        "macOS: inventario via GLPI Agent push. Configura l'agent sul Mac; la scansione remota SSH non raccoglie l'inventario completo.",
    };
  }

  const scanTarget = device.scan_target;
  const isWindows =
    device.protocol === "winrm" || device.vendor === "windows" || scanTarget === "windows";
  if (isWindows) {
    return {
      module: "windows_winrm",
      label: "Windows (WinRM/WMI)",
      scanEndpoint: "query",
      implemented: true,
    };
  }

  const nas = nasKind(device);
  const isLinuxPath =
    scanTarget === "linux" ||
    device.vendor === "linux" ||
    nas != null ||
    (device.protocol === "ssh" &&
      (device.vendor === "synology" || device.vendor === "qnap" || device.vendor === "other"));

  if (isLinuxPath) {
    return {
      module: nas != null ? "nas_storage" : "linux_ssh",
      label: nas != null ? "Storage NAS (SSH/SNMP)" : "Linux (SSH)",
      scanEndpoint: "query",
      implemented: true,
    };
  }

  if (networkDeviceUsesArpPoll({
    device_type: device.device_type ?? "switch",
    vendor: device.vendor ?? "other",
    use_for_arp_poll: device.use_for_arp_poll,
  })) {
    return {
      module: "router_arp",
      label: "Router/Firewall (ARP, DHCP, LLDP)",
      scanEndpoint: "query",
      implemented: true,
    };
  }

  const isSnmpPeripheral =
    (device.protocol === "snmp_v2" ||
      device.protocol === "snmp_v3" ||
      !!device.community_string ||
      !!device.snmp_credential_id) &&
    ["stampante", "telecamera", "voip", "iot", "access_point", "firewall", "vm"].includes(
      device.classification ?? ""
    );

  if (isSnmpPeripheral) {
    return {
      module: "snmp_peripheral",
      label: "Periferica SNMP",
      scanEndpoint: "query",
      implemented: true,
    };
  }

  return {
    module: "switch_mac",
    label: "Switch (MAC table, porte, LLDP)",
    scanEndpoint: "query",
    implemented: true,
  };
}

/** Path API relativo per avviare lo scan ottimale del device. */
export function deviceScanApiPath(deviceId: number, device: DeviceAcquisitionInput): string {
  const plan = resolveDeviceAcquisition(device);
  return `/api/devices/${deviceId}/${plan.scanEndpoint}`;
}

/** Anteprima testuale per UI form (modifica / promuovi device). */
export function describeDeviceAcquisition(device: DeviceAcquisitionInput): string {
  const plan = resolveDeviceAcquisition(device);
  if (!plan.implemented) {
    return `${plan.label} — ${plan.notImplementedHint ?? "non disponibile"}`;
  }
  return plan.label;
}

/** Allinea scan_target quando cambia profilo prodotto (VE vs PBS vs macOS). */
export function scanTargetForProductProfile(profile: ProductProfileId): NetworkDevice["scan_target"] | null {
  return scanTargetHintFromProductProfile(profile);
}

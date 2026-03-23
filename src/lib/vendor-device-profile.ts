import type { NetworkDevice } from "@/types";

export type DeviceProtocol = NetworkDevice["protocol"];
export type ScanTargetKey = "none" | "proxmox" | "vmware" | "windows" | "linux";

/**
 * Profilo operativo per vendor: protocolli ammessi (ordine = priorità suggerita in UI),
 * tipo scansione e filtro credenziali.
 */
export interface VendorDeviceProfile {
  allowedProtocols: readonly DeviceProtocol[];
  defaultProtocol: DeviceProtocol;
  allowedScanTargets: readonly ScanTargetKey[];
  defaultScanTarget: ScanTargetKey;
  credentialSshFilter: "ssh_api" | "ssh_api_windows";
  shortHint: string;
}

const SNMP: readonly DeviceProtocol[] = ["snmp_v2", "snmp_v3"];
const SSH_SNMP: readonly DeviceProtocol[] = ["ssh", "snmp_v2", "snmp_v3"];
const SSH_SNMP_API: readonly DeviceProtocol[] = ["ssh", "snmp_v2", "snmp_v3", "api"];

const PROFILES: Record<NetworkDevice["vendor"], VendorDeviceProfile> = {
  /** MIKROTIK: SSH, SNMP, API */
  mikrotik: {
    allowedProtocols: SSH_SNMP_API,
    defaultProtocol: "ssh",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "SSH, SNMP (v2/v3) e API RouterOS — più vie di acquisizione combinabili con credenziali sotto.",
  },
  /** UBIQUITI: SNMP, SSH */
  ubiquiti: {
    allowedProtocols: ["snmp_v2", "snmp_v3", "ssh"],
    defaultProtocol: "snmp_v2",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "SNMP e SSH (tipico SNMP per switch/AP; SSH se abilitato).",
  },
  /** CISCO: SSH, SNMP */
  cisco: {
    allowedProtocols: SSH_SNMP,
    defaultProtocol: "ssh",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "SSH e SNMP IOS/IOS-XE/NX-OS secondo piattaforma.",
  },
  /** HPE: SSH, SNMP */
  hp: {
    allowedProtocols: SSH_SNMP,
    defaultProtocol: "ssh",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "SSH e SNMP (ProCurve, Comware, ArubaOS, iLO).",
  },
  /** OMADA: SSH, SNMP, API */
  omada: {
    allowedProtocols: ["ssh", "snmp_v2", "snmp_v3", "api"],
    defaultProtocol: "ssh",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "SSH, SNMP e API/controller Omada dove applicabile.",
  },
  stormshield: {
    allowedProtocols: SSH_SNMP,
    defaultProtocol: "ssh",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "SSH e SNMP (firewall Stormshield).",
  },
  /** PROXMOX: SSH, API */
  proxmox: {
    allowedProtocols: ["ssh", "api"],
    defaultProtocol: "api",
    allowedScanTargets: ["none", "proxmox", "linux"],
    defaultScanTarget: "proxmox",
    credentialSshFilter: "ssh_api",
    shortHint: "API (8006) e SSH; tipo scansione VE vs PBS dalla tipologia prodotto.",
  },
  vmware: {
    allowedProtocols: ["ssh", "api", "snmp_v2", "winrm"],
    defaultProtocol: "ssh",
    allowedScanTargets: ["none", "vmware", "windows", "linux"],
    defaultScanTarget: "vmware",
    credentialSshFilter: "ssh_api",
    shortHint: "ESXi/vCenter: SSH, API, SNMP o WinRM secondo ambiente.",
  },
  /** LINUX: solo SSH */
  linux: {
    allowedProtocols: ["ssh"],
    defaultProtocol: "ssh",
    allowedScanTargets: ["none", "linux"],
    defaultScanTarget: "linux",
    credentialSshFilter: "ssh_api",
    shortHint: "Solo SSH per acquisizione su host Linux.",
  },
  /** WINDOWS: WinRM (WMI), opz. SSH/SNMP */
  windows: {
    allowedProtocols: ["winrm", "ssh", "snmp_v2", "snmp_v3"],
    defaultProtocol: "winrm",
    allowedScanTargets: ["none", "windows"],
    defaultScanTarget: "windows",
    credentialSshFilter: "ssh_api_windows",
    shortHint: "WinRM (WMI); opzionale SSH o SNMP.",
  },
  /** SYNOLOGY: SSH, SNMP */
  synology: {
    allowedProtocols: SSH_SNMP,
    defaultProtocol: "ssh",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "SSH (DSM) e SNMP.",
  },
  /** QNAP: SSH, SNMP */
  qnap: {
    allowedProtocols: SSH_SNMP,
    defaultProtocol: "ssh",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "SSH (QTS) e SNMP.",
  },
  /** GENERICO: solo SNMP */
  other: {
    allowedProtocols: SNMP,
    defaultProtocol: "snmp_v2",
    allowedScanTargets: ["none"],
    defaultScanTarget: "none",
    credentialSshFilter: "ssh_api",
    shortHint: "Solo SNMP per UPS, VoIP, cam, stampanti, IoT (tipologia sotto).",
  },
};

export function getVendorDeviceProfile(vendor: string | null | undefined): VendorDeviceProfile {
  const v = (vendor || "other") as NetworkDevice["vendor"];
  return PROFILES[v] ?? PROFILES.other;
}

export function coerceProtocolForVendor(vendor: string | null | undefined, current: string | undefined): DeviceProtocol {
  const p = getVendorDeviceProfile(vendor);
  const c = (current || p.defaultProtocol) as DeviceProtocol;
  if (p.allowedProtocols.includes(c)) return c;
  return p.defaultProtocol;
}

export function coerceScanTargetForVendor(
  vendor: string | null | undefined,
  current: string | null | undefined
): string | null {
  const p = getVendorDeviceProfile(vendor);
  const key: ScanTargetKey =
    !current || current === "none" ? "none" : (current as ScanTargetKey);
  if (p.allowedScanTargets.includes(key)) {
    return key === "none" ? null : key;
  }
  const d = p.defaultScanTarget;
  return d === "none" ? null : d;
}

export function scanTargetToSelectValue(st: string | null | undefined): ScanTargetKey {
  return !st ? "none" : (st as ScanTargetKey);
}

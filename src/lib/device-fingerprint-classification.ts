/**
 * Allinea la classificazione host al risultato del fingerprint (detection_json)
 * quando la confidenza è sufficiente — es. Proxmox VE → hypervisor.
 */

import type { DeviceFingerprintSnapshot } from "@/types";
import type { DeviceClassification } from "./device-classifier";

/** Soglia per applicare classificazione da fingerprint (sotto: restano hostname/MAC/regole classiche). */
export const FINGERPRINT_CLASSIFICATION_MIN_CONFIDENCE = 0.56;

/**
 * Mappa `final_device` del fingerprint (firme porte, SNMP, banner) → slug classificazione.
 */
const FINAL_DEVICE_TO_CLASSIFICATION: Record<string, DeviceClassification> = {
  "Proxmox VE": "hypervisor",
  "Synology DSM": "storage",
  "QNAP QTS": "storage",
  "TrueNAS": "storage",
  "MikroTik RouterOS": "router",
  MikroTik: "router",
  "UniFi Controller": "access_point",
  "UniFi/Ubiquiti": "access_point",
  // Vendor profile names → classificazione (usati quando il profilo SNMP sovrascrive il fingerprint generico)
  "Ubiquiti UniFi Switch": "switch",
  "Ubiquiti UniFi AP": "access_point",
  "Ubiquiti EdgeSwitch": "switch",
  "Ubiquiti EdgeRouter": "router",
  "Ubiquiti AirMAX": "access_point",
  "Ubiquiti Device": "access_point",
  "HP ProCurve (ArubaOS-Switch)": "switch",
  "HP ProCurve": "switch",
  "HP Comware (FlexFabric)": "switch",
  "Ruckus AP": "access_point",
  "Ruckus Unleashed": "access_point",
  "Ruckus SmartZone": "access_point",
  "Ruckus Switch": "switch",
  "Ruckus": "access_point",
  "Cisco Switch": "switch",
  "Cisco Router": "router",
  "Cisco IP Phone": "voip",
  "HPE iLO (ProLiant)": "server",
  "Dell iDRAC (PowerEdge)": "server",
  "VMware ESXi": "hypervisor",
  "Stormshield SNS": "firewall",
  "pfSense/OPNsense": "firewall",
  "Fortinet FortiGate": "firewall",
  Hikvision: "telecamera",
  "Dahua / NVR": "telecamera",
  "Telecam XMEye/clone": "telecamera",
  "Windows Server": "server_windows",
  /** Regola TTL + indizi porte (etichetta «Windows» da device_fingerprint_rules) */
  "Windows": "server_windows",
  "Linux generico": "server_linux",
  "HPE iLO": "server",
  "PBX SIP (FreePBX/3CX)": "voip",
  Zabbix: "server",
  Wazuh: "server",
  Synology: "storage",
  QNAP: "storage",
  Cisco: "router",
  "Linux/net-snmp": "server_linux",
  "Linux (net-snmp)": "server_linux",
  "Windows SNMP Agent": "server_windows",
  "APC (Schneider Electric)": "ups",
  "Eaton UPS": "ups",
  "Yealink VoIP": "voip",
  "Snom VoIP": "voip",
  "Grandstream VoIP": "voip",
  "Netgear Switch": "switch",
  "D-Link Switch": "switch",
  "TP-Link Omada": "switch",
  "Juniper Networks": "router",
  "Aruba Networks (HPE)": "switch",
  "NetApp ONTAP": "storage",
};

/** Regole da DB (Impostazioni) — ordine applicazione: priority ASC, poi mappa integrata. */
export interface FingerprintUserRule {
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: boolean;
}

function applyUserFingerprintRules(raw: string, userRules: FingerprintUserRule[]): DeviceClassification | undefined {
  const enabledRules = userRules
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority || a.pattern.localeCompare(b.pattern));
  const raws = raw.trim();
  if (!raws) return undefined;
  for (const r of enabledRules) {
    const pat = r.pattern.trim();
    if (!pat) continue;
    if (r.match_kind === "exact") {
      if (raws.toLowerCase() === pat.toLowerCase()) {
        return r.classification as DeviceClassification;
      }
    } else if (raws.toLowerCase().includes(pat.toLowerCase())) {
      return r.classification as DeviceClassification;
    }
  }
  return undefined;
}

/**
 * Se il fingerprint ha confidenza sufficiente e un tipo noto, restituisce la classificazione.
 * `userRules` (opzionale) ha priorità sulla mappa integrata. Altrimenti undefined → si usano le regole classifyDevice.
 */
export function getClassificationFromFingerprintSnapshot(
  snap: Pick<DeviceFingerprintSnapshot, "final_device" | "final_confidence"> | null | undefined,
  userRules?: FingerprintUserRule[]
): DeviceClassification | undefined {
  if (!snap) return undefined;
  const conf = snap.final_confidence ?? 0;
  if (conf < FINGERPRINT_CLASSIFICATION_MIN_CONFIDENCE) return undefined;
  const raw = (snap.final_device ?? "").trim();
  if (!raw) return undefined;

  if (userRules?.length) {
    const fromUser = applyUserFingerprintRules(raw, userRules);
    if (fromUser) return fromUser;
  }

  const mapped = FINAL_DEVICE_TO_CLASSIFICATION[raw];
  if (mapped) return mapped;
  const lower = raw.toLowerCase();
  if (lower.includes("proxmox") || lower.includes("pve")) return "hypervisor";
  if (lower.includes("vmware") || lower.includes("esxi")) return "hypervisor";
  if (lower.includes("hyper-v") || lower.includes("hyperv")) return "hypervisor";
  return undefined;
}

/** Dato UI: etichetta e confidenza da `hosts.detection_json` (fingerprint). */
export interface ParsedDetectedDevice {
  label: string;
  /** 0–1 come in snapshot */
  confidence: number | undefined;
}

export function parseDetectedDeviceFromDetectionJson(
  json: string | null | undefined
): ParsedDetectedDevice | null {
  if (!json?.trim()) return null;
  try {
    const o = JSON.parse(json) as DeviceFingerprintSnapshot;
    const label = (o.final_device ?? "").trim();
    if (!label) return null;
    return {
      label,
      confidence: typeof o.final_confidence === "number" ? o.final_confidence : undefined,
    };
  } catch {
    return null;
  }
}

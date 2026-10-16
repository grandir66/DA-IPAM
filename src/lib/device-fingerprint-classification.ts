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

/**
 * Fonti che DECIDONO l'etichetta (`final_device`) senza basarsi solo sulle porte: una regola con
 * almeno una condizione che non sia di porte o TTL (oid, sysdescr, banner, hostname, mac_vendor),
 * oppure il profilo vendor SNMP che l'ha sostituita. Le altre fonti (ttl, port_signature, snmp,
 * banner_http, banner_ssh, smb_os_discovery, nmap_os) entrano in detection_sources appena la
 * sonda risponde, ma l'etichetta resta quella di matches[0], cioè delle porte
 * (device-fingerprint.ts). Pilota 16/10: un UniFi Cloud Gateway Fiber (22, 53, 80, 443, 8080,
 * 8443, 9443) aveva hosts.model = «QNAP QTS» perché la firma 8080+22+443 vinceva; col banner SSH
 * della porta 22 la stessa firma sarebbe tornata modello.
 */
function eFonteCheDecide(fonte: string): boolean {
  if (fonte === "snmp_vendor_profile") return true;
  if (!fonte.startsWith("rule:")) return false;
  return !fonte.slice(5).split("+").every((p) => p === "ports" || p === "ttl");
}

/** true se l'etichetta viene dalle porte; senza fonti non si sa, e resta com'era (false). */
export function improntaSoloPorte(snap: Pick<DeviceFingerprintSnapshot, "detection_sources">): boolean {
  const fonti = Array.isArray(snap.detection_sources) ? snap.detection_sources : [];
  return fonti.length > 0 && !fonti.some(eFonteCheDecide);
}

/**
 * Il modello che l'impronta può dare: `final_device` sopra la soglia, e solo se l'ha deciso una
 * fonte che non sia di porte (regola su sysDescr/OID/banner/hostname/MAC, profilo vendor).
 */
export function modelloDaImpronta(
  snap: Pick<DeviceFingerprintSnapshot, "final_device" | "final_confidence" | "detection_sources"> | null | undefined,
): string | undefined {
  if (!snap?.final_device) return undefined;
  if ((snap.final_confidence ?? 0) < FINGERPRINT_CLASSIFICATION_MIN_CONFIDENCE) return undefined;
  if (improntaSoloPorte(snap)) return undefined;
  return snap.final_device;
}

/**
 * true se `model` è l'etichetta finale delle impronte date (JSON di `hosts.detection_json`) e
 * TUTTE quelle con quell'etichetta sono di sole porte: un modello così l'ha scritto la scansione,
 * non un SNMP, un agente o una persona, e la scansione successiva lo sostituisce o lo azzera.
 * Basta un'impronta con la stessa etichetta decisa da una fonte vera (rule:oid, profilo vendor…)
 * e il modello resta: le regole del seed condividono l'etichetta fra porte e OID/sysDescr, e una
 * scansione senza SNMP (scan_naabu, scan_nmap_base) non deve cancellare quello che l'SNMP ha dato.
 * Senza una colonna sulla provenienza del modello un salto residuo resta: due scansioni di sole
 * porte di fila, dopo una con l'SNMP, lo azzerano alla seconda.
 */
export function modelloEtichettaDiPorte(
  model: string | null | undefined,
  detectionJsons: Array<string | null | undefined>,
): boolean {
  if (!model) return false;
  let trovata = false;
  for (const raw of detectionJsons) {
    if (!raw) continue;
    let snap: Partial<DeviceFingerprintSnapshot>;
    try {
      snap = JSON.parse(raw) as Partial<DeviceFingerprintSnapshot>;
    } catch {
      return false;
    }
    if (snap.final_device !== model) continue;
    if (!improntaSoloPorte({ detection_sources: snap.detection_sources ?? [] })) return false;
    trovata = true;
  }
  return trovata;
}

/**
 * Il profilo vendor SNMP (≥ 0,90, non generico) sostituisce un'impronta generica o debole, e la
 * fonte «snmp_vendor_profile» si segna: senza, l'etichetta del profilo non diventa modello.
 */
export function applicaProfiloVendor(
  snap: DeviceFingerprintSnapshot | null,
  vpName: string | null | undefined,
  vpConf: number,
  isGenericVp: boolean,
): DeviceFingerprintSnapshot | null {
  if (!snap || !vpName || vpConf < 0.90 || isGenericVp) return snap;
  const generica = !snap.final_device ||
    snap.final_device === "Linux/net-snmp" ||
    snap.final_device === "Linux generico" ||
    snap.final_device === "Switch" ||
    (snap.final_confidence ?? 0) < 0.70;
  if (!generica) return snap;
  return {
    ...snap,
    final_device: vpName,
    final_confidence: vpConf,
    detection_sources: [...new Set([...snap.detection_sources, "snmp_vendor_profile"])],
  };
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

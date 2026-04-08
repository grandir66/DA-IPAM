/**
 * Catalogo profili SNMP vendor-specific per identificazione device ad alta confidenza.
 * Ogni profilo mappa sysObjectID (enterprise OID) → vendor/tipo + OID specifici per model, serial, firmware.
 *
 * I profili vengono caricati dal database (tabella snmp_vendor_profiles).
 * In caso di DB non disponibile (es. build time), si usano i profili hardcoded come fallback.
 *
 * Basato su:
 * - Enterprise MIB pubbliche (Synology, QNAP, MikroTik, Fortinet, HP, Cisco, ecc.)
 * - ENTITY-MIB (RFC 2737) come fallback universale
 * - HOST-RESOURCES-MIB (RFC 2790) per Linux/Windows
 * - Printer-MIB (RFC 3805), UPS-MIB (RFC 1628)
 */

import type { DeviceClassification } from "@/lib/device-classifier";
import type { SnmpVendorProfileRow } from "@/lib/db";
import { getSnmpOidLibraryRevision, mergeProfileFieldsWithOidLibrary } from "./snmp-oid-library";

/**
 * Profilo SNMP vendor-specific. Identifica il device e fornisce OID per recuperare
 * model, serial, firmware e altri campi.
 */
export interface SnmpVendorProfile {
  /** ID univoco profilo (es. "synology", "mikrotik") */
  id: string;
  /** Nome leggibile (es. "Synology DSM", "MikroTik RouterOS") */
  name: string;
  /** Classificazione device associata */
  category: DeviceClassification;
  /** Prefissi sysObjectID che identificano questo vendor (es. ["1.3.6.1.4.1.6574"]) */
  enterpriseOidPrefixes: string[];
  /** Fallback: pattern regex su sysDescr per device con OID generico (Proxmox, TrueNAS, pfSense) */
  identifyBySysDescr?: RegExp;
  /** Mappa campo → OID (o array di OID da provare in ordine) */
  fields: {
    model?: string | string[];
    serial?: string | string[];
    firmware?: string | string[];
    os?: string | string[];
    manufacturer?: string | string[];
    partNumber?: string | string[];
    /** Campi extra vendor-specific (memorizzati in snmp_data.vendorExtra) */
    [key: string]: string | string[] | undefined;
  };
  /** Confidenza classificazione (0.90–0.99) */
  confidence: number;
}

/**
 * OID universali MIB-II (sempre interrogare per primi)
 */
export const UNIVERSAL_OIDS = {
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysObjectID: "1.3.6.1.2.1.1.2.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysContact: "1.3.6.1.2.1.1.4.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  sysLocation: "1.3.6.1.2.1.1.6.0",
} as const;

/**
 * ENTITY-MIB (RFC 2737) — fallback universale per seriali e modelli
 */
export const ENTITY_MIB_OIDS = {
  entPhysicalDescr: "1.3.6.1.2.1.47.1.1.1.1.2.1",
  entPhysicalName: "1.3.6.1.2.1.47.1.1.1.1.7.1",
  entPhysicalFirmwareRev: "1.3.6.1.2.1.47.1.1.1.1.9.1",
  entPhysicalSoftwareRev: "1.3.6.1.2.1.47.1.1.1.1.10.1",
  entPhysicalSerialNum: "1.3.6.1.2.1.47.1.1.1.1.11.1",
  entPhysicalMfgName: "1.3.6.1.2.1.47.1.1.1.1.12.1",
  entPhysicalModelName: "1.3.6.1.2.1.47.1.1.1.1.13.1",
} as const;

/**
 * HOST-RESOURCES-MIB (RFC 2790) — per Linux/Windows/BSD
 */
export const HOST_RESOURCES_OIDS = {
  hrSystemUptime: "1.3.6.1.2.1.25.1.1.0",
  hrSystemInitialLoadParameters: "1.3.6.1.2.1.25.1.4.0",
} as const;

/**
 * Printer-MIB (RFC 3805) — universale per stampanti
 */
export const PRINTER_MIB_OIDS = {
  prtGeneralSerialNumber: "1.3.6.1.2.1.43.5.1.1.16.1",
  prtMarkerSuppliesLevel: "1.3.6.1.2.1.43.11.1.1.9.1.1",
  prtMarkerSuppliesMaxCapacity: "1.3.6.1.2.1.43.11.1.1.8.1.1",
  prtMarkerLifeCount: "1.3.6.1.2.1.43.10.2.1.4.1.1",
} as const;

/**
 * UPS-MIB (RFC 1628) — universale per UPS
 */
export const UPS_MIB_OIDS = {
  upsIdentModel: "1.3.6.1.2.1.33.1.1.2.0",
  upsIdentUPSSoftwareVersion: "1.3.6.1.2.1.33.1.1.3.0",
  upsBatteryStatus: "1.3.6.1.2.1.33.1.2.1.0",
  upsEstimatedMinutesRemaining: "1.3.6.1.2.1.33.1.2.5.0",
  upsEstimatedChargeRemaining: "1.3.6.1.2.1.33.1.2.6.0",
} as const;

/**
 * Catalogo completo profili vendor (~35 profili)
 */
export const SNMP_VENDOR_PROFILES: SnmpVendorProfile[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: FIREWALL / UTM / SECURITY
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "stormshield",
    name: "Stormshield SNS",
    category: "firewall",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.11256"],
    confidence: 0.98,
    fields: {
      model: "1.3.6.1.4.1.11256.1.1.1.0",
      firmware: "1.3.6.1.4.1.11256.1.1.2.0",
      serial: "1.3.6.1.4.1.11256.1.1.3.0",
      haState: "1.3.6.1.4.1.11256.1.11.1.0",
      haPeer: "1.3.6.1.4.1.11256.1.11.2.0",
    },
  },

  {
    id: "fortinet",
    name: "Fortinet FortiGate",
    category: "firewall",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.12356"],
    confidence: 0.98,
    fields: {
      firmware: "1.3.6.1.4.1.12356.101.4.1.1.0",
      model: "1.3.6.1.4.1.12356.101.4.1.5.0",
      serial: "1.3.6.1.4.1.12356.101.4.1.4.0",
      cpuUsage: "1.3.6.1.4.1.12356.101.4.6.1.0",
      memUsage: "1.3.6.1.4.1.12356.101.4.6.4.0",
    },
  },

  {
    id: "pfsense",
    name: "pfSense",
    category: "firewall",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.12325"],
    identifyBySysDescr: /pfsense/i,
    confidence: 0.95,
    fields: {
      os: UNIVERSAL_OIDS.sysDescr,
    },
  },

  {
    id: "opnsense",
    name: "OPNsense",
    category: "firewall",
    enterpriseOidPrefixes: [],
    identifyBySysDescr: /opnsense/i,
    confidence: 0.95,
    fields: {
      os: UNIVERSAL_OIDS.sysDescr,
    },
  },

  {
    id: "sophos",
    name: "Sophos XG/XGS",
    category: "firewall",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.2604"],
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.2604.5.1.1.2.0",
      firmware: "1.3.6.1.4.1.2604.5.1.1.3.0",
      serial: [ENTITY_MIB_OIDS.entPhysicalSerialNum, "1.3.6.1.4.1.2604.5.1.1.4.0"],
    },
  },

  {
    id: "paloalto",
    name: "Palo Alto Networks",
    category: "firewall",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.25461"],
    confidence: 0.98,
    fields: {
      firmware: "1.3.6.1.4.1.25461.2.1.2.1.1.0",
      model: "1.3.6.1.4.1.25461.2.1.2.1.5.0",
      serial: "1.3.6.1.4.1.25461.2.1.2.1.3.0",
      hwVersion: "1.3.6.1.4.1.25461.2.1.2.1.2.0",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: SWITCH
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "cisco_switch",
    name: "Cisco Switch",
    category: "switch",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.9.1.5", "1.3.6.1.4.1.9.1.1"],
    confidence: 0.96,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: [ENTITY_MIB_OIDS.entPhysicalSerialNum, "1.3.6.1.4.1.9.3.6.3.0"],
      firmware: ENTITY_MIB_OIDS.entPhysicalSoftwareRev,
      cpuUsage: "1.3.6.1.4.1.9.9.109.1.1.1.1.4.1",
      memFree: "1.3.6.1.4.1.9.9.48.1.1.1.5.1",
    },
  },

  {
    id: "cisco_router",
    name: "Cisco Router",
    category: "router",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.9.1"],
    confidence: 0.94,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: [ENTITY_MIB_OIDS.entPhysicalSerialNum, "1.3.6.1.4.1.9.3.6.3.0"],
      firmware: ENTITY_MIB_OIDS.entPhysicalSoftwareRev,
    },
  },

  {
    id: "hp_procurve",
    name: "HP ProCurve (ArubaOS-Switch)",
    category: "switch",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.11.2.14.11.5.1", "1.3.6.1.4.1.11.2.3.7"],
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.11.2.14.11.5.1.1.2.0",
      firmware: "1.3.6.1.4.1.11.2.14.11.5.1.1.7.0",
      serial: "1.3.6.1.4.1.11.2.14.11.5.1.1.10.0",
      romVersion: "1.3.6.1.4.1.11.2.14.11.5.1.1.4.0",
      baseMac: "1.3.6.1.4.1.11.2.14.11.5.1.1.11.0",
    },
  },

  {
    id: "hp_comware",
    name: "HP Comware (FlexFabric)",
    category: "switch",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.25506"],
    confidence: 0.96,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
      cpuUsage: "1.3.6.1.4.1.25506.2.6.1.1.1.1.9.1",
      memUsage: "1.3.6.1.4.1.25506.2.6.1.1.1.1.8.1",
      temperature: "1.3.6.1.4.1.25506.2.6.1.1.1.1.12.1",
    },
  },

  {
    id: "juniper",
    name: "Juniper Networks",
    category: "router",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.2636"],
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.2636.3.1.2.0",
      serial: "1.3.6.1.4.1.2636.3.1.3.0",
      hwRevision: "1.3.6.1.4.1.2636.3.1.4.0",
      temperature: "1.3.6.1.4.1.2636.3.18.1.4.1",
      cpuUsage: "1.3.6.1.4.1.2636.3.18.1.8.1",
    },
  },

  {
    id: "aruba",
    name: "Aruba Networks (HPE)",
    category: "switch",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.14823"],
    confidence: 0.96,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
      switchRole: "1.3.6.1.4.1.14823.2.2.1.1.1.3.0",
      totalMemory: "1.3.6.1.4.1.14823.2.2.1.1.3.1",
    },
  },

  {
    id: "netgear",
    name: "Netgear Switch",
    category: "switch",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.4526"],
    confidence: 0.95,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
    },
  },

  {
    id: "dlink",
    name: "D-Link Switch",
    category: "switch",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.171"],
    confidence: 0.94,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
    },
  },

  {
    id: "tplink_omada",
    name: "TP-Link Omada",
    category: "switch",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.11863"],
    confidence: 0.95,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
      firmware: ENTITY_MIB_OIDS.entPhysicalFirmwareRev,
    },
  },

  {
    id: "ubiquiti_edgeswitch",
    name: "Ubiquiti EdgeSwitch",
    category: "switch",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.4413"],
    confidence: 0.96,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: ROUTER / CPE
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "mikrotik",
    name: "MikroTik RouterOS",
    category: "router",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.14988"],
    confidence: 0.98,
    fields: {
      model: "1.3.6.1.4.1.14988.1.1.7.1.0",
      serial: "1.3.6.1.4.1.14988.1.1.7.3.0",
      firmware: "1.3.6.1.4.1.14988.1.1.7.7.0",
      upgradeFirmware: "1.3.6.1.4.1.14988.1.1.7.4.0",
      licenseVersion: "1.3.6.1.4.1.14988.1.1.7.8.0",
      temperature: "1.3.6.1.4.1.14988.1.1.3.1.0",
      voltage: "1.3.6.1.4.1.14988.1.1.3.11.0",
      identity: "1.3.6.1.4.1.14988.1.1.4.1.0",
    },
  },

  {
    id: "ubiquiti_edgerouter",
    name: "Ubiquiti EdgeRouter",
    category: "router",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.41112.1.5"],
    identifyBySysDescr: /edgeos/i,
    confidence: 0.95,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: SWITCH (UBIQUITI UniFi)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "ubiquiti_unifi_switch",
    name: "Ubiquiti UniFi Switch",
    category: "switch",
    enterpriseOidPrefixes: [],
    identifyBySysDescr: /\busw[-\s]|\bus[-\s]\d|\buflex\b|\bunifi\s*switch\b|\bindustrial\b.*ubiquiti|ubiquiti.*\bindustrial\b|us-\d+-\d+|usl[-\s]|us\d+p/i,
    confidence: 0.96,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: ACCESS POINT / WIFI
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "ubiquiti_unifi_ap",
    name: "Ubiquiti UniFi AP",
    category: "access_point",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.41112.1.6"],
    identifyBySysDescr: /\buap[-\s]|\bu6[-\s]|\bunifi\s*ap\b/i,
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.41112.1.6.1.1.0",
      firmware: "1.3.6.1.4.1.41112.1.6.1.2.0",
      serial: "1.3.6.1.4.1.41112.1.6.1.3.0",
      radioChannel: "1.3.6.1.4.1.41112.1.6.4.1.4",
      txPower: "1.3.6.1.4.1.41112.1.6.4.1.3",
    },
  },

  {
    id: "ubiquiti_airmax",
    name: "Ubiquiti AirMAX",
    category: "access_point",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.41112.1.2"],
    confidence: 0.96,
    fields: {
      txCapacity: "1.3.6.1.4.1.41112.1.2.2.1.2.1",
      rxCapacity: "1.3.6.1.4.1.41112.1.2.2.1.3.1",
      ssid: "1.3.6.1.4.1.41112.1.2.1.1.1",
    },
  },

  {
    id: "ubiquiti_generic",
    name: "Ubiquiti Device",
    category: "access_point",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.41112"],
    confidence: 0.90,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: STORAGE / NAS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "synology",
    name: "Synology DSM",
    category: "storage",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.6574"],
    identifyBySysDescr: /synology|diskstation|\bdsm\b/i,
    confidence: 0.98,
    fields: {
      // SYNOLOGY-SYSTEM-MIB dsmInfo: modelName, serialNumber, version
      model: "1.3.6.1.4.1.6574.1.5.1.0",
      serial: "1.3.6.1.4.1.6574.1.5.2.0",
      firmware: "1.3.6.1.4.1.6574.1.5.3.0",
      systemStatus: "1.3.6.1.4.1.6574.1.1.0",
      powerStatus: "1.3.6.1.4.1.6574.1.2.0",
      temperature: "1.3.6.1.4.1.6574.1.4.2.0",
    },
  },

  {
    id: "qnap",
    name: "QNAP QTS",
    category: "storage",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.24681"],
    identifyBySysDescr: /\bqnap\b|\bqts\b|turbo\s*nas/i,
    confidence: 0.98,
    fields: {
      model: "1.3.6.1.4.1.24681.1.2.1.0",
      firmware: "1.3.6.1.4.1.24681.1.2.2.0",
      serial: "1.3.6.1.4.1.24681.1.2.3.0",
      temperature: "1.3.6.1.4.1.24681.1.2.7.0",
    },
  },

  {
    id: "truenas",
    name: "TrueNAS",
    category: "storage",
    enterpriseOidPrefixes: [],
    identifyBySysDescr: /truenas|freenas/i,
    confidence: 0.94,
    fields: {
      os: UNIVERSAL_OIDS.sysDescr,
    },
  },

  {
    id: "netapp",
    name: "NetApp ONTAP",
    category: "storage",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.789"],
    confidence: 0.97,
    fields: {
      firmware: "1.3.6.1.4.1.789.1.1.2.0",
      model: "1.3.6.1.4.1.789.1.1.3.0",
      serial: "1.3.6.1.4.1.789.1.1.4.0",
      cpuUsage: "1.3.6.1.4.1.789.1.2.2.4.0",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: SERVER / HYPERVISOR
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "hpe_ilo",
    name: "HPE iLO (ProLiant)",
    category: "server",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.232"],
    identifyBySysDescr: /\bilo\b|integrated\s*lights.?out|proliant/i,
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.232.2.2.4.2.0",
      serial: "1.3.6.1.4.1.232.2.2.2.6.0",
      partNumber: "1.3.6.1.4.1.232.2.2.4.3.0",
      iloModel: "1.3.6.1.4.1.232.9.2.2.1.0",
      iloFirmware: "1.3.6.1.4.1.232.9.2.2.2.0",
      healthStatus: "1.3.6.1.4.1.232.6.1.3.0",
    },
  },

  {
    id: "dell_idrac",
    name: "Dell iDRAC (PowerEdge)",
    category: "server",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.674"],
    confidence: 0.97,
    fields: {
      serial: "1.3.6.1.4.1.674.10892.5.1.3.2.0",
      expressServiceCode: "1.3.6.1.4.1.674.10892.5.1.3.12.0",
      model: "1.3.6.1.4.1.674.10892.5.1.3.21.0",
      healthStatus: "1.3.6.1.4.1.674.10892.5.1.1.2.0",
      idracFirmware: "1.3.6.1.4.1.674.10892.5.4.300.50.1.7.1.1",
    },
  },

  {
    id: "vmware_esxi",
    name: "VMware ESXi",
    category: "hypervisor",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.6876"],
    confidence: 0.98,
    fields: {
      model: "1.3.6.1.4.1.6876.1.1.0",
      firmware: "1.3.6.1.4.1.6876.1.2.0",
      build: "1.3.6.1.4.1.6876.1.4.0",
      numVMs: "1.3.6.1.4.1.6876.2.1.0",
      numRunningVMs: "1.3.6.1.4.1.6876.2.2.0",
    },
  },

  {
    id: "proxmox",
    name: "Proxmox VE",
    category: "hypervisor",
    enterpriseOidPrefixes: [],
    identifyBySysDescr: /proxmox|pve|pve-manager|qemu\/kvm/i,
    confidence: 0.95,
    fields: {
      os: UNIVERSAL_OIDS.sysDescr,
    },
  },

  {
    id: "linux_generic",
    name: "Linux (net-snmp)",
    category: "server_linux",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.8072"],
    confidence: 0.85,
    fields: {
      os: UNIVERSAL_OIDS.sysDescr,
    },
  },

  {
    id: "windows_snmp",
    name: "Windows SNMP Agent",
    category: "server_windows",
    enterpriseOidPrefixes: [],
    identifyBySysDescr: /windows/i,
    confidence: 0.85,
    fields: {
      os: UNIVERSAL_OIDS.sysDescr,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: TELECAMERE IP / NVR / DVR
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "hikvision",
    name: "Hikvision",
    category: "telecamera",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.39165", "1.3.6.1.4.1.50001"],
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.39165.1.1.0",
      firmware: "1.3.6.1.4.1.39165.1.3.0",
      mac: "1.3.6.1.4.1.39165.1.4.0",
      manufacturer: "1.3.6.1.4.1.39165.1.6.0",
      cpuUsage: "1.3.6.1.4.1.39165.1.7.0",
      ramTotal: "1.3.6.1.4.1.39165.1.10.0",
      ramUsage: "1.3.6.1.4.1.39165.1.11.0",
    },
  },

  {
    id: "dahua",
    name: "Dahua / NVR",
    category: "telecamera",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.1004849"],
    identifyBySysDescr: /dahua/i,
    confidence: 0.95,
    fields: {
      os: UNIVERSAL_OIDS.sysDescr,
    },
  },

  {
    id: "axis",
    name: "Axis Communications",
    category: "telecamera",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.368"],
    confidence: 0.96,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: TELEFONIA IP / VoIP
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "yealink",
    name: "Yealink VoIP",
    category: "voip",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.3990"],
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.3990.9.1.0",
      firmware: "1.3.6.1.4.1.3990.9.2.0",
      mac: "1.3.6.1.4.1.3990.9.3.0",
      sipNumber: "1.3.6.1.4.1.3990.9.5.0",
    },
  },

  {
    id: "snom",
    name: "Snom VoIP",
    category: "voip",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.1526"],
    confidence: 0.96,
    fields: {
      firmware: "1.3.6.1.4.1.1526.11.1.0",
      mac: "1.3.6.1.4.1.1526.11.3.0",
    },
  },

  {
    id: "grandstream",
    name: "Grandstream VoIP",
    category: "voip",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.31746"],
    confidence: 0.95,
    fields: {
      os: UNIVERSAL_OIDS.sysDescr,
    },
  },

  {
    id: "cisco_phone",
    name: "Cisco IP Phone",
    category: "voip",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.9.6.1"],
    confidence: 0.96,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: ENTITY_MIB_OIDS.entPhysicalSerialNum,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: UPS / PDU
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "apc",
    name: "APC (Schneider Electric)",
    category: "ups",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.318"],
    confidence: 0.98,
    fields: {
      model: "1.3.6.1.4.1.318.1.1.1.1.1.1.0",
      firmware: "1.3.6.1.4.1.318.1.1.1.1.2.1.0",
      serial: "1.3.6.1.4.1.318.1.1.1.1.2.3.0",
      mfgDate: "1.3.6.1.4.1.318.1.1.1.1.2.2.0",
      batteryStatus: "1.3.6.1.4.1.318.1.1.1.2.1.1.0",
      batteryCapacity: "1.3.6.1.4.1.318.1.1.1.2.2.1.0",
      batteryTemperature: "1.3.6.1.4.1.318.1.1.1.2.2.2.0",
      batteryRuntime: "1.3.6.1.4.1.318.1.1.1.2.2.4.0",
      outputLoad: "1.3.6.1.4.1.318.1.1.1.4.2.3.0",
    },
  },

  {
    id: "eaton",
    name: "Eaton UPS",
    category: "ups",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.705"],
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.705.1.1.1.0",
      firmware: "1.3.6.1.4.1.705.1.1.7.0",
      batteryCapacity: "1.3.6.1.4.1.705.1.5.1.0",
      batteryRuntime: "1.3.6.1.4.1.705.1.5.2.0",
      batteryVoltage: "1.3.6.1.4.1.705.1.5.5.0",
      outputLoad: "1.3.6.1.4.1.705.1.7.2.0",
    },
  },

  {
    id: "ups_rfc1628",
    name: "UPS (RFC 1628)",
    category: "ups",
    enterpriseOidPrefixes: [],
    identifyBySysDescr: /ups|uninterruptible/i,
    confidence: 0.88,
    fields: {
      model: UPS_MIB_OIDS.upsIdentModel,
      firmware: UPS_MIB_OIDS.upsIdentUPSSoftwareVersion,
      batteryStatus: UPS_MIB_OIDS.upsBatteryStatus,
      batteryRuntime: UPS_MIB_OIDS.upsEstimatedMinutesRemaining,
      batteryCapacity: UPS_MIB_OIDS.upsEstimatedChargeRemaining,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORIA: STAMPANTI
  // ═══════════════════════════════════════════════════════════════════════════

  {
    id: "hp_printer",
    name: "HP JetDirect (LaserJet)",
    category: "stampante",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.11.2.3.9"],
    confidence: 0.97,
    fields: {
      serial: "1.3.6.1.4.1.11.2.3.9.1.1.7.0",
      model: "1.3.6.1.4.1.11.2.3.9.4.2.1.1.1.1.20.1",
      tonerLevel: PRINTER_MIB_OIDS.prtMarkerSuppliesLevel,
      pageCount: PRINTER_MIB_OIDS.prtMarkerLifeCount,
    },
  },

  {
    id: "epson",
    name: "Epson Printer",
    category: "stampante",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.1248"],
    confidence: 0.96,
    fields: {
      model: ENTITY_MIB_OIDS.entPhysicalModelName,
      serial: PRINTER_MIB_OIDS.prtGeneralSerialNumber,
      inkLevel: PRINTER_MIB_OIDS.prtMarkerSuppliesLevel,
      pageCount: PRINTER_MIB_OIDS.prtMarkerLifeCount,
    },
  },

  // ── RUCKUS / COMMSCOPE ──
  {
    id: "ruckus_ap",
    name: "Ruckus AP",
    category: "access_point",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.25053.3.1.4", "1.3.6.1.4.1.25053.3.1.5"],
    identifyBySysDescr: /ruckus/i,
    confidence: 0.97,
    fields: {
      model: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.2.1",
      serial: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.3.1",
      firmware: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.7.1",
    },
  },
  {
    id: "ruckus_controller",
    name: "Ruckus SmartZone",
    category: "access_point",
    enterpriseOidPrefixes: ["1.3.6.1.4.1.25053.3.1.11", "1.3.6.1.4.1.25053.3.1.13"],
    confidence: 0.96,
    fields: {
      model: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.2.1",
      firmware: "1.3.6.1.4.1.25053.1.2.1.1.1.5.1.7.1",
    },
  },

  {
    id: "printer_generic",
    name: "Printer (RFC 3805)",
    category: "stampante",
    enterpriseOidPrefixes: [],
    identifyBySysDescr: /printer|laserjet|deskjet|officejet|multifunction|mfp/i,
    confidence: 0.88,
    fields: {
      serial: PRINTER_MIB_OIDS.prtGeneralSerialNumber,
      tonerLevel: PRINTER_MIB_OIDS.prtMarkerSuppliesLevel,
      pageCount: PRINTER_MIB_OIDS.prtMarkerLifeCount,
    },
  },
];

/**
 * Mappa enterprise number → vendor (per lookup veloce)
 */
export const ENTERPRISE_VENDOR_MAP: Record<number, string> = {
  9: "Cisco",
  11: "HP / HPE",
  171: "D-Link",
  232: "HPE (iLO/ProLiant)",
  318: "APC/Schneider",
  368: "Axis Communications",
  674: "Dell (iDRAC)",
  705: "Eaton",
  789: "NetApp",
  1248: "Epson",
  1526: "Snom",
  1981: "EMC",
  2604: "Sophos",
  2636: "Juniper",
  3990: "Yealink",
  4413: "Ubiquiti EdgeSwitch",
  4526: "Netgear",
  6574: "Synology",
  6876: "VMware",
  8072: "Net-SNMP (Linux/Unix)",
  11256: "Stormshield",
  11863: "TP-Link/Omada",
  12325: "pfSense",
  12356: "Fortinet",
  14823: "Aruba Networks",
  14988: "MikroTik",
  24681: "QNAP",
  25053: "Ruckus / CommScope",
  25461: "Palo Alto",
  25506: "H3C/HP Comware",
  31746: "Grandstream",
  39165: "Hikvision",
  41112: "Ubiquiti",
  50001: "Hikvision (alt)",
  1004849: "Dahua",
};

/**
 * Estrae l'enterprise number da sysObjectID.
 * Es. "1.3.6.1.4.1.6574.1.5.1" → 6574
 */
export function extractEnterpriseNumber(sysObjectID: string | null): number | null {
  if (!sysObjectID) return null;
  const normalized = sysObjectID.replace(/^\./, "");
  const prefix = "1.3.6.1.4.1.";
  if (!normalized.startsWith(prefix)) return null;
  const rest = normalized.slice(prefix.length);
  const firstDot = rest.indexOf(".");
  const entStr = firstDot > 0 ? rest.slice(0, firstDot) : rest;
  const ent = parseInt(entStr, 10);
  return isNaN(ent) ? null : ent;
}

/**
 * Verifica se sysObjectID corrisponde a uno dei prefissi del profilo.
 * Es. oid="1.3.6.1.4.1.6574.1.2.3", prefix="1.3.6.1.4.1.6574" → true
 */
function oidMatchesPrefix(oid: string | null, prefix: string): boolean {
  if (!oid || !prefix) return false;
  let normOid = oid.replace(/^\./, "");
  // Normalizza nomi simbolici: "enterprises.X" → "1.3.6.1.4.1.X"
  normOid = normOid.replace(/^[A-Za-z0-9_-]+::/g, "").trim();
  if (/^enterprises\b/i.test(normOid)) normOid = normOid.replace(/^enterprises\.?/i, "1.3.6.1.4.1.");
  if (/^iso\b/i.test(normOid)) normOid = normOid.replace(/^iso\.?/i, "1.");
  normOid = normOid.replace(/^\.+/, "").replace(/\.{2,}/g, ".");
  const normPrefix = prefix.replace(/^\./, "");
  if (normOid === normPrefix) return true;
  if (normOid.startsWith(normPrefix + ".")) return true;
  return false;
}

/**
 * Risolve il profilo SNMP vendor in base a sysObjectID e sysDescr.
 * Priorità: match OID enterprise > match sysDescr regex.
 *
 * Per device con OID generico (es. net-snmp 8072) e sysDescr specifico (es. "Proxmox"),
 * il profilo identifyBySysDescr vince sul profilo generico linux_generic.
 */
export function resolveSnmpVendorProfile(
  sysObjectID: string | null,
  sysDescr: string | null
): SnmpVendorProfile | null {
  // Prima prova: match per enterpriseOidPrefixes
  if (sysObjectID) {
    // Ordina per lunghezza prefisso decrescente (più specifico prima)
    const sortedByOid = [...SNMP_VENDOR_PROFILES]
      .filter((p) => p.enterpriseOidPrefixes.length > 0)
      .sort((a, b) => {
        const maxA = Math.max(...a.enterpriseOidPrefixes.map((x) => x.length));
        const maxB = Math.max(...b.enterpriseOidPrefixes.map((x) => x.length));
        return maxB - maxA;
      });

    for (const profile of sortedByOid) {
      for (const prefix of profile.enterpriseOidPrefixes) {
        if (oidMatchesPrefix(sysObjectID, prefix)) {
          return profile;
        }
      }
    }
  }

  // Seconda prova: match per identifyBySysDescr (pattern regex)
  if (sysDescr) {
    // I profili con identifyBySysDescr hanno priorità su quelli generici
    const profilesWithSysDescrMatch = SNMP_VENDOR_PROFILES.filter(
      (p) => p.identifyBySysDescr && p.identifyBySysDescr.test(sysDescr)
    );
    if (profilesWithSysDescrMatch.length > 0) {
      // Preferisci il profilo con confidenza più alta
      return profilesWithSysDescrMatch.sort((a, b) => b.confidence - a.confidence)[0];
    }
  }

  return null;
}

/**
 * Restituisce il vendor name dall'enterprise number.
 */
export function getVendorFromEnterprise(sysObjectID: string | null): string | null {
  const ent = extractEnterpriseNumber(sysObjectID);
  if (ent === null) return null;
  return ENTERPRISE_VENDOR_MAP[ent] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATABASE-DRIVEN PROFILES (Dynamic loading)
// ═══════════════════════════════════════════════════════════════════════════

let _cachedDbProfiles: SnmpVendorProfile[] | null = null;
let _cacheTimestamp = 0;
let _cachedLibraryRevision: string | null = null;
const CACHE_TTL_MS = 60000;

/**
 * Converte un profilo dal formato DB (SnmpVendorProfileRow) al formato runtime (SnmpVendorProfile).
 */
function dbRowToProfile(row: SnmpVendorProfileRow): SnmpVendorProfile {
  let enterpriseOidPrefixes: string[] = [];
  try {
    const parsed = JSON.parse(row.enterprise_oid_prefixes);
    if (Array.isArray(parsed)) enterpriseOidPrefixes = parsed;
  } catch { /* ignore */ }

  let fields: SnmpVendorProfile["fields"] = {};
  try {
    fields = JSON.parse(row.fields) as SnmpVendorProfile["fields"];
  } catch { /* ignore */ }

  let identifyBySysDescr: RegExp | undefined;
  if (row.sysdescr_pattern) {
    try {
      identifyBySysDescr = new RegExp(row.sysdescr_pattern, "i");
    } catch { /* ignore invalid regex */ }
  }

  return {
    id: row.profile_id,
    name: row.name,
    category: row.category as DeviceClassification,
    enterpriseOidPrefixes,
    identifyBySysDescr,
    fields,
    confidence: row.confidence,
  };
}

/**
 * Carica i profili SNMP dal database. Ritorna i profili hardcoded se DB non disponibile.
 * I risultati sono cachati per 60 secondi per evitare query ripetute.
 */
function applyOidLibraryToProfiles(profiles: SnmpVendorProfile[]): SnmpVendorProfile[] {
  return profiles.map((p) => {
    const merged = mergeProfileFieldsWithOidLibrary(p.id, p.category, p.fields);
    return { ...p, fields: merged as SnmpVendorProfile["fields"] };
  });
}

export function getSnmpVendorProfilesFromDb(): SnmpVendorProfile[] {
  const now = Date.now();
  const libRev = getSnmpOidLibraryRevision();
  if (
    _cachedDbProfiles &&
    _cachedLibraryRevision === libRev &&
    now - _cacheTimestamp < CACHE_TTL_MS
  ) {
    return _cachedDbProfiles;
  }

  try {
    // Dynamic import per evitare circular dependency e problemi di build
    const db = require("@/lib/db");
    const rows: SnmpVendorProfileRow[] = db.getEnabledSnmpVendorProfiles();
    if (rows && rows.length > 0) {
      const base = rows.map(dbRowToProfile);
      _cachedDbProfiles = applyOidLibraryToProfiles(base);
      _cachedLibraryRevision = libRev;
      _cacheTimestamp = now;
      return _cachedDbProfiles;
    }
  } catch {
    // DB non disponibile (build time, test, ecc.) - usa hardcoded
  }

  _cachedDbProfiles = applyOidLibraryToProfiles([...SNMP_VENDOR_PROFILES]);
  _cachedLibraryRevision = libRev;
  _cacheTimestamp = now;
  return _cachedDbProfiles;
}

/**
 * Invalida la cache dei profili SNMP (da chiamare dopo modifica DB).
 */
export function invalidateSnmpVendorProfilesCache(): void {
  _cachedDbProfiles = null;
  _cacheTimestamp = 0;
  _cachedLibraryRevision = null;
}

/**
 * Risolve il profilo SNMP vendor in base a sysObjectID e sysDescr,
 * usando i profili dal database (con fallback hardcoded).
 */
export function resolveSnmpVendorProfileFromDb(
  sysObjectID: string | null,
  sysDescr: string | null
): SnmpVendorProfile | null {
  const profiles = getSnmpVendorProfilesFromDb();

  let oidMatch: SnmpVendorProfile | null = null;

  // Prima prova: match per enterpriseOidPrefixes
  if (sysObjectID) {
    const sortedByOid = [...profiles]
      .filter((p) => p.enterpriseOidPrefixes.length > 0)
      .sort((a, b) => {
        const maxA = Math.max(...a.enterpriseOidPrefixes.map((x) => x.length));
        const maxB = Math.max(...b.enterpriseOidPrefixes.map((x) => x.length));
        return maxB - maxA;
      });

    for (const profile of sortedByOid) {
      for (const prefix of profile.enterpriseOidPrefixes) {
        if (oidMatchesPrefix(sysObjectID, prefix)) {
          oidMatch = profile;
          break;
        }
      }
      if (oidMatch) break;
    }
  }

  // Seconda prova: match per identifyBySysDescr (pattern regex)
  // Se il sysDescr individua un profilo PIU SPECIFICO (stesso vendor, diversa categoria),
  // preferiscilo al match OID generico. Es: OID 41112 → ubiquiti_generic (AP), ma sysDescr
  // contiene "USW" → ubiquiti_unifi_switch (switch) è più accurato.
  if (sysDescr) {
    const profilesWithSysDescrMatch = profiles.filter(
      (p) => p.identifyBySysDescr && p.identifyBySysDescr.test(sysDescr)
    );
    if (profilesWithSysDescrMatch.length > 0) {
      const bestSysDescrMatch = profilesWithSysDescrMatch.sort((a, b) => b.confidence - a.confidence)[0];
      if (!oidMatch) return bestSysDescrMatch;
      // sysDescr match sovrascrive OID match se hanno categorie diverse
      // (disambiguazione per vendor con OID ambigui come Ubiquiti 41112)
      if (bestSysDescrMatch.category !== oidMatch.category) {
        return bestSysDescrMatch;
      }
    }
  }

  return oidMatch;
}

import type { NetworkDevice } from "@/types";

/**
 * Mappa stringhe vendor da host (OUI, SNMP, sysDescr) → slug network_devices.vendor.
 * Usato quando si crea un dispositivo da host senza vendor esplicito nel body.
 */
export function inferNetworkDeviceVendorFromHostHint(
  raw: string | null | undefined
): NetworkDevice["vendor"] | undefined {
  if (!raw?.trim()) return undefined;
  const s = raw.trim().toLowerCase();

  const rules: Array<{ test: (t: string) => boolean; vendor: NetworkDevice["vendor"] }> = [
    { test: (t) => /mikrotik|routeros/.test(t), vendor: "mikrotik" },
    { test: (t) => /ubiquiti|unifi|edgeswitch|edge\s*max|usw[-\s]|us[-\s]\d|uflex/.test(t), vendor: "ubiquiti" },
    { test: (t) => /cisco|meraki|nexus|cat\d/.test(t), vendor: "cisco" },
    { test: (t) => /hewlett|hp\s|hpe|aruba|procurve|comware|officeconnect/.test(t), vendor: "hp" },
    { test: (t) => /omada|tp-?link/.test(t), vendor: "omada" },
    { test: (t) => /stormshield|netasq/.test(t), vendor: "stormshield" },
    { test: (t) => /proxmox/.test(t), vendor: "proxmox" },
    { test: (t) => /vmware|esxi/.test(t), vendor: "vmware" },
    { test: (t) => /synology/.test(t), vendor: "synology" },
    { test: (t) => /qnap/.test(t), vendor: "qnap" },
    { test: (t) => /microsoft|windows/.test(t), vendor: "windows" },
    { test: (t) => /linux|ubuntu|debian|red\s*hat|centos|alma|rocky/.test(t), vendor: "linux" },
  ];

  for (const { test, vendor } of rules) {
    if (test(s)) return vendor;
  }
  return undefined;
}

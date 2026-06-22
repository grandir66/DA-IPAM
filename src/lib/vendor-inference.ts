/**
 * Helper di inferenza vendor da string SMBIOS/SNMP/scan.
 *
 * NB: questa è la versione "ridotta" usata client-side per pre-popolare il
 * modale di promozione. La logica server-side autoritativa è in
 * `src/lib/devices/auto-classify.ts` (rule-based completa, popola hosts.inferred_*).
 *
 * Mantenuto qui per riusabilità tra `hosts/[id]/page.tsx` e
 * `<PromoteHostDialog>`. Niente JSX, niente dipendenze framework.
 */

export const VENDOR_FROM_MANUFACTURER: Record<string, string> = {
  proxmox: "proxmox",
  vmware: "vmware",
  mikrotik: "mikrotik",
  ubiquiti: "ubiquiti",
  cisco: "cisco",
  juniper: "other",
  huawei: "other",
  hpe: "hp",
  "hp ": "hp",
  aruba: "hp",
  synology: "synology",
  qnap: "qnap",
  windows: "windows",
  linux: "linux",
  apple: "apple",
};

export function inferVendorFromManufacturer(m: string | null | undefined): string {
  if (!m) return "other";
  const lower = m.toLowerCase();
  for (const [key, val] of Object.entries(VENDOR_FROM_MANUFACTURER)) {
    if (lower.includes(key)) return val;
  }
  return "other";
}

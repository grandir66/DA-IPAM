import type { NetworkDevice } from "@/types";

/** True se sono stati salvati dati inventario da query (JSON) o scan Proxmox completato. */
export function isNetworkDeviceAcquisitionComplete(d: NetworkDevice): boolean {
  if (d.last_device_info_json?.trim()) return true;
  if (d.last_proxmox_scan_at?.trim() && d.last_proxmox_scan_result?.trim()) return true;
  return false;
}

/** Timestamp ISO da mostrare (preferenza scan Proxmox se presente). */
export function networkDeviceAcquisitionAt(d: NetworkDevice): string | null {
  if (d.last_proxmox_scan_at?.trim()) return d.last_proxmox_scan_at;
  if (d.last_info_update?.trim()) return d.last_info_update;
  if (d.last_device_info_json?.trim()) {
    try {
      const p = JSON.parse(d.last_device_info_json) as { scanned_at?: string };
      if (p.scanned_at?.trim()) return p.scanned_at;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Data/ora compatta per badge (es. 21/03/25, 14:30). */
export function formatAcquisitionBadgeDate(iso: string): string {
  if (!iso.trim()) return "";
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso.slice(0, 16);
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(dt);
  } catch {
    return iso.slice(0, 16);
  }
}

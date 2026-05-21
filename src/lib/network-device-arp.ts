import type { NetworkDevice } from "@/types";

/**
 * True se il dispositivo è una sorgente ARP (router, firewall, switch L3, ecc.).
 *
 * Priorità: il flag esplicito `use_for_arp_poll` (impostato dall'utente nel form
 * "Usa per polling ARP/MAC") prevale. Fallback retrocompatibile per record creati
 * prima dell'introduzione del flag: `device_type === 'router'` o vendor stormshield.
 */
export function networkDeviceUsesArpPoll(
  device: Pick<NetworkDevice, "device_type" | "vendor"> & { use_for_arp_poll?: number | boolean | null }
): boolean {
  if (device.use_for_arp_poll === 1 || device.use_for_arp_poll === true) return true;
  if (device.use_for_arp_poll === 0 || device.use_for_arp_poll === false) return false;
  // Legacy / DB pre-migrazione: usa la logica storica
  return device.device_type === "router" || device.device_type === "firewall" || device.vendor === "stormshield";
}

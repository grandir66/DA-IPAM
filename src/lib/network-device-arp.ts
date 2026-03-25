import type { NetworkDevice } from "@/types";

/**
 * True se il dispositivo usa la tabella ARP (IP-MIB / SSH router client), non solo MAC bridge.
 * Stormshield dalla UI «Firewall» è salvato come device_type `switch` + vendor stormshield.
 */
export function networkDeviceUsesArpPoll(device: Pick<NetworkDevice, "device_type" | "vendor">): boolean {
  return device.device_type === "router" || device.vendor === "stormshield";
}

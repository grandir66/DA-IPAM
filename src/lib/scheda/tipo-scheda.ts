/**
 * Tipo di scheda dell'apparato (21/10): decide quali tab mostra la pagina `/objects/[id]`.
 * Si ricava dalla classificazione canonica e non da `device_type`, che per gli host non-router
 * è un workaround di schema (22 server dell'hub erano `switch`). Modulo puro.
 */
import { canonicalizza } from "@/lib/classification/canonico";

export type TipoScheda =
  | "switch" | "router" | "firewall" | "storage" | "hypervisor"
  | "server_windows" | "server_linux" | "generico" | "host";

export type TabId =
  | "panoramica" | "porte" | "vlan" | "vicini" | "interfacce" | "routing" | "dhcp"
  | "configurazione" | "dischi" | "volumi" | "servizi_nas" | "vm" | "nodi" | "storage_px"
  | "rete_px" | "sistema" | "servizi" | "aggiornamenti" | "software" | "utenti" | "ad"
  | "dipendenze" | "dettagli" | "sicurezza" | "gestione" | "storico";

export interface InputTipoScheda {
  gestito: boolean;
  classification: string | null;
  device_type: string | null;
  vendor: string | null;
  scan_target: string | null;
}

const min = (s: string | null): string => (s ?? "").trim().toLowerCase();

/** Server o VM: la piattaforma decide la scheda (hypervisor, Windows, Linux), altrimenti generico. */
function daServer(vendor: string, scanTarget: string): TipoScheda {
  if (vendor === "stormshield") return "firewall";
  if (scanTarget === "proxmox" || scanTarget === "vmware" || vendor === "proxmox" || vendor === "vmware") return "hypervisor";
  if (vendor === "windows" || scanTarget === "windows") return "server_windows";
  if (vendor === "linux" || scanTarget === "linux") return "server_linux";
  return "generico";
}

export function tipoScheda(i: InputTipoScheda): TipoScheda {
  if (!i.gestito) return "host";
  const canon = canonicalizza(i.classification ? min(i.classification) : null);
  // Uno slug vecchio (server_windows) porta il vendor con sé: vale se la colonna è vuota.
  const vendor = min(i.vendor) || min(canon.vendor);
  const scanTarget = min(i.scan_target);
  const classificazione = canon.classificazione;

  if (classificazione !== "unknown") {
    switch (classificazione) {
      case "switch": return "switch";
      case "router": case "load_balancer": case "vpn_gateway": return "router";
      case "firewall": return "firewall";
      case "nas": return "storage";
      case "hypervisor": return "hypervisor";
      case "server": case "vm": return daServer(vendor, scanTarget);
      default: return "generico";
    }
  }

  // Classificazione assente: ripieghi su device_type come in db-tenant.ts (device_type=switch può
  // nascondere un server/NAS/firewall: il vendor è l'indizio).
  switch (min(i.device_type)) {
    case "router": return "router";
    case "firewall": return "firewall";
    case "hypervisor": return "hypervisor";
    case "nas": return "storage";
    case "server": return daServer(vendor, scanTarget);
    case "switch":
      if (vendor === "windows") return "server_windows";
      if (vendor === "linux") return "server_linux";
      if (vendor === "proxmox" || vendor === "vmware") return "hypervisor";
      if (vendor === "synology" || vendor === "qnap") return "storage";
      if (vendor === "stormshield") return "firewall";
      return "switch";
    default: return "generico";
  }
}

export const TAB_COMUNI: TabId[] = ["sicurezza", "gestione", "storico"];

/** Tab del tipo. Ogni task di tipo (T3-T7) sostituisce la sua riga; per ora: panoramica + dettagli + comuni. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- le opzioni servono ai task di tipo T3-T7
export function tabDelTipo(t: TipoScheda, _o: { ruoli: string[]; haAd: boolean; haDipendenze: boolean }): TabId[] {
  if (t === "host") return ["panoramica", "sicurezza", "storico"];
  return ["panoramica", "dettagli", ...TAB_COMUNI];
}

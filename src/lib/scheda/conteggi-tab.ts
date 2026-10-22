/**
 * Numeri accanto al nome delle tab (22/10, tavole Switch · Firewall · MkPanoramica: «Porte 52», «Vicini e MAC 6 · 214»).
 * Solo da dati che la pagina ha già caricato (nessuna richiesta per un numero): se il dato non c'è, o è vuoto,
 * la tab resta col nome e basta. Mai uno «0» inventato. Modulo puro.
 */
import type { DeviceFull } from "@/components/scheda/dati";
import type { RispostaDipendenze } from "@/lib/devices/server-scheda";
import type { TabId, TipoScheda } from "./tipo-scheda";
import { vlanDistinte, type PortaSwitch } from "./porte-da-guardare";
import { numeroVm, poolStorage } from "./hypervisor";
import { alloggiamenti, riepilogoDischi, volumiNas } from "./nas";

export interface DatiConteggio {
  device: DeviceFull | null;
  dipendenze: RispostaDipendenze | null;
}

const num = (n: number): string | null => (n > 0 ? String(n) : null);

/** «a · b» con le sole parti > 0. */
function coppia(a: number, b: number): string | null {
  const parti = [a, b].filter((x) => x > 0).map(String);
  return parti.length > 0 ? parti.join(" · ") : null;
}

/** Vicini LLDP/CDP: la rotta ripete la riga per ogni MAC dietro la porta, qui una per (porta, nome, porta remota) — come la tabella. */
function contaVicini(device: DeviceFull): number {
  const visti = new Set<string>();
  for (const n of device.neighbors ?? []) {
    const nome = (n.remote_device_name ?? "").trim() || n.remote_mac || n.remote_ip || "";
    if (nome) visti.add(`${n.local_port}|${nome}|${n.remote_port ?? ""}`);
  }
  return visti.size;
}

export function conteggioTab(tipo: TipoScheda, tab: TabId, { device, dipendenze }: DatiConteggio): string | null {
  if (tab === "dipendenze") return num(dipendenze?.servizi?.length ?? 0);
  if (!device) return null;
  switch (tipo) {
    case "switch":
      if (tab === "porte") return num(device.switch_ports?.length ?? 0);
      // Le VLAN lette via Q-BRIDGE se ci sono (Task 11 accorpamento), altrimenti quelle dei PVID di switch_ports.
      if (tab === "vlan") return num((device.switch_vlan_n ?? 0) > 0 ? device.switch_vlan_n! : vlanDistinte((device.switch_ports ?? []) as unknown as PortaSwitch[]).length);
      if (tab === "vicini") return coppia(contaVicini(device), device.mac_port_entries?.length ?? 0);
      return null;
    case "router":
    case "firewall":
      if (tab === "routing") return coppia(device.routes?.length ?? 0, device.arp_entries?.length ?? 0);
      if (tab === "bridge") return num(device.mikrotik?.bridge ?? 0);
      return null;
    case "hypervisor": {
      const px = device.proxmox_data ?? null;
      if (!px) return null;
      if (tab === "vm") return num(numeroVm(px));
      if (tab === "nodi") return num(px.hosts?.length ?? 0);
      if (tab === "storage_px") return num(poolStorage(px).length);
      return null;
    }
    case "storage": {
      const nas = device.device_info?.nas_inventory ?? null;
      if (!nas) return null;
      if (tab === "dischi") return num(riepilogoDischi(alloggiamenti(nas.snmp?.disks, nas.vendor)).presenti);
      if (tab === "volumi") return num(volumiNas(nas).length);
      if (tab === "servizi_nas") return num(nas.snmp?.services?.length ?? 0);
      return null;
    }
    default:
      return null;
  }
}

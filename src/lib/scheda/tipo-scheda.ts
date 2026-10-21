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
  | "dipendenze" | "dettagli" | "sicurezza" | "gestione" | "storico" | "bridge" | "dispositivi";

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
      // Slug «di sistema» non canonici (DA-VEEAM: classificazione `windows`): è un server, non una stampante.
      // Una postazione (`workstation`) col vendor windows resta generico: non passa di qui.
      case "windows": case "linux": {
        const r = daServer(vendor, scanTarget);
        return r !== "generico" ? r : classificazione === "windows" ? "server_windows" : "server_linux";
      }
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

/** Cosa serve a `tabDelTipo` oltre al tipo. */
export interface OpzioniTab {
  ruoli: string[];
  haAd: boolean;
  haDipendenze: boolean;
  /** Router o firewall MikroTik letto via SSH; null per ogni altro apparato. `haBridge` = almeno un bridge nell'ultima lettura. */
  mikrotik: { haBridge: boolean } | null;
}

export const TAB_COMUNI: TabId[] = ["sicurezza", "gestione", "storico"];

/**
 * Tab del tipo. `Active Directory` solo per un server Windows con ruolo DC **e** dati AD (`haAd`); `Dipendenze`
 * solo se qualche servizio poggia sull'host (`haDipendenze`). Solo il tipo `generico` tiene «Dettagli» (non ha tab sue).
 */
export function tabDelTipo(t: TipoScheda, o: OpzioniTab): TabId[] {
  // Host non gestito: «Gestione» ridotta (classificazione, inventario, note, asset NIS2), senza credenziali.
  if (t === "host") return ["panoramica", "sicurezza", "gestione", "storico"];
  if (t === "switch") return ["panoramica", "porte", "vlan", "vicini", ...TAB_COMUNI];
  if ((t === "router" || t === "firewall") && o.mikrotik) {
    // MikroTik via SSH: VLAN e Bridge solo se l'ultima lettura ha almeno un bridge; Dispositivi (ARP + DHCP + vicini) sempre.
    return ["panoramica", "interfacce", ...(o.mikrotik.haBridge ? (["vlan", "bridge"] as TabId[]) : []), "routing", "dhcp", "dispositivi", "configurazione", ...TAB_COMUNI];
  }
  if (t === "router" || t === "firewall") return ["panoramica", "interfacce", "routing", "dhcp", "configurazione", ...TAB_COMUNI];
  if (t === "storage") return ["panoramica", "dischi", "volumi", "servizi_nas", ...TAB_COMUNI];
  if (t === "hypervisor") return ["panoramica", "vm", "nodi", "storage_px", "rete_px", ...TAB_COMUNI];
  if (t === "server_windows") {
    return [
      "panoramica", "sistema", "servizi", "aggiornamenti", "software", "utenti",
      ...(o.ruoli.includes("dc") && o.haAd ? (["ad"] as TabId[]) : []),
      ...(o.haDipendenze ? (["dipendenze"] as TabId[]) : []),
      ...TAB_COMUNI,
    ];
  }
  if (t === "server_linux") {
    return [
      "panoramica", "sistema", "servizi", "aggiornamenti", "utenti",
      ...(o.haDipendenze ? (["dipendenze"] as TabId[]) : []),
      ...TAB_COMUNI,
    ];
  }
  return ["panoramica", "dettagli", ...TAB_COMUNI];
}

/**
 * Riquadro «Rete e SNMP» della tab Gestione: mostra solo ciò che le tab del tipo non mostrano già.
 * SNMP: in Configurazione (router/firewall), in Sistema (server), in Dettagli (generico). IP collegati e «Sulla
 * mappa»: in Vicini e MAC (switch), Interfacce (router/firewall), Rete (hypervisor), Dettagli (generico).
 */
export function bloccoReteGestione(t: TipoScheda): { snmp: boolean; ipMappa: boolean } {
  switch (t) {
    case "switch": return { snmp: true, ipMappa: false };
    case "router": case "firewall": case "generico": return { snmp: false, ipMappa: false };
    case "hypervisor": return { snmp: true, ipMappa: false };
    case "server_windows": case "server_linux": return { snmp: false, ipMappa: true };
    default: return { snmp: true, ipMappa: true }; // storage, host
  }
}

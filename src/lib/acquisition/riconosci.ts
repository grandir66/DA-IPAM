/**
 * Quale collector del catalogo legge un apparato, dal prodotto riconosciuto (decisione 4 della tavola C1: la fonte si
 * ricava da sola). Puro: nessun DB, nessuna rete. Restituisce i collector possibili: zero = nessun collector (si usa
 * l'acquisizione di sempre), uno = fonte certa, due o più = caso dubbio (lo sceglie una persona).
 * Regole nell'ordine: profilo prodotto e sottotipo scelti a mano, poi il testo letto (sysDescr, modello). Un prodotto
 * che il catalogo non legge (AOS-CX, vCenter, iLO, EdgeRouter, console UniFi) non riceve mai un collector «vicino».
 */
import type { CollectorId } from "./catalogo";

export interface ApparatoDaRiconoscere {
  vendor: string | null;
  vendor_subtype?: string | null;
  device_type?: string | null;
  product_profile?: string | null;
  scan_target?: string | null;
  model?: string | null;
  sysdescr?: string | null;
}

export function collectorPossibili(a: ApparatoDaRiconoscere): CollectorId[] {
  const vendor = (a.vendor ?? "").toLowerCase();
  const profilo = a.product_profile ?? "";
  const testo = `${a.sysdescr ?? ""} ${a.model ?? ""}`;

  if (vendor === "hp") {
    if (profilo === "hp_server_ilo" || profilo === "hp_stampante") return [];
    if (/AOS-CX|ArubaOS-CX/i.test(testo)) return [];
    if (profilo === "hp_switch_procurve" || a.vendor_subtype === "procurve") return ["hp-procurve"];
    if (profilo === "hp_switch_comware" || a.vendor_subtype === "comware") return ["hp-comware"];
    if (/comware/i.test(testo)) return ["hp-comware"];
    if (/procurve|ArubaOS|\bJL?\d{3,4}[A-Z]\b|\baruba\b/i.test(testo)) return ["hp-procurve"];
    // «ArubaOS» scelto senza un sysDescr che lo dica: ArubaOS-Switch (ProCurve) o AOS-CX (nessun collector)? Si lascia
    // all'acquisizione di sempre, che legge il sysDescr: dal giro dopo la regola sopra decide.
    if (profilo === "hp_switch_arubaos") return [];
    return a.device_type === "switch" ? ["hp-procurve", "hp-comware"] : [];
  }
  if (vendor === "qnap") {
    if (profilo === "qnap_storage" || /\bQTS\b|QuTS/i.test(testo)) return ["qnap-nas"];
    if (profilo === "qnap_router") return [];
    return profilo === "qnap_switch" || a.device_type === "switch" || /^QSW/i.test(a.model ?? "") || /\bQSS\b/.test(testo) ? ["qnap-switch"] : [];
  }
  if (vendor === "vmware" || a.scan_target === "vmware" || profilo === "vmware_vsphere") {
    return /vcenter/i.test(testo) ? [] : ["vmware-esxi"];
  }
  // Famiglie collaudate in locale. `unifi-controller` (console, non un apparato: si legge dalla CLI, nessuna regola chiara per
  // agganciarlo al pulsante di un apparato) non entra qui. `proxmox-ve` neppure (giro 5, decisione 3): legge meno della scansione
  // Proxmox di oggi (niente VM e CT), quindi il pulsante resta alla scansione storica finché non c'è la parità.
  if (vendor === "windows") return ["windows"];
  // Un host Linux che è un hypervisor Proxmox resta alla scansione Proxmox: qui sarebbe un server qualunque.
  if (vendor === "linux") return a.device_type === "hypervisor" || a.scan_target === "proxmox" ? [] : ["linux"];
  if (vendor === "synology") return ["synology-dsm"];
  if (vendor === "mikrotik") return profilo === "mikrotik_other" || /\bSwOS\b/i.test(testo) ? [] : ["mikrotik-routeros"];
  if (vendor === "ubiquiti") return ["ubiquiti_access_point", "ubiquiti_switch_managed", "ubiquiti_switch_base"].includes(profilo) ? ["ubiquiti-device"] : [];
  if (/\bnetapp\b|\bontap\b/i.test(testo)) return ["netapp-ontap"];
  return [];
}

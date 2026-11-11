/**
 * Fisico o virtuale, come attributo a sé (Riccardo, 11/11/2026: «VM server Windows, VM server Linux… potrebbero
 * essere VM client o VDI»). Una macchina virtuale può essere un server o una postazione: «virtuale» non è una
 * categoria e non la decide. Sul cliente 70791, 26 server su 28 sono virtuali e non si vedeva.
 *
 * Si legge dalla scheda di rete (i prefissi MAC che gli hypervisor assegnano), dal produttore e dal modello.
 * «Fisico» si dice solo con un produttore di scheda vero: con un MAC casuale, o senza produttore, non si sa.
 * Modulo puro.
 */
export type Forma = "virtuale" | "fisico";

export const FORME: ReadonlyArray<{ valore: Forma; etichetta: string }> = [
  { valore: "fisico", etichetta: "Fisico" },
  { valore: "virtuale", etichetta: "Virtuale" },
];

export function etichettaForma(f: Forma | null): string | null {
  return FORME.find((x) => x.valore === f)?.etichetta ?? null;
}

export interface HostPerForma {
  mac?: string | null;
  /** Il produttore della scheda di rete, dal MAC. */
  vendor?: string | null;
  model?: string | null;
  attr_category?: string | null;
  classification?: string | null;
}

/** Prefissi che gli hypervisor danno alle schede delle loro macchine: VMware, QEMU/KVM, Proxmox, Hyper-V, Xen, VirtualBox, Parallels. */
const PREFISSI_VIRTUALI = ["005056", "000C29", "000569", "001C14", "525400", "BC2411", "00155D", "00163E", "080027", "001C42"];
/** «Microsoft» da solo non basta: è anche il produttore di Surface e Xbox. Hyper-V si riconosce dal prefisso 00:15:5D. */
const PRODUTTORE_VIRTUALE = /vmware|qemu|proxmox|xensource|virtualbox|parallels|nutanix|red ?hat.*(kvm|virt)|microsoft.*(virtual|hyper)/i;
const MODELLO_VIRTUALE = /virtual machine|vmware|virtualbox|\bkvm\b|qemu|hyper-v|standard pc \(/i;

function esa(mac: string | null | undefined): string {
  return (mac ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

function macCasuale(hex: string): boolean {
  return hex.length === 12 && "26AE".includes(hex[1]);
}

/**
 * Virtuale, fisico, o null se non si sa.
 *
 * Conta il produttore della SCHEDA (`vendor`, dal MAC), non quello del prodotto (`attr_vendor_name`,
 * `device_manufacturer`): la prima misura sul 70791 dava «virtuali» 15 host Proxmox fisici, perché il loro
 * prodotto si chiama Proxmox mentre la scheda è di un produttore vero. Per lo stesso motivo un hypervisor non
 * diventa virtuale per il nome del modello: lo è solo se la sua scheda ha un prefisso da macchina virtuale.
 */
export function formaDi(h: HostPerForma): Forma | null {
  const hex = esa(h.mac);
  if (hex.length === 12 && PREFISSI_VIRTUALI.includes(hex.slice(0, 6))) return "virtuale";
  const scheda = (h.vendor ?? "").trim();
  if (scheda && PRODUTTORE_VIRTUALE.test(scheda)) return "virtuale";
  const hypervisor = h.classification === "hypervisor" || h.attr_category === "compute.hypervisor";
  if (!hypervisor && MODELLO_VIRTUALE.test(h.model ?? "")) return "virtuale";
  if (h.attr_category === "compute.vm" || h.classification === "vm") return "virtuale";
  // Fisico solo con una scheda di un produttore vero: un MAC casuale non ha produttore, e senza MAC non si sa.
  if (hex.length === 12 && !macCasuale(hex) && scheda !== "") return "fisico";
  return null;
}

/** Filtro: vuoto = tutti; `__ignoto__` = quelli di cui non si sa; altrimenti la forma. */
export const FORMA_IGNOTA = "__ignoto__";

export function passaFiltroForma(filtro: string | null | undefined, h: HostPerForma): boolean {
  if (!filtro) return true;
  const f = formaDi(h);
  return filtro === FORMA_IGNOTA ? f == null : f === filtro;
}

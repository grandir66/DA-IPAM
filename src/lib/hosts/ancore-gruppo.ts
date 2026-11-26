/**
 * Che cosa vale come ancora per dire «queste righe sono lo stesso apparato» (Riccardo, 12/11/2026). Su DTS quattro
 * MikroTik diversi erano un gruppo solo, perché tutti portavano come seriale «F2510000.USB3» (la porta USB, non
 * l'apparato); e le righe con lo stesso MAC vero su reti diverse restavano fuori, perché il MAC non era un'ancora.
 * Modulo puro, usato dal motore dei gruppi in db-tenant.ts e in db.ts.
 */
import { eSerialeFinto } from "@/lib/devices/seriale-valido";
import { nomeGenerico } from "./nomi-generici";

/** Tetto alle righe unite dallo stesso MAC: oltre, è più facile un MAC di passaggio che un apparato. */
export const MAX_RIGHE_STESSO_MAC_GRUPPO = 16;

/** Il seriale, in maiuscolo, se può unire delle righe; altrimenti `null`. */
export function serialeAncora(valore: string | null | undefined): string | null {
  const s = (valore ?? "").trim().toUpperCase();
  if (s.length < 4 || eSerialeFinto(s)) return null;
  return s;
}

/** MAC virtuali condivisi fra apparati diversi: VRRP (00:00:5E:00:01/02), HSRP (00:00:0C:07:AC, 00:00:0C:9F:F). */
const MAC_CONDIVISO = /^(00:00:5E:00:0[12]:|00:00:0C:07:AC:|00:00:0C:9F:F)/;

/** Il MAC, in maiuscolo, se identifica una scheda vera; `null` se casuale, virtuale condiviso o vuoto. */
export function macAncora(valore: string | null | undefined): string | null {
  const m = (valore ?? "").trim().toUpperCase().replace(/-/g, ":");
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(m)) return null;
  if (m === "00:00:00:00:00:00" || m === "FF:FF:FF:FF:FF:FF") return null;
  // Secondo carattere 2, 6, A, E: indirizzo amministrato in locale (MAC casuale dei telefoni, schede virtuali).
  if ("26AE".includes(m[1])) return null;
  if (MAC_CONDIVISO.test(m)) return null;
  return m;
}

/**
 * Un nome o un seriale che unisce righe con tanti MAC veri diversi non è un apparato: è un modello («SIP-T23G» su
 * diciotto telefoni, DTS 12/11/2026). Un apparato con più schede ne ha poche rispetto alle righe (un router con
 * dodici indirizzi ne aveva due). `macVeri` = i MAC d'ancora (`macAncora`) delle righe unite, coi doppioni.
 */
export function ancoraDiModello(righe: number, macVeri: readonly string[]): boolean {
  const diversi = new Set(macVeri).size;
  return diversi >= 3 && diversi >= righe * 0.75;
}

/**
 * Un seriale che unisce un nome di serie («Mac», «iPhone») e un nome distintivo («NB-MAX») non è dello stesso apparato:
 * sul 70791 il 23/11/2026 il gruppo `ea89883e…` metteva insieme NB-MAX e quattro righe «Mac» per un seriale condiviso.
 */
export function serialeConNomiMisti(nomi: readonly (string | null | undefined)[]): boolean {
  const corti = new Set(nomi.map((n) => (n ?? "").trim().toLowerCase().split(".")[0]).filter((n) => n.length > 0));
  let generici = 0;
  let distintivi = 0;
  for (const n of corti) {
    if (nomeGenerico(n)) generici++;
    else distintivi++;
  }
  return generici > 0 && distintivi > 0;
}

export interface MetaPrincipale { has_device: number; ip: string; status: string | null; last_seen: string | null }

/**
 * Chi rappresenta un gruppo (riga principale e unica riga di Apparati). Riccardo, 23/11/2026: «se lo stesso pc cambia
 * ip dovrebbe riaggiornare i dati… senza avere una moltiplicazione di oggetti». Prima l'apparato gestito (concentra
 * credenziali e storia); poi la riga viva, cioè online e vista più di recente (per giorno: due righe vive nello stesso
 * giorno non si scambiano a ogni scansione); a parità, l'IP più basso, come prima.
 */
export function confrontaPrincipale(a: MetaPrincipale, b: MetaPrincipale, ipNum: (ip: string) => number): number {
  if (a.has_device !== b.has_device) return b.has_device - a.has_device;
  const viva = (m: MetaPrincipale) => (m.status === "online" ? 1 : 0);
  if (viva(a) !== viva(b)) return viva(b) - viva(a);
  const giorno = (m: MetaPrincipale) => (m.last_seen ?? "").slice(0, 10);
  if (giorno(a) !== giorno(b)) return giorno(a) < giorno(b) ? 1 : -1;
  return ipNum(a.ip) - ipNum(b.ip);
}

/**
 * Che cosa vale come ancora per dire «queste righe sono lo stesso apparato» (Riccardo, 12/11/2026). Su DTS quattro
 * MikroTik diversi erano un gruppo solo, perché tutti portavano come seriale «F2510000.USB3» (la porta USB, non
 * l'apparato); e le righe con lo stesso MAC vero su reti diverse restavano fuori, perché il MAC non era un'ancora.
 * Modulo puro, usato dal motore dei gruppi in db-tenant.ts e in db.ts.
 */
import { eSerialeFinto } from "@/lib/devices/seriale-valido";

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

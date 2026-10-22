/**
 * Vicino LLDP/CDP/MNDP ↔ host di IPAM (22/10). Modulo puro: la mappa IP/MAC → host la costruisce
 * `viciniConHost` (db-tenant.ts) con la stessa restrizione della tab «Dispositivi»; qui si abbina un vicino:
 * prima per IP, poi per MAC.
 */
export interface MappaViciniIpam {
  ip: Record<string, number>;
  mac: Record<string, number>;
}

/** 12 cifre esadecimali maiuscole, null se il MAC non è ben formato. */
export function chiaveMac(mac: string | null | undefined): string | null {
  const hex = (mac ?? "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  return hex.length === 12 ? hex : null;
}

/**
 * - `{ hostId }`: il vicino è un host di IPAM (si collega a `/objects/<hostId>`);
 * - `"assente"`: ha un IP o un MAC e nessun host corrisponde (→ «non in IPAM»);
 * - `null`: non si può dire (né IP né MAC): niente etichetta.
 */
export function abbinaVicino(v: { ip?: string | null; mac?: string | null }, mappa: MappaViciniIpam): { hostId: number } | "assente" | null {
  const ip = (v.ip ?? "").trim();
  const mac = chiaveMac(v.mac);
  if (ip === "" && mac === null) return null;
  if (ip !== "" && Object.hasOwn(mappa.ip, ip)) return { hostId: mappa.ip[ip] };
  if (mac !== null && Object.hasOwn(mappa.mac, mac)) return { hostId: mappa.mac[mac] };
  return "assente";
}

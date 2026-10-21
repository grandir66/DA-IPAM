/**
 * I MAC virtuali dei protocolli di ridondanza: passano da un router all'altro e non identificano nessun apparato.
 * Elenco unico (S3 del piano collector modulari, 21/10): prima `physical-device-db.ts` e `topology/identity.ts`
 * ne avevano uno ciascuno, diversi. Logica pura, niente DB: la usa anche il modello della mappa.
 */

const PREFISSI_VIRTUALI = [
  /^00:00:5e:00:01:/, // VRRP v2/v3 IPv4 (anche CARP)
  /^00:00:5e:00:02:/, // VRRP v3 IPv6
  /^00:00:0c:07:ac:/, // HSRP v1
  /^00:00:0c:9f:f/, // HSRP v2
  /^00:05:73:a0:/, // HSRP IPv6
  /^00:07:b4:00:/, // GLBP
];

/** Un MAC in forma `aa:bb:cc:dd:ee:ff` minuscola. Regge due punti, trattini, punti Cisco (`aabb.ccdd.eeff`) e la forma nuda. */
export function normalizeMac(mac: string | null | undefined): string | null {
  if (!mac) return null;
  const cifre = mac.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (cifre.length !== 12) return null;
  return cifre.match(/.{2}/g)!.join(":");
}

/** Il bit «amministrato localmente» non conta: molte schede vere lo usano (VM, cloud, MAC casuali). */
export function isVirtualMac(mac: string | null | undefined): boolean {
  const n = normalizeMac(mac);
  return n !== null && PREFISSI_VIRTUALI.some((r) => r.test(n));
}

/**
 * Reti viste dal sensore trunk e non ancora in DA-IPAM: le proposte da confermare.
 *
 * Riccardo (09/11/2026): all'avvio «la costruzione automatica delle network viste» — e, alla
 * domanda se crearle da sole, «proposte da confermare». Qui si calcola solo l'elenco; la
 * conferma resta il clic su «Porta in DA-IPAM» (`aggiungiReteDalTrunk`), che crea la rete,
 * fa il giro ARP sulla VLAN e porta dentro gli host.
 */
import { getTrunkMatrice, trunkLetturaAttiva, type TrunkReteMatrice } from "@/lib/trunk/sensore-trunk";
import { ipNumero } from "@/lib/trunk/reti";
import type { TrunkMaschera } from "@/lib/trunk/reti";

export interface ReteProposta {
  vid: number;
  cidr: string;
  gateway_ip: string | null;
  fonte: string | null;
  maschera: TrunkMaschera;
  /** Indirizzi visti dal sensore in questa rete. */
  ip: number;
  /** Ultimo giorno con indirizzi attivi, dalla serie del sensore (ultimi 14 giorni). */
  ultimoGiorno: string | null;
}

function intervallo(cidr: string): [number, number] | null {
  const [ip, pref] = cidr.split("/");
  const p = Number(pref);
  if (!ip || !Number.isInteger(p) || p < 0 || p > 32) return null;
  const n = ipNumero(ip);
  if (!Number.isFinite(n)) return null;
  const dim = 2 ** (32 - p);
  const base = Math.floor(n / dim) * dim;
  return [base, base + dim - 1];
}

/** Vero se le due reti hanno indirizzi in comune (una contiene l'altra o coincidono). */
export function siSovrappongono(a: string, b: string): boolean {
  const x = intervallo(a);
  const y = intervallo(b);
  if (!x || !y) return false;
  return x[0] <= y[1] && y[0] <= x[1];
}

/** Le reti viste che non si sovrappongono a nessuna rete di DA-IPAM. Pura: si prova senza DB. */
export function filtraProposte(viste: TrunkReteMatrice[], retiIpam: string[]): ReteProposta[] {
  return viste
    .filter((r) => !r.cidr.startsWith("169.254.") && !retiIpam.some((c) => siSovrappongono(c, r.cidr)))
    .map((r) => {
      const attivi = r.serie.filter((g) => g.attivi > 0);
      const ultimo = attivi.length > 0 ? attivi[attivi.length - 1].giorno : null;
      return { vid: r.vid, cidr: r.cidr, gateway_ip: r.gateway_ip, fonte: r.fonte, maschera: r.maschera, ip: r.ip.length, ultimoGiorno: ultimo };
    })
    .sort((a, b) => b.ip - a.ip);
}

/** Le proposte del tenant corrente; vuoto se il sensore trunk non è letto. */
export function retiProposte(retiIpam: string[]): ReteProposta[] {
  if (!trunkLetturaAttiva()) return [];
  return filtraProposte(getTrunkMatrice(14).reti, retiIpam);
}

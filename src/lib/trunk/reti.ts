/**
 * Reti del sensore trunk con la loro maschera (25/10, opzione B della pagina).
 *
 * Senza DHCP il sensore deduce la rete tagliando a /24 ogni IP visto: una /22 diventa
 * quattro /24. Qui i /24 vicini della stessa VLAN con lo stesso gateway si uniscono nella
 * rete più piccola che li contiene. La maschera porta da dove viene:
 *  - `dhcp`     annunciata dal DHCP (certa);
 *  - `dedotta`  /24 consecutivi uniti, o un /24 solo;
 *  - `incerta`  /24 sparsi: la rete li copre ma va confermata;
 *  - `config`   scritta a mano (impostazioni del sensore o correzione dalla pagina).
 * Funzioni pure: niente DB, così si provano da sole.
 */

import type { TrunkRete } from "@/lib/trunk/sensore-trunk";

export type TrunkMaschera = "dhcp" | "dedotta" | "incerta" | "config";

export interface TrunkReteUnita {
  vid: number;
  cidr: string;
  gateway_ip: string | null;
  fonte: string | null;
  maschera: TrunkMaschera;
  /** Le reti del sensore che sono finite qui dentro (più di una = unite). */
  blocchi: string[];
  /** La rete com'era dedotta prima di una correzione a mano: chiave della correzione. */
  dedotta: string;
}

/** Più larga di così non si unisce: oltre /16 è più facile che siano reti diverse. */
const PREFISSO_MINIMO = 16;

export function ipNumero(ip: string): number {
  return ip.split(".").reduce((a, p) => a * 256 + (Number(p) || 0), 0);
}

export function numeroIp(n: number): string {
  return [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255].join(".");
}

function parti(cidr: string): { base: number; prefisso: number } {
  const [ip, p] = cidr.split("/");
  const prefisso = Math.min(Math.max(Number(p) || 32, 0), 32);
  const dim = 2 ** (32 - prefisso);
  return { base: Math.floor(ipNumero(ip) / dim) * dim, prefisso };
}

/** La rete con quel prefisso che contiene l'indirizzo. */
export function reteDi(ip: string, prefisso: number): string {
  const dim = 2 ** (32 - prefisso);
  return `${numeroIp(Math.floor(ipNumero(ip) / dim) * dim)}/${prefisso}`;
}

function contiene(esterna: string, interna: string): boolean {
  const e = parti(esterna);
  const i = parti(interna);
  if (i.prefisso < e.prefisso) return false;
  const dim = 2 ** (32 - e.prefisso);
  return Math.floor(i.base / dim) === e.base / dim;
}

/** La rete più piccola che contiene tutte quelle date. */
function contenitore(reti: string[]): string {
  const p = reti.map(parti);
  const min = Math.min(...p.map((x) => x.base));
  const max = Math.max(...p.map((x) => x.base + 2 ** (32 - x.prefisso) - 1));
  let prefisso = Math.min(...p.map((x) => x.prefisso));
  while (prefisso > 0 && Math.floor(min / 2 ** (32 - prefisso)) !== Math.floor(max / 2 ** (32 - prefisso))) prefisso--;
  return reteDi(numeroIp(min), prefisso);
}

/** Consecutivi = nessun buco fra il primo e l'ultimo blocco. */
function consecutivi(reti: string[]): boolean {
  const p = reti.map(parti).sort((a, b) => a.base - b.base);
  return p.every((x, i) => i === 0 || p[i - 1].base + 2 ** (32 - p[i - 1].prefisso) === x.base);
}

/**
 * Le reti di una VLAN come le dà il sensore → le reti da mostrare. `correzioni` mappa
 * `vid|rete dedotta` sul prefisso scritto a mano.
 */
export function unisciReti(vid: number, reti: TrunkRete[], correzioni: Record<string, number> = {}): TrunkReteUnita[] {
  const certe = reti.filter((r) => r.fonte === "dhcp" || r.fonte === "config");
  // Un /24 dedotto che sta già dentro una rete certa non è una rete a sé.
  const dedotte = reti.filter((r) => !certe.includes(r) && !certe.some((c) => contiene(c.cidr, r.cidr)));
  const out: TrunkReteUnita[] = certe.map((r) => ({
    vid, cidr: r.cidr, gateway_ip: r.gateway_ip ?? null, fonte: r.fonte ?? null,
    maschera: r.fonte === "dhcp" ? "dhcp" : "config", blocchi: [r.cidr], dedotta: r.cidr,
  }));
  const perGateway = new Map<string, TrunkRete[]>();
  for (const r of dedotte) {
    const k = r.gateway_ip ?? "";
    perGateway.set(k, [...(perGateway.get(k) ?? []), r]);
  }
  for (const gruppo of perGateway.values()) {
    const cidr = gruppo.map((r) => r.cidr);
    const unita = contenitore(cidr);
    const largaTroppo = parti(unita).prefisso < PREFISSO_MINIMO;
    // Senza gateway comune e coi blocchi sparsi è più probabile che siano reti diverse.
    const separa = largaTroppo || (gruppo.length > 1 && !gruppo[0].gateway_ip && !consecutivi(cidr));
    const pezzi = separa ? gruppo.map((r) => [r]) : [gruppo];
    for (const pezzo of pezzi) {
      const c = pezzo.map((r) => r.cidr).sort((a, b) => parti(a).base - parti(b).base);
      const rete = contenitore(c);
      const gw = pezzo.find((r) => r.gateway_ip)?.gateway_ip ?? null;
      out.push({
        vid, cidr: rete, gateway_ip: gw, fonte: pezzo[0].fonte ?? null,
        maschera: c.length === 1 || consecutivi(c) ? "dedotta" : "incerta", blocchi: c, dedotta: rete,
      });
    }
  }
  for (const r of out) {
    const p = correzioni[`${vid}|${r.dedotta}`];
    if (p == null || r.maschera === "dhcp") continue;
    r.cidr = reteDi(r.gateway_ip ?? r.dedotta.split("/")[0], p);
    r.maschera = "config";
  }
  return out.sort((a, b) => parti(a.cidr).base - parti(b.cidr).base);
}

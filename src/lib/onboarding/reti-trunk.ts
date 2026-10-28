/**
 * Le reti viste dal sensore trunk proposte nel wizard di prima configurazione
 * (Riccardo, 28/10): «oltre alla network nativa devono essere presentate tutte
 * quelle rilevate, con l'opzione di aggiungerle fornendo il nome e correggendo
 * eventuali informazioni». Prima si passava dalla pagina «Reti dal trunk» dopo
 * il wizard, una rete alla volta.
 *
 * Modulo puro: riceve le reti del trunk (già unite per maschera, come nella
 * pagina) e le reti di DA-IPAM, e dice per ognuna se si può aggiungere. La
 * lettura vera sta in `reti-trunk-server.ts`, la creazione nella rotta.
 */
import { ipNumero } from "@/lib/trunk/reti";
import type { TrunkMaschera } from "@/lib/trunk/reti";

export interface ReteTrunkVista {
  vid: number;
  cidr: string;
  gateway_ip: string | null;
  maschera: TrunkMaschera;
  /** IP visti parlare in quella rete. */
  dispositivi: number;
}

export interface ReteEsistente {
  id: number;
  name: string;
  cidr: string;
}

export interface PropostaTrunk {
  /** `vid|cidr`: identifica la riga nel wizard. */
  chiave: string;
  vid: number;
  cidr: string;
  gateway: string | null;
  maschera: TrunkMaschera;
  dispositivi: number;
  nome: string;
  /** La rete c'è già in DA-IPAM (o si sovrappone a una): non si ricrea. */
  esistente: { id: number; name: string } | null;
}

function intervallo(cidr: string): [number, number] | null {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr.trim());
  if (!m) return null;
  const prefisso = Number(m[2]);
  if (prefisso > 32) return null;
  const dim = 2 ** (32 - prefisso);
  const base = Math.floor(ipNumero(m[1]) / dim) * dim;
  return [base, base + dim - 1];
}

/** Due reti si sovrappongono se hanno almeno un indirizzo in comune. */
export function siSovrappongono(a: string, b: string): boolean {
  const x = intervallo(a);
  const y = intervallo(b);
  if (!x || !y) return false;
  return x[0] <= y[1] && y[0] <= x[1];
}

/** Il nome di partenza: lo stesso della pagina «Reti dal trunk». */
export function nomeProposto(vid: number, cidr: string): string {
  return vid === 0 ? `VLAN nativa ${cidr}` : `VLAN ${vid}`;
}

/**
 * Le proposte del wizard. Si tolgono quelle che coincidono con la rete
 * nativa, perché il wizard la propone già sopra (`reteNativa`, il CIDR
 * dell'appliance o della rete già creata). Le altre già presenti in DA-IPAM
 * restano in elenco, segnate, così si vede che il trunk le conosce.
 * Ordine: prima le VLAN con più dispositivi, la nativa del trunk per prima.
 */
export function proposteTrunk(
  reti: readonly ReteTrunkVista[],
  esistenti: readonly ReteEsistente[],
  reteNativa: string | null,
): PropostaTrunk[] {
  const nativa = reteNativa?.trim() || null;
  const out: PropostaTrunk[] = [];
  const chiavi = new Set<string>();
  for (const r of reti) {
    const chiave = `${r.vid}|${r.cidr}`;
    if (chiavi.has(chiave)) continue;
    chiavi.add(chiave);
    if (nativa && siSovrappongono(r.cidr, nativa)) continue;
    const gia = esistenti.find((e) => siSovrappongono(e.cidr, r.cidr)) ?? null;
    out.push({
      chiave,
      vid: r.vid,
      cidr: r.cidr,
      gateway: r.gateway_ip,
      maschera: r.maschera,
      dispositivi: r.dispositivi,
      nome: nomeProposto(r.vid, r.cidr),
      esistente: gia ? { id: gia.id, name: gia.name } : null,
    });
  }
  return out.sort((a, b) => (a.vid === 0 ? -1 : 0) - (b.vid === 0 ? -1 : 0) || b.dispositivi - a.dispositivi || a.vid - b.vid);
}

/** Una riga scelta nel wizard, come la manda il browser. */
export interface SceltaTrunk {
  vid: number;
  cidr: string;
  gateway: string;
  nome: string;
}

/**
 * Le righe scelte che non vanno: nome vuoto, rete scritta male, gateway fuori
 * dalla rete, due righe che si sovrappongono fra loro o con la rete nativa.
 * Restituisce un messaggio per riga (stessa posizione), null se va bene.
 */
export function erroriScelte(scelte: readonly SceltaTrunk[], reteNativa: string | null): (string | null)[] {
  return scelte.map((s, i) => {
    if (!s.nome.trim()) return "manca il nome";
    const r = intervallo(s.cidr);
    if (!r) return "rete non valida (es. 192.168.20.0/24)";
    const prefisso = Number(s.cidr.split("/")[1]);
    if (prefisso < 16 || prefisso > 30) return "maschera fuori misura: da /16 a /30";
    if (ipNumero(s.cidr.split("/")[0]) !== r[0]) return `la rete comincia da ${s.cidr.split("/")[0]}: scrivi l'indirizzo di rete`;
    const gw = s.gateway.trim();
    if (gw) {
      if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(gw)) return "gateway non valido";
      const n = ipNumero(gw);
      if (n < r[0] || n > r[1]) return "il gateway non sta dentro la rete";
    }
    const nativa = reteNativa?.trim();
    if (nativa && siSovrappongono(s.cidr, nativa)) return `si sovrappone alla rete nativa ${nativa}`;
    const altra = scelte.findIndex((o, j) => j !== i && siSovrappongono(o.cidr, s.cidr));
    if (altra >= 0) return `si sovrappone a «${scelte[altra].nome.trim() || scelte[altra].cidr}»`;
    return null;
  });
}

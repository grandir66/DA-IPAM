/**
 * VLAN, reti e indirizzi visti dai collector, come quelli della sonda trunk (25/11/2026, Riccardo: «le reti viste dal
 * collector non vengono presentate come le VLAN viste dal trunk diretto, sarebbe utile estendere questa feature»).
 *
 * Regole da non rompere:
 * - le sedi non si mescolano: la VLAN 5 di una sede non è quella dell'altra;
 * - solo ARP e DHCP (`traffico_identita`): il traffico instradato farebbe sembrare della sede ogni rete di passaggio;
 * - 169.254, 255.255.255.x e simili non sono reti; gli indirizzi pubblici restano fuori;
 * - una rete vista sia senza tag sia con un tag conta sul tag (VM Proxmox col firewall e `tag=`): vedi `vlanSenzaTag`;
 * - si creano solo gli host che mancano, senza credenziali e senza far partire giri: il collector ascolta e basta.
 */
import type Database from "better-sqlite3";
import { createNetwork, getNetworks, upsertHost } from "@/lib/db-tenant";
import { lookupVendorSync } from "@/lib/scanner/mac-vendor";
import { appartenenzaIp, type Appartenenza } from "@/lib/trunk/appartenenza";
import { ipNumero, reteDi } from "@/lib/trunk/reti";
import { siSovrappongono, type ReteProposta } from "@/lib/trunk/reti-proposte";
import type { TrunkReteMatrice } from "@/lib/trunk/sensore-trunk";
import { isIpInCidr } from "@/lib/utils";
import { dbTraffico } from "./lettura";
import { privato } from "./oggetti";

/** Si guarda solo ciò che si è visto in questi giorni: la tabella ne tiene novanta. */
export const GIORNI_RETI = 14;
const SENZA_SEDE = "senza sede";
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export interface RigaIdentita { collector: string; mac: string; ip: string; vlan: number; fonte: string; nome: string; prima_vista: string; ultima_vista: string }
export interface ReteCensita { id: number; cidr: string; name: string; vlan_id: number | null; gateway: string | null }
export interface IndirizzoVisto { vid: number; ip: string; mac: string; nome: string | null; protocolli: string[]; collector: string[]; prima_vista: string; ultima_vista: string; cidr: string; censita: boolean }
export interface IndirizzoRiga extends IndirizzoVisto { vendor: string | null; appartenenza: Appartenenza }
export interface PuntoAscolto { sede: string; collector: string[]; ultimo_contatto: string | null; attivi: number }
export interface ReteAscolto extends TrunkReteMatrice { censita: boolean; nome_rete: string | null; collector: string[]; /** Indirizzi visti che in IPAM non sono ancora host (solo reti censite). */ mancanti: number }
export interface QuadroAscolto {
  giorni: string[];
  vlan: { vid: number; ip: number; reti: string[]; censita: boolean }[];
  reti: ReteAscolto[];
  numeri: { vlan: number; reti: number; reti_censite: number; ip: number; nuovi7: number };
}

/** Un indirizzo che può essere di una macchina della sede. */
export function utile(ip: string): boolean {
  if (!IPV4.test(ip) || ip.startsWith("169.254.") || !privato(ip)) return false;
  const u = Number(ip.split(".")[3]);
  return u !== 0 && u !== 255;
}

/**
 * A quale VLAN vanno gli indirizzi senza tag di una rete. Quella dichiarata in IPAM, se la si è vista; altrimenti il tag
 * più visto, se è il solo che conta (il triplo del secondo) e copre almeno un quarto degli indirizzi: due indirizzi su
 * diciotto visti su un'altra VLAN sono un apparato mal configurato, non la VLAN della rete. Altrimenti resta «senza tag».
 */
export function vlanSenzaTag(perTag: Map<number, number>, totale: number, dichiarata: number | null): number {
  if (dichiarata && perTag.has(dichiarata)) return dichiarata;
  const t = [...perTag.entries()].filter(([v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  if (t.length === 0) return 0;
  const [vid, n] = t[0];
  return n * 4 >= totale && (t.length === 1 || n >= 3 * t[1][1]) ? vid : 0;
}

/** Dalle identità di UNA sede agli indirizzi con la loro VLAN e rete. Pura. */
export function calcolaVisti(righe: RigaIdentita[], censite: Pick<ReteCensita, "cidr" | "vlan_id">[]): IndirizzoVisto[] {
  const buone = righe.filter((r) => (r.fonte === "arp" || r.fonte === "dhcp") && utile(r.ip));
  const rete = new Map<string, { cidr: string; censita: boolean; vlan: number | null }>();
  for (const r of buone) {
    if (rete.has(r.ip)) continue;
    const c = censite.find((n) => isIpInCidr(r.ip, n.cidr));
    rete.set(r.ip, c ? { cidr: c.cidr, censita: true, vlan: c.vlan_id } : { cidr: reteDi(r.ip, 24), censita: false, vlan: null });
  }
  const conta = new Map<string, { tag: Map<number, Set<string>>; ip: Set<string>; vlan: number | null }>();
  for (const r of buone) {
    const n = rete.get(r.ip)!;
    const c = conta.get(n.cidr) ?? { tag: new Map<number, Set<string>>(), ip: new Set<string>(), vlan: n.vlan };
    c.ip.add(r.ip);
    if (r.vlan !== 0) c.tag.set(r.vlan, (c.tag.get(r.vlan) ?? new Set<string>()).add(r.ip));
    conta.set(n.cidr, c);
  }
  const senzaTag = new Map([...conta].map(([cidr, c]) => [cidr, vlanSenzaTag(new Map([...c.tag].map(([v, s]) => [v, s.size])), c.ip.size, c.vlan)]));
  const esito = new Map<string, IndirizzoVisto>();
  for (const r of buone) {
    const n = rete.get(r.ip)!;
    const vid = r.vlan === 0 ? senzaTag.get(n.cidr)! : r.vlan;
    const k = `${vid}|${r.ip}|${r.mac}`;
    const v = esito.get(k);
    if (!v) {
      esito.set(k, { vid, ip: r.ip, mac: r.mac, nome: r.nome || null, protocolli: [r.fonte], collector: [r.collector], prima_vista: r.prima_vista, ultima_vista: r.ultima_vista, cidr: n.cidr, censita: n.censita });
      continue;
    }
    if (!v.protocolli.includes(r.fonte)) v.protocolli.push(r.fonte);
    if (!v.collector.includes(r.collector)) v.collector.push(r.collector);
    if (r.nome && (!v.nome || r.ultima_vista > v.ultima_vista)) v.nome = r.nome;
    if (r.prima_vista < v.prima_vista) v.prima_vista = r.prima_vista;
    if (r.ultima_vista > v.ultima_vista) v.ultima_vista = r.ultima_vista;
  }
  return [...esito.values()].sort((a, b) => ipNumero(a.ip) - ipNumero(b.ip) || a.vid - b.vid);
}

/** Le reti di una sede, nella forma della pagina del trunk. Pura. */
export function calcolaQuadro(visti: IndirizzoVisto[], censite: ReteCensita[], hostNoti: (reteId: number) => Set<string>, adesso: Date = new Date()): QuadroAscolto {
  const giorni: string[] = [];
  for (let i = GIORNI_RETI - 1; i >= 0; i--) giorni.push(new Date(Date.UTC(adesso.getUTCFullYear(), adesso.getUTCMonth(), adesso.getUTCDate() - i)).toISOString().slice(0, 10));
  const gruppi = new Map<string, IndirizzoVisto[]>();
  for (const v of visti) {
    const k = `${v.vid}|${v.cidr}`;
    const g = gruppi.get(k);
    if (g) g.push(v);
    else gruppi.set(k, [v]);
  }
  const reti: ReteAscolto[] = [...gruppi.values()].map((g) => {
    // più MAC sullo stesso indirizzo: una voce, quella vista per ultima; il primo avvistamento resta il più vecchio
    const perIp = new Map<string, IndirizzoVisto>();
    for (const v of g) {
      const x = perIp.get(v.ip);
      if (!x) { perIp.set(v.ip, v); continue; }
      const ultimo = v.ultima_vista > x.ultima_vista ? v : x;
      perIp.set(v.ip, { ...ultimo, prima_vista: v.prima_vista < x.prima_vista ? v.prima_vista : x.prima_vista });
    }
    const ip = [...perIp.values()];
    const c = censite.find((n) => n.cidr === g[0].cidr);
    const noti = c ? hostNoti(c.id) : null;
    return {
      vid: g[0].vid, cidr: g[0].cidr, gateway_ip: c?.gateway ?? null, fonte: null, maschera: c ? "config" as const : "dedotta" as const, blocchi: [g[0].cidr], dedotta: g[0].cidr,
      ip: ip.map((v) => ({ ip: v.ip, mac: v.mac, vendor: lookupVendorSync(v.mac), nome: v.nome, protocolli: v.protocolli, passivo: 1, attivo: 0, prima_vista: v.prima_vista, ultima_vista: v.ultima_vista })),
      serie: giorni.map((giorno) => ({
        giorno,
        noti: ip.filter((v) => v.prima_vista.slice(0, 10) <= giorno).length,
        nuovi: ip.filter((v) => v.prima_vista.slice(0, 10) === giorno).length,
        attivi: ip.filter((v) => v.prima_vista.slice(0, 10) <= giorno && v.ultima_vista.slice(0, 10) >= giorno).length,
      })),
      censita: c !== undefined, nome_rete: c?.name ?? null, collector: [...new Set(g.flatMap((v) => v.collector))].sort(),
      mancanti: noti ? ip.filter((v) => !noti.has(v.ip)).length : 0,
    };
  }).sort((a, b) => a.vid - b.vid || ipNumero(a.cidr.split("/")[0]) - ipNumero(b.cidr.split("/")[0]));
  const vid = [...new Set(reti.map((r) => r.vid))];
  return {
    giorni, reti,
    vlan: vid.map((v) => {
      const rr = reti.filter((r) => r.vid === v);
      return { vid: v, ip: rr.reduce((n, r) => n + r.ip.length, 0), reti: rr.map((r) => r.cidr), censita: rr.some((r) => r.censita) };
    }),
    numeri: {
      vlan: vid.length, reti: reti.length, reti_censite: reti.filter((r) => r.censita).length,
      ip: new Set(visti.map((v) => v.ip)).size,
      nuovi7: reti.reduce((n, r) => n + r.serie.slice(-7).reduce((m, g) => m + g.nuovi, 0), 0),
    },
  };
}

// ── Aggancio al database del tenant ──────────────────────────────────────────

const sedeDi = (s: string): string => s.trim() || SENZA_SEDE;

/** I punti di ascolto: i collector per sede. */
export function puntiAscolto(d: Database.Database = dbTraffico()): PuntoAscolto[] {
  const righe = d.prepare("SELECT nome, sede, attivo, ultimo_contatto FROM traffico_collector ORDER BY nome").all() as { nome: string; sede: string; attivo: number; ultimo_contatto: string | null }[];
  const per = new Map<string, PuntoAscolto>();
  for (const r of righe) {
    const s = sedeDi(r.sede);
    const p = per.get(s) ?? { sede: s, collector: [], ultimo_contatto: null, attivi: 0 };
    p.collector.push(r.nome);
    if (r.attivo) p.attivi++;
    if (r.ultimo_contatto && (!p.ultimo_contatto || r.ultimo_contatto > p.ultimo_contatto)) p.ultimo_contatto = r.ultimo_contatto;
    per.set(s, p);
  }
  return [...per.values()].sort((a, b) => a.sede.localeCompare(b.sede, "it"));
}

function censite(): ReteCensita[] {
  return getNetworks().map((n) => ({ id: n.id, cidr: n.cidr, name: n.name, vlan_id: n.vlan_id ?? null, gateway: n.gateway ?? null }));
}

/** Gli indirizzi visti dai collector di una sede. Null se la sede non esiste. */
export function vistiDellaSede(sede: string, reti: ReteCensita[] = censite()): IndirizzoVisto[] | null {
  const d = dbTraffico();
  const suoi = (d.prepare("SELECT id, nome, sede FROM traffico_collector").all() as { id: number; nome: string; sede: string }[]).filter((c) => sedeDi(c.sede) === sede);
  if (suoi.length === 0) return null;
  const nomi = new Map(suoi.map((c) => [c.id, c.nome]));
  const righe = d.prepare(`SELECT collector_id, mac, ip, vlan, fonte, nome, prima_vista, ultima_vista FROM traffico_identita
    WHERE collector_id IN (${suoi.map(() => "?").join(",")}) AND fonte IN ('arp', 'dhcp') AND ip <> '' AND ultima_vista >= datetime('now', ?)`)
    .all(...suoi.map((c) => c.id), `-${GIORNI_RETI} days`) as (Omit<RigaIdentita, "collector"> & { collector_id: number })[];
  return calcolaVisti(righe.map(({ collector_id, ...r }) => ({ ...r, collector: nomi.get(collector_id)! })), reti);
}

function hostDellaRete(id: number): Set<string> {
  return new Set((dbTraffico().prepare("SELECT ip FROM hosts WHERE network_id = ?").all(id) as { ip: string }[]).map((r) => r.ip));
}

export function quadroAscolto(sede: string): QuadroAscolto | null {
  const reti = censite();
  const visti = vistiDellaSede(sede, reti);
  return visti && calcolaQuadro(visti, reti, hostDellaRete);
}

export function indirizziAscolto(sede: string, f: { vid?: number | null; cidr?: string | null; q?: string; limit?: number; offset?: number }): { righe: IndirizzoRiga[]; totale: number } | null {
  const reti = censite();
  const visti = vistiDellaSede(sede, reti);
  if (!visti) return null;
  const q = (f.q ?? "").trim().toLowerCase();
  const tenuti = visti.filter((v) => (f.vid == null || v.vid === f.vid) && (!f.cidr || v.cidr === f.cidr)
    && (!q || v.ip.includes(q) || v.mac.includes(q) || (v.nome ?? "").toLowerCase().includes(q)));
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  // senza VLAN in IPAM vale «senza tag», come per la sonda trunk sulla nativa
  const dichiarate = reti.map((r) => ({ cidr: r.cidr, vlan_id: r.vlan_id ?? 0 }));
  return {
    totale: tenuti.length,
    righe: tenuti.slice(offset, offset + limit).map((v) => ({
      ...v, vendor: lookupVendorSync(v.mac), appartenenza: appartenenzaIp({ ip: v.ip, vid: v.vid, protocolli: v.protocolli, attivo: 0 }, dichiarate, null),
    })),
  };
}

/** Le reti viste dai collector e non ancora in IPAM, una per sede e VLAN. */
export function proposteDaiCollector(): ReteProposta[] {
  const reti = censite();
  const esito: ReteProposta[] = [];
  for (const p of puntiAscolto()) {
    for (const r of calcolaQuadro(vistiDellaSede(p.sede, reti) ?? [], reti, () => new Set()).reti) {
      if (r.censita || reti.some((c) => siSovrappongono(c.cidr, r.cidr))) continue;
      const attivi = r.serie.filter((g) => g.attivi > 0);
      esito.push({
        vid: r.vid, cidr: r.cidr, gateway_ip: null, fonte: null, maschera: r.maschera, ip: r.ip.length, ultimoGiorno: attivi.at(-1)?.giorno ?? null,
        sede: p.sede, viste: [`${p.sede}: ${r.collector.length > 2 ? `${r.collector.length} collector` : r.collector.join(", ")}`],
      });
    }
  }
  return esito;
}

/** Trunk e collector insieme: la stessa rete sulla stessa VLAN è una riga sola, e si porta con la sonda trunk, che fa anche il giro ARP. Pura. */
export function unisciProposte(trunk: ReteProposta[], collector: ReteProposta[]): ReteProposta[] {
  const esito = trunk.map((t) => ({ ...t, viste: ["sonda trunk"] }));
  for (const c of collector) {
    const t = esito.find((x) => x.sede === undefined && x.vid === c.vid && x.cidr === c.cidr);
    if (t) t.viste.push(...(c.viste ?? []));
    else esito.push({ ...c, viste: c.viste ?? [] });
  }
  return esito.sort((a, b) => b.ip - a.ip);
}

export class ReteNonVista extends Error {}

const ONLINE_ORE = 24;

/** Porta in IPAM una rete vista dai collector, o gli host che mancano se la rete c'è già. Crea solo ciò che manca. */
export function portaReteDaCollector(x: { sede: string; vid: number; cidr: string; nome?: string }, adesso: Date = new Date()): { id: number; creata: boolean; host: number } {
  const reti = censite();
  const visti = (vistiDellaSede(x.sede, reti) ?? []).filter((v) => v.vid === x.vid && isIpInCidr(v.ip, x.cidr));
  if (visti.length === 0) throw new ReteNonVista("I collector di questa sede non vedono indirizzi in questa rete");
  let rete = reti.find((n) => n.cidr === x.cidr) ?? null;
  const creata = rete === null;
  if (!rete) {
    const n = createNetwork({
      cidr: x.cidr, name: x.nome?.trim() || (x.vid === 0 ? `${x.sede} ${x.cidr}` : `${x.sede} VLAN ${x.vid}`),
      description: `Vista dai collector (${[...new Set(visti.flatMap((v) => v.collector))].sort().join(", ")})`, gateway: null, vlan_id: x.vid || null, location: x.sede,
    });
    rete = { id: n.id, cidr: n.cidr, name: n.name, vlan_id: x.vid || null, gateway: null };
  }
  const noti = hostDellaRete(rete.id);
  const perIp = new Map<string, IndirizzoVisto>();
  for (const v of visti) if ((perIp.get(v.ip)?.ultima_vista ?? "") < v.ultima_vista) perIp.set(v.ip, v);
  let host = 0;
  for (const v of perIp.values()) {
    if (noti.has(v.ip)) continue;
    const vista = Date.parse(`${v.ultima_vista.replace(" ", "T")}Z`);
    upsertHost({
      network_id: rete.id, ip: v.ip, mac: v.mac, vendor: lookupVendorSync(v.mac) ?? undefined,
      hostname: v.nome ?? undefined, hostname_source: v.nome ? "arp" : undefined,
      status: adesso.getTime() - vista <= ONLINE_ORE * 3_600_000 ? "online" : undefined,
    });
    host++;
  }
  return { id: rete.id, creata, host };
}

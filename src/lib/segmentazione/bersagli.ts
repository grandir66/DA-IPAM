/**
 * Quali servizi provare da una VLAN sorgente verso le altre reti.
 *
 * Scelte di Riccardo (09/11/2026): servizi già noti, max 40 per cella, prima
 * i servizi di gestione. La misura parte da una VLAN con tag e dal suo gateway.
 */
import type Database from "better-sqlite3";
import { PORTE_COMUNI, PORTE_GESTIONE } from "@/lib/servizi-rete/porte";

export const TETTO_CELLA = 40;

const GESTIONE = new Set<number>([...PORTE_GESTIONE, ...PORTE_COMUNI.filter((p) => [22, 23, 80, 443, 445, 3389, 5985, 8291, 8443, 8006].includes(p))]);

export function prioritaPorta(porta: number): number {
  if (PORTE_GESTIONE.includes(porta) || porta === 22 || porta === 443) return 0;
  if (GESTIONE.has(porta)) return 1;
  return 2;
}

export interface Bersaglio {
  host_id: number;
  ip: string;
  porta: number;
  rete_bersaglio: number;
}

export interface Sorgente {
  rete_id: number;
  nome: string;
  cidr: string;
  vlan: number;
  gateway: string;
  bersagli: Bersaglio[];
}

interface Rete {
  id: number;
  name: string;
  cidr: string;
  vlan_id: number | null;
  gateway: string | null;
}

function gatewayDalTrunk(db: Database.Database, vid: number): string | null {
  const r = db.prepare("SELECT reti FROM trunk_vlan WHERE vid = ?").get(vid) as { reti: string } | undefined;
  if (!r?.reti) return null;
  try {
    const elenco = JSON.parse(r.reti) as Array<{ gateway_ip?: string | null }>;
    const g = elenco.find((x) => typeof x.gateway_ip === "string" && x.gateway_ip);
    return g?.gateway_ip ?? null;
  } catch {
    return null;
  }
}

/** Reti con VLAN taggata e un gateway, ciascuna con i bersagli delle altre (max 40 per cella). */
export function sorgentiConBersagli(db: Database.Database, tetto = TETTO_CELLA): Sorgente[] {
  const reti = db
    .prepare("SELECT id, name, cidr, vlan_id, gateway FROM networks WHERE vlan_id IS NOT NULL AND vlan_id > 0 ORDER BY vlan_id, id")
    .all() as Rete[];
  const conGw: Sorgente[] = [];
  for (const n of reti) {
    const gw = (n.gateway && n.gateway.trim()) || gatewayDalTrunk(db, n.vlan_id!);
    if (!gw) continue;
    conGw.push({ rete_id: n.id, nome: n.name, cidr: n.cidr, vlan: n.vlan_id!, gateway: gw, bersagli: [] });
  }
  if (conGw.length < 2) return conGw.map((s) => ({ ...s, bersagli: [] }));

  const servizi = db
    .prepare(
      `SELECT s.host_id, h.ip, s.porta, h.network_id AS rete_bersaglio
       FROM servizi_rete s JOIN hosts h ON h.id = s.host_id
       WHERE s.protocollo = 'tcp'`,
    )
    .all() as Array<{ host_id: number; ip: string; porta: number; rete_bersaglio: number }>;

  for (const src of conGw) {
    const perCella = new Map<number, Bersaglio[]>();
    for (const s of servizi) {
      if (s.rete_bersaglio === src.rete_id) continue;
      const lista = perCella.get(s.rete_bersaglio) ?? [];
      lista.push(s);
      perCella.set(s.rete_bersaglio, lista);
    }
    const scelti: Bersaglio[] = [];
    for (const lista of perCella.values()) {
      lista.sort((a, b) => prioritaPorta(a.porta) - prioritaPorta(b.porta) || a.porta - b.porta || a.ip.localeCompare(b.ip));
      scelti.push(...lista.slice(0, tetto));
    }
    src.bersagli = scelti;
  }
  return conGw;
}

export interface ReteBersaglioConteggi {
  id: number;
  name: string;
  cidr: string;
  vlan_id: number | null;
  servizi: number;
  host: number;
}

/** Per la UI di Segmentazione: «N servizi · M host noti» per rete. */
export function conteggiRetiBersaglio(db: Database.Database): ReteBersaglioConteggi[] {
  return db
    .prepare(
      `SELECT n.id, n.name, n.cidr, n.vlan_id,
              (SELECT COUNT(*) FROM hosts h WHERE h.network_id = n.id) AS host,
              (SELECT COUNT(*) FROM servizi_rete s JOIN hosts h ON h.id = s.host_id WHERE h.network_id = n.id) AS servizi
       FROM networks n
       ORDER BY n.vlan_id IS NULL, n.vlan_id, n.id`,
    )
    .all() as ReteBersaglioConteggi[];
}

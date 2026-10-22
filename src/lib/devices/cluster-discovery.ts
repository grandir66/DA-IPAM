/**
 * Un apparato, una riga in Discovery (Riccardo, 22/10): gli IP dello stesso cluster fisico (`hosts.physical_device_id`)
 * si accorpano sotto una riga principale. Principale = l'IP dell'apparato gestito se il cluster ne ha uno («è un
 * apparato» = `sqlApparatoDellHost`, la stessa nozione del blocco di «Rendi apparato»); con due
 * apparati il cluster è ambiguo e non si accorpa (tutte le righe restano visibili perché qualcuno lo sistemi); senza
 * apparato vale la scelta a mano (`physical_devices.primary_host_id`), poi l'IP numericamente più basso. Sola lettura.
 * Lo stato non entra nella scelta: se il principale è assente/offline e i secondari sono vivi, resta lui (la riga
 * mostra il suo stato, i secondari vivi si vedono in «+N IP»); l'apparato gestito è l'ancora, e cambiare riga con lo
 * stato farebbe ballare la riga di Discovery a ogni scansione.
 */
import type Database from "better-sqlite3";
import { ipToLong } from "@/lib/utils";
import { sqlApparatoDellHost } from "./apparato-del-cluster";

export interface MembroCluster { host_id: number; ip: string; network_id: number; network_name: string; status: string; ha_apparato: boolean }

export interface InfoClusterDiscovery {
  physical_device_id: number;
  principale: boolean;
  principale_host_id: number;
  /** Solo sulla riga principale: gli altri IP, in ordine di IP. */
  altri: Array<Omit<MembroCluster, "ha_apparato">>;
}

const perIp = (a: { ip: string }, b: { ip: string }): number => ipToLong(a.ip) - ipToLong(b.ip);

/** Regola pura. null = il cluster non si accorpa (meno di 2 membri, o 2+ apparati: ambiguo). */
export function principaleDelCluster(membri: MembroCluster[], sceltoAMano: number | null): number | null {
  if (membri.length < 2) return null;
  const apparati = membri.filter((m) => m.ha_apparato);
  if (apparati.length === 1) return apparati[0].host_id;
  if (apparati.length > 1) return null;
  if (sceltoAMano != null && membri.some((m) => m.host_id === sceltoAMano)) return sceltoAMano;
  // Stesso ripiego deterministico di recomputeMultihomedLinks: l'IP più basso (a pari IP, l'id più basso).
  return [...membri].sort((a, b) => perIp(a, b) || a.host_id - b.host_id)[0].host_id;
}

/** La colonna la crea la migrazione `cluster_principale_v21`: se è fallita, si legge NULL e vale la regola senza scelta a mano. */
export function haColonnaPrincipale(db: Database.Database): boolean {
  return (db.prepare("PRAGMA table_info(physical_devices)").all() as Array<{ name: string }>).some((c) => c.name === "primary_host_id");
}

interface RigaCluster { id: number; ip: string; network_id: number; network_name: string; status: string; pd: number; scelto: number | null; ha_apparato: number | null }

/** Una query sola su tutti i cluster con 2+ host; mappa host_id → info. Gli host fuori da un cluster accorpato non ci sono. */
export function leggiClusterDiscovery(db: Database.Database): Map<number, InfoClusterDiscovery> {
  const scelto = haColonnaPrincipale(db) ? "pd.primary_host_id" : "NULL";
  const righe = db.prepare(
    `SELECT h.id, h.ip, h.network_id, n.name AS network_name, h.status, h.physical_device_id AS pd, ${scelto} AS scelto,
            (SELECT 1 FROM network_devices nd WHERE ${sqlApparatoDellHost("nd", "h")} LIMIT 1) AS ha_apparato
       FROM hosts h
       JOIN networks n ON n.id = h.network_id
       JOIN physical_devices pd ON pd.id = h.physical_device_id
      WHERE h.physical_device_id IN (
        SELECT physical_device_id FROM hosts WHERE physical_device_id IS NOT NULL GROUP BY physical_device_id HAVING COUNT(*) > 1)`,
  ).all() as RigaCluster[];

  const perCluster = new Map<number, { scelto: number | null; membri: MembroCluster[] }>();
  for (const r of righe) {
    let g = perCluster.get(r.pd);
    if (!g) {
      g = { scelto: r.scelto, membri: [] };
      perCluster.set(r.pd, g);
    }
    g.membri.push({ host_id: r.id, ip: r.ip, network_id: r.network_id, network_name: r.network_name, status: r.status, ha_apparato: r.ha_apparato === 1 });
  }

  const mappa = new Map<number, InfoClusterDiscovery>();
  for (const [pd, { scelto: s, membri }] of perCluster) {
    const p = principaleDelCluster(membri, s);
    if (p == null) continue;
    const altri = membri
      .filter((m) => m.host_id !== p)
      .sort(perIp)
      .map((m) => ({ host_id: m.host_id, ip: m.ip, network_id: m.network_id, network_name: m.network_name, status: m.status }));
    for (const m of membri) {
      const principale = m.host_id === p;
      mappa.set(m.host_id, { physical_device_id: pd, principale, principale_host_id: p, altri: principale ? altri : [] });
    }
  }
  return mappa;
}

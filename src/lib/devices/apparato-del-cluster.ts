/**
 * Un apparato, una scheda, da qualunque suo IP (Riccardo, 22/10). Un host che appartiene a un apparato fisico
 * (`hosts.physical_device_id`) il cui cluster ha UN solo apparato gestito (un host del cluster con riga in
 * `network_devices`) apre la scheda di quell'apparato. Con due apparati (ambiguo) o con nessuno non si decide:
 * resta la scheda di oggi. Sola lettura.
 */
import type Database from "better-sqlite3";

export interface ApparatoDelCluster {
  network_device_id: number;
  nome: string;
  /** Host che porta la riga `network_devices` (l'IP «principale» della scheda). */
  host_id: number;
  ip: string;
  /** Host del cluster fisico, quello aperto compreso. */
  n_indirizzi: number;
}

export type EsitoApparatoDelCluster =
  | { esito: "proprio" }
  | { esito: "cluster"; apparato: ApparatoDelCluster }
  | { esito: "ambiguo" }
  | { esito: "nessuno" };

export function apparatoDelCluster(db: Database.Database, hostId: number): EsitoApparatoDelCluster {
  const h = db.prepare("SELECT ip, physical_device_id AS pd FROM hosts WHERE id = ?").get(hostId) as { ip: string; pd: number | null } | undefined;
  if (!h) return { esito: "nessuno" };
  // Stesso criterio di getHostById: FK, poi IP per gli apparati precedenti alla migrazione.
  const proprio = db.prepare("SELECT 1 FROM network_devices WHERE host_id = ? OR host = ? LIMIT 1").get(hostId, h.ip);
  if (proprio) return { esito: "proprio" };
  if (!h.pd) return { esito: "nessuno" };
  const apparati = db.prepare(
    `SELECT nd.id AS network_device_id, nd.name AS nome, hh.id AS host_id, hh.ip AS ip
       FROM hosts hh JOIN network_devices nd ON nd.host_id = hh.id
      WHERE hh.physical_device_id = ? ORDER BY nd.id`,
  ).all(h.pd) as Array<Omit<ApparatoDelCluster, "n_indirizzi">>;
  if (apparati.length === 0) return { esito: "nessuno" };
  if (apparati.length > 1) return { esito: "ambiguo" };
  const n = (db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE physical_device_id = ?").get(h.pd) as { n: number }).n;
  return { esito: "cluster", apparato: { ...apparati[0], n_indirizzi: n } };
}

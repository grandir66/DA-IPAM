/**
 * Un apparato, una scheda, da qualunque suo IP (Riccardo, 22/10). Un host che appartiene a un apparato fisico
 * (`hosts.physical_device_id`) il cui cluster ha UN solo apparato gestito (un host del cluster con riga in
 * `network_devices`) apre la scheda di quell'apparato. Con due apparati (ambiguo) o con nessuno non si decide:
 * resta la scheda di oggi. Sola lettura.
 */
import type Database from "better-sqlite3";

/**
 * «Questo host è un apparato»: nozione unica per la scheda (`apparatoDelCluster`), il blocco di «Rendi apparato»
 * (`apparatoGiaPresente`) e la riga principale di Discovery (`cluster-discovery.ts`) (revisione finale 22/10: prima
 * Discovery guardava solo `host_id` e il blocco anche `host = ip`, così un apparato vecchio contava per uno e non
 * per l'altro). L'apparato è legato all'host (`host_id`), oppure, per gli apparati precedenti alla FK
 * (`host_id` NULL), ha scritto l'IP dell'host. Un apparato legato a un'altra riga con lo stesso IP (un'altra rete)
 * non conta: dentro la stessa rete l'IP basta, fuori no.
 */
export const sqlApparatoDellHost = (nd: string, h: string): string =>
  `(${nd}.host_id = ${h}.id OR (${nd}.host_id IS NULL AND ${nd}.host = ${h}.ip))`;

/** Fra questi host, quelli che sono un apparato (`sqlApparatoDellHost`). Una query sola. */
export function hostConApparato(db: Database.Database, hostIds: readonly number[]): Set<number> {
  if (hostIds.length === 0) return new Set();
  const righe = db.prepare(
    `SELECT DISTINCT h.id FROM hosts h JOIN network_devices nd ON ${sqlApparatoDellHost("nd", "h")}
      WHERE h.id IN (${hostIds.map(() => "?").join(",")})`,
  ).all(...hostIds) as Array<{ id: number }>;
  return new Set(righe.map((r) => r.id));
}

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
  // FK, poi IP per gli apparati precedenti alla migrazione (sqlApparatoDellHost).
  const proprio = db.prepare(`SELECT 1 FROM network_devices nd JOIN hosts h ON h.id = ? WHERE ${sqlApparatoDellHost("nd", "h")} LIMIT 1`).get(hostId);
  if (proprio) return { esito: "proprio" };
  if (!h.pd) return { esito: "nessuno" };
  const apparati = db.prepare(
    `SELECT nd.id AS network_device_id, nd.name AS nome, hh.id AS host_id, hh.ip AS ip
       FROM hosts hh JOIN network_devices nd ON ${sqlApparatoDellHost("nd", "hh")}
      WHERE hh.physical_device_id = ? ORDER BY nd.id`,
  ).all(h.pd) as Array<Omit<ApparatoDelCluster, "n_indirizzi">>;
  if (apparati.length === 0) return { esito: "nessuno" };
  if (apparati.length > 1) return { esito: "ambiguo" };
  const n = (db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE physical_device_id = ?").get(h.pd) as { n: number }).n;
  return { esito: "cluster", apparato: { ...apparati[0], n_indirizzi: n } };
}

export interface ApparatoGiaPresente { network_device_id: number; nome: string; host_id: number; ip: string }

/**
 * `delGruppo`: l'IP è un altro IP del cluster fisico dell'apparato, non il suo. Allora si dice come uscirne: togliere
 * l'IP dal gruppo nella scheda dell'apparato (es. un iLO accorpato alle schede di rete del suo server).
 */
export const messaggioIpDiApparato = (nome: string, delGruppo = false): string =>
  `Questo IP è già dell'apparato ${nome}` +
  (delGruppo ? `. Per farne un apparato a sé, prima togli l'IP dal gruppo nella scheda di ${nome}` : "");

/**
 * L'apparato che possiede già questo IP: lo stesso host («proprio») o un altro host del suo cluster fisico.
 * Controlla TUTTE le righe `hosts` con quell'IP (lo stesso IP può stare in due reti). Con più apparati nel
 * cluster vale il primo per `network_devices.id`. Senza righe `hosts` per l'IP: null (un apparato su un IP mai
 * scansionato resta ammesso). `escludi`: l'id di un apparato da non contare (la PUT che cambia `host` a sé stesso).
 * Sola lettura.
 */
export function apparatoGiaPresente(db: Database.Database, ip: string, escludi: number | null = null): ApparatoGiaPresente | null {
  const righe = db.prepare("SELECT id, physical_device_id AS pd FROM hosts WHERE ip = ?").all(ip) as Array<{ id: number; pd: number | null }>;
  const trovati: Array<ApparatoGiaPresente> = [];
  for (const r of righe) {
    const proprio = db.prepare(
      `SELECT nd.id, nd.name, nd.host_id, nd.host FROM network_devices nd JOIN hosts h ON h.id = ?
        WHERE ${sqlApparatoDellHost("nd", "h")} AND nd.id IS NOT ? ORDER BY nd.id LIMIT 1`,
    ).get(r.id, escludi) as { id: number; name: string; host_id: number | null; host: string } | undefined;
    if (proprio) { trovati.push({ network_device_id: proprio.id, nome: proprio.name, host_id: proprio.host_id ?? r.id, ip }); continue; }
    if (!r.pd) continue;
    const c = db.prepare(
      `SELECT nd.id AS network_device_id, nd.name AS nome, hh.id AS host_id, hh.ip AS ip
         FROM hosts hh JOIN network_devices nd ON ${sqlApparatoDellHost("nd", "hh")}
        WHERE hh.physical_device_id = ? AND nd.id IS NOT ? ORDER BY nd.id LIMIT 1`,
    ).get(r.pd, escludi) as ApparatoGiaPresente | undefined;
    if (c) trovati.push(c);
  }
  trovati.sort((a, b) => a.network_device_id - b.network_device_id);
  return trovati[0] ?? null;
}

/**
 * PUT dell'apparato che cambia `host` (revisione finale 22/10): stesso blocco di «Rendi apparato», senza contare
 * l'apparato stesso. null = si può; altrimenti il corpo del 409.
 */
export function bloccoCambioHost(
  db: Database.Database,
  apparato: { id: number; host: string },
  nuovoHost: unknown,
): { error: string; codice: "IP_DI_APPARATO"; apparato: ApparatoGiaPresente } | null {
  if (typeof nuovoHost !== "string" || nuovoHost === apparato.host) return null;
  const gia = apparatoGiaPresente(db, nuovoHost, apparato.id);
  if (!gia) return null;
  return { error: messaggioIpDiApparato(gia.nome, gia.ip !== nuovoHost), codice: "IP_DI_APPARATO", apparato: gia };
}

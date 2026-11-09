/**
 * Prove della matrice di segmentazione: una riga per giro + sorgente + bersaglio.
 */
import type Database from "better-sqlite3";

export interface CellaMatrice {
  rete_sorgente: number | null;
  rete_bersaglio: number | null;
  vlan_sorgente: number;
  nome_sorgente: string | null;
  nome_bersaglio: string | null;
  cidr_sorgente: string | null;
  cidr_bersaglio: string | null;
  totale: number;
  raggiunti: number;
  chiusi: number;
  filtrati: number;
  senza_rotta: number;
}

export interface ProvaSegmentazione {
  id: number;
  vlan_sorgente: number;
  rete_sorgente: number | null;
  rete_bersaglio: number | null;
  host_id: number | null;
  ip: string;
  porta: number;
  esito: string;
  visto: string;
  hostname: string | null;
  nome_sorgente: string | null;
  nome_bersaglio: string | null;
}

export interface ConteggiSegmentazione {
  giri: number;
  prove: number;
  raggiunti: number;
  chiusi: number;
  filtrati: number;
  senza_rotta: number;
  ultimo: string | null;
}

export function apriGiro(db: Database.Database): number {
  return Number(db.prepare("INSERT INTO segmentazione_giri (iniziato, esito) VALUES (datetime('now'), 'in corso')").run().lastInsertRowid);
}

export function chiudiGiro(db: Database.Database, id: number, esito: "ok" | "errore", errore?: string | null): void {
  db.prepare("UPDATE segmentazione_giri SET finito = datetime('now'), esito = ?, errore = ? WHERE id = ?").run(esito, errore ?? null, id);
}

export function salvaProve(
  db: Database.Database,
  giroId: number,
  vlanSorgente: number,
  reteSorgente: number | null,
  prove: Array<{ rete_bersaglio: number | null; host_id: number | null; ip: string; porta: number; esito: string }>,
): void {
  const ins = db.prepare(
    `INSERT INTO segmentazione_prove (giro_id, vlan_sorgente, rete_sorgente, rete_bersaglio, host_id, ip, porta, esito)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const p of prove) ins.run(giroId, vlanSorgente, reteSorgente, p.rete_bersaglio, p.host_id, p.ip, p.porta, p.esito);
  })();
}

/** Ultimo giro chiuso: una cella per coppia di reti. */
export function celleMatrice(db: Database.Database): CellaMatrice[] {
  const ultimo = db.prepare("SELECT id FROM segmentazione_giri WHERE esito = 'ok' ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  if (!ultimo) return [];
  return db
    .prepare(
      `SELECT p.rete_sorgente, p.rete_bersaglio, p.vlan_sorgente,
              ns.name AS nome_sorgente, nb.name AS nome_bersaglio,
              ns.cidr AS cidr_sorgente, nb.cidr AS cidr_bersaglio,
              COUNT(*) AS totale,
              SUM(p.esito = 'raggiunto') AS raggiunti,
              SUM(p.esito = 'chiuso') AS chiusi,
              SUM(p.esito = 'filtrato') AS filtrati,
              SUM(p.esito = 'senza_rotta') AS senza_rotta
       FROM segmentazione_prove p
       LEFT JOIN networks ns ON ns.id = p.rete_sorgente
       LEFT JOIN networks nb ON nb.id = p.rete_bersaglio
       WHERE p.giro_id = ?
       GROUP BY p.rete_sorgente, p.rete_bersaglio
       ORDER BY p.vlan_sorgente, p.rete_bersaglio`,
    )
    .all(ultimo.id) as CellaMatrice[];
}

export function proveDellaCella(
  db: Database.Database,
  reteSorgente: number,
  reteBersaglio: number,
): ProvaSegmentazione[] {
  const ultimo = db.prepare("SELECT id FROM segmentazione_giri WHERE esito = 'ok' ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  if (!ultimo) return [];
  return db
    .prepare(
      `SELECT p.id, p.vlan_sorgente, p.rete_sorgente, p.rete_bersaglio, p.host_id, p.ip, p.porta, p.esito, p.visto,
              COALESCE(h.custom_name, h.hostname) AS hostname, ns.name AS nome_sorgente, nb.name AS nome_bersaglio
       FROM segmentazione_prove p
       LEFT JOIN hosts h ON h.id = p.host_id
       LEFT JOIN networks ns ON ns.id = p.rete_sorgente
       LEFT JOIN networks nb ON nb.id = p.rete_bersaglio
       WHERE p.giro_id = ? AND p.rete_sorgente = ? AND p.rete_bersaglio = ?
       ORDER BY p.ip, p.porta`,
    )
    .all(ultimo.id, reteSorgente, reteBersaglio) as ProvaSegmentazione[];
}

export interface VistaServizio {
  ip: string;
  porta: number;
  hostname: string | null;
  rete_bersaglio: string | null;
  per_sorgente: Array<{ rete: string | null; vlan: number; esito: string }>;
}

/** Seconda vista: un servizio, una colonna per rete sorgente. */
export function vistaServizio(db: Database.Database): VistaServizio[] {
  const ultimo = db.prepare("SELECT id FROM segmentazione_giri WHERE esito = 'ok' ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  if (!ultimo) return [];
  const righe = db
    .prepare(
      `SELECT p.ip, p.porta, p.vlan_sorgente, p.esito,
              COALESCE(h.custom_name, h.hostname) AS hostname,
              nb.name AS rete_bersaglio, ns.name AS rete_sorgente
       FROM segmentazione_prove p
       LEFT JOIN hosts h ON h.id = p.host_id
       LEFT JOIN networks ns ON ns.id = p.rete_sorgente
       LEFT JOIN networks nb ON nb.id = p.rete_bersaglio
       WHERE p.giro_id = ?
       ORDER BY p.ip, p.porta, p.vlan_sorgente`,
    )
    .all(ultimo.id) as Array<{
    ip: string;
    porta: number;
    vlan_sorgente: number;
    esito: string;
    hostname: string | null;
    rete_bersaglio: string | null;
    rete_sorgente: string | null;
  }>;
  const m = new Map<string, VistaServizio>();
  for (const r of righe) {
    const k = `${r.ip}:${r.porta}`;
    const v = m.get(k) ?? { ip: r.ip, porta: r.porta, hostname: r.hostname, rete_bersaglio: r.rete_bersaglio, per_sorgente: [] };
    v.per_sorgente.push({ rete: r.rete_sorgente, vlan: r.vlan_sorgente, esito: r.esito });
    m.set(k, v);
  }
  return [...m.values()];
}

export function conteggiSegmentazione(db: Database.Database): ConteggiSegmentazione {
  const ultimo = db.prepare("SELECT id, finito FROM segmentazione_giri WHERE esito = 'ok' ORDER BY id DESC LIMIT 1").get() as
    | { id: number; finito: string | null }
    | undefined;
  const giri = (db.prepare("SELECT COUNT(*) AS c FROM segmentazione_giri").get() as { c: number }).c;
  if (!ultimo) return { giri, prove: 0, raggiunti: 0, chiusi: 0, filtrati: 0, senza_rotta: 0, ultimo: null };
  const r = db
    .prepare(
      `SELECT COUNT(*) AS prove,
              SUM(esito = 'raggiunto') AS raggiunti,
              SUM(esito = 'chiuso') AS chiusi,
              SUM(esito = 'filtrato') AS filtrati,
              SUM(esito = 'senza_rotta') AS senza_rotta
       FROM segmentazione_prove WHERE giro_id = ?`,
    )
    .get(ultimo.id) as { prove: number; raggiunti: number | null; chiusi: number | null; filtrati: number | null; senza_rotta: number | null };
  return {
    giri,
    prove: r.prove,
    raggiunti: r.raggiunti ?? 0,
    chiusi: r.chiusi ?? 0,
    filtrati: r.filtrati ?? 0,
    senza_rotta: r.senza_rotta ?? 0,
    ultimo: ultimo.finito,
  };
}

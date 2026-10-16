/**
 * Gli abbinamenti verificati host del centro ↔ host di DA-IPAM, nel DB del cliente
 * (passo 7.4). Si salva SOLO ciò che una persona ha confermato: proposti, ambigui e
 * persi si ricalcolano a ogni lettura (`abbinamento.ts`).
 *
 * Una query per tutte le letture (niente N+1, regola 6): gli host di DA-IPAM per un
 * insieme di IP si leggono a blocchi di 500 parametri.
 */
import type Database from "better-sqlite3";
import { assicuraTabelleZabbixLettura } from "@/lib/db-tenant-schema";
import type { AbbinamentoSalvato, HostIpam } from "./abbinamento";

const BLOCCO = 500;

/** Gli host di DA-IPAM con uno di questi IP, raggruppati per IP. */
export function hostIpamPerIp(db: Database.Database, ips: Iterable<string>): Map<string, HostIpam[]> {
  const tutti = [...new Set(ips)].filter((ip) => ip.trim() !== "");
  const out = new Map<string, HostIpam[]>();
  for (let i = 0; i < tutti.length; i += BLOCCO) {
    const pezzo = tutti.slice(i, i + BLOCCO);
    const righe = db
      .prepare(
        `SELECT id, ip, COALESCE(NULLIF(TRIM(custom_name), ''), NULLIF(TRIM(hostname), '')) AS nome
           FROM hosts WHERE ip IN (${pezzo.map(() => "?").join(",")})`,
      )
      .all(...pezzo) as Array<{ id: number; ip: string; nome: string | null }>;
    for (const r of righe) {
      const l = out.get(r.ip) ?? [];
      l.push({ id: r.id, ip: r.ip, nome: r.nome });
      out.set(r.ip, l);
    }
  }
  return out;
}

/** Gli abbinamenti verificati il cui host di DA-IPAM esiste ancora (le righe orfane si ignorano). */
export function abbinamentiSalvati(db: Database.Database): AbbinamentoSalvato[] {
  assicuraTabelleZabbixLettura(db);
  return db
    .prepare(
      `SELECT a.hostid AS hostid, a.host_id AS hostId, a.ip AS ip,
              COALESCE(NULLIF(TRIM(h.custom_name), ''), NULLIF(TRIM(h.hostname), '')) AS nome
         FROM zabbix_abbinamenti a JOIN hosts h ON h.id = a.host_id
        ORDER BY CAST(a.hostid AS INTEGER)`,
    )
    .all() as AbbinamentoSalvato[];
}

export function salvaAbbinamento(
  db: Database.Database,
  a: { hostid: string; hostId: number; ip: string },
  chi: string,
): void {
  assicuraTabelleZabbixLettura(db);
  db.prepare(
    `INSERT INTO zabbix_abbinamenti (hostid, host_id, ip, confermato_da, confermato_il)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(hostid) DO UPDATE SET host_id = excluded.host_id, ip = excluded.ip,
       confermato_da = excluded.confermato_da, confermato_il = excluded.confermato_il`,
  ).run(a.hostid, a.hostId, a.ip, chi);
}

export function togliAbbinamento(db: Database.Database, hostid: string): boolean {
  assicuraTabelleZabbixLettura(db);
  return db.prepare("DELETE FROM zabbix_abbinamenti WHERE hostid = ?").run(hostid).changes > 0;
}

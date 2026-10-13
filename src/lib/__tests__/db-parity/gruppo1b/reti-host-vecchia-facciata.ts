/**
 * Copia CONGELATA delle funzioni del dominio «reti e host» com'erano nella facciata
 * `db.ts` prima dello spostamento in `db-tenant.ts` (commit 1bd3548, T3-06,
 * NUC-2 gruppo 1b). Dopo lo spostamento `db.ts` le riesporta: la parità si prova
 * contro questa copia, come per il gruppo 0. Testo identico all'originale, salvo
 * i moduli presi con `import("./x")` o `require("./x")`, che puntano a `@/lib/x` perché la copia vive
 * in un'altra cartella; non si modifica. Generata dal parser di TypeScript, con gli
 * aiutanti locali che usava.
 */
import { getDb } from "@/lib/db";
import type { NetworkInput, Network } from "@/types";

export function createNetwork(input: NetworkInput): Network {
  // Verifica overlap CIDR con reti esistenti
  const { cidrOverlaps } = require("@/lib/utils") as { cidrOverlaps: (a: string, b: string) => boolean };
  const existing = getDb().prepare("SELECT cidr FROM networks").all() as { cidr: string }[];
  for (const net of existing) {
    if (cidrOverlaps(input.cidr, net.cidr)) {
      throw new Error(`La rete ${input.cidr} si sovrappone alla rete esistente ${net.cidr}`);
    }
  }

  const stmt = getDb().prepare(
    `INSERT INTO networks (cidr, name, description, gateway, vlan_id, location, snmp_community, dns_server)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    input.cidr,
    input.name,
    input.description || "",
    input.gateway || null,
    input.vlan_id || null,
    input.location || "",
    input.snmp_community || null,
    input.dns_server || null
  );
  const networkId = Number(result.lastInsertRowid);

  // Fix drift (2026-07-20): la copia `db.ts` di createNetwork non seminava i job
  // default (known_host_check) presenti in `db-tenant.createNetwork` → creando una
  // rete via API (che importa da @/lib/db) il monitoring default non partiva.
  // Allineata a db-tenant; seedDefaultJobsForNetwork opera sul tenant corrente (getDb).
  try {
    const { seedDefaultJobsForNetwork } = require("@/lib/db-tenant") as {
      seedDefaultJobsForNetwork: (networkId: number, idx: number, total: number) => void;
    };
    const existingNets = (getDb().prepare("SELECT COUNT(*) AS n FROM networks").get() as { n: number }).n;
    const idx = Math.max(0, existingNets - 1);
    seedDefaultJobsForNetwork(networkId, idx, Math.max(1, existingNets));
  } catch (err) {
    console.warn(`[createNetwork] seed default jobs failed per network ${networkId}:`, err);
  }

  return getDb().prepare("SELECT * FROM networks WHERE id = ?").get(networkId) as Network;
}

export function deleteHost(id: number, options?: { reason?: string; excludedBy?: string | null; skipExclusion?: boolean }): boolean {
  const db = getDb();
  const row = db.prepare("SELECT network_id, ip FROM hosts WHERE id = ?").get(id) as { network_id: number; ip: string } | undefined;
  const changes = db.prepare("DELETE FROM hosts WHERE id = ?").run(id).changes;
  if (changes > 0 && row && !options?.skipExclusion) {
    // Tombstone: l'IP entra in blacklist così le fonti passive (ARP/DHCP/AD) e
    // anche i probe attivi non lo ricreano silenziosamente al prossimo scan.
    try {
      db.prepare(
        "INSERT OR IGNORE INTO excluded_ips (network_id, ip, reason, excluded_by) VALUES (?, ?, ?, ?)"
      ).run(row.network_id, row.ip, options?.reason ?? "host_deleted", options?.excludedBy ?? null);
    } catch { /* tabella mancante su DB pre-migrazione: ignora */ }
  }
  return changes > 0;
}

export function bulkDeleteHosts(networkId: number, hostIds: number[], options?: { reason?: string; excludedBy?: string | null; skipExclusion?: boolean }): number {
  if (hostIds.length === 0) return 0;
  const db = getDb();
  const placeholders = hostIds.map(() => "?").join(",");
  let ips: string[] = [];
  if (!options?.skipExclusion) {
    ips = (db.prepare(`SELECT ip FROM hosts WHERE network_id = ? AND id IN (${placeholders})`)
      .all(networkId, ...hostIds) as { ip: string }[]).map((r) => r.ip);
  }
  const stmt = db.prepare(`DELETE FROM hosts WHERE network_id = ? AND id IN (${placeholders})`);
  const changes = stmt.run(networkId, ...hostIds).changes;
  if (changes > 0 && ips.length > 0) {
    try {
      const ins = db.prepare(
        "INSERT OR IGNORE INTO excluded_ips (network_id, ip, reason, excluded_by) VALUES (?, ?, ?, ?)"
      );
      db.transaction(() => {
        for (const ip of ips) ins.run(networkId, ip, options?.reason ?? "host_bulk_deleted", options?.excludedBy ?? null);
      })();
    } catch { /* tabella mancante: ignora */ }
  }
  return changes;
}

export function noteHostsNonResponding(
  networkId: number,
  onlineIps: string[],
  scannedIps: string[],
  scanType: string
): void {
  const onlineSet = new Set(onlineIps);
  const nonResponding = scannedIps.filter((ip) => !onlineSet.has(ip));
  if (nonResponding.length === 0) return;
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const tag = `[${dateStr}] Non risposto (${scanType}) — verificare se eliminare`;
  const db = getDb();
  for (const ip of nonResponding) {
    const row = db.prepare(
      "SELECT id, notes FROM hosts WHERE network_id = ? AND ip = ?"
    ).get(networkId, ip) as { id: number; notes: string } | undefined;
    if (!row) continue;
    const existing = row.notes ?? "";
    // Evita duplicati dello stesso giorno
    if (existing.includes(`[${dateStr}]`)) continue;
    const updated = existing.trim() ? `${existing.trim()}\n${tag}` : tag;
    db.prepare(
      "UPDATE hosts SET notes = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(updated, row.id);
  }
}

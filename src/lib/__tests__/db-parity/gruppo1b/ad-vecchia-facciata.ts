/**
 * Copia CONGELATA delle funzioni del dominio «AD» com'erano nella facciata
 * `db.ts` prima dello spostamento in `db-tenant.ts` (commit ca7661e, T3-06,
 * NUC-2 gruppo 1b). Dopo lo spostamento `db.ts` le riesporta: la parità si prova
 * contro questa copia, come per il gruppo 0. Testo identico all'originale; non si
 * modifica. Generata dal parser di TypeScript, con gli aiutanti locali che usava.
 */
import { getDb } from "@/lib/db";
import { getAdIntegrationById } from "@/lib/db-tenant";
import type { AdIntegration } from "@/lib/db-tenant";

export function createAdIntegration(input: {
  name: string;
  dc_host: string;
  domain: string;
  base_dn: string;
  encrypted_username: string;
  encrypted_password: string;
  use_ssl?: number;
  port?: number;
  enabled?: number;
  winrm_credential_id?: number | null;
}): AdIntegration {
  const stmt = getDb().prepare(`INSERT INTO ad_integrations
    (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, use_ssl, port, enabled, winrm_credential_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const r = stmt.run(
    input.name,
    input.dc_host,
    input.domain,
    input.base_dn,
    input.encrypted_username,
    input.encrypted_password,
    input.use_ssl ?? 1,
    input.port ?? 636,
    input.enabled ?? 1,
    input.winrm_credential_id ?? null
  );
  return getAdIntegrationById(Number(r.lastInsertRowid))!;
}

export function deleteAdIntegration(id: number): boolean {
  const r = getDb().prepare("DELETE FROM ad_integrations WHERE id = ?").run(id);
  return r.changes > 0;
}

export function relinkAdComputersForNetwork(networkId: number): { linked: number; enriched: number } {
  const db = getDb();
  let linked = 0;
  let enriched = 0;

  // Host della rete
  const hosts = db.prepare(
    `SELECT id, ip, mac, hostname, dns_forward, dns_reverse, os_info FROM hosts WHERE network_id = ?`
  ).all(networkId) as Array<{
    id: number; ip: string; mac: string | null; hostname: string | null;
    dns_forward: string | null; dns_reverse: string | null;
    os_info: string | null;
  }>;
  if (hosts.length === 0) return { linked: 0, enriched: 0 };

  // Computer AD non ancora linkati (o linkati a host di altre reti)
  const unlinked = db.prepare(
    `SELECT ac.id, ac.integration_id, ac.object_guid, ac.dns_host_name, ac.sam_account_name,
            ac.ip_address, ac.operating_system, ac.host_id
     FROM ad_computers ac
     WHERE ac.host_id IS NULL
        OR ac.host_id IN (SELECT id FROM hosts WHERE network_id = ?)`
  ).all(networkId) as Array<{
    id: number; integration_id: number; object_guid: string;
    dns_host_name: string | null; sam_account_name: string;
    ip_address: string | null; operating_system: string | null;
    host_id: number | null;
  }>;

  // Indici per lookup rapido
  const hostByIp = new Map(hosts.map((h) => [h.ip, h]));
  const hostByHostname = new Map<string, typeof hosts[0]>();
  for (const h of hosts) {
    if (h.hostname) hostByHostname.set(h.hostname.toLowerCase(), h);
    if (h.dns_reverse) hostByHostname.set(h.dns_reverse.toLowerCase(), h);
    if (h.dns_forward) hostByHostname.set(h.dns_forward.toLowerCase(), h);
  }

  const linkStmt = db.prepare(
    `UPDATE ad_computers SET host_id = ? WHERE integration_id = ? AND object_guid = ?`
  );

  // Funzione di arricchimento: AD è fonte autoritativa per hostname.
  // Fase 4: l'euristica server_windows/workstation (da os_info) è stata
  // rimossa — l'evidenza "ad" già emessa in emitters.ts (dimension category,
  // claim compute.server/compute.workstation) la sostituisce nella fusione
  // v2. os_info/hostname restano: sono anagrafica, non attribuzione.
  function enrichHost(hostId: number, comp: typeof unlinked[0], currentHost: typeof hosts[0]) {
    const adHostname = comp.dns_host_name || comp.sam_account_name.replace(/\$$/, "");
    const osRaw = comp.operating_system ?? "";

    // AD è la fonte più affidabile: hostname viene SEMPRE sovrascritto
    const sets: string[] = [];
    const vals: unknown[] = [];

    // Hostname: AD vince sempre
    if (adHostname) {
      sets.push("hostname = ?", "hostname_source = 'ad'");
      vals.push(adHostname);
    }

    // custom_name: se vuoto, usa il nome AD per dare un nome leggibile
    if (adHostname && !currentHost.hostname) {
      sets.push("custom_name = CASE WHEN custom_name IS NULL OR custom_name = '' THEN ? ELSE custom_name END");
      vals.push(adHostname);
    }

    // OS: AD sovrascrive se l'host non ha OS o ha "unknown"
    if (osRaw && (!currentHost.os_info || currentHost.os_info === "unknown")) {
      sets.push("os_info = ?");
      vals.push(osRaw);
    }

    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      db.prepare(`UPDATE hosts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, hostId);
      enriched++;
    }
  }

  const touchedHostIds: number[] = [];
  db.transaction(() => {
    for (const comp of unlinked) {
      const dnsHostName = comp.dns_host_name?.toLowerCase() ?? "";
      const samName = comp.sam_account_name.replace(/\$$/, "").toLowerCase();
      const shortDns = dnsHostName.split(".")[0];

      // Match per hostname
      let host = hostByHostname.get(dnsHostName)
        ?? hostByHostname.get(samName)
        ?? hostByHostname.get(shortDns);

      // Match per IP
      if (!host && comp.ip_address) {
        host = hostByIp.get(comp.ip_address);
      }

      if (!host) continue;

      // Link + enrich (anche se già linkato allo stesso host, aggiorna hostname AD)
      if (comp.host_id !== host.id) {
        linkStmt.run(host.id, comp.integration_id, comp.object_guid);
        linked++;
      }

      enrichHost(host.id, comp, host);
      touchedHostIds.push(host.id);
    }
  })();

  // Attribution v2 (fase 1, parallel-run): rifusione evidenze sugli host toccati
  try {
    const { recomputeAttributionSafe } = require("@/lib/attribution/recompute") as typeof import("@/lib/attribution/recompute");
    for (const id of touchedHostIds) recomputeAttributionSafe(id, "scan");
  } catch (e) {
    console.error("[attribution] recompute da relinkAdComputersForNetwork fallito:", e);
  }

  return { linked, enriched };
}

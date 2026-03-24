/**
 * Active Directory / LDAP client per sincronizzazione computer, utenti e gruppi.
 * Usa ldapts (client LDAP puro TypeScript, compatibile con Next.js).
 */

import { Client, SearchOptions } from "ldapts";
import { decrypt } from "@/lib/crypto";
import {
  getAdIntegrationById,
  updateAdIntegration,
  upsertAdComputer,
  upsertAdUser,
  upsertAdGroup,
  upsertAdDhcpLease,
  syncIpAssignmentsForAllNetworks,
  type AdIntegration,
} from "@/lib/db";

/**
 * Risultato della sincronizzazione AD.
 */
export interface AdSyncResult {
  computers: number;
  users: number;
  groups: number;
  linked_hosts: number;
  dhcp_leases: number;
  dns_resolved: number;
  hosts_created: number;
  hosts_enriched: number;
  errors: string[];
  duration_ms: number;
}

/**
 * Converte timestamp LDAP (Windows FILETIME: 100-nanoseconds dal 1601) in ISO string.
 * Se il valore è 0 o "0" (mai loggato), restituisce null.
 */
function ldapTimestampToIso(val: string | number | undefined | null): string | null {
  if (val == null || val === "0" || val === 0) return null;
  const num = typeof val === "string" ? BigInt(val) : BigInt(val);
  if (num <= BigInt(0)) return null;
  const milliseconds = Number(num / BigInt(10000)) - 11644473600000;
  if (milliseconds < 0 || milliseconds > Date.now() + 86400000 * 365 * 10) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

/**
 * Converte objectGUID (Buffer) in stringa UUID.
 */
function guidBufferToString(buf: Buffer | Uint8Array | undefined): string | null {
  if (!buf || buf.length !== 16) return null;
  const hex = Buffer.from(buf).toString("hex");
  const p1 = hex.slice(6, 8) + hex.slice(4, 6) + hex.slice(2, 4) + hex.slice(0, 2);
  const p2 = hex.slice(10, 12) + hex.slice(8, 10);
  const p3 = hex.slice(14, 16) + hex.slice(12, 14);
  const p4 = hex.slice(16, 20);
  const p5 = hex.slice(20, 32);
  return `${p1}-${p2}-${p3}-${p4}-${p5}`.toLowerCase();
}

/**
 * Estrae valore stringa da attributo LDAP (può essere array o stringa).
 */
function ldapStr(val: unknown): string | null {
  if (val == null) return null;
  if (Array.isArray(val)) return val[0]?.toString() ?? null;
  if (Buffer.isBuffer(val)) return val.toString("utf-8");
  return String(val);
}

/**
 * Estrae la prima OU dal distinguishedName (es. "OU=Workstations,DC=..." → "Workstations").
 */
function ouFromDn(dn: string): string | null {
  const match = dn.match(/OU=([^,]+)/i);
  return match ? match[1] : null;
}

/**
 * Verifica se account è abilitato da userAccountControl.
 * Bit 0x02 = ACCOUNTDISABLE.
 */
function isAccountEnabled(uac: string | number | undefined | null): number {
  if (uac == null) return 1;
  const num = typeof uac === "string" ? parseInt(uac, 10) : uac;
  if (isNaN(num)) return 1;
  return (num & 0x02) === 0 ? 1 : 0;
}

/**
 * Connette a LDAP e restituisce il client.
 */
async function connectLdap(integration: AdIntegration): Promise<Client> {
  let username: string;
  let password: string;
  try {
    username = decrypt(integration.encrypted_username);
    password = decrypt(integration.encrypted_password);
  } catch {
    throw new Error("Impossibile decifrare le credenziali AD. Verificare ENCRYPTION_KEY e riconfigurare l'integrazione.");
  }

  const protocol = integration.use_ssl ? "ldaps" : "ldap";
  const url = `${protocol}://${integration.dc_host}:${integration.port}`;

  const client = new Client({
    url,
    tlsOptions: integration.use_ssl
      ? { rejectUnauthorized: false }
      : undefined,
    connectTimeout: 15000,
    timeout: 60000,
  });

  await client.bind(username, password);
  return client;
}

/**
 * Sincronizza tutti i dati da Active Directory.
 */
export async function syncActiveDirectory(integrationId: number): Promise<AdSyncResult> {
  const started = Date.now();
  const result: AdSyncResult = {
    computers: 0,
    users: 0,
    groups: 0,
    linked_hosts: 0,
    dhcp_leases: 0,
    dns_resolved: 0,
    hosts_created: 0,
    hosts_enriched: 0,
    errors: [],
    duration_ms: 0,
  };

  const integration = getAdIntegrationById(integrationId);
  if (!integration) {
    result.errors.push("Integrazione non trovata");
    result.duration_ms = Date.now() - started;
    return result;
  }

  let client: Client | null = null;
  try {
    client = await connectLdap(integration);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Connessione LDAP fallita: ${msg}`);
    updateAdIntegration(integrationId, {
      last_sync_at: new Date().toISOString(),
      last_sync_status: `Errore: ${msg}`,
    });
    result.duration_ms = Date.now() - started;
    return result;
  }

  const baseDn = integration.base_dn;

  // ═══════════════════════════════════════════════════════════════
  // Sync Computers
  // ═══════════════════════════════════════════════════════════════
  try {
    const computerOpts: SearchOptions = {
      scope: "sub",
      filter: "(&(objectCategory=computer)(objectClass=computer))",
      attributes: [
        "objectGUID",
        "sAMAccountName",
        "dNSHostName",
        "displayName",
        "distinguishedName",
        "operatingSystem",
        "operatingSystemVersion",
        "lastLogonTimestamp",
        "userAccountControl",
        "description",
        "whenCreated",
      ],
      paged: { pageSize: 500 },
      timeLimit: 120,
    };

    const { searchEntries: computers } = await client.search(baseDn, computerOpts);

    for (const entry of computers) {
      try {
        const objectGuid = guidBufferToString(entry.objectGUID as Buffer);
        if (!objectGuid) continue;

        const samAccountName = ldapStr(entry.sAMAccountName) ?? "";
        const dnsHostName = ldapStr(entry.dNSHostName);
        const displayName = ldapStr(entry.displayName);
        const distinguishedName = ldapStr(entry.distinguishedName) ?? "";
        const operatingSystem = ldapStr(entry.operatingSystem);
        const operatingSystemVersion = ldapStr(entry.operatingSystemVersion);
        const lastLogonAt = ldapTimestampToIso(entry.lastLogonTimestamp as string);
        const enabled = isAccountEnabled(entry.userAccountControl as string);

        upsertAdComputer(integrationId, {
          object_guid: objectGuid,
          sam_account_name: samAccountName,
          dns_host_name: dnsHostName,
          display_name: displayName,
          distinguished_name: distinguishedName,
          operating_system: operatingSystem,
          operating_system_version: operatingSystemVersion,
          last_logon_at: lastLogonAt,
          enabled,
          ou: ouFromDn(distinguishedName),
          raw_data: JSON.stringify(entry),
        });
        result.computers++;
      } catch (err) {
        result.errors.push(`Computer sync error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Computer search error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Sync Users
  // ═══════════════════════════════════════════════════════════════
  try {
    const userOpts: SearchOptions = {
      scope: "sub",
      filter: "(&(objectClass=user)(objectCategory=person)(!(objectClass=computer)))",
      attributes: [
        "objectGUID",
        "sAMAccountName",
        "userPrincipalName",
        "displayName",
        "mail",
        "department",
        "title",
        "userAccountControl",
        "lastLogon",
        "pwdLastSet",
        "memberOf",
        "telephoneNumber",
        "whenCreated",
      ],
      paged: { pageSize: 500 },
      timeLimit: 120,
    };

    const { searchEntries: users } = await client.search(baseDn, userOpts);

    for (const entry of users) {
      try {
        const objectGuid = guidBufferToString(entry.objectGUID as Buffer);
        if (!objectGuid) continue;

        const samAccountName = ldapStr(entry.sAMAccountName) ?? "";
        const userPrincipalName = ldapStr(entry.userPrincipalName);
        const displayName = ldapStr(entry.displayName);
        const email = ldapStr(entry.mail);
        const department = ldapStr(entry.department);
        const title = ldapStr(entry.title);
        const phone = ldapStr(entry.telephoneNumber);
        const distinguishedNameUser = ldapStr(entry.distinguishedName) ?? "";
        const enabled = isAccountEnabled(entry.userAccountControl as string);
        const lastLogonAt = ldapTimestampToIso(entry.lastLogon as string);
        const passwordLastSetAt = ldapTimestampToIso(entry.pwdLastSet as string);

        upsertAdUser(integrationId, {
          object_guid: objectGuid,
          sam_account_name: samAccountName,
          user_principal_name: userPrincipalName,
          display_name: displayName,
          email,
          department,
          title,
          phone,
          ou: ouFromDn(distinguishedNameUser),
          enabled,
          last_logon_at: lastLogonAt,
          password_last_set_at: passwordLastSetAt,
          raw_data: JSON.stringify(entry),
        });
        result.users++;
      } catch (err) {
        result.errors.push(`User sync error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`User search error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Sync Groups
  // ═══════════════════════════════════════════════════════════════
  try {
    const groupOpts: SearchOptions = {
      scope: "sub",
      filter: "(objectClass=group)",
      attributes: [
        "objectGUID",
        "sAMAccountName",
        "displayName",
        "description",
        "distinguishedName",
        "groupType",
        "member",
      ],
      paged: { pageSize: 500 },
      timeLimit: 120,
    };

    const { searchEntries: groups } = await client.search(baseDn, groupOpts);

    for (const entry of groups) {
      try {
        const objectGuid = guidBufferToString(entry.objectGUID as Buffer);
        if (!objectGuid) continue;

        const samAccountName = ldapStr(entry.sAMAccountName) ?? "";
        const displayName = ldapStr(entry.displayName);
        const description = ldapStr(entry.description);
        const distinguishedName = ldapStr(entry.distinguishedName) ?? "";
        const groupType = entry.groupType ? parseInt(String(entry.groupType), 10) : null;

        upsertAdGroup(integrationId, {
          object_guid: objectGuid,
          sam_account_name: samAccountName,
          display_name: displayName,
          description,
          distinguished_name: distinguishedName,
          group_type: isNaN(groupType ?? NaN) ? null : groupType,
          member_guids: null,
        });
        result.groups++;
      } catch (err) {
        result.errors.push(`Group sync error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    result.errors.push(`Group search error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Chiudi connessione LDAP
  try {
    await client.unbind();
  } catch {
    // Ignora errori di chiusura
  }

  // ═══════════════════════════════════════════════════════════════
  // DNS forward lookup: risolve IP per computer con dns_host_name
  // ma senza ip_address (né da LDAP né da DHCP già acquisito)
  // ═══════════════════════════════════════════════════════════════
  try {
    const { getDb: getDbDns } = await import("@/lib/db");
    const dbDns = getDbDns();
    const { promises: dnsP } = await import("dns");

    const forDns = dbDns.prepare(`
      SELECT object_guid, dns_host_name
      FROM ad_computers
      WHERE integration_id = ? AND dns_host_name IS NOT NULL AND ip_address IS NULL
    `).all(integrationId) as Array<{ object_guid: string; dns_host_name: string }>;

    for (const comp of forDns) {
      try {
        const addrs = await dnsP.resolve4(comp.dns_host_name);
        if (addrs[0]) {
          dbDns.prepare("UPDATE ad_computers SET ip_address = ? WHERE integration_id = ? AND object_guid = ?")
            .run(addrs[0], integrationId, comp.object_guid);
          result.dns_resolved++;
        }
      } catch { /* hostname non risolvibile */ }
    }
  } catch (err) {
    result.errors.push(`DNS lookup error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Sync DHCP leases (opzionale: richiede winrm_credential_id)
  // ═══════════════════════════════════════════════════════════════
  if (integration.winrm_credential_id) {
    try {
      result.dhcp_leases = await syncAdDhcpLeases(integration);
    } catch (err) {
      result.errors.push(`DHCP sync error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Link computers to existing hosts + crea/arricchisce host IPAM
  // ═══════════════════════════════════════════════════════════════
  try {
    const linkResult = await linkComputersToHosts(integrationId);
    result.linked_hosts = linkResult.linked;
    result.hosts_created = linkResult.created;
    result.hosts_enriched = linkResult.enriched;
  } catch (err) {
    result.errors.push(`Host linking error: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    syncIpAssignmentsForAllNetworks();
  } catch (err) {
    result.errors.push(`IP assignment sync: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Update integration status
  // ═══════════════════════════════════════════════════════════════
  result.duration_ms = Date.now() - started;
  const dhcpPart = result.dhcp_leases > 0 ? `, ${result.dhcp_leases} lease DHCP` : "";
  const dnsPart = result.dns_resolved > 0 ? `, ${result.dns_resolved} IP risolti via DNS` : "";
  const hostPart = (result.hosts_created > 0 || result.hosts_enriched > 0)
    ? `, ${result.hosts_created} host creati, ${result.hosts_enriched} arricchiti`
    : "";
  const statusMsg = result.errors.length > 0
    ? `Completato con ${result.errors.length} errori`
    : `Completato: ${result.computers} computer, ${result.users} utenti, ${result.groups} gruppi${dhcpPart}${dnsPart}${hostPart}`;

  updateAdIntegration(integrationId, {
    last_sync_at: new Date().toISOString(),
    last_sync_status: statusMsg,
    computers_count: result.computers,
    users_count: result.users,
    groups_count: result.groups,
    dhcp_leases_count: result.dhcp_leases,
  });

  return result;
}

/**
 * Sincronizza lease DHCP da Windows Server via WinRM+PowerShell.
 */
async function syncAdDhcpLeases(integration: AdIntegration): Promise<number> {
  const { runWinrmCommand } = await import("@/lib/devices/winrm-run");
  const { getDb, getCredentialById } = await import("@/lib/db");

  if (!integration.winrm_credential_id) return 0;
  const cred = getCredentialById(integration.winrm_credential_id);
  if (!cred) throw new Error("Credenziale WinRM non trovata");

  let username: string;
  let password: string;
  try {
    username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
    password = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
  } catch {
    throw new Error("Impossibile decifrare le credenziali WinRM. Verificare ENCRYPTION_KEY.");
  }
  const host = integration.dc_host;
  const port = 5985;
  const realm = integration.domain || "";

  // Recupera scopes
  const scopesJson = await runWinrmCommand(
    host, port, username, password,
    "Get-DhcpServerv4Scope | ConvertTo-Json -Depth 2 -Compress",
    true,
    realm
  );

  let scopes: Array<{ ScopeId: string; Name?: string }> = [];
  try {
    const raw = JSON.parse(scopesJson);
    scopes = Array.isArray(raw) ? raw : [raw];
  } catch {
    throw new Error(`Risposta DHCP scopes non valida: ${scopesJson.substring(0, 200)}`);
  }

  const db = getDb();
  let total = 0;

  for (const scope of scopes) {
    const scopeId = scope.ScopeId ?? "";
    const scopeName = scope.Name ?? null;
    if (!scopeId) continue;

    let leasesJson: string;
    try {
      leasesJson = await runWinrmCommand(
        host, port, username, password,
        `Get-DhcpServerv4Lease -ScopeId "${scopeId}" | ConvertTo-Json -Depth 2 -Compress`,
        true,
        realm
      );
    } catch {
      continue; // scope senza lease attivi
    }

    let leases: Array<Record<string, unknown>> = [];
    try {
      const raw = JSON.parse(leasesJson);
      leases = Array.isArray(raw) ? raw : [raw];
    } catch {
      continue;
    }

    for (const lease of leases) {
      try {
        const ip = String(lease.IPAddress ?? "").trim();
        const mac = String(lease.ClientId ?? lease.MACAddress ?? "").trim().toLowerCase().replace(/-/g, ":");
        if (!ip || !mac) continue;

        // Converti scadenza
        let leaseExpires: string | null = null;
        const expRaw = lease.LeaseExpiryTime ?? lease.ExpiryTime;
        if (expRaw) {
          try {
            // PowerShell DateTime: "/Date(ms)/" o ISO
            const ms = typeof expRaw === "string" && expRaw.startsWith("/Date(")
              ? parseInt(expRaw.slice(6, -2), 10)
              : NaN;
            leaseExpires = isNaN(ms) ? String(expRaw) : new Date(ms).toISOString();
          } catch { /* ignora */ }
        }

        upsertAdDhcpLease(integration.id, {
          scope_id: scopeId,
          scope_name: scopeName,
          ip_address: ip,
          mac_address: mac,
          hostname: String(lease.HostName ?? lease.ClientId ?? "").trim() || null,
          lease_expires: leaseExpires,
          address_state: String(lease.AddressState ?? "").trim() || null,
          description: String(lease.Description ?? "").trim() || null,
        });

        // Aggiorna ip_address su ad_computers per correlazione
        if (lease.HostName) {
          const hn = String(lease.HostName).toLowerCase().trim();
          db.prepare(`UPDATE ad_computers SET ip_address = ? WHERE integration_id = ? AND (LOWER(dns_host_name) LIKE ? OR LOWER(sam_account_name) = ?) AND ip_address IS NULL`)
            .run(ip, integration.id, `${hn}%`, hn.replace(/\$$/, ""));
        }

        total++;
      } catch { /* ignora singolo lease */ }
    }
  }

  return total;
}

/**
 * Collega computer AD agli host IPAM, arricchisce i dati esistenti e crea nuovi host
 * se l'IP è noto (da DNS/DHCP) e cade in una subnet gestita.
 */
async function linkComputersToHosts(integrationId: number): Promise<{ linked: number; created: number; enriched: number }> {
  const { getDb, linkAdComputerToHost: linkHost, upsertHost, getNetworkContainingIp } = await import("@/lib/db");
  const db = getDb();
  let linked = 0;
  let created = 0;
  let enriched = 0;

  const computers = db
    .prepare(`SELECT id, object_guid, dns_host_name, sam_account_name, ip_address,
                     display_name, operating_system
              FROM ad_computers WHERE integration_id = ? AND host_id IS NULL`)
    .all(integrationId) as Array<{
      id: number; object_guid: string; dns_host_name: string | null;
      sam_account_name: string; ip_address: string | null;
      display_name: string | null; operating_system: string | null;
    }>;

  for (const comp of computers) {
    try {
      const dnsHostName = comp.dns_host_name?.toLowerCase() ?? "";
      const samName = comp.sam_account_name.replace(/\$$/, "").toLowerCase();
      const shortDns = dnsHostName.split(".")[0];

      type HostRow = { id: number; ip: string; hostname: string | null; os_info: string | null; classification: string | null };

      // 1. Cerca per hostname/dns nei host IPAM
      let host: HostRow | undefined = (dnsHostName || samName) ? db.prepare(`
        SELECT id, ip, hostname, os_info, classification FROM hosts
        WHERE LOWER(hostname) = ? OR LOWER(hostname) = ? OR LOWER(hostname) = ?
           OR LOWER(dns_forward) LIKE ? OR LOWER(dns_reverse) LIKE ?
        LIMIT 1
      `).get(dnsHostName, samName, shortDns, `%${dnsHostName}%`, `%${dnsHostName}%`) as HostRow | undefined : undefined;

      // 2. Cerca per IP (da DNS lookup o DHCP)
      if (!host && comp.ip_address) {
        host = db.prepare("SELECT id, ip, hostname, os_info, classification FROM hosts WHERE ip = ? LIMIT 1")
          .get(comp.ip_address) as HostRow | undefined;
      }

      // 3. Cerca per MAC (da ad_dhcp_leases — Windows Server DHCP)
      if (!host && (dnsHostName || samName)) {
        const dhcpLease = db.prepare(`
          SELECT mac_address FROM ad_dhcp_leases
          WHERE integration_id = ? AND hostname IS NOT NULL
            AND (LOWER(hostname) LIKE ? OR LOWER(hostname) LIKE ? OR LOWER(hostname) LIKE ?)
          LIMIT 1
        `).get(integrationId, `${dnsHostName}%`, `${samName}%`, `${shortDns}%`) as { mac_address: string } | undefined;
        if (dhcpLease?.mac_address) {
          host = db.prepare("SELECT id, ip, hostname, os_info, classification FROM hosts WHERE LOWER(mac) = ? LIMIT 1")
            .get(dhcpLease.mac_address.toLowerCase()) as HostRow | undefined;
        }
      }

      // 4. Cerca per MAC (da mac_ip_mapping — DHCP MikroTik e altri)
      if (!host && (dnsHostName || samName)) {
        const mipLease = db.prepare(`
          SELECT mac_normalized FROM mac_ip_mapping
          WHERE source = 'dhcp' AND hostname IS NOT NULL
            AND (LOWER(hostname) = ? OR LOWER(hostname) = ? OR LOWER(hostname) = ?
                 OR LOWER(hostname) LIKE ? OR LOWER(hostname) LIKE ?)
          ORDER BY last_seen DESC LIMIT 1
        `).get(samName, dnsHostName, shortDns, `${samName}.%`, `${shortDns}.%`) as { mac_normalized: string } | undefined;
        if (mipLease?.mac_normalized) {
          host = db.prepare(`
            SELECT id, ip, hostname, os_info, classification FROM hosts
            WHERE LOWER(mac) = ? OR LOWER(REPLACE(mac, ':', '')) = LOWER(REPLACE(?, ':', ''))
            LIMIT 1
          `).get(mipLease.mac_normalized, mipLease.mac_normalized) as HostRow | undefined;
        }
      }

      // Calcola classificazione e OS string per enrich/create
      const osRaw = comp.operating_system ?? "";
      const osLower = osRaw.toLowerCase();
      const classification = osLower.includes("server") ? "server_windows" : "workstation";
      const hostname = comp.dns_host_name ?? comp.sam_account_name.replace(/\$$/, "");

      if (host) {
        // ── Host trovato: collega e arricchisce ──────────────────────────
        linkHost(integrationId, comp.object_guid, host.id);

        const updates: Record<string, string> = {};
        if (osRaw && (!host.os_info || host.os_info === "unknown")) updates.os_info = osRaw;
        // AD è la fonte più affidabile per hostname: sovrascrive SEMPRE
        if (hostname) { updates.hostname = hostname; updates.hostname_source = "ad"; }
        if (!host.classification || host.classification === "unknown") updates.classification = classification;

        if (Object.keys(updates).length > 0) {
          const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
          db.prepare(`UPDATE hosts SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
            .run(...Object.values(updates), host.id);
          enriched++;
        }

        linked++;
      } else if (comp.ip_address) {
        // ── Nessun host trovato ma IP noto: crea se l'IP è in una subnet gestita ──
        const network = getNetworkContainingIp(comp.ip_address);
        if (network) {
          const notes = `[AD: ${hostname}]${osRaw ? ` ${osRaw}` : ""}`;
          upsertHost({
            network_id: network.id,
            ip: comp.ip_address,
            hostname,
            hostname_source: "ad",
            os_info: osRaw || undefined,
            classification,
            notes,
            status: "unknown",
          } as Parameters<typeof upsertHost>[0]);

          // Dopo creazione, trova il nuovo host e collega
          const newHost = db.prepare("SELECT id FROM hosts WHERE ip = ? LIMIT 1").get(comp.ip_address) as { id: number } | undefined;
          if (newHost) {
            linkHost(integrationId, comp.object_guid, newHost.id);
            created++;
            linked++;
          }
        }
      }
    } catch { /* errore su singolo computer, continua */ }
  }

  return { linked, created, enriched };
}

/**
 * Test connessione LDAP senza sincronizzare.
 */
export async function testAdConnection(integrationId: number): Promise<{ success: boolean; message: string }> {
  const integration = getAdIntegrationById(integrationId);
  if (!integration) {
    return { success: false, message: "Integrazione non trovata" };
  }

  let client: Client | null = null;
  try {
    client = await connectLdap(integration);

    // Verifica base DN
    const { searchEntries: baseEntries } = await client.search(integration.base_dn, {
      scope: "base",
      filter: "(objectClass=*)",
      attributes: ["distinguishedName"],
    });
    const dn = baseEntries[0]?.distinguishedName ?? integration.base_dn;

    // Conta computer e utenti (paginato, timeLimit ridotto per velocità)
    let computerCount = 0;
    let userCount = 0;
    try {
      const { searchEntries: comps } = await client.search(integration.base_dn, {
        scope: "sub",
        filter: "(&(objectCategory=computer)(objectClass=computer))",
        attributes: ["objectGUID"],
        paged: { pageSize: 5 },
        timeLimit: 8,
      });
      computerCount = comps.length;
    } catch { /* ignora */ }
    try {
      const { searchEntries: usrs } = await client.search(integration.base_dn, {
        scope: "sub",
        filter: "(&(objectClass=user)(objectCategory=person)(!(objectClass=computer)))",
        attributes: ["objectGUID"],
        paged: { pageSize: 5 },
        timeLimit: 8,
      });
      userCount = usrs.length;
    } catch { /* ignora */ }

    // Ignora errori di unbind (connessione già chiusa dal server dopo le probing searches)
    try { await client.unbind(); } catch { /* ignora */ }

    const objectsInfo = (computerCount === 0 && userCount === 0)
      ? " — nessun oggetto trovato (verifica Base DN o permessi dell'utente LDAP)"
      : ` — trovati ≥${computerCount} computer, ≥${userCount} utenti`;

    return {
      success: true,
      message: `Connesso a ${integration.dc_host}, DN: ${dn}${objectsInfo}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Diagnosi ECONNRESET / ECONNREFUSED: quasi sempre LDAPS non configurato sul DC
    if (msg.includes("ECONNRESET") || msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT")) {
      const proto = integration.use_ssl ? "LDAPS" : "LDAP";
      const hint = integration.use_ssl
        ? `Connessione ${proto} su porta ${integration.port} rifiutata dal DC. Probabilmente LDAPS non è abilitato (richiede AD Certificate Services o un certificato SSL sul DC). Prova a disabilitare SSL e usare la porta 389 (LDAP plain).`
        : `Connessione ${proto} su porta ${integration.port} rifiutata. Verifica che il DC sia raggiungibile e che la porta non sia bloccata da firewall.`;
      return { success: false, message: hint };
    }

    // Diagnosi credenziali non valide (LDAP error 49 / data 52e)
    if (msg.includes("52e") || msg.includes("data 52e") || msg.includes("AcceptSecurityContext") || msg.includes("Invalid credentials") || msg.includes("0x31")) {
      return {
        success: false,
        message: `Credenziali non valide (errore AD 52e). Verifica username e password. Formati accettati: "DOMINIO\\utente", "utente@dominio.local", oppure il DN completo "CN=utente,CN=Users,DC=dominio,DC=local".`,
      };
    }

    // Diagnosi account bloccato/scaduto (data 775 = account locked, 532 = password scaduta)
    if (msg.includes("data 775") || msg.includes("775:")) {
      return { success: false, message: "Account bloccato sul DC. Sblocca l'account in Active Directory Users and Computers." };
    }
    if (msg.includes("data 532") || msg.includes("532:")) {
      return { success: false, message: "Password scaduta per l'account di servizio. Reimposta la password sul DC." };
    }

    return { success: false, message: msg };
  }
}

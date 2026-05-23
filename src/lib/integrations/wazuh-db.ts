/**
 * CRUD tabelle Wazuh nel DB tenant.
 *
 * Modello sync: per ogni agent_id, le tabelle wazuh_software e wazuh_vuln
 * vengono ricostruite in transazione (DELETE+INSERT) ad ogni run. wazuh_agent,
 * wazuh_hw e wazuh_os sono upserted (un record per agent).
 */

import { getTenantDb, getCurrentTenantCode } from "../db-tenant";
import type {
  WazuhAgent,
  WazuhSyscollectorHotfix,
  WazuhSyscollectorHw,
  WazuhSyscollectorNetaddr,
  WazuhSyscollectorNetiface,
  WazuhSyscollectorOs,
  WazuhSyscollectorPackage,
  WazuhSyscollectorPort,
  WazuhVulnerability,
} from "./wazuh-api";

function db() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto tenant attivo");
  return getTenantDb(code);
}

// ────────────────────────────────────────────────────────────────────────
// Row types (forma persistita)
// ────────────────────────────────────────────────────────────────────────

export interface WazuhAgentRow {
  agent_id: string;
  host_id: number | null;
  name: string | null;
  ip: string | null;
  mac: string | null;
  hostname: string | null;
  os_platform: string | null;
  os_name: string | null;
  os_version: string | null;
  os_arch: string | null;
  agent_version: string | null;
  status: string | null;
  node_name: string | null;
  manager_host: string | null;
  last_keep_alive: string | null;
  registered_at: string | null;
  synced_at: string;
}

export interface WazuhHwRow {
  agent_id: string;
  board_serial: string | null;
  board_vendor: string | null;
  board_product: string | null;
  cpu_name: string | null;
  cpu_cores: number | null;
  cpu_mhz: number | null;
  ram_total_kb: number | null;
  ram_free_kb: number | null;
  scan_time: string | null;
  synced_at: string;
}

export interface WazuhOsRow {
  agent_id: string;
  hostname: string | null;
  architecture: string | null;
  os_name: string | null;
  os_version: string | null;
  os_codename: string | null;
  os_major: string | null;
  os_minor: string | null;
  os_build: string | null;
  os_platform: string | null;
  sysname: string | null;
  release: string | null;
  version_full: string | null;
  scan_time: string | null;
  synced_at: string;
}

export interface WazuhSoftwareRow {
  id: number;
  agent_id: string;
  name: string;
  version: string | null;
  vendor: string | null;
  architecture: string | null;
  format: string | null;
  source: string | null;
  install_time: string | null;
  description: string | null;
  scan_time: string | null;
  synced_at: string;
}

export interface WazuhPortRow {
  id: number;
  agent_id: string;
  protocol: string | null;
  local_ip: string | null;
  local_port: number | null;
  state: string | null;
  process: string | null;
  pid: number | null;
  scan_time: string | null;
  synced_at: string;
}

export interface WazuhHotfixRow {
  id: number;
  agent_id: string;
  hotfix: string;
  scan_time: string | null;
  synced_at: string;
}

export interface WazuhNetifaceRow {
  id: number;
  agent_id: string;
  name: string;
  mac: string | null;
  type: string | null;
  state: string | null;
  mtu: number | null;
  scan_time: string | null;
  synced_at: string;
}

export interface WazuhNetaddrRow {
  id: number;
  agent_id: string;
  iface: string | null;
  proto: string | null;
  address: string;
  netmask: string | null;
  broadcast: string | null;
  scan_time: string | null;
  synced_at: string;
}

export interface WazuhVulnRow {
  id: number;
  agent_id: string;
  cve: string;
  severity: string | null;
  cvss2_score: number | null;
  cvss3_score: number | null;
  package_name: string | null;
  package_version: string | null;
  package_architecture: string | null;
  status: string | null;
  detection_time: string | null;
  published: string | null;
  updated: string | null;
  condition_: string | null;
  title: string | null;
  external_references: string | null;
  scan_time: string | null;
  synced_at: string;
}

// ────────────────────────────────────────────────────────────────────────
// Upsert / replace
// ────────────────────────────────────────────────────────────────────────

export function upsertWazuhAgent(agent: WazuhAgent, hostId: number | null, mac: string | null): void {
  db().prepare(
    `INSERT INTO wazuh_agent (
       agent_id, host_id, name, ip, mac, hostname,
       os_platform, os_name, os_version, os_arch,
       agent_version, status, node_name, manager_host,
       last_keep_alive, registered_at, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(agent_id) DO UPDATE SET
       host_id         = excluded.host_id,
       name            = excluded.name,
       ip              = excluded.ip,
       mac             = excluded.mac,
       hostname        = excluded.hostname,
       os_platform     = excluded.os_platform,
       os_name         = excluded.os_name,
       os_version      = excluded.os_version,
       os_arch         = excluded.os_arch,
       agent_version   = excluded.agent_version,
       status          = excluded.status,
       node_name       = excluded.node_name,
       manager_host    = excluded.manager_host,
       last_keep_alive = excluded.last_keep_alive,
       registered_at   = excluded.registered_at,
       synced_at       = datetime('now')`,
  ).run(
    agent.id,
    hostId,
    agent.name ?? null,
    agent.ip ?? agent.registerIP ?? null,
    mac,
    agent.os?.uname ?? null,
    agent.os?.platform ?? null,
    agent.os?.name ?? null,
    agent.os?.version ?? null,
    agent.os?.arch ?? null,
    agent.version ?? null,
    agent.status ?? null,
    agent.node_name ?? null,
    agent.manager ?? null,
    agent.lastKeepAlive ?? null,
    agent.dateAdd ?? null,
  );
}

export function upsertWazuhHw(agentId: string, hw: WazuhSyscollectorHw): void {
  db().prepare(
    `INSERT INTO wazuh_hw (
       agent_id, board_serial, board_vendor, board_product,
       cpu_name, cpu_cores, cpu_mhz, ram_total_kb, ram_free_kb,
       scan_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(agent_id) DO UPDATE SET
       board_serial  = excluded.board_serial,
       board_vendor  = excluded.board_vendor,
       board_product = excluded.board_product,
       cpu_name      = excluded.cpu_name,
       cpu_cores     = excluded.cpu_cores,
       cpu_mhz       = excluded.cpu_mhz,
       ram_total_kb  = excluded.ram_total_kb,
       ram_free_kb   = excluded.ram_free_kb,
       scan_time     = excluded.scan_time,
       synced_at     = datetime('now')`,
  ).run(
    agentId,
    hw.board_serial ?? null,
    hw.board_vendor ?? null,
    hw.board_product ?? null,
    hw.cpu?.name ?? null,
    hw.cpu?.cores ?? null,
    hw.cpu?.mhz ?? null,
    hw.ram?.total ?? null,
    hw.ram?.free ?? null,
    hw.scan?.time ?? null,
  );
}

export function upsertWazuhOs(agentId: string, os: WazuhSyscollectorOs): void {
  db().prepare(
    `INSERT INTO wazuh_os (
       agent_id, hostname, architecture,
       os_name, os_version, os_codename, os_major, os_minor, os_build, os_platform,
       sysname, release, version_full, scan_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(agent_id) DO UPDATE SET
       hostname      = excluded.hostname,
       architecture  = excluded.architecture,
       os_name       = excluded.os_name,
       os_version    = excluded.os_version,
       os_codename   = excluded.os_codename,
       os_major      = excluded.os_major,
       os_minor      = excluded.os_minor,
       os_build      = excluded.os_build,
       os_platform   = excluded.os_platform,
       sysname       = excluded.sysname,
       release       = excluded.release,
       version_full  = excluded.version_full,
       scan_time     = excluded.scan_time,
       synced_at     = datetime('now')`,
  ).run(
    agentId,
    os.hostname ?? null,
    os.architecture ?? null,
    os.os?.name ?? null,
    os.os?.version ?? null,
    os.os?.codename ?? null,
    os.os?.major ?? null,
    os.os?.minor ?? null,
    os.os?.build ?? null,
    os.os?.platform ?? null,
    os.sysname ?? null,
    os.release ?? null,
    os.version ?? null,
    os.scan?.time ?? null,
  );
}

export function replaceSoftwareForAgent(agentId: string, packages: WazuhSyscollectorPackage[]): number {
  const d = db();
  const del = d.prepare("DELETE FROM wazuh_software WHERE agent_id = ?");
  const ins = d.prepare(
    `INSERT OR IGNORE INTO wazuh_software (
       agent_id, name, version, vendor, architecture, format, source,
       install_time, description, scan_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  let inserted = 0;
  d.transaction(() => {
    del.run(agentId);
    for (const p of packages) {
      const name = (p.name ?? "").trim();
      if (!name) continue;
      ins.run(
        agentId,
        name,
        p.version ?? null,
        p.vendor ?? null,
        p.architecture ?? null,
        p.format ?? null,
        p.source ?? null,
        p.install_time ?? null,
        p.description ?? null,
        p.scan?.time ?? null,
      );
      inserted++;
    }
  })();
  return inserted;
}

export function replaceVulnsForAgent(agentId: string, vulns: WazuhVulnerability[]): number {
  const d = db();
  const del = d.prepare("DELETE FROM wazuh_vuln WHERE agent_id = ?");
  const ins = d.prepare(
    `INSERT OR IGNORE INTO wazuh_vuln (
       agent_id, cve, severity, cvss2_score, cvss3_score,
       package_name, package_version, package_architecture, status,
       detection_time, published, updated, condition_, title,
       external_references, scan_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  let inserted = 0;
  d.transaction(() => {
    del.run(agentId);
    for (const v of vulns) {
      const cve = (v.cve ?? "").trim();
      if (!cve) continue;
      const refs = Array.isArray(v.external_references)
        ? v.external_references.join("\n")
        : (v.external_references ?? null);
      ins.run(
        agentId,
        cve,
        v.severity ?? null,
        v.cvss2_score ?? null,
        v.cvss3_score ?? null,
        v.name ?? null,
        v.version ?? null,
        v.architecture ?? null,
        v.status ?? null,
        v.detection_time ?? null,
        v.published ?? null,
        v.updated ?? null,
        v.condition ?? null,
        v.title ?? null,
        refs,
        null,
      );
      inserted++;
    }
  })();
  return inserted;
}

// ────────────────────────────────────────────────────────────────────────
// Read
// ────────────────────────────────────────────────────────────────────────

export function getWazuhAgentByHostId(hostId: number): WazuhAgentRow | null {
  return db().prepare("SELECT * FROM wazuh_agent WHERE host_id = ?").get(hostId) as WazuhAgentRow | null;
}

/** Batch: ritorna mappa host_id → WazuhAgentRow (solo per host_id forniti che hanno match). */
export function getWazuhAgentsByHostIds(hostIds: number[]): Map<number, WazuhAgentRow> {
  const out = new Map<number, WazuhAgentRow>();
  if (hostIds.length === 0) return out;
  const placeholders = hostIds.map(() => "?").join(",");
  const rows = db()
    .prepare(`SELECT * FROM wazuh_agent WHERE host_id IN (${placeholders})`)
    .all(...hostIds) as WazuhAgentRow[];
  for (const row of rows) {
    if (row.host_id != null) out.set(row.host_id, row);
  }
  return out;
}

export function getWazuhAgentByAgentId(agentId: string): WazuhAgentRow | null {
  return db().prepare("SELECT * FROM wazuh_agent WHERE agent_id = ?").get(agentId) as WazuhAgentRow | null;
}

export function listAllWazuhAgents(): WazuhAgentRow[] {
  return db().prepare("SELECT * FROM wazuh_agent ORDER BY name COLLATE NOCASE").all() as WazuhAgentRow[];
}

export function getWazuhHw(agentId: string): WazuhHwRow | null {
  return db().prepare("SELECT * FROM wazuh_hw WHERE agent_id = ?").get(agentId) as WazuhHwRow | null;
}

export function getWazuhOs(agentId: string): WazuhOsRow | null {
  return db().prepare("SELECT * FROM wazuh_os WHERE agent_id = ?").get(agentId) as WazuhOsRow | null;
}

/**
 * Sostituisce le porte in ascolto dell'agent. Solo state="listening" persistito.
 * Dedup su (agent_id, protocol, local_ip, local_port).
 * @returns numero di righe inserite.
 */
export function replacePortsForAgent(agentId: string, ports: WazuhSyscollectorPort[]): number {
  const d = db();
  const insert = d.prepare(
    `INSERT OR IGNORE INTO wazuh_ports (
       agent_id, protocol, local_ip, local_port, state, process, pid, scan_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  let inserted = 0;
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM wazuh_ports WHERE agent_id = ?").run(agentId);
    for (const p of ports) {
      const state = (p.state ?? "").toLowerCase();
      if (state !== "listening") continue;
      const r = insert.run(
        agentId,
        p.protocol ?? null,
        p.local?.ip ?? null,
        p.local?.port ?? null,
        state,
        p.process ?? null,
        p.pid ?? null,
        p.scan?.time ?? null,
      );
      if (r.changes) inserted++;
    }
  });
  tx();
  return inserted;
}

export function listWazuhPorts(agentId: string): WazuhPortRow[] {
  return db()
    .prepare(
      "SELECT * FROM wazuh_ports WHERE agent_id = ? ORDER BY protocol, local_port",
    )
    .all(agentId) as WazuhPortRow[];
}

/**
 * Sostituisce le hotfix dell'agent (DELETE+INSERT in transazione).
 * Per agent Linux/Mac wazuh restituisce [] e la tabella resta vuota.
 */
export function replaceHotfixesForAgent(agentId: string, hotfixes: WazuhSyscollectorHotfix[]): number {
  const d = db();
  const insert = d.prepare(
    `INSERT OR IGNORE INTO wazuh_hotfix (agent_id, hotfix, scan_time, synced_at)
     VALUES (?, ?, ?, datetime('now'))`,
  );
  let inserted = 0;
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM wazuh_hotfix WHERE agent_id = ?").run(agentId);
    for (const h of hotfixes) {
      const id = (h.hotfix ?? "").trim();
      if (!id) continue;
      const r = insert.run(agentId, id, h.scan?.time ?? null);
      if (r.changes) inserted++;
    }
  });
  tx();
  return inserted;
}

export function listWazuhHotfixes(agentId: string): WazuhHotfixRow[] {
  return db()
    .prepare("SELECT * FROM wazuh_hotfix WHERE agent_id = ? ORDER BY hotfix DESC")
    .all(agentId) as WazuhHotfixRow[];
}

/**
 * Sostituisce le interfacce di rete dell'agent. Skippa entry senza name.
 * Filtra opzionalmente interfacce di loopback se utile, ma per ora persiste tutto.
 */
export function replaceNetifacesForAgent(agentId: string, ifaces: WazuhSyscollectorNetiface[]): number {
  const d = db();
  const insert = d.prepare(
    `INSERT OR IGNORE INTO wazuh_netiface (
       agent_id, name, mac, type, state, mtu, scan_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  let inserted = 0;
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM wazuh_netiface WHERE agent_id = ?").run(agentId);
    for (const n of ifaces) {
      const name = (n.name ?? "").trim();
      if (!name) continue;
      const r = insert.run(
        agentId,
        name,
        n.mac ?? null,
        n.type ?? null,
        n.state ?? null,
        n.mtu ?? null,
        n.scan?.time ?? null,
      );
      if (r.changes) inserted++;
    }
  });
  tx();
  return inserted;
}

/**
 * Sostituisce gli indirizzi IP dell'agent (multipli per interfaccia).
 * Dedup su (agent_id, iface, address).
 */
export function replaceNetaddrsForAgent(agentId: string, addrs: WazuhSyscollectorNetaddr[]): number {
  const d = db();
  const insert = d.prepare(
    `INSERT OR IGNORE INTO wazuh_netaddr (
       agent_id, iface, proto, address, netmask, broadcast, scan_time, synced_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  );
  let inserted = 0;
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM wazuh_netaddr WHERE agent_id = ?").run(agentId);
    for (const a of addrs) {
      const address = (a.address ?? "").trim();
      if (!address) continue;
      const r = insert.run(
        agentId,
        a.iface ?? null,
        a.proto ?? null,
        address,
        a.netmask ?? null,
        a.broadcast ?? null,
        a.scan?.time ?? null,
      );
      if (r.changes) inserted++;
    }
  });
  tx();
  return inserted;
}

export function listWazuhNetifaces(agentId: string): WazuhNetifaceRow[] {
  return db()
    .prepare("SELECT * FROM wazuh_netiface WHERE agent_id = ? ORDER BY name")
    .all(agentId) as WazuhNetifaceRow[];
}

export function listWazuhNetaddrs(agentId: string): WazuhNetaddrRow[] {
  return db()
    .prepare("SELECT * FROM wazuh_netaddr WHERE agent_id = ? ORDER BY iface, proto, address")
    .all(agentId) as WazuhNetaddrRow[];
}

export function listWazuhSoftware(agentId: string): WazuhSoftwareRow[] {
  return db().prepare(
    "SELECT * FROM wazuh_software WHERE agent_id = ? ORDER BY name COLLATE NOCASE",
  ).all(agentId) as WazuhSoftwareRow[];
}

export function listWazuhVulns(agentId: string): WazuhVulnRow[] {
  return db().prepare(
    `SELECT * FROM wazuh_vuln
     WHERE agent_id = ?
     ORDER BY CASE severity
              WHEN 'Critical' THEN 0
              WHEN 'High' THEN 1
              WHEN 'Medium' THEN 2
              WHEN 'Low' THEN 3
              ELSE 4 END,
              cvss3_score DESC NULLS LAST,
              cve`,
  ).all(agentId) as WazuhVulnRow[];
}

export function countsForAgent(agentId: string): { software: number; vulns: number; vulnsCritical: number; vulnsHigh: number; ports: number; hotfixes: number; netifaces: number; netaddrs: number } {
  const d = db();
  const sw = d.prepare("SELECT COUNT(*) AS c FROM wazuh_software WHERE agent_id = ?").get(agentId) as { c: number };
  const vAll = d.prepare("SELECT COUNT(*) AS c FROM wazuh_vuln WHERE agent_id = ?").get(agentId) as { c: number };
  const vCrit = d.prepare("SELECT COUNT(*) AS c FROM wazuh_vuln WHERE agent_id = ? AND severity = 'Critical'").get(agentId) as { c: number };
  const vHigh = d.prepare("SELECT COUNT(*) AS c FROM wazuh_vuln WHERE agent_id = ? AND severity = 'High'").get(agentId) as { c: number };
  const pts = d.prepare("SELECT COUNT(*) AS c FROM wazuh_ports WHERE agent_id = ?").get(agentId) as { c: number };
  const hf = d.prepare("SELECT COUNT(*) AS c FROM wazuh_hotfix WHERE agent_id = ?").get(agentId) as { c: number };
  const nif = d.prepare("SELECT COUNT(*) AS c FROM wazuh_netiface WHERE agent_id = ?").get(agentId) as { c: number };
  const nad = d.prepare("SELECT COUNT(*) AS c FROM wazuh_netaddr WHERE agent_id = ?").get(agentId) as { c: number };
  return { software: sw.c, vulns: vAll.c, vulnsCritical: vCrit.c, vulnsHigh: vHigh.c, ports: pts.c, hotfixes: hf.c, netifaces: nif.c, netaddrs: nad.c };
}

export function deleteWazuhAgentsExcept(activeAgentIds: string[]): number {
  const d = db();
  if (activeAgentIds.length === 0) {
    return d.prepare("DELETE FROM wazuh_agent").run().changes;
  }
  const placeholders = activeAgentIds.map(() => "?").join(",");
  return d.prepare(`DELETE FROM wazuh_agent WHERE agent_id NOT IN (${placeholders})`).run(...activeAgentIds).changes;
}

/**
 * Arricchisce hosts.* con dati Wazuh syscollector (OS + HW).
 * Riempie solo i campi vuoti o "unknown": valori già popolati da altre fonti
 * (SNMP, AD, input manuale) restano intoccati.
 */
export function enrichHostFromWazuh(
  hostId: number,
  hw: WazuhSyscollectorHw | null,
  os: WazuhSyscollectorOs | null,
): number {
  if (!hw && !os) return 0;
  const d = db();
  const current = d.prepare(
    "SELECT os_info, model, serial_number, device_manufacturer FROM hosts WHERE id = ?",
  ).get(hostId) as
    | { os_info: string | null; model: string | null; serial_number: string | null; device_manufacturer: string | null }
    | undefined;
  if (!current) return 0;

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (isEmptyOrUnknown(current.os_info) && os) {
    const s = buildOsString(os);
    if (s) { sets.push("os_info = ?"); vals.push(s); }
  }
  if (isEmptyOrUnknown(current.serial_number) && hw?.board_serial) {
    const v = cleanField(hw.board_serial);
    if (v && v !== "0") { sets.push("serial_number = ?"); vals.push(v); }
  }
  if (isEmptyOrUnknown(current.model) && hw?.board_product) {
    const v = cleanField(hw.board_product);
    if (v) { sets.push("model = ?"); vals.push(v); }
  }
  if (isEmptyOrUnknown(current.device_manufacturer) && hw?.board_vendor) {
    const v = cleanField(hw.board_vendor);
    if (v) { sets.push("device_manufacturer = ?"); vals.push(v); }
  }

  if (sets.length === 0) return 0;
  const updated = sets.length;
  sets.push("updated_at = datetime('now')");
  d.prepare(`UPDATE hosts SET ${sets.join(", ")} WHERE id = ?`).run(...vals, hostId);
  return updated;
}

function isEmptyOrUnknown(v: string | null | undefined): boolean {
  if (!v) return true;
  const t = v.trim().toLowerCase();
  return t === "" || t === "unknown";
}

function cleanField(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (t.toLowerCase() === "unknown") return null;
  return t;
}

function buildOsString(os: WazuhSyscollectorOs): string | null {
  const name = (os.os?.name ?? "").trim();
  const ver = (os.os?.version ?? "").trim();
  const arch = (os.architecture ?? "").trim();
  let s = "";
  if (name) s = name;
  if (ver) s = s ? `${s} ${ver}` : ver;
  if (s && arch) s = `${s} (${arch})`;
  return s || null;
}

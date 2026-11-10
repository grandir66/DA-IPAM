/**
 * Sistema operativo dalle prove già raccolte (NTLM, SNMP, SSH), senza nmap -O.
 * Si scrive su hosts.os_info solo se è vuoto: l'anagrafica autenticata resta.
 */
import type Database from "better-sqlite3";
import type { InfoNtlm, InfoSsh } from "./sonde";

export type FonteOs = "ntlm" | "snmp" | "ssh" | "archivio";

export interface SceltaOs {
  os: string;
  fonte: FonteOs;
}

export interface ServizioPrimaLettura {
  porta: number;
  protocollo: string;
  nome: string | null;
  prodotto: string | null;
  versione: string | null;
  metodo: string | null;
}

export interface ChiavePrimaLettura {
  tipo: string;
  valore: string;
  fonte: string;
  porta: number | null;
  visto: string;
}

export interface AltroIpPrimaLettura {
  id: number;
  ip: string;
  rete: string | null;
}

export interface PrimaLettura {
  id: number;
  ip: string;
  hostname: string | null;
  mac: string | null;
  vendor: string | null;
  os: string | null;
  os_fonte: FonteOs | null;
  dominio: string | null;
  ttl: number | null;
  servizi: ServizioPrimaLettura[];
  chiavi: ChiavePrimaLettura[];
  altri_ip: AltroIpPrimaLettura[];
}

const BUILD_WINDOWS: Array<{ prefisso: string; nome: string }> = [
  { prefisso: "10.0.26100", nome: "Windows 11 / Server 2025" },
  { prefisso: "10.0.22631", nome: "Windows 11" },
  { prefisso: "10.0.22621", nome: "Windows 11" },
  { prefisso: "10.0.22000", nome: "Windows 11" },
  { prefisso: "10.0.20348", nome: "Windows Server 2022" },
  { prefisso: "10.0.19045", nome: "Windows 10" },
  { prefisso: "10.0.19044", nome: "Windows 10" },
  { prefisso: "10.0.19043", nome: "Windows 10" },
  { prefisso: "10.0.19042", nome: "Windows 10" },
  { prefisso: "10.0.19041", nome: "Windows 10" },
  { prefisso: "10.0.17763", nome: "Windows Server 2019" },
  { prefisso: "10.0.14393", nome: "Windows Server 2016" },
  { prefisso: "6.3", nome: "Windows 8.1 / Server 2012 R2" },
  { prefisso: "6.2", nome: "Windows 8 / Server 2012" },
  { prefisso: "6.1", nome: "Windows 7 / Server 2008 R2" },
  { prefisso: "6.0", nome: "Windows Vista / Server 2008" },
  { prefisso: "5.1", nome: "Windows XP" },
];

const DISTRO_SSH: Array<{ ago: string; os: string }> = [
  { ago: "ubuntu", os: "Linux (Ubuntu)" },
  { ago: "raspbian", os: "Linux (Raspbian)" },
  { ago: "debian", os: "Linux (Debian)" },
  { ago: "freebsd", os: "FreeBSD" },
  { ago: "openbsd", os: "OpenBSD" },
  { ago: "centos", os: "Linux (CentOS)" },
  { ago: "rhel", os: "Linux (RHEL)" },
  { ago: "red hat", os: "Linux (RHEL)" },
  { ago: "fedora", os: "Linux (Fedora)" },
  { ago: "alpine", os: "Linux (Alpine)" },
  { ago: "suse", os: "Linux (SUSE)" },
  { ago: "openssh_for_windows", os: "Windows" },
];

function testo(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function versioneNt(v: string): boolean {
  const parti = v.split(".");
  if (parti.length < 2 || parti.length > 4) return false;
  return parti.every((p) => p !== "" && p.length <= 5 && /^\d+$/.test(p));
}

/** CHALLENGE NTLM: build nota → nome; altrimenti «Windows (10.0.x)». */
export function osDaVersioneNtlm(versione: string | null | undefined): string | null {
  const v = testo(versione);
  if (!v) return null;
  if (!versioneNt(v) && /windows|server/i.test(v)) return v;
  if (!versioneNt(v)) return null;
  for (const r of BUILD_WINDOWS) {
    if (v === r.prefisso || v.startsWith(`${r.prefisso}.`)) return r.nome;
  }
  return `Windows (${v})`;
}

/** Banner SSH: distro dal testo, se c'è. */
export function osDaBannerSsh(banner: string | null | undefined): string | null {
  const b = (testo(banner) ?? "").toLowerCase();
  if (!b.startsWith("ssh-") && !b.includes("openssh")) return null;
  for (const d of DISTRO_SSH) {
    if (b.includes(d.ago)) return d.os;
  }
  return null;
}

/** Prima riga utile di sysDescr SNMP. */
export function osDaSysDescr(descr: string | null | undefined): string | null {
  let s = testo(descr);
  if (!s) return null;
  const taglio = s.search(/[\r\n]/);
  if (taglio >= 0) s = s.slice(0, taglio).trim();
  s = s.replace(/\s+/g, " ");
  if (s.length > 100) s = s.slice(0, 100).trim();
  return s || null;
}

export function scegliOs(prove: {
  ntlm?: string | null;
  snmp?: string | null;
  ssh?: string | null;
  os_info?: string | null;
}): SceltaOs | null {
  const ntlm = osDaVersioneNtlm(prove.ntlm);
  if (ntlm) return { os: ntlm, fonte: "ntlm" };
  const snmp = osDaSysDescr(prove.snmp);
  if (snmp) return { os: snmp, fonte: "snmp" };
  const ssh = osDaBannerSsh(prove.ssh);
  if (ssh) return { os: ssh, fonte: "ssh" };
  const archivio = testo(prove.os_info);
  if (archivio) return { os: archivio, fonte: "archivio" };
  return null;
}

function ntlmDaJson(json: string | null): InfoNtlm | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as InfoNtlm;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

function sshIdent(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as InfoSsh;
    return testo(v.ident);
  } catch {
    return null;
  }
}

function sysDescrDaSnmp(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as { sysDescr?: unknown; sysdescr?: unknown };
    return testo(v.sysDescr) ?? testo(v.sysdescr);
  } catch {
    return null;
  }
}

function ttlDaDetection(json: string | null): number | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as { ttl?: unknown };
    return typeof v.ttl === "number" && Number.isFinite(v.ttl) && v.ttl > 0 ? v.ttl : null;
  } catch {
    return null;
  }
}

function nmapOsDaDetection(json: string | null): string | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as { nmap_os?: unknown; os_hint?: unknown; snmp_sysdescr?: unknown };
    return testo(v.nmap_os) ?? testo(v.os_hint) ?? osDaSysDescr(testo(v.snmp_sysdescr));
  } catch {
    return null;
  }
}

interface ProveHost {
  ntlm: string | null;
  snmp: string | null;
  ssh: string | null;
  os_info: string | null;
}

function sceltaDaProve(p: ProveHost): SceltaOs | null {
  return scegliOs(p);
}

/**
 * Compila `hosts.os_info` dove è vuoto, dalle sonde già salvate.
 * Non sovrascrive un valore già presente (AD, WinRM, nmap).
 */
export function riempiOsVuoti(db: Database.Database, soloHostId?: number): number {
  const where = soloHostId != null ? "h.id = ?" : "(h.os_info IS NULL OR TRIM(h.os_info) = '')";
  const args = soloHostId != null ? [soloHostId] : [];
  const host = db
    .prepare(`SELECT h.id, h.os_info, h.snmp_data, h.detection_json FROM hosts h WHERE ${where}`)
    .all(...args) as Array<{ id: number; os_info: string | null; snmp_data: string | null; detection_json: string | null }>;
  if (host.length === 0) return 0;

  const ids = host.map((h) => h.id);
  const segnaposto = ids.map(() => "?").join(",");
  const servizi = db
    .prepare(
      `SELECT host_id, ntlm_json, ssh_json, banner FROM servizi_rete
       WHERE host_id IN (${segnaposto})`,
    )
    .all(...ids) as Array<{ host_id: number; ntlm_json: string | null; ssh_json: string | null; banner: string | null }>;

  const perHost = new Map<number, { ntlm: string | null; ssh: string | null }>();
  for (const s of servizi) {
    const acc = perHost.get(s.host_id) ?? { ntlm: null, ssh: null };
    const n = ntlmDaJson(s.ntlm_json);
    if (!acc.ntlm && n?.versione_os) acc.ntlm = n.versione_os;
    if (!acc.ssh) acc.ssh = sshIdent(s.ssh_json) ?? (s.banner?.startsWith("SSH-") ? s.banner : null);
    perHost.set(s.host_id, acc);
  }

  const upd = db.prepare("UPDATE hosts SET os_info = ? WHERE id = ? AND (os_info IS NULL OR TRIM(os_info) = '')");
  let n = 0;
  db.transaction(() => {
    for (const h of host) {
      if (testo(h.os_info)) continue;
      const acc = perHost.get(h.id) ?? { ntlm: null, ssh: null };
      const scelta =
        sceltaDaProve({
          ntlm: acc.ntlm,
          snmp: sysDescrDaSnmp(h.snmp_data) ?? nmapOsDaDetection(h.detection_json),
          ssh: acc.ssh,
          os_info: null,
        }) ?? (nmapOsDaDetection(h.detection_json) ? { os: nmapOsDaDetection(h.detection_json)!, fonte: "archivio" as const } : null);
      if (!scelta) continue;
      upd.run(scelta.os, h.id);
      n += 1;
    }
  })();
  return n;
}

/** Scheda di prima lettura: OS, dominio, servizi e chiavi già in archivio. */
export function leggiPrimaLettura(db: Database.Database, hostId: number): PrimaLettura | null {
  const h = db
    .prepare(
      `SELECT id, ip, hostname, mac, vendor, os_info, snmp_data, detection_json
       FROM hosts WHERE id = ?`,
    )
    .get(hostId) as
    | {
        id: number;
        ip: string;
        hostname: string | null;
        mac: string | null;
        vendor: string | null;
        os_info: string | null;
        snmp_data: string | null;
        detection_json: string | null;
      }
    | undefined;
  if (!h) return null;

  const giaPieno = testo(h.os_info);
  riempiOsVuoti(db, hostId);
  const osInfo =
    giaPieno ??
    (
      db.prepare("SELECT os_info FROM hosts WHERE id = ?").get(hostId) as { os_info: string | null } | undefined
    )?.os_info ??
    h.os_info;

  const servizi = db
    .prepare(
      `SELECT porta, protocollo, nome, prodotto, versione, metodo, ntlm_json, ssh_json, banner
       FROM servizi_rete WHERE host_id = ? ORDER BY protocollo, porta`,
    )
    .all(hostId) as Array<{
    porta: number;
    protocollo: string;
    nome: string | null;
    prodotto: string | null;
    versione: string | null;
    metodo: string | null;
    ntlm_json: string | null;
    ssh_json: string | null;
    banner: string | null;
  }>;

  let ntlmVer: string | null = null;
  let dominio: string | null = null;
  let sshBanner: string | null = null;
  for (const s of servizi) {
    const n = ntlmDaJson(s.ntlm_json);
    if (n) {
      if (!ntlmVer) ntlmVer = n.versione_os;
      if (!dominio) dominio = testo(n.dominio_dns) ?? testo(n.dominio_netbios);
    }
    if (!sshBanner) sshBanner = sshIdent(s.ssh_json) ?? (s.banner?.startsWith("SSH-") ? s.banner : null);
  }

  const scelta = giaPieno
    ? { os: giaPieno, fonte: "archivio" as const }
    : scegliOs({
        ntlm: ntlmVer,
        snmp: sysDescrDaSnmp(h.snmp_data) ?? nmapOsDaDetection(h.detection_json),
        ssh: sshBanner,
        os_info: osInfo,
      });

  const chiavi = db
    .prepare(
      `SELECT tipo, valore, fonte, porta, visto FROM identita_prove WHERE host_id = ? ORDER BY visto DESC`,
    )
    .all(hostId) as ChiavePrimaLettura[];

  const altri_ip = db
    .prepare(
      `SELECT h.id, h.ip, n.name AS rete
       FROM identita_proposte p
       JOIN hosts h ON h.id = CASE WHEN p.host_a = ? THEN p.host_b ELSE p.host_a END
       LEFT JOIN networks n ON n.id = h.network_id
       WHERE p.stato = 'confermato' AND (p.host_a = ? OR p.host_b = ?)
       ORDER BY h.ip`,
    )
    .all(hostId, hostId, hostId) as AltroIpPrimaLettura[];

  return {
    id: h.id,
    ip: h.ip,
    hostname: h.hostname,
    mac: h.mac,
    vendor: h.vendor,
    os: scelta?.os ?? null,
    os_fonte: scelta?.fonte ?? null,
    dominio,
    ttl: ttlDaDetection(h.detection_json),
    servizi: servizi.map((s) => ({
      porta: s.porta,
      protocollo: s.protocollo,
      nome: s.nome,
      prodotto: s.prodotto,
      versione: s.versione,
      metodo: s.metodo,
    })),
    chiavi,
    altri_ip,
  };
}

/**
 * Software inventory probe — Linux via SSH (paramiko bridge).
 *
 * Strategia:
 *  1. Detection distro tramite `/etc/os-release` → sceglie il package manager
 *  2. Inventory primario: dpkg (debian/ubuntu/raspbian), rpm (rhel/rocky/alma/
 *     fedora/ol/sles/opensuse), apk (alpine). Fallback automatico se `ID`
 *     non riconosciuto.
 *  3. Opzionali: snap e flatpak se i binari sono presenti.
 *
 * Tutti i parser ritornano `SoftwarePackage[]` con `source` corretto.
 * Errori di parsing non sono fatali: log + procedi (eccetto inventory primario
 * vuoto, che è un caso lecito).
 */

import { runSshCommand } from "@/lib/devices/ssh-run";
import type { SoftwarePackage, SoftwareProbe, SoftwareSource } from "@/types";

const DISTRO_DETECT_CMD =
  "(cat /etc/os-release 2>/dev/null || true); echo '---END_OS_RELEASE---'; uname -s 2>/dev/null || true";

type DistroFamily = "debian" | "rpm" | "alpine" | "unknown";

interface DistroInfo {
  id: string;
  idLike: string[];
  family: DistroFamily;
  prettyName: string | null;
}

function parseOsRelease(stdout: string): DistroInfo {
  const cut = stdout.split("---END_OS_RELEASE---");
  const block = (cut[0] || "").trim();
  const lines = block.split(/\r?\n/);
  const map = new Map<string, string>();
  for (const ln of lines) {
    const m = /^([A-Z_]+)=(.*)$/.exec(ln.trim());
    if (!m) continue;
    let v = (m[2] ?? "").trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    map.set(m[1], v);
  }

  const id = (map.get("ID") || "").toLowerCase();
  const idLikeRaw = (map.get("ID_LIKE") || "").toLowerCase();
  const idLike = idLikeRaw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const debianIds = new Set(["debian", "ubuntu", "raspbian", "linuxmint", "pop", "kali"]);
  const rpmIds = new Set([
    "rhel",
    "centos",
    "fedora",
    "rocky",
    "almalinux",
    "alma",
    "ol",
    "oracle",
    "sles",
    "opensuse",
    "opensuse-leap",
    "opensuse-tumbleweed",
  ]);

  const allIds = [id, ...idLike];
  let family: DistroFamily = "unknown";
  if (allIds.some((x) => debianIds.has(x))) family = "debian";
  else if (allIds.some((x) => rpmIds.has(x))) family = "rpm";
  else if (id === "alpine" || idLike.includes("alpine")) family = "alpine";

  return {
    id: id || "unknown",
    idLike,
    family,
    prettyName: map.get("PRETTY_NAME") || null,
  };
}

// ─── Parser helpers ──────────────────────────────────────────────────

function s(value: string | undefined | null): string | null {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  if (!t || t === "(none)" || t === "none" || t === "-") return null;
  return t;
}

function mkPkg(
  source: SoftwareSource,
  name: string,
  version: string | null,
  publisher: string | null,
  install_date: string | null
): SoftwarePackage {
  return {
    name,
    version,
    publisher,
    install_date,
    install_location: null,
    source,
    architecture: null,
    size_bytes: null,
  };
}

/**
 * Parser dpkg-query output. Formato atteso (campi tab-separated):
 *   Package\tVersion\tMaintainer\tStatus
 * Filtra solo righe con Status="installed".
 */
export function parseDpkg(stdout: string): SoftwarePackage[] {
  const out: SoftwarePackage[] = [];
  if (!stdout) return out;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const status = (parts[3] ?? "").trim().toLowerCase();
    if (parts.length >= 4 && status && status !== "installed") continue;
    const name = (parts[0] ?? "").trim();
    if (!name) continue;
    out.push(mkPkg("dpkg", name, s(parts[1]), s(parts[2]), null));
  }
  return out;
}

/**
 * Parser rpm output. Formato atteso (campi tab-separated):
 *   NAME\tVERSION-RELEASE\tVENDOR\tINSTALLTIME_DATE
 * INSTALLTIME viene normalizzato in ISO date `YYYY-MM-DD` se possibile.
 */
export function parseRpm(stdout: string): SoftwarePackage[] {
  const out: SoftwarePackage[] = [];
  if (!stdout) return out;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const name = (parts[0] ?? "").trim();
    if (!name) continue;
    const version = s(parts[1]);
    const vendor = s(parts[2]);
    const installRaw = s(parts[3]);
    let installDate: string | null = installRaw;
    if (installRaw) {
      const d = new Date(installRaw);
      if (!Number.isNaN(d.getTime())) {
        installDate = d.toISOString().slice(0, 10);
      }
    }
    out.push(mkPkg("rpm", name, version, vendor, installDate));
  }
  return out;
}

/**
 * Parser `apk info -vv`. Ogni riga:
 *   <name>-<version> - <description>
 * Esempio: `busybox-1.36.1-r5 - Size optimized toolbox`.
 * version include la "-r<rel>" alpine.
 */
export function parseApk(stdout: string): SoftwarePackage[] {
  const out: SoftwarePackage[] = [];
  if (!stdout) return out;
  const re = /^([A-Za-z0-9._+-]+?)-(\d[^\s]*?)(?:\s+-\s+(.*))?$/;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = re.exec(trimmed);
    if (!m) continue;
    const name = m[1];
    const version = m[2];
    if (!name) continue;
    out.push(mkPkg("apk", name, version, null, null));
  }
  return out;
}

interface RawSnap {
  name?: unknown;
  version?: unknown;
  publisher?: unknown;
  "install-date"?: unknown;
  installed_at?: unknown;
}

/**
 * Parser snap. Strategia: input JSON da `snap list --json` (Snapd 2.40+),
 * altrimenti parsing della tabella `snap list`.
 */
export function parseSnap(stdout: string): SoftwarePackage[] {
  const out: SoftwarePackage[] = [];
  const trimmed = (stdout || "").trim();
  if (!trimmed) return out;

  // Tentativo JSON
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    let arr: RawSnap[] = [];
    try {
      const parsed = JSON.parse(trimmed) as RawSnap[] | RawSnap;
      arr = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      arr = [];
    }
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const name = s(item.name as string | undefined);
      if (!name) continue;
      const installDate = s(
        (item["install-date"] as string | undefined) ??
          (item.installed_at as string | undefined)
      );
      let normDate: string | null = installDate;
      if (installDate) {
        const d = new Date(installDate);
        if (!Number.isNaN(d.getTime())) {
          normDate = d.toISOString().slice(0, 10);
        }
      }
      out.push(
        mkPkg(
          "snap",
          name,
          s(item.version as string | undefined),
          s(item.publisher as string | undefined),
          normDate
        )
      );
    }
    return out;
  }

  // Fallback: tabella `snap list` con header `Name Version Rev Tracking Publisher Notes`
  const lines = trimmed.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (/^name\s+version\s+rev/i.test(line)) continue;
    const cols = line.split(/\s+/);
    if (cols.length < 2) continue;
    const name = cols[0];
    const version = cols[1];
    const publisher = cols.length >= 5 ? cols[4] : null;
    if (!name) continue;
    out.push(mkPkg("snap", name, version, publisher, null));
  }
  return out;
}

/**
 * Parser flatpak. Input atteso da `flatpak list --columns=application,version,branch`.
 * Tab-separated.
 */
export function parseFlatpak(stdout: string): SoftwarePackage[] {
  const out: SoftwarePackage[] = [];
  if (!stdout) return out;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^application\s/i.test(trimmed)) continue;
    const parts = trimmed.split(/\t/);
    if (parts.length === 1) {
      const cols = trimmed.split(/\s{2,}/);
      if (cols.length < 2) continue;
      const name = cols[0]?.trim();
      const version = cols[1]?.trim();
      if (!name) continue;
      out.push(mkPkg("flatpak", name, version || null, null, null));
      continue;
    }
    const name = parts[0]?.trim();
    if (!name) continue;
    out.push(
      mkPkg(
        "flatpak",
        name,
        s(parts[1]),
        null,
        null
      )
    );
  }
  return out;
}

// ─── Comandi shell ──────────────────────────────────────────────────

const DPKG_CMD =
  "dpkg-query -W -f='${Package}\\t${Version}\\t${Maintainer}\\t${db:Status-Status}\\n' 2>/dev/null";
const RPM_CMD =
  "rpm -qa --queryformat '%{NAME}\\t%{VERSION}-%{RELEASE}\\t%{VENDOR}\\t%{INSTALLTIME:date}\\n' 2>/dev/null";
const APK_CMD = "apk info -vv 2>/dev/null";

// Snap: prova JSON, fallback tabella
const SNAP_CMD =
  "if command -v snap >/dev/null 2>&1; then (snap list --json 2>/dev/null || snap list 2>/dev/null) || true; fi";
const FLATPAK_CMD =
  "if command -v flatpak >/dev/null 2>&1; then flatpak list --columns=application,version,branch 2>/dev/null || true; fi";

// Combo "auto": prova tutto, marca i blocchi così il parser TS può separarli.
// Comando unico = una sola execve in SSH → meno round-trip.
const COMBO_CMD = [
  "echo '###DPKG_START###'",
  `( command -v dpkg-query >/dev/null 2>&1 && ${DPKG_CMD} ) || true`,
  "echo '###DPKG_END###'",
  "echo '###RPM_START###'",
  `( command -v rpm >/dev/null 2>&1 && ${RPM_CMD} ) || true`,
  "echo '###RPM_END###'",
  "echo '###APK_START###'",
  `( command -v apk >/dev/null 2>&1 && ${APK_CMD} ) || true`,
  "echo '###APK_END###'",
  "echo '###SNAP_START###'",
  SNAP_CMD,
  "echo '###SNAP_END###'",
  "echo '###FLATPAK_START###'",
  FLATPAK_CMD,
  "echo '###FLATPAK_END###'",
].join("; ");

function extractBlock(stdout: string, name: string): string {
  const start = `###${name}_START###`;
  const end = `###${name}_END###`;
  const i = stdout.indexOf(start);
  if (i < 0) return "";
  const j = stdout.indexOf(end, i + start.length);
  if (j < 0) return "";
  return stdout.substring(i + start.length, j).trim();
}

// ─── Detection probe label ──────────────────────────────────────────

function pickProbeLabel(
  sources: ReadonlySet<SoftwareSource>
): SoftwareProbe {
  const primary: SoftwareSource[] = ["dpkg", "rpm", "apk"];
  const hasMultiple =
    primary.filter((p) => sources.has(p)).length +
      (sources.has("snap") ? 1 : 0) +
      (sources.has("flatpak") ? 1 : 0) >
    1;
  if (hasMultiple) return "ssh-mixed";
  if (sources.has("dpkg")) return "ssh-dpkg";
  if (sources.has("rpm")) return "ssh-rpm";
  if (sources.has("apk")) return "ssh-apk";
  // Caso degenere: niente principale ma magari solo snap/flatpak.
  return "ssh-mixed";
}

// ─── Public API ─────────────────────────────────────────────────────

export interface LinuxSoftwareProbeInput {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutSec: number;
}

export interface LinuxSoftwareProbeResult {
  packages: SoftwarePackage[];
  probe: SoftwareProbe;
  distro: DistroInfo;
  warnings: string[];
}

/**
 * Esegue uno scan applicativo Linux end-to-end:
 *   1. distro detection
 *   2. inventory combinato (dpkg / rpm / apk + snap + flatpak opzionali)
 *   3. parsing + dedup banale per (source, name, version)
 *
 * Il chiamante (runner) è responsabile di catturare errori e mapparli su
 * `status='error' | 'timeout'`.
 */
export async function runLinuxSoftwareScan(
  input: LinuxSoftwareProbeInput
): Promise<LinuxSoftwareProbeResult> {
  // Step 1: detection distro
  const detect = await runSshCommand({
    host: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
    command: DISTRO_DETECT_CMD,
    timeoutSec: Math.min(20, input.timeoutSec),
  });
  const distro = parseOsRelease(detect.stdout || "");

  // Step 2: inventory combinato. Usiamo SEMPRE il combo command: anche se la
  // detection ha riconosciuto debian, può esserci snap/flatpak presente.
  const inv = await runSshCommand({
    host: input.host,
    port: input.port,
    username: input.username,
    password: input.password,
    command: COMBO_CMD,
    timeoutSec: input.timeoutSec,
  });

  const warnings: string[] = [];
  const sources = new Set<SoftwareSource>();
  const all: SoftwarePackage[] = [];

  const dpkgBlock = extractBlock(inv.stdout, "DPKG");
  if (dpkgBlock) {
    try {
      const pkgs = parseDpkg(dpkgBlock);
      if (pkgs.length > 0) {
        sources.add("dpkg");
        all.push(...pkgs);
      }
    } catch (e) {
      warnings.push(
        `Parsing dpkg fallito: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const rpmBlock = extractBlock(inv.stdout, "RPM");
  if (rpmBlock) {
    try {
      const pkgs = parseRpm(rpmBlock);
      if (pkgs.length > 0) {
        sources.add("rpm");
        all.push(...pkgs);
      }
    } catch (e) {
      warnings.push(
        `Parsing rpm fallito: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const apkBlock = extractBlock(inv.stdout, "APK");
  if (apkBlock) {
    try {
      const pkgs = parseApk(apkBlock);
      if (pkgs.length > 0) {
        sources.add("apk");
        all.push(...pkgs);
      }
    } catch (e) {
      warnings.push(
        `Parsing apk fallito: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const snapBlock = extractBlock(inv.stdout, "SNAP");
  if (snapBlock) {
    try {
      const pkgs = parseSnap(snapBlock);
      if (pkgs.length > 0) {
        sources.add("snap");
        all.push(...pkgs);
      }
    } catch (e) {
      warnings.push(
        `Parsing snap fallito: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  const flatpakBlock = extractBlock(inv.stdout, "FLATPAK");
  if (flatpakBlock) {
    try {
      const pkgs = parseFlatpak(flatpakBlock);
      if (pkgs.length > 0) {
        sources.add("flatpak");
        all.push(...pkgs);
      }
    } catch (e) {
      warnings.push(
        `Parsing flatpak fallito: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  // Dedup banale per (source, name, version): packagers possono enumerare
  // duplicati su sistemi mal configurati.
  const seen = new Set<string>();
  const deduped: SoftwarePackage[] = [];
  for (const p of all) {
    const key = `${p.source}|${p.name.toLowerCase()}|${p.version ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  return {
    packages: deduped,
    probe: pickProbeLabel(sources),
    distro,
    warnings,
  };
}

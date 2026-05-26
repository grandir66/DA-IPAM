/**
 * Auto-classificazione host server-side.
 *
 * Logica rule-based pura (sync, no I/O) che produce un best-guess di:
 *   - device_type      (router/switch/firewall/hypervisor/server/workstation/printer/iot/nas)
 *   - vendor           (cisco/mikrotik/microsoft/apple/dell/hp/...)
 *   - protocol         (ssh/snmp_v2/snmp_v3/winrm/api)
 *   - scan_target      (windows/linux/macos/proxmox/vmware/network)
 *   - os_family        (windows/linux/macos/network-os)
 *
 * Output: classification + confidence (0-100) + reasons (lista di stringhe per debug).
 *
 * Usato da upsertHost() per popolare le colonne hosts.inferred_* alla discovery.
 * Il modale di promozione (F2) usa quei valori come default editabili.
 *
 * NB: rispetto della scelta manuale dell'utente lato chiamante (vedi
 * `classification_manual=1` flag in upsertHost): se l'utente ha fissato la
 * classificazione a mano, il chiamante NON deve sovrascrivere le inferenze.
 */

/**
 * Versione del classifier. Bump quando le regole cambiano in modo non backward-compat
 * (es. nuovi segnali, regole vendor ristrette). La migration del tenant ricomputa
 * automaticamente gli host con `inferred_classifier_version < CLASSIFIER_VERSION`.
 *
 * v1 (originale) — solo OUI/hostname/porte/snmp_data
 * v2 (2026-05-26) — aggiunto os_info come segnale primario; regola VMware ristretta
 *                   per distinguere ESXi reale da VM su VMware con NIC virtuale
 */
// v3 (2026-05-26 v0.2.633): fix Apple iOS classificato come network-os (A9) +
// Linux workstation classificato come server di default (A10). Bump triggera
// ricomputo automatico via backfill in initializeTenantDb.
export const CLASSIFIER_VERSION = 3;

export type InferredDeviceType =
  | "router"
  | "switch"
  | "firewall"
  | "hypervisor"
  | "server"
  | "workstation"
  | "printer"
  | "iot"
  | "nas"
  | "ups";

export type InferredOsFamily = "windows" | "linux" | "macos" | "network-os";

export type InferredProtocol = "ssh" | "snmp_v2" | "snmp_v3" | "winrm" | "api";

export type InferredScanTarget = "windows" | "linux" | "macos" | "proxmox" | "vmware" | "network";

export interface AutoClassifyInput {
  hostname: string | null | undefined;
  mac: string | null | undefined;
  vendor: string | null | undefined;                  // OUI manufacturer (es. "Apple, Inc.")
  device_manufacturer?: string | null | undefined;    // SMBIOS/fingerprint (es. "Microsoft Corporation")
  /** Stringa OS testuale (da SNMP sysDescr o WinRM/SSH probe). Es: "Hardware: AMD64 ... Software: Windows Version 6.3 (Build 17763)". Segnale primario quando presente. */
  os_info?: string | null | undefined;
  open_ports_json?: string | null | undefined;        // JSON serializzato come da hosts.open_ports
  snmp_data_json?: string | null | undefined;
  detection_json?: string | null | undefined;
  current_classification?: string | null | undefined;
}

export interface AutoClassifyResult {
  inferred_device_type: InferredDeviceType | null;
  inferred_vendor: string | null;
  inferred_protocol: InferredProtocol | null;
  inferred_scan_target: InferredScanTarget | null;
  inferred_os_family: InferredOsFamily | null;
  inferred_confidence: number;        // 0-100
  inferred_reasons: string[];         // lista breve, per debug/UI tooltip
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeParseJson<T>(raw: string | null | undefined): T | null {
  if (!raw || typeof raw !== "string") return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function extractTcpPorts(openPortsJson: string | null | undefined): number[] {
  const parsed = safeParseJson<unknown>(openPortsJson);
  if (!parsed) return [];
  // Shape conosciute: { tcp: number[], udp: number[] } oppure number[] flat
  if (Array.isArray(parsed)) return parsed.filter((p): p is number => typeof p === "number");
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as { tcp?: unknown; udp?: unknown };
    if (Array.isArray(obj.tcp)) return obj.tcp.filter((p): p is number => typeof p === "number");
  }
  return [];
}

// ─── Vendor inference (OUI / device_manufacturer / hostname) ────────────────

interface VendorRule {
  vendor: string;
  os: InferredOsFamily | null;
  matches: (input: { ouiVendor: string; mfg: string; hostname: string }) => boolean;
}

const VENDOR_RULES: VendorRule[] = [
  // Windows desktop/laptop manufacturers
  { vendor: "microsoft", os: "windows", matches: ({ ouiVendor, mfg, hostname }) =>
      /microsoft/.test(ouiVendor) || /microsoft/.test(mfg) || /^surface/.test(hostname) },
  { vendor: "apple", os: "macos", matches: ({ ouiVendor, mfg, hostname }) =>
      /apple/.test(ouiVendor) || /apple/.test(mfg) || /^(mac|mb|mbp|mba|imac|macbook)/.test(hostname) },
  { vendor: "dell", os: null, matches: ({ ouiVendor, mfg }) => /dell/.test(ouiVendor) || /dell/.test(mfg) },
  { vendor: "hp", os: null, matches: ({ ouiVendor, mfg }) => /hewlett|hp inc|hp enterprise|\bhp\b/.test(ouiVendor) || /hewlett|hp/.test(mfg) },
  { vendor: "lenovo", os: null, matches: ({ ouiVendor, mfg }) => /lenovo/.test(ouiVendor) || /lenovo/.test(mfg) },
  { vendor: "asus", os: null, matches: ({ ouiVendor, mfg }) => /asus|asustek/.test(ouiVendor) || /asus/.test(mfg) },
  { vendor: "acer", os: null, matches: ({ ouiVendor, mfg }) => /acer/.test(ouiVendor) || /acer/.test(mfg) },
  // Network vendors
  { vendor: "cisco", os: "network-os", matches: ({ ouiVendor }) => /cisco/.test(ouiVendor) },
  { vendor: "mikrotik", os: "network-os", matches: ({ ouiVendor }) => /mikrotik|routerboard/.test(ouiVendor) },
  { vendor: "juniper", os: "network-os", matches: ({ ouiVendor }) => /juniper/.test(ouiVendor) },
  { vendor: "ubiquiti", os: "network-os", matches: ({ ouiVendor }) => /ubiquiti/.test(ouiVendor) },
  { vendor: "fortinet", os: "network-os", matches: ({ ouiVendor }) => /fortinet/.test(ouiVendor) },
  { vendor: "stormshield", os: "network-os", matches: ({ ouiVendor }) => /stormshield|netasq/.test(ouiVendor) },
  { vendor: "sonicwall", os: "network-os", matches: ({ ouiVendor }) => /sonicwall/.test(ouiVendor) },
  { vendor: "draytek", os: "network-os", matches: ({ ouiVendor }) => /draytek/.test(ouiVendor) },
  // Printer vendors
  { vendor: "hp-printer", os: null, matches: ({ ouiVendor }) => /^hp/.test(ouiVendor) && /print/.test(ouiVendor) },
  { vendor: "canon", os: null, matches: ({ ouiVendor }) => /canon/.test(ouiVendor) },
  { vendor: "brother", os: null, matches: ({ ouiVendor }) => /brother/.test(ouiVendor) },
  { vendor: "epson", os: null, matches: ({ ouiVendor }) => /epson|seiko/.test(ouiVendor) },
  // NAS
  { vendor: "synology", os: "linux", matches: ({ ouiVendor, hostname }) => /synology/.test(ouiVendor) || /^(diskstation|ds-)/.test(hostname) },
  { vendor: "qnap", os: "linux", matches: ({ ouiVendor, hostname }) => /qnap/.test(ouiVendor) || /^qnap/.test(hostname) },
  // Hypervisor — VMware ESXi/vCenter solo se ci sono segnali specifici di hypervisor.
  // ATTENZIONE: il MAC OUI VMware indica che il NIC è virtuale (la macchina è una VM
  // su VMware), NON che la macchina È un VMware ESXi. Una VM Windows ha MAC OUI VMware.
  // Per identificare un ESXi reale servono: hostname esxi/vcsa, oppure manufacturer
  // SMBIOS "VMware" combinato con porte ESXi (902/9443) — non il solo NIC OUI.
  { vendor: "vmware", os: "linux", matches: ({ hostname, mfg }) =>
      /^(esxi|vcsa|vcenter)/.test(hostname) ||
      // mfg=VMware è ambiguo (le VM su VMware hanno SMBIOS=VMware): richiediamo
      // anche un hint nell'hostname. Le VM Windows hanno hostname client-style.
      (/vmware/.test(mfg) && /^(esx|host|hv|hypervisor)/.test(hostname)) },
  { vendor: "proxmox", os: "linux", matches: ({ mfg, hostname }) => /proxmox/.test(mfg) || /^pve/.test(hostname) },
  // UPS
  { vendor: "apc", os: null, matches: ({ ouiVendor }) => /apc|american power/.test(ouiVendor) },
];

function inferVendorAndOs(
  ouiVendor: string,
  deviceMfg: string,
  hostname: string,
): { vendor: string | null; os: InferredOsFamily | null } {
  const ctx = {
    ouiVendor: ouiVendor.toLowerCase(),
    mfg: deviceMfg.toLowerCase(),
    hostname: hostname.toLowerCase(),
  };
  for (const rule of VENDOR_RULES) {
    if (rule.matches(ctx)) return { vendor: rule.vendor, os: rule.os };
  }
  return { vendor: null, os: null };
}

// ─── Hostname pattern OS detection ──────────────────────────────────────────

/**
 * Parse del campo `os_info` (sysDescr SNMP, output WinRM/SSH probe).
 * È il segnale PIÙ FORTE quando è popolato: parla esplicitamente dell'OS.
 * Es: "...Software: Windows Version 6.3..." → windows; "Linux ubuntu 5.15..." → linux.
 */
function inferOsFromOsInfo(osInfo: string | null | undefined): { os: InferredOsFamily | null; confidence: number; reason: string } {
  if (!osInfo) return { os: null, confidence: 0, reason: "" };
  const s = osInfo.toLowerCase();
  if (/\bwindows\b/.test(s)) return { os: "windows", confidence: 95, reason: "os_info dichiara Windows" };
  if (/\b(linux|ubuntu|debian|centos|redhat|rhel|fedora|alpine|kernel)\b/.test(s)) return { os: "linux", confidence: 95, reason: "os_info dichiara Linux" };
  // v0.2.633 bug fix A9: Apple iOS/iPadOS PRIMA del ramo network-os.
  // La vecchia regex `/\bios\b/` catturava "Apple iOS 17" e classificava
  // iPhone come network-os → "switch" con SNMP polling. Trattiamo iOS/iPadOS
  // come famiglia macOS (Darwin-based) — è la categorizzazione più vicina.
  if (/\b(ipados|iphone os|apple ios)\b/.test(s) || /\bios\b\s*\d/.test(s)) {
    return { os: "macos", confidence: 90, reason: "os_info dichiara iOS/iPadOS (Apple)" };
  }
  if (/\b(macos|darwin|mac os|osx)\b/.test(s)) return { os: "macos", confidence: 95, reason: "os_info dichiara macOS" };
  // v0.2.633 bug fix A9: `ios` bare word rimosso (vedi sopra), `cisco ios`
  // resta come fingerprint Cisco esplicito.
  if (/\b(cisco ios|cisco|nx-os|junos|routeros|mikrotik|fortios|stormshield|vyos)\b/.test(s)) return { os: "network-os", confidence: 90, reason: "os_info dichiara network OS" };
  if (/\b(vmware esx|esxi)\b/.test(s)) return { os: "linux", confidence: 85, reason: "os_info dichiara ESXi (linux-based)" };
  return { os: null, confidence: 0, reason: "" };
}

function inferOsFromHostname(hostname: string | null | undefined): InferredOsFamily | null {
  if (!hostname) return null;
  const h = hostname.toLowerCase();
  if (/^(desktop|win|pc|surface|laptop|workstation|nb)-?/.test(h)) return "windows";
  if (/^(mac|mb|mbp|mba|imac|macbook|mini)-?/.test(h)) return "macos";
  if (/^(srv|server|host|node|web|db|sql|app|nginx|apache|ubuntu|debian|centos|redhat|rocky|fedora|alpine)-?/.test(h)) return "linux";
  if (/^(esxi|vcsa|vcenter|pve|proxmox|hyperv|xen)-?/.test(h)) return "linux";
  return null;
}

// ─── Open ports OS detection ────────────────────────────────────────────────

function inferOsFromPorts(ports: number[]): { os: InferredOsFamily | null; confidence: number; reason: string } {
  const set = new Set(ports);
  const hasRdp = set.has(3389);
  const hasWinrm = set.has(5985) || set.has(5986);
  const hasSmb = set.has(445);
  const hasNetbios = set.has(139);
  const hasSsh = set.has(22);
  const hasAfp = set.has(548);
  const hasAdb = set.has(5555);

  if (hasWinrm) return { os: "windows", confidence: 90, reason: "porta WinRM aperta (5985/5986)" };
  if (hasRdp && (hasSmb || hasNetbios)) return { os: "windows", confidence: 85, reason: "RDP+SMB aperti" };
  if (hasSmb && hasNetbios && !hasSsh) return { os: "windows", confidence: 70, reason: "SMB+NetBIOS senza SSH" };
  if (hasRdp) return { os: "windows", confidence: 60, reason: "RDP aperto" };
  if (hasAfp) return { os: "macos", confidence: 70, reason: "AFP (porta 548) aperta" };
  if (hasSsh && !hasSmb && !hasRdp) return { os: "linux", confidence: 50, reason: "SSH aperto senza porte Windows" };
  if (hasAdb) return { os: "linux", confidence: 60, reason: "ADB (porta 5555) aperta" };
  return { os: null, confidence: 0, reason: "" };
}

// ─── Device type from ports / vendor ────────────────────────────────────────

function inferDeviceType(
  ports: number[],
  vendor: string | null,
  osFamily: InferredOsFamily | null,
  hostname: string,
): { device_type: InferredDeviceType | null; reason: string } {
  const set = new Set(ports);
  const h = hostname.toLowerCase();
  // Printer first (specific ports)
  if (set.has(9100) || set.has(631)) return { device_type: "printer", reason: "porta IPP/raw-print aperta" };
  // Hypervisor
  if (set.has(8006)) return { device_type: "hypervisor", reason: "porta Proxmox 8006 aperta" };
  if (vendor === "vmware" || /^esxi|^vcsa/.test(h)) return { device_type: "hypervisor", reason: "vendor/hostname VMware" };
  if (vendor === "proxmox") return { device_type: "hypervisor", reason: "vendor Proxmox" };
  // NAS
  if (vendor === "synology" || vendor === "qnap") return { device_type: "nas", reason: "vendor NAS" };
  // Network OS
  if (osFamily === "network-os") {
    if (vendor === "fortinet" || vendor === "stormshield" || vendor === "sonicwall") return { device_type: "firewall", reason: `vendor ${vendor}` };
    // Generic: SNMP indicates router/switch; without further data, default switch
    return { device_type: set.has(80) || set.has(443) ? "router" : "switch", reason: "vendor network-os" };
  }
  // UPS
  if (vendor === "apc") return { device_type: "ups", reason: "vendor APC" };
  // Workstation vs server (Windows/macOS/Linux)
  if (osFamily === "windows") {
    if (/^(srv|server|host|dc|ad|sql|exchange|file|hyperv)/.test(h)) return { device_type: "server", reason: "hostname server-like" };
    return { device_type: "workstation", reason: "Windows con hostname client-like" };
  }
  if (osFamily === "macos") return { device_type: "workstation", reason: "macOS" };
  if (osFamily === "linux") {
    // v0.2.633 bug fix A10: il default per Linux era SEMPRE "server", facendo
    // finire desktop Ubuntu/Mint, Raspberry IoT e laptop Linux nel chip
    // "Server". Ora differenzio:
    //   - hostname server-like → server
    //   - hostname client-like → workstation
    //   - porte server tipiche (80/443/3306/5432/25/53) → server
    //   - altrimenti default workstation (più conservativo: meglio un server
    //     non riconosciuto come workstation che un laptop come server).
    if (/^(srv|server|host|node|web|db|sql|app|nginx|apache|mail|proxy|gw|fw)/.test(h)) {
      return { device_type: "server", reason: "hostname server-like" };
    }
    if (/^(desktop|laptop|workstation|ws|nb|pc|ubuntu-desk|kubuntu|mint|lubuntu|xubuntu)/.test(h)) {
      return { device_type: "workstation", reason: "Linux hostname client-like" };
    }
    const hasServerPorts = set.has(80) || set.has(443) || set.has(3306) || set.has(5432) || set.has(25) || set.has(53);
    if (hasServerPorts) return { device_type: "server", reason: "Linux con porte server aperte (80/443/3306/5432/25/53)" };
    return { device_type: "workstation", reason: "Linux senza segnali server (default conservativo)" };
  }
  return { device_type: null, reason: "" };
}

// ─── Protocol + scan_target inference ───────────────────────────────────────

function inferProtocolAndScanTarget(
  osFamily: InferredOsFamily | null,
  deviceType: InferredDeviceType | null,
  vendor: string | null,
  hasSnmpData: boolean,
): { protocol: InferredProtocol | null; scan_target: InferredScanTarget | null } {
  if (osFamily === "windows") return { protocol: "winrm", scan_target: "windows" };
  if (osFamily === "macos") return { protocol: "ssh", scan_target: "macos" };
  if (deviceType === "hypervisor") {
    if (vendor === "proxmox") return { protocol: "api", scan_target: "proxmox" };
    if (vendor === "vmware") return { protocol: "api", scan_target: "vmware" };
    return { protocol: "ssh", scan_target: "linux" };
  }
  if (deviceType === "nas") return { protocol: "ssh", scan_target: "linux" };
  if (deviceType === "router" || deviceType === "switch" || deviceType === "firewall") {
    return { protocol: hasSnmpData ? "snmp_v2" : "ssh", scan_target: "network" };
  }
  if (deviceType === "printer") return { protocol: hasSnmpData ? "snmp_v2" : "ssh", scan_target: "network" };
  if (deviceType === "ups") return { protocol: "snmp_v2", scan_target: "network" };
  if (osFamily === "linux") return { protocol: "ssh", scan_target: "linux" };
  return { protocol: null, scan_target: null };
}

// ─── Main entry point ───────────────────────────────────────────────────────

export function autoClassifyHost(input: AutoClassifyInput): AutoClassifyResult {
  const reasons: string[] = [];
  const ouiVendor = input.vendor ?? "";
  const deviceMfg = input.device_manufacturer ?? "";
  const hostname = input.hostname ?? "";
  const ports = extractTcpPorts(input.open_ports_json);
  const snmpData = safeParseJson<Record<string, unknown>>(input.snmp_data_json);
  const hasSnmpData = !!snmpData && Object.keys(snmpData).length > 0;

  // 0. OS_INFO (sysDescr SNMP / WinRM/SSH banner) — segnale più forte quando presente.
  //    Es: una VM Windows su VMware ha MAC OUI VMware (segnale debole) ma os_info
  //    "Software: Windows Version 6.3" (segnale forte). Vince os_info.
  const osInfoInfer = inferOsFromOsInfo(input.os_info);
  if (osInfoInfer.os) reasons.push(osInfoInfer.reason);

  // 1. Vendor + OS via OUI / manufacturer / hostname prefix
  const { vendor, os: vendorOs } = inferVendorAndOs(ouiVendor, deviceMfg, hostname);
  if (vendor) reasons.push(`vendor=${vendor}`);

  // 2. OS via hostname pattern (se non già da vendor)
  const hostnameOs = inferOsFromHostname(hostname);
  if (hostnameOs && !vendorOs && !osInfoInfer.os) reasons.push(`hostname suggerisce ${hostnameOs}`);

  // 3. OS via porte aperte (segnale diretto, ma os_info è ancora più diretto)
  const portInfer = inferOsFromPorts(ports);
  if (portInfer.os && !osInfoInfer.os) reasons.push(portInfer.reason);

  // Combina: priorità os_info > porte > vendor > hostname.
  // os_info è la verità riportata dall'OS stesso (sysDescr/WinRM banner): se dice
  // "Windows" è Windows anche se NIC è VMware OUI e SMBIOS è vmware (caso VM).
  const osFamily: InferredOsFamily | null = osInfoInfer.os ?? portInfer.os ?? vendorOs ?? hostnameOs;

  // 4. Device type — se os_info forza Windows/macOS/Linux, NON è hypervisor
  //    (lo override sui vendor=vmware/proxmox vale solo se è davvero ESXi/PVE).
  const dt = inferDeviceType(ports, vendor, osFamily, hostname);
  // Override: se os_info dice esplicitamente Windows/macOS, non è hypervisor
  // anche se vendor=vmware (caso VM Windows con NIC VMware).
  if ((osInfoInfer.os === "windows" || osInfoInfer.os === "macos") && dt.device_type === "hypervisor") {
    const wsRedirect: InferredDeviceType = osInfoInfer.os === "windows"
      ? (/^(srv|server|host|dc|ad|sql|exchange|file|hyperv)/.test(hostname.toLowerCase()) ? "server" : "workstation")
      : "workstation";
    dt.device_type = wsRedirect;
    dt.reason = `override da os_info ${osInfoInfer.os}`;
  }
  if (dt.device_type) reasons.push(`tipo=${dt.device_type} (${dt.reason})`);

  // 5. Protocol + scan_target
  const { protocol, scan_target } = inferProtocolAndScanTarget(osFamily, dt.device_type, vendor, hasSnmpData);
  if (protocol) reasons.push(`protocollo=${protocol}`);

  // 6. Confidence: somma pesata dei segnali presenti
  let confidence = 0;
  if (osInfoInfer.confidence > 0) confidence = Math.max(confidence, osInfoInfer.confidence);
  if (portInfer.confidence > 0) confidence = Math.max(confidence, portInfer.confidence);
  if (vendor && vendorOs) confidence = Math.max(confidence, 65);
  if (hasSnmpData && (dt.device_type === "switch" || dt.device_type === "router" || dt.device_type === "firewall")) confidence = Math.max(confidence, 80);
  if (hostnameOs && !portInfer.os && !osInfoInfer.os) confidence = Math.max(confidence, 55);
  if (vendor && !osFamily) confidence = Math.max(confidence, 40);
  // Nessun segnale utile
  if (!osFamily && !dt.device_type && !vendor) confidence = 0;

  return {
    inferred_device_type: dt.device_type,
    inferred_vendor: vendor,
    inferred_protocol: protocol,
    inferred_scan_target: scan_target,
    inferred_os_family: osFamily,
    inferred_confidence: confidence,
    inferred_reasons: reasons,
  };
}

/**
 * Decide se merita rifare la classificazione per un host: serve se sono cambiati
 * uno dei segnali rilevanti (porte, snmp, manufacturer, hostname, vendor OUI).
 * Le altre modifiche (es. status, last_seen) non richiedono ricomputo.
 */
export function shouldRecomputeClassification(changedFields: Set<string>): boolean {
  const triggers = ["open_ports", "snmp_data", "device_manufacturer", "hostname", "vendor", "detection_json", "os_info"];
  for (const t of triggers) if (changedFields.has(t)) return true;
  return false;
}

// ─── DB integration ─────────────────────────────────────────────────────────

// Type minimo per accettare sia better-sqlite3 Database che la sua interfaccia
// (evita circolarità import: i moduli db.ts/db-tenant.ts già importano better-sqlite3).
interface SqliteDbLike {
  prepare(sql: string): {
    get(...args: unknown[]): unknown;
    run(...args: unknown[]): unknown;
  };
}

// v0.2.641 audit perf DB1: cache dei 2 prepared statement per Database handle.
// Prima `db.prepare(SELECT...)` e `db.prepare(UPDATE...)` venivano ricompilati
// ad ogni invocazione (~50-100µs/cad). Su backfill 2000 host = ~400ms persi
// solo in prepare; in hot loop di scan ancora di più.
type PreparedStmt = ReturnType<SqliteDbLike["prepare"]>;
const stmtCache = new WeakMap<SqliteDbLike, { select: PreparedStmt; update: PreparedStmt }>();

function getStmts(db: SqliteDbLike) {
  let entry = stmtCache.get(db);
  if (!entry) {
    entry = {
      select: db.prepare(
        "SELECT hostname, mac, vendor, device_manufacturer, os_info, open_ports, snmp_data, detection_json, classification FROM hosts WHERE id = ?"
      ),
      update: db.prepare(`
        UPDATE hosts SET
          inferred_device_type = ?,
          inferred_vendor = ?,
          inferred_protocol = ?,
          inferred_scan_target = ?,
          inferred_os_family = ?,
          inferred_confidence = ?,
          inferred_reasons = ?,
          inferred_at = datetime('now'),
          inferred_classifier_version = ?
        WHERE id = ?
      `),
    };
    stmtCache.set(db, entry);
  }
  return entry;
}

/**
 * Legge i campi rilevanti dell'host, calcola le inferenze, e fa UPDATE delle
 * colonne inferred_*. Rispetta classification_manual=1 (in quel caso NON
 * sovrascrive `classification` — ma le inferred_* si aggiornano comunque,
 * sono suggerimenti separati dalla scelta manuale).
 *
 * Idempotente: se i dati di input non sono cambiati, l'output è identico.
 * Sicuro chiamarlo a ogni upsert.
 */
export function applyAutoClassification(db: SqliteDbLike, hostId: number): AutoClassifyResult | null {
  const stmts = getStmts(db);
  const row = stmts.select.get(hostId) as {
    hostname: string | null;
    mac: string | null;
    vendor: string | null;
    device_manufacturer: string | null;
    os_info: string | null;
    open_ports: string | null;
    snmp_data: string | null;
    detection_json: string | null;
    classification: string | null;
  } | undefined;

  if (!row) return null;

  const result = autoClassifyHost({
    hostname: row.hostname,
    mac: row.mac,
    vendor: row.vendor,
    device_manufacturer: row.device_manufacturer,
    os_info: row.os_info,
    open_ports_json: row.open_ports,
    snmp_data_json: row.snmp_data,
    detection_json: row.detection_json,
    current_classification: row.classification,
  });

  stmts.update.run(
    result.inferred_device_type,
    result.inferred_vendor,
    result.inferred_protocol,
    result.inferred_scan_target,
    result.inferred_os_family,
    result.inferred_confidence,
    JSON.stringify(result.inferred_reasons),
    CLASSIFIER_VERSION,
    hostId,
  );

  return result;
}

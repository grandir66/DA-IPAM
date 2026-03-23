/**
 * SNMP query via net-snmp (Node). Fallback opzionale su **snmpwalk** CLI se i GET non rispondono
 * (compatibilità ambienti dove la libreria fallisce ma il binario è ok).
 *
 * Fase 1: GET OID base + ENTITY-MIB (serial/model) come prima.
 * Fase 2 (se la fase 1 risponde): walk paralleli sugli stessi OID tipici di snmpwalk da CLI
 * (system, ifTable, ARP, MikroTik, UniFi, HOST-RESOURCES).
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";
const OID_SYSNAME = "1.3.6.1.2.1.1.5.0";
const OID_SYSOBJECTID = "1.3.6.1.2.1.1.2.0";
const OID_SYSUPTIME = "1.3.6.1.2.1.1.3.0";
const OID_MIKROTIK_IDENTITY = "1.3.6.1.4.1.14988.1.1.4.1.0";

// ENTITY-MIB OIDs (prova indice 1 e 2 per compatibilità con diversi device)
const OID_ENT_SERIAL_1 = "1.3.6.1.2.1.47.1.1.1.1.11.1";
const OID_ENT_SERIAL_2 = "1.3.6.1.2.1.47.1.1.1.1.11.2";
const OID_ENT_MODEL_1 = "1.3.6.1.2.1.47.1.1.1.1.2.1";
const OID_ENT_MODEL_2 = "1.3.6.1.2.1.47.1.1.1.1.2.2";
const OID_ENT_PARTNUM_1 = "1.3.6.1.2.1.47.1.1.1.1.13.1";
const OID_ENT_PARTNUM_2 = "1.3.6.1.2.1.47.1.1.1.1.13.2";

const OID_SYSTEM_TREE = "1.3.6.1.2.1.1";
const OID_IFTABLE = "1.3.6.1.2.1.2.2";
const OID_IPNETTOMEDIA = "1.3.6.1.2.1.4.22";
const OID_UNIFI_ENTERPRISE = "1.3.6.1.4.1.41112";
const OID_HOST_RESOURCES = "1.3.6.1.2.1.25";

/** OID enterprise fingerprint che sono stati rilevati come attivi. */
export interface SnmpFingerprintOidMatch {
  oid_prefix: string;
  device_label: string;
  classification: string;
}

export interface SnmpInfo {
  sysName: string | null;
  sysDescr: string | null;
  sysObjectID: string | null;
  serialNumber: string | null;
  model: string | null;
  partNumber: string | null;
  /** MikroTik identity (RouterOS) */
  mikrotikIdentity?: string | null;
  /** Estratto walk UniFi enterprise MIB */
  unifiSummary?: string | null;
  /** Prime interfacce (ifDescr) */
  ifDescrSummary?: string | null;
  /** sysUpTime (testo/ticks) */
  sysUpTime?: string | null;
  /** Stima voci tabella ARP SNMP */
  arpEntryCount?: number | null;
  /** Breve estratto HOST-RESOURCES (RAM / CPU load) */
  hostResourcesSummary?: string | null;
  /** OID enterprise fingerprint rilevati come attivi */
  fingerprintOidMatches?: SnmpFingerprintOidMatch[] | null;
  /** Profilo vendor SNMP risolto (da snmp-vendor-profiles.ts) */
  vendorProfileId?: string | null;
  /** Nome profilo vendor */
  vendorProfileName?: string | null;
  /** Confidenza classificazione profilo (0.0–1.0) */
  vendorProfileConfidence?: number | null;
  /** Classificazione da profilo vendor */
  vendorProfileCategory?: string | null;
  /** Firmware rilevato dal profilo (OID specifici) */
  vendorProfileFirmware?: string | null;
  /** Extra campi vendor-specific (temperatura, CPU usage, ecc.) */
  vendorProfileExtra?: Record<string, string | null>;
}

// Tipi errore net-snmp: noSuchObject=128, noSuchInstance=129, endOfMibView=130
const SNMP_ERROR_TYPES = new Set([128, 129, 130]);

/**
 * Fallback: `snmpwalk -v2c -c … 1.3.6.1.2.1.1` (stesso sistema di `snmpwalk` da terminale).
 * Disabilitabile con `DA_INVENT_SNMPWALK_CLI=false`.
 */
async function snmpwalkSystemGroupCli(
  ip: string,
  community: string,
  port: number
): Promise<{ sysName: string | null; sysDescr: string | null; sysObjectID: string | null } | null> {
  if (process.env.DA_INVENT_SNMPWALK_CLI === "false") return null;
  try {
    const args = ["-v2c", "-c", community, "-OQ", "-t", "3", "-r", "1"];
    if (port !== 161) args.push("-p", String(port));
    args.push(ip, OID_SYSTEM_TREE);
    const { stdout } = await execFileAsync("snmpwalk", args, {
      timeout: 12000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return parseSnmpwalkSystemStdout(String(stdout));
  } catch {
    return null;
  }
}

function parseSnmpwalkSystemStdout(stdout: string): { sysName: string | null; sysDescr: string | null; sysObjectID: string | null } | null {
  let sysDescr: string | null = null;
  let sysName: string | null = null;
  let sysObjectID: string | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes(".1.1.1.0") || /\.sysDescr\.0\s*=/.test(t)) {
      const v = extractSnmpwalkValue(t);
      if (v) sysDescr = v;
    } else if (t.includes(".1.1.5.0") || /\.sysName\.0\s*=/.test(t)) {
      const v = extractSnmpwalkValue(t);
      if (v) sysName = v;
    } else if (t.includes(".1.1.2.0") || /\.sysObjectID\.0\s*=/.test(t)) {
      const v = extractSnmpwalkValue(t);
      if (v) sysObjectID = normalizeOidString(v);
    }
  }
  if (!sysName && !sysDescr && !sysObjectID) return null;
  return { sysName, sysDescr, sysObjectID };
}

function extractSnmpwalkValue(line: string): string | null {
  const eq = line.indexOf("=");
  if (eq === -1) return null;
  const rhs = line.slice(eq + 1).trim();
  const quoted = rhs.match(/^"(.*)"$/) || rhs.match(/^'(.*)'$/);
  if (quoted) return quoted[1].replace(/\\"/g, '"');
  const m = rhs.match(/^(?:STRING|OCTET STRING|Hex-STRING):\s*(.+)$/i);
  if (m) return m[1].trim().replace(/^"(.*)"$/, "$1");
  const oidM = rhs.match(/^OID:\s*(.+)$/i);
  if (oidM) return oidM[1].trim();
  return rhs.length > 0 ? rhs : null;
}

/** Normalizza OID simbolico o numerico in stringa dotted. */
function normalizeOidString(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d+\./.test(t)) return t;
  return t;
}

export function stringifySnmpValue(value: unknown): string | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value.toString("utf-8").trim() || null;
  const s = String(value).trim();
  return s || null;
}

/** Esegue un SNMP GET su una lista di OID e restituisce i varbinds validi. */
export async function snmpGet(
  ip: string,
  community: string,
  port: number,
  oids: string[],
  timeoutMs: number = 3000
): Promise<Array<{ oid: string; value: unknown; type?: number }>> {
  const snmp = await import("net-snmp");
  const session = snmp.createSession(ip, community, { port, timeout: Math.floor(timeoutMs * 0.6) });

  return new Promise((resolve) => {
    let done = false;
    const finish = (result: Array<{ oid: string; value: unknown; type?: number }>) => {
      if (done) return;
      done = true;
      try {
        session.close();
      } catch {
        /* socket già chiuso */
      }
      resolve(result);
    };

    const t = setTimeout(() => finish([]), timeoutMs);

    session.get(oids, (error: Error | null, varbinds: Array<{ oid: string; value: unknown; type?: number }>) => {
      clearTimeout(t);
      if (error) {
        finish([]);
        return;
      }
      finish(varbinds || []);
    });
  });
}

/** Estrae valore stringa da un varbind, scartando errori SNMP. */
function parseVarbind(vb: { oid: string; value: unknown; type?: number }): { oid: string; value: string | null } {
  if (vb.type != null && SNMP_ERROR_TYPES.has(vb.type)) return { oid: vb.oid, value: null };
  const val = stringifySnmpValue(vb.value);
  if (!val || val === "noSuchObject" || val === "noSuchInstance" || val === "endOfMibView") return { oid: vb.oid, value: null };
  return { oid: vb.oid, value: val };
}

/**
 * Walk SNMP subtree (come snmpwalk) con limite varbind e timeout.
 * Usa session.subtree(oid, maxRepetitions, feed, done).
 */
export async function snmpSubwalkLimited(
  ip: string,
  community: string,
  port: number,
  baseOid: string,
  maxVarbinds: number,
  timeoutMs: number,
  maxRepetitions = 25
): Promise<Array<{ oid: string; value: unknown }>> {
  const snmp = await import("net-snmp");
  const session = snmp.createSession(ip, community, { port, timeout: Math.floor(timeoutMs * 0.5) });
  const rows: Array<{ oid: string; value: unknown }> = [];

  return new Promise((resolve) => {
    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      try {
        session.close();
      } catch {
        /* */
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(rows);
    }, timeoutMs);

    session.subtree(
      baseOid,
      maxRepetitions,
      (varbinds) => {
        for (const vb of varbinds) {
          if (snmp.isVarbindError(vb)) continue;
          rows.push({ oid: vb.oid, value: vb.value });
          if (rows.length >= maxVarbinds) return true;
        }
        return false;
      },
      (err: Error | undefined) => {
        clearTimeout(timer);
        cleanup();
        if (err) console.warn(`[SNMP] subtree ${baseOid} ${ip}:`, err.message);
        resolve(rows);
      }
    );
  });
}

/** ENTITY-MIB entPhysicalSerialNum: colonne .11.{indice} — walk quando i GET su .11.1/.11.2 non bastano */
const OID_ENT_PHYSICAL_SERIAL_NUM_SUBTREE = "1.3.6.1.2.1.47.1.1.1.1.11";

/**
 * Walk sulla colonna serial ENTITY-MIB per trovare un seriale chassis/scheda quando i GET fissi falliscono.
 * Usato da querySnmpInfo e (fallback) da getDeviceInfo per switch/router/firewall compatibili SNMP v2c.
 */
export async function trySnmpSerialFromEntityWalk(
  ip: string,
  community: string,
  port: number
): Promise<string | null> {
  try {
    const { isPlausibleHardwareSerial } = await import("@/lib/hardware-serial");
    const rows = await snmpSubwalkLimited(ip, community, port, OID_ENT_PHYSICAL_SERIAL_NUM_SUBTREE, 72, 7500, 18);
    let best: string | null = null;
    for (const r of rows) {
      const v = stringifySnmpValue(r.value);
      if (!v || !isPlausibleHardwareSerial(v)) continue;
      if (!best || v.length >= best.length) best = v;
    }
    return best;
  } catch {
    return null;
  }
}

function summarizeIfTable(rows: Array<{ oid: string; value: unknown }>): string | null {
  const descrs: string[] = [];
  for (const r of rows) {
    if (!r.oid.includes(".2.2.1.2.")) continue;
    const s = stringifySnmpValue(r.value);
    if (s && !/^(\d+|\s*)$/.test(s) && s.length < 120) descrs.push(s);
    if (descrs.length >= 5) break;
  }
  if (descrs.length === 0) return null;
  return descrs.join(", ");
}

function countArpEntries(rows: Array<{ oid: string; value: unknown }>): number {
  let n = 0;
  for (const r of rows) {
    if (r.oid.includes(".4.22.1.3.")) n++;
  }
  return n;
}

function summarizeHostResources(rows: Array<{ oid: string; value: unknown }>): string | null {
  const parts: string[] = [];
  for (const r of rows) {
    if (r.oid.endsWith(".25.2.2.0")) {
      const v = r.value;
      const num = typeof v === "number" ? v : parseInt(String(v), 10);
      if (!isNaN(num)) parts.push(`RAM ${num * 64} KiB`);
    }
    if (r.oid.includes(".25.3.3.1.2.")) {
      const load = stringifySnmpValue(r.value);
      if (load && /^\d+$/.test(load)) parts.push(`CPU ${load}%`);
    }
    if (parts.length >= 4) break;
  }
  return parts.length ? parts.slice(0, 4).join("; ") : null;
}

function summarizeUnifi(rows: Array<{ oid: string; value: unknown }>): string | null {
  const lines: string[] = [];
  for (const r of rows) {
    const s = stringifySnmpValue(r.value);
    if (s && s.length > 2 && s.length < 200) lines.push(s);
    if (lines.length >= 5) break;
  }
  return lines.length ? lines.join(" | ") : null;
}

async function collectSnmpWalkExtensions(
  ip: string,
  community: string,
  port: number
): Promise<Pick<
  SnmpInfo,
  | "mikrotikIdentity"
  | "unifiSummary"
  | "ifDescrSummary"
  | "sysUpTime"
  | "arpEntryCount"
  | "hostResourcesSummary"
>> {
  const fallback = {
    mikrotikIdentity: null as string | null,
    unifiSummary: null as string | null,
    ifDescrSummary: null as string | null,
    sysUpTime: null as string | null,
    arpEntryCount: null as number | null,
    hostResourcesSummary: null as string | null,
  };

  try {
    const [mikVb, sysRows, ifRows, arpRows, unifiRows, hrRows] = await Promise.all([
      snmpGet(ip, community, port, [OID_MIKROTIK_IDENTITY], 2500),
      snmpSubwalkLimited(ip, community, port, OID_SYSTEM_TREE, 24, 3500, 20),
      snmpSubwalkLimited(ip, community, port, OID_IFTABLE, 80, 4500, 25),
      snmpSubwalkLimited(ip, community, port, OID_IPNETTOMEDIA, 250, 6000, 25),
      snmpSubwalkLimited(ip, community, port, OID_UNIFI_ENTERPRISE, 50, 4000, 20),
      snmpSubwalkLimited(ip, community, port, OID_HOST_RESOURCES, 150, 6000, 25),
    ]);

    let mikrotikIdentity: string | null = null;
    for (const vb of mikVb) {
      if (vb.oid === OID_MIKROTIK_IDENTITY) {
        const { value } = parseVarbind(vb);
        if (value) mikrotikIdentity = value;
      }
    }

    let sysUpTime: string | null = null;
    for (const r of sysRows) {
      if (r.oid === OID_SYSUPTIME || r.oid.endsWith(".1.1.3.0")) {
        const t = stringifySnmpValue(r.value);
        if (t) {
          sysUpTime = t;
          break;
        }
      }
    }
    if (!sysUpTime) {
      const up = await snmpGet(ip, community, port, [OID_SYSUPTIME], 2000);
      const v = up[0] ? parseVarbind(up[0]).value : null;
      sysUpTime = v;
    }

    return {
      mikrotikIdentity,
      unifiSummary: summarizeUnifi(unifiRows),
      ifDescrSummary: summarizeIfTable(ifRows),
      sysUpTime,
      arpEntryCount: countArpEntries(arpRows) || null,
      hostResourcesSummary: summarizeHostResources(hrRows),
    };
  } catch {
    return fallback;
  }
}

export async function querySnmpInfo(ip: string, community: string, port: number = 161): Promise<SnmpInfo> {
  try {
    // FASE 1: OID base — sysDescr, sysName, sysObjectID
    const baseOids = [OID_SYSDESCR, OID_SYSNAME, OID_SYSOBJECTID];
    const baseVarbinds = await snmpGet(ip, community, port, baseOids, 3500);

    let sysName: string | null = null;
    let sysDescr: string | null = null;
    let sysObjectID: string | null = null;

    for (const vb of baseVarbinds) {
      const { oid, value } = parseVarbind(vb);
      if (!value) continue;
      if (oid === OID_SYSDESCR) sysDescr = value;
      else if (oid === OID_SYSNAME) sysName = value;
      else if (oid === OID_SYSOBJECTID) {
        const v = vb.value;
        if (typeof v === "string") sysObjectID = v.trim() || null;
        else if (Array.isArray(v) && v.length > 0) sysObjectID = v.join(".");
        else if (v != null && typeof v === "object" && "type" in v) {
          const obj = v as { type?: string; value?: string };
          if (obj.type === "OID" && obj.value) sysObjectID = obj.value;
          else sysObjectID = value;
        } else sysObjectID = value;
      }
    }

    // GET net-snmp vuoto: prova snmpwalk CLI (stesso subtree system)
    if (!sysName && !sysDescr && !sysObjectID) {
      const cli = await snmpwalkSystemGroupCli(ip, community, port);
      if (cli) {
        sysName = cli.sysName;
        sysDescr = cli.sysDescr;
        sysObjectID = cli.sysObjectID;
      }
    }

    // Se nessun dato base, il device non risponde SNMP — non tentare ENTITY-MIB né walk
    if (!sysName && !sysDescr && !sysObjectID) {
      return { sysName: null, sysDescr: null, sysObjectID: null, serialNumber: null, model: null, partNumber: null };
    }

    // FASE 2: ENTITY-MIB (opzionale) — serial, model, partNumber
    let serialNumber: string | null = null;
    let model: string | null = null;
    let partNumber: string | null = null;

    try {
      const entityOids = [OID_ENT_SERIAL_1, OID_ENT_SERIAL_2, OID_ENT_MODEL_1, OID_ENT_MODEL_2, OID_ENT_PARTNUM_1, OID_ENT_PARTNUM_2];
      const entityVarbinds = await snmpGet(ip, community, port, entityOids, 3000);

      for (const vb of entityVarbinds) {
        const { oid, value } = parseVarbind(vb);
        if (!value) continue;
        if (oid.includes(".47.1.1.1.1.11.")) serialNumber = serialNumber || value;
        else if (oid.includes(".47.1.1.1.1.2.")) model = model || value;
        else if (oid.includes(".47.1.1.1.1.13.")) partNumber = partNumber || value;
      }
    } catch {
      // ENTITY-MIB non supportata — ok, i dati base sono sufficienti
    }

    if (!serialNumber) {
      try {
        const fromWalk = await trySnmpSerialFromEntityWalk(ip, community, port);
        if (fromWalk) serialNumber = fromWalk;
      } catch {
        /* ignore */
      }
    }

    // FASE 3: walk estesi (paralleli, come snmpwalk da CLI)
    const ext = await collectSnmpWalkExtensions(ip, community, port);

    if (ext.mikrotikIdentity && !model) {
      model = `RouterOS (${ext.mikrotikIdentity})`;
    }
    if (!model && ext.unifiSummary && /unifi|UniFi/i.test(sysDescr || "")) {
      model = ext.unifiSummary.slice(0, 120);
    }

    return {
      sysName,
      sysDescr,
      sysObjectID,
      serialNumber,
      model,
      partNumber,
      ...ext,
    };
  } catch {
    return { sysName: null, sysDescr: null, sysObjectID: null, serialNumber: null, model: null, partNumber: null };
  }
}

/**
 * Testa OID enterprise dalle regole fingerprint per detect accurato.
 * Per ogni regola con oid_prefix, fa un GETNEXT per verificare se esiste almeno un OID
 * sotto quel prefisso. Se risponde con un OID che inizia con il prefisso, il device è di quel tipo.
 * Restituisce i match ordinati per priorità (più bassa = più specifica).
 */
async function testFingerprintOids(
  ip: string,
  community: string,
  port: number,
  onLog?: (msg: string) => void
): Promise<SnmpFingerprintOidMatch[]> {
  const matches: SnmpFingerprintOidMatch[] = [];

  let rules: Array<{ oid_prefix: string | null; device_label: string; classification: string; priority: number }> = [];
  try {
    const { getEnabledDeviceFingerprintRules } = await import("@/lib/db");
    rules = getEnabledDeviceFingerprintRules().filter((r) => r.oid_prefix);
  } catch {
    return matches;
  }

  if (rules.length === 0) return matches;

  // Ordina per priorità (più bassa = più specifica, va testata prima)
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  const uniqueOids = new Map<string, { device_label: string; classification: string; priority: number }>();
  for (const r of sortedRules) {
    if (r.oid_prefix && !uniqueOids.has(r.oid_prefix)) {
      uniqueOids.set(r.oid_prefix, { device_label: r.device_label, classification: r.classification, priority: r.priority });
    }
  }

  // Testa ogni prefisso OID con un walk limitato (1 risultato basta per confermare presenza)
  // Fermarsi al primo match specifico (priorità più bassa) per velocità
  for (const [prefix, info] of uniqueOids) {
    try {
      const rows = await snmpSubwalkLimited(ip, community, port, prefix, 1, 1500, 5);
      if (rows.length > 0) {
        // Verifica che l'OID restituito inizi effettivamente con il prefisso
        const normalizedPrefix = prefix.replace(/^\./, "");
        const responseOid = String(rows[0].oid).replace(/^\./, "");
        if (responseOid.startsWith(normalizedPrefix)) {
          matches.push({
            oid_prefix: prefix,
            device_label: info.device_label,
            classification: info.classification,
          });
          onLog?.(`SNMP OID ${prefix} → ${info.device_label}`);
          // Se troviamo un match specifico (priorità bassa), fermiamoci
          if (info.priority <= 10) {
            return matches;
          }
        }
      }
    } catch {
      // timeout o errore, continua con il prossimo
    }
  }

  return matches;
}

/**
 * Query OID specifici da un profilo vendor SNMP.
 * Prova ogni OID nel profilo fields e restituisce i valori trovati.
 */
export async function querySnmpProfileFields(
  ip: string,
  community: string,
  port: number,
  profile: import("./snmp-vendor-profiles").SnmpVendorProfile,
  onLog?: (msg: string) => void
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  const fieldsToQuery: Array<{ key: string; oids: string[] }> = [];

  for (const [key, value] of Object.entries(profile.fields)) {
    if (!value) continue;
    const oids = Array.isArray(value) ? value : [value];
    fieldsToQuery.push({ key, oids });
  }

  if (fieldsToQuery.length === 0) return result;

  for (const { key, oids } of fieldsToQuery) {
    for (const oid of oids) {
      try {
        const varbinds = await snmpGet(ip, community, port, [oid], 2500);
        if (varbinds.length > 0) {
          const { value } = parseVarbind(varbinds[0]);
          if (value) {
            result[key] = value;
            onLog?.(`[VendorProfile ${profile.id}] ${key}: ${value.slice(0, 60)}`);
            break;
          }
        }
      } catch {
        // OID non risponde, prova il successivo
      }
    }
    if (!result[key]) {
      result[key] = null;
    }
  }

  return result;
}

/**
 * Prova a interrogare SNMP su un host con più community string in ordine:
 * 1) community configurata (rete / profilo)
 * 2) `public`
 * 3) `private`
 * Si ferma alla prima community che risponde sui GET base.
 * Se trova un profilo vendor, interroga gli OID specifici per model/serial/firmware.
 */
export async function querySnmpInfoMultiCommunity(
  ip: string,
  communities: string[],
  port: number = 161,
  opts?: { onLog?: (msg: string) => void }
): Promise<SnmpInfo & { community: string | null }> {
  const { resolveSnmpVendorProfileFromDb } = await import("./snmp-vendor-profiles");

  for (const community of communities) {
    const result = await querySnmpInfo(ip, community, port);
    if (result.sysName || result.sysDescr || result.sysObjectID) {
      // Testa OID enterprise fingerprint per detect accurato
      const fpOidMatches = await testFingerprintOids(ip, community, port, opts?.onLog);

      // Risolvi profilo vendor e query campi specifici (usa profili dal DB)
      let vendorProfileId: string | null = null;
      let vendorProfileName: string | null = null;
      let vendorProfileConfidence: number | null = null;
      let vendorProfileCategory: string | null = null;
      let vendorProfileFirmware: string | null = null;
      let vendorProfileExtra: Record<string, string | null> | undefined;

      const profile = resolveSnmpVendorProfileFromDb(result.sysObjectID, result.sysDescr);
      if (profile) {
        opts?.onLog?.(`Profilo SNMP vendor: ${profile.name} (${profile.id}) — confidenza ${(profile.confidence * 100).toFixed(0)}%`);
        vendorProfileId = profile.id;
        vendorProfileName = profile.name;
        vendorProfileConfidence = profile.confidence;
        vendorProfileCategory = profile.category;

        const profileFields = await querySnmpProfileFields(ip, community, port, profile, opts?.onLog);

        // Arricchisci i campi standard da profilo (sovrascrivono ENTITY-MIB se presenti)
        if (profileFields.model && !result.model) {
          result.model = profileFields.model;
        }
        if (profileFields.serial && !result.serialNumber) {
          result.serialNumber = profileFields.serial;
        }
        if (profileFields.partNumber && !result.partNumber) {
          result.partNumber = profileFields.partNumber;
        }
        if (profileFields.firmware) {
          vendorProfileFirmware = profileFields.firmware;
        }

        // Raccogli campi extra vendor-specific
        const standardKeys = new Set(["model", "serial", "firmware", "os", "manufacturer", "partNumber"]);
        const extra: Record<string, string | null> = {};
        for (const [k, v] of Object.entries(profileFields)) {
          if (!standardKeys.has(k) && v !== null) {
            extra[k] = v;
          }
        }
        if (Object.keys(extra).length > 0) {
          vendorProfileExtra = extra;
        }
      }

      return {
        ...result,
        fingerprintOidMatches: fpOidMatches.length > 0 ? fpOidMatches : null,
        community,
        vendorProfileId,
        vendorProfileName,
        vendorProfileConfidence,
        vendorProfileCategory,
        vendorProfileFirmware,
        vendorProfileExtra,
      };
    }
  }
  return {
    sysName: null,
    sysDescr: null,
    sysObjectID: null,
    serialNumber: null,
    model: null,
    partNumber: null,
    community: null,
  };
}

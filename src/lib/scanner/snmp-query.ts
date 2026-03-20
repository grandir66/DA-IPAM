/**
 * SNMP query via net-snmp (no root required, unlike nmap -sU).
 *
 * Fase 1: GET OID base + ENTITY-MIB (serial/model) come prima.
 * Fase 2 (se la fase 1 risponde): walk paralleli sugli stessi OID tipici di snmpwalk da CLI
 * (system, ifTable, ARP, MikroTik, UniFi, HOST-RESOURCES).
 */
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
}

// Tipi errore net-snmp: noSuchObject=128, noSuchInstance=129, endOfMibView=130
const SNMP_ERROR_TYPES = new Set([128, 129, 130]);

function stringifySnmpValue(value: unknown): string | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value.toString("utf-8").trim() || null;
  const s = String(value).trim();
  return s || null;
}

/** Esegue un SNMP GET su una lista di OID e restituisce i varbinds validi. */
async function snmpGet(
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
async function snmpSubwalkLimited(
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
 * Prova a interrogare SNMP su un host con più community string in ordine:
 * 1) community configurata (rete / profilo)
 * 2) `public`
 * 3) `private`
 * Si ferma alla prima community che risponde sui GET base.
 */
export async function querySnmpInfoMultiCommunity(
  ip: string,
  communities: string[],
  port: number = 161
): Promise<SnmpInfo & { community: string | null }> {
  for (const community of communities) {
    const result = await querySnmpInfo(ip, community, port);
    if (result.sysName || result.sysDescr || result.sysObjectID) {
      return { ...result, community };
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

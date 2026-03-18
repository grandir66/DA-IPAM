/**
 * SNMP query via net-snmp (no root required, unlike nmap -sU).
 * Query divisa in due fasi: prima OID base (sysDescr, sysName, sysObjectID),
 * poi ENTITY-MIB (serial, model, partNumber) solo se la prima fase risponde.
 * Questo evita che un NoSuchName su ENTITY-MIB faccia fallire l'intera query.
 */
const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";
const OID_SYSNAME = "1.3.6.1.2.1.1.5.0";
const OID_SYSOBJECTID = "1.3.6.1.2.1.1.2.0";
// ENTITY-MIB OIDs (prova indice 1 e 2 per compatibilità con diversi device)
const OID_ENT_SERIAL_1 = "1.3.6.1.2.1.47.1.1.1.1.11.1";
const OID_ENT_SERIAL_2 = "1.3.6.1.2.1.47.1.1.1.1.11.2";
const OID_ENT_MODEL_1 = "1.3.6.1.2.1.47.1.1.1.1.2.1";
const OID_ENT_MODEL_2 = "1.3.6.1.2.1.47.1.1.1.1.2.2";
const OID_ENT_PARTNUM_1 = "1.3.6.1.2.1.47.1.1.1.1.13.1";
const OID_ENT_PARTNUM_2 = "1.3.6.1.2.1.47.1.1.1.1.13.2";

export interface SnmpInfo {
  sysName: string | null;
  sysDescr: string | null;
  sysObjectID: string | null;
  serialNumber: string | null;
  model: string | null;
  partNumber: string | null;
}

function stringifySnmpValue(value: unknown): string | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value.toString("utf-8").trim() || null;
  const s = String(value).trim();
  return s || null;
}

// Tipi errore net-snmp: noSuchObject=128, noSuchInstance=129, endOfMibView=130
const SNMP_ERROR_TYPES = new Set([128, 129, 130]);

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
      try { session.close(); } catch { /* socket già chiuso */ }
      resolve(result);
    };

    const t = setTimeout(() => finish([]), timeoutMs);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (session as any).get(oids, (error: Error | null, varbinds: Array<{ oid: string; value: unknown; type?: number }>) => {
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

export async function querySnmpInfo(
  ip: string,
  community: string,
  port: number = 161
): Promise<SnmpInfo> {
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
        // sysObjectID può essere un OID in vari formati
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

    // Se nessun dato base, il device non risponde SNMP — non tentare ENTITY-MIB
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

    return { sysName, sysDescr, sysObjectID, serialNumber, model, partNumber };
  } catch {
    return { sysName: null, sysDescr: null, sysObjectID: null, serialNumber: null, model: null, partNumber: null };
  }
}

/**
 * Prova a interrogare SNMP su un host con più community string in ordine.
 * Si ferma alla prima community che risponde.
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
  return { sysName: null, sysDescr: null, sysObjectID: null, serialNumber: null, model: null, partNumber: null, community: null };
}

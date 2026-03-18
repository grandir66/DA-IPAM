/**
 * Diagnostica SNMP dettagliata — mostra esattamente cosa risponde un device.
 */

const OID_SYSDESCR = "1.3.6.1.2.1.1.1.0";
const OID_SYSNAME = "1.3.6.1.2.1.1.5.0";
const OID_SYSOBJECTID = "1.3.6.1.2.1.1.2.0";

export interface SnmpDebugResult {
  ip: string;
  community: string;
  port: number;
  success: boolean;
  error: string | null;
  elapsed_ms: number;
  varbinds_raw: Array<{
    oid: string;
    type: number | undefined;
    value_type: string;
    value_raw: string;
    value_buffer_hex: string | null;
    value_parsed: string | null;
    is_error_type: boolean;
  }>;
  parsed: {
    sysName: string | null;
    sysDescr: string | null;
    sysObjectID: string | null;
  };
}

export async function snmpDebugQuery(ip: string, community: string, port: number = 161): Promise<SnmpDebugResult> {
  const start = Date.now();
  const result: SnmpDebugResult = {
    ip, community, port,
    success: false, error: null, elapsed_ms: 0,
    varbinds_raw: [],
    parsed: { sysName: null, sysDescr: null, sysObjectID: null },
  };

  try {
    const snmp = await import("net-snmp");
    const session = snmp.createSession(ip, community, { port, timeout: 5000 });
    // Solo i 3 OID base per diagnostica
    const oids = [OID_SYSDESCR, OID_SYSNAME, OID_SYSOBJECTID];

    const data = await new Promise<{ error: string | null; varbinds: Array<{ oid: string; value: unknown; type?: number }> }>((resolve) => {
      const t = setTimeout(() => {
        try { session.close(); } catch { /* socket già chiuso */ }
        resolve({ error: "Timeout (5s) — il device non ha risposto in tempo", varbinds: [] });
      }, 6000);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).get(oids, (error: Error | null, varbinds: Array<{ oid: string; value: unknown; type?: number }>) => {
        clearTimeout(t);
        try { session.close(); } catch { /* socket già chiuso */ }
        if (error) {
          resolve({ error: error.message, varbinds: [] });
        } else {
          resolve({ error: null, varbinds: varbinds || [] });
        }
      });
    });

    result.elapsed_ms = Date.now() - start;
    result.error = data.error;
    result.success = !data.error && data.varbinds.length > 0;

    for (const vb of data.varbinds) {
      const isBuffer = Buffer.isBuffer(vb.value);
      const isErrorType = vb.type != null && [128, 129, 130].includes(vb.type);

      let valueParsed: string | null = null;
      if (isBuffer) {
        valueParsed = (vb.value as Buffer).toString("utf-8").trim() || null;
      } else if (vb.value != null) {
        valueParsed = String(vb.value).trim() || null;
      }

      result.varbinds_raw.push({
        oid: vb.oid,
        type: vb.type,
        value_type: isBuffer ? "Buffer" : typeof vb.value,
        value_raw: isBuffer ? `Buffer(${(vb.value as Buffer).length})` : JSON.stringify(vb.value),
        value_buffer_hex: isBuffer ? (vb.value as Buffer).toString("hex") : null,
        value_parsed: valueParsed,
        is_error_type: isErrorType,
      });

      // Parse per risultato finale
      if (!isErrorType && valueParsed && valueParsed !== "noSuchObject" && valueParsed !== "noSuchInstance") {
        if (vb.oid === OID_SYSDESCR) result.parsed.sysDescr = valueParsed;
        else if (vb.oid === OID_SYSNAME) result.parsed.sysName = valueParsed;
        else if (vb.oid === OID_SYSOBJECTID) result.parsed.sysObjectID = valueParsed;
      }
    }
  } catch (err) {
    result.error = (err as Error).message;
    result.elapsed_ms = Date.now() - start;
  }

  return result;
}

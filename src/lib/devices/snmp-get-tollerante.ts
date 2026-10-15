/**
 * GET SNMP di più OID che regge gli agenti v1.
 *
 * In SNMPv1 un GET è tutto o niente: se l'agente non ha anche uno solo degli
 * OID risponde NoSuchName (error-status 2) e non restituisce nemmeno gli altri.
 * In v2c invece ogni OID mancante torna come varbind noSuchObject e il resto
 * arriva. Qui, se il GET di gruppo fallisce con NoSuchName, si rifà un GET per
 * ogni OID e si tengono quelli che rispondono. Ogni altro errore passa com'è:
 * un timeout non deve diventare «nessun dato».
 *
 * Incidente: DTS 2026-10-15, access point Ubiquiti solo v1 senza ENTITY-MIB.
 */

export type SnmpVarbind = { oid: string; value: Buffer | string | number | null; type?: number };

export type SnmpGetSession = {
  get: (oids: string[], cb: (err: Error | null, varbinds: SnmpVarbind[]) => void) => void;
};

/** error-status SNMP NoSuchName (RFC 1157); net-snmp lo mette in `status`. */
const NO_SUCH_NAME = 2;

function isNoSuchName(err: Error): boolean {
  return (err as Error & { status?: number }).status === NO_SUCH_NAME;
}

function get(session: SnmpGetSession, oids: string[]): Promise<SnmpVarbind[]> {
  return new Promise((resolve, reject) => {
    session.get(oids, (err, varbinds) => (err ? reject(err) : resolve(varbinds)));
  });
}

export async function snmpGetTollerante(session: SnmpGetSession, oids: string[]): Promise<SnmpVarbind[]> {
  try {
    return await get(session, oids);
  } catch (err) {
    if (oids.length < 2 || !(err instanceof Error) || !isNoSuchName(err)) throw err;
  }
  const out: SnmpVarbind[] = [];
  for (const oid of oids) {
    try {
      out.push(...(await get(session, [oid])));
    } catch (err) {
      if (!(err instanceof Error) || !isNoSuchName(err)) throw err;
    }
  }
  return out;
}

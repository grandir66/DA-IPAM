/**
 * SNMP query via net-snmp (no root required, unlike nmap -sU).
 * Used as fallback when nmap snmp-info fails or for hosts without nmap SNMP data.
 */
export async function querySnmpInfo(
  ip: string,
  community: string,
  port: number = 161
): Promise<{ sysName: string | null; sysDescr: string | null }> {
  try {
    const snmp = await import("net-snmp");
    const session = snmp.createSession(ip, community, { port, timeout: 2000 });
    const oids = ["1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.1.5.0"];

    return new Promise((resolve) => {
      const t = setTimeout(() => {
        session.close();
        resolve({ sysName: null, sysDescr: null });
      }, 3500);

      (session as any).get(oids, (error: Error | null, varbinds: Array<{ oid: string; value: Buffer | string | number }>) => {
        clearTimeout(t);
        session.close();
        if (error) {
          resolve({ sysName: null, sysDescr: null });
          return;
        }
        let sysName: string | null = null;
        let sysDescr: string | null = null;
        for (const vb of varbinds) {
          const val = Buffer.isBuffer(vb.value) ? vb.value.toString("utf-8") : String(vb.value);
          if (vb.oid === "1.3.6.1.2.1.1.1.0") sysDescr = val || null;
          if (vb.oid === "1.3.6.1.2.1.1.5.0") sysName = val || null;
        }
        resolve({ sysName, sysDescr });
      });
    });
  } catch {
    return { sysName: null, sysDescr: null };
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
): Promise<{ sysName: string | null; sysDescr: string | null; community: string | null }> {
  for (const community of communities) {
    const result = await querySnmpInfo(ip, community, port);
    if (result.sysName || result.sysDescr) {
      return { ...result, community };
    }
  }
  return { sysName: null, sysDescr: null, community: null };
}

import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { provaVersioniSnmp, type VersioneSnmp } from "@/lib/protocols/snmp-sessione";

/**
 * Test SNMP connectivity on a host.
 * GET /api/test-snmp?host=192.168.1.1 (community nell'intestazione x-snmp-community)
 * Probe SNMP verso host arbitrario (audit SEC-9): solo admin.
 */
export async function GET(request: Request) {
  const authCheck = await requireAdmin();
  if (isAuthError(authCheck)) return authCheck;
  const { searchParams } = new URL(request.url);
  const host = searchParams.get("host");
  // La community non si passa nell'indirizzo (finirebbe nel registro degli accessi): intestazione `x-snmp-community` (14/11).
  if (searchParams.has("community")) {
    return NextResponse.json({ error: "La community non si passa nell'indirizzo: usa l'intestazione x-snmp-community." }, { status: 400 });
  }
  const community = request.headers.get("x-snmp-community") || "public";
  const port = parseInt(searchParams.get("port") || "161", 10);

  if (!host) {
    return NextResponse.json({ error: "Parametro host richiesto" }, { status: 400 });
  }

  try {
    const snmp = await import("net-snmp");
    const result: { success: boolean; sysDescr?: string; sysName?: string; snmp_version?: VersioneSnmp; error?: string } = { success: false };

    // Senza apparato non si sa la versione: v2c, poi v1, e si dice quale ha risposto.
    const esito = await provaVersioniSnmp(snmp, host, community, {
      port,
      timeoutMs: 5000,
      oids: ["1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.1.5.0"],
    });
    if (!esito.ok) throw new Error(esito.errore);
    for (const vb of esito.varbinds) {
      const val = Buffer.isBuffer(vb.value) ? vb.value.toString("utf-8") : String(vb.value);
      if (vb.oid === "1.3.6.1.2.1.1.1.0") result.sysDescr = val;
      if (vb.oid === "1.3.6.1.2.1.1.5.0") result.sysName = val;
    }
    result.success = true;
    result.snmp_version = esito.versione;

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Errore SNMP",
    }, { status: 200 });
  }
}

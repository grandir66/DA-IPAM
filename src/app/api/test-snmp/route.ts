import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/**
 * Test SNMP connectivity on a host.
 * GET /api/test-snmp?host=192.168.1.1&community=public
 */
export async function GET(request: Request) {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  const { searchParams } = new URL(request.url);
  const host = searchParams.get("host");
  const community = searchParams.get("community") || "public";
  const port = parseInt(searchParams.get("port") || "161", 10);

  if (!host) {
    return NextResponse.json({ error: "Parametro host richiesto" }, { status: 400 });
  }

  try {
    const snmp = await import("net-snmp");
    const result: { success: boolean; sysDescr?: string; sysName?: string; error?: string } = { success: false };

    const session = snmp.createSession(host, community, { port, timeout: 5000 });

    const getOids = ["1.3.6.1.2.1.1.1.0", "1.3.6.1.2.1.1.5.0"];

    await new Promise<void>((resolve, reject) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (session as any).get(getOids, (error: Error | null, varbinds: Array<{ oid: string; value: Buffer | string | number }>) => {
        session.close();
        if (error) {
          result.error = error.message;
          reject(error);
          return;
        }
        for (const vb of varbinds) {
          const val = Buffer.isBuffer(vb.value) ? vb.value.toString("utf-8") : String(vb.value);
          if (vb.oid === "1.3.6.1.2.1.1.1.0") result.sysDescr = val;
          if (vb.oid === "1.3.6.1.2.1.1.5.0") result.sysName = val;
        }
        result.success = true;
        resolve();
      });
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Errore SNMP",
    }, { status: 200 });
  }
}

import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { campiDaRilievi, type RigaRilievo } from "@/lib/scanner/profili/campi-scheda";
import { NO_STORE } from "@/lib/controllers/route-helpers";

interface RigaDb {
  profilo: string;
  porta: number | null;
  protocollo: "tcp" | "udp" | null;
  script: string;
  elems_json: string | null;
  output: string | null;
  at: string;
}

/** `elems_json` e' scritto da noi, ma una riga rotta non deve far cadere la tab. */
function elems(j: string | null): Record<string, string> {
  if (!j) return {};
  try {
    const v: unknown = JSON.parse(j);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (typeof x === "string") out[k] = x;
      else if (typeof x === "number" || typeof x === "boolean") out[k] = String(x);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * I rilievi dei profili di scansione dell'host (tab «Rilievi» della scheda), letti
 * come tabella di campi significativi: la lettura la fa `campiDaRilievi`, la
 * stessa di chi riempie le colonne dell'host.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
      const hostId = Number(id);
      if (!Number.isInteger(hostId) || hostId <= 0) {
        return Response.json({ error: "id host non valido" }, { status: 400 });
      }
      const code = getCurrentTenantCode();
      if (!code) return Response.json({ error: "contesto tenant assente" }, { status: 500 });
      const righeDb = getTenantDb(code)
        .prepare(
          `SELECT profilo, porta, protocollo, script, elems_json, output, at
             FROM host_profilo_rilievi WHERE host_id = ?
            ORDER BY at DESC, script, porta`
        )
        .all(hostId) as RigaDb[];
      const righe: RigaRilievo[] = righeDb.map((r) => ({
        profilo: r.profilo,
        porta: r.porta,
        protocollo: r.protocollo,
        script: r.script,
        elems: elems(r.elems_json),
        output: r.output,
        at: r.at,
      }));
      const tabella = campiDaRilievi(righe);
      return Response.json(
        {
          ...tabella,
          profili: [...new Set(righe.map((r) => r.profilo))].sort(),
        },
        { headers: NO_STORE }
      );
    } catch (error) {
      console.error("Errore nella lettura dei rilievi di profilo:", error);
      return Response.json({ error: "Errore nella lettura dei rilievi" }, { status: 500 });
    }
  });
}

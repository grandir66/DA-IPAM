/**
 * GET /api/vulnerabilities/per-host
 *
 * Vista per host della pagina Vulnerabilità (Riccardo, 22/10): una riga per host (o per IP senza
 * match nell'inventario) con i conteggi per severità, quante vulnerabilità sono sfruttate
 * (CISA KEV) o hanno un exploit pubblico (Exploit-DB) e l'EPSS più alto. Stessi filtri della
 * vista per CVE; la ricerca guarda anche IP e nome dell'host.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getVulnerabilitiesByHost, type FiltroExploit, type OsFamily, type VulnHostOpts } from "@/lib/db-tenant";
import { exploitPerRotte } from "@/lib/vuln/exploit-feed/archivio";
import type { Severity } from "@/lib/severity-style";

const SeverityEnum = z.enum(["Critical", "High", "Medium", "Low"]);
const OsFamilyEnum = z.enum(["Windows", "Linux", "Apple", "Unknown"]);
const ExploitEnum = z.enum(["kev", "edb"]);

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  severity: z.string().optional(),
  sources: z.string().optional(),
  os: z.string().optional(),
  search: z.string().max(200).optional(),
  hasCve: z.enum(["true", "false"]).optional(),
  exploit: z.string().optional(),
  sortBy: z.enum(["severity", "exploit", "vuln_count", "ip", "latest_scanned_at"]).default("severity"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  // Anche le scansioni superate (pulsante della pagina); di base solo l'ultima di ogni rete (27/10/2026).
  precedenti: z.enum(["1", "true"]).optional(),
});

/** «a,b,c» → i soli valori ammessi dall'enum. */
function elenco<T extends string>(raw: string | undefined, ammessi: z.ZodEnum<{ [K in T]: K }>): T[] | undefined {
  if (!raw) return undefined;
  return raw.split(",").map((s) => s.trim()).filter((s): s is T => ammessi.safeParse(s).success);
}

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Parametri non validi" }, { status: 400 });
  }
  const q = parsed.data;
  const { exploitDi, errore: exploit_errore } = exploitPerRotte();
  const opts: VulnHostOpts = {
    page: q.page,
    pageSize: q.pageSize,
    severity: elenco<Severity>(q.severity, SeverityEnum),
    sources: q.sources ? q.sources.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    osFamilies: elenco<OsFamily>(q.os, OsFamilyEnum),
    search: q.search,
    hasCve: q.hasCve === "true" ? true : q.hasCve === "false" ? false : undefined,
    exploit: elenco<FiltroExploit>(q.exploit, ExploitEnum),
    exploitDi,
    sortBy: q.sortBy,
    sortDir: q.sortDir,
    precedenti: q.precedenti != null,
  };

  return withTenantFromSession(() => {
    try {
      const { data, total, severity_rollup } = getVulnerabilitiesByHost(opts);
      return NextResponse.json({
        data,
        total,
        page: opts.page,
        pageSize: opts.pageSize,
        totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
        severity_rollup,
        exploit_errore,
      });
    } catch (e) {
      console.error("[api/vulnerabilities/per-host] errore:", e);
      return NextResponse.json({ error: "Errore nel recupero delle vulnerabilità per host" }, { status: 500 });
    }
  });
}

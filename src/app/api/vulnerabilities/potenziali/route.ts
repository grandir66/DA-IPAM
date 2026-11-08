/**
 * GET/POST /api/vulnerabilities/potenziali — le CVE potenziali del tenant, dedotte dalle
 * versioni che i servizi dichiarano (piano `daipam-cve-locali`, 08/11/2026).
 *
 * GET → elenco per CVE (paginato) + stato dell'archivio NVD e interruttore. Con l'interruttore
 *       spento risponde `acceso: false` e niente righe: la pagina non mostra la sezione.
 * POST `{ azione: "aggiorna" }` → giro dei feed in sottofondo (risponde subito);
 *      `{ azione: "ricalcola" }` → ricalcolo dei tenant dall'archivio già scaricato.
 * Lettura → requireAuth; scrittura → requireAdmin. I feed sono dell'installazione, le righe del tenant.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { archivioCve, conteggiArchivio, statoSync } from "@/lib/vuln/cve-locali/archivio";
import { elencoCvePotenziali } from "@/lib/vuln/cve-locali/arricchimento";
import { avviaGiroCveOra, cveLocaliAccese, giroCveInCorso, ricalcolaOra } from "@/lib/vuln/cve-locali/job";
import { exploitPerRotte } from "@/lib/vuln/exploit-feed/archivio";

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().max(200).optional(),
  sortBy: z.enum(["cvss", "host_count", "cve_id"]).default("cvss"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

const AzioneSchema = z.object({ azione: z.enum(["aggiorna", "ricalcola"]) });

function statoArchivio() {
  const arch = archivioCve();
  return { conteggi: conteggiArchivio(arch), fonti: statoSync(arch).filter((s) => !/^\d{4}$/.test(s.fonte) || s.errore) };
}

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Parametri non validi" }, { status: 400 });
  }
  const acceso = cveLocaliAccese();
  if (!acceso) return NextResponse.json({ acceso, data: [], total: 0, host_totali: 0 });
  const q = parsed.data;
  let archivio: ReturnType<typeof statoArchivio> | null = null;
  let archivio_errore: string | null = null;
  try {
    archivio = statoArchivio();
  } catch (e) {
    console.error("[api/vulnerabilities/potenziali] archivio NVD:", (e as Error).message);
    archivio_errore = "archivio NVD non leggibile";
  }
  const { exploitDi, errore: exploit_errore } = exploitPerRotte();
  return withTenantFromSession(() => {
    try {
      const codice = getCurrentTenantCode();
      if (!codice) return NextResponse.json({ error: "Nessun cliente selezionato" }, { status: 400 });
      const elenco = elencoCvePotenziali(getTenantDb(codice), q);
      const exploit = exploitDi ? exploitDi(elenco.data.map((r) => r.cve_id)) : new Map();
      return NextResponse.json({
        acceso,
        in_corso: giroCveInCorso(),
        ...elenco,
        data: elenco.data.map((r) => ({ ...r, exploit: exploit.get(r.cve_id) ?? null })),
        page: q.page,
        pageSize: q.pageSize,
        totalPages: Math.max(1, Math.ceil(elenco.total / q.pageSize)),
        archivio,
        archivio_errore,
        exploit_errore,
      });
    } catch (e) {
      console.error("[api/vulnerabilities/potenziali GET]", (e as Error).message);
      return NextResponse.json({ error: "Errore nella lettura delle vulnerabilità potenziali" }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  const body = await request.json().catch(() => null);
  const parsed = AzioneSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Azione non valida" }, { status: 400 });
  try {
    if (parsed.data.azione === "aggiorna") {
      avviaGiroCveOra();
      return NextResponse.json({ avviato: true, in_corso: true });
    }
    const esiti = ricalcolaOra();
    return NextResponse.json({ ricalcolati: esiti });
  } catch (e) {
    console.error("[api/vulnerabilities/potenziali POST]", (e as Error).message);
    return NextResponse.json({ error: "Operazione non riuscita" }, { status: 500 });
  }
}

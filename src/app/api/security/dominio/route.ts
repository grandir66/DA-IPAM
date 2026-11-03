/**
 * Pagina «Sicurezza del dominio» (29/10/2026): eventi letti dai domain controller via WinRM, senza Wazuh.
 *
 *   GET   → stato della lettura, numeri, grafico, classifiche ed eventi paginati (window, tipo, cerca, pagina)
 *   POST  → legge subito i DC del cliente
 *   PUT   → sceglie quali DC leggere ({ dc: [nomi] }, o { dc: null } per tornare alla scelta automatica)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getTenantDb, getCurrentTenantCode } from "@/lib/db-tenant";
import { STATS_WINDOWS, bucketIntervalFor, sinceForWindow, windowById } from "@/lib/integrations/wazuh-alerts-stats";
import { ensureEventiDcSchema, listaEventiDc, numeriEventiDc, TIPI_EVENTO_DC, type TipoEventoDc } from "@/lib/security/eventi-dc/db";
import { statisticheDc } from "@/lib/security/eventi-dc/statistiche";
import { dcDisponibili, dcScelti, lettureDcScelti, MAX_DC_AUTOMATICI, modoEventiDc, motivoPerNonLeggere, scriviDcScelti, wazuhLeggeGliAllarmi } from "@/lib/security/eventi-dc/raccolta";
import { giroEventiDcDelContesto, testoEsitoDc, ultimoGiroDc } from "@/lib/security/eventi-dc/job";

const PER_PAGINA = 50;

const QuerySchema = z.object({
  window: z.string().max(10).optional(),
  tipo: z.enum(Object.keys(TIPI_EVENTO_DC) as [TipoEventoDc, ...TipoEventoDc[]]).optional(),
  cerca: z.string().max(100).optional(),
  pagina: z.coerce.number().int().min(1).max(10_000).optional(),
});

function dbDelContesto() {
  const code = getCurrentTenantCode();
  if (!code) throw new Error("Nessun contesto del cliente");
  return { code, db: getTenantDb(code) };
}

export async function GET(req: Request) {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const q = parsed.data;
    const win = windowById(q.window ?? "24h") ?? STATS_WINDOWS[1]!;
    const since = sinceForWindow(win.hours);
    const pagina = q.pagina ?? 1;

    const { code, db } = dbDelContesto();
    ensureEventiDcSchema(db);
    const modo = modoEventiDc(db);
    const disponibili = dcDisponibili(db);
    const { righe, totale } = listaEventiDc(db, { since, tipo: q.tipo, cerca: q.cerca, limit: PER_PAGINA, offset: (pagina - 1) * PER_PAGINA });

    return NextResponse.json({
      lettura: {
        modo,
        motivo: motivoPerNonLeggere(modo, wazuhLeggeGliAllarmi()),
        dcConfigurati: disponibili.filter((d) => d.scelto).length,
        dcDisponibili: disponibili.map((d) => ({ dc: d.dc, scelto: d.scelto, dellIntegrazione: d.dellIntegrazione })),
        sceltaManuale: dcScelti(db) !== null,
        maxAutomatici: MAX_DC_AUTOMATICI,
        ultimoGiro: ultimoGiroDc(code),
        letture: lettureDcScelti(db),
      },
      window: win.id,
      windows: STATS_WINDOWS.filter((w) => w.id !== "1h"),
      interval: bucketIntervalFor(win.hours),
      tipi: Object.entries(TIPI_EVENTO_DC).map(([id, t]) => ({ id, etichetta: t.etichetta })),
      numeri: numeriEventiDc(db, since),
      stats: statisticheDc(db, { since, interval: bucketIntervalFor(win.hours) }),
      eventi: righe,
      totale,
      pagina,
      perPagina: PER_PAGINA,
    });
  });
}

export async function POST() {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    try {
      const esito = await giroEventiDcDelContesto();
      const t = testoEsitoDc(esito);
      // «error» porta il motivo a fetchJson: senza, la pagina diceva solo «Errore del server (HTTP 409)» (70151, 03/11/2026).
      if (esito.saltato) return NextResponse.json({ ok: false, testo: t.testo, error: t.testo }, { status: 409 });
      return NextResponse.json(
        { ok: t.ok, testo: t.testo, ...(t.ok ? {} : { error: t.testo }), nuovi: esito.dc.reduce((n, d) => n + d.nuovi, 0) },
        { status: t.ok ? 200 : 502 },
      );
    } catch (e) {
      return NextResponse.json({ error: `Lettura dei DC non riuscita: ${(e as Error).message}` }, { status: 500 });
    }
  });
}

const SceltaSchema = z.object({ dc: z.array(z.string().min(1).max(255)).max(500).nullable() });

export async function PUT(req: Request) {
  return withTenantFromSession(async () => {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Richiesta non valida" }, { status: 400 });
    }
    const parsed = SceltaSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    const { db } = dbDelContesto();
    ensureEventiDcSchema(db);
    if (parsed.data.dc === null) {
      scriviDcScelti(db, null);
      return NextResponse.json({ ok: true });
    }
    const noti = new Set(dcDisponibili(db).map((d) => d.dc.toLowerCase()));
    const ignoti = parsed.data.dc.filter((n) => !noti.has(n.toLowerCase()));
    if (ignoti.length) return NextResponse.json({ error: `DC sconosciuti: ${ignoti.slice(0, 5).join(", ")}` }, { status: 400 });
    if (parsed.data.dc.length === 0) return NextResponse.json({ error: "Scegli almeno un DC" }, { status: 400 });
    scriviDcScelti(db, parsed.data.dc);
    return NextResponse.json({ ok: true });
  });
}

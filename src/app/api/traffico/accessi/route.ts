import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { accessiAccesi, elencoAccessi, GIORNI_ACCESSI, impostaAccessi } from "@/lib/traffico/accessi";
import { dbTraffico } from "@/lib/traffico/lettura";

/**
 * ZONA ROSSA (tappa 7, 23/11/2026): nomi utente degli accessi. Solo amministratori, anche in lettura.
 * Nessun log con i dati delle righe; nessun export.
 */
const PERIODI = [1, 7, 30, GIORNI_ACCESSI];
const Cambio = z.object({ acceso: z.boolean() });

/** GET /api/traffico/accessi?giorni=&cerca=&pagina= — a interruttore spento: `{ acceso: false }` e nessuna riga. */
export async function GET(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    if (!accessiAccesi()) return NextResponse.json({ acceso: false }, { headers: NO_STORE });
    const q = new URL(req.url).searchParams;
    const giorni = Number(q.get("giorni") ?? 7);
    if (!PERIODI.includes(giorni)) return NextResponse.json({ error: "Periodo non valido" }, { status: 400 });
    try {
      const elenco = elencoAccessi(dbTraffico(), { giorni, cerca: q.get("cerca") ?? "", pagina: Number(q.get("pagina") ?? 1) || 1 });
      return NextResponse.json({ acceso: true, ...elenco }, { headers: NO_STORE });
    } catch (e) {
      // solo il tipo dell'errore: il messaggio potrebbe contenere la ricerca, cioè un nome utente
      console.error("[traffico] accessi: errore di lettura", e instanceof Error ? e.name : "sconosciuto");
      return NextResponse.json({ error: "Errore nel recupero degli accessi" }, { status: 500 });
    }
  });
}

/** PUT /api/traffico/accessi — `{ acceso }`: l'interruttore dell'installazione. */
export async function PUT(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const dati = Cambio.safeParse(await readJson(req));
    if (!dati.success) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
    impostaAccessi(dati.data.acceso);
    return NextResponse.json({ ok: true, acceso: dati.data.acceso }, { headers: NO_STORE });
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { collectorGet, ImprontaCambiata, normalizzaImpronta, urlCollector } from "@/lib/traffico/collector-client";
import { creaCollector, elencoCollector, type StatoCollector } from "@/lib/traffico/lettura";

const Nuovo = z.object({
  nome: z.string().trim().min(1).max(80),
  sede: z.string().trim().max(80).default(""),
  url: z.string().trim().min(1).max(200),
  gettone: z.string().trim().min(16).max(200),
  impronta: z.string().trim().min(64).max(100),
});

/** GET /api/traffico/collector — i collector di traffico del cliente, senza gettone. */
export async function GET() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(() => {
    try {
      return NextResponse.json({ collector: elencoCollector() }, { headers: NO_STORE });
    } catch (e) {
      console.error("[traffico] elenco collector:", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Errore nel recupero dei collector" }, { status: 500 });
    }
  });
}

/** POST /api/traffico/collector — registra un collector: si salva solo se risponde a `/v1/stato`. */
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const dati = Nuovo.safeParse(await readJson(req));
    if (!dati.success) {
      return NextResponse.json({ error: "Dati non validi", campi: dati.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
    }
    const u = urlCollector(dati.data.url);
    if (!u) return NextResponse.json({ error: "L'indirizzo deve essere https://<indirizzo>:<porta>" }, { status: 400 });
    const impronta = normalizzaImpronta(dati.data.impronta);
    if (impronta.length !== 64) return NextResponse.json({ error: "L'impronta SHA-256 del certificato ha 64 cifre esadecimali" }, { status: 400 });
    const url = `https://${u.host}`;
    try {
      const stato = await collectorGet<StatoCollector>({ url, gettone: dati.data.gettone, impronta }, "/v1/stato");
      const id = creaCollector({ nome: dati.data.nome, sede: dati.data.sede, url, gettone: dati.data.gettone, impronta });
      return NextResponse.json({ id, versione: stato.versione, copertura: stato.copertura }, { status: 201, headers: NO_STORE });
    } catch (e) {
      if (e instanceof ImprontaCambiata) {
        return NextResponse.json({ error: "Il certificato del collector non corrisponde all'impronta data" }, { status: 409 });
      }
      return NextResponse.json({ error: e instanceof Error ? e.message : "Il collector non risponde" }, { status: 502 });
    }
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { NO_STORE, readJson } from "@/lib/controllers/route-helpers";
import { normalizzaImpronta, urlCollector } from "@/lib/traffico/collector-client";
import { aggiornaCollector, eliminaCollector } from "@/lib/traffico/lettura";

const Modifica = z.object({
  nome: z.string().trim().min(1).max(80).optional(),
  sede: z.string().trim().max(80).optional(),
  url: z.string().trim().min(1).max(200).optional(),
  gettone: z.string().trim().min(16).max(200).optional(),
  impronta: z.string().trim().min(64).max(100).optional(),
  attivo: z.boolean().optional(),
});

function idDa(testo: string): number | null {
  const n = Number(testo);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** PATCH /api/traffico/collector/[id] — nome, sede, indirizzo, gettone, impronta, acceso/spento. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const id = idDa((await params).id);
    if (!id) return NextResponse.json({ error: "Collector non trovato" }, { status: 404 });
    const dati = Modifica.safeParse(await readJson(req));
    if (!dati.success) {
      return NextResponse.json({ error: "Dati non validi", campi: dati.error.issues.map((i) => i.path.join(".")) }, { status: 400 });
    }
    const cambio = { ...dati.data };
    if (cambio.url !== undefined) {
      const u = urlCollector(cambio.url);
      if (!u) return NextResponse.json({ error: "L'indirizzo deve essere https://<indirizzo>:<porta>" }, { status: 400 });
      cambio.url = `https://${u.host}`;
    }
    if (cambio.impronta !== undefined) {
      cambio.impronta = normalizzaImpronta(cambio.impronta);
      if (cambio.impronta.length !== 64) return NextResponse.json({ error: "L'impronta SHA-256 del certificato ha 64 cifre esadecimali" }, { status: 400 });
    }
    if (!aggiornaCollector(id, cambio)) return NextResponse.json({ error: "Collector non trovato" }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  });
}

/** DELETE /api/traffico/collector/[id] — toglie il collector e le coppie che ha portato. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return withTenantFromSession(async () => {
    const id = idDa((await params).id);
    if (!id || !eliminaCollector(id)) return NextResponse.json({ error: "Collector non trovato" }, { status: 404 });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrOnboarding, isAuthError, getTenantCodeFromSession } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { erroriScelte } from "@/lib/onboarding/reti-trunk";
import { creaRetiTrunk, leggiRetiTrunk } from "@/lib/onboarding/reti-trunk-server";

/**
 * Reti viste dal sensore trunk, nel passo «Subnet» del wizard (28/10).
 *
 * GET: le reti del trunk e quelle già in DA-IPAM (`?rileggi=1` legge subito la
 * sonda). La scelta di cosa proporre la fa il wizard con `proposteTrunk`, così
 * segue la rete nativa mentre il tecnico la scrive.
 * POST: crea le reti scelte, con router, DNS e credenziali della rete nativa.
 */
const NO_CACHE = { "Cache-Control": "no-store" };
const SENZA_CLIENTE = "Seleziona un cliente: la configurazione guidata vale per un cliente alla volta";
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const Corpo = z.object({
  scelte: z
    .array(
      z.object({
        vid: z.number().int().min(0).max(4094),
        cidr: z.string().max(18),
        gateway: z.string().max(15).default(""),
        nome: z.string().max(100),
      }),
    )
    .min(1, "Nessuna rete scelta")
    .max(64),
  rete_nativa: z.string().max(18).nullable().optional(),
  router_id: z.number().int().positive().nullable().optional(),
  credential_ids: z.array(z.number().int().positive()).max(50).default([]),
  dns_server: z.union([z.string().regex(IPV4, "DNS non valido"), z.literal("")]).nullable().optional(),
});

export async function GET(request: Request) {
  const sessione = await requireAdminOrOnboarding();
  if (isAuthError(sessione)) return sessione;
  const tenantCode = getTenantCodeFromSession(sessione);
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json({ error: SENZA_CLIENTE }, { status: 400 });
  }
  const rileggi = new URL(request.url).searchParams.get("rileggi") === "1";
  return withTenantFromSession(async () => {
    try {
      return NextResponse.json(await leggiRetiTrunk(rileggi), { headers: NO_CACHE });
    } catch (e) {
      console.error("[onboarding/reti-trunk] lettura:", e);
      return NextResponse.json({ error: "Impossibile leggere le reti del trunk" }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  const sessione = await requireAdminOrOnboarding();
  if (isAuthError(sessione)) return sessione;
  const tenantCode = getTenantCodeFromSession(sessione);
  if (!tenantCode || tenantCode === "__ALL__") {
    return NextResponse.json({ error: SENZA_CLIENTE }, { status: 400 });
  }
  const body: unknown = await request.json().catch(() => null);
  const parsed = Corpo.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Richiesta non valida" }, { status: 400 });
  }
  const d = parsed.data;
  const errori = erroriScelte(d.scelte, d.rete_nativa ?? null);
  const primo = errori.findIndex((e) => e != null);
  if (primo >= 0) {
    return NextResponse.json(
      { error: `«${d.scelte[primo].nome.trim() || d.scelte[primo].cidr}»: ${errori[primo]}`, errori },
      { status: 400 },
    );
  }
  return withTenantFromSession(async () => {
    try {
      const esito = creaRetiTrunk(d.scelte, {
        routerId: d.router_id ?? null,
        credentialIds: d.credential_ids,
        dns: d.dns_server || null,
      });
      return NextResponse.json(esito);
    } catch (e) {
      console.error("[onboarding/reti-trunk] creazione:", e);
      return NextResponse.json({ error: "Impossibile creare le reti del trunk" }, { status: 500 });
    }
  });
}

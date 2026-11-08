/**
 * Pianificazione «Per device» della rete (Passo 6, 08/11/2026, tavola oggetti 27-29).
 * GET: la pianificazione e, se c'è, quella «Un profilo solo» che salvando si spegnerebbe.
 * PUT: salva (solo l'amministratore). Se la rete ha una pianificazione «Un profilo solo» accesa risponde 409
 * con la sua descrizione, finché la richiesta non porta `sostituisci: true` (decisione di Riccardo: una sola
 * pianificazione per rete). Se la sonda non toglie quella vecchia, la nuova non si salva.
 * DELETE: spegne, senza cancellare (Modifica ripropone l'ultima).
 *
 * Tappa 3 (08/11/2026, tavola oggetto 43): `modo: "finestra"` con giorni, dalle e alle. I gruppi confermati vanno alla
 * sonda, che lavora nella fascia; passare da finestra a orario (o spegnere) toglie la finestra dalla sonda.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getNetworkById } from "@/lib/db";
import {
  FAMIGLIE_PIANIFICABILI, leggiPianificazione, salvaFinestraDevice, salvaPianificazione, spegniPianificazione,
} from "@/lib/vuln/proposta/pianificazione";
import { pianificazioneUnProfilo, togliUnProfilo } from "@/lib/vuln/proposta/pianificazione-rete";
import { firmaGruppi, gruppiFinestra } from "@/lib/vuln/proposta/finestra-device";
import { removeEdgeSubnetFinestra, saveEdgeFinestraDevice } from "@/lib/vuln/edge-subnet-bridge";

type Ctx = { params: Promise<{ id: string }> };

const ORA = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ora non valida (HH:MM)");
const Corpo = z
  .object({
    modo: z.enum(["orario", "finestra"]).default("orario"),
    famiglie: z.array(z.enum(FAMIGLIE_PIANIFICABILI)).min(1, "Scegli almeno un gruppo"),
    frequenza: z.enum(["giornaliera", "settimanale", "mensile"]).default("settimanale"),
    giorno: z.number().int().nullable().default(null),
    ora: ORA.default("02:00"),
    giorni: z.array(z.number().int().min(0).max(6)).optional(),
    dalle: ORA.optional(),
    alle: ORA.optional(),
    sostituisci: z.boolean().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.modo === "finestra") {
      if (!c.giorni?.length) ctx.addIssue({ code: "custom", message: "Scegli almeno un giorno della finestra" });
      if (!c.dalle || !c.alle) ctx.addIssue({ code: "custom", message: "Scrivi dalle e alle della finestra" });
      return;
    }
    if (c.frequenza === "settimanale" && (c.giorno === null || c.giorno < 0 || c.giorno > 6)) ctx.addIssue({ code: "custom", message: "Scegli il giorno della settimana" });
    if (c.frequenza === "mensile" && (c.giorno === null || c.giorno < 1 || c.giorno > 28)) ctx.addIssue({ code: "custom", message: "Il giorno del mese va da 1 a 28" });
  });

function rete(id: string): number | null {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 && getNetworkById(n) ? n : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const check = await requireAuth();
  if (isAuthError(check)) return check;
  return withTenantFromSession(async () => {
    const n = rete((await params).id);
    if (n === null) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    return NextResponse.json({ pianificazione: leggiPianificazione(n), un_profilo: pianificazioneUnProfilo(n) });
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  const check = await requireAdmin();
  if (isAuthError(check)) return check;
  return withTenantFromSession(async () => {
    const n = rete((await params).id);
    if (n === null) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    let grezzo: unknown;
    try {
      grezzo = await req.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }
    const parsed = Corpo.safeParse(grezzo);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    const c = parsed.data;
    const vecchia = pianificazioneUnProfilo(n);
    if (vecchia && !c.sostituisci) {
      return NextResponse.json({ error: "La rete ha già una pianificazione «Un profilo solo»", un_profilo: vecchia }, { status: 409 });
    }
    if (vecchia) {
      const tolta = await togliUnProfilo(n);
      if (!tolta.ok) return NextResponse.json({ error: `Pianificazione «Un profilo solo» non spenta: ${tolta.error}. Nessuna modifica salvata.` }, { status: 502 });
    }
    const chi = check.user?.name ?? check.user?.email ?? "amministratore";
    const prima = leggiPianificazione(n);
    if (c.modo === "finestra") {
      const gruppi = gruppiFinestra(n, c.famiglie);
      if (gruppi.length === 0) return NextResponse.json({ error: "Nessun device incluso nei gruppi scelti: la finestra non avrebbe niente da fare" }, { status: 400 });
      const fascia = { giorni: [...new Set(c.giorni!)], dalle: c.dalle!, alle: c.alle! };
      const r = await saveEdgeFinestraDevice(n, fascia, gruppi);
      if (!r.ok) return NextResponse.json({ error: r.error, daAggiornare: r.daAggiornare }, { status: r.status });
      const p = salvaFinestraDevice({ network_id: n, famiglie: c.famiglie, chi, fascia, firma: firmaGruppi(gruppi) });
      return NextResponse.json({ pianificazione: p, un_profilo: null, spenta: vecchia, avviso: r.avviso ?? null });
    }
    // Da finestra a orario: la finestra va tolta dalla sonda, o due pianificazioni lavorerebbero sulla stessa rete.
    if (prima?.modo === "finestra" && prima.attiva) {
      const tolta = await removeEdgeSubnetFinestra(n);
      if (!tolta.ok) return NextResponse.json({ error: `Finestra non tolta dalla sonda: ${tolta.error}. Nessuna modifica salvata.` }, { status: 502 });
    }
    const giorno = c.frequenza === "giornaliera" ? null : c.giorno;
    const p = salvaPianificazione({ network_id: n, famiglie: c.famiglie, frequenza: c.frequenza, giorno, ora: c.ora, chi });
    return NextResponse.json({ pianificazione: p, un_profilo: null, spenta: vecchia });
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const check = await requireAdmin();
  if (isAuthError(check)) return check;
  return withTenantFromSession(async () => {
    const n = rete((await params).id);
    if (n === null) return NextResponse.json({ error: "Rete non trovata" }, { status: 404 });
    const p = leggiPianificazione(n);
    if (p?.modo === "finestra" && p.attiva) {
      const tolta = await removeEdgeSubnetFinestra(n);
      if (!tolta.ok) return NextResponse.json({ error: `Finestra non tolta dalla sonda: ${tolta.error}` }, { status: 502 });
    }
    spegniPianificazione(n);
    return NextResponse.json({ pianificazione: leggiPianificazione(n) });
  });
}

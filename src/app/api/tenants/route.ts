import { NextResponse } from "next/server";
import { getTenants, createTenant, getUserTenantAccess } from "@/lib/db-hub";
import { requireAuth, requireSuperAdmin, isAuthError } from "@/lib/api-auth";
import { z } from "zod";
import { profiloSenzaSegreti } from "@/lib/accesso/profilo-pubblico";
import { profilo } from "@/lib/profilo";
import { preparaProfilo, regolaCreazioneProfilo } from "@/lib/profili/nuovo-profilo";

const TenantCreateSchema = z.object({
  codice_cliente: z.string().min(1, "Codice cliente obbligatorio"),
  ragione_sociale: z.string().min(1, "Ragione sociale obbligatoria"),
  indirizzo: z.string().optional(),
  citta: z.string().optional(),
  provincia: z.string().optional(),
  cap: z.string().optional(),
  telefono: z.string().optional(),
  email: z.string().optional(),
  piva: z.string().optional(),
  cf: z.string().optional(),
  referente: z.string().optional(),
  note: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireAuth();
    if (isAuthError(session)) return session;

    const role = session.user.role;

    // Superadmin vede tutti i tenant
    if (role === "admin" || role === "superadmin") {
      const tenants = getTenants();
      return NextResponse.json(tenants.map(profiloSenzaSegreti));
    }

    // Utente normale: solo tenant a cui ha accesso
    // Ricava userId dal nome utente nella sessione
    const { getUserByUsername } = await import("@/lib/db-hub");
    const user = getUserByUsername(session.user.name || "");
    if (!user) {
      return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
    }
    const access = getUserTenantAccess(user.id);
    return NextResponse.json(access);
  } catch (error) {
    console.error("Errore nel recupero dei tenant:", error);
    return NextResponse.json({ error: "Errore nel recupero dei clienti" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireSuperAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    // Verifica ruolo superadmin (solo superadmin puo' creare tenant)
    if (adminCheck.user.role !== "admin" && adminCheck.user.role !== "superadmin") {
      return NextResponse.json({ error: "Accesso riservato agli amministratori" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const parsed = TenantCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    // Installazione «tecnico» (ADR 0037): il codice è il codcli e il profilo è pronto subito.
    // Sulle altre installazioni la regola risponde «crea come oggi, senza preparare» (D1, 08/11).
    const regola = regolaCreazioneProfilo(profilo(), parsed.data.codice_cliente);
    if (!regola.ok) {
      return NextResponse.json({ error: regola.errore }, { status: 400 });
    }
    const codice = regola.prepara ? parsed.data.codice_cliente.trim() : parsed.data.codice_cliente;

    const tenant = createTenant({
      ...parsed.data,
      codice_cliente: codice,
      indirizzo: parsed.data.indirizzo ?? null,
      citta: parsed.data.citta ?? null,
      provincia: parsed.data.provincia ?? null,
      cap: parsed.data.cap ?? null,
      telefono: parsed.data.telefono ?? null,
      email: parsed.data.email ?? null,
      piva: parsed.data.piva ?? null,
      cf: parsed.data.cf ?? null,
      referente: parsed.data.referente ?? null,
      note: parsed.data.note ?? null,
      active: 1,
    });

    if (regola.prepara) {
      try {
        const preparazione = preparaProfilo(codice);
        return NextResponse.json({ ...profiloSenzaSegreti(tenant), preparazione }, { status: 201 });
      } catch (e) {
        // Il profilo c'è: lo dice, insieme al perché non è pronto (al riavvio l'avvio lo prepara comunque).
        console.error(`[Profili] ${codice}: preparazione fallita:`, e instanceof Error ? e.message : e);
        return NextResponse.json(
          { ...profiloSenzaSegreti(tenant), avviso: "Profilo creato, ma i job di serie partiranno solo al prossimo riavvio del servizio." },
          { status: 201 },
        );
      }
    }

    return NextResponse.json(profiloSenzaSegreti(tenant), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "Codice cliente già esistente" }, { status: 409 });
    }
    console.error("Errore nella creazione del tenant:", error);
    return NextResponse.json({ error: "Errore nella creazione del cliente" }, { status: 500 });
  }
}

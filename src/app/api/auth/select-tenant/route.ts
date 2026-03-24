import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserByUsername, getUserTenantAccess, getTenantByCode } from "@/lib/db-hub";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
    }

    const { tenantCode } = body as { tenantCode?: string };
    if (!tenantCode || typeof tenantCode !== "string") {
      return NextResponse.json({ error: "Codice cliente obbligatorio" }, { status: 400 });
    }

    const role = (session.user as Record<string, unknown>).role as string;

    // __ALL__: vista aggregata per superadmin
    if (tenantCode === "__ALL__") {
      if (role !== "superadmin") {
        return NextResponse.json({ error: "Solo superadmin può vedere tutti i clienti" }, { status: 403 });
      }
      return NextResponse.json({ success: true, tenantCode: "__ALL__", ragione_sociale: "Tutti i clienti" });
    }

    // Verifica che il tenant esista
    const tenant = getTenantByCode(tenantCode);
    if (!tenant) {
      return NextResponse.json({ error: "Cliente non trovato" }, { status: 404 });
    }

    // Superadmin ha accesso a tutti i tenant
    if (role === "superadmin" || role === "admin") {
      return NextResponse.json({ success: true, tenantCode, ragione_sociale: tenant.ragione_sociale });
    }

    // Utente normale: verifica accesso
    const user = getUserByUsername(session.user.name || "");
    if (!user) {
      return NextResponse.json({ error: "Utente non trovato" }, { status: 404 });
    }

    const access = getUserTenantAccess(user.id);
    const hasAccess = access.some((a) => a.codice_cliente === tenantCode);
    if (!hasAccess) {
      return NextResponse.json({ error: "Accesso non autorizzato a questo cliente" }, { status: 403 });
    }

    return NextResponse.json({ success: true, tenantCode, ragione_sociale: tenant.ragione_sociale });
  } catch (error) {
    console.error("Errore nella selezione del tenant:", error);
    return NextResponse.json({ error: "Errore nella selezione del cliente" }, { status: 500 });
  }
}

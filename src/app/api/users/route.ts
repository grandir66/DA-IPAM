import { NextResponse } from "next/server";
import { getUsers, getUserByUsername, createUser, getUserTenantAccess, setUserTenantAccess, getActiveTenants } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import bcrypt from "bcrypt";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET() {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const users = getUsers();
    const tenants = getActiveTenants();
    const tenantMap = new Map(tenants.map(t => [t.id, t]));

    // Arricchisci ogni utente con i tenant assegnati
    const enriched = users.map(user => {
      const access = getUserTenantAccess(user.id);
      const tenant_access = access.map(a => ({
        tenant_id: a.tenant_id,
        codice_cliente: tenantMap.get(a.tenant_id)?.codice_cliente ?? "",
        ragione_sociale: tenantMap.get(a.tenant_id)?.ragione_sociale ?? "",
        role: a.role,
      }));
      return { ...user, tenant_access };
    });

    return NextResponse.json(enriched, { headers: NO_CACHE_HEADERS });
  } catch (error) {
    console.error("Errore caricamento utenti:", error);
    return NextResponse.json(
      { error: "Errore nel caricamento degli utenti" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const body = await request.json();
    const { username, password, role, email, tenant_ids } = body as {
      username?: string;
      password?: string;
      role?: string;
      email?: string | null;
      tenant_ids?: number[];
    };

    if (!username || !password) {
      return NextResponse.json(
        { error: "Username e password sono obbligatori" },
        { status: 400 }
      );
    }

    if (username.length < 3 || username.length > 50) {
      return NextResponse.json(
        { error: "Lo username deve avere tra 3 e 50 caratteri" },
        { status: 400 }
      );
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      return NextResponse.json(
        { error: "Lo username può contenere solo lettere, numeri, punti, trattini e underscore" },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "La password deve avere almeno 8 caratteri" },
        { status: 400 }
      );
    }

    if (role && role !== "superadmin" && role !== "admin" && role !== "viewer") {
      return NextResponse.json(
        { error: "Il ruolo deve essere 'superadmin', 'admin' o 'viewer'" },
        { status: 400 }
      );
    }

    const validRole = (role === "superadmin" || role === "admin" || role === "viewer") ? role : "viewer";

    // Admin e viewer devono avere almeno un tenant assegnato
    if (validRole !== "superadmin" && (!tenant_ids || tenant_ids.length === 0)) {
      return NextResponse.json(
        { error: "Seleziona almeno un cliente per questo ruolo" },
        { status: 400 }
      );
    }

    // Verifica che lo username non sia già in uso
    const existing = getUserByUsername(username);
    if (existing) {
      return NextResponse.json(
        { error: "Username già in uso" },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = createUser(username, passwordHash, validRole as "superadmin" | "admin" | "viewer", undefined, email);

    // Assegna tenant se admin o viewer
    if (validRole !== "superadmin" && tenant_ids && tenant_ids.length > 0) {
      for (const tid of tenant_ids) {
        setUserTenantAccess(user.id, tid, validRole);
      }
    }

    // Restituisci utente senza password_hash
    const { password_hash: _, ...safeUser } = user;
    return NextResponse.json(safeUser, { status: 201 });
  } catch (error) {
    console.error("Errore creazione utente:", error);
    return NextResponse.json(
      { error: "Errore nella creazione dell'utente" },
      { status: 500 }
    );
  }
}

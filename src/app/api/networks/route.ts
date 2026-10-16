import { NextResponse } from "next/server";
import { getNetworks, getNetworksPaginated } from "@/lib/db";
import { NetworkCreateSchema } from "@/lib/validators";
import { creaRete, CredenzialiReteNonValide } from "@/lib/networks/salva-rete";
import { requireAdminOrOnboarding, isAuthError } from "@/lib/api-auth";
import { getTenantMode, withTenantFromSession } from "@/lib/api-tenant";
import { queryAllTenants } from "@/lib/db-tenant";

export async function GET(request: Request) {
  const mode = await getTenantMode();
  if (mode.mode === "unauthenticated") {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  if (mode.mode === "all") {
    try {
      const allNetworks = queryAllTenants(() => {
        return getNetworks() as unknown as Record<string, unknown>[];
      });
      return NextResponse.json(allNetworks);
    } catch (error) {
      console.error("Error fetching networks (all tenants):", error);
      return NextResponse.json({ error: "Errore nel recupero delle reti" }, { status: 500 });
    }
  }

  return withTenantFromSession(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const pageParam = searchParams.get("page");
      const search = searchParams.get("search") || undefined;

      if (pageParam) {
        const page = Math.max(1, parseInt(pageParam, 10) || 1);
        const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get("pageSize") || "25", 10)));
        const sortBy = searchParams.get("sortBy") || undefined;
        const sortOrder = searchParams.get("sortOrder") === "desc" ? "desc" : "asc";
        const { data, total } = getNetworksPaginated(page, pageSize, search, {
          key: sortBy,
          dir: sortOrder,
        });
        const totalPages = Math.ceil(total / pageSize);
        return NextResponse.json({ data, total, page, pageSize, totalPages });
      }

      const networks = getNetworks();
      return NextResponse.json(networks);
    } catch (error) {
      console.error("Error fetching networks:", error);
      return NextResponse.json({ error: "Errore nel recupero delle reti" }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdminOrOnboarding();
      if (isAuthError(adminCheck)) return adminCheck;
    const body = await request.json();
    const parsed = NetworkCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    // Rete, router e lista credenziali in una transazione: una voce rifiutata è
    // un 400 e la rete non nasce (prima nasceva lo stesso). I campi delle catene
    // vecchie si controllano prima e si accodano alla lista, con `avvisi` (T17).
    let network;
    try {
      network = creaRete(parsed.data);
    } catch (e) {
      if (e instanceof CredenzialiReteNonValide) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    return NextResponse.json(network, { status: 201 });
    } catch (error) {
      if (error instanceof Error && (error.message.includes("UNIQUE") || error.message.includes("sovrappone"))) {
        return NextResponse.json({ error: error.message.includes("sovrappone") ? error.message : "Rete già esistente con questo CIDR" }, { status: 409 });
      }
      console.error("Error creating network:", error);
      return NextResponse.json({ error: "Errore nella creazione della rete" }, { status: 500 });
    }
  });
}

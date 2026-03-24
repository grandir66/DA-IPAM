import { NextResponse } from "next/server";
import { getLocations, createLocation } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

export async function GET() {
  return withTenantFromSession(async () => {
    try {
      const authCheck = await requireAdmin();
      if (isAuthError(authCheck)) return authCheck;
      const locations = getLocations();
      return NextResponse.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      return NextResponse.json({ error: "Errore nel recupero delle ubicazioni" }, { status: 500 });
    }
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
      const body = await request.json();
      const { name, parent_id, address } = body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "Nome richiesto" }, { status: 400 });
      }
      const location = createLocation({
        name: name.trim(),
        parent_id: parent_id ?? null,
        address: address?.trim() || null,
      });
      return NextResponse.json(location);
    } catch (error) {
      console.error("Error creating location:", error);
      return NextResponse.json({ error: "Errore nella creazione dell'ubicazione" }, { status: 500 });
    }
  });
}

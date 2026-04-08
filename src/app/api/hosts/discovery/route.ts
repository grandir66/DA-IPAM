import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAllHostsEnriched } from "@/lib/db-tenant";

export async function GET() {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    try {
      const hosts = getAllHostsEnriched(10000);
      return NextResponse.json(hosts);
    } catch (error) {
      console.error("Error fetching discovery hosts:", error);
      return NextResponse.json(
        { error: "Errore nel recupero degli host" },
        { status: 500 }
      );
    }
  });
}

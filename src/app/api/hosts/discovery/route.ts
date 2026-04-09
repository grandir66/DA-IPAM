import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAllHostsEnriched, getAllHostValidatedProtocols, getAllMultihomedLinks } from "@/lib/db-tenant";

export async function GET() {
  const session = await requireAuth();
  if (isAuthError(session)) return session;

  return withTenantFromSession(async () => {
    try {
      const hosts = getAllHostsEnriched(10000);
      const credMap = getAllHostValidatedProtocols();
      const mhMap = getAllMultihomedLinks();

      const enriched = hosts.map((h) => ({
        ...h,
        validated_protocols: credMap.get(h.id) || [],
        multihomed: mhMap.get(h.id) ?? null,
      }));

      return NextResponse.json(enriched);
    } catch (error) {
      console.error("Error fetching discovery hosts:", error);
      return NextResponse.json(
        { error: "Errore nel recupero degli host" },
        { status: 500 }
      );
    }
  });
}

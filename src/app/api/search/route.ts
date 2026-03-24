import { NextRequest, NextResponse } from "next/server";
import { globalSearch } from "@/lib/db";
import { getTenantMode, withTenantFromSession } from "@/lib/api-tenant";
import { queryAllTenants } from "@/lib/db-tenant";

export async function GET(request: NextRequest) {
  const mode = await getTenantMode();
  if (mode.mode === "unauthenticated") {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  if (mode.mode === "all") {
    const q = request.nextUrl.searchParams.get("q") || "";
    if (q.length < 2) {
      return NextResponse.json({ hosts: [], networks: [] });
    }
    try {
      const allResults = queryAllTenants(() => {
        const results = globalSearch(q);
        // Flatten hosts and networks into a single array with a _type marker
        const items: Record<string, unknown>[] = [];
        for (const h of results.hosts) {
          items.push({ ...h, _resultType: "host" } as unknown as Record<string, unknown>);
        }
        for (const n of results.networks) {
          items.push({ ...n, _resultType: "network" } as unknown as Record<string, unknown>);
        }
        return items;
      });
      // Re-split into hosts and networks
      const hosts = allResults.filter((r) => r._resultType === "host");
      const networks = allResults.filter((r) => r._resultType === "network");
      return NextResponse.json({ hosts, networks });
    } catch (error) {
      console.error("Error in global search (all tenants):", error);
      return NextResponse.json({ hosts: [], networks: [] });
    }
  }

  return withTenantFromSession(async () => {
    const q = request.nextUrl.searchParams.get("q") || "";
    if (q.length < 2) {
      return NextResponse.json({ hosts: [], networks: [] });
    }
    const results = globalSearch(q);
    return NextResponse.json(results);
  });
}

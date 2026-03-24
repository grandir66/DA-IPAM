import { NextResponse } from "next/server";
import { getNetworksWithCredentials } from "@/lib/db";
import { withTenantFromSession } from "@/lib/api-tenant";

/** GET — subnet che hanno almeno una credenziale configurata (per UI "importa da altra subnet"). */
export async function GET() {
  return withTenantFromSession(async () => {
    try {
      return NextResponse.json(getNetworksWithCredentials());
    } catch (error) {
      console.error("Error fetching networks with credentials:", error);
      return NextResponse.json({ error: "Errore" }, { status: 500 });
    }
  });
}

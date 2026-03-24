import { NextResponse } from "next/server";
import { getNetworksWithCredentials } from "@/lib/db";
import { requireAuth, isAuthError } from "@/lib/api-auth";

/** GET — subnet che hanno almeno una credenziale configurata (per UI "importa da altra subnet"). */
export async function GET() {
  try {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;
    return NextResponse.json(getNetworksWithCredentials());
  } catch (error) {
    console.error("Error fetching networks with credentials:", error);
    return NextResponse.json({ error: "Errore" }, { status: 500 });
  }
}

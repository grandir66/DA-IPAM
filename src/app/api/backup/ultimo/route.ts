import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { getHubDb } from "@/lib/db-hub";
import { ultimoScarico } from "@/lib/accesso/registro-scarichi";

/** Chi ha scaricato per ultimo il database dell'istanza: lo mostra il dialogo «Backup database…». */
export async function GET() {
  const s = await requireAdmin();
  if (isAuthError(s)) return s;
  return NextResponse.json({ ultimo: ultimoScarico(getHubDb(), "hub_db") }, { headers: { "Cache-Control": "no-store" } });
}

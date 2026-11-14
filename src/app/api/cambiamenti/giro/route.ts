import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { getGiroCambiamentiSchedule, setGiroCambiamentiSchedule } from "@/lib/db-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";

/** Accende o spegne il giro notturno delle porte (una subnet per notte, col freno) e il controllo delle anomalie. */
export async function POST(req: NextRequest) {
  const session = await requireAdmin();
  if (isAuthError(session)) return session;
  return withTenantFromSession(async () => {
    let acceso: unknown;
    try {
      acceso = ((await req.json()) as { acceso?: unknown }).acceso;
    } catch {
      return NextResponse.json({ error: "Richiesta non leggibile" }, { status: 400 });
    }
    if (typeof acceso !== "boolean") return NextResponse.json({ error: "Manca «acceso»" }, { status: 400 });
    setGiroCambiamentiSchedule(acceso);
    reloadTenantScheduler(await getServerTenantCode());
    return NextResponse.json({ acceso: getGiroCambiamentiSchedule().enabled });
  });
}

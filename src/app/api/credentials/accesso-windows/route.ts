import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getAccessoWindowsPaginated } from "@/lib/db-tenant";

const QuerySchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  perPagina: z.coerce.number().int().min(1).max(200).default(50),
  voce: z.coerce.number().int().positive().optional(),
});

/**
 * «Accesso Windows per host» (piano accesso Windows, Task 9): una riga per host, una colonna per strada (WinRM e WMI), coi
 * motivi scritti dalle scansioni. Paginata dal server, una query con JOIN. Con `voce` conta solo quella voce, senza vale
 * l'esito migliore fra tutte (copertura). Solo admin (come tutto ciò che riguarda le credenziali). Sola lettura: niente login, niente scritture.
 */
export async function GET(request: Request) {
  const authCheck = await requireAdmin();
  if (isAuthError(authCheck)) return authCheck;
  return withTenantFromSession(async () => {
    const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: "Parametri non validi" }, { status: 400 });
    }
    const { pagina, perPagina, voce } = parsed.data;
    try {
      const { righe, totale } = getAccessoWindowsPaginated({ limit: perPagina, offset: (pagina - 1) * perPagina, credentialId: voce });
      return NextResponse.json({ righe, totale, pagina, perPagina });
    } catch (error) {
      console.error("Error fetching accesso Windows per host:", error);
      return NextResponse.json({ error: "Errore nel recupero dell'accesso Windows per host" }, { status: 500 });
    }
  });
}

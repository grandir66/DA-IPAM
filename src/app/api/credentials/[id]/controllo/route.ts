import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import { controlloAccountSenzaDoppioni, VoceNonWindows } from "@/lib/credentials/controllo-account";

/**
 * Controllo di cosa può fare un account Windows (piano accesso Windows, Task 8): password, gruppi del dominio letti dal DC
 * col filtro ricorsivo, esiti già scritti dalle scansioni sui PC. Solo voci di tipo Windows.
 *
 * Solo admin, e come prima cosa: il controllo fa un bind sul DC con la password della voce. Sui PC non si prova niente. Un
 * bind sbagliato a ogni clic porterebbe al blocco dell'account, per questo `controlloAccount` ricorda per 30 minuti una
 * password `errata`, qui c'è un limite di richieste per voce, e sullo stesso account gira un controllo alla volta.
 *
 * Nei log mai il nome utente né la password: si scrive solo il tipo dell'errore.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  return withTenantFromSession(async () => {
    const { id } = await params;
    const credId = Number(id);
    if (!Number.isInteger(credId) || credId <= 0) {
      return NextResponse.json({ error: "Identificativo della voce non valido" }, { status: 400 });
    }
    if (!checkRateLimit(`controllo-account:${getCurrentTenantCode() ?? "DEFAULT"}:${credId}`, 10, 60_000)) {
      return NextResponse.json({ error: "Troppi controlli ravvicinati su questa voce: riprova fra un minuto" }, { status: 429 });
    }
    try {
      return NextResponse.json(await controlloAccountSenzaDoppioni(credId));
    } catch (error) {
      if (error instanceof VoceNonWindows) return NextResponse.json({ error: error.message }, { status: 404 });
      console.error("[credentials/controllo] controllo non riuscito:", error instanceof Error ? error.name : "errore");
      return NextResponse.json({ error: "Controllo dell'account non riuscito" }, { status: 500 });
    }
  });
}

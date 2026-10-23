import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { sbloccaGuardato, statoVault } from "@/lib/vault/appliance";
import { utenteDaSessione } from "@/lib/vault/mostra";
import { ErroreVault } from "@/lib/vault/tipi";

const Corpo = z.object({ passphrase: z.string().min(1).max(1024) });

/**
 * Sblocco a mano con la passphrase del cliente (vault bloccato: niente TPM). Cinque tentativi sbagliati in 15 minuti
 * bloccano l'UTENTE (non tutti), con lo stesso contatore dell'esportazione KeePass, e le derivazioni scrypt in corso
 * hanno un tetto (`guardia-passphrase.ts`).
 */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const parsed = Corpo.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Manca la passphrase" }, { status: 400 });
    try {
      const g = await sbloccaGuardato(utenteDaSessione(s).id, parsed.data.passphrase);
      if (!g.ok) return NextResponse.json({ error: g.errore }, { status: g.stato });
    } catch (e) {
      if (e instanceof ErroreVault && e.codice === "slot_errato") {
        return NextResponse.json({ error: "Passphrase errata" }, { status: 403 });
      }
      const stato = e instanceof ErroreVault && e.codice === "configurazione" ? 404 : 409;
      return NextResponse.json({ error: e instanceof ErroreVault ? e.message : "Sblocco non riuscito" }, { status: stato });
    }
    console.info(`[vault] sbloccato a mano da ${s.user.name ?? "?"}`);
    return NextResponse.json(statoVault(), { headers: { "Cache-Control": "no-store" } });
  });
}

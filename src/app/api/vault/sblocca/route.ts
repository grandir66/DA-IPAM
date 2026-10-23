import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { clearRateLimit, isRateLimited, recordFailedAttempt } from "@/lib/rate-limit";
import { sbloccaConPassphrase, statoVault } from "@/lib/vault/appliance";
import { ErroreVault } from "@/lib/vault/tipi";

const Corpo = z.object({ passphrase: z.string().min(1).max(1024) });
const CHIAVE_TENTATIVI = "vault-sblocca";

/** Sblocco a mano con la passphrase del cliente (vault bloccato: niente TPM). Cinque tentativi sbagliati in 15 minuti bloccano. */
export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const s = await requireAdmin();
    if (isAuthError(s)) return s;
    const parsed = Corpo.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Manca la passphrase" }, { status: 400 });
    if (isRateLimited(CHIAVE_TENTATIVI, 5, 15 * 60_000)) {
      return NextResponse.json({ error: "Troppi tentativi sbagliati: riprova fra qualche minuto" }, { status: 429 });
    }
    try {
      await sbloccaConPassphrase(parsed.data.passphrase);
    } catch (e) {
      if (e instanceof ErroreVault && e.codice === "slot_errato") {
        recordFailedAttempt(CHIAVE_TENTATIVI);
        return NextResponse.json({ error: "Passphrase errata" }, { status: 403 });
      }
      const stato = e instanceof ErroreVault && e.codice === "configurazione" ? 404 : 409;
      return NextResponse.json({ error: e instanceof ErroreVault ? e.message : "Sblocco non riuscito" }, { status: stato });
    }
    clearRateLimit(CHIAVE_TENTATIVI);
    console.info(`[vault] sbloccato a mano da ${s.user.name ?? "?"}`);
    return NextResponse.json(statoVault(), { headers: { "Cache-Control": "no-store" } });
  });
}

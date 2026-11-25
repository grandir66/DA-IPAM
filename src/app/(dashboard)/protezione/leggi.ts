import { auth } from "@/lib/auth";
import { getServerTenantCode } from "@/lib/api-tenant";
import { eAdmin } from "@/lib/permessi/ruolo";
import { quadroProtezione, type QuadroProtezione } from "@/lib/protezione/raccolta";

/** Il quadro per le schede di «Protezione»; `null` = chi guarda non è amministratore (la pagina lo dice). */
export async function leggiProtezione(): Promise<QuadroProtezione | null> {
  const ruolo = ((await auth())?.user as { role?: string } | undefined)?.role;
  if (!eAdmin(ruolo)) return null;
  return quadroProtezione(await getServerTenantCode());
}

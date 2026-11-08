/**
 * GET /api/ad-setup/script-dominio — Download dello script che prepara il dominio per DA-IPAM:
 * account, gruppi e GPO WinRM (scripts/Configura-Dominio-DA-IPAM.ps1, 08/11/2026).
 */
import { readFileSync } from "node:fs";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { unisci } from "@/lib/percorsi";

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  try {
    const content = readFileSync(unisci(process.cwd(), "scripts", "Configura-Dominio-DA-IPAM.ps1"), "utf-8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Configura-Dominio-DA-IPAM.ps1"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[/api/ad-setup/script-dominio] errore lettura:", error);
    return new Response("Script non disponibile", { status: 500 });
  }
}

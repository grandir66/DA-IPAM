/**
 * GET /api/ad-setup/script-audit — Download dello script che configura l'audit dei DC per la
 * pagina «Sicurezza del dominio» (scripts/Configura-Audit-DC.ps1, 29/10/2026).
 */
import { readFileSync } from "node:fs";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { unisci } from "@/lib/percorsi";

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  try {
    const content = readFileSync(unisci(process.cwd(), "scripts", "Configura-Audit-DC.ps1"), "utf-8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Configura-Audit-DC.ps1"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[/api/ad-setup/script-audit] errore lettura:", error);
    return new Response("Script non disponibile", { status: 500 });
  }
}

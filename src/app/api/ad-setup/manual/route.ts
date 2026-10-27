/**
 * GET /api/ad-setup/manual — Download del manuale Markdown completo per
 * configurazione Active Directory (docs/MANUALE-ACTIVE-DIRECTORY.md).
 *
 * v0.2.657.
 */
import { readFileSync } from "node:fs";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { unisci } from "@/lib/percorsi";

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  try {
    const manualPath = unisci(process.cwd(), "docs", "MANUALE-ACTIVE-DIRECTORY.md");
    const content = readFileSync(manualPath, "utf-8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": 'inline; filename="MANUALE-ACTIVE-DIRECTORY.md"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[/api/ad-setup/manual] errore lettura:", error);
    return new Response("Manuale non disponibile", { status: 500 });
  }
}

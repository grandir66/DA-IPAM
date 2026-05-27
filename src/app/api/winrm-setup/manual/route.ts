/**
 * GET /api/winrm-setup/manual — Download del manuale Markdown completo per
 * configurazione WinRM (docs/MANUALE-WINRM.md).
 *
 * v0.2.656.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { requireAuth, isAuthError } from "@/lib/api-auth";

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;

  try {
    const manualPath = path.join(process.cwd(), "docs", "MANUALE-WINRM.md");
    const content = readFileSync(manualPath, "utf-8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": 'inline; filename="MANUALE-WINRM.md"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[/api/winrm-setup/manual] errore lettura:", error);
    return new Response("Manuale non disponibile", { status: 500 });
  }
}

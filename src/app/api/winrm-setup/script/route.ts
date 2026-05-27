/**
 * GET /api/winrm-setup/script — Download dello script PowerShell per
 * configurare WinRM sul server target.
 *
 * Lo script è in `scripts/Configure-WinRM-DA-IPAM.ps1` nel repo.
 * Lo serviamo via API (anziché link a /static/) per:
 *  - Mantenerlo allineato alla versione di codice deployata
 *  - Auth-gate l'accesso (solo utenti loggati possono scaricarlo)
 *  - Esporre il filename con Content-Disposition consistente
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
    const scriptPath = path.join(process.cwd(), "scripts", "Configure-WinRM-DA-IPAM.ps1");
    const content = readFileSync(scriptPath, "utf-8");
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="Configure-WinRM-DA-IPAM.ps1"',
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[/api/winrm-setup/script] errore lettura:", error);
    return new Response("Script non disponibile", { status: 500 });
  }
}

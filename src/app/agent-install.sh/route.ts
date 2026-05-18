import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Serve l'installer dell'agent (`agent/scripts/install.sh`) al volo.
 *
 * Pensato per essere consumato come `curl -fsSL <hub>/agent-install.sh | bash`
 * con le variabili d'ambiente passate dal lato chiamante (TENANT_CODE,
 * HUB_URL, AGENT_TOKEN, AGENT_PORT). Vedi l'header dello script per le
 * istruzioni complete.
 *
 * Route pubblica: lo script di per sé non contiene segreti, e il chiamante
 * fornisce comunque il token plaintext via env nel proprio shell.
 */
export async function GET() {
  try {
    const scriptPath = path.join(process.cwd(), "agent", "scripts", "install.sh");
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { error: "agent/scripts/install.sh non disponibile in questa installazione hub." },
        { status: 404 },
      );
    }
    const body = fs.readFileSync(scriptPath, "utf-8");
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/x-shellscript; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Disposition": 'inline; filename="install.sh"',
      },
    });
  } catch (e) {
    console.error("Errore serving install.sh:", e);
    return NextResponse.json({ error: "Errore nel servire lo script" }, { status: 500 });
  }
}

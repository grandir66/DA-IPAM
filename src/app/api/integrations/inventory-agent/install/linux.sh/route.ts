import { NextResponse } from "next/server";
import { buildLinuxInstallScript } from "@/lib/inventory-agent/install-scripts";

/** Template Linux — token via env (curl | sudo INGEST_TOKEN=... bash). */
export async function GET() {
  const body = buildLinuxInstallScript();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Disposition": 'inline; filename="domarc-inventory-agent-install.sh"',
    },
  });
}

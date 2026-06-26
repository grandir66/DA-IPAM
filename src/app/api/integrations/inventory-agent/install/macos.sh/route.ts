import { NextResponse } from "next/server";
import { buildMacosInstallScript } from "@/lib/inventory-agent/install-scripts";

/** Template macOS — token via env. */
export async function GET() {
  const body = buildMacosInstallScript();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Disposition": 'inline; filename="domarc-inventory-agent-install-macos.sh"',
    },
  });
}

import { NextResponse } from "next/server";
import { buildWindowsInstallScript } from "@/lib/inventory-agent/install-scripts";

/** Template Windows — token via $env:INGEST_TOKEN (irm | iex). */
export async function GET() {
  const body = buildWindowsInstallScript();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Disposition": 'inline; filename="domarc-inventory-agent-install.ps1"',
    },
  });
}

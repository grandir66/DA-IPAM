import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import {
  probeBridge,
  probeBridgeWithAuth,
} from "@/lib/network-services/client";

const ProbeSchema = z.object({
  apiUrl: z.string().url(),
  apiToken: z.string().optional(),
});

/**
 * POST — probe della raggiungibilità del bridge (per setup wizard).
 *
 * Fa 2 chiamate:
 *   1. GET /api/v1/health (no auth) — verifica raggiungibilità + versione
 *   2. GET /api/v1/status (Bearer) — verifica token valido
 *
 * Restituisce ok=true solo se entrambe passano. Non installa nulla.
 */
export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ProbeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  // Step 1: bridge reachable?
  const healthResult = await probeBridge(parsed.data.apiUrl);
  if (!healthResult.ok) {
    return NextResponse.json({
      ok: false,
      stage: "health",
      error: healthResult.error,
    });
  }

  // Step 2: token valido?
  if (!parsed.data.apiToken) {
    return NextResponse.json({
      ok: true,
      stage: "health",
      version: healthResult.version,
      message: "Bridge raggiungibile. Token mancante: skip auth check.",
    });
  }

  const authResult = await probeBridgeWithAuth(parsed.data.apiUrl, parsed.data.apiToken);
  if (!authResult.ok) {
    return NextResponse.json({
      ok: false,
      stage: "auth",
      version: healthResult.version,
      error: authResult.error,
    });
  }

  return NextResponse.json({
    ok: true,
    stage: "auth",
    version: healthResult.version,
    message: "Bridge raggiungibile e token valido",
  });
}

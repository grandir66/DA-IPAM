import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { syncFromLegacySettings, logCredentialEvent } from "@/lib/credentials-vault";

/**
 * One-shot migration: importa le credenziali esistenti dalle
 * settings.integration_* nel vault cifrato. Idempotente.
 */
export async function POST() {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;
  const result = syncFromLegacySettings();
  logCredentialEvent({
    credentialId: null,
    action: "create",
    actorUsername: session.user.name ?? null,
    result: `synced ${result.created} (skipped ${result.skipped})`,
    details: result,
  });
  return NextResponse.json(result);
}

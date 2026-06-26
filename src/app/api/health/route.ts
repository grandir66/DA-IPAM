import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { probeEncryptionKeyHealth } from "@/lib/encryption-key-health";
import { getDeployModeLabel } from "@/lib/env-secrets";

const startTime = Date.now();

export async function GET() {
  try {
    // Verifica accesso DB con query minimale
    const dbCheck = getDb().prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
    const dbOk = dbCheck?.ok === 1;
    const encryption = probeEncryptionKeyHealth();
    const secretsOk = encryption.ok;
    const overallOk = dbOk && secretsOk;

    // Leggi versione da package.json (cached a startup)
    const pkg = await import("../../../../package.json");

    return NextResponse.json({
      status: overallOk ? "ok" : "degraded",
      deploy_mode: getDeployModeLabel(),
      version: pkg.version,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      db: dbOk ? "ok" : "error",
      encryption_key: {
        configured: encryption.configured,
        credentials_decryptable: encryption.credentialCount === 0 ? null : encryption.ok,
        fingerprint: encryption.fingerprint,
        credential_count: encryption.credentialCount,
        detail: encryption.detail,
      },
      timestamp: new Date().toISOString(),
    }, { status: overallOk ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      db: "unreachable",
      error: error instanceof Error ? error.message : "Errore sconosciuto",
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}

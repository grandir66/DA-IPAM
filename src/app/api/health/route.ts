import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

const startTime = Date.now();

export async function GET() {
  try {
    // Verifica accesso DB con query minimale
    const dbCheck = getDb().prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
    const dbOk = dbCheck?.ok === 1;

    // Leggi versione da package.json (cached a startup)
    const pkg = await import("../../../../package.json");

    return NextResponse.json({
      status: dbOk ? "ok" : "degraded",
      version: pkg.version,
      uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
      db: dbOk ? "ok" : "error",
      timestamp: new Date().toISOString(),
    }, { status: dbOk ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({
      status: "error",
      db: "unreachable",
      error: error instanceof Error ? error.message : "Errore sconosciuto",
      timestamp: new Date().toISOString(),
    }, { status: 503 });
  }
}

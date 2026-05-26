/**
 * GET /api/physical-devices/audit
 *
 * Diagnostica post-migration F4 (host_id) + F1 (hosts.inferred_*).
 * Usato per verificare in produzione che il backfill sia andato a buon fine
 * e per identificare i record che non sono stati linkati automaticamente.
 *
 * Risposta:
 *   {
 *     network_devices: { total, linked, unlinked, sample: [{id, host}] },
 *     hosts: { total, classified, unclassified, manual_classified, sample: [{id, ip}] }
 *   }
 */

import { NextResponse } from "next/server";
import { requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { getDb } from "@/lib/db";

const NO_CACHE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

export async function GET() {
  return withTenantFromSession(async () => {
    const authCheck = await requireAuth();
    if (isAuthError(authCheck)) return authCheck;

    const db = getDb();

    // F4: status network_devices.host_id
    const ndTotal = (db.prepare("SELECT COUNT(*) AS n FROM network_devices").get() as { n: number }).n;
    const ndLinked = (db.prepare("SELECT COUNT(*) AS n FROM network_devices WHERE host_id IS NOT NULL").get() as { n: number }).n;
    const ndUnlinked = ndTotal - ndLinked;
    const ndSample = db.prepare(
      "SELECT id, name, host, vendor, protocol FROM network_devices WHERE host_id IS NULL ORDER BY id LIMIT 20"
    ).all() as Array<{ id: number; name: string; host: string; vendor: string; protocol: string }>;

    // F1: status hosts.inferred_at (auto-classify backfill)
    const hTotal = (db.prepare("SELECT COUNT(*) AS n FROM hosts").get() as { n: number }).n;
    const hClassified = (db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE inferred_at IS NOT NULL").get() as { n: number }).n;
    const hUnclassified = hTotal - hClassified;
    const hManualClassified = (db.prepare("SELECT COUNT(*) AS n FROM hosts WHERE classification_manual = 1").get() as { n: number }).n;
    const hSample = db.prepare(
      "SELECT id, ip, hostname FROM hosts WHERE inferred_at IS NULL ORDER BY id LIMIT 20"
    ).all() as Array<{ id: number; ip: string; hostname: string | null }>;

    // Confidence distribution (utile per capire la qualità del classifier)
    const hConfidenceBuckets = db.prepare(`
      SELECT
        SUM(CASE WHEN inferred_confidence >= 80 THEN 1 ELSE 0 END) AS high,
        SUM(CASE WHEN inferred_confidence >= 50 AND inferred_confidence < 80 THEN 1 ELSE 0 END) AS medium,
        SUM(CASE WHEN inferred_confidence > 0 AND inferred_confidence < 50 THEN 1 ELSE 0 END) AS low,
        SUM(CASE WHEN inferred_confidence = 0 OR inferred_confidence IS NULL THEN 1 ELSE 0 END) AS zero
      FROM hosts WHERE inferred_at IS NOT NULL
    `).get() as { high: number; medium: number; low: number; zero: number };

    return NextResponse.json({
      network_devices: {
        total: ndTotal,
        linked: ndLinked,
        unlinked: ndUnlinked,
        backfill_pct: ndTotal > 0 ? Math.round((ndLinked / ndTotal) * 100) : 100,
        sample_unlinked: ndSample,
      },
      hosts: {
        total: hTotal,
        classified: hClassified,
        unclassified: hUnclassified,
        manual_classified: hManualClassified,
        classify_pct: hTotal > 0 ? Math.round((hClassified / hTotal) * 100) : 100,
        confidence_distribution: hConfidenceBuckets,
        sample_unclassified: hSample,
      },
    }, { headers: NO_CACHE_HEADERS });
  });
}

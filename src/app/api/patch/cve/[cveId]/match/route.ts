/**
 * POST /api/patch/cve/[cveId]/match
 *
 * Pin manuale di un CVE su un fix conosciuto.
 * UPSERT in `patch_cve_target` con match_strategy='manual', confidence=1.0.
 *
 * Body: { softwareId: number, chocoId: string, fixVersion?: string }
 *
 * Solo admin. Il pin manuale ha precedenza nei matching strategy ordering.
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";

interface MatchBody {
  softwareId?: unknown;
  chocoId?: unknown;
  fixVersion?: unknown;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ cveId: string }> }
) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    const { cveId } = await params;
    if (!cveId) {
      return NextResponse.json({ error: "cveId mancante" }, { status: 400 });
    }

    let body: MatchBody;
    try {
      body = (await request.json()) as MatchBody;
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const softwareId = Number(body.softwareId);
    const chocoId = typeof body.chocoId === "string" ? body.chocoId.trim() : "";
    const fixVersion =
      typeof body.fixVersion === "string" && body.fixVersion.trim().length > 0
        ? body.fixVersion.trim()
        : null;

    if (!Number.isFinite(softwareId) || softwareId <= 0) {
      return NextResponse.json(
        { error: "softwareId mancante o non valido" },
        { status: 400 }
      );
    }
    if (!chocoId) {
      return NextResponse.json(
        { error: "chocoId mancante" },
        { status: 400 }
      );
    }

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }
    const db = getTenantDb(tenantCode);

    try {
      // Verifica esistenza software_inventory.id
      const softwareRow = db
        .prepare("SELECT id FROM software_inventory WHERE id = ?")
        .get(softwareId) as { id: number } | undefined;
      if (!softwareRow) {
        return NextResponse.json(
          { error: "softwareId non esiste in software_inventory" },
          { status: 404 }
        );
      }

      db.prepare(
        `INSERT INTO patch_cve_target
           (cve_id, software_id, match_strategy, confidence,
            fix_package_manager, fix_package_id, fix_version)
         VALUES (?, ?, 'manual', 1.0, 'choco', ?, ?)
         ON CONFLICT(cve_id, software_id) DO UPDATE SET
           match_strategy = 'manual',
           confidence = 1.0,
           fix_package_manager = 'choco',
           fix_package_id = excluded.fix_package_id,
           fix_version = excluded.fix_version`
      ).run(cveId, softwareId, chocoId, fixVersion);

      // UPSERT shadow patch_software_meta se non esiste già
      db.prepare(
        `INSERT INTO patch_software_meta
           (software_id, choco_id, match_strategy, match_confidence, last_matched_at)
         VALUES (?, ?, 'manual', 1.0, datetime('now'))
         ON CONFLICT(software_id) DO UPDATE SET
           choco_id = excluded.choco_id,
           match_strategy = 'manual',
           match_confidence = 1.0,
           last_matched_at = datetime('now')`
      ).run(softwareId, chocoId);

      return NextResponse.json({
        cveId,
        softwareId,
        chocoId,
        fixVersion,
        matchStrategy: "manual",
        confidence: 1.0,
      });
    } catch (error) {
      console.error("[patch/cve/:id/match POST] errore:", error);
      return NextResponse.json(
        { error: "Errore nel salvataggio del match" },
        { status: 500 }
      );
    }
  });
}

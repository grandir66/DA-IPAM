/**
 * /api/patch/operations
 *
 * POST: avvia una nuova operation (upgrade/install/uninstall/rollback)
 *       fire-and-forget. Ritorna { operationId } immediatamente.
 *       Body: { hostId, cveId?, action: 'upgrade'|'install'|'uninstall'|'rollback',
 *               packageId, version? }
 *
 * GET: history paginata, filtri ?hostId=&cveId=&userId=&status=&limit=&offset=
 *      Ritorna { items, limit, offset, total? }.
 *
 * NOTA F4 base: per ora solo `action='upgrade'` chiama l'executor. Install/
 * uninstall/rollback verranno implementati in PR3 (vedi BACKLOG).
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { patchModuleGuard, userIdFromSession } from "@/lib/patch/route-guard";
import { executeUpgrade } from "@/lib/patch/executor";
import { mapOperationRow, type PatchOperationDbRow } from "@/lib/patch/types";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const ALLOWED_ACTIONS = new Set([
  "upgrade",
  "install",
  "uninstall",
  "rollback",
]);

const ALLOWED_STATUS = new Set([
  "queued",
  "running",
  "success",
  "failed",
  "reboot_pending",
  "cancelled",
]);

interface UpgradeBody {
  hostId?: unknown;
  cveId?: unknown;
  action?: unknown;
  packageId?: unknown;
  version?: unknown;
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;

    let body: UpgradeBody;
    try {
      body = (await request.json()) as UpgradeBody;
    } catch {
      return NextResponse.json({ error: "Body JSON non valido" }, { status: 400 });
    }

    const hostId = Number(body.hostId);
    const action = typeof body.action === "string" ? body.action : "";
    const packageId = typeof body.packageId === "string" ? body.packageId.trim() : "";
    const version =
      typeof body.version === "string" && body.version.trim().length > 0
        ? body.version.trim()
        : null;
    const cveId =
      typeof body.cveId === "string" && body.cveId.trim().length > 0
        ? body.cveId.trim()
        : null;

    if (!Number.isFinite(hostId) || hostId <= 0) {
      return NextResponse.json(
        { error: "hostId mancante o non valido" },
        { status: 400 }
      );
    }
    if (!ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: `action invalida (consentite: ${[...ALLOWED_ACTIONS].join(",")})` },
        { status: 400 }
      );
    }
    if (!packageId) {
      return NextResponse.json(
        { error: "packageId mancante" },
        { status: 400 }
      );
    }
    if (action !== "upgrade") {
      // F4 base: solo upgrade implementato lato executor.
      return NextResponse.json(
        { error: `action='${action}' non ancora implementata (solo 'upgrade' in F4)` },
        { status: 501 }
      );
    }

    const userId = userIdFromSession(adminCheck);
    if (userId === null) {
      return NextResponse.json(
        { error: "Sessione senza userId numerico" },
        { status: 500 }
      );
    }

    try {
      // Fire-and-forget: executeUpgrade ritorna subito con operationId
      const { operationId } = executeUpgrade({
        hostId,
        userId,
        cveId,
        packageId,
        version,
      });
      return NextResponse.json({ operationId }, { status: 202 });
    } catch (error) {
      console.error("[patch/operations POST] errore avvio upgrade:", error);
      return NextResponse.json(
        { error: "Errore nell'avvio dell'operazione" },
        { status: 500 }
      );
    }
  });
}

export async function GET(request: Request) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const { searchParams } = new URL(request.url);
    const hostIdRaw = searchParams.get("hostId");
    const cveId = searchParams.get("cveId");
    const userIdRaw = searchParams.get("userId");
    const status = searchParams.get("status");
    const rawLimit = Number(searchParams.get("limit") ?? 50);
    const limit = Math.min(
      Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 50,
      200
    );
    const rawOffset = Number(searchParams.get("offset") ?? 0);
    const offset =
      Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const tenantCode = getCurrentTenantCode();
    if (!tenantCode) {
      return NextResponse.json(
        { error: "Tenant context non disponibile" },
        { status: 500 }
      );
    }
    const db = getTenantDb(tenantCode);

    const where: string[] = [];
    const params: unknown[] = [];

    if (hostIdRaw) {
      const hostId = Number(hostIdRaw);
      if (Number.isFinite(hostId) && hostId > 0) {
        where.push("host_id = ?");
        params.push(hostId);
      }
    }
    if (cveId) {
      where.push("cve_id = ?");
      params.push(cveId);
    }
    if (userIdRaw) {
      const userId = Number(userIdRaw);
      if (Number.isFinite(userId) && userId > 0) {
        where.push("user_id = ?");
        params.push(userId);
      }
    }
    if (status && ALLOWED_STATUS.has(status)) {
      where.push("status = ?");
      params.push(status);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    try {
      const rows = db
        .prepare(
          `SELECT id, host_id, user_id, cve_id, package_manager,
                  package_id, package_version_before, package_version_target,
                  package_version_after, action, status, exit_code,
                  started_at, finished_at, reboot_required,
                  log_file_path, log_offset, error_message
             FROM patch_operations
             ${whereClause}
             ORDER BY id DESC
             LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset) as PatchOperationDbRow[];

      const items = rows.map(mapOperationRow);

      return NextResponse.json(
        { items, limit, offset },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/operations GET] errore:", error);
      return NextResponse.json(
        { error: "Errore nel recupero delle operations" },
        { status: 500 }
      );
    }
  });
}

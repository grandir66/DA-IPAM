/**
 * /api/patch/operations
 *
 * POST: avvia una nuova operation (upgrade/install/uninstall/rollback)
 *       fire-and-forget. Ritorna { operationId } immediatamente.
 *       Body: { hostId, cveId?, action: 'upgrade'|'install'|'uninstall'|'rollback',
 *               packageId, version? }
 *
 * GET: history paginata, filtri:
 *        ?hostId=N          → filtro esatto host_id
 *        ?cveId=CVE-...      → match esatto (case-sensitive come da DB)
 *        ?userId=N           → filtro esatto user_id
 *        ?status=...         → uno tra queued|running|success|failed|reboot_pending|cancelled
 *        ?action=...         → uno tra probe|bootstrap|upgrade|install|uninstall|rollback
 *        ?since=ISO          → started_at >= since (UTC ISO 8601)
 *        ?until=ISO          → started_at <= until
 *        ?limit=&offset=     → paginazione (limit default 50, max 200)
 *      Ritorna { items, limit, offset } dove ogni item include anche
 *      host_hostname/host_ip/host_custom_name via LEFT JOIN su hosts (stesso
 *      DB tenant). Il join con `users` (hub DB cross-db) NON è fatto:
 *      la UI mostra solo user_id. Vedi F9 nel plan.
 *
 * AUDIT NOTE (F9): la tabella `patch_operations` è il log di audit
 * immutabile del modulo Patch Management. Ogni riga conserva user_id,
 * timestamp, action, exit_code, log_file_path. NON cancellare mai righe
 * (vedi anti-pattern in plan F9). La history è leggibile da qualsiasi
 * utente del tenant (con patch_management enabled); le mutazioni POST
 * restano admin-only.
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

const ALLOWED_ACTION_FILTERS = new Set([
  "probe",
  "bootstrap",
  "upgrade",
  "install",
  "uninstall",
  "rollback",
]);

/** Valida una stringa ISO 8601 datetime accettabile da SQLite. */
function isValidIsoDatetime(value: string): boolean {
  // YYYY-MM-DD or YYYY-MM-DDTHH:MM(:SS(.sss)?(Z|±HH:MM)?)?
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) {
    return false;
  }
  const t = Date.parse(value);
  return Number.isFinite(t);
}

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
    const action = searchParams.get("action");
    const since = searchParams.get("since");
    const until = searchParams.get("until");
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
        where.push("po.host_id = ?");
        params.push(hostId);
      }
    }
    if (cveId) {
      where.push("po.cve_id = ?");
      params.push(cveId);
    }
    if (userIdRaw) {
      const userId = Number(userIdRaw);
      if (Number.isFinite(userId) && userId > 0) {
        where.push("po.user_id = ?");
        params.push(userId);
      }
    }
    if (status && ALLOWED_STATUS.has(status)) {
      where.push("po.status = ?");
      params.push(status);
    }
    if (action && ALLOWED_ACTION_FILTERS.has(action)) {
      where.push("po.action = ?");
      params.push(action);
    }
    if (since && isValidIsoDatetime(since)) {
      where.push("po.started_at >= ?");
      params.push(since);
    }
    if (until && isValidIsoDatetime(until)) {
      where.push("po.started_at <= ?");
      params.push(until);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    try {
      // JOIN con hosts per UX history: hostname/ip/custom_name nello stesso DB
      // tenant. Nessun JOIN cross-db con users (hub): la UI mostra solo user_id.
      const rows = db
        .prepare(
          `SELECT po.id, po.host_id, po.user_id, po.cve_id, po.package_manager,
                  po.package_id, po.package_version_before, po.package_version_target,
                  po.package_version_after, po.action, po.status, po.exit_code,
                  po.started_at, po.finished_at, po.reboot_required,
                  po.log_file_path, po.log_offset, po.error_message,
                  h.hostname AS host_hostname,
                  h.ip AS host_ip,
                  h.custom_name AS host_custom_name
             FROM patch_operations po
             LEFT JOIN hosts h ON h.id = po.host_id
             ${whereClause}
             ORDER BY po.id DESC
             LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset) as Array<
          PatchOperationDbRow & {
            host_hostname: string | null;
            host_ip: string | null;
            host_custom_name: string | null;
          }
        >;

      const items = rows.map((row) => ({
        ...mapOperationRow(row),
        hostHostname: row.host_hostname,
        hostIp: row.host_ip,
        hostCustomName: row.host_custom_name,
      }));

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

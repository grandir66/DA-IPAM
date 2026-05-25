/**
 * GET /api/patch/operations/[id]/logs
 *
 * Polling delta dei log per una operation in corso.
 *
 * Query params:
 *   - after_log_id (opzionale): se passato, ritorna ANCHE le righe già in
 *     `patch_operation_logs` con id > after_log_id (recovery UI dopo refresh).
 *   - offset (deprecato, ignorato — manteniamo backwards-compat URL): l'offset
 *     reale è gestito server-side in `patch_operations.log_offset`.
 *
 * Risposta:
 *   {
 *     lines: [{ id, ts, stream, line }],   // delta righe nuove (più historical se after_log_id)
 *     nextOffset: number,                  // log_offset aggiornato server-side
 *     lastLogId: number,                   // max(id) ritornato (utile per next poll after_log_id)
 *     finished: boolean,                   // true se status terminale
 *     status: PatchStatus
 *   }
 */
import { NextResponse } from "next/server";
import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { withTenantFromSession } from "@/lib/api-tenant";
import { isAuthError } from "@/lib/api-auth";
import { patchModuleGuard } from "@/lib/patch/route-guard";
import { pollLogDelta } from "@/lib/patch/log-tailer";

const NO_CACHE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

interface LogRow {
  id: number;
  ts: string;
  stream: string;
  line: string;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return withTenantFromSession(async () => {
    const guard = await patchModuleGuard();
    if (isAuthError(guard)) return guard;

    const { id } = await params;
    const operationId = Number(id);
    if (!Number.isFinite(operationId) || operationId <= 0) {
      return NextResponse.json(
        { error: "operation id non valido" },
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

    // 1. Verifica esistenza operation per ritornare 404 prima del polling
    const exists = db
      .prepare("SELECT id FROM patch_operations WHERE id = ?")
      .get(operationId) as { id: number } | undefined;
    if (!exists) {
      return NextResponse.json(
        { error: "Operation non trovata" },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(request.url);
    const afterLogIdRaw = searchParams.get("after_log_id");
    const afterLogId = afterLogIdRaw ? Number(afterLogIdRaw) : null;
    const useAfter =
      afterLogId !== null && Number.isFinite(afterLogId) && afterLogId >= 0;

    try {
      // 2. Tenta polling tail remoto (può essere no-op se throttle/terminale)
      let pollResult;
      try {
        pollResult = await pollLogDelta(tenantCode, operationId);
      } catch (err) {
        console.error(
          "[patch/operations/:id/logs GET] pollLogDelta fallito:",
          (err as Error).message
        );
        // Continua comunque: leggiamo lo storico da DB
        const op = db
          .prepare("SELECT status, log_offset FROM patch_operations WHERE id = ?")
          .get(operationId) as { status: string; log_offset: number };
        pollResult = {
          lines: [],
          nextOffset: op.log_offset,
          finished: ["success", "failed", "reboot_pending", "cancelled"].includes(
            op.status
          ),
          status: op.status as
            | "queued"
            | "running"
            | "success"
            | "failed"
            | "reboot_pending"
            | "cancelled",
        };
      }

      // 3. Se client passa after_log_id → ritorna anche storico già in DB
      let allLines: Array<{
        id: number | null;
        ts: string;
        stream: string;
        line: string;
      }>;

      if (useAfter && afterLogId !== null) {
        const historical = db
          .prepare(
            `SELECT id, ts, stream, line
               FROM patch_operation_logs
              WHERE operation_id = ? AND id > ?
              ORDER BY id ASC`
          )
          .all(operationId, afterLogId) as LogRow[];

        // Le righe nuove appena tailed sono già in DB (transaction in pollLogDelta).
        // Quindi `historical` le contiene già: non serve concatenare `pollResult.lines`.
        allLines = historical.map((r) => ({
          id: r.id,
          ts: r.ts,
          stream: r.stream,
          line: r.line,
        }));
      } else {
        // Primo poll: ritorna SOLO il delta appena tailed (no historical dump)
        allLines = pollResult.lines.map((l) => ({
          id: null,
          ts: l.ts,
          stream: l.stream,
          line: l.line,
        }));
      }

      // 4. Calcola lastLogId per il prossimo poll
      let lastLogId = useAfter && afterLogId !== null ? afterLogId : 0;
      for (const l of allLines) {
        if (l.id !== null && l.id > lastLogId) lastLogId = l.id;
      }
      if (lastLogId === 0) {
        // Recupera il max(id) attuale per stato consistente
        const max = db
          .prepare(
            `SELECT COALESCE(MAX(id), 0) AS max_id
               FROM patch_operation_logs
              WHERE operation_id = ?`
          )
          .get(operationId) as { max_id: number };
        lastLogId = max.max_id;
      }

      return NextResponse.json(
        {
          lines: allLines,
          nextOffset: pollResult.nextOffset,
          lastLogId,
          finished: pollResult.finished,
          status: pollResult.status,
        },
        { headers: NO_CACHE_HEADERS }
      );
    } catch (error) {
      console.error("[patch/operations/:id/logs GET] errore:", error);
      return NextResponse.json(
        { error: "Errore nel recupero dei log" },
        { status: 500 }
      );
    }
  });
}

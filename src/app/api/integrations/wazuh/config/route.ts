/**
 * Configurazione singleton Wazuh (hub-level, condivisa fra tenant).
 *
 *   GET    — ritorna config attuale (password mascherata)
 *   POST   — crea/aggiorna config + registra job wazuh_sync su tutti i tenant attivi
 *   DELETE — disabilita l'integrazione + rimuove i job wazuh_sync
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant, getTenantDb } from "@/lib/db-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import {
  getWazuhConfig,
  getWazuhConfigPublic,
  setWazuhConfig,
} from "@/lib/integrations/wazuh-config";

const PostSchema = z.object({
  enabled:         z.boolean().optional(),
  url:             z.string().min(1).max(500).optional(),
  username:        z.string().min(1).max(200).optional(),
  password:        z.string().min(1).max(500).optional(),
  verifyTls:       z.boolean().optional(),
  indexerUrl:      z.string().max(500).optional(),
  indexerUsername: z.string().max(200).optional(),
  indexerPassword: z.string().max(500).optional(),
  /** Intervallo di sync schedulato in minuti (default 60) */
  syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
});

/** Crea/aggiorna il job wazuh_sync (network_id NULL = tutti i tenant network)
 *  su TUTTI i tenant attivi. Default 60 min. */
function ensureWazuhSyncJobForAllTenants(intervalMinutes: number): { created: number; updated: number } {
  let created = 0;
  let updated = 0;
  for (const tenant of getActiveTenants()) {
    withTenant(tenant.codice_cliente, () => {
      const db = getTenantDb(tenant.codice_cliente);
      const existing = db
        .prepare("SELECT id, interval_minutes FROM scheduled_jobs WHERE job_type = 'wazuh_sync' AND network_id IS NULL")
        .get() as { id: number; interval_minutes: number } | undefined;
      if (existing) {
        if (existing.interval_minutes !== intervalMinutes) {
          db.prepare(
            "UPDATE scheduled_jobs SET interval_minutes = ?, enabled = 1, updated_at = datetime('now') WHERE id = ?",
          ).run(intervalMinutes, existing.id);
          updated++;
        }
      } else {
        db.prepare(
          `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled)
           VALUES (NULL, 'wazuh_sync', ?, 1)`,
        ).run(intervalMinutes);
        created++;
      }
      reloadTenantScheduler(tenant.codice_cliente);
    });
  }
  return { created, updated };
}

/** Rimuove il job wazuh_sync da TUTTI i tenant attivi. */
function removeWazuhSyncJobFromAllTenants(): number {
  let removed = 0;
  for (const tenant of getActiveTenants()) {
    withTenant(tenant.codice_cliente, () => {
      const db = getTenantDb(tenant.codice_cliente);
      const res = db
        .prepare("DELETE FROM scheduled_jobs WHERE job_type = 'wazuh_sync' AND network_id IS NULL")
        .run();
      if (res.changes > 0) removed += res.changes;
      reloadTenantScheduler(tenant.codice_cliente);
    });
  }
  return removed;
}

export async function GET() {
  const authCheck = await requireAuth();
  if (isAuthError(authCheck)) return authCheck;
  return NextResponse.json(getWazuhConfigPublic());
}

export async function POST(req: Request) {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON non valido" }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
  }

  const { syncIntervalMinutes, ...cfg } = parsed.data;
  setWazuhConfig(cfg);

  // Se l'integrazione viene abilitata (o resta abilitata) registra il cron job.
  const after = getWazuhConfig();
  let scheduler: { created: number; updated: number } | null = null;
  if (after.enabled && after.url && after.username && after.password) {
    scheduler = ensureWazuhSyncJobForAllTenants(syncIntervalMinutes ?? 60);
  } else if (cfg.enabled === false) {
    // disabilitato esplicitamente → rimuovi i job
    removeWazuhSyncJobFromAllTenants();
  }

  return NextResponse.json({ ...getWazuhConfigPublic(), scheduler });
}

export async function DELETE() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  setWazuhConfig({ enabled: false });
  const removed = removeWazuhSyncJobFromAllTenants();
  return NextResponse.json({ ...getWazuhConfigPublic(), removedJobs: removed });
}

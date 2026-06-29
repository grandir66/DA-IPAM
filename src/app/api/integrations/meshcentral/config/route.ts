/**
 * Config MeshCentral per-tenant (cifrata).
 *
 *   GET  — ritorna MeshConfigPublic (mai loginTokenKey / admin creds).   requireAuth
 *   POST — crea/aggiorna config + semina job 'meshcentral_sync'.          requireAdmin
 *   DELETE — disabilita + rimuove i job.                                  requireAdmin
 *
 * C3 (spec §9): dopo il save eseguiamo loginTokenSelfCheck come WARNING soft
 * (`selfCheck` nella risposta) — non blocca il salvataggio (il server potrebbe
 * non essere ancora raggiungibile in fase di setup iniziale), ma segnala
 * all'admin se il codec/chiave non sono allineati a MeshCentral.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "better-sqlite3";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { getActiveTenants } from "@/lib/db-hub";
import { withTenant, getTenantDb } from "@/lib/db-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import { getMeshConfig, saveMeshConfig } from "@/lib/integrations/meshcentral/config";
import { loginTokenSelfCheck } from "@/lib/integrations/meshcentral/login-token";

const DEFAULT_SYNC_MINUTES = 30;

const PostSchema = z.object({
  serverUrl: z.string().min(1).max(500),
  domain: z.string().max(200),
  meshId: z.string().min(1).max(300),
  serviceUser: z.string().min(1).max(200),
  loginTokenKey: z.string().min(1).max(400),
  adminUser: z.string().min(1).max(200),
  adminPass: z.string().min(1).max(500),
  syncIntervalMinutes: z.number().int().min(5).max(1440).optional(),
});

/** Semina/aggiorna il job 'meshcentral_sync' (network_id NULL) per UN tenant.
 *  Esportata per i test. Ritorna l'esito dell'operazione DB. */
export function seedMeshSyncJobForTenant(
  db: Database,
  intervalMinutes: number,
): "created" | "updated" | "unchanged" {
  const existing = db
    .prepare(
      "SELECT id, interval_minutes FROM scheduled_jobs WHERE job_type = 'meshcentral_sync' AND network_id IS NULL",
    )
    .get() as { id: number; interval_minutes: number } | undefined;
  if (existing) {
    if (existing.interval_minutes !== intervalMinutes) {
      db.prepare(
        "UPDATE scheduled_jobs SET interval_minutes = ?, enabled = 1, updated_at = datetime('now') WHERE id = ?",
      ).run(intervalMinutes, existing.id);
      return "updated";
    }
    return "unchanged";
  }
  db.prepare(
    `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled)
     VALUES (NULL, 'meshcentral_sync', ?, 1)`,
  ).run(intervalMinutes);
  return "created";
}

function ensureMeshSyncJobForAllTenants(intervalMinutes: number): { created: number; updated: number } {
  let created = 0;
  let updated = 0;
  for (const tenant of getActiveTenants()) {
    withTenant(tenant.codice_cliente, () => {
      const db = getTenantDb(tenant.codice_cliente);
      const res = seedMeshSyncJobForTenant(db, intervalMinutes);
      if (res === "created") created++;
      else if (res === "updated") updated++;
      reloadTenantScheduler(tenant.codice_cliente);
    });
  }
  return { created, updated };
}

function removeMeshSyncJobFromAllTenants(): number {
  let removed = 0;
  for (const tenant of getActiveTenants()) {
    withTenant(tenant.codice_cliente, () => {
      const db = getTenantDb(tenant.codice_cliente);
      const res = db
        .prepare("DELETE FROM scheduled_jobs WHERE job_type = 'meshcentral_sync' AND network_id IS NULL")
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
  const cfg = getMeshConfig();
  // getMeshConfig() è già public-safe (MeshConfigPublic, niente segreti).
  return NextResponse.json(cfg ?? { present: false });
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

  const { syncIntervalMinutes, ...input } = parsed.data;
  saveMeshConfig(input);

  const scheduler = ensureMeshSyncJobForAllTenants(syncIntervalMinutes ?? DEFAULT_SYNC_MINUTES);

  // C3: self-check soft del codec login-token contro il server (non blocca il save).
  let selfCheck: { ok: boolean; error?: string };
  try {
    selfCheck = { ok: await loginTokenSelfCheck() };
  } catch (err) {
    selfCheck = { ok: false, error: (err as Error)?.message ?? "self-check non eseguibile" };
  }

  const cfg = getMeshConfig();
  return NextResponse.json({ ...(cfg ?? { present: false }), scheduler, selfCheck });
}

export async function DELETE() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;
  const removed = removeMeshSyncJobFromAllTenants();
  return NextResponse.json({ present: false, removedJobs: removed });
}

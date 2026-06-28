import { NextResponse } from "next/server";
import { requireAdminOrOnboarding } from "@/lib/api-auth";
import { withTenantFromSession, getServerTenantCode } from "@/lib/api-tenant";
import { getTenantDb } from "@/lib/db-tenant";
import { reloadTenantScheduler } from "@/lib/cron/scheduler";
import {
  getAdIntegrations,
  createAdIntegration,
} from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { z } from "zod/v4";

/** Intervallo di default per il job ad_sync (minuti). 6h: l'AD cambia lentamente
 *  e la dashboard-health considera "stale" oltre 2× questo intervallo. */
const AD_SYNC_INTERVAL_MIN = 360;

/**
 * Garantisce un job ricorrente `ad_sync` (network_id NULL = tutte le integrazioni
 * AD abilitate del tenant) e ricarica lo scheduler in-memory.
 *
 * Storicamente il job NON veniva mai auto-creato all'attivazione di un'integrazione
 * AD (a differenza di wazuh_sync/vuln_sync): l'AD restava non sincronizzato finché
 * qualcuno non creava il job a mano da Settings → Job schedulati. Qui replichiamo
 * il pattern di `wazuh/config` così ogni integrazione AD abilitata ottiene il suo
 * sync ricorrente.
 */
function ensureAdSyncJob(tenantCode: string): void {
  const db = getTenantDb(tenantCode);
  const existing = db
    .prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'ad_sync' AND network_id IS NULL")
    .get() as { id: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE scheduled_jobs SET enabled = 1, updated_at = datetime('now') WHERE id = ?",
    ).run(existing.id);
  } else {
    db.prepare(
      `INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config)
       VALUES (NULL, 'ad_sync', ?, 1, '{}')`,
    ).run(AD_SYNC_INTERVAL_MIN);
  }
  reloadTenantScheduler(tenantCode);
}

const AdIntegrationSchema = z.object({
  name: z.string().min(1),
  dc_host: z.string().min(1),
  domain: z.string().min(1),
  base_dn: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  use_ssl: z.boolean().default(true),
  port: z.number().int().positive().default(636),
  enabled: z.boolean().default(true),
  winrm_credential_id: z.number().int().positive().nullable().optional(),
});

export async function GET() {
  return withTenantFromSession(async () => {
    const integrations = getAdIntegrations();
    const masked = integrations.map((i) => ({
      ...i,
      encrypted_username: undefined,
      encrypted_password: undefined,
      username: "●●●●●●●●",
      password: "●●●●●●●●",
    }));
    return NextResponse.json(masked);
  });
}

export async function POST(request: Request) {
  return withTenantFromSession(async () => {
    const auth = await requireAdminOrOnboarding();
    if (auth instanceof NextResponse) return auth;

    try {
    const body = await request.json();
    const parsed = AdIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dati non validi", details: parsed.error.issues }, { status: 400 });
    }

    const { name, dc_host, domain, base_dn, username, password, use_ssl, port, enabled, winrm_credential_id } = parsed.data;

    const integration = createAdIntegration({
      name,
      dc_host,
      domain,
      base_dn,
      encrypted_username: encrypt(username),
      encrypted_password: encrypt(password),
      use_ssl: use_ssl ? 1 : 0,
      port,
      enabled: enabled ? 1 : 0,
      winrm_credential_id: winrm_credential_id ?? null,
    });

    // Auto-registra il job ad_sync ricorrente (se l'integrazione è abilitata) così
    // l'AD si risincronizza da solo, senza dover creare il job a mano.
    if (enabled) {
      const tenantCode = await getServerTenantCode();
      ensureAdSyncJob(tenantCode);
    }

    return NextResponse.json({
      ...integration,
      encrypted_username: undefined,
      encrypted_password: undefined,
      username: "●●●●●●●●",
      password: "●●●●●●●●",
    }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Errore sconosciuto";
    if (msg.includes("UNIQUE constraint")) {
      return NextResponse.json({ error: "Integrazione già esistente per questo DC e dominio" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  });
}

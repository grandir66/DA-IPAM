/**
 * Probe di salute pubblico (no auth — vedi auth.config.ts).
 *
 * Due modalita', volutamente diverse:
 *
 *   GET /api/health           → 200 salvo DB/cifratura rotti. Semantica STORICA,
 *                               da NON cambiare: e' il gate degli installer
 *                               (`curl -fsSk .../api/health` in
 *                               consolidated-installer.sh e edge-installer.sh).
 *                               Un `-f` che fallisce per un job in ritardo
 *                               bloccherebbe un'installazione per un motivo che
 *                               non c'entra nulla.
 *   GET /api/health?strict=1  → 503 ANCHE se lo scheduler e' fermo. Per il
 *                               monitoraggio esterno.
 *
 * Il blocco `scheduler` c'e' in entrambe: informativo nella prima, vincolante
 * nella seconda. Nasce dall'incidente del 2026-07-05, quando l'appliance e'
 * rimasta congelata **11 giorni** senza che nessuno se ne accorgesse: appena il
 * processo tornava a rispondere questo endpoint diceva "ok" pur con zero scan e
 * zero sync da giorni, perche' guardava solo DB e chiave di cifratura.
 */
import { NextResponse } from "next/server";
import { getActiveTenants, getHubDb } from "@/lib/db-hub";
import { contaRipieghi } from "@/lib/db-maintenance/ripieghi";
import { getTenantDb } from "@/lib/db-tenant";
import { probeEncryptionKeyHealth } from "@/lib/encryption-key-health";
import { getDeployModeLabel } from "@/lib/env-secrets";
import { chiaveDatiAttiva, vaultLocaleAcceso } from "@/lib/vault/stato";
import {
  findStaleJobs,
  summarizeFreshness,
  type SchedulerFreshness,
  type SchedulerJobRow,
} from "@/lib/health/scheduler-freshness";

const startTime = Date.now();

type SchedulerProbe = SchedulerFreshness & { detail: string | null };

/**
 * Legge `scheduled_jobs` di tutti i tenant attivi e ne valuta la freschezza.
 * Non lancia mai: un probe che esplode e' peggio di un probe che dice "non so".
 */
function probeScheduler(): SchedulerProbe {
  try {
    const rows: SchedulerJobRow[] = [];
    for (const tenant of getActiveTenants()) {
      const db = getTenantDb(tenant.codice_cliente);
      rows.push(
        ...(db
          .prepare(
            `SELECT job_type, interval_minutes, last_run, created_at, enabled
               FROM scheduled_jobs`,
          )
          .all() as SchedulerJobRow[]),
      );
    }
    return { ...summarizeFreshness(findStaleJobs(rows, Date.now())), detail: null };
  } catch (error) {
    // Se i job non sono nemmeno leggibili non possiamo dichiarare sano lo
    // scheduler: lo diciamo, invece di far finta di niente.
    return {
      ok: false,
      staleCount: 0,
      worstOverdueMinutes: null,
      detail: error instanceof Error ? error.message : "scheduler non verificabile",
    };
  }
}

export async function GET(request: Request) {
  const strict = new URL(request.url).searchParams.get("strict") === "1";
  try {
    // Verifica accesso DB con query minimale sull'hub. Non `getDb()`: senza
    // contesto tenant ripiegherebbe su DEFAULT o su ipam.db (NUC-1), e il probe
    // risulterebbe esso stesso un ripiego.
    const dbCheck = getHubDb().prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
    const dbOk = dbCheck?.ok === 1;
    const encryption = probeEncryptionKeyHealth();
    const secretsOk = encryption.ok;
    const scheduler = probeScheduler();

    // da-vault: col vault locale acceso e bloccato (riavvio senza TPM, passphrase da dare) le credenziali non si
    // leggono per quello, non perche' la chiave e' sbagliata. Il codice HTTP resta 200 (status "degraded"): update.sh
    // e auto-update.sh aspettano un 200 dopo il riavvio e altrimenti tornano a una build che non legge i valori
    // ricifrati. Solo `?strict=1` (monitoraggio) lo vuole 503.
    const vaultBloccato = vaultLocaleAcceso() && !chiaveDatiAttiva();

    // Il codice HTTP di default NON dipende dallo scheduler (vedi docblock).
    const coreOk = dbOk && (secretsOk || (vaultBloccato && !strict));
    const overallOk = coreOk && (!strict || (scheduler.ok && !vaultBloccato));

    // Leggi versione da package.json (cached a startup)
    const pkg = await import("../../../../package.json");

    return NextResponse.json({
      status: coreOk && scheduler.ok && !vaultBloccato ? "ok" : "degraded",
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
      // Solo se il vault locale e' acceso: bloccato = nessuna chiave dei dati in memoria (Impostazioni › Vault).
      ...(vaultLocaleAcceso()
        ? { vault: { bloccato: vaultBloccato, detail: vaultBloccato ? "vault bloccato (Impostazioni › Vault)" : null } }
        : {}),
      // Aggregato: nessun nome di job ne' codice tenant — l'endpoint e' pubblico.
      // Il dettaglio sta su /api/modules/health, che richiede autenticazione.
      scheduler: {
        ok: scheduler.ok,
        stale_jobs: scheduler.staleCount,
        worst_overdue_minutes: scheduler.worstOverdueMinutes,
        detail: scheduler.detail,
      },
      // Accessi al DB senza contesto tenant da quando il processo è partito
      // (NUC-1). Solo il numero: chi e da dove sta su /api/modules/health.
      ripieghi: contaRipieghi(),
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

/**
 * Backup scheduler — registra una sola job cron nightly hub-level.
 *
 * Schedule default: 0 3 * * * (3am ogni notte).
 * Override via env: `DA_INVENT_BACKUP_CRON=0 4 * * *` (es. ore 4).
 *
 * Avviato da `server.ts` al boot dopo `initializeScheduler()`.
 */

import cron, { type ScheduledTask } from "node-cron";
import { getActiveTenants } from "@/lib/db-hub";
import { runHubBackup } from "./engine";

const DEFAULT_CRON = "0 3 * * *";

let scheduled: ScheduledTask | null = null;
let running = false;

export function initializeBackupScheduler(): void {
  if (scheduled) {
    console.warn("[backup-scheduler] già inizializzato, skip");
    return;
  }

  const expr = process.env.DA_INVENT_BACKUP_CRON || DEFAULT_CRON;
  if (!cron.validate(expr)) {
    console.error(`[backup-scheduler] cron expression non valida: "${expr}" — backup nightly NON attivo`);
    return;
  }

  scheduled = cron.schedule(expr, async () => {
    if (running) {
      console.warn("[backup-scheduler] backup precedente ancora in corso, skip questo tick");
      return;
    }
    running = true;
    try {
      const tenants = getActiveTenants();
      const codes = tenants.map((t) => t.codice_cliente);
      console.info(`[backup-scheduler] avvio backup nightly: hub + ${codes.length} tenant`);
      const manifest = await runHubBackup(codes);
      if (manifest.errors.length > 0) {
        console.error(`[backup-scheduler] backup completato con ${manifest.errors.length} errori:`, manifest.errors);
      }
    } catch (e) {
      console.error("[backup-scheduler] backup fallito:", e);
    } finally {
      running = false;
    }
  });

  console.info(`[backup-scheduler] backup nightly schedulato: "${expr}" (hub.db + tenant DBs)`);
}

export function isBackupRunning(): boolean {
  return running;
}

/**
 * Il job `pulizia_host` si gestisce solo dalla sua scheda (Impostazioni → Sistema → Pulizia degli host assenti;
 * decisione 4 del 20/10, revisione finale m6). L'elenco dei job lo mostrava già in sola lettura, ma le rotte
 * `/api/jobs` (PUT acceso/spento e intervallo, DELETE, «Esegui ora») lo accettavano per id: chi le chiama a mano
 * poteva lanciare di giorno il giro che toglie host del cliente, o cambiarne l'intervallo. La guardia le ferma con 409.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/cron/__tests__/job-riservati.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, setPuliziaHostSchedule, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { rifiutoJobRiservato } from "@/lib/cron/job-riservati";

const T = "JOBRISERVATI2010";
after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("pulizia_host → 409 col posto dove si gestisce; gli altri job e gli id che non ci sono → nessun rifiuto", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    setPuliziaHostSchedule(true);
    const pulizia = (d.prepare("SELECT id FROM scheduled_jobs WHERE job_type = 'pulizia_host'").get() as { id: number }).id;
    const altro = Number(d.prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, 'cleanup', 1440, 1, '{}')")
      .run().lastInsertRowid);
    assert.deepEqual(rifiutoJobRiservato(pulizia), {
      status: 409,
      body: { error: "Si gestisce da Impostazioni → Sistema → Pulizia degli host assenti" },
    });
    assert.equal(rifiutoJobRiservato(altro), null);
    assert.equal(rifiutoJobRiservato(9_999_999), null);
  });
});

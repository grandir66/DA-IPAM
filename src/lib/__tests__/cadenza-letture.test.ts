// La cadenza vera di un cliente, per il dialogo di «Letture in più per la mappa» (spec §13.5.6): il router lo leggono il
// giro ARP e le scansioni delle reti (vale il job acceso più frequente), gli switch solo il giro ARP. Un job spento non
// conta; senza job accesi la risposta è «nessun giro programmato» (null), non zero.
import { removeTestHubDb } from "@/lib/integrations/__tests__/support/hub-isolato";
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { cadenzaLetture, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";

const T = "TESTCADLETTURE";
const job = (tipo: string, minuti: number, acceso = 1) =>
  getTenantDb(T).prepare("INSERT INTO scheduled_jobs (network_id, job_type, interval_minutes, enabled, config) VALUES (NULL, ?, ?, ?, '{}')").run(tipo, minuti, acceso);

beforeEach(() => { getTenantDb(T).exec("DELETE FROM scheduled_jobs"); });
after(() => { deleteTenantDatabase(T); closeHubDb(); removeTestHubDb(); });

test("nessun job acceso: nessun giro programmato, né per il router né per gli switch", () => {
  assert.deepEqual(withTenant(T, () => cadenzaLetture()), { router: { minuti: null, daScansioni: false }, switch: null });
  job("arp_poll", 15, 0);
  job("fast_scan", 5, 0);
  assert.deepEqual(withTenant(T, () => cadenzaLetture()), { router: { minuti: null, daScansioni: false }, switch: null }, "i job spenti non contano");
});

test("l'hub: le scansioni veloci ogni 15 minuti battono il giro ARP ogni ora per il router, gli switch restano a un'ora", () => {
  job("arp_poll", 60);
  job("fast_scan", 15);
  job("fast_scan", 30);
  assert.deepEqual(withTenant(T, () => cadenzaLetture()), { router: { minuti: 15, daScansioni: true }, switch: 60 });
});

test("il cliente A: solo il giro ARP ogni ora, il router si legge da lì", () => {
  job("arp_poll", 60);
  assert.deepEqual(withTenant(T, () => cadenzaLetture()), { router: { minuti: 60, daScansioni: false }, switch: 60 });
});

test("a parità vale «dalle scansioni»; i job che non leggono i router (pulizia, hypervisor) non contano", () => {
  job("arp_poll", 30);
  job("ping_sweep", 30);
  job("cleanup", 1);
  job("hypervisor_sync", 1440);
  assert.deepEqual(withTenant(T, () => cadenzaLetture()), { router: { minuti: 30, daScansioni: true }, switch: 30 });
});

test("solo scansioni, senza giro ARP: il router c'è, gli switch non hanno un giro", () => {
  job("snmp_scan", 120);
  assert.deepEqual(withTenant(T, () => cadenzaLetture()), { router: { minuti: 120, daScansioni: true }, switch: null });
});

/**
 * Profilo nuovo pronto senza riavvio (ADR 0037, piano 2026-11-08, Task 3).
 *
 * Misura dell'08/11: un tenant creato da `POST /api/tenants` non ha job (0) finché il servizio
 * non riparte, perché il seme dei job di serie e lo scheduler girano solo all'avvio. Sul PC del
 * tecnico un profilo nuovo si crea dal cliente e si usa subito: `preparaProfilo` fa lì quello
 * che l'avvio fa per tutti. Il codice del profilo è il `codcli` del gestionale, così il
 * centrale lo riconosce. Sulle installazioni dai clienti la creazione resta com'è oggi.
 *
 * Run: node --import tsx --test src/lib/profili/__tests__/nuovo-profilo.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb, createTenant, type CreateTenantInput } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb } from "@/lib/db-tenant";
import { activeJobKeys, stopTenantJobs } from "@/lib/cron/scheduler";
import { preparaProfilo, regolaCreazioneProfilo } from "@/lib/profili/nuovo-profilo";

const CODICE = "70999";

function tenant(codice: string): CreateTenantInput {
  return {
    codice_cliente: codice, ragione_sociale: `Cliente ${codice}`, indirizzo: null, citta: null, provincia: null,
    cap: null, telefono: null, email: null, piva: null, cf: null, referente: null, note: null, active: 1,
  } as CreateTenantInput;
}

after(() => {
  stopTenantJobs(CODICE);
  try { closeTenantDb(CODICE); deleteTenantDatabase(CODICE); } catch { /* già tolto */ }
  closeHubDb();
});

test("profilo creato e preparato: job di serie nel DB e nello scheduler, senza riavvio", () => {
  createTenant(tenant(CODICE));
  const prima = (getTenantDb(CODICE).prepare("SELECT COUNT(*) c FROM scheduled_jobs").get() as { c: number }).c;
  assert.equal(prima, 0, "misura dell'08/11: senza preparazione un tenant nuovo non ha job");
  const esito = preparaProfilo(CODICE);
  const dopo = (getTenantDb(CODICE).prepare("SELECT COUNT(*) c FROM scheduled_jobs").get() as { c: number }).c;
  assert.ok(dopo > 0, "dopo la preparazione ci sono i job di serie");
  assert.equal(esito.jobSeminati, dopo);
  const chiavi = activeJobKeys().filter((k) => k.startsWith(`${CODICE}:`));
  assert.equal(chiavi.length, esito.jobCaricati);
});

test("preparare due volte non duplica", () => {
  const prima = (getTenantDb(CODICE).prepare("SELECT COUNT(*) c FROM scheduled_jobs").get() as { c: number }).c;
  const esito = preparaProfilo(CODICE);
  const dopo = (getTenantDb(CODICE).prepare("SELECT COUNT(*) c FROM scheduled_jobs").get() as { c: number }).c;
  assert.equal(dopo, prima);
  assert.equal(esito.jobSeminati, 0);
});

test("installazione: la creazione resta com'è oggi (qualsiasi codice, nessuna preparazione)", () => {
  for (const codice of ["70999", "DEFAULT", "CLIENTE-A", "x"]) {
    assert.deepEqual(regolaCreazioneProfilo("installazione", codice), { ok: true, prepara: false }, codice);
  }
});

test("tecnico: solo codcli del gestionale, poi si prepara", () => {
  assert.deepEqual(regolaCreazioneProfilo("tecnico", "70999"), { ok: true, prepara: true });
  assert.deepEqual(regolaCreazioneProfilo("tecnico", " 123 "), { ok: true, prepara: true });
  for (const codice of ["12", "123456789", "CLIENTE-A", "DEFAULT", "70 99", ""]) {
    const r = regolaCreazioneProfilo("tecnico", codice);
    assert.equal(r.ok, false, codice);
  }
});

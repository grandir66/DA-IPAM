/**
 * Interruttore del desktop remoto senza agente (analisi del 19/10, F10, approvato da
 * Riccardo). Incidente: sull'hub la voce RDP non c'era perché l'interruttore stava
 * solo in `.env.local` (MESHCENTRAL_SENZA_AGENTE=1), invisibile dall'interfaccia.
 * Ora è un'impostazione del tenant; la variabile d'ambiente resta e vince.
 *
 * Run: node --import tsx --test src/lib/integrations/meshcentral/__tests__/senza-agente-interruttore.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { CHIAVE_SENZA_AGENTE, senzaAgenteAttivo, statoSenzaAgente } from "../senza-agente";

const T = "SENZAAGENTE1910";
after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

test("spento di default; acceso dall'impostazione del tenant; la variabile d'ambiente vince e lo dice", () => {
  const prima = process.env.MESHCENTRAL_SENZA_AGENTE;
  delete process.env.MESHCENTRAL_SENZA_AGENTE;
  try {
    withTenant(T, () => {
      assert.deepEqual(statoSenzaAgente(), { attivo: false, daAmbiente: false });
      setTenantSetting(CHIAVE_SENZA_AGENTE, "1");
      assert.deepEqual(statoSenzaAgente(), { attivo: true, daAmbiente: false });
      assert.equal(senzaAgenteAttivo(), true);
      setTenantSetting(CHIAVE_SENZA_AGENTE, "0");
      process.env.MESHCENTRAL_SENZA_AGENTE = "1";
      assert.deepEqual(statoSenzaAgente(), { attivo: true, daAmbiente: true });
    });
    delete process.env.MESHCENTRAL_SENZA_AGENTE;
    // Fuori da un tenant: spento, nessun errore.
    assert.deepEqual(statoSenzaAgente(), { attivo: false, daAmbiente: false });
  } finally {
    if (prima === undefined) delete process.env.MESHCENTRAL_SENZA_AGENTE;
    else process.env.MESHCENTRAL_SENZA_AGENTE = prima;
  }
});

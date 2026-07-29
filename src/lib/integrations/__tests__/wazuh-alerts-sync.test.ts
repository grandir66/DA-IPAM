// Hub DB isolato per questo file (vedi wazuh-config.test.ts): getWazuhConfig/
// setWazuhConfig scrivono sul vero hub.db se non si sovrascrive il path.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-wazuh-sync1";
process.env.DA_IPAM_HUB_DB_PATH = path.join(
  os.tmpdir(),
  `da-ipam-test-hub-wazuh-sync-${process.pid}.db`,
);

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { withTenant, deleteTenantDatabase } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { setWazuhConfig } from "../wazuh-config";
import {
  syncWazuhAlertsForTenant,
  _setWazuhIndexerClientFactory,
  _setHealthEvaluator,
  type AlertsIndexerClientLike,
} from "../wazuh-alerts-sync";

const T = "TESTWAZUHSYNC";

after(() => {
  deleteTenantDatabase(T);
  closeHubDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.rmSync(process.env.DA_IPAM_HUB_DB_PATH + suffix, { force: true });
    } catch {
      /* ignore */
    }
  }
});

afterEach(() => {
  _setWazuhIndexerClientFactory(null);
  _setHealthEvaluator(null);
});

function throwingClient(message: string): AlertsIndexerClientLike {
  return {
    searchAlerts: async () => {
      throw new Error(message);
    },
  };
}

// Regressione Important 1 (review fase 2): la valutazione della salute viveva
// dentro il try del sync, DOPO searchAlerts. Con l'indexer giù, searchAlerts
// lancia, il catch rilancia, e la salute non veniva mai valutata — un'
// interruzione di ore dell'indexer produceva zero notifiche, né durante né
// dopo il guasto.
test("con l'indexer giù (searchAlerts lancia) la valutazione della salute viene comunque invocata", async () => {
  setWazuhConfig({
    enabled: true,
    url: "https://mgr.example",
    username: "u",
    password: "p",
    indexerUrl: "https://idx.example",
    indexerUsername: "iu",
    indexerPassword: "ip",
  });

  _setWazuhIndexerClientFactory(() => throwingClient("ECONNREFUSED indexer"));

  let healthCalledWith: string | null = null;
  _setHealthEvaluator(async (tenantCode: string) => {
    healthCalledWith = tenantCode;
    return { notified: 0 };
  });

  await withTenant(T, async () => {
    await assert.rejects(() => syncWazuhAlertsForTenant(), /ECONNREFUSED indexer/);
  });

  assert.equal(healthCalledWith, T, "evaluateAndNotifyWazuhHealth non è stata invocata nonostante il sync fallito");
});

// Seconda metà del bug: un tenant con Wazuh (manager) configurato ma senza
// credenziali indexer tornava "skipped" PRIMA di arrivare alla valutazione
// della salute — quindi anche le repliche (il valore di compliance della
// fase) non venivano mai notificate.
test("indexer non configurato ma Wazuh (manager) sì: la salute viene valutata comunque", async () => {
  setWazuhConfig({
    enabled: true,
    url: "https://mgr.example",
    username: "u",
    password: "p",
    indexerUrl: "",
    indexerUsername: "",
    indexerPassword: "",
  });

  let healthCalled = false;
  _setHealthEvaluator(async () => {
    healthCalled = true;
    return { notified: 0 };
  });

  await withTenant(T, async () => {
    const r = await syncWazuhAlertsForTenant();
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "indexer non configurato");
  });

  assert.equal(healthCalled, true, "il ramo skipped 'indexer non configurato' deve valutare comunque la salute");
});

// Quando non c'è proprio nulla configurato (né Wazuh né repliche), non ha
// senso lanciare i quattro probe: la valutazione va saltata.
test("Wazuh completamente disabilitato e repliche non configurate: la salute non viene valutata", async () => {
  setWazuhConfig({
    enabled: false,
    url: "",
    username: "",
    password: "",
    indexerUrl: "",
    indexerUsername: "",
    indexerPassword: "",
  });

  let healthCalled = false;
  _setHealthEvaluator(async () => {
    healthCalled = true;
    return { notified: 0 };
  });

  await withTenant(T, async () => {
    const r = await syncWazuhAlertsForTenant();
    assert.equal(r.skipped, true);
    assert.equal(r.reason, "integrazione disabilitata");
  });

  assert.equal(healthCalled, false);
});

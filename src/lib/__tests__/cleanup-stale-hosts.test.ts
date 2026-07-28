/**
 * Test C2 (fase 4, fix-wave post-review): cleanupStaleHosts non deve MAI
 * sovrascrivere un host con classification_manual=1. Prima del fix
 * l'UPDATE non filtrava sul lock manuale: un host bloccato dall'utente che
 * va offline perdeva il valore scelto (sovrascritto col sentinel 'stale') e
 * restava comunque classification_manual=1, quindi nessuno lo riparava più.
 *
 * Pattern: tenant DB reale su disco (stesso approccio di
 * credential-protocol-migration.test.ts) — cleanupStaleHosts (db-tenant.ts)
 * usa db() via AsyncLocalStorage, quindi serve withTenant() + getTenantDb()
 * veri, non un :memory: isolato.
 *
 * Run: node --import tsx --test src/lib/__tests__/cleanup-stale-hosts.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { withTenant, getTenantDb, deleteTenantDatabase, cleanupStaleHosts } from "@/lib/db-tenant";

const T = "TESTCLEANUPSTALE";

describe("cleanupStaleHosts — lock manuale protetto (fix C2)", () => {
  before(() => {
    deleteTenantDatabase(T); // pulizia da run precedenti interrotti
  });

  after(() => {
    deleteTenantDatabase(T);
  });

  it("host manuale offline da tempo NON viene marcato 'stale' e non perde la classification", () => {
    withTenant(T, () => {
      const dbh = getTenantDb(T);
      dbh.exec("INSERT INTO networks (id, name, cidr) VALUES (1, 'n', '10.0.0.0/24')");
      dbh.exec(
        `INSERT INTO hosts (id, network_id, ip, status, last_seen, classification, classification_manual)
         VALUES (1, 1, '10.0.0.1', 'offline', datetime('now', '-100 days'), 'server_windows', 1)`
      );
      dbh.exec(
        `INSERT INTO hosts (id, network_id, ip, status, last_seen, classification, classification_manual)
         VALUES (2, 1, '10.0.0.2', 'offline', datetime('now', '-100 days'), 'workstation', 0)`
      );

      const result = cleanupStaleHosts(30, 9999);

      const manualHost = dbh.prepare("SELECT classification, classification_manual FROM hosts WHERE id = 1").get() as {
        classification: string;
        classification_manual: number;
      };
      const autoHost = dbh.prepare("SELECT classification FROM hosts WHERE id = 2").get() as { classification: string };

      assert.equal(manualHost.classification, "server_windows", "host manuale non deve mai essere marcato 'stale'");
      assert.equal(manualHost.classification_manual, 1, "il lock manuale resta intatto");
      assert.equal(autoHost.classification, "stale", "host non manuale continua a essere marcato 'stale' come prima");
      assert.equal(result.flagged, 1, "solo l'host non manuale viene conteggiato come flagged");
    });
  });
});

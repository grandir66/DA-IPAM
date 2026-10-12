process.env.ENCRYPTION_KEY ||= "test-encryption-key-mod19-uninstall";

/**
 * MOD-19 (piano di miglioramento, tappa 1, 12/10): la conferma di
 * disinstallazione in Impostazioni → Moduli diceva, sotto la casella
 * «Elimina anche i dati storici», «al momento il flag viene accettato ma non
 * droppa». Invece /api/features/[key]/uninstall cancellava davvero le tabelle
 * del modulo: chi spuntava la casella credendola innocua perdeva lo storico.
 *
 * Queste prove eseguono la cancellazione vera (la stessa funzione che usa la
 * rotta) e la confrontano con il testo mostrato a schermo. Se la
 * disinstallazione cambia (tappa 7, MOD-5) una prova fallisce: il testo in
 * src/lib/modules/uninstall-copy.ts va aggiornato insieme al codice.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Database } from "better-sqlite3";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { applyPatchModuleMigrations, PATCH_MODULE_TABLES } from "@/lib/patch/schema";
import {
  applyInventoryAgentMigrations,
  INVENTORY_AGENT_TABLES,
} from "@/lib/inventory-agent/schema";
import { applyMcSchemaMigrations, MC_TABLES } from "@/lib/integrations/meshcentral/schema";
import {
  UNINSTALL_COPY,
  UNINSTALLABLE_FEATURES,
  isUninstallableFeature,
  type UninstallableFeature,
} from "@/lib/modules/uninstall-copy";
import { dropFeatureData } from "@/lib/modules/uninstall-data";

const T = "TESTMOD19UNINST";
after(() => deleteTenantDatabase(T));

const APPLY_SCHEMA: Record<UninstallableFeature, (db: Database) => void> = {
  patch_management: (db) => {
    applyPatchModuleMigrations(db);
  },
  inventory_agent: (db) => {
    applyInventoryAgentMigrations(db);
  },
  meshcentral: (db) => applyMcSchemaMigrations(db),
};

const MODULE_TABLES: Record<UninstallableFeature, readonly string[]> = {
  patch_management: PATCH_MODULE_TABLES,
  inventory_agent: INVENTORY_AGENT_TABLES,
  meshcentral: MC_TABLES,
};

function tableExists(db: Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

test("ogni modulo disinstallabile ha il suo testo di conferma, e nessun altro", () => {
  assert.deepEqual(Object.keys(UNINSTALL_COPY).sort(), [...UNINSTALLABLE_FEATURES].sort());
  assert.equal(isUninstallableFeature("patch_management"), true);
  assert.equal(isUninstallableFeature("network_services"), false);
});

for (const key of UNINSTALLABLE_FEATURES) {
  test(`${key}: il testo elenca tutte e sole le tabelle del modulo`, () => {
    // Se una tabella si aggiunge al modulo, la conferma deve dire anche di lei.
    assert.deepEqual([...UNINSTALL_COPY[key].tabelle].sort(), [...MODULE_TABLES[key]].sort());
  });

  test(`${key}: con la casella spuntata le tabelle elencate si cancellano davvero`, () => {
    withTenant(T, () => {
      const db = getTenantDb(T);
      APPLY_SCHEMA[key](db);
      for (const t of UNINSTALL_COPY[key].tabelle) {
        assert.equal(tableExists(db, t), true, `${t} deve esistere prima della disinstallazione`);
      }
      assert.equal(dropFeatureData(db, key), true);
      for (const t of UNINSTALL_COPY[key].tabelle) {
        assert.equal(tableExists(db, t), false, `${t} deve essere cancellata: la conferma lo promette`);
      }
    });
  });

  test(`${key}: il testo dice cosa si cancella con la casella e cosa resta senza`, () => {
    const c = UNINSTALL_COPY[key];
    assert.ok(c.effetto.length > 0);
    assert.match(c.conCasella, /^Si cancellano/);
    assert.match(c.senzaCasella, /restano nel database/);
    // Il testo vecchio («il flag viene accettato ma non droppa») non deve tornare.
    for (const s of [c.effetto, c.senzaCasella, c.conCasella]) {
      assert.doesNotMatch(s, /non droppa|flag/i);
    }
  });
}

test("patch_management: se le tabelle non ci sono, la cancellazione lo dice (false)", () => {
  // Ramo che la conferma deve gestire: la rotta risponde dataDropped=false e la
  // UI non può dire «dati eliminati».
  withTenant(T, () => {
    const db = getTenantDb(T);
    applyPatchModuleMigrations(db);
    assert.equal(dropFeatureData(db, "patch_management"), true);
    assert.equal(dropFeatureData(db, "patch_management"), false);
  });
});

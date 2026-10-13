/**
 * createNetwork deve seminare i job predefiniti, e ne esiste una copia sola.
 *
 * Fix 2026-07-20: la copia `db.ts` di createNetwork aveva perso
 * `seedDefaultJobsForNetwork` → reti create via API senza monitoring
 * predefinito. Finché le copie erano due, questo test controllava il testo di
 * entrambe. Da T3-06 (NUC-2 gruppo 1b) la facciata riesporta la copia di
 * `db-tenant.ts`: la deriva non può più nascere fra due copie, e il test lo
 * prova con l'identità dell'oggetto funzione invece di toglierlo in silenzio.
 * La semina vera, eseguita, è provata in `db-parity/reti-host.test.ts`.
 * Run: node --import tsx --test src/lib/__tests__/db-createnetwork-drift.test.ts
 */
import { TEST_DATA_DIR } from "./support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

test("createNetwork: db.ts esporta la stessa funzione di db-tenant.ts", () => {
  assert.equal(facciata.createNetwork, tenant.createNetwork, "db.ts ha di nuovo una copia propria di createNetwork");
});

test("createNetwork in db-tenant.ts semina i job predefiniti", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/db-tenant.ts"), "utf8");
  const start = src.search(/export function createNetwork\b/);
  assert.ok(start >= 0, "createNetwork non trovata in db-tenant.ts");
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport function \w/);
  const body = src.slice(start, next < 0 ? src.length : start + 1 + next);
  assert.match(
    body,
    /seedDefaultJobsForNetwork\s*\(/,
    "createNetwork deve chiamare seedDefaultJobsForNetwork(): senza, la rete non riceve il job di monitoring predefinito",
  );
});

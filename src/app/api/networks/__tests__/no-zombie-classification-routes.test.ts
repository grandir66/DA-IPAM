// Test di guardia I3 (fase 4, fix-wave post-review): /api/networks/[id]/refresh
// e /api/networks/[id]/apply-classifications erano route "zombie" — nessun
// consumer UI (rimosso nel Task 3), ma ancora raggiungibili da un admin con
// { force: true }, che azzerava classification_manual in massa (bypass
// dell'invariante sacro "un host manuale non viene mai toccato
// automaticamente"). Rimosse fisicamente (nessun test/consumer le citava).
// Questo test impedisce che vengano ricreate per errore (es. un merge/rebase
// che riporta indietro un file cancellato) senza che qualcuno se ne accorga.
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const NETWORKS_ID_DIR = path.resolve(__dirname, "..", "[id]");

describe("route zombie di classificazione rimosse (fix I3)", () => {
  it("/api/networks/[id]/refresh/route.ts non esiste più", () => {
    const p = path.join(NETWORKS_ID_DIR, "refresh", "route.ts");
    assert.ok(!fs.existsSync(p), `${p} non deve esistere: route zombie con force:true che azzerava classification_manual`);
  });

  it("/api/networks/[id]/apply-classifications/route.ts non esiste più", () => {
    const p = path.join(NETWORKS_ID_DIR, "apply-classifications", "route.ts");
    assert.ok(!fs.existsSync(p), `${p} non deve esistere: route zombie con force:true che azzerava classification_manual`);
  });
});

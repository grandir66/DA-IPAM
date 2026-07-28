// Test di guardia C1 (fase 4, fix-wave post-review): discovery.ts NON deve più
// invocare il motore di classificazione legacy (runClassificationEngineForHost)
// automaticamente a ogni scan schedulato. Prima del fix era l'ultimo writer
// automatico rimasto oltre all'attribuzione v2, e in conflitto vinceva lui: il
// suo persist (src/lib/classification/persist.ts::applyClassificationDecision)
// scrive inferred_confidence/classification_reason/classification_json anche su
// host con classification_manual=1, violando l'invariante sacro del piano.
//
// Un test end-to-end sul loop di scan reale (discoverNetwork) richiederebbe di
// mockare nmap/SNMP/ARP/probe per centinaia di righe — sproporzionato per
// verificare "questa funzione non viene più chiamata da qui". Una guardia
// statica sul sorgente (stesso principio di no-legacy-writers.test.ts) è
// sufficiente e molto più economica: se qualcuno reintroduce la chiamata in
// discovery.ts, questo test fallisce subito, senza aspettare un audit manuale.
import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

const DISCOVERY_PATH = path.resolve(__dirname, "..", "discovery.ts");

describe("discovery.ts non invoca più il motore di classificazione legacy (fix C1)", () => {
  it("nessun import né chiamata a runClassificationEngineForHost (un commento che ne cita il nome per spiegare il ritiro è ok)", () => {
    const src = fs.readFileSync(DISCOVERY_PATH, "utf8");
    assert.ok(
      !/from ["']@\/lib\/classification\/run["']/.test(src),
      "discovery.ts non deve più importare src/lib/classification/run"
    );
    assert.ok(
      !/runClassificationEngineForHost\s*\(/.test(src),
      "discovery.ts non deve più chiamare runClassificationEngineForHost — " +
      "l'attribuzione v2 (recomputeAttributionSafe) è l'unico motore che deve girare a ogni scan."
    );
  });

  it("il recompute attribuzione v2 (recomputeAttributionSafe) resta invocato per ogni host persistito", () => {
    const src = fs.readFileSync(DISCOVERY_PATH, "utf8");
    assert.ok(
      /recomputeAttributionSafe\(host\.id,\s*"scan"\)/.test(src),
      "recomputeAttributionSafe deve restare l'unico motore di classificazione invocato dallo scan"
    );
  });
});

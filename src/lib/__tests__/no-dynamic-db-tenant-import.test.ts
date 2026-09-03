import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * INVARIANTE: `db-tenant` non si importa MAI dinamicamente.
 *
 * INCIDENTE 2026-09-02 (appliance Domarc, da-ipam.domarc.it). Le installazioni
 * che girano da sorgente con `tsx` (ExecStart=tsx server.ts) non deduplicano i
 * moduli come fa il bundler di Next: `await import("../db-tenant")` restituisce
 * una SECONDA istanza del modulo, con la propria AsyncLocalStorage vuota.
 *
 * Il danno non si fermava al chiamante. Riprodotto sull'appliance (Node 20.20.2
 * + tsx 4.21.0): dopo l'import dinamico anche il `require("./db-tenant")` del
 * facade `db.ts` risolveva sulla seconda istanza, quindi il contesto tenant
 * risultava perso per TUTTO il processo, fino al riavvio. Conseguenze reali:
 *
 *   - 340 job falliti in 5 ore con "Job #N non trovato" — messaggio fuorviante:
 *     `getDb()` ripiegava in silenzio sul tenant DEFAULT, che non ha quei job;
 *   - 179 host del tenant 70791 scritti dentro DEFAULT.db dai fast_scan in
 *     corso, cioe' dati finiti nel database del tenant sbagliato;
 *   - nessun allarme, perche' il processo rispondeva e il DB era sano.
 *
 * Corretto in 6067161 (librenms-sync) e d04c2a1 (patch/executor) sostituendo i
 * due import dinamici con import statici. Questo test impedisce che rientrino:
 * su un build Next il difetto e' INVISIBILE, quindi non lo si scoprirebbe piu'
 * in sviluppo, ma solo in produzione su un'appliance, mesi dopo.
 *
 * Cosa resta lecito: `require("./db-tenant")` (registro CJS, stessa istanza) e
 * `typeof import("@/lib/db-tenant")` (annotazione di tipo, cancellata a
 * compile-time). Importare dinamicamente ALTRI moduli e' sano, anche quando
 * quelli importano db-tenant staticamente — verificato sull'appliance.
 */

const SRC = path.join(process.cwd(), "src");

/** `import("...db-tenant")` come ESPRESSIONE, non come annotazione di tipo. */
const DYNAMIC_IMPORT = /(^|[^.\w])import\s*\(\s*["'][^"']*db-tenant["']\s*\)/;

function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

test("nessun import dinamico di db-tenant nei sorgenti", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    // Il test stesso contiene il pattern nei commenti: si esclude.
    if (file.endsWith("no-dynamic-db-tenant-import.test.ts")) continue;

    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      // `typeof import(...)` e' un tipo, non un caricamento a runtime.
      if (/typeof\s+import\s*\(/.test(line)) return;
      if (DYNAMIC_IMPORT.test(line)) {
        offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "db-tenant va importato STATICAMENTE (vedi docblock: sotto tsx l'import " +
      "dinamico duplica il modulo e fa perdere il contesto tenant a tutto il " +
      "processo). Punti da correggere:\n" + offenders.join("\n"),
  );
});

test("il pattern del test riconosce davvero le forme incriminate", () => {
  // Un invariante che non sa piu' riconoscere il difetto e' peggio di nessun
  // invariante: passa sempre e rassicura a torto.
  assert.ok(DYNAMIC_IMPORT.test('const { getNetworks } = await import("../db-tenant");'));
  assert.ok(DYNAMIC_IMPORT.test('await import("@/lib/db-tenant")'));
  assert.ok(DYNAMIC_IMPORT.test('import("./db-tenant").then(m => m.db())'));
  // Forme lecite: non devono far scattare il test.
  assert.ok(!DYNAMIC_IMPORT.test('const t = require("./db-tenant");'));
  assert.ok(!DYNAMIC_IMPORT.test('import { withTenant } from "@/lib/db-tenant";'));
  assert.ok(!DYNAMIC_IMPORT.test('await import("@/lib/integrations/wazuh-sync")'));
});

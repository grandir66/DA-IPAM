import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SetupSchema } from "@/lib/validators";

/**
 * UI-17 — un'installazione è un cliente (decisione di Riccardo del 2026-10-12,
 * ADR 0004 e piano di miglioramento §2, punto 1). La pagina /setup non propone
 * più la scelta «Multi-Tenant (MSP)»: crea il cliente di questa installazione e
 * il suo amministratore.
 *
 * L'API invece accetta ancora `mode: "multi"`, ed è voluto: la chiama
 * Deploy-Appliance (`core/ipam-installer.sh`, funzione
 * `ipam_provision_superadmin`) con `"mode":"multi"` per creare il superadmin.
 * Togliere "multi" dallo schema romperebbe quell'installer senza che nessuna
 * prova di questo repo se ne accorga: per questo esiste la seconda prova. Si
 * toglie insieme al ramo dell'API quando l'installer passa a "single" (tappa 8
 * del piano). L'altro installer, `core/consolidated-installer.sh`, manda già
 * `"mode":"single"` con `codice_cliente` "DEFAULT".
 */

const PAGINA_SETUP = path.join(process.cwd(), "src/app/setup/page.tsx");

test("la pagina di setup non propone l'installazione Multi-Tenant (UI-17)", () => {
  const src = fs.readFileSync(PAGINA_SETUP, "utf8");
  assert.doesNotMatch(src, /multi-?tenant|\bMSP\b/i, "la pagina nomina ancora la modalità Multi-Tenant");
  assert.doesNotMatch(src, /["']multi["']/, "la pagina può ancora inviare mode \"multi\"");
  assert.match(src, /mode:\s*["']single["']/, "la pagina deve inviare mode \"single\"");
});

test("l'API accetta ancora mode \"multi\": la usa Deploy-Appliance core/ipam-installer.sh", () => {
  // Stesso corpo che manda ipam_provision_superadmin: niente codice cliente.
  const pw = "a".repeat(20);
  const r = SetupSchema.safeParse({ username: "admin", password: pw, confirm_password: pw, mode: "multi" });
  assert.equal(r.success, true, r.success ? "" : r.error.issues[0].message);
  if (r.success) assert.equal(r.data.mode, "multi");
});

test("senza mode il setup è per un cliente e chiede codice e ragione sociale", () => {
  const pw = "p".repeat(12);
  const base = { username: "admin", password: pw, confirm_password: pw };

  const senzaCliente = SetupSchema.safeParse(base);
  assert.equal(senzaCliente.success, false, "senza codice cliente il setup deve fermarsi");
  if (!senzaCliente.success) assert.match(senzaCliente.error.issues[0].message, /Codice cliente/);

  // Il corpo di consolidated-installer.sh, più il caso della pagina (mode omesso).
  for (const extra of [{ mode: "single" }, {}]) {
    const r = SetupSchema.safeParse({ ...base, ...extra, codice_cliente: "DEFAULT", ragione_sociale: "Appliance" });
    assert.equal(r.success, true, r.success ? "" : r.error.issues[0].message);
    if (r.success) assert.equal(r.data.mode, "single");
  }
});

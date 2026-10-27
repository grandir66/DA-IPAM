/**
 * Correzioni della revisione del 23/10, rilievo 6 (da sistemare PRIMA del merge): `age-encryption` è un modulo ESM
 * (con `@noble/*` che vuole Node >= 20.19) e `archivio.ts` lo importava in modo statico: l'avvio dell'app (jobs, backup,
 * layout, catalogo delle opzioni) lo raggiungeva anche a interruttori spenti, e su un Node 20.x più vecchio l'app non
 * partiva più. Ora si carica solo dentro le funzioni che lo usano (`await import(...)`).
 *
 * La prova gira in un processo figlio che rifiuta il caricamento di `age-encryption`, `kdbxweb` e `hash-wasm`
 * (`support/carica-avvio.ts`): se l'avvio li tocca, il figlio muore. La fase «controllo» prova che l'aggancio vede i
 * caricamenti veri (senza, la prova passerebbe per sempre).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/avvio-leggero.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function figlio(env: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", join(__dirname, "support", "carica-avvio.ts")], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DA_INVENT_DATA_DIR: mkdtempSync(join(tmpdir(), "da-vault-avvio-")),
      ENCRYPTION_KEY: "chiave-installazione-avvio",
      DA_VAULT_LOCALE: "",
      DA_VAULT_OPENBAO: "",
      CREDENTIALS_DIRECTORY: "",
      DA_VAULT_DIR: "",
      ...env,
    },
  });
}

function caricati(r: ReturnType<typeof figlio>): string[] {
  return (JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as { caricati: string[] }).caricati;
}

describe("l'avvio non carica i moduli pesanti del vault", () => {
  it("interruttori spenti: nessuno dei tre moduli viene caricato", () => {
    const r = figlio({});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(caricati(r), []);
  });

  it("vault locale acceso (archivio assente: bloccato): nemmeno allora", () => {
    const r = figlio({ DA_VAULT_LOCALE: "1" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(caricati(r), []);
  });

  it("controllo: creare un archivio carica age-encryption, e l'aggancio lo vede", () => {
    const r = figlio({ PROVA_FASE: "controllo" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(caricati(r), ["age-encryption"]);
  });
});

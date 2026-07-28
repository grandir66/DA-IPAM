// Simula l'artefatto KB ASSENTE (checkout incompleto, ambiente senza data/attribution-kb.sqlite):
// kbAvailable() deve tornare false e ogni lookup null, MAI un'eccezione.
//
// `node --test` isola ogni file `*.test.ts` nel proprio processo (default Node 22),
// quindi il `process.chdir()` qui sotto non ha effetto sugli altri file di test che
// girano nello stesso `npm test`. L'import di `../kb` è dinamico e avviene DOPO il
// chdir: kb.ts calcola il path dell'artefatto da `process.cwd()` al momento
// dell'import (import statici verrebbero eseguiti prima del nostro chdir per via
// dell'hoisting ESM, quindi qui serve `await import(...)`).
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

describe("kb.ts — artefatto assente", () => {
  const originalCwd = process.cwd();
  let tmpDir: string;
  let kb: typeof import("../kb");

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-missing-"));
    process.chdir(tmpDir); // niente data/attribution-kb.sqlite qui dentro
    kb = await import("../kb");
  });

  after(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("kbAvailable() === false", () => {
    assert.equal(kb.kbAvailable(), false);
  });

  it("kbVersion() === null", () => {
    assert.equal(kb.kbVersion(), null);
  });

  it("kbLookupMac() → null, nessuna eccezione", () => {
    assert.equal(kb.kbLookupMac("00:1B:C5:00:0A:BC"), null);
  });

  it("kbLookupSysObjectId() → null, nessuna eccezione", () => {
    assert.equal(kb.kbLookupSysObjectId("14988"), null);
  });
});

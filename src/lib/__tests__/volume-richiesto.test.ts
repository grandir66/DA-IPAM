/**
 * Volume cifrato delle appliance (piano di sicurezza, P0-3, 15/11/2026). Dove il volume è stato creato resta un
 * segno IN CHIARO accanto all'app (`.volume-cifrato`): se c'è, l'app parte solo con la cartella dati su un volume
 * cifrato. Senza questo freno, a volume chiuso l'app creerebbe un database vuoto sul disco in chiaro.
 *
 * Run: node --import tsx --test src/lib/__tests__/volume-richiesto.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlloVolume, SEGNO_VOLUME } from "../volume-richiesto";

const app = (): string => mkdtempSync(join(tmpdir(), "volume-richiesto-"));

describe("freno del volume cifrato all'avvio", () => {
  it("senza il segno non si controlla niente (installazioni com'erano)", () => {
    const esito = controlloVolume(app(), "/dati", () => { throw new Error("non va chiamato"); });
    assert.deepEqual(esito, { richiesto: false });
  });

  it("col segno e la cartella dati cifrata si parte", () => {
    const d = app();
    writeFileSync(join(d, SEGNO_VOLUME), "");
    const esito = controlloVolume(d, "/dati", () => ({ stato: "cifrato", come: "/dev/mapper/x (crypt)" }));
    assert.deepEqual(esito, { richiesto: true, ok: true, come: "/dev/mapper/x (crypt)" });
  });

  it("col segno e la cartella dati in chiaro (volume non montato) non si parte", () => {
    const d = app();
    writeFileSync(join(d, SEGNO_VOLUME), "");
    const esito = controlloVolume(d, "/dati", () => ({ stato: "in_chiaro", come: "/dev/sda1 (part)" }));
    assert.equal(esito.richiesto && !esito.ok && /in chiaro/.test(esito.messaggio), true);
  });

  it("col segno e un controllo che non sa rispondere non si parte", () => {
    const d = app();
    writeFileSync(join(d, SEGNO_VOLUME), "");
    const esito = controlloVolume(d, "/dati", () => ({ stato: "non_so", motivo: "lsblk non risponde" }));
    assert.equal(esito.richiesto && !esito.ok && /lsblk non risponde/.test(esito.messaggio), true);
  });
});

/**
 * Correzioni della revisione del 23/10, rilievo 14: lo stato del vault (`/api/vault/stato`) resta leggibile da tutti gli
 * utenti autenticati, quindi non deve contenere nomi di credenziali, clienti o voci: neppure quando DA-Link manda voci
 * illeggibili o non risponde oltre la cache. Il registro «chi ha visto cosa» è solo admin (guardia dichiarata in
 * `src/lib/permessi/rotte.ts`, provata dal censimento delle rotte).
 *
 * Contro il DA-Link finto col TLS vero (`support/dalink-finto.ts`).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/stato-senza-nomi.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { statoVault } from "../appliance";
import { DaLinkStore } from "../dalink";
import { statoVaultProcesso } from "../stato";
import { creaDaLinkFinto, type DaLinkFinto } from "./support/dalink-finto";

const ORA = 60 * 60_000;
let finto: DaLinkFinto | null = null;

afterEach(async () => {
  delete process.env.DA_VAULT_DALINK;
  statoVaultProcesso().remoto = null;
  await finto?.chiudi();
  finto = null;
});

describe("stato del vault per tutti gli autenticati", () => {
  it("con voci illeggibili o DA-Link giù oltre la cache non nomina clienti né voci", async () => {
    let adesso = Date.parse("2026-10-23T08:00:00Z");
    finto = await creaDaLinkFinto();
    finto.scriviDaFuori("clienti/acmesrl/da-ipam/firewall-storto-42", { password: "pw-stato-1" });
    const s = new DaLinkStore({ url: finto.url, gettone: finto.gettone, impronta: finto.impronta, ora: () => adesso });
    const orig = { warn: console.warn, error: console.error };
    console.warn = () => undefined;
    console.error = () => undefined;
    try {
      await s.aggiorna();
      statoVaultProcesso().remoto = s;
      process.env.DA_VAULT_DALINK = "1";
      // Un giro con la sola voce illeggibile: degradato, ma il motivo non nomina la voce.
      finto.forza = () => ({
        status: 200,
        body: JSON.stringify({ voci: { "clienti/acmesrl/da-ipam/firewall-storto-42": { valori: { password: "p" }, versione: "1" } } }),
      });
      await s.aggiorna().catch(() => undefined);
      const testo = JSON.stringify(statoVault());
      assert.match(testo, /DA-Link/);
      assert.doesNotMatch(testo, /acmesrl|storto|#42|pw-stato/i);
      // DA-Link giù oltre la cache: il motivo non nomina percorsi.
      finto.forza = null;
      finto.giu = true;
      adesso += 25 * ORA;
      await s.aggiorna().catch(() => undefined);
      const giu = JSON.stringify(statoVault());
      assert.match(giu, /"pronto":false/);
      assert.doesNotMatch(giu, /acmesrl|storto|clienti\//i);
    } finally {
      Object.assign(console, orig);
    }
  });
});

/**
 * Correzioni della revisione del 23/10, rilievo 14: lo stato del vault (`/api/vault/stato`) resta leggibile da tutti gli
 * utenti autenticati, quindi non deve contenere nomi di credenziali, clienti o voci: neppure quando un riferimento
 * malformato o un OpenBao che non risponde producono un messaggio. Il registro «chi ha visto cosa» è solo admin
 * (guardia dichiarata in `src/lib/permessi/rotte.ts`, provata dal censimento delle rotte).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/stato-senza-nomi.test.ts
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { statoVault } from "../appliance";
import { OpenBaoStore } from "../openbao";
import { statoVaultProcesso } from "../stato";
import { creaOpenBaoFinto } from "./support/openbao-finto";

const MIN = 60_000;

afterEach(() => {
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
});

describe("stato del vault per tutti gli autenticati", () => {
  it("con riferimenti malformati dice quanti, non quali (né di che cliente, né il nome della voce)", async () => {
    let adesso = Date.parse("2026-10-23T08:00:00Z");
    const finto = creaOpenBaoFinto({ ora: () => adesso });
    const s = new OpenBaoStore({
      url: finto.url,
      roleId: finto.roleId,
      secretId: () => finto.secretId,
      cartelle: [],
      percorsiExtra: () => [{ percorso: "CLIENTI/Storto//x", origine: "ACMESRL#42" }],
      fetch: finto.fetch,
      ora: () => adesso,
      durataCacheMs: 30 * MIN,
    });
    const orig = console.warn;
    console.warn = () => undefined;
    try {
      await s.aggiorna();
    } finally {
      console.warn = orig;
    }
    statoVaultProcesso().openbao = s;
    process.env.DA_VAULT_OPENBAO = "1";
    const testo = JSON.stringify(statoVault());
    assert.match(testo, /1 riferimenti|1 riferimento/);
    assert.doesNotMatch(testo, /ACMESRL|#42|Storto|CLIENTI/i);
    // OpenBao giù oltre la cache: il motivo non nomina percorsi.
    finto.giu = true;
    adesso += 40 * MIN;
    assert.doesNotMatch(JSON.stringify(statoVault()), /ACMESRL|#42|Storto|clienti\//i);
  });
});

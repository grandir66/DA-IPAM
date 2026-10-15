/**
 * PUT /api/credentials/[id]: cosa si scrive (tappa 1 credenziali, 15/10).
 *
 * Incidente: la pagina in modifica mandava `password: ""` e l'API la
 * trasformava in `encrypted_password = NULL`, cioè cancellava il segreto; la
 * stessa cosa per le chiavi SNMPv3. Vuoto o assente = non modificare.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/aggiornamenti-credenziale.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-aggiornamenti";

import { aggiornamentiCredenziale } from "../aggiornamenti";
import { safeDecrypt } from "@/lib/crypto";

describe("aggiornamentiCredenziale", () => {
  it("password, chiave di autenticazione e di privacy vuote → non si toccano", () => {
    const u = aggiornamentiCredenziale({ name: "x", password: "", auth_key: "", priv_key: "" }, {});
    assert.equal("encrypted_password" in u, false);
    assert.equal("encrypted_auth_key" in u, false);
    assert.equal("encrypted_priv_key" in u, false);
    assert.equal(u.name, "x");
  });

  it("password assente → non si tocca", () => {
    const u = aggiornamentiCredenziale({ name: "x" }, {});
    assert.equal("encrypted_password" in u, false);
  });

  it("password nuova → cifrata", () => {
    const u = aggiornamentiCredenziale({ password: "nuova" }, {});
    assert.equal(safeDecrypt(String(u.encrypted_password)), "nuova");
  });

  it("username presente → si aggiorna (la pagina lo manda precompilato)", () => {
    const u = aggiornamentiCredenziale({ username: "admin" }, {});
    assert.equal(safeDecrypt(String(u.encrypted_username)), "admin");
  });

  it("porta: presente nel corpo → aggiornata; null o vuota → torna standard; assente → non toccata", () => {
    assert.equal(aggiornamentiCredenziale({ port: 2022 }, { port: 2022 }).port, 2022);
    assert.equal(aggiornamentiCredenziale({ port: null }, { port: null }).port, null);
    assert.equal(aggiornamentiCredenziale({}, { port: "" }).port, null);
    assert.equal("port" in aggiornamentiCredenziale({ name: "x" }, { name: "x" }), false);
  });
});

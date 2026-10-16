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

import { aggiornamentiCredenziale, colonneNuovaCredenziale } from "../aggiornamenti";
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

  // T13 (16/10): le colonne della chiave SSH e il metodo d'accesso.
  it("chiave privata e passphrase vuote → non si toccano; nuove → cifrate", () => {
    const vuote = aggiornamentiCredenziale({ private_key: "", passphrase: "" }, {});
    assert.equal("encrypted_private_key" in vuote, false);
    assert.equal("encrypted_key_passphrase" in vuote, false);
    const u = aggiornamentiCredenziale({ private_key: "CHIAVE", passphrase: "frase" }, {});
    assert.equal(safeDecrypt(String(u.encrypted_private_key)), "CHIAVE");
    assert.equal(safeDecrypt(String(u.encrypted_key_passphrase)), "frase");
  });

  it("una chiave nuova senza passphrase toglie la passphrase vecchia (era della chiave vecchia)", () => {
    const u = aggiornamentiCredenziale({ private_key: "CHIAVE NUOVA" }, {});
    assert.equal(u.encrypted_key_passphrase, null);
  });

  it("solo la passphrase nuova → si scrive, la chiave resta", () => {
    const u = aggiornamentiCredenziale({ passphrase: "frase" }, {});
    assert.equal("encrypted_private_key" in u, false);
    assert.equal(safeDecrypt(String(u.encrypted_key_passphrase)), "frase");
  });

  it("metodo: presente → si scrive, null → torna al primo del tipo, assente → non si tocca", () => {
    assert.equal(aggiornamentiCredenziale({ auth_method: "chiave" }, {}).auth_method, "chiave");
    assert.equal(aggiornamentiCredenziale({ auth_method: null }, {}).auth_method, null);
    assert.equal("auth_method" in aggiornamentiCredenziale({ name: "x" }, {}), false);
  });
});

describe("colonneNuovaCredenziale (POST)", () => {
  it("i segreti cifrati nelle loro colonne, i vuoti come NULL, linux già normalizzato dal validatore", () => {
    const c = colonneNuovaCredenziale({
      name: "chiave",
      credential_type: "ssh",
      auth_method: "chiave",
      username: "root",
      password: "",
      private_key: "CHIAVE",
      passphrase: "frase",
      port: 2222,
    });
    assert.equal(c.name, "chiave");
    assert.equal(c.credential_type, "ssh");
    assert.equal(c.auth_method, "chiave");
    assert.equal(safeDecrypt(String(c.encrypted_username)), "root");
    assert.equal(c.encrypted_password, null);
    assert.equal(safeDecrypt(String(c.encrypted_private_key)), "CHIAVE");
    assert.equal(safeDecrypt(String(c.encrypted_key_passphrase)), "frase");
    assert.equal(c.port, 2222);
  });
});


import { test } from "node:test";
import assert from "node:assert/strict";
import { confermaConSecondaVerifica, confermaValida } from "../mostra";

// Piano di sicurezza 14/11, P0-1: la conferma per lo scarico di hub.db non dipende dagli interruttori del vault.
test("vault spento: la conferma per le password non c'è, quella per il backup arriva ai controlli sull'utente", () => {
  const prima = { l: process.env.DA_VAULT_LOCALE, d: process.env.DA_VAULT_DALINK };
  delete process.env.DA_VAULT_LOCALE;
  delete process.env.DA_VAULT_DALINK;
  try {
    const utente = { id: "0", nome: "servizio", ruolo: "admin" };
    const pw = confermaConSecondaVerifica({ utente, codice: "000000" });
    assert.ok(!pw.ok && pw.stato === 404);
    const bk = confermaConSecondaVerifica({ utente, codice: "000000", scopo: "backup" });
    assert.ok(!bk.ok && bk.stato === 403 && /utenza di servizio/.test(bk.errore), !bk.ok ? bk.errore : "");
    const nonAdmin = confermaConSecondaVerifica({ utente: { id: "5", nome: "x", ruolo: "viewer" }, codice: "000000", scopo: "backup" });
    assert.ok(!nonAdmin.ok && nonAdmin.stato === 403 && /scaricare il database/.test(nonAdmin.errore));
  } finally {
    if (prima.l !== undefined) process.env.DA_VAULT_LOCALE = prima.l;
    if (prima.d !== undefined) process.env.DA_VAULT_DALINK = prima.d;
  }
});

test("senza conferma lo scarico resta chiuso", () => {
  assert.equal(confermaValida("987654"), null);
});

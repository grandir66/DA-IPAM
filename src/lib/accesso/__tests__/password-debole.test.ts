/**
 * Password deboli rifiutate (piano di sicurezza 14/11). Prima bastavano 8 caratteri: «password», «12345678» o il
 * proprio nome utente passavano. Vale per la creazione di un utente, il cambio e la reimpostazione dalla pagina;
 * non per il primo avvio, che lo chiama anche l'installatore.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { motivoPasswordDebole } from "../password-debole";

test("le password più comuni, ripetute, in sequenza o uguali al nome sono rifiutate col motivo", () => {
  for (const p of ["password", "Password1", "12345678", "qwertyuiop", "aaaaaaaa", "abcdefgh", "admin123", "domarc123", "cambiami"]) {
    assert.ok(motivoPasswordDebole(p, "mario"), p);
  }
  assert.match(motivoPasswordDebole("corta", "mario") ?? "", /8 caratteri/);
  assert.match(motivoPasswordDebole("mario.rossi", "mario.rossi") ?? "", /nome utente/);
  assert.match(motivoPasswordDebole("Mario.Rossi1", "mario.rossi") ?? "", /nome utente/);
});

test("una password qualunque di buona lunghezza passa, senza regole di maiuscole o simboli", () => {
  for (const p of ["tavolo verde lampada", "k3Rm-vq8Z-x1Tp", "ilmiogattosichiamaugo", "Xy7!pQ2w"]) {
    assert.equal(motivoPasswordDebole(p, "mario"), null, p);
  }
});

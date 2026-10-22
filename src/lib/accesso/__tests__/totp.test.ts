/**
 * Codice TOTP della verifica in due passaggi (Riccardo, 20/10): RFC 6238 con SHA-1, 6 cifre,
 * passo di 30 secondi, come tutte le app Authenticator. Vettori dell'RFC (appendice B) ridotti
 * alle ultime 6 cifre. Un codice usato non vale una seconda volta.
 *
 * Run: node --import tsx --test src/lib/accesso/__tests__/totp.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { base32Codifica, base32Decodifica, codiceTotp, nuovoSegreto, uriOtpauth, verificaTotp } from "../totp";

// Il segreto dell'RFC 6238 per SHA-1: «12345678901234567890» in ASCII.
const SEGRETO_RFC = base32Codifica(Buffer.from("12345678901234567890", "ascii"));

test("vettori dell'RFC 6238 (SHA-1, 6 cifre)", () => {
  assert.equal(codiceTotp(SEGRETO_RFC, Math.floor(59 / 30)), "287082");
  assert.equal(codiceTotp(SEGRETO_RFC, Math.floor(1111111109 / 30)), "081804");
  assert.equal(codiceTotp(SEGRETO_RFC, Math.floor(1234567890 / 30)), "005924");
  assert.equal(codiceTotp(SEGRETO_RFC, Math.floor(2000000000 / 30)), "279037");
});

test("base32 avanti e indietro, con minuscole e spazi tollerati in lettura", () => {
  const b = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
  const s = base32Codifica(b);
  assert.match(s, /^[A-Z2-7]+$/);
  assert.deepEqual(base32Decodifica(s), b);
  assert.deepEqual(base32Decodifica(s.toLowerCase().replace(/(.{4})/g, "$1 ")), b);
});

test("nuovo segreto: 20 byte, 32 caratteri base32, ogni volta diverso", () => {
  const a = nuovoSegreto();
  assert.equal(a.length, 32);
  assert.equal(base32Decodifica(a).length, 20);
  assert.notEqual(a, nuovoSegreto());
});

test("finestra di un passo prima e dopo, non oltre", () => {
  const ora = 1_000_000 * 30_000; // passo 1.000.000 esatto
  const passo = 1_000_000;
  assert.equal(verificaTotp(SEGRETO_RFC, codiceTotp(SEGRETO_RFC, passo), ora, null), passo);
  assert.equal(verificaTotp(SEGRETO_RFC, codiceTotp(SEGRETO_RFC, passo - 1), ora, null), passo - 1);
  assert.equal(verificaTotp(SEGRETO_RFC, codiceTotp(SEGRETO_RFC, passo + 1), ora, null), passo + 1);
  assert.equal(verificaTotp(SEGRETO_RFC, codiceTotp(SEGRETO_RFC, passo - 2), ora, null), null);
  assert.equal(verificaTotp(SEGRETO_RFC, codiceTotp(SEGRETO_RFC, passo + 2), ora, null), null);
});

test("un codice già usato (o più vecchio dell'ultimo usato) non vale di nuovo", () => {
  const ora = 1_000_000 * 30_000;
  const codice = codiceTotp(SEGRETO_RFC, 1_000_000);
  assert.equal(verificaTotp(SEGRETO_RFC, codice, ora, 1_000_000), null);
  assert.equal(verificaTotp(SEGRETO_RFC, codiceTotp(SEGRETO_RFC, 999_999), ora, 1_000_000), null);
  assert.equal(verificaTotp(SEGRETO_RFC, codice, ora, 999_999), 1_000_000);
});

test("codici malformati: rifiutati senza eccezioni; spazi in mezzo tollerati", () => {
  const ora = 1_000_000 * 30_000;
  for (const c of ["", "12345", "1234567", "abcdef", "12 34", "-12345"]) {
    assert.equal(verificaTotp(SEGRETO_RFC, c, ora, null), null, c);
  }
  const giusto = codiceTotp(SEGRETO_RFC, 1_000_000);
  assert.equal(verificaTotp(SEGRETO_RFC, `${giusto.slice(0, 3)} ${giusto.slice(3)}`, ora, null), 1_000_000);
});

test("segreto rovinato: rifiuto, mai un'eccezione che faccia entrare", () => {
  assert.equal(verificaTotp("!!!non-base32!!!", "123456", Date.now(), null), null);
  assert.equal(verificaTotp("", "123456", Date.now(), null), null);
});

test("URI otpauth per le app: emittente, utente, segreto, parametri standard", () => {
  const u = uriOtpauth("JBSWY3DPEHPK3PXP", "mario rossi", "DA-IPAM");
  assert.equal(u, "otpauth://totp/DA-IPAM:mario%20rossi?secret=JBSWY3DPEHPK3PXP&issuer=DA-IPAM&algorithm=SHA1&digits=6&period=30");
});

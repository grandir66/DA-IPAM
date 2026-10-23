/**
 * da-vault, passo 10: `encrypt()`/`decrypt()` di `src/lib/crypto.ts` passano dalla chiave degli slot quando
 * l'interruttore `vault_locale` (DA_VAULT_LOCALE=1) è acceso e il vault è sbloccato; tutti gli `encrypt()` dell'app
 * (credenziali, integrazioni, profili edge, inventory-agent, network-services) passano da lì, nessuno escluso tranne
 * i segreti dell'accesso (TOTP), che restano sulla chiave d'installazione per poter entrare a sbloccare.
 *
 * Interruttore spento = bit per bit come oggi: si confronta con una copia del crypto.ts di prima (riferimento).
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/crypto-chiave.test.ts
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.ENCRYPTION_KEY = "chiave-installazione-di-prova";

import { encrypt, decrypt, safeDecrypt, cifraAccesso, decifraAccesso, cifraConChiave, decifraConChiave, decifraConInstallazione } from "@/lib/crypto";
import { chiudiVault, impostaChiaveDati, statoVaultProcesso } from "../stato";

// ── Riferimento: crypto.ts com'era prima del vault (v0.9.896), copiato riga per riga ──
function chiaveRif(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY non configurata in .env.local");
  return crypto.scryptSync(key, "da-ipam-salt", 32);
}
function encryptRif(plaintext: string): string {
  const key = chiaveRif();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}
function decryptRif(ciphertext: string): string {
  const key = chiaveRif();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) throw new Error("Formato crittografia non valido");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "hex"));
  decipher.setAuthTag(Buffer.from(parts[1], "hex"));
  let decrypted = decipher.update(parts[2], "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

const FORMATO = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/;
const CAMPIONI = ["", "public", "Pässwörd con spazi e accenti", "x".repeat(4096), "a:b:c", "🙂 unicode"];
const CHIAVE_DATI = crypto.randomBytes(32);

function messaggio(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "nessun errore";
}

beforeEach(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
});
afterEach(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
  process.env.ENCRYPTION_KEY = "chiave-installazione-di-prova";
});

describe("interruttore spento: bit per bit come oggi", () => {
  it("encrypt ha il formato di sempre e il riferimento lo decifra; decrypt legge il riferimento", () => {
    for (const s of CAMPIONI) {
      const c = encrypt(s);
      assert.match(c, FORMATO);
      assert.equal(decryptRif(c), s);
      assert.equal(decrypt(encryptRif(s)), s);
    }
  });

  it("anche con una chiave dei dati in memoria, spento vuol dire chiave d'installazione", () => {
    impostaChiaveDati(CHIAVE_DATI, "passphrase");
    const c = encrypt("valore");
    assert.equal(decryptRif(c), "valore");
  });

  it("stessi errori di prima: formato, chiave mancante, valore manomesso", () => {
    assert.equal(messaggio(() => decrypt("abc")), messaggio(() => decryptRif("abc")));
    const c = encryptRif("valore");
    const rotto = `${c.slice(0, -2)}${c.endsWith("00") ? "11" : "00"}`;
    assert.equal(messaggio(() => decrypt(rotto)), messaggio(() => decryptRif(rotto)));
    delete process.env.ENCRYPTION_KEY;
    assert.equal(messaggio(() => encrypt("x")), messaggio(() => encryptRif("x")));
    assert.equal(messaggio(() => decrypt(c)), messaggio(() => decryptRif(c)));
  });

  it("safeDecrypt: null su un valore rotto, come prima", () => {
    assert.equal(safeDecrypt("00:11:22"), null);
    assert.equal(safeDecrypt(encryptRif("ok")), "ok");
  });
});

describe("interruttore acceso, vault sbloccato", () => {
  beforeEach(() => {
    process.env.DA_VAULT_LOCALE = "1";
    impostaChiaveDati(CHIAVE_DATI, "tpm");
  });

  it("encrypt usa la chiave degli slot: stesso formato, il riferimento (ENCRYPTION_KEY) non lo apre", () => {
    const c = encrypt("community-di-prova");
    assert.match(c, FORMATO);
    assert.throws(() => decryptRif(c));
    assert.equal(decrypt(c), "community-di-prova");
    assert.equal(decifraConChiave(CHIAVE_DATI, c), "community-di-prova");
  });

  it("un valore ancora con ENCRYPTION_KEY (non ricifrato) si legge: ricifra a metà = archivio leggibile", () => {
    assert.equal(decrypt(encryptRif("vecchio")), "vecchio");
    assert.equal(safeDecrypt(encryptRif("vecchio")), "vecchio");
  });

  it("i segreti dell'accesso restano sulla chiave d'installazione", () => {
    const c = cifraAccesso("JBSWY3DPEHPK3PXP");
    assert.equal(decryptRif(c), "JBSWY3DPEHPK3PXP");
    assert.equal(decifraAccesso(c), "JBSWY3DPEHPK3PXP");
    assert.equal(decifraConInstallazione(c), "JBSWY3DPEHPK3PXP");
  });

  it("cifraConChiave/decifraConChiave: con una chiave sbagliata lanciano", () => {
    const c = cifraConChiave(CHIAVE_DATI, "x");
    assert.throws(() => decifraConChiave(crypto.randomBytes(32), c));
  });
});

describe("interruttore acceso, vault bloccato", () => {
  beforeEach(() => {
    process.env.DA_VAULT_LOCALE = "1";
    chiudiVault("Vault bloccato: serve la passphrase del cliente");
  });

  it("encrypt rifiuta: niente scritture con la chiave d'installazione dietro le spalle", () => {
    assert.match(messaggio(() => encrypt("nuovo")), /Vault bloccato/);
  });

  it("un valore della chiave degli slot non si legge; safeDecrypt dà null", () => {
    impostaChiaveDati(CHIAVE_DATI, "tpm");
    const c = encrypt("valore-slot");
    chiudiVault("bloccato per prova");
    assert.match(messaggio(() => decrypt(c)), /Vault bloccato/);
    assert.equal(safeDecrypt(c), null);
  });

  it("i segreti dell'accesso si leggono anche col vault bloccato (si entra per sbloccarlo)", () => {
    const c = cifraAccesso("JBSWY3DPEHPK3PXP");
    assert.equal(decifraAccesso(c), "JBSWY3DPEHPK3PXP");
  });

  it("lo stato del processo sta su globalThis (lo vedono server.ts e le rotte di Next)", () => {
    const s = statoVaultProcesso();
    const chiave = Symbol.for("da-ipam.vault.stato");
    assert.equal((globalThis as Record<symbol, unknown>)[chiave], s);
    assert.equal(s.chiaveDati, null);
  });
});

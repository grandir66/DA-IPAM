// src/lib/protocols/__tests__/snmpv3.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { buildV3Options, type SnmpV3CredentialRecord } from "../snmpv3";
import { AuthProtocols, PrivProtocols, SecurityLevel } from "net-snmp";

function cred(partial: Partial<SnmpV3CredentialRecord>): SnmpV3CredentialRecord {
  return {
    username: "monitor",
    securityLevel: "authPriv",
    authProtocol: "SHA",
    authKey: "authkey-secret-123",
    privProtocol: "AES",
    privKey: "privkey-secret-456",
    ...partial,
  };
}

describe("buildV3Options", () => {
  it("authPriv completo → ok con i protocolli mappati su net-snmp", () => {
    const r = buildV3Options(
      cred({ securityLevel: "authPriv", authProtocol: "SHA", authKey: "ak", privProtocol: "AES", privKey: "pk" })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.options.name, "monitor");
    assert.equal(r.options.level, SecurityLevel.authPriv);
    assert.equal(r.options.authProtocol, AuthProtocols.sha);
    assert.equal(r.options.authKey, "ak");
    assert.equal(r.options.privProtocol, PrivProtocols.aes);
    assert.equal(r.options.privKey, "pk");
  });

  it("authPriv con tutti i protocolli auth mappati correttamente", () => {
    const cases: Array<[string, number]> = [
      ["MD5", AuthProtocols.md5],
      ["SHA", AuthProtocols.sha],
      ["SHA224", AuthProtocols.sha224],
      ["SHA256", AuthProtocols.sha256],
      ["SHA384", AuthProtocols.sha384],
      ["SHA512", AuthProtocols.sha512],
    ];
    for (const [proto, expected] of cases) {
      const r = buildV3Options(cred({ securityLevel: "authNoPriv", authProtocol: proto, authKey: "ak" }));
      assert.equal(r.ok, true, `atteso ok per ${proto}`);
      if (r.ok) assert.equal(r.options.authProtocol, expected, `mapping errato per ${proto}`);
    }
  });

  it("authPriv con protocolli priv supportati mappati correttamente (DES/AES/AES256)", () => {
    const cases: Array<[string, number]> = [
      ["DES", PrivProtocols.des],
      ["AES", PrivProtocols.aes],
      ["AES256", PrivProtocols.aes256b],
    ];
    for (const [proto, expected] of cases) {
      const r = buildV3Options(cred({ securityLevel: "authPriv", privProtocol: proto }));
      assert.equal(r.ok, true, `atteso ok per ${proto}`);
      if (r.ok) assert.equal(r.options.privProtocol, expected, `mapping errato per ${proto}`);
    }
  });

  it("authPriv senza privKey → errore, nessuna sessione costruita", () => {
    const r = buildV3Options(cred({ securityLevel: "authPriv", privKey: undefined }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /chiave.*privacy|priv.*key/i);
  });

  it("authPriv senza privProtocol → errore", () => {
    const r = buildV3Options(cred({ securityLevel: "authPriv", privProtocol: undefined }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /protocollo.*privacy|priv/i);
  });

  it("authNoPriv corretto → ok, nessun campo priv nelle options", () => {
    const r = buildV3Options(
      cred({ securityLevel: "authNoPriv", authProtocol: "SHA256", authKey: "ak", privProtocol: undefined, privKey: undefined })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.options.level, SecurityLevel.authNoPriv);
    assert.equal(r.options.authProtocol, AuthProtocols.sha256);
    assert.equal(r.options.privProtocol, undefined);
    assert.equal(r.options.privKey, undefined);
  });

  it("authNoPriv senza authKey → errore", () => {
    const r = buildV3Options(cred({ securityLevel: "authNoPriv", authKey: undefined }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /chiave.*autenticazione|auth.*key/i);
  });

  it("authNoPriv senza authProtocol → errore", () => {
    const r = buildV3Options(cred({ securityLevel: "authNoPriv", authProtocol: undefined }));
    assert.equal(r.ok, false);
  });

  it("noAuthNoPriv → ok, nessuna chiave richiesta", () => {
    const r = buildV3Options(
      cred({ securityLevel: "noAuthNoPriv", authProtocol: undefined, authKey: undefined, privProtocol: undefined, privKey: undefined })
    );
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.options.name, "monitor");
    assert.equal(r.options.level, SecurityLevel.noAuthNoPriv);
    assert.equal(r.options.authProtocol, undefined);
    assert.equal(r.options.privProtocol, undefined);
  });

  it("username mancante → errore, prima di qualsiasi altro controllo", () => {
    const r = buildV3Options(cred({ username: "" }));
    assert.equal(r.ok, false);
  });

  it("security_level non riconosciuto → errore", () => {
    const r = buildV3Options(cred({ securityLevel: "bogusLevel" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /security_level|livello/i);
  });

  it("protocollo auth sconosciuto → errore", () => {
    const r = buildV3Options(cred({ securityLevel: "authNoPriv", authProtocol: "SHA9000", authKey: "ak" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /autenticazione/i);
  });

  it("protocollo priv sconosciuto → errore", () => {
    const r = buildV3Options(cred({ securityLevel: "authPriv", privProtocol: "ROT13" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /privacy/i);
  });

  it("protocollo priv AES192 (valore ammesso a DB ma non supportato dalla libreria) → errore", () => {
    const r = buildV3Options(cred({ securityLevel: "authPriv", privProtocol: "AES192" }));
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.error, /AES192|non supportat/i);
  });

  it("nessuna eccezione lanciata su input completamente vuoto/malformato", () => {
    assert.doesNotThrow(() => buildV3Options({ username: "", securityLevel: "" } as SnmpV3CredentialRecord));
  });

  it("le chiavi segrete non compaiono MAI in un oggetto di errore serializzato", () => {
    const secretAuth = "top-secret-auth-key-zzz";
    const secretPriv = "top-secret-priv-key-zzz";
    const results = [
      buildV3Options(cred({ securityLevel: "authPriv", authKey: secretAuth, privKey: undefined })),
      buildV3Options(cred({ securityLevel: "authPriv", privProtocol: "ROT13", authKey: secretAuth, privKey: secretPriv })),
      buildV3Options(cred({ securityLevel: "authNoPriv", authProtocol: "BOGUS", authKey: secretAuth })),
      buildV3Options(cred({ securityLevel: "bogus", authKey: secretAuth, privKey: secretPriv })),
    ];
    for (const r of results) {
      assert.equal(r.ok, false, "tutti questi casi devono fallire la validazione");
      const serialized = JSON.stringify(r);
      assert.ok(!serialized.includes(secretAuth), "authKey non deve comparire nell'errore serializzato");
      assert.ok(!serialized.includes(secretPriv), "privKey non deve comparire nell'errore serializzato");
    }
  });
});

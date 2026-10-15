/**
 * Regola unica tipo di credenziale ↔ protocollo (tappa 1 credenziali, 15/10).
 *
 * Prima c'erano cinque regole diverse: la promozione mostrava le «windows» per
 * SSH e nascondeva le «linux» (che la scansione SSH accetta), la tabella dei
 * binding offriva le «ssh» per WinRM (che la prova WinRM rifiuta). Qui la
 * tabella esatta, e il confronto con le funzioni che leggono davvero le
 * credenziali: la regola non deve proporre un tipo che poi verrebbe scartato.
 *
 * Run: node --import tsx --test src/lib/__tests__/credential-protocol-map.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-credential-protocol-map";

import { tipiCredenzialePerProtocollo, credTypeForProtocol } from "@/lib/credential-protocol-map";
import { encrypt } from "@/lib/crypto";
import {
  withTenant,
  getTenantDb,
  deleteTenantDatabase,
  getSshLinuxCredentialPair,
  getCredentialLoginPair,
  getCredentialCommunityString,
} from "@/lib/db-tenant";

describe("tipiCredenzialePerProtocollo — valori esatti", () => {
  const attesi: Array<[string | null | undefined, string[]]> = [
    ["ssh", ["ssh", "linux"]],
    ["winrm", ["windows"]],
    ["snmp_v2", ["snmp"]],
    ["snmp_v3", ["snmp"]],
    ["snmp", ["snmp"]],
    ["api", ["api", "ssh"]],
    ["redfish", ["api"]],
    ["onvif", ["api"]],
  ];
  for (const [protocollo, tipi] of attesi) {
    it(`${protocollo} → ${tipi.join(", ")}`, () => {
      assert.deepEqual(tipiCredenzialePerProtocollo(protocollo), tipi);
    });
  }

  it("credTypeForProtocol().allowedPrimary è la stessa regola", () => {
    for (const p of ["ssh", "winrm", "snmp_v2", "snmp_v3", "api"]) {
      assert.deepEqual(credTypeForProtocol(p).allowedPrimary, tipiCredenzialePerProtocollo(p), p);
    }
  });
});

const T = "TESTCREDPROTOMAP";
const TIPI = ["ssh", "linux", "windows", "api", "snmp"] as const;

describe("la regola contiene i tipi che le letture accettano davvero", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      TIPI.forEach((tipo, i) => {
        d.prepare(
          `INSERT OR REPLACE INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?, ?)`
        ).run(i + 1, `c-${tipo}`, tipo, encrypt("utente"), encrypt("segreto"));
      });
    });
  });
  after(() => deleteTenantDatabase(T));

  function accettati(lettura: (id: number) => unknown): string[] {
    return withTenant(T, () => TIPI.filter((_, i) => lettura(i + 1) != null));
  }

  it("SSH: gli stessi tipi di getSshLinuxCredentialPair", () => {
    assert.deepEqual([...accettati(getSshLinuxCredentialPair)].sort(), [...tipiCredenzialePerProtocollo("ssh")].sort());
  });

  it("WinRM: gli stessi tipi della prova WinRM (getCredentialLoginPair 'windows')", () => {
    assert.deepEqual(accettati((id) => getCredentialLoginPair(id, "windows")), tipiCredenzialePerProtocollo("winrm"));
  });

  it("SNMP: gli stessi tipi di getCredentialCommunityString", () => {
    assert.deepEqual(accettati(getCredentialCommunityString), tipiCredenzialePerProtocollo("snmp_v2"));
  });
});

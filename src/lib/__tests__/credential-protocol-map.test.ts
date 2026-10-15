/**
 * Regola unica tipo di credenziale ↔ protocollo (tappa 1 credenziali, 15/10).
 *
 * Prima c'erano cinque regole diverse: la promozione mostrava le «windows» per
 * SSH e nascondeva le «linux» (che la scansione SSH accetta), la tabella dei
 * binding offriva le «ssh» per WinRM (che la prova WinRM rifiuta). Qui la
 * tabella esatta, e il confronto con le funzioni che leggono davvero le
 * credenziali: la regola non deve proporre un tipo che poi verrebbe scartato.
 *
 * Tappa 2 (T2, 15/10): la regola sta in `credentials/tipi.ts`
 * (`tipiPerProtocollo`) e qui se ne verifica solo l'uso. SNMP ammette anche
 * `snmp_v3`, che il DB accetta dalla 2c: il confronto con le letture si fa sui
 * tipi che il DB può contenere oggi.
 *
 * Run: node --import tsx --test src/lib/__tests__/credential-protocol-map.test.ts
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

process.env.ENCRYPTION_KEY ||= "test-encryption-key-credential-protocol-map";

import { tipiCredenzialePerProtocollo, credTypeForProtocol, CRED_TYPE_OPTIONS } from "@/lib/credential-protocol-map";
import { ETICHETTE_TIPO, tipiPerProtocollo } from "@/lib/credentials/tipi";
import { CredentialSchema } from "@/lib/validators";
import { TENANT_SCHEMA_SQL } from "@/lib/db-tenant-schema";
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
    ["snmp_v2", ["snmp", "snmp_v3"]],
    ["snmp_v3", ["snmp", "snmp_v3"]],
    ["snmp", ["snmp", "snmp_v3"]],
    ["api", ["api", "ssh"]],
    ["redfish", ["api"]],
    ["onvif", ["api"]],
    [null, ["ssh", "windows", "api", "linux"]],
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

  it("è la regola di tipi.ts, non una copia", () => {
    for (const p of ["ssh", "winrm", "snmp", "snmp_v2", "snmp_v3", "api", "redfish", "onvif", "boh", null, undefined]) {
      assert.deepEqual(tipiCredenzialePerProtocollo(p), tipiPerProtocollo(p), String(p));
    }
  });
});

// Fino alla 2c il validatore (CredentialSchema) e il CHECK del DB accettano
// solo cinque tipi: un tipo nuovo nella creazione rapida darebbe 400 o 500.
describe("CRED_TYPE_OPTIONS — creazione rapida", () => {
  it("offre esattamente i tipi che il validatore accetta", () => {
    assert.deepEqual(
      CRED_TYPE_OPTIONS.map((o) => o.value).sort(),
      [...CredentialSchema.shape.credential_type.options].sort(),
    );
  });

  it("ogni tipo offerto entra nel DB (CHECK di credentials)", () => {
    const d = new Database(":memory:");
    try {
      d.exec(TENANT_SCHEMA_SQL);
      for (const o of CRED_TYPE_OPTIONS) {
        assert.doesNotThrow(
          () => d.prepare(`INSERT INTO credentials (name, credential_type) VALUES (?, ?)`).run(`c-${o.value}`, o.value),
          o.value,
        );
      }
    } finally {
      d.close();
    }
  });

  it("le etichette sono quelle per esteso, e «linux» non si confonde con SSH", () => {
    const etichetta = new Map(CRED_TYPE_OPTIONS.map((o) => [o.value, o.label]));
    assert.equal(etichetta.get("ssh"), ETICHETTE_TIPO.ssh);
    assert.equal(etichetta.get("snmp"), ETICHETTE_TIPO.snmp);
    assert.equal(etichetta.get("windows"), ETICHETTE_TIPO.windows);
    assert.equal(etichetta.get("api"), ETICHETTE_TIPO.api);
    assert.equal(new Set(CRED_TYPE_OPTIONS.map((o) => o.label)).size, CRED_TYPE_OPTIONS.length, "due voci con la stessa etichetta");
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

  it("SNMP: gli stessi tipi di getCredentialCommunityString (fra quelli che il DB accetta oggi)", () => {
    const ammessiOggi = tipiCredenzialePerProtocollo("snmp_v2").filter((t) => (TIPI as readonly string[]).includes(t));
    assert.deepEqual(accettati(getCredentialCommunityString), ammessiOggi);
  });
});

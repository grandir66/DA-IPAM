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

import { tipiCredenzialePerProtocollo, credTypeForProtocol, CRED_TYPE_OPTIONS, opzioniCreazioneRapida, tipoCreazioneRapida } from "@/lib/credential-protocol-map";
import { ETICHETTE_TIPO, TIPI_CREDENZIALE, tipiPerProtocollo } from "@/lib/credentials/tipi";
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

// Dalla 2c (T13, 16/10) la creazione rapida passa agli otto tipi d'archivio, e
// ogni tendina li filtra col protocollo dell'apparato: prima offriva sempre i
// cinque codici grezzi, e una voce UniFi, Omada o AD si sarebbe legata a un
// apparato.
describe("CRED_TYPE_OPTIONS — creazione rapida", () => {
  it("offre gli otto tipi d'archivio, e il validatore li accetta tutti", () => {
    assert.deepEqual(CRED_TYPE_OPTIONS.map((o) => o.value), [...TIPI_CREDENZIALE]);
    for (const o of CRED_TYPE_OPTIONS) {
      assert.equal(CredentialSchema.safeParse({ name: "x", credential_type: o.value }).success, true, o.value);
    }
  });

  it("ogni tipo offerto entra nel DB (niente CHECK sui tipi dalla 2c)", () => {
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

  it("le etichette sono quelle per esteso, tutte diverse", () => {
    for (const o of CRED_TYPE_OPTIONS) assert.equal(o.label, ETICHETTE_TIPO[o.value as keyof typeof ETICHETTE_TIPO], o.value);
    assert.equal(new Set(CRED_TYPE_OPTIONS.map((o) => o.label)).size, CRED_TYPE_OPTIONS.length, "due voci con la stessa etichetta");
  });

  it("per un apparato SSH non offre UniFi, Omada né AD", () => {
    const offerti = opzioniCreazioneRapida("ssh").map((o) => o.value);
    assert.deepEqual(offerti, ["ssh"]);
    for (const p of ["ssh", "winrm", "snmp_v2", "snmp_v3", "api", "redfish", "onvif", null]) {
      for (const vietato of ["unifi", "omada", "ad"]) {
        assert.equal(opzioniCreazioneRapida(p).some((o) => o.value === vietato), false, `${String(p)} offre ${vietato}`);
      }
    }
  });

  it("solo i tipi del protocollo, compilabili con utente e password (la v3 si crea dalla pagina Credenziali)", () => {
    assert.deepEqual(opzioniCreazioneRapida("winrm").map((o) => o.value), ["windows"]);
    assert.deepEqual(opzioniCreazioneRapida("api").map((o) => o.value), ["ssh", "api"]);
    assert.deepEqual(opzioniCreazioneRapida("snmp_v3").map((o) => o.value), ["snmp"]);
    assert.deepEqual(opzioniCreazioneRapida(null).map((o) => o.value), ["ssh", "windows", "api"]);
  });

  it("il tipo proposto è sempre fra quelli offerti", () => {
    for (const p of ["ssh", "winrm", "snmp_v2", "snmp_v3", "api", "redfish", "onvif", null]) {
      const proposto = tipoCreazioneRapida(p);
      assert.ok(opzioniCreazioneRapida(p).some((o) => o.value === proposto), `${String(p)} → ${proposto}`);
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

  it("SNMP: gli stessi tipi di getCredentialCommunityString (fra quelli che il DB accetta oggi)", () => {
    const ammessiOggi = tipiCredenzialePerProtocollo("snmp_v2").filter((t) => (TIPI as readonly string[]).includes(t));
    assert.deepEqual(accettati(getCredentialCommunityString), ammessiOggi);
  });
});

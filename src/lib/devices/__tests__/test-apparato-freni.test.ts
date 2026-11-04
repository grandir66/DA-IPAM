/**
 * Il «Test» di un apparato Windows passa dai freni (revisione finale, 04/11/2026).
 *
 * `GET /api/devices/[id]/test` e `POST /api/devices/test-provisional` erano fuori: ogni clic era la catena intera del bridge,
 * fino a quattro logon errati, e i pulsanti stanno anche nelle righe degli elenchi.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/test-apparato-freni.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { RicordoErrate } from "@/lib/scanner/account-windows";
import type { EsitoPassword } from "@/lib/scanner/verifica-password-run";
import { runProvisionalDeviceTest, testFaLogonWindows, type DipendenzeTestApparato } from "../device-connection-test";
import type { OpzioniWinrm } from "../winrm-run";

void TEST_DATA_DIR;
const T = "TESTAPPARATOFRENI";

function banco(verifica: EsitoPassword = "non_so", logonRiesce = false) {
  let logon = 0;
  let verifiche = 0;
  const opzioni: Array<number | OpzioniWinrm | undefined> = [];
  const deps: DipendenzeTestApparato = {
    ricordo: new RicordoErrate(),
    verificaPassword: async () => {
      verifiche += 1;
      return verifica;
    },
    winrm: async (_h, _p, _u, _pw, _c, _ps, _r, o) => {
      logon += 1;
      opzioni.push(o);
      if (logonRiesce) return "test";
      throw new Error("[AUTH_REJECTED] rifiutato");
    },
  };
  return { deps, opzioni, logon: () => logon, verifiche: () => verifiche };
}

let progressivo = 0;
function voce(utente: string): number {
  progressivo += 1;
  const id = 700 + progressivo;
  withTenant(T, () => {
    getTenantDb(T).prepare("INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, 'windows', ?, ?)").run(id, `voce ${id}`, encrypt(utente), encrypt("S3greta!"));
  });
  return id;
}

const prova = (id: number, deps: DipendenzeTestApparato) =>
  withTenant(T, () => runProvisionalDeviceTest({ host: "10.64.0.1", vendor: "windows", protocol: "winrm", credential_id: id }, deps));

describe("il Test di un apparato Windows", () => {
  before(() => {
    withTenant(T, () => undefined);
  });
  after(() => {
    deleteTenantDatabase(T);
    closeHubDb();
  });

  it("voce di dominio: 5 clic, 3 logon con un trasporto solo, dal quarto dice perché", async () => {
    const id = voce("CLIENTE\\apparato-limite");
    const b = banco();
    const esiti = [];
    for (let i = 0; i < 5; i++) esiti.push(await prova(id, b.deps));
    assert.equal(b.logon(), 3);
    assert.deepEqual(b.opzioni, [{ unSoloLogon: true }, { unSoloLogon: true }, { unSoloLogon: true }]);
    assert.equal(esiti[4].success, false);
    assert.match(esiti[4].error ?? "", /Troppe prove/);
  });

  it("il DC dice errata: nessun logon", async () => {
    const b = banco("errata");
    const r = await prova(voce("CLIENTE\\apparato-errata"), b.deps);
    assert.equal(b.logon(), 0);
    assert.equal(r.success, false);
    assert.match(r.error ?? "", /errata/i);
  });

  it("password verificata giusta: la catena intera", async () => {
    const b = banco("valida", true);
    const r = await prova(voce("CLIENTE\\apparato-valida"), b.deps);
    assert.deepEqual(b.opzioni, [undefined]);
    assert.equal(r.success, true);
  });

  it("account locale: nessun limite e nessuna verifica, come prima", async () => {
    const id = voce("amministratore");
    const b = banco();
    for (let i = 0; i < 5; i++) await prova(id, b.deps);
    assert.equal(b.logon(), 5);
    assert.equal(b.verifiche(), 0);
  });
});

describe("testFaLogonWindows, che decide requireAdmin nella GET", () => {
  const apparato = { device_type: "server", vendor: "windows", protocol: "winrm", scan_target: null, classification: null } as unknown as Parameters<typeof testFaLogonWindows>[0];

  it("un apparato Windows sì", () => {
    assert.equal(testFaLogonWindows(apparato), true);
  });

  it("uno switch SNMP no", () => {
    assert.equal(testFaLogonWindows({ ...apparato, device_type: "switch", vendor: "hp", protocol: "snmp_v2" }), false);
  });

  it("un router con ARP no, anche se `scan_target` dice windows: il test prende quell'altra strada", () => {
    assert.equal(testFaLogonWindows({ ...apparato, device_type: "router", vendor: "mikrotik", protocol: "ssh", scan_target: null }), false);
  });
});

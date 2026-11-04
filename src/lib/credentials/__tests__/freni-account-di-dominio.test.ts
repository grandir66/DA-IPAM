/**
 * L'utente nudo è di dominio quando c'è un realm: `winrm-bridge.py` fa `kinit utente@REALM` (revisione finale, 04/11/2026).
 *
 * Il freno guardava solo la forma dell'utente: `mario` con un realm passava come account locale, senza limite e senza
 * conto, e ogni clic e ogni host erano un logon vero sul DC. Il contrario valeva per WMI: un account locale consumava il
 * limite di 3 prove del dominio.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/freni-account-di-dominio.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { createAdIntegration, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { provaBinding } from "@/lib/devices/prova-binding";
import { WinrmError, type OpzioniWinrm } from "@/lib/devices/winrm-run";
import { WmiError } from "@/lib/devices/wmi-run";
import { RicordoErrate } from "@/lib/scanner/account-windows";
import { CredentialRunBudget } from "@/lib/scanner/credential-run-budget";
import { ContoLogonRicerca } from "../conto-logon-ricerca";
import { eAccountDiDominio } from "../freno-logon-windows";
import { esitoDellaRicerca, provaCredenzialeSuHost, trovaCredenziale } from "../trova";

void TEST_DATA_DIR;
const CON_REALM = "TESTDOMREALM";
const SENZA_AD = "TESTDOMLOCALE";
const PASSWORD = "S3greta!";

function banco() {
  let logon = 0;
  let verifiche = 0;
  const opzioni: Array<OpzioniWinrm | undefined> = [];
  return {
    logon: () => logon,
    verifiche: () => verifiche,
    opzioni,
    deps: {
      ricordo: new RicordoErrate(),
      verificaPassword: async () => {
        verifiche += 1;
        return "non_so" as const;
      },
      wmiIdentita: async () => {
        logon += 1;
        throw new WmiError({ code: "AUTH_REJECTED", message: "rpc_s_access_denied" });
      },
      winrm: async (...a: [string, number, string, string, string, boolean, string, OpzioniWinrm?]) => {
        logon += 1;
        opzioni.push(a[7]);
        throw new WinrmError({ code: "AUTH_REJECTED", message: "credentials were rejected" });
      },
    },
  };
}

const legame = (utente: string, protocollo: "wmi" | "winrm") => ({
  credential_id: null,
  inline_username: utente,
  inline_encrypted_password: encrypt(PASSWORD),
  protocol_type: protocollo,
  port: protocollo === "wmi" ? 135 : 5985,
});

let progressivo = 0;
function soloVoce(T: string, utente: string): number {
  progressivo += 1;
  const id = 300 + progressivo;
  withTenant(T, () => {
    const d = getTenantDb(T);
    d.prepare("DELETE FROM credentials WHERE credential_type = 'windows'").run();
    d.prepare("INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, 'windows', ?, ?)").run(id, `voce ${id}`, encrypt(utente), encrypt(PASSWORD));
  });
  return id;
}

describe("eAccountDiDominio", () => {
  it("la forma di dominio vale anche senza realm; il nudo solo con il realm", () => {
    assert.equal(eAccountDiDominio("CLIENTE\\mario", null), true);
    assert.equal(eAccountDiDominio("mario@cliente.local", null), true);
    assert.equal(eAccountDiDominio("mario", null), false);
    assert.equal(eAccountDiDominio("mario", "cliente.local"), true);
  });

  it("integrazione accesa senza dominio scritto: si frena lo stesso", () => {
    assert.equal(eAccountDiDominio("mario", ""), true);
  });

  it("`.\\mario` è locale senza realm; col realm il bridge fa comunque `kinit mario@REALM`", () => {
    assert.equal(eAccountDiDominio(".\\mario", null), false);
    assert.equal(eAccountDiDominio(".\\mario", "cliente.local"), true);
  });
});

describe("utente nudo con l'integrazione AD accesa", () => {
  before(() => {
    withTenant(CON_REALM, () => {
      const d = getTenantDb(CON_REALM);
      d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.62.0.0/24', 'prova')").run();
      for (let i = 1; i <= 6; i++) d.prepare("INSERT INTO hosts (id, network_id, ip) VALUES (?, 1, ?)").run(i, `10.62.0.${i}`);
      createAdIntegration({ name: "AD", dc_host: "10.62.0.250", domain: "cliente.local", base_dn: "DC=cliente,DC=local", encrypted_username: "x", encrypted_password: "y" });
    });
    withTenant(SENZA_AD, () => undefined);
  });
  after(() => {
    deleteTenantDatabase(CON_REALM);
    deleteTenantDatabase(SENZA_AD);
    closeHubDb();
  });

  it("pulsante Test: 5 clic, 3 logon, tutti con un trasporto solo", async () => {
    const id = soloVoce(CON_REALM, "nudo-test");
    const b = banco();
    for (let i = 0; i < 5; i++) await withTenant(CON_REALM, () => provaCredenzialeSuHost(getTenantDb(CON_REALM), id, "10.62.0.1", null, b.deps));
    assert.equal(b.logon(), 3);
    assert.deepEqual(b.opzioni, [{ unSoloLogon: true }, { unSoloLogon: true }, { unSoloLogon: true }]);
  });

  it("ricerca a richieste separate: il conto ferma l'utente nudo dopo 3 logon", async () => {
    soloVoce(CON_REALM, "nudo-ricerca");
    const b = banco();
    const conto = new ContoLogonRicerca();
    for (let hostId = 1; hostId <= 6; hostId++) {
      await withTenant(CON_REALM, async () => {
        const dbh = getTenantDb(CON_REALM);
        await trovaCredenziale(
          dbh,
          hostId,
          "winrm",
          5985,
          async (credentialId) => esitoDellaRicerca(await provaCredenzialeSuHost(dbh, credentialId, `10.62.0.${hostId}`, 5985, { ...b.deps, ricerca: true })),
          { budget: new CredentialRunBudget(() => undefined), conto },
        );
      });
    }
    assert.equal(b.logon(), 3);
  });

  for (const protocollo of ["winrm", "wmi"] as const) {
    it(`legame ${protocollo}: 5 clic, 3 logon`, async () => {
      const b = banco();
      for (let i = 0; i < 5; i++) await withTenant(CON_REALM, () => provaBinding("10.62.0.1", legame(`nudo-legame-${protocollo}`, protocollo), "1", b.deps));
      assert.equal(b.logon(), 3);
    });
  }

  it("legame WMI con un account locale, senza integrazione: nessun limite e nessuna verifica", async () => {
    const b = banco();
    for (let i = 0; i < 5; i++) await withTenant(SENZA_AD, () => provaBinding("10.62.0.1", legame("locale-wmi", "wmi"), "1", b.deps));
    assert.equal(b.logon(), 5);
    assert.equal(b.verifiche(), 0);
  });
});

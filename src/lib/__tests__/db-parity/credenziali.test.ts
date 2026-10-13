/**
 * Parità del dominio «credenziali» (NUC-2 gruppo 1b, T3-06).
 *
 * Le funzioni del dominio che avevano testo diverso nelle due copie (nomi di
 * variabili, prefisso dei log, a capo) sono confrontate con la copia congelata
 * della vecchia facciata: stesso valore restituito, stesse tabelle. Le altre
 * del dominio avevano lo stesso testo: per loro vale la prova d'identità
 * (`db-facade-als.test.ts`), perché la facciata ora riesporta la copia tenant.
 */
import { TEST_DATA_DIR } from "../support/data-dir-isolata";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as facciata from "@/lib/db";
import * as tenant from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import * as vecchia from "./gruppo1b/credenziali-vecchia-facciata";
import { APPARATO, CRED, HOST, RETE_SERVER, RETE_UFFICI, retiHostCredenziali, stessoEsito, stessoErrore } from "./gruppo1b/fixture";

after(() => {
  facciata.closeDb();
  tenant.closeAllTenantDbs();
  closeHubDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

const TABELLE = ["network_credentials", "network_host_credentials", "host_credentials", "device_credential_bindings"];
const ORA = ["validated_at", "last_attempt_at", "backoff_until", "tested_at", "created_at", "updated_at"];

test("replaceNetworkHostCredentials: stesso elenco per ruolo, doppioni tolti", () => {
  const e = stessoEsito({
    nome: "rnhc",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.replaceNetworkHostCredentials(RETE_UFFICI, "ssh", [CRED.sshBis, CRED.ssh, CRED.sshBis]),
    tenant: () => tenant.replaceNetworkHostCredentials(RETE_UFFICI, "ssh", [CRED.sshBis, CRED.ssh, CRED.sshBis]),
    funzioni: [vecchia.replaceNetworkHostCredentials, tenant.replaceNetworkHostCredentials],
    tabelle: TABELLE,
    colonneOra: ORA,
  });
  assert.equal(e.tabelleTenant.network_host_credentials.length, 2);
});

test("replaceNetworkHostCredentials: credenziale del tipo sbagliato, stesso errore", () => {
  stessoErrore({
    nome: "rnhcerr",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.replaceNetworkHostCredentials(RETE_UFFICI, "windows", [CRED.linux]),
    tenant: () => tenant.replaceNetworkHostCredentials(RETE_UFFICI, "windows", [CRED.linux]),
    funzioni: [vecchia.replaceNetworkHostCredentials, tenant.replaceNetworkHostCredentials],
    tabelle: TABELLE,
  });
});

test("replaceNetworkCredentials, addNetworkCredential, reorderNetworkCredentials", () => {
  stessoEsito({
    nome: "rnc",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.replaceNetworkCredentials(RETE_UFFICI, [CRED.linux, CRED.ssh, CRED.linux]),
    tenant: () => tenant.replaceNetworkCredentials(RETE_UFFICI, [CRED.linux, CRED.ssh, CRED.linux]),
    funzioni: [vecchia.replaceNetworkCredentials, tenant.replaceNetworkCredentials],
    tabelle: TABELLE,
  });
  for (const cred of [CRED.ssh, CRED.snmp]) {
    stessoEsito({
      nome: `anc${cred}`,
      fixture: retiHostCredenziali,
      facciata: () => vecchia.addNetworkCredential(RETE_SERVER, cred),
      tenant: () => tenant.addNetworkCredential(RETE_SERVER, cred),
      funzioni: [vecchia.addNetworkCredential, tenant.addNetworkCredential],
      tabelle: TABELLE,
    });
  }
  stessoEsito({
    nome: "ronc",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.reorderNetworkCredentials(RETE_UFFICI, [CRED.snmp, CRED.ssh]),
    tenant: () => tenant.reorderNetworkCredentials(RETE_UFFICI, [CRED.snmp, CRED.ssh]),
    funzioni: [vecchia.reorderNetworkCredentials, tenant.reorderNetworkCredentials],
    tabelle: TABELLE,
  });
});

test("copyNetworkCredentials: stesse righe copiate, stesso conteggio", () => {
  const e = stessoEsito({
    nome: "cnc",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.copyNetworkCredentials(RETE_UFFICI, RETE_SERVER),
    tenant: () => tenant.copyNetworkCredentials(RETE_UFFICI, RETE_SERVER),
    funzioni: [vecchia.copyNetworkCredentials, tenant.copyNetworkCredentials],
    tabelle: TABELLE,
  });
  assert.equal(e.valoreTenant, 1, "la rete server aveva già la SNMP: se ne copia una sola");
});

test("addHostCredential e setHostCredentialValidatedByKey: riga nuova e riga esistente", () => {
  for (const [nome, opzioni] of [["ahc1", { validated: true, auto_detected: true }], ["ahc2", undefined]] as const) {
    stessoEsito({
      nome,
      fixture: retiHostCredenziali,
      facciata: () => vecchia.addHostCredential(HOST.nas, CRED.ssh, "ssh", 22, opzioni),
      tenant: () => tenant.addHostCredential(HOST.nas, CRED.ssh, "ssh", 22, opzioni),
      funzioni: [vecchia.addHostCredential, tenant.addHostCredential],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
  }
  for (const [nome, host, cred, proto, porta] of [
    ["shcv1", HOST.pcAmmin, CRED.windows, "winrm", 5985],
    ["shcv2", HOST.srvDb, CRED.linux, "ssh", 22],
  ] as const) {
    stessoEsito({
      nome,
      fixture: retiHostCredenziali,
      facciata: () => vecchia.setHostCredentialValidatedByKey(host, cred, proto, porta, { auto_detected: true }),
      tenant: () => tenant.setHostCredentialValidatedByKey(host, cred, proto, porta, { auto_detected: true }),
      funzioni: [vecchia.setHostCredentialValidatedByKey, tenant.setHostCredentialValidatedByKey],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
  }
});

test("recordCredentialFailure: riga esistente (con l'associazione dell'apparato) e riga nuova", () => {
  const e = stessoEsito({
    nome: "rcf1",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.recordCredentialFailure(HOST.switchCore, CRED.snmp, "snmp", 161, "timeout"),
    tenant: () => tenant.recordCredentialFailure(HOST.switchCore, CRED.snmp, "snmp", 161, "timeout"),
    funzioni: [vecchia.recordCredentialFailure, tenant.recordCredentialFailure],
    tabelle: TABELLE,
    colonneOra: ORA,
  });
  const legame = (e.tabelleTenant.device_credential_bindings as Record<string, unknown>[]).find(
    (r) => r.device_id === APPARATO.switchCore && r.credential_id === CRED.snmp,
  );
  assert.equal(legame?.test_status, "failed", "il fallimento arriva all'associazione dell'apparato");
  stessoEsito({
    nome: "rcf2",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.recordCredentialFailure(HOST.srvDb, CRED.linux, "ssh", 22, "autenticazione rifiutata"),
    tenant: () => tenant.recordCredentialFailure(HOST.srvDb, CRED.linux, "ssh", 22, "autenticazione rifiutata"),
    funzioni: [vecchia.recordCredentialFailure, tenant.recordCredentialFailure],
    tabelle: TABELLE,
    colonneOra: ORA,
  });
});

test("recordCredentialSuccess: riga nuova e associazione dell'apparato aggiornata", () => {
  const e = stessoEsito({
    nome: "rcs",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.recordCredentialSuccess(HOST.switchCore, CRED.ssh, "ssh", 22),
    tenant: () => tenant.recordCredentialSuccess(HOST.switchCore, CRED.ssh, "ssh", 22),
    funzioni: [vecchia.recordCredentialSuccess, tenant.recordCredentialSuccess],
    tabelle: TABELLE,
    colonneOra: ORA,
  });
  const legame = (e.tabelleTenant.device_credential_bindings as Record<string, unknown>[]).find(
    (r) => r.device_id === APPARATO.switchCore && r.credential_id === CRED.ssh,
  );
  assert.equal(legame?.test_status, "success");
});

test("getCredentialCoverageByCategory: stessa copertura per categoria", () => {
  const e = stessoEsito({
    nome: "gccc",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.getCredentialCoverageByCategory(),
    tenant: () => tenant.getCredentialCoverageByCategory(),
    funzioni: [vecchia.getCredentialCoverageByCategory, tenant.getCredentialCoverageByCategory],
    tabelle: [],
  });
  assert.ok(e.valoreTenant.length >= 3, "la fixture copre almeno tre categorie");
});

test("addDeviceCredentialBinding e reorderDeviceCredentialBindings", () => {
  for (const [nome, input] of [
    ["adcb1", { device_id: APPARATO.router, credential_id: CRED.snmp, protocol_type: "snmp", port: 161 }],
    ["adcb2", { device_id: APPARATO.router, protocol_type: "api", port: 8728, sort_order: 5, inline_username: "u", inline_encrypted_password: "p", auto_detected: true }],
  ] as const) {
    stessoEsito({
      nome,
      fixture: retiHostCredenziali,
      facciata: () => vecchia.addDeviceCredentialBinding(input),
      tenant: () => tenant.addDeviceCredentialBinding(input),
      funzioni: [vecchia.addDeviceCredentialBinding, tenant.addDeviceCredentialBinding],
      tabelle: TABELLE,
      colonneOra: ORA,
    });
  }
  stessoEsito({
    nome: "rdcb",
    fixture: retiHostCredenziali,
    facciata: () => vecchia.reorderDeviceCredentialBindings(APPARATO.switchCore, [2, 1]),
    tenant: () => tenant.reorderDeviceCredentialBindings(APPARATO.switchCore, [2, 1]),
    funzioni: [vecchia.reorderDeviceCredentialBindings, tenant.reorderDeviceCredentialBindings],
    tabelle: TABELLE,
  });
});

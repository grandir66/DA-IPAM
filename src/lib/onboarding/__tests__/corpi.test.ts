/**
 * Corpi delle richieste del wizard per router e prima subnet (tappa 4
 * credenziali, 15/10).
 *
 * Perché: il router chiedeva utente, password e community in linea (binding
 * sull'apparato, fuori archivio); «Indietro» ignorava il router già creato e
 * un nuovo «Avanti» non lo modificava. Ora il router prende le voci
 * dell'archivio per id, e una modifica manda solo i campi toccati (il PUT
 * dell'apparato tocca ciò che riceve).
 *
 * Run: node --import tsx --test src/lib/onboarding/__tests__/corpi.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ROUTER_VUOTO,
  erroreRouter,
  corpoCreaRouter,
  corpoModificaRouter,
  corpoProvaRouter,
  moduloDaRouter,
  usaSnmpSeparato,
  credenzialeValidaPer,
  tipoPerNuovaVoce,
  livelloV3PerNuovaVoce,
  apparatoConStessoHost,
  corpoCreaRete,
  erroreRete,
  type ModuloRouter,
} from "../corpi";

const voci = [
  { id: 1, name: "SSH router", credential_type: "ssh", port: 2222 },
  { id: 2, name: "community", credential_type: "snmp", port: null },
  { id: 3, name: "Windows", credential_type: "windows", port: null },
];

const router = (r: Partial<ModuloRouter>): ModuloRouter => ({ ...ROUTER_VUOTO, ...r });

describe("router: controlli", () => {
  it("IP vuoto e router non ancora creato: il passo si salta, nessun errore", () => {
    assert.equal(erroreRouter(router({ host: " " }), false, voci), null);
  });

  it("IP vuoto con il router già creato: errore (non si toglie dal wizard)", () => {
    assert.match(erroreRouter(router({ host: "" }), true, voci) ?? "", /già registrato/);
  });

  it("senza credenziale, o con una che non vale per l'accesso scelto: errore", () => {
    assert.match(erroreRouter(router({ host: "10.0.0.1", protocol: "ssh" }), false, voci) ?? "", /credenziale/i);
    assert.match(erroreRouter(router({ host: "10.0.0.1", protocol: "ssh", credentialId: 2 }), false, voci) ?? "", /non vale/);
    assert.match(erroreRouter(router({ host: "10.0.0.1", protocol: "ssh", credentialId: 99 }), false, voci) ?? "", /credenziale/i);
    assert.equal(erroreRouter(router({ host: "10.0.0.1", protocol: "ssh", credentialId: 1 }), false, voci), null);
  });

  it("la voce SNMP per porte/LLDP dev'essere SNMP", () => {
    assert.match(
      erroreRouter(router({ host: "10.0.0.1", protocol: "ssh", credentialId: 1, snmpCredentialId: 3 }), false, voci) ?? "",
      /SNMP/,
    );
    assert.equal(erroreRouter(router({ host: "10.0.0.1", protocol: "ssh", credentialId: 1, snmpCredentialId: 2 }), false, voci), null);
  });

  it("una voce SNMP rimasta in memoria non conta se l'accesso è già SNMP (la tendina non c'è)", () => {
    assert.equal(usaSnmpSeparato("ssh"), true);
    assert.equal(usaSnmpSeparato("snmp_v2"), false);
    assert.equal(
      erroreRouter(router({ host: "10.0.0.1", protocol: "snmp_v2", credentialId: 2, snmpCredentialId: 3 }), false, voci),
      null,
    );
  });

  it("validità per protocollo e tipo della voce nuova dal «+ nuova nell'archivio»", () => {
    assert.equal(credenzialeValidaPer(2, voci, "snmp_v3"), true);
    assert.equal(credenzialeValidaPer(2, voci, "ssh"), false);
    assert.equal(credenzialeValidaPer(null, voci, "ssh"), false);
    assert.equal(tipoPerNuovaVoce("ssh"), "ssh");
    assert.equal(tipoPerNuovaVoce("snmp_v2"), "snmp");
    // Dalla 2c (T13) la v3 è un tipo d'archivio a sé.
    assert.equal(tipoPerNuovaVoce("snmp_v3"), "snmp_v3");
  });

  it("con accesso SNMP v3 la voce nuova parte già v3 (authPriv), non con la community", () => {
    assert.equal(livelloV3PerNuovaVoce("snmp_v3"), "authPriv");
    assert.equal(livelloV3PerNuovaVoce("snmp_v2"), "");
    assert.equal(livelloV3PerNuovaVoce("ssh"), "");
  });

  it("un apparato con lo stesso indirizzo si trova prima di crearne un doppione", () => {
    const apparati = [
      { id: 4, host: "192.168.1.1" },
      { id: 5, host: "Gw.Lan" },
    ];
    assert.equal(apparatoConStessoHost(apparati, " 192.168.1.1 ")?.id, 4);
    assert.equal(apparatoConStessoHost(apparati, "gw.lan")?.id, 5);
    assert.equal(apparatoConStessoHost(apparati, "192.168.1.10"), undefined);
    assert.equal(apparatoConStessoHost(apparati, " "), undefined);
  });
});

describe("router: corpi", () => {
  it("creazione: voci per id, niente utente/password/community in linea", () => {
    const c = corpoCreaRouter(router({ name: " ", host: " 10.0.0.1 ", vendor: "mikrotik", protocol: "ssh", credentialId: 1, snmpCredentialId: 2 }));
    assert.deepEqual(c, {
      name: "Router",
      host: "10.0.0.1",
      device_type: "router",
      vendor: "mikrotik",
      protocol: "ssh",
      credential_id: 1,
      snmp_credential_id: 2,
    });
    for (const k of ["username", "password", "community_string"]) assert.equal(k in c, false, k);
  });

  it("creazione con accesso SNMP: niente seconda voce SNMP", () => {
    const c = corpoCreaRouter(router({ host: "10.0.0.1", protocol: "snmp_v2", credentialId: 2, snmpCredentialId: 2 }));
    assert.equal("snmp_credential_id" in c, false);
  });

  it("modifica: solo i campi toccati; niente da mandare = corpo vuoto", () => {
    const prima = router({ name: "Router principale", host: "10.0.0.1", vendor: "mikrotik", protocol: "ssh", credentialId: 1, snmpCredentialId: null });
    assert.deepEqual(corpoModificaRouter(prima, { ...prima }), {});
    assert.deepEqual(corpoModificaRouter(prima, { ...prima, host: "10.0.0.254" }), { host: "10.0.0.254" });
    assert.deepEqual(corpoModificaRouter(prima, { ...prima, snmpCredentialId: 2 }), { snmp_credential_id: 2 });
    assert.deepEqual(corpoModificaRouter({ ...prima, snmpCredentialId: 2 }, { ...prima, snmpCredentialId: null }), { snmp_credential_id: null });
  });

  it("modifica: passando ad accesso SNMP la voce SNMP separata non si tocca", () => {
    const prima = router({ name: "R", host: "10.0.0.1", protocol: "ssh", credentialId: 1, snmpCredentialId: 2 });
    assert.deepEqual(corpoModificaRouter(prima, { ...prima, protocol: "snmp_v2", credentialId: 2, snmpCredentialId: null }), {
      protocol: "snmp_v2",
      credential_id: 2,
    });
  });

  it("dal router salvato al modulo", () => {
    assert.deepEqual(
      moduloDaRouter({ id: 3, name: "R", host: "10.0.0.1", vendor: "cisco", protocol: "snmp_v2", credential_id: 2, snmp_credential_id: null }),
      { name: "R", host: "10.0.0.1", vendor: "cisco", protocol: "snmp_v2", credentialId: 2, snmpCredentialId: null },
    );
  });

  it("prova di connessione: la porta propria della voce, come la userà la creazione", () => {
    assert.deepEqual(corpoProvaRouter(router({ host: "10.0.0.1", vendor: "mikrotik", protocol: "ssh", credentialId: 1, snmpCredentialId: 2 }), voci), {
      host: "10.0.0.1",
      vendor: "mikrotik",
      protocol: "ssh",
      credential_id: 1,
      snmp_credential_id: 2,
      port: 2222,
    });
    const snmp = corpoProvaRouter(router({ host: "10.0.0.1", protocol: "snmp_v2", credentialId: 2, snmpCredentialId: 2 }), voci);
    assert.equal(snmp.snmp_credential_id, null);
    assert.equal("port" in snmp, false);
  });
});

describe("prima subnet", () => {
  it("nome e CIDR obbligatori", () => {
    assert.match(erroreRete({ name: "LAN", cidr: " " }) ?? "", /CIDR/);
    assert.match(erroreRete({ name: "", cidr: "10.0.0.0/24" }) ?? "", /Nome/);
    assert.equal(erroreRete({ name: "LAN", cidr: "10.0.0.0/24" }), null);
  });

  it("corpo: lista nuova delle credenziali nell'ordine scelto, DNS del passo DNS se quello della rete è vuoto", () => {
    assert.deepEqual(
      corpoCreaRete({ name: " LAN ", cidr: " 10.0.0.0/24 ", gateway: "", dns: "", dnsPredefinito: "10.0.0.2", routerId: 4, credentialIds: [2, 1] }),
      {
        name: "LAN",
        cidr: "10.0.0.0/24",
        description: "",
        gateway: "",
        dns_server: "10.0.0.2",
        router_id: 4,
        credential_ids: [2, 1],
      },
    );
  });

  it("corpo: senza router né voci non si mandano", () => {
    const c = corpoCreaRete({ name: "LAN", cidr: "10.0.0.0/24", gateway: "10.0.0.1", dns: "", dnsPredefinito: "", routerId: null, credentialIds: [] });
    assert.equal("router_id" in c, false);
    assert.equal("credential_ids" in c, false);
    assert.equal(c.dns_server, null);
  });
});

/**
 * Le voci dell'archivio nel wizard (tappa 4 credenziali, 15/10): tipi offerti,
 * voci adatte a un protocollo, ordine predefinito delle prove sulla subnet.
 *
 * Perché: il wizard chiedeva SNMP, SSH, Windows e Linux in quattro blocchi
 * fissi (una voce per tipo) e al passo della subnet offriva solo quei quattro.
 * Ora i passi scelgono dall'archivio: tutte le voci, più di una per tipo, e i
 * tipi nuovi (sotto-tappe 2c/2f) devono comparire senza toccare il wizard.
 *
 * Run: node --import tsx --test src/lib/onboarding/__tests__/credenziali-wizard.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CRED_TYPE_OPTIONS } from "@/lib/credential-protocol-map";
import {
  tipiDelModulo,
  ordinePredefinito,
  vociPerProtocollo,
  vociSnmp,
  vociWindows,
  winrmPredefinita,
  riconciliaSceltaRete,
  spostaScelta,
  idsDaProvare,
  etichettaPorta,
  etichettaVoce,
} from "../credenziali-wizard";

const v = (id: number, credential_type: string, name = `voce ${id}`) => ({ id, name, credential_type });

describe("tipi offerti nel modulo del wizard", () => {
  it("i tipi che l'archivio accetta, con le etichette di tipi.ts e senza «linux» (è SSH)", () => {
    // Dalla 2c (T13) l'archivio accetta gli otto tipi, «snmp_v3» compreso:
    // «snmp» torna «SNMP v1/v2c» e la v3 è un tipo a sé.
    assert.deepEqual(tipiDelModulo(CRED_TYPE_OPTIONS.map((o) => o.value)), [
      { value: "ssh", label: "SSH (password o chiave)" },
      { value: "snmp", label: "SNMP v1/v2c" },
      { value: "snmp_v3", label: "SNMP v3" },
      { value: "windows", label: "Windows (WinRM e WMI)" },
      { value: "api", label: "API (token o utente)" },
      { value: "unifi", label: "Controller UniFi" },
      { value: "omada", label: "Controller Omada" },
      { value: "ad", label: "Active Directory" },
    ]);
  });

  it("un tipo nuovo accettato dall'archivio compare da solo, nell'ordine di tipi.ts", () => {
    const tipi = tipiDelModulo(["ssh", "snmp", "windows", "api", "linux", "unifi", "snmp_v3"]).map((o) => o.value);
    assert.deepEqual(tipi, ["ssh", "snmp", "snmp_v3", "windows", "api", "unifi"]);
  });

  it("quando l'archivio accetta «snmp_v3» il tipo «snmp» torna «SNMP v1/v2c»", () => {
    const tipi = tipiDelModulo(["ssh", "snmp", "snmp_v3"]);
    assert.deepEqual(tipi.map((o) => o.label), ["SSH (password o chiave)", "SNMP v1/v2c", "SNMP v3"]);
  });
});

describe("etichetta di una voce", () => {
  it("una voce «snmp» con il livello di sicurezza è una v3, senza è v1/v2c", () => {
    assert.equal(etichettaVoce({ credential_type: "snmp", security_level: "authPriv" }), "SNMP v3");
    assert.equal(etichettaVoce({ credential_type: "snmp", security_level: null }), "SNMP v1/v2c");
    assert.equal(etichettaVoce({ credential_type: "snmp" }), "SNMP v1/v2c");
  });

  it("gli altri tipi con l'etichetta di tipi.ts («linux» come SSH)", () => {
    assert.equal(etichettaVoce({ credential_type: "linux" }), "SSH (password o chiave)");
    assert.equal(etichettaVoce({ credential_type: "windows", security_level: null }), "Windows (WinRM e WMI)");
  });
});

describe("voci adatte a un protocollo (regola unica di tipi.ts)", () => {
  const voci = [v(1, "snmp"), v(2, "ssh"), v(3, "linux"), v(4, "windows"), v(5, "api"), v(6, "snmp_v3")];

  it("SSH: le ssh e le vecchie linux", () => {
    assert.deepEqual(vociPerProtocollo(voci, "ssh").map((x) => x.id), [2, 3]);
  });

  it("SNMP v2 e v3: le snmp e le snmp_v3, la versione la decide la voce", () => {
    assert.deepEqual(vociPerProtocollo(voci, "snmp_v2").map((x) => x.id), [1, 6]);
    assert.deepEqual(vociPerProtocollo(voci, "snmp_v3").map((x) => x.id), [1, 6]);
    assert.deepEqual(vociSnmp(voci).map((x) => x.id), [1, 6]);
  });

  it("WinRM (credenziale dell'AD): solo le Windows", () => {
    assert.deepEqual(vociWindows(voci).map((x) => x.id), [4]);
  });

  it("WinRM predefinita: solo se la voce Windows è una, altrimenti si sceglie", () => {
    assert.equal(winrmPredefinita(voci), 4);
    assert.equal(winrmPredefinita([...voci, v(9, "windows")]), null);
    assert.equal(winrmPredefinita([v(1, "snmp")]), null);
  });
});

describe("ordine predefinito delle prove sulla subnet", () => {
  it("SNMP, poi SSH, poi Windows, poi le altre; a parità di gruppo l'ordine dell'archivio", () => {
    const voci = [v(1, "api"), v(2, "windows"), v(3, "ssh"), v(4, "snmp"), v(5, "linux"), v(6, "snmp_v3"), v(7, "unifi")];
    assert.deepEqual(ordinePredefinito(voci).map((x) => x.id), [4, 6, 3, 5, 2, 1, 7]);
  });

  it("prima scelta: tutte le voci, tutte spuntate", () => {
    const voci = [v(1, "windows"), v(2, "snmp")];
    assert.deepEqual(riconciliaSceltaRete(null, voci), [
      { id: 2, attiva: true },
      { id: 1, attiva: true },
    ]);
  });

  it("una voce aggiunta dopo si accoda spuntata, una eliminata sparisce, il resto resta com'era", () => {
    const scelta = [
      { id: 1, attiva: true },
      { id: 2, attiva: false },
      { id: 3, attiva: true },
    ];
    const voci = [v(1, "windows"), v(3, "ssh"), v(8, "snmp"), v(9, "api")];
    assert.deepEqual(riconciliaSceltaRete(scelta, voci), [
      { id: 1, attiva: true },
      { id: 3, attiva: true },
      { id: 8, attiva: true },
      { id: 9, attiva: true },
    ]);
  });

  it("frecce: si scambia col vicino, ai bordi non cambia niente", () => {
    const s = [
      { id: 1, attiva: true },
      { id: 2, attiva: true },
      { id: 3, attiva: false },
    ];
    assert.deepEqual(spostaScelta(s, 2, -1).map((x) => x.id), [1, 3, 2]);
    assert.deepEqual(spostaScelta(s, 0, 1).map((x) => x.id), [2, 1, 3]);
    assert.deepEqual(spostaScelta(s, 0, -1), s);
    assert.deepEqual(spostaScelta(s, 2, 1), s);
  });

  it("gli id da mandare: solo le spuntate, nell'ordine scelto", () => {
    assert.deepEqual(
      idsDaProvare([
        { id: 5, attiva: true },
        { id: 2, attiva: false },
        { id: 7, attiva: true },
      ]),
      [5, 7],
    );
  });
});

describe("colonne della tabella", () => {
  it("porta: «std» se è quella standard", () => {
    assert.equal(etichettaPorta(null), "std");
    assert.equal(etichettaPorta(2222), "2222");
  });
});

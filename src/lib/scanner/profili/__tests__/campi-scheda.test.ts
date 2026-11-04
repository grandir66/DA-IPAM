/**
 * Tabella dei rilievi della scheda (Riccardo, 04/11/2026: «in tabella, i campi
 * significativi»). Modulo puro: righe finte, nessun database.
 *
 * Run: node --import tsx --test src/lib/scanner/profili/__tests__/campi-scheda.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { campiDaRilievi, type RigaRilievo } from "../campi-scheda";

const riga = (p: Partial<RigaRilievo> & { script: string }): RigaRilievo => ({
  profilo: "approfondito",
  porta: null,
  protocollo: null,
  elems: {},
  output: null,
  at: "2026-11-04 10:00:00",
  ...p,
});

describe("campiDaRilievi", () => {
  it("un s7-info diventa le righe seriale, modello, firmware, produttore", () => {
    const t = campiDaRilievi([
      riga({
        script: "s7-info",
        porta: 102,
        protocollo: "tcp",
        profilo: "iot_ot",
        elems: { Module: "6ES7 315-2EH14-0AB0", "Serial Number": "S C-C2UR28922012", Version: "3.2.6", "Module Name": "PLC-LINEA1" },
      }),
    ]);
    const per = new Map(t.campi.map((c) => [c.campo, c.valore]));
    assert.equal(per.get("seriale"), "S C-C2UR28922012");
    assert.equal(per.get("modello"), "6ES7 315-2EH14-0AB0");
    assert.equal(per.get("firmware"), "3.2.6");
    assert.equal(per.get("produttore"), "Siemens");
    assert.equal(per.get("protocolloOt"), "s7");
    assert.equal(per.get("hostname"), "PLC-LINEA1");
    assert.equal(t.senzaCampi.length, 0);
    assert.equal(t.totale, 1);
    assert.equal(t.ultimoAt, "2026-11-04 10:00:00");
    // La fonte dice dove è stato letto: serve alla colonna «Letto da».
    const seriale = t.campi.find((c) => c.campo === "seriale")!;
    assert.deepEqual(
      { script: seriale.fonti[0].script, porta: seriale.fonti[0].porta, protocollo: seriale.fonti[0].protocollo },
      { script: "s7-info", porta: 102, protocollo: "tcp" }
    );
  });

  it("l'ordine delle righe è quello dichiarato: prima l'identità dell'apparato", () => {
    const t = campiDaRilievi([
      riga({ script: "http-title", porta: 80, protocollo: "tcp", elems: { title: "Pannello" } }),
      riga({ script: "enip-info", porta: 44818, protocollo: "tcp", elems: { "Serial Number": "0x60c12345", "Product Name": "1756-L71" } }),
    ]);
    // `enip-info` qui non porta il Vendor: un campo che lo script non ha detto non compare (nessun «—» inventato).
    assert.deepEqual(t.campi.map((c) => c.campo), ["seriale", "modello", "protocolloOt", "titoloWeb"]);
    // Il seriale esadecimale resta la stringa: `parseTagValue: false` nel parser, qui si controlla che nessuno lo converta.
    assert.equal(t.campi[0].valore, "0x60c12345");
  });

  it("due script che dicono lo stesso nome host fanno UNA riga con due fonti, la più affidabile prima", () => {
    const t = campiDaRilievi([
      riga({ script: "ssl-cert", porta: 443, protocollo: "tcp", elems: { "subject.commonName": "SRV01" } }),
      riga({ script: "rdp-ntlm-info", porta: 3389, protocollo: "tcp", elems: { DNS_Computer_Name: "srv01" } }),
    ]);
    const hostname = t.campi.filter((c) => c.campo === "hostname");
    assert.equal(hostname.length, 1, "un valore uguale a meno di maiuscole non fa due righe");
    assert.deepEqual(hostname[0].fonti.map((f) => f.script), ["rdp-ntlm-info", "ssl-cert"]);
  });

  it("due valori diversi dello stesso campo restano due righe: la scheda non scegli al posto di chi guarda", () => {
    const t = campiDaRilievi([
      riga({ script: "ssl-cert", porta: 443, protocollo: "tcp", elems: { "subject.commonName": "vecchio" } }),
      riga({ script: "rdp-ntlm-info", porta: 3389, protocollo: "tcp", elems: { DNS_Computer_Name: "nuovo" } }),
    ]);
    assert.deepEqual(t.campi.filter((c) => c.campo === "hostname").map((c) => c.valore), ["nuovo", "vecchio"]);
  });

  it("uno script che non dà campi si dichiara, non si nasconde", () => {
    const t = campiDaRilievi([
      riga({ script: "mqtt-subscribe", porta: 1883, protocollo: "tcp", profilo: "iot_ot", output: "topic: casa/luce" }),
      riga({ script: "rpcinfo", porta: 111, protocollo: "tcp", output: "program version" }),
    ]);
    // mqtt-subscribe dà il protocollo; rpcinfo non è letto da nessuna regola.
    assert.deepEqual(t.campi.map((c) => c.campo), ["protocolloOt"]);
    assert.deepEqual(t.senzaCampi.map((f) => f.script), ["rpcinfo"]);
  });

  it("le impronte SSH diventano una riga per chiave", () => {
    const t = campiDaRilievi([
      riga({ script: "ssh-hostkey", porta: 22, protocollo: "tcp", elems: { "0.fingerprint": "aa:bb", "1.fingerprint": "cc:dd" } }),
    ]);
    assert.deepEqual(t.campi.map((c) => c.valore), ["aa:bb", "cc:dd"]);
    assert.equal(t.campi[0].etichetta, "Impronta chiave SSH");
  });

  it("senza rilievi la tabella è vuota e lo dice", () => {
    const t = campiDaRilievi([]);
    assert.deepEqual(t, { campi: [], senzaCampi: [], totale: 0, ultimoAt: null });
  });

  it("l'ultimo rilievo è la data più recente, non la prima riga", () => {
    const t = campiDaRilievi([
      riga({ script: "http-title", elems: { title: "x" }, at: "2026-11-04 10:00:00" }),
      riga({ script: "ssl-cert", elems: { "subject.organizationName": "ACME" }, at: "2026-11-04 18:30:00" }),
    ]);
    assert.equal(t.ultimoAt, "2026-11-04 18:30:00");
  });
});

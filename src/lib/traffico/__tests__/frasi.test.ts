import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TIPI_ANOMALIA } from "../anomalie";
import { fraseAnomalia, formattaByte, macAnomalia, NOME_TIPO, protoPorta, TIPI } from "../frasi";

describe("parole dell'interfaccia del traffico", () => {
  it("ogni tipo di anomalia ha un nome e una frase (un tipo nuovo in anomalie.ts non resta muto)", () => {
    assert.deepEqual([...TIPI].sort(), [...TIPI_ANOMALIA].sort());
    for (const t of TIPI_ANOMALIA) {
      assert.ok(NOME_TIPO[t].length > 0, t);
      assert.ok(fraseAnomalia({ tipo: t, client: "10.0.0.1", server: "10.0.0.2", dettaglio: {} }).length > 0, t);
    }
  });
  it("l'impianto che parla fuori ha la sua frase; il volume dice quanto e quanto di solito", () => {
    assert.match(fraseAnomalia({ tipo: "impianto", client: "10.0.0.1", server: "esterno", dettaglio: {} }), /esterno/);
    assert.equal(fraseAnomalia({ tipo: "volume", client: "10.0.0.1", server: "", dettaglio: { byte: 2 * 1024 ** 3, mediana: 100 * 1024 ** 2 } }), "2,0 GB in un giorno, di solito 100 MB");
  });
  it("porta e byte come si leggono", () => {
    assert.equal(protoPorta(6, 502), "tcp/502");
    assert.equal(protoPorta(0, 23), "23");
    assert.equal(protoPorta(0, 0), "—");
    assert.equal(formattaByte(900), "900 B");
  });
});

describe("i MAC negli avvisi delle identità", () => {
  it("IP doppio e MAC cambiato li mostrano; gli altri tipi e i dettagli storti no", () => {
    assert.equal(macAnomalia({ tipo: "ip_doppio", dettaglio: { mac_a: "aa:aa:aa:aa:aa:01", mac_b: "aa:aa:aa:aa:aa:02", quanti: 3 } }), "AA:AA:AA:AA:AA:01 e AA:AA:AA:AA:AA:02 e altri 1");
    assert.equal(macAnomalia({ tipo: "mac_cambiato", dettaglio: { prima: "aa:aa:aa:aa:aa:01", ora: "aa:aa:aa:aa:aa:02" } }), "prima AA:AA:AA:AA:AA:01, ora AA:AA:AA:AA:AA:02");
    assert.equal(macAnomalia({ tipo: "mac_cambiato", dettaglio: { prima: "<script>", ora: "aa:aa:aa:aa:aa:02" } }), null);
    assert.equal(macAnomalia({ tipo: "volume", dettaglio: { prima: "aa:aa:aa:aa:aa:01", ora: "aa:aa:aa:aa:aa:02" } }), null);
  });
});

describe("sonda avanzata (23/11)", () => {
  it("certificato non verificabile, password SSH provate, iniezione SQL", () => {
    assert.equal(fraseAnomalia({ tipo: "tls_certificato", client: "", server: "10.0.0.2", dettaglio: { motivo: "non_valido" } }), "Servizio con certificato non verificabile");
    assert.equal(fraseAnomalia({ tipo: "tls_certificato", client: "", server: "10.0.0.2", dettaglio: { motivo: "autofirmato" } }), "Servizio con certificato autofirmato");
    assert.match(fraseAnomalia({ tipo: "password_ssh_provate", client: "10.0.0.1", server: "", dettaglio: { connessioni: 30 } }), /30 tentativi/);
    assert.equal(fraseAnomalia({ tipo: "sql_injection", client: "10.0.0.1", server: "10.0.0.2", dettaglio: {} }), "Manda richieste web con un'iniezione SQL");
  });
});

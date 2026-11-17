/**
 * Comandi DNS di Windows: si compongono solo da valori convalidati. Qui i valori ostili, i
 * record di dominio e dei controller di dominio, e le forme della risposta del DC.
 *
 * Run: node --import tsx --test src/lib/ad/dns/__tests__/comandi.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { comandoLeggi, comandoPasso, convalidaPasso, leggiEsitoPasso, leggiRisposta, type AmmessiDns } from "../comandi";
import type { PassoDns } from "../correzioni";

const AMMESSI: AmmessiDns = {
  zone: new Set(["esempio.local", "4.168.192.in-addr.arpa", "_msdcs.esempio.local"]),
  nomiDc: new Set(["dc01"]),
  ipDc: new Set(["192.168.4.2"]),
};
const A = (nome: string, dato = "192.168.4.10", azione: PassoDns["azione"] = "aggiungi"): PassoDns => ({ azione, zona: "esempio.local", nome, tipo: "A", dato });
const PTR = (nome: string, dato = "pc-01.esempio.local", azione: PassoDns["azione"] = "aggiungi"): PassoDns => ({ azione, zona: "4.168.192.in-addr.arpa", nome, tipo: "PTR", dato });
const rifiutato = (p: PassoDns) => convalidaPasso(p, AMMESSI).ok === false;

describe("convalidaPasso", () => {
  it("un A, un PTR e un CNAME normali passano", () => {
    assert.deepEqual(convalidaPasso(A("pc-01"), AMMESSI), { ok: true });
    assert.deepEqual(convalidaPasso(PTR("10"), AMMESSI), { ok: true });
    assert.deepEqual(convalidaPasso({ azione: "togli", zona: "esempio.local", nome: "www", tipo: "CNAME", dato: "sparito.esempio.local" }, AMMESSI), { ok: true });
  });

  it("valori ostili nel nome: rifiutati, non puliti", () => {
    for (const nome of ["pc'; Remove-Item C:\\ -Recurse; '", "pc;calc", "pc$(whoami)", "pc 01", "pc..01", "pc`n", "pc|x", "", "-pc", "pc-", "PC-01", "a".repeat(64)]) {
      assert.equal(rifiutato(A(nome)), true, JSON.stringify(nome));
    }
  });

  it("valori ostili nel dato", () => {
    for (const ip of ["192.168.4.10'; x", "192.168.4", "192.168.4.256", "192.168.04.10", "1.2.3.4.5", "pc-01"]) assert.equal(rifiutato(A("pc-01", ip)), true, ip);
    for (const nome of ["pc'01.esempio.local", "pc 01.esempio.local", "pc;.esempio.local", ""]) assert.equal(rifiutato(PTR("10", nome)), true, nome);
  });

  it("zona non in archivio, zona di dominio, record di dominio", () => {
    assert.equal(rifiutato({ ...A("pc-01"), zona: "altra.local" }), true);
    assert.equal(rifiutato({ ...A("pc-01"), zona: "_msdcs.esempio.local" }), true);
    assert.equal(rifiutato(A("@")), true);
    assert.equal(rifiutato(A("_ldap._tcp")), true);
    assert.equal(rifiutato({ ...A("pc-01"), tipo: "SRV" as PassoDns["tipo"] }), true);
    assert.equal(rifiutato({ ...A("pc-01"), azione: "cambia" as PassoDns["azione"] }), true);
  });

  it("tipo e zona devono andare d'accordo", () => {
    assert.equal(rifiutato({ ...A("pc-01"), zona: "4.168.192.in-addr.arpa" }), true);
    assert.equal(rifiutato({ ...PTR("10"), zona: "esempio.local" }), true);
    assert.equal(rifiutato(PTR("gateway")), true);
  });

  it("i record di un controller di dominio non si toccano: per nome, per IP, per reverse", () => {
    assert.equal(rifiutato(A("dc01", "192.168.4.99")), true);
    assert.equal(rifiutato(A("altro", "192.168.4.2")), true);
    assert.equal(rifiutato(PTR("2", "qualcosa.esempio.local")), true);
    assert.equal(rifiutato(PTR("99", "dc01.esempio.local")), true);
    assert.equal(rifiutato({ azione: "aggiungi", zona: "esempio.local", nome: "alias", tipo: "CNAME", dato: "dc01.esempio.local" }), true);
  });
});

describe("comandi", () => {
  it("aggiungi A, PTR, CNAME", () => {
    assert.equal(comandoPasso(A("pc-01")),
      "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; try { Add-DnsServerResourceRecordA -ZoneName 'esempio.local' -Name 'pc-01' -IPv4Address '192.168.4.10'; 'ESITO_OK' } catch { 'ESITO_ERRORE: ' + $_.Exception.Message }");
    assert.match(comandoPasso(PTR("10")), /Add-DnsServerResourceRecordPtr -ZoneName '4\.168\.192\.in-addr\.arpa' -Name '10' -PtrDomainName 'pc-01\.esempio\.local'; 'ESITO_OK'/);
    assert.match(comandoPasso({ azione: "aggiungi", zona: "esempio.local", nome: "www", tipo: "CNAME", dato: "srv.esempio.local" }), /Add-DnsServerResourceRecordCName -ZoneName 'esempio\.local' -Name 'www' -HostNameAlias 'srv\.esempio\.local'/);
  });

  it("togli: rilegge il nodo, vuole un record solo, toglie quello", () => {
    assert.equal(comandoPasso(PTR("10", "vecchio.esempio.local", "togli")),
      "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; try { "
      + "$r = @(@(Get-DnsServerResourceRecord -ZoneName '4.168.192.in-addr.arpa' -Name '10' -RRType 'PTR' -ErrorAction SilentlyContinue | Where-Object { $_.HostName -eq '10' }) | Where-Object { $_.RecordData.PtrDomainName.TrimEnd('.') -eq 'vecchio.esempio.local' }); "
      + "if ($r.Count -ne 1) { throw ('NON_UNICO: ' + $r.Count) }; "
      + "$r[0] | Remove-DnsServerResourceRecord -ZoneName '4.168.192.in-addr.arpa' -Force; 'ESITO_OK' } catch { 'ESITO_ERRORE: ' + $_.Exception.Message }");
  });

  it("leggi: campi appiattiti e JSON su una riga", () => {
    const c = comandoLeggi("esempio.local", "pc-01", "A");
    assert.match(c, /Get-DnsServerResourceRecord -ZoneName 'esempio\.local' -Name 'pc-01' -RRType 'A'/);
    assert.match(c, /dato = \$_\.RecordData\.IPv4Address\.IPAddressToString/);
    assert.match(c, /'ESITO_LETTO: ' \+ \(ConvertTo-Json -Compress/);
  });
});

describe("risposte del DC", () => {
  it("lettura: un record, più record, nessuno", () => {
    assert.deepEqual(leggiRisposta('ESITO_LETTO: [{"tipo":"A","dato":"192.168.4.10","ttl":1200,"rinnovo":null}]'),
      { ok: true, record: [{ tipo: "A", dato: "192.168.4.10", ttl: 1200, statica: true, rinnovataIl: null }] });
    assert.deepEqual(leggiRisposta('rumore\r\nESITO_LETTO: {"tipo":"PTR","dato":"PC-01.Esempio.Local.","ttl":3600,"rinnovo":"2026-11-10 08:00:00"}\r\n'),
      { ok: true, record: [{ tipo: "PTR", dato: "pc-01.esempio.local", ttl: 3600, statica: false, rinnovataIl: "2026-11-10 08:00:00" }] });
    assert.deepEqual(leggiRisposta("ESITO_LETTO: []"), { ok: true, record: [] });
    assert.deepEqual(leggiRisposta("ESITO_LETTO: "), { ok: true, record: [] });
    assert.deepEqual(leggiRisposta("ESITO_LETTO: null"), { ok: true, record: [] });
  });

  it("lettura: errore del DC, uscita vuota, testo che non è JSON: non è «nessun record»", () => {
    assert.deepEqual(leggiRisposta("ESITO_ERRORE: Accesso negato"), { ok: false, motivo: "Accesso negato" });
    assert.equal(leggiRisposta("").ok, false);
    assert.equal(leggiRisposta("ESITO_LETTO: {tronco").ok, false);
    assert.equal(leggiRisposta('ESITO_LETTO: [{"tipo":"SRV","dato":"x"}]').ok, false);
  });

  it("passo: riuscito solo con ESITO_OK scritto dal DC", () => {
    assert.deepEqual(leggiEsitoPasso("ESITO_OK\r\n"), { ok: true });
    assert.deepEqual(leggiEsitoPasso("ESITO_ERRORE: NON_UNICO: 0"), { ok: false, motivo: "NON_UNICO: 0" });
    assert.equal(leggiEsitoPasso("").ok, false);
    assert.equal(leggiEsitoPasso("qualcosa").ok, false);
  });
});

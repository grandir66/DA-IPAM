/**
 * Anomalie del DNS di Active Directory: un caso per tipo, più i freni al rumore.
 *
 * Run: node --import tsx --test src/lib/ad/dns/__tests__/anomalie.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { anomalieDns, conteggiAnomalieDns, type DatiAnomalieDns, type HostPerDns } from "../anomalie";
import type { VoceDns, ZonaDns } from "../record";

const ZONE: ZonaDns[] = [
  { nome: "esempio.local", inversa: false, partizione: "dominio" },
  { nome: "4.168.192.in-addr.arpa", inversa: true, partizione: "dominio" },
];
const A = (nome: string, ip: string, statica = true): VoceDns =>
  ({ zona: "esempio.local", nome, fqdn: `${nome}.esempio.local`, tipo: "A", dato: ip, ip, statica, rinnovataIl: statica ? null : "2026-11-10 08:00:00", ttl: 3600 });
const PTR = (ip: string, verso: string): VoceDns =>
  ({ zona: "4.168.192.in-addr.arpa", nome: ip.split(".")[3]!, fqdn: `${ip.split(".")[3]}.4.168.192.in-addr.arpa`, tipo: "PTR", dato: `${verso}.esempio.local`, ip, statica: true, rinnovataIl: null, ttl: 3600 });
const CNAME = (nome: string, verso: string): VoceDns =>
  ({ zona: "esempio.local", nome, fqdn: `${nome}.esempio.local`, tipo: "CNAME", dato: verso, ip: null, statica: true, rinnovataIl: null, ttl: 3600 });
const H = (id: number, ip: string, hostname: string | null, status = "online", last_seen: string | null = "2026-11-17 09:00:00", inAd = false): HostPerDns =>
  ({ id, ip, hostname, status, last_seen, inAd });

function calcola(parziale: Partial<DatiAnomalieDns>) {
  return anomalieDns({ zone: ZONE, voci: [], host: [], reti: ["192.168.4.0/24"], voluti: new Set(), adesso: new Date("2026-11-17T10:00:00Z"), ...parziale });
}
const tipi = (parziale: Partial<DatiAnomalieDns>) => calcola(parziale).map((x) => x.chiave);

describe("anomalie dentro il DNS", () => {
  it("nome e reverse a posto, host noto: nessuna anomalia", () => {
    assert.deepEqual(tipi({ voci: [A("pc-01", "192.168.4.10"), PTR("192.168.4.10", "pc-01")], host: [H(1, "192.168.4.10", "PC-01")] }), []);
  });

  // Dal 19/11/2026 (Riccardo: «segnalare se ci sono discrepanze anche se talvolta sono previste») il nome
  // rimasto senza il suo reverse si segnala anche se un altro nome dello stesso IP ce l'ha.
  it("stesso IP con più nomi: si segnala anche il nome senza il suo reverse", () => {
    const r = calcola({ voci: [A("pc-01", "192.168.4.10"), A("vecchio", "192.168.4.10", false), PTR("192.168.4.10", "pc-01")], host: [H(1, "192.168.4.10", "pc-01")] });
    assert.deepEqual(r.map((x) => x.chiave), ["ip_piu_nomi:192.168.4.10", "a_senza_ptr:192.168.4.10"]);
    assert.deepEqual(r[1]!.nomi, ["vecchio.esempio.local"]);
    assert.deepEqual(r[0]!.nomi, ["pc-01.esempio.local", "vecchio.esempio.local"]);
    assert.equal(r[0]!.tuttoStatico, false);
    assert.equal(r[0]!.hostId, 1);
  });

  it("stesso nome con più IP", () => {
    const voci = [A("srv", "192.168.4.20"), A("srv", "192.168.4.21"), PTR("192.168.4.20", "srv"), PTR("192.168.4.21", "srv")];
    assert.deepEqual(tipi({ voci, host: [H(1, "192.168.4.20", "srv"), H(2, "192.168.4.21", "srv")] }), ["nome_piu_ip:srv.esempio.local"]);
  });

  it("nome senza reverse: con la zona reverse, e senza", () => {
    const host = [H(1, "192.168.4.10", "pc-01"), H(2, "10.9.9.9", "fuori")];
    assert.deepEqual(tipi({ voci: [A("pc-01", "192.168.4.10"), A("fuori", "10.9.9.9")], host }), ["a_senza_ptr:192.168.4.10", "a_senza_zona_inversa:10.9.9.9"]);
  });

  it("reverse con un altro nome, reverse senza nome, più reverse sullo stesso IP", () => {
    const voci = [A("pc-01", "192.168.4.10"), PTR("192.168.4.10", "altro"), PTR("192.168.4.50", "sparito"), PTR("192.168.4.50", "sparito-2")];
    assert.deepEqual(tipi({ voci, host: [H(1, "192.168.4.10", "pc-01")] }), [
      "ptr_altro_nome:192.168.4.10", "ptr_senza_a:192.168.4.10", "ptr_senza_a:192.168.4.50", "ip_piu_ptr:192.168.4.50",
    ]);
  });

  it("alias rotto solo se punta dentro una zona letta", () => {
    const voci = [CNAME("www", "sparito.esempio.local"), CNAME("posta", "mail.fornitore.example"), CNAME("ok", "pc-01.esempio.local"), A("pc-01", "192.168.4.10"), PTR("192.168.4.10", "pc-01")];
    assert.deepEqual(tipi({ voci, host: [H(1, "192.168.4.10", "pc-01")] }), ["cname_rotto:www.esempio.local"]);
  });
});

describe("confronto con DA-IPAM", () => {
  const voci = [A("pc-01", "192.168.4.10"), PTR("192.168.4.10", "pc-01")];

  it("nome diverso: si confronta il nome corto, senza maiuscole", () => {
    assert.deepEqual(tipi({ voci, host: [H(1, "192.168.4.10", "PC-01.esempio.local")] }), []);
    const r = calcola({ voci, host: [H(1, "192.168.4.10", "stampante-2")] });
    assert.deepEqual(r.map((x) => x.chiave), ["nome_diverso:192.168.4.10"]);
    assert.match(r[0]!.dettaglio, /stampante-2/);
  });

  it("host spento: oltre 30 giorni sì, 5 giorni no, mai visto sì", () => {
    assert.deepEqual(tipi({ voci, host: [H(1, "192.168.4.10", "pc-01", "offline", "2026-09-01 08:00:00")] }), ["host_spento:192.168.4.10"]);
    assert.deepEqual(tipi({ voci, host: [H(1, "192.168.4.10", "pc-01", "offline", "2026-11-12 08:00:00")] }), []);
    assert.deepEqual(tipi({ voci, host: [H(1, "192.168.4.10", "pc-01", "offline", null)] }), ["host_spento:192.168.4.10"]);
  });

  it("IP sconosciuto: conta solo dentro una rete censita", () => {
    assert.deepEqual(tipi({ voci }), ["ip_sconosciuto:192.168.4.10"]);
    assert.deepEqual(tipi({ voci, reti: ["10.0.0.0/8"] }), []);
  });

  it("host acceso senza nome: solo se è in AD o ha un nome in DA-IPAM", () => {
    const host = [H(1, "192.168.4.60", null, "online", null, true), H(2, "192.168.4.61", "nas"), H(3, "192.168.4.62", null), H(4, "192.168.4.63", "spento", "offline")];
    assert.deepEqual(tipi({ host }), ["host_senza_nome:192.168.4.60", "host_senza_nome:192.168.4.61"]);
  });
});

describe("voluti e conteggi", () => {
  it("un'anomalia segnata come voluta sparisce, le altre restano", () => {
    const voci = [A("srv", "192.168.4.20"), A("srv", "192.168.4.21"), PTR("192.168.4.20", "srv")];
    const host = [H(1, "192.168.4.20", "srv"), H(2, "192.168.4.21", "srv")];
    assert.deepEqual(tipi({ voci, host }), ["nome_piu_ip:srv.esempio.local", "a_senza_ptr:192.168.4.21"]);
    assert.deepEqual(tipi({ voci, host, voluti: new Set(["nome_piu_ip:srv.esempio.local"]) }), ["a_senza_ptr:192.168.4.21"]);
  });

  it("i conteggi portano tutti i tipi, anche a zero", () => {
    const c = conteggiAnomalieDns(calcola({ voci: [A("pc-01", "192.168.4.10")], host: [H(1, "192.168.4.10", "pc-01")] }));
    assert.equal(c.a_senza_ptr, 1);
    assert.equal(c.cname_rotto, 0);
    assert.equal(Object.keys(c).length, 12);
  });
});

/**
 * Correzioni proposte per le anomalie del DNS di AD: un caso per tipo, l'ordine dei passi,
 * e i controller di dominio che non si toccano.
 *
 * Run: node --import tsx --test src/lib/ad/dns/__tests__/correzioni.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { anomalieDns, type HostPerDns } from "../anomalie";
import { correzioniPer, nodoPtr, type ContestoCorrezioni, type PassoDns } from "../correzioni";
import type { VoceDns, ZonaDns } from "../record";

const ZONE: ZonaDns[] = [
  { nome: "esempio.local", inversa: false, partizione: "dominio" },
  { nome: "4.168.192.in-addr.arpa", inversa: true, partizione: "dominio" },
];
const A = (nome: string, ip: string): VoceDns =>
  ({ zona: "esempio.local", nome, fqdn: `${nome}.esempio.local`, tipo: "A", dato: ip, ip, statica: true, rinnovataIl: null, ttl: 3600 });
const PTR = (ip: string, verso: string): VoceDns =>
  ({ zona: "4.168.192.in-addr.arpa", nome: ip.split(".")[3]!, fqdn: `${ip.split(".")[3]}.4.168.192.in-addr.arpa`, tipo: "PTR", dato: `${verso}.esempio.local`, ip, statica: true, rinnovataIl: null, ttl: 3600 });
const CNAME = (nome: string, verso: string): VoceDns =>
  ({ zona: "esempio.local", nome, fqdn: `${nome}.esempio.local`, tipo: "CNAME", dato: verso, ip: null, statica: true, rinnovataIl: null, ttl: 3600 });
const H = (id: number, ip: string, hostname: string | null, status = "online", last_seen: string | null = "2026-11-17 09:00:00", inAd = false): HostPerDns =>
  ({ id, ip, hostname, status, last_seen, inAd });

/** Le correzioni di tutte le anomalie di un caso, come `titolo → passi in breve`. */
function proposte(voci: VoceDns[], host: HostPerDns[], protetti: ContestoCorrezioni["protetti"] = { nomi: new Set(), ip: new Set() }) {
  const anomalie = anomalieDns({ zone: ZONE, voci, host, reti: ["192.168.4.0/24"], voluti: new Set(), adesso: new Date("2026-11-17T10:00:00Z") });
  const ctx: ContestoCorrezioni = { zone: ZONE, voci, host, dominio: "esempio.local", protetti };
  return anomalie.flatMap((a) => correzioniPer(a, ctx).map((c) => ({ id: c.id, toglie: c.toglieDati, passi: c.passi.map(breve) })));
}
const breve = (p: PassoDns) => `${p.azione === "aggiungi" ? "+" : "-"}${p.tipo} ${p.nome}.${p.zona} ${p.dato}`;

describe("nodoPtr", () => {
  it("zona /24 e zona /16", () => {
    assert.deepEqual(nodoPtr("192.168.4.25", ZONE), { zona: "4.168.192.in-addr.arpa", nome: "25" });
    assert.deepEqual(nodoPtr("192.168.9.25", [{ nome: "168.192.in-addr.arpa", inversa: true, partizione: "dominio" }]), { zona: "168.192.in-addr.arpa", nome: "25.9" });
    assert.equal(nodoPtr("10.0.0.1", ZONE), null);
  });
});

describe("correzioni per tipo di anomalia", () => {
  it("nome senza reverse: crea il PTR", () => {
    assert.deepEqual(proposte([A("pc-01", "192.168.4.10")], [H(1, "192.168.4.10", "pc-01")]), [
      { id: "a_senza_ptr:192.168.4.10#crea:pc-01.esempio.local", toglie: false, passi: ["+PTR 10.4.168.192.in-addr.arpa pc-01.esempio.local"] },
    ]);
  });

  it("reverse senza nome: togli il PTR", () => {
    assert.deepEqual(proposte([PTR("192.168.4.50", "sparito")], []), [
      { id: "ptr_senza_a:192.168.4.50#togli", toglie: true, passi: ["-PTR 50.4.168.192.in-addr.arpa sparito.esempio.local"] },
    ]);
  });

  it("reverse con un altro nome: prima aggiunge il giusto, poi toglie lo sbagliato", () => {
    const r = proposte([A("pc-01", "192.168.4.10"), PTR("192.168.4.10", "altro")], [H(1, "192.168.4.10", "pc-01")]);
    assert.deepEqual(r.find((x) => x.id.startsWith("ptr_altro_nome"))?.passi, [
      "+PTR 10.4.168.192.in-addr.arpa pc-01.esempio.local",
      "-PTR 10.4.168.192.in-addr.arpa altro.esempio.local",
    ]);
  });

  it("stesso IP, più nomi: una proposta per nome, e il reverse di quel nome lo segue", () => {
    const r = proposte([A("pc-01", "192.168.4.10"), A("vecchio", "192.168.4.10"), PTR("192.168.4.10", "vecchio")], [H(1, "192.168.4.10", "pc-01")]);
    const doppioni = r.filter((x) => x.id.startsWith("ip_piu_nomi"));
    assert.deepEqual(doppioni.map((x) => x.passi), [
      ["-A pc-01.esempio.local 192.168.4.10"],
      ["-A vecchio.esempio.local 192.168.4.10", "-PTR 10.4.168.192.in-addr.arpa vecchio.esempio.local"],
    ]);
  });

  it("stesso nome, più IP: una proposta per IP", () => {
    const voci = [A("srv", "192.168.4.20"), A("srv", "192.168.4.21"), PTR("192.168.4.20", "srv"), PTR("192.168.4.21", "srv")];
    const r = proposte(voci, [H(1, "192.168.4.20", "srv"), H(2, "192.168.4.21", "srv")]);
    assert.deepEqual(r.map((x) => x.id), ["nome_piu_ip:srv.esempio.local#togli:192.168.4.20", "nome_piu_ip:srv.esempio.local#togli:192.168.4.21"]);
    assert.deepEqual(r[1]!.passi, ["-A srv.esempio.local 192.168.4.21", "-PTR 21.4.168.192.in-addr.arpa srv.esempio.local"]);
  });

  it("stesso IP, più reverse: una proposta per reverse", () => {
    const voci = [A("pc-01", "192.168.4.10"), PTR("192.168.4.10", "pc-01"), PTR("192.168.4.10", "vecchio")];
    const r = proposte(voci, [H(1, "192.168.4.10", "pc-01")]);
    assert.deepEqual(r.map((x) => x.id), ["ip_piu_ptr:192.168.4.10#togli:pc-01.esempio.local", "ip_piu_ptr:192.168.4.10#togli:vecchio.esempio.local"]);
  });

  it("alias rotto: togli il CNAME", () => {
    assert.deepEqual(proposte([CNAME("www", "sparito.esempio.local")], [])[0]?.passi, ["-CNAME www.esempio.local sparito.esempio.local"]);
  });

  it("nome diverso da DA-IPAM: rinomina, aggiungendo prima e togliendo dopo", () => {
    const r = proposte([A("vecchio", "192.168.4.10"), PTR("192.168.4.10", "vecchio")], [H(1, "192.168.4.10", "PC-Nuovo.esempio.local")]);
    assert.deepEqual(r, [{
      id: "nome_diverso:192.168.4.10#rinomina:vecchio.esempio.local", toglie: true, passi: [
        "+A pc-nuovo.esempio.local 192.168.4.10",
        "+PTR 10.4.168.192.in-addr.arpa pc-nuovo.esempio.local",
        "-A vecchio.esempio.local 192.168.4.10",
        "-PTR 10.4.168.192.in-addr.arpa vecchio.esempio.local",
      ],
    }]);
  });

  it("nome diverso: nessuna rinomina se il nome nuovo esiste già o non è un nome DNS", () => {
    const voci = [A("vecchio", "192.168.4.10"), PTR("192.168.4.10", "vecchio"), A("nas", "192.168.4.11"), PTR("192.168.4.11", "nas")];
    assert.deepEqual(proposte(voci, [H(1, "192.168.4.10", "nas"), H(2, "192.168.4.11", "nas")]), []);
    assert.deepEqual(proposte([A("vecchio", "192.168.4.10"), PTR("192.168.4.10", "vecchio")], [H(1, "192.168.4.10", "sala riunioni")]), []);
  });

  it("host spento e IP sconosciuto: togli nome e reverse", () => {
    const voci = [A("pc-01", "192.168.4.10"), PTR("192.168.4.10", "pc-01")];
    const attesi = ["-A pc-01.esempio.local 192.168.4.10", "-PTR 10.4.168.192.in-addr.arpa pc-01.esempio.local"];
    assert.deepEqual(proposte(voci, [H(1, "192.168.4.10", "pc-01", "offline", "2026-08-01 08:00:00")])[0]?.passi, attesi);
    assert.deepEqual(proposte(voci, [])[0]?.passi, attesi);
  });

  it("host acceso senza nome: crea A e reverse nella zona del dominio", () => {
    assert.deepEqual(proposte([], [H(1, "192.168.4.61", "NAS")]), [
      { id: "host_senza_nome:192.168.4.61#crea", toglie: false, passi: ["+A nas.esempio.local 192.168.4.61", "+PTR 61.4.168.192.in-addr.arpa nas.esempio.local"] },
    ]);
    assert.deepEqual(proposte([], [H(1, "192.168.4.60", null, "online", null, true)]), [], "senza un nome non c'è niente da creare");
  });

  it("manca la zona reverse: nessuna correzione", () => {
    assert.deepEqual(proposte([A("fuori", "10.9.9.9")], [H(1, "10.9.9.9", "fuori")]), []);
  });
});

describe("controller di dominio", () => {
  it("nessuna correzione tocca il nome o l'IP di un DC", () => {
    const voci = [A("dc01", "192.168.4.2"), A("vecchio", "192.168.4.2"), PTR("192.168.4.3", "dc01")];
    const host = [H(1, "192.168.4.2", "dc01")];
    assert.ok(proposte(voci, host).length > 0, "senza protezione le proposte ci sono");
    assert.deepEqual(proposte(voci, host, { nomi: new Set(["dc01"]), ip: new Set(["192.168.4.2"]) }), []);
  });
});

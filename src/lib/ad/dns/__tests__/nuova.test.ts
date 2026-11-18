/**
 * Voce nuova scritta a mano: dall'id ai passi, e i casi che si rifiutano.
 *
 * Run: node --import tsx --test src/lib/ad/dns/__tests__/nuova.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { voceNuovaDa } from "../nuova";
import type { ZonaDns } from "../record";

const ZONE: ZonaDns[] = [
  { nome: "esempio.local", inversa: false, partizione: "dominio" },
  { nome: "lab.esempio.local", inversa: false, partizione: "dominio" },
  { nome: "4.168.192.in-addr.arpa", inversa: true, partizione: "dominio" },
];
const passi = (id: string) => {
  const r = voceNuovaDa(id, ZONE, "esempio.local");
  return r.ok ? r.correzione.passi.map((p) => `${p.azione} ${p.tipo} ${p.nome}@${p.zona} ${p.dato}`) : r.motivo;
};

describe("voce nuova nel DNS di AD", () => {
  it("A col reverse: nome corto nel dominio, due «aggiungi»", () => {
    assert.deepEqual(passi("nuova:A:PC-01:192.168.4.10:ptr"), ["aggiungi A pc-01@esempio.local 192.168.4.10", "aggiungi PTR 10@4.168.192.in-addr.arpa pc-01.esempio.local"]);
  });
  it("A senza reverse, nella zona più stretta", () => {
    assert.deepEqual(passi("nuova:A:pc-02.lab.esempio.local:192.168.4.11:solo"), ["aggiungi A pc-02@lab.esempio.local 192.168.4.11"]);
  });
  it("alias e reverse da soli", () => {
    assert.deepEqual(passi("nuova:CNAME:intranet:srv-web"), ["aggiungi CNAME intranet@esempio.local srv-web.esempio.local"]);
    assert.deepEqual(passi("nuova:PTR:192.168.4.12:pc-03"), ["aggiungi PTR 12@4.168.192.in-addr.arpa pc-03.esempio.local"]);
  });
  it("rifiuti: zona non letta, reverse senza zona, id storto", () => {
    assert.match(String(passi("nuova:A:pc.altrove.it:192.168.4.10:solo")), /nessuna zona/);
    assert.match(String(passi("nuova:A:pc-01:10.9.9.9:ptr")), /zona reverse/);
    assert.equal(passi("nuova:A:pc-01:192.168.4.10"), "Voce nuova non leggibile");
    assert.equal(passi("nuova:SRV:x:y"), "Tipo di voce non previsto");
    assert.equal(passi("nuova:CNAME:a:b:c:d"), "Voce nuova non leggibile");
  });
});

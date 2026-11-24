// Ogni scheda della sezione Rete ha la sua guida, e ogni chiave porta a una scheda che esiste.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SEZIONI } from "@/lib/menu/sezioni";
import { GUIDE, guidaDi } from "../guide";

test("nessuna scheda di Rete senza guida, nessuna guida senza scheda", () => {
  const rete = SEZIONI.find((s) => s.nome === "Rete")?.schede ?? [];
  assert.ok(rete.length > 0);
  const chiavi = Object.keys(GUIDE);
  for (const s of rete) {
    const base = s.ancora ? `${s.href}#${s.ancora}` : s.href;
    assert.ok(chiavi.some((k) => k === base || k.startsWith(`${base}>`)), base);
  }
  const basi = new Set(SEZIONI.flatMap((z) => z.schede).map((s) => (s.ancora ? `${s.href}#${s.ancora}` : s.href)));
  for (const k of chiavi) assert.ok(basi.has(k.split(">")[0]), k);
});

test("la parte aperta vince sulla scheda, una parte sconosciuta ripiega", () => {
  assert.equal(guidaDi("/servizi-rete", undefined, "identita"), GUIDE["/servizi-rete>identita"]);
  assert.equal(guidaDi("/servizi-rete", undefined, "boh"), GUIDE["/servizi-rete"]);
  assert.equal(guidaDi("/discovery"), null);
});

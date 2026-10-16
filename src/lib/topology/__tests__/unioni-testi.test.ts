// Le parole dei dialoghi «Unisci con…» e «Separa…» (piano 2026-10-16, Task 4): parti pure, senza rete né DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PAROLA_COME, type ComeFuso } from "@/lib/topology/unioni-tipi";
import { membriSeparabili, parolaCome, titoloSepara, titoloUnisci } from "@/lib/topology/unioni-testi";

const nodo = (kind: "device" | "host" | "segmento", mgmtIp: string | null, fused: number[], addr: Array<[string, number | null]>) => ({
  kind, mgmtIp, fusedHostIds: fused, addresses: addr.map(([ip, hostId]) => ({ ip, virtual: false, hostId })),
});

test("parolaCome: una parola per ogni regola, dal dizionario condiviso", () => {
  for (const come of Object.keys(PAROLA_COME) as ComeFuso[]) {
    if (come === "a_mano") continue;
    assert.equal(parolaCome({ come, aMano: null }), PAROLA_COME[come]);
  }
  assert.equal(parolaCome({ come: "stesso_mac", aMano: null }), "stesso MAC");
  assert.equal(parolaCome({ come: "oggetto", aMano: null }), "l'oggetto stesso");
});

test("parolaCome: a mano dice la data italiana e chi (fuso d'Italia, non UTC)", () => {
  assert.equal(parolaCome({ come: "a_mano", aMano: { da: "mario", il: "2026-10-16 08:00:00" } }), "unito a mano il 16/10 da mario");
  // 22:30 UTC del 16 = 00:30 del 17 in Italia (UTC+2).
  assert.equal(parolaCome({ come: "a_mano", aMano: { da: "mario", il: "2026-10-16 22:30:00" } }), "unito a mano il 17/10 da mario");
  // Senza i dati dell'unione la parola resta quella generica, mai «Invalid Date».
  assert.equal(parolaCome({ come: "a_mano", aMano: null }), PAROLA_COME.a_mano);
  assert.equal(parolaCome({ come: "a_mano", aMano: { da: "mario", il: "boh" } }), "unito a mano da mario");
});

test("membriSeparabili: apparato = fusi meno l'host con l'IP di gestione", () => {
  const due = nodo("device", "192.0.2.1", [1, 2, 3], [["192.0.2.1", 1], ["192.0.2.2", 2], ["192.0.2.3", 3]]);
  assert.equal(membriSeparabili(due), 2);
  const solo = nodo("device", "192.0.2.1", [1], [["192.0.2.1", 1]]);
  assert.equal(membriSeparabili(solo), 0);
  const senza = nodo("device", null, [4, 5], [["192.0.2.4", 4], ["192.0.2.5", 5]]);
  assert.equal(membriSeparabili(senza), 2);
});

test("membriSeparabili: nodo di soli host = fusi + 1; host solo e segmento = 0", () => {
  assert.equal(membriSeparabili(nodo("host", "192.0.2.9", [7, 8], [["192.0.2.9", 9], ["192.0.2.7", 7], ["192.0.2.8", 8]])), 3);
  assert.equal(membriSeparabili(nodo("host", "192.0.2.9", [], [["192.0.2.9", 9]])), 0);
  assert.equal(membriSeparabili(nodo("segmento", null, [], [])), 0);
});

test("titoli dei dialoghi", () => {
  assert.equal(titoloUnisci("sw-uno"), "Unisci «sw-uno» con…");
  assert.equal(titoloSepara("sw-uno"), "Separa da «sw-uno»…");
});

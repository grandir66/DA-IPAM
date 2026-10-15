import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_WORDS, edgeLook, linkWords, pathPoints, poeLabel, seenWords, speedLabel, speedWidth, wavyPath } from "@/lib/topology/edge-look";
import { LINK_ATTRS_DEFAULT, type MapLink } from "@/lib/topology/model-types";

function link(over: Partial<MapLink> = {}): MapLink {
  return {
    id: "link:dev:1|dev:2", a: "dev:1", aPort: "Port 1", b: "dev:2", bPort: "eth0", source: "lldp", sources: ["lldp"],
    uplinkFrom: null, lastSeen: null, daysUnseen: null, stale: false, ...LINK_ATTRS_DEFAULT, ...over,
  };
}

test("spessore dalla velocità (spec §11.4): 10G e oltre 6, 2,5G 4, 1G 2,4, sotto 1,2, non nota 2,4", () => {
  assert.equal(speedWidth(40000), 6);
  assert.equal(speedWidth(10000), 6);
  assert.equal(speedWidth(5000), 4);
  assert.equal(speedWidth(2500), 4);
  assert.equal(speedWidth(1000), 2.4);
  assert.equal(speedWidth(100), 1.2);
  assert.equal(speedWidth(10), 1.2);
  assert.equal(speedWidth(null), 2.4);
});

test("etichetta della velocità: «10G», «2,5G», «1G», «100M»; nessuna se non nota", () => {
  assert.equal(speedLabel(10000), "10G");
  assert.equal(speedLabel(25000), "25G");
  assert.equal(speedLabel(2500), "2,5G");
  assert.equal(speedLabel(1000), "1G");
  assert.equal(speedLabel(100), "100M");
  assert.equal(speedLabel(10), "10M");
  assert.equal(speedLabel(null), null);
});

test("PoE: «⚡ N W» con la virgola, niente se zero o non noto", () => {
  assert.equal(poeLabel(7.5), "⚡ 7,5 W");
  assert.equal(poeLabel(12), "⚡ 12 W");
  assert.equal(poeLabel(3.04), "⚡ 3 W");
  assert.equal(poeLabel(0), null);
  assert.equal(poeLabel(null), null);
});

test("mai il solo colore: ogni stato ha una forma o un testo", () => {
  const base = edgeLook(link(), { inTree: true });
  assert.deepEqual(base, { width: 2.4, dash: null, grey: false, wavy: false, double: false, tokens: [] });

  const wifi = edgeLook(link({ medium: "wireless", speedMbps: 1000 }), { inTree: true });
  assert.equal(wifi.wavy, true);
  assert.deepEqual(wifi.tokens, ["1G", "≋ Wi-Fi"]);

  const red = edgeLook(link({ redundant: true }), { inTree: false });
  assert.equal(red.double, true);
  assert.deepEqual(red.tokens, ["ridondanza"]);

  const stale = edgeLook(link({ stale: true, daysUnseen: 4 }), { inTree: false });
  assert.equal(stale.grey, true);
  assert.equal(stale.dash, "6 4");
  assert.deepEqual(stale.tokens, ["▲ non visto da 4 g"]);
  // Nell'albero il «non visto» lo dice già l'etichetta delle porte sopra il riquadro: la linea non lo ripete.
  assert.deepEqual(edgeLook(link({ stale: true, daysUnseen: 4 }), { inTree: true }).tokens, []);
  assert.equal(edgeLook(link({ stale: true, daysUnseen: 4 }), { inTree: true }).dash, "6 4");

  const unconfirmed = edgeLook(link({ source: "manual", sources: ["manual"], manual: { confirmed: false } }), { inTree: true });
  assert.equal(unconfirmed.dash, "1.5 4");
  assert.deepEqual(unconfirmed.tokens, ["✎ ?"]);
  const confirmed = edgeLook(link({ source: "manual", sources: ["manual"], manual: { confirmed: true }, medium: "fibra" }), { inTree: true });
  assert.equal(confirmed.dash, null);
  assert.deepEqual(confirmed.tokens, ["fibra", "✎ ✓"]);

  const all = edgeLook(link({ speedMbps: 10000, poeW: 7.5, primary: "user", primaryFor: "dev:2" }), { inTree: true });
  assert.equal(all.width, 6);
  assert.deepEqual(all.tokens, ["10G", "⚡ 7,5 W", "★"]);
});

test("i punti di un percorso a gradini (anche coi punti doppi degli angoli a raggio 0)", () => {
  const pts = pathPoints("M100 44L100 64L 100,94Q 100,94 100,94L 300,94Q 300,94 300,94L300 124L300 144");
  assert.deepEqual(pts, [{ x: 100, y: 44 }, { x: 100, y: 94 }, { x: 300, y: 94 }, { x: 300, y: 144 }]);
  assert.deepEqual(pathPoints("M100 44L100 64L100 94L100 94L100 124L100 144"), [{ x: 100, y: 44 }, { x: 100, y: 144 }]);
});

test("il tracciato ondulato parte e arriva negli stessi punti ed è deterministico", () => {
  const pts = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 120, y: 50 }];
  const w = wavyPath(pts);
  assert.ok(w.startsWith("M0 0"), w);
  assert.ok(w.endsWith(" 120 50"), w);
  assert.ok(w.includes("Q"), "fatto di curve");
  assert.equal(wavyPath(pts), w);
  assert.equal(wavyPath([{ x: 5, y: 5 }]), "M5 5");
});

test("la barra dei dettagli dice in parole perché una linea è così", () => {
  assert.deepEqual(linkWords(link()), []);
  assert.deepEqual(
    linkWords(link({ source: "manual", sources: ["manual"], manual: { confirmed: false }, medium: "fibra", primary: "user", primaryFor: "dev:2" })),
    ["tipo: fibra", "✎ ? solo a mano: le letture non lo vedono sulla porta dichiarata", "★ principale scelto a mano"],
  );
  assert.deepEqual(
    linkWords(link({ manual: { confirmed: true }, speedMbps: 2500, poeW: 12, primary: "auto" })),
    ["velocità 2,5G", "PoE 12 W", "✎ ✓ a mano, confermato: le letture lo vedono", "principale (scelto dal sistema)"],
  );
  assert.deepEqual(linkWords(link({ redundant: true, medium: "wireless" })), ["tipo: wireless", "ridondanza: non è il collegamento principale"]);
});

// Visto a schermo il 2026-10-14 (fase 2b, Task 12): un collegamento fatto solo a mano, che nessuna lettura
// vede, diceva «✓ visto oggi» accanto a «✎ ? solo a mano: le letture non lo vedono».
test("«visto»: oggi, N giorni fa, non visto; mai «visto oggi» per ciò che nessuna lettura ha visto", () => {
  assert.equal(seenWords(link({ lastSeen: "2026-10-14 05:00:00", daysUnseen: 0 })), "✓ visto oggi");
  assert.equal(seenWords(link({ lastSeen: "2026-10-12 05:00:00", daysUnseen: 2 })), "✓ visto 2 g fa");
  assert.equal(seenWords(link({ lastSeen: "2026-10-01 05:00:00", daysUnseen: 13, stale: true })), "▲ non visto da 13 g");
  assert.equal(seenWords(link({ source: "manual", sources: ["manual"], lastSeen: null })), "dichiarato a mano, nessuna lettura lo vede");
  assert.equal(seenWords(link({ lastSeen: null })), "data della lettura non nota");
});

test("una riga mndp a schermo è un «annuncio di rete (MNDP o CDP)» (spec §13.5.2)", () => {
  assert.equal(SOURCE_WORDS.mndp, "annuncio di rete (MNDP o CDP)");
});

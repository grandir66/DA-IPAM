import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_WORDS, TRATTI, altriCaviDi, edgeLook, linkWords, parolaStato, pathPoints, pezzoNelloSpazio, poeLabel, seenWords, speedLabel, speedWidth, wavyPath } from "@/lib/topology/edge-look";
import { LINK_ATTRS_DEFAULT, type CavoLinea, type MapLink } from "@/lib/topology/model-types";
import { printStrokes } from "@/lib/topology/print-draw";
import { lrLabelMaxWidth } from "@/lib/topology/map-screen";
import { CHAR_W } from "@/lib/topology/tree-layout-consts";

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

test("«Altri cavi visti fra questi due oggetti»: le porte dalla parte dell'oggetto scelto, le fonti in parole", () => {
  const l = { ...link(), a: "dev:114", aPort: "Port 10", b: "dev:1", bPort: "sfp-sfpplus1",
    altriCavi: [{ aPort: "Port 15", bPort: "ether8", sources: ["mndp" as const], lastSeen: "2026-10-13 11:00:00" }] };
  assert.deepEqual(altriCaviDi(l, "dev:1"), [{ mia: "ether8", sua: "Port 15", fonti: "annuncio di rete (MNDP o CDP)", visto: "2026-10-13 11:00:00" }]);
  assert.deepEqual(altriCaviDi(l, "dev:114")[0].mia, "Port 15");
  assert.deepEqual(altriCaviDi({ ...l, altriCavi: undefined }, "dev:1"), []);
});

// ---------- T3.5: forme e parole della mappa nuova (spec §13.10.3), prove I30, I32 ----------

function cavo(over: Partial<CavoLinea> = {}): CavoLinea {
  return { genere: "cavo", stato: null, fiducia: "certo", porteDaVerificare: false, detti: [], frasi: [], ...over };
}
const nomeDi = (id: string): string => ({ "dev:1": "core 1", "dev:2": "accesso A", "dev:9": "ponte B" } as Record<string, string>)[id] ?? id;

test("le parole degli stati, corte e intere, alla lettera del §13.10.3", () => {
  const p = (c: CavoLinea, f: "corta" | "intera") => parolaStato(c, f, nomeDi);
  assert.equal(p(cavo({ stato: "bloccato" }), "corta"), "bloccato");
  assert.equal(p(cavo({ stato: "bloccato" }), "intera"), "⊘ bloccato dallo spanning tree");
  assert.equal(p(cavo({ stato: "bloccato_comune", attivoPerVlan: [12] }), "corta"), "in parte");
  assert.equal(p(cavo({ stato: "bloccato_comune", attivoPerVlan: [12] }), "intera"), "⊘ bloccato nell'albero comune · VLAN 12 attiva");
  assert.equal(p(cavo({ stato: "bloccato_comune", attivoPerVlan: [12, 40] }), "intera"), "⊘ bloccato nell'albero comune · VLAN 12, 40 attive");
  assert.equal(p(cavo({ stato: "bloccato_comune", istanzeNonLette: true }), "intera"), "⊘ bloccato nell'albero comune · può portare altre VLAN");
  assert.equal(p(cavo({ stato: "instradato" }), "corta"), "instradato");
  assert.equal(p(cavo({ stato: "instradato" }), "intera"), "instradato, fuori dal bridge");
  assert.equal(p(cavo({ stato: "instradato", wan: true }), "intera"), "instradato: la WAN del gateway");
  assert.equal(p(cavo({ stato: "giu", giuSu: { nodo: "dev:1", porta: "Port 7" } }), "corta"), "cavo giù");
  assert.equal(p(cavo({ stato: "giu", giuSu: { nodo: "dev:1", porta: "Port 7" } }), "intera"), "cavo giù: la porta Port 7 di core 1 è giù");
  assert.equal(p(cavo({ stato: "giu" }), "intera"), "cavo giù");
  assert.equal(p(cavo({ stato: "riserva_bond" }), "corta"), "riserva");
  assert.equal(p(cavo({ stato: "riserva_bond" }), "intera"), "riserva del bond: si usa se cade l'altra scheda");
  assert.equal(p(cavo({ stato: "inoltra" }), "corta"), null);
  assert.equal(p(cavo(), "intera"), null);
});

test("le parole dei generi: fascio, tunnel, radio, senza fili, oltre, contrazione", () => {
  const m = (stato: "inoltra" | "giu", v: number) => ({ aPort: "a", bPort: "b", stato, velocitaMbps: v });
  const fascio = cavo({ genere: "fascio", fascio: { membri: [m("inoltra", 25000), m("inoltra", 25000)], dedotto: false } });
  assert.equal(parolaStato(fascio, "corta", nomeDi), "2 cavi");
  assert.equal(parolaStato(fascio, "intera", nomeDi), "fascio di 2 cavi · 2 × 25G");
  const giuno = cavo({ genere: "fascio", fascio: { membri: [m("inoltra", 25000), m("giu", 25000)], dedotto: false } });
  assert.equal(parolaStato(giuno, "intera", nomeDi), "fascio di 2 cavi, 1 giù");
  const dedotto = cavo({ genere: "fascio", fascio: { membri: [m("inoltra", 1000), m("inoltra", 1000)], dedotto: true } });
  assert.equal(parolaStato(dedotto, "intera", nomeDi), "fascio dedotto");
  assert.equal(parolaStato(cavo({ genere: "tunnel" }), "corta", nomeDi), "tunnel");
  assert.equal(parolaStato(cavo({ genere: "tunnel" }), "intera", nomeDi), "tunnel");
  assert.equal(parolaStato(cavo({ genere: "radio" }), "corta", nomeDi), "≋ radio");
  assert.equal(parolaStato(cavo({ genere: "radio" }), "intera", nomeDi), "≋ ponte radio");
  assert.equal(parolaStato(cavo({ genere: "senza_fili" }), "intera", nomeDi), "≋ Wi-Fi");
  assert.equal(parolaStato(cavo({ fiducia: "dedotto", oltre: "dev:9" }), "corta", nomeDi), "oltre ponte B");
  assert.equal(parolaStato(cavo({ fiducia: "dedotto", oltre: "dev:9" }), "intera", nomeDi), "dedotto: oltre ponte B, salto non letto");
  assert.equal(parolaStato(cavo({ genere: "contrazione", via: "segmento" }), "corta", nomeDi), "segmento");
  assert.equal(parolaStato(cavo({ genere: "contrazione", via: "segmento" }), "intera", nomeDi), "via segmento non gestito: non è in questa mappa");
  assert.equal(parolaStato(cavo({ genere: "contrazione", via: "radio" }), "corta", nomeDi), "≋ radio");
  assert.equal(parolaStato(cavo({ genere: "contrazione", via: "radio" }), "intera", nomeDi), "via ponte radio");
});

test("combinazioni: velocità, stato, poi PoE, ★, a mano; «giù» senza velocità; la linea dell'albero ha la parola corta", () => {
  const o = { inTree: true, nomeDi };
  assert.deepEqual(edgeLook(link({ speedMbps: 10000, cavo: cavo() }), o).tokens, ["10G"]);
  assert.deepEqual(edgeLook(link({ speedMbps: 10000, redundant: true, cavo: cavo() }), { inTree: false, nomeDi }).tokens, ["10G", "ridondanza"]);
  // Una ridondanza non ripete «ridondanza» se lo stato lo dice già.
  const bl = link({ speedMbps: 10000, redundant: true, cavo: cavo({ stato: "bloccato" }) });
  assert.deepEqual(edgeLook(bl, { inTree: false, nomeDi }).tokens, ["10G", "⊘ bloccato dallo spanning tree"]);
  assert.deepEqual(edgeLook(bl, o).tokens, ["10G", "bloccato"]);
  const parte = link({ speedMbps: 10000, redundant: true, cavo: cavo({ stato: "bloccato_comune", attivoPerVlan: [7] }) });
  assert.deepEqual(edgeLook(parte, { inTree: false, nomeDi }).tokens, ["10G", "⊘ bloccato nell'albero comune · VLAN 7 attiva"]);
  assert.deepEqual(edgeLook(link({ speedMbps: 2500, cavo: cavo({ stato: "instradato" }) }), o).tokens, ["2,5G", "instradato"]);
  assert.deepEqual(edgeLook(link({ speedMbps: 2500, redundant: true, cavo: cavo({ stato: "instradato" }) }), { inTree: false, nomeDi }).tokens, ["2,5G", "instradato, fuori dal bridge"]);
  const giu = link({ speedMbps: 10000, stale: true, daysUnseen: 3, cavo: cavo({ stato: "giu", giuSu: { nodo: "dev:1", porta: "Port 7" } }) });
  assert.deepEqual(edgeLook(giu, o).tokens, ["cavo giù"]);
  // Un cavo giù è anche «non visto»: vale «cavo giù», il resto va nei dettagli.
  assert.deepEqual(edgeLook(giu, { inTree: false, nomeDi }).tokens, ["cavo giù: la porta Port 7 di core 1 è giù"]);
  const tutto = link({ speedMbps: 1000, poeW: 7.5, primary: "user", manual: { confirmed: true }, cavo: cavo({ stato: "instradato" }) });
  assert.deepEqual(edgeLook(tutto, o).tokens, ["1G", "instradato", "⚡ 7,5 W", "✎ ✓", "★"]);
  const fascio = cavo({ genere: "fascio", fascio: { membri: [{ aPort: "a", bPort: "b", stato: "inoltra", velocitaMbps: 25000 }, { aPort: "c", bPort: "d", stato: "inoltra", velocitaMbps: 25000 }], dedotto: false } });
  assert.deepEqual(edgeLook(link({ speedMbps: 50000, cavo: fascio }), o).tokens, ["50G", "2 cavi"]);
  assert.deepEqual(edgeLook(link({ speedMbps: 50000, redundant: true, cavo: fascio }), { inTree: false, nomeDi }).tokens, ["50G", "fascio di 2 cavi · 2 × 25G", "ridondanza"]);
  // Il tunnel: «tunnel» e lo stato; con annunci vecchi «tunnel ▲» sulla linea dell'albero, in due pezzi nei dettagli.
  const tun = link({ medium: "tunnel", stale: true, daysUnseen: 5, cavo: cavo({ genere: "tunnel" }) });
  assert.deepEqual(edgeLook(tun, o).tokens, ["tunnel ▲"]);
  assert.deepEqual(edgeLook(tun, { inTree: false, nomeDi }).tokens, ["tunnel", "▲ non visto da 5 g"]);
  const tunParte = link({ medium: "tunnel", cavo: cavo({ genere: "tunnel", stato: "bloccato_comune", attivoPerVlan: [7] }) });
  assert.deepEqual(edgeLook(tunParte, o).tokens, ["tunnel", "in parte"]);
  assert.deepEqual(edgeLook(tunParte, { inTree: false, nomeDi }).tokens, ["tunnel", "⊘ bloccato nell'albero comune · VLAN 7 attiva"]);
});

test("forme: giù nero tratteggio lungo, tunnel «8 3 2 3», radio ondulata, contrazione con «⋯»", () => {
  const o = { inTree: true, nomeDi };
  const giu = edgeLook(link({ stale: true, daysUnseen: 2, cavo: cavo({ stato: "giu" }) }), o);
  assert.equal(giu.dash, TRATTI.giu);
  assert.equal(giu.nero, true);
  assert.equal(giu.grey, false, "il grigio è «non visto», non «giù»");
  const tun = edgeLook(link({ medium: "tunnel", cavo: cavo({ genere: "tunnel" }) }), o);
  assert.equal(tun.dash, TRATTI.tunnel);
  assert.equal(edgeLook(link({ medium: "tunnel", stale: true, daysUnseen: 4, cavo: cavo({ genere: "tunnel" }) }), o).grey, true);
  assert.equal(edgeLook(link({ cavo: cavo({ genere: "radio" }) }), o).wavy, true);
  assert.equal(edgeLook(link({ cavo: cavo({ genere: "senza_fili" }) }), o).wavy, true);
  const cs = edgeLook(link({ cavo: cavo({ genere: "contrazione", via: "segmento" }) }), o);
  assert.equal(cs.centro, "⋯");
  assert.equal(cs.wavy, false);
  assert.equal(cs.double, false);
  const cr = edgeLook(link({ cavo: cavo({ genere: "contrazione", via: "radio" }) }), o);
  assert.equal(cr.wavy, true);
  assert.equal(cr.centro, undefined);
  for (const st of ["bloccato", "bloccato_comune", "riserva_bond"] as const) assert.equal(edgeLook(link({ cavo: cavo({ stato: st }) }), o).double, true, st);
  assert.equal(edgeLook(link({ redundant: true, cavo: cavo() }), { inTree: false, nomeDi }).double, true);
  assert.equal(edgeLook(link({ cavo: cavo({ stato: "instradato" }) }), o).double, false);
});

// I30: ogni stato ha una parola E una forma, e due stati diversi non hanno la stessa coppia (anche in bianco e nero).
test("I30: due stati diversi non hanno la stessa coppia forma e parola, nemmeno in bianco e nero", () => {
  const casi: Array<[string, MapLink]> = [
    ["non visto", link({ stale: true, daysUnseen: 4, cavo: cavo() })],
    ["a mano", link({ manual: { confirmed: false }, cavo: cavo() })],
    ["giù", link({ cavo: cavo({ stato: "giu" }) })],
    ["tunnel", link({ medium: "tunnel", cavo: cavo({ genere: "tunnel" }) })],
    ["radio", link({ cavo: cavo({ genere: "radio" }) })],
    ["bloccato", link({ redundant: true, cavo: cavo({ stato: "bloccato" }) })],
    ["in parte", link({ redundant: true, cavo: cavo({ stato: "bloccato_comune", attivoPerVlan: [1] }) })],
    ["riserva", link({ redundant: true, cavo: cavo({ stato: "riserva_bond" }) })],
    ["instradato", link({ cavo: cavo({ stato: "instradato" }) })],
    ["ridondanza", link({ redundant: true, cavo: cavo() })],
  ];
  const visti = new Map<string, string>();
  for (const [nome, l] of casi) {
    const look = edgeLook(l, { inTree: false, nomeDi });
    const chiave = JSON.stringify([
      printStrokes(look).map((s) => [s.color, s.dash, s.cap]), look.wavy, look.double, look.nero ?? false, look.tokens.join("|"),
    ]);
    const prima = visti.get(chiave);
    assert.equal(prima, undefined, `«${nome}» ha la stessa forma e le stesse parole di «${prima}»`);
    visti.set(chiave, nome);
    if (nome !== "non visto" && nome !== "a mano") assert.ok(look.tokens.length > 0, `«${nome}» ha una parola`);
  }
  // I tratteggi sono quattro, tutti diversi; «giù» è nero, «non visto» grigio.
  assert.equal(new Set([TRATTI.nonVisto, TRATTI.aMano, TRATTI.giu, TRATTI.tunnel]).size, 4);
  const giu = printStrokes(edgeLook(link({ cavo: cavo({ stato: "giu" }) }), { inTree: true, nomeDi }));
  const nv = printStrokes(edgeLook(link({ stale: true, daysUnseen: 4, cavo: cavo() }), { inTree: false, nomeDi }));
  assert.deepEqual([giu[0].dash, giu[0].color], ["10 4", "#000000"]);
  assert.deepEqual([nv[0].dash, nv[0].color], ["6 4", "#6b6b6b"]);
  assert.equal(printStrokes(edgeLook(link({ medium: "tunnel", cavo: cavo({ genere: "tunnel" }) }), { inTree: true, nomeDi }))[0].dash, "8 3 2 3");
});

// I32: un pezzo che non sta nel suo spazio si accorcia con «…».
test("I32: «instradato» sullo spazio minimo si accorcia, le parole corte da 8 caratteri o meno restano intere", () => {
  assert.equal(pezzoNelloSpazio("instradato", 8), "instrad…");
  assert.equal(pezzoNelloSpazio("bloccato", 8), "bloccato");
  assert.equal(pezzoNelloSpazio("cavo giù", 8), "cavo giù");
  assert.equal(pezzoNelloSpazio("x", 1), "x");
  assert.equal(pezzoNelloSpazio("abc", 1), "…");
  const spazio = Math.floor(60 / CHAR_W);
  assert.equal(spazio, 8);
  // lrLabelMaxWidth minimo del §13.10.3: 90 px fra le colonne, meno tronco e margine, meno 4 px per lato.
  assert.equal(lrLabelMaxWidth(0, 90) - 8, 60, "lo spazio minimo di testo è 60 px");
  const corte = ["bloccato", "in parte", "instradato", "cavo giù", "2 cavi", "tunnel", "≋ radio", "riserva", "segmento", "tunnel ▲"];
  for (const w of corte) {
    const fuori = pezzoNelloSpazio(w, spazio);
    if (w.length <= spazio) assert.equal(fuori, w, `«${w}» sta intera`);
    else assert.ok(fuori.length * CHAR_W <= 60 && fuori.endsWith("…"), `«${w}» si accorcia con «…»`);
  }
});

// A interruttore spento (nessun `cavo`): lo stesso di oggi, tranne il pezzo «tunnel».
test("senza `cavo` la linea è quella di oggi; un tunnel dichiarato a mano dà il pezzo «tunnel»", () => {
  assert.deepEqual(edgeLook(link({ speedMbps: 1000 }), { inTree: true }), { width: 2.4, dash: null, grey: false, wavy: false, double: false, tokens: ["1G"] });
  assert.deepEqual(edgeLook(link({ medium: "tunnel", speedMbps: 1000 }), { inTree: true }).tokens, ["1G", "tunnel"]);
});

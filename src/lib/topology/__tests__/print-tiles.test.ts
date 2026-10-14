import { test } from "node:test";
import assert from "node:assert/strict";
import { BOX_H } from "@/lib/topology/tree-layout";
import { MM_PER_PX, PAPER_MM, TILE_HEADER_MM, gridLabelSize, gridSummary, neighbours, planSheets, type SheetPlan } from "@/lib/topology/print-tiles";

// Stampa della mappa (spec topologia §12.3, Review Focus 4). Valori alla lettera: area A4 190 × 277 mm,
// A3 277 × 400 mm, 1 px = 0,2646 mm, sovrapposizione 15 mm. Ogni tassello riserva in testa TILE_HEADER_MM
// (8 mm) per «Foglio r-c di R×C» e le frecce ai vicini: il disegno sta sotto.
const PX = 1 / 0.2646;
const A3 = { paper: "A3", scale: 1, overlapMm: 15 } as const;
const A4 = { paper: "A4", scale: 1, overlapMm: 15 } as const;
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/** Ogni punto del disegno (griglia fitta, bordi compresi) sta in almeno un tassello. */
function assertCovers(plan: SheetPlan, w: number, h: number) {
  for (let x = 0; x <= w; x += Math.max(1, w / 97)) for (let y = 0; y <= h; y += Math.max(1, h / 89)) {
    assert.ok(plan.tiles.some((t) => t.x <= x && x <= t.x + t.w && t.y <= y && y <= t.y + t.h), `punto ${x},${y} fuori da ogni tassello`);
  }
  for (const [x, y] of [[w, h], [0, h], [w, 0]]) assert.ok(plan.tiles.some((t) => t.x <= x && x <= t.x + t.w && t.y <= y && y <= t.y + t.h));
}

test("costanti alla lettera", () => {
  assert.deepEqual(PAPER_MM, { A4: { w: 190, h: 277 }, A3: { w: 277, h: 400 } });
  assert.equal(MM_PER_PX, 0.2646);
  assert.equal(TILE_HEADER_MM, 8);
});

test("un disegno più piccolo di un foglio: un tassello, foglio verticale", () => {
  const p = planSheets({ width: 600, height: 400 }, A4);
  assert.equal(p.tiles.length, 1);
  assert.deepEqual([p.rows, p.cols, p.landscape, p.paper], [1, 1, false, "A4"]);
  assert.deepEqual([p.tiles[0].row, p.tiles[0].col, p.tiles[0].x, p.tiles[0].y], [1, 1, 0, 0]);
  near(p.tiles[0].w, 190 * PX);
  near(p.tiles[0].h, (277 - 8) * PX);
});

test("cliente A, 2.617 × 2.462 px in A3 al 100 %: 2 righe × 3 colonne in verticale (conto a mano)", () => {
  // Conto a mano, 1 mm = 3,7793 px, sovrapposizione 15 mm = 56,69 px:
  //  foglio verticale:  tassello 277 mm = 1046,9 px × (400 − 8) mm = 1481,5 px; passo 990,2 × 1424,8.
  //    colonne: 1046,9 + k·990,2 ≥ 2617 → k ≥ 1,59 → k = 2 → 3 colonne;
  //    righe:   1481,5 + k·1424,8 ≥ 2462 → k ≥ 0,69 → k = 1 → 2 righe. 6 fogli.
  //  foglio orizzontale: tassello 400 mm = 1511,7 px × (277 − 8) mm = 1016,6 px; passo 1455,0 × 959,9.
  //    colonne: 1511,7 + k·1455,0 ≥ 2617 → k ≥ 0,76 → 2 colonne;
  //    righe:   1016,6 + k·959,9 ≥ 2462 → k ≥ 1,51 → 3 righe. 6 fogli.
  //  Pari: vince il verticale.
  const p = planSheets({ width: 2617, height: 2462 }, A3);
  assert.deepEqual([p.rows, p.cols, p.landscape, p.tiles.length], [2, 3, false, 6]);
  near(p.tiles[1].x, (277 - 15) * PX);
  near(p.tiles[3].y, (392 - 15) * PX);
  assertCovers(p, 2617, 2462);
});

test("al 80 % un tassello copre 1/0,8 del disegno e la sovrapposizione resta 15 mm sulla carta", () => {
  const p = planSheets({ width: 2617, height: 2462 }, { ...A3, scale: 0.8 });
  // Verticale:   colonne 1308,6 + k·1237,7 ≥ 2617 → k ≥ 1,06 → 3; righe 1851,9 + k·1781,0 ≥ 2462 → 2 → 6 fogli.
  // Orizzontale: colonne 1889,6 + k·1818,8 ≥ 2617 → k ≥ 0,40 → 2; righe 1270,8 + k·1199,9 ≥ 2462 → k ≥ 0,99 → 2 → 4 fogli.
  // Vince l'orizzontale.
  assert.deepEqual([p.rows, p.cols, p.landscape, p.tiles.length], [2, 2, true, 4]);
  near(p.tiles[0].w, (400 * PX) / 0.8);
  const overlapMm = (p.tiles[0].x + p.tiles[0].w - p.tiles[1].x) * 0.8 * 0.2646;
  near(overlapMm, 15, 1e-3);
  assertCovers(p, 2617, 2462);
});

test("tasselli numerati riga per riga, vicini sovrapposti di 15 mm, nessun buco", () => {
  const w = 9000, h = 5000;
  for (const opts of [A3, A4, { ...A4, scale: 0.8 as const }]) {
    const p = planSheets({ width: w, height: h }, opts);
    assert.equal(p.tiles.length, p.rows * p.cols);
    p.tiles.forEach((t, i) => assert.deepEqual([t.row, t.col], [Math.floor(i / p.cols) + 1, (i % p.cols) + 1]));
    for (const t of p.tiles) {
      const right = p.tiles.find((u) => u.row === t.row && u.col === t.col + 1);
      if (right) near((t.x + t.w - right.x) * opts.scale * 0.2646, 15, 1e-3);
      const below = p.tiles.find((u) => u.col === t.col && u.row === t.row + 1);
      if (below) near((t.y + t.h - below.y) * opts.scale * 0.2646, 15, 1e-3);
    }
    assertCovers(p, w, h);
  }
});

test("un riquadro alto BOX_H tagliato dal bordo di sotto compare intero nel tassello di sotto", () => {
  const p = planSheets({ width: 800, height: 3000 }, A4);
  const t = p.tiles[0];
  const edge = t.y + t.h;
  for (let y = edge - BOX_H + 1; y < edge; y += 3) {
    const box = { y, h: BOX_H };
    const below = p.tiles.find((u) => u.col === t.col && u.row === t.row + 1)!;
    assert.ok(below.y <= box.y && box.y + box.h <= below.y + below.h, `riquadro a y=${y} non intero nel tassello di sotto`);
  }
});

test("con i riquadri, il taglio di un tassello non spezza un riquadro: ricompare intero nel vicino", () => {
  // Riquadri larghi 230 px (più della sovrapposizione) proprio sul bordo destro e sul bordo di sotto del primo tassello.
  const tw = 190 * PX, th = (277 - 8) * PX;
  const boxes = [
    { x: tw - 100, y: 200, w: 230, h: BOX_H },
    { x: tw - 30, y: 600, w: 200, h: BOX_H },
    { x: 300, y: th - 20, w: 200, h: 120 }, // un hypervisor espanso, più alto della sovrapposizione
  ];
  const p = planSheets({ width: 2000, height: 2000, boxes }, A4);
  for (const b of boxes) {
    assert.ok(
      p.tiles.some((t) => t.x <= b.x && b.x + b.w <= t.x + t.w && t.y <= b.y && b.y + b.h <= t.y + t.h),
      `riquadro ${JSON.stringify(b)} non sta intero in nessun tassello`,
    );
  }
  // La sovrapposizione non scende mai sotto i 15 mm.
  for (const t of p.tiles) {
    const right = p.tiles.find((u) => u.row === t.row && u.col === t.col + 1);
    if (right) assert.ok((t.x + t.w - right.x) * 0.2646 >= 15 - 1e-6);
  }
  assertCovers(p, 2000, 2000);
});

test("ogni riquadro di una mappa larga sta intero in almeno un tassello (Review Focus 4)", () => {
  // Una fila di 60 riquadri larghi 170-230 px con 18 px fra l'uno e l'altro, su tre livelli.
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let lvl = 0; lvl < 3; lvl++) {
    let x = 40;
    for (let i = 0; i < 60; i++) { const w = 170 + ((i * 37 + lvl * 11) % 61); boxes.push({ x, y: 40 + lvl * 100, w, h: BOX_H }); x += w + 18; }
  }
  const width = Math.max(...boxes.map((b) => b.x + b.w)) + 40;
  for (const opts of [A3, A4, { ...A3, scale: 0.8 as const }]) {
    const p = planSheets({ width, height: 400, boxes }, opts);
    for (const b of boxes) assert.ok(p.tiles.some((t) => t.x <= b.x && b.x + b.w <= t.x + t.w && t.y <= b.y && b.y + b.h <= t.y + t.h));
    assertCovers(p, width, 400);
  }
});

test("il foglio si gira quando servono meno fogli", () => {
  // Una striscia larga e bassa: in orizzontale stanno in meno fogli.
  const p = planSheets({ width: 4000, height: 900 }, A3);
  assert.equal(p.landscape, true);
  const portrait = Math.ceil((4000 - 277 * PX) / ((277 - 15) * PX)) + 1;
  assert.ok(p.tiles.length < portrait);
  // Alta e stretta: verticale.
  assert.equal(planSheets({ width: 900, height: 4000 }, A3).landscape, false);
});

test("stessi dati, stesso piano", () => {
  const a = planSheets({ width: 5000, height: 3000 }, A4), b = planSheets({ width: 5000, height: 3000 }, A4);
  assert.deepEqual(a, b);
});

test("un tassello che non tocca riquadri è vuoto: non si stampa, non si conta e non ha frecce verso di sé", () => {
  // Due riquadri agli angoli opposti di un disegno largo due fogli e alto due: i due angoli liberi sono vuoti.
  const tw = 190 * PX, th = (277 - 8) * PX;
  const boxes = [{ x: 40, y: 40, w: 200, h: BOX_H }, { x: tw + 300, y: th + 300, w: 200, h: BOX_H }];
  const p = planSheets({ width: tw + 600, height: th + 600, boxes }, A4);
  assert.deepEqual(p.tiles.map((t) => t.empty), [false, true, true, false]);
  assert.equal(p.printed, 2);
  assert.deepEqual(neighbours(p, p.tiles[0]), { up: null, down: null, left: null, right: null });
  // Senza riquadri nessun tassello è vuoto.
  assert.ok(planSheets({ width: tw + 600, height: th + 600 }, A4).tiles.every((t) => !t.empty));
});

test("l'orientamento del foglio conta i tasselli da stampare, non quelli vuoti", () => {
  const p = planSheets({ width: 2617, height: 2462, boxes: [{ x: 40, y: 40, w: 200, h: BOX_H }] }, A3);
  assert.equal(p.printed, 1);
  assert.equal(p.landscape, false);
});

// Task 5, visto nel PDF della copia del cliente A: in orizzontale (13.121 × 930 px, A3 al 100 %) la panoramica
// è una striscia e i numeri «1-3» al 6 % del tassello uscivano alti ~2 mm, illeggibili.
test("numeri della griglia sulla panoramica: almeno 5 mm sulla carta, mai più grandi del tassello", () => {
  const grid = { w: 13121, h: 930 };
  const plan = planSheets({ width: grid.w, height: grid.h }, { paper: "A3", scale: 1, overlapMm: 15 });
  const px = gridLabelSize(plan, grid);
  // La panoramica sta nella larghezza del foglio: 1 px del disegno = pageMm.w / 13.121 mm.
  const mm = px * (plan.pageMm.w / grid.w);
  assert.ok(mm >= 4.9, `alto ${mm.toFixed(2)} mm`);
  const minH = Math.min(...plan.tiles.map((t) => t.h));
  assert.ok(px <= minH * 0.35, "più alto di un terzo del tassello");
  // In verticale (2.608 × 3.078 px) non scende sotto il 6 % del tassello di prima.
  const g2 = { w: 2608, h: 3078 };
  const p2 = planSheets({ width: g2.w, height: g2.h }, { paper: "A3", scale: 1, overlapMm: 15 });
  assert.ok(gridLabelSize(p2, g2) >= Math.min(...p2.tiles.map((t) => Math.min(t.w, t.h))) * 0.06);
});

test("riga del primo foglio: singolare e plurale («1 riga», «1 vuoto non stampato»)", () => {
  assert.equal(gridSummary({ rows: 1, cols: 10, tiles: 10, printed: 10 }), "griglia 1 riga × 10 colonne");
  assert.equal(gridSummary({ rows: 3, cols: 1, tiles: 3, printed: 2 }), "griglia 3 righe × 1 colonna, 1 vuoto non stampato");
  assert.equal(gridSummary({ rows: 4, cols: 4, tiles: 16, printed: 13 }), "griglia 4 righe × 4 colonne, 3 vuoti non stampati");
});

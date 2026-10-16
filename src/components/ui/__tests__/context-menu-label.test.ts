/**
 * L'intestazione di un menu del tasto destro (il nome dell'oggetto, la linea in
 * parole) sta in testa al menu, fuori da ogni gruppo.
 *
 * Difetto visto a schermo il 2026-10-14 (topologia fase 2b, Task 12): il
 * wrapper usava `ContextMenu.GroupLabel` di base-ui, che fuori da un
 * `<ContextMenu.Group>` lancia «MenuGroupRootContext is missing»: il tasto
 * destro su un oggetto o su una linea della mappa faceva cadere la pagina.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextMenuLabel } from "../context-menu";

describe("ContextMenuLabel", () => {
  it("si disegna anche fuori da un gruppo, senza far cadere il menu", () => {
    const html = renderToStaticMarkup(h(ContextMenuLabel, { title: "SW-A" }, "SW-A"));
    assert.match(html, /SW-A/);
    assert.match(html, /text-\[13px\]/);
  });
});

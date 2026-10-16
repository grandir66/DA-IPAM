/**
 * Il trigger di un <Select> deve mostrare l'ETICHETTA della voce scelta, non il
 * suo valore tecnico.
 *
 * Difetto UI-1 (analisi di sistema 2026-10-12): base-ui 1.3.0 risolve l'etichetta
 * di <Select.Value> solo dalla prop `items` della Root; nessuna delle ~74 <Select>
 * del progetto la passava, quindi i filtri mostravano "all", "critical_high",
 * "unacked" o l'id numerico di una rete al posto del testo dell'opzione.
 * Il wrapper `Select` ora ricava `items` dalle <SelectItem> figlie.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../select";

function trigger(value: string | null, content: ReturnType<typeof h>[]): string {
  return renderToStaticMarkup(
    h(
      Select,
      { value },
      h(SelectTrigger, null, h(SelectValue, { placeholder: "Stato" })),
      h(SelectContent, null, ...content),
    ),
  );
}

describe("Select: il trigger mostra l'etichetta della voce scelta", () => {
  it("voce scritta direttamente", () => {
    const html = trigger("all", [
      h(SelectItem, { key: "all", value: "all" }, "Tutti gli stati"),
      h(SelectItem, { key: "on", value: "online" }, "Online"),
    ]);
    assert.match(html, /Tutti gli stati/);
    assert.doesNotMatch(html, />all</);
  });

  it("voci da un .map(), dentro gruppi e frammenti", () => {
    const reti = [{ id: 7, nome: "LAN uffici" }, { id: 9, nome: "Server" }];
    const html = trigger("9", [
      h(
        SelectGroup,
        { key: "g" },
        h(Fragment, null, reti.map((r) => h(SelectItem, { key: r.id, value: String(r.id) }, r.nome))),
      ),
    ]);
    assert.match(html, /Server/);
    assert.doesNotMatch(html, />9</);
  });

  it("senza valore resta il segnaposto", () => {
    const html = trigger(null, [h(SelectItem, { key: "all", value: "all" }, "Tutti gli stati")]);
    assert.match(html, /Stato/);
  });

  it("items passati a mano hanno la precedenza", () => {
    const html = renderToStaticMarkup(
      h(
        Select,
        { value: "x", items: [{ value: "x", label: "Etichetta esplicita" }] },
        h(SelectTrigger, null, h(SelectValue, null)),
        h(SelectContent, null, h(SelectItem, { value: "x" }, "Etichetta figlia")),
      ),
    );
    assert.match(html, /Etichetta esplicita/);
  });
});

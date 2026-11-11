// Esportazione draw.io della Topologia (Riccardo, 11/11/2026): sulla fixture anonima dell'hub ogni riquadro
// della disposizione diventa una forma e ogni linea ha i due estremi fra le forme scritte.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { mappaDrawio } from "../drawio";
import { buildTopologyModel } from "../model";
import type { TopologyModelInput } from "../model-types";
import { computeMapView } from "../map-compute";

test("draw.io: una forma per riquadro, linee agganciate a forme esistenti, testo protetto", () => {
  const input = { macPorts: [], primaries: [], portInfo: [], vms: [], scanHosts: [], ...JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "topologia-domarc.json"), "utf8")) } as TopologyModelInput;
  const base = buildTopologyModel(input);
  const c = computeMapView(base, { auto: true, members: [], roots: [], head: null, tweaks: [], expanded: new Set(), orientation: "lr" });
  const nodi = new Map(c.model.nodes.map((n) => [n.id, { ...n, name: n.id === c.tree.roots[0] ? 'A & "B" <c>' : n.name }]));
  const xml = mappaDrawio({ titolo: "Prova", nodi, via: c.tree.via, links: c.tree.links, layout: c.layout });
  const ids = new Set([...xml.matchAll(/<mxCell id="([^"]*)"[^>]*vertex="1"/g)].map((m) => m[1]));
  for (const id of c.layout.nodes.keys()) assert.ok(ids.has(id), id);
  const linee = [...xml.matchAll(/edge="1" parent="1" source="([^"]*)" target="([^"]*)"/g)];
  assert.ok(linee.length > 0);
  for (const [, da, a] of linee) assert.ok(ids.has(da) && ids.has(a), `${da} -> ${a}`);
  assert.ok(xml.includes("A &amp;amp; &quot;B&quot; &amp;lt;c&amp;gt;"));
  // 11/11, «le righe non rimangono separate»: ogni linea dell'albero esce e entra da un punto fisso, e gli attaccati
  // non hanno linee (sono figli del loro riquadro, scritti dopo di lui).
  const albero = [...xml.matchAll(/<mxCell id="t:[^"]*"[^>]*style="([^"]*)"/g)];
  assert.ok(albero.length > 0 && albero.every(([, st]) => st.includes("exitX=") && st.includes("entryX=")));
  assert.ok(!/<mxCell id="a:/.test(xml), "nessuna linea verso un attaccato");
  for (const ln of c.layout.nodes.values()) {
    if (ln.role !== "attached" || !ln.parent) continue;
    const io = xml.indexOf(`<mxCell id="${ln.id}"`), padre = xml.indexOf(`<mxCell id="${ln.parent}"`);
    assert.ok(padre >= 0 && padre < io, `${ln.id} dopo ${ln.parent}`);
  }
  // 11/11, mappa dell'hub: le ridondanze su un livello a parte, nascosto di base, e nessuna fra le linee dell'albero.
  const rid = [...xml.matchAll(/<UserObject id="x:[^"]*"[^>]*><mxCell[^>]*parent="([^"]*)" source="([^"]*)" target="([^"]*)"/g)];
  assert.ok(rid.length > 0 && rid.every(([, p, da, a]) => p === "ridondanze" && ids.has(da) && ids.has(a)));
  assert.ok(xml.includes('<mxCell id="ridondanze" value="Ridondanze" parent="0" visible="0"/>'));
  assert.ok(!mappaDrawio({ titolo: "Prova", nodi, via: c.tree.via, links: c.tree.links, layout: c.layout, ridondanzeVisibili: true }).includes('visible="0"'));
  assert.ok(xml.startsWith("<?xml") && xml.trimEnd().endsWith("</mxfile>"));
});

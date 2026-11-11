/**
 * La mappa della Topologia come documento draw.io (diagrams.net), per portarla fuori dall'app
 * (Riccardo, 11/11/2026: «la generazione di un documento di draw.io per l'esportazione»).
 *
 * Funzione pura: prende la stessa disposizione che si vede a schermo (`LayoutResult`) e scrive
 * l'XML `mxfile`. Ogni riquadro è una forma vera e ogni collegamento una linea agganciata ai suoi
 * due estremi: in draw.io si spostano i riquadri e le linee seguono. Le parole sulle linee sono
 * quelle di `edgeLook`, le stesse dello schermo.
 */
import { edgeLook } from "./edge-look";
import { drawableLinks, moreAttachedAt } from "./map-screen";
import type { MapLink } from "./model-types";
import type { LayoutResult } from "./tree-layout";

export interface NodoDrawio { name: string; type: string; mgmtIp: string | null }

export interface MappaDrawio {
  titolo: string;
  nodi: ReadonlyMap<string, NodoDrawio>;
  /** Il collegamento con cui ogni nodo è appeso al genitore (`tree.via`). */
  via: ReadonlyMap<string, MapLink>;
  /** I collegamenti fra nodi visibili (`tree.links`): da qui le ridondanze. */
  links: readonly MapLink[];
  layout: LayoutResult;
}

const NAVY = "#0D2537";
const GRIGIO = "#8A8A8A";

/** Testo dentro un attributo XML. */
function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
}

/** Un'etichetta draw.io (`html=1`): prima HTML, poi attributo; le righe diventano `<br>`. */
function etichetta(righe: Array<string | null>): string {
  const html = righe.filter((r): r is string => !!r).map((r) => r.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("<br>");
  return attr(html);
}

function forma(id: string, valore: string, stile: string, b: { x: number; y: number; w: number; h: number }): string {
  return `<mxCell id="${attr(id)}" value="${valore}" style="${stile}" vertex="1" parent="1"><mxGeometry x="${Math.round(b.x)}" y="${Math.round(b.y)}" width="${Math.round(b.w)}" height="${Math.round(b.h)}" as="geometry"/></mxCell>`;
}

function linea(id: string, da: string, a: string, valore: string, stile: string): string {
  return `<mxCell id="${attr(id)}" value="${valore}" style="${stile}" edge="1" parent="1" source="${attr(da)}" target="${attr(a)}"><mxGeometry relative="1" as="geometry"/></mxCell>`;
}

function stileLinea(l: MapLink, inTree: boolean, nomeDi: (id: string) => string): { valore: string; stile: string } {
  const look = edgeLook(l, { inTree, nomeDi });
  const colore = look.grey && !look.nero ? GRIGIO : NAVY;
  const tratto = look.dash ? `dashed=1;dashPattern=${look.dash};` : "";
  return {
    valore: etichetta([look.tokens.join(" · ")]),
    stile: `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;strokeColor=${colore};strokeWidth=${Math.max(1, Math.round(look.width))};${tratto}fontSize=11;labelBackgroundColor=#ffffff;`,
  };
}

export function mappaDrawio(m: MappaDrawio): string {
  const { layout } = m;
  const nomeDi = (id: string): string => m.nodi.get(id)?.name ?? id;
  const celle: string[] = [];

  // Sotto a tutto: il riquadro tratteggiato che raccoglie gli access point di un apparato.
  for (const g of layout.apGroups) {
    celle.push(forma(`apg:${g.parent}`, etichetta([`${g.count} AP`]), `rounded=1;html=1;dashed=1;fillColor=#F5F5F5;strokeColor=${GRIGIO};verticalAlign=top;align=left;spacingLeft=6;fontSize=11;fontColor=${GRIGIO};`, g));
  }
  for (const ln of layout.nodes.values()) {
    const n = m.nodi.get(ln.id);
    const nome = n?.name ?? ln.id;
    if (ln.role === "attached") {
      celle.push(forma(ln.id, etichetta([n?.mgmtIp && n.mgmtIp !== nome ? `${nome} · ${n.mgmtIp}` : nome]), `text;html=1;align=left;verticalAlign=middle;spacingLeft=4;fontSize=11;fontColor=${NAVY};strokeColor=none;fillColor=none;`, ln));
      continue;
    }
    const pieno = ln.role === "box";
    celle.push(forma(ln.id, etichetta([nome, n?.mgmtIp && n.mgmtIp !== nome ? n.mgmtIp : null, n?.type ?? null]),
      `rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=${NAVY};strokeWidth=${pieno ? 2 : 1};fontColor=${NAVY};fontSize=${pieno ? 12 : 11};`, ln));
  }
  for (const c of layout.vmChips) {
    celle.push(forma(`vmchip:${c.vmId}`, etichetta([c.label]), `rounded=1;html=1;fillColor=#EDEDED;strokeColor=${GRIGIO};fontSize=10;fontColor=${NAVY};`, c));
  }
  for (const [parent, quanti] of layout.moreAttached) {
    const b = layout.nodes.get(parent);
    if (!b) continue;
    const at = moreAttachedAt(layout.orientation, b);
    celle.push(forma(`more:${parent}`, etichetta([`+ altri ${quanti}`]), `text;html=1;align=left;fontSize=11;fontColor=${GRIGIO};strokeColor=none;fillColor=none;`, { x: at.x, y: at.y, w: 120, h: 18 }));
  }

  const apFatti = new Set<string>();
  const base = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;strokeColor=${NAVY};`;
  for (const [figlio, link] of m.via) {
    const ln = layout.nodes.get(figlio);
    if (!ln || !ln.parent) continue;
    if (ln.role === "attached") {
      celle.push(linea(`a:${figlio}`, ln.parent, figlio, "", `${base}strokeWidth=1;strokeColor=${GRIGIO};`));
    } else if (ln.role === "ap") {
      if (apFatti.has(ln.parent)) continue;
      apFatti.add(ln.parent);
      celle.push(linea(`t:apg:${ln.parent}`, ln.parent, `apg:${ln.parent}`, "", `${base}strokeWidth=1;`));
    } else {
      const s = stileLinea(link, true, nomeDi);
      celle.push(linea(`t:${figlio}`, ln.parent, figlio, s.valore, s.stile));
    }
  }
  for (const l of drawableLinks(m.links, layout.nodes)) {
    if (!l.redundant) continue;
    const s = stileLinea(l, false, nomeDi);
    celle.push(linea(`x:${l.id}`, l.a, l.b, s.valore, s.stile));
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<mxfile host="DA-IPAM">`,
    `<diagram name="${attr(m.titolo)}">`,
    `<mxGraphModel dx="${Math.round(layout.width)}" dy="${Math.round(layout.height)}" grid="1" gridSize="10" page="0" math="0" shadow="0">`,
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>`,
    ...celle,
    `</root></mxGraphModel></diagram></mxfile>`,
  ].join("\n");
}

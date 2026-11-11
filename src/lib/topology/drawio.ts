/**
 * La mappa della Topologia come documento draw.io (diagrams.net), per portarla fuori dall'app
 * (Riccardo, 11/11/2026: «la generazione di un documento di draw.io per l'esportazione»).
 *
 * Funzione pura: prende la stessa disposizione che si vede a schermo (`LayoutResult`) e scrive
 * l'XML `mxfile`. Ogni riquadro è una forma vera e ogni collegamento una linea agganciata ai suoi
 * due estremi: in draw.io si spostano i riquadri e le linee seguono. Le parole sulle linee sono
 * quelle di `edgeLook`, le stesse dello schermo.
 *
 * Le linee dell'albero hanno il percorso dello schermo e della stampa (`stepPoints`: uscita, tronco, braccio verso il
 * figlio) scritto come punti fissi, e la scritta a metà del braccio: lasciate al tracciato automatico di draw.io
 * partivano tutte dal centro del lato e si sovrapponevano con le parole una sull'altra (Riccardo, 11/11/2026: «quasi
 * illeggibile, le righe non rimangono separate»). Gli attaccati non hanno linee: sono figli del loro riquadro, che li
 * porta con sé quando lo si sposta. Le ridondanze sono curve tratteggiate, così non si confondono coi tronchi.
 */
import { edgeLook } from "./edge-look";
import { drawableLinks, moreAttachedAt } from "./map-screen";
import { stepPoints } from "./print-draw";
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
  /** «Mostra ridondanze» com'è a schermo: decide se il livello delle ridondanze nasce visibile (di base nascosto). */
  ridondanzeVisibili?: boolean;
}

const NAVY = "#0D2537";
const GRIGIO = "#8A8A8A";
/** Le ridondanze: più chiare dell'albero, si distinguono per luminanza e per il tratto a puntini. */
const CHIARO = "#A8A8A8";

/** Testo dentro un attributo XML. */
function attr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");
}

/** Testo dentro un'etichetta HTML di draw.io. */
function testo(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Un'etichetta draw.io (`html=1`): prima HTML, poi attributo; le righe diventano `<br>`. */
function etichetta(righe: Array<string | null>): string {
  const html = righe.filter((r): r is string => !!r).map((r) => r.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")).join("<br>");
  return attr(html);
}

function forma(id: string, valore: string, stile: string, b: { x: number; y: number; w: number; h: number }, padre = "1"): string {
  return `<mxCell id="${attr(id)}" value="${valore}" style="${stile}" vertex="1" parent="${attr(padre)}"><mxGeometry x="${Math.round(b.x)}" y="${Math.round(b.y)}" width="${Math.round(b.w)}" height="${Math.round(b.h)}" as="geometry"/></mxCell>`;
}

interface Pt { x: number; y: number }

/**
 * Una linea coi punti intermedi fissi (`punti` comprende i due estremi, che draw.io aggancia alle forme) e la scritta
 * a metà dell'ultimo tratto, sopra la linea: è il braccio che arriva al figlio, l'unico che non divide con i fratelli.
 */
function linea(id: string, da: string, a: string, valore: string, stile: string, punti: readonly Pt[] = []): string {
  const interni = punti.slice(1, -1);
  const lung = (i: number) => Math.abs(punti[i + 1].x - punti[i].x) + Math.abs(punti[i + 1].y - punti[i].y);
  let dove = "";
  if (valore && punti.length >= 2) {
    const tratti = punti.slice(0, -1).map((_, i) => lung(i));
    const tot = tratti.reduce((x, y) => x + y, 0);
    const fino = tot - tratti[tratti.length - 1] / 2;
    dove = tot > 0 ? ` x="${Math.round(((2 * fino) / tot - 1) * 100) / 100}" y="-9"` : "";
  }
  const pts = interni.length ? `<Array as="points">${interni.map((q) => `<mxPoint x="${Math.round(q.x)}" y="${Math.round(q.y)}"/>`).join("")}</Array>` : "";
  return `<mxCell id="${attr(id)}" value="${valore}" style="${stile}" edge="1" parent="1" source="${attr(da)}" target="${attr(a)}"><mxGeometry${dove} relative="1" as="geometry">${pts}</mxGeometry></mxCell>`;
}

function stileLinea(l: MapLink, inTree: boolean, nomeDi: (id: string) => string): { valore: string; stile: string } {
  const look = edgeLook(l, { inTree, nomeDi });
  const colore = look.grey && !look.nero ? GRIGIO : NAVY;
  const tratto = look.dash ? `dashed=1;dashPattern=${look.dash};` : "";
  return {
    valore: etichetta([look.tokens.join(" · ")]),
    stile: `${inTree ? "edgeStyle=orthogonalEdgeStyle;rounded=0;" : "edgeStyle=none;curved=1;dashed=1;"}html=1;endArrow=none;strokeColor=${colore};strokeWidth=${Math.max(1, Math.round(look.width))};${tratto}fontSize=10;labelBackgroundColor=#ffffff;`,
  };
}

export function mappaDrawio(m: MappaDrawio): string {
  const { layout } = m;
  const nomeDi = (id: string): string => m.nodi.get(id)?.name ?? id;
  const celle: string[] = [];
  // Un attaccato è figlio del suo riquadro: le coordinate di un figlio sono relative al genitore.
  const relativo = (b: { x: number; y: number; w: number; h: number }, padre: string | null) => {
    const p = padre ? layout.nodes.get(padre) : undefined;
    return p ? { x: b.x - p.x, y: b.y - p.y, w: b.w, h: b.h } : b;
  };
  // Da dove esce e dove entra una linea dell'albero: come a schermo, dal lato verso i figli.
  const agganci = layout.orientation === "lr" ? "exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" : "exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;";

  // Sotto a tutto: il riquadro tratteggiato che raccoglie gli access point di un apparato.
  for (const g of layout.apGroups) {
    celle.push(forma(`apg:${g.parent}`, etichetta([`${g.count} AP`]), `rounded=1;html=1;dashed=1;fillColor=#F5F5F5;strokeColor=${GRIGIO};verticalAlign=top;align=left;spacingLeft=6;fontSize=11;fontColor=${GRIGIO};`, g));
  }
  // Prima i riquadri, poi gli attaccati: un figlio va scritto dopo il suo genitore.
  const inOrdine = [...layout.nodes.values()].sort((a, b) => Number(a.role === "attached") - Number(b.role === "attached"));
  for (const ln of inOrdine) {
    const n = m.nodi.get(ln.id);
    const nome = n?.name ?? ln.id;
    if (ln.role === "attached") {
      celle.push(forma(ln.id, etichetta([n?.mgmtIp && n.mgmtIp !== nome ? `${nome} · ${n.mgmtIp}` : nome]), `text;html=1;align=left;verticalAlign=middle;spacingLeft=4;fontSize=11;fontColor=${NAVY};strokeColor=none;fillColor=none;`, relativo(ln, ln.parent), ln.parent && layout.nodes.has(ln.parent) ? ln.parent : "1"));
      continue;
    }
    const pieno = ln.role === "box";
    // Due righe come a schermo (nome in grassetto, sotto «tipo · indirizzo»): tre righe non stavano nel riquadro.
    const sotto = [n?.type ? n.type.replace(/_/g, " ") : null, n?.mgmtIp && n.mgmtIp !== nome ? n.mgmtIp : null].filter(Boolean).join(" · ");
    const html = `<b>${testo(nome)}</b>${sotto ? `<br><font style="font-size:9px">${testo(sotto)}</font>` : ""}`;
    celle.push(forma(ln.id, attr(html),
      `rounded=1;whiteSpace=nowrap;overflow=hidden;html=1;align=left;spacingLeft=8;fillColor=#ffffff;strokeColor=${NAVY};strokeWidth=${pieno ? 2 : 1};fontColor=${NAVY};fontSize=11;`, ln));
  }
  for (const c of layout.vmChips) {
    celle.push(forma(`vmchip:${c.vmId}`, etichetta([c.label]), `rounded=1;html=1;fillColor=#EDEDED;strokeColor=${GRIGIO};fontSize=10;fontColor=${NAVY};`, c));
  }
  for (const [parent, quanti] of layout.moreAttached) {
    const b = layout.nodes.get(parent);
    if (!b) continue;
    const at = moreAttachedAt(layout.orientation, b);
    celle.push(forma(`more:${parent}`, etichetta([`+ altri ${quanti}`]), `text;html=1;align=left;fontSize=11;fontColor=${GRIGIO};strokeColor=none;fillColor=none;`, { x: at.x - b.x, y: at.y - b.y, w: 120, h: 18 }, parent));
  }

  // I riquadri vanno scritti prima dei loro figli: draw.io legge i genitori in ordine.
  const apFatti = new Set<string>();
  const base = `edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=none;strokeColor=${NAVY};${agganci}`;
  for (const [figlio, link] of m.via) {
    const ln = layout.nodes.get(figlio);
    const padre = ln?.parent ? layout.nodes.get(ln.parent) : undefined;
    if (!ln || !ln.parent || !padre || ln.role === "attached") continue;
    if (ln.role === "ap") {
      const g = layout.apGroups.find((x) => x.parent === ln.parent);
      if (!g || apFatti.has(ln.parent)) continue;
      apFatti.add(ln.parent);
      celle.push(linea(`t:apg:${ln.parent}`, ln.parent, `apg:${ln.parent}`, "", `${base}strokeWidth=1;`, stepPoints(layout.orientation, padre, g)));
    } else {
      const s = stileLinea(link, true, nomeDi);
      celle.push(linea(`t:${figlio}`, ln.parent, figlio, s.valore, `${s.stile}${agganci}`, stepPoints(layout.orientation, padre, ln)));
    }
  }
  // Le ridondanze stanno su un livello loro («Ridondanze»), che in draw.io si accende e si spegne da Visualizza › Livelli:
  // disegnate insieme all'albero coprivano tutto (Riccardo, 11/11/2026, mappa dell'hub: «difficilmente gestibile con
  // tutti i link che si sovrappongono; se sono link secondari cambia colore oppure troviamo un sistema»). Sono sottili,
  // grigio chiaro e a puntini, senza scritta sulla linea: le parole si leggono passandoci sopra col mouse. Nasce nascosto
  // come a schermo, visibile se «Mostra ridondanze» era acceso.
  const ridondanze: string[] = [];
  for (const l of drawableLinks(m.links, layout.nodes)) {
    if (!l.redundant) continue;
    const parole = edgeLook(l, { inTree: false, nomeDi }).tokens.join(" · ");
    ridondanze.push(`<UserObject id="${attr(`x:${l.id}`)}" label="" tooltip="${attr(parole)}"><mxCell style="edgeStyle=none;curved=1;html=1;endArrow=none;dashed=1;dashPattern=1 4;strokeColor=${CHIARO};strokeWidth=1;" edge="1" parent="ridondanze" source="${attr(l.a)}" target="${attr(l.b)}"><mxGeometry relative="1" as="geometry"/></mxCell></UserObject>`);
  }
  if (ridondanze.length) celle.push(`<mxCell id="ridondanze" value="Ridondanze" parent="0"${m.ridondanzeVisibili ? "" : ' visible="0"'}/>`, ...ridondanze);

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

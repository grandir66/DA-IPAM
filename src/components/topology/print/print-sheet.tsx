/**
 * I fogli della stampa (spec topologia §12.3, §12.5). Primo foglio: nome della mappa, data e ora
 * italiana, la panoramica della mappa intera con la griglia dei fogli «riga-colonna», la legenda e,
 * sotto, l'elenco «Cavi di ridondanza» (oggetto · porta → oggetto · porta, velocità), che continua
 * sui fogli dopo se non ci sta. Poi un foglio per tassello, con in testa «Foglio r-c di R×C» e le
 * frecce ai vicini. Ogni foglio è grande quanto l'area stampabile (margini di 10 mm in `@page`);
 * carta bianca e inchiostro nero anche col tema scuro dell'app.
 */
import type { CSSProperties, ReactNode } from "react";
import { FUSO_UTENTI } from "@/lib/db-date";
import { edgeLook, wavyPath } from "@/lib/topology/edge-look";
import { LINK_ATTRS_DEFAULT, type MapLink, type TopologyModel } from "@/lib/topology/model-types";
import { DARK, GREY, INK, LIGHT, MID, PAPER, printStrokes, type RedundantCable } from "@/lib/topology/print-draw";
import { TILE_HEADER_MM, cablePages, cableRows, gridLabelSize, gridSummary, neighbours, type SheetPlan, type Tile } from "@/lib/topology/print-tiles";
import type { PrintView } from "@/lib/topology/print-view";
import type { TopologyStatus } from "@/lib/topology/types";
import { PrintMap, PrintMapContent } from "./print-map";

/** Mezzo millimetro in meno dell'area: un foglio esattamente alto quanto la pagina può spingere una pagina bianca. */
const SAFE_MM = 0.5;

const sheetStyle = (plan: SheetPlan, extra?: CSSProperties): CSSProperties => ({
  width: `${plan.pageMm.w}mm`, height: `${plan.pageMm.h - SAFE_MM}mm`, background: PAPER, color: INK, ...extra,
});

export function Sheet({ plan, children, style }: { plan: SheetPlan; children: ReactNode; style?: CSSProperties }) {
  return <section className="stampa-foglio overflow-hidden" style={sheetStyle(plan, style)}>{children}</section>;
}

function sample(over: Partial<MapLink>, inTree = true) {
  const l: MapLink = {
    id: "legenda", a: "a", aPort: "", b: "b", bPort: "", source: "lldp", sources: ["lldp"], uplinkFrom: null, lastSeen: null,
    daysUnseen: 9, stale: false, ...LINK_ATTRS_DEFAULT, ...over,
  };
  return edgeLook(l, { inTree });
}

/** Un tratto di prova della legenda, 48 × 14 px. */
function LineSample({ over, inTree = true }: { over: Partial<MapLink>; inTree?: boolean }) {
  const look = sample(over, inTree);
  const pts = [{ x: 2, y: 7 }, { x: 46, y: 7 }];
  const d = look.wavy ? wavyPath(pts) : "M2 7 L46 7";
  return (
    <svg width={48} height={14} aria-hidden="true" className="shrink-0">
      {printStrokes(look).map((s, i) => (
        <path key={i} d={d} stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash ?? undefined} strokeLinecap={s.cap} fill="none" />
      ))}
    </svg>
  );
}

function BoxSample({ thick, dashed, fill = PAPER, stroke = INK }: { thick?: boolean; dashed?: boolean; fill?: string; stroke?: string }) {
  return (
    <svg width={48} height={14} aria-hidden="true" className="shrink-0">
      <rect x={2} y={1.5} width={44} height={11} rx={2.5} fill={fill} stroke={stroke} strokeWidth={thick ? 2.6 : 1.2} strokeDasharray={dashed ? "4 2.5" : undefined} />
    </svg>
  );
}

function Item({ sample: s, children }: { sample: ReactNode; children: ReactNode }) {
  return <li className="flex items-center gap-1.5 leading-tight" style={{ breakInside: "avoid" }}>{s}<span>{children}</span></li>;
}

export function Legend({ withVms }: { withVms: boolean }) {
  return (
    <div>
      <h2 className="mb-1 text-[14px] font-semibold">Legenda</h2>
      <ul className="grid gap-x-4 gap-y-1 text-[13px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(62mm, 1fr))" }}>
        <Item sample={<LineSample over={{ speedMbps: 10000 }} />}>«10G» e oltre: tratto più spesso</Item>
        <Item sample={<LineSample over={{ speedMbps: 2500 }} />}>«2,5G»</Item>
        <Item sample={<LineSample over={{ speedMbps: 1000 }} />}>«1G»; senza scritta: velocità non nota</Item>
        <Item sample={<LineSample over={{ speedMbps: 100 }} />}>«100M» e meno: tratto sottile</Item>
        <Item sample={<LineSample over={{ medium: "wireless" }} />}>ondulata «≋ Wi-Fi»: senza fili</Item>
        <Item sample={<LineSample over={{ medium: "fibra" }} />}>«fibra» scritto sulla linea</Item>
        <Item sample={<LineSample over={{ stale: true }} />}>grigia tratteggiata: «non visto da N g» sulle porte</Item>
        <Item sample={<LineSample over={{ manual: { confirmed: true } }} />}>«✎ ✓» a mano, le letture lo confermano</Item>
        <Item sample={<LineSample over={{ manual: { confirmed: false } }} />}>puntinata «✎ ?»: solo a mano, non confermato</Item>
        <Item sample={<span className="w-12 shrink-0 text-center">⚡</span>}>«⚡ N W»: PoE sulla porta</Item>
        <Item sample={<span className="w-12 shrink-0 text-center">★</span>}>principale scelto a mano</Item>
        <Item sample={<span className="w-12 shrink-0 text-center text-[13px]" style={{ color: DARK }}>a → b</span>}>porta del genitore → porta dell&apos;oggetto</Item>
        <Item sample={<BoxSample thick />}>bordo spesso «▲ giù»: non risponde</Item>
        <Item sample={<BoxSample />}>«◆ avviso», «?» stato sconosciuto</Item>
        <Item sample={<BoxSample dashed />}>bordo tratteggiato: host da promuovere</Item>
        <Item sample={<BoxSample fill={LIGHT} stroke={MID} />}>attaccati (fino a 4, poi «+ altri N») e «N AP»</Item>
        {withVms && <Item sample={<BoxSample fill={LIGHT} />}>VM «▶» accesa; bordo tratteggiato «■» spenta</Item>}
      </ul>
    </div>
  );
}

export function CableTable({ rows, from, total, continued }: { rows: RedundantCable[]; from: number; total: number; continued?: boolean }) {
  const cell = "overflow-hidden text-ellipsis whitespace-nowrap px-1 text-left";
  return (
    <div>
      <h2 className="mb-0.5 text-[14px] font-semibold">
        Cavi di ridondanza{continued ? " (segue)" : ""}{" "}
        <span className="font-normal" style={{ color: DARK }}>
          {total === 0
            ? "— nessuno fra gli oggetti della mappa"
            : `— ${total}, non disegnati sulla mappa${rows.length < total ? ` (righe ${from + 1}-${from + rows.length})` : ""}`}
        </span>
      </h2>
      {rows.length > 0 && (
        <table className="w-full table-fixed border-collapse text-[13px] leading-[4.8mm]">
          <colgroup><col style={{ width: "4%" }} /><col style={{ width: "27%" }} /><col style={{ width: "18%" }} /><col style={{ width: "4%" }} /><col style={{ width: "27%" }} /><col style={{ width: "12%" }} /><col style={{ width: "8%" }} /></colgroup>
          <thead>
            <tr style={{ borderBottom: `1px solid ${INK}` }}>
              <th className={cell}>n.</th><th className={cell}>oggetto</th><th className={cell}>porta</th><th className={cell} />
              <th className={cell}>oggetto</th><th className={cell}>porta</th><th className={cell}>velocità</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${LIGHT}` }}>
                <td className={cell} style={{ color: DARK }}>{from + i + 1}</td>
                <td className={cell} title={r.from}>{r.from}</td>
                <td className={cell} title={r.fromPort}>{r.fromPort}</td>
                <td className={cell}>→</td>
                <td className={cell} title={r.to}>{r.to}</td>
                <td className={cell} title={r.toPort}>{r.toPort}</td>
                <td className={cell}>{r.speed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** «Foglio 2-3 di 2×3 · nome» e le frecce ai fogli vicini. */
export function TileHeader({ plan, tile, title }: { plan: SheetPlan; tile: Tile; title: string }) {
  const nb = neighbours(plan, tile);
  const arrows = [nb.up && `↑ ${nb.up}`, nb.left && `← ${nb.left}`, nb.right && `→ ${nb.right}`, nb.down && `↓ ${nb.down}`].filter(Boolean);
  return (
    <header
      className="flex items-center justify-between gap-4 px-1 text-[13px]"
      style={{ height: `${TILE_HEADER_MM - SAFE_MM}mm`, borderBottom: `1px solid ${GREY}` }}
    >
      <span className="truncate">
        <strong className="text-[15px]">Foglio {tile.row}-{tile.col}</strong> di {plan.rows}×{plan.cols} · {title}
      </span>
      <span className="shrink-0 font-semibold" aria-label="fogli vicini">{arrows.join("   ") || "foglio unico"}</span>
    </header>
  );
}

const quando = new Intl.DateTimeFormat("it-IT", {
  timeZone: FUSO_UTENTI, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
});

type Model = TopologyModel & { status?: Record<string, TopologyStatus> };

/** Tutti i fogli in fila: il primo (panoramica, legenda, cavi di ridondanza), il seguito dei cavi, i tasselli. */
export function PrintSheets({ view, plan, cables, at, withVms }: {
  view: Extract<PrintView<Model>, { ok: true }>; plan: SheetPlan; cables: RedundantCable[]; at: Date; withVms: boolean;
}) {
  const { first, perPage } = cableRows(plan.pageMm);
  const L = view.layout;
  const content = <PrintMapContent model={view.model} tree={view.tree} layout={L} orientation={view.orientation} />;
  const gridW = Math.max(L.width, ...plan.tiles.map((t) => t.x + t.w)), gridH = Math.max(L.height, ...plan.tiles.map((t) => t.y + t.h));
  // La griglia dei fogli sulla panoramica: numeri alti almeno 5 mm sulla carta (gridLabelSize), tratto sottile a ogni scala.
  const label = gridLabelSize(plan, { w: gridW, h: gridH });
  const grid = (
    <g>
      {plan.tiles.map((t) => (
        <g key={`${t.row}-${t.col}`}>
          <rect x={t.x} y={t.y} width={t.w} height={t.h} fill="none" stroke={INK} strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          <text
            x={t.x + t.w / 2} y={t.y + t.h / 2} textAnchor="middle" dominantBaseline="middle" fontSize={label} fontWeight={700}
            stroke={PAPER} strokeWidth={label / 6} paintOrder="stroke" fill={INK} fontFamily="var(--font-signika), Signika, sans-serif"
          >
            {t.row}-{t.col}{t.empty ? " vuoto" : ""}
          </text>
        </g>
      ))}
    </g>
  );
  return (
    <>
      <style>{`@page { size: ${plan.paper} ${plan.landscape ? "landscape" : "portrait"}; margin: 10mm; }`}</style>
      <Sheet plan={plan} style={{ display: "flex", flexDirection: "column", gap: "3mm" }}>
        <header>
          <h1 className="text-[20px] leading-tight font-bold">Topologia — {view.title}</h1>
          <p className="text-[13px]">
            Stampata il {quando.format(at)} · disposizione {view.orientation === "lr" ? "verticale" : "orizzontale"} ·{" "}
            foglio {plan.paper} {plan.landscape ? "orizzontale" : "verticale"} · scala {Math.round(plan.scale * 100)} % ·{" "}
            mappa in {plan.printed === 1 ? "un foglio" : `${plan.printed} fogli`}
            {plan.tiles.length > 1 ? ` (${gridSummary({ rows: plan.rows, cols: plan.cols, tiles: plan.tiles.length, printed: plan.printed })})` : ""}
            {withVms ? " · con le VM" : ""}
            {view.missing > 0 ? ` · ${view.missing} oggetti salvati non sono più nell'inventario` : ""}
          </p>
        </header>
        <div className="min-h-0 flex-1">
          <PrintMap
            model={view.model} tree={view.tree} layout={L} orientation={view.orientation} label={`Panoramica della mappa ${view.title} con la griglia dei fogli`}
            viewBox={{ x: 0, y: 0, w: gridW, h: gridH }} width="100%" height="100%" content={content} overlay={grid}
          />
        </div>
        <Legend withVms={withVms} />
        <CableTable rows={cables.slice(0, first)} from={0} total={cables.length} />
      </Sheet>
      {cablePages(cables.length, plan.pageMm).map((from) => (
        <Sheet key={`cavi-${from}`} plan={plan}>
          <CableTable rows={cables.slice(from, from + perPage)} from={from} total={cables.length} continued />
        </Sheet>
      ))}
      {plan.tiles.filter((t) => !t.empty).map((t) => (
        <Sheet key={`${t.row}-${t.col}`} plan={plan}>
          <TileHeader plan={plan} tile={t} title={view.title} />
          <PrintMap
            model={view.model} tree={view.tree} layout={L} orientation={view.orientation} label={`Foglio ${t.row}-${t.col} della mappa ${view.title}`}
            viewBox={{ x: t.x, y: t.y, w: t.w, h: t.h }} width={`${plan.tileMm.w}mm`} height={`${plan.tileMm.h}mm`} content={content}
          />
        </Sheet>
      ))}
    </>
  );
}

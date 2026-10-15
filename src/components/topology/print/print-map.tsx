/**
 * La mappa disegnata per la carta (spec topologia §12.3): SVG statico, non React Flow, con le
 * coordinate di `layoutTree` (stessa disposizione e stesso orientamento dello schermo, ritocchi
 * compresi) e lo stile delle linee di `edgeLook` in nero e grigi (print-draw.ts). Riquadri col nome
 * (`fitLabel`) e il tipo in parole, gruppi AP, attaccati, VM se aperte. Le ridondanze non si
 * disegnano (spec §12.5): le elenca il primo foglio. Nessun colore porta da solo un significato:
 * stato «▲ giù» con bordo spesso, «◆ avviso», «?»; linee con spessore, forma e parole.
 */
import type { ReactNode } from "react";
import { edgeLook, pathPoints, wavyPath, type Pt } from "@/lib/topology/edge-look";
import { isUncensusedVmId } from "@/lib/topology/map-menus";
import type { MapOrientation, TopologyModel } from "@/lib/topology/model-types";
import { DARK, GREY, INK, LIGHT, MID, PAPER, edgeLabelAt, parolaLineaSpostata, pointsPath, printStrokes, puntiLineaAlbero, stepPoints, wrapLabel } from "@/lib/topology/print-draw";
import { labelBoxes, lrLabelMaxWidth, ostacoli, rettangoli, troncoPossibile, type Rect } from "@/lib/topology/map-screen";
import type { TreeResult } from "@/lib/topology/tree";
import { ATT_INDENT, ATT_MAX, ATT_ROW, CHAR_W, DNS_H, dnsLine, fitLabel, type LayoutResult } from "@/lib/topology/tree-layout";
import type { TopologyStatus } from "@/lib/topology/types";
import { isRunning, vmChipText, vmSummary } from "@/lib/topology/vm-nodes";
import { typeLabel } from "@/components/topology/map/topology-icons";

const FONT = 13;
const STATO: Record<TopologyStatus, string | null> = { ok: null, warning: "◆ avviso", fail: "▲ giù", unknown: "?" };

/** Un testo che non supera `width` px (stima a CHAR_W per carattere), con «…». */
function clip(text: string, width: number): string {
  const max = Math.max(2, Math.floor(width / CHAR_W));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Testo con un alone color carta: resta leggibile sopra le linee. */
function Label({ x, y, children, anchor = "start", weight, fill = INK, size = FONT, italic }: {
  x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end"; weight?: number; fill?: string; size?: number; italic?: boolean;
}) {
  return (
    <text
      x={x} y={y} textAnchor={anchor} fontSize={size} fontWeight={weight} fill={fill} fontStyle={italic ? "italic" : undefined}
      stroke={PAPER} strokeWidth={3} strokeLinejoin="round" paintOrder="stroke"
    >
      {children}
    </text>
  );
}

export interface PrintMapProps {
  model: TopologyModel & { status?: Record<string, TopologyStatus> };
  tree: TreeResult;
  layout: LayoutResult;
  orientation: MapOrientation;
}

/** Il contenuto della mappa (un `<g>`): lo stesso per la panoramica e per ogni tassello. */
export function PrintMapContent({ model, tree, layout, orientation }: PrintMapProps) {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const vmsOf = new Map<string, TopologyModel["vms"]>();
  for (const v of model.vms) if (v.hypervisorNodeId) vmsOf.set(v.hypervisorNodeId, [...(vmsOf.get(v.hypervisorNodeId) ?? []), v]);
  const open = new Set(layout.vmChips.map((c) => c.hypervisor));
  const promote = new Set(model.promote.map((p) => `host:${p.hostId}`));
  const lines: ReactNode[] = [];
  const labels: ReactNode[] = [];
  const apDone = new Set<string>();

  // Linee dell'albero: solo i principali (spec §12.5). Le ridondanze stanno nell'elenco del primo foglio.
  // Un figlio spostato a mano dall'altra parte ha la linea sul lato più vicino, come a schermo (spec §13.10.1, prova I31).
  const riquadri = rettangoli(layout);
  let parole: Rect[] | null = null; // dove la parola di un figlio spostato non deve finire: si calcola solo se serve
  for (const [child, link] of tree.via) {
    const ln = layout.nodes.get(child);
    if (!ln || !ln.parent || ln.role === "attached") continue;
    const parent = layout.nodes.get(ln.parent);
    if (!parent) continue;
    if (ln.role === "ap") {
      const g = layout.apGroups.find((x) => x.parent === ln.parent);
      if (!g || apDone.has(ln.parent)) continue;
      apDone.add(ln.parent);
      lines.push(<path key={`apg:${ln.parent}`} d={pointsPath(stepPoints(orientation, parent, g))} stroke={INK} strokeWidth={1.8} fill="none" />);
      continue;
    }
    const pts: Pt[] = puntiLineaAlbero(orientation, parent, ln, ostacoli(riquadri, [ln.parent, child]));
    const look = edgeLook(link, { inTree: true });
    const d = look.wavy ? wavyPath(pathPoints(pointsPath(pts))) : pointsPath(pts);
    printStrokes(look).forEach((s, i) => lines.push(
      <path key={`e:${child}:${i}`} d={d} stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash ?? undefined} strokeLinecap={s.cap} fill="none" />,
    ));
    if (look.tokens.length && !troncoPossibile(orientation, parent, ln)) {
      // Un figlio spostato a mano dall'altra parte: la parola come a schermo, vicino alla metà del percorso e fuori dai
      // riquadri (revisione finale di T1: in fondo alla linea cadeva dentro il riquadro del figlio).
      const testo = look.tokens.join(" · ");
      const at = parolaLineaSpostata(pts, testo, (parole ??= labelBoxes(layout.nodes.values(), layout.apGroups)));
      labels.push(<Label key={`t:${child}:0`} x={at.x} y={at.y} anchor={at.anchor}>{testo}</Label>);
    } else if (look.tokens.length) {
      const at = edgeLabelAt(orientation, pts);
      // In verticale va a capo come a schermo: righe impilate verso l'alto, l'ultima appena sopra il braccio.
      const rows = orientation === "lr" ? wrapLabel(look.tokens, lrLabelMaxWidth(pts[0].x, pts[pts.length - 1].x)) : [look.tokens.join(" · ")];
      rows.forEach((r, i) => labels.push(
        <Label key={`t:${child}:${i}`} x={at.x} y={at.y - (rows.length - 1 - i) * 16} anchor={at.anchor}>{r}</Label>,
      ));
    }
    // Le porte sopra il riquadro: «porta del genitore → porta mia»; in grigio corsivo se non visto.
    const parentPort = link.a === child ? link.bPort : link.aPort;
    const childPort = link.a === child ? link.aPort : link.bPort;
    const text = `${parentPort || "?"} → ${childPort || "?"}${link.stale ? ` · non visto da ${link.daysUnseen ?? "?"} g` : ""}`;
    const px = orientation === "lr" ? ln.x + 2 : ln.x + ln.w / 2 + 4;
    const room = orientation === "lr" ? ln.w : ln.w / 2 + 40;
    labels.push(<Label key={`p:${child}`} x={px} y={ln.y - 5} fill={link.stale ? GREY : DARK} italic={link.stale}>{clip(text, room)}</Label>);
  }

  const groups = layout.apGroups.map((g) => (
    <g key={`apg:${g.parent}`}>
      <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={6} fill={LIGHT} stroke={MID} strokeWidth={1} />
      <text x={g.x + 6} y={g.y + 14} fontSize={FONT} fill={DARK}>{g.count} AP</text>
    </g>
  ));

  const boxes: ReactNode[] = [];
  const attached: ReactNode[] = [];
  for (const ln of layout.nodes.values()) {
    const n = byId.get(ln.id);
    if (!n) continue;
    if (ln.role === "attached") {
      attached.push(
        <g key={ln.id}>
          <rect x={ln.x} y={ln.y} width={ln.w} height={ln.h} rx={3} fill={LIGHT} stroke={MID} strokeWidth={1} />
          <text x={ln.x + 4} y={ln.y + 13.5} fontSize={FONT} fill={INK}>{clip(n.name, ln.w - 8)}</text>
        </g>,
      );
      continue;
    }
    const status = model.status?.[ln.id] ?? "unknown";
    const giu = status === "fail";
    const isPromote = promote.has(ln.id);
    const vms = vmsOf.get(ln.id);
    const stato = STATO[status];
    const clients = (n.type === "switch" || n.type === "access_point") && model.clientCount[ln.id] ? `${model.clientCount[ln.id]} client` : null;
    const second = isPromote
      ? "host · da promuovere"
      : vms?.length
        ? `${vmSummary(vms).label}${open.has(ln.id) ? "" : " (chiuse)"}`
        : [typeLabel(n.type), n.mgmtIp, clients].filter(Boolean).join(" · ");
    const kind = isUncensusedVmId(ln.id) ? "macchina virtuale" : null;
    // Spec §12.5: sotto il nome dal Proxmox, «DNS: <nome di prima>» (l'intestazione è più alta di DNS_H).
    const dns = dnsLine(n);
    boxes.push(
      <g key={ln.id}>
        <rect
          x={ln.x} y={ln.y} width={ln.w} height={ln.h} rx={6} fill={PAPER} stroke={INK}
          strokeWidth={giu ? 2.8 : 1.5} strokeDasharray={isPromote ? "5 3" : undefined}
        />
        <text x={ln.x + 8} y={ln.y + 18} fontSize={FONT} fontWeight={700} fill={INK}>{fitLabel(n.name, ln.w)}</text>
        {dns && <text x={ln.x + 8} y={ln.y + 18 + DNS_H} fontSize={FONT} fill={DARK}>{clip(dns, ln.w - 16)}</text>}
        <text x={ln.x + 8} y={ln.y + 35 + (dns ? DNS_H : 0)} fontSize={FONT} fill={DARK}>
          {stato && <tspan fontWeight={700} fill={INK}>{stato} </tspan>}
          {clip(kind ?? second, ln.w - 16 - (stato ? (stato.length + 1) * CHAR_W : 0))}
        </text>
      </g>,
    );
  }

  // Attaccati: in orizzontale un trattino dal lato destro del riquadro; in verticale una linea che scende dal riquadro.
  const ticks: ReactNode[] = [];
  for (const [parent, kids] of tree.children) {
    const b = layout.nodes.get(parent);
    const att = kids.map((k) => layout.nodes.get(k)).filter((x): x is NonNullable<typeof x> => !!x && x.role === "attached");
    if (!b || att.length === 0) continue;
    if (orientation === "lr") {
      const x0 = b.x + ATT_INDENT / 2;
      const last = att[att.length - 1];
      ticks.push(<path key={`at:${parent}`} d={`M${x0} ${b.y + b.h} L${x0} ${last.y + last.h / 2}`} stroke={MID} strokeWidth={1} fill="none" />);
      for (const a of att) ticks.push(<path key={`at:${a.id}`} d={`M${x0} ${a.y + a.h / 2} L${a.x} ${a.y + a.h / 2}`} stroke={MID} strokeWidth={1} fill="none" />);
    } else {
      ticks.push(<path key={`at:${parent}`} d={`M${b.x + b.w} ${b.y + 9} L${b.x + b.w + 10} ${b.y + 9}`} stroke={MID} strokeWidth={1} fill="none" />);
    }
  }
  const more: ReactNode[] = [];
  for (const [parent, n] of layout.moreAttached) {
    const b = layout.nodes.get(parent);
    if (!b) continue;
    const [x, y] = orientation === "lr" ? [b.x + ATT_INDENT, b.y + b.h + 4 + ATT_MAX * ATT_ROW + 13] : [b.x + b.w + 14, b.y + ATT_MAX * ATT_ROW + 13];
    more.push(<text key={`more:${parent}`} x={x} y={y} fontSize={FONT} fill={DARK}>+ altri {n}</text>);
  }

  const vmById = new Map(model.vms.map((v) => [v.id, v]));
  const chips = layout.vmChips.map((c) => {
    const v = vmById.get(c.vmId);
    if (!v) return null;
    const on = isRunning(v.status);
    return (
      <g key={`vm:${c.vmId}`}>
        <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={3} fill={LIGHT} stroke={on ? INK : MID} strokeWidth={1} strokeDasharray={on ? undefined : "4 3"} />
        <text x={c.x + 4} y={c.y + 15.5} fontSize={FONT} fill={INK}>{vmChipText(v, c.w)}</text>
      </g>
    );
  });

  return (
    <g fontFamily="var(--font-signika), Signika, sans-serif">
      {groups}
      {lines}
      {ticks}
      {boxes}
      {attached}
      {chips}
      {more}
      {labels}
    </g>
  );
}

/**
 * La mappa in un `<svg>`: `viewBox` nel sistema del disegno (px a scala 1), `width`/`height` sulla
 * carta (mm, o «100%» per la panoramica). `overlay` si disegna sopra (la griglia dei fogli).
 */
export function PrintMap(p: PrintMapProps & {
  viewBox: { x: number; y: number; w: number; h: number };
  width: string;
  height: string;
  content?: ReactNode;
  overlay?: ReactNode;
  label: string;
}) {
  const vb = p.viewBox;
  return (
    <svg
      role="img" aria-label={p.label}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
      style={{ width: p.width, height: p.height, display: "block", background: PAPER }}
    >
      {p.content ?? <PrintMapContent model={p.model} tree={p.tree} layout={p.layout} orientation={p.orientation} />}
      {p.overlay}
    </svg>
  );
}

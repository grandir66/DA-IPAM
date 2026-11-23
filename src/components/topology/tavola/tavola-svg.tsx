"use client";

/**
 * Il disegno della tavola (spec tavola §4 punti 3-6): telai, porte, destinazioni ruotate, graffe dei fasci, cavi. Le
 * posizioni arrivano già calcolate (`righe.ts`, `instrada.ts`): qui nessun calcolo grafico. Il fuoco lo decide chi
 * chiama: ciò che non è nel fuoco scende al 10 % di opacità.
 */
import Link from "next/link";
import { Fragment } from "react";
import type { Disegno } from "@/lib/topology/tavola/instrada";
import { GEO, type Riga } from "@/lib/topology/tavola/righe";
import type { ApparatoComposto, PortaComposta } from "@/lib/topology/tavola/tipi";
import { DefinizioniTavola, SegnoPorta } from "./porta-svg";
import { STILE_CAVO } from "./stile-tavola";
import type { TipoPorta } from "@/lib/topology/tavola/tipi";

export interface Fuoco {
  porte: ReadonlySet<string>;
  collegamenti: ReadonlySet<string>;
  /** Telai da evidenziare (l'altro capo, o l'apparato cercato). */
  nodi: ReadonlySet<string>;
}

/**
 * Quanto resta visibile ciò che non è nel fuoco. Il 10 % della spec non si leggeva (Riccardo, 23/11: «non si vede più
 * nulla… un colore appena appena più chiaro o più scuro rispetto allo sfondo»): al passaggio del mouse 35 %, con un
 * collegamento scelto col clic o una ricerca, che restano, 50 %.
 */
export const SPENTO_PASSAGGIO = 0.35;
export const SPENTO_SCELTA = 0.5;
const MAX_CARATTERI = 17;

const corta = (s: string) => (s.length > MAX_CARATTERI ? `${s.slice(0, MAX_CARATTERI - 1)}…` : s);

function Graffe({ porte, posizioni, y }: { porte: PortaComposta[]; posizioni: Map<string, number>; y: number }) {
  const gruppi = new Map<string, number[]>();
  for (const p of porte) {
    if (!p.fascio) continue;
    const x = posizioni.get(p.id);
    if (x === undefined) continue;
    gruppi.set(p.fascio, [...(gruppi.get(p.fascio) ?? []), x]);
  }
  return (
    <>
      {[...gruppi].filter(([, xs]) => xs.length > 1).map(([id, xs]) => {
        const a = Math.min(...xs) - 10, b = Math.max(...xs) + 10, m = (a + b) / 2;
        return <path key={id} d={`M${a},${y - 3} v3 H${m - 3} l3,3 l3,-3 H${b} v-3`} fill="none" stroke="var(--foreground)" strokeWidth={1.3} />;
      })}
    </>
  );
}

export function TavolaSvg(p: {
  apparati: ApparatoComposto[];
  righe: Riga[];
  disegno: Disegno;
  tipoCavo: ReadonlyMap<string, { tipo: TipoPorta; dubbio: boolean }>;
  fuoco: Fuoco | null;
  /** Opacità di ciò che è fuori dal fuoco. */
  spento: number;
  /** Clic sul vuoto: toglie la scelta. */
  onVuoto: () => void;
  onPorta: (porta: PortaComposta | null) => void;
  onCavo: (collegamento: string | null) => void;
  onScegli: (collegamento: string) => void;
}) {
  const { disegno: d, fuoco } = p;
  const perNodo = new Map(p.apparati.map((a) => [a.nodo, a]));
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const transizione = reduce ? undefined : "opacity 120ms";
  const opPorta = (id: string) => (fuoco && !fuoco.porte.has(id) ? p.spento : 1);
  return (
    // Larghezza del riquadro, mai oltre la propria (niente ingrandimento) né sotto 1240 px: sotto scorre il riquadro, non la pagina.
    <svg viewBox={`0 0 ${d.larghezza} ${d.altezza}`} role="img" aria-label="Tavola di cablaggio"
      style={{ width: "100%", maxWidth: d.larghezza, minWidth: Math.min(1240, d.larghezza), height: "auto" }}
      className="block select-none" onMouseLeave={() => { p.onPorta(null); p.onCavo(null); }}>
      <DefinizioniTavola />
      <rect width={d.larghezza} height={d.altezza} fill="transparent" onClick={p.onVuoto} />
      {p.righe.map((r, ri) => r.apparati.map((ap) => {
        const a = perNodo.get(ap.nodo);
        if (!a) return null;
        const x0 = d.dx + ap.x, y0 = d.yRighe[ri];
        const evidenziato = fuoco?.nodi.has(a.nodo) ?? false;
        const posizioni = new Map(ap.porte.map((pp) => [pp.id, pp.cx]));
        const yEtichette = GEO.testata + ap.file * GEO.passo + 8;
        const sotto = [a.tipo, a.ip].filter(Boolean).join(" · ");
        return (
          <g key={a.nodo} transform={`translate(${x0},${y0})`}>
            <rect width={ap.w} height={ap.h} rx={8} fill="var(--card)" stroke={evidenziato ? "var(--primary)" : "var(--border)"} strokeWidth={evidenziato ? 3 : 1} />
            <Link href={`/devices/${a.refId}`}>
              <text x={GEO.margine} y={21} fontSize={15} fontWeight={700} fill="var(--foreground)" className="hover:underline">
                {a.nome.length > Math.floor((ap.w - 2 * GEO.margine) / 8.5) ? `${a.nome.slice(0, Math.floor((ap.w - 2 * GEO.margine) / 8.5) - 1)}…` : a.nome}
                <title>{`${a.nome} — apri la scheda`}</title>
              </text>
            </Link>
            <text x={GEO.margine} y={39} fontSize={13} fontFamily="var(--font-mono)" fill="var(--muted-foreground)">{sotto}</text>
            <Graffe porte={a.porte} posizioni={posizioni} y={GEO.testata + ap.file * GEO.passo + 2} />
            {a.porte.map((porta) => {
              const pp = ap.porte.find((x) => x.id === porta.id);
              if (!pp) return null;
              const titolo = [porta.nome, porta.destinazione ? `→ ${porta.destinazione}` : null, porta.velocita, porta.vlan !== null ? `VLAN ${porta.vlan}` : null,
                porta.fantasma ? "porta non nell'elenco dell'apparato" : null, porta.dubbio ? "da verificare" : null].filter(Boolean).join(" · ");
              return (
                <g key={porta.id} opacity={opPorta(porta.id)} style={{ transition: transizione, cursor: porta.collegamento ? "pointer" : "default" }}
                  onMouseEnter={() => p.onPorta(porta)} onClick={() => (porta.collegamento ? p.onScegli(porta.collegamento) : p.onVuoto())}>
                  <title>{titolo}</title>
                  <g opacity={porta.fantasma ? 0.6 : 1}>
                    <SegnoPorta x={pp.x} y={pp.y} tipo={porta.tipo} dubbio={porta.dubbio} numero={porta.numero} />
                  </g>
                  {porta.destinazione && (
                    <text x={pp.ex} y={yEtichette} transform={`rotate(90 ${pp.ex} ${yEtichette})`} dominantBaseline="middle" fontSize={13}
                      fill={porta.tipo === "libera" ? "var(--muted-foreground)" : "var(--foreground)"}>{corta(porta.destinazione)}</text>
                  )}
                </g>
              );
            })}
          </g>
        );
      }))}
      {d.linee.map((l) => {
        const t = p.tipoCavo.get(l.id);
        const s = STILE_CAVO[t?.tipo ?? "client"];
        const pts = l.punti.map(([x, y]) => `${x},${y}`).join(" ");
        const w = l.lungo ? Math.max(1.2, s.width - 0.8) : s.width;
        const op = fuoco && !fuoco.collegamenti.has(l.collegamento) ? p.spento : 1;
        const [a0, a1] = [l.punti[0], l.punti[l.punti.length - 1]];
        return (
          <g key={l.id} opacity={op} style={{ transition: transizione, cursor: "pointer" }} onMouseEnter={() => p.onCavo(l.collegamento)} onClick={() => p.onScegli(l.collegamento)}>
            <polyline points={pts} fill="none" stroke="transparent" strokeWidth={10} />
            <polyline points={pts} fill="none" stroke="var(--background)" strokeWidth={w + 3} strokeLinejoin="round" />
            <polyline points={pts} fill="none" stroke={t?.dubbio ? "var(--destructive)" : s.stroke} strokeWidth={w} strokeDasharray={t?.dubbio ? "2 3" : s.dash} strokeLinejoin="round" />
            {[a0, a1].map(([x, y], i) => <Fragment key={i}><circle cx={x} cy={y} r={3.5} fill={s.stroke} stroke="var(--card)" strokeWidth={1} /></Fragment>)}
          </g>
        );
      })}
    </svg>
  );
}

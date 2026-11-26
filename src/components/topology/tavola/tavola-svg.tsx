"use client";

/**
 * Il disegno della tavola (spec tavola §4 punti 3-6): telai, porte, destinazioni ruotate, graffe dei fasci, cavi. Le
 * posizioni arrivano già calcolate (`righe.ts`, `instrada.ts`): qui nessun calcolo grafico. Il fuoco lo decide chi
 * chiama: i cavi fuori dal fuoco scendono al 25 %, il resto non cambia (vedi SPENTO_CAVI).
 */
import Link from "next/link";
import { Fragment } from "react";
import type { Disegno } from "@/lib/topology/tavola/instrada";
import { GEO, type Riga } from "@/lib/topology/tavola/righe";
import type { ApparatoComposto, PortaComposta, VmComposta } from "@/lib/topology/tavola/tipi";
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
 * Il fuoco tocca solo i cavi (Riccardo, 23/11: «è ancora quasi invisibile la mappa»; prima porte e scritte scendevano al
 * 10 %, poi al 50 %, e coi colori già chiari non si leggevano). Porte, scritte e telai restano sempre pieni; i cavi fuori dal
 * fuoco scendono al 25 %; il collegamento nel fuoco si ingrossa, le sue porte hanno un anello e i due telai il bordo.
 */
export const SPENTO_CAVI = 0.25;
const MAX_CARATTERI = 17;

const corta = (s: string) => (s.length > MAX_CARATTERI ? `${s.slice(0, MAX_CARATTERI - 1)}…` : s);

/** «▶ nome · IP» (■ spenta): l'IP solo se ci sta nella colonna. */
export function scrittaVm(v: VmComposta, max = 28): string {
  const testa = v.accesa === null ? "" : v.accesa ? "▶ " : "■ ";
  const intera = `${testa}${v.nome}${v.ip ? ` · ${v.ip}` : ""}`;
  if (intera.length <= max) return intera;
  const breve = `${testa}${v.nome}`;
  return breve.length <= max ? breve : `${breve.slice(0, max - 1)}…`;
}

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
  /** Il risultato della ricerca su cui si è: id di una porta o di un nodo, col doppio anello. */
  corrente: string | null;
  /** Clic sul vuoto: toglie la scelta. */
  onVuoto: () => void;
  onPorta: (porta: PortaComposta | null) => void;
  onCavo: (collegamento: string | null) => void;
  onScegli: (collegamento: string | null, porta: PortaComposta | null) => void;
}) {
  const { disegno: d, fuoco } = p;
  const perNodo = new Map(p.apparati.map((a) => [a.nodo, a]));
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const transizione = reduce ? undefined : "opacity 120ms";
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
        const x0 = d.dx + ap.x, y0 = d.yRighe[ri] + (r.testa ?? 0);
        const evidenziato = fuoco?.nodi.has(a.nodo) ?? false;
        const posizioni = new Map(ap.porte.map((pp) => [pp.id, pp.cx]));
        const yEtichette = GEO.testata + ap.file * GEO.passo + 8;
        const sotto = [a.tipo, a.ip].filter(Boolean).join(" · ");
        return (
          <g key={a.nodo} id={`tavola-${a.nodo}`} transform={`translate(${x0},${y0})`}>
            <rect width={ap.w} height={ap.h} rx={8} fill="var(--card)" stroke={evidenziato ? "var(--primary)" : "var(--border)"} strokeWidth={evidenziato ? 3 : 1} />
            {p.corrente === a.nodo && <rect x={-6} y={-6} width={ap.w + 12} height={ap.h + 12} rx={12} fill="none" stroke="var(--primary)" strokeWidth={4} />}
            <Link href={`/devices/${a.refId}`}>
              <text x={GEO.margine} y={21} fontSize={15} fontWeight={700} fill="var(--foreground)" className="hover:underline">
                {a.nome.length > Math.floor((ap.w - 2 * GEO.margine) / 8.5) ? `${a.nome.slice(0, Math.floor((ap.w - 2 * GEO.margine) / 8.5) - 1)}…` : a.nome}
                <title>{`${a.nome} — apri la scheda`}</title>
              </text>
            </Link>
            <text x={GEO.margine} y={39} fontSize={13} fontFamily="var(--font-mono)" fill="var(--muted-foreground)">{sotto}</text>
            <Graffe porte={a.porte} posizioni={posizioni} y={GEO.testata + ap.file * GEO.passo + 2} />
            {(a.vms?.length ?? 0) > 0 && (ap.vmColonne ?? 0) > 0 && (() => {
              const vms = a.vms!, col = ap.vmColonne!, yVm = GEO.testata + ap.file * GEO.passo + GEO.etichette;
              const accese = vms.filter((v) => v.accesa).length;
              return (
                <g>
                  <line x1={GEO.margine} x2={ap.w - GEO.margine} y1={yVm} y2={yVm} stroke="var(--border)" />
                  <text x={GEO.margine} y={yVm + 19} fontSize={13} fontWeight={700} fill="var(--foreground)">{`${vms.length} VM, ${accese} ${accese === 1 ? "accesa" : "accese"}`}</text>
                  {vms.map((v, i) => {
                    const testo = (
                      <text x={GEO.margine + (i % col) * GEO.vmColonna} y={yVm + GEO.vmTesta + Math.floor(i / col) * GEO.vmRiga + 14} fontSize={13}
                        fill={v.accesa === false ? "var(--muted-foreground)" : "var(--foreground)"} className={v.scheda ? "hover:underline" : undefined}>
                        <title>{[v.nome, v.ip, v.accesa === null ? null : v.accesa ? "accesa" : "spenta"].filter(Boolean).join(" · ")}</title>
                        {scrittaVm(v)}
                      </text>
                    );
                    return v.scheda ? <Link key={v.id} href={v.scheda}>{testo}</Link> : <g key={v.id}>{testo}</g>;
                  })}
                </g>
              );
            })()}
            {a.porte.map((porta) => {
              const pp = ap.porte.find((x) => x.id === porta.id);
              if (!pp) return null;
              const titolo = [porta.nome, porta.destinazione ? `→ ${porta.destinazione}` : null, porta.velocita, porta.vlan !== null ? `VLAN ${porta.vlan}` : null,
                porta.fantasma ? "porta non nell'elenco dell'apparato" : null, porta.dubbio ? "da verificare" : null].filter(Boolean).join(" · ");
              return (
                <g key={porta.id} id={`tavola-${porta.id}`} style={{ cursor: "pointer" }}
                  onMouseEnter={() => p.onPorta(porta)} onClick={() => p.onScegli(porta.collegamento, porta)}>
                  <title>{titolo}</title>
                  <g opacity={porta.fantasma ? 0.6 : 1}>
                    <SegnoPorta x={pp.x} y={pp.y} tipo={porta.tipo} dubbio={porta.dubbio} numero={porta.numero} />
                  </g>
                  {fuoco?.porte.has(porta.id) && (
                    <rect x={pp.x - 4} y={pp.y - 4} width={32} height={32} rx={6} fill="none" stroke="var(--foreground)" strokeWidth={2.5} style={{ pointerEvents: "none" }} />
                  )}
                  {p.corrente === porta.id && (
                    <rect x={pp.x - 9} y={pp.y - 9} width={42} height={42} rx={9} fill="none" stroke="var(--primary)" strokeWidth={4} style={{ pointerEvents: "none" }} />
                  )}
                  {porta.destinazione && (
                    <text x={pp.ex} y={yEtichette} transform={`rotate(90 ${pp.ex} ${yEtichette})`} dominantBaseline="middle" fontSize={13}
                      fill="var(--foreground)">{corta(porta.destinazione)}</text>
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
        const nelFuoco = fuoco?.collegamenti.has(l.collegamento) ?? false;
        const w = (l.lungo ? Math.max(1.5, s.width - 0.5) : s.width) + (nelFuoco ? 2 : 0);
        const op = fuoco && !nelFuoco ? SPENTO_CAVI : 1;
        const [a0, a1] = [l.punti[0], l.punti[l.punti.length - 1]];
        return (
          <g key={l.id} opacity={op} style={{ transition: transizione, cursor: "pointer" }} onMouseEnter={() => p.onCavo(l.collegamento)} onClick={() => p.onScegli(l.collegamento, null)}>
            <polyline points={pts} fill="none" stroke="transparent" strokeWidth={10} />
            <polyline points={pts} fill="none" stroke="var(--background)" strokeWidth={w + 3} strokeLinejoin="round" />
            <polyline points={pts} fill="none" stroke={t?.dubbio ? "var(--destructive)" : s.stroke} strokeWidth={w} strokeDasharray={t?.dubbio ? "2 3" : s.dash} strokeLinejoin="round" />
            {[a0, a1].map(([x, y], i) => <Fragment key={i}><circle cx={x} cy={y} r={3.5} fill={s.stroke} stroke="var(--card)" strokeWidth={1} /></Fragment>)}
          </g>
        );
      })}
      {/* Dopo i cavi: un cavo che attraversa la fascia non copre il nome (contorno del colore del fondo). */}
      {p.righe.map((r, ri) => {
        if (!r.testa) return null;
        const miei = p.apparati.filter((a) => a.rackId === r.armadio);
        const nome = r.armadio === null ? "Senza armadio" : miei[0]?.armadio ?? "Armadio senza nome";
        const y = d.yRighe[ri] + 21;
        return (
          <g key={`armadio-${r.armadio ?? "senza"}`} style={{ pointerEvents: "none" }}>
            <line x1={d.dx} x2={d.larghezza - 16} y1={y + 7} y2={y + 7} stroke="var(--muted-foreground)" strokeWidth={1.5} />
            <text x={d.dx} y={y} fontSize={17} fontWeight={700} fill="var(--foreground)" stroke="var(--background)" strokeWidth={5} paintOrder="stroke">
              {nome}<tspan dx={12} fontSize={13} fontWeight={400}>{miei.length === 1 ? "1 apparato" : `${miei.length} apparati`}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Bersagliato } from "@/lib/security/accessi-indexer";

/**
 * Accessi falliti nel tempo e chi viene bersagliato (rifatto il 25/10: Riccardo lo trovava
 * «brutto e non significativo» accanto ai grafici della pagina Alert).
 *
 * Prima: barre disegnate a mano senza asse né griglia (si leggeva solo il picco), il totale
 * ripetuto dalla card sopra e nessun nome. Ora: lo stesso grafico della pagina Alert (recharts,
 * griglia, asse dei valori, tooltip, navy di `--alert-cat-1` = accessi falliti), la media
 * tratteggiata, e sotto i primi tre account bersagliati del periodo con l'origine: la parte
 * su cui si agisce. Con la stima (indexer assente) le 24 ore ora per ora non dicono niente,
 * ogni gruppo è spalmato sulla sua durata: si mostrano solo i 14 giorni e lo si dice.
 */
const numero = (n: number) => Math.round(n).toLocaleString("it-IT");

function compatto(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

interface Punto {
  asse: string;
  dettaglio: string;
  n: number;
}

function Suggerimento({ active, payload }: { active?: boolean; payload?: { payload?: Punto }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  return (
    <div className="rounded-md border bg-[var(--chart-surface)] px-3 py-2 text-[13px] shadow-md">
      <div className="font-medium text-foreground">{p.dettaglio}</div>
      <div className="text-muted-foreground">
        <span className="font-mono font-medium tabular-nums text-foreground">{numero(p.n)}</span> accessi falliti
      </div>
    </div>
  );
}

export function IstogrammaAccessi({ ore, giorni, fonte, motivo, bersagliati }: {
  ore: { ora: string; falliti: number }[] | null;
  giorni: { giorno: string; falliti: number }[] | null;
  fonte: "indexer" | "stima";
  /** Perché si usa la stima (indexer non configurato o non raggiungibile). */
  motivo?: string;
  bersagliati?: { ore: Bersagliato[]; giorni: Bersagliato[] };
}) {
  const stima = fonte === "stima";
  const [scelta, setScelta] = useState<"24h" | "14g">("24h");
  const vista = stima ? "14g" : scelta;
  if (!ore || !giorni) return <p className="text-[13px] text-muted-foreground py-2">Wazuh non configurato: nessun dato sugli accessi.</p>;

  const punti: Punto[] =
    vista === "24h"
      ? ore.map((o) => ({ asse: o.ora, dettaglio: `ore ${o.ora}:00`, n: o.falliti }))
      : giorni.map((g) => {
          const gg = `${g.giorno.slice(8, 10)}/${g.giorno.slice(5, 7)}`;
          return { asse: gg, dettaglio: gg, n: g.falliti };
        });
  const totale = punti.reduce((s, p) => s + p.n, 0);
  const media = totale / punti.length;
  const picco = punti.reduce((best, p) => (p.n > best.n ? p : best), punti[0]);
  const unita = vista === "24h" ? "all'ora" : "al giorno";
  const elenco = vista === "24h" ? bersagliati?.ore : bersagliati?.giorni;
  const maxBersagliato = Math.max(1, ...(elenco ?? []).map((b) => b.falliti));
  const spiegaStima = `${motivo ? `${motivo[0].toUpperCase()}${motivo.slice(1)}: ` : ""}conteggi stimati, ogni gruppo d'allarme è ripartito sul periodo in cui è rimasto aperto. Le ore singole non si vedono.`;

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-1.5">
      {/* Riga dei fatti del periodo: il totale delle 24 ore è già nella card sopra. */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-muted-foreground">
          {totale === 0 ? (
            "Nessun accesso fallito nel periodo"
          ) : (
            <>
              picco <span className="font-mono font-bold tabular-nums text-foreground">{numero(picco.n)}</span> {vista === "24h" ? `alle ${picco.asse}` : `il ${picco.asse}`}
              {vista === "14g" && <> · totale <span className="font-mono tabular-nums text-foreground">{numero(totale)}</span></>}
            </>
          )}
          {stima && <span className="ml-1.5 rounded border border-dashed px-1" title={spiegaStima}>stima</span>}
        </span>
        <div className="inline-flex rounded-md border text-[13px]" role="group" aria-label="Periodo">
          {(["24h", "14g"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vista === v}
              disabled={stima && v === "24h"}
              title={stima && v === "24h" ? spiegaStima : undefined}
              onClick={() => setScelta(v)}
              className={`px-2 py-0.5 disabled:opacity-40 disabled:cursor-not-allowed ${vista === v ? "bg-[#0D2537] text-white dark:bg-[#A9BECC] dark:text-[#0D2537]" : "text-muted-foreground hover:text-foreground"}`}
            >
              {v === "24h" ? "24 ore" : "14 giorni"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-[120px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={punti} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="asse"
              tick={{ fontSize: 13, fill: "var(--chart-ink-muted)" }}
              stroke="var(--chart-grid)"
              interval="preserveStartEnd"
              minTickGap={14}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 13, fill: "var(--chart-ink-muted)" }}
              stroke="var(--chart-grid)"
              width={40}
              allowDecimals={false}
              tickFormatter={compatto}
            />
            <Tooltip cursor={{ fill: "var(--chart-grid)", opacity: 0.4 }} content={<Suggerimento />} />
            {totale > 0 && (
              <ReferenceLine
                y={media}
                stroke="var(--chart-ink-muted)"
                strokeDasharray="4 3"
                label={{ value: `media ${numero(media)} ${unita}`, position: "insideTopRight", fontSize: 13, fill: "var(--chart-ink-muted)" }}
              />
            )}
            <Bar dataKey="n" fill="var(--alert-cat-1)" maxBarSize={24} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Chi viene bersagliato e da dove, nello stesso periodo del grafico. */}
      <div className="border-t pt-1.5 shrink-0">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-[13px] font-bold uppercase tracking-wider text-cian-testo">Più bersagliati</span>
          {elenco && elenco.length > 0 && <span className="text-[13px] text-muted-foreground">da dove partono</span>}
        </div>
        {stima ? (
          <p className="text-[13px] text-muted-foreground" title={spiegaStima}>Chi e da dove lo sa solo l&apos;indexer di Wazuh{motivo ? ` (${motivo})` : ""}.</p>
        ) : !elenco || elenco.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nessun account bersagliato nel periodo.</p>
        ) : (
          <ul className="space-y-1">
            {elenco.map((b) => (
              <li key={b.account}>
                <Link
                  href="/security-alerts"
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_4.5rem] items-center gap-2 rounded px-1 -mx-1 hover:bg-muted/60"
                  title={`${b.account}: ${numero(b.falliti)} accessi falliti${b.origine ? ` da ${b.origine}` : ""}. Apre la pagina Alert.`}
                >
                  <span className="truncate text-[13px] font-mono font-semibold">
                    {b.account}
                    {b.computer && <span className="ml-1 font-sans font-normal text-muted-foreground">(PC)</span>}
                  </span>
                  <span className="truncate text-[13px] font-mono text-muted-foreground">{b.origine ?? "—"}</span>
                  <span className="flex items-center justify-end gap-1.5">
                    <span className="h-2 rounded-r-sm bg-[var(--alert-cat-1)]" style={{ width: `${Math.max(6, (b.falliti / maxBersagliato) * 28)}px` }} aria-hidden />
                    <span className="text-[13px] font-mono tabular-nums">{compatto(b.falliti)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

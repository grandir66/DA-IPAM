import { FUSO_UTENTI } from "@/lib/db-date";
import type { GraficiCasa } from "@/lib/cliente/grafici";

/**
 * I grafici della casa della vista cliente: SVG e blocchi semplici, disegnati sul server.
 * Colori solo da `--vc-*` (globals.css). Riccardo è daltonico: le serie si separano per
 * luminosità (scuro / medio) e ogni grafico ha la legenda a parole.
 */

function quando(t: string): string {
  const d = new Date(`${t}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { timeZone: FUSO_UTENTI, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/**
 * Area con la linea degli indirizzi in uso. Riempie tutta la casella: la curva è un SVG che si
 * stira (0-100 sui due assi, tratto di spessore costante) e le scritte sono testo sopra, così non
 * si deformano quando il riquadro cambia misura.
 */
export function GraficoAccesi({ dati }: { dati: NonNullable<GraficiCasa["accesi"]> }) {
  const { punti, minimo, massimo, adesso } = dati;
  const basso = Math.max(0, minimo - (massimo - minimo) * 0.35 - 1);
  const alto = massimo + Math.max(1, (massimo - minimo) * 0.18);
  const x = (i: number) => (i / (punti.length - 1)) * 100;
  const y = (v: number) => (1 - (v - basso) / (alto - basso)) * 100;
  const linea = punti.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)} ${y(p.accesi).toFixed(2)}`).join(" ");
  const area = `${linea} L100 100 L0 100 Z`;
  const meta = Math.floor((punti.length - 1) / 2);
  const yAdesso = y(adesso);
  return (
    <div className="flex h-full min-h-32 flex-col" role="img" aria-label={`Indirizzi in uso: ${adesso} adesso, da ${minimo} a ${massimo} nel periodo`}>
      <div className="relative min-h-0 flex-1">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          <line x1={0} x2={100} y1={y(massimo)} y2={y(massimo)} stroke="var(--border)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="var(--vc-barra-fondo)" />
          <path d={linea} fill="none" stroke="var(--vc-cian)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute left-0 -translate-y-full text-[13px] text-muted-foreground" style={{ top: `${y(massimo)}%` }}>
          massimo {massimo}
        </span>
        <span
          aria-hidden
          className="absolute right-0 size-3 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-[var(--vc-acceso)]"
          style={{ top: `${yAdesso}%` }}
        />
        <span
          className="absolute right-3 whitespace-nowrap text-base font-bold"
          style={yAdesso < 22 ? { top: `calc(${yAdesso}% + 8px)` } : { top: `${yAdesso}%`, transform: "translateY(-135%)" }}
        >
          {adesso} adesso
        </span>
      </div>
      <div className="flex justify-between border-t pt-1 text-[13px] text-muted-foreground" aria-hidden>
        <span>{quando(punti[0]?.t ?? "")}</span>
        <span>{quando(punti[meta]?.t ?? "")}</span>
        <span>adesso</span>
      </div>
    </div>
  );
}

function Campione({ classe }: { classe: string }) {
  return <span aria-hidden className={`inline-block size-2.5 rounded-sm ${classe}`} />;
}

/** Una barra per rete: accesi (scuro) e spenti da poco (medio), lunga quanto la rete rispetto alla più grande. */
export function BarreReti({ reti }: { reti: GraficiCasa["reti"] }) {
  const max = Math.max(1, ...reti.map((r) => r.totale));
  return (
    <div className="space-y-2">
      {reti.map((r) => (
        <div key={r.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-[13px]">
          <span className="truncate">{r.nome}</span>
          <span className="flex h-2.5 overflow-hidden rounded-sm bg-[var(--vc-barra-fondo)]" aria-hidden>
            <span className="bg-[var(--vc-acceso)]" style={{ width: `${(r.accesi / max) * 100}%` }} />
            <span className="bg-[var(--vc-spento)]" style={{ width: `${(r.spenti / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono tabular-nums">{r.accesi}</span>
        </div>
      ))}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Campione classe="bg-[var(--vc-acceso)]" /> accesi</span>
        <span className="inline-flex items-center gap-1"><Campione classe="bg-[var(--vc-spento)]" /> spenti da poco</span>
      </p>
    </div>
  );
}

/** Anello del rischio del dominio: più è pieno, peggio è. */
export function AnelloRischio({ dati }: { dati: NonNullable<GraficiCasa["rischio"]> }) {
  const r = 46;
  const giro = 2 * Math.PI * r;
  const quota = Math.min(100, Math.max(0, dati.punteggio)) / 100;
  const colore = dati.punteggio >= 70 ? "var(--vc-grave)" : dati.punteggio >= 40 ? "var(--vc-alta)" : "var(--vc-cian)";
  return (
    <div className="flex h-full flex-wrap items-center justify-center gap-4">
      <svg viewBox="0 0 120 120" className="aspect-square h-full max-h-48 min-h-24 w-auto shrink-0" role="img" aria-label={`Rischio del dominio ${dati.punteggio} su 100`}>
        <circle cx={60} cy={60} r={r} fill="none" stroke="var(--vc-barra-fondo)" strokeWidth={12} />
        <circle cx={60} cy={60} r={r} fill="none" stroke={colore} strokeWidth={12} strokeDasharray={`${giro * quota} ${giro}`} transform="rotate(-90 60 60)" />
        <text x={60} y={68} textAnchor="middle" fontSize={30} fontWeight={700} fill="var(--foreground)">{dati.punteggio}</text>
      </svg>
      <div className="min-w-0 text-[13px]">
        <p className="text-base font-semibold">di rischio su 100</p>
        <p className="text-muted-foreground">più alto è peggio</p>
        <p className="mt-1">{dati.gravi === 1 ? "1 rilievo grave" : `${dati.gravi} rilievi gravi`}</p>
      </div>
    </div>
  );
}

function quantiAccessi(n: number): string {
  return n === 1 ? "1 accesso fallito" : `${n} accessi falliti`;
}

function RigaConBarra({ nome, valore, massimo }: { nome: string; valore: number; massimo: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(2.5rem,30%)_3rem] items-center gap-2 text-[13px]">
      <span className="truncate" title={nome}>{nome}</span>
      <span className="h-2 overflow-hidden rounded-sm bg-[var(--vc-barra-fondo)]" aria-hidden>
        <span className="block h-full bg-[var(--vc-cian)]" style={{ width: `${(valore / Math.max(1, massimo)) * 100}%` }} />
      </span>
      <span className="text-right font-mono tabular-nums">{valore}</span>
    </div>
  );
}

/**
 * Accessi falliti nel tempo: una barra per ora nelle ultime 24 (l'ora peggiore è scura, un pallino
 * segna le ore in cui un account è stato bloccato). Riempie la casella in altezza.
 */
export function AndamentoAccessi({ dati }: { dati: NonNullable<GraficiCasa["accessi"]> }) {
  const max = Math.max(1, ...dati.ore.map((o) => o.falliti));
  const picco = dati.ore.reduce((migliore, o) => (o.falliti > migliore.falliti ? o : migliore), dati.ore[0] ?? { ora: "", falliti: 0, blocchi: 0 });
  return (
    <div className="flex h-full min-h-36 flex-col">
      <p className="text-sm">
        <span className="font-mono text-2xl font-bold tabular-nums">{dati.falliti}</span>
        <span className="ml-2 text-muted-foreground">
          {dati.falliti === 1 ? "accesso fallito" : "accessi falliti"}
          {dati.blocchi > 0 && ` · ${dati.blocchi === 1 ? "1 blocco" : `${dati.blocchi} blocchi`} di account`}
          {picco.falliti > 0 && ` · il picco alle ${picco.ora}`}
        </span>
      </p>
      <div className="mt-2 flex min-h-0 flex-1 items-end gap-[3px]" role="img" aria-label={`Accessi falliti ora per ora, ${dati.falliti} in 24 ore`}>
        {dati.ore.map((o, i) => (
          <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`ore ${o.ora}: ${quantiAccessi(o.falliti)}${o.blocchi > 0 ? `, ${o.blocchi} blocchi` : ""}`}>
            {o.blocchi > 0 && <span aria-hidden className="mx-auto mb-1 block size-1.5 shrink-0 rounded-full bg-[var(--vc-grave)]" />}
            <span
              aria-hidden
              className={`block rounded-sm ${o.falliti === max && o.falliti > 0 ? "bg-[var(--vc-acceso)]" : "bg-[var(--vc-cian)]"}`}
              style={{ height: o.falliti > 0 ? `${Math.max(3, (o.falliti / max) * 88)}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[13px] text-muted-foreground" aria-hidden>
        {dati.ore.map((o, i) => (
          <span key={i} className="min-w-0 flex-1 text-center">{i % 3 === 2 ? o.ora : ""}</span>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[13px] text-muted-foreground">
        <span>una barra per ora</span>
        <span className="inline-flex items-center gap-1"><Campione classe="bg-[var(--vc-acceso)]" /> l&apos;ora peggiore</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block size-1.5 rounded-full bg-[var(--vc-grave)]" /> un account bloccato</span>
      </p>
    </div>
  );
}

/** Accessi falliti per utente: chi sbaglia di più nelle ultime 24 ore, e chi è stato bloccato. */
export function AccessiPerUtente({ dati }: { dati: NonNullable<GraficiCasa["accessi"]> }) {
  const max = Math.max(1, ...dati.chi.map((c) => c.falliti));
  if (dati.chi.length === 0) return <p className="text-sm">Nessun account con accessi falliti</p>;
  return (
    <div className="space-y-2">
      {dati.chi.map((c) => (
        <div key={c.utente}>
          <RigaConBarra nome={c.utente} valore={c.falliti} massimo={max} />
          {c.blocchi > 0 && (
            <p className="text-[13px] text-muted-foreground">{c.blocchi === 1 ? "bloccato 1 volta" : `bloccato ${c.blocchi} volte`}</p>
          )}
        </div>
      ))}
      <p className="pt-1 text-[13px] text-muted-foreground">ultime 24 ore</p>
    </div>
  );
}

/** Accessi falliti: da quali postazioni partono, nelle ultime 24 ore. */
export function AccessiDaDove({ dati }: { dati: NonNullable<GraficiCasa["accessi"]> }) {
  const max = Math.max(1, ...dati.daDove.map((d) => d.falliti));
  return (
    <div className="space-y-2">
      {dati.daDove.map((d) => (
        <RigaConBarra key={d.origine} nome={d.origine} valore={d.falliti} massimo={max} />
      ))}
      <p className="pt-1 text-[13px] text-muted-foreground">
        ultime 24 ore
        {dati.senzaOrigine > 0 && ` · ${dati.senzaOrigine} senza una provenienza indicata`}
      </p>
    </div>
  );
}

/** Gravi e alte per rete, sulla stessa scala. */
export function BarrePerRete({ reti }: { reti: GraficiCasa["perRete"] }) {
  const max = Math.max(1, ...reti.map((r) => r.gravi + r.alte));
  return (
    <div className="space-y-2">
      {reti.map((r) => (
        <div key={r.nome} className="grid grid-cols-[7.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-[13px]">
          <span className="truncate">{r.nome}</span>
          <span className="flex h-2.5 overflow-hidden rounded-sm bg-[var(--vc-barra-fondo)]" aria-hidden>
            <span className="bg-[var(--vc-grave)]" style={{ width: `${(r.gravi / max) * 100}%` }} />
            <span className="bg-[var(--vc-alta)]" style={{ width: `${(r.alte / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono tabular-nums">{r.gravi} · {r.alte}</span>
        </div>
      ))}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[13px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Campione classe="bg-[var(--vc-grave)]" /> gravi</span>
        <span className="inline-flex items-center gap-1"><Campione classe="bg-[var(--vc-alta)]" /> alte</span>
        <span>a destra: gravi · alte</span>
      </p>
    </div>
  );
}

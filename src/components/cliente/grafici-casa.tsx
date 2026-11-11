import { FUSO_UTENTI } from "@/lib/db-date";
import type { GraficiCasa } from "@/lib/cliente/grafici";

/**
 * I grafici della casa della vista cliente: SVG e blocchi semplici, disegnati sul server.
 * Colori solo da `--vc-*` (globals.css). Riccardo è daltonico: le serie si separano per
 * luminosità (scuro / medio) e ogni grafico ha la legenda a parole.
 */

const L = 720;
const A = 190;
const MARGINE = { su: 22, giu: 22, sx: 6, dx: 6 };

function quando(t: string): string {
  const d = new Date(`${t}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("it-IT", { timeZone: FUSO_UTENTI, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** Area con la linea degli apparati accesi; l'ultimo punto è segnato col numero. */
export function GraficoAccesi({ dati }: { dati: NonNullable<GraficiCasa["accesi"]> }) {
  const { punti, minimo, massimo, adesso } = dati;
  const basso = Math.max(0, Math.floor(minimo - (massimo - minimo) * 0.35 - 1));
  const alto = massimo + Math.max(1, (massimo - minimo) * 0.15);
  const larghezza = L - MARGINE.sx - MARGINE.dx;
  const altezza = A - MARGINE.su - MARGINE.giu;
  const x = (i: number) => MARGINE.sx + (i / (punti.length - 1)) * larghezza;
  const y = (v: number) => MARGINE.su + (1 - (v - basso) / (alto - basso)) * altezza;
  const linea = punti.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.accesi).toFixed(1)}`).join(" ");
  const fondo = A - MARGINE.giu;
  const area = `${linea} L${x(punti.length - 1).toFixed(1)} ${fondo} L${x(0).toFixed(1)} ${fondo} Z`;
  const ultimoX = x(punti.length - 1);
  const ultimoY = y(adesso);
  const meta = Math.floor((punti.length - 1) / 2);
  return (
    <svg viewBox={`0 0 ${L} ${A}`} className="block h-auto w-full" role="img" aria-label={`Apparati accesi: ${adesso} adesso, da ${minimo} a ${massimo} nel periodo`}>
      <line x1={MARGINE.sx} x2={L - MARGINE.dx} y1={fondo} y2={fondo} stroke="var(--border)" />
      <line x1={MARGINE.sx} x2={L - MARGINE.dx} y1={y(massimo)} y2={y(massimo)} stroke="var(--border)" strokeDasharray="4 4" />
      <path d={area} fill="var(--vc-barra-fondo)" />
      <path d={linea} fill="none" stroke="var(--vc-cian)" strokeWidth={2.5} strokeLinejoin="round" />
      <circle cx={ultimoX} cy={ultimoY} r={5} fill="var(--vc-acceso)" stroke="var(--card)" strokeWidth={2} />
      <text x={ultimoX - 10} y={Math.max(14, ultimoY - 10)} textAnchor="end" fontSize={15} fontWeight={700} fill="var(--foreground)">
        {adesso} adesso
      </text>
      <text x={MARGINE.sx} y={y(massimo) - 5} fontSize={12} fill="var(--muted-foreground)">
        massimo {massimo}
      </text>
      <text x={MARGINE.sx} y={A - 5} fontSize={12} fill="var(--muted-foreground)">{quando(punti[0]?.t ?? "")}</text>
      <text x={x(meta)} y={A - 5} textAnchor="middle" fontSize={12} fill="var(--muted-foreground)">{quando(punti[meta]?.t ?? "")}</text>
      <text x={L - MARGINE.dx} y={A - 5} textAnchor="end" fontSize={12} fill="var(--muted-foreground)">adesso</text>
    </svg>
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
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 120 120" className="size-28 shrink-0" role="img" aria-label={`Rischio del dominio ${dati.punteggio} su 100`}>
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

function giornoBreve(giorno: string): string {
  const d = new Date(`${giorno}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? giorno : d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, weekday: "short" });
}

/** Barre dei giorni: la più alta è scura, le altre medie; sopra ogni barra il numero. */
export function BarreAccessi({ dati }: { dati: NonNullable<GraficiCasa["accessi"]> }) {
  const max = Math.max(1, ...dati.giorni.map((g) => g.falliti));
  return (
    <div>
      <div className="flex h-28 items-end gap-2">
        {dati.giorni.map((g) => (
          <div key={g.giorno} className="flex h-full min-w-0 flex-1 flex-col justify-end text-center">
            <span className="font-mono text-[13px] tabular-nums">{g.falliti}</span>
            <span
              aria-hidden
              className={`mt-1 block rounded-sm ${g.falliti === max ? "bg-[var(--vc-acceso)]" : "bg-[var(--vc-cian)]"}`}
              style={{ height: `${Math.max(3, (g.falliti / max) * 70)}%` }}
            />
            <span className="mt-1 text-[13px] text-muted-foreground">{giornoBreve(g.giorno)}</span>
          </div>
        ))}
      </div>
      <p className="pt-2 text-[13px] text-muted-foreground">{dati.ultime24} nelle ultime 24 ore</p>
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

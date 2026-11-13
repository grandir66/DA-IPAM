/**
 * I riquadri dei KPI e i grafici di DATIA MONITORING (13/11/2026). Disegnati sul server, senza librerie:
 * sono pochi segni. Le serie si distinguono per luminanza e la legenda dice cosa sono (Riccardo è daltonico);
 * «meglio» e «peggio» si scrivono, non si colorano.
 */
import type { Confronto, Monitoring, SerieMonitoring, StatoOggetto } from "@/lib/cliente/monitoring";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";

function virgola(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ",");
}

export function durata(minuti: number): string {
  if (minuti < 60) return `${minuti} min`;
  const ore = Math.floor(minuti / 60);
  const resto = minuti % 60;
  if (ore < 24) return resto ? `${ore} h ${resto} min` : `${ore} h`;
  const giorni = Math.floor(ore / 24);
  return `${giorni} g ${ore % 24} h`;
}

function andamento(c: Confronto, meglioSeSale: boolean, testo: (n: number) => string): string {
  if (c.precedente === null) return "mese prima: dato non disponibile";
  if (c.precedente === c.corrente) return `uguale al mese prima`;
  const sale = c.corrente > c.precedente;
  return `${sale === meglioSeSale ? "meglio" : "peggio"} del mese prima (${testo(c.precedente)})`;
}

export function TesseraKpi({ titolo, valore, sotto }: { titolo: string; valore: string; sotto: string }) {
  return (
    <div className="flex h-full min-w-0 flex-col justify-center rounded-xl border bg-card px-3.5 py-2">
      <p className="truncate text-[13px] text-muted-foreground">{titolo}</p>
      <p className="truncate text-2xl font-bold leading-tight">{valore}</p>
      <p className="truncate text-[13px] text-muted-foreground">{sotto}</p>
    </div>
  );
}

export function KpiDisponibilita({ m }: { m: Monitoring }) {
  const c = m.kpi.disponibilita;
  if (!c) return null;
  return <TesseraKpi titolo="Disponibilità 30 giorni" valore={`${virgola(c.corrente)}%`} sotto={andamento(c, true, (n) => `${virgola(n)}%`)} />;
}

export function KpiIncidenti({ m }: { m: Monitoring }) {
  const c = m.kpi.incidenti;
  if (!c) return null;
  return <TesseraKpi titolo="Incidenti 30 giorni" valore={String(c.corrente)} sotto={andamento(c, false, String)} />;
}

export function KpiSoluzione({ m }: { m: Monitoring }) {
  const c = m.kpi.soluzioneMin;
  if (!c) return null;
  return <TesseraKpi titolo="Tempo medio di soluzione" valore={durata(c.corrente)} sotto={andamento(c, false, durata)} />;
}

export function KpiScadenza({ m }: { m: Monitoring }) {
  const s = m.kpi.scadenza;
  if (!s) return null;
  const valore = s.giorni < 0 ? "scaduto" : s.giorni === 1 ? "1 giorno" : `${s.giorni} giorni`;
  return <TesseraKpi titolo="Prima scadenza di un certificato" valore={valore} sotto={s.oggetto} />;
}

/** Disponibilità per giorno: una linea, con la scala che parte da poco sotto il minimo (mai sopra il 95%). */
export function GraficoDisponibilita({ serie }: { serie: SerieMonitoring }) {
  const valori = serie.disponibilita;
  const basso = Math.min(95, Math.floor(Math.min(...valori)));
  const y = (v: number) => 4 + (1 - (v - basso) / Math.max(1, 100 - basso)) * 92;
  const x = (i: number) => (i / Math.max(1, valori.length - 1)) * 100;
  const punti = valori.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="flex flex-col justify-between text-right font-mono text-[12px] text-muted-foreground">
          <span>100%</span>
          <span>{basso}%</span>
        </div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full min-h-[80px] w-full" role="img" aria-label={`Disponibilità per giorno, da ${virgola(Math.min(...valori))}% a ${virgola(Math.max(...valori))}%`}>
          <line x1="0" y1={y(100)} x2="100" y2={y(100)} stroke="currentColor" strokeOpacity="0.15" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1={y(basso)} x2="100" y2={y(basso)} stroke="currentColor" strokeOpacity="0.15" vectorEffect="non-scaling-stroke" />
          <polyline points={punti} fill="none" stroke="var(--vc-acceso)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          {valori.map((v, i) => (v < 100 ? <circle key={serie.giorni[i] ?? i} cx={x(i)} cy={y(v)} r="1.2" fill="var(--vc-acceso)"><title>{`${serie.giorni[i]}: ${virgola(v)}%`}</title></circle> : null))}
        </svg>
      </div>
      <div className="flex justify-between pl-10 font-mono text-[12px] text-muted-foreground">
        <span>{serie.giorni[0]?.slice(5).split("-").reverse().join("/")}</span>
        <span>oggi</span>
      </div>
    </div>
  );
}

/** Incidenti per settimana: barre impilate, scure le gravi e chiare le medie. */
export function GraficoIncidenti({ serie }: { serie: SerieMonitoring }) {
  const massimo = Math.max(1, ...serie.settimane.map((w) => w.gravi + w.medi));
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex min-h-0 flex-1 items-end gap-3">
        {serie.settimane.map((w) => {
          const tot = w.gravi + w.medi;
          return (
            <div key={w.etichetta} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <span className="font-mono text-[13px]">{tot}</span>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-sm bg-[var(--vc-barra-fondo)]" style={{ height: `${Math.max(4, (tot / massimo) * 100)}%` }} title={`${w.gravi} gravi, ${w.medi} medi`}>
                <div className="w-full bg-[var(--vc-cian)]" style={{ height: `${tot ? (w.medi / tot) * 100 : 0}%` }} />
                <div className="w-full bg-[var(--vc-acceso)]" style={{ height: `${tot ? (w.gravi / tot) * 100 : 0}%` }} />
              </div>
              <span className="text-[12px] text-muted-foreground">dal {w.etichetta}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[13px] text-muted-foreground">
        <span className="mr-1 inline-block size-3 rounded-sm bg-[var(--vc-acceso)] align-middle" /> gravi
        <span className="ml-3 mr-1 inline-block size-3 rounded-sm bg-[var(--vc-cian)] align-middle" /> medi
      </p>
    </div>
  );
}

const TONO: Record<StatoOggetto, "ok" | "attenzione" | "guasto" | "da_verificare"> = { funziona: "ok", attenzione: "attenzione", fermo: "guasto", non_so: "da_verificare" };
const NOME_STATO: Record<StatoOggetto, string> = { funziona: "funzionano", attenzione: "da tenere d'occhio", fermo: "fermi", non_so: "non so" };

export function ApparatiPerStato({ m }: { m: Monitoring }) {
  const ordine: StatoOggetto[] = ["funziona", "attenzione", "fermo", "non_so"];
  const tot = ordine.reduce((s, k) => s + m.totali[k], 0);
  if (tot === 0) return null;
  return (
    <div className="space-y-2">
      <div className="flex h-5 overflow-hidden rounded-md">
        {ordine.filter((k) => m.totali[k] > 0).map((k) => (
          <span key={k} className={`border-r-2 border-card last:border-r-0 ${STILE_STATO[TONO[k]].classi}`} style={{ flex: m.totali[k] }} title={`${m.totali[k]} ${NOME_STATO[k]}`} />
        ))}
      </div>
      <ul className="space-y-0.5 text-[13px]">
        {ordine.filter((k) => m.totali[k] > 0).map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span className={`inline-flex size-4 items-center justify-center rounded-sm border text-[11px] ${STILE_STATO[TONO[k]].classi}`}>{STILE_STATO[TONO[k]].segno}</span>
            <span className="font-mono">{m.totali[k]}</span> {NOME_STATO[k]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SpazioPiuPieno({ m }: { m: Monitoring }) {
  if (m.spazio.length === 0) return null;
  return (
    <ul className="space-y-2 text-[13px]">
      {m.spazio.map((s) => (
        <li key={`${s.nome}|${s.dettaglio}`} className="space-y-0.5">
          <div className="flex justify-between gap-2">
            <span className="truncate">{s.nome}{s.dettaglio ? <span className="text-muted-foreground"> · {s.dettaglio}</span> : null}</span>
            <span className="shrink-0 font-mono">{virgola(s.valore)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-sm bg-[var(--vc-barra-fondo)]">
            <div className={`h-full rounded-sm ${s.valore >= 90 ? "bg-[var(--vc-acceso)]" : "bg-[var(--vc-cian)]"}`} style={{ width: `${Math.min(100, s.valore)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

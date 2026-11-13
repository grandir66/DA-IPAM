import { Check, CircleHelp, TriangleAlert, Wrench, X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GrigliaCasa, type ContenutoRiquadro } from "@/components/cliente/griglia-casa";
import { GestioneVisibilita } from "@/components/cliente/monitoring/gestione-visibilita";
import {
  ApparatiPerStato, GraficoDisponibilita, GraficoIncidenti, KpiDisponibilita, KpiIncidenti, KpiScadenza, KpiSoluzione, SpazioPiuPieno,
} from "@/components/cliente/monitoring/kpi";
import { leggiDisposizione, disposizionePredefinita, type VoceDisposizione } from "@/lib/cliente/casa";
import { CHIAVE_MONITORING, RIQUADRI_MONITORING } from "@/lib/cliente/monitoring-riquadri";
import { nelCliente } from "@/lib/cliente/contesto";
import { PaginaModulo } from "@/components/cliente/pagina-modulo";
import { Pannello, Vuoto } from "@/components/shared/console";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import { contestoCliente } from "@/lib/cliente/contesto";
import {
  ETICHETTA_STATO,
  testoMisura,
  type FamigliaMostrata,
  type Monitoring,
  type OggettoMostrato,
  type StatoOggetto,
} from "@/lib/cliente/monitoring";
import { leggiMonitoring, schedaMonitoring, TITOLO_MONITORING } from "@/lib/cliente/schede/monitoring";
import { daQuanto } from "@/lib/cliente/testi";
import { FUSO_UTENTI } from "@/lib/db-date";

export const dynamic = "force-dynamic";

/** Forma e luminanza diverse per ogni stato: si leggono anche senza i colori (Riccardo è daltonico). */
const TONO: Record<StatoOggetto, ToniStato> = { funziona: "ok", attenzione: "attenzione", fermo: "guasto", non_so: "da_verificare" };
const ICONA = { funziona: Check, attenzione: TriangleAlert, fermo: X, non_so: CircleHelp } as const;

function Stato({ stato, testo }: { stato: StatoOggetto; testo?: string }) {
  const Icona = ICONA[stato];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold ${STILE_STATO[TONO[stato]].classi}`}>
      <Icona className="size-3.5" aria-hidden />
      {testo ?? ETICHETTA_STATO[stato]}
    </span>
  );
}

function oraItaliana(iso: string | null): string {
  if (!iso) return "ora non nota";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "ora non nota";
  return d.toLocaleString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function eta(s: number): string {
  if (s < 90) return "adesso";
  const minuti = Math.round(s / 60);
  return minuti < 60 ? `${minuti} minuti fa` : `${Math.round(minuti / 60)} ore fa`;
}

function Fascia({ m }: { m: Monitoring }) {
  const Icona = ICONA[m.stato];
  return (
    <section className="flex h-full flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-lg border ${STILE_STATO[TONO[m.stato]].classi}`}>
        <Icona className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold leading-tight">{m.frase}</p>
        {m.sottofrase && <p className="text-[13px] text-muted-foreground">{m.sottofrase}</p>}
      </div>
      <div className="text-right text-[13px]">
        <p className="text-muted-foreground">Ultima lettura</p>
        <p className="font-mono">{oraItaliana(m.lettoAlle)} · {eta(m.etaS)}</p>
      </div>
    </section>
  );
}

function contoFamiglia(f: FamigliaMostrata): { stato: StatoOggetto; testo: string } {
  const tutti = f.oggetti.length;
  if (f.conta.fermo > 0) return { stato: "fermo", testo: `${f.conta.fermo} ${f.conta.fermo === 1 ? "fermo" : "fermi"} di ${tutti}` };
  if (f.conta.attenzione > 0) return { stato: "attenzione", testo: `${f.conta.attenzione} attenzione di ${tutti}` };
  if (f.conta.non_so > 0) return { stato: "non_so", testo: `di ${f.conta.non_so} non so, su ${tutti}` };
  return { stato: "funziona", testo: `${tutti} di ${tutti}` };
}

function RiquadroFamiglia({ f }: { f: FamigliaMostrata }) {
  const conto = contoFamiglia(f);
  return (
    <a href={`#famiglia-${f.codice}`} className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card px-3.5 py-3 hover:border-[var(--vc-cian)]">
      <p className="truncate text-sm font-bold">{f.etichetta}</p>
      <div><Stato stato={conto.stato} testo={conto.testo} /></div>
      <dl className="space-y-0.5 text-[13px]">
        {f.sintesi.map((r) => (
          <div key={r.etichetta} className="flex justify-between gap-2">
            <dt className="truncate text-muted-foreground">{r.etichetta}</dt>
            <dd className="shrink-0 font-mono">{r.valore}</dd>
          </div>
        ))}
        {f.disponibilita30 !== null && (
          <div className="flex justify-between gap-2">
            <dt className="truncate text-muted-foreground">Senza fermi, 30 giorni</dt>
            <dd className="shrink-0 font-mono">{String(f.disponibilita30).replace(".", ",")}%</dd>
          </div>
        )}
      </dl>
    </a>
  );
}

/** Le colonne della scheda: le misure che almeno un oggetto della famiglia ha, nell'ordine del centro. */
function colonne(f: FamigliaMostrata): Array<{ codice: string; etichetta: string }> {
  const viste = new Map<string, string>();
  for (const o of f.oggetti) for (const m of o.misure) if (!viste.has(m.codice)) viste.set(m.codice, m.etichetta);
  return [...viste].map(([codice, etichetta]) => ({ codice, etichetta }));
}

function RigaOggetto({ o, col }: { o: OggettoMostrato; col: Array<{ codice: string }> }) {
  return (
    <tr className="border-t align-top">
      <td className="py-1.5 pr-3"><Stato stato={o.stato} /></td>
      <td className="py-1.5 pr-3">
        <span className="font-medium">{o.nome}</span>
        {o.motivo && <span className="block text-[13px] text-muted-foreground">{o.motivo}</span>}
      </td>
      {col.map((c) => {
        const m = o.misure.find((x) => x.codice === c.codice);
        return (
          <td key={c.codice} className="py-1.5 pr-3 font-mono text-[13px]">
            {m ? (
              <span className={m.vecchio || o.stato === "non_so" ? "text-muted-foreground" : undefined}>
                {m.vecchio || o.stato === "non_so" ? "era " : ""}{testoMisura(m)}
              </span>
            ) : (
              <span className="text-muted-foreground">–</span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function SchedaFamiglia({ f }: { f: FamigliaMostrata }) {
  const col = colonne(f);
  return (
    <div id={`famiglia-${f.codice}`} className="scroll-mt-4">
      <Pannello titolo={f.etichetta} conteggio={f.oggetti.length}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[13px] text-muted-foreground">
                <th className="w-32 pb-1 pr-3 font-normal">Stato</th>
                <th className="pb-1 pr-3 font-normal">Apparato</th>
                {col.map((c) => <th key={c.codice} className="pb-1 pr-3 font-normal">{c.etichetta}</th>)}
              </tr>
            </thead>
            <tbody>
              {f.oggetti.map((o) => <RigaOggetto key={o.riga} o={o} col={col} />)}
            </tbody>
          </table>
        </div>
      </Pannello>
    </div>
  );
}

const MINUTI_GIORNO = 1440;

function Storico({ m }: { m: Monitoring }) {
  const righe = m.famiglie.filter((f) => f.fermoPerGiorno !== null);
  if (righe.length === 0) return <p className="text-sm">Dato non disponibile</p>;
  return (
    <div className="space-y-2">
      {righe.map((f) => (
        <div key={f.codice} className="grid grid-cols-[11rem_minmax(0,1fr)_4.5rem] items-center gap-3 text-sm">
          <span className="truncate">{f.etichetta}</span>
          <div className="flex h-5 gap-px">
            {f.fermoPerGiorno!.map((minuti, i) => {
              // Luminanza: chiaro = nessun fermo, scuro pieno = fermo. Sotto 5 minuti resta chiaro con un segno.
              const fermo = minuti >= 5;
              return (
                <span
                  key={m.giorni[i] ?? i}
                  title={`${m.giorni[i] ?? ""}: ${minuti === 0 ? "nessun fermo" : `${Math.min(minuti, MINUTI_GIORNO)} minuti di fermo`}`}
                  className={`flex-1 rounded-[2px] ${fermo ? "bg-[var(--vc-acceso)]" : "bg-[var(--vc-barra-fondo)]"}`}
                />
              );
            })}
          </div>
          <span className="text-right font-mono text-[13px]">{f.disponibilita30 === null ? "–" : `${String(f.disponibilita30).replace(".", ",")}%`}</span>
        </div>
      ))}
      <p className="text-[13px] text-muted-foreground">Un segmento per giorno, dal più vecchio a oggi. Chiaro: nessun fermo. Scuro: almeno un apparato non rispondeva.</p>
    </div>
  );
}

function Famiglie({ m }: { m: Monitoring }) {
  if (m.famiglie.length === 0) return null;
  return (
    <div className="grid h-full gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
      {m.famiglie.map((f) => <RiquadroFamiglia key={f.codice} f={f} />)}
    </div>
  );
}

function Problemi({ m, ora }: { m: Monitoring; ora: Date }) {
  if (m.problemi.length === 0) return <p className="text-sm">Nessun problema aperto.</p>;
  return (
    <div>
      {m.problemi.map((p) => (
        <div key={p.eventid} className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-b-0">
          <Stato stato={p.grave ? "fermo" : "attenzione"} testo={p.grave ? "Grave" : "Medio"} />
          <span className="min-w-0 flex-1">
            <span className="text-muted-foreground">{p.famiglia} · </span>
            <span className="font-medium">{p.nomeOggetto}</span>: {p.frase}
            {p.quante > 1 && <span className="text-muted-foreground"> · {p.quante} volte</span>}
          </span>
          <span className="text-[13px] text-muted-foreground">{p.dal ? daQuanto(new Date(p.dal), ora) : ""}</span>
          {p.presoInCarico ? (
            <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] ${STILE_STATO.da_verificare.classi}`}>
              <Wrench className="size-3.5" aria-hidden />
              Domarc ci sta lavorando
            </span>
          ) : (
            <span className="text-[13px] text-muted-foreground">Non ancora preso in carico</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default async function PaginaMonitoring({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const componi = (await searchParams).componi === "1";
  const c = await contestoCliente();
  if (!(await schedaMonitoring.attiva(c))) redirect("/cliente");
  let esito: Awaited<ReturnType<typeof leggiMonitoring>>;
  try {
    esito = await leggiMonitoring(c);
  } catch (e) {
    console.error("[cliente] monitoring:", e instanceof Error ? e.message : String(e));
    esito = { ok: false, messaggio: "Dato non disponibile", ultimaLetturaOk: null };
  }
  if (!esito.ok) {
    return (
      <PaginaModulo titolo={TITOLO_MONITORING}>
        <Vuoto
          titolo={esito.messaggio}
          testo={esito.ultimaLetturaOk ? `Ultima lettura riuscita: ${oraItaliana(esito.ultimaLetturaOk)}. La pagina riprova da sola.` : "La pagina riprova da sola."}
        />
      </PaginaModulo>
    );
  }
  const m = esito.dati;
  const tutti = m.famiglie.reduce((s, f) => s + f.oggetti.length, 0);
  let disposizione: VoceDisposizione[] = disposizionePredefinita(RIQUADRI_MONITORING);
  try {
    disposizione = nelCliente(c, (db) => leggiDisposizione(db, CHIAVE_MONITORING, RIQUADRI_MONITORING));
  } catch (e) {
    console.error("[cliente] disposizione di monitoring:", e instanceof Error ? e.message : String(e));
  }
  const inModifica = c.amministratore && componi;
  // Cosa disegna ogni riquadro della libreria (`monitoring-riquadri.ts`); null = oggi non c'è niente da dire.
  const contenuti: ContenutoRiquadro[] = [
    { id: "fascia", titolo: "Stato in una frase", azioni: null, nudo: true, contenuto: <Fascia m={m} /> },
    { id: "kpi-disponibilita", titolo: "Disponibilità 30 giorni", azioni: null, nudo: true, contenuto: m.kpi.disponibilita ? <KpiDisponibilita m={m} /> : null },
    { id: "kpi-incidenti", titolo: "Incidenti 30 giorni", azioni: null, nudo: true, contenuto: m.kpi.incidenti ? <KpiIncidenti m={m} /> : null },
    { id: "kpi-soluzione", titolo: "Tempo di soluzione", azioni: null, nudo: true, contenuto: m.kpi.soluzioneMin ? <KpiSoluzione m={m} /> : null },
    { id: "kpi-scadenza", titolo: "Prima scadenza", azioni: null, nudo: true, contenuto: m.kpi.scadenza ? <KpiScadenza m={m} /> : null },
    { id: "famiglie", titolo: "Famiglie", azioni: null, nudo: true, contenuto: m.famiglie.length ? <Famiglie m={m} /> : null },
    { id: "grafico-disponibilita", titolo: "Disponibilità per giorno", azioni: null, contenuto: m.serie ? <GraficoDisponibilita serie={m.serie} /> : null },
    { id: "grafico-incidenti", titolo: "Incidenti per settimana", azioni: null, contenuto: m.serie ? <GraficoIncidenti serie={m.serie} /> : null },
    { id: "stati", titolo: "Apparati per stato", azioni: null, contenuto: tutti ? <ApparatiPerStato m={m} /> : null },
    { id: "spazio", titolo: "Spazio più pieno", azioni: null, contenuto: m.spazio.length ? <SpazioPiuPieno m={m} /> : null },
    { id: "problemi", titolo: `Problemi aperti · ${m.problemi.length}`, azioni: null, contenuto: <Problemi m={m} ora={c.ora} /> },
    { id: "storico", titolo: "Ultimi 30 giorni per famiglia", azioni: null, contenuto: m.famiglie.some((f) => f.fermoPerGiorno) ? <Storico m={m} /> : null },
  ];
  const uscita = "/cliente/monitoring";
  return (
    <PaginaModulo titolo={TITOLO_MONITORING} contesto={`${tutti} apparati sotto controllo`}>
      <GrigliaCasa
        key={inModifica ? "modifica" : "vista"}
        iniziale={disposizione}
        riquadri={contenuti}
        libreria={RIQUADRI_MONITORING}
        modifica={inModifica}
        endpoint="/api/vista-cliente/monitoring"
        uscita={uscita}
      />
      {inModifica && <GestioneVisibilita famiglie={m.gestione} />}
      {c.amministratore && !componi && (
        <p className="nascosto-stampa text-[13px]">
          <Link href={`${uscita}?componi=1`} className="font-medium text-cian-testo hover:underline">
            Componi questa pagina
          </Link>
          <span className="ml-2 text-muted-foreground">Sposta, ridimensiona, nascondi i riquadri e scegli famiglie e apparati che vede il cliente. Lo vedi solo tu.</span>
        </p>
      )}
      {!inModifica && m.famiglie.map((f) => <SchedaFamiglia key={f.codice} f={f} />)}
    </PaginaModulo>
  );
}

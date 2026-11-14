"use client";

/**
 * La pagina Schedulazioni (tavola del 22/10, oggetti 21-30): tutto ciò che parte da solo, in un elenco unico ordinato per
 * prossimo giro. Legge `GET /api/schedulazioni`, accende e spegne con `PUT /api/schedulazioni/[id]` e rilegge. Qui non si
 * configura niente: «Dove ›» porta alla pagina che la configura oggi. Colonne separate: stato · famiglia · cosa · su cosa ·
 * quando · prossimo · ultimo esito · dove.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Lock, Trash2 } from "lucide-react";
import { LoadError } from "@/components/shared/load-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import { ESITI } from "@/components/opzioni/pagina-opzioni";
import type { Famiglia, RigaSchedulazione } from "@/lib/schedulazioni/elenco";
import { EsitiApparatiScelti } from "@/components/jobs/esiti-apparati-scelti";
import { FinestraScansioneAutomatica } from "@/components/jobs/finestra-scansione-automatica";
import { NuovoJob } from "./nuovo-job";

interface Dati {
  puoCambiare: boolean;
  righe: RigaSchedulazione[];
}

type FiltroStato = "tutte" | "accese" | "spente" | "errore";
type FiltroFamiglia = "tutte" | Famiglia;

const FILTRI_STATO: ReadonlyArray<{ id: FiltroStato; etichetta: string }> = [
  { id: "tutte", etichetta: "Tutte" },
  { id: "accese", etichetta: "Accese" },
  { id: "spente", etichetta: "Spente" },
  { id: "errore", etichetta: "✕ In errore" },
];

const FILTRI_FAMIGLIA: ReadonlyArray<{ id: FiltroFamiglia; etichetta: string }> = [
  { id: "tutte", etichetta: "Tutte le famiglie" },
  { id: "reti", etichetta: "Reti" },
  { id: "apparati", etichetta: "Apparati" },
  { id: "moduli", etichetta: "Moduli" },
  { id: "appliance", etichetta: "Appliance" },
];

const FAMIGLIA: Record<Famiglia, string> = { reti: "Reti", apparati: "Apparati", moduli: "Moduli", appliance: "Appliance" };

/**
 * Le colonne della riga e dell'intestazione: le stesse, così stanno in fila. Da scrivania: a 1280 la colonna Famiglia
 * si nasconde (resta il filtro) perché ultimo esito e «Dove» restino in vista senza scorrere; da 1536 c'è.
 */
const COLONNE =
  "grid grid-cols-[140px_minmax(140px,1.2fr)_minmax(100px,1fr)_minmax(100px,0.9fr)_110px_minmax(160px,1.4fr)_230px] 2xl:grid-cols-[150px_96px_minmax(180px,1.2fr)_minmax(150px,1fr)_minmax(150px,0.9fr)_130px_minmax(200px,1.4fr)_250px] gap-3 items-center";

const AZIONE =
  "inline-flex min-h-8 items-center rounded-lg border border-[#D0D8DC] bg-white px-2 text-[13px] text-[#0D2537] hover:bg-[#EDEDED] disabled:opacity-60 dark:border-[#3A4A57] dark:bg-transparent dark:text-[#E6EEF4]";

const BASE = "inline-flex items-center gap-2 rounded-full border-2 text-[13px] font-bold min-h-8 whitespace-nowrap";

/** «fra 4 min», «oggi 18:00», «domani 03:00», «26/10 22:00» (ora italiana). */
export function quandoProssimo(utc: string, adesso: Date = new Date()): string {
  const d = parseDbDate(utc);
  if (Number.isNaN(d.getTime())) return utc;
  const min = Math.round((d.getTime() - adesso.getTime()) / 60_000);
  if (min <= 0) return "adesso";
  if (min < 60) return `fra ${min} min`;
  const giorno = (x: Date) => x.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI });
  const ora = d.toLocaleTimeString("it-IT", { timeZone: FUSO_UTENTI, hour: "2-digit", minute: "2-digit" });
  if (giorno(d) === giorno(adesso)) return `oggi ${ora}`;
  if (giorno(d) === giorno(new Date(adesso.getTime() + 86_400_000))) return `domani ${ora}`;
  return `${d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit" })} ${ora}`;
}

function passa(r: RigaSchedulazione, s: FiltroStato, f: FiltroFamiglia, q: string): boolean {
  if (s === "accese" && r.stato !== "acceso") return false;
  if (s === "spente" && r.stato === "acceso") return false;
  if (s === "errore" && r.esito.tipo !== "errore") return false;
  if (f !== "tutte" && r.famiglia !== f) return false;
  return !q || `${r.nome} ${r.su} ${r.cosa} ${r.quando}`.toLowerCase().includes(q);
}

/** Lo stato (oggetto 24): levetta, «SEMPRE» col lucchetto, o «DA CONFIGURARE». Stati per luminanza e scritta. */
function Stato({
  r,
  puoCambiare,
  inCorso,
  onCambia,
}: {
  r: RigaSchedulazione;
  puoCambiare: boolean;
  inCorso: boolean;
  onCambia: (acceso: boolean) => void;
}) {
  if (r.fisso) {
    return (
      <span title={r.perche} className="inline-flex items-center gap-1.5 rounded-md bg-[#EDEDED] px-2.5 py-1 text-[13px] font-bold text-[#0D2537] dark:bg-[#22313D] dark:text-[#E6EEF4]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        {r.stato === "acceso" ? "SEMPRE" : "SPENTO"}
      </span>
    );
  }
  if (r.stato === "da_configurare") {
    return (
      <span className={cn(BASE, "border-dashed border-[#5B6B77] bg-white px-2.5 py-0.5 text-[#0D2537] dark:border-[#A9BECC] dark:bg-transparent dark:text-[#E6EEF4]")}>
        ○ DA CONFIGURARE
      </span>
    );
  }
  const acceso = r.stato === "acceso";
  const ferma = !puoCambiare || !r.cambio;
  const titolo = !puoCambiare ? "Solo un amministratore può cambiarla" : !r.cambio ? (r.perche ?? "Si cambia dalla sua pagina") : acceso ? "Clic per spegnere" : "Clic per accendere";
  const etichetta = acceso ? "ACCESA" : "SPENTA";
  return (
    <button
      type="button"
      aria-pressed={acceso}
      aria-label={`${r.nome}, ${r.su}: ${etichetta.toLowerCase()}. ${titolo}`}
      title={titolo}
      disabled={ferma || inCorso}
      onClick={() => onCambia(!acceso)}
      className={cn(
        BASE,
        "py-0.5 transition-opacity",
        acceso
          ? "border-[#0D2537] bg-[#0D2537] pl-3 pr-1.5 text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]"
          : "border-[#5B6B77] bg-white pl-1.5 pr-3 text-[#0D2537] dark:border-[#A9BECC] dark:bg-transparent dark:text-[#E6EEF4]",
        ferma ? "cursor-not-allowed opacity-80" : "cursor-pointer hover:opacity-90",
        inCorso && "opacity-50",
      )}
    >
      {acceso ? (
        <>{etichetta}<span className="h-5 w-5 rounded-full bg-white dark:bg-[#0D2537]" aria-hidden="true" /></>
      ) : (
        <><span className="h-[18px] w-[18px] rounded-full border-2 border-[#5B6B77] dark:border-[#A9BECC]" aria-hidden="true" />{etichetta}</>
      )}
    </button>
  );
}

export function PaginaSchedulazioni({ cliente }: { cliente: string }) {
  const [dati, setDati] = useState<Dati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtroStato, setFiltroStato] = useState<FiltroStato>("tutte");
  const [filtroFamiglia, setFiltroFamiglia] = useState<FiltroFamiglia>("tutte");
  const [cerca, setCerca] = useState("");
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [daSpegnere, setDaSpegnere] = useState<RigaSchedulazione | null>(null);
  const [adesso, setAdesso] = useState(() => new Date());
  // Gestione dei job, tutta qui dall'11/11/2026 (prima in Impostazioni → «Job schedulati»).
  const [jobInModifica, setJobInModifica] = useState<number | null>(null);
  const [daEliminare, setDaEliminare] = useState<RigaSchedulazione | null>(null);
  const [esitiAperti, setEsitiAperti] = useState<Set<string>>(new Set());
  const [versioneEsiti, setVersioneEsiti] = useState(0);

  const carica = useCallback(async () => {
    const r = await fetchJson<Dati>("/api/schedulazioni", { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
    setAdesso(new Date());
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  const cambia = useCallback(
    async (r: RigaSchedulazione, acceso: boolean) => {
      setInCorso(r.id);
      const res = await fetchJson<{ avviso?: string }>(`/api/schedulazioni/${encodeURIComponent(r.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceso }),
      });
      if (res.ok) {
        if (res.data.avviso) toast.warning(res.data.avviso);
        else toast.success(`«${r.nome}» ${acceso ? "accesa" : "spenta"}`);
      } else {
        toast.error(`«${r.nome}»: ${res.message}`);
      }
      await carica();
      setInCorso(null);
    },
    [carica],
  );

  /** «Esegui ora» (P3, 23/10): la rotta della pagina dei job; 202 = partito, l'esito arriva nell'elenco. */
  const esegui = useCallback(
    async (r: RigaSchedulazione) => {
      if (r.jobId === null) return;
      setInCorso(r.id);
      const res = await fetchJson<{ error?: string }>(`/api/jobs/${r.jobId}/run`, { method: "POST" });
      if (res.ok) toast.success(`«${r.nome}» partito: l'esito si vede qui appena finisce`);
      else toast.error(`«${r.nome}»: ${res.message}`);
      await carica();
      setInCorso(null);
    },
    [carica],
  );

  const elimina = useCallback(
    async (r: RigaSchedulazione) => {
      if (r.jobId === null) return;
      setInCorso(r.id);
      const res = await fetchJson<unknown>(`/api/jobs?id=${r.jobId}`, { method: "DELETE" });
      if (res.ok) toast.success(`«${r.nome}» eliminato`);
      else toast.error(`«${r.nome}»: ${res.message}`);
      await carica();
      setInCorso(null);
    },
    [carica],
  );

  // Chi arriva da un rimando (`#job.<id>`: scheda dell'apparato, vecchio indirizzo dei job) trova la riga in vista.
  const caricato = dati !== null;
  useEffect(() => {
    if (!caricato || !window.location.hash) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "center" });
  }, [caricato]);

  const righe = useMemo(() => {
    if (!dati) return [];
    const q = cerca.trim().toLowerCase();
    return dati.righe.filter((r) => passa(r, filtroStato, filtroFamiglia, q));
  }, [dati, filtroStato, filtroFamiglia, cerca]);

  const conti = useMemo(() => {
    const tutte = dati?.righe ?? [];
    const prossima = tutte.find((r) => r.prossimo);
    return {
      totale: tutte.length,
      accese: tutte.filter((r) => r.stato === "acceso").length,
      errore: tutte.filter((r) => r.esito.tipo === "errore").length,
      prossima,
    };
  }, [dati]);

  if (errore && !dati) return <LoadError what="le schedulazioni" message={errore} onRetry={() => void carica()} />;

  const pulsante = (attivo: boolean) =>
    cn(
      "rounded-lg border px-3 py-1.5 text-[14px]",
      attivo
        ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]"
        : "border-[#D0D8DC] bg-white text-[#0D2537] hover:bg-[#EDEDED] dark:border-[#3A4A57] dark:bg-transparent dark:text-[#E6EEF4]",
    );

  return (
    <div className="space-y-4 text-[#0D2537] dark:text-[#E6EEF4]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1 className="sr-only">Schedulazioni</h1>
        <span className="text-[15px]">Cliente <b className="font-semibold">{cliente}</b></span>
        {dati && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
            <span><b className="font-bold">{conti.totale}</b> pianificate</span>
            <span><b className="font-bold">{conti.accese}</b> accese</span>
            {conti.errore > 0 && (
              <span className={cn("rounded-md px-2 py-0.5 font-semibold", ESITI.errore.classe)}>✕ {conti.errore} in errore</span>
            )}
            {conti.prossima?.prossimo && (
              <span>
                prossimo giro <b className="font-bold">{quandoProssimo(conti.prossima.prossimo, adesso)}</b> ({conti.prossima.nome})
              </span>
            )}
          </div>
        )}
        {dati && !dati.puoCambiare && (
          <span className="rounded-md border-2 border-[#5B6B77] px-2 py-0.5 text-[14px] font-semibold">Solo un amministratore può cambiarle</span>
        )}
        {dati?.puoCambiare && <div className="ml-auto"><NuovoJob onCreato={() => void carica()} /></div>}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="group" aria-label="Filtro per stato" className="flex flex-wrap gap-1.5">
          {FILTRI_STATO.map((f) => (
            <button key={f.id} type="button" aria-pressed={filtroStato === f.id} onClick={() => setFiltroStato(f.id)} className={pulsante(filtroStato === f.id)}>
              {f.etichetta}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Filtro per famiglia" className="flex flex-wrap gap-1.5">
          {FILTRI_FAMIGLIA.map((f) => (
            <button key={f.id} type="button" aria-pressed={filtroFamiglia === f.id} onClick={() => setFiltroFamiglia(f.id)} className={pulsante(filtroFamiglia === f.id)}>
              {f.etichetta}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Cerca una schedulazione"
          placeholder="Cerca…"
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
          className="w-56 rounded-lg border border-[#D0D8DC] bg-white px-2.5 py-1.5 text-[15px] dark:border-[#3A4A57] dark:bg-transparent"
        />
      </div>

      {errore && dati && (
        <p className="text-[14px] font-semibold text-[#8E1B20] dark:text-[#E8625A]">Ultimo aggiornamento non riuscito: {errore}</p>
      )}

      {!dati ? (
        <p className="text-[14px] text-muted-foreground">Caricamento…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#D0D8DC] bg-white dark:border-[#3A4A57] dark:bg-[#13222E]">
          <div className="min-w-[1050px] 2xl:min-w-[1310px]">
            <div className={cn(COLONNE, "border-b border-[#D0D8DC] px-4 py-3 text-[13px] font-semibold uppercase text-[#4A6070] dark:border-[#3A4A57] dark:text-[#A9BECC]")}>
              <div>Stato</div>
              <div className="hidden 2xl:block">Famiglia</div>
              <div>Cosa</div>
              <div>Su cosa</div>
              <div>Quando</div>
              <div>Prossimo ▲</div>
              <div>Ultimo esito</div>
              <div>Azioni</div>
            </div>
            {righe.length === 0 && <p className="px-4 py-3 text-[14px]">Nessuna schedulazione con questo filtro.</p>}
            {righe.map((r) => (
              <div key={r.id} id={r.id} className={cn(COLONNE, "border-t border-[#EDEDED] px-4 py-2 text-[14px] first-of-type:border-t-0 dark:border-[#22313D]")}>
                <div>
                  <Stato
                    r={r}
                    puoCambiare={dati.puoCambiare}
                    inCorso={inCorso === r.id}
                    onCambia={(acceso) => (acceso ? void cambia(r, true) : setDaSpegnere(r))}
                  />
                </div>
                <div className="hidden text-[13px] 2xl:block">{FAMIGLIA[r.famiglia]}</div>
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{r.nome}</div>
                  {r.cosa && <div className="text-[13px] font-light text-[#4A6070] dark:text-[#A9BECC]">{r.cosa}</div>}
                </div>
                <div className="min-w-0">{r.su}</div>
                <div>{r.quando}</div>
                <div className={cn(r.id === conti.prossima?.id && "font-bold")}>{r.prossimo ? quandoProssimo(r.prossimo, adesso) : "—"}</div>
                {r.jobTipo === "apparati_scelti" && r.jobId !== null ? (
                  <button
                    type="button"
                    aria-expanded={esitiAperti.has(r.id)}
                    title="Mostra l'esito per apparato"
                    onClick={() => setEsitiAperti((p) => { const n = new Set(p); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                    className="flex min-w-0 items-center gap-2 text-left hover:underline"
                  >
                    <span className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[13px] font-semibold", ESITI[r.esito.tipo].classe)}>
                      {ESITI[r.esito.tipo].segno}
                    </span>
                    <span className="min-w-0 text-[13px]">{r.esito.testo} {esitiAperti.has(r.id) ? "▾" : "▸"}</span>
                  </button>
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[13px] font-semibold", ESITI[r.esito.tipo].classe)}>
                      {ESITI[r.esito.tipo].segno}
                    </span>
                    <span className="min-w-0 text-[13px]">{r.esito.testo}</span>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-1.5">
                  {r.dove && (
                    <Link href={r.dove.href} className="text-[#006C96] underline hover:text-[#0D2537] dark:text-[#3FBBF0]">
                      {r.dove.etichetta}
                    </Link>
                  )}
                  {!r.dove && r.jobId === null && "—"}
                  {dati.puoCambiare && r.jobId !== null && (
                    <>
                      <button type="button" disabled={inCorso === r.id} onClick={() => void esegui(r)} className={AZIONE}>
                        Esegui ora
                      </button>
                      {r.jobTipo === "apparati_scelti" && (
                        <button type="button" disabled={inCorso === r.id} onClick={() => setJobInModifica(r.jobId)} className={AZIONE}>
                          Modifica
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={inCorso === r.id}
                        onClick={() => setDaEliminare(r)}
                        title="Elimina job"
                        aria-label={`Elimina il job «${r.nome}»`}
                        className={cn(AZIONE, "px-1.5")}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
                {r.jobTipo === "apparati_scelti" && r.jobId !== null && esitiAperti.has(r.id) && (
                  <div className="col-span-full mt-2 rounded-lg border border-[#D0D8DC] bg-[#F6F8F9] dark:border-[#3A4A57] dark:bg-[#0F1C26]">
                    <EsitiApparatiScelti key={versioneEsiti} jobId={r.jobId} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Dialog open={daSpegnere !== null} onOpenChange={(aperto) => { if (!aperto) setDaSpegnere(null); }}>
        <DialogContent className="sm:max-w-xl">
          {daSpegnere && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">Spegnere «{daSpegnere.nome}»?</DialogTitle>
                <DialogDescription className="sr-only">Cosa si ferma e cosa resta</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5 text-[15px] font-light leading-relaxed">
                <p><b className="font-semibold">Si ferma:</b> «{daSpegnere.nome}» su {daSpegnere.su}, {daSpegnere.quando}.</p>
                <p><b className="font-semibold">Resta:</b> tutto quello già letto, che invecchia; si riaccende da qui{daSpegnere.dove ? ` o da «${daSpegnere.dove.etichetta.replace(" ›", "")}»` : ""}.</p>
                <p><b className="font-semibold">Dopo gli aggiornamenti:</b> resta spenta. Non si riaccende da sola.</p>
              </div>
              <p className="text-[14px] text-muted-foreground">Cliente {cliente} · si registra chi l&apos;ha spenta e quando.</p>
              <DialogFooter>
                <Button variant="outline" className="min-h-11 text-[15px]" onClick={() => setDaSpegnere(null)}>Annulla</Button>
                <Button
                  className="min-h-11 bg-[#0D2537] text-[15px] font-semibold text-white hover:bg-[#0D2537]/90 dark:bg-[#E6EEF4] dark:text-[#0D2537]"
                  onClick={() => {
                    const r = daSpegnere;
                    setDaSpegnere(null);
                    if (r) void cambia(r, false);
                  }}
                >
                  Spegni
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={daEliminare !== null} onOpenChange={(aperto) => { if (!aperto) setDaEliminare(null); }}>
        <DialogContent className="sm:max-w-xl">
          {daEliminare && (
            <>
              <DialogHeader>
                <DialogTitle className="text-xl font-bold">Eliminare «{daEliminare.nome}»?</DialogTitle>
                <DialogDescription className="sr-only">Cosa si perde e cosa resta</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5 text-[15px] font-light leading-relaxed">
                <p><b className="font-semibold">Si perde:</b> il job su {daEliminare.su}, {daEliminare.quando}. Per riaverlo va ricreato.</p>
                <p><b className="font-semibold">Resta:</b> tutto quello già letto. Per fermarlo senza perderlo basta spegnerlo.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" className="min-h-11 text-[15px]" onClick={() => setDaEliminare(null)}>Annulla</Button>
                <Button
                  className="min-h-11 bg-[#0D2537] text-[15px] font-semibold text-white hover:bg-[#0D2537]/90 dark:bg-[#E6EEF4] dark:text-[#0D2537]"
                  onClick={() => {
                    const r = daEliminare;
                    setDaEliminare(null);
                    if (r) void elimina(r);
                  }}
                >
                  Elimina
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {jobInModifica !== null && (
        <FinestraScansioneAutomatica
          modo="modifica"
          jobId={jobInModifica}
          open
          onOpenChange={(o) => { if (!o) setJobInModifica(null); }}
          onFatto={() => { setVersioneEsiti((v) => v + 1); void carica(); }}
        />
      )}
    </div>
  );
}

"use client";

/**
 * La pagina Opzioni (spec 2026-10-22 §3.4, tavola oggetti 2-10 e 13): ogni funzione che si accende o si spegne, in un
 * posto solo. Legge `GET /api/opzioni`, cambia con `PUT /api/opzioni/[id]` e rilegge. Colonne separate: levetta ·
 * funzione · vale per · di serie · cosa è successo · ritmo o azione. Un'ancora `#<id>` (i rimandi delle pagine vecchie)
 * scorre alla riga e la evidenzia.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import { ORDINE_GRUPPI, TITOLI_GRUPPI, type TipoEsito, type VoceOpzione } from "@/lib/opzioni/tipi";
import { LevettaOpzione } from "./levetta-opzione";
import { DialogoSpegni } from "./dialogo-spegni";

interface Dati {
  puoCambiare: boolean;
  opzioni: VoceOpzione[];
}

type Filtro = "tutte" | "accese" | "spente" | "guardare" | "file";

const FILTRI: ReadonlyArray<{ id: Filtro; etichetta: string }> = [
  { id: "tutte", etichetta: "Tutte" },
  { id: "accese", etichetta: "Accese" },
  { id: "spente", etichetta: "Spente" },
  { id: "guardare", etichetta: "▲ Da guardare" },
  { id: "file", etichetta: "Da file" },
];

/** Esiti a tinta piena col segno (token di DA-Template): si distinguono anche senza i colori. */
export const ESITI: Record<TipoEsito, { segno: string; classe: string }> = {
  ok: { segno: "✓ ok", classe: "bg-[#1F7A4D] text-white dark:bg-[#5ED3A0] dark:text-[#0D2537]" },
  attenzione: { segno: "▲ guarda", classe: "bg-[#FFD400] text-[#0D2537]" },
  errore: { segno: "✕ errore", classe: "bg-[#8E1B20] text-white dark:bg-[#E8625A] dark:text-[#0D2537]" },
  neutro: { segno: "● niente", classe: "bg-[#5B6B77] text-white dark:bg-[#A9BECC] dark:text-[#0D2537]" },
};

/** Le colonne della riga e dell'intestazione: le stesse, così stanno in fila. Da scrivania (1280 e più). */
const COLONNE = "grid grid-cols-[150px_minmax(200px,1.4fr)_100px_130px_minmax(190px,1fr)_160px] gap-3 items-center";

export function quando(il: string): string {
  const d = parseDbDate(il);
  if (Number.isNaN(d.getTime())) return il;
  const giorno = d.toLocaleDateString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit" });
  const ora = d.toLocaleTimeString("it-IT", { timeZone: FUSO_UTENTI, hour: "2-digit", minute: "2-digit" });
  return `il ${giorno} alle ${ora}`;
}

/** «di serie» o «spenta da Mario il 22/10 alle 15:12» (oggetto 9). */
export function diSerieOCambiata(v: VoceOpzione): string {
  const { da, il, acceso } = v.stato;
  if (!da || !il) return v.diSerie;
  const verbo = v.forma === "scelta" ? "scelta" : acceso ? "accesa" : "spenta";
  return `${verbo} da ${da} ${quando(il)}`;
}

function passaFiltro(v: VoceOpzione, f: Filtro): boolean {
  if (f === "accese") return v.stato.acceso === true && v.forma !== "file";
  if (f === "spente") return v.stato.acceso !== true && v.forma !== "file";
  if (f === "guardare") return v.stato.esito.tipo === "attenzione" || v.stato.esito.tipo === "errore";
  if (f === "file") return v.forma === "file";
  return true;
}

export function PaginaOpzioni({ cliente }: { cliente: string }) {
  const [dati, setDati] = useState<Dati | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("tutte");
  const [cerca, setCerca] = useState("");
  const [inCorso, setInCorso] = useState<string | null>(null);
  const [daSpegnere, setDaSpegnere] = useState<VoceOpzione | null>(null);
  const [daAccendere, setDaAccendere] = useState<VoceOpzione | null>(null);
  const [dove, setDove] = useState<string | null>(null);
  const [evidenziata, setEvidenziata] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carica = useCallback(async () => {
    const r = await fetchJson<Dati>("/api/opzioni", { cache: "no-store" });
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
    } else {
      setErrore(r.message);
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  // L'ancora dei rimandi (`/settings/opzioni#lettura.mikrotik`): scorre alla riga e la evidenzia per qualche secondo.
  useEffect(() => {
    if (!dati) return;
    const vai = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      setFiltro("tutte");
      setCerca("");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setEvidenziata(id);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setEvidenziata(null), 4000);
    };
    vai();
    window.addEventListener("hashchange", vai);
    return () => {
      window.removeEventListener("hashchange", vai);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dati]);

  const cambia = useCallback(
    async (v: VoceOpzione, corpo: { acceso?: boolean; valore?: string }) => {
      setInCorso(v.id);
      const r = await fetchJson<{ avviso?: string }>(`/api/opzioni/${encodeURIComponent(v.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      if (r.ok) {
        if (r.data.avviso) toast.warning(r.data.avviso);
        else toast.success(`«${v.nome}»: fatto`);
      } else {
        toast.error(`«${v.nome}»: ${r.message}`);
      }
      await carica();
      setInCorso(null);
    },
    [carica],
  );

  const gruppi = useMemo(() => {
    if (!dati) return [];
    const q = cerca.trim().toLowerCase();
    return ORDINE_GRUPPI.map((g) => ({
      gruppo: g,
      righe: dati.opzioni.filter(
        (v) => v.gruppo === g && passaFiltro(v, filtro) && (!q || `${v.nome} ${v.cosa} ${v.id}`.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.righe.length > 0);
  }, [dati, filtro, cerca]);

  if (errore && !dati) return <LoadError what="le opzioni" message={errore} onRetry={() => void carica()} />;

  return (
    <div className="space-y-4 text-[#0D2537] dark:text-[#E6EEF4]">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1 className="text-[26px] font-bold uppercase tracking-tight">Opzioni</h1>
        <span className="text-[15px]">Cliente <b className="font-semibold">{cliente}</b></span>
        <div role="group" aria-label="Filtro" className="flex flex-wrap gap-1.5">
          {FILTRI.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-[14px]",
                filtro === f.id
                  ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]"
                  : "border-[#D0D8DC] bg-white text-[#0D2537] hover:bg-[#EDEDED] dark:bg-transparent dark:text-[#E6EEF4] dark:border-[#3A4A57]",
              )}
            >
              {f.etichetta}
            </button>
          ))}
        </div>
        <input
          type="search"
          aria-label="Cerca un'opzione"
          placeholder="Cerca…"
          value={cerca}
          onChange={(e) => setCerca(e.target.value)}
          className="w-56 rounded-lg border border-[#D0D8DC] bg-white px-2.5 py-1.5 text-[15px] dark:border-[#3A4A57] dark:bg-transparent"
        />
        {dati && !dati.puoCambiare && (
          <span className="rounded-md border-2 border-[#5B6B77] px-2 py-0.5 text-[14px] font-semibold">
            Solo un amministratore può cambiarle
          </span>
        )}
      </div>

      {errore && dati && (
        <p className="text-[14px] font-semibold text-[#8E1B20] dark:text-[#E8625A]">Ultimo aggiornamento non riuscito: {errore}</p>
      )}

      {!dati ? (
        <p className="text-[14px] text-muted-foreground">Caricamento…</p>
      ) : (
        <>
          <div className={cn(COLONNE, "px-4 text-[13px] font-semibold uppercase text-[#4A6070] dark:text-[#A9BECC]")}>
            <div>Stato</div>
            <div>Funzione · cosa fa</div>
            <div>Vale per</div>
            <div>Di serie</div>
            <div>Cosa è successo</div>
            <div>Ritmo / azione</div>
          </div>
          {gruppi.length === 0 && <p className="px-4 text-[14px]">Nessuna opzione con questo filtro.</p>}
          {gruppi.map(({ gruppo, righe }) => (
            <section key={gruppo} className="overflow-hidden rounded-xl border border-[#D0D8DC] bg-white dark:border-[#3A4A57] dark:bg-[#13222E]">
              <h2 className="flex flex-wrap items-baseline gap-3 border-b border-[#D0D8DC] px-4 py-3 text-[15px] font-semibold uppercase dark:border-[#3A4A57]">
                {TITOLI_GRUPPI[gruppo].titolo}
                {TITOLI_GRUPPI[gruppo].nota && (
                  <span className="text-[14px] font-light normal-case text-[#4A6070] dark:text-[#A9BECC]">{TITOLI_GRUPPI[gruppo].nota}</span>
                )}
              </h2>
              {righe.map((v) => (
                <div
                  key={v.id}
                  id={v.id}
                  className={cn(
                    "scroll-mt-24 border-t border-[#EDEDED] px-4 py-2.5 text-[14px] first-of-type:border-t-0 dark:border-[#22313D]",
                    evidenziata === v.id && "bg-[#FFF6BF] outline outline-2 outline-[#FFD400] dark:bg-[#3A3410]",
                  )}
                >
                  <div className={COLONNE}>
                    <div>
                      <LevettaOpzione
                        voce={v}
                        puoCambiare={!!dati.puoCambiare}
                        inCorso={inCorso === v.id}
                        onCambia={(acceso) => {
                          if (acceso && v.accendendo) setDaAccendere(v);
                          else if (acceso) void cambia(v, { acceso: true });
                          else setDaSpegnere(v);
                        }}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold">{v.nome}</div>
                      {v.cosa && <div className="font-light text-[#4A6070] dark:text-[#A9BECC]">{v.cosa}</div>}
                    </div>
                    <div className="text-[13px]">{v.valePer === "hub" ? "tutti i clienti" : "questo cliente"}</div>
                    <div className="text-[13px]">{diSerieOCambiata(v)}</div>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[13px] font-semibold", ESITI[v.stato.esito.tipo].classe)}>
                        {ESITI[v.stato.esito.tipo].segno}
                      </span>
                      <span className="text-[13px]">{v.stato.esito.testo}</span>
                    </div>
                    <div className="flex flex-col items-start gap-1 text-[14px]">
                      {v.scelte && (
                        <select
                          aria-label={`${v.forma === "scelta" ? "Scelta" : "Ritmo"} di «${v.nome}»`}
                          value={v.stato.valore ?? ""}
                          disabled={!dati.puoCambiare || inCorso === v.id || v.stato.acceso === null}
                          onChange={(e) => void cambia(v, { valore: e.target.value })}
                          className="max-w-full rounded-lg border border-[#D0D8DC] bg-white px-2 py-1 text-[14px] disabled:opacity-70 dark:border-[#3A4A57] dark:bg-transparent"
                        >
                          {v.stato.valore === undefined && <option value="">—</option>}
                          {v.scelte.map((s) => (
                            <option key={s.valore} value={s.valore}>{s.etichetta}</option>
                          ))}
                        </select>
                      )}
                      {v.configura && (
                        <Link href={v.configura.href} className="text-[#006C96] underline hover:text-[#0D2537] dark:text-[#3FBBF0]">
                          {v.configura.etichetta}
                        </Link>
                      )}
                      {v.dove && (
                        <button
                          type="button"
                          aria-expanded={dove === v.id}
                          onClick={() => setDove(dove === v.id ? null : v.id)}
                          className="text-[#006C96] underline hover:text-[#0D2537] dark:text-[#3FBBF0]"
                        >
                          Dove si cambia ›
                        </button>
                      )}
                    </div>
                  </div>
                  {dove === v.id && v.dove && (
                    <div className="ml-[162px] mt-2 rounded-lg border border-[#D0D8DC] bg-[#F6F7F8] px-3 py-2 text-[14px] font-light dark:border-[#3A4A57] dark:bg-[#0D2537]">
                      {v.dove}
                    </div>
                  )}
                </div>
              ))}
            </section>
          ))}
        </>
      )}

      <DialogoSpegni
        voce={daSpegnere}
        cliente={cliente}
        onAnnulla={() => setDaSpegnere(null)}
        onConferma={() => {
          const v = daSpegnere;
          setDaSpegnere(null);
          if (v) void cambia(v, { acceso: false });
        }}
      />
      <DialogoSpegni
        voce={daAccendere}
        cliente={cliente}
        accendi
        onAnnulla={() => setDaAccendere(null)}
        onConferma={() => {
          const v = daAccendere;
          setDaAccendere(null);
          if (v) void cambia(v, { acceso: true });
        }}
      />
    </div>
  );
}

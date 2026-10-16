"use client";

/**
 * I pezzi del pannello dei dettagli che esistono solo con la mappa nuova (`model.cavi`, T3; spec §13.4.6, §13.8.3 punti 8-10,
 * §13.9, §13.7.2 passo 10): l'anomalia «core che esce da uno switch di accesso», le partenze scartate, la ★ di prima con
 * «Scegli il cavo», i collegamenti «dalle VM», e «Candidati per porta» (caricati a richiesta con la rotta sua). I testi li
 * scrive `cavi/pannello.ts`; qui si disegnano. Testo a 13 px, forma e parola insieme, liste con limite e «+ altri N».
 */
import { Fragment, useEffect, useState } from "react";
import { LoadError } from "@/components/shared/load-error";
import { Button } from "@/components/ui/button";
import { INVITO_STELLA, membroInParole, partenzeScartate, righeDalleVm, sceltoInParole, testoAnomalia, testoStellaDiPrima, testoStellaSenzaCollegamento } from "@/lib/topology/cavi/pannello";
import { speedLabel } from "@/lib/topology/edge-look";
import type { CandidatoPorta, MapLink, MapNode } from "@/lib/topology/model-types";
import type { TreeResult } from "@/lib/topology/tree";
import { fetchCandidati } from "./api";
import type { ModelData } from "./use-topology-data";

/** Le righe di «Candidati per porta» che si mostrano; le altre si contano. */
const MAX_PORTE = 64;
const MAX_VM = 10;

interface SezioniProps {
  n: MapNode;
  model: ModelData;
  nomeDi: (id: string) => string;
  tree: TreeResult;
  savedRoots: readonly string[];
  isAdmin: boolean;
  onScegliCavo: (nodo: string, l: MapLink) => void;
}

/** Anomalia, avvisi, partenza scartata, ★ di prima, «dalle VM»: dopo le VM, prima di «Collegato a». Niente se non c'è niente da dire. */
export function SezioniCavi({ n, model, nomeDi, tree, savedRoots, isAdmin, onScegliCavo }: SezioniProps) {
  const cavi = model.cavi;
  if (!cavi) return null;
  const anomalia = cavi.anomalie.find((a) => a.nodo === n.id);
  const avvisi = cavi.avvisi.filter((a) => a.nodo === n.id);
  const scartate = partenzeScartate({ savedRoots: savedRoots.filter((r) => r === n.id), tree }, nomeDi);
  const stelle = cavi.stelleDiPrima.filter((s) => s.nodo === n.id || s.altro === n.id);
  const dalleVm = righeDalleVm(cavi.dalleVm[n.id] ?? [], nomeDi);
  const t = anomalia ? testoAnomalia(anomalia, nomeDi) : null;
  return (
    <>
      {t && (
        // Il «⚠» e il bordo pieno dicono l'anomalia: nessun colore da solo.
        <div className="mt-3 rounded-md border-2 border-foreground px-2.5 py-1.5">
          <p className="font-semibold">⚠ {t.titolo}</p>
          <p>{t.testo}</p>
        </div>
      )}
      {avvisi.map((a, i) => <p key={i} className="mt-2">⚠ {a.testo}</p>)}
      {scartate.map((s) => <p key={s} className="mt-2">{s}</p>)}
      {stelle.map((s) => (
        <StellaDiPrima key={`${s.nodo}|${s.altro}`} nodo={s.nodo} altro={s.altro} links={model.links} nomeDi={nomeDi} isAdmin={isAdmin} onScegliCavo={onScegliCavo} />
      ))}
      {dalleVm.length > 0 && (
        <ul className="mt-2 list-disc pl-4">
          {dalleVm.slice(0, MAX_VM).map((r) => <li key={r}>{r}</li>)}
          {dalleVm.length > MAX_VM && <li className="list-none text-muted-foreground">+ altri {dalleVm.length - MAX_VM}</li>}
        </ul>
      )}
    </>
  );
}

/** «★ scelta prima che le linee fossero per cavo…» con «Scegli il cavo»: l'elenco dei cavi fra i due apparati, e la scelta scrive la ★. */
function StellaDiPrima({ nodo, altro, links, nomeDi, isAdmin, onScegliCavo }: {
  nodo: string; altro: string; links: readonly MapLink[]; nomeDi: (id: string) => string; isAdmin: boolean; onScegliCavo: (nodo: string, l: MapLink) => void;
}) {
  const [aperto, setAperto] = useState(false);
  const coppia = links.filter((l) => (l.a === nodo && l.b === altro) || (l.a === altro && l.b === nodo));
  const testo = testoStellaDiPrima();
  const senza = testoStellaSenzaCollegamento(nomeDi(nodo), nomeDi(altro), coppia.length);
  if (senza) return <p className="mt-2 font-semibold">{senza}</p>;
  return (
    <div className="mt-2">
      {/* L'invito in coda è il pulsante: non si scrive due volte. */}
      <p>{testo.endsWith(INVITO_STELLA) ? testo.slice(0, -INVITO_STELLA.length).trim() : testo} ({nomeDi(nodo)} ↔ {nomeDi(altro)})</p>
      {isAdmin && coppia.length > 0 && (
        <Button size="xs" variant="outline" className="mt-1 text-[13px]" aria-expanded={aperto} onClick={() => setAperto((a) => !a)}>{INVITO_STELLA}</Button>
      )}
      {aperto && (
        <ul className="mt-1 space-y-1">
          {coppia.slice(0, 12).map((l) => {
            const mia = l.a === nodo ? l.aPort : l.bPort, sua = l.a === nodo ? l.bPort : l.aPort;
            return (
              <li key={l.id}>
                <button type="button" className="text-left underline" onClick={() => { setAperto(false); onScegliCavo(nodo, l); }}>
                  {mia || "porta non nota"} ↔ {sua || "porta non nota"}{speedLabel(l.speedMbps) ? ` · ${speedLabel(l.speedMbps)}` : ""}
                  {l.cavo?.genere && l.cavo.genere !== "cavo" ? ` · ${l.cavo.genere}` : ""}
                </button>
              </li>
            );
          })}
          {coppia.length > 12 && <li className="text-muted-foreground">+ altri {coppia.length - 12}</li>}
        </ul>
      )}
    </div>
  );
}

/** Un fascio nei dettagli: i membri porta per porta, orientati dal nodo che si guarda. */
export function MembriDelFascio({ l, nodo }: { l: MapLink; nodo: string }) {
  const f = l.cavo?.fascio;
  if (!f) return null;
  const giro = l.a !== nodo;
  return (
    <div className="mt-1">
      <div className="font-semibold">{f.dedotto ? "Fascio dedotto" : "Fascio"} di {f.membri.length} {f.membri.length === 1 ? "cavo" : "cavi"}</div>
      <ul>
        {f.membri.slice(0, 8).map((m, i) => (
          <li key={i}>{membroInParole(giro ? { ...m, aPort: m.bPort, bPort: m.aPort } : m)}</li>
        ))}
        {f.membri.length > 8 && <li className="text-muted-foreground">+ altri {f.membri.length - 8}</li>}
      </ul>
    </div>
  );
}

type Esito = { ok: true; data: { righe: CandidatoPorta[]; altri: number } } | { ok: false; status: number | null; message: string };

/** «Candidati per porta» (§13.4.6): perché quella porta e non il 10G. Si carica quando si aprono i dettagli di un apparato. */
export function CandidatiPerPorta({ nodo, nomeDi, ora }: { nodo: string; nomeDi: (id: string) => string; ora: (s: string) => string }) {
  const [stato, setStato] = useState<{ nodo: string; giro: number; esito: Esito } | null>(null);
  const [giro, setGiro] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    fetchCandidati(nodo, ac.signal)
      .then((esito) => { if (!ac.signal.aborted) setStato({ nodo, giro, esito }); })
      .catch((e: unknown) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setStato({ nodo, giro, esito: { ok: false, status: null, message: "Errore imprevisto nella lettura dei candidati" } });
      });
    return () => ac.abort();
  }, [nodo, giro]);

  const corrente = stato && stato.nodo === nodo && stato.giro === giro ? stato.esito : null;
  return (
    <section className="mt-4">
      <h3 className="mb-1 font-semibold">Candidati per porta</h3>
      {!corrente && <p className="text-muted-foreground">Caricamento…</p>}
      {corrente && !corrente.ok && <LoadError what="i candidati per porta" message={corrente.message} onRetry={() => setGiro((g) => g + 1)} />}
      {corrente?.ok && corrente.data.righe.length === 0 && <p className="text-muted-foreground">Nessuna porta con prove.</p>}
      {corrente?.ok && (
        <>
          {corrente.data.righe.slice(0, MAX_PORTE).map((r) => <RigaPorta key={r.porta} r={r} nomeDi={nomeDi} ora={ora} />)}
          {corrente.data.righe.length - MAX_PORTE + corrente.data.altri > 0 && (
            <p className="mt-1 text-muted-foreground">+ altri {Math.max(0, corrente.data.righe.length - MAX_PORTE) + corrente.data.altri}</p>
          )}
        </>
      )}
    </section>
  );
}

function RigaPorta({ r, nomeDi, ora }: { r: CandidatoPorta; nomeDi: (id: string) => string; ora: (s: string) => string }) {
  return (
    <div className="border-t border-border py-1.5">
      <p className="font-semibold [overflow-wrap:anywhere]">{r.porta}</p>
      <Etichetta k="prove">
        <ul className="list-disc pl-4">
          {r.prove.map((p, i) => <li key={i}>{[nomeDi(p.chi), p.detto, p.quando ? `alle ${ora(p.quando)}` : null].filter(Boolean).join(" · ")}</li>)}
          {r.altreProve > 0 && <li className="list-none text-muted-foreground">+ altre {r.altreProve}</li>}
        </ul>
      </Etichetta>
      <Etichetta k="scelto">{r.scelto ? <p>{sceltoInParole(r.scelto, nomeDi)}</p> : <p className="text-muted-foreground">nessuno</p>}</Etichetta>
      <Etichetta k="scartati">
        {r.scartati.length === 0 ? <p className="text-muted-foreground">nessuno</p> : (
          <ul className="list-disc pl-4">
            {r.scartati.map((s, i) => <li key={i}>{nomeDi(s.chi)}: {s.motivo}</li>)}
            {r.altriScartati > 0 && <li className="list-none text-muted-foreground">+ altri {r.altriScartati}</li>}
          </ul>
        )}
      </Etichetta>
    </div>
  );
}

function Etichetta({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <Fragment>
      <span className="mt-0.5 block text-muted-foreground">{k}</span>
      {children}
    </Fragment>
  );
}

"use client";

/**
 * «Unisci con…» (piano 2026-10-16, Task 4; ADR 0021): sceglie con chi unire un oggetto della mappa, mostra che cosa
 * succede e scrive. Uno solo per i tre posti (mappa, scheda, Discovery). Gli errori della rotta stanno nel dialogo, che
 * resta aperto; un errore non diventa mai «nessun risultato».
 */

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollableArea, DialogTitle,
  DIALOG_PANEL_COMPACT_CLASS,
} from "@/components/ui/dialog";
import { chiediUnione, cercaCandidati } from "@/components/topology/unioni/api";
import { giornoItaliano, titoloUnisci } from "@/lib/topology/unioni-testi";
import { MIN_CARATTERI_RICERCA, type AnteprimaUnione, type CandidatiUnione } from "@/lib/topology/unioni-tipi";

const ATTESA_RICERCA_MS = 300;

export interface UnisciDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** L'oggetto da cui si parte: «dev:N» o «host:N». */
  da: string;
  nomeDa: string;
  /** Già scelti (altri «dev:N»/«host:N»): si parte direttamente dall'anteprima. */
  scelti?: string[];
  /** Dopo un'unione scritta: chi chiama ricarica la mappa o la scheda. */
  onFatto: () => void;
}

export function UnisciDialog(p: UnisciDialogProps) {
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
        {/* Il corpo vive solo a dialogo aperto: ogni apertura riparte pulita. */}
        {p.open && <Corpo {...p} />}
      </DialogContent>
    </Dialog>
  );
}

function Corpo({ onOpenChange, da, nomeDa, scelti, onFatto }: UnisciDialogProps) {
  const vengonoDaFuori = scelti !== undefined && scelti.length > 0;
  const [domanda, setDomanda] = useState("");
  // I risultati portano la domanda a cui rispondono: quelli di una domanda vecchia non si mostrano.
  const [risposta, setRisposta] = useState<{ q: string; dati: CandidatiUnione } | null>(null);
  const [erroreRicerca, setErroreRicerca] = useState<{ q: string; messaggio: string } | null>(null);
  const [sceltiQui, setSceltiQui] = useState<string[]>([]);
  const [anteprima, setAnteprima] = useState<AnteprimaUnione | null>(null);
  const [occupato, setOccupato] = useState(vengonoDaFuori);
  const [errore, setErrore] = useState<string | null>(null);
  const q = domanda.trim();
  const cerca = q.length >= MIN_CARATTERI_RICERCA;
  const membri = (elenco: string[]) => [da, ...elenco.filter((x) => x !== da)];

  // Ricerca: 300 ms dopo l'ultimo tasto, da 2 caratteri; la richiesta vecchia si annulla.
  useEffect(() => {
    if (vengonoDaFuori || q.length < MIN_CARATTERI_RICERCA) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      cercaCandidati(da, q, ac.signal).then(
        (r) => {
          if (r.ok) { setRisposta({ q, dati: r.data }); setErroreRicerca(null); }
          else setErroreRicerca({ q, messaggio: r.message });
        },
        (e: unknown) => {
          if (e instanceof Error && e.name === "AbortError") return;
          setErroreRicerca({ q, messaggio: "Ricerca non riuscita" });
        },
      );
    }, ATTESA_RICERCA_MS);
    return () => { clearTimeout(t); ac.abort(); };
  }, [da, q, vengonoDaFuori]);

  // Con `scelti` si parte dall'anteprima (nessuna scrittura).
  const partito = useRef(false);
  useEffect(() => {
    if (!vengonoDaFuori || partito.current) return;
    partito.current = true;
    chiediUnione({ membri: membri(scelti ?? []), applica: false }).then((r) => {
      if (r.ok) setAnteprima(r.data); else setErrore(r.message);
      setOccupato(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parte una volta sola, all'apertura
  }, []);

  async function vedi() {
    setOccupato(true); setErrore(null);
    const r = await chiediUnione({ membri: membri(sceltiQui), applica: false });
    if (r.ok) setAnteprima(r.data); else setErrore(r.message);
    setOccupato(false);
  }

  async function unisci() {
    setOccupato(true); setErrore(null);
    const r = await chiediUnione({ membri: membri(vengonoDaFuori ? scelti ?? [] : sceltiQui), applica: true });
    setOccupato(false);
    if (!r.ok) { setErrore(r.message); return; } // il dialogo resta aperto, con la parola della rotta
    toast.success(`Uniti in un oggetto solo: ${r.data.nome}`);
    onOpenChange(false);
    onFatto();
  }

  const lista = risposta && risposta.q === q ? risposta.dati : null;
  const erroreQui = erroreRicerca && erroreRicerca.q === q ? erroreRicerca.messaggio : null;
  const inAttesa = cerca && !lista && !erroreQui;

  function alterna(id: string) {
    setSceltiQui((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  }

  return (
    <>
      <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
        <DialogTitle>{titoloUnisci(nomeDa)}</DialogTitle>
        <DialogDescription className="text-sm">
          {anteprima
            ? "Controlla che cosa cambia sulla mappa, poi conferma."
            : "Scegli gli oggetti che sulla mappa devono diventare uno solo."}
        </DialogDescription>
      </DialogHeader>

      <DialogScrollableArea className="px-4 py-3 space-y-3">
        {errore && (
          <p role="alert" className="rounded-md border-2 border-destructive bg-destructive/5 px-3 py-2 text-sm">
            <strong>Errore:</strong> {errore}
          </p>
        )}

        {anteprima ? (
          <Anteprima a={anteprima} />
        ) : vengonoDaFuori ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{occupato ? "Calcolo cosa succede…" : "Nessuna anteprima disponibile."}</p>
        ) : (
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <Input
                className="pl-8 h-9 text-sm"
                placeholder="Cerca per nome, IP o MAC"
                aria-label="Cerca per nome, IP o MAC"
                value={domanda}
                onChange={(e) => setDomanda(e.target.value)}
                autoFocus
              />
            </div>
            {sceltiQui.length > 0 && <p className="text-sm">Scelti: {sceltiQui.length}</p>}
            {!cerca && <p className="text-sm text-muted-foreground">Scrivi almeno {MIN_CARATTERI_RICERCA} caratteri.</p>}
            {inAttesa && <p className="text-sm text-muted-foreground py-2">Ricerca in corso…</p>}
            {erroreQui && (
              <p role="alert" className="rounded-md border-2 border-destructive bg-destructive/5 px-3 py-2 text-sm">
                <strong>Errore nella ricerca:</strong> {erroreQui}
              </p>
            )}
            {lista && lista.candidati.length === 0 && <p className="text-sm text-muted-foreground py-2">Nessun oggetto trovato per «{q}».</p>}
            {lista && lista.candidati.length > 0 && (
              <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto">
                {lista.candidati.map((c) => (
                  <label
                    key={c.id}
                    className={`flex items-start gap-3 px-3 py-2 ${c.bloccato ? "opacity-80" : "hover:bg-muted/40 cursor-pointer"}`}
                  >
                    <Checkbox
                      checked={sceltiQui.includes(c.id)}
                      disabled={c.bloccato !== null}
                      onCheckedChange={() => alterna(c.id)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className="font-medium truncate">{c.nome}</span>
                        <span className="rounded border border-border px-1.5 text-[13px] font-semibold">{c.tipo === "apparato" ? "Apparato" : "Host"}</span>
                      </div>
                      <div className="font-mono text-[13px] text-muted-foreground break-all">{c.indirizzi.join(", ")}</div>
                      {c.bloccato && <div className="mt-0.5"><strong>Non si può unire:</strong> {c.bloccato}</div>}
                    </div>
                  </label>
                ))}
              </div>
            )}
            {lista && lista.altri > 0 && <p className="text-sm text-muted-foreground">+ altri {lista.altri}: affina la ricerca</p>}
          </>
        )}
      </DialogScrollableArea>

      <DialogFooter className="mx-0 mb-0 px-4 py-3 border-t border-border/50">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={occupato}>Annulla</Button>
        {anteprima ? (
          <>
            {!vengonoDaFuori && <Button variant="outline" onClick={() => { setAnteprima(null); setErrore(null); }} disabled={occupato}>Indietro</Button>}
            <Button onClick={unisci} disabled={occupato}>{occupato ? "Unione in corso…" : "Unisci"}</Button>
          </>
        ) : !vengonoDaFuori ? (
          <Button onClick={vedi} disabled={occupato || sceltiQui.length === 0}>
            {occupato ? "Calcolo…" : "Vedi cosa succede"}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

function Anteprima({ a }: { a: AnteprimaUnione }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">Diventano un oggetto solo: {a.nome}</p>
      <div>
        <p className="font-semibold">Entrano</p>
        <ul className="mt-1 border rounded-md divide-y">
          {a.entrano.map((e) => (
            <li key={e.id} className="px-3 py-1.5">
              <span className="font-medium">{e.nome}</span> <span className="text-muted-foreground">— {e.perche}</span>
            </li>
          ))}
        </ul>
      </div>
      {a.separazioniTolte.length > 0 && (
        <div>
          <p className="font-semibold">Separazioni annullate</p>
          <ul className="mt-1 border rounded-md divide-y">
            {a.separazioniTolte.map((s) => {
              const g = giornoItaliano(s.il);
              return (
                <li key={`${s.membro}|${s.altro}`} className="px-3 py-1.5">
                  {s.membro} non resta più separato da {s.altro}{g ? ` (separati il ${g})` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

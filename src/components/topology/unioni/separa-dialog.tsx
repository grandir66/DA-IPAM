"use client";

/**
 * «Separa…» (piano 2026-10-16, Task 4; ADR 0021): mostra da che cosa è fatto un oggetto della mappa, fa scegliere
 * l'indirizzo che deve uscire, dice dove finisce e scrive. Gli errori della rotta stanno nel dialogo, che resta aperto.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogScrollableArea, DialogTitle,
  DIALOG_PANEL_COMPACT_CLASS,
} from "@/components/ui/dialog";
import { LoadError } from "@/components/shared/load-error";
import { caricaStato, chiediSeparazione } from "@/components/topology/unioni/api";
import { parolaCome, TESTO_NIENTE_DA_SEPARARE, titoloSepara } from "@/lib/topology/unioni-testi";
import { TESTI_UNIONI, type AnteprimaSeparazione, type StatoDelNodo } from "@/lib/topology/unioni-tipi";

export interface SeparaDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** L'oggetto sulla mappa: «dev:N» o «host:N». */
  oggetto: string;
  /** Dopo una separazione scritta: chi chiama ricarica la mappa o la scheda. */
  onFatto: () => void;
}

export function SeparaDialog(p: SeparaDialogProps) {
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
        {/* Il corpo vive solo a dialogo aperto: ogni apertura riparte pulita. */}
        {p.open && <Corpo {...p} />}
      </DialogContent>
    </Dialog>
  );
}

type Caricamento = { fase: "carico" } | { fase: "errore"; messaggio: string } | { fase: "pronto"; stato: StatoDelNodo };

function Corpo({ onOpenChange, oggetto, onFatto }: SeparaDialogProps) {
  const [c, setC] = useState<Caricamento>({ fase: "carico" });
  const [tentativo, setTentativo] = useState(0);
  const [scelto, setScelto] = useState<string | null>(null);
  const [anteprima, setAnteprima] = useState<AnteprimaSeparazione | null>(null);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    caricaStato(oggetto).then((r) => {
      if (!vivo) return;
      setC(r.ok ? { fase: "pronto", stato: r.data } : { fase: "errore", messaggio: r.message });
    });
    return () => { vivo = false; };
  }, [oggetto, tentativo]);

  const stato = c.fase === "pronto" ? c.stato : null;

  async function chiedi(applica: boolean) {
    if (!stato || !scelto) return;
    setOccupato(true); setErrore(null);
    const r = await chiediSeparazione({ nodo: stato.nodo, membro: scelto, applica });
    setOccupato(false);
    if (!r.ok) { setErrore(r.message); return; } // il dialogo resta aperto, con la parola della rotta
    if (!applica) { setAnteprima(r.data); return; }
    toast.success("Indirizzo separato");
    onOpenChange(false);
    onFatto();
  }

  const separabili = stato ? stato.membri.filter((m) => m.separabile) : [];

  return (
    <>
      <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
        <DialogTitle>{titoloSepara(stato?.nome ?? "…")}</DialogTitle>
        <DialogDescription className="text-sm">
          {anteprima ? "Controlla dove finisce l'indirizzo, poi conferma." : "Scegli l'indirizzo che deve uscire da questo oggetto."}
        </DialogDescription>
      </DialogHeader>

      <DialogScrollableArea className="px-4 py-3 space-y-3 text-sm">
        {c.fase === "carico" && <p className="text-muted-foreground py-4 text-center">Caricamento…</p>}
        {c.fase === "errore" && <LoadError what="l'oggetto sulla mappa" message={c.messaggio} onRetry={() => { setC({ fase: "carico" }); setTentativo((n) => n + 1); }} />}
        {errore && (
          <p role="alert" className="rounded-md border-2 border-destructive bg-destructive/5 px-3 py-2">
            <strong>Errore:</strong> {errore}
          </p>
        )}

        {stato && !stato.disponibile && <p>{TESTI_UNIONI.schemaAssente}</p>}

        {stato && stato.disponibile && anteprima && (
          <div className="space-y-3">
            <div>
              <p className="font-semibold">Resta in «{anteprima.resta.nodo === stato.nodo ? stato.nome : anteprima.resta.nome}»</p>
              <p className="text-muted-foreground">{anteprima.resta.membri.length} indirizzi: {anteprima.resta.membri.join(", ")}</p>
            </div>
            <div>
              <p className="font-semibold">Escono</p>
              <ul className="mt-1 border rounded-md divide-y">
                {anteprima.escono.map((e) => (
                  <li key={e.nodo} className="px-3 py-1.5">
                    <span className="font-medium">{e.nome}</span> <span className="text-muted-foreground">— {e.membri.join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {stato && stato.disponibile && !anteprima && (
          <>
            {stato.nonApplicata && (
              <p className="rounded-md border-2 border-border px-3 py-2">
                <strong>Unione a mano non applicata:</strong> {stato.nonApplicata.motivo}
              </p>
            )}
            {stato.mancanti.length > 0 && (
              <p className="text-muted-foreground">Non più presenti nell&apos;inventario: {stato.mancanti.join(", ")}</p>
            )}
            {separabili.length === 0 && stato.membri.length <= 1 ? (
              <p>{TESTO_NIENTE_DA_SEPARARE}</p>
            ) : (
              <ul className="border rounded-md divide-y" role="radiogroup" aria-label="Indirizzo da separare">
                {stato.membri.map((m) => (
                  <li key={m.id}>
                    <label className={`flex items-start gap-3 px-3 py-2 ${m.separabile ? "hover:bg-muted/40 cursor-pointer" : "opacity-80"}`}>
                      <input
                        type="radio"
                        name="membro-da-separare"
                        className="mt-1 h-4 w-4"
                        checked={scelto === m.id}
                        disabled={!m.separabile}
                        onChange={() => setScelto(m.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="font-medium">{m.nome}</span>
                          {m.ip && <span className="font-mono text-[13px] text-muted-foreground">{m.ip}</span>}
                        </div>
                        <div className="text-muted-foreground">{parolaCome(m)}</div>
                        {!m.separabile && m.perche && <div><strong>Non si separa:</strong> {m.perche}</div>}
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogScrollableArea>

      <DialogFooter className="px-4 py-3 border-t border-border/50">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={occupato}>Annulla</Button>
        {stato && stato.disponibile && (anteprima ? (
          <>
            <Button variant="outline" onClick={() => { setAnteprima(null); setErrore(null); }} disabled={occupato}>Indietro</Button>
            <Button onClick={() => chiedi(true)} disabled={occupato}>{occupato ? "Separazione in corso…" : "Separa"}</Button>
          </>
        ) : (
          <Button onClick={() => chiedi(false)} disabled={occupato || !scelto}>{occupato ? "Calcolo…" : "Vedi cosa succede"}</Button>
        ))}
      </DialogFooter>
    </>
  );
}

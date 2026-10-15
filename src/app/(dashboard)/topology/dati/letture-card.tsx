"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { EsitoApparato, Lettura, StatoInterruttore } from "@/lib/topology/letture/interruttori";
import { DESCRIZIONE_LETTURE, NASCE_SPENTA, righeEsito, testoDialogo, testoStato } from "@/lib/topology/letture/testi";

type Riga = { lettura: Lettura; disponibile: boolean; stato: StatoInterruttore; esiti: Record<string, EsitoApparato>; nomi: Record<string, string> };
type Stato = { letture: Riga[]; schema: boolean; cadenza: { router: { minuti: number | null; daScansioni: boolean }; switch: number | null } };

/**
 * «Letture in più per la mappa» (spec topologia §13.5.6): una riga per lettura, che cosa legge e su quali apparati,
 * accesa o spenta e da chi, l'ultima lettura per apparato con l'esito, «Accendi»/«Spegni» solo per un amministratore,
 * col dialogo che dice la cadenza vera di questo cliente. Lo stato è sempre in parole accanto a una forma (mai il solo
 * colore): «● accesa …» / «○ spenta».
 */
export function LettureCard({ isAdmin }: { isAdmin: boolean }) {
  const [s, setS] = useState<Stato | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [chiedi, setChiedi] = useState<{ lettura: Lettura; accendi: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setErrore(null);
    const r = await fetchJson<Stato>("/api/topology/settings/letture", { cache: "no-store" });
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setS(r.data);
  }, []);
  useEffect(() => {
    void carica();
  }, [carica]);

  async function conferma() {
    if (!chiedi) return;
    setSalvando(true);
    const r = await fetchJson<{ stato: StatoInterruttore }>("/api/topology/settings/letture", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lettura: chiedi.lettura, acceso: chiedi.accendi }),
    });
    setSalvando(false);
    setEsito(r.ok ? `Salvato: ${DESCRIZIONE_LETTURE[chiedi.lettura].titolo} ${chiedi.accendi ? "accesa" : "spenta"}.` : `Non salvato: ${r.message}`);
    setChiedi(null);
    void carica();
  }

  return (
    <Card className="xl:col-span-2">
      <CardHeader><CardTitle>Letture in più per la mappa</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {errore ? (
          <LoadError what="lo stato delle letture in più" message={errore} onRetry={carica} />
        ) : !s ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : (
          <>
            <p className="text-sm">Spente di default. Accese, aggiungono letture in sola lettura; la mappa non cambia finché non si accende la mappa nuova.</p>
            {!s.schema && <p className="text-sm font-medium" role="status">Non disponibili: lo schema di questo cliente non è aggiornato.</p>}
            {!isAdmin && <p className="text-sm text-muted-foreground">Sola lettura: solo un amministratore accende o spegne una lettura.</p>}
            {s.letture.map((r) => {
              const d = DESCRIZIONE_LETTURE[r.lettura];
              const e = righeEsito(r.esiti, (id) => r.nomi[String(id)] ?? `apparato #${id}`, 10);
              return (
                <div key={r.lettura} className="rounded-md border p-3 space-y-1">
                  {/* Lo stato accanto al titolo, non in fondo alla riga: a 1920 stava a 1500 px dalla lettura che descrive. */}
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <p className="text-sm font-semibold">{d.titolo}</p>
                    <p className="text-sm font-medium">{r.disponibile ? (r.stato.acceso ? "● " : "○ ") + testoStato(r.stato) : "non disponibile in questa versione"}</p>
                  </div>
                  <p className="text-sm">{d.legge}</p>
                  <p className="text-sm">
                    Apparati: {d.apparati}.{r.disponibile ? ` ${NASCE_SPENTA}` : ""}
                  </p>
                  <p className="text-sm text-muted-foreground">{d.comandi}</p>
                  {e.righe.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nessuna lettura ancora.</p>
                  ) : (
                    <ul className="text-sm list-disc pl-5">
                      {e.righe.map((t) => <li key={t}>{t}</li>)}
                      {e.altri > 0 && <li>+ altri {e.altri}</li>}
                    </ul>
                  )}
                  {isAdmin && r.disponibile && (
                    <Button variant="outline" disabled={salvando || (!s.schema && !r.stato.acceso)}
                      onClick={() => setChiedi({ lettura: r.lettura, accendi: !r.stato.acceso })}>
                      {r.stato.acceso ? "Spegni" : "Accendi"}
                    </Button>
                  )}
                </div>
              );
            })}
            {esito && <p className="text-sm text-muted-foreground" role="status">{esito}</p>}
          </>
        )}
      </CardContent>
      <Dialog open={chiedi !== null} onOpenChange={(o) => { if (!o) setChiedi(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{chiedi ? `${chiedi.accendi ? "Accendere" : "Spegnere"}: ${DESCRIZIONE_LETTURE[chiedi.lettura].titolo}` : ""}</DialogTitle>
            <DialogDescription>{chiedi && s ? testoDialogo(chiedi.lettura, chiedi.accendi, s.cadenza) : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChiedi(null)}>Annulla</Button>
            <Button onClick={() => void conferma()} disabled={salvando}>{chiedi?.accendi ? "Accendi" : "Spegni"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

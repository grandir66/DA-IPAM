"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { StatoInterruttore } from "@/lib/topology/letture/interruttori";
import { TITOLO_MAPPA, testoDialogoMappa, testoStatoMappa } from "@/lib/topology/letture/testi-mappa";

type Stato = { stato: StatoInterruttore; schema: boolean };

/**
 * «Mappa nuova (una linea per cavo)» (spec topologia §13.11.4, T3.7): lo stato in parole (con una forma accanto, mai il
 * solo colore), «Accendi»/«Spegni» con un dialogo solo per un amministratore, per gli altri la sola lettura. Senza lo
 * schema di T2 non si accende (ma si può sempre spegnere). Dopo la scrittura si ricarica il modello (`onChanged`).
 */
export function MappaCard({ isAdmin, onChanged }: { isAdmin: boolean; onChanged: () => void }) {
  const [s, setS] = useState<Stato | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [chiedi, setChiedi] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);

  const carica = useCallback(async () => {
    setErrore(null);
    const r = await fetchJson<Stato>("/api/topology/settings/mappa", { cache: "no-store" });
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
    if (chiedi === null) return;
    setSalvando(true);
    const r = await fetchJson<{ stato: StatoInterruttore }>("/api/topology/settings/mappa", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acceso: chiedi }),
    });
    setSalvando(false);
    setEsito(r.ok ? `Salvato: mappa nuova ${chiedi ? "accesa" : "spenta"}.` : `Non salvato: ${r.message}`);
    setChiedi(null);
    void carica();
    if (r.ok) onChanged();
  }

  return (
    <Card className="xl:col-span-2">
      <CardHeader><CardTitle>{TITOLO_MAPPA}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {errore ? (
          <LoadError what="lo stato della mappa nuova" message={errore} onRetry={carica} />
        ) : !s ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : (
          <>
            <p className="text-sm font-medium">{(s.stato.acceso ? "● " : "○ ") + testoStatoMappa(s.stato)}</p>
            {!s.schema && <p className="text-sm font-medium" role="status">Non disponibile: lo schema di questo cliente non è aggiornato</p>}
            {isAdmin ? (
              <Button variant="outline" disabled={salvando || (!s.schema && !s.stato.acceso)} onClick={() => setChiedi(!s.stato.acceso)}>
                {s.stato.acceso ? "Spegni" : "Accendi"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Sola lettura: solo un amministratore accende o spegne la mappa nuova.</p>
            )}
            {esito && <p className="text-sm text-muted-foreground" role="status">{esito}</p>}
          </>
        )}
      </CardContent>
      <Dialog open={chiedi !== null} onOpenChange={(o) => { if (!o) setChiedi(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{chiedi === null ? "" : `${chiedi ? "Accendere" : "Spegnere"}: ${TITOLO_MAPPA}`}</DialogTitle>
            <DialogDescription>{chiedi === null ? "" : testoDialogoMappa(chiedi)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChiedi(null)}>Annulla</Button>
            <Button onClick={() => void conferma()} disabled={salvando}>{chiedi ? "Accendi" : "Spegni"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

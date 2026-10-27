"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadError } from "@/components/shared/load-error";
import { RigaRimando, useVociOpzioni } from "@/components/opzioni/riga-rimando";
import { fetchJson } from "@/lib/fetch-json";
import type { EsitoApparato, Lettura, StatoInterruttore } from "@/lib/topology/letture/interruttori";
import { DESCRIZIONE_LETTURE, righeEsito } from "@/lib/topology/letture/testi";

type Riga = { lettura: Lettura; disponibile: boolean; stato: StatoInterruttore; esiti: Record<string, EsitoApparato>; nomi: Record<string, string> };
type Stato = { letture: Riga[]; schema: boolean; cadenza: { router: { minuti: number | null; daScansioni: boolean }; switch: number | null } };

/**
 * «Letture in più per la mappa» (spec topologia §13.5.6): una riga per lettura, che cosa legge e su quali apparati e
 * l'ultima lettura per apparato con l'esito. Accendere e spegnere si fa da Opzioni (22/10): qui lo stato e il rimando.
 */
export function LettureCard() {
  const [s, setS] = useState<Stato | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const { voci } = useVociOpzioni(["lettura.mikrotik", "lettura.controller", "lettura.snmp", "lettura.host", "lettura.mikrotik_scheda", "lettura.switch_vlan"]);

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
            <p className="text-sm">Accese di serie, in sola lettura; la mappa non cambia finché non si accende la mappa nuova.</p>
            {!s.schema && <p className="text-sm font-medium" role="status">Non disponibili: lo schema di questo cliente non è aggiornato.</p>}
            {s.letture.map((r) => {
              const d = DESCRIZIONE_LETTURE[r.lettura];
              const e = righeEsito(r.esiti, (id) => r.nomi[String(id)] ?? `apparato #${id}`, 10);
              const v = voci[`lettura.${r.lettura}`];
              return (
                <div key={r.lettura} className="rounded-md border p-3 space-y-1">
                  {v ? <RigaRimando voce={{ ...v, nome: d.titolo }} mostraEsito={false} /> : <p className="text-sm font-semibold">{d.titolo}</p>}
                  <p className="text-sm">{d.legge}</p>
                  <p className="text-sm">Apparati: {d.apparati}.</p>
                  <p className="text-sm text-muted-foreground">{d.comandi}</p>
                  {e.righe.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nessuna lettura ancora.</p>
                  ) : (
                    <ul className="text-sm list-disc pl-5">
                      {e.righe.map((t) => <li key={t}>{t}</li>)}
                      {e.altri > 0 && <li>+ altri {e.altri}</li>}
                    </ul>
                  )}
                </div>
              );
            })}
          </>
        )}
      </CardContent>
    </Card>
  );
}

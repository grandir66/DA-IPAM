"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { testoAnomalia } from "@/lib/topology/cavi/pannello";
import type { InfoCavi } from "@/lib/topology/model-types";

const MAX = 50;

/**
 * «Anomalie della rete» (spec §13.8.3 punto 8): una riga per anomalia, col titolo e il testo di D2 (gli stessi dei
 * dettagli del nodo), al più 50 e «+ altri N». Ha senso solo con la mappa nuova accesa: chi la monta passa `cavi`
 * solo allora (con la mappa spenta le anomalie in ombra stanno in «Cosa cambierebbe»).
 */
export function AnomalieCard({ cavi, nomeDi }: { cavi: InfoCavi; nomeDi: (id: string) => string }) {
  const tutte = cavi.anomalie;
  return (
    <Card className="xl:col-span-2">
      <CardHeader><CardTitle>Anomalie della rete</CardTitle></CardHeader>
      <CardContent>
        {tutte.length === 0 ? (
          <p className="text-sm">Nessuna anomalia: nessun core esce da uno switch di accesso.</p>
        ) : (
          <ul className="space-y-3">
            {tutte.slice(0, MAX).map((a) => {
              const t = testoAnomalia(a, nomeDi);
              return (
                <li key={`${a.nodo}|${a.padre}|${a.porta}`} className="space-y-1">
                  <p className="text-sm font-semibold">⚠︎ {nomeDi(a.nodo)}: {t.titolo}</p>
                  <p className="text-sm">{t.testo}</p>
                </li>
              );
            })}
            {tutte.length > MAX && <li className="text-sm text-muted-foreground">+ altri {tutte.length - MAX}</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

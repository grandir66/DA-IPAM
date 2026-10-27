"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RigheRimando } from "@/components/opzioni/riga-rimando";
import { TITOLO_MAPPA, testoDialogoMappa } from "@/lib/topology/letture/testi-mappa";

/**
 * «Mappa nuova (una linea per cavo)» (spec topologia §13.11.4, T3.7): che cosa cambia e lo stato. Dal 22/10 si accende
 * e si spegne da Opzioni: qui il rimando.
 */
export function MappaCard() {
  return (
    <Card className="xl:col-span-2">
      <CardHeader><CardTitle>{TITOLO_MAPPA}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <RigheRimando ids={["automatismo.mappa_cavi"]} mostraEsito={false} />
        <p className="text-sm">{testoDialogoMappa(true)}</p>
      </CardContent>
    </Card>
  );
}

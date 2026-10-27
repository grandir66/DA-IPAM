"use client";

import { Workflow } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RigheRimando } from "@/components/opzioni/riga-rimando";

/** Inventario NIS2: cos'è e lo stato. Dal 22/10 si accende e si spegne da Opzioni. */
export function Nis2ToggleCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="h-5 w-5" />
          Inventario NIS2
        </CardTitle>
        <CardDescription>
          Voce di menu &quot;Servizi NIS2&quot; (anagrafica servizi/asset critici). Modulo nativo opzionale.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RigheRimando ids={["modulo.nis2_inventory"]} mostraEsito={false} />
      </CardContent>
    </Card>
  );
}

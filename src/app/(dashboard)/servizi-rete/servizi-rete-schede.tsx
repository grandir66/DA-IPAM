"use client";

import { useState } from "react";
import { SchedePagina } from "@/components/shared/console";
import { ServiziReteClient } from "./servizi-rete-client";
import { IdentitaClient } from "./identita-client";
import type { ConteggiServiziRete, ServizioRete } from "@/lib/servizi-rete/db";
import type { StatoGiro } from "@/lib/servizi-rete/giro";
import type { ConteggiIdentita, PropostaIdentita } from "@/lib/servizi-rete/identita";

type Scheda = "servizi" | "apparati";

export function ServiziReteSchede({
  servizi,
  identita,
  admin,
}: {
  servizi: {
    righe: ServizioRete[];
    totale: number;
    conteggi: ConteggiServiziRete;
    giro: StatoGiro | null;
    reti: Array<{ id: number; nome: string; cidr: string }>;
  };
  identita: { righe: PropostaIdentita[]; conteggi: ConteggiIdentita };
  admin: boolean;
}) {
  const [scheda, setScheda] = useState<Scheda>("servizi");
  return (
    <div className="space-y-4">
      <SchedePagina<Scheda>
        etichetta="Servizi di rete"
        scelta={scheda}
        onScegli={setScheda}
        voci={[
          { valore: "servizi", titolo: "Porte e servizi", descrizione: "Cosa risponde su ogni porta, senza credenziali" },
          {
            valore: "apparati",
            titolo: "Stesso apparato",
            descrizione: "Due IP con la stessa impronta, da confermare",
            segnale:
              identita.conteggi.proposte > 0 ? (
                <span className="rounded-full bg-[#0D2537] px-2 font-mono text-[13px] font-bold text-white dark:bg-primary">
                  {identita.conteggi.proposte}
                </span>
              ) : undefined,
          },
        ]}
      />
      {scheda === "servizi" ? (
        <ServiziReteClient iniziale={servizi} admin={admin} />
      ) : (
        <IdentitaClient iniziale={identita} admin={admin} />
      )}
    </div>
  );
}

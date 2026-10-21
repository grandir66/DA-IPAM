"use client";

/**
 * Tab «Dettagli»: ciò che la vecchia pagina mostrava in Generale, Sistema, Rete e Software. Dopo la scheda per
 * tipo la tiene solo il tipo `generico` (stampanti, access point, UPS, postazioni…), che non ha tab sue e la cui
 * Panoramica non mostra inventario base, informazioni SNMP, IP collegati né software. Gli altri tipi hanno i
 * blocchi nelle loro tab (un blocco di `/objects` va nella tab del tipo, non qui).
 */
import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Boxes, ServerCog, Network, HardDrive } from "lucide-react";
import { DettagliGenerale } from "./dettagli/generale";
import { DettagliSistema } from "./dettagli/sistema";
import { DettagliRete } from "./dettagli/rete";
import { DettagliSoftware } from "./dettagli/software";
import type { ContestoScheda } from "./contesto";

const SOTTO = ["generale", "sistema", "network", "software"] as const;
type Sotto = (typeof SOTTO)[number];

export function TabDettagli({ ctx }: { ctx: ContestoScheda }) {
  const [sotto, setSotto] = useState<Sotto>(SOTTO.includes(ctx.sottoTabDettagli as Sotto) ? (ctx.sottoTabDettagli as Sotto) : "generale");
  return (
    <Tabs value={sotto} onValueChange={(v) => setSotto(v as Sotto)} className="space-y-4">
      <TabsList className="!h-10 p-1 gap-1 bg-muted border border-border flex-wrap">
        <TabsTrigger value="generale" className="px-3 py-1.5 text-sm"><Boxes className="h-4 w-4 mr-1.5" />Generale</TabsTrigger>
        <TabsTrigger value="sistema" className="px-3 py-1.5 text-sm"><ServerCog className="h-4 w-4 mr-1.5" />Sistema</TabsTrigger>
        <TabsTrigger value="network" className="px-3 py-1.5 text-sm"><Network className="h-4 w-4 mr-1.5" />Rete</TabsTrigger>
        <TabsTrigger value="software" className="px-3 py-1.5 text-sm"><HardDrive className="h-4 w-4 mr-1.5" />Software</TabsTrigger>
      </TabsList>
      {sotto === "generale" && <DettagliGenerale ctx={ctx} />}
      {sotto === "sistema" && <DettagliSistema ctx={ctx} />}
      {sotto === "network" && <DettagliRete ctx={ctx} />}
      {sotto === "software" && <DettagliSoftware ctx={ctx} />}
    </Tabs>
  );
}

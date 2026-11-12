"use client";

/**
 * «Topologia di rete» nella striscia in testa alla casa (Riccardo, 12/11/2026: «una voce con topologia rete in cui
 * viene mostrata in read only la topologia della rete, però in un modale grande»). È la mappa di Topologia così com'è,
 * senza i comandi dell'amministratore: non si sposta, non si collega e non si salva niente. La mappa si carica solo
 * quando il modale si apre. Le sue letture passano dal recinto (`src/lib/cliente/recinto.ts`), le scritture no.
 */
import { useState } from "react";
import { Network } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TopologyMapClient } from "@/components/topology/map/topology-map-client";

export function RiquadroTopologia({ apparatiDiRete }: { apparatiDiRete: number }) {
  const [aperto, setAperto] = useState(false);
  const contesto = apparatiDiRete > 0
    ? `${apparatiDiRete} ${apparatiDiRete === 1 ? "apparato di rete con le porte lette" : "apparati di rete con le porte lette"}`
    : "Come sono collegati gli apparati";
  return (
    <Dialog open={aperto} onOpenChange={setAperto}>
      <DialogTrigger
        render={
          <button
            type="button"
            title={contesto}
            className="flex min-w-0 flex-col rounded-lg border border-t-[3px] border-t-[var(--vc-cian)] bg-card px-3 py-2 text-left hover:border-primary"
          />
        }
      >
        <span className="flex items-center justify-between gap-2 text-[13px] font-semibold">
          <span className="truncate">Topologia di rete</span>
          <Network className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
        <span className="mt-0.5 text-2xl font-bold leading-tight">Mappa</span>
        <span className="truncate text-[13px] text-muted-foreground">{contesto}</span>
      </DialogTrigger>
      <DialogContent className="vista-cliente flex h-[94dvh] w-[97vw] max-w-none flex-col gap-2 sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Topologia di rete</DialogTitle>
          <DialogDescription>Come sono collegati gli apparati, in sola lettura.</DialogDescription>
        </DialogHeader>
        {aperto && <TopologyMapClient isAdmin={false} altezza="min-h-0 flex-1" />}
      </DialogContent>
    </Dialog>
  );
}

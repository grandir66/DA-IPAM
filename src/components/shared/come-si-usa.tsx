"use client";

import { CircleHelp } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { Guida } from "@/lib/guida/guide";
import { cn } from "@/lib/utils";
import { SCHEDA_BASE } from "./forma-scheda";

function Parte({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-[15px] font-semibold">{titolo}</h3>
      <div className="text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/** Il pulsante «Come si usa» e la sua finestra: sempre le stesse cinque parti (testi in `lib/guida/guide.ts`). */
export function ComeSiUsa({ titolo, guida }: { titolo: string; guida: Guida }) {
  return (
    <Dialog>
      <DialogTrigger className={cn(SCHEDA_BASE, "ml-auto border-foreground/40 bg-card font-medium hover:bg-muted")}>
        <CircleHelp className="size-4" aria-hidden />
        Come si usa
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">{titolo}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Parte titolo="A cosa serve">{guida.serve}</Parte>
          <Parte titolo="Come si usa">
            <ol className="list-decimal space-y-1 pl-5">{guida.passi.map((p) => <li key={p}>{p}</li>)}</ol>
          </Parte>
          {guida.segni && (
            <Parte titolo="Cosa vogliono dire i segni">
              <ul className="space-y-1">{guida.segni.map((s) => <li key={s}>{s}</li>)}</ul>
            </Parte>
          )}
          <Parte titolo="Da dove arrivano i dati">{guida.fonte}</Parte>
          <Parte titolo="Se la pagina è vuota">{guida.vuota}</Parte>
        </div>
      </DialogContent>
    </Dialog>
  );
}

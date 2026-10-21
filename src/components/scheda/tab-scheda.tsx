"use client";

/**
 * Le tab della scheda apparato e il registro «tab → componente».
 *
 * PUNTO DI INNESTO per i task di tipo (T3-T7). Per aggiungere le tab di un tipo:
 *   1. scrivere i componenti in `src/components/scheda/tipi/<tipo>/` (ricevono `{ ctx: ContestoScheda }`);
 *   2. aggiungere qui sotto, in `TAB_DEL_TIPO`, UNA riga per tab: `<tipo>: { <tabId>: { render: (c) => <… ctx={c} /> } }`
 *      (`etichetta` solo se il nome della tab cambia per quel tipo, es. «Servizi e processi»);
 *   3. in `src/lib/scheda/tipo-scheda.ts` (`tabDelTipo`) elencare le tab del tipo e togliere `dettagli`.
 * Quello che il tipo non registra ricade sul registro base (`TAB_BASE`): Panoramica generica, Dettagli e le
 * tab comuni Sicurezza · Gestione · Storico, che valgono per tutti.
 */
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAB_COMUNI, type TabId, type TipoScheda } from "@/lib/scheda/tipo-scheda";
import type { ContestoScheda } from "./contesto";
import { PanoramicaGenerica } from "./panoramica-generica";
import { TabDettagli } from "./tab-dettagli";
import { TabGestione } from "./tab-gestione";
import { TabSicurezza } from "./tab-sicurezza";
import { TabStorico } from "./tab-storico";

export interface VoceTab {
  /** Solo se il nome cambia per questo tipo. */
  etichetta?: string;
  render: (ctx: ContestoScheda) => ReactNode;
}

/** Tab proprie di ogni tipo: qui T3-T7 aggiungono la loro riga (vedi il commento in testa). */
export const TAB_DEL_TIPO: Partial<Record<TipoScheda, Partial<Record<TabId, VoceTab>>>> = {};

/** Registro base: vale per ogni tipo che non ha una voce sua. */
const TAB_BASE: Partial<Record<TabId, VoceTab>> = {
  panoramica: { render: (c) => <PanoramicaGenerica ctx={c} /> },
  dettagli: { render: (c) => <TabDettagli ctx={c} /> },
  sicurezza: { render: (c) => <TabSicurezza ctx={c} /> },
  gestione: { render: (c) => <TabGestione ctx={c} /> },
  storico: { render: (c) => <TabStorico ctx={c} /> },
};

export const ETICHETTE_TAB: Record<TabId, string> = {
  panoramica: "Panoramica",
  porte: "Porte",
  vlan: "VLAN",
  vicini: "Vicini e MAC",
  interfacce: "Interfacce",
  routing: "Routing e ARP",
  dhcp: "DHCP",
  configurazione: "Configurazione",
  dischi: "Dischi e RAID",
  volumi: "Volumi",
  servizi_nas: "Servizi",
  vm: "VM e container",
  nodi: "Nodi",
  storage_px: "Storage",
  rete_px: "Rete",
  sistema: "Sistema",
  servizi: "Servizi",
  aggiornamenti: "Aggiornamenti",
  software: "Software",
  utenti: "Utenti",
  ad: "Active Directory",
  dipendenze: "Dipendenze",
  dettagli: "Dettagli",
  sicurezza: "Sicurezza",
  gestione: "Gestione",
  storico: "Storico",
};

function voce(tipo: TipoScheda, tab: TabId): VoceTab | undefined {
  return TAB_DEL_TIPO[tipo]?.[tab] ?? TAB_BASE[tab];
}

const COMUNI: ReadonlySet<TabId> = new Set(TAB_COMUNI);

/** Barra delle tab (quelle del tipo, un separatore, poi le comuni) e contenuto della tab attiva. */
export function TabScheda({ ctx, tabs, attiva, onCambia }: { ctx: ContestoScheda; tabs: TabId[]; attiva: TabId; onCambia: (t: TabId) => void }) {
  const proprie = tabs.filter((t) => !COMUNI.has(t));
  const comuni = tabs.filter((t) => COMUNI.has(t));
  const trigger = (t: TabId) => (
    <TabsTrigger key={t} value={t} className="px-3 py-1.5 text-sm">
      {voce(ctx.tipo, t)?.etichetta ?? ETICHETTE_TAB[t]}
    </TabsTrigger>
  );
  const corrente = voce(ctx.tipo, attiva);
  return (
    <div className="space-y-4">
      <Tabs value={attiva} onValueChange={(v) => onCambia(v as TabId)}>
        <TabsList className="!h-10 flex-wrap gap-1 border border-border bg-muted p-1">
          {proprie.map(trigger)}
          {proprie.length > 0 && comuni.length > 0 && <span aria-hidden className="mx-1 h-5 w-px bg-border" />}
          {comuni.map(trigger)}
        </TabsList>
      </Tabs>
      {corrente ? corrente.render(ctx) : <p className="text-sm text-muted-foreground">Questa tab non è disponibile per questo apparato.</p>}
    </div>
  );
}

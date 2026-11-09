"use client";

/**
 * Dati e pezzi comuni della scheda UPS: l'inventario `device_info.ups_inventory` dal contesto, la barra di un livello
 * (carica, carico) e il messaggio «non ancora letto». Attenzione con doppio segnale: barra gialla e ▲ nel testo.
 */
import type { UpsInventorySnapshot } from "@/lib/devices/device-info";
import type { ContestoScheda } from "../../contesto";

export const upsDi = (ctx: ContestoScheda): UpsInventorySnapshot | null => ctx.device?.device_info?.ups_inventory ?? null;

/** Lo snapshot c'è ma nessun MIB ha risposto: per la scheda è come non averlo. */
export const upsLetto = (snap: UpsInventorySnapshot | null): snap is UpsInventorySnapshot => !!snap && snap.sources.length > 0;

export function SenzaInventarioUps() {
  return (
    <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      Lo stato dell&apos;UPS non è ancora stato letto: serve una scansione con SNMP (UPS-MIB o APC PowerNet). Si lancia da
      Gestione o con «Aggiorna». Se la scansione è già passata, l&apos;UPS non espone nessuno dei due MIB.
    </p>
  );
}

/** Barra di un livello in percentuale (0-100, oltre si taglia): blu Domarc, gialla con ▲ quando va guardata. */
export function BarraUps({ etichetta, pct, attenzione, nota }: { etichetta: string; pct: number; attenzione: boolean; nota?: string }) {
  const larghezza = Math.max(2, Math.min(100, pct));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-[#0D2537] dark:text-foreground">{etichetta}</span>
        <span className={attenzione ? "text-[13px] font-semibold text-[#7A5E00] dark:text-[#FFD400]" : "text-[13px] text-muted-foreground"}>
          {attenzione && <span aria-hidden>▲ </span>}
          {pct}%{nota ? ` · ${nota}` : ""}
        </span>
      </div>
      <div className={`mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted ${attenzione ? "ring-1 ring-[#7A5E00]" : ""}`}>
        <div
          className={attenzione ? "h-full rounded-full bg-[#FFD400]" : "h-full rounded-full bg-[#0D2537] dark:bg-sky-300"}
          style={{ width: `${larghezza}%` }}
        />
      </div>
    </div>
  );
}

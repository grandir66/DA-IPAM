"use client";

/**
 * Dati e pezzi comuni della scheda stampante: l'inventario `device_info.printer_inventory` dal contesto,
 * la barra del livello di un materiale (col colore del colorante) e il messaggio «non ancora letto».
 */
import type { PrinterInventorySnapshot } from "@/lib/devices/device-info";
import { coloreMateriale, etichettaMateriale, materialeInAllarme, type Materiale } from "@/lib/scheda/stampante";
import type { ContestoScheda } from "../../contesto";

export const stampanteDi = (ctx: ContestoScheda): PrinterInventorySnapshot | null =>
  ctx.device?.device_info?.printer_inventory ?? null;

export function SenzaInventarioStampante() {
  return (
    <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      I dati della stampante non sono ancora stati letti: serve una scansione con SNMP (Printer-MIB). Si lancia da Gestione o con «Aggiorna».
    </p>
  );
}

/** Barra del livello di un materiale: colore del colorante, ▲ se in allarme; «—» quando il livello è ignoto. */
export function BarraMateriale({ m }: { m: Materiale }) {
  const pct = typeof m.level_pct === "number" ? m.level_pct : null;
  const allarme = materialeInAllarme(m);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-[#0D2537] dark:text-foreground">{etichettaMateriale(m)}</span>
        <span className={allarme ? "text-[13px] font-semibold text-[#7A5E00] dark:text-[#FFD400]" : "text-[13px] text-muted-foreground"}>
          {allarme && <span aria-hidden>▲ </span>}
          {pct != null ? `${pct}%` : "livello n/d"}
        </span>
      </div>
      <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {pct != null && (
          <div className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: coloreMateriale(m) }} />
        )}
      </div>
    </div>
  );
}

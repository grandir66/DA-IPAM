"use client";

/**
 * Dati e pezzi comuni della scheda storage e NAS: l'inventario `device_info.nas_inventory` dal contesto e i
 * segni di stato (parola + segno, mai solo il colore). Senza inventario le tab lo dicono e non inventano numeri.
 */
import type { NasInventorySnapshot } from "@/lib/devices/device-info";
import type { ContestoScheda } from "../../contesto";

export const nasDi = (ctx: ContestoScheda): NasInventorySnapshot | null => ctx.device?.device_info?.nas_inventory ?? null;

export const lnk = "text-[13px] font-semibold text-[#006C96] hover:underline dark:text-sky-300";

/** Stato normale o in attenzione: ✓ parola, oppure ▲ parola in grassetto scuro. */
export function StatoNas({ ok, testo }: { ok: boolean; testo: string }) {
  return ok
    ? <span className="whitespace-nowrap text-[13px]"><span aria-hidden>✓ </span>{testo}</span>
    : <span className="whitespace-nowrap text-[13px] font-semibold text-[#7A5E00] dark:text-[#FFD400]"><span aria-hidden>▲ </span>{testo}</span>;
}

export function SenzaInventario() {
  return (
    <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      L&apos;inventario del NAS non è ancora stato letto: serve una scansione con SNMP (e, per i dettagli, SSH). Si lancia da Gestione.
    </p>
  );
}

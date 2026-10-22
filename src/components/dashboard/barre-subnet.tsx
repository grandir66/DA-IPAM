import Link from "next/link";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import type { NetworkWithStats } from "@/types";

/**
 * Subnet della dashboard (Riccardo, 20/10): la barra è lunga quanto la rete rispetto alla
 * più grande (una rete da 6 host non è lunga come una da 100). Online verde scuro pieno,
 * offline arancio a righe, sconosciuti grigio chiaro (`--host-*` in globals.css): Riccardo è
 * daltonico, si separano per luminanza e forma (prima verde/rosso: 7,4 di distanza).
 */
const TRAMA_OFFLINE = "repeating-linear-gradient(135deg, var(--host-offline) 0 3px, var(--card) 3px 5px)";

export function BarreSubnet({ reti }: { reti: NetworkWithStats[] }) {
  const max = Math.max(1, ...reti.map((r) => r.total_hosts));
  return (
    <div className="divide-y divide-border">
      {reti.map((net) => {
        const quota = (n: number) => (n / max) * 100;
        return (
          <Link
            key={net.id}
            href={`/networks/${net.id}`}
            className="grid grid-cols-[8.5rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-[13px] hover:bg-muted/50 transition-colors group"
            title={`${net.cidr} · ${net.online_count} online / ${net.offline_count} offline / ${net.unknown_count} sconosciuti${net.last_scan ? ` · ultima scansione ${parseDbDate(net.last_scan).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}` : ""}`}
          >
            <span className="font-medium truncate group-hover:text-primary">{net.name}</span>
            <span className="flex h-3 rounded-sm overflow-hidden" aria-hidden>
              {net.online_count > 0 && <span className="bg-[var(--host-online)]" style={{ width: `${quota(net.online_count)}%` }} />}
              {net.offline_count > 0 && <span style={{ width: `${quota(net.offline_count)}%`, background: TRAMA_OFFLINE }} />}
              {net.unknown_count > 0 && <span className="bg-[var(--host-sconosciuto)]" style={{ width: `${quota(net.unknown_count)}%` }} />}
            </span>
            <span className="font-mono tabular-nums text-right whitespace-nowrap">
              {net.online_count}
              <span className="text-muted-foreground"> / </span>
              {net.offline_count}
              <span className="text-muted-foreground"> ({net.total_hosts})</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** Legenda sotto le barre: forma e parola, non solo colore. */
export function LegendaSubnet() {
  return (
    <div className="flex items-center gap-3 px-3 pt-1 text-[13px] text-muted-foreground">
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm bg-[var(--host-online)]" aria-hidden />online</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: TRAMA_OFFLINE }} aria-hidden />offline</span>
      <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-3 rounded-sm bg-[var(--host-sconosciuto)]" aria-hidden />sconosciuti</span>
      <span className="ml-auto">online / offline (totale)</span>
    </div>
  );
}

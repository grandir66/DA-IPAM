import Link from "next/link";
import { Circle, FileText, MonitorSmartphone, Network, Users, Wrench, type LucideIcon } from "lucide-react";
import type { RiquadroCliente } from "@/lib/cliente/registro";
import { SegnoStato } from "./segno-stato";

/** Icone delle schede previste dal registro. Un nome sconosciuto resta un cerchio. */
const ICONE: Record<string, LucideIcon> = {
  Circle,
  FileText,
  MonitorSmartphone,
  Network,
  Users,
  Wrench,
};

/** Tutto il riquadro apre la scheda. */
export function RiquadroModulo({
  id,
  titolo,
  icona,
  riquadro,
}: {
  id: string;
  titolo: string;
  icona: string;
  riquadro: RiquadroCliente;
}) {
  const Icona = ICONE[icona] ?? Circle;
  return (
    <Link
      href={`/cliente/${id}`}
      className="flex flex-col rounded-xl border bg-card p-3.5 hover:border-foreground/25"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Icona className="size-4 shrink-0" aria-hidden />
          {titolo}
        </span>
        <SegnoStato stato={riquadro.stato} aperti={riquadro.aperti} />
      </span>
      <span className="mt-3 font-mono text-2xl font-bold tabular-nums">
        {riquadro.numero}
        {riquadro.unita && (
          <span className="ml-1 font-sans text-[13px] font-normal text-muted-foreground">{riquadro.unita}</span>
        )}
      </span>
      <span className="mt-1 text-[13px] text-muted-foreground">{riquadro.contesto}</span>
    </Link>
  );
}

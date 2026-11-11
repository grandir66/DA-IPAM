import Link from "next/link";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import type { RiquadroCliente, StatoRiquadro } from "@/lib/cliente/registro";

const FILO: Record<StatoRiquadro, string> = {
  a_posto: "border-t-[var(--vc-cian)]",
  attenzione: "border-t-[var(--vc-giallo)]",
  grave: "border-t-[var(--vc-grave)]",
};

/** Lo stato si legge dalla forma dell'icona; il filo colorato è solo un rinforzo. */
function Segno({ stato }: { stato: StatoRiquadro }) {
  if (stato === "grave") return <TriangleAlert className="size-4 shrink-0 text-[var(--vc-grave)]" aria-label="grave" />;
  if (stato === "attenzione") return <CircleAlert className="size-4 shrink-0" aria-label="da guardare" />;
  return <CircleCheck className="size-4 shrink-0 text-muted-foreground" aria-label="a posto" />;
}

/**
 * Il modulo in piccolo, nella striscia in testa alla casa (Riccardo, 11/11/2026: i riquadri
 * «potrebbero diventare dei box più piccoli in testa alla pagina»). Tutto il riquadro apre il modulo.
 */
export function RiquadroPiccolo({ id, titolo, riquadro }: { id: string; titolo: string; riquadro: RiquadroCliente }) {
  return (
    <Link
      href={`/cliente/${id}`}
      title={riquadro.contesto}
      className={`flex min-w-0 flex-col rounded-lg border border-t-[3px] bg-card px-3 py-2 hover:border-primary ${FILO[riquadro.stato]}`}
    >
      <span className="flex items-center justify-between gap-2 text-[13px] font-semibold">
        <span className="truncate">{titolo}</span>
        <Segno stato={riquadro.stato} />
      </span>
      <span className="mt-0.5 font-mono text-2xl font-bold leading-tight tabular-nums">
        {riquadro.numero}
        {riquadro.unita && <span className="ml-1 font-sans text-[13px] font-normal text-muted-foreground">{riquadro.unita}</span>}
      </span>
      <span className="truncate text-[13px] text-muted-foreground">{riquadro.contesto}</span>
    </Link>
  );
}

import Link from "next/link";
import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import type { Gravita, VoceAttenzione } from "@/lib/cliente/registro";

function SegnoGravita({ gravita }: { gravita: Gravita }) {
  if (gravita === "grave") {
    return (
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.guasto.classi}`}>
        <TriangleAlert className="size-3.5" aria-hidden />
      </span>
    );
  }
  if (gravita === "attenzione") {
    return (
      <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.attenzione.classi}`}>
        <CircleAlert className="size-3.5" aria-hidden />
      </span>
    );
  }
  return (
    <span className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md ${STILE_STATO.da_verificare.classi}`}>
      <Info className="size-3.5" aria-hidden />
    </span>
  );
}

/** Righe di «Cosa richiede attenzione». Senza voci: una riga sola. */
export function ElencoAttenzione({ voci }: { voci: VoceAttenzione[] }) {
  if (voci.length === 0) {
    return <p className="text-sm">Niente da segnalare</p>;
  }
  return (
    <ul>
      {voci.map((voce, indice) => (
        <li key={`${voce.scheda}-${voce.testo}-${indice}`} className="border-b last:border-b-0">
          <Link href={voce.href} className="flex items-center gap-3 py-2 text-sm hover:bg-muted/40">
            <SegnoGravita gravita={voce.gravita} />
            <span className="min-w-0 flex-1">{voce.testo}</span>
            <span className="shrink-0 text-[13px] text-muted-foreground">{voce.scheda}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

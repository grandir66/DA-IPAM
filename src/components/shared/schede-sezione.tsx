"use client";

/**
 * Le schede di una sezione del menu, in cima alla pagina (12/11/2026). Le pagine raggruppate sotto una voce sola
 * (`lib/menu/sezioni.ts`) si raggiungono da qui; le pagine fuori da ogni sezione non mostrano niente.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sezioneDelPercorso } from "@/lib/menu/sezioni";
import { cn } from "@/lib/utils";
import { FILA_SCHEDE, SCHEDA_ACCESA, SCHEDA_BASE, SCHEDA_SPENTA } from "./forma-scheda";

export function SchedeSezione() {
  const percorso = usePathname();
  const trovata = sezioneDelPercorso(percorso);
  if (!trovata) return null;
  return (
    <nav aria-label={`Schede di ${trovata.sezione.nome}`} className={cn("mb-3", FILA_SCHEDE)}>
      {trovata.sezione.schede.map((s) => {
        const attiva = s.href === trovata.scheda.href;
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={attiva ? "page" : undefined}
            className={cn(SCHEDA_BASE, attiva ? SCHEDA_ACCESA : SCHEDA_SPENTA)}
          >
            {s.etichetta}
          </Link>
        );
      })}
    </nav>
  );
}

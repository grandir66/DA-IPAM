"use client";

/**
 * Le schede di una sezione del menu, in cima alla pagina (12/11/2026). Le pagine raggruppate sotto una voce sola
 * (`lib/menu/sezioni.ts`) si raggiungono da qui; le pagine fuori da ogni sezione non mostrano niente.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { sezioneDelPercorso } from "@/lib/menu/sezioni";
import { cn } from "@/lib/utils";

export function SchedeSezione() {
  const percorso = usePathname();
  const trovata = sezioneDelPercorso(percorso);
  if (!trovata) return null;
  return (
    <nav aria-label={`Schede di ${trovata.sezione.nome}`} className="mb-3 flex items-center gap-1 overflow-x-auto border-b">
      {trovata.sezione.schede.map((s) => {
        const attiva = s.href === trovata.scheda.href;
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={attiva ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-1.5 text-sm",
              attiva ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {s.etichetta}
          </Link>
        );
      })}
    </nav>
  );
}

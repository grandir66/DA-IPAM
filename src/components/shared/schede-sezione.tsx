"use client";

/**
 * Le schede di una sezione del menu, in cima alla pagina (12/11/2026). Le pagine raggruppate sotto una voce sola
 * (`lib/menu/sezioni.ts`) si raggiungono da qui; le pagine fuori da ogni sezione non mostrano niente.
 *
 * Dal 13/11 una scheda può aprire una parte della pagina (l'àncora dopo `#`): le tre parti di «Reti dal trunk» stanno
 * in questa fila. L'àncora si legge dall'indirizzo e si segue con `hashchange`; la pagina fa lo stesso.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { indirizzoScheda, sezioneDelPercorso } from "@/lib/menu/sezioni";
import { cn } from "@/lib/utils";
import { FILA_SCHEDE, SCHEDA_ACCESA, SCHEDA_BASE, SCHEDA_SPENTA } from "./forma-scheda";

export function SchedeSezione() {
  const percorso = usePathname();
  const [ancora, setAncora] = useState("");
  useEffect(() => {
    const leggi = () => setAncora(window.location.hash.slice(1));
    leggi();
    window.addEventListener("hashchange", leggi);
    return () => window.removeEventListener("hashchange", leggi);
  }, [percorso]);
  const trovata = sezioneDelPercorso(percorso, ancora);
  if (!trovata) return null;
  return (
    <nav aria-label={`Schede di ${trovata.sezione.nome}`} className={cn("mb-3", FILA_SCHEDE)}>
      {trovata.sezione.schede.map((s) => {
        const attiva = s === trovata.scheda;
        const classi = cn(SCHEDA_BASE, attiva ? SCHEDA_ACCESA : SCHEDA_SPENTA);
        // Stessa pagina, altra parte: si cambia solo l'àncora, così parte `hashchange` e la pagina si sposta senza ricaricarsi.
        if (s.ancora && s.href === trovata.scheda.href) {
          return (
            <a
              key={indirizzoScheda(s)}
              href={`#${s.ancora}`}
              aria-current={attiva ? "page" : undefined}
              className={classi}
              onClick={(e) => { e.preventDefault(); window.location.hash = s.ancora ?? ""; }}
            >
              {s.etichetta}
            </a>
          );
        }
        return (
          <Link key={indirizzoScheda(s)} href={indirizzoScheda(s)} aria-current={attiva ? "page" : undefined} className={classi}>
            {s.etichetta}
          </Link>
        );
      })}
    </nav>
  );
}

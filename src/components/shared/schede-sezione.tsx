"use client";

/**
 * Le schede di una sezione del menu, in cima alla pagina (12/11/2026). Le pagine raggruppate sotto una voce sola
 * (`lib/menu/sezioni.ts`) si raggiungono da qui; le pagine fuori da ogni sezione non mostrano niente.
 *
 * Dal 13/11 una scheda può aprire una parte della pagina (l'àncora dopo `#`): le tre parti di «Reti dal trunk» stanno
 * in questa fila. L'àncora si legge dall'indirizzo e si segue con `hashchange`; la pagina fa lo stesso.
 *
 * Dal 14/11 anche Impostazioni: le sue schede si scelgono con `?tab=`, alcune le vede solo chi può (`per`), e una
 * riga verticale separa i gruppi (`stacco`).
 */
import { Fragment, Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { indirizzoScheda, sezioneDelPercorso, type SchedaSezione } from "@/lib/menu/sezioni";
import { eAdmin } from "@/lib/permessi/ruolo";
import { cn } from "@/lib/utils";
import { FILA_SCHEDE, SCHEDA_ACCESA, SCHEDA_BASE, SCHEDA_SPENTA } from "./forma-scheda";

/** `useSearchParams` vuole un confine `Suspense`: sta qui, così il layout non cambia. */
export function SchedeSezione() {
  return (
    <Suspense fallback={null}>
      <Fila />
    </Suspense>
  );
}

function Fila() {
  const percorso = usePathname();
  const tab = useSearchParams()?.get("tab") ?? "";
  const { data } = useSession();
  const utente = data?.user as { role?: string; tenants?: unknown[] } | undefined;
  const [ancora, setAncora] = useState("");
  useEffect(() => {
    const leggi = () => setAncora(window.location.hash.slice(1));
    leggi();
    window.addEventListener("hashchange", leggi);
    return () => window.removeEventListener("hashchange", leggi);
  }, [percorso]);
  const trovata = sezioneDelPercorso(percorso, ancora, tab);
  if (!trovata) return null;
  const siVede = (s: SchedaSezione): boolean =>
    s.per === "admin" ? eAdmin(utente?.role) : s.per === "piu-istanze" ? (utente?.tenants ?? []).length > 1 : true;
  const schede = trovata.sezione.schede.filter(siVede);
  // La scheda dell'indirizzo può essere una che questo utente non vede (Utenti per chi non è admin): si accende la
  // prima che vede della stessa pagina, che è quella che la pagina gli mostra.
  const accesa = siVede(trovata.scheda) ? trovata.scheda : schede.find((s) => s.href === trovata.scheda.href);
  // Una scheda che ne raccoglie altre («Avanzate») porta alla prima delle sue che l'utente vede; le sue stanno nella
  // seconda fila, che c'è solo quando si è lì dentro.
  const destinazione = (s: SchedaSezione): string => indirizzoScheda(s.sotto?.find(siVede) ?? s);
  const figlie = (accesa?.sotto ?? []).filter(siVede);
  if (figlie.length > 0) {
    const fila = (voci: readonly SchedaSezione[], attivaE: (s: SchedaSezione) => boolean, nome: string, classe: string) => (
      <nav aria-label={nome} className={cn(classe, FILA_SCHEDE)}>
        {voci.map((s, i) => (
          <Fragment key={`${s.etichetta}-${indirizzoScheda(s)}`}>
            {s.stacco && i > 0 ? <span aria-hidden className="mx-1 h-7 w-0.5 shrink-0 bg-border" /> : null}
            <Link href={destinazione(s)} aria-current={attivaE(s) ? "page" : undefined} className={cn(SCHEDA_BASE, attivaE(s) ? SCHEDA_ACCESA : SCHEDA_SPENTA)}>
              {s.etichetta}
            </Link>
          </Fragment>
        ))}
      </nav>
    );
    return (
      <>
        {fila(schede, (s) => s === accesa, `Schede di ${trovata.sezione.nome}`, "mb-2")}
        {fila(figlie, (s) => s === trovata.figlia, `Schede di ${accesa?.etichetta}`, "mb-3")}
      </>
    );
  }
  return (
    <nav aria-label={`Schede di ${trovata.sezione.nome}`} className={cn("mb-3", FILA_SCHEDE)}>
      {schede.map((s, i) => {
        const attiva = s === accesa;
        const classi = cn(SCHEDA_BASE, attiva ? SCHEDA_ACCESA : SCHEDA_SPENTA);
        const stacco = s.stacco && i > 0 ? <span aria-hidden className="mx-1 h-7 w-0.5 shrink-0 bg-border" /> : null;
        // Stessa pagina, altra parte: si cambia solo l'àncora, così parte `hashchange` e la pagina si sposta senza ricaricarsi.
        if (s.ancora && s.href === trovata.scheda.href) {
          return (
            <Fragment key={`${s.etichetta}-${indirizzoScheda(s)}`}>
              {stacco}
              <a
                href={`#${s.ancora}`}
                aria-current={attiva ? "page" : undefined}
                className={classi}
                onClick={(e) => { e.preventDefault(); window.location.hash = s.ancora ?? ""; }}
              >
                {s.etichetta}
              </a>
            </Fragment>
          );
        }
        return (
          <Fragment key={`${s.etichetta}-${indirizzoScheda(s)}`}>
            {stacco}
            <Link href={destinazione(s)} aria-current={attiva ? "page" : undefined} className={classi}>
              {s.etichetta}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

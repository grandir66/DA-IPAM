"use client";

/**
 * «Acquisizione modulare» in Impostazioni → Sistema: dopo l'ADR 0032 la levetta sta solo in Opzioni, qui c'è lo stato e il
 * rimando (`automatismo.acquisizione_modulare`). Acceso, il pulsante «Aggiorna» della scheda legge con un collector gli
 * apparati che ne hanno uno; non parte mai da solo.
 */
import { RigheRimando } from "@/components/opzioni/riga-rimando";

export function InterruttoreAcquisizioneModulare() {
  return <RigheRimando ids={["automatismo.acquisizione_modulare"]} />;
}

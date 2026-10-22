"use client";

/**
 * La levetta di un'opzione (oggetto 4 della tavola). Riccardo è daltonico: gli stati si distinguono per luminanza e per
 * scritta, mai per tinta. ACCESA navy pieno con testo bianco · SPENTA bianca col bordo grigio · ○ DA CONFIGURARE bordo
 * tratteggiato · DA FILE col lucchetto, grigio chiaro. Chi non può cambiarla vede la stessa levetta, ferma.
 */
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VoceOpzione } from "@/lib/opzioni/tipi";

const BASE = "inline-flex items-center gap-2 rounded-full border-2 text-[13px] font-bold min-h-8 whitespace-nowrap";

export function LevettaOpzione({
  voce,
  puoCambiare,
  inCorso,
  onCambia,
}: {
  voce: VoceOpzione;
  puoCambiare: boolean;
  inCorso: boolean;
  onCambia: (acceso: boolean) => void;
}) {
  const { stato, forma } = voce;
  if (forma === "file") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-[#EDEDED] px-2.5 py-1 text-[13px] font-bold text-[#0D2537] dark:bg-[#22313D] dark:text-[#E6EEF4]">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        {stato.acceso === null ? "DA FILE" : stato.acceso ? "ACCESO" : "SPENTO"}
      </span>
    );
  }
  if (stato.acceso === null) {
    return (
      <span className={cn(BASE, "border-dashed border-[#5B6B77] bg-white px-2.5 py-0.5 text-[#0D2537] dark:bg-transparent dark:text-[#E6EEF4] dark:border-[#A9BECC]")}>
        ○ DA CONFIGURARE
      </span>
    );
  }
  const acceso = stato.acceso;
  const ferma = !puoCambiare || !voce.cambiabile || forma === "scelta";
  const etichetta = forma === "modulo" ? (acceso ? "INSTALLATO" : "NON INSTALLATO") : acceso ? "ACCESA" : "SPENTA";
  const titolo = !puoCambiare
    ? "Solo un amministratore può cambiarla"
    : !voce.cambiabile
      ? "Si cambia dalla sua scheda"
      : acceso
        ? "Clic per spegnere"
        : "Clic per accendere";
  const classi = acceso
    ? cn(BASE, "border-[#0D2537] bg-[#0D2537] text-white pl-3 pr-1.5 dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]")
    : cn(BASE, "border-[#5B6B77] bg-white text-[#0D2537] pl-1.5 pr-3 dark:bg-transparent dark:text-[#E6EEF4] dark:border-[#A9BECC]");
  const pallino = acceso ? (
    <span className="h-5 w-5 rounded-full bg-white dark:bg-[#0D2537]" aria-hidden="true" />
  ) : (
    <span className="h-[18px] w-[18px] rounded-full border-2 border-[#5B6B77] dark:border-[#A9BECC]" aria-hidden="true" />
  );
  if (forma === "scelta") {
    // Le scelte si cambiano dalla tendina della riga: qui solo lo stato, senza pulsante.
    return <span className={cn(classi, "py-0.5")}>{acceso ? <>{etichetta}{pallino}</> : <>{pallino}{etichetta}</>}</span>;
  }
  return (
    <button
      type="button"
      aria-pressed={acceso}
      aria-label={`${voce.nome}: ${etichetta.toLowerCase()}. ${titolo}`}
      title={titolo}
      disabled={ferma || inCorso}
      onClick={() => onCambia(!acceso)}
      className={cn(classi, "py-0.5 transition-opacity", ferma ? "cursor-not-allowed opacity-80" : "cursor-pointer hover:opacity-90", inCorso && "opacity-50")}
    >
      {acceso ? <>{etichetta}{pallino}</> : <>{pallino}{etichetta}</>}
    </button>
  );
}

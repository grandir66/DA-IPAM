/**
 * Prompt per il Claude Code del PC del tecnico (Riccardo, 09/11/2026: «il prompt dovrebbe essere visibile nella UI
 * dell'installazione del tecnico»). Il testo vive solo in `prompt-tecnico.md`, accanto a questo file: la pagina
 * «Estrazione apparati» lo legge da lì, e `docs/revisione/2026-11-09-prompt-tecnico-estrazione.md` rimanda qui.
 */
import { readFileSync } from "node:fs";
import { unisci } from "@/lib/percorsi";
import { leggiProfilo } from "@/lib/profilo";

export const PERCORSO_PROMPT_TECNICO = unisci("src", "lib", "estrazione", "prompt-tecnico.md");

/** La pagina e la voce di menu esistono solo sull'installazione «tecnico» (ADR 0037); altrove la rotta dà 404. */
export function estrazioneVisibile(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const l = leggiProfilo(env);
  return l.ok && l.profilo === "tecnico";
}

/** Il testo del prompt; `null` se il file manca (pacchetto incompleto): la pagina lo dice invece di mostrare un vuoto. */
export function leggiPromptTecnico(radice: string = process.cwd()): string | null {
  try {
    return readFileSync(unisci(radice, PERCORSO_PROMPT_TECNICO), "utf8").trim();
  } catch {
    return null;
  }
}

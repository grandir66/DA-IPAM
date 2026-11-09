import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { estrazioneVisibile, leggiPromptTecnico, PERCORSO_PROMPT_TECNICO } from "@/lib/estrazione/prompt-tecnico";
import { IntestazionePagina, Pannello, Vuoto } from "@/components/shared/console";
import { CopiaPrompt } from "@/components/estrazione/copia-prompt";

export const dynamic = "force-dynamic";

/** Solo installazione «tecnico» (ADR 0037): il prompt da incollare nel Claude Code di questo PC. */
export default async function EstrazioneApparatiPage() {
  if (!estrazioneVisibile()) notFound();
  const sessione = await auth();
  if (!sessione?.user) redirect("/login");
  const prompt = leggiPromptTecnico();
  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Estrazione apparati"
        sottotitolo="Da incollare nel Claude Code di questo PC: legge uno switch o un router in sola lettura e scrive il JSON che DA-IPAM importa."
        azioni={prompt ? <CopiaPrompt testo={prompt} /> : undefined}
      />
      {prompt ? (
        <Pannello titolo="Prompt" sottotitolo={`Fonte: ${PERCORSO_PROMPT_TECNICO}`} corpoClassName="p-0">
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed">{prompt}</pre>
        </Pannello>
      ) : (
        <Vuoto titolo="Prompt non trovato" testo={`Manca il file ${PERCORSO_PROMPT_TECNICO} nell'installazione.`} />
      )}
    </div>
  );
}

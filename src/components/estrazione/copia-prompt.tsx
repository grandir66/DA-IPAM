"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copia il prompt negli appunti; su http senza contesto sicuro `navigator.clipboard` non c'è e lo si dice. */
export function CopiaPrompt({ testo }: { testo: string }) {
  const [copiato, setCopiato] = useState(false);
  async function copia() {
    try {
      await navigator.clipboard.writeText(testo);
      setCopiato(true);
      toast.success("Prompt copiato");
    } catch {
      toast.error("Copia non riuscita: seleziona il testo e copialo a mano");
    }
  }
  return (
    <Button onClick={copia}>
      {copiato ? <Check /> : <Copy />}
      {copiato ? "Copiato" : "Copia"}
    </Button>
  );
}

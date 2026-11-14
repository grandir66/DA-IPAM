"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/** «Visto» su una riga, o su tutte quelle dell'elenco filtrato. La scrittura sta in `/api/cambiamenti`. */
export function PulsanteVisto({ chiavi, etichetta = "Visto" }: { chiavi: string[]; etichetta?: string }) {
  const router = useRouter();
  const [stato, setStato] = useState<"fermo" | "invio" | "errore">("fermo");
  const segna = async () => {
    setStato("invio");
    try {
      const r = await fetch("/api/cambiamenti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chiavi }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setStato("fermo");
      router.refresh();
    } catch {
      setStato("errore");
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" disabled={stato === "invio" || chiavi.length === 0} onClick={segna}>
      <Check className="h-4 w-4" aria-hidden />
      {stato === "errore" ? "Non riuscito, riprova" : etichetta}
    </Button>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Il giro notturno delle porte: nasce spento e si accende qui, per questo cliente. Sta nella scheda «Porte nuove»
 * perché è l'unica fonte di quelle righe: senza, la scheda resta vuota.
 */
export function InterruttoreGiro({ acceso, ultimo, reteStanotte }: { acceso: boolean; ultimo: string | null; reteStanotte: string | null }) {
  const router = useRouter();
  const [stato, setStato] = useState<"fermo" | "invio" | "errore">("fermo");
  const cambia = async () => {
    setStato("invio");
    try {
      const r = await fetch("/api/cambiamenti/giro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceso: !acceso }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setStato("fermo");
      router.refresh();
    } catch {
      setStato("errore");
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm">
      <Moon className="h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">
          Giro notturno delle porte: {acceso ? "ACCESO" : "spento"}
        </div>
        <div className="text-muted-foreground">
          {acceso
            ? `Una subnet per notte alle 03:00, due host alla volta, al massimo 100 pacchetti al secondo. Stanotte: ${reteStanotte ?? "nessuna rete ammessa"}. Ultimo giro: ${ultimo ?? "mai"}.`
            : "Le porte nuove si vedono solo confrontando due scansioni uguali della stessa subnet. Acceso, ne fa una per notte, piano, e controlla le anomalie una volta al giorno. Sugli impianti resta il solo ping."}
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={stato === "invio"} onClick={cambia}>
        {stato === "errore" ? "Non riuscito, riprova" : acceso ? "Spegni" : "Accendi"}
      </Button>
    </div>
  );
}

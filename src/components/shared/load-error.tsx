"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Riquadro "non sono riuscito a caricare" al posto di una lista vuota.
 * Un errore mostrato come "nessun dato" fa credere che i dati non ci siano
 * (difetto UI-7, analisi 2026-10-12). Si usa con `fetchJson`.
 */
export function LoadError({
  what,
  message,
  onRetry,
}: {
  /** Cosa non si è caricato, al plurale: "le scansioni", "gli IP esclusi". */
  what: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="py-10 text-center space-y-3">
        <AlertTriangle className="h-10 w-10 mx-auto text-destructive" />
        <p className="font-medium">Impossibile caricare {what}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            <RotateCw className="h-4 w-4 mr-1.5" />
            Riprova
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

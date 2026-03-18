"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export default function NetworkDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Network detail error:", error);
  }, [error]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="rounded-full bg-destructive/10 p-3">
            <AlertTriangle className="h-8 w-8 text-destructive" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Errore nel caricamento della rete</h2>
            <p className="text-sm text-muted-foreground">
              {error.message || "Impossibile caricare i dettagli della rete."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={reset} variant="outline">
              Riprova
            </Button>
            <Button variant="ghost" nativeButton={false} render={<Link href="/networks" />}>
              <ArrowLeft className="h-4 w-4" />
              Torna alla lista
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Package } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";

interface StatoChoco {
  acceso: boolean;
  tentativiMax: number;
  riepilogo: { host: number; installati: number; daInstallare: number; falliti: number; fermi: number };
}

const URL_STATO = "/api/patch/choco-automatico";

/**
 * «Installa Chocolatey automaticamente» (21/10/2026): acceso di default. Con
 * l'interruttore acceso Chocolatey parte da solo sugli host Windows con
 * credenziale WinRM, al salvataggio o alla verifica della credenziale e ogni
 * notte; l'esito di ogni tentativo sta nello storico delle patch.
 */
export function InterruttoreChocoAutomatico({ isAdmin }: { isAdmin: boolean }) {
  const [stato, setStato] = useState<StatoChoco | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const carica = useCallback(async () => {
    const r = await fetchJson<StatoChoco>(URL_STATO, { cache: "no-store" });
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setErrore(null);
    setStato(r.data);
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  const cambia = async (acceso: boolean) => {
    setSalvo(true);
    const r = await fetchJson<StatoChoco>(URL_STATO, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acceso }),
    });
    setSalvo(false);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    setStato(r.data);
    toast.success(acceso ? "Installazione automatica di Chocolatey accesa" : "Installazione automatica di Chocolatey spenta");
  };

  if (errore) return <LoadError what="l'installazione automatica di Chocolatey" message={errore} onRetry={() => void carica()} />;
  if (!stato) return null;
  const r = stato.riepilogo;

  return (
    <Card>
      <CardContent className="flex items-start gap-4 py-4">
        <Package className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 space-y-1 text-[13px]">
          <p className="font-medium text-sm">Installa Chocolatey automaticamente</p>
          <p className="text-muted-foreground">
            Sugli host Windows con credenziale WinRM: appena la credenziale è salvata o verificata, e ogni notte
            per chi non ce l&apos;ha. Dopo {stato.tentativiMax} tentativi notturni falliti l&apos;host resta fermo
            finché non lo riprovi dalla sua pagina. Esiti nello storico delle patch.
          </p>
          <p className="text-muted-foreground">
            Host Windows con WinRM: <strong className="text-foreground">{r.host}</strong> · installato{" "}
            <strong className="text-foreground">{r.installati}</strong> · da installare{" "}
            <strong className="text-foreground">{r.daInstallare}</strong> · da ritentare{" "}
            <strong className="text-foreground">{r.falliti}</strong> · fermi{" "}
            <strong className="text-foreground">{r.fermi}</strong>
          </p>
        </div>
        <Switch
          checked={stato.acceso}
          disabled={!isAdmin || salvo}
          onCheckedChange={(v: boolean) => void cambia(v)}
          aria-label="Installa Chocolatey automaticamente"
        />
      </CardContent>
    </Card>
  );
}

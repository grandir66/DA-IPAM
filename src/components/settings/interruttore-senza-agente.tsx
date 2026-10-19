"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Monitor } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";

/**
 * Desktop remoto senza agente (RDP/VNC aperti dal server MeshCentral), analisi del
 * 19/10 (F10). L'interruttore stava solo in `.env.local`: sull'hub la voce RDP non
 * c'era e dall'interfaccia non si capiva perché.
 */
export function InterruttoreSenzaAgente({ isAdmin }: { isAdmin: boolean }) {
  const [stato, setStato] = useState<{ attivo: boolean; daAmbiente: boolean } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const carica = useCallback(async () => {
    const r = await fetchJson<{ attivo: boolean; daAmbiente: boolean }>("/api/integrations/meshcentral/senza-agente", { cache: "no-store" });
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

  const cambia = async (attivo: boolean) => {
    setSalvo(true);
    const r = await fetchJson<{ attivo: boolean; daAmbiente: boolean }>("/api/integrations/meshcentral/senza-agente", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attivo }),
    });
    setSalvo(false);
    if (!r.ok) {
      toast.error(r.message);
      return;
    }
    setStato(r.data);
    toast.success(attivo ? "Desktop remoto senza agente acceso" : "Desktop remoto senza agente spento");
  };

  if (errore) return <LoadError what="l'interruttore del desktop remoto senza agente" message={errore} onRetry={() => void carica()} />;
  if (!stato) return null;

  return (
    <Card>
      <CardContent className="flex items-start gap-4 py-4">
        <Monitor className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
        <div className="flex-1 space-y-1 text-[13px]">
          <p className="font-medium text-sm">Desktop remoto senza agente (RDP e VNC)</p>
          <p className="text-muted-foreground">
            Per gli host senza agente MeshCentral con la 3389 o la 5900 aperte: la sessione la apre il
            server MeshCentral dell&apos;appliance, senza installare niente sulla postazione.
          </p>
          {stato.daAmbiente && (
            <p className="text-amber-800 dark:text-amber-300">
              Acceso da <code>MESHCENTRAL_SENZA_AGENTE=1</code> in <code>.env.local</code>: da qui non si spegne.
            </p>
          )}
        </div>
        <Switch
          checked={stato.attivo}
          disabled={!isAdmin || stato.daAmbiente || salvo}
          onCheckedChange={(v: boolean) => void cambia(v)}
          aria-label="Desktop remoto senza agente"
        />
      </CardContent>
    </Card>
  );
}

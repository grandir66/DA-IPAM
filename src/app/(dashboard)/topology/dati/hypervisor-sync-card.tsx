"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RigheRimando } from "@/components/opzioni/riga-rimando";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { statoLetturaHypervisor } from "@/lib/proxmox/hypervisor-sync-text";
import type { HypervisorSyncState } from "@/lib/db-tenant";

type Stato = HypervisorSyncState & { warning?: string };

/**
 * Lettura giornaliera degli hypervisor (topologia fase 2b, spec §11.5): lo stato in parole. Dal 22/10 è un job di serie
 * e si accende o si spegne da Opzioni: qui il rimando.
 */
export function HypervisorSyncCard() {
  const [s, setS] = useState<Stato | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetchJson<Stato>("/api/topology/settings/hypervisor", { cache: "no-store" });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setS(r.data);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card>
      <CardHeader><CardTitle>Lettura degli hypervisor</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {error ? (
          <LoadError what="lo stato della lettura degli hypervisor" message={error} onRetry={load} />
        ) : !s ? (
          <p className="text-sm text-muted-foreground">Caricamento…</p>
        ) : (
          <>
            <RigheRimando ids={["job.hypervisor_sync"]} mostraEsito={false} />
            {statoLetturaHypervisor(s).map((frase) => (
              <p key={frase} className="text-sm">{frase}</p>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

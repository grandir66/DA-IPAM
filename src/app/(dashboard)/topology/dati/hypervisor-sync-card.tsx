"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { statoLetturaHypervisor } from "@/lib/proxmox/hypervisor-sync-text";
import type { HypervisorSyncState } from "@/lib/db-tenant";

type Stato = HypervisorSyncState & { warning?: string };

/**
 * Lettura giornaliera degli hypervisor (topologia fase 2b, spec §11.5): una
 * casella che accende o spegne il job, e lo stato in parole. Spenta di default.
 * Chi non è admin vede la casella disabilitata col motivo (revisione finale M-4).
 */
export function HypervisorSyncCard({ isAdmin }: { isAdmin: boolean }) {
  const [s, setS] = useState<Stato | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [esito, setEsito] = useState<string | null>(null);

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

  async function cambia(on: boolean) {
    setSaving(true);
    setEsito(null);
    const r = await fetchJson<Stato>("/api/topology/settings/hypervisor", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: on }),
    });
    setSaving(false);
    if (!r.ok) {
      setEsito(`Non salvato: ${r.message}`);
      return;
    }
    setS(r.data);
    setEsito(r.data.warning ?? (on ? "Salvato: lettura accesa." : "Salvato: lettura spenta."));
  }

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
            <label className={isAdmin ? "flex cursor-pointer items-center gap-3 text-sm" : "flex items-center gap-3 text-sm"}>
              <Checkbox checked={s.enabled} disabled={saving || !isAdmin} onCheckedChange={(c) => void cambia(c === true)} />
              <span>Leggi gli hypervisor ogni giorno (VM e schede)</span>
            </label>
            {!isAdmin && (
              <p className="text-sm text-muted-foreground">Sola lettura: solo un amministratore accende o spegne la lettura degli hypervisor.</p>
            )}
            {statoLetturaHypervisor(s).map((frase) => (
              <p key={frase} className="text-sm">{frase}</p>
            ))}
            {esito && <p className="text-sm text-muted-foreground" role="status">{esito}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

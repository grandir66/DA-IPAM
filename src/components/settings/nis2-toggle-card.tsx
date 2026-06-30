"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Workflow, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

/**
 * Toggle del modulo nativo "Inventario NIS2" (voce di menu "Servizi NIS2").
 * Default ON; disattivandolo la voce sparisce dal menu (gating via registry).
 */
export function Nis2ToggleCard({ isAdmin }: { isAdmin: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/modules/nis2-inventory", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { enabled?: boolean } | null) => setEnabled(d?.enabled ?? true))
      .catch(() => setEnabled(true));
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      const r = await fetch("/api/modules/nis2-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) throw new Error();
      setEnabled(next);
      toast.success(next ? "Inventario NIS2 attivato" : "Inventario NIS2 disattivato");
    } catch {
      toast.error("Errore aggiornamento");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Workflow className="h-5 w-5" />
          Inventario NIS2
        </CardTitle>
        <CardDescription>
          Voce di menu &quot;Servizi NIS2&quot; (anagrafica servizi/asset critici). Modulo nativo opzionale.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        {enabled === null ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Switch checked={enabled} disabled={!isAdmin || busy} onCheckedChange={(v) => void toggle(v)} />
            <span className="text-sm text-muted-foreground">
              {enabled ? "Attivo (voce visibile nel menu)" : "Disattivato (voce nascosta)"}
            </span>
          </>
        )}
      </CardContent>
    </Card>
  );
}

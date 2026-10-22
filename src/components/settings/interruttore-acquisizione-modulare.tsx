"use client";

/**
 * «Acquisizione modulare (anteprima)» in Impostazioni → Sistema (tavola C1, oggetto 14): impostazione del tenant,
 * assente = spento, stessa forma di «Installa Chocolatey automaticamente». Acceso, il pulsante «Aggiorna» della scheda
 * legge con un collector gli apparati che ne hanno uno e ne popola i dati; non parte mai da solo.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Boxes } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";

const URL_STATO = "/api/settings/acquisizione-modulare";

export function InterruttoreAcquisizioneModulare({ isAdmin }: { isAdmin: boolean }) {
  const [acceso, setAcceso] = useState<boolean | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const carica = useCallback(async () => {
    const r = await fetchJson<{ acceso: boolean }>(URL_STATO, { cache: "no-store" });
    if (!r.ok) { setErrore(r.message); return; }
    setErrore(null);
    setAcceso(r.data.acceso);
  }, []);

  useEffect(() => { void carica(); }, [carica]);

  const cambia = async (v: boolean) => {
    setSalvo(true);
    const r = await fetchJson<{ acceso: boolean }>(URL_STATO, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acceso: v }) });
    setSalvo(false);
    if (!r.ok) { toast.error(`Errore: ${r.message}`); return; }
    setAcceso(r.data.acceso);
    toast.success(r.data.acceso ? "Acquisizione modulare accesa" : "Acquisizione modulare spenta");
  };

  if (errore) return <LoadError what="l'interruttore dell'acquisizione modulare" message={errore} onRetry={() => void carica()} />;
  if (acceso === null) return null;
  return (
    <Card>
      <CardContent className="flex items-start gap-4 py-4">
        <Boxes className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-1 text-[13px]">
          <p className="text-sm font-medium">Acquisizione modulare (anteprima)</p>
          <p className="text-muted-foreground">
            Acceso, «Aggiorna» nella scheda legge con un collector gli apparati che ne hanno uno (HP ProCurve e Comware,
            QNAP QSS, VMware ESXi, NetApp ONTAP), con le credenziali già assegnate, e ne popola identità, porte e vicini: una
            sezione parziale non toglie niente e un valore scritto a mano resta. Non scrive sugli apparati e non parte da sola.
          </p>
          <p className="font-medium">{acceso ? "✓ Acceso" : "● Spento"}{!isAdmin && " — lo cambia un amministratore"}</p>
        </div>
        <Switch checked={acceso} disabled={!isAdmin || salvo} onCheckedChange={(v: boolean) => void cambia(v)} aria-label="Acquisizione modulare" />
      </CardContent>
    </Card>
  );
}

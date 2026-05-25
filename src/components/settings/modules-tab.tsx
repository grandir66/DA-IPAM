"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, PackageOpen, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FeatureEntry {
  key: string;
  title: string;
  description: string;
  status: "installed" | "not_installed";
  enabledAt: string | null;
  enabledBy: number | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

export function ModulesTab() {
  const [features, setFeatures] = useState<FeatureEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [uninstallDialog, setUninstallDialog] = useState<{
    open: boolean;
    feature: FeatureEntry | null;
    dropData: boolean;
  }>({ open: false, feature: null, dropData: false });

  const fetchFeatures = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/features", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { features: FeatureEntry[] };
      setFeatures(data.features ?? []);
    } catch (e) {
      console.error("Errore fetch features:", e);
      toast.error("Errore nel recupero dei moduli opzionali");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchFeatures();
  }, [fetchFeatures]);

  const handleInstall = async (feature: FeatureEntry) => {
    setBusyKey(feature.key);
    try {
      const r = await fetch(`/api/features/${feature.key}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      toast.success(`Modulo "${feature.title}" installato`);
      await fetchFeatures();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore sconosciuto";
      toast.error(`Installazione fallita: ${msg}`);
    } finally {
      setBusyKey(null);
    }
  };

  const handleUninstallConfirm = async () => {
    const feature = uninstallDialog.feature;
    if (!feature) return;
    setBusyKey(feature.key);
    try {
      const r = await fetch(`/api/features/${feature.key}/uninstall`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dropData: uninstallDialog.dropData }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      toast.success(
        uninstallDialog.dropData
          ? `Modulo "${feature.title}" disinstallato (drop dati richiesto, supportato da F1)`
          : `Modulo "${feature.title}" disinstallato (dati storici conservati)`
      );
      setUninstallDialog({ open: false, feature: null, dropData: false });
      await fetchFeatures();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Errore sconosciuto";
      toast.error(`Disinstallazione fallita: ${msg}`);
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <PackageOpen className="h-5 w-5" />
          Moduli opzionali
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Funzionalità aggiuntive installabili per il tenant corrente. A modulo spento, nessuna tabella o endpoint del modulo è attivo.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Caricamento moduli...
        </div>
      )}

      {!loading && features.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Nessun modulo opzionale disponibile.
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {features.map((feature) => {
          const installed = feature.status === "installed";
          const busy = busyKey === feature.key;
          return (
            <Card key={feature.key}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {feature.title}
                      {installed ? (
                        <Badge variant="default" className="bg-emerald-600">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Installato
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Non installato</Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {feature.description}
                    </CardDescription>
                  </div>
                  <div className="shrink-0">
                    {installed ? (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          setUninstallDialog({
                            open: true,
                            feature,
                            dropData: false,
                          })
                        }
                      >
                        {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Disinstalla...
                      </Button>
                    ) : (
                      <Button
                        disabled={busy}
                        onClick={() => handleInstall(feature)}
                      >
                        {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Installa modulo
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              {installed && (
                <CardContent className="text-xs text-muted-foreground">
                  Installato il {formatDate(feature.enabledAt)}
                  {feature.enabledBy !== null && (
                    <> da user #{feature.enabledBy}</>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Dialog
        open={uninstallDialog.open}
        onOpenChange={(open) => {
          if (!open) {
            setUninstallDialog({ open: false, feature: null, dropData: false });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disinstalla modulo?</DialogTitle>
            <DialogDescription>
              La voce di menu sparirà e gli endpoint del modulo torneranno 404.
              I dati storici restano nel DB tenant (salvo richiesta esplicita).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={uninstallDialog.dropData}
                onCheckedChange={(v) =>
                  setUninstallDialog((prev) => ({
                    ...prev,
                    dropData: v === true,
                  }))
                }
              />
              <span>
                Elimina anche i dati storici del modulo
                <span className="block text-xs text-muted-foreground">
                  (richiede F1 — al momento il flag viene accettato ma non droppa).
                </span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setUninstallDialog({
                  open: false,
                  feature: null,
                  dropData: false,
                })
              }
            >
              Annulla
            </Button>
            <Button
              variant="destructive"
              disabled={busyKey !== null}
              onClick={handleUninstallConfirm}
            >
              {busyKey !== null && (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              )}
              Disinstalla
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

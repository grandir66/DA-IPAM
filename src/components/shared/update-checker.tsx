"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertCircle,
  Download,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowUpCircle,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";

interface UpdateInfo {
  currentVersion: string;
  remoteVersion: string | null;
  updateAvailable: boolean;
  lastCheck: string;
  changelog?: string[];
  error?: string;
}

type UpdateStatus = "idle" | "checking" | "downloading" | "installing" | "completed" | "error";

export function UpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const restartIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkForUpdates = useCallback(async (silent = false) => {
    try {
      setUpdateStatus("checking");
      const res = await fetch("/api/system/update");
      if (!res.ok) throw new Error("Errore nel controllo aggiornamenti");
      
      const data: UpdateInfo = await res.json();
      setUpdateInfo(data);

      if (data.updateAvailable && !dismissed) {
        setShowBanner(true);
        if (!silent) {
          toast.info(`Nuova versione disponibile: ${data.remoteVersion}`);
        }
      } else if (!silent && !data.updateAvailable) {
        toast.success("Il sistema è aggiornato");
      }

      if (data.error && !silent) {
        toast.error(data.error);
      }
    } catch {
      if (!silent) {
        toast.error("Impossibile verificare aggiornamenti");
      }
    } finally {
      setUpdateStatus("idle");
    }
  }, [dismissed]);

  useEffect(() => {
    const lastDismissed = sessionStorage.getItem("update-dismissed");
    if (lastDismissed) {
      setDismissed(true);
    }

    const timer = setTimeout(() => {
      checkForUpdates(true);
    }, 5000);

    const interval = setInterval(() => {
      checkForUpdates(true);
    }, 3600000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      if (restartIntervalRef.current) {
        clearInterval(restartIntervalRef.current);
      }
    };
  }, [checkForUpdates]);

  const handleDismiss = () => {
    setShowBanner(false);
    setDismissed(true);
    sessionStorage.setItem("update-dismissed", "true");
  };

  const handleApplyUpdate = async () => {
    try {
      setUpdateStatus("downloading");
      setStatusMessage("Controllo stato repository...");

      const statusRes = await fetch("/api/system/update?action=status");
      const status = await statusRes.json();

      if (!status.gitClean) {
        setUpdateStatus("error");
        setStatusMessage("Ci sono modifiche locali non committate. Contatta l'amministratore.");
        return;
      }

      setStatusMessage("Scaricamento aggiornamenti...");
      setUpdateStatus("downloading");

      const res = await fetch("/api/system/update?action=apply", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setUpdateStatus("error");
        setStatusMessage(data.error || "Errore durante l'aggiornamento");
        return;
      }

      if (data.status === "completed") {
        setUpdateStatus("completed");
        setStatusMessage(data.message);
        toast.success("Aggiornamento completato!");

        if (data.requiresRestart) {
          setTimeout(() => {
            handleRestart();
          }, 3000);
        }
      }
    } catch (error) {
      setUpdateStatus("error");
      setStatusMessage(error instanceof Error ? error.message : "Errore sconosciuto");
    }
  };

  const handleRestart = async () => {
    try {
      setStatusMessage("Riavvio del server...");
      await fetch("/api/system/update?action=restart", { method: "POST" });
      
      toast.info("Il server si sta riavviando. La pagina si ricaricherà automaticamente.");
      
      let attempts = 0;
      const checkServer = setInterval(async () => {
        attempts++;
        try {
          const res = await fetch("/api/health", { cache: "no-store" });
          if (res.ok) {
            clearInterval(checkServer);
            restartIntervalRef.current = null;
            window.location.reload();
          }
        } catch {
          if (attempts > 30) {
            clearInterval(checkServer);
            restartIntervalRef.current = null;
            toast.error("Il server non risponde. Ricarica manualmente la pagina.");
          }
        }
      }, 2000);
      restartIntervalRef.current = checkServer;
    } catch {
      toast.error("Errore durante il riavvio");
    }
  };

  const updateAvailable = !!updateInfo?.updateAvailable;
  const showReopenFab = updateAvailable && dismissed && !showBanner && !dialogOpen;

  if (!updateAvailable && !dialogOpen) {
    return null;
  }

  return (
    <>
      {showReopenFab && (
        <Button
          type="button"
          size="sm"
          className="fixed bottom-4 right-4 z-50 shadow-lg gap-2"
          onClick={() => setDialogOpen(true)}
        >
          <ArrowUpCircle className="h-4 w-4" />
          Aggiornamento disponibile
        </Button>
      )}
      {showBanner && updateInfo?.updateAvailable && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-primary text-primary-foreground px-4 py-2 flex items-center justify-center gap-4 shadow-lg">
          <ArrowUpCircle className="h-5 w-5 animate-bounce" />
          <span className="text-sm font-medium">
            Nuova versione disponibile: <strong>{updateInfo.remoteVersion}</strong>
            {" "}(attuale: {updateInfo.currentVersion})
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDialogOpen(true)}
              className="h-7 text-xs"
            >
              <Download className="h-3 w-3 mr-1" />
              Aggiorna
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="h-7 text-xs hover:bg-primary-foreground/20"
            >
              <XCircle className="h-3 w-3 mr-1" />
              Ignora
            </Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5 text-primary" />
              Aggiornamento Sistema
            </DialogTitle>
            <DialogDescription>
              Gestisci gli aggiornamenti di DA-INVENT
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {updateInfo && (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div>
                    <p className="text-sm font-medium">Versione corrente</p>
                    <p className="text-2xl font-bold">{updateInfo.currentVersion}</p>
                  </div>
                  {updateInfo.remoteVersion && (
                    <div className="text-right">
                      <p className="text-sm font-medium">Versione disponibile</p>
                      <p className="text-2xl font-bold text-primary">{updateInfo.remoteVersion}</p>
                    </div>
                  )}
                </div>

                {updateInfo.updateAvailable && (
                  <Badge variant="default" className="gap-1">
                    <ArrowUpCircle className="h-3 w-3" />
                    Aggiornamento disponibile
                  </Badge>
                )}

                {!updateInfo.updateAvailable && !updateInfo.error && (
                  <Badge variant="secondary" className="gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    Sistema aggiornato
                  </Badge>
                )}

                {updateInfo.error && (
                  <div className="p-3 bg-destructive/10 text-destructive rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p className="text-sm">{updateInfo.error}</p>
                  </div>
                )}

                {updateInfo.changelog && updateInfo.changelog.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium flex items-center gap-1">
                      <GitBranch className="h-4 w-4" />
                      Ultime modifiche
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-1 max-h-32 overflow-y-auto">
                      {updateInfo.changelog.map((msg, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-primary">•</span>
                          <span className="line-clamp-2">{msg}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {updateStatus !== "idle" && updateStatus !== "checking" && (
              <div className={`p-3 rounded-lg flex items-start gap-2 ${
                updateStatus === "error" ? "bg-destructive/10 text-destructive" :
                updateStatus === "completed" ? "bg-green-500/10 text-green-700" :
                "bg-primary/10 text-primary"
              }`}>
                {updateStatus === "downloading" || updateStatus === "installing" ? (
                  <Loader2 className="h-4 w-4 mt-0.5 shrink-0 animate-spin" />
                ) : updateStatus === "completed" ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <p className="text-sm">{statusMessage}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => checkForUpdates(false)}
                disabled={updateStatus !== "idle"}
                className="flex-1"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${updateStatus === "checking" ? "animate-spin" : ""}`} />
                Controlla
              </Button>

              {updateInfo?.updateAvailable && updateStatus === "idle" && (
                <Button
                  onClick={handleApplyUpdate}
                  className="flex-1"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Installa aggiornamento
                </Button>
              )}

              {updateStatus === "completed" && (
                <Button
                  onClick={handleRestart}
                  variant="default"
                  className="flex-1"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Riavvia ora
                </Button>
              )}
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Ultimo controllo: {updateInfo?.lastCheck ? new Date(updateInfo.lastCheck).toLocaleString("it-IT") : "—"}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

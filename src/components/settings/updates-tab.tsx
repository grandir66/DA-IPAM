"use client";

import { useEffect, useState } from "react";
import {
  ArrowUpCircle,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Rocket,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { UpdateChannelCard } from "@/components/settings/update-channel-card";

interface UpdateInfo {
  currentVersion: string;
  remoteVersion: string | null;
  updateAvailable: boolean;
  lastCheck: string;
  changelog?: string[];
  error?: string;
}

interface ChannelStatus {
  channel: "stable" | "dev" | "unknown";
  branch: string;
  configuredBranch: string;
  gitBranch: string | null;
  patConfigured: boolean;
  envFileWritable: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  stable: "Stable (main)",
  dev: "Dev (dev)",
  unknown: "Sconosciuto",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

export function UpdatesTab() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [channel, setChannel] = useState<ChannelStatus | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);

  const fetchChannel = async () => {
    try {
      const r = await fetch("/api/system/update-channel", { cache: "no-store" });
      if (r.ok) setChannel((await r.json()) as ChannelStatus);
    } catch {
      /* non critico */
    }
  };

  const fetchInfo = async (force = false) => {
    setLoadingInfo(true);
    try {
      const url = force
        ? "/api/system/update?action=check&force=1"
        : "/api/system/update?action=check";
      const r = await fetch(url, { cache: "no-store" });
      if (r.ok) setInfo((await r.json()) as UpdateInfo);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Errore controllo aggiornamenti: ${msg}`);
    } finally {
      setLoadingInfo(false);
    }
  };

  useEffect(() => {
    void fetchInfo();
    void fetchChannel();
  }, []);

  const handleCheckNow = async () => {
    setChecking(true);
    await fetchInfo(true);
    await fetchChannel();
    setChecking(false);
    toast.success("Verifica completata.");
  };

  const handleUpdateNow = async () => {
    const target = info?.remoteVersion ?? "ultima disponibile";
    if (
      !confirm(
        `Avviare l'aggiornamento a v${target}?\n\n` +
          "Durata stimata: 2-5 minuti.\n" +
          "Il servizio verrà riavviato automaticamente al termine.\n" +
          "L'interfaccia potrebbe non rispondere per ~30 secondi durante il restart.\n\n" +
          "Confermi?",
      )
    ) {
      return;
    }
    setUpdating(true);
    setUpdateLog(["Avvio aggiornamento…"]);
    try {
      const r = await fetch("/api/system/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
      });
      const d = (await r.json()) as {
        status?: string;
        message?: string;
        steps?: Array<{ status: string; message: string }>;
        error?: string;
      };
      if (d.steps) {
        setUpdateLog(d.steps.map((s) => `[${s.status}] ${s.message}`));
      }
      if (d.error) {
        toast.error(d.error);
      } else if (d.status === "completed") {
        toast.success("Aggiornamento applicato. Riavvio in corso…");
        setTimeout(() => window.location.reload(), 60_000);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUpdateLog((l) => [...l, `ERRORE: ${msg}`]);
      toast.error(msg);
    } finally {
      setUpdating(false);
    }
  };

  const driftDetected =
    channel !== null &&
    (channel.channel === "unknown" ||
      (channel.gitBranch !== null && channel.gitBranch !== channel.configuredBranch));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ArrowUpCircle className="h-5 w-5 text-sky-500" />
            Aggiornamenti
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Stato versione installata, canale di aggiornamento e applicazione manuale.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleCheckNow()} disabled={checking}>
          {checking ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Ricontrolla
        </Button>
      </div>

      {driftDetected && channel && (
        <Card className="border-yellow-500/50 bg-yellow-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
              <AlertTriangle className="h-5 w-5" />
              Branch fuori dal canale configurato
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>
              Il branch git attuale è{" "}
              <code className="font-mono px-1.5 py-0.5 rounded bg-muted">
                {channel.gitBranch ?? "n/d"}
              </code>
              , mentre il canale configurato pretende{" "}
              <code className="font-mono px-1.5 py-0.5 rounded bg-muted">
                {channel.configuredBranch}
              </code>
              {channel.channel === "unknown" && (
                <> (canale <strong>non riconosciuto</strong> — solo <code>main</code>/<code>dev</code> sono validi).</>
              )}
              .
            </p>
            <p className="text-xs text-muted-foreground">
              Probabile causa: una sessione di sviluppo precedente ha lasciato l&apos;appliance su un feature branch.
              L&apos;aggiornamento successivo riallinea l&apos;appliance al canale configurato (reset hard sui tracked).
            </p>
            <div className="pt-2">
              <Button size="sm" onClick={() => void handleUpdateNow()} disabled={updating}>
                <Rocket className="h-4 w-4 mr-2" />
                Riallinea al canale {CHANNEL_LABEL[channel.channel] ?? channel.channel}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Versione installata
          </CardTitle>
          <CardDescription>
            Versione applicativa attualmente in esecuzione sull&apos;appliance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingInfo ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Stat label="Installata">
                <span className="font-mono text-lg">v{info?.currentVersion ?? "—"}</span>
              </Stat>
              <Stat label={`Disponibile su ${channel?.channel ? CHANNEL_LABEL[channel.channel] : "canale"}`}>
                {info?.remoteVersion ? (
                  <span
                    className={`font-mono text-lg ${
                      info.updateAvailable ? "text-orange-600 dark:text-orange-400" : ""
                    }`}
                  >
                    v{info.remoteVersion}
                  </span>
                ) : (
                  <span className="text-muted-foreground">non disponibile</span>
                )}
              </Stat>
              <Stat label="Ultimo controllo">
                <span className="text-sm text-muted-foreground">{formatDate(info?.lastCheck)}</span>
              </Stat>
            </div>
          )}
          {info?.error && (
            <p className="text-sm text-destructive mt-3">{info.error}</p>
          )}
          {info?.updateAvailable && !driftDetected && (
            <div className="mt-4 flex items-center gap-3 pt-3 border-t">
              <Badge className="bg-orange-500 text-white">
                <ArrowUpCircle className="h-3 w-3 mr-1" />
                Aggiornamento disponibile
              </Badge>
              <Button size="sm" onClick={() => void handleUpdateNow()} disabled={updating}>
                {updating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Aggiornamento in corso…
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4 mr-2" />
                    Aggiorna ora a v{info.remoteVersion}
                  </>
                )}
              </Button>
            </div>
          )}
          {info && !info.updateAvailable && !info.error && !driftDetected && (
            <p className="mt-3 text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" />
              Appliance allineata al canale.
            </p>
          )}
        </CardContent>
      </Card>

      {info?.changelog && info.changelog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Changelog</CardTitle>
            <CardDescription>Commit più recenti sul canale corrente.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {info.changelog.map((line, i) => (
                <li key={i} className="font-mono text-xs text-muted-foreground border-l-2 border-border pl-3">
                  {line}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {updateLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log ultimo aggiornamento</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted/40 rounded p-3 text-xs font-mono overflow-x-auto max-h-72 overflow-y-auto">
              {updateLog.join("\n")}
            </pre>
          </CardContent>
        </Card>
      )}

      <Separator className="my-2" />

      <UpdateChannelCard />
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

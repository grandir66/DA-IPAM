"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  PackageSearch,
  RefreshCw,
  Terminal,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface GlpiDownloadEntry {
  id: string;
  label: string;
  url: string;
  note?: string;
}

interface GlpiDownloads {
  version: string;
  releasesPage: string;
  documentation: string;
  windows: GlpiDownloadEntry[];
  linux: GlpiDownloadEntry[];
  macos: GlpiDownloadEntry[];
}

interface InventoryAgentState {
  enabled: boolean;
  enabledAt: string | null;
  hasToken: boolean;
  activeTokens: number;
  tokenGeneratedAt?: string | null;
  ingestUrl: string;
  hubOrigin: string;
  publicUrlSource?: string;
  installScripts: { linux: string; windows: string; macos: string };
  glpiDownloads: GlpiDownloads;
  endpoints: Array<{
    device_id: string;
    hostname: string | null;
    primary_ip: string | null;
    last_seen_at: string;
    host_id: number | null;
    apps_count?: number | null;
    match_status?: string | null;
  }>;
}

type Platform = "windows" | "linux" | "macos";

function isBadIngestUrl(url: string): boolean {
  return /0\.0\.0\.0|:3001\b|localhost|127\.0\.0\.1/i.test(url);
}

function effectiveHubBase(state: InventoryAgentState | null): string {
  if (!state) return "";
  if (state.hubOrigin && !isBadIngestUrl(state.hubOrigin)) return state.hubOrigin;
  if (typeof window !== "undefined" && window.location.origin && !isBadIngestUrl(window.location.origin)) {
    return window.location.origin;
  }
  return state.hubOrigin;
}

function effectiveIngestUrl(state: InventoryAgentState | null): string {
  const base = effectiveHubBase(state);
  if (base) return `${base.replace(/\/$/, "")}/api/inventory/ingest`;
  return state?.ingestUrl ?? "";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
}

function DownloadList({ items }: { items: GlpiDownloadEntry[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            >
              {item.label}
              <ExternalLink className="h-3 w-3" />
            </a>
            {item.note && <p className="text-[10px] text-muted-foreground">{item.note}</p>}
          </div>
          <Button variant="ghost" size="sm" className="h-7 shrink-0" render={<a href={item.url} download />}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Download
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function InventoryAgentCard({
  isAdmin,
  installed,
  onInstall,
  onUninstall,
  installBusy,
}: {
  isAdmin: boolean;
  installed: boolean;
  onInstall: () => Promise<void>;
  onUninstall: () => void;
  installBusy: boolean;
}) {
  const [state, setState] = useState<InventoryAgentState | null>(null);
  const [loading, setLoading] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [scriptBusy, setScriptBusy] = useState<Platform | null>(null);
  const [intervalHours, setIntervalHours] = useState(6);
  const [tokenDialog, setTokenDialog] = useState<{ open: boolean; token: string | null; regenerated: boolean }>({
    open: false,
    token: null,
    regenerated: false,
  });
  const [regenerateConfirmOpen, setRegenerateConfirmOpen] = useState(false);

  const fetchState = useCallback(async () => {
    if (!installed) {
      setState(null);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/inventory-agent", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState((await r.json()) as InventoryAgentState);
    } catch {
      toast.error("Errore nel recupero stato Inventory Agent");
    } finally {
      setLoading(false);
    }
  }, [installed]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiato`);
    } catch {
      toast.error("Copia non riuscita");
    }
  };

  const fetchPersonalizedOneLiner = async (platform: Platform): Promise<string | null> => {
    const r = await fetch("/api/integrations/inventory-agent/install-script", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, useStoredToken: true, intervalHours, download: false }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { oneLiner?: string };
    return data.oneLiner ?? null;
  };

  const handleCreateToken = async (regenerate: boolean) => {
    setTokenBusy(true);
    try {
      const r = await fetch("/api/integrations/inventory-agent/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regenerate ? { regenerate: true } : {}),
      });
      const data = (await r.json()) as { token?: string; error?: string; code?: string };
      if (r.status === 409) {
        toast.message("Token già attivo — usa «Rigenera token» solo se necessario");
        return;
      }
      if (!r.ok || !data.token) {
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setTokenDialog({ open: true, token: data.token, regenerated: regenerate });
      if (regenerate) setRegenerateConfirmOpen(false);
      await fetchState();
      toast.success(regenerate ? "Token rigenerato" : "Token creato");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore generazione token");
    } finally {
      setTokenBusy(false);
    }
  };

  const handleDownloadScript = async (platform: Platform) => {
    setScriptBusy(platform);
    try {
      const r = await fetch("/api/integrations/inventory-agent/install-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform, useStoredToken: true, intervalHours, download: true }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error ?? `HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        platform === "windows"
          ? "domarc-inventory-agent-install.ps1"
          : platform === "macos"
            ? "domarc-inventory-agent-install-macos.sh"
            : "domarc-inventory-agent-install.sh";
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Script scaricato");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore download script");
    } finally {
      setScriptBusy(null);
    }
  };

  const templateOneLiners = useMemo(() => {
    if (!state) return null;
    const ingestUrl = effectiveIngestUrl(state);
    const hub = effectiveHubBase(state);
    const installScripts = {
      linux: `${hub}/api/integrations/inventory-agent/install/linux.sh`,
      windows: `${hub}/api/integrations/inventory-agent/install/windows.ps1`,
      macos: `${hub}/api/integrations/inventory-agent/install/macos.sh`,
    };
    return {
      windows: `[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }\n$env:INGEST_URL = '${ingestUrl}'\n$env:INGEST_TOKEN = '<TOKEN>'\n$env:PUSH_INTERVAL_HOURS = '${intervalHours}'\nirm ${installScripts.windows} | iex`,
      linux: `curl -fsSk '${installScripts.linux}' \\\n  | sudo INGEST_URL='${ingestUrl}' \\\n       INGEST_TOKEN='<TOKEN>' \\\n       PUSH_INTERVAL_HOURS='${intervalHours}' \\\n       bash`,
      macos: `curl -fsSk '${installScripts.macos}' \\\n  | sudo INGEST_URL='${ingestUrl}' \\\n       INGEST_TOKEN='<TOKEN>' \\\n       PUSH_INTERVAL_HOURS='${intervalHours}' \\\n       bash`,
    };
  }, [state, intervalHours]);

  const displayIngestUrl = state ? effectiveIngestUrl(state) : "";
  const ingestUrlLooksWrong = Boolean(state?.ingestUrl && isBadIngestUrl(state.ingestUrl));

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <PackageSearch className="h-5 w-5" />
                Inventory Agent (GLPI push)
                {installed ? (
                  <Badge variant="default" className="bg-emerald-600">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Installato
                  </Badge>
                ) : (
                  <Badge variant="secondary">Non installato</Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1 max-w-2xl">
                GLPI Agent (solo task Inventory) → push JSON verso DA-IPAM. Nessun server GLPI né Wazuh.
              </CardDescription>
            </div>
            <div className="shrink-0 flex gap-2">
              {installed ? (
                <>
                  <Button variant="outline" size="sm" disabled={loading} onClick={() => void fetchState()}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" disabled={installBusy} onClick={onUninstall}>
                    Disinstalla…
                  </Button>
                </>
              ) : (
                <Button disabled={installBusy || !isAdmin} onClick={() => void onInstall()}>
                  {installBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Installa modulo
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        {installed && state && (
          <CardContent className="space-y-6">
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">URL ingest</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs break-all">{displayIngestUrl}</code>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => void copyText(displayIngestUrl, "URL ingest")}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Token ingest</div>
                <div className="flex flex-wrap items-center gap-2">
                  {state.hasToken ? (
                    <>
                      <Badge variant="outline" className="text-emerald-700 border-emerald-600/40">
                        Configurato
                      </Badge>
                      {state.tokenGeneratedAt && (
                        <span className="text-xs text-muted-foreground">
                          da {formatDate(state.tokenGeneratedAt)}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!isAdmin || tokenBusy}
                        onClick={() => setRegenerateConfirmOpen(true)}
                      >
                        Rigenera token…
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!isAdmin || tokenBusy}
                      onClick={() => void handleCreateToken(false)}
                    >
                      {tokenBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <KeyRound className="h-3.5 w-3.5 mr-1" />}
                      Genera token
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Un token condiviso per tutte le postazioni. Non viene rigenerato automaticamente.
                </p>
              </div>
            </div>

            {ingestUrlLooksWrong && (
              <p className="text-xs text-amber-700 dark:text-amber-400 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                L&apos;URL rilevato dal server era interno ({state.ingestUrl}). In UI usiamo{" "}
                <code>{displayIngestUrl}</code>. Per script/API permanenti imposta{" "}
                <strong>URL pubblico hub</strong> in Agenti remoti oppure env{" "}
                <code>APPLIANCE_LAN_IP</code> / <code>DA_IPAM_PUBLIC_URL</code>.
              </p>
            )}

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="inv-interval" className="text-xs">
                  Intervallo push (ore)
                </Label>
                <Input
                  id="inv-interval"
                  type="number"
                  min={1}
                  max={168}
                  className="w-24 h-8"
                  value={intervalHours}
                  onChange={(e) => setIntervalHours(Math.max(1, Math.min(168, Number(e.target.value) || 6)))}
                />
              </div>
              <p className="text-xs text-muted-foreground pb-1">
                GLPI Agent v{state.glpiDownloads.version} ·{" "}
                <a href={state.glpiDownloads.releasesPage} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  release GitHub
                </a>
              </p>
            </div>

            <Tabs defaultValue="install">
              <TabsList>
                <TabsTrigger value="install">Script installazione</TabsTrigger>
                <TabsTrigger value="downloads">Download GLPI Agent</TabsTrigger>
              </TabsList>

              <TabsContent value="install" className="space-y-4 mt-3">
                <p className="text-xs text-muted-foreground">
                  Push verso <code>{displayIngestUrl}</code> ogni {intervalHours}h. I template con{" "}
                  <code>&lt;TOKEN&gt;</code> sono sempre disponibili.
                  {state.hasToken
                    ? " Con token configurato puoi scaricare script già precompilati (token incluso, non mostrato di nuovo)."
                    : " Genera il token una volta, poi scarica gli script precompilati da qui."}
                </p>

                {templateOneLiners && (
                  <Tabs defaultValue="linux">
                    <TabsList className="h-8">
                      <TabsTrigger value="linux" className="text-xs">Linux</TabsTrigger>
                      <TabsTrigger value="windows" className="text-xs">Windows</TabsTrigger>
                      <TabsTrigger value="macos" className="text-xs">macOS</TabsTrigger>
                    </TabsList>
                    {(["linux", "windows", "macos"] as const).map((p) => (
                      <TabsContent key={p} value={p} className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-medium flex items-center gap-1">
                              <Terminal className="h-3.5 w-3.5" />
                              Template (sostituisci <code>&lt;TOKEN&gt;</code>)
                            </span>
                            <Button variant="outline" size="sm" className="h-7" onClick={() => void copyText(templateOneLiners[p], "Template")}>
                              <Copy className="h-3 w-3 mr-1" />
                              Copia
                            </Button>
                          </div>
                          <Textarea readOnly className="font-mono text-[11px] min-h-[88px]" value={templateOneLiners[p]} />
                        </div>

                        {state.hasToken && isAdmin && (
                          <div className="flex flex-wrap gap-2 pt-1 border-t border-dashed">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={scriptBusy === p}
                              onClick={async () => {
                                const oneLiner = await fetchPersonalizedOneLiner(p);
                                if (oneLiner) void copyText(oneLiner, "One-liner con token");
                                else toast.error("Impossibile generare one-liner — verifica il token");
                              }}
                            >
                              <Copy className="h-3.5 w-3.5 mr-1" />
                              Copia one-liner con token
                            </Button>
                            <Button
                              size="sm"
                              disabled={scriptBusy === p}
                              onClick={() => void handleDownloadScript(p)}
                            >
                              {scriptBusy === p ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                              ) : (
                                <Download className="h-3.5 w-3.5 mr-1" />
                              )}
                              Scarica script completo
                            </Button>
                          </div>
                        )}

                        <p className="text-[10px] text-muted-foreground">
                          Script template pubblico:{" "}
                          <a href={state.installScripts[p]} className="text-primary hover:underline" target="_blank" rel="noopener noreferrer">
                            {state.installScripts[p]}
                          </a>
                        </p>
                      </TabsContent>
                    ))}
                  </Tabs>
                )}

                {!state.hasToken && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                    Genera il token (sezione sopra) per abilitare download e one-liner precompilati. I template con{" "}
                    <code>&lt;TOKEN&gt;</code> restano utilizzabili subito.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="downloads" className="space-y-4 mt-3">
                <p className="text-xs text-muted-foreground">
                  Pacchetti ufficiali{" "}
                  <a href={state.glpiDownloads.documentation} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    documentazione installazione
                  </a>
                  . Per deploy massivo usa gli script nella tab precedente.
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-xs font-semibold mb-2">Windows</div>
                    <DownloadList items={state.glpiDownloads.windows} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold mb-2">Linux</div>
                    <DownloadList items={state.glpiDownloads.linux} />
                  </div>
                  <div>
                    <div className="text-xs font-semibold mb-2">macOS</div>
                    <DownloadList items={state.glpiDownloads.macos} />
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            {(state.endpoints?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  Endpoint registrati ({state.endpoints.length})
                </div>
                <p className="text-[11px] text-muted-foreground mb-2">
                  Il dettaglio pacchetti si apre dall&apos;oggetto di rete → tab <strong>Software</strong> →
                  sezione GLPI Agent.
                </p>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2">Hostname</th>
                        <th className="text-left p-2">IP</th>
                        <th className="text-left p-2">Match</th>
                        <th className="text-left p-2">Software</th>
                        <th className="text-left p-2">Ultimo report</th>
                        <th className="text-left p-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {state.endpoints.map((ep) => (
                        <tr key={ep.device_id} className="border-t">
                          <td className="p-2">{ep.hostname ?? ep.device_id.slice(0, 16)}</td>
                          <td className="p-2 font-mono">{ep.primary_ip ?? "—"}</td>
                          <td className="p-2">
                            {ep.match_status === "matched" ? (
                              <Badge variant="outline" className="text-[10px] text-emerald-700">matched</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">unmatched</Badge>
                            )}
                          </td>
                          <td className="p-2 font-mono">{ep.apps_count ?? 0}</td>
                          <td className="p-2">{formatDate(ep.last_seen_at)}</td>
                          <td className="p-2">
                            {ep.host_id != null ? (
                              <Button variant="link" size="sm" className="h-7 px-0 text-xs" nativeButton={false} render={<Link href={`/objects/${ep.host_id}?tab=software`} />}>
                                Oggetto #{ep.host_id}
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Dialog
        open={tokenDialog.open}
        onOpenChange={(open) => !open && setTokenDialog({ open: false, token: null, regenerated: false })}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{tokenDialog.regenerated ? "Nuovo token ingest" : "Token ingest creato"}</DialogTitle>
            <DialogDescription>
              Copia e conserva il token in un vault. Non verrà mostrato di nuovo in chiaro.
              Gli script precompilati restano scaricabili dalla tab <strong>Script installazione</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label className="text-xs">Bearer token</Label>
            <div className="flex gap-2">
              <Input readOnly value={tokenDialog.token ?? ""} className="font-mono text-xs" />
              <Button variant="outline" onClick={() => tokenDialog.token && void copyText(tokenDialog.token, "Token")}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {state && (
            <p className="text-xs text-muted-foreground">
              Ingest URL: <code className="break-all">{displayIngestUrl}</code>
            </p>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setTokenDialog({ open: false, token: null, regenerated: false })}>
              Chiudi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={regenerateConfirmOpen} onOpenChange={setRegenerateConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rigenerare il token ingest?</DialogTitle>
            <DialogDescription>
              Il token attuale verrà <strong>revocato</strong>. Tutte le postazioni già configurate smetteranno di
              inviare inventario finché non aggiorni <code>INGEST_TOKEN</code> negli script o nel cron.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRegenerateConfirmOpen(false)}>
              Annulla
            </Button>
            <Button variant="destructive" disabled={tokenBusy} onClick={() => void handleCreateToken(true)}>
              {tokenBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Rigenera token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

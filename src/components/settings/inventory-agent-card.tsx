"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Loader2,
  CheckCircle2,
  Copy,
  KeyRound,
  PackageSearch,
  RefreshCw,
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

interface InventoryAgentState {
  enabled: boolean;
  enabledAt: string | null;
  hasToken: boolean;
  activeTokens: number;
  ingestUrl: string;
  endpoints: Array<{
    device_id: string;
    hostname: string | null;
    primary_ip: string | null;
    last_seen_at: string;
    host_id: number | null;
  }>;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("it-IT");
  } catch {
    return iso;
  }
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
  const [tokenDialog, setTokenDialog] = useState<{ open: boolean; token: string | null }>({
    open: false,
    token: null,
  });

  const fetchState = useCallback(async () => {
    if (!installed) {
      setState(null);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/inventory-agent", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as InventoryAgentState;
      setState(data);
    } catch {
      toast.error("Errore nel recupero stato Inventory Agent");
    } finally {
      setLoading(false);
    }
  }, [installed]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const handleGenerateToken = async () => {
    setTokenBusy(true);
    try {
      const r = await fetch("/api/integrations/inventory-agent/token", { method: "POST" });
      const data = (await r.json()) as { token?: string; error?: string };
      if (!r.ok || !data.token) {
        throw new Error(data.error ?? `HTTP ${r.status}`);
      }
      setTokenDialog({ open: true, token: data.token });
      await fetchState();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore generazione token");
    } finally {
      setTokenBusy(false);
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiato`);
    } catch {
      toast.error("Copia non riuscita");
    }
  };

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
                Riceve inventario software da GLPI Agent (task Inventory only) via JSON push.
                Nessun server GLPI né agent Wazuh sui clienti.
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

        {installed && (
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Endpoint ingest</div>
                <div className="flex items-center gap-2">
                  <code className="text-xs break-all">{state?.ingestUrl ?? "…"}</code>
                  {state?.ingestUrl && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => void copyText(state.ingestUrl, "URL")}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Token attivi</div>
                <div className="flex items-center gap-2">
                  <span>{state?.activeTokens ?? 0}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!isAdmin || tokenBusy}
                    onClick={() => void handleGenerateToken()}
                  >
                    {tokenBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <KeyRound className="h-3.5 w-3.5 mr-1" />
                    )}
                    Genera token
                  </Button>
                </div>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Script client: <code>scripts/push-inventory-agent.ps1</code> (Windows) e{" "}
              <code>scripts/push-inventory-agent.sh</code> (Linux/macOS). Variabili{" "}
              <code>INGEST_URL</code> e <code>INGEST_TOKEN</code>.
            </p>

            {(state?.endpoints?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">
                  Endpoint recenti ({state?.endpoints.length})
                </div>
                <div className="rounded-md border overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2">Hostname</th>
                        <th className="text-left p-2">IP</th>
                        <th className="text-left p-2">Host IPAM</th>
                        <th className="text-left p-2">Ultimo report</th>
                      </tr>
                    </thead>
                    <tbody>
                      {state?.endpoints.map((ep) => (
                        <tr key={ep.device_id} className="border-t">
                          <td className="p-2">{ep.hostname ?? ep.device_id.slice(0, 12)}</td>
                          <td className="p-2 font-mono">{ep.primary_ip ?? "—"}</td>
                          <td className="p-2">{ep.host_id != null ? `#${ep.host_id}` : "—"}</td>
                          <td className="p-2">{formatDate(ep.last_seen_at)}</td>
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
        onOpenChange={(open) => !open && setTokenDialog({ open: false, token: null })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token ingest generato</DialogTitle>
            <DialogDescription>
              Copia e conserva il token: non verrà mostrato di nuovo. I token precedenti sono stati revocati.
            </DialogDescription>
          </DialogHeader>
          <Input readOnly value={tokenDialog.token ?? ""} className="font-mono text-xs" />
          <DialogFooter>
            <Button
              onClick={() => tokenDialog.token && void copyText(tokenDialog.token, "Token")}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copia token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

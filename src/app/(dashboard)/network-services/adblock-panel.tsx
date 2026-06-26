"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdBlockRules, AdBlockStats } from "@/lib/network-services/client";

interface Props {
  isAdmin: boolean;
  active: boolean;
  adblock: AdBlockStats | null;
  adblockRules: AdBlockRules | null;
  onRefresh: () => Promise<void>;
}

export function AdblockPanel({
  isAdmin,
  active,
  adblock,
  adblockRules,
  onRefresh,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [newRule, setNewRule] = useState("");
  const [upstream, setUpstream] = useState("");
  const [bootstrap, setBootstrap] = useState("1.1.1.1:53, 8.8.8.8:53");

  useEffect(() => {
    if (!active) return;
    void fetch("/api/network-services/adblock/upstream", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.upstream_dns?.length) setUpstream(d.upstream_dns.join(", "));
        if (d.bootstrap_dns?.length) setBootstrap(d.bootstrap_dns.join(", "));
      })
      .catch(() => undefined);
  }, [active]);

  function addRule() {
    if (!newRule.trim()) return;
    startTransition(async () => {
      const r = await fetch("/api/network-services/adblock/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule: newRule.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(`Regola fallita: ${data.error || r.statusText}`);
        return;
      }
      toast.success("Regola aggiunta");
      setNewRule("");
      await onRefresh();
    });
  }

  function removeRule(rule: string) {
    if (!confirm(`Rimuovere "${rule}"?`)) return;
    startTransition(async () => {
      const r = await fetch("/api/network-services/adblock/rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule }),
      });
      if (!r.ok) {
        toast.error("Rimozione fallita");
        return;
      }
      toast.success("Regola rimossa");
      await onRefresh();
    });
  }

  function saveUpstream() {
    const upstream_dns = upstream.split(/[,\s]+/).filter(Boolean);
    const bootstrap_dns = bootstrap.split(/[,\s]+/).filter(Boolean);
    if (upstream_dns.length === 0) {
      toast.error("Upstream obbligatorio (es. 127.0.0.1:5335)");
      return;
    }
    startTransition(async () => {
      const r = await fetch("/api/network-services/adblock/upstream", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upstream_dns, bootstrap_dns }),
      });
      const data = await r.json();
      if (!r.ok || data.ok === false) {
        toast.error(`Upstream fallito: ${data.error || r.statusText}`);
        return;
      }
      toast.success("Upstream AdGuard aggiornato");
      await onRefresh();
    });
  }

  function flushCache() {
    startTransition(async () => {
      const r = await fetch("/api/network-services/adblock/cache/flush", { method: "POST" });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        toast.error(`Flush fallito: ${data.error || r.statusText}`);
        return;
      }
      toast.success("Cache DNS AdGuard svuotata");
    });
  }

  return (
    <div className="space-y-4">
      {!active && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          AdBlock disabilitato. Abilitalo dal tab Panorama.
        </div>
      )}

      {active && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Statistiche filtro</CardTitle>
              <CardDescription>AdGuard Home — frontend DNS :53</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-4 items-end">
              <div className="grid grid-cols-3 gap-3 text-sm flex-1 min-w-[240px]">
                <div className="rounded border p-2">
                  <div className="text-xs text-muted-foreground">Query</div>
                  <div className="font-mono">{adblock?.num_dns_queries ?? "—"}</div>
                </div>
                <div className="rounded border p-2">
                  <div className="text-xs text-muted-foreground">Bloccate</div>
                  <div className="font-mono">{adblock?.num_blocked_filtering ?? "—"}</div>
                </div>
                <div className="rounded border p-2">
                  <div className="text-xs text-muted-foreground">Latenza media</div>
                  <div className="font-mono">
                    {typeof adblock?.avg_processing_time === "number"
                      ? `${(adblock.avg_processing_time * 1000).toFixed(1)} ms`
                      : "—"}
                  </div>
                </div>
              </div>
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={flushCache} disabled={pending}>
                  <Eraser className="h-4 w-4 mr-2" />
                  Flush cache DNS
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Upstream resolver</CardTitle>
              <CardDescription>
                Dove AdGuard inoltra le query filtrate (default: Unbound{" "}
                <code>127.0.0.1:5335</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isAdmin ? (
                <>
                  <div>
                    <Label className="text-xs">Upstream DNS</Label>
                    <Input
                      value={upstream}
                      onChange={(e) => setUpstream(e.target.value)}
                      placeholder="127.0.0.1:5335"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Bootstrap DNS</Label>
                    <Input
                      value={bootstrap}
                      onChange={(e) => setBootstrap(e.target.value)}
                      placeholder="1.1.1.1:53"
                    />
                  </div>
                  <Button size="sm" onClick={saveUpstream} disabled={pending}>
                    Salva upstream
                  </Button>
                </>
              ) : (
                <p className="text-sm font-mono">{upstream || "—"}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Regole custom</CardTitle>
              <CardDescription>
                Sintassi AdGuard: <code>||domain.com^</code> blocco,{" "}
                <code>@@||domain.com^</code> whitelist
                {adblockRules?.filters_count != null && (
                  <> — {adblockRules.filters_count} liste attive</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(adblockRules?.rules || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nessuna regola custom.</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {(adblockRules?.rules || []).map((rule, idx) => (
                    <div
                      key={`${rule}-${idx}`}
                      className="flex items-center justify-between rounded border p-2 text-sm"
                    >
                      <code className="font-mono text-xs truncate">{rule}</code>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeRule(rule)}
                          disabled={pending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {isAdmin && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-xs">Nuova regola</Label>
                    <Input
                      placeholder="||ads.example.com^"
                      value={newRule}
                      onChange={(e) => setNewRule(e.target.value)}
                    />
                  </div>
                  <Button onClick={addRule} disabled={pending}>
                    <Plus className="h-4 w-4 mr-2" />
                    Aggiungi
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

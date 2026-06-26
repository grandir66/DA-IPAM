"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ForwardZone, ResolverStatus } from "@/lib/network-services/client";

interface Props {
  isAdmin: boolean;
  active: boolean;
  resolver: ResolverStatus | null;
  onRefresh: () => Promise<void>;
}

export function ResolverPanel({ isAdmin, active, resolver, onRefresh }: Props) {
  const [pending, startTransition] = useTransition();
  const [newZone, setNewZone] = useState({ zone: "", targets: "" });
  const [rootUpstream, setRootUpstream] = useState("");
  const [loadedUpstream, setLoadedUpstream] = useState<string[]>([]);

  useEffect(() => {
    if (!active) return;
    void fetch("/api/network-services/resolver/upstream", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.targets) {
          setLoadedUpstream(d.targets);
          setRootUpstream(d.targets.join(", "));
        }
      })
      .catch(() => undefined);
  }, [active]);

  const cacheHits = resolver?.["total.num.cachehits"];
  const cacheMiss = resolver?.["total.num.cachemiss"];
  const queries = resolver?.["total.num.queries"];

  function addForward() {
    if (!newZone.zone.trim()) return;
    const targets = newZone.targets.split(/[,\s]+/).filter(Boolean);
    if (targets.length === 0) {
      toast.error("Inserisci almeno un target");
      return;
    }
    startTransition(async () => {
      const r = await fetch("/api/network-services/resolver/forwards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone: newZone.zone, targets }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        toast.error(`Forward zone fallita: ${data.error || data.detail || r.statusText}`);
        return;
      }
      toast.success(`Forward zone ${newZone.zone} aggiunta`);
      setNewZone({ zone: "", targets: "" });
      await onRefresh();
    });
  }

  function removeForward(zone: string) {
    if (!confirm(`Rimuovere forward zone ${zone}?`)) return;
    startTransition(async () => {
      const r = await fetch("/api/network-services/resolver/forwards", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zone }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(`Rimozione fallita: ${data.error || r.statusText}`);
        return;
      }
      toast.success(`${zone} rimossa`);
      await onRefresh();
    });
  }

  function saveRootUpstream() {
    const targets = rootUpstream.split(/[,\s]+/).filter(Boolean);
    if (targets.length === 0) {
      toast.error("Inserisci almeno un resolver upstream");
      return;
    }
    startTransition(async () => {
      const r = await fetch("/api/network-services/resolver/upstream", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const data = await r.json();
      if (!r.ok || data.ok === false) {
        toast.error(`Salvataggio upstream fallito: ${data.error || r.statusText}`);
        return;
      }
      toast.success("Upstream root (.) aggiornato");
      setLoadedUpstream(targets);
      await onRefresh();
    });
  }

  function flushCache() {
    startTransition(async () => {
      const r = await fetch("/api/network-services/resolver/cache/flush", { method: "POST" });
      const data = await r.json();
      if (!r.ok || !data.ok) {
        toast.error(`Flush cache fallito: ${data.error || data.out || r.statusText}`);
        return;
      }
      toast.success("Cache Unbound svuotata");
      await onRefresh();
    });
  }

  const forwards = resolver?.forward_zones || [];
  const conditional = forwards.filter((z) => z.zone !== ".");
  const rootFromList = forwards.find((z) => z.zone === ".");

  return (
    <div className="space-y-4">
      {!active && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          Resolver disabilitato. Abilitalo dal tab Panorama.
        </div>
      )}

      {active && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Cache e statistiche</CardTitle>
              <CardDescription>Unbound recursive resolver su 127.0.0.1:5335</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <div className="grid grid-cols-3 gap-3 text-sm flex-1 min-w-[240px]">
                <div className="rounded border p-2">
                  <div className="text-xs text-muted-foreground">Query</div>
                  <div className="font-mono">{queries != null ? String(queries) : "—"}</div>
                </div>
                <div className="rounded border p-2">
                  <div className="text-xs text-muted-foreground">Cache hit</div>
                  <div className="font-mono">{cacheHits != null ? String(cacheHits) : "—"}</div>
                </div>
                <div className="rounded border p-2">
                  <div className="text-xs text-muted-foreground">Cache miss</div>
                  <div className="font-mono">{cacheMiss != null ? String(cacheMiss) : "—"}</div>
                </div>
              </div>
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={flushCache} disabled={pending}>
                  <Eraser className="h-4 w-4 mr-2" />
                  Flush cache
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Upstream default (zona root)</CardTitle>
              <CardDescription>
                Forwarders condizionali verso internet o AD DNS per tutte le query non coperte da
                forward zone specifiche (es. <code>1.1.1.1</code>, <code>8.8.8.8</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {rootFromList && (
                <p className="text-xs text-muted-foreground">
                  Attivo via file: {rootFromList.file} → {rootFromList.targets.join(", ")}
                </p>
              )}
              {loadedUpstream.length > 0 && !rootFromList && (
                <p className="text-xs text-muted-foreground">
                  Configurato: {loadedUpstream.join(", ")}
                </p>
              )}
              {isAdmin && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-xs">Resolver upstream (separati da virgola)</Label>
                    <Input
                      placeholder="1.1.1.1, 8.8.8.8"
                      value={rootUpstream}
                      onChange={(e) => setRootUpstream(e.target.value)}
                    />
                  </div>
                  <Button onClick={saveRootUpstream} disabled={pending}>
                    Salva
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Forward zone / conditional forwarders</CardTitle>
              <CardDescription>
                Inoltra query per dominio specifico (es. <code>cliente.lan</code> → PowerDNS{" "}
                <code>127.0.0.1@5400</code>).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {conditional.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nessuna forward zone configurata.</p>
              ) : (
                <div className="space-y-1">
                  {conditional.map((z: ForwardZone) => (
                    <div
                      key={z.zone}
                      className="flex items-center justify-between rounded border p-2 text-sm"
                    >
                      <div>
                        <span className="font-mono font-medium">{z.zone}</span>
                        <span className="ml-3 text-xs text-muted-foreground">
                          → {z.targets.join(", ")}
                        </span>
                      </div>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeForward(z.zone)}
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
                <div className="flex gap-2 items-end flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <Label className="text-xs">Zona dominio</Label>
                    <Input
                      placeholder="cliente.lan"
                      value={newZone.zone}
                      onChange={(e) => setNewZone({ ...newZone, zone: e.target.value })}
                    />
                  </div>
                  <div className="flex-1 min-w-[180px]">
                    <Label className="text-xs">Target IP:porta</Label>
                    <Input
                      placeholder="127.0.0.1@5400"
                      value={newZone.targets}
                      onChange={(e) => setNewZone({ ...newZone, targets: e.target.value })}
                    />
                  </div>
                  <Button onClick={addForward} disabled={pending}>
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

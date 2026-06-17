"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Shield,
  Globe,
  Server,
  Wifi,
  RefreshCw,
  Plus,
  Trash2,
  Power,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  BridgeStatus,
  ResolverStatus,
  AdBlockStats,
  AdBlockRules,
  ForwardZone,
} from "@/lib/network-services/client";

type ServiceKey = "resolver" | "adblock" | "dns" | "dhcp";

import { NetworkServicesSettings } from "./network-services-setup";

interface Props {
  apiBase: string;
  isAdmin?: boolean;
  initialBridge: BridgeStatus | null;
  initialResolver: ResolverStatus | null;
  initialAdblock: AdBlockStats | null;
  initialError: string | null;
}

const SERVICE_META: Record<
  ServiceKey,
  { label: string; description: string; icon: typeof Shield }
> = {
  resolver: {
    label: "Resolver",
    description: "Unbound recursive resolver (forward zones interne)",
    icon: Globe,
  },
  adblock: {
    label: "AdBlock",
    description: "AdGuard Home — frontend DNS + filtri",
    icon: Shield,
  },
  dns: {
    label: "DNS Authoritative",
    description: "PowerDNS — zona interna cliente",
    icon: Server,
  },
  dhcp: {
    label: "DHCP",
    description: "Kea DHCP4 — lease real-time → DA-IPAM",
    icon: Wifi,
  },
};

export function NetworkServicesClient({
  apiBase,
  initialBridge,
  initialResolver,
  initialAdblock,
  initialError,
  isAdmin = false,
}: Props) {
  const [bridge, setBridge] = useState(initialBridge);
  const [resolver, setResolver] = useState(initialResolver);
  const [adblock, setAdblock] = useState(initialAdblock);
  const [adblockRules, setAdblockRules] = useState<AdBlockRules | null>(null);
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();
  const [newZone, setNewZone] = useState({ zone: "", targets: "" });
  const [newRule, setNewRule] = useState("");

  async function refreshAll() {
    try {
      const r = await fetch("/api/network-services/status", { cache: "no-store" });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "status fetch failed");
      setBridge(data.bridge);
      setResolver(data.resolver);
      setAdblock(data.adblock);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    try {
      const r = await fetch("/api/network-services/adblock/rules", { cache: "no-store" });
      const data = await r.json();
      if (data.ok) setAdblockRules(data);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    refreshAll();
    const t = setInterval(() => refreshAll(), 30_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleService(svc: ServiceKey, enable: boolean) {
    startTransition(async () => {
      const r = await fetch(`/api/network-services/toggle/${svc}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(`Toggle ${svc} fallito: ${data.error || r.statusText}`);
        return;
      }
      toast.success(`${svc} ${enable ? "abilitato" : "disabilitato"}`);
      await refreshAll();
    });
  }

  async function addForward() {
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
        toast.error(`Aggiunta zona fallita: ${data.error || data.detail || r.statusText}`);
        return;
      }
      toast.success(`Forward zone ${newZone.zone} aggiunta`);
      setNewZone({ zone: "", targets: "" });
      await refreshAll();
    });
  }

  async function removeForward(zone: string) {
    if (!confirm(`Rimuovere la forward zone ${zone}?`)) return;
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
      await refreshAll();
    });
  }

  async function addRule() {
    if (!newRule.trim()) return;
    startTransition(async () => {
      const r = await fetch("/api/network-services/adblock/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule: newRule.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(`Aggiunta regola fallita: ${data.error || r.statusText}`);
        return;
      }
      toast.success("Regola aggiunta");
      setNewRule("");
      await refreshAll();
    });
  }

  async function removeRule(rule: string) {
    if (!confirm(`Rimuovere la regola "${rule}"?`)) return;
    startTransition(async () => {
      const r = await fetch("/api/network-services/adblock/rules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(`Rimozione fallita: ${data.error || r.statusText}`);
        return;
      }
      toast.success("Regola rimossa");
      await refreshAll();
    });
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Network Services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            DNS, DHCP, AdBlock e Resolver erogati dalla VM <code>{apiBase}</code> (ADR-0007). Tutti i
            servizi sono opt-in.
          </p>
        </div>
        <Button variant="outline" onClick={() => refreshAll()} disabled={pending}>
          <RefreshCw className={`h-4 w-4 mr-2 ${pending ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {(Object.keys(SERVICE_META) as ServiceKey[]).map((svc) => {
          const meta = SERVICE_META[svc];
          const Icon = meta.icon;
          const state = bridge?.services?.[svc];
          const active = state?.active === "active";
          return (
            <Card key={svc}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <Icon className="h-5 w-5 text-muted-foreground" />
                  <Badge variant={active ? "default" : "secondary"}>
                    {active ? "active" : "inactive"}
                  </Badge>
                </div>
                <CardTitle className="text-base mt-2">{meta.label}</CardTitle>
                <CardDescription className="text-xs">{meta.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  size="sm"
                  variant={active ? "destructive" : "default"}
                  className="w-full"
                  onClick={() => toggleService(svc, !active)}
                  disabled={pending}
                >
                  <Power className="h-3.5 w-3.5 mr-2" />
                  {active ? "Disabilita" : "Abilita"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resolver — Forward Zones</CardTitle>
          <CardDescription>
            Inoltra query DNS per zone specifiche a server interni (es. <code>cliente.lan</code> →
            PowerDNS authoritative su 127.0.0.1@5400).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {resolver?.running === false && (
            <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
              Resolver disabilitato. Attivalo dal toggle in alto per gestire forward zones.
            </div>
          )}
          <div className="space-y-2">
            {(resolver?.forward_zones || []).length === 0 ? (
              <div className="text-sm text-muted-foreground">Nessuna forward zone configurata.</div>
            ) : (
              <div className="space-y-1">
                {(resolver?.forward_zones || []).map((z: ForwardZone) => (
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
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeForward(z.zone)}
                      disabled={pending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="zone" className="text-xs">
                Zona
              </Label>
              <Input
                id="zone"
                placeholder="es. cliente.lan"
                value={newZone.zone}
                onChange={(e) => setNewZone({ ...newZone, zone: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <Label htmlFor="targets" className="text-xs">
                Target (separati da spazio o virgola)
              </Label>
              <Input
                id="targets"
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AdBlock — Custom Filter Rules</CardTitle>
          <CardDescription>
            Regole aggiuntive AdGuard (sintassi <code>||domain.com^</code> per blocco,{" "}
            <code>@@||domain.com^</code> per whitelist).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {adblock?.running === false && (
            <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
              AdBlock disabilitato. Attivalo dal toggle in alto per gestire le filter rules.
            </div>
          )}
          {adblock?.running && (
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Query totali</div>
                <div className="font-mono">{adblock.num_dns_queries ?? "—"}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Bloccate</div>
                <div className="font-mono">{adblock.num_blocked_filtering ?? "—"}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-xs text-muted-foreground">Avg latency</div>
                <div className="font-mono">
                  {typeof adblock.avg_processing_time === "number"
                    ? `${(adblock.avg_processing_time * 1000).toFixed(1)} ms`
                    : "—"}
                </div>
              </div>
            </div>
          )}
          <div className="space-y-2">
            {(adblockRules?.rules || []).length === 0 ? (
              <div className="text-sm text-muted-foreground">Nessuna custom rule configurata.</div>
            ) : (
              <div className="space-y-1">
                {(adblockRules?.rules || []).map((rule, idx) => (
                  <div
                    key={`${rule}-${idx}`}
                    className="flex items-center justify-between rounded border p-2 text-sm"
                  >
                    <code className="font-mono text-xs">{rule}</code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeRule(rule)}
                      disabled={pending}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="rule" className="text-xs">
                Nuova regola
              </Label>
              <Input
                id="rule"
                placeholder="||example.com^"
                value={newRule}
                onChange={(e) => setNewRule(e.target.value)}
              />
            </div>
            <Button onClick={addRule} disabled={pending}>
              <Plus className="h-4 w-4 mr-2" />
              Aggiungi
            </Button>
          </div>
        </CardContent>
      </Card>

      {isAdmin && <NetworkServicesSettings apiUrl={apiBase} />}
    </div>
  );
}

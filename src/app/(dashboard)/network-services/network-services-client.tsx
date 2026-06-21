"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Shield, Globe, Server, Wifi, RefreshCw, Power, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BridgeStatus } from "@/lib/network-services/client";

import { NetworkServicesSettings } from "./network-services-setup";
import { DhcpSection } from "./dhcp-section";

type ServiceKey = "resolver" | "adblock" | "dns" | "dhcp";

interface Props {
  apiBase: string;
  isAdmin?: boolean;
  initialBridge: BridgeStatus | null;
  initialError: string | null;
}

const SERVICE_META: Record<
  ServiceKey,
  { label: string; description: string; icon: typeof Shield; dnsHref?: string }
> = {
  resolver: {
    label: "Resolver",
    description: "Unbound recursive (forward zones, upstream, cache)",
    icon: Globe,
    dnsHref: "/dns?tab=resolver",
  },
  adblock: {
    label: "AdBlock",
    description: "AdGuard Home — frontend DNS :53 + filtri",
    icon: Shield,
    dnsHref: "/dns?tab=filtro",
  },
  dns: {
    label: "DNS Authoritative",
    description: "PowerDNS — zone forward/reverse + record",
    icon: Server,
    dnsHref: "/dns?tab=zone",
  },
  dhcp: {
    label: "DHCP",
    description: "Kea DHCP4 — lease (configurazione in arrivo)",
    icon: Wifi,
  },
};

export function NetworkServicesClient({
  apiBase,
  initialBridge,
  initialError,
  isAdmin = false,
}: Props) {
  const [bridge, setBridge] = useState(initialBridge);
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();

  async function refreshAll() {
    try {
      const r = await fetch("/api/network-services/status", { cache: "no-store" });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "status fetch failed");
      setBridge(data.bridge);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void refreshAll();
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
      const data = (await r.json()) as {
        ok?: boolean;
        error?: string;
        results?: Array<{ unit: string; out?: string }>;
      };
      if (!r.ok || data.ok === false) {
        const detail =
          data.error ||
          data.results?.map((x) => `${x.unit}: ${x.out ?? "?"}`).join(" · ") ||
          r.statusText;
        toast.error(`Toggle ${svc} fallito: ${detail}`);
        await refreshAll();
        return;
      }
      toast.success(`${SERVICE_META[svc].label} ${enable ? "abilitato" : "disabilitato"}`);
      await refreshAll();
    });
  }

  const dhcpActive = bridge?.services?.dhcp?.active === "active";

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Network Services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            DHCP e stato servizi VM — <code>{apiBase}</code> ·{" "}
            <Link href="/dns" className="text-primary hover:underline">
              Gestione DNS →
            </Link>
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

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Panorama</TabsTrigger>
          <TabsTrigger value="dhcp">DHCP</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p className="font-medium">DNS, filtro e resolver</p>
            <p className="text-muted-foreground mt-1">
              Zone forward/reverse, AdGuard e Unbound sono gestiti centralmente in{" "}
              <Link href="/dns" className="text-primary underline font-medium">
                DNS
              </Link>
              .
            </p>
          </div>

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
                  <CardContent className="space-y-2">
                    {meta.dnsHref && (
                      <Link
                        href={meta.dnsHref}
                        className="inline-flex items-center text-xs text-primary hover:underline"
                      >
                        Apri in DNS
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </Link>
                    )}
                    {isAdmin ? (
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
                    ) : (
                      <p className="text-xs text-muted-foreground">Solo admin</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {isAdmin && <NetworkServicesSettings apiUrl={apiBase} />}
        </TabsContent>

        <TabsContent value="dhcp" className="mt-4">
          <DhcpSection active={dhcpActive} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

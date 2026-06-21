"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Shield, Globe, Server, Wifi, RefreshCw, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  BridgeStatus,
  ResolverStatus,
  AdBlockStats,
  AdBlockRules,
} from "@/lib/network-services/client";

import { NetworkServicesSettings } from "./network-services-setup";
import { DnsSection } from "./dns-section";
import { DhcpSection } from "./dhcp-section";
import { DnsChainCard } from "./dns-chain-card";
import { ResolverPanel } from "./resolver-panel";
import { AdblockPanel } from "./adblock-panel";

type ServiceKey = "resolver" | "adblock" | "dns" | "dhcp";

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
    description: "Unbound recursive (forward zones, upstream, cache)",
    icon: Globe,
  },
  adblock: {
    label: "AdBlock",
    description: "AdGuard Home — frontend DNS :53 + filtri",
    icon: Shield,
  },
  dns: {
    label: "DNS Authoritative",
    description: "PowerDNS — zone forward/reverse + record",
    icon: Server,
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

  const resolverActive = bridge?.services?.resolver?.active === "active";
  const adblockActive = bridge?.services?.adblock?.active === "active";
  const dnsActive = bridge?.services?.dns?.active === "active";
  const dhcpActive = bridge?.services?.dhcp?.active === "active";

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Network Services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            DNS auth, DHCP, toggle servizi — VM <code>{apiBase}</code> ·{" "}
            <Link href="/dns" className="text-primary hover:underline">
              Monitoraggio DNS &amp; Filtri →
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
          <TabsTrigger value="resolver">Resolver</TabsTrigger>
          <TabsTrigger value="adblock">AdBlock</TabsTrigger>
          <TabsTrigger value="dns">DNS auth</TabsTrigger>
          <TabsTrigger value="dhcp">DHCP</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <DnsChainCard apiBase={apiBase} />

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

        <TabsContent value="resolver" className="mt-4">
          <ResolverPanel
            isAdmin={isAdmin}
            active={resolverActive}
            resolver={resolver}
            onRefresh={refreshAll}
          />
        </TabsContent>

        <TabsContent value="adblock" className="mt-4">
          <AdblockPanel
            isAdmin={isAdmin}
            active={adblockActive}
            adblock={adblock}
            adblockRules={adblockRules}
            onRefresh={refreshAll}
          />
        </TabsContent>

        <TabsContent value="dns" className="mt-4">
          <DnsSection isAdmin={isAdmin} active={dnsActive} />
        </TabsContent>

        <TabsContent value="dhcp" className="mt-4">
          <DhcpSection active={dhcpActive} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

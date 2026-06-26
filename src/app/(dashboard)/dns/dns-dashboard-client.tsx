"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  AdBlockRules,
  AdBlockStats,
  BridgeStatus,
  ResolverStatus,
} from "@/lib/network-services/client";
import {
  formatLatencySeconds,
  parseTopEntries,
  pct,
  resolverStat,
} from "@/lib/network-services/dns-metrics";
import { DnsChainFlow } from "@/components/dns/dns-chain-flow";
import { DnsMetricGrid } from "@/components/dns/dns-metric-grid";
import { DnsTopTable } from "@/components/dns/dns-top-table";
import { ResolverPanel } from "@/app/(dashboard)/network-services/resolver-panel";
import { AdblockPanel } from "@/app/(dashboard)/network-services/adblock-panel";
import { DnsSection } from "@/app/(dashboard)/network-services/dns-section";

type DnsTab = "panorama" | "zone" | "filtro" | "resolver";
type DnsServiceKey = "resolver" | "adblock" | "dns";

interface Props {
  apiBase: string;
  isAdmin: boolean;
  initialBridge: BridgeStatus | null;
  initialResolver: ResolverStatus | null;
  initialAdblock: AdBlockStats | null;
  initialError: string | null;
}

const TAB_VALUES: DnsTab[] = ["panorama", "zone", "filtro", "resolver"];

function parseTab(raw: string | null): DnsTab {
  if (raw && TAB_VALUES.includes(raw as DnsTab)) return raw as DnsTab;
  return "panorama";
}

export function DnsDashboardClient({
  apiBase,
  isAdmin,
  initialBridge,
  initialResolver,
  initialAdblock,
  initialError,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<DnsTab>(() => parseTab(searchParams.get("tab")));

  const [bridge, setBridge] = useState(initialBridge);
  const [resolver, setResolver] = useState(initialResolver);
  const [adblock, setAdblock] = useState(initialAdblock);
  const [adblockRules, setAdblockRules] = useState<AdBlockRules | null>(null);
  const [filteringEnabled, setFilteringEnabled] = useState<boolean | null>(null);
  const [protectionEnabled, setProtectionEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();

  const adblockActive = bridge?.services?.adblock?.active === "active";
  const resolverActive = bridge?.services?.resolver?.active === "active";
  const dnsActive = bridge?.services?.dns?.active === "active";

  useEffect(() => {
    setTab(parseTab(searchParams.get("tab")));
  }, [searchParams]);

  function selectTab(next: DnsTab) {
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "panorama") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/dns?${qs}` : "/dns", { scroll: false });
  }

  async function refreshAll() {
    try {
      const r = await fetch("/api/network-services/status", { cache: "no-store" });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || data.message || "status fetch failed");
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
    try {
      const r = await fetch("/api/network-services/adblock/upstream", { cache: "no-store" });
      const data = await r.json();
      if (data.ok !== false) {
        if (typeof data.filtering_enabled === "boolean") setFilteringEnabled(data.filtering_enabled);
        if (typeof data.protection_enabled === "boolean") setProtectionEnabled(data.protection_enabled);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refreshAll();
    const t = setInterval(() => void refreshAll(), 30_000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleService(svc: DnsServiceKey, enable: boolean) {
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
        toast.error(`Toggle servizio fallito: ${detail}`);
        await refreshAll();
        return;
      }
      toast.success(`Servizio ${enable ? "abilitato" : "disabilitato"}`);
      await refreshAll();
    });
  }

  const queries = adblock?.num_dns_queries;
  const blocked = adblock?.num_blocked_filtering;
  const blockPct = pct(blocked, queries);

  const uQueries = resolverStat(resolver, "total.num.queries");
  const uHits = resolverStat(resolver, "total.num.cachehits");
  const uMiss = resolverStat(resolver, "total.num.cachemiss");
  const hitPct = pct(uHits, (uHits ?? 0) + (uMiss ?? 0));

  const topClients = parseTopEntries(adblock?.top_clients, 5);
  const topBlocked = parseTopEntries(adblock?.top_blocked_domains, 5);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">DNS</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Zone forward/reverse, filtro e resolver — VM <code>{apiBase}</code>
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => startTransition(() => void refreshAll())}
          disabled={pending}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${pending ? "animate-spin" : ""}`} />
          Aggiorna
        </Button>
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => selectTab(v as DnsTab)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="panorama">Panorama</TabsTrigger>
          <TabsTrigger value="zone">Zone DNS</TabsTrigger>
          <TabsTrigger value="filtro">Filtro DNS</TabsTrigger>
          <TabsTrigger value="resolver">Resolver</TabsTrigger>
        </TabsList>

        <TabsContent value="panorama" className="space-y-6 mt-4">
          {isAdmin && (
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  { key: "dns" as const, label: "DNS autoritativo", active: dnsActive },
                  { key: "adblock" as const, label: "Filtro DNS", active: adblockActive },
                  { key: "resolver" as const, label: "Resolver", active: resolverActive },
                ] as const
              ).map(({ key, label, active }) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-border p-3 gap-2"
                >
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <Badge variant={active ? "default" : "secondary"} className="mt-1">
                      {active ? "Attivo" : "Off"}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant={active ? "destructive" : "default"}
                    onClick={() => toggleService(key, !active)}
                    disabled={pending}
                  >
                    <Power className="h-3.5 w-3.5 mr-1.5" />
                    {active ? "Disabilita" : "Abilita"}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DnsChainFlow
            apiBase={apiBase}
            adblockActive={adblockActive}
            resolverActive={resolverActive}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-cyan-500/25 bg-cyan-500/[0.03] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Filtro DNS</h2>
                  <p className="text-xs text-muted-foreground">Frontend LAN :53 — blocchi e policy</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={adblockActive ? "default" : "secondary"}>
                    {adblockActive ? "Servizio attivo" : "Servizio off"}
                  </Badge>
                  {filteringEnabled === false && (
                    <Badge variant="outline" className="border-amber-500 text-amber-700">
                      Filtro sospeso
                    </Badge>
                  )}
                </div>
              </div>

              {!adblockActive ? (
                <p className="text-sm text-muted-foreground">
                  Servizio disabilitato — abilitalo dal riquadro sopra{isAdmin ? "" : " (solo admin)"}.
                </p>
              ) : (
                <>
                  <DnsMetricGrid
                    metrics={[
                      { label: "Query", value: queries != null ? queries.toLocaleString("it-IT") : "—" },
                      { label: "Bloccate", value: blocked != null ? blocked.toLocaleString("it-IT") : "—" },
                      {
                        label: "% blocco",
                        value: blockPct != null ? `${blockPct}%` : "—",
                        accent: blockPct != null && blockPct > 10 ? "good" : "neutral",
                      },
                      { label: "Latenza media", value: formatLatencySeconds(adblock?.avg_processing_time) },
                    ]}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <DnsTopTable title="Top client (query)" empty="Nessun dato ancora" rows={topClients} total={queries} />
                    <DnsTopTable title="Top domini bloccati" empty="Nessun blocco registrato" rows={topBlocked} total={blocked} />
                  </div>
                </>
              )}
            </section>

            <section className="rounded-xl border border-blue-500/25 bg-blue-500/[0.03] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Resolver</h2>
                  <p className="text-xs text-muted-foreground">Unbound :5335 — cache e forward zone</p>
                </div>
                <Badge variant={resolverActive ? "default" : "secondary"}>
                  {resolverActive ? "Servizio attivo" : "Servizio off"}
                </Badge>
              </div>

              {!resolverActive ? (
                <p className="text-sm text-muted-foreground">
                  Servizio disabilitato — abilitalo dal riquadro sopra{isAdmin ? "" : " (solo admin)"}.
                </p>
              ) : (
                <>
                  <DnsMetricGrid
                    metrics={[
                      { label: "Query", value: uQueries != null ? uQueries.toLocaleString("it-IT") : "—" },
                      { label: "Cache hit", value: uHits != null ? uHits.toLocaleString("it-IT") : "—" },
                      { label: "Cache miss", value: uMiss != null ? uMiss.toLocaleString("it-IT") : "—" },
                      {
                        label: "Hit ratio",
                        value: hitPct != null ? `${hitPct}%` : "—",
                        accent: hitPct != null && hitPct >= 70 ? "good" : hitPct != null && hitPct < 40 ? "warn" : "neutral",
                      },
                    ]}
                  />
                  {(resolver?.forward_zones || []).filter((z) => z.zone !== ".").length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Forward zone</p>
                      <ul className="text-xs font-mono space-y-1 rounded border p-2 max-h-32 overflow-y-auto">
                        {(resolver?.forward_zones || [])
                          .filter((z) => z.zone !== ".")
                          .map((z) => (
                            <li key={z.zone}>
                              {z.zone} → {z.targets.join(", ")}
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        </TabsContent>

        <TabsContent value="zone" className="mt-4">
          <DnsSection isAdmin={isAdmin} active={dnsActive} />
        </TabsContent>

        <TabsContent value="filtro" className="mt-4">
          <AdblockPanel
            isAdmin={isAdmin}
            active={adblockActive}
            adblock={adblock}
            adblockRules={adblockRules}
            onRefresh={refreshAll}
          />
        </TabsContent>

        <TabsContent value="resolver" className="mt-4">
          <ResolverPanel
            isAdmin={isAdmin}
            active={resolverActive}
            resolver={resolver}
            onRefresh={refreshAll}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

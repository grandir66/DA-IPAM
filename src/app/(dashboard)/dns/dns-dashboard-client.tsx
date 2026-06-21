"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { RefreshCw, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  AdBlockRules,
  AdBlockStats,
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
import { cn } from "@/lib/utils";
import { AdblockPanel } from "@/app/(dashboard)/network-services/adblock-panel";

interface Props {
  apiBase: string;
  isAdmin: boolean;
  initialResolver: ResolverStatus | null;
  initialAdblock: AdBlockStats | null;
  initialError: string | null;
  adblockActive: boolean;
  resolverActive: boolean;
}

export function DnsDashboardClient({
  apiBase,
  isAdmin,
  initialResolver,
  initialAdblock,
  initialError,
  adblockActive,
  resolverActive,
}: Props) {
  const [resolver, setResolver] = useState(initialResolver);
  const [adblock, setAdblock] = useState(initialAdblock);
  const [adblockRules, setAdblockRules] = useState<AdBlockRules | null>(null);
  const [filteringEnabled, setFilteringEnabled] = useState<boolean | null>(null);
  const [protectionEnabled, setProtectionEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState(initialError);
  const [configOpen, setConfigOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function refreshAll() {
    try {
      const r = await fetch("/api/network-services/status", { cache: "no-store" });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || data.message || "status fetch failed");
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
          <h1 className="text-2xl font-semibold">DNS &amp; Filtri</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Filtro DNS e resolver ricorsivo — VM <code>{apiBase}</code>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/network-services"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex items-center")}
          >
            Network Services
            <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
          </Link>
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
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <DnsChainFlow
        apiBase={apiBase}
        adblockActive={adblockActive}
        resolverActive={resolverActive}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Filtro DNS (AdGuard) */}
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
              {protectionEnabled === false && (
                <Badge variant="outline" className="border-amber-500 text-amber-700">
                  Protezione off
                </Badge>
              )}
            </div>
          </div>

          {!adblockActive && (
            <div className="rounded border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-100">
              Filtro DNS disabilitato. Abilitalo da{" "}
              <Link href="/network-services" className="underline font-medium">
                Network Services → Panorama
              </Link>
              .
            </div>
          )}

          {adblockActive && (
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
                  {
                    label: "Latenza media",
                    value: formatLatencySeconds(adblock?.avg_processing_time),
                  },
                ]}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <DnsTopTable
                  title="Top client (query)"
                  empty="Nessun dato ancora"
                  rows={topClients}
                  total={queries}
                />
                <DnsTopTable
                  title="Top domini bloccati"
                  empty="Nessun blocco registrato"
                  rows={topBlocked}
                  total={blocked}
                />
              </div>
              {adblockRules?.filters_count != null && (
                <p className="text-xs text-muted-foreground">
                  {adblockRules.filters_count} liste filtro attive
                  {adblockRules.rules?.length
                    ? ` · ${adblockRules.rules.length} regole custom`
                    : ""}
                </p>
              )}
            </>
          )}
        </section>

        {/* Resolver (Unbound) */}
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

          {!resolverActive && (
            <div className="rounded border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-900 dark:text-amber-100">
              Resolver disabilitato. Abilitalo da{" "}
              <Link href="/network-services" className="underline font-medium">
                Network Services → Panorama
              </Link>
              .
            </div>
          )}

          {resolverActive && (
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

      <Collapsible open={configOpen} onOpenChange={setConfigOpen}>
        <CollapsibleTrigger
          className={cn(
            buttonVariants({ variant: "outline" }),
            "w-full justify-between",
          )}
        >
          <span>Configurazione avanzata{!isAdmin ? " (sola lettura)" : ""}</span>
          {configOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-6">
          <AdblockPanel
            isAdmin={isAdmin}
            active={adblockActive}
            adblock={adblock}
            adblockRules={adblockRules}
            onRefresh={refreshAll}
          />
          <ResolverPanel
            isAdmin={isAdmin}
            active={resolverActive}
            resolver={resolver}
            onRefresh={refreshAll}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

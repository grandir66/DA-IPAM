"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Loader2, Globe, ServerCog, ExternalLink } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DnsDashboardClient } from "./dns-dashboard-client";
import type { AdBlockStats, BridgeStatus, ResolverStatus } from "@/lib/network-services/client";

interface SetupState {
  installed: boolean;
  configured: boolean;
  apiUrl: string;
  hasToken: boolean;
}

export default function DnsPage() {
  const session = useSession();
  const role = (session.data?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin" || role === "superadmin";

  const [loading, setLoading] = useState(true);
  const [setupState, setSetupState] = useState<SetupState | null>(null);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [resolver, setResolver] = useState<ResolverStatus | null>(null);
  const [adblock, setAdblock] = useState<AdBlockStats | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const r = await fetch("/api/network-services/setup", { cache: "no-store" });
        if (r.status === 401) {
          if (!cancelled) {
            setSetupState({ installed: false, configured: false, apiUrl: "", hasToken: false });
            setLoading(false);
          }
          return;
        }
        const data = (await r.json()) as SetupState;
        if (cancelled) return;
        setSetupState(data);

        if (data.installed && data.configured) {
          const sr = await fetch("/api/network-services/status", { cache: "no-store" });
          const sdata = await sr.json();
          if (cancelled) return;
          if (sdata.ok) {
            setBridge(sdata.bridge);
            setResolver(sdata.resolver);
            setAdblock(sdata.adblock);
          } else {
            setStatusError(sdata.error ?? sdata.message ?? "Bridge non raggiungibile");
          }
        }
      } catch (e) {
        if (!cancelled) setStatusError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!setupState?.installed || !setupState.configured) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <Globe className="h-7 w-7 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">DNS &amp; Filtri</h1>
            <p className="text-sm text-muted-foreground">
              Filtro DNS (AdGuard) e resolver ricorsivo (Unbound) sulla VM Network Services.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ServerCog className="h-6 w-6 mt-0.5 text-muted-foreground shrink-0" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Modulo non disponibile</h2>
              <p className="text-sm text-muted-foreground">
                La VM Network Services non è configurata su questa appliance. Il modulo viene
                registrato automaticamente dal bundle Deploy-Appliance.
              </p>
              {isAdmin && (
                <Link
                  href="/settings?tab=modules"
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-2 inline-flex items-center")}
                >
                  Impostazioni moduli
                  <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const adblockActive = bridge?.services?.adblock?.active === "active";
  const resolverActive = bridge?.services?.resolver?.active === "active";

  return (
    <DnsDashboardClient
      apiBase={setupState.apiUrl}
      isAdmin={isAdmin}
      initialResolver={resolver}
      initialAdblock={adblock}
      initialError={statusError}
      adblockActive={adblockActive}
      resolverActive={resolverActive}
    />
  );
}

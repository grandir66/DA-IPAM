"use client";

/**
 * Network Services — UI per gestione DNS+DHCP+AdBlock+Resolver erogati dalla
 * VM dedicata (ADR-0007).
 *
 * Pattern: la config (URL bridge + token Bearer) è popolata AUTOMATICAMENTE
 * dal bundle Deploy-Appliance durante l'install (vedi lib/connect.sh →
 * connect_install_network_services). Niente wizard manuale: se il modulo
 * non è configurato, è perché la VM net-services non è installata.
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Loader2, Network, ServerCog } from "lucide-react";
import { NetworkServicesClient } from "./network-services-client";
import type {
  BridgeStatus,
  ResolverStatus,
  AdBlockStats,
} from "@/lib/network-services/client";

interface SetupState {
  installed: boolean;
  configured: boolean;
  apiUrl: string;
  hasToken: boolean;
}

export default function NetworkServicesPage() {
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
        if (r.status === 401 || r.status === 403) {
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
            setStatusError(sdata.error ?? "Bridge non raggiungibile");
          }
        }
      } catch (e) {
        if (!cancelled) {
          setStatusError(String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Non installato → empty state informativo (no wizard)
  if (!setupState || !setupState.installed || !setupState.configured) {
    return (
      <div className="container mx-auto p-6 max-w-3xl">
        <div className="flex items-center gap-3 mb-6">
          <Network className="h-7 w-7 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Network Services</h1>
            <p className="text-sm text-muted-foreground">
              DNS, DHCP, AdBlock e Resolver erogati da una VM dedicata (ADR-0007).
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 space-y-4">
          <div className="flex items-start gap-3">
            <ServerCog className="h-6 w-6 mt-0.5 text-muted-foreground shrink-0" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Modulo non disponibile</h2>
              <p className="text-sm text-muted-foreground">
                La VM Network Services (`192.168.99.52`) non è installata su questa
                appliance, oppure la configurazione del bundle Deploy-Appliance non
                ha ancora registrato il modulo in DA-IPAM.
              </p>
              <p className="text-sm text-muted-foreground">
                {"Il modulo viene popolato "}
                <strong>automaticamente</strong>
                {" "}durante l&apos;install dell&apos;appliance Domarc se è impostato
                il flag <code className="px-1 rounded bg-muted">install_net_services: local</code>{" "}
                in <code className="px-1 rounded bg-muted">/etc/da-appliance/config.yaml</code>.
              </p>
              {isAdmin && (
                <p className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                  Recovery manuale (solo se il bundle ha fallito il registration):
                  <br />
                  <code className="block mt-1 p-2 rounded bg-muted text-foreground/80 font-mono text-[11px]">
                    ssh root@&lt;PVE&gt; &apos;cd /opt/deploy-appliance && ./deploy.sh connect&apos;
                  </code>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Installato + configurato → dashboard
  return (
    <NetworkServicesClient
      apiBase={setupState.apiUrl}
      initialBridge={bridge}
      initialResolver={resolver}
      initialAdblock={adblock}
      initialError={statusError}
      isAdmin={isAdmin}
    />
  );
}

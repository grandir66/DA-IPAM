"use client";

/**
 * Network Services — UI per gestione DNS+DHCP+AdBlock+Resolver erogati dalla
 * VM dedicata (ADR-0007).
 *
 * Pattern Patch Management (client-only):
 * - fetch /api/network-services/setup → stato feature
 * - se non installata: setup wizard
 * - se installata: fetch /api/network-services/status → dashboard
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { NetworkServicesSetup } from "./network-services-setup";
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
        // Stato setup feature (richiede admin per GET /setup)
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

        // Se installato + configurato → carica status dashboard
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

  if (!setupState) {
    return (
      <div className="container mx-auto p-6 text-sm text-red-600">
        Errore caricamento stato modulo.
      </div>
    );
  }

  // Stato 1: feature non installata → setup wizard
  if (!setupState.installed) {
    return <NetworkServicesSetup isAdmin={isAdmin} initialApiUrl="" hasToken={false} />;
  }

  // Stato 2: installata ma config mancante → re-config
  if (!setupState.configured) {
    return (
      <NetworkServicesSetup
        isAdmin={isAdmin}
        initialApiUrl={setupState.apiUrl}
        hasToken={setupState.hasToken}
        installedButMissingConfig
      />
    );
  }

  // Stato 3: installata + configurata → dashboard
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

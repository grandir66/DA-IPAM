"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { RefreshCw, Power, ExternalLink } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { BridgeStatus } from "@/lib/network-services/client";
import { DhcpScopesPanel } from "@/components/dhcp/dhcp-scopes-panel";
import { DhcpLeasesPanel } from "@/components/dhcp/dhcp-leases-panel";
import { DhcpReservationsPanel } from "@/components/dhcp/dhcp-reservations-panel";

type DhcpTab = "panorama" | "scope" | "lease" | "statiche" | "sorgenti";

interface Props {
  apiBase: string;
  isAdmin: boolean;
  initialBridge: BridgeStatus | null;
  initialError: string | null;
}

const TAB_VALUES: DhcpTab[] = ["panorama", "scope", "lease", "statiche", "sorgenti"];

function parseTab(raw: string | null): DhcpTab {
  if (raw && TAB_VALUES.includes(raw as DhcpTab)) return raw as DhcpTab;
  return "panorama";
}

export function DhcpDashboardClient({ apiBase, isAdmin, initialBridge, initialError }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<DhcpTab>(() => parseTab(searchParams.get("tab")));

  const [bridge, setBridge] = useState(initialBridge);
  const [leaseCount, setLeaseCount] = useState(0);
  const [reservationCount, setReservationCount] = useState(0);
  const [subnetCount, setSubnetCount] = useState(0);
  const [error, setError] = useState(initialError);
  const [pending, startTransition] = useTransition();
  const [reservationRefresh, setReservationRefresh] = useState(0);

  const dhcpActive = bridge?.services?.dhcp?.active === "active";

  useEffect(() => {
    setTab(parseTab(searchParams.get("tab")));
  }, [searchParams]);

  function selectTab(next: DhcpTab) {
    if (next === "sorgenti") {
      router.push("/dhcp/sources");
      return;
    }
    setTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "panorama") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(qs ? `/dhcp?${qs}` : "/dhcp", { scroll: false });
  }

  async function refreshAll() {
    try {
      const sr = await fetch("/api/network-services/status", { cache: "no-store" });
      const sdata = await sr.json();
      if (!sdata.ok) throw new Error(sdata.error || sdata.message || "status fetch failed");
      setBridge(sdata.bridge);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
    try {
      const dr = await fetch("/api/network-services/dhcp", { cache: "no-store" });
      const ddata = await dr.json();
      if (ddata.ok) {
        setLeaseCount(ddata.leases?.count ?? ddata.leases?.leases?.length ?? 0);
        setReservationCount(
          ddata.reservations?.count ?? ddata.reservations?.reservations?.length ?? 0,
        );
      }
    } catch {
      /* ignore */
    }
    try {
      const sub = await fetch("/api/network-services/dhcp/subnets", { cache: "no-store" });
      const sdata = await sub.json();
      if (sdata.ok) setSubnetCount(sdata.count ?? sdata.subnets?.length ?? 0);
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

  async function toggleDhcp(enable: boolean) {
    startTransition(async () => {
      const r = await fetch("/api/network-services/toggle/dhcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable }),
      });
      const data = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || data.ok === false) {
        toast.error(data.error || r.statusText);
        await refreshAll();
        return;
      }
      toast.success(`DHCP ${enable ? "abilitato" : "disabilitato"}`);
      await refreshAll();
    });
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">DHCP</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scope, lease dinamici e IP statici — VM <code>{apiBase}</code>
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

      <Tabs value={tab} onValueChange={(v) => selectTab(v as DhcpTab)}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="panorama">Panorama</TabsTrigger>
          <TabsTrigger value="scope">Scope</TabsTrigger>
          <TabsTrigger value="lease">Lease dinamici</TabsTrigger>
          <TabsTrigger value="statiche">IP statici</TabsTrigger>
          <TabsTrigger value="sorgenti">Sorgenti esterne</TabsTrigger>
        </TabsList>

        <TabsContent value="panorama" className="space-y-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div>
              <p className="font-medium">Servizio Kea DHCP4</p>
              <Badge variant={dhcpActive ? "default" : "secondary"} className="mt-1">
                {dhcpActive ? "Attivo" : "Off"}
              </Badge>
            </div>
            {isAdmin && (
              <Button
                size="sm"
                variant={dhcpActive ? "destructive" : "default"}
                onClick={() => toggleDhcp(!dhcpActive)}
                disabled={pending}
              >
                <Power className="h-3.5 w-3.5 mr-1.5" />
                {dhcpActive ? "Disabilita" : "Abilita"}
              </Button>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Scope configurati</p>
              <p className="text-2xl font-semibold mt-1">{subnetCount}</p>
              <Link href="/dhcp?tab=scope" className="text-xs text-primary hover:underline">
                Gestisci scope →
              </Link>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">Lease attivi</p>
              <p className="text-2xl font-semibold mt-1">{leaseCount}</p>
              <Link href="/dhcp?tab=lease" className="text-xs text-primary hover:underline">
                Vedi lease →
              </Link>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-muted-foreground">IP statici</p>
              <p className="text-2xl font-semibold mt-1">{reservationCount}</p>
              <Link href="/dhcp?tab=statiche" className="text-xs text-primary hover:underline">
                Gestisci statici →
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <p className="font-medium">Lease da router MikroTik / Active Directory</p>
            <p className="text-muted-foreground mt-1">
              Sincronizzazione inventario IPAM da sorgenti esterne (non Kea).
            </p>
            <Link
              href="/dhcp/sources"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3 inline-flex items-center")}
            >
              Tabella sorgenti esterne
              <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </div>
        </TabsContent>

        <TabsContent value="scope" className="mt-4">
          <DhcpScopesPanel isAdmin={isAdmin} active={dhcpActive} />
        </TabsContent>

        <TabsContent value="lease" className="mt-4">
          <DhcpLeasesPanel
            isAdmin={isAdmin}
            active={dhcpActive}
            onReservationCreated={() => {
              setReservationRefresh((n) => n + 1);
              void refreshAll();
            }}
          />
        </TabsContent>

        <TabsContent value="statiche" className="mt-4">
          <DhcpReservationsPanel
            isAdmin={isAdmin}
            active={dhcpActive}
            refreshKey={reservationRefresh}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

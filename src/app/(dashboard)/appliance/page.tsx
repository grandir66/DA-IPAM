"use client";

/**
 * Appliance — Vista unificata dei moduli installati sulla mini-PC Domarc.
 *
 * Fonti di verità (joinate a runtime in /api/appliance/modules):
 * - hub.system_credentials (bootstrap launchpad: URL UI LAN-accessible)
 * - hub.integrations_config (URL backend interno per sync)
 * - hub.tenant_features (modulo network_services: installato/configurato)
 *
 * F1: read-only — list moduli installati con URL corretti.
 * F2 (ADR-0009): bottone "Installa modulo" → chiama appliance-agent sul PVE.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  ExternalLink,
  ServerCog,
  Shield,
  Activity,
  Network as NetworkIcon,
  Eye,
  Database,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ApplianceModule {
  key: string;
  label: string;
  category: "core" | "siem" | "logs" | "nms" | "network" | "va";
  description: string;
  installed: boolean;
  uiUrl: string | null;
  apiUrl: string | null;
  version: string | null;
  note?: string;
}

const CATEGORY_ICONS: Record<string, typeof Shield> = {
  core: ServerCog,
  siem: Shield,
  logs: Eye,
  nms: Activity,
  network: NetworkIcon,
  va: Database,
};

const CATEGORY_LABELS: Record<string, string> = {
  core: "Core",
  siem: "SIEM",
  logs: "Log management",
  nms: "Network monitoring",
  network: "Network services",
  va: "Vulnerability assessment",
};

const CATEGORY_BADGE: Record<string, string> = {
  core: "bg-blue-100 text-blue-700",
  siem: "bg-red-100 text-red-700",
  logs: "bg-purple-100 text-purple-700",
  nms: "bg-green-100 text-green-700",
  network: "bg-amber-100 text-amber-700",
  va: "bg-rose-100 text-rose-700",
};

export default function AppliancePage() {
  const [modules, setModules] = useState<ApplianceModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/appliance/modules", { cache: "no-store" });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error ?? "fetch failed");
      setModules(data.modules);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const installed = modules.filter((m) => m.installed);
  const notInstalled = modules.filter((m) => !m.installed);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Appliance Domarc</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Moduli installati su questa mini-PC. URL e API sono risolti automaticamente
            dal bundle al termine dell&apos;install.
          </p>
        </div>
        <Button variant="outline" onClick={() => load()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Installati ({installed.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {installed.map((m) => (
            <ModuleCard key={m.key} mod={m} />
          ))}
        </div>
      </div>

      {notInstalled.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Non installati ({notInstalled.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {notInstalled.map((m) => (
              <ModuleCard key={m.key} mod={m} />
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4" />
            Installazione/modifica moduli
          </CardTitle>
          <CardDescription>
            La gestione moduli avviene da PVE host via bundle Deploy-Appliance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            Per installare un modulo mancante o re-applicare la configurazione:
          </p>
          <pre className="rounded bg-muted p-3 text-xs font-mono overflow-x-auto">
{`ssh root@<PVE>
cd /opt/deploy-appliance

# Modifica config (es. attiva un modulo)
nano /etc/da-appliance/config.yaml      # install_wazuh: local

# Re-applica install
./deploy.sh install --yes

# Oppure solo re-registra le integrazioni in DA-IPAM
./deploy.sh connect`}
          </pre>
          <p className="text-xs text-muted-foreground pt-2 border-t">
            Roadmap: <strong>F2 — Install via UI</strong>. ADR-0009 prevede un{" "}
            <code>appliance-agent</code> FastAPI sul PVE host (porta 8444 con token
            Bearer) chiamato da DA-IPAM per triggerare install/uninstall moduli in
            modo trasparente.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ModuleCard({ mod }: { mod: ApplianceModule }) {
  const Icon = CATEGORY_ICONS[mod.category] ?? Shield;
  const badgeClass = CATEGORY_BADGE[mod.category] ?? "bg-gray-100 text-gray-700";
  const internalUiUrl = mod.uiUrl?.startsWith("/") ?? false;

  return (
    <Card className={mod.installed ? "" : "opacity-60"}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <Icon className="h-5 w-5 text-muted-foreground" />
          {mod.installed ? (
            <Badge className="bg-green-100 text-green-700 hover:bg-green-100" variant="outline">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Installato
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              <XCircle className="h-3 w-3 mr-1" />
              Non installato
            </Badge>
          )}
        </div>
        <CardTitle className="text-base mt-2">{mod.label}</CardTitle>
        <CardDescription className="text-xs">
          <Badge variant="secondary" className={`mb-1.5 text-[10px] ${badgeClass} pointer-events-none`}>
            {CATEGORY_LABELS[mod.category]}
          </Badge>
          <div>{mod.description}</div>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {mod.uiUrl && mod.installed && (
          internalUiUrl ? (
            <Link
              href={mod.uiUrl}
              className="flex items-center gap-1.5 text-primary hover:underline font-medium"
            >
              <ExternalLink className="h-3 w-3" />
              Apri UI (interna)
            </Link>
          ) : (
            <a
              href={mod.uiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-primary hover:underline font-medium"
            >
              <ExternalLink className="h-3 w-3" />
              Apri UI in nuova tab
            </a>
          )
        )}
        {mod.apiUrl && (
          <div className="text-muted-foreground">
            <span className="font-medium">API:</span>{" "}
            <code className="text-[10px] break-all">{mod.apiUrl}</code>
          </div>
        )}
        {mod.version && (
          <div className="text-muted-foreground">
            <span className="font-medium">Versione:</span>{" "}
            <code className="text-[10px]">{mod.version}</code>
          </div>
        )}
        {mod.note && (
          <p className="text-amber-700 dark:text-amber-400 text-[11px] mt-2 pt-2 border-t">
            {mod.note}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

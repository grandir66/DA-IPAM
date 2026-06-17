"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Network as NetworkIcon,
  CheckCircle2,
  XCircle,
  Loader2,
  Shield,
  Settings as SettingsIcon,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface Props {
  isAdmin: boolean;
  initialApiUrl: string;
  hasToken: boolean;
  installedButMissingConfig?: boolean;
}

interface ProbeResult {
  ok: boolean;
  stage?: "health" | "auth";
  version?: string;
  error?: string;
  message?: string;
}

export function NetworkServicesSetup({
  isAdmin,
  initialApiUrl,
  installedButMissingConfig = false,
}: Props) {
  const router = useRouter();
  const [apiUrl, setApiUrl] = useState(initialApiUrl || "https://192.168.99.52:8443");
  const [apiToken, setApiToken] = useState("");
  const [probing, setProbing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  async function testConnection() {
    if (!apiUrl) {
      toast.error("Inserisci l'URL del bridge");
      return;
    }
    setProbing(true);
    setProbeResult(null);
    try {
      const r = await fetch("/api/network-services/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl, apiToken: apiToken || undefined }),
      });
      const data = (await r.json()) as ProbeResult;
      setProbeResult(data);
      if (data.ok) toast.success(data.message ?? "Test connessione OK");
      else toast.error(data.error ?? "Test fallito");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setProbeResult({ ok: false, error: errMsg });
      toast.error(`Errore: ${errMsg}`);
    } finally {
      setProbing(false);
    }
  }

  async function install() {
    if (!apiUrl || !apiToken) {
      toast.error("Inserisci URL e token");
      return;
    }
    setInstalling(true);
    try {
      const r = await fetch("/api/network-services/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiUrl, apiToken }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? r.statusText);
      toast.success(data.message ?? "Modulo installato");
      router.refresh();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      toast.error(`Install fallita: ${errMsg}`);
    } finally {
      setInstalling(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-semibold mb-4">Network Services</h1>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Il modulo Network Services non è ancora installato per questo tenant.
            Solo un amministratore può installarlo.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <NetworkIcon className="h-7 w-7 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold">Network Services</h1>
          <p className="text-sm text-muted-foreground">
            DNS, DHCP, AdBlock e Resolver erogati da una VM dedicata (ADR-0007).
          </p>
        </div>
      </div>

      {installedButMissingConfig && (
        <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          Il modulo è installato ma la config è mancante o corrotta. Re-inserisci URL e token.
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Configurazione bridge</CardTitle>
              <CardDescription>
                URL del bridge FastAPI sulla VM dedicata + token Bearer condiviso.
              </CardDescription>
            </div>
            <Badge variant="secondary">Non installato</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="apiUrl">URL bridge (HTTPS)</Label>
            <Input
              id="apiUrl"
              type="url"
              placeholder="https://192.168.99.52:8443"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Esempio appliance Domarc consolidated: <code>https://192.168.99.52:8443</code>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="apiToken">Bearer token</Label>
            <Input
              id="apiToken"
              type="password"
              placeholder="64 caratteri hex"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Recuperabile sul PVE host:{" "}
              <code>cat /etc/da-appliance/secrets/net-services.token</code>
            </p>
          </div>

          {probeResult && (
            <div
              className={`rounded border p-3 text-sm ${
                probeResult.ok
                  ? "border-green-300 bg-green-50 text-green-900"
                  : "border-red-300 bg-red-50 text-red-900"
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {probeResult.ok ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {probeResult.ok
                  ? `Bridge raggiungibile ${probeResult.version ? `(v${probeResult.version})` : ""}`
                  : `Fallito al stage: ${probeResult.stage ?? "unknown"}`}
              </div>
              {probeResult.error && (
                <div className="mt-1 text-xs">{probeResult.error}</div>
              )}
              {probeResult.message && (
                <div className="mt-1 text-xs">{probeResult.message}</div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={probing || !apiUrl}
            >
              {probing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Test in corso...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Test connessione
                </>
              )}
            </Button>
            <Button
              onClick={install}
              disabled={installing || !apiUrl || !apiToken || (probeResult !== null && !probeResult.ok)}
            >
              {installing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Installazione...
                </>
              ) : (
                <>
                  <SettingsIcon className="h-4 w-4 mr-2" />
                  Installa modulo
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Il token viene cifrato AES-GCM at-rest (storage{" "}
            <code>hub.tenant_features.config_json</code>). Non è mai mostrato in chiaro
            dopo il salvataggio.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Sezione aggiuntiva visibile nella dashboard (network-services-client.tsx)
 * per disinstallare o modificare config.
 */
export function NetworkServicesSettings({ apiUrl }: { apiUrl: string }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function uninstall() {
    if (
      !confirm(
        "Disinstallare il modulo Network Services? La configurazione sarà rimossa. I servizi sottostanti sulla VM bridge non vengono toccati.",
      )
    ) {
      return;
    }
    setRemoving(true);
    try {
      const r = await fetch("/api/network-services/setup", { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? r.statusText);
      toast.success(data.message ?? "Modulo disinstallato");
      router.refresh();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      toast.error(`Disinstall fallita: ${errMsg}`);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Configurazione modulo</CardTitle>
        <CardDescription>
          Bridge corrente: <code>{apiUrl}</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={uninstall} disabled={removing}>
          {removing ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-2" />
          )}
          Disinstalla modulo
        </Button>
      </CardContent>
    </Card>
  );
}

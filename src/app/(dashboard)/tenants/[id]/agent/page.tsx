"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, KeyRound, Save, ServerCog, Copy, ShieldAlert, PlugZap, CheckCircle2, XCircle, Terminal, Upload } from "lucide-react";
import { toast } from "sonner";

interface AgentConfigResponse {
  agent_mode: "local" | "remote";
  agent_hostname: string | null;
  agent_port: number;
  agent_version: string | null;
  agent_last_seen_at: string | null;
  has_token: boolean;
}

interface TenantInfo {
  codice_cliente: string;
  ragione_sociale: string;
}

type TestResult =
  | { ok: true; latency_ms: number; label: string; scopes: string[]; tenant_code: string }
  | {
      ok: false;
      latency_ms: number;
      error_code: string;
      error_message: string;
      status?: number;
      retriable?: boolean;
    };

export default function TenantAgentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === "admin" || role === "superadmin";

  const tenantId = params?.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [mode, setMode] = useState<"local" | "remote">("local");
  const [hostname, setHostname] = useState("");
  const [port, setPort] = useState<number>(8443);
  const [config, setConfig] = useState<AgentConfigResponse | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [tokenMode, setTokenMode] = useState<"generate" | "import">("generate");
  const [importToken, setImportToken] = useState("");
  const [importing, setImporting] = useState(false);
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);

  const loadConfig = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agent`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Impossibile caricare la configurazione agente");
        setLoading(false);
        return;
      }
      const data = (await res.json()) as AgentConfigResponse;
      setConfig(data);
      setMode(data.agent_mode);
      setHostname(data.agent_hostname ?? "");
      setPort(data.agent_port ?? 8443);
    } catch (e) {
      console.error(e);
      toast.error("Errore di rete nel caricamento configurazione");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agent`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_mode: mode,
          agent_hostname: hostname.trim() || null,
          agent_port: port,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Errore nel salvataggio");
        return;
      }
      const data = (await res.json()) as AgentConfigResponse;
      setConfig(data);
      toast.success("Configurazione agente salvata");
    } catch (e) {
      console.error(e);
      toast.error("Errore di rete nel salvataggio");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateToken = async () => {
    if (!tenantId) return;
    if (!confirm("Generare un nuovo token? Il token precedente verrà invalidato al prossimo deploy della config sull'agente.")) {
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agent/token`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Errore nella generazione del token");
        return;
      }
      const data = (await res.json()) as { token: string };
      setNewToken(data.token);
      await loadConfig();
      toast.success("Nuovo token generato. Copialo ora.");
    } catch (e) {
      console.error(e);
      toast.error("Errore di rete nella generazione del token");
    } finally {
      setGenerating(false);
    }
  };

  const handleImportToken = async () => {
    if (!tenantId) return;
    const trimmed = importToken.trim();
    if (trimmed.length < 16) {
      toast.error("Token troppo corto (almeno 16 caratteri).");
      return;
    }
    if (!confirm("Importare questo token? Sovrascriverà l'hash esistente. L'agente deve già avere il suo hash bcrypt corrispondente.")) {
      return;
    }
    setImporting(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agent/token/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Errore nell'import");
        return;
      }
      setImportToken("");
      setNewToken(null);
      await loadConfig();
      toast.success("Token importato. Verifica con Testa connessione.");
    } catch (e) {
      console.error(e);
      toast.error("Errore di rete nell'import");
    } finally {
      setImporting(false);
    }
  };

  const handleTestConnection = async () => {
    if (!tenantId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agent/test`, { method: "POST" });
      const data = (await res.json()) as TestResult | { error?: string };
      if ("error" in data && data.error) {
        toast.error(data.error);
        return;
      }
      const result = data as TestResult;
      setTestResult(result);
      if (result.ok) {
        toast.success(`Agente raggiungibile (${result.latency_ms} ms)`);
      } else {
        toast.error(`Test fallito: ${result.error_message}`);
      }
    } catch (e) {
      console.error(e);
      toast.error("Errore di rete durante il test");
    } finally {
      setTesting(false);
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      toast.success("Token copiato negli appunti");
    } catch {
      toast.error("Impossibile copiare automaticamente: selezionalo manualmente");
    }
  };

  const formatLastSeen = (iso: string | null): string => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleString("it-IT");
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-muted-foreground">Caricamento configurazione…</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/tenants")}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Clienti
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="h-5 w-5" />
            Agente remoto
          </CardTitle>
          <CardDescription>
            Modalità di esecuzione delle operazioni di rete per questo cliente. In modalità{" "}
            <code>local</code> tutto gira sull&apos;hub. In modalità <code>remote</code> le richieste vengono
            inoltrate a un agente Python installato presso il cliente, raggiunto via Tailscale.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>Modalità</Label>
            <div className="flex gap-3">
              <Button
                variant={mode === "local" ? "default" : "outline"}
                onClick={() => setMode("local")}
                disabled={!canEdit}
              >
                Local (hub)
              </Button>
              <Button
                variant={mode === "remote" ? "default" : "outline"}
                onClick={() => setMode("remote")}
                disabled={!canEdit}
              >
                Remote (agente Tailscale)
              </Button>
            </div>
            {mode === "remote" && (
              <p className="text-xs text-muted-foreground">
                Le scansioni di rete (ping, nmap discover, nmap port-scan TCP+UDP) verranno
                instradate via Tailscale all&apos;agente Python del cliente. Salva la
                configurazione, poi premi <em>Testa connessione</em> per verificare.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="hostname">Hostname Tailscale (MagicDNS)</Label>
              <Input
                id="hostname"
                placeholder="es. agent-cliente-001"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                Nome breve del nodo Tailscale dove gira l&apos;agente. Solo MagicDNS short name, senza dominio.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">Porta</Label>
              <Input
                id="port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value) || 8443)}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="flex justify-between items-center gap-2">
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={testing || mode !== "remote" || !config?.has_token || !hostname.trim()}
              title={
                mode !== "remote"
                  ? "Solo modalità remote"
                  : !config?.has_token
                    ? "Manca il token bearer"
                    : !hostname.trim()
                      ? "Manca l'hostname"
                      : "Esegue GET /whoami sull'agente via Tailscale"
              }
            >
              <PlugZap className="h-4 w-4 mr-1.5" />
              {testing ? "Testando…" : "Testa connessione"}
            </Button>
            <Button onClick={handleSave} disabled={!canEdit || saving}>
              <Save className="h-4 w-4 mr-1.5" />
              {saving ? "Salvataggio…" : "Salva configurazione"}
            </Button>
          </div>

          {testResult && (
            <div
              className={`rounded border p-3 text-sm space-y-1 ${
                testResult.ok
                  ? "border-green-500/40 bg-green-50 dark:bg-green-950/30"
                  : "border-destructive/40 bg-destructive/5"
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {testResult.ok ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-700 dark:text-green-300" />
                    <span>Agente raggiungibile</span>
                    <Badge variant="outline" className="ml-2">{testResult.latency_ms} ms</Badge>
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span>Test fallito</span>
                    <Badge variant="outline" className="ml-2">{testResult.error_code}</Badge>
                  </>
                )}
              </div>
              {testResult.ok ? (
                <>
                  <p>Token label: <code>{testResult.label}</code></p>
                  <p>Scopes: <code>{testResult.scopes.join(", ") || "—"}</code></p>
                  <p>Tenant code dell&apos;agente: <code>{testResult.tenant_code || "—"}</code></p>
                </>
              ) : (
                <p className="text-muted-foreground">{testResult.error_message}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Token bearer
          </CardTitle>
          <CardDescription>
            Token usato dall&apos;hub per autenticarsi all&apos;agente. La generazione di un nuovo
            token sovrascrive il precedente. Il plaintext viene mostrato una sola volta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant={config?.has_token ? "default" : "secondary"}>
              {config?.has_token ? "Token configurato" : "Nessun token"}
            </Badge>
            {canEdit && (
              <div className="flex gap-2 items-center">
                <Button
                  variant={tokenMode === "generate" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTokenMode("generate")}
                >
                  Genera nuovo
                </Button>
                <Button
                  variant={tokenMode === "import" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTokenMode("import")}
                >
                  Importa esistente
                </Button>
              </div>
            )}
          </div>

          {canEdit && tokenMode === "generate" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Genera un nuovo token plaintext. L&apos;hub ne salva hash bcrypt + ciphertext;
                il plaintext lo vedi una volta sola sotto.
              </p>
              <Button variant="outline" onClick={handleGenerateToken} disabled={generating}>
                <KeyRound className="h-4 w-4 mr-1.5" />
                {generating ? "Generazione…" : "Genera nuovo token"}
              </Button>
            </div>
          )}

          {canEdit && tokenMode === "import" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Incolla un token plaintext esistente (es. quello già configurato lato agent
                in <code>/etc/da-invent-agent/config.yml</code>). L&apos;hub lo cifra e ne calcola
                l&apos;hash, ma <strong>non aggiorna l&apos;agent</strong>: assicurati che l&apos;agent abbia
                già lo stesso hash.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  type="password"
                  placeholder="Incolla qui il token plaintext (min 16 caratteri)"
                  value={importToken}
                  onChange={(e) => setImportToken(e.target.value)}
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  onClick={handleImportToken}
                  disabled={importing || importToken.trim().length < 16}
                >
                  <Upload className="h-4 w-4 mr-1.5" />
                  {importing ? "Import…" : "Importa"}
                </Button>
              </div>
            </div>
          )}

          {newToken && (
            <div className="rounded border border-yellow-500/40 bg-yellow-50 dark:bg-yellow-950/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
                <ShieldAlert className="h-4 w-4" />
                <span className="font-medium text-sm">Salva il token ora — non sarà più visibile.</span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={newToken}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button variant="outline" size="icon" onClick={copyToken} title="Copia">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Box "Comando di install" — visibile solo subito dopo generazione */}
      {newToken && mode === "remote" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Comando di install / aggiornamento agente
            </CardTitle>
            <CardDescription>
              Esegui questo one-liner come <code>root</code> sull&apos;host dove vive (o vivrà) l&apos;agent
              Python. Idempotente: rieseguibile per upgrade o rotazione token.
              Tailscale deve essere già installato e attivo (<code>tailscale up</code>).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">
{`curl -fsSL ${typeof window !== "undefined" ? window.location.origin : "<HUB_URL>"}/agent-install.sh \\
  | TENANT_CODE='${config?.has_token ? "REPLACE_WITH_CODICE_CLIENTE" : "REPLACE_WITH_CODICE_CLIENTE"}' \\
    HUB_URL='${typeof window !== "undefined" ? window.location.origin : "<HUB_URL>"}' \\
    AGENT_TOKEN='${newToken}' \\
    AGENT_PORT='${port}' \\
    bash`}
            </pre>
            <p className="text-xs text-muted-foreground mt-2">
              Sostituisci <code>REPLACE_WITH_CODICE_CLIENTE</code> con il codice cliente del tenant (lo trovi nella lista clienti).
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stato</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <Label className="text-muted-foreground">Versione agente</Label>
              <p className="font-mono">{config?.agent_version ?? "—"}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Ultimo heartbeat</Label>
              <p>{formatLastSeen(config?.agent_last_seen_at ?? null)}</p>
            </div>
            <div>
              <Label className="text-muted-foreground">Modalità attiva</Label>
              <p className="font-mono">{config?.agent_mode ?? "—"}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Versione e heartbeat saranno popolati a partire da Phase 6 (osservabilità). In Phase 1 risultano sempre vuoti.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

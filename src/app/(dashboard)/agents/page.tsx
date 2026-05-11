"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ServerCog,
  PlugZap,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Plus,
  Trash2,
  Copy,
  ShieldAlert,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";

interface AgentRow {
  agent_id: number;
  tenant_id: number;
  codice_cliente: string;
  ragione_sociale: string;
  label: string;
  hostname: string;
  port: number;
  version: string | null;
  last_seen_at: string | null;
  subnet_match: string | null;
  has_token: boolean;
}

interface TenantBrief {
  id: number;
  codice_cliente: string;
  ragione_sociale: string;
}

type TestResult =
  | { ok: true; latency_ms: number; label: string; scopes: string[]; tenant_code: string }
  | { ok: false; latency_ms: number; error_code: string; error_message: string };

type RowState = { status: "idle" } | { status: "testing" } | { status: "done"; result: TestResult };

type WizardStep = "tenant" | "agent" | "token";

const formatLastSeen = (iso: string | null): string => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("it-IT"); } catch { return iso; }
};

export default function AgentsOverviewPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === "admin" || role === "superadmin";

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [tenants, setTenants] = useState<TenantBrief[]>([]);
  const [loading, setLoading] = useState(true);
  const [rowState, setRowState] = useState<Record<number, RowState>>({});

  // Wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>("tenant");
  const [wizMode, setWizMode] = useState<"existing" | "new">("existing");
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [newCodice, setNewCodice] = useState("");
  const [newRagione, setNewRagione] = useState("");
  const [agentLabel, setAgentLabel] = useState("Sede principale");
  const [agentHostname, setAgentHostname] = useState("");
  const [agentPort, setAgentPort] = useState(8443);
  const [agentSubnetMatch, setAgentSubnetMatch] = useState("");
  const [wizSaving, setWizSaving] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState<number | null>(null);
  const [createdTenant, setCreatedTenant] = useState<TenantBrief | null>(null);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [tailscaleAuthKey, setTailscaleAuthKey] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agentsRes, tenantsRes] = await Promise.all([
        fetch("/api/agents"),
        fetch("/api/tenants"),
      ]);
      if (agentsRes.ok) setAgents((await agentsRes.json()) as AgentRow[]);
      if (tenantsRes.ok) {
        const tlist = (await tenantsRes.json()) as Array<TenantBrief & { active?: number }>;
        setTenants(tlist.filter((t) => (t.active ?? 1) === 1));
      }
      setRowState({});
    } catch (e) {
      console.error(e);
      toast.error("Errore di rete nel caricamento");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const testOne = async (agentId: number): Promise<void> => {
    setRowState((s) => ({ ...s, [agentId]: { status: "testing" } }));
    try {
      const res = await fetch(`/api/tenant-agents/${agentId}/test`, { method: "POST" });
      const data = (await res.json()) as TestResult | { error?: string };
      if ("error" in data && data.error) {
        setRowState((s) => ({ ...s, [agentId]: { status: "done", result: { ok: false, latency_ms: 0, error_code: "http_error", error_message: data.error! } } }));
        return;
      }
      setRowState((s) => ({ ...s, [agentId]: { status: "done", result: data as TestResult } }));
    } catch (e) {
      setRowState((s) => ({ ...s, [agentId]: { status: "done", result: { ok: false, latency_ms: 0, error_code: "network_error", error_message: (e as Error).message } } }));
    }
  };

  const testAll = async () => {
    await Promise.allSettled(agents.map((a) => testOne(a.agent_id)));
  };

  const deleteAgent = async (agent: AgentRow) => {
    if (!confirm(`Eliminare l'agente "${agent.label}" del cliente ${agent.codice_cliente}? L'agent remoto continuerà a girare finché non lo fermi manualmente — qui rimuoviamo solo la registrazione hub-side.`)) return;
    try {
      const res = await fetch(`/api/tenant-agents/${agent.agent_id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Errore eliminazione");
        return;
      }
      toast.success("Agente eliminato");
      await load();
    } catch (e) {
      console.error(e);
      toast.error("Errore di rete");
    }
  };

  const openWizard = () => {
    setWizardStep("tenant");
    setWizMode(tenants.length > 0 ? "existing" : "new");
    setSelectedTenantId(tenants.length > 0 ? String(tenants[0].id) : "");
    setNewCodice("");
    setNewRagione("");
    setAgentLabel("Sede principale");
    setAgentHostname("");
    setAgentPort(8443);
    setAgentSubnetMatch("");
    setCreatedAgentId(null);
    setCreatedTenant(null);
    setCreatedToken(null);
    setTailscaleAuthKey("");
    setWizardOpen(true);
  };

  const handleStep1Next = async () => {
    // Risolve / crea il tenant, poi vai a step 2
    if (wizMode === "existing") {
      if (!selectedTenantId) { toast.error("Seleziona un cliente"); return; }
      const t = tenants.find((x) => String(x.id) === selectedTenantId);
      if (!t) { toast.error("Cliente non trovato"); return; }
      setCreatedTenant(t);
      setWizardStep("agent");
      return;
    }
    // Nuovo cliente
    const cod = newCodice.trim();
    const rag = newRagione.trim();
    if (!cod || !rag) { toast.error("Compila codice cliente e ragione sociale"); return; }
    setWizSaving(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codice_cliente: cod, ragione_sociale: rag, active: 1 }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Errore creazione cliente");
        return;
      }
      const t = (await res.json()) as TenantBrief;
      setCreatedTenant(t);
      setWizardStep("agent");
      // refresh tenants list in background
      load();
    } catch (e) {
      console.error(e); toast.error("Errore di rete creazione cliente");
    } finally {
      setWizSaving(false);
    }
  };

  const handleStep2Save = async () => {
    if (!createdTenant) return;
    const hostname = agentHostname.trim();
    const label = agentLabel.trim() || "Sede principale";
    if (!hostname) { toast.error("Inserisci hostname Tailscale"); return; }
    setWizSaving(true);
    try {
      const res = await fetch("/api/tenant-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: createdTenant.id,
          label,
          hostname,
          port: agentPort,
          subnet_match: agentSubnetMatch.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Errore creazione agente");
        return;
      }
      const a = (await res.json()) as { id: number };
      setCreatedAgentId(a.id);

      // Genera token subito
      const tokRes = await fetch(`/api/tenant-agents/${a.id}/token`, { method: "POST" });
      if (!tokRes.ok) {
        const err = await tokRes.json().catch(() => ({ error: "Errore" }));
        toast.error(err.error || "Errore generazione token");
        return;
      }
      const tokBody = (await tokRes.json()) as { token: string };
      setCreatedToken(tokBody.token);
      setWizardStep("token");
      load();
    } catch (e) {
      console.error(e); toast.error("Errore di rete");
    } finally {
      setWizSaving(false);
    }
  };

  const installCommand = useMemo(() => {
    if (!createdToken || !createdTenant) return "";
    const hubOrigin = typeof window !== "undefined" ? window.location.origin : "<HUB_URL>";
    const tsLine = tailscaleAuthKey.trim() ? `\n    TAILSCALE_AUTH_KEY='${tailscaleAuthKey.trim()}' \\` : "";
    return `curl -fsSL ${hubOrigin}/agent-install.sh \\
  | TENANT_CODE='${createdTenant.codice_cliente}' \\
    HUB_URL='${hubOrigin}' \\
    AGENT_TOKEN='${createdToken}' \\
    AGENT_PORT='${agentPort}' \\${tsLine}
    bash`;
  }, [createdToken, createdTenant, agentPort, tailscaleAuthKey]);

  const copyInstall = async () => {
    if (!installCommand) return;
    try { await navigator.clipboard.writeText(installCommand); toast.success("Comando copiato"); }
    catch { toast.error("Copia manuale"); }
  };

  const renderStatus = (entry: AgentRow): React.ReactNode => {
    const rs = rowState[entry.agent_id];
    if (!rs || rs.status === "idle") {
      if (!entry.has_token) return <Badge variant="secondary">no token</Badge>;
      return <Badge variant="outline">non testato</Badge>;
    }
    if (rs.status === "testing") return <Badge variant="outline">testing…</Badge>;
    const r = rs.result;
    if (r.ok) {
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-700">
          <CheckCircle2 className="h-3 w-3 mr-1" /> online · {r.latency_ms} ms
        </Badge>
      );
    }
    return (
      <Badge variant="destructive" title={r.error_message}>
        <XCircle className="h-3 w-3 mr-1" /> {r.error_code}
      </Badge>
    );
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ServerCog className="h-6 w-6" /> Agenti remoti
          </h1>
          <p className="text-sm text-muted-foreground">
            Un cliente può avere più agenti (es. sedi diverse). Ogni agente è un nodo
            Python via Tailscale.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading} title="Ricarica">
            <RotateCcw className="h-4 w-4 mr-1.5" /> Ricarica
          </Button>
          <Button variant="outline" onClick={testAll} disabled={loading || agents.length === 0}>
            <PlugZap className="h-4 w-4 mr-1.5" /> Testa tutti
          </Button>
          {canEdit && (
            <Button onClick={openWizard}>
              <Plus className="h-4 w-4 mr-1.5" /> Nuovo agente
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agenti registrati</CardTitle>
          <CardDescription>
            Una riga per agente. Il bottone <em>Test</em> esegue GET <code>/whoami</code>
            sull&apos;agent via Tailscale.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Caricamento…</p>
          ) : agents.length === 0 ? (
            <p className="text-muted-foreground">
              Nessun agente registrato. Clicca <em>Nuovo agente</em> per crearne uno.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Sede / Label</TableHead>
                  <TableHead>Hostname:porta</TableHead>
                  <TableHead>Versione</TableHead>
                  <TableHead>Heartbeat</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => (
                  <TableRow key={a.agent_id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-mono text-xs">{a.codice_cliente}</span>
                        <span className="text-sm text-muted-foreground">{a.ragione_sociale}</span>
                      </div>
                    </TableCell>
                    <TableCell>{a.label}</TableCell>
                    <TableCell className="font-mono text-sm">{a.hostname}:{a.port}</TableCell>
                    <TableCell className="font-mono text-sm">{a.version ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatLastSeen(a.last_seen_at)}</TableCell>
                    <TableCell>{renderStatus(a)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!a.has_token || rowState[a.agent_id]?.status === "testing"}
                          onClick={() => testOne(a.agent_id)}
                        >
                          <PlugZap className="h-3.5 w-3.5 mr-1.5" /> Test
                        </Button>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => router.push(`/tenants/${a.tenant_id}/agent`)}
                            title="Configura"
                          >
                            <ServerCog className="h-4 w-4" />
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteAgent(a)}
                            title="Elimina"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ─── Wizard "Nuovo agente" 2-step ─── */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Nuovo agente — step {wizardStep === "tenant" ? "1" : wizardStep === "agent" ? "2" : "3"}/3
            </DialogTitle>
            <DialogDescription>
              {wizardStep === "tenant" && "Scegli un cliente esistente o crea un nuovo cliente per cui registrare l'agente."}
              {wizardStep === "agent" && "Configura i parametri dell'agente Tailscale."}
              {wizardStep === "token" && "Copia il comando d'install: contiene il token plaintext, visibile solo una volta."}
            </DialogDescription>
          </DialogHeader>

          {wizardStep === "tenant" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button variant={wizMode === "existing" ? "default" : "outline"} size="sm" onClick={() => setWizMode("existing")}>
                  Cliente esistente
                </Button>
                <Button variant={wizMode === "new" ? "default" : "outline"} size="sm" onClick={() => setWizMode("new")}>
                  Nuovo cliente
                </Button>
              </div>

              {wizMode === "existing" ? (
                <div className="space-y-2">
                  <Label>Cliente</Label>
                  {tenants.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nessun cliente attivo. Crea il primo cliente.</p>
                  ) : (
                    <Select value={selectedTenantId} onValueChange={(v) => setSelectedTenantId(v ?? "")}>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleziona cliente" />
                      </SelectTrigger>
                      <SelectContent>
                        {tenants.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.codice_cliente} — {t.ragione_sociale}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="new-codice">Codice cliente</Label>
                    <Input id="new-codice" placeholder="es. 70791b" value={newCodice} onChange={(e) => setNewCodice(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-ragione">Ragione sociale</Label>
                    <Input id="new-ragione" placeholder="es. ACME Srl" value={newRagione} onChange={(e) => setNewRagione(e.target.value)} />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Crea solo l&apos;anagrafica minima. Indirizzo/telefono/email li compili dopo da Clienti.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => setWizardOpen(false)}>Annulla</Button>
                <Button onClick={handleStep1Next} disabled={wizSaving}>
                  {wizSaving ? "Salvataggio…" : "Avanti"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {wizardStep === "agent" && createdTenant && (
            <div className="space-y-4">
              <div className="rounded border p-3 bg-muted/30">
                <p className="text-xs text-muted-foreground">Cliente</p>
                <p className="font-mono text-sm">{createdTenant.codice_cliente} — {createdTenant.ragione_sociale}</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="ag-label">Label / Sede</Label>
                  <Input id="ag-label" placeholder="es. Sede Milano" value={agentLabel} onChange={(e) => setAgentLabel(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ag-port">Porta</Label>
                  <Input id="ag-port" type="number" min={1} max={65535} value={agentPort} onChange={(e) => setAgentPort(Number(e.target.value) || 8443)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ag-hostname">Hostname Tailscale (MagicDNS short)</Label>
                <Input id="ag-hostname" placeholder="es. agent-acme-mi" value={agentHostname} onChange={(e) => setAgentHostname(e.target.value)} />
                <p className="text-xs text-muted-foreground">Nome breve del nodo Tailscale dove vive (o vivrà) l&apos;agent. Solo MagicDNS short.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ag-subnet">Subnet match (opzionale, CSV CIDR — riservato per routing futuro)</Label>
                <Input id="ag-subnet" placeholder="es. 192.168.51.0/24, 10.0.0.0/8" value={agentSubnetMatch} onChange={(e) => setAgentSubnetMatch(e.target.value)} />
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setWizardStep("tenant")}>Indietro</Button>
                <Button onClick={handleStep2Save} disabled={wizSaving}>
                  {wizSaving ? "Creazione…" : "Crea agente + token"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {wizardStep === "token" && createdToken && createdTenant && (
            <div className="space-y-4">
              <div className="rounded border border-yellow-500/40 bg-yellow-50 dark:bg-yellow-950/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200 text-sm font-medium">
                  <ShieldAlert className="h-4 w-4" />
                  Il token plaintext è visibile solo ora. Copialo o copia l&apos;intero comando sotto.
                </div>
                <Input readOnly value={createdToken} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="ts-key">Auth-key Tailscale (opzionale, per install fully-automated)</Label>
                <Input id="ts-key" type="password" placeholder="tskey-auth-... (lascia vuoto per login interattivo)" value={tailscaleAuthKey} onChange={(e) => setTailscaleAuthKey(e.target.value)} className="font-mono text-xs" />
                <p className="text-xs text-muted-foreground">Senza auth-key, lo script stamperà un URL durante l&apos;install che dovrai aprire dal browser per autenticare il nodo Tailscale.</p>
              </div>

              <div>
                <Label className="text-sm">Comando di install (esegui su Ubuntu/Debian come root)</Label>
                <div className="flex gap-2 mt-2">
                  <pre className="flex-1 bg-muted p-3 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all">{installCommand}</pre>
                  <Button variant="outline" size="icon" onClick={copyInstall} title="Copia">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  <Terminal className="h-3 w-3 inline mr-1" />
                  Lo script installa Tailscale (se manca), apt deps, Python venv, agent, systemd unit.
                </p>
              </div>

              <DialogFooter>
                <Button onClick={() => { setWizardOpen(false); load(); if (createdAgentId) testOne(createdAgentId); }}>
                  Chiudi e testa connessione
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

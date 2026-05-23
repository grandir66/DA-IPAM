"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, Shield, Trash2, BookOpen, Copy, ChevronDown, ChevronRight, AlertTriangle, ExternalLink } from "lucide-react";

interface WazuhConfig {
  enabled: boolean;
  url: string;
  username: string;
  passwordSet: boolean;
  verifyTls: boolean;
  indexerUrl: string;
  indexerUsername: string;
  indexerPasswordSet: boolean;
}

interface WazuhStatus {
  totalAgents: number;
  matched: number;
  active: number;
  lastSyncedAt: string | null;
}

interface WazuhSyncResult {
  totalAgents: number;
  matchedHosts: number;
  softwareRows: number;
  vulnRows: number;
  portRows: number;
  hostsEnriched: number;
  removedAgents: number;
  durationMs: number;
  errors: string[];
}

interface TestResult {
  ok: boolean;
  manager?: { ok: boolean; apiVersion?: string; nodeName?: string; totalAgents?: number; activeAgents?: number; error?: string };
  indexer?: { ok: boolean; clusterName?: string; status?: string; nodes?: number; totalCveDocs?: number; error?: string } | null;
}

export function WazuhCard() {
  const [cfg, setCfg] = useState<WazuhConfig | null>(null);
  const [status, setStatus] = useState<WazuhStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    url: "https://da-wazuh.domarc.it:55000",
    username: "",
    password: "",
    verifyTls: false,
    indexerUrl: "https://da-wazuh.domarc.it:9200",
    indexerUsername: "",
    indexerPassword: "",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [setupContent, setSetupContent] = useState<{ script: string; playbook: string } | null>(null);
  const [setupTab, setSetupTab] = useState<"playbook" | "script">("playbook");
  const [editMode, setEditMode] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [cRes, sRes] = await Promise.all([
        fetch("/api/integrations/wazuh/config"),
        fetch("/api/integrations/wazuh/sync"),
      ]);
      if (cRes.ok) {
        const data = (await cRes.json()) as WazuhConfig;
        setCfg(data);
        if (data.url) {
          setForm((f) => ({
            ...f,
            url: data.url,
            username: data.username,
            verifyTls: data.verifyTls,
            indexerUrl: data.indexerUrl || f.indexerUrl,
            indexerUsername: data.indexerUsername,
          }));
        }
      }
      if (sRes.ok) setStatus((await sRes.json()) as WazuhStatus);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const loadSetupContent = async () => {
    if (setupContent) return;
    try {
      const r = await fetch("/api/integrations/wazuh/setup-script");
      if (r.ok) setSetupContent((await r.json()) as { script: string; playbook: string });
    } catch {
      // ignore
    }
  };

  const handleToggleSetup = async () => {
    if (!showSetup) await loadSetupContent();
    setShowSetup((v) => !v);
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiato negli appunti`);
    } catch {
      toast.error("Copia fallita — usa selezione manuale");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch("/api/integrations/wazuh/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = (await r.json()) as TestResult & { error?: string };
      setTestResult(d);
      if (d.ok) {
        const mgr = d.manager;
        const idx = d.indexer;
        toast.success(
          `Manager ${mgr?.apiVersion ?? "?"} OK (${mgr?.totalAgents ?? 0} agent)` +
          (idx?.ok ? ` · Indexer ${idx.clusterName} ${idx.status} (${idx.totalCveDocs} CVE)` : idx ? ` · Indexer KO: ${idx.error}` : ""),
        );
      } else {
        toast.error(d.error ?? d.manager?.error ?? "Test fallito");
      }
    } catch (e) {
      toast.error(`Errore rete: ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/integrations/wazuh/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, enabled: true }),
      });
      if (!r.ok) {
        const d = (await r.json()) as { error?: string };
        toast.error(d.error ?? "Salvataggio fallito");
        return;
      }
      toast.success("Configurazione Wazuh salvata");
      setForm((f) => ({ ...f, password: "", indexerPassword: "" }));
      setTestResult(null);
      setEditMode(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await fetch("/api/integrations/wazuh/sync", { method: "POST" });
      const d = (await r.json()) as WazuhSyncResult & { error?: string };
      if (r.ok && !d.error) {
        const errMsg = d.errors?.length ? ` — ${d.errors.length} errori` : "";
        const enrichMsg = d.hostsEnriched ? `, ${d.hostsEnriched} host arricchiti` : "";
        const portsMsg = d.portRows ? `, ${d.portRows} porte` : "";
        toast.success(`Sync OK: ${d.matchedHosts}/${d.totalAgents} matchati, ${d.softwareRows} sw, ${d.vulnRows} cve${portsMsg}${enrichMsg}${errMsg}`);
      } else {
        toast.error(d.error ?? "Sync fallito");
      }
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Disabilitare l'integrazione Wazuh? I dati già sincronizzati restano nel DB tenant.")) return;
    const r = await fetch("/api/integrations/wazuh/config", { method: "DELETE" });
    if (r.ok) {
      toast.success("Integrazione Wazuh disabilitata");
      await load();
    } else {
      toast.error("Operazione fallita");
    }
  };

  if (loading) {
    return <div className="rounded-md border p-4 text-sm text-muted-foreground">Caricamento…</div>;
  }

  const configured = cfg?.enabled && cfg?.url && cfg?.username && cfg?.passwordSet;
  const indexerConfigured = cfg?.indexerUrl && cfg?.indexerUsername && cfg?.indexerPasswordSet;

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" /> Wazuh (SIEM/HIDS)
          </h3>
          <p className="text-sm text-muted-foreground">
            Importa agent, syscollector HW/OS, inventario software e CVE da Wazuh Manager + indexer OpenSearch.
          </p>
        </div>
        {configured && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Configurato
          </span>
        )}
      </div>

      {/* ──────────────── Stato corrente (se configurato e non in edit) ──────────────── */}
      {configured && !editMode ? (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-muted-foreground">Manager URL:</span> <code className="text-xs">{cfg!.url}</code></div>
            <div><span className="text-muted-foreground">Manager user:</span> <code className="text-xs">{cfg!.username}</code></div>
            <div><span className="text-muted-foreground">Indexer URL:</span> <code className="text-xs">{cfg!.indexerUrl || "—"}</code></div>
            <div><span className="text-muted-foreground">Indexer user:</span> <code className="text-xs">{cfg!.indexerUsername || "—"}</code></div>
            <div><span className="text-muted-foreground">Verifica TLS:</span> {cfg!.verifyTls ? "sì" : "no (self-signed)"}</div>
            <div><span className="text-muted-foreground">Ultimo sync:</span> {status?.lastSyncedAt ?? "—"}</div>
            <div><span className="text-muted-foreground">Agent visibili:</span> {status?.totalAgents ?? 0}</div>
            <div><span className="text-muted-foreground">Agent matchati a host:</span> {status?.matched ?? 0}</div>
          </div>

          {!indexerConfigured && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-300 flex items-start gap-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <strong>CVE non disponibili:</strong> dal release Wazuh 4.8+ le vulnerability sono nell&apos;indexer OpenSearch (porta 9200). Configura URL + user OpenSearch sotto.
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1 flex-wrap">
            <Button size="sm" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Sincronizza ora
            </Button>
            {cfg!.url && (
              <a
                href={cfg!.url.replace(/:55000(\/.*)?$/, "")}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1 text-sm hover:bg-accent"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Apri Dashboard Wazuh
              </a>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditMode(true)}>
              Modifica credenziali
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Disabilita
            </Button>
          </div>
        </div>
      ) : (
        /* ──────────────── Form (nuova config o modifica) ──────────────── */
        <div className="space-y-3">
          <div className="grid gap-3">
            {/* Manager API */}
            <fieldset className="border rounded-md p-3 space-y-2">
              <legend className="text-xs font-semibold px-1 text-muted-foreground">Wazuh Manager (REST API · porta 55000)</legend>
              <label className="text-sm space-y-1 block">
                <span>URL</span>
                <input
                  className="w-full rounded border px-2 py-1 text-sm bg-background"
                  placeholder="https://da-wazuh.domarc.it:55000"
                  value={form.url}
                  onChange={(e) => { setForm({ ...form, url: e.target.value }); setTestResult(null); }}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm space-y-1 block">
                  <span>Username</span>
                  <input
                    className="w-full rounded border px-2 py-1 text-sm bg-background"
                    placeholder="da-ipam"
                    value={form.username}
                    onChange={(e) => { setForm({ ...form, username: e.target.value }); setTestResult(null); }}
                    autoComplete="off"
                  />
                </label>
                <label className="text-sm space-y-1 block">
                  <span>Password</span>
                  <input
                    className="w-full rounded border px-2 py-1 text-sm bg-background font-mono"
                    placeholder="••••••••"
                    value={form.password}
                    onChange={(e) => { setForm({ ...form, password: e.target.value }); setTestResult(null); }}
                    type="password"
                    autoComplete="off"
                  />
                </label>
              </div>
            </fieldset>

            {/* OpenSearch Indexer */}
            <fieldset className="border rounded-md p-3 space-y-2">
              <legend className="text-xs font-semibold px-1 text-muted-foreground">Wazuh Indexer (OpenSearch · porta 9200 · CVE)</legend>
              <label className="text-sm space-y-1 block">
                <span>URL <span className="text-xs text-muted-foreground">(opzionale, solo se vuoi importare CVE)</span></span>
                <input
                  className="w-full rounded border px-2 py-1 text-sm bg-background"
                  placeholder="https://da-wazuh.domarc.it:9200"
                  value={form.indexerUrl}
                  onChange={(e) => { setForm({ ...form, indexerUrl: e.target.value }); setTestResult(null); }}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm space-y-1 block">
                  <span>Username</span>
                  <input
                    className="w-full rounded border px-2 py-1 text-sm bg-background"
                    placeholder="da-ipam-os"
                    value={form.indexerUsername}
                    onChange={(e) => { setForm({ ...form, indexerUsername: e.target.value }); setTestResult(null); }}
                    autoComplete="off"
                  />
                </label>
                <label className="text-sm space-y-1 block">
                  <span>Password</span>
                  <input
                    className="w-full rounded border px-2 py-1 text-sm bg-background font-mono"
                    placeholder="••••••••"
                    value={form.indexerPassword}
                    onChange={(e) => { setForm({ ...form, indexerPassword: e.target.value }); setTestResult(null); }}
                    type="password"
                    autoComplete="off"
                  />
                </label>
              </div>
            </fieldset>

            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.verifyTls}
                onChange={(e) => { setForm({ ...form, verifyTls: e.target.checked }); setTestResult(null); }}
              />
              <span>Verifica certificato TLS (lascia disattivato per Wazuh self-signed)</span>
            </label>
          </div>

          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !form.url || !form.username || !form.password}>
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Test connessione
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!testResult?.ok || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Salva
            </Button>
            {editMode && (
              <Button size="sm" variant="ghost" onClick={() => { setEditMode(false); setTestResult(null); }}>
                Annulla
              </Button>
            )}
          </div>

          {/* Risultato del test */}
          {testResult && (
            <div className="space-y-1 text-xs">
              <div className={`rounded-md border px-3 py-2 ${testResult.manager?.ok ? "border-green-300 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300" : "border-red-300 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300"}`}>
                <strong>Manager API:</strong>{" "}
                {testResult.manager?.ok
                  ? `OK · ${testResult.manager.apiVersion} · ${testResult.manager.totalAgents} agent (${testResult.manager.activeAgents} attivi)`
                  : `KO · ${testResult.manager?.error ?? "errore sconosciuto"}`}
              </div>
              {testResult.indexer !== null && testResult.indexer !== undefined && (
                <div className={`rounded-md border px-3 py-2 ${testResult.indexer.ok ? "border-green-300 bg-green-50 dark:bg-green-950/20 text-green-800 dark:text-green-300" : "border-red-300 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300"}`}>
                  <strong>Indexer (CVE):</strong>{" "}
                  {testResult.indexer.ok
                    ? `OK · ${testResult.indexer.clusterName} ${testResult.indexer.status} · ${testResult.indexer.totalCveDocs} doc CVE`
                    : `KO · ${testResult.indexer.error}`}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ──────────────── Sezione "Setup guidato" sempre visibile ──────────────── */}
      <div className="border-t pt-3 mt-1">
        <button onClick={handleToggleSetup} className="text-sm inline-flex items-center gap-1 hover:underline">
          {showSetup ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <BookOpen className="h-3.5 w-3.5" />
          Setup guidato — come creare gli utenti su Wazuh
        </button>

        {showSetup && (
          <div className="mt-2 space-y-2">
            <div className="flex gap-1">
              <button
                onClick={() => setSetupTab("playbook")}
                className={`px-3 py-1 text-xs rounded-t-md border-b-2 ${setupTab === "playbook" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                Playbook
              </button>
              <button
                onClick={() => setSetupTab("script")}
                className={`px-3 py-1 text-xs rounded-t-md border-b-2 ${setupTab === "script" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
              >
                Script bash
              </button>
            </div>

            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">
                  {setupTab === "playbook"
                    ? "Guida completa con prerequisiti, opzioni, esempi e troubleshooting."
                    : "Script idempotente: crea utente Manager API + utente OpenSearch read-only. Lancialo SUL server Wazuh."}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(
                    (setupTab === "playbook" ? setupContent?.playbook : setupContent?.script) ?? "",
                    setupTab === "playbook" ? "Playbook" : "Script",
                  )}
                  disabled={!setupContent}
                >
                  <Copy className="h-3 w-3 mr-1" /> Copia
                </Button>
              </div>
              <pre className="text-[10px] leading-relaxed font-mono bg-background border rounded p-2 max-h-80 overflow-auto whitespace-pre-wrap">
                {setupContent
                  ? (setupTab === "playbook" ? setupContent.playbook : setupContent.script)
                  : "Caricamento…"}
              </pre>
            </div>

            <p className="text-xs text-muted-foreground">
              <strong>Quick start:</strong> SSH su <code>da-wazuh.domarc.it</code>, copia lo script in
              <code> /tmp/setup-wazuh.sh</code>, lancia con i flag <code>--endpoint</code>,
              <code>--admin-api-pass</code>, <code>--admin-os-pass</code>. Annota le credenziali
              stampate a fine esecuzione e incollale nei campi qui sopra.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

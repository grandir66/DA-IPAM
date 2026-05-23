"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, Shield, Trash2 } from "lucide-react";

interface WazuhConfig {
  enabled: boolean;
  url: string;
  username: string;
  passwordSet: boolean;
  verifyTls: boolean;
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
  removedAgents: number;
  durationMs: number;
  errors: string[];
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
  });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tested, setTested] = useState(false);

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
        if (data.url) setForm((f) => ({ ...f, url: data.url, username: data.username, verifyTls: data.verifyTls }));
      }
      if (sRes.ok) setStatus((await sRes.json()) as WazuhStatus);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleTest = async () => {
    setTesting(true);
    try {
      const r = await fetch("/api/integrations/wazuh/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = (await r.json()) as { ok: boolean; error?: string; apiVersion?: string; nodeName?: string; totalAgents?: number; activeAgents?: number };
      if (r.ok && d.ok) {
        toast.success(`Connessione OK — Wazuh ${d.apiVersion ?? "?"} (${d.totalAgents ?? 0} agent, ${d.activeAgents ?? 0} attivi)`);
        setTested(true);
      } else {
        toast.error(d.error ?? "Test connessione fallito");
        setTested(false);
      }
    } catch (e) {
      toast.error(`Errore rete: ${(e as Error).message}`);
      setTested(false);
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
      setForm((f) => ({ ...f, password: "" }));
      setTested(false);
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
        toast.success(`Sync OK: ${d.matchedHosts}/${d.totalAgents} matchati, ${d.softwareRows} sw, ${d.vulnRows} cve${errMsg}`);
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

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4" /> Wazuh (SIEM/HIDS)
          </h3>
          <p className="text-sm text-muted-foreground">
            Importa agent, syscollector HW/OS, inventario software e CVE da Wazuh Manager. Utente RBAC read-only consigliato.
          </p>
        </div>
        {configured && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Configurato
          </span>
        )}
      </div>

      {configured ? (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-muted-foreground">URL:</span> <code className="text-xs">{cfg!.url}</code></div>
            <div><span className="text-muted-foreground">Utente:</span> <code className="text-xs">{cfg!.username}</code></div>
            <div><span className="text-muted-foreground">Verifica TLS:</span> {cfg!.verifyTls ? "sì" : "no (cert self-signed accettato)"}</div>
            <div><span className="text-muted-foreground">Ultimo sync:</span> {status?.lastSyncedAt ?? "—"}</div>
            <div><span className="text-muted-foreground">Agent visibili:</span> {status?.totalAgents ?? 0}</div>
            <div><span className="text-muted-foreground">Agent matchati a host:</span> {status?.matched ?? 0}</div>
          </div>

          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-300">
            <strong>CVE:</strong> dal release Wazuh 4.8+ le vulnerability vivono su OpenSearch (indexer), non più sul manager API. Per importare le CVE serve un utente OpenSearch dedicato — in attesa di configurazione.
          </div>

          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Sincronizza ora
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setForm({ url: cfg!.url, username: cfg!.username, password: "", verifyTls: cfg!.verifyTls }); setTested(false); /* reset edit */ }}>
              Modifica credenziali
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Disabilita
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2">
            <label className="text-sm space-y-1">
              <span>URL Wazuh Manager API</span>
              <input
                className="w-full rounded border px-2 py-1 text-sm bg-background"
                placeholder="https://da-wazuh.domarc.it:55000"
                value={form.url}
                onChange={(e) => { setForm({ ...form, url: e.target.value }); setTested(false); }}
              />
            </label>
            <label className="text-sm space-y-1">
              <span>Username</span>
              <input
                className="w-full rounded border px-2 py-1 text-sm bg-background"
                placeholder="da-ipam"
                value={form.username}
                onChange={(e) => { setForm({ ...form, username: e.target.value }); setTested(false); }}
                autoComplete="off"
              />
            </label>
            <label className="text-sm space-y-1">
              <span>Password</span>
              <input
                className="w-full rounded border px-2 py-1 text-sm bg-background font-mono"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => { setForm({ ...form, password: e.target.value }); setTested(false); }}
                type="password"
                autoComplete="off"
              />
            </label>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.verifyTls}
                onChange={(e) => { setForm({ ...form, verifyTls: e.target.checked }); setTested(false); }}
              />
              <span>Verifica certificato TLS (lascia disattivato per self-signed)</span>
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !form.url || !form.username || !form.password}>
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Test connessione
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!tested || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Salva
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Crea l&apos;utente in <em>Wazuh Dashboard → Security → Internal users</em> e assegnagli un ruolo
            read-only con permessi su <code>agent:read</code>, <code>syscollector:read</code>,
            <code>cluster:read</code>.
          </p>
        </div>
      )}
    </div>
  );
}

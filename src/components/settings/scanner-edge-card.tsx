"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";

interface ScannerRow {
  id: number;
  name: string;
  base_url: string;
  enabled: number;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  finding_count: number;
}

export function ScannerEdgeCard() {
  const [scanner, setScanner] = useState<ScannerRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "Scanner-Edge", base_url: "", token: "" });
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [tested, setTested] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/integrations/scanner-edge");
      const d = (await r.json()) as { scanner: ScannerRow | null };
      setScanner(d.scanner);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleTest = async () => {
    if (!form.base_url || !form.token) {
      toast.error("Compila URL e token");
      return;
    }
    setTesting(true);
    try {
      const r = await fetch("/api/integrations/scanner-edge/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: form.base_url, token: form.token }),
      });
      const d = (await r.json()) as { ok: boolean; error?: string; health?: { version: string; scanner_id: string } };
      if (r.ok && d.ok) {
        toast.success(`Connessione OK — edge ${d.health?.scanner_id} v${d.health?.version}`);
        setTested(true);
      } else {
        toast.error(d.error || "Test connessione fallito");
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
    if (!tested) {
      toast.error("Esegui prima Test connessione");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/integrations/scanner-edge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const d = (await r.json()) as { error?: string };
        toast.error(d.error || "Salvataggio fallito");
        return;
      }
      toast.success("Scanner-edge configurato. Sync schedulato ogni 30 min.");
      setForm({ name: "Scanner-Edge", base_url: "", token: "" });
      setTested(false);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const r = await fetch("/api/integrations/scanner-edge/sync", { method: "POST" });
      const d = (await r.json()) as { ok: boolean; newScans?: number; newFindings?: number; error?: string };
      if (r.ok && d.ok) {
        toast.success(`Sync completato: ${d.newScans ?? 0} scan, ${d.newFindings ?? 0} findings`);
      } else {
        toast.error(d.error || "Sync fallito");
      }
      await load();
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Rimuovere la configurazione scanner-edge? I findings storici restano in archivio.")) return;
    const r = await fetch("/api/integrations/scanner-edge", { method: "DELETE" });
    if (r.ok) {
      toast.success("Scanner-edge rimosso");
      await load();
    } else {
      toast.error("Rimozione fallita");
    }
  };

  if (loading) {
    return <div className="rounded-md border p-4 text-sm text-muted-foreground">Caricamento…</div>;
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">Scanner-Edge (DA-Vul-can)</h3>
          <p className="text-sm text-muted-foreground">
            Importa findings CVE dallo scanner-edge sulla LAN del cliente. Una sola istanza per appliance.
          </p>
        </div>
        {scanner && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Configurato
          </span>
        )}
      </div>

      {scanner ? (
        <div className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div><span className="text-muted-foreground">Nome:</span> {scanner.name}</div>
            <div><span className="text-muted-foreground">URL:</span> <code className="text-xs">{scanner.base_url}</code></div>
            <div><span className="text-muted-foreground">Ultimo sync:</span> {scanner.last_sync_at || "—"}</div>
            <div><span className="text-muted-foreground">Findings totali:</span> {scanner.finding_count}</div>
          </div>
          {scanner.last_error && (
            <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-sm text-red-800 dark:text-red-300">
              <span className="font-semibold">Ultimo errore:</span> {scanner.last_error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Sincronizza ora
            </Button>
            <Button size="sm" variant="destructive" onClick={handleDelete}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Rimuovi
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid gap-2">
            <label className="text-sm space-y-1">
              <span>Nome</span>
              <input
                className="w-full rounded border px-2 py-1 text-sm bg-background"
                value={form.name}
                onChange={(e) => { setForm({ ...form, name: e.target.value }); setTested(false); }}
              />
            </label>
            <label className="text-sm space-y-1">
              <span>URL base edge</span>
              <input
                className="w-full rounded border px-2 py-1 text-sm bg-background"
                placeholder="https://edge.cliente.lan:8080 o http://192.168.x.y:8080"
                value={form.base_url}
                onChange={(e) => { setForm({ ...form, base_url: e.target.value }); setTested(false); }}
              />
            </label>
            <label className="text-sm space-y-1">
              <span>Token bearer (generato nell&apos;UI dello scanner-edge)</span>
              <input
                className="w-full rounded border px-2 py-1 text-sm bg-background font-mono"
                placeholder="incollare token plaintext"
                value={form.token}
                onChange={(e) => { setForm({ ...form, token: e.target.value }); setTested(false); }}
                type="password"
                autoComplete="off"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleTest} disabled={testing}>
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Test connessione
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!tested || saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Salva
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Per generare il token: vai sull&apos;edge → Impostazioni → <em>API Lettura CVE (DA-IPAM)</em> →
            abilita il toggle → <strong>Genera token</strong>. Copia il valore mostrato (visibile una sola volta).
          </p>
        </div>
      )}
    </div>
  );
}

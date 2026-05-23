"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GitBranch, ShieldCheck, AlertTriangle, Loader2, Rocket, Lock, ChevronDown, ChevronRight } from "lucide-react";

interface ChannelStatus {
  channel: "stable" | "beta" | "unknown";
  branch: string;
  configuredBranch: string;
  gitBranch: string | null;
  patConfigured: boolean;
  envFileWritable: boolean;
}

interface PromotePreview {
  base: string | null;
  mainSha: string | null;
  devSha: string | null;
  commitsAhead: number;
  commits: Array<{ sha: string; subject: string; author: string; date: string }>;
  remoteUrl: string | null;
  patConfigured: boolean;
}

interface PromoteResult {
  ok: boolean;
  newSha?: string;
  mergedCommits?: number;
  log?: string[];
  error?: string;
}

export function UpdateChannelCard() {
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [promoting, setPromoting] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [pat, setPat] = useState("");
  const [showCommits, setShowCommits] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [lastLog, setLastLog] = useState<string[] | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [sRes, pRes] = await Promise.all([
        fetch("/api/system/update-channel"),
        fetch("/api/system/promote"),
      ]);
      if (sRes.ok) setStatus((await sRes.json()) as ChannelStatus);
      if (pRes.ok) setPreview((await pRes.json()) as PromotePreview);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleChannelChange = async (channel: "stable" | "beta") => {
    if (!status || channel === status.channel) return;
    if (channel === "beta" && !confirm(
      "Passare al canale Beta (dev)?\n\n" +
      "Verranno installati gli aggiornamenti in sviluppo, non ancora promossi in produzione.\n" +
      "Adatto SOLO a deployment di test, NON ai clienti.\n\n" +
      "Confermi?"
    )) return;
    setSaving(true);
    try {
      const r = await fetch("/api/system/update-channel", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (r.ok && d.ok !== false) {
        toast.success(`Canale impostato su ${channel === "stable" ? "Stable (main)" : "Beta (dev)"}. Prossimo auto-update entro 1 min.`);
        await load();
      } else {
        toast.error(d.error ?? "Operazione fallita");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSavePat = async () => {
    if (pat.length < 20) { toast.error("Token troppo corto"); return; }
    setSaving(true);
    try {
      const r = await fetch("/api/system/promote", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat }),
      });
      if (r.ok) {
        toast.success("Token GitHub salvato (cifrato AES-GCM).");
        setPat("");
        setShowPat(false);
        await load();
      } else {
        const d = (await r.json()) as { error?: string };
        toast.error(d.error ?? "Salvataggio fallito");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePat = async () => {
    if (!confirm("Rimuovere il token GitHub salvato? Senza token i push autenticati non funzioneranno.")) return;
    const r = await fetch("/api/system/promote", { method: "DELETE" });
    if (r.ok) {
      toast.success("Token rimosso");
      await load();
    }
  };

  const handlePromote = async () => {
    if (!preview || preview.commitsAhead === 0) {
      toast.info("Niente da promuovere: dev coincide con main.");
      return;
    }
    if (!confirm(
      `Promuovere ${preview.commitsAhead} commit da dev → main?\n\n` +
      `Questo aggiornerà la produzione (clienti su canale Stable).\n` +
      `Operazione: git merge --no-ff dev su main + push origin main.\n\n` +
      `Confermi?`,
    )) return;
    setPromoting(true);
    setLastLog(null);
    try {
      const r = await fetch("/api/system/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const d = (await r.json()) as PromoteResult;
      setLastLog(d.log ?? null);
      setShowLog(true);
      if (r.ok && d.ok) {
        toast.success(`Promote OK: ${d.mergedCommits} commit pushati su main (HEAD ${d.newSha?.slice(0, 7)}).`);
        await load();
      } else {
        toast.error(d.error ?? "Promote fallito (vedi log).");
      }
    } finally {
      setPromoting(false);
    }
  };

  if (loading) return <div className="rounded-md border p-4 text-sm text-muted-foreground">Caricamento canale…</div>;
  if (!status) return null;

  const isStable = status.channel === "stable";
  const isBeta = status.channel === "beta";

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4" /> Canale aggiornamenti
          </h3>
          <p className="text-sm text-muted-foreground">
            Sceglie da quale branch GitHub il timer auto-update tira il codice. <strong>Stable (main)</strong> è
            consigliato in produzione; <strong>Beta (dev)</strong> per server di test.
          </p>
        </div>
      </div>

      {/* Selettore canale */}
      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={saving}
          onClick={() => handleChannelChange("stable")}
          className={`text-left rounded-md border p-3 transition-colors ${isStable ? "border-primary bg-primary/5" : "hover:bg-accent"}`}
        >
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className={`h-4 w-4 ${isStable ? "text-primary" : "text-muted-foreground"}`} />
            Stable (main)
            {isStable && <span className="text-xs ml-auto text-primary">attivo</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Produzione. Riceve solo le promote esplicite. Sicuro per i clienti.
          </p>
        </button>
        <button
          disabled={saving}
          onClick={() => handleChannelChange("beta")}
          className={`text-left rounded-md border p-3 transition-colors ${isBeta ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30" : "hover:bg-accent"}`}
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className={`h-4 w-4 ${isBeta ? "text-amber-600" : "text-muted-foreground"}`} />
            Beta (dev)
            {isBeta && <span className="text-xs ml-auto text-amber-700">attivo</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Riceve ogni push di sviluppo. Solo deployment di test.
          </p>
        </button>
      </div>

      {/* Info stato */}
      <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
        <div><span>Branch git locale:</span> <code className="font-mono">{status.gitBranch ?? "?"}</code></div>
        <div><span>DA_INVENT_BRANCH:</span> <code className="font-mono">{status.configuredBranch}</code></div>
        <div><span>.env.local scrivibile:</span> {status.envFileWritable ? <span className="text-green-600">sì</span> : <span className="text-red-600">no</span>}</div>
        <div><span>GitHub PAT:</span> {status.patConfigured ? <span className="text-green-600">configurato</span> : <span className="text-amber-600">non configurato</span>}</div>
      </div>

      {!status.envFileWritable && (
        <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs text-red-800 dark:text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
          <code className="font-mono">.env.local</code> non scrivibile dal processo. Cambia permessi (es. <code>chown $(whoami) .env.local</code>) prima di poter cambiare canale.
        </div>
      )}

      {/* ──────────────── Promote dev → main ──────────────── */}
      <div className="border-t pt-3 mt-1 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Rocket className="h-4 w-4" /> Promuovi dev → main
            </h4>
            <p className="text-xs text-muted-foreground">
              Pubblica gli aggiornamenti di sviluppo in produzione. Tutti i clienti su canale Stable li riceveranno al prossimo auto-update.
            </p>
          </div>
        </div>

        {preview && (
          <>
            <div className="text-xs flex flex-wrap items-center gap-3">
              <span><strong>{preview.commitsAhead}</strong> commit di dev non in main</span>
              <span className="text-muted-foreground">·</span>
              <span>main: <code className="font-mono">{preview.mainSha?.slice(0, 7) ?? "—"}</code></span>
              <span>dev: <code className="font-mono">{preview.devSha?.slice(0, 7) ?? "—"}</code></span>
              {preview.commitsAhead > 0 && (
                <button onClick={() => setShowCommits((v) => !v)} className="ml-auto inline-flex items-center gap-1 hover:underline">
                  {showCommits ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  {showCommits ? "Nascondi" : "Mostra"} commit
                </button>
              )}
            </div>

            {showCommits && preview.commits.length > 0 && (
              <div className="rounded-md border max-h-64 overflow-y-auto text-xs">
                <table className="w-full">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1 w-24">SHA</th>
                      <th className="text-left px-2 py-1">Subject</th>
                      <th className="text-left px-2 py-1 w-32">Author</th>
                      <th className="text-left px-2 py-1 w-32">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.commits.map((c) => (
                      <tr key={c.sha} className="border-t">
                        <td className="px-2 py-1 font-mono">{c.sha.slice(0, 7)}</td>
                        <td className="px-2 py-1">{c.subject}</td>
                        <td className="px-2 py-1 text-muted-foreground">{c.author}</td>
                        <td className="px-2 py-1 text-muted-foreground">
                          {new Date(c.date).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={handlePromote} disabled={promoting || preview?.commitsAhead === 0}>
            {promoting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Rocket className="h-3.5 w-3.5 mr-1" />}
            Promuovi dev → main
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowPat((v) => !v)}>
            <Lock className="h-3.5 w-3.5 mr-1" />
            {status.patConfigured ? "Aggiorna token GitHub" : "Configura token GitHub"}
          </Button>
          {status.patConfigured && (
            <Button size="sm" variant="ghost" onClick={handleRemovePat}>
              Rimuovi token
            </Button>
          )}
        </div>

        {showPat && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Serve un Personal Access Token (classic) con scope <code>repo</code> per autorizzare il push verso <code>main</code> da DA-IPAM.
              Genera su <a href="https://github.com/settings/tokens/new?scopes=repo&description=DA-IPAM-promote" target="_blank" rel="noopener noreferrer" className="underline">github.com/settings/tokens</a>.
              Salvato cifrato AES-GCM nel hub DB.
            </p>
            <input
              type="password"
              autoComplete="off"
              placeholder="ghp_..."
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              className="w-full rounded border px-2 py-1 text-sm font-mono bg-background"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSavePat} disabled={saving || pat.length < 20}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Salva token
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowPat(false); setPat(""); }}>Annulla</Button>
            </div>
          </div>
        )}

        {lastLog && (
          <details open={showLog} onToggle={(e) => setShowLog((e.target as HTMLDetailsElement).open)} className="rounded-md border bg-muted/30">
            <summary className="cursor-pointer text-xs px-3 py-2 hover:bg-muted/50">Log ultimo promote ({lastLog.length} righe)</summary>
            <pre className="text-[10px] font-mono p-3 max-h-64 overflow-auto whitespace-pre-wrap">
              {lastLog.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

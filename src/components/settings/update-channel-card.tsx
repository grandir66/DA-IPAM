"use client";
import { parseDbDate } from "@/lib/db-date";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { GitBranch, ShieldCheck, AlertTriangle, Rocket, ChevronDown, ChevronRight } from "lucide-react";

interface ChannelStatus {
  channel: "stable" | "dev" | "unknown";
  branch: string;
  configuredBranch: string;
  gitBranch: string | null;
  patConfigured: boolean;
  envFileWritable: boolean;
  firma?: { modo: "avvisa" | "blocca" | "spenta"; esito: "buona" | "mancante" | "rifiutata" | null; commit: string | null; quando: string | null };
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

export function UpdateChannelCard() {
  const [status, setStatus] = useState<ChannelStatus | null>(null);
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCommits, setShowCommits] = useState(false);

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

  const handleChannelChange = async (channel: "stable" | "dev") => {
    if (!status || channel === status.channel) return;
    if (channel === "dev" && !confirm(
      "Passare al canale Dev (branch dev)?\n\n" +
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
        toast.success(`Canale impostato su ${channel === "stable" ? "Stable (main)" : "Dev (dev)"}. Prossimo auto-update entro 15 min.`);
        await load();
      } else {
        toast.error(d.error ?? "Operazione fallita");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePat = async () => {
    if (!confirm("Rimuovere il token GitHub salvato su questa installazione? Non serve più: il rilascio si fa dal Mac.")) return;
    const r = await fetch("/api/system/promote", { method: "DELETE" });
    if (r.ok) {
      toast.success("Token rimosso");
      await load();
    }
  };

  if (loading) return <div className="rounded-md border p-4 text-sm text-muted-foreground">Caricamento canale…</div>;
  if (!status) return null;

  const isStable = status.channel === "stable";
  const isDev = status.channel === "dev";

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <GitBranch className="h-4 w-4" /> Canale aggiornamenti
          </h3>
          <p className="text-sm text-muted-foreground">
            Sceglie da quale branch GitHub il timer auto-update tira il codice. <strong>Stable (main)</strong> è
            consigliato in produzione; <strong>Dev (dev)</strong> per server di test.
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
          onClick={() => handleChannelChange("dev")}
          className={`text-left rounded-md border p-3 transition-colors ${isDev ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30" : "hover:bg-accent"}`}
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className={`h-4 w-4 ${isDev ? "text-amber-600" : "text-muted-foreground"}`} />
            Dev (dev)
            {isDev && <span className="text-xs ml-auto text-amber-700">attivo</span>}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Riceve ogni push di sviluppo. Solo deployment di test.
          </p>
        </button>
      </div>

      {/* Info stato canale (solo cose strettamente legate al canale; il GitHub PAT
          appartiene alla sezione "Promuovi" sotto, non a questo blocco) */}
      <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
        <div><span>Branch git locale:</span> <code className="font-mono">{status.gitBranch ?? "?"}</code></div>
        <div><span>DA_INVENT_BRANCH:</span> <code className="font-mono">{status.configuredBranch}</code></div>
        <div className="col-span-2"><span>.env.local scrivibile:</span> {status.envFileWritable ? <span className="text-green-600">sì</span> : <span className="text-red-600">no</span>}</div>
        {status.firma && (
          <div className="col-span-2">
            <span>Firma dei rilasci:</span>{" "}
            {status.firma.modo === "spenta"
              ? "controllo spento"
              : status.firma.esito === null
                ? `non ancora controllata (modo «${status.firma.modo}»)`
                : status.firma.esito === "buona"
                  ? `buona sull'ultimo rilascio controllato (${status.firma.commit ?? "?"}), modo «${status.firma.modo}»`
                  : status.firma.esito === "mancante"
                    ? <strong className="text-foreground">mancante sull&apos;ultimo rilascio controllato ({status.firma.commit ?? "?"}): installato lo stesso, modo «avvisa»</strong>
                    : <strong className="text-foreground">rifiutata ({status.firma.commit ?? "?"}): aggiornamento fermo</strong>}
          </div>
        )}
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
          <div className="flex-1">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Rocket className="h-4 w-4" /> Rilascio su main
            </h4>
            <p className="text-xs text-muted-foreground">
              Il rilascio ai clienti (canale Stable) non parte più da qui: è un commit firmato, fatto dal Mac di chi
              rilascia con <code className="font-mono">scripts/rilascia-main.sh</code>. La chiave di firma non sta su
              nessun server, e le appliance la controllano prima di aggiornarsi. Qui sotto, cosa c&apos;è in attesa.
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
                          {parseDbDate(c.date).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {status.patConfigured && (
          <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            <span>Su questa installazione c&apos;è ancora un token GitHub salvato, che non serve più.</span>
            <Button size="sm" variant="outline" onClick={handleRemovePat}>
              Rimuovi token
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

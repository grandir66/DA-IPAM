"use client";

/**
 * Pannello comandi remoti — 100% DA-IPAM, nessun iframe.
 *
 * E' la dimostrazione dell'architettura scelta: i PIXEL del desktop arrivano da
 * MeshCentral (protocollo KVM proprietario, non riscrivibile), ma DATI e COMANDI
 * passano da control.ashx, che e' un'API stabile — quindi qui l'interfaccia e'
 * interamente nostra e MeshCentral resta invisibile.
 *
 * L'output NON viene salvato da nessuna parte: vive solo in questa risposta HTTP
 * (puo' contenere password o token — basta un `cat .env`). In `mc_command_log`
 * restano comando, operatore ed esito.
 */
import { useState } from "react";
import { Loader2, Play, Terminal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface CommandPanelProps {
  hostId: number;
  /** true se l'endpoint e' Windows: abilita l'opzione PowerShell. */
  isWindows: boolean;
}

interface HistoryEntry {
  command: string;
  output: string;
  error?: string;
  at: string;
}

export function CommandPanel({ hostId, isWindows }: CommandPanelProps) {
  const [command, setCommand] = useState("");
  const [powershell, setPowershell] = useState(false);
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  async function run() {
    const cmd = command.trim();
    if (!cmd || running) return;
    setRunning(true);
    try {
      const r = await fetch(`/api/integrations/meshcentral/host/${hostId}/run-command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, powershell: isWindows && powershell }),
      });
      const data = (await r.json().catch(() => ({}))) as { output?: string; error?: string };
      setHistory((h) => [
        {
          command: cmd,
          output: data.output ?? "",
          error: r.ok ? undefined : (data.error ?? `HTTP ${r.status}`),
          at: new Date().toLocaleTimeString("it-IT"),
        },
        ...h,
      ]);
      if (r.ok) setCommand("");
    } catch {
      setHistory((h) => [
        { command: cmd, output: "", error: "Errore di rete", at: new Date().toLocaleTimeString("it-IT") },
        ...h,
      ]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Invio esegue; Invio semplice va a capo (i comandi multi-riga
            // sono normali, e un invio distratto non deve lanciare root sull'endpoint).
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
          placeholder={
            isWindows
              ? "es. ipconfig /all    ·    Ctrl+Invio per eseguire"
              : "es. uname -a && df -h    ·    Ctrl+Invio per eseguire"
          }
          rows={3}
          spellCheck={false}
          className="flex-1 resize-y rounded-md border bg-background p-2 font-mono text-sm"
        />
        <div className="flex flex-col gap-2">
          <Button onClick={() => void run()} disabled={running || !command.trim()}>
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Esegui
          </Button>
          {history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setHistory([])}>
              <Trash2 className="mr-2 h-4 w-4" /> Pulisci
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {isWindows ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="ps"
              checked={powershell}
              onCheckedChange={(v) => setPowershell(v === true)}
            />
            <Label htmlFor="ps" className="cursor-pointer text-xs">
              PowerShell (altrimenti cmd)
            </Label>
          </div>
        ) : (
          <span>Shell: bash — l&apos;agente rileva la piattaforma da solo</span>
        )}
        <span>Eseguito come root/SYSTEM · timeout 30s</span>
      </div>

      <div className="flex-1 overflow-y-auto rounded-md border bg-muted/30">
        {history.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Terminal className="h-4 w-4" />
            L&apos;output dei comandi comparirà qui. Non viene salvato da nessuna parte.
          </div>
        ) : (
          <ul className="divide-y">
            {history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">{h.at}</span>
                  <span className="font-mono text-foreground">$ {h.command}</span>
                </div>
                {h.error ? (
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-destructive">
                    {h.error}
                  </pre>
                ) : (
                  <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">
                    {h.output || "(nessun output)"}
                  </pre>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

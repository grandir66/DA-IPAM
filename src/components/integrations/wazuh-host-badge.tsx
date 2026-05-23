"use client";

/**
 * Badge "Wazuh agent presente" riusabile in tutte le viste host (header detail,
 * lista discovery, lista network, lista globale, card device).
 *
 * Stati visivi (coerenti col pattern LibreNMS):
 *   - active        → Shield verde + dialog summary on click
 *   - disconnected  → Shield rosso + dialog summary on click
 *   - assente       → PlusCircle grigio + dialog "Aggiungi" (script auto-enrollment)
 *   - loading       → Loader2 spinning
 *
 * Modi rendering:
 *   - "icon"    → solo icona (h-3.5 w-3.5), per cell tabelle e righe compatte
 *   - "row"     → icona + label "Wazuh" (per profile column discovery)
 *   - "header"  → icona + label + tooltip esteso (per header pagina host detail)
 *
 * Status batch-fetch: passa via prop `prefetched` (Map host_id → status) se
 * il parent lo ha già caricato. Altrimenti il componente fetch da solo.
 */

import { useEffect, useState } from "react";
import { Shield, PlusCircle, Loader2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DIALOG_PANEL_COMPACT_CLASS } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export interface WazuhHostStatus {
  agent_id: string;
  status: string | null;
  last_keep_alive: string | null;
  name: string | null;
}

interface Props {
  hostId: number;
  /** Hostname/IP per generare script enrollment quando agent assente. */
  hostName?: string | null;
  hostIp?: string | null;
  /** Status precaricato in batch dal parent (lista). Se omesso, il badge fa il fetch. */
  prefetched?: WazuhHostStatus | null;
  mode?: "icon" | "row" | "header";
  /** className extra per il wrapper. */
  className?: string;
}

interface WazuhRuntimeInfo {
  managerHost: string | null;
  dashboardUrl: string | null;
}

let _runtimeInfo: WazuhRuntimeInfo | null = null;
let _runtimeInfoPromise: Promise<WazuhRuntimeInfo> | null = null;

async function loadRuntimeInfo(): Promise<WazuhRuntimeInfo> {
  if (_runtimeInfo) return _runtimeInfo;
  if (!_runtimeInfoPromise) {
    _runtimeInfoPromise = fetch("/api/integrations/wazuh/config")
      .then(async (r) => {
        if (!r.ok) return { managerHost: null, dashboardUrl: null };
        const j = (await r.json()) as { url?: string };
        const url = (j.url ?? "").trim();
        if (!url) return { managerHost: null, dashboardUrl: null };
        try {
          const u = new URL(url);
          return {
            managerHost: u.hostname,
            // Dashboard server è solitamente la stessa hostname senza :55000 (default :443)
            dashboardUrl: `${u.protocol}//${u.hostname}`,
          };
        } catch {
          return { managerHost: null, dashboardUrl: null };
        }
      })
      .catch(() => ({ managerHost: null, dashboardUrl: null }));
    _runtimeInfo = await _runtimeInfoPromise;
  }
  return _runtimeInfoPromise;
}

function statusKind(status: string | null | undefined): "active" | "disconnected" | "unknown" {
  if (status === "active") return "active";
  if (status === "disconnected" || status === "never_connected") return "disconnected";
  return "unknown";
}

function colorClass(kind: "active" | "disconnected" | "unknown" | "absent"): string {
  if (kind === "active") return "text-emerald-600 dark:text-emerald-400";
  if (kind === "disconnected") return "text-rose-600 dark:text-rose-400";
  if (kind === "unknown") return "text-amber-600 dark:text-amber-400";
  return "text-muted-foreground/40";
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return ts;
  }
}

export function WazuhHostBadge({ hostId, hostName, hostIp, prefetched, mode = "icon", className }: Props) {
  const [status, setStatus] = useState<WazuhHostStatus | null | undefined>(prefetched);
  const [loading, setLoading] = useState(prefetched === undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [runtime, setRuntime] = useState<WazuhRuntimeInfo>({ managerHost: null, dashboardUrl: null });

  useEffect(() => {
    void loadRuntimeInfo().then(setRuntime);
  }, []);

  useEffect(() => {
    if (prefetched !== undefined) {
      setStatus(prefetched);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/integrations/wazuh/host-status?host_ids=${hostId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        const s = (j?.statuses?.[hostId] ?? null) as WazuhHostStatus | null;
        setStatus(s);
      })
      .catch(() => { /* silenzioso */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hostId, prefetched]);

  if (loading) {
    return <Loader2 className={`h-3.5 w-3.5 animate-spin text-muted-foreground/50 ${className ?? ""}`} />;
  }

  const present = !!status;
  const kind = present ? statusKind(status?.status) : "absent";
  const color = colorClass(kind);

  const label = present ? "Wazuh" : "Aggiungi a Wazuh";
  const title = present
    ? `Wazuh: ${status?.name ?? status?.agent_id} • ${status?.status ?? "?"} • ultimo keep-alive ${formatTs(status?.last_keep_alive)}`
    : "Host non monitorato da Wazuh — click per istruzioni di enrollment";

  function openDialog(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (present) setDialogOpen(true);
    else setAddOpen(true);
  }

  const Icon = present ? Shield : PlusCircle;
  const inner = (
    <>
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      {mode !== "icon" && <span className={`text-xs ${color}`}>{label}</span>}
    </>
  );

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        title={title}
        className={`inline-flex items-center gap-1 hover:opacity-80 ${className ?? ""}`}
        aria-label={title}
      >
        {inner}
      </button>

      {/* Dialog summary (agent presente) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader>
            <DialogTitle>Wazuh agent</DialogTitle>
          </DialogHeader>
          {status && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Agent ID</Label>
                  <p className="font-mono">{status.agent_id}</p>
                </div>
                <div>
                  <Label className="text-xs">Nome agent</Label>
                  <p>{status.name ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-xs">Stato</Label>
                  <p className={colorClass(statusKind(status.status))}>● {status.status ?? "?"}</p>
                </div>
                <div>
                  <Label className="text-xs">Ultimo keep-alive</Label>
                  <p>{formatTs(status.last_keep_alive)}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Chiudi</Button>
                {runtime.dashboardUrl && (
                  <a
                    href={`${runtime.dashboardUrl}/app/wazuh#/agents-preview/?tab=welcome&agent=${encodeURIComponent(status.agent_id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 text-sm font-medium"
                  >
                    Apri in Wazuh dashboard <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog "Aggiungi" (agent assente) */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader>
            <DialogTitle>Aggiungi host a Wazuh</DialogTitle>
          </DialogHeader>
          <WazuhEnrollmentDialogBody
            hostName={hostName}
            hostIp={hostIp}
            managerHost={runtime.managerHost}
            onClose={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────
// Dialog enrollment: mostra comandi Linux + Windows con auto-enroll
// ──────────────────────────────────────────────────────────────────

function WazuhEnrollmentDialogBody({
  hostName,
  hostIp,
  managerHost,
  onClose,
}: {
  hostName?: string | null;
  hostIp?: string | null;
  managerHost: string | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"linux" | "windows">("linux");
  const agentName = (hostName ?? hostIp ?? "host").replace(/[^A-Za-z0-9._-]/g, "_");
  const manager = managerHost ?? "<WAZUH_MANAGER_IP>";

  const linuxCmd = `# Wazuh agent — install + auto-enroll su ${manager} (Debian/Ubuntu).
curl -sO https://packages.wazuh.com/4.x/apt/pool/main/w/wazuh-agent/wazuh-agent_4.14.0-1_amd64.deb
sudo WAZUH_MANAGER='${manager}' WAZUH_AGENT_NAME='${agentName}' dpkg -i wazuh-agent_4.14.0-1_amd64.deb
sudo systemctl daemon-reload && sudo systemctl enable wazuh-agent && sudo systemctl start wazuh-agent
# Verifica:  sudo systemctl status wazuh-agent`;

  const rhelCmd = `# Wazuh agent — install + auto-enroll (RHEL/CentOS).
curl -sO https://packages.wazuh.com/4.x/yum/wazuh-agent-4.14.0-1.x86_64.rpm
sudo WAZUH_MANAGER='${manager}' WAZUH_AGENT_NAME='${agentName}' rpm -i wazuh-agent-4.14.0-1.x86_64.rpm
sudo systemctl daemon-reload && sudo systemctl enable wazuh-agent && sudo systemctl start wazuh-agent`;

  const windowsCmd = `# Wazuh agent — install + auto-enroll (Windows, PowerShell come admin).
Invoke-WebRequest -Uri https://packages.wazuh.com/4.x/windows/wazuh-agent-4.14.0-1.msi -OutFile $env:tmp\\wazuh-agent.msi
msiexec.exe /i $env:tmp\\wazuh-agent.msi /q WAZUH_MANAGER='${manager}' WAZUH_AGENT_NAME='${agentName}'
NET START WazuhSvc`;

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    toast.success(`${label} copiato negli appunti`);
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground text-xs">
        Wazuh richiede l'installazione di un agent sull'host. Auto-enrollment via porta 1515 — non
        serve generare chiavi manualmente, il manager riconosce l'agent dopo il primo connect.
      </p>
      {!managerHost && (
        <p className="text-amber-600 text-xs">
          ⚠ Manager Wazuh non configurato in DA-IPAM (Settings → Integrazioni → Wazuh).
          Sostituisci <code>&lt;WAZUH_MANAGER_IP&gt;</code> con l'IP/FQDN del tuo manager.
        </p>
      )}
      <div className="flex gap-1 border-b">
        <button
          type="button"
          onClick={() => setTab("linux")}
          className={`px-3 py-1 text-xs rounded-t-md border-b-2 ${tab === "linux" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
        >
          Linux (deb)
        </button>
        <button
          type="button"
          onClick={() => setTab("windows")}
          className={`px-3 py-1 text-xs rounded-t-md border-b-2 ${tab === "windows" ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
        >
          Windows (msi)
        </button>
      </div>
      {tab === "linux" ? (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Debian / Ubuntu</Label>
            <pre className="text-[11px] bg-muted/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">{linuxCmd}</pre>
            <Button size="sm" variant="outline" onClick={() => copy(linuxCmd, "Comando Linux deb")}>Copia</Button>
          </div>
          <div>
            <Label className="text-xs">RHEL / CentOS / Rocky</Label>
            <pre className="text-[11px] bg-muted/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">{rhelCmd}</pre>
            <Button size="sm" variant="outline" onClick={() => copy(rhelCmd, "Comando RPM")}>Copia</Button>
          </div>
        </div>
      ) : (
        <div>
          <pre className="text-[11px] bg-muted/30 p-2 rounded overflow-x-auto whitespace-pre-wrap">{windowsCmd}</pre>
          <Button size="sm" variant="outline" onClick={() => copy(windowsCmd, "Comando PowerShell")}>Copia</Button>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onClose}>Chiudi</Button>
      </div>
    </div>
  );
}

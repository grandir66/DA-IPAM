"use client";

/**
 * Dialog "Installa agent/moduli" — riusabile (Discovery kebab, Patch Mgmt, …).
 *
 * Cross-platform:
 *  - Windows → push one-click via WinRM (bootstrap Chocolatey, MeshAgent choco,
 *    GLPI choco, Wazuh). Richiede hostId + credenziali WinRM. Log live nel
 *    HostActionModal.
 *  - Linux / macOS → Chocolatey non esiste; si generano gli SCRIPT di install
 *    già esistenti (GLPI + MeshCentral) da lanciare sul target (copia/scarica).
 *    Wazuh su Linux/macOS si installa dal dashboard da-wazuh (Deploy new agent).
 */
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Loader2,
  Boxes,
  MonitorSmartphone,
  PackageSearch,
  ShieldCheck,
  Copy,
  Download,
  FileTerminal,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HostActionModal, type HostActionOperation } from "@/components/patch/host-action-modal";

type Platform = "windows" | "linux" | "macos";

const PLATFORMS: { key: Platform; label: string }[] = [
  { key: "windows", label: "Windows" },
  { key: "linux", label: "Linux" },
  { key: "macos", label: "macOS" },
];

/** Agent installabili via push WinRM (solo Windows). */
interface WinAgent {
  key: string;
  label: string;
  desc: string;
  endpoint: string;
  icon: ReactNode;
}
const WIN_AGENTS: WinAgent[] = [
  {
    key: "choco",
    label: "Chocolatey",
    desc: "Package manager: prerequisito degli agent choco. Idempotente.",
    endpoint: "/api/patch/bootstrap",
    icon: <Boxes className="h-4 w-4" />,
  },
  {
    key: "mesh",
    label: "MeshCentral Agent (RMM)",
    desc: "Controllo remoto. Pacchetto choco domarc-meshagent configurato.",
    endpoint: "/api/patch/install-meshagent-choco",
    icon: <MonitorSmartphone className="h-4 w-4" />,
  },
  {
    key: "glpi",
    label: "GLPI Agent (inventario)",
    desc: "Inventario hardware/software con push verso DA-IPAM. Pacchetto choco.",
    endpoint: "/api/patch/install-glpi-agent-choco",
    icon: <PackageSearch className="h-4 w-4" />,
  },
  {
    key: "wazuh",
    label: "Wazuh Agent (SIEM/HIDS)",
    desc: "Agente Wazuh. Richiede il manager Wazuh configurato in Integrazioni.",
    endpoint: "/api/patch/install-wazuh",
    icon: <ShieldCheck className="h-4 w-4" />,
  },
];

/** Agent installabili via SCRIPT (Linux/macOS): l'utente lo lancia sul target. */
interface ScriptAgent {
  key: string;
  label: string;
  desc: string;
  icon: ReactNode;
  /** Costruisce (endpoint, body) per generare lo script per la platform. */
  request: (platform: Platform) => { url: string; body: Record<string, unknown> };
  ext: string;
}
const SCRIPT_AGENTS: ScriptAgent[] = [
  {
    key: "mesh",
    label: "MeshCentral Agent (RMM)",
    desc: "Script di install dell'agente MeshCentral configurato per questo tenant.",
    icon: <MonitorSmartphone className="h-4 w-4" />,
    request: (platform) => ({
      url: "/api/integrations/meshcentral/install-script",
      body: { platform },
    }),
    ext: "sh",
  },
  {
    key: "glpi",
    label: "GLPI Agent (inventario)",
    desc: "Script GLPI Agent con token di push già embedded verso DA-IPAM.",
    icon: <PackageSearch className="h-4 w-4" />,
    request: (platform) => ({
      url: "/api/integrations/inventory-agent/install-script",
      body: { platform, useStoredToken: true, download: true },
    }),
    ext: "sh",
  },
  {
    key: "wazuh",
    label: "Wazuh Agent (SIEM/HIDS)",
    desc: "Script agente Wazuh (repo apt/yum/zypper o .pkg macOS) verso il manager configurato.",
    icon: <ShieldCheck className="h-4 w-4" />,
    request: (platform) => ({
      url: "/api/integrations/wazuh/agent-script",
      body: { platform },
    }),
    ext: "sh",
  },
];

export function InstallAgentsDialog({
  hostId,
  hostLabel,
  open,
  onOpenChange,
}: {
  hostId: number;
  hostLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [platform, setPlatform] = useState<Platform>("windows");
  const [busy, setBusy] = useState<string | null>(null);
  const [script, setScript] = useState<{ agent: string; content: string; ext: string } | null>(null);
  const [modalOps, setModalOps] = useState<HostActionOperation[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");

  // Windows: push WinRM one-click.
  const runWinPush = useCallback(
    async (a: WinAgent) => {
      setBusy(a.key);
      try {
        const res = await fetch(a.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostId }),
        });
        const data = (await res.json().catch(() => null)) as
          | { operationId?: number; error?: string }
          | null;
        if (!res.ok || typeof data?.operationId !== "number") {
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        setModalTitle(`Installa ${a.label} — ${hostLabel}`);
        setModalOps([{ operationId: data.operationId, hostId, hostLabel }]);
        setModalOpen(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore installazione agent");
      } finally {
        setBusy(null);
      }
    },
    [hostId, hostLabel],
  );

  // Linux/macOS: genera lo script (testo) da lanciare sul target.
  const genScript = useCallback(
    async (a: ScriptAgent) => {
      setBusy(a.key);
      setScript(null);
      try {
        const { url, body } = a.request(platform);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(j?.error ?? `HTTP ${res.status}`);
        }
        const text = await res.text();
        if (!text.trim()) throw new Error("Script vuoto");
        setScript({ agent: a.label, content: text, ext: a.ext });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore generazione script");
      } finally {
        setBusy(null);
      }
    },
    [platform],
  );

  // Linux/macOS: push via SSH (esegue lo script sull'host, come WinRM su Windows).
  const runSshPush = useCallback(
    async (agentKey: string, label: string) => {
      setBusy(`${agentKey}:push`);
      try {
        const res = await fetch("/api/patch/install-linux-ssh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hostId, agent: agentKey, platform }),
        });
        const data = (await res.json().catch(() => null)) as
          | { operationId?: number; error?: string }
          | null;
        if (!res.ok || typeof data?.operationId !== "number") {
          throw new Error(data?.error ?? `HTTP ${res.status}`);
        }
        setModalTitle(`Installa ${label} — ${hostLabel} (SSH)`);
        setModalOps([{ operationId: data.operationId, hostId, hostLabel }]);
        setModalOpen(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Errore install via SSH");
      } finally {
        setBusy(null);
      }
    },
    [hostId, hostLabel, platform],
  );

  const copyScript = useCallback(() => {
    if (!script) return;
    void navigator.clipboard.writeText(script.content).then(
      () => toast.success("Script copiato"),
      () => toast.error("Copia non riuscita"),
    );
  }, [script]);

  const downloadScript = useCallback(() => {
    if (!script) return;
    const blob = new Blob([script.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `install-${script.agent.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${script.ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [script]);

  const isWin = platform === "windows";

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) setScript(null);
          onOpenChange(o);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Installa agent/moduli</DialogTitle>
            <DialogDescription>
              Su <span className="font-medium text-foreground">{hostLabel}</span>.
              Windows: push WinRM. Linux/macOS: <strong>Installa</strong> = push via SSH
              (credenziali salvate), oppure <strong>Script</strong> da lanciare a mano.
            </DialogDescription>
          </DialogHeader>

          {/* Selettore piattaforma */}
          <div className="flex gap-1 rounded-md bg-muted p-1">
            {PLATFORMS.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  setPlatform(p.key);
                  setScript(null);
                }}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  platform === p.key
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            {isWin
              ? WIN_AGENTS.map((a) => (
                  <div key={a.key} className="flex items-center gap-3 rounded-md border p-3">
                    <div className="text-muted-foreground shrink-0">{a.icon}</div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.label}</div>
                      <div className="text-xs text-muted-foreground">{a.desc}</div>
                    </div>
                    <Button size="sm" className="shrink-0" disabled={busy !== null} onClick={() => void runWinPush(a)}>
                      {busy === a.key ? <Loader2 className="h-4 w-4 animate-spin" /> : "Installa"}
                    </Button>
                  </div>
                ))
              : (
                <>
                  {SCRIPT_AGENTS.map((a) => (
                    <div key={a.key} className="flex items-center gap-3 rounded-md border p-3">
                      <div className="text-muted-foreground shrink-0">{a.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{a.label}</div>
                        <div className="text-xs text-muted-foreground">{a.desc}</div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void runSshPush(a.key, a.label)}
                          title="Installa via SSH (usa le credenziali salvate dell'host)"
                        >
                          {busy === `${a.key}:push` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Installa"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void genScript(a)}
                          title="Genera lo script da lanciare a mano sul target"
                        >
                          {busy === a.key ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <FileTerminal className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground px-1">
                    Chocolatey è solo Windows. Gli script vanno lanciati come root/sudo sul target;
                    l&apos;agente Wazuh richiede il manager configurato in Integrazioni.
                  </p>
                </>
              )}
          </div>

          {script && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Script {script.agent} — {PLATFORMS.find((p) => p.key === platform)?.label}
                </span>
                <div className="flex gap-1">
                  <Button size="xs" variant="outline" onClick={copyScript}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copia
                  </Button>
                  <Button size="xs" variant="outline" onClick={downloadScript}>
                    <Download className="h-3.5 w-3.5 mr-1" /> Scarica
                  </Button>
                </div>
              </div>
              <pre className="max-h-64 overflow-auto rounded-md border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                {script.content}
              </pre>
              <p className="text-xs text-muted-foreground">
                Lancialo sul target come root/sudo. Il token e la config sono già inclusi.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <HostActionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={modalTitle}
        operations={modalOps}
      />
    </>
  );
}

"use client";

/**
 * Dialog "Installa agent/moduli" — riusabile (Discovery kebab, Patch Mgmt, …).
 *
 * Installa gli agent supportati su un host Windows via WinRM riusando gli
 * endpoint /api/patch/* già verificati E2E (bootstrap Chocolatey, MeshAgent
 * choco, GLPI Agent choco, Wazuh). Ogni install ritorna un operationId che
 * viene monitorato con log live dal HostActionModal condiviso.
 *
 * Windows/WinRM-only: la validazione (host Windows + credenziali WinRM) è lato
 * server; qui mostriamo solo un errore chiaro via toast se manca.
 */
import { useCallback, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, Boxes, MonitorSmartphone, PackageSearch, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HostActionModal, type HostActionOperation } from "@/components/patch/host-action-modal";

interface AgentDef {
  key: string;
  label: string;
  desc: string;
  endpoint: string;
  icon: ReactNode;
}

const AGENTS: AgentDef[] = [
  {
    key: "choco",
    label: "Chocolatey",
    desc: "Package manager: prerequisito degli agent choco. Idempotente (skip se già presente).",
    endpoint: "/api/patch/bootstrap",
    icon: <Boxes className="h-4 w-4" />,
  },
  {
    key: "mesh",
    label: "MeshCentral Agent (RMM)",
    desc: "Controllo remoto. Pacchetto choco domarc-meshagent configurato dal server.",
    endpoint: "/api/patch/install-meshagent-choco",
    icon: <MonitorSmartphone className="h-4 w-4" />,
  },
  {
    key: "glpi",
    label: "GLPI Agent (inventario)",
    desc: "Inventario hardware/software con push verso DA-IPAM. Pacchetto choco domarc-glpi-agent.",
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
  const [busy, setBusy] = useState<string | null>(null);
  const [modalOps, setModalOps] = useState<HostActionOperation[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");

  const run = useCallback(
    async (a: AgentDef) => {
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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Installa agent/moduli</DialogTitle>
            <DialogDescription>
              Su <span className="font-medium text-foreground">{hostLabel}</span> via WinRM.
              Richiede host Windows con credenziali WinRM valide.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {AGENTS.map((a) => (
              <div key={a.key} className="flex items-center gap-3 rounded-md border p-3">
                <div className="text-muted-foreground shrink-0">{a.icon}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.label}</div>
                  <div className="text-xs text-muted-foreground">{a.desc}</div>
                </div>
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy !== null}
                  onClick={() => void run(a)}
                >
                  {busy === a.key ? <Loader2 className="h-4 w-4 animate-spin" /> : "Installa"}
                </Button>
              </div>
            ))}
          </div>
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

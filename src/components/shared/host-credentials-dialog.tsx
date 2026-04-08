"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DIALOG_PANEL_COMPACT_CLASS,
} from "@/components/ui/dialog";
import { Key, Plus, Trash2, CheckCircle2, XCircle, Archive, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";

const PROTOCOL_LABELS: Record<string, string> = {
  ssh: "SSH",
  snmp: "SNMP",
  winrm: "WinRM",
  api: "API",
};

const PROTOCOL_COLORS: Record<string, string> = {
  ssh: "bg-emerald-500/15 text-emerald-600 border-emerald-300 dark:text-emerald-400",
  snmp: "bg-purple-500/15 text-purple-600 border-purple-300 dark:text-purple-400",
  winrm: "bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400",
  api: "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400",
};

const PROTOCOL_PORTS: Record<string, number> = {
  ssh: 22,
  snmp: 161,
  winrm: 5985,
  api: 443,
};

interface HostCredential {
  id: number;
  host_id: number;
  credential_id: number;
  protocol_type: string;
  port: number;
  validated: number;
  validated_at: string | null;
  auto_detected: number;
  credential_name: string;
  credential_type: string;
}

interface CredentialOption {
  id: number;
  name: string;
  credential_type: string;
}

interface HostCredentialsDialogProps {
  hostId: number;
  hostIp: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableCredentials: CredentialOption[];
  onCredentialsChanged?: () => void;
}

export function HostCredentialsDialog({
  hostId,
  hostIp,
  open,
  onOpenChange,
  availableCredentials,
  onCredentialsChanged,
}: HostCredentialsDialogProps) {
  const [credentials, setCredentials] = useState<HostCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addCredId, setAddCredId] = useState("");
  const [addProtocol, setAddProtocol] = useState("ssh");
  const [addPort, setAddPort] = useState("22");

  const fetchCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hosts/${hostId}/credentials`);
      if (res.ok) {
        const data = await res.json();
        setCredentials(data.credentials ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [hostId]);

  useEffect(() => {
    if (open) {
      void fetchCredentials();
    }
  }, [open, fetchCredentials]);

  const handleRemove = async (bindingId: number) => {
    try {
      const res = await fetch(`/api/hosts/${hostId}/credentials`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ binding_id: bindingId }),
      });
      if (res.ok) {
        const data = await res.json();
        setCredentials(data.credentials ?? []);
        onCredentialsChanged?.();
        toast.success("Credenziale rimossa");
      }
    } catch {
      toast.error("Errore nella rimozione");
    }
  };

  const handleAdd = async () => {
    if (!addCredId) {
      toast.error("Seleziona una credenziale");
      return;
    }
    try {
      const res = await fetch(`/api/hosts/${hostId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credential_id: Number(addCredId),
          protocol_type: addProtocol,
          port: Number(addPort),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCredentials(data.credentials ?? []);
        onCredentialsChanged?.();
        setShowAdd(false);
        setAddCredId("");
        toast.success("Credenziale aggiunta");
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(typeof err.error === "string" ? err.error : "Errore");
      }
    } catch {
      toast.error("Errore di rete");
    }
  };

  const handleMove = async (index: number, direction: "up" | "down") => {
    const newIdx = direction === "up" ? index - 1 : index + 1;
    if (newIdx < 0 || newIdx >= credentials.length) return;
    const reordered = [...credentials];
    [reordered[index], reordered[newIdx]] = [reordered[newIdx], reordered[index]];
    setCredentials(reordered);
    try {
      const res = await fetch(`/api/hosts/${hostId}/credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reorder",
          binding_ids: reordered.map((c) => c.id),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCredentials(data.credentials ?? reordered);
        onCredentialsChanged?.();
      }
    } catch {
      toast.error("Errore nel riordino");
    }
  };

  const existingCredIds = new Set(credentials.map((c) => c.credential_id));
  const availableForAdd = availableCredentials.filter((c) => !existingCredIds.has(c.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            Credenziali — {hostIp}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-1">
          {loading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Caricamento...</p>
          ) : credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nessuna credenziale associata.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Ordine</TableHead>
                  <TableHead className="w-16">Tipo</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="w-14">Porta</TableHead>
                  <TableHead className="w-16">Stato</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((c, idx) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          disabled={idx === 0}
                          onClick={() => void handleMove(idx, "up")}
                          title="Sposta su"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          disabled={idx === credentials.length - 1}
                          onClick={() => void handleMove(idx, "down")}
                          title="Sposta giù"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-[10px] ${PROTOCOL_COLORS[c.protocol_type] || ""}`}>
                        {PROTOCOL_LABELS[c.protocol_type] || c.protocol_type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Archive className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-sm">{c.credential_name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.port}</TableCell>
                    <TableCell>
                      {c.validated ? (
                        <span title="Validata"><CheckCircle2 className="h-4 w-4 text-green-500" /></span>
                      ) : (
                        <span title="Non validata"><XCircle className="h-4 w-4 text-muted-foreground" /></span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-red-500 hover:text-red-700"
                        onClick={() => void handleRemove(c.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {!showAdd ? (
            <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Aggiungi credenziale
            </Button>
          ) : (
            <div className="space-y-3 border border-border/60 rounded-lg p-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Protocollo</Label>
                  <Select value={addProtocol} onValueChange={(v) => {
                    if (v) {
                      setAddProtocol(v);
                      setAddPort(String(PROTOCOL_PORTS[v] || 22));
                    }
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ssh">SSH</SelectItem>
                      <SelectItem value="snmp">SNMP</SelectItem>
                      <SelectItem value="winrm">WinRM</SelectItem>
                      <SelectItem value="api">API</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Porta</Label>
                  <input
                    type="number"
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono"
                    value={addPort}
                    onChange={(e) => setAddPort(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Credenziale</Label>
                <Select value={addCredId} onValueChange={(v) => setAddCredId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    {availableForAdd.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} ({c.credential_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => { setShowAdd(false); setAddCredId(""); }}>
                  Annulla
                </Button>
                <Button type="button" size="sm" onClick={() => void handleAdd()}>
                  Aggiungi
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

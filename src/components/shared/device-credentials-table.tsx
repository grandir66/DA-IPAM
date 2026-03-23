"use client";

import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { Key, Plus, Trash2, ArrowUp, ArrowDown, RefreshCw, CheckCircle, XCircle, HelpCircle, Archive, Edit3 } from "lucide-react";
import { toast } from "sonner";

interface CredentialBinding {
  id: number;
  device_id: number;
  credential_id: number | null;
  protocol_type: "ssh" | "snmp" | "winrm" | "api";
  port: number;
  sort_order: number;
  inline_username: string | null;
  inline_encrypted_password: string | null;
  test_status: "success" | "failed" | "untested";
  test_message: string | null;
  tested_at: string | null;
  auto_detected: number;
  credential_name?: string | null;
  credential_type?: string | null;
  source: "archive" | "inline";
  inline_username_display?: string | null;
}

interface ArchiveCredential {
  id: number;
  name: string;
  credential_type: string;
}

const PROTOCOL_LABELS: Record<string, string> = {
  ssh: "SSH",
  snmp: "SNMP",
  winrm: "WinRM",
  api: "API",
};

const PROTOCOL_PORTS: Record<string, number> = {
  ssh: 22,
  snmp: 161,
  winrm: 5985,
  api: 443,
};

const STATUS_ICONS = {
  success: <CheckCircle className="h-4 w-4 text-emerald-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  untested: <HelpCircle className="h-4 w-4 text-muted-foreground" />,
};

export function DeviceCredentialsTable({ deviceId }: { deviceId: number }) {
  const [bindings, setBindings] = useState<CredentialBinding[]>([]);
  const [credentials, setCredentials] = useState<ArchiveCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addMode, setAddMode] = useState<"archive" | "inline">("archive");
  const [testing, setTesting] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  // Add form state
  const [addProtocol, setAddProtocol] = useState("ssh");
  const [addPort, setAddPort] = useState(22);
  const [addCredentialId, setAddCredentialId] = useState<string>("");
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  // Edit form state
  const [editProtocol, setEditProtocol] = useState("");
  const [editPort, setEditPort] = useState(22);
  const [editUsername, setEditUsername] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editCredentialId, setEditCredentialId] = useState<string>("");
  const [editSource, setEditSource] = useState<"archive" | "inline">("archive");

  const fetchBindings = useCallback(async () => {
    try {
      const res = await fetch(`/api/devices/${deviceId}/credentials`);
      if (res.ok) setBindings(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  }, [deviceId]);

  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch("/api/credentials");
      if (res.ok) {
        const data = await res.json();
        setCredentials(Array.isArray(data) ? data : data.credentials || []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchBindings(); fetchCredentials(); }, [fetchBindings, fetchCredentials]);

  const handleAdd = async () => {
    const body: Record<string, unknown> = {
      protocol_type: addProtocol,
      port: addPort,
    };
    if (addMode === "archive" && addCredentialId) {
      body.credential_id = Number(addCredentialId);
    } else {
      body.inline_username = addUsername || null;
      body.inline_password = addPassword || null;
    }
    const res = await fetch(`/api/devices/${deviceId}/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast.success("Credenziale aggiunta");
      setShowAddDialog(false);
      resetAddForm();
      fetchBindings();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Errore");
    }
  };

  const resetAddForm = () => {
    setAddProtocol("ssh");
    setAddPort(22);
    setAddCredentialId("");
    setAddUsername("");
    setAddPassword("");
    setAddMode("archive");
  };

  const handleDelete = async (bindingId: number) => {
    const res = await fetch(`/api/devices/${deviceId}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", binding_id: bindingId }),
    });
    if (res.ok) { toast.success("Eliminata"); fetchBindings(); }
  };

  const handleTest = async (bindingId: number) => {
    setTesting(bindingId);
    try {
      const res = await fetch(`/api/devices/${deviceId}/credentials`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", binding_id: bindingId }),
      });
      const result = await res.json();
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
      fetchBindings();
    } catch {
      toast.error("Errore test");
    }
    setTesting(null);
  };

  const handleMove = async (bindingId: number, direction: "up" | "down") => {
    const idx = bindings.findIndex((b) => b.id === bindingId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= bindings.length) return;
    const newOrder = bindings.map((b) => b.id);
    [newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]];
    await fetch(`/api/devices/${deviceId}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reorder", ordered_ids: newOrder }),
    });
    fetchBindings();
  };

  const openEdit = (b: CredentialBinding) => {
    setEditingId(b.id);
    setEditProtocol(b.protocol_type);
    setEditPort(b.port);
    setEditSource(b.source);
    setEditCredentialId(b.credential_id ? String(b.credential_id) : "");
    setEditUsername(b.inline_username_display ?? b.inline_username ?? "");
    setEditPassword("");
  };

  const handleEdit = async () => {
    if (!editingId) return;
    const body: Record<string, unknown> = {
      action: "update",
      binding_id: editingId,
      protocol_type: editProtocol,
      port: editPort,
    };
    if (editSource === "archive" && editCredentialId) {
      body.credential_id = Number(editCredentialId);
    } else {
      body.credential_id = null;
      body.inline_username = editUsername || null;
      if (editPassword) body.inline_password = editPassword;
    }
    const res = await fetch(`/api/devices/${deviceId}/credentials`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast.success("Credenziale aggiornata");
      setEditingId(null);
      fetchBindings();
    } else {
      toast.error("Errore aggiornamento");
    }
  };

  const filteredCreds = (proto: string) =>
    credentials.filter((c) => {
      if (proto === "snmp") return c.credential_type === "snmp";
      if (proto === "winrm") return ["windows", "ssh", "linux"].includes(c.credential_type);
      return ["ssh", "linux", "api"].includes(c.credential_type);
    });

  if (loading) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" />
              Credenziali ({bindings.length})
            </CardTitle>
            <CardDescription>Credenziali assegnate al dispositivo, ordinate per priorita</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => { setAddMode("archive"); setShowAddDialog(true); }}>
              <Archive className="h-3.5 w-3.5 mr-1" />Da archivio
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setAddMode("inline"); setShowAddDialog(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />Inline
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {bindings.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nessuna credenziale assegnata</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Nome / Origine</TableHead>
                <TableHead>Porta</TableHead>
                <TableHead>Stato Test</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bindings.map((b, idx) => (
                <TableRow key={b.id} className={idx === 0 ? "bg-primary/5" : ""}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">{PROTOCOL_LABELS[b.protocol_type] || b.protocol_type}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {b.source === "archive" ? (
                        <>
                          <Archive className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium">{b.credential_name || `#${b.credential_id}`}</span>
                        </>
                      ) : (
                        <>
                          <Edit3 className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-sm font-mono">{b.inline_username_display || b.inline_username || "inline"}</span>
                        </>
                      )}
                      {b.auto_detected === 1 && (
                        <Badge variant="secondary" className="text-[10px]">auto</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{b.port}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {STATUS_ICONS[b.test_status]}
                      <span className="text-xs">
                        {b.test_status === "success" ? "OK" : b.test_status === "failed" ? "Fallito" : "—"}
                      </span>
                      {b.tested_at && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(b.tested_at).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                      )}
                    </div>
                    {b.test_message && b.test_status === "failed" && (
                      <p className="text-[10px] text-red-500 mt-0.5 truncate max-w-[200px]">{b.test_message}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === 0} onClick={() => handleMove(b.id, "up")}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={idx === bindings.length - 1} onClick={() => handleMove(b.id, "down")}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(b)}>
                        <Edit3 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        disabled={testing === b.id}
                        onClick={() => handleTest(b.id)}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${testing === b.id ? "animate-spin" : ""}`} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => handleDelete(b.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {bindings.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            La credenziale #1 e quella principale usata per le operazioni sul dispositivo.
          </p>
        )}
      </CardContent>

      {/* Dialog Aggiungi */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader>
            <DialogTitle>
              {addMode === "archive" ? "Aggiungi da archivio" : "Aggiungi credenziale inline"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Protocollo</Label>
                <Select value={addProtocol} onValueChange={(v) => { if (!v) return; setAddProtocol(v); setAddPort(PROTOCOL_PORTS[v] || 22); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssh">SSH</SelectItem>
                    <SelectItem value="snmp">SNMP</SelectItem>
                    <SelectItem value="winrm">WinRM</SelectItem>
                    <SelectItem value="api">API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Porta</Label>
                <Input type="number" value={addPort} onChange={(e) => setAddPort(Number(e.target.value))} />
              </div>
            </div>

            {addMode === "archive" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Credenziale dall'archivio</Label>
                <Select value={addCredentialId} onValueChange={(v) => setAddCredentialId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Seleziona credenziale..." /></SelectTrigger>
                  <SelectContent>
                    {filteredCreds(addProtocol).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.credential_type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">{addProtocol === "snmp" ? "Community String" : "Username"}</Label>
                  <Input
                    value={addUsername}
                    onChange={(e) => setAddUsername(e.target.value)}
                    placeholder={addProtocol === "snmp" ? "public" : "admin"}
                  />
                </div>
                {addProtocol !== "snmp" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Password</Label>
                    <Input type="password" value={addPassword} onChange={(e) => setAddPassword(e.target.value)} />
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowAddDialog(false); resetAddForm(); }}>Annulla</Button>
              <Button onClick={handleAdd}>Aggiungi</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Modifica */}
      <Dialog open={editingId !== null} onOpenChange={(open) => { if (!open) setEditingId(null); }}>
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader>
            <DialogTitle>Modifica credenziale</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Protocollo</Label>
                <Select value={editProtocol} onValueChange={(v) => { if (!v) return; setEditProtocol(v); setEditPort(PROTOCOL_PORTS[v] || editPort); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ssh">SSH</SelectItem>
                    <SelectItem value="snmp">SNMP</SelectItem>
                    <SelectItem value="winrm">WinRM</SelectItem>
                    <SelectItem value="api">API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Porta</Label>
                <Input type="number" value={editPort} onChange={(e) => setEditPort(Number(e.target.value))} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Origine</Label>
              <Select value={editSource} onValueChange={(v) => setEditSource(v as "archive" | "inline")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="archive">Da archivio</SelectItem>
                  <SelectItem value="inline">Inline</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editSource === "archive" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Credenziale</Label>
                <Select value={editCredentialId} onValueChange={(v) => setEditCredentialId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    {filteredCreds(editProtocol).map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.credential_type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">{editProtocol === "snmp" ? "Community String" : "Username"}</Label>
                  <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
                </div>
                {editProtocol !== "snmp" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Password (lascia vuoto per non cambiare)</Label>
                    <Input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingId(null)}>Annulla</Button>
              <Button onClick={handleEdit}>Salva</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

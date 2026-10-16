"use client";

import { useState } from "react";
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
import { Key, Plus, Trash2, ArrowUp, ArrowDown, Archive, Copy } from "lucide-react";
import { toast } from "sonner";
import { etichettaTipo, normalizzaTipo } from "@/lib/credentials/tipi";
import { vociDAccesso } from "@/lib/credential-protocol-map";

export interface CredentialRow {
  id: number;
  name: string;
  credential_type: string;
}

/** Badge colori per tipo d'archivio (`linux` è `ssh`). */
const TYPE_COLORS: Record<string, string> = {
  ssh: "bg-emerald-500/15 text-emerald-600 border-emerald-300 dark:text-emerald-400",
  windows: "bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400",
  snmp: "bg-purple-500/15 text-purple-600 border-purple-300 dark:text-purple-400",
  snmp_v3: "bg-purple-500/15 text-purple-600 border-purple-300 dark:text-purple-400",
  api: "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400",
};

/** Etichetta corta del badge nella colonna «Tipo» (stretta); le tendine usano quella per esteso. */
const TYPE_LABELS: Record<string, string> = {
  ssh: "SSH",
  windows: "WinRM",
  snmp: "SNMP",
  snmp_v3: "SNMP v3",
  api: "API",
};

/** Tipi che si possono creare da qui: quelli d'accesso, con un utente e una password o una community. */
const TIPI_NUOVA = ["ssh", "windows", "snmp", "api"] as const;

/**
 * Lista unica delle credenziali della rete. La tabella delle quattro catene
 * vecchie (`NetworkCredentialsTableLegacy`) non aveva più chiamanti ed è stata
 * tolta (tappa 2 credenziali, T12).
 */
export interface NetworkCredentialsTableProps {
  credentials: CredentialRow[];
  credentialIds: number[];
  onCredentialIdsChange: (ids: number[]) => void;
  onCredentialsRefresh: () => Promise<void>;
  networkId: number;
  availableSources?: Array<{ id: number; name: string; cidr: string; credential_count: number }>;
}

export function NetworkCredentialsTable({
  credentials,
  credentialIds,
  onCredentialIdsChange,
  onCredentialsRefresh,
  networkId,
  availableSources,
}: NetworkCredentialsTableProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addMode, setAddMode] = useState<"archive" | "inline">("archive");
  const [addCredentialId, setAddCredentialId] = useState("");
  const [addType, setAddType] = useState("ssh");
  const [addName, setAddName] = useState("");
  const [addUser, setAddUser] = useState("");
  const [addPass, setAddPass] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [showCopyDialog, setShowCopyDialog] = useState(false);
  const [copySourceId, setCopySourceId] = useState("");
  const [copying, setCopying] = useState(false);

  const handleRemove = (credId: number) => {
    onCredentialIdsChange(credentialIds.filter((id) => id !== credId));
  };

  const handleMove = (credId: number, direction: "up" | "down") => {
    const arr = [...credentialIds];
    const idx = arr.indexOf(credId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
    onCredentialIdsChange(arr);
  };

  const resetAddForm = () => {
    setAddCredentialId("");
    setAddName("");
    setAddUser("");
    setAddPass("");
  };

  const handleAddFromArchive = () => {
    if (!addCredentialId) {
      toast.error("Seleziona una credenziale dall'archivio");
      return;
    }
    const id = Number(addCredentialId);
    if (credentialIds.includes(id)) {
      toast.error("Credenziale già presente");
      return;
    }
    onCredentialIdsChange([...credentialIds, id]);
    setShowAddDialog(false);
    resetAddForm();
    toast.success("Credenziale aggiunta");
  };

  const handleAddInline = async () => {
    if (!addName.trim()) {
      toast.error("Nome obbligatorio");
      return;
    }
    if (addType === "snmp") {
      if (!addPass.trim()) { toast.error("Community SNMP obbligatoria"); return; }
    } else if (!addUser.trim() || !addPass.trim()) {
      toast.error("Username e password obbligatori");
      return;
    }
    const body: Record<string, unknown> = {
      name: addName.trim(),
      credential_type: addType,
      password: addPass,
    };
    if (addType !== "snmp") body.username = addUser.trim();
    setAddSaving(true);
    try {
      const res = await fetch("/api/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Creazione fallita");
        return;
      }
      const newId = data.id as number | undefined;
      if (newId != null && newId > 0) {
        onCredentialIdsChange([...credentialIds, newId]);
        await onCredentialsRefresh();
        setShowAddDialog(false);
        resetAddForm();
        toast.success("Credenziale creata e aggiunta");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setAddSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!copySourceId) return;
    setCopying(true);
    try {
      if (networkId > 0) {
        // Rete esistente: copia lato server
        const res = await fetch(`/api/networks/${networkId}/credentials`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "copy", source_network_id: Number(copySourceId) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(typeof data.error === "string" ? data.error : "Copia fallita");
          return;
        }
        if (Array.isArray(data.credentials)) {
          onCredentialIdsChange(data.credentials.map((c: { credential_id: number }) => c.credential_id));
        }
        toast.success(`${data.added ?? 0} credenziali importate`);
      } else {
        // Rete non ancora creata: fetch credenziali sorgente e merge locale
        const res = await fetch(`/api/networks/${copySourceId}/credentials`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error("Impossibile leggere credenziali dalla subnet sorgente");
          return;
        }
        const sourceIds = (data.credentials ?? []).map((c: { credential_id: number }) => c.credential_id) as number[];
        const existing = new Set(credentialIds);
        const toAdd = sourceIds.filter((id: number) => !existing.has(id));
        if (toAdd.length > 0) {
          onCredentialIdsChange([...credentialIds, ...toAdd]);
        }
        toast.success(`${toAdd.length} credenziali importate`);
      }
      setShowCopyDialog(false);
      setCopySourceId("");
    } catch {
      toast.error("Errore di rete");
    } finally {
      setCopying(false);
    }
  };

  // Solo voci d'accesso (revisione della 2c): UniFi, Omada e AD il server le
  // rifiuta nella lista della rete, e il PUT annullava tutta la modifica.
  const availableCreds = vociDAccesso(credentials).filter((c) => !credentialIds.includes(c.id));

  return (
    <div className="rounded-lg border border-border/60 bg-card/50">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Key className="h-4 w-4" />
            Credenziali subnet ({credentialIds.length})
          </h3>
          <p className="text-xs text-muted-foreground">Lista unificata, ordinate per priorità. Usate durante la validazione credenziali sugli host.</p>
        </div>
        <div className="flex gap-2">
          {availableSources && availableSources.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setShowCopyDialog(true)}>
              <Copy className="h-3.5 w-3.5 mr-1" />Importa
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => { setAddMode("archive"); setShowAddDialog(true); }}>
            <Archive className="h-3.5 w-3.5 mr-1" />Da archivio
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setAddMode("inline"); setShowAddDialog(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1" />Nuova
          </Button>
        </div>
      </div>
      <div className="px-4 py-2">
        {credentialIds.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nessuna credenziale assegnata. Aggiungine dall&apos;archivio o creane una nuova.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead className="w-20">Tipo</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentialIds.map((credId, idx) => {
                const cred = credentials.find((c) => c.id === credId);
                const ct = normalizzaTipo(cred?.credential_type) ?? "ssh";
                return (
                  <TableRow key={credId} className={idx === 0 ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${TYPE_COLORS[ct] || TYPE_COLORS.ssh}`}>
                        {TYPE_LABELS[ct] || etichettaTipo(ct)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Archive className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">{cred?.name ?? `ID ${credId}`}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={idx === 0} onClick={() => handleMove(credId, "up")}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={idx === credentialIds.length - 1} onClick={() => handleMove(credId, "down")}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => handleRemove(credId)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Dialog Aggiungi */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader>
            <DialogTitle>
              {addMode === "archive" ? "Aggiungi da archivio" : "Nuova credenziale"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            {addMode === "archive" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Credenziale dall&apos;archivio</Label>
                <Select value={addCredentialId} onValueChange={(v) => setAddCredentialId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Seleziona credenziale..." /></SelectTrigger>
                  <SelectContent>
                    {availableCreds.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} ({etichettaTipo(c.credential_type)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableCreds.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nessuna credenziale disponibile. Creane una nuova.</p>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo</Label>
                  <Select value={addType} onValueChange={(v) => { if (v) setAddType(v); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPI_NUOVA.map((t) => (
                        <SelectItem key={t} value={t}>{etichettaTipo(t)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome</Label>
                  <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="es. SSH produzione" />
                </div>
                {addType !== "snmp" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Username</Label>
                    <Input value={addUser} onChange={(e) => setAddUser(e.target.value)} autoComplete="off" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">{addType === "snmp" ? "Community SNMP" : "Password"}</Label>
                  <Input type="password" value={addPass} onChange={(e) => setAddPass(e.target.value)} autoComplete="new-password" />
                </div>
              </>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setShowAddDialog(false); resetAddForm(); }}>Annulla</Button>
              <Button
                type="button"
                disabled={addSaving}
                onClick={() => addMode === "archive" ? handleAddFromArchive() : void handleAddInline()}
              >
                {addSaving ? "Salvataggio…" : "Aggiungi"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog Importa da altra subnet */}
      <Dialog open={showCopyDialog} onOpenChange={setShowCopyDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Importa credenziali da altra subnet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Subnet sorgente</Label>
              <Select value={copySourceId} onValueChange={(v) => setCopySourceId(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Seleziona subnet..." /></SelectTrigger>
                <SelectContent>
                  {availableSources?.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name} ({s.cidr}) — {s.credential_count} credenziali
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Le credenziali già presenti non verranno duplicate.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => { setShowCopyDialog(false); setCopySourceId(""); }}>Annulla</Button>
              <Button type="button" disabled={copying || !copySourceId} onClick={() => void handleCopy()}>
                {copying ? "Importazione…" : "Importa"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

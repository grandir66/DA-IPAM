"use client";

import { useState, useCallback } from "react";
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

export interface CredentialRow {
  id: number;
  name: string;
  credential_type: string;
}

/** Badge colori per tipo credenziale. */
const TYPE_COLORS: Record<string, string> = {
  ssh: "bg-emerald-500/15 text-emerald-600 border-emerald-300 dark:text-emerald-400",
  linux: "bg-orange-500/15 text-orange-600 border-orange-300 dark:text-orange-400",
  windows: "bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400",
  snmp: "bg-purple-500/15 text-purple-600 border-purple-300 dark:text-purple-400",
  api: "bg-amber-500/15 text-amber-600 border-amber-300 dark:text-amber-400",
};

const TYPE_LABELS: Record<string, string> = {
  ssh: "SSH",
  linux: "Linux",
  windows: "WinRM",
  snmp: "SNMP",
  api: "API",
};

// ── Props v1 (legacy 4 catene) ──
export interface NetworkCredentialsTablePropsLegacy {
  credentials: CredentialRow[];
  windowsIds: number[];
  linuxIds: number[];
  sshIds: number[];
  snmpIds: number[];
  onWindowsChange: (ids: number[]) => void;
  onLinuxChange: (ids: number[]) => void;
  onSshChange: (ids: number[]) => void;
  onSnmpChange: (ids: number[]) => void;
  onCredentialsRefresh: () => Promise<void>;
  // v2 fields — assenti in legacy
  credentialIds?: never;
  onCredentialIdsChange?: never;
  networkId?: never;
  availableSources?: never;
}

// ── Props v2 (lista unificata) ──
export interface NetworkCredentialsTablePropsV2 {
  credentials: CredentialRow[];
  credentialIds: number[];
  onCredentialIdsChange: (ids: number[]) => void;
  onCredentialsRefresh: () => Promise<void>;
  networkId: number;
  availableSources?: Array<{ id: number; name: string; cidr: string; credential_count: number }>;
  // Legacy fields — assenti in v2
  windowsIds?: never;
  linuxIds?: never;
  sshIds?: never;
  snmpIds?: never;
  onWindowsChange?: never;
  onLinuxChange?: never;
  onSshChange?: never;
  onSnmpChange?: never;
}

export type NetworkCredentialsTableProps = NetworkCredentialsTablePropsLegacy | NetworkCredentialsTablePropsV2;

function isV2(props: NetworkCredentialsTableProps): props is NetworkCredentialsTablePropsV2 {
  return "credentialIds" in props && props.credentialIds !== undefined;
}

export function NetworkCredentialsTable(props: NetworkCredentialsTableProps) {
  if (isV2(props)) {
    return <NetworkCredentialsTableV2 {...props} />;
  }
  return <NetworkCredentialsTableLegacy {...props} />;
}

// ═══════════════════════════════════════════════════════════════════════════
// V2: Lista unificata
// ═══════════════════════════════════════════════════════════════════════════

function NetworkCredentialsTableV2({
  credentials,
  credentialIds,
  onCredentialIdsChange,
  onCredentialsRefresh,
  networkId,
  availableSources,
}: NetworkCredentialsTablePropsV2) {
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

  const availableCreds = credentials.filter((c) => !credentialIds.includes(c.id));

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
                const ct = cred?.credential_type || "ssh";
                return (
                  <TableRow key={credId} className={idx === 0 ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${TYPE_COLORS[ct] || TYPE_COLORS.ssh}`}>
                        {TYPE_LABELS[ct] || ct.toUpperCase()}
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
                        {c.name} ({TYPE_LABELS[c.credential_type] || c.credential_type})
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
                      <SelectItem value="ssh">SSH</SelectItem>
                      <SelectItem value="linux">Linux</SelectItem>
                      <SelectItem value="windows">Windows (WinRM)</SelectItem>
                      <SelectItem value="snmp">SNMP</SelectItem>
                      <SelectItem value="api">API</SelectItem>
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
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
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

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY: 4 catene separate (backward compat durante transizione)
// ═══════════════════════════════════════════════════════════════════════════

type Role = "windows" | "linux" | "ssh" | "snmp";

interface FlatEntry {
  role: Role;
  credentialId: number;
}

const ROLE_LABELS: Record<Role, string> = {
  windows: "WinRM",
  linux: "Linux",
  ssh: "SSH",
  snmp: "SNMP",
};

const ROLE_COLORS: Record<Role, string> = {
  windows: "bg-blue-500/15 text-blue-600 border-blue-300 dark:text-blue-400",
  linux: "bg-orange-500/15 text-orange-600 border-orange-300 dark:text-orange-400",
  ssh: "bg-emerald-500/15 text-emerald-600 border-emerald-300 dark:text-emerald-400",
  snmp: "bg-purple-500/15 text-purple-600 border-purple-300 dark:text-purple-400",
};

function matchesRole(credentialType: string, role: Role): boolean {
  const t = credentialType.toLowerCase();
  if (role === "windows") return t === "windows";
  if (role === "linux") return t === "linux";
  if (role === "ssh") return t === "ssh" || t === "linux" || t === "api";
  return t === "snmp";
}

function NetworkCredentialsTableLegacy({
  credentials,
  windowsIds,
  linuxIds,
  sshIds,
  snmpIds,
  onWindowsChange,
  onLinuxChange,
  onSshChange,
  onSnmpChange,
  onCredentialsRefresh,
}: NetworkCredentialsTablePropsLegacy) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addMode, setAddMode] = useState<"archive" | "inline">("archive");
  const [addRole, setAddRole] = useState<Role>("windows");
  const [addCredentialId, setAddCredentialId] = useState("");
  const [addName, setAddName] = useState("");
  const [addUser, setAddUser] = useState("");
  const [addPass, setAddPass] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  const buildFlat = useCallback((): FlatEntry[] => {
    const flat: FlatEntry[] = [];
    for (const id of windowsIds) flat.push({ role: "windows", credentialId: id });
    for (const id of linuxIds) flat.push({ role: "linux", credentialId: id });
    for (const id of sshIds) flat.push({ role: "ssh", credentialId: id });
    for (const id of snmpIds) flat.push({ role: "snmp", credentialId: id });
    return flat;
  }, [windowsIds, linuxIds, sshIds, snmpIds]);

  const flat = buildFlat();

  const getChain = (role: Role): number[] => {
    if (role === "windows") return windowsIds;
    if (role === "linux") return linuxIds;
    if (role === "ssh") return sshIds;
    return snmpIds;
  };

  const setChain = (role: Role, ids: number[]) => {
    if (role === "windows") onWindowsChange(ids);
    else if (role === "linux") onLinuxChange(ids);
    else if (role === "ssh") onSshChange(ids);
    else onSnmpChange(ids);
  };

  const handleRemove = (entry: FlatEntry) => {
    const chain = getChain(entry.role);
    setChain(entry.role, chain.filter((id) => id !== entry.credentialId));
  };

  const handleMove = (entry: FlatEntry, direction: "up" | "down") => {
    const chain = [...getChain(entry.role)];
    const idx = chain.indexOf(entry.credentialId);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= chain.length) return;
    [chain[idx], chain[swapIdx]] = [chain[swapIdx], chain[idx]];
    setChain(entry.role, chain);
  };

  const getPositionInChain = (entry: FlatEntry): { idx: number; total: number } => {
    const chain = getChain(entry.role);
    return { idx: chain.indexOf(entry.credentialId), total: chain.length };
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
    const chain = getChain(addRole);
    if (chain.includes(id)) {
      toast.error("Credenziale già presente nella catena");
      return;
    }
    setChain(addRole, [...chain, id]);
    setShowAddDialog(false);
    resetAddForm();
    toast.success("Credenziale aggiunta");
  };

  const handleAddInline = async () => {
    const ctype = addRole === "windows" ? "windows" : addRole === "linux" ? "linux" : addRole === "ssh" ? "ssh" : "snmp";
    if (!addName.trim()) {
      toast.error("Nome obbligatorio");
      return;
    }
    if (ctype === "snmp") {
      if (!addPass.trim()) { toast.error("Community SNMP obbligatoria"); return; }
    } else if (!addUser.trim() || !addPass.trim()) {
      toast.error("Username e password obbligatori");
      return;
    }
    const body: Record<string, unknown> = {
      name: addName.trim(),
      credential_type: ctype,
      password: addPass,
    };
    if (ctype !== "snmp") body.username = addUser.trim();
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
        const chain = getChain(addRole);
        setChain(addRole, [...chain, newId]);
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

  const filteredCreds = credentials.filter((c) => matchesRole(c.credential_type, addRole));
  const availableCreds = filteredCreds.filter((c) => !getChain(addRole).includes(c.id));

  return (
    <div className="rounded-lg border border-border/60 bg-card/50">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Key className="h-4 w-4" />
            Credenziali rilevamento ({flat.length})
          </h3>
          <p className="text-xs text-muted-foreground">Credenziali per scansione host, ordinate per priorità per ciascun ruolo</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => { setAddMode("archive"); setShowAddDialog(true); }}>
            <Archive className="h-3.5 w-3.5 mr-1" />Da archivio
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => { setAddMode("inline"); setShowAddDialog(true); }}>
            <Plus className="h-3.5 w-3.5 mr-1" />Inline
          </Button>
        </div>
      </div>
      <div className="px-4 py-2">
        {flat.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nessuna credenziale assegnata. Verranno usate solo le impostazioni globali, se presenti.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead className="w-20">Ruolo</TableHead>
                <TableHead>Nome / Origine</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flat.map((entry) => {
                const cred = credentials.find((c) => c.id === entry.credentialId);
                const pos = getPositionInChain(entry);
                return (
                  <TableRow key={`${entry.role}-${entry.credentialId}`} className={pos.idx === 0 ? "bg-primary/5" : ""}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{pos.idx + 1}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs ${ROLE_COLORS[entry.role]}`}>
                        {ROLE_LABELS[entry.role]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Archive className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">{cred?.name ?? `ID ${entry.credentialId}`}</span>
                        {cred && (
                          <span className="text-[10px] text-muted-foreground uppercase">({cred.credential_type})</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={pos.idx === 0} onClick={() => handleMove(entry, "up")}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={pos.idx === pos.total - 1} onClick={() => handleMove(entry, "down")}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700" onClick={() => handleRemove(entry)}>
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
        {flat.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            La credenziale #1 di ciascun ruolo è quella principale usata per il rilevamento host.
          </p>
        )}
      </div>

      {/* Dialog Aggiungi */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className={DIALOG_PANEL_COMPACT_CLASS}>
          <DialogHeader>
            <DialogTitle>
              {addMode === "archive" ? "Aggiungi da archivio" : "Nuova credenziale inline"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Ruolo</Label>
              <Select value={addRole} onValueChange={(v) => { if (v) { setAddRole(v as Role); setAddCredentialId(""); } }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="windows">WinRM — host Windows</SelectItem>
                  <SelectItem value="linux">Linux — rilevamento OS</SelectItem>
                  <SelectItem value="ssh">SSH — dispositivi / appliance</SelectItem>
                  <SelectItem value="snmp">SNMP — community</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {addMode === "archive" ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Credenziale dall&apos;archivio</Label>
                <Select value={addCredentialId} onValueChange={(v) => setAddCredentialId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Seleziona credenziale..." /></SelectTrigger>
                  <SelectContent>
                    {availableCreds.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name} ({c.credential_type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {availableCreds.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nessuna credenziale compatibile disponibile. Creane una inline.</p>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nome in archivio</Label>
                  <Input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="es. WinRM produzione" />
                </div>
                {addRole !== "snmp" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Username</Label>
                    <Input value={addUser} onChange={(e) => setAddUser(e.target.value)} autoComplete="off" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">{addRole === "snmp" ? "Community SNMP" : "Password"}</Label>
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
    </div>
  );
}

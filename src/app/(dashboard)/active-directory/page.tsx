"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Users,
  FolderTree,
  RefreshCw,
  Plus,
  Trash2,
  TestTube,
  Link,
  Monitor,
  Shield,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Wifi,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/shared/pagination";
import { SkeletonTable } from "@/components/shared/skeleton-table";

interface AdIntegration {
  id: number;
  name: string;
  dc_host: string;
  domain: string;
  base_dn: string;
  use_ssl: number;
  port: number;
  enabled: number;
  winrm_credential_id: number | null;
  dhcp_leases_count: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  computers_count: number;
  users_count: number;
  groups_count: number;
}

interface AdComputer {
  id: number;
  sam_account_name: string;
  dns_host_name: string | null;
  display_name: string | null;
  operating_system: string | null;
  operating_system_version: string | null;
  last_logon_at: string | null;
  enabled: number;
  host_id: number | null;
  ip_address: string | null;
  ou: string | null;
}

interface AdUser {
  id: number;
  sam_account_name: string;
  user_principal_name: string | null;
  display_name: string | null;
  email: string | null;
  department: string | null;
  title: string | null;
  phone: string | null;
  ou: string | null;
  enabled: number;
  last_logon_at: string | null;
}

interface AdGroup {
  id: number;
  sam_account_name: string;
  display_name: string | null;
  description: string | null;
  group_type: number | null;
}

interface AdDhcpLease {
  id: number;
  scope_id: string;
  scope_name: string | null;
  ip_address: string;
  mac_address: string;
  hostname: string | null;
  lease_expires: string | null;
  address_state: string | null;
}

interface WinrmCredential {
  id: number;
  name: string;
}

const defaultForm = {
  name: "",
  dc_host: "",
  domain: "",
  base_dn: "",
  username: "",
  password: "",
  use_ssl: true,
  port: 636,
  enabled: true,
  winrm_credential_id: null as number | null,
};

export default function ActiveDirectoryPage() {
  const router = useRouter();
  const [integrations, setIntegrations] = useState<AdIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<AdIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  const [computers, setComputers] = useState<AdComputer[]>([]);
  const [computersTotal, setComputersTotal] = useState(0);
  const [computersPage, setComputersPage] = useState(1);
  const [computersSearch, setComputersSearch] = useState("");
  const [computersActiveOnly, setComputersActiveOnly] = useState(true);

  const [users, setUsers] = useState<AdUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersPage, setUsersPage] = useState(1);
  const [usersSearch, setUsersSearch] = useState("");
  const [usersActiveOnly, setUsersActiveOnly] = useState(true);

  const [groups, setGroups] = useState<AdGroup[]>([]);
  const [groupsTotal, setGroupsTotal] = useState(0);
  const [groupsPage, setGroupsPage] = useState(1);
  const [groupsSearch, setGroupsSearch] = useState("");

  const [dhcpLeases, setDhcpLeases] = useState<AdDhcpLease[]>([]);
  const [dhcpTotal, setDhcpTotal] = useState(0);
  const [dhcpPage, setDhcpPage] = useState(1);
  const [dhcpSearch, setDhcpSearch] = useState("");

  const [winrmCredentials, setWinrmCredentials] = useState<WinrmCredential[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({ ...defaultForm, username: "", password: "" });
  const [editSaving, setEditSaving] = useState(false);

  const pageSize = 25;

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch("/api/ad");
      if (!res.ok) throw new Error("Errore caricamento integrazioni");
      const data: AdIntegration[] = await res.json();
      setIntegrations(data);
      setSelectedIntegration((prev) => {
        if (prev) return data.find((i) => i.id === prev.id) ?? prev;
        return data.length > 0 ? data[0] : null;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWinrmCredentials = useCallback(async () => {
    try {
      const res = await fetch("/api/credentials");
      if (!res.ok) return;
      const data: Array<{ id: number; name: string; credential_type: string }> = await res.json();
      setWinrmCredentials(data.filter((c) => c.credential_type === "windows").map((c) => ({ id: c.id, name: c.name })));
    } catch { /* ignora */ }
  }, []);

  const fetchComputers = useCallback(async () => {
    if (!selectedIntegration) return;
    try {
      const params = new URLSearchParams({
        page: String(computersPage),
        pageSize: String(pageSize),
        ...(computersSearch ? { search: computersSearch } : {}),
        ...(computersActiveOnly ? { activeDays: "90" } : {}),
      });
      const res = await fetch(`/api/ad/${selectedIntegration.id}/computers?${params}`);
      if (!res.ok) throw new Error("Errore caricamento computer");
      const data = await res.json();
      setComputers(data.rows);
      setComputersTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }, [selectedIntegration, computersPage, computersSearch, computersActiveOnly]);

  const fetchUsers = useCallback(async () => {
    if (!selectedIntegration) return;
    try {
      const params = new URLSearchParams({
        page: String(usersPage),
        pageSize: String(pageSize),
        ...(usersSearch ? { search: usersSearch } : {}),
        ...(usersActiveOnly ? { activeDays: "90" } : {}),
      });
      const res = await fetch(`/api/ad/${selectedIntegration.id}/users?${params}`);
      if (!res.ok) throw new Error("Errore caricamento utenti");
      const data = await res.json();
      setUsers(data.rows);
      setUsersTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }, [selectedIntegration, usersPage, usersSearch, usersActiveOnly]);

  const fetchGroups = useCallback(async () => {
    if (!selectedIntegration) return;
    try {
      const params = new URLSearchParams({
        page: String(groupsPage),
        pageSize: String(pageSize),
        ...(groupsSearch ? { search: groupsSearch } : {}),
      });
      const res = await fetch(`/api/ad/${selectedIntegration.id}/groups?${params}`);
      if (!res.ok) throw new Error("Errore caricamento gruppi");
      const data = await res.json();
      setGroups(data.rows);
      setGroupsTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }, [selectedIntegration, groupsPage, groupsSearch]);

  const fetchDhcpLeases = useCallback(async () => {
    if (!selectedIntegration) return;
    try {
      const params = new URLSearchParams({
        page: String(dhcpPage),
        pageSize: String(pageSize),
        ...(dhcpSearch ? { search: dhcpSearch } : {}),
      });
      const res = await fetch(`/api/ad/${selectedIntegration.id}/dhcp-leases?${params}`);
      if (!res.ok) throw new Error("Errore caricamento DHCP");
      const data = await res.json();
      setDhcpLeases(data.rows);
      setDhcpTotal(data.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }, [selectedIntegration, dhcpPage, dhcpSearch]);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);
  useEffect(() => { fetchWinrmCredentials(); }, [fetchWinrmCredentials]);
  useEffect(() => { fetchComputers(); }, [fetchComputers]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => { fetchDhcpLeases(); }, [fetchDhcpLeases]);

  const handleSync = async (id: number) => {
    setSyncing(id);
    try {
      const res = await fetch(`/api/ad/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore sync");
      const dhcpPart = data.dhcp_leases > 0 ? `, ${data.dhcp_leases} lease DHCP` : "";
      const dnsPart = data.dns_resolved > 0 ? `, ${data.dns_resolved} IP risolti` : "";
      const hostPart = (data.hosts_created > 0 || data.hosts_enriched > 0)
        ? `, ${data.hosts_created} host creati, ${data.hosts_enriched} arricchiti` : "";
      toast.success(`Sincronizzazione completata: ${data.computers} computer, ${data.users} utenti, ${data.groups} gruppi${dhcpPart}${dnsPart}${hostPart}`);
      fetchIntegrations();
      fetchComputers();
      fetchUsers();
      fetchGroups();
      fetchDhcpLeases();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setSyncing(null);
    }
  };

  const handleTest = async (id: number) => {
    setTesting(id);
    try {
      const res = await fetch(`/api/ad/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
      } else {
        toast.error(data.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Eliminare questa integrazione AD?")) return;
    try {
      const res = await fetch(`/api/ad/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Errore eliminazione");
      toast.success("Integrazione eliminata");
      setIntegrations((prev) => prev.filter((i) => i.id !== id));
      if (selectedIntegration?.id === id) {
        setSelectedIntegration(integrations.find((i) => i.id !== id) ?? null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore creazione");
      toast.success("Integrazione creata");
      setDialogOpen(false);
      setForm(defaultForm);
      fetchIntegrations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (integration: AdIntegration) => {
    setEditForm({
      name: integration.name,
      dc_host: integration.dc_host,
      domain: integration.domain,
      base_dn: integration.base_dn,
      username: "",
      password: "",
      use_ssl: !!integration.use_ssl,
      port: integration.port,
      enabled: !!integration.enabled,
      winrm_credential_id: integration.winrm_credential_id,
    });
    setEditDialogOpen(true);
  };

  const handleEdit = async () => {
    if (!selectedIntegration) return;
    setEditSaving(true);
    try {
      // Invia solo i campi effettivamente compilati; username/password solo se non vuoti
      const payload: Record<string, unknown> = {
        name: editForm.name,
        dc_host: editForm.dc_host,
        domain: editForm.domain,
        base_dn: editForm.base_dn,
        use_ssl: editForm.use_ssl,
        port: editForm.port,
        enabled: editForm.enabled,
        winrm_credential_id: editForm.winrm_credential_id,
      };
      if (editForm.username.trim()) payload.username = editForm.username;
      if (editForm.password.trim()) payload.password = editForm.password;

      const res = await fetch(`/api/ad/${selectedIntegration.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore aggiornamento");
      toast.success("Integrazione aggiornata");
      setEditDialogOpen(false);
      // Aggiorna subito selectedIntegration con i dati freschi dalla risposta PUT
      setSelectedIntegration(data);
      setIntegrations((prev) => prev.map((i) => (i.id === data.id ? data : i)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setEditSaving(false);
    }
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("it-IT");
    } catch {
      return iso;
    }
  };

  const groupTypeLabel = (gt: number | null) => {
    if (gt === null) return "—";
    const isSecurityGroup = (gt & 0x80000000) !== 0;
    return isSecurityGroup ? "Security" : "Distribution";
  };

  const dhcpStateVariant = (state: string | null): "default" | "secondary" | "destructive" | "outline" => {
    if (!state) return "outline";
    const s = state.toLowerCase();
    if (s === "active") return "default";
    if (s.includes("reserv")) return "secondary";
    if (s.includes("expir") || s.includes("declin")) return "destructive";
    return "outline";
  };

  if (loading) {
    return (
      <div className="p-6">
        <SkeletonTable rows={5} columns={4} />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 space-y-6"
    >
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderTree className="w-6 h-6 text-primary" />
          Active Directory
        </h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button><Plus className="w-4 h-4 mr-2" />Nuova integrazione</Button>} />
          <DialogContent className="sm:max-w-[540px]">
            <DialogHeader>
              <DialogTitle>Nuova integrazione Active Directory</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Nome</label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Es. Dominio principale"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Dominio</label>
                  <Input
                    value={form.domain}
                    onChange={(e) => setForm({ ...form, domain: e.target.value })}
                    placeholder="Es. example.local"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Domain Controller</label>
                  <Input
                    value={form.dc_host}
                    onChange={(e) => setForm({ ...form, dc_host: e.target.value })}
                    placeholder="Es. dc01.example.local"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Porta</label>
                  <Input
                    type="number"
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 636 })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Base DN</label>
                <Input
                  value={form.base_dn}
                  onChange={(e) => setForm({ ...form, base_dn: e.target.value })}
                  placeholder="Es. DC=example,DC=local"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Username LDAP</label>
                  <Input
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    placeholder="Es. DOMAIN\\admin o admin@example.local"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Password LDAP</label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Wifi className="w-3.5 h-3.5" />
                  Credenziale WinRM (opzionale — per DHCP Windows Server)
                </label>
                <Select
                  value={form.winrm_credential_id?.toString() ?? "none"}
                  onValueChange={(v) => setForm({ ...form, winrm_credential_id: v === "none" || !v ? null : parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nessuna (DHCP disabilitato)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nessuna (DHCP disabilitato)</SelectItem>
                    {winrmCredentials.map((c) => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Se il DC ha il ruolo DHCP Server, seleziona una credenziale Windows per importare i lease.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.use_ssl}
                    onCheckedChange={(c) => setForm({ ...form, use_ssl: !!c, port: c ? 636 : 389 })}
                  />
                  Usa LDAPS (SSL)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={form.enabled}
                    onCheckedChange={(c) => setForm({ ...form, enabled: !!c })}
                  />
                  Abilitata
                </label>
              </div>
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline">Annulla</Button>} />
              <Button onClick={handleCreate} disabled={saving || !form.name || !form.dc_host || !form.base_dn || !form.username || !form.password}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Crea
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      {/* Dialog modifica integrazione */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>Modifica integrazione Active Directory</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Nome</label>
                <Input
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  placeholder="Es. Dominio principale"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Dominio</label>
                <Input
                  value={editForm.domain}
                  onChange={(e) => setEditForm({ ...editForm, domain: e.target.value })}
                  placeholder="Es. example.local"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Domain Controller</label>
                <Input
                  value={editForm.dc_host}
                  onChange={(e) => setEditForm({ ...editForm, dc_host: e.target.value })}
                  placeholder="Es. dc01.example.local"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Porta</label>
                <Input
                  type="number"
                  value={editForm.port}
                  onChange={(e) => setEditForm({ ...editForm, port: parseInt(e.target.value) || 636 })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Base DN</label>
              <Input
                value={editForm.base_dn}
                onChange={(e) => setEditForm({ ...editForm, base_dn: e.target.value })}
                placeholder="Es. DC=example,DC=local"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Username LDAP</label>
                <Input
                  value={editForm.username}
                  onChange={(e) => setEditForm({ ...editForm, username: e.target.value })}
                  placeholder="Lascia vuoto per non modificare"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Password LDAP</label>
                <Input
                  type="password"
                  value={editForm.password}
                  onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  placeholder="Lascia vuoto per non modificare"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground -mt-2">
              Lascia username e password vuoti per mantenere le credenziali esistenti.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Wifi className="w-3.5 h-3.5" />
                Credenziale WinRM (opzionale — per DHCP Windows Server)
              </label>
              <Select
                value={editForm.winrm_credential_id?.toString() ?? "none"}
                onValueChange={(v) => setEditForm({ ...editForm, winrm_credential_id: v === "none" || !v ? null : parseInt(v) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nessuna (DHCP disabilitato)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuna (DHCP disabilitato)</SelectItem>
                  {winrmCredentials.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={editForm.use_ssl}
                  onCheckedChange={(c) => setEditForm({ ...editForm, use_ssl: !!c, port: c ? 636 : 389 })}
                />
                Usa LDAPS (SSL)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={editForm.enabled}
                  onCheckedChange={(c) => setEditForm({ ...editForm, enabled: !!c })}
                />
                Abilitata
              </label>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Annulla</Button>} />
            <Button onClick={handleEdit} disabled={editSaving || !editForm.name || !editForm.dc_host || !editForm.base_dn}>
              {editSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>

      {integrations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FolderTree className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>Nessuna integrazione Active Directory configurata.</p>
            <p className="text-sm mt-2">Clicca &quot;Nuova integrazione&quot; per iniziare.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-4 mb-4">
            <label className="text-sm font-medium">Integrazione:</label>
            <Select
              value={selectedIntegration?.id.toString() ?? ""}
              onValueChange={(v) => {
                const int = integrations.find((i) => i.id === parseInt(v ?? "0"));
                setSelectedIntegration(int ?? null);
                setComputersPage(1);
                setUsersPage(1);
                setGroupsPage(1);
                setDhcpPage(1);
              }}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Seleziona integrazione" />
              </SelectTrigger>
              <SelectContent>
                {integrations.map((i) => (
                  <SelectItem key={i.id} value={i.id.toString()}>
                    {i.name} ({i.domain})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedIntegration && (
              <div className="flex items-center gap-2 ml-auto">
                <Badge variant={selectedIntegration.enabled ? "default" : "secondary"}>
                  {selectedIntegration.enabled ? "Abilitata" : "Disabilitata"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEditDialog(selectedIntegration)}
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  Modifica
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleTest(selectedIntegration.id)}
                  disabled={testing === selectedIntegration.id}
                >
                  {testing === selectedIntegration.id ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <TestTube className="w-4 h-4 mr-2" />
                  )}
                  Test
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSync(selectedIntegration.id)}
                  disabled={syncing === selectedIntegration.id}
                >
                  {syncing === selectedIntegration.id ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Sincronizza
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(selectedIntegration.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {selectedIntegration && (
            <>
              <div className="grid grid-cols-5 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Computer</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold flex items-center gap-2">
                      <Monitor className="w-5 h-5 text-blue-500" />
                      {selectedIntegration.computers_count}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Utenti</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold flex items-center gap-2">
                      <Users className="w-5 h-5 text-green-500" />
                      {selectedIntegration.users_count}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Gruppi</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold flex items-center gap-2">
                      <Shield className="w-5 h-5 text-amber-500" />
                      {selectedIntegration.groups_count}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">DHCP Lease</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold flex items-center gap-2">
                      <Wifi className="w-5 h-5 text-purple-500" />
                      {selectedIntegration.dhcp_leases_count ?? 0}
                    </div>
                    {!selectedIntegration.winrm_credential_id && (
                      <p className="text-[10px] text-muted-foreground mt-1">WinRM non configurato</p>
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Ultima sync</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm font-medium flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      {formatDate(selectedIntegration.last_sync_at)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 truncate" title={selectedIntegration.last_sync_status ?? ""}>
                      {selectedIntegration.last_sync_status ?? "—"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Tabs defaultValue="computers" className="mt-6">
                <TabsList>
                  <TabsTrigger value="computers" className="flex items-center gap-2">
                    <Monitor className="w-4 h-4" />
                    Computer ({selectedIntegration.computers_count})
                  </TabsTrigger>
                  <TabsTrigger value="users" className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Utenti ({selectedIntegration.users_count})
                  </TabsTrigger>
                  <TabsTrigger value="groups" className="flex items-center gap-2">
                    <Shield className="w-4 h-4" />
                    Gruppi ({selectedIntegration.groups_count})
                  </TabsTrigger>
                  <TabsTrigger value="dhcp" className="flex items-center gap-2">
                    <Wifi className="w-4 h-4" />
                    DHCP ({selectedIntegration.dhcp_leases_count ?? 0})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="computers" className="mt-4">
                  <div className="flex items-center gap-4 mb-4">
                    <Input
                      placeholder="Cerca computer..."
                      value={computersSearch}
                      onChange={(e) => {
                        setComputersSearch(e.target.value);
                        setComputersPage(1);
                      }}
                      className="max-w-sm"
                    />
                    <Button
                      variant={computersActiveOnly ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setComputersActiveOnly((v) => !v); setComputersPage(1); }}
                    >
                      {computersActiveOnly ? "Attivi (90gg)" : "Tutti"}
                    </Button>
                    {computersActiveOnly && (
                      <span className="text-xs text-muted-foreground">Solo logon negli ultimi 90 giorni</span>
                    )}
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-3 text-left font-medium">Nome</th>
                          <th className="p-3 text-left font-medium">DNS / IP</th>
                          <th className="p-3 text-left font-medium">OS</th>
                          <th className="p-3 text-left font-medium">OU</th>
                          <th className="p-3 text-left font-medium">Ultimo logon</th>
                          <th className="p-3 text-left font-medium">Stato</th>
                          <th className="p-3 text-left font-medium">Collegato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {computers.map((c) => (
                          <tr key={c.id} className="border-t hover:bg-muted/30">
                            <td className="p-3 font-medium">{c.sam_account_name}</td>
                            <td className="p-3 text-muted-foreground">
                              <div>{c.dns_host_name ?? "—"}</div>
                              {c.ip_address && <div className="text-xs font-mono">{c.ip_address}</div>}
                            </td>
                            <td className="p-3">{c.operating_system ?? "—"}</td>
                            <td className="p-3 text-muted-foreground text-xs">{c.ou ?? "—"}</td>
                            <td className="p-3 text-muted-foreground">{formatDate(c.last_logon_at)}</td>
                            <td className="p-3">
                              {c.enabled ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-500" />
                              )}
                            </td>
                            <td className="p-3">
                              {c.host_id ? (
                                <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => router.push(`/hosts/${c.host_id}`)}>
                                  <Link className="w-4 h-4 mr-1" />
                                  Host #{c.host_id}
                                </Button>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {computers.length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-8 text-center text-muted-foreground">
                              Nessun computer trovato
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4">
                    <Pagination
                      page={computersPage}
                      totalPages={Math.ceil(computersTotal / pageSize)}
                      onPageChange={setComputersPage}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="users" className="mt-4">
                  <div className="flex items-center gap-4 mb-4">
                    <Input
                      placeholder="Cerca utenti..."
                      value={usersSearch}
                      onChange={(e) => {
                        setUsersSearch(e.target.value);
                        setUsersPage(1);
                      }}
                      className="max-w-sm"
                    />
                    <Button
                      variant={usersActiveOnly ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setUsersActiveOnly((v) => !v); setUsersPage(1); }}
                    >
                      {usersActiveOnly ? "Attivi (90gg)" : "Tutti"}
                    </Button>
                    {usersActiveOnly && (
                      <span className="text-xs text-muted-foreground">Solo logon negli ultimi 90 giorni</span>
                    )}
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-3 text-left font-medium">Username</th>
                          <th className="p-3 text-left font-medium">Nome</th>
                          <th className="p-3 text-left font-medium">Email</th>
                          <th className="p-3 text-left font-medium">Reparto / Ruolo</th>
                          <th className="p-3 text-left font-medium">Telefono</th>
                          <th className="p-3 text-left font-medium">OU</th>
                          <th className="p-3 text-left font-medium">Ultimo logon</th>
                          <th className="p-3 text-left font-medium">Stato</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((u) => (
                          <tr key={u.id} className="border-t hover:bg-muted/30">
                            <td className="p-3 font-medium">{u.sam_account_name}</td>
                            <td className="p-3">{u.display_name ?? "—"}</td>
                            <td className="p-3 text-muted-foreground">{u.email ?? "—"}</td>
                            <td className="p-3">
                              {u.department && <div>{u.department}</div>}
                              {u.title && <div className="text-xs text-muted-foreground">{u.title}</div>}
                              {!u.department && !u.title && "—"}
                            </td>
                            <td className="p-3 text-muted-foreground">{u.phone ?? "—"}</td>
                            <td className="p-3 text-muted-foreground text-xs">{u.ou ?? "—"}</td>
                            <td className="p-3 text-muted-foreground">{formatDate(u.last_logon_at)}</td>
                            <td className="p-3">
                              {u.enabled ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-500" />
                              )}
                            </td>
                          </tr>
                        ))}
                        {users.length === 0 && (
                          <tr>
                            <td colSpan={8} className="p-8 text-center text-muted-foreground">
                              Nessun utente trovato
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4">
                    <Pagination
                      page={usersPage}
                      totalPages={Math.ceil(usersTotal / pageSize)}
                      onPageChange={setUsersPage}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="groups" className="mt-4">
                  <div className="flex items-center gap-4 mb-4">
                    <Input
                      placeholder="Cerca gruppi..."
                      value={groupsSearch}
                      onChange={(e) => {
                        setGroupsSearch(e.target.value);
                        setGroupsPage(1);
                      }}
                      className="max-w-sm"
                    />
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="p-3 text-left font-medium">Nome</th>
                          <th className="p-3 text-left font-medium">Display Name</th>
                          <th className="p-3 text-left font-medium">Descrizione</th>
                          <th className="p-3 text-left font-medium">Tipo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g) => (
                          <tr key={g.id} className="border-t hover:bg-muted/30">
                            <td className="p-3 font-medium">{g.sam_account_name}</td>
                            <td className="p-3">{g.display_name ?? "—"}</td>
                            <td className="p-3 text-muted-foreground truncate max-w-xs" title={g.description ?? ""}>
                              {g.description ?? "—"}
                            </td>
                            <td className="p-3">
                              <Badge variant="outline">{groupTypeLabel(g.group_type)}</Badge>
                            </td>
                          </tr>
                        ))}
                        {groups.length === 0 && (
                          <tr>
                            <td colSpan={4} className="p-8 text-center text-muted-foreground">
                              Nessun gruppo trovato
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4">
                    <Pagination
                      page={groupsPage}
                      totalPages={Math.ceil(groupsTotal / pageSize)}
                      onPageChange={setGroupsPage}
                    />
                  </div>
                </TabsContent>

                <TabsContent value="dhcp" className="mt-4">
                  {!selectedIntegration.winrm_credential_id ? (
                    <div className="border rounded-lg p-8 text-center text-muted-foreground">
                      <Wifi className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="font-medium">DHCP non configurato</p>
                      <p className="text-sm mt-1">
                        Per importare i lease DHCP da Windows Server, modifica l&apos;integrazione e seleziona una credenziale WinRM.
                      </p>
                      <p className="text-xs mt-2 text-muted-foreground/70">
                        Il DC deve avere il ruolo DHCP Server e WinRM abilitato.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-4 mb-4">
                        <Input
                          placeholder="Cerca per IP, MAC, hostname, scope..."
                          value={dhcpSearch}
                          onChange={(e) => {
                            setDhcpSearch(e.target.value);
                            setDhcpPage(1);
                          }}
                          className="max-w-sm"
                        />
                      </div>
                      <div className="border rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="p-3 text-left font-medium">IP</th>
                              <th className="p-3 text-left font-medium">MAC</th>
                              <th className="p-3 text-left font-medium">Hostname</th>
                              <th className="p-3 text-left font-medium">Scope</th>
                              <th className="p-3 text-left font-medium">Stato</th>
                              <th className="p-3 text-left font-medium">Scadenza</th>
                            </tr>
                          </thead>
                          <tbody>
                            {dhcpLeases.map((l) => (
                              <tr key={l.id} className="border-t hover:bg-muted/30">
                                <td className="p-3 font-mono font-medium">{l.ip_address}</td>
                                <td className="p-3 font-mono text-muted-foreground">{l.mac_address}</td>
                                <td className="p-3">{l.hostname ?? "—"}</td>
                                <td className="p-3 text-muted-foreground">
                                  <div className="font-mono text-xs">{l.scope_id}</div>
                                  {l.scope_name && <div className="text-xs">{l.scope_name}</div>}
                                </td>
                                <td className="p-3">
                                  <Badge variant={dhcpStateVariant(l.address_state)}>
                                    {l.address_state ?? "—"}
                                  </Badge>
                                </td>
                                <td className="p-3 text-muted-foreground">{formatDate(l.lease_expires)}</td>
                              </tr>
                            ))}
                            {dhcpLeases.length === 0 && (
                              <tr>
                                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                                  Nessun lease trovato. Esegui una sincronizzazione per importare i dati DHCP.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="mt-4">
                        <Pagination
                          page={dhcpPage}
                          totalPages={Math.ceil(dhcpTotal / pageSize)}
                          onPageChange={setDhcpPage}
                        />
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}
    </motion.div>
  );
}

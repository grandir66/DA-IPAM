"use client";

import { Fragment, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Users,
  FolderTree,
  RefreshCw,
  BookOpen,
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
  Activity,
  Download,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
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
import { ADSetupGuideDialog } from "@/components/shared/ad-setup-guide-dialog";
import { SEVERITY_STYLE } from "@/lib/severity-style";
import type { AclExtras, AclObjectKind, InterestingAce } from "@/lib/ad/health/acl/types";
import type {
  HealthFinding,
  HealthScore,
  HealthSeverity,
  PrivilegeMatrix,
  PrivilegeMembershipKind,
} from "@/lib/ad/health/types";

function shortDnName(dn: string): string {
  const first = dn.split(",")[0] ?? dn;
  return first.replace(/^(CN|OU|DC)=/i, "").trim() || dn;
}

function shortSid(sid: string): string {
  const parts = sid.split("-");
  if (parts.length < 3) return sid;
  return `…-${parts[parts.length - 1]}`;
}

const ACL_KIND_LABEL: Record<AclObjectKind, string> = {
  domain: "Dominio",
  adminsdholder: "AdminSDHolder",
  ou: "OU",
  user: "Utente",
  group: "Gruppo",
  computer: "Computer",
};

const ACL_KIND_ORDER: AclObjectKind[] = [
  "domain",
  "adminsdholder",
  "ou",
  "group",
  "user",
  "computer",
];

function aclRightLabel(right: string): string {
  const map: Record<string, string> = {
    GenericAll: "Controllo totale",
    WriteDacl: "Modifica ACL",
    WriteOwner: "Cambia owner",
    AllExtendedRights: "Tutti i diritti estesi",
    "DCSync-GetChanges": "DCSync (Get-Changes)",
    "DCSync-GetChangesAll": "DCSync (Get-Changes-All)",
    ForceChangePassword: "Reset password",
    AddMember: "Aggiungi membri",
  };
  return map[right] ?? right;
}

function aclRightClass(right: string): string {
  if (right.startsWith("DCSync") || right === "GenericAll") {
    return "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30";
  }
  if (right === "WriteDacl" || right === "WriteOwner" || right === "AllExtendedRights") {
    return "bg-amber-500/15 text-amber-800 dark:text-amber-200 border-amber-500/30";
  }
  return "bg-muted text-foreground border-border";
}

function sortAclAces(aces: InterestingAce[]): InterestingAce[] {
  const kindRank = (k: AclObjectKind) => ACL_KIND_ORDER.indexOf(k);
  const severity = (a: InterestingAce) => {
    if (a.rights.some((r) => r.startsWith("DCSync") || r === "GenericAll")) return 0;
    if (a.rights.some((r) => r === "WriteDacl" || r === "WriteOwner")) return 1;
    return 2;
  };
  return [...aces].sort((a, b) => {
    const k = kindRank(a.objectKind) - kindRank(b.objectKind);
    if (k !== 0) return k;
    const s = severity(a) - severity(b);
    if (s !== 0) return s;
    return shortDnName(a.objectDn).localeCompare(shortDnName(b.objectDn));
  });
}

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

interface AdHealthRun {
  id: number;
  integrationId: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "error";
  errorMessage: string | null;
  scoreGlobal: number | null;
  engineVersion: string;
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
  // v0.2.657: guida configurazione DC
  const [adGuideOpen, setAdGuideOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState({ ...defaultForm, username: "", password: "" });
  const [editSaving, setEditSaving] = useState(false);

  const [healthRun, setHealthRun] = useState<AdHealthRun | null>(null);
  const [healthScore, setHealthScore] = useState<HealthScore | null>(null);
  const [healthFindings, setHealthFindings] = useState<HealthFinding[]>([]);
  const [privilegeMatrix, setPrivilegeMatrix] = useState<PrivilegeMatrix | null>(null);
  const [aclExtras, setAclExtras] = useState<AclExtras | null>(null);
  const [aclKindFilter, setAclKindFilter] = useState<"all" | AclObjectKind>("all");
  const [winrmProbe, setWinrmProbe] = useState<{
    configured?: boolean;
    status?: string;
    lastHotfixAt?: string | null;
    cpasswordPaths?: string[];
    errorMessage?: string;
    durationMs?: number;
  } | null>(null);
  const [phase5Meta, setPhase5Meta] = useState<{
    gpoCount?: number;
    siteCount?: number | null;
    subnetCount?: number | null;
    gmsaCount?: number | null;
  } | null>(null);
  const [matrixEnabledOnly, setMatrixEnabledOnly] = useState(true);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthRunning, setHealthRunning] = useState(false);
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);

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

  const fetchHealth = useCallback(async () => {
    if (!selectedIntegration) {
      setHealthRun(null);
      setHealthScore(null);
      setHealthFindings([]);
      setPrivilegeMatrix(null);
      setAclExtras(null);
      setWinrmProbe(null);
      setPhase5Meta(null);
      return;
    }
    setHealthLoading(true);
    setExpandedFinding(null);
    try {
      const res = await fetch(`/api/ad/healthcheck?integrationId=${selectedIntegration.id}`);
      if (!res.ok) throw new Error("Errore caricamento AD Health");
      const data = await res.json();
      setHealthRun(data.run ?? null);
      setHealthScore(data.score ?? null);
      setHealthFindings(Array.isArray(data.findings) ? data.findings : []);
      setPrivilegeMatrix(data.privilegeMatrix ?? null);
      setAclExtras(data.acl ?? null);
      setWinrmProbe(data.winrm ?? null);
      setPhase5Meta(data.phase5 ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
      setHealthRun(null);
      setHealthScore(null);
      setHealthFindings([]);
      setPrivilegeMatrix(null);
      setAclExtras(null);
      setWinrmProbe(null);
      setPhase5Meta(null);
    } finally {
      setHealthLoading(false);
    }
  }, [selectedIntegration]);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);
  useEffect(() => { fetchWinrmCredentials(); }, [fetchWinrmCredentials]);
  useEffect(() => { fetchComputers(); }, [fetchComputers]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);
  useEffect(() => { fetchGroups(); }, [fetchGroups]);
  useEffect(() => { fetchDhcpLeases(); }, [fetchDhcpLeases]);
  useEffect(() => { fetchHealth(); }, [fetchHealth]);

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

  const handleHealthcheck = async () => {
    if (!selectedIntegration) return;
    setHealthRunning(true);
    try {
      const res = await fetch("/api/ad/healthcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrationId: selectedIntegration.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore healthcheck");
      setHealthScore(data.score ?? null);
      setHealthFindings(Array.isArray(data.findings) ? data.findings : []);
      setPrivilegeMatrix(data.privilegeMatrix ?? null);
      setAclExtras(data.acl ?? null);
      setWinrmProbe(data.winrm ?? null);
      setPhase5Meta(data.phase5 ?? null);
      setExpandedFinding(null);
      toast.success(`Healthcheck completato (score ${data.score?.global ?? "—"})`);
      await fetchHealth();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setHealthRunning(false);
    }
  };

  const handleExportHealth = () => {
    if (!healthRun?.id) return;
    window.open(`/api/ad/healthcheck/export?runId=${healthRun.id}`, "_blank");
  };

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("it-IT");
    } catch {
      return iso;
    }
  };

  const scoreTone = (n: number) => {
    if (n >= 70) return "text-red-600";
    if (n >= 40) return "text-orange-500";
    if (n >= 20) return "text-amber-600";
    return "text-green-600";
  };

  const matrixCellLabel = (kind: PrivilegeMembershipKind | null | undefined) => {
    if (!kind) return "·";
    if (kind === "direct") return "D";
    if (kind === "nested") return "N";
    return "P";
  };

  const matrixCellClass = (kind: PrivilegeMembershipKind | null | undefined) => {
    if (!kind) return "text-muted-foreground/40";
    if (kind === "direct") return "bg-red-500/15 text-red-700 dark:text-red-300 font-semibold";
    if (kind === "nested") return "bg-amber-500/15 text-amber-800 dark:text-amber-200 font-semibold";
    return "bg-orange-500/15 text-orange-800 dark:text-orange-200 font-semibold";
  };

  const matrixRows = privilegeMatrix
    ? privilegeMatrix.users.filter((u) => (matrixEnabledOnly ? u.enabled : true))
    : [];

  const aclRows = aclExtras
    ? sortAclAces(aclExtras.interestingAces).filter((a) =>
        aclKindFilter === "all" ? true : a.objectKind === aclKindFilter,
      )
    : [];

  const aclKindCounts = aclExtras
    ? ACL_KIND_ORDER.reduce(
        (acc, kind) => {
          acc[kind] = aclExtras.interestingAces.filter((a) => a.objectKind === kind).length;
          return acc;
        },
        {} as Record<AclObjectKind, number>,
      )
    : null;

  const severityBadgeClass = (sev: HealthSeverity | string) =>
    SEVERITY_STYLE[sev] ?? "bg-muted text-foreground";

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
        <div className="flex items-center gap-2">
          {/* v0.2.657: guida configurazione DC (LDAPS, WinRM, DHCP, svc account) */}
          <Button
            variant="outline"
            onClick={() => setAdGuideOpen(true)}
            title="Guida configurazione Domain Controller (LDAPS, WinRM, DHCP, service account)"
          >
            <BookOpen className="w-4 h-4 mr-2" />
            Guida DC
          </Button>
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
        </div>
      </div>

      {/* v0.2.657: dialog guida configurazione DC */}
      <ADSetupGuideDialog open={adGuideOpen} onOpenChange={setAdGuideOpen} />

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
                  <TabsTrigger value="health" className="flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Health
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

                <TabsContent value="health" className="mt-4 space-y-4">
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p>
                      <span className="font-medium">AD Health Domarc (LDAP) — non è PingCastle.</span>{" "}
                      Assessment basato su sync LDAP e regole Domarc; non esegue né sostituisce PingCastle.
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      onClick={handleHealthcheck}
                      disabled={healthRunning || !selectedIntegration.enabled}
                    >
                      {healthRunning ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Activity className="w-4 h-4 mr-2" />
                      )}
                      Esegui healthcheck
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleExportHealth}
                      disabled={!healthRun?.id || healthRun.status !== "ok" || healthScore == null}
                    >
                      <Download className="w-4 h-4 mr-2" />
                      Esporta JSON
                    </Button>
                    {healthRun && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        Ultimo run: {formatDate(healthRun.finishedAt ?? healthRun.startedAt)}
                        {" · "}
                        <Badge
                          variant={
                            healthRun.status === "ok"
                              ? "default"
                              : healthRun.status === "error"
                                ? "destructive"
                                : "secondary"
                          }
                          className="align-middle"
                        >
                          {healthRun.status}
                        </Badge>
                        {healthRun.engineVersion && (
                          <span className="ml-2">v{healthRun.engineVersion}</span>
                        )}
                      </span>
                    )}
                  </div>

                  {healthRun?.status === "running" && (
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      Healthcheck in corso… i dati sotto restano dell&apos;ultimo run completato, se disponibile.
                    </p>
                  )}
                  {healthRun?.status === "error" && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm space-y-1">
                      <p className="font-medium text-destructive">Ultimo run in errore</p>
                      {healthRun.errorMessage && (
                        <p className="text-destructive/90">{healthRun.errorMessage}</p>
                      )}
                      <p className="text-muted-foreground">
                        Riesegui l&apos;healthcheck. Se vedi ancora findings/ACL sotto, sono dell&apos;ultimo run ok.
                      </p>
                    </div>
                  )}

                  {healthLoading ? (
                    <SkeletonTable rows={3} columns={4} />
                  ) : healthScore ? (
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      {(
                        [
                          ["Global", healthScore.global],
                          ["Stale", healthScore.stale],
                          ["Privileged", healthScore.privileged],
                          ["Trust", healthScore.trust],
                          ["Anomaly", healthScore.anomaly],
                        ] as const
                      ).map(([label, value]) => (
                        <Card key={label}>
                          <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">
                              {label}
                            </CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className={`text-2xl font-bold ${scoreTone(value)}`}>{value}</div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <Card>
                      <CardContent className="py-8 text-center text-muted-foreground">
                        <Activity className="w-10 h-10 mx-auto mb-3 opacity-40" />
                        <p>Nessun healthcheck eseguito per questa integrazione.</p>
                        <p className="text-sm mt-1">Clicca &quot;Esegui healthcheck&quot; per avviare l&apos;assessment.</p>
                      </CardContent>
                    </Card>
                  )}

                  {!healthLoading && healthFindings.length > 0 && (
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-3 text-left font-medium w-8" />
                            <th className="p-3 text-left font-medium">Rule</th>
                            <th className="p-3 text-left font-medium">Severity</th>
                            <th className="p-3 text-left font-medium">Titolo</th>
                            <th className="p-3 text-left font-medium">Oggetti</th>
                            <th className="p-3 text-left font-medium">Asse</th>
                          </tr>
                        </thead>
                        <tbody>
                          {healthFindings.map((f) => {
                            const open = expandedFinding === f.ruleId;
                            return (
                              <Fragment key={f.ruleId}>
                                <tr
                                  className="border-t hover:bg-muted/30 cursor-pointer"
                                  onClick={() =>
                                    setExpandedFinding(open ? null : f.ruleId)
                                  }
                                >
                                  <td className="p-3 text-muted-foreground">
                                    {open ? (
                                      <ChevronDown className="w-4 h-4" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4" />
                                    )}
                                  </td>
                                  <td className="p-3 font-mono text-xs">{f.ruleId}</td>
                                  <td className="p-3">
                                    <Badge className={severityBadgeClass(f.severity)}>
                                      {f.severity}
                                    </Badge>
                                  </td>
                                  <td className="p-3 font-medium">{f.title}</td>
                                  <td className="p-3">{f.objectCount}</td>
                                  <td className="p-3">
                                    <Badge variant="outline">{f.axis}</Badge>
                                  </td>
                                </tr>
                                {open && (
                                  <tr className="border-t bg-muted/20">
                                    <td colSpan={6} className="p-3 space-y-2">
                                      {f.description && (
                                        <p className="text-sm text-muted-foreground">{f.description}</p>
                                      )}
                                      {f.sampleDns.length > 0 ? (
                                        <div>
                                          <p className="text-xs font-medium mb-1">
                                            Sample ({f.sampleDns.length})
                                          </p>
                                          <ul className="text-xs font-mono space-y-0.5 max-h-48 overflow-y-auto">
                                            {f.sampleDns.map((dn) => (
                                              <li key={dn} className="truncate" title={dn}>
                                                {dn}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ) : (
                                        <p className="text-xs text-muted-foreground">Nessun sample DN</p>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {!healthLoading && healthScore && healthFindings.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Nessun finding per questo run.
                    </p>
                  )}

                  {!healthLoading && privilegeMatrix && (
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center gap-3 justify-between">
                          <div>
                            <CardTitle className="text-base">Matrice privilegi</CardTitle>
                            <p className="text-sm text-muted-foreground mt-1">
                              Utenti con path verso gruppi amministrativi / elevati
                              (D=diretto, N=nested, P=primaryGroupID). Nested max depth 5.
                            </p>
                          </div>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                              checked={matrixEnabledOnly}
                              onCheckedChange={(v) => setMatrixEnabledOnly(v === true)}
                            />
                            Solo account abilitati
                          </label>
                        </div>
                        {privilegeMatrix.truncated && (
                          <p className="text-xs text-amber-700 dark:text-amber-300 mt-2">
                            Matrice troncata ai primi 500 utenti con privilegi.
                          </p>
                        )}
                      </CardHeader>
                      <CardContent className="p-0">
                        {matrixRows.length === 0 ? (
                          <p className="text-sm text-muted-foreground px-6 pb-6">
                            Nessun utente nelle colonne privilegiate (con il filtro attuale).
                          </p>
                        ) : (
                          <div className="overflow-x-auto border-t">
                            <table className="w-full text-xs">
                              <thead className="bg-muted/50 sticky top-0">
                                <tr>
                                  <th className="p-2 text-left font-medium sticky left-0 bg-muted/50 z-10 min-w-[140px]">
                                    Utente
                                  </th>
                                  {privilegeMatrix.groups.map((g) => (
                                    <th
                                      key={g.key}
                                      className="p-2 text-center font-medium whitespace-nowrap"
                                      title={`${g.displayName}${g.found ? "" : " (gruppo non trovato)"} — ${g.memberCount} enabled`}
                                    >
                                      <div className={g.found ? "" : "opacity-40"}>
                                        {g.displayName.replace("Group Policy Creator Owners", "GPO Creators")}
                                      </div>
                                      <div className="text-[10px] font-normal text-muted-foreground">
                                        {g.memberCount}
                                      </div>
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {matrixRows.map((u) => (
                                  <tr key={u.dn} className="border-t hover:bg-muted/20">
                                    <td
                                      className="p-2 font-mono sticky left-0 bg-background z-10"
                                      title={u.dn}
                                    >
                                      <span className={u.enabled ? "" : "text-muted-foreground line-through"}>
                                        {u.sam}
                                      </span>
                                    </td>
                                    {privilegeMatrix.groups.map((g) => {
                                      const kind = u.cells[g.key] ?? null;
                                      const path = u.paths?.[g.key];
                                      const tip = kind
                                        ? `${g.displayName}: ${kind}${path?.length ? ` via ${path.join(" → ")}` : ""}`
                                        : undefined;
                                      return (
                                        <td
                                          key={g.key}
                                          className={`p-1 text-center ${matrixCellClass(kind)}`}
                                          title={tip}
                                        >
                                          {matrixCellLabel(kind)}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {!healthLoading && (phase5Meta || winrmProbe) && (
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">Topologia e probe DC</CardTitle>
                        <p className="text-sm text-muted-foreground mt-1">
                          Inventario LDAP (GPO/Sites) e verifica WinRM sul DC se configurata.
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {phase5Meta && (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-muted-foreground text-xs">GPO</div>
                              <div className="font-semibold">{phase5Meta.gpoCount ?? "—"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">Sites</div>
                              <div className="font-semibold">{phase5Meta.siteCount ?? "—"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">Subnets</div>
                              <div className="font-semibold">{phase5Meta.subnetCount ?? "—"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">gMSA</div>
                              <div className="font-semibold">{phase5Meta.gmsaCount ?? "—"}</div>
                            </div>
                          </div>
                        )}
                        {winrmProbe && (
                          <div className="rounded-md border px-3 py-2 text-sm space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-muted-foreground">WinRM</span>
                              <Badge
                                variant={
                                  winrmProbe.status === "ok"
                                    ? "default"
                                    : winrmProbe.status === "skipped"
                                      ? "secondary"
                                      : "destructive"
                                }
                              >
                                {!winrmProbe.configured || winrmProbe.status === "skipped"
                                  ? "Non configurato"
                                  : winrmProbe.status === "ok"
                                    ? "OK"
                                    : "Non disponibile"}
                              </Badge>
                              {winrmProbe.durationMs != null && winrmProbe.status === "ok" && (
                                <span className="text-xs text-muted-foreground">
                                  {(winrmProbe.durationMs / 1000).toFixed(1)} s
                                </span>
                              )}
                            </div>
                            {winrmProbe.lastHotfixAt && (
                              <p className="text-xs text-muted-foreground">
                                Ultimo hotfix DC:{" "}
                                {formatDate(winrmProbe.lastHotfixAt)}
                              </p>
                            )}
                            {winrmProbe.cpasswordPaths && winrmProbe.cpasswordPaths.length > 0 && (
                              <p className="text-xs text-destructive font-medium">
                                cpassword in SYSVOL: {winrmProbe.cpasswordPaths.length} path
                              </p>
                            )}
                            {winrmProbe.errorMessage && winrmProbe.status === "unavailable" && (
                              <p className="text-xs text-destructive">{winrmProbe.errorMessage}</p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {!healthLoading && aclExtras && (
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex flex-wrap items-center gap-3 justify-between">
                          <div>
                            <CardTitle className="text-base">Permessi ACL critici</CardTitle>
                            <p className="text-sm text-muted-foreground mt-1">
                              Solo ACE ad alto rischio (DCSync, controllo totale, modifica ACL/owner…).
                              Passa il mouse su nome o SID per il dettaglio completo.
                            </p>
                          </div>
                          <Badge
                            variant={
                              aclExtras.meta.status === "ok"
                                ? "default"
                                : aclExtras.meta.status === "partial"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {aclExtras.meta.status === "ok"
                              ? "Completo"
                              : aclExtras.meta.status === "partial"
                                ? "Parziale"
                                : "Non disponibile"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-muted-foreground text-xs">Oggetti letti</div>
                            <div className="font-semibold">{aclExtras.meta.objectsScanned}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">Descriptor OK</div>
                            <div className="font-semibold">{aclExtras.meta.sdParsed}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">ACE critiche</div>
                            <div className="font-semibold">{aclExtras.meta.interestingAceCount}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground text-xs">Tempo collect</div>
                            <div className="font-semibold">
                              {(aclExtras.meta.durationMs / 1000).toFixed(1)} s
                            </div>
                          </div>
                        </div>
                        {aclExtras.meta.errorMessage && (
                          <p className="text-sm text-destructive">{aclExtras.meta.errorMessage}</p>
                        )}
                        {aclExtras.interestingAces.length > 0 && aclKindCounts && (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              Filtra per tipo oggetto. La tabella sotto elenca chi ha il permesso e su cosa
                              (max 80 righe, ordinate per gravità).
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant={aclKindFilter === "all" ? "default" : "outline"}
                                className="h-7 text-xs"
                                onClick={() => setAclKindFilter("all")}
                              >
                                Tutte ({aclExtras.interestingAces.length})
                              </Button>
                              {ACL_KIND_ORDER.filter((k) => (aclKindCounts[k] ?? 0) > 0).map((k) => (
                                <Button
                                  key={k}
                                  type="button"
                                  size="sm"
                                  variant={aclKindFilter === k ? "default" : "outline"}
                                  className="h-7 text-xs"
                                  onClick={() => setAclKindFilter(k)}
                                >
                                  {ACL_KIND_LABEL[k]} ({aclKindCounts[k]})
                                </Button>
                              ))}
                            </div>
                          </div>
                        )}
                        {aclRows.length > 0 ? (
                          <div className="border rounded-lg overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50">
                                <tr>
                                  <th className="p-2.5 text-left font-medium">Su cosa</th>
                                  <th className="p-2.5 text-left font-medium">Chi</th>
                                  <th className="p-2.5 text-left font-medium">Permesso</th>
                                  <th className="p-2.5 text-left font-medium w-24">Note</th>
                                </tr>
                              </thead>
                              <tbody>
                                {aclRows.slice(0, 80).map((a, i) => (
                                  <tr key={`${a.objectDn}-${a.trusteeSid}-${i}`} className="border-t align-top">
                                    <td className="p-2.5">
                                      <div className="font-medium" title={a.objectDn}>
                                        {shortDnName(a.objectDn)}
                                      </div>
                                      <div className="text-xs text-muted-foreground mt-0.5">
                                        {ACL_KIND_LABEL[a.objectKind]}
                                      </div>
                                    </td>
                                    <td className="p-2.5">
                                      <div className="font-medium" title={a.trusteeSid}>
                                        {a.trusteeSam ?? shortSid(a.trusteeSid)}
                                      </div>
                                      {!a.trusteeSam && (
                                        <div className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate max-w-[180px]" title={a.trusteeSid}>
                                          {a.trusteeSid}
                                        </div>
                                      )}
                                      {a.trusteeSam && (
                                        <div className="text-[11px] font-mono text-muted-foreground mt-0.5" title={a.trusteeSid}>
                                          {shortSid(a.trusteeSid)}
                                        </div>
                                      )}
                                    </td>
                                    <td className="p-2.5">
                                      <div className="flex flex-wrap gap-1">
                                        {a.rights.map((r) => (
                                          <span
                                            key={r}
                                            className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${aclRightClass(r)}`}
                                            title={r}
                                          >
                                            {aclRightLabel(r)}
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                    <td className="p-2.5 text-xs text-muted-foreground">
                                      {a.inherited ? "Ereditato" : "Esplicito"}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {aclExtras.interestingAces.length === 0
                              ? "Nessuna ACE critica trovata (o collect non disponibile)."
                              : "Nessuna riga per il filtro selezionato."}
                          </p>
                        )}
                      </CardContent>
                    </Card>
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

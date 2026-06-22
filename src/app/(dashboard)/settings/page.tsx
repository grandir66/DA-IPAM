"use client";

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Trash2,
  Clock,
  Download,
  Database,
  Save,
  Radar,
  Pencil,
  RotateCcw,
  Monitor,
  Users,
  Shield,
  ArrowUpCircle,
  Sparkles,
  Play,
  RefreshCw,
  Fingerprint,
  KeyRound,
  PackageOpen,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import type { ScheduledJob, NetworkWithStats } from "@/types";
import { ScanConfigTab } from "@/components/settings/scan-config-tab";
import { DeviceIdentificationTab } from "@/components/settings/device-identification-tab";
import { ModulesTab } from "@/components/settings/modules-tab";
import { UpdatesTab } from "@/components/settings/updates-tab";

const JOB_TYPE_LABELS: Record<string, string> = {
  ping_sweep: "Scoperta rete (ICMP + Nmap quick + DNS + ARP)",
  fast_scan: "Scoperta veloce subnet",
  snmp_scan: "SNMP Scan",
  nmap_scan: "Nmap Scan",
  arp_poll: "ARP Poll",
  dns_resolve: "DNS Resolve",
  known_host_check: "Monitoraggio host registrati (ICMP)",
  cleanup: "Pulizia Host",
  anomaly_check: "Rilevamento anomalie",
  librenms_sync: "Sincronizzazione LibreNMS",
  vuln_sync: "Sincronizzazione vulnerability scanner",
  wazuh_sync: "Sincronizzazione Wazuh (agent/sysc/CVE)",
  ad_sync: "Sincronizzazione Active Directory",
};

const HEAVY_JOB_TYPES = new Set(["fast_scan", "ping_sweep"]);

function networkIsLarge(cidr: string | undefined | null): boolean {
  if (!cidr) return false;
  const m = /\/(\d+)$/.exec(cidr);
  if (!m) return false;
  const bits = Number(m[1]);
  return Number.isFinite(bits) && bits >= 0 && bits <= 22;
}

const INTERVAL_OPTIONS = [
  { value: "5", label: "Ogni 5 minuti" },
  { value: "15", label: "Ogni 15 minuti" },
  { value: "30", label: "Ogni 30 minuti" },
  { value: "60", label: "Ogni ora" },
  { value: "360", label: "Ogni 6 ore" },
  { value: "1440", label: "Ogni 24 ore" },
];

type TabKey =
  | "utenti"
  | "scansione"
  | "identificazione"
  | "jobs"
  | "https"
  | "moduli"
  | "aggiornamenti"
  | "sistema";

const TAB_ALIASES: Record<string, TabKey> = {
  utenti: "utenti",
  users: "utenti",
  scansione: "scansione",
  scan: "scansione",
  identificazione: "identificazione",
  fingerprint: "identificazione",
  jobs: "jobs",
  job: "jobs",
  // ex-tab "integrazioni" consolidata in "moduli" (config unica dei moduli)
  integrazioni: "moduli",
  integrations: "moduli",
  https: "https",
  tls: "https",
  moduli: "moduli",
  modules: "moduli",
  features: "moduli",
  aggiornamenti: "aggiornamenti",
  updates: "aggiornamenti",
  sistema: "sistema",
  system: "sistema",
  generale: "sistema",
  general: "sistema",
  dati: "sistema",
};

interface UserWithAccess {
  id: number;
  username: string;
  email: string | null;
  role: string;
  created_at: string;
  last_login: string | null;
  tenant_access?: { tenant_id: number; codice_cliente: string; ragione_sociale: string; role: string }[];
}

interface CredentialEntry {
  id: number;
  name: string;
  credential_type: string;
}

interface TenantEntry {
  id: number;
  codice_cliente: string;
  ragione_sociale: string;
}

interface TlsStatus {
  enabled: boolean;
  cert_path: string | null;
  key_path: string | null;
  cert_exists: boolean;
  cert_info: Record<string, string> | null;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Caricamento…</div>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin"
    || (session?.user as { role?: string } | undefined)?.role === "superadmin";

  const initialTab: TabKey = useMemo(() => {
    const raw = (searchParams?.get("tab") ?? "").toLowerCase();
    return TAB_ALIASES[raw] ?? "utenti";
  }, [searchParams]);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  function selectTab(key: TabKey) {
    setActiveTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    router.replace(url.pathname + "?" + url.searchParams.toString(), { scroll: false });
  }

  // === Version badge (lightweight, full mgmt is in Aggiornamenti tab) ===
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null);

  // === Host credentials ===
  const [credentials, setCredentials] = useState<CredentialEntry[]>([]);
  const [hostWindowsCredentialId, setHostWindowsCredentialId] = useState<string>("");
  const [hostLinuxCredentialId, setHostLinuxCredentialId] = useState<string>("");
  const [savingHostCreds, setSavingHostCreds] = useState(false);

  // === Reset state (full reconfig) ===
  const [resetting, setResetting] = useState(false);
  const [openingWizard, setOpeningWizard] = useState(false);
  const [resettingLabConfig, setResettingLabConfig] = useState(false);

  // === Users ===
  const [users, setUsers] = useState<UserWithAccess[]>([]);
  const [tenantsList, setTenantsList] = useState<TenantEntry[]>([]);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"superadmin" | "admin" | "viewer">("viewer");
  const [newUserTenantIds, setNewUserTenantIds] = useState<number[]>([]);
  const [savingUser, setSavingUser] = useState(false);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editUserRole, setEditUserRole] = useState<"superadmin" | "admin" | "viewer">("admin");
  const [editUserTenantIds, setEditUserTenantIds] = useState<number[]>([]);
  const [savingEditUser, setSavingEditUser] = useState(false);

  // === Reset password (admin action on a user) ===
  const [resetPwOpen, setResetPwOpen] = useState(false);
  const [resetPwUser, setResetPwUser] = useState<UserWithAccess | null>(null);
  const [resetPwValue, setResetPwValue] = useState("");
  const [resetPwSaving, setResetPwSaving] = useState(false);

  // === TLS ===
  const [tlsStatus, setTlsStatus] = useState<TlsStatus | null>(null);
  const [tlsDomain, setTlsDomain] = useState("localhost");
  const [tlsDays, setTlsDays] = useState("365");
  const [generatingCert, setGeneratingCert] = useState(false);
  const [importCert, setImportCert] = useState("");
  const [importKey, setImportKey] = useState("");
  const [importingCert, setImportingCert] = useState(false);

  // === Scheduled jobs ===
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [networks, setNetworks] = useState<NetworkWithStats[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newJobType, setNewJobType] = useState<string>("known_host_check");
  const [runningJobId, setRunningJobId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then(setJobs).catch(() => {});
    fetch("/api/networks").then((r) => r.json()).then(setNetworks).catch(() => {});
    fetch("/api/settings").then((r) => r.json()).then((settings: Record<string, string>) => {
      if (settings.host_windows_credential_id !== undefined) setHostWindowsCredentialId(settings.host_windows_credential_id || "");
      if (settings.host_linux_credential_id !== undefined) setHostLinuxCredentialId(settings.host_linux_credential_id || "");
    }).catch(() => {});
    fetch("/api/credentials").then((r) => r.json()).then((creds: CredentialEntry[]) => setCredentials(creds)).catch(() => {});
    fetch("/api/version").then((r) => r.json()).then((d: { version?: string }) => setAppVersion(d.version ?? null)).catch(() => {});
    fetch("/api/system/update?action=check")
      .then((r) => r.json())
      .then((d: { remoteVersion?: string; updateAvailable?: boolean }) => {
        if (d.remoteVersion && d.updateAvailable) {
          setUpdateAvailable({ version: d.remoteVersion });
        } else {
          setUpdateAvailable(null);
        }
      })
      .catch(() => {});
    fetch("/api/users").then((r) => r.json()).then(setUsers).catch(() => {});
    fetch("/api/tenants").then((r) => r.json()).then((data: TenantEntry[]) => {
      if (Array.isArray(data)) setTenantsList(data);
    }).catch(() => {});
    fetch("/api/tls").then((r) => r.json()).then(setTlsStatus).catch(() => {});
  }, []);

  // ============ HOST CREDENTIALS ============

  async function handleSaveHostCredentials() {
    setSavingHostCreds(true);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "host_windows_credential_id", value: hostWindowsCredentialId || "" }),
      });
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "host_linux_credential_id", value: hostLinuxCredentialId || "" }),
      });
      toast.success("Credenziali host salvate");
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setSavingHostCreds(false);
    }
  }

  // ============ ONBOARDING / RESET ============

  async function handleOpenOnboardingWizard() {
    if (!confirm("Il wizard di configurazione guidata verrà riaperto. Reti, dispositivi e credenziali già inseriti restano nel database. Continuare?")) return;
    setOpeningWizard(true);
    try {
      const res = await fetch("/api/onboarding/reset", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Operazione non riuscita");
        return;
      }
      router.push("/onboarding");
    } catch {
      toast.error("Errore di rete");
    } finally {
      setOpeningWizard(false);
    }
  }

  async function handleResetLabNetworkConfig() {
    if (
      !confirm(
        "Azzerare reti, host, ARP, DHCP, credenziali di discovery, AD e inventario del tenant corrente?\n\n" +
          "Restano intatti: integrazioni appliance (Edge, LibreNMS, Network Services), admin, Launchpad e moduli.\n\n" +
          "Verrai reindirizzato al wizard di pre-configurazione. Procedere?",
      )
    ) {
      return;
    }
    setResettingLabConfig(true);
    try {
      const res = await fetch("/api/lab-config/reset", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "Reset lab non riuscito");
        return;
      }
      toast.success(data.message ?? "Configurazione di rete azzerata");
      router.push("/onboarding");
    } catch {
      toast.error("Errore di rete");
    } finally {
      setResettingLabConfig(false);
    }
  }

  async function handleResetConfiguration() {
    if (!confirm("Resettare tutta la configurazione? Verranno eliminati TUTTI i dati: reti, host, dispositivi, credenziali, integrazioni Active Directory (e dati sincronizzati), utenti e impostazioni. Resteranno solo il profilo Nmap e le regole fingerprint. Dovrai rifare il setup iniziale. Procedere?")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (res.ok) {
        toast.success("Configurazione resettata. Reindirizzamento al setup iniziale...");
        window.location.href = "/setup";
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nel reset");
      }
    } catch {
      toast.error("Errore nel reset");
    } finally {
      setResetting(false);
    }
  }

  // ============ USERS ============

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername,
          password: newUserPassword,
          role: newUserRole,
          email: newUserEmail || null,
          tenant_ids: newUserRole !== "superadmin" ? newUserTenantIds : [],
        }),
      });
      if (res.ok) {
        toast.success("Utente creato");
        setNewUserOpen(false);
        setNewUsername(""); setNewUserEmail(""); setNewUserPassword(""); setNewUserRole("viewer"); setNewUserTenantIds([]);
        const updated = await fetch("/api/users").then((r) => r.json());
        setUsers(updated);
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nella creazione utente");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSavingUser(false); }
  }

  function openEditUser(user: UserWithAccess) {
    setEditUserId(user.id);
    setEditUserRole(user.role as "superadmin" | "admin" | "viewer");
    setEditUserTenantIds(user.tenant_access?.map((a) => a.tenant_id) ?? []);
    setEditUserOpen(true);
  }

  async function handleSaveEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (editUserId == null) return;
    setSavingEditUser(true);
    try {
      const res = await fetch(`/api/users/${editUserId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: editUserRole,
          tenant_ids: editUserRole !== "superadmin" ? editUserTenantIds : [],
        }),
      });
      if (res.ok) {
        toast.success("Utente aggiornato");
        setEditUserOpen(false);
        const updated = await fetch("/api/users").then((r) => r.json());
        setUsers(updated);
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSavingEditUser(false); }
  }

  async function handleDeleteUser(userId: number, username: string) {
    if (!confirm(`Eliminare l'utente "${username}"? L'azione è irreversibile.`)) return;
    const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Utente eliminato");
      setUsers((prev) => prev.filter((u) => u.id !== userId));
    } else {
      const data = await res.json();
      toast.error(data.error || "Errore nell'eliminazione");
    }
  }

  function openResetPassword(user: UserWithAccess) {
    setResetPwUser(user);
    setResetPwValue("");
    setResetPwOpen(true);
  }

  async function handleSubmitResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetPwUser) return;
    if (resetPwValue.length < 8) {
      toast.error("Minimo 8 caratteri");
      return;
    }
    setResetPwSaving(true);
    try {
      const res = await fetch(`/api/users/${resetPwUser.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: resetPwValue }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(data.message || "Password reimpostata");
        setResetPwOpen(false);
        setResetPwUser(null);
        setResetPwValue("");
      } else {
        toast.error(data.error || "Errore nel reset password");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setResetPwSaving(false);
    }
  }

  // ============ TLS ============

  async function handleGenerateCert() {
    setGeneratingCert(true);
    try {
      const res = await fetch("/api/tls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", domain: tlsDomain, days: parseInt(tlsDays) || 365 }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(data?.message ?? "Certificato generato");
        const updated = await fetch("/api/tls").then((r) => r.json()).catch(() => null);
        if (updated) setTlsStatus(updated);
      } else {
        toast.error(data?.error ?? `Errore ${res.status}: la pagina certificato non è accessibile.`);
      }
    } catch { toast.error("Errore di rete verso /api/tls"); }
    finally { setGeneratingCert(false); }
  }

  async function handleImportCert() {
    setImportingCert(true);
    try {
      const res = await fetch("/api/tls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", cert: importCert, key: importKey }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        toast.success(data?.message ?? "Certificato importato");
        setImportCert(""); setImportKey("");
        const updated = await fetch("/api/tls").then((r) => r.json()).catch(() => null);
        if (updated) setTlsStatus(updated);
      } else {
        toast.error(data?.error ?? `Errore ${res.status}: la pagina certificato non è accessibile.`);
      }
    } catch { toast.error("Errore di rete verso /api/tls"); }
    finally { setImportingCert(false); }
  }

  // ============ JOBS ============

  async function handleCreateJob(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body = {
      network_id: formData.get("network_id") ? Number(formData.get("network_id")) : null,
      job_type: formData.get("job_type"),
      interval_minutes: Number(formData.get("interval_minutes")),
    };
    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast.success("Job schedulato creato");
      setDialogOpen(false);
      const updated = await fetch("/api/jobs").then((r) => r.json());
      setJobs(updated);
    } else {
      const data = await res.json();
      toast.error(data.error);
    }
  }

  async function toggleJobEnabled(id: number, enabled: boolean) {
    await fetch("/api/jobs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, enabled: enabled ? 1 : 0 } : j)));
  }

  async function runJobNow(id: number) {
    setRunningJobId(id);
    try {
      const res = await fetch(`/api/jobs/${id}/run`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const ms = typeof data.duration_ms === "number" ? `${data.duration_ms} ms` : "ok";
        toast.success(`Job eseguito (${ms})`);
        const updated = await fetch("/api/jobs").then((r) => r.json());
        setJobs(updated);
      } else {
        toast.error(data.error || "Esecuzione fallita");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Esecuzione fallita");
    } finally {
      setRunningJobId(null);
    }
  }

  async function deleteJob(id: number) {
    if (!confirm("Eliminare questo job?")) return;
    await fetch(`/api/jobs?id=${id}`, { method: "DELETE" });
    setJobs((prev) => prev.filter((j) => j.id !== id));
    toast.success("Job eliminato");
  }

  // ============ RENDER ============

  const tabs: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: "utenti", label: "Utenti", icon: Users },
    { key: "scansione", label: "Scansione", icon: Radar },
    { key: "identificazione", label: "Identificazione", icon: Fingerprint },
    { key: "jobs", label: "Job pianificati", icon: Clock },
    { key: "https", label: "HTTPS", icon: Shield },
    { key: "moduli", label: "Moduli", icon: PackageOpen },
    { key: "aggiornamenti", label: "Aggiornamenti", icon: ArrowUpCircle },
    { key: "sistema", label: "Sistema", icon: Wrench },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Impostazioni</h1>
        <p className="text-muted-foreground mt-1">Configurazione sistema, sicurezza e profili di scansione</p>
        {appVersion && (
          <div className="flex items-center gap-3 mt-2">
            <Badge variant="outline" className="text-xs">v{appVersion}</Badge>
            {updateAvailable && (
              <button
                type="button"
                onClick={() => selectTab("aggiornamenti")}
                className="inline-flex items-center"
                title="Vai alla tab Aggiornamenti"
              >
                <Badge variant="default" className="text-xs gap-1 animate-pulse cursor-pointer">
                  <ArrowUpCircle className="h-3 w-3" />
                  v{updateAvailable.version} disponibile
                </Badge>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-0 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => selectTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors -mb-px border border-transparent whitespace-nowrap ${
                isActive
                  ? "bg-background border-border border-b-background text-[#00A7E7]"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* === Tab: Utenti === */}
      {activeTab === "utenti" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Gestione utenti</CardTitle>
              </div>
              <CardDescription className="mt-1">
                Gestisci gli account di accesso al sistema. Per cambiare la tua password usa il menu utente in alto a destra.
              </CardDescription>
            </div>
            <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
              <DialogTrigger render={<Button size="sm" />}>
                <Plus className="h-4 w-4 mr-2" />Nuovo utente
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nuovo utente</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Username</Label>
                    <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required minLength={3} placeholder="nome.cognome" />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="utente@esempio.it (per reset password)" />
                  </div>
                  <div className="space-y-2">
                    <Label>Password</Label>
                    <Input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} required minLength={8} placeholder="Minimo 8 caratteri" />
                  </div>
                  <div className="space-y-2">
                    <Label>Ruolo</Label>
                    <Select value={newUserRole} onValueChange={(v) => { setNewUserRole((v ?? newUserRole) as "superadmin" | "admin" | "viewer"); if (v === "superadmin") setNewUserTenantIds([]); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="superadmin">Super amministratore</SelectItem>
                        <SelectItem value="admin">Amministratore</SelectItem>
                        <SelectItem value="viewer">Solo lettura</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newUserRole !== "superadmin" && tenantsList.length > 0 && (
                    <div className="space-y-2">
                      <Label>Clienti assegnati</Label>
                      <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                        {tenantsList.map((t) => (
                          <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                            <input
                              type="checkbox"
                              checked={newUserTenantIds.includes(t.id)}
                              onChange={(e) => {
                                if (e.target.checked) setNewUserTenantIds((prev) => [...prev, t.id]);
                                else setNewUserTenantIds((prev) => prev.filter((id) => id !== t.id));
                              }}
                              className="rounded"
                            />
                            <span>{t.ragione_sociale || t.codice_cliente}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Le modifiche avranno effetto al prossimo accesso dell&apos;utente</p>
                    </div>
                  )}
                  <Button type="submit" disabled={savingUser}>Crea utente</Button>
                </form>
              </DialogContent>
            </Dialog>

            {/* Edit user dialog */}
            <Dialog open={editUserOpen} onOpenChange={setEditUserOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Modifica utente</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSaveEditUser} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Ruolo</Label>
                    <Select value={editUserRole} onValueChange={(v) => { setEditUserRole((v ?? editUserRole) as "superadmin" | "admin" | "viewer"); if (v === "superadmin") setEditUserTenantIds([]); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="superadmin">Super amministratore</SelectItem>
                        <SelectItem value="admin">Amministratore</SelectItem>
                        <SelectItem value="viewer">Solo lettura</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {editUserRole !== "superadmin" && tenantsList.length > 0 && (
                    <div className="space-y-2">
                      <Label>Clienti assegnati</Label>
                      <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                        {tenantsList.map((t) => (
                          <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                            <input
                              type="checkbox"
                              checked={editUserTenantIds.includes(t.id)}
                              onChange={(e) => {
                                if (e.target.checked) setEditUserTenantIds((prev) => [...prev, t.id]);
                                else setEditUserTenantIds((prev) => prev.filter((id) => id !== t.id));
                              }}
                              className="rounded"
                            />
                            <span>{t.ragione_sociale || t.codice_cliente}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Le modifiche avranno effetto al prossimo accesso dell&apos;utente</p>
                    </div>
                  )}
                  <Button type="submit" disabled={savingEditUser}>Salva</Button>
                </form>
              </DialogContent>
            </Dialog>

            {/* Reset password dialog */}
            <Dialog open={resetPwOpen} onOpenChange={setResetPwOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <KeyRound className="h-5 w-5" />
                    Reset password
                  </DialogTitle>
                  <DialogDescription>
                    Imposta una nuova password per <strong>{resetPwUser?.username}</strong>. L&apos;utente dovrà usarla al prossimo accesso.
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmitResetPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reset-pw-new">Nuova password</Label>
                    <Input
                      id="reset-pw-new"
                      type="password"
                      value={resetPwValue}
                      onChange={(e) => setResetPwValue(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      placeholder="Minimo 8 caratteri"
                    />
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setResetPwOpen(false)} disabled={resetPwSaving}>
                      Annulla
                    </Button>
                    <Button type="submit" disabled={resetPwSaving}>
                      {resetPwSaving ? "Salvataggio…" : "Reimposta"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Ruolo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Creato il</TableHead>
                  <TableHead>Ultimo accesso</TableHead>
                  <TableHead className="w-[140px]">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.email || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={user.role === "superadmin" ? "destructive" : user.role === "admin" ? "default" : "secondary"}>
                        {user.role === "superadmin" ? "Super Admin" : user.role === "admin" ? "Amministratore" : "Solo lettura"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.role === "superadmin" ? (
                        <Badge variant="outline" className="text-xs">Tutti i clienti</Badge>
                      ) : user.tenant_access && user.tenant_access.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.tenant_access.map((a) => (
                            <Badge key={a.tenant_id} variant="outline" className="text-xs">
                              {a.ragione_sociale || a.codice_cliente}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Nessuno</span>
                      )}
                    </TableCell>
                    <TableCell>{new Date(user.created_at).toLocaleDateString("it-IT")}</TableCell>
                    <TableCell>{user.last_login ? new Date(user.last_login).toLocaleString("it-IT") : "Mai"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => openEditUser(user)}
                          title="Modifica ruolo e tenant"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => openResetPassword(user)}
                          title="Reset password"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => handleDeleteUser(user.id, user.username)}
                          className="text-destructive hover:text-destructive"
                          title="Elimina utente"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {users.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Nessun utente trovato</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* === Tab: Scansione === */}
      {activeTab === "scansione" && <ScanConfigTab />}

      {/* === Tab: Identificazione === */}
      {activeTab === "identificazione" && <DeviceIdentificationTab />}

      {/* === Tab: Job pianificati === */}
      {activeTab === "jobs" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Job schedulati</CardTitle>
              </div>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger render={<Button size="sm" />}>
                <Plus className="h-4 w-4 mr-2" />Nuovo job
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nuovo job schedulato</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreateJob} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select name="job_type" defaultValue="known_host_check" value={newJobType} onValueChange={(v) => setNewJobType(v ?? "known_host_check")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="known_host_check">Monitoraggio host registrati (consigliato)</SelectItem>
                        <SelectItem value="arp_poll">ARP Poll (passivo via SNMP switch)</SelectItem>
                        <SelectItem value="snmp_scan">SNMP Scan</SelectItem>
                        <SelectItem value="dns_resolve">DNS Resolve</SelectItem>
                        <SelectItem value="cleanup">Pulizia Host</SelectItem>
                        <SelectItem value="ping_sweep">Ping Sweep (scan completo subnet)</SelectItem>
                        <SelectItem value="fast_scan">Scoperta veloce subnet</SelectItem>
                        <SelectItem value="nmap_scan">Nmap Scan</SelectItem>
                      </SelectContent>
                    </Select>
                    {HEAVY_JOB_TYPES.has(newJobType) && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
                        ⚠ Tipo pesante: scansiona TUTTI gli IP del subnet. Su reti grandi
                        (≥/22, 1024+ IP) può saturare CPU. Per scheduling periodico usa
                        <em> Monitoraggio host registrati</em>; tieni questo per discovery on-demand
                        o slot notturni (interval ≥ 12h).
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Rete (opzionale per cleanup)</Label>
                    <Select name="network_id">
                      <SelectTrigger><SelectValue placeholder="Tutte le reti" /></SelectTrigger>
                      <SelectContent>
                        {networks.map((n) => (
                          <SelectItem key={n.id} value={String(n.id)}>{n.name} ({n.cidr})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Intervallo</Label>
                    <Select name="interval_minutes" defaultValue="60">
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INTERVAL_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" className="w-full">Crea job</Button>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attivo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Rete</TableHead>
                  <TableHead>Intervallo</TableHead>
                  <TableHead>Ultima esecuzione</TableHead>
                  <TableHead>Prossima esecuzione</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      <Clock className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                      Nessun job schedulato
                    </TableCell>
                  </TableRow>
                ) : jobs.map((job) => {
                  const network = networks.find((n) => n.id === job.network_id);
                  const isHeavy = HEAVY_JOB_TYPES.has(job.job_type);
                  const isLargeNet = networkIsLarge(network?.cidr);
                  const shortInterval = job.interval_minutes < 720;
                  const riskyCpu = isHeavy && isLargeNet && shortInterval && !!job.enabled;
                  const isRunning = runningJobId === job.id;
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <Switch
                          checked={!!job.enabled}
                          onCheckedChange={(checked) => toggleJobEnabled(job.id, checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline">{JOB_TYPE_LABELS[job.job_type] || job.job_type}</Badge>
                          {riskyCpu && (
                            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" title="Scan completo subnet grande con frequenza <12h: rischio saturazione CPU.">
                              ⚠ Carico CPU alto
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{network ? `${network.name} (${network.cidr})` : "Tutte"}</TableCell>
                      <TableCell>
                        {INTERVAL_OPTIONS.find((o) => o.value === String(job.interval_minutes))?.label || `${job.interval_minutes} min`}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {job.last_run ? new Date(job.last_run).toLocaleString("it-IT") : "Mai"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {job.next_run ? new Date(job.next_run).toLocaleString("it-IT") : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={isRunning}
                            onClick={() => runJobNow(job.id)}
                            title="Esegui ora"
                          >
                            {isRunning
                              ? <RefreshCw className="h-4 w-4 animate-spin" />
                              : <Play className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive/60 hover:text-destructive"
                            onClick={() => deleteJob(job.id)}
                            title="Elimina job"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* === Tab: Integrazioni === */}

      {/* === Tab: HTTPS === */}
      {activeTab === "https" && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Configurazione HTTPS</CardTitle>
            </div>
            <CardDescription>Gestisci il certificato SSL/TLS per l&apos;accesso sicuro al sistema.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center gap-3 p-3 rounded-md border bg-muted/30">
              <div className={`h-3 w-3 rounded-full ${tlsStatus?.enabled && tlsStatus?.cert_exists ? "bg-green-500" : "bg-yellow-500"}`} />
              <div>
                <p className="text-sm font-medium">
                  {tlsStatus?.enabled && tlsStatus?.cert_exists
                    ? "HTTPS attivo"
                    : tlsStatus?.cert_exists
                      ? "Certificato presente — riavvia il server per attivare HTTPS"
                      : "HTTPS non configurato"}
                </p>
                {tlsStatus?.cert_info && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Soggetto: {tlsStatus.cert_info.subject} · Scadenza: {tlsStatus.cert_info.notafter}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Genera certificato self-signed</h3>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Dominio / IP</Label>
                  <Input className="w-48" value={tlsDomain} onChange={(e) => setTlsDomain(e.target.value)} placeholder="es. ipam.azienda.local" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Validità (giorni)</Label>
                  <Input className="w-24" type="number" value={tlsDays} onChange={(e) => setTlsDays(e.target.value)} />
                </div>
                <Button onClick={handleGenerateCert} disabled={generatingCert || !tlsDomain.trim()}>
                  {generatingCert ? "Generazione..." : "Genera certificato"}
                </Button>
              </div>
            </div>

            <div className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold">Importa certificato esterno</h3>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Certificato (PEM)</Label>
                  <Textarea rows={4} className="font-mono text-xs" value={importCert} onChange={(e) => setImportCert(e.target.value)} placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Chiave privata (PEM)</Label>
                  <Textarea rows={4} className="font-mono text-xs" value={importKey} onChange={(e) => setImportKey(e.target.value)} placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"} />
                </div>
                <Button onClick={handleImportCert} disabled={importingCert || !importCert.trim() || !importKey.trim()} variant="outline">
                  {importingCert ? "Importazione..." : "Importa certificato"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Tab: Moduli === */}
      {activeTab === "moduli" && <ModulesTab isAdmin={isAdmin} />}

      {/* === Tab: Aggiornamenti === */}
      {activeTab === "aggiornamenti" && <UpdatesTab />}

      {/* === Tab: Sistema (host credentials + wizard + manutenzione/dati) === */}
      {activeTab === "sistema" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Monitor className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Credenziali host di default (Windows / Linux)</CardTitle>
              </div>
              <CardDescription>
                Credenziali usate per raccogliere informazioni da host Windows (WinRM/WMI) e Linux (SSH) quando non è specificato altro. Crea le credenziali in <strong>Credenziali</strong> con tipo &quot;Windows (host)&quot; o &quot;Linux (host)&quot;.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2 min-w-[200px]">
                  <Label>Windows (WinRM/WMI)</Label>
                  <Select value={hostWindowsCredentialId || "none"} onValueChange={(v) => setHostWindowsCredentialId(v === "none" ? "" : (v ?? ""))}>
                    <SelectTrigger><SelectValue placeholder="Nessuna" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nessuna</SelectItem>
                      {credentials.filter((c) => c.credential_type === "windows").map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 min-w-[200px]">
                  <Label>Linux (SSH)</Label>
                  <Select value={hostLinuxCredentialId || "none"} onValueChange={(v) => setHostLinuxCredentialId(v === "none" ? "" : (v ?? ""))}>
                    <SelectTrigger><SelectValue placeholder="Nessuna" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nessuna</SelectItem>
                      {credentials.filter((c) => c.credential_type === "linux").map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleSaveHostCredentials} disabled={savingHostCreds}>
                  <Save className="h-4 w-4 mr-2" />
                  Salva
                </Button>
              </div>
            </CardContent>
          </Card>

          {isAdmin && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Configurazione guidata</CardTitle>
                </div>
                <CardDescription>
                  Ripeti i passaggi del primo avvio (router, DNS, credenziali, Active Directory, prima subnet). I dati già salvati non vengono cancellati.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleOpenOnboardingWizard()}
                  disabled={openingWizard}
                  className="gap-2"
                >
                  <Sparkles className={`h-4 w-4 ${openingWizard ? "animate-pulse" : ""}`} />
                  {openingWizard ? "Apertura in corso…" : "Apri wizard di configurazione"}
                </Button>
              </CardContent>
            </Card>
          )}

          {isAdmin && (
            <Card className="border-amber-500/30">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Radar className="h-5 w-5 text-amber-600" />
                  <CardTitle className="text-base">Reset lab / pre-consegna</CardTitle>
                </div>
                <CardDescription>
                  Azzera <strong>solo i dati di rete e discovery</strong> (subnet, host, ARP, DHCP,
                  credenziali scan, AD, inventario) per ripartire con il wizard e pre-configurare
                  l&apos;appliance in lab prima del cliente. Integrazioni moduli, admin e Launchpad
                  restano attivi.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2 border-amber-500/50 text-amber-800 dark:text-amber-400 hover:bg-amber-500/10"
                  onClick={() => void handleResetLabNetworkConfig()}
                  disabled={resettingLabConfig}
                >
                  <RotateCcw className={`h-4 w-4 ${resettingLabConfig ? "animate-spin" : ""}`} />
                  {resettingLabConfig ? "Reset in corso…" : "Azzera config rete e riparti da zero"}
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Dati e manutenzione</CardTitle>
              </div>
              <CardDescription>
                Esporta dati o resetta la configurazione per un nuovo cliente. Il reset cancella tutto (incluso Active Directory) tranne il profilo Nmap e le regole fingerprint.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() => { window.location.href = "/api/export"; }}
              >
                <Download className="h-4 w-4 mr-2" />
                Esporta host (CSV)
              </Button>
              <Button
                variant="outline"
                onClick={() => { window.location.href = "/api/backup"; }}
              >
                <Database className="h-4 w-4 mr-2" />
                Backup database
              </Button>
              <Button
                variant="destructive"
                onClick={handleResetConfiguration}
                disabled={resetting}
              >
                <RotateCcw className={`h-4 w-4 mr-2 ${resetting ? "animate-spin" : ""}`} />
                Reset per nuovo cliente
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

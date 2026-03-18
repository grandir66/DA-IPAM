"use client";

import { useEffect, useState } from "react";
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
import { Plus, Trash2, Clock, Download, Database, Save, Lock, Server, Radar, Pencil, RotateCcw, Hash, Monitor, Users, Shield } from "lucide-react";
import { toast } from "sonner";
import { buildCustomScanArgs, KNOWN_UDP_PORTS } from "@/lib/scanner/ports";
import type { ScheduledJob, NetworkWithStats } from "@/types";

function getNmapCommandForProfile(profile: NmapProfile): string {
  const tcp =
    profile.custom_ports !== null && profile.custom_ports !== undefined
      ? buildCustomScanArgs(profile.custom_ports)
      : profile.args;
  const udp = `nmap -sU -p ${KNOWN_UDP_PORTS} (richiede root)`;
  const snmp = profile.snmp_community?.trim()
    ? `SNMP via net-snmp (community: ${profile.snmp_community.trim()}, public)`
    : "SNMP via net-snmp (community: public)";
  return `TCP: ${tcp}\nUDP: ${udp}\n${snmp}`;
}

function getNmapCommandForForm(form: { custom_ports: string | null; args: string; snmp_community: string }): string {
  const tcp = form.custom_ports !== null ? buildCustomScanArgs(form.custom_ports) : form.args;
  const udp = `nmap -sU -p ${KNOWN_UDP_PORTS} (richiede root)`;
  const snmp = form.snmp_community?.trim()
    ? `SNMP via net-snmp (community: ${form.snmp_community.trim()}, public)`
    : "SNMP via net-snmp (community: public)";
  return `TCP: ${tcp}\nUDP: ${udp}\n${snmp}`;
}

interface NmapProfile {
  id: number;
  name: string;
  description: string;
  args: string;
  snmp_community: string | null;
  custom_ports: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

const JOB_TYPE_LABELS: Record<string, string> = {
  ping_sweep: "Ping Sweep",
  snmp_scan: "SNMP Scan",
  nmap_scan: "Nmap Scan",
  arp_poll: "ARP Poll",
  dns_resolve: "DNS Resolve",
  known_host_check: "Monitoraggio host conosciuti",
  cleanup: "Pulizia Host",
};

const INTERVAL_OPTIONS = [
  { value: "5", label: "Ogni 5 minuti" },
  { value: "15", label: "Ogni 15 minuti" },
  { value: "30", label: "Ogni 30 minuti" },
  { value: "60", label: "Ogni ora" },
  { value: "360", label: "Ogni 6 ore" },
  { value: "1440", label: "Ogni 24 ore" },
];

export default function SettingsPage() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [networks, setNetworks] = useState<NetworkWithStats[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Settings state
  const [serverPort, setServerPort] = useState("3000");
  const [savingPort, setSavingPort] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Nmap profiles state
  const [profiles, setProfiles] = useState<NmapProfile[]>([]);
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<NmapProfile | null>(null);
  const [profileForm, setProfileForm] = useState({ name: "", description: "", args: "", snmp_community: "", custom_ports: "" as string | null });

  // Reset state
  const [resetting, setResetting] = useState(false);

  // Custom OUI state
  const [customOui, setCustomOui] = useState("");
  const [savingOui, setSavingOui] = useState(false);

  // Version
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // Host credentials (Windows/Linux) - default per raccolta info da host
  const [credentials, setCredentials] = useState<{ id: number; name: string; credential_type: string }[]>([]);
  const [hostWindowsCredentialId, setHostWindowsCredentialId] = useState<string>("");
  const [hostLinuxCredentialId, setHostLinuxCredentialId] = useState<string>("");
  const [savingHostCreds, setSavingHostCreds] = useState(false);

  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then(setJobs);
    fetch("/api/networks").then((r) => r.json()).then(setNetworks);
    fetch("/api/settings").then((r) => r.json()).then((settings: Record<string, string>) => {
      if (settings.server_port) setServerPort(settings.server_port);
      if (settings.host_windows_credential_id !== undefined) setHostWindowsCredentialId(settings.host_windows_credential_id || "");
      if (settings.host_linux_credential_id !== undefined) setHostLinuxCredentialId(settings.host_linux_credential_id || "");
    });
    fetch("/api/nmap-profiles").then((r) => r.json()).then(setProfiles);
    fetch("/api/custom-oui").then((r) => r.json()).then((d: { content?: string }) => setCustomOui(d.content || ""));
    fetch("/api/credentials").then((r) => r.json()).then((creds: { id: number; name: string; credential_type: string }[]) => setCredentials(creds));
    fetch("/api/version").then((r) => r.json()).then((d: { version?: string }) => setAppVersion(d.version ?? null));
    fetch("/api/users").then((r) => r.json()).then(setUsers).catch(() => {});
    fetch("/api/tls").then((r) => r.json()).then(setTlsStatus).catch(() => {});
  }, []);

  // === Scheduled Jobs ===

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

  async function deleteJob(id: number) {
    if (!confirm("Eliminare questo job?")) return;
    await fetch(`/api/jobs?id=${id}`, { method: "DELETE" });
    setJobs((prev) => prev.filter((j) => j.id !== id));
    toast.success("Job eliminato");
  }

  // === Server Port ===

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

  async function handleSavePort() {
    const port = parseInt(serverPort);
    if (isNaN(port) || port < 1 || port > 65535) {
      toast.error("Porta non valida (1-65535)");
      return;
    }
    setSavingPort(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "server_port", value: String(port) }),
      });
      if (res.ok) {
        toast.success("Porta salvata. Riavvia il server per applicare la modifica.");
      } else {
        toast.error("Errore nel salvataggio");
      }
    } finally {
      setSavingPort(false);
    }
  }

  // === Password Change ===

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("Le password non corrispondono");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("La nuova password deve avere almeno 8 caratteri");
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      if (res.ok) {
        toast.success("Password modificata con successo");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nel cambio password");
      }
    } finally {
      setSavingPassword(false);
    }
  }

  // === Nmap Profiles ===

  function openProfileDialog(profile?: NmapProfile) {
    if (profile) {
      setEditingProfile(profile);
      const isPersonalizzato = profile.custom_ports !== null && profile.custom_ports !== undefined;
      setProfileForm({
        name: profile.name,
        description: profile.description,
        args: isPersonalizzato ? "" : profile.args,
        snmp_community: profile.snmp_community || "",
        custom_ports: isPersonalizzato ? (profile.custom_ports || "") : null,
      });
    } else {
      setEditingProfile(null);
      setProfileForm({ name: "", description: "", args: "", snmp_community: "", custom_ports: null });
    }
    setProfileDialogOpen(true);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    const isPersonalizzato = profileForm.custom_ports !== null;
    if (!profileForm.name.trim()) {
      toast.error("Nome richiesto");
      return;
    }
    if (!isPersonalizzato && !profileForm.args.trim()) {
      toast.error("Argomenti nmap richiesti");
      return;
    }

    const method = editingProfile ? "PUT" : "POST";
    const body = isPersonalizzato
      ? { name: profileForm.name, description: profileForm.description, args: "", snmp_community: profileForm.snmp_community, custom_ports: profileForm.custom_ports ?? "" }
      : { name: profileForm.name, description: profileForm.description, args: profileForm.args, snmp_community: profileForm.snmp_community };
    if (editingProfile) (body as Record<string, unknown>).id = editingProfile.id;

    const res = await fetch("/api/nmap-profiles", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      toast.success(editingProfile ? "Profilo aggiornato" : "Profilo creato");
      setProfileDialogOpen(false);
      const updated = await fetch("/api/nmap-profiles").then((r) => r.json());
      setProfiles(updated);
    } else {
      const data = await res.json();
      toast.error(data.error || "Errore");
    }
  }

  async function deleteProfile(id: number) {
    if (!confirm("Eliminare questo profilo?")) return;
    const res = await fetch(`/api/nmap-profiles?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      toast.success("Profilo eliminato");
    } else {
      const data = await res.json();
      toast.error(data.error || "Errore nell'eliminazione");
    }
  }

  async function handleSaveCustomOui() {
    setSavingOui(true);
    try {
      const res = await fetch("/api/custom-oui", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: customOui }),
      });
      if (res.ok) {
        toast.success("Custom OUI salvato");
      } else {
        toast.error("Errore nel salvataggio");
      }
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setSavingOui(false);
    }
  }

  async function handleResetConfiguration() {
    if (!confirm("Resettare tutta la configurazione? Verranno eliminate reti, host, router e switch. Utenti, impostazioni e profili nmap resteranno. Procedere?")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (res.ok) {
        toast.success("Configurazione resettata. Ricarica la pagina.");
        window.location.href = "/";
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

  // Users state
  const [users, setUsers] = useState<{ id: number; username: string; role: string; created_at: string; last_login: string | null }[]>([]);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"admin" | "viewer">("viewer");
  const [savingUser, setSavingUser] = useState(false);

  // TLS state
  const [tlsStatus, setTlsStatus] = useState<{
    enabled: boolean;
    cert_path: string | null;
    key_path: string | null;
    cert_exists: boolean;
    cert_info: Record<string, string> | null;
  } | null>(null);
  const [tlsDomain, setTlsDomain] = useState("localhost");
  const [tlsDays, setTlsDays] = useState("365");
  const [generatingCert, setGeneratingCert] = useState(false);
  const [importCert, setImportCert] = useState("");
  const [importKey, setImportKey] = useState("");
  const [importingCert, setImportingCert] = useState(false);

  // === User Management ===

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newUserPassword, role: newUserRole }),
      });
      if (res.ok) {
        toast.success("Utente creato");
        setNewUserOpen(false);
        setNewUsername(""); setNewUserPassword(""); setNewUserRole("viewer");
        const updated = await fetch("/api/users").then(r => r.json());
        setUsers(updated);
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nella creazione utente");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSavingUser(false); }
  }

  async function handleToggleUserRole(userId: number, newRole: string) {
    const res = await fetch(`/api/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) {
      toast.success(`Ruolo aggiornato a ${newRole === "admin" ? "Amministratore" : "Solo lettura"}`);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } else {
      const data = await res.json();
      toast.error(data.error || "Errore");
    }
  }

  async function handleDeleteUser(userId: number, username: string) {
    if (!confirm(`Eliminare l'utente "${username}"? L'azione è irreversibile.`)) return;
    const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Utente eliminato");
      setUsers(prev => prev.filter(u => u.id !== userId));
    } else {
      const data = await res.json();
      toast.error(data.error || "Errore nell'eliminazione");
    }
  }

  // === TLS Management ===

  async function handleGenerateCert() {
    setGeneratingCert(true);
    try {
      const res = await fetch("/api/tls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", domain: tlsDomain, days: parseInt(tlsDays) || 365 }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        const updated = await fetch("/api/tls").then(r => r.json());
        setTlsStatus(updated);
      } else {
        toast.error(data.error);
      }
    } catch { toast.error("Errore di rete"); }
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
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setImportCert(""); setImportKey("");
        const updated = await fetch("/api/tls").then(r => r.json());
        setTlsStatus(updated);
      } else {
        toast.error(data.error);
      }
    } catch { toast.error("Errore di rete"); }
    finally { setImportingCert(false); }
  }

  const [activeTab, setActiveTab] = useState<"generale" | "utenti" | "https" | "nmap" | "jobs" | "dati">("generale");

  const tabs = [
    { key: "generale" as const, label: "Generale", icon: Server },
    { key: "utenti" as const, label: "Utenti", icon: Users },
    { key: "https" as const, label: "HTTPS", icon: Shield },
    { key: "nmap" as const, label: "Profili Nmap", icon: Radar },
    { key: "jobs" as const, label: "Job Pianificati", icon: Clock },
    { key: "dati" as const, label: "Gestione Dati", icon: Database },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Impostazioni</h1>
        <p className="text-muted-foreground mt-1">Configurazione sistema, sicurezza e profili di scansione</p>
        {appVersion && (
          <p className="text-xs text-muted-foreground mt-1">DA-INVENT v{appVersion}</p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors -mb-px border border-transparent ${
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

      {/* === Tab: Generale === */}
      {activeTab === "generale" && (<>

      {/* Server Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Configurazione Server</CardTitle>
          </div>
          <CardDescription>Porta di ascolto del server. Richiede riavvio per applicare.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 max-w-sm">
            <div className="flex-1 space-y-2">
              <Label htmlFor="server-port">Porta</Label>
              <Input
                id="server-port"
                type="number"
                min={1}
                max={65535}
                value={serverPort}
                onChange={(e) => setServerPort(e.target.value)}
              />
            </div>
            <Button onClick={handleSavePort} disabled={savingPort}>
              <Save className="h-4 w-4 mr-2" />
              Salva
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Host Credentials (Windows/Linux) */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Credenziali host (Windows / Linux)</CardTitle>
          </div>
          <CardDescription>
            Credenziali di default per raccogliere informazioni da host Windows (WinRM/WMI) e Linux (SSH). Crea le credenziali in Credenziali con tipo &quot;Windows (host)&quot; o &quot;Linux (host)&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2 min-w-[200px]">
              <Label>Windows (WinRM/WMI)</Label>
              <Select value={hostWindowsCredentialId || "none"} onValueChange={(v) => setHostWindowsCredentialId(v === "none" ? "" : (v ?? ""))}>
                <SelectTrigger>
                  <SelectValue placeholder="Nessuna" />
                </SelectTrigger>
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
                <SelectTrigger>
                  <SelectValue placeholder="Nessuna" />
                </SelectTrigger>
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

      {/* Password Change */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Modifica Password Amministratore</CardTitle>
          </div>
          <CardDescription>Cambia la password dell&apos;account amministratore.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
            <div className="space-y-2">
              <Label htmlFor="current-password">Password Corrente</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">Nuova Password</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Conferma Nuova Password</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <Button type="submit" disabled={savingPassword}>
              <Lock className="h-4 w-4 mr-2" />
              Cambia Password
            </Button>
          </form>
        </CardContent>
      </Card>

      </>)}

      {/* === Tab: Utenti === */}
      {activeTab === "utenti" && (<>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Gestione Utenti</CardTitle>
            </div>
            <CardDescription className="mt-1">Gestisci gli account di accesso al sistema.</CardDescription>
          </div>
          <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="h-4 w-4 mr-2" />Nuovo Utente
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuovo Utente</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} required minLength={3} placeholder="nome.cognome" />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} required minLength={8} placeholder="Minimo 8 caratteri" />
                </div>
                <div className="space-y-2">
                  <Label>Ruolo</Label>
                  <Select value={newUserRole} onValueChange={(v) => setNewUserRole(v as "admin" | "viewer")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Amministratore</SelectItem>
                      <SelectItem value="viewer">Solo lettura</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={savingUser}>Crea Utente</Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Ruolo</TableHead>
                <TableHead>Creato il</TableHead>
                <TableHead>Ultimo accesso</TableHead>
                <TableHead className="w-[100px]">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                      {user.role === "admin" ? "Amministratore" : "Solo lettura"}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(user.created_at).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell>{user.last_login ? new Date(user.last_login).toLocaleString("it-IT") : "Mai"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => handleToggleUserRole(user.id, user.role === "admin" ? "viewer" : "admin")}
                        title={user.role === "admin" ? "Declassa a viewer" : "Promuovi ad admin"}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => handleDeleteUser(user.id, user.username)}
                        className="text-destructive hover:text-destructive"
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
      </>)}

      {/* === Tab: HTTPS === */}
      {activeTab === "https" && (<>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Configurazione HTTPS</CardTitle>
          </div>
          <CardDescription>Gestisci il certificato SSL/TLS per l&apos;accesso sicuro al sistema.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Status */}
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

          {/* Generate self-signed */}
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
                {generatingCert ? "Generazione..." : "Genera Certificato"}
              </Button>
            </div>
          </div>

          {/* Import external cert */}
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
                {importingCert ? "Importazione..." : "Importa Certificato"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      </>)}

      {/* === Tab: Profili Nmap === */}
      {activeTab === "nmap" && (<>

      {/* Nmap Profiles */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Profili Nmap</CardTitle>
            </div>
            <CardDescription className="mt-1">Configura i profili di scansione selezionabili durante le operazioni di scan.</CardDescription>
          </div>
          <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
            <DialogTrigger render={<Button size="sm" onClick={() => openProfileDialog()} />}>
              <Plus className="h-4 w-4 mr-2" />Nuovo Profilo
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingProfile ? "Modifica Profilo" : "Nuovo Profilo Nmap"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="space-y-2">
                  <Label>Nome</Label>
                  <Input
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="es. Scansione Veloce"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Descrizione</Label>
                  <Input
                    value={profileForm.description}
                    onChange={(e) => setProfileForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="es. Solo scoperta host"
                  />
                </div>
                {profileForm.custom_ports !== null ? (
                  <div className="space-y-2">
                    <Label>Porte aggiuntive (opzionale)</Label>
                    <Input
                      value={profileForm.custom_ports}
                      onChange={(e) => setProfileForm((f) => ({ ...f, custom_ports: e.target.value }))}
                      placeholder="es. 8080,8443,9000"
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Porte TCP extra oltre alle top 100. La scansione include già top 100 TCP, porte UDP note (53,67,68,69,123,161,162,500,514,520,4500) e SNMP con community.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Argomenti Nmap</Label>
                    <Input
                      value={profileForm.args}
                      onChange={(e) => setProfileForm((f) => ({ ...f, args: e.target.value }))}
                      placeholder="es. -sT -sU -p 80,161,443 -sV -T4"
                      required
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Argomenti passati a nmap. Per porte custom usa <code className="bg-muted px-1 rounded">-p 80,161,443</code>. Per UDP/SNMP aggiungi <code className="bg-muted px-1 rounded">-sU</code>.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Community SNMP (opzionale)</Label>
                  <Input
                    value={profileForm.snmp_community}
                    onChange={(e) => setProfileForm((f) => ({ ...f, snmp_community: e.target.value }))}
                    placeholder="es. public"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Per rilevare dispositivi SNMP (switch, stampanti) che rispondono solo con la community corretta.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Comando nmap</Label>
                  <code className="block text-xs font-mono break-all bg-muted/50 px-2 py-1.5 rounded overflow-x-auto">
                    nmap {getNmapCommandForForm(profileForm)} &lt;ip&gt;
                  </code>
                </div>
                <Button type="submit" className="w-full">
                  {editingProfile ? "Aggiorna" : "Crea"} Profilo
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Descrizione</TableHead>
                <TableHead>Comando nmap</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    <Radar className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                    Nessun profilo nmap
                  </TableCell>
                </TableRow>
              ) : profiles.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell className="font-medium">{profile.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{profile.description || "—"}</TableCell>
                  <TableCell className="max-w-md">
                    <code className="block text-xs font-mono break-all bg-muted/50 px-2 py-1.5 rounded" title={getNmapCommandForProfile(profile)}>
                      nmap {getNmapCommandForProfile(profile)} &lt;ip&gt;
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant={profile.is_default ? "secondary" : "outline"}>
                      {profile.is_default ? "Default" : "Custom"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openProfileDialog(profile)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {!profile.is_default && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive/60 hover:text-destructive"
                          onClick={() => deleteProfile(profile.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Custom OUI */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Custom OUI (Vendor MAC)</CardTitle>
          </div>
          <CardDescription>
            Sovrascrivi o aggiungi vendor per prefissi MAC. Una riga per voce: <code className="bg-muted px-1 rounded">AABBCC Nome Vendor</code>. Le righe che iniziano con # sono commenti.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={customOui}
            onChange={(e) => setCustomOui(e.target.value)}
            placeholder={"AABBCC Vendor Name\n001122 My Custom Device\n# commento"}
            rows={8}
            className="font-mono text-sm"
          />
          <Button onClick={handleSaveCustomOui} disabled={savingOui}>
            <Save className="h-4 w-4 mr-2" />
            {savingOui ? "Salvataggio..." : "Salva Custom OUI"}
          </Button>
        </CardContent>
      </Card>

      </>)}

      {/* === Tab: Job Pianificati === */}
      {activeTab === "jobs" && (<>

      {/* Scheduled Jobs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Job Schedulati</CardTitle>
            </div>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button size="sm" />}>
              <Plus className="h-4 w-4 mr-2" />Nuovo Job
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nuovo Job Schedulato</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreateJob} className="space-y-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select name="job_type" defaultValue="ping_sweep">
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ping_sweep">Ping Sweep</SelectItem>
                      <SelectItem value="snmp_scan">SNMP Scan</SelectItem>
                      <SelectItem value="nmap_scan">Nmap Scan</SelectItem>
                      <SelectItem value="arp_poll">ARP Poll</SelectItem>
                      <SelectItem value="dns_resolve">DNS Resolve</SelectItem>
                      <SelectItem value="known_host_check">Monitoraggio host conosciuti</SelectItem>
                      <SelectItem value="cleanup">Pulizia Host</SelectItem>
                    </SelectContent>
                  </Select>
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
                <Button type="submit" className="w-full">Crea Job</Button>
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
                <TableHead>Ultima Esecuzione</TableHead>
                <TableHead>Prossima Esecuzione</TableHead>
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
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <Switch
                        checked={!!job.enabled}
                        onCheckedChange={(checked) => toggleJobEnabled(job.id, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{JOB_TYPE_LABELS[job.job_type] || job.job_type}</Badge>
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive/60 hover:text-destructive"
                        onClick={() => deleteJob(job.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      </>)}

      {/* === Tab: Gestione Dati === */}
      {activeTab === "dati" && (<>

      {/* Data Management */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Gestione Dati</CardTitle>
          </div>
          <CardDescription>Esporta dati o resetta la configurazione per un nuovo cliente.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => { window.location.href = "/api/export"; }}
          >
            <Download className="h-4 w-4 mr-2" />
            Esporta Host (CSV)
          </Button>
          <Button
            variant="outline"
            onClick={() => { window.location.href = "/api/backup"; }}
          >
            <Database className="h-4 w-4 mr-2" />
            Backup Database
          </Button>
          <Button
            variant="destructive"
            onClick={handleResetConfiguration}
            disabled={resetting}
          >
            <RotateCcw className={`h-4 w-4 mr-2 ${resetting ? "animate-spin" : ""}`} />
            Reset per Nuovo Cliente
          </Button>
        </CardContent>
      </Card>

      </>)}
    </div>
  );
}

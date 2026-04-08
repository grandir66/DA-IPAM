"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
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
import { Plus, Trash2, Clock, Download, Database, Save, Lock, Server, Radar, Pencil, RotateCcw, Hash, Monitor, Users, Shield, Tags, ArrowUpCircle, RefreshCw, Sparkles, Terminal, Search } from "lucide-react";
import { toast } from "sonner";
import { Fingerprint } from "lucide-react";
import type { ScheduledJob, NetworkWithStats } from "@/types";
import Link from "next/link";
import { ManualUpdateInstructions } from "@/components/shared/manual-update-instructions";
import { ScanConfigTab } from "@/components/settings/scan-config-tab";
import { DeviceIdentificationTab } from "@/components/settings/device-identification-tab";
import { IntegrationsTab } from "@/components/settings/integrations-tab";

const JOB_TYPE_LABELS: Record<string, string> = {
  ping_sweep: "Scoperta rete (ICMP + Nmap quick + DNS + ARP)",
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
  const router = useRouter();
  const { data: session } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin";
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

  // Reset state
  const [resetting, setResetting] = useState(false);

  // Custom OUI state
  const [customOui, setCustomOui] = useState("");
  const [savingOui, setSavingOui] = useState(false);

  // Version & Update
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ remoteVersion: string; updateAvailable: boolean } | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [openingWizard, setOpeningWizard] = useState(false);
  const [showManualUpdate, setShowManualUpdate] = useState(false);

  // Host credentials (Windows/Linux) - default per raccolta info da host
  const [credentials, setCredentials] = useState<{ id: number; name: string; credential_type: string }[]>([]);
  const [hostWindowsCredentialId, setHostWindowsCredentialId] = useState<string>("");
  const [hostLinuxCredentialId, setHostLinuxCredentialId] = useState<string>("");
  const [savingHostCreds, setSavingHostCreds] = useState(false);

  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then(setJobs).catch(() => {});
    fetch("/api/networks").then((r) => r.json()).then(setNetworks).catch(() => {});
    fetch("/api/settings").then((r) => r.json()).then((settings: Record<string, string>) => {
      if (settings.server_port) setServerPort(settings.server_port);
      if (settings.host_windows_credential_id !== undefined) setHostWindowsCredentialId(settings.host_windows_credential_id || "");
      if (settings.host_linux_credential_id !== undefined) setHostLinuxCredentialId(settings.host_linux_credential_id || "");
    }).catch(() => {});
    fetch("/api/custom-oui").then((r) => r.json()).then((d: { content?: string }) => setCustomOui(d.content || "")).catch(() => {});
    fetch("/api/credentials").then((r) => r.json()).then((creds: { id: number; name: string; credential_type: string }[]) => setCredentials(creds)).catch(() => {});
    fetch("/api/version").then((r) => r.json()).then((d: { version?: string }) => setAppVersion(d.version ?? null)).catch(() => {});
    fetch("/api/system/update")
      .then((r) => r.json())
      .then((d: { remoteVersion?: string; updateAvailable?: boolean; error?: string }) => {
        if (d.remoteVersion) {
          setUpdateInfo({
            remoteVersion: d.remoteVersion,
            updateAvailable: !!d.updateAvailable,
          });
        } else {
          setUpdateInfo(null);
        }
        setUpdateCheckError(typeof d.error === "string" ? d.error : null);
      })
      .catch(() => {
        setUpdateCheckError("Impossibile contattare il server per il controllo versione.");
      });
    fetch("/api/users").then((r) => r.json()).then(setUsers).catch(() => {});
    fetch("/api/tenants").then((r) => r.json()).then((data: { id: number; codice_cliente: string; ragione_sociale: string }[]) => {
      if (Array.isArray(data)) setTenantsList(data);
    }).catch(() => {});
    fetch("/api/tls").then((r) => r.json()).then(setTlsStatus).catch(() => {});
  }, []);

  async function runGitApplyUpdate(confirmMessage: string) {
    if (!confirm(confirmMessage)) return;
    setApplyingUpdate(true);
    try {
      const res = await fetch("/api/system/update?action=apply", { method: "POST" });
      let data: {
        error?: string;
        detail?: string;
        dirtyFiles?: string[];
        requiresRestart?: boolean;
        message?: string;
      } = {};
      try {
        data = await res.json();
      } catch {
        toast.error("Risposta non valida dal server");
        return;
      }
      if (!res.ok) {
        const parts = [data.error || "Errore durante l'aggiornamento"];
        if (typeof data.detail === "string" && data.detail.length > 0) {
          parts.push(data.detail);
        }
        toast.error(parts.join(" "));
        return;
      }
      toast.success(data.message || "Aggiornamento completato");
      setUpdateCheckError(null);
      if (data.requiresRestart) {
        toast.info("Riavvio del servizio in corso…");
        setTimeout(async () => {
          try {
            await fetch("/api/system/update?action=restart", { method: "POST" });
          } catch {
            /* ignore */
          }
          let attempts = 0;
          const poll = setInterval(async () => {
            attempts += 1;
            try {
              const hr = await fetch("/api/health", { cache: "no-store" });
              if (hr.ok) {
                clearInterval(poll);
                window.location.reload();
              }
            } catch {
              if (attempts > 40) {
                clearInterval(poll);
                toast.error("Il server non risponde. Ricarica la pagina o riavvia il servizio manualmente.");
              }
            }
          }, 2000);
        }, 1500);
      } else {
        fetch("/api/version")
          .then((r) => r.json())
          .then((d: { version?: string }) => setAppVersion(d.version ?? null));
        fetch("/api/system/update")
          .then((r) => r.json())
          .then((d: { remoteVersion?: string; updateAvailable?: boolean; error?: string }) => {
            if (d.remoteVersion) {
              setUpdateInfo({ remoteVersion: d.remoteVersion, updateAvailable: !!d.updateAvailable });
            }
            setUpdateCheckError(typeof d.error === "string" ? d.error : null);
          })
          .catch(() => {});
      }
    } catch {
      toast.error("Errore di rete durante l'aggiornamento");
    } finally {
      setApplyingUpdate(false);
    }
  }

  async function handleApplySystemUpdate() {
    if (!updateInfo?.remoteVersion || !updateInfo.updateAvailable) return;
    await runGitApplyUpdate(
      `Installare la versione ${updateInfo.remoteVersion}? Verranno eseguiti git pull, npm install e build; il servizio potrà essere riavviato.`
    );
  }

  /** Aggiornamento anche se il controllo versione remota non ha funzionato (stesso flusso git pull del server). */
  async function handleApplyGitPullManual() {
    await runGitApplyUpdate(
      "Scaricare e installare l'ultimo codice da origin/main (git pull, npm install, build)? Il servizio potrà essere riavviato."
    );
  }

  async function handleOpenOnboardingWizard() {
    if (
      !confirm(
        "Il wizard di configurazione guidata verrà riaperto. Reti, dispositivi e credenziali già inseriti restano nel database; potrai rivedere o aggiornare i passaggi. Continuare?"
      )
    ) {
      return;
    }
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

  // === Nmap Profile ===

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

  // Users state
  interface UserWithAccess {
    id: number;
    username: string;
    email: string | null;
    role: string;
    created_at: string;
    last_login: string | null;
    tenant_access?: { tenant_id: number; codice_cliente: string; ragione_sociale: string; role: string }[];
  }
  const [users, setUsers] = useState<UserWithAccess[]>([]);
  const [tenantsList, setTenantsList] = useState<{ id: number; codice_cliente: string; ragione_sociale: string }[]>([]);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"superadmin" | "admin" | "viewer">("viewer");
  const [newUserTenantIds, setNewUserTenantIds] = useState<number[]>([]);
  const [savingUser, setSavingUser] = useState(false);
  // Edit user dialog
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editUserRole, setEditUserRole] = useState<"superadmin" | "admin" | "viewer">("admin");
  const [editUserTenantIds, setEditUserTenantIds] = useState<number[]>([]);
  const [savingEditUser, setSavingEditUser] = useState(false);

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
        const updated = await fetch("/api/users").then(r => r.json());
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
    setEditUserTenantIds(user.tenant_access?.map(a => a.tenant_id) ?? []);
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
        const updated = await fetch("/api/users").then(r => r.json());
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

  const [activeTab, setActiveTab] = useState<
    "generale" | "utenti" | "https" | "scansione" | "identificazione" | "jobs" | "dati" | "integrazioni"
  >("generale");

  const tabs = [
    { key: "generale" as const, label: "Generale", icon: Server },
    { key: "utenti" as const, label: "Utenti", icon: Users },
    { key: "https" as const, label: "HTTPS", icon: Shield },
    { key: "scansione" as const, label: "Scansione", icon: Radar },
    { key: "identificazione" as const, label: "Identificazione", icon: Fingerprint },
    { key: "jobs" as const, label: "Job Pianificati", icon: Clock },
    { key: "integrazioni" as const, label: "Integrazioni", icon: Tags },
    { key: "dati" as const, label: "Gestione Dati", icon: Database },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Impostazioni</h1>
        <p className="text-muted-foreground mt-1">Configurazione sistema, sicurezza e profili di scansione</p>
        {appVersion && (
          <div className="flex items-center gap-3 mt-2">
            <Badge variant="outline" className="text-xs">
              v{appVersion}
            </Badge>
            {updateInfo?.updateAvailable && (
              <Badge variant="default" className="text-xs gap-1 animate-pulse">
                <ArrowUpCircle className="h-3 w-3" />
                v{updateInfo.remoteVersion} disponibile
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={async () => {
                setCheckingUpdate(true);
                try {
                  const res = await fetch("/api/system/update");
                  const data = (await res.json()) as {
                    remoteVersion?: string;
                    updateAvailable?: boolean;
                    error?: string;
                  };
                  if (data.remoteVersion) {
                    setUpdateInfo({
                      remoteVersion: data.remoteVersion,
                      updateAvailable: !!data.updateAvailable,
                    });
                  } else {
                    setUpdateInfo(null);
                  }
                  setUpdateCheckError(typeof data.error === "string" ? data.error : null);
                  if (data.error) {
                    toast.error(data.error);
                  } else if (data.remoteVersion) {
                    if (data.updateAvailable) {
                      toast.info(`Nuova versione disponibile: ${data.remoteVersion}`);
                    } else {
                      toast.success("Il sistema è aggiornato");
                    }
                  }
                } catch {
                  toast.error("Errore nel controllo aggiornamenti");
                  setUpdateCheckError("Richiesta fallita");
                } finally {
                  setCheckingUpdate(false);
                }
              }}
              disabled={checkingUpdate || applyingUpdate}
            >
              <RefreshCw className={`h-3 w-3 ${checkingUpdate ? "animate-spin" : ""}`} />
              Controlla aggiornamenti
            </Button>
            {updateInfo?.updateAvailable && isAdmin && (
              <Button
                variant="default"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => void handleApplySystemUpdate()}
                disabled={checkingUpdate || applyingUpdate}
              >
                <Download className={`h-3 w-3 ${applyingUpdate ? "animate-pulse" : ""}`} />
                {applyingUpdate ? "Installazione…" : "Installa aggiornamento"}
              </Button>
            )}
            {updateInfo?.updateAvailable && !isAdmin && (
              <span className="text-xs text-muted-foreground max-w-[220px]">
                Solo un amministratore può installare l&apos;aggiornamento da qui.
              </span>
            )}
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => void handleApplyGitPullManual()}
                disabled={checkingUpdate || applyingUpdate}
                title="Esegue git pull da main anche se il controllo versione non ha rilevato differenze"
              >
                <Download className="h-3 w-3" />
                Aggiorna da Git (main)
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={() => setShowManualUpdate((v) => !v)}
              title="Mostra istruzioni per aggiornamento manuale da console SSH"
            >
              <Terminal className="h-3 w-3" />
              {showManualUpdate ? "Nascondi console" : "Aggiornamento console"}
            </Button>
          </div>
        )}
        {updateCheckError && appVersion && (
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-2 max-w-2xl">
            Controllo remoto: {updateCheckError}
            {" "}
            Puoi comunque aggiornare da SSH con i comandi nella sezione qui sotto, oppure usare &quot;Aggiorna da Git (main)&quot; se sei amministratore.
          </p>
        )}
      </div>

      {showManualUpdate && (
        <ManualUpdateInstructions className="max-w-3xl" />
      )}

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

      {/* Wizard configurazione iniziale */}
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
                      <SelectItem value="superadmin">Super Amministratore</SelectItem>
                      <SelectItem value="admin">Amministratore</SelectItem>
                      <SelectItem value="viewer">Solo lettura</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newUserRole !== "superadmin" && tenantsList.length > 0 && (
                  <div className="space-y-2">
                    <Label>Clienti assegnati</Label>
                    <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                      {tenantsList.map(t => (
                        <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                          <input
                            type="checkbox"
                            checked={newUserTenantIds.includes(t.id)}
                            onChange={(e) => {
                              if (e.target.checked) setNewUserTenantIds(prev => [...prev, t.id]);
                              else setNewUserTenantIds(prev => prev.filter(id => id !== t.id));
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
                <Button type="submit" disabled={savingUser}>Crea Utente</Button>
              </form>
            </DialogContent>
          </Dialog>

          {/* Dialog modifica utente */}
          <Dialog open={editUserOpen} onOpenChange={setEditUserOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Modifica Utente</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSaveEditUser} className="space-y-4">
                <div className="space-y-2">
                  <Label>Ruolo</Label>
                  <Select value={editUserRole} onValueChange={(v) => { setEditUserRole((v ?? editUserRole) as "superadmin" | "admin" | "viewer"); if (v === "superadmin") setEditUserTenantIds([]); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="superadmin">Super Amministratore</SelectItem>
                      <SelectItem value="admin">Amministratore</SelectItem>
                      <SelectItem value="viewer">Solo lettura</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {editUserRole !== "superadmin" && tenantsList.length > 0 && (
                  <div className="space-y-2">
                    <Label>Clienti assegnati</Label>
                    <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
                      {tenantsList.map(t => (
                        <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
                          <input
                            type="checkbox"
                            checked={editUserTenantIds.includes(t.id)}
                            onChange={(e) => {
                              if (e.target.checked) setEditUserTenantIds(prev => [...prev, t.id]);
                              else setEditUserTenantIds(prev => prev.filter(id => id !== t.id));
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
                <TableHead className="w-[100px]">Azioni</TableHead>
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
                        {user.tenant_access.map(a => (
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

      {/* === Tab: Scansione (Profilo Nmap + Quick Scan) === */}
      {activeTab === "scansione" && <ScanConfigTab />}

      {/* === Tab: Identificazione dispositivi (Pipeline + sysObjID + Firme + Classificazione) === */}
      {activeTab === "identificazione" && <DeviceIdentificationTab />}

      {/* === Tab: Integrazioni (LibreNMS, Loki, Graylog) === */}
      {activeTab === "integrazioni" && <IntegrationsTab />}

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
          <CardDescription>Esporta dati o resetta la configurazione per un nuovo cliente. Il reset cancella tutto (incluso Active Directory) tranne il profilo Nmap e le regole fingerprint.</CardDescription>
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

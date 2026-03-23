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
import { Plus, Trash2, Clock, Download, Database, Save, Lock, Server, Radar, Pencil, RotateCcw, Hash, Monitor, Users, Shield, Tags, ArrowUpCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { buildTcpScanArgs, buildUdpScanArgs } from "@/lib/scanner/ports";
import {
  getClassificationLabel,
  DEVICE_CLASSIFICATIONS_ORDERED,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import type { ScheduledJob, NetworkWithStats } from "@/types";
import Link from "next/link";

/** Anteprima solo con le porte che inserisci (nessun elenco nascosto). */
function getNmapCommandForForm(form: { tcp_ports: string; udp_ports: string; snmp_community: string }): string {
  const tcpTrim = form.tcp_ports.trim();
  const udpTrim = form.udp_ports.trim();
  const tcp = tcpTrim ? buildTcpScanArgs(null, tcpTrim) : "— inserisci le porte TCP —";
  const udp = udpTrim ? buildUdpScanArgs(udpTrim) : "— nessuna UDP (solo TCP) —";
  const snmp = form.snmp_community?.trim()
    ? `SNMP (community profilo: ${form.snmp_community.trim()} + catena rete/credenziali)`
    : "SNMP (community da rete / credenziali)";
  return `TCP: nmap ${tcp} <ip>\nUDP: nmap ${udp} <ip>\n${snmp}`;
}

interface NmapProfile {
  id: number;
  name: string;
  description: string;
  args: string;
  snmp_community: string | null;
  custom_ports: string | null;
  tcp_ports: string | null;
  udp_ports: string | null;
  is_default: number;
  created_at: string;
  updated_at: string;
}

interface FingerprintMapRow {
  id: number;
  match_kind: "exact" | "contains";
  pattern: string;
  classification: string;
  priority: number;
  enabled: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

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

  // Nmap profile state (single profile)
  const [nmapProfile, setNmapProfile] = useState<NmapProfile | null>(null);
  const [profileForm, setProfileForm] = useState({
    name: "",
    description: "",
    tcp_ports: "",
    udp_ports: "",
    snmp_community: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);

  // Reset state
  const [resetting, setResetting] = useState(false);

  // Custom OUI state
  const [customOui, setCustomOui] = useState("");
  const [savingOui, setSavingOui] = useState(false);

  // Version & Update
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ remoteVersion: string; updateAvailable: boolean } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Host credentials (Windows/Linux) - default per raccolta info da host
  const [credentials, setCredentials] = useState<{ id: number; name: string; credential_type: string }[]>([]);
  const [hostWindowsCredentialId, setHostWindowsCredentialId] = useState<string>("");
  const [hostLinuxCredentialId, setHostLinuxCredentialId] = useState<string>("");
  const [savingHostCreds, setSavingHostCreds] = useState(false);

  const [fpMapRows, setFpMapRows] = useState<FingerprintMapRow[]>([]);
  const [fpDialogOpen, setFpDialogOpen] = useState(false);
  const [editingFp, setEditingFp] = useState<FingerprintMapRow | null>(null);
  const [fpForm, setFpForm] = useState({
    match_kind: "contains" as "exact" | "contains",
    pattern: "",
    classification: "server",
    priority: 100,
    enabled: true,
    note: "",
  });
  const [savingFp, setSavingFp] = useState(false);

  // Device Fingerprint Rules (firme unificate)
  interface FpRule {
    id: number; name: string; device_label: string; classification: string;
    priority: number; enabled: number; builtin: number;
    tcp_ports_key: string | null; tcp_ports_optional: string | null; min_key_ports: number | null;
    oid_prefix: string | null; sysdescr_pattern: string | null; hostname_pattern: string | null;
    mac_vendor_pattern: string | null; banner_pattern: string | null;
    ttl_min: number | null; ttl_max: number | null; note: string | null;
  }
  const [fpRules, setFpRules] = useState<FpRule[]>([]);
  const [fpRuleDialogOpen, setFpRuleDialogOpen] = useState(false);
  const [editingFpRule, setEditingFpRule] = useState<FpRule | null>(null);
  const emptyFpRuleForm = {
    name: "", device_label: "", classification: "server", priority: 100, enabled: true,
    tcp_ports_key: "", tcp_ports_optional: "", min_key_ports: "",
    oid_prefix: "", sysdescr_pattern: "", hostname_pattern: "",
    mac_vendor_pattern: "", banner_pattern: "", ttl_min: "", ttl_max: "", note: "",
  };
  const [fpRuleForm, setFpRuleForm] = useState(emptyFpRuleForm);
  const [savingFpRule, setSavingFpRule] = useState(false);

  function loadFpRules() {
    fetch("/api/fingerprint-rules")
      .then((r) => r.json())
      .then((rows: FpRule[]) => setFpRules(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }

  function openFpRuleDialog(rule?: FpRule) {
    if (rule) {
      setEditingFpRule(rule);
      setFpRuleForm({
        name: rule.name, device_label: rule.device_label, classification: rule.classification,
        priority: rule.priority, enabled: rule.enabled === 1,
        tcp_ports_key: rule.tcp_ports_key ?? "", tcp_ports_optional: rule.tcp_ports_optional ?? "",
        min_key_ports: rule.min_key_ports != null ? String(rule.min_key_ports) : "",
        oid_prefix: rule.oid_prefix ?? "", sysdescr_pattern: rule.sysdescr_pattern ?? "",
        hostname_pattern: rule.hostname_pattern ?? "", mac_vendor_pattern: rule.mac_vendor_pattern ?? "",
        banner_pattern: rule.banner_pattern ?? "", ttl_min: rule.ttl_min != null ? String(rule.ttl_min) : "",
        ttl_max: rule.ttl_max != null ? String(rule.ttl_max) : "", note: rule.note ?? "",
      } as typeof emptyFpRuleForm);
    } else {
      setEditingFpRule(null);
      setFpRuleForm(emptyFpRuleForm);
    }
    setFpRuleDialogOpen(true);
  }

  async function handleSaveFpRule(e: React.FormEvent) {
    e.preventDefault();
    setSavingFpRule(true);
    try {
      const body = {
        name: fpRuleForm.name.trim(), device_label: fpRuleForm.device_label.trim(),
        classification: fpRuleForm.classification, priority: fpRuleForm.priority,
        enabled: fpRuleForm.enabled,
        tcp_ports_key: fpRuleForm.tcp_ports_key.trim() || null,
        tcp_ports_optional: fpRuleForm.tcp_ports_optional.trim() || null,
        min_key_ports: fpRuleForm.min_key_ports ? parseInt(fpRuleForm.min_key_ports, 10) : null,
        oid_prefix: fpRuleForm.oid_prefix.trim() || null,
        sysdescr_pattern: fpRuleForm.sysdescr_pattern.trim() || null,
        hostname_pattern: fpRuleForm.hostname_pattern.trim() || null,
        mac_vendor_pattern: fpRuleForm.mac_vendor_pattern.trim() || null,
        banner_pattern: fpRuleForm.banner_pattern.trim() || null,
        ttl_min: fpRuleForm.ttl_min ? parseInt(fpRuleForm.ttl_min, 10) : null,
        ttl_max: fpRuleForm.ttl_max ? parseInt(fpRuleForm.ttl_max, 10) : null,
        note: fpRuleForm.note.trim() || null,
      };
      const url = editingFpRule ? `/api/fingerprint-rules/${editingFpRule.id}` : "/api/fingerprint-rules";
      const method = editingFpRule ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json(); toast.error(err.error || "Errore"); return; }
      toast.success(editingFpRule ? "Regola aggiornata" : "Regola creata");
      setFpRuleDialogOpen(false);
      loadFpRules();
    } catch { toast.error("Errore di rete"); } finally { setSavingFpRule(false); }
  }

  async function deleteFpRule(id: number) {
    if (!confirm("Eliminare questa regola?")) return;
    const res = await fetch(`/api/fingerprint-rules/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Errore nell'eliminazione"); return; }
    toast.success("Regola eliminata");
    loadFpRules();
  }

  async function toggleFpRuleEnabled(rule: FpRule, enabled: boolean) {
    await fetch(`/api/fingerprint-rules/${rule.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    loadFpRules();
  }

  async function resetBuiltinRules() {
    if (!confirm("Ripristinare tutte le regole built-in? Le regole built-in modificate verranno resettate ai valori di default.")) return;
    const res = await fetch("/api/fingerprint-rules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ _action: "reset_builtin" }),
    });
    if (!res.ok) { toast.error("Errore nel ripristino"); return; }
    toast.success("Regole built-in ripristinate");
    loadFpRules();
  }

  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then(setJobs);
    fetch("/api/networks").then((r) => r.json()).then(setNetworks);
    fetch("/api/settings").then((r) => r.json()).then((settings: Record<string, string>) => {
      if (settings.server_port) setServerPort(settings.server_port);
      if (settings.host_windows_credential_id !== undefined) setHostWindowsCredentialId(settings.host_windows_credential_id || "");
      if (settings.host_linux_credential_id !== undefined) setHostLinuxCredentialId(settings.host_linux_credential_id || "");
    });
    fetch("/api/nmap-profiles").then((r) => r.json()).then((rows: NmapProfile[]) => {
      const profile = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      setNmapProfile(profile);
      if (profile) {
        setProfileForm({
          name: profile.name,
          description: profile.description,
          tcp_ports: profile.tcp_ports ?? "",
          udp_ports: profile.udp_ports ?? "",
          snmp_community: profile.snmp_community || "",
        });
      }
    });
    fetch("/api/custom-oui").then((r) => r.json()).then((d: { content?: string }) => setCustomOui(d.content || ""));
    fetch("/api/credentials").then((r) => r.json()).then((creds: { id: number; name: string; credential_type: string }[]) => setCredentials(creds));
    fetch("/api/version").then((r) => r.json()).then((d: { version?: string }) => setAppVersion(d.version ?? null));
    fetch("/api/system/update").then((r) => r.json()).then((d) => {
      if (d.remoteVersion) setUpdateInfo({ remoteVersion: d.remoteVersion, updateAvailable: d.updateAvailable });
    }).catch(() => {});
    fetch("/api/users").then((r) => r.json()).then(setUsers).catch(() => {});
    fetch("/api/tls").then((r) => r.json()).then(setTlsStatus).catch(() => {});
    fetch("/api/fingerprint-classification-map")
      .then((r) => r.json())
      .then((rows: FingerprintMapRow[]) => setFpMapRows(Array.isArray(rows) ? rows : []))
      .catch(() => {});
    loadFpRules();
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

  // === Nmap Profile ===

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profileForm.name.trim()) {
      toast.error("Nome richiesto");
      return;
    }
    if (!profileForm.tcp_ports.trim()) {
      toast.error("Indica le porte TCP da testare (numeri separati da virgola, es. 22,80,443,445)");
      return;
    }

    setSavingProfile(true);
    try {
      const body: Record<string, unknown> = {
        name: profileForm.name,
        description: profileForm.description,
        args: "",
        custom_ports: null,
        tcp_ports: profileForm.tcp_ports.trim(),
        udp_ports: profileForm.udp_ports.trim(),
        snmp_community: profileForm.snmp_community.trim() || null,
      };
      if (nmapProfile) body.id = nmapProfile.id;

      const res = await fetch("/api/nmap-profiles", {
        method: nmapProfile ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast.success("Profilo Nmap salvato");
        const updated = await fetch("/api/nmap-profiles").then((r) => r.json()) as NmapProfile[];
        if (Array.isArray(updated) && updated.length > 0) setNmapProfile(updated[0]);
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nel salvataggio");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSavingProfile(false);
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

  function openFpDialog(row?: FingerprintMapRow) {
    if (row) {
      setEditingFp(row);
      setFpForm({
        match_kind: row.match_kind,
        pattern: row.pattern,
        classification: row.classification,
        priority: row.priority,
        enabled: row.enabled === 1,
        note: row.note ?? "",
      });
    } else {
      setEditingFp(null);
      setFpForm({
        match_kind: "contains",
        pattern: "",
        classification: "server",
        priority: 100,
        enabled: true,
        note: "",
      });
    }
    setFpDialogOpen(true);
  }

  async function handleSaveFpMap(e: React.FormEvent) {
    e.preventDefault();
    if (!fpForm.pattern.trim()) {
      toast.error("Pattern richiesto");
      return;
    }
    setSavingFp(true);
    try {
      const payload = {
        match_kind: fpForm.match_kind,
        pattern: fpForm.pattern.trim(),
        classification: fpForm.classification,
        priority: fpForm.priority,
        enabled: fpForm.enabled,
        note: fpForm.note.trim() || null,
      };
      const method = editingFp ? "PUT" : "POST";
      const url = editingFp ? `/api/fingerprint-classification-map/${editingFp.id}` : "/api/fingerprint-classification-map";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(editingFp ? "Regola aggiornata" : "Regola creata");
        setFpDialogOpen(false);
        const updated = await fetch("/api/fingerprint-classification-map").then((r) => r.json());
        setFpMapRows(Array.isArray(updated) ? updated : []);
      } else {
        toast.error((data as { error?: string }).error || "Errore nel salvataggio");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setSavingFp(false);
    }
  }

  async function toggleFpEnabled(row: FingerprintMapRow, enabled: boolean) {
    const res = await fetch(`/api/fingerprint-classification-map/${row.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setFpMapRows((prev) => prev.map((r) => (r.id === row.id ? (data as FingerprintMapRow) : r)));
    } else {
      toast.error((data as { error?: string }).error || "Errore");
    }
  }

  async function deleteFpMap(id: number) {
    if (!confirm("Eliminare questa regola?")) return;
    const res = await fetch(`/api/fingerprint-classification-map/${id}`, { method: "DELETE" });
    if (res.ok) {
      setFpMapRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("Regola eliminata");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error((data as { error?: string }).error || "Errore");
    }
  }

  async function handleResetConfiguration() {
    if (!confirm("Resettare tutta la configurazione? Verranno eliminati TUTTI i dati: reti, host, dispositivi, credenziali, utenti e impostazioni. Resteranno solo il profilo Nmap e le regole fingerprint. Dovrai rifare il setup iniziale. Procedere?")) return;
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

  const [activeTab, setActiveTab] = useState<
    "generale" | "utenti" | "https" | "nmap" | "classificazione" | "firme" | "jobs" | "dati"
  >("generale");

  const tabs = [
    { key: "generale" as const, label: "Generale", icon: Server },
    { key: "utenti" as const, label: "Utenti", icon: Users },
    { key: "https" as const, label: "HTTPS", icon: Shield },
    { key: "nmap" as const, label: "Profilo Nmap", icon: Radar },
    { key: "firme" as const, label: "Firme dispositivi", icon: Monitor },
    { key: "classificazione" as const, label: "Classificazione", icon: Tags },
    { key: "jobs" as const, label: "Job Pianificati", icon: Clock },
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
                  const data = await res.json();
                  if (data.remoteVersion) {
                    setUpdateInfo({ remoteVersion: data.remoteVersion, updateAvailable: data.updateAvailable });
                    if (data.updateAvailable) {
                      toast.info(`Nuova versione disponibile: ${data.remoteVersion}`);
                    } else {
                      toast.success("Il sistema è aggiornato");
                    }
                  } else if (data.error) {
                    toast.error(data.error);
                  }
                } catch {
                  toast.error("Errore nel controllo aggiornamenti");
                } finally {
                  setCheckingUpdate(false);
                }
              }}
              disabled={checkingUpdate}
            >
              <RefreshCw className={`h-3 w-3 ${checkingUpdate ? "animate-spin" : ""}`} />
              Controlla aggiornamenti
            </Button>
          </div>
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

      {/* === Tab: Profilo Nmap === */}
      {activeTab === "nmap" && (<>

      {/* Nmap Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Profilo Nmap</CardTitle>
          </div>
          <CardDescription className="mt-1">
            Indica solo le porte che vuoi testare (TCP obbligatorie; UDP opzionali — se lasci vuoto UDP, non viene eseguita alcuna scansione UDP). Usato per scansioni Nmap manuali e job pianificati. La scoperta rete automatica resta in modalità veloce su altre porte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSaveProfile} className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input
                  value={profileForm.name}
                  onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="es. Il mio profilo"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Descrizione</Label>
                <Input
                  value={profileForm.description}
                  onChange={(e) => setProfileForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Note libere"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Porte TCP da testare</Label>
              <Textarea
                value={profileForm.tcp_ports}
                onChange={(e) => setProfileForm((f) => ({ ...f, tcp_ports: e.target.value }))}
                placeholder="es. 22,8006,443 — includi 8006 per l’interfaccia Proxmox (HTTPS)"
                className="font-mono text-sm min-h-[88px]"
                required
              />
              <p className="text-xs text-muted-foreground">
                Elenco separato da virgole. Solo queste porte TCP vengono usate nello scan con questo profilo (nessun elenco predefinito aggiunto dal sistema).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Porte UDP da testare (opzionale)</Label>
              <Textarea
                value={profileForm.udp_ports}
                onChange={(e) => setProfileForm((f) => ({ ...f, udp_ports: e.target.value }))}
                placeholder="es. 53,123,161,500 oppure lascia vuoto per non fare scan UDP"
                className="font-mono text-sm min-h-[88px]"
              />
              <p className="text-xs text-muted-foreground">
                Se lasci vuoto, <strong>non</strong> viene eseguita la fase UDP (solo TCP). La scansione UDP richiede spesso privilegi root sul server.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Community SNMP (opzionale)</Label>
              <Input
                value={profileForm.snmp_community}
                onChange={(e) => setProfileForm((f) => ({ ...f, snmp_community: e.target.value }))}
                placeholder="es. public"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Usata in sessione con Nmap per walk SNMP e rilevamento dispositivi (oltre alle community configurate per rete/credenziali).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Anteprima (comandi effettivi)</Label>
              <code className="block text-xs font-mono break-all bg-muted/50 px-2 py-1.5 rounded overflow-x-auto whitespace-pre-wrap">
                {getNmapCommandForForm(profileForm)}
              </code>
            </div>
            <Button type="submit" disabled={savingProfile}>
              <Save className="h-4 w-4 mr-2" />
              {savingProfile ? "Salvataggio..." : "Salva Profilo"}
            </Button>
          </form>
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

      {/* === Tab: Firme dispositivi === */}
      {activeTab === "firme" && (<>

      {/* Link ai profili SNMP vendor */}
      <Card className="bg-muted/30">
        <CardContent className="py-4 flex items-center justify-between">
          <div>
            <p className="font-medium">Profili SNMP Vendor</p>
            <p className="text-sm text-muted-foreground">
              Gestisci i profili OID per la classificazione automatica dei dispositivi via SNMP (Synology, QNAP, MikroTik, etc.)
            </p>
          </div>
          <Link href="/settings/snmp-profiles">
            <Button variant="outline" size="sm">
              <Radar className="h-4 w-4 mr-2" />
              Gestisci profili SNMP
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Monitor className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Firme riconoscimento dispositivi</CardTitle>
            </div>
            <CardDescription className="mt-1 max-w-3xl">
              Tabella unificata con tutte le firme di riconoscimento: porte TCP, OID SNMP, sysDescr, hostname, MAC vendor, banner HTTP/SSH e TTL.
              Le regole sono valutate in ordine di priorità (numeri più bassi prima). Ogni criterio specificato deve essere soddisfatto per il match.
              Le regole <code className="text-xs bg-muted px-1 rounded">built-in</code> possono essere modificate ma non eliminate.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={resetBuiltinRules}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset built-in
            </Button>
            <Button type="button" size="sm" onClick={() => openFpRuleDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Nuova firma
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[56px]">On</TableHead>
                <TableHead className="w-[60px]">Pri.</TableHead>
                <TableHead className="min-w-[140px]">Nome</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Classificazione</TableHead>
                <TableHead>Criteri</TableHead>
                <TableHead className="w-[88px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fpRules.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nessuna regola. Verranno create automaticamente al riavvio.
                  </TableCell>
                </TableRow>
              ) : (
                fpRules.map((rule) => {
                  const criteria: string[] = [];
                  if (rule.tcp_ports_key) {
                    try { const p = JSON.parse(rule.tcp_ports_key); criteria.push(`TCP: ${p.join(",")}`); } catch { criteria.push("TCP: ?"); }
                  }
                  if (rule.oid_prefix) criteria.push(`OID: ${rule.oid_prefix}`);
                  if (rule.sysdescr_pattern) criteria.push(`sysDescr: /${rule.sysdescr_pattern}/`);
                  if (rule.hostname_pattern) criteria.push(`Host: /${rule.hostname_pattern}/`);
                  if (rule.mac_vendor_pattern) criteria.push(`MAC: /${rule.mac_vendor_pattern}/`);
                  if (rule.banner_pattern) criteria.push(`Banner: /${rule.banner_pattern}/`);
                  if (rule.ttl_min != null || rule.ttl_max != null) criteria.push(`TTL: ${rule.ttl_min ?? "?"}–${rule.ttl_max ?? "?"}`);
                  return (
                    <TableRow key={rule.id} className={rule.enabled !== 1 ? "opacity-40" : undefined}>
                      <TableCell>
                        <Switch checked={rule.enabled === 1} onCheckedChange={(c) => toggleFpRuleEnabled(rule, c)} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{rule.priority}</TableCell>
                      <TableCell className="font-medium text-sm">
                        {rule.name}
                        {rule.builtin === 1 && <Badge variant="outline" className="ml-1 text-[10px] py-0">built-in</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">{rule.device_label}</TableCell>
                      <TableCell>
                        <span className="font-medium">{getClassificationLabel(rule.classification)}</span>
                        <span className="text-xs text-muted-foreground ml-1">({rule.classification})</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px]">
                        <div className="flex flex-wrap gap-1">
                          {criteria.map((c, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px] font-mono py-0">{c}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openFpRuleDialog(rule)} title="Modifica">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {rule.builtin !== 1 && (
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => deleteFpRule(rule.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={fpRuleDialogOpen} onOpenChange={setFpRuleDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-none">
          <DialogHeader>
            <DialogTitle>{editingFpRule ? "Modifica firma" : "Nuova firma dispositivo"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveFpRule} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Nome (univoco)</Label>
                <Input value={fpRuleForm.name} onChange={(e) => setFpRuleForm((f) => ({ ...f, name: e.target.value }))} required placeholder="es. Proxmox VE (porte)" />
              </div>
              <div className="space-y-2">
                <Label>Label dispositivo</Label>
                <Input value={fpRuleForm.device_label} onChange={(e) => setFpRuleForm((f) => ({ ...f, device_label: e.target.value }))} required placeholder="es. Proxmox VE" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Classificazione</Label>
                <Select value={fpRuleForm.classification} onValueChange={(v) => setFpRuleForm((f) => ({ ...f, classification: v ?? f.classification }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED).map((c) => (
                      <SelectItem key={c} value={c}>{getClassificationLabel(c)} ({c})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Priorità</Label>
                <Input type="number" min={0} max={99999} value={fpRuleForm.priority} onChange={(e) => setFpRuleForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 0 }))} />
              </div>
              <div className="space-y-2 flex flex-col justify-end">
                <div className="flex items-center gap-2">
                  <Switch checked={fpRuleForm.enabled as boolean} onCheckedChange={(c) => setFpRuleForm((f) => ({ ...f, enabled: c }))} />
                  <Label className="cursor-pointer">Abilitata</Label>
                </div>
              </div>
            </div>

            <div className="border-t pt-4 space-y-1">
              <p className="text-sm font-medium text-muted-foreground">Criteri di riconoscimento (tutti opzionali — solo quelli compilati vengono verificati)</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Porte TCP chiave (JSON array)</Label>
                <Input value={fpRuleForm.tcp_ports_key} onChange={(e) => setFpRuleForm((f) => ({ ...f, tcp_ports_key: e.target.value }))} placeholder='[8006, 22]' />
              </div>
              <div className="space-y-2">
                <Label>Porte TCP opzionali (JSON array)</Label>
                <Input value={fpRuleForm.tcp_ports_optional} onChange={(e) => setFpRuleForm((f) => ({ ...f, tcp_ports_optional: e.target.value }))} placeholder='[3128, 8007]' />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Min porte chiave</Label>
                <Input type="number" min={0} value={fpRuleForm.min_key_ports} onChange={(e) => setFpRuleForm((f) => ({ ...f, min_key_ports: e.target.value }))} placeholder="Tutte" />
              </div>
              <div className="space-y-2 col-span-2">
                <Label>OID prefix (sysObjectID)</Label>
                <Input value={fpRuleForm.oid_prefix} onChange={(e) => setFpRuleForm((f) => ({ ...f, oid_prefix: e.target.value }))} placeholder="1.3.6.1.4.1.6574" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>sysDescr pattern (regex)</Label>
                <Input value={fpRuleForm.sysdescr_pattern} onChange={(e) => setFpRuleForm((f) => ({ ...f, sysdescr_pattern: e.target.value }))} placeholder="synology|diskstation" />
              </div>
              <div className="space-y-2">
                <Label>Hostname pattern (regex)</Label>
                <Input value={fpRuleForm.hostname_pattern} onChange={(e) => setFpRuleForm((f) => ({ ...f, hostname_pattern: e.target.value }))} placeholder="^nas[-_]|^synology[-_]" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>MAC vendor pattern (regex)</Label>
                <Input value={fpRuleForm.mac_vendor_pattern} onChange={(e) => setFpRuleForm((f) => ({ ...f, mac_vendor_pattern: e.target.value }))} placeholder="hikvision|hangzhou" />
              </div>
              <div className="space-y-2">
                <Label>Banner HTTP/SSH pattern (regex)</Label>
                <Input value={fpRuleForm.banner_pattern} onChange={(e) => setFpRuleForm((f) => ({ ...f, banner_pattern: e.target.value }))} placeholder="proxmox|pve-manager" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>TTL minimo</Label>
                <Input type="number" min={0} max={255} value={fpRuleForm.ttl_min} onChange={(e) => setFpRuleForm((f) => ({ ...f, ttl_min: e.target.value }))} placeholder="es. 65" />
              </div>
              <div className="space-y-2">
                <Label>TTL massimo</Label>
                <Input type="number" min={0} max={255} value={fpRuleForm.ttl_max} onChange={(e) => setFpRuleForm((f) => ({ ...f, ttl_max: e.target.value }))} placeholder="es. 128" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Note (opzionale)</Label>
              <Input value={fpRuleForm.note} onChange={(e) => setFpRuleForm((f) => ({ ...f, note: e.target.value }))} placeholder="Perché esiste questa firma" />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setFpRuleDialogOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={savingFpRule}>{savingFpRule ? "Salvataggio…" : "Salva"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      </>)}

      {/* === Tab: Classificazione fingerprint === */}
      {activeTab === "classificazione" && (<>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Tags className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Regole fingerprint → classificazione</CardTitle>
            </div>
            <CardDescription className="mt-1 max-w-3xl">
              Mappa manualmente il valore <code className="text-xs bg-muted px-1 rounded">final_device</code> del fingerprint
              (match esatto o contiene) sulla classificazione host. Le regole si applicano in ordine di priorità (numeri più bassi prima)
              e hanno priorità sulla mappa integrata. Dopo le modifiche, usa &quot;Ricalcola rete&quot; sulla rete o un nuovo scan per aggiornare gli host.
              Solo gli amministratori possono creare o modificare le regole.
            </CardDescription>
          </div>
          <Dialog open={fpDialogOpen} onOpenChange={setFpDialogOpen}>
            <Button type="button" size="sm" onClick={() => openFpDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Nuova regola
            </Button>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingFp ? "Modifica regola" : "Nuova regola"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSaveFpMap} className="space-y-4">
                <div className="space-y-2">
                  <Label>Tipo match</Label>
                  <Select
                    value={fpForm.match_kind}
                    onValueChange={(v) => setFpForm((f) => ({ ...f, match_kind: v as "exact" | "contains" }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exact">Uguale a (ignora maiuscole)</SelectItem>
                      <SelectItem value="contains">Contiene (ignora maiuscole)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Pattern</Label>
                  <Input
                    value={fpForm.pattern}
                    onChange={(e) => setFpForm((f) => ({ ...f, pattern: e.target.value }))}
                    placeholder='es. "QNAP" o "Ubuntu Server"'
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Classificazione</Label>
                  <Select
                    value={fpForm.classification}
                    onValueChange={(v) =>
                      setFpForm((f) => ({ ...f, classification: v ?? f.classification }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-[280px]">
                      {sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED).map((c) => (
                        <SelectItem key={c} value={c}>
                          {getClassificationLabel(c)} ({c})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Priorità</Label>
                    <Input
                      type="number"
                      min={0}
                      max={99999}
                      value={fpForm.priority}
                      onChange={(e) => setFpForm((f) => ({ ...f, priority: parseInt(e.target.value, 10) || 0 }))}
                    />
                  </div>
                  <div className="space-y-2 flex flex-col justify-end">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={fpForm.enabled}
                        onCheckedChange={(c) => setFpForm((f) => ({ ...f, enabled: c }))}
                      />
                      <Label className="cursor-pointer">Abilitata</Label>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Note (opzionale)</Label>
                  <Input
                    value={fpForm.note}
                    onChange={(e) => setFpForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder="Perché esiste questa regola"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setFpDialogOpen(false)}>
                    Annulla
                  </Button>
                  <Button type="submit" disabled={savingFp}>
                    {savingFp ? "Salvataggio…" : "Salva"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[72px]">Attiva</TableHead>
                <TableHead className="w-[90px]">Priorità</TableHead>
                <TableHead>Match</TableHead>
                <TableHead>Pattern</TableHead>
                <TableHead>Classificazione</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-[88px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {fpMapRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nessuna regola personalizzata. Aggiungine una per correggere errori di assegnazione automatica.
                  </TableCell>
                </TableRow>
              ) : (
                fpMapRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Switch
                        checked={row.enabled === 1}
                        onCheckedChange={(c) => toggleFpEnabled(row, c)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{row.priority}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{row.match_kind === "exact" ? "Uguale" : "Contiene"}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm max-w-[200px] truncate" title={row.pattern}>
                      {row.pattern}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{getClassificationLabel(row.classification)}</span>
                      <span className="text-xs text-muted-foreground ml-1">({row.classification})</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate" title={row.note ?? ""}>
                      {row.note || "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openFpDialog(row)} title="Modifica">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => deleteFpMap(row.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
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
          <CardDescription>Esporta dati o resetta la configurazione per un nuovo cliente. Il reset cancella tutto tranne il profilo Nmap e le regole fingerprint.</CardDescription>
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

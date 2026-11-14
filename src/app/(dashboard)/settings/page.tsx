"use client";

import { parseDbDate } from "@/lib/db-date";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";

import { Fragment, useEffect, useState, useMemo, useCallback, Suspense } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Trash2,
  Download,
  Database,
  Pencil,
  RotateCcw,
  Users,
  Shield,
  ArrowUpCircle,
  Sparkles,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";
import { ScanConfigTab } from "@/components/settings/scan-config-tab";
import { DeviceIdentificationTab } from "@/components/settings/device-identification-tab";
import { ModulesTab } from "@/components/settings/modules-tab";
import { AzzeraAppliance } from "@/components/settings/azzera-appliance";
import { UpdatesTab } from "@/components/settings/updates-tab";
import { PuliziaHostCard } from "@/components/settings/pulizia-host-card";
import { InterruttoreAcquisizioneModulare } from "@/components/settings/interruttore-acquisizione-modulare";
import { NotificationsTab } from "@/components/settings/notifications-tab";
import { SecurityAlertsTab } from "@/components/settings/security-alerts-tab";
import { HubUrlCard } from "@/components/settings/hub-url-card";
import { SceltaIstanza } from "@/components/shared/tenant-switcher";

type TabKey =
  | "istanza"
  | "utenti"
  | "scansione"
  | "identificazione"
  | "https"
  | "moduli"
  | "alert-sicurezza"
  | "notifiche"
  | "aggiornamenti"
  | "sistema";

const TAB_ALIASES: Record<string, TabKey> = {
  istanza: "istanza",
  tenant: "istanza",
  cliente: "istanza",
  utenti: "utenti",
  users: "utenti",
  scansione: "scansione",
  scan: "scansione",
  identificazione: "identificazione",
  fingerprint: "identificazione",
  // ex-tab "integrazioni" consolidata in "moduli" (config unica dei moduli)
  integrazioni: "moduli",
  integrations: "moduli",
  https: "https",
  tls: "https",
  moduli: "moduli",
  modules: "moduli",
  features: "moduli",
  notifiche: "notifiche",
  notifications: "notifiche",
  "alert-sicurezza": "alert-sicurezza",
  alert: "alert-sicurezza",
  alerts: "alert-sicurezza",
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
  /** 1 = utente Cliente. In modifica il menu si apre su «Cliente (vista semplice)». */
  vista_cliente?: number;
  created_at: string;
  last_login: string | null;
  /** Verifica in due passaggi (ADR 0023): 1 = richiesta dall'admin; totp_attiva 1 = QR confermato. */
  totp_richiesta?: number;
  totp_attiva?: number;
  tenant_access?: { tenant_id: number; codice_cliente: string; ragione_sociale: string; role: string }[];
}

/** Voce del menu ruolo. «cliente» non è un ruolo del database: al salvataggio diventa viewer + vista_cliente. */
type VoceRuolo = "superadmin" | "admin" | "viewer" | "cliente";

function payloadRuolo(voce: VoceRuolo): { role: "superadmin" | "admin" | "viewer"; vista_cliente: boolean } {
  if (voce === "cliente") return { role: "viewer", vista_cliente: true };
  return { role: voce, vista_cliente: false };
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

/**
 * Clienti di un utente nei dialoghi Nuovo/Modifica. Per l'admin di un cliente
 * solo il cliente è fisso (UI-18): si mostra, non si sceglie.
 */
function TenantPicker({
  fixedName,
  tenants,
  selected,
  onChange,
}: {
  fixedName: string | null;
  tenants: TenantEntry[];
  selected: number[];
  onChange: (update: (prev: number[]) => number[]) => void;
}) {
  if (fixedName) {
    return (
      <div className="space-y-2">
        <Label>Cliente</Label>
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{fixedName}</p>
      </div>
    );
  }
  if (tenants.length === 0) return null;
  return (
    <div className="space-y-2">
      <Label>Clienti assegnati</Label>
      <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1">
        {tenants.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-1 py-0.5">
            <input
              type="checkbox"
              checked={selected.includes(t.id)}
              onChange={(e) => {
                if (e.target.checked) onChange((prev) => [...prev, t.id]);
                else onChange((prev) => prev.filter((id) => id !== t.id));
              }}
              className="rounded"
            />
            <span>{t.ragione_sociale || t.codice_cliente}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Le modifiche avranno effetto al prossimo accesso dell&apos;utente</p>
    </div>
  );
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
  const { data: session, status: sessionStatus } = useSession();
  const isAdmin = (session?.user as { role?: string } | undefined)?.role === "admin"
    || (session?.user as { role?: string } | undefined)?.role === "superadmin";
  const isSuperAdmin = (session?.user as { role?: string } | undefined)?.role === "superadmin";
  const sessionUsername = session?.user?.name ?? "";
  // Sessione caricata e ruolo di sola lettura: la gestione utenti non lo riguarda
  // (/api/users gli risponde 403 per scelta). Finché la sessione carica non si decide.
  const isViewer = sessionStatus === "authenticated" && !isAdmin;
  const istanzeUtente = ((session?.user as { tenants?: unknown[] } | undefined)?.tenants ?? []).length;

  // I job si gestiscono in Schedulazioni (11/11/2026): il vecchio indirizzo `?tab=jobs#job-<id>` porta là, sulla riga.
  useEffect(() => {
    const raw = (searchParams?.get("tab") ?? "").toLowerCase();
    if (raw !== "jobs" && raw !== "job") return;
    const m = /^#job-(\d+)$/.exec(window.location.hash);
    router.replace(`/settings/schedulazioni${m ? `#job.${m[1]}` : ""}`);
  }, [searchParams, router]);

  const initialTab: TabKey = useMemo(() => {
    const raw = (searchParams?.get("tab") ?? "").toLowerCase();
    return TAB_ALIASES[raw] ?? (isViewer ? "aggiornamenti" : "utenti");
  }, [searchParams, isViewer]);
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Un nome vecchio o inglese (`?tab=users`, `?tab=integrazioni`) diventa quello vero nell'indirizzo, àncora compresa:
  // la fila delle schede in cima accende la scheda leggendo `?tab=`.
  useEffect(() => {
    const raw = (searchParams?.get("tab") ?? "").toLowerCase();
    const vero = TAB_ALIASES[raw];
    if (vero && vero !== searchParams?.get("tab")) router.replace(`/settings?tab=${vero}${window.location.hash}`, { scroll: false });
  }, [searchParams, router]);

  function selectTab(key: TabKey) {
    setActiveTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    router.replace(url.pathname + "?" + url.searchParams.toString(), { scroll: false });
  }

  // === Version badge (lightweight, full mgmt is in Aggiornamenti tab) ===
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<{ version: string } | null>(null);

  // === Reset state (full reconfig) ===
  const [resetting, setResetting] = useState(false);
  const [openingWizard, setOpeningWizard] = useState(false);

  // === Users ===
  const [users, setUsers] = useState<UserWithAccess[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [tenantsList, setTenantsList] = useState<TenantEntry[]>([]);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<VoceRuolo>("viewer");
  const [newUserTenantIds, setNewUserTenantIds] = useState<number[]>([]);
  const [savingUser, setSavingUser] = useState(false);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editUserRole, setEditUserRole] = useState<VoceRuolo>("admin");
  const [editUserTenantIds, setEditUserTenantIds] = useState<number[]>([]);
  const [savingEditUser, setSavingEditUser] = useState(false);

  // UI-18: un errore dell'API (403, 500, server giù) si mostra come errore,
  // non come «Nessun utente trovato».
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const r = await fetchJson<UserWithAccess[]>("/api/users");
      if (r.ok && Array.isArray(r.data)) {
        setUsers(r.data);
        setUsersError(null);
      } else {
        setUsersError(r.ok ? "Risposta non valida dal server" : r.message);
      }
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // Solo per chi gestisce utenti: al viewer il 403 è voluto, non un guasto da mostrare.
  useEffect(() => {
    if (isAdmin) void loadUsers();
  }, [isAdmin, loadUsers]);

  // L'admin assegna solo i clienti che amministra (il server lo impone comunque).
  // Con un cliente solo — l'appliance di un cliente — il cliente è fisso: non si
  // manda tenant_ids e il server mette l'utente nel suo cliente.
  const sessionTenants =
    (session?.user as { tenants?: Array<{ code: string; name: string; role: string }> } | undefined)?.tenants ?? [];
  const adminTenants = sessionTenants.filter((t) => t.role === "admin");
  const fixedTenantName =
    !isSuperAdmin && adminTenants.length === 1 ? adminTenants[0].name || adminTenants[0].code : null;
  const assignableTenants = isSuperAdmin
    ? tenantsList
    : tenantsList.filter((t) => adminTenants.some((a) => a.code === t.codice_cliente));

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

  useEffect(() => {
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
    // /api/users si carica con loadUsers (sopra), che distingue errore e lista vuota.
    fetch("/api/tenants").then((r) => r.json()).then((data: TenantEntry[]) => {
      if (Array.isArray(data)) setTenantsList(data);
    }).catch(() => {});
    fetch("/api/tls").then((r) => r.json()).then(setTlsStatus).catch(() => {});
  }, []);

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

  async function handleResetConfiguration() {
    if (!confirm("Resettare la configurazione per un nuovo cliente? Verranno eliminati reti, host, apparati, credenziali, controller, Active Directory, telefoni, Wazuh, vulnerabilità, topologia, inventario e job. Restano le impostazioni, la configurazione dei moduli dell'appliance e gli utenti. Ripartirai dal wizard di configurazione. Procedere?")) return;
    setResetting(true);
    try {
      const res = await fetch("/api/reset", { method: "POST" });
      if (res.ok) {
        toast.success("Configurazione resettata. Reindirizzamento al wizard di configurazione...");
        router.push("/onboarding");
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
      const scelto = payloadRuolo(newUserRole);
      const payload: Record<string, unknown> = {
        username: newUsername,
        password: newUserPassword,
        role: scelto.role,
        vista_cliente: scelto.vista_cliente,
        email: newUserEmail || null,
      };
      // Cliente fisso (admin di un cliente solo): lo decide il server.
      if (isSuperAdmin) payload.tenant_ids = scelto.role !== "superadmin" ? newUserTenantIds : [];
      else if (!fixedTenantName) payload.tenant_ids = newUserTenantIds;
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Utente creato");
        setNewUserOpen(false);
        setNewUsername(""); setNewUserEmail(""); setNewUserPassword(""); setNewUserRole("viewer"); setNewUserTenantIds([]);
        await loadUsers();
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore nella creazione utente");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSavingUser(false); }
  }

  function openEditUser(user: UserWithAccess) {
    setEditUserId(user.id);
    setEditUserRole(user.vista_cliente === 1 ? "cliente" : (user.role as VoceRuolo));
    setEditUserTenantIds(user.tenant_access?.map((a) => a.tenant_id) ?? []);
    setEditUserOpen(true);
  }

  async function handleSaveEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (editUserId == null) return;
    setSavingEditUser(true);
    try {
      const scelto = payloadRuolo(editUserRole);
      const payload: Record<string, unknown> = { role: scelto.role, vista_cliente: scelto.vista_cliente };
      // Cliente fisso: senza tenant_ids il server lascia i clienti che l'utente ha già.
      if (isSuperAdmin) payload.tenant_ids = scelto.role !== "superadmin" ? editUserTenantIds : [];
      else if (!fixedTenantName) payload.tenant_ids = editUserTenantIds;
      const res = await fetch(`/api/users/${editUserId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast.success("Utente aggiornato");
        setEditUserOpen(false);
        await loadUsers();
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSavingEditUser(false); }
  }

  async function handleDeleteUser(userId: number, username: string) {
    if (!confirm(`Eliminare l'utente "${username}"? L'azione è irreversibile.`)) return;
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Utente eliminato");
        setUsers((prev) => prev.filter((u) => u.id !== userId));
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Errore nell'eliminazione");
      }
    } catch { toast.error("Errore di rete"); }
  }

  /** Verifica in due passaggi: richiedi, azzera, togli (Riccardo, 20/10; ADR 0023). */
  async function handleSecondaVerifica(user: UserWithAccess, azione: "richiedi" | "azzera" | "togli") {
    const sestesso = user.username === sessionUsername;
    const domanda =
      azione === "azzera"
        ? `Azzerare la verifica in due passaggi di "${user.username}"? Al prossimo accesso dovrà inquadrare un QR nuovo (telefono perso o cambiato).${sestesso ? " È il tuo utente: ti servirà il telefono nuovo al prossimo accesso." : ""}`
        : azione === "togli"
          ? `Togliere la verifica in due passaggi a "${user.username}"? Entrerà con la sola password.`
          : null;
    if (domanda && !confirm(domanda)) return;
    try {
      const res = await fetch(`/api/users/${user.id}/seconda-verifica`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ azione }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Errore nella verifica in due passaggi");
        return;
      }
      toast.success(data.message || "Fatto");
      setUsers((prev) =>
        prev.map((u) =>
          u.id !== user.id ? u
            : { ...u, totp_richiesta: azione === "togli" ? 0 : 1, totp_attiva: 0 },
        ),
      );
    } catch {
      toast.error("Errore di rete");
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

  // ============ RENDER ============

  return (
    <div className="space-y-6">
      {/* Niente riga del titolo (Riccardo, 14/11): il nome lo dice la scheda accesa, la versione sta in Aggiornamenti.
          Resta, solo quando c'è, l'avviso della versione nuova. */}
      <h1 className="sr-only">Impostazioni</h1>
      {appVersion && updateAvailable && activeTab !== "aggiornamenti" && (
        <button type="button" onClick={() => selectTab("aggiornamenti")} className="inline-flex items-center" title="Vai alla scheda Aggiornamenti">
          <Badge variant="default" className="gap-1 text-[13px] cursor-pointer">
            <ArrowUpCircle className="h-3.5 w-3.5" />
            v{updateAvailable.version} disponibile (installata v{appVersion})
          </Badge>
        </button>
      )}

      {/* === Tab: Istanza === */}
      {activeTab === "istanza" && istanzeUtente > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Istanza su cui lavori</CardTitle>
            <CardDescription>
              Le pagine con i dati (reti, inventario, anomalie…) mostrano l&apos;istanza scelta qui.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SceltaIstanza />
          </CardContent>
        </Card>
      )}

      {/* === Tab: Utenti === */}
      {activeTab === "utenti" && isViewer && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            La gestione degli utenti è riservata agli amministratori.
          </CardContent>
        </Card>
      )}
      {activeTab === "utenti" && !isViewer && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Gestione utenti</CardTitle>
              </div>
              <CardDescription className="mt-1">
                {isSuperAdmin
                  ? "Gestisci gli account di accesso al sistema."
                  : "Gestisci gli account di accesso del tuo cliente."}{" "}
                Per cambiare la tua password usa il menu utente in alto a destra.
              </CardDescription>
            </div>
            <Dialog open={newUserOpen} onOpenChange={setNewUserOpen}>
              {!usersError && (
                <DialogTrigger render={<Button size="sm" />}>
                  <Plus className="h-4 w-4 mr-2" />Nuovo utente
                </DialogTrigger>
              )}
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
                    <Select value={newUserRole} onValueChange={(v) => { const voce = (v ?? newUserRole) as VoceRuolo; setNewUserRole(voce); if (voce === "superadmin") setNewUserTenantIds([]); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isSuperAdmin && <SelectItem value="superadmin">Super amministratore</SelectItem>}
                        <SelectItem value="admin">Amministratore</SelectItem>
                        <SelectItem value="viewer">Solo lettura</SelectItem>
                        <SelectItem value="cliente">Cliente (vista semplice)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {newUserRole !== "superadmin" && (
                    <TenantPicker
                      fixedName={fixedTenantName}
                      tenants={assignableTenants}
                      selected={newUserTenantIds}
                      onChange={setNewUserTenantIds}
                    />
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
                    <Select value={editUserRole} onValueChange={(v) => { const voce = (v ?? editUserRole) as VoceRuolo; setEditUserRole(voce); if (voce === "superadmin") setEditUserTenantIds([]); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isSuperAdmin && <SelectItem value="superadmin">Super amministratore</SelectItem>}
                        <SelectItem value="admin">Amministratore</SelectItem>
                        <SelectItem value="viewer">Solo lettura</SelectItem>
                        <SelectItem value="cliente">Cliente (vista semplice)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {editUserRole !== "superadmin" && (
                    <TenantPicker
                      fixedName={fixedTenantName}
                      tenants={assignableTenants}
                      selected={editUserTenantIds}
                      onChange={setEditUserTenantIds}
                    />
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
            {usersError ? (
              <LoadError what="gli utenti" message={usersError} onRetry={() => void loadUsers()} />
            ) : usersLoading && users.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Caricamento…</p>
            ) : (
            <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Ruolo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Creato il</TableHead>
                  <TableHead>Ultimo accesso</TableHead>
                  <TableHead title="Verifica in due passaggi: codice dall'app di autenticazione oltre alla password. Chi entra con l'account Domarc non ne ha bisogno.">Due passaggi</TableHead>
                  <TableHead className="w-[140px]">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{user.email || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={user.vista_cliente === 1 ? "secondary" : user.role === "superadmin" ? "destructive" : user.role === "admin" ? "default" : "secondary"}>
                        {user.vista_cliente === 1 ? "Cliente" : user.role === "superadmin" ? "Super Admin" : user.role === "admin" ? "Amministratore" : "Solo lettura"}
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
                    <TableCell>{parseDbDate(user.created_at).toLocaleDateString("it-IT")}</TableCell>
                    <TableCell>{user.last_login ? parseDbDate(user.last_login).toLocaleString("it-IT") : "Mai"}</TableCell>
                    <TableCell>
                      <CellaDuePassaggi user={user} sestesso={user.username === sessionUsername} onAzione={(a) => void handleSecondaVerifica(user, a)} />
                    </TableCell>
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
                          disabled={!isSuperAdmin && user.username === sessionUsername}
                          title={!isSuperAdmin && user.username === sessionUsername
                            ? "Per la tua password usa «Cambia password» nel menu utente"
                            : "Reset password"}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          onClick={() => handleDeleteUser(user.id, user.username)}
                          className="text-destructive hover:text-destructive"
                          disabled={user.username === sessionUsername}
                          title={user.username === sessionUsername ? "Non puoi eliminare il tuo stesso account" : "Elimina utente"}
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
            </>
            )}
          </CardContent>
        </Card>
      )}

      {/* === Tab: Scansione === */}
      {activeTab === "scansione" && <ScanConfigTab />}

      {/* === Tab: Identificazione === */}
      {activeTab === "identificazione" && <DeviceIdentificationTab />}

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
      {/* L'MDM stava in una card di Sistema: nell'elenco dei moduli ha già la sua riga con «Apri» (14/11). */}
      {activeTab === "moduli" && <ModulesTab isAdmin={isAdmin} />}

      {/* === Tab: Aggiornamenti === */}
      {activeTab === "alert-sicurezza" && <SecurityAlertsTab />}

      {activeTab === "notifiche" && <NotificationsTab />}

      {activeTab === "aggiornamenti" && <UpdatesTab />}

      {/* === Tab: Sistema (wizard + manutenzione/dati) ===
          La scheda «Credenziali host di default» non c'è più (tappa 2d credenziali, D3 = (a)):
          le due chiavi dell'hub erano id del DB di un tenant, e la 2d le ha copiate nelle
          liste delle reti dove valevano. */}
      {activeTab === "sistema" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Dati e manutenzione</CardTitle>
              </div>
              <CardDescription>Esporta, copia e trasferisci i dati di questa istanza.</CardDescription>
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
              {isAdmin && (
                <Button variant="outline" onClick={() => router.push("/settings/transfer")}>
                  Trasferimento configurazione ›
                </Button>
              )}
              {isAdmin && (
                <Button variant="outline" onClick={() => router.push("/settings/vault")}>
                  Vault ›
                </Button>
              )}
            </CardContent>
          </Card>

          {isAdmin && (
            <Card id="configurazione-guidata" className="scroll-mt-4">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">Configurazione guidata</CardTitle>
                </div>
                <CardDescription>
                  Riapre i passaggi del primo avvio (credenziali, router, DNS, Active Directory, prima subnet) dal punto in cui li avevi lasciati. I dati già salvati non vengono cancellati.
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

          {/* URL pubblico dell'hub: tolto dal menu a sinistra il 23/10 (Riccardo), prima stava in /agents. */}
          {isSuperAdmin && <HubUrlCard />}

          {isAdmin && <InterruttoreAcquisizioneModulare />}

          {isAdmin && <PuliziaHostCard />}

          {/* Le azioni che cancellano stanno insieme, in fondo, dentro un bordo spesso (Riccardo, 14/11): prima il
              «Reset» era in fila con «Esporta» e «Backup», e «Azzera» sotto una tabella di 58 righe. */}
          <section aria-label="Azioni che cancellano" className="space-y-4 rounded-xl border-4 border-destructive/60 p-4">
            <h2 className="text-base font-semibold">⚠ Azioni che cancellano</h2>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground" title="Cancella reti, host, apparati, credenziali, AD, telefoni, Wazuh, vulnerabilità, topologia, inventario, job.">
                «Reset per nuovo cliente» cancella i dati del cliente; restano le impostazioni, la configurazione dei moduli e gli utenti.
              </p>
            <Button
              variant="destructive"
              onClick={handleResetConfiguration}
              disabled={resetting}
            >
              <RotateCcw className={`h-4 w-4 mr-2 ${resetting ? "animate-spin" : ""}`} />
              Reset per nuovo cliente
            </Button>
            </div>
            <AzzeraAppliance />
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * Stato della verifica in due passaggi di un utente con l'azione che serve (Riccardo, 20/10;
 * ADR 0023): «–» non richiesta → Richiedi; «▲ da attivare» (vedrà il QR) → Togli;
 * «✓ attiva» → Azzera (telefono perso) e Togli. Simbolo e parola, non solo colore.
 */
function CellaDuePassaggi({ user, sestesso, onAzione }: { user: UserWithAccess; sestesso: boolean; onAzione: (a: "richiedi" | "azzera" | "togli") => void }) {
  const azione = (a: "richiedi" | "azzera" | "togli", testo: string, titolo: string) => {
    // Togliersela da soli no (decideSecondaVerifica): spento, col perché.
    const spento = sestesso && a === "togli";
    return (
      <button
        type="button"
        disabled={spento}
        onClick={() => onAzione(a)}
        title={spento ? "Non puoi toglierti la verifica in due passaggi: chiedilo a un altro amministratore" : titolo}
        className="text-[13px] text-[#006C96] hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed dark:text-[#3FBBF0]"
      >
        {testo}
      </button>
    );
  };
  if (user.totp_richiesta !== 1) {
    return (
      <span className="flex items-center gap-2 text-[13px]">
        <span className="text-muted-foreground" title="Non richiesta: entra con la sola password">–</span>
        {azione("richiedi", "Richiedi", "Al prossimo accesso dovrà inquadrare un QR con l'app di autenticazione")}
      </span>
    );
  }
  if (user.totp_attiva !== 1) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="rounded border border-[#C9A800] bg-[#FFD400] px-1.5 text-[#0D2537]" title="Richiesta: al prossimo accesso vedrà il QR">▲ da attivare</span>
        {azione("togli", "Togli", "Torna alla sola password")}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="rounded border border-[#1F7A4D] bg-[#1F7A4D] px-1.5 text-white" title="Attiva: entra con password e codice">✓ attiva</span>
      {azione("azzera", "Azzera", "Telefono perso o cambiato: al prossimo accesso un QR nuovo")}
      {azione("togli", "Togli", "Torna alla sola password")}
    </span>
  );
}

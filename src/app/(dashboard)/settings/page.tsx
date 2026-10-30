"use client";

import Link from "next/link";
import { parseDbDate } from "@/lib/db-date";
import { ETICHETTE_JOB, scheduledJobLabel } from "@/lib/scheduled-job-types";
import { idOpzioneDelJob } from "@/lib/opzioni/ancore";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { LoadError } from "@/components/shared/load-error";

import { Fragment, useEffect, useRef, useState, useMemo, useCallback, Suspense } from "react";
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
import { ETICHETTA_OPZIONE } from "@/lib/modules/offerta";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Trash2,
  Clock,
  Download,
  Database,
  Radar,
  Pencil,
  RotateCcw,
  Users,
  Building2,
  Shield,
  ArrowUpCircle,
  Bell,
  Siren,
  Sparkles,
  Play,
  RefreshCw,
  Fingerprint,
  KeyRound,
  PackageOpen,
  Wrench,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import type { ScheduledJob, NetworkWithStats } from "@/types";
import { ScanConfigTab } from "@/components/settings/scan-config-tab";
import { DeviceIdentificationTab } from "@/components/settings/device-identification-tab";
import { ModulesTab } from "@/components/settings/modules-tab";
import { AzzeraAppliance } from "@/components/settings/azzera-appliance";
import { FinestraScansioneAutomatica } from "@/components/jobs/finestra-scansione-automatica";
import { EsitiApparatiScelti } from "@/components/jobs/esiti-apparati-scelti";
import { PastigliaStato } from "@/components/jobs/pastiglia-stato";
import { FUSO_UTENTI } from "@/lib/db-date";
import { UpdatesTab } from "@/components/settings/updates-tab";
import { PuliziaHostCard } from "@/components/settings/pulizia-host-card";
import { InterruttoreAcquisizioneModulare } from "@/components/settings/interruttore-acquisizione-modulare";
import { NotificationsTab } from "@/components/settings/notifications-tab";
import { SecurityAlertsTab } from "@/components/settings/security-alerts-tab";
import { HubUrlCard } from "@/components/settings/hub-url-card";
import { SceltaIstanza } from "@/components/shared/tenant-switcher";

const JOB_TYPE_LABELS: Record<string, string> = ETICHETTE_JOB;

/** Le righe `apparati_scelti` arrivano da GET /api/jobs con questi campi in più (J3); le altre no. */
interface DatiApparatiScelti {
  nome?: string | null;
  apparati?: number;
  frequenza?: string;
  prossima?: string | null;
  riassunto?: { letti: number; parziali: number; totale: number; esclusi: number; giro_il: string } | null;
}

type Riassunto = NonNullable<DatiApparatiScelti["riassunto"]>;

/** La pastiglia del riassunto (J3): «✓ 3/3», «✓ 2/3 · ▲ 1 parziale», «✕ 0/3 · 2 esclusi»; il tono dal caso peggiore. */
function pastigliaRiassunto(r: Riassunto): { tono: "ok" | "attenzione" | "guasto"; testo: string } {
  const tono = r.letti === r.totale ? "ok" : r.letti + r.parziali === 0 ? "guasto" : "attenzione";
  const parti = [`${tono === "guasto" ? "✕" : "✓"} ${r.letti}/${r.totale}`];
  if (r.parziali > 0) parti.push(`▲ ${r.parziali} parzial${r.parziali === 1 ? "e" : "i"}`);
  if (r.esclusi > 0) parti.push(`${r.esclusi} esclus${r.esclusi === 1 ? "o" : "i"}`);
  return { tono, testo: parti.join(" · ") };
}

/** Ogni quanto si guarda se il giro lanciato da «Esegui ora» è finito, e fin quando (il giro sta sotto 5 minuti per apparato). */
const ATTESA_GIRO_MS = 5_000;
const ATTESA_GIRO_MAX_MS = 30 * 60_000;

const dataItaliana = (d: Date): string => d.toLocaleString("it-IT", { timeZone: FUSO_UTENTI });

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
  | "istanza"
  | "utenti"
  | "scansione"
  | "identificazione"
  | "jobs"
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
  created_at: string;
  last_login: string | null;
  /** Verifica in due passaggi (ADR 0023): 1 = richiesta dall'admin; totp_attiva 1 = QR confermato. */
  totp_richiesta?: number;
  totp_attiva?: number;
  tenant_access?: { tenant_id: number; codice_cliente: string; ragione_sociale: string; role: string }[];
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

  const initialTab: TabKey = useMemo(() => {
    const raw = (searchParams?.get("tab") ?? "").toLowerCase();
    return TAB_ALIASES[raw] ?? (isViewer ? "scansione" : "utenti");
  }, [searchParams, isViewer]);
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
  const [newUserRole, setNewUserRole] = useState<"superadmin" | "admin" | "viewer">("viewer");
  const [newUserTenantIds, setNewUserTenantIds] = useState<number[]>([]);
  const [savingUser, setSavingUser] = useState(false);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editUserRole, setEditUserRole] = useState<"superadmin" | "admin" | "viewer">("admin");
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

  // === Scheduled jobs ===
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [networks, setNetworks] = useState<NetworkWithStats[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newJobType, setNewJobType] = useState<string>("known_host_check");
  const [runningJobId, setRunningJobId] = useState<number | null>(null);
  // Scansione automatica (J3): job in modifica e righe con il dettaglio per apparato aperto.
  const [jobInModifica, setJobInModifica] = useState<number | null>(null);
  const [dettagliAperti, setDettagliAperti] = useState<Set<number>>(new Set());
  // «Esegui ora» di un apparati_scelti risponde 202: si guarda il giro_il degli esiti finché cambia, poi si ricarica.
  const [giriInCorso, setGiriInCorso] = useState<Set<number>>(new Set());
  const [versioneEsiti, setVersioneEsiti] = useState<Record<number, number>>({});
  const attesaGiri = useRef(new Map<number, ReturnType<typeof setInterval>>());
  useEffect(() => {
    const timer = attesaGiri.current;
    return () => { for (const t of timer.values()) clearInterval(t); timer.clear(); };
  }, []);

  useEffect(() => {
    fetch("/api/jobs").then((r) => r.json()).then(setJobs).catch(() => {});
    fetch("/api/networks").then((r) => r.json()).then(setNetworks).catch(() => {});
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
      const payload: Record<string, unknown> = {
        username: newUsername,
        password: newUserPassword,
        role: newUserRole,
        email: newUserEmail || null,
      };
      // Cliente fisso (admin di un cliente solo): lo decide il server.
      if (isSuperAdmin) payload.tenant_ids = newUserRole !== "superadmin" ? newUserTenantIds : [];
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
    setEditUserRole(user.role as "superadmin" | "admin" | "viewer");
    setEditUserTenantIds(user.tenant_access?.map((a) => a.tenant_id) ?? []);
    setEditUserOpen(true);
  }

  async function handleSaveEditUser(e: React.FormEvent) {
    e.preventDefault();
    if (editUserId == null) return;
    setSavingEditUser(true);
    try {
      const payload: Record<string, unknown> = { role: editUserRole };
      // Cliente fisso: senza tenant_ids il server lascia i clienti che l'utente ha già.
      if (isSuperAdmin) payload.tenant_ids = editUserRole !== "superadmin" ? editUserTenantIds : [];
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

  /** Il giro di un apparati_scelti lanciato a mano: si guarda `giro_il` finché cambia, poi elenco e dettaglio si ricaricano. */
  function seguiGiro(id: number, giroPrima: string | null) {
    const timer = attesaGiri.current;
    if (timer.has(id)) clearInterval(timer.get(id));
    setGiriInCorso((p) => new Set(p).add(id));
    const fine = (finito: boolean) => {
      clearInterval(timer.get(id));
      timer.delete(id);
      setGiriInCorso((p) => { const n = new Set(p); n.delete(id); return n; });
      if (!finito) return;
      setVersioneEsiti((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }));
      void ricaricaJobs();
      toast.success("Giro finito: esiti aggiornati");
    };
    const scadenza = Date.now() + ATTESA_GIRO_MAX_MS;
    timer.set(id, setInterval(() => {
      if (Date.now() > scadenza) { fine(false); return; }
      void fetchJson<{ giro_il: string | null }>(`/api/jobs/apparati-scelti/${id}/esiti`).then((r) => {
        if (!timer.has(id)) return;
        if (r.ok && r.data.giro_il && r.data.giro_il !== giroPrima) fine(true);
      });
    }, ATTESA_GIRO_MS));
  }

  async function runJobNow(id: number) {
    setRunningJobId(id);
    try {
      const res = await fetch(`/api/jobs/${id}/run`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 202 && data.job_type === "apparati_scelti") {
        // Lettura apparati: il giro continua in sottofondo; a giro finito il dettaglio aperto si ricarica da solo.
        toast.success("Giro avviato: il dettaglio si aggiorna a fine giro");
        const prima = (jobs.find((j) => j.id === id) as (ScheduledJob & DatiApparatiScelti) | undefined)?.riassunto?.giro_il ?? null;
        seguiGiro(id, prima);
      } else if (res.status === 202) {
        // Job di scansione: il giro continua in background, «Ultima esecuzione» si aggiorna a fine giro.
        toast.success("Scansione avviata: l'ultima esecuzione si aggiorna a fine giro");
        const updated = await fetch("/api/jobs").then((r) => r.json());
        setJobs(updated);
      } else if (res.ok) {
        const ms = typeof data.duration_ms === "number" ? `${data.duration_ms} ms` : "ok";
        if (typeof data.note === "string") toast.warning(data.note);
        else toast.success(`Job eseguito (${ms})`);
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

  async function deleteJob(id: number, nome?: string | null) {
    if (!confirm(nome ? `Eliminare il job «${nome}»?` : "Eliminare questo job?")) return;
    await fetch(`/api/jobs?id=${id}`, { method: "DELETE" });
    setJobs((prev) => prev.filter((j) => j.id !== id));
    toast.success("Job eliminato");
  }

  // Il link della testata della scheda (J4) arriva a /settings?tab=jobs#job-<id>: porta la riga in vista.
  useEffect(() => {
    if (activeTab !== "jobs" || jobs.length === 0) return;
    const m = /^#job-(\d+)$/.exec(window.location.hash);
    if (m) document.getElementById(`job-${m[1]}`)?.scrollIntoView({ block: "center" });
  }, [activeTab, jobs.length]);

  async function ricaricaJobs() {
    const r = await fetchJson<ScheduledJob[]>("/api/jobs");
    if (r.ok) setJobs(r.data); else toast.error(r.message);
  }

  // ============ RENDER ============

  const allTabs: Array<{ key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    // Istanza (Riccardo, 23/10): la scelta del tenant, tolta dalla barra; solo con più istanze.
    ...(istanzeUtente > 1 ? [{ key: "istanza" as const, label: "Istanza", icon: Building2 }] : []),
    { key: "utenti", label: "Utenti", icon: Users },
    { key: "scansione", label: "Scansione", icon: Radar },
    { key: "identificazione", label: "Identificazione", icon: Fingerprint },
    { key: "jobs", label: "Job pianificati", icon: Clock },
    { key: "https", label: "HTTPS", icon: Shield },
    { key: "moduli", label: "Moduli", icon: PackageOpen },
    { key: "alert-sicurezza", label: "Alert sicurezza", icon: Siren },
    { key: "notifiche", label: "Notifiche", icon: Bell },
    { key: "aggiornamenti", label: "Aggiornamenti", icon: ArrowUpCircle },
    { key: "sistema", label: "Sistema", icon: Wrench },
  ];
  const tabs = isViewer ? allTabs.filter((tab) => tab.key !== "utenti") : allTabs;

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
                    <Select value={newUserRole} onValueChange={(v) => { setNewUserRole((v ?? newUserRole) as "superadmin" | "admin" | "viewer"); if (v === "superadmin") setNewUserTenantIds([]); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isSuperAdmin && <SelectItem value="superadmin">Super amministratore</SelectItem>}
                        <SelectItem value="admin">Amministratore</SelectItem>
                        <SelectItem value="viewer">Solo lettura</SelectItem>
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
                    <Select value={editUserRole} onValueChange={(v) => { setEditUserRole((v ?? editUserRole) as "superadmin" | "admin" | "viewer"); if (v === "superadmin") setEditUserTenantIds([]); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {isSuperAdmin && <SelectItem value="superadmin">Super amministratore</SelectItem>}
                        <SelectItem value="admin">Amministratore</SelectItem>
                        <SelectItem value="viewer">Solo lettura</SelectItem>
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
                        <SelectItem value="cleanup">Pulizia tabelle MAC</SelectItem>
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
                  const isRunning = runningJobId === job.id || giriInCorso.has(job.id);
                  // pulizia_host si gestisce solo dalla sua scheda: qui non si accende, non si lancia, non si cancella.
                  const soloLettura = job.job_type === "pulizia_host";
                  // Scansione automatica (J3): la crea e la gestisce solo un admin.
                  const scelti = job.job_type === "apparati_scelti";
                  const ds = job as ScheduledJob & DatiApparatiScelti;
                  const rs = ds.riassunto;
                  const aperto = dettagliAperti.has(job.id);
                  return (
                    <Fragment key={job.id}>
                    <TableRow id={`job-${job.id}`}>
                      <TableCell>
                        {/* Accendere e spegnere si fa da Opzioni (22/10): qui lo stato e il rimando alla riga. */}
                        <Link
                          href={`/settings/opzioni#${idOpzioneDelJob(job)}`}
                          title="Cambia da Opzioni"
                          className={`inline-flex rounded-full border-2 px-2 py-px text-[13px] font-bold ${job.enabled ? "border-[#0D2537] bg-[#0D2537] text-white dark:border-[#E6EEF4] dark:bg-[#E6EEF4] dark:text-[#0D2537]" : "border-[#5B6B77] text-[#0D2537] dark:text-[#E6EEF4]"}`}
                        >
                          {job.enabled ? "ACCESO" : "SPENTO"}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                          {scelti ? (
                            <span className="font-medium">{scheduledJobLabel(job, JOB_TYPE_LABELS)}</span>
                          ) : (
                            <Badge variant="outline">{scheduledJobLabel(job, JOB_TYPE_LABELS)}</Badge>
                          )}
                          {riskyCpu && (
                            <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400" title="Scan completo subnet grande con frequenza <12h: rischio saturazione CPU.">
                              ⚠ Carico CPU alto
                            </Badge>
                          )}
                        </div>
                        {scelti && (
                          <p className="mt-1 text-[13px] text-muted-foreground">
                            {JOB_TYPE_LABELS.apparati_scelti} · {ds.apparati ?? 0} apparat{ds.apparati === 1 ? "o" : "i"}
                          </p>
                        )}
                        {soloLettura && (
                          <p className="mt-1 text-[13px] text-muted-foreground">
                            Si gestisce da Impostazioni → Sistema → Pulizia degli host assenti
                          </p>
                        )}
                      </TableCell>
                      <TableCell>{scelti ? "—" : network ? `${network.name} (${network.cidr})` : "Tutte"}</TableCell>
                      <TableCell>
                        {scelti
                          ? (ds.frequenza ?? `${job.interval_minutes} min`)
                          : INTERVAL_OPTIONS.find((o) => o.value === String(job.interval_minutes))?.label || `${job.interval_minutes} min`}
                      </TableCell>
                      <TableCell className={cn("text-muted-foreground", scelti ? "text-[13px]" : "text-xs")}>
                        <div className="flex flex-wrap items-center gap-2">
                          {/* apparati_scelti: l'ora dell'ultimo giro dagli esiti (c'è anche quando il giro non ha letto niente). */}
                          <span>{scelti && rs ? dataItaliana(parseDbDate(rs.giro_il)) : job.last_run ? (scelti ? dataItaliana(parseDbDate(job.last_run)) : parseDbDate(job.last_run).toLocaleString("it-IT")) : "Mai"}</span>
                          {scelti && rs && (
                            <button
                              type="button"
                              onClick={() => setDettagliAperti((prec) => { const n = new Set(prec); if (n.has(job.id)) n.delete(job.id); else n.add(job.id); return n; })}
                              aria-expanded={aperto}
                              title="Mostra l'esito per apparato"
                            >
                              <PastigliaStato tono={pastigliaRiassunto(rs).tono} senzaSegno>{pastigliaRiassunto(rs).testo}</PastigliaStato>
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={cn("text-muted-foreground", scelti ? "text-[13px]" : "text-xs")}>
                        {scelti
                          ? (ds.prossima ? dataItaliana(new Date(ds.prossima)) : "sospeso")
                          : job.next_run ? parseDbDate(job.next_run).toLocaleString("it-IT") : "—"}
                      </TableCell>
                      <TableCell>
                        {!soloLettura && (!scelti || isAdmin) && (
                          <div className="flex items-center gap-1">
                            {scelti && (
                              <Button variant="outline" size="sm" className="h-8 text-[13px]" onClick={() => setJobInModifica(job.id)}>
                                Modifica
                              </Button>
                            )}
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
                              onClick={() => deleteJob(job.id, scelti ? scheduledJobLabel(job, JOB_TYPE_LABELS) : null)}
                              title="Elimina job"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {scelti && aperto && (
                      <TableRow>
                        <TableCell colSpan={7} className="bg-muted/30 p-0"><EsitiApparatiScelti key={versioneEsiti[job.id] ?? 0} jobId={job.id} /></TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {jobInModifica != null && (
        <FinestraScansioneAutomatica
          modo="modifica"
          jobId={jobInModifica}
          open
          onOpenChange={(o) => { if (!o) setJobInModifica(null); }}
          onFatto={() => void ricaricaJobs()}
        />
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
      {activeTab === "alert-sicurezza" && <SecurityAlertsTab />}

      {activeTab === "notifiche" && <NotificationsTab />}

      {activeTab === "aggiornamenti" && <UpdatesTab />}

      {/* === Tab: Sistema (wizard + manutenzione/dati) ===
          La scheda «Credenziali host di default» non c'è più (tappa 2d credenziali, D3 = (a)):
          le due chiavi dell'hub erano id del DB di un tenant, e la 2d le ha copiate nelle
          liste delle reti dove valevano. */}
      {activeTab === "sistema" && (
        <div className="space-y-6">
          {/* URL pubblico dell'hub: tolto dal menu a sinistra il 23/10 (Riccardo), prima stava in /agents. */}
          {isSuperAdmin && <HubUrlCard />}
          {isAdmin && (
            <Card>
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

          {isAdmin && <PuliziaHostCard />}

          {isAdmin && <InterruttoreAcquisizioneModulare isAdmin={isAdmin} />}

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Smartphone className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">MDM (Headwind)</CardTitle>
                {/* Passo 4c: l'MDM è un modulo opzionale; non ha una voce nel catalogo dei moduli. */}
                <Badge variant="secondary" title="Modulo opzionale, potenzialmente a pagamento">
                  {ETICHETTA_OPZIONE}
                </Badge>
              </div>
              <CardDescription>
                Configura la connessione al server Headwind MDM per importare i dispositivi mobili Android come host e sincronizzarne l&apos;inventario.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/settings/mdm")}
                className="gap-2"
              >
                <Smartphone className="h-4 w-4" />
                Configura MDM
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Dati e manutenzione</CardTitle>
              </div>
              <CardDescription>
                Esporta dati o resetta la configurazione per un nuovo cliente. Il reset cancella i dati del cliente (reti, host, apparati, credenziali, AD, telefoni, Wazuh, vulnerabilità, topologia, inventario, job); restano le impostazioni, la configurazione dei moduli e gli utenti.
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

          <AzzeraAppliance />
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

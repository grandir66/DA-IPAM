"use client";
import { parseDbDate } from "@/lib/db-date";

import { Suspense, useEffect, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Users,
  FolderTree,
  RefreshCw,
  BookOpen,
  ShieldCheck,
  ListChecks,
  Plus,
  Trash2,
  TestTube,
  Link,
  Monitor,
  Shield,
  CheckCircle,
  XCircle,
  Loader2,
  Wifi,
  Pencil,
  MoreHorizontal,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FilaNumeri } from "@/components/shared/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose, DialogFooter } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScorrimentoTabella } from "@/components/ui/table";
import { Pagination } from "@/components/shared/pagination";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { ADSetupGuideDialog } from "@/components/shared/ad-setup-guide-dialog";
import {
  ACCOUNT_LDAP_VUOTO,
  AccountLdapField,
  accountLdapCompleto,
  corpoAccountLdap,
  type AccountLdapForm,
} from "@/components/ad/account-ldap-field";
import { parseVociArchivio, type VoceArchivio } from "@/components/controllers/controllers-model";
import { stessoDc } from "@/lib/ad/account-ldap";
import { fetchJson } from "@/lib/fetch-json";
import { indirizzoHealthSpostata } from "@/lib/menu/sicurezza-dominio";

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
  /** Account LDAP: voce «Active Directory» dell'archivio (tappa 2f, T24). */
  credential_id: number | null;
  credential_name: string | null;
  /** Con che cosa entra: la voce, o niente (dalla 2g le colonne della riga non valgono più). */
  account: "voce" | "mancante";
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

type VociArchivio = VoceArchivio[] | null;

const defaultForm = {
  name: "",
  dc_host: "",
  domain: "",
  base_dn: "",
  account: ACCOUNT_LDAP_VUOTO as AccountLdapForm,
  use_ssl: true,
  port: 636,
  enabled: true,
  winrm_credential_id: null as number | null,
};

/** Valore che segue `value` 300 ms dopo l'ultima modifica: la ricerca non
 * parte a ogni tasto. */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// useSearchParams vuole un Suspense attorno. La Health è in «Sicurezza del dominio» dall'08/11/2026:
// ?tab=health (link salvati) ci rimanda.
export default function ActiveDirectoryPage() {
  return (
    <Suspense fallback={null}>
      <PaginaActiveDirectory />
    </Suspense>
  );
}

const SCHEDE_AD = new Set(["computers", "users", "groups", "dhcp"]);

function PaginaActiveDirectory() {
  const searchParams = useSearchParams();
  const tabRichiesta = searchParams.get("tab");
  const [scheda, setScheda] = useState(() => (tabRichiesta && SCHEDE_AD.has(tabRichiesta) ? tabRichiesta : "computers"));
  useEffect(() => {
    if (tabRichiesta && SCHEDE_AD.has(tabRichiesta)) setScheda(tabRichiesta);
  }, [tabRichiesta]);
  const router = useRouter();
  const health = indirizzoHealthSpostata(tabRichiesta);
  useEffect(() => {
    if (health) router.replace(health);
  }, [health, router]);
  const [integrations, setIntegrations] = useState<AdIntegration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<AdIntegration | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [commutando, setCommutando] = useState(false);

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

  const computersQuery = useDebounced(computersSearch);
  const usersQuery = useDebounced(usersSearch);
  const groupsQuery = useDebounced(groupsSearch);
  const dhcpQuery = useDebounced(dhcpSearch);

  // Voci dell'archivio: Windows per WinRM/DHCP (D7), Active Directory per l'account LDAP (T24).
  const [voci, setVoci] = useState<VociArchivio>(null);
  const [vociErrore, setVociErrore] = useState<string | null>(null);
  const winrmCredentials = useMemo(() => (voci ?? []).filter((c) => c.credential_type === "windows"), [voci]);
  const [dialogOpen, setDialogOpen] = useState(false);
  // v0.2.657: guida configurazione DC
  const [adGuideOpen, setAdGuideOpen] = useState(false);
  const [adGuideTab, setAdGuideTab] = useState<"prereq" | "audit">("prereq");
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState(defaultForm);
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

  const caricaVoci = useCallback(async () => {
    const r = await fetchJson<unknown>("/api/credentials", { cache: "no-store" });
    if (!r.ok) {
      setVociErrore(r.message);
      return;
    }
    const lista = parseVociArchivio(r.data);
    if (!lista) {
      setVociErrore("Risposta dell'archivio non leggibile");
      return;
    }
    setVociErrore(null);
    setVoci(lista);
  }, []);

  const fetchComputers = useCallback(async (signal?: AbortSignal) => {
    if (!selectedIntegration) return;
    try {
      const params = new URLSearchParams({
        page: String(computersPage),
        pageSize: String(pageSize),
        ...(computersQuery ? { search: computersQuery } : {}),
        ...(computersActiveOnly ? { activeDays: "90" } : {}),
      });
      const res = await fetch(`/api/ad/${selectedIntegration.id}/computers?${params}`, { signal });
      if (!res.ok) throw new Error("Errore caricamento computer");
      const data = await res.json();
      setComputers(data.rows);
      setComputersTotal(data.total);
    } catch (err) {
      if (signal?.aborted) return;
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }, [selectedIntegration, computersPage, computersQuery, computersActiveOnly]);

  const fetchUsers = useCallback(async (signal?: AbortSignal) => {
    if (!selectedIntegration) return;
    try {
      const params = new URLSearchParams({
        page: String(usersPage),
        pageSize: String(pageSize),
        ...(usersQuery ? { search: usersQuery } : {}),
        ...(usersActiveOnly ? { activeDays: "90" } : {}),
      });
      const res = await fetch(`/api/ad/${selectedIntegration.id}/users?${params}`, { signal });
      if (!res.ok) throw new Error("Errore caricamento utenti");
      const data = await res.json();
      setUsers(data.rows);
      setUsersTotal(data.total);
    } catch (err) {
      if (signal?.aborted) return;
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }, [selectedIntegration, usersPage, usersQuery, usersActiveOnly]);

  const fetchGroups = useCallback(async (signal?: AbortSignal) => {
    if (!selectedIntegration) return;
    try {
      const params = new URLSearchParams({
        page: String(groupsPage),
        pageSize: String(pageSize),
        ...(groupsQuery ? { search: groupsQuery } : {}),
      });
      const res = await fetch(`/api/ad/${selectedIntegration.id}/groups?${params}`, { signal });
      if (!res.ok) throw new Error("Errore caricamento gruppi");
      const data = await res.json();
      setGroups(data.rows);
      setGroupsTotal(data.total);
    } catch (err) {
      if (signal?.aborted) return;
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }, [selectedIntegration, groupsPage, groupsQuery]);

  const fetchDhcpLeases = useCallback(async (signal?: AbortSignal) => {
    if (!selectedIntegration) return;
    try {
      const params = new URLSearchParams({
        page: String(dhcpPage),
        pageSize: String(pageSize),
        ...(dhcpQuery ? { search: dhcpQuery } : {}),
      });
      const res = await fetch(`/api/ad/${selectedIntegration.id}/dhcp-leases?${params}`, { signal });
      if (!res.ok) throw new Error("Errore caricamento DHCP");
      const data = await res.json();
      setDhcpLeases(data.rows);
      setDhcpTotal(data.total);
    } catch (err) {
      if (signal?.aborted) return;
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  }, [selectedIntegration, dhcpPage, dhcpQuery]);

  useEffect(() => { fetchIntegrations(); }, [fetchIntegrations]);
  useEffect(() => { void caricaVoci(); }, [caricaVoci]);
  useEffect(() => {
    const ac = new AbortController();
    void fetchComputers(ac.signal);
    return () => ac.abort();
  }, [fetchComputers]);
  useEffect(() => {
    const ac = new AbortController();
    void fetchUsers(ac.signal);
    return () => ac.abort();
  }, [fetchUsers]);
  useEffect(() => {
    const ac = new AbortController();
    void fetchGroups(ac.signal);
    return () => ac.abort();
  }, [fetchGroups]);
  useEffect(() => {
    const ac = new AbortController();
    void fetchDhcpLeases(ac.signal);
    return () => ac.abort();
  }, [fetchDhcpLeases]);

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

  // Interruttore «Abilitata» accanto al test (Riccardo, 29/10/2026): prima si cambiava solo da
  // «Modifica», e una spunta dimenticata lasciava l'integrazione spenta senza che si vedesse.
  const handleAbilita = async (integrazione: AdIntegration, abilitata: boolean) => {
    setCommutando(true);
    try {
      const res = await fetch(`/api/ad/${integrazione.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: abilitata }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Errore aggiornamento");
      setSelectedIntegration(data);
      setIntegrations((prev) => prev.map((i) => (i.id === data.id ? data : i)));
      toast.success(abilitata ? "Integrazione abilitata: si sincronizza da sola ogni 6 ore" : "Integrazione disabilitata");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setCommutando(false);
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
      const { account, ...campi } = form;
      const res = await fetch("/api/ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...campi, ...corpoAccountLdap(account) }),
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
      account: { ...ACCOUNT_LDAP_VUOTO, credentialId: integration.credential_id },
      use_ssl: !!integration.use_ssl,
      port: integration.port,
      enabled: !!integration.enabled,
      winrm_credential_id: integration.winrm_credential_id,
    });
    setEditDialogOpen(true);
  };

  /** Il DC del modulo è diverso da quello salvato: l'account va scelto di nuovo (D12 = (a)). */
  const dcEditCambiato = !!selectedIntegration && !stessoDc(editForm.dc_host, selectedIntegration.dc_host);

  /** Un DC diverso da quello salvato svuota la scelta; tornando a quello salvato torna la sua voce. */
  const setEditDc = (dc_host: string) => {
    setEditForm((f) => {
      if (!selectedIntegration) return { ...f, dc_host };
      const altrove = !stessoDc(dc_host, selectedIntegration.dc_host);
      const eraAltrove = !stessoDc(f.dc_host, selectedIntegration.dc_host);
      if (altrove && !eraAltrove) return { ...f, dc_host, account: { ...f.account, credentialId: null } };
      if (!altrove && eraAltrove && f.account.credentialId === null) {
        return { ...f, dc_host, account: { ...f.account, credentialId: selectedIntegration.credential_id } };
      }
      return { ...f, dc_host };
    });
  };

  const handleEdit = async () => {
    if (!selectedIntegration) return;
    setEditSaving(true);
    try {
      // L'account: la voce scelta o un account nuovo; niente dei due = resta com'è
      // (con un DC nuovo il salvataggio chiede prima di sceglierlo, D12).
      const payload: Record<string, unknown> = {
        name: editForm.name,
        dc_host: editForm.dc_host,
        domain: editForm.domain,
        base_dn: editForm.base_dn,
        use_ssl: editForm.use_ssl,
        port: editForm.port,
        enabled: editForm.enabled,
        winrm_credential_id: editForm.winrm_credential_id,
        // Solo se è cambiato: la voce salvata rimandata si ricontrollerebbe a ogni modifica.
        ...(editForm.account.nuova || dcEditCambiato || editForm.account.credentialId !== selectedIntegration.credential_id
          ? corpoAccountLdap(editForm.account)
          : {}),
      };

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
      return parseDbDate(iso).toLocaleString("it-IT");
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
        <div className="flex items-center gap-2">
          {/* Una riga di azioni (Riccardo, 13/11/2026): le tre guide stanno in un menu solo. «Cosa serve» è la pagina
              con diritti, script e configurazione degli eventi (04/11); «Guida DC» e «Audit dei DC» aprono la finestra. */}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline"><BookOpen className="w-4 h-4 mr-2" />Guide</Button>} />
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => { window.location.href = "/active-directory/cosa-serve"; }}>
                <ListChecks className="w-4 h-4 mr-2" />Cosa serve
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setAdGuideTab("prereq"); setAdGuideOpen(true); }}>
                <BookOpen className="w-4 h-4 mr-2" />Guida DC (LDAPS, WinRM, DHCP)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setAdGuideTab("audit"); setAdGuideOpen(true); }}>
                <ShieldCheck className="w-4 h-4 mr-2" />Audit dei DC
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              <AccountLdapField
                id="ad-account-nuova"
                valore={form.account}
                onChange={(patch) => setForm((f) => ({ ...f, account: { ...f.account, ...patch } }))}
                voci={voci}
                vociErrore={vociErrore}
                onRiprova={() => void caricaVoci()}
                nomeIntegrazione={form.name}
                disabled={saving}
              />
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-1">
                  <Wifi className="w-3.5 h-3.5" />
                  Credenziale WinRM del DC (per DHCP; la Sicurezza del dominio, se manca, usa l&apos;account di AD)
                </label>
                <Select
                  value={form.winrm_credential_id?.toString() ?? "none"}
                  onValueChange={(v) => setForm({ ...form, winrm_credential_id: v === "none" || !v ? null : parseInt(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nessuna (DHCP spento)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nessuna (DHCP spento)</SelectItem>
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
              <Button onClick={handleCreate} disabled={saving || !form.name || !form.dc_host || !form.base_dn || !accountLdapCompleto(form.account)}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Crea
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* v0.2.657: dialog guida configurazione DC */}
      <ADSetupGuideDialog key={adGuideTab} open={adGuideOpen} onOpenChange={setAdGuideOpen} initialTab={adGuideTab} />

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
                  onChange={(e) => setEditDc(e.target.value)}
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
            <AccountLdapField
              id="ad-account-modifica"
              valore={editForm.account}
              onChange={(patch) => setEditForm((f) => ({ ...f, account: { ...f.account, ...patch } }))}
              voci={voci}
              vociErrore={vociErrore}
              onRiprova={() => void caricaVoci()}
              nomeIntegrazione={editForm.name}
              dcCambiato={dcEditCambiato}
              disabled={editSaving}
            />
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-1">
                <Wifi className="w-3.5 h-3.5" />
                Credenziale WinRM del DC (per DHCP; la Sicurezza del dominio, se manca, usa l&apos;account di AD)
              </label>
              <Select
                value={editForm.winrm_credential_id?.toString() ?? "none"}
                onValueChange={(v) => setEditForm({ ...editForm, winrm_credential_id: v === "none" || !v ? null : parseInt(v) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Nessuna (DHCP spento)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nessuna (DHCP spento)</SelectItem>
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
            <Button
              onClick={handleEdit}
              disabled={
                editSaving ||
                !editForm.name ||
                !editForm.dc_host ||
                !editForm.base_dn ||
                // Un account nuovo a metà, o un DC nuovo senza account scelto di nuovo (D12).
                ((editForm.account.nuova || dcEditCambiato) && !accountLdapCompleto(editForm.account))
              }
            >
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
                <label
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] font-medium ${
                    selectedIntegration.enabled
                      ? "border-[#1F7A4D] bg-[#1F7A4D] text-white"
                      : "border-dashed border-muted-foreground/60 text-foreground"
                  }`}
                  title="Accende o spegne l'integrazione; accesa, si sincronizza da sola ogni 6 ore"
                >
                  <Switch
                    checked={!!selectedIntegration.enabled}
                    disabled={commutando}
                    onCheckedChange={(c) => handleAbilita(selectedIntegration, !!c)}
                    aria-label="Integrazione abilitata"
                  />
                  {selectedIntegration.enabled ? "✓ Abilitata" : "– Disabilitata"}
                </label>
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
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label="Altre azioni sull'integrazione" title="Modifica, prova, elimina"><MoreHorizontal className="w-4 h-4" /></Button>} />
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => openEditDialog(selectedIntegration)}>
                      <Pencil className="w-4 h-4 mr-2" />Modifica
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={testing === selectedIntegration.id} onClick={() => handleTest(selectedIntegration.id)}>
                      <TestTube className="w-4 h-4 mr-2" />{testing === selectedIntegration.id ? "Prova in corso…" : "Prova la connessione"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleDelete(selectedIntegration.id)}>
                      <Trash2 className="w-4 h-4 mr-2" />Elimina l&apos;integrazione
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          {selectedIntegration && (
            <>
              {/* I conteggi di computer, utenti, gruppi e lease stanno sulle schede qui sotto: una cosa si dice una volta.
                  Qui resta quello che le schede non dicono (13/11/2026). */}
              <FilaNumeri
                voci={[
                  { titolo: "Ultima sincronizzazione", valore: formatDate(selectedIntegration.last_sync_at), aiuto: selectedIntegration.last_sync_status ?? undefined },
                  ...(!selectedIntegration.winrm_credential_id ? [{ titolo: "Lease DHCP", valore: null, qualifica: "WinRM non configurato" }] : []),
                ]}
              />

              <Tabs value={scheda} onValueChange={(v) => setScheda(String(v))} className="mt-3">
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
                      <span className="text-xs text-muted-foreground">Solo logon negli ultimi 90 giorni: {computersTotal} di {selectedIntegration.computers_count}</span>
                    )}
                    {/* Paginazione in cima, accanto alla ricerca (Riccardo, 20/10). */}
                    <div className="ml-auto">
                      <Pagination inTesta page={computersPage} totalPages={Math.ceil(computersTotal / pageSize)} onPageChange={setComputersPage} pageSize={pageSize} total={computersTotal} />
                    </div>
                  </div>
                  <ScorrimentoTabella className="border rounded-lg">
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
                  </ScorrimentoTabella>
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
                      <span className="text-xs text-muted-foreground">Solo logon negli ultimi 90 giorni: {usersTotal} di {selectedIntegration.users_count}</span>
                    )}
                    {/* Paginazione in cima, accanto alla ricerca (Riccardo, 20/10). */}
                    <div className="ml-auto">
                      <Pagination inTesta page={usersPage} totalPages={Math.ceil(usersTotal / pageSize)} onPageChange={setUsersPage} pageSize={pageSize} total={usersTotal} />
                    </div>
                  </div>
                  <ScorrimentoTabella className="border rounded-lg">
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
                  </ScorrimentoTabella>
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
                    {/* Paginazione in cima, accanto alla ricerca (Riccardo, 20/10). */}
                    <div className="ml-auto">
                      <Pagination inTesta page={groupsPage} totalPages={Math.ceil(groupsTotal / pageSize)} onPageChange={setGroupsPage} pageSize={pageSize} total={groupsTotal} />
                    </div>
                  </div>
                  <ScorrimentoTabella className="border rounded-lg">
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
                  </ScorrimentoTabella>
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
                        {/* Paginazione in cima, accanto alla ricerca (Riccardo, 20/10). */}
                        <div className="ml-auto">
                          <Pagination inTesta page={dhcpPage} totalPages={Math.ceil(dhcpTotal / pageSize)} onPageChange={setDhcpPage} pageSize={pageSize} total={dhcpTotal} />
                        </div>
                      </div>
                      <ScorrimentoTabella className="border rounded-lg">
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
                      </ScorrimentoTabella>
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

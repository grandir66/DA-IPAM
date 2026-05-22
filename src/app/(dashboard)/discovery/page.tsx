"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader,
  DialogScrollableArea, DialogTitle, DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/shared/status-badge";
import { FingerprintConfidenceBadge } from "@/components/shared/fingerprint-confidence-badge";
import { ProtocolBadges } from "@/components/shared/protocol-badges";
import { DeviceFormFields } from "@/components/shared/device-form-fields";
import { AddableSelect } from "@/components/shared/addable-select";
import { credTypeForProtocol, CRED_TYPE_OPTIONS } from "@/lib/credential-protocol-map";
import { CreateFingerprintRuleDialog } from "@/components/shared/create-fingerprint-rule-dialog";
import { SortableTableHead } from "@/components/shared/sortable-table-head";
import { Pagination } from "@/components/shared/pagination";
import { useClientTableSort } from "@/hooks/use-table-sort";
import {
  DEVICE_CLASSIFICATIONS_ORDERED, getClassificationLabel, sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import { parseDetectedDeviceFromDetectionJson } from "@/lib/device-fingerprint-classification";
import {
  Search, RefreshCw, Columns3, Download, Radar, ExternalLink,
  Pencil, X, Loader2, Save, PlusCircle, Sparkles, Activity, PackagePlus, Server,
  Wrench, Package, Boxes, Router as RouterIcon, Cable, Shield, HardDrive, Monitor,
  Lock, KeyRound, Trash2, ShieldCheck, MoreHorizontal,
} from "lucide-react";

/**
 * Preset rapidi per filtrare per macro-categoria di device.
 * - "group:<key>" copre più classificazioni (Server raggruppa server/server_linux/server_windows).
 * - I singoletti (router/switch/firewall/hypervisor) usano direttamente la classificazione,
 *   così la chip e l'opzione del dropdown classFilter restano allineate.
 */
const CLASS_PRESETS: Array<{
  /** Valore impostato in classFilter quando la chip è attiva. */
  filter: string;
  label: string;
  icon: typeof Server;
  /** Classificazioni che soddisfano il preset (usato per espansione filtro group:*). */
  match: readonly string[];
}> = [
  { filter: "group:server", label: "Server", icon: Server, match: ["server", "server_linux", "server_windows"] },
  { filter: "group:client", label: "Client", icon: Monitor, match: ["workstation", "notebook"] },
  { filter: "hypervisor", label: "Hypervisor", icon: HardDrive, match: ["hypervisor"] },
  { filter: "router", label: "Router", icon: RouterIcon, match: ["router"] },
  { filter: "switch", label: "Switch", icon: Cable, match: ["switch"] },
  { filter: "firewall", label: "Firewall", icon: Shield, match: ["firewall"] },
];
import { toast } from "sonner";
import type { Host, LibreNMSHostMap, DeviceFingerprintSnapshot } from "@/types";

const SORTED_CLASSIFICATIONS = sortClassificationsByDisplayLabel(DEVICE_CLASSIFICATIONS_ORDERED);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnrichedHost = Host & {
  network_name: string;
  network_cidr: string;
  vlan_id: number | null;
  location: string;
  device_id?: number;
  device_name?: string;
  device_vendor?: string;
  device_type?: string;
  switch_port?: string;
  switch_device_name?: string;
  ad_dns_host_name?: string | null;
  validated_protocols?: string[];
  multihomed?: { group_id: string; match_type: string; peers: Array<{ ip: string; network_name: string; host_id: number }> } | null;
  vuln?: {
    max_severity: "Critical" | "High" | "Medium" | "Low";
    critical: number;
    high: number;
    medium: number;
    total: number;
  } | null;
  /** Stato di evoluzione: linkato a `inventory_assets` (NIS2, lifecycle, finanziari). */
  asset_id?: number;
  asset_tag?: string;
  asset_categoria?: string;
  /** Ultimo scan software con esito ok (se presente). */
  last_software_scan_id?: number;
  last_software_scan_apps?: number;
  last_software_scan_at?: string;
};

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface ColumnDef {
  id: string;
  label: string;
  defaultVisible: boolean;
  /** Group for the column picker */
  group: "base" | "rete" | "rilevamento" | "dettaglio";
}

const COLUMNS: ColumnDef[] = [
  // Base
  { id: "profilo",         label: "Profilo",         defaultVisible: true,  group: "base" },
  { id: "ip",              label: "IP",              defaultVisible: true,  group: "base" },
  { id: "hostname",        label: "Nome",            defaultVisible: true,  group: "base" },
  { id: "status",          label: "Stato",           defaultVisible: true,  group: "base" },
  { id: "mac",             label: "MAC",             defaultVisible: true,  group: "base" },
  { id: "device_manufacturer", label: "Produttore",  defaultVisible: true,  group: "base" },
  { id: "vendor",          label: "Vendor",          defaultVisible: false, group: "base" },
  { id: "classification",  label: "Classificazione", defaultVisible: true,  group: "base" },
  { id: "fp_confidence",   label: "Conf.",           defaultVisible: true,  group: "base" },
  { id: "validated_creds", label: "Cred.",            defaultVisible: true,  group: "base" },
  { id: "vuln_max_severity", label: "CVE max",       defaultVisible: true,  group: "rilevamento" },
  { id: "vuln_counts",       label: "CVE C/H/M",     defaultVisible: true,  group: "rilevamento" },
  { id: "known_host",      label: "Manuale",         defaultVisible: false, group: "base" },
  { id: "ip_assignment",   label: "DHCP",            defaultVisible: true,  group: "base" },
  { id: "detected",        label: "Rilevato",        defaultVisible: false, group: "rilevamento" },
  { id: "notes",           label: "Note",            defaultVisible: false, group: "base" },

  // Rete
  { id: "network_name",    label: "Subnet",          defaultVisible: true,  group: "rete" },
  { id: "vlan_id",         label: "VLAN",            defaultVisible: false, group: "rete" },
  { id: "location",        label: "Sede",            defaultVisible: false, group: "rete" },
  { id: "device_name",     label: "Dispositivo",     defaultVisible: false, group: "rete" },
  { id: "switch_port",     label: "Porta switch",    defaultVisible: false, group: "rete" },
  { id: "ad_dns",          label: "AD DNS",          defaultVisible: false, group: "rete" },
  { id: "in_ad",           label: "AD",              defaultVisible: true,  group: "rete" },
  { id: "multihomed",      label: "MH",              defaultVisible: false, group: "rete" },

  // Rilevamento
  { id: "os_info",         label: "OS",              defaultVisible: false, group: "rilevamento" },
  { id: "open_ports",      label: "Porte aperte",    defaultVisible: false, group: "rilevamento" },
  { id: "open_ports_tcp",  label: "Porte TCP",       defaultVisible: true,  group: "rilevamento" },
  { id: "open_ports_udp",  label: "Porte UDP",       defaultVisible: true,  group: "rilevamento" },
  { id: "response_time",   label: "RTT (ms)",        defaultVisible: false, group: "rilevamento" },

  // Dettaglio
  { id: "model",           label: "Modello",         defaultVisible: false, group: "dettaglio" },
  { id: "serial_number",   label: "Seriale",         defaultVisible: false, group: "dettaglio" },
  { id: "firmware",        label: "Firmware",         defaultVisible: false, group: "dettaglio" },
  { id: "librenms_id",     label: "LibreNMS",         defaultVisible: true,  group: "dettaglio" },
  { id: "asset_tag",       label: "Asset tag",       defaultVisible: false, group: "dettaglio" },
  { id: "software_scan",   label: "App scansionate", defaultVisible: false, group: "dettaglio" },

  // Temporali
  { id: "last_seen",       label: "Ultimo visto",    defaultVisible: true,  group: "base" },
  { id: "first_seen",      label: "Primo visto",     defaultVisible: false, group: "base" },

  // Nota: la colonna "Azioni" è hardcoded fuori da COLUMNS (vedi TableHead /
  // TableCell dedicati nel render della tabella) perché è sempre visibile e
  // non sortable. Tier 1 ha esteso quella cella con Test cred / Riscansiona /
  // Modifica device / Elimina device per host promossi a network_device.
];

const GROUP_LABELS: Record<string, string> = {
  base: "Base",
  rete: "Rete",
  rilevamento: "Rilevamento",
  dettaglio: "Dettaglio hardware",
};

const STORAGE_KEY = "discovery-columns";
const PAGE_SIZE = 50;

// Colonne che devono essere sempre visibili indipendentemente dal localStorage
const ALWAYS_VISIBLE = new Set(["librenms_id"]);

function loadVisibleColumns(): Set<string> {
  if (typeof window === "undefined") return new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr) && arr.length > 0) {
        const set = new Set(arr);
        for (const id of ALWAYS_VISIBLE) set.add(id); // garantisce sempre visibile
        return set;
      }
    }
  } catch { /* ignore */ }
  return new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
}

function saveVisibleColumns(cols: Set<string>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...cols])); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function displayName(h: EnrichedHost): string {
  return h.custom_name || h.hostname || h.dns_reverse || h.ad_dns_host_name || "";
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function parsePorts(json: string | null): string {
  if (!json) return "";
  try {
    const arr = JSON.parse(json) as Array<{ port: number; protocol?: string }>;
    if (!Array.isArray(arr)) return "";
    return arr.slice(0, 12).map((p) => p.protocol === "udp" ? `${p.port}/u` : String(p.port)).join(", ")
      + (arr.length > 12 ? ` +${arr.length - 12}` : "");
  } catch { return ""; }
}

/** Lista completa porte separate per protocollo (no troncamento). Usata in CSV/export
 *  e per le colonne dedicate "Porte TCP" / "Porte UDP". */
function parsePortsByProtocol(json: string | null, protocol: "tcp" | "udp"): string {
  if (!json) return "";
  try {
    const arr = JSON.parse(json) as Array<{ port: number; protocol?: string }>;
    if (!Array.isArray(arr)) return "";
    return arr
      .filter((p) => (p.protocol ?? "tcp") === protocol)
      .map((p) => String(p.port))
      .join(", ");
  } catch { return ""; }
}

function getFpConfidence(h: EnrichedHost): number {
  const raw = (h as unknown as { detection_json?: string | null }).detection_json;
  if (!raw) return 0;
  try {
    const snap = JSON.parse(raw) as { final_confidence?: number; final_device?: string };
    return snap.final_confidence ?? 0;
  } catch { return 0; }
}

function getFpDevice(h: EnrichedHost): string | null {
  const raw = (h as unknown as { detection_json?: string | null }).detection_json;
  if (!raw) return null;
  try {
    const snap = JSON.parse(raw) as { final_device?: string };
    return snap.final_device ?? null;
  } catch { return null; }
}

/** Produttore effettivo: device_manufacturer se presente, altrimenti MAC vendor come fallback */
function getManufacturer(h: EnrichedHost): { text: string; fromVendor: boolean } {
  if (h.device_manufacturer) return { text: h.device_manufacturer, fromVendor: false };
  if (h.vendor) return { text: h.vendor, fromVendor: true };
  return { text: "", fromVendor: false };
}

// ---------------------------------------------------------------------------
// Bulk edit form types
// ---------------------------------------------------------------------------

interface BulkField<T> {
  enabled: boolean;
  value: T;
}

interface DiscoveryBulkForm {
  // Campi su `hosts` (sempre applicabili)
  classification: BulkField<string>;
  device_manufacturer: BulkField<string | null>;
  ip_assignment: BulkField<string>;
  known_host: BulkField<0 | 1>;
  notes: BulkField<string | null>;
  // Credenziale: viene aggiunta in `host_credentials` e propagata a network_devices/bindings
  credential_id: BulkField<number | null>;
  credential_protocol: BulkField<string>;
  credential_port: BulkField<number>;
  // Campi su `network_devices` (applicati solo agli host già promossi a device)
  device_type: BulkField<string>;
  vendor: BulkField<string>;
  scan_target: BulkField<string>;
  // Campi NIS2 su `inventory_assets` (applicati solo agli host con asset linkato)
  asset_categoria_nis2: BulkField<string>;
  asset_criticita_nis2: BulkField<string>;
}

function emptyBulkForm(): DiscoveryBulkForm {
  return {
    classification: { enabled: false, value: "" },
    device_manufacturer: { enabled: false, value: null },
    ip_assignment: { enabled: false, value: "static" },
    known_host: { enabled: false, value: 1 },
    notes: { enabled: false, value: null },
    credential_id: { enabled: false, value: null },
    credential_protocol: { enabled: false, value: "ssh" },
    credential_port: { enabled: false, value: 22 },
    device_type: { enabled: false, value: "" },
    vendor: { enabled: false, value: "" },
    scan_target: { enabled: false, value: "" },
    asset_categoria_nis2: { enabled: false, value: "" },
    asset_criticita_nis2: { enabled: false, value: "" },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DiscoveryPage() {
  const [hosts, setHosts] = useState<EnrichedHost[]>([]);
  const [librenmsMap, setLibrenmsMap] = useState<Map<string, LibreNMSHostMap>>(new Map());
  const [credentials, setCredentials] = useState<{ id: number; name: string; credential_type: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [networkFilter, setNetworkFilter] = useState("");
  const [vulnFilter, setVulnFilter] = useState<"" | "critical_high" | "critical" | "with_findings">("");
  const [page, setPage] = useState(1);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(loadVisibleColumns);

  // ─── Tier 1 row actions: state per disabilitare il bottone durante l'azione ─
  const [rowActionBusy, setRowActionBusy] = useState<{ id: number; kind: "test" | "query" | "delete" } | null>(null);

  // ─── Selezione e bulk edit ────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkForm, setBulkForm] = useState<DiscoveryBulkForm>(emptyBulkForm);
  // Bulk "Aggiorna selezionati" e "Crea asset NIS2"
  const [bulkScanRunning, setBulkScanRunning] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [bulkScanResults, setBulkScanResults] = useState<Array<{
    host_id: number;
    ip: string;
    name: string;
    query_status: "ok" | "error" | "skipped";
    query_message: string;
    software_status: "ok" | "error" | "skipped" | "not-applicable";
    software_message: string;
  }>>([]);
  const [bulkScanResultsOpen, setBulkScanResultsOpen] = useState(false);
  const [bulkAssetRunning, setBulkAssetRunning] = useState(false);

  // ─── Add to devices (bulk promote host → device) ──────────
  const [addDevicesOpen, setAddDevicesOpen] = useState(false);
  const [addDevicesSaving, setAddDevicesSaving] = useState(false);
  const [addClassification, setAddClassification] = useState<string>("server");
  const [addVendor, setAddVendor] = useState<string>("other");
  const [addProtocol, setAddProtocol] = useState<string>("ssh");
  const [addVendorSubtype, setAddVendorSubtype] = useState<string | null>(null);
  const [addProductProfile, setAddProductProfile] = useState<string | null>(null);
  const [addScanTarget, setAddScanTarget] = useState<string | null>(null);
  const [addCredentialId, setAddCredentialId] = useState<string | null>(null);
  const [addSnmpCredentialId, setAddSnmpCredentialId] = useState<string | null>(null);
  const [addUseForArpPoll, setAddUseForArpPoll] = useState<boolean>(false);
  const [addCredentials, setAddCredentials] = useState<Array<{ id: number; name: string; credential_type: string }>>([]);

  const refreshCredentials = async () => {
    try {
      const r = await fetch("/api/credentials", { cache: "no-store" });
      if (r.ok) setAddCredentials(await r.json());
    } catch { /* ignore */ }
  };

  // ─── LibreNMS: URL base e aggiunta singolo host ─────────
  const [librenmsUrl, setLibrenmsUrl] = useState("");
  const [librenmsAdding, setLibrenmsAdding] = useState<Set<number>>(new Set());

  async function addHostToLibreNMS(h: EnrichedHost) {
    setLibrenmsAdding((prev) => new Set(prev).add(h.id));
    try {
      const res = await fetch("/api/integrations/librenms/host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_id: h.id }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`${h.ip} aggiunto a LibreNMS (#${data.librenms_device_id})`);
        // Aggiorna la librenms map localmente
        setLibrenmsMap((prev) => {
          const next = new Map(prev);
          next.set(`${h.network_id}:${h.ip}`, {
            id: 0,
            network_id: h.network_id,
            host_ip: h.ip,
            librenms_device_id: data.librenms_device_id,
            librenms_hostname: h.ip,
            last_status: h.status ?? null,
            last_synced_at: new Date().toISOString(),
          });
          return next;
        });
      } else {
        toast.error(data.error ?? "Errore aggiunta a LibreNMS");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setLibrenmsAdding((prev) => { const next = new Set(prev); next.delete(h.id); return next; });
    }
  }

  // ─── Creazione regola fingerprint ─────────────────────────
  const [createRuleOpen, setCreateRuleOpen] = useState(false);
  const [ruleHost, setRuleHost] = useState<EnrichedHost | null>(null);

  function openCreateRule(h: EnrichedHost) {
    setRuleHost(h);
    setCreateRuleOpen(true);
  }

  function getRuleFingerprint(): DeviceFingerprintSnapshot | null {
    if (!ruleHost) return null;
    const raw = (ruleHost as unknown as { detection_json?: string | null }).detection_json;
    if (!raw) return null;
    try { return JSON.parse(raw) as DeviceFingerprintSnapshot; } catch { return null; }
  }

  // ─── Azioni per riga: elimina + test credenziali ──────────
  const [deleteHostRow, setDeleteHostRow] = useState<EnrichedHost | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [testHostRow, setTestHostRow] = useState<EnrichedHost | null>(null);
  const [testRowCredId, setTestRowCredId] = useState<string>("");
  const [testRowPort, setTestRowPort] = useState<string>("");
  const [testRowRunning, setTestRowRunning] = useState(false);

  function openTestForRow(h: EnrichedHost) {
    setTestHostRow(h);
    setTestRowCredId("");
    setTestRowPort("");
  }

  function defaultPortFor(type: string): string {
    const t = (type || "").toLowerCase();
    if (t === "ssh" || t === "linux") return "22";
    if (t === "windows" || t === "winrm") return "5985";
    if (t === "snmp") return "161";
    return "";
  }

  async function handleDeleteHost() {
    if (!deleteHostRow) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/hosts/${deleteHostRow.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(`Host ${deleteHostRow.ip} eliminato`);
        const removedId = deleteHostRow.id;
        setDeleteHostRow(null);
        setSelectedIds((prev) => { const next = new Set(prev); next.delete(removedId); return next; });
        fetchData();
      } else {
        toast.error(data?.error ?? "Errore nell'eliminazione");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setDeleting(false);
    }
  }

  async function handleTestRowCredential() {
    if (!testHostRow || !testRowCredId) {
      toast.error("Seleziona una credenziale");
      return;
    }
    setTestRowRunning(true);
    try {
      const body: { host: string; port?: number } = { host: testHostRow.ip };
      const portNum = parseInt(testRowPort, 10);
      if (!isNaN(portNum) && portNum > 0) body.port = portNum;
      const res = await fetch(`/api/credentials/${testRowCredId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Test credenziale riuscito");
        setTestHostRow(null);
        fetchData();
      } else {
        toast.error(data.error || "Test credenziale fallito");
      }
    } catch {
      toast.error("Errore nel test");
    } finally {
      setTestRowRunning(false);
    }
  }

  // ---------- fetch ----------
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hosts/discovery");
      if (res.ok) {
        const data: EnrichedHost[] = await res.json();
        setHosts(data);
        // Carica librenms map per le reti presenti
        const networkIds = [...new Set(data.map((h) => h.network_id))];
        const maps: LibreNMSHostMap[] = [];
        await Promise.all(
          networkIds.map(async (nid) => {
            try {
              const r = await fetch(`/api/integrations/librenms/sync?network_id=${nid}`);
              if (r.ok) {
                const rows = (await r.json()) as LibreNMSHostMap[];
                maps.push(...rows);
              }
            } catch { /* non critico */ }
          })
        );
        const m = new Map<string, LibreNMSHostMap>();
        for (const row of maps) m.set(`${row.network_id}:${row.host_ip}`, row);
        setLibrenmsMap(m);
      } else setHosts([]);
    } catch { setHosts([]); }
    finally {
      setLoading(false);
      setSelectedIds(new Set());
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Tier 1 row actions: handler condivisi col device-list-by-classification ──
  // Stesse API esistenti (no nuovo backend). fetchData() a fine azione riallinea
  // la tabella con lo stato DB aggiornato.
  const handleRowTestCred = useCallback(async (deviceId: number) => {
    setRowActionBusy({ id: deviceId, kind: "test" });
    try {
      const res = await fetch(`/api/devices/${deviceId}/test`, { cache: "no-store" });
      const data = await res.json();
      if (data?.success) toast.success("Credenziali verificate");
      else toast.error(data?.error ?? "Test credenziali fallito");
    } catch {
      toast.error("Errore di connessione al device");
    } finally {
      setRowActionBusy(null);
    }
  }, []);

  const handleRowRescan = useCallback(async (deviceId: number) => {
    setRowActionBusy({ id: deviceId, kind: "query" });
    try {
      const res = await fetch(`/api/devices/${deviceId}/query`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(data?.message ?? "Riscansione completata");
        fetchData();
      } else {
        toast.error(data?.error ?? "Errore nella riscansione");
      }
    } catch {
      toast.error("Errore di connessione al device");
    } finally {
      setRowActionBusy(null);
    }
  }, [fetchData]);

  const handleRowDeleteDevice = useCallback(async (deviceId: number, name: string) => {
    if (!confirm(`Eliminare il dispositivo "${name}"? L'host resta nel database.`)) return;
    setRowActionBusy({ id: deviceId, kind: "delete" });
    try {
      const res = await fetch(`/api/devices/${deviceId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Dispositivo eliminato");
        fetchData();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Errore nell'eliminazione");
      }
    } catch {
      toast.error("Errore di connessione");
    } finally {
      setRowActionBusy(null);
    }
  }, [fetchData]);

  const handleRowDeleteHost = useCallback(async (hostId: number, label: string) => {
    if (!confirm(`Eliminare l'host "${label}"? Sarà rimosso dal database (verrà ricreato al prossimo scan se ancora rilevato).`)) return;
    setRowActionBusy({ id: hostId, kind: "delete" });
    try {
      const res = await fetch(`/api/hosts/${hostId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Host eliminato");
        fetchData();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Errore nell'eliminazione");
      }
    } catch {
      toast.error("Errore di connessione");
    } finally {
      setRowActionBusy(null);
    }
  }, [fetchData]);

  // Carica credenziali per il dialog bulk + URL LibreNMS
  useEffect(() => {
    fetch("/api/credentials").then((r) => r.json()).then((data: { id: number; name: string; credential_type: string }[]) => {
      setAddCredentials(data);
      if (Array.isArray(data)) setCredentials(data);
    }).catch(() => {});
    fetch("/api/integrations/active").then((r) => r.json()).then((data: Record<string, { enabled: boolean; url: string }>) => {
      if (data?.librenms?.enabled && data.librenms.url) setLibrenmsUrl(data.librenms.url.replace(/\/+$/, ""));
    }).catch(() => {});
  }, []);

  // ---------- derived lists for filter dropdowns ----------
  const classifications = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts) if (h.classification && h.classification !== "unknown") set.add(h.classification);
    return [...set].sort((a, b) => a.localeCompare(b, "it"));
  }, [hosts]);

  const networks = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hosts) map.set(h.network_name, h.network_cidr);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "it"));
  }, [hosts]);

  // ---------- filter ----------
  const filtered = useMemo(() => {
    const lower = q.toLowerCase().trim();
    return hosts.filter((h) => {
      if (statusFilter && h.status !== statusFilter) return false;
      if (classFilter) {
        if (classFilter.startsWith("group:")) {
          const preset = CLASS_PRESETS.find((p) => p.filter === classFilter);
          if (preset && !preset.match.includes(h.classification ?? "")) return false;
        } else if (h.classification !== classFilter) {
          return false;
        }
      }
      if (networkFilter && h.network_name !== networkFilter) return false;
      if (vulnFilter === "critical_high" && !(h.vuln && (h.vuln.critical > 0 || h.vuln.high > 0))) return false;
      if (vulnFilter === "critical" && !(h.vuln && h.vuln.critical > 0)) return false;
      if (vulnFilter === "with_findings" && !(h.vuln && h.vuln.total > 0)) return false;
      if (lower) {
        const hay = [h.ip, h.mac, displayName(h), h.vendor, h.network_name, h.network_cidr, h.notes, h.os_info, h.device_manufacturer].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(lower)) return false;
      }
      return true;
    });
  }, [hosts, q, statusFilter, classFilter, networkFilter, vulnFilter]);

  // ---------- sort ----------
  const sortAccessors = useMemo(() => ({
    ip:                  (h: EnrichedHost) => h.ip,
    hostname:            (h: EnrichedHost) => displayName(h),
    status:              (h: EnrichedHost) => h.status,
    mac:                 (h: EnrichedHost) => h.mac ?? "",
    vendor:              (h: EnrichedHost) => h.vendor ?? "",
    classification:      (h: EnrichedHost) => h.classification,
    known_host:          (h: EnrichedHost) => h.known_host,
    ip_assignment:       (h: EnrichedHost) => h.ip_assignment,
    notes:               (h: EnrichedHost) => h.notes,
    network_name:        (h: EnrichedHost) => h.network_name,
    vlan_id:             (h: EnrichedHost) => h.vlan_id ?? 0,
    location:            (h: EnrichedHost) => h.location,
    device_name:         (h: EnrichedHost) => h.device_name ?? "",
    switch_port:         (h: EnrichedHost) => h.switch_port ?? "",
    ad_dns:              (h: EnrichedHost) => h.ad_dns_host_name ?? "",
    os_info:             (h: EnrichedHost) => h.os_info ?? "",
    open_ports:          (h: EnrichedHost) => h.open_ports ?? "",
    response_time:       (h: EnrichedHost) => h.last_response_time_ms ?? 0,
    device_manufacturer: (h: EnrichedHost) => getManufacturer(h).text,
    model:               (h: EnrichedHost) => h.model ?? "",
    serial_number:       (h: EnrichedHost) => h.serial_number ?? "",
    firmware:            (h: EnrichedHost) => h.firmware ?? "",
    last_seen:           (h: EnrichedHost) => h.last_seen ? new Date(h.last_seen).getTime() : 0,
    first_seen:          (h: EnrichedHost) => h.first_seen ? new Date(h.first_seen).getTime() : 0,
    fp_confidence:       (h: EnrichedHost) => getFpConfidence(h),
    validated_creds:     (h: EnrichedHost) => (h.validated_protocols || []).length,
    detected:            (h: EnrichedHost) => { const d = parseDetectedDeviceFromDetectionJson(h.detection_json); return d?.label ?? ""; },
    multihomed:          (h: EnrichedHost) => h.multihomed ? h.multihomed.peers.length + 1 : 0,
    open_ports_tcp:      (h: EnrichedHost) => parsePortsByProtocol(h.open_ports, "tcp"),
    open_ports_udp:      (h: EnrichedHost) => parsePortsByProtocol(h.open_ports, "udp"),
    in_ad:               (h: EnrichedHost) => h.ad_dns_host_name ? 1 : 0,
    vuln_max_severity:   (h: EnrichedHost) => {
      const rank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3, Log: 4 };
      return h.vuln ? (rank[h.vuln.max_severity] ?? 9) : 99;
    },
    vuln_counts:         (h: EnrichedHost) => h.vuln ? (h.vuln.critical * 1000 + h.vuln.high) : -1,
  }), []);

  const { sortedRows, sortColumn, sortDirection, onSort } = useClientTableSort(
    filtered, sortAccessors, "ip", "asc",
  );

  // ---------- pagination ----------
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safeP = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => sortedRows.slice((safeP - 1) * PAGE_SIZE, safeP * PAGE_SIZE),
    [sortedRows, safeP],
  );

  // reset page on filter change
  useEffect(() => { setPage(1); }, [q, statusFilter, classFilter, networkFilter]);

  // ---------- selection helpers ----------
  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllPage() {
    const pageIds = pagedRows.map((h) => h.id);
    const allSelected = pageIds.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) next.add(id);
        return next;
      });
    }
  }

  // ---------- bulk edit ----------
  async function handleBulkAddToDevices() {
    if (selectedIds.size === 0) return;
    setAddDevicesSaving(true);
    try {
      const body: Record<string, unknown> = {
        host_ids: Array.from(selectedIds),
        classification: addClassification,
        vendor: addVendor,
        protocol: addProtocol,
        scan_target: addScanTarget,
        inherit_host_credentials: true,
      };
      if (addProductProfile) body.product_profile = addProductProfile;
      if (addVendorSubtype) body.vendor_subtype = addVendorSubtype;
      if (addCredentialId && addCredentialId !== "none") body.credential_id = Number(addCredentialId);
      if (addSnmpCredentialId && addSnmpCredentialId !== "none") body.snmp_credential_id = Number(addSnmpCredentialId);
      const res = await fetch("/api/devices/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message ?? `${selectedIds.size} dispositivi creati`);
        setAddDevicesOpen(false);
        setSelectedIds(new Set());
        fetchData();
      } else {
        toast.error(data.error || "Errore nella creazione dispositivi");
      }
    } catch {
      toast.error("Errore di rete");
    } finally {
      setAddDevicesSaving(false);
    }
  }

  function openBulkEdit() {
    setBulkForm(emptyBulkForm());
    setBulkEditOpen(true);
  }

  function updateBulkField<K extends keyof DiscoveryBulkForm>(key: K, patch: Partial<BulkField<unknown>>) {
    setBulkForm((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  /**
   * Bulk "Aggiorna selezionati": cicla sui device promossi e per ciascuno esegue
   * /query + (se vendor=windows|linux) /software-scan. Sequenziale per non
   * sovraccaricare la rete cliente. Mostra progress incrementale via toast.
   */
  async function handleBulkUpdateAll() {
    if (selectedIds.size === 0) return;
    const targets = hosts.filter((h) => selectedIds.has(h.id) && h.device_id);
    if (targets.length === 0) {
      toast.error("Nessuno degli host selezionati è promosso a device. Usa 'Aggiungi a dispositivi' prima.");
      return;
    }
    const skipped = selectedIds.size - targets.length;
    if (skipped > 0) {
      toast.info(`${skipped} host senza device linkato verranno saltati`);
    }
    setBulkScanRunning(true);
    const results: typeof bulkScanResults = [];
    for (let i = 0; i < targets.length; i++) {
      const h = targets[i];
      const row: (typeof results)[number] = {
        host_id: h.id,
        ip: h.ip,
        name: displayName(h) || h.ip,
        query_status: "skipped",
        query_message: "",
        software_status: "not-applicable",
        software_message: "",
      };
      setBulkScanProgress({ current: i + 1, total: targets.length, label: `${h.ip} — query` });
      // Query
      try {
        const qr = await fetch(`/api/devices/${h.device_id}/query`, { method: "POST" });
        const qd = (await qr.json()) as { id?: string; progress?: unknown; error?: string; message?: string };
        if (!qr.ok) {
          row.query_status = "error";
          row.query_message = qd.error ?? `HTTP ${qr.status}`;
        } else if (qd.id) {
          // polling fino a completion
          const finalPhase = await new Promise<{ status: string; phase: string }>((resolve) => {
            const poll = setInterval(async () => {
              try {
                const pr = await fetch(`/api/scans/progress/${qd.id}`);
                if (!pr.ok) return;
                const pd = (await pr.json()) as { status: string; phase: string };
                if (pd.status === "completed" || pd.status === "failed") {
                  clearInterval(poll);
                  resolve(pd);
                }
              } catch { /* ignore */ }
            }, 1500);
          });
          if (finalPhase.status === "completed") {
            row.query_status = "ok";
            row.query_message = finalPhase.phase || "completato";
          } else {
            row.query_status = "error";
            row.query_message = finalPhase.phase || "scansione fallita";
          }
        } else {
          // Risposta sincrona (Proxmox/legacy)
          row.query_status = "ok";
          row.query_message = qd.message ?? "completato";
        }
      } catch (e) {
        row.query_status = "error";
        row.query_message = e instanceof Error ? e.message : String(e);
      }
      // Software scan se vendor=windows|linux
      if (h.device_vendor === "windows" || h.device_vendor === "linux") {
        setBulkScanProgress({ current: i + 1, total: targets.length, label: `${h.ip} — software` });
        try {
          const sr = await fetch(`/api/devices/${h.device_id}/software-scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          const sd = (await sr.json()) as {
            status?: string;
            appsCount?: number;
            errorMessage?: string;
            error?: string;
          };
          if (sr.ok && sd.status === "ok") {
            row.software_status = "ok";
            row.software_message = `${sd.appsCount ?? 0} applicazioni`;
          } else {
            row.software_status = "error";
            row.software_message = sd.errorMessage ?? sd.error ?? "scan fallito";
          }
        } catch (e) {
          row.software_status = "error";
          row.software_message = e instanceof Error ? e.message : String(e);
        }
      }
      results.push(row);
    }
    setBulkScanRunning(false);
    setBulkScanProgress(null);
    setBulkScanResults(results);
    setBulkScanResultsOpen(true);
    await fetchData();
  }

  /**
   * Bulk "Crea asset NIS2": chiama /api/inventory/bulk-from-hosts che usa
   * ensureInventoryAssetForHost (idempotente, skip se asset esiste).
   */
  async function handleBulkCreateAssets() {
    if (selectedIds.size === 0) return;
    if (!confirm(`Creare/aggiornare asset NIS2 per ${selectedIds.size} host selezionati?`)) return;
    setBulkAssetRunning(true);
    try {
      const r = await fetch("/api/inventory/bulk-from-hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host_ids: Array.from(selectedIds) }),
      });
      const data = (await r.json()) as { message?: string; error?: string };
      if (r.ok) {
        toast.success(data.message ?? "Asset NIS2 aggiornati");
        await fetchData();
        setSelectedIds(new Set());
      } else {
        toast.error(data.error ?? "Errore creazione asset");
      }
    } finally {
      setBulkAssetRunning(false);
    }
  }

  async function handleBulkSave() {
    const payload: Record<string, unknown> = {
      host_ids: Array.from(selectedIds),
    };

    let hasField = false;
    // Campi su `hosts`
    for (const key of ["classification", "device_manufacturer", "ip_assignment", "known_host", "notes"] as const) {
      const field = bulkForm[key];
      if (field.enabled) {
        payload[key] = field.value;
        hasField = true;
      }
    }
    // Credenziali (credential_protocol e credential_port seguono credential_id)
    if (bulkForm.credential_id.enabled && bulkForm.credential_id.value != null && bulkForm.credential_id.value > 0) {
      payload.credential_id = bulkForm.credential_id.value;
      payload.credential_protocol = bulkForm.credential_protocol.value;
      payload.credential_port = bulkForm.credential_port.value;
      hasField = true;
    }
    // Campi su `network_devices` (applicati solo a host già promossi a device)
    for (const key of ["device_type", "vendor", "scan_target"] as const) {
      const field = bulkForm[key];
      if (field.enabled && field.value) {
        payload[key] = field.value;
        hasField = true;
      }
    }
    // Campi su `inventory_assets` (applicati solo a host con asset linkato)
    for (const key of ["asset_categoria_nis2", "asset_criticita_nis2"] as const) {
      const field = bulkForm[key];
      if (field.enabled && field.value) {
        payload[key] = field.value;
        hasField = true;
      }
    }

    if (!hasField) {
      toast.error("Abilitare almeno un campo da modificare");
      return;
    }

    setBulkSaving(true);
    try {
      const res = await fetch("/api/hosts/bulk-update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setBulkEditOpen(false);
        setSelectedIds(new Set());
        fetchData();
      } else {
        toast.error(data.error ?? "Errore nell'aggiornamento");
      }
    } catch {
      toast.error("Errore nell'aggiornamento");
    } finally {
      setBulkSaving(false);
    }
  }

  // ---------- column toggle ----------
  const toggleCol = (id: string) => {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveVisibleColumns(next);
      return next;
    });
  };
  const showAll = () => {
    const all = new Set(COLUMNS.map((c) => c.id));
    setVisibleCols(all);
    saveVisibleColumns(all);
  };
  const resetCols = () => {
    const def = new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
    setVisibleCols(def);
    saveVisibleColumns(def);
  };

  const isVisible = (id: string) => visibleCols.has(id);

  // ---------- CSV export ----------
  const exportCsv = () => {
    const visibleDefs = COLUMNS.filter((c) => visibleCols.has(c.id));
    const header = visibleDefs.map((c) => c.label).join(";");
    const rows = sortedRows.map((h) =>
      visibleDefs.map((c) => {
        const v = getCellText(h, c.id);
        return `"${String(v).replace(/"/g, '""')}"`;
      }).join(";"),
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "discovery.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- render helpers ----------
  function getCellText(h: EnrichedHost, colId: string): string {
    switch (colId) {
      case "ip": return h.ip;
      case "hostname": return displayName(h);
      case "status": return h.status;
      case "mac": return h.mac ?? "";
      case "vendor": return h.vendor ?? "";
      case "classification": return h.classification || "";
      case "known_host": return h.known_host ? "Si" : "No";
      case "ip_assignment": return h.ip_assignment;
      case "notes": return h.notes || "";
      case "network_name": return `${h.network_name} (${h.network_cidr})`;
      case "vlan_id": return h.vlan_id != null ? String(h.vlan_id) : "";
      case "location": return h.location || "";
      case "device_name": return h.device_name ?? "";
      case "switch_port": return h.switch_port ?? "";
      case "ad_dns": return h.ad_dns_host_name ?? "";
      case "os_info": return h.os_info ?? "";
      case "open_ports": return parsePorts(h.open_ports);
      case "open_ports_tcp": return parsePortsByProtocol(h.open_ports, "tcp");
      case "open_ports_udp": return parsePortsByProtocol(h.open_ports, "udp");
      case "validated_creds": return (h.validated_protocols ?? []).join(", ");
      case "detected": { const d = parseDetectedDeviceFromDetectionJson(h.detection_json); return d?.label ?? ""; }
      case "multihomed": return h.multihomed ? `${h.multihomed.peers.length + 1} IF` : "";
      case "in_ad": return h.ad_dns_host_name ? "Si" : "No";
      case "response_time": return h.last_response_time_ms != null ? String(h.last_response_time_ms) : "";
      case "device_manufacturer": return getManufacturer(h).text;
      case "model": return h.model ?? "";
      case "serial_number": return h.serial_number ?? "";
      case "firmware": return h.firmware ?? "";
      case "last_seen": return formatDate(h.last_seen);
      case "first_seen": return formatDate(h.first_seen);
      case "fp_confidence": {
        const c = getFpConfidence(h);
        return c > 0 ? `${Math.round(c * 100)}%` : "";
      }
      case "librenms_id": {
        const lnms = librenmsMap.get(`${h.network_id}:${h.ip}`);
        return lnms ? String(lnms.librenms_device_id) : "";
      }
      case "vuln_max_severity": return h.vuln?.max_severity ?? "";
      case "vuln_counts":
        return h.vuln ? `${h.vuln.critical}/${h.vuln.high}` : "";
      case "profilo": {
        // Score per sort: numero di "promozioni" raggiunte (discovery=1, +device=2, +asset=4 → max 7)
        let score = 1;
        if (h.device_id) score += 2;
        if (h.asset_id) score += 4;
        return String(score);
      }
      case "asset_tag": return h.asset_tag ?? "";
      case "software_scan":
        return h.last_software_scan_apps != null ? String(h.last_software_scan_apps) : "";
      default: return "";
    }
  }

  function renderCell(h: EnrichedHost, colId: string) {
    switch (colId) {
      case "ip":
        return (
          <Link href={`/objects/${h.id}`} className="font-mono text-sm text-primary hover:underline inline-flex items-center gap-1">
            {h.ip} <ExternalLink className="h-3 w-3 opacity-50" />
          </Link>
        );
      case "hostname":
        return <span className="font-medium truncate max-w-[200px] block" title={displayName(h)}>{displayName(h) || "—"}</span>;
      case "status":
        return <StatusBadge status={h.status} lastSeen={h.last_seen} />;
      case "mac":
        return <span className="font-mono text-xs">{h.mac ?? "—"}</span>;
      case "vendor":
        return <span className="text-sm text-muted-foreground truncate max-w-[140px] block" title={h.vendor ?? ""}>{h.vendor ?? "—"}</span>;
      case "classification":
        return h.classification && h.classification !== "unknown"
          ? <Badge variant="outline" className="text-xs">{h.classification}</Badge>
          : <span className="text-muted-foreground text-xs">—</span>;
      case "known_host":
        return h.known_host
          ? <span title="Configurazione manuale: non aggiornata automaticamente dagli scan" className="inline-flex items-center justify-center text-primary"><Lock className="h-3.5 w-3.5" /></span>
          : <span className="text-muted-foreground text-xs">—</span>;
      case "ip_assignment": {
        const labels: Record<string, string> = { dynamic: "DHCP", static: "Statico", reserved: "Riservato", unknown: "—" };
        const colors: Record<string, string> = { dynamic: "bg-blue-500/10 text-blue-600 border-blue-300/40", static: "bg-amber-500/10 text-amber-600 border-amber-300/40", reserved: "bg-purple-500/10 text-purple-600 border-purple-300/40" };
        return h.ip_assignment !== "unknown"
          ? <Badge variant="outline" className={`text-xs ${colors[h.ip_assignment] ?? ""}`}>{labels[h.ip_assignment] ?? h.ip_assignment}</Badge>
          : <span className="text-muted-foreground text-xs">—</span>;
      }
      case "notes":
        return <span className="text-xs text-muted-foreground truncate max-w-[150px] block" title={h.notes}>{h.notes || "—"}</span>;
      case "network_name":
        return <span className="text-sm" title={h.network_cidr}>{h.network_name}</span>;
      case "vlan_id":
        return <span className="text-sm">{h.vlan_id != null ? h.vlan_id : "—"}</span>;
      case "location":
        return <span className="text-sm">{h.location || "—"}</span>;
      case "device_name":
        return h.device_id
          ? (
            <Link
              href={`/devices/${h.device_id}`}
              title={h.device_name ?? "Apri dispositivo"}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <Badge variant="outline" className="text-xs gap-1 px-1.5 py-0 border-primary/40 text-primary">
                <Server className="h-3 w-3" />
                <ExternalLink className="h-3 w-3" />
              </Badge>
            </Link>
          )
          : <span className="text-muted-foreground text-xs">—</span>;
      case "switch_port":
        return h.switch_port
          ? <span className="text-xs font-mono" title={h.switch_device_name ? `${h.switch_device_name} ${h.switch_port}` : h.switch_port}>{h.switch_port}</span>
          : <span className="text-muted-foreground text-xs">—</span>;
      case "ad_dns":
        return h.ad_dns_host_name
          ? <Badge variant="outline" className="text-xs bg-indigo-500/10 text-indigo-600 border-indigo-300/40">AD</Badge>
          : <span className="text-muted-foreground text-xs">—</span>;
      case "os_info":
        return <span className="text-xs truncate max-w-[150px] block" title={h.os_info ?? ""}>{h.os_info ?? "—"}</span>;
      case "open_ports": {
        const txt = parsePorts(h.open_ports);
        return <span className="text-xs font-mono truncate max-w-[180px] block" title={txt}>{txt || "—"}</span>;
      }
      case "response_time":
        return h.last_response_time_ms != null
          ? <span className="text-xs font-mono">{h.last_response_time_ms} ms</span>
          : <span className="text-muted-foreground text-xs">—</span>;
      case "device_manufacturer": {
        const mfr = getManufacturer(h);
        return mfr.text
          ? <span className={`text-sm ${mfr.fromVendor ? "text-muted-foreground italic" : ""}`} title={mfr.fromVendor ? "Da MAC vendor" : ""}>{mfr.text}</span>
          : <span className="text-muted-foreground text-xs">—</span>;
      }
      case "model":
        return <span className="text-sm">{h.model ?? "—"}</span>;
      case "serial_number":
        return <span className="text-xs font-mono">{h.serial_number ?? "—"}</span>;
      case "firmware":
        return <span className="text-xs">{h.firmware ?? "—"}</span>;
      case "last_seen":
        return <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(h.last_seen)}</span>;
      case "first_seen":
        return <span className="text-xs text-muted-foreground whitespace-nowrap">{formatDate(h.first_seen)}</span>;
      case "fp_confidence": {
        const conf = getFpConfidence(h);
        const device = getFpDevice(h);
        return conf > 0
          ? (
            <span className="inline-flex items-center gap-1">
              <FingerprintConfidenceBadge confidence={conf} deviceLabel={device} />
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0"
                title="Crea regola da fingerprint"
                onClick={(e) => { e.stopPropagation(); openCreateRule(h); }}
              >
                <Sparkles className="h-3 w-3" />
              </Button>
            </span>
          )
          : <span className="text-muted-foreground text-xs">—</span>;
      }
      case "librenms_id": {
        const lnms = librenmsMap.get(`${h.network_id}:${h.ip}`);
        const isAdding = librenmsAdding.has(h.id);
        if (lnms) {
          const deviceLink = librenmsUrl ? `${librenmsUrl}/device/device=${lnms.librenms_device_id}/` : null;
          return (
            <span className="inline-flex items-center gap-1">
              <Activity className="h-3 w-3 text-success shrink-0" />
              {deviceLink ? (
                <a
                  href={deviceLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                  title="Apri in LibreNMS"
                >
                  <Badge variant="outline" className="font-mono text-xs">
                    #{lnms.librenms_device_id}
                  </Badge>
                  <ExternalLink className="h-3 w-3 opacity-50" />
                </a>
              ) : (
                <Badge variant="outline" className="font-mono text-xs">
                  #{lnms.librenms_device_id}
                </Badge>
              )}
            </span>
          );
        }
        return (
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs gap-1"
            disabled={isAdding}
            onClick={(e) => { e.stopPropagation(); addHostToLibreNMS(h); }}
            title={h.snmp_data ? "Aggiungi a LibreNMS con SNMP" : "Aggiungi a LibreNMS (ping-only, senza SNMP)"}
          >
            {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlusCircle className="h-3 w-3" />}
            LibreNMS
          </Button>
        );
      }
      case "validated_creds":
        return <ProtocolBadges protocols={h.validated_protocols || []} />;
      case "detected": {
        const det = parseDetectedDeviceFromDetectionJson(h.detection_json);
        if (!det) return <span className="text-muted-foreground text-xs">—</span>;
        const pct = det.confidence != null ? `${Math.round(det.confidence * 100)}%` : null;
        return (
          <span className="text-sm truncate max-w-[180px] block" title={pct ? `Confidenza: ${pct}` : "Fingerprint"}>
            {det.label}
            {pct ? <span className="text-muted-foreground text-xs ml-1">({pct})</span> : null}
          </span>
        );
      }
      case "multihomed":
        return h.multihomed ? (
          <Badge variant="outline" className="text-[10px] px-1 py-0 bg-cyan-500/15 text-cyan-600 border-cyan-300 dark:text-cyan-400">
            {h.multihomed.peers.length + 1} IF
          </Badge>
        ) : <span className="text-muted-foreground text-xs">—</span>;
      case "open_ports_tcp": {
        const txt = parsePortsByProtocol(h.open_ports, "tcp");
        return txt ? <span className="font-mono text-xs truncate max-w-[180px] block" title={txt}>{txt}</span> : <span className="text-muted-foreground text-xs">—</span>;
      }
      case "open_ports_udp": {
        const txt = parsePortsByProtocol(h.open_ports, "udp");
        return txt ? <span className="font-mono text-xs truncate max-w-[180px] block" title={txt}>{txt}</span> : <span className="text-muted-foreground text-xs">—</span>;
      }
      case "in_ad":
        return h.ad_dns_host_name
          ? <Badge className="bg-blue-500/15 text-blue-700 border-blue-300/40 dark:text-blue-400 text-xs">Si</Badge>
          : <span className="text-muted-foreground text-xs">No</span>;
      case "vuln_max_severity": {
        if (!h.vuln) return <span className="text-muted-foreground text-xs">—</span>;
        const sev = h.vuln.max_severity;
        const styles: Record<string, string> = {
          Critical: "bg-red-600 text-white border-red-700",
          High: "bg-orange-500 text-white border-orange-600",
          Medium: "bg-yellow-500 text-black border-yellow-600",
          Low: "bg-blue-500 text-white border-blue-600",
          Log: "bg-muted text-muted-foreground",
        };
        return (
          <Link href={`/hosts/${h.id}`} className="inline-block">
            <Badge className={`text-xs ${styles[sev] ?? ""}`} title={`${h.vuln.total} findings totali`}>
              {sev}
            </Badge>
          </Link>
        );
      }
      case "vuln_counts": {
        if (!h.vuln) return <span className="text-muted-foreground text-xs">—</span>;
        const { critical, high, medium } = h.vuln;
        if (critical === 0 && high === 0 && medium === 0)
          return <span className="text-muted-foreground text-xs">—</span>;
        const sep = <span className="text-muted-foreground">/</span>;
        return (
          <span className="text-xs font-mono whitespace-nowrap" title="Critical / High / Medium">
            <span className={critical > 0 ? "text-red-600 font-semibold" : "text-muted-foreground"}>{critical}</span>
            {sep}
            <span className={high > 0 ? "text-orange-600 font-semibold" : "text-muted-foreground"}>{high}</span>
            {sep}
            <span className={medium > 0 ? "text-yellow-600 font-semibold" : "text-muted-foreground"}>{medium}</span>
          </span>
        );
      }
      case "profilo": {
        // Stati di evoluzione cumulativi: Discovery (sempre), Managed (network_device), Asset (inventory_asset).
        const isManaged = !!h.device_id;
        const isAsset = !!h.asset_id;
        const titleParts = ["Rilevato (Discovery)"];
        if (isManaged) titleParts.push(`Gestito → ${h.device_name}`);
        if (isAsset) titleParts.push(`Asset${h.asset_tag ? ` ${h.asset_tag}` : ""}`);
        return (
          <span className="inline-flex items-center gap-1" title={titleParts.join(" • ")}>
            <Boxes className="h-3.5 w-3.5 text-muted-foreground" aria-label="Discovery" />
            <Wrench
              className={`h-3.5 w-3.5 ${isManaged ? "text-blue-600" : "text-muted-foreground/30"}`}
              aria-label={isManaged ? "Gestito" : "Non gestito"}
            />
            <Package
              className={`h-3.5 w-3.5 ${isAsset ? "text-emerald-600" : "text-muted-foreground/30"}`}
              aria-label={isAsset ? "Asset registrato" : "Non in inventario asset"}
            />
          </span>
        );
      }
      case "asset_tag":
        return h.asset_id ? (
          <Link
            href={`/inventory/${h.asset_id}`}
            className="font-mono text-xs text-primary hover:underline"
            title={h.asset_categoria ?? ""}
          >
            {h.asset_tag ?? `#${h.asset_id}`}
          </Link>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        );
      case "software_scan":
        if (!h.last_software_scan_id || h.last_software_scan_apps == null) {
          return <span className="text-muted-foreground text-xs">—</span>;
        }
        return (
          <span className="text-xs whitespace-nowrap" title={h.last_software_scan_at ?? ""}>
            {h.last_software_scan_apps} app
          </span>
        );
      default:
        return null;
    }
  }

  // ---------- counts ----------
  const online = filtered.filter((h) => h.status === "online").length;
  const offline = filtered.filter((h) => h.status === "offline").length;
  const unknown = filtered.length - online - offline;

  const pageAllSelected = pagedRows.length > 0 && pagedRows.every((h) => selectedIds.has(h.id));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Discovery</h1>
        <p className="text-muted-foreground mt-1">
          Vista unificata di tutti gli host rilevati nelle subnet, arricchiti con dati di scansione.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="py-3 px-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Totale</p>
          <p className="text-2xl font-bold">{filtered.length}</p>
        </Card>
        <Card className="py-3 px-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Online</p>
          <p className="text-2xl font-bold text-success">{online}</p>
        </Card>
        <Card className="py-3 px-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Offline</p>
          <p className="text-2xl font-bold text-destructive">{offline}</p>
        </Card>
        <Card className="py-3 px-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Sconosciuto</p>
          <p className="text-2xl font-bold text-muted-foreground">{unknown}</p>
        </Card>
      </div>

      {/* Main table card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Radar className="h-5 w-5" />
              Host rilevati
              <span className="text-sm font-normal text-muted-foreground ml-1">
                ({filtered.length}{filtered.length !== hosts.length ? ` / ${hosts.length}` : ""})
              </span>
            </CardTitle>

            <div className="flex flex-wrap gap-2 items-center">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca IP, MAC, nome..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-8 w-48 sm:w-56"
                />
              </div>

              {/* Status filter */}
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "")}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Stato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutti</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="unknown">Sconosciuto</SelectItem>
                </SelectContent>
              </Select>

              {/* Classification filter */}
              <Select value={classFilter} onValueChange={(v) => setClassFilter(v ?? "")}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Classificazione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutte</SelectItem>
                  {classifications.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Network filter */}
              <Select value={networkFilter} onValueChange={(v) => setNetworkFilter(v ?? "")}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Subnet" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutte le subnet</SelectItem>
                  {networks.map(([name, cidr]) => (
                    <SelectItem key={name} value={name}>{name} ({cidr})</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Vulnerability filter */}
              <Select value={vulnFilter} onValueChange={(v) => setVulnFilter((v ?? "") as "" | "critical_high" | "critical" | "with_findings")}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Vulnerabilità" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutti gli host</SelectItem>
                  <SelectItem value="critical">Con CVE Critical</SelectItem>
                  <SelectItem value="critical_high">Con CVE Critical o High</SelectItem>
                  <SelectItem value="with_findings">Con qualsiasi finding</SelectItem>
                </SelectContent>
              </Select>

              {/* Column picker */}
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button variant="outline" size="icon" title="Colonne visibili">
                    <Columns3 className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 max-h-[420px] overflow-y-auto">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Colonne visibili</DropdownMenuLabel>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <div className="flex gap-1 px-2 pb-1">
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={showAll}>Tutte</Button>
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={resetCols}>Predefinite</Button>
                  </div>
                  <DropdownMenuSeparator />
                  {Object.entries(GROUP_LABELS).map(([group, label]) => (
                    <DropdownMenuGroup key={group}>
                      <DropdownMenuLabel className="text-[10px] uppercase tracking-wider">{label}</DropdownMenuLabel>
                      {COLUMNS.filter((c) => c.group === group).map((col) => (
                        <DropdownMenuCheckboxItem
                          key={col.id}
                          checked={visibleCols.has(col.id)}
                          onCheckedChange={() => toggleCol(col.id)}
                        >
                          {col.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuGroup>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Export CSV */}
              <Button variant="outline" size="icon" onClick={exportCsv} title="Esporta CSV">
                <Download className="h-4 w-4" />
              </Button>

              {/* Refresh */}
              <Button variant="outline" size="icon" onClick={fetchData} disabled={loading} title="Aggiorna">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Preset chips: filtro rapido per macro-categoria. Cliccando una chip
              attiva imposta classFilter al preset; il dropdown "Classificazione"
              resta utilizzabile per scelte fini. */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Button
              variant={classFilter === "" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setClassFilter("")}
            >
              Tutti
            </Button>
            {CLASS_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const active = classFilter === preset.filter;
              const count = hosts.filter((h) => preset.match.includes(h.classification ?? "")).length;
              return (
                <Button
                  key={preset.filter}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => setClassFilter(active ? "" : preset.filter)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {preset.label}
                  <span className="text-muted-foreground/80">({count})</span>
                </Button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {/* ── Barra selezione ── */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-primary/5 border-b">
              <span className="text-sm font-medium">
                {selectedIds.size} host selezionat{selectedIds.size === 1 ? "o" : "i"}
              </span>
              <Button size="sm" variant="default" className="gap-1.5" onClick={openBulkEdit}>
                <Pencil className="h-3.5 w-3.5" />
                Modifica multipla
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddDevicesOpen(true)}>
                <PackagePlus className="h-3.5 w-3.5" />
                Aggiungi a dispositivi
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleBulkUpdateAll}
                disabled={bulkScanRunning}
                title="Esegue query SNMP/ARP + inventario software sui device gia` promossi"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${bulkScanRunning ? "animate-spin" : ""}`} />
                {bulkScanRunning && bulkScanProgress
                  ? `${bulkScanProgress.current}/${bulkScanProgress.total} · ${bulkScanProgress.label}`
                  : "Aggiorna selezionati"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={handleBulkCreateAssets}
                disabled={bulkAssetRunning}
                title="Crea/aggiorna asset NIS2 per gli host selezionati"
              >
                {bulkAssetRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Boxes className="h-3.5 w-3.5" />}
                Crea asset NIS2
              </Button>
              <Button size="sm" variant="ghost" className="gap-1" onClick={() => setSelectedIds(new Set())}>
                <X className="h-3.5 w-3.5" />
                Deseleziona
              </Button>
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-muted-foreground">Caricamento...</div>
          ) : hosts.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              Nessun host trovato. Esegui una scansione per popolare i dati.
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">
              Nessun risultato per i filtri selezionati.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={pageAllSelected}
                        onCheckedChange={toggleSelectAllPage}
                      />
                    </TableHead>
                    <TableHead className="w-[88px] whitespace-nowrap">Azioni</TableHead>
                    {COLUMNS.filter((c) => isVisible(c.id)).map((col) => (
                      <SortableTableHead
                        key={col.id}
                        columnId={col.id}
                        sortColumn={sortColumn}
                        sortDirection={sortDirection}
                        onSort={onSort}
                        className="whitespace-nowrap"
                      >
                        {col.label}
                      </SortableTableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedRows.map((h) => (
                    <TableRow key={h.id} className={`hover:bg-muted/40 ${selectedIds.has(h.id) ? "bg-primary/5" : ""}`}>
                      <TableCell className="py-2">
                        <Checkbox
                          checked={selectedIds.has(h.id)}
                          onCheckedChange={() => toggleSelect(h.id)}
                        />
                      </TableCell>
                      <TableCell className="py-2">
                        {/* Tier 1: per host promossi a network_device aggiungo
                            Test cred device + Riscansiona device. Le azioni
                            host-level (modifica host, test cred host, elimina
                            host) restano sempre disponibili. */}
                        {(() => {
                          const isDev = h.device_id != null;
                          const busyHere = isDev && rowActionBusy?.id === h.device_id;
                          const label = h.hostname || h.ip;
                          return (
                            <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                              <Link
                                href={isDev ? `/devices/${h.device_id}` : `/hosts/${h.id}`}
                                title={isDev ? "Modifica dispositivo" : "Modifica host"}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Link>
                              {isDev && (
                                <>
                                  <button
                                    type="button"
                                    title="Testa credenziali device"
                                    disabled={busyHere}
                                    onClick={() => handleRowTestCred(h.device_id!)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                  >
                                    <ShieldCheck className={`h-3.5 w-3.5 ${rowActionBusy?.kind === "test" && busyHere ? "animate-pulse" : ""}`} />
                                  </button>
                                  <button
                                    type="button"
                                    title="Riscansiona dispositivo (query SNMP/SSH/API)"
                                    disabled={busyHere}
                                    onClick={() => handleRowRescan(h.device_id!)}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                  >
                                    <RefreshCw className={`h-3.5 w-3.5 ${rowActionBusy?.kind === "query" && busyHere ? "animate-spin" : ""}`} />
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                title="Test credenziali su questo host (probe diretto)"
                                onClick={() => openTestForRow(h)}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </button>
                              {isDev ? (
                                <button
                                  type="button"
                                  title="Elimina dispositivo (l'host resta in DB)"
                                  disabled={busyHere}
                                  onClick={() => handleRowDeleteDevice(h.device_id!, label)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  title="Elimina host"
                                  onClick={() => setDeleteHostRow(h)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </TableCell>
                      {COLUMNS.filter((c) => isVisible(c.id)).map((col) => (
                        <TableCell key={col.id} className="py-2">
                          {renderCell(h, col.id)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Pagination page={safeP} totalPages={totalPages} onPageChange={setPage} />

      {/* ════════════════ DIALOG MODIFICA MULTIPLA HOST ════════════════ */}
      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className={`${DIALOG_PANEL_WIDE_CLASS} border-2 border-primary/30 shadow-2xl`}>
          <DialogHeader className="shrink-0 border-b border-border px-5 pt-5 pb-3 bg-muted/30">
            <DialogTitle className="text-lg flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              Modifica {selectedIds.size} host{selectedIds.size === 1 ? "" : ""}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Solo i campi <strong className="text-primary">attivi</strong> (riquadrati in blu) saranno applicati ai {selectedIds.size} host selezionati. Spunta la casella per attivare un campo.
            </p>
          </DialogHeader>
          <DialogScrollableArea className="max-h-[70vh] px-5 py-4">
            <div className="space-y-5">
              {/* ═══ Sezione 1: Campi host ═══ */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="h-5 w-1 bg-primary rounded-full" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider">Campi sull&apos;host</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">

              {/* Classificazione */}
              <BulkFieldRow
                label="Classificazione"
                enabled={bulkForm.classification.enabled}
                onToggle={(v) => updateBulkField("classification", { enabled: v })}
              >
                <Select
                  value={bulkForm.classification.value || "__empty__"}
                  onValueChange={(v) => updateBulkField("classification", { value: v === "__empty__" ? "" : (v ?? "") })}
                  disabled={!bulkForm.classification.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Seleziona —</SelectItem>
                    {SORTED_CLASSIFICATIONS.map((c) => (
                      <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BulkFieldRow>

              {/* Produttore */}
              <BulkFieldRow
                label="Produttore"
                enabled={bulkForm.device_manufacturer.enabled}
                onToggle={(v) => updateBulkField("device_manufacturer", { enabled: v })}
              >
                <Input
                  value={bulkForm.device_manufacturer.value ?? ""}
                  onChange={(e) => updateBulkField("device_manufacturer", { value: e.target.value || null })}
                  placeholder="Es: HP, Cisco, Ubiquiti..."
                  disabled={!bulkForm.device_manufacturer.enabled}
                />
              </BulkFieldRow>

              {/* Tipo assegnazione IP */}
              <BulkFieldRow
                label="Assegnazione IP"
                enabled={bulkForm.ip_assignment.enabled}
                onToggle={(v) => updateBulkField("ip_assignment", { enabled: v })}
              >
                <Select
                  value={bulkForm.ip_assignment.value}
                  onValueChange={(v) => updateBulkField("ip_assignment", { value: v ?? "static" })}
                  disabled={!bulkForm.ip_assignment.enabled}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="static">Statico</SelectItem>
                    <SelectItem value="dynamic">DHCP</SelectItem>
                    <SelectItem value="reserved">Riservato</SelectItem>
                    <SelectItem value="unknown">Sconosciuto</SelectItem>
                  </SelectContent>
                </Select>
              </BulkFieldRow>

              {/* Conosciuto */}
              <BulkFieldRow
                label="Host conosciuto"
                enabled={bulkForm.known_host.enabled}
                onToggle={(v) => updateBulkField("known_host", { enabled: v })}
              >
                <div className="flex items-center gap-2">
                  <Switch
                    checked={bulkForm.known_host.value === 1}
                    onCheckedChange={(v) => updateBulkField("known_host", { value: v ? 1 : 0 })}
                    disabled={!bulkForm.known_host.enabled}
                  />
                  <span className="text-xs text-muted-foreground">
                    {bulkForm.known_host.value === 1 ? "Si" : "No"}
                  </span>
                </div>
              </BulkFieldRow>

              {/* Note */}
              <BulkFieldRow
                label="Note"
                enabled={bulkForm.notes.enabled}
                onToggle={(v) => updateBulkField("notes", { enabled: v })}
              >
                <Input
                  value={bulkForm.notes.value ?? ""}
                  onChange={(e) => updateBulkField("notes", { value: e.target.value || null })}
                  placeholder="Note da applicare a tutti gli host..."
                  disabled={!bulkForm.notes.enabled}
                />
              </BulkFieldRow>

              {/* Credenziali */}
              <BulkFieldRow
                label="Assegna credenziale"
                enabled={bulkForm.credential_id.enabled}
                onToggle={(v) => updateBulkField("credential_id", { enabled: v })}
              >
                <div className="space-y-2">
                  <Select
                    value={bulkForm.credential_id.value != null ? String(bulkForm.credential_id.value) : "__empty__"}
                    onValueChange={(v) => updateBulkField("credential_id", { value: v === "__empty__" ? null : Number(v) })}
                    disabled={!bulkForm.credential_id.enabled}
                  >
                    <SelectTrigger><SelectValue placeholder="Seleziona credenziale..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__empty__">— Seleziona —</SelectItem>
                      {credentials.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name} ({c.credential_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Label className="text-[10px] text-muted-foreground">Protocollo</Label>
                      <Select
                        value={bulkForm.credential_protocol.value}
                        onValueChange={(v) => {
                          const port = v === "snmp" ? 161 : v === "winrm" ? 5985 : v === "api" ? 443 : 22;
                          updateBulkField("credential_protocol", { value: v ?? "ssh" });
                          updateBulkField("credential_port", { value: port });
                        }}
                        disabled={!bulkForm.credential_id.enabled}
                      >
                        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ssh">SSH</SelectItem>
                          <SelectItem value="snmp">SNMP</SelectItem>
                          <SelectItem value="winrm">WinRM</SelectItem>
                          <SelectItem value="api">API</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      <Label className="text-[10px] text-muted-foreground">Porta</Label>
                      <Input
                        type="number" min={1} max={65535}
                        value={bulkForm.credential_port.value}
                        onChange={(e) => updateBulkField("credential_port", { value: Number(e.target.value) || 22 })}
                        className="h-8"
                        disabled={!bulkForm.credential_id.enabled}
                      />
                    </div>
                  </div>
                </div>
              </BulkFieldRow>
                </div>
              </div>

              {/* ═══ Sezione 2: Device gestiti ═══ */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-5 w-1 bg-blue-500 rounded-full" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider">Device gestiti</h3>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2.5 pl-3">
                  Applicato solo agli host gia` promossi a network_device (linkati via IP).
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">

              <BulkFieldRow
                label="Tipologia device"
                enabled={bulkForm.device_type.enabled}
                onToggle={(v) => updateBulkField("device_type", { enabled: v })}
              >
                <Select
                  value={bulkForm.device_type.value || "__empty__"}
                  onValueChange={(v) => updateBulkField("device_type", { value: v === "__empty__" ? "" : v })}
                  disabled={!bulkForm.device_type.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona tipologia..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Seleziona —</SelectItem>
                    <SelectItem value="router">Router</SelectItem>
                    <SelectItem value="switch">Switch</SelectItem>
                    <SelectItem value="firewall">Firewall</SelectItem>
                    <SelectItem value="hypervisor">Hypervisor</SelectItem>
                  </SelectContent>
                </Select>
              </BulkFieldRow>

              <BulkFieldRow
                label="Vendor / Produttore"
                enabled={bulkForm.vendor.enabled}
                onToggle={(v) => updateBulkField("vendor", { enabled: v })}
              >
                <Select
                  value={bulkForm.vendor.value || "__empty__"}
                  onValueChange={(v) => updateBulkField("vendor", { value: v === "__empty__" ? "" : v })}
                  disabled={!bulkForm.vendor.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona vendor..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Seleziona —</SelectItem>
                    <SelectItem value="mikrotik">Mikrotik</SelectItem>
                    <SelectItem value="ubiquiti">Ubiquiti</SelectItem>
                    <SelectItem value="hp">HP</SelectItem>
                    <SelectItem value="cisco">Cisco</SelectItem>
                    <SelectItem value="omada">Omada</SelectItem>
                    <SelectItem value="stormshield">Stormshield</SelectItem>
                    <SelectItem value="proxmox">Proxmox</SelectItem>
                    <SelectItem value="vmware">VMware</SelectItem>
                    <SelectItem value="linux">Linux</SelectItem>
                    <SelectItem value="windows">Windows</SelectItem>
                    <SelectItem value="synology">Synology</SelectItem>
                    <SelectItem value="qnap">QNAP</SelectItem>
                    <SelectItem value="other">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </BulkFieldRow>

              <BulkFieldRow
                label="Target scan"
                enabled={bulkForm.scan_target.enabled}
                onToggle={(v) => updateBulkField("scan_target", { enabled: v })}
              >
                <Select
                  value={bulkForm.scan_target.value || "__empty__"}
                  onValueChange={(v) => updateBulkField("scan_target", { value: v === "__empty__" ? "" : v })}
                  disabled={!bulkForm.scan_target.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona target..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Seleziona —</SelectItem>
                    <SelectItem value="windows">Windows</SelectItem>
                    <SelectItem value="linux">Linux</SelectItem>
                    <SelectItem value="proxmox">Proxmox</SelectItem>
                    <SelectItem value="vmware">VMware</SelectItem>
                  </SelectContent>
                </Select>
              </BulkFieldRow>
                </div>
              </div>

              {/* ═══ Sezione 3: Asset NIS2 ═══ */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-5 w-1 bg-emerald-500 rounded-full" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider">Asset NIS2</h3>
                </div>
                <p className="text-[10px] text-muted-foreground mb-2.5 pl-3">
                  Applicato solo agli host con un inventory_asset linkato.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">

              <BulkFieldRow
                label="Categoria NIS2"
                enabled={bulkForm.asset_categoria_nis2.enabled}
                onToggle={(v) => updateBulkField("asset_categoria_nis2", { enabled: v })}
              >
                <Select
                  value={bulkForm.asset_categoria_nis2.value || "__empty__"}
                  onValueChange={(v) => updateBulkField("asset_categoria_nis2", { value: v === "__empty__" ? "" : v })}
                  disabled={!bulkForm.asset_categoria_nis2.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona categoria..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Seleziona —</SelectItem>
                    <SelectItem value="server_dominio">Server di dominio</SelectItem>
                    <SelectItem value="server_applicativo">Server applicativo</SelectItem>
                    <SelectItem value="server_database">Server database</SelectItem>
                    <SelectItem value="server_backup">Server backup</SelectItem>
                    <SelectItem value="server_file">File server</SelectItem>
                    <SelectItem value="server_email">Server email</SelectItem>
                    <SelectItem value="endpoint_critico">Endpoint critico</SelectItem>
                    <SelectItem value="apparato_di_rete">Apparato di rete</SelectItem>
                    <SelectItem value="dispositivo_sicurezza">Dispositivo di sicurezza</SelectItem>
                    <SelectItem value="altro">Altro</SelectItem>
                  </SelectContent>
                </Select>
              </BulkFieldRow>

              <BulkFieldRow
                label="Criticità NIS2"
                enabled={bulkForm.asset_criticita_nis2.enabled}
                onToggle={(v) => updateBulkField("asset_criticita_nis2", { enabled: v })}
              >
                <Select
                  value={bulkForm.asset_criticita_nis2.value || "__empty__"}
                  onValueChange={(v) => updateBulkField("asset_criticita_nis2", { value: v === "__empty__" ? "" : v })}
                  disabled={!bulkForm.asset_criticita_nis2.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona criticità..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Seleziona —</SelectItem>
                    <SelectItem value="critica">Critica</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="bassa">Bassa</SelectItem>
                  </SelectContent>
                </Select>
              </BulkFieldRow>
                </div>
              </div>
            </div>
          </DialogScrollableArea>
          <DialogFooter className="border-t border-border px-5 py-3 bg-muted/30">
            <Button variant="outline" onClick={() => setBulkEditOpen(false)} disabled={bulkSaving}>
              Annulla
            </Button>
            <Button onClick={handleBulkSave} disabled={bulkSaving} className="gap-2">
              {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Applica a {selectedIds.size} host
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════ DIALOG RIEPILOGO BULK SCAN ════════════════ */}
      <Dialog open={bulkScanResultsOpen} onOpenChange={setBulkScanResultsOpen}>
        <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
          <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
            <DialogTitle>Riepilogo aggiornamento bulk</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {bulkScanResults.length} host processati ·{" "}
              <span className="text-emerald-600 font-medium">
                {bulkScanResults.filter((r) => r.query_status === "ok").length} query OK
              </span>{" "}·{" "}
              <span className="text-red-600 font-medium">
                {bulkScanResults.filter((r) => r.query_status === "error").length} query errore
              </span>{" "}·{" "}
              <span className="text-blue-600 font-medium">
                {bulkScanResults.filter((r) => r.software_status === "ok").length} software OK
              </span>{" "}·{" "}
              <span className="text-amber-600 font-medium">
                {bulkScanResults.filter((r) => r.software_status === "error").length} software errore
              </span>
            </p>
          </DialogHeader>
          <DialogScrollableArea>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead>Software</TableHead>
                  <TableHead>Dettaglio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bulkScanResults.map((r) => (
                  <TableRow key={r.host_id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/hosts/${r.host_id}`} className="text-primary hover:underline">
                        {r.ip}
                      </Link>
                      <div className="text-[10px] text-muted-foreground">{r.name}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        r.query_status === "ok"
                          ? "border-emerald-400 text-emerald-700 bg-emerald-50"
                          : r.query_status === "error"
                            ? "border-red-400 text-red-700 bg-red-50"
                            : "border-muted text-muted-foreground"
                      }>
                        {r.query_status === "ok" ? "OK" : r.query_status === "error" ? "Errore" : "Skip"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        r.software_status === "ok"
                          ? "border-blue-400 text-blue-700 bg-blue-50"
                          : r.software_status === "error"
                            ? "border-amber-400 text-amber-700 bg-amber-50"
                            : "border-muted text-muted-foreground"
                      }>
                        {r.software_status === "ok" ? "OK"
                          : r.software_status === "error" ? "Errore"
                            : r.software_status === "not-applicable" ? "n/a" : "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-md">
                      {r.query_status === "error" && (
                        <div className="text-red-700 break-words">Query: {r.query_message}</div>
                      )}
                      {r.software_status === "error" && (
                        <div className="text-amber-700 break-words mt-0.5">Software: {r.software_message}</div>
                      )}
                      {r.query_status === "ok" && r.software_status === "ok" && (
                        <div className="text-muted-foreground">{r.software_message}</div>
                      )}
                      {r.query_status === "ok" && r.software_status === "not-applicable" && (
                        <div className="text-muted-foreground">{r.query_message}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DialogScrollableArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkScanResultsOpen(false)}>
              Chiudi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════ DIALOG AGGIUNGI A DISPOSITIVI ════════════════ */}
      <Dialog open={addDevicesOpen} onOpenChange={setAddDevicesOpen}>
        <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
          <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5" />
              Aggiungi {selectedIds.size} host a dispositivi
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Promuove gli host selezionati a network device. Imposta profilo, vendor, protocollo e credenziali.
              Le credenziali già validate sull&apos;host verranno comunque ereditate.
            </p>
          </DialogHeader>
          <DialogScrollableArea className="px-4 py-3">
            <div className="space-y-4">
              <DeviceFormFields
                mode="bulk"
                credentials={addCredentials}
                idPrefix="discovery-add-devices"
                showIdentificazione={false}
                showProfilo={true}
                showCredenziali={false}
                classification={addClassification}
                vendor={addVendor}
                vendorSubtype={addVendorSubtype}
                protocol={addProtocol}
                scanTarget={addScanTarget}
                productProfile={addProductProfile}
                credentialId={addCredentialId}
                snmpCredentialId={addSnmpCredentialId}
                useForArpPoll={addUseForArpPoll}
                onClassificationChange={(v) => setAddClassification(v)}
                onVendorChange={(v) => { setAddVendor(v); if (v !== "hp") setAddVendorSubtype(null); }}
                onVendorSubtypeChange={setAddVendorSubtype}
                onProtocolChange={(v) => setAddProtocol(v)}
                onScanTargetChange={setAddScanTarget}
                onCredentialIdChange={setAddCredentialId}
                onSnmpCredentialIdChange={setAddSnmpCredentialId}
                onProductProfileChange={(v) => setAddProductProfile(v)}
                onUseForArpPollChange={setAddUseForArpPoll}
                defaultClassification="server"
                defaultVendor="other"
                defaultProtocol="ssh"
              />

              {(() => {
                const credMap = credTypeForProtocol(addProtocol);
                const primaryOpts = addCredentials.filter((c) => c.credential_type !== "snmp");
                const snmpOpts = addCredentials.filter((c) => c.credential_type === "snmp");
                return (
                  <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-3">
                    <div className="text-sm font-medium">Credenziali</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Credenziale principale</Label>
                        <AddableSelect
                          value={addCredentialId && addCredentialId !== "none" ? Number(addCredentialId) : null}
                          onChange={(v) => setAddCredentialId(v != null ? String(v) : null)}
                          options={primaryOpts.map((c) => ({ id: c.id, label: c.name, extra: c.credential_type }))}
                          entityLabel="credenziale"
                          createApiUrl="/api/credentials"
                          extraFields={[
                            { key: "credential_type", label: "Tipo", type: "select", required: true, defaultValue: credMap.primary, options: CRED_TYPE_OPTIONS },
                            { key: "username", label: "Username", placeholder: "admin" },
                            { key: "password", label: "Password / Community", type: "password", required: true },
                          ]}
                          onCreated={refreshCredentials}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Credenziale SNMP (opzionale)</Label>
                        <AddableSelect
                          value={addSnmpCredentialId && addSnmpCredentialId !== "none" ? Number(addSnmpCredentialId) : null}
                          onChange={(v) => setAddSnmpCredentialId(v != null ? String(v) : null)}
                          options={snmpOpts.map((c) => ({ id: c.id, label: c.name }))}
                          entityLabel="credenziale SNMP"
                          createApiUrl="/api/credentials"
                          extraFields={[
                            { key: "credential_type", label: "Tipo", type: "select", required: true, defaultValue: "snmp", options: [{ value: "snmp", label: "SNMP" }] },
                            { key: "password", label: "Community string", type: "password", required: true, placeholder: "public" },
                          ]}
                          onCreated={refreshCredentials}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground border-t border-border/60 pt-2">
                      Le credenziali validate sugli host saranno ereditate come fallback. Imposta qui per forzare credenziali specifiche.
                    </p>
                  </div>
                );
              })()}
            </div>
          </DialogScrollableArea>
          <DialogFooter className="border-t border-border/50 px-4 py-3">
            <Button variant="ghost" onClick={() => setAddDevicesOpen(false)} disabled={addDevicesSaving}>
              Annulla
            </Button>
            <Button onClick={handleBulkAddToDevices} disabled={addDevicesSaving || selectedIds.size === 0}>
              {addDevicesSaving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Creazione...</> : <><Server className="h-4 w-4 mr-1.5" />Crea {selectedIds.size} dispositivi</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════ DIALOG CREA REGOLA FINGERPRINT ════════════════ */}
      {ruleHost && getRuleFingerprint() && (
        <CreateFingerprintRuleDialog
          open={createRuleOpen}
          onOpenChange={setCreateRuleOpen}
          fingerprint={getRuleFingerprint()!}
          currentClassification={ruleHost.classification}
          hostIp={ruleHost.ip}
          hostname={ruleHost.hostname}
        />
      )}

      {/* ════════════════ DIALOG ELIMINA HOST ════════════════ */}
      <Dialog open={deleteHostRow !== null} onOpenChange={(o) => { if (!o) setDeleteHostRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Elimina host
            </DialogTitle>
          </DialogHeader>
          {deleteHostRow && (
            <div className="space-y-2 text-sm">
              <p>
                Eliminare definitivamente l&apos;host <strong className="font-mono">{deleteHostRow.ip}</strong>
                {displayName(deleteHostRow) && <> (<span className="font-mono">{displayName(deleteHostRow)}</span>)</>}?
              </p>
              <p className="text-xs text-muted-foreground">
                Rimuove anche credenziali associate e binding. Operazione non reversibile.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteHostRow(null)} disabled={deleting}>Annulla</Button>
            <Button variant="destructive" onClick={handleDeleteHost} disabled={deleting}>
              {deleting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Eliminazione...</> : <><Trash2 className="h-4 w-4 mr-1.5" />Elimina</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ════════════════ DIALOG TEST CREDENZIALI SU HOST ════════════════ */}
      <Dialog open={testHostRow !== null} onOpenChange={(o) => { if (!o) setTestHostRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              Test credenziali
            </DialogTitle>
          </DialogHeader>
          {testHostRow && (
            <div className="space-y-3">
              <div className="text-sm">
                Host: <strong className="font-mono">{testHostRow.ip}</strong>
              </div>
              <div>
                <Label className="text-xs">Credenziale</Label>
                <Select
                  value={testRowCredId}
                  onValueChange={(v) => {
                    const val = v ?? "";
                    setTestRowCredId(val);
                    const cred = credentials.find((c) => String(c.id) === val);
                    if (cred) setTestRowPort(defaultPortFor(cred.credential_type));
                  }}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Seleziona credenziale" />
                  </SelectTrigger>
                  <SelectContent>
                    {credentials.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name} <span className="text-muted-foreground text-xs">({c.credential_type})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Porta (opzionale)</Label>
                <Input
                  className="mt-1"
                  value={testRowPort}
                  onChange={(e) => setTestRowPort(e.target.value)}
                  placeholder="es. 22, 161, 5985"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTestHostRow(null)} disabled={testRowRunning}>Annulla</Button>
            <Button onClick={handleTestRowCredential} disabled={testRowRunning || !testRowCredId}>
              {testRowRunning ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Test in corso...</> : <><Activity className="h-4 w-4 mr-1.5" />Esegui test</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Riga campo bulk con checkbox abilita/disabilita + controllo.
 * Quando abilitata mostra accent border + background leggero per evidenziare i
 * campi attivi nel batch. Quando disabilitata mantiene label leggibile (no grigio
 * spento) ma riduce contrasto del controllo. */
function BulkFieldRow({
  label, enabled, onToggle, children, hint,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label
      className={`relative flex items-start gap-3 rounded-lg border p-3 transition-all cursor-pointer ${
        enabled
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "border-border bg-background hover:border-muted-foreground/40"
      }`}
    >
      <div className="pt-0.5 shrink-0">
        <Checkbox checked={enabled} onCheckedChange={onToggle} className={enabled ? "border-primary" : ""} />
      </div>
      <div className={`flex-1 space-y-1 min-w-0 ${enabled ? "" : "opacity-70"}`}>
        <div className="flex items-center gap-2">
          <Label className={`text-xs font-semibold cursor-pointer ${enabled ? "text-foreground" : "text-foreground/80"}`}>{label}</Label>
          {enabled && <Badge variant="outline" className="text-[9px] py-0 border-primary/60 text-primary">attivo</Badge>}
        </div>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
        <div className={enabled ? "" : "pointer-events-none"}>
          {children}
        </div>
      </div>
    </label>
  );
}

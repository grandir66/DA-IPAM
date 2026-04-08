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
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/shared/status-badge";
import { FingerprintConfidenceBadge } from "@/components/shared/fingerprint-confidence-badge";
import { CreateFingerprintRuleDialog } from "@/components/shared/create-fingerprint-rule-dialog";
import { SortableTableHead } from "@/components/shared/sortable-table-head";
import { Pagination } from "@/components/shared/pagination";
import { useClientTableSort } from "@/hooks/use-table-sort";
import {
  DEVICE_CLASSIFICATIONS_ORDERED, getClassificationLabel, sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";
import {
  Search, RefreshCw, Columns3, Download, Radar, ExternalLink,
  Pencil, X, Loader2, Save, PlusCircle, Sparkles,
} from "lucide-react";
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
  { id: "ip",              label: "IP",              defaultVisible: true,  group: "base" },
  { id: "hostname",        label: "Nome",            defaultVisible: true,  group: "base" },
  { id: "status",          label: "Stato",           defaultVisible: true,  group: "base" },
  { id: "mac",             label: "MAC",             defaultVisible: true,  group: "base" },
  { id: "device_manufacturer", label: "Produttore",  defaultVisible: true,  group: "base" },
  { id: "vendor",          label: "Vendor",          defaultVisible: false, group: "base" },
  { id: "classification",  label: "Classificazione", defaultVisible: true,  group: "base" },
  { id: "known_host",      label: "Conosciuto",      defaultVisible: false, group: "base" },
  { id: "ip_assignment",   label: "DHCP",            defaultVisible: false, group: "base" },
  { id: "notes",           label: "Note",            defaultVisible: false, group: "base" },

  // Rete
  { id: "network_name",    label: "Subnet",          defaultVisible: true,  group: "rete" },
  { id: "vlan_id",         label: "VLAN",            defaultVisible: false, group: "rete" },
  { id: "location",        label: "Sede",            defaultVisible: false, group: "rete" },
  { id: "device_name",     label: "Dispositivo",     defaultVisible: false, group: "rete" },
  { id: "switch_port",     label: "Porta switch",    defaultVisible: false, group: "rete" },
  { id: "ad_dns",          label: "AD",              defaultVisible: false, group: "rete" },

  // Rilevamento
  { id: "os_info",         label: "OS",              defaultVisible: false, group: "rilevamento" },
  { id: "open_ports",      label: "Porte aperte",    defaultVisible: false, group: "rilevamento" },
  { id: "response_time",   label: "RTT (ms)",        defaultVisible: false, group: "rilevamento" },
  { id: "fp_confidence",   label: "Conf.",           defaultVisible: false, group: "rilevamento" },

  // Dettaglio
  { id: "model",           label: "Modello",         defaultVisible: false, group: "dettaglio" },
  { id: "serial_number",   label: "Seriale",         defaultVisible: false, group: "dettaglio" },
  { id: "firmware",        label: "Firmware",         defaultVisible: false, group: "dettaglio" },
  { id: "librenms_id",     label: "LibreNMS",         defaultVisible: false, group: "dettaglio" },

  // Temporali
  { id: "last_seen",       label: "Ultimo visto",    defaultVisible: true,  group: "base" },
  { id: "first_seen",      label: "Primo visto",     defaultVisible: false, group: "base" },
];

const GROUP_LABELS: Record<string, string> = {
  base: "Base",
  rete: "Rete",
  rilevamento: "Rilevamento",
  dettaglio: "Dettaglio hardware",
};

const STORAGE_KEY = "discovery-columns";
const PAGE_SIZE = 50;

function loadVisibleColumns(): Set<string> {
  if (typeof window === "undefined") return new Set(COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr) && arr.length > 0) return new Set(arr);
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
  classification: BulkField<string>;
  known_host: BulkField<0 | 1>;
  notes: BulkField<string | null>;
}

function emptyBulkForm(): DiscoveryBulkForm {
  return {
    classification: { enabled: false, value: "" },
    known_host: { enabled: false, value: 1 },
    notes: { enabled: false, value: null },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DiscoveryPage() {
  const [hosts, setHosts] = useState<EnrichedHost[]>([]);
  const [librenmsMap, setLibrenmsMap] = useState<Map<string, LibreNMSHostMap>>(new Map());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [networkFilter, setNetworkFilter] = useState("");
  const [page, setPage] = useState(1);
  const [visibleCols, setVisibleCols] = useState<Set<string>>(loadVisibleColumns);

  // ─── Selezione e bulk edit ────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkForm, setBulkForm] = useState<DiscoveryBulkForm>(emptyBulkForm);

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
      if (classFilter && h.classification !== classFilter) return false;
      if (networkFilter && h.network_name !== networkFilter) return false;
      if (lower) {
        const hay = [h.ip, h.mac, displayName(h), h.vendor, h.network_name, h.network_cidr, h.notes, h.os_info, h.device_manufacturer].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(lower)) return false;
      }
      return true;
    });
  }, [hosts, q, statusFilter, classFilter, networkFilter]);

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

  async function handleBulkSave() {
    const payload: Record<string, unknown> = {
      host_ids: Array.from(selectedIds),
    };

    let hasField = false;
    for (const [key, field] of Object.entries(bulkForm)) {
      if (field.enabled) {
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
      default: return "";
    }
  }

  function renderCell(h: EnrichedHost, colId: string) {
    switch (colId) {
      case "ip":
        return (
          <Link href={`/hosts/${h.id}`} className="font-mono text-sm text-primary hover:underline inline-flex items-center gap-1">
            {h.ip} <ExternalLink className="h-3 w-3 opacity-50" />
          </Link>
        );
      case "hostname":
        return <span className="font-medium truncate max-w-[200px] block" title={displayName(h)}>{displayName(h) || "—"}</span>;
      case "status":
        return <StatusBadge status={h.status} />;
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
          ? <Badge className="bg-success/15 text-success border-success/30 text-xs">Si</Badge>
          : <span className="text-muted-foreground text-xs">No</span>;
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
        return <span className="text-sm">{h.network_name} <span className="text-muted-foreground text-xs">({h.network_cidr})</span></span>;
      case "vlan_id":
        return <span className="text-sm">{h.vlan_id != null ? h.vlan_id : "—"}</span>;
      case "location":
        return <span className="text-sm">{h.location || "—"}</span>;
      case "device_name":
        return h.device_id
          ? <Link href={`/devices/${h.device_id}`} className="text-sm text-primary hover:underline">{h.device_name}</Link>
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
        if (!lnms) return <span className="text-muted-foreground text-xs">—</span>;
        return (
          <Badge variant="outline" className="font-mono text-xs">
            #{lnms.librenms_device_id}
          </Badge>
        );
      }
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
        <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
          <DialogHeader>
            <DialogTitle>Modifica {selectedIds.size} host</DialogTitle>
          </DialogHeader>
          <DialogScrollableArea className="max-h-[70vh]">
            <div className="space-y-3 p-1">
              <p className="text-xs text-muted-foreground">
                Abilita i campi da modificare. Solo i campi abilitati verranno applicati a tutti gli host selezionati.
              </p>

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
            </div>
          </DialogScrollableArea>
          <DialogFooter>
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
    </div>
  );
}

/** Riga campo bulk con checkbox abilita/disabilita + controllo. */
function BulkFieldRow({
  label, enabled, onToggle, children,
}: {
  label: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-3 transition-opacity ${enabled ? "" : "opacity-50"}`}>
      <div className="pt-0.5">
        <Checkbox checked={enabled} onCheckedChange={onToggle} />
      </div>
      <div className="flex-1 space-y-1">
        <Label className="text-xs font-medium">{label}</Label>
        {children}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, RefreshCw, Pencil, ArrowLeft, Link2, Server, ExternalLink, Settings2, ShieldCheck, Check, X, Database } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { getClassificationLabel, DEVICE_CLASSIFICATIONS_ORDERED } from "@/lib/device-classifications";
import { DeviceFormFields } from "@/components/shared/device-form-fields";
import { CredentialAssignmentFields } from "@/components/shared/credential-assignment-fields";
import type { NetworkDevice } from "@/types";

type DeviceOrHost = (NetworkDevice & { source?: "network_device"; host_id?: never }) | {
  id: string;
  host_id: number;
  name: string;
  host: string;
  classification: string;
  vendor: string | null;
  enabled: number;
  source: "host";
  status: string;
  network_name?: string;
  network_id: number;
};

const CLASSIFICATION_LABELS: Record<string, { title: string; description: string }> = {
  access_point: { title: "Access Point", description: "Access point Wi-Fi (Ubiquiti, Cisco, Omada, ecc.)" },
  firewall: { title: "Firewall", description: "Firewall di rete" },
  hypervisor: { title: "Hypervisor", description: "Proxmox VE: registra hypervisor, estrai dati host/VM e abbina all'inventario" },
  iot: { title: "IoT", description: "Dispositivi IoT e sensori" },
  notebook: { title: "Notebook", description: "Portatili e laptop" },
  workstation: { title: "PC", description: "Computer desktop fissi" },
  vm: { title: "VM", description: "Macchine virtuali" },
  router: { title: "Router", description: "Dispositivi per acquisizione tabella ARP" },
  server: { title: "Server", description: "Server fisici e virtuali" },
  stampante: { title: "Stampanti", description: "Stampanti di rete" },
  storage: { title: "Storage", description: "NAS, storage di rete (Synology, QNAP e simili). Il profilo vendor gestisce i comandi." },
  switch: { title: "Switch", description: "Dispositivi per mappatura porte e MAC table (Cisco, HP, Omada, ecc.)" },
  telecamera: { title: "Telecamere", description: "Telecamere IP" },
  voip: { title: "Telefoni", description: "Telefoni VoIP" },
};

interface Credential {
  id: number;
  name: string;
  credential_type: string;
}

interface DeviceListByClassificationProps {
  classification: string;
}

const STORAGE_ALIASES = ["nas", "nas_synology", "nas_qnap"];

export function DeviceListByClassification({ classification }: DeviceListByClassificationProps) {
  const router = useRouter();

  // Redirect vecchie voci storage unificate
  useEffect(() => {
    if (STORAGE_ALIASES.includes(classification)) {
      router.replace("/devices/storage");
    }
  }, [classification, router]);

  const effectiveClassification = STORAGE_ALIASES.includes(classification) ? "storage" : classification;

  const [devices, setDevices] = useState<DeviceOrHost[]>([]);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DeviceOrHost | null>(null);
  const [createVendor, setCreateVendor] = useState<string>(
    effectiveClassification === "hypervisor" ? "proxmox" : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook" ? "windows" : effectiveClassification === "storage" ? "synology" : effectiveClassification === "router" ? "mikrotik" : effectiveClassification === "access_point" ? "ubiquiti" : effectiveClassification === "firewall" ? "stormshield" : effectiveClassification === "stampante" ? "hp" : "other"
  );
  const [createProtocol, setCreateProtocol] = useState<string>(
    effectiveClassification === "hypervisor" ? "ssh" : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook" ? "winrm" : effectiveClassification === "storage" ? "ssh" : effectiveClassification === "access_point" || effectiveClassification === "firewall" ? "ssh" : effectiveClassification === "stampante" || effectiveClassification === "telecamera" || effectiveClassification === "voip" || effectiveClassification === "iot" ? "snmp_v2" : "ssh"
  );
  const [createCredentialId, setCreateCredentialId] = useState<string | null>(null);
  const [createSnmpCredentialId, setCreateSnmpCredentialId] = useState<string | null>(null);
  const [createVendorSubtype, setCreateVendorSubtype] = useState<string | null>(null);
  const [editVendor, setEditVendor] = useState<string>("mikrotik");
  const [editProtocol, setEditProtocol] = useState<string>("ssh");
  const [editCredentialId, setEditCredentialId] = useState<string | null>(null);
  const [editSnmpCredentialId, setEditSnmpCredentialId] = useState<string | null>(null);
  const [editVendorSubtype, setEditVendorSubtype] = useState<string | null>(null);
  const [editScanTarget, setEditScanTarget] = useState<string | null>(null);
  const [editClassification, setEditClassification] = useState<string>("");
  const [querying, setQuerying] = useState<number | null>(null);
  const [proxmoxScanning, setProxmoxScanning] = useState<number | null>(null);
  const [proxmoxMatching, setProxmoxMatching] = useState<number | null>(null);
  const [proxmoxScanResult, setProxmoxScanResult] = useState<{ hosts: unknown[]; vms: unknown[]; scanned_at: string } | null>(null);
  const [proxmoxSelectedDevice, setProxmoxSelectedDevice] = useState<NetworkDevice | null>(null);
  const [settingProxmox, setSettingProxmox] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkClassification, setBulkClassification] = useState<string>("");
  const [bulkProtocol, setBulkProtocol] = useState<string>("");
  const [bulkVendor, setBulkVendor] = useState<string>("");
  const [bulkCredentialId, setBulkCredentialId] = useState<string | null>(null);
  const [bulkSnmpCredentialId, setBulkSnmpCredentialId] = useState<string | null>(null);
  const [bulkScanning, setBulkScanning] = useState(false);
  const [bulkTesting, setBulkTesting] = useState(false);
  const [credentialTestResults, setCredentialTestResults] = useState<Map<number, { ok: boolean; error?: string }>>(new Map());
  const [editTesting, setEditTesting] = useState(false);
  const [rowTesting, setRowTesting] = useState<number | null>(null);
  const [hostToAdd, setHostToAdd] = useState<{ name: string; host: string } | null>(null);
  const [bulkAddingFromHosts, setBulkAddingFromHosts] = useState(false);
  const [dhcpSyncing, setDhcpSyncing] = useState<number | null>(null);

  const isMikrotikRouter = (dev: DeviceOrHost) =>
    !isHostItem(dev) && dev.vendor === "mikrotik" && dev.protocol === "ssh";

  const meta = CLASSIFICATION_LABELS[effectiveClassification] ?? {
    title: effectiveClassification.replace(/_/g, " "),
    description: `Dispositivi classificati come ${effectiveClassification}`,
  };

  useEffect(() => {
    if (editingDevice) {
      setEditVendor(editingDevice.vendor ?? "other");
      setEditProtocol("protocol" in editingDevice ? editingDevice.protocol : "ssh");
      setEditCredentialId("credential_id" in editingDevice && editingDevice.credential_id ? String(editingDevice.credential_id) : null);
      setEditSnmpCredentialId("snmp_credential_id" in editingDevice && (editingDevice as NetworkDevice).snmp_credential_id ? String((editingDevice as NetworkDevice).snmp_credential_id) : null);
      setEditVendorSubtype("vendor_subtype" in editingDevice ? editingDevice.vendor_subtype ?? null : null);
      setEditScanTarget((editingDevice as { scan_target?: string | null }).scan_target ?? null);
      setEditClassification((editingDevice as { classification?: string | null }).classification ?? effectiveClassification);
    }
  }, [editingDevice, effectiveClassification]);

  const fetchDevices = useCallback(async () => {
    const res = await fetch(`/api/devices?classification=${encodeURIComponent(effectiveClassification)}`, { cache: "no-store" });
    setDevices(await res.json());
    setLoading(false);
  }, [effectiveClassification]);

  const fetchCredentials = useCallback(async () => {
    const res = await fetch("/api/credentials");
    if (res.ok) setCredentials(await res.json());
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);
  useEffect(() => { fetchCredentials(); }, [fetchCredentials]);

  const deviceType = effectiveClassification === "router" ? "router" : effectiveClassification === "switch" ? "switch" : effectiveClassification === "hypervisor" ? "hypervisor" : "switch";

  const isHostItem = (d: DeviceOrHost): d is Extract<DeviceOrHost, { source: "host" }> => (d as { source?: string }).source === "host";

  const getSelectionKey = (d: DeviceOrHost) => isHostItem(d) ? `host-${d.host_id}` : `device-${d.id}`;

  const toggleSelection = (key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === devices.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(devices.map(getSelectionKey)));
  };

  async function handleBulkUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const deviceIds: number[] = [];
    const hostIds: number[] = [];
    for (const key of selectedIds) {
      if (key.startsWith("device-")) deviceIds.push(Number(key.replace("device-", "")));
      else if (key.startsWith("host-")) hostIds.push(Number(key.replace("host-", "")));
    }
    const body: Record<string, unknown> = {};
    if (deviceIds.length) body.device_ids = deviceIds;
    if (hostIds.length) body.host_ids = hostIds;
    if (bulkClassification) body.classification = bulkClassification;
    if (bulkProtocol) body.protocol = bulkProtocol;
    if (bulkVendor) body.vendor = bulkVendor;
    if (deviceIds.length) {
      if (bulkCredentialId === "none" || bulkCredentialId === null) body.credential_id = null;
      else if (bulkCredentialId) body.credential_id = Number(bulkCredentialId);
      if (bulkSnmpCredentialId === "none" || bulkSnmpCredentialId === null) body.snmp_credential_id = null;
      else if (bulkSnmpCredentialId) body.snmp_credential_id = Number(bulkSnmpCredentialId);
    }

    const hasUpdate = bulkClassification || bulkProtocol || bulkVendor || bulkCredentialId || bulkSnmpCredentialId;
    if (!hasUpdate) {
      toast.error("Seleziona almeno un campo da aggiornare");
      return;
    }
    setBulkUpdating(true);
    try {
      const res = await fetch("/api/devices/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setBulkDialogOpen(false);
        setSelectedIds(new Set());
        fetchDevices();
      } else {
        toast.error(data.error || "Errore nell'aggiornamento");
      }
    } catch {
      toast.error("Errore di connessione");
    } finally {
      setBulkUpdating(false);
    }
  }

  const selectedDeviceIds = Array.from(selectedIds)
    .filter((k) => k.startsWith("device-"))
    .map((k) => Number(k.replace("device-", "")));
  const selectedHostItems = devices.filter((d) => isHostItem(d) && selectedIds.has(getSelectionKey(d))) as Extract<DeviceOrHost, { source: "host" }>[];

  async function handleBulkAddFromHosts() {
    if (selectedHostItems.length === 0) return;
    setBulkAddingFromHosts(true);
    const vendor = effectiveClassification === "stampante" ? "hp" : effectiveClassification === "telecamera" || effectiveClassification === "voip" || effectiveClassification === "iot" ? "other" : effectiveClassification === "storage" ? "synology" : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook" ? "windows" : "other";
    const protocol = effectiveClassification === "stampante" || effectiveClassification === "telecamera" || effectiveClassification === "voip" || effectiveClassification === "iot" ? "snmp_v2" : effectiveClassification === "storage" ? "ssh" : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook" ? "winrm" : "ssh";
    const port = protocol === "winrm" ? 5985 : protocol?.startsWith("snmp") ? 161 : 22;
    let ok = 0;
    let fail = 0;
    for (const host of selectedHostItems) {
      try {
        const res = await fetch("/api/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: host.name,
            host: host.host,
            device_type: "switch",
            classification: effectiveClassification,
            vendor,
            protocol,
            port,
          }),
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setBulkAddingFromHosts(false);
    setSelectedIds(new Set());
    fetchDevices();
    if (ok > 0) toast.success(`${ok} dispositivo${ok !== 1 ? "i" : ""} aggiunt${ok !== 1 ? "i" : "o"}. ${fail > 0 ? ` ${fail} fallit${fail !== 1 ? "i" : "o"}.` : ""} Assegna le credenziali e usa Test/Scansiona.`);
    else if (fail > 0) toast.error(`Errore nell'aggiunta di ${fail} dispositivi`);
  }

  async function handleEditTest() {
    if (!editingDevice || isHostItem(editingDevice) || typeof editingDevice.id !== "number") return;
    setEditTesting(true);
    try {
      const res = await fetch(`/api/devices/${editingDevice.id}/test`, { cache: "no-store" });
      const data = await res.json();
      if (data?.success) {
        toast.success("Credenziali verificate con successo");
      } else {
        toast.error(data?.error ?? "Test fallito");
      }
    } catch {
      toast.error("Errore nel test delle credenziali");
    } finally {
      setEditTesting(false);
    }
  }

  async function handleRowTest(id: number) {
    setRowTesting(id);
    try {
      const res = await fetch(`/api/devices/${id}/test`, { cache: "no-store" });
      const data = await res.json();
      const ok = !!data?.success;
      setCredentialTestResults((prev) => new Map(prev).set(id, { ok, error: ok ? undefined : data?.error ?? "Test fallito" }));
      if (ok) toast.success("Credenziali verificate");
      else toast.error(data?.error ?? "Test fallito");
    } catch {
      setCredentialTestResults((prev) => new Map(prev).set(id, { ok: false, error: "Errore di connessione" }));
      toast.error("Errore nel test delle credenziali");
    } finally {
      setRowTesting(null);
    }
  }

  async function handleDhcpSync(id: number) {
    setDhcpSyncing(id);
    try {
      const res = await fetch("/api/dhcp-leases?action=sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(`DHCP: ${data.inserted} nuovi lease, ${data.updated} aggiornati`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Errore sync DHCP");
    } finally {
      setDhcpSyncing(null);
    }
  }

  async function handleBulkTest() {
    if (selectedDeviceIds.length === 0) {
      toast.error("Seleziona almeno un dispositivo di rete (non host)");
      return;
    }
    setBulkTesting(true);
    const results = new Map<number, { ok: boolean; error?: string }>();
    try {
      for (const id of selectedDeviceIds) {
        const res = await fetch(`/api/devices/${id}/test`, { cache: "no-store" });
        const data = await res.json();
        if (data?.success) {
          results.set(id, { ok: true });
        } else {
          results.set(id, { ok: false, error: data?.error ?? "Test fallito" });
        }
      }
      setCredentialTestResults((prev) => {
        const next = new Map(prev);
        results.forEach((v, k) => next.set(k, v));
        return next;
      });
      const ok = [...results.values()].filter((r) => r.ok).length;
      const fail = results.size - ok;
      toast.success(`${ok} credenziali OK${fail > 0 ? `, ${fail} fallite (vedi colonna Credenziali)` : ""}`);
    } catch {
      toast.error("Errore nel test delle credenziali");
    } finally {
      setBulkTesting(false);
    }
  }

  async function handleBulkScan() {
    if (selectedDeviceIds.length === 0) {
      toast.error("Seleziona almeno un dispositivo di rete (non host)");
      return;
    }
    setBulkScanning(true);
    try {
      const res = await fetch("/api/devices/bulk-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_ids: selectedDeviceIds }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        if (data.scanned > 0) {
          setSelectedIds(new Set());
          fetchDevices();
        }
        if (data.errors?.length > 0 && data.errors.length <= 5) {
          data.errors.forEach((e: { name: string; error: string }) =>
            toast.error(`${e.name}: ${e.error}`, { duration: 5000 })
          );
        } else if (data.errors?.length > 5) {
          toast.info(`${data.errors.length} dispositivi con errori. Controlla le credenziali.`, { duration: 6000 });
        }
      } else {
        toast.error(data.error || "Errore nella scansione");
      }
    } catch {
      toast.error("Errore di connessione");
    } finally {
      setBulkScanning(false);
    }
  }

  const isProxmoxDevice = (dev: DeviceOrHost) =>
    !isHostItem(dev) &&
    ((dev as { scan_target?: string | null }).scan_target === "proxmox" ||
    dev.device_type === "hypervisor" ||
    (dev.classification === "hypervisor" && dev.protocol === "api"));

  const isWindowsDevice = (dev: DeviceOrHost) =>
    !isHostItem(dev) && ((dev as NetworkDevice).protocol === "winrm" || (dev as NetworkDevice).vendor === "windows");

  const isLinuxDevice = (dev: DeviceOrHost) =>
    !isHostItem(dev) && (dev as NetworkDevice).protocol === "ssh" && ((dev as NetworkDevice).vendor === "linux" || (dev as NetworkDevice).vendor === "other");

  const isStorageDevice = (dev: DeviceOrHost) =>
    !isHostItem(dev) && (dev as NetworkDevice).protocol === "ssh" && ((dev as NetworkDevice).vendor === "synology" || (dev as NetworkDevice).vendor === "qnap");

  const isSnmpDevice = (dev: DeviceOrHost) =>
    !isHostItem(dev) && ((dev as NetworkDevice).protocol === "snmp_v2" || (dev as NetworkDevice).protocol === "snmp_v3" || !!(dev as NetworkDevice).community_string || !!((dev as NetworkDevice).snmp_credential_id));

  async function handleProxmoxScan(id: number) {
    setProxmoxScanning(id);
    try {
      const res = await fetch(`/api/devices/${id}/proxmox-scan`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setProxmoxScanResult(data);
        const found = devices.find((d) => !isHostItem(d) && Number(d.id) === id);
        setProxmoxSelectedDevice(found ? (found as NetworkDevice) : null);
        toast.success(`Scan completato: ${data.hosts?.length ?? 0} host, ${data.vms?.length ?? 0} VM/CT`);
        fetchDevices();
      } else {
        toast.error(data.error || "Errore durante lo scan");
      }
    } catch {
      toast.error("Errore di connessione");
    } finally {
      setProxmoxScanning(null);
    }
  }

  async function handleProxmoxMatch(id: number) {
    setProxmoxMatching(id);
    try {
      const res = await fetch(`/api/devices/${id}/proxmox-match`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        toast.success(`Match completato: ${data.created ?? 0} creati, ${data.updated ?? 0} aggiornati`);
        fetchDevices();
      } else {
        toast.error(data.error || "Errore durante il match");
      }
    } catch {
      toast.error("Errore di connessione");
    } finally {
      setProxmoxMatching(null);
    }
  }

  async function loadProxmoxResult(dev: NetworkDevice) {
    try {
      const res = await fetch(`/api/devices/${dev.id}`, { cache: "no-store" });
      if (!res.ok) { toast.error("Impossibile caricare i dati Proxmox"); return; }
      const data = await res.json();
      if (data.proxmox_data) {
        setProxmoxScanResult(data.proxmox_data);
        setProxmoxSelectedDevice(dev);
      } else {
        toast.info("Nessun dato Proxmox disponibile");
      }
    } catch {
      toast.error("Errore nel caricamento dati Proxmox");
    }
  }

  async function handleSetAsProxmox(dev: NetworkDevice) {
    setSettingProxmox(dev.id);
    try {
      const res = await fetch(`/api/devices/${dev.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_type: "hypervisor",
          vendor: "proxmox",
          protocol: "ssh",
          port: 22,
          classification: "hypervisor",
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        toast.success("Dispositivo impostato come Proxmox. Aggiungi le credenziali SSH (root) tramite Modifica.");
        fetchDevices();
        setEditingDevice(updated);
        setEditVendor("proxmox");
        setEditProtocol("ssh");
        setEditCredentialId(updated.credential_id != null ? String(updated.credential_id) : null);
        setEditDialogOpen(true);
      } else {
        const data = await res.json();
        toast.error(data.error || "Errore");
      }
    } catch {
      toast.error("Errore di connessione");
    } finally {
      setSettingProxmox(null);
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      device_type: deviceType,
      vendor: createVendor,
      protocol: createProtocol,
      credential_id: createCredentialId && createCredentialId !== "none" ? Number(createCredentialId) : null,
      snmp_credential_id: createSnmpCredentialId && createSnmpCredentialId !== "none" ? Number(createSnmpCredentialId) : null,
      vendor_subtype: createVendor === "hp" && createVendorSubtype ? createVendorSubtype : null,
    };
    if (SCANNABLE_CLASSIFICATIONS.includes(effectiveClassification) && effectiveClassification !== "router" && effectiveClassification !== "switch" && effectiveClassification !== "hypervisor") {
      body.classification = effectiveClassification;
    }
    formData.forEach((val, key) => {
      if (val && key !== "device_type") body[key] = key === "port" ? Number(val) || undefined : val;
    });
    if (body.credential_id) {
      delete body.username;
      delete body.password;
    }

    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Errore nella creazione");
      return;
    }

    toast.success("Dispositivo aggiunto");
    setDialogOpen(false);
    setHostToAdd(null);
    fetchDevices();
  }

  async function handleQuery(id: number) {
    setQuerying(id);
    const res = await fetch(`/api/devices/${id}/query`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      toast.success(data.message);
      fetchDevices();
    } else {
      toast.error(data.error || "Errore nella query");
    }
    setQuerying(null);
  }

  async function handleDelete(id: number, name: string) {
    if (!confirm(`Eliminare il dispositivo "${name}"?`)) return;
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Dispositivo eliminato");
      fetchDevices();
    }
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    if (!editingDevice) return;
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      vendor: editVendor,
      protocol: editProtocol,
      credential_id: editCredentialId && editCredentialId !== "none" ? Number(editCredentialId) : null,
      snmp_credential_id: editSnmpCredentialId && editSnmpCredentialId !== "none" ? Number(editSnmpCredentialId) : null,
      vendor_subtype: editVendor === "hp" && editVendorSubtype ? editVendorSubtype : null,
      scan_target: editScanTarget || null,
    };
    if (editClassification) body.classification = editClassification;
    formData.forEach((val, key) => {
      if (key === "password" || key === "community_string") {
        if (val && String(val).trim()) body[key] = val;
      } else if (key === "api_url") {
        body.api_url = (val && String(val).trim()) || null;
      } else if (val && key !== "device_type") {
        body[key] = key === "port" ? Number(val) || undefined : val;
      }
    });
    if (body.credential_id) {
      delete body.username;
      delete body.password;
    }

    const res = await fetch(`/api/devices/${editingDevice.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const data = await res.json();
      toast.error(data.error || "Errore nell'aggiornamento");
      return;
    }

    toast.success("Dispositivo aggiornato");
    setEditDialogOpen(false);
    setEditingDevice(null);
    fetchDevices();
  }

  const SCANNABLE_CLASSIFICATIONS = ["router", "switch", "hypervisor", "server", "workstation", "notebook", "storage", "access_point", "firewall", "iot", "stampante", "telecamera", "voip", "vm"];
  const showAddButton = SCANNABLE_CLASSIFICATIONS.includes(effectiveClassification);
  const isHypervisor = effectiveClassification === "hypervisor";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <Link href="/devices">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{meta.title}</h1>
            <p className="text-muted-foreground mt-1">{meta.description}</p>
          </div>
        </div>
        {showAddButton && (
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setHostToAdd(null); }}>
            <DialogTrigger render={<Button><Plus className="h-4 w-4 mr-2" />Aggiungi {isHypervisor ? "Proxmox" : meta.title}</Button>} />
            <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nuovo {isHypervisor ? "Hypervisor Proxmox" : meta.title}</DialogTitle>
                {isHypervisor && (
                  <CardDescription>SSH (porta 22) è consigliato per evitare problemi SSL; puoi usare anche API (porta 8006). Credenziale tipo &quot;SSH&quot; o &quot;API&quot; con username root e password.</CardDescription>
                )}
                {SCANNABLE_CLASSIFICATIONS.includes(effectiveClassification) && effectiveClassification !== "router" && effectiveClassification !== "switch" && effectiveClassification !== "hypervisor" && (
                  <CardDescription>
                    {effectiveClassification === "storage"
                      ? "Synology/QNAP: SSH (porta 22). Usa credenziali tipo &quot;Linux&quot; o &quot;SSH&quot;."
                      : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook"
                        ? "Windows: WinRM (porta 5985). Linux: SSH (porta 22). Usa credenziali tipo &quot;Windows&quot; o &quot;Linux&quot;."
                        : effectiveClassification === "stampante" || effectiveClassification === "telecamera" || effectiveClassification === "voip" || effectiveClassification === "iot"
                          ? "SNMP v2/v3 (porta 161) per stampanti, telecamere, telefoni. Community string o credenziale SNMP."
                          : "SSH o SNMP a seconda del dispositivo. Access point e firewall spesso usano SSH."}
                  </CardDescription>
                )}
              </DialogHeader>
              <form key={hostToAdd ? `from-host-${hostToAdd.host}` : "new"} onSubmit={handleCreate} className="space-y-4">
                <DeviceFormFields
                  mode="create"
                  credentials={credentials}
                  idPrefix="create"
                  showIdentificazione
                  showProfilo
                  showCredenziali
                  name={hostToAdd?.name ?? ""}
                  host={hostToAdd?.host ?? ""}
                  defaultClassification={effectiveClassification}
                  defaultVendor={effectiveClassification === "hypervisor" ? "proxmox" : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook" ? "windows" : effectiveClassification === "storage" ? "synology" : effectiveClassification === "router" ? "mikrotik" : effectiveClassification === "access_point" ? "ubiquiti" : effectiveClassification === "firewall" ? "stormshield" : effectiveClassification === "stampante" ? "hp" : "other"}
                  defaultProtocol={effectiveClassification === "hypervisor" ? "ssh" : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook" ? "winrm" : effectiveClassification === "storage" ? "ssh" : effectiveClassification === "access_point" || effectiveClassification === "firewall" ? "ssh" : effectiveClassification === "stampante" || effectiveClassification === "telecamera" || effectiveClassification === "voip" || effectiveClassification === "iot" ? "snmp_v2" : "ssh"}
                  showApiUrl={isHypervisor}
                  vendor={createVendor}
                  protocol={createProtocol}
                  credentialId={createCredentialId}
                  snmpCredentialId={createSnmpCredentialId}
                  vendorSubtype={createVendorSubtype}
                  port={createProtocol === "winrm" ? 5985 : createProtocol?.startsWith("snmp") ? 161 : 22}
                  onVendorChange={(v) => { setCreateVendor(v); if (v !== "hp") setCreateVendorSubtype(null); }}
                  onProtocolChange={setCreateProtocol}
                  onCredentialIdChange={setCreateCredentialId}
                  onSnmpCredentialIdChange={setCreateSnmpCredentialId}
                  onVendorSubtypeChange={setCreateVendorSubtype}
                />
                <Button type="submit" className="w-full">Aggiungi {isHypervisor ? "Proxmox" : meta.title}</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento...</CardContent></Card>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Nessun {meta.title.toLowerCase()} configurato</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {isHypervisor && devices.some((d) => !isHostItem(d) && !isProxmoxDevice(d)) && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              Per gli hypervisor già presenti: clicca <strong>Proxmox</strong> per impostarli come host Proxmox e abilitare lo scan. In Modifica usa <strong>Protocollo SSH</strong> (porta 22) per evitare problemi SSL, oppure API (porta 8006).
            </div>
          )}
        {selectedIds.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selezionati</span>
            {selectedHostItems.length > 0 && (
              <Button
                size="sm"
                variant="default"
                onClick={handleBulkAddFromHosts}
                disabled={bulkAddingFromHosts}
                className="gap-2"
                title="Aggiungi gli host selezionati come dispositivi per abilitare Test credenziali e Scansiona"
              >
                <Plus className={`h-4 w-4 ${bulkAddingFromHosts ? "animate-pulse" : ""}`} />
                {bulkAddingFromHosts ? "Aggiunta…" : `Aggiungi come dispositivi (${selectedHostItems.length})`}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => setBulkDialogOpen(true)} className="gap-2">
              <Settings2 className="h-4 w-4" />
              Assegna caratteristiche / credenziali
            </Button>
            {selectedDeviceIds.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkTest}
                  disabled={bulkTesting || bulkScanning}
                  className="gap-2"
                  title="Testa le credenziali dei dispositivi selezionati prima della scansione"
                >
                  <ShieldCheck className={`h-4 w-4 ${bulkTesting ? "animate-pulse" : ""}`} />
                  {bulkTesting ? "Test in corso…" : "Testa credenziali"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleBulkScan}
                  disabled={bulkScanning || bulkTesting}
                  className="gap-2"
                  title="Testa credenziali e scansiona i dispositivi selezionati per acquisire dati"
                >
                  <RefreshCw className={`h-4 w-4 ${bulkScanning ? "animate-spin" : ""}`} />
                  {bulkScanning ? "Scansione…" : "Scansiona"}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              Annulla selezione
            </Button>
          </div>
        )}
        <TooltipProvider>
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={selectedIds.size === devices.length && devices.length > 0}
                    onCheckedChange={toggleAll}
                    aria-label="Seleziona tutti"
                  />
                </TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Classificazione</TableHead>
                <TableHead>IP</TableHead>
                {(devices.some(isHostItem) || devices.some((d) => (d as { network_name?: string }).network_name)) && <TableHead>Rete</TableHead>}
                {isHypervisor && devices.some((d) => !isHostItem(d)) && <TableHead>Ultimo scan</TableHead>}
                <TableHead>Vendor</TableHead>
                {devices.some((d) => !isHostItem(d)) && <TableHead>Protocollo</TableHead>}
                {devices.some((d) => !isHostItem(d)) && (
                  <TableHead className="text-center" title="Risultato test credenziali (Testa credenziali)">
                    Credenziali
                  </TableHead>
                )}
                <TableHead>Stato</TableHead>
                <TableHead className="w-40 min-w-[140px]">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((dev) => {
                const key = getSelectionKey(dev);
                return (
                <TableRow
                  key={key}
                  className="cursor-pointer"
                  onClick={() => isHostItem(dev) ? router.push(`/hosts/${dev.host_id}`) : router.push(`/devices/${dev.id}`)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
                    <Checkbox
                      checked={selectedIds.has(key)}
                      onCheckedChange={() => toggleSelection(key)}
                      aria-label={`Seleziona ${dev.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{dev.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">
                      {getClassificationLabel(dev.classification ?? "") || meta.title}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{dev.host}</TableCell>
                  {(devices.some(isHostItem) || devices.some((d) => (d as { network_name?: string }).network_name)) && (
                    <TableCell className="text-sm">
                      {(isHostItem(dev) ? dev.network_name : (dev as { network_name?: string }).network_name) ?? "—"}
                    </TableCell>
                  )}
                  {isHypervisor && devices.some((d) => !isHostItem(d)) && (
                    <TableCell className="text-sm text-muted-foreground">
                      {!isHostItem(dev) && (dev as NetworkDevice & { last_proxmox_scan_at?: string | null }).last_proxmox_scan_at
                        ? new Date((dev as NetworkDevice & { last_proxmox_scan_at: string }).last_proxmox_scan_at).toLocaleString("it-IT")
                        : "—"}
                    </TableCell>
                  )}
                  <TableCell className="capitalize">{dev.vendor || "—"}</TableCell>
                  {devices.some((d) => !isHostItem(d)) && (
                    <TableCell className="uppercase text-xs">{!isHostItem(dev) ? (dev as NetworkDevice).protocol : "—"}</TableCell>
                  )}
                  {devices.some((d) => !isHostItem(d)) && (
                    <TableCell className="text-center">
                      {isHostItem(dev) ? (
                        "—"
                      ) : (() => {
                        const res = credentialTestResults.get(dev.id);
                        if (!res) return <span className="text-muted-foreground text-xs">—</span>;
                        if (res.ok) {
                          return (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="inline-flex items-center gap-1 text-success font-medium text-xs">
                                    <Check className="h-4 w-4" />
                                    OK
                                  </span>
                                }
                              />
                              <TooltipContent>Credenziali funzionanti</TooltipContent>
                            </Tooltip>
                          );
                        }
                        return (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="inline-flex items-center gap-1 text-destructive font-medium text-xs cursor-help">
                                  <X className="h-4 w-4" />
                                  Fallito
                                </span>
                              }
                            />
                            <TooltipContent side="left" className="max-w-xs">
                              {res.error}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })()}
                    </TableCell>
                  )}
                  <TableCell>
                    {isHostItem(dev) ? (
                      <StatusBadge status={dev.status as "online" | "offline" | "unknown"} />
                    ) : (() => {
                      const s = (dev as { status?: string }).status;
                      return s ? <StatusBadge status={s as "online" | "offline" | "unknown"} /> : null;
                    })() ?? (
                      <Badge variant={dev.enabled ? "outline" : "secondary"}>
                        {dev.enabled ? "Attivo" : "Disabilitato"}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                      {isHostItem(dev) ? (
                        <>
                          {showAddButton && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHostToAdd({ name: dev.name, host: dev.host });
                                setCreateVendor(effectiveClassification === "stampante" || effectiveClassification === "telecamera" || effectiveClassification === "voip" || effectiveClassification === "iot" ? "hp" : effectiveClassification === "storage" ? "synology" : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook" ? "windows" : "other");
                                setCreateProtocol(effectiveClassification === "stampante" || effectiveClassification === "telecamera" || effectiveClassification === "voip" || effectiveClassification === "iot" ? "snmp_v2" : effectiveClassification === "storage" ? "ssh" : effectiveClassification === "server" || effectiveClassification === "workstation" || effectiveClassification === "notebook" ? "winrm" : "ssh");
                                setDialogOpen(true);
                              }}
                              title="Aggiungi come dispositivo per configurare credenziali e scansione"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Configura
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" nativeButton={false} render={<Link href={`/hosts/${dev.host_id}`} title="Dettagli host" />}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          {showAddButton && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => { setEditingDevice(dev); setEditDialogOpen(true); }}
                                title="Modifica / Assegna credenziali"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              {isProxmoxDevice(dev) ? (
                                <>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleProxmoxScan(dev.id)} disabled={proxmoxScanning !== null} title="Scan Proxmox">
                                    <RefreshCw className={`h-4 w-4 ${proxmoxScanning === dev.id ? "animate-spin" : ""}`} />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => loadProxmoxResult(dev)} disabled={!dev.last_proxmox_scan_result} title="Visualizza dati">
                                    <Server className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleProxmoxMatch(dev.id)} disabled={!dev.last_proxmox_scan_result || proxmoxMatching !== null} title="Abbina inventario">
                                    <Link2 className="h-4 w-4" />
                                  </Button>
                                </>
                              ) : isHypervisor && !isProxmoxDevice(dev) ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 text-xs"
                                  onClick={() => handleSetAsProxmox(dev)}
                                  disabled={settingProxmox !== null}
                                  title="Imposta come Proxmox per abilitare lo scan"
                                >
                                  {settingProxmox === dev.id ? "..." : "Proxmox"}
                                </Button>
                              ) : (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8"
                                    onClick={(e) => { e.stopPropagation(); handleRowTest(dev.id); }}
                                    disabled={rowTesting === dev.id}
                                    title="Testa credenziali"
                                  >
                                    <ShieldCheck className={`h-4 w-4 ${rowTesting === dev.id ? "animate-pulse" : ""}`} />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleQuery(dev.id)} disabled={querying === dev.id} title="Scansiona">
                                    <RefreshCw className={`h-4 w-4 ${querying === dev.id ? "animate-spin" : ""}`} />
                                  </Button>
                                  {isMikrotikRouter(dev) && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={(e) => { e.stopPropagation(); handleDhcpSync(dev.id); }}
                                      disabled={dhcpSyncing === dev.id}
                                      title="Acquisisci lease DHCP"
                                    >
                                      <Database className={`h-4 w-4 ${dhcpSyncing === dev.id ? "animate-pulse" : ""}`} />
                                    </Button>
                                  )}
                                </>
                              )}
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive/60 hover:text-destructive"
                            onClick={() => handleDelete(dev.id, dev.name)}
                            title="Elimina"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
              })}
            </TableBody>
          </Table>
        </Card>
        </TooltipProvider>

        <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
          <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Assegna caratteristiche a {selectedIds.size} elementi</DialogTitle>
              <CardDescription>
                Stessa struttura della maschera di modifica singola. Solo i campi compilati verranno applicati ai dispositivi selezionati.
              </CardDescription>
            </DialogHeader>
            <form onSubmit={handleBulkUpdate} className="space-y-6">
              <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">Gruppo</p>
                <div className="space-y-2">
                  <Label>Classificazione / Gruppo</Label>
                  <Select value={bulkClassification} onValueChange={(v) => setBulkClassification(v ?? "")}>
                    <SelectTrigger><SelectValue placeholder="Non modificare" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Non modificare</SelectItem>
                      {DEVICE_CLASSIFICATIONS_ORDERED.filter((c) => c !== "unknown").map((c) => (
                        <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Categoria in cui appare nella lista (es. PC, Server, Storage). Corregge classificazioni errate.</p>
                </div>
              </div>
              {selectedIds.size > 0 && Array.from(selectedIds).some((k) => k.startsWith("device-")) && (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Profilo e credenziali</p>
                  <div className="space-y-2">
                    <Label>Protocollo</Label>
                    <Select value={bulkProtocol} onValueChange={(v) => setBulkProtocol(v ?? "")}>
                      <SelectTrigger><SelectValue placeholder="Non modificare" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Non modificare</SelectItem>
                        <SelectItem value="ssh">SSH</SelectItem>
                        <SelectItem value="snmp_v2">SNMP v2</SelectItem>
                        <SelectItem value="snmp_v3">SNMP v3</SelectItem>
                        <SelectItem value="api">API REST</SelectItem>
                        <SelectItem value="winrm">WinRM (Windows)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">Come connettersi: SSH, SNMP, WinRM per Windows.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Vendor</Label>
                    <Select value={bulkVendor} onValueChange={(v) => setBulkVendor(v ?? "")}>
                      <SelectTrigger><SelectValue placeholder="Non modificare" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">Non modificare</SelectItem>
                        <SelectItem value="mikrotik">MikroTik</SelectItem>
                        <SelectItem value="ubiquiti">Ubiquiti</SelectItem>
                        <SelectItem value="cisco">Cisco</SelectItem>
                        <SelectItem value="hp">HP / Aruba</SelectItem>
                        <SelectItem value="omada">TP-Link Omada</SelectItem>
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
                    <p className="text-xs text-muted-foreground">Profilo che determina i comandi usati (es. Windows per WinRM).</p>
                  </div>
                  <CredentialAssignmentFields
                    credentials={credentials}
                    credentialId={bulkCredentialId}
                    snmpCredentialId={bulkSnmpCredentialId}
                    onCredentialIdChange={(v) => setBulkCredentialId(v)}
                    onSnmpCredentialIdChange={(v) => setBulkSnmpCredentialId(v)}
                    credentialPlaceholder="Non modificare"
                    snmpPlaceholder="Non modificare"
                    idPrefix="device-bulk"
                  />
                </div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setBulkDialogOpen(false)}>
                  Annulla
                </Button>
                <Button type="submit" disabled={bulkUpdating}>
                  {bulkUpdating ? "Aggiornamento..." : "Applica"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </>
      )}

      {isHypervisor && proxmoxScanResult && proxmoxSelectedDevice && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Dati estratti da {proxmoxSelectedDevice.name}
            </CardTitle>
            <CardDescription>
              Scan del {proxmoxScanResult.scanned_at ? new Date(proxmoxScanResult.scanned_at).toLocaleString("it-IT") : "—"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="hosts">
              <TabsList>
                <TabsTrigger value="hosts">Host ({proxmoxScanResult.hosts?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="vms">VM e CT ({proxmoxScanResult.vms?.length ?? 0})</TabsTrigger>
                <TabsTrigger value="details">Hardware e licenza</TabsTrigger>
              </TabsList>
              <TabsContent value="hosts" className="mt-4">
                {proxmoxScanResult.hosts?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Hostname</TableHead>
                        <TableHead>Stato</TableHead>
                        <TableHead>CPU</TableHead>
                        <TableHead>RAM</TableHead>
                        <TableHead>Versione</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(proxmoxScanResult.hosts as { hostname: string; status: string; cpu_model?: string | null; cpu_total_cores?: number | null; memory_total_gb?: number | null; memory_usage_percent?: number | null; proxmox_version?: string | null }[]).map((host, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{host.hostname}</TableCell>
                          <TableCell><Badge variant={host.status === "online" ? "default" : "secondary"}>{host.status}</Badge></TableCell>
                          <TableCell>{host.cpu_total_cores ?? "—"} core{host.cpu_model ? ` (${host.cpu_model})` : ""}</TableCell>
                          <TableCell>
                            {host.memory_total_gb != null ? `${host.memory_total_gb.toFixed(1)} GiB` : "—"}
                            {host.memory_usage_percent != null && ` (${host.memory_usage_percent}%)`}
                          </TableCell>
                          <TableCell className="text-sm">{host.proxmox_version ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground py-4">Nessun host estratto.</p>
                )}
              </TabsContent>
              <TabsContent value="details" className="mt-4">
                {proxmoxScanResult.hosts?.length ? (
                  <div className="space-y-6">
                    {(proxmoxScanResult.hosts as Array<{
                      hostname: string;
                      cpu_model?: string | null;
                      cpu_mhz?: number | null;
                      cpu_sockets?: number | null;
                      cpu_cores?: number | null;
                      kernel_version?: string | null;
                      uptime_human?: string | null;
                      rootfs_used_gb?: number | null;
                      rootfs_total_gb?: number | null;
                      hardware_serial?: string | null;
                      hardware_model?: string | null;
                      hardware_manufacturer?: string | null;
                      subscription?: { status?: string; productname?: string; key?: string; level?: string; nextduedate?: string; serverid?: string } | null;
                    }>).map((h, i) => (
                      <div key={i} className="rounded-lg border p-4 space-y-4">
                        <h4 className="font-medium">{h.hostname}</h4>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 text-sm">
                          {h.cpu_model && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase">CPU</p>
                              <p className="font-medium">{h.cpu_model}</p>
                              {(h.cpu_mhz ?? h.cpu_sockets ?? h.cpu_cores) && (
                                <p className="text-xs text-muted-foreground">
                                  {[h.cpu_mhz && `${h.cpu_mhz} MHz`, h.cpu_sockets && `${h.cpu_sockets} socket`, h.cpu_cores && `${h.cpu_cores} core`].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                          )}
                          {h.kernel_version && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase">Kernel</p>
                              <p className="font-medium">{h.kernel_version}</p>
                            </div>
                          )}
                          {h.uptime_human && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase">Uptime</p>
                              <p className="font-medium">{h.uptime_human}</p>
                            </div>
                          )}
                          {(h.rootfs_used_gb != null || h.rootfs_total_gb != null) && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase">Root FS</p>
                              <p className="font-medium">
                                {h.rootfs_used_gb != null && h.rootfs_total_gb != null
                                  ? `${h.rootfs_used_gb.toFixed(1)} / ${h.rootfs_total_gb.toFixed(1)} GiB`
                                  : "—"}
                              </p>
                            </div>
                          )}
                          {h.hardware_manufacturer && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase">Produttore</p>
                              <p className="font-medium">{h.hardware_manufacturer}</p>
                            </div>
                          )}
                          {h.hardware_model && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase">Modello</p>
                              <p className="font-medium">{h.hardware_model}</p>
                            </div>
                          )}
                          {h.hardware_serial && (
                            <div>
                              <p className="text-xs text-muted-foreground uppercase">Seriale</p>
                              <p className="font-mono text-xs">{h.hardware_serial}</p>
                            </div>
                          )}
                          {h.subscription && (
                            <>
                              <div>
                                <p className="text-xs text-muted-foreground uppercase">Licenza</p>
                                <p className="font-medium">
                                  <Badge variant={h.subscription.status === "active" ? "default" : "secondary"}>
                                    {h.subscription.status || "—"}
                                  </Badge>
                                </p>
                              </div>
                              {h.subscription.productname && (
                                <div>
                                  <p className="text-xs text-muted-foreground uppercase">Prodotto</p>
                                  <p className="font-medium">{h.subscription.productname}</p>
                                </div>
                              )}
                              {h.subscription.level && (
                                <div>
                                  <p className="text-xs text-muted-foreground uppercase">Livello</p>
                                  <p className="font-medium">{h.subscription.level}</p>
                                </div>
                              )}
                              {h.subscription.key && (
                                <div className="col-span-2">
                                  <p className="text-xs text-muted-foreground uppercase">Codice licenza</p>
                                  <p className="font-mono text-xs break-all">{h.subscription.key}</p>
                                </div>
                              )}
                              {h.subscription.nextduedate && (
                                <div>
                                  <p className="text-xs text-muted-foreground uppercase">Scadenza</p>
                                  <p className="font-medium">{h.subscription.nextduedate}</p>
                                </div>
                              )}
                              {h.subscription.serverid && (
                                <div>
                                  <p className="text-xs text-muted-foreground uppercase">Server ID</p>
                                  <p className="font-mono text-xs">{h.subscription.serverid}</p>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground py-4">Nessun host. Esegui uno scan per acquisire i dati.</p>
                )}
              </TabsContent>
              <TabsContent value="vms" className="mt-4">
                {proxmoxScanResult.vms?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Nodo</TableHead>
                        <TableHead>vCPU</TableHead>
                        <TableHead>RAM</TableHead>
                        <TableHead>Storage</TableHead>
                        <TableHead>IP</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(proxmoxScanResult.vms as { node: string; vmid: number; name: string; type: string; maxcpu: number; memory_mb: number; disk_gb: number; ip_addresses: string[] }[]).map((vm) => (
                        <TableRow key={`${vm.node}-${vm.vmid}`}>
                          <TableCell className="font-medium">{vm.name}</TableCell>
                          <TableCell><Badge variant="outline">{vm.type.toUpperCase()}</Badge></TableCell>
                          <TableCell>{vm.node}</TableCell>
                          <TableCell>{vm.maxcpu}</TableCell>
                          <TableCell>{Math.round(vm.memory_mb / 1024)} GiB</TableCell>
                          <TableCell>{vm.disk_gb.toFixed(1)} GiB</TableCell>
                          <TableCell className="font-mono text-xs">{vm.ip_addresses?.length ? vm.ip_addresses.join(", ") : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground py-4">Nessuna VM/CT in esecuzione.</p>
                )}
              </TabsContent>
            </Tabs>
            <div className="mt-4 p-3 bg-muted/50 rounded-lg text-sm">
              <strong>Match con inventario:</strong> Usa il pulsante Link per abbinare le VM agli host IPAM tramite IP.
            </div>
          </CardContent>
        </Card>
      )}

      {showAddButton && (
        <Dialog open={editDialogOpen} onOpenChange={(open) => { setEditDialogOpen(open); if (!open) setEditingDevice(null); }}>
          <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Modifica {meta.title}</DialogTitle>
              <CardDescription>
                Modifica identificazione, gruppo, profilo e credenziali. Il profilo vendor determina i comandi usati per acquisire i dati.
              </CardDescription>
            </DialogHeader>
            {editingDevice && (
              <form onSubmit={handleUpdate} className="space-y-6">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Identificazione</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input name="name" required defaultValue={editingDevice.name} placeholder="Nome del dispositivo" />
                    </div>
                    <div className="space-y-2">
                      <Label>IP</Label>
                      <Input name="host" required defaultValue={editingDevice.host} placeholder="192.168.1.1" />
                    </div>
                    {!isHostItem(editingDevice) && (editingDevice.device_type === "hypervisor" || (editingDevice as { scan_target?: string }).scan_target === "proxmox") && (
                      <div className="space-y-2 col-span-2">
                        <Label htmlFor="device-edit-api_url">URL API Proxmox</Label>
                        <Input
                          id="device-edit-api_url"
                          name="api_url"
                          defaultValue={(editingDevice as NetworkDevice & { api_url?: string }).api_url ?? ""}
                          placeholder="Opzionale: https://ip:8006 o http://ip:8006 (usa http:// se errore SSL)"
                          className="font-mono"
                        />
                        <p className="text-xs text-muted-foreground">
                          Se vuoto usa IP + porta. Per errore &quot;wrong version number&quot; prova <code className="bg-muted px-1 rounded">http://</code> invece di https.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-medium text-muted-foreground">Gruppo e profilo</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Classificazione / Gruppo</Label>
                      <Select value={editClassification} onValueChange={(v) => setEditClassification(v ?? "")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DEVICE_CLASSIFICATIONS_ORDERED.filter((c) => c !== "unknown").map((c) => (
                            <SelectItem key={c} value={c}>{getClassificationLabel(c)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Categoria in cui appare nella lista dispositivi (es. Router, Switch, Storage).</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Vendor</Label>
                      <Select value={editVendor} onValueChange={(v) => { setEditVendor(v ?? ""); if (v !== "hp") setEditVendorSubtype(null); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="mikrotik">MikroTik</SelectItem>
                          <SelectItem value="ubiquiti">Ubiquiti</SelectItem>
                          <SelectItem value="cisco">Cisco</SelectItem>
                          <SelectItem value="hp">HP / Aruba</SelectItem>
                          <SelectItem value="omada">TP-Link Omada</SelectItem>
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
                      <p className="text-xs text-muted-foreground">Profilo che determina i comandi SSH/SNMP (es. MikroTik, Cisco, HP ProCurve).</p>
                    </div>
                    {editVendor === "hp" && (
                      <div className="space-y-2">
                        <Label>Sottotipo HP</Label>
                        <Select value={editVendorSubtype ?? "none"} onValueChange={(v) => setEditVendorSubtype(v === "none" ? null : v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Generico</SelectItem>
                            <SelectItem value="procurve">ProCurve / Aruba</SelectItem>
                            <SelectItem value="comware">Comware</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label>Protocollo</Label>
                      <Select value={editProtocol} onValueChange={(v) => setEditProtocol(v ?? "")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ssh">SSH</SelectItem>
                          <SelectItem value="snmp_v2">SNMP v2</SelectItem>
                          <SelectItem value="snmp_v3">SNMP v3</SelectItem>
                          <SelectItem value="api">API REST</SelectItem>
                          <SelectItem value="winrm">WinRM (Windows)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Come connettersi: SSH per comandi, SNMP per porte/LLDP, WinRM per Windows.</p>
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo di scansione</Label>
                      <Select value={editScanTarget ?? "none"} onValueChange={(v) => setEditScanTarget(v === "none" ? null : v)}>
                        <SelectTrigger><SelectValue placeholder="Automatico" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Automatico</SelectItem>
                          <SelectItem value="proxmox">Proxmox</SelectItem>
                          <SelectItem value="vmware">VMware</SelectItem>
                          <SelectItem value="windows">Windows</SelectItem>
                          <SelectItem value="linux">Linux</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Forza il tipo di scan senza pulsanti dedicati. Automatico = rilevato da vendor/protocollo.</p>
                    </div>
                  </div>
                </div>
                <CredentialAssignmentFields
                  credentials={credentials}
                  credentialId={editCredentialId}
                  snmpCredentialId={editSnmpCredentialId}
                  onCredentialIdChange={(v) => setEditCredentialId(v)}
                  onSnmpCredentialIdChange={(v) => setEditSnmpCredentialId(v)}
                  credentialPlaceholder="Nessuna (credenziali inline)"
                  showInlineCreds={editProtocol === "ssh" || editProtocol === "api" || editProtocol === "winrm"}
                  inlineUsername={"username" in editingDevice ? (editingDevice.username || "") : ""}
                  showPortAndCommunity
                  portDefaultValue={"port" in editingDevice ? (editingDevice.port ?? 22) : 22}
                  idPrefix="device-edit"
                  testButton={
                    !isHostItem(editingDevice) && typeof editingDevice.id === "number" ? (
                      <Button type="button" variant="outline" size="sm" onClick={handleEditTest} disabled={editTesting}>
                        <ShieldCheck className={`h-4 w-4 mr-2 ${editTesting ? "animate-pulse" : ""}`} />
                        {editTesting ? "Test in corso…" : "Testa credenziali"}
                      </Button>
                    ) : undefined
                  }
                />
                <Button type="submit" className="w-full">Salva modifiche</Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

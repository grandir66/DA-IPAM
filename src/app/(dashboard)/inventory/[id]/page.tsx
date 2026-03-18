"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Shield, User, FileKey, History, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { InventoryAsset, InventoryAssetInput, AssetAssignee, Location, License, LicenseSeat, InventoryAuditLog } from "@/types";

const CATEGORIE = ["Desktop", "Laptop", "Server", "Switch", "Firewall", "NAS", "Stampante", "VM", "Licenza", "Access Point", "Router", "Other"];
const STATI = ["Attivo", "In magazzino", "In riparazione", "Dismesso", "Rubato"];
const STORAGE_TIPI = ["SSD", "HDD", "NVMe"];
const CLASSIFICAZIONI = ["Pubblico", "Interno", "Confidenziale", "Riservato"];

function TechnicalDataCard({ data }: { data: string }) {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!parsed) return null;

  const hosts = parsed.hosts as Array<Record<string, unknown>> | undefined;
  const vms = parsed.vms as Array<Record<string, unknown>> | undefined;
  const scannedAt = parsed.scanned_at as string | undefined;
  const source = parsed.source as string | undefined;

  if (source === "device") {
    return (
      <Card>
        <CardHeader><CardTitle>Dati archiviati (dispositivo)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1">
            {parsed.sysname ? <><dt className="text-muted-foreground">sysName</dt><dd className="font-mono">{String(parsed.sysname)}</dd></> : null}
            {parsed.sysdescr ? <><dt className="text-muted-foreground">sysDescr</dt><dd className="font-mono break-all">{String(parsed.sysdescr)}</dd></> : null}
            {parsed.model ? <><dt className="text-muted-foreground">Modello</dt><dd>{String(parsed.model)}</dd></> : null}
            {parsed.firmware ? <><dt className="text-muted-foreground">Firmware</dt><dd>{String(parsed.firmware)}</dd></> : null}
            {parsed.serial_number ? <><dt className="text-muted-foreground">Seriale</dt><dd className="font-mono">{String(parsed.serial_number)}</dd></> : null}
            {parsed.part_number ? <><dt className="text-muted-foreground">Part Number</dt><dd className="font-mono">{String(parsed.part_number)}</dd></> : null}
            {parsed.last_info_update ? <><dt className="text-muted-foreground">Ultimo aggiornamento</dt><dd>{String(parsed.last_info_update)}</dd></> : null}
          </dl>
        </CardContent>
      </Card>
    );
  }

  const host = hosts?.[0] as Record<string, unknown> | undefined;
  const sub = host?.subscription as Record<string, unknown> | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dati archiviati (Proxmox)</CardTitle>
        {scannedAt && <p className="text-sm text-muted-foreground mt-1">Scansione: {new Date(scannedAt).toLocaleString("it-IT")}</p>}
      </CardHeader>
      <CardContent className="space-y-4">
        {host && (
          <>
            <div>
              <h4 className="font-medium text-sm mb-2">Host</h4>
              <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 text-sm">
                {host.cpu_model ? <><dt className="text-muted-foreground">CPU</dt><dd>{String(host.cpu_model)} {host.cpu_mhz != null ? `(${host.cpu_mhz} MHz)` : ""}</dd></> : null}
                {host.cpu_sockets != null ? <><dt className="text-muted-foreground">Socket</dt><dd>{String(host.cpu_sockets)}</dd></> : null}
                {host.cpu_cores != null ? <><dt className="text-muted-foreground">Core</dt><dd>{String(host.cpu_cores)}</dd></> : null}
                {host.memory_total_gb != null ? <><dt className="text-muted-foreground">RAM</dt><dd>{String(host.memory_total_gb)} GB</dd></> : null}
                {host.proxmox_version ? <><dt className="text-muted-foreground">Proxmox</dt><dd>{String(host.proxmox_version)}</dd></> : null}
                {host.kernel_version ? <><dt className="text-muted-foreground">Kernel</dt><dd className="font-mono text-xs">{String(host.kernel_version)}</dd></> : null}
                {host.rootfs_total_gb != null ? <><dt className="text-muted-foreground">Root FS</dt><dd>{String(host.rootfs_total_gb)} GB</dd></> : null}
                {host.hardware_manufacturer ? <><dt className="text-muted-foreground">Produttore</dt><dd>{String(host.hardware_manufacturer)}</dd></> : null}
                {host.hardware_model ? <><dt className="text-muted-foreground">Modello HW</dt><dd>{String(host.hardware_model)}</dd></> : null}
                {host.hardware_serial ? <><dt className="text-muted-foreground">Seriale</dt><dd className="font-mono">{String(host.hardware_serial)}</dd></> : null}
              </dl>
            </div>
            {sub && (
              <div>
                <h4 className="font-medium text-sm mb-2">Licenza</h4>
                <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 text-sm">
                  {sub.status ? <><dt className="text-muted-foreground">Stato</dt><dd>{String(sub.status)}</dd></> : null}
                  {sub.productname ? <><dt className="text-muted-foreground">Prodotto</dt><dd>{String(sub.productname)}</dd></> : null}
                  {sub.key ? <><dt className="text-muted-foreground">Codice</dt><dd className="font-mono text-xs break-all">{String(sub.key)}</dd></> : null}
                  {sub.nextduedate ? <><dt className="text-muted-foreground">Scadenza</dt><dd>{String(sub.nextduedate)}</dd></> : null}
                  {sub.serverid ? <><dt className="text-muted-foreground">Server ID</dt><dd className="font-mono text-xs">{String(sub.serverid)}</dd></> : null}
                </dl>
              </div>
            )}
          </>
        )}
        {vms && vms.length > 0 && (
          <div>
            <h4 className="font-medium text-sm mb-2">VM e container ({vms.length})</h4>
            <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
              {vms.slice(0, 20).map((vm, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-mono">{String(vm.vmid ?? "—")}</span>
                  <span>{String(vm.name ?? "—")}</span>
                  <span className="text-muted-foreground">{String(vm.status ?? "—")}</span>
                  {vm.maxmem != null && <span className="text-muted-foreground">{(Number(vm.maxmem) / 1024 / 1024 / 1024).toFixed(1)} GB</span>}
                </li>
              ))}
              {vms.length > 20 && <li className="text-muted-foreground">... e altri {vms.length - 20}</li>}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function InventoryAssetPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [asset, setAsset] = useState<InventoryAsset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<InventoryAssetInput>>({});
  const [assignees, setAssignees] = useState<AssetAssignee[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [licenses, setLicenses] = useState<(License & { free_seats?: number })[]>([]);
  const [assetLicenses, setAssetLicenses] = useState<(LicenseSeat & { license_name?: string })[]>([]);
  const [auditLog, setAuditLog] = useState<InventoryAuditLog[]>([]);
  const [assignLicenseId, setAssignLicenseId] = useState<string>("");

  useEffect(() => {
    if (!/^\d+$/.test(id)) {
      setLoading(false);
      return;
    }
    fetch(`/api/inventory/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setAsset(data);
        if (data) {
          setForm({
            asset_tag: data.asset_tag,
            serial_number: data.serial_number,
            hostname: data.hostname,
            nome_prodotto: data.nome_prodotto,
            categoria: data.categoria,
            marca: data.marca,
            modello: data.modello,
            sede: data.sede,
            reparto: data.reparto,
            asset_assignee_id: data.asset_assignee_id,
            location_id: data.location_id,
            in_scope_gdpr: data.in_scope_gdpr,
            in_scope_nis2: data.in_scope_nis2,
            classificazione_dati: data.classificazione_dati,
            ultimo_audit: data.ultimo_audit,
            posizione_fisica: data.posizione_fisica,
            stato: data.stato,
            fine_garanzia: data.fine_garanzia,
            fine_supporto: data.fine_supporto,
            firmware_version: data.firmware_version,
            sistema_operativo: data.sistema_operativo,
            versione_os: data.versione_os,
            cpu: data.cpu,
            ram_gb: data.ram_gb,
            storage_gb: data.storage_gb,
            storage_tipo: data.storage_tipo,
            mac_address: data.mac_address,
            ip_address: data.ip_address,
            prezzo_acquisto: data.prezzo_acquisto,
            fornitore: data.fornitore,
            contratto_supporto: data.contratto_supporto,
            contatto_supporto: data.contatto_supporto,
            note_tecniche: data.note_tecniche,
          });
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetch("/api/asset-assignees").then((r) => r.ok ? r.json() : []).then(setAssignees);
    fetch("/api/locations").then((r) => r.ok ? r.json() : []).then(setLocations);
    fetch("/api/licenses").then((r) => r.ok ? r.json() : []).then(setLicenses);
  }, []);

  useEffect(() => {
    if (!/^\d+$/.test(id)) return;
    fetch(`/api/inventory/${id}/audit`).then((r) => r.ok ? r.json() : []).then(setAuditLog);
  }, [id]);

  const refreshAssetLicenses = () => {
    if (!/^\d+$/.test(id)) return;
    fetch(`/api/inventory/${id}/licenses`).then((r) => r.ok ? r.json() : []).then(setAssetLicenses);
  };

  useEffect(() => {
    if (!/^\d+$/.test(id)) return;
    refreshAssetLicenses();
  }, [id]);

  async function handleAssignLicense(licenseId: number) {
    if (!asset) return;
    setAssignLicenseId("");
    try {
      const res = await fetch(`/api/licenses/${licenseId}/seats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_type: "inventory_asset", asset_id: asset.id }),
      });
      if (res.ok) {
        toast.success("Licenza assegnata");
        refreshAssetLicenses();
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Errore");
      }
    } catch {
      toast.error("Errore nell'assegnazione");
    }
  }

  async function handleUnassignLicense(seatId: number) {
    try {
      const res = await fetch(`/api/licenses/seats/${seatId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Assegnazione rimossa");
        refreshAssetLicenses();
      } else {
        toast.error("Errore");
      }
    } catch {
      toast.error("Errore");
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!asset) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/inventory/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success("Asset aggiornato");
        setAsset(await res.json());
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Errore");
      }
    } catch {
      toast.error("Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-muted-foreground py-8">Caricamento...</div>;
  if (!asset) return <div className="text-muted-foreground py-8">Asset non trovato</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/inventory">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{asset.asset_tag ?? asset.nome_prodotto ?? `Asset #${asset.id}`}</h1>
          <p className="text-muted-foreground text-sm">{asset.asset_id}</p>
        </div>
      </div>

      <form onSubmit={handleSave}>
        <Tabs defaultValue="identificazione">
          <TabsList className="flex flex-wrap gap-1">
            <TabsTrigger value="identificazione">Identificazione</TabsTrigger>
            <TabsTrigger value="ubicazione">Ubicazione</TabsTrigger>
            <TabsTrigger value="responsabilita"><User className="h-3.5 w-3.5 mr-1" />Responsabilità</TabsTrigger>
            <TabsTrigger value="ciclo">Ciclo vita</TabsTrigger>
            <TabsTrigger value="tecnico">Tecnico</TabsTrigger>
            <TabsTrigger value="compliance"><Shield className="h-3.5 w-3.5 mr-1" />Compliance</TabsTrigger>
            <TabsTrigger value="licenze"><FileKey className="h-3.5 w-3.5 mr-1" />Licenze</TabsTrigger>
            <TabsTrigger value="storico"><History className="h-3.5 w-3.5 mr-1" />Storico</TabsTrigger>
            <TabsTrigger value="economico">Economico</TabsTrigger>
            <TabsTrigger value="supporto">Supporto</TabsTrigger>
          </TabsList>

          <TabsContent value="identificazione">
            <Card>
              <CardHeader><CardTitle>Identificazione asset</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Asset Tag</Label><Input value={form.asset_tag ?? ""} onChange={(e) => setForm((f) => ({ ...f, asset_tag: e.target.value || null }))} placeholder="DMC-00123" /></div>
                  <div><Label>Serial Number</Label><Input value={form.serial_number ?? ""} onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value || null }))} /></div>
                  <div><Label>Hostname</Label><Input value={form.hostname ?? ""} onChange={(e) => setForm((f) => ({ ...f, hostname: e.target.value || null }))} /></div>
                  <div><Label>Nome prodotto</Label><Input value={form.nome_prodotto ?? ""} onChange={(e) => setForm((f) => ({ ...f, nome_prodotto: e.target.value || null }))} placeholder="Dell OptiPlex 7090" /></div>
                  <div><Label>Categoria</Label>
                    <Select value={form.categoria ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, categoria: (v || null) as InventoryAsset["categoria"] }))}>
                      <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">—</SelectItem>
                        {CATEGORIE.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Marca</Label><Input value={form.marca ?? ""} onChange={(e) => setForm((f) => ({ ...f, marca: e.target.value || null }))} /></div>
                  <div className="col-span-2"><Label>Modello</Label><Input value={form.modello ?? ""} onChange={(e) => setForm((f) => ({ ...f, modello: e.target.value || null }))} /></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ubicazione">
            <Card>
              <CardHeader><CardTitle>Ubicazione</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Sede</Label><Input value={form.sede ?? ""} onChange={(e) => setForm((f) => ({ ...f, sede: e.target.value || null }))} /></div>
                  <div><Label>Reparto</Label><Input value={form.reparto ?? ""} onChange={(e) => setForm((f) => ({ ...f, reparto: e.target.value || null }))} /></div>
                  <div><Label>Ubicazione</Label>
                    <Select value={form.location_id != null ? String(form.location_id) : "none"} onValueChange={(v) => setForm((f) => ({ ...f, location_id: v === "none" ? null : Number(v) }))}>
                      <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {locations.map((loc) => <SelectItem key={loc.id} value={String(loc.id)}>{loc.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Label>Posizione fisica</Label><Input value={form.posizione_fisica ?? ""} onChange={(e) => setForm((f) => ({ ...f, posizione_fisica: e.target.value || null }))} placeholder="Rack A - U12" /></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="responsabilita">
            <Card>
              <CardHeader><CardTitle>Assegnatario</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div><Label>Assegnato a</Label>
                    <Select value={form.asset_assignee_id != null ? String(form.asset_assignee_id) : "none"} onValueChange={(v) => setForm((f) => ({ ...f, asset_assignee_id: v === "none" ? null : Number(v) }))}>
                      <SelectTrigger><SelectValue placeholder="Seleziona assegnatario" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Nessuno</SelectItem>
                        {assignees.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}{a.email ? ` (${a.email})` : ""}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {assignees.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nessun assegnatario. Aggiungine dalla pagina Impostazioni o dalla gestione inventario.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ciclo">
            <Card>
              <CardHeader><CardTitle>Ciclo di vita</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Stato</Label>
                    <Select value={form.stato ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, stato: (v || null) as InventoryAsset["stato"] }))}>
                      <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">—</SelectItem>
                        {STATI.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Fine garanzia</Label><Input type="date" value={form.fine_garanzia ?? ""} onChange={(e) => setForm((f) => ({ ...f, fine_garanzia: e.target.value || null }))} /></div>
                  <div><Label>Fine supporto (EOL)</Label><Input type="date" value={form.fine_supporto ?? ""} onChange={(e) => setForm((f) => ({ ...f, fine_supporto: e.target.value || null }))} /></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tecnico">
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Specifiche tecniche</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>CPU</Label><Input value={form.cpu ?? ""} onChange={(e) => setForm((f) => ({ ...f, cpu: e.target.value || null }))} placeholder="Modello, MHz, socket, core" /></div>
                    <div><Label>RAM (GB)</Label><Input type="number" min={0} value={form.ram_gb ?? ""} onChange={(e) => setForm((f) => ({ ...f, ram_gb: e.target.value ? Number(e.target.value) : null }))} /></div>
                    <div><Label>Storage (GB)</Label><Input type="number" min={0} value={form.storage_gb ?? ""} onChange={(e) => setForm((f) => ({ ...f, storage_gb: e.target.value ? Number(e.target.value) : null }))} /></div>
                    <div><Label>Tipo storage</Label>
                      <Select value={form.storage_tipo ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, storage_tipo: (v || null) as InventoryAsset["storage_tipo"] }))}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">—</SelectItem>
                          {STORAGE_TIPI.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Sistema operativo</Label><Input value={form.sistema_operativo ?? ""} onChange={(e) => setForm((f) => ({ ...f, sistema_operativo: e.target.value || null }))} placeholder="Proxmox VE, Windows, Linux..." /></div>
                    <div><Label>Versione OS / Kernel</Label><Input value={form.versione_os ?? ""} onChange={(e) => setForm((f) => ({ ...f, versione_os: e.target.value || null }))} /></div>
                    <div><Label>Firmware / Versione</Label><Input value={form.firmware_version ?? ""} onChange={(e) => setForm((f) => ({ ...f, firmware_version: e.target.value || null }))} /></div>
                    <div><Label>IP</Label><Input value={form.ip_address ?? ""} onChange={(e) => setForm((f) => ({ ...f, ip_address: e.target.value || null }))} placeholder="192.168.1.1" /></div>
                    <div><Label>MAC</Label><Input value={form.mac_address ?? ""} onChange={(e) => setForm((f) => ({ ...f, mac_address: e.target.value || null }))} placeholder="00:11:22:33:44:55" /></div>
                  </div>
                </CardContent>
              </Card>
              {(asset as { technical_data?: string | null }).technical_data && (
                <TechnicalDataCard data={(asset as { technical_data?: string | null }).technical_data!} />
              )}
            </div>
          </TabsContent>

          <TabsContent value="compliance">
            <Card>
              <CardHeader><CardTitle>Compliance GDPR / NIS2</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="in_scope_gdpr" checked={!!form.in_scope_gdpr} onChange={(e) => setForm((f) => ({ ...f, in_scope_gdpr: e.target.checked ? 1 : 0 }))} className="rounded" />
                    <Label htmlFor="in_scope_gdpr">In scope GDPR</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="in_scope_nis2" checked={!!form.in_scope_nis2} onChange={(e) => setForm((f) => ({ ...f, in_scope_nis2: e.target.checked ? 1 : 0 }))} className="rounded" />
                    <Label htmlFor="in_scope_nis2">In scope NIS2</Label>
                  </div>
                  <div><Label>Classificazione dati</Label>
                    <Select value={form.classificazione_dati ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, classificazione_dati: (v || null) as InventoryAsset["classificazione_dati"] }))}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">—</SelectItem>
                        {CLASSIFICAZIONI.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Ultimo audit</Label><Input type="date" value={form.ultimo_audit ?? ""} onChange={(e) => setForm((f) => ({ ...f, ultimo_audit: e.target.value || null }))} /></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="licenze">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Licenze software assegnate</CardTitle>
                  <Select value={assignLicenseId} onValueChange={(v) => { setAssignLicenseId(v ?? ""); if (v) handleAssignLicense(Number(v)); }}>
                    <SelectTrigger className="w-[220px]"><SelectValue placeholder="Assegna licenza..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">—</SelectItem>
                      {licenses.filter((l) => (l.free_seats ?? 0) > 0).map((l) => (
                        <SelectItem key={l.id} value={String(l.id)}>{l.name} ({l.free_seats} posti liberi)</SelectItem>
                      ))}
                      {licenses.filter((l) => (l.free_seats ?? 0) > 0).length === 0 && (
                        <SelectItem value="__none__" disabled>Nessuna licenza disponibile</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {assetLicenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessuna licenza assegnata.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Licenza</TableHead>
                        <TableHead>Assegnato il</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {assetLicenses.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.license_name ?? `Licenza #${s.license_id}`}</TableCell>
                          <TableCell className="text-muted-foreground">{new Date(s.assigned_at).toLocaleDateString("it-IT")}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => handleUnassignLicense(s.id)} title="Rimuovi assegnazione">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="storico">
            <Card>
              <CardHeader><CardTitle>Storico modifiche (audit)</CardTitle></CardHeader>
              <CardContent>
                {auditLog.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nessuna modifica registrata.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Azione</TableHead>
                        <TableHead>Campo</TableHead>
                        <TableHead>Valore precedente</TableHead>
                        <TableHead>Nuovo valore</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLog.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-muted-foreground text-sm">{new Date(entry.created_at).toLocaleString("it-IT")}</TableCell>
                          <TableCell><Badge variant="outline">{entry.action}</Badge></TableCell>
                          <TableCell>{entry.field_name ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[120px] truncate" title={entry.old_value ?? ""}>{entry.old_value ?? "—"}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[120px] truncate" title={entry.new_value ?? ""}>{entry.new_value ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="economico">
            <Card>
              <CardHeader><CardTitle>Dati economici</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Prezzo acquisto (€)</Label><Input type="number" step="0.01" value={form.prezzo_acquisto ?? ""} onChange={(e) => setForm((f) => ({ ...f, prezzo_acquisto: e.target.value ? Number(e.target.value) : null }))} /></div>
                  <div><Label>Fornitore</Label><Input value={form.fornitore ?? ""} onChange={(e) => setForm((f) => ({ ...f, fornitore: e.target.value || null }))} /></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="supporto">
            <Card>
              <CardHeader><CardTitle>Manutenzione & supporto</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Contratto supporto</Label><Input value={form.contratto_supporto ?? ""} onChange={(e) => setForm((f) => ({ ...f, contratto_supporto: e.target.value || null }))} /></div>
                  <div><Label>Contatto supporto</Label><Input value={form.contatto_supporto ?? ""} onChange={(e) => setForm((f) => ({ ...f, contatto_supporto: e.target.value || null }))} /></div>
                  <div className="col-span-2"><Label>Note tecniche</Label><Textarea rows={4} value={form.note_tecniche ?? ""} onChange={(e) => setForm((f) => ({ ...f, note_tecniche: e.target.value || null }))} /></div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-6">
          <Button type="submit" disabled={saving}>
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Salvataggio..." : "Salva modifiche"}
          </Button>
        </div>
      </form>
    </div>
  );
}

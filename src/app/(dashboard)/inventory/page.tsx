"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader,
  DialogScrollableArea, DialogTitle, DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Package, Search, Pencil, ExternalLink, RefreshCw, Download, ChevronDown, X, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import type { InventoryAsset } from "@/types";

const CATEGORIE: (InventoryAsset["categoria"])[] = [
  "Desktop", "Laptop", "Server", "Switch", "Firewall", "NAS", "Stampante",
  "VM", "Licenza", "Access Point", "Router", "Other",
];
const STATI: (InventoryAsset["stato"])[] = [
  "Attivo", "In magazzino", "In riparazione", "Dismesso", "Rubato",
];
const CLASSIFICAZIONI_DATI = ["Pubblico", "Interno", "Confidenziale", "Riservato"] as const;

// ─── Tipi per il form bulk edit ─────────────────────────────
interface BulkField<T> {
  enabled: boolean;
  value: T;
}

interface BulkEditForm {
  categoria: BulkField<string | null>;
  stato: BulkField<string | null>;
  marca: BulkField<string | null>;
  classificazione_dati: BulkField<string | null>;
  sede: BulkField<string | null>;
  reparto: BulkField<string | null>;
  posizione_fisica: BulkField<string | null>;
  fornitore: BulkField<string | null>;
  antivirus: BulkField<string | null>;
  in_scope_gdpr: BulkField<number>;
  in_scope_nis2: BulkField<number>;
}

function emptyBulkForm(): BulkEditForm {
  return {
    categoria: { enabled: false, value: null },
    stato: { enabled: false, value: null },
    marca: { enabled: false, value: null },
    classificazione_dati: { enabled: false, value: null },
    sede: { enabled: false, value: null },
    reparto: { enabled: false, value: null },
    posizione_fisica: { enabled: false, value: null },
    fornitore: { enabled: false, value: null },
    antivirus: { enabled: false, value: null },
    in_scope_gdpr: { enabled: false, value: 0 },
    in_scope_nis2: { enabled: false, value: 0 },
  };
}

export default function InventoryPage() {
  const [assets, setAssets] = useState<(InventoryAsset & { network_device_name?: string; host_ip?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [categoria, setCategoria] = useState<string>("");
  const [stato, setStato] = useState<string>("");
  const [syncingDevices, setSyncingDevices] = useState(false);
  const [syncingHosts, setSyncingHosts] = useState(false);

  // ─── Selezione e bulk edit ────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkForm, setBulkForm] = useState<BulkEditForm>(emptyBulkForm);

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (categoria) params.set("categoria", categoria);
      if (stato) params.set("stato", stato);
      params.set("limit", "200");
      const res = await fetch(`/api/inventory?${params}`, { cache: "no-store" });
      if (res.ok) setAssets(await res.json());
      else setAssets([]);
    } catch {
      setAssets([]);
    } finally {
      setLoading(false);
      setSelectedIds(new Set());
    }
  }, [q, categoria, stato]);

  useEffect(() => {
    const t = setTimeout(fetchAssets, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchAssets, q]);

  const formatDate = (d: string | null) => d ? new Date(d).toLocaleDateString("it-IT") : "—";

  // ─── Selezione helpers ────────────────────────────────
  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === assets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(assets.map((a) => a.id)));
    }
  }

  // ─── Bulk edit ────────────────────────────────
  function openBulkEdit() {
    setBulkForm(emptyBulkForm());
    setBulkEditOpen(true);
  }

  function updateBulkField<K extends keyof BulkEditForm>(key: K, patch: Partial<BulkField<unknown>>) {
    setBulkForm((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch },
    }));
  }

  async function handleBulkSave() {
    const payload: Record<string, unknown> = {
      asset_ids: Array.from(selectedIds),
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
      const res = await fetch("/api/inventory/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message);
        setBulkEditOpen(false);
        setSelectedIds(new Set());
        fetchAssets();
      } else {
        toast.error(data.error ?? "Errore nell'aggiornamento");
      }
    } catch {
      toast.error("Errore nell'aggiornamento");
    } finally {
      setBulkSaving(false);
    }
  }

  // ─── Sync & export ────────────────────────────────

  async function handleSyncDevices() {
    setSyncingDevices(true);
    try {
      const res = await fetch("/api/inventory/sync-devices", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        if (data.created > 0 || data.updated > 0) fetchAssets();
        toast.success(data.message);
      } else {
        toast.error(data.error ?? "Errore nella sincronizzazione");
      }
    } catch {
      toast.error("Errore nella sincronizzazione");
    } finally {
      setSyncingDevices(false);
    }
  }

  async function handleSyncHosts() {
    setSyncingHosts(true);
    try {
      const res = await fetch("/api/inventory/sync-hosts", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        if (data.created > 0 || data.updated > 0) fetchAssets();
        toast.success(data.message);
      } else {
        toast.error(data.error ?? "Errore nella sincronizzazione");
      }
    } catch {
      toast.error("Errore nella sincronizzazione");
    } finally {
      setSyncingHosts(false);
    }
  }

  function handleExport() {
    const params = new URLSearchParams();
    if (categoria) params.set("categoria", categoria);
    if (stato) params.set("stato", stato);
    params.set("limit", "2000");
    window.open(`/api/inventory/export?${params}`, "_blank");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Inventario asset</h1>
        <p className="text-muted-foreground mt-1">
          Gestione dati di inventario per device di rete e host. Molti campi sono opzionali.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Elenco asset
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" disabled={syncingDevices || syncingHosts} className="gap-2">
                      <RefreshCw className={`h-4 w-4 ${(syncingDevices || syncingHosts) ? "animate-spin" : ""}`} />
                      Sincronizza
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleSyncDevices} disabled={syncingDevices}>
                    {syncingDevices ? "Sincronizzazione..." : "Da dispositivi di rete"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleSyncHosts} disabled={syncingHosts}>
                    {syncingHosts ? "Sincronizzazione..." : "Da host"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="icon" onClick={handleExport} title="Esporta CSV">
                <Download className="h-4 w-4" />
              </Button>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca asset tag, S/N, hostname..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-8 w-48 sm:w-56"
                />
              </div>
              <Select value={categoria} onValueChange={(v) => setCategoria(v ?? "")}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Categoria" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutte</SelectItem>
                  {CATEGORIE.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={stato} onValueChange={(v) => setStato(v ?? "")}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Stato" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutti</SelectItem>
                  {STATI.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={fetchAssets} disabled={loading}>
                <Search className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* ── Barra selezione ── */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2 bg-primary/5 border-b">
              <span className="text-sm font-medium">
                {selectedIds.size} asset selezionat{selectedIds.size === 1 ? "o" : "i"}
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
            <div className="py-12 text-center text-muted-foreground">Caricamento...</div>
          ) : assets.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              Nessun asset in inventario. Collega un asset da una scheda device o host.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={assets.length > 0 && selectedIds.size === assets.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Asset Tag</TableHead>
                    <TableHead>S/N</TableHead>
                    <TableHead>Prodotto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Collegato a</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Fine garanzia</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assets.map((a) => (
                    <TableRow key={a.id} className={selectedIds.has(a.id) ? "bg-primary/5" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(a.id)}
                          onCheckedChange={() => toggleSelect(a.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{a.asset_tag ?? "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{a.serial_number ?? "—"}</TableCell>
                      <TableCell>{a.nome_prodotto ?? a.marca ?? "—"}</TableCell>
                      <TableCell>
                        {a.categoria ? <Badge variant="outline">{a.categoria}</Badge> : "—"}
                      </TableCell>
                      <TableCell>
                        {a.network_device_id ? (
                          <Link href={`/devices/${a.network_device_id}`} className="text-primary hover:underline flex items-center gap-1">
                            {a.network_device_name ?? `Device #${a.network_device_id}`}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : a.host_id ? (
                          <Link href={`/hosts/${a.host_id}`} className="text-primary hover:underline flex items-center gap-1">
                            {a.host_ip ?? `Host #${a.host_id}`}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        {a.stato ? <Badge variant={a.stato === "Attivo" ? "default" : "secondary"}>{a.stato}</Badge> : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(a.fine_garanzia)}</TableCell>
                      <TableCell>
                        <Link href={`/inventory/${a.id}`}>
                          <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ════════════════ DIALOG MODIFICA MULTIPLA ════════════════ */}
      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
          <DialogHeader>
            <DialogTitle>Modifica {selectedIds.size} asset</DialogTitle>
          </DialogHeader>
          <DialogScrollableArea className="max-h-[70vh]">
            <div className="space-y-3 p-1">
              <p className="text-xs text-muted-foreground">
                Abilita i campi da modificare. Solo i campi abilitati verranno applicati a tutti gli asset selezionati.
              </p>

              {/* Categoria */}
              <BulkFieldRow
                label="Categoria"
                enabled={bulkForm.categoria.enabled}
                onToggle={(v) => updateBulkField("categoria", { enabled: v })}
              >
                <Select
                  value={bulkForm.categoria.value ?? "__empty__"}
                  onValueChange={(v) => updateBulkField("categoria", { value: v === "__empty__" ? null : v })}
                  disabled={!bulkForm.categoria.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Nessuna —</SelectItem>
                    {CATEGORIE.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BulkFieldRow>

              {/* Stato */}
              <BulkFieldRow
                label="Stato"
                enabled={bulkForm.stato.enabled}
                onToggle={(v) => updateBulkField("stato", { enabled: v })}
              >
                <Select
                  value={bulkForm.stato.value ?? "__empty__"}
                  onValueChange={(v) => updateBulkField("stato", { value: v === "__empty__" ? null : v })}
                  disabled={!bulkForm.stato.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Nessuno —</SelectItem>
                    {STATI.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BulkFieldRow>

              {/* Marca/Produttore */}
              <BulkFieldRow
                label="Marca / Produttore"
                enabled={bulkForm.marca.enabled}
                onToggle={(v) => updateBulkField("marca", { enabled: v })}
              >
                <Input
                  value={bulkForm.marca.value ?? ""}
                  onChange={(e) => updateBulkField("marca", { value: e.target.value || null })}
                  placeholder="Es: HP, Dell, Cisco..."
                  disabled={!bulkForm.marca.enabled}
                />
              </BulkFieldRow>

              {/* Classificazione dati */}
              <BulkFieldRow
                label="Classificazione dati"
                enabled={bulkForm.classificazione_dati.enabled}
                onToggle={(v) => updateBulkField("classificazione_dati", { enabled: v })}
              >
                <Select
                  value={bulkForm.classificazione_dati.value ?? "__empty__"}
                  onValueChange={(v) => updateBulkField("classificazione_dati", { value: v === "__empty__" ? null : v })}
                  disabled={!bulkForm.classificazione_dati.enabled}
                >
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__empty__">— Nessuna —</SelectItem>
                    {CLASSIFICAZIONI_DATI.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </BulkFieldRow>

              {/* Sede */}
              <BulkFieldRow
                label="Sede"
                enabled={bulkForm.sede.enabled}
                onToggle={(v) => updateBulkField("sede", { enabled: v })}
              >
                <Input
                  value={bulkForm.sede.value ?? ""}
                  onChange={(e) => updateBulkField("sede", { value: e.target.value || null })}
                  placeholder="Es: Sede centrale, Filiale Nord..."
                  disabled={!bulkForm.sede.enabled}
                />
              </BulkFieldRow>

              {/* Reparto */}
              <BulkFieldRow
                label="Reparto"
                enabled={bulkForm.reparto.enabled}
                onToggle={(v) => updateBulkField("reparto", { enabled: v })}
              >
                <Input
                  value={bulkForm.reparto.value ?? ""}
                  onChange={(e) => updateBulkField("reparto", { value: e.target.value || null })}
                  placeholder="Es: IT, Amministrazione..."
                  disabled={!bulkForm.reparto.enabled}
                />
              </BulkFieldRow>

              {/* Posizione fisica */}
              <BulkFieldRow
                label="Posizione fisica"
                enabled={bulkForm.posizione_fisica.enabled}
                onToggle={(v) => updateBulkField("posizione_fisica", { enabled: v })}
              >
                <Input
                  value={bulkForm.posizione_fisica.value ?? ""}
                  onChange={(e) => updateBulkField("posizione_fisica", { value: e.target.value || null })}
                  placeholder="Es: Rack A1, Ufficio 301..."
                  disabled={!bulkForm.posizione_fisica.enabled}
                />
              </BulkFieldRow>

              {/* Fornitore */}
              <BulkFieldRow
                label="Fornitore"
                enabled={bulkForm.fornitore.enabled}
                onToggle={(v) => updateBulkField("fornitore", { enabled: v })}
              >
                <Input
                  value={bulkForm.fornitore.value ?? ""}
                  onChange={(e) => updateBulkField("fornitore", { value: e.target.value || null })}
                  placeholder="Es: TechStore SRL..."
                  disabled={!bulkForm.fornitore.enabled}
                />
              </BulkFieldRow>

              {/* Antivirus */}
              <BulkFieldRow
                label="Antivirus"
                enabled={bulkForm.antivirus.enabled}
                onToggle={(v) => updateBulkField("antivirus", { enabled: v })}
              >
                <Input
                  value={bulkForm.antivirus.value ?? ""}
                  onChange={(e) => updateBulkField("antivirus", { value: e.target.value || null })}
                  placeholder="Es: SentinelOne, CrowdStrike..."
                  disabled={!bulkForm.antivirus.enabled}
                />
              </BulkFieldRow>

              {/* In scope GDPR */}
              <BulkFieldRow
                label="In scope GDPR"
                enabled={bulkForm.in_scope_gdpr.enabled}
                onToggle={(v) => updateBulkField("in_scope_gdpr", { enabled: v })}
              >
                <div className="flex items-center gap-2">
                  <Switch
                    checked={bulkForm.in_scope_gdpr.value === 1}
                    onCheckedChange={(v) => updateBulkField("in_scope_gdpr", { value: v ? 1 : 0 })}
                    disabled={!bulkForm.in_scope_gdpr.enabled}
                  />
                  <span className="text-xs text-muted-foreground">
                    {bulkForm.in_scope_gdpr.value === 1 ? "Si" : "No"}
                  </span>
                </div>
              </BulkFieldRow>

              {/* In scope NIS2 */}
              <BulkFieldRow
                label="In scope NIS2"
                enabled={bulkForm.in_scope_nis2.enabled}
                onToggle={(v) => updateBulkField("in_scope_nis2", { enabled: v })}
              >
                <div className="flex items-center gap-2">
                  <Switch
                    checked={bulkForm.in_scope_nis2.value === 1}
                    onCheckedChange={(v) => updateBulkField("in_scope_nis2", { value: v ? 1 : 0 })}
                    disabled={!bulkForm.in_scope_nis2.enabled}
                  />
                  <span className="text-xs text-muted-foreground">
                    {bulkForm.in_scope_nis2.value === 1 ? "Si" : "No"}
                  </span>
                </div>
              </BulkFieldRow>
            </div>
          </DialogScrollableArea>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEditOpen(false)} disabled={bulkSaving}>
              Annulla
            </Button>
            <Button onClick={handleBulkSave} disabled={bulkSaving} className="gap-2">
              {bulkSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Applica a {selectedIds.size} asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Riga campo bulk con switch abilita/disabilita + controllo. */
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

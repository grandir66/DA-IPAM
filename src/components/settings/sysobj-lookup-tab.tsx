"use client";

import { useEffect, useState, useCallback } from "react";
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
import { Plus, Trash2, Pencil, RotateCcw, Search, Filter } from "lucide-react";
import { toast } from "sonner";
import {
  getClassificationLabel,
  DEVICE_CLASSIFICATIONS_ORDERED,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";

interface SysObjRow {
  id: number;
  oid: string;
  vendor: string;
  product: string;
  category: string;
  enterprise_id: number;
  builtin: number;
  enabled: number;
  note: string | null;
}

/** Categorie legacy (dalla lookup table originale) + tutte le classificazioni device */
const LEGACY_CATEGORIES = ["networking", "wireless"];
const ALL_CATEGORIES = [...LEGACY_CATEGORIES, ...DEVICE_CLASSIFICATIONS_ORDERED.filter((c) => !LEGACY_CATEGORIES.includes(c))];

const emptyForm = {
  oid: "",
  vendor: "",
  product: "",
  category: "router",
  enterprise_id: 0,
  enabled: true,
  note: "",
};

export function SysObjLookupTab() {
  const [rows, setRows] = useState<SysObjRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SysObjRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sysobj-lookup");
      if (res.ok) {
        const data = await res.json();
        setRows(Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openDialog = (row?: SysObjRow) => {
    if (row) {
      setEditing(row);
      setForm({
        oid: row.oid,
        vendor: row.vendor,
        product: row.product,
        category: row.category,
        enterprise_id: row.enterprise_id,
        enabled: row.enabled === 1,
        note: row.note ?? "",
      });
    } else {
      setEditing(null);
      setForm(emptyForm);
    }
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        oid: form.oid.trim(),
        vendor: form.vendor.trim(),
        product: form.product.trim(),
        category: form.category,
        enterprise_id: form.enterprise_id,
        enabled: form.enabled ? 1 : 0,
        note: form.note.trim() || null,
      };
      const url = editing ? `/api/sysobj-lookup/${editing.id}` : "/api/sysobj-lookup";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Errore nel salvataggio");
        return;
      }
      toast.success(editing ? "Voce aggiornata" : "Voce creata");
      setDialogOpen(false);
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (row: SysObjRow) => {
    if (!confirm(`Eliminare la voce OID ${row.oid} (${row.vendor} ${row.product})?`)) return;
    try {
      const res = await fetch(`/api/sysobj-lookup/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Errore nell'eliminazione");
        return;
      }
      toast.success("Voce eliminata");
      load();
    } catch { toast.error("Errore di rete"); }
  };

  const handleToggle = async (row: SysObjRow, enabled: boolean) => {
    try {
      await fetch(`/api/sysobj-lookup/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enabled ? 1 : 0 }),
      });
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, enabled: enabled ? 1 : 0 } : r));
    } catch { toast.error("Errore aggiornamento"); }
  };

  const handleResetBuiltin = async () => {
    if (!confirm("Ripristinare tutte le voci integrate? Le voci personalizzate verranno mantenute.")) return;
    try {
      const res = await fetch("/api/sysobj-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _action: "reset_builtin" }),
      });
      if (res.ok) {
        toast.success("Voci integrate ripristinate");
        load();
      }
    } catch { toast.error("Errore nel ripristino"); }
  };

  const filterLower = filter.toLowerCase();
  const filtered = rows.filter((r) => {
    if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
    if (!filterLower) return true;
    return (
      r.oid.includes(filterLower) ||
      r.vendor.toLowerCase().includes(filterLower) ||
      r.product.toLowerCase().includes(filterLower) ||
      String(r.enterprise_id).includes(filterLower)
    );
  });

  const catLabel = (cat: string) => {
    // Prova classificazione device, poi fallback al valore raw
    const deviceLabel = getClassificationLabel(cat);
    return deviceLabel !== cat ? deviceLabel : cat.charAt(0).toUpperCase() + cat.slice(1);
  };

  if (loading) return <Card><CardContent className="py-12 text-center text-muted-foreground">Caricamento…</CardContent></Card>;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Tabella sysObjectID Lookup</CardTitle>
            </div>
            <CardDescription className="mt-1 max-w-3xl">
              Mappa sysObjectID SNMP → vendor/prodotto/categoria. Usata nella fase 1 della scoperta rete (dopo il GET su 1.3.6.1.2.1.1.2.0)
              per identificare rapidamente il tipo di dispositivo. Il match è per prefisso più lungo.
              <span className="text-muted-foreground"> ({rows.length} voci, {rows.filter((r) => r.builtin).length} integrate)</span>
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={handleResetBuiltin} title="Ripristina voci integrate">
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset integrate
            </Button>
            <Button type="button" size="sm" onClick={() => openDialog()}>
              <Plus className="h-4 w-4 mr-2" />
              Nuova voce
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Filtra per OID, vendor, prodotto…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le categorie</SelectItem>
                {ALL_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{catLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="border rounded-md overflow-auto max-h-[600px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[56px]">On</TableHead>
                  <TableHead>OID Prefisso</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Prodotto</TableHead>
                  <TableHead className="w-[110px]">Categoria</TableHead>
                  <TableHead className="w-[72px]">Ent. ID</TableHead>
                  <TableHead className="w-[72px]">Tipo</TableHead>
                  <TableHead className="w-[88px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      {filter || categoryFilter !== "all" ? "Nessun risultato per il filtro." : "Nessuna voce. Premi «Reset integrate» per caricare le voci predefinite."}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((row) => (
                    <TableRow key={row.id} className={row.enabled ? "" : "opacity-50"}>
                      <TableCell>
                        <Switch checked={row.enabled === 1} onCheckedChange={(c) => handleToggle(row, c)} />
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[280px] truncate" title={row.oid}>
                        {row.oid}
                      </TableCell>
                      <TableCell className="text-sm">{row.vendor}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate" title={row.product}>{row.product}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {catLabel(row.category)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.enterprise_id}</TableCell>
                      <TableCell>
                        {row.builtin ? (
                          <Badge variant="secondary" className="text-[10px]">builtin</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-green-400">custom</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openDialog(row)} title="Modifica">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {!row.builtin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => handleDelete(row)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog add/edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica voce sysObjectID" : "Nuova voce sysObjectID"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label>OID Prefisso</Label>
              <Input
                value={form.oid}
                onChange={(e) => setForm((f) => ({ ...f, oid: e.target.value }))}
                placeholder="es. 1.3.6.1.4.1.25053.3.1.4"
                required
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Il sysObjectID del device deve iniziare con questo prefisso per matchare.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Vendor</Label>
                <Input
                  value={form.vendor}
                  onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))}
                  placeholder="es. Ruckus"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Enterprise ID</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.enterprise_id || ""}
                  onChange={(e) => setForm((f) => ({ ...f, enterprise_id: parseInt(e.target.value, 10) || 0 }))}
                  placeholder="es. 25053"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Prodotto / Linea</Label>
              <Input
                value={form.product}
                onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
                placeholder="es. Ruckus R510"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v ?? f.category }))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{catLabel(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 flex flex-col justify-end">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.enabled}
                    onCheckedChange={(c) => setForm((f) => ({ ...f, enabled: c }))}
                  />
                  <Label className="cursor-pointer">Abilitata</Label>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Note (opzionale)</Label>
              <Input
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Note aggiuntive"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvataggio…" : "Salva"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

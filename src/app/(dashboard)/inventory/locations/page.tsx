"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Pencil, Trash2, FolderTree } from "lucide-react";
import { toast } from "sonner";
import type { Location } from "@/types";

export default function LocationsPage() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState<{ name: string; address: string; parent_id: number | null }>({
    name: "", address: "", parent_id: null,
  });
  const [saving, setSaving] = useState(false);

  async function fetchLocations() {
    setLoading(true);
    try {
      const res = await fetch("/api/locations", { cache: "no-store" });
      if (res.ok) setLocations(await res.json());
    } finally { setLoading(false); }
  }
  useEffect(() => { fetchLocations(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", address: "", parent_id: null });
    setDialogOpen(true);
  }
  function openEdit(loc: Location) {
    setEditing(loc);
    setForm({ name: loc.name, address: loc.address ?? "", parent_id: loc.parent_id });
    setDialogOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Nome richiesto"); return; }
    setSaving(true);
    try {
      const body = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        parent_id: form.parent_id,
      };
      const url = editing ? `/api/locations/${editing.id}` : "/api/locations";
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(editing ? "Ubicazione aggiornata" : "Ubicazione creata");
        setDialogOpen(false);
        fetchLocations();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Errore");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSaving(false); }
  }

  async function handleDelete(loc: Location) {
    if (!confirm(`Eliminare "${loc.name}"?`)) return;
    try {
      const res = await fetch(`/api/locations/${loc.id}`, { method: "DELETE" });
      if (res.ok) { toast.success("Ubicazione eliminata"); fetchLocations(); }
      else { toast.error("Errore nell'eliminazione"); }
    } catch { toast.error("Errore di rete"); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/inventory"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FolderTree className="h-6 w-6 text-primary" />
            Ubicazioni
          </h1>
          <p className="text-muted-foreground text-sm">Sedi, edifici, rack o zone fisiche degli asset.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{locations.length} ubicazioni</CardTitle>
            <Button onClick={openCreate} className="gap-1.5"><Plus className="h-4 w-4" />Nuova ubicazione</Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground py-8 text-center">Caricamento...</div>
          ) : locations.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">Nessuna ubicazione. Clicca <b>Nuova ubicazione</b> per aggiungere.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Indirizzo</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((loc) => (
                  <TableRow key={loc.id}>
                    <TableCell className="font-medium">{loc.name}</TableCell>
                    <TableCell className="text-sm">{loc.address ?? "—"}</TableCell>
                    <TableCell className="text-sm">{loc.parent_id ? locations.find((l) => l.id === loc.parent_id)?.name ?? `#${loc.parent_id}` : "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(loc)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDelete(loc)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Modifica ubicazione" : "Nuova ubicazione"}</DialogTitle></DialogHeader>
          <form onSubmit={handleSave} className="space-y-3">
            <div>
              <Label>Nome *</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <Label>Indirizzo</Label>
              <Input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Via X, Città" />
            </div>
            <div>
              <Label>Parent (opzionale)</Label>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                value={form.parent_id ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">— Nessuno</option>
                {locations.filter((l) => l.id !== editing?.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvataggio..." : editing ? "Salva" : "Crea"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

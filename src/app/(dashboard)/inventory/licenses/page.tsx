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
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { License } from "@/types";

export default function LicensesPage() {
  const [licenses, setLicenses] = useState<(License & { used_seats?: number; free_seats?: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<(License & { used_seats?: number; free_seats?: number }) | null>(null);
  const [form, setForm] = useState({ name: "", serial: "", seats: 1, category: "", expiration_date: "", purchase_cost: "", min_amt: 0, note: "" });

  function loadLicenses() {
    fetch("/api/licenses")
      .then((r) => (r.ok ? r.json() : []))
      .then(setLicenses);
  }

  useEffect(() => {
    loadLicenses();
    setLoading(false);
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", serial: "", seats: 1, category: "", expiration_date: "", purchase_cost: "", min_amt: 0, note: "" });
    setDialogOpen(true);
  }

  function openEdit(l: License & { used_seats?: number; free_seats?: number }) {
    setEditing(l);
    setForm({
      name: l.name,
      serial: l.serial ?? "",
      seats: l.seats,
      category: l.category ?? "",
      expiration_date: l.expiration_date ?? "",
      purchase_cost: l.purchase_cost != null ? String(l.purchase_cost) : "",
      min_amt: l.min_amt ?? 0,
      note: l.note ?? "",
    });
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Nome richiesto");
      return;
    }
    try {
      const body = {
        name: form.name.trim(),
        serial: form.serial.trim() || null,
        seats: form.seats,
        category: form.category.trim() || null,
        expiration_date: form.expiration_date.trim() || null,
        purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
        min_amt: form.min_amt,
        note: form.note.trim() || null,
      };
      if (editing) {
        const res = await fetch(`/api/licenses/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          toast.success("Licenza aggiornata");
          setDialogOpen(false);
          loadLicenses();
        } else {
          toast.error((await res.json()).error ?? "Errore");
        }
      } else {
        const res = await fetch("/api/licenses", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          toast.success("Licenza creata");
          setDialogOpen(false);
          loadLicenses();
        } else {
          toast.error((await res.json()).error ?? "Errore");
        }
      }
    } catch {
      toast.error("Errore");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Eliminare questa licenza e tutte le assegnazioni?")) return;
    try {
      const res = await fetch(`/api/licenses/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Eliminata");
        loadLicenses();
      } else {
        toast.error("Errore");
      }
    } catch {
      toast.error("Errore");
    }
  }

  if (loading) return <div className="text-muted-foreground py-8">Caricamento...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/inventory">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Licenze software</h1>
            <p className="text-muted-foreground text-sm">Gestione licenze e assegnazioni a asset</p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Nuova licenza
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Elenco ({licenses.length})</CardTitle></CardHeader>
        <CardContent>
          {licenses.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nessuna licenza. Clicca &quot;Nuova licenza&quot; per aggiungerne.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Posti</TableHead>
                  <TableHead>Scadenza</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {licenses.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="text-muted-foreground">{l.category ?? "—"}</TableCell>
                    <TableCell>
                      <span className={l.free_seats === 0 ? "text-destructive font-medium" : ""}>
                        {l.used_seats ?? 0} / {l.seats}
                      </span>
                      {l.free_seats === 0 && <Badge variant="secondary" className="ml-2">Esaurita</Badge>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {l.expiration_date ? new Date(l.expiration_date).toLocaleDateString("it-IT") : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(l)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(l.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
          <DialogHeader>
            <DialogTitle>{editing ? "Modifica licenza" : "Nuova licenza"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
            <div><Label>Seriale</Label><Input value={form.serial} onChange={(e) => setForm((f) => ({ ...f, serial: e.target.value }))} /></div>
            <div><Label>Numero posti</Label><Input type="number" min={1} value={form.seats} onChange={(e) => setForm((f) => ({ ...f, seats: Number(e.target.value) || 1 }))} /></div>
            <div><Label>Categoria</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Office, Antivirus, ecc." /></div>
            <div><Label>Scadenza</Label><Input type="date" value={form.expiration_date} onChange={(e) => setForm((f) => ({ ...f, expiration_date: e.target.value }))} /></div>
            <div><Label>Prezzo acquisto (€)</Label><Input type="number" step="0.01" value={form.purchase_cost} onChange={(e) => setForm((f) => ({ ...f, purchase_cost: e.target.value }))} /></div>
            <div><Label>Soglia alert posti liberi</Label><Input type="number" min={0} value={form.min_amt} onChange={(e) => setForm((f) => ({ ...f, min_amt: Number(e.target.value) || 0 }))} /></div>
            <div><Label>Note</Label><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></div>
            <Button type="submit" className="w-full">{editing ? "Salva" : "Crea"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

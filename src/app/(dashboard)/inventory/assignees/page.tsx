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
import { ArrowLeft, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { AssetAssignee } from "@/types";

export default function AssetAssigneesPage() {
  const [assignees, setAssignees] = useState<AssetAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AssetAssignee | null>(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", note: "" });

  function loadAssignees() {
    fetch("/api/asset-assignees")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAssignees)
      .catch(() => {});
  }

  useEffect(() => {
    loadAssignees();
    setLoading(false);
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", email: "", phone: "", note: "" });
    setDialogOpen(true);
  }

  function openEdit(a: AssetAssignee) {
    setEditing(a);
    setForm({
      name: a.name,
      email: a.email ?? "",
      phone: a.phone ?? "",
      note: a.note ?? "",
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
      if (editing) {
        const res = await fetch(`/api/asset-assignees/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (res.ok) {
          toast.success("Assegnatario aggiornato");
          setDialogOpen(false);
          loadAssignees();
        } else {
          toast.error((await res.json()).error ?? "Errore");
        }
      } else {
        const res = await fetch("/api/asset-assignees", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        if (res.ok) {
          toast.success("Assegnatario creato");
          setDialogOpen(false);
          loadAssignees();
        } else {
          toast.error((await res.json()).error ?? "Errore");
        }
      }
    } catch {
      toast.error("Errore");
    }
  }

  async function handleDelete(id: number) {
    if (!confirm("Eliminare questo assegnatario?")) return;
    try {
      const res = await fetch(`/api/asset-assignees/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Eliminato");
        loadAssignees();
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
            <h1 className="text-2xl font-bold">Assegnatari asset</h1>
            <p className="text-muted-foreground text-sm">Elenco persone a cui possono essere assegnati gli asset</p>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Nuovo assegnatario
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Elenco ({assignees.length})</CardTitle></CardHeader>
        <CardContent>
          {assignees.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">Nessun assegnatario. Clicca &quot;Nuovo assegnatario&quot; per aggiungerne.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Telefono</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignees.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell className="text-muted-foreground">{a.email ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{a.phone ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(a)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
            <DialogTitle>{editing ? "Modifica assegnatario" : "Nuovo assegnatario"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Telefono</Label><Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div><Label>Note</Label><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></div>
            <Button type="submit" className="w-full">{editing ? "Salva" : "Crea"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

/**
 * /settings/classifications — Gestione classification custom per-tenant.
 *
 * Le classification built-in sono read-only (mostrate in sezione informativa).
 * L'utente può aggiungere/modificare/cancellare solo le custom, che ereditano
 * icona e macro-categoria dal `parent_slug` (built-in obbligatorio).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Pencil, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import {
  DEVICE_CLASSIFICATIONS,
  DEVICE_CLASSIFICATIONS_ORDERED,
  getClassificationLabel,
  getDeviceCategoryGroup,
  DEVICE_CATEGORY_GROUP_LABELS,
  sortClassificationsByDisplayLabel,
} from "@/lib/device-classifications";

interface CustomItem {
  slug: string;
  label: string;
  parent_slug: string;
  created_at: string;
  updated_at: string;
}

const BUILTIN_PARENT_OPTIONS = sortClassificationsByDisplayLabel([...DEVICE_CLASSIFICATIONS]);

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export default function ClassificationsPage() {
  const [items, setItems] = useState<CustomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomItem | null>(null);
  const [formLabel, setFormLabel] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formParent, setFormParent] = useState<string>("server");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/classifications/custom", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setItems(data.items ?? []);
    } catch (e) {
      toast.error(`Errore caricamento: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFormLabel("");
    setFormSlug("");
    setFormParent("server");
    setDialogOpen(true);
  };

  const openEdit = (item: CustomItem) => {
    setEditing(item);
    setFormLabel(item.label);
    setFormSlug(item.slug);
    setFormParent(item.parent_slug);
    setDialogOpen(true);
  };

  const onLabelChange = (v: string) => {
    setFormLabel(v);
    // Auto-fill slug solo in create mode e finché l'utente non l'ha toccato manualmente
    if (!editing) setFormSlug(slugify(v));
  };

  const submit = async () => {
    const label = formLabel.trim();
    if (!label) { toast.error("Label obbligatoria"); return; }
    const slug = editing ? editing.slug : formSlug.trim();
    if (!editing && !/^[a-z][a-z0-9_]{1,63}$/.test(slug)) {
      toast.error("Slug non valido: lowercase, lettere/numeri/_, inizia per lettera");
      return;
    }
    setSaving(true);
    try {
      const url = editing ? `/api/classifications/custom/${encodeURIComponent(slug)}` : "/api/classifications/custom";
      const method = editing ? "PUT" : "POST";
      const body = editing ? { label, parent_slug: formParent } : { slug, label, parent_slug: formParent };
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      toast.success(editing ? "Classification aggiornata" : "Classification creata");
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: CustomItem) => {
    if (!confirm(`Cancellare la classification "${item.label}" (${item.slug})?`)) return;
    try {
      const r = await fetch(`/api/classifications/custom/${encodeURIComponent(item.slug)}`, { method: "DELETE" });
      if (r.status === 204) {
        toast.success("Cancellata");
        await load();
        return;
      }
      const data = await r.json().catch(() => ({}));
      throw new Error(data?.error ?? `HTTP ${r.status}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const builtinRows = useMemo(() => {
    return DEVICE_CLASSIFICATIONS_ORDERED.map((slug) => ({
      slug,
      label: getClassificationLabel(slug),
      group: DEVICE_CATEGORY_GROUP_LABELS[getDeviceCategoryGroup(slug)],
    }));
  }, []);

  return (
    <div className="container mx-auto p-4 space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <Link href="/settings"><Button variant="ghost" size="sm"><ChevronLeft className="h-4 w-4 mr-1" />Settings</Button></Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Classification custom</CardTitle>
              <CardDescription>
                Sotto-categorie utente di una classification built-in. Ereditano icona e macro-categoria dal parent.
                Lo slug è immutabile dopo la creazione perché referenziato da <code>hosts.classification</code>.
              </CardDescription>
            </div>
            <Button onClick={openCreate} size="sm"><Plus className="h-4 w-4 mr-1" />Aggiungi</Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Caricamento…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nessuna classification custom. Utile quando vuoi distinguere una sotto-categoria di un built-in
              (es. <code>server_postgres</code> figlio di <code>server</code>).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Parent</TableHead>
                  <TableHead>Macro-categoria</TableHead>
                  <TableHead className="text-right">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.slug}>
                    <TableCell className="font-medium">{it.label}</TableCell>
                    <TableCell><code className="text-xs">{it.slug}</code></TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{getClassificationLabel(it.parent_slug)}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {DEVICE_CATEGORY_GROUP_LABELS[getDeviceCategoryGroup(it.parent_slug)]}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(it)} title="Modifica"><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => remove(it)} title="Elimina" className="text-destructive"><Trash2 className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classification built-in (read-only)</CardTitle>
          <CardDescription>
            Catalogo di sistema. Non modificabili — sono referenziate dall&apos;auto-classifier e dalle regole di fingerprinting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1 text-xs">
            {builtinRows.map((r) => (
              <div key={r.slug} className="flex items-center justify-between gap-2 border rounded px-2 py-1 bg-muted/20">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.label}</div>
                  <code className="text-[10px] text-muted-foreground">{r.slug}</code>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">{r.group}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Modifica "${editing.label}"` : "Nuova classification custom"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 px-1">
            <div className="space-y-1">
              <Label className="text-xs">Label visibile</Label>
              <Input
                value={formLabel}
                onChange={(e) => onLabelChange(e.target.value)}
                placeholder="Es. Server PostgreSQL"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Slug {editing && <span className="text-muted-foreground">(non modificabile)</span>}</Label>
              <Input
                value={formSlug}
                onChange={(e) => setFormSlug(slugify(e.target.value))}
                placeholder="server_postgres"
                disabled={!!editing}
              />
              <p className="text-[11px] text-muted-foreground">Lowercase, lettere/numeri/_, inizia per lettera. Auto-generato dalla label.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Categoria parent (built-in)</Label>
              <select
                value={formParent}
                onChange={(e) => setFormParent(e.target.value)}
                className="w-full h-9 text-sm border rounded px-2 bg-background"
              >
                {BUILTIN_PARENT_OPTIONS.map((slug) => (
                  <option key={slug} value={slug}>
                    {getClassificationLabel(slug)} ({DEVICE_CATEGORY_GROUP_LABELS[getDeviceCategoryGroup(slug)]})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">Da cui eredita icona e macro-categoria nei filtri/grafici.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Annulla</Button>
            <Button onClick={submit} disabled={saving || !formLabel.trim()}>
              {saving ? "Salvataggio…" : editing ? "Salva" : "Crea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

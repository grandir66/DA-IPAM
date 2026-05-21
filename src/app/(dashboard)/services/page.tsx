"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Workflow, Plus, ExternalLink, Search, Shield } from "lucide-react";
import { toast } from "sonner";
import type { ServiceWithDeps, ServiceInput, AssetAssignee } from "@/types";
import { AddableSelect } from "@/components/shared/addable-select";

const CRITICITA = [
  { value: "bassa", label: "Bassa" },
  { value: "media", label: "Media" },
  { value: "alta", label: "Alta" },
  { value: "critica", label: "Critica" },
];

const STATI = [
  { value: "attivo", label: "Attivo" },
  { value: "in_dismissione", label: "In dismissione" },
  { value: "dismesso", label: "Dismesso" },
];

const criticitaColor: Record<string, string> = {
  critica: "bg-red-500/15 text-red-700 border-red-300/40 dark:text-red-400",
  alta: "bg-orange-500/15 text-orange-700 border-orange-300/40 dark:text-orange-400",
  media: "bg-yellow-500/15 text-yellow-700 border-yellow-300/40 dark:text-yellow-400",
  bassa: "bg-emerald-500/15 text-emerald-700 border-emerald-300/40 dark:text-emerald-400",
};

export default function ServicesPage() {
  const [services, setServices] = useState<ServiceWithDeps[]>([]);
  const [assignees, setAssignees] = useState<AssetAssignee[]>([]);
  const [q, setQ] = useState("");
  const [stato, setStato] = useState("");
  const [scopeNis2, setScopeNis2] = useState("");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<Partial<ServiceInput>>({ stato: "attivo", in_scope_nis2: 1 });
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (stato) params.set("stato", stato);
      if (scopeNis2) params.set("in_scope_nis2", scopeNis2);
      const res = await fetch(`/api/services?${params}`, { cache: "no-store" });
      if (res.ok) setServices(await res.json());
    } finally { setLoading(false); }
  }, [q, stato, scopeNis2]);

  const refetchAssignees = useCallback(async () => {
    const r = await fetch("/api/asset-assignees", { cache: "no-store" });
    if (r.ok) setAssignees(await r.json());
  }, []);
  useEffect(() => { refetchAssignees().catch(() => {}); }, [refetchAssignees]);
  useEffect(() => {
    const t = setTimeout(fetchAll, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchAll, q]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name?.trim()) { toast.error("Nome richiesto"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast.success("Servizio creato");
        setCreateOpen(false);
        setForm({ stato: "attivo", in_scope_nis2: 1 });
        fetchAll();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Errore nella creazione");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Workflow className="h-7 w-7 text-primary" />
          Servizi e dipendenze
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          NIS2 §12.4.2a — Mappa dei servizi business e degli asset da cui dipendono. Permette impact analysis e
          identificazione delle catene critiche in caso di compromissione di un asset.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Catalogo servizi ({services.length})
            </CardTitle>
            <div className="flex flex-wrap gap-2 items-center">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cerca per nome..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-8 w-48"
                />
              </div>
              <Select value={stato} onValueChange={(v) => setStato(v ?? "")}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Stato" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutti</SelectItem>
                  {STATI.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={scopeNis2} onValueChange={(v) => setScopeNis2(v ?? "")}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Scope NIS2" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Tutti</SelectItem>
                  <SelectItem value="1">Solo in scope NIS2</SelectItem>
                  <SelectItem value="0">Fuori scope</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> Nuovo servizio
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-muted-foreground py-12 text-center">Caricamento...</div>
          ) : services.length === 0 ? (
            <div className="text-muted-foreground py-12 text-center">
              Nessun servizio. Clicca <b>Nuovo servizio</b> per cominciare.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Stato</TableHead>
                  <TableHead>NIS2</TableHead>
                  <TableHead>Criticità</TableHead>
                  <TableHead>RTO</TableHead>
                  <TableHead>RPO</TableHead>
                  <TableHead>Business owner</TableHead>
                  <TableHead className="text-right">Asset linkati</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <Link href={`/services/${s.id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                        {s.name} <ExternalLink className="h-3 w-3 opacity-50" />
                      </Link>
                      {s.description && <div className="text-xs text-muted-foreground truncate max-w-[300px]">{s.description}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {STATI.find((x) => x.value === s.stato)?.label ?? s.stato}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {s.in_scope_nis2 ? (
                        <Badge className="bg-blue-500/15 text-blue-700 border-blue-300/40 dark:text-blue-400 text-xs">
                          <Shield className="h-3 w-3 mr-1" />NIS2
                        </Badge>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell>
                      {s.criticita_servizio ? (
                        <Badge variant="outline" className={`text-xs ${criticitaColor[s.criticita_servizio] ?? ""}`}>
                          {s.criticita_servizio}
                        </Badge>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                    <TableCell className="text-sm">{s.rto_minutes != null ? `${s.rto_minutes} min` : "—"}</TableCell>
                    <TableCell className="text-sm">{s.rpo_minutes != null ? `${s.rpo_minutes} min` : "—"}</TableCell>
                    <TableCell className="text-sm">{s.business_owner_name ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm">
                      <span className="font-medium">{s.n_assets ?? 0}</span>
                      {(s.n_assets_primario ?? 0) > 0 && (
                        <span className="text-xs text-muted-foreground ml-1">({s.n_assets_primario} primari)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/services/${s.id}`}>
                        <Button variant="ghost" size="sm">Apri</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Nuovo servizio</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nome *</Label>
                <Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="col-span-2">
                <Label>Descrizione</Label>
                <Textarea rows={2} value={form.description ?? ""} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div>
                <Label>Stato</Label>
                <Select value={form.stato ?? "attivo"} onValueChange={(v) => setForm((f) => ({ ...f, stato: v as ServiceInput["stato"] }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STATI.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Criticità</Label>
                <Select value={form.criticita_servizio ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, criticita_servizio: (v || null) as ServiceInput["criticita_servizio"] }))}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">—</SelectItem>
                    {CRITICITA.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 col-span-2">
                <input type="checkbox" id="svc_in_scope_nis2" checked={!!form.in_scope_nis2} onChange={(e) => setForm((f) => ({ ...f, in_scope_nis2: e.target.checked ? 1 : 0 }))} className="rounded" />
                <Label htmlFor="svc_in_scope_nis2">In scope NIS2</Label>
              </div>
              <div>
                <Label>RTO (minuti)</Label>
                <Input type="number" min={0} value={form.rto_minutes ?? ""} onChange={(e) => setForm((f) => ({ ...f, rto_minutes: e.target.value ? Number(e.target.value) : null }))} placeholder="es. 60" />
              </div>
              <div>
                <Label>RPO (minuti)</Label>
                <Input type="number" min={0} value={form.rpo_minutes ?? ""} onChange={(e) => setForm((f) => ({ ...f, rpo_minutes: e.target.value ? Number(e.target.value) : null }))} placeholder="es. 15" />
              </div>
              <div>
                <Label>Business owner</Label>
                <AddableSelect
                  value={form.business_owner_id ?? null}
                  onChange={(v) => setForm((f) => ({ ...f, business_owner_id: v }))}
                  options={assignees.map((a) => ({ id: a.id, label: a.name, extra: a.email ?? undefined }))}
                  entityLabel="assegnatario"
                  createApiUrl="/api/asset-assignees"
                  extraFields={[{ key: "email", label: "Email", placeholder: "nome@dominio.it", type: "email" }, { key: "phone", label: "Telefono" }]}
                  onCreated={() => refetchAssignees()}
                />
              </div>
              <div>
                <Label>Technical owner</Label>
                <AddableSelect
                  value={form.technical_owner_id ?? null}
                  onChange={(v) => setForm((f) => ({ ...f, technical_owner_id: v }))}
                  options={assignees.map((a) => ({ id: a.id, label: a.name, extra: a.email ?? undefined }))}
                  entityLabel="assegnatario"
                  createApiUrl="/api/asset-assignees"
                  extraFields={[{ key: "email", label: "Email", placeholder: "nome@dominio.it", type: "email" }, { key: "phone", label: "Telefono" }]}
                  onCreated={() => refetchAssignees()}
                />
              </div>
              <div className="col-span-2">
                <Label>URL SLA</Label>
                <Input value={form.sla_url ?? ""} onChange={(e) => setForm((f) => ({ ...f, sla_url: e.target.value || null }))} placeholder="https://..." />
              </div>
              <div className="col-span-2">
                <Label>Note</Label>
                <Textarea rows={2} value={form.note ?? ""} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value || null }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvataggio..." : "Crea"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

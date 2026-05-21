"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
import { ArrowLeft, Plus, Trash2, ExternalLink, Save, Shield, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { Service, ServiceInput, ServiceAssetDependency, AssetAssignee, InventoryAsset } from "@/types";

type ServiceDetail = Service & {
  business_owner_name?: string | null;
  technical_owner_name?: string | null;
  dependencies: Array<ServiceAssetDependency & { asset_tag: string | null; hostname: string | null; nome_prodotto: string | null; criticita_nis2: string | null }>;
};

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
const DEP_TYPES = [
  { value: "primario", label: "Primario" },
  { value: "secondario", label: "Secondario" },
  { value: "supporto", label: "Supporto" },
];

export default function ServiceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = Number(params.id);
  const [service, setService] = useState<ServiceDetail | null>(null);
  const [form, setForm] = useState<Partial<ServiceInput>>({});
  const [assignees, setAssignees] = useState<AssetAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assets, setAssets] = useState<InventoryAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [depType, setDepType] = useState("primario");
  const [depNote, setDepNote] = useState("");

  const fetchService = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/services/${id}`, { cache: "no-store" });
      if (res.ok) {
        const data = await res.json() as ServiceDetail;
        setService(data);
        setForm({
          name: data.name, description: data.description, stato: data.stato,
          criticita_servizio: data.criticita_servizio, in_scope_nis2: data.in_scope_nis2,
          rto_minutes: data.rto_minutes, rpo_minutes: data.rpo_minutes,
          business_owner_id: data.business_owner_id, technical_owner_id: data.technical_owner_id,
          sla_url: data.sla_url, note: data.note,
        });
      } else { setService(null); }
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchService(); }, [fetchService]);
  useEffect(() => {
    fetch("/api/asset-assignees").then((r) => r.ok ? r.json() : []).then((d) => setAssignees(Array.isArray(d) ? d : []));
    fetch("/api/inventory?limit=1000").then((r) => r.ok ? r.json() : []).then((d) => setAssets(Array.isArray(d) ? d : []));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/services/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) { toast.success("Servizio aggiornato"); fetchService(); }
      else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Errore");
      }
    } catch { toast.error("Errore di rete"); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!confirm(`Eliminare il servizio "${service?.name}"? Le dipendenze su asset verranno rimosse.`)) return;
    try {
      const res = await fetch(`/api/services/${id}`, { method: "DELETE" });
      if (res.ok) { toast.success("Servizio eliminato"); router.push("/services"); }
      else { toast.error("Errore nell'eliminazione"); }
    } catch { toast.error("Errore di rete"); }
  }

  async function handleAttach(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAssetId) return;
    try {
      const res = await fetch(`/api/services/${id}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_id: Number(selectedAssetId), dependency_type: depType, note: depNote || null }),
      });
      if (res.ok) {
        toast.success("Asset collegato");
        setAddOpen(false);
        setSelectedAssetId(""); setDepType("primario"); setDepNote("");
        fetchService();
      } else { toast.error("Errore nel collegamento"); }
    } catch { toast.error("Errore di rete"); }
  }

  async function handleDetach(assetId: number) {
    if (!confirm("Rimuovere il collegamento di questo asset al servizio?")) return;
    try {
      const res = await fetch(`/api/services/${id}/assets?asset_id=${assetId}`, { method: "DELETE" });
      if (res.ok) { toast.success("Asset scollegato"); fetchService(); }
      else { toast.error("Errore"); }
    } catch { toast.error("Errore di rete"); }
  }

  if (loading) return <div className="text-muted-foreground py-8">Caricamento...</div>;
  if (!service) return <div className="text-muted-foreground py-8">Servizio non trovato</div>;

  const primariCount = service.dependencies.filter((d) => d.dependency_type === "primario").length;
  const noAssetsWarning = service.in_scope_nis2 && primariCount === 0;
  const linkedAssetIds = new Set(service.dependencies.map((d) => d.asset_id));
  const availableAssets = assets.filter((a) => !linkedAssetIds.has(a.id));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <Link href="/services"><Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {service.name}
              {service.in_scope_nis2 ? <Badge className="bg-blue-500/15 text-blue-700 border-blue-300/40 dark:text-blue-400 text-xs"><Shield className="h-3 w-3 mr-1" />NIS2</Badge> : null}
            </h1>
            <p className="text-muted-foreground text-sm">Servizio NIS2 — {service.dependencies.length} asset linkati ({primariCount} primari)</p>
          </div>
        </div>
        <Button variant="outline" className="text-destructive" onClick={handleDelete}>
          <Trash2 className="h-4 w-4 mr-1.5" />Elimina
        </Button>
      </div>

      {noAssetsWarning && (
        <div className="rounded-md border bg-amber-500/10 border-amber-500/40 p-3 text-sm flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
          <span>
            <b>Servizio in scope NIS2 senza asset primari</b>: una mappa di dipendenze accurata è richiesta per impact analysis (art. 21 NIS2).
            Collega almeno un asset critico come <i>primario</i>.
          </span>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Anagrafica servizio</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSave} className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Nome</Label><Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
            <div className="col-span-2"><Label>Descrizione</Label><Textarea rows={2} value={form.description ?? ""} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
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
                <SelectContent><SelectItem value="">—</SelectItem>{CRITICITA.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <input type="checkbox" id="svc_scope" checked={!!form.in_scope_nis2} onChange={(e) => setForm((f) => ({ ...f, in_scope_nis2: e.target.checked ? 1 : 0 }))} className="rounded" />
              <Label htmlFor="svc_scope">In scope NIS2</Label>
            </div>
            <div><Label>RTO (min)</Label><Input type="number" min={0} value={form.rto_minutes ?? ""} onChange={(e) => setForm((f) => ({ ...f, rto_minutes: e.target.value ? Number(e.target.value) : null }))} /></div>
            <div><Label>RPO (min)</Label><Input type="number" min={0} value={form.rpo_minutes ?? ""} onChange={(e) => setForm((f) => ({ ...f, rpo_minutes: e.target.value ? Number(e.target.value) : null }))} /></div>
            <div>
              <Label>Business owner</Label>
              <Select value={form.business_owner_id != null ? String(form.business_owner_id) : "none"} onValueChange={(v) => setForm((f) => ({ ...f, business_owner_id: v === "none" ? null : Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                <SelectContent><SelectItem value="none">— Nessuno</SelectItem>{assignees.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Technical owner</Label>
              <Select value={form.technical_owner_id != null ? String(form.technical_owner_id) : "none"} onValueChange={(v) => setForm((f) => ({ ...f, technical_owner_id: v === "none" ? null : Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Seleziona" /></SelectTrigger>
                <SelectContent><SelectItem value="none">— Nessuno</SelectItem>{assignees.map((a) => <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>URL SLA</Label><Input value={form.sla_url ?? ""} onChange={(e) => setForm((f) => ({ ...f, sla_url: e.target.value || null }))} placeholder="https://..." /></div>
            <div className="col-span-2"><Label>Note</Label><Textarea rows={2} value={form.note ?? ""} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value || null }))} /></div>
            <div className="col-span-2 flex justify-end">
              <Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1.5" />{saving ? "Salvataggio..." : "Salva"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Asset di cui il servizio dipende ({service.dependencies.length})</CardTitle>
            <Button size="sm" onClick={() => setAddOpen(true)} disabled={availableAssets.length === 0}>
              <Plus className="h-4 w-4 mr-1.5" />Collega asset
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {service.dependencies.length === 0 ? (
            <div className="text-muted-foreground py-8 text-center">Nessun asset collegato. Aggiungi le dipendenze per abilitare l&apos;impact analysis.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Tipo dipendenza</TableHead>
                  <TableHead>Criticità asset</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {service.dependencies.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link href={`/inventory/${d.asset_id}`} className="text-primary hover:underline inline-flex items-center gap-1">
                        {d.asset_tag ?? d.hostname ?? d.nome_prodotto ?? `Asset #${d.asset_id}`}
                        <ExternalLink className="h-3 w-3 opacity-50" />
                      </Link>
                      {d.hostname && d.asset_tag && d.hostname !== d.asset_tag && <div className="text-xs text-muted-foreground">{d.hostname}</div>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{DEP_TYPES.find((x) => x.value === d.dependency_type)?.label ?? d.dependency_type}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{d.criticita_nis2 ?? "—"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">{d.note ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDetach(d.asset_id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Collega asset al servizio</DialogTitle></DialogHeader>
          <form onSubmit={handleAttach} className="space-y-3">
            <div>
              <Label>Asset</Label>
              <Select value={selectedAssetId} onValueChange={(v) => setSelectedAssetId(v ?? "")}>
                <SelectTrigger><SelectValue placeholder="Seleziona asset..." /></SelectTrigger>
                <SelectContent>
                  {availableAssets.slice(0, 200).map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>
                      {a.asset_tag ?? a.hostname ?? a.nome_prodotto ?? `Asset #${a.id}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {availableAssets.length > 200 && <p className="text-xs text-muted-foreground mt-1">Mostrati i primi 200. Cerca per nome se non trovi.</p>}
            </div>
            <div>
              <Label>Tipo dipendenza</Label>
              <Select value={depType} onValueChange={(v) => setDepType(v ?? "primario")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEP_TYPES.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                <b>Primario</b>: il servizio non funziona senza. <b>Secondario</b>: degrado funzionale. <b>Supporto</b>: utile ma non critico.
              </p>
            </div>
            <div>
              <Label>Note (opzionale)</Label>
              <Textarea rows={2} value={depNote} onChange={(e) => setDepNote(e.target.value)} placeholder="es. master database, fallback su replica..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>Annulla</Button>
              <Button type="submit" disabled={!selectedAssetId}>Collega</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

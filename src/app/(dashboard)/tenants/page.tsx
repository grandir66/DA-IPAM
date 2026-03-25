"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Building2, Wand2 } from "lucide-react";
import { toast } from "sonner";

interface Tenant {
  id: number;
  codice_cliente: string;
  ragione_sociale: string;
  indirizzo: string | null;
  citta: string | null;
  provincia: string | null;
  cap: string | null;
  telefono: string | null;
  email: string | null;
  piva: string | null;
  cf: string | null;
  referente: string | null;
  note: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

type TenantForm = {
  codice_cliente: string;
  ragione_sociale: string;
  indirizzo: string;
  citta: string;
  provincia: string;
  cap: string;
  telefono: string;
  email: string;
  piva: string;
  cf: string;
  referente: string;
  note: string;
  active: boolean;
};

const emptyForm: TenantForm = {
  codice_cliente: "",
  ragione_sociale: "",
  indirizzo: "",
  citta: "",
  provincia: "",
  cap: "",
  telefono: "",
  email: "",
  piva: "",
  cf: "",
  referente: "",
  note: "",
  active: true,
};

export default function TenantsPage() {
  const router = useRouter();
  const { data: session, update: updateSession } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isSuperadmin = role === "superadmin";

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<TenantForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const loadTenants = () => {
    fetch("/api/tenants")
      .then((r) => r.json())
      .then((data: Tenant[]) => {
        setTenants(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Errore nel caricamento dei clienti");
        setLoading(false);
      });
  };

  useEffect(() => {
    loadTenants();
  }, []);

  // Redirect non-superadmin
  useEffect(() => {
    if (session && !isSuperadmin) {
      router.replace("/");
    }
  }, [session, isSuperadmin, router]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (tenant: Tenant) => {
    setEditingId(tenant.id);
    setForm({
      codice_cliente: tenant.codice_cliente,
      ragione_sociale: tenant.ragione_sociale,
      indirizzo: tenant.indirizzo ?? "",
      citta: tenant.citta ?? "",
      provincia: tenant.provincia ?? "",
      cap: tenant.cap ?? "",
      telefono: tenant.telefono ?? "",
      email: tenant.email ?? "",
      piva: tenant.piva ?? "",
      cf: tenant.cf ?? "",
      referente: tenant.referente ?? "",
      note: tenant.note ?? "",
      active: tenant.active === 1,
    });
    setDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.codice_cliente.trim() || !form.ragione_sociale.trim()) {
      toast.error("Codice cliente e ragione sociale sono obbligatori");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        codice_cliente: form.codice_cliente.trim(),
        ragione_sociale: form.ragione_sociale.trim(),
        indirizzo: form.indirizzo.trim() || undefined,
        citta: form.citta.trim() || undefined,
        provincia: form.provincia.trim() || undefined,
        cap: form.cap.trim() || undefined,
        telefono: form.telefono.trim() || undefined,
        email: form.email.trim() || undefined,
        piva: form.piva.trim() || undefined,
        cf: form.cf.trim() || undefined,
        referente: form.referente.trim() || undefined,
        note: form.note.trim() || undefined,
        ...(editingId != null ? { active: form.active ? 1 : 0 } : {}),
      };

      const url = editingId != null ? `/api/tenants/${editingId}` : "/api/tenants";
      const method = editingId != null ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let errorData: { error?: string } = {};
        try {
          errorData = await res.json() as { error?: string };
        } catch { /* ignore */ }
        throw new Error(errorData.error || "Errore nel salvataggio");
      }

      toast.success(editingId != null ? "Cliente aggiornato" : "Cliente creato");
      setDialogOpen(false);
      loadTenants();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore nel salvataggio");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tenant: Tenant) => {
    if (!confirm(`Eliminare il cliente "${tenant.ragione_sociale}" (${tenant.codice_cliente})? Verranno eliminati anche tutti i dati associati. L'azione è irreversibile.`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenant.id}`, { method: "DELETE" });
      if (!res.ok) {
        let errorData: { error?: string } = {};
        try {
          errorData = await res.json() as { error?: string };
        } catch { /* ignore */ }
        throw new Error(errorData.error || "Errore nell'eliminazione");
      }
      toast.success("Cliente eliminato");
      loadTenants();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore nell'eliminazione");
    }
  };

  const handleConfigure = async (tenant: Tenant) => {
    try {
      // Switch JWT al tenant selezionato
      await updateSession({ tenantCode: tenant.codice_cliente });
      // Reset onboarding flag per questo tenant
      await fetch("/api/onboarding/reset", { method: "POST" });
      // Naviga al wizard
      router.push("/onboarding");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore nella configurazione");
    }
  };

  if (!isSuperadmin) {
    return null;
  }

  const updateField = (field: keyof TenantForm, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gestione Clienti</h1>
          <p className="text-muted-foreground mt-1">
            Gestisci i clienti (tenant) del sistema.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger render={<Button onClick={openCreate} />}>
            <Plus className="h-4 w-4 mr-2" />
            Nuovo Cliente
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId != null ? "Modifica Cliente" : "Nuovo Cliente"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="codice_cliente">Codice Cliente *</Label>
                  <Input
                    id="codice_cliente"
                    value={form.codice_cliente}
                    onChange={(e) => updateField("codice_cliente", e.target.value)}
                    placeholder="es. ACME01"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ragione_sociale">Ragione Sociale *</Label>
                  <Input
                    id="ragione_sociale"
                    value={form.ragione_sociale}
                    onChange={(e) => updateField("ragione_sociale", e.target.value)}
                    placeholder="es. ACME S.r.l."
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="indirizzo">Indirizzo</Label>
                <Input
                  id="indirizzo"
                  value={form.indirizzo}
                  onChange={(e) => updateField("indirizzo", e.target.value)}
                  placeholder="Via/Piazza..."
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="citta">Città</Label>
                  <Input
                    id="citta"
                    value={form.citta}
                    onChange={(e) => updateField("citta", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provincia">Provincia</Label>
                  <Input
                    id="provincia"
                    value={form.provincia}
                    onChange={(e) => updateField("provincia", e.target.value)}
                    placeholder="es. MI"
                    maxLength={2}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cap">CAP</Label>
                  <Input
                    id="cap"
                    value={form.cap}
                    onChange={(e) => updateField("cap", e.target.value)}
                    maxLength={5}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="telefono">Telefono</Label>
                  <Input
                    id="telefono"
                    value={form.telefono}
                    onChange={(e) => updateField("telefono", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={form.email}
                    onChange={(e) => updateField("email", e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="piva">Partita IVA</Label>
                  <Input
                    id="piva"
                    value={form.piva}
                    onChange={(e) => updateField("piva", e.target.value)}
                    maxLength={11}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cf">Codice Fiscale</Label>
                  <Input
                    id="cf"
                    value={form.cf}
                    onChange={(e) => updateField("cf", e.target.value)}
                    maxLength={16}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="referente">Referente</Label>
                <Input
                  id="referente"
                  value={form.referente}
                  onChange={(e) => updateField("referente", e.target.value)}
                  placeholder="Nome e cognome del referente"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="note">Note</Label>
                <Textarea
                  id="note"
                  value={form.note}
                  onChange={(e) => updateField("note", e.target.value)}
                  rows={3}
                />
              </div>

              {editingId != null && (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={form.active}
                    onCheckedChange={(checked) => updateField("active", checked)}
                  />
                  <Label>Cliente attivo</Label>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Annulla
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvataggio..." : editingId != null ? "Salva Modifiche" : "Crea Cliente"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Clienti ({tenants.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              Caricamento...
            </p>
          ) : tenants.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">
              Nessun cliente configurato. Crea il primo cliente per iniziare.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Codice</TableHead>
                    <TableHead>Ragione Sociale</TableHead>
                    <TableHead>Città</TableHead>
                    <TableHead>Referente</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead className="text-right">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((tenant) => (
                    <TableRow key={tenant.id}>
                      <TableCell className="font-mono font-medium">
                        {tenant.codice_cliente}
                      </TableCell>
                      <TableCell className="font-medium">
                        {tenant.ragione_sociale}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {tenant.citta ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {tenant.referente ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {tenant.email ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tenant.active === 1 ? "default" : "secondary"}>
                          {tenant.active === 1 ? "Attivo" : "Disattivato"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleConfigure(tenant)}
                            className="text-primary border-primary/30 hover:bg-primary/10"
                          >
                            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                            Configura
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(tenant)}
                            title="Modifica anagrafica"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(tenant)}
                            title="Elimina"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

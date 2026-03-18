"use client";

import { useEffect, useState } from "react";
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
import { Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

interface Credential {
  id: number;
  name: string;
  credential_type: string;
  encrypted_username: string | null;
  encrypted_password: string | null;
  created_at: string;
  updated_at: string;
}

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", credential_type: "ssh" as "ssh" | "snmp" | "api" | "windows" | "linux", username: "", password: "" });
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testCredId, setTestCredId] = useState<number | null>(null);
  const [testHost, setTestHost] = useState("");
  const [testPort, setTestPort] = useState("");

  const fetchCredentials = async () => {
    try {
      const res = await fetch("/api/credentials");
      if (res.ok) {
        const data = await res.json();
        setCredentials(data);
      }
    } catch {
      toast.error("Errore nel caricamento delle credenziali");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Nome richiesto");
      return;
    }
    if ((form.credential_type === "ssh" || form.credential_type === "api" || form.credential_type === "windows" || form.credential_type === "linux") && (!form.username || !form.password)) {
      toast.error("Username e password richiesti");
      return;
    }
    if (form.credential_type === "snmp" && !editingId && !form.password?.trim()) {
      toast.error("Community string richiesta per credenziali SNMP");
      return;
    }
    try {
      const url = editingId ? `/api/credentials/${editingId}` : "/api/credentials";
      const method = editingId ? "PUT" : "POST";
      const body = editingId
        ? { name: form.name, credential_type: form.credential_type, username: form.username || undefined, password: form.password || undefined }
        : form;
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Errore");
      }
      toast.success(editingId ? "Credenziale aggiornata" : "Credenziale creata");
      setDialogOpen(false);
      setEditingId(null);
      setForm({ name: "", credential_type: "ssh" as const, username: "", password: "" });
      fetchCredentials();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Eliminare questa credenziale?")) return;
    try {
      const res = await fetch(`/api/credentials/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Errore");
      toast.success("Credenziale eliminata");
      fetchCredentials();
    } catch {
      toast.error("Errore nell'eliminazione");
    }
  };

  const openEdit = async (c: Credential) => {
    setEditingId(c.id);
    let username = "";
    if (c.credential_type === "ssh" || c.credential_type === "api" || c.credential_type === "windows" || c.credential_type === "linux") {
      try {
        const res = await fetch(`/api/credentials/${c.id}?for_edit=1`);
        if (res.ok) {
          const data = await res.json();
          username = data.username ?? "";
        }
      } catch { /* ignore */ }
    }
    setForm({ name: c.name, credential_type: c.credential_type as "ssh" | "snmp" | "api" | "windows" | "linux", username, password: "" });
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", credential_type: "ssh" as const, username: "", password: "" });
    setDialogOpen(true);
  };

  const openTestDialog = (c: Credential) => {
    setTestCredId(c.id);
    setTestHost("");
    const defaultPort = c.credential_type === "ssh" || c.credential_type === "linux" ? "22" : c.credential_type === "windows" ? "5985" : c.credential_type === "snmp" ? "161" : "";
    setTestPort(defaultPort);
    setTestDialogOpen(true);
  };

  const handleTest = async () => {
    if (!testCredId || !testHost.trim()) {
      toast.error("Inserisci l'indirizzo IP o hostname");
      return;
    }
    setTestingId(testCredId);
    try {
      const body: { host: string; port?: number } = { host: testHost.trim() };
      const portNum = parseInt(testPort, 10);
      if (!isNaN(portNum) && portNum > 0) body.port = portNum;
      const res = await fetch(`/api/credentials/${testCredId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message || "Test riuscito");
        setTestDialogOpen(false);
      } else {
        toast.error(data.error || "Test fallito");
      }
    } catch {
      toast.error("Errore nel test");
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Credenziali riutilizzabili</h1>
        <p className="text-muted-foreground mt-1">
          Gestisci credenziali per dispositivi di rete (SSH, SNMP, API) e per host Windows/Linux.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Elenco credenziali</CardTitle>
            <CardDescription>Usa credential_id nel dispositivo per riferire una credenziale.</CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Nuova credenziale
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingId ? "Modifica credenziale" : "Nuova credenziale"}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label>Nome</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="es. Admin MikroTik"
                  />
                </div>
                <div>
                  <Label>Tipo</Label>
                  <Select
                    value={form.credential_type}
                    onValueChange={(v) => setForm((f) => ({ ...f, credential_type: v as "ssh" | "snmp" | "api" | "windows" | "linux" }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ssh">SSH (dispositivi)</SelectItem>
                      <SelectItem value="snmp">SNMP</SelectItem>
                      <SelectItem value="api">API</SelectItem>
                      <SelectItem value="windows">Windows (host)</SelectItem>
                      <SelectItem value="linux">Linux (host)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {(form.credential_type === "ssh" || form.credential_type === "api" || form.credential_type === "windows" || form.credential_type === "linux") && (
                  <>
                    <div>
                      <Label>Username</Label>
                      <Input
                        value={form.username}
                        onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                        placeholder="es. admin o DOMINIO\\utente"
                      />
                    </div>
                    <div>
                      <Label>Password {editingId && "(lascia vuoto per non modificare)"}</Label>
                      <Input
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="••••••••"
                      />
                    </div>
                  </>
                )}
                {form.credential_type === "snmp" && (
                  <div>
                    <Label>Community string {editingId && "(lascia vuoto per non modificare)"}</Label>
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="es. public"
                    />
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                    Annulla
                  </Button>
                  <Button type="submit">Salva</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={testDialogOpen} onOpenChange={(open) => { setTestDialogOpen(open); if (!open) setTestCredId(null); }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Test connessione</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Inserisci l&apos;indirizzo IP o hostname del dispositivo su cui provare le credenziali.
              </p>
              <div className="space-y-4">
                <div>
                  <Label>IP o hostname</Label>
                  <Input
                    value={testHost}
                    onChange={(e) => setTestHost(e.target.value)}
                    placeholder="es. 192.168.1.1"
                  />
                </div>
                <div>
                  <Label>Porta (opzionale)</Label>
                  <Input
                    value={testPort}
                    onChange={(e) => setTestPort(e.target.value)}
                    placeholder="SSH: 22, SNMP: 161, WinRM: 5985"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setTestDialogOpen(false)}>
                    Annulla
                  </Button>
                  <Button onClick={handleTest} disabled={!testHost.trim() || testingId !== null}>
                    {testingId ? "Test in corso..." : "Esegui test"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">Caricamento...</p>
          ) : credentials.length === 0 ? (
            <p className="text-muted-foreground">Nessuna credenziale. Clicca &quot;Nuova credenziale&quot; per aggiungerne una.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead className="w-[100px]">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <span className="uppercase text-xs">{c.credential_type}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.encrypted_username ? "●●●●●●●●" : "—"}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {(c.credential_type === "ssh" || c.credential_type === "snmp" || c.credential_type === "windows" || c.credential_type === "linux") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openTestDialog(c)}
                            disabled={testingId === c.id}
                            title="Test connessione su host"
                          >
                            {testingId === c.id ? "..." : "Test"}
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(c.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

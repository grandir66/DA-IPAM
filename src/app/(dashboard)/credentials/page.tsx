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
import { Plus, Trash2, Pencil, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { WinRMSetupGuideDialog } from "@/components/shared/winrm-setup-guide-dialog";

interface Credential {
  id: number;
  name: string;
  credential_type: string;
  encrypted_username: string | null;
  encrypted_password: string | null;
  /** SNMPv3 (Fase 4b Task 2) — mai il valore reale, solo indicatore di presenza. */
  encrypted_auth_key: string | null;
  auth_protocol: string | null;
  encrypted_priv_key: string | null;
  priv_protocol: string | null;
  security_level: string | null;
  created_at: string;
  updated_at: string;
}

const SNMP_V3_AUTH_PROTOCOLS = ["MD5", "SHA", "SHA224", "SHA256", "SHA384", "SHA512"] as const;
const SNMP_V3_PRIV_PROTOCOLS = ["DES", "AES", "AES192", "AES256"] as const;

const emptyForm = {
  name: "",
  credential_type: "ssh" as "ssh" | "snmp" | "api" | "windows" | "linux",
  username: "",
  password: "",
  // SNMPv3 (solo per credential_type="snmp"): "" = nessuna (community v2c
  // legacy). Le chiavi sono write-only, sempre vuote all'apertura del form.
  security_level: "" as "" | "noAuthNoPriv" | "authNoPriv" | "authPriv",
  auth_protocol: "",
  auth_key: "",
  priv_protocol: "",
  priv_key: "",
};

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  // Indicatori "già impostata" per le chiavi SNMPv3 in modifica (write-only:
  // il form non le vede mai, ma deve poter dire "lascia vuoto per non
  // modificare" solo se una chiave esiste già).
  const [existingAuthKey, setExistingAuthKey] = useState(false);
  const [existingPrivKey, setExistingPrivKey] = useState(false);
  // v0.2.649: guida WinRM accessibile dal form quando type=windows.
  const [winrmGuideOpen, setWinrmGuideOpen] = useState(false);
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
    if (form.credential_type === "snmp" && !editingId && !form.security_level && !form.password?.trim()) {
      toast.error("Community string richiesta per credenziali SNMP v2c (oppure imposta la sicurezza SNMPv3)");
      return;
    }
    if (form.credential_type === "snmp" && form.security_level) {
      if ((form.security_level === "authNoPriv" || form.security_level === "authPriv") && !form.auth_protocol) {
        toast.error("Protocollo di autenticazione SNMPv3 richiesto");
        return;
      }
      if ((form.security_level === "authNoPriv" || form.security_level === "authPriv") && !form.auth_key.trim() && !existingAuthKey) {
        toast.error("Chiave di autenticazione SNMPv3 richiesta");
        return;
      }
      if (form.security_level === "authPriv" && !form.priv_protocol) {
        toast.error("Protocollo di privacy SNMPv3 richiesto");
        return;
      }
      if (form.security_level === "authPriv" && !form.priv_key.trim() && !existingPrivKey) {
        toast.error("Chiave di privacy SNMPv3 richiesta");
        return;
      }
    }
    try {
      const url = editingId ? `/api/credentials/${editingId}` : "/api/credentials";
      const method = editingId ? "PUT" : "POST";
      const snmpV3Fields = form.credential_type === "snmp"
        ? {
            security_level: form.security_level || null,
            auth_protocol: form.auth_protocol || null,
            auth_key: form.auth_key || undefined,
            priv_protocol: form.priv_protocol || null,
            priv_key: form.priv_key || undefined,
          }
        : {};
      const body = editingId
        ? { name: form.name, credential_type: form.credential_type, username: form.username || undefined, password: form.password || undefined, ...snmpV3Fields }
        : { name: form.name, credential_type: form.credential_type, username: form.username, password: form.password, ...snmpV3Fields };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Errore");
      }
      toast.success(editingId ? "Credenziale aggiornata" : "Credenziale creata");
      setDialogOpen(false);
      setEditingId(null);
      setForm(emptyForm);
      setExistingAuthKey(false);
      setExistingPrivKey(false);
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
    setForm({
      ...emptyForm,
      name: c.name,
      credential_type: c.credential_type as "ssh" | "snmp" | "api" | "windows" | "linux",
      username,
      // SNMPv3: le chiavi sono write-only — non arrivano mai dalla GET, il
      // form parte sempre vuoto per auth_key/priv_key ("lascia vuoto per non
      // modificare"). Protocolli/livello non sono segreti: precompilati.
      security_level: (c.security_level as "" | "noAuthNoPriv" | "authNoPriv" | "authPriv") ?? "",
      auth_protocol: c.auth_protocol ?? "",
      priv_protocol: c.priv_protocol ?? "",
    });
    setExistingAuthKey(!!c.encrypted_auth_key);
    setExistingPrivKey(!!c.encrypted_priv_key);
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setExistingAuthKey(false);
    setExistingPrivKey(false);
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
        // v0.2.649: per credenziali windows con errori WinRM tipici, mostra
        // un'azione "Guida" che apre il dialog con i fix specifici.
        const errMsg = String(data.error || "Test fallito");
        const testedCred = credentials.find((c) => c.id === testCredId);
        const isWinrmError = testedCred?.credential_type === "windows" && /AUTH_REJECTED|TCP_TIMEOUT|KERBEROS_FAILED|KERBEROS_ONLY|401|5985/i.test(errMsg);
        if (isWinrmError) {
          toast.error(errMsg, {
            duration: 8000,
            action: {
              label: "Guida WinRM",
              onClick: () => setWinrmGuideOpen(true),
            },
          });
        } else {
          toast.error(errMsg);
        }
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
                      <div className="flex items-center justify-between">
                        <Label>Username</Label>
                        {form.credential_type === "windows" && (
                          <button
                            type="button"
                            onClick={() => setWinrmGuideOpen(true)}
                            className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                            title="Guida per abilitare WinRM sul server target"
                          >
                            <BookOpen className="h-3 w-3" />
                            Come abilitare WinRM?
                          </button>
                        )}
                      </div>
                      <Input
                        value={form.username}
                        onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                        placeholder={form.credential_type === "windows" ? "es. .\\admin (locale), DOMINIO\\utente (AD), o utente@dominio.fqdn" : "es. admin o DOMINIO\\utente"}
                      />
                      {form.credential_type === "windows" && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Account locale → <code>.\nomeutente</code> · Dominio AD → <code>DOMINIO\nomeutente</code> o <code>utente@dominio.fqdn</code>
                        </p>
                      )}
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
                  <>
                    <div>
                      <Label>Community string (SNMPv2c) {editingId && "(lascia vuoto per non modificare)"}</Label>
                      <Input
                        type="password"
                        value={form.password}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="es. public"
                      />
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Non serve se sotto imposti la sicurezza SNMPv3.
                      </p>
                    </div>
                    <div className="border-t pt-4">
                      <Label>Sicurezza SNMPv3 (opzionale)</Label>
                      <Select
                        value={form.security_level || "none"}
                        onValueChange={(v) =>
                          setForm((f) => ({ ...f, security_level: v === "none" ? "" : (v as "noAuthNoPriv" | "authNoPriv" | "authPriv") }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nessuna — SNMPv2c (community string)</SelectItem>
                          <SelectItem value="noAuthNoPriv">SNMPv3 noAuthNoPriv</SelectItem>
                          <SelectItem value="authNoPriv">SNMPv3 authNoPriv</SelectItem>
                          <SelectItem value="authPriv">SNMPv3 authPriv (completo)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Lo Username SNMPv3 è il campo Username qui sopra. Per apparati enterprise dove
                        v2c è disabilitato per policy.
                      </p>
                    </div>
                    {(form.security_level === "authNoPriv" || form.security_level === "authPriv") && (
                      <>
                        <div>
                          <Label>Protocollo di autenticazione</Label>
                          <Select
                            value={form.auth_protocol || undefined}
                            onValueChange={(v) => setForm((f) => ({ ...f, auth_protocol: v ?? "" }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Seleziona protocollo" />
                            </SelectTrigger>
                            <SelectContent>
                              {SNMP_V3_AUTH_PROTOCOLS.map((p) => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Chiave di autenticazione {existingAuthKey && "(già impostata — lascia vuoto per non modificare)"}</Label>
                          <Input
                            type="password"
                            value={form.auth_key}
                            onChange={(e) => setForm((f) => ({ ...f, auth_key: e.target.value }))}
                            placeholder={existingAuthKey ? "••••••••" : "chiave di autenticazione"}
                          />
                        </div>
                      </>
                    )}
                    {form.security_level === "authPriv" && (
                      <>
                        <div>
                          <Label>Protocollo di privacy</Label>
                          <Select
                            value={form.priv_protocol || undefined}
                            onValueChange={(v) => setForm((f) => ({ ...f, priv_protocol: v ?? "" }))}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Seleziona protocollo" />
                            </SelectTrigger>
                            <SelectContent>
                              {SNMP_V3_PRIV_PROTOCOLS.map((p) => (
                                <SelectItem key={p} value={p}>{p}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {form.priv_protocol === "AES192" && (
                            <p className="text-[11px] text-destructive mt-1">
                              AES192 non è supportato dalla libreria SNMP disponibile: usa AES o AES256.
                            </p>
                          )}
                        </div>
                        <div>
                          <Label>Chiave di privacy {existingPrivKey && "(già impostata — lascia vuoto per non modificare)"}</Label>
                          <Input
                            type="password"
                            value={form.priv_key}
                            onChange={(e) => setForm((f) => ({ ...f, priv_key: e.target.value }))}
                            placeholder={existingPrivKey ? "••••••••" : "chiave di privacy"}
                          />
                        </div>
                      </>
                    )}
                  </>
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

      {/* v0.2.649: guida WinRM apribile dal form credenziali (type=windows) */}
      <WinRMSetupGuideDialog open={winrmGuideOpen} onOpenChange={setWinrmGuideOpen} />
    </div>
  );
}

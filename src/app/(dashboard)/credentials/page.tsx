"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CredentialFormDialog, caricaStatoModifica } from "@/components/credentials/credential-form-dialog";
import { statoNuovo, type OpzioneTipo, type StatoModulo, type VoceArchivio } from "@/lib/credentials/modulo";
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
import { WinRMSetupGuideDialog } from "@/components/shared/winrm-setup-guide-dialog";

type Credential = VoceArchivio;

/** Porta standard per tipo di credenziale (la stessa di DEFAULT_PORTS in credentials/resolve.ts). */
const PORTA_STANDARD: Record<string, number> = { ssh: 22, linux: 22, snmp: 161, windows: 5985, api: 443 };

/**
 * Tipi della tendina in questa pagina, con le etichette di sempre: il modulo
 * è condiviso col wizard (tappa 4), che invece mostra i tipi d'archivio di
 * `credentials/tipi.ts` («Linux» come SSH).
 */
const OPZIONI_TIPO_PAGINA: OpzioneTipo[] = [
  { value: "ssh", label: "SSH (dispositivi)" },
  { value: "snmp", label: "SNMP" },
  { value: "api", label: "API" },
  { value: "windows", label: "Windows (host)" },
  { value: "linux", label: "Linux (host)" },
];

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statoModulo, setStatoModulo] = useState<StatoModulo>(() => statoNuovo());
  // v0.2.649: guida WinRM, aperta dal test non riuscito di una voce Windows.
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
    setStatoModulo(await caricaStatoModifica(c));
    setDialogOpen(true);
  };

  const openCreate = () => {
    setStatoModulo(statoNuovo());
    setDialogOpen(true);
  };

  const openTestDialog = (c: Credential) => {
    setTestCredId(c.id);
    setTestHost("");
    const defaultPort = c.port ?? (c.credential_type === "api" ? null : PORTA_STANDARD[c.credential_type] ?? null);
    setTestPort(defaultPort != null ? String(defaultPort) : "");
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
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Nuova credenziale
          </Button>
          <CredentialFormDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            stato={statoModulo}
            opzioniTipo={OPZIONI_TIPO_PAGINA}
            onSaved={() => fetchCredentials()}
          />
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
                  <TableHead>Porta</TableHead>
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
                    <TableCell className={c.port != null ? "font-mono" : "text-muted-foreground"}>{c.port ?? "standard"}</TableCell>
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

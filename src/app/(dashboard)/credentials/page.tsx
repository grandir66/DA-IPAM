"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
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
import { haPorta, statoNuovo, type StatoModulo, type VoceArchivio } from "@/lib/credentials/modulo";
import { CRED_TYPE_OPTIONS } from "@/lib/credential-protocol-map";
import { DEFAULT_PORTS } from "@/lib/credentials/porte";
import type { UsiCredenziale } from "@/lib/credentials/usi";
import { fetchJson } from "@/lib/fetch-json";
import { LoadError } from "@/components/shared/load-error";
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

/** Porta proposta nella prova di connessione (la stessa di DEFAULT_PORTS). */
const PORTA_PROVA: Record<string, number> = {
  ssh: DEFAULT_PORTS.ssh,
  snmp: DEFAULT_PORTS.snmp,
  snmp_v3: DEFAULT_PORTS.snmp,
  windows: DEFAULT_PORTS.winrm,
};

/** Tipi che la prova di connessione su un host sa provare. */
const TIPI_CON_PROVA = new Set(["ssh", "snmp", "snmp_v3", "windows"]);

type Caricamento = { fase: "caricamento" } | { fase: "pronto" } | { fase: "errore"; messaggio: string };

/** La voce aperta nella finestra degli usi: gli usi arrivano da GET /api/credentials/[id]. */
type FinestraUsi =
  | { stato: "chiusa" }
  | { stato: "caricamento"; voce: Credential }
  | { stato: "pronta"; voce: Credential; usi: UsiCredenziale; totale: number }
  | { stato: "errore"; voce: Credential; messaggio: string };

export default function CredentialsPage() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [caricamento, setCaricamento] = useState<Caricamento>({ fase: "caricamento" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [statoModulo, setStatoModulo] = useState<StatoModulo>(() => statoNuovo());
  // v0.2.649: guida WinRM, aperta dal test non riuscito di una voce Windows.
  const [winrmGuideOpen, setWinrmGuideOpen] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testCredId, setTestCredId] = useState<number | null>(null);
  const [testHost, setTestHost] = useState("");
  const [testPort, setTestPort] = useState("");
  const [finestraUsi, setFinestraUsi] = useState<FinestraUsi>({ stato: "chiusa" });
  const [eliminando, setEliminando] = useState(false);

  // no-store: la GET ha una cache di 60 s, e dopo una modifica o
  // un'eliminazione l'elenco (e la colonna «Usata da») tornerebbe com'era.
  const fetchCredentials = useCallback(async () => {
    const esito = await fetchJson<Credential[]>("/api/credentials", { cache: "no-store" });
    if (esito.ok) {
      setCredentials(esito.data);
      setCaricamento({ fase: "pronto" });
    } else {
      setCaricamento({ fase: "errore", messaggio: esito.message });
    }
  }, []);

  useEffect(() => {
    void fetchCredentials();
  }, [fetchCredentials]);

  /** Gli usi della voce, letti al momento: la colonna può essere vecchia di qualche secondo. */
  const apriUsi = async (c: Credential) => {
    setFinestraUsi({ stato: "caricamento", voce: c });
    const esito = await fetchJson<VoceArchivio & { usi: UsiCredenziale }>(`/api/credentials/${c.id}`, { cache: "no-store" });
    if (esito.ok) {
      setFinestraUsi({ stato: "pronta", voce: c, usi: esito.data.usi, totale: esito.data.usi_totale });
    } else {
      setFinestraUsi({ stato: "errore", voce: c, messaggio: esito.message });
    }
  };

  const elimina = async (c: Credential): Promise<void> => {
    setEliminando(true);
    try {
      const esito = await fetchJson<unknown>(`/api/credentials/${c.id}`, { method: "DELETE" });
      if (esito.ok) {
        toast.success("Credenziale eliminata");
        setFinestraUsi({ stato: "chiusa" });
      } else if (esito.status === 409) {
        // Nel frattempo qualcuno l'ha messa in uso: si mostra dove.
        await apriUsi(c);
      } else {
        toast.error(`Credenziale non eliminata: ${esito.message}`);
      }
    } finally {
      setEliminando(false);
      void fetchCredentials();
    }
  };

  /** D8 = (a): una voce in uso non si elimina; «Elimina» mostra dove è usata. */
  const handleDelete = async (c: Credential) => {
    if (c.usi_totale > 0) {
      await apriUsi(c);
      return;
    }
    if (!confirm(`Eliminare la credenziale «${c.name}»?`)) return;
    await elimina(c);
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
    const defaultPort = c.port ?? PORTA_PROVA[c.credential_type] ?? null;
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
          L&apos;archivio delle credenziali: accesso agli apparati (SSH, SNMP, Windows, API), controller UniFi e Omada, Active Directory.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Elenco credenziali</CardTitle>
            <CardDescription>Una voce in uso non si elimina e non cambia tipo: «Usata da» dice dove serve.</CardDescription>
          </div>
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4 mr-2" />
            Nuova credenziale
          </Button>
          <CredentialFormDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            stato={statoModulo}
            opzioniTipo={CRED_TYPE_OPTIONS}
            onSaved={() => void fetchCredentials()}
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
          {caricamento.fase === "caricamento" ? (
            <p className="text-muted-foreground">Caricamento...</p>
          ) : caricamento.fase === "errore" ? (
            <LoadError what="le credenziali" message={caricamento.messaggio} onRetry={() => void fetchCredentials()} />
          ) : credentials.length === 0 ? (
            <p className="text-muted-foreground">Nessuna credenziale. Clicca &quot;Nuova credenziale&quot; per aggiungerne una.</p>
          ) : (
            <Table fissa>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Porta</TableHead>
                  <TableHead>Usata da</TableHead>
                  <TableHead className="w-[100px]">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.etichetta}</TableCell>
                    <TableCell className="text-muted-foreground">{c.ha_username ? "●●●●●●●●" : "—"}</TableCell>
                    <TableCell className={c.port != null ? "font-mono" : "text-muted-foreground"}>
                      {/* Controller e AD hanno la porta nella loro configurazione, non nella voce. */}
                      {c.port ?? (haPorta(c.credential_type) ? "standard" : "—")}
                    </TableCell>
                    <TableCell>
                      {c.usi_totale > 0 ? (
                        <button
                          type="button"
                          className="tabular-nums font-medium underline underline-offset-2"
                          onClick={() => void apriUsi(c)}
                          title="Dove è usata"
                        >
                          {c.usi_totale}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {TIPI_CON_PROVA.has(c.credential_type) && (
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
                        <Button variant="ghost" size="icon" onClick={() => void openEdit(c)} title="Modifica">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleDelete(c)}
                          title={c.usi_totale > 0 ? "In uso: mostra dove" : "Elimina"}
                        >
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

      <Dialog open={finestraUsi.stato !== "chiusa"} onOpenChange={(open) => { if (!open) setFinestraUsi({ stato: "chiusa" }); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          {finestraUsi.stato !== "chiusa" && (
            <>
              <DialogHeader>
                <DialogTitle>Dove è usata «{finestraUsi.voce.name}»</DialogTitle>
              </DialogHeader>
              {finestraUsi.stato === "caricamento" && <p className="text-muted-foreground">Caricamento...</p>}
              {finestraUsi.stato === "errore" && (
                <LoadError what="gli usi della credenziale" message={finestraUsi.messaggio} onRetry={() => void apriUsi(finestraUsi.voce)} />
              )}
              {finestraUsi.stato === "pronta" && (
                <ElencoUsi
                  usi={finestraUsi.usi}
                  totale={finestraUsi.totale}
                  eliminando={eliminando}
                  onElimina={() => void elimina(finestraUsi.voce)}
                />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* v0.2.649: guida WinRM apribile dal form credenziali (type=windows) */}
      <WinRMSetupGuideDialog open={winrmGuideOpen} onOpenChange={setWinrmGuideOpen} />
    </div>
  );
}

/** Gli usi di una voce, per tipo; con zero usi la voce si può eliminare da qui. */
function ElencoUsi({
  usi,
  totale,
  eliminando,
  onElimina,
}: {
  usi: UsiCredenziale;
  totale: number;
  eliminando: boolean;
  onElimina: () => void;
}) {
  if (totale === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm">Non è più in uso: si può eliminare.</p>
        {usi.scansioniSoftware > 0 && (
          <p className="text-[13px] text-muted-foreground">
            È servita a {usi.scansioniSoftware} {usi.scansioniSoftware === 1 ? "scansione software passata" : "scansioni software passate"}: la storia resta, senza la credenziale.
          </p>
        )}
        <div className="flex justify-end">
          <Button variant="destructive" onClick={onElimina} disabled={eliminando}>
            <Trash2 className="h-4 w-4 mr-2" />
            Elimina
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <p>Per eliminarla, o cambiarle tipo, toglila prima da qui.</p>
      {usi.apparati.length > 0 && (
        <section className="space-y-1">
          <h3 className="font-medium">Apparati</h3>
          <ul className="space-y-0.5">
            {usi.apparati.map((a) => (
              <li key={`${a.id}-${a.come}`}>
                <Link href={`/devices/${a.id}`} className="underline underline-offset-2">{a.nome}</Link>
                <span className="text-muted-foreground"> · {a.come === "binding" ? "credenziale dell'apparato" : "campo credenziale della scheda"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {usi.reti.length > 0 && (
        <section className="space-y-1">
          <h3 className="font-medium">Reti</h3>
          <ul className="space-y-0.5">
            {usi.reti.map((r) => (
              <li key={r.id}>
                <Link href={`/networks/${r.id}`} className="underline underline-offset-2">{r.nome}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {usi.host > 0 && (
        <p>
          <span className="font-medium">Host:</span> {usi.host} (credenziali validate o rilevate sull&apos;host)
        </p>
      )}
      {usi.controller.length > 0 && (
        <section className="space-y-1">
          <h3 className="font-medium">Controller</h3>
          <ul className="space-y-0.5">
            {usi.controller.map((c) => (
              <li key={c.id}>{c.nome}</li>
            ))}
          </ul>
        </section>
      )}
      {usi.ad.length > 0 && (
        <section className="space-y-1">
          <h3 className="font-medium">Active Directory</h3>
          <ul className="space-y-0.5">
            {usi.ad.map((a) => (
              <li key={`${a.id}-${a.come}`}>
                <Link href="/active-directory" className="underline underline-offset-2">{a.nome}</Link>
                <span className="text-muted-foreground"> · {a.come === "ldap" ? "account LDAP" : "WinRM e DHCP"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {usi.proxmox > 0 && (
        <p>
          <span className="font-medium">Host Proxmox:</span> {usi.proxmox}
        </p>
      )}
    </div>
  );
}

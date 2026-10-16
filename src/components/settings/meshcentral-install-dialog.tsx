"use client";

/**
 * Wizard di installazione MeshCentral.
 *
 * Chiede le sole cose che richiedono davvero una decisione umana (come si
 * presenta la console, su quale host/porta risponde, quale password usare) e fa
 * tutto il resto da solo: immagine, container, utenza di servizio, gruppo
 * dispositivi, configurazione cifrata e job di sincronizzazione.
 *
 * La password proposta e' la MASTER dei moduli: un unico segreto condiviso dalle
 * utenze di servizio, così non se ne deve ricordare una per modulo. Vive cifrata
 * nel vault (`system_credentials`) ed e' leggibile solo da un amministratore.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Terminal } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chiamata a installazione completata con successo. */
  onInstalled: () => void;
}

interface JobState {
  phase: string;
  log: string[];
  error?: string;
}

const PHASE_LABEL: Record<string, string> = {
  idle: "In coda…",
  pulling: "Scaricamento immagine…",
  creating: "Creazione container…",
  starting: "Avvio del server…",
  waiting: "Configurazione…",
  done: "Completato",
  error: "Errore",
};

export function MeshCentralInstallDialog({ open, onOpenChange, onInstalled }: Props) {
  const [host, setHost] = useState("");
  const [title, setTitle] = useState("Domarc RMM");
  const [subtitle, setSubtitle] = useState("Controllo remoto");
  const [port, setPort] = useState("4443");
  const [useMaster, setUseMaster] = useState(true);
  const [customPassword, setCustomPassword] = useState("");
  const [job, setJob] = useState<JobState | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  // All'apertura: host di default = l'indirizzo con cui l'operatore raggiunge
  // DA-IPAM (per definizione risolve dal suo browser), e riparti sempre dal form
  // anche dopo un errore/completamento precedente. Dipende SOLO da `open`: prima
  // dipendeva anche da `host`, quindi svuotare il campo faceva rifirare l'effetto
  // e re-scrivere il default (il campo "tornava indietro" — audit 2026-07-20).
  useEffect(() => {
    if (open) {
      setHost((h) => h || window.location.hostname);
      setJob(null);
      setStarting(false);
    }
  }, [open]);

  // Cleanup del polling: senza, l'intervallo sopravvive alla chiusura del dialog.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log.length]);

  const running = job !== null && job.phase !== "done" && job.phase !== "error";

  async function start() {
    if (starting || running) return;
    if (!useMaster && customPassword.length < 8) {
      toast.error("La password deve essere di almeno 8 caratteri");
      return;
    }
    setStarting(true);
    setJob(null);
    try {
      const r = await fetch("/api/integrations/meshcentral/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: host.trim(),
          title: title.trim(),
          subtitle: subtitle.trim(),
          port: Number(port) || 4443,
          ...(useMaster ? {} : { password: customPassword }),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { jobId?: string; error?: string };
      if (!r.ok || !data.jobId) {
        toast.error(data.error ?? "Avvio installazione fallito");
        return;
      }
      setJob({ phase: "idle", log: [] });
      const jobId = data.jobId;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const jr = await fetch(`/api/integrations/install-progress/${jobId}`);
          if (!jr.ok) return;
          const j = (await jr.json()) as JobState;
          setJob(j);
          if (j.phase === "done" || j.phase === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            if (j.phase === "done") {
              toast.success("MeshCentral installato e configurato");
              onInstalled();
            } else {
              toast.error(`Installazione fallita: ${j.error ?? "errore sconosciuto"}`);
            }
          }
        } catch {
          /* riprova al tick successivo */
        }
      }, 2000);
    } catch {
      toast.error("Errore di rete");
    } finally {
      setStarting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Non chiudere mentre installa: il job continuerebbe invisibile.
        if (!o && running) return;
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            Installazione MeshCentral (RMM)
          </DialogTitle>
          <DialogDescription>
            Installa e configura tutto: container, utenza di servizio, gruppo dispositivi e
            collegamento a DA-IPAM. Al termine il modulo è pronto all&apos;uso, senza altri passaggi.
          </DialogDescription>
        </DialogHeader>

        {job && job.phase !== "error" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              <span className="font-medium">{PHASE_LABEL[job.phase] ?? job.phase}</span>
            </div>
            <pre
              ref={logRef}
              className="h-64 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-xs"
            >
              {job.log.join("\n") || "…"}
            </pre>
          </div>
        ) : (
          // Su errore si torna al form (con i valori inseriti) per poterli
          // correggere prima di riprovare — prima l'errore mostrava solo il log,
          // e "Riprova" ri-inviava gli stessi identici parametri (audit 2026-07-20).
          <div className="space-y-4">
            {job?.phase === "error" ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                Installazione non riuscita: {job.error ?? "errore sconosciuto"}. Correggi i
                parametri e riprova.
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="mc-host">Indirizzo dell&apos;appliance</Label>
                <Input id="mc-host" value={host} onChange={(e) => setHost(e.target.value)} />
                <p className="text-xs text-muted-foreground">
                  Deve essere raggiungibile dal browser degli operatori.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mc-port">Porta</Label>
                <Input
                  id="mc-port"
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mc-title">Titolo console</Label>
                <Input id="mc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mc-sub">Sottotitolo</Label>
                <Input id="mc-sub" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <Label className="text-sm">Password dell&apos;utenza di servizio</Label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  className="mt-1"
                  checked={useMaster}
                  onChange={() => setUseMaster(true)}
                />
                <span>
                  <span className="font-medium">Usa la password master dei moduli</span>
                  <span className="block text-xs text-muted-foreground">
                    Un solo segreto per tutti i moduli. Se non esiste ancora viene creata ora e
                    salvata cifrata nel vault credenziali, dove resta visibile solo agli
                    amministratori.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  className="mt-1"
                  checked={!useMaster}
                  onChange={() => setUseMaster(false)}
                />
                <span className="w-full">
                  <span className="font-medium">Password specifica per questo modulo</span>
                  {!useMaster && (
                    <Input
                      type="password"
                      className="mt-2"
                      placeholder="minimo 8 caratteri"
                      value={customPassword}
                      onChange={(e) => setCustomPassword(e.target.value)}
                    />
                  )}
                </span>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          {job?.phase === "done" ? (
            <Button onClick={() => onOpenChange(false)}>Chiudi</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={running}>
                Annulla
              </Button>
              <Button onClick={() => void start()} disabled={starting || running || !host.trim()}>
                {starting || running ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Terminal className="mr-2 h-4 w-4" />
                )}
                {job?.phase === "error" ? "Riprova" : "Installa"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

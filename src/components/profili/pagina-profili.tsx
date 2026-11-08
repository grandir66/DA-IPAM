"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Building2, Plus, Server, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IntestazionePagina, Pannello, TesseraNumero, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { STILE_STATO } from "@/components/shared/stile-stato-modulo";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import { useCambiaProfilo } from "./profilo-tecnico";
import type { ProfiloInElenco } from "@/lib/profili/elenco";

/**
 * Pagina «Profili» dell'installazione «tecnico» (ADR 0037, piano 2026-11-08, Task 5; proposta
 * approvata da Riccardo l'08/11). Un profilo = un cliente, col `codcli` del gestionale.
 * Cancellare un profilo non è in questa tappa: toglie il DB intero di un cliente dal PC del
 * tecnico, si decide insieme all'invio al centrale.
 */

const CODCLI = /^[0-9]{3,8}$/;

function quando(t: string | null): string {
  if (!t) return "mai";
  const d = parseDbDate(t);
  return d.toLocaleString("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Stato({ tono, testo, title }: { tono: keyof typeof STILE_STATO; testo: string; title?: string }) {
  const s = STILE_STATO[tono];
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-medium", s.classi)}>
      <span aria-hidden>{s.segno}</span>
      {testo}
    </span>
  );
}

export function PaginaProfili() {
  const router = useRouter();
  const { data: session, update } = useSession();
  const profiloAttuale = (session?.user as Record<string, unknown> | undefined)?.tenantCode as string | null | undefined;
  const { cambia, cambio } = useCambiaProfilo();
  const [profili, setProfili] = useState<ProfiloInElenco[] | null>(null);
  const [errore, setErrore] = useState<string | null>(null);

  const [nuovoAperto, setNuovoAperto] = useState(false);
  const [codice, setCodice] = useState("");
  const [ragione, setRagione] = useState("");
  const [salva, setSalva] = useState(false);

  const [modifica, setModifica] = useState<ProfiloInElenco | null>(null);
  const [ragioneModifica, setRagioneModifica] = useState("");

  const carica = useCallback(async () => {
    setErrore(null);
    const r = await fetchJson<{ profili: ProfiloInElenco[] }>("/api/profili");
    if (!r.ok) {
      setErrore(r.message);
      return;
    }
    setProfili(r.data.profili);
  }, []);

  useEffect(() => { void carica(); }, [carica]);

  const codiceValido = CODCLI.test(codice.trim());

  async function creaProfilo() {
    setSalva(true);
    try {
      const r = await fetchJson<{ codice_cliente: string; ragione_sociale: string; avviso?: string }>("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codice_cliente: codice.trim(), ragione_sociale: ragione.trim() }),
      });
      if (!r.ok) {
        toast.error(`Profilo non creato: ${r.message}`);
        return;
      }
      if (r.data.avviso) toast.warning(r.data.avviso);
      setNuovoAperto(false);
      setCodice("");
      setRagione("");
      // La sessione del superadmin ricarica l'elenco dei profili al cambio: poi si apre il nuovo.
      if (await cambia(r.data.codice_cliente, r.data.ragione_sociale)) router.push("/");
      else await carica();
    } finally {
      setSalva(false);
    }
  }

  async function salvaModifica() {
    if (!modifica) return;
    setSalva(true);
    try {
      const r = await fetchJson<unknown>(`/api/tenants/${modifica.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragione_sociale: ragioneModifica.trim() }),
      });
      if (!r.ok) {
        toast.error(`Profilo non salvato: ${r.message}`);
        return;
      }
      toast.success("Profilo salvato");
      setModifica(null);
      // Il nome nel selettore viene dalla sessione: chiedere di nuovo il profilo attuale fa
      // ricaricare all'hub l'elenco dei profili del superadmin (auth.config, callback jwt).
      if (profiloAttuale) await update({ tenantCode: profiloAttuale });
      await carica();
      router.refresh();
    } finally {
      setSalva(false);
    }
  }

  async function apri(p: ProfiloInElenco) {
    if (await cambia(p.codice, p.ragioneSociale)) router.push("/");
  }

  const totaleHost = profili?.reduce((n, p) => n + (p.host ?? 0), 0) ?? null;
  const illeggibili = profili?.filter((p) => p.errore).length ?? 0;

  return (
    <div className="space-y-4">
      <IntestazionePagina
        titolo="Profili cliente"
        sottotitolo="Un profilo per cliente, col codice del gestionale. I dati restano su questo PC, cifrati."
        azioni={
          <Button onClick={() => setNuovoAperto(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nuovo profilo
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <TesseraNumero titolo="Profili" valore={profili ? profili.length : null} icona={<Building2 />} />
        <TesseraNumero
          titolo="Host in tutti i profili"
          valore={profili ? totaleHost : null}
          qualifica={illeggibili > 0 ? `${illeggibili} profili non letti` : undefined}
          icona={<Server />}
        />
        <TesseraNumero
          titolo="Ultimo invio al centrale"
          valore={null}
          nota="arriva col collegamento al centrale"
          icona={<Send />}
        />
      </div>

      <Pannello titolo="Profili" conteggio={profili?.length} sottotitolo="«Apri» per lavorare su un cliente">
        {errore ? (
          <div className="p-3.5"><LoadError what="i profili" message={errore} onRetry={() => void carica()} /></div>
        ) : !profili ? (
          <div className="p-3.5"><SkeletonTable rows={3} columns={6} /></div>
        ) : profili.length === 0 ? (
          <div className="p-3.5">
            <Vuoto
              titolo="Nessun profilo cliente"
              testo="Crea il primo profilo col codice cliente del gestionale."
              azione={<Button onClick={() => setNuovoAperto(true)}>Nuovo profilo</Button>}
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Codice</TableHead>
                <TableHead>Ragione sociale</TableHead>
                <TableHead className="text-right">Host</TableHead>
                <TableHead>Ultima scansione</TableHead>
                <TableHead>Invio al centrale</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profili.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono font-semibold">{p.codice}</TableCell>
                  <TableCell>{p.ragioneSociale}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {p.errore ? <Stato tono="guasto" testo="non letto" title={p.errore} /> : p.host}
                  </TableCell>
                  <TableCell className="font-mono text-[13px]">{p.errore ? "—" : quando(p.ultimaScansione)}</TableCell>
                  <TableCell><Stato tono="da_verificare" testo="non ancora previsto" /></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" disabled={cambio} onClick={() => void apri(p)}>Apri</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setModifica(p); setRagioneModifica(p.ragioneSociale); }}
                      >
                        Modifica
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>

      <Dialog open={nuovoAperto} onOpenChange={setNuovoAperto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuovo profilo cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="profilo-codice">Codice cliente</Label>
              <Input
                id="profilo-codice"
                inputMode="numeric"
                value={codice}
                onChange={(e) => setCodice(e.target.value)}
                className="font-mono"
                aria-invalid={codice.length > 0 && !codiceValido}
              />
              <p className={cn("text-[13px]", codice.length > 0 && !codiceValido ? "font-semibold text-foreground" : "text-muted-foreground")}>
                {codice.length > 0 && !codiceValido ? "▲ Solo cifre, da 3 a 8: il codice cliente del gestionale" : "Il codice cliente del gestionale"}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="profilo-ragione">Ragione sociale</Label>
              <Input id="profilo-ragione" value={ragione} onChange={(e) => setRagione(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setNuovoAperto(false)}>Annulla</Button>
              <Button disabled={!codiceValido || !ragione.trim() || salva} onClick={() => void creaProfilo()}>
                Crea e apri il profilo
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modifica !== null} onOpenChange={(o) => { if (!o) setModifica(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Modifica profilo</DialogTitle></DialogHeader>
          {modifica && (
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">
                Codice <span className="font-mono font-semibold text-foreground">{modifica.codice}</span>: non si cambia, è il nome del database del profilo.
              </p>
              <div className="space-y-1">
                <Label htmlFor="profilo-ragione-mod">Ragione sociale</Label>
                <Input id="profilo-ragione-mod" value={ragioneModifica} onChange={(e) => setRagioneModifica(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setModifica(null)}>Annulla</Button>
                <Button disabled={!ragioneModifica.trim() || salva} onClick={() => void salvaModifica()}>Salva il profilo</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

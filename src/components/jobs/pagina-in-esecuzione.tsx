"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { IntestazionePagina, Pannello, TesseraNumero, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { useGiri } from "@/components/shared/giri-context";
import { PastigliaStato } from "@/components/jobs/pastiglia-stato";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseDbDate } from "@/lib/db-date";
import { etichettaGiro } from "@/lib/scanner/giri";
import type { GiroInElenco } from "@/types";

function oraDi(iso: string): string {
  return parseDbDate(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function Avanzamento({ giro }: { giro: GiroInElenco }) {
  if (giro.total <= 0) return <span className="text-muted-foreground">—</span>;
  const pct = Math.round((giro.scanned / giro.total) * 100);
  if (giro.status !== "running") return <span className="font-mono text-[13px] text-muted-foreground">{giro.scanned}/{giro.total}</span>;
  return (
    <div className="min-w-32">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-[#FFD400]" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="mt-1 font-mono text-[13px] text-muted-foreground">{giro.scanned}/{giro.total} ({pct}%)</p>
    </div>
  );
}

function StatoGiro({ status }: { status: GiroInElenco["status"] }) {
  if (status === "completed") return <PastigliaStato tono="ok">Completata</PastigliaStato>;
  if (status === "failed") return <PastigliaStato tono="guasto">Fallita</PastigliaStato>;
  return <PastigliaStato tono="attenzione">In corso</PastigliaStato>;
}

/** Cosa sta girando adesso per questo cliente: scansioni con l'avanzamento e job dello scheduler. */
export function PaginaInEsecuzione() {
  const { giri, job, inCorso, caricato, errore, ricarica, apri } = useGiri();
  const finite = giri.filter((g) => g.status === "completed").length;
  const fallite = giri.filter((g) => g.status === "failed").length;
  const righe = giri.length + job.length;

  return (
    <div className="space-y-4">
      <IntestazionePagina titolo="In esecuzione" sottotitolo="Scansioni e job che stanno girando: continuano anche se cambi pagina." />

      {errore ? (
        <LoadError what="le attività in esecuzione" message={errore} onRetry={ricarica} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <TesseraNumero titolo="In corso" valore={caricato ? inCorso : null} />
            <TesseraNumero titolo="Completate" valore={caricato ? finite : null} nota="ultimi 5 minuti" />
            <TesseraNumero titolo="Fallite" valore={caricato ? fallite : null} nota="ultimi 5 minuti" />
          </div>

          <Pannello
            titolo="Attività"
            conteggio={righe}
            corpoClassName="p-0"
            piede="Elenco in memoria: un riavvio del servizio lo azzera."
          >
            {!caricato ? (
              <p className="p-6 text-center text-[13px] text-muted-foreground">Caricamento…</p>
            ) : righe === 0 ? (
              <div className="p-3">
                <Vuoto titolo="Nessuna attività in esecuzione" testo="Le scansioni avviate da qualsiasi pagina, e quelle programmate, compaiono qui." />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attività</TableHead>
                    <TableHead>Dove</TableHead>
                    <TableHead>Fase</TableHead>
                    <TableHead>Avanzamento</TableHead>
                    <TableHead>Stato</TableHead>
                    <TableHead>Partita</TableHead>
                    <TableHead className="text-right">Dettaglio</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {giri.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-medium">{etichettaGiro(g.scan_type)}</TableCell>
                      <TableCell>
                        {g.link ? <Link href={g.link} className="underline-offset-2 hover:underline">{g.etichetta ?? g.link}</Link> : (g.etichetta ?? "—")}
                      </TableCell>
                      <TableCell className="max-w-72 truncate text-muted-foreground" title={g.error ?? g.phase}>{g.error ?? g.phase}</TableCell>
                      <TableCell><Avanzamento giro={g} /></TableCell>
                      <TableCell><StatoGiro status={g.status} /></TableCell>
                      <TableCell className="font-mono text-[13px]">{oraDi(g.started_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" onClick={() => apri(g.id, { forza: true })}>Apri</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {job.map((j) => (
                    <TableRow key={`job-${j.id}`}>
                      <TableCell className="font-medium">{j.nome}</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell className="text-muted-foreground">Job programmato</TableCell>
                      <TableCell><span className="text-muted-foreground">—</span></TableCell>
                      <TableCell><StatoGiro status="running" /></TableCell>
                      <TableCell className="font-mono text-[13px]">—</TableCell>
                      <TableCell />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Pannello>
        </>
      )}
    </div>
  );
}

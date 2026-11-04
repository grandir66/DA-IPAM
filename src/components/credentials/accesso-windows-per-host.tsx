"use client";

import { useCallback, useEffect, useState } from "react";
import { Pannello, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { Pagination } from "@/components/shared/pagination";
import { SkeletonTable } from "@/components/shared/skeleton-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { aspettoDelMotivo, azioneDelMotivo, parolaDelMotivo, type StradaAccesso } from "@/lib/credentials/motivi-accesso";
import type { CellaAccesso, RigaAccessoWindows } from "@/lib/db-tenant";
import { parseDbDate } from "@/lib/db-date";
import { fetchJson } from "@/lib/fetch-json";
import { LegendaSegni, Segno } from "./segno-stato";

interface Risposta {
  righe: RigaAccessoWindows[];
  totale: number;
}

type Caricamento = { fase: "caricamento" } | { fase: "errore"; messaggio: string } | ({ fase: "pronto" } & Risposta);

const FORMATO_DATA: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };

/** `gg/mm hh:mm` nell'ora dell'utente, o «—». Le date del database passano da `parseDbDate`. */
export function formattaTentativo(valore: string | null): string {
  if (!valore) return "—";
  const d = parseDbDate(valore);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("it-IT", FORMATO_DATA);
}

function ultimoTra(a: CellaAccesso, b: CellaAccesso): string | null {
  const date = [a.ultimoTentativo, b.ultimoTentativo].filter((x): x is string => x != null);
  if (date.length === 0) return null;
  return date.reduce((piu, x) => (parseDbDate(x).getTime() > parseDbDate(piu).getTime() ? x : piu));
}

/** Una strada su un host: una parola, e sotto la sola azione presa dal catalogo. */
function CellaStrada({ cella, strada }: { cella: CellaAccesso; strada: StradaAccesso }) {
  const azione = azioneDelMotivo(cella.motivo, strada);
  return (
    <div className="space-y-1">
      <Segno {...aspettoDelMotivo(cella.motivo)}>{parolaDelMotivo(cella.motivo)}</Segno>
      {azione && <p className="max-w-64 text-[13px] leading-snug text-muted-foreground">{azione}</p>}
    </div>
  );
}

/**
 * «Accesso Windows per host» (piano accesso Windows, Task 9): per ogni host una colonna per WinRM e una per WMI, perché la
 * stessa voce può entrare da una strada e mancare dei diritti sull'altra. Una parola per esito, una sola azione, la data
 * dell'ultimo tentativo. Paginata dal server. Con `voceId` conta quella voce; senza (copertura) l'esito migliore fra tutte.
 * `senzaLegenda`: la pagina che lo ospita ha già la legenda dei segni (una cosa si dice una volta).
 */
export function AccessoWindowsPerHost({ voceId, senzaLegenda = false }: { voceId?: number; senzaLegenda?: boolean }) {
  const [pagina, setPagina] = useState(1);
  const [perPagina, setPerPagina] = useState(50);
  const [stato, setStato] = useState<Caricamento>({ fase: "caricamento" });
  const [tentativo, setTentativo] = useState(0);

  const riprova = useCallback(() => {
    setStato({ fase: "caricamento" });
    setTentativo((n) => n + 1);
  }, []);

  useEffect(() => {
    let annullato = false;
    const q = new URLSearchParams({ pagina: String(pagina), perPagina: String(perPagina) });
    if (voceId != null) q.set("voce", String(voceId));
    void fetchJson<Risposta>(`/api/credentials/accesso-windows?${q.toString()}`, { cache: "no-store" }).then((esito) => {
      if (annullato) return;
      setStato(esito.ok ? { fase: "pronto", righe: esito.data.righe, totale: esito.data.totale } : { fase: "errore", messaggio: esito.message });
    });
    return () => {
      annullato = true;
    };
  }, [pagina, perPagina, voceId, tentativo]);

  const totale = stato.fase === "pronto" ? stato.totale : 0;
  const pagineTotali = Math.max(1, Math.ceil(totale / perPagina));

  return (
    <Pannello
      titolo="Accesso Windows per host"
      conteggio={stato.fase === "pronto" ? totale : undefined}
      sottotitolo="Una colonna per strada: la stessa voce può entrare con WinRM e non con WMI."
      azioni={
        stato.fase === "pronto" && totale > 0 ? (
          <Pagination
            inTesta
            page={pagina}
            totalPages={pagineTotali}
            onPageChange={setPagina}
            pageSize={perPagina}
            onPageSizeChange={(n) => {
              setPerPagina(n);
              setPagina(1);
            }}
            pageSizeOptions={[25, 50, 100]}
            total={totale}
          />
        ) : undefined
      }
      piede={senzaLegenda ? undefined : <LegendaSegni />}
      corpoClassName="p-0"
    >
      {stato.fase === "caricamento" ? (
        <SkeletonTable rows={5} columns={4} />
      ) : stato.fase === "errore" ? (
        <div className="p-3">
          <LoadError what="l'accesso Windows per host" message={stato.messaggio} onRetry={riprova} />
        </div>
      ) : stato.righe.length === 0 ? (
        <div className="p-3">
          <Vuoto
            titolo="Nessun host provato con una voce Windows"
            testo="Compare dopo la prima scansione di una rete con una voce Windows nella lista."
          />
        </div>
      ) : (
        <div className="max-h-[36rem] overflow-y-auto">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
            <TableRow>
              <TableHead className="text-[13px]">Host</TableHead>
              <TableHead className="text-[13px]">WinRM</TableHead>
              <TableHead className="text-[13px]">WMI</TableHead>
              <TableHead className="text-[13px]">Ultimo tentativo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stato.righe.map((r) => (
              <TableRow key={r.hostId}>
                <TableCell className="align-top">
                  <span className="font-mono font-semibold">{r.ip}</span>
                  {r.nome && <span className="block text-[13px] text-muted-foreground">{r.nome}</span>}
                </TableCell>
                <TableCell className="align-top">
                  <CellaStrada cella={r.winrm} strada="winrm" />
                </TableCell>
                <TableCell className="align-top">
                  <CellaStrada cella={r.wmi} strada="wmi" />
                </TableCell>
                <TableCell className="align-top font-mono text-[13px] text-muted-foreground">{formattaTentativo(ultimoTra(r.winrm, r.wmi))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      )}
    </Pannello>
  );
}

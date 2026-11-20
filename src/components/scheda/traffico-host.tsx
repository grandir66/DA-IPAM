"use client";

/**
 * Riquadro «Con chi parla» della scheda (tab Sicurezza): le coppie viste dai collector di traffico negli ultimi
 * 7 giorni e i nomi chiesti. Senza dati non compare (come Wazuh): niente collector, niente riquadro.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { TempoRelativo } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import { formattaByte, protoPorta } from "@/lib/traffico/frasi";
import type { CoppiaHost, NomeHost } from "@/lib/traffico/lettura";
import type { NomeDiIp } from "@/lib/traffico/quadro";
import { Riquadro } from "./riquadro";

interface Risposta { parlaCon: CoppiaHost[]; gliParlano: CoppiaHost[]; nomi: NomeHost[]; host: Record<string, NomeDiIp> }

function Altro({ ip, host }: { ip: string; host: Record<string, NomeDiIp> }) {
  if (ip === "esterno") return <span>fuori dalla rete</span>;
  if (ip === "diffusione") return <span>a tutti (diffusione)</span>;
  const h = host[ip];
  if (!h) return <span className="font-mono font-semibold">{ip}</span>;
  return (
    <Link href={`/objects/${h.id}`} className="font-semibold text-cian-testo underline-offset-2 hover:underline">
      {h.nome ? <>{h.nome} <span className="font-mono text-[13px] font-normal text-muted-foreground">{ip}</span></> : <span className="font-mono">{ip}</span>}
    </Link>
  );
}

function Coppie({ titolo, righe, host }: { titolo: string; righe: CoppiaHost[]; host: Record<string, NomeDiIp> }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wider text-cian-testo">
        {titolo} <span className="font-mono font-normal text-muted-foreground">{righe.length}</span>
      </p>
      {righe.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Nessuno negli ultimi 7 giorni.</p>
      ) : (
        <div className="max-h-96 overflow-y-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Host</TableHead><TableHead>Porta</TableHead><TableHead className="text-right">Volume</TableHead><TableHead>Ultima volta</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {righe.map((c) => (
                <TableRow key={`${c.altro}|${c.proto}|${c.porta}`}>
                  <TableCell><Altro ip={c.altro} host={host} />{c.altro === "esterno" && c.esterni > 0 && <span className="text-[13px] text-muted-foreground"> · {c.esterni} indirizzi</span>}</TableCell>
                  <TableCell className="font-mono">{protoPorta(c.proto, c.porta)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formattaByte(c.byte)}</TableCell>
                  <TableCell><TempoRelativo data={c.ultima_vista} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export function TrafficoHost({ ip }: { ip: string }) {
  const [dati, setDati] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [tentativo, setTentativo] = useState(0);

  useEffect(() => {
    let vivo = true;
    fetchJson<Risposta>(`/api/traffico/host/${encodeURIComponent(ip)}`)
      .then((r) => {
        if (!vivo) return;
        if (r.ok) { setDati(r.data); setErrore(null); } else setErrore(r.message);
      })
      .catch(() => { if (vivo) setErrore("Server non raggiungibile"); });
    return () => { vivo = false; };
  }, [ip, tentativo]);

  if (errore !== null) {
    return <Riquadro titolo="Con chi parla"><LoadError what="il traffico dell'host" message={errore} onRetry={() => setTentativo((t) => t + 1)} /></Riquadro>;
  }
  if (dati === null || (dati.parlaCon.length === 0 && dati.gliParlano.length === 0 && dati.nomi.length === 0)) return null;
  return (
    <Riquadro titolo="Con chi parla · ultimi 7 giorni" azione={<Link href="/traffico" className="text-[13px] font-semibold text-cian-testo underline-offset-2 hover:underline">Anomalie del traffico ›</Link>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Coppie titolo="Parla con" righe={dati.parlaCon} host={dati.host} />
        <Coppie titolo="Gli parlano" righe={dati.gliParlano} host={dati.host} />
      </div>
      {dati.nomi.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-[13px] font-bold uppercase tracking-wider text-cian-testo">
            Nomi chiesti <span className="font-mono font-normal text-muted-foreground">{dati.nomi.length}</span>
          </p>
          <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
            {dati.nomi.map((n) => (
              <span key={`${n.tipo}|${n.nome}`} className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[13px]" title={`${n.tipo === "dns" ? "chiesto al DNS" : "nel saluto TLS"} · ${n.conteggio} volte`}>
                <span className="font-sans font-semibold">{n.tipo === "dns" ? "DNS" : "TLS"}</span> {n.nome}
              </span>
            ))}
          </div>
        </div>
      )}
    </Riquadro>
  );
}

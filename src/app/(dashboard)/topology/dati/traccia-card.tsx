"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import type { Traccia } from "@/lib/topology/cavi/traccia";
import { quandoItaliano } from "@/lib/topology/letture/testi";

type Risposta = Traccia & { calcolataIl: string; staleDays: number; letture: Array<{ lettura: string; acceso: boolean }>; nomi: Record<string, string> };

/**
 * «Cosa cambierebbe con la mappa nuova (una linea per cavo)» (spec topologia §13.11.3), solo per gli amministratori:
 * calcolata quando si preme «Calcola», mai all'apertura della pagina. La mappa non cambia.
 */
export function TracciaCard() {
  const [t, setT] = useState<Risposta | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [calcolo, setCalcolo] = useState(false);
  async function calcola() {
    setCalcolo(true);
    setErrore(null);
    const r = await fetchJson<Risposta>("/api/topology/traccia", { cache: "no-store" });
    setCalcolo(false);
    if (!r.ok) setErrore(r.message);
    else setT(r.data);
  }
  const n = (id: string | null | undefined): string => (id === undefined ? "fuori dall'albero" : id === null ? "nessuno (partenza dell'albero)" : (t?.nomi[id] ?? id));
  const accese = t?.letture.filter((l) => l.acceso).map((l) => l.lettura) ?? [];
  const numeri: Array<[string, number]> = t ? [
    ["Oggetti con un altro padre", t.padriDiversi], ["Entrano nell'albero", t.entrano.length], ["Escono dall'albero", t.escono.length],
    ["Segmenti", t.segmenti], ["Anomalie «core che esce da uno switch di accesso»", t.anomalie],
    ["Cavi", t.perGenere.cavo], ["Fasci di cavi", t.nuovi.fasci], ["Tunnel", t.nuovi.tunnel], ["Ponti radio", t.nuovi.radio],
    ["Collegamenti senza fili", t.perGenere.senza_fili], ["Bloccati dallo spanning tree", t.nuovi.bloccati], ["Instradati (fuori dal bridge)", t.nuovi.instradati],
  ] : [];
  return (
    <Card className="xl:col-span-2">
      <CardHeader><CardTitle>Cosa cambierebbe con la mappa nuova (una linea per cavo)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">Un calcolo in memoria: la mappa non cambia. Serve a decidere quando accendere la mappa nuova, a differenze spiegate.</p>
        <Button variant="outline" onClick={() => void calcola()} disabled={calcolo}>{calcolo ? "Calcolo…" : t ? "Ricalcola" : "Calcola"}</Button>
        {errore && <LoadError what="«Cosa cambierebbe con la mappa nuova»" message={errore} onRetry={() => void calcola()} />}
        {t && (
          <>
            <p className="text-sm text-muted-foreground">Calcolata il {quandoItaliano(t.calcolataIl)}. Letture in più accese: {accese.length > 0 ? accese.join(", ") : "nessuna (solo le righe di oggi)"}.</p>
            {!t.schema && <p className="text-sm font-medium" role="status">Lo schema delle letture in più non c&apos;è su questo cliente: il calcolo usa solo le righe di oggi.</p>}
            {/* Larga quanto la tabella «Numeri»: a 1920 la riga intera metteva il numero a 1500 px dalla sua voce. */}
            <div className="max-w-2xl">
              <Table><TableBody>
                {numeri.map(([k, v]) => <TableRow key={k}><TableCell>{k}</TableCell><TableCell className="text-right tabular-nums">{v}</TableCell></TableRow>)}
              </TableBody></Table>
            </div>
            {t.righe.length === 0 ? (
              <p className="text-sm">Nessun oggetto cambierebbe padre: l&apos;albero della mappa nuova coincide con quello di oggi.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {t.righe.map((r) => (
                  <li key={r.id}>{n(r.id)} · padre oggi {n(r.prima)} · con la mappa nuova {n(r.dopo)} · {r.perche}</li>
                ))}
                {t.altri > 0 && <li>+ altri {t.altri}</li>}
              </ul>
            )}
            {t.avvisi.length > 0 && (
              <ul className="text-sm list-disc pl-5">
                {t.avvisi.slice(0, 20).map((a) => <li key={`${a.nodo}-${a.testo}`}>{n(a.nodo)}: {a.testo}</li>)}
                {t.avvisi.length > 20 && <li>+ altri {t.avvisi.length - 20}</li>}
              </ul>
            )}
            <details className="text-sm">
              <summary>Non calcolato in questa tappa</summary>
              <ul className="list-disc pl-5">{t.nonCalcolato.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

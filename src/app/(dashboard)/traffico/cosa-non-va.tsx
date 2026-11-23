"use client";

/**
 * Scheda «Cosa non va» della pagina Traffico (tappa 5, approvata da Riccardo il 23/11): chi bussa a vuoto, i servizi
 * di casa che rifiutano o non rispondono, i servizi lenti. Sono indizi presi dall'apertura delle connessioni.
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { fetchJson } from "@/lib/fetch-json";
import type { CosaNonVaTraffico } from "@/lib/traffico/connessioni";
import { Indirizzo } from "./pezzi";

const PERIODI: { giorni: number; testo: string }[] = [
  { giorni: 1, testo: "Oggi" },
  { giorni: 7, testo: "7 giorni" },
  { giorni: 30, testo: "30 giorni" },
];
const numero = (n: number): string => n.toLocaleString("it-IT");
const Num = ({ n }: { n: number }) => <span className="font-mono tabular-nums">{numero(n)}</span>;

/** Mai risposto (fondo scuro, croce) o a volte (fondo chiaro, mezzo cerchio): si distingue per forma e luminosità. */
function StatoServizio({ riuscite }: { riuscite: number }) {
  return riuscite === 0 ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-[#8E1B20] bg-[#8E1B20] px-1.5 py-0.5 text-[13px] font-semibold whitespace-nowrap text-white">
      <span aria-hidden>✕</span>Mai risposto
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border bg-muted px-1.5 py-0.5 text-[13px] font-semibold whitespace-nowrap">
      <span aria-hidden>◐</span>A volte
    </span>
  );
}

export function CosaNonVa() {
  const [dati, setDati] = useState<CosaNonVaTraffico | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [giorni, setGiorni] = useState(1);

  const carica = useCallback(async () => {
    const r = await fetchJson<CosaNonVaTraffico>(`/api/traffico/connessioni?giorni=${giorni}`, { cache: "no-store" });
    if (r.ok) { setDati(r.data); setErrore(null); } else setErrore(r.message);
  }, [giorni]);

  useEffect(() => { void carica(); }, [carica]);

  const periodo = (
    <>
      {PERIODI.map((p) => (
        <Button key={p.giorni} size="sm" variant={giorni === p.giorni ? "default" : "outline"} onClick={() => setGiorni(p.giorni)}>{p.testo}</Button>
      ))}
    </>
  );
  const piede = "Sono indizi presi dalla copia del traffico, non misure esatte. Le scansioni di IPAM non sono contate.";

  if (errore !== null) return <LoadError what="le connessioni che non vanno" message={errore} onRetry={() => void carica()} />;
  if (dati === null) return <p className="text-sm text-muted-foreground" role="status">Carico le connessioni…</p>;
  if (!dati.ci_sono_dati) {
    return (
      <Pannello titolo="Cosa non va" azioni={periodo}>
        <Vuoto titolo="I collector non mandano ancora questo dato" testo="Le connessioni fallite arrivano dai collector aggiornati: uno non ancora aggiornato conta il traffico ma non le aperture." />
      </Pannello>
    );
  }
  const n = dati.nomi;
  return (
    <div className="space-y-4">
      <Pannello
        titolo="Chi bussa a vuoto"
        conteggio={dati.bussano.length}
        sottotitolo="Host che aprono connessioni senza risposta o rifiutate, i peggiori in alto."
        corpoClassName="p-0"
        azioni={periodo}
        piede={piede}
      >
        {dati.bussano.length === 0 ? (
          <div className="p-3"><Vuoto titolo="Nessuna connessione fallita nel periodo" testo="Nessun host ha bussato a vuoto." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Host</TableHead><TableHead className="text-right">Destinazioni diverse</TableHead><TableHead className="text-right">Tentativi</TableHead>
                <TableHead className="text-right">Senza risposta</TableHead><TableHead className="text-right">Rifiutati</TableHead><TableHead>Ultima volta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.bussano.map((b) => (
                <TableRow key={b.client}>
                  <TableCell><Indirizzo ip={b.client} nomi={n} /></TableCell>
                  <TableCell className="text-right"><Num n={b.destinazioni} /></TableCell>
                  <TableCell className="text-right"><Num n={b.tentate} /></TableCell>
                  <TableCell className="text-right"><Num n={b.senza_risposta} /></TableCell>
                  <TableCell className="text-right"><Num n={b.rifiutate} /></TableCell>
                  <TableCell><TempoRelativo data={b.ultima_vista} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>

      <Pannello titolo="Servizi che non rispondono" conteggio={dati.servizi.length} sottotitolo="Servizi di casa che rifiutano o lasciano senza risposta chi li cerca." corpoClassName="p-0">
        {dati.servizi.length === 0 ? (
          <div className="p-3"><Vuoto titolo="Nessun servizio di casa ha rifiutato nel periodo" testo="Tutti i servizi cercati hanno risposto." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead><TableHead className="text-right">Porta</TableHead><TableHead>Stato</TableHead>
                <TableHead className="text-right">Client</TableHead><TableHead className="text-right">Senza risposta</TableHead>
                <TableHead className="text-right">Rifiutati</TableHead><TableHead className="text-right">Riusciti</TableHead><TableHead>Ultima volta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.servizi.map((s) => (
                <TableRow key={`${s.server}|${s.porta}`}>
                  <TableCell><Indirizzo ip={s.server} nomi={n} /></TableCell>
                  <TableCell className="text-right font-mono">{s.porta}</TableCell>
                  <TableCell><StatoServizio riuscite={s.riuscite} /></TableCell>
                  <TableCell className="text-right"><Num n={s.client} /></TableCell>
                  <TableCell className="text-right"><Num n={s.senza_risposta} /></TableCell>
                  <TableCell className="text-right"><Num n={s.rifiutate} /></TableCell>
                  <TableCell className="text-right"><Num n={s.riuscite} /></TableCell>
                  <TableCell><TempoRelativo data={s.ultima_vista} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>

      <Pannello titolo="Servizi lenti" conteggio={dati.lenti.length} sottotitolo="Servizi di casa che ci mettono più di 200 ms ad accettare una connessione (almeno 5 aperture)." corpoClassName="p-0">
        {dati.lenti.length === 0 ? (
          <div className="p-3"><Vuoto titolo="Nessun servizio lento nel periodo" testo="Tutti i servizi di casa hanno risposto sotto i 200 ms." /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Server</TableHead><TableHead className="text-right">Porta</TableHead><TableHead className="text-right">Aperture</TableHead>
                <TableHead className="text-right">Tempo tipico</TableHead><TableHead className="text-right">Minimo</TableHead><TableHead>Ultima volta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dati.lenti.map((s) => (
                <TableRow key={`${s.server}|${s.porta}`}>
                  <TableCell><Indirizzo ip={s.server} nomi={n} /></TableCell>
                  <TableCell className="text-right font-mono">{s.porta}</TableCell>
                  <TableCell className="text-right"><Num n={s.riuscite} /></TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{numero(s.ms_mediano)} ms</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{numero(s.ms_minimo)} ms</TableCell>
                  <TableCell><TempoRelativo data={s.ultima_vista} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Pannello>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { Pannello, TempoRelativo, Vuoto } from "@/components/shared/console";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { SegnoLista, StatoLista, StatoListe, TipoLista } from "@/lib/traffico/liste";

const numero = (n: number): string => n.toLocaleString("it-IT");
const NOME_TIPO: Record<TipoLista, string> = { reputazione: "indirizzi compromessi", geo: "paesi (geoblocking)", ammessi: "eccezioni" };

/** Segno, parola e fondo pieno: lo stato si legge anche senza il colore. */
function Segno({ tono, testo, titolo }: { tono: ToniStato; testo: string; titolo?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[13px] font-semibold whitespace-nowrap", STILE_STATO[tono].classi)} title={titolo}>
      <span aria-hidden>{STILE_STATO[tono].segno}</span>
      {testo}
    </span>
  );
}

/** Le liste di DA-GEO in cui sta una destinazione, accanto al suo nome. */
export function SegniListe({ liste }: { liste: SegnoLista[] }) {
  if (liste.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1.5">
      {liste.map((l) =>
        l.tipo === "reputazione" ? <Segno key={l.nome} tono="guasto" testo={l.titolo} titolo="Indirizzo noto come compromesso" />
          : l.tipo === "geo" ? <Segno key={l.nome} tono="attenzione" testo="geoblocking" titolo={`Lo taglierebbe la lista «${l.titolo}»`} />
            : <Segno key={l.nome} tono="da_verificare" testo="eccezione" titolo={`Ammesso dalla lista «${l.titolo}»`} />)}
    </span>
  );
}

/** Quante destinazioni del gruppo sono segnate: compromesse e da geoblocking. */
export function NumeroSegnate({ compromesse, bloccherebbe }: { compromesse: number; bloccherebbe: number }) {
  if (compromesse === 0 && bloccherebbe === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {compromesse > 0 && <Segno tono="guasto" testo={numero(compromesse)} titolo="Destinazioni compromesse" />}
      {bloccherebbe > 0 && <Segno tono="attenzione" testo={numero(bloccherebbe)} titolo="Le taglierebbe il geoblocking" />}
    </span>
  );
}

function StatoDellaLista({ l }: { l: StatoLista }) {
  if (l.in_errore) return <Segno tono="attenzione" testo="non rigenerata" titolo="In DA-GEO l'ultima generazione non è riuscita: questa è quella di prima" />;
  if (l.vecchia) return <Segno tono="attenzione" testo="vecchia" titolo="Generata da più di sette giorni" />;
  return <Segno tono="ok" testo="aggiornata" />;
}

/** Riquadro degli amministratori: il codice con cui IPAM scarica le sue liste da DA-GEO, e le liste scaricate. */
export function ListeDaGeo({ stato, errore, onRicarica, onCambiato }: { stato: StatoListe | null; errore: string | null; onRicarica: () => void; onCambiato: (s: StatoListe) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [codice, setCodice] = useState("");
  const [cambia, setCambia] = useState(false);
  const [togli, setTogli] = useState(false);
  const [occupato, setOccupato] = useState(false);

  const manda = async (metodo: "PUT" | "POST" | "DELETE", corpo?: unknown) => {
    setOccupato(true);
    const r = await fetchJson<StatoListe>("/api/traffico/liste", {
      method: metodo,
      ...(corpo === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }),
    });
    setOccupato(false);
    if (!r.ok) { toast.error(r.message); return; }
    if (metodo === "DELETE") toast.success("Liste di DA-GEO tolte");
    else if (r.data.errore) toast.error(r.data.errore);
    else toast.success(`${numero(r.data.liste.length)} liste scaricate da DA-GEO`);
    setCodice("");
    setUrl(null);
    setCambia(false);
    setTogli(false);
    onCambiato(r.data);
  };
  const salva = (e: FormEvent) => { e.preventDefault(); void manda("PUT", { url: url ?? stato?.url ?? "", codice: codice.trim() }); };
  const modulo = stato !== null && (!stato.configurato || cambia);

  return (
    <Pannello
      titolo="Liste di DA-GEO"
      conteggio={stato?.configurato ? stato.liste.length : undefined}
      sottotitolo="Le stesse liste che scaricano i firewall. Si scaricano intere e si cerca qui: nessun indirizzo esce dall'installazione."
      corpoClassName="p-0"
      azioni={stato?.configurato ? (
        <>
          <Button size="sm" disabled={occupato} onClick={() => void manda("POST")}>{occupato ? "Scarico…" : "Scarica adesso"}</Button>
          <Button size="sm" variant="outline" disabled={occupato} onClick={() => setCambia((c) => !c)}>{cambia ? "Lascia com'è" : "Cambia codice"}</Button>
          <Button size="sm" variant="outline" disabled={occupato} onClick={() => setTogli(true)}>Togli</Button>
        </>
      ) : undefined}
      piede={stato?.configurato ? (
        <span>
          Da <span className="font-mono">{stato.url}</span>, ogni mattina alle 5:41.{" "}
          {stato.ultimo_giro ? <>Ultimo scarico <TempoRelativo data={stato.ultimo_giro} />.</> : "Mai scaricate."}
        </span>
      ) : undefined}
    >
      {errore !== null ? (
        <div className="p-3"><LoadError what="le liste di DA-GEO" message={errore} onRetry={onRicarica} /></div>
      ) : stato === null ? (
        <p className="p-3 text-sm text-muted-foreground" role="status">Carico le liste…</p>
      ) : (
        <>
          {stato.errore && (
            <div className="flex items-center gap-2 border-b border-[#C9A800] bg-[#FFD400] px-3.5 py-2 text-sm font-semibold text-[#0D2537]" role="status">
              <span aria-hidden>▲</span><span>{stato.errore}</span>
            </div>
          )}
          {modulo && (
            <form onSubmit={salva} className="flex flex-wrap items-end gap-3 border-b p-3" autoComplete="off">
              <label className="space-y-1 text-[13px]">
                <span className="block text-muted-foreground">Indirizzo di DA-GEO</span>
                <Input value={url ?? stato.url} onChange={(e) => setUrl(e.target.value)} className="w-72 font-mono" required />
              </label>
              <label className="space-y-1 text-[13px]">
                <span className="block text-muted-foreground">Codice del dispositivo</span>
                <Input type="password" value={codice} onChange={(e) => setCodice(e.target.value)} placeholder="32 cifre, dalla pagina Dispositivi" className="w-72 font-mono" autoComplete="new-password" required />
              </label>
              <Button type="submit" disabled={occupato || codice.trim() === ""}>{occupato ? "Provo…" : "Salva e scarica"}</Button>
            </form>
          )}
          {stato.configurato && (stato.liste.length === 0 ? (
            <div className="p-3"><Vuoto titolo="Nessuna lista scaricata" testo="In DA-GEO, alla pagina Dispositivi, collega almeno una lista a questo dispositivo, poi «Scarica adesso»." /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lista</TableHead><TableHead>Cosa contiene</TableHead><TableHead className="text-right">Voci</TableHead>
                  <TableHead>Generata</TableHead><TableHead>Scaricata</TableHead><TableHead>Stato</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stato.liste.map((l) => (
                  <TableRow key={l.nome}>
                    <TableCell><span className="block font-semibold">{l.titolo}</span><span className="font-mono text-[13px] text-muted-foreground">{l.nome}</span></TableCell>
                    <TableCell>{NOME_TIPO[l.tipo]}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{numero(l.voci)}</TableCell>
                    <TableCell><TempoRelativo data={l.generato.slice(0, 16) + ":00"} /></TableCell>
                    <TableCell><TempoRelativo data={l.scaricata_il} /></TableCell>
                    <TableCell><StatoDellaLista l={l} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ))}
        </>
      )}
      <Dialog open={togli} onOpenChange={(aperta) => { if (!aperta) setTogli(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Togliere le liste di DA-GEO?</DialogTitle></DialogHeader>
          <p className="text-sm">Si tolgono il codice e le liste scaricate: non nasceranno più avvisi «Indirizzo compromesso». Quelli già nati restano. In DA-GEO il dispositivo va revocato a parte.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTogli(false)}>Annulla</Button>
            <Button variant="destructive" disabled={occupato} onClick={() => void manda("DELETE")}>Togli</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Pannello>
  );
}

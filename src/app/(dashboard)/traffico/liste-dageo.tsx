"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadError } from "@/components/shared/load-error";
import { TempoRelativo, Vuoto } from "@/components/shared/console";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import type { EsitoCollegamento, Richiesta } from "@/lib/traffico/collegamento";
import type { Segnate } from "@/lib/traffico/esterno";
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

const mandaJson = <T,>(url: string, metodo: "POST" | "PUT" | "DELETE", corpo?: unknown) =>
  fetchJson<T>(url, { method: metodo, ...(corpo === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }) });

/** Un passo della finestra: numero, o segno di spunta quando è fatto. */
function Passo({ n, stato, titolo, children }: { n: number; stato: "fatto" | "ora" | "dopo"; titolo: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 border-t py-3 first:border-t-0">
      <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-bold",
        stato === "ora" ? "border-[#C9A800] bg-[#FFD400] text-[#0D2537]" : stato === "fatto" ? STILE_STATO.ok.classi : "text-muted-foreground")}>
        {stato === "fatto" ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className={cn("pt-0.5 text-[15px] font-semibold", stato === "dopo" && "text-muted-foreground")}>{titolo}</p>
        {children}
      </div>
    </li>
  );
}

/** Minuti che restano a una richiesta, aggiornati mentre si guarda. */
function Scadenza({ scade }: { scade: string }) {
  const [ora, setOra] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setOra(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const m = Math.max(0, Math.ceil((Date.parse(scade) - ora) / 60_000));
  return <>{m === 1 ? "vale ancora un minuto" : `vale ancora ${m} minuti`}</>;
}

/** Il codice scritto a mano: per chi non riesce ad aprire DA-GEO. */
function CodiceAMano({ url, occupato, onSalva }: { url: string; occupato: boolean; onSalva: (url: string, codice: string) => void }) {
  const [indirizzo, setIndirizzo] = useState(url);
  const [codice, setCodice] = useState("");
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); onSalva(indirizzo, codice.trim()); }} className="space-y-2 rounded-lg border p-3" autoComplete="off">
      <p className="text-[13px] text-muted-foreground">In DA-GEO apri il cliente, «Dispositivi», e sul DA-IPAM premi «Copia codice».</p>
      <label className="block space-y-1 text-[13px]">
        <span className="block text-muted-foreground">Indirizzo di DA-GEO</span>
        <Input value={indirizzo} onChange={(e) => setIndirizzo(e.target.value)} className="font-mono" required />
      </label>
      <label className="block space-y-1 text-[13px]">
        <span className="block text-muted-foreground">Codice</span>
        <Input type="password" value={codice} onChange={(e) => setCodice(e.target.value)} placeholder="32 cifre" className="font-mono" autoComplete="new-password" required />
      </label>
      <Button type="submit" size="sm" disabled={occupato || codice.trim() === ""}>{occupato ? "Provo…" : "Salva e scarica"}</Button>
    </form>
  );
}

/** Le liste scaricate, una riga per lista. */
function TabellaListe({ stato }: { stato: StatoListe }) {
  if (stato.liste.length === 0) return <Vuoto titolo="Nessuna lista scaricata" testo="In DA-GEO, alla pagina Dispositivi, collega almeno una lista a questo DA-IPAM, poi «Scarica adesso»." />;
  return (
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
  );
}

type Finestra = "collega" | "gestisci" | "togli" | null;

/**
 * La striscia in cima a «Verso l'esterno» (Riccardo, 25/11: «un riquadro in fondo non visibile è difficile da vedere»).
 * Senza DA-GEO dice cosa manca e ha un pulsante solo; col collegamento dice lo stato e filtra l'elenco sotto.
 */
export function StrisciaDaGeo({ stato, errore, admin, compromesse, bloccherebbe, segnate, onSegnate, onRicarica, onCambiato }: {
  stato: StatoListe | null; errore: string | null; admin: boolean;
  compromesse: number | null; bloccherebbe: number | null; segnate: Segnate | null;
  onSegnate: (s: Segnate | null) => void; onRicarica: () => void; onCambiato: (s: StatoListe) => void;
}) {
  const [finestra, setFinestra] = useState<Finestra>(null);
  const [richiesta, setRichiesta] = useState<Richiesta | null>(null);
  const [avviso, setAvviso] = useState<string | null>(null);
  const [finita, setFinita] = useState<"collegato" | "rifiutata" | "scaduta" | null>(null);
  const [aMano, setAMano] = useState(false);
  const [occupato, setOccupato] = useState(false);

  // una richiesta lasciata aperta si riprende: chi ricarica la pagina non ricomincia
  useEffect(() => {
    if (!admin) return;
    void fetchJson<{ richiesta: Richiesta | null }>("/api/traffico/liste/collega", { cache: "no-store" }).then((r) => { if (r.ok) setRichiesta(r.data.richiesta); });
  }, [admin]);

  const controlla = useCallback(async () => {
    const r = await mandaJson<EsitoCollegamento>("/api/traffico/liste/collega", "PUT");
    if (!r.ok) { setAvviso(r.message); return; }
    if (r.data.stato === "attesa") { setAvviso(r.data.avviso); return; }
    setRichiesta(null);
    setAvviso(null);
    if (r.data.stato === "collegato") {
      setFinita("collegato");
      onCambiato(r.data.liste);
      if (r.data.liste.errore) toast.error(r.data.liste.errore);
      else toast.success(`DA-GEO collegato: ${numero(r.data.liste.liste.length)} liste scaricate`);
    } else if (r.data.stato !== "nessuna") setFinita(r.data.stato);
    else onRicarica(); // l'ha ritirata un'altra scheda
  }, [onCambiato, onRicarica]);

  const numeroRichiesta = richiesta?.numero;
  useEffect(() => {
    if (!numeroRichiesta) return;
    let viva = true;
    let t: ReturnType<typeof setTimeout>;
    const giro = () => { t = setTimeout(() => { void controlla().finally(() => { if (viva) giro(); }); }, 3_000); };
    giro();
    return () => { viva = false; clearTimeout(t); };
  }, [numeroRichiesta, controlla]);

  const chiedi = async () => {
    setOccupato(true);
    setFinita(null);
    setAvviso(null);
    const r = await mandaJson<{ richiesta: Richiesta }>("/api/traffico/liste/collega", "POST", stato?.url ? { url: stato.url } : {});
    setOccupato(false);
    if (r.ok) setRichiesta(r.data.richiesta);
    else setAvviso(r.message);
  };
  const apriCollega = () => { setAMano(false); setFinestra("collega"); if (!richiesta) void chiedi(); };
  const annulla = async () => {
    await mandaJson("/api/traffico/liste/collega", "DELETE");
    setRichiesta(null);
    setFinestra(null);
  };
  const manda = async (metodo: "PUT" | "POST" | "DELETE", corpo?: unknown) => {
    setOccupato(true);
    const r = await mandaJson<StatoListe>("/api/traffico/liste", metodo, corpo);
    setOccupato(false);
    if (!r.ok) { toast.error(r.message); return; }
    if (metodo === "DELETE") toast.success("DA-GEO scollegato");
    else if (r.data.errore) toast.error(r.data.errore);
    else toast.success(`${numero(r.data.liste.length)} liste scaricate da DA-GEO`);
    setAMano(false);
    if (metodo === "DELETE") setFinestra(null);
    if (metodo === "PUT") { setFinita("collegato"); if (richiesta) void mandaJson("/api/traffico/liste/collega", "DELETE"); setRichiesta(null); }
    onCambiato(r.data);
  };

  if (errore !== null) return <LoadError what="le liste di DA-GEO" message={errore} onRetry={onRicarica} />;
  if (stato === null) return <p className="rounded-xl border bg-card px-4 py-3 text-sm text-muted-foreground" role="status">Carico le liste di DA-GEO…</p>;

  const ferme = stato.liste.filter((l) => l.in_errore || l.vecchia).length;
  const filtro = (chi: Segnate, testo: string, quanti: number | null) => (
    <Button variant={segnate === chi ? "default" : "outline"} aria-pressed={segnate === chi} onClick={() => onSegnate(segnate === chi ? null : chi)}>
      <span className="font-mono tabular-nums">{quanti === null ? "—" : numero(quanti)}</span> {testo}
    </Button>
  );
  const ha = (t: TipoLista) => stato.liste.some((l) => l.tipo === t);

  return (
    <section aria-label="DA-GEO" className={cn("flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border bg-card px-4 py-3", !stato.configurato && "border-2 border-[#C9A800]")}>
      {!stato.configurato ? (
        <>
          <div className="min-w-64 flex-1">
            <p className="flex items-center gap-2 text-[15px] font-semibold"><Segno tono="attenzione" testo="non collegato" /> Le destinazioni non sono ancora controllate</p>
            <p className="text-[13px] text-muted-foreground">
              {richiesta ? <>In attesa della conferma in DA-GEO: richiesta <span className="font-mono font-semibold">{richiesta.numero}</span>, <Scadenza scade={richiesta.scade} />.</>
                : admin ? "Collega DA-GEO per segnare qui sotto gli indirizzi compromessi e i paesi ad alto rischio. Le liste si scaricano intere: nessun indirizzo esce di qui."
                  : "Un amministratore può collegare DA-GEO, per segnare gli indirizzi compromessi e i paesi ad alto rischio."}
            </p>
          </div>
          {admin && <Button size="lg" disabled={occupato} onClick={apriCollega}>{richiesta ? "Riprendi" : "Collega DA-GEO"}</Button>}
        </>
      ) : (
        <>
          <div className="min-w-64 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
              {stato.errore ? <Segno tono="attenzione" testo="da guardare" /> : ferme > 0 ? <Segno tono="attenzione" testo={ferme === 1 ? "una lista ferma" : `${ferme} liste ferme`} /> : stato.liste.length === 0 ? <Segno tono="attenzione" testo="nessuna lista" /> : <Segno tono="ok" testo="controllate" />}
              Destinazioni controllate con DA-GEO
            </p>
            <p className="text-[13px] text-muted-foreground">
              {stato.errore ?? <>{stato.cliente && <>{stato.cliente} · </>}{stato.liste.length === 1 ? "1 lista" : `${stato.liste.length} liste`} · {stato.ultimo_giro ? <>scaricate <TempoRelativo data={stato.ultimo_giro} /></> : "mai scaricate"}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(ha("reputazione") || segnate === "compromesse") && filtro("compromesse", "compromesse", compromesse)}
            {(ha("geo") || segnate === "bloccate") && filtro("bloccate", "da geoblocking", bloccherebbe)}
            {admin && <><span aria-hidden className="h-6 w-px bg-border" /><Button variant="outline" onClick={() => { setAMano(false); setFinestra("gestisci"); }}>Gestisci</Button></>}
          </div>
        </>
      )}

      <Dialog open={finestra === "collega"} onOpenChange={(aperta) => { if (!aperta) setFinestra(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Collega DA-GEO</DialogTitle></DialogHeader>
          {finita === "collegato" && !richiesta ? (
            <>
              <ol>
                <Passo n={1} stato="fatto" titolo="Confermato in DA-GEO" />
                <Passo n={2} stato="fatto" titolo={stato.cliente ? `Collegato come ${stato.cliente}` : "Collegato"} />
                <Passo n={3} stato={stato.errore ? "ora" : "fatto"} titolo={stato.errore ?? `${stato.liste.length} liste scaricate`}>
                  <ul className="text-[13px] text-muted-foreground">{stato.liste.map((l) => <li key={l.nome}>{l.titolo}: <span className="font-mono">{numero(l.voci)}</span> voci</li>)}</ul>
                </Passo>
              </ol>
              <p className="text-[13px] text-muted-foreground">Da domani si aggiornano da sole, ogni mattina alle 5:41.</p>
              <DialogFooter><Button onClick={() => { setFinestra(null); setFinita(null); }}>Fatto</Button></DialogFooter>
            </>
          ) : richiesta ? (
            <>
              <ol>
                <Passo n={1} stato="ora" titolo="Conferma in DA-GEO">
                  <p className="text-[13px] text-muted-foreground">Si apre già sulla richiesta giusta. Controlla che il numero sia lo stesso, poi premi «Collega».</p>
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="font-mono text-2xl font-bold tracking-widest">{richiesta.numero}</span>
                    <a href={richiesta.apri} target="_blank" rel="noreferrer" className={buttonVariants({ size: "lg" })}>Apri DA-GEO <span aria-hidden>↗</span></a>
                  </div>
                </Passo>
                <Passo n={2} stato="dopo" titolo="Aspetto la conferma…">
                  <p className="text-[13px] text-muted-foreground" role="status">{avviso ?? <>Prosegue da solo, <Scadenza scade={richiesta.scade} />.</>}</p>
                </Passo>
                <Passo n={3} stato="dopo" titolo="Scarico le liste" />
              </ol>
              <p className="text-[13px] text-muted-foreground">Non sei sulla rete Domarc? Detta il numero a un collega: lo conferma da DA-GEO, «Collega un DA-IPAM».</p>
            </>
          ) : (
            <div className="space-y-3 text-sm" role="status">
              <p>{finita === "rifiutata" ? "La richiesta è stata rifiutata in DA-GEO." : finita === "scaduta" ? "La richiesta è scaduta senza conferma." : avviso ?? "Preparo la richiesta…"}</p>
              {(finita !== null || avviso !== null) && <Button disabled={occupato} onClick={() => void chiedi()}>Riprova</Button>}
            </div>
          )}
          {!(finita === "collegato" && !richiesta) && (aMano
            ? <CodiceAMano url={stato.url} occupato={occupato} onSalva={(u, c) => void manda("PUT", { url: u, codice: c })} />
            : (
              <DialogFooter className="sm:justify-between">
                <Button variant="outline" onClick={() => setAMano(true)}>Codice a mano</Button>
                {richiesta && <Button variant="outline" onClick={() => void annulla()}>Annulla la richiesta</Button>}
              </DialogFooter>
            ))}
        </DialogContent>
      </Dialog>

      <Dialog open={finestra === "gestisci"} onOpenChange={(aperta) => { if (!aperta) setFinestra(null); }}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader><DialogTitle>Liste di DA-GEO</DialogTitle></DialogHeader>
          <p className="text-[13px] text-muted-foreground">
            Da <span className="font-mono">{stato.url}</span>, ogni mattina alle 5:41. Si scaricano intere e si cerca qui: nessun indirizzo esce dall&apos;installazione.
          </p>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border"><TabellaListe stato={stato} /></div>
          {aMano && <CodiceAMano url={stato.url} occupato={occupato} onSalva={(u, c) => void manda("PUT", { url: u, codice: c })} />}
          <DialogFooter className="sm:justify-between">
            <span className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setFinestra("togli")}>Scollega</Button>
              <Button variant="outline" onClick={() => setAMano((a) => !a)}>{aMano ? "Lascia com'è" : "Codice a mano"}</Button>
              <Button variant="outline" onClick={apriCollega}>Ricollega</Button>
            </span>
            <Button disabled={occupato} onClick={() => void manda("POST")}>{occupato ? "Scarico…" : "Scarica adesso"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={finestra === "togli"} onOpenChange={(aperta) => { if (!aperta) setFinestra(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Scollegare DA-GEO?</DialogTitle></DialogHeader>
          <p className="text-sm">Si tolgono il codice e le liste scaricate: non nasceranno più avvisi «Indirizzo compromesso». Quelli già nati restano. In DA-GEO il dispositivo va revocato a parte.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinestra("gestisci")}>Annulla</Button>
            <Button variant="destructive" disabled={occupato} onClick={() => void manda("DELETE")}>Scollega</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

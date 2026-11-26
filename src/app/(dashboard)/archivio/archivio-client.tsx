"use client";

/**
 * «Archivio»: le credenziali degli utenti, in un archivio KDBX che si apre con la password principale personale e
 * il codice a sei cifre (ADR 0043; tavola del 26/11/2026). Ad archivio chiuso la pagina non riceve nemmeno i titoli.
 * Un segreto si chiede uno per volta, torna nascosto dopo 30 secondi, e ogni lettura finisce nel registro.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BarraStato, Pannello, Vuoto } from "@/components/shared/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Segno } from "@/components/protezione/pezzi";

interface Stato { esiste: boolean; autorizzato: boolean; aperto: boolean; scade: number | null; provvisoria: boolean; sbagliati: number }
interface Voce { percorso: string; gruppo: string; titolo: string; utente: string; url: string; versione: number }
interface Dettaglio extends Voce { note: string; segreti: string[]; versioniPrima: number }
interface Quadro {
  stato: Stato; secondoFattore: boolean; puoCreare: boolean; io: number;
  voci?: Voce[]; accessi?: Array<{ utenteId: number; utente: string; dal: string; provvisoria: boolean }>;
}
const SECONDI_VISTA = 30;
const AVVISO = "rounded-lg border-2 border-[#C9A800] bg-[#FFD400] px-3 py-2 font-semibold text-[#0D2537]";

async function chiedi(corpo: object): Promise<{ ok: boolean; stato: number; dati: Record<string, unknown> }> {
  try {
    const r = await fetch("/api/archivio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    return { ok: r.ok, stato: r.status, dati: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, stato: 0, dati: { error: "L'appliance non risponde da qui." } };
  }
}
const mmss = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export function ArchivioClient({ utenti }: { utenti: Array<{ id: number; nome: string }> }) {
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [restano, setRestano] = useState<number | null>(null);
  const [codiceNuovo, setCodiceNuovo] = useState<string | null>(null);
  const [gruppo, setGruppo] = useState<string | null>(null);
  const [cerca, setCerca] = useState("");
  const [dettaglio, setDettaglio] = useState<Dettaglio | null>(null);
  const [vista, setVista] = useState<{ campo: string; valore: string } | null>(null);
  const [modulo, setModulo] = useState<null | { percorso?: string; gruppo: string; titolo: string; utente: string; url: string; note: string; password: string; versioneAttesa?: number }>(null);
  const [f, setF] = useState({ password: "", codice: "", nuova: "", codiceAmm: "", utenteId: "", provvisoria: "" });
  const orologio = useRef<ReturnType<typeof setInterval> | null>(null);
  const nascondi = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carica = useCallback(async () => {
    try {
      const r = await fetch("/api/archivio", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Stato non letto");
      setQuadro(d);
      setErrore(null);
      setRestano(d.stato.scade ? Math.max(0, Math.round((d.stato.scade - Date.now()) / 1000)) : null);
      if (!d.stato.aperto) { setDettaglio(null); setVista(null); setModulo(null); }
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Stato non letto");
    }
  }, []);

  useEffect(() => {
    void carica();
  }, [carica]);

  // Conto alla rovescia della richiusura; a zero si rilegge lo stato (il server ha già chiuso).
  useEffect(() => {
    if (orologio.current) clearInterval(orologio.current);
    if (!quadro?.stato.aperto) return;
    orologio.current = setInterval(() => {
      setRestano((r) => {
        if (r === null) return r;
        if (r <= 1) { void carica(); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => { if (orologio.current) clearInterval(orologio.current); };
  }, [quadro?.stato.aperto, carica]);
  useEffect(() => () => { if (nascondi.current) clearTimeout(nascondi.current); }, []);

  const fai = useCallback(async (corpo: object, riuscito?: string): Promise<Record<string, unknown> | null> => {
    setInCorso(true);
    const r = await chiedi(corpo);
    setInCorso(false);
    if (!r.ok) {
      toast.error(String(r.dati.error ?? "Non riuscito"));
      if (r.stato === 423) await carica();
      return null;
    }
    if (riuscito) toast.success(riuscito);
    return r.dati;
  }, [carica]);

  if (errore && !quadro) return <Vuoto titolo="Stato dell'archivio non letto" testo={errore} />;
  if (!quadro) return <Vuoto titolo="Lettura in corso…" />;
  const { stato } = quadro;
  const campo = (nome: keyof typeof f, etichetta: string, tipo = "password", segnaposto = "") => (
    <label className="grid grid-cols-[13rem_1fr] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{etichetta}</span>
      <Input type={tipo} value={f[nome]} onChange={(e) => setF({ ...f, [nome]: e.target.value })} placeholder={segnaposto} autoComplete="off" className="max-w-md font-mono" />
    </label>
  );

  // ── Il codice dell'amministratore appena nato: si vede una volta sola ──
  if (codiceNuovo) {
    return (
      <Pannello titolo="Codice dell'amministratore dell'archivio" sottotitolo="Si vede solo adesso. Non sta sul disco e nessuno potrà rileggerlo.">
        <div className="space-y-3">
          <p className="rounded-lg border-2 border-foreground bg-card px-4 py-3 text-center font-mono text-xl font-bold tracking-wider select-all">{codiceNuovo}</p>
          <p className={AVVISO}>▲ Scrivilo e consegnalo a chi deve comandare sull&apos;archivio. Con questo codice, e solo con questo, si dà, si ridà e si toglie l&apos;accesso alle persone. Se si perde, nessuno potrà più dare o ridare un accesso: né il superadmin dell&apos;installazione, né Domarc.</p>
          <Button onClick={() => { setCodiceNuovo(null); void carica(); }}>L&apos;ho scritto e messo al sicuro</Button>
        </div>
      </Pannello>
    );
  }

  // ── Non esiste ancora ──
  if (!stato.esiste) {
    return (
      <Pannello titolo="Archivio delle credenziali" sottotitolo="Un archivio riservato alle persone, separato dalle credenziali che DA-IPAM usa per lavorare.">
        {quadro.puoCreare ? (
          <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const d = await fai({ azione: "crea", codice: f.codice }); if (d?.codiceAmministratore) { setF({ ...f, codice: "" }); setCodiceNuovo(String(d.codiceAmministratore)); } }}>
            <p className="text-sm">Creandolo nasce il <b>codice dell&apos;amministratore dell&apos;archivio</b>, mostrato una volta sola. Chi lo possiede comanda sull&apos;archivio; chi lo crea non ha nessun accesso alle voci finché non se lo dà con quel codice.</p>
            {!quadro.secondoFattore && <p className={AVVISO}>▲ Per crearlo serve la verifica in due passaggi attiva sul tuo utente (Impostazioni › Utenti).</p>}
            {campo("codice", "Il tuo codice a 6 cifre", "text", "123456")}
            <Button type="submit" disabled={inCorso || !quadro.secondoFattore || f.codice.trim().length !== 6}>Crea l&apos;archivio</Button>
          </form>
        ) : (
          <Vuoto titolo="L'archivio non è ancora stato creato" testo="Lo crea un amministratore dell'installazione." />
        )}
      </Pannello>
    );
  }

  const moduloAccessi = (
    <Pannello titolo="Accessi" sottotitolo="Dare, ridare e togliere l'accesso si fa solo col codice dell'amministratore dell'archivio. Il ruolo in DA-IPAM non conta." conteggio={quadro.accessi?.length}>
      <div className="space-y-3">
        {quadro.accessi && (
          <ul className="space-y-1 text-sm">
            {quadro.accessi.map((a) => (
              <li key={a.utenteId} className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{a.utente}</span>
                {a.provvisoria && <Segno tono="avviso" segno="▲">password provvisoria</Segno>}
              </li>
            ))}
            {quadro.accessi.length === 0 && <li className="text-muted-foreground">Nessuno ha ancora l&apos;accesso.</li>}
          </ul>
        )}
        {campo("codiceAmm", "Codice dell'amministratore", "password", "XXXX-XXXX-…")}
        <label className="grid grid-cols-[13rem_1fr] items-center gap-2 text-sm">
          <span className="text-muted-foreground">Persona</span>
          <select value={f.utenteId} onChange={(e) => setF({ ...f, utenteId: e.target.value })} className="h-9 max-w-md rounded-md border-2 border-border bg-card px-2">
            <option value="">scegli…</option>
            {utenti.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
        {campo("provvisoria", "Password provvisoria (14+)", "text")}
        <div className="flex flex-wrap gap-2">
          <Button disabled={inCorso || !f.codiceAmm || !f.utenteId || f.provvisoria.length < 14} onClick={async () => { if (await fai({ azione: "dai_accesso", codiceAmministratore: f.codiceAmm, utenteId: Number(f.utenteId), passwordProvvisoria: f.provvisoria }, "Accesso dato: la password provvisoria va cambiata alla prima apertura.")) { setF({ ...f, codiceAmm: "", provvisoria: "", utenteId: "" }); await carica(); } }}>Dai o ridai l&apos;accesso</Button>
          <Button variant="outline" disabled={inCorso || !f.codiceAmm || !f.utenteId} onClick={async () => { if (await fai({ azione: "togli_accesso", codiceAmministratore: f.codiceAmm, utenteId: Number(f.utenteId) }, "Accesso tolto.")) { setF({ ...f, codiceAmm: "", utenteId: "" }); await carica(); } }}>Togli l&apos;accesso</Button>
          <Button variant="outline" disabled={inCorso || !f.codiceAmm} onClick={async () => { const d = await fai({ azione: "sostituisci_codice", codiceAmministratore: f.codiceAmm }); if (d?.codiceAmministratore) { setF({ ...f, codiceAmm: "" }); setCodiceNuovo(String(d.codiceAmministratore)); } }}>Sostituisci il codice (il vecchio non varrà più)</Button>
        </div>
      </div>
    </Pannello>
  );

  // ── Chiuso (o non autorizzato) ──
  if (!stato.aperto) {
    return (
      <>
        <BarraStato acceso={false} titolo="Archivio delle credenziali" stato="chiuso" dettagli={["si apre con password principale personale e codice a 6 cifre", "si richiude da solo dopo 10 minuti senza gesti"]} />
        <div className="grid gap-3 xl:grid-cols-2">
          <Pannello titolo="Apri l'archivio" sottotitolo="Separato dal login di DA-IPAM. La password non viene salvata: né sul disco, né nel browser.">
            {!stato.autorizzato ? (
              <Vuoto titolo="Non hai l'autorizzazione a usare l'archivio" testo="Te la dà chi possiede il codice dell'amministratore dell'archivio, dal riquadro «Accessi»." />
            ) : (
              <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const d = await fai({ azione: "apri", password: f.password, codice: f.codice, ...(stato.provvisoria ? { nuovaPassword: f.nuova } : {}) }, "Archivio aperto."); setF({ ...f, password: "", codice: "", nuova: "" }); if (d) setGruppo(null); await carica(); }}>
                {!quadro.secondoFattore && <p className={AVVISO}>▲ Per aprire serve la verifica in due passaggi attiva sul tuo utente (Impostazioni › Utenti).</p>}
                {campo("password", stato.provvisoria ? "Password provvisoria" : "Password principale")}
                {stato.provvisoria && campo("nuova", "Nuova password (14+)")}
                {campo("codice", "Codice a 6 cifre", "text", "123456")}
                {stato.provvisoria && <p className="text-[13px] text-muted-foreground">La tua password è provvisoria: sceglierne una nuova è obbligatorio per aprire.</p>}
                {stato.sbagliati > 0 && <p className={AVVISO}>▲ {stato.sbagliati} tentativi sbagliati negli ultimi 15 minuti · al quinto si blocca per 15 minuti e parte un avviso</p>}
                <Button type="submit" disabled={inCorso || !f.password || f.codice.trim().length !== 6 || (stato.provvisoria && f.nuova.length < 14)}>Apri per 10 minuti</Button>
              </form>
            )}
          </Pannello>
          {moduloAccessi}
        </div>
      </>
    );
  }

  // ── Aperto ──
  const voci = quadro.voci ?? [];
  const gruppi = [...new Set(voci.map((v) => v.gruppo))].sort();
  const q = cerca.trim().toLowerCase();
  const visibili = voci.filter((v) => (gruppo === null || v.gruppo === gruppo) && (!q || `${v.titolo} ${v.utente} ${v.url}`.toLowerCase().includes(q)));
  const apriVoce = async (percorso: string) => {
    setVista(null);
    const d = await fai({ azione: "dettaglio", percorso });
    if (d?.voce) setDettaglio(d.voce as Dettaglio);
    await carica();
  };
  const segreto = async (c: string, modo: "mostrato" | "copiato") => {
    if (!dettaglio) return;
    const d = await fai({ azione: "campo", percorso: dettaglio.percorso, campo: c, modo });
    if (!d || typeof d.valore !== "string") return;
    if (nascondi.current) clearTimeout(nascondi.current);
    if (modo === "mostrato") {
      setVista({ campo: c, valore: d.valore });
      nascondi.current = setTimeout(() => setVista(null), SECONDI_VISTA * 1000);
    } else {
      try {
        await navigator.clipboard.writeText(d.valore);
        toast.success(`Copiato: fra ${SECONDI_VISTA} secondi lo tolgo dagli appunti.`);
        nascondi.current = setTimeout(() => { void navigator.clipboard.writeText("").catch(() => undefined); }, SECONDI_VISTA * 1000);
      } catch {
        toast.error("Il browser non permette di copiare da qui: usa «Mostra».");
      }
    }
  };
  const salva = async () => {
    if (!modulo) return;
    const d = await fai({ azione: "scrivi", percorso: modulo.percorso, gruppo: modulo.gruppo, titolo: modulo.titolo, utente: modulo.utente, url: modulo.url, note: modulo.note, versioneAttesa: modulo.versioneAttesa, ...(modulo.password ? { segreti: { password: modulo.password } } : {}) }, "Salvato.");
    if (!d) return;
    setModulo(null);
    await carica();
    await apriVoce(String(d.percorso));
  };

  return (
    <>
      <BarraStato
        acceso
        titolo="Archivio delle credenziali"
        stato="aperto"
        dettagli={[restano !== null ? `si richiude fra ${mmss(restano)}` : "aperto", `${voci.length} voci in ${gruppi.length} gruppi`]}
        azioni={<Button onClick={async () => { await fai({ azione: "chiudi" }, "Archivio chiuso."); await carica(); }} disabled={inCorso}>Chiudi ora</Button>}
      />
      <div className="grid gap-3 xl:grid-cols-[18rem_1fr_34rem]">
        <Pannello numero={1} titolo="Gruppi" conteggio={gruppi.length} corpoClassName="p-2">
          <ul className="space-y-1">
            {[null, ...gruppi].map((g) => (
              <li key={g ?? "*"}>
                <button type="button" onClick={() => setGruppo(g)} className={`flex w-full items-center justify-between rounded-lg border-2 px-3 py-1.5 text-left text-sm ${gruppo === g ? "border-foreground bg-primary/10 font-semibold" : "border-transparent hover:bg-muted"}`}>
                  <span>{g ?? "Tutti"}</span>
                  <span className="font-mono text-[13px]">{g === null ? voci.length : voci.filter((v) => v.gruppo === g).length}</span>
                </button>
              </li>
            ))}
          </ul>
        </Pannello>

        <Pannello numero={2} titolo="Voci" conteggio={visibili.length} sottotitolo="I segreti non compaiono mai in elenco." corpoClassName="p-0"
          azioni={<Button size="sm" disabled={inCorso} onClick={() => setModulo({ gruppo: gruppo ?? "", titolo: "", utente: "", url: "", note: "", password: "" })}>+ Aggiungi voce</Button>}>
          <div className="border-b p-2"><Input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca in titolo, utente, URL…" aria-label="Cerca fra le voci" /></div>
          {visibili.length === 0 ? <div className="p-3"><Vuoto titolo={voci.length === 0 ? "L'archivio è vuoto" : "Nessuna voce con questo filtro"} testo={voci.length === 0 ? "Premi «+ Aggiungi voce»." : undefined} /></div> : (
            <Table>
              <TableHeader><TableRow><TableHead>Titolo</TableHead><TableHead>Utente</TableHead><TableHead>URL</TableHead><TableHead>Gruppo</TableHead></TableRow></TableHeader>
              <TableBody>
                {visibili.slice(0, 300).map((v) => (
                  <TableRow key={v.percorso} onClick={() => void apriVoce(v.percorso)} className={`cursor-pointer ${dettaglio?.percorso === v.percorso ? "bg-primary/10 font-semibold" : ""}`}>
                    <TableCell>{v.titolo}</TableCell>
                    <TableCell className="font-mono text-[13px]">{v.utente || "—"}</TableCell>
                    <TableCell className="max-w-64 truncate font-mono text-[13px]">{v.url || "—"}</TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{v.gruppo}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Pannello>

        {modulo ? (
          <Pannello numero={3} titolo={modulo.percorso ? "Modifica la voce" : "Voce nuova"}>
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void salva(); }}>
              {([["titolo", "Titolo"], ["gruppo", "Gruppo"], ["utente", "Utente"], ["url", "URL"]] as const).map(([k, e]) => (
                <label key={k} className="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm"><span className="text-muted-foreground">{e}</span><Input value={modulo[k]} onChange={(ev) => setModulo({ ...modulo, [k]: ev.target.value })} disabled={k === "gruppo" && Boolean(modulo.percorso)} /></label>
              ))}
              <label className="grid grid-cols-[7rem_1fr] items-center gap-2 text-sm"><span className="text-muted-foreground">Password</span><Input type="password" autoComplete="new-password" value={modulo.password} onChange={(ev) => setModulo({ ...modulo, password: ev.target.value })} placeholder={modulo.percorso ? "vuoto = resta quella di prima" : ""} className="font-mono" /></label>
              <label className="grid grid-cols-[7rem_1fr] items-start gap-2 text-sm"><span className="pt-2 text-muted-foreground">Note</span><textarea value={modulo.note} onChange={(ev) => setModulo({ ...modulo, note: ev.target.value })} rows={3} className="rounded-md border-2 border-border bg-card p-2" /></label>
              <div className="flex gap-2 pt-1"><Button type="submit" disabled={inCorso || !modulo.titolo.trim()}>Salva</Button><Button type="button" variant="outline" onClick={() => setModulo(null)}>Annulla</Button></div>
            </form>
          </Pannello>
        ) : dettaglio ? (
          <Pannello numero={3} titolo={dettaglio.titolo} sottotitolo={`versione ${dettaglio.versione} · ${dettaglio.versioniPrima} nello storico · gruppo ${dettaglio.gruppo}`}>
            <dl className="space-y-2 text-sm">
              <div className="grid grid-cols-[7rem_1fr] gap-2"><dt className="text-muted-foreground">Utente</dt><dd className="font-mono">{dettaglio.utente || "—"}</dd></div>
              <div className="grid grid-cols-[7rem_1fr] gap-2"><dt className="text-muted-foreground">URL</dt><dd className="font-mono break-all">{dettaglio.url || "—"}</dd></div>
              {dettaglio.segreti.map((c) => (
                <div key={c} className="grid grid-cols-[7rem_1fr] items-center gap-2">
                  <dt className="text-muted-foreground">{c === "password" ? "Password" : c}</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <span className="font-mono break-all">{vista?.campo === c ? vista.valore : "••••••••••••"}</span>
                    <Button size="sm" variant="outline" disabled={inCorso} onClick={() => void segreto(c, "mostrato")}>Mostra {SECONDI_VISTA} s</Button>
                    <Button size="sm" variant="outline" disabled={inCorso} onClick={() => void segreto(c, "copiato")}>Copia</Button>
                  </dd>
                </div>
              ))}
              {dettaglio.segreti.length === 0 && <div className="text-muted-foreground">Questa voce non ha segreti.</div>}
              <div className="grid grid-cols-[7rem_1fr] gap-2"><dt className="text-muted-foreground">Note</dt><dd className="whitespace-pre-wrap">{dettaglio.note || "—"}</dd></div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
              <Button size="sm" disabled={inCorso} onClick={() => setModulo({ percorso: dettaglio.percorso, gruppo: dettaglio.gruppo, titolo: dettaglio.titolo, utente: dettaglio.utente, url: dettaglio.url, note: dettaglio.note, password: "", versioneAttesa: dettaglio.versione })}>Modifica</Button>
              <Button size="sm" variant="outline" disabled={inCorso} onClick={async () => { if (window.confirm(`Cancellare «${dettaglio.titolo}»?`) && (await fai({ azione: "cancella", percorso: dettaglio.percorso, versioneAttesa: dettaglio.versione }, "Voce cancellata."))) { setDettaglio(null); await carica(); } }}>Cancella</Button>
            </div>
            <p className="mt-2 text-[13px] text-muted-foreground">Ogni «Mostra» e ogni «Copia» finisce nel registro dell&apos;archivio con il tuo nome.</p>
          </Pannello>
        ) : (
          <Pannello numero={3} titolo="Dettaglio"><Vuoto titolo="Scegli una voce" testo="Il dettaglio compare qui; i segreti restano nascosti finché non premi «Mostra»." /></Pannello>
        )}
      </div>
      {moduloAccessi}
    </>
  );
}

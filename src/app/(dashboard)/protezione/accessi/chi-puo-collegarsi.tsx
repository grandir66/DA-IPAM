"use client";

/**
 * «Chi può collegarsi»: gli elenchi di indirizzi per gruppo di porte, e i quattro gesti sul filtro
 * (Protezione, tappa 2; ADR 0041; tavola del 25/11/2026, oggetto 10). La bozza vive qui; niente cambia sulla
 * macchina finché non si preme «Metti in osservazione» o «Applica in prova». La conferma è una richiesta nuova:
 * se dopo la prova la pagina non raggiunge più l'appliance non arriva, e tornano le regole di prima.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BarraStato, Pannello, Vuoto } from "@/components/shared/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Segno } from "@/components/protezione/pezzi";
import type { Anteprima, Visto } from "@/lib/protezione/anteprima";
import type { StatoFiltro } from "@/lib/protezione/esecutore";
import { GRUPPI, NOME_GRUPPO, PORTE_GRUPPO, tipoIndirizzo, type GruppoAccessi, type Politica } from "@/lib/protezione/politica";

interface Quadro {
  stato: StatoFiltro;
  politica: Politica;
  visti: Visto[];
  tuoIndirizzo: string | null;
  secondiProva: number;
}

type Elenco = "sempre" | GruppoAccessi;
const NOME_ELENCO: Record<Elenco, string> = { sempre: "Sempre ammessi", ...NOME_GRUPPO };
const porteDi = (g: GruppoAccessi): string => [...PORTE_GRUPPO[g].tcp.map((p) => `${p}/tcp`), ...PORTE_GRUPPO[g].udp.map((p) => `${p}/udp`)].join(" ");
const gruppoDi = (porta: number): GruppoAccessi | null => GRUPPI.find((g) => PORTE_GRUPPO[g].tcp.includes(porta) || PORTE_GRUPPO[g].udp.includes(porta)) ?? null;
const PAROLA_STATO: Record<StatoFiltro["tabella"], string> = { assente: "spento", osserva: "osserva", acceso: "acceso", minima: "in emergenza" };

export function ChiPuoCollegarsi() {
  const [quadro, setQuadro] = useState<Quadro | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [bozza, setBozza] = useState<Politica | null>(null);
  const [nuovo, setNuovo] = useState<Record<Elenco, string>>({ sempre: "", web: "", ssh: "", console: "", dati: "" });
  const [anteprima, setAnteprima] = useState<{ anteprima: Anteprima; regole: { ok: boolean; messaggio: string } } | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [restano, setRestano] = useState<number | null>(null);
  const [spegnere, setSpegnere] = useState(false);
  const orologio = useRef<ReturnType<typeof setInterval> | null>(null);

  const carica = useCallback(async (tieniBozza: boolean) => {
    try {
      const r = await fetch("/api/protezione/accessi", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Stato non letto");
      setQuadro(d);
      setErrore(null);
      if (!tieniBozza) setBozza(d.politica);
      return d as Quadro;
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Stato non letto");
      return null;
    }
  }, []);

  useEffect(() => {
    void carica(false);
  }, [carica]);

  const fermaOrologio = useCallback(() => {
    if (orologio.current) clearInterval(orologio.current);
    orologio.current = null;
  }, []);
  useEffect(() => fermaOrologio, [fermaOrologio]);

  const avviaOrologio = useCallback((secondi: number) => {
    fermaOrologio();
    const fine = Date.now() + secondi * 1000;
    setRestano(secondi);
    orologio.current = setInterval(() => {
      const r = Math.max(0, Math.round((fine - Date.now()) / 1000));
      setRestano(r);
      if (r === 0) {
        fermaOrologio();
        setRestano(null);
        toast.info("La prova è scaduta: sono tornate le regole di prima.");
        void carica(true);
      }
    }, 1000);
  }, [carica, fermaOrologio]);

  const manda = useCallback(async (corpo: object): Promise<{ ok: boolean; dati: Record<string, unknown> }> => {
    setInCorso(true);
    try {
      const r = await fetch("/api/protezione/accessi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const dati = await r.json().catch(() => ({}));
      return { ok: r.ok, dati };
    } catch {
      return { ok: false, dati: { error: "L'appliance non risponde da qui." } };
    } finally {
      setInCorso(false);
    }
  }, []);

  if (errore && !quadro) return <Vuoto titolo="Stato del filtro non letto" testo={errore} />;
  if (!quadro || !bozza) return <Vuoto titolo="Lettura in corso…" />;

  const { stato } = quadro;
  const inProva = stato.provaInCorso || restano !== null;
  const cambiata = JSON.stringify(bozza) !== JSON.stringify(quadro.politica);
  const elencoDi = (e: Elenco): string[] => (e === "sempre" ? bozza.sempre : bozza.gruppi[e].indirizzi);
  const metti = (e: Elenco, indirizzi: string[]) => {
    setAnteprima(null);
    setBozza(e === "sempre" ? { ...bozza, sempre: indirizzi } : { ...bozza, gruppi: { ...bozza.gruppi, [e]: { ...bozza.gruppi[e], indirizzi } } });
  };
  const aggiungi = (e: Elenco, valore: string) => {
    const v = valore.trim();
    if (!v) return;
    if (tipoIndirizzo(v) === null) return void toast.error(`«${v}» non è un indirizzo né una rete ammessa (IPv4 da /8 a /32, IPv6 da /16 a /128).`);
    if (elencoDi(e).includes(v)) return void toast.error(`«${v}» è già in ${NOME_ELENCO[e]}.`);
    metti(e, [...elencoDi(e), v]);
    setNuovo({ ...nuovo, [e]: "" });
  };
  const apri = (g: GruppoAccessi, aperto: boolean) => {
    setAnteprima(null);
    setBozza({ ...bozza, gruppi: { ...bozza.gruppi, [g]: { ...bozza.gruppi[g], aperto } } });
  };

  const chiediAnteprima = async () => {
    const r = await manda({ azione: "anteprima", politica: bozza });
    if (!r.ok) return void toast.error(String(r.dati.error ?? "Anteprima non riuscita"));
    setAnteprima(r.dati as unknown as { anteprima: Anteprima; regole: { ok: boolean; messaggio: string } });
  };
  const azione = async (nome: "osserva" | "prova" | "conferma" | "annulla" | "spegni") => {
    const r = await manda(nome === "osserva" || nome === "prova" ? { azione: nome, politica: bozza } : { azione: nome });
    const messaggio = String(r.dati.messaggio ?? r.dati.error ?? (r.ok ? "Fatto" : "Non riuscito"));
    if (r.ok) toast.success(messaggio);
    else toast.error(messaggio);
    setSpegnere(false);
    if (nome === "prova" && r.ok) avviaOrologio(quadro.secondiProva);
    else {
      fermaOrologio();
      setRestano(null);
    }
    setAnteprima(null);
    await carica(nome === "prova" || !r.ok);
  };

  const vistiFuori = quadro.visti.filter((v) => {
    const g = gruppoDi(v.porta);
    return !(bozza.sempre.includes(v.indirizzo) || (g && (bozza.gruppi[g].aperto || bozza.gruppi[g].indirizzi.includes(v.indirizzo))));
  });

  return (
    <>
      <BarraStato
        acceso={stato.tabella === "acceso"}
        titolo="Filtro degli accessi"
        stato={inProva ? `in prova${restano !== null ? `, ${restano} s` : ""}` : PAROLA_STATO[stato.tabella]}
        dettagli={[
          stato.tabella === "acceso" && !inProva ? "installazione protetta" : inProva ? "senza conferma tornano le regole di prima" : "installazione NON protetta",
          quadro.tuoIndirizzo ? `tu arrivi da ${quadro.tuoIndirizzo}` : "il tuo indirizzo non si legge",
          // Hub, 26/11/2026: «il mio» era 192.168.30.10, l'instradatore di NetBird. Ammetterlo ha ammesso tutti quelli che passano di lì.
          "se passi da NetBird, una VPN o un NAT quell'indirizzo è dell'instradatore, comune a tutti quelli che passano di lì",
        ]}
        azioni={
          inProva ? (
            <>
              <Button onClick={() => void azione("conferma")} disabled={inCorso}>Conferma: tieni il filtro acceso</Button>
              <Button variant="outline" onClick={() => void azione("annulla")} disabled={inCorso}>Annulla ora</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => void chiediAnteprima()} disabled={inCorso || !stato.disponibile}>Anteprima</Button>
              <Button variant="outline" onClick={() => void azione("osserva")} disabled={inCorso || !stato.disponibile}>Metti in osservazione</Button>
              <Button onClick={() => void azione("prova")} disabled={inCorso || !stato.disponibile}>Applica in prova ({Math.round(quadro.secondiProva / 60)} minuti)</Button>
              {stato.tabella !== "assente" &&
                (spegnere ? (
                  <Button variant="destructive" onClick={() => void azione("spegni")} disabled={inCorso}>Sì, spegni il filtro</Button>
                ) : (
                  <Button variant="outline" onClick={() => setSpegnere(true)} disabled={inCorso}>Spegni il filtro</Button>
                ))}
            </>
          )
        }
      />

      {!stato.disponibile && <Vuoto titolo="Il filtro non si può caricare da questa macchina" testo={stato.motivo ?? ""} />}
      {stato.tabella === "minima" && (
        <Vuoto titolo="Filtro in emergenza" testo="All'accensione le ultime regole sono state rifiutate: è caricata la politica minima (solo NetBird/DA-Link e sempre ammessi). Rimetti in osservazione o applica di nuovo." />
      )}

      {anteprima && (
        <Pannello titolo="Anteprima" sottotitolo="Cosa cambia se applichi la bozza. Niente è ancora cambiato sulla macchina." conteggio={anteprima.anteprima.cambi.length}>
          <div className="space-y-2 text-sm">
            {anteprima.anteprima.avvisi.map((a) => (
              <p key={a} className="rounded-lg border-2 border-[#C9A800] bg-[#FFD400] px-3 py-2 font-semibold text-[#0D2537]">▲ {a}</p>
            ))}
            {!anteprima.regole.ok && <p className="rounded-lg border-2 border-foreground px-3 py-2 font-semibold">■ Le regole non si generano: {anteprima.regole.messaggio}</p>}
            {anteprima.anteprima.cambi.length === 0 ? <p className="text-muted-foreground">La bozza è uguale alla politica in vigore.</p> : (
              <ul className="space-y-0.5">{anteprima.anteprima.cambi.map((c) => <li key={c} className="font-mono text-[13px]">› {c}</li>)}</ul>
            )}
            <p className="pt-1 font-semibold">
              {anteprima.anteprima.fuori.length === 0 ? "Fra gli indirizzi visti finora, nessuno resterebbe fuori." : `Resterebbero fuori ${anteprima.anteprima.fuori.length} fra indirizzi e porte visti finora:`}
            </p>
            {anteprima.anteprima.fuori.length > 0 && (
              <ul className="grid gap-x-6 gap-y-0.5 md:grid-cols-2 xl:grid-cols-3">
                {anteprima.anteprima.fuori.slice(0, 60).map((f) => <li key={`${f.indirizzo}-${f.porta}`} className="font-mono text-[13px]">{f.indirizzo} → {f.porta} <span className="font-sans text-muted-foreground">({f.gruppo})</span></li>)}
              </ul>
            )}
          </div>
        </Pannello>
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        <Pannello
          numero={1}
          titolo="Elenchi di indirizzi"
          sottotitolo="Per ogni gruppo di porte, chi può arrivarci. Vuoto = nessuno, tranne i sempre ammessi."
          piede={cambiata ? "▲ La bozza è diversa dalla politica in vigore: non è ancora applicata." : "La bozza è uguale alla politica in vigore."}
        >
          <div className="space-y-3">
            {(["sempre", ...GRUPPI] as Elenco[]).map((e) => (
              <section key={e} className="rounded-lg border-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold">{NOME_ELENCO[e]}</span>{" "}
                    <span className="font-mono text-[13px] text-muted-foreground">{e === "sempre" ? "tutte le porte" : porteDi(e)}</span>
                  </div>
                  {e !== "sempre" &&
                    (bozza.gruppi[e].aperto ? (
                      <Button size="sm" variant="outline" disabled={inProva} onClick={() => apri(e, false)}>Chiudi: solo l&apos;elenco</Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={inProva} onClick={() => apri(e, true)}>Apri a tutti</Button>
                    ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {e === "sempre" && <Segno tono="vuoto" segno="○">NetBird / DA-Link · nel codice, non si toglie</Segno>}
                  {e !== "sempre" && bozza.gruppi[e].aperto && <Segno tono="avviso" segno="▲">aperto a tutti</Segno>}
                  {elencoDi(e).map((i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-md border-2 border-foreground/50 py-0.5 pr-0.5 pl-2 font-mono text-[13px]">
                      {i}
                      <button type="button" disabled={inProva} onClick={() => metti(e, elencoDi(e).filter((x) => x !== i))} className="rounded px-1.5 font-sans font-semibold hover:bg-muted" aria-label={`Togli ${i} da ${NOME_ELENCO[e]}`}>
                        ✕ Togli
                      </button>
                    </span>
                  ))}
                  {elencoDi(e).length === 0 && !(e !== "sempre" && bozza.gruppi[e].aperto) && e !== "sempre" && <span className="text-[13px] text-muted-foreground">nessuno</span>}
                </div>
                <form className="mt-2 flex gap-2" onSubmit={(ev) => { ev.preventDefault(); aggiungi(e, nuovo[e]); }}>
                  <Input value={nuovo[e]} onChange={(ev) => setNuovo({ ...nuovo, [e]: ev.target.value })} placeholder="192.0.2.10 oppure 192.0.2.0/24" className="max-w-xs font-mono" disabled={inProva} aria-label={`Indirizzo da aggiungere a ${NOME_ELENCO[e]}`} />
                  <Button type="submit" size="sm" variant="outline" disabled={inProva || !nuovo[e].trim()}>Aggiungi</Button>
                  {quadro.tuoIndirizzo && !elencoDi(e).includes(quadro.tuoIndirizzo) && (e === "sempre" || e === "web") && (
                    <Button type="button" size="sm" variant="outline" disabled={inProva} onClick={() => aggiungi(e, quadro.tuoIndirizzo ?? "")} title="Se passi da NetBird, una VPN o un NAT è l'indirizzo dell'instradatore: vale per tutti quelli che passano di lì.">Aggiungi quello da cui arrivo ({quadro.tuoIndirizzo})</Button>
                  )}
                </form>
              </section>
            ))}
          </div>
        </Pannello>

        <Pannello
          numero={2}
          titolo={stato.tabella === "acceso" ? "Chi ci ha provato" : "Chi resterebbe fuori"}
          conteggio={vistiFuori.length}
          sottotitolo="Indirizzi visti arrivare negli ultimi 7 giorni che la bozza non ammette."
          corpoClassName="p-0"
          piede="Si riempie da quando il filtro è in osservazione o acceso."
        >
          {vistiFuori.length === 0 ? (
            <div className="p-3">
              <Vuoto titolo={stato.tabella === "assente" ? "Il filtro è spento: non si vede chi arriva" : "Nessuno resterebbe fuori"} testo={stato.tabella === "assente" ? "Metti in osservazione: da quel momento qui compare chi arriva senza essere in elenco. L'osservazione non scarta niente." : undefined} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Indirizzo</TableHead>
                  <TableHead>Porta</TableHead>
                  <TableHead>Gruppo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vistiFuori.slice(0, 200).map((v) => {
                  const g = gruppoDi(v.porta);
                  return (
                    <TableRow key={`${v.indirizzo}-${v.porta}`}>
                      <TableCell className="font-mono">{v.indirizzo}</TableCell>
                      <TableCell className="font-mono">{v.porta}</TableCell>
                      <TableCell>{g ? NOME_GRUPPO[g] : <Segno tono="avviso" segno="▲">fuori dai gruppi</Segno>}</TableCell>
                      <TableCell className="text-right">
                        {g && <Button size="sm" variant="outline" disabled={inProva} onClick={() => aggiungi(g, v.indirizzo)}>Ammetti in {NOME_GRUPPO[g]}</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Pannello>
      </div>
    </>
  );
}

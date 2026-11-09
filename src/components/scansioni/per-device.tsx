"use client";

/**
 * Scheda «Per device» della pagina Scansioni VA (tavola approvata il 06/11/2026, oggetti 2-22):
 * 1 Rete → 2 Famiglie → 3 Device → 4 Quando (adesso o pianificata, Passo 6 dell'08/11). Qui non si decide niente: famiglie, profili e conferme
 * vengono dal server, e il lancio rilegge tutto dal database. Le rotte sono `proposte-va` della rete.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InCorso, Pannello, TesseraNumero, VoceSelezionabile, Vuoto } from "@/components/shared/console";
import { LoadError } from "@/components/shared/load-error";
import { fetchJson } from "@/lib/fetch-json";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { cn } from "@/lib/utils";
import type { EsitoGruppiAperti, GruppoAperto } from "@/lib/vuln/proposta/gruppi-aperti";
import type { BloccoRete } from "@/lib/vuln/edge-subnet-bridge";
import type { EsitoLancio } from "@/lib/vuln/proposta/lancio";
import type { RigaFamiglia } from "@/lib/vuln/proposta/quadro";
import type { Famiglia } from "@/lib/vuln/proposta/regole";
import type { ContoProposte, RigaProposta } from "@/lib/vuln/proposta/store";
import { parolaEsito, type TonoStato } from "@/lib/vuln/proposta/testi-esito";
import { scadenzaConsenso, type ConsensoRete, type QuadroScansioni, type ReteScansione } from "@/lib/vuln/scansioni-va-regole";
import { Stato } from "./stato-va";
import { QuandoDevice } from "./quando-device";
import { RiquadroConsenso } from "./impianti-consenso";

interface RispostaProposte {
  proposte: RigaProposta[];
  famiglie: RigaFamiglia[];
  aggiornata_il: string | null;
}

/** Ogni quanto si rilegge a che punto sono i gruppi, solo mentre ce n'è uno aperto. */
const OGNI_MS = 15000;
const DOVE_EDGE = "/settings?tab=moduli";
const campo = "h-8 rounded-md border bg-background px-2 text-sm";

function dataBreve(v: string): string {
  return parseDbDate(v).toLocaleString("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statoRete(r: ReteScansione, c: ContoProposte | undefined): { testo: string; tono: TonoStato } {
  if (r.attivita === "in_corso") return { testo: "▶ In corso", tono: "in_corso" };
  if (r.attivita === "in_coda") return { testo: "● In coda", tono: "ok" };
  if (!c || c.totale === 0) return { testo: "● Senza proposta", tono: "spento" };
  if (c.daRivedere > 0) return { testo: `▲ ${c.daRivedere} da rivedere`, tono: "avviso" };
  if (c.confermate === 0) return { testo: "▲ Da confermare", tono: "avviso" };
  return { testo: `✓ ${c.confermate} confermati`, tono: "ok" };
}

function statoFamiglia(f: RigaFamiglia): { testo: string; tono: TonoStato } {
  if (f.fuori === "mai") return { testo: "✕ Mai scansionati", tono: "errore" };
  if (f.fuori === "chiarire") return { testo: "▲ Fuori finché non si chiarisce", tono: "avviso" };
  if (f.confermati === 0) return { testo: "● Tutti esclusi", tono: "spento" };
  if (f.confermati < f.device) return { testo: `▲ ${f.confermati} su ${f.device}`, tono: "avviso" };
  return { testo: f.famiglia === "da_chiarire" ? "✓ Profilo prudente" : "✓ Pronto", tono: "ok" };
}


const PAROLE_APERTO: Record<GruppoAperto["stato"], { testo: string; tono: TonoStato }> = {
  in_corso: { testo: "▶ In corso", tono: "in_corso" },
  in_coda: { testo: "● In coda", tono: "ok" },
  finito: { testo: "✓ Finito", tono: "ok" },
  errore: { testo: "✕ In errore", tono: "errore" },
  sconosciuto: { testo: "▲ Non più sulla sonda", tono: "avviso" },
};

function GruppiAperti({ gruppi }: { gruppi: GruppoAperto[] }) {
  return (
    <Pannello titolo="Gruppi di questa rete" conteggio={`${gruppi.length}`} sottotitolo="Edge ne fa uno alla volta." corpoClassName="p-0">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-muted text-left text-[13px]">
          <tr>{["Gruppo", "Device", "Stato", "Avanzamento"].map((t) => <th key={t} className="px-3 py-2 font-semibold">{t}</th>)}</tr>
        </thead>
        <tbody>
          {gruppi.map((g) => (
            <tr key={g.scan_id} className="border-b">
              <td className="px-3 py-1.5 font-semibold">{g.nome}</td>
              <td className="px-3 py-1.5 font-mono text-[13px]">{g.device}</td>
              <td className="px-3 py-1.5" title={g.messaggio ?? undefined}><Stato tono={PAROLE_APERTO[g.stato].tono}>{PAROLE_APERTO[g.stato].testo}</Stato></td>
              <td className="px-3 py-1.5 font-mono text-[13px]">
                {g.stato === "in_corso" && g.percento !== null ? `${g.percento}%` : g.stato === "in_corso" && g.finiti !== null ? `${g.finiti} su ${g.device}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Pannello>
  );
}

function EsitoGruppi({ esito, nomeRete, nomi, occupato, onRiprova }: { esito: EsitoLancio; nomeRete: string; nomi: Partial<Record<Famiglia, string>>; occupato: boolean; onRiprova: (f: Famiglia[]) => void }) {
  const righe = esito.gruppi.map((g) => ({ g, p: parolaEsito(g.esito) }));
  const partiti = righe.filter(({ g }) => g.esito.stato === "lanciato").length;
  const daRifare = righe.filter(({ p }) => p.azione === "riprova").map(({ g }) => g.famiglia);
  const tolti = [
    ...esito.tolti.map((t) => ({ ip: t.ip, chi: "DA-IPAM", motivo: t.motivo })),
    ...esito.gruppi.flatMap((g) =>
      "ip_tolti" in g.esito ? g.esito.ip_tolti.map((ip) => ({ ip, chi: "Edge", motivo: "Freno degli impianti: tolto dalla sonda prima di partire." })) : [],
    ),
  ];
  return (
    <>
      <Pannello
        titolo={`Esito del lancio su ${nomeRete}`}
        conteggio={`${partiti} su ${righe.length}`}
        corpoClassName="p-0"
        azioni={daRifare.length > 0 ? (
          <Button size="sm" variant="outline" disabled={occupato} onClick={() => onRiprova(daRifare)}>
            Riprova su {daRifare.length === 1 ? "1 gruppo" : `${daRifare.length} gruppi`}
          </Button>
        ) : undefined}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted text-left text-[13px]">
              <tr>{["Gruppo", "Device", "Esito", "Scansione", "Cosa è successo", ""].map((t) => <th key={t} className="whitespace-nowrap px-3 py-2 font-semibold">{t}</th>)}</tr>
            </thead>
            <tbody>
              {righe.map(({ g, p }) => (
                <tr key={g.famiglia} className="border-b">
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{nomi[g.famiglia] ?? g.famiglia}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">{g.ips.length}{g.forzati ? <span className="font-sans text-muted-foreground"> · {g.forzati === 1 ? "1 forzato" : `${g.forzati} forzati`}</span> : null}</td>
                  <td className="px-3 py-1.5"><Stato tono={p.tono}>{p.parola}</Stato></td>
                  <td className="px-3 py-1.5 font-mono text-[13px]">{p.scan ?? "—"}</td>
                  <td className="px-3 py-1.5">{p.testo}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    {p.azione === "edge" && <Link href={DOVE_EDGE} className="text-sm font-semibold text-cian-testo hover:underline">Vai al modulo Edge ›</Link>}
                  </td>
                </tr>
              ))}
              {righe.length === 0 && <tr><td colSpan={6} className="px-3 py-4 text-center text-muted-foreground">Nessun gruppo partito.</td></tr>}
            </tbody>
          </table>
        </div>
      </Pannello>
      {(tolti.length > 0 || esito.avvisi.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {tolti.length > 0 && (
            <Pannello titolo="Tolti dal lancio" conteggio={`${tolti.length}`} sottotitolo="Confermati, ma non scansionati." corpoClassName="p-0">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted text-left text-[13px]">
                  <tr>{["IP", "Chi l'ha tolto", "Perché"].map((t) => <th key={t} className="px-3 py-2 font-semibold">{t}</th>)}</tr>
                </thead>
                <tbody>
                  {tolti.map((t) => (
                    <tr key={`${t.chi}-${t.ip}`} className="border-b">
                      <td className="px-3 py-1.5 font-mono text-[13px]">{t.ip}</td>
                      <td className="px-3 py-1.5">{t.chi}</td>
                      <td className="px-3 py-1.5">{t.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Pannello>
          )}
          {esito.avvisi.length > 0 && (
            <Pannello titolo="Avvisi" sottotitolo="Il gruppo è partito, ma con meno controlli.">
              <ul className="flex flex-col gap-1.5 text-sm">{esito.avvisi.map((a) => <li key={a}>{a}</li>)}</ul>
            </Pannello>
          )}
        </div>
      )}
    </>
  );
}

/** Le famiglie con cui si include un device (tavola oggetto 40, 08/11/2026). */
const FAMIGLIE_FORZA: Array<[Famiglia, string]> = [["linux", "Linux e server"], ["rete", "Rete"], ["windows", "Windows"], ["web", "Web e applicazioni"], ["periferiche", "Periferiche"], ["da_chiarire", "Da chiarire (profilo prudente)"]];
const nomeForza = (f: Famiglia | null | undefined) => FAMIGLIE_FORZA.find(([k]) => k === f)?.[1] ?? f ?? "";

/** La firma di una scelta: chi e quando. */
function firma(r: RigaProposta): string {
  return [r.confermata_da, r.confermata_il ? dataBreve(r.confermata_il) : null].filter(Boolean).join(", ");
}

function RigaDevice({ r, consenso, amministratore, profonditaFissa, occupato, scelto, onSeleziona, onVoce, onTogli }: {
  r: RigaProposta;
  /** Il consenso della rete (in vigore o futuro), se copre questo impianto. */
  consenso: ConsensoRete | null;
  amministratore: boolean;
  profonditaFissa: boolean;
  occupato: boolean;
  scelto: boolean;
  onSeleziona: (v: boolean) => void;
  onVoce: (voce: "veloce" | "bilanciato") => void;
  onTogli: () => void;
}) {
  const impianto = r.famiglia === "impianti";
  const escluso = r.stato === "escluso";
  const attiva = !impianto && !escluso && r.famiglia !== "da_chiarire";
  const avviso = r.da_rivedere ? r.motivo.replace(/^Ora risulterebbe:\s*/, "") : null;
  return (
    <tr className={cn("border-b", scelto && "bg-selezione", !scelto && (impianto || escluso) && "bg-muted/40")}>
      <td className="px-3 py-1.5">
        {amministratore && <Checkbox aria-label={`Seleziona ${r.ip}`} checked={scelto} disabled={occupato} onCheckedChange={(v) => onSeleziona(v === true)} />}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">{r.ip}</td>
      <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{r.nome ?? "—"}</td>
      <td className="min-w-56 px-3 py-1.5">{r.da_rivedere ? "Scelto da una persona" : r.motivo}</td>
      <td className="px-3 py-1.5">{r.con_web ? "✓" : "—"}</td>
      <td className="whitespace-nowrap px-3 py-1.5">
        {!attiva ? (r.famiglia === "da_chiarire" && !escluso ? "Veloce" : "—") : profonditaFissa || !amministratore ? (r.voce === "veloce" ? "Veloce" : "Bilanciato") : (
          <select
            aria-label={`Profondità di ${r.ip}`}
            className={campo}
            disabled={occupato}
            value={r.voce === "veloce" ? "veloce" : "bilanciato"}
            onChange={(e) => onVoce(e.target.value === "veloce" ? "veloce" : "bilanciato")}
          >
            <option value="bilanciato">Bilanciato</option>
            <option value="veloce">Veloce</option>
          </select>
        )}
      </td>
      <td className="px-3 py-1.5">
        <span className="flex flex-wrap items-center gap-1.5">
          {impianto && consenso ? (
            <span title={consenso.riferimento}><Stato tono="avviso">▲ Incluso col consenso {scadenzaConsenso(consenso)} · {consenso.chi}, {consenso.riferimento}</Stato></span>
          ) : impianto ? (
            <Stato tono="errore">✕ Impianto, escluso di serie</Stato>
          ) : escluso ? (
            <span title={r.forzata_nota ?? undefined}><Stato tono="spento">✕ Escluso{firma(r) ? ` · ${firma(r)}` : ""}{r.forzata_nota ? ` · «${r.forzata_nota}»` : ""}</Stato></span>
          ) : r.forzata_da_famiglia ? (
            <span className="inline-flex items-center rounded border-2 border-dashed border-[#0D2537] bg-card px-2 py-0.5 text-[13px] font-semibold text-[#0D2537]" title={r.forzata_nota ?? undefined}>
              ✓ Incluso come {nomeForza(r.famiglia)}{firma(r) ? ` · ${firma(r)}` : ""}
            </span>
          ) : r.stato === "confermato" ? (
            <Stato tono="ok">✓ Confermato{firma(r) ? ` · ${firma(r)}` : ""}</Stato>
          ) : (
            <Stato tono="ok">{r.famiglia === "da_chiarire" ? "✓ Incluso, profilo prudente" : "✓ Incluso"}</Stato>
          )}
          {avviso && <span className="text-[13px] text-muted-foreground">il sistema oggi lo vede come: {avviso}</span>}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <span className="flex items-center gap-1.5">
          {r.forzata_da_famiglia && amministratore && (
            <button type="button" disabled={occupato} className="min-h-7 rounded border border-muted-foreground bg-card px-2.5 text-[13px] font-semibold" onClick={onTogli}>Togli</button>
          )}
          <Link href={`/hosts/${r.host_id}`} className="text-[13px] text-cian-testo hover:underline">Cambia tipo ›</Link>
        </span>
      </td>
    </tr>
  );
}

export function PerDevice({ quadro, amministratore, onRileggi, nomeUtente }: {
  quadro: QuadroScansioni;
  amministratore: boolean;
  onRileggi: () => Promise<void>;
  /** Chi è entrato: il riquadro del consenso lo scrive («Registrato a nome di …»). */
  nomeUtente: string;
}) {
  const [conti, setConti] = useState<Record<number, ContoProposte>>({});
  const [reteId, setReteId] = useState<number | null>(null);
  const [dati, setDati] = useState<RispostaProposte | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [famiglia, setFamiglia] = useState<Famiglia | null>(null);
  const [spente, setSpente] = useState<Set<Famiglia>>(new Set());
  const [cerca, setCerca] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [rifiuto, setRifiuto] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const [esito, setEsito] = useState<EsitoLancio | null>(null);
  const [gruppiAperti, setGruppiAperti] = useState<GruppoAperto[]>([]);
  const [apertiDetto, setApertiDetto] = useState<string | null>(null);
  const [blocco, setBlocco] = useState<BloccoRete | null>(null);
  const [erroreConti, setErroreConti] = useState<string | null>(null);
  // Riquadro del consenso: false = chiuso, null = tutti gli impianti della rete, elenco = solo quelli selezionati (tavola 42).
  const [perConsenso, setPerConsenso] = useState<readonly string[] | null | false>(false);
  const [selezionati, setSelezionati] = useState<Set<number>>(new Set());
  const [includiCome, setIncludiCome] = useState<Famiglia | "proposta">("proposta");
  const [notaScelta, setNotaScelta] = useState("");
  const reteCorrente = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inLettura = useRef(false);

  const leggiConti = useCallback(async () => {
    const r = await fetchJson<{ conti: Record<number, ContoProposte> }>("/api/vulnerabilities/proposte-reti");
    if (!r.ok) {
      setErroreConti(r.message);
      return;
    }
    setErroreConti(null);
    setConti(r.data.conti);
    setReteId((v) => v ?? quadro.reti.find((n) => (r.data.conti[n.id]?.totale ?? 0) > 0)?.id ?? quadro.reti[0]?.id ?? null);
  }, [quadro.reti]);

  const leggiAperti = useCallback(async (id: number) => {
    if (inLettura.current) return; // un giro lento non ne accavalla un altro
    inLettura.current = true;
    const r = await fetchJson<EsitoGruppiAperti>(`/api/networks/${id}/proposte-va/gruppi`);
    inLettura.current = false;
    if (reteCorrente.current !== id) return;
    // Un guasto di passaggio non svuota il riquadro e non ferma i giri: resta l'ultimo stato letto, e si dice.
    if (!r.ok) setApertiDetto(r.message);
    else if (r.data.stato === "errore") setApertiDetto(r.data.messaggio);
    else if (r.data.stato === "da_aggiornare") setApertiDetto("Questa sonda non dice ancora a che punto sono i gruppi: va aggiornata.");
    else {
      setApertiDetto(null);
      setGruppiAperti(r.data.gruppi);
    }
  }, []);

  const leggi = useCallback(async (id: number) => {
    const r = await fetchJson<RispostaProposte>(`/api/networks/${id}/proposte-va`);
    if (reteCorrente.current !== id) return;
    if (r.ok) {
      setDati(r.data);
      setErrore(null);
      const b = await fetchJson<{ blocco: BloccoRete | null }>(`/api/networks/${id}/blocco-va`);
      if (reteCorrente.current === id) setBlocco(b.ok ? b.data.blocco : null);
    } else {
      setErrore(r.message);
    }
  }, []);

  useEffect(() => {
    void leggiConti();
  }, [leggiConti]);

  useEffect(() => {
    reteCorrente.current = reteId;
    setDati(null);
    setFamiglia(null);
    setSelezionati(new Set());
    setSpente(new Set());
    setEsito(null);
    setGruppiAperti([]);
    setApertiDetto(null);
    setRifiuto(null);
    setNota(null);
    setErrore(null);
    if (reteId === null) return;
    void leggi(reteId);
    void leggiAperti(reteId);
  }, [reteId, leggi, leggiAperti]);

  const haAperti = gruppiAperti.some((g) => g.stato === "in_corso" || g.stato === "in_coda");
  useEffect(() => {
    if (!haAperti || reteId === null) return;
    timer.current = setInterval(() => void leggiAperti(reteId), OGNI_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [haAperti, reteId, leggiAperti]);

  const rete = quadro.reti.find((r) => r.id === reteId) ?? null;
  const famiglie = useMemo(() => dati?.famiglie ?? [], [dati]);
  // Tavola 40 (08/11/2026): di serie il pannello 3 mostra i device a rischio; una famiglia si apre dalla tabella sopra.
  const famigliaVista = famiglia === null ? null : famiglie.find((f) => f.famiglia === famiglia) ?? null;
  const proposte = useMemo(() => dati?.proposte ?? [], [dati]);
  const aRischio = (r: RigaProposta) => r.famiglia === "impianti" || r.famiglia === "da_chiarire" || r.stato === "escluso";
  const device = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return proposte.filter((r) => (famigliaVista ? r.famiglia === famigliaVista.famiglia : r.famiglia === "impianti" || r.famiglia === "da_chiarire" || r.stato === "escluso")
      && (!q || `${r.ip} ${r.nome ?? ""}`.toLowerCase().includes(q)));
  }, [proposte, famigliaVista, cerca]);
  const senzaRischio = proposte.filter((r) => !aRischio(r)).length;
  const sceltiRighe = proposte.filter((r) => selezionati.has(r.host_id));
  const sceltiImpianti = sceltiRighe.filter((r) => r.famiglia === "impianti");

  // Passo 9: gli impianti si lanciano solo col consenso valido della rete (lo ricontrolla la sonda al lancio).
  // La sonda manda solo il consenso valido (non revocato, non scaduto) e lo ricontrolla al lancio.
  const consenso = rete?.consenso ?? null;
  // Tappa 2: un consenso che comincia più tardi (prossima finestra) non fa partire niente adesso, ma conta per orario e finestra.
  const consensoDato = consenso ?? rete?.consensoFuturo ?? null;
  const inLancio = famiglie.filter((f) => (f.famiglia === "impianti" ? !!consenso : !f.fuori && f.confermati > 0) && !spente.has(f.famiglia));
  const inPiano = famiglie.filter((f) => (f.famiglia === "impianti" ? !!consensoDato : !f.fuori && f.confermati > 0) && !spente.has(f.famiglia));
  const nInLancio = inLancio.reduce((t, f) => t + (f.famiglia === "impianti" ? f.device : f.confermati), 0);
  const somma = (k: "esclusi" | "inAttesa" | "daRivedere") => famiglie.reduce((t, f) => t + f[k], 0);
  const conteggio = (f: Famiglia) => famiglie.find((x) => x.famiglia === f)?.device ?? 0;

  // Collaudo del 09/11: a ogni ricarica le spunte «Lancia» tornavano tutte accese; con una pianificazione accesa si
  // riaprono con le sue famiglie. Stabile (useCallback) perché il pannello «Quando» la usa nella sua lettura.
  const tutte = famiglie.map((f) => f.famiglia).join(",");
  const riprendiSpunte = useCallback((salvate: readonly Famiglia[]) => {
    setSpente(new Set(tutte.split(",").filter((f): f is Famiglia => f !== "" && !salvate.includes(f as Famiglia)) as Famiglia[]));
  }, [tutte]);

  /** Passo 9: revoca il consenso degli impianti della rete (stessa rotta della scheda «Un profilo solo»). */
  const revocaConsenso = async () => {
    if (!rete) return;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson("/api/vulnerabilities/consenso-impianti", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network_id: rete.id }),
    });
    if (!r.ok) setRifiuto(r.message);
    await onRileggi();
    setOccupato(false);
  };

  /** Passo 9: forza o toglie la forzatura di un host «da chiarire»; il quadro torna dal server. */
  const forzatura = async (metodo: "POST" | "DELETE", corpo: Record<string, unknown>) => {
    if (reteId === null) return;
    const id = reteId;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<RispostaProposte>(`/api/networks/${id}/proposte-va/forza`, {
      method: metodo,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (reteCorrente.current === id) {
      if (r.ok) setDati(r.data);
      else setRifiuto(r.message);
    }
    await leggiConti();
    setOccupato(false);
  };

  /** Barra della selezione (tavola 40): escludi o includi i device scelti, con firma e nota. */
  const scegli = async (azione: "escludi" | "includi") => {
    const ids = sceltiRighe.filter((r) => r.famiglia !== "impianti").map((r) => r.host_id);
    if (ids.length === 0) return;
    const nota = notaScelta.trim() || null;
    if (azione === "escludi") await dopoScelta({ host_ids: ids, stato: "escluso", nota });
    else if (includiCome === "proposta") await dopoScelta({ host_ids: ids, stato: "confermato", nota });
    else await forzatura("POST", { host_ids: ids, famiglia: includiCome, nota });
    setSelezionati(new Set());
    setNotaScelta("");
  };

  const dopoScelta = async (corpo: Record<string, unknown>) => {
    if (reteId === null) return;
    const id = reteId;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<RispostaProposte & { rifiutate?: number[]; riaperte?: number }>(`/api/networks/${id}/proposte-va`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (reteCorrente.current !== id) {
      setOccupato(false);
      return;
    }
    if (r.ok) {
      setDati(r.data);
      if (r.data.rifiutate?.length) setRifiuto(`${r.data.rifiutate.length} device non confermati: lo stato è cambiato, rileggi la proposta.`);
      const chiesti = Array.isArray(corpo.host_ids) ? corpo.host_ids.length : 0;
      if (corpo.stato === "riapri" && (r.data.riaperte ?? 0) < chiesti) setRifiuto(`${chiesti - (r.data.riaperte ?? 0)} device non aggiornati: non sono online.`);
      await leggiConti();
    } else {
      setRifiuto(r.message);
    }
    setOccupato(false);
  };

  const rigenera = async () => {
    if (reteId === null) return;
    const id = reteId;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<RispostaProposte & { scritte: number; daRivedere: number }>(`/api/networks/${id}/proposte-va`, { method: "POST" });
    if (reteCorrente.current !== id) {
      setOccupato(false);
      return;
    }
    if (r.ok) {
      setDati(r.data);
      setNota(`Proposta rigenerata: ${r.data.scritte} righe scritte, ${r.data.daRivedere} da rivedere.`);
      await leggiConti();
    } else {
      setRifiuto(r.message);
    }
    setOccupato(false);
  };

  const ricognizione = async () => {
    if (reteId === null) return;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<{ id: string }>("/api/scans/sequenza", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network_id: reteId, sequenza: "ricognizione" }),
    });
    if (r.ok) setNota("Ricognizione avviata: a fine giro usa «Rigenera proposta».");
    else setRifiuto(r.message);
    setOccupato(false);
  };

  const lancia = async (scelte: Famiglia[]) => {
    if (reteId === null) return;
    const id = reteId;
    setOccupato(true);
    setRifiuto(null);
    const r = await fetchJson<EsitoLancio>(`/api/networks/${id}/proposte-va/lancia?famiglie=${scelte.join(",")}`, { method: "POST" });
    if (reteCorrente.current === id) {
      if (r.ok) setEsito(r.data);
      else setRifiuto(r.status === 502 ? `Nessun gruppo partito. ${r.message}` : r.message);
      await leggiAperti(id);
    }
    await Promise.all([leggiConti(), onRileggi()]);
    setOccupato(false);
  };

  const sblocca = async () => {
    if (!rete) return;
    setOccupato(true);
    const r = await fetchJson<{ ok: boolean }>(`/api/networks/${rete.id}/blocco-va`, { method: "DELETE" });
    if (r.ok) setBlocco(null);
    else setRifiuto(r.message);
    setOccupato(false);
  };

  const manca = !amministratore ? "Solo lettura" : quadro.edge.stato !== "acceso" ? "Edge non risponde" : inLancio.length === 0 ? "Nessun device incluso" : null;
  const senzaProposta = dati !== null && dati.proposte.length === 0;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TesseraNumero titolo="Device online" valore={dati ? proposte.length : null} qualifica={rete?.nome} />
        <TesseraNumero titolo="Inclusi" valore={dati ? nInLancio : null} />
        <TesseraNumero titolo="Restano fuori" valore={dati ? proposte.length - nInLancio : null} />
        <TesseraNumero titolo="Gruppi aperti" valore={gruppiAperti.filter((g) => g.stato === "in_corso" || g.stato === "in_coda").length} nota="Edge fa una scansione alla volta" />
      </div>

      {blocco && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
          <Stato tono="errore">✕ Rete bloccata: {blocco.motivo}</Stato>
          {amministratore && <Button size="sm" variant="outline" disabled={occupato} onClick={() => void sblocca()}>Sblocca la rete</Button>}
        </div>
      )}

      {haAperti && <GruppiAperti gruppi={gruppiAperti} />}
      {apertiDetto && <p className="text-sm"><Stato tono="avviso">▲ Gruppi aperti: {apertiDetto}</Stato></p>}
      {erroreConti && <LoadError what="l'elenco delle reti" message={erroreConti} onRetry={() => void leggiConti()} />}

      <div className="grid gap-3 lg:grid-cols-12">
        <Pannello numero={1} titolo="Rete" className="lg:col-span-3">
          <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto">
            {quadro.reti.map((r) => {
              const s = statoRete(r, conti[r.id]);
              return (
                <VoceSelezionabile key={r.id} scelta={r.id === reteId} onScegli={() => { if (!occupato) setReteId(r.id); }}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold">{r.nome}</span>
                    <span className="font-mono text-[13px]">{r.cidr}</span>
                  </span>
                  <span className="mt-1 block"><Stato tono={s.tono}>{s.testo}</Stato></span>
                </VoceSelezionabile>
              );
            })}
            {quadro.reti.length === 0 && <Vuoto titolo="Nessuna rete" testo="Le reti si aggiungono dalla pagina Reti." />}
          </div>
        </Pannello>

        <Pannello
          numero={2}
          titolo="Famiglie"
          className="lg:col-span-9"
          sottotitolo="Una riga per tipo di device: si sceglie quali gruppi lanciare."
          corpoClassName="p-0"
          piede={famiglie.some((f) => f.scesa) ? "▼ vuol dire scesa rispetto alla proposta: basta un device con una scelta più bassa e scende tutto il gruppo." : undefined}
          azioni={
            <>
              {dati?.aggiornata_il && <span className="text-sm text-muted-foreground">Proposta del <span className="font-mono text-[13px]">{dataBreve(dati.aggiornata_il)}</span></span>}
              {amministratore && <Button size="sm" variant="outline" disabled={occupato || reteId === null} onClick={() => void ricognizione()}>{senzaProposta ? "Avvia ricognizione" : "Rifai ricognizione"}</Button>}
              {amministratore && <Button size="sm" variant="outline" disabled={occupato || reteId === null} onClick={() => void rigenera()}>Rigenera proposta</Button>}
            </>
          }
        >
          {errore && <LoadError what="la proposta" message={errore} onRetry={() => reteId !== null && void leggi(reteId)} />}
          {!errore && dati === null && reteId !== null && <InCorso titolo="Lettura della proposta" />}
          {senzaProposta && (
            <Vuoto titolo="Questa rete non ha ancora una proposta" testo="Prima la ricognizione delicata: costruttori dal router, poi solo porte aperte. A fine giro: Rigenera proposta." />
          )}
          {famiglie.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-muted text-left text-[13px]">
                  <tr>{["Lancia", "Famiglia", "Device", "Inclusi", "Greenbone", "Nuclei", "Moduli", "Stato"].map((t) => <th key={t} className="whitespace-nowrap px-3 py-2 font-semibold">{t}</th>)}</tr>
                </thead>
                <tbody>
                  {famiglie.map((f) => {
                    const s = statoFamiglia(f);
                    const vista = f.famiglia === famigliaVista?.famiglia;
                    return (
                      <tr key={f.famiglia} className={cn("cursor-pointer border-b", vista && "bg-selezione", !vista && f.fuori && "bg-muted/40")} onClick={() => setFamiglia(f.famiglia)}>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Lancia il gruppo ${f.nome}`}
                            checked={(f.famiglia === "impianti" ? !!consensoDato : !f.fuori && f.confermati > 0) && !spente.has(f.famiglia)}
                            disabled={!amministratore || (f.famiglia === "impianti" ? !consensoDato : !!f.fuori || f.confermati === 0)}
                            onCheckedChange={(v) => setSpente((p) => {
                              const n = new Set(p);
                              if (v === true) n.delete(f.famiglia);
                              else n.add(f.famiglia);
                              return n;
                            })}
                          />
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-semibold"><button type="button" className="font-semibold hover:underline" aria-pressed={vista} onClick={() => setFamiglia(f.famiglia)}>{f.nome}</button></td>
                        <td className="px-3 py-1.5 font-mono text-[13px]">{f.device}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[13px]">{f.fuori ? "—" : f.confermati}{f.forzati ? <span className="font-sans text-muted-foreground"> · {f.forzati === 1 ? "1 forzato" : `${f.forzati} forzati`}</span> : null}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{f.famiglia === "impianti" && consenso ? "Veloce, solo col consenso" : f.greenbone}{f.scesa ? " ▼" : ""}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{f.nuclei}</td>
                        <td className="whitespace-nowrap px-3 py-1.5">{f.moduli}</td>
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          {f.famiglia === "impianti" && (consenso || rete?.consensoFuturo) ? (
                            <span className="flex items-center gap-2">
                              <Stato tono="avviso">▲ {(consenso ?? rete!.consensoFuturo!).ips.length} con consenso {scadenzaConsenso(consenso ?? rete!.consensoFuturo!)} · solo Greenbone</Stato>
                              {amministratore && <Button size="sm" variant="outline" disabled={occupato} onClick={() => void revocaConsenso()}>Revoca</Button>}
                            </span>
                          ) : (
                            <span className="flex items-center gap-2">
                              <Stato tono={s.tono}>{s.testo}</Stato>
                              {f.famiglia === "impianti" && amministratore && rete?.consensoNoto !== false && quadro.edge.stato === "acceso" && (
                                <Button size="sm" variant="outline" disabled={occupato} onClick={() => setPerConsenso(null)}>Autorizza gli impianti</Button>
                              )}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Pannello>
      </div>

      {nota && <p className="text-sm"><Stato tono="ok">● {nota}</Stato></p>}
      {rifiuto && <p role="alert" className="text-sm"><Stato tono="avviso">▲ {rifiuto}</Stato></p>}

      {dati && (
        <Pannello
          numero={3}
          titolo={famigliaVista ? `Device di ${famigliaVista.nome}` : "Device a rischio"}
          conteggio={`${device.length}`}
          sottotitolo={famigliaVista
            ? `${famigliaVista.confermati} inclusi su ${famigliaVista.device}`
            : "Di serie si scansiona tutto: qui gli impianti, i «da chiarire» e gli esclusi, con Includi o Escludi."}
          corpoClassName="p-0"
          azioni={
            <>
              {famigliaVista && <Button size="sm" variant="outline" onClick={() => { setFamiglia(null); setSelezionati(new Set()); }}>‹ A rischio</Button>}
              <span className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input aria-label="Cerca un device" placeholder="Cerca IP o nome" className="h-9 w-52 pl-8" value={cerca} onChange={(e) => setCerca(e.target.value)} />
              </span>
            </>
          }
        >
          {amministratore && selezionati.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-y-2 border-foreground bg-[#FFF6CC] px-4 py-2.5 text-sm text-[#0D2537]">
              <strong>{selezionati.size === 1 ? "1 selezionato" : `${selezionati.size} selezionati`}</strong>
              <label className="flex items-center gap-2">Nota
                <input className={cn(campo, "w-56")} maxLength={300} value={notaScelta} onChange={(e) => setNotaScelta(e.target.value)} placeholder="facoltativa" />
              </label>
              <Button size="sm" variant="outline" disabled={occupato || sceltiRighe.length === sceltiImpianti.length} onClick={() => void scegli("escludi")}>Escludi</Button>
              <Button size="sm" disabled={occupato || sceltiRighe.length === sceltiImpianti.length} onClick={() => void scegli("includi")}>Includi</Button>
              <label className="flex items-center gap-2">come
                <select className={campo} value={includiCome} onChange={(e) => setIncludiCome(e.target.value as Famiglia | "proposta")}>
                  <option value="proposta">la famiglia proposta</option>
                  {FAMIGLIE_FORZA.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
              </label>
              {sceltiImpianti.length > 0 && (
                <>
                  <span className="text-muted-foreground">{sceltiImpianti.length === 1 ? "1 impianto" : `${sceltiImpianti.length} impianti`}: si includono solo col consenso</span>
                  <Button size="sm" className="bg-[#8E1B20] text-white hover:bg-[#8E1B20]/90" disabled={occupato || quadro.edge.stato !== "acceso"} onClick={() => setPerConsenso(sceltiImpianti.map((r) => r.ip))}>Includi impianti…</Button>
                </>
              )}
              <span className="flex-1" />
              <Button size="sm" variant="outline" onClick={() => setSelezionati(new Set())}>Annulla</Button>
            </div>
          )}
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-left text-[13px]">
                <tr>
                  <th className="w-10 px-3 py-2">
                    {amministratore && (
                      <Checkbox
                        aria-label="Seleziona tutti quelli in elenco"
                        checked={device.length > 0 && device.every((r) => selezionati.has(r.host_id))}
                        onCheckedChange={(v) => setSelezionati(v === true ? new Set(device.map((r) => r.host_id)) : new Set())}
                      />
                    )}
                  </th>
                  {["IP", "Nome", "Perché questa famiglia", "Web", "Profondità", "Stato e firma", "Azioni"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {device.map((r) => (
                  <RigaDevice
                    key={r.host_id}
                    r={r}
                    consenso={[consenso, rete?.consensoFuturo ?? null].find((c) => c && c.ips.includes(r.ip)) ?? null}
                    amministratore={amministratore}
                    profonditaFissa={r.famiglia === "periferiche"}
                    occupato={occupato}
                    scelto={selezionati.has(r.host_id)}
                    onSeleziona={(v) => setSelezionati((p) => { const n = new Set(p); if (v) n.add(r.host_id); else n.delete(r.host_id); return n; })}
                    onVoce={(voce) => void dopoScelta({ host_ids: [r.host_id], stato: r.stato === "escluso" ? "escluso" : "confermato", voce })}
                    onTogli={() => void forzatura("DELETE", { host_id: r.host_id })}
                  />
                ))}
                {device.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-center text-muted-foreground">{famigliaVista || cerca ? "Nessun device corrisponde alla ricerca." : "Nessun device a rischio in questa rete."}</td></tr>}
                {!famigliaVista && senzaRischio > 0 && (
                  <tr><td colSpan={8} className="bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">Altri {senzaRischio} device senza rischio: inclusi, ognuno col profilo della sua famiglia. Si aprono dalla tabella delle famiglie.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Pannello>
      )}

      {famiglie.length > 0 && rete && (
        <QuandoDevice
          reteId={rete.id}
          nomeRete={rete.nome}
          scelte={inLancio.map((f) => f.famiglia)}
          sceltePiano={inPiano.map((f) => f.famiglia)}
          nomiFamiglie={Object.fromEntries(famiglie.map((f) => [f.famiglia, f.nome]))}
          nDevice={nInLancio}
          amministratore={amministratore}
          manca={manca}
          occupato={occupato}
          onAdesso={() => void lancia(inLancio.map((f) => f.famiglia))}
          onSalvata={riprendiSpunte}
          fuori={
            <span className="flex flex-wrap items-center gap-2 text-sm">
              Restano fuori:
              {conteggio("impianti") > 0 && <Stato tono="errore">✕ {conteggio("impianti")} impianti</Stato>}
              {somma("esclusi") > 0 && <Stato tono="spento">● {somma("esclusi")} esclusi</Stato>}
            </span>
          }
        />
      )}

      {perConsenso !== false && rete && (
        <RiquadroConsenso
          rete={rete}
          scelti={perConsenso ?? undefined}
          nome={nomeUtente}
          onChiudi={() => setPerConsenso(false)}
          onFatto={() => {
            setPerConsenso(false);
            void onRileggi();
          }}
        />
      )}

      {esito && <EsitoGruppi esito={esito} nomeRete={rete?.nome ?? ""} nomi={Object.fromEntries(famiglie.map((f) => [f.famiglia, f.nome]))} occupato={occupato} onRiprova={(f) => void lancia(f)} />}
    </>
  );
}
